# Liquidity Lakes

A live, animated map of where crypto liquidity is concentrated and where it is
flowing. Chains are lakes, platforms inside them are pools, tokens are the
water. Open the page and watch capital rotate — no refresh button, no tables.

Single self-contained file: `index.html`. No build step (repo convention).
The optional collector Worker in `collector/` adds real hierarchical + historical
data (see below).

## What you can do (v0.2)

- **Zoom three levels.** Click a chain lake → it opens into its platforms
  (pump.fun, Raydium, Uniswap, Aerodrome…). Click a platform → it opens into its
  top token movers. Breadcrumb (top-left) or click empty space to zoom back out.
- **Robinhood** is included as a labeled thin-coverage node (tokenized equities;
  on-chain liquidity data for it is sparse, so it's shown as illustrative).
- **Rivers in/out at every level**, with a filter to toggle bridge sources
  (Wormhole, deBridge, LayerZero) and in-chain **swaps**. World-level rivers are
  observed bridge corridors; inner swap streams are illustrative activity
  (labeled as such — not measured transfers).
- **Time machine.** Bottom bar: LIVE, or replay a sped-up window
  (1m / 5m / 30m / 1h / 3h / 6h / 12h / 1d) with a scrubber + play/pause. Real
  history comes from the collector; without it, playback runs on the simulated
  drift model (labeled).

## Honesty rule (production shows real data only)

The default URL never shows fabricated data. Chain lakes render from real
metrics; rivers render only from real observed corridors; anything a source
can't provide stays empty and the UI says why. If sources are unreachable the
page shows **NO LIVE DATA** / **STALE** with a timestamp — it never falls back
to fake lakes. The full simulated experience (all platforms, tokens, rivers,
playback) lives **only** behind `?demo=1` and is always labeled **DEMO**.

Deep levels (platforms, tokens) and non-Wormhole bridges require the collector;
without it the default view shows real chain-level data + real Wormhole rivers,
and diving into a chain says "needs the collector."

## Data modes (automatic, in priority order)

1. **Collector** — if `COLLECTOR_URL` is set in `index.html`, one call returns the
   full hierarchical tree + real history. No CORS issues; bridge sign fixed
   server-side. (Deploy: `collector/README.md`.)
2. **Direct** — otherwise the page fetches level-1 data (TVL, stablecoins, DEX
   volume, bridge net flow, Wormhole corridors, GeckoTerminal pools) straight
   from the browser. Platforms/tokens fall back to the simulated hierarchy.
3. **Simulated** — if nothing is reachable, a clearly-banner-labeled simulated
   dataset so every feature stays demonstrable.

The mode chip (top-left) shows which is active; source chips (bottom bar) show
per-source health.

## Visual grammar

| Data | Visual |
|---|---|
| DEX liquidity (v1 proxy: DEX-category TVL) | Lake surface area (asinh-compressed) |
| Stablecoin supply on chain | Water depth (darker = deeper reserve) |
| DEX volume ÷ liquidity (turnover) | Surface shimmer/turbulence |
| Directional bridge corridor volume | River lane width + particle rate (two lanes per pair, never net-only) |
| Net bridge flow 24h | Shoreline glow (green ▲ in / red ▼ out — always paired with arrow + text, never color alone) |
| New pool launches + hot pairs | Amber bubbles inside the lake |
| Venue-type ecosystems (Hyperliquid) | "Harbor" marker + explanatory note (order-book collateral ≠ L1 TVL) |

Deliberate design rules (from review consensus):
- **No single fake dollar number.** Liquidity capacity (stocks) and market
  activity (flows) are never summed. Lake area, depth, and turbulence encode
  them separately.
- **Rivers do not mechanically drain/fill lakes.** Intent bridges move solver
  inventory and CCTP burns/mints — flows and levels are measured
  independently and rendered independently.
- **Fixed geography.** Lakes never move; traders build muscle memory.
- **Ambient particles = rolling 24h flow rates**, not individual transfers.
  The status bar says so on every page view.
- **Coverage is labeled.** Every source has a health chip (ok / stale / down),
  and partial coverage is stated in tooltips and notes.

## Data sources (v1, all free, fetched from the visitor's browser)

| Source | Endpoint | Feeds | Cadence |
|---|---|---|---|
| DefiLlama | `stablecoins.llama.fi/stablecoinchains` | water depth | 10 min |
| DefiLlama | `api.llama.fi/v2/chains` | context TVL | 10 min |
| DefiLlama | `api.llama.fi/protocols` (DEX category sum) | lake area | 30 min |
| DefiLlama | `api.llama.fi/overview/dexs/{chain}` | turbulence, ranking | 5 min |
| DefiLlama | `bridges.llama.fi/bridgevolume/{chain}` | shoreline glow (net 24h) | 10 min |
| Wormholescan | `api.wormholescan.io/api/v1/x-chain-activity/tops` | river corridors | 5 min |
| GeckoTerminal | `api.geckoterminal.com/api/v2/networks/{net}/pools`, `/new_pools` | bubbles, top pools | 2 min |

Every source degrades independently: a failed fetch turns its chip amber/red
and the map keeps running on the remaining sources. If nothing is reachable at
all (offline, sandboxed preview), the page falls back to a **clearly-banner-labeled
simulated snapshot** so the visualization itself is still demonstrable. The
banner text states the data is illustrative, not real.

The "live" feel between polls comes from continuous interpolation (≈2.5s
easing) — values never jump, water never freezes.

## Pre-launch verification checklist (do these against live endpoints
before announcing live mode — the dev sandbox had no egress to these hosts,
so shapes were coded from documentation and must be confirmed once):

