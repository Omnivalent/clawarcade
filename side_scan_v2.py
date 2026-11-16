#!/usr/bin/env python3
"""
Side wallet finder v2 — deeper, smarter scan.

Changes from v1:
  - Scans ALL txs (not just plain transfers) — extracts token/SOL deltas from
    every tx including swaps. The swap PROGRAM isn't a counterparty, but the
    other WALLETS in the tx can still be side wallets.
  - Looks at token balance changes across all accounts in a tx to find
    who gained/lost opposite to our wallet.
  - Detects liquidity pool add/remove events (Raydium, Meteora, Orca).
  - More txs per wallet (1000 instead of 300).
  - Excludes dust: SOL < 0.01, tokens < 1000 units.
  - Detects patterns:
    A) Bilateral SOL/token between KOL and side
    B) Side buys tokens → sends to KOL (inflate PnL)
    C) KOL receives tokens → sends to side → side dumps
  - Scans pages of sigs until we hit 1000 or run out.

Usage:
  python3 side_scan_v2.py --wallets wallets.json --out DIR [--txs 1000] [--sol-usd 70.62]
"""
import argparse, json, os, sys, time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import solana_tracer as T

# Liquidity pool programs
LP_PROGRAMS = {
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM v4",
    "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C": "Raydium CPMM",
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK": "Raydium CLMM",
    "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo":  "Meteora DLMM",
    "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG":  "Meteora DAMM",
    "Eo7WjKq67rjJQSZxS6z3YkapzY3eBj6xfLjMc8fieCAV": "Meteora pools",
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc":  "Orca Whirlpool",
}

SWAP_PROGRAMS = set(LP_PROGRAMS.keys()) | {
    "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",   # PumpSwap
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",   # pump.fun
    "JUP6LkMUe1WjxTQuagMavnzFHJL85cYuGo9ECe2hEvb",   # Jupiter v6
    "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB9",  # Jupiter v4
    "jupoNjAxXgZ4rjzxzPMP4oxduvQsQtZzyknqvQistRMf",  # Jupiter perpetuals
    "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",   # Phoenix
    "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX",   # Serum/Openbook
    "opnb2LAfJYbRMAHHvqQ9zMZHlGPy9rBPEFMaR82JVIw",   # Openbook v2
    "TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmT1B",   # Tensor
    "M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K",   # Magic Eden AMM
    "FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSR1X4",  # FluxBeam
}

