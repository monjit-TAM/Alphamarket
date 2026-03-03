"""
DYOR Arbitrage Scanner — Cash-Futures Spread, Options Parity, Scalping Tools
Powered by Zerodha Kite Connect for real-time futures data
"""

import os
import json
import time
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import RedirectResponse, JSONResponse

from core.trading_config import (FNO_LOT_SIZES, get_lot_size, get_sector,
    calculate_costs, check_position_risk, RISK_RULES, ROLLOVER, TRADING_WINDOWS, SECTOR_MAP)

logger = logging.getLogger("dyor.arbitrage")

router = APIRouter(prefix="/api/arbitrage", tags=["Arbitrage"])

# ── Kite Connect Config ───────────────────────────────────────────
KITE_API_KEY = os.getenv("KITE_API_KEY", "")
KITE_API_SECRET = os.getenv("KITE_API_SECRET", "")
KITE_REDIRECT_URL = os.getenv("KITE_REDIRECT_URL", "")
KITE_LOGIN_URL = f"https://kite.zerodha.com/connect/login?v=3&api_key={KITE_API_KEY}"

# In-memory token store + DB persistence
_kite_store = {
    "access_token": None,
    "user_id": None,
    "connected_at": None,
    "expires_at": None,  # Kite tokens expire at 6 AM next day
}

import psycopg2

def _db_url():
    return os.getenv("DATABASE_URL", "postgresql://dyor_user:DyorSecure2026Mar@localhost:5432/dyor_db")

