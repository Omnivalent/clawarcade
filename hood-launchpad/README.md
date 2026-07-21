# 🧄 garlic.hood — the `.hood` identity layer for Robinhood Chain

**Give every coin on Robinhood Chain an unspoofable `.hood` name.**
Claim a `.hood` name (an ERC-721 you own), attach it to *one* coin — launched on
Pons, Hood.fun, or anywhere on-chain — and the binding is unique both ways: **one
name ↔ one coin, enforced on-chain.** No copycat can wear a name that's already
taken. Garlic keeps the vampires out.

> Not a launchpad. garlic.hood is **one contract** (`GarlicRegistry`) plus a
> thin app. Other platforms launch the coins; garlic.hood gives them identity.

## Try it

- **Wallet-connected app:** [`app/registry.html`](app/registry.html) — connect a
  wallet, claim a name, attach it to a coin, resolve names ⇄ coins. Reads the
  live registry from [`app/registry.json`](app/) (written at deploy time). Point
  it anywhere with `?registry=0x…&rpc=https://…&chainId=46630`.
- **Click-through simulation** (no wallet/backend): [`demo/garlic-registry.html`](demo/garlic-registry.html).

## What it is

| Piece | Role |
|---|---|
| `contracts/GarlicRegistry.sol` | **The whole backend.** A `.hood` name service — names are ERC-721 NFTs with expiry, renewal, a resolver, and reverse identity. Plus the **coin binding**: `attachToken(name, coin)` enforces one-name-one-coin; `nameForToken(coin)` returns a coin's verified identity. |
| `app/registry.html` + `registry-app.js` | The identity-layer front-end: claim, attach, resolve, Garlic Score. |
| `app/garlic.js` | The **GARLIC brain** — Garlic Score (originality 0–100) + look-alike warnings (leet/homoglyph fold, affix strip, Levenshtein). |
| `docs/IDENTITY_LAYER.md` | How other launchpads (Pons, Hood.fun) plug in — one public call, no partnership. |

## The core calls

```solidity
registry.registerSelf("pepe", 1);          // claim the name (ERC-721) for a year
registry.attachToken("pepe", 0xCoin...);    // bind it — one name ↔ one coin, on-chain
registry.nameForToken(0xCoin...);           // → "pepe"  (verified) or ""  (none)
registry.tokenForName("pepe");              // → 0xCoin... or address(0)
```

Any wallet, explorer, or launchpad calls `nameForToken(coin)` to show a coin's
unspoofable `.hood` identity. See [docs/IDENTITY_LAYER.md](docs/IDENTITY_LAYER.md).

## Anti-copycat, two layers

- **On-chain:** strict charset (`[a-z0-9-]`, 3–32, no edge hyphen) rejects
  uppercase / unicode / homoglyph tricks at registration; the coin binding is
  unique both ways.
- **Off-chain:** the GARLIC brain scores originality and warns on look-alikes
  *before* you register something confusingly close to a live name.

## Deploy (one contract)

```bash
npm install
node scripts/compile.js
# testnet (chain 46630)
PRIVATE_KEY=0x... node scripts/deploy-registry.js
# mainnet (chain 4663) — after an audit
NETWORK=mainnet PRIVATE_KEY=0x... node scripts/deploy-registry.js
```

Writes `app/registry.json` (chainId, rpc, explorer, registry address) — the app
reads it automatically. Robinhood Chain params live in
[`config/robinhood-chain.json`](config/robinhood-chain.json).

## Run the tests

```bash
node test/registry.test.js    # 16 GarlicRegistry tests (names + coin binding) on real bytecode
```

## Status

**Testnet-ready.** The identity layer is one audited-surface contract — a
fraction of the risk of a fund-handling launchpad. Before mainnet: get
`GarlicRegistry` audited, confirm the mainnet chain params, and add an events
indexer for the directory at scale. Not investment advice; testnet tokens have
no value.

---

<details>
<summary><b>Legacy: the full launchpad stack (no longer the product)</b></summary>

This repo began as a pump.fun-style launchpad. That code still compiles and
passes its tests, but **nothing in the identity layer depends on it** — the
project pivoted to being the identity layer other launchpads plug into.

`TokenFactory.sol` (one-tx launch), `BondingCurve.sol` (virtual-reserve curve),
`LaunchToken.sol` (minimal ERC-20), `adapters/UniswapV3GraduationHandler.sol`
(seeds a Uniswap-v3 / [SushiSwap CLAMM](https://docs.sushi.com/contracts/clamm)
pool and burns the LP), `CommentBoard.sol`. Tests: `test/evm.test.js` (29),
`test/graduation.test.js` (5). Deploy via `scripts/deploy.js`; see
`LAUNCH.md`. Keep it if you ever want a first-party launchpad; ignore it
otherwise.

</details>
