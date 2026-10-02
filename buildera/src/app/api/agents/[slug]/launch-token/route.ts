import { db } from "@/lib/db";
import { HttpError, requireUser } from "@/lib/auth";
import { symbolInput } from "@/lib/agents";
import { handle, json } from "@/lib/http";
import { launchTokenForAgent } from "@/lib/tokens";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const user = await requireUser();
  const { symbol } = symbolInput.parse(await req.json());
  const agent = await db.agent.findUnique({ where: { slug } });
  if (!agent) throw new HttpError(404, "Agent not found");
  if (agent.ownerId !== user.id) throw new HttpError(403, "Only the publisher can launch this agent's token");
  const { launch, note } = await launchTokenForAgent(agent.id, symbol);
  return json({ launch, note }, 201);
});
