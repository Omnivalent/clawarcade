#!/usr/bin/env python3
"""
KOL wallet networks: who moved $500+ to or from each KOL wallet, excluding swaps and liquidity pools.

Only "plain transfer" transactions count: every instruction (inner ones too) must belong to the
System, Token, Token-2022, Associated Token Account, Compute Budget or Memo programs. Anything that
touches a DEX, AMM, bonding curve or other program is skipped. Counterparties must be real wallets
(on the ed25519 curve), so pool and vault accounts never appear. Assets: SOL, USDC, USDT.

Ring 1 = wallets that moved $500+ with the KOL. Each private ring-1 wallet is expanded the same way
(ring 2). Busy wallets (1000+ txs: exchanges, services, bots) are shown but not expanded.

Scanning is incremental: kol_state.json remembers how far each wallet has been read, so every run
reads new transactions first and then continues further back in time.

Usage:
  python3 kol_network.py [--kols kols.csv] [--out site/data] [--budget-minutes 30] [--min-usd 500]
Then open site/index.html (it reads site/data/kol_network.json).
Free public RPC works; a SOLANA_RPC with a key is much faster.
"""
import argparse
import csv
import json
import os
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import solana_tracer as T  # noqa: E402

USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
STABLES = {T.USDC: "USDC", USDT: "USDT"}
PLAIN = {
    "11111111111111111111111111111111",              # System
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",   # Token
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",   # Token-2022
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",  # Associated Token Account
    "ComputeBudget111111111111111111111111111111",   # Compute Budget
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",   # Memo
    "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",   # Memo v1
}


def all_instructions(tx):
    msg = tx["transaction"]["message"]
    ins = list(msg.get("instructions") or [])
    for ii in (tx.get("meta") or {}).get("innerInstructions") or []:
        ins += ii.get("instructions") or []
    return ins


def is_plain_transfer(tx):
    """True when the tx only uses transfer-type programs (no swap, pool, curve or other program)."""
    keys = T.keys_of(tx)
    for ins in all_instructions(tx):
        pid = ins.get("programId")
        if pid is None and "programIdIndex" in ins:
            pid = keys[ins["programIdIndex"]]
        if pid not in PLAIN:
            return False
    return True


def transfers_of(tx, wallet, sol_usd, min_usd):
    """Plain transfers of SOL/USDC/USDT >= min_usd between `wallet` and another real wallet."""
    if not tx or not is_plain_transfer(tx):
        return []
    out = []
    agg = defaultdict(float)  # (asset, from, to) -> amount, merges split transfers in one tx
    for asset, src, dst, amt in T.edges(tx):
        if wallet not in (src, dst) or src == dst:
            continue
        if asset == "SOL":
            name = "SOL"
        elif asset in STABLES:
            name = STABLES[asset]
        else:
            continue
        agg[(name, src, dst)] += amt
    for (name, src, dst), amt in agg.items():
        other = dst if src == wallet else src
        if not T.on_curve(other):
            continue
        usd = amt * sol_usd if name == "SOL" else amt
        if usd >= min_usd:
            out.append({"from": src, "to": dst, "asset": name, "amount": round(amt, 6), "usd": round(usd, 2)})
    return out


