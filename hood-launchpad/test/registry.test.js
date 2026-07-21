#!/usr/bin/env node
// Tests for GarlicRegistry — our own .hood name service — running the real
// compiled bytecode on @ethereumjs/vm. Covers ERC-721 behavior, expiry/renew,
// reverse identity, pricing, charset, and a full TokenFactory launch through it.
// Usage: node test/registry.test.js
const assert = require('assert');
const { keccak256 } = require('js-sha3');
const { Harness, artifact } = require('./harness');
const { AbiCoder } = require('ethers');

const E18 = 10n ** 18n;
const coder = AbiCoder.defaultAbiCoder();
const YEAR = 365n * 24n * 3600n;
const ZERO = '0x0000000000000000000000000000000000000000';
const ZERO32 = '0x' + '0'.repeat(64);
const tokenId = label => BigInt('0x' + keccak256(label));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('register mints an ERC-721 name to the owner; resolves + owns', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  const price = await h.call(reg, 'priceOf', ['supercat', 1n]);
  const target = '0x' + '11'.repeat(20);
  await h.call(reg, 'register', ['supercat', h.accounts.alice.toString(), target, 1n, ZERO32], { from: 'alice', value: price });

  assert.equal((await h.call(reg, 'ownerOf(uint256)', [tokenId('supercat')])).toLowerCase(), h.accounts.alice.toString());
  assert.equal((await h.call(reg, 'ownerOf(string)', ['supercat'])).toLowerCase(), h.accounts.alice.toString());
  assert.equal((await h.call(reg, 'resolve', ['supercat'])).toLowerCase(), target);
  assert.equal(await h.call(reg, 'balanceOf', [h.accounts.alice.toString()]), 1n);
  assert.equal(await h.call(reg, 'available', ['supercat']), false);
  assert.equal(await h.call(reg, 'supportsInterface', ['0x80ac58cd']), true, 'declares ERC-721');
});

test('name NFT transfers like an ERC-721; resolver owner moves with it', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  const price = await h.call(reg, 'priceOf', ['supercat', 1n]);
  await h.call(reg, 'register', ['supercat', h.accounts.alice.toString(), h.accounts.alice.toString(), 1n, ZERO32], { from: 'alice', value: price });
  await h.call(reg, 'transferFrom', [h.accounts.alice.toString(), h.accounts.bob.toString(), tokenId('supercat')], { from: 'alice' });
  assert.equal((await h.call(reg, 'ownerOf(uint256)', [tokenId('supercat')])).toLowerCase(), h.accounts.bob.toString());
  assert.equal(await h.call(reg, 'balanceOf', [h.accounts.alice.toString()]), 0n);
  assert.equal(await h.call(reg, 'balanceOf', [h.accounts.bob.toString()]), 1n);
  // an unauthorized transfer is rejected
  await assert.rejects(
    h.call(reg, 'transferFrom', [h.accounts.bob.toString(), h.accounts.alice.toString(), tokenId('supercat')], { from: 'alice' }),
    /not authorized/);
});

test('approve lets a spender move the name once', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  const price = await h.call(reg, 'priceOf', ['supercat', 1n]);
  await h.call(reg, 'register', ['supercat', h.accounts.alice.toString(), h.accounts.alice.toString(), 1n, ZERO32], { from: 'alice', value: price });
  await h.call(reg, 'approve', [h.accounts.bob.toString(), tokenId('supercat')], { from: 'alice' });
  await h.call(reg, 'transferFrom', [h.accounts.alice.toString(), h.accounts.bob.toString(), tokenId('supercat')], { from: 'bob' });
  assert.equal((await h.call(reg, 'ownerOf(uint256)', [tokenId('supercat')])).toLowerCase(), h.accounts.bob.toString());
});

test('expiry: a name lapses, becomes available, and re-registering reassigns the NFT', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  const price = await h.call(reg, 'priceOf', ['supercat', 1n]);
  await h.call(reg, 'register', ['supercat', h.accounts.alice.toString(), h.accounts.alice.toString(), 1n, ZERO32], { from: 'alice', value: price });
  h.warp(Number(YEAR) + 60);
  assert.equal(await h.call(reg, 'available', ['supercat']), true, 'expired name is available');
  assert.equal((await h.call(reg, 'ownerOf(string)', ['supercat'])), ZERO, 'string ownerOf is 0 when expired');
  await assert.rejects(h.call(reg, 'ownerOf(uint256)', [tokenId('supercat')]), /expired/);
  // bob re-registers it; NFT reassigns, alice's balance drops
  await h.call(reg, 'register', ['supercat', h.accounts.bob.toString(), h.accounts.bob.toString(), 1n, ZERO32], { from: 'bob', value: price });
  assert.equal((await h.call(reg, 'ownerOf(uint256)', [tokenId('supercat')])).toLowerCase(), h.accounts.bob.toString());
  assert.equal(await h.call(reg, 'balanceOf', [h.accounts.alice.toString()]), 0n);
  assert.equal(await h.call(reg, 'balanceOf', [h.accounts.bob.toString()]), 1n);
});

