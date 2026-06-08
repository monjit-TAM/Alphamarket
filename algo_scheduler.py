"""
Algo Scheduler — Runs scanners during market hours, persists signals,
tracks positions, and monitors exits (SL/Target/Time stops).

Components:
  1. Scanner Scheduler — runs each algo at its defined frequency
  2. Signal Persistence — saves signals to PostgreSQL
  3. Position Tracker — tracks open positions with live prices
  4. Exit Monitor — fires EXIT signals on SL/target/time stop
"""
import asyncio, json, logging, redis
from datetime import datetime, date, timedelta, time
from decimal import Decimal
from typing import List, Dict, Optional
import pytz

logger = logging.getLogger("algo_scheduler")
IST = pytz.timezone("Asia/Kolkata")

DB_URL = "postgresql://dyor_user:DyorSecure2026Mar@localhost/dyor_db"
MARKET_OPEN = time(9, 15)
MARKET_CLOSE = time(15, 30)

# ═══════════════════════════════════════════════════════════════
# SIGNAL PERSISTENCE
# ═══════════════════════════════════════════════════════════════

async def save_signal(signal_dict: dict) -> int:
    """Save a new signal to DB. Returns signal ID."""
    import asyncpg
    conn = await asyncpg.connect(DB_URL)
    try:
        row = await conn.fetchrow('''
            INSERT INTO algo_signals
                (algo_id, algo_name, symbol, action, segment, entry_price, stop_loss,
                 target, target2, confidence, risk_pct, reward_pct, risk_reward,
                 hold_days, reasoning, signal_data, status, opened_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            RETURNING id
        ''',
            signal_dict.get("algo_id"), signal_dict.get("algo_name"),
            signal_dict.get("symbol"), signal_dict.get("action", "BUY"),
            signal_dict.get("segment", "equity"),
            Decimal(str(signal_dict.get("entry_price", 0))),
            Decimal(str(signal_dict.get("stop_loss", 0))),
            Decimal(str(signal_dict.get("target", 0))),
            Decimal(str(signal_dict.get("target2", 0))),
            signal_dict.get("confidence", 0),
            Decimal(str(signal_dict.get("risk_pct", 0))),
            Decimal(str(signal_dict.get("reward_pct", 0))),
            Decimal(str(signal_dict.get("risk_reward", 0))),
            signal_dict.get("hold_days", ""),
            signal_dict.get("reasoning", ""),
            json.dumps({k: v for k, v in signal_dict.items()
                        if k not in ("algo_id","algo_name","symbol","action","segment",
                                     "entry_price","stop_loss","target","target2",
                                     "confidence","risk_pct","reward_pct","risk_reward",
                                     "hold_days","reasoning")}),
            "OPEN",
            datetime.now(),
        )
        sig_id = row["id"]
        # Auto-subscribe to ticker for live prices
        try:
            from kite_ticker import subscribe_symbols, _running
            if _running:
                import asyncio
                asyncio.create_task(subscribe_symbols([signal_dict.get("symbol", "")]))
        except:
            pass
        logger.info(f"[ALGO] Signal saved: #{sig_id} {signal_dict.get('algo_id')} "
                     f"{signal_dict.get('action')} {signal_dict.get('symbol')} "
                     f"@ {signal_dict.get('entry_price')}")
        # Push to webhook targets (non-blocking)
        try:
            from algo_execution import push_signal_webhook
            asyncio.create_task(push_signal_webhook(signal_dict))
        except:
            pass
        return sig_id
    finally:
        await conn.close()


async def get_open_positions(algo_id: str = None) -> List[dict]:
    """Get all open positions, optionally filtered by algo."""
    import asyncpg
    conn = await asyncpg.connect(DB_URL)
    try:
        if algo_id:
            rows = await conn.fetch(
                "SELECT * FROM algo_signals WHERE status='OPEN' AND algo_id=$1 ORDER BY created_at DESC", algo_id)
        else:
            rows = await conn.fetch(
                "SELECT * FROM algo_signals WHERE status='OPEN' ORDER BY created_at DESC")
        return [dict(r) for r in rows]
    finally:
        await conn.close()


