import { db } from "@/lib/db";
import { getArtifact } from "@/lib/storage";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = await db.run.findUnique({ where: { id }, include: { agent: { select: { slug: true } } } });
  if (!run?.artifactUrl) return new Response("Not found", { status: 404 });
  const buf = await getArtifact(run.artifactUrl);
  if (!buf) return new Response("Artifact missing", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="buildera-${run.agent.slug}-${id.slice(-8)}.zip"`,
      "cache-control": "private, max-age=3600",
    },
  });
}
