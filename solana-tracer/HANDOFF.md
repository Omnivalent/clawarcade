# Solana Wallet Tracer: handoff for Claude Code

Lives in the `solana-tracer/` folder of the clawarcade repo. Open Claude Code in the repo and say:
"Read HANDOFF.md and continue with the Next steps."

## Goal
A free scanner for Solana that does two things:
1. **Token in**: list the earliest buyers, find who funded each one, and link wallets likely run by the same operator (insiders, bundlers, pumpers).
2. **Wallet in**: show who funded it (chain upward) and which wallets it exchanged SOL/tokens with.

## Constraints from the user (ClawMD / Omnivalent)
- **Zero spend.** Free RPC tier only. No paid APIs.
- Non-technical builder, works with AI tools. Keep setup to copy-paste commands.
- Casual, concise, direct feedback. Challenge weak ideas instead of validating them.
- **Always print full addresses and full tx signatures, never abbreviated.**
- Never ask for or store API keys/private keys in chat. Keys live in env vars or local config only.

## Current state
- `solana_tracer.py` v2.2: single file, Python 3.8+, **standard library only**.
- `tests/` has 4 test files. `test_live_regressions.py` uses real mainnet txs saved in `tests/fixtures/` and has real asserts; the other 3 are print-only (pass = no crash). All pass.
- **First live run done 2026-11-13** on the public RPC (`api.mainnet-beta.solana.com`, no key). Token mode and wallet mode both ran end to end. NOT yet compared against Bubblemaps/GMGN, and NOT yet run on a token the user knows had insiders.

### First live run: what broke and what changed (v2 -> v2.1)
Test token: `DaWgMWCiJrP4M5PdQvvy1LDcP6rr2EZpuWkaC42kpump` (pump.fun, Token-2022, ~40k txs, launched 2026-11-11).
1. **Version 1 transactions are live on mainnet.** v2 asked for max version 0, so every v1 tx (incl. pump.fun creates) failed silently and the report showed 0 buyers. Fix: `get_tx` asks for v1 and steps up automatically if the RPC reports a newer version. Failed downloads are now counted in a NOTE.
2. **pump.fun launches are huge.** ~30k txs in the first 13 minutes. Default `--pages` raised 15 -> 60 (one cheap request per page; ~50s on the public RPC).
3. **New STRONG evidence: co-signed transactions.** Two buyer wallets signing the same tx = one operator holds both keys. Found live: `EazJVJBwStmxeEx478Q1EAVHZrZbSgXN7N4m3MSBET8a` + `5sY1ZuVuPN3VZBwRiEoaNHgTqXrZu9WTi1vqknvEqLdN` co-signed launch-slot buy `e6tE2MoqotRA8DAghmPeXmFJurgvw5sojatoFbriENGzQSXd7T4HKpxZv1FW1RTEwd65pyrxU7pA8Kp1k5qN26s`. The mint keypair (co-signer of the create tx) is excluded.
4. **Busy wallets were silently "funder unknown".** 26 of 40 early wallets had 3000+ txs (bots / serial traders). Now tagged `BUSY-WALLET` with a NOTE.
5. Deployer no longer also tagged SNIPER.
6. **Wallet mode:** off-curve counterparties (bonding curves/pools) are listed separately instead of as "connected wallets". Unlabeled 1000+ tx addresses are now called "BUSY: exchange, bot OR serial operator", not "weak link". Live evidence why: `EazJVJ...` sent 11 SOL in 22 txs to the deployer `7jQwHdK771P286Vsn44v7dFVfCH8CzZcL3PZGidbShch`, which v2 hid as a "HUB/weak link".

