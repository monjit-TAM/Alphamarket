"""
pattern_engine.py — AlphaLab chart-pattern detection core.
Self-contained: operates on a list of candle dicts
  [{"date": "YYYY-MM-DD", "open": f, "high": f, "low": f, "close": f, "volume": n}, ...]
oldest-first. No network, no DB — pure functions, unit-testable.

Timeframes: pass daily candles; resample_weekly()/resample_monthly() derive
higher timeframes from the SAME daily data (honest: one source of truth).

Every detection returns:
  {pattern, direction (BULLISH/BEARISH/NEUTRAL), confidence (50-90 bounded
   heuristic — completeness/symmetry, NOT probability of profit),
   start_date, end_date, entry, target, stoploss (pattern-GEOMETRY levels,
   not live-verified prices), note}
Detections below quality floors are not emitted (STAND_ASIDE principle).
"""
from typing import List, Dict, Optional


# ────────────────────────────── resampling ──────────────────────────────

def _bucket(candles: List[dict], keyfn) -> List[dict]:
    out, cur, key = [], None, None
    for c in candles:
        k = keyfn(c["date"])
        if k != key:
            if cur:
                out.append(cur)
            cur = {"date": c["date"], "open": c["open"], "high": c["high"],
                   "low": c["low"], "close": c["close"],
                   "volume": c.get("volume", 0) or 0}
            key = k
        else:
            cur["high"] = max(cur["high"], c["high"])
            cur["low"] = min(cur["low"], c["low"])
            cur["close"] = c["close"]
            cur["volume"] += c.get("volume", 0) or 0
            cur["date"] = c["date"]  # bucket labelled by its LAST day
    if cur:
        out.append(cur)
    return out


def resample_weekly(daily: List[dict]) -> List[dict]:
    """ISO-week buckets from daily candles."""
    import datetime as _dt
    def wk(ds):
        d = _dt.date.fromisoformat(ds[:10])
        y, w, _ = d.isocalendar()
        return (y, w)
    return _bucket(daily, wk)


def resample_monthly(daily: List[dict]) -> List[dict]:
    return _bucket(daily, lambda ds: ds[:7])


# ─────────────────────────── swing utilities ────────────────────────────

def swings(candles: List[dict], k: int = 3):
    """Swing highs/lows: bar whose high(low) exceeds k bars each side.
    Returns (highs, lows) as lists of (index, price)."""
    hi, lo = [], []
    n = len(candles)
    for i in range(k, n - k):
        h = candles[i]["high"]; l = candles[i]["low"]
        left_h = [candles[j]["high"] for j in range(i - k, i)]
        right_h = [candles[j]["high"] for j in range(i + 1, i + k + 1)]
        if all(h >= x for x in left_h + right_h) and (h > max(left_h) or h > max(right_h)):
            hi.append((i, h))
        left_l = [candles[j]["low"] for j in range(i - k, i)]
        right_l = [candles[j]["low"] for j in range(i + 1, i + k + 1)]
        if all(l <= x for x in left_l + right_l) and (l < min(left_l) or l < min(right_l)):
            lo.append((i, l))
    return hi, lo


def support_resistance(candles: List[dict], k: int = 3, tol: float = 0.01):
    """Cluster swing levels within tol into S/R zones. Returns dict lists."""
    hi, lo = swings(candles, k)
    last = candles[-1]["close"]

    def cluster(points):
        zones = []
        for _, p in sorted(points, key=lambda x: x[1]):
            for z in zones:
                if abs(p - z["level"]) / z["level"] <= tol:
                    z["level"] = (z["level"] * z["touches"] + p) / (z["touches"] + 1)
                    z["touches"] += 1
                    break
            else:
                zones.append({"level": p, "touches": 1})
        return [z for z in zones if z["touches"] >= 2]

    res = [dict(z, level=round(z["level"], 2)) for z in cluster(hi) if z["level"] > last]
    sup = [dict(z, level=round(z["level"], 2)) for z in cluster(lo) if z["level"] < last]
    res.sort(key=lambda z: z["level"])
    sup.sort(key=lambda z: -z["level"])
    return {"support": sup[:3], "resistance": res[:3]}


# ─────────────────────────── candlestick set ────────────────────────────

def _body(c): return abs(c["close"] - c["open"])
def _rng(c): return max(c["high"] - c["low"], 1e-9)
def _bull(c): return c["close"] > c["open"]
def _bear(c): return c["close"] < c["open"]


