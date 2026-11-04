"""services/ideas_cache.py - shared caches for Alpha Ideas and Alpha Conviction (4 Nov 2026).

swr(): serve the last build of a page instantly and rebuild it in the background once it is
older than `fresh` seconds (stale-while-revalidate). Live prices are applied on every request
by the caller, so only the slow part (scoring the universe, fundamentals) is cached.
af_bulk_cached(): fundamentals change once a quarter, so each symbol is kept for 30 minutes.
"""
import asyncio, copy, time

_SWR = {}
_BUSY = set()


def _forced():
    try:
        from refresh_ctx import force_refresh
        return bool(force_refresh.get())
    except Exception:
        return False


async def swr(key, builder, fresh=120, max_age=900):
    now = time.time()
    hit = _SWR.get(key)
    if hit and not _forced():
        age = now - hit[0]
        if age < fresh:
            return copy.deepcopy(hit[1])
        if age < max_age:
            if key not in _BUSY:
                _BUSY.add(key)

                async def _bg():
                    try:
                        _SWR[key] = (time.time(), await builder())
                    except Exception as e:
                        print(f"[ideas_cache] background rebuild {key[0]} failed: {e}")
                    finally:
                        _BUSY.discard(key)
                asyncio.create_task(_bg())
            return copy.deepcopy(hit[1])
    data = await builder()
    _SWR[key] = (time.time(), data)
    return copy.deepcopy(data)


_FUND = {}


async def af_bulk_cached(batch, ttl=1800):
    from services.data_service import af_bulk
    now = time.time()
    miss = [s for s in batch if not (s in _FUND and now - _FUND[s][0] < ttl)]
    if miss:
        try:
            bulk = await af_bulk(miss)
            if bulk and bulk.get("success"):
                got = set()
                for it in bulk.get("data", []) or []:
                    sym = it.get("symbol") if isinstance(it, dict) else None
                    if sym:
                        _FUND[sym] = (now, it)
                        got.add(sym)
                for s in miss:
                    if s not in got:
                        _FUND[s] = (now, None)
        except Exception as e:
            print(f"[ideas_cache] fundamentals error: {e}")
    return {"success": True, "data": [_FUND[s][1] for s in batch if s in _FUND and _FUND[s][1]]}
