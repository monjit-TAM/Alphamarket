"""
Alpha Options Engine — Automated F&O Signal Generator
AlphaMarket | Patent Pending
"""
import math, logging
from datetime import datetime, date, timedelta
from typing import List, Dict
import pytz

logger = logging.getLogger("alpha_options_engine")
IST = pytz.timezone("Asia/Kolkata")

LOT_SIZES = {
    "NIFTY": 25, "BANKNIFTY": 15, "FINNIFTY": 25, "MIDCPNIFTY": 50,
    "RELIANCE": 250, "TCS": 150, "INFY": 300, "HDFCBANK": 550,
    "ICICIBANK": 700, "SBIN": 750, "TATAMOTORS": 575, "ITC": 1600,
    "BAJFINANCE": 125, "MARUTI": 100, "WIPRO": 1500, "SUNPHARMA": 700,
    "TATASTEEL": 550, "LT": 150, "AXISBANK": 600, "BHARTIARTL": 475,
    "M&M": 350, "ADANIENT": 400, "HCLTECH": 350, "KOTAKBANK": 400,
    "TITAN": 375, "HINDALCO": 1400, "JSWSTEEL": 675, "CIPLA": 650,
    "DRREDDY": 125, "ONGC": 3250, "NTPC": 2250, "POWERGRID": 2700,
}
STRIKE_INTERVALS = {"NIFTY": 50, "BANKNIFTY": 100, "FINNIFTY": 50, "MIDCPNIFTY": 25}
DEFAULT_STRIKE_INTERVAL = 50

def _round_strike(price, symbol, direction="nearest"):
    iv = STRIKE_INTERVALS.get(symbol, DEFAULT_STRIKE_INTERVAL)
    if direction == "up": return math.ceil(price / iv) * iv
    if direction == "down": return math.floor(price / iv) * iv
    return round(price / iv) * iv

def _next_expiry():
    today = datetime.now(IST).date()
    days = (3 - today.weekday()) % 7
    if days == 0: days = 7
    return (today + timedelta(days=days)).isoformat()

def _dte(expiry_str):
    return max(1, (date.fromisoformat(expiry_str) - datetime.now(IST).date()).days)

# ═══════════════════════════════════════════════════════════════
# VOLATILITY REGIME CLASSIFIER
# ═══════════════════════════════════════════════════════════════

REGIMES = {
    "LOW_VOL_TRENDING": {
        "label": "Low Volatility + Trending", "color": "#16a34a",
        "description": "Market moving steadily with low fear. Best time to SELL premium. Strangles and condors have highest win rate.",
        "strategies": ["OTM_STRANGLE_SELL", "IRON_CONDOR", "CREDIT_SPREAD"],
        "risk_level": "LOW", "expected_win_rate": "70-80%",
    },
    "LOW_VOL_RANGEBOUND": {
        "label": "Low Volatility + Range-bound", "color": "#3b82f6",
        "description": "Market chopping sideways with low VIX. Iron condors and butterflies thrive. Collect theta while market sits still.",
        "strategies": ["IRON_CONDOR", "IRON_BUTTERFLY", "SHORT_STRADDLE_HEDGED"],
        "risk_level": "LOW", "expected_win_rate": "72-82%",
    },
    "HIGH_VOL_TRENDING": {
        "label": "High Volatility + Trending", "color": "#f59e0b",
        "description": "Strong directional move with elevated fear. BUY spreads in trend direction. Options expensive but move pays.",
        "strategies": ["BULL_CALL_SPREAD", "BEAR_PUT_SPREAD", "DEBIT_SPREAD"],
        "risk_level": "MEDIUM", "expected_win_rate": "55-65%",
    },
    "HIGH_VOL_RANGEBOUND": {
        "label": "High Volatility + Range-bound", "color": "#dc2626",
        "description": "High VIX, no clear direction. Rich premiums but risky. Sell carefully with defined risk and active management.",
        "strategies": ["IRON_BUTTERFLY", "RATIO_SPREAD", "JADE_LIZARD"],
        "risk_level": "HIGH", "expected_win_rate": "55-65%",
    },
}

def classify_regime(vix, vix_sma20, bb_width, atr_pct, trend, pcr):
    """Classify market into one of 4 volatility regimes."""
    is_low_vol = vix < 16 or (vix < vix_sma20 * 0.95 and vix < 20)
    is_high_vol = vix > 20 or vix > vix_sma20 * 1.1
    is_trending = trend in ("BULLISH", "BEARISH") and atr_pct > 0.8
    is_range = trend == "NEUTRAL" or atr_pct < 0.6 or bb_width < 4

    if is_low_vol and is_trending: key = "LOW_VOL_TRENDING"
    elif is_low_vol and is_range: key = "LOW_VOL_RANGEBOUND"
    elif is_high_vol and is_trending: key = "HIGH_VOL_TRENDING"
    elif is_high_vol and is_range: key = "HIGH_VOL_RANGEBOUND"
    elif is_trending: key = "LOW_VOL_TRENDING" if vix < 18 else "HIGH_VOL_TRENDING"
    else: key = "LOW_VOL_RANGEBOUND" if vix < 18 else "HIGH_VOL_RANGEBOUND"

    regime = REGIMES[key]
    vix_pctile = min(100, max(0, (vix - 10) / 35 * 100))
    if 15 <= vix <= 25: theta_score = min(100, 80 + (vix - 15) * 2)
    elif vix < 15: theta_score = 40 + vix * 2.5
    else: theta_score = max(30, 90 - (vix - 25) * 3)

    if trend == "BULLISH": bias, strength = "BULLISH", min(100, atr_pct * 50 + (50 if pcr > 1.2 else 0))
    elif trend == "BEARISH": bias, strength = "BEARISH", min(100, atr_pct * 50 + (50 if pcr < 0.7 else 0))
    else: bias, strength = "NEUTRAL", 0

    return {
        "regime": key, "label": regime["label"], "color": regime["color"],
        "description": regime["description"],
        "recommended_strategies": regime["strategies"],
        "risk_level": regime["risk_level"], "expected_win_rate": regime["expected_win_rate"],
        "metrics": {"vix": round(vix, 1), "vix_sma20": round(vix_sma20, 1),
                    "vix_percentile": round(vix_pctile), "bb_width": round(bb_width, 2),
                    "atr_pct": round(atr_pct, 2), "pcr": round(pcr, 2),
                    "theta_opportunity_score": round(theta_score)},
        "direction": {"bias": bias, "strength": round(strength), "trend": trend},
    }

