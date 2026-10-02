"use client";

import { useMemo, useState } from "react";
import { fmtPerM } from "@/lib/format";

export function PriceChart({ points }: { points: { price: number; createdAt: string; source: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = points.length > 1 ? points : [...points, ...points];
  const { d, area, xs, ys } = useMemo(() => {
    const vals = data.map((p) => p.price);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || max * 0.02 || 1;
    const xs = data.map((_, i) => (i / Math.max(1, data.length - 1)) * 100);
    const ys = vals.map((v) => 92 - ((v - min) / span) * 80);
    const d = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(2)} ${ys[i].toFixed(2)}`).join(" ");
    return { d, area: `${d} L100 100 L0 100 Z`, xs, ys };
  }, [data]);
  const idx = hover ?? data.length - 1;
  const p = data[idx];

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between font-mono text-[11px]">
        <span className="text-mute">{hover === null ? "now" : new Date(p.createdAt).toLocaleString()}</span>
        <span className="text-bone">{fmtPerM(p.price)} SOL / 1M</span>
      </div>
      <div
        className="relative h-36 w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * 100;
          let best = 0;
          xs.forEach((v, i) => {
            if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i;
          });
          setHover(best);
        }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
          <defs>
            <linearGradient id="pc" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--color-volt)" stopOpacity=".25" />
              <stop offset="1" stopColor="var(--color-volt)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[25, 50, 75].map((y) => (
            <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="rgba(255,255,255,.05)" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={area} fill="url(#pc)" />
          <path d={d} fill="none" stroke="var(--color-volt)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          <line x1={xs[idx]} x2={xs[idx]} y1="0" y2="100" stroke="rgba(255,255,255,.15)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-volt" style={{ left: `${xs[idx]}%`, top: `${ys[idx]}%` }} />
      </div>
    </div>
  );
}
