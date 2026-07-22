# garlic.hood v2 — from "unilateral binding" to "provenance attestation"

Two independent AI reviews (Grok, ChatGPT) converged on one fatal flaw and one
fix. This doc records the redesign so we can decide how far to take it.

## The fatal flaw they both found

`attachToken(label, coin)` lets **whoever owns the name** point it at **any coin**,
with **no proof they control the coin**. So `nameForToken(coin)` returning a name
does NOT mean "this is the original" — it means "some name-holder pointed here."

A "🧄 verified original" badge on top of that is worse than nothing: a scammer
buys a clean-looking name, attaches it to their fake coin, and now looks
*more* legitimate. We'd be selling an impersonation primitive.

## The fix (both reviews, merged): tiered provenance, not a binary badge

Replace the single binding + "original" badge with **verification levels that
carry their provenance**. `nameForToken` should not silently imply officiality.

| Level | How it's earned | Displayed as |
|---|---|---|
| **Registered** | Someone owns `pepe.hood`. Says nothing about any coin. | (no coin badge) |
| **Claimed** | Name owner *proposes* a coin (today's `attachToken`). | "community-linked · unverified" |
| **Launchpad-attested** | The launchpad's factory attests, at creation, who deployed the coin. | "creator-verified (via <platform>)" |
| **Controller-attested** | The coin's current owner/admin or historical creator signs (EIP-712 / EIP-1271). | "issuer-verified" |
| **Unverifiable** | Ownerless/renounced coin, no provenance recoverable. | "unverified — cannot establish" |

Key rule: **for an ownerless coin with no recoverable creator provenance,
garlic.hood cannot determine the official name. Mark it unverified. Do not invent
trust.**

New resolver shape (evidence, not a bare string):

```solidity
function resolveToken(address token) view returns (
    bytes32 labelhash,
    uint8   level,         // enum above
    uint8   provenance,    // launchpad | controller | historical-creator | none
    address attestor,
    uint64  verifiedAt
);
```

Reserve a high-trust `nameForToken` for **attested** levels only; put unilateral
claims behind a separate, clearly-labeled method.

## The authority mechanism: attest at creation

The only place real provenance exists cheaply is **the moment of launch**, where
the factory knows who deployed the coin. So the flagship integration is:

- A launchpad calls `registerAndAttest(label, coin, creator)` (or emits a
  factory attestation the registry accepts) **in the deploy tx**. The deployer
  atomically claims the name → genuine provenance, no after-the-fact guessing.
- Existing/renounced coins: claims stay **advisory** (community-linked). No
  unilateral "verified." Disputes handled by policy/annotation, not god-mode.

## Lifecycle: attested bindings don't get yanked

- An **attested** binding is historically permanent; anyone can sponsor renewal;
  long grace period; after expiry it goes **inactive but is never silently
  reassigned** to a different coin. Rebinding requires the original attestor.
- This reduces recurring name-resale revenue. Correct trade-off if security is
  the product.

## Security rebuild (both reviews)

- **Rebuild the ERC-721 on OpenZeppelin** instead of hand-rolled. Don't pay an
  auditor to check custom standard code.
- **Exact payment**, pull-based withdrawals (no push refunds).
- **Stateful fuzzing** with invariants: ≤1 active attested name per token; ≤1
  attested token per name; forward/reverse mappings always agree; expired names
  never resolve as verified; re-registration never inherits old attestations;
  detach clears all mappings; renewal can't shorten expiry; EIP-712 signatures
  can't replay; balance always covers withdrawals. 16 unit tests is not enough.

## Language / legal

- Drop **"verified original."** Use "creator-verified", "issuer-verified",
  "community-linked", "unverified". Add explicit non-affiliation-with-Robinhood
  language. Basic safety signal should be free if it's to become infrastructure.
- **Namespace conflict:** hood.ag reportedly already runs `.hood` for wallet
  identity. Decide: differentiate (garlic = token provenance, not wallet names),
  or don't mint our own names at all and attest over an existing identity system.

## Cold-start falsifiable test

Embed in **one** launchpad at creation, free. **If no launchpad will integrate
even for free, stop** — that's strong evidence platforms don't value it enough.

## What changes in code (if we do this)

1. New `Attestation` layer: levels, `registerAndAttest`, EIP-712 controller
   attest, `resolveToken` evidence view; keep `attachToken` but re-label its
   output as "community-linked / unverified."
2. ERC-721 core → OpenZeppelin.
3. Non-reassignable attested bindings + sponsorable renewal + grace.
4. Foundry stateful fuzz suite.
5. Front-end: show the level + provenance, not a single badge; a "claim at
   launch" flow for a partner launchpad.
6. Reposition copy: "creator provenance + stable token identity for launchpads."
