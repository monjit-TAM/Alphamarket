"""
Kite WebSocket Ticker — Real-time tick-by-tick prices for algo positions.
"""
import json, logging, threading, time
from datetime import datetime
from typing import Dict, Set

logger = logging.getLogger("kite_ticker")
logging.basicConfig(level=logging.INFO)

KITE_API_KEY = "wmwpq34kw5th0y2l"

_live_prices: Dict[str, dict] = {}
_instrument_map: Dict[str, int] = {}
_reverse_map: Dict[int, str] = {}
_subscribed_tokens: Set[int] = set()
_pending_subscribe: list = []
_ws_ref = [None]
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


def _load_instruments_sync():
    global _instrument_map, _reverse_map
    import urllib.request
    token = _get_access_token_sync()
    if not token:
        print("[TICKER] No access token for instruments")
        return
    req = urllib.request.Request(
        "https://api.kite.trade/instruments/NSE",
        headers={"Authorization": f"token {KITE_API_KEY}:{token}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode()
        lines = text.strip().split("\n")
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
        print(f"[TICKER] Loaded {len(_instrument_map)} instruments")
    except Exception as e:
        print(f"[TICKER] Instrument load error: {e}")


def _run_ticker():
    global _running, _ws_ref
    from kiteconnect import KiteTicker

    print("[TICKER] Loading instruments...")
    _load_instruments_sync()
    if not _instrument_map:
        print("[TICKER] No instruments — aborting")
        return

    token = _get_access_token_sync()
    if not token:
        print("[TICKER] No access token — aborting")
        return

    kws = KiteTicker(KITE_API_KEY, token)

    def on_connect(ws, response):
        _ws_ref[0] = ws
        _running_set = True
        print(f"[TICKER] WebSocket CONNECTED")
        # Subscribe any pre-queued + pending tokens
        all_tokens = list(_subscribed_tokens) + list(_pending_subscribe)
        _pending_subscribe.clear()
        if all_tokens:
            unique = list(set(all_tokens))
            ws.subscribe(unique)
            ws.set_mode(ws.MODE_LTP, unique)
            _subscribed_tokens.update(unique)
            print(f"[TICKER] Subscribed {len(unique)} tokens")

    def on_ticks(ws, ticks):
        for tick in ticks:
            tok = tick.get("instrument_token")
            sym = _reverse_map.get(tok)
            if sym:
                _live_prices[sym] = {
                    "price": tick.get("last_price", 0),
                    "timestamp": datetime.now().isoformat(),
                }

    def on_close(ws, code, reason):
        global _running
        print(f"[TICKER] WebSocket closed: {code} {reason}")
        _running = False

    def on_error(ws, code, reason):
        print(f"[TICKER] WebSocket error: {code} {reason}")

    kws.on_connect = on_connect
    kws.on_ticks = on_ticks
    kws.on_close = on_close
    kws.on_error = on_error

    _running = True
    print("[TICKER] Connecting WebSocket...")
    kws.connect(threaded=True)

    # Keep alive + process pending subscriptions
    while _running:
        time.sleep(2)
        if _pending_subscribe and _ws_ref[0]:
            try:
                tokens = list(set(_pending_subscribe))
                _pending_subscribe.clear()
                _ws_ref[0].subscribe(tokens)
                _ws_ref[0].set_mode(_ws_ref[0].MODE_LTP, tokens)
                _subscribed_tokens.update(tokens)
                print(f"[TICKER] Late-subscribed {len(tokens)} tokens")
            except Exception as e:
                print(f"[TICKER] Subscribe error: {e}")


def queue_subscribe(symbols: list):
    """Queue symbols for subscription (thread-safe)."""
    global _pending_subscribe
    for sym in symbols:
        t = _instrument_map.get(sym)
        if t:
            _pending_subscribe.append(t)
            _subscribed_tokens.add(t)
    if symbols:
        print(f"[TICKER] Queued {len(symbols)}: {symbols[:5]}")


# Async wrappers for FastAPI
async def subscribe_symbols(symbols: list):
    queue_subscribe(symbols)

async def load_instruments():
    _load_instruments_sync()

async def start_ticker():
    global _running
    if _running:
        return
    t = threading.Thread(target=_run_ticker, daemon=True)
    t.start()
    print("[TICKER] Thread launched")

async def stop_ticker():
    global _running
    _running = False
    if _ws_ref[0]:
        try:
            _ws_ref[0].close()
        except:
            pass
