/* garlic.hood dApp — connect a wallet, sign in, launch/trade tokens on their
 * .hood names, and comment. Talks to the contracts in deployment.json over
 * the connected wallet's provider. Read-only until you sign in. */
'use strict';
const { ethers } = window;
const ABI = window.HOODPAD_ABI;
const $ = id => document.getElementById(id);
const fmt = (wei, dp = 4) => Number(ethers.formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: dp });

const state = {
  deployment: null,
  wallets: [],          // EIP-6963 discovered providers
  provider: null,       // ethers BrowserProvider (wallet)
  reader: null,         // ethers JsonRpcProvider (reads, no wallet needed)
  signer: null,
  account: null,
  chainId: null,
  siwe: false,          // signed in this session
  identity: null,       // primary .hood name of the account
  contracts: {},
  current: null,        // { token, label, name, symbol }
};

// ---------- config: the chain the hosted app targets ----------
const CHAIN = {
  id: 46630,
  hexId: '0x' + (46630).toString(16),
  rpc: 'https://rpc.testnet.chain.robinhood.com/rpc',
  name: 'Robinhood Chain Testnet',
  explorer: 'https://explorer.testnet.chain.robinhood.com',
  faucet: 'https://faucet.testnet.chain.robinhood.com',
};

// ---------- boot ----------
async function boot() {
  discoverWallets();
  bindUI();
  // config sources, in order: this browser's localStorage (you deployed from
  // your wallet) → a bundled deployment.json (local `serve.js`) → none (show
  // the one-click setup).
  state.deployment = loadLocalDeployment() || await loadFileDeployment();
  if (state.deployment) startApp();
  else { document.body.classList.add('needsetup'); renderSetup(); }
}
function loadLocalDeployment() {
  try { const j = localStorage.getItem('garlic_deployment'); if (j) return JSON.parse(j); } catch {}
  return null;
}
async function loadFileDeployment() {
  try { const r = await fetch('deployment.json'); if (r.ok) return await r.json(); } catch {}
  return null;
}

function startApp() {
  document.body.classList.remove('needsetup');
  // Prefer the connected wallet's provider for reads (works on whatever chain
  // the wallet is on); fall back to the public RPC before a wallet connects.
  state.reader = state.provider || new ethers.JsonRpcProvider(state.deployment.rpc);
  wireReadContracts();
  renderChainInfo();
  renderAccount();
  refreshFeed();
  refreshLeaderboard();
}

// ---------- one-click in-browser setup (no terminal, no Node) ----------
function renderSetup() {
  const el = $('setupPanel');
  el.innerHTML =
    `<h2>Set up garlic.hood — one time, about a minute</h2>` +
    `<p class="muted" style="margin:.3rem 0 1rem; max-width:52ch;">This deploys your own copy of garlic.hood to Robinhood Chain testnet, straight from your wallet. No downloads, no terminal — you'll approve a few free transactions.</p>` +
    `<ol class="setup-steps">` +
    `<li><b>Connect</b> a wallet (MetaMask, Phantom, Coinbase, Robinhood).</li>` +
    `<li>Get <b>free test ETH</b> — the button appears after you connect.</li>` +
    `<li><b>Deploy</b> — approve ~4 transactions. That's it.</li>` +
    `</ol>` +
    `<div class="setup-actions">` +
    `<button class="pill" id="setupConnect">Connect wallet</button>` +
    `<button class="btn-buy" id="setupDeploy" disabled>Deploy garlic.hood</button>` +
    `</div>` +
    `<div id="setupMsg" class="muted" style="margin-top:.8rem; font-size:.9rem;"></div>`;
  $('setupConnect').onclick = openModal;
  $('setupDeploy').onclick = () => deployContracts($('setupDeploy'));
}

