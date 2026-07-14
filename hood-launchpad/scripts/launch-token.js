#!/usr/bin/env node
// Launches a token through YOUR deployed factory (see scripts/deploy.js):
// grinds the ...600d vanity salt locally, quotes the launch cost (platform
// fee + 1yr name registration), sends the launch tx, and optionally makes a
// first buy.
//
//   PRIVATE_KEY=0x... node scripts/launch-token.js <label> [name] [symbol]
//   e.g. PRIVATE_KEY=0x... FIRST_BUY_ETH=0.01 node scripts/launch-token.js supercat "Super Cat" SCAT
const fs = require('fs');
const path = require('path');
const { keccak256 } = require('js-sha3');
const { JsonRpcProvider, Wallet, Contract, AbiCoder, parseEther, ZeroHash } = require('ethers');

const coder = AbiCoder.defaultAbiCoder();
function artifact(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', name + '.json'), 'utf8'));
}

function grindSalt(factory, curve, name, symbol, label, suffix) {
  const initCode = artifact('LaunchToken').bytecode +
    coder.encode(['string', 'string', 'string', 'address'], [name, symbol, label, curve]).slice(2);
  const initHash = keccak256(Buffer.from(initCode, 'hex'));
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    const salt = i.toString(16).padStart(64, '0');
    const packed = 'ff' + factory.slice(2).toLowerCase() + salt + initHash;
    const addr = keccak256(Buffer.from(packed, 'hex')).slice(-40);
    if (addr.endsWith(suffix)) {
      return { salt: '0x' + salt, predicted: '0x' + addr, attempts: i + 1, ms: Date.now() - t0 };
    }
  }
}

(async () => {
  const [label, name = label, symbol = (label || '').toUpperCase().slice(0, 8)] = process.argv.slice(2);
  if (!label || !process.env.PRIVATE_KEY) {
    console.error('usage: PRIVATE_KEY=0x... node scripts/launch-token.js <label> [name] [symbol]');
    process.exit(1);
  }
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployment.json'), 'utf8'));
  const provider = new JsonRpcProvider(process.env.RPC_URL || dep.rpc);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  const factory = new Contract(dep.factory, artifact('TokenFactory').abi, wallet);
  const curve = new Contract(dep.curve, artifact('BondingCurve').abi, wallet);

  console.log(`launching ${label}.hood as "${name}" (${symbol}) from ${wallet.address}`);
  const cost = await factory.launchCost(label);
  console.log(`launch cost: ${Number(cost) / 1e18} ETH (platform fee + 1yr name registration)`);

  let salt = ZeroHash;
  if (dep.enforceVanity) {
    const g = grindSalt(dep.factory, dep.curve, name, symbol, label, '600d');
    console.log(`vanity salt ground: ${g.attempts.toLocaleString()} hashes in ${g.ms}ms → ${g.predicted}`);
    salt = g.salt;
  }

  const tx = await factory.launch(name, symbol, label, salt, ZeroHash, { value: cost });
  console.log(`launch tx: ${tx.hash}`);
  const rc = await tx.wait();
  const launched = rc.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === 'Launched');
  const token = launched.args.token;
  console.log(`token: ${token}`);
  console.log(`name : ${label}.hood → ${token}`);
  if (dep.chainId === 46630) console.log(`explorer: https://explorer.testnet.chain.robinhood.com/address/${token}`);

  const firstBuy = process.env.FIRST_BUY_ETH;
  if (firstBuy) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const minOut = (await curve.quoteBuy(token, parseEther(firstBuy))) * 99n / 100n; // 1% slippage
    const btx = await curve.buy(token, minOut, deadline, { value: parseEther(firstBuy) });
    await btx.wait();
    const erc20 = new Contract(token, artifact('LaunchToken').abi, wallet);
    const bag = await erc20.balanceOf(wallet.address);
    console.log(`first buy: ${firstBuy} ETH → ${(Number(bag) / 1e18 / 1e6).toFixed(2)}M ${symbol}`);
  }
})().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
