# 🧄 garlic.hood — the `.hood` identity layer for Robinhood Chain

**Not a launchpad.** garlic.hood is one on-chain contract, `GarlicRegistry`,
that gives every coin on Robinhood Chain an unspoofable `.hood` name.

- A `.hood` name is an ERC-721 you own.
- You **attach** it to a coin — a token launched on *any* Robinhood Chain
  platform (Pons, Hood.fun, or one launched later).
- The binding is **unique both ways**: one name ↔ one coin. No copycat can wear
  `pepe.hood` if the real `pepe.hood` already points somewhere.
- Wallets, explorers, and other launchpads call `nameForToken(coin)` to display
  a coin's verified identity — the anti-vamp guarantee, for the whole chain.

## The core calls

```solidity
// Register a name (ERC-721): registerSelf(label, years) or register(...)
// Then, as the name owner, bind it to your coin:
registry.attachToken("pepe", 0xCoin...);   // one-name-one-coin, enforced on-chain
registry.detachToken("pepe");              // frees both sides

// Anyone reads the identity (view, free):
registry.nameForToken(0xCoin...);          // → "pepe"   (verified) or ""  (none)
registry.tokenForName("pepe");             // → 0xCoin... or address(0)
```

`nameForToken` returns `""` if the name lapsed or the binding moved — so a stale
name never keeps vouching for a coin.

## How another platform (Pons, Hood.fun, …) integrates

1. **Show the badge.** On a coin page, call `nameForToken(coin)`. If it returns a
   name, render “🧄 `pepe.hood` — verified original”. If `""`, no verified name.
2. **Let their users claim.** After a launch, offer “Claim a .hood name” →
   `registerSelf` then `attachToken(label, coin)`. One transaction each, on the
   coin they just made.
3. **Trust the uniqueness.** Because the registry enforces one-coin-one-name,
   the platform doesn't have to police impersonation — the chain does.

No partnership or permission needed: it's a public contract. The address is
written to `app/registry.json` at deploy time.

## Anti-copycat, in two layers

- **On-chain (`GarlicRegistry`):** strict charset — `[a-z0-9-]`, 3–32 chars, no
  edge hyphen — rejects uppercase, unicode, and homoglyph tricks at registration.
  Plus the one-coin-one-name binding.
- **Off-chain (the app's GARLIC brain):** a **Garlic Score** (originality 0–100)
  and look-alike warnings (leet/homoglyph fold, affix strip, Levenshtein) so a
  user is warned *before* registering something confusingly close to a live name.

## Deploy just the registry

```bash
node scripts/compile.js
# testnet
PRIVATE_KEY=0x... node scripts/deploy-registry.js
# mainnet (chain 4663) — after an audit
NETWORK=mainnet PRIVATE_KEY=0x... node scripts/deploy-registry.js
```

Writes `app/registry.json` (chainId, rpc, explorer, registry address). That's the
whole backend — one contract. The rest is the front-end and the integration
calls above.

## Before mainnet

One small contract is a *far* smaller audit surface than a fund-handling
launchpad — but it still holds name ownership and fees, so get it audited before
public use, and confirm the mainnet chain params in `config/robinhood-chain.json`.
