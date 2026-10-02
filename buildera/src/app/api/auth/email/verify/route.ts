import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, upsertUser } from "@/lib/auth";
import { env } from "@/lib/config";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const ch = await db.authChallenge.findUnique({ where: { nonce: token } });
  if (!ch || ch.kind !== "email" || ch.usedAt || ch.expiresAt < new Date()) {
    return NextResponse.redirect(new URL("/signin?error=expired", env.appUrl));
  }
  await db.authChallenge.update({ where: { nonce: token }, data: { usedAt: new Date() } });
  const user = await upsertUser({ email: ch.subject });
  await createSession(user.id);
  return NextResponse.redirect(new URL("/dashboard", env.appUrl));
}
