#!/usr/bin/env python3
import ast, re, shutil, datetime
PATH = "/opt/dyor-backend/main.py"
shutil.copy(PATH, f"{PATH}.bak.{datetime.datetime.now():%Y%m%d_%H%M%S}")
src = open(PATH).read()
anchor = '@app.get("/api/health", tags=["System"])\nasync def health_check():'
assert anchor in src, "anchor not found"
start = src.index(anchor)
rest = src[start + len(anchor):]
m = re.search(r'\n@app\.|\n@router\.', rest)
end_rel = m.start() if m else len(rest)
old_block = src[start:start + len(anchor) + end_rel]
new_block = '''@app.get("/api/health", tags=["System"])
async def health_check():
    """Lightweight liveness — redis + db only, NO blocking external calls."""
    results = {}
    try:
        if redis_client:
            await redis_client.ping()
            results["redis"] = {"status": "ok"}
        else:
            results["redis"] = {"status": "error", "msg": "not connected"}
    except Exception:
        results["redis"] = {"status": "error", "msg": "ping failed"}
    try:
        async with db_pool.acquire() as conn:
            cnt = await conn.fetchval("SELECT COUNT(*) FROM users")
            results["database"] = {"status": "ok", "users": cnt}
    except Exception as e:
        results["database"] = {"status": "error", "msg": str(e)[:100]}
    ok = all(v.get("status") == "ok" for v in results.values())
    return {"status": "ok" if ok else "degraded", "checks": results}


@app.get("/api/health/full", tags=["System"])
async def health_check_full():
    """Full diagnostics — async httpx, short timeouts. NOT used by watchdog."""
    import httpx, time as _time
    results = {}
    try:
        if redis_client:
            await redis_client.ping(); results["redis"] = {"status": "ok"}
        else:
            results["redis"] = {"status": "error", "msg": "not connected"}
    except Exception:
        results["redis"] = {"status": "error", "msg": "ping failed"}
    try:
        async with db_pool.acquire() as conn:
            cnt = await conn.fetchval("SELECT COUNT(*) FROM users")
            results["database"] = {"status": "ok", "users": cnt}
    except Exception as e:
        results["database"] = {"status": "error", "msg": str(e)[:100]}
    async with httpx.AsyncClient(timeout=4) as client:
        for sym in ["RELIANCE", "NIFTY"]:
            try:
                r = await client.get(f"http://127.0.0.1:5004/data/equity/quote/{sym}")
                d = r.json()
                results[f"price_{sym}"] = {"status": "ok", "price": d.get("price"), "source": d.get("source")}
            except Exception as e:
                results[f"price_{sym}"] = {"status": "error", "msg": str(e)[:100]}
        try:
            r = await client.get("http://127.0.0.1:5001/api/shared/token/groww",
                                 headers={"x-shared-secret": "alphamarket-shared-2026"})
            d = r.json()
            expiry = d.get("expiry", 0)
            remaining_hrs = (expiry - _time.time()*1000) / 3600000 if expiry else 0
            results["groww_token"] = {"status": "ok" if remaining_hrs > 2 else "warn",
                                       "hours_remaining": round(remaining_hrs, 1)}
        except Exception as e:
            results["groww_token"] = {"status": "error", "msg": str(e)[:100]}
    return {"status": "ok", "checks": results}
'''
src = src.replace(old_block, new_block)
ast.parse(src)
open(PATH, "w").write(src)
print("HEALTH FIX v2 applied; syntax OK")
