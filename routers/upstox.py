import httpx
import json
import urllib.parse
from datetime import datetime, timedelta
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse
import asyncpg
import pytz

IST = pytz.timezone("Asia/Kolkata")
router = APIRouter(prefix="/api/upstox", tags=["Upstox"])

DB_URL = "postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db"

UPSTOX_BASE = "https://api.upstox.com/v2"
UPSTOX_AUTH_URL = "https://api.upstox.com/v2/login/authorization/dialog"
UPSTOX_TOKEN_URL = "https://api.upstox.com/v2/login/authorization/token"

# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

async def get_db():
    return await asyncpg.connect(DB_URL)

def get_user_id(request: Request):
    uid = getattr(request.state, "user_id", None)
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated. Please log in at alphamarket.co.in")
    return uid

async def get_integration(user_id: str):
    conn = await get_db()
    try:
        row = await conn.fetchrow(
            "SELECT * FROM advisor_integrations WHERE user_id=$1", user_id
        )
        return dict(row) if row else None
    finally:
        await conn.close()

async def upstox_request(method: str, path: str, token: str, payload: dict = None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json"
    }
    url = f"{UPSTOX_BASE}{path}"
    async with httpx.AsyncClient(timeout=15) as client:
        if method == "GET":
            resp = await client.get(url, headers=headers)
        else:
            resp = await client.post(url, headers=headers, json=payload)
    return resp.status_code, resp.json()

# Upstox instrument key formatter
def get_instrument_key(symbol: str, instrument_type: str, expiry: str, strike=None, opt_type=None):
    """
    Returns Upstox instrument key format:
    FUT: NSE_FO|NIFTY26APR25FUT
    OPT: NSE_FO|NIFTY22550PE26APR25
    EQ:  NSE_EQ|RELIANCE
    """
    if instrument_type == "EQ":
        return f"NSE_EQ|{symbol}"
    # Parse expiry e.g. "02APR" → "02APR26" (add year)
    year_suffix = str(datetime.now(IST).year)[2:]
    expiry_full = f"{expiry}{year_suffix}"
    if instrument_type == "FUT":
        return f"NSE_FO|{symbol}{expiry_full}FUT"
    if instrument_type in ("CE", "PE"):
        return f"NSE_FO|{symbol}{int(strike)}{instrument_type}{expiry_full}"
    return ""

# ─────────────────────────────────────────────────────────────
# OAUTH ENDPOINTS
# ─────────────────────────────────────────────────────────────

@router.get("/status")
async def upstox_status(request: Request):
    """Check if advisor has connected Upstox"""
    user_id = get_user_id(request)
    intg = await get_integration(user_id)
    if not intg or not intg.get("is_connected"):
        return {"connected": False}
    # Check token expiry
    expiry = intg.get("upstox_token_expiry")
    expired = expiry and expiry < datetime.now(IST)
    return {
        "connected": True,
        "expired": bool(expired),
        "connected_at": intg.get("connected_at"),
        "has_credentials": bool(intg.get("upstox_api_key"))
    }

@router.post("/credentials")
async def save_credentials(request: Request):
    """Save advisor's Upstox API key + secret + redirect URI"""
    user_id = get_user_id(request)
    body = await request.json()
    api_key = body.get("api_key", "").strip()
    api_secret = body.get("api_secret", "").strip()
    redirect_uri = body.get("redirect_uri", "").strip()
    if not api_key or not api_secret or not redirect_uri:
        raise HTTPException(status_code=400, detail="api_key, api_secret and redirect_uri required")
    conn = await get_db()
    try:
        await conn.execute("""
            INSERT INTO advisor_integrations (user_id, upstox_api_key, upstox_api_secret, upstox_redirect_uri, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                upstox_api_key=$2, upstox_api_secret=$3, upstox_redirect_uri=$4, updated_at=NOW()
        """, user_id, api_key, api_secret, redirect_uri)
    finally:
        await conn.close()
    return {"status": "saved"}

