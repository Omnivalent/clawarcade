// Offline planner used when no model API key is configured. It drives the exact same
// tool executor as a real model (write_file → list_files → finish), so the sandbox,
// logging, zipping and fee pipeline are exercised end to end in a local demo.

export type PlannedCall =
  | { tool: "write_file"; args: { path: string; content: string } }
  | { tool: "list_files"; args: Record<string, never> }
  | { tool: "run_shell"; args: { command: string } }
  | { tool: "finish"; args: { summary: string } };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function titleFrom(prompt: string, fallback: string) {
  const m = prompt.match(/(?:for|called|named)\s+(?:an?\s+|the\s+)?["“]?([A-Z][\w'’ -]{2,40})/);
  return (m?.[1] ?? fallback).trim().replace(/["”.]+$/, "");
}

const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0}body{font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b0b0c;color:#ecebe6;-webkit-font-smoothing:antialiased}
a{color:inherit}button,input{font:inherit;color:inherit}
.wrap{max-width:960px;margin:0 auto;padding:56px 24px}`;

function todoApp(prompt: string) {
  const title = titleFrom(prompt, "Today");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} — Todo</title>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<main class="wrap">
  <header>
    <p class="eyebrow">One-page todo</p>
    <h1>${esc(title)}</h1>
    <p class="sub"><span id="left">0</span> open · <span id="done">0</span> done</p>
  </header>
  <form id="add" autocomplete="off">
    <input id="text" placeholder="Add a task and press Enter" maxlength="140" aria-label="New task" />
    <button type="submit">Add</button>
  </form>
  <nav class="filters" aria-label="Filter">
    <button data-f="all" class="on">All</button><button data-f="open">Open</button><button data-f="done">Done</button>
    <button id="clear" class="ghost">Clear done</button>
  </nav>
  <ul id="list"></ul>
  <p id="empty" class="empty">Nothing here yet.</p>
</main>
<script src="app.js"></script>
</body>
</html>
`;
  const css = `${BASE_CSS}
.wrap{max-width:560px}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8a8a84;margin:0 0 8px}
h1{font-size:44px;line-height:1.05;letter-spacing:-.02em;margin:0 0 6px;font-weight:600}
.sub{color:#8a8a84;margin:0 0 28px}
form{display:flex;gap:8px;margin-bottom:16px}
input{flex:1;background:#141416;border:1px solid #26262a;border-radius:12px;padding:14px 16px;outline:none}
input:focus{border-color:#d9ff5a}
button{background:#d9ff5a;color:#0b0b0c;border:0;border-radius:12px;padding:0 18px;font-weight:600;cursor:pointer}
.filters{display:flex;gap:6px;margin-bottom:12px}
.filters button{background:transparent;color:#8a8a84;border:1px solid #26262a;padding:6px 12px;border-radius:999px;font-weight:500;font-size:13px}
.filters button.on{color:#ecebe6;border-color:#55554f}
.filters .ghost{margin-left:auto}
ul{list-style:none;padding:0;margin:0;border-top:1px solid #1d1d20}
li{display:flex;align-items:center;gap:12px;padding:14px 4px;border-bottom:1px solid #1d1d20}
li input[type=checkbox]{flex:none;width:18px;height:18px;accent-color:#d9ff5a}
li span{flex:1}
li.done span{color:#5c5c57;text-decoration:line-through}
li .x{background:none;color:#5c5c57;padding:4px 8px;font-size:18px}
li .x:hover{color:#ff7a59}
.empty{color:#5c5c57;text-align:center;padding:40px 0}
`;
  const js = `const KEY = "todo.items.v1";
const $ = (s) => document.querySelector(s);
let items = load();
let filter = "all";

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
}
function render() {
  const list = $("#list");
  list.innerHTML = "";
  const shown = items.filter((i) => filter === "all" || (filter === "done" ? i.done : !i.done));
  for (const item of shown) {
    const li = document.createElement("li");
    li.className = item.done ? "done" : "";
    const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: item.done });
    box.addEventListener("change", () => { item.done = box.checked; save(); render(); });
    const text = Object.assign(document.createElement("span"), { textContent: item.text });
    const del = Object.assign(document.createElement("button"), { className: "x", textContent: "×", title: "Delete" });
    del.addEventListener("click", () => { items = items.filter((i) => i !== item); save(); render(); });
    li.append(box, text, del);
    list.append(li);
  }
  $("#empty").style.display = shown.length ? "none" : "block";
  $("#left").textContent = items.filter((i) => !i.done).length;
  $("#done").textContent = items.filter((i) => i.done).length;
}
$("#add").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#text").value.trim();
  if (!text) return;
  items.unshift({ id: Date.now(), text, done: false });
  $("#text").value = "";
  save(); render();
});
document.querySelectorAll("[data-f]").forEach((b) =>
  b.addEventListener("click", () => {
    filter = b.dataset.f;
    document.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b));
    render();
  })
);
$("#clear").addEventListener("click", () => { items = items.filter((i) => !i.done); save(); render(); });
render();
`;
  return {
    files: [
      { path: "index.html", content: html },
      { path: "styles.css", content: css },
      { path: "app.js", content: js },
      { path: "README.md", content: `# ${title}\n\nA dependency-free one-page todo app. Open \`index.html\` in a browser.\n\n- Add, complete, delete, filter tasks\n- Persists to localStorage\n` },
    ],
    summary: `Built a one-page todo app (${title}) with add/complete/delete, filters and localStorage persistence. Open index.html.`,
  };
}

function landingPage(prompt: string) {
  const title = titleFrom(prompt, "Northwind");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<header class="nav wrap"><strong>${esc(title)}</strong><nav><a href="#features">Features</a><a href="#pricing">Pricing</a><a class="btn sm" href="#cta">Get started</a></nav></header>
<main>
  <section class="hero wrap">
    <p class="eyebrow">Now in early access</p>
    <h1>${esc(title)} turns busy work<br/>into <em>shipped work.</em></h1>
    <p class="lede">${esc(prompt.slice(0, 220))}</p>
    <div class="row"><a class="btn" href="#cta">Start free</a><a class="btn ghost" href="#features">See how it works →</a></div>
  </section>
  <section id="features" class="grid wrap">
    <article><span>01</span><h3>Fast by default</h3><p>Pages load in under a second on any connection.</p></article>
    <article><span>02</span><h3>Built for teams</h3><p>Share, comment and hand off without leaving the page.</p></article>
    <article><span>03</span><h3>Private</h3><p>Your data stays yours. Export everything, any time.</p></article>
  </section>
  <section id="pricing" class="price wrap">
    <div><h2>Simple pricing</h2><p>One plan. Everything included.</p></div>
    <div class="card"><p class="amt">$12<small>/mo</small></p><ul><li>Unlimited projects</li><li>Team seats</li><li>Priority support</li></ul><a class="btn" id="cta" href="#">Get started</a></div>
  </section>
</main>
<footer class="wrap">© ${new Date().getFullYear()} ${esc(title)}</footer>
</body>
</html>
`;
  const css = `${BASE_CSS}
.nav{display:flex;justify-content:space-between;align-items:center;padding-top:24px;padding-bottom:24px}
.nav nav{display:flex;gap:22px;align-items:center;color:#a3a39c;font-size:14px}.nav a{text-decoration:none}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#d9ff5a}
.hero{padding-top:72px;padding-bottom:96px}
h1{font-size:clamp(40px,7vw,76px);line-height:1;letter-spacing:-.035em;margin:12px 0 22px;font-weight:600}
h1 em{font-style:normal;color:#d9ff5a}
.lede{max-width:560px;color:#a3a39c;font-size:18px}
.row{display:flex;gap:12px;margin-top:30px;flex-wrap:wrap}
.btn{display:inline-block;background:#ecebe6;color:#0b0b0c;text-decoration:none;padding:13px 20px;border-radius:999px;font-weight:600}
.btn.sm{padding:8px 14px;font-size:13px}.btn.ghost{background:transparent;color:#ecebe6;border:1px solid #2a2a2e}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;background:#1f1f22;border:1px solid #1f1f22;border-radius:18px;overflow:hidden;padding:0}
.grid article{background:#0e0e10;padding:28px}.grid span{font:12px ui-monospace,monospace;color:#5c5c57}
.grid h3{margin:18px 0 6px;font-size:18px}.grid p{margin:0;color:#8a8a84}
.price{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center;padding-top:96px}
.price h2{font-size:36px;letter-spacing:-.02em;margin:0}.price p{color:#8a8a84}
.card{background:#141416;border:1px solid #26262a;border-radius:20px;padding:28px}
.amt{font-size:48px;font-weight:600;margin:0}.amt small{font-size:16px;color:#8a8a84}
.card ul{padding-left:18px;color:#a3a39c;margin:14px 0 22px}
footer{color:#5c5c57;font-size:13px;padding-top:24px}
@media(max-width:700px){.price{grid-template-columns:1fr}.nav nav a:not(.btn){display:none}}
`;
  return {
    files: [
      { path: "index.html", content: html },
      { path: "styles.css", content: css },
      { path: "README.md", content: `# ${title}\n\nStatic landing page. Open \`index.html\`, or deploy the folder to any static host.\n` },
    ],
    summary: `Built a responsive static landing page for ${title}: hero, feature grid, pricing card and footer.`,
  };
}

function apiService(prompt: string) {
  const title = titleFrom(prompt, "notes-api");
  const pkg = {
    name: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "api-service",
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: { start: "node server.js", test: "node --test" },
    engines: { node: ">=20" },
  };
  const server = `import http from "node:http";
import { randomUUID } from "node:crypto";

// In-memory notes API with zero dependencies.
export const store = new Map();

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw new Error("payload too large");
  }
  return raw ? JSON.parse(raw) : {};
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const [, resource, id] = url.pathname.split("/");
    try {
      if (url.pathname === "/health") return send(res, 200, { ok: true });
      if (resource !== "notes") return send(res, 404, { error: "not found" });
      if (req.method === "GET" && !id) return send(res, 200, [...store.values()]);
      if (req.method === "GET") return store.has(id) ? send(res, 200, store.get(id)) : send(res, 404, { error: "not found" });
      if (req.method === "POST" && !id) {
        const { title, body = "" } = await readJson(req);
        if (typeof title !== "string" || !title.trim()) return send(res, 400, { error: "title is required" });
        const note = { id: randomUUID(), title: title.trim(), body: String(body), createdAt: new Date().toISOString() };
        store.set(note.id, note);
        return send(res, 201, note);
      }
      if (req.method === "DELETE" && id) return store.delete(id) ? send(res, 204) : send(res, 404, { error: "not found" });
      return send(res, 405, { error: "method not allowed" });
    } catch (e) {
      return send(res, 400, { error: String(e.message || e) });
    }
  });
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const port = Number(process.env.PORT) || 8787;
  createServer().listen(port, () => console.log(\`listening on :\${port}\`));
}
`;
  const test = `import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";

test("create, list and delete a note", async () => {
  const srv = createServer().listen(0);
  const { port } = srv.address();
  const base = \`http://127.0.0.1:\${port}\`;
  const created = await (await fetch(\`\${base}/notes\`, { method: "POST", body: JSON.stringify({ title: "hello" }) })).json();
  assert.equal(created.title, "hello");
  const list = await (await fetch(\`\${base}/notes\`)).json();
  assert.equal(list.length, 1);
  assert.equal((await fetch(\`\${base}/notes/\${created.id}\`, { method: "DELETE" })).status, 204);
  srv.close();
});

test("rejects missing title", async () => {
  const srv = createServer().listen(0);
  const { port } = srv.address();
  const r = await fetch(\`http://127.0.0.1:\${port}/notes\`, { method: "POST", body: "{}" });
  assert.equal(r.status, 400);
  srv.close();
});
`;
  return {
    files: [
      { path: "package.json", content: JSON.stringify(pkg, null, 2) + "\n" },
      { path: "server.js", content: server },
      { path: "test/server.test.js", content: test },
      { path: "README.md", content: `# ${pkg.name}\n\nZero-dependency JSON API.\n\n\`\`\`bash\nnpm start   # :8787\nnpm test\n\`\`\`\n\n| Method | Path | |\n|---|---|---|\n| GET | /health | liveness |\n| GET | /notes | list |\n| POST | /notes | create \`{title, body}\` |\n| GET | /notes/:id | read |\n| DELETE | /notes/:id | delete |\n` },
    ],
    summary: `Built a zero-dependency Node JSON API (${pkg.name}) with CRUD routes for notes and node:test coverage.`,
    test: true,
  };
}

function dashboard(prompt: string) {
  const title = titleFrom(prompt, "Metrics");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} dashboard</title>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<main class="wrap">
  <header><div><p class="eyebrow">Dashboard</p><h1>${esc(title)}</h1></div><select id="range"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option></select></header>
  <section class="kpis" id="kpis"></section>
  <section class="panel"><h2>Daily active users</h2><svg id="chart" viewBox="0 0 600 200" preserveAspectRatio="none" role="img" aria-label="Daily active users"></svg></section>
  <section class="panel"><h2>Top channels</h2><table id="tbl"><thead><tr><th>Channel</th><th>Visits</th><th>Conv.</th></tr></thead><tbody></tbody></table></section>
</main>
<script src="data.js"></script>
<script src="app.js"></script>
</body>
</html>
`;
  const data = `// Deterministic sample data so the dashboard renders offline.
window.DATA = (() => {
  let s = 42; const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const days = Array.from({ length: 90 }, (_, i) => ({ day: i, dau: Math.round(1200 + i * 9 + r() * 260), signups: Math.round(40 + r() * 30), revenue: Math.round(800 + i * 6 + r() * 300) }));
  const channels = [["Organic", 48210, 3.1], ["Referral", 21944, 4.8], ["Social", 17310, 1.9], ["Email", 9102, 6.2], ["Paid", 6420, 2.4]];
  return { days, channels };
})();
`;
  const js = `const fmt = new Intl.NumberFormat("en-US");
function render(n) {
  const days = window.DATA.days.slice(-n);
  const sum = (k) => days.reduce((a, d) => a + d[k], 0);
  const kpis = [["Avg DAU", fmt.format(Math.round(sum("dau") / n))], ["Signups", fmt.format(sum("signups"))], ["Revenue", "$" + fmt.format(sum("revenue"))], ["Days", n]];
  document.getElementById("kpis").innerHTML = kpis.map(([k, v]) => \`<div class="kpi"><p>\${k}</p><strong>\${v}</strong></div>\`).join("");
  const max = Math.max(...days.map((d) => d.dau)), min = Math.min(...days.map((d) => d.dau));
  const pts = days.map((d, i) => [(i / (n - 1)) * 600, 190 - ((d.dau - min) / (max - min || 1)) * 170]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  document.getElementById("chart").innerHTML = \`<path d="\${line} L600 200 L0 200 Z" fill="rgba(217,255,90,.10)"/><path d="\${line}" fill="none" stroke="#d9ff5a" stroke-width="2" vector-effect="non-scaling-stroke"/>\`;
  document.querySelector("#tbl tbody").innerHTML = window.DATA.channels.map(([c, v, cv]) => \`<tr><td>\${c}</td><td>\${fmt.format(Math.round(v * n / 90))}</td><td>\${cv}%</td></tr>\`).join("");
}
document.getElementById("range").addEventListener("change", (e) => render(Number(e.target.value)));
render(30);
`;
  const css = `${BASE_CSS}
header{display:flex;justify-content:space-between;align-items:end;margin-bottom:28px}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8a8a84;margin:0}
h1{font-size:36px;letter-spacing:-.02em;margin:4px 0 0}
select{background:#141416;border:1px solid #26262a;color:#ecebe6;border-radius:10px;padding:8px 10px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:12px}
.kpi,.panel{background:#121214;border:1px solid #222226;border-radius:16px;padding:18px 20px}
.kpi p{margin:0;color:#8a8a84;font-size:13px}.kpi strong{font-size:28px;letter-spacing:-.02em}
.panel{margin-bottom:12px}.panel h2{font-size:14px;color:#a3a39c;margin:0 0 14px;font-weight:500}
svg{width:100%;height:200px;display:block}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 0;border-bottom:1px solid #1f1f22}
th{color:#5c5c57;font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.08em}td:not(:first-child),th:not(:first-child){text-align:right}
`;
  return {
    files: [
      { path: "index.html", content: html },
      { path: "styles.css", content: css },
      { path: "data.js", content: data },
      { path: "app.js", content: js },
      { path: "README.md", content: `# ${title} dashboard\n\nStatic dashboard with KPI tiles, an SVG area chart and a channel table. No build step — open \`index.html\`.\n` },
    ],
    summary: `Built a static ${title} dashboard: KPI tiles, range selector, SVG area chart and channel table, all dependency-free.`,
  };
}

export function planOffline(prompt: string, systemPrompt: string): PlannedCall[] {
  const p = `${prompt}`.toLowerCase();
  const sys = systemPrompt.toLowerCase();
  let build;
  if (/\btodo|to-do|task list|checklist\b/.test(p)) build = todoApp(prompt);
  else if (/\bdashboard|metrics|analytics|kpi|chart\b/.test(p)) build = dashboard(prompt);
  else if (/\bapi\b|endpoint|rest|server|backend|service\b/.test(p)) build = apiService(prompt);
  else if (/\bapi\b|backend/.test(sys)) build = apiService(prompt);
  else if (/dashboard/.test(sys)) build = dashboard(prompt);
  else build = landingPage(prompt);

  const calls: PlannedCall[] = [{ tool: "list_files", args: {} }];
  for (const f of build.files) calls.push({ tool: "write_file", args: f });
  if ("test" in build && build.test) calls.push({ tool: "run_shell", args: { command: "npm test" } });
  calls.push({ tool: "list_files", args: {} });
  calls.push({ tool: "finish", args: { summary: build.summary } });
  return calls;
}
