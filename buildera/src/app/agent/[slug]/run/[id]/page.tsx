import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { RunViewer } from "@/components/RunViewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const run = await db.run.findUnique({ where: { id }, include: { agent: true } });
  if (!run || run.agent.slug !== slug) notFound();
  return (
    <RunViewer
      id={run.id}
      agent={{ slug: run.agent.slug, name: run.agent.name, accent: run.agent.accent, imageUrl: run.agent.imageUrl }}
      initial={{ status: run.status, prompt: run.prompt, createdAt: run.createdAt.toISOString() }}
    />
  );
}
