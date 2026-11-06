#!/usr/bin/env python3
"""
scripts/refresh_patterns.py — post-close universe pattern scan.

Runs the detector suite (pattern_engine) over the F&O/sb_universe symbol list
across daily / weekly / monthly timeframes and rebuilds pattern_scan_cache.
Scheduled: root cron, 16:00 IST weekdays (patterns on daily candles change
once per day — one honest refresh, not intraday churn).

Rules:
  - Real candle data via groww_service; symbols with insufficient/failed data
    are SKIPPED and counted (never guessed).
  - Cache rebuild is atomic per timeframe: DELETE+INSERT in one transaction.
  - Structures below confidence 55 are not cached (noise floor).
Usage:
  /opt/alphaforge-venv/bin/python3 /var/www/testalpha/scripts/refresh_patterns.py
  ... --limit 100      (symbol cap, for testing)
"""
import asyncio
import json
import sys
from datetime import datetime, timedelta

sys.path.insert(0, "/opt/dyor-backend")
sys.path.insert(0, "/opt/dyor-backend/routers")

import asyncpg
import redis

from pattern_engine import scan as engine_scan, TIMEFRAMES

DB_URL = "postgresql://dyor_user:DyorSecure2026Mar@localhost:5432/dyor_db"
MIN_CACHE_CONF = 55
HISTORY_YEARS = 10


def log(m):
    print(f"[{datetime.now():%H:%M:%S}] {m}", flush=True)


def universe_symbols(limit=None):
    r = redis.Redis(db=1)
    raw = r.get("sb_universe")
    r.close()
    if not raw:
        return []
    syms = [x.get("symbol") for x in json.loads(raw) if x.get("symbol")]
    return syms[:limit] if limit else syms


def _yf_daily(symbol: str):
    """10y daily candles via yfinance (SYMBOL.NS) — the data path already in
    active use by this service. Returns oldest-first candle dicts or None."""
    import yfinance as yf
    try:
        df = yf.download(f"{symbol.upper()}.NS", period="10y", interval="1d",
                         progress=False, auto_adjust=True)
    except Exception:
        return None
    if df is None or df.empty:
        return None
    # yfinance may return MultiIndex columns for single symbols; flatten
    if hasattr(df.columns, "levels"):
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    out = []
    for idx, r in df.iterrows():
        try:
            out.append({"date": str(idx)[:10],
                        "open": float(r["Open"]), "high": float(r["High"]),
                        "low": float(r["Low"]), "close": float(r["Close"]),
                        "volume": int(r.get("Volume", 0) or 0)})
        except Exception:
            continue
    out.sort(key=lambda c: c["date"])
    return out


async def fetch_daily(_unused, symbol):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _yf_daily, symbol)


async def main(limit=None):
    log("=== Pattern cache refresh starting ===")
    g = None  # data source is yfinance (_yf_daily)
    syms = universe_symbols(limit)
    if not syms:
        log("ABORT: universe empty")
        return
    log(f"universe: {len(syms)} symbols; timeframes: {list(TIMEFRAMES)}")

    rows = []          # (symbol, timeframe, pattern, ..., last_close)
    scanned = skipped = 0
    for i, sym in enumerate(syms):
        daily = await fetch_daily(g, sym)
        if not daily or len(daily) < 60:
            skipped += 1
            continue
        scanned += 1
        last_close = daily[-1]["close"]
        for tf in TIMEFRAMES:
            res = engine_scan(daily, tf)
            if not res or not res["data_ok"]:
                continue
            for p in res["patterns"]:
                if p["confidence"] < MIN_CACHE_CONF:
                    continue
                from datetime import date as _dtd
                def _d(s):
                    try:
                        return _dtd.fromisoformat(str(s)[:10]) if s else None
                    except Exception:
                        return None
                rows.append((sym, tf, p["pattern"], p["direction"],
                             p["confidence"], _d(p["start_date"]), _d(p["end_date"]),
                             p["entry"], p["target"], p["stoploss"],
                             p["note"], p["kind"], last_close))
        if (i + 1) % 100 == 0:
            log(f"  {i+1}/{len(syms)} scanned={scanned} skipped={skipped} "
                f"patterns={len(rows)}")
        await asyncio.sleep(0.05)  # be gentle on the data source

    conn = await asyncpg.connect(DB_URL)
    try:
        async with conn.transaction():
            await conn.execute("DELETE FROM pattern_scan_cache")
            if rows:
                await conn.executemany(
                    """INSERT INTO pattern_scan_cache
                       (symbol, timeframe, pattern, direction, confidence,
                        start_date, end_date, entry, target, stoploss, note,
                        kind, last_close)
                       VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,
                               $12,$13)""", rows)
    finally:
        await conn.close()
    log(f"=== done: {scanned} scanned, {skipped} skipped (no/thin data), "
        f"{len(rows)} pattern rows cached ===")


if __name__ == "__main__":
    lim = None
    for i, a in enumerate(sys.argv):
        if a == "--limit" and i + 1 < len(sys.argv):
            lim = int(sys.argv[i + 1])
    asyncio.run(main(limit=lim))
