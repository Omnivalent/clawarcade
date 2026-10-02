import { db } from "@/lib/db";
import { HttpError, requireUser } from "@/lib/auth";
import { ECONOMICS, env } from "@/lib/config";
import { handle, json } from "@/lib/http";

export const POST = handle(async () => {
  if (!env.devMode) throw new HttpError(403, "Faucet is only available in DEV_MODE");
  const u = await requireUser();
  const updated = await db.user.update({
    where: { id: u.id },
    data: { credits: { increment: ECONOMICS.faucetCredits }, simSol: { increment: ECONOMICS.faucetSimSol } },
  });
  return json({ credits: updated.credits, simSol: updated.simSol });
});
