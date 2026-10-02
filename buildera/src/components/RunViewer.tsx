"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AgentGlyph } from "./AgentGlyph";
import { StatusPill } from "./StatusPill";
import type { LogEntry } from "@/lib/logs";
import { fmtBytes } from "@/lib/format";

type RunData = {
  id: string;
  status: string;
  prompt: string;
  logs: LogEntry[];
  files: { path: string; size: number }[];
  steps: number;
  summary: string | null;
  error: string | null;
  sandbox: string | null;
  creditsCharged: number;
  hasArtifact: boolean;
  fee: { creatorShare: number; tokenShare: number; platformShare: number; tokenSolAdded: number } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

const KIND_STYLE: Record<string, string> = {
  system: "text-mute",
  model: "text-bone",
  tool: "text-sky",
  result: "text-bone-2",
  shell: "text-bone",
  error: "text-ember",
  safety: "text-ember",
  fee: "text-volt",
};

type TreeNode = { name: string; path: string; size?: number; children?: TreeNode[] };

function buildTree(files: { path: string; size: number }[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const p = parts.slice(0, i + 1).join("/");
      let child = node.children!.find((c) => c.name === part);
      if (!child) {
        child = i === parts.length - 1 ? { name: part, path: p, size: f.size } : { name: part, path: p, children: [] };
        node.children!.push(child);
      }
      node = child;
    });
  }
  const sort = (n: TreeNode[]): TreeNode[] =>
    n.sort((a, b) => (a.children ? 0 : 1) - (b.children ? 0 : 1) || a.name.localeCompare(b.name)).map((c) => (c.children ? { ...c, children: sort(c.children) } : c));
  return sort(root.children!);
}

