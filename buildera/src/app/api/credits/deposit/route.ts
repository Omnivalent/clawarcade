import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, requireUser } from "@/lib/auth";
import { ECONOMICS } from "@/lib/config";
import { handle, json } from "@/lib/http";
import { verifyDeposit } from "@/lib/solana";

export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  if (!u.wallet) throw new HttpError(400, "Sign in with a wallet to deposit devnet SOL");
  const { signature } = z.object({ signature: z.string().min(40).max(100) }).parse(await req.json());
  if (await db.creditPurchase.findUnique({ where: { signature } })) throw new HttpError(409, "Deposit already credited");
  const lamports = await verifyDeposit(signature, u.wallet).catch((e: Error) => {
    throw new HttpError(400, e.message);
  });
  const credits = Math.floor((Number(lamports) / 1e9) * ECONOMICS.creditsPerSol);
  const [, user] = await db.$transaction([
    db.creditPurchase.create({ data: { userId: u.id, signature, lamports, credits } }),
    db.user.update({ where: { id: u.id }, data: { credits: { increment: credits } } }),
  ]);
  return json({ credited: credits, credits: user.credits });
});
