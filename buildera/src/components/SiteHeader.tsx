import Link from "next/link";
import { getUser } from "@/lib/auth";
import { shortAddr, fmtNum } from "@/lib/format";
import { Logo } from "./Logo";
import { SignOutButton } from "./SignOutButton";

const NAV = [
  { href: "/", label: "Agents" },
  { href: "/create", label: "Publish" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/docs", label: "Docs" },
];

export async function SiteHeader() {
  const user = await getUser();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/70 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-8 px-4 sm:px-6">
        <Link href="/" className="shrink-0" aria-label="Buildera home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-full px-3 py-1.5 text-[13.5px] text-bone-2 transition hover:bg-white/[.04] hover:text-bone">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="chip hidden sm:inline-flex">
            <span className="size-1.5 rounded-full bg-sky" /> devnet
          </span>
          {user ? (
            <>
              <Link href="/dashboard" className="chip h-8 px-3 text-bone hover:border-white/25" title="Your credits">
                <span className="text-volt">◆</span> {fmtNum(user.credits)} <span className="text-mute">cr</span>
              </Link>
              <Link href="/dashboard" className="hidden h-8 items-center rounded-full border border-line-2 px-3 font-mono text-[11.5px] text-bone-2 hover:text-bone sm:inline-flex">
                {user.wallet ? shortAddr(user.wallet) : user.email}
              </Link>
              <SignOutButton />
            </>
          ) : (
            <Link href="/signin" className="btn btn-light h-9 text-[13.5px]">
              Sign in
            </Link>
          )}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="rounded-full px-3 py-1 text-[13px] text-bone-2">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
