import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-xl place-items-center px-4 text-center">
      <div>
        <p className="font-mono text-[12px] text-mute">404</p>
        <h1 className="mt-3 text-[40px] font-semibold tracking-[-0.04em]">
          Nothing was <span className="font-serif font-normal italic">built</span> here.
        </h1>
        <Link href="/" className="btn btn-ghost mt-8">
          Back to agents
        </Link>
      </div>
    </div>
  );
}
