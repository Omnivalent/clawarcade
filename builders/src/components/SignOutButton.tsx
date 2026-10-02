"use client";

export function SignOutButton() {
  return (
    <button
      className="grid size-8 place-items-center rounded-full border border-line-2 text-mute transition hover:text-bone"
      title="Sign out"
      aria-label="Sign out"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/";
      }}
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13H6M10.5 11 14 8l-3.5-3M14 8H6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