### Second live run (v2.2): user's coin `C5xph2yL6gMdxmuLGxJBkGpmuDFfyi5fqkBNhvL6pump`
- Mint history is 300k+ txs (graduated, traded on PumpSwap); 300 pages did not reach launch. Scanning the **bonding curve** `9nzxFL6UXZiMhPSyCqNDTXmPNdCUhtY3jwKoh7FTdeEP` instead reached launch at once, because nothing trades on the curve after graduation.
- **Auto-source added (old step 3, done):** token mode derives the pump.fun bonding-curve PDA (seeds `"bonding-curve"` + mint, program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) and uses it as source when it exists. `--no-auto-source` turns it off.
- Curve account layout used: 8-byte discriminator, 5 x u64 reserves/supply, `complete` bool at byte 48, `creator` pubkey at bytes 49..81. **On graduated coins `creator` is an off-curve program account (fee sharing?), not the launcher**, so it is only reported when on-curve. Verified on 3 coins.
- Report now prints the **deployer's own launch buy**: here 337,603,576 tokens = 34.07% of supply in the create tx `624TnKBFx3gTaNVFKyvp48jro1Bu4VDcyh2ySmq1hWbSXE21fjg4fcKCeDRV1ACTGRrM9Sso2Hr8xePVz7X9TQBz`.
- **Repeat operators across the two scanned coins (manual observation, the case for step 5):** deployer `7jQwHdK771P286Vsn44v7dFVfCH8CzZcL3PZGidbShch` launched both; `CvNiezB8hofusHCKqu8irJ6t2FKY7VjzpSckofMzk5mB` sniped both (slot +4 here, 3.68% of supply); `J4hrKzU3oNwmAk1L93woL2qVW2uAkZ3XQpx52WnAQupw`, `6aXFYXbFob1ZKAEDCcqZnX2vooA3TgEqDoy5dAQbeWoV`, `5qMp9p2oFJx1Y2rLZ1X5kUbmXnpMvn5THtDP5NLsxaHK` were early buyers in both.
- Tool found one HIGH cluster (`EMs5ADozSJSbndHGRaCCATCGFuwGycHbVkXuoJwemoae` + `72LKgbeyzmZRM3xBgKHBSrPcgdb49LZq71rRzqgcEA5H`, shared funder `UiAY8zbXYgBd2BDiQrMVKmKiVTywisVkcYFPdWineyg`, 3.32% of supply). It does NOT yet link the deployer to the snipers; that needs step 2 (deployer<->buyer SOL flows) and step 5 (cross-coin memory).
- "sold" figures cover only the scanned launch window (`--first` txs), not later sales.

Result on the test token: deployer + a 3-wallet launch-slot bundle (`CvNiezB8hofusHCKqu8irJ6t2FKY7VjzpSckofMzk5mB` funded `EazJVJ...`, which co-signed with `5sY1Zu...`) that bought 9.37% of supply and holds 0% now. Token mode does NOT link that cluster to the deployer; only wallet mode on `EazJVJ...` shows the 11 SOL flow. Sell tracking (step 2) should close this gap.

### Setup and usage
```
export SOLANA_RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_FREE_KEY"   # optional; without it the public RPC is used (works, slower)
python3 solana_tracer.py token  <MINT>    [--first 100] [--hop2] [--merge-soft] [--labels labels.csv] [--source ADDR]
python3 solana_tracer.py wallet <ADDRESS> [--limit 300] [--trace-up 3] [--labels labels.csv]
```
Outputs `trace_token_<mint6>.csv/.json` and `trace_wallet_<addr6>.csv/.json`.
Cache: `~/.solana_tracer_cache` (disable with `TRACER_CACHE=none`). Tunables: `TRACER_RPS` (default 8), `TRACER_WORKERS` (default 4).

### How token mode works
1. `getSignaturesForAddress` on the mint (or `--source`), paged back to the start (max `--pages`, default 15).
2. Parse the oldest `--first` txs with `getTransaction` (jsonParsed). Buyers = signers whose token balance for the mint rose.
3. Pools/curves are excluded two ways: balance fell without signing, or the address is **off the ed25519 curve** (PDA). `on_curve()` is a pure-Python RFC 8032 check; verified on 2000 genuine keys.
4. Deployer = signer of the true first tx, only if the start of history was reached.
5. Funder of each wallet = first incoming SOL transfer >= 0.01 SOL among its 6 oldest txs.
6. Hub detection: a funder with a full page (default 1000) of signatures is treated as an exchange/router/bot (cheap proxy for Bubblemaps "supernodes"). Labeled addresses are always hubs.
7. Evidence: STRONG = shared non-hub funder, or funded by deployer / another early wallet. MEDIUM = funders share an upstream funder (`--hop2`). SOFT = same amount from a hub within `--hub-window`, or same slot; shown separately, merged only with `--merge-soft`.
8. Union-find builds clusters from strong+medium. Confidence from corroboration count (identical funding amounts, funded within 1h, buys within 60s, same slot, fresh wallets). Also prints % of supply bought in the window and % still held now.

