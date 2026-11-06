"""
Live prices on DYOR's signal lists.

Alpha Intel (AlphaScore, Confluence, Smart Money) is scored from the screener universe,
which is refreshed every two hours, and its answers are cached for 30 minutes, so the price
shown could be hours old. Emerging Leaders comes from the data service's conviction list,
priced when that list was built. The scores stay as computed; only the price, the day's
change and what follows from the price (return since added, buy-zone flag, peak) are
replaced with the data service's current quote when the list is served. Target
upside figures are left as the model set them.

Each row gets price_live (true when the quote is a live tick, false when it is the last
close) so the page can say which it is showing.
"""
import asyncio
import json
import time
import urllib.request

DS = "http://127.0.0.1:5004/data/equity/quotes"
_cache = {}            # symbol -> (time, quote)
_CACHE_S = 20


def _fetch(symbols):
    out = {}
    for i in range(0, len(symbols), 50):
        try:
            req = urllib.request.Request(DS, data=json.dumps({"symbols": symbols[i:i + 50]}).encode(),
                                         headers={"Content-Type": "application/json"})
            d = json.loads(urllib.request.urlopen(req, timeout=12).read())
            for s, q in (d.get("quotes") or {}).items():
                if float(q.get("price") or 0) > 0:
                    out[s.upper()] = q
        except Exception:
            pass
    return out


async def quotes(symbols):
    now = time.time()
    want = [s for s in dict.fromkeys(x.upper() for x in symbols if x) if not (s in _cache and now - _cache[s][0] < _CACHE_S)]
    if want:
        got = await asyncio.to_thread(_fetch, want)
        for s, q in got.items():
            _cache[s] = (now, q)
    return {s: _cache[s][1] for s in (x.upper() for x in symbols if x) if s in _cache}


def _rows(o, out, depth=0):
    if depth > 5:
        return
    if isinstance(o, dict):
        if isinstance(o.get("symbol"), str) and ("price" in o or "current_price" in o):
            out.append(o)
        for v in o.values():
            if isinstance(v, (dict, list)):
                _rows(v, out, depth + 1)
    elif isinstance(o, list):
        for v in o:
            _rows(v, out, depth + 1)


async def live(resp):
    """Alpha Intel answers: replace price and change_pct with the current quote."""
    try:
        rows = []
        _rows(resp, rows)
        if not rows:
            return resp
        q = await quotes([r["symbol"] for r in rows])
        for r in rows:
            x = q.get(r["symbol"].upper())
            if not x:
                continue
            r["price"] = round(float(x["price"]), 2)
            if x.get("change_pct") is not None:
                r["change_pct"] = round(float(x["change_pct"]), 2)
            r["price_live"] = bool(x.get("is_live"))
            r["price_source"] = x.get("source")
    except Exception:
        pass
    return resp


async def emerging(resp):
    """Emerging Leaders: current price, return since added, buy-zone flag and peak."""
    try:
        ideas = (resp or {}).get("ideas") or []
        q = await quotes([i.get("symbol") for i in ideas])
        for i in ideas:
            x = q.get(str(i.get("symbol", "")).upper())
            if not x:
                continue
            p = round(float(x["price"]), 2)
            i["current_price"] = p
            i["price_live"] = bool(x.get("is_live"))
            i["price_source"] = x.get("source")
            added = float(i.get("added_price") or 0)
            if added > 0:
                i["return_pct"] = round((p / added - 1) * 100, 2)
                if p > float(i.get("peak_price") or 0):
                    i["peak_price"] = p
                    i["peak_return_pct"] = i["return_pct"]
            bz = i.get("buy_zone") or {}
            if bz.get("low") is not None and bz.get("high") is not None:
                i["in_buy_zone"] = float(bz["low"]) <= p <= float(bz["high"])
    except Exception:
        pass
    return resp