function Tree({ nodes, depth, selected, onSelect }: { nodes: TreeNode[]; depth: number; selected: string | null; onSelect: (p: string) => void }) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.path}>
          {n.children ? (
            <>
              <div className="flex items-center gap-2 py-1 text-mute" style={{ paddingLeft: depth * 14 + 10 }}>
                <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" opacity=".6"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.4l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z" /></svg>
                {n.name}
              </div>
              <Tree nodes={n.children} depth={depth + 1} selected={selected} onSelect={onSelect} />
            </>
          ) : (
            <button
              onClick={() => onSelect(n.path)}
              className={`flex w-full items-center gap-2 rounded-lg py-1 pr-2 text-left transition ${selected === n.path ? "bg-white/[.06] text-bone" : "text-bone-2 hover:bg-white/[.03]"}`}
              style={{ paddingLeft: depth * 14 + 10 }}
            >
              <span className={`size-1.5 shrink-0 rounded-full ${selected === n.path ? "bg-volt" : "bg-white/20"}`} />
              <span className="min-w-0 flex-1 truncate">{n.name}</span>
              <span className="shrink-0 text-[10px] text-faint">{fmtBytes(n.size ?? 0)}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RunViewer({ id, agent, initial }: { id: string; agent: { slug: string; name: string; accent: string; imageUrl: string | null }; initial: { status: string; prompt: string; createdAt: string } }) {
  const [run, setRun] = useState<RunData | null>(null);
  const [tab, setTab] = useState<"preview" | "files">("preview");
  const [selected, setSelected] = useState<string | null>(null);
  const [code, setCode] = useState<string>("");
  const [now, setNow] = useState(Date.now());
  const logRef = useRef<HTMLDivElement>(null);
  const status = run?.status ?? initial.status;
  const live = status === "queued" || status === "running";

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/runs/${id}`, { cache: "no-store" });
        if (r.ok) {
          const j: RunData = await r.json();
          if (!stop) setRun(j);
          if (j.status !== "queued" && j.status !== "running") return;
        }
      } catch {}
      if (!stop) timer = setTimeout(tick, 900);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run?.logs.length]);

  const files = useMemo(() => run?.files ?? [], [run?.files]);
  const tree = useMemo(() => buildTree(files), [files]);
  const hasIndex = files.some((f) => f.path === "index.html");

  useEffect(() => {
    if (run?.status === "completed" && !selected && files.length) {
      setSelected(files.find((f) => f.path === "index.html")?.path ?? files.find((f) => f.path !== "AGENTS.md")?.path ?? files[0].path);
      if (!files.some((f) => f.path === "index.html")) setTab("files");
    }
  }, [run?.status, files, selected]);

  useEffect(() => {
    if (!selected || !run?.hasArtifact) return;
    fetch(`/api/runs/${id}/files/${selected.split("/").map(encodeURIComponent).join("/")}?raw=1`)
      .then((r) => r.text())
      .then(setCode)
      .catch(() => setCode("// unable to load"));
  }, [selected, id, run?.hasArtifact]);

  const started = run?.startedAt ? new Date(run.startedAt).getTime() : null;
  const ended = run?.finishedAt ? new Date(run.finishedAt).getTime() : null;
  const elapsed = started ? ((ended ?? now) - started) / 1000 : 0;

  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-8 sm:px-6">
      <div className="flex flex-wrap items-center gap-3 font-mono text-[11.5px] text-mute">
        <Link href={`/agent/${agent.slug}`} className="flex items-center gap-2 hover:text-bone">
          <AgentGlyph seed={agent.slug} accent={agent.accent} imageUrl={agent.imageUrl} className="size-5" />
          {agent.name}
        </Link>
        <span className="text-faint">/</span>
        <span>run {id.slice(-8)}</span>
      </div>

      <header className="mt-5 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[34px]">{run?.prompt ?? initial.prompt}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusPill status={status} />
            <span className="chip h-6">{elapsed.toFixed(1)}s</span>
            <span className="chip h-6">{run?.steps ?? 0}/25 steps</span>
            <span className="chip h-6">{run?.creditsCharged ?? 0} cr</span>
            {run?.sandbox && <span className="chip h-6">sandbox: {run.sandbox}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/agent/${agent.slug}`} className="btn btn-ghost">
            Run again
          </Link>
          {run?.hasArtifact && (
            <a href={`/api/runs/${id}/download`} className="btn btn-primary" download>
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 2.5v8m0 0L4.8 7.3M8 10.5l3.2-3.2M2.5 13.5h11" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Download zip
            </a>
          )}
        </div>
      </header>

      {run?.summary && (
        <div className="mt-6 flex gap-4 rounded-[18px] border border-volt/20 bg-volt/[.04] p-4">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-volt text-[12px] text-ink">✓</span>
          <div className="min-w-0">
            <p className="text-[14.5px] leading-relaxed text-bone">{run.summary}</p>
            {run.fee && (
              <p className="mt-2 font-mono text-[11px] text-mute">
                settled · creator <span className="text-volt">{run.fee.creatorShare}</span> · token reserve <span className="text-sky">{run.fee.tokenShare}</span>
                {run.fee.tokenSolAdded > 0 && <> (+{run.fee.tokenSolAdded.toFixed(3)} vSOL)</>} · platform <span className="text-bone-2">{run.fee.platformShare}</span>
              </p>
            )}
          </div>
        </div>
      )}
      {(status === "failed" || status === "rejected") && run?.error && (
        <div className="mt-6 rounded-[18px] border border-ember/25 bg-ember/[.05] p-4 text-[14px] text-ember">
          {run.error} {status === "rejected" ? "— no output was stored and no credits were charged." : "— credits were refunded."}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className="surface flex h-[620px] flex-col overflow-hidden rounded-[20px]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="eyebrow">Live log</p>
            {live && (
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-sky">
                <span className="live-dot size-1.5 rounded-full bg-sky" /> streaming
              </span>
            )}
          </div>
          <div ref={logRef} className="scroll-thin flex-1 overflow-y-auto p-4 font-mono text-[12px] leading-[1.7]">
            {(run?.logs ?? []).map((l, i) => (
              <div key={i} className="flex gap-3 rise" style={{ animationDuration: ".4s" }}>
                <span className="w-12 shrink-0 text-right text-faint">{(l.t / 1000).toFixed(1)}s</span>
                <span className={`w-12 shrink-0 ${KIND_STYLE[l.kind] ?? "text-mute"}`}>{l.kind}</span>
                <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${l.kind === "error" || l.kind === "safety" ? "text-ember" : l.kind === "fee" ? "text-volt" : "text-bone-2"}`}>{l.text}</span>
              </div>
            ))}
            {live && (
              <div className="flex gap-3">
                <span className="w-12" />
                <span className="caret text-volt">▍</span>
              </div>
            )}
          </div>
        </section>

        <section className="surface flex h-[620px] flex-col overflow-hidden rounded-[20px]">
          <div className="flex items-center gap-1 border-b border-line px-2 py-2">
            {(["preview", "files"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`h-8 rounded-full px-3.5 text-[13px] capitalize transition ${tab === t ? "bg-white/[.07] text-bone" : "text-mute hover:text-bone"}`}>
                {t}
                {t === "files" && files.length > 0 && <span className="ml-1.5 font-mono text-[10.5px] text-faint">{files.length}</span>}
              </button>
            ))}
            {tab === "preview" && hasIndex && run?.hasArtifact && (
              <a href={`/api/runs/${id}/files/index.html`} target="_blank" rel="noreferrer" className="ml-auto px-3 font-mono text-[11px] text-mute hover:text-bone">
                open ↗
              </a>
            )}
          </div>

          {!run?.hasArtifact ? (
            <div className="grid flex-1 place-items-center p-10 text-center">
              {live ? (
                <div>
                  <div className="mx-auto grid w-40 grid-cols-6 gap-1.5">
                    {Array.from({ length: 18 }).map((_, i) => (
                      <span key={i} className="live-dot aspect-square rounded-[3px] bg-volt/70" style={{ animationDelay: `${(i % 6) * 0.12 + Math.floor(i / 6) * 0.2}s` }} />
                    ))}
                  </div>
                  <p className="mt-6 text-[14px] text-bone-2">The agent is building…</p>
                  <p className="mt-1 font-mono text-[11px] text-faint">files appear here when the run is packaged</p>
                </div>
              ) : (
                <p className="text-[14px] text-mute">No artifact for this run.</p>
              )}
            </div>
          ) : tab === "preview" ? (
            hasIndex ? (
              <div className="flex-1 bg-white">
                <iframe title="Preview" src={`/api/runs/${id}/files/index.html`} sandbox="allow-scripts allow-forms" className="size-full border-0" />
              </div>
            ) : (
              <div className="grid flex-1 place-items-center p-10 text-center">
                <div>
                  <p className="text-[14px] text-bone-2">No index.html to preview.</p>
                  <p className="mt-1 text-[13px] text-mute">This looks like a service — browse the files or download the zip.</p>
                  <button onClick={() => setTab("files")} className="btn btn-ghost mt-5">
                    Browse files
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr]">
              <div className="scroll-thin overflow-y-auto border-r border-line py-2 pr-2 font-mono text-[12px]">
                <Tree nodes={tree} depth={0} selected={selected} onSelect={setSelected} />
              </div>
              <div className="flex min-w-0 flex-col">
                <div className="border-b border-line px-4 py-2 font-mono text-[11px] text-mute">{selected}</div>
                <pre className="scroll-thin min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px] leading-[1.65] text-bone-2">
                  {code.split("\n").map((ln, i) => (
                    <div key={i} className="flex">
                      <span className="w-10 shrink-0 select-none pr-4 text-right text-faint">{i + 1}</span>
                      <span className="whitespace-pre">{ln}</span>
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
