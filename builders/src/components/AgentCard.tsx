import Link from "next/link";
import { AgentGlyph } from "./AgentGlyph";
import { Sparkline } from "./Sparkline";
import { modelLabel } from "@/lib/models";
import { fmtCompact, fmtPerM } from "@/lib/format";

export type AgentCardData = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  accent: string;
  imageUrl: string | null;
  model: string;
  priceCredits: number;
  runCount: number;
  token: { symbol: string; price: number; change: number; series: number[] } | null;
};

export function AgentCard({ a, index = 0 }: { a: AgentCardData; index?: number }) {
  return (
    <Link
      href={`/agent/${a.slug}`}
      className="surface group relative flex flex-col overflow-hidden rounded-[20px] p-5 transition duration-500 ease-out-expo hover:-translate-y-0.5 hover:border-white/15 rise"
      style={{ animationDelay: `${80 + index * 60}ms` }}
    >
      <div
        className="pointer-events-none absolute -right-24 -top-24 size-56 rounded-full opacity-0 blur-3xl transition duration-700 group-hover:opacity-100"
        style={{ background: `${a.accent}22` }}
      />
      <div className="flex items-start gap-4">
        <AgentGlyph seed={a.slug} accent={a.accent} imageUrl={a.imageUrl} className="size-12" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{a.name}</h3>
            {a.token && <span className="chip h-5 border-volt/30 px-1.5 text-[10px] text-volt">${a.token.symbol}</span>}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-mute">{modelLabel(a.model)}</p>
        </div>
        <svg viewBox="0 0 16 16" className="size-4 -translate-x-1 text-faint opacity-0 transition duration-300 group-hover:translate-x-0 group-hover:opacity-100" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 12 12 4M5.5 4H12v6.5" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mt-4 line-clamp-2 min-h-[42px] text-[14px] leading-relaxed text-bone-2">{a.tagline || a.description}</p>

      <div className="mt-5 flex items-end justify-between gap-3 border-t border-line pt-4">
        <dl className="flex gap-5 font-mono text-[11px]">
          <div>
            <dt className="text-faint">RUNS</dt>
            <dd className="mt-1 text-[13px] text-bone">{fmtCompact(a.runCount)}</dd>
          </div>
          <div>
            <dt className="text-faint">PRICE</dt>
            <dd className="mt-1 text-[13px] text-bone">
              {a.priceCredits}
              <span className="text-mute"> cr</span>
            </dd>
          </div>
          {a.token && (
            <div>
              <dt className="text-faint">SOL/1M</dt>
              <dd className="mt-1 text-[13px] text-bone">
                {fmtPerM(a.token.price)}
                <span className={`ml-1.5 text-[11px] ${a.token.change >= 0 ? "text-volt" : "text-ember"}`}>
                  {a.token.change >= 0 ? "+" : ""}
                  {a.token.change.toFixed(1)}%
                </span>
              </dd>
            </div>
          )}
        </dl>
        {a.token ? (
          <Sparkline values={a.token.series} className="h-8 w-20" stroke={a.token.change >= 0 ? "var(--color-volt)" : "var(--color-ember)"} />
        ) : (
          <span className="font-mono text-[10.5px] text-faint">no token</span>
        )}
      </div>
    </Link>
  );
}
