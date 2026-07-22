# garlic.hood — project brief + open questions (for external review)

*Paste this whole doc into another AI (ChatGPT / Grok). It's self-contained.
I want a critical second opinion on the design, the economics, the go-to-market,
and the security — not encouragement. Push back hard where I'm wrong.*

---

## 1. What this is

**garlic.hood is an on-chain identity layer for Robinhood Chain** (a new
Arbitrum-stack Ethereum L2; native gas token is ETH; mainnet chain ID 4663,
testnet 46630; launched ~July 2026, tokenized-stocks focus).

The problem it solves: memecoins have a **copycat / impersonation problem** — a
name + ticker is not unique, so scammers clone a popular coin's identity. On
Robinhood Chain, multiple launchpads exist or are coming (e.g. Pons /
ponsfamily.com, Hood.fun). None of them own a shared, unspoofable naming system.

garlic.hood provides one: **a `.hood` name that attaches, uniquely, to a single
coin.** One name ↔ one coin, enforced on-chain. Wallets, explorers, and other
launchpads read one contract to show a coin's verified identity and a "🧄
verified original" badge.

**It is deliberately NOT a launchpad.** We pivoted away from launching coins
ourselves. We don't want to compete with Pons/Hood.fun — we want every coin they
launch to be able to wear a verified `.hood` name.

## 2. What we've actually built (working, tested)

- **`GarlicRegistry.sol`** — the entire backend, one contract:
  - `.hood` names are **ERC-721 NFTs** (ownable, tradeable) with per-year pricing
    by length (3 / 4 / 5+ chars), expiry, renewal, a resolver, and reverse
    identity (primary name).
  - **Coin binding (the core feature):**
    - `attachToken(label, coin)` — the name's owner binds their live name to a
      coin address. Enforces **one coin ↔ one name**: a coin already bound to a
      different name reverts (`"coin already named"`). Rebinding a name to a new
      coin frees the old coin. Re-registering a lapsed name releases any coin it
      held.
    - `nameForToken(coin) → string` — the verified name for a coin, or `""` if
      none / the name lapsed / the binding moved. **This is the call other
      platforms make.**
    - `tokenForName(label) → address`, `detachToken(label)`.
  - **Anti-copycat, on-chain:** strict label charset `[a-z0-9-]`, 3–32 chars, no
    edge hyphen — rejects uppercase, unicode, and homoglyph tricks at
    registration.
  - **16 tests pass on real compiled bytecode** (via @ethereumjs/vm), including
    all coin-binding edge cases.
- **Off-chain "GARLIC brain"** (JS): a **Garlic Score** (originality 0–100) and
  look-alike warnings using leet/homoglyph folding, affix stripping, and
  Levenshtein distance — warns a user *before* they register something
  confusingly close to an existing live name.
- **Front-end** (`app/registry.html` + `registry-app.js`): wallet-connected,
  reads the deployed registry, does real `registerSelf` + `attachToken`, resolves
  both directions, builds its name corpus and directory from on-chain events
  (`NameRegistered`, `TokenAttached`). Verified end-to-end against a registry
  deployed on a local chain.
- **Deploy:** `scripts/deploy-registry.js` deploys just the one contract to
  testnet or mainnet and writes the app's config. SushiSwap CLAMM (a Uniswap-v3
  fork) is confirmed deployed on Robinhood Chain and was wired for an optional
  first-party graduation path — but that belongs to the abandoned launchpad and
  is not part of the identity layer.

## 3. Current status

- Testnet-ready. Not yet deployed to a public network. Not audited.
- Repo is public. Solidity 0.8.26.

---

## 4. Open problems & design tensions — tell me where I'm wrong

### A. The attach authority / squatting problem (biggest one)
Today, **the `.hood` name owner is the sole authority** for what coin the name
points to. `attachToken` requires you to own the name; it does NOT require any
proof that you control the coin. Uniqueness is enforced on the *coin* side
(first name to claim a coin wins).

- Risk 1 — **impersonation squatting:** someone registers `pepe.hood` and attaches
  it to a `pepe` coin they don't own, to look official.
- Risk 2 — **coin-side land-grab:** someone attaches *their* name to a famous
  coin first, blocking the real project from ever binding a name to it.

Options I see, all flawed:
1. Name-owner attaches (current) — simple, but both risks above.
2. Require the coin to opt in (coin calls the registry, or signs) — but most
   memecoins renounce ownership or are deployed by contracts that will never
   integrate.
