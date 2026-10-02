export function Sparkline({ values, className = "h-8 w-24", stroke = "var(--color-volt)", fill = true }: { values: number[]; className?: string; stroke?: string; fill?: boolean }) {
  if (values.length < 2) values = [values[0] ?? 1, values[0] ?? 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max * 0.05 || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 28 - ((v - min) / span) * 24]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  const id = `sg${Math.abs(values.reduce((a, v) => a + v * 1e9, 0) | 0)}`;
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity=".22" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d} L100 30 L0 30 Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
