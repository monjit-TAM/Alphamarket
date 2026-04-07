"""
AlphaScore™ — Proprietary Composite Stock Rating Engine
========================================================
0-100 score per stock. 5 dimensions, weighted algorithm. Patent pending.
Adapted to sb_universe field names from warm_cache_direct.py
"""
import math
import logging
from typing import Dict, List
from datetime import datetime

logger = logging.getLogger("alphascore")

# ── DIMENSION WEIGHTS (CONFIDENTIAL — never expose) ──────────────────
_W = {
    "technical":    0.25,
    "fundamental":  0.25,
    "ownership":    0.20,
    "momentum":     0.15,
    "risk_alpha":   0.15,
}

def _sig(x, mid=0, k=1):
    try: return 100 / (1 + math.exp(-k * (x - mid)))
    except OverflowError: return 0.0 if x < mid else 100.0

def _clamp(v, lo=0, hi=100): return max(lo, min(hi, v))

def _f(d, key, default=0.0):
    try:
        v = d.get(key, default)
        return float(v) if v is not None else default
    except (ValueError, TypeError): return default


# ── DIMENSION 1: TECHNICAL STRENGTH (25%) — 12 sub-factors ──────────
def _score_technical(d):
    s = []

    # RSI
    rsi = _f(d, "rsi", 50)
    if rsi < 30: s.append(75)
    elif rsi < 45: s.append(65)
    elif rsi <= 55: s.append(50)
    elif rsi <= 70: s.append(60)
    else: s.append(30)

    # Price vs SMA-50
    price = _f(d, "price", 0)
    above_50 = d.get("above_50dma", False)
    s.append(70 if above_50 else 30)

    # Price vs SMA-200
    above_200 = d.get("above_200dma", False)
    s.append(70 if above_200 else 30)

    # Golden/Death cross proxy (SMA50 vs SMA200)
    sma50 = _f(d, "sma_50", 0)
    sma200 = _f(d, "sma_200", 0)
    if sma50 > 0 and sma200 > 0:
        if sma50 > sma200: s.append(75)
        else: s.append(30)
    else: s.append(50)

    # MACD histogram
    macd_h = _f(d, "macd_hist", 0)
    s.append(_sig(macd_h, mid=0, k=2))

    # MACD cross up (boolean)
    if d.get("macd_cross_up"): s.append(80)
    else: s.append(40)

    # Supertrend
    above_st = d.get("above_supertrend", False)
    s.append(75 if above_st else 25)

    # Volume ratio
    vol_ratio = _f(d, "vol_ratio", 1)
    s.append(_clamp(vol_ratio * 40, 20, 90))

    # 52-week high proximity
    pct_from_52h = _f(d, "pct_from_52h", -20)
    s.append(_clamp(100 + pct_from_52h, 10, 95))

    # Bollinger Band width (squeeze detection)
    bb_w = _f(d, "bb_width", 5)
    if bb_w < 3: s.append(70)  # squeeze — breakout potential
    elif bb_w < 6: s.append(55)
    else: s.append(35)  # wide — volatile

    # Bollinger position
    bb_upper = _f(d, "bb_upper", 0)
    bb_lower = _f(d, "bb_lower", 0)
    if bb_upper > bb_lower > 0:
        pct_b = (price - bb_lower) / (bb_upper - bb_lower)
        if pct_b < 0.2: s.append(70)
        elif pct_b > 0.8: s.append(35)
        else: s.append(55)
    else: s.append(50)

    # Gap %
    gap = _f(d, "gap_pct", 0)
    if gap > 2: s.append(70)
    elif gap > 0: s.append(55)
    elif gap > -2: s.append(45)
    else: s.append(30)

    return sum(s) / len(s) if s else 50