def _save_kite_token():
    """Persist Kite token to dyor_db.api_settings"""
    try:
        data = json.dumps({
            "access_token": _kite_store["access_token"],
            "user_id": _kite_store["user_id"],
            "connected_at": _kite_store["connected_at"],
            "expires_at": _kite_store["expires_at"].isoformat() if _kite_store["expires_at"] else None,
        })
        conn = psycopg2.connect(_db_url())
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO api_settings (key, value, updated_at)
            VALUES ('kite_token', %s, NOW())
            ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()
        """, (data, data))
        conn.commit()
        cur.close()
        conn.close()
        logger.info("Kite token saved to DB")
    except Exception as e:
        logger.error(f"Failed to save Kite token to DB: {e}")

def _load_kite_token():
    """Load Kite token from dyor_db.api_settings on startup"""
    try:
        conn = psycopg2.connect(_db_url())
        cur = conn.cursor()
        cur.execute("SELECT value FROM api_settings WHERE key = 'kite_token'")
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row and row[0]:
            data = json.loads(row[0])
            expires_at = datetime.fromisoformat(data["expires_at"]) if data.get("expires_at") else None
            # Check if token is still valid (before 6 AM expiry)
            if expires_at and datetime.now() < expires_at:
                _kite_store["access_token"] = data["access_token"]
                _kite_store["user_id"] = data.get("user_id")
                _kite_store["connected_at"] = data.get("connected_at")
                _kite_store["expires_at"] = expires_at
                logger.info(f"Kite token loaded from DB, valid until {expires_at}")
                return True
            else:
                logger.info("Kite token in DB expired, needs fresh login")
        return False
    except Exception as e:
        logger.error(f"Failed to load Kite token from DB: {e}")
        return False

# Auto-load on module import
_load_kite_token()

# ── F&O Stock Universe (NSE) ─────────────────────────────────────
# Top liquid F&O stocks for spread scanning
FNO_UNIVERSE = [
    "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","ITC","SBIN",
    "BHARTIARTL","KOTAKBANK","LT","AXISBANK","BAJFINANCE","MARUTI","HCLTECH",
    "ASIANPAINT","TITAN","SUNPHARMA","WIPRO","TATAMOTORS","POWERGRID","NTPC",
    "ULTRACEMCO","NESTLEIND","TATASTEEL","JSWSTEEL","INDUSINDBK","ADANIENT",
    "ADANIPORTS","BAJAJFINSV","TECHM","GRASIM","ONGC","COALINDIA","HEROMOTOCO",
    "DRREDDY","EICHERMOT","CIPLA","DIVISLAB","BPCL","APOLLOHOSP","TATACONSUM",
    "SBILIFE","HDFCLIFE","BRITANNIA","HINDALCO","M&M","BAJAJ-AUTO","VEDL",
    "BANKBARODA","CANBK","PNB","IDFCFIRSTB","FEDERALBNK","LICHSGFIN",
    "VOLTAS","PIDILITIND","HAVELLS","GODREJCP","DABUR","MARICO","COLPAL",
    "BERGEPAINT","PAGEIND","MCDOWELL-N","INDIGO","TRENT","ZOMATO","PAYTM",
    "NYKAA","DELHIVERY","IDEA","SAIL","NMDC","GAIL","IOC","RECLTD","PFC",
    "BHEL","BEL","HAL","IRCTC","TATAPOWER","ADANIGREEN","ADANITRANS",
    "AMBUJACEM","ACC","SHREECEM","RAMCOCEM","MFSL","CHOLAFIN","MANAPPURAM",
    "MUTHOOTFIN","L&TFH","SBICARD","AUBANK","BANDHANBNK","RBLBANK",
    "INDUSTOWER","TATACOMM","PERSISTENT","LTTS","COFORGE","MINDTREE",
    "MPHASIS","NATIONALUM","HINDZINC","JINDALSTEL","AUROPHARMA","BIOCON",
    "LUPIN","TORNTPHARM","ALKEM","IPCALAB","LALPATHLAB","METROPOLIS",
    "ATUL","PIIND","DEEPAKNTR","SRF","NAVINFLUOR","CLEAN","ASTRAL",
    "POLYCAB","CUMMINSIND","SIEMENS","ABB","CROMPTON","WHIRLPOOL",
    "DIXON","HAPPSTMNDS","OBEROIRLTY","DLF","GODREJPROP","PRESTIGE",
    "PHOENIXLTD","LODHA","CONCOR","MOTHERSON","BALKRISIND","MRF",
    "APOLLOTYRE","EXIDEIND","AMARAJABAT","ESCORTS","ASHOKLEY","TVSMOTOR",
    "BATAINDIA","ABFRL","PVRINOX","JUBLFOOD","DEVYANI","IRFC","NHPC"
]


def _get_kite_headers():
    """Get authorization headers for Kite API"""
    if not _kite_store["access_token"]:
        return None
    return {
        "X-Kite-Version": "3",
        "Authorization": f"token {KITE_API_KEY}:{_kite_store['access_token']}"
    }


def _is_kite_connected():
    """Check if Kite session is active"""
    if not _kite_store["access_token"]:
        return False
    if _kite_store["expires_at"] and datetime.now() > _kite_store["expires_at"]:
        _kite_store["access_token"] = None
        return False
    return True


# ══════════════════════════════════════════════════════════════════
# KITE OAUTH ENDPOINTS
# ══════════════════════════════════════════════════════════════════

@router.get("/kite-login")
async def kite_login():
    """Redirect to Zerodha login page"""
    if not KITE_API_KEY:
        raise HTTPException(400, "Kite API key not configured")
    return {"login_url": KITE_LOGIN_URL}


@router.get("/kite-callback")
async def kite_callback(request_token: str = None, status: str = None):
    """Handle Zerodha OAuth callback — exchange request_token for access_token"""
    if status != "success" or not request_token:
        return RedirectResponse("/dyor/app?kite=error")

    import urllib.request

    # Generate checksum: SHA256(api_key + request_token + api_secret)
    checksum = hashlib.sha256(
        (KITE_API_KEY + request_token + KITE_API_SECRET).encode()
    ).hexdigest()

    # Exchange request_token for access_token
    try:
        import urllib.parse
        form_data = urllib.parse.urlencode({
            "api_key": KITE_API_KEY,
            "request_token": request_token,
            "checksum": checksum
        }).encode()

        req = urllib.request.Request(
            "https://api.kite.trade/session/token",
            data=form_data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Kite-Version": "3"
            },
            method="POST"
        )
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read().decode())

        if result.get("status") == "success":
            session_data = result["data"]
            _kite_store["access_token"] = session_data["access_token"]
            _kite_store["user_id"] = session_data.get("user_id")
            _kite_store["connected_at"] = datetime.now().isoformat()
            # Kite tokens expire at 6 AM next trading day
            tomorrow_6am = datetime.now().replace(hour=6, minute=0, second=0) + timedelta(days=1)
            _kite_store["expires_at"] = tomorrow_6am

            logger.info(f"Kite connected: user={session_data.get('user_id')}")
            _save_kite_token()
            return RedirectResponse("/dyor/app?kite=success")
        else:
            logger.error(f"Kite token exchange failed: {result}")
            return RedirectResponse("/dyor/app?kite=error")

    except Exception as e:
        logger.error(f"Kite OAuth error: {e}")
        return RedirectResponse(f"/dyor/app?kite=error&msg={str(e)[:100]}")


@router.get("/kite-status")
async def kite_status():
    """Check Kite connection status"""
    connected = _is_kite_connected()
    return {
        "connected": connected,
        "user_id": _kite_store["user_id"] if connected else None,
        "connected_at": _kite_store["connected_at"] if connected else None,
        "expires_at": _kite_store["expires_at"].isoformat() if _kite_store["expires_at"] else None,
    }


# ══════════════════════════════════════════════════════════════════
# CASH-FUTURES SPREAD SCANNER
# ══════════════════════════════════════════════════════════════════

async def _fetch_kite_quotes(symbols: list) -> dict:
    """Fetch LTP from Kite API for multiple instruments"""
    import urllib.request
    headers = _get_kite_headers()
    if not headers:
        raise HTTPException(401, "Kite not connected. Please login via Settings.")

    # Build instrument list: NSE:SYMBOL for cash, NFO:SYMBOL{EXPIRY}FUT for futures
    params = "&".join([f"i={s}" for s in symbols])
    url = f"https://api.kite.trade/quote/ltp?{params}"

    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())
        if data.get("status") == "success":
            return data["data"]
        return {}
    except Exception as e:
        logger.error(f"Kite quote fetch error: {e}")
        return {}


def _get_current_month_expiry():
    """Calculate current month's last Thursday (F&O expiry)"""
    now = datetime.now()
    # Find last Thursday of current month
    import calendar
    year, month = now.year, now.month

    # If we're past this month's expiry, use next month
    last_day = calendar.monthrange(year, month)[1]
    last_date = datetime(year, month, last_day)

    # Find last Thursday
    while last_date.weekday() != 3:  # Thursday = 3
        last_date -= timedelta(days=1)

    if now.date() > last_date.date():
        # Move to next month
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
        last_day = calendar.monthrange(year, month)[1]
        last_date = datetime(year, month, last_day)
        while last_date.weekday() != 3:
            last_date -= timedelta(days=1)

    return last_date


