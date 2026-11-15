#!/usr/bin/env python3
"""Grow kols.csv from kolscan.io: the leaderboard (top KOLs by day/week/month) plus the live trade
feed on the home page, which shows KOLs that are not on the leaderboard. Each poll is one page
request; run it on every scheduled scan so the list keeps growing.

Usage: python3 collect_kolscan.py [--polls 6] [--interval 20] [--out kols.csv]
"""
import argparse
import csv
import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import solana_tracer as T  # noqa: E402

COLS = ["name", "wallet", "twitter", "telegram", "kolscan_profit_sol_by_timeframe", "source"]
PROFILE = re.compile(r'\{"wallet_address":"([1-9A-HJ-NP-Za-km-z]{32,44})","name":"((?:[^"\\]|\\.)*)",'
                     r'"telegram":(null|"[^"]*"),"twitter":(null|"[^"]*")')
FEED = re.compile(r'"wallet_address":"([1-9A-HJ-NP-Za-km-z]{32,44})","timestamp":\d+,[^{}]*?"name":"((?:[^"\\]|\\.)*)"')


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (solana-tracer)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace").replace('\\"', '"')


def clean(n):
    try:
        n = n.encode().decode("unicode_escape").encode("latin-1").decode("utf-8") if "\\u" in n else n
    except Exception:
        pass
    return n.strip()[:60] or "KOL"


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--polls", type=int, default=6, help="home-page feed polls")
    p.add_argument("--interval", type=float, default=20, help="seconds between polls")
    p.add_argument("--out", default=os.path.join(here, "kols.csv"))
    a = p.parse_args()

    rows = {}
    if os.path.exists(a.out):
        with open(a.out, newline="") as f:
            rows = {r["wallet"]: r for r in csv.DictReader(f)}
    before = len(rows)
    today = time.strftime("%Y-%m-%d", time.gmtime())

    def add(w, name, tw="", tg="", src="kolscan.io"):
        if w in rows or not T.B58.match(w) or not T.on_curve(w):
            return
        rows[w] = {"name": clean(name), "wallet": w, "twitter": tw, "telegram": tg,
                   "kolscan_profit_sol_by_timeframe": "", "source": f"{src} {today}"}

    pages = ["https://kolscan.io/leaderboard"] + ["https://kolscan.io/"] * max(1, a.polls)
    for i, url in enumerate(pages):
        try:
            s = fetch(url)
        except Exception as e:
            print(f"  ! {url}: {e}", file=sys.stderr)
            continue
        for m in PROFILE.finditer(s):
            w, n, tg, tw = m.groups()
            add(w, n, tw.strip('"') if tw != "null" else "", tg.strip('"') if tg != "null" else "",
                "kolscan.io leaderboard" if "leaderboard" in url else "kolscan.io")
        for m in FEED.finditer(s):
            add(m.group(1), m.group(2), src="kolscan.io live feed")
        if url.endswith("/") and i < len(pages) - 1:
            time.sleep(a.interval)

    with open(a.out, "w", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        wr.writeheader()
        for r in rows.values():
            wr.writerow(r)
    print(f"{len(rows) - before} new KOLs added; {len(rows)} in {a.out}")


if __name__ == "__main__":
    main()
