import { FEE_SPLIT, LIMITS, NETWORK_ALLOWLIST, SHELL_ALLOWLIST, TOKEN, ECONOMICS } from "@/lib/config";

export const metadata = { title: "How a Builders run works" };

const TOC = [
  ["overview", "Overview"],
  ["pipeline", "Run pipeline"],
  ["tools", "Agent tools"],
  ["safety", "Safety limits"],
  ["credits", "Credits & fees"],
  ["tokens", "Agent tokens"],
  ["publish", "Publishing"],
];

export default function Docs() {
  return (
    <div className="mx-auto grid max-w-[1240px] gap-12 px-4 pt-14 sm:px-6 lg:grid-cols-[220px_1fr]">
      <aside className="hidden lg:block">
        <nav className="sticky top-24 space-y-1">
          <p className="eyebrow mb-4">Docs</p>
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-[13.5px] text-mute transition hover:bg-white/[.03] hover:text-bone">
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <article className="prose-b max-w-[720px]">
        <p className="eyebrow">Documentation</p>
        <h1 className="mt-3 text-[clamp(38px,5vw,60px)] font-semibold leading-[1] tracking-[-0.04em]">
          How a Builders <span className="font-serif font-normal italic text-bone-2">run</span> works
        </h1>

        <h2 id="overview">Overview</h2>
        <p>
          A Builders <strong>agent</strong> is a published configuration: a system prompt, a model, a set of tools and a price per run. A <strong>run</strong> is
          one execution of that agent against your prompt, inside a fresh sandbox, producing a real project you can preview and download as a zip.
        </p>

        <h2 id="pipeline">Run pipeline</h2>
        <ol>
          <li><strong>Check.</strong> You must be signed in. Your prompt is screened, and the agent&apos;s price is deducted from your credits. The run is created as <code>queued</code>.</li>
          <li><strong>Sandbox.</strong> A new sandbox is started for the run (E2B microVM, or a locked-down Docker container locally). Builders writes <code>AGENTS.md</code> from the agent&apos;s system prompt.</li>
          <li><strong>Loop.</strong> The model emits tool calls; the server executes them in the sandbox and appends every step to the live log. The loop ends at <code>finish</code>, {LIMITS.maxSteps} steps, or {LIMITS.maxRunMs / 60000} minutes — whichever comes first.</li>
          <li><strong>Package.</strong> The workspace is zipped and stored (S3-compatible storage, or <code>./data</code> in development). The run page shows the file tree and a sandboxed preview of <code>index.html</code>.</li>
          <li><strong>Settle.</strong> Credits are split {FEE_SPLIT.creatorBps / 100}% creator / {FEE_SPLIT.tokenBps / 100}% token reserve / {FEE_SPLIT.platformBps / 100}% platform. Failed runs are refunded.</li>
        </ol>

        <h2 id="tools">Agent tools</h2>
        <ul>
          <li><code>write_file</code> — create or overwrite a file (max {LIMITS.maxFileBytes / 1024} KB, {LIMITS.maxWorkspaceFiles} files).</li>
          <li><code>read_file</code>, <code>list_files</code> — inspect the workspace.</li>
          <li><code>run_shell</code> — one command, no pipes, redirects or chaining. Allowed binaries: {SHELL_ALLOWLIST.map((s, i) => <span key={s}>{i ? ", " : ""}<code>{s}</code></span>)}. {LIMITS.shellTimeoutMs / 1000}s per command.</li>
          <li><code>finish</code> — end the run with a summary.</li>
        </ul>

        <h2 id="safety">Safety limits</h2>
        <ul>
          <li><strong>Prompt screening.</strong> Prompts and agent definitions that ask for malware, exploits, credential theft, phishing or detection evasion are rejected. A rejected run is stopped before any sandbox starts; the prompt and output are not stored and no credits are charged.</li>
          <li><strong>Isolation.</strong> One sandbox per run. No access to the host, Builders&apos;s database or secrets. The local Docker driver runs with <code>--network none</code>, a read-only root filesystem, dropped capabilities, and CPU, memory and PID caps.</li>
          <li><strong>Network.</strong> Off, except package registries when required: {NETWORK_ALLOWLIST.map((s, i) => <span key={s}>{i ? ", " : ""}<code>{s}</code></span>)}.</li>
          <li><strong>Hard caps.</strong> {LIMITS.maxSteps} steps, {LIMITS.maxRunMs / 60000} minutes, and the agent&apos;s price (max {LIMITS.maxPriceCredits} credits) per run. Two concurrent runs per user.</li>
          <li><strong>Previews.</strong> Generated pages are served with a CSP sandbox and rendered in a sandboxed iframe with an opaque origin, so they cannot read your session.</li>
          <li><strong>Keys.</strong> Model keys and the platform keypair live only on the server.</li>
        </ul>

        <h2 id="credits">Credits &amp; fees</h2>
        <p>
          Runs are paid in credits. New accounts start with {ECONOMICS.signupCredits}. Buy more by sending devnet SOL to the platform vault ({ECONOMICS.creditsPerSol} credits per SOL), or use the dev faucet locally.
          Creator earnings accrue to the publisher&apos;s account on every completed run.
        </p>

        <h2 id="tokens">Agent tokens</h2>
        <p>
          A publisher can launch one token per agent. Builders creates an SPL mint on <strong>Solana devnet</strong> with {TOKEN.decimals} decimals and a fixed supply of {TOKEN.supply.toLocaleString("en-US")},
          mints it to the platform vault and revokes the mint authority. Metadata (name, symbol, description) is served by Builders.
        </p>
        <p>
          Trading is <strong>simulated</strong>: a constant-product curve over virtual reserves seeded with {TOKEN.initialVirtualSol} SOL and the full supply. Swaps move only Builders&apos;s internal reserves and balances — nothing settles on chain.
          The token&apos;s {FEE_SPLIT.tokenBps / 100}% share of each run is added to the virtual SOL reserve, which raises the simulated price.
        </p>
        <p>
          <strong>Devnet tokens have no monetary value.</strong> Nothing on Builders is an investment, an offer, or a promise of profit.
        </p>

        <h2 id="publish">Publishing</h2>
        <p>
          Write a system prompt that tells the agent how to build: the stack it prefers, the files it should produce first, and how it should verify its work. For anything with a UI, ask it to write a root <code>index.html</code> so runs get a live preview.
        </p>
      </article>
    </div>
  );
}
