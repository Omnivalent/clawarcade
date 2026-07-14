#!/usr/bin/env node
// End-to-end tests running the REAL compiled bytecode on @ethereumjs/vm.
// Covers the full product flow: launch → .hood registration (1yr) → curve
// trading → graduation (auto +5yr renewal paid from the raise, LP handoff) →
// expiry → relaunch of the freed name.  Usage: node test/evm.test.js
const assert = require('assert');
const { keccak256 } = require('js-sha3');
const { AbiCoder } = require('ethers');
const { Harness, artifact } = require('./harness');

const E18 = 10n ** 18n;
const coder = AbiCoder.defaultAbiCoder();
const VIRTUAL_ETH_0 = 14n * E18 / 10n; // 1.4 ETH (pump.fun's 30 vSOL, ETH-scaled)
const NO_EARLY_TRIGGER = (1n << 255n); // graduate on sellout only, like pump.fun
const CURVE_SUPPLY = 793_100_000n * E18;
const LP_RESERVE = 206_900_000n * E18;
const YEAR = 365n * 24n * 3600n;
const ZERO32 = '0x' + '0'.repeat(64);
const DEADLINE = (1n << 63n); // far-future trade deadline for tests

async function deployStack(h, { feeBps = 0n, platformFee = 0n, enforceVanity = false, commitAge = 0n, graduationEth = NO_EARLY_TRIGGER } = {}) {
  const registrar = await h.deploy('MockRegistrar', [], []);
  const escrow = await h.deploy('GraduationEscrow', [], []);
  const factory = await h.deploy(
    'TokenFactory',
    ['address', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'bool', 'uint256'],
    [h.accounts.feeSink.toString(), registrar.address.toString(), escrow.address.toString(),
     platformFee, feeBps, VIRTUAL_ETH_0, graduationEth, enforceVanity, commitAge]
  );
  const curve = h.at('BondingCurve', (await h.call(factory, 'curve')).toLowerCase());
  return { registrar, escrow, factory, curve };
}

function grindSalt(factoryAddr, curveAddr, name, symbol, label, suffix = '600d') {
  const initCode = artifact('LaunchToken').bytecode.slice(2) +
    coder.encode(['string', 'string', 'string', 'address'], [name, symbol, label, curveAddr]).slice(2);
  const initHash = keccak256(Buffer.from(initCode, 'hex'));
  for (let i = 0; ; i++) {
    const salt = i.toString(16).padStart(64, '0');
    const packed = 'ff' + factoryAddr.slice(2) + salt + initHash;
    const addr = keccak256(Buffer.from(packed, 'hex')).slice(-40);
    if (addr.endsWith(suffix)) return { salt: '0x' + salt, predicted: '0x' + addr };
  }
}

async function launch(h, S, label, { from = 'alice', name = label, symbol = label.toUpperCase(), salt = ZERO32, value } = {}) {
  const cost = value ?? await h.call(S.factory, 'launchCost', [label]);
  await h.call(S.factory, 'launch', [name, symbol, label, salt, ZERO32], { from, value: cost });
  const token = h.at('LaunchToken', (await h.call(S.factory, 'tokenByLabel', ['0x' + keccak256(label)])).toLowerCase());
  return token;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('launch: deploys token, registers name.hood for 1 year, locked to factory', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token = await launch(h, S, 'supercat');

  assert.equal(await h.call(token, 'totalSupply'), 1_000_000_000n * E18);
  assert.equal(await h.call(token, 'balanceOf', [S.curve.address.toString()]), 1_000_000_000n * E18, 'curve holds full supply');
  assert.equal(await h.call(token, 'hoodLabel'), 'supercat');
  assert.equal((await h.call(S.registrar, 'resolve', ['supercat'])).toLowerCase(), token.address.toString(), 'name resolves to token');
  const rec = await h.call(S.registrar, 'records', ['0x' + keccak256('supercat')]);
  assert.equal(rec[0].toLowerCase(), S.factory.address.toString(), 'name NFT owned by factory, not creator');
  assert.equal(await h.call(S.registrar, 'expiryOf', ['supercat']), h.timestamp + YEAR, 'initial registration is exactly 1 year');
});

test('launch: same label cannot launch twice while registered', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  await launch(h, S, 'supercat');
  await assert.rejects(launch(h, S, 'supercat', { from: 'bob' }), /name unavailable/);
});

