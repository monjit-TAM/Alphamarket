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
            if i2 - i1 >= 5 and i2 - i1 <= 120 and abs(p1 - p2) / p1 <= tol and \
               p1 >= candles[-1]["close"] * 1.02 and \
               max(c["high"] for c in candles[i1:i2 + 1]) <= max(p1, p2) * 1.005:  # dominance: peaks ARE the top
                seg_lo = min(c["low"] for c in candles[i1:i2 + 1])
                if 0.03 <= (max(p1, p2) - seg_lo) / max(p1, p2) <= 0.35:  # O'Neil depth band
                    pair = ((i1, p1), (i2, p2)); break
        if pair: break
    if pair:
        (i1, p1), (i2, p2) = pair
        if True:
            trough = min(c["low"] for c in candles[i1:i2 + 1])
            if last < trough and last > trough * 0.90:  # confirmed AND breakout still fresh
                depth = ((p1 + p2) / 2) - trough
                out.append({"pattern": "Double Top", "direction": "BEARISH",
                            "confidence": 75,
                            "start_date": candles[i1]["date"],
                            "end_date": candles[-1]["date"],
                            "entry": round(trough, 2),
                            "target": round(trough - depth, 2),
                            "stoploss": round(max(p1, p2), 2),
                            "note": f"twin peaks ~{p1:.0f}, neckline {trough:.0f} broken",
                            "geometry": {"lines": [{"label": "Neckline", "points": [
                                    {"t": candles[i1]["date"], "price": round(trough, 2)},
                                    {"t": candles[-1]["date"], "price": round(trough, 2)}]}],
                                "markers": [
                                    {"t": candles[i1]["date"], "price": round(p1, 2), "kind": "peak"},
                                    {"t": candles[i2]["date"], "price": round(p2, 2), "kind": "peak"}]},
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
                            "geometry": {"lines": [{"label": "Neckline (unconfirmed)", "points": [
                                    {"t": candles[i1]["date"], "price": round(trough, 2)},
                                    {"t": candles[i2]["date"], "price": round(trough, 2)}]}],
                                "markers": [
                                    {"t": candles[i1]["date"], "price": round(p1, 2), "kind": "peak"},
                                    {"t": candles[i2]["date"], "price": round(p2, 2), "kind": "peak"}]},
                            "kind": "structure"})
    pair = None
    for a in range(len(lo) - 1, 0, -1):
        for b in range(a - 1, max(-1, a - 4), -1):
            (i1, p1), (i2, p2) = lo[b], lo[a]
            if i2 - i1 >= 5 and i2 - i1 <= 120 and abs(p1 - p2) / p1 <= tol and \
               p1 <= candles[-1]["close"] * 0.98 and \
               min(c["low"] for c in candles[i1:i2 + 1]) >= min(p1, p2) * 0.995:  # dominance: troughs ARE the bottom
                seg_hi = max(c["high"] for c in candles[i1:i2 + 1])
                if 0.03 <= (seg_hi - min(p1, p2)) / seg_hi <= 0.35:
                    pair = ((i1, p1), (i2, p2)); break
        if pair: break
    if pair:
        (i1, p1), (i2, p2) = pair
        if True:
            peak = max(c["high"] for c in candles[i1:i2 + 1])
            if last > peak and last < peak * 1.10:  # confirmed AND breakout still fresh
                depth = peak - ((p1 + p2) / 2)
                out.append({"pattern": "Double Bottom", "direction": "BULLISH",
                            "confidence": 75,
                            "start_date": candles[i1]["date"],
                            "end_date": candles[-1]["date"],
                            "entry": round(peak, 2),
                            "target": round(peak + depth, 2),
                            "stoploss": round(min(p1, p2), 2),
                            "note": f"twin troughs ~{p1:.0f}, neckline {peak:.0f} broken",
                            "geometry": {"lines": [{"label": "Neckline", "points": [
                                    {"t": candles[i1]["date"], "price": round(peak, 2)},
                                    {"t": candles[-1]["date"], "price": round(peak, 2)}]}],
                                "markers": [
                                    {"t": candles[i1]["date"], "price": round(p1, 2), "kind": "trough"},
                                    {"t": candles[i2]["date"], "price": round(p2, 2), "kind": "trough"}]},
                            "kind": "structure"})
    # Mutual exclusion (Coforge case 16 Jul): a chart cannot be a double top AND a
    # double bottom at once — if both emitted, keep only the higher-confidence one.
    if any("Top" in p["pattern"] for p in out) and any("Bottom" in p["pattern"] for p in out):
        out = [max(out, key=lambda p: p["confidence"])]
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
                        "geometry": {"lines": [{"label": "Neckline", "points": [
                                {"t": candles[i1]["date"], "price": round(neck, 2)},
                                {"t": candles[-1]["date"], "price": round(neck, 2)}]}],
                            "markers": [
                                {"t": candles[i1]["date"], "price": round(s1, 2), "kind": "shoulder"},
                                {"t": candles[i2]["date"], "price": round(h, 2), "kind": "head"},
                                {"t": candles[i3]["date"], "price": round(s2, 2), "kind": "shoulder"}]},
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
                        "geometry": {"lines": [{"label": "Neckline", "points": [
                                {"t": candles[i1]["date"], "price": round(neck, 2)},
                                {"t": candles[-1]["date"], "price": round(neck, 2)}]}],
                            "markers": [
                                {"t": candles[i1]["date"], "price": round(s1, 2), "kind": "shoulder"},
                                {"t": candles[i2]["date"], "price": round(h, 2), "kind": "head"},
                                {"t": candles[i3]["date"], "price": round(s2, 2), "kind": "shoulder"}]},
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
    _i1 = len(candles) - 1
    base = {"start_date": candles[span_start]["date"],
            "end_date": candles[-1]["date"], "kind": "structure",
            "geometry": {"lines": [
                {"label": "Upper trendline", "points": [
                    {"t": candles[span_start]["date"], "price": round(fh[0] * span_start + fh[1], 2)},
                    {"t": candles[_i1]["date"], "price": round(fh[0] * _i1 + fh[1], 2)}]},
                {"label": "Lower trendline", "points": [
                    {"t": candles[span_start]["date"], "price": round(fl[0] * span_start + fl[1], 2)},
                    {"t": candles[_i1]["date"], "price": round(fl[0] * _i1 + fl[1], 2)}]}]}}
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
                    "geometry": {"lines": [
                        {"label": "Pole", "points": [
                            {"t": pole[0]["date"], "price": round(pole[0]["close"], 2)},
                            {"t": pole[-1]["date"], "price": round(pole[-1]["close"], 2)}]},
                        {"label": "Flag top", "points": [
                            {"t": cons[0]["date"], "price": round(c_hi, 2)},
                            {"t": candles[-1]["date"], "price": round(c_hi, 2)}]},
                        {"label": "Flag bottom", "points": [
                            {"t": cons[0]["date"], "price": round(c_lo, 2)},
                            {"t": candles[-1]["date"], "price": round(c_lo, 2)}]}]},
                    "kind": "structure"})
    elif move <= -0.06:
        out.append({"pattern": "Bear Flag", "direction": "BEARISH", "confidence": 68,
                    "start_date": pole[0]["date"], "end_date": candles[-1]["date"],
                    "entry": round(c_lo, 2),
                    "target": round(c_lo * (1 + move), 2),
                    "stoploss": round(c_hi, 2),
                    "note": f"pole {move*100:.1f}% then tight drift — continuation on break",
                    "geometry": {"lines": [
                        {"label": "Pole", "points": [
                            {"t": pole[0]["date"], "price": round(pole[0]["close"], 2)},
                            {"t": pole[-1]["date"], "price": round(pole[-1]["close"], 2)}]},
                        {"label": "Flag top", "points": [
                            {"t": cons[0]["date"], "price": round(c_hi, 2)},
                            {"t": candles[-1]["date"], "price": round(c_hi, 2)}]},
                        {"label": "Flag bottom", "points": [
                            {"t": cons[0]["date"], "price": round(c_lo, 2)},
                            {"t": candles[-1]["date"], "price": round(c_lo, 2)}]}]},
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


def _atr(candles, n=14):
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
            if 0.10 < depth < 0.35 and cb[0] > lp[0] + 8:
                recov = max(c["high"] for c in candles[cb[0]:])
                if recov >= lp[1] * 0.95:
                    rim = max(lp[1], recov)
                    target = rim + (rim - cb[1])
                    tail = candles[-8:]
                    t_hi = max(c["high"] for c in tail)
                    t_lo = min(c["low"] for c in tail)
                    handle = (t_hi - t_lo) < depth * lp[1] * 0.35 and t_lo > cb[1] + 0.5 * (rim - cb[1])
                    if handle and rim * 0.85 <= px < rim:
                        out.append({"pattern": "Cup & Handle", "direction": "BULLISH",
                                    "confidence": 72,
                                    "start_date": candles[lp[0]]["date"],
                                    "end_date": candles[-1]["date"],
                                    "entry": round(rim, 2), "target": round(target, 2),
                                    "stoploss": round(t_lo, 2),
                                    "note": f"cup depth {depth*100:.0f}%, handle drifting under rim {rim:.0f}",
                                    "geometry": {"lines": [{"label": "Rim", "points": [
                                            {"t": candles[lp[0]]["date"], "price": round(rim, 2)},
                                            {"t": candles[-1]["date"], "price": round(rim, 2)}]}],
                                        "markers": [
                                            {"t": candles[lp[0]]["date"], "price": round(lp[1], 2), "kind": "rim"},
                                            {"t": candles[cb[0]]["date"], "price": round(cb[1], 2), "kind": "base"},
                                            {"t": tail[0]["date"], "price": round(t_lo, 2), "kind": "handle"}]},
                                    "kind": "structure"})
                    elif rim * 0.85 <= px < rim * 1.02:
                        out.append({"pattern": "Cup (no handle)", "direction": "BULLISH",
                                    "confidence": 63,
                                    "start_date": candles[lp[0]]["date"],
                                    "end_date": candles[-1]["date"],
                                    "entry": round(rim, 2), "target": round(target, 2),
                                    "stoploss": round(cb[1], 2),
                                    "note": f"rounding base {depth*100:.0f}% deep, rim {rim:.0f}",
                                    "geometry": {"lines": [{"label": "Rim", "points": [
                                            {"t": candles[lp[0]]["date"], "price": round(rim, 2)},
                                            {"t": candles[-1]["date"], "price": round(rim, 2)}]}],
                                        "markers": [
                                            {"t": candles[lp[0]]["date"], "price": round(lp[1], 2), "kind": "rim"},
                                            {"t": candles[cb[0]]["date"], "price": round(cb[1], 2), "kind": "base"}]},
                                    "kind": "structure"})
    # Rounding top (bearish mirror)
    left_bases = [t for t in lo if t[0] < n * 0.4]
    if left_bases and hi:
        lb_ = min(left_bases, key=lambda x: x[1])
        dome_ps = [p for p in hi if lb_[0] < p[0] < n * 0.85]
        if dome_ps:
            dp = max(dome_ps, key=lambda x: x[1])
            height = (dp[1] - lb_[1]) / dp[1]
            if 0.10 < height < 0.35 and dp[0] > lb_[0] + 8:
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
                                "geometry": {"lines": [{"label": "Breakdown level", "points": [
                                        {"t": candles[lb_[0]]["date"], "price": round(neck, 2)},
                                        {"t": candles[-1]["date"], "price": round(neck, 2)}]}],
                                    "markers": [{"t": candles[dp[0]]["date"], "price": round(dp[1], 2), "kind": "dome peak"}]},
                                "kind": "structure"})
    return out


