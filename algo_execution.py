"""
Algo Execution Module
1. Webhook Push — sends signals to configured broker endpoints
2. One-Click Execution — places Kite bracket orders

SAFETY: Nothing fires automatically.
- Webhooks only push to URLs explicitly added to algo_webhook_targets table
- Orders only placed when user clicks "Execute" button
"""
import json, logging, hmac, hashlib, asyncio
from datetime import datetime
from decimal import Decimal
from typing import Optional

logger = logging.getLogger("algo_execution")

DB_URL = "postgresql://dyor_user:DyorSecure2026Mar@localhost/dyor_db"
KITE_API_KEY = "wmwpq34kw5th0y2l"


# ═══════════════════════════════════════════════════════════════
# DATABASE SETUP
# ═══════════════════════════════════════════════════════════════

async def ensure_tables():
    """Create webhook + execution tables if they don't exist."""
    import asyncpg
    conn = await asyncpg.connect(DB_URL)
    try:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS algo_webhook_targets (
                id SERIAL PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                url TEXT NOT NULL,
                secret VARCHAR(100),
                algo_ids TEXT DEFAULT 'ALL',
                active BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS algo_executions (
                id SERIAL PRIMARY KEY,
                signal_id INTEGER REFERENCES algo_signals(id),
                user_id VARCHAR(50) DEFAULT 'admin',
                broker VARCHAR(20) DEFAULT 'kite',
                order_type VARCHAR(20) DEFAULT 'bracket',
                order_id VARCHAR(50),
                status VARCHAR(20) DEFAULT 'PENDING',
                entry_price DECIMAL(12,2),
                qty INTEGER DEFAULT 1,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        ''')
        logger.info("[EXEC] Tables ensured")
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# LEVEL 1: WEBHOOK PUSH
# ═══════════════════════════════════════════════════════════════

async def push_signal_webhook(signal_dict: dict):
    """Push a signal to all active webhook targets. Called when signal is saved."""
    import asyncpg, httpx
    conn = await asyncpg.connect(DB_URL)
    try:
        targets = await conn.fetch(
            "SELECT * FROM algo_webhook_targets WHERE active=TRUE")
        if not targets:
            return {"pushed": 0, "reason": "no active targets"}

        algo_id = signal_dict.get("algo_id", "")
        results = []

        for t in targets:
            # Check if this target subscribes to this algo
            allowed = t["algo_ids"]
            if allowed != "ALL" and algo_id not in allowed.split(","):
                continue

            payload = {
                "event": "ALGO_SIGNAL",
                "timestamp": datetime.now().isoformat(),
                "data": {
                    "algo_id": signal_dict.get("algo_id"),
                    "algo_name": signal_dict.get("algo_name"),
                    "symbol": signal_dict.get("symbol"),
                    "action": signal_dict.get("action"),
                    "entry_price": signal_dict.get("entry_price"),
                    "stop_loss": signal_dict.get("stop_loss"),
                    "target": signal_dict.get("target"),
                    "confidence": signal_dict.get("confidence"),
                    "hold_days": signal_dict.get("hold_days"),
                    "reasoning": signal_dict.get("reasoning"),
                    "risk_pct": signal_dict.get("risk_pct"),
                    "risk_reward": signal_dict.get("risk_reward"),
                }
            }

            # Sign payload with HMAC if secret configured
            body = json.dumps(payload)
            headers = {"Content-Type": "application/json"}
            if t["secret"]:
                sig = hmac.new(t["secret"].encode(), body.encode(), hashlib.sha256).hexdigest()
                headers["X-AlphaMarket-Signature"] = sig

            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.post(t["url"], content=body, headers=headers)
                    results.append({
                        "target": t["name"], "status": r.status_code,
                        "success": 200 <= r.status_code < 300
                    })
                    logger.info(f"[WEBHOOK] Pushed to {t['name']}: {r.status_code}")
            except Exception as e:
                results.append({"target": t["name"], "error": str(e)})
                logger.error(f"[WEBHOOK] Failed {t['name']}: {e}")

        return {"pushed": len(results), "results": results}
    finally:
        await conn.close()


async def push_exit_webhook(signal_id: int, symbol: str, exit_price: float, exit_reason: str):
    """Push exit signal to webhook targets."""
    import asyncpg, httpx
    conn = await asyncpg.connect(DB_URL)
    try:
        targets = await conn.fetch(
            "SELECT * FROM algo_webhook_targets WHERE active=TRUE")
        if not targets:
            return

        payload = {
            "event": "ALGO_EXIT",
            "timestamp": datetime.now().isoformat(),
            "data": {
                "signal_id": signal_id,
                "symbol": symbol,
                "action": "EXIT",
                "exit_price": exit_price,
                "exit_reason": exit_reason,
            }
        }
        body = json.dumps(payload)
        headers = {"Content-Type": "application/json"}

        for t in targets:
            try:
                if t["secret"]:
                    sig = hmac.new(t["secret"].encode(), body.encode(), hashlib.sha256).hexdigest()
                    headers["X-AlphaMarket-Signature"] = sig
                async with httpx.AsyncClient(timeout=10) as client:
                    await client.post(t["url"], content=body, headers=headers)
            except:
                pass
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# LEVEL 2: ONE-CLICK KITE EXECUTION
# ═══════════════════════════════════════════════════════════════

def _get_kite_client():
    """Get authenticated KiteConnect client."""
    import psycopg2
    from kiteconnect import KiteConnect
    conn = psycopg2.connect("dbname=dyor_db user=dyor_user password=DyorSecure2026Mar host=localhost")
    cr = conn.cursor()
    cr.execute("SELECT value FROM api_settings WHERE key='kite_token'")
    row = cr.fetchone()
    conn.close()
    if not row:
        return None
    token = json.loads(row[0]).get("access_token")
    if not token:
        return None
    kite = KiteConnect(api_key=KITE_API_KEY)
    kite.set_access_token(token)
    return kite


async def execute_signal(signal_id: int, qty: int = 1, user_id: str = "admin") -> dict:
    """
    One-click execution — places a bracket order via Kite.
    Entry + SL + Target in a single order.
    
    SAFETY: Only called when user explicitly clicks "Execute".
    """
    import asyncpg

    # 1. Get signal details
    conn = await asyncpg.connect(DB_URL)
    try:
        signal = await conn.fetchrow("SELECT * FROM algo_signals WHERE id=$1", signal_id)
        if not signal:
            return {"success": False, "error": "Signal not found"}
        if signal["status"] == "CLOSED":
            return {"success": False, "error": "Signal already closed"}
    finally:
        await conn.close()

    symbol = signal["symbol"]
    action = signal["action"]
    entry = float(signal["entry_price"])
    sl = float(signal["stop_loss"])
    tgt = float(signal["target"])

    # 2. Calculate order parameters
    transaction_type = "BUY" if action == "BUY" else "SELL"
    sl_points = abs(round(entry - sl, 2))
    tgt_points = abs(round(tgt - entry, 2))

    # 3. Determine exchange and product
    exchange = "NSE"
    segment = signal.get("segment", "equity")
    if segment == "options" or symbol in ("NIFTY", "BANKNIFTY"):
        exchange = "NFO"

    # 4. Place bracket order via Kite
    try:
        kite = _get_kite_client()
        if not kite:
            return {"success": False, "error": "Kite not connected. Login via Settings → Connect Broker"}

        order_params = {
            "tradingsymbol": symbol,
            "exchange": exchange,
            "transaction_type": transaction_type,
            "quantity": qty,
            "order_type": "LIMIT",
            "price": entry,
            "validity": "DAY",
            "product": "MIS",  # Intraday for trader algos
            "variety": "bo",   # Bracket order
            "squareoff": tgt_points,
            "stoploss": sl_points,
        }

        # Investor algos use CNC (delivery)
        algo_id = signal["algo_id"]
        if algo_id in ("ALGO1", "ALGO2"):
            # CNC doesn't support bracket — use regular + GTT
            order_params["product"] = "CNC"
            order_params["variety"] = "regular"
            del order_params["squareoff"]
            del order_params["stoploss"]

        order_id = kite.place_order(**order_params)

        # 5. Save execution record
        conn2 = await asyncpg.connect(DB_URL)
        try:
            await conn2.execute('''
                INSERT INTO algo_executions
                    (signal_id, user_id, broker, order_type, order_id, status, entry_price, qty)
                VALUES ($1, $2, 'kite', $3, $4, 'PLACED', $5, $6)
            ''', signal_id, user_id,
                "bracket" if algo_id not in ("ALGO1", "ALGO2") else "regular",
                str(order_id), Decimal(str(entry)), qty)
        finally:
            await conn2.close()

        logger.info(f"[EXEC] Order placed: {transaction_type} {symbol} qty={qty} "
                     f"order_id={order_id} type={'bracket' if 'bo' in str(order_params.get('variety')) else 'regular'}")

        return {
            "success": True,
            "order_id": str(order_id),
            "symbol": symbol,
            "action": transaction_type,
            "qty": qty,
            "entry": entry,
            "sl": sl,
            "target": tgt,
            "product": order_params["product"],
            "variety": order_params.get("variety", "regular"),
        }

    except Exception as e:
        error_msg = str(e)
        logger.error(f"[EXEC] Order failed: {symbol} — {error_msg}")

        # Save failed execution
        try:
            conn3 = await asyncpg.connect(DB_URL)
            await conn3.execute('''
                INSERT INTO algo_executions
                    (signal_id, user_id, broker, status, error_message)
                VALUES ($1, $2, 'kite', 'FAILED', $3)
            ''', signal_id, user_id, error_msg)
            await conn3.close()
        except:
            pass

        return {"success": False, "error": error_msg}


async def get_execution_history(limit: int = 50) -> list:
    """Get execution history."""
    import asyncpg
    conn = await asyncpg.connect(DB_URL)
    try:
        rows = await conn.fetch('''
            SELECT e.*, s.symbol, s.algo_id, s.algo_name, s.action
            FROM algo_executions e
            JOIN algo_signals s ON e.signal_id = s.id
            ORDER BY e.created_at DESC LIMIT $1
        ''', limit)
        result = []
        for r in rows:
            d = dict(r)
            for k, v in d.items():
                if isinstance(v, Decimal): d[k] = float(v)
                if isinstance(v, datetime): d[k] = v.isoformat()
            result.append(d)
        return result
    finally:
        await conn.close()
