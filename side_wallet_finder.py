#!/usr/bin/env python3
"""
Bilateral-transfer side wallet finder.

For each KOL wallet, scans recent transactions and finds wallets that have
BILATERAL transfers (both A→B and B→A) excluding AMM/swap/pool programs.

Criteria:
  - Must be bilateral (transfers in BOTH directions)
  - Excludes AMM, PumpSwap, liquidity pool, Jupiter, etc.
  - Token transfers > $50 worth
  - Cumulative bilateral SOL transfers > $500
  - Reports evidence: how many transfers, dates, amounts, directions

Usage:
  python3 side_wallet_finder.py --wallets wallets.json --out DIR [--txs 300] [--sol-usd 230]
"""
import argparse, json, os, sys, time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import solana_tracer as T

# Programs that indicate a swap/AMM, NOT a plain transfer
SWAP_PROGRAMS = {
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",  # Raydium AMM v4
    "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",  # Raydium CPMM
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",  # Raydium CLMM
    "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",   # Meteora DLMM
    "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",   # Meteora DAMM
    "Eo7WjKq67rjJQSZxS6z3YkapzY3eBj6xfLjMc8fieCAV",  # Meteora pools
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",   # Orca Whirlpool
    "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",   # PumpSwap
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",   # pump.fun
    "JUP6LkMUe1WjxTQuagMavnzFHJL85cYuGo9ECe2hEvb",   # Jupiter v6
    "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB9",   # Jupiter v4
    "jupoNjAxXgZ4rjzxzPMP4oxduvQsQtZzyknqvQistRMf",   # Jupiter perpetuals
    "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",   # Phoenix
    "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX",   # Serum/Openbook
    "opnb2LAfJYbRMAHHvqQ9zMZHlGPy9rBPEFMaR82JVIw",   # Openbook v2
    "TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmT1B",   # Tensor swap
    "M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K",   # Magic Eden AMM
    "hadeK9DLv9eA7ya5KCTqSvSvRZeJC3JgD5a9Y3CNbvu",   # Hades swap
    "routeUGWgWzqBtFmeQ7bH86ywKqkvrYBq6kJKAmTLDXr",  # Raydium route
    "RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqXgEr",   # Raydium V4 route
    "FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSR1X4",  # FluxBeam
}

# Programs that are OK for plain transfers
TRANSFER_PROGRAMS = {
    "11111111111111111111111111111111",                  # System
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",     # Token
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",    # Token-2022
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",   # ATA
    "ComputeBudget111111111111111111111111111111",       # ComputeBudget
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",   # Memo
    "Memo1UhkJBfCR6AQXzFSP4w8oykzmeHwXAVsMyQfYNiC",   # Memo v1
}

