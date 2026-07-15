# How garlic.hood works — the mechanisms

*A deep dive into the anti-vamp system, renewal-on-bond, and the other
mechanisms behind garlic.hood. Written for X — post it as an Article, or use
the condensed thread at the bottom.*

---

## The one idea everything hangs on: identity is scarce

Every launchpad lets you mint a **ticker**. Tickers aren't scarce — that's the
whole problem. The moment a coin catches, the swarm arrives: the same name with
an extra letter, a swapped digit, a "2" bolted on the end. $DOGE, $DOGES,
$D0GE, $DOGE2. Each one bleeds attention and liquidity from the original. Pump
made launching free; it also made *vampiring* free.

garlic.hood changes the unit of scarcity. You don't mint a ticker — you claim a
**name**, a unique `.hood` identity on Robinhood Chain, and **that name can host
exactly one live token.** `doge.hood` is *the* doge. There is no second one.

Everything below is the machinery that makes that promise real, keeps it real
after launch, and pays for itself.

---

## 1. The anti-vamp stack 🧄🧛

"No copycats" is easy to say and hard to enforce. We enforce it in three layers.

**Layer 1 — on-chain charset (the hard wall).** The launch contract refuses any
name that isn't clean lowercase `a–z`, `0–9`, and interior hyphens, 3–32 chars.
That single rule kills the nastiest class of vampire outright: unicode and
**homoglyphs**. A Cyrillic "о" that looks identical to a Latin "o"? A zero
dressed up as an "o"? They never reach the chain — the transaction reverts.

**Layer 2 — the similarity engine (the fuzzy net).** Charset rules can't catch
`doges`, `doge-sol`, or `d0ge`. So the app runs a real similarity engine as you
type: it folds leetspeak and homoglyphs to a canonical skeleton (`d0ge → doge`),
strips the common ride-along affixes people add (`inu`, `coin`, `sol`, `2`, `x`,
`ai`…), and measures edit distance on what's left. Try to launch a look-alike
and you get a live warning: **"🧛 80% similar to doge.hood — looks like a vampire
of it."**

**Layer 3 — the Garlic Score (the signal).** Every name carries an originality
score from 0–100. 100 means nobody, anywhere, is riding your identity. As
confusingly-similar names appear, the score drops — 97, 92, 85. Buyers see it at
a glance and instantly understand *"is this the original, or a knockoff?"* The
score isn't decoration; it's the thing that makes originality legible in a
market built on confusion.

Three layers, one promise: garlic keeps the vampires out.

---

## 2. The fair launch: a bonding curve, pump-style

Claiming a name and launching a coin happen in **one transaction**. No presale,
no team allocation, no liquidity to post. The token is a minimal, fixed-supply
ERC-20 — 1 billion tokens, and critically **no owner, no mint function, no
pause, no blacklist.** There is nothing the creator can do to the token contract
after launch. It's rug-proof by construction, not by promise.

Price discovery is a virtual-reserve bonding curve, mirroring pump.fun's
tokenomics scaled to ETH: most of the supply is sold along the curve, the rest
is reserved. Early buys are cheap; the price rises as the curve fills. Buys and
sells carry a slippage floor **and** a deadline, so a sandwich bot can't
front-run your trade past your tolerance or hold it hostage for a later block.

And the quote you see is computed by the **exact same code path** that executes
the trade — a small thing that quietly eliminates a whole class of "the quote
lied to me" bugs.

---

## 3. Renewal-on-bond: the coin pays to protect its own name ✨

This is the mechanism I'm proudest of, so here's the full picture.

A `.hood` name isn't free forever — like any name service, registration has a
term. At launch, garlic.hood registers the name for **1 year**, and the launchpad
itself custodies it, so the name can never be quietly re-pointed at a scam
contract while the token is live.

But what happens when the coin actually *makes it*? When the bonding curve fills
and the token **graduates** — its raised ETH and reserved tokens go seed a
Uniswap pool, and the LP is **burned forever** — something else fires in the same
moment: **the name auto-renews for 5 more years, paid out of the raise itself.**

Read that again, because it's the elegant part: **a coin's own success funds the
permanence of its own identity.** The community bought in; a slice of what they
raised is spent making sure `doge.hood` stays doge for years, locked to the
contract, un-re-pointable. Graduation isn't just "we got liquidity" — it's
*"Survived Sunrise: the name is yours now."* ☀️

Two guards make this safe rather than exploitable:

- **The renewal is best-effort and hard-capped at 10% of the raise.** A broken,
  reverting, or overpriced name service can *never* block a graduation or drain
  the pool. Worst case, renewal is skipped and logged — the coin still graduates.
- **The hijack guard.** A token's raise can only ever renew *its own* name. If a
  name had lapsed and been relaunched to a *different* token in the meantime, the
  old token's graduation refuses to spend a cent on someone else's identity. One
  coin's money can never buy another coin's name.

