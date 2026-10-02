import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, HttpError, upsertUser, verifyWalletSignature, walletMessage } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const POST = handle(async (req: Request) => {
  const { wallet, nonce, signature } = z.object({ wallet: z.string(), nonce: z.string(), signature: z.string() }).parse(await req.json());
  const ch = await db.authChallenge.findUnique({ where: { nonce } });
  if (!ch || ch.kind !== "wallet" || ch.subject !== wallet || ch.usedAt || ch.expiresAt < new Date()) {
    throw new HttpError(400, "Challenge expired — try again");
  }
  if (!verifyWalletSignature(wallet, walletMessage(wallet, nonce), signature)) throw new HttpError(401, "Signature check failed");
  await db.authChallenge.update({ where: { nonce }, data: { usedAt: new Date() } });
  const user = await upsertUser({ wallet });
  await createSession(user.id);
  return json({ ok: true });
});
