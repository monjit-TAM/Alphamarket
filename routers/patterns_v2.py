"""
routers/patterns.py — AlphaLab Technical Pattern Scanner (unified).

Two engines, one router, no UAT dependency:
1. ORIGINAL DEEP ANALYSIS (ported from alphaforge/backend/main.py
   detect_patterns, lines 8937-9360): GET /api/patterns/{symbol}
   11 indicators, 8+ chart patterns with stages/necklines/targets,
   composite score, verdict, auto-narrative. Response matches the legacy
   /old page contract + generated_at_ist + data_source.
2. MULTI-TIMEFRAME SCANNER (pattern_engine.py, unit-tested):
   GET /api/patterns/scan/{symbol}?timeframe=daily|weekly|monthly|all
   GET /api/patterns/scan-all?timeframe=&limit=&min_confidence=

DATA CASCADE (per platform priority, per capability — measured 6 Jul 2026):
  1y daily (deep analysis): Data Services (serves 250 bars) -> Kite -> Yahoo
  10y daily (weekly/monthly): Kite (DS measured cap 250 bars) -> Yahoo
Every response carries data_source.
"""
import json
import asyncio
import time as _time
import re as _re
import urllib.request as _ur
from datetime import datetime, timedelta, date as _date

import httpx
import pandas as pd
import asyncpg
import pytz
from fastapi import APIRouter, HTTPException, Query

try:
    from routers.pattern_engine import scan as engine_scan, TIMEFRAMES, resample_weekly, resample_monthly
except ImportError:
    from pattern_engine import scan as engine_scan, TIMEFRAMES, resample_weekly, resample_monthly

router = APIRouter(prefix="/api/patterns", tags=["Patterns"])
IST = pytz.timezone("Asia/Kolkata")
DB_URL = "postgresql://dyor_user:DyorSecure2026Mar@localhost:5432/dyor_db"

DATA_SERVICE_URL = "http://localhost:5004"
_DS_HEADERS = {"X-API-Key": "alpha_data_internal_2026"}
_KITE_CREDS = {"ts": 0.0, "ak": None, "tok": None}


async def _ds_daily(symbol, days):
    start = (_date.today() - timedelta(days=days)).isoformat()
    end = _date.today().isoformat()
    try:
        async with httpx.AsyncClient(base_url=DATA_SERVICE_URL,
                                     headers=_DS_HEADERS, timeout=25.0) as c:
            r = await c.get(f"/data/equity/ohlcv/{symbol.upper()}",
                            params={"start": start, "end": end, "interval": "1d"})
            r.raise_for_status()
            j = r.json()
            rows = j.get("data") or j.get("prices") or j.get("ohlcv") or []
    except Exception:
        return None
    out = []
    for x in rows:
        x = {k.lower(): v for k, v in x.items()}
        d = x.get("date") or x.get("datetime") or x.get("timestamp") or x.get("time")
        try:
            out.append({"date": str(d)[:10], "open": float(x["open"]),
                        "high": float(x["high"]), "low": float(x["low"]),
                        "close": float(x["close"]),
                        "volume": int(float(x.get("volume", 0) or 0))})
        except Exception:
            continue
    out.sort(key=lambda c_: c_["date"])
    return out or None


def _kite_creds():
    now = _time.time()
    if _KITE_CREDS["ak"] and now - _KITE_CREDS["ts"] < 300:
        return _KITE_CREDS["ak"], _KITE_CREDS["tok"]
    import psycopg2 as _pg
    env = open("/opt/dyor-backend/.env").read()
    m = _re.search(r"KITE_API_KEY=(\S+)", env)
    ak = m.group(1).strip().strip('"').strip("'") if m else None
    conn = _pg.connect(DB_URL); cur = conn.cursor()
    cur.execute("SELECT value FROM api_settings WHERE key='kite_token'")
    row = cur.fetchone(); cur.close(); conn.close()
    tok = json.loads(row[0])["access_token"] if row else None
    _KITE_CREDS.update(ts=now, ak=ak, tok=tok)
    return ak, tok


