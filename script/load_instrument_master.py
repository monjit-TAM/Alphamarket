#!/usr/bin/env python3
"""
Loads Zerodha public instruments CSV into instrument_master.
Safe to run repeatedly -- uses UPSERT on PK (instrument_token).
Filters: NSE, BSE, NFO, BFO only. Skips MCX/CDS/currency.
"""
import csv, sys, os
from datetime import datetime
import psycopg2
from psycopg2.extras import execute_batch

DB = "postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db"
CSV_PATH = "/var/www/alphamarket/data/zerodha_instruments.csv"
KEEP = {"NSE", "BSE", "NFO", "NCO", "BFO", "MCX"}

def pdate(s):
    if not s or not s.strip(): return None
    try: return datetime.strptime(s.strip(), "%Y-%m-%d").date()
    except Exception: return None

def pnum(s, as_int=False):
    if not s or not s.strip(): return None
    try: return int(float(s)) if as_int else float(s)
    except Exception: return None

def main():
    if not os.path.exists(CSV_PATH):
        print("ERROR: CSV not found. Run fetch step first.")
        sys.exit(1)
    rows_in = 0; rows_kept = 0; batch = []
    conn = psycopg2.connect(DB); conn.autocommit = False; cur = conn.cursor()
    SQL = """
      INSERT INTO instrument_master
        (instrument_token, exchange_token, tradingsymbol, name, expiry, strike,
         tick_size, lot_size, instrument_type, segment, exchange, last_refreshed)
      VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, NOW())
      ON CONFLICT (instrument_token) DO UPDATE SET
        exchange_token=EXCLUDED.exchange_token, tradingsymbol=EXCLUDED.tradingsymbol,
        name=EXCLUDED.name, expiry=EXCLUDED.expiry, strike=EXCLUDED.strike,
        tick_size=EXCLUDED.tick_size, lot_size=EXCLUDED.lot_size,
        instrument_type=EXCLUDED.instrument_type, segment=EXCLUDED.segment,
        exchange=EXCLUDED.exchange, last_refreshed=NOW();
    """
    try:
        with open(CSV_PATH, newline="") as f:
            reader = csv.DictReader(f)
            for r in reader:
                rows_in += 1
                if r["exchange"] not in KEEP: continue
                try:
                    batch.append((
                        int(r["instrument_token"]), int(r["exchange_token"]),
                        r["tradingsymbol"], r["name"],
                        pdate(r["expiry"]), pnum(r["strike"]),
                        pnum(r["tick_size"]), pnum(r["lot_size"], as_int=True),
                        r["instrument_type"], r["segment"], r["exchange"],
                    ))
                    rows_kept += 1
                except Exception as e:
                    print(f"SKIP row {rows_in}: {e}"); continue
                if len(batch) >= 5000:
                    execute_batch(cur, SQL, batch, page_size=5000); batch = []
        if batch: execute_batch(cur, SQL, batch, page_size=5000)
        conn.commit()
        print(f"OK  rows_in={rows_in}  kept={rows_kept}")
    except Exception as e:
        conn.rollback()
        print(f"FAIL  {type(e).__name__}: {e}"); sys.exit(2)
    finally:
        cur.close(); conn.close()

if __name__ == "__main__":
    main()
