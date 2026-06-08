"""
Kite WebSocket Ticker — Real-time price feed for algo positions.
Tick-by-tick prices via WebSocket. Exit monitor reads from memory dict.
"""
import json, logging, threading, time
from datetime import datetime
from typing import Dict, Set

logger = logging.getLogger("kite_ticker")

KITE_API_KEY = "wmwpq34kw5th0y2l"
DB_URL = "postgresql://dyor_user:DyorSecure2026Mar@localhost/dyor_db"

_live_prices: Dict[str, dict] = {}
_instrument_map: Dict[str, int] = {}
_reverse_map: Dict[int, str] = {}
_subscribed_tokens: Set[int] = set()
_pending_subscribe: list = []
_ws_ref = [None]
_ticker = None
_ticker_thread = None
_running = False


def get_live_price(symbol: str) -> float:
    data = _live_prices.get(symbol)
    return data["price"] if data else 0


def get_all_live_prices() -> Dict[str, dict]:
    return dict(_live_prices)


def _get_access_token_sync() -> str:
    import psycopg2
    conn = psycopg2.connect("dbname=dyor_db user=dyor_user password=DyorSecure2026Mar host=localhost")
    cr = conn.cursor()
    cr.execute("SELECT value FROM api_settings WHERE key='kite_token'")
    row = cr.fetchone()
    conn.close()
    if row:
        return json.loads(row[0]).get("access_token", "")
    return ""


async def load_instruments():
    global _instrument_map, _reverse_map
    import httpx
    token = _get_access_token_sync()
    if not token:
        logger.error("[TICKER] No Kite access token")
        return
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get("https://api.kite.trade/instruments/NSE",
                           headers={"Authorization": f"token {KITE_API_KEY}:{token}"})
            if r.status_code == 200:
                lines = r.text.strip().split("\n")
                headers = lines[0].split(",")
                token_idx = headers.index("instrument_token")
                sym_idx = headers.index("tradingsymbol")
                _instrument_map.clear()
                _reverse_map.clear()
                for line in lines[1:]:
                    parts = line.split(",")
                    if len(parts) > max(token_idx, sym_idx):
                        sym = parts[sym_idx]
                        tok = int(parts[token_idx])
                        _instrument_map[sym] = tok
                        _reverse_map[tok] = sym
                logger.info(f"[TICKER] Loaded {len(_instrument_map)} NSE instruments")
            else:
                logger.error(f"[TICKER] Instrument fetch failed: {r.status_code}")
    except Exception as e:
        logger.error(f"[TICKER] Instrument load error: {e}")


def _run_ticker_thread():
    global _ticker, _running, _ws_ref
    from kiteconnect import KiteTicker

    access_token = _get_access_token_sync()
    if not access_token:
        logger.error("[TICKER] No access token")
        return

    _ticker = KiteTicker(KITE_API_KEY, access_token)

    def on_connect(ws, response):
        _ws_ref[0] = ws
        logger.info("[TICKER] WebSocket connected")
        all_tokens = list(_subscribed_tokens) + list(_pending_subscribe)
        _pending_subscribe.clear()
        if all_tokens:
            unique = list(set(all_tokens))
            ws.subscribe(unique)
            ws.set_mode(ws.MODE_LTP, unique)
            _subscribed_tokens.update(unique)
            logger.info(f"[TICKER] Subscribed to {len(unique)} tokens")

    def on_ticks(ws, ticks):
        for tick in ticks:
            token = tick.get("instrument_token")
            sym = _reverse_map.get(token)
            if sym:
                _live_prices[sym] = {
                    "price": tick.get("last_price", 0),
                    "timestamp": datetime.now().isoformat(),
                }

    def on_close(ws, code, reason):
        global _running
        logger.warning(f"[TICKER] Closed: {code} {reason}")
        _running = False

    def on_error(ws, code, reason):
        logger.error(f"[TICKER] Error: {code} {reason}")

    _ticker.on_connect = on_connect
    _ticker.on_ticks = on_ticks
    _ticker.on_close = on_close
    _ticker.on_error = on_error

    _running = True
    logger.info("[TICKER] Starting WebSocket...")
    try:
        _ticker.connect(threaded=True)
        while _running:
            time.sleep(2)
            if _pending_subscribe and _ws_ref[0]:
                try:
                    tokens = list(set(_pending_subscribe))
                    _pending_subscribe.clear()
                    _ws_ref[0].subscribe(tokens)
                    _ws_ref[0].set_mode(_ws_ref[0].MODE_LTP, tokens)
                    _subscribed_tokens.update(tokens)
                    logger.info(f"[TICKER] Late-subscribed {len(tokens)} tokens")
                except Exception as e:
                    logger.error(f"[TICKER] Late subscribe error: {e}")
    except Exception as e:
        logger.error(f"[TICKER] Connection error: {e}")
        _running = False


async def subscribe_symbols(symbols: list):
    global _pending_subscribe
    tokens = []
    for sym in symbols:
        t = _instrument_map.get(sym)
        if t:
            tokens.append(t)
            _subscribed_tokens.add(t)
    if tokens:
        _pending_subscribe.extend(tokens)
        logger.info(f"[TICKER] Queued {len(tokens)} symbols: {symbols}")


async def unsubscribe_symbols(symbols: list):
    tokens = []
    for sym in symbols:
        t = _instrument_map.get(sym)
        if t:
            tokens.append(t)
            _subscribed_tokens.discard(t)
    if tokens and _ws_ref[0]:
        try:
            _ws_ref[0].unsubscribe(tokens)
        except:
            pass


async def start_ticker():
    global _ticker_thread, _running
    if _running:
        logger.info("[TICKER] Already running")
        return
    await load_instruments()
    if not _instrument_map:
        logger.error("[TICKER] No instruments — not starting")
        return

    # Pre-subscribe open positions
    try:
        from algo_scheduler import get_open_positions
        positions = await get_open_positions()
        for p in positions:
            t = _instrument_map.get(p["symbol"])
            if t:
                _subscribed_tokens.add(t)
    except:
        pass

    logger.info(f"[TICKER] Launching thread with {len(_subscribed_tokens)} pre-subscribed")
    _ticker_thread = threading.Thread(target=_run_ticker_thread, daemon=True)
    _ticker_thread.start()


async def stop_ticker():
    global _running
    _running = False
    if _ws_ref[0]:
        try:
            _ws_ref[0].close()
        except:
            pass
    logger.info("[TICKER] Stopped")
