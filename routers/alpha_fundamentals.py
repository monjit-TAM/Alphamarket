from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from services.data_service import (
    af_fundamentals, af_history, af_financials, af_bulk,
    af_screen, af_sectors, af_company, af_health
)

router = APIRouter(prefix="/api/alpha-fundamentals", tags=["Alpha Fundamentals"])

@router.get("/health", summary="Alpha Fundamentals API health")
async def fundamentals_health():
    return await af_health()

@router.get("/sectors/overview", summary="Sector-level aggregate ratios")
async def get_sector_overview():
    result = await af_sectors()
    if not result or not result.get("success"):
        raise HTTPException(502, "Alpha Fundamentals sectors unavailable")
    return result

@router.get("/screen/filter", summary="Screen stocks by fundamental criteria")
async def screen_fundamentals(
    pe_ttm_min: Optional[float] = None, pe_ttm_max: Optional[float] = None,
    pb_ratio_max: Optional[float] = None, roe_min: Optional[float] = None,
    roce_min: Optional[float] = None, debt_to_equity_max: Optional[float] = None,
    dividend_yield_min: Optional[float] = None, ebitda_margin_min: Optional[float] = None,
    net_margin_min: Optional[float] = None, revenue_growth_yoy_min: Optional[float] = None,
    pat_growth_yoy_min: Optional[float] = None, ev_ebitda_max: Optional[float] = None,
    market_cap_min: Optional[float] = None, market_cap_max: Optional[float] = None,
    current_ratio_min: Optional[float] = None,
    sort: Optional[str] = "roe", order: Optional[str] = "desc",
    limit: int = Query(50, ge=1, le=200),
):
    params = {"sort": sort, "order": order, "limit": limit}
    for name, val in [("pe_ttm_min", pe_ttm_min), ("pe_ttm_max", pe_ttm_max),
        ("pb_ratio_max", pb_ratio_max), ("roe_min", roe_min), ("roce_min", roce_min),
        ("debt_to_equity_max", debt_to_equity_max), ("dividend_yield_min", dividend_yield_min),
        ("ebitda_margin_min", ebitda_margin_min), ("net_margin_min", net_margin_min),
        ("revenue_growth_yoy_min", revenue_growth_yoy_min), ("pat_growth_yoy_min", pat_growth_yoy_min),
        ("ev_ebitda_max", ev_ebitda_max), ("market_cap_min", market_cap_min),
        ("market_cap_max", market_cap_max), ("current_ratio_min", current_ratio_min)]:
        if val is not None:
            params[name] = val
    result = await af_screen(params)
    if not result or not result.get("success"):
        raise HTTPException(502, "Alpha Fundamentals screening unavailable")
    return result

@router.get("/bulk/get", summary="Bulk fundamental lookup")
async def get_bulk_fundamentals_get(symbols: str = Query(..., description="Comma-separated symbols")):
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not sym_list or len(sym_list) > 50:
        raise HTTPException(400, "Provide 1-50 comma-separated symbols")
    result = await af_bulk(sym_list)
    if not result or not result.get("success"):
        raise HTTPException(502, "Alpha Fundamentals API unavailable")
    return result

@router.get("/{symbol}", summary="Full fundamental profile")
async def get_fundamentals(symbol: str):
    result = await af_fundamentals(symbol.upper())
    if not result or not result.get("success"):
        raise HTTPException(404, f"No fundamental data for {symbol}")
    return result

@router.get("/{symbol}/history", summary="Historical quarterly ratios")
async def get_fundamentals_history(symbol: str, limit: int = Query(8, ge=1, le=12)):
    result = await af_history(symbol.upper(), limit=limit)
    if not result or not result.get("success"):
        raise HTTPException(404, f"No historical data for {symbol}")
    return result

@router.get("/{symbol}/financials", summary="Raw quarterly financials")
async def get_financials(symbol: str, limit: int = Query(8, ge=1, le=12)):
    result = await af_financials(symbol.upper(), limit=limit)
    if not result or not result.get("success"):
        raise HTTPException(404, f"No financial statements for {symbol}")
    return result

@router.get("/{symbol}/company", summary="Company master data")
async def get_company(symbol: str):
    result = await af_company(symbol.upper())
    if not result or not result.get("success"):
        raise HTTPException(404, f"Company not found: {symbol}")
    return result