def detect_candlesticks(candles: List[dict], lookback: int = 5) -> List[dict]:
    """Scan the last `lookback` bars for single/multi-bar candle patterns."""
    out = []
    n = len(candles)
    if n < 3:
        return out
    start = max(2, n - lookback)
    for i in range(start, n):
        c, p = candles[i], candles[i - 1]
        d, rng, body = c["date"], _rng(c), _body(c)
        upper = c["high"] - max(c["open"], c["close"])
        lower = min(c["open"], c["close"]) - c["low"]
        recent = candles[max(0, i - 6):i]
        downtrend = bool(recent) and c["close"] < recent[0]["close"]
        uptrend = bool(recent) and c["close"] > recent[0]["close"]

        if body / rng <= 0.1:
            out.append(_cs("Doji", "NEUTRAL", 55, d,
                           "indecision — body ≤10% of range"))
        if lower >= 2 * body and upper <= 0.3 * body and downtrend and body > 0:
            out.append(_cs("Hammer", "BULLISH", 65, d,
                           "long lower wick after decline"))
        if upper >= 2 * body and lower <= 0.3 * body and uptrend and body > 0:
            out.append(_cs("Shooting Star", "BEARISH", 65, d,
                           "long upper wick after advance"))
        if (_bull(c) and _bear(p) and c["close"] >= p["open"]
                and c["open"] <= p["close"] and _body(c) > _body(p)):
            out.append(_cs("Bullish Engulfing", "BULLISH", 70, d,
                           "bull body engulfs prior bear body"))
        if (_bear(c) and _bull(p) and c["open"] >= p["close"]
                and c["close"] <= p["open"] and _body(c) > _body(p)):
            out.append(_cs("Bearish Engulfing", "BEARISH", 70, d,
                           "bear body engulfs prior bull body"))
        if i >= 2:
            a, b = candles[i - 2], candles[i - 1]
            if (_bear(a) and _body(b) / _rng(b) < 0.35 and _bull(c)
                    and c["close"] > (a["open"] + a["close"]) / 2):
                out.append(_cs("Morning Star", "BULLISH", 72, d,
                               "3-bar reversal: bear, pause, strong bull"))
            if (_bull(a) and _body(b) / _rng(b) < 0.35 and _bear(c)
                    and c["close"] < (a["open"] + a["close"]) / 2):
                out.append(_cs("Evening Star", "BEARISH", 72, d,
                               "3-bar reversal: bull, pause, strong bear"))
    # dedupe by (pattern,date)
    seen, ded = set(), []
    for x in out:
        k = (x["pattern"], x["end_date"])
        if k not in seen:
            seen.add(k); ded.append(x)
    return ded


def _cs(name, direction, conf, date, note):
    return {"pattern": name, "direction": direction, "confidence": conf,
            "start_date": date, "end_date": date,
            "entry": None, "target": None, "stoploss": None, "note": note,
            "kind": "candlestick"}


# ─────────────────────────── structures ─────────────────────────────────

def detect_double_top_bottom(candles: List[dict], k: int = 3,
                             tol: float = 0.02) -> List[dict]:
    out = []
    hi, lo = swings(candles, k)
    last = candles[-1]["close"]

    # search recent swing-high PAIRS (flat tails can add minor swings after
    # the true peaks), most recent qualifying pair wins
    pair = None
    for a in range(len(hi) - 1, 0, -1):
        for b in range(a - 1, max(-1, a - 4), -1):
            (i1, p1), (i2, p2) = hi[b], hi[a]
            if i2 - i1 >= 5 and abs(p1 - p2) / p1 <= tol and \
               p1 >= candles[-1]["close"] * 1.02:
                pair = ((i1, p1), (i2, p2)); break
        if pair: break
    if pair:
        (i1, p1), (i2, p2) = pair
        if True:
            trough = min(c["low"] for c in candles[i1:i2 + 1])
            if last < trough:  # neckline broken = confirmed
                depth = ((p1 + p2) / 2) - trough
                out.append({"pattern": "Double Top", "direction": "BEARISH",
                            "confidence": 75,
                            "start_date": candles[i1]["date"],
                            "end_date": candles[-1]["date"],
                            "entry": round(trough, 2),
                            "target": round(trough - depth, 2),
                            "stoploss": round(max(p1, p2), 2),
                            "note": f"twin peaks ~{p1:.0f}, neckline {trough:.0f} broken",
                            "kind": "structure"})
            elif last < (p1 + p2) / 2 * (1 - 0.005):
                out.append({"pattern": "Double Top (forming)", "direction": "BEARISH",
                            "confidence": 58,
                            "start_date": candles[i1]["date"],
                            "end_date": candles[i2]["date"],
                            "entry": round(trough, 2),
                            "target": round(trough - (((p1 + p2) / 2) - trough), 2),
                            "stoploss": round(max(p1, p2), 2),
                            "note": "awaiting neckline break — unconfirmed",
                            "kind": "structure"})
    pair = None
    for a in range(len(lo) - 1, 0, -1):
        for b in range(a - 1, max(-1, a - 4), -1):
            (i1, p1), (i2, p2) = lo[b], lo[a]
            if i2 - i1 >= 5 and abs(p1 - p2) / p1 <= tol and \
               p1 <= candles[-1]["close"] * 0.98:
                pair = ((i1, p1), (i2, p2)); break
        if pair: break
    if pair:
        (i1, p1), (i2, p2) = pair
        if True:
            peak = max(c["high"] for c in candles[i1:i2 + 1])
            if last > peak:
                depth = peak - ((p1 + p2) / 2)
                out.append({"pattern": "Double Bottom", "direction": "BULLISH",
                            "confidence": 75,
                            "start_date": candles[i1]["date"],
                            "end_date": candles[-1]["date"],
                            "entry": round(peak, 2),
                            "target": round(peak + depth, 2),
                            "stoploss": round(min(p1, p2), 2),
                            "note": f"twin troughs ~{p1:.0f}, neckline {peak:.0f} broken",
                            "kind": "structure"})
    return out


