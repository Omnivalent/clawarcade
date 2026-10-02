import "server-only";
import { db } from "./db";
import { TOKEN } from "./config";
import { createAgentMint } from "./solana";
import { priceOf, quote } from "./amm";
import { HttpError } from "./auth";

export async function launchTokenForAgent(agentId: string, symbol: string) {
  const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId }, include: { token: true } });
  if (agent.token) throw new HttpError(409, "This agent already has a token");
  const taken = await db.tokenLaunch.findFirst({ where: { symbol } });
  if (taken) throw new HttpError(409, `Symbol ${symbol} is already used on Builders`);

  const minted = await createAgentMint();
  const launch = await db.$transaction(async (tx) => {
    const l = await tx.tokenLaunch.create({
      data: {
        agentId,
        mint: minted.mint,
        name: agent.name,
        symbol,
        decimals: TOKEN.decimals,
        supply: BigInt(TOKEN.supply),
        virtualSolReserve: TOKEN.initialVirtualSol,
        virtualTokenReserve: TOKEN.supply,
        creatorFeeBps: TOKEN.creatorFeeBps,
        onChain: minted.onChain,
        launchTx: minted.launchTx,
        vault: minted.vault,
      },
    });
    await tx.agent.update({ where: { id: agentId }, data: { tokenMint: minted.mint } });
    await tx.pricePoint.create({ data: { launchId: l.id, price: priceOf(l.virtualSolReserve, l.virtualTokenReserve), source: "launch" } });
    return l;
  });
  return { launch, note: minted.note };
}

/** Simulated swap: moves only virtual reserves and internal balances, atomically. */
export async function simulatedSwap(userId: string, mint: string, side: "buy" | "sell", amountIn: number, minOut = 0) {
  return db.$transaction(async (tx) => {
    // Row lock so concurrent swaps serialise on the pool.
    await tx.$queryRaw`SELECT id FROM "TokenLaunch" WHERE mint = ${mint} FOR UPDATE`;
    const launch = await tx.tokenLaunch.findUnique({ where: { mint } });
    if (!launch) throw new HttpError(404, "Token not found");
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const bal = await tx.tokenBalance.findUnique({ where: { userId_mint: { userId, mint } } });
    const q = quote(side, amountIn, launch.virtualSolReserve, launch.virtualTokenReserve);
    if (q.amountOut < minOut) throw new HttpError(409, "Price moved beyond your slippage limit");

    if (side === "buy") {
      if (user.simSol < amountIn) throw new HttpError(402, "Not enough simulated SOL — use the faucet");
      await tx.user.update({ where: { id: userId }, data: { simSol: { decrement: amountIn } } });
      await tx.tokenBalance.upsert({
        where: { userId_mint: { userId, mint } },
        create: { userId, mint, amount: q.amountOut },
        update: { amount: { increment: q.amountOut } },
      });
    } else {
      if ((bal?.amount ?? 0) < amountIn) throw new HttpError(402, `Not enough ${launch.symbol}`);
      await tx.tokenBalance.update({ where: { userId_mint: { userId, mint } }, data: { amount: { decrement: amountIn } } });
      await tx.user.update({ where: { id: userId }, data: { simSol: { increment: q.amountOut } } });
    }
    const updated = await tx.tokenLaunch.update({
      where: { id: launch.id },
      data: { virtualSolReserve: q.newSol, virtualTokenReserve: q.newTok },
    });
    const price = priceOf(updated.virtualSolReserve, updated.virtualTokenReserve);
    await tx.trade.create({
      data: {
        launchId: launch.id,
        userId,
        side,
        solAmount: side === "buy" ? amountIn : q.amountOut,
        tokAmount: side === "buy" ? q.amountOut : amountIn,
        price,
      },
    });
    await tx.pricePoint.create({ data: { launchId: launch.id, price, source: "trade" } });
    return { quote: q, price };
  });
}