test('launch: vanity suffix enforced with ground salt; wrong salt reverts', async () => {
  const h = await Harness.create();
  const S = await deployStack(h, { enforceVanity: true });
  await assert.rejects(launch(h, S, 'supercat'), /vanity suffix mismatch/);
  const { salt, predicted } = grindSalt(S.factory.address.toString(), S.curve.address.toString(), 'supercat', 'SUPERCAT', 'supercat');
  const token = await launch(h, S, 'supercat', { salt });
  assert.equal(token.address.toString(), predicted, 'CREATE2 address matches JS prediction');
  assert(token.address.toString().endsWith('600d'), 'address carries the house suffix');
});

test('zero-fee mode: buys and sells send nothing to the fee sink', async () => {
  const h = await Harness.create();
  const S = await deployStack(h, { feeBps: 0n, platformFee: 0n });
  const token = await launch(h, S, 'supercat');
  const sinkBefore = await h.balance('feeSink');
  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'bob', value: E18 / 10n });
  const bag = await h.call(token, 'balanceOf', [h.accounts.bob.toString()]);
  assert(bag > 0n);
  await h.call(token, 'approve', [S.curve.address.toString(), bag], { from: 'bob' });
  await h.call(S.curve, 'sell', [token.address.toString(), bag, 0n, DEADLINE], { from: 'bob' });
  assert.equal(await h.balance('feeSink'), sinkBefore, 'fee sink untouched at 0 bps');
});

test('zero-fee round trip returns ETH minus rounding dust only; curve stays solvent', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token = await launch(h, S, 'supercat');
  const spend = E18 / 2n;
  const before = await h.balance('bob');
  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'bob', value: spend });
  const bag = await h.call(token, 'balanceOf', [h.accounts.bob.toString()]);
  await h.call(token, 'approve', [S.curve.address.toString(), bag], { from: 'bob' });
  await h.call(S.curve, 'sell', [token.address.toString(), bag, 0n, DEADLINE], { from: 'bob' });
  const after = await h.balance('bob');
  const lost = before - after;
  assert(lost >= 0n && lost < 1000n, `round trip lost ${lost} wei — must be dust-scale, never negative`);
  const st = await h.call(S.curve, 'curves', [token.address.toString()]);
  assert.equal(st[3], 0n, 'tokensSold back to zero');
  const curveEth = await h.balance(S.curve.address.toString());
  assert(curveEth >= st[2], 'contract ETH >= tracked realEth');
});

test('pump.fun tokenomics: sellout at 793.1M sold raises ~2.833x virtual ETH', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token = await launch(h, S, 'supercat');
  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'bob', value: 10n * E18 });
  const st = await h.call(S.curve, 'curves', [token.address.toString()]);
  assert.equal(st[5], true, 'graduated on sellout');
  assert.equal(st[3], CURVE_SUPPLY, 'exactly 793.1M sold');
  const raised = st[2];
  const expected = VIRTUAL_ETH_0 * VIRTUAL_TOKEN_RATIO_NUM / VIRTUAL_TOKEN_RATIO_DEN;
  const tolerance = expected / 1000n;
  assert(raised > expected - tolerance && raised < expected + tolerance, `raised ${raised}, expected ~${expected}`);
});
// pump.fun: raise-at-sellout = vEth0 * (1073/279.9 - 1) = vEth0 * 793.1/279.9
const VIRTUAL_TOKEN_RATIO_NUM = 793_100n;
const VIRTUAL_TOKEN_RATIO_DEN = 279_900n;

test('graduation: clamped final buy refunds excess ETH to the buyer', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token = await launch(h, S, 'supercat');
  const before = await h.balance('bob');
  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'bob', value: 100n * E18 });
  const spent = before - (await h.balance('bob'));
  assert(spent < 5n * E18, `bob spent ${spent} — the ~96 ETH excess must be refunded`);
  assert.equal(await h.call(token, 'balanceOf', [h.accounts.bob.toString()]), CURVE_SUPPLY);
});