def detect_triple_top_bottom(candles, k=3, tol=0.025):
    out = []
    hi, lo = swings(candles, k)
    px = candles[-1]["close"]
    if len(hi) >= 3:
        (i1, p1), (i2, p2), (i3, p3) = hi[-3], hi[-2], hi[-1]
        _t12 = min((c["low"] for c in candles[i1:i2 + 1]), default=p1)
        _t23 = min((c["low"] for c in candles[i2:i3 + 1]), default=p2)
        _avgp = (p1 + p2 + p3) / 3
        if (i3 - i1 >= 12 and i2 - i1 >= 4 and i3 - i2 >= 4
                and abs(p1 - p2) / p1 <= tol and abs(p2 - p3) / p2 <= tol
                and _t12 < _avgp * 0.985 and _t23 < _avgp * 0.985
                and px < min(p1, p2, p3)):
            neck = min(c["low"] for c in candles[i1:i3 + 1])
            avg = (p1 + p2 + p3) / 3
            out.append({"pattern": "Triple Top", "direction": "BEARISH",
                        "confidence": 74 if px < neck else 60,
                        "start_date": candles[i1]["date"], "end_date": candles[-1]["date"],
                        "entry": round(neck, 2), "target": round(neck - (avg - neck), 2),
                        "stoploss": round(max(p1, p2, p3), 2),
                        "geometry": {"lines": [{"label": "Neckline", "points": [
                                {"t": candles[i1]["date"], "price": round(neck, 2)},
                                {"t": candles[-1]["date"], "price": round(neck, 2)}]}],
                            "markers": [
                                {"t": candles[i1]["date"], "price": round(p1, 2), "kind": "peak"},
                                {"t": candles[i2]["date"], "price": round(p2, 2), "kind": "peak"},
                                {"t": candles[i3]["date"], "price": round(p3, 2), "kind": "peak"}]},
                        "note": f"three peaks ~{avg:.0f}" + (", neckline broken" if px < neck else ", neckline holding"),
                        "kind": "structure"})
    if len(lo) >= 3:
        (i1, p1), (i2, p2), (i3, p3) = lo[-3], lo[-2], lo[-1]
        _r12 = max((c["high"] for c in candles[i1:i2 + 1]), default=p1)
        _r23 = max((c["high"] for c in candles[i2:i3 + 1]), default=p2)
        _avgt = (p1 + p2 + p3) / 3
        if (i3 - i1 >= 12 and i2 - i1 >= 4 and i3 - i2 >= 4
                and abs(p1 - p2) / p1 <= tol and abs(p2 - p3) / p2 <= tol
                and _r12 > _avgt * 1.015 and _r23 > _avgt * 1.015
                and px > max(p1, p2, p3)):
            neck = max(c["high"] for c in candles[i1:i3 + 1])
            avg = (p1 + p2 + p3) / 3
            out.append({"pattern": "Triple Bottom", "direction": "BULLISH",
                        "confidence": 74 if px > neck else 60,
                        "start_date": candles[i1]["date"], "end_date": candles[-1]["date"],
                        "entry": round(neck, 2), "target": round(neck + (neck - avg), 2),
                        "stoploss": round(min(p1, p2, p3), 2),
                        "geometry": {"lines": [{"label": "Neckline", "points": [
                                {"t": candles[i1]["date"], "price": round(neck, 2)},
                                {"t": candles[-1]["date"], "price": round(neck, 2)}]}],
                            "markers": [
                                {"t": candles[i1]["date"], "price": round(p1, 2), "kind": "trough"},
                                {"t": candles[i2]["date"], "price": round(p2, 2), "kind": "trough"},
                                {"t": candles[i3]["date"], "price": round(p3, 2), "kind": "trough"}]},
                        "note": f"three troughs ~{avg:.0f}" + (", neckline broken" if px > neck else ", neckline holding"),
                        "kind": "structure"})
    return out


