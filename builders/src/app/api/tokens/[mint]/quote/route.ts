import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { quote } from "@/lib/amm";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  const { side, amount } = z.object({ side: z.enum(["buy", "sell"]), amount: z.coerce.number().positive().max(1e12) }).parse(await req.json());
  const launch = await db.tokenLaunch.findUnique({ where: { mint } });
  if (!launch) throw new HttpError(404, "Token not found");
  const q = quote(side, amount, launch.virtualSolReserve, launch.virtualTokenReserve);
  return json({ ...q, simulated: true });
});
