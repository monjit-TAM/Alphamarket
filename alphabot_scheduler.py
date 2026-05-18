"""
AlphaBot Scheduler — Runs signal engine + position monitor during market hours
Executes every scan_interval (default 5 min) between 9:20 AM - 3:15 PM IST
"""

import asyncio, json, logging, signal as sig
from datetime import datetime, time as dtime, date
import aiohttp

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('/var/log/alphabot.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("alphabot-scheduler")

API_BASE = "http://127.0.0.1:8001/api/alphabot"
SCAN_INTERVAL = 300  # 5 minutes
MONITOR_INTERVAL = 60  # 1 minute (check SL/target more frequently)

MARKET_OPEN = dtime(9, 20)
MARKET_CLOSE = dtime(15, 15)
SQUAREOFF_TIME = dtime(15, 20)

_running = True

def handle_shutdown(signum, frame):
    global _running
    logger.info("Shutdown signal received, stopping...")
    _running = False

sig.signal(sig.SIGTERM, handle_shutdown)
sig.signal(sig.SIGINT, handle_shutdown)

async def call_api(session, endpoint, method="POST"):
    """Call AlphaBot API endpoint"""
    url = f"{API_BASE}/{endpoint}"
    try:
        if method == "POST":
            async with session.post(url) as resp:
                data = await resp.json()
                return data
        else:
            async with session.get(url) as resp:
                data = await resp.json()
                return data
    except Exception as e:
        logger.error(f"API call failed: {endpoint} — {e}")
        return None

def is_market_hours():
    """Check if current time is within market hours (IST)"""
    from datetime import timezone, timedelta
    ist = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(ist).time()
    return MARKET_OPEN <= now <= MARKET_CLOSE

def is_weekday():
    """Check if today is a trading day (Mon-Fri)"""
    return date.today().weekday() < 5

def current_ist():
    from datetime import timezone, timedelta
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist)

async def run_scheduler():
    """Main scheduler loop"""
    logger.info("=" * 60)
    logger.info("AlphaBot Scheduler Started")
    logger.info(f"Scan interval: {SCAN_INTERVAL}s | Monitor interval: {MONITOR_INTERVAL}s")
    logger.info(f"Market hours: {MARKET_OPEN} - {MARKET_CLOSE} IST")
    logger.info("=" * 60)

    last_scan = 0
    last_monitor = 0

    async with aiohttp.ClientSession() as session:
        while _running:
            try:
                now = current_ist()
                now_ts = asyncio.get_event_loop().time()

                if not is_weekday():
                    logger.info(f"Weekend — sleeping 60s")
                    await asyncio.sleep(60)
                    continue

                if not is_market_hours():
                    # Before market: wait
                    if now.time() < MARKET_OPEN:
                        wait = (datetime.combine(date.today(), MARKET_OPEN) - datetime.combine(date.today(), now.time())).seconds
                        wait = min(wait, 300)
                        logger.info(f"Pre-market — {now.strftime('%H:%M:%S')} IST — next check in {wait}s")
                        await asyncio.sleep(wait)
                        continue
                    # After market: log daily summary and sleep till next day
                    if now.time() > MARKET_CLOSE:
                        logger.info("Market closed — fetching daily summary")
                        summary = await call_api(session, "dashboard", "GET")
                        if summary:
                            t = summary.get("today", {})
                            o = summary.get("overall", {})
                            logger.info(f"TODAY: Signals={t.get('signals',0)}, P&L=₹{t.get('pnl',0):.0f}")
                            logger.info(f"OVERALL: Trades={o.get('total_trades',0)}, P&L=₹{o.get('total_pnl',0):.0f}, WinRate={o.get('win_rate',0)}%")
                        logger.info("Sleeping till next market open...")
                        await asyncio.sleep(600)  # Check every 10 min
                        continue

                # ── SIGNAL ENGINE SCAN (every 5 min) ──
                if now_ts - last_scan >= SCAN_INTERVAL:
                    logger.info(f"[SCAN] Running signal engine at {now.strftime('%H:%M:%S')} IST")
                    result = await call_api(session, "run")
                    if result:
                        count = result.get("count", 0)
                        if count > 0:
                            logger.info(f"[SCAN] Generated {count} new signal(s):")
                            for s in result.get("signals", []):
                                logger.info(f"  → {s.get('strategy_name','?')}: {s.get('signal_type','')} {s.get('instrument_display','')} @ {s.get('entry_price',0):.2f} | SL {s.get('stop_loss',0):.2f} | T {s.get('target',0):.2f}")
                        else:
                            logger.info(f"[SCAN] No new signals (market conditions don't match)")
                    else:
                        logger.warning("[SCAN] Engine returned no response")
                    last_scan = now_ts

                # ── POSITION MONITOR (every 1 min) ──
                if now_ts - last_monitor >= MONITOR_INTERVAL:
                    result = await call_api(session, "monitor")
                    # Also trigger basket auto-squareoff at 3:20 PM
                    now_ist = current_ist()
                    if now_ist.time() >= dtime(15, 20):
                        try:
                            async with session.post("http://127.0.0.1:8001/api/basket/auto-squareoff") as resp:
                                sq = await resp.json()
                                logger.info(f"Basket auto-squareoff: {sq.get('squared_off',0)} baskets closed")
                        except Exception as e:
                            logger.error(f"Basket squareoff error: {e}")
                    if result:
                        actions = result.get("results", [])
                        if actions:
                            for a in actions:
                                logger.info(f"[MONITOR] Signal #{a.get('signal_id')}: {a.get('action')} — P&L: ₹{a.get('pnl',0):.0f}")
                    last_monitor = now_ts

                # Sleep 30 seconds between checks
                await asyncio.sleep(30)

            except Exception as e:
                logger.error(f"Scheduler error: {e}")
                await asyncio.sleep(30)

    logger.info("AlphaBot Scheduler stopped")

if __name__ == "__main__":
    asyncio.run(run_scheduler())
