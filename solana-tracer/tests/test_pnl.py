"""Offline checks for pnl mode math (average-cost realized PnL, trade classification).
Run: python3 -I tests/test_pnl.py"""
import os, sys
os.environ["TRACER_CACHE"] = "none"
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, ".."))
import solana_tracer as T


def check(c, m):
    if not c:
        sys.exit("FAIL: " + m)
    print("ok  ", m)


t = lambda k, tok, sol: {"kind": k, "tokens": tok, "sol": sol, "sig": "s", "time": 0, "counterparty": None}

# buy 100 for 1 SOL, buy 100 for 3 SOL (avg 0.02/token), sell 100 for 5 SOL -> basis 2, pnl +3
r = T.realized([t("BUY", 100, -1), t("BUY", 100, -3), t("SELL", 100, 5)])
check(abs(r["realized_sol"] - 3) < 1e-9 and abs(r["held_tokens"] - 100) < 1e-9, "average cost, partial sell")
# full exit at a loss
r = T.realized([t("BUY", 50, -2), t("SELL", 50, 0.5)])
check(abs(r["realized_sol"] + 1.5) < 1e-9 and r["held_tokens"] == 0, "full exit at a loss")
# free tokens in are flagged and count at zero cost
r = T.realized([t("XFER_IN", 100, 0), t("SELL", 100, 2)])
check(abs(r["realized_sol"] - 2) < 1e-9 and r["free_tokens_in"] == 100, "free tokens flagged")
# transfer out removes basis without realizing
r = T.realized([t("BUY", 100, -1), t("XFER_OUT", 50, 0), t("SELL", 50, 1)])
check(abs(r["realized_sol"] - 0.5) < 1e-9, "transfer out moves basis, not profit")
# selling more than recorded (history gap) never divides by zero
r = T.realized([t("SELL", 10, 1)])
check(r["realized_sol"] == 1, "sell without recorded buy counts as zero basis")

# ATA derivation: known wallet/mint/program -> ATA seen live (from the DaWgMW co-signed fixture)
import json
tx = json.load(open(os.path.join(HERE, "fixtures",
     "e6tE2MoqotRA8DAghmPeXmFJurgvw5sojatoFbriENGzQSXd7T4HKpxZv1FW1RTEwd65pyrxU7pA8Kp1k5qN26s.json")))
keys = T.keys_of(tx)
mint = "DaWgMWCiJrP4M5PdQvvy1LDcP6rr2EZpuWkaC42kpump"
pairs = [(keys[b["accountIndex"]], b["owner"], b["programId"]) for b in tx["meta"]["postTokenBalances"]
         if b["mint"] == mint and T.on_curve(b["owner"])]
check(pairs and all(T.owner_ata(o, mint, p) == acct for acct, o, p in pairs), "ATA derivation matches live token accounts")
print("\nOK: pnl checks passed")
