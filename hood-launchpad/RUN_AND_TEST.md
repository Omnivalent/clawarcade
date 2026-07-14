# hoodpad — run it and test it yourself

This is the wallet-connected dApp: connect MetaMask / Phantom / Coinbase /
Robinhood, sign in, search a `.hood`, register + launch a token on it, trade
its bonding curve, and comment. It runs **in your own browser** against a
deployment **you** control.

## Why it runs locally, not as a hosted link

Wallet extensions only inject into a real browser tab on your machine — not
into a sandbox and not into an embedded preview. So a "click this URL and it's
live with your wallet" link isn't physically possible; the honest path is you
run it locally (one command) in the browser where your wallet lives. It's the
same code you'd later host.

## Go live in one command (free, on testnet)

```bash
cd hood-launchpad
npm install
node scripts/go-live.js
```

That single command makes a throwaway deployer key, shows you its address +
the faucet link, waits until you fund it (free, ~10s), then compiles, deploys
the whole stack, and serves the live app at **http://localhost:8788**. Open
that in the browser where your wallet extension lives — connect, sign in, and
launch a coin for real on Robinhood Chain testnet.

> Why local and not a link from the assistant: the assistant's sandbox is
> firewalled from Robinhood Chain's RPC (org egress policy), so contracts must
> be deployed from your machine. Your computer has no such limit.

### Make it a PUBLIC url (no assistant needed)

After `go-live.js` has deployed (so `app/deployment.json` exists), the whole
`app/` folder is a static site pointed at your live contracts. Drag that folder
onto **https://app.netlify.com/drop** (or Vercel / Cloudflare Pages) and you
get a public `https://…` URL that anyone can open, connect their wallet to, and
trade on — real testnet transactions, publicly hosted, in under a minute.

### Or the manual steps

```bash
node scripts/compile.js
# fund any address at https://faucet.testnet.chain.robinhood.com
PRIVATE_KEY=0xYOURKEY node scripts/deploy.js   # writes app/deployment.json
node scripts/serve.js                          # → http://localhost:8788
```

Then in the browser: **Connect wallet → Sign in** (a free signature, no gas,
authorizes nothing) → type a name → **Register & Launch** → **Buy** → post a
comment. Everything is a real transaction on Robinhood Chain testnet.

> Use a throwaway key for the `PRIVATE_KEY` env var, and only on testnet.
> Never paste a key holding real mainnet funds into a shell.

## What's wired

- **Any injected wallet** via EIP-6963 discovery (MetaMask, Phantom's EVM
  mode, Coinbase Wallet, Rabby, Robinhood's browser extension). Mobile
  Robinhood Wallet: open the local URL in its in-app browser. (WalletConnect
  for mobile-by-QR needs a relay project ID — noted as a follow-up.)
- **Sign-in gate (SIWE / EIP-4361):** browse freely; every write action is
  locked until you sign a message proving you control the wallet.
- **Name search → register → launch** in one flow; **.hood identity** shown as
  your handle (register one for yourself under "Get your .hood identity").
- **Trading** with a slippage floor + 2-minute deadline on every buy/sell.
- **On-chain comments** per token (event-only, so posting is a few thousand
  gas), with `.hood` names resolved for each author.

## Anti-sandwich / low cost

- Every trade passes `minTokensOut`/`minEthOut` (computed from a live quote and
  your slippage %) **and** a `deadline`. A sandwich bot that front-runs you
  can't push your fill past your tolerance — the tx reverts instead. The UI
  warns hard if you raise slippage above 3%, because loose slippage is exactly
  what feeds sandwich bots.
- Costs are minimized for an L2: comments are event-only (no storage), fees
  are configurable and **off** in the test config, and the launch is a single
  transaction.

## Going to mainnet (later, deliberately)

Flip `RPC_URL` to Robinhood Chain mainnet and set `FEE_BPS`, `COMMIT_AGE`
(front-run protection, e.g. 15), and `ENFORCE_VANITY` as desired on the
deploy. Before that: swap `MockRegistrar` for the real **hood.ag** adapter
(verify its contract addresses/ABI first — see
`contracts/adapters/HoodAgAdapter.sol`) via `factory.setRegistrar(...)`, wire
the Uniswap v3 graduation handler, and get a professional audit. None of those
are needed to test the full flow on testnet today.