async def close_position(signal_id: int, exit_price: float, exit_reason: str):
    """Close a position with exit price and reason."""
    import asyncpg
    conn = await asyncpg.connect(DB_URL)
    try:
        row = await conn.fetchrow("SELECT * FROM algo_signals WHERE id=$1", signal_id)
        if not row:
            return
        entry = float(row["entry_price"])
        pnl_pct = ((exit_price / entry) - 1) * 100 if entry > 0 else 0
        pnl = (exit_price - entry)  # per share

        await conn.execute('''
            UPDATE algo_signals SET status='CLOSED', exit_price=$1, exit_reason=$2,
                pnl=$3, pnl_pct=$4, current_price=$5, closed_at=$6, updated_at=$7
            WHERE id=$8
        ''',
            Decimal(str(round(exit_price, 2))), exit_reason,
            Decimal(str(round(pnl, 2))), Decimal(str(round(pnl_pct, 2))),
            Decimal(str(round(exit_price, 2))),
            datetime.now(), datetime.now(), signal_id)

        logger.info(f"[ALGO] Position closed: #{signal_id} {row['symbol']} "
                     f"@ {exit_price} ({exit_reason}) P&L: {pnl_pct:.1f}%")
    finally:
        await conn.close()


async def update_live_price(signal_id: int, price: float):
    """Update current price for an open position."""
    import asyncpg
    conn = await asyncpg.connect(DB_URL)
    try:
        await conn.execute(
            "UPDATE algo_signals SET current_price=$1, updated_at=$2 WHERE id=$3",
            Decimal(str(round(price, 2))), datetime.now(), signal_id)
    finally:
        await conn.close()


# ═══════════════════════════════════════════════════════════════
# LIVE PRICE FETCHER
# ═══════════════════════════════════════════════════════════════

async def fetch_live_price(symbol: str) -> float:
    """Fetch live price — WebSocket ticker first (instant), HTTP fallback."""
    try:
        from kite_ticker import get_live_price
        price = get_live_price(symbol)
        if price > 0:
            return price
    except:
        pass
    # Fallback to HTTP
    import httpx
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(f"http://127.0.0.1:5004/data/equity/quote/{symbol}",
                            headers={"X-API-Key": "alpha_data_internal_2026"})
            if r.status_code == 200:
                d = r.json()
                return float(d.get("price", 0))
    except Exception as e:
        logger.warning(f"[ALGO] Price fetch failed for {symbol}: {e}")
    return 0


# ═══════════════════════════════════════════════════════════════
# EXIT MONITOR — checks SL/Target/Time stops
# ═══════════════════════════════════════════════════════════════

async def monitor_exits():
    """Check all open positions for exit conditions."""
    from algo_engine import ALGO_INFO
    positions = await get_open_positions()
    if not positions:
        return {"checked": 0, "closed": 0}

    closed_count = 0
    for pos in positions:
        symbol = pos["symbol"]
        algo_id = pos["algo_id"]
        entry = float(pos["entry_price"])
        sl = float(pos["stop_loss"])
        tgt = float(pos["target"])
        tgt2 = float(pos.get("target2") or 0)
        opened = pos.get("opened_at") or pos["created_at"]

        # Fetch live price
        price = await fetch_live_price(symbol)
        if price <= 0:
            continue

        # Update live price
        await update_live_price(pos["id"], price)

        # Calculate hold days
        now = datetime.now()
        if opened.tzinfo is not None:
            opened = opened.replace(tzinfo=None)
        hold_days = (now - opened).days

        exit_price = 0
        exit_reason = ""

        # ── Stop Loss ──
        if sl > 0 and price <= sl:
            exit_price = price
            exit_reason = "STOP_LOSS"

        # ── Target Hit ──
        elif tgt > 0 and price >= tgt:
            exit_price = price
            exit_reason = "TARGET"

        # ── Time Stop ──
        else:
            max_hold = _get_max_hold(algo_id)
            if hold_days >= max_hold:
                exit_price = price
                exit_reason = "TIME_STOP"

        # ── Trailing Stop Logic ──
        if exit_price == 0 and entry > 0:
            pnl_pct = ((price / entry) - 1) * 100
            if algo_id in ("ALGO1", "ALGO2"):
                # Investor algos: trail after +8%
                if pnl_pct >= 8:
                    trail_sl = price * 0.94  # 6% trail
                    if price <= trail_sl:
                        exit_price = price
                        exit_reason = "TRAILING_STOP"
            elif algo_id == "ALGO4":
                # Momentum: trail after +4%
                if pnl_pct >= 4:
                    trail_sl = entry  # Move to breakeven
                    if price <= trail_sl:
                        exit_price = price
                        exit_reason = "BREAKEVEN_STOP"

        # ── Execute Exit ──
        if exit_price > 0:
            await close_position(pos["id"], exit_price, exit_reason)
            closed_count += 1

    return {"checked": len(positions), "closed": closed_count}


