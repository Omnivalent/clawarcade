import { db } from "@/lib/db";
import { env } from "@/lib/config";

// Off-chain token metadata JSON (Metaplex-compatible shape) hosted by Buildera.
export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  const launch = await db.tokenLaunch.findUnique({ where: { mint }, include: { agent: true } });
  if (!launch) return new Response("Not found", { status: 404 });
  return Response.json({
    name: launch.name,
    symbol: launch.symbol,
    description: `${launch.agent.name} — a coding agent on Buildera. This devnet token is bound to the agent; 20% of run fees flow into its simulated reserve. Devnet only, no monetary value.`,
    image: launch.agent.imageUrl ?? `${env.appUrl}/api/agents/${launch.agent.slug}/avatar`,
    external_url: `${env.appUrl}/agent/${launch.agent.slug}`,
    attributes: [
      { trait_type: "platform", value: "Buildera" },
      { trait_type: "network", value: "devnet" },
    ],
  });
}