3. Deployer-proves-control (e.g. the coin's `owner()` or deployer EOA must
   confirm) — breaks for renounced/ownerless coins, which is most of them.
4. Social/curated layer (garlic.hood admin can slash a fraudulent binding) —
   centralizes trust, which undercuts the "trustless identity" pitch.

**Question:** what's the right authority model for binding a name to a coin the
name-owner may not control, on a chain full of ownerless memecoins? Is there a
credible-neutral mechanism (stake + challenge? first-seen from a coin's own
deploy tx? reverse resolution from the token contract?) that resists both
squatting directions without a central referee?

### B. Why would anyone pay for this? (demand)
The value only exists if wallets/explorers/launchpads actually *read*
`nameForToken` and show the badge. That's a cold-start / two-sided problem: users
won't pay for names no one displays; platforms won't display names no one has.

**Question:** what's the minimum viable wedge to break the cold start? Is it
better to (a) get ONE launchpad (Pons/Hood.fun) to display the badge first, (b)
get a wallet/explorer to resolve `.hood` first, or (c) seed demand by giving
famous coins their names for free? Is this even a venture-scale idea or a feature
that a launchpad will just build in-house and kill us?

### C. Competitive moat
The concept is simple and forkable. What stops Pons from shipping their own
name-registry in a week and not needing us? Our only structural advantages seem
to be: being the *neutral cross-platform* registry (no single launchpad wants to
cede naming to a competitor), and the anti-copycat scoring. **Is neutrality a
real moat here, or wishful thinking?**

### D. Monetization
Currently: sell names (per-year pricing by length). Alternatives: take a cut of
name trades, charge platforms for the verification API/badge, premium names,
subscriptions. **What actually captures value in an identity layer, given the
read path (`nameForToken`) is a free on-chain view anyone can call?**

### E. Name lifecycle vs. coin permanence
Coins are forever; names expire (1yr default, renewable). If `pepe.hood` lapses,
`nameForToken(pepeCoin)` starts returning `""` and the coin loses its verified
identity — and someone else could grab `pepe.hood` and point it elsewhere. **Is
expiring identity a feature (keeps names circulating) or a footgun (a coin's
verified identity can be yanked)? Should a name that's bound to a coin be
non-expiring, or auto-renew, or transfer with the coin?**

### F. Security / audit scope
It's one ERC-721-plus-binding contract. Known surface: hand-rolled ERC-721
(not OpenZeppelin), payable register/renew with refunds, the binding mappings,
owner-settable prices + withdraw. **What are the highest-risk bug classes for a
contract like this, and is a hand-rolled ERC-721 a mistake vs. importing a
battle-tested one? What would you specifically fuzz/test before mainnet?**

### G. Legal / trademark
If we let people attach `.hood` names that mimic real brands or coins, are we
exposed (trademark, facilitating impersonation, securities framing since the
chain is Robinhood's)? We take fees. **What are the real legal risks of running a
naming/identity registry that others use to label financial tokens, and how do
comparable systems (ENS, etc.) handle disputes/takedowns?**

---

## 5. Specific technical questions

1. **Homoglyph/confusable defense:** on-chain we restrict to `[a-z0-9-]`.
   Off-chain we score similarity (leet fold + Levenshtein). Is there a
   stronger, standard confusable-detection approach (Unicode TR39 skeletons,
   etc.) worth porting, and can any of it be enforced on-chain cheaply?
2. **Corpus without an indexer:** the app builds its known-names list from
   `eth_getLogs` over `NameRegistered`. That won't scale and some RPCs cap log
   ranges. What's the right lightweight indexing approach for a small registry
   (subgraph? a tiny custom indexer? on-chain enumeration via ERC-721
   Enumerable)?
3. **Binding integrity:** is enforcing uniqueness only on the coin side (a coin
   maps to at most one name) plus name-owner-authority enough, or should the
   token contract itself be able to *revoke* a name pointed at it?
4. **Gas/UX:** claiming = two txs (register, then attach). Worth adding a single
   `registerAndAttach` for one-tx UX, or keep them separate?
5. **Cross-chain:** if other Robinhood-adjacent chains appear, should `.hood`
   names be portable, and how (bridge the NFT, or re-resolve per chain)?

---

## 6. What I want back

Rank the open problems by how likely each is to kill the project. Then give me
your single strongest recommendation for the **authority/squatting model (4A)**
and the **cold-start wedge (4B)** — those two feel decisive. Be blunt.
