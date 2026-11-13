import os, sys, types
os.environ["TRACER_CACHE"]="none"; HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, ".."))
import solana_tracer as T
exec(open(os.path.join(HERE, "test_v2.py")).read().split("def ns(")[0].split("import solana_tracer as T")[1].replace("T.rpc = fake",""))
def fake2(m,p):
    if m=="getTransaction" and p[0]=="create": return None   # oldest tx unavailable
    return fake(m,p)
T.rpc=fake2
a=types.SimpleNamespace(mint=MINT,source=None,first=0,pages=3,max_wallets=80,hop2=False,merge_soft=False,snipe_slots=10,hub_window=3600,hub_threshold=1000,labels=None)
T.token_mode(a)