def scan_wallet(w, st, sol_usd, min_usd, fetch_cap):
    """Read up to fetch_cap txs of w and keep its qualifying transfers in st["transfers"].
    State: newest = newest signature seen; oldest = last signature read going back in time;
    complete = start of history reached; gaps = runs where new activity outran the budget.
    Each run: catch up on activity newer than `newest`, then continue backwards from `oldest`."""
    trs = st.setdefault("transfers", {})
    left = [fetch_cap]
    retry = set(st.get("retry", []))
    if retry:  # 0. transactions whose download failed on an earlier run
        todo = sorted(retry)[:fetch_cap]
        for sig, tx in zip(todo, T.pmap(T.get_tx, todo)):
            left[0] -= 1
            if tx is None:
                continue
            retry.discard(sig)
            found = transfers_of(tx, w, sol_usd, min_usd)
            for t in found:
                t["time"] = tx.get("blockTime")
            if found:
                trs[sig] = found

    def walk(opts, backwards):
        """Page through signatures; returns True when the end of the range was reached."""
        before = opts.get("before")
        while left[0] > 0:
            o = {k: v for k, v in opts.items() if k != "before"}
            o["limit"] = 1000
            if before:
                o["before"] = before
            page = T.rpc("getSignaturesForAddress", [w, o])
            if not page:
                return True
            if not st.get("newest"):
                st["newest"] = page[0]["signature"]
            ok = [x for x in page if not x.get("err")]
            for i in range(0, len(ok), 100):
                chunk = ok[i:i + 100][:left[0]]
                if not chunk:
                    return False
                for x, tx in zip(chunk, T.pmap(lambda x: T.get_tx(x["signature"]), chunk)):
                    left[0] -= 1
                    if tx is None:  # download failed: retry on a later run instead of losing it
                        retry.add(x["signature"])
                    found = transfers_of(tx, w, sol_usd, min_usd) if tx else []
                    for t in found:
                        t["time"] = tx.get("blockTime")
                    if found:
                        trs[x["signature"]] = found
                    if backwards:
                        st["oldest"], st["oldest_time"] = x["signature"], x.get("blockTime")
                if left[0] <= 0 and (i + 100 < len(ok) or len(chunk) < len(ok[i:i + 100])):
                    return False
            if backwards:
                st["oldest"], st["oldest_time"] = page[-1]["signature"], page[-1].get("blockTime")
            if len(page) < 1000:
                return True
            before = page[-1]["signature"]
        return False

    if st.get("newest"):  # 1. catch up on new activity (newest first)
        old_newest = st["newest"]
        top = T.rpc("getSignaturesForAddress", [w, {"limit": 1, "until": old_newest}])
        if top:
            if not walk({"until": old_newest}, backwards=False):
                st["gaps"] = st.get("gaps", 0) + 1  # very active wallet: some new txs skipped this run
            st["newest"] = top[0]["signature"]
        if st.get("oldest") and not st.get("complete"):  # 2. backfill further back in time
            if walk({"before": st["oldest"]}, backwards=True):
                st["complete"] = True
    else:  # first visit: read from the top down
        if walk({}, backwards=True):
            st["complete"] = True
    if retry:
        st["retry"] = sorted(retry)[:2000]
    else:
        st.pop("retry", None)
    read_now = fetch_cap - left[0]
    st["txs_read"] = st.get("txs_read", 0) + read_now
    return read_now


def load_kols(paths):
    kols = {}
    for p in paths:
        if not os.path.exists(p):
            continue
        with open(p, newline="") as f:
            for r in csv.DictReader(f):
                w = (r.get("wallet") or "").strip()
                if w and T.B58.match(w) and w not in kols:
                    kols[w] = {"name": r.get("name") or "KOL", "twitter": r.get("twitter") or "",
                               "source": r.get("source") or os.path.basename(p)}
    return kols


def current_sol_usd():
    s = T.rpc("getSignaturesForAddress", [T.SOL_USDC_POOL, {"limit": 1}])
    return T.sol_usd_near(s[0]["signature"]) if s else None


