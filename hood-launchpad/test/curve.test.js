#!/usr/bin/env node
// Property tests for the bonding-curve math, run against a BigInt mirror of
// BondingCurve.sol's exact integer arithmetic (same formulas, same rounding).
// Solidity-level tests (Foundry) are the next step once a toolchain is picked;
// these validate the economics: pricing, fees, monotonicity, solvency,
// graduation.  Usage: node test/curve.test.js
const assert = require('assert');

const E18 = 10n ** 18n;
const FEE_BPS = 100n;
// pump.fun tokenomics, mirrored from BondingCurve.sol
const CURVE_SUPPLY = 793_100_000n * E18;
const VIRTUAL_ETH_0 = 14n * E18 / 10n; // 1.4 ether (pump.fun's 30 vSOL, ETH-scaled)
const VIRTUAL_TOKEN_0 = 1_073_000_000n * E18;
const GRADUATION_ETH = 1n << 255n; // sellout-only graduation, like pump.fun

function newCurve() {
  return { vEth: VIRTUAL_ETH_0, vTok: VIRTUAL_TOKEN_0, realEth: 0n, sold: 0n, graduated: false };
}

const ceilDiv = (a, b) => (a + b - 1n) / b;

function buy(c, ethInGross) {
  assert(!c.graduated, 'not tradable');
  let fee = (ethInGross * FEE_BPS) / 10_000n;
  let ethIn = ethInGross - fee;
  let refund = 0n;
  const k = c.vEth * c.vTok;
  let out = c.vTok - ceilDiv(k, c.vEth + ethIn);
  const remaining = CURVE_SUPPLY - c.sold;
  if (out > remaining) {
    out = remaining;
    const ethNeeded = ceilDiv(k, c.vTok - out) - c.vEth;
    // mirror the contract: fee re-derived from ETH actually used, capped so
    // the refund can never underflow on the 1-wei rounding boundary
    let grossNeeded = ceilDiv(ethNeeded * 10_000n, 10_000n - FEE_BPS);
    if (grossNeeded > ethInGross) grossNeeded = ethInGross;
    fee = grossNeeded - ethNeeded;
    refund = ethInGross - grossNeeded;
    ethIn = ethNeeded;
  }
  assert(out > 0n, 'dust buy');
  c.vEth += ethIn; c.vTok -= out; c.realEth += ethIn; c.sold += out;
  if (c.realEth >= GRADUATION_ETH || c.sold === CURVE_SUPPLY) c.graduated = true;
  return { out, fee, refund };
}

function sell(c, tokensIn) {
  assert(!c.graduated, 'not tradable');
  const k = c.vEth * c.vTok;
  const gross = c.vEth - ceilDiv(k, c.vTok + tokensIn);
  const fee = (gross * FEE_BPS) / 10_000n;
  assert(gross <= c.realEth, 'exceeds reserves');
  c.vEth -= gross; c.vTok += tokensIn; c.realEth -= gross; c.sold -= tokensIn;
  return { out: gross - fee, fee };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('first buy is cheap: 0.01 ETH buys ~1% of supply at open', () => {
  const c = newCurve();
  const { out } = buy(c, E18 / 100n);
  const pct = Number((out * 10_000n) / (1_000_000_000n * E18)) / 100;
  assert(pct > 0.5 && pct < 2, `got ${pct}%`);
});

test('price is monotonically increasing across buys', () => {
  const c = newCurve();
  let last = 0n;
  for (let i = 0; i < 20; i++) {
    const { out } = buy(c, E18 / 50n);
    const costPerToken = (E18 / 50n) * E18 / out; // wei per token
    assert(costPerToken > last, `buy ${i} not more expensive`);
    last = costPerToken;
  }
});

test('round trip loses ~2x fee (no free money)', () => {
  const c = newCurve();
  const spend = E18 / 10n;
  const { out } = buy(c, spend);
  const { out: back } = sell(c, out);
  assert(back < spend, 'round trip must lose');
  const lossBps = Number(((spend - back) * 10_000n) / spend);
  assert(lossBps >= 190 && lossBps <= 230, `loss ${lossBps} bps, expected ~200`);
});

test('curve is always solvent: sellers can never withdraw more than real ETH', () => {
  const c = newCurve();
  const holders = [];
  for (let i = 0; i < 15; i++) holders.push(buy(c, E18 / 20n).out);
  let totalOut = 0n;
  for (const h of holders) totalOut += sell(c, h).out;
  assert(c.realEth >= 0n, 'reserves went negative');
  assert(c.sold === 0n, 'accounting mismatch after full unwind');
});

test('graduation triggers (ETH threshold or supply cap) and locks trading', () => {
  const c = newCurve();
  let buys = 0;
  while (!c.graduated) { buy(c, E18 / 2n); buys++; }
  assert(c.realEth >= GRADUATION_ETH || c.sold === CURVE_SUPPLY, 'graduated without meeting either trigger');
  assert(c.sold <= CURVE_SUPPLY, 'oversold past LP reserve');
  assert.throws(() => buy(c, E18), /not tradable/);
  assert.throws(() => sell(c, E18), /not tradable/);
  console.log(`    (graduated after ${buys} x 0.5 ETH buys; ${c.sold / E18} tokens sold, ${Number(c.realEth) / 1e18} ETH raised)`);
});

test('final buy is clamped at CURVE_SUPPLY with refund, never oversells', () => {
  const c = newCurve();
  let lastRefund = 0n;
  while (!c.graduated) lastRefund = buy(c, 5n * E18).refund;
  assert(c.sold === CURVE_SUPPLY || c.realEth >= GRADUATION_ETH, 'stopped without trigger');
  assert(c.sold <= CURVE_SUPPLY, 'oversold');
  if (c.sold === CURVE_SUPPLY) assert(lastRefund > 0n, 'expected refund on clamped final buy');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
console.log(failed ? `\n${failed} FAILED` : '\nall curve property tests passed');
process.exit(failed ? 1 : 0);
