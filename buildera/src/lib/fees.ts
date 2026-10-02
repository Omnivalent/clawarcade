import { db } from "./db";
import { ECONOMICS, FEE_SPLIT } from "./config";
import { priceOf } from "./amm";

export function splitCredits(total: number) {
  const creatorShare = Math.floor((total * FEE_SPLIT.creatorBps) / 10_000);
  const tokenShare = Math.floor((total * FEE_SPLIT.tokenBps) / 10_000);
  const platformShare = total - creatorShare - tokenShare;
  return { creatorShare, tokenShare, platformShare };
}

/**
 * Settle a completed run: 70% to the agent creator, 20% to the agent token's virtual
 * SOL reserve (simulated buy pressure), 10% platform. Idempotent per run.
 */
export async function settleRun(runId: string) {
  return db.$transaction(async (tx) => {
    const existing = await tx.feeLedger.findUnique({ where: { runId } });
    if (existing) return existing;
    const run = await tx.run.findUniqueOrThrow({ where: { id: runId }, include: { agent: { include: { token: true } } } });
    const { creatorShare, tokenShare, platformShare } = splitCredits(run.creditsCharged);

    await tx.user.update({ where: { id: run.agent.ownerId }, data: { earnedCredits: { increment: creatorShare } } });

    let tokenSolAdded = 0;
    const launch = run.agent.token;
    if (launch && tokenShare > 0) {
      tokenSolAdded = tokenShare * ECONOMICS.solPerCredit;
      const updated = await tx.tokenLaunch.update({
        where: { id: launch.id },
        data: { virtualSolReserve: { increment: tokenSolAdded } },
      });
      await tx.pricePoint.create({
        data: { launchId: launch.id, price: priceOf(updated.virtualSolReserve, updated.virtualTokenReserve), source: "fee" },
      });
    }

    return tx.feeLedger.create({
      data: { runId, agentId: run.agentId, creatorShare, tokenShare, platformShare, tokenSolAdded },
    });
  });
}

export async function refundRun(runId: string) {
  await db.$transaction(async (tx) => {
    const run = await tx.run.findUniqueOrThrow({ where: { id: runId } });
    if (run.creditsCharged <= 0) return;
    await tx.user.update({ where: { id: run.userId }, data: { credits: { increment: run.creditsCharged } } });
    await tx.run.update({ where: { id: runId }, data: { creditsCharged: 0 } });
  });
}
