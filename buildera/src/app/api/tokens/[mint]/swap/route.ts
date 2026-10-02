import { z } from "zod";
import { HttpError, requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { simulatedSwap } from "@/lib/tokens";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ mint: string }> }) => {
  const { mint } = await ctx.params;
  const user = await requireUser();
  if (!user.wallet) throw new HttpError(403, "Simulated trading requires wallet sign-in");
  const { side, amount, minOut } = z
    .object({ side: z.enum(["buy", "sell"]), amount: z.coerce.number().positive().max(1e12), minOut: z.coerce.number().min(0).optional() })
    .parse(await req.json());
  const r = await simulatedSwap(user.id, mint, side, amount, minOut ?? 0);
  return json({ ...r, simulated: true });
});