def _kite_daily_sync(symbol, years):
    import psycopg2 as _pg
    ak, tok = _kite_creds()
    if not (ak and tok):
        return None
    conn = _pg.connect(DB_URL); cur = conn.cursor()
    cur.execute("SELECT instrument_token FROM instrument_master "
                "WHERE tradingsymbol=%s LIMIT 1", (symbol.upper(),))
    row = cur.fetchone(); cur.close(); conn.close()
    if not row:
        return None
    token = row[0]
    end = _date.today()
    total = int(365.25 * years)
    windows, cursor = [], end
    while total > 0:
        span = min(total, 1990)
        windows.append((cursor - timedelta(days=span), cursor))
        cursor = cursor - timedelta(days=span + 1)
        total -= span + 1
    candles = []
    for fd, td in reversed(windows):
        url = (f"https://api.kite.trade/instruments/historical/{token}/day"
               f"?from={fd}&to={td}")
        req = _ur.Request(url, headers={"Authorization": f"token {ak}:{tok}"})
        try:
            d = json.loads(_ur.urlopen(req, timeout=15).read().decode())
        except Exception:
            return None
        if d.get("status") != "success":
            return None
        for c in d.get("data", {}).get("candles", []):
            candles.append({"date": str(c[0])[:10], "open": float(c[1]),
                            "high": float(c[2]), "low": float(c[3]),
                            "close": float(c[4]), "volume": int(c[5] or 0)})
        _time.sleep(0.35)
    if not candles:
        return None
    seen, out = set(), []
    for c in sorted(candles, key=lambda x: x["date"]):
        if c["date"] not in seen:
            seen.add(c["date"]); out.append(c)
    return out


def _yf_daily_sync(symbol, period="10y"):
    import yfinance as yf
    try:
        df = yf.download(f"{symbol.upper()}.NS", period=period, interval="1d",
                         progress=False, auto_adjust=True)
    except Exception:
        return None
    if df is None or df.empty:
        return None
    if hasattr(df.columns, "levels"):
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    out = []
    for idx, r in df.iterrows():
        try:
            out.append({"date": str(idx)[:10], "open": float(r["Open"]),
                        "high": float(r["High"]), "low": float(r["Low"]),
                        "close": float(r["Close"]),
                        "volume": int(r.get("Volume", 0) or 0)})
        except Exception:
            continue
    out.sort(key=lambda c: c["date"])
    return out


async def fetch_daily_1y(symbol):
    """DS -> Kite(2y) -> Yahoo. Returns (candles, source)."""
    c = await _ds_daily(symbol, 400)
    if c and len(c) >= 200:
        return c, "data_services"
    loop = asyncio.get_event_loop()
    c = await loop.run_in_executor(None, _kite_daily_sync, symbol, 2)
    if c and len(c) >= 200:
        return c[-500:], "kite"
    c = await loop.run_in_executor(None, _yf_daily_sync, symbol, "2y")
    if c and len(c) >= 200:
        return c, "yahoo"
    return None, None


async def fetch_daily_10y(symbol):
    """Kite -> Yahoo (DS measured cap 250 bars). Returns (candles, source)."""
    loop = asyncio.get_event_loop()
    c = await loop.run_in_executor(None, _kite_daily_sync, symbol, 10)
    if c and len(c) >= 60:
        return c, "kite"
    c = await loop.run_in_executor(None, _yf_daily_sync, symbol, "10y")
    if c and len(c) >= 60:
        return c, "yahoo"
    return None, None


def _ist_now_str():
    return datetime.now(IST).strftime("%-d %b %Y, %I:%M %p IST")


# ─────────────── ORIGINAL DEEP ANALYSIS (ported) ─────────────────────────