- [ ] `stablecoinchains`: confirm `totalCirculatingUSD.peggedUSD` field and
      chain naming (`BSC` vs `Binance`) — adapter has aliases, verify hits.
- [ ] `v2/chains`: confirm `Hyperliquid` naming variant (`Hyperliquid L1`?).
- [ ] `overview/dexs/{chain}`: confirm `total24h` and the `Hyperliquid` slug.
- [ ] **`bridgevolume/{chain}` sign convention**: check one chain against the
      defillama.com/bridges/chains UI. Code computes `net = depositUSD -
      withdrawUSD` (deposit = into the chain). If the UI disagrees, flip the
      sign in `live.bridges()` — one line, marked with a SIGN NOTE comment.
- [ ] Wormholescan `x-chain-activity/tops`: confirm response field names
      (`emitter_chain` / `destination_chain` / `volume`); adapter tries
      several but must be checked against a real payload.
- [ ] GeckoTerminal: confirm rate limit (docs have said both 30/min and
      10/min); current cadence uses ≤12 calls per 2 min. Throttle if 429s.
- [ ] CORS: all listed hosts are expected to allow browser origins — verify
      in a deployed environment, and move any that don't behind the collector
      worker (phase 2).

## Roadmap (post-v1, agreed order)

1. **Collector worker** (Cloudflare cron) — polls sources server-side, stores
   history in R2/D1, serves one CDN-cached snapshot JSON with ETag; browser
   polls every 20–30s. Removes client-side rate-limit exposure and starts
   the historical record for the time scrubber.
2. **High-confidence rivers**: Circle CCTP (clean USDC burn/mint) and the
   Hyperliquid Bridge2 contract on Arbitrum.
3. Trench feeds for Solana + Base (launch survival, not raw launch counts).
4. deBridge / LayerZero / Across corridors with explicit dedup.
5. Time scrubber over stored history.
6. **Trench Heat score** (0–100, with confidence %) — ships as beta only
   after enough stored history to backtest.
7. Paid data (CEX netflows etc.) only if the product proves out.

## Known limitations (v1, stated on purpose)

- Corridor coverage is Wormhole-only at first — a fraction of true bridge
  volume. The rivers understate reality and say so.
- CEX flows are absent entirely (better absent than wrong).
- Lake area uses DEX-category TVL as a proxy for executable depth; a 1%-depth
  metric replaces it later.
- Volume inputs are not yet wash-trading-adjusted.
