import { db } from "@/lib/db";
import { HttpError, requireUser } from "@/lib/auth";
import { agentInput, slugify, ACCENTS } from "@/lib/agents";
import { handle, json } from "@/lib/http";
import { screenPrompt } from "@/lib/safety";
import { launchTokenForAgent } from "@/lib/tokens";

export const GET = handle(async () => {
  const agents = await db.agent.findMany({
    where: { status: "published" },
    orderBy: [{ runCount: "desc" }, { createdAt: "desc" }],
    include: { token: { select: { symbol: true, mint: true, virtualSolReserve: true, virtualTokenReserve: true } } },
  });
  return json({ agents });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const input = agentInput.parse(await req.json());
  if (input.launchToken && !input.symbol) throw new HttpError(400, "A token symbol is required to launch a token");
  for (const text of [input.systemPrompt, input.description]) {
    const v = screenPrompt(text);
    if (!v.ok) throw new HttpError(422, `Agent rejected: content flagged for ${v.reason}`);
  }

  const base = slugify(input.name);
  let slug = base;
  for (let i = 2; await db.agent.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;

  const agent = await db.agent.create({
    data: {
      ownerId: user.id,
      slug,
      name: input.name,
      tagline: input.tagline,
      description: input.description,
      systemPrompt: input.systemPrompt,
      model: input.model,
      priceCredits: input.priceCredits,
      toolsEnabled: input.toolsEnabled,
      imageUrl: input.imageUrl,
      accent: input.accent ?? ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
    },
  });

  let token = null;
  let tokenError: string | null = null;
  if (input.launchToken && input.symbol) {
    try {
      token = await launchTokenForAgent(agent.id, input.symbol);
    } catch (e) {
      // The agent stays published; the publisher can retry the launch from the agent page.
      tokenError = (e as Error).message;
    }
  }
  return json({ agent, token: token?.launch ?? null, tokenNote: token?.note ?? null, tokenError }, 201);
});