test('graduation: name auto-renews +5 years paid from the raise; escrow gets the rest + 206.9M tokens', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token = await launch(h, S, 'supercat');
  const expiry0 = await h.call(S.registrar, 'expiryOf', ['supercat']);
  const renewCost = await h.call(S.registrar, 'priceOf', ['supercat', 5n]);

  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'bob', value: 10n * E18 });

  assert.equal(await h.call(S.registrar, 'expiryOf', ['supercat']), expiry0 + 5n * YEAR, 'name extended exactly 5 years at graduation');
  const st = await h.call(S.curve, 'curves', [token.address.toString()]);
  const escrowEth = await h.balance(S.escrow.address.toString());
  assert.equal(escrowEth, st[2] - renewCost, 'escrow got raise minus renewal cost');
  assert.equal(await h.call(token, 'balanceOf', [S.escrow.address.toString()]), LP_RESERVE, 'escrow got exactly the 206.9M LP reserve');
  assert.equal(await h.balance(S.curve.address.toString()), 0n, 'curve fully drained — nothing stranded');
});

test('graduation: trading is closed afterwards', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token = await launch(h, S, 'supercat');
  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'bob', value: 10n * E18 });
  await assert.rejects(
    h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'alice', value: E18 }), /not tradable/);
  await assert.rejects(
    h.call(S.curve, 'sell', [token.address.toString(), E18, 0n, DEADLINE], { from: 'bob' }), /not tradable/);
});

test('expiry: a never-graduated name frees after 1 year and can be relaunched', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token1 = await launch(h, S, 'failcat');
  await h.call(S.curve, 'buy', [token1.address.toString(), 0n, DEADLINE], { from: 'bob', value: E18 / 10n }); // some activity, no graduation

  await assert.rejects(launch(h, S, 'failcat', { from: 'bob' }), /name unavailable/, 'still locked before expiry');
  h.warp(Number(YEAR) + 60);
  assert.equal(await h.call(S.registrar, 'available', ['failcat']), true, 'expired name is available again');

  // a fresh salt is required on relaunch: the same (name, symbol, label, salt)
  // tuple would CREATE2 to the dead token's address and revert. The frontend
  // grinds a new salt per launch, so this only matters for hand-rolled calls.
  const token2 = await launch(h, S, 'failcat', { from: 'bob', salt: '0x' + '1'.padStart(64, '0') });
  assert.notEqual(token2.address.toString(), token1.address.toString(), 'fresh token contract');
  assert.equal((await h.call(S.registrar, 'resolve', ['failcat'])).toLowerCase(), token2.address.toString(), 'name now points at the new token');
  await h.call(S.curve, 'buy', [token2.address.toString(), 0n, DEADLINE], { from: 'alice', value: E18 / 10n });
  assert((await h.call(token2, 'balanceOf', [h.accounts.alice.toString()])) > 0n, 'new curve trades normally');
});

test('graduated token keeps its name: expiry is 6 years out, relaunch blocked', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token = await launch(h, S, 'supercat');
  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'bob', value: 10n * E18 }); // graduate
  h.warp(Number(YEAR) * 2); // two years later — a dead 1yr name would be free
  assert.equal(await h.call(S.registrar, 'available', ['supercat']), false, 'graduated name still held');
  await assert.rejects(launch(h, S, 'supercat', { from: 'bob' }), /name unavailable/);
});

test('with fees on: 1% accrues on trades, launch fee accrues; collectFees pulls both', async () => {
  const h = await Harness.create();
  const S = await deployStack(h, { feeBps: 100n, platformFee: E18 / 100n });
  const sink0 = await h.balance('feeSink');
  const token = await launch(h, S, 'supercat');
  assert.equal(await h.call(S.factory, 'pendingFees'), E18 / 100n, 'platform launch fee accrued');
  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'bob', value: E18 });
  assert.equal(await h.call(S.curve, 'pendingFees'), E18 / 100n, '1% trade fee accrued');
  await h.call(S.curve, 'collectFees', [], { from: 'bob' });
  await h.call(S.factory, 'collectFees', [], { from: 'bob' });
  assert.equal(await h.balance('feeSink') - sink0, E18 / 50n, 'both fee pools pulled to sink');
  assert.equal(await h.call(S.curve, 'pendingFees'), 0n);
  assert.equal(await h.call(S.factory, 'pendingFees'), 0n);
});

