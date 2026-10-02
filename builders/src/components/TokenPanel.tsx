"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PriceChart } from "./PriceChart";
import { fmtNum, fmtPerM, shortAddr } from "@/lib/format";

type Launch = {
  mint: string;
  symbol: string;
  name: string;
  supply: string;
  virtualSolReserve: number;
  virtualTokenReserve: number;
  onChain: boolean;
  launchTx: string | null;
  prices: { price: number; createdAt: string; source: string }[];
};

type Viewer = { signedIn: boolean; wallet: boolean; simSol: number; balance: number };

function Simulated() {
  return (
    <span className="chip h-6 border-ember/30 bg-ember/[.06] text-[10.5px] text-ember" title="Devnet only. Liquidity is simulated in Builders' database; no real swaps happen.">
      devnet · simulated liquidity
    </span>
  );
}

export function TokenPanel({ launch, viewer }: { launch: Launch; viewer: Viewer }) {
  const router = useRouter();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [q, setQ] = useState<{ amountOut: number; priceImpactPct: number; fee: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const price = launch.virtualSolReserve / launch.virtualTokenReserve;
  const first = launch.prices[0]?.price ?? price;
  const change = ((price - first) / first) * 100;
  const mcap = price * Number(launch.supply);

  useEffect(() => {
    const n = Number(amount);
    if (!(n > 0)) return setQ(null);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/tokens/${launch.mint}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ side, amount: n }) });
      setQ(r.ok ? await r.json() : null);
    }, 180);
    return () => clearTimeout(t);
  }, [amount, side, launch.mint]);

  async function swap(e: React.FormEvent) {
    e.preventDefault();
    if (!q) return;
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/tokens/${launch.mint}/swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side, amount: Number(amount), minOut: q.amountOut * 0.98 }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: j.error });
    setMsg({ ok: true, text: side === "buy" ? `Received ${fmtNum(j.quote.amountOut, 2)} ${launch.symbol} (simulated)` : `Received ${j.quote.amountOut.toFixed(4)} sim SOL` });
    setAmount("");
    router.refresh();
  }

  return (
    <div className="surface overflow-hidden rounded-[22px]">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <p className="eyebrow">Agent token</p>
          <p className="mt-1 text-[18px] font-semibold tracking-tight">${launch.symbol}</p>
        </div>
        <Simulated />
      </div>
      <div className="px-5 pt-5">
        <div className="flex items-baseline gap-3">
          <span className="text-[34px] font-semibold tracking-[-0.03em]">{fmtPerM(price)}</span>
          <span className="font-mono text-[12px] text-mute">SOL / 1M</span>
          <span className={`font-mono text-[12px] ${change >= 0 ? "text-volt" : "text-ember"}`}>
            {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
          </span>
        </div>
        <div className="mt-4">
          <PriceChart points={launch.prices} />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 font-mono text-[11px]">
          <div>
            <dt className="text-faint">vSOL</dt>
            <dd className="mt-1 text-bone">{launch.virtualSolReserve.toFixed(3)}</dd>
          </div>
          <div>
            <dt className="text-faint">vTOKENS</dt>
            <dd className="mt-1 text-bone">{fmtNum(launch.virtualTokenReserve / 1e6, 1)}M</dd>
          </div>
          <div>
            <dt className="text-faint">SIM MCAP</dt>
            <dd className="mt-1 text-bone">{fmtNum(mcap, 1)} SOL</dd>
          </div>
        </dl>
      </div>

      <form onSubmit={swap} className="m-5 rounded-[16px] border border-line bg-ink-1 p-3">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-ink-2 p-1">
          {(["buy", "sell"] as const).map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setSide(s)}
              className={`h-8 rounded-full text-[13px] font-medium capitalize transition ${side === s ? (s === "buy" ? "bg-volt text-ink" : "bg-ember text-ink") : "text-mute hover:text-bone"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-line-2 bg-ink px-3">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            className="h-12 min-w-0 flex-1 bg-transparent font-mono text-[18px] outline-none placeholder:text-faint"
            aria-label="Amount"
          />
          <span className="font-mono text-[12px] text-mute">{side === "buy" ? "sim SOL" : launch.symbol}</span>
        </div>
        <div className="mt-2 flex justify-between px-1 font-mono text-[11px] text-mute">
          <span>
            bal {side === "buy" ? `${viewer.simSol.toFixed(3)} sim SOL` : `${fmtNum(viewer.balance, 2)} ${launch.symbol}`}
          </span>
          {q && (
            <span className="text-bone-2">
              ≈ {side === "buy" ? `${fmtNum(q.amountOut, 2)} ${launch.symbol}` : `${q.amountOut.toFixed(5)} SOL`} · {q.priceImpactPct.toFixed(2)}% impact
            </span>
          )}
        </div>
        {viewer.signedIn && viewer.wallet ? (
          <button className={`btn mt-3 w-full ${side === "buy" ? "btn-primary" : "bg-ember text-ink"}`} disabled={!q || busy}>
            {busy ? "Swapping…" : `${side === "buy" ? "Buy" : "Sell"} ${launch.symbol} · simulated`}
          </button>
        ) : (
          <Link href="/signin" className="btn btn-ghost mt-3 w-full">
            {viewer.signedIn ? "Wallet sign-in required to trade" : "Sign in with a wallet to trade"}
          </Link>
        )}
        {msg && <p className={`mt-2 px-1 text-[12.5px] ${msg.ok ? "text-volt" : "text-ember"}`}>{msg.text}</p>}
      </form>

      <div className="space-y-2 border-t border-line px-5 py-4 font-mono text-[11.5px]">
        <div className="flex justify-between">
          <span className="text-faint">mint</span>
          {launch.onChain ? (
            <a href={`https://explorer.solana.com/address/${launch.mint}?cluster=devnet`} target="_blank" rel="noreferrer" className="text-sky hover:underline">
              {shortAddr(launch.mint, 6)} ↗
            </a>
          ) : (
            <span className="text-bone-2" title="Not on chain — PLATFORM_KEYPAIR was not configured at launch">
              {shortAddr(launch.mint, 6)} · off-chain
            </span>
          )}
        </div>
        <div className="flex justify-between">
          <span className="text-faint">supply</span>
          <span className="text-bone-2">{fmtNum(Number(launch.supply))} · mint authority revoked</span>
        </div>
        <p className="pt-1 font-sans text-[11.5px] leading-relaxed text-faint">
          Swaps only move Builders&apos;s internal reserves and balances. Devnet tokens have no monetary value. Nothing here is an offer or a promise of returns.
        </p>
      </div>
    </div>
  );
}