# ── DIMENSION 2: FUNDAMENTAL QUALITY (25%) — uses available fields ───
def _score_fundamental(d):
    s = []

    # PE ratio
    pe = _f(d, "pe_ratio", 0)
    if pe <= 0: s.append(15)
    elif pe < 15: s.append(85)
    elif pe < 25: s.append(70)
    elif pe < 40: s.append(50)
    elif pe < 60: s.append(30)
    else: s.append(15)

    # ROE — Yahoo may return as % (e.g., 15.0 = 15%)
    roe = _f(d, "roe", 0)
    if roe > 1 and roe < 100:  # already in %, use directly
        pass
    elif 0 < roe <= 1:  # ratio form, convert
        roe = roe * 100
    s.append(_clamp(_sig(roe, mid=12, k=0.2), 5, 95))

    # Debt-to-Equity — Yahoo returns as % (35.64 = 35.64% = 0.36 ratio)
    de = _f(d, "debt_equity", 0)
    if de > 5:  # clearly in percentage form
        de = de / 100.0
    if de < 0.3: s.append(90)
    elif de < 0.7: s.append(70)
    elif de < 1.0: s.append(50)
    elif de < 2.0: s.append(30)
    else: s.append(10)

    # Dividend yield — Yahoo returns as % * 100 (83 = 0.83%)
    div_y = _f(d, "dividend_yield", 0)
    if div_y > 20:  # clearly in wrong scale, divide by 100
        div_y = div_y / 100.0
    if div_y > 4: s.append(85)
    elif div_y > 2: s.append(70)
    elif div_y > 0.5: s.append(55)
    else: s.append(35)

    # Market cap — Yahoo returns in raw (17654463070208), convert to Cr
    mcap = _f(d, "market_cap", 0)
    if mcap > 1e9:  # raw bytes, convert to Cr
        mcap = mcap / 1e7
    if mcap > 100000: s.append(75)      # large cap >1L Cr
    elif mcap > 20000: s.append(60)     # mid cap
    elif mcap > 5000: s.append(50)      # small cap
    else: s.append(35)

    # Use pre-computed fundamental_score if available
    fs = _f(d, "fundamental_score", 0)
    if fs > 0:
        s.append(_clamp(fs * 10, 5, 95))

    return sum(s) / len(s) if s else 50


# ── DIMENSION 3: OWNERSHIP / ACCUMULATION (20%) ─────────────────────
def _score_ownership(d):
    s = []

    # Use pre-computed accumulation_score
    acc = _f(d, "accumulation_score", 0)
    if acc > 0:
        s.append(_clamp(acc * 10, 5, 95))
    else:
        s.append(50)

    # Minervini score (institutional quality proxy)
    min_score = _f(d, "minervini_score", 0)
    if min_score >= 7: s.append(90)
    elif min_score >= 5: s.append(70)
    elif min_score >= 3: s.append(50)
    else: s.append(30)

    # Volume ratio as institutional interest proxy
    vol_ratio = _f(d, "vol_ratio", 1)
    if vol_ratio > 3: s.append(85)
    elif vol_ratio > 1.5: s.append(65)
    elif vol_ratio > 0.8: s.append(50)
    else: s.append(30)

    return sum(s) / len(s) if s else 50


# ── DIMENSION 4: MOMENTUM & SENTIMENT (15%) ─────────────────────────
def _score_momentum(d):
    s = []

    # 1-month RS
    rs1m = _f(d, "rs_1m", 0)
    s.append(_clamp(_sig(rs1m, mid=3, k=0.3), 5, 95))

    # 3-month RS
    rs3m = _f(d, "rs_3m", 0)
    s.append(_clamp(_sig(rs3m, mid=8, k=0.15), 5, 95))

    # Weekly change
    wk = _f(d, "wk_change", 0)
    s.append(_clamp(_sig(wk, mid=1, k=0.5), 5, 95))

    # Daily change
    chg = _f(d, "change_pct", 0)
    s.append(_clamp(_sig(chg, mid=0, k=0.8), 10, 90))

    # Pre-computed momentum_score
    ms = _f(d, "momentum_score", 0)
    if ms > 0:
        s.append(_clamp(ms * 10, 5, 95))

    # Pre-computed sentiment_score
    ss = _f(d, "sentiment_score", 0)
    if ss > 0:
        s.append(_clamp(ss * 10, 5, 95))

    return sum(s) / len(s) if s else 50


# ── DIMENSION 5: RISK-ADJUSTED ALPHA (15%) ──────────────────────────
def _score_risk_alpha(d):
    s = []

    # Alpha rating (pre-computed)
    ar = _f(d, "alpha_rating", 0)
    if ar > 0:
        s.append(_clamp(ar * 10, 5, 95))

    # Trend score
    ts = _f(d, "trend_score", 0)
    if ts > 0:
        s.append(_clamp(ts * 10, 5, 95))

    # Drawdown from 52w high as risk measure
    dd = _f(d, "pct_from_52h", -20)
    s.append(_clamp(100 + (dd * 1.5), 5, 95))

    # Distance from 52w low (recovery strength)
    up_from_low = _f(d, "pct_from_52l", 0)
    s.append(_clamp(_sig(up_from_low, mid=30, k=0.05), 5, 95))

    # Low volatility bonus (narrow BB = stable)
    bb_w = _f(d, "bb_width", 5)
    if bb_w < 4: s.append(70)
    elif bb_w < 8: s.append(55)
    else: s.append(30)

    if not s: s.append(50)
    return sum(s) / len(s)