# ═══════════════════════════════════════════════════════════════
# STRATEGY GENERATORS
# ═══════════════════════════════════════════════════════════════

def _estimate_premium(spot, iv, dte_days, moneyness=0):
    """Realistic premium estimate using simplified Black-Scholes approximation."""
    tf = math.sqrt(dte_days / 365)
    # ATM premium ~ 0.4 * S * sigma * sqrt(T) but capped realistically
    atm = spot * (iv / 100) * tf * 0.4
    # For short-dated options, ATM premium is typically 1-3% of spot
    atm = min(atm, spot * 0.04)  # cap at 4% of spot
    atm = max(atm, spot * 0.005) # floor at 0.5% of spot
    if moneyness > 0:
        # OTM decay is exponential, not linear
        decay = math.exp(-moneyness * 15)
        return max(spot * 0.001, atm * decay)  # floor at 0.1% of spot
    return atm

# Single-leg strategies (naked CE/PE buy)
def ce_buy(symbol, spot, capital, iv=20, expiry=""):
    """Buy ATM or slightly OTM Call. Directional bullish."""
    if not expiry: expiry = _next_expiry()
    dte = _dte(expiry); lot = LOT_SIZES.get(symbol, 50)
    strike = _round_strike(spot * 1.005, symbol, "up")
    chain = _fetch_live_chain(symbol)
    if chain and chain.get("expiry"): expiry = chain["expiry"]
    if chain and chain.get("spot"): spot = chain["spot"]
    est = round(_estimate_premium(spot, iv, dte, (strike - spot)/spot if strike > spot else 0), 1)
    prem = _pick_premium(chain, strike, "CE", est) if chain else est
    max_lots = min(10, int(capital / (prem * lot))) if prem * lot > 0 else 1
    lots = max(1, min(max_lots, 3))  # cap single-leg at 3 lots max
    cap = round(prem * lot * lots)
    target_prem = round(prem * 2.0, 1)
    sl_prem = round(prem * 0.6, 1)
    return {
        "strategy":"CE_BUY","strategy_name":"Call Option Buy",
        "direction":"BULLISH","symbol":symbol,"expiry":expiry,"days_to_expiry":dte,
        "legs":[{"action":"BUY","type":"CE","strike":strike,"premium":prem,"lots":lots}],
        "lot_size":lot,"lots":lots,"net_debit":prem,
        "per_lot":{"max_profit":round(prem * 1.5 * lot),"max_loss":round(prem * lot),"breakeven":round(strike + prem, 1)},
        "total":{"capital_required":cap,"max_profit":round(prem * 0.5 * lot * lots),
                 "max_loss":cap,"max_profit_pct":50.0,"max_loss_pct":-100.0},
        "risk_reward":round(0.5, 2),"risk_level":"HIGH",
        "explanation":f"Buy {symbol} {strike} CE @ Rs.{prem} x {lots} lot(s) (expiry {expiry}). "
                      f"Target: Rs.{target_prem} (50% gain). Stop loss: Rs.{sl_prem} (50% of premium). "
                      f"Breakeven at Rs.{round(strike + prem, 1)}. Max risk is entire premium paid.",
        "when_to_enter":f"Enter when {symbol} shows bullish momentum. Best in first 2 hours of market.",
        "when_to_exit":f"Exit at Rs.{target_prem} (+50%) or Rs.{sl_prem} (-50%). Never hold to expiry.",
        "stop_loss_rule":"Exit if premium drops 50% from entry. No averaging down.",
    }

def pe_buy(symbol, spot, capital, iv=20, expiry=""):
    """Buy ATM or slightly OTM Put. Directional bearish."""
    if not expiry: expiry = _next_expiry()
    dte = _dte(expiry); lot = LOT_SIZES.get(symbol, 50)
    strike = _round_strike(spot * 0.995, symbol, "down")
    chain = _fetch_live_chain(symbol)
    if chain and chain.get("expiry"): expiry = chain["expiry"]
    if chain and chain.get("spot"): spot = chain["spot"]
    est = round(_estimate_premium(spot, iv, dte, (spot - strike)/spot if strike < spot else 0), 1)
    prem = _pick_premium(chain, strike, "PE", est) if chain else est
    max_lots = min(10, int(capital / (prem * lot))) if prem * lot > 0 else 1
    lots = max(1, min(max_lots, 3))  # cap single-leg at 3 lots max
    cap = round(prem * lot * lots)
    target_prem = round(prem * 2.0, 1)
    sl_prem = round(prem * 0.6, 1)
    return {
        "strategy":"PE_BUY","strategy_name":"Put Option Buy",
        "direction":"BEARISH","symbol":symbol,"expiry":expiry,"days_to_expiry":dte,
        "legs":[{"action":"BUY","type":"PE","strike":strike,"premium":prem,"lots":lots}],
        "lot_size":lot,"lots":lots,"net_debit":prem,
        "per_lot":{"max_profit":round(prem * 1.5 * lot),"max_loss":round(prem * lot),"breakeven":round(strike - prem, 1)},
        "total":{"capital_required":cap,"max_profit":round(prem * 0.5 * lot * lots),
                 "max_loss":cap,"max_profit_pct":50.0,"max_loss_pct":-100.0},
        "risk_reward":round(0.5, 2),"risk_level":"HIGH",
        "explanation":f"Buy {symbol} {strike} PE @ Rs.{prem} x {lots} lot(s) (expiry {expiry}). "
                      f"Target: Rs.{target_prem} (50% gain). Stop loss: Rs.{sl_prem} (50% of premium). "
                      f"Breakeven at Rs.{round(strike - prem, 1)}. Max risk is entire premium paid.",
        "when_to_enter":f"Enter when {symbol} shows bearish momentum or breaks support.",
        "when_to_exit":f"Exit at Rs.{target_prem} (+50%) or Rs.{sl_prem} (-50%). Never hold to expiry.",
        "stop_loss_rule":"Exit if premium drops 50% from entry. No averaging down.",
    }

