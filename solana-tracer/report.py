#!/usr/bin/env python3
"""Turn a pnl_<mint6>.json from `solana_tracer.py pnl` into one self-contained HTML page:
profit leaderboard + connection map + evidence list. Standard library only, no build step.

Usage:  python3 report.py pnl_7ESp4u.json            -> writes pnl_7ESp4u.html
        python3 report.py pnl_7ESp4u.json out.html
The page needs no server: open it in a browser, or upload it to any static host.
"""
import html
import json
import os
import sys
from datetime import datetime, timezone


def ts(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d %H:%M UTC") if t else ""


def build(data):
    sol_usd = data["sol_usd"]
    W = data["wallets"]
    top = data["top"]
    funders = data.get("funders") or {}
    rows = []
    for w in top:
        r = W[w]
        fb = r.get("first_buy") or {}
        f = funders.get(w) or {}
        rows.append({
            "w": w, "pnl": r["realized_sol"], "spent": r["spent_sol"], "got": r["received_sol"],
            "held": r["held_tokens"], "free": r["free_tokens_in"], "complete": r["complete"],
            "buys": sum(1 for t in r["trades"] if t["kind"] == "BUY"),
            "sells": sum(1 for t in r["trades"] if t["kind"] == "SELL"),
            "mc": (fb.get("mc_sol") or 0) * sol_usd, "t": ts(fb.get("time")), "sig": fb.get("sig", ""),
            "funder": f.get("funder", ""), "fsol": f.get("sol", 0),
        })
    links = [l for l in data.get("links", [])]
    others = sorted(W, key=lambda w: -W[w]["realized_sol"])
    stats = {
        "below": None, "computed": len(W), "winners": sum(1 for w in W if W[w]["realized_sol"] > 0),
        "losers": sum(1 for w in W if W[w]["realized_sol"] < 0),
        "top_total": sum(W[w]["realized_sol"] for w in top),
        "all_total": sum(W[w]["realized_sol"] for w in W),
        "worst": W[others[-1]]["realized_sol"] if others else 0,
    }
    return {"mint": data["mint"], "source": data.get("source"), "sol_usd": sol_usd,
            "max_mc": data["max_mc_usd"], "notes": data.get("notes", []), "rows": rows,
            "links": links, "stats": stats, "generated": ts(data.get("generated") or 0)}


PAGE = r"""<title>__TITLE__</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: forensic ledger. Summary strip, then the money table, then the map that explains it, then the raw evidence. */
:root{
  --bg:#f3f5f8; --panel:#ffffff; --ink:#131a26; --muted:#5b6678; --line:#d8dee8;
  --accent:#0f7c8c; --gain:#13814a; --loss:#b4372f; --strong:#c25a00; --medium:#7a52c7; --soft:#8a94a6;
  --node:#0f7c8c; --node2:#9aa6b8;
  --display:"Chakra Petch",ui-sans-serif,system-ui,sans-serif;
  --body:"IBM Plex Sans",ui-sans-serif,system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0d121a; --panel:#141b26; --ink:#e6ebf2; --muted:#93a0b4; --line:#253042;
  --accent:#3cc3d4; --gain:#3ccf86; --loss:#ff7a6e; --strong:#ff9d45; --medium:#b393ff; --soft:#6b7790;
  --node:#3cc3d4; --node2:#56627a; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0d121a; --panel:#141b26; --ink:#e6ebf2; --muted:#93a0b4; --line:#253042;
  --accent:#3cc3d4; --gain:#3ccf86; --loss:#ff7a6e; --strong:#ff9d45; --medium:#b393ff; --soft:#6b7790;
  --node:#3cc3d4; --node2:#56627a; color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.55 var(--body);
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:28px 64px}
.wrap{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:28px}
a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
a:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mono{font-family:var(--mono);font-size:12.5px;word-break:break-all}
header{display:flex;flex-direction:column;gap:8px}
.eyebrow{font:600 12px var(--display);letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
h1{font:700 clamp(26px,4vw,38px)/1.1 var(--display);margin:0;text-wrap:balance}
h2{font:600 20px var(--display);margin:0 0 4px;letter-spacing:.02em}
.sub{color:var(--muted);margin:0;max-width:70ch}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:6px;overflow:hidden}
.stat{background:var(--panel);padding:14px 16px;display:flex;flex-direction:column;gap:2px}
.stat b{font:600 22px var(--display);font-variant-numeric:tabular-nums}
.stat span{color:var(--muted);font-size:12.5px}
.gain{color:var(--gain)} .loss{color:var(--loss)}
.notes{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted);border-left:3px solid var(--line);padding:2px 0 2px 12px}
section{display:flex;flex-direction:column;gap:12px;min-width:0}
.tablebox{overflow-x:auto;border:1px solid var(--line);border-radius:6px;background:var(--panel)}
table{border-collapse:collapse;width:100%;min-width:900px;font-variant-numeric:tabular-nums}
th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
th{font:600 11.5px var(--display);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);background:var(--panel);position:sticky;top:0}
td.num,th.num{text-align:right;white-space:nowrap}
tr{cursor:pointer} tr:hover td{background:color-mix(in srgb,var(--accent) 6%,transparent)}
tr.sel td{background:color-mix(in srgb,var(--accent) 14%,transparent)}
.rank{font:700 16px var(--display);color:var(--muted)}
.pill{display:inline-block;font:500 11px var(--body);padding:1px 7px;border-radius:999px;border:1px solid var(--line);color:var(--muted);margin:3px 4px 0 0}
.pill.warn{border-color:var(--strong);color:var(--strong)}
.pill.link{border-color:var(--medium);color:var(--medium)}
.small{font-size:12.5px;color:var(--muted)}
.mapbox{background:var(--panel);border:1px solid var(--line);border-radius:6px;overflow:hidden;position:relative}
svg{display:block;width:100%;height:auto;max-height:640px;touch-action:none}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12.5px;color:var(--muted);padding:10px 14px;border-top:1px solid var(--line)}
.legend i{display:inline-block;width:18px;height:3px;vertical-align:middle;margin-right:6px;border-radius:2px}
.detail{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;min-height:64px}
.ev{display:flex;flex-direction:column;gap:10px}
.evi{display:grid;grid-template-columns:86px 1fr;gap:4px 12px;padding:10px 0;border-bottom:1px solid var(--line)}
.tag{font:600 11px var(--display);letter-spacing:.1em;text-transform:uppercase}
.tag.strong{color:var(--strong)} .tag.medium{color:var(--medium)} .tag.lead{color:var(--accent)} .tag.soft{color:var(--soft)}
.caveat{font-size:12.5px;color:var(--muted)}
@media (max-width:640px){.evi{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
<header>
  <div class="eyebrow">Solana tracer · realized profit</div>
  <h1 id="h1"></h1>
  <p class="sub mono" id="mint"></p>
  <p class="sub" id="lede"></p>
</header>

<div class="strip" id="strip"></div>
<div class="notes" id="notes"></div>

<section>
  <h2>Top wallets by realized profit</h2>
  <p class="sub small">Average-cost profit from every buy and sell in this token, including sells after graduation. Click a row to find the wallet on the map.</p>
  <div class="tablebox"><table id="tbl"></table></div>
</section>

<section>
  <h2>Connection map</h2>
  <p class="sub small">Large dots are top earners (size = profit). Small dots are wallets linked to them. Lines show the strongest evidence between two wallets. Click a dot for details; drag to rearrange.</p>
  <div class="mapbox"><svg id="map" viewBox="0 0 1000 620" role="img" aria-label="Connection map of top profit wallets"></svg>
    <div class="legend">
      <span><i style="background:var(--strong)"></i>strong: same funder, co-signed, direct transfer</span>
      <span><i style="background:var(--medium)"></i>medium: shared private counterparty</span>
      <span><i style="background:var(--accent)"></i>lead: token sent to another wallet</span>
      <span><i style="background:var(--soft)"></i>soft: shared busy wallet (exchange, bot or operator)</span>
    </div>
  </div>
  <div class="detail" id="detail"><span class="small">Select a wallet on the map or in the table.</span></div>
</section>

<section>
  <h2>Evidence</h2>
  <p class="caveat">Links are leads, not proof. Exchanges, bots and market makers create false links; busy addresses are marked soft.</p>
  <div class="ev" id="ev"></div>
</section>
</div>

<script>
const D = __DATA__;
const $ = id => document.getElementById(id);
const usd = s => (s<0?"-":"") + "$" + Math.abs(s*D.sol_usd).toLocaleString("en-US",{maximumFractionDigits:0});
const sol = s => (s>0?"+":"") + s.toFixed(3) + " SOL";
const fmt = n => n.toLocaleString("en-US",{maximumFractionDigits:0});
const acct = a => `<a class="mono" href="https://solscan.io/account/${a}" target="_blank" rel="noopener">${a}</a>`;
const txl = s => `<a class="mono" href="https://solscan.io/tx/${s}" target="_blank" rel="noopener">${s}</a>`;
const linkify = t => t.replace(/[1-9A-HJ-NP-Za-km-z]{80,90}/g, m=>txl(m)).replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, m=>acct(m));

$("h1").textContent = `Who profited from ${D.mint.slice(0,4)}…${D.mint.slice(-4)}`;
$("mint").innerHTML = "Token " + acct(D.mint) + (D.source && D.source!==D.mint ? "<br>History read from bonding curve " + acct(D.source) : "");
$("lede").textContent = `Wallets that bought below $${fmt(D.max_mc)} market cap, ranked by realized profit. SOL priced at $${D.sol_usd.toFixed(2)} (launch).`;
const S = D.stats;
$("strip").innerHTML = [
  [fmt(S.computed), "wallets checked"],
  [`${S.winners} / ${S.losers}`, "in profit / at a loss"],
  [`<span class="gain">${sol(S.top_total)}</span>`, `top ${D.rows.length} realized (${usd(S.top_total)})`],
  [`<span class="${S.all_total>=0?'gain':'loss'}">${sol(S.all_total)}</span>`, "all checked wallets combined"],
  [`$${D.sol_usd.toFixed(2)}`, "SOL price at launch"],
].map(([b,s])=>`<div class="stat"><b>${b}</b><span>${s}</span></div>`).join("");
$("notes").innerHTML = D.notes.concat(["USD uses the launch SOL price; sells at other times were worth more or less in dollars."]).map(n=>`<div>${linkify(n)}</div>`).join("");

// links by wallet
const top = new Set(D.rows.map(r=>r.w));
const rank = Object.fromEntries(D.rows.map((r,i)=>[r.w,i+1]));
const byW = {};
D.links.forEach(l=>{(byW[l.a]=byW[l.a]||[]).push(l);(byW[l.b]=byW[l.b]||[]).push(l)});

$("tbl").innerHTML = `<thead><tr><th>#</th><th>Wallet</th><th class="num">Realized</th><th class="num">Spent → received</th><th class="num">First buy at</th><th class="num">Buys / sells</th><th>Funded by</th></tr></thead><tbody>` +
 D.rows.map((r,i)=>{
  const ls = (byW[r.w]||[]).filter(l=>l.strength!=="soft");
  const pills = [];
  if (ls.length) pills.push(`<span class="pill link">${ls.length} link${ls.length>1?"s":""}</span>`);
  if (r.held>0.5) pills.push(`<span class="pill">still holds ${fmt(r.held)}</span>`);
  if (r.free>0) pills.push(`<span class="pill warn">got ${fmt(r.free)} tokens free</span>`);
  if (!r.complete) pills.push(`<span class="pill warn">history partly read</span>`);
  return `<tr data-w="${r.w}"><td class="rank">${i+1}</td><td>${acct(r.w)}<div>${pills.join("")}</div></td>
   <td class="num"><b class="${r.pnl>=0?'gain':'loss'}">${sol(r.pnl)}</b><div class="small">${usd(r.pnl)}</div></td>
   <td class="num">${r.spent.toFixed(3)} → ${r.got.toFixed(3)}</td>
   <td class="num">$${fmt(r.mc)}<div class="small">${r.t}</div></td>
   <td class="num">${r.buys} / ${r.sells}</td>
   <td>${r.funder?acct(r.funder)+`<div class="small">${r.fsol.toFixed(3)} SOL</div>`:'<span class="small">not traced</span>'}</td></tr>`;
 }).join("") + "</tbody>";

// evidence list
const order = {strong:0,medium:1,lead:2,soft:3};
const seen = new Set();
$("ev").innerHTML = D.links.slice().sort((a,b)=>order[a.strength]-order[b.strength]).filter(l=>{const k=l.a+l.b+l.evidence;if(seen.has(k))return false;seen.add(k);return true})
 .map(l=>`<div class="evi"><span class="tag ${l.strength}">${l.strength}</span><div>${acct(l.a)} ↔ ${acct(l.b)}<div class="small">${linkify(l.evidence)}</div></div></div>`).join("") || '<div class="small">No links found between the top wallets.</div>';

// ---- force map (no library)
const svg = $("map"), NS="http://www.w3.org/2000/svg";
const nodes = new Map();
const addN = (id, isTop) => { if(!nodes.has(id)) nodes.set(id,{id, top:isTop, x:500+Math.cos(nodes.size*2.4)*(isTop?180:300), y:310+Math.sin(nodes.size*2.4)*(isTop?140:230), vx:0, vy:0}); return nodes.get(id); };
D.rows.forEach(r=>addN(r.w,true).pnl=r.pnl);
const E = [];
const eseen = new Set();
D.links.forEach(l=>{ const k=[l.a,l.b].sort().join("|")+l.strength; if(eseen.has(k))return; eseen.add(k);
  const a=addN(l.a,top.has(l.a)), b=addN(l.b,top.has(l.b)); E.push({a,b,s:l.strength,t:l.evidence}); });
// funder nodes for strong shared-funder context
const N = [...nodes.values()];
const maxP = Math.max(...D.rows.map(r=>Math.max(r.pnl,0.001)));
N.forEach(n=>n.r = n.top ? 7 + 17*Math.sqrt(Math.max(n.pnl,0)/maxP) : 4.5);
for (let it=0; it<420; it++){
  const k = 1 - it/420;
  for (let i=0;i<N.length;i++) for (let j=i+1;j<N.length;j++){
    const a=N[i], b=N[j]; let dx=a.x-b.x, dy=a.y-b.y, d2=dx*dx+dy*dy+0.01, d=Math.sqrt(d2);
    const f = 2600/d2; dx/=d; dy/=d; a.vx+=dx*f; a.vy+=dy*f; b.vx-=dx*f; b.vy-=dy*f; }
  E.forEach(e=>{ let dx=e.b.x-e.a.x, dy=e.b.y-e.a.y, d=Math.sqrt(dx*dx+dy*dy)+0.01; const want = e.s==="soft"?150:90;
    const f=(d-want)*0.02; dx/=d; dy/=d; e.a.vx+=dx*f; e.a.vy+=dy*f; e.b.vx-=dx*f; e.b.vy-=dy*f; });
  N.forEach(n=>{ n.vx+=(500-n.x)*0.004; n.vy+=(310-n.y)*0.006; n.x+=Math.max(-30,Math.min(30,n.vx))*k; n.y+=Math.max(-30,Math.min(30,n.vy))*k; n.vx*=0.55; n.vy*=0.55;
    n.x=Math.max(30,Math.min(970,n.x)); n.y=Math.max(30,Math.min(590,n.y)); });
}
const col = {strong:"var(--strong)",medium:"var(--medium)",lead:"var(--accent)",soft:"var(--soft)"};
const gE = document.createElementNS(NS,"g"), gN=document.createElementNS(NS,"g");
svg.append(gE,gN);
E.forEach(e=>{ const l=document.createElementNS(NS,"line"); l.setAttribute("stroke",col[e.s]); l.setAttribute("stroke-width",e.s==="strong"?2.4:1.5);
  if(e.s==="soft") l.setAttribute("stroke-dasharray","4 4"); l.setAttribute("stroke-opacity",".85"); e.el=l; gE.append(l); });
N.forEach(n=>{ const g=document.createElementNS(NS,"g"); g.style.cursor="pointer"; g.setAttribute("tabindex","0");
  const c=document.createElementNS(NS,"circle"); c.setAttribute("r",n.r); c.setAttribute("fill",n.top?"var(--node)":"var(--node2)");
  c.setAttribute("stroke","var(--panel)"); c.setAttribute("stroke-width","2"); g.append(c);
  if(n.top){ const t=document.createElementNS(NS,"text"); t.textContent=rank[n.id]; t.setAttribute("text-anchor","middle"); t.setAttribute("dy","0.35em");
    t.setAttribute("fill","var(--panel)"); t.setAttribute("font-size", n.r>11?"11":"9"); t.setAttribute("font-family","IBM Plex Mono, monospace"); t.setAttribute("font-weight","600"); t.style.pointerEvents="none"; g.append(t); }
  const ti=document.createElementNS(NS,"title"); ti.textContent=n.id; g.append(ti);
  n.el=g; n.c=c; gN.append(g);
  g.addEventListener("click",()=>select(n.id)); g.addEventListener("keydown",ev=>{if(ev.key==="Enter")select(n.id)});
  // drag
  g.addEventListener("pointerdown",ev=>{ ev.preventDefault(); g.setPointerCapture(ev.pointerId);
    const pt=svg.createSVGPoint(); const mv=e2=>{pt.x=e2.clientX;pt.y=e2.clientY;const p=pt.matrixTransform(svg.getScreenCTM().inverse());n.x=p.x;n.y=p.y;draw();};
    const up=()=>{g.removeEventListener("pointermove",mv);g.removeEventListener("pointerup",up)}; g.addEventListener("pointermove",mv); g.addEventListener("pointerup",up); });
});
function draw(){ E.forEach(e=>{e.el.setAttribute("x1",e.a.x);e.el.setAttribute("y1",e.a.y);e.el.setAttribute("x2",e.b.x);e.el.setAttribute("y2",e.b.y)});
  N.forEach(n=>n.el.setAttribute("transform",`translate(${n.x},${n.y})`)); }
draw();
if (!E.length){ const t=document.createElementNS(NS,"text"); t.textContent="No connections found between the top wallets"; t.setAttribute("x",500); t.setAttribute("y",600); t.setAttribute("text-anchor","middle"); t.setAttribute("fill","var(--muted)"); svg.append(t); }

function select(w){
  document.querySelectorAll("tr.sel").forEach(r=>r.classList.remove("sel"));
  const row=document.querySelector(`tr[data-w="${w}"]`); if(row) row.classList.add("sel");
  N.forEach(n=>{ const on = n.id===w || E.some(e=>(e.a.id===w&&e.b===n)||(e.b.id===w&&e.a===n));
    n.el.style.opacity = on?1:0.25; n.c.setAttribute("stroke", n.id===w?"var(--ink)":"var(--panel)"); });
  E.forEach(e=>e.el.style.opacity = (e.a.id===w||e.b.id===w)?1:0.12);
  const r = D.rows.find(x=>x.w===w);
  const ls = byW[w]||[];
  $("detail").innerHTML = `<div>${r?`<b>#${rank[w]}</b> `:'<b>Linked wallet</b> '}${acct(w)}</div>` +
    (r?`<div class="small">Realized <b class="${r.pnl>=0?'gain':'loss'}">${sol(r.pnl)}</b> (${usd(r.pnl)}) · first buy at $${fmt(r.mc)} market cap ${r.sig?'· '+txl(r.sig):''}</div>`:'') +
    (ls.length? ls.map(l=>`<div class="small"><span class="tag ${l.strength}">${l.strength}</span> ${linkify(l.evidence)}</div>`).join("") : '<div class="small">No links found for this wallet.</div>');
}
document.querySelectorAll("tr[data-w]").forEach(tr=>tr.addEventListener("click",ev=>{ if(ev.target.closest("a"))return; select(tr.dataset.w); $("map").scrollIntoView({behavior:"smooth",block:"center"}); }));
svg.addEventListener("click",ev=>{ if(ev.target===svg){ N.forEach(n=>{n.el.style.opacity=1;n.c.setAttribute("stroke","var(--panel)")}); E.forEach(e=>e.el.style.opacity=1);} });
</script>
"""


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(src)[0] + ".html"
    data = json.load(open(src))
    view = build(data)
    blob = json.dumps(view).replace("</", "<\\/")
    title = f"{data['mint'][:4]}…{data['mint'][-4:]} Profit Map"
    with open(out, "w") as fh:
        fh.write(PAGE.replace("__DATA__", blob).replace("__TITLE__", html.escape(title)))
    print(f"Saved {out}")


if __name__ == "__main__":
    main()
