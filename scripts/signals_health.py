#!/usr/bin/env python3
import sys, subprocess
from datetime import datetime, timedelta
BOX = sys.argv[1] if len(sys.argv) > 1 else "dyor"
CONFIG = {
 "testalpha": {"db": "alphaforge", "families": [
   ("algo_signals","created_at",1,"5 algos + ALGO3 options"),
   ("alpha_options_signals","created_at",1,"spread + multi-leg generators"),
   ("bot_signals","created_at",1,"AlphaBot"),
   ("alpha_ideas_log","created_at",30,"auxiliary log")]},
 "dyor": {"db": "dyor_db", "families": [
   ("algo_signals","created_at",1,"5 stock algos"),
   ("alpha_options_signals","signal_date",1,"KNOWN DEAD since 18 Jun - generator never ported"),
   ("bot_signals","created_at",1,"AlphaBot (DYOR) - observed EMPTY 13 Jul"),
   ("alpha_ideas_log","created_at",30,"auxiliary log")]}}
def last_trading_day(d):
    while d.weekday() >= 5: d -= timedelta(days=1)
    return d
def q(db, sql):
    r = subprocess.run(["sudo","-u","postgres","psql",db,"-At","-c",sql],capture_output=True,text=True,timeout=30)
    return (None, (r.stderr.strip().splitlines() or ["psql error"])[-1]) if r.returncode else (r.stdout.strip(), None)
def main():
    cfg = CONFIG[BOX]; now = datetime.now(); stale = []
    print(f"[{now:%Y-%m-%d %H:%M:%S}] signals-health ({BOX})")
    for table, col, max_days, note in cfg["families"]:
        out, err = q(cfg["db"], f"SELECT max({col})::text FROM {table};")
        if err: print(f"  SKIP   {table:24} ({err[:60]})"); continue
        if not out: print(f"  STALE  {table:24} table EMPTY | {note}"); stale.append(table); continue
        try: newest = datetime.fromisoformat(out.split("+")[0].split(".")[0])
        except ValueError: print(f"  SKIP   {table:24} unparseable: {out[:30]}"); continue
        bar = last_trading_day(now.date() - timedelta(days=max_days - 1))
        ok = newest.date() >= bar
        print(f"  {'OK   ' if ok else 'STALE'}  {table:24} newest {newest.date()} (bar {bar}) | {note}")
        if not ok: stale.append(table)
    if stale: print(f"  >>> STALE: {', '.join(stale)}"); sys.exit(1)
    print("  all families fresh"); sys.exit(0)
main()
