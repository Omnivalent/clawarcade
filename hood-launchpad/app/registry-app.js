/* garlic.hood registry — the .hood identity layer, wallet-connected.
 * Talks to the deployed GarlicRegistry from app/registry.json:
 *   registerSelf + attachToken to claim a name and bind it to a coin,
 *   nameForToken / tokenForName to resolve, NameRegistered events for the corpus.
 * Config sources, in order: ?registry=&rpc=&chainId= URL params → registry.json.
 */
const $ = id => document.getElementById(id);
const norm = s => (s || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
const esc = s => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = a => a.slice(0, 6) + '…' + a.slice(-4);
const ZERO = '0x0000000000000000000000000000000000000000';

const state = {
  cfg: null,            // {chainId, rpc, explorer, registry}
  reader: null,         // JsonRpcProvider read contract
  read: null,           // ethers.Contract (read)
  provider: null,       // BrowserProvider (wallet)
  signer: null,
  account: null,
  chainId: null,
  corpus: [],           // known labels for Garlic Score / similarity
};

function toast(m, k) {
  const t = $('toast'); t.textContent = m; t.className = 'toast show ' + (k || '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast', 3800);
}
function garlicBadge(score) {
  const cls = score >= 90 ? 'g-hi' : score >= 60 ? 'g-mid' : 'g-lo';
  return `<span class="gscore ${cls}">🧄 ${score}</span>`;
}
function rpcError(e) {
  const m = e?.shortMessage || e?.info?.error?.message || e?.reason || e?.message || String(e);
  if (/user rejected/i.test(m)) return 'Rejected in wallet.';
  if (/insufficient funds/i.test(m)) return 'Insufficient ETH for gas/registration.';
  return m.replace(/\s*\(action=.*$/, '').slice(0, 160);
}

// ---------- boot ----------
async function boot() {
  const cfg = await loadConfig();
  if (!cfg) {
    $('netChip').textContent = 'not deployed';
    $('stateBanner').innerHTML =
      `<div class="banner warn"><b>Registry not deployed yet.</b> This page goes live the moment you deploy the one contract:<br>` +
      `<code>PRIVATE_KEY=0x… node scripts/deploy-registry.js</code> (testnet) — it writes <code>app/registry.json</code> next to this page.<br>` +
      `Or point this page at an address now: <code>?registry=0x…&rpc=https://…&chainId=46630</code></div>`;
    $('connectBtn').disabled = true;
    return;
  }
  state.cfg = cfg;
  state.reader = new ethers.JsonRpcProvider(cfg.rpc);
  state.read = new ethers.Contract(cfg.registry, window.HOODPAD_ABI.registrar, state.reader);
  const isMain = Number(cfg.chainId) === 4663;
  $('netChip').className = 'netchip live';
  $('netChip').textContent = `${isMain ? 'MAINNET' : 'testnet'} · ${short(cfg.registry)}`;
  $('footAddr').innerHTML = `registry <a href="${cfg.explorer}/address/${cfg.registry}" target="_blank" rel="noopener">${cfg.registry}</a> · chain ${cfg.chainId}`;
  if (!isMain) {
    $('stateBanner').innerHTML = `<div class="banner info">Live on <b>Robinhood Chain testnet</b> — free to try. <a href="https://faucet.testnet.chain.robinhood.com" target="_blank" rel="noopener" style="color:var(--green)">Get test ETH →</a></div>`;
  }
  await loadCorpus();
  await renderDirectory();
}

async function loadConfig() {
  const q = new URLSearchParams(location.search);
  if (q.get('registry') && q.get('rpc')) {
    return { registry: q.get('registry'), rpc: q.get('rpc'), chainId: Number(q.get('chainId') || 46630),
             explorer: q.get('explorer') || 'https://explorer.testnet.chain.robinhood.com' };
  }
  try { const r = await fetch('registry.json'); if (r.ok) return await r.json(); } catch {}
  return null;
}

// Build the known-names corpus from NameRegistered events (for Garlic Score).
async function loadCorpus() {
  try {
    const ev = await state.read.queryFilter('NameRegistered', 0, 'latest');
    const set = new Set();
    for (const e of ev) { const l = e.args?.label; if (l) set.add(String(l)); }
    state.corpus = [...set];
  } catch { state.corpus = []; } // some RPCs cap getLogs — degrade to no-corpus
}

// ---------- wallet ----------
$('connectBtn').onclick = connect;
async function connect() {
  const eth = pickProvider();
  if (!eth) { toast('No wallet found. Install MetaMask, Phantom, or Coinbase Wallet.', 'warn'); return; }
  try {
    state.provider = new ethers.BrowserProvider(eth);
    await state.provider.send('eth_requestAccounts', []);
    await ensureNetwork(eth);
    state.signer = await state.provider.getSigner();
    state.account = (await state.signer.getAddress());
    const net = await state.provider.getNetwork();
    state.chainId = Number(net.chainId);
    $('connectBtn').textContent = short(state.account);
    toast('Wallet connected.', 'ok');
  } catch (e) { toast(rpcError(e), 'bad'); }
}
function pickProvider() {
  // minimal EIP-6963 + fallback
  if (window.ethereum) return window.ethereum;
  return null;
}
async function ensureNetwork(eth) {
  const want = '0x' + Number(state.cfg.chainId).toString(16);
  try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] }); }
  catch (e) {
    if (e && e.code === 4902) {
      const isMain = Number(state.cfg.chainId) === 4663;
      await eth.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: want,
        chainName: isMain ? 'Robinhood Chain' : 'Robinhood Chain Testnet',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [state.cfg.rpc],
        blockExplorerUrls: [state.cfg.explorer],
      }] });
    } else throw e;
  }
}