def _fetch_live_chain(symbol):
    """Fetch live options chain from Kite via internal API. Returns {spot, expiry, calls:{strike:ltp}, puts:{strike:ltp}}."""
    try:
        import urllib.request, json as _json
        url = f"http://127.0.0.1:8001/api/nfo/option-chain/{symbol}"
        req = urllib.request.Request(url, headers={"X-Internal-Key": "3f9dd0ce942c74fb9988518041b50c94fa2da6aa2778da8c"})
        resp = urllib.request.urlopen(req, timeout=3).read().decode()
        data = _json.loads(resp)
        chain = data.get("chain", [])
        if not chain:
            return None
        # Get spot from Data Service
        spot = 0
        try:
            spot_sym = "%5ENSEI" if symbol == "NIFTY" else "%5ENSEBANK" if symbol == "BANKNIFTY" else symbol
            spot_req = urllib.request.Request(f"http://127.0.0.1:5004/data/equity/quote/{spot_sym}")
            spot_resp = urllib.request.urlopen(spot_req, timeout=3).read().decode()
            spot = _json.loads(spot_resp).get("price", 0)
        except:
            pass
        exp = data.get("expiry", data.get("expiries", [""])[0] if data.get("expiries") else "")
        calls = {}
        puts = {}
        for s in chain:
            strike = int(s.get("strike", 0))
            ce_ltp = s.get("ce_ltp", 0)
            pe_ltp = s.get("pe_ltp", 0)
            if ce_ltp and ce_ltp > 0:
                calls[strike] = ce_ltp
            if pe_ltp and pe_ltp > 0:
                puts[strike] = pe_ltp
        if spot and (calls or puts):
            return {"spot": spot, "expiry": exp, "calls": calls, "puts": puts, "ivs": {}}
    except Exception as e:
        logger.warning(f"Live chain failed for {symbol}: {e}")
    return None

def _pick_premium(chain, strike, opt_type, fallback):
    """Get live premium or fallback to estimate."""
    if not chain: return fallback
    book = chain.get("calls" if opt_type=="CE" else "puts", {})
    if strike in book and book[strike] > 0:
        return round(book[strike], 1)
    # Try nearest strike
    strikes = sorted(book.keys())
    for s in strikes:
        if abs(s - strike) <= 100 and book[s] > 0:
            return round(book[s], 1)
    return fallback

def bull_call_spread(symbol, spot, capital, iv=20, expiry=""):
    """BUY ATM CE + SELL OTM CE. Defined risk bullish."""
    if not expiry: expiry = _next_expiry()
    dte = _dte(expiry); lot = LOT_SIZES.get(symbol, 50)
    intv = STRIKE_INTERVALS.get(symbol, DEFAULT_STRIKE_INTERVAL)
    buy_k = _round_strike(spot, symbol)
    sell_k = buy_k + intv
    chain = _fetch_live_chain(symbol)
    if chain and chain.get("expiry"): expiry = chain["expiry"]
    if chain and chain.get("spot"): spot = chain["spot"]
    est_buy = round(_estimate_premium(spot, iv, dte), 1)
    est_sell = round(_estimate_premium(spot, iv, dte, (sell_k - spot) / spot), 1)
    buy_p = _pick_premium(chain, buy_k, "CE", est_buy)
    sell_p = _pick_premium(chain, sell_k, "CE", est_sell)
    net = round(buy_p - sell_p, 1)
    mp = round((sell_k - buy_k) - net, 1)
    ml = net
    be = round(buy_k + net, 1)
    # Capital needed = buy premium * lot * lots (you pay full buy premium upfront)
    lots = max(1, min(10, int(capital / (buy_p * lot)))) if buy_p * lot > 0 else 1
    cap = round(buy_p * lot * lots)
    rr = round(mp / ml, 2) if ml > 0 else 0
    return {
        "strategy": "BULL_CALL_SPREAD", "strategy_name": "Bull Call Spread",
        "direction": "BULLISH", "symbol": symbol, "expiry": expiry, "days_to_expiry": dte,
        "legs": [
            {"action": "BUY", "type": "CE", "strike": buy_k, "premium": buy_p, "lots": lots},
            {"action": "SELL", "type": "CE", "strike": sell_k, "premium": sell_p, "lots": lots},
        ],
        "lot_size": lot, "lots": lots, "net_debit": net,
        "per_lot": {"max_profit": round(mp * lot), "max_loss": round(ml * lot), "breakeven": be},
        "total": {"capital_required": cap, "max_profit": round(mp * lot * lots),
                  "max_loss": round(ml * lot * lots),
                  "max_profit_pct": round(mp / net * 100, 1) if net > 0 else 0, "max_loss_pct": -100.0},
        "risk_reward": rr, "risk_level": "DEFINED",
        "explanation": f"Buy {symbol} {buy_k} CE + Sell {sell_k} CE (expiry {expiry}). "
                       f"Pay Rs.{net}/share. Max profit Rs.{round(mp * lot * lots):,} if above {sell_k}. "
                       f"Max loss Rs.{round(ml * lot * lots):,} if below {buy_k}. Breakeven Rs.{be}. R:R 1:{rr}.",
        "when_to_enter": "Enter when AlphaScore confirms bullish. Avoid if VIX > 25.",
        "when_to_exit": "Exit at 60% of max profit OR if stock breaks below SMA20 OR 2 days before expiry.",
        "stop_loss_rule": "Exit if net premium drops to 50% of entry.",
    }

