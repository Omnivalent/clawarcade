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


# ------------------------------------------------------------------- pnl mode
WSOL = "So11111111111111111111111111111111111111112"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
SOL_USDC_POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"  # Orca Whirlpool SOL/USDC (deep, always busy)


def lamport_delta(tx, wallet):
    keys = keys_of(tx)
    if wallet not in keys:
        return 0.0
    i, m = keys.index(wallet), tx.get("meta") or {}
    return (m["postBalances"][i] - m["preBalances"][i]) / 1e9


def sol_usd_near(sig, samples=40):
    """SOL/USD at the time of `sig`, from swaps in a big SOL/USDC pool just before it (median)."""
    page = rpc("getSignaturesForAddress", [SOL_USDC_POOL, {"limit": samples, "before": sig}])
    prices = []
    for s, tx in zip(page, pmap(lambda s: get_tx(s["signature"]), [s for s in page if not s.get("err")])):
        if not tx:
            continue
        d = defaultdict(float)
        for side, sg in (("preTokenBalances", -1), ("postTokenBalances", 1)):
            for b in (tx.get("meta") or {}).get(side) or []:
                if b.get("owner") == SOL_USDC_POOL:
                    d[b["mint"]] += sg * float(b["uiTokenAmount"].get("uiAmountString") or 0)
        a, u = d.get(WSOL, 0.0), d.get(USDC, 0.0)
        if abs(a) > 0.01 and a * u < 0:
            prices.append(abs(u / a))
    prices.sort()
    return prices[len(prices) // 2] if len(prices) >= 3 else None


def owner_ata(owner, mint, token_program):
    return find_pda([b58decode(owner), b58decode(token_program), b58decode(mint)], ATA_PROGRAM)


def wallet_trades(wallet, mint, token_program, max_pages=3):
    """Every tx touching the wallet's associated token account for `mint` (works for closed accounts too).
    Returns list of dicts: kind BUY/SELL/XFER_IN/XFER_OUT, tokens, sol, sig, time, counterparty."""
    ata = owner_ata(wallet, mint, token_program)
    sigs, reached = all_sigs(ata, max_pages)
    sigs = [s for s in sigs if not s.get("err")][::-1]
    out = []
    for s, tx in zip(sigs, pmap(lambda s: get_tx(s["signature"]), sigs)):
        if not tx:
            continue
        td = token_deltas(tx, mint)
        tok = td.get(wallet, 0.0)
        if abs(tok) < 1e-9:
            continue
        sol = lamport_delta(tx, wallet) + token_deltas(tx, WSOL).get(wallet, 0.0)
        cp = [o for o, v in td.items() if o != wallet and v * tok < 0]
        if tok > 0:
            kind = "BUY" if sol < -0.003 else "XFER_IN"
        else:
            kind = "SELL" if sol > 0.003 else "XFER_OUT"
        out.append({"kind": kind, "tokens": abs(tok), "sol": sol, "sig": s["signature"],
                    "time": tx.get("blockTime"), "counterparty": cp[0] if (kind.startswith("XFER") and cp) else None})
    return out, reached, ata


def realized(trades):
    """Average-cost realized PnL in SOL. Tokens received for free (transfers in) count at zero cost
    and are flagged, because that inflates profit."""
    held = cost = spent = got = 0.0
    free_in = 0.0
    for t in trades:
        if t["kind"] == "BUY":
            held += t["tokens"]; cost += -t["sol"]; spent += -t["sol"]
        elif t["kind"] == "XFER_IN":
            held += t["tokens"]; free_in += t["tokens"]
        elif t["kind"] in ("SELL", "XFER_OUT"):
            q = min(t["tokens"], held) if held > 0 else 0.0
            basis = cost * (q / held) if held > 0 else 0.0
            held -= q; cost -= basis
            if t["kind"] == "SELL":
                got += t["sol"]
                t["pnl"] = t["sol"] - basis
    pnl = sum(t.get("pnl", 0.0) for t in trades)
    return {"realized_sol": pnl, "spent_sol": spent, "received_sol": got, "held_tokens": held,
            "free_tokens_in": free_in}


def pnl_mode(a):
    mint, labels = a.mint, load_labels(a.labels)
    notes = []
    supply_now = float(rpc("getTokenSupply", [mint])["value"]["uiAmountString"])
    macc = rpc("getAccountInfo", [mint, {"encoding": "jsonParsed"}])["value"]
    token_program = macc["owner"]
    pump = None if a.source else pump_curve(mint)
    source = a.source or (pump["curve"] if pump else mint)
    if not pump and not a.source:
        notes.append("Not a pump.fun coin: market cap is estimated from each buyer's own SOL spend (includes fees).")
    mc_supply = 1_000_000_000.0 if pump else supply_now  # pump.fun coins launch with 1B

    log(f"Fetching full history of {source} ...")
    sigs, reached = all_sigs(source, a.pages)
    if not reached:
        notes.append(f"History of {source} not fully reached in {a.pages} pages: early buyers may be missing.")
    ok = [s for s in sigs if not s.get("err")][::-1]
    log(f"Reading {len(ok)} trades ...")
    txs = pmap(lambda s: get_tx(s["signature"]), ok)

    sol_usd = a.sol_usd
    if not sol_usd and ok:
        log("Reading SOL/USD at launch from the SOL/USDC pool ...")
        sol_usd = sol_usd_near(ok[0]["signature"])
    if not sol_usd:
        sys.exit("Could not determine SOL/USD; pass --sol-usd PRICE")
    max_mc_sol = a.max_mc_usd / sol_usd

    first_buy, low_buys, cosign = {}, defaultdict(float), []
    for s, tx in zip(ok, txs):
        if not tx:
            continue
        td = token_deltas(tx, mint)
        signers = set(signers_of(tx))
        if len(signers - {mint}) >= 2:
            cosign.append((sorted(signers - {mint}), s["signature"]))
        price = None
        if pump:
            ct = td.get(pump["curve"], 0.0)
            cs = lamport_delta(tx, pump["curve"])
            if abs(ct) > 0 and cs * ct < 0:
                price = abs(cs / ct)
        for w, v in td.items():
            if v <= 0 or w not in signers or not on_curve(w):
                continue
            p = price
            if p is None:
                spent = -(lamport_delta(tx, w) + token_deltas(tx, WSOL).get(w, 0.0))
                p = spent / v if spent > 0 else None
            if p is None:
                continue
            mc = p * mc_supply
            if w not in first_buy:
                first_buy[w] = {"mc_sol": mc, "time": tx.get("blockTime"), "sig": s["signature"], "slot": tx["slot"]}
            if mc <= max_mc_sol:
                low_buys[w] += v
    cands = sorted(low_buys, key=lambda w: -low_buys[w])
    log(f"{len(cands)} wallets bought below ${a.max_mc_usd:,.0f} market cap ({max_mc_sol:.1f} SOL at "
        f"${sol_usd:.2f}/SOL)")
    if len(cands) > a.max_wallets:
        notes.append(f"{len(cands)} wallets bought below the cap; PnL computed for the {a.max_wallets} biggest "
                     f"low-cap buyers (--max-wallets).")
        cands = cands[: a.max_wallets]

    log(f"Reading every trade of {len(cands)} wallets in this token ...")
    res = {}
    for w, r in zip(cands, pmap(lambda w: wallet_trades(w, mint, token_program), cands)):
        if not r:
            continue
        trades, done, ata = r
        st = realized(trades)
        st.update({"trades": trades, "complete": done, "ata": ata, "low_cap_tokens": low_buys[w],
                   "first_buy": first_buy.get(w)})
        res[w] = st
    ranked = sorted(res, key=lambda w: -res[w]["realized_sol"])
    top = [w for w in ranked if res[w]["realized_sol"] > 0][: a.top]

    # ---- links between top wallets and their neighbours
    links = []  # (a, b, strength, text)
    tset = set(top)
    for sg, sig in cosign:
        ws = [x for x in sg if x in tset]
        for w in ws[1:]:
            links.append((ws[0], w, "strong", f"co-signed tx {sig}"))
    for w in top:
        for t in res[w]["trades"]:
            cp = t["counterparty"]
            if cp:
                prog = not on_curve(cp)
                links.append((w, cp, "strong" if cp in tset else ("soft" if prog else "lead"),
                              f"token transfer {'to' if t['kind'] == 'XFER_OUT' else 'from'} "
                              f"{cp} {t['tokens']:,.0f} tokens, tx {t['sig']}"
                              + (" (program account: pool/vault/bot, not a wallet)" if prog else "")))
    funds, chains = {}, {}
    if a.links and top:
        log(f"Tracing funders of {len(top)} top wallets ...")
        funds = dict(zip(top, pmap(find_funder, top)))
        byf = defaultdict(list)
        for w, f in funds.items():
            if f:
                byf[f["funder"]].append(w)
        for F, ws in byf.items():
            if F in tset:
                for w in ws:
                    links.append((w, F, "strong", f"{w} was funded by top wallet {F}"))
        hubs = {F: (F in labels or is_hub(F, a.hub_threshold)) for F, ws in byf.items() if len(ws) >= 2}
        for F, ws in byf.items():
            if len(ws) >= 2:
                for w in ws[1:]:
                    links.append((ws[0], w, "soft" if hubs.get(F) else "strong",
                                  f"shared funder {F}" + (" (busy 1000+ txs: exchange/bot/operator)" if hubs.get(F) else "")))
        log(f"Following funding chains up to {a.trace_up} hops ...")

        def chain_of(w):
            out, cur, f = [], w, funds.get(w)
            for hop in range(a.trace_up):
                if hop:
                    f = find_funder(cur)
                if not f:
                    break
                F = f["funder"]
                busy = F in labels or is_hub(F, a.hub_threshold)
                out.append({"addr": F, "sol": f["sol"], "time": f["time"], "sig": f["sig"], "busy": busy})
                if busy or F in tset:
                    break
                cur = F
            return out
        chains = dict(zip(top, pmap(chain_of, top)))
        at = defaultdict(list)  # address -> [(wallet, hop, step)]
        for w, ch in (chains or {}).items():
            for h, st in enumerate(ch or []):
                at[st["addr"]].append((w, h, st))
        for A, hits in at.items():
            ws = sorted({w for w, _, _ in hits})
            if len(ws) < 2:
                continue
            if all(h == 0 for _, h, _ in hits):
                continue  # direct shared funder: already reported
            first = {w: (h, st) for w, h, st in sorted(hits, key=lambda x: x[1])}
            busy = hits[0][2]["busy"]
            if not busy:
                for w in ws[1:]:
                    links.append((ws[0], w, "strong",
                                  f"funding chains meet at {A} (hop {first[ws[0]][0] + 1} and hop {first[w][0] + 1})"))
            else:  # busy root: only link identical amounts sent close together
                grp = defaultdict(list)
                for w in ws:
                    grp[round(first[w][1]["sol"], 2)].append(w)
                for amt, g in grp.items():
                    g.sort(key=lambda w: first[w][1]["time"] or 0)
                    for x, y in zip(g, g[1:]):
                        dt = abs((first[x][1]["time"] or 0) - (first[y][1]["time"] or 0))
                        if dt <= 900:
                            links.append((x, y, "medium",
                                          f"funding chains both start with exactly {amt} SOL from busy wallet {A} "
                                          f"{int(dt)}s apart (txs {first[x][1]['sig']} and {first[y][1]['sig']})"))
        log(f"Reading last {a.link_txs} txs of each top wallet for SOL counterparties ...")
        cps = {}
        for w in top:
            sg = [s for s in rpc("getSignaturesForAddress", [w, {"limit": a.link_txs}]) if not s.get("err")]
            c = defaultdict(lambda: {"sent": 0.0, "recv": 0.0, "n": 0})
            for tx in pmap(lambda s: get_tx(s["signature"]), sg):
                if not tx:
                    continue
                for asset, src, dst, amt in edges(tx):
                    if asset != "SOL" or w not in (src, dst) or src == dst:
                        continue
                    o = dst if src == w else src
                    if not on_curve(o) or amt < MIN_FUND_SOL:
                        continue
                    c[o]["sent" if src == w else "recv"] += amt
                    c[o]["n"] += 1
            cps[w] = c
        seen_by = defaultdict(list)
        for w, c in cps.items():
            for o, v in c.items():
                if o in tset and o != w:
                    links.append((w, o, "strong", f"direct SOL: {w} sent {v['sent']:.3f} / received {v['recv']:.3f} SOL"))
                elif o not in tset:
                    seen_by[o].append(w)
        shared = [o for o, ws in seen_by.items() if len(ws) >= 2]
        busy = {o: (o in labels or is_hub(o, a.hub_threshold)) for o in shared}
        for o in shared:
            ws = seen_by[o]
            tot = sum(cps[w][o]["sent"] for w in ws)
            links.append((ws[0], ws[1], "soft" if busy[o] else "medium",
                          f"{len(ws)} top wallets moved SOL with {o} (sent it {tot:.3f} SOL)"
                          + (" [busy 1000+ txs]" if busy[o] else "")))
            for w in ws[2:]:
                links.append((ws[0], w, "soft" if busy[o] else "medium", f"also moved SOL with {o}"))
        exits = {}
        for w, c in cps.items():
            outs = sorted(((o, v["sent"]) for o, v in c.items() if v["sent"] > 0 and o not in tset),
                          key=lambda x: -x[1])[:3]
            exits[w] = outs

    # ---- report
    usd = lambda s: f"${s * sol_usd:,.0f}"
    print(f"\n=== REALIZED PROFIT: {mint} ===")
    if pump:
        print(f"pump.fun bonding curve: {pump['curve']}  {'graduated' if pump['graduated'] else 'on curve'}")
    print(f"SOL/USD at launch: ${sol_usd:.2f}   cap filter: bought below ${a.max_mc_usd:,.0f} "
          f"(= {max_mc_sol:.1f} SOL market cap)")
    print(f"Wallets that bought below the cap: {len(low_buys)}   PnL computed for: {len(res)}")
    for n in notes:
        print(f"NOTE: {n}")
    print("NOTE: USD figures use the launch SOL price; sells at other times were worth more or less in USD.")

    print(f"\n--- TOP {len(top)} BY REALIZED PROFIT (SOL, average cost) ---")
    for i, w in enumerate(top, 1):
        r, fb = res[w], res[w]["first_buy"] or {}
        nb = sum(1 for t in r["trades"] if t["kind"] == "BUY")
        ns = sum(1 for t in r["trades"] if t["kind"] == "SELL")
        flag = []
        if r["free_tokens_in"]:
            flag.append(f"received {r['free_tokens_in']:,.0f} tokens for free (profit may be inflated)")
        if not r["complete"]:
            flag.append("token account history not fully read")
        print(f"\n{i}. {w}")
        print(f"   realized {r['realized_sol']:+.3f} SOL ({usd(r['realized_sol'])})   spent {r['spent_sol']:.3f}  "
              f"received {r['received_sol']:.3f} SOL   buys {nb} sells {ns}   still holds {r['held_tokens']:,.0f}")
        if fb:
            print(f"   first buy at {fb['mc_sol'] * sol_usd / 1000:,.1f}k USD market cap @ {ts(fb['time'])}  tx {fb['sig']}")
        if w in funds and funds[w]:
            print(f"   funded {funds[w]['sol']:.3f} SOL by {funds[w]['funder']} @ {ts(funds[w]['time'])}")
        elif w in DEEP:
            print("   funder: not reached (3000+ txs)")
        if len(chains.get(w) or []) > 1:
            print("   funding chain: " + " <- ".join(
                f"{c['addr']} ({c['sol']:.3f} SOL{', busy' if c['busy'] else ''})" for c in chains[w]))
        if a.links and exits.get(w):
            print("   sent SOL to: " + "; ".join(f"{o} {v:.3f} SOL" for o, v in exits[w]))
        for f in flag:
            print(f"   ! {f}")

    print("\n--- CONNECTIONS ---")
    if not a.links:
        print("(run with --links to trace funders and SOL counterparties)")
    strong = [l for l in links if l[2] in ("strong", "medium")]
    if not strong and not [l for l in links if l[2] in ("soft", "lead")]:
        print("none found")
    seen = set()
    for lv in ("strong", "medium", "lead", "soft"):
        rows = [l for l in links if l[2] == lv]
        if rows:
            print(f"\n[{lv.upper()}]")
        for x, y, _, t in rows:
            if (x, y, t) in seen:
                continue
            seen.add((x, y, t))
            print(f"{x}\n   <-> {y}\n   {t}")

    base = f"pnl_{mint[:6]}"
    with open(base + ".csv", "w", newline="") as fh:
        wr = csv.writer(fh)
        wr.writerow(["rank", "wallet", "realized_sol", "realized_usd_at_launch_price", "spent_sol", "received_sol",
                     "held_tokens", "first_buy_mc_usd", "first_buy_time_utc", "first_buy_sig", "funder",
                     "free_tokens_in", "history_complete"])
        for i, w in enumerate(ranked, 1):
            r, fb, f = res[w], res[w]["first_buy"] or {}, funds.get(w) or {}
            wr.writerow([i, w, round(r["realized_sol"], 6), round(r["realized_sol"] * sol_usd, 2),
                         round(r["spent_sol"], 6), round(r["received_sol"], 6), r["held_tokens"],
                         round(fb.get("mc_sol", 0) * sol_usd), ts(fb.get("time")), fb.get("sig", ""),
                         f.get("funder", ""), r["free_tokens_in"], r["complete"]])
    with open(base + ".json", "w") as fh:
        json.dump({"mint": mint, "source": source, "sol_usd": sol_usd, "max_mc_usd": a.max_mc_usd, "notes": notes,
                   "top": top, "wallets": res, "funders": funds, "chains": chains,
                   "generated": int(time.time()),
                   "links": [{"a": x, "b": y, "strength": s, "evidence": t} for x, y, s, t in links]}, fh, indent=1)
    print(f"\nSaved {base}.csv (all {len(ranked)} wallets ranked) and {base}.json")


# ----------------------------------------------------------------- sides mode
def load_kols(path):
    out = {}
    if path and os.path.exists(path):
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                if r.get("wallet"):
                    out[r["wallet"]] = r.get("name") or "KOL"
    return out


def recent_activity(w, n, max_pages=40, fetch_cap=800):
    """The wallet's own recent activity: txs it signed or whose balances it changed (copy-trade bots
    put popular wallets into thousands of their own txs, which are skipped). Returns SOL/token
    counterparties, real co-signers, earliest buy time per mint, txs kept, time span, noise share."""
    kept, fetched, before, pages = [], 0, None, 0
    while len(kept) < n and pages < max_pages and fetched < fetch_cap:
        opts = {"limit": 1000}
        if before:
            opts["before"] = before
        page = rpc("getSignaturesForAddress", [w, opts])
        pages += 1
        ok = [s for s in page if not s.get("err")]
        for i in range(0, len(ok), 100):
            chunk = ok[i:i + 100]
            for s, tx in zip(chunk, pmap(lambda s: get_tx(s["signature"]), chunk)):
                fetched += 1
                if not tx:
                    continue
                own = w in signers_of(tx) or abs(lamport_delta(tx, w)) > 0 or any(
                    b.get("owner") == w for b in (tx.get("meta") or {}).get("postTokenBalances") or [])
                if own:
                    kept.append((s, tx))
            if len(kept) >= n or fetched >= fetch_cap:
                break
        if len(page) < 1000:
            break
        before = page[-1]["signature"]
    kept = kept[:n]
    noise = 1 - len(kept) / fetched if fetched else 0.0
    cp = defaultdict(lambda: {"sent": 0.0, "recv": 0.0, "tok_out": 0, "tok_in": 0, "unsolicited": 0, "n": 0,
                              "sigs": []})
    cosig = defaultdict(list)
    buys = {}  # mint -> earliest buy time
    for s, tx in kept:
        sg = signers_of(tx)
        if w in sg:
            for k in sg:
                if k != w and on_curve(k):
                    cosig[k].append(s["signature"])
        for asset, src, dst, amt in edges(tx):
            if w not in (src, dst) or src == dst:
                continue
            o = dst if src == w else src
            if not on_curve(o):
                continue
            c = cp[o]
            if asset == "SOL":
                if amt < MIN_FUND_SOL:
                    continue
                c["sent" if src == w else "recv"] += amt
            elif src == w:
                c["tok_out"] += 1
            elif w in sg:
                c["tok_in"] += 1      # the wallet itself signed to receive: a deliberate move
            else:
                c["unsolicited"] += 1  # tokens pushed to it by someone else (airdrop spam)
            c["n"] += 1
            if len(c["sigs"]) < 3:
                c["sigs"].append(s["signature"])
        spent = -(lamport_delta(tx, w) + token_deltas(tx, WSOL).get(w, 0.0))
        if w in sg and spent > 0.003:  # a real buy: the wallet signed and paid SOL (airdrops are not buys)
            for b in (tx.get("meta") or {}).get("postTokenBalances") or []:
                m = b.get("mint")
                if b.get("owner") == w and m not in (WSOL, USDC):
                    d = token_deltas(tx, m).get(w, 0.0)
                    t = tx.get("blockTime") or 0
                    if d > 0 and (m not in buys or t < buys[m]):
                        buys[m] = t
    times = [tx.get("blockTime") for _, tx in kept if tx.get("blockTime")]
    span = (min(times), max(times)) if times else (None, None)
    return cp, cosig, buys, len(kept), span, noise


def sides_mode(a):
    kols = load_kols(a.kols)
    labels = load_labels(a.labels)
    targets = [a.wallet] if a.wallet else list(kols)[: a.max_kols]
    report = []
    for kw in targets:
        name = kols.get(kw, "wallet")
        log(f"\n### {name} {kw}")
        log(f"Reading last {a.kol_txs} txs ...")
        cp, cosig, kbuys, ntx, span, noise = recent_activity(kw, a.kol_txs)
        log("Following its funding chain ...")
        chain, cur = [], kw
        for _ in range(3):
            f = find_funder(cur)
            if not f:
                break
            F = f["funder"]
            busy = F in labels or is_hub(F, a.hub_threshold)
            chain.append({"addr": F, "sol": f["sol"], "time": f["time"], "sig": f["sig"], "busy": busy})
            if busy:
                break
            cur = F
        # candidates: biggest flows + all co-signers + non-busy chain members
        flow = lambda o: cp[o]["sent"] + cp[o]["recv"] + 0.5 * (cp[o]["tok_out"] + cp[o]["tok_in"])
        cands = sorted((o for o in cp if flow(o) > 0), key=lambda o: -flow(o))[: a.candidates]
        spam_in = sorted(o for o in cp if flow(o) == 0 and cp[o]["unsolicited"])
        cands += [o for o in cosig if o not in cands]
        cands += [c["addr"] for c in chain if not c["busy"] and c["addr"] not in cands]
        cands = [c for c in cands if c not in labels][: a.candidates + 5]
        log(f"Checking {len(cands)} candidate wallets ...")
        busy_of = dict(zip(cands, pmap(lambda x: is_hub(x, a.hub_threshold), cands)))
        kf = chain[0]["addr"] if chain else None
        results = []
        for c in cands:
            ev, score = [], 0
            v = cp.get(c)
            if c in cosig:
                score += 5; ev.append(f"co-signed {len(cosig[c])} tx(s) with the KOL, e.g. {cosig[c][0]}")
            if v and v["sent"] > 0:
                score += 2; ev.append(f"KOL sent it {v['sent']:.3f} SOL (e.g. tx {v['sigs'][0]})")
            if v and v["recv"] > 0:
                score += 2; ev.append(f"it sent the KOL {v['recv']:.3f} SOL")
            if v and (v["tok_out"] or v["tok_in"]):
                score += min(4, 2 * (v["tok_out"] + v["tok_in"]))
                ev.append(f"token transfers the KOL signed: KOL->it {v['tok_out']}, it->KOL {v['tok_in']}")
            if any(ch["addr"] == c for ch in chain):
                score += 3; ev.append("in the KOL's own funding chain")
            if busy_of.get(c):
                results.append({"wallet": c, "score": 0, "verdict": "busy wallet (exchange, bot or service)",
                                "evidence": ev, "kol": kols.get(c)})
                continue
            f = find_funder(c)
            if f and f["funder"] == kw:
                score += 4; ev.append(f"first funded by the KOL: {f['sol']:.3f} SOL, tx {f['sig']}")
            elif f and kf and f["funder"] == kf and not chain[0]["busy"]:
                score += 4; ev.append(f"same first funder as the KOL: {kf}")
            elif f and kf and f["funder"] == kf and chain[0]["busy"]:
                dt = abs((f.get("time") or 0) - (chain[0].get("time") or 0))
                if dt <= 3600:
                    score += 1; ev.append(f"funded by the same busy wallet {kf} within {int(dt)}s of the KOL")
            ccp, ccos, cbuys, cn, _, _ = recent_activity(c, a.cand_txs, max_pages=5, fetch_cap=150)
            # exchange deposit address: forwards almost everything to one busy address
            outs = sorted(((o, x["sent"]) for o, x in ccp.items() if x["sent"] > 0), key=lambda z: -z[1])
            tot_out = sum(x for _, x in outs)
            if outs and tot_out > 0 and outs[0][1] / tot_out > 0.9 and is_hub(outs[0][0], a.hub_threshold) \
                    and not cbuys:
                results.append({"wallet": c, "score": 0, "evidence": ev + [f"forwards {100 * outs[0][1] / tot_out:.0f}% "
                                f"of its SOL to busy {outs[0][0]}"], "verdict": "exchange deposit address",
                                "kol": kols.get(c)})
                continue
            common = set(kbuys) & set(cbuys)
            if common:
                score += min(3, len(common)); ev.append(f"bought {len(common)} of the same tokens")
                early = [m for m in common if cbuys[m] and kbuys[m] and 0 < kbuys[m] - cbuys[m] <= 3600]
                if early:
                    score += 2; ev.append(f"bought {len(early)} of them up to 1h BEFORE the KOL: "
                                          + ", ".join(early[:3]))
            verdict = "likely side wallet" if score >= 7 else "possible side wallet" if score >= 4 else "weak link"
            results.append({"wallet": c, "score": score, "verdict": verdict, "evidence": ev, "kol": kols.get(c),
                            "common_tokens": len(common), "txs_seen": cn})
        results.sort(key=lambda r: -r["score"])
        report.append({"kol": kw, "name": name, "txs_read": ntx, "span": span, "noise": noise, "spam_in": spam_in, "chain": chain, "candidates": results})

        print(f"\n=== {name}  {kw} ===")
        print(f"Read {ntx} of its own recent txs ({ts(span[0])} to {ts(span[1])})"
              + (f"; {100 * noise:.0f}% of txs mentioning it were other wallets' (copy-trade bots), skipped"
                 if noise > 0.2 else ""))
        if chain:
            print("Funding chain: " + " <- ".join(f"{c['addr']} ({c['sol']:.3f} SOL{', busy' if c['busy'] else ''})"
                                                  for c in chain))
        shown = [r for r in results if r["score"] >= 4]
        print("Side-wallet candidates:" if shown else "No side-wallet candidates scored 4+.")
        for r in shown:
            tag = f"  [also a KOL: {r['kol']}]" if r.get("kol") else ""
            print(f"  {r['wallet']}  score {r['score']}  {r['verdict']}{tag}")
            for e in r["evidence"]:
                print(f"     - {e}")
        other = [r for r in results if r["score"] < 4]
        if other:
            print(f"  ({len(other)} weaker or ruled-out counterparties in the JSON: busy wallets, deposit addresses, "
                  f"one-off transfers)")
    seen_in = Counter(c["wallet"] for r in report for c in r["candidates"] if c["score"] >= 4)
    seen_in.update(x for r in report for x in r.get("spam_in", []))
    multi = {w for w, n in seen_in.items() if n >= 3}
    if multi:
        print("\nWallets linked to 3+ different KOLs (usually token spammers or shared services, not side wallets):")
        for w in sorted(multi):
            print(f"  {w}  in {seen_in[w]} KOLs' activity")
        for r in report:
            for c in r["candidates"]:
                if c["wallet"] in multi:
                    c["score"], c["verdict"] = 0, f"appears around {seen_in[c['wallet']]} different KOLs: spammer/service"
    out = f"sides_{(a.wallet or 'kols')[:6]}.json"
    with open(out, "w") as fh:
        json.dump({"generated": int(time.time()), "results": report}, fh, indent=1)
    print(f"\nSaved {out}")


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
    q = sub.add_parser("pnl", help="top realized-profit wallets among those who bought below a market cap")
    q.add_argument("mint")
    q.add_argument("--max-mc-usd", type=float, default=50000, help="only wallets that bought below this market cap")
    q.add_argument("--sol-usd", type=float, help="SOL price in USD at launch (default: read from a SOL/USDC pool)")
    q.add_argument("--top", type=int, default=20)
    q.add_argument("--max-wallets", type=int, default=150, help="max low-cap buyers to compute PnL for")
    q.add_argument("--links", action="store_true", help="find wallets connected to the top earners")
    q.add_argument("--link-txs", type=int, default=60, help="recent txs per top wallet scanned for links")
    q.add_argument("--trace-up", type=int, default=4, help="funding-chain hops followed for each top wallet")
    q.add_argument("--source", help="address whose history holds the trades (default: pump.fun curve or mint)")
    q.add_argument("--pages", type=int, default=60)
    q.add_argument("--hub-threshold", type=int, default=1000)
    q.add_argument("--labels")
    k = sub.add_parser("sides", help="find likely side wallets of a KOL (or every KOL in kols.csv)")
    k.add_argument("wallet", nargs="?", help="one wallet; omit to scan kols.csv")
    k.add_argument("--kols", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "kols.csv"))
    k.add_argument("--max-kols", type=int, default=5, help="how many KOLs from kols.csv (in file order)")
    k.add_argument("--kol-txs", type=int, default=200, help="recent txs of the KOL to read")
    k.add_argument("--candidates", type=int, default=12, help="top counterparties to check")
    k.add_argument("--cand-txs", type=int, default=60, help="recent txs of each candidate to read")
    k.add_argument("--hub-threshold", type=int, default=1000)
    k.add_argument("--labels")
    a = p.parse_args()
    if a.mode in ("token", "pnl"):
        need_addr(a.mint, "token mint")
        if a.source:
            need_addr(a.source, "source")
    elif a.mode == "sides":
        if a.wallet:
            need_addr(a.wallet, "wallet")
    else:
        need_addr(a.address, "wallet")
    try:
        {"token": token_mode, "pnl": pnl_mode, "wallet": wallet_mode, "sides": sides_mode}[a.mode](a)
    except (RuntimeError, ValueError) as e:
        sys.exit(f"Error: {e}")


if __name__ == "__main__":
    main()
