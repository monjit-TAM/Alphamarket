"""
Smart Money Flow™ — Institutional Conviction Tracker
=====================================================
0-100 Accumulation Score from 6 data dimensions.
Adapted to sb_universe fields.
"""
import logging
from typing import List
from datetime import datetime

logger = logging.getLogger("flow_signals")

_FW = {
    "accumulation":   0.25,
    "minervini":      0.20,
    "volume_quality": 0.20,
    "fundamental":    0.15,
    "momentum_conf":  0.10,
    "trend_strength": 0.10,
}

def _clamp(v, lo=0, hi=100): return max(lo, min(hi, v))
def _f(d, k, dv=0):
    try:
        v = d.get(k, dv)
        return float(v) if v is not None else dv
    except: return dv


def _score_accumulation(d):
    signals = []
    s = []
    acc = _f(d, "accumulation_score", 0)
    score_scaled = _clamp(acc * 10, 5, 95) if acc > 0 else 50
    s.append(score_scaled)
    if acc >= 8:
        signals.append({"text": f"Accumulation Score {acc:.1f}/10 — strong institutional buying pattern", "type": "strong_positive"})
    elif acc >= 6:
        signals.append({"text": f"Accumulation Score {acc:.1f}/10 — moderate institutional interest", "type": "positive"})
    elif acc < 4:
        signals.append({"text": f"Accumulation Score {acc:.1f}/10 — distribution pattern detected", "type": "negative"})
    return sum(s)/len(s), signals


def _score_minervini(d):
    signals = []
    s = []
    ms = _f(d, "minervini_score", 0)
    score_scaled = _clamp(ms * 12.5, 5, 95) if ms > 0 else 50
    s.append(score_scaled)
    if ms >= 7:
        signals.append({"text": f"Minervini {int(ms)}/8 — institutional-grade trend template", "type": "strong_positive"})
    elif ms >= 5:
        signals.append({"text": f"Minervini {int(ms)}/8 — meets stage 2 uptrend criteria", "type": "positive"})
    elif ms <= 2:
        signals.append({"text": f"Minervini {int(ms)}/8 — fails trend template (stage 4 decline?)", "type": "negative"})

    # SMA alignment adds conviction
    if d.get("above_50dma") and d.get("above_200dma"):
        s.append(80)
        signals.append({"text": "Price above 50 & 200 DMA — confirmed uptrend structure", "type": "positive"})
    elif not d.get("above_200dma"):
        s.append(25)
        signals.append({"text": "Below 200 DMA — long-term trend broken", "type": "warning"})
    else:
        s.append(50)
    return sum(s)/len(s), signals


def _score_volume(d):
    signals = []
    s = []
    vr = _f(d, "vol_ratio", 1)
    if vr > 3:
        s.append(90)
        signals.append({"text": f"Volume {vr:.1f}x average — heavy institutional block activity", "type": "strong_positive"})
    elif vr > 2:
        s.append(75)
        signals.append({"text": f"Volume {vr:.1f}x average — above-normal institutional interest", "type": "positive"})
    elif vr > 1.2:
        s.append(60)
    elif vr > 0.7:
        s.append(45)
    else:
        s.append(25)
        signals.append({"text": f"Volume {vr:.1f}x average — drying up, low participation", "type": "warning"})

    # Volume + price direction = conviction
    chg = _f(d, "change_pct", 0)
    if vr > 1.5 and chg > 1:
        s.append(85)
        signals.append({"text": f"Price up {chg:.1f}% on {vr:.1f}x volume — buying conviction", "type": "strong_positive"})
    elif vr > 1.5 and chg < -1:
        s.append(20)
        signals.append({"text": f"Price down {abs(chg):.1f}% on {vr:.1f}x volume — selling pressure", "type": "strong_negative"})
    else:
        s.append(50)
    return sum(s)/len(s), signals


