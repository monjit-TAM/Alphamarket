"""
AlphaBot — Algorithmic Signal Generator for Index F&O
Generates automated trading signals for NIFTY/BANKNIFTY futures & options.
Signals are pushed to Upstox/XTS for auto-execution via POA.

Strategies:
1. Momentum Futures — VWAP + price action on NIFTY/BANKNIFTY FUT
2. Options Directional — Buy ATM CE/PE based on momentum signals
3. Options Writing — Sell OTM Straddle/Strangle with adjustment rules
4. Index Arbitrage — Spot-futures basis capture when spread exceeds threshold
"""

from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, date, timedelta, time as dtime
import pytz
IST = pytz.timezone("Asia/Kolkata")
from typing import Optional, List
import asyncpg, asyncio, json, math, logging, traceback

logger = logging.getLogger("alphabot")
router = APIRouter(prefix="/api/alphabot", tags=["AlphaBot"])

DB_URL = "postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db"

# ═══════════════════════════════════════════════════════════════════════════════
# INDEX CONFIG
# ═══════════════════════════════════════════════════════════════════════════════
INDEX_CONFIG = {
    "NIFTY": {
        "cash_symbol": "NSE:NIFTY 50",
        "fut_prefix": "NFO:NIFTY",
        "lot_size": 25,
        "tick_size": 0.05,
        "sl_points": 50,
        "target_points": 75,
        "option_strike_gap": 50,
        "exchange": "NSE",
        "upstox_index_token": "NSE_INDEX|Nifty 50",
        "upstox_fut_prefix": "NSE_FO|NIFTY",
    },
    "BANKNIFTY": {
        "cash_symbol": "NSE:NIFTY BANK",
        "fut_prefix": "NFO:BANKNIFTY",
        "lot_size": 15,
        "tick_size": 0.05,
        "sl_points": 120,
        "target_points": 180,
        "option_strike_gap": 100,
        "exchange": "NSE",
        "upstox_index_token": "NSE_INDEX|Nifty Bank",
        "upstox_fut_prefix": "NSE_FO|BANKNIFTY",
    },
    "FINNIFTY": {
        "cash_symbol": "NSE:NIFTY FIN SERVICE",
        "fut_prefix": "NFO:FINNIFTY",
        "lot_size": 25,
        "tick_size": 0.05,
        "sl_points": 40,
        "target_points": 60,
        "option_strike_gap": 50,
        "exchange": "NSE",
        "upstox_index_token": "NSE_INDEX|Nifty Fin Service",
        "upstox_fut_prefix": "NSE_FO|FINNIFTY",
    },
}

# ═══════════════════════════════════════════════════════════════════════════════
# HELPER: DB CONNECTION
# ═══════════════════════════════════════════════════════════════════════════════
_pool = None
async def get_pool():
    global _pool
    if _pool is None or _pool._closed:
        _pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5)
    return _pool

# ═══════════════════════════════════════════════════════════════════════════════
# HELPER: FETCH LIVE DATA (reuse existing Kite/Groww infrastructure)
# ═══════════════════════════════════════════════════════════════════════════════
# ═══════════════════════════════════════════════════════════════════════════════
# LIVE DATA FOR THE STRATEGIES (Oct 2026)
# The TrueData memory this file used to read first is empty since prices moved to
# AlphaFeed, and the data-service fallback was a blocking call back into this same
# single-worker server, so index prices never arrived and no strategy fired after
# 12 Oct. Index spot and F&O prices now come from the Kite session this server
# already holds; contracts and expiries come from instrument_master (NSE expiries
# are on Tuesdays now, so the old last-Thursday arithmetic named a wrong contract).
# ═══════════════════════════════════════════════════════════════════════════════
_KITE_INDEX = {"NIFTY": "NSE:NIFTY 50", "BANKNIFTY": "NSE:NIFTY BANK", "FINNIFTY": "NSE:NIFTY FIN SERVICE"}
_last_fetch = {}


async def _fno_rows(sql, *args):
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.fetch(sql, *args)


def _expiry_cutoff():
    now = datetime.now(IST)
    return now.date() + timedelta(days=1)  # dyorfix2: never open in a contract expiring today


async def _monthly_future(index):
    """(expiry date, Kite tradingsymbol) of the nearest live index future."""
    try:
        rows = await _fno_rows(
            "SELECT tradingsymbol, expiry::date AS expiry FROM instrument_master WHERE exchange='NFO' AND name=$1 "
            "AND instrument_type='FUT' AND expiry::date >= $2 ORDER BY expiry::date LIMIT 1", index, _expiry_cutoff())
        if rows:
            return rows[0]["expiry"], rows[0]["tradingsymbol"]
    except Exception as e:
        logger.warning(f"Future lookup failed for {index}: {e}")
    return get_current_monthly_expiry(), None


async def _weekly_expiry(index):
    """Nearest option expiry for this index (weekly for NIFTY, monthly where there is no weekly)."""
    try:
        rows = await _fno_rows(
            "SELECT DISTINCT expiry::date AS expiry FROM instrument_master WHERE exchange='NFO' AND name=$1 "
            "AND instrument_type IN ('CE','PE') AND expiry::date >= $2 ORDER BY 1 LIMIT 1", index, _expiry_cutoff())
        if rows:
            return rows[0]["expiry"]
    except Exception as e:
        logger.warning(f"Option expiry lookup failed for {index}: {e}")
    return get_current_weekly_expiry()


async def _kite_ltp(key):
    try:
        from routers.arbitrage import _fetch_kite_quotes
        for _try in range(3):
            p = float(((await _fetch_kite_quotes([key])).get(key) or {}).get("last_price") or 0)
            if p > 0:
                return p
            await asyncio.sleep(0.7)
        return 0.0
    except Exception as e:
        logger.warning(f"Kite LTP failed for {key}: {e}")
        return 0.0


