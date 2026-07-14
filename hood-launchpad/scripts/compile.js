#!/usr/bin/env node
// Compile-checks every contract with solc 0.8.26 and writes ABIs + bytecode
// to build/. Usage: node scripts/compile.js
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const ROOT = path.join(__dirname, '..', 'contracts');

function collectSources(dir, sources = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSources(full, sources);
    else if (entry.name.endsWith('.sol')) {
      const key = path.relative(ROOT, full).split(path.sep).join('/');
      sources[key] = { content: fs.readFileSync(full, 'utf8') };
    }
  }
  return sources;
}

const input = {
  language: 'Solidity',
  sources: collectSources(ROOT),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

function importResolver(importPath) {
  // All imports are relative within contracts/; solc normalizes them to
  // ROOT-relative keys already present in sources.
  const key = importPath.replace(/^\.\//, '').replace(/^(\.\.\/)+/, '');
  const full = path.join(ROOT, key);
  if (fs.existsSync(full)) return { contents: fs.readFileSync(full, 'utf8') };
  return { error: 'not found: ' + importPath };
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: importResolver }));

let failed = false;
for (const err of output.errors || []) {
  const line = err.formattedMessage || err.message;
  if (err.severity === 'error') { failed = true; console.error(line); }
  else console.warn(line);
}
if (failed) process.exit(1);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
let count = 0;
for (const [file, contracts] of Object.entries(output.contracts || {})) {
  for (const [name, artifact] of Object.entries(contracts)) {
    fs.writeFileSync(
      path.join(outDir, `${name}.json`),
      JSON.stringify({ contractName: name, sourceFile: file, abi: artifact.abi, bytecode: artifact.evm.bytecode.object }, null, 2)
    );
    count++;
  }
}
console.log(`✓ compiled ${count} contracts to build/`);
