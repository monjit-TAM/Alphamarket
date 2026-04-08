"""
Alpha Intelligence Router — AlphaScore™ + Confluence Engine™ + Smart Money Flow™
==================================================================================
Async FastAPI router using existing redis_client from main.py
"""
import json
import logging
from fastapi import APIRouter, HTTPException, Query, Request
from typing import Optional

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from alphascore import compute_alphascore, compute_alphascore_bulk, ALPHASCORE_INFO
from confluence_engine import compute_confluence, compute_confluence_bulk, CONFLUENCE_INFO
from flow_signals import compute_smart_money_score, compute_smart_money_bulk, FLOW_SIGNALS_INFO

logger = logging.getLogger("alpha_intelligence")

router = APIRouter(
    prefix="/api/alpha-intel",
    tags=["Alpha Intelligence"],
)

CACHE_TTL = 1800  # 30 min


async def _get_redis(request: Request):
    """Get async redis client from app state (set in main.py startup)."""
    # Access the global redis_client from main module
    import main
    return main.redis_client


async def _get_universe(request: Request) -> list:
    """Load sb_universe from Redis."""
    rc = await _get_redis(request)
    if not rc:
        raise HTTPException(503, "Redis not connected")
    raw = await rc.get("sb_universe_enriched") or await rc.get("sb_universe")
    if not raw:
        raise HTTPException(503, "sb_universe not cached. Run warm_cache_direct.py first.")
    return json.loads(raw)


async def _get_stock(request: Request, symbol: str) -> dict:
    """Get single stock from universe."""
    universe = await _get_universe(request)
    sym_upper = symbol.upper()
    for stock in universe:
        if stock.get("symbol", "").upper() == sym_upper:
            return stock
    raise HTTPException(404, f"Stock {symbol} not found in universe")


# ══════════════════════════════════════════════════════════════════════
# ALPHASCORE™
# ══════════════════════════════════════════════════════════════════════

@router.get("/alphascore/info")
async def alphascore_info():
    """AlphaScore™ methodology — 5 dimensions, 40+ factors, grading system, and usage guide. Powers the ⓘ tooltip in DYOR frontend."""
    return ALPHASCORE_INFO


@router.get("/alphascore/top")
async def alphascore_top(request: Request, n: int = Query(20, ge=1, le=100),
                         sector: Optional[str] = None, cap: Optional[str] = None):
    """Top N stocks ranked by AlphaScore™ (0-100 composite). Optional filters: sector (e.g. Energy, IT, Banking), cap (large/mid/small). Returns score, grade (A+ to F), signal, and 5 dimension breakdowns."""
    rc = await _get_redis(request)
    cache_key = f"alphascore_top_{n}_{sector}_{cap}"
    if rc:
        cached = await rc.get(cache_key)
        if cached:
            return json.loads(cached)

    universe = await _get_universe(request)
    results = compute_alphascore_bulk(universe)

    if sector:
        results = [r for r in results if r.get("sector", "").lower() == sector.lower()]
    if cap:
        results = [r for r in results if r.get("cap_segment", "").lower() == cap.lower()]

    response = {"count": min(n, len(results)), "stocks": results[:n]}
    if rc:
        await rc.setex(cache_key, CACHE_TTL, json.dumps(response))
    return response


@router.get("/alphascore/bulk")
async def alphascore_bulk(request: Request):
    """All 920 NSE stocks ranked by AlphaScore™. Cached 30 min. Returns complete dimension breakdown (Technical, Fundamental, Ownership, Momentum, Risk-Alpha) for every stock."""
    rc = await _get_redis(request)
    if rc:
        cached = await rc.get("alphascore_bulk")
        if cached:
            return json.loads(cached)
    universe = await _get_universe(request)
    results = compute_alphascore_bulk(universe)
    response = {"count": len(results), "stocks": results}
    if rc:
        await rc.setex("alphascore_bulk", CACHE_TTL, json.dumps(response))
    return response


@router.get("/alphascore/{symbol}")
async def alphascore_single(request: Request, symbol: str):
    """Compute AlphaScore™ for a single stock. Returns 0-100 score, grade (A+/A/B+/B/C/D/F), signal (STRONG_BUY to AVOID), and per-dimension scores."""
    data = await _get_stock(request, symbol)
    return compute_alphascore(symbol.upper(), data)


# ══════════════════════════════════════════════════════════════════════
# CONFLUENCE ENGINE™
# ══════════════════════════════════════════════════════════════════════

@router.get("/confluence/info")
async def confluence_info():
    """Confluence Engine™ methodology — 22 signals, 16 backtested combinations, conviction levels, and usage guide."""
    return CONFLUENCE_INFO


