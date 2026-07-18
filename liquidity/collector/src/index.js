/**
 * Liquidity Lakes — collector Worker  (v2)
 *
 * Fetches every source SERVER-SIDE (no browser CORS), normalizes a hierarchical
 * snapshot (chains -> platforms -> tokens) plus a MULTI-BRIDGE corridor set, and
 * serves it to the front-end over a CORS-open JSON API. Records a rolling
 * history ring for the time machine.
 *
 * Honesty principles (matching the front-end):
 *  - Never fabricate. An adapter that can't get data returns nothing and its
 *    health goes 'down'; the front-end dims/hides that river.
 *  - Each bridge is its own adapter with its own coverage flag. Bridges are
 *    NEVER summed into a single generic "bridge volume" — LayerZero generic
 *    messages are not value, aggregator routes are not their settlement rails.
 *  - Directional corridors are stored as [fromChain, toChain, usd]; the two
 *    directions are separate entries (the UI draws two lanes).
 *  - History starts the day this collector is deployed. Nothing is backfilled.
 *
 * Free-tier storage: ONE KV key ('state'), ONE write per cron run. With a
 * 2-minute cron that's 720 writes/day, under KV's free 1,000/day. (On the $5
 * Workers Paid plan you can drop the cron to 1 minute — see wrangler.toml.)
 *
 * Endpoints:
 *   GET /api/snapshot            current normalized state
 *   GET /api/history?window=1h   compact frames within the window
 *   GET /api/health              per-source + per-bridge health, coverage, freshness
 *   GET /run                     run one collection immediately (seed after deploy)
 *
 * Deploy + per-adapter verification checklist: liquidity/collector/README.md
 */

const METHOD_VERSION = '0.3';
const KEY_STATE   = 'state';
const HISTORY_CAP = 900;   // ~30h at a 2-min cadence
const SLOW_EVERY  = 5;     // structural (slow) lane every N ticks (~10 min at 2-min cron)

const CHAINS = [
  { id: 'solana',      label: 'Solana',      llama: 'Solana',      aliases: ['solana'],                                gecko: 'solana',      wormholeId: 1,    debridgeId: 7565164, evmId: null   },
  { id: 'ethereum',    label: 'Ethereum',    llama: 'Ethereum',    aliases: ['ethereum'],                              gecko: 'eth',         wormholeId: 2,    debridgeId: 1,       evmId: 1      },
  { id: 'base',        label: 'Base',        llama: 'Base',        aliases: ['base'],                                  gecko: 'base',        wormholeId: 30,   debridgeId: 8453,    evmId: 8453   },
  { id: 'bsc',         label: 'BSC',         llama: 'BSC',         aliases: ['bsc','binance','bnb','bnb smart chain'], gecko: 'bsc',         wormholeId: 4,    debridgeId: 56,      evmId: 56     },
  { id: 'arbitrum',    label: 'Arbitrum',    llama: 'Arbitrum',    aliases: ['arbitrum'],                              gecko: 'arbitrum',    wormholeId: 23,   debridgeId: 42161,   evmId: 42161  },
  { id: 'hyperliquid', label: 'Hyperliquid', llama: 'Hyperliquid', aliases: ['hyperliquid','hyperliquid l1'],          gecko: 'hyperliquid', wormholeId: null, debridgeId: null,    evmId: null, harbor: true },
  // Robinhood Chain (Arbitrum-Orbit L2, tokenized equities). Public DeFi
  // liquidity coverage is thin; the lake renders from whatever DefiLlama tracks
  // and is labeled thin-coverage.
  { id: 'robinhood',   label: 'Robinhood',   llama: 'Robinhood',   aliases: ['robinhood','robinhood chain','rhc'],     gecko: null,          wormholeId: null, debridgeId: null,    evmId: null, thin: true },
];
const WH_TO_CHAIN = {}; for (const c of CHAINS) if (c.wormholeId != null) WH_TO_CHAIN[c.wormholeId] = c.id;
const DB_TO_CHAIN = {}; for (const c of CHAINS) if (c.debridgeId != null) DB_TO_CHAIN[c.debridgeId] = c.id;

