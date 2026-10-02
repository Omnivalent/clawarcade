const STYLE: Record<string, string> = {
  queued: "text-bone-2 border-line-2",
  running: "text-sky border-sky/30 bg-sky/[.06]",
  completed: "text-volt border-volt/30 bg-volt/[.06]",
  failed: "text-ember border-ember/30 bg-ember/[.06]",
  rejected: "text-ember border-ember/30 bg-ember/[.06]",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex h-6 w-[88px] shrink-0 items-center justify-center gap-1.5 rounded-full border font-mono text-[10.5px] ${STYLE[status] ?? STYLE.queued}`}>
      {(status === "running" || status === "queued") && <span className="live-dot size-1.5 rounded-full bg-current" />}
      {status}
    </span>
  );
}
