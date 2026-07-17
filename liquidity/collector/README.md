# Liquidity Lakes — collector Worker

Server-side data collector for the Liquidity Lakes map. Runs on a 1-minute
Cloudflare cron, fetches every source without browser CORS limits, fixes the
bridge-flow sign in one place, normalizes a hierarchical snapshot
(chains → platforms → tokens + per-bridge corridors), and serves it to the
front-end. Also records a rolling history ring that powers the time machine.

## Why it exists

1. **No CORS.** The static page can't always fetch third-party APIs directly.
   The Worker fetches server-side and serves same-policy JSON with
   `Access-Control-Allow-Origin: *`.
2. **One place to verify data.** The bridge-flow sign, field-name quirks, and
   protocol→gecko-dex mapping live here, not scattered in the browser.
3. **History.** The time machine needs stored frames at 1-minute resolution;
   a static page has no memory. The ring holds ~26h (1600 frames).

## Endpoints

| Path | Returns |
|---|---|
| `GET /api/snapshot` | current normalized state (chains, platforms, tokens, corridors, health) |
| `GET /api/history?window=1h` | compact frames within the window (`1m,5m,30m,1h,3h,6h,12h,1d`) |
| `GET /api/health` | source health + frame count |
| `GET /run` | run the cron once immediately (handy right after deploy) |

## Deploy

```bash
cd liquidity/collector
wrangler login
wrangler kv namespace create LIQUIDITY_KV      # copy the returned id
# paste the id into wrangler.toml -> [[kv_namespaces]] id = "..."
wrangler deploy
curl "https://clawarcade-liquidity.<your-subdomain>.workers.dev/run"   # seed first snapshot
curl "https://clawarcade-liquidity.<your-subdomain>.workers.dev/api/snapshot"
```

Then point the front-end at it: open `liquidity/index.html` and set

```js
const COLLECTOR_URL = 'https://clawarcade-liquidity.<your-subdomain>.workers.dev';
```

near the top (there's a labeled `CONFIG` block). Commit + push; Pages redeploys.

## Verify once (checklist)

- [ ] `/api/health` shows every source `ok` after a few minutes.
- [ ] **Bridge sign:** compare one chain's `netBridge24h` to
      defillama.com/bridges/chains. If in/out is reversed, flip the one line in
      `slowLane()` marked `SIGN:` (`deposit - withdraw` → `withdraw - deposit`).
- [ ] Protocol names resolve to gecko dex ids in `PLATFORM_TO_GECKO_DEX` for the
      platforms you care about (pump.fun, Raydium, Uniswap, Aerodrome…); add any
      missing mappings so level-3 token lakes populate.
- [ ] History grows: `/api/history?window=1h` frame count climbs each minute.

## Cost

Cron fires 1/min (~43k invocations/month) — within the Workers free tier's
100k/day. KV writes are ~1/min. Effectively free at this traffic.

## Notes / limitations

- deBridge and LayerZero corridors are best-effort hooks; if their endpoints
  aren't reachable/parseable the source degrades and Wormhole carries the rivers.
- Level-3 platform tokens are fetched on a rotation (a few platforms per minute)
  to respect GeckoTerminal rate limits, so a given platform refreshes every few
  minutes, not every minute.
- Robinhood: see the front-end note — represented as a labeled thin-coverage
  node; there is no clean public DeFi liquidity feed for it yet.