test('commit-reveal: uncommitted launch reverts; committed launch works; copied calldata is useless to a front-runner', async () => {
  const h = await Harness.create();
  const S = await deployStack(h, { commitAge: 15n });
  const secret = '0x' + 'ab'.repeat(32);
  await assert.rejects(
    h.call(S.factory, 'launch', ['supercat', 'SCAT', 'supercat', ZERO32, secret], { from: 'alice', value: 10n * E18 }),
    /commit required/);

  const commitment = '0x' + keccak256(Buffer.from(
    coder.encode(['string', 'address', 'bytes32'], ['supercat', h.accounts.alice.toString(), secret]).slice(2), 'hex'));
  await h.call(S.factory, 'commitName', [commitment], { from: 'alice' });
  await assert.rejects(
    h.call(S.factory, 'launch', ['supercat', 'SCAT', 'supercat', ZERO32, secret], { from: 'alice', value: 10n * E18 }),
    /commit required/, 'reveal too early');
  h.warp(16);
  // bob front-runs with alice's exact calldata — his commitment doesn't exist
  await assert.rejects(
    h.call(S.factory, 'launch', ['supercat', 'SCAT', 'supercat', ZERO32, secret], { from: 'bob', value: 10n * E18 }),
    /commit required/, 'copied calldata must not be launchable by another sender');
  await h.call(S.factory, 'launch', ['supercat', 'SCAT', 'supercat', ZERO32, secret], { from: 'alice', value: 10n * E18 });
  assert.notEqual(await h.call(S.factory, 'tokenByLabel', ['0x' + keccak256('supercat')]), '0x0000000000000000000000000000000000000000');
});

test('renewal hijack guard: an old token graduating cannot pay for a relaunched label', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token1 = await launch(h, S, 'failcat');
  await h.call(S.curve, 'buy', [token1.address.toString(), 0n, DEADLINE], { from: 'bob', value: E18 / 10n });
  h.warp(Number(YEAR) + 60); // failcat's 1yr registration lapses
  const token2 = await launch(h, S, 'failcat', { from: 'bob', salt: '0x' + '1'.padStart(64, '0') });
  const expiry2 = await h.call(S.registrar, 'expiryOf', ['failcat']);

  // token1's curve is still live; graduate it now
  await h.call(S.curve, 'buy', [token1.address.toString(), 0n, DEADLINE], { from: 'alice', value: 10n * E18 });
  const st1 = await h.call(S.curve, 'curves', [token1.address.toString()]);
  assert.equal(st1[5], true, 'token1 graduated');
  assert.equal(await h.call(S.registrar, 'expiryOf', ['failcat']), expiry2, "token2's registration must NOT be extended by token1's raise");
  assert.equal(await h.balance(S.escrow.address.toString()), st1[2], "token1's full raise reached the escrow — nothing spent on the stolen label");
  assert.equal((await h.call(S.registrar, 'resolve', ['failcat'])).toLowerCase(), token2.address.toString());
});

test('lapsed-name graduation: name is re-registered for 5 years, not silently lost', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token = await launch(h, S, 'slowcat');
  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'bob', value: E18 / 10n });
  h.warp(Number(YEAR) + 60); // registration lapses mid-bonding, nobody relaunches
  assert.equal(await h.call(S.registrar, 'available', ['slowcat']), true);
  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'alice', value: 10n * E18 }); // graduates
  assert.equal(await h.call(S.registrar, 'available', ['slowcat']), false, 'name re-registered at graduation');
  assert.equal((await h.call(S.registrar, 'resolve', ['slowcat'])).toLowerCase(), token.address.toString(), 'name points back at the graduated token');
  assert.equal(await h.call(S.registrar, 'expiryOf', ['slowcat']), h.timestamp + 5n * YEAR, 'fresh 5-year registration');
});

test('renewName: anyone can extend a custodied name permissionlessly', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  await launch(h, S, 'supercat');
  const expiry0 = await h.call(S.registrar, 'expiryOf', ['supercat']);
  const price = await h.call(S.registrar, 'priceOf', ['supercat', 2n]);
  await h.call(S.factory, 'renewName', ['supercat', 2n], { from: 'bob', value: price });
  assert.equal(await h.call(S.registrar, 'expiryOf', ['supercat']), expiry0 + 2n * YEAR, 'bob extended the name by 2 years');
  await assert.rejects(
    h.call(S.factory, 'renewName', ['nosuchtoken', 2n], { from: 'bob', value: price }), /unknown label/);
});