def _get_max_hold(algo_id: str) -> int:
    """Maximum hold days per algo."""
    return {"ALGO1": 45, "ALGO2": 60, "ALGO3": 4, "ALGO4": 10, "ALGO5": 5}.get(algo_id, 30)


# ═══════════════════════════════════════════════════════════════
# SCANNER SCHEDULER — runs algos at defined frequencies
# ═══════════════════════════════════════════════════════════════

def is_market_hours() -> bool:
    """Check if current time is within market hours (IST)."""
    now = datetime.now(IST)
    if now.weekday() >= 5:  # Saturday/Sunday
        return False
    return MARKET_OPEN <= now.time() <= MARKET_CLOSE


def should_scan(algo_id: str, last_scan: dict) -> bool:
    """Check if an algo should run based on its frequency."""
    now = datetime.now(IST)
    last = last_scan.get(algo_id)

    if algo_id == "ALGO1":
        # Daily at 10:00 AM
        if now.time() >= time(10, 0) and (not last or last.date() < now.date()):
            return True
    elif algo_id == "ALGO2":
        # Daily at 10:30 AM and 2:30 PM
        if now.time() >= time(10, 30) and (not last or last.date() < now.date()):
            return True
        if now.time() >= time(14, 30) and last and last.time() < time(14, 0):
            return True
    elif algo_id == "ALGO3":
        # Every 30 min, Mon-Wed only
        if now.weekday() > 2:
            return False
        if not last or (now - last).total_seconds() >= 300:
            return True
    elif algo_id == "ALGO4":
        # Every 1 min (trader algo)
        if not last or (now - last).total_seconds() >= 60:
            return True
    elif algo_id == "ALGO5":
        # Every 2 min (trader algo)
        if not last or (now - last).total_seconds() >= 120:
            return True
    return False


async def run_scanner_cycle(last_scan: dict) -> dict:
    """Run one cycle of all scanners. Returns signals generated."""
    from algo_engine import (scan_alphascore_momentum, scan_smart_money_breakout,
                              scan_momentum_surge, scan_oversold_snapback,
                              scan_theta_decay, ALGO_INFO)

    if not is_market_hours():
        return {"market": "closed", "signals": 0}

    # Load universe
    r = redis.Redis(db=1)
    raw = r.get("sb_universe")
    r.close()
    universe = json.loads(raw) if raw else []
    if not universe:
        return {"error": "universe empty", "signals": 0}

    results = {}
    total_signals = 0

    for algo_id in ALGO_INFO:
        if not should_scan(algo_id, last_scan):
            continue

        signals = []
        open_pos = await get_open_positions(algo_id)
        open_pos_list = [{"symbol": p["symbol"]} for p in open_pos]

        try:
            if algo_id == "ALGO1":
                signals = scan_alphascore_momentum(universe, open_positions=open_pos_list)
            elif algo_id == "ALGO2":
                signals = scan_smart_money_breakout(universe, open_positions=open_pos_list)
            elif algo_id == "ALGO3":
                import httpx
                try:
                    async with httpx.AsyncClient(timeout=5) as c:
                        vr = await c.get("http://127.0.0.1:5004/data/equity/quote/INDIAVIX",
                                         headers={"X-API-Key": "alpha_data_internal_2026"})
                        vix = vr.json().get("price", 16) if vr.status_code == 200 else 16
                        nr = await c.get("http://127.0.0.1:5004/data/equity/quote/%5ENSEI",
                                         headers={"X-API-Key": "alpha_data_internal_2026"})
                        nifty = nr.json().get("price", 23000) if nr.status_code == 200 else 23000
                        br = await c.get("http://127.0.0.1:5004/data/equity/quote/%5ENSEBANK",
                                         headers={"X-API-Key": "alpha_data_internal_2026"})
                        bnf = br.json().get("price", 53000) if br.status_code == 200 else 53000
                except:
                    vix, nifty, bnf = 16, 23000, 53000
                dow = datetime.now().weekday()
                signals = scan_theta_decay(vix=vix, vix_sma20=17, nifty_price=nifty,
                                            banknifty_price=bnf, atr_pct=1.2,
                                            theta_score=80, day_of_week=dow,
                                            open_positions=open_pos_list)
            elif algo_id == "ALGO4":
                signals = scan_momentum_surge(universe, open_positions=open_pos_list)
            elif algo_id == "ALGO5":
                signals = scan_oversold_snapback(universe, open_positions=open_pos_list)

            # Save signals to DB
            for sig in signals:
                sig_dict = sig.to_dict()
                await save_signal(sig_dict)
                total_signals += 1

            last_scan[algo_id] = datetime.now(IST)
            results[algo_id] = {"scanned": True, "signals": len(signals)}

        except Exception as e:
            logger.error(f"[ALGO] Scanner error {algo_id}: {e}")
            results[algo_id] = {"error": str(e)}

    # Monitor exits for open positions
    exit_result = await monitor_exits()

    return {
        "cycle_time": datetime.now().isoformat(),
        "market": "open",
        "scanners": results,
        "new_signals": total_signals,
        "exits": exit_result,
    }