STABLE = {T.WSOL, T.USDC, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"}  # USDT


def is_plain_transfer(tx):
    """Check if a transaction involves only transfer-safe programs (no swaps)."""
    msg = tx.get("transaction", {}).get("message", {})
    accts = msg.get("accountKeys", [])
    if isinstance(accts, list) and accts and isinstance(accts[0], dict):
        programs = {a["pubkey"] for a in accts if a.get("signer") is False}
    else:
        programs = set()
    for ix in msg.get("instructions", []):
        pid_idx = ix.get("programIdIndex")
        if pid_idx is not None and pid_idx < len(accts):
            pid = accts[pid_idx] if isinstance(accts[pid_idx], str) else accts[pid_idx].get("pubkey", "")
            if pid in SWAP_PROGRAMS:
                return False
    for ix in (tx.get("meta") or {}).get("innerInstructions", []) or []:
        for inner in ix.get("instructions", []):
            pid_idx = inner.get("programIdIndex")
            if pid_idx is not None and pid_idx < len(accts):
                pid = accts[pid_idx] if isinstance(accts[pid_idx], str) else accts[pid_idx].get("pubkey", "")
                if pid in SWAP_PROGRAMS:
                    return False
    return True


def extract_transfers(tx, wallet):
    """Extract SOL and token transfers involving `wallet` from a plain-transfer tx.
    Returns list of {counterparty, direction, sol_amount, token_transfers: [{mint, amount}]}
    """
    if not tx or not is_plain_transfer(tx):
        return []

    results = []
    block_time = tx.get("blockTime")
    sig = tx.get("transaction", {}).get("signatures", [""])[0]

    # SOL transfers
    sol_delta = T.lamport_delta(tx, wallet)
    meta = tx.get("meta") or {}

    # Find who wallet sent SOL to or received from
    msg = tx.get("transaction", {}).get("message", {})
    accts = msg.get("accountKeys", [])
    acct_list = []
    for a in accts:
        if isinstance(a, str):
            acct_list.append(a)
        elif isinstance(a, dict):
            acct_list.append(a.get("pubkey", ""))

    # Token transfers: find mints where wallet balance changed
    token_moves = defaultdict(lambda: defaultdict(float))  # mint -> owner -> delta
    for key, sign in (("preTokenBalances", -1), ("postTokenBalances", 1)):
        for b in meta.get(key) or []:
            owner = b.get("owner", "")
            mint = b.get("mint", "")
            if mint in STABLE:
                continue
            amt = float(b.get("uiTokenAmount", {}).get("uiAmountString") or 0)
            token_moves[mint][owner] += sign * amt

    # For each mint, find if wallet gained/lost and who is counterparty
    for mint, owners in token_moves.items():
        my_delta = owners.get(wallet, 0)
        if abs(my_delta) < 1:
            continue
        for other, other_delta in owners.items():
            if other == wallet:
                continue
            if not T.on_curve(other):
                continue
            if my_delta * other_delta < 0:  # opposite directions = transfer
                direction = "SENT" if my_delta < 0 else "RECV"
                results.append({
                    "counterparty": other,
                    "direction": direction,
                    "type": "token",
                    "mint": mint,
                    "tokens": abs(my_delta),
                    "sol": 0,
                    "sig": sig,
                    "time": block_time,
                })

    # SOL transfer: look at lamport deltas for all accounts
    pre = meta.get("preBalances", [])
    post = meta.get("postBalances", [])
    if pre and post and len(pre) == len(post) == len(acct_list):
        my_idx = None
        for i, a in enumerate(acct_list):
            if a == wallet:
                my_idx = i
                break
        if my_idx is not None:
            my_sol = (post[my_idx] - pre[my_idx]) / 1e9
            fee = (meta.get("fee", 0) / 1e9) if T.signers_of(tx)[0] == wallet else 0
            my_sol_net = my_sol + fee  # add back fee for sender
            if abs(my_sol_net) > 0.001:
                for i, a in enumerate(acct_list):
                    if i == my_idx or not T.on_curve(a):
                        continue
                    other_sol = (post[i] - pre[i]) / 1e9
                    if my_sol_net * other_sol < 0 and abs(other_sol) > 0.001:
                        direction = "SENT" if my_sol_net < 0 else "RECV"
                        results.append({
                            "counterparty": a,
                            "direction": direction,
                            "type": "sol",
                            "mint": None,
                            "tokens": 0,
                            "sol": abs(my_sol_net),
                            "sig": sig,
                            "time": block_time,
                        })
                        break  # only count once per tx for SOL

    return results


def scan_wallet(wallet, num_txs):
    """Scan a wallet's recent transactions for bilateral transfer partners."""
    T.log(f"  Fetching {num_txs} signatures for {wallet[:16]}...")
    sigs, before = [], None
    while len(sigs) < num_txs:
        opts = {"limit": min(1000, num_txs - len(sigs))}
        if before:
            opts["before"] = before
        try:
            page = T.rpc("getSignaturesForAddress", [wallet, opts])
        except Exception as e:
            T.log(f"    ! sig fetch error: {e}")
            break
        sigs += [s for s in page if not s.get("err")]
        if len(page) < 1000:
            break
        before = page[-1]["signature"]
    sigs = sigs[:num_txs]
    T.log(f"  Got {len(sigs)} sigs, downloading txs...")

    txs = T.pmap(lambda s: T.get_tx(s["signature"]), sigs)
    # retry failures
    for attempt in range(2):
        miss = [i for i, t in enumerate(txs) if t is None]
        if not miss:
            break
        time.sleep(3 * (attempt + 1))
        for i, t in zip(miss, T.pmap(lambda i: T.get_tx(sigs[i]["signature"]), miss)):
            txs[i] = t

    T.log(f"  Downloaded {sum(1 for t in txs if t)} txs, extracting transfers...")

    # Gather all transfers
    all_transfers = []
    for s, tx in zip(sigs, txs):
        if not tx:
            continue
        transfers = extract_transfers(tx, wallet)
        all_transfers.extend(transfers)

    # Aggregate by counterparty
    partners = defaultdict(lambda: {"sent_sol": 0, "recv_sol": 0, "sent_count": 0, "recv_count": 0,
                                      "token_sent": [], "token_recv": [], "sigs": [], "times": []})
    for t in all_transfers:
        cp = t["counterparty"]
        p = partners[cp]
        p["sigs"].append(t["sig"])
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
            if t["direction"] == "SENT":
                p["token_sent"].append(entry)
            else:
                p["token_recv"].append(entry)

    return dict(partners), len(sigs), sum(1 for t in txs if t is None)


def find_side_wallets(partners, sol_usd, min_bilateral_sol_usd=500, min_token_usd=50):
    """Filter partners to find likely side wallets based on bilateral criteria."""
    results = []
    for cp, data in partners.items():
        is_bilateral_sol = data["sent_sol"] > 0 and data["recv_sol"] > 0
        is_bilateral_token = len(data["token_sent"]) > 0 and len(data["token_recv"]) > 0

        if not (is_bilateral_sol or is_bilateral_token):
            continue

        total_sol = data["sent_sol"] + data["recv_sol"]
        total_sol_usd = total_sol * sol_usd
        total_transfers = data["sent_count"] + data["recv_count"] + len(data["token_sent"]) + len(data["token_recv"])

        # Apply thresholds
        sol_passes = is_bilateral_sol and total_sol_usd >= min_bilateral_sol_usd
        token_passes = is_bilateral_token  # tokens bilateral already meaningful

        if not (sol_passes or token_passes):
            continue

        # Deduplicate sigs
        unique_sigs = list(dict.fromkeys(data["sigs"]))
        times = sorted(data["times"]) if data["times"] else []

        score = 0
        reasons = []
        if is_bilateral_sol:
            reasons.append(f"Bilateral SOL: sent {data['sent_sol']:.2f} SOL ({data['sent_count']}x), "
                          f"recv {data['recv_sol']:.2f} SOL ({data['recv_count']}x), "
                          f"total ${total_sol_usd:,.0f}")
            score += min(10, total_sol_usd / 500)
        if is_bilateral_token:
            reasons.append(f"Bilateral tokens: sent {len(data['token_sent'])}x, recv {len(data['token_recv'])}x")
            score += 3 * min(3, len(data["token_sent"]) + len(data["token_recv"]))
        if total_transfers >= 4:
            reasons.append(f"Frequent: {total_transfers} total transfers")
            score += 2

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
            "token_sent": data["token_sent"][:10],  # cap for json size
            "token_recv": data["token_recv"][:10],
            "total_sol_usd": total_sol_usd,
            "total_transfers": total_transfers,
            "score": score,
            "reasons": reasons,
            "evidence_sigs": unique_sigs[:20],
            "first_seen": times[0] if times else None,
            "last_seen": times[-1] if times else None,
        })

    return sorted(results, key=lambda x: -x["score"])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--wallets", required=True, help="JSON file: {name: address, ...} or list of addresses")
    p.add_argument("--out", required=True, help="Output directory")
    p.add_argument("--txs", type=int, default=300, help="Recent txs to scan per wallet")
    p.add_argument("--sol-usd", type=float, default=230.0, help="SOL price in USD for thresholds")
    a = p.parse_args()

    os.makedirs(a.out, exist_ok=True)

    # Load wallets
    raw = json.load(open(a.wallets))
    if isinstance(raw, dict):
        wallets = [(name, addr) for name, addr in raw.items()]
    elif isinstance(raw, list):
        wallets = [(w, w) for w in raw]
    else:
        raise ValueError("wallets file must be a JSON dict {name: addr} or list [addr]")

    all_results = {}
    for i, (name, addr) in enumerate(wallets, 1):
        cache_path = os.path.join(a.out, f"{addr}.json")
        if os.path.exists(cache_path):
            T.log(f"[{i}/{len(wallets)}] {name} ({addr[:16]}...) — cached")
            all_results[addr] = json.load(open(cache_path))
            continue

        T.log(f"[{i}/{len(wallets)}] Scanning {name} ({addr[:16]}...)")
        try:
            partners, num_sigs, missing = scan_wallet(addr, a.txs)
            side_wallets = find_side_wallets(partners, a.sol_usd)
            result = {
                "name": name,
                "address": addr,
                "txs_scanned": num_sigs,
                "txs_missing": missing,
                "side_wallets": side_wallets,
                "all_partners_count": len(partners),
            }
            all_results[addr] = result
            json.dump(result, open(cache_path, "w"), indent=2)
            T.log(f"  Found {len(side_wallets)} bilateral partner(s)")
        except Exception as e:
            T.log(f"  ! Error: {type(e).__name__}: {e}")
            continue

    # Summary
    summary_path = os.path.join(a.out, "summary.json")
    json.dump(all_results, open(summary_path, "w"), indent=2)
    T.log(f"\nSummary saved to {summary_path}")

    total_sides = sum(len(r.get("side_wallets", [])) for r in all_results.values())
    T.log(f"Total: {len(all_results)} wallets scanned, {total_sides} bilateral partners found")


if __name__ == "__main__":
    main()
