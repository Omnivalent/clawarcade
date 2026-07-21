#!/usr/bin/env node
// Deploy ONLY GarlicRegistry — the .hood identity layer. No launchpad, no
// bonding curve, no graduation. This is the lean deployment: one contract that
// lets anyone register a .hood name and attach it, uniquely, to a coin launched
// on any Robinhood Chain platform (Pons, Hood.fun, …).
//
//   1. node scripts/compile.js
//   2. testnet:  PRIVATE_KEY=0x... node scripts/deploy-registry.js
//      mainnet:  NETWORK=mainnet PRIVATE_KEY=0x... node scripts/deploy-registry.js
//
// Env overrides:
//   NETWORK   testnet (default) | mainnet   — picks RPC + chainId from config
//   RPC_URL   override the RPC entirely
//   PRICE5PLUS / PRICE4 / PRICE3   per-year name prices in ETH (optional retune)
//
// Writes app/registry.json for the front-end to read.
const fs = require('fs');
const path = require('path');
const { JsonRpcProvider, Wallet, ContractFactory, parseEther } = require('ethers');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'robinhood-chain.json'), 'utf8'));

function artifact(name) {
  const a = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', name + '.json'), 'utf8'));
  return { abi: a.abi, bytecode: '0x' + a.bytecode };
}

(async () => {
  const network = (process.env.NETWORK || 'testnet').toLowerCase();
  const chainCfg = cfg.chain[network];
  if (!chainCfg) { console.error(`unknown NETWORK "${network}" (use testnet|mainnet)`); process.exit(1); }
  const rpc = process.env.RPC_URL || chainCfg.rpc;
  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.error('PRIVATE_KEY env var is required'); process.exit(1); }

  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(pk, provider);
  const net = await provider.getNetwork();
  const bal = await provider.getBalance(wallet.address);
  console.log(`network  : Robinhood Chain ${network} (chain ${net.chainId})`);
  console.log(`deployer : ${wallet.address}`);
  console.log(`balance  : ${Number(bal) / 1e18} ETH`);
  if (bal === 0n) { console.error('fund the deployer first.'); process.exit(1); }
  if (network === 'mainnet') {
    console.log('\n⚠  MAINNET: real funds. Confirm the registry has been audited before public use.\n');
  }

  console.log('deploying GarlicRegistry…');
  const { abi, bytecode } = artifact('GarlicRegistry');
  const reg = await new ContractFactory(abi, bytecode, wallet).deploy();
  await reg.waitForDeployment();
  const addr = await reg.getAddress();
  console.log(`GarlicRegistry : ${addr}`);

  // optional price retune
  const p = (k, d) => process.env[k] ? parseEther(process.env[k]) : d;
  if (process.env.PRICE5PLUS || process.env.PRICE4 || process.env.PRICE3) {
    const tx = await reg.setPrices(p('PRICE3', await reg.price3()), p('PRICE4', await reg.price4()), p('PRICE5PLUS', await reg.price5plus()));
    await tx.wait();
    console.log('prices set.');
  }

  const out = {
    chainId: Number(net.chainId),
    rpc,
    explorer: chainCfg.explorer,
    registry: addr,
  };
  const outPath = path.join(__dirname, '..', 'app', 'registry.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nwrote ${outPath}`);
  console.log(`explorer: ${chainCfg.explorer}/address/${addr}`);
  console.log('\nOther platforms integrate by calling this address:');
  console.log('  nameForToken(coin) → verified .hood name   |   attachToken(label, coin) → bind');
})().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
