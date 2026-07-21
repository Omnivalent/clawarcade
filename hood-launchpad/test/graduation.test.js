#!/usr/bin/env node
// Tests for UniswapV3GraduationHandler on real compiled bytecode.
// (1) the sqrtPriceX96 price math vs known Uniswap vectors, and
// (2) the full onGraduation flow vs a mock NonfungiblePositionManager:
//     wrap ETH → create pool → mint full-range → BURN the LP position.
// Real-periphery validation still needs a fork test — see the contract's note.
const assert = require('assert');
const { Harness } = require('./harness');

const E18 = 10n ** 18n;
const Q96 = 1n << 96n;
const BURN = '0x000000000000000000000000000000000000dead';
const ZERO_TREASURY = '0x00000000000000000000000000000000000000ff';

async function deployHandler(h) {
  const weth = await h.deploy('MockWETH9', [], []);
  const npm = await h.deploy('MockPositionManager', [], []);
  const handler = await h.deploy('UniswapV3GraduationHandler',
    ['address', 'address', 'uint24', 'address'],
    [npm.address.toString(), weth.address.toString(), 3000n, ZERO_TREASURY]);
  return { weth, npm, handler };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('sqrtPriceX96 matches Uniswap vectors (1:1, 4:1, 1:4)', async () => {
  const h = await Harness.create();
  const { handler } = await deployHandler(h);
  // price = amount1/amount0; sqrtPriceX96 = sqrt(price) * 2^96
  assert.equal(await h.call(handler, 'previewSqrtPriceX96', [1n, 1n]), Q96, '1:1 → 2^96');
  assert.equal(await h.call(handler, 'previewSqrtPriceX96', [1n, 4n]), 2n * Q96, '4:1 → 2*2^96');
  assert.equal(await h.call(handler, 'previewSqrtPriceX96', [4n, 1n]), Q96 / 2n, '1:4 → 2^96/2');
  // a realistic graduation: 206.9M tokens vs ~4 ETH
  const sqrtP = await h.call(handler, 'previewSqrtPriceX96', [206_900_000n * E18, 4n * E18]);
  assert(sqrtP > 0n && sqrtP < (1n << 160n), 'realistic reserves produce a valid sqrtPriceX96');
});

test('constructor rejects a non-0.3% fee (ticks are tuned for 60-spacing)', async () => {
  const h = await Harness.create();
  const weth = await h.deploy('MockWETH9', [], []);
  const npm = await h.deploy('MockPositionManager', [], []);
  await assert.rejects(
    h.deploy('UniswapV3GraduationHandler', ['address', 'address', 'uint24', 'address'],
      [npm.address.toString(), weth.address.toString(), 500n, ZERO_TREASURY]),
    /0.3% fee/);
});

test('onGraduation: only the authorized curve may call', async () => {
  const h = await Harness.create();
  const { handler } = await deployHandler(h);
  await h.call(handler, 'setCurve', [h.accounts.alice.toString()], { from: 'deployer' });
  const token = await h.deploy('MockERC20', ['string', 'string'], ['T', 'T']);
  await assert.rejects(
    h.call(handler, 'onGraduation', [token.address.toString(), E18], { from: 'bob', value: E18 }),
    /only curve/);
});

test('setCurve is one-time and owner-only', async () => {
  const h = await Harness.create();
  const { handler } = await deployHandler(h);
  await assert.rejects(h.call(handler, 'setCurve', [h.accounts.bob.toString()], { from: 'bob' }), /only owner/);
  await h.call(handler, 'setCurve', [h.accounts.alice.toString()], { from: 'deployer' });
  await assert.rejects(h.call(handler, 'setCurve', [h.accounts.bob.toString()], { from: 'deployer' }), /already set/);
});

test('onGraduation seeds the pool and BURNS the LP position', async () => {
  const h = await Harness.create();
  const { weth, npm, handler } = await deployHandler(h);
  await h.call(handler, 'setCurve', [h.accounts.alice.toString()], { from: 'deployer' });

  const token = await h.deploy('MockERC20', ['string', 'string'], ['Garlic', 'GARLIC']);
  const tokenAmount = 206_900_000n * E18;
  const ethAmount = 4n * E18;
  // the curve transfers the reserved tokens to the handler, then calls onGraduation with ETH
  await h.call(token, 'mint', [handler.address.toString(), tokenAmount], { from: 'alice' });
  await h.call(handler, 'onGraduation', [token.address.toString(), tokenAmount], { from: 'alice', value: ethAmount });

  // pool was initialized at the graduation price
  const expectedSqrt = token.address.toString() < weth.address.toString()
    ? await h.call(handler, 'previewSqrtPriceX96', [tokenAmount, ethAmount])
    : await h.call(handler, 'previewSqrtPriceX96', [ethAmount, tokenAmount]);
  assert.equal(await h.call(npm, 'lastSqrtPriceX96', []), expectedSqrt, 'pool initialized at graduation price');

  // the full reserves were supplied as liquidity
  const a0 = await h.call(npm, 'lastAmount0', []);
  const a1 = await h.call(npm, 'lastAmount1', []);
  assert.equal(a0 + a1, tokenAmount + ethAmount, 'both reserves went into the position');
  assert.equal((await h.call(npm, 'lastRecipient', [])).toLowerCase(), handler.address.toString());

  // the position NFT (tokenId 1) was burned → liquidity locked forever
  assert.equal((await h.call(npm, 'positionOwner', [1n])).toLowerCase(), BURN, 'LP position burned');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall graduation-handler tests passed (real bytecode)');
  process.exit(failed ? 1 : 0);
})();