STABLE = {T.WSOL, T.USDC, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"}

# LP instruction discriminators (first 8 bytes of data, base58)
LP_ADD_HINTS = {"initialize", "addLiquidity", "deposit", "increaseLiquidity", "openPosition"}
LP_REMOVE_HINTS = {"removeLiquidity", "withdraw", "decreaseLiquidity", "closePosition"}


def get_acct_list(tx):
    msg = tx.get("transaction", {}).get("message", {})
    accts = msg.get("accountKeys", [])
    out = []
    for a in accts:
        out.append(a if isinstance(a, str) else a.get("pubkey", ""))
    return out


def get_programs_used(tx):
    accts = get_acct_list(tx)
    programs = set()
    msg = tx.get("transaction", {}).get("message", {})
    for ix in msg.get("instructions", []):
        idx = ix.get("programIdIndex")
        if idx is not None and idx < len(accts):
            programs.add(accts[idx])
    for ix in (tx.get("meta") or {}).get("innerInstructions", []) or []:
        for inner in ix.get("instructions", []):
            idx = inner.get("programIdIndex")
            if idx is not None and idx < len(accts):
                programs.add(accts[idx])
    return programs


def is_swap_tx(tx):
    return bool(get_programs_used(tx) & SWAP_PROGRAMS)


def detect_lp_event(tx, wallet):
    """Detect if wallet added or removed liquidity. Returns list of events."""
    programs = get_programs_used(tx)
    lp_programs = programs & set(LP_PROGRAMS.keys())
    if not lp_programs:
        return []

    meta = tx.get("meta") or {}
    accts = get_acct_list(tx)
    sig = tx.get("transaction", {}).get("signatures", [""])[0]
    bt = tx.get("blockTime")

    # Check if our wallet is a signer (they initiated it)
    signers = T.signers_of(tx)
    if wallet not in signers:
        return []

    # Check SOL and token deltas to figure out add vs remove
    sol_delta = T.lamport_delta(tx, wallet)

    # Token deltas
    token_deltas = {}
    for key, sign in (("preTokenBalances", -1), ("postTokenBalances", 1)):
        for b in meta.get(key) or []:
            owner = b.get("owner", "")
            if owner != wallet:
                continue
            mint = b.get("mint", "")
            if mint in STABLE:
                continue
            amt = float(b.get("uiTokenAmount", {}).get("uiAmountString") or 0)
            token_deltas[mint] = token_deltas.get(mint, 0) + sign * amt

    events = []
    for prog in lp_programs:
        prog_name = LP_PROGRAMS[prog]
        # If wallet lost SOL and lost tokens → add liquidity
        # If wallet gained SOL and gained tokens → remove liquidity
        lost_sol = sol_delta < -0.01
        lost_tokens = any(d < -100 for d in token_deltas.values())
        gained_sol = sol_delta > 0.01
        gained_tokens = any(d > 100 for d in token_deltas.values())

        if lost_sol and lost_tokens:
            action = "ADD_LIQUIDITY"
        elif gained_sol and gained_tokens:
            action = "REMOVE_LIQUIDITY"
        elif lost_tokens and not gained_tokens:
            action = "ADD_LIQUIDITY"
        elif gained_tokens and not lost_tokens:
            action = "REMOVE_LIQUIDITY"
        else:
            action = "LP_INTERACTION"

        for mint, delta in token_deltas.items():
            if abs(delta) > 100:
                events.append({
                    "action": action,
                    "program": prog_name,
                    "mint": mint,
                    "token_delta": delta,
                    "sol_delta": sol_delta,
                    "sig": sig,
                    "time": bt,
                })
    return events


def extract_all_transfers(tx, wallet):
    """Extract transfers from ANY tx (including swaps).
    For swap txs: only extract direct wallet-to-wallet token/SOL movements,
    ignoring the AMM pool accounts (they're not on-curve).
    """
    if not tx:
        return [], []

    meta = tx.get("meta") or {}
    sig = tx.get("transaction", {}).get("signatures", [""])[0]
    bt = tx.get("blockTime")
    accts = get_acct_list(tx)
    has_swap = is_swap_tx(tx)

    transfers = []
    lp_events = detect_lp_event(tx, wallet)

    # Token balance changes per owner
    token_moves = defaultdict(lambda: defaultdict(float))
    for key, sign in (("preTokenBalances", -1), ("postTokenBalances", 1)):
        for b in meta.get(key) or []:
            owner = b.get("owner", "")
            mint = b.get("mint", "")
            if mint in STABLE:
                continue
            amt = float(b.get("uiTokenAmount", {}).get("uiAmountString") or 0)
            token_moves[mint][owner] += sign * amt

    for mint, owners in token_moves.items():
        my_delta = owners.get(wallet, 0)
        if abs(my_delta) < 1000:  # exclude dust tokens
            continue
        for other, other_delta in owners.items():
            if other == wallet:
                continue
            if not T.on_curve(other):
                continue  # skip pool PDAs
            # Check for opposite flow
            if my_delta > 0 and other_delta < 0:
                # I received, they sent → they transferred tokens to me
                transfers.append({
                    "counterparty": other,
                    "direction": "RECV",
                    "type": "token",
                    "mint": mint,
                    "tokens": abs(my_delta),
                    "sol": 0,
                    "sig": sig,
                    "time": bt,
                    "in_swap": has_swap,
                })
            elif my_delta < 0 and other_delta > 0:
                # I sent, they received
                transfers.append({
                    "counterparty": other,
                    "direction": "SENT",
                    "type": "token",
                    "mint": mint,
                    "tokens": abs(my_delta),
                    "sol": 0,
                    "sig": sig,
                    "time": bt,
                    "in_swap": has_swap,
                })

    # SOL transfers (only from non-swap txs to avoid counting swap fees)
    if not has_swap:
        pre = meta.get("preBalances", [])
        post = meta.get("postBalances", [])
        if pre and post and len(pre) == len(post) == len(accts):
            my_idx = None
            for i, a in enumerate(accts):
                if a == wallet:
                    my_idx = i
                    break
            if my_idx is not None:
                fee = (meta.get("fee", 0) / 1e9) if T.signers_of(tx)[0] == wallet else 0
                my_sol = (post[my_idx] - pre[my_idx]) / 1e9 + fee
                if abs(my_sol) > 0.01:  # exclude dust SOL
                    for i, a in enumerate(accts):
                        if i == my_idx or not T.on_curve(a):
                            continue
                        other_sol = (post[i] - pre[i]) / 1e9
                        if my_sol * other_sol < 0 and abs(other_sol) > 0.01:
                            direction = "SENT" if my_sol < 0 else "RECV"
                            transfers.append({
                                "counterparty": a,
                                "direction": direction,
                                "type": "sol",
                                "mint": None,
                                "tokens": 0,
                                "sol": abs(my_sol),
                                "sig": sig,
                                "time": bt,
                                "in_swap": False,
                            })
                            break

    return transfers, lp_events


def scan_wallet(wallet, num_txs):
    """Scan ALL recent transactions for a wallet."""
    T.log(f"  Fetching up to {num_txs} signatures...")
    sigs, before = [], None
    while len(sigs) < num_txs:
        opts = {"limit": min(1000, num_txs - len(sigs))}
        if before:
            opts["before"] = before
        try:
            page = T.rpc("getSignaturesForAddress", [wallet, opts])
        except Exception as e:
            T.log(f"    ! sig fetch: {e}")
            break
        sigs += [s for s in page if not s.get("err")]
        if len(page) < opts["limit"]:
            break
        before = page[-1]["signature"]
        time.sleep(0.5)
    sigs = sigs[:num_txs]
    T.log(f"  Got {len(sigs)} sigs, downloading txs...")

    txs = T.pmap(lambda s: T.get_tx(s["signature"]), sigs)
    for attempt in range(3):
        miss = [i for i, t in enumerate(txs) if t is None]
        if not miss:
            break
        time.sleep(3 * (attempt + 1))
        for i, t in zip(miss, T.pmap(lambda i: T.get_tx(sigs[i]["signature"]), miss)):
            txs[i] = t

    good = sum(1 for t in txs if t)
    T.log(f"  Downloaded {good}/{len(sigs)} txs, extracting...")

    all_transfers = []
    all_lp_events = []
    signer_counts = defaultdict(int)  # track who signs txs referencing this wallet
    for tx in txs:
        if not tx:
            continue
        transfers, lp_events = extract_all_transfers(tx, wallet)
        all_transfers.extend(transfers)
        all_lp_events.extend(lp_events)
        # Track signers — if our wallet is referenced but not signing,
        # the signers are potential operating wallets
        for signer in T.signers_of(tx):
            if signer != wallet:
                signer_counts[signer] += 1

    # Aggregate by counterparty
    partners = defaultdict(lambda: {
        "sent_sol": 0, "recv_sol": 0, "sent_count": 0, "recv_count": 0,
        "token_sent": [], "token_recv": [],
        "token_sent_in_swap": [], "token_recv_in_swap": [],
        "sigs": set(), "times": []
    })
    for t in all_transfers:
        cp = t["counterparty"]
        p = partners[cp]
        p["sigs"].add(t["sig"])
        if t["time"]:
            p["times"].append(t["time"])
        if t["type"] == "sol":
            if t["direction"] == "SENT":
                p["sent_sol"] += t["sol"]
                p["sent_count"] += 1
            else:
                p["recv_sol"] += t["sol"]
                p["recv_count"] += 1
        elif t["type"] == "token":
            entry = {"mint": t["mint"], "tokens": t["tokens"], "sig": t["sig"], "time": t["time"]}
            in_swap = t.get("in_swap", False)
            if t["direction"] == "SENT":
                p["token_sent"].append(entry)
                if in_swap:
                    p["token_sent_in_swap"].append(entry)
            else:
                p["token_recv"].append(entry)
                if in_swap:
                    p["token_recv_in_swap"].append(entry)

    # Convert sets to lists for JSON
    for cp, p in partners.items():
        p["sigs"] = list(p["sigs"])

    # If wallet has very few direct transfers but many txs, the signers ARE the side wallets
    # (pattern: wallet is used as authority/referral, actual trading done by signer wallets)
    signer_wallets = []
    if len(all_transfers) < len(sigs) * 0.05 and signer_counts:
        T.log(f"  ! Low direct transfer ratio ({len(all_transfers)}/{len(sigs)}) — checking signer wallets")
        for signer, count in sorted(signer_counts.items(), key=lambda x: -x[1]):
            if count >= 2 and T.on_curve(signer):
                signer_wallets.append({"address": signer, "tx_count": count})
                T.log(f"    Signer: {signer} ({count} txs)")

    return dict(partners), len(sigs), sum(1 for t in txs if t is None), all_lp_events, signer_wallets


def find_side_wallets(partners, sol_usd, min_sol_usd=500):
    """Find likely side wallets with evidence and pattern detection."""
    results = []
    for cp, data in partners.items():
        is_bilateral_sol = data["sent_sol"] > 0.01 and data["recv_sol"] > 0.01
        is_bilateral_token = len(data["token_sent"]) > 0 and len(data["token_recv"]) > 0

        # Pattern: side sends tokens TO kol (inflate PnL) — one-way token recv
        tokens_recv_only = len(data["token_recv"]) > 0 and len(data["token_sent"]) == 0
        # Pattern: kol sends tokens TO side (side dumps) — one-way token sent
        tokens_sent_only = len(data["token_sent"]) > 0 and len(data["token_recv"]) == 0

        total_sol = data["sent_sol"] + data["recv_sol"]
        total_sol_usd = total_sol * sol_usd
        total_token_xfers = len(data["token_sent"]) + len(data["token_recv"])
        total_transfers = data["sent_count"] + data["recv_count"] + total_token_xfers

        if total_transfers < 2:
            continue

        # Thresholds
        sol_bilateral_passes = is_bilateral_sol and total_sol_usd >= min_sol_usd
        token_bilateral_passes = is_bilateral_token and total_token_xfers >= 2

        # One-way token + SOL connection (side buys and sends tokens, or receives and dumps)
        sol_connected = data["sent_sol"] > 0.1 or data["recv_sol"] > 0.1
        oneway_token_passes = (tokens_recv_only or tokens_sent_only) and total_token_xfers >= 2 and sol_connected

        # High volume one-way tokens even without SOL
        high_vol_token = total_token_xfers >= 5 and (tokens_recv_only or tokens_sent_only)

        if not (sol_bilateral_passes or token_bilateral_passes or oneway_token_passes or high_vol_token):
            continue

        unique_sigs = list(dict.fromkeys(data["sigs"]))[:25]
        times = sorted(data["times"]) if data["times"] else []

        score = 0
        reasons = []
        patterns = []

        if is_bilateral_sol:
            reasons.append(f"Bilateral SOL: sent {data['sent_sol']:.2f} ({data['sent_count']}x), "
                          f"recv {data['recv_sol']:.2f} ({data['recv_count']}x), ${total_sol_usd:,.0f}")
            score += min(10, total_sol_usd / 500)

        if is_bilateral_token:
            reasons.append(f"Bilateral tokens: sent {len(data['token_sent'])}x, recv {len(data['token_recv'])}x")
            score += 3 * min(3, total_token_xfers)

        if tokens_recv_only and len(data["token_recv"]) >= 2:
            total_recv_tokens = sum(t["tokens"] for t in data["token_recv"])
            patterns.append(f"SIDE→KOL tokens: received {len(data['token_recv'])}x ({total_recv_tokens:,.0f} tokens total) — possible PnL inflation")
            score += 5

        if tokens_sent_only and len(data["token_sent"]) >= 2:
            total_sent_tokens = sum(t["tokens"] for t in data["token_sent"])
            patterns.append(f"KOL→SIDE tokens: sent {len(data['token_sent'])}x ({total_sent_tokens:,.0f} tokens total) — possible hidden dump wallet")
            score += 5

        if data["recv_sol"] > 1 and data["sent_sol"] < 0.01:
            patterns.append(f"One-way SOL: received {data['recv_sol']:.2f} SOL — side funding KOL")
            score += 2
        elif data["sent_sol"] > 1 and data["recv_sol"] < 0.01:
            patterns.append(f"One-way SOL: sent {data['sent_sol']:.2f} SOL — KOL funding side")
            score += 2

        if total_transfers >= 5:
            reasons.append(f"Frequent: {total_transfers} transfers")
            score += 2

        # Unique mints involved
        mints_sent = set(t["mint"] for t in data["token_sent"])
        mints_recv = set(t["mint"] for t in data["token_recv"])
        shared_mints = mints_sent & mints_recv
        if shared_mints:
            patterns.append(f"Same token(s) sent AND received: {len(shared_mints)} mint(s)")
            score += 3

        results.append({
            "counterparty": cp,
            "bilateral_sol": is_bilateral_sol,
            "bilateral_token": is_bilateral_token,
            "sent_sol": data["sent_sol"],
            "recv_sol": data["recv_sol"],
            "sent_count": data["sent_count"],
            "recv_count": data["recv_count"],
            "token_sent_count": len(data["token_sent"]),
            "token_recv_count": len(data["token_recv"]),
            "token_sent_in_swap_count": len(data.get("token_sent_in_swap", [])),
            "token_recv_in_swap_count": len(data.get("token_recv_in_swap", [])),
            "token_sent": data["token_sent"][:15],
            "token_recv": data["token_recv"][:15],
            "total_sol_usd": total_sol_usd,
            "total_transfers": total_transfers,
            "score": score,
            "reasons": reasons,
            "patterns": patterns,
            "evidence_sigs": unique_sigs,
            "first_seen": times[0] if times else None,
            "last_seen": times[-1] if times else None,
        })

    return sorted(results, key=lambda x: -x["score"])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--wallets", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--txs", type=int, default=1000)
    p.add_argument("--sol-usd", type=float, default=70.62)
    a = p.parse_args()

    os.makedirs(a.out, exist_ok=True)

    raw = json.load(open(a.wallets))
    if isinstance(raw, dict):
        wallets = list(raw.items())
    else:
        wallets = [(w, w) for w in raw]

    all_results = {}
    for i, (name, addr) in enumerate(wallets, 1):
        cache = os.path.join(a.out, f"{addr}.json")
        if os.path.exists(cache):
            T.log(f"[{i}/{len(wallets)}] {name} — cached")
            all_results[addr] = json.load(open(cache))
            continue

        T.log(f"[{i}/{len(wallets)}] Scanning {name} ({addr[:16]}...)")
        try:
            partners, num_sigs, missing, lp_events, signer_wallets = scan_wallet(addr, a.txs)
            sides = find_side_wallets(partners, a.sol_usd)
            result = {
                "name": name,
                "address": addr,
                "txs_scanned": num_sigs,
                "txs_missing": missing,
                "side_wallets": sides,
                "signer_wallets": signer_wallets,
                "all_partners_count": len(partners),
                "lp_events": lp_events,
            }
            all_results[addr] = result
            json.dump(result, open(cache, "w"), indent=2)
            T.log(f"  Found {len(sides)} side wallet candidate(s), {len(lp_events)} LP events")
        except Exception as e:
            T.log(f"  ! {type(e).__name__}: {e}")
            import traceback; traceback.print_exc()

    json.dump(all_results, open(os.path.join(a.out, "summary.json"), "w"), indent=2)
    total_sides = sum(len(r.get("side_wallets",[])) for r in all_results.values())
    total_lp = sum(len(r.get("lp_events",[])) for r in all_results.values())
    T.log(f"\nDone: {len(all_results)} wallets, {total_sides} side wallet candidates, {total_lp} LP events")


if __name__ == "__main__":
    main()