// called from connect() when we're still in setup mode
function onSetupConnected() {
  const msg = $('setupMsg');
  const onChain = state.chainId === CHAIN.id;
  msg.innerHTML =
    `Connected <span class="mono">${short(state.account)}</span>. ` +
    `<a href="${CHAIN.faucet}" target="_blank" rel="noopener">Get free test ETH →</a> (paste your address) ` +
    (onChain ? '' : `<br><span class="warn">Your wallet isn't on ${CHAIN.name} yet — the Deploy button will add/switch it for you.</span>`);
  $('setupConnect').textContent = short(state.account);
  $('setupDeploy').disabled = false;
}

async function ensureNetwork() {
  const p = state.walletProvider;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hexId }] });
  } catch (e) {
    if (e.code === 4902 || /Unrecognized chain/i.test(e.message || '')) {
      await p.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: CHAIN.hexId, chainName: CHAIN.name,
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: [CHAIN.rpc], blockExplorerUrls: [CHAIN.explorer],
      }] });
    } else throw e;
  }
  state.signer = await state.provider.getSigner();
}

async function deployContracts(btn) {
  if (!state.signer) { toast('Connect a wallet first.', 'warn'); return; }
  const B = window.DEPLOY_BUNDLE;
  if (!B) { toast('Deploy bundle missing — rebuild with node scripts/compile.js', 'bad'); return; }
  const virtualEth0 = ethers.parseEther('0.05'); // graduation reachable with ~0.15 test ETH
  const graduationEth = ethers.MaxUint256 >> 1n; // sellout-only, like pump.fun
  const factoryOf = c => new ethers.ContractFactory(c.abi, c.bytecode, state.signer);
  try {
    btn.disabled = true;
    $('setupMsg').textContent = 'Checking network…';
    await ensureNetwork();
    const bal = await state.reader?.getBalance?.(state.account).catch(() => 1n) ?? 1n;

    const step = (t) => { btn.textContent = t; $('setupMsg').textContent = t + ' — approve in your wallet.'; };
    step('Deploying name registry…');
    const reg = await factoryOf(B.MockRegistrar).deploy(); await reg.waitForDeployment();
    step('Deploying pool handler…');
    const esc = await factoryOf(B.GraduationEscrow).deploy(); await esc.waitForDeployment();
    step('Deploying launchpad…');
    const fac = await factoryOf(B.TokenFactory).deploy(
      state.account, await reg.getAddress(), await esc.getAddress(), 0n, 0n, virtualEth0, graduationEth, false, 0n);
    await fac.waitForDeployment();
    const curveAddr = await fac.curve();
    step('Deploying comments…');
    const board = await factoryOf(B.CommentBoard).deploy(15n); await board.waitForDeployment();

    const dep = {
      chainId: CHAIN.id, rpc: CHAIN.rpc,
      registrar: await reg.getAddress(), escrow: await esc.getAddress(),
      factory: await fac.getAddress(), curve: curveAddr, commentBoard: await board.getAddress(),
      feeBps: 0, platformFeeWei: '0', virtualEth0Wei: virtualEth0.toString(), enforceVanity: false,
    };
    localStorage.setItem('garlic_deployment', JSON.stringify(dep));
    state.deployment = dep;
    void bal;
    toast('🧄 garlic.hood is live — deployed from your wallet!', 'ok');
    startApp();
  } catch (e) {
    $('setupMsg').innerHTML = `<span class="bad">${rpcError(e)}</span>`;
    btn.disabled = false; btn.textContent = 'Deploy garlic.hood';
  }
}

function wireReadContracts() {
  const d = state.deployment, r = state.reader;
  state.readContracts = {
    factory: new ethers.Contract(d.factory, ABI.factory, r),
    curve: new ethers.Contract(d.curve, ABI.curve, r),
    registrar: new ethers.Contract(d.registrar, ABI.registrar, r),
    board: new ethers.Contract(d.commentBoard, ABI.board, r),
  };
}

