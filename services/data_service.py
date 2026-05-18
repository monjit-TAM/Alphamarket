import httpx
import pandas as pd
import numpy as np
import asyncio
import json
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any

DATA_SERVICE_URL = "https://data.alphamarket.co.in"
DATA_SERVICE_KEY = "alpha_data_internal_2026"
_HEADERS = {"X-API-Key": DATA_SERVICE_KEY}
_TIMEOUT = httpx.Timeout(25.0, connect=10.0)

ALPHA_FUNDAMENTALS_URL = "http://localhost:5015"
_AF_TIMEOUT = httpx.Timeout(15.0, connect=5.0)

_client: Optional[httpx.AsyncClient] = None
_af_client: Optional[httpx.AsyncClient] = None

async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(base_url=DATA_SERVICE_URL, headers=_HEADERS, timeout=_TIMEOUT, verify=True)
    return _client

async def get_af_client() -> httpx.AsyncClient:
    global _af_client
    if _af_client is None or _af_client.is_closed:
        _af_client = httpx.AsyncClient(base_url=ALPHA_FUNDAMENTALS_URL, timeout=_AF_TIMEOUT)
    return _af_client

async def close_client():
    global _client, _af_client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None
    if _af_client and not _af_client.is_closed:
        await _af_client.aclose()
        _af_client = None

async def af_fundamentals(symbol: str) -> dict:
    client = await get_af_client()
    try:
        resp = await client.get(f"/api/fundamentals/{symbol.upper()}")
        resp.raise_for_status()
        result = resp.json()
        if result.get("success") and result.get("data"):
            return result
        return {}
    except Exception as e:
        print(f"[AlphaFundamentals] Error for {symbol}: {e}")
        return {}

async def af_history(symbol: str, limit: int = 8) -> dict:
    client = await get_af_client()
    try:
        resp = await client.get(f"/api/fundamentals/{symbol.upper()}/history", params={"limit": limit})
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[AlphaFundamentals] History error for {symbol}: {e}")
        return {}

async def af_financials(symbol: str, limit: int = 8) -> dict:
    client = await get_af_client()
    try:
        resp = await client.get(f"/api/fundamentals/{symbol.upper()}/financials", params={"limit": limit})
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[AlphaFundamentals] Financials error for {symbol}: {e}")
        return {}

async def af_bulk(symbols: list) -> dict:
    client = await get_af_client()
    try:
        syms = ",".join(s.upper() for s in symbols)
        resp = await client.get("/api/fundamentals/bulk", params={"symbols": syms})
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[AlphaFundamentals] Bulk error: {e}")
        return {}

async def af_screen(params: dict) -> dict:
    client = await get_af_client()
    try:
        resp = await client.get("/api/fundamentals/screen", params=params)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[AlphaFundamentals] Screen error: {e}")
        return {}

async def af_sectors() -> dict:
    client = await get_af_client()
    try:
        resp = await client.get("/api/fundamentals/sectors")
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[AlphaFundamentals] Sectors error: {e}")
        return {}

async def af_company(symbol: str) -> dict:
    client = await get_af_client()
    try:
        resp = await client.get(f"/api/fundamentals/company/{symbol.upper()}")
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[AlphaFundamentals] Company error for {symbol}: {e}")
        return {}

async def af_health() -> dict:
    client = await get_af_client()
    try:
        resp = await client.get("/api/health")
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[AlphaFundamentals] Health check failed: {e}")
        return {"status": "unavailable", "error": str(e)}

