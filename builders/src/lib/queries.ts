import { db } from "./db";
import { priceOf } from "./amm";
import type { AgentCardData } from "@/components/AgentCard";

export async function catalog(where: { ownerId?: string } = {}): Promise<AgentCardData[]> {
  const agents = await db.agent.findMany({
    where: { status: "published", ...where },
    orderBy: [{ runCount: "desc" }, { createdAt: "desc" }],
    include: { token: { include: { prices: { orderBy: { createdAt: "desc" }, take: 40 } } } },
  });
  return agents.map((a) => {
    let token: AgentCardData["token"] = null;
    if (a.token) {
      const series = a.token.prices.map((p) => p.price).reverse();
      const price = priceOf(a.token.virtualSolReserve, a.token.virtualTokenReserve);
      const first = series[0] ?? price;
      token = { symbol: a.token.symbol, price, change: first ? ((price - first) / first) * 100 : 0, series: series.length ? series : [price] };
    }
    return {
      slug: a.slug,
      name: a.name,
      tagline: a.tagline,
      description: a.description,
      accent: a.accent,
      imageUrl: a.imageUrl,
      model: a.model,
      priceCredits: a.priceCredits,
      runCount: a.runCount,
      token,
    };
  });
}

export async function platformStats() {
  const [agents, runs, settled, tokens] = await Promise.all([
    db.agent.count({ where: { status: "published" } }),
    db.run.count({ where: { status: "completed" } }),
    db.feeLedger.aggregate({ _sum: { creatorShare: true, tokenShare: true, platformShare: true } }),
    db.tokenLaunch.count(),
  ]);
  const s = settled._sum;
  return { agents, runs, settled: (s.creatorShare ?? 0) + (s.tokenShare ?? 0) + (s.platformShare ?? 0), tokens };
}
