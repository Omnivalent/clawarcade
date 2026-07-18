# Liquidity Lakes — collector Worker (v2)

Server-side data collector for the Liquidity Lakes map. Runs on a Cloudflare
cron, fetches every source without browser CORS limits, normalizes a
hierarchical snapshot (chains → platforms → tokens) plus a **multi-bridge
corridor set**, and serves it to the front-end. Records a rolling history ring
that powers the time machine.

## Design principles (honesty)

- **Never fabricate.** An adapter that can't get data returns nothing and its
  health goes `down`; the front-end dims/hides that river. There is no simulated
  fallback anywhere in the collector.
- **Each bridge is its own adapter** with its own coverage flag. Bridges are
  **never summed** into one generic "bridge volume." LayerZero generic messages
  are not value; aggregator routes are not their settlement rails.
- **Directional corridors** are stored `[fromChain, toChain, usd]`; the two
  directions are separate entries (the UI draws two lanes).
- **History starts on deploy day.** Nothing is backfilled or invented.

## Bridge adapters

| Adapter | Status | Coverage | Notes |
|---|---|---|---|
| Wormhole | **on** | `observed` | Wormholescan x-chain-activity. Known-good, directional. |
| deBridge | **on** | `verify` | DLN `filteredList` orders → corridors. **Verify field names after deploy** (see checklist). |
| Hyperliquid Bridge2 | **on** | `approx-net` | Arbitrum↔HyperCore via DefiLlama `hyperliquid-bridge` TVL delta (net, labeled). A precise gross adapter is a follow-up. |
| Circle CCTP | off (stub) | — | Implement with verified burn/mint indexing. Never faked. |
| Across | off (stub) | — | Needs an event indexer (FundsDeposited/FilledRelay). |
| Stargate | off (stub) | — | Custom OFT-event adapter; buses batch transfers. |
| LayerZero | off (stub) | — | **Only** allowlisted value-transfer OApps/OFTs — never generic messages. |

Turn a stub on by writing its `fn` and setting `enabled: true` in
`BRIDGE_ADAPTERS`. Each adapter's live status shows at `/api/health` under
`bridges`.

## Endpoints

| Path | Returns |
|---|---|
| `GET /api/snapshot` | current normalized state (chains, platforms, tokens, corridors, per-bridge meta) |
| `GET /api/history?window=1h` | compact frames within the window (`1m,5m,30m,1h,3h,6h,12h,1d`) |
| `GET /api/health` | per-source **and per-bridge** health, coverage, freshness |
| `GET /run` | run one collection immediately (seed right after deploy) |

## Deploy (CLI)

```bash
cd liquidity/collector
wrangler login
wrangler kv namespace create LIQUIDITY_KV      # copy the returned id
# paste the id into wrangler.toml -> [[kv_namespaces]] id = "..."
wrangler deploy
curl "https://clawarcade-liquidity.<your-subdomain>.workers.dev/run"        # seed
curl "https://clawarcade-liquidity.<your-subdomain>.workers.dev/api/health" # check adapters
```

No terminal / disk? Deploy through the Cloudflare **dashboard** instead — the
Worker is a single ES-module file (`src/index.js`); create a Worker, paste it,
add a KV namespace binding named `LIQUIDITY_KV`, add a `*/2 * * * *` cron
trigger, deploy. Ask and I'll walk you through the clicks.

Then point the front-end at it — open `liquidity/index.html` and set, in the
`CONFIG` block near the top:

```js
const COLLECTOR_URL = 'https://clawarcade-liquidity.<your-subdomain>.workers.dev';
```

Commit + push; Pages redeploys and flips to `LIVE · COLLECTOR`.

## Verify after deploy (checklist)

- [ ] `/api/health` — `health` sources `ok`; `bridges` shows `wormhole: ok`.
- [ ] **deBridge:** if `bridges.debridge.status` is `down`, open the error — the
      `filteredList` response shape or USD field names need adjusting in
      `adDebridge()` (they're wrapped in try-several already; confirm against a
      real payload at docs.debridge.finance). It fails safe (no river) until fixed.
- [ ] **Bridge net sign:** compare a chain's `netBridge24h` to
      defillama.com/bridges/chains. If reversed, flip the line marked `SIGN:`.
- [ ] **Hyperliquid:** confirm `hyperliquid-bridge` series parses; the corridor
      is labeled `approx-net` (net direction only) by design.
- [ ] Level-3 tokens: add any missing `PLATFORM_TO_GECKO_DEX` mappings.
- [ ] History grows: `/api/history?window=1h` frame count climbs every ~2 min.

## Cost / free tier

- Cron every **2 minutes** = 720 runs/day. The code does **exactly one KV write
  per run** (single `state` key), so it stays under KV's free **1,000 writes/day**.
- Worker invocations (cron + browser polls) stay within the free 100k/day at
  normal traffic.
- Want 1-minute history resolution? That's 1,440 writes/day — enable the **$5
  Workers Paid** plan and change the cron to `* * * * *`.

## Notes / limitations

- deBridge USD valuation depends on the API exposing a USD field; if it only
  exposes raw token amounts we'll add source-side pricing (a follow-up).
- Hyperliquid corridor is net (TVL delta), not gross in/out — labeled as such.
- Level-3 platform tokens refresh on a rotation (3 platforms/run) to respect
  GeckoTerminal rate limits.
- Robinhood: labeled thin-coverage node; no clean public DeFi liquidity feed yet.
- Aggregators (LI.FI/Jumper) are not counted, avoiding double-counting with the
  underlying bridges for now.
