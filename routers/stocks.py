"""
AlphaForge — Stocks Router
GET /api/stocks/instruments — All NSE/BSE/MCX instruments
GET /api/stocks/search      — Search stocks
GET /api/stocks/ltp         — Live prices for symbols
GET /api/stocks/quote/{sym} — Full quote
GET /api/stocks/history     — Historical OHLCV
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from typing import List, Optional
from datetime import datetime, timedelta

from core.auth import get_current_user
from models.user import User
from services.groww_service import GrowwService

router = APIRouter()
_groww = GrowwService()


@router.get("/instruments")
async def get_all_instruments(
    exchange: str = Query("ALL", description="NSE | BSE | MCX | ALL"),
    segment: str = Query("ALL", description="CASH | FNO | COMMODITY | ALL"),
    current_user: User = Depends(get_current_user),
):
    """
    Returns the full list of tradeable instruments from Groww.
    Covers 4000+ NSE equities, BSE equities, F&O, and MCX commodities.
    Results are cached for 24 hours.
    """
    instruments = await _groww.get_all_instruments()

    if exchange != "ALL":
        instruments = [i for i in instruments if i["exchange"] == exchange.upper()]
    if segment != "ALL":
        instruments = [i for i in instruments if i.get("segment", "CASH") == segment.upper()]

    return {
        "count": len(instruments),
        "exchange_filter": exchange,
        "instruments": instruments,
    }


@router.get("/search")
async def search_stocks(
    q: str = Query(..., min_length=1, description="Symbol or company name"),
    exchange: str = Query("ALL"),
    current_user: User = Depends(get_current_user),
):
    """Search stocks by symbol or company name"""
    results = await _groww.search_instruments(q, exchange)
    return {"results": results, "count": len(results)}


@router.get("/ltp")
async def get_ltp(
    symbols: str = Query(..., description="Comma-separated symbols e.g. RELIANCE,TCS,INFY"),
    exchange: str = Query("NSE"),
    current_user: User = Depends(get_current_user),
):
    """Get Last Traded Price for one or more symbols. Cached for 5 seconds."""
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if len(symbol_list) > 500:
        raise HTTPException(status_code=400, detail="Maximum 500 symbols per request")

    prices = await _groww.get_ltp(symbol_list, exchange)
    return {"prices": prices, "timestamp": datetime.utcnow().isoformat()}


@router.get("/quote/{symbol}")
async def get_quote(
    symbol: str,
    exchange: str = Query("NSE"),
    current_user: User = Depends(get_current_user),
):
    """Get full market quote with OHLC, volume, and order book depth"""
    quote = await _groww.get_quote(symbol.upper(), exchange)
    if not quote:
        raise HTTPException(status_code=404, detail=f"Quote not found for {symbol}")
    return quote


@router.get("/history/{symbol}")
async def get_history(
    symbol: str,
    exchange: str = Query("NSE"),
    interval: str = Query("1d", description="1m | 5m | 15m | 30m | 1h | 1d | 1w"),
    from_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    days: int = Query(365, description="Number of days (used if from_date not provided)"),
    current_user: User = Depends(get_current_user),
):
    """
    Fetch historical OHLCV data for a single symbol.
    Used for charting and backtesting in the frontend.
    """
    fd = datetime.strptime(from_date, "%Y-%m-%d") if from_date else datetime.utcnow() - timedelta(days=days)
    td = datetime.strptime(to_date, "%Y-%m-%d") if to_date else datetime.utcnow()

    df = await _groww.get_historical_data(
        symbol=symbol.upper(),
        exchange=exchange,
        interval=interval,
        from_date=fd,
        to_date=td,
    )

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No data found for {symbol}")

    return {
        "symbol": symbol.upper(),
        "exchange": exchange,
        "interval": interval,
        "count": len(df),
        "candles": df.to_dict("records"),
    }


@router.get("/indices")
async def get_indices(current_user: User = Depends(get_current_user)):
    """Get current values of major Indian indices"""
    indices = ["NIFTY 50", "NIFTY BANK", "SENSEX", "NIFTY IT", "NIFTY PHARMA",
               "NIFTY FMCG", "NIFTY AUTO", "NIFTY METAL", "NIFTY REALTY", "INDIA VIX"]
    # Fetch from Groww
    prices = await _groww.get_ltp(indices, "NSE")
    return {"indices": prices}
