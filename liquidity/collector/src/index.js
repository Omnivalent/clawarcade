/**
 * Liquidity Lakes — collector Worker
 *
 * Runs on a 1-minute cron. Fetches every data source SERVER-SIDE (no browser
 * CORS limits), fixes the bridge-flow sign in ONE place, normalizes a
 * hierarchical snapshot (chains -> platforms -> tokens, plus corridors per
 * bridge), stores the current snapshot + a rolling history ring in KV, and
 * serves them to the front-end over a CORS-open JSON API.
 *
 * Endpoints:
 *   GET /api/snapshot            current normalized state
 *   GET /api/history?window=1h   compact frames within the window (for the time machine)
 *   GET /api/health              source health + counters
 *
 * Deploy: see liquidity/collector/README.md
 */

const CHAINS = [
  { id: 'solana',      label: 'Solana',      llama: 'Solana',      aliases: ['solana'],                         gecko: 'solana',   wormholeId: 1  },
  { id: 'ethereum',    label: 'Ethereum',    llama: 'Ethereum',    aliases: ['ethereum'],                       gecko: 'eth',      wormholeId: 2  },
  { id: 'base',        label: 'Base',        llama: 'Base',        aliases: ['base'],                           gecko: 'base',     wormholeId: 30 },
  { id: 'bsc',         label: 'BSC',         llama: 'BSC',         aliases: ['bsc','binance','bnb','bnb smart chain'], gecko: 'bsc', wormholeId: 4  },
  { id: 'arbitrum',    label: 'Arbitrum',    llama: 'Arbitrum',    aliases: ['arbitrum'],                       gecko: 'arbitrum', wormholeId: 23 },
  { id: 'hyperliquid', label: 'Hyperliquid', llama: 'Hyperliquid', aliases: ['hyperliquid','hyperliquid l1'],   gecko: 'hyperliquid', wormholeId: null, harbor: true },
  // Robinhood Chain (Arbitrum-Orbit L2, tokenized equities). Public DeFi
  // liquidity coverage is thin; the lake renders from whatever DefiLlama tracks
  // and is labeled thin-coverage. aliases cover naming variants seen in the wild.
  { id: 'robinhood',   label: 'Robinhood',   llama: 'Robinhood',   aliases: ['robinhood','robinhood chain','rhc'], gecko: null, wormholeId: null, thin: true },
];
const WH_TO_CHAIN = {};
for (const c of CHAINS) if (c.wormholeId != null) WH_TO_CHAIN[c.wormholeId] = c.id;

// Categories that count as "tradable liquidity venues" for the DEX-TVL proxy
const DEX_CATEGORIES = new Set(['dexes', 'dexs', 'dex aggregator', 'derivatives', 'launchpad']);

// Map a DefiLlama protocol slug -> a GeckoTerminal dex id, so we can drill into
// its pools (level 3). Extend freely; unmapped platforms just show no tokens.
const PLATFORM_TO_GECKO_DEX = {
  'raydium': 'raydium', 'raydium-amm': 'raydium', 'orca': 'orca', 'meteora': 'meteora',
  'pump.fun': 'pumpswap', 'pumpswap': 'pumpswap', 'lifinity': 'lifinity',
  'uniswap': 'uniswap_v3', 'uniswap-v3': 'uniswap_v3', 'uniswap-v2': 'uniswap_v2',
  'aerodrome': 'aerodrome-base', 'aerodrome-slipstream': 'aerodrome-slipstream',
  'pancakeswap': 'pancakeswap_v3', 'pancakeswap-amm': 'pancakeswap_v2',
  'camelot': 'camelot', 'gmx': 'gmx', 'thena': 'thena_fusion',
};

const KEY_CURRENT = 'snapshot:current';
const KEY_HISTORY = 'history:frames';
const KEY_COUNTER = 'cron:counter';
const KEY_L3ROT   = 'l3:rotation';
const HISTORY_CAP = 1600;          // ~26h at 1/min
const SLOW_EVERY  = 10;            // slow lane runs every N cron ticks
const METHOD_VERSION = '0.2';

