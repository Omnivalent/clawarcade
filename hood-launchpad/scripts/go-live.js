#!/usr/bin/env node
/* One command to go live on Robinhood Chain testnet from YOUR machine.
 *   node scripts/go-live.js
 * It will:
 *   1. make (or reuse) a throwaway deployer key — saved to .deployer-key
 *   2. show you the address + faucet link, and wait until it's funded
 *   3. compile + deploy the whole stack, write app/deployment.json
 *   4. start the app at http://localhost:8788 — open it in your wallet browser
 * Everything is testnet; the throwaway key holds only free faucet ETH.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const RPC = process.env.RPC_URL || 'https://rpc.testnet.chain.robinhood.com/rpc';
const KEY_FILE = path.join(ROOT, '.deployer-key');
const FAUCET = 'https://faucet.testnet.chain.robinhood.com';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function line(s = '') { process.stdout.write(s + '\n'); }

(async () => {
  // 1. deployer key
  let pk = process.env.PRIVATE_KEY;
  if (!pk && fs.existsSync(KEY_FILE)) pk = fs.readFileSync(KEY_FILE, 'utf8').trim();
  if (!pk) {
    pk = ethers.Wallet.createRandom().privateKey;
    fs.writeFileSync(KEY_FILE, pk + '\n', { mode: 0o600 });
    line('created a fresh throwaway deployer key → .deployer-key (git-ignored)');
  }
  const wallet = new ethers.Wallet(pk);
  line(`\ndeployer address: ${wallet.address}`);

  // 2. compile (does not need the network)
  line('\ncompiling contracts…');
  const c = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'compile.js')], { stdio: 'inherit' });
  if (c.status !== 0) { line('compile failed'); process.exit(1); }

  // 3. fund + wait
  const provider = new ethers.JsonRpcProvider(RPC);
  let bal = 0n;
  try { bal = await provider.getBalance(wallet.address); } catch (e) {
    line(`\ncannot reach ${RPC}\n  ${e.shortMessage || e.message}\n  (are you online? is the RPC correct?)`);
    process.exit(1);
  }
  if (bal === 0n) {
    line('\n──────────────────────────────────────────────');
    line(' FUND THE DEPLOYER (free, ~10 seconds):');
    line(`  1. open ${FAUCET}`);
    line(`  2. paste this address:  ${wallet.address}`);
    line('  3. request testnet ETH');
    line('──────────────────────────────────────────────');
    line('\nwaiting for funds…');
    while (bal === 0n) { await sleep(4000); try { bal = await provider.getBalance(wallet.address); } catch {} process.stdout.write('.'); }
    line('');
  }
  line(`funded: ${ethers.formatEther(bal)} ETH`);

  // 4. deploy
  line('\ndeploying the stack…');
  const d = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'deploy.js')], {
    stdio: 'inherit',
    env: { ...process.env, PRIVATE_KEY: pk, RPC_URL: RPC },
  });
  if (d.status !== 0) { line('deploy failed'); process.exit(1); }

  // 5. serve
  line('\nstarting the app → http://localhost:8788');
  line('open that in the browser where your wallet extension lives, connect, and launch a coin.\n');
  const srv = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.js')], { stdio: 'inherit' });
  process.on('SIGINT', () => { srv.kill(); process.exit(0); });
})().catch(e => { line(String(e.stack || e)); process.exit(1); });