def bear_put_spread(symbol, spot, capital, iv=20, expiry=""):
    """BUY ATM PE + SELL OTM PE. Defined risk bearish."""
    if not expiry: expiry = _next_expiry()
    dte = _dte(expiry); lot = LOT_SIZES.get(symbol, 50)
    intv = STRIKE_INTERVALS.get(symbol, DEFAULT_STRIKE_INTERVAL)
    buy_k = _round_strike(spot, symbol)
    sell_k = buy_k - intv
    chain = _fetch_live_chain(symbol)
    if chain and chain.get("expiry"): expiry = chain["expiry"]
    if chain and chain.get("spot"): spot = chain["spot"]
    est_buy = round(_estimate_premium(spot, iv, dte), 1)
    est_sell = round(_estimate_premium(spot, iv, dte, (spot - sell_k) / spot), 1)
    buy_p = _pick_premium(chain, buy_k, "PE", est_buy)
    sell_p = _pick_premium(chain, sell_k, "PE", est_sell)
    net = round(buy_p - sell_p, 1)
    mp = round((buy_k - sell_k) - net, 1)
    ml = net
    be = round(buy_k - net, 1)
    # Capital needed = buy premium * lot * lots (you pay full buy premium upfront)
    lots = max(1, min(10, int(capital / (buy_p * lot)))) if buy_p * lot > 0 else 1
    cap = round(buy_p * lot * lots)
    rr = round(mp / ml, 2) if ml > 0 else 0
    return {
        "strategy": "BEAR_PUT_SPREAD", "strategy_name": "Bear Put Spread",
        "direction": "BEARISH", "symbol": symbol, "expiry": expiry, "days_to_expiry": dte,
        "legs": [
            {"action": "BUY", "type": "PE", "strike": buy_k, "premium": buy_p, "lots": lots},
            {"action": "SELL", "type": "PE", "strike": sell_k, "premium": sell_p, "lots": lots},
        ],
        "lot_size": lot, "lots": lots, "net_debit": net,
        "per_lot": {"max_profit": round(mp * lot), "max_loss": round(ml * lot), "breakeven": be},
        "total": {"capital_required": cap, "max_profit": round(mp * lot * lots),
                  "max_loss": round(ml * lot * lots),
                  "max_profit_pct": round(mp / net * 100, 1) if net > 0 else 0, "max_loss_pct": -100.0},
        "risk_reward": rr, "risk_level": "DEFINED",
        "explanation": f"Buy {symbol} {buy_k} PE + Sell {sell_k} PE (expiry {expiry}). "
                       f"Pay Rs.{net}/share. Max profit Rs.{round(mp * lot * lots):,} if below {sell_k}. "
                       f"Max loss Rs.{round(ml * lot * lots):,}. Breakeven Rs.{be}. R:R 1:{rr}.",
        "when_to_enter": "Enter when AlphaScore < 40 and Smart Money shows DISTRIBUTION.",
        "when_to_exit": "Exit at 60% of max profit OR if stock breaks above SMA20.",
        "stop_loss_rule": "Exit if net premium drops to 50% of entry.",
    }

def iron_condor(symbol, spot, capital, iv=20, expiry=""):
    """SELL OTM CE+PE spreads. Defined risk neutral. Best for LOW_VOL."""
    if not expiry: expiry = _next_expiry()
    dte = _dte(expiry); lot = LOT_SIZES.get(symbol, 50)
    intv = STRIKE_INTERVALS.get(symbol, DEFAULT_STRIKE_INTERVAL)
    sell_ce = _round_strike(spot * 1.02, symbol, "up")
    buy_ce = sell_ce + intv
    sell_pe = _round_strike(spot * 0.98, symbol, "down")
    buy_pe = sell_pe - intv
    chain = _fetch_live_chain(symbol)
    if chain and chain.get("expiry"): expiry = chain["expiry"]
    if chain and chain.get("spot"): spot = chain["spot"]
    tf = math.sqrt(dte / 365)
    base = spot * (iv / 100) * tf * 0.15
    # Estimated premiums as fallback
    est_ce_s = round(base * 1.1, 1); est_ce_b = round(base * 0.5, 1)
    est_pe_s = round(base * 1.0, 1); est_pe_b = round(base * 0.45, 1)
    ce_s = _pick_premium(chain, sell_ce, "CE", est_ce_s)
    ce_b = _pick_premium(chain, buy_ce, "CE", est_ce_b)
    pe_s = _pick_premium(chain, sell_pe, "PE", est_pe_s)
    pe_b = _pick_premium(chain, buy_pe, "PE", est_pe_b)
    credit = round((ce_s - ce_b) + (pe_s - pe_b), 1)
    width = buy_ce - sell_ce
    ml_ps = round(width - credit, 1)
    margin = spot * lot * 0.15  # ~15% SPAN margin for index, ~20% for stocks
    lots = max(1, int(capital / margin))
    cap = round(margin * lots)
    rr = round(credit / ml_ps, 2) if ml_ps > 0 else round(credit / (width * 0.5), 2) if width > 0 else 0
    pop = min(85, max(50, 70 + (2 - abs(sell_ce - spot) / spot * 100) * 5))
    return {
        "strategy": "IRON_CONDOR", "strategy_name": "Iron Condor",
        "direction": "NEUTRAL", "symbol": symbol, "expiry": expiry, "days_to_expiry": dte,
        "legs": [
            {"action": "BUY", "type": "PE", "strike": buy_pe, "premium": pe_b, "lots": lots},
            {"action": "SELL", "type": "PE", "strike": sell_pe, "premium": pe_s, "lots": lots},
            {"action": "SELL", "type": "CE", "strike": sell_ce, "premium": ce_s, "lots": lots},
            {"action": "BUY", "type": "CE", "strike": buy_ce, "premium": ce_b, "lots": lots},
        ],
        "lot_size": lot, "lots": lots, "net_credit": credit,
        "per_lot": {"max_profit": round(credit * lot), "max_loss": round(ml_ps * lot),
                    "upper_breakeven": round(sell_ce + credit, 1), "lower_breakeven": round(sell_pe - credit, 1)},
        "total": {"capital_required": cap, "max_profit": round(credit * lot * lots),
                  "max_loss": round(ml_ps * lot * lots),
                  "max_profit_pct": round(credit * lot / margin * 100, 1),
                  "max_loss_pct": round(-ml_ps * lot / margin * 100, 1)},
        "probability_of_profit": round(pop),
        "profit_zone": f"Rs.{sell_pe} to Rs.{sell_ce}",
        "risk_reward": rr, "risk_level": "DEFINED",
        "explanation": f"Sell {symbol} {sell_pe}PE + {sell_ce}CE, hedge with {buy_pe}PE + {buy_ce}CE (expiry {expiry}). "
                       f"Collect Rs.{credit}/share upfront. Keep full Rs.{round(credit * lot * lots):,} if {symbol} stays "
                       f"between Rs.{sell_pe}-{sell_ce}. Max loss Rs.{round(ml_ps * lot * lots):,}. ~{round(pop)}% win probability.",
        "when_to_enter": "Enter when VIX < 18 and market range-bound. 10-15 days to expiry ideal.",
        "when_to_exit": "Exit at 50% of max profit. Or exit 2 days before expiry.",
        "stop_loss_rule": "Exit if loss reaches 1.5x premium received.",
    }