def detect_head_shoulders(candles: List[dict], k: int = 3) -> List[dict]:
    out = []
    hi, lo = swings(candles, k)
    last = candles[-1]["close"]
    if len(hi) >= 3:
        (i1, s1), (i2, h), (i3, s2) = hi[-3], hi[-2], hi[-1]
        if h > s1 and h > s2 and abs(s1 - s2) / s1 <= 0.035 and i3 - i1 >= 10:
            neck = min(c["low"] for c in candles[i1:i3 + 1])
            depth = h - neck
            confirmed = last < neck
            out.append({"pattern": "Head & Shoulders",
                        "direction": "BEARISH",
                        "confidence": 78 if confirmed else 60,
                        "start_date": candles[i1]["date"],
                        "end_date": candles[-1]["date"] if confirmed else candles[i3]["date"],
                        "entry": round(neck, 2),
                        "target": round(neck - depth, 2),
                        "stoploss": round(h, 2),
                        "note": ("neckline broken" if confirmed
                                 else "forming — awaiting neckline break"),
                        "kind": "structure"})
    if len(lo) >= 3:
        (i1, s1), (i2, h), (i3, s2) = lo[-3], lo[-2], lo[-1]
        if h < s1 and h < s2 and abs(s1 - s2) / s1 <= 0.035 and i3 - i1 >= 10:
            neck = max(c["high"] for c in candles[i1:i3 + 1])
            depth = neck - h
            confirmed = last > neck
            out.append({"pattern": "Inverse Head & Shoulders",
                        "direction": "BULLISH",
                        "confidence": 78 if confirmed else 60,
                        "start_date": candles[i1]["date"],
                        "end_date": candles[-1]["date"] if confirmed else candles[i3]["date"],
                        "entry": round(neck, 2),
                        "target": round(neck + depth, 2),
                        "stoploss": round(h, 2),
                        "note": ("neckline broken" if confirmed
                                 else "forming — awaiting neckline break"),
                        "kind": "structure"})
    return out


def _fit(points):
    """Least-squares slope/intercept for [(x, y)]. Returns (m, b) or None."""
    n = len(points)
    if n < 2:
        return None
    sx = sum(p[0] for p in points); sy = sum(p[1] for p in points)
    sxx = sum(p[0] * p[0] for p in points); sxy = sum(p[0] * p[1] for p in points)
    d = n * sxx - sx * sx
    if d == 0:
        return None
    m = (n * sxy - sx * sy) / d
    return m, (sy - m * sx) / n


def detect_triangle(candles: List[dict], k: int = 3) -> List[dict]:
    out = []
    hi, lo = swings(candles, k)
    if len(hi) < 3 or len(lo) < 3:
        return out
    H, L = hi[-4:], lo[-4:]
    fh, fl = _fit(H), _fit(L)
    if not fh or not fl:
        return out
    mh, ml = fh[0], fl[0]
    px = candles[-1]["close"]
    flat = 0.0004 * px  # slope ≈ flat threshold per bar
    span_start = min(H[0][0], L[0][0])
    height = max(p for _, p in H) - min(p for _, p in L)
    base = {"start_date": candles[span_start]["date"],
            "end_date": candles[-1]["date"], "kind": "structure"}
    if abs(mh) <= flat and ml > flat:
        out.append({**base, "pattern": "Ascending Triangle", "direction": "BULLISH",
                    "confidence": 66, "entry": round(fh[1] + mh * (len(candles) - 1), 2),
                    "target": round(fh[1] + height, 2),
                    "stoploss": round(fl[1] + ml * (len(candles) - 1), 2),
                    "note": "flat top, rising lows — bullish bias on breakout"})
    elif abs(ml) <= flat and mh < -flat:
        out.append({**base, "pattern": "Descending Triangle", "direction": "BEARISH",
                    "confidence": 66, "entry": round(fl[1] + ml * (len(candles) - 1), 2),
                    "target": round(fl[1] - height, 2),
                    "stoploss": round(fh[1] + mh * (len(candles) - 1), 2),
                    "note": "flat bottom, falling highs — bearish bias on breakdown"})
    elif mh < -flat and ml > flat:
        out.append({**base, "pattern": "Symmetrical Triangle", "direction": "NEUTRAL",
                    "confidence": 58, "entry": None, "target": None, "stoploss": None,
                    "note": "converging highs/lows — direction decided by break"})
    return out


