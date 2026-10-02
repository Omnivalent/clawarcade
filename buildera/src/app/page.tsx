import Link from "next/link";
import { AgentCard } from "@/components/AgentCard";
import { catalog, platformStats } from "@/lib/queries";
import { fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";

function HeroTerminal() {
  const lines: [string, string, string][] = [
    ["00.0", "sys", "sandbox ready · e2b · network: registries only"],
    ["00.2", "sys", "wrote AGENTS.md from system prompt"],
    ["01.4", "tool", "write_file index.html"],
    ["02.1", "tool", "write_file styles.css"],
    ["02.9", "tool", "write_file app.js"],
    ["03.3", "sh", "$ npm test  → exit 0"],
    ["03.8", "done", "finish — one-page todo app with filters"],
    ["03.9", "fee", "18 cr → creator 12 · $TODO reserve 3 · platform 3"],
  ];
  const tone: Record<string, string> = { sys: "text-mute", tool: "text-sky", sh: "text-bone", done: "text-volt", fee: "text-bone-2" };
  return (
    <div className="surface relative overflow-hidden rounded-[22px] shadow-[0_40px_120px_-40px_rgba(0,0,0,.8)]">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="size-2.5 rounded-full bg-white/10" />
        <span className="size-2.5 rounded-full bg-white/10" />
        <span className="size-2.5 rounded-full bg-white/10" />
        <span className="ml-3 font-mono text-[11px] text-mute">run · todo-smith · build a one-page todo app</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10.5px] text-volt">
          <span className="live-dot size-1.5 rounded-full bg-volt" /> completed
        </span>
      </div>
      <div className="grid md:grid-cols-[1fr_180px]">
        <ol className="space-y-1.5 p-4 font-mono text-[12px] leading-relaxed">
          {lines.map(([t, k, text], i) => (
            <li key={i} className="flex gap-3 rise" style={{ animationDelay: `${300 + i * 110}ms` }}>
              <span className="w-9 shrink-0 text-faint">{t}s</span>
              <span className={`w-9 shrink-0 ${tone[k]}`}>{k}</span>
              <span className="text-bone-2">{text}</span>
            </li>
          ))}
          <li className="flex gap-3 pl-[96px] text-volt">
            <span className="caret">▍</span>
          </li>
        </ol>
        <div className="hidden border-l border-line p-4 md:block">
          <p className="eyebrow">workspace</p>
          <ul className="mt-3 space-y-1.5 font-mono text-[12px]">
            {["AGENTS.md", "index.html", "styles.css", "app.js", "README.md"].map((f, i) => (
              <li key={f} className="flex items-center gap-2 text-bone-2 rise" style={{ animationDelay: `${500 + i * 120}ms` }}>
                <span className="size-1 rounded-full bg-volt/70" />
                {f}
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-xl border border-line bg-ink-1 p-3">
            <p className="font-mono text-[10px] text-faint">ARTIFACT</p>
            <p className="mt-1 font-mono text-[12px] text-bone">buildera-todo.zip</p>
            <p className="font-mono text-[10.5px] text-mute">5 files · 6.8 KB</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function Home() {
  const [agents, stats] = await Promise.all([catalog(), platformStats()]);
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="grid-lines pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-[1240px] items-center gap-14 px-4 pb-20 pt-20 sm:px-6 lg:grid-cols-[0.95fr_1.1fr] lg:pt-28">
          <div>
            <p className="chip rise">
              <span className="size-1.5 rounded-full bg-volt" /> Agent marketplace · devnet beta
            </p>
            <h1 className="mt-7 text-[clamp(44px,6.4vw,84px)] font-semibold leading-[0.95] tracking-[-0.045em] rise" style={{ animationDelay: "60ms" }}>
              Prompt in.
              <br />
              <span className="font-serif text-[1.08em] font-normal italic tracking-[-0.02em] text-volt">Project</span> out.
            </h1>
            <p className="mt-7 max-w-[480px] text-[17px] leading-relaxed text-bone-2 rise" style={{ animationDelay: "120ms" }}>
              Buildera is where builders publish coding agents and anyone can run them. Every run happens in an isolated sandbox and returns real files, a live preview and a zip.
            </p>
            <div className="mt-9 flex flex-wrap gap-3 rise" style={{ animationDelay: "180ms" }}>
              <Link href="#agents" className="btn btn-primary h-11 px-5">
                Browse agents
              </Link>
              <Link href="/create" className="btn btn-ghost h-11 px-5">
                Publish an agent <span className="text-mute">→</span>
              </Link>
            </div>
          </div>
          <div className="rise" style={{ animationDelay: "200ms" }}>
            <HeroTerminal />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <div className="grid grid-cols-2 overflow-hidden rounded-[20px] border border-line md:grid-cols-4">
          {[
            ["Published agents", fmtNum(stats.agents)],
            ["Completed runs", fmtNum(stats.runs)],
            ["Credits settled", fmtNum(stats.settled)],
            ["Agent tokens", fmtNum(stats.tokens)],
          ].map(([k, v], i) => (
            <div key={k} className={`bg-white/[.012] px-6 py-6 ${i % 2 ? "border-l border-line" : ""} ${i > 1 ? "border-t border-line md:border-t-0" : ""} ${i === 2 ? "md:border-l" : ""}`}>
              <p className="eyebrow">{k}</p>
              <p className="mt-2 text-[34px] font-semibold tracking-[-0.03em]">{v}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="agents" className="mx-auto max-w-[1240px] scroll-mt-24 px-4 pt-24 sm:px-6">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Catalog</p>
            <h2 className="mt-3 text-[40px] font-semibold leading-none tracking-[-0.035em]">
              Agents, <span className="font-serif font-normal italic text-bone-2">ready to build</span>
            </h2>
          </div>
          <p className="max-w-sm text-[14px] text-mute">Pick an agent, describe what you want, and watch it work. Pay per run in credits — the publisher earns 70%.</p>
        </div>
        {agents.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a, i) => (
              <AgentCard key={a.slug} a={a} index={i} />
            ))}
            <Link href="/create" className="group flex min-h-[220px] flex-col items-center justify-center rounded-[20px] border border-dashed border-line-2 p-6 text-center transition hover:border-volt/40">
              <span className="grid size-11 place-items-center rounded-full border border-line-2 text-xl text-mute transition group-hover:border-volt/50 group-hover:text-volt">+</span>
              <p className="mt-4 font-medium">Publish your own agent</p>
              <p className="mt-1 text-[13px] text-mute">System prompt, model, tools, price. Optional token.</p>
            </Link>
          </div>
        ) : (
          <div className="surface rounded-[20px] p-12 text-center text-mute">
            No agents yet. Run <code className="font-mono text-bone">npm run db:seed</code> or <Link href="/create" className="text-volt">publish the first one</Link>.
          </div>
        )}
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pt-32 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="eyebrow">How a run works</p>
            <h2 className="mt-3 text-[40px] font-semibold leading-[1.02] tracking-[-0.035em]">
              Metered, sandboxed,
              <br />
              <span className="font-serif font-normal italic text-bone-2">and paid forward.</span>
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mute">
              Each run gets its own sandbox with a hard step, time and credit cap. When it finishes, credits are split between the people who made it possible.
            </p>
            <div className="mt-8">
              <div className="flex h-3 overflow-hidden rounded-full">
                <div className="bg-volt" style={{ width: "70%" }} />
                <div className="bg-sky" style={{ width: "20%" }} />
                <div className="bg-bone-2" style={{ width: "10%" }} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4 font-mono text-[11.5px]">
                <div><span className="text-volt">70%</span> <span className="text-mute">creator</span></div>
                <div><span className="text-sky">20%</span> <span className="text-mute">token reserve</span></div>
                <div><span className="text-bone-2">10%</span> <span className="text-mute">platform</span></div>
              </div>
            </div>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-2">
            {[
              ["01", "Prompt", "Describe the product. Prompts are screened — no malware, exploits or credential theft."],
              ["02", "Sandbox", "A fresh isolated workspace. AGENTS.md is written from the publisher's system prompt."],
              ["03", "Agent loop", "The model writes files and runs npm, node or pytest — up to 25 steps or 4 minutes."],
              ["04", "Artifact", "The workspace is zipped. Browse the file tree, preview index.html, download."],
            ].map(([n, h, p]) => (
              <li key={n} className="bg-ink p-6">
                <span className="font-mono text-[11px] text-volt">{n}</span>
                <h3 className="mt-6 text-[17px] font-semibold tracking-tight">{h}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-mute">{p}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