def analyze_deep(sym, candles, info):
    import ta
    hist = pd.DataFrame(candles)
    hist["date"] = pd.to_datetime(hist["date"])
    hist = hist.set_index("date").sort_index()
    c_price = float(hist["close"].iloc[-1])
    h, l, cl, vol = hist["high"], hist["low"], hist["close"], hist["volume"]
    signals, patterns = [], []

    sma20 = float(cl.rolling(20).mean().iloc[-1])
    sma50 = float(cl.rolling(50).mean().iloc[-1])
    sma200 = float(cl.rolling(200).mean().iloc[-1]) if len(cl) >= 200 else 0
    ema12 = float(cl.ewm(span=12).mean().iloc[-1])
    ema26 = float(cl.ewm(span=26).mean().iloc[-1])
    if c_price > sma20 > sma50:
        signals.append({"signal": "BULLISH", "name": "Price above SMA 20 & 50", "strength": "strong"})
    elif c_price < sma20 < sma50:
        signals.append({"signal": "BEARISH", "name": "Price below SMA 20 & 50", "strength": "strong"})
    if sma200 > 0:
        signals.append({"signal": "BULLISH" if c_price > sma200 else "BEARISH",
                        "name": ("Trading above 200 DMA" if c_price > sma200 else "Trading below 200 DMA"),
                        "strength": "moderate"})
    sma50_prev = float(cl.rolling(50).mean().iloc[-5])
    sma200_prev = float(cl.rolling(200).mean().iloc[-5]) if len(cl) >= 200 else 0
    if sma200 > 0:
        if sma50 > sma200 and sma50_prev <= sma200_prev:
            patterns.append({"pattern": "Golden Cross", "type": "BULLISH",
                             "description": "50 DMA crossed above 200 DMA", "reliability": "high"})
        elif sma50 < sma200 and sma50_prev >= sma200_prev:
            patterns.append({"pattern": "Death Cross", "type": "BEARISH",
                             "description": "50 DMA crossed below 200 DMA", "reliability": "high"})

    rsi_series = ta.momentum.RSIIndicator(cl, window=14).rsi()
    rsi = float(rsi_series.iloc[-1]); rsi_prev10 = float(rsi_series.iloc[-10])
    if rsi < 30:
        signals.append({"signal": "BULLISH", "name": f"RSI Oversold ({rsi:.1f})", "strength": "strong"})
    elif rsi > 70:
        signals.append({"signal": "BEARISH", "name": f"RSI Overbought ({rsi:.1f})", "strength": "strong"})
    elif rsi > 50:
        signals.append({"signal": "BULLISH", "name": f"RSI Bullish ({rsi:.1f})", "strength": "weak"})
    else:
        signals.append({"signal": "BEARISH", "name": f"RSI Bearish ({rsi:.1f})", "strength": "weak"})
    if c_price > float(cl.iloc[-10]) and rsi < rsi_prev10:
        patterns.append({"pattern": "Bearish RSI Divergence", "type": "BEARISH",
                         "description": "Price making higher highs but RSI making lower highs",
                         "reliability": "moderate"})
    if c_price < float(cl.iloc[-10]) and rsi > rsi_prev10:
        patterns.append({"pattern": "Bullish RSI Divergence", "type": "BULLISH",
                         "description": "Price making lower lows but RSI making higher lows",
                         "reliability": "moderate"})

    macd_obj = ta.trend.MACD(cl)
    macd_line = float(macd_obj.macd().iloc[-1])
    macd_signal = float(macd_obj.macd_signal().iloc[-1])
    macd_hist = float(macd_obj.macd_diff().iloc[-1])
    macd_hist_prev = float(macd_obj.macd_diff().iloc[-2])
    signals.append({"signal": "BULLISH" if macd_line > macd_signal else "BEARISH",
                    "name": ("MACD above signal line" if macd_line > macd_signal
                             else "MACD below signal line"), "strength": "moderate"})
    if macd_hist > 0 and macd_hist_prev <= 0:
        patterns.append({"pattern": "MACD Bullish Crossover", "type": "BULLISH",
                         "description": "MACD histogram turned positive", "reliability": "moderate"})
    elif macd_hist < 0 and macd_hist_prev >= 0:
        patterns.append({"pattern": "MACD Bearish Crossover", "type": "BEARISH",
                         "description": "MACD histogram turned negative", "reliability": "moderate"})

    bb = ta.volatility.BollingerBands(cl, window=20, window_dev=2)
    bb_upper = float(bb.bollinger_hband().iloc[-1])
    bb_lower = float(bb.bollinger_lband().iloc[-1])
    bb_mid = float(bb.bollinger_mavg().iloc[-1])
    bb_width = (bb_upper - bb_lower) / bb_mid * 100
    bb_width_prev = float((bb.bollinger_hband().iloc[-20] - bb.bollinger_lband().iloc[-20])
                          / bb.bollinger_mavg().iloc[-20] * 100)
    if c_price >= bb_upper:
        signals.append({"signal": "BEARISH", "name": "Price at upper Bollinger Band", "strength": "moderate"})
    elif c_price <= bb_lower:
        signals.append({"signal": "BULLISH", "name": "Price at lower Bollinger Band", "strength": "moderate"})
    if bb_width < bb_width_prev * 0.6:
        patterns.append({"pattern": "Bollinger Squeeze", "type": "NEUTRAL",
                         "description": "Bands contracting - breakout imminent", "reliability": "moderate"})

    avg_vol = float(vol.rolling(20).mean().iloc[-1])
    cur_vol = float(vol.iloc[-1])
    vol_ratio = round(cur_vol / avg_vol, 1) if avg_vol > 0 else 1
    if vol_ratio > 2:
        signals.append({"signal": "BULLISH" if c_price > float(cl.iloc[-2]) else "BEARISH",
                        "name": f"Volume spike ({vol_ratio}x avg)", "strength": "strong"})

    atr = ta.volatility.AverageTrueRange(h, l, cl, window=10).average_true_range()
    st_lower = float((h.rolling(10).mean().iloc[-1] + l.rolling(10).mean().iloc[-1]) / 2
                     - 3 * atr.iloc[-1])
    signals.append({"signal": "BULLISH" if c_price > st_lower else "BEARISH",
                    "name": ("Above Supertrend support" if c_price > st_lower
                             else "Below Supertrend resistance"), "strength": "moderate"})

    pivot = (float(h.iloc[-1]) + float(l.iloc[-1]) + c_price) / 3
    r1 = 2 * pivot - float(l.iloc[-1]); s1 = 2 * pivot - float(h.iloc[-1])
    r2 = pivot + (float(h.iloc[-1]) - float(l.iloc[-1]))
    s2 = pivot - (float(h.iloc[-1]) - float(l.iloc[-1]))

    high_52w = (info.get("fiftyTwoWeekHigh") or info.get("high_52w")
                or float(cl.rolling(min(252, len(cl))).max().iloc[-1]))
    low_52w = (info.get("fiftyTwoWeekLow") or info.get("low_52w")
               or float(cl.rolling(min(252, len(cl))).min().iloc[-1]))
    from_high = round((c_price - high_52w) / high_52w * 100, 1) if high_52w else None
    from_low = round((c_price - low_52w) / low_52w * 100, 1) if low_52w else None
    if from_high is not None and from_high > -5:
        patterns.append({"pattern": "Near 52-Week High", "type": "BULLISH",
                         "description": f"{from_high}% from 52W high - strength", "reliability": "moderate"})
    if from_low is not None and 0 < from_low < 10:
        patterns.append({"pattern": "Near 52-Week Low", "type": "BEARISH",
                         "description": f"{from_low}% from 52W low - weakness", "reliability": "moderate"})

    stoch = ta.momentum.StochasticOscillator(h, l, cl, window=14, smooth_window=3)
    stoch_k = float(stoch.stoch().iloc[-1]); stoch_d = float(stoch.stoch_signal().iloc[-1])
    if stoch_k < 20 and stoch_k > stoch_d:
        patterns.append({"pattern": "Stochastic Bullish Cross in Oversold", "type": "BULLISH",
                         "description": "K crossed above D below 20", "reliability": "high"})
    elif stoch_k > 80 and stoch_k < stoch_d:
        patterns.append({"pattern": "Stochastic Bearish Cross in Overbought", "type": "BEARISH",
                         "description": "K crossed below D above 80", "reliability": "high"})

    adx = float(ta.trend.ADXIndicator(h, l, cl, window=14).adx().iloc[-1])
    if adx > 25:
        signals.append({"signal": "NEUTRAL", "name": f"Strong trend (ADX {adx:.0f})", "strength": "info"})
    elif adx < 20:
        signals.append({"signal": "NEUTRAL", "name": f"Weak/No trend (ADX {adx:.0f})", "strength": "info"})

    wr = float(ta.momentum.WilliamsRIndicator(h, l, cl, lbp=14).williams_r().iloc[-1])
    if wr > -20:
        signals.append({"signal": "BEARISH", "name": f"Williams %R Overbought ({wr:.0f})", "strength": "moderate"})
    elif wr < -80:
        signals.append({"signal": "BULLISH", "name": f"Williams %R Oversold ({wr:.0f})", "strength": "moderate"})
    cci = float(ta.trend.CCIIndicator(h, l, cl, window=20).cci().iloc[-1])
    if cci > 100:
        signals.append({"signal": "BEARISH", "name": f"CCI Overbought ({cci:.0f})", "strength": "weak"})
    elif cci < -100:
        signals.append({"signal": "BULLISH", "name": f"CCI Oversold ({cci:.0f})", "strength": "weak"})
    obv = ta.volume.OnBalanceVolumeIndicator(cl, vol).on_balance_volume()
    obv_sma = obv.rolling(20).mean()
    signals.append({"signal": "BULLISH" if float(obv.iloc[-1]) > float(obv_sma.iloc[-1]) else "BEARISH",
                    "name": ("OBV above 20-day avg (accumulation)"
                             if float(obv.iloc[-1]) > float(obv_sma.iloc[-1])
                             else "OBV below 20-day avg (distribution)"), "strength": "moderate"})
    signals.append({"signal": "BULLISH" if ema12 > ema26 else "BEARISH",
                    "name": ("EMA 12 above EMA 26" if ema12 > ema26 else "EMA 12 below EMA 26"),
                    "strength": "moderate"})

    # ══ chart structures on last 120 bars (original logic) ══
    closes = [float(x) for x in cl.iloc[-120:]]
    n = len(closes)

    def find_peaks(data, order=5):
        return [(i, data[i]) for i in range(order, len(data) - order)
                if all(data[i] >= data[i - j] for j in range(1, order + 1))
                and all(data[i] >= data[i + j] for j in range(1, order + 1))]

    def find_troughs(data, order=5):
        return [(i, data[i]) for i in range(order, len(data) - order)
                if all(data[i] <= data[i - j] for j in range(1, order + 1))
                and all(data[i] <= data[i + j] for j in range(1, order + 1))]

    peaks = find_peaks(closes, 5); troughs = find_troughs(closes, 5)

    if len(troughs) >= 2:
        t1, t2 = troughs[-2], troughs[-1]
        if abs(t1[1] - t2[1]) / t1[1] < 0.03:
            mid_peaks = [p for p in peaks if t1[0] < p[0] < t2[0]]
            if mid_peaks:
                neckline = mid_peaks[0][1]
                target = neckline + (neckline - min(t1[1], t2[1]))
                if c_price < neckline:
                    stage = "FORMING"
                    pct = round((neckline - c_price) / c_price * 100, 1)
                    desc = (f"Two bottoms at Rs.{t1[1]:,.0f} and Rs.{t2[1]:,.0f}. Neckline at "
                            f"Rs.{neckline:,.0f} ({pct}% above CMP). Breakout above neckline confirms "
                            f"pattern. Target: Rs.{target:,.0f}")
                elif c_price < target:
                    stage = "BREAKOUT"
                    pct = round((target - c_price) / c_price * 100, 1)
                    desc = f"Broke above neckline Rs.{neckline:,.0f}. Target Rs.{target:,.0f} ({pct}% upside remaining)"
                else:
                    stage = "COMPLETED"
                    desc = f"Pattern completed. Bottoms at Rs.{t1[1]:,.0f}/{t2[1]:,.0f}, neckline Rs.{neckline:,.0f}"
                patterns.append({"pattern": "Double Bottom (W)", "type": "BULLISH", "description": desc,
                                 "reliability": "high", "stage": stage,
                                 "neckline": round(neckline, 2), "target": round(target, 2)})
    if len(peaks) >= 2:
        p1, p2 = peaks[-2], peaks[-1]
        if abs(p1[1] - p2[1]) / p1[1] < 0.03:
            mid_troughs = [t for t in troughs if p1[0] < t[0] < p2[0]]
            if mid_troughs:
                neckline = mid_troughs[0][1]
                target = neckline - (max(p1[1], p2[1]) - neckline)
                if c_price > neckline:
                    stage = "FORMING"
                    pct = round((c_price - neckline) / c_price * 100, 1)
                    desc = (f"Two tops at Rs.{p1[1]:,.0f} and Rs.{p2[1]:,.0f}. Neckline at Rs.{neckline:,.0f} "
                            f"({pct}% below CMP). Breakdown below neckline confirms. Target: Rs.{target:,.0f}")
                elif c_price > target:
                    stage = "BREAKDOWN"
                    desc = f"Broke below neckline Rs.{neckline:,.0f}. Target Rs.{target:,.0f}"
                else:
                    stage = "COMPLETED"
                    desc = f"Pattern completed. Tops at Rs.{p1[1]:,.0f}/{p2[1]:,.0f}"
                patterns.append({"pattern": "Double Top (M)", "type": "BEARISH", "description": desc,
                                 "reliability": "high", "stage": stage,
                                 "neckline": round(neckline, 2), "target": round(target, 2)})

    if len(troughs) >= 1 and len(peaks) >= 2 and n > 40:
        left_peak = cup_bottom = right_peak = None
        for p in peaks:
            if p[0] < n * 0.3:
                left_peak = p
        if left_peak:
            cup_troughs = [t for t in troughs if left_peak[0] < t[0] < n * 0.7]
            if cup_troughs:
                cup_bottom = min(cup_troughs, key=lambda x: x[1])
                right_peaks = [p for p in peaks if p[0] > cup_bottom[0]]
                if right_peaks:
                    right_peak = right_peaks[0]
        if left_peak and cup_bottom and right_peak:
            if abs(left_peak[1] - right_peak[1]) / left_peak[1] < 0.05:
                cup_depth = round((left_peak[1] - cup_bottom[1]) / left_peak[1] * 100, 1)
                if 10 < cup_depth < 35:
                    rim = max(left_peak[1], right_peak[1])
                    target = rim + (rim - cup_bottom[1])
                    if c_price < rim:
                        stage = "HANDLE FORMING"
                        pct = round((rim - c_price) / c_price * 100, 1)
                        desc = (f"Cup depth {cup_depth}%. Rim/pivot at Rs.{rim:,.0f} ({pct}% above CMP). "
                                f"Cup bottom Rs.{cup_bottom[1]:,.0f}. Breakout target: Rs.{target:,.0f}")
                    else:
                        stage = "BREAKOUT"
                        desc = f"Broke above rim at Rs.{rim:,.0f}. Target Rs.{target:,.0f}. Cup depth was {cup_depth}%"
                    patterns.append({"pattern": "Cup & Handle", "type": "BULLISH", "description": desc,
                                     "reliability": "high", "stage": stage,
                                     "neckline": round(rim, 2), "target": round(target, 2)})

    if len(peaks) >= 3:
        last3 = peaks[-3:]
        head = max(last3, key=lambda x: x[1])
        shoulders = [p for p in last3 if p != head]
        if len(shoulders) == 2 and abs(shoulders[0][1] - shoulders[1][1]) / shoulders[0][1] < 0.05 \
                and head[1] > shoulders[0][1] * 1.03:
            rel = [t for t in troughs if shoulders[0][0] < t[0] < shoulders[1][0]]
            if rel:
                neckline = min(t[1] for t in rel)
                target = neckline - (head[1] - neckline)
                if c_price > neckline:
                    stage = "FORMING"
                    desc = (f"Head at Rs.{head[1]:,.0f}, shoulders at Rs.{shoulders[0][1]:,.0f}/"
                            f"Rs.{shoulders[1][1]:,.0f}. Neckline Rs.{neckline:,.0f}. Breakdown target: Rs.{target:,.0f}")
                else:
                    stage = "BREAKDOWN"
                    desc = f"Broke neckline Rs.{neckline:,.0f}. Target Rs.{target:,.0f}"
                patterns.append({"pattern": "Head & Shoulders", "type": "BEARISH", "description": desc,
                                 "reliability": "high", "stage": stage,
                                 "neckline": round(neckline, 2), "target": round(target, 2)})

    if len(peaks) >= 2 and len(troughs) >= 2:
        peak_vals = [p[1] for p in peaks[-3:]]
        trough_vals = [t[1] for t in troughs[-3:]]
        flat_top = max(peak_vals) - min(peak_vals) < max(peak_vals) * 0.02
        rising_bottom = all(trough_vals[i] < trough_vals[i + 1]
                            for i in range(len(trough_vals) - 1)) if len(trough_vals) > 1 else False
        if flat_top and rising_bottom:
            resistance = max(peak_vals)
            pct = round((resistance - c_price) / c_price * 100, 1)
            if c_price < resistance:
                stage = "FORMING"
                desc = f"Flat resistance at Rs.{resistance:,.0f} ({pct}% above) with rising support. Bullish breakout expected."
            else:
                stage = "BREAKOUT"
                desc = f"Broke above Rs.{resistance:,.0f} resistance. Ascending triangle confirmed."
            patterns.append({"pattern": "Ascending Triangle", "type": "BULLISH", "description": desc,
                             "reliability": "moderate", "stage": stage, "neckline": round(resistance, 2)})
        flat_bottom = max(trough_vals) - min(trough_vals) < max(trough_vals) * 0.02 if trough_vals else False
        falling_top = all(peak_vals[i] > peak_vals[i + 1]
                          for i in range(len(peak_vals) - 1)) if len(peak_vals) > 1 else False
        if flat_bottom and falling_top:
            support = min(trough_vals)
            pct = round((c_price - support) / c_price * 100, 1)
            if c_price > support:
                stage = "FORMING"
                desc = f"Flat support at Rs.{support:,.0f} ({pct}% below) with falling resistance. Bearish breakdown expected."
            else:
                stage = "BREAKDOWN"
                desc = f"Broke below Rs.{support:,.0f} support. Descending triangle confirmed."
            patterns.append({"pattern": "Descending Triangle", "type": "BEARISH", "description": desc,
                             "reliability": "moderate", "stage": stage, "neckline": round(support, 2)})
        if all(peak_vals[i] > peak_vals[i + 1] for i in range(len(peak_vals) - 1)) and \
                all(trough_vals[i] > trough_vals[i + 1] for i in range(len(trough_vals) - 1)):
            if (peak_vals[0] - peak_vals[-1]) > (trough_vals[0] - trough_vals[-1]):
                patterns.append({"pattern": "Falling Wedge", "type": "BULLISH",
                                 "description": "Both highs and lows falling but converging. Bullish reversal pattern. Watch for upside breakout.",
                                 "reliability": "moderate", "stage": "FORMING"})
        if all(peak_vals[i] < peak_vals[i + 1] for i in range(len(peak_vals) - 1)) and \
                all(trough_vals[i] < trough_vals[i + 1] for i in range(len(trough_vals) - 1)):
            if (trough_vals[-1] - trough_vals[0]) > (peak_vals[-1] - peak_vals[0]):
                patterns.append({"pattern": "Rising Wedge", "type": "BEARISH",
                                 "description": "Both highs and lows rising but converging. Bearish reversal pattern. Watch for downside breakdown.",
                                 "reliability": "moderate", "stage": "FORMING"})

    bull = sum(1 for s in signals if s["signal"] == "BULLISH")
    bear = sum(1 for s in signals if s["signal"] == "BEARISH")
    total = bull + bear
    score = round((bull - bear) / total * 100) if total > 0 else 0
    if score > 30: verdict = "BULLISH"
    elif score > 10: verdict = "MILDLY BULLISH"
    elif score < -30: verdict = "BEARISH"
    elif score < -10: verdict = "MILDLY BEARISH"
    else: verdict = "NEUTRAL"

    day_chg = round((c_price / float(cl.iloc[-2]) - 1) * 100, 2)
    parts = [f"{info.get('shortName', sym)} ({sym}) is currently trading at Rs.{c_price:,.2f}, "
             f"{('up' if day_chg >= 0 else 'down')} {abs(day_chg)}% in the latest session."]
    if sma200 > 0:
        parts.append(f"The stock is trading {'above' if c_price > sma200 else 'below'} its 200-day moving "
                     f"average (Rs.{sma200:,.0f}), "
                     + ("which is a long-term bullish structure." if c_price > sma200
                        else "indicating a long-term bearish structure."))
    parts.append(f"It {'remains above' if c_price > sma50 else 'has slipped below'} the 50 DMA "
                 f"(Rs.{sma50:,.0f}), showing medium-term {'strength' if c_price > sma50 else 'weakness'}.")
    if rsi < 30:
        parts.append(f"RSI at {rsi:.1f} is in deeply oversold territory, historically a zone where mean-reversion bounces tend to occur.")
    elif rsi > 70:
        parts.append(f"RSI at {rsi:.1f} is in overbought territory, suggesting the rally may be overextended.")
    elif rsi > 55:
        parts.append(f"RSI at {rsi:.1f} shows bullish momentum without being overextended.")
    elif rsi < 45:
        parts.append(f"RSI at {rsi:.1f} leans bearish, indicating sellers are in control.")
    else:
        parts.append(f"RSI at {rsi:.1f} is neutral, offering no strong directional signal.")
    parts.append("MACD histogram is positive, confirming upward momentum." if macd_hist > 0
                 else "MACD histogram is negative, confirming downward momentum.")
    if vol_ratio > 1.5:
        parts.append(f"Volume is {vol_ratio}x the 20-day average, indicating strong participation.")
    elif vol_ratio < 0.7:
        parts.append(f"Volume is weak at {vol_ratio}x average, suggesting the move lacks conviction.")
    parts.append(f"ADX at {adx:.0f} confirms a strong trend is in place." if adx > 25
                 else f"ADX at {adx:.0f} indicates a weak or range-bound market.")
    for p in patterns:
        if p["reliability"] == "high":
            parts.append(f"IMPORTANT: {p['pattern']} detected -- {p['description']}. This is a high-reliability pattern.")
    if score > 30:
        outlook = (f"OUTLOOK: The weight of technical evidence is bullish. {sym} shows {bull} bullish signals "
                   f"against {bear} bearish. Near-term upside target is R1 at Rs.{r1:,.0f}, with support at S1 Rs.{s1:,.0f}.")
    elif score > 10:
        outlook = (f"OUTLOOK: Mildly bullish with {bull} bullish vs {bear} bearish signals. Gradual upside "
                   f"towards R1 (Rs.{r1:,.0f}) possible but conviction is moderate.")
    elif score < -30:
        outlook = (f"OUTLOOK: Technical signals are bearish with {bear} bearish vs {bull} bullish readings. "
                   f"Downside risk to S1 at Rs.{s1:,.0f} and potentially S2 at Rs.{s2:,.0f}.")
    elif score < -10:
        outlook = f"OUTLOOK: Mildly bearish. Resistance at Rs.{r1:,.0f}; may drift towards S1 (Rs.{s1:,.0f})."
    else:
        outlook = (f"OUTLOOK: Neutral/consolidation phase between S1 (Rs.{s1:,.0f}) and R1 (Rs.{r1:,.0f}). "
                   f"Wait for a decisive break.")
    parts.append(outlook)
    chart_patterns = [p for p in patterns if "stage" in p]
    if chart_patterns:
        parts.append("CHART PATTERNS:")
        for cp in chart_patterns:
            parts.append(f"{cp['pattern']} ({cp['stage']}): {cp['description']}")

    return {
        "symbol": sym, "name": info.get("shortName", sym), "sector": info.get("sector", ""),
        "price": round(c_price, 2), "change_pct": day_chg,
        "verdict": verdict, "score": score,
        "bullish_signals": bull, "bearish_signals": bear,
        "indicators": {"rsi": round(rsi, 1), "macd": round(macd_line, 2), "adx": round(adx, 1),
                       "sma20": round(sma20, 2), "sma50": round(sma50, 2), "sma200": round(sma200, 2),
                       "bb_width": round(bb_width, 1), "volume_ratio": vol_ratio,
                       "stoch_k": round(stoch_k, 1), "stoch_d": round(stoch_d, 1)},
        "levels": {"pivot": round(pivot, 2), "r1": round(r1, 2), "r2": round(r2, 2),
                   "s1": round(s1, 2), "s2": round(s2, 2),
                   "high_52w": round(high_52w, 2), "low_52w": round(low_52w, 2)},
        "patterns": patterns, "signals": signals, "narrative": " ".join(parts),
    }