# ═══════════════════════════════════════════════════════════════
# FAST EXIT MONITOR — runs every 10 seconds for open positions
# ═══════════════════════════════════════════════════════════════

_fast_monitor_running = False

async def fast_exit_monitor():
    """Background task: checks exits every 10s for traders, 15s for investors."""
    global _fast_monitor_running
    if _fast_monitor_running:
        return
    _fast_monitor_running = True
    logger.info("[FAST MONITOR] Started — 10s trader / 15s investor cycle")
    
    cycle = 0
    while True:
        try:
            if not is_market_hours():
                await asyncio.sleep(30)
                continue
            
            cycle += 1
            positions = await get_open_positions()
            
            if not positions:
                await asyncio.sleep(10)
                continue
            
            for pos in positions:
                algo_id = pos["algo_id"]
                # Investor algos: check every 3rd cycle (~15s)
                if algo_id in ("ALGO1", "ALGO2") and cycle % 3 != 0:
                    continue
                
                symbol = pos["symbol"]
                entry = float(pos["entry_price"])
                sl = float(pos["stop_loss"])
                tgt = float(pos["target"])
                opened = pos.get("opened_at") or pos["created_at"]
                
                price = await fetch_live_price(symbol)
                if price <= 0:
                    continue
                
                # Update live price
                await update_live_price(pos["id"], price)
                
                # Calculate hold days
                now = datetime.now()
                if opened.tzinfo is not None:
                    opened = opened.replace(tzinfo=None)
                hold_days = (now - opened).days
                
                exit_price = 0
                exit_reason = ""
                
                # Stop Loss
                if sl > 0 and price <= sl:
                    exit_price = price
                    exit_reason = "STOP_LOSS"
                # Target
                elif tgt > 0 and price >= tgt:
                    exit_price = price
                    exit_reason = "TARGET"
                # Time Stop
                else:
                    max_hold = _get_max_hold(algo_id)
                    if hold_days >= max_hold:
                        exit_price = price
                        exit_reason = "TIME_STOP"
                
                # Trailing Stop
                if exit_price == 0 and entry > 0:
                    pnl_pct = ((price / entry) - 1) * 100
                    if algo_id in ("ALGO1", "ALGO2") and pnl_pct >= 8:
                        if price <= price * 0.94:
                            exit_price = price
                            exit_reason = "TRAILING_STOP"
                    elif algo_id == "ALGO4" and pnl_pct >= 4:
                        if price <= entry:
                            exit_price = price
                            exit_reason = "BREAKEVEN_STOP"
                
                if exit_price > 0:
                    await close_position(pos["id"], exit_price, exit_reason)
                    logger.info(f"[FAST EXIT] {symbol} closed @ {exit_price} ({exit_reason})")
            
            await asyncio.sleep(5)  # 5 second base cycle
            
        except Exception as e:
            logger.error(f"[FAST MONITOR] Error: {e}")
            await asyncio.sleep(10)


def start_fast_monitor():
    """Start the fast monitor as a background task."""
    global _fast_monitor_running
    if not _fast_monitor_running:
        asyncio.create_task(fast_exit_monitor())
        logger.info("[FAST MONITOR] Background task created")


async def scheduler_loop():
    """Main scheduler loop — runs continuously during market hours."""
    last_scan = {}
    logger.info("[ALGO SCHEDULER] Started")

    while True:
        try:
            if is_market_hours():
                result = await run_scanner_cycle(last_scan)
                if result.get("new_signals", 0) > 0 or result.get("exits", {}).get("closed", 0) > 0:
                    logger.info(f"[ALGO SCHEDULER] Cycle: {result}")
            await asyncio.sleep(60)  # Check every 60 seconds
        except Exception as e:
            logger.error(f"[ALGO SCHEDULER] Error: {e}")
            await asyncio.sleep(30)