def _format_kite_expiry(expiry_date):
    """Format expiry for Kite instrument: 26MAR (YYMM format)"""
    return expiry_date.strftime("%y%b").upper()


@router.get("/spreads")
async def get_spreads(limit: int = 50):
    """Get cash-futures spreads for F&O universe"""
    if not _is_kite_connected():
        raise HTTPException(401, "Kite not connected. Login via Settings → Connect Zerodha")

    expiry = _get_current_month_expiry()
    expiry_str = _format_kite_expiry(expiry)
    days_to_expiry = max((expiry.date() - datetime.now().date()).days, 1)

    # Build instrument list
    cash_symbols = [f"NSE:{sym}" for sym in FNO_UNIVERSE[:limit]]
    fut_symbols = [f"NFO:{sym}{expiry_str}FUT" for sym in FNO_UNIVERSE[:limit]]

    # Fetch quotes in batches (Kite allows ~500 instruments per call)
    all_symbols = cash_symbols + fut_symbols
    quotes = await _fetch_kite_quotes(all_symbols)

    spreads = []
    for sym in FNO_UNIVERSE[:limit]:
        cash_key = f"NSE:{sym}"
        fut_key = f"NFO:{sym}{expiry_str}FUT"

        cash_data = quotes.get(cash_key, {})
        fut_data = quotes.get(fut_key, {})

        cash_ltp = cash_data.get("last_price", 0)
        fut_ltp = fut_data.get("last_price", 0)

        if cash_ltp > 0 and fut_ltp > 0:
            basis = fut_ltp - cash_ltp
            basis_pct = (basis / cash_ltp) * 100
            annualized = basis_pct * (365 / days_to_expiry)
            net_return = annualized - 0.5  # Approximate costs

            # Signal detection
            signal = "NEUTRAL"
            if annualized > 12:
                signal = "STRONG_BUY"
            elif annualized > 8:
                signal = "BUY"
            elif annualized < -2:
                signal = "BACKWARDATION"

            lot = get_lot_size(sym)
            sector = get_sector(sym)
            investment = cash_ltp * lot
            margin_req = fut_ltp * lot * 0.15
            total_capital = investment + margin_req

            # Exact cost calculation
            entry_costs = calculate_costs(cash_ltp, lot, "delivery")
            exit_costs_cash = calculate_costs(cash_ltp, lot, "delivery")
            exit_costs_fut = calculate_costs(fut_ltp, lot, "futures")
            total_trade_cost = entry_costs["total"] + exit_costs_cash["total"] + exit_costs_fut["total"]
            cost_pct = (total_trade_cost / total_capital) * 100 if total_capital > 0 else 0

            # Net return after ALL costs
            gross_profit = basis * lot
            true_net = gross_profit - total_trade_cost
            true_net_pct = (true_net / total_capital) * 100 if total_capital > 0 else 0
            true_annualized = true_net_pct * (365 / days_to_expiry)

            # Rollover analysis
            rollover_cost = total_capital * (ROLLOVER["spread_cost_pct"] + ROLLOVER["slippage_pct"]) / 100
            days_to_roll = max(days_to_expiry - ROLLOVER["best_rollover_window_days"], 0)

            # Production signal with tighter thresholds
            signal = "NEUTRAL"
            if true_annualized > 12:
                signal = "STRONG_BUY"
            elif true_annualized > 8:
                signal = "BUY"
            elif true_annualized > 5:
                signal = "WATCH"
            elif annualized < -2:
                signal = "BACKWARDATION"

            spreads.append({
                "symbol": sym,
                "spot": round(cash_ltp, 2),
                "futures": round(fut_ltp, 2),
                "basis": round(basis, 2),
                "basis_pct": round(basis_pct, 3),
                "annualized": round(annualized, 2),
                "net_return": round(true_annualized, 2),
                "days_to_expiry": days_to_expiry,
                "expiry": expiry.strftime("%d-%b-%Y"),
                "signal": signal,
                "lot_size": lot,
                "sector": sector,
                "investment": round(investment, 0),
                "margin_required": round(margin_req, 0),
                "total_capital": round(total_capital, 0),
                "gross_profit": round(gross_profit, 2),
                "total_costs": round(total_trade_cost, 2),
                "net_profit": round(true_net, 2),
                "cost_pct": round(cost_pct, 3),
                "rollover_cost": round(rollover_cost, 2),
                "days_to_roll": days_to_roll,
            })

    # Sort by annualized return descending
    spreads.sort(key=lambda x: x["annualized"], reverse=True)

    return {
        "spreads": spreads,
        "expiry": expiry.strftime("%d-%b-%Y"),
        "days_to_expiry": days_to_expiry,
        "count": len(spreads),
        "timestamp": datetime.now().isoformat(),
    }


