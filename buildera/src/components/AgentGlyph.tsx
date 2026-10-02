import { glyphCells } from "@/lib/glyph";

export function AgentGlyph({ seed, accent, imageUrl, className = "size-12" }: { seed: string; accent: string; imageUrl?: string | null; className?: string }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className={`${className} rounded-[22%] object-cover ring-1 ring-line-2`} />;
  }
  return (
    <svg viewBox="0 0 104 104" className={`${className} shrink-0`} aria-hidden>
      <rect width="104" height="104" rx="24" fill="#121214" />
      <rect x=".5" y=".5" width="103" height="103" rx="23.5" fill="none" stroke="rgba(255,255,255,.08)" />
      <circle cx="52" cy="52" r="42" fill="none" stroke={accent} strokeOpacity=".14" />
      {glyphCells(seed).map((c, i) => (
        <rect key={i} x={22 + c.x * 12} y={22 + c.y * 12} width="10" height="10" rx="2.2" fill={accent} fillOpacity={c.o} />
      ))}
    </svg>
  );
}