test('renew extends expiry; cannot renew an expired name', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  const price = await h.call(reg, 'priceOf', ['supercat', 1n]);
  await h.call(reg, 'register', ['supercat', h.accounts.alice.toString(), h.accounts.alice.toString(), 1n, ZERO32], { from: 'alice', value: price });
  const exp0 = await h.call(reg, 'expiryOf', ['supercat']);
  await h.call(reg, 'renew', ['supercat', 2n], { from: 'alice', value: await h.call(reg, 'priceOf', ['supercat', 2n]) });
  assert.equal(await h.call(reg, 'expiryOf', ['supercat']), exp0 + 2n * YEAR);
  h.warp(Number(YEAR) * 4);
  await assert.rejects(h.call(reg, 'renew', ['supercat', 1n], { from: 'alice', value: price }), /not registered/);
});

test('registerSelf sets a primary name; reverse resolves; clears on transfer', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  const price = await h.call(reg, 'priceOf', ['alicename', 1n]);
  await h.call(reg, 'registerSelf', ['alicename', 1n], { from: 'alice', value: price });
  assert.equal(await h.call(reg, 'nameOf', [h.accounts.alice.toString()]), 'alicename');
  assert.equal(await h.call(reg, 'nameOf', [h.accounts.bob.toString()]), '');
  // transferring the name away clears the reverse record
  await h.call(reg, 'transferFrom', [h.accounts.alice.toString(), h.accounts.bob.toString(), tokenId('alicename')], { from: 'alice' });
  assert.equal(await h.call(reg, 'nameOf', [h.accounts.alice.toString()]), '', 'reverse cleared after transfer');
});

test('pricing: length tiers; owner can retune', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  const p5 = await h.call(reg, 'priceOf', ['supercat', 1n]);
  const p4 = await h.call(reg, 'priceOf', ['cats', 1n]);
  const p3 = await h.call(reg, 'priceOf', ['cat', 1n]);
  assert(p3 > p4 && p4 > p5, 'shorter names cost more');
  await assert.rejects(h.call(reg, 'priceOf', ['ab', 1n]), /too short/);
  await h.call(reg, 'setPrices', [1n, 2n, 3n], { from: 'deployer' });
  assert.equal(await h.call(reg, 'priceOf', ['supercat', 1n]), 3n);
  await assert.rejects(h.call(reg, 'setPrices', [1n, 2n, 3n], { from: 'bob' }), /only owner/);
});

test('charset: uppercase / unicode / edge-hyphen labels are rejected', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  for (const bad of ['Doge', 'dоge', '-doge', 'doge-', 'do']) {
    await assert.rejects(
      h.call(reg, 'registerSelf', [bad, 1n], { from: 'alice', value: 10n * E18 }),
      /bad label length|label charset|label hyphen|too short/, `expected "${bad}" rejected`);
  }
});

test('commit-reveal can be turned on by the owner', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  await h.call(reg, 'setCommitMinAge', [30n], { from: 'deployer' });
  const price = await h.call(reg, 'priceOf', ['supercat', 1n]);
  const target = h.accounts.alice.toString();
  await assert.rejects(
    h.call(reg, 'register', ['supercat', target, target, 1n, ZERO32], { from: 'alice', value: price }),
    /commit required/);
  const commitment = '0x' + keccak256(Buffer.from(
    coder.encode(['string', 'address', 'address', 'bytes32'], ['supercat', target, target, ZERO32]).slice(2), 'hex'));
  await h.call(reg, 'commit', [commitment], { from: 'alice' });
  h.warp(31);
  await h.call(reg, 'register', ['supercat', target, target, 1n, ZERO32], { from: 'alice', value: price });
  assert.equal(await h.call(reg, 'available', ['supercat']), false);
});

test('withdraw sweeps collected fees to the owner', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  const price = await h.call(reg, 'priceOf', ['supercat', 1n]);
  await h.call(reg, 'register', ['supercat', h.accounts.alice.toString(), h.accounts.alice.toString(), 1n, ZERO32], { from: 'alice', value: price });
  const before = await h.balance('bob');
  await h.call(reg, 'withdraw', [h.accounts.bob.toString()], { from: 'deployer' });
  assert.equal(await h.balance('bob') - before, price, 'fees swept to recipient');
  assert.equal(await h.balance(reg.address.toString()), 0n);
});