@router.get("/opportunities")
async def get_opportunities(min_return: float = 8.0):
    """Filter best arbitrage opportunities"""
    data = await get_spreads(limit=180)
    opps = [s for s in data["spreads"] if s["annualized"] >= min_return]
    return {
        "opportunities": opps,
        "count": len(opps),
        "min_return_filter": min_return,
        "expiry": data["expiry"],
        "days_to_expiry": data["days_to_expiry"],
        "timestamp": datetime.now().isoformat(),
    }


# ══════════════════════════════════════════════════════════════════
# COST CALCULATOR
# ══════════════════════════════════════════════════════════════════

@router.get("/cost-calc")
async def cost_calculator(
    spot: float = 0,
    futures: float = 0,
    qty: int = 1,
    lot_size: int = 1
):
    """Calculate exact trade costs for cash-futures arbitrage"""
    total_qty = qty * lot_size
    investment = spot * total_qty

    # Buy cash segment costs
    cash_brokerage = min(investment * 0.0003, 20)  # 0.03% or ₹20 max (discount broker)
    cash_stt = investment * 0.001  # 0.1% STT on delivery buy
    cash_exchange = investment * 0.0000345  # Exchange charges
    cash_gst = (cash_brokerage + cash_exchange) * 0.18
    cash_stamp = investment * 0.00015  # Stamp duty
    cash_sebi = investment * 0.000001  # SEBI charges
    total_cash_cost = cash_brokerage + cash_stt + cash_exchange + cash_gst + cash_stamp + cash_sebi

    # Sell futures costs
    fut_turnover = futures * total_qty
    fut_brokerage = min(fut_turnover * 0.0003, 20)
    fut_stt = fut_turnover * 0.000125  # 0.0125% STT on sell side
    fut_exchange = fut_turnover * 0.000019
    fut_gst = (fut_brokerage + fut_exchange) * 0.18
    fut_stamp = fut_turnover * 0.00002
    fut_sebi = fut_turnover * 0.000001
    total_fut_cost = fut_brokerage + fut_stt + fut_exchange + fut_gst + fut_stamp + fut_sebi

    # Exit costs (sell cash + buy futures to close)
    exit_cash_stt = investment * 0.001  # STT on sell
    exit_costs = total_cash_cost + total_fut_cost  # Approximate

    total_costs = total_cash_cost + total_fut_cost + exit_costs
    gross_profit = (futures - spot) * total_qty
    net_profit = gross_profit - total_costs
    margin_required = fut_turnover * 0.15  # ~15% margin for futures

    return {
        "gross_profit": round(gross_profit, 2),
        "total_costs": round(total_costs, 2),
        "net_profit": round(net_profit, 2),
        "cost_breakup": {
            "cash_buy": round(total_cash_cost, 2),
            "futures_sell": round(total_fut_cost, 2),
            "exit_approx": round(exit_costs, 2),
        },
        "investment": round(investment, 2),
        "margin_required": round(margin_required, 2),
        "total_capital": round(investment + margin_required, 2),
        "return_pct": round((net_profit / (investment + margin_required)) * 100, 3) if investment > 0 else 0,
    }

