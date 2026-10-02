import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { db } from "./db";
import { ECONOMICS } from "./config";

const COOKIE = "bld_session";
const SESSION_DAYS = 14;

export async function createSession(userId: string) {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.session.create({ data: { id, userId, expiresAt } });
  const jar = await cookies();
  jar.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) await db.session.deleteMany({ where: { id } });
  jar.delete(COOKIE);
}

export async function getUser() {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (!id) return null;
  const s = await db.session.findUnique({ where: { id }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return s.user;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser() {
  const u = await getUser();
  if (!u) throw new HttpError(401, "Sign in required");
  return u;
}

export function walletMessage(wallet: string, nonce: string) {
  return [
    "Sign in to Buildera",
    "",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    "",
    "This signature proves wallet ownership. It does not send a transaction or cost SOL.",
  ].join("\n");
}

export function verifyWalletSignature(wallet: string, message: string, signatureB58: string) {
  try {
    const pk = bs58.decode(wallet);
    const sig = bs58.decode(signatureB58);
    if (pk.length !== 32 || sig.length !== 64) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pk);
  } catch {
    return false;
  }
}

export function newNonce() {
  return randomBytes(16).toString("hex");
}

/** Upsert a user by identity, granting signup credits on first sight. */
export async function upsertUser(identity: { wallet?: string; email?: string }) {
  const where = identity.wallet ? { wallet: identity.wallet } : { email: identity.email! };
  const existing = await db.user.findUnique({ where });
  if (existing) return existing;
  return db.user.create({
    data: { ...identity, credits: ECONOMICS.signupCredits },
  });
}