def _score_fundamental_quality(d):
    signals = []
    s = []
    fs = _f(d, "fundamental_score", 5)
    s.append(_clamp(fs * 10, 5, 95))
    if fs >= 8:
        signals.append({"text": f"Fundamental Score {fs:.1f}/10 — blue-chip quality", "type": "strong_positive"})
    elif fs >= 6:
        signals.append({"text": f"Fundamental Score {fs:.1f}/10 — sound fundamentals", "type": "positive"})

    roe = _f(d, "roe", 0)
    if roe > 20:
        s.append(85)
        signals.append({"text": f"ROE {roe:.1f}% — high capital efficiency (institutions prefer >15%)", "type": "positive"})
    elif roe > 12:
        s.append(60)
    else:
        s.append(35)

    de = _f(d, "debt_equity", 0)
    if de < 0.3:
        s.append(80)
        signals.append({"text": "Debt/Equity below 0.3 — clean balance sheet", "type": "positive"})
    elif de > 1.5:
        s.append(20)
        signals.append({"text": f"Debt/Equity {de:.1f} — high leverage risk", "type": "negative"})
    else:
        s.append(55)
    return sum(s)/len(s), signals


def _score_momentum_conf(d):
    signals = []
    s = []
    ms = _f(d, "momentum_score", 5)
    s.append(_clamp(ms * 10, 5, 95))

    rs1m = _f(d, "rs_1m", 0)
    rs3m = _f(d, "rs_3m", 0)
    if rs1m > 5 and rs3m > 10:
        s.append(85)
        signals.append({"text": f"Outperforming: +{rs1m:.1f}% (1M), +{rs3m:.1f}% (3M) — sustained relative strength", "type": "strong_positive"})
    elif rs3m > 5:
        s.append(65)
        signals.append({"text": f"3M relative strength +{rs3m:.1f}% — building momentum", "type": "positive"})
    elif rs3m < -10:
        s.append(20)
        signals.append({"text": f"3M relative strength {rs3m:.1f}% — underperforming market", "type": "negative"})
    else:
        s.append(50)
    return sum(s)/len(s), signals


def _score_trend(d):
    signals = []
    s = []
    ts = _f(d, "trend_score", 5)
    s.append(_clamp(ts * 10, 5, 95))

    if d.get("above_supertrend"):
        s.append(70)
        signals.append({"text": "Above Supertrend — trend intact", "type": "positive"})
    else:
        s.append(30)

    pct_52h = _f(d, "pct_from_52h", -20)
    if pct_52h > -5:
        s.append(80)
        signals.append({"text": f"Within {abs(pct_52h):.1f}% of 52-week high — strength", "type": "positive"})
    elif pct_52h < -30:
        s.append(20)
        signals.append({"text": f"{abs(pct_52h):.0f}% below 52-week high — deep correction", "type": "negative"})
    else:
        s.append(50)
    return sum(s)/len(s), signals


def compute_smart_money_score(symbol: str, data: dict) -> dict:
    acc_s, acc_sig = _score_accumulation(data)
    min_s, min_sig = _score_minervini(data)
    vol_s, vol_sig = _score_volume(data)
    fun_s, fun_sig = _score_fundamental_quality(data)
    mom_s, mom_sig = _score_momentum_conf(data)
    trd_s, trd_sig = _score_trend(data)

    composite = round(_clamp(
        acc_s * _FW["accumulation"] +
        min_s * _FW["minervini"] +
        vol_s * _FW["volume_quality"] +
        fun_s * _FW["fundamental"] +
        mom_s * _FW["momentum_conf"] +
        trd_s * _FW["trend_strength"]
    , 0, 100), 1)

    if composite >= 75:   verdict = "STRONG_ACCUMULATION"
    elif composite >= 60: verdict = "ACCUMULATION"
    elif composite >= 45: verdict = "NEUTRAL"
    elif composite >= 30: verdict = "DISTRIBUTION"
    else:                 verdict = "STRONG_DISTRIBUTION"

    all_sig = acc_sig + min_sig + vol_sig + fun_sig + mom_sig + trd_sig
    pos = [s for s in all_sig if s["type"] in ("strong_positive", "positive")]
    risk = [s for s in all_sig if s["type"] in ("strong_negative", "negative", "warning")]

    return {
        "symbol": symbol,
        "smart_money_score": composite,
        "verdict": verdict,
        "components": {
            "accumulation": round(acc_s, 1),
            "minervini": round(min_s, 1),
            "volume_quality": round(vol_s, 1),
            "fundamental": round(fun_s, 1),
            "momentum_conf": round(mom_s, 1),
            "trend_strength": round(trd_s, 1),
        },
        "positive_signals": pos,
        "risk_flags": risk,
        "signal_count": {"positive": len(pos), "risk": len(risk)},
        "computed_at": datetime.utcnow().isoformat(),
    }


