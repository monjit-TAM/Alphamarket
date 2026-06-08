"""
Kite WebSocket Ticker — Real-time price feed for algo positions.

Subscribes to symbols of open algo positions via Kite WebSocket.
Stores live prices in memory dict. Exit monitor reads from here
instead of HTTP calls — eliminates network latency entirely.

Flow:
  1. On startup, fetches Kite instrument list (symbol → token mapping)
  2. Connects WebSocket to Kite
  3. Subscribes to symbols of all open algo positions
  4. On tick, updates price dict + checks exit conditions immediately
  5. Re-subscribes when new positions open / old ones close
"""
import asyncio, json, logging, threading, time
from datetime import datetime
from typing import Dict, Set, Optional

logger = logging.getLogger("kite_ticker")

KITE_API_KEY = "wmwpq34kw5th0y2l"
DB_URL = "postgresql://dyor_user:DyorSecure2026Mar@localhost/dyor_db"

# ═══ Global state ═══
_live_prices: Dict[str, dict] = {}  # {symbol: {price, high, low, volume, timestamp}}
_instrument_map: Dict[str, int] = {}  # {symbol: instrument_token}
_subscribed_tokens: Set[int] = set()
_ticker = None
_ticker_thread = None
_running = False


def get_live_price(symbol: str) -> float:
    """Get live price from memory — O(1), no network call."""
    data = _live_prices.get(symbol)
    return data["price"] if data else 0


def get_all_live_prices() -> Dict[str, dict]:
    """Get all tracked prices."""
    return dict(_live_prices)


async def _get_access_token() -> str:
    """Fetch Kite access token from PostgreSQL."""
    import asyncpg
    conn = await asyncpg.connect(DB_URL)
    try:
        row = await conn.fetchrow("SELECT value FROM api_settings WHERE key='kite_token'")
        if row:
            data = json.loads(row["value"])
            return data.get("access_token", "")
        return ""
    finally:
        await conn.close()


def _get_access_token_sync() -> str:
    """Sync version for the ticker thread."""
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
    """Load NSE instrument token mapping from Kite."""
    global _instrument_map
    import httpx
    token = await _get_access_token()
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
                for line in lines[1:]:
                    parts = line.split(",")
                    if len(parts) > max(token_idx, sym_idx):
                        _instrument_map[parts[sym_idx]] = int(parts[token_idx])
                
                logger.info(f"[TICKER] Loaded {len(_instrument_map)} NSE instruments")
            else:
                logger.error(f"[TICKER] Instrument fetch failed: {r.status_code}")
    except Exception as e:
        logger.error(f"[TICKER] Instrument load error: {e}")


def _run_ticker_thread():
    """Run KiteTicker in a dedicated thread (blocking WebSocket)."""
    global _ticker, _running
    from kiteconnect import KiteTicker
    
    access_token = _get_access_token_sync()
    if not access_token:
        logger.error("[TICKER] No access token — cannot start")
        return
    
    _ticker = KiteTicker(KITE_API_KEY, access_token)
    
    def on_connect(ws, response):
        logger.info("[TICKER] WebSocket connected")
        if _subscribed_tokens:
            ws.subscribe(list(_subscribed_tokens))
            ws.set_mode(ws.MODE_LTP, list(_subscribed_tokens))
            logger.info(f"[TICKER] Subscribed to {len(_subscribed_tokens)} tokens")
    
    def on_ticks(ws, ticks):
        for tick in ticks:
            token = tick.get("instrument_token")
            # Reverse lookup symbol
            sym = None
            for s, t in _instrument_map.items():
                if t == token:
                    sym = s
                    break
            if sym:
                _live_prices[sym] = {
                    "price": tick.get("last_price", 0),
                    "high": tick.get("ohlc", {}).get("high", 0),
                    "low": tick.get("ohlc", {}).get("low", 0),
                    "volume": tick.get("volume_traded", 0),
                    "timestamp": datetime.now().isoformat(),
                }
    
    def on_close(ws, code, reason):
        logger.warning(f"[TICKER] WebSocket closed: {code} {reason}")
        _running = False
    
    def on_error(ws, code, reason):
        logger.error(f"[TICKER] WebSocket error: {code} {reason}")
    
    _ticker.on_connect = on_connect
    _ticker.on_ticks = on_ticks
    _ticker.on_close = on_close
    _ticker.on_error = on_error
    
    _running = True
    logger.info("[TICKER] Starting WebSocket...")
    _ticker.connect(threaded=False)


async def subscribe_symbols(symbols: list):
    """Subscribe to new symbols for live prices."""
    global _subscribed_tokens
    tokens = []
    for sym in symbols:
        t = _instrument_map.get(sym)
        if t:
            tokens.append(t)
            _subscribed_tokens.add(t)
    
    if tokens and _ticker and _running:
        try:
            _ticker.subscribe(tokens)
            _ticker.set_mode(_ticker.MODE_LTP, tokens)
            logger.info(f"[TICKER] Subscribed to {len(tokens)} new symbols: {symbols}")
        except Exception as e:
            logger.error(f"[TICKER] Subscribe error: {e}")


async def unsubscribe_symbols(symbols: list):
    """Unsubscribe from symbols no longer needed."""
    global _subscribed_tokens
    tokens = []
    for sym in symbols:
        t = _instrument_map.get(sym)
        if t:
            tokens.append(t)
            _subscribed_tokens.discard(t)
    
    if tokens and _ticker and _running:
        try:
            _ticker.unsubscribe(tokens)
            logger.info(f"[TICKER] Unsubscribed {len(tokens)} symbols")
        except:
            pass


async def start_ticker():
    """Start the WebSocket ticker in a background thread."""
    global _ticker_thread, _running
    
    if _running:
        logger.info("[TICKER] Already running")
        return
    
    # Load instruments first
    await load_instruments()
    if not _instrument_map:
        logger.error("[TICKER] No instruments loaded — ticker not started")
        return
    
    # Load current open positions and subscribe
    from algo_scheduler import get_open_positions
    positions = await get_open_positions()
    symbols = list(set(p["symbol"] for p in positions))
    
    for sym in symbols:
        t = _instrument_map.get(sym)
        if t:
            _subscribed_tokens.add(t)
    
    logger.info(f"[TICKER] Starting with {len(_subscribed_tokens)} symbols: {symbols}")
    
    _ticker_thread = threading.Thread(target=_run_ticker_thread, daemon=True)
    _ticker_thread.start()


async def stop_ticker():
    """Stop the WebSocket ticker."""
    global _running, _ticker
    _running = False
    if _ticker:
        try:
            _ticker.close()
        except:
            pass
    logger.info("[TICKER] Stopped")
