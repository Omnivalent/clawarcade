/* Seeds three example agents (landing page builder, API service, static dashboard),
 * two simulated token launches, and a handful of real offline demo runs so the catalog,
 * fee ledger and price charts have genuine data. Safe to re-run. */
import { PrismaClient } from "@prisma/client";
import { Keypair } from "@solana/web3.js";
import { executeRun } from "../src/lib/runner";
import { priceOf, quote } from "../src/lib/amm";
import { TOKEN } from "../src/lib/config";

const db = new PrismaClient();

const AGENTS = [
  {
    slug: "landing-forge",
    name: "Landing Forge",
    tagline: "Conversion-ready landing pages, shipped as static HTML",
    description:
      "Landing Forge turns a one-line product idea into a fast, responsive marketing page: hero, feature grid, pricing and a clear call to action. Output is plain HTML and CSS — deploy the folder anywhere.\nTry: A landing page for Halcyon, a sleep-tracking ring | A launch page for a coffee subscription | A waitlist page for an AI note-taker",
    systemPrompt: `You are Landing Forge, a senior marketing-site engineer.

Goals
- Produce a single static landing page at index.html with a linked styles.css.
- Structure: nav, hero with one primary CTA, three-feature grid, pricing or social proof, footer.
- Mobile-first, responsive, accessible (landmarks, alt text, focus states, contrast AA).

Rules
- No frameworks, no build step, no external fonts or trackers.
- Copy must be specific to the product in the prompt. No lorem ipsum.
- Write README.md with deploy instructions. Call finish with a summary.`,
    model: "anthropic:claude-sonnet-5-5",
    priceCredits: 18,
    accent: "#d9ff5a",
    symbol: "FORGE",
    prompts: ["A landing page for Halcyon, a sleep-tracking ring", "A launch page for Driftwood coffee subscriptions"],
  },
  {
    slug: "endpoint",
    name: "Endpoint",
    tagline: "Zero-dependency Node APIs with tests that pass",
    description:
      "Endpoint scaffolds small JSON APIs in Node with no runtime dependencies: routing, validation, error handling and node:test coverage. It runs the tests before it finishes.\nTry: A notes API with create, list and delete | A URL shortener service | A REST API for a reading list",
    systemPrompt: `You are Endpoint, a backend engineer who builds small, dependable Node.js services.

- Target Node 20+, ES modules, zero runtime dependencies (node:http, node:crypto, node:test).
- Always write package.json with "start" and "test" scripts, server.js, and tests under test/.
- Validate input, return proper status codes, never crash on bad JSON.
- Run \`npm test\` and fix failures before you finish.
- Document every route in README.md as a table.`,
    model: "anthropic:claude-opus-5-5",
    priceCredits: 30,
    accent: "#7cf5ff",
    symbol: "ENDPT",
    prompts: ["A notes API service with create, list and delete", "A REST API service for a reading list"],
  },
  {
    slug: "panel",
    name: "Panel",
    tagline: "Static analytics dashboards with no build step",
    description:
      "Panel builds clean, static dashboards: KPI tiles, an SVG chart and a table, driven by a local data file you can swap for real numbers.\nTry: A metrics dashboard for a SaaS app | A dashboard for a bakery's weekly sales | A KPI dashboard for a support team",
    systemPrompt: `You are Panel, a data-visualisation engineer.

- Build a static dashboard: index.html, styles.css, data.js (sample data), app.js (rendering).
- Use inline SVG for charts. No chart libraries, no build step.
- Include KPI tiles, at least one time-series chart and one table. Add a range selector.
- Numbers must be formatted with Intl.NumberFormat. Respect prefers-reduced-motion.`,
    model: "anthropic:claude-haiku-4-5-20251001",
    priceCredits: 12,
    accent: "#ff9e6b",
    symbol: null,
    prompts: ["A metrics dashboard for Orbit, a SaaS app"],
  },
] as const;

