#!/usr/bin/env python3
import ast, shutil, datetime
PATH = "/opt/dyor-backend/routers/arbitrage.py"
shutil.copy(PATH, f"{PATH}.bak.{datetime.datetime.now():%Y%m%d_%H%M%S}")
src = open(PATH).read()

old = '''    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())
        if data.get("status") == "success":
            return data["data"]
        return {}'''
new = '''    req = urllib.request.Request(url, headers=headers)
    try:
        # FIX: run blocking urllib in a thread pool so it never blocks the event loop.
        import asyncio as _asyncio
        loop = _asyncio.get_event_loop()
        def _blocking_fetch():
            r = urllib.request.urlopen(req, timeout=6)
            return r.read().decode()
        raw = await loop.run_in_executor(None, _blocking_fetch)
        data = json.loads(raw)
        if data.get("status") == "success":
            return data["data"]
        return {}'''
assert old in src, "anchor not found"
src = src.replace(old, new, 1)
ast.parse(src)
open(PATH, "w").write(src)
print("KITE BLOCKING FIX applied; syntax OK")
