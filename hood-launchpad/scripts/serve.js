#!/usr/bin/env node
// Zero-dependency static server for the hoodpad dApp. Wallet extensions
// (MetaMask, Phantom, Robinhood, ...) inject into a real browser tab, so the
// app must run in YOUR browser — open http://localhost:8788 after starting it.
//   node scripts/serve.js            → serves app/ on :8788
//   PORT=9000 node scripts/serve.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'app');
const PORT = Number(process.env.PORT || 8788);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`hoodpad app → http://localhost:${PORT}`);
  console.log('open that in the browser where your wallet extension is installed.');
  if (!fs.existsSync(path.join(ROOT, 'deployment.json'))) {
    console.log('\n⚠  app/deployment.json missing — run scripts/deploy.js first so the app knows your contract addresses.');
  }
});