def detect_flag(candles: List[dict]) -> List[dict]:
    """Pole (sharp ≥6% move in ≤10 bars) + tight consolidation (≤ half pole,
    ≤8 bars) = flag in pole direction."""
    out = []
    n = len(candles)
    if n < 15:
        return out
    cons = candles[-6:]
    c_hi = max(c["high"] for c in cons); c_lo = min(c["low"] for c in cons)
    px = candles[-1]["close"]
    if (c_hi - c_lo) / px > 0.035:
        return out
    pole = candles[-16:-6]
    move = (pole[-1]["close"] - pole[0]["close"]) / pole[0]["close"]
    if move >= 0.06:
        out.append({"pattern": "Bull Flag", "direction": "BULLISH", "confidence": 68,
                    "start_date": pole[0]["date"], "end_date": candles[-1]["date"],
                    "entry": round(c_hi, 2),
                    "target": round(c_hi * (1 + move), 2),
                    "stoploss": round(c_lo, 2),
                    "note": f"pole +{move*100:.1f}% then tight drift — continuation on break",
                    "kind": "structure"})
    elif move <= -0.06:
        out.append({"pattern": "Bear Flag", "direction": "BEARISH", "confidence": 68,
                    "start_date": pole[0]["date"], "end_date": candles[-1]["date"],
                    "entry": round(c_lo, 2),
                    "target": round(c_lo * (1 + move), 2),
                    "stoploss": round(c_hi, 2),
                    "note": f"pole {move*100:.1f}% then tight drift — continuation on break",
                    "kind": "structure"})
    return out




# ─────────────────── indicator helpers (pure python) ────────────────────