def short_strangle(symbol, spot, capital, iv=20, expiry=""):
    """SELL OTM CE + PE. High premium but needs strict stops."""
    if not expiry: expiry = _next_expiry()
    dte = _dte(expiry); lot = LOT_SIZES.get(symbol, 50)
    sell_ce = _round_strike(spot * 1.025, symbol, "up")
    sell_pe = _round_strike(spot * 0.975, symbol, "down")
    tf = math.sqrt(dte / 365)
    ce_p = round(spot * (iv / 100) * tf * 0.18, 1)
    pe_p = round(spot * (iv / 100) * tf * 0.16, 1)
    credit = round(ce_p + pe_p, 1)
    margin = spot * lot * 0.15
    lots = max(1, int(capital / margin))
    cap = round(margin * lots)
    return {
        "strategy": "SHORT_STRANGLE", "strategy_name": "Short Strangle (with stops)",
        "direction": "NEUTRAL", "symbol": symbol, "expiry": expiry, "days_to_expiry": dte,
        "legs": [
            {"action": "SELL", "type": "PE", "strike": sell_pe, "premium": pe_p, "lots": lots},
            {"action": "SELL", "type": "CE", "strike": sell_ce, "premium": ce_p, "lots": lots},
        ],
        "lot_size": lot, "lots": lots, "net_credit": credit,
        "per_lot": {"max_profit": round(credit * lot),
                    "upper_breakeven": round(sell_ce + credit, 1),
                    "lower_breakeven": round(sell_pe - credit, 1)},
        "total": {"capital_required": cap, "max_profit": round(credit * lot * lots),
                  "max_loss": "Unlimited (stopped at 2x premium)",
                  "max_profit_pct": round(credit * lot / margin * 100, 1)},
        "profit_zone": f"Rs.{sell_pe} to Rs.{sell_ce}",
        "risk_level": "HIGH (strict stop loss required)",
        "explanation": f"Sell {symbol} {sell_pe}PE + {sell_ce}CE (expiry {expiry}). "
                       f"Collect Rs.{credit}/share (Rs.{round(credit * lot * lots):,} total). "
                       f"Profit if {symbol} stays in Rs.{sell_pe}-{sell_ce}. "
                       f"MUST exit if any leg doubles in premium.",
        "when_to_enter": "Only when VIX < 16 and Nifty trending steadily. 7-10 days to expiry.",
        "when_to_exit": "Exit at 50% profit. Exit immediately if VIX spikes above 20.",
        "stop_loss_rule": "Exit if EITHER leg premium doubles from entry. Non-negotiable.",
    }

# ═══════════════════════════════════════════════════════════════
# SIGNAL SCANNER
# ═══════════════════════════════════════════════════════════════


# Phase 2: Earnings IV Crush
def _earnings_calendar():
    import yfinance as yf
    today = datetime.now(IST).date()
    out = []
    for sym in list(LOT_SIZES.keys())[:28]:
        try:
            cal = yf.Ticker(f"{sym}.NS").calendar
            if cal is None or cal.empty: continue
            if 'Earnings Date' not in cal.index: continue
            ed = cal.loc['Earnings Date'].iloc[0]
            if hasattr(ed,'date'): ed = ed.date()
            gap = (ed - today).days
            if 0 <= gap <= 7:
                out.append({"symbol":sym,"date":str(ed),"days":gap})
        except: pass
    return out

