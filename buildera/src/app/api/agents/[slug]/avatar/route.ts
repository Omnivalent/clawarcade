import { db } from "@/lib/db";
import { glyphSvg } from "@/lib/glyph";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const agent = await db.agent.findUnique({ where: { slug }, select: { accent: true } });
  return new Response(glyphSvg(slug, agent?.accent ?? "#d9ff5a"), {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
  });
}