def _af_to_ds_format(af_resp: dict) -> dict:
    if not af_resp or not af_resp.get("success"):
        return {}
    company = af_resp.get("company", {})
    data = af_resp.get("data", {})
    symbol = af_resp.get("symbol", "")
    return {
        "symbol": symbol,
        "name": company.get("company_name", symbol),
        "sector": company.get("sector", ""),
        "industry": company.get("industry", ""),
        "market_cap_category": company.get("market_cap_category", ""),
        "market_cap": data.get("market_cap"),
        "pe_trailing": data.get("pe_ttm"), "pe_ratio": data.get("pe_ttm"),
        "pe_forward": None,
        "pb": data.get("pb_ratio"), "pb_ratio": data.get("pb_ratio"),
        "ps": None, "ev_ebitda": data.get("ev_ebitda"),
        "peg": data.get("peg_ratio"),
        "earnings_yield": data.get("earnings_yield"),
        "fcf_yield": data.get("fcf_yield"),
        "ev_sales": data.get("ev_sales"), "ev_ebit": data.get("ev_ebit"),
        "roe": data.get("roe"), "roce": data.get("roce"), "roa": data.get("roa"),
        "profit_margin": data.get("net_margin"), "net_margin": data.get("net_margin"),
        "operating_margin": data.get("ebitda_margin"), "ebitda_margin": data.get("ebitda_margin"),
        "gross_margin": data.get("gross_margin"),
        "revenue_growth": data.get("revenue_growth_yoy"),
        "earnings_growth": data.get("pat_growth_yoy"),
        "eps_growth": data.get("eps_growth_yoy"),
        "ebitda_growth": data.get("ebitda_growth_yoy"),
        "debt_equity": data.get("debt_to_equity"), "debt_to_equity": data.get("debt_to_equity"),
        "current_ratio": data.get("current_ratio"),
        "interest_coverage": data.get("interest_coverage"),
        "quick_ratio": data.get("quick_ratio"),
        "debt_to_ebitda": data.get("debt_to_ebitda"),
        "dividend_yield": data.get("dividend_yield"),
        "dividend_payout": data.get("dividend_payout"),
        "fcf_margin": data.get("fcf_margin"),
        "cfo_to_pat": data.get("cfo_to_pat"),
        "capex_to_revenue": data.get("capex_to_revenue"),
        "asset_turnover": data.get("asset_turnover"),
        "inventory_days": data.get("inventory_days"),
        "receivable_days": data.get("receivable_days"),
        "payable_days": data.get("payable_days"),
        "cash_conversion_cycle": data.get("cash_conversion_cycle"),
        "_source": "alpha_fundamentals",
    }

async def ds_ohlcv(symbol, start, end, interval="1d"):
    client = await get_client()
    params = {"start": start, "end": end, "interval": interval}
    try:
        resp = await client.get(f"/data/equity/ohlcv/{symbol.upper()}", params=params)
        resp.raise_for_status()
        data = resp.json()
        rows = data.get("data") or data.get("prices") or data.get("ohlcv") or []
        if not rows:
            return pd.DataFrame()
        df = pd.DataFrame(rows)
        df.columns = [c.lower() for c in df.columns]
        date_col = None
        for candidate in ["date", "datetime", "timestamp", "time"]:
            if candidate in df.columns:
                date_col = candidate
                break
        if date_col:
            df[date_col] = pd.to_datetime(df[date_col])
            df = df.set_index(date_col)
            df.index.name = "date"
        keep = [c for c in ["open", "high", "low", "close", "volume"] if c in df.columns]
        if keep:
            df = df[keep].copy()
        df = df.astype({c: float for c in df.columns})
        df = df.dropna()
        df = df.sort_index()
        return df
    except Exception as e:
        print(f"[DataService] OHLCV error for {symbol}: {e}")
        return pd.DataFrame()

async def ds_bulk_ohlcv(symbols, start, end, batch_size=20):
    result = {}
    async def fetch_one(sym):
        df = await ds_ohlcv(sym, start, end)
        if not df.empty:
            result[f"{sym.upper()}.NS"] = df
    for i in range(0, len(symbols), batch_size):
        batch = symbols[i:i + batch_size]
        clean = [s.replace(".NS", "").replace(".BO", "").upper() for s in batch]
        tasks = [fetch_one(s) for s in clean]
        await asyncio.gather(*tasks, return_exceptions=True)
    return result

async def ds_quote(symbol):
    client = await get_client()
    try:
        resp = await client.get(f"/data/equity/quote/{symbol.upper()}")
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[DataService] Quote error for {symbol}: {e}")
        return {}

async def ds_bulk_quotes(symbols):
    client = await get_client()
    clean = [s.replace(".NS", "").replace(".BO", "").upper() for s in symbols]
    try:
        resp = await client.post("/data/equity/quotes", json={"symbols": clean})
        resp.raise_for_status()
        data = resp.json()
        return data.get("quotes") or data if isinstance(data, list) else []
    except Exception as e:
        print(f"[DataService] Bulk quotes error: {e}")
        return []

