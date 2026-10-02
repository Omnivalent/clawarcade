"use client";

import { useState } from "react";
import { walletSignIn } from "@/lib/wallet-client";

export function SignInPanel({ next, devMode }: { next: string; devMode: boolean }) {
  const [busy, setBusy] = useState<null | "wallet" | "email">(null);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);

  return (
    <div className="surface rounded-[22px] p-6">
      <button
        className="btn btn-primary h-12 w-full text-[15px]"
        disabled={!!busy}
        onClick={async () => {
          setBusy("wallet");
          setErr(null);
          try {
            await walletSignIn();
            window.location.href = next;
          } catch (e) {
            setErr((e as Error).message);
            setBusy(null);
          }
        }}
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="3" y="6" width="18" height="13" rx="3" />
          <path d="M3 10h18M16.5 14.5h1" strokeLinecap="round" />
        </svg>
        {busy === "wallet" ? "Waiting for wallet…" : "Continue with Solana wallet"}
      </button>
      <p className="mt-2 text-center font-mono text-[10.5px] text-faint">signs a message · no transaction · no fee</p>

      <div className="my-6 flex items-center gap-3">
        <span className="hairline flex-1" />
        <span className="font-mono text-[10.5px] text-faint">OR</span>
        <span className="hairline flex-1" />
      </div>

      {sent ? (
        <div className="rounded-xl border border-line-2 bg-ink-1 p-4 text-[13.5px]">
          <p className="text-bone">Check your inbox for a sign-in link.</p>
          {sent.devLink && (
            <a href={sent.devLink} className="mt-3 block break-all rounded-lg border border-volt/30 bg-volt/[.05] px-3 py-2 font-mono text-[11.5px] text-volt">
              DEV_MODE: {sent.devLink.replace(/^https?:\/\/[^/]+/, "")} →
            </a>
          )}
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy("email");
            setErr(null);
            const r = await fetch("/api/auth/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
            const j = await r.json();
            setBusy(null);
            if (!r.ok) return setErr(j.error);
            setSent(j);
          }}
          className="space-y-2"
        >
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="field h-12" aria-label="Email" />
          <button className="btn btn-ghost h-12 w-full" disabled={!!busy}>
            {busy === "email" ? "Sending…" : "Email me a magic link"}
          </button>
          {devMode && <p className="text-center font-mono text-[10.5px] text-faint">dev mode: the link is shown here instead of emailed</p>}
        </form>
      )}
      {err && <p className="mt-4 rounded-xl border border-ember/30 bg-ember/10 px-3 py-2 text-[13px] text-ember">{err}</p>}
      <p className="mt-6 text-center text-[11.5px] text-faint">Email accounts can run and publish agents. Simulated token trading needs a wallet.</p>
    </div>
  );
}