export function LaunchTokenForm({ slug, defaultSymbol }: { slug: string; defaultSymbol: string }) {
  const router = useRouter();
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="surface rounded-[22px] p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const r = await fetch(`/api/agents/${slug}/launch-token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol }) });
        const j = await r.json();
        setBusy(false);
        if (!r.ok) return setErr(j.error);
        router.refresh();
      }}
    >
      <div className="flex items-center justify-between">
        <p className="eyebrow">Agent token</p>
        <Simulated />
      </div>
      <h3 className="mt-3 text-[20px] font-semibold tracking-tight">Launch a token for this agent</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-mute">
        Creates an SPL mint on devnet (1B supply, 6 decimals), mints it to the platform vault and revokes mint authority. 20% of every run fee flows into its simulated reserve.
      </p>
      <div className="mt-4 flex gap-2">
        <div className="flex flex-1 items-center rounded-xl border border-line-2 bg-ink-1 pl-3">
          <span className="font-mono text-mute">$</span>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} className="h-10 min-w-0 flex-1 bg-transparent px-1 font-mono outline-none" aria-label="Symbol" />
        </div>
        <button className="btn btn-primary" disabled={busy || symbol.length < 2}>
          {busy ? "Launching…" : "Launch"}
        </button>
      </div>
      {err && <p className="mt-2 text-[12.5px] text-ember">{err}</p>}
    </form>
  );
}