def build_output(kols, state, busy, sol_usd, min_usd):
    out = {"generated": int(time.time()), "sol_usd": sol_usd, "min_usd": min_usd, "kols": []}
    kol_set = set(kols)

    def edges_of(w):
        agg = {}
        for sig, trs in (state.get(w, {}).get("transfers") or {}).items():
            for t in trs:
                other = t["to"] if t["from"] == w else t["from"]
                e = agg.setdefault(other, {"wallet": other, "sent_usd": 0.0, "recv_usd": 0.0, "count": 0,
                                           "first": None, "last": None, "sigs": [], "assets": set()})
                e["sent_usd" if t["from"] == w else "recv_usd"] += t["usd"]
                e["count"] += 1
                e["assets"].add(t["asset"])
                tt = t.get("time")
                if tt:
                    e["first"] = tt if e["first"] is None else min(e["first"], tt)
                    e["last"] = tt if e["last"] is None else max(e["last"], tt)
                if len(e["sigs"]) < 5:
                    e["sigs"].append(sig)
        res = []
        for e in agg.values():
            e["assets"] = sorted(e["assets"])
            e["sent_usd"], e["recv_usd"] = round(e["sent_usd"], 2), round(e["recv_usd"], 2)
            o = e["wallet"]
            e["kind"] = ("kol" if o in kol_set else "busy" if busy.get(o) else "wallet")
            if o in kol_set:
                e["kol_name"] = kols[o]["name"]
            res.append(e)
        res.sort(key=lambda e: -(e["sent_usd"] + e["recv_usd"]))
        return res

    def coverage(w):
        st = state.get(w, {})
        return {"txs_read": st.get("txs_read", 0), "oldest_time": st.get("oldest_time"),
                "complete": bool(st.get("complete"))}

    for w, k in kols.items():
        ring1 = edges_of(w)
        for e in ring1:
            if e["kind"] == "wallet" and e["wallet"] in state:
                e["ring2"] = [x for x in edges_of(e["wallet"]) if x["wallet"] != w]
                e["coverage"] = coverage(e["wallet"])
        out["kols"].append({"name": k["name"], "wallet": w, "twitter": k["twitter"], "source": k["source"],
                            "coverage": coverage(w), "ring1": ring1,
                            "total_usd": round(sum(e["sent_usd"] + e["recv_usd"] for e in ring1), 2)})
    out["kols"].sort(key=lambda k: (-len([e for e in k["ring1"] if e["kind"] == "wallet"]), -k["total_usd"]))
    return out


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--kols", nargs="*", default=[os.path.join(here, "kols.csv"), os.path.join(here, "kols_gmgn.csv")])
    p.add_argument("--out", default=os.path.join(here, "site", "data"))
    p.add_argument("--budget-minutes", type=float, default=30)
    p.add_argument("--min-usd", type=float, default=500)
    p.add_argument("--kol-fetch", type=int, default=600, help="txs read per KOL per run")
    p.add_argument("--ring2-fetch", type=int, default=250, help="txs read per ring-1 wallet per run")
    p.add_argument("--sol-usd", type=float, help="SOL price (default: read from a SOL/USDC pool)")
    a = p.parse_args()

    os.makedirs(a.out, exist_ok=True)
    state_path = os.path.join(a.out, "kol_state.json")
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    busy = state.pop("_busy", {})
    kols = load_kols(a.kols)
    if not kols:
        sys.exit("No KOLs found. Put name,wallet rows in kols.csv.")
    sol_usd = a.sol_usd or current_sol_usd()
    if not sol_usd:
        sys.exit("Could not read the SOL price; pass --sol-usd")
    T.log(f"{len(kols)} KOLs, SOL ${sol_usd:.2f}, min ${a.min_usd:.0f}, budget {a.budget_minutes} min")
    deadline = time.time() + a.budget_minutes * 60

    def save():
        state["_busy"] = busy
        tmp = state_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f, separators=(",", ":"))
        os.replace(tmp, state_path)
        state.pop("_busy")
        out = build_output(kols, state, busy, sol_usd, a.min_usd)
        tmp = os.path.join(a.out, "kol_network.json.tmp")
        with open(tmp, "w") as f:
            json.dump(out, f, separators=(",", ":"))
        os.replace(tmp, os.path.join(a.out, "kol_network.json"))

    # least-scanned KOLs first, so coverage spreads evenly across runs
    order = sorted(kols, key=lambda w: state.get(w, {}).get("txs_read", 0))
    for i, w in enumerate(order, 1):
        if time.time() > deadline:
            T.log("Time budget used; the next run continues from here.")
            break
        T.log(f"[{i}/{len(order)}] {kols[w]['name']} {w}")
        try:
            scan_wallet(w, state.setdefault(w, {}), sol_usd, a.min_usd, a.kol_fetch)
        except Exception as e:
            T.log(f"  ! {type(e).__name__}: {e}")
            continue
        partners = {t["to"] if t["from"] == w else t["from"]
                    for trs in state[w]["transfers"].values() for t in trs}
        for o in sorted(partners):
            if time.time() > deadline:
                break
            if o in kols:
                continue
            if o not in busy:
                try:
                    busy[o] = T.is_hub(o, 1000)
                except Exception:
                    continue
            if busy[o]:
                continue
            try:
                scan_wallet(o, state.setdefault(o, {}), sol_usd, a.min_usd, a.ring2_fetch)
            except Exception as e:
                T.log(f"  ! ring 2 {o}: {type(e).__name__}: {e}")
        save()
    save()
    T.log(f"Saved {os.path.join(a.out, 'kol_network.json')}")


if __name__ == "__main__":
    main()
