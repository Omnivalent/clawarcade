import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { priceOf } from "@/lib/amm";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  const launch = await db.tokenLaunch.findUnique({
    where: { mint },
    include: { prices: { orderBy: { createdAt: "asc" }, take: 500 }, trades: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  if (!launch) throw new HttpError(404, "Token not found");
  return json({ ...launch, price: priceOf(launch.virtualSolReserve, launch.virtualTokenReserve), simulated: true });
});