@router.get("/connect")
async def upstox_connect(request: Request):
    """Redirect advisor to Upstox OAuth login"""
    user_id = get_user_id(request)
    intg = await get_integration(user_id)
    if not intg or not intg.get("upstox_api_key"):
        raise HTTPException(status_code=400, detail="Save API credentials first")
    params = urllib.parse.urlencode({
        "client_id": intg["upstox_api_key"],
        "redirect_uri": intg["upstox_redirect_uri"],
        "response_type": "code",
        "state": user_id
    })
    return RedirectResponse(f"{UPSTOX_AUTH_URL}?{params}")

@router.get("/callback")
async def upstox_callback(request: Request, code: str = None, state: str = None, error: str = None):
    """Handle Upstox OAuth callback"""
    if error or not code:
        return RedirectResponse("/dyor/app?upstox=error")
    user_id = state
    intg = await get_integration(user_id)
    if not intg:
        return RedirectResponse("/dyor/app?upstox=error")
    # Exchange code for token
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(UPSTOX_TOKEN_URL, data={
            "code": code,
            "client_id": intg["upstox_api_key"],
            "client_secret": intg["upstox_api_secret"],
            "redirect_uri": intg["upstox_redirect_uri"],
            "grant_type": "authorization_code"
        }, headers={"Accept": "application/json"})
    if resp.status_code != 200:
        return RedirectResponse("/dyor/app?upstox=error")
    data = resp.json()
    access_token = data.get("access_token")
    # Upstox tokens expire at 3:30 AM IST next day
    now_ist = datetime.now(IST)
    expiry = now_ist.replace(hour=3, minute=30, second=0, microsecond=0) + timedelta(days=1)
    conn = await get_db()
    try:
        await conn.execute("""
            UPDATE advisor_integrations SET
                upstox_access_token=$1, upstox_token_expiry=$2,
                is_connected=TRUE, connected_at=NOW(), updated_at=NOW()
            WHERE user_id=$3
        """, access_token, expiry, user_id)
    finally:
        await conn.close()
    return RedirectResponse("/dyor/app?upstox=connected")

@router.post("/disconnect")
async def upstox_disconnect(request: Request):
    """Disconnect Upstox for this advisor"""
    user_id = get_user_id(request)
    conn = await get_db()
    try:
        await conn.execute("""
            UPDATE advisor_integrations SET
                upstox_access_token=NULL, is_connected=FALSE, updated_at=NOW()
            WHERE user_id=$1
        """, user_id)
    finally:
        await conn.close()
    return {"status": "disconnected"}

# ─────────────────────────────────────────────────────────────
# BASKET ENDPOINTS
# ─────────────────────────────────────────────────────────────

@router.get("/basket/prefill/fno")
async def prefill_fno_basket(request: Request):
    """Pre-fill F&O basket from today's active AlphaBot signals"""
    user_id = get_user_id(request)
    conn = await get_db()
    try:
        rows = await conn.fetch("""
            SELECT s.id, s.signal_type, s.instrument_type, s.symbol,
                   s.expiry, s.strike, s.entry_price, s.stop_loss,
                   s.target, s.quantity, s.rationale,
                   st.name as strategy_name
            FROM bot_signals s
            JOIN bot_strategies st ON s.strategy_id = st.id
            WHERE s.status = 'ACTIVE'
            AND DATE(s.created_at) = CURRENT_DATE
            ORDER BY s.created_at DESC
        """)
        legs = []
        for r in rows:
            legs.append({
                "signal_id": r["id"],
                "symbol": r["symbol"],
                "instrument_type": r["instrument_type"],
                "expiry": r["expiry"],
                "strike": r["strike"],
                "signal_type": r["signal_type"],
                "side": "BUY" if r["signal_type"] in ("LONG", "BUY") else "SELL",
                "quantity": r["quantity"],
                                "price": r["entry_price"],
                "stop_loss": r["stop_loss"],
                "target": r["target"],
                "display": r["symbol"]+((" "+str(int(r["strike"]))) if r["strike"] else "")+" "+(r["instrument_type"] or "")+" "+(r["expiry"] or ""),
                "rationale": r["rationale"],
                "strategy": r["strategy_name"],
                "order_type": "LIMIT",
                "product": "MIS",
                "instrument_key": get_instrument_key(
                    r["symbol"], r["instrument_type"],
                    r["expiry"], r["strike"],
                    r["instrument_type"] if r["instrument_type"] in ("CE","PE") else None
                )
            })
        return {"legs": legs, "count": len(legs), "source": "alphabot_signals"}
    finally:
        await conn.close()

