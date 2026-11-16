#!/usr/bin/env python3
"""
Map how coins were launched and traded. For each coin:
  1. Find deployer, launch buyers, bundlers
  2. Find deployer handouts (who got free supply)
  3. Cross-reference with our KOL wallet list
  4. Check which tracked wallets traded this coin and their PnL

Usage:
  python3 coin_mapper.py --coins FILE --kols FILE --out DIR [--pages 10]
"""
import argparse, json, os, sys, time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import solana_tracer as T
import pattern_scan as PS

def map_coin(mint, name, kol_addrs, pages=10):
    """Full analysis of a single coin."""
    T.log(f"\n{'='*60}")
    T.log(f"Mapping coin: {name} ({mint})")
    T.log(f"{'='*60}")

    result = {"name": name, "mint": mint}

    # 1. Launch info
    T.log("  [1] Getting launch info...")
    info = PS.launch_info(mint, pages)
    result["pump"] = info.get("pump", False)
    result["graduated"] = info.get("graduated", False)
    result["creator"] = info.get("creator")
    result["deployer"] = info.get("deployer")
    result["create_sig"] = info.get("create_sig")
    result["launch_time"] = info.get("launch_time")
    result["launch_slot"] = info.get("launch_slot")
    result["launch_reached"] = info.get("launch_reached", False)

    launch_buyers = info.get("launch_buyers", [])
    bundles = [b for b in launch_buyers if b.get("same_block")]
    result["launch_buyers"] = launch_buyers
    result["bundle_count"] = len(bundles)
    T.log(f"  Deployer: {result.get('deployer', '?')}")
    T.log(f"  Creator: {result.get('creator', '?')}")
    T.log(f"  Launch buyers: {len(launch_buyers)}, same-block bundles: {len(bundles)}")

    # 2. Deployer handouts
    dep = info.get("deployer") or info.get("creator")
    result["deployer_handouts"] = []
    if dep:
        T.log(f"  [2] Checking deployer trades for handouts...")
        try:
            dt = PS.coin_trades(dep, mint)
            handouts = [t for t in dt.get("trades", []) if t["kind"] == "XFER_OUT" and t.get("tokens", 0) > 10000]
            result["deployer_handouts"] = handouts
            result["deployer_pnl"] = {
                "realized_sol": dt.get("realized_sol", 0),
                "spent_sol": dt.get("spent_sol", 0),
                "received_sol": dt.get("received_sol", 0),
                "held_tokens": dt.get("held_tokens", 0),
            }
            T.log(f"  Deployer handouts: {len(handouts)} (>10k tokens)")
        except Exception as e:
            T.log(f"  ! Deployer trades error: {e}")

    # 3. Cross-reference with KOL wallets
    T.log(f"  [3] Cross-referencing with {len(kol_addrs)} KOL wallets...")
    kol_activity = {}
    for kol_name, kol_addr in kol_addrs.items():
        try:
            st = PS.coin_trades(kol_addr, mint)
            trades = st.get("trades", [])
            if trades:
                buys = [t for t in trades if t["kind"] == "BUY"]
                sells = [t for t in trades if t["kind"] == "SELL"]
                xfer_in = [t for t in trades if t["kind"] == "XFER_IN"]
                xfer_out = [t for t in trades if t["kind"] == "XFER_OUT"]
                kol_activity[kol_addr] = {
                    "name": kol_name,
                    "realized_sol": st.get("realized_sol", 0),
                    "spent_sol": st.get("spent_sol", 0),
                    "received_sol": st.get("received_sol", 0),
                    "held_tokens": st.get("held_tokens", 0),
                    "free_tokens_in": st.get("free_tokens_in", 0),
                    "buy_count": len(buys),
                    "sell_count": len(sells),
                    "xfer_in_count": len(xfer_in),
                    "xfer_out_count": len(xfer_out),
                    "trades": trades,
                    "complete": st.get("complete", False),
                }
                T.log(f"    {kol_name}: {len(buys)} buys, {len(sells)} sells, "
                      f"realized={st.get('realized_sol',0):.1f} SOL, held={st.get('held_tokens',0):.0f}")
        except Exception as e:
            pass  # wallet didn't trade this coin
        time.sleep(0.2)  # gentle on RPC

    result["kol_activity"] = kol_activity

    # 4. Check if any bundlers are in our KOL list
    kol_set = set(kol_addrs.values())
    bundler_kols = []
    for b in bundles:
        if b["wallet"] in kol_set:
            name_match = [n for n, a in kol_addrs.items() if a == b["wallet"]]
            bundler_kols.append({"wallet": b["wallet"], "name": name_match[0] if name_match else "?",
                                 "tokens": b["tokens"], "sol": b.get("sol", 0)})

    # Also check handout recipients against KOL list
    handout_kols = []
    for h in result.get("deployer_handouts", []):
        cp = h.get("counterparty", "")
        if cp in kol_set:
            name_match = [n for n, a in kol_addrs.items() if a == cp]
            handout_kols.append({"wallet": cp, "name": name_match[0] if name_match else "?",
                                 "tokens": h["tokens"], "sig": h.get("sig", "")})

    result["bundler_kols"] = bundler_kols
    result["handout_kols"] = handout_kols

    if bundler_kols:
        T.log(f"  !! KOLs that BUNDLED: {[b['name'] for b in bundler_kols]}")
    if handout_kols:
        T.log(f"  !! KOLs that got HANDOUTS: {[h['name'] for h in handout_kols]}")

    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--coins", required=True, help="JSON {name: mint}")
    p.add_argument("--kols", required=True, help="JSON {name: addr}")
    p.add_argument("--out", required=True)
    p.add_argument("--pages", type=int, default=10)
    a = p.parse_args()

    os.makedirs(a.out, exist_ok=True)
    coins = json.load(open(a.coins))
    kols = json.load(open(a.kols))

    all_results = {}
    for name, mint in coins.items():
        cache = os.path.join(a.out, f"{name}.json")
        if os.path.exists(cache):
            T.log(f"Coin {name} already cached")
            all_results[name] = json.load(open(cache))
            continue
        try:
            result = map_coin(mint, name, kols, a.pages)
            all_results[name] = result
            json.dump(result, open(cache, "w"), indent=2)
        except Exception as e:
            T.log(f"! Error mapping {name}: {e}")

    json.dump(all_results, open(os.path.join(a.out, "all_coins.json"), "w"), indent=2)
    T.log(f"\nAll coins saved to {a.out}/all_coins.json")


if __name__ == "__main__":
    main()