// ---------- claim + attach ----------
$('searchBtn').onclick = check;
$('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
async function check() {
  const label = norm($('searchInput').value);
  const out = $('searchResult'); $('attachForm').classList.remove('show');
  if (label.length < 3) { out.innerHTML = '<span class="muted">Enter at least 3 characters (a–z, 0–9, hyphen).</span>'; return; }
  if (label.length > 32) { out.innerHTML = '<span class="warn">Too long — 32 characters max.</span>'; return; }
  out.innerHTML = '<span class="muted">Checking on-chain…</span>';
  try {
    const [avail, priceWei] = await Promise.all([
      state.read.available(label),
      state.read.priceOf(label, 1).catch(() => null),
    ]);
    const others = state.corpus;
    const score = window.GARLIC.garlicScore(label, others);
    if (!avail) {
      const coin = await state.read.tokenForName(label).catch(() => ZERO);
      out.innerHTML = `<div class="resline"><span class="down">${esc(label)}.hood</span> is taken ${garlicBadge(score)}</div>` +
        (coin && coin !== ZERO
          ? `<div class="muted">Canonical identity of <span class="num">${esc(coin)}</span> · 🧄 verified original.</div>`
          : `<div class="muted">Registered, no coin attached yet.</div>`);
      return;
    }
    const warn = window.GARLIC.similarityWarning(label, others);
    const price = priceWei != null ? ethers.formatEther(priceWei) : '—';
    out.innerHTML = `<div class="resline"><span class="up">${esc(label)}.hood</span> is available ${garlicBadge(score)}</div>` +
      (warn ? `<div class="simwarn ${warn.level}">🧛 ${esc(warn.text)}</div>` : '') +
      `<div class="muted">${price} ETH / year. Claim it and point it at any coin — even one launched elsewhere.</div>`;
    $('attachForm').classList.add('show'); $('attachForm').dataset.label = label;
  } catch (e) { out.innerHTML = `<span class="bad">${esc(rpcError(e))}</span>`; }
}

$('attachBtn').onclick = attach;
async function attach() {
  if (!state.signer) { toast('Connect a wallet first.', 'warn'); return; }
  if (state.chainId !== Number(state.cfg.chainId)) { toast(`Switch your wallet to chain ${state.cfg.chainId}.`, 'warn'); return; }
  const label = $('attachForm').dataset.label;
  const coin = $('addrInput').value.trim();
  if (!ethers.isAddress(coin)) { toast('Paste a valid coin address (0x…40 hex).', 'warn'); return; }
  const btn = $('attachBtn');
  const w = state.read.connect(state.signer);
  try {
    btn.disabled = true;
    // 1) register the name to the connected wallet (as its primary handle)
    const price = await state.read.priceOf(label, 1);
    btn.textContent = 'Registering name…';
    await (await w.registerSelf(label, 1, { value: price })).wait();
    // 2) bind the name to the coin — one name ↔ one coin, enforced on-chain
    btn.textContent = 'Attaching to coin…';
    await (await w.attachToken(label, coin)).wait();
    toast(`🧄 ${label}.hood attached to ${short(coin)}`, 'ok');
    $('searchResult').innerHTML = `<span class="ok">✓ ${esc(label)}.hood now resolves to ${esc(coin)} — the one true ${esc(label)}. No copycat can take the name.</span>`;
    $('attachForm').classList.remove('show'); $('searchInput').value = '';
    if (!state.corpus.includes(label)) state.corpus.push(label);
    await renderDirectory();
  } catch (e) {
    toast(rpcError(e), 'bad');
  } finally { btn.disabled = false; btn.textContent = 'Register & attach'; }
}

// ---------- resolve both ways ----------
$('lookupBtn').onclick = resolve;
$('lookupInput').addEventListener('keydown', e => { if (e.key === 'Enter') resolve(); });
async function resolve() {
  const q = $('lookupInput').value.trim(); const out = $('lookupResult');
  if (!q) { out.innerHTML = ''; return; }
  out.innerHTML = '<span class="muted">Resolving…</span>';
  try {
    if (q.startsWith('0x') && ethers.isAddress(q)) {
      const name = await state.read.nameForToken(q);
      out.innerHTML = name ? record(name, q) : '<span class="muted">No .hood name attached to that coin (yet).</span>';
    } else {
      const label = norm(q.replace(/\.hood$/, ''));
      const avail = await state.read.available(label);
      if (avail) { out.innerHTML = `<span class="muted">${esc(label)}.hood is unregistered — available to claim above.</span>`; return; }
      const coin = await state.read.tokenForName(label).catch(() => ZERO);
      out.innerHTML = record(label, coin && coin !== ZERO ? coin : null);
    }
  } catch (e) { out.innerHTML = `<span class="bad">${esc(rpcError(e))}</span>`; }
}
function record(label, coin) {
  const score = window.GARLIC.garlicScore(label, state.corpus);
  return `<div class="recordcard">` +
    `<div class="row"><span class="k">Name</span><span class="v up">${esc(label)}.hood ${garlicBadge(score)}</span></div>` +
    `<div class="row"><span class="k">Coin</span><span class="v">${coin ? esc(coin) : '<span class="dim">none attached</span>'}</span></div>` +
    (coin ? `<div class="row"><span class="k">Status</span><span class="v"><span class="badge">🧄 verified original</span></span></div>` : '') +
  `</div>`;
}

// ---------- directory (from chain events) ----------
async function renderDirectory() {
  const box = $('directory');
  try {
    const ev = await state.read.queryFilter('TokenAttached', 0, 'latest');
    if (!ev.length) { box.innerHTML = '<span class="muted">No names attached to coins yet — be the first above.</span>'; return; }
    // last unique labels first
    const seen = new Set(); const rows = [];
    for (let i = ev.length - 1; i >= 0 && rows.length < 12; i--) {
      const label = String(ev[i].args?.label || ''); const coin = ev[i].args?.token;
      if (!label || seen.has(label)) continue; seen.add(label);
      rows.push({ label, coin });
    }
    // confirm each is still the live binding
    const checked = await Promise.all(rows.map(async r => {
      try { const cur = await state.read.tokenForName(r.label); return (cur && cur.toLowerCase() === String(r.coin).toLowerCase()) ? r : null; }
      catch { return r; }
    }));
    const live = checked.filter(Boolean);
    box.innerHTML = live.length ? live.map(r =>
      `<div class="dirrow"><span class="tick">🧄</span><span><b>${esc(r.label)}.hood</b> ${garlicBadge(window.GARLIC.garlicScore(r.label, state.corpus))}<div class="sub">${esc(r.coin)}</div></span><span class="badge">original</span></div>`
    ).join('') : '<span class="muted">No live bindings yet.</span>';
  } catch {
    box.innerHTML = '<span class="muted">Directory needs an events-capable RPC; attach a name above to test the write path.</span>';
  }
}

boot();
