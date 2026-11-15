import os, sys, types, io, contextlib
os.environ["TRACER_CACHE"] = "none"
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, ".."))
import solana_tracer as T

def addr(n): return (n + "1" * 44)[:44]
MINT, DEP, CURVE = addr("MINT"), addr("DEP"), addr("CURVE")
F, F2, HUBX, LAB, RAND1, RAND2 = addr("FUNDER"), addr("FUNDERTWO"), addr("HUBX"), addr("LABELED"), addr("RANDOM1"), addr("RANDOM2")
A, B, C, D, E, G, H, I, J, K = [addr(x) for x in "AAA BBB CCC DDD EEE GGG HHH III JJJ KKK".split()]
T0 = 1_700_000_000
SUPPLY = 1000.0

def tb(owner, amt, mint=MINT): return {"accountIndex": 0, "mint": mint, "owner": owner, "uiTokenAmount": {"uiAmountString": str(amt), "decimals": 6}}
def mk(slot, t, keys, ins=None, pre=None, post=None):
    return {"slot": slot, "blockTime": t,
            "transaction": {"message": {"accountKeys": [{"pubkey": k, "signer": s} for k, s in keys], "instructions": ins or []}},
            "meta": {"preTokenBalances": pre or [], "postTokenBalances": post or [], "innerInstructions": []}}
def transfer(src, dst, sol): return {"program": "system", "parsed": {"type": "transfer", "info": {"source": src, "destination": dst, "lamports": int(sol * 1e9)}}}
def fundtx(src, dst, sol, slot, t): return mk(slot, t, [(src, True), (dst, False)], [transfer(src, dst, sol)])

txs, sigs = {}, {}
buy_order = []
def buy(name, w, slot, dt, amt):
    sig = "buy_" + name
    # curve (non-signer) decreases, buyer (signer) increases
    txs[sig] = mk(slot, T0 + dt, [(w, True), (CURVE, False)], pre=[tb(CURVE, 900)], post=[tb(CURVE, 900 - amt), tb(w, amt)])
    buy_order.append(sig)

# creation tx: deployer signs, curve receives supply
txs["create"] = mk(90, T0, [(DEP, True), (CURVE, False)], pre=[], post=[tb(CURVE, 1000)])
buy_order.append("create")
buy("A", A, 91, 1, 50); buy("B", B, 91, 2, 50); buy("C", C, 92, 3, 50)
buy("D", D, 95, 10, 20); buy("E", E, 96, 12, 20); buy("G", G, 120, 300, 5)
buy("H", H, 100, 20, 30); buy("I", I, 130, 400, 5); buy("J", J, 140, 500, 5); buy("K", K, 141, 510, 5)
# mint history newest->oldest
sigs[MINT] = [{"signature": s, "err": None} for s in reversed(buy_order)]

def fund(w, src, sol, dt, slot):
    s = "fund_" + w[:3]
    txs[s] = fundtx(src, w, sol, slot, T0 + dt); sigs[w] = [{"signature": s, "err": None}]
fund(A, F, 1.5, -600, 50); fund(B, F, 1.5, -590, 51); fund(C, F, 1.5, -580, 52)
fund(D, HUBX, 1.0, -3000, 53); fund(E, HUBX, 1.0, -2900, 54); fund(G, HUBX, 2.0, -100000, 55)
fund(H, DEP, 0.7, -400, 56); fund(I, RAND1, 0.3, -90000, 57)
fund(J, LAB, 0.8, -800, 58); fund(K, LAB, 0.8, -790, 59)
fund(DEP, F2, 0.5, -5000, 40)
sigs[F] = [{"signature": "dummy", "err": None}] * 5          # small funder = not a hub
sigs[LAB] = [{"signature": "dummy", "err": None}] * 5
sigs[HUBX] = [{"signature": "dummy", "err": None}] * 1000    # full page = hub
BAL = {A: 40, B: 0, C: 50, D: 0, E: 20, G: 5, H: 30, I: 5, J: 5, K: 5, DEP: 0}

def fake(method, params):
    if method == "getSignaturesForAddress":
        lim = params[1]["limit"]; lst = sigs.get(params[0], [])
        before = params[1].get("before")
        if before:
            idx = [s["signature"] for s in lst].index(before); lst = lst[idx + 1:]
        return lst[:lim]
    if method == "getTransaction": return txs.get(params[0])
    if method == "getTokenSupply": return {"value": {"uiAmountString": str(SUPPLY)}}
    if method == "getTokenAccountsByOwner":
        return {"value": [{"account": {"data": {"parsed": {"info": {"tokenAmount": {"uiAmountString": str(BAL.get(params[0], 0))}}}}}}]}
    raise AssertionError(method)
T.rpc = fake

def ns(**kw):
    d = dict(mint=MINT, source=None, first=100, pages=3, max_wallets=80, hop2=False, merge_soft=False,
             snipe_slots=10, hub_window=3600, hub_threshold=1000, labels=None)
    d.update(kw); return types.SimpleNamespace(**d)

os.chdir(HERE)
with open("labels_test.csv", "w") as f: f.write(f"{LAB},Test Exchange\n")
T.token_mode(ns(labels="labels_test.csv"))
print("\n\n######## hop2 + merge_soft ########")
T.token_mode(ns(hop2=True, merge_soft=True))
print("\n\n######## not reached start (pages=1, tiny first=3) ########")
T.token_mode(ns(first=3, pages=1))
