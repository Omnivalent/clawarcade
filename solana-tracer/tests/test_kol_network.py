"""Offline checks for kol_network.py: transfer filter and incremental scanning.
Run: python3 -I tests/test_kol_network.py"""
import os, sys
os.environ["TRACER_CACHE"] = "none"
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, ".."))
import solana_tracer as T
import kol_network as K


def check(c, m):
    if not c:
        sys.exit("FAIL: " + m)
    print("ok  ", m)


KOL = "4Be9CvxqHW6BYiRAxW9Q3xu1ycTMWaL5z8NX4HR3ha7t"
SIDE = "5sY1ZuVuPN3VZBwRiEoaNHgTqXrZu9WTi1vqknvEqLdN"
POOL = "9nzxFL6UXZiMhPSyCqNDTXmPNdCUhtY3jwKoh7FTdeEP"   # off-curve (pump.fun curve)
SYS = "11111111111111111111111111111111"
PRICE = 100.0


def tx(ins, signer=KOL, t=1000):
    return {"slot": 1, "blockTime": t, "meta": {"innerInstructions": [], "preTokenBalances": [], "postTokenBalances": [],
            "preBalances": [0, 0], "postBalances": [0, 0]},
            "transaction": {"message": {"accountKeys": [{"pubkey": signer, "signer": True}], "instructions": ins}}}


def sol(a, b, s):
    return {"programId": SYS, "program": "system", "parsed": {"type": "transfer",
            "info": {"source": a, "destination": b, "lamports": int(s * 1e9)}}}


swap = {"programId": "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"}

# --- filter
check(len(K.transfers_of(tx([sol(KOL, SIDE, 6)]), KOL, PRICE, 500)) == 1, "6 SOL ($600) plain transfer counts")
check(K.transfers_of(tx([sol(KOL, SIDE, 4)]), KOL, PRICE, 500) == [], "4 SOL ($400) is under $500")
check(K.transfers_of(tx([sol(KOL, SIDE, 6), swap]), KOL, PRICE, 500) == [], "a tx that also touches a DEX is a swap: skipped")
check(K.transfers_of(tx([sol(KOL, POOL, 9)]), KOL, PRICE, 500) == [], "transfers to pool / program accounts are skipped")
check(len(K.transfers_of(tx([sol(SIDE, KOL, 3), sol(SIDE, KOL, 3)]), KOL, PRICE, 500)) == 1,
      "two 3 SOL pieces in one tx add up to $600")

# --- incremental scanning over a fake history of 2500 txs (newest first)
hist = [f"s{i}" for i in range(2500)]           # s0 newest ... s2499 oldest
TXS = {s: tx([sol(KOL, SIDE, 6)], t=10_000 - i) if i % 500 == 7 else tx([sol(KOL, SIDE, 0.1)], t=10_000 - i)
       for i, s in enumerate(hist)}


def fake(method, params):
    if method == "getTransaction":
        return TXS[params[0]]
    if method == "getSignaturesForAddress":
        o = params[1]
        lst = hist
        if o.get("until"):
            lst = lst[:lst.index(o["until"])]
        if o.get("before"):
            lst = lst[lst.index(o["before"]) + 1:]
        return [{"signature": s, "err": None, "blockTime": TXS[s]["blockTime"]} for s in lst[:o["limit"]]]
    raise AssertionError(method)


T.rpc = fake
st = {}
K.scan_wallet(KOL, st, PRICE, 500, 700)
check(st["newest"] == "s0" and st["oldest"] == "s699" and not st.get("complete"), "run 1 reads the newest 700")
check(sorted(st["transfers"]) == ["s507", "s7"],
      "run 1 finds the two $600 transfers in that range")
K.scan_wallet(KOL, st, PRICE, 500, 1000)
check(st["oldest"] == "s1699" and not st.get("complete"), "run 2 continues backwards from where run 1 stopped")
hist.insert(0, "new1"); TXS["new1"] = tx([sol(SIDE, KOL, 8)], t=20_000)
K.scan_wallet(KOL, st, PRICE, 500, 1000)
check("new1" in st["transfers"] and st["newest"] == "new1", "run 3 picks up a new incoming transfer first")
check(st.get("complete") and st["oldest"] == "s2499", "run 3 then reaches the start of history")
check(sorted(st["transfers"]) == sorted(["new1", "s7", "s507", "s1007", "s1507", "s2007"]),
      "every qualifying transfer found exactly once")

# --- output network
out = K.build_output({KOL: {"name": "Test", "twitter": "", "source": "t"}}, {KOL: st}, {}, PRICE, 500)
r1 = out["kols"][0]["ring1"]
check(len(r1) == 1 and r1[0]["wallet"] == SIDE and r1[0]["sent_usd"] == 3000 and r1[0]["recv_usd"] == 800,
      "ring 1 sums $3000 sent and $800 received with the side wallet")
print("\nOK: kol_network checks passed")