async def _option_quote(index, expiry, strike, opt_type, expiry_label=None, since=None):
    """Live premium of one index option, or None. Pass the expiry date, or the stored
    label (26OCT) with the signal date to find the contract a stored signal refers to."""
    try:
        if expiry_label:
            rows = await _fno_rows(
                "SELECT tradingsymbol FROM instrument_master WHERE exchange='NFO' AND name=$1 AND instrument_type=$2 "
                "AND strike::float8=$3 AND upper(to_char(expiry::date,'YYMON'))=$4 AND expiry::date >= $5 "
                "ORDER BY expiry::date LIMIT 1", index, opt_type, float(strike), expiry_label.upper(), since)
        else:
            rows = await _fno_rows(
                "SELECT tradingsymbol FROM instrument_master WHERE exchange='NFO' AND name=$1 AND instrument_type=$2 "
                "AND strike::float8=$3 AND expiry::date=$4 LIMIT 1", index, opt_type, float(strike), expiry)
        if not rows:
            return None
        p = await _kite_ltp("NFO:" + rows[0]["tradingsymbol"])
        return p if p > 0 else None
    except Exception as e:
        logger.warning(f"Option quote failed for {index} {strike} {opt_type}: {e}")
        return None


async def _future_quote(index, expiry_label, since):
    """Live price of the index future a stored signal refers to (label like 26NOV), or None."""
    try:
        rows = await _fno_rows(
            "SELECT tradingsymbol FROM instrument_master WHERE exchange='NFO' AND name=$1 AND instrument_type='FUT' "
            "AND upper(to_char(expiry::date,'YYMON'))=$2 AND expiry::date >= $3 ORDER BY expiry::date LIMIT 1",
            index, str(expiry_label or "").upper(), since)
        if not rows:
            return None
        p = await _kite_ltp("NFO:" + rows[0]["tradingsymbol"])
        return p if p > 0 else None
    except Exception as e:
        logger.warning(f"Future quote failed for {index} {expiry_label}: {e}")
        return None


async def fetch_index_data(symbol: str) -> dict:
    """Index spot and the day's change: Kite quote first, then the older sources."""
    ks = _KITE_INDEX.get(symbol)
    if ks:
        try:
            from routers.arbitrage import _fetch_kite_quotes
            q = (await _fetch_kite_quotes([ks], mode="quote")).get(ks) or {}
            lp = float(q.get("last_price") or 0)
            pc = float((q.get("ohlc") or {}).get("close") or 0)
            if lp > 0:
                ch = round(lp - pc, 2) if pc > 0 else 0
                r = {"symbol": symbol, "price": lp, "change": ch,
                     "change_pct": round(ch / pc * 100, 2) if pc > 0 else 0, "prev_close": pc, "source": "kite"}
                _last_fetch[symbol] = r
                return r
        except Exception as e:
            logger.warning(f"Kite index quote failed for {symbol}: {e}")
    r = await _fetch_index_data_legacy(symbol)
    _last_fetch[symbol] = r or {"error": "no price source answered"}
    return r


