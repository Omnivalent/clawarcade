# Put garlic.hood live — no terminal, no Node, no downloads

Two steps. About 3 minutes. Everything happens in your browser + wallet.

## Step 1 — Host the site (drag-and-drop, ~30 seconds)

1. In the extracted folder, find the **`app`** folder.
2. Go to **https://app.netlify.com/drop** (no account needed).
3. **Drag the whole `app` folder** onto that page.
4. Netlify gives you a public URL like **`https://garlic-hood-xyz.netlify.app`** — that's your live website.

*(Vercel and Cloudflare Pages work the same way if you prefer them.)*

## Step 2 — Turn it on with your wallet (~2 minutes, one time)

1. Open your new URL in the browser where your **wallet extension** (MetaMask, Phantom, Coinbase, or Robinhood) is installed.
2. The site shows a **"Set up garlic.hood"** panel. Click **Connect wallet**.
3. Click the **"Get free test ETH"** link, paste your wallet address, and request testnet ETH (free).
4. Click **Deploy garlic.hood**. Your wallet will pop up ~4 times — approve each. The site adds the Robinhood Chain testnet network automatically.
5. Done. The site is now live and real — launch a coin, trade, comment. It remembers your setup in this browser.

That's it. No commands, ever.

---

### Notes

- **It's testnet** — the ETH is free from the faucet, so "real transactions" cost nothing. Flipping to mainnet later is a config change plus the hood.ag + audit steps we discussed.
- **Setup is per-browser.** Whoever opens the URL and clicks Deploy creates *their* copy. To give everyone the *same* shared garlic.hood, you (the owner) deploy once, then share the contract addresses — I can wire the site to bake those in so visitors skip Step 2 and just connect + trade. Say the word and I'll set that up.
- **Faucet trouble?** Some faucets need a quick social login or have a daily limit. Any small amount of test ETH at your address is enough to deploy.
- **Wrong network?** The Deploy button adds/switches to Robinhood Chain Testnet (chain ID 46630) for you.
