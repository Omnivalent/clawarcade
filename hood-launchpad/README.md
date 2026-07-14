# hoodpad — token launchpad with .hood identity (MVP scaffold)

A pump.fun-style launchpad for **Robinhood Chain** where every token launch
atomically claims a unique **`name.hood`** domain that resolves to (and is
permanently locked to) the token contract. See [PITCH.md](./PITCH.md) for the
full concept, market context, and legal notes.

**Status: pre-partnership scaffold.** Everything here is deliberately
independent of any specific .hood provider — the registrar is a pluggable
adapter (`INameRegistrar`), so the same launchpad works with hood.ag,
hood.domains, or whichever registry wins the namespace.

## What's here

| Path | What it is |
|---|---|
| `contracts/TokenFactory.sol` | One-tx launch: CREATE2 deploy (vanity `...600d` address) + .hood registration + curve listing + fee collection |
| `contracts/BondingCurve.sol` | Singleton virtual-reserve constant-product curve (1% fee, graduation to a pluggable handler) |
| `contracts/LaunchToken.sol` | Minimal fixed-supply ERC-20 — no owner, no mint, no pause (rug-proof by construction) |
| `contracts/interfaces/INameRegistrar.sol` | The provider-agnostic .hood adapter interface (incl. commit-reveal support) |
| `contracts/mocks/` | `MockRegistrar` (hood.ag-style pricing) + `GraduationEscrow` (stand-in for the Uniswap v3 handler) |
| `scripts/compile.js` | solc 0.8.26 compile check, writes ABIs/bytecode to `build/` |
| `scripts/grind-salt.js` | CREATE2 vanity-salt grinder (`...600d` in <1s) |
| `test/curve.test.js` | Property tests on a BigInt mirror of the curve's exact integer math |
| `demo/index.html` | Interactive simulation: name claim → live keccak grinding → curve trading. Zero backend, open in a browser. |

## Run it

```bash
npm install
node scripts/compile.js       # compile-check all contracts
node test/curve.test.js       # curve economics property tests
node scripts/grind-salt.js --demo   # watch a ...600d address get ground
open demo/index.html          # the interactive demo
```

## Key design decisions

- **Addresses can't end in "hood"** — EVM addresses are hex; `h`/`o` don't
  exist. The house signature is a CREATE2-ground `...600d` suffix (~65k
  hashes ≈ <1s, ground in the user's browser); the *name* `name.hood` is the
  real "ends in hood" identity.
- **Rounding always favors the curve** (`_ceilDiv` on every `k/reserve`
  division). The property tests caught the naive version leaking value.
- **Graduation triggers on ETH threshold OR curve sellout**, whichever first;
  the final buy is clamped with a refund so the 200M LP reserve is never sold.
- **Name NFT is owned by the factory**, not the creator, so `name.hood` can
  never be re-pointed at a different contract.

## Next steps (in order)

1. Foundry test suite against the real bytecode (these JS tests mirror the
   math; they don't execute the contracts).
2. Registrar adapter for the chosen .hood provider (commit-reveal flow).
3. Uniswap v3 graduation handler for the official Robinhood Chain deployment
   (pool create + seed + LP burn).
4. Indexer + real frontend; testnet deploy; audit.