@router.get("/basket/prefill/equity")
@router.get("/basket/prefill/equity")
async def prefill_equity_basket(request: Request):
    """Pre-fill equity basket from top movers using screener universe (dynamic)"""
    import redis as _redis
    try:
        rc = _redis.Redis(host="127.0.0.1", port=6379, db=1, decode_responses=True)
        raw = rc.get("sb_universe")
        rc.close()
        if raw:
            universe = json.loads(raw)
            movers = [s for s in universe if s.get("price", 0) > 50 and s.get("change_pct") is not None]
            movers.sort(key=lambda x: abs(x.get("change_pct", 0)), reverse=True)
            legs = []
            for m in movers[:10]:
                sym = m.get("symbol", "")
                ltp = m.get("price", 0)
                chg = m.get("change_pct", 0)
                side = "BUY" if chg >= 0 else "SELL"
                legs.append({
                    "symbol": sym, "instrument_type": "EQ", "side": side,
                    "quantity": 1, "price": ltp,
                    "stop_loss": round(ltp * (0.98 if side == "BUY" else 1.02), 2),
                    "target": round(ltp * (1.02 if side == "BUY" else 0.98), 2),
                    "display": f"{sym} EQ", "change_pct": chg,
                    "order_type": "LIMIT", "product": "MIS",
                    "sector": m.get("sector", ""),
                    "instrument_key": get_instrument_key(sym, "EQ", ""),
                })
            if legs:
                return {"legs": legs, "count": len(legs), "source": "screener_universe"}
    except Exception:
        pass
    # Fallback to data service
    import urllib.request as urlreq
    try:
        req = urlreq.Request(
            "http://127.0.0.1:5004/data/equity/quotes",
            data=json.dumps({"symbols": ["RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","SBIN","AXISBANK","WIPRO","LT","BAJFINANCE"]}).encode(),
            headers={"Content-Type": "application/json"}, method="POST"
        )
        with urlreq.urlopen(req, timeout=8) as resp:
            quotes = json.loads(resp.read())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Data service error: {str(e)}")
    movers = []
    for sym, data in quotes.get("quotes", {}).items():
        if isinstance(data, dict) and data.get("change_pct") is not None:
            movers.append({"symbol": sym, "ltp": data.get("price", 0), "change_pct": data.get("change_pct", 0)})
    movers.sort(key=lambda x: abs(x["change_pct"]), reverse=True)
    legs = []
    for m in movers[:10]:
        side = "BUY" if m["change_pct"] > 0 else "SELL"
        ltp = m["ltp"]
        legs.append({"symbol": m["symbol"], "instrument_type": "EQ", "side": side, "quantity": 1, "price": ltp, "stop_loss": round(ltp*(0.98 if side=="BUY" else 1.02),2), "target": round(ltp*(1.02 if side=="BUY" else 0.98),2), "display": f"{m['symbol']} EQ", "change_pct": m["change_pct"], "order_type": "LIMIT", "product": "MIS", "instrument_key": get_instrument_key(m["symbol"], "EQ", "")})
    return {"legs": legs, "count": len(legs), "source": "data_service"}