# ─────────────────────────── endpoints ───────────────────────────────────
# NOTE: /scan-all and /scan/{symbol} MUST precede /{symbol}.

@router.get("/scan-all", summary="Universe pattern scan (daily cache)")
async def scan_all(timeframe: str = Query("daily"),
                   limit: int = Query(30, ge=1, le=100),
                   min_confidence: int = Query(55, ge=50, le=90)):
    if timeframe not in TIMEFRAMES:
        raise HTTPException(400, f"Unknown timeframe: {timeframe}")
    conn = await asyncpg.connect(DB_URL)
    try:
        rows = await conn.fetch(
            """SELECT symbol, timeframe, pattern, direction, confidence,
                      start_date, end_date, entry, target, stoploss, note,
                      kind, last_close
               FROM pattern_scan_cache
               WHERE timeframe=$1 AND confidence>=$2
               ORDER BY confidence DESC, symbol LIMIT $3""",
            timeframe, min_confidence, limit)
        meta = await conn.fetchrow(
            "SELECT max(computed_at) ts, count(DISTINCT symbol) syms "
            "FROM pattern_scan_cache WHERE timeframe=$1", timeframe)
    finally:
        await conn.close()
    ts = meta["ts"] if meta else None
    tf = TIMEFRAMES[timeframe]
    return {
        "timeframe": timeframe, "label": tf["label"], "validity": tf["validity"],
        "computed_at_ist": ts.astimezone(IST).strftime("%-d %b %Y, %I:%M %p IST") if ts else None,
        "cache_age_hours": (round((datetime.now(IST) - ts.astimezone(IST)).total_seconds() / 3600, 1)
                            if ts else None),
        "symbols_scanned": meta["syms"] if meta else 0,
        "count": len(rows),
        "patterns": [dict(r,
                          start_date=str(r["start_date"]) if r["start_date"] else None,
                          end_date=str(r["end_date"]) if r["end_date"] else None,
                          entry=float(r["entry"]) if r["entry"] is not None else None,
                          target=float(r["target"]) if r["target"] is not None else None,
                          stoploss=float(r["stoploss"]) if r["stoploss"] is not None else None,
                          last_close=float(r["last_close"]) if r["last_close"] is not None else None)
                     for r in rows],
        "disclaimer": "Levels are pattern-geometry, not live prices. Cache refreshes post-close daily.",
    }


