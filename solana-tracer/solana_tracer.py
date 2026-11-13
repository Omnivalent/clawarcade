#!/usr/bin/env python3
"""
Solana wallet tracer v2. Python 3.8+, standard library only, free RPC is enough.

Setup (once):
  export SOLANA_RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_FREE_KEY"
  (Public endpoint works but is slow and rate limited.)

Usage:
  python3 solana_tracer.py token  <MINT>    [--first 100] [--hop2] [--labels labels.csv]
  python3 solana_tracer.py wallet <ADDRESS> [--limit 300] [--trace-up 3] [--labels labels.csv]

TOKEN mode
  Reads the earliest transactions of a token, finds the real buyers, finds who
  first funded each buyer with SOL, and links wallets using EVIDENCE:
    STRONG  shared funder (non-hub), funded by the deployer or by another early buyer
    MEDIUM  funders that share an upstream funder (--hop2)
    SOFT    same hub-funded amount within a time window, same-slot buys
            (shown separately, merged only with --merge-soft)
  Clusters get a confidence from corroborating signals (identical funding
  amounts, funding/buy timing, shared slot, fresh wallets), plus % of supply
  bought in the window and % still held now.

WALLET mode
  Shows the funding chain upward (stops at hubs like exchanges), then the
  wallets it has exchanged SOL/tokens with, with first/last seen times.

labels.csv (optional): lines of  address,label  (label optional). Anything
listed is treated as a known entity (exchange, router, protocol) and never
merges clusters. Copy labels from Arkham/Solscan for hubs you identify.

Caching: transactions and funder lookups are cached in ~/.solana_tracer_cache
(set TRACER_CACHE=none to disable) so reruns cost almost no requests.

Clusters are leads, not proof. All addresses are printed in full.
"""
import argparse
import csv
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

RPC = os.environ.get("SOLANA_RPC", "https://api.mainnet-beta.solana.com")
WORKERS = int(os.environ.get("TRACER_WORKERS", "4"))
MAX_RPS = float(os.environ.get("TRACER_RPS", "8"))
CACHE = os.environ.get("TRACER_CACHE", os.path.expanduser("~/.solana_tracer_cache"))
MIN_FUND_SOL = 0.01  # ignore dust when looking for the funder
B58 = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")

_rl_lock = threading.Lock()
_rl_last = [0.0]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def throttle():
    gap = 1.0 / max(MAX_RPS, 0.1)
    with _rl_lock:
        wait = _rl_last[0] + gap - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _rl_last[0] = time.monotonic()


