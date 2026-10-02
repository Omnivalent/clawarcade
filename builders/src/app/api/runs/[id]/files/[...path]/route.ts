import JSZip from "jszip";
import { db } from "@/lib/db";
import { getArtifact } from "@/lib/storage";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
};

// Small per-process cache so a preview's sub-resources don't re-read the zip each time.
const cache = new Map<string, JSZip>();

/**
 * Serves files from a run's artifact. Generated code is untrusted, so responses carry
 * a CSP sandbox (opaque origin, no access to Builders cookies or APIs). `?raw=1`
 * forces text/plain for the code viewer.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await ctx.params;
  const rel = path.map(decodeURIComponent).join("/");
  if (rel.includes("..")) return new Response("Bad path", { status: 400 });

  let zip = cache.get(id);
  if (!zip) {
    const run = await db.run.findUnique({ where: { id }, select: { artifactUrl: true } });
    if (!run?.artifactUrl) return new Response("Not found", { status: 404 });
    const buf = await getArtifact(run.artifactUrl);
    if (!buf) return new Response("Not found", { status: 404 });
    zip = await JSZip.loadAsync(buf);
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
    cache.set(id, zip);
  }
  const file = zip.file(rel);
  if (!file) return new Response("Not found", { status: 404 });
  const bytes = await file.async("uint8array");
  const raw = new URL(req.url).searchParams.has("raw");
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": raw ? "text/plain; charset=utf-8" : TYPES[ext] ?? "text/plain; charset=utf-8",
      "content-security-policy": "sandbox allow-scripts allow-forms; default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=600",
    },
  });
}