def compute_smart_money_bulk(universe: list) -> list:
    results = []
    for stock in universe:
        sym = stock.get("symbol", "")
        if not sym: continue
        try:
            r = compute_smart_money_score(sym, stock)
            r["name"] = stock.get("name", sym)
            r["sector"] = stock.get("sector", "")
            r["price"] = stock.get("price", 0)
            r["change_pct"] = stock.get("change_pct", 0)
            results.append(r)
        except Exception as e:
            logger.warning(f"Smart Money failed for {sym}: {e}")
    results.sort(key=lambda x: x["smart_money_score"], reverse=True)
    return results


FLOW_SIGNALS_INFO = {
    "title": "Smart Money Flow™ — Institutional Conviction Tracker",
    "subtitle": "Track where the big money is moving before it shows up in the price.",
    "description": (
        "Smart Money Flow combines 6 dimensions — Accumulation patterns, Minervini trend template, "
        "Volume quality, Fundamental strength, Momentum confirmation, and Trend structure — into a "
        "single 0-100 score. It cross-references signals that institutions rely on to detect "
        "conviction invisible to individual indicators."
    ),
    "components": {
        "accumulation":   {"name": "Accumulation Score", "weight": "25%", "description": "Pre-computed institutional accumulation/distribution pattern from price-volume analysis"},
        "minervini":      {"name": "Minervini Template", "weight": "20%", "description": "Mark Minervini's Stage Analysis — 8-point checklist institutions use to identify Stage 2 uptrends"},
        "volume_quality": {"name": "Volume Quality",     "weight": "20%", "description": "Volume ratio + price-volume correlation. High volume + rising price = institutional buying conviction"},
        "fundamental":    {"name": "Fundamental Strength","weight": "15%", "description": "Fundamental score, ROE, and leverage analysis — institutions avoid weak balance sheets"},
        "momentum_conf":  {"name": "Momentum Confirm",   "weight": "10%", "description": "Relative strength vs market over 1M and 3M — sustained outperformance signals institutional backing"},
        "trend_strength": {"name": "Trend Structure",    "weight": "10%", "description": "Supertrend signal, 52-week high proximity — structural trend health assessment"},
    },
    "verdicts": {
        "STRONG_ACCUMULATION": {"range": "75-100", "color": "#00C853", "meaning": "Multiple signals confirm institutional buying. Historically precedes significant moves."},
        "ACCUMULATION":        {"range": "60-74",  "color": "#4CAF50", "meaning": "Net institutional interest visible. Add to watchlist for entry on dips."},
        "NEUTRAL":             {"range": "45-59",  "color": "#FFC107", "meaning": "Mixed signals. No clear direction. Wait for clarity."},
        "DISTRIBUTION":        {"range": "30-44",  "color": "#FF9800", "meaning": "Institutional selling or reducing exposure. Caution advised."},
        "STRONG_DISTRIBUTION": {"range": "0-29",   "color": "#F44336", "meaning": "Institutional exit confirmed. Avoid new positions."},
    },
    "how_to_use": [
        "Stocks with STRONG_ACCUMULATION are where institutions are building positions — follow the smart money",
        "Minervini 7-8/8 + high accumulation + volume spike = highest conviction institutional setup",
        "Compare Smart Money Score before and after quarterly results to spot institutional reaction",
        "Combine with AlphaScore™: Smart Money tells you WHO is buying, AlphaScore tells if it DESERVES buying",
        "Watch for Volume Quality drops — institutions quietly exit before retail notices",
    ],
}