def earnings_iv_crush(sym, spot, capital, iv=25, earn_date="", expiry=""):
    if not expiry: expiry = _next_expiry()
    dte = _dte(expiry); lot = LOT_SIZES.get(sym,50)
    intv = STRIKE_INTERVALS.get(sym, DEFAULT_STRIKE_INTERVAL)
    sc = _round_strike(spot*1.04, sym, "up"); bc = sc + intv
    sp = _round_strike(spot*0.96, sym, "down"); bp = sp - intv
    iv2 = iv * 1.3
    tf = math.sqrt(dte/365); base = spot*(iv2/100)*tf*0.15
    cs,cb,ps,pb2 = round(base*1.2,1), round(base*0.55,1), round(base*1.1,1), round(base*0.5,1)
    cr = round((cs-cb)+(ps-pb2),1); w = bc-sc; ml = round(w-cr,1)
    mg = spot*lot*0.18; lots = max(1,min(5,int(capital/mg))); cap = round(mg*lots)
    rr = round(cr/ml,2) if ml>0 else 0
    return {
        "strategy":"EARNINGS_IV_CRUSH","strategy_name":"Earnings IV Crush",
        "direction":"NEUTRAL","symbol":sym,"expiry":expiry,"days_to_expiry":dte,
        "legs":[
            {"action":"BUY","type":"PE","strike":bp,"premium":pb2,"lots":lots},
            {"action":"SELL","type":"PE","strike":sp,"premium":ps,"lots":lots},
            {"action":"SELL","type":"CE","strike":sc,"premium":cs,"lots":lots},
            {"action":"BUY","type":"CE","strike":bc,"premium":cb,"lots":lots},
        ],
        "lot_size":lot,"lots":lots,"net_credit":cr,
        "per_lot":{"max_profit":round(cr*lot),"max_loss":round(ml*lot),
                   "upper_breakeven":round(sc+cr,1),"lower_breakeven":round(sp-cr,1)},
        "total":{"capital_required":cap,"max_profit":round(cr*lot*lots),
                 "max_loss":round(ml*lot*lots),"max_profit_pct":round(cr*lot/mg*100,1),
                 "max_loss_pct":round(-ml*lot/mg*100,1)},
        "profit_zone":f"Rs.{sp} to Rs.{sc}","probability_of_profit":65,
        "risk_reward":rr,"risk_level":"DEFINED","earnings_date":earn_date,
        "explanation":f"Sell {sym} {sp}PE+{sc}CE with hedges before earnings ({earn_date}). "
                      f"IV inflated pre-results. Collect Rs.{cr}/share (Rs.{round(cr*lot*lots):,}). "
                      f"After results IV crushes 30-50%. Max risk Rs.{round(ml*lot*lots):,}.",
        "when_to_enter":f"Enter 1-2 days before earnings ({earn_date}). IV rank should be above 70%.",
        "when_to_exit":"Exit morning after results. IV crush is overnight. Take 40-60% of credit.",
        "stop_loss_rule":"Exit if stock gaps beyond profit zone. Loss capped by wings.",
    }

# Phase 3: Expiry Day Theta
def _is_expiry_day():
    return datetime.now(IST).date().weekday() == 3

def expiry_theta_scalp(sym, spot, capital, vix=15):
    today = datetime.now(IST).date()
    expiry = today.isoformat() if today.weekday()==3 else _next_expiry()
    dte = max(0, _dte(expiry)); lot = LOT_SIZES.get(sym,50)
    intv = STRIKE_INTERVALS.get(sym, DEFAULT_STRIKE_INTERVAL)
    sc = _round_strike(spot*1.005, sym, "up")
    sp = _round_strike(spot*0.995, sym, "down")
    bc = sc+intv; bp = sp-intv
    if dte==0:
        cp,pp = round(spot*0.002,1), round(spot*0.002,1)
        cbp,pbp = round(spot*0.0005,1), round(spot*0.0005,1)
    else:
        cp = round(_estimate_premium(spot,vix,dte,0.005),1)
        pp = round(_estimate_premium(spot,vix,dte,0.005),1)
        cbp = round(_estimate_premium(spot,vix,dte,(bc-spot)/spot),1)
        pbp = round(_estimate_premium(spot,vix,dte,(spot-bp)/spot),1)
    cr = round((cp-cbp)+(pp-pbp),1); w = bc-sc
    ml = round(w-cr,1) if w>cr else round(cr*0.5,1)
    mg = spot*lot*0.12; lots = max(1,min(3,int(capital/mg))); cap = round(mg*lots)
    rr = round(cr/ml,2) if ml>0 else 0
    hr = datetime.now(IST).hour
    return {
        "strategy":"EXPIRY_THETA_SCALP","strategy_name":"Expiry Theta Scalp",
        "direction":"NEUTRAL","symbol":sym,"expiry":expiry,"days_to_expiry":dte,
        "legs":[
            {"action":"BUY","type":"PE","strike":bp,"premium":pbp,"lots":lots},
            {"action":"SELL","type":"PE","strike":sp,"premium":pp,"lots":lots},
            {"action":"SELL","type":"CE","strike":sc,"premium":cp,"lots":lots},
            {"action":"BUY","type":"CE","strike":bc,"premium":cbp,"lots":lots},
        ],
        "lot_size":lot,"lots":lots,"net_credit":cr,
        "per_lot":{"max_profit":round(cr*lot),"max_loss":round(ml*lot),
                   "upper_breakeven":round(sc+cr,1),"lower_breakeven":round(sp-cr,1)},
        "total":{"capital_required":cap,"max_profit":round(cr*lot*lots),
                 "max_loss":round(ml*lot*lots),"max_profit_pct":round(cr*lot/mg*100,1) if mg>0 else 0,
                 "max_loss_pct":round(-ml*lot/mg*100,1) if mg>0 else 0},
        "profit_zone":f"Rs.{sp} to Rs.{sc}",
        "probability_of_profit":72 if dte==0 else 60,
        "risk_reward":rr,"risk_level":"DEFINED","is_expiry_day":dte==0,
        "explanation":f"{'EXPIRY DAY' if dte==0 else f'{dte}d to expiry'}: Sell {sym} {sp}PE+{sc}CE with hedges. "
                      f"Collect Rs.{cr}/share (Rs.{round(cr*lot*lots):,}). "
                      f"{'Enter now — theta fastest after 1:30 PM.' if hr>=13 else 'Best after 1:30 PM.'} "
                      f"Expires worthless if {sym} stays in Rs.{sp}-{sc}.",
        "when_to_enter":"After 1:30 PM IST on expiry day. Theta fastest in last 2 hours.",
        "when_to_exit":"Hold till 3:15 PM or exit at 50% profit. Exit by 3:20 PM regardless.",
        "stop_loss_rule":"Exit if ANY leg triples from entry. Non-negotiable.",
    }


