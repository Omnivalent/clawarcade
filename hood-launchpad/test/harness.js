// Minimal EVM harness: runs the ACTUAL compiled bytecode on @ethereumjs/vm.
// No mocked math — these are the same bytes that would be deployed on chain.
const fs = require('fs');
const path = require('path');
const { VM } = require('@ethereumjs/vm');
const { Block } = require('@ethereumjs/block');
const { Address, Account, hexToBytes, bytesToHex } = require('@ethereumjs/util');
const { Interface, AbiCoder } = require('ethers');

const BUILD = path.join(__dirname, '..', 'build');
const coder = AbiCoder.defaultAbiCoder();

function artifact(name) {
  const a = JSON.parse(fs.readFileSync(path.join(BUILD, name + '.json'), 'utf8'));
  return { abi: a.abi, bytecode: '0x' + a.bytecode, iface: new Interface(a.abi) };
}

class Harness {
  static async create() {
    const h = new Harness();
    h.vm = await VM.create();
    h.timestamp = 1_800_000_000n; // fixed genesis time for determinism
    h.accounts = {};
    for (const name of ['deployer', 'alice', 'bob', 'feeSink']) {
      const addr = Address.fromString('0x' + Buffer.from(name.padEnd(20, '_')).toString('hex'));
      await h.vm.stateManager.putAccount(addr, new Account(0n, 10_000_000n * 10n ** 18n));
      h.accounts[name] = addr;
    }
    return h;
  }

  block() {
    return Block.fromBlockData(
      { header: { timestamp: this.timestamp, gasLimit: 1_000_000_000n } },
      { common: this.vm.common }
    );
  }

  warp(seconds) { this.timestamp += BigInt(seconds); }

  async raw({ from, to, data, value = 0n }) {
    const res = await this.vm.evm.runCall({
      caller: this.accounts[from],
      origin: this.accounts[from],
      to,
      data: hexToBytes(data),
      value,
      gasLimit: 100_000_000n,
      block: this.block(),
    });
    return res;
  }

  revertReason(res) {
    const ret = res.execResult.returnValue;
    if (ret && ret.length >= 4 && bytesToHex(ret.slice(0, 4)) === '0x08c379a0') {
      return coder.decode(['string'], ret.slice(4))[0];
    }
    return res.execResult.exceptionError?.error ?? 'unknown';
  }

  async deploy(name, types, args, { from = 'deployer', value = 0n } = {}) {
    const art = artifact(name);
    const data = art.bytecode + (types.length ? coder.encode(types, args).slice(2) : '');
    const res = await this.raw({ from, to: undefined, data, value });
    if (res.execResult.exceptionError) {
      throw new Error(`deploy ${name} failed: ${this.revertReason(res)}`);
    }
    return { address: res.createdAddress, iface: art.iface, name };
  }

  async call(contract, fn, args = [], { from = 'deployer', value = 0n } = {}) {
    const data = contract.iface.encodeFunctionData(fn, args);
    const res = await this.raw({ from, to: contract.address, data, value });
    if (res.execResult.exceptionError) {
      const err = new Error(`${contract.name}.${fn} reverted: ${this.revertReason(res)}`);
      err.reverted = true;
      throw err;
    }
    const frag = contract.iface.getFunction(fn);
    if (frag.outputs.length === 0) return undefined;
    const decoded = contract.iface.decodeFunctionResult(fn, res.execResult.returnValue);
    return frag.outputs.length === 1 ? decoded[0] : decoded;
  }

  async balance(addressOrAccount) {
    const addr = typeof addressOrAccount === 'string'
      ? (this.accounts[addressOrAccount] ?? Address.fromString(addressOrAccount))
      : addressOrAccount;
    const acct = await this.vm.stateManager.getAccount(addr);
    return acct?.balance ?? 0n;
  }

  at(name, addressHex) {
    const art = artifact(name);
    return { address: Address.fromString(addressHex), iface: art.iface, name };
  }
}

module.exports = { Harness, artifact, coder };
