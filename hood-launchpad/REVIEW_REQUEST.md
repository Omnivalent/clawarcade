# garlic.hood — external review request

*Paste this into Grok / ChatGPT / another reviewer and ask: "Review this design
and implementation. What's missing, what's risky, and what would you improve —
prioritized, with concrete suggestions?"*

---

## What it is

**garlic.hood** is a pump.fun-style token launchpad for **Robinhood Chain** (an
Arbitrum-stack Ethereum L2, ETH gas). The twist: every token is one unique
**`name.hood`** domain (via an ENS-fork name service, hood.ag). A `.hood` name
hosts exactly one live token, so nobody can spin up a near-identical
copycat/"vampire" coin under a confusingly similar name — hence "garlic" (anti-vamp).

Core loop, all in one transaction:
1. **Register** `name.hood` for 1 year (name service), custodied by the factory
   so its resolver record can't be re-pointed while registered.
2. **Deploy** a fixed-supply ERC-20 via CREATE2, address ground to end in
   `0x…600d` (EVM addresses are hex, so they can't literally end in "hood").
3. **List** it on a shared bonding curve (virtual-reserve constant product).
4. On **graduation** (curve sellout), seed a Uniswap pool with the reserved
   tokens + raised ETH, burn the LP, and auto-renew the name +5 years from the raise.

Name lifecycle: 1yr at launch → +5yr at graduation → if it never graduates, the
name lapses after a year and anyone can relaunch that `.hood`. A permissionless
`renewName()` lets anyone extend a name so it need never hard-expire.

## Tokenomics (mirrors pump.fun, ETH-scaled)

- 1B fixed supply: **793.1M** sold on the curve, **206.9M** reserved for the pool.
- Virtual reserves: **1.073B** tokens / configurable virtual ETH (prod ≈ 1.4 ETH).
- Graduation on curve sellout (≈2.833× virtual ETH raised, ~3.97 ETH at prod scale).
- Trade fee is a constructor param (0 in the test build, 100 bps = 1% in prod);
  fees **accrue** and are pulled via `collectFees()` so a bad recipient can't
  brick trading.

## Contracts (Solidity 0.8.26, viaIR, paris)

- `TokenFactory` — one-tx launch: CREATE2 vanity deploy + 1yr registration +
  curve listing + fees; optional commit-reveal (binds a launch to its committer
  to stop mempool front-running); graduation renewal with a **hijack guard** (a
  token's raise can never pay to renew a label that was relaunched to a
  different token); permissionless `renewName`.
- `BondingCurve` — singleton curve for all tokens. Quote and execute share one
  math path (so a quote can't disagree with the trade). **Ceil-division always
  rounds in the curve's favor.** Final buy is clamped to remaining supply with a
  refund (fee re-derived on ETH actually used, capped so the refund can't
  underflow). `buy`/`sell` take `minOut` **and** a `deadline` (anti-sandwich).
- `LaunchToken` — minimal ERC-20: no owner, no mint, no pause. The only mutating
  functions are `approve`/`transfer`/`transferFrom` (rug-proof by construction).
- `INameRegistrar` — provider-agnostic adapter interface; `HoodAgAdapter`
  targets hood.ag's ENS-fork controller (commit-reveal, USD pricing).
- `CommentBoard` — event-only social layer (comments are logs, ~a few thousand
  gas; read via `eth_getLogs`), with a per-author cooldown.
- Graduation handler is pluggable (escrow stand-in until the real Uniswap v3
  deployment addresses on Robinhood Chain are wired).

## Frontend (static, wallet-connected)

- Multi-wallet connect via **EIP-6963** (MetaMask, Phantom EVM, Coinbase, Rabby,
  Robinhood extension). **SIWE / EIP-4361** sign-in gates all writes; read-only
  until you sign in. Your `.hood` is your handle (account identity).
- Name search → register → launch (CREATE2 salt ground client-side); slippage +
  deadline on trades; on-chain comments; **top-10 leaderboard** sortable by
  market cap / 1h volume / age (computed from Launched + Buy/Sell events).

## Testing done

- 25 tests running the **real compiled bytecode** on @ethereumjs/vm (launch,
  vanity, fees, graduation renewal, hijack guard, expiry relaunch, commit-reveal,
  deadline/slippage reverts, comments) — all pass.
- Full dApp driven end-to-end in a real browser against a local chain (ganache):
  connect → SIWE → register+launch → buy → comment → leaderboard.
- A prior multi-agent review found & fixed: a fee overcharge on refunded ETH, a
  1-wei refund underflow, the renewal-hijack path, a missing renewal path
  (names could hard-expire), a `graduationEth=0` footgun, launch front-running,
  and a fee-recipient DoS.

## Known deferred (deliberate, pre-audit)

- Not yet on mainnet. hood.ag's **real verified contract addresses** must be
  wired into `HoodAgAdapter` (its selectors are currently an ENS-shaped guess).
- Uniswap v3 graduation handler needs the official Robinhood Chain addresses.
- Foundry/fork test suite (the JS EVM suite covers logic, not gas/fork behavior).
- No professional audit yet. No formal MEV analysis beyond slippage+deadline.
- Leaderboard queries events from block 0 each refresh — fine on testnet, needs
  an indexer (Ponder/Subsquid) or a bounded block window at scale.

## Specific questions for the reviewer

1. **Bonding-curve economics & MEV.** Is the constant-product virtual-reserve
   curve + `minOut` + `deadline` enough against sandwiching on a ~100ms-block L2,
   or should we add per-block buy caps, a commit-reveal on trades, or dynamic fees?
2. **Graduation atomicity.** Renewal → LP seed → LP burn happen in `_graduate`
   (best-effort try/catch on renewal). Any reentrancy, griefing, or stuck-funds
   risk you see in that sequence? Is "best-effort renewal, hard-capped at 10% of
   the raise" the right call vs. reverting?
3. **Name/token coupling.** The factory custodies the name and points its
   resolver at the token. Is the expiry→relaunch policy (old curve keeps trading,
   identity moves to the new token) sound, or a footgun for holders? Better model?
4. **CommentBoard as events-only.** Good enough for a social feed, or do we need
   on-chain storage / moderation / spam resistance beyond a per-author cooldown?
5. **Registrar abstraction.** Any risk in trusting a swappable `INameRegistrar`
   adapter (owner-settable)? How would you harden the hood.ag integration given
   its contracts aren't audited by us?
6. **Anything security-critical we're missing** — integer edges, approval races,
   griefing vectors, upgrade/ownership assumptions, or economic attacks on the
   curve or the leaderboard metrics (e.g. wash-trading the 1h volume ranking).
7. **Product/regulatory.** Beyond geo-blocking + ToS + non-custodial design,
   what would you add before a public launch of a memecoin launchpad?

Please rank your findings by severity and give concrete, minimal changes.