---

## 4. The name lifecycle: a fair second chance, without chaos

Names shouldn't be hostage forever, and dead projects shouldn't lock a good name
out of existence. So the full arc is:

- **Launch → 1 year.** Custodied, un-re-pointable.
- **Graduates → +5 years**, paid from the raise (see above).
- **Never graduates → lapses after the year.** The name frees up — a good name
  gets a second life instead of dying with a failed launch.
- **Grace period.** For 7 days after a name lapses, only the *original* launcher
  can reclaim it. A project that stumbled gets first right of refusal before the
  name reopens to everyone.
- **Anyone can renew, anytime.** A permissionless `renewName()` means a
  community can keep a beloved name alive forever, even though the launchpad
  holds the deed — nobody is at the mercy of a single wallet.

And every relaunch emits a permanent on-chain record of old-token → new-token, so
explorers and wallets can always answer "what did this `.hood` mean, and when?"

---

## 5. The trust layer: built to be inspected

The boring mechanisms are the ones that matter when real money shows up:

- **Commit-reveal launches** bind a launch to its committer, so a mempool watcher
  can't copy your calldata and front-run your launch.
- **Fees accrue and are pulled**, never pushed — a misbehaving fee recipient can
  never brick trading for everyone else.
- **Registrar swaps are timelocked** (propose → wait → apply), so the name-service
  adapter can't be changed on you in a single block.
- **Reentrancy is locked down** across the curve, including the graduation path —
  proven with an attacker contract in the test suite.
- **29 end-to-end tests run the *actual compiled bytecode*** — not a mock, the real
  bytes — covering launch, vanity, fees, graduation, the renewal hijack guard,
  the grace period, commit-reveal, and reentrancy. All green.

---

## 6. The parts that make it a place, not a faucet

- **Wallet accounts.** Sign in with a wallet (a free signature — no gas,
  authorizes nothing), and your `.hood` name becomes your handle everywhere.
- **On-chain comments**, done cheap: comments are events, not storage, so posting
  costs a few thousand gas instead of a fortune.
- **An anti-wash leaderboard.** Top tokens rank by market cap, **unique buyers**,
  and Garlic Score — *not* raw volume, because volume is the one number a whale
  can fake by trading against themselves. Unique buyers and originality are much
  harder to game.

---

## The one-line version

pump.fun is *"launch a token in seconds."*
garlic.hood is *"launch the **one true** token for a name — and let its success
pay to keep that name forever."*

One name. One token. 🧄

---

*Testnet build. Open-source. Not investment advice; testnet tokens have no value.*

---

## Condensed thread (8 posts) — mechanism edition

**1/** 🧄 How garlic.hood actually works — a mechanism thread.

The idea: identity is scarce. Every coin is a unique `.hood` name that hosts
exactly ONE live token. `doge.hood` is *the* doge. No second one. 🧵

**2/** 🧛 Anti-vamp, 3 layers:
• on-chain: the contract rejects unicode/homoglyph names (`d0ge`, Cyrillic-o) —
they never reach the chain
• app: a similarity engine warns "80% similar to doge.hood" as you type
• every name gets a **Garlic Score** — originality, 100 = unique

**3/** Fair launch: name + token + curve in ONE tx. Fixed 1B supply. The token
has NO owner, NO mint, NO pause — rug-proof by construction, not by promise.
Bonding curve for price discovery; slippage + deadline on every trade
(anti-sandwich).

**4/** ✨ The mechanism I love most — renewal-on-bond:

Name is registered 1yr at launch. When the coin GRADUATES (curve fills → Uniswap
pool → LP burned), the name **auto-renews +5 years, paid from the raise.**

The coin's own success buys the permanence of its own identity.

**5/** Two guards keep that safe:
• renewal is best-effort + capped at 10% of the raise — a broken name service can
never block a graduation
• the hijack guard: one coin's raise can NEVER pay for another coin's name

**6/** Full name lifecycle:
1yr → graduate → +5yr → if it never bonds, lapses → 7-day grace where only the
original launcher can reclaim → then anyone. Plus permissionless renew so a
community can keep a name alive forever.

**7/** Trust layer: commit-reveal (anti-frontrun), fees pulled not pushed
(no DoS), timelocked registrar swaps, reentrancy locked (proven with an attacker
contract). 29 tests run the REAL compiled bytecode. All green.

**8/** Social by default: your `.hood` is your handle, on-chain comments (cheap,
event-only), and a leaderboard ranked by unique buyers + Garlic Score — not
wash-tradeable volume.

One name. One token. 🧄
🔗 [code + demo] https://github.com/Omnivalent/clawarcade/tree/claude/hood-domain-token-launchpad-b1rgyo/hood-launchpad
