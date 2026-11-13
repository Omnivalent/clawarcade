"""Regression tests built from real mainnet transactions (first live run, 2026-11-13).

Fixtures in tests/fixtures/ are unmodified getTransaction (jsonParsed) results:
  4NDJ...  pump.fun create+buy of DaWgMW...pump by the deployer (a version 1 tx)
  e6tE...  same-slot buy co-signed by two wallets (EazJVJ... and 5sY1Zu...), also version 1

Run:  python3 -I tests/test_live_regressions.py   (prints OK or fails with an assertion)
"""
import json, os, sys, tempfile, types

os.environ["TRACER_CACHE"] = "none"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import solana_tracer as T

FIX = os.path.join(HERE, "fixtures")
MINT = "DaWgMWCiJrP4M5PdQvvy1LDcP6rr2EZpuWkaC42kpump"
CREATE = "4NDJbeMtk41DPL5UDiKv9VdYvQjQVYywCxZoBxd6uvnMJYEu8kGLS988LJ4xRZkqWXWJbx6NvstX7zkAmkSJzNk3"
COSIGN = "e6tE2MoqotRA8DAghmPeXmFJurgvw5sojatoFbriENGzQSXd7T4HKpxZv1FW1RTEwd65pyrxU7pA8Kp1k5qN26s"
DEPLOYER = "7jQwHdK771P286Vsn44v7dFVfCH8CzZcL3PZGidbShch"
EAZ = "EazJVJBwStmxeEx478Q1EAVHZrZbSgXN7N4m3MSBET8a"
FIVE = "5sY1ZuVuPN3VZBwRiEoaNHgTqXrZu9WTi1vqknvEqLdN"
TXS = {s: json.load(open(os.path.join(FIX, s + ".json"))) for s in (CREATE, COSIGN)}


def check(cond, msg):
    if not cond:
        sys.exit("FAIL: " + msg)
    print("ok  ", msg)


# 1. getTransaction must accept version 1 txs, and step up if the chain reports a newer version
calls = []
def fake_versions(method, params):
    calls.append(params[1]["maxSupportedTransactionVersion"])
    if params[1]["maxSupportedTransactionVersion"] < 2:
        raise ValueError("getTransaction: {'code': -32015, 'message': 'Transaction version (2) is not supported by "
                         "the requesting client. Please try the request again with the following configuration "
                         "parameter: \"maxSupportedTransactionVersion\": 2'}")
    return TXS[params[0]]
T.rpc = fake_versions
check(T.get_tx(CREATE)["slot"] == 468241432, "get_tx retries with the version the RPC asks for")
check(calls == [1, 2] and T.TX_VERSION[0] == 2, "first request asks for v1, retry asks for v2")

def fake_bad(method, params):
    raise ValueError("getTransaction: {'code': -32015, 'message': 'Transaction version (1) is not supported'}")
T.rpc, T.FAILED_TX[:] = fake_bad, []
try:
    T.get_tx(COSIGN); check(False, "should raise")
except ValueError:
    check(T.FAILED_TX == [COSIGN], "a version error that can't be fixed is recorded as a failed download")
T.TX_VERSION[0] = 1


# 2. token mode on the real launch txs: co-signers cluster together, deployer is not a SNIPER
def fake_chain(method, params):
    if method == "getTokenSupply":
        return {"value": {"uiAmountString": "1000000000"}}
    if method == "getSignaturesForAddress":
        if params[0] == MINT:
            return [{"signature": COSIGN, "err": None}, {"signature": CREATE, "err": None}]  # newest first
        return []  # wallets: history reached, no funder
    if method == "getTransaction":
        return TXS[params[0]]
    if method == "getTokenAccountsByOwner":
        return {"value": []}
    raise AssertionError(method)
T.rpc = fake_chain
T.DEEP.clear()
out = tempfile.mkdtemp()
os.chdir(out)
a = types.SimpleNamespace(mint=MINT, source=None, first=100, pages=3, max_wallets=80, hop2=False, merge_soft=False,
                          snipe_slots=10, hub_window=3600, hub_threshold=1000, labels=None)
T.token_mode(a)
res = json.load(open(os.path.join(out, "trace_token_DaWgMW.json")))
check(res["deployer"] == DEPLOYER, "deployer read from a version 1 create tx")
check(set(res["events"]) >= {DEPLOYER, EAZ, FIVE}, "all three launch-slot buyers found")
cl = [c for c in res["clusters"] if EAZ in c["members"]]
check(cl and FIVE in cl[0]["members"], "co-signing wallets are in one cluster")
check(any("co-signed the same transaction " + COSIGN in e for e in cl[0]["evidence"]),
      "evidence names the full co-signed signature")
check(MINT not in cl[0]["members"], "the mint keypair (a co-signer of the create tx) is never a cluster member")
check(DEPLOYER not in cl[0]["members"], "same slot alone does not merge the deployer")
rows = open(os.path.join(out, "trace_token_DaWgMW.csv")).read().splitlines()
dep = [r for r in rows if r.startswith(DEPLOYER)][0]
check("DEPLOYER" in dep and "SNIPER" not in dep, "deployer is tagged DEPLOYER, not SNIPER")


# 3. wallets whose start of history is out of reach are flagged, not silently 'no funder'
def fake_deep(method, params):
    if method == "getSignaturesForAddress":
        before = params[1].get("before")
        n = int(before[1:]) + 1 if before else 0
        return [{"signature": f"d{n + i}", "err": None} for i in range(1000)]
    if method == "getTransaction":
        return {"slot": 1, "blockTime": 1, "meta": {}, "transaction": {"message": {
            "accountKeys": [{"pubkey": FIVE, "signer": True}], "instructions": []}}}
    raise AssertionError(method)
T.rpc = fake_deep
T.DEEP.clear()
check(T.find_funder(FIVE) is None and FIVE in T.DEEP, "busy wallet goes into DEEP (tagged BUSY-WALLET)")


# 4. pump.fun auto source: bonding-curve address math and the creator-field rule (verified on mainnet 2026-11-13)
import base64
check(T.find_pda([b"bonding-curve", T.b58decode("C5xph2yL6gMdxmuLGxJBkGpmuDFfyi5fqkBNhvL6pump")], T.PUMP_PROGRAM)
      == "9nzxFL6UXZiMhPSyCqNDTXmPNdCUhtY3jwKoh7FTdeEP", "bonding curve PDA matches the live account")
check(T.find_pda([b"bonding-curve", T.b58decode(MINT)], T.PUMP_PROGRAM)
      == "BC2PbrJroJNBhTsbv1Aj2jmxGfvT8aaBQMt41EjjUjqE", "second PDA check")
def curve_acc(creator, graduated):
    d = bytes(8) + bytes(40) + bytes([1 if graduated else 0]) + T.b58decode(creator) + bytes(70)
    return {"value": {"owner": T.PUMP_PROGRAM, "data": [base64.b64encode(d).decode(), "base64"]}}
T.rpc = lambda m, p: curve_acc(DEPLOYER, False)
pc = T.pump_curve(MINT)
check(pc["creator"] == DEPLOYER and not pc["graduated"], "creator read when it is a real wallet")
T.rpc = lambda m, p: curve_acc("9nzxFL6UXZiMhPSyCqNDTXmPNdCUhtY3jwKoh7FTdeEP", True)
pc = T.pump_curve(MINT)
check(pc["creator"] is None and pc["graduated"], "off-curve creator (fee-share account) is not reported")
T.rpc = lambda m, p: {"value": None}
check(T.pump_curve(MINT) is None, "non-pump.fun mint: no auto source")

print("\nOK: all live-regression checks passed")
