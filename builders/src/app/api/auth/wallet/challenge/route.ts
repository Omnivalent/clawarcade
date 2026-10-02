import { z } from "zod";
import { db } from "@/lib/db";
import { newNonce, walletMessage } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const POST = handle(async (req: Request) => {
  const { wallet } = z.object({ wallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) }).parse(await req.json());
  const nonce = newNonce();
  await db.authChallenge.create({ data: { kind: "wallet", subject: wallet, nonce, expiresAt: new Date(Date.now() + 5 * 60_000) } });
  return json({ nonce, message: walletMessage(wallet, nonce) });
});
