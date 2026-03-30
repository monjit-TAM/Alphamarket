import json
import secrets
import httpx
import asyncpg
import pytz
from datetime import datetime, time as dtime
from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import JSONResponse

IST = pytz.timezone("Asia/Kolkata")
router = APIRouter(tags=["Basket Publisher"])
DB_URL = "postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db"

async def get_db():
    return await asyncpg.connect(DB_URL)

def get_user_id(request: Request):
    uid = getattr(request.state, "user_id", None)
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated. Please log in at alphamarket.co.in")
    return str(uid)

async def fire_webhooks(user_id: str, event: str, payload: dict):
    """Fire webhooks to all registered broker endpoints for this advisor"""
    conn = await get_db()
    try:
        rows = await conn.fetch(
            "SELECT webhook_url, broker_name FROM advisor_webhooks WHERE user_id=$1 AND is_active=TRUE",
            user_id
        )
    finally:
        await conn.close()
    for row in rows:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(row["webhook_url"], json={
                    "event": event,
                    "broker": row["broker_name"],
                    "timestamp": datetime.now(IST).isoformat(),
                    **payload
                })
        except Exception as e:
            print(f"Webhook failed for {row['webhook_url']}: {e}")

# ─────────────────────────────────────────────────────────────
# API KEY MANAGEMENT
# ─────────────────────────────────────────────────────────────

@router.post("/api/basket/apikey/generate")
async def generate_api_key(request: Request):
    """Generate a unique API key for this advisor (for broker polling)"""
    user_id = get_user_id(request)
    api_key = "AM_" + secrets.token_hex(24)
    conn = await get_db()
    try:
        await conn.execute("""
            INSERT INTO advisor_api_keys (user_id, api_key)
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO UPDATE SET api_key=$2, updated_at=NOW()
        """, user_id, api_key)
    except Exception:
        await conn.execute("""
            INSERT INTO advisor_api_keys (user_id, api_key)
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO UPDATE SET api_key=$2
        """, user_id, api_key)
    finally:
        await conn.close()
    return {"api_key": api_key, "poll_url": f"https://alphamarket.co.in/dyor/api/basket/live?api_key={api_key}"}

@router.get("/api/basket/apikey/status")
async def get_api_key_status(request: Request):
    """Get current API key for this advisor"""
    user_id = get_user_id(request)
    conn = await get_db()
    try:
        row = await conn.fetchrow("SELECT api_key, created_at, last_used_at FROM advisor_api_keys WHERE user_id=$1", user_id)
    finally:
        await conn.close()
    if not row:
        return {"has_key": False}
    return {
        "has_key": True,
        "api_key": row["api_key"],
        "poll_url": f"https://alphamarket.co.in/dyor/api/basket/live?api_key={row['api_key']}",
        "created_at": row["created_at"],
        "last_used_at": row["last_used_at"]
    }

# ─────────────────────────────────────────────────────────────
# WEBHOOK MANAGEMENT
# ─────────────────────────────────────────────────────────────

@router.post("/api/basket/webhook/register")
async def register_webhook(request: Request):
    """Register a broker webhook URL"""
    user_id = get_user_id(request)
    body = await request.json()
    url = body.get("webhook_url", "").strip()
    broker = body.get("broker_name", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="webhook_url required")
    conn = await get_db()
    try:
        await conn.execute("""
            INSERT INTO advisor_webhooks (user_id, webhook_url, broker_name)
            VALUES ($1, $2, $3)
        """, user_id, url, broker)
    finally:
        await conn.close()
    return {"status": "registered", "webhook_url": url}

@router.get("/api/basket/webhook/list")
async def list_webhooks(request: Request):
    user_id = get_user_id(request)
    conn = await get_db()
    try:
        rows = await conn.fetch("SELECT * FROM advisor_webhooks WHERE user_id=$1 ORDER BY created_at DESC", user_id)
    finally:
        await conn.close()
    return {"webhooks": [dict(r) for r in rows]}

@router.delete("/api/basket/webhook/{wid}")
async def delete_webhook(wid: int, request: Request):
    user_id = get_user_id(request)
    conn = await get_db()
    try:
        await conn.execute("DELETE FROM advisor_webhooks WHERE id=$1 AND user_id=$2", wid, user_id)
    finally:
        await conn.close()
    return {"status": "deleted"}

# ─────────────────────────────────────────────────────────────
# BASKET PUBLISH / MANAGE
# ─────────────────────────────────────────────────────────────

@router.post("/api/basket/publish")
async def publish_basket(request: Request):
    """Advisor publishes a basket — immediately active, webhook fired"""
    user_id = get_user_id(request)
    body = await request.json()
    basket_name = body.get("basket_name", "").strip()
    basket_type = body.get("basket_type", "FNO")
    legs = body.get("legs", [])
    order_type = body.get("order_type", "LIMIT")
    description = body.get("description", "")
    source = body.get("source", "MANUAL")
    signal_id = body.get("signal_id")
    if not basket_name:
        raise HTTPException(status_code=400, detail="basket_name required")
    if not legs:
        raise HTTPException(status_code=400, detail="legs required")
    conn = await get_db()
    try:
        row = await conn.fetchrow("""
            INSERT INTO advisor_basket_strategies
                (user_id, basket_name, basket_type, description, legs, order_type, product_type, source, signal_id)
            VALUES ($1,$2,$3,$4,$5,$6,'MIS',$7,$8)
            RETURNING id, published_at
        """, user_id, basket_name, basket_type, description,
            json.dumps(legs), order_type, source, signal_id)
        basket_id = row["id"]
        published_at = row["published_at"]
    finally:
        await conn.close()

    payload = {
        "basket_id": basket_id,
        "basket_name": basket_name,
        "basket_type": basket_type,
        "order_type": order_type,
        "legs": legs,
        "published_at": published_at.isoformat()
    }
    await fire_webhooks(user_id, "basket_published", payload)
    return {"status": "published", "basket_id": basket_id, **payload}