test('full launch: TokenFactory + GarlicRegistry — name is minted, custodied, resolves to token', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  const escrow = await h.deploy('GraduationEscrow', [], []);
  const factory = await h.deploy(
    'TokenFactory',
    ['address', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'bool', 'uint256'],
    [h.accounts.feeSink.toString(), reg.address.toString(), escrow.address.toString(), 0n, 0n, 14n * E18 / 10n, (1n << 255n), false, 0n]
  );
  const cost = await h.call(factory, 'launchCost', ['supercat']);
  await h.call(factory, 'launch', ['Super Cat', 'SCAT', 'supercat', ZERO32, ZERO32], { from: 'alice', value: cost });
  const token = (await h.call(factory, 'tokenByLabel', ['0x' + keccak256('supercat')])).toLowerCase();

  assert.equal((await h.call(reg, 'resolve', ['supercat'])).toLowerCase(), token, 'name resolves to the token');
  assert.equal((await h.call(reg, 'ownerOf(uint256)', [tokenId('supercat')])).toLowerCase(), factory.address.toString(), 'name NFT custodied by the factory');
  assert.equal(await h.call(reg, 'available', ['supercat']), false);
});

// ---- Coin binding: the identity layer (attach a name to a coin, uniquely) ----

async function registerName(h, reg, label, who) {
  const price = await h.call(reg, 'priceOf', [label, 1n]);
  const acct = h.accounts[who].toString();
  await h.call(reg, 'register', [label, acct, acct, 1n, ZERO32], { from: who, value: price });
}

test('attachToken binds a name to a coin, both directions, uniquely', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  await registerName(h, reg, 'pepe', 'alice');
  const coin = '0x' + 'ab'.repeat(20);

  await h.call(reg, 'attachToken', ['pepe', coin], { from: 'alice' });
  assert.equal((await h.call(reg, 'tokenForName', ['pepe'])).toLowerCase(), coin, 'name → coin');
  assert.equal(await h.call(reg, 'nameForToken', [coin]), 'pepe', 'coin → name (verified identity)');
  // attaching also points the resolver at the coin
  assert.equal((await h.call(reg, 'resolve', ['pepe'])).toLowerCase(), coin);
});

test('one coin, one name: a second name cannot claim a bound coin', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  await registerName(h, reg, 'pepe', 'alice');
  await registerName(h, reg, 'pepecoin', 'bob');
  const coin = '0x' + 'cd'.repeat(20);

  await h.call(reg, 'attachToken', ['pepe', coin], { from: 'alice' });
  await assert.rejects(
    h.call(reg, 'attachToken', ['pepecoin', coin], { from: 'bob' }),
    /coin already named/, 'copycat name is blocked from the same coin');
});

test('only the live name owner can attach or detach', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  await registerName(h, reg, 'pepe', 'alice');
  const coin = '0x' + 'ef'.repeat(20);
  await assert.rejects(h.call(reg, 'attachToken', ['pepe', coin], { from: 'bob' }), /not your live name/);
  await h.call(reg, 'attachToken', ['pepe', coin], { from: 'alice' });
  await assert.rejects(h.call(reg, 'detachToken', ['pepe'], { from: 'bob' }), /not your live name/);
});

test('rebinding a name to a new coin frees the old coin', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  await registerName(h, reg, 'pepe', 'alice');
  const coinA = '0x' + '1a'.repeat(20);
  const coinB = '0x' + '2b'.repeat(20);
  await h.call(reg, 'attachToken', ['pepe', coinA], { from: 'alice' });
  await h.call(reg, 'attachToken', ['pepe', coinB], { from: 'alice' });
  assert.equal(await h.call(reg, 'nameForToken', [coinA]), '', 'old coin released');
  assert.equal(await h.call(reg, 'nameForToken', [coinB]), 'pepe', 'new coin bound');
  // and the freed coin can now be claimed by another name
  await registerName(h, reg, 'wojak', 'bob');
  await h.call(reg, 'attachToken', ['wojak', coinA], { from: 'bob' });
  assert.equal(await h.call(reg, 'nameForToken', [coinA]), 'wojak');
});

test('detachToken frees both sides', async () => {
  const h = await Harness.create();
  const reg = await h.deploy('GarlicRegistry', [], []);
  await registerName(h, reg, 'pepe', 'alice');
  const coin = '0x' + '3c'.repeat(20);
  await h.call(reg, 'attachToken', ['pepe', coin], { from: 'alice' });
  await h.call(reg, 'detachToken', ['pepe'], { from: 'alice' });
  assert.equal((await h.call(reg, 'tokenForName', ['pepe'])).toLowerCase(), ZERO);
  assert.equal(await h.call(reg, 'nameForToken', [coin]), '');
  await assert.rejects(h.call(reg, 'detachToken', ['pepe'], { from: 'alice' }), /not attached/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall GarlicRegistry tests passed (real bytecode)');
  process.exit(failed ? 1 : 0);
})();