/* ----------------------------- fetch helpers ----------------------------- */

async function j(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'clawarcade-liquidity/0.2' }, signal: ctrl.signal, cf: { cacheTtl: 30 } });
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

/* ------------------------------ slow lane -------------------------------- */
// Structural liquidity: chain TVL, stablecoins, DEX-TVL by protocol, DEX
// volume, bridge net flow. Updated every ~10 min.

async function slowLane(snap, health) {
  // chains TVL
  await guard(health, 'tvl', async () => {
    const rows = await j('https://api.llama.fi/v2/chains');
    for (const r of rows) { const id = matchChain(r.name); if (id && typeof r.tvl === 'number') snap.chains[id].chainTvl = r.tvl; }
  });

  // stablecoins per chain
  await guard(health, 'stables', async () => {
    const rows = await j('https://stablecoins.llama.fi/stablecoinchains');
    for (const r of rows) {
      const id = matchChain(r.name);
      const v = r.totalCirculatingUSD && (r.totalCirculatingUSD.peggedUSD ?? r.totalCirculatingUSD.total);
      if (id && typeof v === 'number') snap.chains[id].stables = v;
    }
  });

  // protocols -> per-chain DEX-TVL sum + top platforms (the level-2 lakes)
  await guard(health, 'protocols', async () => {
    const rows = await j('https://api.llama.fi/protocols', 25000);
    const perChain = {}; for (const c of CHAINS) perChain[c.id] = [];
    for (const p of rows) {
      const cat = String(p.category || '').toLowerCase();
      if (!DEX_CATEGORIES.has(cat)) continue;
      const byChain = p.chainTvls || {};
      for (const [chainName, tvl] of Object.entries(byChain)) {
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

  // DEX volume per chain (turbulence + ranking) with per-protocol breakdown
  await guard(health, 'dexvol', async () => {
    for (const c of CHAINS) {
      try {
        const d = await j(`https://api.llama.fi/overview/dexs/${encodeURIComponent(c.llama)}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`);
        if (typeof d.total24h === 'number') snap.chains[c.id].vol24h = d.total24h;
        if (typeof d.change_1d === 'number') snap.chains[c.id].liqChangePct = d.change_1d;
        // attach protocol 24h volume to matching platforms
        const protoVol = {};
        for (const pr of (d.protocols || [])) protoVol[String(pr.name || '').toLowerCase()] = pr.total24h || 0;
        for (const pf of snap.chains[c.id].platforms) {
          const v = protoVol[String(pf.label || '').toLowerCase()];
          if (typeof v === 'number') pf.vol24h = v;
        }
      } catch (_) {}
    }
  });

  // bridge net flow per chain.  SIGN: depositUSD = value arriving ON this chain,
  // withdrawUSD = value leaving.  net = deposit - withdraw (positive => inflow).
  // VERIFY once against defillama.com/bridges/chains and flip here if needed.
  await guard(health, 'bridges', async () => {
    for (const c of CHAINS) {
      if (c.harbor) continue;
      try {
        const rows = await j(`https://bridges.llama.fi/bridgevolume/${encodeURIComponent(c.llama)}`);
        if (Array.isArray(rows) && rows.length) {
          const last = rows[rows.length - 1];
          snap.chains[c.id].netBridge24h = (Number(last.depositUSD) || 0) - (Number(last.withdrawUSD) || 0);
        }
      } catch (_) {}
    }
  });
}

/* ------------------------------ fast lane -------------------------------- */
// Trench pulse + corridors. Updated every minute.

async function fastLane(snap, health, env) {
  // Wormhole corridors
  await guard(health, 'wormhole', async () => {
    const data = await j('https://api.wormholescan.io/api/v1/x-chain-activity/tops?timespan=1d');
    const rows = Array.isArray(data) ? data : (data.txs || data.data || data.activity || []);
    const out = [];
    for (const r of rows) {
      const s = WH_TO_CHAIN[Number(r.emitter_chain ?? r.source_chain ?? r.sourceChain)];
      const d = WH_TO_CHAIN[Number(r.destination_chain ?? r.target_chain ?? r.destinationChain)];
      const v = Number(r.volume ?? r.notional ?? r.volume_usd);
      if (s && d && s !== d && isFinite(v) && v > 0) out.push([s, d, v]);
    }
    if (out.length) snap.corridors.wormhole = out;
  });

  // deBridge corridors (best-effort; shape normalized defensively)
  await guard(health, 'debridge', async () => {
    const data = await j('https://stats-api.dln.trade/api/Bridges/stats', 10000).catch(() => null);
    // Optional/looser: if unavailable, source simply degrades. Left as a hook.
    if (data && Array.isArray(data.corridors)) {
      const out = [];
      for (const r of data.corridors) {
        const s = matchChain(r.fromChain), d = matchChain(r.toChain), v = Number(r.volumeUsd);
        if (s && d && s !== d && v > 0) out.push([s, d, v]);
      }
      if (out.length) snap.corridors.debridge = out;
    } else { throw new Error('no debridge corridor data'); }
  });

  // GeckoTerminal: per-network top pools -> chain top tokens + launch rate
  await guard(health, 'gecko', async () => {
    let ok = 0;
    for (const c of CHAINS) {
      if (!c.gecko) continue;
      try {
        const top = await j(`https://api.geckoterminal.com/api/v2/networks/${c.gecko}/pools?page=1`);
        snap.chains[c.id].topTokens = (top.data || []).slice(0, 8).map(p => {
          const a = p.attributes || {};
          return [a.name || '?', Number(a.volume_usd && a.volume_usd.h24) || 0, Number(a.reserve_in_usd) || 0];
        });
        const fresh = await j(`https://api.geckoterminal.com/api/v2/networks/${c.gecko}/new_pools?page=1`);
        const rows = fresh.data || [];
        const hourAgo = Date.now() - 3600e3;
        const perHour = rows.filter(p => Date.parse((p.attributes || {}).pool_created_at || 0) > hourAgo).length;
        snap.chains[c.id].launchRate = perHour >= rows.length && rows.length ? rows.length * 3 : perHour;
        ok++;
      } catch (_) {}
    }
    if (!ok) throw new Error('all networks failed');
  });

  // Level 3: rotate through a couple of platforms per tick to respect rate limits.
  await guard(health, 'gecko_l3', async () => {
    const jobs = [];
    for (const c of CHAINS) for (const pf of (snap.chains[c.id].platforms || [])) {
      const dex = PLATFORM_TO_GECKO_DEX[pf.id];
      if (c.gecko && dex) jobs.push({ chain: c.id, gecko: c.gecko, pf: pf.id, dex });
    }
    if (!jobs.length) throw new Error('no L3 jobs');
    let rot = Number(await env.LIQUIDITY_KV.get(KEY_L3ROT)) || 0;
    const batch = [];
    for (let k = 0; k < 3 && jobs.length; k++) batch.push(jobs[(rot + k) % jobs.length]);
    await env.LIQUIDITY_KV.put(KEY_L3ROT, String((rot + 3) % Math.max(1, jobs.length)));
    for (const job of batch) {
      try {
        const d = await j(`https://api.geckoterminal.com/api/v2/networks/${job.gecko}/dexes/${job.dex}/pools?page=1`);
        snap.platformTokens[job.chain + ':' + job.pf] = (d.data || []).slice(0, 8).map(p => {
          const a = p.attributes || {};
          return [a.name || '?', Number(a.volume_usd && a.volume_usd.h24) || 0, Number(a.reserve_in_usd) || 0];
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
  return {
    ts: Date.now(), methodVersion: METHOD_VERSION, chains,
    corridors: (prev && prev.corridors) || { wormhole: [], debridge: [], layerzero: [] },
    platformTokens: (prev && prev.platformTokens) || {},
    meta: { health: {} },
  };
}

// Compact frame for the history ring: chain metrics + platform tvl/vol + corridor totals
function compactFrame(snap) {
  const chains = {};
  for (const c of CHAINS) {
    const s = snap.chains[c.id];
    chains[c.id] = {
      d: r2(s.dexTvl), s: r2(s.stables), v: r2(s.vol24h), n: r2(s.netBridge24h),
      l: Math.round(s.launchRate || 0),
      p: (s.platforms || []).slice(0, 6).map(pf => [pf.id, r2(pf.tvl), r2(pf.vol24h || 0)]),
    };
  }
  const cor = {};
  for (const [k, list] of Object.entries(snap.corridors)) cor[k] = (list || []).map(([a, b, v]) => [a, b, r2(v)]);
  return { t: snap.ts, c: chains, r: cor };
}
function r2(v) { return v ? Math.round(v) : 0; }

async function runCron(env) {
  const prev = await readJSON(env, KEY_CURRENT);
  const counter = (Number(await env.LIQUIDITY_KV.get(KEY_COUNTER)) || 0) + 1;
  const snap = blankSnapshot(prev);
  const health = {};

  if (counter % SLOW_EVERY === 1 || !prev) await slowLane(snap, health, env);
  else if (prev) { // carry structural fields, refresh fast lane only
    for (const c of CHAINS) Object.assign(snap.chains[c.id], {
      dexTvl: prev.chains[c.id].dexTvl, stables: prev.chains[c.id].stables,
      vol24h: prev.chains[c.id].vol24h, chainTvl: prev.chains[c.id].chainTvl,
      netBridge24h: prev.chains[c.id].netBridge24h, liqChangePct: prev.chains[c.id].liqChangePct,
      platforms: prev.chains[c.id].platforms,
    });
  }
  await fastLane(snap, health, env);

  snap.meta.health = health;
  snap.meta.coverageNote = 'Partial coverage. Bridge rivers = Wormhole (+deBridge when available); a fraction of true volume. DEX-TVL proxies tradable liquidity. Volumes not wash-adjusted.';

  await env.LIQUIDITY_KV.put(KEY_CURRENT, JSON.stringify(snap));
  await env.LIQUIDITY_KV.put(KEY_COUNTER, String(counter));

  // history ring
  const hist = (await readJSON(env, KEY_HISTORY)) || [];
  hist.push(compactFrame(snap));
  while (hist.length > HISTORY_CAP) hist.shift();
  await env.LIQUIDITY_KV.put(KEY_HISTORY, JSON.stringify(hist));
}

async function readJSON(env, key) {
  const v = await env.LIQUIDITY_KV.get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

/* ------------------------------- serving --------------------------------- */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
function json(body, ttl = 20) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}`, ...CORS },
  });
}

const WINDOW_MS = {
  '1m': 60e3, '5m': 5 * 60e3, '30m': 30 * 60e3, '1h': 3600e3,
  '3h': 3 * 3600e3, '6h': 6 * 3600e3, '12h': 12 * 3600e3, '1d': 24 * 3600e3,
};

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env)); },

  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/api/snapshot') {
      const snap = await readJSON(env, KEY_CURRENT);
      if (!snap) return json({ error: 'no snapshot yet — cron has not run' }, 5);
      return json(snap, 20);
    }
    if (url.pathname === '/api/history') {
      const win = WINDOW_MS[url.searchParams.get('window')] || WINDOW_MS['1h'];
      const hist = (await readJSON(env, KEY_HISTORY)) || [];
      const cutoff = Date.now() - win;
      return json({ window: url.searchParams.get('window') || '1h', frames: hist.filter(f => f.t >= cutoff) }, 20);
    }
    if (url.pathname === '/api/health') {
      const snap = await readJSON(env, KEY_CURRENT);
      const hist = (await readJSON(env, KEY_HISTORY)) || [];
      return json({ ok: true, methodVersion: METHOD_VERSION, lastTs: snap?.ts || null, historyFrames: hist.length, health: snap?.meta?.health || {} }, 5);
    }
    // manual trigger for testing after deploy: GET /run?key=...
    if (url.pathname === '/run') { await runCron(env); return json({ ran: true, ts: Date.now() }); }

    return json({ name: 'clawarcade-liquidity collector', endpoints: ['/api/snapshot', '/api/history?window=1h', '/api/health'] }, 60);
  },
};
