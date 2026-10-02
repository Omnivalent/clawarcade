"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getWallet } from "@/lib/wallet-client";
import { fmtNum } from "@/lib/format";

export function CreditsPanel({ credits, simSol, earned, wallet, vault, rpc, creditsPerSol, devMode }: { credits: number; simSol: number; earned: number; wallet: string | null; vault: string | null; rpc: string; creditsPerSol: number; devMode: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sol, setSol] = useState("0.1");

  async function faucet() {
    setBusy("faucet");
    const r = await fetch("/api/credits/faucet", { method: "POST" });
    const j = await r.json();
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: "Faucet: +200 credits, +2 sim SOL" } : { ok: false, text: j.error });
    router.refresh();
  }

  async function deposit() {
    if (!vault || !wallet) return;
    setBusy("deposit");
    setMsg(null);
    try {
      const w = getWallet();
      if (!w?.signAndSendTransaction) throw new Error("Wallet does not support signAndSendTransaction");
      const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
      const conn = new Connection(rpc, "confirmed");
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: new PublicKey(wallet), toPubkey: new PublicKey(vault), lamports: Math.round(Number(sol) * LAMPORTS_PER_SOL) }));
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = new PublicKey(wallet);
      const { signature } = await w.signAndSendTransaction(tx);
      await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      const r = await fetch("/api/credits/deposit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMsg({ ok: true, text: `Deposited ${sol} devnet SOL → +${j.credited} credits` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(null);
  }

  return (
    <div className="surface rounded-[22px] p-6">
      <div className="grid gap-6 sm:grid-cols-3">
        <div>
          <p className="eyebrow">Credits</p>
          <p className="mt-2 text-[40px] font-semibold leading-none tracking-[-0.04em]">
            {fmtNum(credits)}
            <span className="ml-1.5 font-mono text-[13px] font-normal text-mute">cr</span>
          </p>
        </div>
        <div>
          <p className="eyebrow">Creator earnings</p>
          <p className="mt-2 text-[40px] font-semibold leading-none tracking-[-0.04em] text-volt">
            {fmtNum(earned)}
            <span className="ml-1.5 font-mono text-[13px] font-normal text-mute">cr</span>
          </p>
        </div>
        <div>
          <p className="eyebrow">Sim SOL</p>
          <p className="mt-2 text-[40px] font-semibold leading-none tracking-[-0.04em]">
            {simSol.toFixed(2)}
            <span className="ml-1.5 font-mono text-[11px] font-normal text-ember">simulated</span>
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 border-t border-line pt-6 md:grid-cols-2">
        <div className="rounded-[16px] border border-line bg-ink-1 p-4">
          <p className="text-[14px] font-medium">Buy credits with devnet SOL</p>
          <p className="mt-1 text-[12.5px] text-mute">
            1 SOL = {fmtNum(creditsPerSol)} credits. {vault ? "Transfers to the platform vault are verified on devnet." : "Disabled: the server has no PLATFORM_KEYPAIR."}
          </p>
          <div className="mt-3 flex gap-2">
            <div className="flex flex-1 items-center rounded-xl border border-line-2 bg-ink px-3">
              <input value={sol} onChange={(e) => setSol(e.target.value.replace(/[^0-9.]/g, ""))} className="h-10 min-w-0 flex-1 bg-transparent font-mono outline-none" aria-label="SOL amount" />
              <span className="font-mono text-[11px] text-mute">SOL</span>
            </div>
            <button onClick={deposit} className="btn btn-light" disabled={!vault || !wallet || !!busy || !(Number(sol) > 0)}>
              {busy === "deposit" ? "Confirming…" : "Deposit"}
            </button>
          </div>
          {!wallet && <p className="mt-2 font-mono text-[10.5px] text-faint">wallet sign-in required</p>}
        </div>
        <div className="rounded-[16px] border border-line bg-ink-1 p-4">
          <p className="text-[14px] font-medium">Dev faucet</p>
          <p className="mt-1 text-[12.5px] text-mute">Free credits and simulated SOL for local testing. {devMode ? "" : "Disabled outside DEV_MODE."}</p>
          <button onClick={faucet} className="btn btn-ghost mt-3 w-full" disabled={!devMode || !!busy}>
            {busy === "faucet" ? "Dripping…" : "Get faucet credits"}
          </button>
        </div>
      </div>
      {msg && <p className={`mt-4 text-[13px] ${msg.ok ? "text-volt" : "text-ember"}`}>{msg.text}</p>}
    </div>
  );
}