async function main() {
  const owner = await db.user.upsert({
    where: { email: "labs@builders.dev" },
    update: {},
    create: { email: "labs@builders.dev", handle: "builders-labs", credits: 10_000 },
  });
  const runner = await db.user.upsert({
    where: { email: "demo@builders.dev" },
    update: {},
    create: { email: "demo@builders.dev", handle: "demo", credits: 10_000, simSol: 50 },
  });

  for (const a of AGENTS) {
    const existing = await db.agent.findUnique({ where: { slug: a.slug } });
    if (existing) {
      console.log(`· ${a.slug} exists, skipping`);
      continue;
    }
    const agent = await db.agent.create({
      data: {
        ownerId: owner.id,
        slug: a.slug,
        name: a.name,
        tagline: a.tagline,
        description: a.description,
        systemPrompt: a.systemPrompt,
        model: a.model,
        priceCredits: a.priceCredits,
        accent: a.accent,
        toolsEnabled: ["write_file", "read_file", "list_files", "run_shell", "finish"],
      },
    });

    if (a.symbol) {
      // Seeded launches are simulated (no PLATFORM_KEYPAIR needed): random address, onChain=false.
      const mint = Keypair.generate().publicKey.toBase58();
      const launch = await db.tokenLaunch.create({
        data: {
          agentId: agent.id,
          mint,
          name: a.name,
          symbol: a.symbol,
          supply: BigInt(TOKEN.supply),
          virtualSolReserve: TOKEN.initialVirtualSol,
          virtualTokenReserve: TOKEN.supply,
          onChain: false,
        },
      });
      await db.agent.update({ where: { id: agent.id }, data: { tokenMint: mint } });
      await db.pricePoint.create({ data: { launchId: launch.id, price: priceOf(launch.virtualSolReserve, launch.virtualTokenReserve), source: "launch" } });

      // A few simulated trades from the demo account so the curve has shape.
      let vSol = launch.virtualSolReserve;
      let vTok = launch.virtualTokenReserve;
      for (const [side, amt] of [["buy", 0.6], ["buy", 0.35], ["sell", 9_000_000], ["buy", 0.8], ["buy", 0.25], ["sell", 14_000_000], ["buy", 0.5]] as const) {
        const q = quote(side, amt, vSol, vTok);
        vSol = q.newSol;
        vTok = q.newTok;
        await db.trade.create({ data: { launchId: launch.id, userId: runner.id, side, solAmount: side === "buy" ? amt : q.amountOut, tokAmount: side === "buy" ? q.amountOut : amt, price: q.priceAfter } });
        await db.pricePoint.create({ data: { launchId: launch.id, price: q.priceAfter, source: "trade" } });
      }
      await db.tokenLaunch.update({ where: { id: launch.id }, data: { virtualSolReserve: vSol, virtualTokenReserve: vTok } });
      const bought = await db.trade.aggregate({ where: { launchId: launch.id, side: "buy" }, _sum: { tokAmount: true } });
      const sold = await db.trade.aggregate({ where: { launchId: launch.id, side: "sell" }, _sum: { tokAmount: true } });
      await db.tokenBalance.upsert({
        where: { userId_mint: { userId: runner.id, mint } },
        create: { userId: runner.id, mint, amount: (bought._sum.tokAmount ?? 0) - (sold._sum.tokAmount ?? 0) },
        update: {},
      });
    }

    // Real end-to-end runs through the offline planner (no model key, no network).
    for (const prompt of a.prompts) {
      const run = await db.run.create({ data: { agentId: agent.id, userId: runner.id, prompt, creditsCharged: a.priceCredits } });
      await db.user.update({ where: { id: runner.id }, data: { credits: { decrement: a.priceCredits } } });
      await executeRun(run.id, { offline: true, paceMs: 0 });
      const done = await db.run.findUniqueOrThrow({ where: { id: run.id } });
      console.log(`  run ${done.id.slice(-8)} ${done.status} — ${prompt}`);
    }
    console.log(`✓ ${a.slug}${a.symbol ? ` ($${a.symbol})` : ""}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