def _ema(vals, span):
    if not vals:
        return []
    k = 2.0 / (span + 1)
    out = [vals[0]]
    for v in vals[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def _sma(vals, n):
    out = []
    s = 0.0
    for i, v in enumerate(vals):
        s += v
        if i >= n:
            s -= vals[i - n]
        out.append(s / min(i + 1, n))
    return out


def _atr(candles, n=10):
    trs = []
    for i, c in enumerate(candles):
        if i == 0:
            trs.append(c["high"] - c["low"])
        else:
            pc = candles[i - 1]["close"]
            trs.append(max(c["high"] - c["low"], abs(c["high"] - pc), abs(c["low"] - pc)))
    return _sma(trs, n)


def _supertrend_dir(candles, period=10, mult=3.0):
    """Direction series: +1 above supertrend, -1 below. Simplified flip logic."""
    atr = _atr(candles, period)
    n = len(candles)
    dirs = [1] * n
    ub = lb = None
    st = None
    for i in range(n):
        c = candles[i]
        mid = (c["high"] + c["low"]) / 2
        bub = mid + mult * atr[i]
        blb = mid - mult * atr[i]
        if i == 0:
            ub, lb, st, dirs[i] = bub, blb, blb, 1
            continue
        ub = bub if (bub < ub or candles[i - 1]["close"] > ub) else ub
        lb = blb if (blb > lb or candles[i - 1]["close"] < lb) else lb
        prev_dir = dirs[i - 1]
        if prev_dir == 1 and c["close"] < lb:
            dirs[i] = -1
        elif prev_dir == -1 and c["close"] > ub:
            dirs[i] = 1
        else:
            dirs[i] = prev_dir
    return dirs


def detect_indicator_events(candles):
    """Indicator-event patterns on the LAST bar of the series:
    MACD Histogram Positive/Negative flip, Supertrend Buy/Sell flip,
    Golden/Death Cross (needs 200+ bars)."""
    out = []
    closes = [c["close"] for c in candles]
    n = len(closes)
    d = candles[-1]["date"]
    W = 3  # report flips within the last W bars (still-fresh events)
    if n >= 35:
        e12, e26 = _ema(closes, 12), _ema(closes, 26)
        macd = [a - b for a, b in zip(e12, e26)]
        sig = _ema(macd, 9)
        hist = [a - b for a, b in zip(macd, sig)]
        for j in range(max(1, n - W), n):
            fd = candles[j]["date"]
            if hist[j] > 0 and hist[j - 1] <= 0:
                out.append(_ie("MACD Histogram Positive", "BULLISH", 62, fd,
                               "MACD histogram flipped positive — momentum turning up"))
                break
            if hist[j] < 0 and hist[j - 1] >= 0:
                out.append(_ie("MACD Histogram Negative", "BEARISH", 62, fd,
                               "MACD histogram flipped negative — momentum turning down"))
                break
    if n >= 15:
        st = _supertrend_dir(candles)
        for j in range(max(1, n - W), n):
            fd = candles[j]["date"]
            if st[j] == 1 and st[j - 1] == -1:
                out.append(_ie("Supertrend Buy", "BULLISH", 64, fd,
                               "price closed above Supertrend — trend flip to bullish"))
                break
            if st[j] == -1 and st[j - 1] == 1:
                out.append(_ie("Supertrend Sell", "BEARISH", 64, fd,
                               "price closed below Supertrend — trend flip to bearish"))
                break
    if n >= 205:
        s50, s200 = _sma(closes, 50), _sma(closes, 200)
        if s50[-1] > s200[-1] and s50[-6] <= s200[-6]:
            out.append(_ie("Golden Cross", "BULLISH", 70, d,
                           "50 MA crossed above 200 MA"))
        elif s50[-1] < s200[-1] and s50[-6] >= s200[-6]:
            out.append(_ie("Death Cross", "BEARISH", 70, d,
                           "50 MA crossed below 200 MA"))
    return out


def _ie(name, direction, conf, date, note):
    return {"pattern": name, "direction": direction, "confidence": conf,
            "start_date": date, "end_date": date, "entry": None, "target": None,
            "stoploss": None, "note": note, "kind": "indicator"}


# ─────────────────── additional structures ───────────────────────────────

def detect_cup_patterns(candles, k=3):
    """Cup & Handle / Cup without Handle (rounding bottom) / Rounding Top."""
    out = []
    n = len(candles)
    if n < 40:
        return out
    hi, lo = swings(candles, k)
    px = candles[-1]["close"]
    # Cup: left rim in first 40%, deepest trough mid, right side recovers to rim
    left_rims = [p for p in hi if p[0] < n * 0.4]
    if left_rims and lo:
        lp = max(left_rims, key=lambda x: x[1])
        cup_ts = [t for t in lo if lp[0] < t[0] < n * 0.85]
        if cup_ts:
            cb = min(cup_ts, key=lambda x: x[1])
            depth = (lp[1] - cb[1]) / lp[1]
            if 0.10 < depth < 0.40 and cb[0] > lp[0] + 8:
                recov = max(c["high"] for c in candles[cb[0]:])
                if recov >= lp[1] * 0.95:
                    rim = max(lp[1], recov)
                    target = rim + (rim - cb[1])
                    tail = candles[-8:]
                    t_hi = max(c["high"] for c in tail)
                    t_lo = min(c["low"] for c in tail)
                    handle = (t_hi - t_lo) < depth * lp[1] * 0.35 and t_lo > cb[1] + 0.5 * (rim - cb[1])
                    if handle and px < rim:
                        out.append({"pattern": "Cup & Handle", "direction": "BULLISH",
                                    "confidence": 72,
                                    "start_date": candles[lp[0]]["date"],
                                    "end_date": candles[-1]["date"],
                                    "entry": round(rim, 2), "target": round(target, 2),
                                    "stoploss": round(t_lo, 2),
                                    "note": f"cup depth {depth*100:.0f}%, handle drifting under rim {rim:.0f}",
                                    "kind": "structure"})
                    elif px < rim * 1.02:
                        out.append({"pattern": "Cup (no handle)", "direction": "BULLISH",
                                    "confidence": 63,
                                    "start_date": candles[lp[0]]["date"],
                                    "end_date": candles[-1]["date"],
                                    "entry": round(rim, 2), "target": round(target, 2),
                                    "stoploss": round(cb[1], 2),
                                    "note": f"rounding base {depth*100:.0f}% deep, rim {rim:.0f}",
                                    "kind": "structure"})
    # Rounding top (bearish mirror)
    left_bases = [t for t in lo if t[0] < n * 0.4]
    if left_bases and hi:
        lb_ = min(left_bases, key=lambda x: x[1])
        dome_ps = [p for p in hi if lb_[0] < p[0] < n * 0.85]
        if dome_ps:
            dp = max(dome_ps, key=lambda x: x[1])
            height = (dp[1] - lb_[1]) / dp[1]
            if 0.10 < height < 0.40 and dp[0] > lb_[0] + 8:
                fall = min(c["low"] for c in candles[dp[0]:])
                if fall <= lb_[1] * 1.05 and px > lb_[1] * 0.98:
                    neck = lb_[1]
                    out.append({"pattern": "Rounding Top", "direction": "BEARISH",
                                "confidence": 60,
                                "start_date": candles[lb_[0]]["date"],
                                "end_date": candles[-1]["date"],
                                "entry": round(neck, 2),
                                "target": round(neck - (dp[1] - neck), 2),
                                "stoploss": round(dp[1], 2),
                                "note": f"dome {height*100:.0f}% high, breakdown level {neck:.0f}",
                                "kind": "structure"})
    return out


def detect_triple_top_bottom(candles, k=3, tol=0.025):
    out = []
    hi, lo = swings(candles, k)
    px = candles[-1]["close"]
    if len(hi) >= 3:
        (i1, p1), (i2, p2), (i3, p3) = hi[-3], hi[-2], hi[-1]
        if (i3 - i1 >= 12 and abs(p1 - p2) / p1 <= tol and abs(p2 - p3) / p2 <= tol
                and px < min(p1, p2, p3)):
            neck = min(c["low"] for c in candles[i1:i3 + 1])
            avg = (p1 + p2 + p3) / 3
            out.append({"pattern": "Triple Top", "direction": "BEARISH",
                        "confidence": 74 if px < neck else 60,
                        "start_date": candles[i1]["date"], "end_date": candles[-1]["date"],
                        "entry": round(neck, 2), "target": round(neck - (avg - neck), 2),
                        "stoploss": round(max(p1, p2, p3), 2),
                        "note": f"three peaks ~{avg:.0f}" + (", neckline broken" if px < neck else ", neckline holding"),
                        "kind": "structure"})
    if len(lo) >= 3:
        (i1, p1), (i2, p2), (i3, p3) = lo[-3], lo[-2], lo[-1]
        if (i3 - i1 >= 12 and abs(p1 - p2) / p1 <= tol and abs(p2 - p3) / p2 <= tol
                and px > max(p1, p2, p3)):
            neck = max(c["high"] for c in candles[i1:i3 + 1])
            avg = (p1 + p2 + p3) / 3
            out.append({"pattern": "Triple Bottom", "direction": "BULLISH",
                        "confidence": 74 if px > neck else 60,
                        "start_date": candles[i1]["date"], "end_date": candles[-1]["date"],
                        "entry": round(neck, 2), "target": round(neck + (neck - avg), 2),
                        "stoploss": round(min(p1, p2, p3), 2),
                        "note": f"three troughs ~{avg:.0f}" + (", neckline broken" if px > neck else ", neckline holding"),
                        "kind": "structure"})
    return out


def detect_wedges(candles, k=3):
    """Falling Wedge (bullish) / Rising Wedge (bearish) via slope fits."""
    out = []
    hi, lo = swings(candles, k)
    if len(hi) < 3 or len(lo) < 3:
        return out
    fh, fl = _fit(hi[-4:]), _fit(lo[-4:])
    if not fh or not fl:
        return out
    mh, ml = fh[0], fl[0]
    px = candles[-1]["close"]
    flat = 0.0004 * px
    start = min(hi[-4:][0][0], lo[-4:][0][0])
    base = {"start_date": candles[start]["date"], "end_date": candles[-1]["date"],
            "kind": "structure", "entry": None, "target": None, "stoploss": None}
    if mh < -flat and ml < -flat and mh < ml:  # both falling, highs falling faster
        out.append({**base, "pattern": "Falling Wedge", "direction": "BULLISH",
                    "confidence": 61,
                    "note": "highs and lows both falling, converging — bullish reversal on breakout"})
    if mh > flat and ml > flat and ml > mh:  # both rising, lows rising faster
        out.append({**base, "pattern": "Rising Wedge", "direction": "BEARISH",
                    "confidence": 61,
                    "note": "highs and lows both rising, converging — bearish reversal on breakdown"})
    return out


def detect_rectangle_channel(candles, k=3):
    """Rectangle (flat top + flat bottom) and parallel Channels. Higher
    confidence floor by design — these are common; only clean ones emit."""
    out = []
    hi, lo = swings(candles, k)
    if len(hi) < 3 or len(lo) < 3:
        return out
    H, L = hi[-4:], lo[-4:]
    fh, fl = _fit(H), _fit(L)
    if not fh or not fl:
        return out
    mh, ml = fh[0], fl[0]
    px = candles[-1]["close"]
    flat = 0.0004 * px
    top_vals = [p for _, p in H]
    bot_vals = [p for _, p in L]
    top_flat = (max(top_vals) - min(top_vals)) < px * 0.02
    bot_flat = (max(bot_vals) - min(bot_vals)) < px * 0.02
    start = min(H[0][0], L[0][0])
    if top_flat and bot_flat and abs(mh) <= flat and abs(ml) <= flat:
        top, bot = sum(top_vals) / len(top_vals), sum(bot_vals) / len(bot_vals)
        if (top - bot) / px > 0.03:  # meaningful range only
            out.append({"pattern": "Rectangle Range", "direction": "NEUTRAL",
                        "confidence": 66,
                        "start_date": candles[start]["date"], "end_date": candles[-1]["date"],
                        "entry": None, "target": None, "stoploss": None,
                        "note": f"consolidation {bot:.0f}–{top:.0f}; trade the break of either boundary",
                        "kind": "structure"})
    else:
        # parallel channel: similar non-flat slopes
        if mh * ml > 0 and abs(mh) > flat and abs(ml) > flat:
            ratio = mh / ml if ml else 0
            if 0.6 < ratio < 1.67:
                rising = mh > 0
                out.append({"pattern": "Channel Up" if rising else "Channel Down",
                            "direction": "BULLISH" if rising else "BEARISH",
                            "confidence": 65,
                            "start_date": candles[start]["date"], "end_date": candles[-1]["date"],
                            "entry": None, "target": None, "stoploss": None,
                            "note": ("parallel rising trend channel — trend intact while lows hold"
                                     if rising else
                                     "parallel falling trend channel — trend intact while highs hold"),
                            "kind": "structure"})
    return out


def detect_pennant_vspike(candles):
    """Pennant (pole + converging drift) and V-Bottom/V-Top spike reversals."""
    out = []
    n = len(candles)
    if n < 20:
        return out
    px = candles[-1]["close"]
    # Pennant: reuse flag pole logic but consolidation must CONVERGE
    cons = candles[-7:]
    first3 = cons[:3]; last3 = cons[-3:]
    r1 = max(c["high"] for c in first3) - min(c["low"] for c in first3)
    r2 = max(c["high"] for c in last3) - min(c["low"] for c in last3)
    pole = candles[-17:-7]
    move = (pole[-1]["close"] - pole[0]["close"]) / pole[0]["close"]
    if abs(move) >= 0.06 and r2 < r1 * 0.6 and r1 / px < 0.05:
        bull = move > 0
        edge = max(c["high"] for c in cons) if bull else min(c["low"] for c in cons)
        out.append({"pattern": "Pennant", "direction": "BULLISH" if bull else "BEARISH",
                    "confidence": 64,
                    "start_date": pole[0]["date"], "end_date": candles[-1]["date"],
                    "entry": round(edge, 2),
                    "target": round(edge * (1 + move), 2),
                    "stoploss": round(min(c["low"] for c in cons) if bull else max(c["high"] for c in cons), 2),
                    "note": f"pole {move*100:+.1f}% then converging drift — continuation on break",
                    "kind": "structure"})
    # V-spike: >=8% move in <=6 bars immediately reversed >=60% within <=6 bars
    if n >= 14:
        w = candles[-14:]
        closes = [c["close"] for c in w]
        mid = min(range(len(w)), key=lambda i: closes[i])
        if 3 <= mid <= 10:
            drop = (closes[0] - closes[mid]) / closes[0]
            recov = (closes[-1] - closes[mid]) / max(closes[0] - closes[mid], 1e-9)
            if drop >= 0.08 and recov >= 0.6:
                out.append({"pattern": "V-Bottom", "direction": "BULLISH", "confidence": 60,
                            "start_date": w[0]["date"], "end_date": w[-1]["date"],
                            "entry": None, "target": round(closes[0], 2),
                            "stoploss": round(closes[mid], 2),
                            "note": f"spike down {drop*100:.0f}% sharply reclaimed — momentum reversal",
                            "kind": "structure"})
        mid = max(range(len(w)), key=lambda i: closes[i])
        if 3 <= mid <= 10:
            rise = (closes[mid] - closes[0]) / closes[0]
            giveback = (closes[mid] - closes[-1]) / max(closes[mid] - closes[0], 1e-9)
            if rise >= 0.08 and giveback >= 0.6:
                out.append({"pattern": "V-Top", "direction": "BEARISH", "confidence": 60,
                            "start_date": w[0]["date"], "end_date": w[-1]["date"],
                            "entry": None, "target": round(closes[0], 2),
                            "stoploss": round(closes[mid], 2),
                            "note": f"spike up {rise*100:.0f}% sharply surrendered — momentum reversal",
                            "kind": "structure"})
    return out


def detect_candles_extended(candles, lookback=5):
    """Piercing Line / Dark Cloud Cover, Three White Soldiers / Black Crows,
    Tweezer Top / Bottom."""
    out = []
    n = len(candles)
    if n < 4:
        return out
    start = max(3, n - lookback)
    for i in range(start, n):
        c, p = candles[i], candles[i - 1]
        d = c["date"]
        if (_bear(p) and _bull(c) and c["open"] < p["low"]
                and c["close"] > (p["open"] + p["close"]) / 2 and c["close"] < p["open"]):
            out.append(_cs("Piercing Line", "BULLISH", 66, d,
                           "gap-down open reclaimed above prior midpoint"))
        if (_bull(p) and _bear(c) and c["open"] > p["high"]
                and c["close"] < (p["open"] + p["close"]) / 2 and c["close"] > p["open"]):
            out.append(_cs("Dark Cloud Cover", "BEARISH", 66, d,
                           "gap-up open sold below prior midpoint"))
        if i >= 3:
            a, b = candles[i - 2], candles[i - 1]
            bodies_ok = all(_body(x) / _rng(x) > 0.5 for x in (a, b, c))
            if (_bull(a) and _bull(b) and _bull(c) and bodies_ok
                    and b["close"] > a["close"] and c["close"] > b["close"]):
                out.append(_cs("Three White Soldiers", "BULLISH", 70, d,
                               "three consecutive strong advancing bars"))
            if (_bear(a) and _bear(b) and _bear(c) and bodies_ok
                    and b["close"] < a["close"] and c["close"] < b["close"]):
                out.append(_cs("Three Black Crows", "BEARISH", 70, d,
                               "three consecutive strong declining bars"))
        if abs(c["high"] - p["high"]) / p["high"] < 0.0015 and _bull(p) and _bear(c):
            out.append(_cs("Tweezer Top", "BEARISH", 58, d,
                           "matching highs rejected on consecutive bars"))
        if abs(c["low"] - p["low"]) / p["low"] < 0.0015 and _bear(p) and _bull(c):
            out.append(_cs("Tweezer Bottom", "BULLISH", 58, d,
                           "matching lows defended on consecutive bars"))
    seen, ded = set(), []
    for x in out:
        kk = (x["pattern"], x["end_date"])
        if kk not in seen:
            seen.add(kk); ded.append(x)
    return ded


# ─────────────────────────── orchestrator ───────────────────────────────

TIMEFRAMES = {
    "daily": {"label": "Daily chart", "validity": "valid 1–5 days", "min_bars": 60},
    "weekly": {"label": "Weekly chart", "validity": "valid 2–8 weeks", "min_bars": 60},
    "monthly": {"label": "Monthly chart", "validity": "valid 3–12 months", "min_bars": 36},
}


def scan(daily_candles: List[dict], timeframe: str = "daily") -> Optional[dict]:
    """Run all detectors on the requested timeframe (resampled from daily).
    Returns {timeframe, label, validity, bars, patterns, levels, data_ok}
    or None if insufficient data (honest refusal, never a guess)."""
    tf = TIMEFRAMES.get(timeframe)
    if not tf:
        return None
    if timeframe == "weekly":
        candles = resample_weekly(daily_candles)
    elif timeframe == "monthly":
        candles = resample_monthly(daily_candles)
    else:
        candles = daily_candles
    if len(candles) < tf["min_bars"]:
        return {"timeframe": timeframe, "label": tf["label"],
                "validity": tf["validity"], "bars": len(candles),
                "patterns": [], "levels": None, "data_ok": False,
                "note": f"insufficient history ({len(candles)} bars < "
                        f"{tf['min_bars']} required) — no detection attempted"}
    pats = (detect_candlesticks(candles)
            + detect_candles_extended(candles)
            + detect_double_top_bottom(candles)
            + detect_triple_top_bottom(candles)
            + detect_head_shoulders(candles)
            + detect_triangle(candles)
            + detect_wedges(candles)
            + detect_rectangle_channel(candles)
            + detect_flag(candles)
            + detect_pennant_vspike(candles)
            + detect_cup_patterns(candles)
            + detect_indicator_events(candles))
    pats.sort(key=lambda p: -p["confidence"])
    return {"timeframe": timeframe, "label": tf["label"],
            "validity": tf["validity"], "bars": len(candles),
            "patterns": pats, "levels": support_resistance(candles),
            "data_ok": True}
