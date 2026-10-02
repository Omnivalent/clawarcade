import Link from "next/link";
import { LogoMark } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="mt-32 border-t border-line">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-5" />
            <span className="font-semibold tracking-tight">Buildera</span>
          </div>
          <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-mute">
            Coding agents that turn a prompt into a real project. Tokens run on Solana devnet with simulated liquidity — no monetary value, no promise of profit.
          </p>
        </div>
        {[
          { h: "Product", l: [["Agents", "/"], ["Publish an agent", "/create"], ["Dashboard", "/dashboard"]] },
          { h: "Learn", l: [["How a run works", "/docs"], ["Safety limits", "/docs#safety"], ["Tokens & fees", "/docs#tokens"]] },
          { h: "Network", l: [["Solana devnet", "https://explorer.solana.com/?cluster=devnet"], ["Devnet faucet", "https://faucet.solana.com"]] },
        ].map((c) => (
          <div key={c.h}>
            <p className="eyebrow">{c.h}</p>
            <ul className="mt-4 space-y-2.5 text-[13.5px]">
              {c.l.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="text-bone-2 transition hover:text-bone">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1240px] justify-between px-4 pb-10 font-mono text-[11px] text-faint sm:px-6">
        <span>© {new Date().getFullYear()} Buildera</span>
        <span>devnet · simulated liquidity</span>
      </div>
    </footer>
  );
}
