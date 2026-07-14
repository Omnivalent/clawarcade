# hoodpad — the launchpad where every token owns its name

*One-page rundown for the team · July 14, 2026*

## The idea in one sentence

A pump.fun-style fair-launch platform on **Robinhood Chain** where launching a
token atomically claims a unique **`name.hood`** domain that permanently
resolves to the token contract and hosts its website — so tokens are known,
found, and traded by name (`supercat.hood`), not by hex address.

## Why now

- **Robinhood Chain mainnet went live July 1, 2026** (Arbitrum-stack Ethereum
  L2, ETH gas, ~100ms blocks). It hit **$568M+ daily volume and 190k daily
  active addresses within the first week**, and analysts note the early
  momentum is driven by **memecoins**, not tokenized stocks.
- **Uniswap is a day-one partner** on the chain — a ready-made graduation
  venue for tokens that complete their bonding curve.
- The window is measured in weeks, not months: generic launchpads already
  exist (see Competition), but **none owns the identity layer**.

## One launch transaction does four things

1. **DEPLOY** — token deployed via CREATE2 with a ground vanity address
   ending `...600d` (the house signature; ~65k keccak hashes, under a second,
   ground live in the user's browser).
2. **REGISTER** — `name.hood` registered through the domain registry and
   **locked to the token forever** (the launchpad, not the creator, holds the
   name NFT — it can never be re-pointed at a scam contract).
3. **LIST** — token opens on a bonding curve: no presale, no team allocation,
   creator posts zero liquidity; trade fee is configurable (1% pump.fun-style
   in production, zero in the private test build).
4. **HOST** — `name.hood` serves the token's page (chart, curve progress,
   socials) via the domain's website record.

**Uniqueness is the hook:** names are first-come-first-served on-chain
ERC-721s. Once `supercat.hood` launches, nobody can ever launch it again.
Squatting a name costs real money (registration is folded into the launch fee
— ~$5/yr for 5+ characters at current registry pricing).

Graduation mirrors pump.fun exactly: when the curve sells out its 793.1M
allocation (≈3.97 ETH raised at production settings), the raised ETH plus the
reserved 206.9M tokens auto-seed a Uniswap pool and **the LP is burned** —
the standard rug-proof graduation. The name is auto-renewed 5 more years
(~$25) out of the raise at the same moment; names of tokens that never bond
lapse after their initial year so the label gets a second chance.

## Honest technical note (get this right in the pitch)

A contract **address** cannot literally end in "hood" — EVM addresses are
hexadecimal and `h`/`o` aren't hex digits (pump.fun's `...pump` works only
because Solana uses base58). Our answer is two-layered: the ground `...600d`
hex signature on every address, and the `.hood` **name** as the real
"ends-in-hood" identity. Anyone technical will check this; own it upfront.

## The .hood provider landscape (legitimacy check, as of July 14)

At least three unaffiliated projects claim the `.hood` namespace. **None is
official Robinhood infrastructure.**

| Provider | Signals for | Signals against |
|---|---|---|
| **hood.domains** ("HoodDomains", $HD token) | Broadest product surface (marketplace, x402 payments, AI-agent naming, revenue-share staking); token has exchange info pages (MEXC); most visible marketing | Token-first model adds speculative/regulatory surface; loud trash-talk marketing; claims vs. audits unverified |
| **hood.ag** | Cleanest architecture: ENS-fork registrar (ERC-721) + resolver + commit-reveal anti-sniping; transparent flat pricing ($5/yr for 5+ chars); developer-friendly docs (machine-readable contract docs) | Rival publicly calls it a "60-minute ENS fork" with unpatched issues (unverified competitor FUD, but audit status unknown) |
| **hoodns.xyz / hoodnames.io / others** | Exist | Thin public footprint |