def rpc(method, params, retries=6):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for i in range(retries):
        throttle()
        try:
            req = urllib.request.Request(RPC, body, {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:
                out = json.load(r)
            if "error" in out:
                err = out["error"]
                if err.get("code") == 429 or "rate" in str(err).lower():
                    time.sleep(1.5 * (i + 1))
                    continue
                raise ValueError(f"{method}: {err}")
            return out["result"]
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise RuntimeError(f"RPC refused the request (HTTP {e.code}). Check your SOLANA_RPC key/plan.")
            if e.code in (429, 502, 503, 504):
                time.sleep(1.5 * (i + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"RPC failed after {retries} tries: {method}")


# ------------------------------------------------------------------ caching
def _cpath(kind, key):
    return os.path.join(CACHE, kind, re.sub(r"[^A-Za-z0-9_.-]", "_", key) + ".json")


def cache_get(kind, key):
    if CACHE.lower() == "none":
        return None
    try:
        with open(_cpath(kind, key)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def cache_put(kind, key, val):
    if CACHE.lower() == "none":
        return
    try:
        p = _cpath(kind, key)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = p + f".{threading.get_ident()}.tmp"
        with open(tmp, "w") as f:
            json.dump(val, f)
        os.replace(tmp, p)
    except OSError:
        pass


def pmap(fn, items):
    def safe(x):
        try:
            return fn(x)
        except Exception as e:  # keep going on single failures
            log(f"  ! {type(e).__name__}: {e}")
            return None
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        return list(ex.map(safe, items))


# ---------------------------------------------------------------- rpc helpers
def all_sigs(addr, max_pages):
    """Signatures newest->oldest. Returns (sigs, reached_oldest)."""
    out, before = [], None
    for _ in range(max_pages):
        opts = {"limit": 1000}
        if before:
            opts["before"] = before
        page = rpc("getSignaturesForAddress", [addr, opts])
        out += page
        if len(page) < 1000:
            return out, True
        before = page[-1]["signature"]
    return out, False


TX_VERSION = [1]  # highest tx version we ask for; raised automatically if the chain has newer ones
FAILED_TX = []     # signatures that could not be downloaded (reported in the output)


def get_tx(sig):
    c = cache_get("tx", sig)
    if c is not None:
        return c
    for _ in range(3):
        try:
            tx = rpc("getTransaction", [sig, {"encoding": "jsonParsed",
                                              "maxSupportedTransactionVersion": TX_VERSION[0]}])
            break
        except ValueError as e:
            # -32015: "Transaction version (N) is not supported ... maxSupportedTransactionVersion: N"
            m = re.search(r"-32015.*?version \((\d+)\)", str(e))
            if not m or int(m.group(1)) <= TX_VERSION[0]:
                FAILED_TX.append(sig)
                raise
            TX_VERSION[0] = int(m.group(1))
    else:
        FAILED_TX.append(sig)
        raise RuntimeError(f"getTransaction kept failing for {sig}")
    if tx is not None:
        cache_put("tx", sig, tx)
    return tx


def keys_full(tx):
    out = []
    for k in tx["transaction"]["message"]["accountKeys"]:
        out.append(k if isinstance(k, dict) else {"pubkey": k, "signer": False})
    return out


def keys_of(tx):
    return [k["pubkey"] for k in keys_full(tx)]


def signers_of(tx):
    return [k["pubkey"] for k in keys_full(tx) if k.get("signer")]


def token_deltas(tx, mint):
    """owner -> change in balance of `mint` in this tx."""
    meta = tx.get("meta") or {}
    d = defaultdict(float)
    for b in meta.get("preTokenBalances") or []:
        if b.get("mint") == mint and b.get("owner"):
            d[b["owner"]] -= float(b["uiTokenAmount"].get("uiAmountString") or 0)
    for b in meta.get("postTokenBalances") or []:
        if b.get("mint") == mint and b.get("owner"):
            d[b["owner"]] += float(b["uiTokenAmount"].get("uiAmountString") or 0)
    return d


def edges(tx):
    """Transfers in a tx: list of (asset, from, to, amount). asset is 'SOL' or a mint."""
    msg = tx["transaction"]["message"]
    meta = tx.get("meta") or {}
    keys = keys_of(tx)
    acct = {}  # token account -> (owner, mint, decimals)
    for b in (meta.get("preTokenBalances") or []) + (meta.get("postTokenBalances") or []):
        acct[keys[b["accountIndex"]]] = (b.get("owner"), b["mint"], b["uiTokenAmount"].get("decimals", 0))
    inss = list(msg["instructions"])
    for ii in meta.get("innerInstructions") or []:
        inss += ii["instructions"]
    out = []
    for ins in inss:
        p = ins.get("parsed")
        if not isinstance(p, dict):
            continue
        prog, t, info = ins.get("program"), p.get("type"), p.get("info", {})
        if prog == "system" and t == "transfer":
            out.append(("SOL", info["source"], info["destination"], info["lamports"] / 1e9))
        elif prog in ("spl-token", "spl-token-2022") and t in ("transfer", "transferChecked"):
            s, d = acct.get(info.get("source")), acct.get(info.get("destination"))
            if s and d and s[0] and d[0] and s[0] != d[0]:
                if "tokenAmount" in info:
                    amt = float(info["tokenAmount"].get("uiAmountString") or 0)
                else:
                    amt = int(info.get("amount", 0)) / (10 ** s[2])
                out.append((s[1], s[0], d[0], amt))
    return out


def find_funder(wallet, pages=3):
    """First meaningful incoming SOL transfer among the wallet's oldest txs.
    Returns dict or None. Cached only when the true oldest history was reached."""
    c = cache_get("funder", wallet)
    if c is not None:
        return None if c.get("none") else c
    sigs, reached = all_sigs(wallet, pages)
    sigs = [s for s in sigs if not s.get("err")]
    res = None
    for s in reversed(sigs[-6:]):  # oldest first
        tx = get_tx(s["signature"])
        if not tx:
            continue
        for asset, src, dst, amt in edges(tx):
            if asset == "SOL" and dst == wallet and amt >= MIN_FUND_SOL:
                res = {"funder": src, "sol": amt, "sig": s["signature"], "slot": tx["slot"],
                       "time": tx.get("blockTime"), "oldest_reached": reached}
                break
        if res:
            break
    if reached:
        cache_put("funder", wallet, res if res else {"none": True})
    elif not res:
        DEEP.add(wallet)  # too many txs to reach its start: funder unknown, not "none"
    return res


DEEP = set()  # wallets whose history was too deep to find the original funder


def is_hub(addr, thr):
    """High-volume address (exchange hot wallet, router, bot): a full page of sigs."""
    c = cache_get("hub", f"{addr}_{thr}")
    if c is not None:
        return c["hub"]
    page = rpc("getSignaturesForAddress", [addr, {"limit": thr}])
    h = len(page) >= thr
    cache_put("hub", f"{addr}_{thr}", {"hub": h})
    return h


def current_balance(wallet, mint):
    r = rpc("getTokenAccountsByOwner", [wallet, {"mint": mint}, {"encoding": "jsonParsed"}])
    return sum(float(x["account"]["data"]["parsed"]["info"]["tokenAmount"].get("uiAmountString") or 0)
               for x in r["value"])


def ts(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d %H:%M:%S") if t else "?"


def load_labels(path):
    out = {}
    if not path:
        return out
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split(",", 1)]
            out[parts[0]] = parts[1] if len(parts) > 1 and parts[1] else "labeled"
    return out


_B58A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_P = 2 ** 255 - 19
_D = (-121665 * pow(121666, _P - 2, _P)) % _P


def b58decode(s):
    n = 0
    for ch in s:
        n = n * 58 + _B58A.index(ch)  # ValueError on bad char
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\0" * (len(s) - len(s.lstrip("1"))) + raw


def on_curve(addr):
    """True if addr is a valid ed25519 point (a normal wallet key). Program-derived
    addresses (pools, bonding curves, vault authorities) are OFF the curve by design.
    Uses the RFC 8032 point-decompression test; unknown input counts as wallet."""
    try:
        b = b58decode(addr)
    except ValueError:
        return True
    if len(b) != 32:
        return True
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    if y >= _P:
        return False
    u = (y * y - 1) % _P
    v = (_D * y * y + 1) % _P
    x = (u * pow(v, 3, _P) * pow(u * pow(v, 7, _P), (_P - 5) // 8, _P)) % _P
    vxx = (v * x * x) % _P
    return vxx == u or vxx == (-u) % _P


def b58encode(b):
    n, out = int.from_bytes(b, "big"), ""
    while n:
        n, r = divmod(n, 58)
        out = _B58A[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + out


def find_pda(seeds, program):
    """Solana find_program_address: first bump (255 down) whose hash is off the curve."""
    import hashlib
    pb = b58decode(program)
    for bump in range(255, -1, -1):
        a = b58encode(hashlib.sha256(b"".join(seeds) + bytes([bump]) + pb + b"ProgramDerivedAddress").digest())
        if not on_curve(a):
            return a
    return None


PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"


def pump_curve(mint):
    """pump.fun bonding curve for this mint, or None if it is not a pump.fun coin.
    Its history holds the launch and all pre-graduation trades, but nothing after graduation,
    so it reaches the start far faster than the mint on busy coins."""
    import base64
    curve = find_pda([b"bonding-curve", b58decode(mint)], PUMP_PROGRAM)
    acc = (rpc("getAccountInfo", [curve, {"encoding": "base64"}]) or {}).get("value")
    if not acc or acc.get("owner") != PUMP_PROGRAM:
        return None
    d = base64.b64decode(acc["data"][0])
    creator = b58encode(d[49:81]) if len(d) >= 81 else None
    # After graduation the creator field can point at a fee-sharing program account; only trust a real wallet.
    return {"curve": curve, "graduated": len(d) > 48 and d[48] == 1,
            "creator": creator if creator and on_curve(creator) else None}


class UF:
    def __init__(self):
        self.p = {}

    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[ra] = rb


def need_addr(x, what):
    if not B58.match(x):
        sys.exit(f"'{x}' does not look like a Solana {what} address (base58, 32-44 chars).")


# ----------------------------------------------------------------- token mode
def token_mode(a):
    mint, labels = a.mint, load_labels(a.labels)
    a.first = max(1, a.first)
    notes = []
    pump = None
    if not a.source and not getattr(a, "no_auto_source", False):
        try:
            pump = pump_curve(mint)
        except Exception as e:
            log(f"  (could not check for a pump.fun bonding curve: {e})")
    source = a.source or (pump["curve"] if pump else mint)

    supply = None
    try:
        supply = float(rpc("getTokenSupply", [mint])["value"]["uiAmountString"])
    except Exception:
        notes.append("Could not read token supply, so no % of supply figures.")

    log(f"Fetching signatures for {source} ...")
    sigs, reached = all_sigs(source, a.pages)
    ok = [s for s in sigs if not s.get("err")]
    if not ok:
        sys.exit("No transactions found for that address. Check the mint/source address.")
    if not reached:
        notes.append(f"Did not reach the start of history in {a.pages} pages ({len(sigs)} sigs): these are the "
                     f"oldest I could reach, NOT the true first buyers. Raise --pages, or use --source with the "
                     f"bonding-curve/pool address.")
    early = ok[-a.first:][::-1]  # oldest first
    log(f"Parsing {len(early)} earliest transactions ...")
    txs = pmap(lambda s: get_tx(s["signature"]), early)
    missing = sum(1 for t in txs if not t)
    if missing:
        notes.append(f"{missing} of {len(early)} early transactions could not be downloaded; buyers in them "
                     f"are missing from this report.")

    events, infra = {}, set()
    cosign = []  # (signers, sig) of early txs signed by 2+ keys
    bought, sold = Counter(), Counter()
    t0_slot = t0_time = deployer = None
    if not txs[0]:
        notes.append("The oldest transaction could not be downloaded, so deployer and launch timing are unknown.")
    for i, (s, tx) in enumerate(zip(early, txs)):
        if not tx:
            continue
        if i == 0 and reached:  # only the true first tx defines deployer / launch time
            t0_slot, t0_time = tx["slot"], tx.get("blockTime")
            deployer = keys_of(tx)[0]
        signers = set(signers_of(tx))
        if len(signers - {mint}) >= 2:
            cosign.append((sorted(signers - {mint}), s["signature"]))
        for owner, v in token_deltas(tx, mint).items():
            if abs(v) < 1e-12:
                continue
            if v < 0 and owner not in signers:
                infra.add(owner)  # balance fell without signing: pool/vault/PDA
            if owner in signers:
                if v > 0:
                    bought[owner] += v
                else:
                    sold[owner] += -v
            if v > 0 and owner not in events:
                events[owner] = {"wallet": owner, "side": "BUY" if owner in signers else "RECV",
                                 "slot": tx["slot"], "time": tx.get("blockTime"), "sig": s["signature"],
                                 "first_amount": v}
    for w in infra:
        events.pop(w, None)
    for w in [w for w, e in events.items() if e["side"] == "RECV" and not on_curve(w)]:
        events.pop(w)  # program-controlled (pool/curve/vault) that only received tokens
    for w, e in events.items():
        e["bought"] = bought.get(w, 0.0) + (e["first_amount"] if e["side"] == "RECV" else 0.0)
        e["sold"] = sold.get(w, 0.0)
        e["rel_slot"] = e["slot"] - t0_slot if t0_slot is not None else None
        e["rel_sec"] = (e["time"] - t0_time) if (e["time"] and t0_time) else None

    order = sorted(events, key=lambda w: (events[w]["slot"], events[w]["time"] or 0))
    wallets = order[: a.max_wallets]
    if len(order) > len(wallets):
        notes.append(f"{len(order)} early wallets found, analysing the first {len(wallets)} (--max-wallets).")
    if deployer and deployer not in wallets:
        wallets.append(deployer)
    wset = set(wallets)

    log(f"Tracing funders for {len(wallets)} wallets ...")
    funds = dict(zip(wallets, pmap(find_funder, wallets)))
    uncertain = [w for w, f in funds.items() if f and not f["oldest_reached"]]
    if uncertain:
        notes.append(f"{len(uncertain)} wallets have deeper history than scanned; their funder may not be the "
                     f"original one (marked '?').")

    by_funder = defaultdict(list)
    for w, f in funds.items():
        if f:
            by_funder[f["funder"]].append(w)

    # hub detection
    hubs = {}
    to_check = [F for F, ws in by_funder.items() if F not in labels and F not in wset and (len(ws) >= 2 or a.hop2)]
    log(f"Checking {len(to_check)} funders for exchange/router behaviour ...")
    for F, h in zip(to_check, pmap(lambda x: is_hub(x, a.hub_threshold), to_check)):
        hubs[F] = bool(h)
    for F in by_funder:
        if F in labels:
            hubs[F] = True

    tags = {w: [] for w in wallets}
    for w in wallets:
        e = events.get(w)
        if w == deployer:
            tags[w].append("DEPLOYER")
        if e and e["rel_slot"] is not None and w != deployer:
            if e["rel_slot"] <= a.snipe_slots:
                tags[w].append("SNIPER")
            elif e["rel_sec"] is not None and e["rel_sec"] <= 60:
                tags[w].append("EARLY<60s")
        f = funds.get(w)
        if e and f and f.get("time") and e.get("time") and 0 <= e["time"] - f["time"] <= 1800:
            tags[w].append("FRESH")
        if f and not f["oldest_reached"]:
            tags[w].append("FUNDER?")
        if w in DEEP:
            tags[w].append("BUSY-WALLET")

    busy = [w for w in wallets if w in DEEP]
    if busy:
        notes.append(f"{len(busy)} wallets have 3000+ txs (bots/serial traders); their original funder was not "
                     f"reached (tagged BUSY-WALLET, funder shown as unknown).")

    # ---- evidence edges: (a, b, strength, text)
    ev = []
    for sg, sig in cosign:  # two keys signing one tx = one operator holds both keys
        ws = [x for x in sg if x in wset]
        for w in ws[1:]:
            ev.append((ws[0], w, "strong", f"co-signed the same transaction {sig}"))
    for F, ws in by_funder.items():
        if F in wset:
            for w in ws:
                ev.append((w, F, "strong", "funded by " + ("the DEPLOYER " if F == deployer else "another early wallet ") + F))
        if len(ws) >= 2 and not hubs.get(F) and F not in wset:
            for w in ws[1:]:
                ev.append((ws[0], w, "strong", f"shared funder {F}"))
    for F, ws in by_funder.items():
        if hubs.get(F) and len(ws) >= 2:
            groups = defaultdict(list)
            for w in ws:
                groups[round(funds[w]["sol"], 3)].append(w)
            for amt, g in groups.items():
                g.sort(key=lambda w: funds[w].get("time") or 0)
                for x, y in zip(g, g[1:]):
                    dt = abs((funds[x].get("time") or 0) - (funds[y].get("time") or 0))
                    if dt <= a.hub_window:
                        lab = labels.get(F, "high-volume hub")
                        ev.append((x, y, "soft", f"both funded {amt} SOL by {lab} {F} within {int(dt)}s"))
    slot_groups = defaultdict(list)
    for w in wallets:
        if w in events:
            slot_groups[events[w]["slot"]].append(w)
    for sl, ws in slot_groups.items():
        for w in ws[1:]:
            ev.append((ws[0], w, "soft", f"bought in the same slot {sl}"))

    if a.hop2:
        up_funders = [F for F in by_funder if not hubs.get(F) and F not in wset]
        log(f"Hop 2: tracing funders of {len(up_funders)} funders ...")
        ups = dict(zip(up_funders, pmap(find_funder, up_funders)))
        by_up = defaultdict(list)
        for F, f in ups.items():
            if f:
                by_up[f["funder"]].append(F)
        up_check = [U for U, fl in by_up.items() if len(fl) >= 2 and U not in labels]
        for U, h in zip(up_check, pmap(lambda x: is_hub(x, a.hub_threshold), up_check)):
            hubs[U] = bool(h)
        for U, fl in by_up.items():
            if len(fl) >= 2 and not hubs.get(U) and U not in labels:
                allw = [w for F in fl for w in by_funder[F]]
                for w in allw[1:]:
                    ev.append((allw[0], w, "medium", f"funders share upstream funder {U}"))

    uf = UF()
    for x, y, st, _ in ev:
        if st in ("strong", "medium") or (st == "soft" and a.merge_soft):
            uf.union(x, y)
    comps = defaultdict(set)
    for x, y, st, _ in ev:
        if st in ("strong", "medium") or (st == "soft" and a.merge_soft):
            comps[uf.find(x)].update([x, y])

    cl_edges = defaultdict(list)
    for x, y, st, txt in ev:
        if st in ("strong", "medium") or (st == "soft" and a.merge_soft):
            cl_edges[uf.find(x)].append((st, txt))

    members_all = sorted({m for ms in comps.values() for m in ms})
    log(f"Reading current balances for {len(members_all)} clustered wallets ...")
    bals = dict(zip(members_all, pmap(lambda w: current_balance(w, mint), members_all)))

    def corro(ms):
        c = []
        amts = [round(funds[m]["sol"], 3) for m in ms if funds.get(m)]
        if amts:
            top, cnt = Counter(amts).most_common(1)[0]
            if cnt >= 2 and cnt / len(ms) >= 0.5:
                c.append(f"identical funding amount {top} SOL x{cnt}")
        ft = [funds[m]["time"] for m in ms if funds.get(m) and funds[m].get("time")]
        if len(ft) >= 2 and max(ft) - min(ft) <= 3600:
            c.append("funded within 1h of each other")
        bt = [events[m]["time"] for m in ms if m in events and events[m].get("time")]
        if len(bt) >= 2 and max(bt) - min(bt) <= 60:
            c.append("first buys within 60s of each other")
        sl = Counter(events[m]["slot"] for m in ms if m in events)
        if sl and sl.most_common(1)[0][1] >= 2:
            c.append("2+ members bought in the same slot")
        if sum(1 for m in ms if "FRESH" in tags.get(m, [])) >= max(2, len(ms) / 2):
            c.append("most members funded <30 min before buying")
        return c

    clusters = []
    for root, ms in comps.items():
        ms = sorted(ms, key=lambda w: (events[w]["slot"] if w in events else 0))
        evs = cl_edges[root]
        has_strong = any(st == "strong" for st, _ in evs)
        cs = corro(ms)
        conf = "HIGH" if len(cs) >= 3 else "MEDIUM" if len(cs) == 2 else "LOW"
        if not has_strong and conf == "HIGH":
            conf = "MEDIUM"
        bought_sum = sum(events[m]["bought"] for m in ms if m in events)
        held = [bals[m] for m in ms if bals.get(m) is not None]
        clusters.append({"members": ms, "confidence": conf, "corroboration": cs,
                         "evidence": sorted({t for _, t in evs}),
                         "bought_in_window": bought_sum,
                         "bought_pct_supply": (100 * bought_sum / supply) if supply else None,
                         "held_now": sum(held) if held else None,
                         "held_pct_supply": (100 * sum(held) / supply) if (supply and held) else None})
    clusters.sort(key=lambda c: (-(c["held_pct_supply"] or 0), -len(c["members"])))

    # ---- report
    print(f"\n=== TOKEN {mint} ===")
    if source != mint:
        print(f"History source: {source}")
    if pump:
        print(f"pump.fun bonding curve (auto source): {pump['curve']}  "
              f"{'graduated to a pool' if pump['graduated'] else 'still on the curve'}")
    print(f"Deployer (first tx signer): {deployer if deployer else 'unknown (start of history not reached, or first tx unavailable)'}")
    if pump and pump["creator"] and deployer and pump["creator"] != deployer:
        print(f"NOTE: the bonding curve lists creator {pump['creator']}, which differs from the first tx signer.")
    if deployer and deployer in events:
        e = events[deployer]
        pct = f" ({100 * e['bought'] / supply:.2f}% of supply)" if supply else ""
        print(f"Deployer bought {e['bought']:,.2f}{pct} in the launch window, sold {e['sold']:,.2f}, "
              f"first buy tx {e['sig']}")
    if supply:
        print(f"Supply: {supply:,.2f}")
    print(f"Early wallets analysed: {len(wallets)}   hubs flagged: {sum(1 for v in hubs.values() if v)}")
    for n in notes:
        print(f"NOTE: {n}")

    print("\n--- CLUSTERS (strong/medium evidence) ---" + (" [soft links merged]" if a.merge_soft else ""))
    if not clusters:
        print("none")
    for i, c in enumerate(clusters, 1):
        pct_b = f"{c['bought_pct_supply']:.2f}%" if c["bought_pct_supply"] is not None else "n/a"
        pct_h = f"{c['held_pct_supply']:.2f}%" if c["held_pct_supply"] is not None else "n/a"
        print(f"\nCLUSTER {i}: {len(c['members'])} wallets   confidence {c['confidence']}   "
              f"bought in window {pct_b} of supply   still holding {pct_h}")
        for t in c["evidence"]:
            print(f"   evidence: {t}")
        for t in c["corroboration"]:
            print(f"   + {t}")
        for m in c["members"]:
            e, f, b = events.get(m), funds.get(m), bals.get(m)
            line = f"   {m}  [{' '.join(tags.get(m, [])) or '-'}]"
            if e:
                line += f"  bought {e['bought']:.2f} sold {e['sold']:.2f} @ {ts(e['time'])} slot {e['slot']}"
            if f:
                line += f"  funded {f['sol']:.3f} SOL by {f['funder']}"
            if b is not None:
                line += f"  now holds {b:.2f}"
            print(line)

    print("\n--- SOFT LINKS (not merged: weaker evidence) ---")
    in_cluster = {m: i for i, c in enumerate(clusters) for m in c["members"]}
    soft = [(x, y, t) for x, y, st, t in ev if st == "soft" and not a.merge_soft
            and not (x in in_cluster and in_cluster.get(x) == in_cluster.get(y))]
    if not soft:
        print("none")
    seen = set()
    for x, y, t in soft:
        if (x, y, t) in seen:
            continue
        seen.add((x, y, t))
        print(f"{x}\n   <-> {y}\n   {t}")

    print("\n--- LAUNCH SNIPERS (bought within " + str(a.snipe_slots) + " slots of the first tx) ---")
    sn = [w for w in wallets if "SNIPER" in tags.get(w, [])]
    if not sn:
        print("none" if t0_slot is not None else "unknown (start of history not reached or first tx missing)")
    for w in sn:
        f = funds.get(w)
        print(f"{w}  slot +{events[w]['rel_slot']}  funder: {f['funder'] if f else 'unknown'}")

    print("\n--- HUBS (exchanges/routers/bots, never merge clusters) ---")
    hl = [F for F, h in hubs.items() if h and F in by_funder]
    if not hl:
        print("none")
    for F in hl:
        print(f"{F}  {labels.get(F, 'unlabeled: check Arkham/Solscan and add to labels.csv')}  "
              f"funded {len(by_funder[F])} of the analysed wallets"
              + ("" if F in labels else "  (busy 1000+ txs: could also be a serial operator)"))

    clustered = {m for c in clusters for m in c["members"]}
    print(f"\nUnclustered wallets: {len([w for w in wallets if w not in clustered])} (all listed in the CSV)")

    base = f"trace_token_{mint[:6]}"
    cid = {m: i for i, c in enumerate(clusters, 1) for m in c["members"]}
    with open(base + ".csv", "w", newline="") as fh:
        wr = csv.writer(fh)
        wr.writerow(["wallet", "cluster", "tags", "side", "bought", "sold", "time_utc", "slot", "rel_slot",
                     "buy_sig", "funder", "funder_is_hub", "funded_sol", "funded_time_utc", "now_holds"])
        for w in wallets:
            e, f = events.get(w, {}), funds.get(w) or {}
            wr.writerow([w, cid.get(w, ""), " ".join(tags.get(w, [])), e.get("side", ""), e.get("bought", ""),
                         e.get("sold", ""), ts(e.get("time")), e.get("slot", ""), e.get("rel_slot", ""),
                         e.get("sig", ""), f.get("funder", ""), hubs.get(f.get("funder"), ""), f.get("sol", ""),
                         ts(f.get("time")) if f else "", bals.get(w, "")])
    with open(base + ".json", "w") as fh:
        json.dump({"mint": mint, "source": source, "pump": pump, "deployer": deployer, "supply": supply, "notes": notes,
                   "clusters": clusters, "events": events, "funders": funds, "hubs": hubs,
                   "edges": [{"a": x, "b": y, "strength": st, "evidence": t} for x, y, st, t in ev]},
                  fh, indent=1)
    print(f"\nSaved {base}.csv and {base}.json")


# ---------------------------------------------------------------- wallet mode
def wallet_mode(a):
    w, labels = a.address, load_labels(a.labels)

    log(f"Tracing funding chain up from {w} ...")
    chain, seen, cur = [], {w}, w
    for _ in range(a.trace_up):
        f = find_funder(cur)
        if not f:
            break
        fa = f["funder"]
        hub = fa in labels or is_hub(fa, a.hub_threshold)
        chain.append({"wallet": cur, "funder": fa, "sol": f["sol"], "time": f["time"], "hub": hub,
                      "uncertain": not f["oldest_reached"]})
        if hub or fa in seen:
            break
        seen.add(fa)
        cur = fa

    log(f"Fetching last {a.limit} signatures ...")
    sigs = rpc("getSignaturesForAddress", [w, {"limit": min(a.limit, 1000)}])
    sigs = [s for s in sigs if not s.get("err")]
    txs = pmap(lambda s: get_tx(s["signature"]), sigs)
    cp = defaultdict(lambda: {"sent_sol": 0.0, "recv_sol": 0.0, "txs": set(), "tokens": Counter(),
                              "first": None, "last": None})
    parsed = 0
    for s, tx in zip(sigs, txs):
        if not tx:
            continue
        parsed += 1
        t = tx.get("blockTime")
        for asset, src, dst, amt in edges(tx):
            if src != w and dst != w:
                continue
            other = dst if src == w else src
            if other == w:
                continue
            c = cp[other]
            c["txs"].add(s["signature"])
            if t:
                c["first"] = t if c["first"] is None else min(c["first"], t)
                c["last"] = t if c["last"] is None else max(c["last"], t)
            if asset == "SOL":
                c["sent_sol" if src == w else "recv_sol"] += amt
            else:
                c["tokens"][asset] += 1
    infra = {k for k, v in cp.items() if parsed >= 20 and len(v["txs"]) / parsed > 0.25}

    progs = {k for k in cp if k not in infra and not on_curve(k)}  # pools, bonding curves, vaults
    rank = sorted((k for k in cp if k not in infra and k not in progs),
                  key=lambda k: -(cp[k]["sent_sol"] + cp[k]["recv_sol"] + len(cp[k]["txs"]) * 0.001))
    top = rank[: a.top]
    hub_flags = dict(zip(top, pmap(lambda x: x in labels or is_hub(x, a.hub_threshold), top)))

    print(f"\n=== WALLET {w} ===")
    print(f"Transactions parsed: {parsed} (most recent)")
    print("\n--- Funding chain (upstream) ---")
    if not chain:
        print("no meaningful incoming SOL found")
    for i, c in enumerate(chain, 1):
        tag = ("  [known entity: stop]" if c["funder"] in labels else
               "  [BUSY 1000+ txs: exchange, bot OR serial operator; stop, check manually]") if c["hub"] else ""
        tag += "  [history deeper than scanned, funder may not be original]" if c["uncertain"] else ""
        print(f"{i}. {c['wallet']}\n   funded {c['sol']:.3f} SOL by {c['funder']}  @ {ts(c['time'])}"
              f"{tag}{'  ' + labels[c['funder']] if c['funder'] in labels else ''}")

    print("\n--- Connected wallets ---")
    if not top:
        print("none")
    for k in top:
        c = cp[k]
        tk = f"  token moves: {sum(c['tokens'].values())} ({len(c['tokens'])} mints)" if c["tokens"] else ""
        flag = ("  [known entity: weak link]" if k in labels else
                "  [BUSY 1000+ txs: exchange, bot OR serial operator]") if hub_flags.get(k) else ""
        lab = f"  {labels[k]}" if k in labels else ""
        print(f"{k}{flag}{lab}\n   txs: {len(c['txs'])}  sent: {c['sent_sol']:.3f} SOL  "
              f"received: {c['recv_sol']:.3f} SOL  first {ts(c['first'])}  last {ts(c['last'])}{tk}")

    print("\n--- Program accounts traded with (pools / bonding curves, not wallets) ---")
    if not progs:
        print("none")
    for k in sorted(progs, key=lambda k: -(cp[k]["sent_sol"] + cp[k]["recv_sol"]))[:10]:
        print(f"{k}  txs: {len(cp[k]['txs'])}  sent: {cp[k]['sent_sol']:.3f} SOL  received: {cp[k]['recv_sol']:.3f} SOL")

    print("\n--- In >25% of txs (DEX/tip/router infra, ignore) ---")
    if not infra:
        print("none")
    for k in sorted(infra, key=lambda k: -len(cp[k]["txs"]))[:10]:
        print(f"{k}  in {len(cp[k]['txs'])} txs")

    base = f"trace_wallet_{w[:6]}"
    with open(base + ".csv", "w", newline="") as fh:
        wr = csv.writer(fh)
        wr.writerow(["counterparty", "txs", "sent_sol", "received_sol", "token_moves", "first_utc", "last_utc",
                     "likely_infra", "hub", "program_account"])
        for k, c in cp.items():
            wr.writerow([k, len(c["txs"]), c["sent_sol"], c["recv_sol"], sum(c["tokens"].values()),
                         ts(c["first"]), ts(c["last"]), k in infra, hub_flags.get(k, ""), k in progs])
    with open(base + ".json", "w") as fh:
        json.dump({"wallet": w, "chain": chain}, fh, indent=1)
    print(f"\nSaved {base}.csv and {base}.json")


def main():
    p = argparse.ArgumentParser(description="Solana wallet tracer v2")
    sub = p.add_subparsers(dest="mode", required=True)
    t = sub.add_parser("token")
    t.add_argument("mint")
    t.add_argument("--source", help="address whose history to scan instead of the mint "
                                    "(bonding curve / pool), useful when swaps don't reference the mint")
    t.add_argument("--no-auto-source", action="store_true",
                   help="scan the mint itself even if a pump.fun bonding curve is found")
    t.add_argument("--first", type=int, default=100, help="how many earliest txs to read")
    t.add_argument("--pages", type=int, default=60, help="max signature pages (1000 each) to walk back")
    t.add_argument("--max-wallets", type=int, default=80)
    t.add_argument("--hop2", action="store_true", help="also link wallets whose funders share a funder")
    t.add_argument("--merge-soft", action="store_true", help="also merge soft links into clusters")
    t.add_argument("--snipe-slots", type=int, default=10, help="slots after first tx that count as sniping")
    t.add_argument("--hub-window", type=int, default=3600, help="seconds for hub-funded same-amount links")
    t.add_argument("--hub-threshold", type=int, default=1000, help="sigs that make an address a hub")
    t.add_argument("--labels", help="csv of address,label for known entities")
    w = sub.add_parser("wallet")
    w.add_argument("address")
    w.add_argument("--limit", type=int, default=300)
    w.add_argument("--top", type=int, default=30)
    w.add_argument("--trace-up", type=int, default=3, help="funding chain hops upward")
    w.add_argument("--hub-threshold", type=int, default=1000)
    w.add_argument("--labels")
    a = p.parse_args()
    if a.mode == "token":
        need_addr(a.mint, "token mint")
        if a.source:
            need_addr(a.source, "source")
    else:
        need_addr(a.address, "wallet")
    try:
        token_mode(a) if a.mode == "token" else wallet_mode(a)
    except (RuntimeError, ValueError) as e:
        sys.exit(f"Error: {e}")


if __name__ == "__main__":
    main()