async def _fetch_index_data_legacy(symbol: str) -> dict:
    """Fetch live index data — TrueData (instant) → DS → Kite (last resort)"""
    import urllib.request, urllib.parse
    
    td_map = {"NIFTY": "NIFTY 50", "BANKNIFTY": "NIFTY BANK"}
    ds_map = {"NIFTY": "NIFTY", "BANKNIFTY": "BANKNIFTY", "FINNIFTY": "FINNIFTY"}
    kite_map = {"NIFTY": "NSE:NIFTY 50", "BANKNIFTY": "NSE:NIFTY BANK", "FINNIFTY": "NSE:NIFTY FIN SERVICE"}
    
    # Try TrueData first (in-memory, instant, no API call)
    try:
        from main import _td_prices, _td_lock
        td_sym = td_map.get(symbol, symbol)
        with _td_lock:
            td = _td_prices.get(td_sym)
        if td and td.get("ltp", 0) > 0:
            ltp = td["ltp"]
            prev = td.get("close", 0) or ltp
            change = round(ltp - prev, 2)
            change_pct = round((change / prev) * 100, 2) if prev > 0 else 0
            return {"symbol": symbol, "price": ltp, "change": change, "change_pct": change_pct, "source": "truedata"}
    except Exception as e:
        logger.debug(f"TrueData lookup failed for {symbol}: {e}")
    
    # Fallback to Data Service
    try:
        ds_sym = ds_map.get(symbol, symbol)
        url = f"http://127.0.0.1:5004/data/equity/quote/{ds_sym}"
        req = urllib.request.Request(url, headers={"X-API-Key": "alpha_data_internal_2026"})
        with await asyncio.to_thread(urllib.request.urlopen, req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        if data.get("price", 0) > 0:
            return {"symbol": symbol, "price": data["price"], "change_pct": data.get("change_pct", 0), "source": "data_service"}
    except Exception as e:
        logger.error(f"Data Service fetch failed for {symbol}: {e}")
    return {}

async def fetch_kite_ltp(instruments: list) -> dict:
    """Fetch LTP — TrueData first, then Kite as fallback"""
    result = {}
    # Try TrueData first for each instrument
    try:
        from main import _td_prices, _td_lock
        remaining = []
        for inst in instruments:
            # Convert NFO:NIFTY26JULFUT -> NIFTY 50, NSE:RELIANCE -> RELIANCE
            td_sym = inst.replace("NSE:", "").replace("NFO:", "")
            with _td_lock:
                td = _td_prices.get(td_sym)
            if td and td.get("ltp", 0) > 0:
                result[inst] = {"last_price": td["ltp"], "source": "truedata"}
            else:
                remaining.append(inst)
        if not remaining:
            return result
        instruments = remaining
    except:
        pass
    # Fallback to Kite for remaining
    try:
        from routers.arbitrage import _fetch_kite_quotes
        kite_data = await _fetch_kite_quotes(instruments)
        result.update(kite_data)
    except:
        pass
    return result

# ═══════════════════════════════════════════════════════════════════════════════
# HELPER: EXPIRY CALCULATION
# ═══════════════════════════════════════════════════════════════════════════════
def get_ist_today():
    """Get current date in IST"""
    return datetime.now(IST).date()

def get_current_weekly_expiry():
    """Get nearest NIFTY expiry from instrument_master."""
    today = get_ist_today()
    try:
        import psycopg2
        conn = psycopg2.connect("dbname=alphamarket_db user=alphamarket_user password=AlphaMkt2026 host=localhost")
        cr = conn.cursor()
        cutoff = today if datetime.now(IST).time() <= dtime(15, 30) else today + timedelta(days=1)
        cr.execute("SELECT DISTINCT expiry FROM instrument_master WHERE exchange='NFO' AND name='NIFTY' AND instrument_type IN ('CE','PE') AND expiry >= %s ORDER BY expiry LIMIT 1", (cutoff,))
        row = cr.fetchone()
        conn.close()
        if row:
            return row[0]
    except Exception as e:
        logger.warning(f"Expiry lookup failed: {e}")
    days_to_thursday = (1 - today.weekday()) % 7  # Tuesday
    if days_to_thursday == 0 and datetime.now(IST).time() > dtime(15, 30):
        days_to_thursday = 7
    return today + timedelta(days=days_to_thursday)

def get_last_thursday(year, month):
    """Get last Thursday of a given month"""
    if month > 12:
        month = 1
        year += 1
    last_day = date(year, month + 1, 1) - timedelta(days=1) if month < 12 else date(year, 12, 31)
    offset = (last_day.weekday() - 1) % 7  # Tuesday
    return last_day - timedelta(days=offset)

def get_current_monthly_expiry():
    """Get last Thursday of current month, rolls to next month if already expired"""
    today = get_ist_today()
    exp = get_last_thursday(today.year, today.month)
    if exp < today:
        next_month = today.month + 1 if today.month < 12 else 1
        next_year = today.year if today.month < 12 else today.year + 1
        exp = get_last_thursday(next_year, next_month)
    return exp

def format_expiry(exp_date):
    """Format expiry as 26MAR or 03APR"""
    return exp_date.strftime("%y%b").upper()

def get_atm_strike(price, strike_gap):
    """Round to nearest strike"""
    return round(price / strike_gap) * strike_gap

# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY 1: MOMENTUM FUTURES
# ═══════════════════════════════════════════════════════════════════════════════
async def strategy_momentum_futures(index: str, config: dict) -> list:
    """
    NIFTY/BANKNIFTY Futures Momentum Strategy
    Entry: Price breaks above/below VWAP with volume confirmation
    SL: Fixed points (50 for NIFTY, 120 for BANKNIFTY)
    Target: 1.5x SL
    Exit: Auto square-off at 3:10 PM
    """
    signals = []
    idx = INDEX_CONFIG.get(index)
    if not idx:
        return signals

    # Fetch spot data
    spot_data = await fetch_index_data(index)
    if not spot_data or not spot_data.get("price"):
        return signals

    spot = spot_data["price"]
    change_pct = spot_data.get("change_pct", 0)
    
    # Fetch futures data
    expiry, _fut_ts = await _monthly_future(index)
    expiry_str = format_expiry(expiry)
    fut_symbol = f"NFO:{_fut_ts}" if _fut_ts else f"{idx['fut_prefix']}{expiry_str}FUT"
    
    fut_data = {fut_symbol: {"last_price": await _kite_ltp(fut_symbol)}}
    fut_key = fut_symbol
    fut_ltp = fut_data.get(fut_key, {}).get("last_price", 0)
    if fut_ltp <= 0:
        return signals

    # Strategy parameters
    min_move_pct = config.get("min_move_pct", 0.15)
    sl_points = config.get("sl_points", idx["sl_points"])
    target_points = config.get("target_points", idx["target_points"])
    lots = config.get("lots", 1)

    # BULLISH: change > threshold
    if change_pct >= min_move_pct:
        signals.append({
            "signal_type": "BUY",
            "instrument_type": "FUT",
            "symbol": index,
            "expiry": expiry_str,
            "strike": None,
            "entry_price": round(fut_ltp, 2),
            "stop_loss": round(fut_ltp - sl_points, 2),
            "target": round(fut_ltp + target_points, 2),
            "quantity": lots * idx["lot_size"],
            "lots": lots,
            "potential_pct": round((target_points / fut_ltp) * 100, 2),
            "rationale": f"{index} Momentum LONG: Spot up {change_pct:.2f}%, futures at {fut_ltp:.0f}. "
                         f"Entry {fut_ltp:.0f}, SL {fut_ltp - sl_points:.0f} ({sl_points}pts), "
                         f"Target {fut_ltp + target_points:.0f} ({target_points}pts). "
                         f"Basis: {fut_ltp - spot:.1f} pts premium.",
            "instrument_display": f"{index} FUT {expiry_str}",
        })
    
    # BEARISH: change < -threshold
    elif change_pct <= -min_move_pct:
        signals.append({
            "signal_type": "SHORT",
            "instrument_type": "FUT",
            "symbol": index,
            "expiry": expiry_str,
            "strike": None,
            "entry_price": round(fut_ltp, 2),
            "stop_loss": round(fut_ltp + sl_points, 2),
            "target": round(fut_ltp - target_points, 2),
            "quantity": lots * idx["lot_size"],
            "lots": lots,
            "potential_pct": round((target_points / fut_ltp) * 100, 2),
            "rationale": f"{index} Momentum SHORT: Spot down {abs(change_pct):.2f}%, futures at {fut_ltp:.0f}. "
                         f"Entry {fut_ltp:.0f}, SL {fut_ltp + sl_points:.0f} ({sl_points}pts), "
                         f"Target {fut_ltp - target_points:.0f} ({target_points}pts). "
                         f"Basis: {fut_ltp - spot:.1f} pts premium.",
            "instrument_display": f"{index} FUT {expiry_str}",
        })

    return signals

# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY 2: OPTIONS DIRECTIONAL
# ═══════════════════════════════════════════════════════════════════════════════
async def strategy_options_directional(index: str, config: dict) -> list:
    """
    Buy ATM CE on bullish signal, ATM PE on bearish signal
    Entry: Momentum confirmation (change% threshold)
    SL: 30% of premium
    Target: 50% of premium (1.5:1 R:R on premium)
    """
    signals = []
    idx = INDEX_CONFIG.get(index)
    if not idx:
        return signals

    spot_data = await fetch_index_data(index)
    if not spot_data or not spot_data.get("price"):
        return signals

    spot = spot_data["price"]
    change_pct = spot_data.get("change_pct", 0)

    min_move_pct = config.get("min_move_pct", 0.4)
    sl_pct = config.get("sl_pct", 40)         # SL as % of premium
    target_pct = config.get("target_pct", 100)  # Target as % of premium
    lots = config.get("lots", 1)

    atm_strike = get_atm_strike(spot, idx["option_strike_gap"])
    expiry = await _weekly_expiry(index)
    expiry_str = format_expiry(expiry)

    if abs(change_pct) < min_move_pct:
        return signals

    is_bullish = change_pct > 0
    opt_type = "CE" if is_bullish else "PE"
    signal_type = "BUY"

    # Estimate premium (rough: ~1.5% of spot for ATM weekly)
    est_premium = round(spot * 0.015, 1)
    _live_prem = await _option_quote(index, expiry, atm_strike, opt_type)
    if not _live_prem:
        logger.info(f"{index} {atm_strike} {opt_type}: no live premium, no signal")
        return signals
    est_premium = round(_live_prem, 2)
    sl_price = round(est_premium * (1 - sl_pct / 100), 2)
    target_price = round(est_premium * (1 + target_pct / 100), 2)

    direction_word = "BULLISH" if is_bullish else "BEARISH"

    signals.append({
        "signal_type": signal_type,
        "instrument_type": opt_type,
        "symbol": index,
        "expiry": expiry_str,
        "strike": atm_strike,
        "entry_price": est_premium,
        "stop_loss": sl_price,
        "target": target_price,
        "quantity": lots * idx["lot_size"],
        "lots": lots,
        "potential_pct": round(target_pct, 2),
        "rationale": f"{index} {direction_word}: Buy {atm_strike} {opt_type} @ ~{est_premium:.0f}. "
                     f"Spot {spot:.0f} ({change_pct:+.2f}%). "
                     f"SL at {sl_price:.0f} (-{sl_pct}% of premium), "
                     f"Target {target_price:.0f} (+{target_pct}% of premium). "
                     f"Weekly expiry {expiry_str}.",
        "instrument_display": f"{index} {atm_strike} {opt_type} {expiry_str}",
    })

    return signals

# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY 3: OPTIONS WRITING (STRADDLE/STRANGLE)
# ═══════════════════════════════════════════════════════════════════════════════
async def strategy_options_writing(index: str, config: dict) -> list:
    """
    Sell OTM Strangle: Sell CE above + Sell PE below
    Entry: Low VIX / range-bound day (|change| < 0.3%)
    Adjustment: If one leg moves ITM, exit that leg + shift further OTM
    SL: 50% above collected premium per leg
    Target: Let both expire OTM (collect full premium)
    """
    signals = []
    idx = INDEX_CONFIG.get(index)
    if not idx:
        return signals

    spot_data = await fetch_index_data(index)
    if not spot_data or not spot_data.get("price"):
        return signals

    spot = spot_data["price"]
    change_pct = spot_data.get("change_pct", 0)

    # Only write when market is range-bound
    max_move_pct = config.get("max_move_pct", 0.3)
    otm_offset_strikes = config.get("otm_offset", 2)   # 2 strikes OTM
    sl_multiplier = config.get("sl_multiplier", 1.5)    # exit if premium goes 1.5x
    lots = config.get("lots", 1)

    if abs(change_pct) > max_move_pct:
        return signals  # Too volatile for writing

    atm_strike = get_atm_strike(spot, idx["option_strike_gap"])
    gap = idx["option_strike_gap"]
    expiry = await _weekly_expiry(index)
    expiry_str = format_expiry(expiry)

    ce_strike = atm_strike + (otm_offset_strikes * gap)
    pe_strike = atm_strike - (otm_offset_strikes * gap)

    # Fetch actual premiums from option chain
    ce_premium = 0
    pe_premium = 0
    try:
        import urllib.request as _ur
        chain_url = f"http://127.0.0.1:8001/api/nfo/option-chain/{index}?expiry={expiry.strftime('%Y-%m-%d')}"
        _cr = await asyncio.to_thread(_ur.urlopen, _ur.Request(chain_url, headers={"X-Internal-Key": "3f9dd0ce942c74fb9988518041b50c94fa2da6aa2778da8c"}), timeout=3)
        _cd = json.loads(_cr.read().decode())
        for s in _cd.get("chain", []):
            if s.get("strike") == ce_strike and s.get("ce_ltp"):
                ce_premium = round(float(s["ce_ltp"]), 2)
            if s.get("strike") == pe_strike and s.get("pe_ltp"):
                pe_premium = round(float(s["pe_ltp"]), 2)
    except:
        pass
    if ce_premium <= 0:
        ce_premium = await _option_quote(index, expiry, ce_strike, "CE") or 0
    if pe_premium <= 0:
        pe_premium = await _option_quote(index, expiry, pe_strike, "PE") or 0
    if ce_premium <= 0 or pe_premium <= 0:
        logger.info(f"{index} strangle: no live premium, no signal")
        return signals
    total_premium = ce_premium + pe_premium

    # SELL CE leg
    signals.append({
        "signal_type": "WRITE",
        "instrument_type": "CE",
        "symbol": index,
        "expiry": expiry_str,
        "strike": ce_strike,
        "entry_price": ce_premium,
        "stop_loss": round(ce_premium * sl_multiplier, 2),
        "target": round(max(ce_premium * 0.05, 0.5), 2),  # near zero at expiry
        "quantity": lots * idx["lot_size"],
        "lots": lots,
        "potential_pct": round((ce_premium / (spot * 0.15)) * 100, 2),  # return on margin
        "rationale": f"{index} STRANGLE WRITE: Sell {ce_strike} CE @ ~{ce_premium:.0f}. "
                     f"Market range-bound ({change_pct:+.2f}%). "
                     f"SL if premium > {ce_premium * sl_multiplier:.0f} ({sl_multiplier}x entry). "
                     f"Expiry {expiry_str}. Combined premium: ~{total_premium:.0f}.",
        "instrument_display": f"{index} {ce_strike} CE {expiry_str} (SELL)",
        "leg": "CE_SELL",
    })

    # SELL PE leg
    signals.append({
        "signal_type": "WRITE",
        "instrument_type": "PE",
        "symbol": index,
        "expiry": expiry_str,
        "strike": pe_strike,
        "entry_price": pe_premium,
        "stop_loss": round(pe_premium * sl_multiplier, 2),
        "target": round(max(pe_premium * 0.05, 0.5), 2),
        "quantity": lots * idx["lot_size"],
        "lots": lots,
        "potential_pct": round((pe_premium / (spot * 0.15)) * 100, 2),
        "rationale": f"{index} STRANGLE WRITE: Sell {pe_strike} PE @ ~{pe_premium:.0f}. "
                     f"Market range-bound ({change_pct:+.2f}%). "
                     f"SL if premium > {pe_premium * sl_multiplier:.0f} ({sl_multiplier}x entry). "
                     f"Expiry {expiry_str}. Combined premium: ~{total_premium:.0f}.",
        "instrument_display": f"{index} {pe_strike} PE {expiry_str} (SELL)",
        "leg": "PE_SELL",
    })

    return signals

# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY 4: INDEX ARBITRAGE
# ═══════════════════════════════════════════════════════════════════════════════
async def strategy_index_arbitrage(index: str, config: dict) -> list:
    """
    Spot-Futures arbitrage when basis exceeds threshold
    Entry: Buy spot + Sell futures when annualized basis > X%
    Exit: Hold till expiry (basis converges to zero)
    """
    signals = []
    idx = INDEX_CONFIG.get(index)
    if not idx:
        return signals

    spot_data = await fetch_index_data(index)
    if not spot_data or not spot_data.get("price"):
        return signals

    spot = spot_data["price"]
    
    expiry, _fut_ts = await _monthly_future(index)
    expiry_str = format_expiry(expiry)
    days_to_expiry = max((expiry - date.today()).days, 1)
    fut_symbol = f"NFO:{_fut_ts}" if _fut_ts else f"{idx['fut_prefix']}{expiry_str}FUT"

    fut_data = {fut_symbol: {"last_price": await _kite_ltp(fut_symbol)}}
    fut_ltp = fut_data.get(fut_symbol, {}).get("last_price", 0)
    if fut_ltp <= 0:
        return signals

    basis = fut_ltp - spot
    basis_pct = (basis / spot) * 100
    annualized = (basis_pct / days_to_expiry) * 365

    min_annualized = config.get("min_annualized_pct", 10)
    lots = config.get("lots", 1)

    if annualized >= min_annualized and basis > 0:
        net_profit = basis * idx["lot_size"] * lots
        signals.append({
            "signal_type": "BUY",  # Buy spot (or synthetic via CE-PE)
            "instrument_type": "ARB",
            "symbol": index,
            "expiry": expiry_str,
            "strike": None,
            "entry_price": spot,
            "stop_loss": 0,  # No SL in arb — hold to expiry
            "target": fut_ltp,  # Convergence
            "quantity": lots * idx["lot_size"],
            "lots": lots,
            "potential_pct": round(annualized, 2),
            "rationale": f"{index} ARBITRAGE: Spot {spot:.0f}, Futures {fut_ltp:.0f}. "
                         f"Basis {basis:.1f} pts ({basis_pct:.2f}%). "
                         f"Annualized {annualized:.1f}%. {days_to_expiry} days to expiry. "
                         f"Net profit per lot: ~{basis * idx['lot_size']:.0f}. "
                         f"Strategy: Buy spot + Sell {fut_symbol}.",
            "instrument_display": f"{index} ARB (Spot vs {expiry_str} FUT)",
            "arb_details": {
                "spot": spot, "futures": fut_ltp, "basis": basis,
                "basis_pct": basis_pct, "annualized": annualized,
                "days_to_expiry": days_to_expiry,
            },
        })

    return signals

# ═══════════════════════════════════════════════════════════════════════════════
# STRATEGY DISPATCHER
# ═══════════════════════════════════════════════════════════════════════════════
STRATEGY_MAP = {
    "momentum_futures": strategy_momentum_futures,
    "options_directional": strategy_options_directional,
    "options_writing": strategy_options_writing,
    "index_arbitrage": strategy_index_arbitrage,
}

# ═══════════════════════════════════════════════════════════════════════════════
# SIGNAL ENGINE — Run all active strategies
# ═══════════════════════════════════════════════════════════════════════════════
async def run_signal_engine():
    """Main engine: iterate active strategies, generate signals, store in DB"""
    now = datetime.now(IST)
    market_open = now.replace(hour=9, minute=15, second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=15, second=0, microsecond=0)
    
    if not (market_open <= now <= market_close):
        return {"status": "market_closed", "signals": []}

    pool = await get_pool()
    async with pool.acquire() as conn:
        strategies = await conn.fetch("SELECT * FROM bot_strategies WHERE is_active = TRUE")

    all_signals = []
    for strat in strategies:
        strat_fn = STRATEGY_MAP.get(strat["strategy_type"])
        if not strat_fn:
            continue

        config = json.loads(strat["config"]) if isinstance(strat["config"], str) else strat["config"]
        risk = json.loads(strat["risk_config"]) if isinstance(strat["risk_config"], str) else strat["risk_config"]

        try:
            # Check daily risk limits
            async with pool.acquire() as conn:
                today_pnl = await conn.fetchval(
                    "SELECT COALESCE(SUM(pnl), 0) FROM bot_signals WHERE strategy_id=$1 AND created_at::date = $2",
                    strat["id"], date.today()
                )
                today_signals = await conn.fetchval(
                    "SELECT COUNT(*) FROM bot_signals WHERE strategy_id=$1 AND created_at::date = $2 AND status = 'ACTIVE'",
                    strat["id"], date.today()
                )

            max_loss = risk.get("max_loss_day", -10000)
            max_signals = risk.get("max_signals_day", 5)

            if today_pnl <= max_loss:
                logger.info(f"Strategy {strat['name']}: Daily loss limit hit ({today_pnl})")
                continue
            if today_signals >= max_signals:
                logger.info(f"Strategy {strat['name']}: Max signals per day reached ({today_signals})")
                continue

            # Generate signals
            raw_signals = await strat_fn(strat["instrument"], config)

            # Store in DB
            for sig in raw_signals:
                async with pool.acquire() as conn:
                    # Check for duplicate active signal (same strategy + symbol + type)
                    existing = await conn.fetchval(
                        """SELECT id FROM bot_signals 
                        WHERE strategy_id=$1 AND symbol=$2 AND instrument_type=$3 
                        AND status='ACTIVE' AND created_at::date = $4""",
                        strat["id"], sig["symbol"], sig["instrument_type"], date.today()
                    )
                    if existing:
                        continue  # Don't duplicate

                    signal_id = await conn.fetchval("""
                        INSERT INTO bot_signals 
                        (strategy_id, signal_type, instrument_type, symbol, expiry, strike,
                         entry_price, stop_loss, target, quantity, potential_pct, rationale, status)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ACTIVE')
                        RETURNING id
                    """, strat["id"], sig["signal_type"], sig["instrument_type"],
                        sig["symbol"], sig.get("expiry"), sig.get("strike"),
                        sig["entry_price"], sig["stop_loss"], sig["target"],
                        sig["quantity"], sig.get("potential_pct", 0), sig.get("rationale", ""))

                    # Log entry
                    await conn.execute("""
                        INSERT INTO bot_trade_log (signal_id, strategy_id, action, instrument, side, price, quantity, notes)
                        VALUES ($1,$2,'ENTRY',$3,$4,$5,$6,$7)
                    """, signal_id, strat["id"], sig.get("instrument_display", sig["symbol"]),
                        sig["signal_type"], sig["entry_price"], sig["quantity"],
                        sig.get("rationale", ""))

                    sig["id"] = signal_id
                    sig["strategy_name"] = strat["name"]
                    all_signals.append(sig)

        except Exception as e:
            logger.error(f"Strategy {strat['name']} error: {e}\n{traceback.format_exc()}")

    return {"status": "ok", "signals": all_signals, "count": len(all_signals), "timestamp": now.isoformat()}

# ═══════════════════════════════════════════════════════════════════════════════
# POSITION MONITOR — Check SL/Target on active signals
# ═══════════════════════════════════════════════════════════════════════════════
async def fetch_current_price_for_signal(sig):
    """Fetch correct current price based on instrument type.
    FUT/spot -> fetch index spot price.
    CE/PE options -> fetch option premium from data service."""
    instrument_type = sig["instrument_type"]
    symbol = sig["symbol"]

    if instrument_type in ("CE", "PE"):
        _lp = await _option_quote(symbol, None, sig["strike"], instrument_type,
                                  expiry_label=sig["expiry"], since=sig["created_at"].date())
        if _lp:
            return float(_lp)
        # (The data service has no option quotes by this name; Kite above is the source.)
        # Fallback: return entry price (no P&L change)
        return float(sig["entry_price"])
    elif instrument_type == "FUT":
        # dyorfix3: a futures signal's entry, stop and target are futures prices, so it is watched on the
        # same contract. The index sits about a basis below and made every futures short hit its target at once.
        p = await _future_quote(symbol, sig["expiry"], sig["created_at"].date())
        return float(p) if p else None
    else:
        # index arbitrage: spot leg
        spot_data = await fetch_index_data(symbol)
        if spot_data and spot_data.get("price"):
            return float(spot_data["price"])
        return float(sig["entry_price"])

async def monitor_positions():
    """Check live prices against SL/Target for all active signals"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        actives = await conn.fetch("SELECT * FROM bot_signals WHERE status = 'ACTIVE'")

    if not actives:
        return {"status": "no_active_positions"}

    results = []
    for sig in actives:
        try:
            current = await fetch_current_price_for_signal(sig)
            if not current:
                continue

            is_long = sig["signal_type"] in ("BUY",)
            is_short = sig["signal_type"] in ("SHORT", "WRITE")

            hit_sl = False
            hit_target = False

            if is_long:
                hit_sl = current <= sig["stop_loss"]
                hit_target = current >= sig["target"]
            elif is_short:
                hit_sl = current >= sig["stop_loss"]
                hit_target = current <= sig["target"]

            if hit_sl or hit_target:
                action = "SL_HIT" if hit_sl else "TARGET_HIT"
                pnl_per_unit = (current - sig["entry_price"]) if is_long else (sig["entry_price"] - current)
                total_pnl = pnl_per_unit * sig["quantity"]

                async with pool.acquire() as conn:
                    await conn.execute("""
                        UPDATE bot_signals SET status=$1, exit_time=NOW(), exit_price=$2, pnl=$3, pnl_pct=$4
                        WHERE id=$5
                    """, action, current, total_pnl,
                        round((pnl_per_unit / sig["entry_price"]) * 100, 2), sig["id"])

                    await conn.execute("""
                        INSERT INTO bot_trade_log (signal_id, strategy_id, action, instrument, side, price, quantity, pnl, notes)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                    """, sig["id"], sig["strategy_id"], action, sig["symbol"],
                        "EXIT", current, sig["quantity"], total_pnl,
                        f"{'Stop Loss' if hit_sl else 'Target'} hit at {current:.2f}")

                results.append({"signal_id": sig["id"], "action": action, "pnl": total_pnl})

        except Exception as e:
            logger.error(f"Monitor error for signal {sig['id']}: {e}")

    # Auto square-off check (3:20 PM IST)
    now = datetime.now(IST)
    if now.time() >= dtime(15, 20):
        async with pool.acquire() as conn:
            remaining = await conn.fetch("SELECT * FROM bot_signals WHERE status = 'ACTIVE'")
            for sig in remaining:
                current = await fetch_current_price_for_signal(sig)
                if not current:
                    current = float(sig["entry_price"])
                is_long = sig["signal_type"] in ("BUY",)
                pnl_per = (current - sig["entry_price"]) if is_long else (sig["entry_price"] - current)
                total_pnl = pnl_per * sig["quantity"]

                await conn.execute("""
                    UPDATE bot_signals SET status='AUTO_SQUAREOFF', exit_time=NOW(), exit_price=$1, pnl=$2, pnl_pct=$3
                    WHERE id=$4
                """, current, total_pnl, round((pnl_per / sig["entry_price"]) * 100, 2), sig["id"])

                await conn.execute("""
                    INSERT INTO bot_trade_log (signal_id, strategy_id, action, instrument, side, price, quantity, pnl, notes)
                    VALUES ($1,$2,'AUTO_SQUAREOFF',$3,'EXIT',$4,$5,$6,'EOD auto square-off at 3:20 PM')
                """, sig["id"], sig["strategy_id"], sig["symbol"], current, sig["quantity"], total_pnl)

                results.append({"signal_id": sig["id"], "action": "AUTO_SQUAREOFF", "pnl": total_pnl})

    return {"status": "ok", "results": results, "count": len(results)}

# ═══════════════════════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/strategies", summary="List all algo strategies")
async def list_strategies():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM bot_strategies ORDER BY id")
    return [dict(r) for r in rows]

@router.post("/strategies", summary="Create a new algo strategy")
async def create_strategy(payload: dict):
    pool = await get_pool()
    async with pool.acquire() as conn:
        sid = await conn.fetchval("""
            INSERT INTO bot_strategies (name, strategy_type, instrument, config, risk_config, is_active, schedule, scan_interval_sec)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
        """, payload["name"], payload["strategy_type"], payload["instrument"],
            json.dumps(payload.get("config", {})), json.dumps(payload.get("risk_config", {})),
            payload.get("is_active", False), payload.get("schedule", "9:20-15:10"),
            payload.get("scan_interval_sec", 300))
    return {"id": sid, "status": "created"}

@router.put("/strategies/{sid}/toggle", summary="Activate/deactivate a strategy")
async def toggle_strategy(sid: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        current = await conn.fetchval("SELECT is_active FROM bot_strategies WHERE id=$1", sid)
        if current is None:
            raise HTTPException(404, "Strategy not found")
        await conn.execute("UPDATE bot_strategies SET is_active=$1, updated_at=NOW() WHERE id=$2", not current, sid)
    return {"id": sid, "is_active": not current}

@router.put("/strategies/{sid}", summary="Update strategy config")
async def update_strategy(sid: int, payload: dict):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE bot_strategies SET 
                name=COALESCE($1, name), config=COALESCE($2, config), 
                risk_config=COALESCE($3, risk_config), instrument=COALESCE($4, instrument),
                scan_interval_sec=COALESCE($5, scan_interval_sec), updated_at=NOW()
            WHERE id=$6
        """, payload.get("name"), json.dumps(payload["config"]) if "config" in payload else None,
            json.dumps(payload["risk_config"]) if "risk_config" in payload else None,
            payload.get("instrument"), payload.get("scan_interval_sec"), sid)
    return {"id": sid, "status": "updated"}