@router.get("/scan/{symbol}", summary="Multi-timeframe pattern scan (D/W/M)")
async def scan_symbol(symbol: str,
                      timeframe: str = Query("all"),
                      include_candles: bool = Query(False)):
    tfs = list(TIMEFRAMES) if timeframe == "all" else [timeframe]
    for tf in tfs:
        if tf not in TIMEFRAMES:
            raise HTTPException(400, f"Unknown timeframe: {tf}")
    daily, source = await fetch_daily_10y(symbol)
    if not daily:
        raise HTTPException(404, f"No candle data for {symbol} (kite+yahoo failed)")
    results = {}
    for tf in tfs:
        r = engine_scan(daily, tf)
        if include_candles and r:
            if tf == "weekly":
                r["candles"] = resample_weekly(daily)[-160:]
            elif tf == "monthly":
                r["candles"] = resample_monthly(daily)[-160:]
            else:
                r["candles"] = daily[-160:]
        results[tf] = r
    return {"symbol": symbol.upper(), "scanned_at_ist": _ist_now_str(),
            "data_source": source, "daily_bars_available": len(daily),
            "timeframes": results,
            "disclaimer": ("Entry/target/stoploss are pattern-geometry levels, not "
                           "live prices. Confidence is a completeness heuristic, "
                           "not probability of profit.")}


@router.get("/{symbol}", summary="Deep technical analysis (original engine)")
async def deep_analysis(symbol: str):
    sym = symbol.upper()
    import redis as _redis
    ck = f"patterns:{sym}:{_date.today().isoformat()}"
    rc = None
    try:
        rc = _redis.Redis(db=0)
        cached = rc.get(ck)
        if cached:
            rc.close()
            return json.loads(cached)
    except Exception:
        rc = None
    candles, source = await fetch_daily_1y(sym)
    if not candles or len(candles) < 50:
        raise HTTPException(404, f"Insufficient data for {sym}")
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, analyze_deep, sym, candles, {})
    result["generated_at_ist"] = _ist_now_str()
    result["data_source"] = source
    result["timeframe_note"] = ("Daily chart analysis, ~1-year lookback; "
                                "structures scanned on last 120 sessions")
    try:
        if rc is None:
            rc = _redis.Redis(db=0)
        rc.setex(ck, 6 * 3600, json.dumps(result))
        rc.close()
    except Exception:
        pass
    return result
