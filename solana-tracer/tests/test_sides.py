"""Offline checks for sides mode. Run: python3 -I tests/test_sides.py"""
import os, sys
os.environ["TRACER_CACHE"] = "none"
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, ".."))
import solana_tracer as T

def check(c, m):
    if not c:
        sys.exit("FAIL: " + m)
    print("ok  ", m)

KOL = "ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT"   # real on-curve wallets used as stand-ins
BOT = "EazJVJBwStmxeEx478Q1EAVHZrZbSgXN7N4m3MSBET8a"
SIDE = "5sY1ZuVuPN3VZBwRiEoaNHgTqXrZu9WTi1vqknvEqLdN"

def tx(signers, keys, pre, post, ins=()):
    return {"slot": 1, "blockTime": 100, "meta": {"preBalances": pre, "postBalances": post, "innerInstructions": [],
            "preTokenBalances": [], "postTokenBalances": []},
            "transaction": {"message": {"accountKeys": [{"pubkey": k, "signer": k in signers} for k in keys],
                                        "instructions": list(ins)}}}

xfer = lambda a, b, lam: {"program": "system", "parsed": {"type": "transfer",
                          "info": {"source": a, "destination": b, "lamports": lam}}}
TXS = {
    # copy-trade bot tx that merely mentions the KOL: must be ignored entirely
    "bot1": tx([BOT], [BOT, KOL], [10**9, 5 * 10**9], [10**9 - 5000, 5 * 10**9]),
    # KOL co-signs with SIDE and sends it 2 SOL
    "own1": tx([KOL, SIDE], [KOL, SIDE], [5 * 10**9, 0], [3 * 10**9 - 5000, 2 * 10**9], [xfer(KOL, SIDE, 2 * 10**9)]),
}
def fake(method, params):
    if method == "getSignaturesForAddress":
        return [{"signature": "bot1", "err": None}, {"signature": "own1", "err": None}]
    if method == "getTransaction":
        return TXS[params[0]]
    raise AssertionError(method)
T.rpc = fake
cp, cosig, buys, n, span, noise = T.recent_activity(KOL, 50)
check(n == 1 and abs(noise - 0.5) < 1e-9, "txs that only mention the wallet are skipped and counted as noise")
check(BOT not in cosig, "a bot signing its own tx that mentions the KOL is NOT a co-signer")
check(SIDE in cosig, "a wallet signing together with the KOL IS a co-signer")
check(abs(cp[SIDE]["sent"] - 2) < 1e-9, "SOL sent to the side wallet is recorded")
print("\nOK: sides checks passed")