@router.delete("/strategies/{sid}", summary="Delete a strategy")
async def delete_strategy(sid: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM bot_trade_log WHERE strategy_id=$1", sid)
        await conn.execute("DELETE FROM bot_signals WHERE strategy_id=$1", sid)
        await conn.execute("DELETE FROM bot_strategies WHERE id=$1", sid)
    return {"status": "deleted"}

@router.post("/run", summary="Manually trigger signal engine scan")
async def run_engine():
    result = await run_signal_engine()
    return result

@router.post("/monitor", summary="Manually trigger position monitoring")
async def run_monitor():
    result = await monitor_positions()
    return result

@router.get("/signals", summary="Get signals with optional filters")
async def get_signals(status: str = None, strategy_id: int = None, days: int = 7):
    pool = await get_pool()
    async with pool.acquire() as conn:
        query = "SELECT s.*, st.name as strategy_name FROM bot_signals s LEFT JOIN bot_strategies st ON s.strategy_id=st.id WHERE s.created_at >= $1"
        params = [datetime.now(IST).replace(tzinfo=None) - timedelta(days=days)]
        idx = 2
        if status:
            query += f" AND s.status=${idx}"
            params.append(status); idx += 1
        if strategy_id:
            query += f" AND s.strategy_id=${idx}"
            params.append(strategy_id); idx += 1
        query += " ORDER BY s.created_at DESC LIMIT 200"
        rows = await conn.fetch(query, *params)
    return [dict(r) for r in rows]

@router.get("/signals/active", summary="Get all active signals")
async def get_active_signals():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT s.*, st.name as strategy_name FROM bot_signals s 
            LEFT JOIN bot_strategies st ON s.strategy_id=st.id 
            WHERE s.status='ACTIVE' ORDER BY s.created_at DESC
        """)
    signals = []
    for r in rows:
        s = dict(r)
        entry = float(s.get("entry_price", 0))
        sl = float(s.get("stop_loss", 0)) if s.get("stop_loss") else 0
        tgt = float(s.get("target", 0)) if s.get("target") else 0
        s["buy_zone_low"] = round(entry * 0.97, 2)
        s["buy_zone_high"] = round(entry * 1.02, 2)
        s["buy_zone_msg"] = f"Entry zone: Rs.{s['buy_zone_low']} - Rs.{s['buy_zone_high']}"
        if tgt > 0 and entry > 0:
            s["target_pct"] = round(((tgt - entry) / entry) * 100, 2)
        if sl > 0 and entry > 0:
            s["sl_pct"] = round(((entry - sl) / entry) * 100, 2)
        signals.append(s)
    return signals

@router.get("/trades", summary="Get trade log")
async def get_trades(days: int = 7, strategy_id: int = None):
    pool = await get_pool()
    async with pool.acquire() as conn:
        query = "SELECT * FROM bot_trade_log WHERE created_at >= $1"
        params = [datetime.now(IST).replace(tzinfo=None) - timedelta(days=days)]
        if strategy_id:
            query += " AND strategy_id=$2"
            params.append(strategy_id)
        query += " ORDER BY created_at DESC LIMIT 500"
        rows = await conn.fetch(query, *params)
    return [dict(r) for r in rows]

@router.get("/performance", summary="Daily performance summary")
async def get_performance(days: int = 30, strategy_id: int = None):
    pool = await get_pool()
    async with pool.acquire() as conn:
        query = """
            SELECT s.created_at::date as trade_date, st.name as strategy_name,
                COUNT(*) as total_signals,
                COUNT(*) FILTER (WHERE s.pnl > 0) as winners,
                COUNT(*) FILTER (WHERE s.pnl < 0) as losers,
                COALESCE(SUM(s.pnl), 0) as total_pnl,
                COALESCE(AVG(s.pnl), 0) as avg_pnl,
                CASE WHEN COUNT(*) > 0 THEN 
                    ROUND(COUNT(*) FILTER (WHERE s.pnl > 0)::numeric / COUNT(*)::numeric * 100, 1)
                ELSE 0 END as win_rate
            FROM bot_signals s
            LEFT JOIN bot_strategies st ON s.strategy_id=st.id
            WHERE s.status NOT IN ('ACTIVE', 'EXPIRED') AND s.created_at >= $1
        """
        params = [datetime.now(IST).replace(tzinfo=None) - timedelta(days=days)]
        if strategy_id:
            query += " AND s.strategy_id=$2"
            params.append(strategy_id)
        query += " GROUP BY s.created_at::date, st.name ORDER BY trade_date DESC"
        rows = await conn.fetch(query, *params)
    return [dict(r) for r in rows]

@router.get("/dashboard", summary="AlphaBot dashboard overview")
async def dashboard():
    pool = await get_pool()
    async with pool.acquire() as conn:
        strategies = await conn.fetch("SELECT * FROM bot_strategies ORDER BY id")
        active_signals = await conn.fetchval("SELECT COUNT(*) FROM bot_signals WHERE status='ACTIVE'")
        today_signals = await conn.fetchval("SELECT COUNT(*) FROM bot_signals WHERE created_at::date = $1", date.today())
        today_pnl = await conn.fetchval("SELECT COALESCE(SUM(pnl), 0) FROM bot_signals WHERE created_at::date = $1 AND status NOT IN ('ACTIVE', 'EXPIRED')", date.today())
        total_pnl = await conn.fetchval("SELECT COALESCE(SUM(pnl), 0) FROM bot_signals WHERE status NOT IN ('ACTIVE', 'EXPIRED')")
        total_trades = await conn.fetchval("SELECT COUNT(*) FROM bot_signals WHERE status NOT IN ('ACTIVE', 'EXPIRED')")
        winners = await conn.fetchval("SELECT COUNT(*) FROM bot_signals WHERE pnl > 0 AND status NOT IN ('ACTIVE', 'EXPIRED')")

    return {
        "strategies": [dict(s) for s in strategies],
        "active_signals": active_signals,
        "today": {"signals": today_signals, "pnl": float(today_pnl)},
        "overall": {
            "total_trades": total_trades,
            "total_pnl": float(total_pnl),
            "winners": winners,
            "win_rate": round((winners / total_trades * 100), 1) if total_trades > 0 else 0,
        },
    }

# ═══════════════════════════════════════════════════════════════════════════════
# SEED DEFAULT STRATEGIES
# ═══════════════════════════════════════════════════════════════════════════════
@router.post("/seed", summary="Seed default Index F&O strategies")
async def seed_strategies():
    pool = await get_pool()
    defaults = [
        {
            "name": "NIFTY Momentum Futures",
            "strategy_type": "momentum_futures",
            "instrument": "NIFTY",
            "config": {"min_move_pct": 0.3, "sl_points": 50, "target_points": 75, "lots": 1},
            "risk_config": {"max_loss_day": -10000, "max_signals_day": 3},
        },
        {
            "name": "BANKNIFTY Momentum Futures",
            "strategy_type": "momentum_futures",
            "instrument": "BANKNIFTY",
            "config": {"min_move_pct": 0.4, "sl_points": 120, "target_points": 180, "lots": 1},
            "risk_config": {"max_loss_day": -15000, "max_signals_day": 3},
        },
        {
            "name": "NIFTY Options Directional",
            "strategy_type": "options_directional",
            "instrument": "NIFTY",
            "config": {"min_move_pct": 0.4, "sl_pct": 30, "target_pct": 50, "lots": 1},
            "risk_config": {"max_loss_day": -8000, "max_signals_day": 4},
        },
        {
            "name": "BANKNIFTY Options Directional",
            "strategy_type": "options_directional",
            "instrument": "BANKNIFTY",
            "config": {"min_move_pct": 0.5, "sl_pct": 30, "target_pct": 50, "lots": 1},
            "risk_config": {"max_loss_day": -12000, "max_signals_day": 4},
        },
        {
            "name": "NIFTY Strangle Writer",
            "strategy_type": "options_writing",
            "instrument": "NIFTY",
            "config": {"max_move_pct": 0.3, "otm_offset": 2, "sl_multiplier": 1.5, "lots": 1},
            "risk_config": {"max_loss_day": -15000, "max_signals_day": 2},
        },
        {
            "name": "BANKNIFTY Strangle Writer",
            "strategy_type": "options_writing",
            "instrument": "BANKNIFTY",
            "config": {"max_move_pct": 0.3, "otm_offset": 2, "sl_multiplier": 1.5, "lots": 1},
            "risk_config": {"max_loss_day": -20000, "max_signals_day": 2},
        },
        {
            "name": "NIFTY Index Arbitrage",
            "strategy_type": "index_arbitrage",
            "instrument": "NIFTY",
            "config": {"min_annualized_pct": 10, "lots": 1},
            "risk_config": {"max_loss_day": -5000, "max_signals_day": 2},
        },
    ]

    created = []
    async with pool.acquire() as conn:
        for d in defaults:
            existing = await conn.fetchval("SELECT id FROM bot_strategies WHERE name=$1", d["name"])
            if not existing:
                sid = await conn.fetchval("""
                    INSERT INTO bot_strategies (name, strategy_type, instrument, config, risk_config, is_active)
                    VALUES ($1,$2,$3,$4,$5,FALSE) RETURNING id
                """, d["name"], d["strategy_type"], d["instrument"],
                    json.dumps(d["config"]), json.dumps(d["risk_config"]))
                created.append({"id": sid, "name": d["name"]})
            else:
                created.append({"id": existing, "name": d["name"], "exists": True})

    return {"strategies": created}


@router.get("/health", summary="What the strategies see right now: spot, future, option expiry and an ATM premium")
async def bot_health():
    out = {"time": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST"), "indices": {}}
    for ix in ("NIFTY", "BANKNIFTY"):
        spot = await fetch_index_data(ix) or {}
        exp, ts = await _monthly_future(ix)
        fut = f"NFO:{ts}" if ts else f"{INDEX_CONFIG[ix]['fut_prefix']}{format_expiry(exp)}FUT"
        fut_ltp = await _kite_ltp(fut)
        wk = await _weekly_expiry(ix)
        atm = get_atm_strike(spot["price"], INDEX_CONFIG[ix]["option_strike_gap"]) if spot.get("price") else None
        ce = await _option_quote(ix, wk, atm, "CE") if atm else None
        out["indices"][ix] = {"spot": spot.get("price"), "change_pct": spot.get("change_pct"),
                              "spot_source": spot.get("source"), "future": fut, "future_expiry": str(exp),
                              "future_ltp": fut_ltp, "option_expiry": str(wk), "atm_strike": atm, "atm_ce": ce}
    out["ok"] = all(v["spot"] and v["future_ltp"] for v in out["indices"].values())
    return out
