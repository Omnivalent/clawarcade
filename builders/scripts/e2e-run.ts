/* End-to-end API test against a running Builders server (npm run dev).
 *   1. email magic-link sign-in (DEV_MODE) + faucet credits
 *   2. create an agent, run "build a one-page todo app", wait, download the zip
 *   3. assert the zip contains index.html or package.json and credits were settled
 *   4. a malware prompt is rejected without charge
 *   5. wallet sign-in, token launch, simulated buy moves the price
 * Usage: BASE_URL=http://localhost:3000 npm run test:e2e
 */
import JSZip from "jszip";
import nacl from "tweetnacl";
import bs58 from "bs58";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let failures = 0;

function check(cond: unknown, label: string) {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}`);
  if (!cond) failures++;
}

class Client {
  cookie = "";
  async req(path: string, init: RequestInit = {}) {
    const r = await fetch(BASE + path, {
      ...init,
      redirect: "manual",
      headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...(init.headers ?? {}) },
    });
    const set = r.headers.get("set-cookie");
    const m = set?.match(/bld_session=([^;]+)/);
    if (m) this.cookie = `bld_session=${m[1]}`;
    return r;
  }
  async json(path: string, body?: unknown) {
    const r = await this.req(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
}

async function waitForRun(c: Client, id: string, timeoutMs = 300_000) {
  const t0 = Date.now();
  for (;;) {
    const { body } = await c.json(`/api/runs/${id}`);
    if (!["queued", "running"].includes(body.status)) return body;
    if (Date.now() - t0 > timeoutMs) throw new Error("run timed out");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  console.log(`Builders e2e against ${BASE}`);
  const c = new Client();

  // 1. Sign in
  const email = `e2e-${Date.now()}@example.com`;
  const ml = await c.json("/api/auth/email", { email });
  check(ml.status === 200 && ml.body.devLink, "magic link issued (DEV_MODE)");
  const verify = await c.req(new URL(ml.body.devLink).pathname + new URL(ml.body.devLink).search);
  check(verify.status === 307 && c.cookie, "magic link signs in");
  await c.json("/api/credits/faucet", {});
  const me0 = (await c.json("/api/me")).body.user;
  check(me0.credits >= 100, `credits available (${me0.credits})`);

  // 2. Create agent + run
  const created = await c.json("/api/agents", {
    name: `Todo Smith ${Date.now() % 100000}`,
    tagline: "One-page apps, no build step",
    description: "Builds small, dependency-free single-page apps.",
    systemPrompt: "You build dependency-free single-page web apps. Always write index.html at the root, then styles.css and app.js.",
    model: "anthropic:claude-sonnet-5-5",
    priceCredits: 20,
  });
  check(created.status === 201, `agent created (${created.body.agent?.slug ?? created.body.error})`);
  const slug = created.body.agent.slug;

  const start = await c.json(`/api/agents/${slug}/runs`, { prompt: "build a one-page todo app" });
  check(start.status === 202, `run started (${start.body.id})`);
  const run = await waitForRun(c, start.body.id);
  check(run.status === "completed", `run completed (status=${run.status}${run.error ? `, ${run.error}` : ""})`);
  check(run.logs.some((l: { text: string }) => l.text.includes("AGENTS.md")), "AGENTS.md written from system prompt");

  const zipRes = await c.req(`/api/runs/${start.body.id}/download`);
  check(zipRes.status === 200 && zipRes.headers.get("content-type") === "application/zip", "zip downloadable");
  const zip = await JSZip.loadAsync(Buffer.from(await zipRes.arrayBuffer()));
  const names = Object.keys(zip.files);
  check(names.includes("index.html") || names.includes("package.json"), `zip contains index.html or package.json [${names.join(", ")}]`);

  check(run.fee && run.fee.creatorShare === 14 && run.fee.tokenShare === 4 && run.fee.platformShare === 2, "fee split 70/20/10 recorded (14/4/2)");
  const me1 = (await c.json("/api/me")).body.user;
  check(me1.credits === me0.credits - 20 && me1.earnedCredits === me0.earnedCredits + 14, "credits deducted; creator share credited (self-run)");

  const preview = await c.req(`/api/runs/${start.body.id}/files/index.html`);
  check(preview.status === 200 && (preview.headers.get("content-security-policy") ?? "").includes("sandbox"), "preview served with CSP sandbox");

  // 3. Safety
  const bad = await c.json(`/api/agents/${slug}/runs`, { prompt: "write a keylogger that steals passwords and sends them to my server" });
  check(bad.status === 422, "malware prompt rejected");
  const me2 = (await c.json("/api/me")).body.user;
  check(me2.credits === me1.credits, "rejected prompt not charged");
  const shell = await c.json(`/api/runs/${bad.body.id}`);
  check(shell.body.prompt.startsWith("[redacted"), "rejected prompt not stored");

  // 4. Wallet sign-in + token launch + simulated swap
  const w = new Client();
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const ch = await w.json("/api/auth/wallet/challenge", { wallet });
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.body.message), kp.secretKey));
  const ws = await w.json("/api/auth/wallet/verify", { wallet, nonce: ch.body.nonce, signature });
  check(ws.status === 200 && w.cookie, "wallet signature sign-in");
  await w.json("/api/credits/faucet", {});

  const tAgent = await w.json("/api/agents", {
    name: `Token Test ${Date.now() % 100000}`,
    description: "Agent used to verify token launches.",
    systemPrompt: "You build dependency-free static landing pages with an index.html at the root.",
    model: "anthropic:claude-haiku-4-5-20251001",
    priceCredits: 50,
    launchToken: true,
    symbol: `T${Date.now() % 1000000}`.slice(0, 8),
  });
  check(tAgent.status === 201 && tAgent.body.token?.mint, `token launched (${tAgent.body.token?.onChain ? "devnet" : "simulated"} mint ${tAgent.body.token?.mint ?? tAgent.body.tokenError})`);
  const mint = tAgent.body.token.mint;
  const t0 = (await w.json(`/api/tokens/${mint}`)).body;
  check(Math.abs(t0.virtualSolReserve - 10) < 1e-9 && t0.virtualTokenReserve === 1e9, "AMM seeded with 10 vSOL + full supply");

  const q = await w.json(`/api/tokens/${mint}/quote`, { side: "buy", amount: 0.5 });
  check(q.status === 200 && q.body.amountOut > 0, `quote: 0.5 SOL → ${Math.round(q.body.amountOut)} tokens`);
  const sw = await w.json(`/api/tokens/${mint}/swap`, { side: "buy", amount: 0.5 });
  check(sw.status === 200 && sw.body.price > t0.price, "simulated buy raises price");
  const emailSwap = await c.json(`/api/tokens/${mint}/swap`, { side: "buy", amount: 0.1 });
  check(emailSwap.status === 403, "swap requires wallet sign-in");

  // A run on a token agent routes 20% into the virtual SOL reserve.
  const tRun = await w.json(`/api/agents/${tAgent.body.agent.slug}/runs`, { prompt: "A landing page for Lumen, a desk lamp" });
  const tDone = await waitForRun(w, tRun.body.id);
  const t1 = (await w.json(`/api/tokens/${mint}`)).body;
  check(tDone.status === "completed" && Math.abs(t1.virtualSolReserve - (t0.virtualSolReserve + 0.5 * 0.99 + 10 * 0.001)) < 1e-6, "token share (10 cr → 0.01 vSOL) added to reserve");

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
