import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { AgentGlyph } from "@/components/AgentGlyph";
import { RunForm } from "@/components/RunForm";
import { LaunchTokenForm, TokenPanel } from "@/components/TokenPanel";
import { StatusPill } from "@/components/StatusPill";
import { modelLabel } from "@/lib/models";
import { fmtNum, shortAddr, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = await db.agent.findUnique({ where: { slug } });
  return a ? { title: a.name, description: a.tagline || a.description } : {};
}

const SUGGEST: Record<string, string[]> = {
  default: ["Build a one-page todo app", "A landing page for a coffee subscription", "A static metrics dashboard"],
};

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await db.agent.findUnique({
    where: { slug },
    include: {
      owner: true,
      token: { include: { prices: { orderBy: { createdAt: "asc" }, take: 300 } } },
      runs: { orderBy: { createdAt: "desc" }, take: 8, select: { id: true, prompt: true, status: true, createdAt: true, steps: true } },
    },
  });
  if (!agent) notFound();
  const user = await getUser();
  const balance = user && agent.token ? await db.tokenBalance.findUnique({ where: { userId_mint: { userId: user.id, mint: agent.token.mint } } }) : null;
  const isOwner = user?.id === agent.ownerId;
  const suggestions: string[] = (agent.description.match(/Try: (.+)$/m)?.[1].split(" | ") ?? SUGGEST.default).slice(0, 3);
  const publisher = agent.owner.handle ?? (agent.owner.wallet ? shortAddr(agent.owner.wallet) : agent.owner.email?.split("@")[0] ?? "anon");

  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-10 sm:px-6">
      <nav className="font-mono text-[11.5px] text-mute">
        <Link href="/" className="hover:text-bone">agents</Link> <span className="text-faint">/</span> <span className="text-bone-2">{agent.slug}</span>
      </nav>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <header className="flex items-start gap-5 rise">
            <AgentGlyph seed={agent.slug} accent={agent.accent} imageUrl={agent.imageUrl} className="size-[72px]" />
            <div className="min-w-0">
              <h1 className="text-[40px] font-semibold leading-none tracking-[-0.04em]">{agent.name}</h1>
              <p className="mt-3 text-[16px] text-bone-2">{agent.tagline}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <span className="chip">{modelLabel(agent.model)}</span>
                <span className="chip">
                  <span className="text-volt">◆</span> {agent.priceCredits} cr / run
                </span>
                <span className="chip">{fmtNum(agent.runCount)} runs</span>
                <span className="chip">by {publisher}</span>
                {agent.token && <span className="chip border-volt/30 text-volt">${agent.token.symbol}</span>}
              </div>
            </div>
          </header>

          <section className="mt-10 rise" style={{ animationDelay: "80ms" }}>
            <RunForm slug={agent.slug} price={agent.priceCredits} signedIn={!!user} credits={user?.credits ?? 0} suggestions={suggestions} />
          </section>

          <section className="mt-14 grid gap-10 md:grid-cols-[1fr_1fr]">
            <div>
              <p className="eyebrow">About</p>
              <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-bone-2">{agent.description.replace(/\n?Try: .+$/m, "")}</p>
              <p className="eyebrow mt-10">Tools</p>
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {agent.toolsEnabled.map((t) => (
                  <li key={t} className="chip h-7 px-2.5">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <p className="eyebrow">System prompt</p>
                <span className="font-mono text-[10.5px] text-faint">{agent.systemPrompt.length} chars · AGENTS.md</span>
              </div>
              <div className="relative mt-4 max-h-[260px] overflow-hidden rounded-[16px] border border-line bg-ink-1">
                <pre className="whitespace-pre-wrap p-4 font-mono text-[12px] leading-relaxed text-bone-2">{agent.systemPrompt}</pre>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-ink-1 to-transparent" />
              </div>
            </div>
          </section>

          <section className="mt-14">
            <p className="eyebrow">Recent runs</p>
            {agent.runs.length ? (
              <ul className="mt-4 divide-y divide-line overflow-hidden rounded-[16px] border border-line">
                {agent.runs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/agent/${agent.slug}/run/${r.id}`} className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/[.02]">
                      <StatusPill status={r.status} />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-bone-2">{r.prompt}</span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">{timeAgo(r.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-[14px] text-mute">No runs yet — be the first.</p>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {agent.token ? (
            <TokenPanel
              launch={{
                ...agent.token,
                supply: agent.token.supply.toString(),
                prices: agent.token.prices.map((p) => ({ price: p.price, source: p.source, createdAt: p.createdAt.toISOString() })),
              }}
              viewer={{ signedIn: !!user, wallet: !!user?.wallet, simSol: user?.simSol ?? 0, balance: balance?.amount ?? 0 }}
            />
          ) : isOwner ? (
            <LaunchTokenForm slug={agent.slug} defaultSymbol={agent.name.replace(/[^A-Za-z]/g, "").slice(0, 5).toUpperCase()} />
          ) : (
            <div className="surface rounded-[22px] p-5">
              <p className="eyebrow">Agent token</p>
              <p className="mt-3 text-[14px] text-mute">This agent has no token. 20% of its run fees accrue to a token reserve the publisher can launch later.</p>
            </div>
          )}
          <div className="surface rounded-[22px] p-5 font-mono text-[11.5px]">
            <p className="eyebrow">Run limits</p>
            <dl className="mt-3 space-y-2">
              {[
                ["steps", "25 max"],
                ["wall clock", "4 min"],
                ["credit cap", `${agent.priceCredits} cr`],
                ["shell", "npm · node · python · pytest"],
                ["network", "package registries only"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-faint">{k}</dt>
                  <dd className="text-bone-2">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
