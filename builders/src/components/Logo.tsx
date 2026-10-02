export function LogoMark({ className = "size-6" }: { className?: string }) {
  // Three offset slabs: a project being built, layer by layer.
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="4" y="19" width="24" height="7" rx="2" fill="var(--color-volt)" />
      <rect x="8" y="11" width="20" height="6" rx="2" fill="var(--color-bone)" fillOpacity=".85" />
      <rect x="12" y="4" width="16" height="5" rx="1.6" fill="var(--color-bone)" fillOpacity=".45" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">Builders</span>
    </span>
  );
}
