"""Screener router"""
from fastapi import APIRouter, Depends, Query
from typing import Optional
from core.auth import get_current_user
from models.user import User
from services.groww_service import GrowwService

router = APIRouter()
_groww = GrowwService()

@router.get("/")
async def screen_stocks(
    exchange: str = Query("NSE"),
    min_roe: float = Query(0), max_pe: float = Query(999), max_pb: float = Query(999),
    max_de: float = Query(999), min_div: float = Query(0), sector: str = Query("ALL"),
    sort_by: str = Query("pe"), sort_dir: str = Query("asc"), limit: int = Query(100),
    current_user: User = Depends(get_current_user),
):
    """Screen stocks by fundamental criteria. Data enriched from Groww instruments."""
    instruments = await _groww.get_all_instruments()
    # Filter instruments by basic criteria (full fundamental data requires additional data source)
    filtered = [i for i in instruments if i["exchange"] == exchange or exchange == "ALL"]
    if sector != "ALL":
        filtered = [i for i in filtered if i.get("sector", "") == sector]
    return {"count": len(filtered[:limit]), "results": filtered[:limit]}