@router.post("/basket/place")
async def place_basket(request: Request):
    """Place basket orders on Upstox"""
    user_id = get_user_id(request)
    intg = await get_integration(user_id)
    if not intg or not intg.get("is_connected"):
        raise HTTPException(status_code=400, detail="Upstox not connected. Please connect first.")
    token_expiry = intg.get("upstox_token_expiry")
    if token_expiry and token_expiry < datetime.now(IST):
        raise HTTPException(status_code=401, detail="Upstox token expired. Please reconnect.")
    body = await request.json()
    basket_type = body.get("basket_type", "FNO")  # FNO or EQUITY
    basket_name = body.get("basket_name", f"AlphaBot {basket_type} {datetime.now(IST).strftime('%d%b %H:%M')}")
    legs = body.get("legs", [])
    if not legs:
        raise HTTPException(status_code=400, detail="No legs provided")
    access_token = intg["upstox_access_token"]
    results = []
    upstox_order_ids = []
    placed = 0
    errors = []
    for leg in legs:
        order_payload = {
            "quantity": leg.get("quantity", 1),
            "product": leg.get("product", "MIS"),
            "validity": "DAY",
            "price": leg.get("price", 0) if leg.get("order_type") == "LIMIT" else 0,
            "tag": f"alphabot_{basket_name[:20]}",
            "instrument_token": leg.get("instrument_key", ""),
            "order_type": leg.get("order_type", "MARKET"),
            "transaction_type": leg.get("side", "BUY"),
            "disclosed_quantity": 0,
            "trigger_price": 0,
            "is_amo": False
        }
        status_code, resp = await upstox_request("POST", "/order/place", access_token, order_payload)
        if status_code == 200 and resp.get("status") == "success":
            order_id = resp.get("data", {}).get("order_id")
            upstox_order_ids.append({"symbol": leg.get("symbol"), "order_id": order_id})
            placed += 1
            results.append({"symbol": leg.get("symbol"), "status": "placed", "order_id": order_id})
        else:
            err = resp.get("errors", [{}])[0].get("message", "Unknown error") if resp.get("errors") else str(resp)
            errors.append({"symbol": leg.get("symbol"), "error": err})
            results.append({"symbol": leg.get("symbol"), "status": "failed", "error": err})
    # Save to basket_orders
    final_status = "PLACED" if placed == len(legs) else ("PARTIAL" if placed > 0 else "FAILED")
    conn = await get_db()
    try:
        row = await conn.fetchrow("""
            INSERT INTO basket_orders
                (user_id, basket_name, basket_type, legs, order_type, product_type,
                 status, upstox_order_ids, total_legs, placed_legs, error_message)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            RETURNING id
        """, user_id, basket_name, basket_type,
            json.dumps(legs), body.get("order_type", "LIMIT"), "MIS",
            final_status, json.dumps(upstox_order_ids),
            len(legs), placed,
            json.dumps(errors) if errors else None)
        basket_id = row["id"]
    finally:
        await conn.close()
    return {
        "status": final_status,
        "basket_id": basket_id,
        "basket_name": basket_name,
        "total_legs": len(legs),
        "placed": placed,
        "failed": len(errors),
        "results": results,
        "errors": errors
    }

@router.get("/basket/history")
async def basket_history(request: Request, limit: int = 20):
    """Get basket order history for this advisor"""
    user_id = get_user_id(request)
    conn = await get_db()
    try:
        rows = await conn.fetch("""
            SELECT id, basket_name, basket_type, order_type, product_type,
                   status, total_legs, placed_legs, upstox_order_ids,
                   error_message, placed_at
            FROM basket_orders
            WHERE user_id=$1
            ORDER BY placed_at DESC
            LIMIT $2
        """, user_id, limit)
        return {"history": [dict(r) for r in rows], "count": len(rows)}
    finally:
        await conn.close()

@router.get("/basket/orders/live")
async def live_order_status(request: Request):
    """Fetch today's live order status from Upstox"""
    user_id = get_user_id(request)
    intg = await get_integration(user_id)
    if not intg or not intg.get("is_connected"):
        raise HTTPException(status_code=400, detail="Upstox not connected")
    status_code, resp = await upstox_request("GET", "/order/retrieve-all", intg["upstox_access_token"])
    if status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch orders from Upstox")
    orders = resp.get("data", [])
    return {"orders": orders, "count": len(orders)}
