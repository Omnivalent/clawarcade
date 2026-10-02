import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const run = await db.run.findUnique({
    where: { id },
    include: { agent: { select: { slug: true, name: true } }, fee: true },
  });
  if (!run) throw new HttpError(404, "Run not found");
  return json({
    id: run.id,
    agent: run.agent,
    prompt: run.prompt,
    status: run.status,
    logs: run.logs,
    files: run.files,
    steps: run.steps,
    summary: run.summary,
    error: run.error,
    sandbox: run.sandbox,
    creditsCharged: run.creditsCharged,
    hasArtifact: !!run.artifactUrl,
    fee: run.fee,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  });
});
