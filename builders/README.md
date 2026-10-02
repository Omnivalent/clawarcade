# builders

**Builders** is a marketplace for coding agents. Publishers define an agent (system prompt, model, tools, price); anyone can run it from a prompt and get back a real project (file tree, live preview, zip). Publishers can launch a **Solana devnet** token bound to their agent, with simulated liquidity.

> Devnet only. Tokens have no monetary value, liquidity is simulated, and nothing here promises profit.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Postgres + Prisma · Vercel AI SDK (Anthropic / OpenAI) · E2B sandboxes (Docker / file-only fallback) · `@solana/web3.js` + `@solana/spl-token` · S3-compatible or local artifact storage.

## Quick start (local demo)

```bash
cd builders
npm install
cp .env.example .env            # set DATABASE_URL and SESSION_SECRET
npm run db:push                 # create tables
npm run db:seed                 # 3 example agents, 2 simulated tokens, 5 real demo runs
npm run dev                     # http://localhost:3000
```

Postgres quick setup: `createuser -P builders && createdb -O builders builders` (or `docker run -e POSTGRES_PASSWORD=builders -e POSTGRES_USER=builders -p 5432:5432 postgres:16`).

**No API keys needed for the demo.** Without `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, runs use the built-in **offline demo planner**. It drives the same tool executor, sandbox, zip, and fee pipeline as a real model, and the run log says it is in demo mode. Add a key and runs call the agent's chosen model.

Sign in with a Solana wallet (Phantom / Solflare / Backpack) or an email magic link. With `DEV_MODE=true` the link appears on screen instead of being emailed, and the dashboard **faucet** gives 200 credits + 2 simulated SOL.

## Tests

```bash
npm run typecheck
npm run test:e2e   # API e2e against a running server: create agent → run "build a one-page todo app" → zip has index.html/package.json; also safety rejection, wallet sign-in, token launch, simulated swap, fee routing
npm run test:ui    # Playwright: catalog + sign in + run from the UI + preview iframe (set CHROMIUM_PATH to use a preinstalled Chromium)
```

## Environment

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres |
| `SESSION_SECRET`, `APP_URL` | sessions / magic-link URLs |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | model calls (server-side only) |
| `E2B_API_KEY` | E2B sandboxes; otherwise local Docker, otherwise a file-only workspace |
| `SANDBOX_DRIVER` | optional override: `e2b` \| `docker` \| `local` |
| `SOLANA_RPC` | devnet RPC (mainnet URLs and non-devnet genesis are refused) |
| `PLATFORM_KEYPAIR` | devnet platform keypair (JSON array). Enables real mints and SOL→credit deposits |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | optional S3-compatible artifact storage (default `./data/artifacts`) |
| `DEV_MODE` | on-screen magic links + faucet. **Never enable in production.** |

## Devnet setup (real mints + deposits)

```bash
solana-keygen new -o platform.json --no-bip39-passphrase
solana airdrop 2 $(solana-keygen pubkey platform.json) --url devnet   # or https://faucet.solana.com
echo "PLATFORM_KEYPAIR=$(cat platform.json)" >> .env
```

With `PLATFORM_KEYPAIR` set, **Publish and launch token** creates an SPL mint on devnet (6 decimals, 1,000,000,000 supply), mints it all to the platform vault's ATA, and **revokes the mint authority**. Metadata JSON (name = agent name, symbol, a description that mentions Builders) is served at `/api/tokens/[mint]/metadata`; on-chain Metaplex metadata is not written in the MVP. Without the keypair, launches are **simulated**: a placeholder address, shown as "off-chain" in the UI.

Users can buy credits by sending devnet SOL to the platform vault from the dashboard (1 SOL = 1,000 credits). The server checks the transfer on chain before granting credits, and each signature can only be redeemed once.

## How a run works

1. Auth check → safety screen → atomic credit deduction → `Run` is `queued`.
2. A new sandbox is started; `AGENTS.md` is written from the agent's system prompt.
3. Agent loop (AI SDK `generateText` with tools): `write_file`, `read_file`, `list_files`, `run_shell`, `finish`. The loop stops at `finish`, after 25 steps, or after 4 minutes. Logs are flushed to Postgres and the run page polls them.
4. The workspace is zipped and stored, then the run is marked `completed`. Failed runs (no output, crash) are refunded.
5. Credits are split 70% creator / 20% token reserve / 10% platform into `FeeLedger`. If the agent has a token, the token share × 0.001 SOL is added to its virtual SOL reserve, which raises the simulated price.

## Safety limits

- **Prompt screening** (`src/lib/safety.ts`): malware, exploits, credential theft, phishing, DDoS tooling, and detection evasion are rejected. This applies to run prompts and to agent definitions. A rejected run never starts a sandbox, stores neither the prompt nor any output (`[redacted]`), and charges nothing.
- **Hard caps** (`src/lib/config.ts`): 25 steps, 4 min wall clock, price ≤ 500 credits (the price is the run's credit cap), 512 KB per file, 400 files, 60 s per shell command, 2 concurrent runs per user.
- **Shell**: argv only, never through a host shell. Metacharacters (`; | & $ > <` …), `node -e` / `python -c`, and `npx -y` are rejected. Allowlist: `npm`, `node`, `npx`, `python`, `python3`, `pytest`.
- **Sandbox isolation**: one sandbox per run, destroyed afterwards.
  - *E2B*: a remote microVM with a timeout.
  - *Docker*: `--network none`, read-only rootfs, `--cap-drop ALL`, `no-new-privileges`, 1 CPU / 1 GB / 256 PIDs, and only the run's temp workspace mounted.
  - *File-only fallback*: `run_shell` is disabled; commands never run on the host.
- **Network allowlist**: off by default. If an agent needs dependencies, allow only `registry.npmjs.org`, `pypi.org`, and `files.pythonhosted.org`. Configure that in your E2B template / egress proxy, or set `SANDBOX_DOCKER_NETWORK` to a network that egresses only to those hosts.
- **Previews**: generated files are served with `Content-Security-Policy: sandbox` and rendered in `<iframe sandbox="allow-scripts">`. They run in an opaque origin with no access to Builders cookies or APIs.
- **Keys**: model keys and `PLATFORM_KEYPAIR` are read only on the server (`server-only` modules) and never sent to the client.

## API

| | |
|---|---|
| `POST /api/agents` | create (optionally `launchToken` + `symbol`) |
| `POST /api/agents/[slug]/runs` | start a run → `{ id }` (202) |
| `GET /api/runs/[id]` | status, logs, files, fee |
| `GET /api/runs/[id]/download` | zip |
| `GET /api/runs/[id]/files/[...path]` | file / preview (`?raw=1` for text) |
| `POST /api/agents/[slug]/launch-token` | publisher-only token launch |
| `GET /api/tokens/[mint]` · `POST …/quote` · `POST …/swap` | simulated AMM (swap requires wallet sign-in) |
| `GET /api/tokens/[mint]/metadata` | token metadata JSON |
| `POST /api/auth/wallet/challenge` · `…/verify` · `/api/auth/email` · `/api/auth/logout` | auth |
| `POST /api/credits/faucet` · `/api/credits/deposit` | credits |

## Simulated AMM

Constant product over virtual reserves (`src/lib/amm.ts`) with a 1% swap fee, seeded with 10 vSOL plus the full supply. Swaps lock the pool row (`SELECT … FOR UPDATE`) and update reserves, internal balances, trades, and price points in one transaction. Prices are shown in SOL per 1M tokens. Nothing settles on chain.

## Layout

```
prisma/schema.prisma, seed.ts
src/lib/        runner (agent loop), sandbox/{e2b,docker,local}, safety, fees, amm, tokens, solana, storage, auth
src/app/        pages: / · /agent/[slug] · /agent/[slug]/run/[id] · /create · /dashboard · /docs · /signin ; api/*
src/components/ UI (AgentCard, RunViewer, TokenPanel, CreateAgentForm, …)
scripts/e2e-run.ts · tests/ui.spec.ts
```