const DEX_CATEGORIES = new Set(['dexes', 'dexs', 'dex aggregator', 'derivatives', 'launchpad']);

const PLATFORM_TO_GECKO_DEX = {
  'raydium': 'raydium', 'raydium-amm': 'raydium', 'orca': 'orca', 'meteora': 'meteora',
  'pump.fun': 'pumpswap', 'pumpswap': 'pumpswap', 'lifinity': 'lifinity',
  'uniswap': 'uniswap_v3', 'uniswap-v3': 'uniswap_v3', 'uniswap-v2': 'uniswap_v2',
  'aerodrome': 'aerodrome-base', 'aerodrome-slipstream': 'aerodrome-slipstream',
  'pancakeswap': 'pancakeswap_v3', 'pancakeswap-amm': 'pancakeswap_v2',
  'camelot': 'camelot', 'gmx': 'gmx', 'thena': 'thena_fusion',
};

/* ----------------------------- fetch helpers ----------------------------- */

async function j(url, opts = {}) {
  const { timeoutMs = 12000, method = 'GET', body = null } = opts;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init = { method, headers: { accept: 'application/json', 'user-agent': 'clawarcade-liquidity/2.0' }, signal: ctrl.signal, cf: { cacheTtl: 20 } };
    if (body) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
    const r = await fetch(url, init);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
function matchChain(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  for (const c of CHAINS) if (c.llama.toLowerCase() === n || c.aliases.includes(n)) return c.id;
  return null;
}
function num(x) { const v = Number(x); return isFinite(v) ? v : 0; }

/* =========================================================================
   SLOW LANE — structural liquidity (chains, stablecoins, platforms, dex vol,
   per-chain bridge net flow). Real, from DefiLlama. Runs every ~10 min.
   ========================================================================= */
async function slowLane(snap, health) {
  await guard(health, 'tvl', async () => {
    const rows = await j('https://api.llama.fi/v2/chains');
    for (const r of rows) { const id = matchChain(r.name); if (id && typeof r.tvl === 'number') snap.chains[id].chainTvl = r.tvl; }
  });
  await guard(health, 'stables', async () => {
    const rows = await j('https://stablecoins.llama.fi/stablecoinchains');
    for (const r of rows) {
      const id = matchChain(r.name);
      const v = r.totalCirculatingUSD && (r.totalCirculatingUSD.peggedUSD ?? r.totalCirculatingUSD.total);
      if (id && typeof v === 'number') snap.chains[id].stables = v;
    }
  });
  await guard(health, 'protocols', async () => {
    const rows = await j('https://api.llama.fi/protocols', { timeoutMs: 25000 });
    const perChain = {}; for (const c of CHAINS) perChain[c.id] = [];
    for (const p of rows) {
      const cat = String(p.category || '').toLowerCase();
      if (!DEX_CATEGORIES.has(cat)) continue;
      for (const [chainName, tvl] of Object.entries(p.chainTvls || {})) {
        const id = matchChain(chainName);
        if (!id || typeof tvl !== 'number' || tvl <= 0) continue;
        perChain[id].push({ id: (p.slug || p.name || '').toLowerCase(), label: p.name, category: cat, tvl });
      }
    }
    for (const c of CHAINS) {
      const list = perChain[c.id].sort((a, b) => b.tvl - a.tvl).slice(0, 10);
      snap.chains[c.id].dexTvl = list.reduce((s, x) => s + x.tvl, 0);
      snap.chains[c.id].platforms = list;
    }
  });
  await guard(health, 'dexvol', async () => {
    for (const c of CHAINS) {
      try {
        const d = await j(`https://api.llama.fi/overview/dexs/${encodeURIComponent(c.llama)}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`);
        if (typeof d.total24h === 'number') snap.chains[c.id].vol24h = d.total24h;
        if (typeof d.change_1d === 'number') snap.chains[c.id].liqChangePct = d.change_1d;
        const protoVol = {};
        for (const pr of (d.protocols || [])) protoVol[String(pr.name || '').toLowerCase()] = pr.total24h || 0;
        for (const pf of snap.chains[c.id].platforms) {
          const v = protoVol[String(pf.label || '').toLowerCase()];
          if (typeof v === 'number') pf.vol24h = v;
        }
      } catch (_) {}
    }
  });
  // per-chain net bridge flow. SIGN: deposit = onto this chain, withdraw = leaving.
  // net = deposit - withdraw (positive => inflow). VERIFY vs defillama.com/bridges/chains.
  await guard(health, 'bridges_net', async () => {
    for (const c of CHAINS) {
      if (c.harbor || c.thin) continue;
      try {
        const rows = await j(`https://bridges.llama.fi/bridgevolume/${encodeURIComponent(c.llama)}`);
        if (Array.isArray(rows) && rows.length) {
          const last = rows[rows.length - 1];
          snap.chains[c.id].netBridge24h = num(last.depositUSD) - num(last.withdrawUSD);
        }
      } catch (_) {}
    }
  });
}

/* =========================================================================
   BRIDGE ADAPTERS — each returns directional corridors [[fromId,toId,usd],...]
   Every adapter is independent: its own health + coverage flag. Never summed.
   ========================================================================= */

// Wormhole — known-good. Directional source->destination notional volume.
async function adWormhole() {
  const data = await j('https://api.wormholescan.io/api/v1/x-chain-activity/tops?timespan=1d');
  const rows = Array.isArray(data) ? data : (data.txs || data.data || data.activity || []);
  const out = [];
  for (const r of rows) {
    const s = WH_TO_CHAIN[Number(r.emitter_chain ?? r.source_chain ?? r.sourceChain)];
    const d = WH_TO_CHAIN[Number(r.destination_chain ?? r.target_chain ?? r.destinationChain)];
    const v = num(r.volume ?? r.notional ?? r.volume_usd);
    if (s && d && s !== d && v > 0) out.push([s, d, v]);
  }
  if (!out.length) throw new Error('no wormhole corridors parsed');
  return out;
}

// deBridge (DLN) — recent Fulfilled orders aggregated into corridors.
// VERIFY AFTER DEPLOY: confirm the filteredList response shape + the USD field
// names below against a real payload (docs.debridge.finance). If the endpoint
// or fields differ, this throws and the source shows 'down' — it never fakes.
async function adDebridge() {
  const body = {
    giveChainIds: CHAINS.filter(c => c.debridgeId != null).map(c => c.debridgeId),
    takeChainIds: CHAINS.filter(c => c.debridgeId != null).map(c => c.debridgeId),
    orderStates: ['Fulfilled', 'SentUnlock', 'ClaimedUnlock'],
    limit: 200, skip: 0,
  };
  const data = await j('https://stats-api.dln.trade/api/Orders/filteredList', { method: 'POST', body, timeoutMs: 12000 });
  const orders = data.orders || data.items || (Array.isArray(data) ? data : []);
  if (!orders.length) throw new Error('no debridge orders');
  const agg = {};
  for (const o of orders) {
    const give = o.giveOfferWithMetadata || o.giveOffer || {};
    const take = o.takeOfferWithMetadata || o.takeOffer || {};
    const s = DB_TO_CHAIN[Number(give.chainId?.bigIntegerValue ?? give.chainId ?? o.giveChainId)];
    const d = DB_TO_CHAIN[Number(take.chainId?.bigIntegerValue ?? take.chainId ?? o.takeChainId)];
    // USD of the give side; field names vary across API versions — try several.
    const usd = num(
      give.finalAmount?.usdValue ?? give.amount?.usdValue ?? o.giveAmountUsd ??
      o.totalAmountGivenUsd ?? give.usdValue ?? 0
    );
    if (s && d && s !== d && usd > 0) { const k = s + '>' + d; agg[k] = (agg[k] || 0) + usd; }
  }
  const out = Object.entries(agg).map(([k, v]) => { const [s, d] = k.split('>'); return [s, d, v]; });
  if (!out.length) throw new Error('debridge: parsed 0 usd corridors (verify field names)');
  return out;
}

// Hyperliquid Bridge2 — Arbitrum <-> HyperCore USDC. v2 uses DefiLlama's
// hyperliquid-bridge TVL delta as an APPROXIMATE net corridor (labeled). A
// precise gross adapter (indexing the Arbitrum Bridge2 USDC transfers) is a
// follow-up; this stays honest by flagging coverage 'approx-net'.
async function adHyperliquid() {
  const p = await j('https://api.llama.fi/protocol/hyperliquid-bridge');
  const series = p.tvl || (p.chainTvls && (p.chainTvls.Arbitrum?.tvl || p.chainTvls.arbitrum?.tvl)) || [];
  if (!Array.isArray(series) || series.length < 2) throw new Error('no hyperliquid-bridge series');
  const a = series[series.length - 2], b = series[series.length - 1];
  const delta = num(b.totalLiquidityUSD ?? b.tvl) - num(a.totalLiquidityUSD ?? a.tvl);
  if (!isFinite(delta) || Math.abs(delta) < 1e4) return []; // no meaningful move => no river (not faked)
  return delta > 0 ? [['arbitrum', 'hyperliquid', Math.abs(delta)]]
                   : [['hyperliquid', 'arbitrum', Math.abs(delta)]];
}

// Registry. enabled:false stubs are intentionally dark until a verified adapter
// exists — the front-end shows no river for them (rather than a fake one).
const BRIDGE_ADAPTERS = [
  { id: 'wormhole',  label: 'Wormhole',              enabled: true,  coverage: 'observed',  fn: adWormhole },
  { id: 'debridge',  label: 'deBridge',              enabled: true,  coverage: 'verify',    fn: adDebridge },
  { id: 'hyperliquid', label: 'Hyperliquid Bridge2', enabled: true,  coverage: 'approx-net', fn: adHyperliquid },
  // Disabled stubs — implement with verified endpoints, never faked:
  { id: 'cctp',      label: 'Circle CCTP',           enabled: false, coverage: 'stub', fn: null },
  { id: 'across',    label: 'Across',                enabled: false, coverage: 'stub', fn: null },
  { id: 'stargate',  label: 'Stargate',              enabled: false, coverage: 'stub', fn: null },
  { id: 'layerzero', label: 'LayerZero (OFT allowlist only)', enabled: false, coverage: 'stub', fn: null },
];

async function runBridges(snap, health) {
  snap.corridors = {};
  snap.meta.bridges = {};
  for (const ad of BRIDGE_ADAPTERS) {
    if (!ad.enabled || !ad.fn) {
      snap.meta.bridges[ad.id] = { label: ad.label, coverage: ad.coverage, status: 'off', corridors: 0 };
      continue;
    }
    try {
      const corridors = await ad.fn();
      snap.corridors[ad.id] = corridors;
      snap.meta.bridges[ad.id] = { label: ad.label, coverage: ad.coverage, status: 'ok', corridors: corridors.length, at: Date.now() };
      health['bridge_' + ad.id] = { status: 'ok', at: Date.now() };
    } catch (e) {
      snap.meta.bridges[ad.id] = { label: ad.label, coverage: ad.coverage, status: 'down', corridors: 0, err: String(e && e.message || e) };
      health['bridge_' + ad.id] = { status: 'down', at: Date.now(), err: String(e && e.message || e) };
    }
  }
}

/* =========================================================================
   FAST LANE — trench pulse (gecko pools + launch rate) and level-3 tokens.
   counter drives a rotation so rate limits are respected. Real data.
   ========================================================================= */
async function fastLane(snap, health, counter) {
  await guard(health, 'gecko', async () => {
    let ok = 0;
    for (const c of CHAINS) {
      if (!c.gecko) continue;
      try {
        const top = await j(`https://api.geckoterminal.com/api/v2/networks/${c.gecko}/pools?page=1`);
        snap.chains[c.id].topTokens = (top.data || []).slice(0, 8).map(p => {
          const a = p.attributes || {};
          return [a.name || '?', num(a.volume_usd && a.volume_usd.h24), num(a.reserve_in_usd)];
        });
        const fresh = await j(`https://api.geckoterminal.com/api/v2/networks/${c.gecko}/new_pools?page=1`);
        const rows = fresh.data || [];
        const hourAgo = Date.now() - 3600e3;
        const perHour = rows.filter(p => Date.parse((p.attributes || {}).pool_created_at || 0) > hourAgo).length;
        snap.chains[c.id].launchRate = perHour >= rows.length && rows.length ? rows.length * 3 : perHour;
        ok++;
      } catch (_) {}
    }
    if (!ok) throw new Error('all gecko networks failed');
  });

  // Level 3: a few platforms per tick (rate-limit friendly), rotated by counter.
  await guard(health, 'gecko_l3', async () => {
    const jobs = [];
    for (const c of CHAINS) for (const pf of (snap.chains[c.id].platforms || [])) {
      const dex = PLATFORM_TO_GECKO_DEX[pf.id];
      if (c.gecko && dex) jobs.push({ chain: c.id, gecko: c.gecko, pf: pf.id, dex });
    }
    if (!jobs.length) throw new Error('no L3 jobs');
    const start = (counter * 3) % jobs.length;
    for (let k = 0; k < 3; k++) {
      const job = jobs[(start + k) % jobs.length];
      try {
        const d = await j(`https://api.geckoterminal.com/api/v2/networks/${job.gecko}/dexes/${job.dex}/pools?page=1`);
        snap.platformTokens[job.chain + ':' + job.pf] = (d.data || []).slice(0, 8).map(p => {
          const a = p.attributes || {};
          return [a.name || '?', num(a.volume_usd && a.volume_usd.h24), num(a.reserve_in_usd)];
        });
      } catch (_) {}
    }
  });
}

/* ------------------------------ plumbing --------------------------------- */
async function guard(health, key, fn) {
  try { await fn(); health[key] = { status: 'ok', at: Date.now() }; }
  catch (e) { health[key] = { status: 'down', at: Date.now(), err: String(e && e.message || e) }; }
}
function blankSnapshot(prev) {
  const chains = {};
  for (const c of CHAINS) {
    const p = prev && prev.chains && prev.chains[c.id];
    chains[c.id] = {
      label: c.label, harbor: !!c.harbor, thin: !!c.thin,
      dexTvl: p?.dexTvl || 0, stables: p?.stables || 0, vol24h: p?.vol24h || 0,
      chainTvl: p?.chainTvl || 0, netBridge24h: p?.netBridge24h || 0,
      liqChangePct: p?.liqChangePct || 0, launchRate: p?.launchRate || 0,
      platforms: p?.platforms || [], topTokens: p?.topTokens || [],
    };
  }
  return { ts: Date.now(), methodVersion: METHOD_VERSION, chains,
    corridors: {}, platformTokens: (prev && prev.platformTokens) || {}, meta: { health: {}, bridges: {} } };
}
function r0(v) { return v ? Math.round(v) : 0; }
function compactFrame(snap) {
  const chains = {};
  for (const c of CHAINS) {
    const s = snap.chains[c.id];
    chains[c.id] = { d: r0(s.dexTvl), s: r0(s.stables), v: r0(s.vol24h), n: r0(s.netBridge24h), l: Math.round(s.launchRate || 0) };
  }
  const cor = {};
  for (const [k, list] of Object.entries(snap.corridors)) cor[k] = (list || []).slice(0, 12).map(([a, b, v]) => [a, b, r0(v)]);
  return { t: snap.ts, c: chains, r: cor };
}

/* ------------------------- storage (ONE write/run) ----------------------- */
async function loadState(env) {
  const v = await env.LIQUIDITY_KV.get(KEY_STATE);
  if (!v) return { v: METHOD_VERSION, counter: 0, history: [], current: null };
  try { const s = JSON.parse(v); s.history = s.history || []; return s; }
  catch { return { v: METHOD_VERSION, counter: 0, history: [], current: null }; }
}
async function saveState(env, s) { await env.LIQUIDITY_KV.put(KEY_STATE, JSON.stringify(s)); }

async function runCron(env) {
  const st = await loadState(env);
  st.counter = (st.counter || 0) + 1;
  const snap = blankSnapshot(st.current);
  const health = {};

  if (st.counter % SLOW_EVERY === 1 || !st.current) {
    await slowLane(snap, health);
  } else {
    for (const c of CHAINS) Object.assign(snap.chains[c.id], {
      dexTvl: st.current.chains[c.id].dexTvl, stables: st.current.chains[c.id].stables,
      vol24h: st.current.chains[c.id].vol24h, chainTvl: st.current.chains[c.id].chainTvl,
      netBridge24h: st.current.chains[c.id].netBridge24h, liqChangePct: st.current.chains[c.id].liqChangePct,
      platforms: st.current.chains[c.id].platforms,
    });
  }
  await fastLane(snap, health, st.counter);
  await runBridges(snap, health);

  snap.meta.health = health;
  snap.meta.coverageNote =
    'Real data only. Rivers = observed bridge corridors per adapter (Wormhole observed; deBridge pending field verification; Hyperliquid approx-net). Not summed across bridges. DEX-TVL proxies tradable liquidity; volumes not wash-adjusted.';

  st.current = snap;
  st.history.push(compactFrame(snap));
  while (st.history.length > HISTORY_CAP) st.history.shift();
  await saveState(env, st); // single write
  return snap;
}

/* ------------------------------- serving --------------------------------- */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
function json(body, ttl = 20) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}`, ...CORS } });
}
const WINDOW_MS = { '1m': 60e3, '5m': 5*60e3, '30m': 30*60e3, '1h': 3600e3, '3h': 3*3600e3, '6h': 6*3600e3, '12h': 12*3600e3, '1d': 24*3600e3 };

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env)); },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/api/snapshot') {
      const st = await loadState(env);
      if (!st.current) return json({ error: 'no snapshot yet — hit /run once after deploy' }, 5);
      return json(st.current, 20);
    }
    if (url.pathname === '/api/history') {
      const st = await loadState(env);
      const win = WINDOW_MS[url.searchParams.get('window')] || WINDOW_MS['1h'];
      const cutoff = Date.now() - win;
      return json({ window: url.searchParams.get('window') || '1h', frames: (st.history || []).filter(f => f.t >= cutoff) }, 20);
    }
    if (url.pathname === '/api/health') {
      const st = await loadState(env);
      return json({ ok: true, methodVersion: METHOD_VERSION, counter: st.counter || 0, lastTs: st.current?.ts || null,
        historyFrames: (st.history || []).length, health: st.current?.meta?.health || {}, bridges: st.current?.meta?.bridges || {} }, 5);
    }
    if (url.pathname === '/run') { const s = await runCron(env); return json({ ran: true, ts: s.ts, bridges: s.meta.bridges }); }
    return json({ name: 'clawarcade-liquidity collector', version: METHOD_VERSION, endpoints: ['/api/snapshot', '/api/history?window=1h', '/api/health', '/run'] }, 60);
  },
};
