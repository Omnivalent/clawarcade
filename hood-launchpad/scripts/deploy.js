#!/usr/bin/env node
// Deploys the full launchpad stack (GarlicRegistry + GraduationEscrow +
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

  const commentCooldown = BigInt(process.env.COMMENT_COOLDOWN || '15');

  // Graduation handler selection:
  //   GRADUATION=escrow (default) → GraduationEscrow: holds the raise, no DEX.
  //     The safe testnet placeholder — graduation "succeeds" without a real pool.
  //   GRADUATION=sushi              → UniswapV3GraduationHandler pointed at
  //     SushiSwap CLAMM on Robinhood Chain: seeds a real token/WETH pool at the
  //     graduation price and BURNS the LP (rug-proof). Requires WETH + (optionally)
  //     an override of the Sushi NonfungiblePositionManager address.
  //     Defaults come from config/robinhood-chain.json. FORK-TEST before mainnet.
  const gradMode = (process.env.GRADUATION || 'escrow').toLowerCase();
  const SUSHI_NPM = process.env.SUSHI_NPM || '0x51d0e5188afe12d502e29d982d20c190e7816107'; // Robinhood Chain
  const WETH = process.env.WETH || '';
  const GRAD_FEE = BigInt(process.env.GRAD_FEE || '3000'); // 0.3% — matches handler ticks

  console.log('\ndeploying…');
  const registrar = await deploy('GarlicRegistry');

  let escrow;
  if (gradMode === 'sushi') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(WETH)) {
      console.error('GRADUATION=sushi needs the WETH address: WETH=0x... (Robinhood Chain wrapped-ETH). See config/robinhood-chain.json.');
      process.exit(1);
    }
    console.log(`graduation       : SushiSwap CLAMM (NPM ${SUSHI_NPM}, WETH ${WETH}, fee ${GRAD_FEE})`);
    escrow = await deploy('UniswapV3GraduationHandler', [SUSHI_NPM, WETH, GRAD_FEE, feeRecipient]);
  } else {
    console.log('graduation       : GraduationEscrow (testnet placeholder — no DEX pool)');
    escrow = await deploy('GraduationEscrow');
  }

  const factory = await deploy('TokenFactory', [
    feeRecipient, await registrar.getAddress(), await escrow.getAddress(),
    platformFee, feeBps, virtualEth0, graduationEth, enforceVanity, commitAge,
  ]);
  const curveAddr = await factory.curve();
  console.log(`${'BondingCurve'.padEnd(17)}: ${curveAddr}`);

  // The Sushi handler must be told which curve may trigger graduation (one-time).
  if (gradMode === 'sushi') {
    const tx = await escrow.setCurve(curveAddr);
    await tx.wait();
    console.log(`handler.setCurve : ${curveAddr}`);
  }
  const board = await deploy('CommentBoard', [commentCooldown]);

  const out = {
    chainId: Number(net.chainId),
    rpc,
    registrar: await registrar.getAddress(),
    escrow: await escrow.getAddress(),
    factory: await factory.getAddress(),
    curve: curveAddr,
    commentBoard: await board.getAddress(),
    feeBps: Number(feeBps),
    platformFeeWei: platformFee.toString(),
    virtualEth0Wei: virtualEth0.toString(),
    enforceVanity,
  };
  fs.writeFileSync(path.join(__dirname, '..', 'deployment.json'), JSON.stringify(out, null, 2) + '\n');
  // The app reads this to know which contracts to talk to.
  fs.writeFileSync(path.join(__dirname, '..', 'app', 'deployment.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('\nwrote deployment.json + app/deployment.json');
  console.log('start the app:  node scripts/serve.js   → open http://localhost:8788');
  console.log('or CLI launch:  PRIVATE_KEY=... node scripts/launch-token.js supercat "Super Cat" SCAT');
  if (Number(net.chainId) === 46630) {
    console.log(`explorer : https://explorer.testnet.chain.robinhood.com/address/${out.factory}`);
  }
})().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