**Verdict:** hood.domains currently shows the most *traction* signals;
hood.ag shows the most *engineering credibility* for integration (ENS-style
contracts, commit-reveal, flat pricing). It is genuinely too early to call a
winner — which is exactly why the build is **registrar-agnostic**: the
launchpad talks to a pluggable `INameRegistrar` adapter, and we can integrate
either (or both, or switch) without touching the core. Before any deal:
verify contracts on the Robinhood Chain explorer, check for audits, and test
registrations with a burner wallet.

## Competition (two weeks after chain launch)

Generic pump.fun clones are already live: **hood.fun** (launched July 9,
~$44k graduation to Uniswap v3, LP locked), robinfun.live, hoodlauncher.fun,
robinlaunch.fun. A plain clone is therefore already late. **The defensible
piece is the name layer**: unique, squatting-priced, rug-proof `.hood`
identities with hosted token pages — plus, ideally, an exclusive or preferred
partnership with the winning registry. That partnership is the moat; the
curve is a commodity.

## What's already built (this repo, `hood-launchpad/`)

- **Contracts (compile clean, solc 0.8.26):** `TokenFactory` (one-tx launch:
  CREATE2 vanity deploy + name registration + curve listing + fees),
  `BondingCurve` (virtual-reserve constant-product, 1% fee, clamped final
  buy, dual graduation trigger), `LaunchToken` (fixed 1B supply, zero owner
  powers), `INameRegistrar` adapter interface + mock, graduation-handler
  interface + escrow stand-in.
- **Property tests** on the curve's exact integer math — all passing (they
  already caught and fixed a real rounding exploit and an unreachable
  graduation threshold).
- **Vanity grinder** — real CREATE2/keccak salt grinding, `...600d` in under
  a second.
- **Interactive demo** (`demo/index.html`, no backend — open in any browser):
  claim a name → watch the address get ground live with real keccak-256 →
  trade the bonding curve with the contract's exact math → graduate.
  Clearly labeled as a simulation.

**Not built yet (deliberately):** the real registrar adapter (needs provider
choice + their contract addresses), the Uniswap graduation handler (needs the
official Robinhood Chain deployment addresses), Foundry test suite, indexer,
production frontend, audit.

## Legal flags before going official (not legal advice — hire crypto counsel)

1. **"Permissionless" doesn't shield the operator.** Regulators and
   plaintiffs target the fee-taking frontend: pump.fun itself faces US
   class actions and was blocked by the UK FCA. Budget for a real legal
   opinion before mainnet.
2. **Securities**: SEC staff's 2025 view is that typical memecoins aren't
   securities, but it's fact-specific — *promoting/featuring* tokens moves
   you toward offering-participant territory. Marketing copy matters.
3. **AML / money transmission**: stay strictly non-custodial; geo-block
   sanctioned jurisdictions (and consider US/UK); OFAC screening on the
   frontend.
4. **Facilitation**: users will launch scams. Need ToS, impersonation
   takedowns on the frontend, abuse reporting.
5. **Trademark**: "HOOD" is Robinhood's ticker and nickname. The entire
   `.hood` ecosystem lives in Robinhood's brand shadow without permission —
   this risk sits *under* every provider and this platform. Name the product
   accordingly and get counsel's view.
6. **Entity/structure**: decide jurisdiction + entity before revenue, not
   after.

## On selling the idea instead of building

The idea alone is unprotectable (no patent/copyright on a mechanic; clones
ship in days). What's sellable is: a **working MVP** (this repo is the
start), a **registry partnership** (the true moat), and **speed** on a
two-week-old chain. If pitching outsiders, use an NDA and show the demo, not
the architecture.

## Suggested next 30 days

1. **This week:** contact both hood.domains and hood.ag; verify their
   contracts/audits on-chain; negotiate bulk/permanent registration + rev
   share. Pick the adapter target.
2. **Weeks 2–3:** Foundry tests, real registrar adapter, Uniswap graduation
   handler; deploy to Robinhood Chain testnet.
3. **Week 4:** security review/audit booking, legal consult, closed beta.
