export function fmtNum(n: number, digits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function fmtCompact(n: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** SOL prices for fresh tokens are tiny; show significant digits. */
export function fmtPrice(sol: number) {
  if (sol === 0) return "0";
  if (sol >= 1) return sol.toFixed(3);
  const digits = Math.min(12, Math.max(2, -Math.floor(Math.log10(sol)) + 2));
  return sol.toFixed(digits);
}

export function shortAddr(a: string, n = 4) {
  return a.length > n * 2 + 3 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

export function timeAgo(d: Date | string) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** Token prices are quoted per 1M tokens so fresh-curve prices stay readable. */
export function fmtPerM(solPerToken: number) {
  const v = solPerToken * 1e6;
  if (v === 0) return "0";
  if (v >= 100) return v.toFixed(1);
  return v.toPrecision(4);
}