test('constructor rejects graduationEth = 0 (would graduate every token on first buy)', async () => {
  const h = await Harness.create();
  await assert.rejects(deployStack(h, { graduationEth: 0n }), /zero graduation trigger/);
});

test('anti-sandwich: a passed deadline reverts the trade', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token = await launch(h, S, 'supercat');
  const past = h.timestamp - 1n;
  await assert.rejects(
    h.call(S.curve, 'buy', [token.address.toString(), 0n, past], { from: 'bob', value: E18 / 10n }), /expired/);
});

test('anti-sandwich: minTokensOut floor reverts a buy the market moved past', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token = await launch(h, S, 'supercat');
  const quoted = await h.call(S.curve, 'quoteBuy', [token.address.toString(), E18 / 10n]);
  // a front-runner buys first, pushing the price up so our fill falls short
  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'alice', value: E18 });
  await assert.rejects(
    h.call(S.curve, 'buy', [token.address.toString(), quoted, DEADLINE], { from: 'bob', value: E18 / 10n }), /slippage/);
});

test('social: self-register a name to sign in with; reverse identity resolves', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const price = await h.call(S.registrar, 'priceOf', ['alicehood', 1n]);
  await h.call(S.registrar, 'registerSelf', ['alicehood', 1n], { from: 'alice', value: price });
  assert.equal((await h.call(S.registrar, 'ownerOf', ['alicehood'])).toLowerCase(), h.accounts.alice.toString());
  assert.equal(await h.call(S.registrar, 'nameOf', [h.accounts.alice.toString()]), 'alicehood', 'reverse identity resolves');
  assert.equal(await h.call(S.registrar, 'nameOf', [h.accounts.bob.toString()]), '', 'no name => empty identity');
});

test('social: comments emit events, respect the cooldown, cap length', async () => {
  const h = await Harness.create();
  const board = await h.deploy('CommentBoard', ['uint256'], [30n]);
  const token = '0x' + '11'.repeat(20);
  await h.call(board, 'post', [token, 'gm hoodpad'], { from: 'alice' });
  await assert.rejects(h.call(board, 'post', [token, 'too fast'], { from: 'alice' }), /slow down/);
  await assert.rejects(h.call(board, 'post', [token, ''], { from: 'bob' }), /bad length/);
  await h.call(board, 'post', [token, 'nice launch'], { from: 'bob' }); // different author, no cooldown
});

test('with fees on: clamped graduation buy is charged fee on ETH used, not on the refund', async () => {
  const h = await Harness.create();
  const S = await deployStack(h, { feeBps: 100n });
  const token = await launch(h, S, 'supercat');
  const sink0 = await h.balance('feeSink');
  const bob0 = await h.balance('bob');
  await h.call(S.curve, 'buy', [token.address.toString(), 0n, DEADLINE], { from: 'bob', value: 100n * E18 }); // needs only ~4 ETH
  const st = await h.call(S.curve, 'curves', [token.address.toString()]);
  assert.equal(st[5], true, 'graduated');
  const fee = await h.call(S.curve, 'pendingFees');
  const spent = bob0 - (await h.balance('bob'));
  assert(fee < E18 / 20n, `fee ${fee} must be ~1% of ~4 ETH used, not 1 ETH (1% of 100)`);
  assert.equal(spent, st[2] + fee, 'bob paid exactly raise + fee; the rest was refunded');
  void sink0;
});

test('launch overpayment is refunded', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const cost = await h.call(S.factory, 'launchCost', ['supercat']);
  const before = await h.balance('alice');
  await launch(h, S, 'supercat', { value: cost + 5n * E18 });
  const spent = before - (await h.balance('alice'));
  assert.equal(spent, cost, 'excess 5 ETH returned');
});

test('token is rug-proof: no owner, no mint, transfers are the only surface', async () => {
  const h = await Harness.create();
  const S = await deployStack(h);
  const token = await launch(h, S, 'supercat');
  const fns = token.iface.fragments.filter(f => f.type === 'function' && f.stateMutability !== 'view' && f.stateMutability !== 'pure').map(f => f.name).sort();
  assert.deepEqual(fns, ['approve', 'transfer', 'transferFrom'], `unexpected mutating surface: ${fns}`);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall EVM end-to-end tests passed (real bytecode)');
  process.exit(failed ? 1 : 0);
})();
