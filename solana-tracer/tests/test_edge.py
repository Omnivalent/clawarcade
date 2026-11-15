import os, sys, types, io, json, urllib.error, tempfile
os.environ["TRACER_CACHE"] = "none"
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, ".."))
import solana_tracer as T
exec(open(os.path.join(HERE, "test_v2.py")).read().split("def ns(")[0].split("import solana_tracer as T")[1].replace("T.rpc = fake",""))  # reuse fixtures
T.rpc = fake
def ns(**kw):
    d = dict(mint=MINT, source=None, first=100, pages=3, max_wallets=80, hop2=False, merge_soft=False,
             snipe_slots=10, hub_window=3600, hub_threshold=1000, labels=None); d.update(kw); return types.SimpleNamespace(**d)

print("##### A. history NOT reached (mint has 2500 sigs)")
real = sigs[MINT]
sigs[MINT] = [{"signature": f"x{i}", "err": None} for i in range(2500)]
for i in range(2500): txs[f"x{i}"] = mk(1000 + i, T0 + 5000 + i, [(addr("Z%d" % (i % 7)), True), (CURVE, False)],
                                        pre=[tb(CURVE, 900)], post=[tb(CURVE, 899), tb(addr("Z%d" % (i % 7)), 1)])
T.token_mode(ns(pages=2, first=20))
sigs[MINT] = real

print("\n##### B. no buyers at all (only creation tx)")
sigs[MINT] = [{"signature": "create", "err": None}]
T.token_mode(ns())
sigs[MINT] = real

print("\n##### C. empty history must exit cleanly")
sigs["EMPTY" + "1" * 39] = []
try: T.token_mode(ns(mint="EMPTY" + "1" * 39))
except SystemExit as e: print("SystemExit:", e)

print("\n##### D. wallet mode with chain up (A <- F, F <- ?), counterparties")
fund(F, addr("UPSTREAM"), 9.0, -9000, 30)   # F funded by UPSTREAM
sigs[addr("UPSTREAM")] = [{"signature": "dummy", "err": None}] * 1000   # hub
txs["xfer"] = fundtx(A, addr("SINK"), 0.25, 200, T0 + 100)
sigs[A] = [{"signature": "xfer", "err": None}, {"signature": "fund_" + A[:3], "err": None}]
T.wallet_mode(types.SimpleNamespace(address=A, limit=300, top=30, trace_up=3, hub_threshold=1000, labels=None))

print("\n##### E. address validation")
for bad in ["short", "0OIl" + "1" * 40]:
    try: T.need_addr(bad, "wallet")
    except SystemExit as e: print("SystemExit:", e)

print("\n##### F. rpc(): 429 retry then success; 403 -> friendly error")
class R:
    def __init__(s, d): s.d = d
    def read(s, *a): return json.dumps(s.d).encode()
    def __enter__(s): return s
    def __exit__(s, *a): pass
calls = {"n": 0}
def urlopen_429(req, timeout=0):
    calls["n"] += 1
    if calls["n"] < 3: raise urllib.error.HTTPError("u", 429, "rl", {}, None)
    return R({"jsonrpc": "2.0", "id": 1, "result": 42})
T_rpc_real = T.__dict__["rpc"]
import importlib; importlib.reload(T)       # restore real rpc
os.environ["TRACER_RPS"] = "1000"; T.MAX_RPS = 1000
T.time.sleep = lambda s: None
T.urllib.request.urlopen = urlopen_429
print("result:", T.rpc("getHealth", []), "after", calls["n"], "calls")
def urlopen_403(req, timeout=0): raise urllib.error.HTTPError("u", 403, "forbidden", {}, None)
T.urllib.request.urlopen = urlopen_403
try: T.rpc("getHealth", [])
except RuntimeError as e: print("RuntimeError:", e)
def urlopen_err(req, timeout=0): return R({"jsonrpc": "2.0", "id": 1, "error": {"code": -32602, "message": "bad"}})
T.urllib.request.urlopen = urlopen_err
try: T.rpc("getHealth", [])
except ValueError as e: print("ValueError:", e)

print("\n##### G. cache roundtrip")
d = tempfile.mkdtemp(); T.CACHE = d
T.cache_put("tx", "sigABC", {"a": 1}); print("cache hit:", T.cache_get("tx", "sigABC"), "miss:", T.cache_get("tx", "nope"))
T.CACHE = "none"; print("disabled:", T.cache_get("tx", "sigABC"))
