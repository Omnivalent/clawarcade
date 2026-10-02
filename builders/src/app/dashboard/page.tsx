import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { env, ECONOMICS } from "@/lib/config";
import { platformAddress } from "@/lib/solana";
import { catalog } from "@/lib/queries";
import { AgentCard } from "@/components/AgentCard";
import { CreditsPanel } from "@/components/CreditsPanel";
import { StatusPill } from "@/components/StatusPill";
import { fmtNum, fmtPerM, shortAddr, timeAgo } from "@/lib/format";
import { priceOf } from "@/lib/amm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = await getUser();
  if (!user) redirect("/signin?next=/dashboard");

  const [agents, runs, earningsByAgent, launches, balances] = await Promise.all([
    catalog({ ownerId: user.id }),
    db.run.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10, include: { agent: { select: { slug: true, name: true } } } }),
    db.feeLedger.groupBy({ by: ["agentId"], where: { run: { agent: { ownerId: user.id } } }, _sum: { creatorShare: true, tokenShare: true }, _count: true }),
    db.tokenLaunch.findMany({ where: { agent: { ownerId: user.id } }, include: { agent: { select: { slug: true, name: true } } }, orderBy: { createdAt: "desc" } }),
    db.tokenBalance.findMany({ where: { userId: user.id, amount: { gt: 0 } } }),
  ]);
  const agentIds = await db.agent.findMany({ where: { ownerId: user.id }, select: { id: true, slug: true, name: true } });
  const earnRows = agentIds.map((a) => {
    const e = earningsByAgent.find((x) => x.agentId === a.id);
    return { ...a, runs: e?._count ?? 0, creator: e?._sum.creatorShare ?? 0, token: e?._sum.tokenShare ?? 0 };
  });
  const balMints = await db.tokenLaunch.findMany({ where: { mint: { in: balances.map((b) => b.mint) } } });

  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-14 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 className="mt-3 text-[44px] font-semibold leading-none tracking-[-0.04em]">
            {user.handle ?? (user.wallet ? shortAddr(user.wallet, 5) : user.email)}
          </h1>
        </div>
        <Link href="/create" className="btn btn-primary">
          + Publish agent
        </Link>
      </div>

      <div className="mt-10">
        <CreditsPanel
          credits={user.credits}
          simSol={user.simSol}
          earned={user.earnedCredits}
          wallet={user.wallet}
          vault={platformAddress()}
          rpc={env.solanaRpc}
          creditsPerSol={ECONOMICS.creditsPerSol}
          devMode={env.devMode}
        />
      </div>

      <section className="mt-16">
        <div className="flex items-end justify-between">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">My agents</h2>
          <span className="font-mono text-[11px] text-mute">{agents.length} published</span>
        </div>
        {agents.length ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a, i) => (
              <AgentCard key={a.slug} a={a} index={i} />
            ))}
          </div>
        ) : (
          <div className="surface mt-5 rounded-[20px] p-8 text-center text-[14px] text-mute">
            You haven&apos;t published an agent yet. <Link href="/create" className="text-volt">Publish one →</Link>
          </div>
        )}
      </section>

      <div className="mt-16 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Run earnings</h2>
          <div className="mt-4 overflow-hidden rounded-[18px] border border-line">
            <table className="w-full text-left text-[13.5px]">
              <thead className="font-mono text-[10.5px] uppercase tracking-wider text-faint">
                <tr className="border-b border-line">
                  <th className="px-4 py-3 font-normal">Agent</th>
                  <th className="px-4 py-3 text-right font-normal">Runs</th>
                  <th className="px-4 py-3 text-right font-normal">You (70%)</th>
                  <th className="px-4 py-3 text-right font-normal">Token (20%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {earnRows.length ? (
                  earnRows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3"><Link href={`/agent/${r.slug}`} className="hover:text-volt">{r.name}</Link></td>
                      <td className="px-4 py-3 text-right font-mono text-bone-2">{r.runs}</td>
                      <td className="px-4 py-3 text-right font-mono text-volt">{fmtNum(r.creator)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sky">{fmtNum(r.token)}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-mute">No earnings yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Token mints</h2>
          <div className="mt-4 space-y-2">
            {launches.length ? (
              launches.map((l) => (
                <Link key={l.id} href={`/agent/${l.agent.slug}`} className="surface flex items-center gap-4 rounded-[16px] px-4 py-3 transition hover:border-white/15">
                  <span className="chip h-6 border-volt/30 text-volt">${l.symbol}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-mute">
                    {shortAddr(l.mint, 6)} · {l.onChain ? "devnet" : "off-chain"}
                  </span>
                  <span className="font-mono text-[12px]">{fmtPerM(priceOf(l.virtualSolReserve, l.virtualTokenReserve))} SOL/1M</span>
                </Link>
              ))
            ) : (
              <p className="surface rounded-[16px] px-4 py-6 text-center text-[14px] text-mute">No tokens launched.</p>
            )}
          </div>
          {balances.length > 0 && (
            <>
              <h3 className="eyebrow mt-8">Simulated holdings</h3>
              <ul className="mt-3 space-y-1.5 font-mono text-[12.5px]">
                {balances.map((b) => {
                  const l = balMints.find((m) => m.mint === b.mint);
                  return (
                    <li key={b.id} className="flex justify-between rounded-xl border border-line px-4 py-2.5">
                      <span className="text-volt">${l?.symbol}</span>
                      <span className="text-bone-2">{fmtNum(b.amount, 2)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="mt-16">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">My runs</h2>
        {runs.length ? (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-[18px] border border-line">
            {runs.map((r) => (
              <li key={r.id}>
                <Link href={`/agent/${r.agent.slug}/run/${r.id}`} className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/[.02]">
                  <StatusPill status={r.status} />
                  <span className="hidden w-40 shrink-0 truncate text-[13px] text-mute sm:block">{r.agent.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-bone-2">{r.prompt}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">{r.creditsCharged} cr · {timeAgo(r.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-[14px] text-mute">No runs yet.</p>
        )}
      </section>
    </div>
  );
}
