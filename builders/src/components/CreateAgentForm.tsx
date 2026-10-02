"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MODEL_OPTIONS, TOOL_OPTIONS } from "@/lib/models";
import { ACCENTS, slugify } from "@/lib/agents";
import { AgentGlyph } from "./AgentGlyph";

const TEMPLATE = `You are a senior front-end engineer who ships polished, dependency-free web projects.

- Start by writing index.html at the workspace root, then styles and scripts.
- Use semantic HTML, accessible labels and a responsive layout.
- Keep everything static unless the user asks for a backend.
- Finish with a README.md explaining how to run the project.`;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-bone">{label}</span>
        {hint && <span className="font-mono text-[10.5px] text-faint">{hint}</span>}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

export function CreateAgentForm() {
  const router = useRouter();
  const [f, setF] = useState({
    name: "",
    tagline: "",
    description: "",
    systemPrompt: TEMPLATE,
    model: MODEL_OPTIONS[1].id,
    priceCredits: 20,
    toolsEnabled: TOOL_OPTIONS.map((t) => t.id) as string[],
    imageUrl: "",
    accent: ACCENTS[0],
    symbol: "",
  });
  const [busy, setBusy] = useState<null | "publish" | "launch">(null);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const slug = slugify(f.name || "your-agent");

  async function submit(launch: boolean) {
    setErr(null);
    if (launch && !/^[A-Z0-9]{2,8}$/.test(f.symbol)) return setErr("Enter a 2–8 character token symbol to launch a token.");
    setBusy(launch ? "launch" : "publish");
    const r = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...f, launchToken: launch, symbol: launch ? f.symbol : undefined }),
    });
    const j = await r.json();
    if (!r.ok) {
      setBusy(null);
      return setErr(j.error ?? "Could not publish");
    }
    if (j.tokenError) alert(`Agent published, but the token launch failed: ${j.tokenError}\nYou can retry from the agent page.`);
    router.push(`/agent/${j.agent.slug}`);
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-10 lg:grid-cols-[1fr_360px]">
      <div className="space-y-10">
        <section className="surface space-y-5 rounded-[22px] p-6">
          <p className="eyebrow">01 · Identity</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" hint={`/agent/${slug}`}>
              <input className="field" required maxLength={48} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Landing Forge" />
            </Field>
            <Field label="Tagline" hint={`${f.tagline.length}/90`}>
              <input className="field" maxLength={90} value={f.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Conversion-ready landing pages in one run" />
            </Field>
          </div>
          <Field label="Description">
            <textarea className="field min-h-[96px]" required value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What does this agent build well? What should people ask it for?" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
            <Field label="Image URL" hint="optional · https">
              <input className="field" value={f.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://… (leave empty for a generated glyph)" />
            </Field>
            <Field label="Accent">
              <span className="flex h-[46px] items-center gap-2">
                {ACCENTS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => set("accent", c)}
                    aria-label={`Accent ${c}`}
                    className={`size-7 rounded-full transition ${f.accent === c ? "ring-2 ring-bone ring-offset-2 ring-offset-ink" : "opacity-70 hover:opacity-100"}`}
                    style={{ background: c }}
                  />
                ))}
              </span>
            </Field>
          </div>
        </section>

        <section className="surface space-y-5 rounded-[22px] p-6">
          <p className="eyebrow">02 · Behaviour</p>
          <Field label="System prompt" hint={`${f.systemPrompt.length}/8000 · becomes AGENTS.md`}>
            <textarea className="field min-h-[220px] font-mono text-[12.5px] leading-relaxed" required maxLength={8000} value={f.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} />
          </Field>
          <div>
            <span className="text-[13px] font-medium">Model</span>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {MODEL_OPTIONS.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => set("model", m.id)}
                  className={`rounded-[14px] border p-3.5 text-left transition ${f.model === m.id ? "border-volt/50 bg-volt/[.05]" : "border-line-2 hover:border-white/20"}`}
                >
                  <span className="flex items-center justify-between">
                    <span className="text-[14px] font-medium">{m.label}</span>
                    <span className={`size-3.5 rounded-full border ${f.model === m.id ? "border-volt bg-volt shadow-[inset_0_0_0_3px_var(--color-ink)]" : "border-line-2"}`} />
                  </span>
                  <span className="mt-1 block text-[12px] text-mute">{m.note}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[13px] font-medium">Tools</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {TOOL_OPTIONS.map((t) => {
                const on = f.toolsEnabled.includes(t.id);
                const locked = t.id === "finish";
                return (
                  <button
                    type="button"
                    key={t.id}
                    title={t.note}
                    disabled={locked}
                    onClick={() => set("toolsEnabled", on ? f.toolsEnabled.filter((x) => x !== t.id) : [...f.toolsEnabled, t.id])}
                    className={`h-9 rounded-full border px-3.5 font-mono text-[12px] transition ${on ? "border-volt/40 bg-volt/[.06] text-bone" : "border-line-2 text-mute"} ${locked ? "cursor-default" : ""}`}
                  >
                    {on ? "✓ " : ""}
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="surface space-y-5 rounded-[22px] p-6">
          <p className="eyebrow">03 · Economics</p>
          <Field label="Price per run" hint="1–500 credits · also the run's hard credit cap">
            <div className="flex items-center gap-4">
              <input type="range" min={1} max={200} value={f.priceCredits} onChange={(e) => set("priceCredits", Number(e.target.value))} className="flex-1 accent-[var(--color-volt)]" />
              <input type="number" min={1} max={500} value={f.priceCredits} onChange={(e) => set("priceCredits", Math.max(1, Math.min(500, Number(e.target.value) || 1)))} className="field !w-24 shrink-0 text-right font-mono" />
            </div>
          </Field>
          <div className="grid grid-cols-3 gap-2 font-mono text-[11.5px]">
            {[
              ["you", 0.7, "text-volt"],
              ["token reserve", 0.2, "text-sky"],
              ["platform", 0.1, "text-bone-2"],
            ].map(([k, s, c]) => (
              <div key={k as string} className="rounded-xl border border-line bg-ink-1 px-3 py-2.5">
                <p className="text-faint">{k as string}</p>
                <p className={`mt-1 text-[15px] ${c}`}>{Math.floor(f.priceCredits * (s as number))} cr</p>
              </div>
            ))}
          </div>
          <Field label="Token symbol" hint="only for “Publish and launch token”">
            <div className="flex items-center rounded-xl border border-line-2 bg-ink-1 pl-3.5">
              <span className="font-mono text-mute">$</span>
              <input className="h-[46px] min-w-0 flex-1 bg-transparent px-1 font-mono outline-none" value={f.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} placeholder="FORGE" />
              <span className="pr-3.5 font-mono text-[10.5px] text-ember">devnet · simulated liquidity</span>
            </div>
          </Field>
        </section>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="eyebrow mb-3">Preview</p>
        <div className="surface rounded-[20px] p-5">
          <div className="flex items-start gap-4">
            {f.imageUrl.startsWith("https://") ? (
              <AgentGlyph seed={slug} accent={f.accent} imageUrl={f.imageUrl} className="size-12" />
            ) : (
              <AgentGlyph seed={slug} accent={f.accent} className="size-12" />
            )}
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-[16px] font-semibold">
                {f.name || "Your agent"}
                {f.symbol && <span className="chip h-5 border-volt/30 px-1.5 text-[10px] text-volt">${f.symbol}</span>}
              </p>
              <p className="font-mono text-[11px] text-mute">{MODEL_OPTIONS.find((m) => m.id === f.model)?.label}</p>
            </div>
          </div>
          <p className="mt-4 line-clamp-2 min-h-[42px] text-[14px] leading-relaxed text-bone-2">{f.tagline || f.description || "A short line about what it builds."}</p>
          <div className="mt-5 flex gap-5 border-t border-line pt-4 font-mono text-[11px]">
            <div>
              <p className="text-faint">RUNS</p>
              <p className="mt-1 text-[13px]">0</p>
            </div>
            <div>
              <p className="text-faint">PRICE</p>
              <p className="mt-1 text-[13px]">
                {f.priceCredits}
                <span className="text-mute"> cr</span>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <button type="button" onClick={() => submit(false)} disabled={!!busy || !f.name || !f.description} className="btn btn-light h-11 w-full">
            {busy === "publish" ? "Publishing…" : "Publish"}
          </button>
          <button type="button" onClick={() => submit(true)} disabled={!!busy || !f.name || !f.description} className="btn btn-primary h-11 w-full">
            {busy === "launch" ? "Publishing & minting…" : "Publish and launch token"}
          </button>
          {err && <p className="rounded-xl border border-ember/30 bg-ember/10 px-3 py-2 text-[13px] text-ember">{err}</p>}
          <p className="pt-2 text-[11.5px] leading-relaxed text-faint">
            Agents are screened for malware, exploit and credential-theft instructions. Tokens are devnet SPL mints with fixed supply and simulated liquidity; they carry no monetary value.
          </p>
        </div>
      </aside>
    </form>
  );
}