// ---------- EIP-6963 multi-wallet discovery ----------
function discoverWallets() {
  const seen = new Map();
  window.addEventListener('eip6963:announceProvider', ev => {
    const { info, provider } = ev.detail;
    if (!seen.has(info.uuid)) {
      seen.set(info.uuid, true);
      state.wallets.push({ info, provider });
      renderWalletList();
    }
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  // Fallback: a lone injected provider that predates EIP-6963.
  setTimeout(() => {
    if (state.wallets.length === 0 && window.ethereum) {
      state.wallets.push({ info: { name: window.ethereum.isMetaMask ? 'MetaMask' : 'Injected wallet', uuid: 'injected', icon: '' }, provider: window.ethereum });
      renderWalletList();
    }
  }, 350);
}

function renderWalletList() {
  const box = $('walletList');
  box.innerHTML = '';
  if (state.wallets.length === 0) {
    box.innerHTML = '<p class="muted">No wallet detected. Install MetaMask, Phantom, Coinbase Wallet, or the Robinhood Wallet extension, then reload. (Mobile Robinhood Wallet: open this page in its in-app browser.)</p>';
    return;
  }
  for (const w of state.wallets) {
    const b = document.createElement('button');
    b.className = 'wallet';
    b.innerHTML = (w.info.icon ? `<img src="${w.info.icon}" alt="" width="22" height="22">` : '<span class="wdot"></span>') + `<span>${w.info.name}</span>`;
    b.onclick = () => connect(w);
    box.appendChild(b);
  }
}

// ---------- connect + SIWE sign-in ----------
async function connect(wallet) {
  try {
    state.walletProvider = wallet.provider;
    state.provider = new ethers.BrowserProvider(wallet.provider);
    const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' });
    state.account = ethers.getAddress(accounts[0]);
    state.signer = await state.provider.getSigner();
    const net = await state.provider.getNetwork();
    state.chainId = Number(net.chainId);
    wallet.provider.on?.('accountsChanged', () => location.reload());
    wallet.provider.on?.('chainChanged', () => location.reload());
    if (state.readContracts) await loadIdentity();
    closeModal();
    renderAccount();
    if (document.body.classList.contains('needsetup')) { onSetupConnected(); return; }
    if (state.deployment) {
      // move reads onto the wallet's provider now that we have one
      state.reader = state.provider;
      wireReadContracts();
      refreshFeed(); refreshLeaderboard();
      if (state.chainId !== state.deployment.chainId) {
        toast(`Wrong network. Switch your wallet to chain ${state.deployment.chainId} (Robinhood Chain).`, 'warn');
      }
    }
  } catch (e) {
    toast(rpcError(e), 'bad');
  }
}

async function signIn() {
  if (!state.account) return;
  try {
    const domain = location.host || 'garlic.hood';
    const nonce = Math.random().toString(36).slice(2, 10);
    const issued = new Date().toISOString();
    // SIWE-style message (EIP-4361 shape). Proves wallet control; no gas.
    const message =
      `${domain} wants you to sign in with your Ethereum account:\n${state.account}\n\n` +
      `Sign in to garlic.hood. This is off-chain and free — it does not authorize any transaction.\n\n` +
      `URI: ${location.origin}\nVersion: 1\nChain ID: ${state.deployment.chainId}\n` +
      `Nonce: ${nonce}\nIssued At: ${issued}`;
    const sig = await state.signer.signMessage(message);
    // Verify locally: recovered address must match the signer.
    const recovered = ethers.verifyMessage(message, sig);
    if (ethers.getAddress(recovered) !== state.account) throw new Error('signature mismatch');
    state.siwe = true;
    wireWriteContracts();
    renderAccount();
    toast(`Signed in${state.identity ? ' as ' + state.identity + '.hood' : ''}.`, 'ok');
  } catch (e) {
    toast(rpcError(e), 'bad');
  }
}

function wireWriteContracts() {
  const d = state.deployment, s = state.signer;
  state.contracts = {
    factory: new ethers.Contract(d.factory, ABI.factory, s),
    curve: new ethers.Contract(d.curve, ABI.curve, s),
    registrar: new ethers.Contract(d.registrar, ABI.registrar, s),
    board: new ethers.Contract(d.commentBoard, ABI.board, s),
  };
}

async function loadIdentity() {
  try { state.identity = (await state.readContracts.registrar.nameOf(state.account)) || null; }
  catch { state.identity = null; }
}

// ---------- name search ----------
async function searchName() {
  const label = normalizeLabel($('searchInput').value);
  const out = $('searchResult');
  if (label.length < 3) { out.innerHTML = '<span class="muted">Enter at least 3 characters.</span>'; return; }
  out.innerHTML = '<span class="muted">checking…</span>';
  try {
    const reg = state.readContracts.registrar;
    const available = await reg.available(label);
    if (available) {
      const cost = await state.readContracts.factory.launchCost(label);
      const warn = window.GARLIC.similarityWarning(label, state.labels || []);
      const score = window.GARLIC.garlicScore(label, state.labels || []);
      out.innerHTML =
        `<div class="resline"><b class="ok">${label}.hood</b> is available ${garlicBadge(score)}</div>` +
        (warn ? `<div class="simwarn ${warn.level}">🧛 ${warn.text}</div>` : '') +
        `<div class="muted">Launch registers it for 1 year (${fmt(cost, 5)} ETH incl. fees) and opens the bonding curve.</div>`;
      showLaunchForm(label, cost);
    } else {
      const token = await reg.resolve(label).catch(() => ethers.ZeroAddress);
      const expiry = await reg.expiryOf(label);
      const when = new Date(Number(expiry) * 1000).toISOString().slice(0, 10);
      out.innerHTML =
        `<div class="resline"><b class="bad">${label}.hood</b> is taken</div>` +
        `<div class="muted">Registered until ${when}${token !== ethers.ZeroAddress ? ` · resolves to <span class="mono">${short(token)}</span>` : ''}. It frees up for relaunch only if it expires un-graduated.</div>` +
        (token !== ethers.ZeroAddress ? `<button class="outline" id="tradeExisting" style="margin-top:.7rem;">Trade ${label}.hood</button>` : '');
      hideLaunchForm();
      if (token !== ethers.ZeroAddress) $('tradeExisting').onclick = () => openToken(token, label);
    }
  } catch (e) { out.innerHTML = `<span class="bad">${rpcError(e)}</span>`; }
}

// ---------- launch ----------
function showLaunchForm(label, cost) {
  $('launchForm').classList.add('show');
  $('launchForm').dataset.label = label;
  $('launchForm').dataset.cost = cost.toString();
  $('launchLabel').textContent = label + '.hood';
  $('launchName').value = label.charAt(0).toUpperCase() + label.slice(1);
  $('launchSymbol').value = label.slice(0, 6).toUpperCase();
  gate($('doLaunch'));
}
function hideLaunchForm() { $('launchForm').classList.remove('show'); }

async function doLaunch() {
  if (!requireSignIn()) return;
  const label = $('launchForm').dataset.label;
  const cost = BigInt($('launchForm').dataset.cost);
  const name = $('launchName').value.trim() || label;
  const symbol = ($('launchSymbol').value.trim() || label).toUpperCase().slice(0, 8);
  const btn = $('doLaunch');
  try {
    btn.disabled = true; btn.textContent = 'grinding vanity address…';
    const enforce = await state.readContracts.factory.enforceVanity();
    let salt = ethers.ZeroHash, secret = ethers.ZeroHash;
    if (enforce) salt = await grindSalt(name, symbol, label);

    // Optional launch commit-reveal (front-run protection). Off when commitAge=0.
    const commitAge = await state.readContracts.factory.commitAge();
    if (commitAge > 0n) {
      secret = ethers.hexlify(ethers.randomBytes(32));
      const commitment = ethers.solidityPackedKeccak256(['string', 'address', 'bytes32'], [label, state.account, secret]);
      btn.textContent = 'committing…';
      await (await state.contracts.factory.commitName(commitment)).wait();
      btn.textContent = `waiting ${commitAge}s (anti-frontrun)…`;
      await sleep((Number(commitAge) + 1) * 1000);
    }
    btn.textContent = 'launching…';
    const tx = await state.contracts.factory.launch(name, symbol, label, salt, secret, { value: cost });
    const rc = await tx.wait();
    const ev = rc.logs.map(l => { try { return state.contracts.factory.interface.parseLog(l); } catch { return null; } }).find(e => e && e.name === 'Launched');
    const token = ev.args.token;
    toast(`${label}.hood launched!`, 'ok');
    hideLaunchForm();
    openToken(token, label);
    refreshFeed(); refreshLeaderboard();
  } catch (e) {
    toast(rpcError(e), 'bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Register & Launch';
  }
}

// Grind a CREATE2 salt so the token address ends in 600d (see contracts).
async function grindSalt(name, symbol, label) {
  const factory = state.deployment.factory;
  const curve = state.deployment.curve;
  const initCode = ethers.concat([
    LAUNCHTOKEN_INITCODE,
    ethers.AbiCoder.defaultAbiCoder().encode(['string', 'string', 'string', 'address'], [name, symbol, label, curve]),
  ]);
  const initHash = ethers.keccak256(initCode);
  for (let i = 0; ; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const addr = ethers.getCreate2Address(factory, salt, initHash);
    if (addr.toLowerCase().endsWith('600d')) return salt;
    if (i % 20000 === 0) await sleep(0); // yield so the UI doesn't freeze
  }
}

// ---------- trade ----------
async function openToken(token, label) {
  state.current = { token, label };
  $('tradePanel').classList.add('show');
  $('tradeTitle').textContent = label + '.hood';
  await refreshCurve();
  await loadComments(token);
  gate($('buyBtn')); gate($('sellBtn')); gate($('postBtn'));
}

async function refreshCurve() {
  const { token } = state.current;
  const c = await state.readContracts.curve.curves(token);
  const CURVE_SUPPLY = 793100000n * 10n ** 18n;
  const price = Number(c.virtualEth) / Number(c.virtualToken) * 1e9;
  const pct = Number(c.tokensSold * 10000n / CURVE_SUPPLY) / 100;
  $('curveStats').innerHTML =
    stat('Price', price.toFixed(3) + ' gwei') +
    stat('Raised', fmt(c.realEth, 3) + ' ETH') +
    stat('Sold', pct.toFixed(1) + '%') +
    stat('Status', c.graduated ? '🎓 graduated' : 'bonding');
  $('gradbarFill').style.width = Math.min(100, pct) + '%';
  const disabled = c.graduated;
  $('buyBtn').classList.toggle('off', disabled);
  $('sellBtn').classList.toggle('off', disabled);
  // graduation ceremony — fire once when a token crosses the line
  if (c.graduated && state.current && !state.current._celebrated) {
    state.current._celebrated = true;
    toast('☀️ Survived Sunrise — 🧄 garlic protected another project · 🔥 LP burned forever · 🛡 name renewed +5 years', 'ok');
  }
  if (state.account) {
    const t = new ethers.Contract(token, ABI.token, state.reader);
    const bag = await t.balanceOf(state.account);
    $('yourBag').textContent = 'Your bag: ' + Number(ethers.formatEther(bag)).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
}

function slippageBps() {
  const v = parseFloat($('slippage').value) || 1;
  // Anti-sandwich guardrail: warn hard when a user loosens slippage, because
  // wide slippage is exactly what lets a sandwich bot profit.
  $('slipWarn').textContent = v > 3 ? `⚠ ${v}% is loose — sandwich bots can extract up to ~${v}% of your trade. 0.5–1% is safe.` : '';
  return Math.round(v * 100);
}

async function buy() {
  if (!requireSignIn()) return;
  const { token } = state.current;
  const amount = ethers.parseEther($('buyAmt').value || '0');
  if (amount <= 0n) return;
  const btn = $('buyBtn');
  try {
    btn.disabled = true;
    const quoted = await state.readContracts.curve.quoteBuy(token, amount);
    const minOut = quoted * BigInt(10000 - slippageBps()) / 10000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 120); // 2-min window
    await (await state.contracts.curve.buy(token, minOut, deadline, { value: amount })).wait();
    toast('Bought.', 'ok');
    await refreshCurve(); await loadComments(token); refreshLeaderboard();
  } catch (e) { toast(rpcError(e), 'bad'); }
  finally { btn.disabled = false; }
}

async function sell() {
  if (!requireSignIn()) return;
  const { token } = state.current;
  const t = new ethers.Contract(token, ABI.token, state.signer);
  const bag = await t.balanceOf(state.account);
  if (bag <= 0n) { toast('Nothing to sell.', 'warn'); return; }
  const btn = $('sellBtn');
  try {
    btn.disabled = true;
    const allowance = await t.allowance(state.account, state.deployment.curve);
    if (allowance < bag) { btn.textContent = 'approving…'; await (await t.approve(state.deployment.curve, ethers.MaxUint256)).wait(); }
    btn.textContent = 'selling…';
    const quoted = await state.readContracts.curve.quoteSell(token, bag);
    const minEth = quoted * BigInt(10000 - slippageBps()) / 10000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
    await (await state.contracts.curve.sell(token, bag, minEth, deadline)).wait();
    toast('Sold.', 'ok');
    await refreshCurve(); await loadComments(token); refreshLeaderboard();
  } catch (e) { toast(rpcError(e), 'bad'); }
  finally { btn.disabled = false; btn.textContent = 'Sell all'; }
}

// ---------- comments (event-only social feed) ----------
async function loadComments(token) {
  const box = $('comments');
  box.innerHTML = '<span class="muted">loading…</span>';
  try {
    const board = state.readContracts.board;
    const logs = await board.queryFilter(board.filters.Comment(token), 0, 'latest');
    if (logs.length === 0) { box.innerHTML = '<span class="muted">No comments yet. Be the first.</span>'; return; }
    const rows = await Promise.all(logs.slice(-50).reverse().map(async l => {
      const who = await identityFor(l.args.author);
      const when = new Date(Number(l.args.timestamp) * 1000).toLocaleString();
      return `<div class="cmt"><div class="cmt-head"><b>${who}</b><span class="when">${when}</span></div><div>${escapeHtml(l.args.text)}</div></div>`;
    }));
    box.innerHTML = rows.join('');
  } catch (e) { box.innerHTML = `<span class="bad">${rpcError(e)}</span>`; }
}

const identityCache = new Map();
async function identityFor(addr) {
  const key = addr.toLowerCase();
  if (identityCache.has(key)) return identityCache.get(key);
  let label = '';
  try { label = await state.readContracts.registrar.nameOf(addr); } catch {}
  const shown = label ? label + '.hood' : short(addr);
  identityCache.set(key, shown);
  return shown;
}

async function postComment() {
  if (!requireSignIn()) return;
  const text = $('commentInput').value.trim();
  if (!text) return;
  const btn = $('postBtn');
  try {
    btn.disabled = true;
    await (await state.contracts.board.post(state.current.token, text)).wait();
    $('commentInput').value = '';
    await loadComments(state.current.token);
  } catch (e) { toast(rpcError(e), 'bad'); }
  finally { btn.disabled = false; }
}

// ---------- global recent-launches feed ----------
async function refreshFeed() {
  const box = $('recentFeed');
  try {
    const f = state.readContracts.factory;
    const logs = await f.queryFilter(f.filters.Launched(), 0, 'latest');
    if (logs.length === 0) { box.innerHTML = '<span class="muted">No tokens launched yet. Search a name above to be first.</span>'; return; }
    box.innerHTML = logs.slice(-12).reverse().map(l =>
      `<button class="feedrow" data-token="${l.args.token}" data-label="${l.args.label}">` +
      `<span class="fl"><span class="tick">🧄</span><span><b>${escapeHtml(l.args.label)}.hood</b><div class="sub">${escapeHtml(l.args.name)} · ${escapeHtml(l.args.symbol)}</div></span></span>` +
      `<span class="up" style="font-weight:600;">Trade →</span></button>`).join('');
    box.querySelectorAll('.feedrow').forEach(el => el.onclick = () => openToken(el.dataset.token, el.dataset.label));
  } catch (e) { box.innerHTML = `<span class="muted">Feed unavailable: ${rpcError(e)}</span>`; }
}

// ---------- top-10 leaderboard (mcap / unique buyers / garlic score / age) ----------
// Ranked on metrics a whale can't fake alone. Raw volume is deliberately NOT a
// sort — it's trivially wash-traded (a reviewer's note); unique buyers and the
// originality-based Garlic Score are far harder to game.
let lbSort = 'mcap';
const FDV_TOKENS = 1_000_000_000; // fully-diluted supply
state.labels = []; // all launched labels, for similarity / Garlic Score
async function refreshLeaderboard() {
  const box = $('leaderboard');
  try {
    const f = state.readContracts.factory, curve = state.readContracts.curve, reader = state.reader;
    const launched = await f.queryFilter(f.filters.Launched(), 0, 'latest');
    if (launched.length === 0) { box.innerHTML = '<span class="muted">No tokens yet — launch one to top the board.</span>'; return; }

    const byLabel = new Map(); // current token per label (relaunches overwrite)
    for (const l of launched) byLabel.set(l.args.label, { token: l.args.token, label: l.args.label, name: l.args.name, symbol: l.args.symbol, block: l.blockNumber });
    const meta = [...byLabel.values()];
    state.labels = meta.map(m => m.label);

    const now = Math.floor(Date.now() / 1000);
    const tcache = new Map();
    const tsOf = async bn => { if (!tcache.has(bn)) { const b = await reader.getBlock(bn); tcache.set(bn, b ? Number(b.timestamp) : now); } return tcache.get(bn); };

    // unique buyers per token (anti-wash: distinct addresses, not raw volume)
    const buys = await curve.queryFilter(curve.filters.Buy(), 0, 'latest');
    const buyers = new Map();
    for (const ev of buys) {
      if (!buyers.has(ev.args.token)) buyers.set(ev.args.token, new Set());
      buyers.get(ev.args.token).add(ev.args.buyer.toLowerCase());
    }

    const rows = [];
    for (const m of meta) {
      let mcap = 0, graduated = false;
      try { const c = await curve.curves(m.token); mcap = Number(c.virtualEth) / Number(c.virtualToken) * FDV_TOKENS; graduated = c.graduated; } catch {}
      rows.push({ ...m, mcap, buyers: (buyers.get(m.token) || new Set()).size, ageSec: now - (await tsOf(m.block)), graduated,
        garlic: window.GARLIC.garlicScore(m.label, state.labels) });
    }
    const cmp = {
      mcap: (a, b) => b.mcap - a.mcap,
      buyers: (a, b) => b.buyers - a.buyers || b.mcap - a.mcap,
      garlic: (a, b) => b.garlic - a.garlic || b.mcap - a.mcap,
      age: (a, b) => a.ageSec - b.ageSec,
    }[lbSort];
    rows.sort(cmp);

    box.innerHTML = rows.slice(0, 10).map((r, i) =>
      `<button class="lbrow" data-token="${r.token}" data-label="${escapeHtml(r.label)}">` +
      `<span class="rank">${i + 1}</span>` +
      `<span class="lbname"><b>${escapeHtml(r.label)}.hood ${garlicBadge(r.garlic)}</b><span class="sub">${escapeHtml(r.symbol)}${r.graduated ? ' · 🎓' : ''}</span></span>` +
      `<span class="lbnum">${r.mcap.toFixed(2)} <span class="dim">ETH mcap</span></span>` +
      `<span class="lbnum">${r.buyers} <span class="dim">buyers</span></span>` +
      `<span class="lbnum">${fmtAge(r.ageSec)}</span></button>`).join('');
    box.querySelectorAll('.lbrow').forEach(el => el.onclick = () => openToken(el.dataset.token, el.dataset.label));
  } catch (e) { box.innerHTML = `<span class="muted">Leaderboard unavailable: ${rpcError(e)}</span>`; }
}
function garlicBadge(score) {
  const cls = score >= 90 ? 'g-hi' : score >= 60 ? 'g-mid' : 'g-lo';
  return `<span class="gscore ${cls}" title="Garlic Score — originality (100 = unique)">🧄 ${score}</span>`;
}
function fmtAge(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  return Math.floor(s / 86400) + 'd';
}

// ---------- self-register a name to sign in with ----------
async function registerSelfName() {
  if (!requireSignIn()) return;
  const label = normalizeLabel($('identInput').value);
  if (label.length < 3) { toast('At least 3 characters.', 'warn'); return; }
  const btn = $('identBtn');
  try {
    btn.disabled = true;
    if (!(await state.readContracts.registrar.available(label))) { toast(`${label}.hood is taken.`, 'bad'); return; }
    const price = await state.readContracts.registrar.priceOf(label, 1n);
    await (await state.contracts.registrar.registerSelf(label, 1n, { value: price })).wait();
    state.identity = label;
    renderAccount();
    toast(`You are now ${label}.hood`, 'ok');
  } catch (e) { toast(rpcError(e), 'bad'); }
  finally { btn.disabled = false; }
}

// ---------- UI helpers ----------
function bindUI() {
  $('connectBtn').onclick = openModal;
  $('modalClose').onclick = closeModal;
  $('signInBtn').onclick = signIn;
  $('searchBtn').onclick = searchName;
  $('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') searchName(); });
  $('doLaunch').onclick = doLaunch;
  $('buyBtn').onclick = buy;
  $('sellBtn').onclick = sell;
  $('postBtn').onclick = postComment;
  $('slippage').addEventListener('input', slippageBps);
  $('identBtn').onclick = registerSelfName;
  document.querySelectorAll('.lbtab').forEach(t => t.onclick = () => {
    lbSort = t.dataset.sort;
    document.querySelectorAll('.lbtab').forEach(x => x.classList.toggle('active', x === t));
    refreshLeaderboard();
  });
}
function gate(btn) { btn.classList.toggle('needsauth', !state.siwe); }
function requireSignIn() {
  if (state.siwe) return true;
  if (!state.account) { openModal(); toast('Connect a wallet first.', 'warn'); }
  else { toast('Sign in (free signature) to interact.', 'warn'); }
  return false;
}
function renderAccount() {
  const el = $('accountBox');
  if (!state.account) { $('connectBtn').textContent = 'Connect wallet'; return; }
  const who = state.identity ? state.identity + '.hood' : short(state.account);
  $('connectBtn').textContent = who;
  el.innerHTML = state.siwe
    ? `<span class="chip ok">signed in</span> <span class="mono">${who}</span>`
    : `<span class="chip warn">connected — not signed in</span> <button id="signInBtn2" class="mini">Sign in</button>`;
  if (!state.siwe) $('signInBtn2').onclick = signIn;
  $('identCard').classList.toggle('show', state.siwe && !state.identity);
  document.querySelectorAll('.needsauth').forEach(b => b.classList.toggle('needsauth', !state.siwe));
}
function renderChainInfo() {
  const d = state.deployment;
  $('chainInfo').innerHTML = `chain ${d.chainId} · fees ${d.feeBps === 0 ? 'OFF (test)' : (d.feeBps / 100) + '%'} · ${d.enforceVanity ? '…600d addresses' : 'plain addresses'}`;
}
function stat(k, v) { return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`; }
function normalizeLabel(s) { return (s || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, ''); }
function short(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function openModal() { $('walletModal').classList.add('show'); }
function closeModal() { $('walletModal').classList.remove('show'); }
function toast(msg, kind) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast show ' + (kind || '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast', 4200);
}
function rpcError(e) {
  const m = e?.shortMessage || e?.info?.error?.message || e?.reason || e?.message || String(e);
  if (/user rejected/i.test(m)) return 'Rejected in wallet.';
  if (/insufficient funds/i.test(m)) return 'Insufficient ETH for this transaction.';
  return m.replace(/\s*\(action=.*$/, '').slice(0, 160);
}

// LaunchToken creation bytecode — filled from build/ at serve time via a fetch.
let LAUNCHTOKEN_INITCODE = '0x';
fetch('launchtoken.initcode.txt').then(r => r.ok ? r.text() : '0x').then(t => LAUNCHTOKEN_INITCODE = t.trim()).catch(() => {});

boot();
