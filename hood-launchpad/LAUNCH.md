# 🧄 Launch garlic.hood as a real, usable dApp on your own domain

This is the finalized runbook for a **shared** app on **your custom domain** —
one deployment that everyone who visits uses, not a per-browser copy.

There are exactly four steps. Two of them (deploying the contracts, pointing
your domain) can only be done by **you** — they need your wallet, your funds,
and your domain registrar. Everything else is already built and tested.

---

## The honest split — what's done vs. what only you can do

| | Status |
|---|---|
| Contracts (registry, launchpad, curve, comments) | ✅ Built, 45 tests pass on real bytecode |
| Frontend (wallet connect, launch, trade, comments, leaderboard) | ✅ Built, points to Robinhood Chain |
| Shared-deployment support (`deployment.json`) | ✅ Built — includes a one-click "Download deployment.json" |
| **Deploying the contracts on-chain** | ⬜ Only you — needs your wallet + gas |
| **Hosting the `app/` folder** | ⬜ Only you — pick a host (30 sec) |
| **Pointing your custom domain** | ⬜ Only you — needs your domain + DNS |

I cannot do the last three from here: this sandbox has no wallet, no funds, is
network-blocked from the chain's RPC, and can't own a domain. That's not a gap
in the build — deploying with your keys is *supposed* to be yours alone.

---

## Step 1 — Deploy the contracts once (≈2 min, your wallet)

1. Temporarily host the `app/` folder so you can open it in a browser with your
   wallet: drag the `app` folder onto **https://app.netlify.com/drop** (no
   account needed). You get a throwaway URL like `https://xyz.netlify.app`.
2. Open that URL where your wallet (MetaMask / Phantom / Coinbase / Robinhood)
   lives. Click **Connect wallet**.
3. Click **Get free test ETH**, paste your address, request from the faucet.
4. Click **Deploy garlic.hood**. Approve the ~4 wallet pops. The site adds the
   Robinhood Chain network for you.
5. When it finishes, a green bar appears: **⬇ Download deployment.json**.
   Click it — save that file. *This is the shared config for your whole app.*

## Step 2 — Bake in the shared deployment

Put the `deployment.json` you just downloaded **into the `app/` folder**, next
to `index.html`. Now the folder is a complete, self-contained shared app: anyone
who opens it talks to *your* contracts and skips setup entirely.

## Step 3 — Host `app/` for real (≈1 min)

Re-upload the `app/` folder (now containing `deployment.json`) to your host:
- **Netlify / Vercel / Cloudflare Pages** — drag-drop the folder, or connect the
  GitHub repo and set the publish directory to `hood-launchpad/app`.
- You'll get a real URL like `https://garlic-hood.netlify.app`. Confirm it loads
  and shows the app directly (no "Set up" panel) — that means `deployment.json`
  was found.

## Step 4 — Point your custom domain

1. In your host's dashboard: **Domains → Add custom domain** → type your domain
   (e.g. `garlichood.com` or `app.garlichood.com`).
2. At your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.), add the DNS
   record the host shows you:
   - Apex/root (`garlichood.com`) → an **A record** to the host's IP, or an
     **ALIAS/ANAME** to the host's target.
   - Subdomain (`app.garlichood.com`) → a **CNAME** to the host's target
     (e.g. `garlic-hood.netlify.app`).
3. Wait for DNS + the free auto-SSL cert (minutes to ~an hour). Done — your
   custom domain now serves the live dApp.

**Share that domain.** That's your finalized website.

---

## Before real money (mainnet) — read this

Steps above run on **testnet** (chain 46630) where ETH is free from the faucet,
so the app is fully usable for real, but tokens have no value. To take real
money you must, in this order:

1. **Get an audit.** This handles real funds and cannot be un-rugged. Do not
   skip this.
2. **Switch to mainnet config** — set `CHAIN.rpc` / `CHAIN.id` /
   `CHAIN.explorer` in `app/app.js` to Robinhood Chain **mainnet**, turn the
   platform fee back on if you want revenue (`feeBps` in the deploy call), and
   re-deploy (Step 1) against mainnet.
3. **Wire the real v3 handler — SushiSwap CLAMM is live on Robinhood Chain.**
   Verified addresses are recorded in [`config/robinhood-chain.json`](config/robinhood-chain.json):
   - NonfungiblePositionManager: `0x51d0e5188afe12d502e29d982d20c190e7816107`
   - Factory: `0xe51960f1b45f1c9fb6d166e6a884f866fc70433b`

   The deploy script wires it for you — just supply the **WETH** (wrapped-ETH)
   address on Robinhood Chain (the one field still marked TODO in the config):

   ```bash
   GRADUATION=sushi WETH=0x<robinhood-chain-weth> PRIVATE_KEY=0x... node scripts/deploy.js
   ```

   This deploys `UniswapV3GraduationHandler` against Sushi's position manager and
   calls `setCurve` automatically. **Fork-test a full graduation** against the
   live Sushi periphery before mainnet.
4. **Know your legal footing** — a purely permissionless launchpad is lower-risk
   than one where you custody names/funds, but get local advice before taking
   fees from real users.

---

## Want me to remove even more steps?

I can:
- **Add a GitHub Actions workflow** that auto-deploys `app/` to Netlify/Cloudflare
  Pages on every push (so hosting becomes automatic, not drag-drop).
- **Bake a testnet demo `deployment.json`** so the hosted site is instantly
  usable by visitors on testnet without you deploying first (good for the
  showcase; you'd swap in your own for the real one).

Say which and I'll wire it.
