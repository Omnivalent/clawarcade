# hoodpad — token launchpad with .hood identity (private test build)

A pump.fun-style launchpad for **Robinhood Chain** where every token launch
atomically claims a **`name.hood`** domain that resolves to (and is custodied
away from the creator with) the token contract. See [PITCH.md](./PITCH.md)
for concept, market context, and legal notes.

**Registrar-agnostic by design.** The launchpad talks to a pluggable
`INameRegistrar` adapter. The production target is hood.ag
(`contracts/adapters/HoodAgAdapter.sol`, ENS-fork controller — verify its
selectors against hood.ag's published contract docs before mainnet); demos
and tests run on `MockRegistrar`, which mimics hood.ag's pricing and expiry.

## Tokenomics (pump.fun, ETH-scaled)

- 1B fixed supply: **793.1M** sold on the curve, **206.9M** reserved for the
  graduation pool (LP burned) — pump.fun's exact split.
- Virtual reserves: **1.073B tokens** / configurable virtual ETH
  (production 1.4 ETH ≈ pump.fun's 30 vSOL; test deploys scale it down).
- Graduation on **curve sellout** (≈2.833× virtual ETH raised — ~3.97 ETH at
  the production setting), like pump.fun. An optional lower ETH trigger is
  supported; zero is rejected at construction.
- Trade fee is a constructor parameter (0 for the private test config,
  100 bps = pump.fun-style 1% for production). Fees **accrue** and are pulled
  via `collectFees()` — a broken recipient can never block trading.

## Name lifecycle policy

1. **Launch**: `name.hood` registered for **1 year** (cost folded into the
   launch fee; ~$5/yr for 5+ chars at hood.ag pricing), custodied by the
   factory so it can't be re-pointed while registered.
2. **Graduation**: the curve hands the factory a budget (hard-capped at 10%
   of the raise) and the name is **auto-extended 5 years** (~$25) — or
   re-registered if it lapsed mid-bonding. A raise never pays for a label
   that was relaunched to a different token.
3. **No graduation**: the registration lapses after the year, and the same
   label can be launched again by anyone — a second chance for good names.
4. **Anytime**: `renewName()` is permissionless, so a community can keep a
   name alive forever even though the factory holds the NFT.

## What's here

| Path | What it is |
|---|---|
| `contracts/TokenFactory.sol` | One-tx launch: CREATE2 (vanity `...600d`) + 1yr .hood registration + curve listing + fees; commit-reveal anti-frontrun (optional); graduation renewal with hijack guard; permissionless `renewName` |
| `contracts/BondingCurve.sol` | Singleton virtual-reserve curve; quote/execute share one math path; curve-favoring rounding; clamped final buy with refund; budgeted best-effort renewal at graduation |
| `contracts/LaunchToken.sol` | Minimal fixed-supply ERC-20 — no owner, no mint, no pause |
| `contracts/interfaces/INameRegistrar.sol` | Provider-agnostic .hood adapter interface (register/renew/expiry/commit) |
| `contracts/adapters/HoodAgAdapter.sol` | hood.ag (ENS-fork controller) adapter skeleton with integration TODOs |
| `contracts/mocks/` | `MockRegistrar` (hood.ag-style pricing + expiry) and `GraduationEscrow` (stand-in for the Uniswap v3 handler) |
| `test/evm.test.js` | 20 end-to-end tests running the **real compiled bytecode** on @ethereumjs/vm — launch, vanity, fees, graduation renewal, hijack guard, expiry relaunch, commit-reveal |
| `test/curve.test.js` | Property tests on a BigInt mirror of the curve's integer math |
| `scripts/compile.js` | solc 0.8.26 (viaIR, paris) compile to `build/` |
| `scripts/deploy.js` | Deploy the stack with your key (defaults: Robinhood Chain testnet, zero fees) |
| `scripts/launch-token.js` | Grind a salt, launch a token, optional first buy — against your deployment |
| `demo/index.html` | Interactive simulation of the full flow incl. the name-expiry lifecycle. No backend. |

## Run it

```bash
npm install
node scripts/compile.js          # compile-check all contracts
npm test                         # curve property tests + real-EVM end-to-end tests
open demo/index.html             # the interactive simulation

# your own private testnet deployment (free faucet ETH):
#   https://faucet.testnet.chain.robinhood.com
PRIVATE_KEY=0x... node scripts/deploy.js
PRIVATE_KEY=0x... FIRST_BUY_ETH=0.01 node scripts/launch-token.js supercat "Super Cat" SCAT
```

## Key design decisions

- **Addresses can't end in "hood"** (hex has no h/o). The house signature is
  a CREATE2-ground `...600d` suffix (~65k hashes, <1s, ground client-side);
  the `.hood` *name* is the real identity.
- **Rounding always favors the curve** (`_ceilDiv` on every `k/reserve`
  division), and quotes reuse the execution math verbatim so a frontend
  quote can never disagree with the trade.
- **Graduation renewal is best-effort and budget-capped**: a reverting,
  compromised, or overpriced registrar can never block a graduation or spend
  more than 10% of the raise.
- **Launch commit-reveal binds the committer**, so copied mempool calldata
  can't steal a launch (off by default for private testing via `COMMIT_AGE`).

## Known deferred items (deliberate, pre-audit)

- Foundry test suite against a forked chain (the JS EVM suite covers logic;
  gas/fork behavior still needs forge).
- Uniswap v3 graduation handler (escrow stands in until the official
  Robinhood Chain deployment addresses are wired).
- hood.ag adapter selector verification + burner-wallet integration test.
- Gas polish: `Curve` struct packing, single-slot accounting. Documented in
  review notes; skipped to keep the audit surface simple.
