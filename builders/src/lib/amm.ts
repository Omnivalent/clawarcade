// Simulated constant-product AMM over *virtual* reserves. Nothing here touches the
// chain: it only moves numbers in Postgres. Price is quoted in SOL per whole token.

export const SWAP_FEE_BPS = 100;

export function priceOf(vSol: number, vTok: number) {
  return vTok > 0 ? vSol / vTok : 0;
}

export type Quote = {
  side: "buy" | "sell";
  amountIn: number;
  amountOut: number;
  fee: number;
  priceBefore: number;
  priceAfter: number;
  priceImpactPct: number;
  newSol: number;
  newTok: number;
};

/** buy: amountIn is SOL → tokens out. sell: amountIn is tokens → SOL out. */
export function quote(side: "buy" | "sell", amountIn: number, vSol: number, vTok: number): Quote {
  if (!(amountIn > 0) || !Number.isFinite(amountIn)) throw new Error("Amount must be positive");
  const k = vSol * vTok;
  const fee = (amountIn * SWAP_FEE_BPS) / 10_000;
  const net = amountIn - fee;
  let newSol: number, newTok: number, amountOut: number;
  if (side === "buy") {
    newSol = vSol + net;
    newTok = k / newSol;
    amountOut = vTok - newTok;
  } else {
    newTok = vTok + net;
    newSol = k / newTok;
    amountOut = vSol - newSol;
  }
  const priceBefore = priceOf(vSol, vTok);
  const priceAfter = priceOf(newSol, newTok);
  return {
    side,
    amountIn,
    amountOut,
    fee,
    priceBefore,
    priceAfter,
    priceImpactPct: priceBefore > 0 ? ((priceAfter - priceBefore) / priceBefore) * 100 : 0,
    newSol,
    newTok,
  };
}