def generate_signals(universe, regime, capital=500000, max_positions=5, vix=15, index_prices=None):
    """
    Generate actionable trade ideas based on regime + alpha scores + capital.
    
    Args:
        universe: list of stocks with alphascore, confluence_probability, smart_money_score, price
        regime: dict from classify_regime()
        capital: total capital in INR
        max_positions: max simultaneous trades
        vix: current India VIX
        index_prices: {"NIFTY": 24000, "BANKNIFTY": 51000}
    """
    signals = []
    cap_per = capital / max_positions
    rk = regime.get("regime", "LOW_VOL_RANGEBOUND")
    bias = regime.get("direction", {}).get("bias", "NEUTRAL")
    idx_p = index_prices or {"NIFTY": 24000, "BANKNIFTY": 51000}

    # Phase 3: Expiry theta (Thursdays after 12:30 PM)
    if _is_expiry_day() and datetime.now(IST).hour >= 7:
        for idx in ["NIFTY","BANKNIFTY"]:
            sp = idx_p.get(idx,24000)
            s = expiry_theta_scalp(idx, sp, cap_per, vix)
            s["conviction"] = 75 if datetime.now(IST).hour>=8 else 60
            s["trigger"] = "EXPIRY_THETA"
            s["trigger_reason"] = f"Expiry day theta — {idx} at {sp}"
            signals.append(s)

    # Phase 2: Earnings IV crush
    try:
        for e in _earnings_calendar()[:3]:
            sym = e["symbol"]; pr = 0
            for stk in universe:
                if stk.get("symbol")==sym: pr=stk.get("price",0); break
            if pr<=0: continue
            s = earnings_iv_crush(sym, pr, cap_per, vix, e["date"])
            s["conviction"] = 70 if e["days"]<=2 else 55
            s["trigger"] = "EARNINGS_IV_CRUSH"
            s["trigger_reason"] = f"{sym} earnings {e['date']} ({e['days']}d away) — IV elevated"
            s["alpha_data"] = {"earnings_date":e["date"],"days_to_earnings":e["days"]}
            signals.append(s)
    except: pass

    # Index signals — both multi-leg and single-leg
    for idx in ["NIFTY", "BANKNIFTY"]:
        sp = idx_p.get(idx, 24000)
        if rk in ("LOW_VOL_TRENDING", "LOW_VOL_RANGEBOUND"):
            s = iron_condor(idx, sp, cap_per, vix)
            s["conviction"] = regime.get("metrics", {}).get("theta_opportunity_score", 50)
            s["trigger"] = "VOLATILITY_REGIME"
            s["trigger_reason"] = f"VIX {vix:.1f} ({regime['label']}) — premium selling favorable"
            signals.append(s)
        elif rk == "HIGH_VOL_TRENDING":
            # Multi-leg spread
            s = bull_call_spread(idx, sp, cap_per, vix) if bias == "BULLISH" else bear_put_spread(idx, sp, cap_per, vix)
            s["conviction"] = 65
            s["trigger"] = "VOLATILITY_REGIME"
            s["trigger_reason"] = f"VIX {vix:.1f} + {bias} trend — directional spread"
            signals.append(s)
            # Single-leg CE/PE
            s2 = ce_buy(idx, sp, cap_per, vix) if bias == "BULLISH" else pe_buy(idx, sp, cap_per, vix)
            s2["conviction"] = 60
            s2["trigger"] = "INDEX_DIRECTIONAL"
            s2["trigger_reason"] = f"{idx} {bias} trend + VIX {vix:.1f} — {'CE' if bias=='BULLISH' else 'PE'} buy"
            signals.append(s2)
        else:
            s = iron_condor(idx, sp, cap_per, vix)
            s["conviction"] = 55
            s["trigger"] = "VOLATILITY_REGIME"
            s["trigger_reason"] = f"VIX {vix:.1f} elevated + range — defined risk premium sell"
            signals.append(s)
            # Also offer single-leg for traders who want directional
            if bias in ("BULLISH","BEARISH"):
                s2 = ce_buy(idx, sp, cap_per, vix) if bias == "BULLISH" else pe_buy(idx, sp, cap_per, vix)
                s2["conviction"] = 35
                s2["trigger"] = "INDEX_DIRECTIONAL"
                s2["trigger_reason"] = f"{idx} has {bias} bias despite range — speculative {'CE' if bias=='BULLISH' else 'PE'}"
                signals.append(s2)

    # Stock signals from Alpha Intelligence
    # Prioritize today's movers — sort by absolute change% descending
    fno_universe = [s for s in universe if s.get("symbol","") in LOT_SIZES and s.get("price",0) > 0]
    fno_universe.sort(key=lambda x: abs(x.get("change_pct",0)), reverse=True)
    for stk in fno_universe:
        sym = stk.get("symbol", "")
        asc = stk.get("alphascore", 0)
        conf = stk.get("confluence_probability", 0)
        sms = stk.get("smart_money_score", 0)
        pr = stk.get("price", 0)
        chg = abs(stk.get("change_pct", 0))

        alpha_data = {"alphascore": round(asc, 1), "grade": stk.get("grade", ""),
                      "confluence": round(conf), "smart_money": round(sms),
                      "sector": stk.get("sector", "")}

        # Tier 1: Strong confluence — multi-leg spreads
        if asc >= 65 and conf >= 65 and sms >= 55:
            s = bull_call_spread(sym, pr, cap_per, vix)
            s["conviction"] = round(asc * 0.4 + conf * 0.4 + sms * 0.2 + min(chg * 3, 10))
            s["trigger"] = "CONFLUENCE_BULLISH"
            s["trigger_reason"] = f"AlphaScore {asc:.0f} + Confluence {conf:.0f}% + Smart Money {sms:.0f} — all bullish"
            s["alpha_data"] = alpha_data
            signals.append(s)
        elif asc < 40 and conf >= 50 and sms < 40:
            s = bear_put_spread(sym, pr, cap_per, vix)
            s["conviction"] = round((100 - asc) * 0.4 + conf * 0.4 + (100 - sms) * 0.2 + min(chg * 3, 10))
            s["trigger"] = "CONFLUENCE_BEARISH"
            s["trigger_reason"] = f"AlphaScore {asc:.0f} (weak) + Smart Money {sms:.0f} (distributing) — short setup"
            s["alpha_data"] = alpha_data
            signals.append(s)

        # Tier 2: Momentum-driven single leg calls (today's big movers)
        elif chg >= 2.5 and asc >= 60:
            s = ce_buy(sym, pr, cap_per, vix)
            s["conviction"] = round(40 + chg * 5 + asc * 0.2)
            s["trigger"] = "MOMENTUM_BULLISH"
            s["trigger_reason"] = f"{sym} up {stk.get('change_pct',0):+.1f}% today + AlphaScore {asc:.0f} — momentum CE buy"
            s["alpha_data"] = alpha_data
            signals.append(s)
        elif chg >= 2.5 and asc < 40:
            s = pe_buy(sym, pr, cap_per, vix)
            s["conviction"] = round(40 + chg * 5 + (100 - asc) * 0.2)
            s["trigger"] = "MOMENTUM_BEARISH"
            s["trigger_reason"] = f"{sym} down {stk.get('change_pct',0):+.1f}% today + weak AlphaScore {asc:.0f} — momentum PE buy"
            s["alpha_data"] = alpha_data
            signals.append(s)

        # Tier 3: Moderate bullish/bearish — single leg
        elif asc >= 55 and sms >= 50 and chg >= 0.5:
            s = ce_buy(sym, pr, cap_per, vix)
            s["conviction"] = round(asc * 0.3 + sms * 0.3 + chg * 5)
            s["trigger"] = "ALPHA_BULLISH"
            s["trigger_reason"] = f"AlphaScore {asc:.0f} + Smart Money {sms:.0f} + moving {stk.get('change_pct',0):+.1f}% — CE buy"
            s["alpha_data"] = alpha_data
            signals.append(s)
        elif asc < 45 and sms < 45 and chg >= 0.5:
            s = pe_buy(sym, pr, cap_per, vix)
            s["conviction"] = round((100-asc) * 0.3 + (100-sms) * 0.3 + chg * 5)
            s["trigger"] = "ALPHA_BEARISH"
            s["trigger_reason"] = f"Weak AlphaScore {asc:.0f} + distributing Smart Money {sms:.0f} — PE buy"
            s["alpha_data"] = alpha_data
            signals.append(s)

        # Tier 4: Theta harvest — stable stock, low vol
        elif asc >= 55 and rk.startswith("LOW_VOL") and conf < 40:
            s = iron_condor(sym, pr, cap_per, vix)
            s["conviction"] = round(asc * 0.5 + regime.get("metrics", {}).get("theta_opportunity_score", 50) * 0.5)
            s["trigger"] = "THETA_HARVEST"
            s["trigger_reason"] = f"AlphaScore {asc:.0f} (stable) + Low VIX — sell premium safely"
            s["alpha_data"] = alpha_data
            signals.append(s)

    signals = [s for s in signals if s.get("conviction", 0) >= 50]
    signals.sort(key=lambda x: x.get("conviction", 0), reverse=True)
    for i, s in enumerate(signals[:max_positions]):
        s["rank"] = i + 1
        s["allocation_pct"] = round(100 / min(len(signals), max_positions), 1)
    return signals[:max(max_positions * 2, 10)]

