#!/usr/bin/env python3
"""
AlphaMarket Cache Warmer
Runs pre-market (8:15 AM IST) and post-market (3:45 PM IST) via cron.
Warms: sb_universe, sb_universe_enriched, all 34 screener strategies.
Usage: python3 /opt/dyor-backend/warm_cache.py
"""
import sys, time, json
import urllib.request

BASE = "http://127.0.0.1:8001"

def call(path, method="POST", timeout=600):
    try:
        req = urllib.request.Request(
            f"{BASE}{path}",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method=method
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}

def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S IST")
    print(f"[{ts}] {msg}", flush=True)

if __name__ == "__main__":
    log("=" * 60)
    log("AlphaMarket Cache Warmer starting...")

    # Step 1: Check health
    health = call("/api/health", method="GET")
    if health.get("status") != "ok":
        log(f"WARNING: Health check failed: {health}")
    else:
        log("Health check OK")

    # Step 2: Warm all caches via internal endpoint
    log("Triggering full warm via /api/internal/warm-all...")
    t0 = time.time()
    result = call("/api/internal/warm-all")
    elapsed = round(time.time() - t0, 1)

    if result.get("status") == "ok":
        r = result.get("results", {})
        log(f"sb_universe: {r.get('sb_universe', 'N/A')} stocks")
        log(f"sb_universe_enriched: {r.get('sb_universe_enriched', 'N/A')} stocks")
        log(f"strategies_warmed: {r.get('strategies_warmed', 0)}/34")
        log(f"Full warm complete in {elapsed}s")
    else:
        log(f"Warm failed: {result}")
        sys.exit(1)

    log("Cache warm complete.")
    log("=" * 60)
