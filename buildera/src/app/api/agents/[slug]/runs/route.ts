import { z } from "zod";
import { after } from "next/server";
import { db } from "@/lib/db";
import { HttpError, requireUser } from "@/lib/auth";
import { LIMITS } from "@/lib/config";
import { handle, json } from "@/lib/http";
import { screenPrompt } from "@/lib/safety";
import { executeRun } from "@/lib/runner";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const user = await requireUser();
  const { prompt } = z.object({ prompt: z.string().trim().min(3).max(LIMITS.maxPromptChars) }).parse(await req.json());

  const agent = await db.agent.findUnique({ where: { slug } });
  if (!agent || agent.status !== "published") throw new HttpError(404, "Agent not found");

  const verdict = screenPrompt(prompt);
  if (!verdict.ok) {
    // Record the rejection (no output, no charge) so it is auditable.
    const run = await db.run.create({
      data: {
        agentId: agent.id,
        userId: user.id,
        prompt: "[redacted: rejected by safety screen]",
        status: "rejected",
        error: `Rejected: ${verdict.reason}`,
        logs: [{ t: 0, kind: "safety", text: `Prompt rejected (${verdict.reason}). Buildera does not build malware, exploits or credential-theft tools. Nothing was run or stored.` }],
        finishedAt: new Date(),
      },
    });
    return json({ id: run.id, status: "rejected", error: `Prompt rejected: ${verdict.reason}` }, 422);
  }

  const active = await db.run.count({ where: { userId: user.id, status: { in: ["queued", "running"] } } });
  if (active >= LIMITS.maxConcurrentRunsPerUser) throw new HttpError(429, "You already have runs in progress — wait for one to finish");

  const price = Math.min(agent.priceCredits, LIMITS.maxPriceCredits);
  const run = await db.$transaction(async (tx) => {
    const charged = await tx.user.updateMany({ where: { id: user.id, credits: { gte: price } }, data: { credits: { decrement: price } } });
    if (charged.count === 0) throw new HttpError(402, `This agent costs ${price} credits. Top up on your dashboard.`);
    return tx.run.create({ data: { agentId: agent.id, userId: user.id, prompt, status: "queued", creditsCharged: price } });
  });

  after(() => executeRun(run.id).catch((e) => console.error("run crashed", run.id, e)));
  return json({ id: run.id, status: run.status }, 202);
});