def detect_wedges(candles, k=3):
    """Falling Wedge (bullish) / Rising Wedge (bearish) via slope fits."""
    out = []
    hi, lo = swings(candles, k)
    if len(hi) < 3 or len(lo) < 3:
        return out
    H, L = hi[-4:], lo[-4:]
    fh, fl = _fit(H), _fit(L)
    if not fh or not fl:
        return out
    # Geometry tightening (Bajaj audit 16 Jul): wedge requires >=3 touches per line,
    # >=15 bars duration, and REAL convergence (channel width shrinks >=30%).
    # If the fit gives no intercept, refuse to emit rather than guess.
    try:
        mh, ch = float(fh[0]), float(fh[1])
        ml, cl_ = float(fl[0]), float(fl[1])
    except (IndexError, TypeError, ValueError):
        return out
    if len(H) < 3 or len(L) < 3:
        return out
    px = candles[-1]["close"]
    flat = 0.0004 * px
    i0, i1 = min(H[0][0], L[0][0]), len(candles) - 1
    if i1 - i0 < 15:
        return out
    w0 = (mh * i0 + ch) - (ml * i0 + cl_)
    w1 = (mh * i1 + ch) - (ml * i1 + cl_)
    if w0 <= 0 or w1 <= 0 or w1 > w0 * 0.70:
        return out  # not genuinely converging
    geo = {"lines": [
        {"label": "Upper trendline", "points": [
            {"t": candles[i0]["date"], "price": round(mh * i0 + ch, 2)},
            {"t": candles[i1]["date"], "price": round(mh * i1 + ch, 2)}]},
        {"label": "Lower trendline", "points": [
            {"t": candles[i0]["date"], "price": round(ml * i0 + cl_, 2)},
            {"t": candles[i1]["date"], "price": round(ml * i1 + cl_, 2)}]}]}
    base = {"start_date": candles[i0]["date"], "end_date": candles[-1]["date"],
            "kind": "structure", "entry": None, "target": None, "stoploss": None,
            "geometry": geo}
    if mh < -flat and ml < -flat and mh < ml:
        out.append({**base, "pattern": "Falling Wedge", "direction": "BULLISH",
                    "confidence": 63,
                    "note": f"converging decline ({(1-w1/w0)*100:.0f}% width contraction) — bullish reversal on breakout"})
    if mh > flat and ml > flat and ml > mh:
        out.append({**base, "pattern": "Rising Wedge", "direction": "BEARISH",
                    "confidence": 63,
                    "note": f"converging advance ({(1-w1/w0)*100:.0f}% width contraction) — bearish reversal on breakdown"})
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
                        "geometry": {"lines": [
                            {"label": "Resistance", "points": [
                                {"t": candles[start]["date"], "price": round(top, 2)},
                                {"t": candles[-1]["date"], "price": round(top, 2)}]},
                            {"label": "Support", "points": [
                                {"t": candles[start]["date"], "price": round(bot, 2)},
                                {"t": candles[-1]["date"], "price": round(bot, 2)}]}]},
                        "note": f"consolidation {bot:.0f}–{top:.0f}; trade the break of either boundary",
                        "kind": "structure"})
    else:
        # parallel channel: similar non-flat slopes
        if mh * ml > 0 and abs(mh) > flat and abs(ml) > flat:
            ratio = mh / ml if ml else 0
            if 0.6 < ratio < 1.67:
                rising = mh > 0
                _ci = len(candles) - 1
                out.append({"pattern": "Channel Up" if rising else "Channel Down",
                            "direction": "BULLISH" if rising else "BEARISH",
                            "confidence": 65,
                            "start_date": candles[start]["date"], "end_date": candles[-1]["date"],
                            "entry": None, "target": None, "stoploss": None,
                            "geometry": {"lines": [
                                {"label": "Upper channel", "points": [
                                    {"t": candles[start]["date"], "price": round(fh[0] * start + fh[1], 2)},
                                    {"t": candles[_ci]["date"], "price": round(fh[0] * _ci + fh[1], 2)}]},
                                {"label": "Lower channel", "points": [
                                    {"t": candles[start]["date"], "price": round(fl[0] * start + fl[1], 2)},
                                    {"t": candles[_ci]["date"], "price": round(fl[0] * _ci + fl[1], 2)}]}]},
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
                    "geometry": {"lines": [
                        {"label": "Pole", "points": [
                            {"t": pole[0]["date"], "price": round(pole[0]["close"], 2)},
                            {"t": pole[-1]["date"], "price": round(pole[-1]["close"], 2)}]},
                        {"label": "Upper", "points": [
                            {"t": first3[0]["date"], "price": round(max(c["high"] for c in first3), 2)},
                            {"t": last3[-1]["date"], "price": round(max(c["high"] for c in last3), 2)}]},
                        {"label": "Lower", "points": [
                            {"t": first3[0]["date"], "price": round(min(c["low"] for c in first3), 2)},
                            {"t": last3[-1]["date"], "price": round(min(c["low"] for c in last3), 2)}]}]},
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
                            "geometry": {"lines": [{"label": "Recovery", "points": [
                                    {"t": w[mid]["date"], "price": round(closes[mid], 2)},
                                    {"t": w[-1]["date"], "price": round(closes[-1], 2)}]}],
                                "markers": [{"t": w[mid]["date"], "price": round(closes[mid], 2), "kind": "spike low"}]},
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


# ──────────────────── per-timeframe indicators (16 Jul) ─────────────────
# Bajaj: "RSI, MACD, ADX not changing with timeframe" — the page's indicator
# panel was daily-always. scan() holds resampled candles at exactly the right
# moment, so compute here per timeframe. Wilder-standard; None when history
# is short (honest absence, never a guess).

def _tf_indicators(candles):
    closes = [c["close"] for c in candles]
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]
    out = {}
    n = 14
    if len(closes) >= n + 1:
        g = l = 0.0
        for i in range(1, n + 1):
            d = closes[i] - closes[i-1]
            g, l = g + max(d, 0), l + max(-d, 0)
        ag, al = g / n, l / n
        for i in range(n + 1, len(closes)):
            d = closes[i] - closes[i-1]
            ag = (ag * (n-1) + max(d, 0)) / n
            al = (al * (n-1) + max(-d, 0)) / n
        out["rsi"] = round(100.0 if al == 0 else 100 - 100 / (1 + ag / al), 1)
    def _ema_s(data, period):
        k = 2 / (period + 1)
        e = sum(data[:period]) / period
        o = [e]
        for v in data[period:]:
            e = v * k + e * (1 - k); o.append(e)
        return o
    if len(closes) >= 35:
        e12, e26 = _ema_s(closes, 12), _ema_s(closes, 26)
        m = [a - b for a, b in zip(e12[len(e12)-len(e26):], e26)]
        out["macd"] = round(m[-1], 2)
        if len(m) >= 9:
            out["macd_signal"] = round(_ema_s(m, 9)[-1], 2)
    if len(closes) >= 2 * n + 2:
        pdm, ndm, trl = [], [], []
        for i in range(1, len(closes)):
            up, dn = highs[i] - highs[i-1], lows[i-1] - lows[i]
            pdm.append(up if up > dn and up > 0 else 0.0)
            ndm.append(dn if dn > up and dn > 0 else 0.0)
            trl.append(max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1])))
        def _sm(xs):
            s = sum(xs[:n]); o = [s]
            for x in xs[n:]: s = s - s / n + x; o.append(s)
            return o
        st, sp, sn = _sm(trl), _sm(pdm), _sm(ndm)
        dxs = []
        for i in range(len(st)):
            if st[i] == 0: continue
            pdi, ndi = 100 * sp[i] / st[i], 100 * sn[i] / st[i]
            if pdi + ndi > 0: dxs.append(100 * abs(pdi - ndi) / (pdi + ndi))
        if len(dxs) >= n:
            a = sum(dxs[:n]) / n
            for d in dxs[n:]: a = (a * (n-1) + d) / n
            out["adx"] = int(round(a))
    if len(closes) >= 20:
        sma20 = sum(closes[-20:]) / 20
        out["sma20"] = round(sma20, 2)
        var = sum((c - sma20) ** 2 for c in closes[-20:]) / 20
        out["bb_width"] = round((var ** 0.5) * 4 / sma20 * 100, 2) if sma20 else None
    if len(closes) >= 50:
        out["sma50"] = round(sum(closes[-50:]) / 50, 2)
    return out


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
            "indicators": _tf_indicators(candles),
            "data_ok": True}
