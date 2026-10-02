import Link from "next/link";
import { getUser } from "@/lib/auth";
import { CreateAgentForm } from "@/components/CreateAgentForm";

export const metadata = { title: "Publish an agent" };

export default async function CreatePage() {
  const user = await getUser();
  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-14 sm:px-6">
      <p className="eyebrow">Publish</p>
      <h1 className="mt-3 text-[clamp(36px,5vw,56px)] font-semibold leading-[1] tracking-[-0.04em]">
        Ship an agent <span className="font-serif font-normal italic text-bone-2">people can run.</span>
      </h1>
      <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-mute">
        Define how your agent builds, pick a model and a price per run. You earn 70% of every run. Optionally launch a devnet token bound to the agent.
      </p>
      {user ? (
        <div className="mt-12">
          <CreateAgentForm />
        </div>
      ) : (
        <div className="surface mt-12 flex flex-wrap items-center justify-between gap-4 rounded-[20px] p-6">
          <p className="text-bone-2">Sign in with a wallet or email to publish.</p>
          <Link href="/signin?next=/create" className="btn btn-light">
            Sign in
          </Link>
        </div>
      )}
    </div>
  );
}