## Research findings that drove the design
- **Bubblemaps**: links = on-chain transfers between top-250 holders; hides CEX/DEX/contracts; "supernodes" = very high-volume addresses; Time Nodes link wallets that used the same exchange in the same time window. Docs warn a cluster is not proof of a scam.
- **Arkham**: value is mostly entity labels (crowdsourced + ML). Treat labels as clues. We cannot copy its data; `labels.csv` lets the user paste labels manually.
- **Open source references**: nullxnothing/ricomaps (BFS funding tracer, same-slot bundles, union-find, sniper = first 10 blocks / 60s), koclaw/CabalScanner (60s buy window), agiprolabs sybil-detection skill (cluster = 3+ wallets from one funder, identical funding amounts, funding within 24h of creation), Pine Analytics report (deployer-to-sniper direct SOL transfer is the high-signal filter; they only did 1 hop and missed deeper chains).
- **Same-slot alone is weak evidence** (competing searchers). Shared funding ancestry is the strongest signal.
- **Helius `funded-by` API needs a paid plan** (free keys get 403), so funder tracing uses plain RPC.
- **GMGN**: official agent API/CLI (`gmgn-cli`, Ed25519 key from gmgn.ai/ai, read-only vs trading permission). Not integrated. User pasted a key in chat once; it should have been revoked and regenerated. Never use or store it.

## Known limitations (be honest about these in any output)
- **Mint-address scanning can miss early swaps** on pools whose swap instructions don't reference the mint (e.g. Raydium AMM v4). pump.fun coins are now handled automatically (bonding curve used as source); for other launchpads use `--source <pool address>`.
- Busy tokens: if history isn't reached in `--pages`, results are NOT the true first buyers (the tool prints a NOTE and disables deployer/sniper tags).
- Funder lookup scans only the 6 oldest txs of up to 3000 sigs; deeper wallets get a `FUNDER?` tag.
- Hub heuristic can misclassify: a busy serial farmer with 1000+ txs looks like a hub; a small exchange-like wallet may not. Adjust `--hub-threshold` and use `labels.csv`.
- Only direct `system transfer` SOL funding is parsed (no `createAccount`, `transferWithSeed`, or funding via custom programs). Funding routed through intermediary programs may be missed.
- **Co-sign evidence assumes no shared fee-payer relayer.** A "gasless" relayer that co-signs many users' txs would create false STRONG links if it also bought. Not seen yet; watch for it.
- **Bot-heavy launches defeat funder tracing.** Most early buyers of a busy pump.fun coin have 3000+ txs, so their original funder is out of reach on the free tier (`BUSY-WALLET`).
- **MEV tip / fee accounts show up as busy counterparties in wallet mode** (seen: vanity-prefixed `noz...`, `dev...`, `ja...`, `jz...` addresses receiving small SOL amounts). Not identified with certainty, so not hardcoded; add them to `labels.csv` once confirmed.
- Clusters are leads, not proof. Exchanges, shared airdrop/treasury wallets and market makers create false links.
- Free-tier RPC rate limits: throttled client-side to 8 req/s with retry/backoff.

## Next steps (in order)
1. **Finish the first live run.** Done: parser fixes for v1 txs / Token-2022 / busy wallets (see above). Still to do: run on a token the USER knows had an insider group and compare with Bubblemaps/GMGN by hand. Keep adding a regression test + fixture per fix.
2. **Sell tracking.** Also add the deployer-to-buyer direct SOL check (Pine Analytics' high-signal filter) — the live run showed it is the missing link. For each cluster member, follow SOL/token proceeds after sells: where do they consolidate? Output "exit wallets" and cluster-level realized PnL. This is the user's main interest (pumpers/sellers).
3. **Auto `--source`: pump.fun done (v2.2).** Remaining: other launchpads (e.g. LetsBonk / Raydium LaunchLab, Meteora DBC) and graduated-pool detection for non-pump coins.
4. **Visual map.** A single self-contained HTML (no build step, free hosting like surge.sh, as the user did for ClawTrends) that loads `trace_token_*.json` and draws a force graph with cluster colors, hub nodes dimmed, and supply-sized bubbles.
5. **Serial-operator memory.** Local SQLite/JSON store of wallets and funders across scans; flag repeats ("this funder appears in 4 earlier tokens").
6. **Optional enrichment**, only if free: GMGN read-only key via `gmgn-cli` as a cross-check, never required. Keep the RPC-only path working.

## Working agreements
- Keep it stdlib-only unless there is a strong reason; the user installs nothing.
- Review the code more than once and test before claiming it works. Say plainly what was tested offline versus live.
- Never print abbreviated addresses. Never commit keys; read them from env vars.
