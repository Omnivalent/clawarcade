#!/usr/bin/env node
// Grinds a CREATE2 salt so the deployed token address ends in the vanity
// suffix (default 600d). This is the EVM answer to pump.fun's "...pump"
// addresses: "hood" itself can't appear in a hex address (h and o aren't hex
// digits), but a fixed house suffix can — and a 2-byte suffix averages only
// 65,536 keccak hashes, i.e. well under a second, so the frontend grinds live
// while the user reviews the launch screen.
//
// Usage: node scripts/grind-salt.js <factoryAddress> <initCodeHash> [suffixHex]
// Demo:  node scripts/grind-salt.js --demo
const { keccak256 } = require('js-sha3');

function create2Address(factory, saltHex, initCodeHash) {
  const packed = 'ff' + factory.slice(2) + saltHex + initCodeHash.slice(2);
  return '0x' + keccak256(Buffer.from(packed, 'hex')).slice(-40);
}

function grind(factory, initCodeHash, suffix) {
  const start = Date.now();
  for (let i = 0; ; i++) {
    const saltHex = i.toString(16).padStart(64, '0');
    const addr = create2Address(factory, saltHex, initCodeHash);
    if (addr.endsWith(suffix)) {
      return { salt: '0x' + saltHex, address: addr, attempts: i + 1, ms: Date.now() - start };
    }
  }
}

const args = process.argv.slice(2);
let factory, initCodeHash, suffix;
if (args[0] === '--demo') {
  factory = '0x' + 'ab'.repeat(20);
  initCodeHash = '0x' + keccak256('LaunchToken demo initcode');
  suffix = '600d';
} else {
  [factory, initCodeHash, suffix = '600d'] = args;
  if (!factory || !initCodeHash) {
    console.error('usage: grind-salt.js <factoryAddress> <initCodeHash> [suffixHex] | --demo');
    process.exit(1);
  }
}

const r = grind(factory.toLowerCase(), initCodeHash.toLowerCase(), suffix.toLowerCase());
console.log(`vanity suffix : ...${suffix}`);
console.log(`salt          : ${r.salt}`);
console.log(`token address : ${r.address}`);
console.log(`attempts      : ${r.attempts.toLocaleString()} in ${r.ms}ms (${Math.round(r.attempts / Math.max(r.ms, 1))}k hashes/sec)`);
