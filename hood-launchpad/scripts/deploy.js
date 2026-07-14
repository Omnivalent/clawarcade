#!/usr/bin/env node
// Deploys the full launchpad stack (MockRegistrar + GraduationEscrow +
// TokenFactory + BondingCurve) with YOUR key, defaulting to Robinhood Chain
// TESTNET with ZERO fees — the private-testing configuration.
//
//   1. get free testnet ETH: https://faucet.testnet.chain.robinhood.com
//   2. node scripts/compile.js
//   3. PRIVATE_KEY=0x... node scripts/deploy.js
//
// Env overrides:
//   RPC_URL          default https://rpc.testnet.chain.robinhood.com/rpc (chain 46630)
//   FEE_RECIPIENT    default: deployer address
//   PLATFORM_FEE_ETH default 0        (flat launch fee)
//   FEE_BPS          default 0        (trade fee; 100 = 1% for production)
//   VIRTUAL_ETH0     default 0.05     (test-scaled; production 1.4 to mirror
//                                      pump.fun — graduation raise = 2.833x this)
//   GRADUATION_ETH   default: sellout-only (pump.fun behavior)
//   ENFORCE_VANITY   default true     (addresses must end 0x...600d)
//   COMMIT_AGE       default 0        (seconds a launch commit must age before
//                                      reveal; 0 = off for private testing,
//                                      ~15 recommended in production)
//
// Writes deployment.json for scripts/launch-token.js.
const fs = require('fs');
const path = require('path');
const { JsonRpcProvider, Wallet, ContractFactory, parseEther, MaxUint256 } = require('ethers');

function artifact(name) {
  const a = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', name + '.json'), 'utf8'));
  return { abi: a.abi, bytecode: '0x' + a.bytecode };
}

(async () => {
  const rpc = process.env.RPC_URL || 'https://rpc.testnet.chain.robinhood.com/rpc';
  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.error('PRIVATE_KEY env var is required'); process.exit(1); }

  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(pk, provider);
  const net = await provider.getNetwork();
  const bal = await provider.getBalance(wallet.address);
  console.log(`deployer : ${wallet.address}`);
  console.log(`chain    : ${net.chainId} (${rpc})`);
  console.log(`balance  : ${Number(bal) / 1e18} ETH`);
  if (bal === 0n) { console.error('fund the deployer first (testnet faucet: https://faucet.testnet.chain.robinhood.com)'); process.exit(1); }

  const feeRecipient = process.env.FEE_RECIPIENT || wallet.address;
  const platformFee = parseEther(process.env.PLATFORM_FEE_ETH || '0');
  const feeBps = BigInt(process.env.FEE_BPS || '0');
  const virtualEth0 = parseEther(process.env.VIRTUAL_ETH0 || '0.05');
  const graduationEth = process.env.GRADUATION_ETH ? parseEther(process.env.GRADUATION_ETH) : (MaxUint256 >> 1n);
  const enforceVanity = (process.env.ENFORCE_VANITY || 'true') === 'true';
  const commitAge = BigInt(process.env.COMMIT_AGE || '0');

  const deploy = async (name, args = []) => {
    const { abi, bytecode } = artifact(name);
    const c = await new ContractFactory(abi, bytecode, wallet).deploy(...args);
    await c.waitForDeployment();
    console.log(`${name.padEnd(17)}: ${await c.getAddress()}`);
    return c;
  };

  console.log('\ndeploying…');
  const registrar = await deploy('MockRegistrar');
  const escrow = await deploy('GraduationEscrow');
  const factory = await deploy('TokenFactory', [
    feeRecipient, await registrar.getAddress(), await escrow.getAddress(),
    platformFee, feeBps, virtualEth0, graduationEth, enforceVanity, commitAge,
  ]);
  const curveAddr = await factory.curve();
  console.log(`${'BondingCurve'.padEnd(17)}: ${curveAddr}`);

  const out = {
    chainId: Number(net.chainId),
    rpc,
    registrar: await registrar.getAddress(),
    escrow: await escrow.getAddress(),
    factory: await factory.getAddress(),
    curve: curveAddr,
    feeBps: Number(feeBps),
    platformFeeWei: platformFee.toString(),
    virtualEth0Wei: virtualEth0.toString(),
    enforceVanity,
  };
  fs.writeFileSync(path.join(__dirname, '..', 'deployment.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('\nwrote deployment.json — next: PRIVATE_KEY=... node scripts/launch-token.js supercat "Super Cat" SCAT');
  if (Number(net.chainId) === 46630) {
    console.log(`explorer : https://explorer.testnet.chain.robinhood.com/address/${out.factory}`);
  }
})().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