# ══════════════════════════════════════════════════════════════════════
# COMPOSITE
# ══════════════════════════════════════════════════════════════════════
def compute_alphascore(symbol: str, data: dict) -> dict:
    dim = {
        "technical":   round(_score_technical(data), 1),
        "fundamental": round(_score_fundamental(data), 1),
        "ownership":   round(_score_ownership(data), 1),
        "momentum":    round(_score_momentum(data), 1),
        "risk_alpha":  round(_score_risk_alpha(data), 1),
    }
    composite = round(_clamp(sum(dim[k] * _W[k] for k in _W), 0, 100), 1)

    if composite >= 80:   grade, signal = "A+", "STRONG_BUY"
    elif composite >= 70: grade, signal = "A",  "BUY"
    elif composite >= 60: grade, signal = "B+", "ACCUMULATE"
    elif composite >= 50: grade, signal = "B",  "HOLD"
    elif composite >= 40: grade, signal = "C",  "WATCH"
    elif composite >= 30: grade, signal = "D",  "REDUCE"
    else:                 grade, signal = "F",  "AVOID"

    return {
        "symbol": symbol,
        "alphascore": composite,
        "grade": grade,
        "signal": signal,
        "dimensions": dim,
        "computed_at": datetime.utcnow().isoformat(),
    }


def compute_alphascore_bulk(universe: list) -> list:
    results = []
    for stock in universe:
        sym = stock.get("symbol", "")
        if not sym: continue
        try:
            r = compute_alphascore(sym, stock)
            r["name"] = stock.get("name", sym)
            r["sector"] = stock.get("sector", "")
            r["industry"] = stock.get("industry", "")
            r["cap_segment"] = stock.get("cap_segment", "")
            r["price"] = stock.get("price", 0)
            r["change_pct"] = stock.get("change_pct", 0)
            results.append(r)
        except Exception as e:
            logger.warning(f"AlphaScore failed for {sym}: {e}")
    results.sort(key=lambda x: x["alphascore"], reverse=True)
    return results


# ── INFO (for "i" tooltip) ───────────────────────────────────────────
ALPHASCORE_INFO = {
    "title": "AlphaScore™ — Composite Stock Intelligence Rating",
    "subtitle": "A single 0-100 score that tells you everything about a stock at a glance.",
    "description": (
        "AlphaScore™ is a proprietary composite rating that blends 40+ factors across "
        "5 dimensions — Technical Strength, Fundamental Quality, Ownership Conviction, "
        "Momentum & Sentiment, and Risk-Adjusted Alpha — into one actionable number. "
        "Unlike simple screeners that show raw indicators, AlphaScore™ uses a weighted "
        "algorithm with sigmoid normalization and decay functions to produce a score "
        "that adapts to market conditions."
    ),
    "dimensions": {
        "technical": {"name": "Technical Strength", "weight": "25%", "factors": 12,
            "description": "RSI, MACD histogram & crossover, SMA 50/200, Bollinger Bands (width + position), Supertrend, volume ratio, 52-week high proximity, gap analysis"},
        "fundamental": {"name": "Fundamental Quality", "weight": "25%", "factors": 6,
            "description": "PE ratio (value scoring), ROE (profitability), Debt-to-Equity (leverage risk), dividend yield, market cap stability, pre-computed fundamental score"},
        "ownership": {"name": "Ownership Conviction", "weight": "20%", "factors": 3,
            "description": "Accumulation score (institutional flow), Minervini template score (institutional quality), volume ratio (smart money activity)"},
        "momentum": {"name": "Momentum & Sentiment", "weight": "15%", "factors": 6,
            "description": "1-month and 3-month relative strength, weekly & daily momentum, pre-computed momentum and sentiment scores"},
        "risk_alpha": {"name": "Risk-Adjusted Alpha", "weight": "15%", "factors": 5,
            "description": "Alpha rating, trend strength, drawdown from 52-week high, recovery from 52-week low, Bollinger width (volatility)"},
    },
    "grades": {
        "A+": {"range": "80-100", "signal": "STRONG_BUY", "color": "#00C853"},
        "A":  {"range": "70-79",  "signal": "BUY",        "color": "#4CAF50"},
        "B+": {"range": "60-69",  "signal": "ACCUMULATE", "color": "#8BC34A"},
        "B":  {"range": "50-59",  "signal": "HOLD",       "color": "#FFC107"},
        "C":  {"range": "40-49",  "signal": "WATCH",      "color": "#FF9800"},
        "D":  {"range": "30-39",  "signal": "REDUCE",     "color": "#FF5722"},
        "F":  {"range": "0-29",   "signal": "AVOID",      "color": "#F44336"},
    },
    "how_to_use": [
        "Compare AlphaScores across stocks in the same sector for relative strength",
        "Track score changes over time — rising scores signal improving fundamentals + technicals",
        "Use as a pre-filter: focus your research on stocks scoring 60+ to save time",
        "Combine with your own analysis — AlphaScore highlights what to look at, not what to blindly buy",
        "Dimension breakdown reveals WHY a stock scores high or low — drill into weak areas",
    ],
}