@router.get("/confluence/top")
async def confluence_top(request: Request, n: int = Query(20, ge=1, le=100)):
    """Top N stocks by cross-signal conviction probability. Shows active signals, backtested combination match (hit rate, avg return, sample size), estimated return, holding period, and conviction level (VERY_HIGH to VERY_LOW)."""
    rc = await _get_redis(request)
    if rc:
        cached = await rc.get(f"confluence_top_{n}")
        if cached:
            return json.loads(cached)
    universe = await _get_universe(request)
    results = compute_confluence_bulk(universe)
    response = {"count": min(n, len(results)), "stocks": results[:n]}
    if rc:
        await rc.setex(f"confluence_top_{n}", CACHE_TTL, json.dumps(response))
    return response


@router.get("/confluence/bulk")
async def confluence_bulk(request: Request):
    """All stocks with 1+ active confluence signals. Sorted by probability descending. Each result includes signal details, category diversity, and backtested pattern match if available."""
    rc = await _get_redis(request)
    if rc:
        cached = await rc.get("confluence_bulk")
        if cached:
            return json.loads(cached)
    universe = await _get_universe(request)
    results = compute_confluence_bulk(universe)
    response = {"count": len(results), "stocks": results}
    if rc:
        await rc.setex("confluence_bulk", CACHE_TTL, json.dumps(response))
    return response


@router.get("/confluence/{symbol}")
async def confluence_single(request: Request, symbol: str):
    """Full confluence analysis for a single stock. Detects all 22 signals, checks against 16 backtested combination patterns, computes conviction probability with category diversity bonus."""
    data = await _get_stock(request, symbol)
    return compute_confluence(symbol.upper(), data)


# ══════════════════════════════════════════════════════════════════════
# SMART MONEY FLOW™
# ══════════════════════════════════════════════════════════════════════

@router.get("/smart-money/info")
async def smart_money_info():
    """Smart Money Flow™ methodology — 6 components (Accumulation, Minervini, Volume Quality, Fundamental, Momentum, Trend), verdicts, and usage guide."""
    return FLOW_SIGNALS_INFO


@router.get("/smart-money/top")
async def smart_money_top(request: Request, n: int = Query(20, ge=1, le=100)):
    """Top N stocks by Smart Money Accumulation Score (0-100). Shows 6 component scores, human-readable positive signals and risk flags, verdict (STRONG_ACCUMULATION to STRONG_DISTRIBUTION)."""
    rc = await _get_redis(request)
    if rc:
        cached = await rc.get(f"smart_money_top_{n}")
        if cached:
            return json.loads(cached)
    universe = await _get_universe(request)
    results = compute_smart_money_bulk(universe)
    response = {"count": min(n, len(results)), "stocks": results[:n]}
    if rc:
        await rc.setex(f"smart_money_top_{n}", CACHE_TTL, json.dumps(response))
    return response


@router.get("/smart-money/bulk")
async def smart_money_bulk(request: Request):
    """All 920 stocks ranked by Smart Money Flow™ score. Includes component breakdown, institutional signal narratives, and risk flags for each stock."""
    rc = await _get_redis(request)
    if rc:
        cached = await rc.get("smart_money_bulk")
        if cached:
            return json.loads(cached)
    universe = await _get_universe(request)
    results = compute_smart_money_bulk(universe)
    response = {"count": len(results), "stocks": results}
    if rc:
        await rc.setex("smart_money_bulk", CACHE_TTL, json.dumps(response))
    return response


@router.get("/smart-money/{symbol}")
async def smart_money_single(request: Request, symbol: str):
    """Smart Money Flow™ analysis for a single stock. Returns 0-100 score, 6 component scores, positive institutional signals, and risk flags with human-readable explanations."""
    data = await _get_stock(request, symbol)
    return compute_smart_money_score(symbol.upper(), data)


# ══════════════════════════════════════════════════════════════════════
# COMBINED ALPHA INTELLIGENCE
# ══════════════════════════════════════════════════════════════════════

@router.get("/info")
async def all_info():
    """Combined methodology info for all 3 engines — AlphaScore™, Confluence Engine™, and Smart Money Flow™. Used by frontend ⓘ info modals."""
    return {"alphascore": ALPHASCORE_INFO, "confluence": CONFLUENCE_INFO, "smart_money": FLOW_SIGNALS_INFO}


@router.get("/dashboard")
async def dashboard(request: Request, n: int = Query(10, ge=1, le=50)):
    """Alpha Intelligence Dashboard — top N stocks across all 3 engines in a single call. Ideal for overview screens and combined analysis."""
    universe = await _get_universe(request)
    return {
        "alphascore_top": compute_alphascore_bulk(universe)[:n],
        "confluence_top": compute_confluence_bulk(universe)[:n],
        "smart_money_top": compute_smart_money_bulk(universe)[:n],
    }


@router.get("/{symbol}")
async def combined_single(request: Request, symbol: str):
    """Combined Alpha Intelligence view for a single stock — AlphaScore™ + Confluence Engine™ + Smart Money Flow™ in one API call. The most comprehensive analysis endpoint."""
    data = await _get_stock(request, symbol)
    sym = symbol.upper()
    return {
        "symbol": sym,
        "alphascore": compute_alphascore(sym, data),
        "confluence": compute_confluence(sym, data),
        "smart_money": compute_smart_money_score(sym, data),
    }