def format_signal(sig):
    """Add trader-friendly summary."""
    ml = sig.get("total", {}).get("max_loss", 0)
    sig["summary"] = {
        "what": sig.get("strategy_name", ""),
        "why": sig.get("trigger_reason", ""),
        "capital": f"Rs.{sig.get('total', {}).get('capital_required', 0):,.0f}",
        "can_make": f"Rs.{sig.get('total', {}).get('max_profit', 0):,.0f}",
        "can_lose": f"Rs.{abs(ml):,.0f}" if isinstance(ml, (int, float)) else str(ml),
        "win_prob": f"{sig.get('probability_of_profit', 'N/A')}%",
        "enter": sig.get("when_to_enter", ""),
        "exit": sig.get("when_to_exit", ""),
        "stop": sig.get("stop_loss_rule", ""),
    }
    # ── Top-level fields for frontend compatibility ──
    t = sig.get("total", {})
    sig["capital"] = t.get("capital_required", 0)
    sig["capital_required"] = t.get("capital_required", 0)
    sig["max_profit"] = t.get("max_profit", 0)
    sig["max_loss"] = t.get("max_loss", 0)
    sig["rr_ratio"] = round(abs(t.get("max_profit", 0)) / abs(t.get("max_loss", 1)), 1) if t.get("max_loss") else 0
    sig["pop"] = sig.get("probability_of_profit", 0)
    return sig