@router.get("/api/basket/my")
async def my_baskets(request: Request):
    """Get all baskets for this advisor (for dashboard)"""
    user_id = get_user_id(request)
    conn = await get_db()
    try:
        rows = await conn.fetch("""
            SELECT id, basket_name, basket_type, description, legs, order_type,
                   product_type, status, source, published_at, closed_at, close_reason
            FROM advisor_basket_strategies
            WHERE user_id=$1
            ORDER BY published_at DESC
            LIMIT 50
        """, user_id)
    finally:
        await conn.close()
    baskets = []
    for r in rows:
        b = dict(r)
        b["legs"] = json.loads(b["legs"]) if isinstance(b["legs"], str) else b["legs"]
        baskets.append(b)
    return {"baskets": baskets, "count": len(baskets)}

@router.put("/api/basket/{basket_id}/close")
async def close_basket(basket_id: int, request: Request):
    """Manually close a basket"""
    user_id = get_user_id(request)
    body = await request.json() if request.headers.get("content-length","0") != "0" else {}
    reason = body.get("reason", "MANUAL")
    conn = await get_db()
    try:
        row = await conn.fetchrow("""
            UPDATE advisor_basket_strategies
            SET status='CLOSED', closed_at=NOW(), close_reason=$1, updated_at=NOW()
            WHERE id=$2 AND user_id=$3
            RETURNING id, basket_name, basket_type, legs
        """, reason, basket_id, user_id)
    finally:
        await conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Basket not found")
    await fire_webhooks(user_id, "basket_closed", {
        "basket_id": basket_id,
        "basket_name": row["basket_name"],
        "close_reason": reason,
        "closed_at": datetime.now(IST).isoformat()
    })
    return {"status": "closed", "basket_id": basket_id, "reason": reason}

# ─────────────────────────────────────────────────────────────
# AUTO SQUARE-OFF AT 3:20 PM (called by scheduler)
# ─────────────────────────────────────────────────────────────

@router.post("/api/basket/auto-squareoff")
async def auto_squareoff():
    """Auto square-off all active baskets at 3:20 PM IST. Called by scheduler."""
    now = datetime.now(IST)
    if now.time() < dtime(15, 20):
        return {"status": "skipped", "reason": "Before 3:20 PM IST"}
    conn = await get_db()
    try:
        rows = await conn.fetch("""
            UPDATE advisor_basket_strategies
            SET status='SQUAREDOFF', closed_at=NOW(), close_reason='AUTO_SQUAREOFF', updated_at=NOW()
            WHERE status='ACTIVE'
            RETURNING id, user_id, basket_name, basket_type
        """)
    finally:
        await conn.close()
    closed = [dict(r) for r in rows]
    for b in closed:
        await fire_webhooks(b["user_id"], "basket_squaredoff", {
            "basket_id": b["id"],
            "basket_name": b["basket_name"],
            "close_reason": "AUTO_SQUAREOFF",
            "closed_at": datetime.now(IST).isoformat()
        })
    return {"status": "ok", "squared_off": len(closed), "baskets": closed}

# ─────────────────────────────────────────────────────────────
# BROKER POLL ENDPOINT (public, api_key auth)
# ─────────────────────────────────────────────────────────────

@router.get("/api/basket/live")
async def get_live_baskets(api_key: str = Query(...)):
    """
    Public endpoint for brokers to poll active baskets.
    Auth: ?api_key=AM_xxxx (per-advisor key)
    Returns all ACTIVE baskets for that advisor.
    """
    conn = await get_db()
    try:
        key_row = await conn.fetchrow(
            "SELECT user_id FROM advisor_api_keys WHERE api_key=$1 AND is_active=TRUE", api_key
        )
        if not key_row:
            raise HTTPException(status_code=401, detail="Invalid API key")
        user_id = key_row["user_id"]
        # Update last_used
        await conn.execute(
            "UPDATE advisor_api_keys SET last_used_at=NOW() WHERE api_key=$1", api_key
        )
        rows = await conn.fetch("""
            SELECT id, basket_name, basket_type, description, legs, order_type,
                   product_type, status, source, published_at
            FROM advisor_basket_strategies
            WHERE user_id=$1 AND status='ACTIVE'
            ORDER BY published_at DESC
        """, user_id)
    finally:
        await conn.close()
    baskets = []
    for r in rows:
        b = dict(r)
        b["legs"] = json.loads(b["legs"]) if isinstance(b["legs"], str) else b["legs"]
        baskets.append(b)
    return {
        "advisor_id": user_id,
        "active_baskets": baskets,
        "count": len(baskets),
        "timestamp": datetime.now(IST).isoformat(),
        "poll_interval_seconds": 30
    }
