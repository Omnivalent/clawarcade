import { SignInPanel } from "@/components/SignInPanel";
import { LogoMark } from "@/components/Logo";
import { env } from "@/lib/config";

export const metadata = { title: "Sign in" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next?.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/dashboard";
  return (
    <div className="mx-auto grid min-h-[70vh] max-w-[1240px] place-items-center px-4 py-16">
      <div className="w-full max-w-[420px]">
        <div className="text-center">
          <LogoMark className="mx-auto size-10" />
          <h1 className="mt-6 text-[32px] font-semibold tracking-[-0.035em]">
            Sign in to <span className="font-serif font-normal italic">Buildera</span>
          </h1>
          <p className="mt-2 text-[14px] text-mute">New accounts get 100 free credits.</p>
        </div>
        {sp.error && <p className="mt-6 rounded-xl border border-ember/30 bg-ember/10 px-3 py-2 text-center text-[13px] text-ember">That link has expired. Request a new one.</p>}
        <div className="mt-8">
          <SignInPanel next={next} devMode={env.devMode} />
        </div>
      </div>
    </div>
  );
}