async def ds_fundamentals(symbol):
    """Fetch fundamentals: Alpha Fundamentals (primary) -> Data Service -> Yahoo (fallback)"""
    sym = symbol.upper().replace(".NS", "").replace(".BO", "")
    try:
        af_resp = await af_fundamentals(sym)
        if af_resp and af_resp.get("success") and af_resp.get("data"):
            mapped = _af_to_ds_format(af_resp)
            if mapped.get("symbol"):
                print(f"[Fundamentals] {sym} served from Alpha Fundamentals")
                return mapped
    except Exception as e:
        print(f"[Fundamentals] Alpha Fundamentals failed for {sym}: {e}")
    client = await get_client()
    try:
        resp = await client.get(f"/data/equity/fundamentals/{sym}")
        resp.raise_for_status()
        data = resp.json()
        if data and data.get("symbol"):
            print(f"[Fundamentals] {sym} served from Data Service")
            return data
    except Exception as e:
        print(f"[Fundamentals] Data Service failed for {sym}: {e}")
    try:
        import yfinance as yf
        yf_sym = f"{sym}.NS"
        loop = asyncio.get_event_loop()
        ticker = yf.Ticker(yf_sym)
        info = await loop.run_in_executor(None, lambda: ticker.info)
        if info and info.get("regularMarketPrice"):
            print(f"[Fundamentals] {sym} served from Yahoo Finance (fallback)")
            return {
                "symbol": sym, "name": info.get("longName", sym),
                "sector": info.get("sector", ""), "industry": info.get("industry", ""),
                "market_cap": info.get("marketCap"),
                "pe_trailing": info.get("trailingPE"), "pe_ratio": info.get("trailingPE"),
                "pe_forward": info.get("forwardPE"),
                "pb": info.get("priceToBook"), "pb_ratio": info.get("priceToBook"),
                "ps": info.get("priceToSalesTrailing12Months"),
                "ev_ebitda": info.get("enterpriseToEbitda"),
                "peg": info.get("pegRatio"),
                "roe": info.get("returnOnEquity"), "roce": None,
                "roa": info.get("returnOnAssets"),
                "debt_equity": info.get("debtToEquity"), "debt_to_equity": info.get("debtToEquity"),
                "current_ratio": info.get("currentRatio"),
                "dividend_yield": info.get("dividendYield"),
                "profit_margin": info.get("profitMargins"), "net_margin": info.get("profitMargins"),
                "operating_margin": info.get("operatingMargins"), "ebitda_margin": None,
                "gross_margin": info.get("grossMargins"),
                "revenue_growth": info.get("revenueGrowth"),
                "earnings_growth": info.get("earningsGrowth"),
                "eps": info.get("trailingEps"),
                "price": info.get("regularMarketPrice") or info.get("currentPrice"),
                "current_price": info.get("regularMarketPrice") or info.get("currentPrice"),
                "book_value": info.get("bookValue"), "beta": info.get("beta"),
                "high_52w": info.get("fiftyTwoWeekHigh"), "low_52w": info.get("fiftyTwoWeekLow"),
                "avg_volume": info.get("averageVolume"),
                "shares_outstanding": info.get("sharesOutstanding"),
                "free_cashflow": info.get("freeCashflow"), "revenue": info.get("totalRevenue"),
                "interest_coverage": None, "quick_ratio": info.get("quickRatio"),
                "_source": "yahoo",
            }
    except Exception as e:
        print(f"[Fundamentals] Yahoo fallback failed for {sym}: {e}")
    return {}

async def ds_search(query):
    client = await get_client()
    try:
        resp = await client.get("/data/equity/search", params={"q": query})
        resp.raise_for_status()
        return resp.json().get("results", [])
    except Exception as e:
        print(f"[DataService] Search error: {e}")
        return []

async def ds_indices():
    client = await get_client()
    try:
        resp = await client.get("/data/market/indices")
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[DataService] Indices error: {e}")
        return {}
