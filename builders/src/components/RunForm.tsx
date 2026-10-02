"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function RunForm({ slug, price, signedIn, credits, suggestions }: { slug: string; price: number; signedIn: boolean; credits: number; suggestions: string[] }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/agents/${slug}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      router.push(`/agent/${slug}/run/${j.id}`);
      return;
    }
    setBusy(false);
    setError(j.error ?? "Could not start the run");
  }

  return (
    <form onSubmit={submit} className="surface relative rounded-[22px] p-2">
      <label htmlFor="prompt" className="sr-only">
        What should this agent build?
      </label>
      <textarea
        id="prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
        }}
        rows={4}
        maxLength={4000}
        placeholder="Describe the product you want built…"
        className="block w-full resize-none rounded-[16px] bg-transparent px-4 py-3.5 text-[15.5px] leading-relaxed outline-none placeholder:text-faint"
      />
      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
        {suggestions.map((s) => (
          <button type="button" key={s} onClick={() => setPrompt(s)} className="chip h-7 px-2.5 text-[11.5px] transition hover:border-white/25 hover:text-bone">
            {s}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-3 pb-1.5 pt-3">
        <p className="font-mono text-[11px] text-mute">
          {signedIn ? (
            <>
              balance <span className="text-bone">{credits}</span> cr · ⌘↵ to run
            </>
          ) : (
            "sign in to run"
          )}
        </p>
        {signedIn ? (
          <button className="btn btn-primary" disabled={busy || !prompt.trim()}>
            {busy ? "Starting…" : <>Run <span className="font-mono text-[12px] opacity-70">· {price} cr</span></>}
          </button>
        ) : (
          <Link href={`/signin?next=/agent/${slug}`} className="btn btn-light">
            Sign in to run
          </Link>
        )}
      </div>
      {error && (
        <p className="mx-3 mb-2 rounded-xl border border-ember/30 bg-ember/10 px-3 py-2 text-[13px] text-ember">
          {error} {error.includes("credits") && <Link href="/dashboard" className="underline">Top up →</Link>}
        </p>
      )}
    </form>
  );
}
