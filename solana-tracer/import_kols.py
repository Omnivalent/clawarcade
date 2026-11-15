#!/usr/bin/env python3
"""Import a KOL list copied from any site (GMGN, Cielo, X lists...) into a kols CSV.

Paste the list into a text file (a copied table, a CSV export, or lines like "Name  Address"),
then run:
    python3 import_kols.py gmgn_paste.txt                -> writes/merges kols_gmgn.csv
    python3 import_kols.py gmgn_paste.txt --source gmgn --out kols_gmgn.csv

Every Solana wallet address found becomes one row; the rest of its line (or the line above,
when the address sits on its own line) becomes the name. Only real wallet addresses are kept
(on the ed25519 curve), so token mints that are program accounts and pools are skipped.
"""
import argparse
import csv
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import solana_tracer as T  # noqa: E402

ADDR = re.compile(r"(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])")
URL = re.compile(r"https?://\S+")


def parse(text):
    rows, prev = {}, ""
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        found = ADDR.findall(line)
        if not found:
            prev = line
            continue
        twitter = next((u for u in URL.findall(line) if "x.com/" in u or "twitter.com/" in u), "")
        for a in found:
            if not T.on_curve(a) or a in rows:
                continue
            name = URL.sub("", ADDR.sub("", line))
            name = re.sub(r"^\s*#?\d+[.)]?\s+", "", name)                       # leading rank
            name = re.sub(r"\s[+-]?[$]?[\d.,]+[kKmM%]?(\s*(SOL|USD|%))?.*$", "", name)  # trailing PnL figures
            name = name.strip(" ,;|\t-") or prev or "KOL"
            rows[a] = {"name": name[:60], "wallet": a, "twitter": twitter}
        prev = ""
    return rows


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("paste", help="text file with the copied list")
    p.add_argument("--source", default="gmgn")
    p.add_argument("--out", default=os.path.join(here, "kols_gmgn.csv"))
    a = p.parse_args()
    new = parse(open(a.paste, encoding="utf-8", errors="replace").read())
    old = {}
    if os.path.exists(a.out):
        with open(a.out, newline="") as f:
            old = {r["wallet"]: r for r in csv.DictReader(f)}
    added = [w for w in new if w not in old]
    for w, r in new.items():
        old.setdefault(w, {**r, "telegram": "", "kolscan_profit_sol_by_timeframe": "", "source": a.source})
    with open(a.out, "w", newline="") as f:
        cols = ["name", "wallet", "twitter", "telegram", "kolscan_profit_sol_by_timeframe", "source"]
        wr = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        wr.writeheader()
        for r in old.values():
            wr.writerow(r)
    print(f"{len(new)} wallets found, {len(added)} new; {len(old)} rows in {a.out}")


if __name__ == "__main__":
    main()
