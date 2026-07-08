from fastapi import FastAPI, HTTPException, Depends, status, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import asyncpg
import redis.asyncio as aioredis
import os
import json
import logging
logger = logging.getLogger("dyor")
import hashlib
import secrets
import jwt
import asyncio
import pandas as pd
import numpy as np
from core.config import settings

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY = settings.SECRET_KEY
DATABASE_URL = settings.DATABASE_URL
REDIS_URL = settings.REDIS_URL
ALLOWED_ORIGINS = settings.ALLOWED_ORIGINS
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "monjit@alphamarket.co.in")
INVITE_ONLY = os.getenv("INVITE_ONLY", "true").lower() == "true"
MAX_USERS = int(os.getenv("MAX_USERS", "100"))

# ── App ───────────────────────────────────────────────────────────────────────
API_TAGS = [
    {"name": "Health & Status", "description": "System health checks and API status"},
    {"name": "Authentication", "description": "User registration, login, and session management"},
    {"name": "Stock Screener", "description": "Screen 843 NSE stocks across 34+ quantitative strategies including momentum, mean reversion, breakout, fundamental filters, and multi-factor models"},
    {"name": "Backtesting", "description": "Run historical backtests on individual stocks with 40+ strategies. Get trade-by-trade results, equity curves, and performance metrics (CAGR, Sharpe, max drawdown)"},
    {"name": "Forward Testing", "description": "Paper-trade strategies in real-time across multiple stocks simultaneously. Track live P&L, positions, and signal generation"},
    {"name": "Paper Trading", "description": "Manual paper trading — open and close individual positions with stop-loss and target tracking"},
    {"name": "Model Portfolios", "description": "Create, manage, and rebalance model portfolios using screener or backtest strategies. 23 pre-built templates available"},
    {"name": "Options Lab", "description": "Options chain data, multi-leg strategy payoff analysis, and Greeks calculator for NSE stocks and indices (NIFTY, BANKNIFTY)"},
    {"name": "Advisory & Reports", "description": "Generate SEBI-compliant advisory reports and PDF recommendations for RA/RIA advisors. Track recommendation history with audit trail"},
    {"name": "Technical Charts", "description": "OHLCV chart data with 15+ technical indicators and backtest trade markers overlay"},
    {"name": "Sector Analysis", "description": "Sector rotation analysis, Relative Rotation Graphs (RRG), sector/industry/basic-industry classification for 843 stocks across 49 sectors"},
    {"name": "Watchlist", "description": "User watchlists with real-time price tracking"},
    {"name": "Stock Data", "description": "Fundamental data, symbol search, and price lookup for NSE-listed stocks"},
    {"name": "Alerts & Notifications", "description": "Price alerts, strategy signal alerts, and in-app notification management"},
    {"name": "Dashboard", "description": "Aggregated strategy performance dashboard across screener, backtest, and forward test engines"},
    {"name": "Admin", "description": "Admin-only endpoints — user management, invite codes, platform statistics, SEBI advisor verification"},
    {"name": "AlphaView", "description": "Comprehensive single-page stock analysis combining technicals, fundamentals, ratings, patterns, relative strength vs NIFTY, and assessment scores (Value/Growth/Quality)"},
    {"name": "Market Intelligence", "description": "Pre-market briefs, sector heatmaps, DCF valuation, dividend tracking, and technical pattern detection"},
    {"name": "Screen Builder", "description": "Custom stock/futures/options scanner for DYOR. Filter 923 NSE stocks by 50+ technical & fundamental parameters. AND/OR logic, save/load screens, CSV export. Includes universe warm-up, F&O pipeline, and saved screens."},
    {"name": "Alpha Signal", "description": "Automated Index F&O signal engine (AlphaBot). Strategies: Momentum Futures (VWAP + price action), Options Directional (ATM CE/PE), Options Writing (OTM Straddle/Strangle), Index Arbitrage (basis capture). Signals pushed to Upstox/XTS for auto-execution. Basket publishing for brokers."},
    {"name": "F&O Trading", "description": "Cash-futures arbitrage scanner, jobbing (bid-ask spread) candidates, and scalping (VWAP + momentum) signals. Covers 31 F&O stocks + NIFTY/BANKNIFTY/FINNIFTY indices. Live prices via Groww API + Kite Connect."},
    {"name": "Bridge (AlphaMarket)", "description": "Publish stock calls, F&O positions, and baskets from DYOR to AlphaMarket advisor profiles. Requires approved publish permission."},
    {"name": "Trading Tools", "description": "Arbitrage scanner, Jobbing candidates, Scalping momentum scanner — all with index F&O support (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY). Requires Kite broker connection."},
    {"name": "System", "description": "Health checks, system status, data source monitoring. Public endpoints — no authentication required."},
    {"name": "Basket Publisher", "description": "Advisor basket strategies — publish F&O/Equity intraday baskets, per-advisor API keys for broker polling, webhook registration, auto-squareoff at 3:20PM IST"},
    {"name": "Upstox", "description": "Upstox OAuth integration, basket pre-fill from AlphaBot signals and Nifty50 movers, basket order placement"},
    {"name": "AlphaBot", "description": "Algorithmic signal generator for Index F&O. Automated strategies for NIFTY/BANKNIFTY futures, options directional, options writing (straddle/strangle), and index arbitrage. Signals pushed to Upstox/XTS for auto-execution."},
    {"name": "Alpha Fundamentals", "description": "Fundamental data from TrueData XBRL — 696+ companies, 40+ ratios including ROE, ROCE, PE, PB, D/E, EBITDA margin, revenue growth, PAT growth. Quarterly history, raw financials, bulk lookup, screening, sector aggregates."},
    {"name": "Alpha Ideas", "description": "Daily actionable trade and investment ideas across 4 horizons: SWING (1-5d), SHORT (1-4w), MEDIUM (1-3m), LONG (6m+). 6 strategies: Breakout, Mean Reversion, Momentum, Volatility Squeeze, Quality+Momentum, Deep Value, GARP. Live price enrichment, performance tracking."},
    {"name": "Alpha Conviction", "description": "Multi-dimensional conviction scoring — 5 independent dimensions (Trend 25%, Momentum 25%, Quality 20%, Value 15%, Volume 15%) scored 0-100. Stocks where 4+ dimensions agree are high-conviction picks. Live price adjusted entry/target/stop."},
    {"name": "Intraday Levels", "description": "Daily pivot levels (Standard/Fibonacci/Camarilla), Central Pivot Range (CPR) with narrow detection, ATR-based expected range, and actionable setups (Breakout Long/Short, Mean Reversion, Range Trade, Bullish/Bearish Setup). Dynamic stock selection from top-volume diverse sectors."},
    {"name": "Alpha Intelligence", "description": "AlphaScore™ (0-100 composite rating), Confluence Engine™ (cross-signal conviction probability), Smart Money Flow™ (institutional accumulation tracker). Patent pending."},
]

# ══ Alpha Data Service (centralized data layer on port 5004) ══
DATA_SERVICE_URL = "http://127.0.0.1:5004"
import httpx as _httpx

async def ds_quote(symbol: str) -> dict:
    """Get equity quote from data service (cached, Groww->Yahoo fallback)"""
    try:
        async with _httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{DATA_SERVICE_URL}/data/equity/quote/{symbol}")
            if r.status_code == 200: return r.json()
    except: pass
    return {}

async def ds_fundamentals(symbol: str) -> dict:
    """Get fundamentals: Alpha Fundamentals (5015) PRIMARY, Data Service (5004) FALLBACK"""
    # 1. Try Alpha Fundamentals API first (rich TrueData XBRL data)
    try:
        async with _httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"http://localhost:5015/api/fundamentals/{symbol}")
            if r.status_code == 200:
                af = r.json()
                if af.get("success") and af.get("data"):
                    d = af["data"]
                    comp = af.get("company", {})
                    # Map AF fields to standard format expected by AlphaView
                    _f = lambda k, *alt: float(d.get(k) or next((d.get(a) for a in alt if d.get(a)), 0) or 0)
                    return {
                        "symbol": symbol, "name": comp.get("company_name", symbol),
                        "sector": comp.get("sector", ""), "industry": comp.get("industry", ""),
                        "market_cap": _f("market_cap"),
                        "pe_trailing": _f("pe_ttm"),
                        "pe_forward": _f("forward_pe_1y", "pe_forward"),
                        "pb": _f("pb_ratio"),
                        "ps": _f("ps_ratio"),
                        "roe": _f("roe"),
                        "roce": _f("roce"),
                        "roa": _f("roa"),
                        "debt_equity": _f("debt_to_equity", "debt_equity"),
                        "dividend_yield": _f("dividend_yield"),
                        "ev_ebitda": _f("ev_ebitda"),
                        "ebitda_margin": _f("ebitda_margin"),
                        "profit_margin": _f("net_margin", "profit_margin"),
                        "operating_margin": _f("ebitda_margin"),
                        "revenue_growth": _f("revenue_growth_yoy", "revenue_growth"),
                        "earnings_growth": _f("eps_growth_yoy", "pat_growth_yoy", "earnings_growth"),
                        "eps": _f("eps", "eps_ttm"),
                        "book_value": _f("book_value"),
                        "face_value": float(comp.get("face_value", 0) or 0),
                        "beta": _f("beta"),
                        "promoter_holding": _f("promoter_holding"),
                        "current_ratio": _f("current_ratio"),
                        "interest_coverage": _f("interest_coverage"),
                        "peg_ratio": _f("peg_ratio"),
                        "revenue_cagr_3y": _f("revenue_cagr_3y"),
                        "earnings_cagr_3y": _f("earnings_cagr_3y"),
                        "high_52w": _f("high_52w"),
                        "low_52w": _f("low_52w"),
                        "source": "alpha_fundamentals"
                    }
                    # Fallback: fetch dividend_yield from Yahoo if AF has None
                    if not mapped.get("dividend_yield"):
                        try:
                            yr = await c.get(f"{DATA_SERVICE_URL}/data/equity/fundamentals/{symbol}", timeout=5)
                            if yr.status_code == 200:
                                yd = yr.json()
                                dy = yd.get("dividend_yield") or yd.get("dividendYield") or yd.get("trailingAnnualDividendYield")
                                if dy and float(dy) > 0:
                                    dv = float(dy)
                                    if dv > 1: dv = dv / 100  # Normalize if > 1 (Yahoo returns as pct sometimes)
                                    mapped["dividend_yield"] = round(dv, 4)
                        except: pass
                    return mapped
    except Exception as e:
        logger.warning(f"Alpha Fundamentals fallback for {symbol}: {e}")
    # 2. Fallback to Data Service (Yahoo Finance)
    try:
        async with _httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{DATA_SERVICE_URL}/data/equity/fundamentals/{symbol}")
            if r.status_code == 200:
                result = r.json()
                result["source"] = "yahoo"
                return result
    except: pass
    return {}

async def ds_ohlcv(symbol: str, period: str = "1y") -> list:
    """Get OHLCV history from data service with error logging"""
    try:
        async with _httpx.AsyncClient(timeout=30) as c:
            r = await c.get(f"{DATA_SERVICE_URL}/data/equity/ohlcv/{symbol}?period={period}")
            if r.status_code == 200:
                data = r.json().get("data", [])
                if len(data) < 5:
                    logger.warning(f"ds_ohlcv: {symbol} returned only {len(data)} rows — possible data issue")
                return data
            else:
                logger.error(f"ds_ohlcv: {symbol} returned HTTP {r.status_code}: {r.text[:200]}")
    except Exception as e:
        logger.error(f"ds_ohlcv: {symbol} connection failed: {type(e).__name__}: {e}")
    return []

from routers.arbitrage import router as arbitrage_router
from routers.alpha_options import router as alpha_options_router
from routers.algo_strategies import router as algo_strategies_router
from routers.trading_tools import router as trading_router
from routers.alphabot import router as alphabot_router
from routers.patterns_v2 import router as patterns_v2_router
from routers.upstox import router as upstox_router
from routers.basket_publisher import router as basket_router
from routers.options_backtest import router as options_bt_router
from routers.alpha_intelligence import router as alpha_intel_router
from alphascore import compute_alphascore
from confluence_engine import compute_confluence
from flow_signals import compute_smart_money_score

app = FastAPI(
    root_path="/dyor",
    title="AlphaLab DYOR API",
    description="AlphaLab DYOR - Do Your Own Research platform by AlphaMarket. 923 NSE stocks, 34+ screener strategies, Options Alpha Engine, AlphaBot F&O signals, Algo Trading, Trade Scanners, Backtesting, Model Portfolios, Sector Analysis, and Advisory Reports.",
    version="3.5.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    openapi_tags=[
        {"name": "Health & Status", "description": "System health checks and API status"},
        {"name": "Authentication", "description": "User registration, login, and session management"},
        {"name": "Stock Screener", "description": "Screen 843 NSE stocks across 34+ strategies with buy zones and signal status"},
        {"name": "Alpha Ideas", "description": "AI trade ideas with buy zones, R:R ratios, confidence scores across 4 horizons"},
        {"name": "Alpha Conviction", "description": "Multi-dimensional scoring: Trend, Momentum, Quality, Value, Volume with buy zones"},
        {"name": "Intraday Levels", "description": "Pivot points, CPR, support/resistance, buy/sell zones for NIFTY 50 stocks"},
        {"name": "Options Alpha", "description": "AI F&O signals with leg-level buy zones, entry/exit guidance, auto-expiry"},
        {"name": "AlphaBot", "description": "Automated NIFTY/BANKNIFTY F&O signals with live premiums and buy zones"},
        {"name": "Algo Trading", "description": "5 algorithmic strategies with live signals and entry check guidance"},
        {"name": "Trade Scanners", "description": "Jobbing, Scalping, Arbitrage scanners with live Kite data"},
        {"name": "Backtesting", "description": "40+ strategies with trade-by-trade results and equity curves"},
        {"name": "Forward Testing", "description": "Paper-trade strategies across multiple stocks with live P&L"},
        {"name": "Paper Trading", "description": "Manual paper trading with stop-loss and target tracking"},
        {"name": "Model Portfolios", "description": "23 pre-built portfolio templates with rebalancing"},
        {"name": "Options Lab", "description": "Options chain, multi-leg payoff analysis, Greeks calculator"},
        {"name": "Advisory & Reports", "description": "SEBI-compliant advisory reports and PDF recommendations"},
        {"name": "Technical Charts", "description": "OHLCV chart data with 15+ technical indicators"},
        {"name": "Sector Analysis", "description": "Sector rotation, RRG, 49 sectors classification"},
        {"name": "Watchlist", "description": "User watchlists with real-time price tracking"},
        {"name": "Stock Data", "description": "Fundamental data, symbol search, price lookup"},
        {"name": "Alerts & Notifications", "description": "Price alerts and strategy signal alerts"},
        {"name": "Dashboard", "description": "Aggregated strategy performance dashboard"},
        {"name": "Morning Brief", "description": "Pre-market brief with global cues and sentiment score"},
        {"name": "MTF Combiner", "description": "Multi-timeframe screener for high-conviction picks"},
        {"name": "Screen Builder", "description": "Custom scanner with 40+ parameters"},
        {"name": "Basket Orders", "description": "Multi-leg F&O basket orders with broker webhook integration"},
    ]
)


# ═══ TrueData WebSocket Market Data Integration ═══
import threading as _td_threading

_TD_USERNAME = "tdwsp531"
_TD_PASSWORD = "monjit@531"
_TD_PORT = 8084
_TD_URL = "push.truedata.in"

_td_prices = {}
_td_connected = False
_td_obj = None
_td_lock = _td_threading.Lock()
_td_subscribed_symbols = set()

def _start_truedata_feed(symbols_list=None):
    global _td_obj, _td_connected, _td_subscribed_symbols
    try:
        from truedata import TD_live
        import logging as _td_logging
        _td_obj = TD_live(
            _TD_USERNAME, _TD_PASSWORD,
            live_port=_TD_PORT,
            url=_TD_URL,
            log_level=_td_logging.WARNING
        )
        if not symbols_list:
            symbols_list = ["NIFTY 50", "NIFTY BANK", "SBIN", "RELIANCE", "HDFCBANK", "INFY", "TCS", "ITC", "ICICIBANK", "KOTAKBANK"]
        req_ids = _td_obj.start_live_data(symbols_list)
        _td_subscribed_symbols = set(symbols_list)
        import time as _td_time
        _td_time.sleep(2)
        # Populate from touchline
        for sym in symbols_list:
            try:
                td = _td_obj.live_data.get(sym)
                if td and hasattr(td, 'ltp') and td.ltp:
                    with _td_lock:
                        _td_prices[sym] = {
                            'ltp': float(td.ltp),
                            'high': float(getattr(td, 'day_high', 0) or 0),
                            'low': float(getattr(td, 'day_low', 0) or 0),
                            'open': float(getattr(td, 'day_open', 0) or 0),
                            'close': float(getattr(td, 'prev_day_close', 0) or 0),
                            'volume': int(getattr(td, 'ttq', 0) or 0),
                            'oi': int(getattr(td, 'oi', 0) or 0),
                            'timestamp': _td_time.time(),
                            'source': 'truedata'
                        }
            except Exception:
                pass
        @_td_obj.trade_callback
        def _on_td_trade(tick_data):
            try:
                import time as _t
                sym = tick_data.symbol
                ltp = float(tick_data.ltp)
                with _td_lock:
                    _td_prices[sym] = {
                        'ltp': ltp,
                        'high': float(getattr(tick_data, 'day_high', 0) or 0),
                        'low': float(getattr(tick_data, 'day_low', 0) or 0),
                        'open': float(getattr(tick_data, 'day_open', 0) or 0),
                        'close': float(getattr(tick_data, 'prev_day_close', 0) or 0),
                        'volume': int(getattr(tick_data, 'ttq', 0) or 0),
                        'oi': int(getattr(tick_data, 'oi', 0) or 0),
                        'timestamp': _t.time(),
                        'source': 'truedata'
                    }
                # ── Tick-by-tick SL/TP check ──
                _check_sl_tp_on_tick(sym, ltp)
                # Also check base symbol (e.g. CRUDEOIL-I -> CRUDEOIL, CRUDEOILM)
                if sym.endswith('-I'):
                    _check_sl_tp_on_tick(sym[:-2], ltp)
            except Exception:
                pass
        _td_connected = True
        print(f"[TrueData] Connected — {len(symbols_list)} symbols subscribed, {len(_td_prices)} prices loaded")
    except Exception as e:
        _td_connected = False
        print(f"[TrueData] Connection failed: {e}")

def _td_subscribe_new(symbols):
    global _td_obj, _td_subscribed_symbols
    if not _td_obj or not _td_connected:
        return False
    new_syms = [s for s in symbols if s not in _td_subscribed_symbols]
    if not new_syms:
        return True
    if len(_td_subscribed_symbols) + len(new_syms) > 590:
        return False
    try:
        import time as _sub_time
        _td_obj.start_live_data(new_syms)
        _td_subscribed_symbols.update(new_syms)
        _sub_time.sleep(1)  # Wait for touchline
        # Read touchline/live_data for newly subscribed symbols
        populated = 0
        for sym in new_syms:
            try:
                td = _td_obj.live_data.get(sym)
                if td and hasattr(td, 'ltp') and td.ltp:
                    with _td_lock:
                        _td_prices[sym] = {
                            'ltp': float(td.ltp),
                            'high': float(getattr(td, 'day_high', 0) or 0),
                            'low': float(getattr(td, 'day_low', 0) or 0),
                            'open': float(getattr(td, 'day_open', 0) or 0),
                            'close': float(getattr(td, 'prev_day_close', 0) or 0),
                            'volume': int(getattr(td, 'ttq', 0) or 0),
                            'oi': int(getattr(td, 'oi', 0) or 0),
                            'timestamp': _sub_time.time(),
                            'source': 'truedata'
                        }
                    populated += 1
            except Exception:
                pass
        print(f"[TrueData] Added {len(new_syms)} symbols, {populated} prices loaded (total: {len(_td_subscribed_symbols)})")
        return True
    except Exception as e:
        print(f"[TrueData] Subscribe error: {e}")
        return False

def _td_get_quotes(symbols):
    result = {}
    with _td_lock:
        for sym in symbols:
            data = _td_prices.get(sym) or _td_prices.get(sym.upper())
            if data and data.get('ltp', 0) > 0:
                result[sym] = data
    return result


# ═══ Tick-by-Tick SL/TP Monitoring Engine ═══
import asyncio as _sl_asyncio

_sl_watchlist = {}  # symbol -> [{id, source, action, entry, sl, tp, strategy_id, segment, ...}]
_sl_watchlist_lock = _td_threading.Lock()
_sl_triggered_ids = set()  # Prevent duplicate triggers
_sl_last_refresh = 0
_SL_REFRESH_INTERVAL = 5  # Refresh watchlist from DB every 5 seconds
_SL_NODE_URL = "http://localhost:5001"

def _sl_refresh_watchlist():
    """Load active calls/positions with SL/TP into memory watchlist."""
    global _sl_last_refresh
    import time as _sl_time
    now = _sl_time.time()
    if now - _sl_last_refresh < _SL_REFRESH_INTERVAL:
        return
    _sl_last_refresh = now
    try:
        import psycopg2
        conn = psycopg2.connect("postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db")
        cur = conn.cursor()
        new_watchlist = {}
        
        # Equity calls
        cur.execute("""
            SELECT c.id, c.stock_name, c.action, c.buy_range_start, c.stop_loss, c.target_price, c.strategy_id, c.webhook_rec_id
            FROM calls c
            WHERE c.status = 'Active' AND c.is_published = true
              AND (c.stop_loss > 0 OR c.target_price > 0)
        """)
        for row in cur.fetchall():
            sym = row[1]
            if not sym:
                continue
            entry = {
                'id': row[0], 'source': 'calls', 'symbol': sym,
                'action': row[2] or 'Buy',
                'entry': float(row[3] or 0), 'sl': float(row[4] or 0), 'tp': float(row[5] or 0),
                'strategy_id': row[6], 'rec_id': row[7],
                'segment': 'equity'
            }
            if sym not in new_watchlist:
                new_watchlist[sym] = []
            new_watchlist[sym].append(entry)
        
        # FnO positions (skip options — they need option chain pricing)
        cur.execute("""
            SELECT p.id, p.symbol, COALESCE(p.buy_sell, 'Buy'), p.entry_price, p.stop_loss, p.target, p.strategy_id, p.webhook_rec_id,
                   p.segment, p.strike_price, p.call_put, p.expiry
            FROM positions p
            WHERE p.status = 'Active' AND p.is_published = true
              AND (p.stop_loss::numeric > 0 OR p.target::numeric > 0)
        """)
        for row in cur.fetchall():
            sym = row[1]
            segment = row[8] or ''
            strike = row[9]
            has_strike = strike and str(strike) != '' and str(strike) != '0' and float(strike) > 0
            # Options need option chain pricing (different symbol format) — handle via TrueData option chain later
            # For now: futures + equity positions use stock symbol directly
            # Skip options/index — these need option premium pricing, not stock/index LTP
            # Also catch mis-segmented options (segment=Equity but has strike+callPut)
            call_put = row[10] or ''
            is_option_by_data = has_strike and bool(call_put)
            if segment in ('Option', 'Index') and has_strike:
                continue
            if is_option_by_data and segment not in ('Future', 'CommodityFuture', 'Commodity'):
                continue  # Has strike+callPut = option, regardless of segment label
            if not sym:
                continue
            td_sym = sym
            if segment in ('Future', 'CommodityFuture', 'Commodity'):
                td_sym = sym + '-I'  # TrueData futures format
            entry = {
                'id': row[0], 'source': 'positions', 'symbol': sym, 'td_symbol': td_sym,
                'action': row[2] or 'Buy',
                'entry': float(row[3] or 0), 'sl': float(row[4] or 0), 'tp': float(row[5] or 0),
                'strategy_id': row[6], 'rec_id': row[7],
                'segment': segment
            }
            lookup_sym = td_sym if td_sym != sym else sym
            if lookup_sym not in new_watchlist:
                new_watchlist[lookup_sym] = []
            new_watchlist[lookup_sym].append(entry)
        
        conn.close()
        
        with _sl_watchlist_lock:
            _sl_watchlist.clear()
            _sl_watchlist.update(new_watchlist)
        
        # ── Check for expired positions and close them ──
        try:
            import psycopg2 as _exp_pg
            from datetime import date as _sl_date
            _exp_conn = _exp_pg.connect("postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db")
            _exp_cur = _exp_conn.cursor()
            _exp_cur.execute("""
                SELECT p.id, p.symbol, p.strike_price, p.call_put, p.expiry::text,
                       p.buy_sell, p.entry_price, p.webhook_rec_id, p.segment
                FROM positions p
                WHERE p.status = 'Active' AND p.is_published = true
                  AND p.expiry IS NOT NULL AND p.expiry != ''
                  AND p.expiry::date < CURRENT_DATE
            """)
            expired = _exp_cur.fetchall()
            _exp_conn.close()
            for row in expired:
                pos_id = row[0]
                sym = row[1]
                rec_id = row[7]
                if pos_id in _sl_triggered_ids:
                    continue
                _sl_triggered_ids.add(pos_id)
                print(f"[SL Engine] EXPIRED: {sym} {row[2]} {row[3]} expiry={row[4]} (ID: {pos_id})")
                entry = {
                    'id': pos_id, 'source': 'positions', 'symbol': sym,
                    'action': row[5] or 'Buy', 'entry': float(row[6] or 0),
                    'sl': 0, 'tp': 0, 'strategy_id': None, 'rec_id': rec_id,
                    'segment': row[8] or ''
                }
                # Close at 0 (expired worthless for buyers, full profit for sellers)
                _td_threading.Thread(target=_fire_sl_close, args=(entry, 0, 'EXPIRED'), daemon=True).start()
        except Exception as exp_err:
            print(f"[SL Engine] Expiry check error: {exp_err}")

        # Auto-subscribe any new symbols to TrueData
        # Also add -I suffix for commodity symbols
        COMMODITY_SYMBOLS = {'CRUDEOIL','CRUDEOILM','GOLD','GOLDM','SILVER','SILVERM','NATURALGAS','COPPER','ZINC','ALUMINIUM','NICKEL','LEAD','COTTONCANDY','MENTHAOIL'}
        all_syms = list(new_watchlist.keys())
        extra_commodity = [s + '-I' for s in all_syms if s.upper() in COMMODITY_SYMBOLS and (s + '-I') not in _td_subscribed_symbols]
        to_subscribe = [s for s in all_syms if s not in _td_subscribed_symbols] + extra_commodity
        if to_subscribe:
            _td_subscribe_new(to_subscribe)
        
    except Exception as e:
        print(f"[SL Engine] Watchlist refresh error: {e}")

def _check_sl_tp_on_tick(symbol, ltp):
    """Called on every TrueData tick — checks SL/TP for all calls on this symbol."""
    # Refresh watchlist if stale
    _sl_refresh_watchlist()
    
    with _sl_watchlist_lock:
        entries = _sl_watchlist.get(symbol, [])
    
    if not entries:
        return
    
    for entry in entries:
        call_id = entry['id']
        if call_id in _sl_triggered_ids:
            continue
        
        sl = entry['sl']
        tp = entry['tp']
        action = entry['action']
        is_sell = action == 'Sell'
        triggered = None
        
        if is_sell:
            if sl > 0 and ltp >= sl:
                triggered = 'SL'
            elif tp > 0 and ltp <= tp:
                triggered = 'TARGET'
        else:
            if sl > 0 and ltp <= sl:
                triggered = 'SL'
            elif tp > 0 and ltp >= tp:
                triggered = 'TARGET'
        
        if triggered:
            _sl_triggered_ids.add(call_id)
            print(f"[SL Engine] {triggered} TRIGGERED: {entry['symbol']} LTP={ltp} {'SL' if triggered == 'SL' else 'TP'}={sl if triggered == 'SL' else tp} (ID: {call_id}, source: {entry['source']})")
            # Fire close via Node in a background thread
            _td_threading.Thread(target=_fire_sl_close, args=(entry, ltp, triggered), daemon=True).start()

def _fire_sl_close(entry, ltp, trigger_type):
    """Call Node.js close endpoint to properly close the call and fire webhooks."""
    import requests as _sl_requests
    try:
        call_id = entry['id']
        source = entry['source']
        
        if source == 'calls':
            url = f"{_SL_NODE_URL}/api/admin/broker-calls/{call_id}/close"
            body = {"source": "calls", "exitPrice": ltp}
        else:
            url = f"{_SL_NODE_URL}/api/admin/broker-calls/{call_id}/close"
            body = {"source": "positions", "exitPrice": ltp}
        
        # Get admin session cookie
        import psycopg2, hashlib, hmac, base64, urllib.parse
        conn = psycopg2.connect("postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db")
        cur = conn.cursor()
        cur.execute("SELECT sid FROM sessions WHERE (sess::jsonb->>'userId') IN (SELECT id FROM users WHERE role='admin') AND expire > NOW() ORDER BY expire DESC LIMIT 1")
        row = cur.fetchone()
        conn.close()
        
        if not row:
            print(f"[SL Engine] ERROR: No admin session for closing {entry['symbol']}")
            _sl_triggered_ids.discard(call_id)  # Allow retry
            return
        
        sid = row[0]
        secret = "j7LzUgscsxhDpM3SuS/iuz3SkjQcR5XIjxfMwEQxybHw27zRVj1khGafjxC35Nltgqz/j7ZM10WacTstOOw4qQ=="
        sig = base64.b64encode(hmac.new(secret.encode(), sid.encode(), hashlib.sha256).digest()).decode().rstrip('=')
        cookie_val = urllib.parse.quote(f"s:{sid}.{sig}", safe='')
        
        resp = _sl_requests.post(url, json=body, headers={
            "Content-Type": "application/json",
            "Cookie": f"connect.sid={cookie_val}"
        }, timeout=10)
        
        event_labels = {"SL": "STOPLOSS_TRIGGERED", "TARGET": "TARGET_ACHIEVED", "EXPIRED": "POSITION_EXPIRED"}
        event_label = event_labels.get(trigger_type, trigger_type)
        print(f"[SL Engine] {event_label}: {entry['symbol']} closed at {ltp} via Node (HTTP {resp.status_code})")
        
    except Exception as e:
        print(f"[SL Engine] Close error for {entry['symbol']}: {e}")
        _sl_triggered_ids.discard(call_id)  # Allow retry

def _sl_watchlist_refresh_loop():
    """Background thread: refresh watchlist every 5 seconds."""
    import time as _sl_time
    _sl_time.sleep(5)  # Wait for DB to be ready
    while True:
        try:
            _sl_refresh_watchlist()
        except Exception:
            pass
        _sl_time.sleep(_SL_REFRESH_INTERVAL)

# ═══ End SL/TP Engine ═══

print("[TrueData] Module loaded")
# ═══ End TrueData Module ═══
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# Force OpenAPI 3.0.3 for Swagger UI compatibility
def custom_openapi():
    if app.openapi_schema: return app.openapi_schema
    from fastapi.openapi.utils import get_openapi
    schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes, tags=app.openapi_tags, contact=app.contact, license_info=app.license_info)
    schema["openapi"] = "3.0.3"
    app.openapi_schema = schema
    return schema
app.openapi = custom_openapi

app.include_router(arbitrage_router)
app.include_router(alpha_options_router)
app.include_router(algo_strategies_router)
app.include_router(trading_router)
app.include_router(alphabot_router)
app.include_router(patterns_v2_router)
app.include_router(upstox_router)
app.include_router(basket_router)
app.include_router(options_bt_router)
app.include_router(alpha_intel_router)
from routers.alpha_fundamentals import router as alpha_fundamentals_router
app.include_router(alpha_fundamentals_router)
from routers.alpha_ideas import router as alpha_ideas_router
app.include_router(alpha_ideas_router)
from routers.alpha_conviction import router as alpha_conviction_router
app.include_router(alpha_conviction_router)

# DYOR Auth Bridge — validate AlphaMarket session cookies
from middleware.alphamarket_auth import AlphaMarketAuthMiddleware
app.add_middleware(AlphaMarketAuthMiddleware, dyor_db_url=DATABASE_URL)
security = HTTPBearer(auto_error=False)

db_pool = None
redis_client = None

@app.on_event("startup")
async def startup():
    global db_pool, redis_client
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        redis_client = await aioredis.from_url(REDIS_URL, decode_responses=True)
        await init_db()
        await ensure_admin()
        print(f"AlphaLab v2.0 startup complete | Universe: {len(NIFTY_UNIVERSE)} stocks | Sectors: {len(set(SECTOR_MAP.values()))}")
        # Start background pre-computation task
        asyncio.create_task(_precompute_loop())
        # Start TrueData WebSocket feed in background thread
        try:
            _td_thread = _td_threading.Thread(target=_start_truedata_feed, daemon=True)
            _td_thread.start()
            print("[TrueData] Background thread started")
            # Start SL/TP watchlist refresh loop
            _sl_thread = _td_threading.Thread(target=_sl_watchlist_refresh_loop, daemon=True)
            _sl_thread.start()
            print("[SL Engine] Watchlist refresh thread started (every 5s)")
        except Exception as td_err:
            print(f"[TrueData] Startup error (non-fatal): {td_err}")
    except Exception as e:
        print(f"Startup error: {e}")




@app.get("/api/shared/kite-quotes", include_in_schema=False)
async def shared_kite_quotes(request: Request, symbols: str = ""):
    """Internal endpoint: Kite first, TrueData fallback, then Groww (via Node)."""
    secret = request.headers.get("x-shared-secret", "")
    if secret != "alphamarket-shared-2026":
        raise HTTPException(403, "Unauthorized")
    if not symbols:
        return {"quotes": {}, "source": "kite", "error": "No symbols"}
    raw_syms = [s.strip() for s in symbols.split(",") if s.strip()]
    quotes = {}
    missing_syms = list(raw_syms)
    source_stats = {"kite": 0, "truedata": 0}
    # ── Source 1: Kite ──
    from routers.arbitrage import _fetch_kite_quotes, _is_kite_connected
    if _is_kite_connected():
        try:
            sym_list = [f"NSE:{s}" for s in raw_syms if " " not in s and "&" not in s]  # Skip symbols with special chars (handled by TrueData fallback)
            data = await _fetch_kite_quotes(sym_list)
            for key, val in data.items():
                sym = key.replace("NSE:", "")
                ltp = val.get("last_price", 0)
                if ltp and ltp > 0:
                    quotes[sym] = {"price": ltp, "source": "kite"}
                    source_stats["kite"] += 1
                    if sym in missing_syms:
                        missing_syms.remove(sym)
        except Exception as e:
            pass  # Fall through to TrueData
    # ── Source 2: TrueData (in-memory cache — instant, no network call) ──
    if missing_syms and _td_connected:
        td_quotes = _td_get_quotes(missing_syms)
        for sym, data in td_quotes.items():
            quotes[sym] = {"price": data["ltp"], "source": "truedata"}
            source_stats["truedata"] += 1
            if sym in missing_syms:
                missing_syms.remove(sym)
        # Auto-subscribe any symbols not yet in TrueData
        if missing_syms:
            _td_subscribe_new(missing_syms)
    return {"quotes": quotes, "source": "kite+truedata", "connected": True, "count": len(quotes), "sources": source_stats, "missing": missing_syms if missing_syms else None}

@app.get("/api/shared/kite-quotes-raw", include_in_schema=False)
async def shared_kite_quotes_raw(request: Request, symbols: str = ""):
    """Internal: fetch Kite quotes with raw symbol format (supports NFO:TRADINGSYMBOL)."""
    secret = request.headers.get("x-shared-secret", "")
    if secret != "alphamarket-shared-2026":
        raise HTTPException(403, "Unauthorized")
    if not symbols:
        return {"quotes": {}}
    raw_syms = [s.strip() for s in symbols.split(",") if s.strip()]
    from routers.arbitrage import _fetch_kite_quotes, _is_kite_connected
    if not _is_kite_connected():
        return {"quotes": {}, "connected": False}
    try:
        data = await _fetch_kite_quotes(raw_syms, mode="full")
        quotes = {}
        for key, val in data.items():
            ltp = val.get("last_price", 0)
            quotes[key] = {"price": ltp, "ltp": ltp, "ohlc": val.get("ohlc"),
                           "volume": val.get("volume") or val.get("volume_traded") or 0,
                           "source": "kite"}
        return {"quotes": quotes, "count": len(quotes)}
    except Exception as e:
        return {"quotes": {}, "error": str(e)}

@app.get("/api/shared/kite-ltp/{symbol}", include_in_schema=False)
async def shared_kite_ltp(request: Request, symbol: str):
    """Internal: single stock LTP from Kite."""
    secret = request.headers.get("x-shared-secret", "")
    if secret != "alphamarket-shared-2026":
        raise HTTPException(403, "Unauthorized")
    from routers.arbitrage import _fetch_kite_quotes, _is_kite_connected
    if not _is_kite_connected():
        return {"price": 0, "source": "kite", "connected": False}
    try:
        data = await _fetch_kite_quotes([f"NSE:{symbol.upper()}"])
        key = f"NSE:{symbol.upper()}"
        if data and key in data:
            return {"symbol": symbol.upper(), "price": data[key].get("last_price", 0), "source": "kite"}
        return {"symbol": symbol.upper(), "price": 0, "source": "kite", "error": "not found"}
    except Exception as e:
        return {"symbol": symbol.upper(), "price": 0, "source": "kite", "error": str(e)}


@app.get("/api/shared/truedata-quotes", include_in_schema=False)
async def shared_truedata_quotes(request: Request, symbols: str = ""):
    """Direct TrueData quotes endpoint."""
    secret = request.headers.get("x-shared-secret", "")
    if secret != "alphamarket-shared-2026":
        raise HTTPException(403, "Unauthorized")
    if not symbols:
        return {"quotes": {}, "source": "truedata"}
    raw_syms = [s.strip() for s in symbols.split(",") if s.strip()]
    # Auto-subscribe if needed
    if _td_connected:
        _td_subscribe_new(raw_syms)
    quotes = _td_get_quotes(raw_syms)
    return {"quotes": quotes, "source": "truedata", "connected": _td_connected, "count": len(quotes)}

@app.get("/api/shared/truedata-status", include_in_schema=False)
async def shared_truedata_status(request: Request):
    """TrueData connection status."""
    secret = request.headers.get("x-shared-secret", "")
    if secret != "alphamarket-shared-2026":
        raise HTTPException(403, "Unauthorized")
    with _td_lock:
        return {
            "connected": _td_connected,
            "subscribed_symbols": len(_td_subscribed_symbols),
            "cached_prices": len(_td_prices),
            "sample_symbols": list(_td_prices.keys())[:30],
            "sample_prices": {k: v.get("ltp") for k, v in list(_td_prices.items())[:10]}
        }

@app.get("/api/shared/sl-engine-status", include_in_schema=False)
async def sl_engine_status(request: Request):
    """SL/TP tick-by-tick engine status."""
    secret = request.headers.get("x-shared-secret", "")
    if secret != "alphamarket-shared-2026":
        raise HTTPException(403, "Unauthorized")
    with _sl_watchlist_lock:
        total_entries = sum(len(v) for v in _sl_watchlist.values())
        symbols = list(_sl_watchlist.keys())
    return {
        "watchlist_symbols": len(symbols),
        "watchlist_entries": total_entries,
        "triggered_count": len(_sl_triggered_ids),
        "triggered_ids": list(_sl_triggered_ids)[:20],
        "symbols": symbols[:50],
        "refresh_interval": _SL_REFRESH_INTERVAL,
        "td_connected": _td_connected,
        "td_cached_prices": len(_td_prices)
    }

@app.get("/api/health", tags=["System"])
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

async def _run_screener_internal(strategy: str, min_price: float = 50, max_price: float = 10000,
                                  sector: str = "", industry: str = "", basic_industry: str = "", cap_segment: str = ""):
    """Internal screener runner — bypasses auth, used by precompute loop and warm endpoint."""
    from datetime import date, timedelta
    # Normalize strategy aliases (frontend uses different names than internal)
    STRATEGY_ALIASES = {
        "rsi_oversold": "oversold", "rsi_overbought": "overbought",
        "bollinger_squeeze": "bb_squeeze", "breakout_52w": "52w_high",
        "minervini_template": "minervini", "rvol_surge": "volume",
        "volume_breakout": "up_on_volume", "new_high": "52w_high",
        "mean_reversion": "pullback_buy", "adx_strong_trend": "trend_strong",
        "high_tight_flag": "breakout", "inside_day": "bb_squeeze",
        "darvas_box": "range_breakout", "turtle_breakout": "breakout",
        "ichimoku_bullish": "golden_cross", "elder_ray": "trend_strong",
        "williams_r": "oversold", "ema_ribbon": "golden_cross",
        "pivot_breakout": "recent_breakout", "vwap_reclaim": "pullback_buy",
    }
    strategy = STRATEGY_ALIASES.get(strategy, strategy)
    cache_key = f"screener:{__import__('datetime').date.today().isoformat()}:{strategy}:{int(min_price)}:{int(max_price)}:{sector}:{industry}:{basic_industry}:{cap_segment}"
    # Also check normalized key (frontend uses 0:999999 as defaults)
    norm_key = f"screener:{__import__('datetime').date.today().isoformat()}:{strategy}:0:999999::::"
    # Undated fallback keys (written by warm_cache_direct)
    undated_key = f"screener:{strategy}:{int(min_price)}:{int(max_price)}:{sector}:{industry}:{basic_industry}:{cap_segment}"
    undated_norm = f"screener:{strategy}:0:999999::::"
    if redis_client:
        cached = await redis_client.get(cache_key) or await redis_client.get(norm_key) or await redis_client.get(undated_key) or await redis_client.get(undated_norm)
        if cached:
            result = json.loads(cached)
            stocks = result.get("stocks", [])
            if sector:
                stocks = [s for s in stocks if s.get("sector","").lower() == sector.lower()]
            if industry:
                stocks = [s for s in stocks if s.get("industry","").lower() == industry.lower()]
            if basic_industry:
                stocks = [s for s in stocks if s.get("basic_industry","").lower() == basic_industry.lower()]
            if cap_segment:
                stocks = [s for s in stocks if s.get("cap_segment","").lower() == cap_segment.lower()]
            if int(min_price) > 0 or int(max_price) < 999999:
                stocks = [s for s in stocks if min_price <= s.get("price",0) <= max_price]
            result["stocks"] = stocks
            result["count"] = len(stocks)
            return result
        else:
            # Cache miss — return empty instead of blocking for 2+ min Yahoo download
            # Background cron (warm_cache_direct.py) will fill cache every 2 hours
            return {"stocks": [], "count": 0, "strategy": strategy, "cached": False,
                    "message": "Data is being refreshed. Please try again in a few minutes or click Live Scan for fresh data."}
    start = (date.today() - timedelta(days=400)).isoformat()
    end = date.today().isoformat()
    symbols_to_scan = list(NIFTY_UNIVERSE)
    if sector:
        symbols_to_scan = [s for s in symbols_to_scan if SECTOR_MAP.get(s, "Other") == sector]
    if industry:
        symbols_to_scan = [s for s in symbols_to_scan if INDUSTRY_MAP.get(s, "Other") == industry]
    if basic_industry:
        symbols_to_scan = [s for s in symbols_to_scan if BASIC_INDUSTRY_MAP.get(s, "Other") == basic_industry]
    yf_symbols = [f"{s}.NS" for s in symbols_to_scan]
    _batch_sz = 40 if len(yf_symbols) > 500 else 50
    all_data = await batch_download_yf(yf_symbols, start, end, batch_size=_batch_sz)

    def sf(v, d=0):
        try:
            v = float(v)
            return d if (np.isnan(v) or np.isinf(v)) else v
        except:
            return d

    stocks = []
    for sym in symbols_to_scan:
        try:
            yf_sym = f"{sym}.NS"
            if yf_sym not in all_data:
                continue
            df = all_data[yf_sym].dropna()
            if len(df) < 30: continue
            c = df["Close"].astype(float)
            h = df["High"].astype(float)
            l = df["Low"].astype(float)
            v = df["Volume"].astype(float)
            price = float(c.iloc[-1])
            prev = float(c.iloc[-2])
            if price < min_price or price > max_price: continue
            change_pct = sf((price - prev) / prev * 100)
            vol = int(v.iloc[-1])
            vol_avg = int(v.rolling(20).mean().iloc[-1]) if len(v) >= 20 else int(v.mean())
            vol_ratio = sf(vol / vol_avg, 1.0) if vol_avg > 0 else 1.0
            delta = c.diff()
            gain = delta.clip(lower=0).ewm(span=14, adjust=False).mean()
            loss = (-delta.clip(upper=0)).ewm(span=14, adjust=False).mean()
            rs = gain.iloc[-1] / loss.iloc[-1] if sf(loss.iloc[-1]) != 0 else 0
            rsi = sf(100 - 100 / (1 + rs), 50)
            sma_20 = sf(c.rolling(20).mean().iloc[-1])
            sma_50 = sf(c.rolling(50).mean().iloc[-1])
            sma_200 = sf(c.rolling(200).mean().iloc[-1]) if len(c) >= 200 else sf(c.mean())
            ema_9 = sf(c.ewm(span=9, adjust=False).mean().iloc[-1])
            ema_21 = sf(c.ewm(span=21, adjust=False).mean().iloc[-1])
            c_252 = c.iloc[-min(252, len(c)):]
            w52_high = sf(c_252.max())
            w52_low = sf(c_252.min())
            pct_from_52h = sf((price - w52_high) / w52_high * 100) if w52_high > 0 else 0
            pct_from_52l = sf((price - w52_low) / w52_low * 100) if w52_low > 0 else 0
            gap_pct = sf((float(df["Open"].iloc[-1]) - prev) / prev * 100) if prev > 0 else 0
            bb_mid = c.rolling(20).mean()
            bb_std = c.rolling(20).std()
            bb_upper = sf((bb_mid + 2 * bb_std).iloc[-1])
            bb_lower = sf((bb_mid - 2 * bb_std).iloc[-1])
            bb_width = sf((bb_upper - bb_lower) / sf(bb_mid.iloc[-1], 1) * 100) if sf(bb_mid.iloc[-1]) > 0 else 0
            ema12 = c.ewm(span=12, adjust=False).mean()
            ema26 = c.ewm(span=26, adjust=False).mean()
            macd_line = ema12 - ema26
            macd_signal = macd_line.ewm(span=9, adjust=False).mean()
            macd_hist = sf((macd_line - macd_signal).iloc[-1])
            macd_cross_up = sf(macd_line.iloc[-1]) > sf(macd_signal.iloc[-1]) and sf(macd_line.iloc[-2]) <= sf(macd_signal.iloc[-2])
            rs_1m = sf(c.iloc[-1] / c.iloc[-22] - 1, 0) * 100 if len(c) >= 22 and sf(c.iloc[-22]) > 0 else change_pct
            rs_3m = sf(c.iloc[-1] / c.iloc[-60] - 1, 0) * 100 if len(c) >= 60 and sf(c.iloc[-60]) > 0 else change_pct
            tr = pd.concat([h - l, (h - df["Close"].shift(1)).abs(), (l - df["Close"].shift(1)).abs()], axis=1).max(axis=1)
            atr = tr.rolling(10).mean()
            st_lower = (h + l) / 2 - 3 * atr
            above_supertrend = bool(price > sf(st_lower.iloc[-1])) if len(atr.dropna()) > 0 else bool(price > sma_200)
            above_200dma = bool(price > sma_200)
            above_50dma = bool(price > sma_50)
            wk_change = sf((price / sf(c.iloc[-6], price) - 1) * 100) if len(c) >= 6 else change_pct
            minervini_score = sum([
                bool(price > sf(c.rolling(150).mean().iloc[-1])) if len(c) >= 150 else False,
                above_200dma, above_50dma, bool(sma_50 > sma_200),
                bool(pct_from_52l >= 25), bool(pct_from_52h >= -25),
            ])
            stocks.append({
                "symbol": sym, "sector": SECTOR_MAP.get(sym, "Other"),
                "industry": INDUSTRY_MAP.get(sym, "Other"),
                "price": round(price, 2), "prev_close": round(prev, 2),
                "change_pct": round(change_pct, 2), "volume": vol, "vol_ratio": round(vol_ratio, 2),
                "rsi": round(rsi, 1), "macd_hist": round(macd_hist, 3),
                "sma_20": round(sma_20, 2), "sma_50": round(sma_50, 2), "sma_200": round(sma_200, 2),
                "ema_9": round(ema_9, 2), "ema_21": round(ema_21, 2),
                "w52_high": round(w52_high, 2), "w52_low": round(w52_low, 2),
                "pct_from_52h": round(pct_from_52h, 1), "pct_from_52l": round(pct_from_52l, 1),
                "gap_pct": round(gap_pct, 2), "bb_width": round(bb_width, 2),
                "bb_upper": round(bb_upper, 2), "bb_lower": round(bb_lower, 2),
                "above_200dma": above_200dma, "above_50dma": above_50dma,
                "above_supertrend": above_supertrend, "macd_cross_up": macd_cross_up,
                "rs_1m": round(rs_1m, 1), "rs_3m": round(rs_3m, 1),
                "wk_change": round(wk_change, 2), "minervini_score": minervini_score,
            })
        except Exception:
            continue

    # Apply strategy filter
    strat_map = {
        "momentum": lambda s: s["change_pct"] > 1 and s["vol_ratio"] > 1.5 and s["rsi"] > 50,
        "oversold": lambda s: s["rsi"] < 35,
        "overbought": lambda s: s["rsi"] > 70,
        "volume": lambda s: s["vol_ratio"] > 3,
        "breakout": lambda s: s["pct_from_52h"] > -3 and s["vol_ratio"] > 2,
        "52w_high": lambda s: s["pct_from_52h"] > -2,
        "52w_low": lambda s: s["pct_from_52l"] < 5,
        "golden_cross": lambda s: s["above_200dma"] and s["above_50dma"] and s["sma_50"] > s["sma_200"],
        "death_cross": lambda s: not s["above_200dma"] and not s["above_50dma"],
        "gap_up": lambda s: s["gap_pct"] > 2,
        "gap_down": lambda s: s["gap_pct"] < -2,
        "up_on_volume": lambda s: s["change_pct"] > 0 and s["vol_ratio"] > 2,
        "bb_squeeze": lambda s: s["bb_width"] < 10,
        "macd_crossover": lambda s: s["macd_cross_up"],
        "minervini": lambda s: s["minervini_score"] >= 5,
        "relative_strength": lambda s: s["rs_3m"] > 15 and s["rs_1m"] > 5,
        "recent_breakout": lambda s: s["pct_from_52h"] > -5 and s["vol_ratio"] > 1.5,
        "pullback_buy": lambda s: s["above_200dma"] and s["rsi"] < 45 and s["pct_from_52h"] < -10,
        "top_losers": lambda s: s["change_pct"] < -2,
        "near_support": lambda s: s["pct_from_52l"] < 10 and s["above_200dma"],
        "trend_strong": lambda s: s["above_supertrend"] and s["above_200dma"] and s["rsi"] > 55,
        "high_beta": lambda s: abs(s["rs_1m"]) > 10,
        "range_breakout": lambda s: s["bb_width"] > 30 and s["vol_ratio"] > 1.5,
        "volume_dry": lambda s: s["vol_ratio"] < 0.4,
        "macd_bearish": lambda s: not s["macd_cross_up"] and s["macd_hist"] < 0,
        "supertrend_buy": lambda s: s["above_supertrend"],
        "dividend_yield": lambda s: True,
        "low_pe": lambda s: True,
        "high_roe": lambda s: True,
        "growth_momentum": lambda s: s["rs_3m"] > 10 and s["above_200dma"],
        "safe_haven": lambda s: s["above_200dma"] and s["rsi"] < 60 and s["vol_ratio"] < 1.5,
        "turnaround": lambda s: s["rs_1m"] > 5 and s["pct_from_52l"] < 20 and not s["above_200dma"],
        "sector_rotation": lambda s: s["rs_1m"] > 3 and s["rs_3m"] < 0,
        "multi_timeframe": lambda s: s["above_200dma"] and s["above_50dma"] and s["rsi"] > 50 and s["change_pct"] > 0 and s["rs_1m"] > 0 and s["rs_3m"] > 0,
    }
    fn = strat_map.get(strategy)
    if fn:
        filtered = [s for s in stocks if fn(s)]
    else:
        filtered = stocks

    sort_keys = {
        "momentum": lambda s: s["change_pct"], "oversold": lambda s: s["rsi"],
        "relative_strength": lambda s: s["rs_3m"] + s["rs_1m"],
        "multi_timeframe": lambda s: s["rs_3m"] + s["rs_1m"],
        "minervini": lambda s: s["minervini_score"],
        "volume": lambda s: s["vol_ratio"], "up_on_volume": lambda s: s["vol_ratio"],
        "top_losers": lambda s: s["change_pct"],
        "breakout": lambda s: s["vol_ratio"], "recent_breakout": lambda s: s["vol_ratio"],
    }
    rev_map = {"top_losers": False, "oversold": False}
    sk = sort_keys.get(strategy, lambda s: s["change_pct"])
    filtered = sorted(filtered, key=sk, reverse=rev_map.get(strategy, True))

    for s in filtered:
        s["cap_segment"] = get_cap_segment(s["symbol"])
    if cap_segment:
        cs = cap_segment.lower()
        filtered = [s for s in filtered if s.get("cap_segment", "") == cs]
    # ── Safety: remove penny stocks and ASM/GSM ──
    filtered = [s for s in filtered if s.get("price", 0) >= 50 and not is_asm_gsm(s.get("symbol", ""))]

    # ── Cap-balanced output: 35% large, 35% mid, 25% small, 5% micro ──
    if not cap_segment:  # Only balance when no specific cap filter is set
        _cap_quotas = {"large": 0.35, "mid": 0.35, "small": 0.25, "micro": 0.05}
        _by_cap = {"large": [], "mid": [], "small": [], "micro": [], "unknown": []}
        for _s in filtered:
            _seg = _s.get("cap_segment", "unknown")
            if _seg not in _by_cap: _seg = "unknown"
            _by_cap[_seg].append(_s)
        _balanced = []; _seen = set(); _limit = 50
        for _cap, _quota in _cap_quotas.items():
            _cap_limit = max(2, int(_limit * _quota))
            for _s in _by_cap.get(_cap, []):
                if _s["symbol"] not in _seen and len([x for x in _balanced if x.get("cap_segment") == _cap]) < _cap_limit:
                    _seen.add(_s["symbol"]); _balanced.append(_s)
        _remaining = _limit - len(_balanced)
        if _remaining > 0:
            for _cap in ["large", "mid", "small", "micro", "unknown"]:
                for _s in _by_cap.get(_cap, []):
                    if _s["symbol"] not in _seen and _remaining > 0:
                        _seen.add(_s["symbol"]); _balanced.append(_s); _remaining -= 1
        filtered_display = _balanced
    else:
        filtered_display = filtered[:50]

    result = {
        "stocks": filtered_display, "count": len(filtered),
        "strategy": strategy, "as_of": end,
        "universe_size": len(NIFTY_UNIVERSE), "scanned": len(symbols_to_scan),
        "cached": False
    }
    if redis_client:
        await redis_client.setex(cache_key, 900, json.dumps({**result, "cached": True}))
    return result


async def _precompute_loop():
    """Background task: warms screener + Screen Builder cache every 15 min during market hours, post-market at 3:45 PM."""
    import pytz
    IST = pytz.timezone("Asia/Kolkata")
    await asyncio.sleep(30)  # Wait for DB/Redis/data-service to be ready
    ALL_STRATEGIES = [
        "momentum", "breakout", "relative_strength", "golden_cross", "oversold",
        "minervini", "volume", "52w_high", "recent_breakout", "trend_strong",
        "macd_crossover", "supertrend_buy", "pullback_buy", "growth_momentum",
        "top_losers", "multi_timeframe", "up_on_volume", "gap_up", "bb_squeeze",
        "overbought", "safe_haven", "turnaround", "sector_rotation", "death_cross",
        "high_beta", "range_breakout", "52w_low", "near_support", "macd_bearish",
        "volume_dry", "gap_down", "dividend_yield", "low_pe", "high_roe"
    ]
    while True:
        try:
            now_ist = datetime.now(IST)
            h, m = now_ist.hour, now_ist.minute
            # Run pre-market (8:15-8:30 AM), during market, and post-market (3:30-4:00 PM)
            should_warm = (8 <= h < 16) or (h == 8 and m >= 15)
            if False:  # Disabled - external cron warm_cache_direct.py handles warming
                print(f"[PRECOMPUTE] Starting full cache warm at {now_ist.strftime('%H:%M IST')}...")
                # Step 1: Warm Screen Builder universe (most expensive — do once)
                sb_cached = await redis_client.get("sb_universe") if redis_client else None
                if not sb_cached:
                    print("[PRECOMPUTE] Warming sb_universe...")
                    try:
                        await sb_get_full_universe()
                        print("[PRECOMPUTE] sb_universe warm complete.")
                    except Exception as e:
                        print(f"[PRECOMPUTE] sb_universe error: {e}")
                # Step 2: Warm enriched fundamentals
                sb_enr = await redis_client.get("sb_universe_enriched") if redis_client else None
                if not sb_enr:
                    print("[PRECOMPUTE] Warming sb_universe_enriched...")
                    try:
                        base = await sb_get_full_universe()
                        enriched = await sb_enrich_fundamentals([s.copy() for s in base])
                        if redis_client and enriched:
                            await redis_client.set("sb_universe_enriched", json.dumps(enriched), ex=14400)
                        print(f"[PRECOMPUTE] sb_universe_enriched warm complete ({len(enriched)} stocks).")
                    except Exception as e:
                        print(f"[PRECOMPUTE] sb_universe_enriched error: {e}")
                # Step 3: Warm all screener strategies
                for strat in ALL_STRATEGIES:
                    try:
                        cache_key = f"screener:{__import__('datetime').date.today().isoformat()}:{strat}:50:10000::::"
                        cached = await redis_client.get(cache_key) if redis_client else None
                        if cached:
                            continue
                        print(f"[PRECOMPUTE] Warming screener: {strat}...")
                        await _run_screener_internal(strat)
                        await asyncio.sleep(1)
                    except Exception as e:
                        print(f"[PRECOMPUTE] Error for {strat}: {e}")
                print(f"[PRECOMPUTE] Full warm complete at {datetime.now(IST).strftime('%H:%M IST')}.")
        except Exception as e:
            print(f"[PRECOMPUTE] Loop error: {e}")
        # Check alerts
        try:
            await _check_all_alerts()
        except Exception as e:
            print(f"[ALERTS] Check error: {e}")
        await asyncio.sleep(900)  # Re-check every 15 min


@app.on_event("shutdown")
async def shutdown():
    if db_pool: await db_pool.close()
    if redis_client: await redis_client.close()

# ── DB Init ───────────────────────────────────────────────────────────────────
async def init_db():
    async with db_pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                password_hash TEXT NOT NULL, is_admin BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        # Add advisor columns if not exist
        for col, ctype in [("user_type", "TEXT DEFAULT 'individual'"), ("sebi_reg_no", "TEXT DEFAULT ''"), ("sebi_cert_path", "TEXT DEFAULT ''")]:
            try:
                await conn.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {ctype}")
            except:
                pass
        try:
            await conn.execute("ALTER TABLE advisory_recommendations ADD COLUMN IF NOT EXISTS pdf_path TEXT DEFAULT ''")
        except:
            pass
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS invite_codes (
                id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
                created_by INT REFERENCES users(id), used_by INT REFERENCES users(id),
                used_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS backtests (
                id SERIAL PRIMARY KEY, user_id VARCHAR NOT NULL,
                name TEXT NOT NULL, strategy TEXT NOT NULL, symbol TEXT NOT NULL,
                from_date TEXT NOT NULL, to_date TEXT NOT NULL,
                initial_capital FLOAT DEFAULT 100000, params JSONB DEFAULT '{}',
                result JSONB, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS user_consents (
                id SERIAL PRIMARY KEY,
                user_id INT NOT NULL,
                consent_type VARCHAR(50) NOT NULL DEFAULT 'platform_disclaimer',
                version VARCHAR(10) NOT NULL DEFAULT '2.0',
                ip_address VARCHAR(50),
                user_agent TEXT,
                accepted_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id, consent_type, version)
            );
            CREATE TABLE IF NOT EXISTS methodology_access_requests (
                id SERIAL PRIMARY KEY,
                user_id INT NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                requested_at TIMESTAMP DEFAULT NOW(),
                reviewed_at TIMESTAMP,
                reviewed_by INT
            );
            CREATE TABLE IF NOT EXISTS paper_trades (
                id SERIAL PRIMARY KEY, user_id VARCHAR NOT NULL,
                symbol TEXT NOT NULL, trade_type TEXT NOT NULL, quantity INT NOT NULL,
                entry_price FLOAT NOT NULL, exit_price FLOAT, stop_loss FLOAT, target FLOAT,
                status TEXT DEFAULT 'open', pnl FLOAT, created_at TIMESTAMP DEFAULT NOW(), closed_at TIMESTAMP
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS watchlists (
                id SERIAL PRIMARY KEY, user_id VARCHAR NOT NULL,
                symbols TEXT[] DEFAULT '{}', updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS api_settings (
                id SERIAL PRIMARY KEY, key TEXT UNIQUE NOT NULL,
                value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS ohlcv_cache (
                id SERIAL PRIMARY KEY, symbol TEXT NOT NULL, interval TEXT NOT NULL,
                data JSONB NOT NULL, from_date TEXT NOT NULL, to_date TEXT NOT NULL,
                cached_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(symbol, interval, from_date, to_date)
            )
        """)
        # Forward Testing tables
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS forward_tests (
                id SERIAL PRIMARY KEY, user_id VARCHAR NOT NULL,
                name TEXT NOT NULL, strategy TEXT NOT NULL, symbols TEXT[] NOT NULL,
                params JSONB DEFAULT '{}', initial_capital FLOAT DEFAULT 100000,
                current_capital FLOAT DEFAULT 100000, status TEXT DEFAULT 'active',
                weighting TEXT DEFAULT 'equal', rebalance_freq TEXT DEFAULT 'daily',
                slippage_pct FLOAT DEFAULT 0.05, txn_cost_pct FLOAT DEFAULT 0.1,
                max_positions INT DEFAULT 10, position_size_pct FLOAT DEFAULT 10,
                sector_cap_pct FLOAT DEFAULT 30, min_market_cap FLOAT DEFAULT 0,
                lookback_days INT DEFAULT 200, last_scan_at TIMESTAMP,
                last_rebalance_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS forward_test_positions (
                id SERIAL PRIMARY KEY, fwd_test_id INT REFERENCES forward_tests(id) ON DELETE CASCADE,
                symbol TEXT NOT NULL, quantity INT NOT NULL, entry_price FLOAT NOT NULL,
                current_price FLOAT, stop_loss FLOAT, target FLOAT, trailing_stop FLOAT,
                signal_type TEXT DEFAULT 'BUY', entry_date TIMESTAMP DEFAULT NOW(),
                unrealized_pnl FLOAT DEFAULT 0, unrealized_pnl_pct FLOAT DEFAULT 0,
                bars_held INT DEFAULT 0, sector TEXT, fundamentals JSONB DEFAULT '{}',
                status TEXT DEFAULT 'open'
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS forward_test_trades (
                id SERIAL PRIMARY KEY, fwd_test_id INT REFERENCES forward_tests(id) ON DELETE CASCADE,
                symbol TEXT NOT NULL, action TEXT NOT NULL, quantity INT NOT NULL,
                price FLOAT NOT NULL, pnl FLOAT DEFAULT 0, pnl_pct FLOAT DEFAULT 0,
                exit_reason TEXT, fees FLOAT DEFAULT 0, executed_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS forward_test_signals (
                id SERIAL PRIMARY KEY, fwd_test_id INT REFERENCES forward_tests(id) ON DELETE CASCADE,
                symbol TEXT NOT NULL, signal_type TEXT NOT NULL, signal_strength FLOAT DEFAULT 0,
                price_at_signal FLOAT, strategy_data JSONB DEFAULT '{}',
                status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS forward_test_snapshots (
                id SERIAL PRIMARY KEY, fwd_test_id INT REFERENCES forward_tests(id) ON DELETE CASCADE,
                portfolio_value FLOAT NOT NULL, cash FLOAT NOT NULL, positions_value FLOAT NOT NULL,
                num_positions INT DEFAULT 0, daily_return_pct FLOAT DEFAULT 0,
                cumulative_return_pct FLOAT DEFAULT 0, drawdown_pct FLOAT DEFAULT 0,
                snapshot_date DATE NOT NULL, created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(fwd_test_id, snapshot_date)
            )
        """)
        # Model Portfolios
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS alpha_options_signals (
                id SERIAL PRIMARY KEY,
                signal_date DATE DEFAULT CURRENT_DATE,
                symbol TEXT NOT NULL,
                strategy TEXT NOT NULL,
                strategy_name TEXT,
                direction TEXT DEFAULT 'BULLISH',
                legs JSONB DEFAULT '[]',
                lots INT DEFAULT 1,
                lot_size INT DEFAULT 50,
                capital_required FLOAT DEFAULT 0,
                max_profit FLOAT DEFAULT 0,
                max_loss FLOAT DEFAULT 0,
                entry_price FLOAT DEFAULT 0,
                net_debit_credit FLOAT DEFAULT 0,
                expiry_date DATE,
                trigger_reason TEXT DEFAULT '',
                alphascore FLOAT DEFAULT 0,
                conviction FLOAT DEFAULT 0,
                regime TEXT DEFAULT '',
                vix FLOAT DEFAULT 0,
                status TEXT DEFAULT 'OPEN',
                close_price FLOAT DEFAULT 0,
                actual_pnl FLOAT DEFAULT 0,
                actual_pnl_pct FLOAT DEFAULT 0,
                close_reason TEXT DEFAULT '',
                close_date DATE,
                evaluation TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW(),
                closed_at TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS model_portfolios (
                id SERIAL PRIMARY KEY, user_id VARCHAR NOT NULL,
                name TEXT NOT NULL, description TEXT DEFAULT '',
                portfolio_type TEXT DEFAULT 'custom',
                screener_strategy TEXT, backtest_strategy TEXT, forward_strategy TEXT,
                params JSONB DEFAULT '{}',
                initial_capital FLOAT DEFAULT 100000,
                weighting TEXT DEFAULT 'equal',
                max_holdings INT DEFAULT 15,
                rebalance_freq TEXT DEFAULT 'monthly',
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS model_portfolio_holdings (
                id SERIAL PRIMARY KEY, portfolio_id INT REFERENCES model_portfolios(id) ON DELETE CASCADE,
                symbol TEXT NOT NULL, weight_pct FLOAT DEFAULT 0,
                shares INT DEFAULT 0, entry_price FLOAT, current_price FLOAT,
                screener_rank INT, signal_type TEXT DEFAULT 'BUY',
                signal_strength FLOAT DEFAULT 0,
                sector TEXT, fundamentals JSONB DEFAULT '{}',
                paper_trade_id INT,
                added_at TIMESTAMP DEFAULT NOW(), status TEXT DEFAULT 'active'
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS model_portfolio_snapshots (
                id SERIAL PRIMARY KEY, portfolio_id INT REFERENCES model_portfolios(id) ON DELETE CASCADE,
                total_value FLOAT, holdings_data JSONB DEFAULT '[]',
                return_pct FLOAT DEFAULT 0, benchmark_return_pct FLOAT DEFAULT 0,
                snapshot_date DATE NOT NULL, created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(portfolio_id, snapshot_date)
            )
        """)
        # Advisory reports for SEBI-registered advisors
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS advisory_reports (
                id SERIAL PRIMARY KEY, user_id VARCHAR NOT NULL,
                title TEXT NOT NULL, report_type TEXT DEFAULT 'screener',
                advisor_name TEXT DEFAULT '', ria_reg_no TEXT DEFAULT '',
                disclaimer TEXT DEFAULT '',
                status TEXT DEFAULT 'draft', pdf_path TEXT,
                created_at TIMESTAMP DEFAULT NOW(), published_at TIMESTAMP
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS advisory_recommendations (
                id SERIAL PRIMARY KEY, report_id INT REFERENCES advisory_reports(id) ON DELETE CASCADE,
                user_id VARCHAR NOT NULL,
                symbol TEXT NOT NULL, call_type TEXT NOT NULL,
                entry_price FLOAT, target_price FLOAT, stop_loss FLOAT,
                time_horizon TEXT DEFAULT 'short_term',
                rationale TEXT DEFAULT '', rationale_edited BOOLEAN DEFAULT false,
                technical_data JSONB DEFAULT '{}', fundamental_data JSONB DEFAULT '{}',
                pdf_path TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        # ── Alerts & Notifications ──
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id SERIAL PRIMARY KEY, user_id VARCHAR NOT NULL,
                name TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id INT,
                symbol TEXT,
                conditions JSONB DEFAULT '{}',
                status TEXT DEFAULT 'active',
                last_triggered_at TIMESTAMP,
                trigger_count INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY, user_id VARCHAR NOT NULL,
                alert_id INT REFERENCES alerts(id) ON DELETE SET NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                notif_type TEXT DEFAULT 'alert',
                entity_type TEXT,
                entity_id INT,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)

async def ensure_admin():
    async with db_pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT id FROM users WHERE email=$1", ADMIN_EMAIL)
        if not existing:
            pw_hash = hash_password("AlphaAdmin2026")
            uid = await conn.fetchval(
                "INSERT INTO users (email, name, password_hash, is_admin) VALUES ($1,$2,$3,true) RETURNING id",
                ADMIN_EMAIL, "Admin", pw_hash
            )
            await conn.execute("INSERT INTO watchlists (user_id) VALUES ($1)", uid)
            print(f"Admin created: {ADMIN_EMAIL}")

# ── Auth Helpers ──────────────────────────────────────────────────────────────
def hash_password(p): return hashlib.sha256(p.encode()).hexdigest()
def create_token(uid, email, is_admin):
    return jwt.encode({"sub": str(uid), "email": email, "admin": is_admin, "exp": datetime.utcnow()+timedelta(days=7)}, SECRET_KEY, algorithm="HS256")
def decode_token(t):
    try: return jwt.decode(t, SECRET_KEY, algorithms=["HS256"])
    except: return None

async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)):
    # Option 0: Internal service key bypass (AIF → DYOR)
    internal_key = request.headers.get("x-internal-key") or request.headers.get("X-Internal-Key")
    if internal_key == "3f9dd0ce942c74fb9988518041b50c94fa2da6aa2778da8c":
        return {"id": 0, "email": "internal@alphalens.tech", "username": "alphalens-aif", "is_admin": True, "is_active": True}
    # Option 1: User already authenticated via AlphaMarket session (middleware)
    dyor_user = getattr(request.state, 'dyor_user', None)
    if dyor_user:
        return dict(dyor_user)
    # Option 2: Fall back to JWT Bearer token (original auth)
    if not credentials: raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if not payload: raise HTTPException(status_code=401, detail="Invalid token")
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM users WHERE id=$1 AND is_active=true", int(payload["sub"]))
    if not user: raise HTTPException(status_code=401, detail="User not found")
    return dict(user)

async def get_admin_user(user=Depends(get_current_user)):
    if not user["is_admin"]: raise HTTPException(status_code=403, detail="Admin only")
    return user

# ── Groww Token Management ────────────────────────────────────────────────────
async def get_groww_token():
    # 1. Check DYOR's own database first
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT value FROM api_settings WHERE key='groww_token'")
        if row and row["value"]:
            return row["value"]
    # 2. Auto-sync from testalpha's alphaforge database
    try:
        import asyncpg as _apg
        _af_conn = await _apg.connect("postgresql://dyor_user:DyorSecure2026Mar@localhost:5432/alphaforge")
        try:
            _af_row = await _af_conn.fetchrow("SELECT value FROM api_settings WHERE key='groww_token'")
            if _af_row and _af_row["value"]:
                # Cache it in DYOR's own DB for future use
                async with db_pool.acquire() as conn:
                    await conn.execute(
                        "INSERT INTO api_settings (key, value, updated_at) VALUES ('groww_token', $1, NOW()) "
                        "ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()",
                        _af_row["value"]
                    )
                return _af_row["value"]
        finally:
            await _af_conn.close()
    except Exception as _e:
        print(f"Auto-sync groww token from alphaforge failed: {_e}")
    # 3. Fallback to env var
    return os.getenv("GROWW_API_KEY", "")

async def set_groww_token(token: str):
    async with db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO api_settings (key, value, updated_at) VALUES ('groww_token', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()
        """, token)

# ── Schemas ───────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email: str = Field(..., description="User email address", examples=["advisor@example.com"])
    name: str = Field(..., description="Full name", examples=["Rahul Sharma"])
    password: str = Field(..., description="Password (min 6 characters)")
    invite_code: Optional[str] = Field(None, description="Invite code (required if platform is invite-only)")
    user_type: Optional[str] = Field("individual", description="User type: individual, ra (Research Analyst), ria (Investment Advisor)")
    sebi_reg_no: Optional[str] = Field("", description="SEBI registration number (for RA/RIA)", examples=["INH000012345"])

class LoginRequest(BaseModel):
    email: str; password: str

class BacktestRequest(BaseModel):
    name: str = Field(..., description="Name for this backtest", examples=["RELIANCE Momentum Test"])
    strategy: str = Field(..., description="Strategy name: SMA_CROSSOVER, EMA_CROSSOVER, RSI, MACD, BOLLINGER, SUPERTREND, BREAKOUT, MOMENTUM, ADX_TREND, GOLDEN_CROSS, etc.", examples=["MACD"])
    symbol: str = Field(..., description="NSE stock symbol", examples=["RELIANCE"])
    from_date: str = Field(..., description="Start date (YYYY-MM-DD)", examples=["2023-01-01"])
    to_date: str = Field(..., description="End date (YYYY-MM-DD)", examples=["2024-12-31"])
    initial_capital: float = Field(100000, description="Starting capital in INR", examples=[100000])
    params: Optional[Dict[str, Any]] = Field({}, description="Strategy-specific parameters (e.g. sma_short, sma_long, rsi_period)")

class PaperTradeRequest(BaseModel):
    symbol: str = Field(..., description="NSE stock symbol", examples=["RELIANCE"])
    trade_type: str = Field(..., description="Trade direction: BUY or SELL", examples=["BUY"])
    quantity: int = Field(..., description="Number of shares", examples=[10])
    entry_price: float = Field(..., description="Entry price per share in INR", examples=[2450.50])
    stop_loss: Optional[float] = Field(None, description="Stop-loss price", examples=[2380.00])
    target: Optional[float] = Field(None, description="Target price", examples=[2600.00])

class ForwardTestCreate(BaseModel):
    name: str = Field(..., description="Name for this forward test", examples=["Momentum Large Cap"])
    strategy: str = Field(..., description="Strategy to run", examples=["momentum"])
    symbols: List[str] = Field(..., description="List of NSE symbols to test", examples=[["RELIANCE", "TCS", "INFY", "HDFCBANK"]])
    params: dict = Field({}, description="Strategy-specific parameters")
    initial_capital: float = Field(100000, description="Starting capital in INR")
    weighting: str = Field("equal", description="Position weighting: equal, market_cap, risk_parity")
    rebalance_freq: str = Field("daily", description="Rebalance frequency: daily, weekly, monthly")
    max_positions: int = Field(10, description="Maximum simultaneous positions")
    position_size_pct: float = Field(10, description="Each position size as % of capital")
    sector_cap_pct: float = Field(30, description="Maximum allocation to any single sector (%)")
    lookback_days: int = Field(200, description="Historical data lookback for indicator calculation")
    slippage_pct: float = Field(0.05, description="Assumed slippage per trade (%)")
    txn_cost_pct: float = Field(0.1, description="Transaction cost per trade (%)")

class ModelPortfolioCreate(BaseModel):
    name: str = Field(..., description="Portfolio name", examples=["Large Cap Momentum"])
    description: str = Field("", description="Portfolio description")
    portfolio_type: str = Field("custom", description="Type: custom, screener_based, backtest_based, forward_based")
    screener_strategy: Optional[str] = Field(None, description="Screener strategy to source stocks from", examples=["momentum"])
    backtest_strategy: Optional[str] = Field(None, description="Backtest strategy for validation")
    forward_strategy: Optional[str] = Field(None, description="Forward test strategy for live tracking")
    params: dict = Field({}, description="Strategy parameters")
    initial_capital: float = Field(100000, description="Portfolio capital in INR")
    weighting: str = Field("equal", description="Weighting method: equal, market_cap, risk_parity, custom")
    max_holdings: int = Field(15, description="Maximum number of holdings (1-50)")
    rebalance_freq: str = Field("monthly", description="Rebalance frequency: daily, weekly, monthly, quarterly")
    sector_filter: Optional[str] = Field("", description="Filter to specific sector", examples=["Financial Services"])

class InviteRequest(BaseModel):
    count: int = 1

class TokenUpdateRequest(BaseModel):
    token: str

class StrategyParams(BaseModel):
    symbol: str
    from_date: str
    to_date: str
    interval: str = "1day"
    params: Optional[Dict[str, Any]] = {}

# ── Groww Data Service ────────────────────────────────────────────────────────
async def fetch_groww_candles(symbol: str, from_date: str, to_date: str, interval: str = "1day") -> pd.DataFrame:
    """Fetch OHLCV data from Yahoo Finance with DB caching"""
    # Check cache first
    async with db_pool.acquire() as conn:
        cached = await conn.fetchrow(
            "SELECT data FROM ohlcv_cache WHERE symbol=$1 AND interval=$2 AND from_date=$3 AND to_date=$4",
            symbol.upper(), interval, from_date, to_date
        )
        if cached:
            data = json.loads(cached["data"])
            df = pd.DataFrame(data)
            df["date"] = pd.to_datetime(df["date"])
            df = df.set_index("date")
            return df

    try:
        # Try data service first
        interval_map = {"1day": "1d", "1week": "1wk", "1month": "1mo", "60minute": "60m", "15minute": "15m", "5minute": "5m"}
        _ds_rows = await ds_ohlcv(symbol, interval_map.get(interval, "1d"))
        if _ds_rows:
            df = pd.DataFrame(_ds_rows)
            df.columns = [c.lower() for c in df.columns]
            for dc in ["date", "datetime", "timestamp"]:
                if dc in df.columns:
                    df[dc] = pd.to_datetime(df[dc])
                    df = df.set_index(dc)
                    break
            df.index.name = "date"
            keep = [c for c in ["open","high","low","close","volume"] if c in df.columns]
            df = df[keep].astype({c: float for c in keep}).dropna().sort_index()
        else:
            df = pd.DataFrame()

        if df.empty:
            # Fallback to yfinance
            import yfinance as yf
            yf_symbol = f"{symbol.upper()}.NS"
            yf_interval = interval_map.get(interval, "1d")
            ticker = yf.Ticker(yf_symbol)
            df = ticker.history(start=from_date, end=to_date, interval=yf_interval)
            if df.empty:
                ticker = yf.Ticker(f"^NSEI" if symbol.upper() in ["NIFTY","NIFTY50"] else yf_symbol)
                df = ticker.history(start=from_date, end=to_date, interval=yf_interval)
            if not df.empty:
                df = df[["Open","High","Low","Close","Volume"]].copy()
                df.columns = ["open","high","low","close","volume"]
                df.index.name = "date"
                df = df.sort_index().astype({"open":float,"high":float,"low":float,"close":float,"volume":float}).dropna()

        if df.empty:
            raise HTTPException(status_code=400, detail=f"No data found for {symbol}. Check symbol name (e.g. RELIANCE, TCS, HDFCBANK)")

        # Cache it
        cache_data = df.reset_index().to_json(orient="records", date_format="iso")
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO ohlcv_cache (symbol, interval, data, from_date, to_date)
                VALUES ($1,$2,$3,$4,$5) ON CONFLICT (symbol, interval, from_date, to_date) DO UPDATE SET data=$3, cached_at=NOW()
            """, symbol.upper(), interval, cache_data, from_date, to_date)

        return df

    except HTTPException: raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data fetch error: {str(e)}")

# ── Indicator Engine ──────────────────────────────────────────────────────────
def compute_indicators(df: pd.DataFrame, requested: List[str] = None) -> pd.DataFrame:
    """Compute all technical indicators using the 'ta' library"""
    import ta

    c = df["close"].astype(float)
    h = df["high"].astype(float)
    l = df["low"].astype(float)
    v = df["volume"].astype(float)

    # ── Trend ──
    df["sma_20"] = ta.trend.sma_indicator(c, window=20)
    df["sma_50"] = ta.trend.sma_indicator(c, window=50)
    df["sma_200"] = ta.trend.sma_indicator(c, window=200)
    df["ema_9"] = ta.trend.ema_indicator(c, window=9)
    df["ema_20"] = ta.trend.ema_indicator(c, window=20)
    df["ema_50"] = ta.trend.ema_indicator(c, window=50)

    # MACD
    macd = ta.trend.MACD(c, window_fast=12, window_slow=26, window_sign=9)
    df["macd"] = macd.macd()
    df["macd_signal"] = macd.macd_signal()
    df["macd_hist"] = macd.macd_diff()

    # ADX
    adx = ta.trend.ADXIndicator(h, l, c, window=14)
    df["adx"] = adx.adx()
    df["adx_pos"] = adx.adx_pos()
    df["adx_neg"] = adx.adx_neg()

    # Supertrend (manual - not in ta library)
    df = compute_supertrend(df, period=10, multiplier=3.0)

    # ── Momentum ──
    df["rsi_14"] = ta.momentum.RSIIndicator(c, window=14).rsi()
    df["rsi_7"] = ta.momentum.RSIIndicator(c, window=7).rsi()

    stoch = ta.momentum.StochasticOscillator(h, l, c, window=14, smooth_window=3)
    df["stoch_k"] = stoch.stoch()
    df["stoch_d"] = stoch.stoch_signal()

    df["williams_r"] = ta.momentum.WilliamsRIndicator(h, l, c, lbp=14).williams_r()
    df["roc"] = ta.momentum.ROCIndicator(c, window=12).roc()

    # ── Volatility ──
    bb = ta.volatility.BollingerBands(c, window=20, window_dev=2)
    df["bb_upper"] = bb.bollinger_hband()
    df["bb_mid"] = bb.bollinger_mavg()
    df["bb_lower"] = bb.bollinger_lband()
    df["bb_width"] = bb.bollinger_wband()
    df["bb_pct"] = bb.bollinger_pband()

    df["atr"] = ta.volatility.AverageTrueRange(h, l, c, window=14).average_true_range()

    kc = ta.volatility.KeltnerChannel(h, l, c, window=20)
    df["kc_upper"] = kc.keltner_channel_hband()
    df["kc_lower"] = kc.keltner_channel_lband()

    # ── Volume ──
    df["obv"] = ta.volume.OnBalanceVolumeIndicator(c, v).on_balance_volume()
    df["vwap"] = ta.volume.VolumeWeightedAveragePrice(h, l, c, v).volume_weighted_average_price()
    df["cmf"] = ta.volume.ChaikinMoneyFlowIndicator(h, l, c, v, window=20).chaikin_money_flow()

    # ── Derived signals ──
    df["above_200sma"] = (c > df["sma_200"]).astype(int)
    df["golden_cross"] = ((df["sma_50"] > df["sma_200"]) & (df["sma_50"].shift(1) <= df["sma_200"].shift(1))).astype(int)
    df["death_cross"] = ((df["sma_50"] < df["sma_200"]) & (df["sma_50"].shift(1) >= df["sma_200"].shift(1))).astype(int)
    df["vol_spike"] = (v > v.rolling(20).mean() * 1.5).astype(int)

    # NR7 — Narrowest range in 7 days
    df["range"] = h - l
    df["nr7"] = (df["range"] == df["range"].rolling(7).min()).astype(int)

    return df

def compute_supertrend(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0) -> pd.DataFrame:
    h, l, c = df["high"], df["low"], df["close"]
    hl2 = (h + l) / 2

    # ATR
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(span=period, adjust=False).mean()

    upper = hl2 + multiplier * atr
    lower = hl2 - multiplier * atr

    supertrend = pd.Series(index=df.index, dtype=float)
    direction = pd.Series(index=df.index, dtype=int)

    for i in range(1, len(df)):
        if c.iloc[i] > upper.iloc[i-1]:
            direction.iloc[i] = 1   # bullish
            supertrend.iloc[i] = lower.iloc[i]
        elif c.iloc[i] < lower.iloc[i-1]:
            direction.iloc[i] = -1  # bearish
            supertrend.iloc[i] = upper.iloc[i]
        else:
            direction.iloc[i] = direction.iloc[i-1]
            supertrend.iloc[i] = lower.iloc[i] if direction.iloc[i] == 1 else upper.iloc[i]

    df["supertrend"] = supertrend
    df["supertrend_dir"] = direction
    return df

# ── Strategy Engine ───────────────────────────────────────────────────────────

def fetch_fundamentals_sync(symbol: str) -> dict:
    """Fetch fundamental data via data service with yfinance fallback."""
    import asyncio as _a
    try:
        try:
            loop = _a.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    info = pool.submit(lambda: _a.run(ds_fundamentals(symbol))).result(timeout=10)
            else:
                info = _a.run(ds_fundamentals(symbol))
            if info and info.get("symbol"):
                return {
                    "pe_trailing": info.get("pe_trailing"), "pe_forward": info.get("pe_forward"),
                    "pb": info.get("pb"), "dividend_yield": info.get("dividend_yield", 0),
                    "roe": info.get("roe", 0), "debt_equity": info.get("debt_equity", 0),
                    "profit_margin": info.get("profit_margin", 0), "operating_margin": info.get("operating_margin", 0),
                    "eps": info.get("eps"), "revenue": info.get("revenue"),
                    "revenue_growth": info.get("revenue_growth"), "earnings_growth": info.get("earnings_growth"),
                    "market_cap": info.get("market_cap"), "book_value": info.get("book_value"),
                }
        except: pass
        # Fallback to yfinance
        import yfinance as yf
        ticker = yf.Ticker(f"{symbol.upper()}.NS")
        info = ticker.info or {}
        def sf(key, default=None):
            v = info.get(key)
            if v is None: return default
            try:
                v = float(v)
                return default if (np.isnan(v) or np.isinf(v)) else v
            except: return default

        return {
            "pe_trailing": sf("trailingPE"),
            "pe_forward": sf("forwardPE"),
            "pb": sf("priceToBook"),
            "ps": sf("priceToSalesTrailing12Months"),
            "ev_ebitda": sf("enterpriseToEbitda"),
            "peg": sf("pegRatio"),
            "dividend_yield": sf("dividendYield", 0),
            "roe": sf("returnOnEquity", 0),
            "roa": sf("returnOnAssets", 0),
            "debt_equity": sf("debtToEquity", 0),
            "current_ratio": sf("currentRatio"),
            "profit_margin": sf("profitMargins", 0),
            "operating_margin": sf("operatingMargins", 0),
            "gross_margin": sf("grossMargins", 0),
            "revenue_growth": sf("revenueGrowth", 0),
            "earnings_growth": sf("earningsGrowth", 0),
            "revenue": sf("totalRevenue"),
            "ebitda": sf("ebitda"),
            "free_cash_flow": sf("freeCashflow"),
            "operating_cash_flow": sf("operatingCashflow"),
            "total_debt": sf("totalDebt", 0),
            "total_cash": sf("totalCash", 0),
            "market_cap": sf("marketCap"),
            "enterprise_value": sf("enterpriseValue"),
            "beta": sf("beta", 1.0),
            "eps_trailing": sf("trailingEps"),
            "eps_forward": sf("forwardEps"),
            "book_value": sf("bookValue"),
            "52w_high": sf("fiftyTwoWeekHigh"),
            "52w_low": sf("fiftyTwoWeekLow"),
            "avg_volume": sf("averageVolume"),
            "shares_outstanding": sf("sharesOutstanding"),
        }
    except:
        return {}

def run_strategy(df: pd.DataFrame, strategy: str, params: dict, initial_capital: float) -> dict:
    strategies = {
        # ── Technical (existing) ──
        "SMA_CROSSOVER": strategy_sma_crossover,
        "EMA_CROSSOVER": strategy_ema_crossover,
        "RSI": strategy_rsi,
        "MACD": strategy_macd,
        "BOLLINGER": strategy_bollinger,
        "SUPERTREND": strategy_supertrend,
        "BREAKOUT": strategy_breakout,
        "MOMENTUM": strategy_momentum,
        "ADX_TREND": strategy_adx_trend,
        "GOLDEN_CROSS": strategy_golden_cross,
        # ── Technical (new) ──
        "VWAP_REVERSION": strategy_vwap_reversion,
        "STOCHASTIC": strategy_stochastic,
        "KELTNER_BREAKOUT": strategy_keltner_breakout,
        "NR7_EXPANSION": strategy_nr7_expansion,
        "OBV_DIVERGENCE": strategy_obv_divergence,
        "TRIPLE_EMA": strategy_triple_ema,
        "ATR_CHANNEL": strategy_atr_channel,
        "MEAN_REVERSION": strategy_mean_reversion,
        # ── Value Strategies ──
        "VALUE_LOW_PE": strategy_value_low_pe,
        "VALUE_HIGH_DIVIDEND": strategy_value_high_dividend,
        "VALUE_DEEP_VALUE": strategy_value_deep_value,
        "VALUE_LOW_PB": strategy_value_low_pb,
        "VALUE_FCF_YIELD": strategy_value_fcf_yield,
        "VALUE_GARP": strategy_value_garp,
        # ── Quality Strategies ──
        "QUALITY_HIGH_ROE": strategy_quality_high_roe,
        "QUALITY_LOW_DEBT": strategy_quality_low_debt,
        "QUALITY_PIOTROSKI": strategy_quality_piotroski,
        "QUALITY_MOAT": strategy_quality_moat,
        # ── Growth Strategies ──
        "GROWTH_HIGH_EPS": strategy_growth_high_eps,
        "GROWTH_REVENUE": strategy_growth_revenue,
        "GROWTH_MARGIN_EXPANSION": strategy_growth_margin_expansion,
        # ── Hybrid (Techno-Fundamental) ──
        "HYBRID_ROE_TREND": strategy_hybrid_roe_trend,
        "HYBRID_GROWTH_BREAKOUT": strategy_hybrid_growth_breakout,
        "HYBRID_LOW_DEBT_MOMENTUM": strategy_hybrid_low_debt_momentum,
        "HYBRID_VALUE_REVERSAL": strategy_hybrid_value_reversal,
        "HYBRID_QUALITY_MOMENTUM": strategy_hybrid_quality_momentum,
        # ── Factor Models ──
        "FACTOR_LOW_VOLATILITY": strategy_factor_low_volatility,
        "FACTOR_BETA_NEUTRAL": strategy_factor_beta_neutral,
        "FACTOR_QUALITY": strategy_factor_quality,
        "FACTOR_SIZE": strategy_factor_size,
    }

    fn = strategies.get(strategy, strategy_sma_crossover)

    # For fundamental strategies, fetch fundamentals
    symbol = params.get("_symbol", "")
    fundamentals = {}
    if strategy.startswith("VALUE_") or strategy.startswith("QUALITY_") or strategy.startswith("GROWTH_") or strategy.startswith("HYBRID_") or strategy.startswith("FACTOR_"):
        try:
            fundamentals = fetch_fundamentals_sync(symbol)
        except:
            fundamentals = {}
    params["_fundamentals"] = fundamentals

    signals = fn(df, params)

    # Select exit strategy
    exit_type = params.get("exit_strategy", "signal")
    return simulate_trades_v2(df, signals, initial_capital, params, exit_type)


# ══════════════════════════════════════════════════════════════════════════════
# TECHNICAL STRATEGIES (existing)
# ══════════════════════════════════════════════════════════════════════════════

def strategy_sma_crossover(df, params):
    fast = int(params.get("fast_period", 20))
    slow = int(params.get("slow_period", 50))
    df["fast"] = df["close"].rolling(fast).mean()
    df["slow"] = df["close"].rolling(slow).mean()
    signals = pd.Series(0, index=df.index)
    signals[df["fast"] > df["slow"]] = 1
    signals[df["fast"] < df["slow"]] = -1
    return signals

def strategy_ema_crossover(df, params):
    fast = int(params.get("fast_period", 9))
    slow = int(params.get("slow_period", 21))
    fast_ema = df["close"].ewm(span=fast, adjust=False).mean()
    slow_ema = df["close"].ewm(span=slow, adjust=False).mean()
    signals = pd.Series(0, index=df.index)
    signals[fast_ema > slow_ema] = 1
    signals[fast_ema < slow_ema] = -1
    return signals

def strategy_rsi(df, params):
    oversold = float(params.get("oversold", 30))
    overbought = float(params.get("overbought", 70))
    rsi = df.get("rsi_14", df["close"].diff().apply(lambda x: max(x,0)).rolling(14).mean() /
                 df["close"].diff().abs().rolling(14).mean() * 100)
    signals = pd.Series(0, index=df.index)
    signals[rsi < oversold] = 1
    signals[rsi > overbought] = -1
    return signals

def strategy_macd(df, params):
    signals = pd.Series(0, index=df.index)
    if "macd" in df.columns and "macd_signal" in df.columns:
        signals[df["macd"] > df["macd_signal"]] = 1
        signals[df["macd"] < df["macd_signal"]] = -1
    return signals

def strategy_bollinger(df, params):
    signals = pd.Series(0, index=df.index)
    if "bb_upper" in df.columns:
        signals[df["close"] < df["bb_lower"]] = 1
        signals[df["close"] > df["bb_upper"]] = -1
    return signals

def strategy_supertrend(df, params):
    signals = pd.Series(0, index=df.index)
    if "supertrend_dir" in df.columns:
        signals[df["supertrend_dir"] == 1] = 1
        signals[df["supertrend_dir"] == -1] = -1
    return signals

def strategy_breakout(df, params):
    window = int(params.get("window", 20))
    signals = pd.Series(0, index=df.index)
    rolling_high = df["high"].rolling(window).max()
    rolling_low = df["low"].rolling(window).min()
    signals[df["close"] > rolling_high.shift(1)] = 1
    signals[df["close"] < rolling_low.shift(1)] = -1
    return signals

def strategy_momentum(df, params):
    period = int(params.get("period", 12))
    signals = pd.Series(0, index=df.index)
    roc = df["close"].pct_change(period)
    signals[roc > 0] = 1
    signals[roc < 0] = -1
    return signals

def strategy_adx_trend(df, params):
    threshold = float(params.get("adx_threshold", 25))
    signals = pd.Series(0, index=df.index)
    if "adx" in df.columns:
        strong_trend = df["adx"] > threshold
        signals[strong_trend & (df["adx_pos"] > df["adx_neg"])] = 1
        signals[strong_trend & (df["adx_neg"] > df["adx_pos"])] = -1
    return signals

def strategy_golden_cross(df, params):
    signals = pd.Series(0, index=df.index)
    if "sma_50" in df.columns and "sma_200" in df.columns:
        signals[df["sma_50"] > df["sma_200"]] = 1
        signals[df["sma_50"] < df["sma_200"]] = -1
    return signals


# ══════════════════════════════════════════════════════════════════════════════
# NEW TECHNICAL STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def strategy_vwap_reversion(df, params):
    """Buy below VWAP, sell above — mean reversion intraday strategy"""
    signals = pd.Series(0, index=df.index)
    if "vwap" in df.columns:
        deviation = float(params.get("vwap_deviation_pct", 1.5)) / 100
        signals[df["close"] < df["vwap"] * (1 - deviation)] = 1
        signals[df["close"] > df["vwap"] * (1 + deviation)] = -1
    return signals

def strategy_stochastic(df, params):
    """Stochastic Oscillator crossover strategy"""
    oversold = float(params.get("stoch_oversold", 20))
    overbought = float(params.get("stoch_overbought", 80))
    signals = pd.Series(0, index=df.index)
    if "stoch_k" in df.columns:
        signals[(df["stoch_k"] < oversold) & (df["stoch_k"] > df["stoch_d"])] = 1
        signals[(df["stoch_k"] > overbought) & (df["stoch_k"] < df["stoch_d"])] = -1
    return signals

def strategy_keltner_breakout(df, params):
    """Keltner Channel breakout strategy"""
    signals = pd.Series(0, index=df.index)
    if "kc_upper" in df.columns:
        signals[df["close"] > df["kc_upper"]] = 1
        signals[df["close"] < df["kc_lower"]] = -1
    return signals

def strategy_nr7_expansion(df, params):
    """NR7 (Narrowest Range 7 days) — buy on expansion from compression"""
    signals = pd.Series(0, index=df.index)
    if "nr7" in df.columns and "atr" in df.columns:
        for i in range(2, len(df)):
            if df["nr7"].iloc[i-1] == 1:
                if df["close"].iloc[i] > df["high"].iloc[i-1]:
                    signals.iloc[i] = 1
                elif df["close"].iloc[i] < df["low"].iloc[i-1]:
                    signals.iloc[i] = -1
    return signals

def strategy_obv_divergence(df, params):
    """On Balance Volume trend — buy when OBV rising, sell when falling"""
    signals = pd.Series(0, index=df.index)
    if "obv" in df.columns:
        obv_ma = df["obv"].rolling(20).mean()
        signals[df["obv"] > obv_ma] = 1
        signals[df["obv"] < obv_ma] = -1
    return signals

def strategy_triple_ema(df, params):
    """Triple EMA (TEMA) — 9/21/55 alignment"""
    ema_fast = int(params.get("tema_fast", 9))
    ema_mid = int(params.get("tema_mid", 21))
    ema_slow = int(params.get("tema_slow", 55))
    e1 = df["close"].ewm(span=ema_fast, adjust=False).mean()
    e2 = df["close"].ewm(span=ema_mid, adjust=False).mean()
    e3 = df["close"].ewm(span=ema_slow, adjust=False).mean()
    signals = pd.Series(0, index=df.index)
    signals[(e1 > e2) & (e2 > e3)] = 1
    signals[(e1 < e2) & (e2 < e3)] = -1
    return signals

def strategy_atr_channel(df, params):
    """ATR Channel — buy at lower channel, sell at upper"""
    multiplier = float(params.get("atr_multiplier", 2.0))
    period = int(params.get("atr_period", 14))
    signals = pd.Series(0, index=df.index)
    if "atr" in df.columns:
        mid = df["close"].ewm(span=20, adjust=False).mean()
        upper = mid + multiplier * df["atr"]
        lower = mid - multiplier * df["atr"]
        signals[df["close"] < lower] = 1
        signals[df["close"] > upper] = -1
    return signals

def strategy_mean_reversion(df, params):
    """Z-Score mean reversion — buy when z < -2, sell when z > 2"""
    lookback = int(params.get("mean_rev_lookback", 20))
    z_buy = float(params.get("z_score_buy", -2.0))
    z_sell = float(params.get("z_score_sell", 2.0))
    mean = df["close"].rolling(lookback).mean()
    std = df["close"].rolling(lookback).std()
    z_score = (df["close"] - mean) / std
    signals = pd.Series(0, index=df.index)
    signals[z_score < z_buy] = 1
    signals[z_score > z_sell] = -1
    return signals


# ══════════════════════════════════════════════════════════════════════════════
# VALUE STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def _fundamental_signal(df, params, buy_check, hold_check=None):
    """Generic: fundamental filter sets buy signal, technical or fundamentals handle exit."""
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)

    if not fund:
        return signals

    is_buy = buy_check(fund)
    is_hold = hold_check(fund) if hold_check else is_buy

    if is_buy:
        # Use 200 DMA as timing filter if available
        use_dma = params.get("use_dma_filter", True)
        if use_dma and "sma_200" in df.columns:
            signals[df["close"] > df["sma_200"]] = 1
            signals[df["close"] < df["sma_200"] * 0.95] = -1
        else:
            # Pure fundamental: buy and hold (signal stays 1)
            signals[:] = 1
    elif not is_hold:
        signals[:] = -1

    return signals

def strategy_value_low_pe(df, params):
    """Low P/E: Buy when P/E is below threshold, hold above 200 DMA"""
    pe_max = float(params.get("pe_max", 15))
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("pe_trailing") is not None and f["pe_trailing"] > 0 and f["pe_trailing"] < pe_max)

def strategy_value_high_dividend(df, params):
    """High Dividend Yield: Buy when yield > threshold"""
    min_yield = float(params.get("min_dividend_yield", 3)) / 100
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("dividend_yield") is not None and f["dividend_yield"] > min_yield)

def strategy_value_deep_value(df, params):
    """Deep Value: Low P/B + Low EV/EBITDA"""
    max_pb = float(params.get("max_pb", 1.5))
    max_ev_ebitda = float(params.get("max_ev_ebitda", 8))
    return _fundamental_signal(df, params,
        buy_check=lambda f: (f.get("pb") is not None and f["pb"] > 0 and f["pb"] < max_pb and
                              f.get("ev_ebitda") is not None and f["ev_ebitda"] > 0 and f["ev_ebitda"] < max_ev_ebitda))

def strategy_value_low_pb(df, params):
    """Low P/B Value: Buy when P/B < threshold"""
    max_pb = float(params.get("max_pb", 2.0))
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("pb") is not None and f["pb"] > 0 and f["pb"] < max_pb)

def strategy_value_fcf_yield(df, params):
    """Free Cash Flow Yield: Buy when FCF yield > threshold"""
    min_fcf_yield = float(params.get("min_fcf_yield", 5)) / 100
    def check(f):
        fcf = f.get("free_cash_flow")
        mc = f.get("market_cap")
        if fcf and mc and mc > 0:
            return (fcf / mc) > min_fcf_yield
        return False
    return _fundamental_signal(df, params, buy_check=check)

def strategy_value_garp(df, params):
    """Growth at Reasonable Price: PEG < 1.5 + earnings growing"""
    max_peg = float(params.get("max_peg", 1.5))
    def check(f):
        peg = f.get("peg")
        eg = f.get("earnings_growth", 0)
        return peg is not None and peg > 0 and peg < max_peg and eg is not None and eg > 0.05
    return _fundamental_signal(df, params, buy_check=check)


# ══════════════════════════════════════════════════════════════════════════════
# QUALITY STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def strategy_quality_high_roe(df, params):
    """High ROE: Buy when ROE > threshold + trend confirmation"""
    min_roe = float(params.get("min_roe", 15)) / 100
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("roe") is not None and f["roe"] > min_roe)

def strategy_quality_low_debt(df, params):
    """Low Debt: Buy when D/E < threshold + good profitability"""
    max_de = float(params.get("max_debt_equity", 50))  # D/E percentage
    min_margin = float(params.get("min_profit_margin", 10)) / 100
    return _fundamental_signal(df, params,
        buy_check=lambda f: (f.get("debt_equity") is not None and f["debt_equity"] < max_de and
                              f.get("profit_margin") is not None and f["profit_margin"] > min_margin))

def strategy_quality_piotroski(df, params):
    """Simplified Piotroski F-Score: Score 0-9 based on fundamentals"""
    min_score = int(params.get("min_piotroski_score", 6))
    def check(f):
        score = 0
        # Profitability
        if f.get("roa") and f["roa"] > 0: score += 1
        if f.get("operating_cash_flow") and f["operating_cash_flow"] > 0: score += 1
        if f.get("roa") and f.get("earnings_growth") and f["earnings_growth"] > 0: score += 1
        if f.get("operating_cash_flow") and f.get("roa") and f.get("market_cap"):
            ocf_ratio = f["operating_cash_flow"] / f["market_cap"] if f["market_cap"] > 0 else 0
            if ocf_ratio > f["roa"]: score += 1
        # Leverage
        if f.get("debt_equity") is not None and f["debt_equity"] < 100: score += 1
        if f.get("current_ratio") and f["current_ratio"] > 1: score += 1
        # Efficiency
        if f.get("gross_margin") and f["gross_margin"] > 0.2: score += 1
        if f.get("profit_margin") and f["profit_margin"] > 0.08: score += 1
        if f.get("revenue_growth") and f["revenue_growth"] > 0: score += 1
        return score >= min_score
    return _fundamental_signal(df, params, buy_check=check)

def strategy_quality_moat(df, params):
    """Economic Moat: High ROE + High margins + Low debt"""
    min_roe = float(params.get("min_roe", 18)) / 100
    min_margin = float(params.get("min_operating_margin", 15)) / 100
    max_de = float(params.get("max_debt_equity", 80))
    def check(f):
        return (f.get("roe") is not None and f["roe"] > min_roe and
                f.get("operating_margin") is not None and f["operating_margin"] > min_margin and
                f.get("debt_equity") is not None and f["debt_equity"] < max_de)
    return _fundamental_signal(df, params, buy_check=check)


# ══════════════════════════════════════════════════════════════════════════════
# GROWTH STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def strategy_growth_high_eps(df, params):
    """High EPS Growth: Buy when earnings growth > threshold"""
    min_growth = float(params.get("min_eps_growth", 15)) / 100
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("earnings_growth") is not None and f["earnings_growth"] > min_growth)

def strategy_growth_revenue(df, params):
    """Revenue Acceleration: Buy when revenue growth > threshold"""
    min_growth = float(params.get("min_revenue_growth", 15)) / 100
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("revenue_growth") is not None and f["revenue_growth"] > min_growth)

def strategy_growth_margin_expansion(df, params):
    """Margin Expansion: Buy when margins are strong and expanding"""
    min_margin = float(params.get("min_profit_margin", 12)) / 100
    min_growth = float(params.get("min_earnings_growth", 10)) / 100
    def check(f):
        return (f.get("profit_margin") is not None and f["profit_margin"] > min_margin and
                f.get("earnings_growth") is not None and f["earnings_growth"] > min_growth and
                f.get("revenue_growth") is not None and f["revenue_growth"] > 0)
    return _fundamental_signal(df, params, buy_check=check)


# ══════════════════════════════════════════════════════════════════════════════
# HYBRID (TECHNO-FUNDAMENTAL) STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def strategy_hybrid_roe_trend(df, params):
    """High ROE + Price above 200 DMA — quality + trend confirmation"""
    min_roe = float(params.get("min_roe", 15)) / 100
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    if not fund or fund.get("roe") is None or fund["roe"] < min_roe:
        return signals
    # High ROE confirmed, now use 200 DMA for timing
    if "sma_200" in df.columns:
        signals[df["close"] > df["sma_200"]] = 1
        signals[df["close"] < df["sma_200"]] = -1
    return signals

def strategy_hybrid_growth_breakout(df, params):
    """Earnings Growth + Price Breakout — growth stocks breaking out"""
    min_growth = float(params.get("min_earnings_growth", 10)) / 100
    window = int(params.get("breakout_window", 20))
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    if not fund or fund.get("earnings_growth") is None or fund["earnings_growth"] < min_growth:
        return signals
    # Growth confirmed, use breakout for entry
    rolling_high = df["high"].rolling(window).max()
    rolling_low = df["low"].rolling(window).min()
    signals[df["close"] > rolling_high.shift(1)] = 1
    signals[df["close"] < rolling_low.shift(1)] = -1
    return signals

def strategy_hybrid_low_debt_momentum(df, params):
    """Low Debt + Momentum Rank — quality balance sheet with price momentum"""
    max_de = float(params.get("max_debt_equity", 50))
    momentum_period = int(params.get("momentum_period", 20))
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    if not fund or fund.get("debt_equity") is None or fund["debt_equity"] > max_de:
        return signals
    # Low debt confirmed, use ROC for momentum
    roc = df["close"].pct_change(momentum_period)
    signals[roc > 0.02] = 1
    signals[roc < -0.02] = -1
    return signals

def strategy_hybrid_value_reversal(df, params):
    """Low P/E + RSI Oversold — value stock at technical oversold"""
    max_pe = float(params.get("pe_max", 15))
    rsi_threshold = float(params.get("oversold", 35))
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    if not fund or fund.get("pe_trailing") is None or fund["pe_trailing"] <= 0 or fund["pe_trailing"] > max_pe:
        return signals
    rsi = df.get("rsi_14", pd.Series(50, index=df.index))
    signals[rsi < rsi_threshold] = 1
    signals[rsi > 70] = -1
    return signals

def strategy_hybrid_quality_momentum(df, params):
    """Quality (High ROE + margins) + MACD momentum entry"""
    min_roe = float(params.get("min_roe", 15)) / 100
    min_margin = float(params.get("min_profit_margin", 10)) / 100
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    if not fund:
        return signals
    if fund.get("roe") is None or fund["roe"] < min_roe:
        return signals
    if fund.get("profit_margin") is None or fund["profit_margin"] < min_margin:
        return signals
    # Quality confirmed, use MACD for timing
    if "macd" in df.columns and "macd_signal" in df.columns:
        signals[df["macd"] > df["macd_signal"]] = 1
        signals[df["macd"] < df["macd_signal"]] = -1
    return signals


# ══════════════════════════════════════════════════════════════════════════════
# FACTOR STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def strategy_factor_low_volatility(df, params):
    """Low Volatility Factor: Buy when realized vol is low, sell when high"""
    vol_lookback = int(params.get("vol_lookback", 20))
    vol_threshold = float(params.get("vol_threshold_pct", 20)) / 100
    daily_ret = df["close"].pct_change()
    realized_vol = daily_ret.rolling(vol_lookback).std() * (252 ** 0.5)
    signals = pd.Series(0, index=df.index)
    signals[realized_vol < vol_threshold] = 1
    signals[realized_vol > vol_threshold * 1.5] = -1
    return signals

def strategy_factor_beta_neutral(df, params):
    """Beta Factor: Buy in low-beta regime (trending), sell in high-beta (volatile)"""
    lookback = int(params.get("beta_lookback", 60))
    signals = pd.Series(0, index=df.index)
    # Use rolling volatility as proxy for beta
    daily_ret = df["close"].pct_change()
    vol = daily_ret.rolling(lookback).std() * (252 ** 0.5)
    vol_median = vol.rolling(lookback * 2).median()
    signals[vol < vol_median] = 1    # Low vol regime → buy
    signals[vol > vol_median * 1.3] = -1  # High vol → sell
    return signals

def strategy_factor_quality(df, params):
    """Quality Factor: Combines fundamental quality with price trend"""
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    # Quality score
    score = 0
    if fund.get("roe") and fund["roe"] > 0.15: score += 1
    if fund.get("debt_equity") is not None and fund["debt_equity"] < 80: score += 1
    if fund.get("profit_margin") and fund["profit_margin"] > 0.10: score += 1
    if fund.get("operating_cash_flow") and fund["operating_cash_flow"] > 0: score += 1
    if fund.get("revenue_growth") and fund["revenue_growth"] > 0: score += 1
    if score >= 3:
        # Quality pass → use trend for timing
        ma = df["close"].rolling(50).mean()
        signals[df["close"] > ma] = 1
        signals[df["close"] < ma * 0.95] = -1
    return signals

def strategy_factor_size(df, params):
    """Size Factor: Small cap momentum (market cap filter applied at entry)"""
    max_mcap_cr = float(params.get("max_market_cap_cr", 10000))  # in crores
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    mc = fund.get("market_cap")
    if mc and mc / 1e7 < max_mcap_cr:  # Convert to crores
        # Small cap → use momentum
        roc = df["close"].pct_change(20)
        signals[roc > 0] = 1
        signals[roc < -0.05] = -1
    return signals


# ══════════════════════════════════════════════════════════════════════════════
# ENHANCED TRADE SIMULATOR v2
# ══════════════════════════════════════════════════════════════════════════════

def simulate_trades_v2(df, signals, initial_capital, params, exit_type="signal"):
    capital = initial_capital
    position = 0
    entry_price = 0
    entry_date = None
    trades = []
    equity_curve = [initial_capital]
    daily_values = [initial_capital]

    stop_loss_pct = float(params.get("stop_loss_pct", 0)) / 100
    target_pct = float(params.get("target_pct", 0)) / 100
    position_size_pct = float(params.get("position_size_pct", 95)) / 100
    slippage_pct = float(params.get("slippage_pct", 0.05)) / 100
    txn_cost_pct = float(params.get("txn_cost_pct", 0.1)) / 100

    # Exit strategy params
    trailing_atr_mult = float(params.get("trailing_atr_mult", 0))  # 0 = disabled
    time_exit_days = int(params.get("time_exit_days", 0))  # 0 = disabled
    r_multiple_exit = float(params.get("r_multiple_exit", 0))  # 0 = disabled
    ma_exit_period = int(params.get("ma_exit_period", 0))  # 0 = disabled
    vol_spike_exit_mult = float(params.get("vol_spike_exit_mult", 0))  # 0 = disabled

    trailing_stop = 0
    bars_in_trade = 0

    prev_signal = 0
    for i in range(1, len(df)):
        price = float(df["close"].iloc[i])
        signal = int(signals.iloc[i])
        date = str(df.index[i].date())
        atr_val = float(df["atr"].iloc[i]) if "atr" in df.columns else 0

        # ── EXIT CHECKS (if in position) ──
        if position > 0 and entry_price > 0:
            bars_in_trade += 1
            slipped_price = price * (1 - slippage_pct)

            # 1. Stop Loss (fixed)
            if stop_loss_pct > 0 and price <= entry_price * (1 - stop_loss_pct):
                pnl = (slipped_price - entry_price) * position
                cost = abs(position * slipped_price) * txn_cost_pct
                capital += position * slipped_price - cost
                trades.append({"date": date, "action": "SELL_SL", "price": round(slipped_price,2),
                               "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                equity_curve.append(round(capital, 2)); continue

            # 2. Target
            if target_pct > 0 and price >= entry_price * (1 + target_pct):
                pnl = (slipped_price - entry_price) * position
                cost = abs(position * slipped_price) * txn_cost_pct
                capital += position * slipped_price - cost
                trades.append({"date": date, "action": "SELL_TGT", "price": round(slipped_price,2),
                               "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                equity_curve.append(round(capital, 2)); continue

            # 3. ATR Trailing Stop
            if trailing_atr_mult > 0 and atr_val > 0:
                new_trail = price - trailing_atr_mult * atr_val
                trailing_stop = max(trailing_stop, new_trail)
                if price < trailing_stop:
                    pnl = (slipped_price - entry_price) * position
                    cost = abs(position * slipped_price) * txn_cost_pct
                    capital += position * slipped_price - cost
                    trades.append({"date": date, "action": "SELL_ATR_TRAIL", "price": round(slipped_price,2),
                                   "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                    position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                    equity_curve.append(round(capital, 2)); continue

            # 4. Time-based Exit
            if time_exit_days > 0 and bars_in_trade >= time_exit_days:
                pnl = (slipped_price - entry_price) * position
                cost = abs(position * slipped_price) * txn_cost_pct
                capital += position * slipped_price - cost
                trades.append({"date": date, "action": "SELL_TIME", "price": round(slipped_price,2),
                               "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                equity_curve.append(round(capital, 2)); continue

            # 5. R-Multiple Exit
            if r_multiple_exit > 0 and stop_loss_pct > 0:
                risk_per_share = entry_price * stop_loss_pct
                if price >= entry_price + r_multiple_exit * risk_per_share:
                    pnl = (slipped_price - entry_price) * position
                    cost = abs(position * slipped_price) * txn_cost_pct
                    capital += position * slipped_price - cost
                    trades.append({"date": date, "action": f"SELL_{r_multiple_exit}R", "price": round(slipped_price,2),
                                   "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                    position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                    equity_curve.append(round(capital, 2)); continue

            # 6. MA Breakdown Exit
            if ma_exit_period > 0:
                ma_val = df["close"].rolling(ma_exit_period).mean().iloc[i]
                if not np.isnan(ma_val) and price < ma_val:
                    pnl = (slipped_price - entry_price) * position
                    cost = abs(position * slipped_price) * txn_cost_pct
                    capital += position * slipped_price - cost
                    trades.append({"date": date, "action": "SELL_MA_BREAK", "price": round(slipped_price,2),
                                   "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                    position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                    equity_curve.append(round(capital, 2)); continue

            # 7. Volatility Spike Exit
            if vol_spike_exit_mult > 0 and atr_val > 0:
                avg_atr = df["atr"].rolling(20).mean().iloc[i] if "atr" in df.columns else atr_val
                if not np.isnan(avg_atr) and atr_val > avg_atr * vol_spike_exit_mult:
                    pnl = (slipped_price - entry_price) * position
                    cost = abs(position * slipped_price) * txn_cost_pct
                    capital += position * slipped_price - cost
                    trades.append({"date": date, "action": "SELL_VOL_SPIKE", "price": round(slipped_price,2),
                                   "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                    position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                    equity_curve.append(round(capital, 2)); continue

        # ── SIGNAL-BASED ENTRY/EXIT ──
        if signal != prev_signal:
            if signal == 1 and position == 0:
                slipped = price * (1 + slippage_pct)
                qty = int((capital * position_size_pct) / slipped)
                if qty > 0:
                    cost = qty * slipped * (1 + txn_cost_pct)
                    if cost <= capital:
                        capital -= cost
                        position = qty
                        entry_price = slipped
                        bars_in_trade = 0
                        trailing_stop = slipped - trailing_atr_mult * atr_val if trailing_atr_mult > 0 and atr_val > 0 else 0
                        trades.append({"date": date, "action": "BUY", "price": round(slipped,2),
                                      "qty": qty, "pnl": 0, "pnl_pct": 0})

            elif signal == -1 and position > 0:
                slipped = price * (1 - slippage_pct)
                pnl = (slipped - entry_price) * position
                cost = abs(position * slipped) * txn_cost_pct
                capital += position * slipped - cost
                trades.append({"date": date, "action": "SELL", "price": round(slipped,2),
                               "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped/entry_price-1)*100,2)})
                position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0

        prev_signal = signal
        current_value = capital + (position * price if position > 0 else 0)
        equity_curve.append(round(current_value, 2))

    # Close any open position
    if position > 0:
        price = float(df["close"].iloc[-1])
        slipped = price * (1 - slippage_pct)
        pnl = (slipped - entry_price) * position
        cost = abs(position * slipped) * txn_cost_pct
        capital += position * slipped - cost
        trades.append({"date": str(df.index[-1].date()), "action": "SELL_END", "price": round(slipped,2),
                       "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped/entry_price-1)*100,2)})

    # ══════════════════════════════════════════════════════════════════════════
    # ADVANCED METRICS
    # ══════════════════════════════════════════════════════════════════════════
    completed = [t for t in trades if t["action"].startswith("SELL")]
    winners = [t for t in completed if t["pnl"] > 0]
    losers = [t for t in completed if t["pnl"] < 0]
    total_return = ((capital - initial_capital) / initial_capital) * 100

    equity_series = pd.Series(equity_curve)
    daily_returns = equity_series.pct_change().dropna()

    # Sharpe Ratio (annualized)
    sharpe = (daily_returns.mean() / daily_returns.std() * (252 ** 0.5)) if daily_returns.std() > 0 else 0

    # Sortino Ratio (downside deviation only)
    downside = daily_returns[daily_returns < 0]
    sortino = (daily_returns.mean() / downside.std() * (252 ** 0.5)) if len(downside) > 0 and downside.std() > 0 else 0

    # Max Drawdown
    peak = equity_series.expanding().max()
    drawdown = (equity_series - peak) / peak * 100
    max_dd = float(drawdown.min())
    max_dd_duration = 0
    dd_start = 0
    for i in range(len(drawdown)):
        if drawdown.iloc[i] < 0:
            if dd_start == 0: dd_start = i
        else:
            if dd_start > 0:
                max_dd_duration = max(max_dd_duration, i - dd_start)
                dd_start = 0

    # Calmar Ratio
    trading_days = len(equity_curve)
    annual_return = ((capital / initial_capital) ** (252 / max(trading_days, 1)) - 1) * 100
    calmar = annual_return / abs(max_dd) if max_dd != 0 else 0

    # Profit Factor
    gross_profit = sum(t["pnl"] for t in winners)
    gross_loss = abs(sum(t["pnl"] for t in losers))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else gross_profit if gross_profit > 0 else 0

    # Win Rate & Expectancy
    win_rate = len(winners) / len(completed) * 100 if completed else 0
    avg_win = sum(t["pnl"] for t in winners) / len(winners) if winners else 0
    avg_loss = sum(t["pnl"] for t in losers) / len(losers) if losers else 0
    expectancy = (win_rate/100 * avg_win + (1 - win_rate/100) * avg_loss) if completed else 0

    # Payoff Ratio
    payoff_ratio = abs(avg_win / avg_loss) if avg_loss != 0 else 0

    # Avg trade duration
    buy_dates = {t["date"]: t for t in trades if t["action"] == "BUY"}
    trade_durations = []
    for t in completed:
        # Approximate duration from trades list
        pass  # Would need proper date tracking

    # Ulcer Index (average of squared drawdowns)
    ulcer = float(np.sqrt((drawdown ** 2).mean())) if len(drawdown) > 0 else 0

    # Recovery Factor
    recovery_factor = abs(total_return / max_dd) if max_dd != 0 else 0

    # Monthly returns for distribution
    monthly_equity = equity_series.iloc[::21]  # approx monthly
    monthly_returns = monthly_equity.pct_change().dropna()
    best_month = float(monthly_returns.max() * 100) if len(monthly_returns) > 0 else 0
    worst_month = float(monthly_returns.min() * 100) if len(monthly_returns) > 0 else 0

    # Fundamental data summary (if available)
    fund = params.get("_fundamentals", {})
    fund_summary = {}
    if fund:
        fund_summary = {
            k: round(v, 4) if isinstance(v, float) else v
            for k, v in fund.items() if v is not None
        }

    return {
        # Basic
        "total_return_pct": round(total_return, 2),
        "annual_return_pct": round(annual_return, 2),
        "final_capital": round(capital, 2),
        "total_trades": len(completed),
        "winning_trades": len(winners),
        "losing_trades": len(losers),
        "win_rate": round(win_rate, 1),
        # Risk
        "max_drawdown_pct": round(max_dd, 2),
        "max_dd_duration_days": max_dd_duration,
        "sharpe_ratio": round(float(sharpe), 2),
        "sortino_ratio": round(float(sortino), 2),
        "calmar_ratio": round(float(calmar), 2),
        "ulcer_index": round(ulcer, 2),
        "recovery_factor": round(recovery_factor, 2),
        # Profit
        "profit_factor": round(profit_factor, 2),
        "expectancy": round(expectancy, 2),
        "payoff_ratio": round(payoff_ratio, 2),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "best_month_pct": round(best_month, 2),
        "worst_month_pct": round(worst_month, 2),
        # Data
        "trades": trades[-50:],
        "equity_curve": equity_curve[::max(len(equity_curve)//100, 1)],
        "fundamentals": fund_summary,
        "exit_strategy": params.get("exit_strategy", "signal"),
        "slippage_pct": round(slippage_pct * 100, 3),
        "txn_cost_pct": round(txn_cost_pct * 100, 3),
    }

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health", tags=["Health & Status"], summary="System health check",
    description="Returns API status, universe size, sector count, data source info, and Groww token status. No authentication required.",
    response_description="Health status object")
async def health():
    token_set = bool(await get_groww_token())
    return {
        "status": "ok", "version": "3.1.0",
        "universe_size": len(NIFTY_UNIVERSE),
        "sectors": len(set(SECTOR_MAP.values())),
        "universe_source": "stock_universe.json" if _UNIVERSE_LOADED else "built-in (457)",
        "groww_token_active": token_set,
        "timestamp": datetime.utcnow().isoformat(),
    }

@app.get("/", tags=["Health & Status"], summary="API root", description="Returns API version and docs URL.")
async def root():
    return {"message": "AlphaLab API v2.0", "docs": "/api/docs"}

# ── Auth Routes ───────────────────────────────────────────────────────────────
@app.post("/api/auth/register", tags=["Authentication"], summary="Register new user",
    description="Create a new user account. Requires invite code if platform is in invite-only mode. Supports user types: individual, ra (Research Analyst), ria (Investment Advisor).")
async def register(req: RegisterRequest):
    async with db_pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM users WHERE is_admin=false")
        if count >= MAX_USERS: raise HTTPException(status_code=400, detail="Platform at capacity")
        if INVITE_ONLY:
            if not req.invite_code: raise HTTPException(status_code=400, detail="Invite code required")
            invite = await conn.fetchrow("SELECT * FROM invite_codes WHERE code=$1 AND used_by IS NULL", req.invite_code)
            if not invite: raise HTTPException(status_code=400, detail="Invalid or used invite code")
        existing = await conn.fetchrow("SELECT id FROM users WHERE email=$1", req.email)
        if existing: raise HTTPException(status_code=400, detail="Email already registered")
        user_type = req.user_type or "individual"
        sebi_reg = req.sebi_reg_no or ""
        uid = await conn.fetchval(
            "INSERT INTO users (email, name, password_hash, user_type, sebi_reg_no) VALUES ($1,$2,$3,$4,$5) RETURNING id",
            req.email, req.name, hash_password(req.password), user_type, sebi_reg
        )
        if INVITE_ONLY and req.invite_code:
            await conn.execute("UPDATE invite_codes SET used_by=$1, used_at=NOW() WHERE code=$2", uid, req.invite_code)
        await conn.execute("INSERT INTO watchlists (user_id) VALUES ($1)", uid)
        return {"token": create_token(uid, req.email, False), "user": {"id": uid, "email": req.email, "name": req.name, "is_admin": False, "user_type": user_type}}

@app.post("/api/auth/login", tags=["Authentication"], summary="Login",
    description="Authenticate with email and password. Returns a JWT Bearer token valid for 7 days.")
async def login(req: LoginRequest):
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM users WHERE email=$1 AND is_active=true", req.email)
        if not user or user["password_hash"] != hash_password(req.password):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return {"token": create_token(user["id"], user["email"], user["is_admin"]),
                "user": {"id": user["id"], "email": user["email"], "name": user["name"], "is_admin": user["is_admin"],
                         "user_type": user.get("user_type", "individual")}}

@app.get("/api/consent/check", tags=["Authentication"], summary="Check if user has accepted disclaimer",
    description="Returns whether the current user has accepted the platform disclaimer for the current version.")
async def check_consent(request: Request, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, accepted_at FROM user_consents WHERE user_id=$1 AND consent_type='platform_disclaimer' AND version='2.0'",
            user["id"])
        return {"accepted": row is not None, "accepted_at": str(row["accepted_at"]) if row else None}

@app.post("/api/consent/accept", tags=["Authentication"], summary="Accept platform disclaimer",
    description="Record user's acceptance of the platform disclaimer. Stores IP, user agent, and timestamp for SEBI compliance.")
async def accept_consent(request: Request, user=Depends(get_current_user)):
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "unknown")[:500]
    async with db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO user_consents (user_id, consent_type, version, ip_address, user_agent)
            VALUES ($1, 'platform_disclaimer', '2.0', $2, $3)
            ON CONFLICT (user_id, consent_type, version) DO NOTHING
        """, user["id"], ip, ua)
    return {"status": "accepted", "version": "2.0"}

@app.get("/api/admin/consents", tags=["Admin"], summary="List all user consents",
    description="Admin only. View all users who have accepted the platform disclaimer with timestamps and IP addresses.")
async def list_consents(user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT uc.*, u.username, u.email FROM user_consents uc
            LEFT JOIN users u ON u.id = uc.user_id
            ORDER BY uc.accepted_at DESC
        """)
        return {"consents": [dict(r) for r in rows], "total": len(rows)}

@app.get("/api/methodology", tags=["Authentication"], summary="View methodology document",
    description="Serves the SEBI-compliant methodology document. Available to all authenticated users for consent review. Document is copy-protected in the frontend.")
async def view_methodology(user=Depends(get_current_user)):
    from fastapi.responses import HTMLResponse
    try:
        with open("/var/www/methodology.html", "r") as f:
            return HTMLResponse(content=f.read())
    except:
        raise HTTPException(404, "Methodology document not available")

@app.post("/api/methodology/request-access", tags=["Authentication"], summary="Request methodology document access",
    description="Submit a request to view the full methodology document. Admin will review and grant access.")
async def request_methodology_access(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT * FROM methodology_access_requests WHERE user_id=$1 AND status='pending'", user["id"])
        if existing:
            return {"status": "already_pending", "requested_at": str(existing["requested_at"])}
        await conn.execute(
            "INSERT INTO methodology_access_requests (user_id) VALUES ($1)", user["id"])
    return {"status": "requested"}

@app.get("/api/admin/methodology-requests", tags=["Admin"], summary="List methodology access requests",
    description="Admin only. View and manage pending methodology access requests.")
async def list_methodology_requests(user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT mar.*, u.username, u.email FROM methodology_access_requests mar
            LEFT JOIN users u ON u.id = mar.user_id ORDER BY mar.requested_at DESC
        """)
        return {"requests": [dict(r) for r in rows], "total": len(rows)}

@app.post("/api/admin/methodology-requests/{req_id}/approve", tags=["Admin"], summary="Approve methodology access",
    description="Admin only. Approve a pending methodology access request.")
async def approve_methodology_request(req_id: int, user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        await conn.execute(
            "UPDATE methodology_access_requests SET status='approved', reviewed_at=NOW(), reviewed_by=$1 WHERE id=$2",
            user["id"], req_id)
    return {"status": "approved"}

@app.get("/api/auth/me", tags=["Authentication"], summary="Get current user profile",
    description="Returns the authenticated user's profile including email, name, user type, and admin status.")
async def me(user=Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"], "name": user["name"], "is_admin": user["is_admin"],
            "user_type": user.get("user_type", "individual"), "sebi_reg_no": user.get("sebi_reg_no", "")}

# ── SEBI Certificate Upload ──────────────────────────────────────────────────
@app.post("/api/auth/upload-sebi-cert", tags=["Authentication"], summary="Upload SEBI certificate",
    description="Upload SEBI registration certificate (PDF/image) for RA/RIA verification. Max 5MB.")
async def upload_sebi_cert(file: UploadFile = File(...), user=Depends(get_current_user)):
    import os
    cert_dir = "/opt/alphaforge/sebi_certs"
    os.makedirs(cert_dir, exist_ok=True)
    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "pdf"
    safe_ext = ext if ext in ("pdf", "jpg", "jpeg", "png") else "pdf"
    filename = f"sebi_cert_{user['id']}_{user.get('sebi_reg_no','unknown')}.{safe_ext}"
    filepath = os.path.join(cert_dir, filename)
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE users SET sebi_cert_path=$1 WHERE id=$2", filepath, user["id"])
    return {"message": "Certificate uploaded", "path": filepath}

# ── Admin: View Registered Advisors ──────────────────────────────────────────
@app.get("/api/admin/advisors", tags=["Admin"], summary="List advisor applications",
    description="Admin only. Returns all users who registered as RA/RIA with their SEBI verification status.")
async def list_advisors(user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        advisors = await conn.fetch("""
            SELECT id, email, name, user_type, sebi_reg_no, sebi_cert_path, is_active, created_at
            FROM users WHERE user_type IN ('ra', 'ria') ORDER BY created_at DESC
        """)
    return [dict(a) for a in advisors]

@app.get("/api/admin/sebi-cert/{user_id}", tags=["Admin"], summary="Download SEBI certificate",
    description="Admin only. Download the uploaded SEBI certificate for a specific advisor user.")
async def download_sebi_cert(user_id: int, admin=Depends(get_admin_user)):
    from fastapi.responses import FileResponse
    import os
    async with db_pool.acquire() as conn:
        u = await conn.fetchrow("SELECT sebi_cert_path FROM users WHERE id=$1", user_id)
    if not u or not u["sebi_cert_path"] or not os.path.exists(u["sebi_cert_path"]):
        raise HTTPException(status_code=404, detail="Certificate not found")
    return FileResponse(u["sebi_cert_path"])

# ── Token Management ──────────────────────────────────────────────────────────
@app.post("/api/admin/token", tags=["Admin"], summary="Update data provider token",
    description="Admin only. Update the Groww/data provider API token used for market data fetching.")
async def update_groww_token(req: TokenUpdateRequest, user=Depends(get_admin_user)):
    await set_groww_token(req.token.strip())
    return {"message": "Groww token updated successfully", "active": True}

@app.get("/api/admin/token/status", tags=["Admin"], summary="Check data provider token status",
    description="Admin only. Check if the data provider token is set and active.")
async def token_status(user=Depends(get_admin_user)):
    token = await get_groww_token()
    return {"active": bool(token), "preview": token[:20] + "..." if token else None}

# ── Indicators API ────────────────────────────────────────────────────────────
@app.post("/api/indicators", tags=["Technical Charts"], summary="Compute technical indicators",
    description="Fetch OHLCV data for a symbol and compute technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands, Supertrend, ADX, ATR, VWAP, Stochastic, OBV, etc.).")
async def get_indicators(req: StrategyParams, user=Depends(get_current_user)):
    df = await fetch_groww_candles(req.symbol, req.from_date, req.to_date, req.interval)
    if len(df) < 30:
        raise HTTPException(status_code=400, detail="Not enough data. Try a longer date range.")
    df = compute_indicators(df)
    result = df.tail(100).reset_index()
    result["date"] = result["date"].astype(str)
    result = result.replace([np.inf, -np.inf], np.nan).fillna(0)
    return {"symbol": req.symbol, "candles": result.to_dict(orient="records"), "total_candles": len(df)}

# ── Backtest Routes ───────────────────────────────────────────────────────────
@app.post("/api/backtest/run", tags=["Backtesting"], summary="Run a backtest",
    description="Execute a historical backtest on a single stock. Supports 40+ strategies (SMA_CROSSOVER, EMA_CROSSOVER, RSI, MACD, BOLLINGER, SUPERTREND, BREAKOUT, MOMENTUM, ADX_TREND, GOLDEN_CROSS, etc.). Returns trade-by-trade results, equity curve, CAGR, Sharpe ratio, max drawdown, and win rate. Runs asynchronously — poll the backtest ID for results.")
async def run_backtest(req: BacktestRequest, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        bt_id = await conn.fetchval(
            "INSERT INTO backtests (user_id, name, strategy, symbol, from_date, to_date, initial_capital, params, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'running') RETURNING id",
            user["id"], req.name, req.strategy, req.symbol, req.from_date, req.to_date, req.initial_capital, json.dumps(req.params)
        )
    asyncio.create_task(execute_backtest(bt_id, req))
    return {"backtest_id": bt_id, "status": "running"}

async def execute_backtest(bt_id: int, req: BacktestRequest):
    try:
        df = await fetch_groww_candles(req.symbol, req.from_date, req.to_date)
        if len(df) < 30:
            raise Exception("Insufficient data — try a longer date range")
        df = compute_indicators(df)
        p = req.params or {}
        p["_symbol"] = req.symbol
        result = run_strategy(df, req.strategy, p, req.initial_capital)
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE backtests SET result=$1, status='completed' WHERE id=$2", json.dumps(result), bt_id)
    except Exception as e:
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE backtests SET result=$1, status='failed' WHERE id=$2", json.dumps({"error": str(e)}), bt_id)

@app.get("/api/backtest/{bt_id}", tags=["Backtesting"], summary="Get backtest result",
    description="Retrieve the result of a specific backtest by ID. Returns strategy parameters, trade log, equity curve data, and performance metrics once completed.")
async def get_backtest(bt_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        bt = await conn.fetchrow("SELECT * FROM backtests WHERE id=$1 AND user_id=$2", bt_id, user["id"])
        if not bt: raise HTTPException(status_code=404, detail="Not found")
        return dict(bt)

@app.get("/api/backtests", tags=["Backtesting"], summary="List all backtests",
    description="List all backtests created by the authenticated user, sorted by most recent. Includes status (running/completed/failed).")
async def list_backtests(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT id,name,strategy,symbol,from_date,to_date,status,created_at FROM backtests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", user["id"])
        return [dict(r) for r in rows]

# ── Paper Trading ─────────────────────────────────────────────────────────────
@app.post("/api/paper-trade/open", tags=["Paper Trading"], summary="Open a paper trade",
    description="Open a manual paper trade with symbol, trade type (BUY/SELL), quantity, entry price. Optional stop-loss and target price.")
async def open_paper_trade(req: PaperTradeRequest, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        tid = await conn.fetchval(
            "INSERT INTO paper_trades (user_id,symbol,trade_type,quantity,entry_price,stop_loss,target) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            user["id"], req.symbol.upper(), req.trade_type.upper(), req.quantity, req.entry_price, req.stop_loss, req.target
        )
        return {"trade_id": tid, "status": "open"}

@app.post("/api/paper-trade/{trade_id}/close", tags=["Paper Trading"], summary="Close a paper trade",
    description="Close an open paper trade at the specified exit price. Calculates P&L and returns trade summary.")
async def close_paper_trade(trade_id: int, exit_price: float, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        t = await conn.fetchrow("SELECT * FROM paper_trades WHERE id=$1 AND user_id=$2 AND status='open'", trade_id, user["id"])
        if not t: raise HTTPException(status_code=404, detail="Trade not found")
        pnl = (exit_price - t["entry_price"]) * t["quantity"] if t["trade_type"]=="BUY" else (t["entry_price"]-exit_price)*t["quantity"]
        await conn.execute("UPDATE paper_trades SET exit_price=$1,pnl=$2,status='closed',closed_at=NOW() WHERE id=$3", exit_price, round(pnl,2), trade_id)
        return {"trade_id": trade_id, "pnl": round(pnl,2), "status": "closed"}

@app.get("/api/paper-trades", tags=["Paper Trading"], summary="List paper trades",
    description="List all paper trades for the authenticated user — both open and closed positions with P&L calculations.")
async def list_paper_trades(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM paper_trades WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", user["id"])
        trades = [dict(r) for r in rows]
        return {"trades": trades, "total_pnl": round(sum(t["pnl"] or 0 for t in trades), 2), "open_count": sum(1 for t in trades if t["status"]=="open")}


# ══════════════════════════════════════════════════════════════════════════════
# FORWARD TESTING ENGINE
# ══════════════════════════════════════════════════════════════════════════════

STRATEGY_MAP = {
    "SMA_CROSSOVER": strategy_sma_crossover, "EMA_CROSSOVER": strategy_ema_crossover,
    "RSI": strategy_rsi, "MACD": strategy_macd, "BOLLINGER": strategy_bollinger,
    "SUPERTREND": strategy_supertrend, "BREAKOUT": strategy_breakout,
    "MOMENTUM": strategy_momentum, "ADX_TREND": strategy_adx_trend,
    "GOLDEN_CROSS": strategy_golden_cross, "VWAP_REVERSION": strategy_vwap_reversion,
    "STOCHASTIC": strategy_stochastic, "KELTNER_BREAKOUT": strategy_keltner_breakout,
    "NR7_EXPANSION": strategy_nr7_expansion, "OBV_DIVERGENCE": strategy_obv_divergence,
    "TRIPLE_EMA": strategy_triple_ema, "ATR_CHANNEL": strategy_atr_channel,
    "MEAN_REVERSION": strategy_mean_reversion,
    "VALUE_LOW_PE": strategy_value_low_pe, "VALUE_HIGH_DIVIDEND": strategy_value_high_dividend,
    "VALUE_DEEP_VALUE": strategy_value_deep_value, "VALUE_LOW_PB": strategy_value_low_pb,
    "VALUE_FCF_YIELD": strategy_value_fcf_yield, "VALUE_GARP": strategy_value_garp,
    "QUALITY_HIGH_ROE": strategy_quality_high_roe, "QUALITY_LOW_DEBT": strategy_quality_low_debt,
    "QUALITY_PIOTROSKI": strategy_quality_piotroski, "QUALITY_MOAT": strategy_quality_moat,
    "GROWTH_HIGH_EPS": strategy_growth_high_eps, "GROWTH_REVENUE": strategy_growth_revenue,
    "GROWTH_MARGIN_EXPANSION": strategy_growth_margin_expansion,
    "HYBRID_ROE_TREND": strategy_hybrid_roe_trend, "HYBRID_GROWTH_BREAKOUT": strategy_hybrid_growth_breakout,
    "HYBRID_LOW_DEBT_MOMENTUM": strategy_hybrid_low_debt_momentum,
    "HYBRID_VALUE_REVERSAL": strategy_hybrid_value_reversal,
    "HYBRID_QUALITY_MOMENTUM": strategy_hybrid_quality_momentum,
    "FACTOR_LOW_VOLATILITY": strategy_factor_low_volatility,
    "FACTOR_BETA_NEUTRAL": strategy_factor_beta_neutral,
    "FACTOR_QUALITY": strategy_factor_quality, "FACTOR_SIZE": strategy_factor_size,
}


async def generate_forward_signals(fwd_test: dict) -> list:
    """Run strategy on current data for all symbols — generate BUY/SELL/HOLD signals."""
    from datetime import date, timedelta

    strategy = fwd_test["strategy"]
    params = json.loads(fwd_test["params"]) if isinstance(fwd_test["params"], str) else (fwd_test["params"] or {})
    symbols = fwd_test["symbols"]
    # Apply sector filter if set
    fwd_sector_filter = params.get("sector_filter", "")
    if fwd_sector_filter:
        symbols = [s for s in symbols if SECTOR_MAP.get(s, "Other") == fwd_sector_filter]
    lookback = fwd_test.get("lookback_days", 200)
    start = (date.today() - timedelta(days=lookback + 50)).isoformat()
    end = date.today().isoformat()
    signals = []
    loop = asyncio.get_event_loop()

    # Batch download via data service (with yfinance fallback)
    yf_symbols = [f"{s}.NS" for s in symbols]
    all_data = await batch_download_yf(yf_symbols, start, end, batch_size=40)
    all_data = {k: v for k, v in all_data.items() if not v.empty and len(v) >= 30}

    for sym in symbols:
        yf_sym = f"{sym}.NS"
        if yf_sym not in all_data:
            continue
        try:
            df = all_data[yf_sym].copy()
            if "Close" in df.columns:
                df = df.rename(columns={"Close":"close","Open":"open","High":"high","Low":"low","Volume":"volume"})
            df = df.sort_index().astype({"open":float,"high":float,"low":float,"close":float,"volume":float}).dropna()
            if len(df) < 30:
                continue

            df = compute_indicators(df)

            p = dict(params)
            p["_symbol"] = sym
            if strategy.startswith(("VALUE_","QUALITY_","GROWTH_","HYBRID_","FACTOR_")):
                try:
                    p["_fundamentals"] = fetch_fundamentals_sync(sym)
                except:
                    p["_fundamentals"] = {}
            else:
                p["_fundamentals"] = {}

            fn = STRATEGY_MAP.get(strategy, strategy_sma_crossover)
            sig_series = fn(df, p)

            last_sig = int(sig_series.iloc[-1]) if len(sig_series) > 0 else 0
            prev_sig = int(sig_series.iloc[-2]) if len(sig_series) > 1 else 0
            price = float(df["close"].iloc[-1])
            prev_price = float(df["close"].iloc[-2]) if len(df) > 1 else price

            # Signal strength (0-100)
            strength = 0
            rsi_val = float(df["rsi_14"].iloc[-1]) if "rsi_14" in df.columns and not np.isnan(df["rsi_14"].iloc[-1]) else 50
            vol_ratio = float(df["volume"].iloc[-1] / df["volume"].rolling(20).mean().iloc[-1]) if len(df) >= 20 else 1
            above_200 = 1 if "sma_200" in df.columns and not np.isnan(df["sma_200"].iloc[-1]) and price > float(df["sma_200"].iloc[-1]) else 0

            if last_sig == 1:
                strength = min(100, max(10, int(30 + (70 - rsi_val) * 0.3 + min(vol_ratio, 5) * 8 + above_200 * 20)))
            elif last_sig == -1:
                strength = min(100, max(10, int(30 + (rsi_val - 30) * 0.3 + 20)))

            strat_data = {}
            for col, key in [("rsi_14","rsi"),("sma_50","sma_50"),("sma_200","sma_200"),("macd_hist","macd_hist"),("adx","adx"),("atr","atr")]:
                if col in df.columns:
                    v = df[col].iloc[-1]
                    strat_data[key] = round(float(v), 2) if not np.isnan(v) else None
            strat_data["volume_ratio"] = round(vol_ratio, 2)
            strat_data["change_pct"] = round((price - prev_price) / prev_price * 100, 2)
            strat_data["sector"] = SECTOR_MAP.get(sym, "Other")
            strat_data["above_200dma"] = above_200

            fund = p.get("_fundamentals", {})
            for fk in ["pe_trailing","pb","roe","debt_equity","dividend_yield","earnings_growth","profit_margin"]:
                if fk in fund and fund[fk] is not None:
                    strat_data[fk] = round(float(fund[fk]), 4)

            signal_type = "BUY" if last_sig == 1 else ("SELL" if last_sig == -1 else "HOLD")
            is_new = last_sig != prev_sig and last_sig != 0

            signals.append({
                "symbol": sym, "signal": signal_type, "is_new": is_new,
                "strength": strength, "price": round(price, 2), "strategy_data": strat_data,
            })
        except Exception as e:
            continue

    # Sort: new signals first, then by strength desc
    signals.sort(key=lambda s: (0 if s["is_new"] else 1, -s["strength"]))
    # ── Safety: remove penny stocks and ASM/GSM ──
    signals = [s for s in signals if s.get("price", 0) >= 50 and not is_asm_gsm(s.get("symbol", ""))]
    return signals


async def execute_forward_signals(fwd_test_id: int, signals: list):
    """Auto-execute: open positions on new BUY, close on new SELL."""
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1", fwd_test_id)
        if not fwd or fwd["status"] != "active":
            return

        capital = fwd["current_capital"]
        max_pos = fwd["max_positions"]
        pos_size_pct = fwd["position_size_pct"] / 100
        slippage = fwd["slippage_pct"] / 100
        txn_cost = fwd["txn_cost_pct"] / 100
        sector_cap = fwd["sector_cap_pct"] / 100

        positions = await conn.fetch(
            "SELECT * FROM forward_test_positions WHERE fwd_test_id=$1 AND status='open'", fwd_test_id
        )
        open_syms = {p["symbol"] for p in positions}
        num_open = len(positions)
        sector_counts = {}
        for p in positions:
            sec = p.get("sector") or "Other"
            sector_counts[sec] = sector_counts.get(sec, 0) + 1

        for sig in signals:
            sym = sig["symbol"]
            signal_type = sig["signal"]
            price = sig["price"]
            is_new = sig["is_new"]
            strat_data = sig.get("strategy_data", {})
            sector = strat_data.get("sector", "Other")

            # Store every signal for audit
            await conn.execute(
                "INSERT INTO forward_test_signals (fwd_test_id,symbol,signal_type,signal_strength,price_at_signal,strategy_data,status) VALUES ($1,$2,$3,$4,$5,$6,$7)",
                fwd_test_id, sym, signal_type, sig["strength"], price,
                json.dumps(strat_data), "executed" if is_new else "held"
            )

            if not is_new:
                continue

            # ── BUY ──
            if signal_type == "BUY" and sym not in open_syms and num_open < max_pos:
                if sector_cap > 0:
                    max_in_sector = max(1, int(max_pos * sector_cap))
                    if sector_counts.get(sector, 0) >= max_in_sector:
                        continue

                alloc = capital * pos_size_pct
                slipped = price * (1 + slippage)
                qty = int(alloc / slipped)
                if qty <= 0:
                    continue
                cost = qty * slipped
                fees = cost * txn_cost
                if cost + fees > capital:
                    continue

                atr_val = strat_data.get("atr") or 0
                sl = round(slipped - 2 * atr_val, 2) if atr_val > 0 else None
                tgt = round(slipped + 3 * atr_val, 2) if atr_val > 0 else None

                await conn.execute("""
                    INSERT INTO forward_test_positions (fwd_test_id,symbol,quantity,entry_price,current_price,stop_loss,target,sector,fundamentals)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                """, fwd_test_id, sym, qty, round(slipped,2), price, sl, tgt, sector, json.dumps(strat_data))
                await conn.execute("""
                    INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,fees)
                    VALUES ($1,$2,'BUY',$3,$4,$5)
                """, fwd_test_id, sym, qty, round(slipped,2), round(fees,2))

                capital -= (cost + fees)
                num_open += 1
                open_syms.add(sym)
                sector_counts[sector] = sector_counts.get(sector, 0) + 1

            # ── SELL ──
            elif signal_type == "SELL" and sym in open_syms:
                pos = next((p for p in positions if p["symbol"] == sym and p["status"] == "open"), None)
                if not pos:
                    continue
                slipped = price * (1 - slippage)
                pnl = (slipped - pos["entry_price"]) * pos["quantity"]
                fees = abs(pos["quantity"] * slipped) * txn_cost
                pnl_pct = (slipped / pos["entry_price"] - 1) * 100

                await conn.execute(
                    "UPDATE forward_test_positions SET status='closed',current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3 WHERE id=$4",
                    round(slipped,2), round(pnl-fees,2), round(pnl_pct,2), pos["id"]
                )
                await conn.execute("""
                    INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,pnl,pnl_pct,exit_reason,fees)
                    VALUES ($1,$2,'SELL',$3,$4,$5,$6,'signal',$7)
                """, fwd_test_id, sym, pos["quantity"], round(slipped,2), round(pnl-fees,2), round(pnl_pct,2), round(fees,2))
                capital += pos["quantity"] * slipped - fees

        await conn.execute("UPDATE forward_tests SET current_capital=$1, last_scan_at=NOW() WHERE id=$2", round(capital,2), fwd_test_id)


async def update_forward_positions(fwd_test_id: int):
    """Refresh current prices, check stop-loss and target for open positions."""
    async with db_pool.acquire() as conn:
        positions = await conn.fetch(
            "SELECT * FROM forward_test_positions WHERE fwd_test_id=$1 AND status='open'", fwd_test_id
        )
        if not positions:
            return
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1", fwd_test_id)
        capital = fwd["current_capital"]
        slippage = fwd["slippage_pct"] / 100
        txn_cost = fwd["txn_cost_pct"] / 100
        loop = asyncio.get_event_loop()

        syms = [f"{p['symbol']}.NS" for p in positions]
        from datetime import date, timedelta
        _start = (date.today() - timedelta(days=5)).isoformat()
        _end = date.today().isoformat()
        all_data = await batch_download_yf(syms, _start, _end, batch_size=50)
        if not all_data:
            return

        raw = None  # not used directly
        single = len(syms) == 1
        for pos in positions:
            try:
                yf_sym = f"{pos['symbol']}.NS"
                df = yf_extract_ticker(raw, yf_sym, single_mode=single)
                if df.empty:
                    continue
                price = float(df["Close"].iloc[-1] if "Close" in df.columns else df["close"].iloc[-1])
                pnl = (price - pos["entry_price"]) * pos["quantity"]
                pnl_pct = (price / pos["entry_price"] - 1) * 100

                # Stop loss check
                if pos["stop_loss"] and price <= pos["stop_loss"]:
                    sl_price = price * (1 - slippage)
                    sl_pnl = (sl_price - pos["entry_price"]) * pos["quantity"]
                    fees = abs(pos["quantity"] * sl_price) * txn_cost
                    await conn.execute("UPDATE forward_test_positions SET status='closed',current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3 WHERE id=$4",
                        round(sl_price,2), round(sl_pnl-fees,2), round((sl_price/pos["entry_price"]-1)*100,2), pos["id"])
                    await conn.execute("INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,pnl,pnl_pct,exit_reason,fees) VALUES ($1,$2,'SELL',$3,$4,$5,$6,'stop_loss',$7)",
                        fwd_test_id, pos["symbol"], pos["quantity"], round(sl_price,2), round(sl_pnl-fees,2), round((sl_price/pos["entry_price"]-1)*100,2), round(fees,2))
                    capital += pos["quantity"] * sl_price - fees
                    continue

                # Target check
                if pos["target"] and price >= pos["target"]:
                    tgt_price = price * (1 - slippage)
                    tgt_pnl = (tgt_price - pos["entry_price"]) * pos["quantity"]
                    fees = abs(pos["quantity"] * tgt_price) * txn_cost
                    await conn.execute("UPDATE forward_test_positions SET status='closed',current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3 WHERE id=$4",
                        round(tgt_price,2), round(tgt_pnl-fees,2), round((tgt_price/pos["entry_price"]-1)*100,2), pos["id"])
                    await conn.execute("INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,pnl,pnl_pct,exit_reason,fees) VALUES ($1,$2,'SELL',$3,$4,$5,$6,'target',$7)",
                        fwd_test_id, pos["symbol"], pos["quantity"], round(tgt_price,2), round(tgt_pnl-fees,2), round((tgt_price/pos["entry_price"]-1)*100,2), round(fees,2))
                    capital += pos["quantity"] * tgt_price - fees
                    continue

                # Update price
                await conn.execute("UPDATE forward_test_positions SET current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3,bars_held=bars_held+1 WHERE id=$4",
                    round(price,2), round(pnl,2), round(pnl_pct,2), pos["id"])
            except:
                continue
        await conn.execute("UPDATE forward_tests SET current_capital=$1 WHERE id=$2", round(capital,2), fwd_test_id)


async def take_portfolio_snapshot(fwd_test_id: int):
    """Record daily snapshot for equity curve."""
    from datetime import date as dt_date
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1", fwd_test_id)
        positions = await conn.fetch("SELECT * FROM forward_test_positions WHERE fwd_test_id=$1 AND status='open'", fwd_test_id)
        pos_val = sum((p["current_price"] or p["entry_price"]) * p["quantity"] for p in positions)
        cash = fwd["current_capital"]
        total = cash + pos_val
        cum_ret = (total / fwd["initial_capital"] - 1) * 100

        prev = await conn.fetchrow("SELECT portfolio_value FROM forward_test_snapshots WHERE fwd_test_id=$1 ORDER BY snapshot_date DESC LIMIT 1", fwd_test_id)
        daily_ret = ((total / prev["portfolio_value"] - 1) * 100) if prev else 0

        all_snaps = await conn.fetch("SELECT portfolio_value FROM forward_test_snapshots WHERE fwd_test_id=$1 ORDER BY snapshot_date ASC", fwd_test_id)
        peak = fwd["initial_capital"]
        max_dd = 0
        for s in all_snaps:
            peak = max(peak, s["portfolio_value"])
            dd = (s["portfolio_value"] - peak) / peak * 100
            max_dd = min(max_dd, dd)
        peak = max(peak, total)
        max_dd = min(max_dd, (total - peak) / peak * 100 if peak > 0 else 0)

        await conn.execute("""
            INSERT INTO forward_test_snapshots (fwd_test_id,portfolio_value,cash,positions_value,num_positions,daily_return_pct,cumulative_return_pct,drawdown_pct,snapshot_date)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (fwd_test_id,snapshot_date) DO UPDATE SET portfolio_value=$2,cash=$3,positions_value=$4,num_positions=$5,daily_return_pct=$6,cumulative_return_pct=$7,drawdown_pct=$8
        """, fwd_test_id, round(total,2), round(cash,2), round(pos_val,2), len(positions), round(daily_ret,2), round(cum_ret,2), round(max_dd,2), dt_date.today())


# ── Forward Test API Endpoints ───────────────────────────────────────────────

@app.post("/api/forward-test/create", tags=["Forward Testing"], summary="Create a forward test",
    description="Create a new forward test to paper-trade a strategy across multiple stocks in real-time. Configure strategy, symbols, position sizing (% of capital), sector caps, max positions, rebalance frequency, slippage, and transaction costs.")
async def create_forward_test(req: ForwardTestCreate, user=Depends(get_current_user)):
    # Expand universe markers
    symbols = req.symbols
    if symbols and symbols[0] == "__ALL__":
        symbols = list(NIFTY_UNIVERSE)
    elif symbols and symbols[0] == "__N200__":
        symbols = list(NIFTY_UNIVERSE)[:200]
    async with db_pool.acquire() as conn:
        fwd_id = await conn.fetchval("""
            INSERT INTO forward_tests (user_id,name,strategy,symbols,params,initial_capital,current_capital,
                weighting,rebalance_freq,max_positions,position_size_pct,sector_cap_pct,lookback_days,slippage_pct,txn_cost_pct)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id
        """, user["id"], req.name, req.strategy, req.symbols, json.dumps(req.params),
            req.initial_capital, req.initial_capital, req.weighting, req.rebalance_freq,
            req.max_positions, req.position_size_pct, req.sector_cap_pct, req.lookback_days,
            req.slippage_pct, req.txn_cost_pct)
        return {"id": fwd_id, "status": "active"}


@app.get("/api/forward-tests", tags=["Forward Testing"], summary="List forward tests",
    description="List all forward tests for the authenticated user with current P&L, open positions count, and status.")
async def list_forward_tests(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ft.*,
                (SELECT COUNT(*) FROM forward_test_positions WHERE fwd_test_id=ft.id AND status='open') as open_positions,
                (SELECT COUNT(*) FROM forward_test_trades WHERE fwd_test_id=ft.id) as total_trades,
                (SELECT COALESCE(SUM(pnl),0) FROM forward_test_trades WHERE fwd_test_id=ft.id AND action='SELL') as realized_pnl
            FROM forward_tests ft WHERE ft.user_id=$1 ORDER BY ft.created_at DESC
        """, user["id"])
        result = []
        for r in rows:
            d = dict(r)
            for k in ["created_at","last_scan_at","last_rebalance_at"]:
                if d.get(k): d[k] = str(d[k])
            result.append(d)
        return result


def _safe_row(row):
    d = dict(row)
    for k, v in d.items():
        if hasattr(v, 'isoformat'): d[k] = str(v)
        elif isinstance(v, float):
            try:
                if np.isnan(v) or np.isinf(v): d[k] = 0
            except: pass
    return d


@app.get("/api/forward-test/{fwd_id}", tags=["Forward Testing"], summary="Get forward test details",
    description="Get full details of a forward test including all positions (open/closed), trade history, equity curve, daily P&L, and live performance metrics.")
async def get_forward_test(fwd_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        if not fwd: raise HTTPException(status_code=404, detail="Not found")

        positions = await conn.fetch("SELECT * FROM forward_test_positions WHERE fwd_test_id=$1 ORDER BY status ASC, entry_date DESC", fwd_id)
        trades = await conn.fetch("SELECT * FROM forward_test_trades WHERE fwd_test_id=$1 ORDER BY executed_at DESC LIMIT 50", fwd_id)
        signals = await conn.fetch("SELECT * FROM forward_test_signals WHERE fwd_test_id=$1 ORDER BY created_at DESC LIMIT 100", fwd_id)
        snapshots = await conn.fetch("SELECT * FROM forward_test_snapshots WHERE fwd_test_id=$1 ORDER BY snapshot_date ASC", fwd_id)

        open_pos = [_safe_row(p) for p in positions if p["status"] == "open"]
        closed_pos = [_safe_row(p) for p in positions if p["status"] == "closed"]
        sell_trades = [dict(t) for t in trades if t["action"] == "SELL"]

        pos_val = sum((p.get("current_price") or p.get("entry_price", 0)) * p.get("quantity", 0) for p in open_pos)
        unrealized = sum(p.get("unrealized_pnl", 0) or 0 for p in open_pos)
        realized = sum(t.get("pnl", 0) or 0 for t in sell_trades)
        total_val = fwd["current_capital"] + pos_val
        total_ret = (total_val / fwd["initial_capital"] - 1) * 100

        winners = [t for t in sell_trades if (t.get("pnl") or 0) > 0]
        losers = [t for t in sell_trades if (t.get("pnl") or 0) < 0]
        win_rate = len(winners) / len(sell_trades) * 100 if sell_trades else 0
        avg_win = sum(t["pnl"] for t in winners) / len(winners) if winners else 0
        avg_loss = sum(t["pnl"] for t in losers) / len(losers) if losers else 0
        profit_factor = abs(sum(t["pnl"] for t in winners)) / abs(sum(t["pnl"] for t in losers)) if losers and sum(t["pnl"] for t in losers) != 0 else 0
        expectancy = (win_rate/100 * avg_win + (1 - win_rate/100) * avg_loss) if sell_trades else 0

        # Equity curve & risk
        eq_data = [{"date": str(s["snapshot_date"]), "value": s["portfolio_value"],
                     "ret": s["cumulative_return_pct"], "dd": s["drawdown_pct"]} for s in snapshots]
        max_dd = min((s["drawdown_pct"] for s in snapshots), default=0)

        # Sharpe from snapshots
        if len(snapshots) > 2:
            rets = [(snapshots[i]["portfolio_value"]/snapshots[i-1]["portfolio_value"]-1) for i in range(1, len(snapshots))]
            import statistics
            mean_r = statistics.mean(rets)
            std_r = statistics.stdev(rets) if len(rets) > 1 else 0.001
            sharpe = (mean_r / std_r) * (252 ** 0.5) if std_r > 0 else 0
        else:
            sharpe = 0

        # Sector breakdown
        sector_alloc = {}
        for p in open_pos:
            sec = p.get("sector") or "Other"
            val = (p.get("current_price") or p.get("entry_price",0)) * p.get("quantity",0)
            sector_alloc[sec] = sector_alloc.get(sec, 0) + val
        if total_val > 0:
            sector_alloc = {k: round(v/total_val*100, 1) for k, v in sector_alloc.items()}

        return {
            "test": _safe_row(fwd),
            "portfolio": {
                "total_value": round(total_val, 2), "cash": round(fwd["current_capital"], 2),
                "positions_value": round(pos_val, 2), "unrealized_pnl": round(unrealized, 2),
                "realized_pnl": round(realized, 2), "total_return_pct": round(total_ret, 2),
                "num_positions": len(open_pos), "total_closed": len(sell_trades),
                "win_rate": round(win_rate, 1), "winners": len(winners), "losers": len(losers),
                "avg_win": round(avg_win, 2), "avg_loss": round(avg_loss, 2),
                "profit_factor": round(profit_factor, 2), "expectancy": round(expectancy, 2),
                "max_drawdown_pct": round(max_dd, 2), "sharpe_ratio": round(sharpe, 2),
                "sector_allocation": sector_alloc,
            },
            "positions": open_pos,
            "closed_positions": closed_pos[:20],
            "recent_trades": [_safe_row(t) for t in trades[:30]],
            "recent_signals": [_safe_row(s) for s in signals[:50]],
            "equity_curve": eq_data,
        }


@app.post("/api/forward-test/{fwd_id}/scan", tags=["Forward Testing"], summary="Run strategy scan",
    description="Trigger a scan of the forward test strategy against its symbol universe. Generates new BUY/SELL signals and optionally auto-executes trades based on the strategy rules.")
async def scan_forward_test(fwd_id: int, user=Depends(get_current_user)):
    """Scan all symbols, generate signals, auto-execute, update prices, snapshot."""
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        if not fwd: raise HTTPException(status_code=404, detail="Not found")
        if fwd["status"] != "active": raise HTTPException(status_code=400, detail="Test is paused")

    signals = await generate_forward_signals(dict(fwd))
    await execute_forward_signals(fwd_id, signals)
    await update_forward_positions(fwd_id)
    await take_portfolio_snapshot(fwd_id)

    buys = [s for s in signals if s["signal"] == "BUY" and s["is_new"]]
    sells = [s for s in signals if s["signal"] == "SELL" and s["is_new"]]
    return {
        "scanned": len(signals), "buy_signals": len(buys), "sell_signals": len(sells),
        "signals": signals[:60],
        "message": f"Scanned {len(signals)} stocks. {len(buys)} BUY, {len(sells)} SELL new signals."
    }


@app.post("/api/forward-test/{fwd_id}/close-position/{pos_id}", tags=["Forward Testing"], summary="Close a forward test position",
    description="Close a specific open position in a forward test at the current market price.")
async def close_fwd_position(fwd_id: int, pos_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        if not fwd: raise HTTPException(status_code=404, detail="Not found")
        pos = await conn.fetchrow("SELECT * FROM forward_test_positions WHERE id=$1 AND fwd_test_id=$2 AND status='open'", pos_id, fwd_id)
        if not pos: raise HTTPException(status_code=404, detail="Position not found")

        price = pos["current_price"] or pos["entry_price"]
        slippage = fwd["slippage_pct"] / 100
        txn_cost = fwd["txn_cost_pct"] / 100
        slipped = price * (1 - slippage)
        pnl = (slipped - pos["entry_price"]) * pos["quantity"]
        fees = abs(pos["quantity"] * slipped) * txn_cost

        await conn.execute("UPDATE forward_test_positions SET status='closed',current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3 WHERE id=$4",
            round(slipped,2), round(pnl-fees,2), round((slipped/pos["entry_price"]-1)*100,2), pos_id)
        await conn.execute("INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,pnl,pnl_pct,exit_reason,fees) VALUES ($1,$2,'SELL',$3,$4,$5,$6,'manual',$7)",
            fwd_id, pos["symbol"], pos["quantity"], round(slipped,2), round(pnl-fees,2), round((slipped/pos["entry_price"]-1)*100,2), round(fees,2))
        new_cap = fwd["current_capital"] + pos["quantity"] * slipped - fees
        await conn.execute("UPDATE forward_tests SET current_capital=$1 WHERE id=$2", round(new_cap,2), fwd_id)
        return {"pnl": round(pnl-fees, 2), "symbol": pos["symbol"]}


@app.post("/api/forward-test/{fwd_id}/close-all", tags=["Forward Testing"], summary="Close all positions",
    description="Close all open positions in a forward test at current market prices. Useful for stopping out or resetting.")
async def close_all_fwd_positions(fwd_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        if not fwd: raise HTTPException(status_code=404, detail="Not found")
        positions = await conn.fetch("SELECT * FROM forward_test_positions WHERE fwd_test_id=$1 AND status='open'", fwd_id)
        total_pnl = 0
        capital = fwd["current_capital"]
        slippage = fwd["slippage_pct"] / 100
        txn_cost = fwd["txn_cost_pct"] / 100
        for pos in positions:
            price = pos["current_price"] or pos["entry_price"]
            slipped = price * (1 - slippage)
            pnl = (slipped - pos["entry_price"]) * pos["quantity"]
            fees = abs(pos["quantity"] * slipped) * txn_cost
            await conn.execute("UPDATE forward_test_positions SET status='closed',current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3 WHERE id=$4",
                round(slipped,2), round(pnl-fees,2), round((slipped/pos["entry_price"]-1)*100,2), pos["id"])
            await conn.execute("INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,pnl,pnl_pct,exit_reason,fees) VALUES ($1,$2,'SELL',$3,$4,$5,$6,'close_all',$7)",
                fwd_id, pos["symbol"], pos["quantity"], round(slipped,2), round(pnl-fees,2), round((slipped/pos["entry_price"]-1)*100,2), round(fees,2))
            capital += pos["quantity"] * slipped - fees
            total_pnl += pnl - fees
        await conn.execute("UPDATE forward_tests SET current_capital=$1 WHERE id=$2", round(capital,2), fwd_id)
        return {"closed": len(positions), "total_pnl": round(total_pnl, 2)}


@app.post("/api/forward-test/{fwd_id}/pause", tags=["Forward Testing"], summary="Pause forward test",
    description="Pause a running forward test. Existing positions remain open but no new signals will be generated.")
async def pause_forward_test(fwd_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE forward_tests SET status='paused' WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        return {"status": "paused"}

@app.post("/api/forward-test/{fwd_id}/resume", tags=["Forward Testing"], summary="Resume forward test",
    description="Resume a paused forward test. Signal generation will restart on next scan.")
async def resume_forward_test(fwd_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE forward_tests SET status='active' WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        return {"status": "active"}

@app.delete("/api/forward-test/{fwd_id}", tags=["Forward Testing"], summary="Delete forward test",
    description="Delete a forward test and all its associated positions and trade history.")
async def delete_forward_test(fwd_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM forward_tests WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        return {"deleted": True}


# ── Screener ──────────────────────────────────────────────────────────────────
# ── Nifty 500 Stock Universe ─────────────────────────────────────────────────
NIFTY_UNIVERSE = [
    # Nifty 50
    "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","WIPRO","BAJFINANCE","SUNPHARMA",
    "TATAMOTORS","ADANIENT","MARUTI","AXISBANK","LTIM","TITAN","HCLTECH","NESTLEIND",
    "POWERGRID","NTPC","COALINDIA","ONGC","JSWSTEEL","TATASTEEL","HINDALCO","CIPLA",
    "DRREDDY","DIVISLAB","APOLLOHOSP","BAJAJFINSV","BRITANNIA","EICHERMOT","SBILIFE",
    "HDFCLIFE","INDUSINDBK","ULTRACEMCO","GRASIM","TECHM","ASIANPAINT","HEROMOTOCO",
    "BPCL","IOC","TATACONSUM","PIDILITIND","HAVELLS","IRCTC","DMART","ZOMATO",
    "SBIN","LT","BHARTIARTL","ITC","KOTAKBANK","M&M","ADANIPORTS","SHRIRAMFIN",
    # Nifty Next 50
    "ABB","ADANIGREEN","AMBUJACEM","BANKBARODA","BEL","BERGEPAINT","BOSCHLTD",
    "CANBK","CHOLAFIN","COLPAL","CONCOR","DABUR","DLF","GAIL","GODREJCP",
    "HAL","HINDPETRO","ICICIPRULI","IDEA","IGL","INDHOTEL","INDUSTOWER",
    "JSWENERGY","JUBLFOOD","LICI","LUPIN","MARICO","MCDOWELL-N","MOTHERSON",
    "MUTHOOTFIN","NAUKRI","NHPC","OBEROIRLTY","OFSS","PAYTM","PFC","PIIND",
    "PNB","POLYCAB","RECLTD","SAIL","SIEMENS","SRF","TORNTPHARM","TRENT",
    "UNIONBANK","UNITDSPR","VEDL","YESBANK","ZYDUSLIFE",
    # Nifty Midcap 150
    "AARTIIND","ACC","AIAENG","AJANTPHARM","ALKEM","ANGELONE","APLAPOLLO",
    "ASHOKLEY","ASTRAL","ATUL","AUBANK","AUROPHARMA","BALKRISIND","BANDHANBNK",
    "BATAINDIA","BHARATFORG","BHEL","BIOCON","BLUEDART","BSE",
    "CANFINHOME","CARBORUNIV","CASTROLIND","CEATLTD","CENTRALBK","CGPOWER",
    "CHAMBLFERT","CLEAN","COFORGE","CRISIL","CROMPTON","CUB","CUMMINSIND",
    "CYIENT","DALBHARAT","DEEPAKNTR","DELTACORP","DEVYANI","DIXON","EIDPARRY",
    "EMAMILTD","ENDURANCE","ESCORTS","EXIDEIND","FACT","FEDERALBNK","FINCABLES",
    "FLUOROCHEM","FORTIS","GLENMARK","GMRINFRA","GNFC","GODREJIND","GODREJPROP",
    "GRANULES","GRAPHITE","GRINDWELL","GUJGASLTD","HDFCAMC","IIFL","IPCALAB",
    "IRB","IRFC","ISEC","JKCEMENT","JSWINFRA","KALYANKJIL","KANSAINER",
    "KEI","KPITTECH","KRBL","L&TFH","LAURUSLABS","LICHSGFIN","LINDEINDIA",
    "LLOYDSME","LODHA","LTTS","M&MFIN","MANAPPURAM","MANKIND","MFSL",
    "MGL","MPHASIS","MRF","NATCOPHARM","NATIONALUM","NAVINFLUOR","NETWORK18",
    "NYKAA","OIL","PAGEIND","PATANJALI","PERSISTENT","PETRONET","PHOENIXLTD",
    "PNBHOUSING","POLICYBZR","POWERINDIA","PRESTIGE","PVR","RAJESHEXPO",
    "RAMCOCEM","RBLBANK","RELAXO","SCHAEFFLER","SHREECEM","SJVN","SOLARINDS",
    "SONACOMS","STARHEALTH","SUNDARMFIN","SUNDRMFAST","SUPREMEIND","SYNGENE",
    "TATACHEM","TATACOMM","TATAELXSI","TATAPOWER","THERMAX","TIMKEN","TORNTPOWER",
    "TVSMOTOR","UBL","UNOMINDA","UPL","VOLTAS","WHIRLPOOL","ZEEL",
    # Nifty Smallcap 250
    "3MINDIA","AAVAS","ABSLAMC","ACE","ADFFOODS","AEGISCHEM","AFFLE","AJMERA",
    "ALKYLAMINE","ALLCARGO","ALOKINDS","AMBER","AMIORG","ANANTRAJ","APARINDS",
    "APTUS","ASAHIINDIA","ASTERDM","BASF","BAJAJELEC","BAJAJHLDNG",
    "BDL","BEML","BIRLACORPN","BLUESTARCO","BRIGADE","BSOFT","CAMPUS",
    "CDSL","CESC","CHALET","CHEMCON","CHENNPETRO","COCHINSHIP","COROMANDEL",
    "CREDITACC","CSBBANK","DATAPATTNS","DCMSHRIRAM","DELHIVERY","ECLERX",
    "EDELWEISS","ERIS","EQUITASBNK","ESABINDIA","FINEORG","FIVESTAR",
    "GALAXYSURF","GARFIBRES","GHCL","GILLETTE","GLAXO","GESHIP","GPPL",
    "GRSE","GSPL","GUJALKALI","HAPPSTMNDS","HATSUN","HEG","HEMIPROP",
    "HINDCOPPER","HINDZINC","HONAUT","HUDCO","IIFLWAM","INDIAMART","INDIANB",
    "INTELLECT","ISGEC","J&KBANK","JAMNAAUTO","JINDALSAW","JKLAKSHMI",
    "JMFINANCIL","JSL","JTEKTINDIA","JUBLINGREA","JUSTDIAL","JYOTHYLAB",
    "KAJARIACER","KALPATPOWR","KEC","KNRCON","KPIGREEN","LAXMIMACH",
    "LEMERETREE","MAHABANK","MAHSEAMLES","MAXHEALTH","MAZDOCK","METROPOLIS",
    "MIDHANI","MMTC","MOIL","MOREPENLAB","MOTILALOFS","MRPL",
    "NAM-INDIA","NBCC","NCC","NESCO","NFL","NIITLTD",
    "NLCINDIA","NMDC","NOCIL","OLECTRA","ORIENTCEM","ORIENTELEC",
    "PGHH","RADICO","RAIN","RALLIS","RATNAMANI","RAYMOND","RCF",
    "REDINGTON","RITES","ROSSARI","ROUTE","RVNL","SANOFI",
    "SARDAEN","SBICARD","SCHNEIDER","SCI","SFL","SHOPERSTOP",
    "SHYAMMETL","SKFINDIA","SOBHA","SOLARA","SONATSOFTW","SOUTHBANK","SPARC",
    "STLTECH","SUDARSCHEM","SUMICHEM","SUNTV","SUPRAJIT","SUVENPHAR",
    "TANLA","TATAINVEST","TCIEXP","TEAMLEASE","TIINDIA","TINPLATE",
    "TRIDENT","TRITURBINE","TVSSRICHAK","UCOBANK","UFLEX","UJJIVANSFB",
    "VARROC","VBLLTD","VINATIORGA","VIPIND","VMART","VOLTAMP",
    "VSTIND","WELCORP","WELSPUNLIV","WESTLIFE","WOCKPHARMA","ZENSARTECH",
    # Additional Popular / F&O / Recent IPOs
    "JIOFIN","ATGL","ADANIENSOL","TATATECH","KAYNES","SYRMA","CAMS","KFINTECH",
    "DELHIVERY","HONASA","MEDANTA","MAPMYINDIA","ABFRL","AETHER","AWL",
    "CERA","DHANUKA","EASEMYTRIP","ELECON","ELGIEQUIP","EPL","FINPIPE",
    "GABRIEL","GICRE","GODREJAGRO","GOODYEAR","GREAVESCOT","HGINFRA","HIKAL",
    "ICRA","IFBIND","INDIGOPNTS","JBCHEPHARM","JKPAPER","KTKBANK","LALPATHLAB",
    "MANYAVAR","MHRIL","MISHRA","NIACL","NUVOCO","PCBL","PRAJIND",
    "PRINCEPIPE","QUESS","RATEGAIN","SAREGAMA","SIS","TITAGARH","TCI",
    "VEDANTFASH","WELSPUNIND","SWSOLAR","SWANENERGY","TARSONS","HERITGFOOD",
    "HINDWAREAP","MAHSCOOTER","DREAMFOLKS",
]
# Deduplicate preserving order
_seen = set()
_clean = []
for _s in NIFTY_UNIVERSE:
    if _s not in _seen:
        _seen.add(_s)
        _clean.append(_s)
NIFTY_UNIVERSE = _clean

# Cap segment classification by index membership
NIFTY50_SYMBOLS = {
    "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","WIPRO","BAJFINANCE","SUNPHARMA",
    "TATAMOTORS","ADANIENT","MARUTI","AXISBANK","LTIM","TITAN","HCLTECH","NESTLEIND",
    "POWERGRID","NTPC","COALINDIA","ONGC","JSWSTEEL","TATASTEEL","HINDALCO","CIPLA",
    "DRREDDY","DIVISLAB","APOLLOHOSP","BAJAJFINSV","BRITANNIA","EICHERMOT","SBILIFE",
    "HDFCLIFE","INDUSINDBK","ULTRACEMCO","GRASIM","TECHM","ASIANPAINT","HEROMOTOCO",
    "BPCL","IOC","TATACONSUM","PIDILITIND","HAVELLS","IRCTC","DMART","ZOMATO",
    "SBIN","LT","BHARTIARTL","ITC","KOTAKBANK","M&M","ADANIPORTS","SHRIRAMFIN"
}
NIFTY_NEXT50_SYMBOLS = {
    "ABB","ADANIGREEN","AMBUJACEM","BANKBARODA","BEL","BERGEPAINT","BOSCHLTD",
    "CANBK","CHOLAFIN","COLPAL","CONCOR","DABUR","DLF","GAIL","GODREJCP",
    "HAL","HINDPETRO","ICICIPRULI","IDEA","IGL","INDHOTEL","INDUSTOWER",
    "JSWENERGY","JUBLFOOD","LICI","LUPIN","MARICO","MCDOWELL-N","MOTHERSON",
    "MUTHOOTFIN","NAUKRI","NHPC","OBEROIRLTY","OFSS","PAYTM","PFC","PIIND",
    "PNB","POLYCAB","RECLTD","SAIL","SIEMENS","SRF","TORNTPHARM","TRENT",
    "UNIONBANK","UNITDSPR","VEDL","YESBANK","ZYDUSLIFE"
}
LARGE_CAP_SYMBOLS = NIFTY50_SYMBOLS | NIFTY_NEXT50_SYMBOLS
MIDCAP_SYMBOLS = {
    "AARTIIND","ACC","AIAENG","AJANTPHARM","ALKEM","ANGELONE","APLAPOLLO",
    "ASHOKLEY","ASTRAL","ATUL","AUBANK","AUROPHARMA","BALKRISIND","BANDHANBNK",
    "BATAINDIA","BHARATFORG","BHEL","BIOCON","BLUEDART","BSE","CANFINHOME",
    "CARBORUNIV","CASTROLIND","CEATLTD","CENTRALBK","CGPOWER","CHAMBLFERT",
    "CLEAN","COFORGE","CRISIL","CROMPTON","CUB","CUMMINSIND","CYIENT",
    "DALBHARAT","DEEPAKNTR","DELTACORP","DEVYANI","DIXON","EIDPARRY","EMAMILTD",
    "ENDURANCE","ESCORTS","EXIDEIND","FACT","FEDERALBNK","FINCABLES","FLUOROCHEM",
    "FORTIS","GLENMARK","GMRINFRA","GNFC","GODREJIND","GODREJPROP","GRANULES",
    "GRAPHITE","GRINDWELL","GUJGASLTD","HDFCAMC","IIFL","IPCALAB","IRB","IRFC",
    "ISEC","JKCEMENT","JSWINFRA","KALYANKJIL","KANSAINER","KEI","KPITTECH",
    "KRBL","L&TFH","LAURUSLABS","LICHSGFIN","LINDEINDIA","LLOYDSME","LODHA",
    "LTTS","M&MFIN","MANAPPURAM","MANKIND","MFSL","NAUKRI","NAVINFLUOR",
    "PERSISTENT","PETRONET","PHOENIXLTD","POLYMED","POONAWALLA","PRESTIGE",
    "PRINCEPIPE","PVRINOX","RADICO","RAIN","RALLIS","RAMCOCEM","RBLBANK",
    "ROUTE","SAFARI","SCHAEFFLER","SHYAMMETL","SJVN","SKFINDIA","SONACOMS",
    "STARHEALTH","SUMICHEM","SUNTV","SUPREMEIND","SYNGENE","TANLA","TATACHEM",
    "TATACOMM","TATAINVEST","TATAPOWER","TATATECH","TEAMLEASE","TIINDIA",
    "TORNTPOWER","TRIDENT","TTML","TVSHLTD","UBL","UFLEX","UJJIVANSFB",
    "USHAMART","UTIAMC","VGUARD","VINATIORGA","VOLTAS","WELCORP","WHIRLPOOL",
    "WONDERLA","ZEEL","ZENSARTECH"
}

def get_cap_segment(symbol):
    """Classify by real market cap from Redis cache (SEBI/AMFI standard).
    Falls back to hardcoded lists if cache unavailable."""
    try:
        import redis as _redis
        _r = _redis.Redis()
        _cached = _r.get("mcap_classifications")
        _r.close()
        if _cached:
            _data = json.loads(_cached)
            _cls = _data.get("classifications", {}).get(symbol)
            if _cls and _cls.get("cap_segment") != "unknown":
                return _cls["cap_segment"]
    except:
        pass
    # Fallback to hardcoded
    if symbol in LARGE_CAP_SYMBOLS: return "large"
    if symbol in MIDCAP_SYMBOLS: return "mid"
    return "small"

def is_asm_gsm(symbol):
    """Check if stock is under ASM/GSM surveillance."""
    try:
        import redis as _redis
        _r = _redis.Redis()
        _cached = _r.get("mcap_classifications")
        _r.close()
        if _cached:
            _data = json.loads(_cached)
            _cls = _data.get("classifications", {}).get(symbol)
            if _cls:
                return _cls.get("is_asm_gsm", False)
            return symbol in _data.get("asm_gsm_list", [])
    except:
        pass
    return False

def get_mcap_crores(symbol):
    """Get market cap in crores from Redis cache."""
    try:
        import redis as _redis
        _r = _redis.Redis()
        _cached = _r.get("mcap_classifications")
        _r.close()
        if _cached:
            _data = json.loads(_cached)
            _cls = _data.get("classifications", {}).get(symbol)
            if _cls:
                return _cls.get("market_cap_cr", 0)
    except:
        pass
    return 0

SECTOR_MAP = {
    # Energy / Oil & Gas
    "RELIANCE":"Energy","ONGC":"Energy","COALINDIA":"Energy","BPCL":"Energy","IOC":"Energy",
    "HINDPETRO":"Energy","GAIL":"Energy","ADANIGREEN":"Energy","TATAPOWER":"Energy",
    "ADANIENSOL":"Energy","JSWENERGY":"Energy","NHPC":"Energy","PFC":"Energy","RECLTD":"Energy",
    "IGL":"Energy","ATGL":"Energy","OIL":"Energy","PETRONET":"Energy","MGL":"Energy",
    "MRPL":"Energy","CHENNPETRO":"Energy","GSPL":"Energy","GPPL":"Energy","SJVN":"Energy",
    "NLCINDIA":"Energy","TORNTPOWER":"Energy","POWERGRID":"Utilities","NTPC":"Utilities",
    "IRFC":"Energy","RCF":"Energy","NFL":"Energy","SWSOLAR":"Energy","SWANENERGY":"Energy",
    # IT / Technology
    "TCS":"IT","INFY":"IT","WIPRO":"IT","HCLTECH":"IT","TECHM":"IT","LTIM":"IT",
    "PERSISTENT":"IT","COFORGE":"IT","MPHASIS":"IT","LTTS":"IT","TATAELXSI":"IT",
    "NAUKRI":"IT","OFSS":"IT","KPITTECH":"IT","CYIENT":"IT","HAPPSTMNDS":"IT",
    "INTELLECT":"IT","BSOFT":"IT","ZENSARTECH":"IT","SONATSOFTW":"IT","NIITLTD":"IT",
    "ECLERX":"IT","TATATECH":"IT","MAPMYINDIA":"IT","ROUTE":"IT","TANLA":"IT",
    "DATAPATTNS":"IT","AFFLE":"IT","RATEGAIN":"IT",
    # Banking
    "HDFCBANK":"Banking","ICICIBANK":"Banking","AXISBANK":"Banking","INDUSINDBK":"Banking",
    "SBIN":"Banking","KOTAKBANK":"Banking","BANKBARODA":"Banking","CANBK":"Banking",
    "PNB":"Banking","YESBANK":"Banking","UNIONBANK":"Banking","FEDERALBNK":"Banking",
    "RBLBANK":"Banking","AUBANK":"Banking","BANDHANBNK":"Banking","CUB":"Banking",
    "CENTRALBK":"Banking","EQUITASBNK":"Banking","J&KBANK":"Banking","INDIANB":"Banking",
    "CSBBANK":"Banking","SOUTHBANK":"Banking","UCOBANK":"Banking","MAHABANK":"Banking",
    "UJJIVANSFB":"Banking","CANFINHOME":"Banking","LICHSGFIN":"Banking","PNBHOUSING":"Banking","KTKBANK":"Banking",
    # NBFC / Finance / Insurance
    "BAJFINANCE":"NBFC","BAJAJFINSV":"NBFC","SHRIRAMFIN":"NBFC","CHOLAFIN":"NBFC",
    "MUTHOOTFIN":"NBFC","LICI":"Insurance","SBILIFE":"Insurance","HDFCLIFE":"Insurance",
    "ICICIPRULI":"Insurance","JIOFIN":"NBFC","POLICYBZR":"Insurance","STARHEALTH":"Insurance",
    "PAYTM":"Fintech","M&MFIN":"NBFC","MANAPPURAM":"NBFC","SUNDARMFIN":"NBFC",
    "L&TFH":"NBFC","MFSL":"NBFC","HDFCAMC":"AMC","ANGELONE":"Broking","ISEC":"Broking",
    "CREDITACC":"NBFC","IIFL":"NBFC","IIFLWAM":"NBFC","EDELWEISS":"NBFC",
    "MOTILALOFS":"NBFC","JMFINANCIL":"NBFC","SBICARD":"NBFC","FIVESTAR":"NBFC",
    "ABSLAMC":"AMC","NAM-INDIA":"AMC","CAMS":"Fintech","KFINTECH":"Fintech",
    "CDSL":"Fintech","BSE":"Exchange","APTUS":"NBFC","GICRE":"Insurance","NIACL":"Insurance",
    # Pharma / Healthcare
    "SUNPHARMA":"Pharma","CIPLA":"Pharma","DRREDDY":"Pharma","DIVISLAB":"Pharma",
    "APOLLOHOSP":"Healthcare","LUPIN":"Pharma","TORNTPHARM":"Pharma","ZYDUSLIFE":"Pharma",
    "BIOCON":"Pharma","AUROPHARMA":"Pharma","LAURUSLABS":"Pharma","MAXHEALTH":"Healthcare",
    "MANKIND":"Pharma","IPCALAB":"Pharma","NATCOPHARM":"Pharma","GLENMARK":"Pharma",
    "ALKEM":"Pharma","AJANTPHARM":"Pharma","GRANULES":"Pharma","SYNGENE":"Pharma",
    "FORTIS":"Healthcare","METROPOLIS":"Healthcare","ERIS":"Pharma","SANOFI":"Pharma",
    "GLAXO":"Pharma","SPARC":"Pharma","WOCKPHARMA":"Pharma","MEDANTA":"Healthcare",
    "ASTERDM":"Healthcare","PATANJALI":"FMCG","HONASA":"FMCG","JBCHEPHARM":"Pharma",
    "LALPATHLAB":"Healthcare","PGHH":"FMCG","MOREPENLAB":"Pharma","SUVENPHAR":"Pharma",
    "SOLARA":"Pharma","TARSONS":"Pharma",
    # Auto
    "TATAMOTORS":"Auto","MARUTI":"Auto","EICHERMOT":"Auto","HEROMOTOCO":"Auto","M&M":"Auto",
    "BOSCHLTD":"Auto","MOTHERSON":"Auto","SONACOMS":"Auto","TVSMOTOR":"Auto",
    "ASHOKLEY":"Auto","BHARATFORG":"Auto","EXIDEIND":"Auto","BALKRISIND":"Auto",
    "CEATLTD":"Auto","ENDURANCE":"Auto","ESCORTS":"Auto","SUNDRMFAST":"Auto",
    "UNOMINDA":"Auto","JAMNAAUTO":"Auto","VARROC":"Auto","TVSSRICHAK":"Auto",
    "SUPRAJIT":"Auto","JTEKTINDIA":"Auto","SKFINDIA":"Auto","TIMKEN":"Auto",
    "GABRIEL":"Auto","GREAVESCOT":"Auto","MAHSCOOTER":"Auto","GOODYEAR":"Tyres",
    # Metal / Mining
    "JSWSTEEL":"Metal","TATASTEEL":"Metal","HINDALCO":"Metal","VEDL":"Metal","SAIL":"Metal",
    "NATIONALUM":"Metal","NMDC":"Metal","HINDCOPPER":"Metal","HINDZINC":"Metal",
    "MOIL":"Metal","GRAPHITE":"Metal","WELCORP":"Metal","JINDALSAW":"Metal",
    "JSL":"Metal","RATNAMANI":"Metal","HEG":"Metal","SHYAMMETL":"Metal","WELSPUNIND":"Metal",
    # FMCG
    "NESTLEIND":"FMCG","BRITANNIA":"FMCG","TATACONSUM":"FMCG","ITC":"FMCG",
    "COLPAL":"FMCG","DABUR":"FMCG","GODREJCP":"FMCG","MARICO":"FMCG",
    "UNITDSPR":"FMCG","MCDOWELL-N":"FMCG","EMAMILTD":"FMCG","JYOTHYLAB":"FMCG",
    "RADICO":"FMCG","UBL":"FMCG","HATSUN":"FMCG","VBLLTD":"FMCG",
    "GILLETTE":"FMCG","VSTIND":"FMCG","RAJESHEXPO":"FMCG","AWL":"FMCG","HERITGFOOD":"FMCG",
    # Consumer / Retail
    "TITAN":"Consumer","ASIANPAINT":"Consumer","HAVELLS":"Consumer",
    "DMART":"Retail","PAGEIND":"Consumer","TRENT":"Retail","NYKAA":"Retail",
    "KALYANKJIL":"Consumer","JUBLFOOD":"Consumer","VOLTAS":"Consumer",
    "CROMPTON":"Consumer","WHIRLPOOL":"Consumer","BATAINDIA":"Consumer","RELAXO":"Consumer",
    "SHOPERSTOP":"Retail","VMART":"Retail","CAMPUS":"Consumer","VIPIND":"Consumer",
    "DEVYANI":"Consumer","WESTLIFE":"Consumer","BERGEPAINT":"Consumer","AMBER":"Consumer",
    "IFBIND":"Consumer","INDIGOPNTS":"Consumer","BAJAJELEC":"Consumer",
    "ABFRL":"Retail","MANYAVAR":"Retail","VEDANTFASH":"Retail",
    # Infra / Capital Goods / Defence
    "LT":"Infra","ADANIPORTS":"Infra","ABB":"Industrial","SIEMENS":"Industrial",
    "HAL":"Defence","BEL":"Defence","CGPOWER":"Industrial","POLYCAB":"Industrial",
    "CONCOR":"Logistics","BHEL":"Industrial","CUMMINSIND":"Industrial",
    "THERMAX":"Industrial","IRB":"Infra","KEC":"Infra","KALPATPOWR":"Infra",
    "KNRCON":"Infra","NCC":"Infra","NBCC":"Infra","RITES":"Infra","RVNL":"Infra",
    "GMRINFRA":"Infra","JSWINFRA":"Infra","POWERINDIA":"Industrial",
    "SCHAEFFLER":"Industrial","LINDEINDIA":"Industrial","TRITURBINE":"Industrial",
    "GRINDWELL":"Industrial","CARBORUNIV":"Industrial","ISGEC":"Industrial",
    "BEML":"Industrial","MAZDOCK":"Defence","GRSE":"Defence","COCHINSHIP":"Defence",
    "BDL":"Defence","MIDHANI":"Defence","KAYNES":"Electronics","SYRMA":"Electronics",
    "DIXON":"Electronics","HGINFRA":"Infra","TITAGARH":"Industrial","MISHRA":"Defence",
    "ELECON":"Industrial","ELGIEQUIP":"Industrial","PRAJIND":"Industrial","VOLTAMP":"Industrial",
    "LAXMIMACH":"Industrial","ESABINDIA":"Industrial",
    # Cement / Building
    "ULTRACEMCO":"Cement","GRASIM":"Cement","AMBUJACEM":"Cement","SHREECEM":"Cement",
    "RAMCOCEM":"Cement","JKCEMENT":"Cement","DALBHARAT":"Cement","ACC":"Cement",
    "BIRLACORPN":"Cement","ORIENTCEM":"Cement","NUVOCO":"Cement",
    "ASTRAL":"Building","APLAPOLLO":"Building","SUPREMEIND":"Building","KEI":"Building",
    "KAJARIACER":"Building","CERA":"Building","PRINCEPIPE":"Building","HINDWAREAP":"Building","FINPIPE":"Building",
    # Chemicals
    "PIDILITIND":"Chemical","SRF":"Chemical","PIIND":"Chemical","DEEPAKNTR":"Chemical","AARTIIND":"Chemical",
    "ATUL":"Chemical","NAVINFLUOR":"Chemical","FLUOROCHEM":"Chemical","CLEAN":"Chemical",
    "ALKYLAMINE":"Chemical","AMIORG":"Chemical","FINEORG":"Chemical","GALAXYSURF":"Chemical",
    "GNFC":"Chemical","CHAMBLFERT":"Chemical","COROMANDEL":"Chemical","DCMSHRIRAM":"Chemical",
    "TATACHEM":"Chemical","SUDARSCHEM":"Chemical","SUMICHEM":"Chemical","BASF":"Chemical",
    "NOCIL":"Chemical","RAIN":"Chemical","GHCL":"Chemical","GUJALKALI":"Chemical",
    "ROSSARI":"Chemical","VINATIORGA":"Chemical","CHEMCON":"Chemical","HIKAL":"Chemical",
    "PCBL":"Chemical","AETHER":"Chemical",
    # Realty
    "DLF":"Realty","OBEROIRLTY":"Realty","LODHA":"Realty","PHOENIXLTD":"Realty",
    "GODREJPROP":"Realty","PRESTIGE":"Realty","BRIGADE":"Realty","SOBHA":"Realty",
    "ANANTRAJ":"Realty","HEMIPROP":"Realty","AJMERA":"Realty",
    # Telecom / Media / Internet
    "BHARTIARTL":"Telecom","IDEA":"Telecom","INDUSTOWER":"Telecom","TATACOMM":"Telecom",
    "STLTECH":"Telecom","ZOMATO":"Internet","INDIAMART":"Internet","JUSTDIAL":"Internet",
    "ZEEL":"Media","SUNTV":"Media","NETWORK18":"Media","PVR":"Media","SAREGAMA":"Media",
    # Travel / Hotels / Logistics
    "IRCTC":"Travel","INDHOTEL":"Hotels","LEMERETREE":"Hotels","CHALET":"Hotels","MHRIL":"Hotels",
    "EASEMYTRIP":"Travel","DREAMFOLKS":"Travel","DELHIVERY":"Logistics","BLUEDART":"Logistics",
    "ALLCARGO":"Logistics","GESHIP":"Logistics","TCI":"Logistics","TCIEXP":"Logistics",
    "SCI":"Shipping","REDINGTON":"Distribution",
    # Others
    "ADANIENT":"Conglomerate","3MINDIA":"Conglomerate","HONAUT":"Industrial","MRF":"Tyres",
    "CRISIL":"Rating","ICRA":"Rating","TRIDENT":"Textile","WELSPUNLIV":"Textile",
    "ALOKINDS":"Textile","SFL":"Textile","APARINDS":"Textile","EIDPARRY":"Sugar",
    "DHANUKA":"Agri","RALLIS":"Agri","GODREJAGRO":"Agri","MMTC":"Trading",
    "HUDCO":"Housing","CASTROLIND":"Lubricant","FACT":"Fertilizer",
    "TATAINVEST":"Holding","BAJAJHLDNG":"Holding","KANSAINER":"Packaging","EPL":"Packaging",
    "CESC":"Utilities","JKPAPER":"Paper","TEAMLEASE":"Staffing","QUESS":"Staffing","SIS":"Services",
    "RAYMOND":"Textile","UFLEX":"Packaging","UPL":"Agri",
    # Previously unmapped stocks
    "AAVAS":"NBFC","ACE":"Industrial","ADFFOODS":"FMCG","AEGISCHEM":"Chemical",
    "AIAENG":"Industrial","ASAHIINDIA":"Building","BLUESTARCO":"Consumer",
    "DELTACORP":"Hotels","FINCABLES":"Industrial","GARFIBRES":"Chemical",
    "GODREJIND":"Chemical","GUJGASLTD":"Energy","JKLAKSHMI":"Cement",
    "JUBLINGREA":"Chemical","KPIGREEN":"Energy","KRBL":"FMCG",
    "LLOYDSME":"Metal","MAHSEAMLES":"Metal","NESCO":"Realty",
    "OLECTRA":"Auto","ORIENTELEC":"Consumer","SARDAEN":"Energy",
    "SCHNEIDER":"Industrial","SOLARINDS":"Industrial","TIINDIA":"Industrial",
    "TINPLATE":"Metal",
}


INDUSTRY_MAP = {
    "HDFCBANK":"Banks",
    "ICICIBANK":"Banks",
    "AXISBANK":"Banks",
    "KOTAKBANK":"Banks",
    "INDUSINDBK":"Banks",
    "FEDERALBNK":"Banks",
    "RBLBANK":"Banks",
    "AUBANK":"Banks",
    "BANDHANBNK":"Banks",
    "CUB":"Banks",
    "CSBBANK":"Banks",
    "EQUITASBNK":"Banks",
    "UJJIVANSFB":"Banks",
    "SBIN":"Banks",
    "BANKBARODA":"Banks",
    "PNB":"Banks",
    "CANBK":"Banks",
    "UNIONBANK":"Banks",
    "INDIANB":"Banks",
    "CENTRALBK":"Banks",
    "UCOBANK":"Banks",
    "MAHABANK":"Banks",
    "SOUTHBANK":"Banks",
    "J&KBANK":"Banks",
    "KTKBANK":"Banks",
    "YESBANK":"Banks",
    "CANFINHOME":"Finance - Housing",
    "LICHSGFIN":"Finance - Housing",
    "PNBHOUSING":"Finance - Housing",
    "HUDCO":"Finance - Housing",
    "FIVESTAR":"Finance - Housing",
    "APTUS":"Finance - Housing",
    "AAVAS":"Finance - Housing",
    "BAJFINANCE":"Finance - NBFC",
    "BAJAJFINSV":"Holding Company",
    "SHRIRAMFIN":"Finance - NBFC",
    "CHOLAFIN":"Finance - NBFC",
    "M&MFIN":"Finance - NBFC",
    "MUTHOOTFIN":"Finance - NBFC",
    "MANAPPURAM":"Finance - NBFC",
    "JIOFIN":"Finance - NBFC",
    "L&TFH":"Finance - NBFC",
    "MFSL":"Holding Company",
    "SUNDARMFIN":"Finance - NBFC",
    "CREDITACC":"Finance - Microfinance",
    "IIFL":"Finance - NBFC",
    "IIFLWAM":"Capital Markets",
    "MOTILALOFS":"Capital Markets",
    "JMFINANCIL":"Capital Markets",
    "SBICARD":"Finance - NBFC",
    "EDELWEISS":"Finance - NBFC",
    "LICI":"Insurance",
    "SBILIFE":"Insurance",
    "HDFCLIFE":"Insurance",
    "ICICIPRULI":"Insurance",
    "POLICYBZR":"Insurance",
    "STARHEALTH":"Insurance",
    "GICRE":"Insurance",
    "NIACL":"Insurance",
    "HDFCAMC":"Capital Markets",
    "ABSLAMC":"Capital Markets",
    "NAM-INDIA":"Capital Markets",
    "ANGELONE":"Capital Markets",
    "ISEC":"Capital Markets",
    "CAMS":"Capital Markets",
    "CDSL":"Capital Markets",
    "KFINTECH":"Capital Markets",
    "PAYTM":"Fintech",
    "BSE":"Capital Markets",
    "CRISIL":"Capital Markets",
    "ICRA":"Capital Markets",
    "TCS":"IT - Software",
    "INFY":"IT - Software",
    "WIPRO":"IT - Software",
    "HCLTECH":"IT - Software",
    "TECHM":"IT - Software",
    "LTIM":"IT - Software",
    "PERSISTENT":"IT - Software",
    "COFORGE":"IT - Software",
    "MPHASIS":"IT - Software",
    "LTTS":"IT - Software",
    "TATAELXSI":"IT - Software",
    "KPITTECH":"IT - Software",
    "CYIENT":"IT - Software",
    "HAPPSTMNDS":"IT - Software",
    "INTELLECT":"IT - Software",
    "BSOFT":"IT - Software",
    "ZENSARTECH":"IT - Software",
    "SONATSOFTW":"IT - Software",
    "NIITLTD":"IT - Education",
    "ECLERX":"IT - Software",
    "TATATECH":"IT - Software",
    "NAUKRI":"Internet Software",
    "OFSS":"IT - Software",
    "MAPMYINDIA":"Internet Software",
    "ROUTE":"Internet Software",
    "TANLA":"Telecom - Equipment",
    "DATAPATTNS":"Defence",
    "AFFLE":"Internet Software",
    "RATEGAIN":"Internet Software",
    "DIXON":"Consumer Electronics",
    "KAYNES":"Consumer Electronics",
    "SYRMA":"Consumer Electronics",
    "ZOMATO":"Internet Software",
    "INDIAMART":"Internet Software",
    "JUSTDIAL":"Internet Software",
    "SUNPHARMA":"Pharmaceuticals",
    "CIPLA":"Pharmaceuticals",
    "DRREDDY":"Pharmaceuticals",
    "DIVISLAB":"Pharmaceuticals",
    "LUPIN":"Pharmaceuticals",
    "TORNTPHARM":"Pharmaceuticals",
    "ZYDUSLIFE":"Pharmaceuticals",
    "BIOCON":"Pharmaceuticals",
    "AUROPHARMA":"Pharmaceuticals",
    "LAURUSLABS":"Pharmaceuticals",
    "MANKIND":"Pharmaceuticals",
    "IPCALAB":"Pharmaceuticals",
    "NATCOPHARM":"Pharmaceuticals",
    "GLENMARK":"Pharmaceuticals",
    "ALKEM":"Pharmaceuticals",
    "AJANTPHARM":"Pharmaceuticals",
    "GRANULES":"Pharmaceuticals",
    "SYNGENE":"Pharmaceuticals",
    "ERIS":"Pharmaceuticals",
    "SANOFI":"Pharmaceuticals",
    "GLAXO":"Pharmaceuticals",
    "SPARC":"Pharmaceuticals",
    "WOCKPHARMA":"Pharmaceuticals",
    "JBCHEPHARM":"Pharmaceuticals",
    "MOREPENLAB":"Pharmaceuticals",
    "SUVENPHAR":"Pharmaceuticals",
    "SOLARA":"Pharmaceuticals",
    "TARSONS":"Healthcare Equipment",
    "APOLLOHOSP":"Healthcare Services",
    "MAXHEALTH":"Healthcare Services",
    "FORTIS":"Healthcare Services",
    "MEDANTA":"Healthcare Services",
    "ASTERDM":"Healthcare Services",
    "LALPATHLAB":"Healthcare Services",
    "METROPOLIS":"Healthcare Services",
    "TATAMOTORS":"Automobiles",
    "MARUTI":"Automobiles",
    "M&M":"Automobiles",
    "EICHERMOT":"Automobiles",
    "HEROMOTOCO":"Automobiles",
    "TVSMOTOR":"Automobiles",
    "ASHOKLEY":"Automobiles",
    "ESCORTS":"Automobiles",
    "MAHSCOOTER":"Automobiles",
    "OLECTRA":"Automobiles",
    "GREAVESCOT":"Automobiles",
    "BOSCHLTD":"Auto Components",
    "MOTHERSON":"Auto Components",
    "SONACOMS":"Auto Components",
    "BHARATFORG":"Castings & Forgings",
    "EXIDEIND":"Auto Components",
    "BALKRISIND":"Tyres",
    "CEATLTD":"Tyres",
    "MRF":"Tyres",
    "GOODYEAR":"Tyres",
    "ENDURANCE":"Auto Components",
    "SUNDRMFAST":"Auto Components",
    "UNOMINDA":"Auto Components",
    "JAMNAAUTO":"Auto Components",
    "VARROC":"Auto Components",
    "TVSSRICHAK":"Auto Components",
    "SUPRAJIT":"Auto Components",
    "JTEKTINDIA":"Bearings",
    "SKFINDIA":"Bearings",
    "TIMKEN":"Bearings",
    "GABRIEL":"Auto Components",
    "JSWSTEEL":"Iron & Steel",
    "TATASTEEL":"Iron & Steel",
    "SAIL":"Iron & Steel",
    "JINDALSAW":"Iron & Steel Products",
    "JSL":"Iron & Steel Products",
    "WELCORP":"Iron & Steel Products",
    "RATNAMANI":"Iron & Steel Products",
    "SHYAMMETL":"Iron & Steel",
    "LLOYDSME":"Iron & Steel Products",
    "MAHSEAMLES":"Iron & Steel Products",
    "TINPLATE":"Iron & Steel Products",
    "WELSPUNIND":"Iron & Steel Products",
    "HINDALCO":"Non-Ferrous Metals",
    "VEDL":"Non-Ferrous Metals",
    "NATIONALUM":"Non-Ferrous Metals",
    "HINDCOPPER":"Non-Ferrous Metals",
    "HINDZINC":"Non-Ferrous Metals",
    "NMDC":"Mining & Minerals",
    "MOIL":"Mining & Minerals",
    "COALINDIA":"Mining & Minerals",
    "GRAPHITE":"Industrial Minerals",
    "HEG":"Industrial Minerals",
    "RELIANCE":"Oil & Gas",
    "ONGC":"Oil & Gas",
    "OIL":"Oil & Gas",
    "BPCL":"Oil & Gas",
    "IOC":"Oil & Gas",
    "HINDPETRO":"Oil & Gas",
    "MRPL":"Oil & Gas",
    "CHENNPETRO":"Oil & Gas",
    "GAIL":"Gas Distribution",
    "PETRONET":"Gas Distribution",
    "IGL":"Gas Distribution",
    "ATGL":"Gas Distribution",
    "MGL":"Gas Distribution",
    "GUJGASLTD":"Gas Distribution",
    "GSPL":"Gas Distribution",
    "GPPL":"Gas Distribution",
    "TATAPOWER":"Power",
    "JSWENERGY":"Power",
    "NHPC":"Power",
    "SJVN":"Power",
    "NLCINDIA":"Power",
    "TORNTPOWER":"Power",
    "NTPC":"Power",
    "POWERGRID":"Power",
    "CESC":"Power",
    "SARDAEN":"Power",
    "PFC":"Finance - Term Lending",
    "RECLTD":"Finance - Term Lending",
    "IRFC":"Finance - Term Lending",
    "ADANIGREEN":"Renewable Energy",
    "ADANIENSOL":"Renewable Energy",
    "SWSOLAR":"Renewable Energy",
    "SWANENERGY":"Renewable Energy",
    "KPIGREEN":"Renewable Energy",
    "NFL":"Fertilizers",
    "RCF":"Fertilizers",
    "CHAMBLFERT":"Fertilizers",
    "COROMANDEL":"Fertilizers",
    "FACT":"Fertilizers",
    "NESTLEIND":"Food Products",
    "BRITANNIA":"Food Products",
    "TATACONSUM":"Food Products",
    "ITC":"Diversified FMCG",
    "HATSUN":"Food Products",
    "VBLLTD":"Beverages",
    "RAJESHEXPO":"Food Products",
    "HERITGFOOD":"Food Products",
    "AWL":"Edible Oils",
    "ADFFOODS":"Food Products",
    "KRBL":"Food Products",
    "COLPAL":"Personal Care",
    "DABUR":"Personal Care",
    "GODREJCP":"Personal Care",
    "MARICO":"Personal Care",
    "UNITDSPR":"Personal Care",
    "EMAMILTD":"Personal Care",
    "JYOTHYLAB":"Household Products",
    "GILLETTE":"Personal Care",
    "PGHH":"Household Products",
    "PATANJALI":"Personal Care",
    "HONASA":"Personal Care",
    "MCDOWELL-N":"Alcoholic Beverages",
    "RADICO":"Alcoholic Beverages",
    "UBL":"Alcoholic Beverages",
    "VSTIND":"Tobacco Products",
    "TITAN":"Consumer Durables",
    "KALYANKJIL":"Gems & Jewellery",
    "PAGEIND":"Readymade Garments",
    "BATAINDIA":"Footwear",
    "RELAXO":"Footwear",
    "CAMPUS":"Footwear",
    "VIPIND":"Plastic Products",
    "ASIANPAINT":"Paints",
    "BERGEPAINT":"Paints",
    "INDIGOPNTS":"Paints",
    "HAVELLS":"Consumer Electronics",
    "CROMPTON":"Consumer Electronics",
    "VOLTAS":"Consumer Electronics",
    "WHIRLPOOL":"Consumer Electronics",
    "AMBER":"Consumer Electronics",
    "IFBIND":"Consumer Electronics",
    "BAJAJELEC":"Consumer Electronics",
    "BLUESTARCO":"Consumer Electronics",
    "ORIENTELEC":"Consumer Electronics",
    "JUBLFOOD":"Quick Service Restaurants",
    "DEVYANI":"Quick Service Restaurants",
    "WESTLIFE":"Quick Service Restaurants",
    "DMART":"Retailing",
    "TRENT":"Retailing",
    "NYKAA":"Retailing",
    "ABFRL":"Retailing",
    "MANYAVAR":"Retailing",
    "VEDANTFASH":"Retailing",
    "SHOPERSTOP":"Retailing",
    "VMART":"Retailing",
    "LT":"Construction",
    "NCC":"Construction",
    "NBCC":"Construction",
    "KNRCON":"Construction",
    "HGINFRA":"Construction",
    "IRB":"Construction",
    "GMRINFRA":"Infrastructure Developers",
    "JSWINFRA":"Infrastructure Developers",
    "ADANIPORTS":"Infrastructure Developers",
    "KALPATPOWR":"Power - T&D",
    "KEC":"Power - T&D",
    "RITES":"Transport Infrastructure",
    "RVNL":"Transport Infrastructure",
    "ABB":"Electrical Equipment",
    "SIEMENS":"Electrical Equipment",
    "CGPOWER":"Electrical Equipment",
    "POLYCAB":"Electrical Equipment",
    "BHEL":"Electrical Equipment",
    "CUMMINSIND":"Industrial Machinery",
    "THERMAX":"Industrial Machinery",
    "POWERINDIA":"Electrical Equipment",
    "VOLTAMP":"Electrical Equipment",
    "SCHNEIDER":"Electrical Equipment",
    "FINCABLES":"Electrical Equipment",
    "KEI":"Electrical Equipment",
    "SCHAEFFLER":"Bearings",
    "LINDEINDIA":"Industrial Gases",
    "TRITURBINE":"Industrial Machinery",
    "GRINDWELL":"Abrasives",
    "CARBORUNIV":"Abrasives",
    "ISGEC":"Industrial Machinery",
    "ELGIEQUIP":"Compressors",
    "PRAJIND":"Industrial Machinery",
    "ELECON":"Industrial Machinery",
    "LAXMIMACH":"Machine Tools",
    "ESABINDIA":"Industrial Machinery",
    "ACE":"Industrial Machinery",
    "AIAENG":"Industrial Machinery",
    "SOLARINDS":"Rubber Products",
    "TIINDIA":"Diversified",
    "HONAUT":"Industrial Machinery",
    "TITAGARH":"Transport Infrastructure",
    "BEML":"Industrial Machinery",
    "HAL":"Defence",
    "BEL":"Defence",
    "MAZDOCK":"Shipbuilding",
    "GRSE":"Shipbuilding",
    "COCHINSHIP":"Shipbuilding",
    "BDL":"Defence",
    "MIDHANI":"Defence",
    "MISHRA":"Defence",
    "ULTRACEMCO":"Cement",
    "GRASIM":"Cement",
    "AMBUJACEM":"Cement",
    "SHREECEM":"Cement",
    "RAMCOCEM":"Cement",
    "JKCEMENT":"Cement",
    "DALBHARAT":"Cement",
    "ACC":"Cement",
    "BIRLACORPN":"Cement",
    "ORIENTCEM":"Cement",
    "NUVOCO":"Cement",
    "JKLAKSHMI":"Cement",
    "ASTRAL":"Plastic Products",
    "APLAPOLLO":"Iron & Steel Products",
    "SUPREMEIND":"Plastic Products",
    "KAJARIACER":"Ceramics",
    "CERA":"Sanitaryware",
    "PRINCEPIPE":"Plastic Products",
    "HINDWAREAP":"Sanitaryware",
    "FINPIPE":"Plastic Products",
    "ASAHIINDIA":"Glass",
    "PIDILITIND":"Specialty Chemicals",
    "SRF":"Specialty Chemicals",
    "PIIND":"Agrochemicals",
    "DEEPAKNTR":"Commodity Chemicals",
    "AARTIIND":"Specialty Chemicals",
    "ATUL":"Diversified Chemicals",
    "NAVINFLUOR":"Specialty Chemicals",
    "FLUOROCHEM":"Specialty Chemicals",
    "CLEAN":"Specialty Chemicals",
    "ALKYLAMINE":"Specialty Chemicals",
    "AMIORG":"Specialty Chemicals",
    "FINEORG":"Specialty Chemicals",
    "GALAXYSURF":"Specialty Chemicals",
    "VINATIORGA":"Specialty Chemicals",
    "ROSSARI":"Specialty Chemicals",
    "CHEMCON":"Specialty Chemicals",
    "HIKAL":"Specialty Chemicals",
    "PCBL":"Specialty Chemicals",
    "AETHER":"Specialty Chemicals",
    "AEGISCHEM":"Petrochemicals",
    "GARFIBRES":"Specialty Chemicals",
    "GODREJIND":"Specialty Chemicals",
    "JUBLINGREA":"Specialty Chemicals",
    "GNFC":"Commodity Chemicals",
    "TATACHEM":"Commodity Chemicals",
    "BASF":"Diversified Chemicals",
    "NOCIL":"Rubber Chemicals",
    "RAIN":"Commodity Chemicals",
    "GHCL":"Commodity Chemicals",
    "GUJALKALI":"Commodity Chemicals",
    "SUDARSCHEM":"Specialty Chemicals",
    "SUMICHEM":"Agrochemicals",
    "DCMSHRIRAM":"Diversified Chemicals",
    "UPL":"Agrochemicals",
    "DHANUKA":"Agrochemicals",
    "RALLIS":"Agrochemicals",
    "GODREJAGRO":"Agrochemicals",
    "DLF":"Realty",
    "OBEROIRLTY":"Realty",
    "LODHA":"Realty",
    "PHOENIXLTD":"Realty",
    "GODREJPROP":"Realty",
    "PRESTIGE":"Realty",
    "BRIGADE":"Realty",
    "SOBHA":"Realty",
    "ANANTRAJ":"Realty",
    "HEMIPROP":"Realty",
    "AJMERA":"Realty",
    "NESCO":"Realty",
    "BHARTIARTL":"Telecom Services",
    "IDEA":"Telecom Services",
    "INDUSTOWER":"Telecom - Equipment",
    "TATACOMM":"Telecom Services",
    "STLTECH":"Telecom - Equipment",
    "ZEEL":"Media & Entertainment",
    "SUNTV":"Media & Entertainment",
    "NETWORK18":"Media & Entertainment",
    "PVR":"Media & Entertainment",
    "SAREGAMA":"Media & Entertainment",
    "IRCTC":"Leisure Services",
    "INDHOTEL":"Hotels",
    "LEMERETREE":"Hotels",
    "CHALET":"Hotels",
    "MHRIL":"Leisure Services",
    "DELTACORP":"Leisure Services",
    "EASEMYTRIP":"Leisure Services",
    "DREAMFOLKS":"Leisure Services",
    "DELHIVERY":"Logistics",
    "BLUEDART":"Logistics",
    "CONCOR":"Logistics",
    "ALLCARGO":"Logistics",
    "GESHIP":"Shipping",
    "TCI":"Logistics",
    "TCIEXP":"Logistics",
    "SCI":"Shipping",
    "REDINGTON":"Trading",
    "TRIDENT":"Textiles",
    "WELSPUNLIV":"Textiles",
    "ALOKINDS":"Textiles",
    "SFL":"Textiles",
    "APARINDS":"Textiles",
    "RAYMOND":"Textiles",
    "KANSAINER":"Packaging",
    "EPL":"Packaging",
    "UFLEX":"Packaging",
    "ADANIENT":"Diversified",
    "3MINDIA":"Diversified",
    "EIDPARRY":"Sugar",
    "MMTC":"Trading",
    "CASTROLIND":"Lubricants",
    "JKPAPER":"Paper",
    "TATAINVEST":"Holding Company",
    "BAJAJHLDNG":"Holding Company",
    "TEAMLEASE":"Miscellaneous",
    "QUESS":"Miscellaneous",
    "SIS":"Miscellaneous",
}

BASIC_INDUSTRY_MAP = {
    "HDFCBANK":"Private Sector Bank",
    "ICICIBANK":"Private Sector Bank",
    "AXISBANK":"Private Sector Bank",
    "KOTAKBANK":"Private Sector Bank",
    "INDUSINDBK":"Private Sector Bank",
    "FEDERALBNK":"Private Sector Bank",
    "RBLBANK":"Private Sector Bank",
    "AUBANK":"Private Sector Bank",
    "BANDHANBNK":"Private Sector Bank",
    "CUB":"Private Sector Bank",
    "CSBBANK":"Private Sector Bank",
    "EQUITASBNK":"Small Finance Bank",
    "UJJIVANSFB":"Small Finance Bank",
    "YESBANK":"Private Sector Bank",
    "SBIN":"Public Sector Bank",
    "BANKBARODA":"Public Sector Bank",
    "PNB":"Public Sector Bank",
    "CANBK":"Public Sector Bank",
    "UNIONBANK":"Public Sector Bank",
    "INDIANB":"Public Sector Bank",
    "CENTRALBK":"Public Sector Bank",
    "UCOBANK":"Public Sector Bank",
    "MAHABANK":"Public Sector Bank",
    "SOUTHBANK":"Public Sector Bank",
    "J&KBANK":"Public Sector Bank",
    "KTKBANK":"Public Sector Bank",
    "CANFINHOME":"Housing Finance Company",
    "LICHSGFIN":"Housing Finance Company",
    "PNBHOUSING":"Housing Finance Company",
    "HUDCO":"Housing Finance Company",
    "FIVESTAR":"Housing Finance Company",
    "APTUS":"Housing Finance Company",
    "AAVAS":"Housing Finance Company",
    "BAJFINANCE":"Consumer Finance",
    "BAJAJFINSV":"Financial Services Holding",
    "SHRIRAMFIN":"Vehicle Finance",
    "CHOLAFIN":"Vehicle Finance",
    "M&MFIN":"Vehicle Finance",
    "MUTHOOTFIN":"Gold Loan Company",
    "MANAPPURAM":"Gold Loan Company",
    "JIOFIN":"Diversified Financial Services",
    "L&TFH":"Infrastructure Finance",
    "MFSL":"Financial Services Holding",
    "SUNDARMFIN":"Vehicle Finance",
    "CREDITACC":"Microfinance Institutions",
    "IIFL":"Diversified Financial Services",
    "SBICARD":"Credit Card Issuer",
    "EDELWEISS":"Diversified Financial Services",
    "IIFLWAM":"Wealth Management",
    "MOTILALOFS":"Stock Broking",
    "JMFINANCIL":"Investment Banking",
    "HDFCAMC":"Asset Management Company",
    "ABSLAMC":"Asset Management Company",
    "NAM-INDIA":"Asset Management Company",
    "ANGELONE":"Stock Broking",
    "ISEC":"Stock Broking",
    "CAMS":"Registrar & Transfer Agent",
    "CDSL":"Depository",
    "KFINTECH":"Registrar & Transfer Agent",
    "PAYTM":"Digital Payments",
    "BSE":"Stock Exchange",
    "CRISIL":"Credit Rating Agency",
    "ICRA":"Credit Rating Agency",
    "LICI":"Life Insurance",
    "SBILIFE":"Life Insurance",
    "HDFCLIFE":"Life Insurance",
    "ICICIPRULI":"Life Insurance",
    "POLICYBZR":"Insurance Distributor",
    "STARHEALTH":"Health Insurance",
    "GICRE":"Reinsurance",
    "NIACL":"General Insurance",
    "TCS":"IT Services - Large Cap",
    "INFY":"IT Services - Large Cap",
    "WIPRO":"IT Services - Large Cap",
    "HCLTECH":"IT Services - Large Cap",
    "TECHM":"IT Services - Large Cap",
    "LTIM":"IT Services - Large Cap",
    "PERSISTENT":"Product Engineering",
    "COFORGE":"Vertical IT Services",
    "MPHASIS":"BFSI IT Services",
    "LTTS":"Engineering R&D",
    "TATAELXSI":"Embedded Product Design",
    "KPITTECH":"Auto Mobility R&D",
    "CYIENT":"Aerospace & Geospatial R&D",
    "HAPPSTMNDS":"Digital Transformation",
    "INTELLECT":"Banking Software Products",
    "BSOFT":"Enterprise Software",
    "ZENSARTECH":"IT Services - Mid Cap",
    "SONATSOFTW":"Enterprise Software Products",
    "NIITLTD":"IT Education & Training",
    "ECLERX":"Analytics & KPO",
    "TATATECH":"Automotive Engineering R&D",
    "NAUKRI":"Online Recruitment",
    "OFSS":"Core Banking Products",
    "MAPMYINDIA":"Geospatial Technology",
    "ROUTE":"Mobile Marketing Platform",
    "TANLA":"Cloud Communications Platform",
    "DATAPATTNS":"Defence Electronics",
    "AFFLE":"Mobile Advertising",
    "RATEGAIN":"Travel Technology SaaS",
    "DIXON":"Consumer Electronics EMS",
    "KAYNES":"Industrial Electronics EMS",
    "SYRMA":"IoT & Automotive EMS",
    "ZOMATO":"Food Delivery & Quick Commerce",
    "INDIAMART":"B2B E-Commerce",
    "JUSTDIAL":"Local Search & Discovery",
    "SUNPHARMA":"Integrated Pharma - Global",
    "CIPLA":"Respiratory Generics",
    "DRREDDY":"US Generics Focused",
    "DIVISLAB":"Custom API Synthesis",
    "LUPIN":"Multi-Market Generics",
    "TORNTPHARM":"Chronic Therapy Formulations",
    "ZYDUSLIFE":"Generics & Biosimilars",
    "BIOCON":"Biosimilars & CDMO",
    "AUROPHARMA":"US Injectable Generics",
    "LAURUSLABS":"ARV & Oncology API",
    "MANKIND":"Domestic Branded Generics",
    "IPCALAB":"API & Formulation Export",
    "NATCOPHARM":"Oncology Niche",
    "GLENMARK":"Derma & Respiratory",
    "ALKEM":"Acute Therapy - India",
    "AJANTPHARM":"Emerging Market Generics",
    "GRANULES":"Pharma API & PFI",
    "SYNGENE":"Contract Research & Manufacturing",
    "ERIS":"Chronic Branded Generics",
    "SANOFI":"MNC Pharma - India",
    "GLAXO":"MNC Pharma - India",
    "SPARC":"Drug Discovery Research",
    "WOCKPHARMA":"Hospital Injectables",
    "JBCHEPHARM":"API Manufacturer",
    "MOREPENLAB":"Diagnostics & API",
    "SUVENPHAR":"CNS Specialty",
    "SOLARA":"Pain Management API",
    "TARSONS":"Laboratory Plasticware",
    "APOLLOHOSP":"Multi-Specialty Hospitals",
    "MAXHEALTH":"Multi-Specialty Hospitals",
    "FORTIS":"Multi-Specialty Hospitals",
    "MEDANTA":"Super Specialty Hospital",
    "ASTERDM":"Multi-Specialty Hospitals",
    "LALPATHLAB":"Pathology Diagnostics",
    "METROPOLIS":"Pathology Diagnostics",
    "TATAMOTORS":"Passenger & Commercial Vehicles",
    "MARUTI":"Passenger Cars",
    "M&M":"UV, Tractors & Farm Equipment",
    "EICHERMOT":"Premium Motorcycles",
    "HEROMOTOCO":"Mass Market Two Wheelers",
    "TVSMOTOR":"Two & Three Wheelers",
    "ASHOKLEY":"Medium & Heavy CV",
    "ESCORTS":"Tractors & Railway Equipment",
    "MAHSCOOTER":"Scooters",
    "OLECTRA":"Electric Buses",
    "GREAVESCOT":"Electric Three Wheelers",
    "BOSCHLTD":"Fuel Systems & Auto Electronics",
    "MOTHERSON":"Wiring Harness & Modules",
    "SONACOMS":"Drivetrain & EV Components",
    "BHARATFORG":"Auto & Industrial Forgings",
    "EXIDEIND":"Batteries - Lead Acid",
    "BALKRISIND":"Off-Highway Tyres",
    "CEATLTD":"Passenger & Truck Tyres",
    "MRF":"Tyres - Full Range",
    "GOODYEAR":"Tyres - MNC",
    "ENDURANCE":"Suspension & Alloy Wheels",
    "SUNDRMFAST":"Fasteners",
    "UNOMINDA":"Auto Lighting & Switches",
    "JAMNAAUTO":"Suspension Springs",
    "VARROC":"Polymer & Lighting",
    "TVSSRICHAK":"Precision Components",
    "SUPRAJIT":"Control Cables",
    "JTEKTINDIA":"Steering Systems",
    "SKFINDIA":"Bearings - MNC",
    "TIMKEN":"Engineered Bearings - MNC",
    "GABRIEL":"Shock Absorbers",
    "JSWSTEEL":"Integrated Steel - Private",
    "TATASTEEL":"Integrated Steel - Private",
    "SAIL":"Integrated Steel - PSU",
    "JINDALSAW":"Welded & Seamless Pipes",
    "JSL":"Stainless Steel Flat",
    "WELCORP":"ERW & Spiral Pipes",
    "RATNAMANI":"SS & CS Tubes",
    "SHYAMMETL":"Ferro Alloys & Steel",
    "LLOYDSME":"GP & GC Pipes",
    "MAHSEAMLES":"Seamless Tubes",
    "TINPLATE":"Electrolytic Tinplate",
    "WELSPUNIND":"Large Dia Pipes",
    "HINDALCO":"Aluminium & Copper",
    "VEDL":"Diversified Mining & Smelting",
    "NATIONALUM":"Aluminium Smelting - PSU",
    "HINDCOPPER":"Copper Cathode - PSU",
    "HINDZINC":"Zinc & Lead Smelting",
    "NMDC":"Iron Ore Mining",
    "MOIL":"Manganese Ore Mining",
    "COALINDIA":"Coal Mining",
    "GRAPHITE":"Graphite Electrodes",
    "HEG":"Graphite Electrodes",
    "RELIANCE":"Integrated Oil & Retail",
    "ONGC":"Upstream E&P - PSU",
    "OIL":"Upstream E&P - PSU",
    "BPCL":"Oil Marketing Company - PSU",
    "IOC":"Oil Marketing Company - PSU",
    "HINDPETRO":"Oil Marketing Company - PSU",
    "MRPL":"Standalone Refinery",
    "CHENNPETRO":"Standalone Refinery",
    "GAIL":"Gas Transmission & Marketing",
    "PETRONET":"LNG Regasification",
    "IGL":"City Gas - Delhi NCR",
    "ATGL":"City Gas - Gujarat",
    "MGL":"City Gas - Mumbai",
    "GUJGASLTD":"City Gas - Gujarat",
    "GSPL":"Gas Transmission Pipeline",
    "GPPL":"Gas Transmission Pipeline",
    "TATAPOWER":"Integrated Power Utility",
    "JSWENERGY":"Thermal & Hydro IPP",
    "NHPC":"Hydroelectric - PSU",
    "SJVN":"Hydroelectric - PSU",
    "NLCINDIA":"Lignite & Thermal Power",
    "TORNTPOWER":"Power Distribution",
    "NTPC":"Thermal Power - PSU",
    "POWERGRID":"Transmission Grid - PSU",
    "CESC":"Power Distribution",
    "SARDAEN":"Ferro Alloy & Captive Power",
    "PFC":"Power Sector Lending",
    "RECLTD":"Rural Electrification Lending",
    "IRFC":"Railway Capex Lending",
    "ADANIGREEN":"Utility Solar & Wind",
    "ADANIENSOL":"Renewable Solutions",
    "SWSOLAR":"Solar EPC & Modules",
    "SWANENERGY":"Biomass Energy",
    "KPIGREEN":"Solar Developer",
    "NFL":"Urea Manufacturing",
    "RCF":"Urea Manufacturing",
    "CHAMBLFERT":"Urea Manufacturing",
    "COROMANDEL":"Complex Fertilizer & Crop Protection",
    "FACT":"Complex Fertilizer",
    "NESTLEIND":"Packaged Foods - MNC",
    "BRITANNIA":"Biscuits & Bakery",
    "TATACONSUM":"Tea, Coffee & Staples",
    "ITC":"Cigarettes & Diversified FMCG",
    "HATSUN":"Dairy Products",
    "VBLLTD":"Beverage Bottling",
    "RAJESHEXPO":"Processed Food Exports",
    "HERITGFOOD":"Dairy Products",
    "AWL":"Edible Oil",
    "ADFFOODS":"Ready-to-Eat Foods",
    "KRBL":"Basmati Rice",
    "COLPAL":"Oral Care - MNC",
    "DABUR":"Ayurveda & Personal Care",
    "GODREJCP":"Personal Hygiene & Hair",
    "MARICO":"Hair & Edible Oil",
    "UNITDSPR":"Home & Personal Care - MNC",
    "EMAMILTD":"Personal Care & OTC",
    "JYOTHYLAB":"Fabric & Home Care",
    "GILLETTE":"Grooming - MNC",
    "PGHH":"Home & Personal Care - MNC",
    "PATANJALI":"Ayurveda & Wellness",
    "HONASA":"D2C Personal Care",
    "MCDOWELL-N":"Indian Made Spirits",
    "RADICO":"Indian Made Spirits",
    "UBL":"Beer Brewing",
    "VSTIND":"Cigarettes",
    "TITAN":"Watches & Jewellery",
    "KALYANKJIL":"Jewellery Retail",
    "PAGEIND":"Innerwear & Apparel",
    "BATAINDIA":"Footwear Retail",
    "RELAXO":"Mass Footwear",
    "CAMPUS":"Sports Footwear",
    "VIPIND":"Luggage",
    "ASIANPAINT":"Decorative Paints",
    "BERGEPAINT":"Decorative Paints",
    "INDIGOPNTS":"Decorative Paints",
    "HAVELLS":"Electrical Consumer Goods",
    "CROMPTON":"Fans & Lighting",
    "VOLTAS":"Air Conditioning",
    "WHIRLPOOL":"Home Appliances - MNC",
    "AMBER":"AC Components & ODM",
    "IFBIND":"Washing Machines & Kitchen",
    "BAJAJELEC":"Small Appliances",
    "BLUESTARCO":"Commercial & Residential AC",
    "ORIENTELEC":"Fans & Lighting",
    "JUBLFOOD":"QSR - Pizza",
    "DEVYANI":"QSR - Fried Chicken & Pizza",
    "WESTLIFE":"QSR - Burgers",
    "DMART":"Hypermarket",
    "TRENT":"Fashion Retail",
    "NYKAA":"Beauty E-Commerce",
    "ABFRL":"Branded Fashion",
    "MANYAVAR":"Ethnic Wear",
    "VEDANTFASH":"Ethnic Wear",
    "SHOPERSTOP":"Department Store",
    "VMART":"Value Fashion",
    "LT":"EPC Conglomerate",
    "NCC":"Building & Road EPC",
    "NBCC":"PSU Construction & PMC",
    "KNRCON":"Road EPC - HAM & BOT",
    "HGINFRA":"Road EPC - HAM & BOT",
    "IRB":"Road BOT & Toll",
    "GMRINFRA":"Airport Development",
    "JSWINFRA":"Port Development",
    "ADANIPORTS":"Port & SEZ",
    "ABB":"Electrical & Automation - MNC",
    "SIEMENS":"Digital Industries - MNC",
    "CGPOWER":"Motors & Traction",
    "POLYCAB":"Cables & FMEG",
    "BHEL":"Heavy Electrical - PSU",
    "CUMMINSIND":"Engines & Gensets - MNC",
    "THERMAX":"Boilers & Environment",
    "POWERINDIA":"Transformers - MNC",
    "VOLTAMP":"Transformers",
    "SCHNEIDER":"Switchgear - MNC",
    "FINCABLES":"Specialised Cables",
    "KEI":"Power & Control Cables",
    "KALPATPOWR":"Transmission EPC",
    "KEC":"T&D & Infrastructure EPC",
    "RITES":"Rail Consultancy - PSU",
    "RVNL":"Railway Construction - PSU",
    "SCHAEFFLER":"Bearings - MNC",
    "LINDEINDIA":"Industrial Gases - MNC",
    "TRITURBINE":"Steam Turbines",
    "GRINDWELL":"Abrasives - MNC",
    "CARBORUNIV":"Electrominerals & Abrasives",
    "ISGEC":"Process Equipment & Boilers",
    "ELGIEQUIP":"Air Compressors",
    "PRAJIND":"Bioenergy Equipment",
    "ELECON":"Gears & Material Handling",
    "LAXMIMACH":"CNC Machine Tools",
    "ESABINDIA":"Welding Equipment - MNC",
    "ACE":"Cranes & Construction Equipment",
    "AIAENG":"High Chrome Mill Internals",
    "SOLARINDS":"Industrial Belts",
    "TIINDIA":"Tubes, Cycles & Industrial",
    "HONAUT":"Automation - MNC",
    "TITAGARH":"Rail Wagons & Metro",
    "BEML":"Mining & Defence Equipment",
    "HAL":"Aerospace & Fighter Aircraft",
    "BEL":"Defence Radar & EW",
    "MAZDOCK":"Warship & Submarine Builder",
    "GRSE":"Warship Builder",
    "COCHINSHIP":"Ship Repair & Construction",
    "BDL":"Missile Systems",
    "MIDHANI":"Super Alloys & Special Steel",
    "MISHRA":"Defence Forgings & Armour",
    "ULTRACEMCO":"Grey Cement - India's Largest",
    "GRASIM":"Cement & VSF",
    "AMBUJACEM":"Grey Cement - Pan India",
    "SHREECEM":"Grey Cement - Premium",
    "RAMCOCEM":"Grey Cement - South",
    "JKCEMENT":"Grey & White Cement",
    "DALBHARAT":"Grey Cement - South",
    "ACC":"Grey Cement - Pan India",
    "BIRLACORPN":"Grey Cement - East",
    "ORIENTCEM":"Grey Cement - Central",
    "NUVOCO":"Grey Cement - East",
    "JKLAKSHMI":"Grey Cement - North",
    "ASTRAL":"CPVC & PVC Pipes",
    "APLAPOLLO":"Steel Tubes & Pipes",
    "SUPREMEIND":"Plastic Pipes",
    "KAJARIACER":"Ceramic & Vitrified Tiles",
    "CERA":"Sanitaryware & Faucets",
    "PRINCEPIPE":"PVC & CPVC Pipes",
    "HINDWAREAP":"Sanitaryware & Tiles",
    "FINPIPE":"PVC Pipes",
    "ASAHIINDIA":"Float & Auto Glass",
    "PIDILITIND":"Adhesives & Sealants",
    "SRF":"Fluorochemicals & Packaging",
    "PIIND":"Custom Agrochemicals",
    "DEEPAKNTR":"Phenol & Acetone",
    "AARTIIND":"Benzene Derivatives",
    "ATUL":"Multi-Segment Chemicals",
    "NAVINFLUOR":"Refrigerant Gases",
    "FLUOROCHEM":"PTFE & Fluoropolymers",
    "CLEAN":"Pharma Specialty API",
    "ALKYLAMINE":"Amines & Derivatives",
    "AMIORG":"Pharma Intermediates",
    "FINEORG":"Oleochemical Additives",
    "GALAXYSURF":"Surfactants",
    "VINATIORGA":"ATBS & Isobutylene Derivatives",
    "ROSSARI":"Performance Chemicals",
    "CHEMCON":"Chlorosilanes",
    "HIKAL":"Crop & Pharma Intermediates",
    "PCBL":"Carbon Black",
    "AETHER":"Specialty Intermediates",
    "AEGISCHEM":"LPG & Petrochemicals",
    "GARFIBRES":"Fiberglass Composites",
    "GODREJIND":"Oleochemicals & Surfactants",
    "JUBLINGREA":"Oleochemical Ingredients",
    "GNFC":"Neem Chemicals & TDI",
    "TATACHEM":"Soda Ash & Salt",
    "BASF":"Diversified Chemicals - MNC",
    "NOCIL":"Rubber Chemicals",
    "RAIN":"Calcined Petroleum Coke",
    "GHCL":"Soda Ash",
    "GUJALKALI":"Caustic Soda",
    "SUDARSCHEM":"Pigments",
    "SUMICHEM":"Crop Protection - MNC",
    "DCMSHRIRAM":"Chlor-Alkali & Sugar",
    "UPL":"Global Crop Protection",
    "DHANUKA":"Domestic Crop Protection",
    "RALLIS":"Crop Care & Seeds",
    "GODREJAGRO":"Animal Feed & Crop Protection",
    "DLF":"Residential & Commercial",
    "OBEROIRLTY":"Premium Residential & Office",
    "LODHA":"Residential Developer",
    "PHOENIXLTD":"Retail Mall Developer",
    "GODREJPROP":"Residential Developer",
    "PRESTIGE":"Mixed-Use Developer",
    "BRIGADE":"Mixed-Use Developer",
    "SOBHA":"Residential & Contractual",
    "ANANTRAJ":"NCR Real Estate",
    "HEMIPROP":"Industrial & Warehouse",
    "AJMERA":"Residential Developer",
    "NESCO":"IT Parks & Convention",
    "BHARTIARTL":"Mobile & Broadband Operator",
    "IDEA":"Mobile Operator",
    "INDUSTOWER":"Telecom Tower Infra",
    "TATACOMM":"Enterprise Telecom",
    "STLTECH":"Optical Fibre Cable",
    "ZEEL":"TV Broadcasting",
    "SUNTV":"Regional TV Broadcasting",
    "NETWORK18":"Media Conglomerate",
    "PVR":"Multiplex Cinema",
    "SAREGAMA":"Music Label & IP",
    "IRCTC":"Rail Catering & Tourism",
    "INDHOTEL":"Luxury Hotels - Tata",
    "LEMERETREE":"Budget & Mid Hotels",
    "CHALET":"Luxury Hotels",
    "MHRIL":"Holiday Resorts",
    "DELTACORP":"Casino & Hospitality",
    "EASEMYTRIP":"Online Travel Agency",
    "DREAMFOLKS":"Airport Lounge Platform",
    "DELHIVERY":"Express & Freight Logistics",
    "BLUEDART":"Premium Express Courier",
    "CONCOR":"Container Rail - PSU",
    "ALLCARGO":"Multimodal Logistics",
    "GESHIP":"Tanker & Gas Shipping",
    "TCI":"Integrated Logistics",
    "TCIEXP":"Express Freight",
    "SCI":"Bulk & Tanker Shipping - PSU",
    "REDINGTON":"IT Distribution",
    "TRIDENT":"Home Textiles Export",
    "WELSPUNLIV":"Home Textiles Export",
    "ALOKINDS":"Apparel Fabrics",
    "SFL":"Synthetic Yarn & Fabrics",
    "APARINDS":"Technical Textiles",
    "RAYMOND":"Suiting & Apparel",
    "KANSAINER":"Metal Packaging",
    "EPL":"Laminated Tubes",
    "UFLEX":"Flexible Packaging Films",
    "ADANIENT":"Diversified Conglomerate",
    "3MINDIA":"Diversified MNC",
    "EIDPARRY":"Sugar Manufacturing",
    "MMTC":"Commodity Trading - PSU",
    "CASTROLIND":"Automotive Lubricants",
    "JKPAPER":"Writing & Printing Paper",
    "TATAINVEST":"Investment Holding",
    "BAJAJHLDNG":"Investment Holding",
    "TEAMLEASE":"Staffing Services",
    "QUESS":"Business Services",
    "SIS":"Security Services",
}

# ══════════════════════════════════════════════════════════════════════════════
# DYNAMIC UNIVERSE LOADER — Override from stock_universe.json if available
# ══════════════════════════════════════════════════════════════════════════════
_UNIVERSE_JSON = "/opt/alphaforge/stock_universe.json"
_UNIVERSE_LOADED = False
try:
    if os.path.exists(_UNIVERSE_JSON):
        with open(_UNIVERSE_JSON) as _f:
            _udata = json.load(_f)
        if _udata.get("universe") and len(_udata["universe"]) > len(NIFTY_UNIVERSE):
            NIFTY_UNIVERSE = _udata["universe"]
            # Override sector map (merge: keep existing manual overrides, add new from JSON)
            _json_sectors = _udata.get("sector_map", {})
            for _sym, _sec in _json_sectors.items():
                if _sym not in SECTOR_MAP:  # Don't override manually curated entries
                    SECTOR_MAP[_sym] = _sec
            # Override industry map
            _json_industries = _udata.get("industry_map", {})
            for _sym, _ind in _json_industries.items():
                if _sym not in INDUSTRY_MAP:
                    INDUSTRY_MAP[_sym] = _ind
                if _sym not in BASIC_INDUSTRY_MAP:
                    BASIC_INDUSTRY_MAP[_sym] = _ind
            _UNIVERSE_LOADED = True
            print(f"[UNIVERSE] Loaded {len(NIFTY_UNIVERSE)} stocks from {_UNIVERSE_JSON} (generated: {_udata.get('generated_at','?')})")
        else:
            print(f"[UNIVERSE] JSON has {len(_udata.get('universe',[]))} stocks, keeping built-in {len(NIFTY_UNIVERSE)}")
    else:
        print(f"[UNIVERSE] No {_UNIVERSE_JSON} found, using built-in {len(NIFTY_UNIVERSE)} stocks")
        print(f"[UNIVERSE] Run: python3 /opt/alphaforge/nse_universe_builder.py to expand to all NSE stocks")
except Exception as _e:
    print(f"[UNIVERSE] Error loading JSON: {_e}, using built-in {len(NIFTY_UNIVERSE)} stocks")

# ── yfinance helper ───────────────────────────────────────────────────────────
def yf_extract_ticker(raw, yf_sym, single_mode=False):
    """Extract single-ticker DataFrame from yfinance download, handling MultiIndex columns."""
    if raw.empty:
        return pd.DataFrame()

    if not isinstance(raw.columns, pd.MultiIndex):
        return raw.copy()

    level0 = set(raw.columns.get_level_values(0).unique())
    price_cols = {"Close", "Open", "High", "Low", "Volume", "Adj Close"}

    # Detect: is level 0 price-types or tickers?
    if level0.issubset(price_cols):
        # Level 0 = Price type, Level 1 = Ticker
        if single_mode:
            df = raw.copy()
            df.columns = df.columns.droplevel(1)
            return df
        else:
            # Multi-ticker: extract this ticker from level 1
            try:
                df = raw.xs(yf_sym, level=1, axis=1).copy()
                return df
            except KeyError:
                return pd.DataFrame()
    else:
        # Level 0 = Ticker, Level 1 = Price type (group_by="ticker" format)
        if yf_sym in level0:
            return raw[yf_sym].copy()
        else:
            return pd.DataFrame()

async def batch_download_yf(symbols_ns: list, start: str, end: str, batch_size: int = 50) -> dict:
    """Download data via data service with yfinance fallback. Returns dict of {yf_sym: DataFrame}."""
    # Try data service first
    try:
        # Parallel fetch via data service (batched for efficiency)
        ds_result = {}
        async def _fetch_one(sym_ns):
            sym = sym_ns.replace(".NS","").replace(".BO","").upper()
            rows = await ds_ohlcv(sym, "1y")
            if rows:
                df = pd.DataFrame(rows)
                df.columns = [c.lower() for c in df.columns]
                for dc in ["date","datetime","timestamp"]:
                    if dc in df.columns:
                        df[dc] = pd.to_datetime(df[dc])
                        df = df.set_index(dc)
                        break
                df.index.name = "date"
                keep = [c for c in ["open","high","low","close","volume"] if c in df.columns]
                df = df[keep].astype({c: float for c in keep}).dropna().sort_index()
                if not df.empty:
                    df.columns = [c.capitalize() for c in df.columns]
                    ds_result[sym_ns] = df
        # Process in parallel batches of 20
        for i in range(0, len(symbols_ns), 20):
            batch = symbols_ns[i:i+20]
            await asyncio.gather(*[_fetch_one(s) for s in batch], return_exceptions=True)
        if ds_result:
            return ds_result
    except Exception as e:
        print(f"[DataService] batch failed, falling back to yfinance: {e}")
    import yfinance as yf

    loop = asyncio.get_event_loop()
    all_data = {}

    for i in range(0, len(symbols_ns), batch_size):
        batch = symbols_ns[i:i+batch_size]
        try:
            if len(batch) == 1:
                raw = await loop.run_in_executor(None, lambda b=batch: yf.download(
                    tickers=b[0], start=start, end=end,
                    interval="1d", auto_adjust=True, progress=False
                ))
                df = yf_extract_ticker(raw, batch[0], single_mode=True)
                if not df.empty:
                    all_data[batch[0]] = df
            else:
                raw = await loop.run_in_executor(None, lambda b=batch: yf.download(
                    tickers=" ".join(b), start=start, end=end,
                    interval="1d", group_by="ticker", auto_adjust=True, progress=False, threads=True
                ))
                for sym in batch:
                    try:
                        df = yf_extract_ticker(raw, sym)
                        if not df.empty and len(df) > 0:
                            all_data[sym] = df
                    except Exception:
                        continue
        except Exception:
            continue

    return all_data

@app.get("/api/screener", tags=["Stock Screener"], summary="Run stock screener",
    description="Screen 843 NSE stocks using 34+ quantitative strategies. Filter by sector, industry, basic industry, and price range. Results are cached for 15 minutes.\n\n**Available strategies:** momentum, top_losers, volume_breakout, new_high, mean_reversion, rsi_oversold, rsi_overbought, macd_crossover, bollinger_squeeze, supertrend_buy, breakout_52w, relative_strength, golden_cross, death_cross, adx_strong_trend, high_tight_flag, inside_day, gap_up, darvas_box, turtle_breakout, ichimoku_bullish, elder_ray, williams_r, ema_ribbon, pivot_breakout, dividend_yield, low_pe, high_roe, growth_momentum, safe_haven, minervini_template, rvol_surge, sector_rotation, vwap_reclaim.")
async def screener(strategy: str = "momentum", min_price: float = 50, max_price: float = 10000, sector: str = "", industry: str = "", basic_industry: str = "", cap_segment: str = "", user=Depends(get_current_user)):
    result = await _run_screener_internal(strategy, min_price, max_price, sector, industry, basic_industry, cap_segment)
    return result

async def _screener_legacy_unused(strategy: str = "momentum", min_price: float = 50, max_price: float = 10000, sector: str = "", industry: str = "", basic_industry: str = "", cap_segment: str = "", user=Depends(get_current_user)):
    from datetime import date, timedelta

    cache_key = f"screener:{__import__('datetime').date.today().isoformat()}:{strategy}:{int(min_price)}:{int(max_price)}:{sector}:{industry}:{basic_industry}:{cap_segment}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    # 365+ days for proper 200 DMA, 52-week calculations
    start = (date.today() - timedelta(days=400)).isoformat()
    end = date.today().isoformat()

    # ── PRE-FILTER: Narrow universe BEFORE downloading (critical for 2000+ stocks) ──
    symbols_to_scan = list(NIFTY_UNIVERSE)
    if sector:
        symbols_to_scan = [s for s in symbols_to_scan if SECTOR_MAP.get(s, "Other") == sector]
    if industry:
        symbols_to_scan = [s for s in symbols_to_scan if INDUSTRY_MAP.get(s, "Other") == industry]
    if basic_industry:
        symbols_to_scan = [s for s in symbols_to_scan if BASIC_INDUSTRY_MAP.get(s, "Other") == basic_industry]
    
    yf_symbols = [f"{s}.NS" for s in symbols_to_scan]

    # Batch download — use larger batches for efficiency
    _batch_sz = 40 if len(yf_symbols) > 500 else 50
    all_data = await batch_download_yf(yf_symbols, start, end, batch_size=_batch_sz)

    def sf(v, d=0):
        try:
            v = float(v)
            return d if (np.isnan(v) or np.isinf(v)) else v
        except:
            return d

    stocks = []
    for sym in symbols_to_scan:
        try:
            yf_sym = f"{sym}.NS"
            if yf_sym not in all_data:
                continue
            df = all_data[yf_sym].dropna()
            if len(df) < 30: continue

            c = df["Close"].astype(float)
            h = df["High"].astype(float)
            l = df["Low"].astype(float)
            v = df["Volume"].astype(float)

            price = float(c.iloc[-1])
            prev = float(c.iloc[-2])
            if price < min_price or price > max_price: continue
            stock_sector = SECTOR_MAP.get(sym, "Other")
            if sector and stock_sector != sector: continue
            stock_industry = INDUSTRY_MAP.get(sym, "Other")
            if industry and stock_industry != industry: continue
            stock_basic_industry = BASIC_INDUSTRY_MAP.get(sym, "Other")
            if basic_industry and stock_basic_industry != basic_industry: continue

            change_pct = sf((price - prev) / prev * 100)
            vol = int(v.iloc[-1])
            vol_avg = int(v.rolling(20).mean().iloc[-1]) if len(v) >= 20 else int(v.mean())
            vol_ratio = sf(vol / vol_avg, 1.0) if vol_avg > 0 else 1.0

            # RSI 14 (EMA-based)
            delta = c.diff()
            gain = delta.clip(lower=0).ewm(span=14, adjust=False).mean()
            loss = (-delta.clip(upper=0)).ewm(span=14, adjust=False).mean()
            rs = gain.iloc[-1] / loss.iloc[-1] if sf(loss.iloc[-1]) != 0 else 0
            rsi = sf(100 - 100 / (1 + rs), 50)

            # Moving averages
            sma_20 = sf(c.rolling(20).mean().iloc[-1])
            sma_50 = sf(c.rolling(50).mean().iloc[-1])
            sma_200 = sf(c.rolling(200).mean().iloc[-1]) if len(c) >= 200 else sf(c.mean())
            ema_9 = sf(c.ewm(span=9, adjust=False).mean().iloc[-1])
            ema_21 = sf(c.ewm(span=21, adjust=False).mean().iloc[-1])

            # 52-week high/low
            c_252 = c.iloc[-min(252, len(c)):]
            w52_high = sf(c_252.max())
            w52_low = sf(c_252.min())
            pct_from_52h = sf((price - w52_high) / w52_high * 100) if w52_high > 0 else 0
            pct_from_52l = sf((price - w52_low) / w52_low * 100) if w52_low > 0 else 0

            # Gap (today open vs yesterday close)
            gap_pct = sf((float(df["Open"].iloc[-1]) - prev) / prev * 100) if prev > 0 else 0

            # Bollinger Bands
            bb_mid = c.rolling(20).mean()
            bb_std = c.rolling(20).std()
            bb_upper = sf((bb_mid + 2 * bb_std).iloc[-1])
            bb_lower = sf((bb_mid - 2 * bb_std).iloc[-1])
            bb_width = sf((bb_upper - bb_lower) / sf(bb_mid.iloc[-1], 1) * 100) if sf(bb_mid.iloc[-1]) > 0 else 0

            # MACD
            ema12 = c.ewm(span=12, adjust=False).mean()
            ema26 = c.ewm(span=26, adjust=False).mean()
            macd_line = ema12 - ema26
            macd_signal = macd_line.ewm(span=9, adjust=False).mean()
            macd_hist = sf((macd_line - macd_signal).iloc[-1])
            macd_cross_up = sf(macd_line.iloc[-1]) > sf(macd_signal.iloc[-1]) and sf(macd_line.iloc[-2]) <= sf(macd_signal.iloc[-2])

            # Golden/Death cross
            sma50_series = c.rolling(50).mean()
            sma200_series = c.rolling(200).mean() if len(c) >= 200 else c.rolling(min(len(c), 100)).mean()
            golden_cross = False
            death_cross = False
            if len(sma50_series.dropna()) >= 2 and len(sma200_series.dropna()) >= 2:
                golden_cross = sf(sma50_series.iloc[-1]) > sf(sma200_series.iloc[-1]) and sf(sma50_series.iloc[-2]) <= sf(sma200_series.iloc[-2])
                death_cross = sf(sma50_series.iloc[-1]) < sf(sma200_series.iloc[-1]) and sf(sma50_series.iloc[-2]) >= sf(sma200_series.iloc[-2])

            # N-day breakout
            high_20 = sf(h.rolling(20).max().iloc[-2]) if len(h) > 20 else sf(h.max())

            # Supertrend (simplified: ATR-based)
            atr_period = 10
            if len(df) > atr_period + 1:
                tr = pd.concat([
                    h - l,
                    (h - df["Close"].shift(1)).abs(),
                    (l - df["Close"].shift(1)).abs()
                ], axis=1).max(axis=1)
                atr = tr.rolling(atr_period).mean()
                st_upper = (h + l) / 2 + 3 * atr
                st_lower = (h + l) / 2 - 3 * atr
                above_supertrend = price > sf(st_lower.iloc[-1])
            else:
                above_supertrend = above_200

            # Relative Strength
            if len(c) >= 60:
                rs_1m = sf(c.iloc[-1] / c.iloc[-22] - 1, 0) * 100 if sf(c.iloc[-22]) > 0 else 0
                rs_3m = sf(c.iloc[-1] / c.iloc[-60] - 1, 0) * 100 if sf(c.iloc[-60]) > 0 else 0
            else:
                rs_1m = change_pct
                rs_3m = change_pct

            # Minervini trend template
            above_150 = price > sf(c.rolling(150).mean().iloc[-1]) if len(c) >= 150 else False
            above_200 = price > sma_200
            sma150_above_200 = sf(c.rolling(150).mean().iloc[-1]) > sma_200 if len(c) >= 150 else False
            price_above_52l_25 = pct_from_52l >= 25
            price_within_52h_25 = pct_from_52h >= -25
            minervini_score = sum([above_150, above_200, sma150_above_200, sma_50 > sma_200, price_above_52l_25, price_within_52h_25, price > sma_50])

            # Weekly change
            wk_change = sf((price / sf(c.iloc[-6], price) - 1) * 100) if len(c) >= 6 else change_pct

            stocks.append({
                "symbol": sym,
                "price": round(sf(price), 2),
                "change_pct": round(change_pct, 2),
                "volume": vol,
                "vol_ratio": round(vol_ratio, 2),
                "rsi": round(rsi, 1),
                "above_200dma": above_200,
                "sector": SECTOR_MAP.get(sym, "Other"), "industry": INDUSTRY_MAP.get(sym, "Other"), "basic_industry": BASIC_INDUSTRY_MAP.get(sym, "Other"),
                "sma_50": round(sma_50, 2),
                "sma_200": round(sma_200, 2),
                "w52_high": round(w52_high, 2),
                "w52_low": round(w52_low, 2),
                "pct_from_52h": round(pct_from_52h, 1),
                "pct_from_52l": round(pct_from_52l, 1),
                "gap_pct": round(gap_pct, 2),
                "bb_width": round(bb_width, 2),
                "bb_lower": round(bb_lower, 2),
                "bb_upper": round(bb_upper, 2),
                "macd_hist": round(macd_hist, 2),
                "macd_cross_up": macd_cross_up,
                "golden_cross": golden_cross,
                "death_cross": death_cross,
                "high_20": round(high_20, 2),
                "rs_1m": round(rs_1m, 1),
                "rs_3m": round(rs_3m, 1),
                "minervini_score": minervini_score,
                "wk_change": round(wk_change, 2),
                "above_50dma": price > sma_50,
                "above_supertrend": above_supertrend,
                "pe_ratio": 0, "roe": 0, "dividend_yield": 0,
            })
        except Exception:
            continue

    # ── Fetch fundamentals for fundamental strategies (only when needed) ───
    FUNDAMENTAL_STRATEGIES = {"dividend_yield", "low_pe", "high_roe", "growth_momentum", "safe_haven"}
    if strategy in FUNDAMENTAL_STRATEGIES and stocks:
        batch = stocks[:80]
        for s in batch:
            try:
                fdata = await ds_fundamentals(s["symbol"])
                if fdata:
                    s["pe_ratio"] = sf(fdata.get("pe_trailing") or fdata.get("pe_forward", 0))
                    _roe = sf(fdata.get("roe", 0))
                    s["roe"] = _roe * 100 if _roe and _roe < 1 else (_roe or 0)
                    _dy = sf(fdata.get("dividend_yield", 0))
                    s["dividend_yield"] = _dy * 100 if _dy and _dy < 1 else (_dy or 0)
            except:
                pass

    # ── Strategy Filters ─────────────────────────────────────────────────────
    if strategy == "momentum":
        stocks = sorted([s for s in stocks if s["change_pct"] > 0.3], key=lambda x: x["change_pct"], reverse=True)
    elif strategy == "oversold":
        stocks = sorted([s for s in stocks if s["rsi"] < 35], key=lambda x: x["rsi"])
    elif strategy == "overbought":
        stocks = sorted([s for s in stocks if s["rsi"] > 70], key=lambda x: x["rsi"], reverse=True)
    elif strategy == "volume":
        stocks = sorted([s for s in stocks if s["vol_ratio"] > 1.5], key=lambda x: x["vol_ratio"], reverse=True)
    elif strategy == "breakout":
        stocks = sorted([s for s in stocks if s["change_pct"] > 1.0 and s["vol_ratio"] > 1.3], key=lambda x: x["change_pct"], reverse=True)
    elif strategy == "52w_high":
        stocks = sorted([s for s in stocks if s["pct_from_52h"] >= -5], key=lambda x: x["pct_from_52h"], reverse=True)
    elif strategy == "52w_low":
        stocks = sorted([s for s in stocks if s["pct_from_52l"] <= 15], key=lambda x: x["pct_from_52l"])
    elif strategy == "golden_cross":
        stocks = [s for s in stocks if s["golden_cross"]] or sorted([s for s in stocks if s["above_200dma"] and s["above_50dma"]], key=lambda x: x["rs_1m"], reverse=True)
    elif strategy == "death_cross":
        stocks = [s for s in stocks if s["death_cross"]] or sorted([s for s in stocks if not s["above_200dma"]], key=lambda x: x["change_pct"])
    elif strategy == "gap_up":
        stocks = sorted([s for s in stocks if s["gap_pct"] > 0.5], key=lambda x: x["gap_pct"], reverse=True)
    elif strategy == "gap_down":
        stocks = sorted([s for s in stocks if s["gap_pct"] < -0.5], key=lambda x: x["gap_pct"])
    elif strategy == "up_on_volume":
        stocks = sorted([s for s in stocks if s["change_pct"] > 0.5 and s["vol_ratio"] > 1.3], key=lambda x: x["vol_ratio"], reverse=True)
    elif strategy == "bb_squeeze":
        stocks = sorted([s for s in stocks if s["bb_width"] < 8], key=lambda x: x["bb_width"])
    elif strategy == "macd_crossover":
        stocks = sorted([s for s in stocks if s["macd_cross_up"]], key=lambda x: x["macd_hist"], reverse=True)
        if not stocks:
            stocks = sorted([s for s in stocks if s["macd_hist"] > 0], key=lambda x: x["macd_hist"], reverse=True)
    elif strategy == "minervini":
        stocks = sorted([s for s in stocks if s["minervini_score"] >= 5], key=lambda x: x["minervini_score"], reverse=True)
    elif strategy == "relative_strength":
        stocks = sorted(stocks, key=lambda x: x["rs_3m"], reverse=True)
    elif strategy == "recent_breakout":
        stocks = sorted([s for s in stocks if s["price"] > s["high_20"] and s["vol_ratio"] > 1.2], key=lambda x: x["change_pct"], reverse=True)
    elif strategy == "pullback_buy":
        stocks = sorted([s for s in stocks if s["above_200dma"] and s["rsi"] < 40 and s["rs_3m"] > 0], key=lambda x: x["rsi"])
    elif strategy == "top_losers":
        stocks = sorted([s for s in stocks if s["change_pct"] < -0.5], key=lambda x: x["change_pct"])
    elif strategy == "near_support":
        stocks = sorted([s for s in stocks if sf(s["price"]) <= sf(s["bb_lower"]) * 1.02 and sf(s["bb_lower"]) > 0], key=lambda x: x["rsi"])
    elif strategy == "trend_strong":
        stocks = sorted([s for s in stocks if s["above_200dma"] and s["above_50dma"] and s["rsi"] > 50 and s["rsi"] < 75], key=lambda x: x["rs_3m"], reverse=True)
    elif strategy == "high_beta":
        stocks = sorted([s for s in stocks if abs(s["change_pct"]) > 1.5], key=lambda x: abs(x["change_pct"]), reverse=True)
    elif strategy == "range_breakout":
        stocks = sorted([s for s in stocks if s["bb_width"] > 0 and s["price"] > sf(s.get("bb_upper",0)) * 0.98 and s["vol_ratio"] > 1.2], key=lambda x: x["change_pct"], reverse=True)
    elif strategy == "volume_dry":
        stocks = sorted([s for s in stocks if 0 < s["vol_ratio"] < 0.5 and s["above_200dma"]], key=lambda x: x["vol_ratio"])
    elif strategy == "macd_bearish":
        stocks = sorted([s for s in stocks if s.get("macd_hist",0) < 0 and not s.get("macd_cross_up", False)], key=lambda x: x.get("macd_hist",0))
    elif strategy == "supertrend_buy":
        stocks = sorted([s for s in stocks if s.get("above_supertrend", False) and s["rsi"] > 45], key=lambda x: x["change_pct"], reverse=True)
    elif strategy == "dividend_yield":
        stocks = sorted([s for s in stocks if sf(s.get("dividend_yield",0)) > 1.5], key=lambda x: sf(x.get("dividend_yield",0)), reverse=True)
    elif strategy == "low_pe":
        stocks = sorted([s for s in stocks if 0 < sf(s.get("pe_ratio",0)) < 15], key=lambda x: sf(x.get("pe_ratio",999)))
    elif strategy == "high_roe":
        stocks = sorted([s for s in stocks if sf(s.get("roe",0)) > 15 and s["above_200dma"]], key=lambda x: sf(x.get("roe",0)), reverse=True)
    elif strategy == "growth_momentum":
        stocks = sorted([s for s in stocks if s["above_50dma"] and s["above_200dma"] and s["rs_3m"] > 10 and s["rsi"] > 55], key=lambda x: x["rs_3m"], reverse=True)
    elif strategy == "safe_haven":
        stocks = sorted([s for s in stocks if s["above_200dma"] and s["rsi"] > 40 and s["rsi"] < 65 and sf(s.get("dividend_yield",0)) > 0.5 and abs(s["change_pct"]) < 2], key=lambda x: sf(x.get("dividend_yield",0)), reverse=True)
    elif strategy == "turnaround":
        stocks = sorted([s for s in stocks if s["pct_from_52l"] < 25 and s["vol_ratio"] > 1.5 and s["change_pct"] > 0], key=lambda x: x["vol_ratio"], reverse=True)
    elif strategy == "sector_rotation":
        # Group by sector, find best performer in each
        sector_best = {}
        for s in stocks:
            sec = s.get("sector","Other")
            if sec not in sector_best or s["rs_1m"] > sector_best[sec]["rs_1m"]:
                sector_best[sec] = s
        stocks = sorted(sector_best.values(), key=lambda x: x["rs_1m"], reverse=True)
    elif strategy == "multi_timeframe":
        stocks = sorted([s for s in stocks if s["above_200dma"] and s["above_50dma"] and s["rsi"] > 50 and s["change_pct"] > 0 and s["rs_1m"] > 0 and s["rs_3m"] > 0], key=lambda x: x["rs_3m"] + x["rs_1m"], reverse=True)
    else:
        stocks = sorted(stocks, key=lambda x: x["change_pct"], reverse=True)

    # Add cap_segment to each stock
    for s in stocks:
        if "cap_segment" not in s:
            s["cap_segment"] = get_cap_segment(s["symbol"])
    # Apply cap_segment filter
    if cap_segment:
        cs = cap_segment.lower()
        stocks = [s for s in stocks if get_cap_segment(s["symbol"]) == cs]
    result = {"stocks": stocks[:50], "count": len(stocks), "strategy": strategy, "as_of": end, "universe_size": len(NIFTY_UNIVERSE), "scanned": len(symbols_to_scan)}
    if redis_client:
        await redis_client.setex(cache_key, 900, json.dumps(result))  # 15 min cache for large universe
    return result

# ── Watchlist ─────────────────────────────────────────────────────────────────
@app.get("/api/watchlist", tags=["Watchlist"], summary="Get watchlist",
    description="Get the authenticated user's watchlist with all saved symbols.")
async def get_watchlist(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        wl = await conn.fetchrow("SELECT symbols FROM watchlists WHERE user_id=$1", user["id"])
        return {"symbols": wl["symbols"] if wl else []}

@app.post("/api/watchlist/add/{symbol}", tags=["Watchlist"], summary="Add to watchlist",
    description="Add a stock symbol to the user's watchlist. Maximum 50 symbols per user.")
async def add_to_watchlist(symbol: str, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        # Ensure watchlist row exists
        existing = await conn.fetchrow("SELECT id FROM watchlists WHERE user_id=$1", user["id"])
        if not existing:
            await conn.execute("INSERT INTO watchlists (user_id, symbols) VALUES ($1, $2)", user["id"], [symbol.upper()])
        else:
            await conn.execute("UPDATE watchlists SET symbols=array_append(symbols,$1),updated_at=NOW() WHERE user_id=$2 AND NOT ($1=ANY(symbols))", symbol.upper(), user["id"])
        return {"message": f"{symbol.upper()} added"}

@app.delete("/api/watchlist/remove/{symbol}", tags=["Watchlist"], summary="Remove from watchlist",
    description="Remove a stock symbol from the user's watchlist.")
async def remove_from_watchlist(symbol: str, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE watchlists SET symbols=array_remove(symbols,$1),updated_at=NOW() WHERE user_id=$2", symbol.upper(), user["id"])
        return {"message": f"{symbol.upper()} removed"}

@app.get("/api/watchlist/prices", tags=["Watchlist"], summary="Get watchlist prices",
    description="Get current prices, day change, and percentage change for all stocks in the user's watchlist.")
async def watchlist_prices(user=Depends(get_current_user)):
    """Fetch live prices for all watchlist symbols via data service"""
    from datetime import date, timedelta

    async with db_pool.acquire() as conn:
        wl = await conn.fetchrow("SELECT symbols FROM watchlists WHERE user_id=$1", user["id"])
    symbols = wl["symbols"] if wl and wl["symbols"] else []
    if not symbols:
        return {"prices": [], "as_of": date.today().isoformat()}

    # Check Redis cache (60s TTL for live prices)
    cache_key = f"wl_prices:{','.join(sorted(symbols))}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    try:
        quotes = await ds_bulk_quotes(symbols)
        prices = []
        for q in quotes:
            sym = q.get("symbol", "")
            prices.append({
                "symbol": sym,
                "price": round(q.get("price", 0), 2),
                "change": round(q.get("change", 0), 2),
                "change_pct": round(q.get("change_pct", 0), 2),
            })
        result = {"prices": prices, "as_of": date.today().isoformat()}
        if redis_client:
            cache_key2 = f"wl_prices:{','.join(sorted(symbols))}"
            await redis_client.set(cache_key2, json.dumps(result), ex=60)
        return result
    except Exception as e:
        return {"prices": [], "error": str(e)}

    prices = []  # fallback path
    for sym in symbols:
        try:
            yf_sym = f"{sym}.NS"
            df = yf_extract_ticker(raw, yf_sym, single_mode=single_mode)
            df = df.dropna()

            if len(df) < 1:
                continue

            price = float(df["Close"].iloc[-1])
            prev = float(df["Close"].iloc[-2]) if len(df) >= 2 else price
            change = round(price - prev, 2)
            change_pct = round((price - prev) / prev * 100, 2) if prev > 0 else 0
            high = float(df["High"].iloc[-1])
            low = float(df["Low"].iloc[-1])
            opn = float(df["Open"].iloc[-1])
            vol = int(df["Volume"].iloc[-1])

            def sf(v, d=0):
                try:
                    v=float(v)
                    return d if (np.isnan(v) or np.isinf(v)) else v
                except: return d

            prices.append({
                "symbol": sym,
                "price": round(sf(price), 2),
                "change": round(sf(change), 2),
                "change_pct": round(sf(change_pct), 2),
                "open": round(sf(opn), 2),
                "high": round(sf(high), 2),
                "low": round(sf(low), 2),
                "volume": vol,
                "sector": SECTOR_MAP.get(sym, "Other"), "industry": INDUSTRY_MAP.get(sym, "Other"), "basic_industry": BASIC_INDUSTRY_MAP.get(sym, "Other")
            })
        except Exception:
            continue

    result = {"prices": prices, "as_of": end, "count": len(prices)}
    if redis_client:
        await redis_client.setex(cache_key, 60, json.dumps(result))
    return result

# ── Fundamentals ─────────────────────────────────────────────────────────────
@app.get("/api/stock/fundamentals/{symbol}", tags=["Stock Data"], summary="Get stock fundamentals",
    description="Get fundamental data for a stock — market cap, P/E, P/B, ROE, ROCE, debt-to-equity, dividend yield, revenue, profit margins, promoter holding, 52-week high/low, and more.")
async def stock_fundamentals(symbol: str, user=Depends(get_current_user)):
    """Fetch fundamental data for a stock via data service"""

    cache_key = f"fundamentals:{symbol.upper()}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    try:
        info_raw = await ds_fundamentals(symbol)
        if info_raw and info_raw.get("symbol"):
            info = {
                "longName": info_raw.get("name", symbol.upper()),
                "sector": info_raw.get("sector", ""),
                "industry": info_raw.get("industry", ""),
                "marketCap": info_raw.get("market_cap"),
                "trailingPE": info_raw.get("pe_trailing"),
                "forwardPE": info_raw.get("pe_forward"),
                "priceToBook": info_raw.get("pb"),
                "returnOnEquity": info_raw.get("roe"),
                "returnOnAssets": None,
                "debtToEquity": info_raw.get("debt_equity"),
                "dividendYield": info_raw.get("dividend_yield"),
                "trailingEps": info_raw.get("eps"),
                "revenue": info_raw.get("revenue"),
                "profitMargins": info_raw.get("profit_margin"),
                "operatingMargins": info_raw.get("operating_margin"),
                "revenueGrowth": info_raw.get("revenue_growth"),
                "earningsGrowth": info_raw.get("earnings_growth"),
                "freeCashflow": info_raw.get("free_cashflow"),
                "bookValue": info_raw.get("book_value"),
                "currentPrice": info_raw.get("price"),
                "beta": info_raw.get("beta"),
                "fiftyTwoWeekHigh": info_raw.get("high_52w"),
                "fiftyTwoWeekLow": info_raw.get("low_52w"),
                "averageVolume": info_raw.get("avg_volume"),
                "sharesOutstanding": info_raw.get("shares_outstanding"),
            }
        else:
            import yfinance as yf
            yf_sym = f"{symbol.upper()}.NS"
            loop = asyncio.get_event_loop()
            ticker = yf.Ticker(yf_sym)
            info = await loop.run_in_executor(None, lambda: ticker.info)

        def safe(key, default=None):
            v = info.get(key, default)
            if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
                return default
            return v

        data = {
            "symbol": symbol.upper(),
            "name": safe("longName", symbol.upper()),
            "sector": safe("sector", SECTOR_MAP.get(symbol.upper(), "—")),
            "industry": safe("industry", "—"),
            "market_cap": safe("marketCap"),
            "pe_ratio": round(safe("trailingPE", 0), 2) if safe("trailingPE") else None,
            "forward_pe": round(safe("forwardPE", 0), 2) if safe("forwardPE") else None,
            "pb_ratio": round(safe("priceToBook", 0), 2) if safe("priceToBook") else None,
            "roe": round(safe("returnOnEquity", 0) * 100, 2) if safe("returnOnEquity") else None,
            "roa": round(safe("returnOnAssets", 0) * 100, 2) if safe("returnOnAssets") else None,
            "debt_to_equity": round(safe("debtToEquity", 0), 2) if safe("debtToEquity") else None,
            "dividend_yield": round(safe("dividendYield", 0) * 100, 2) if safe("dividendYield") else None,
            "eps": safe("trailingEps"),
            "revenue": safe("totalRevenue"),
            "profit_margin": round(safe("profitMargins", 0) * 100, 2) if safe("profitMargins") else None,
            "beta": round(safe("beta", 0), 2) if safe("beta") else None,
            "fifty_two_week_high": safe("fiftyTwoWeekHigh"),
            "fifty_two_week_low": safe("fiftyTwoWeekLow"),
            "avg_volume": safe("averageVolume"),
            "book_value": safe("bookValue"),
            "current_price": safe("currentPrice") or safe("regularMarketPrice"),
        }

        result = {"fundamentals": data}
        if redis_client:
            await redis_client.setex(cache_key, 600, json.dumps(result))
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fundamentals fetch error: {str(e)}")


# ══════════════════════════════════════════════════════════════════════════════
# SYMBOL SEARCH — ANY NSE / BSE STOCK
# ══════════════════════════════════════════════════════════════════════════════

# Extended universe — top BSE stocks not already in NIFTY_UNIVERSE
BSE_EXTRA = [
    "ADANIPOWER","SUZLON","IREDA","JIOPEP","ZOMATO","IDEA","YESBANK","TATAMTRDVR",
    "RPOWER","TRIDENT","NHPC","IRFC","RVNL","HUDCO","PFC","RECLTD","SJVN",
    "HFCL","GMRAIRPORT","NLCINDIA","NBCC","NCC","IRB","COCHINSHIP","GRSE","BDL",
    "MAZDOCK","RAILTEL","RITES","IRCON","EIHOTEL","CESC","GSFC","GMDCLTD","GPIL",
    "TANLA","BBTC","CCL","CENTURYPLY","DCBBANK","GESHIP","GHCL","GPPL","GRINDWELL",
    "GSPL","GUJALKALI","GUJGASLTD","IIFLWAM","INDIAGLYCO","JKLAKSHMI","JSWHL",
    "KANSAINER","KSCL","LXCHEM","MAHLIFE","MAHLOG","MAXHEALTH","METROPOLIS",
    "MMTC","MOIL","MOTILALOFS","MRPL","NESCO","NFL","NIITLTD","OIL","PCBL",
    "PHOENIXLTD","RAJESHEXPO","RATNAMANI","SANOFI","SCI","SHYAMMETL","SIS",
    "SJVN","SKFINDIA","SOBHA","SOLARINDS","SPARC","STLTECH","SUDARSCHEM",
    "SUMICHEM","SUNDRMFAST","SUPREMEIND","SYNGENE","TATACHEM","TATACOMM",
    "TATAINVEST","THERMAX","TIMKEN","TORNTPOWER","TRITURBINE","TVSSRICHAK",
    "UCOBANK","UJJIVANSFB","UPL","VSTIND","WELCORP","WELSPUNLIV","ZEEL",
    "HINDWAREAP","DREAMFOLKS","HERITGFOOD","MAHSCOOTER","CAMPUS","CERA",
]

ALL_SYMBOLS = list(set(NIFTY_UNIVERSE + BSE_EXTRA))
ALL_SYMBOLS.sort()


@app.get("/api/symbols/search", tags=["Stock Data"], summary="Search symbols",
    description="Search for stock symbols by name or ticker. Returns matching symbols with company name, sector, and industry.")
async def search_symbols(q: str = "", exchange: str = "NSE", user=Depends(get_current_user)):
    """Search for stocks across NSE/BSE. Returns matching symbols."""
    query = q.upper().strip()
    if not query or len(query) < 1:
        return {"results": [], "query": q}

    # Search in our universe first
    matches = []
    for sym in ALL_SYMBOLS:
        if query in sym:
            matches.append({
                "symbol": sym, "exchange": "NSE",
                "sector": SECTOR_MAP.get(sym, "Other"), "industry": INDUSTRY_MAP.get(sym, "Other"), "basic_industry": BASIC_INDUSTRY_MAP.get(sym, "Other"),
                "in_universe": sym in NIFTY_UNIVERSE,
            })
    matches.sort(key=lambda x: (0 if x["symbol"].startswith(query) else 1, x["symbol"]))

    # If few matches, try yfinance search for broader results
    if len(matches) < 5:
        import yfinance as yf
        loop = asyncio.get_event_loop()
        try:
            suffix = ".NS" if exchange.upper() == "NSE" else ".BO"
            # Try exact match
            test_sym = f"{query}{suffix}"
            ticker = await loop.run_in_executor(None, lambda: yf.Ticker(test_sym))
            info = await loop.run_in_executor(None, lambda: ticker.info)
            if info and info.get("regularMarketPrice"):
                existing = any(m["symbol"] == query for m in matches)
                if not existing:
                    matches.insert(0, {
                        "symbol": query, "exchange": exchange.upper(),
                        "name": info.get("shortName", ""),
                        "sector": info.get("sector", "Other"),
                        "price": info.get("regularMarketPrice", 0),
                        "in_universe": query in NIFTY_UNIVERSE,
                    })
        except:
            pass

    return {"results": matches[:20], "query": q, "total": len(matches)}


@app.get("/api/symbols/all", tags=["Stock Data"], summary="Get all symbols",
    description="Returns the complete list of 843 NSE symbols in the AlphaLab universe with sector, industry, and basic industry classification.")
async def all_symbols(user=Depends(get_current_user)):
    """Return full symbol list with sector info for autocomplete."""
    sym_list = [{"s": s, "sec": SECTOR_MAP.get(s, ""), "ind": INDUSTRY_MAP.get(s, "")} for s in ALL_SYMBOLS]
    sym_list.sort(key=lambda x: x["s"])
    return {"symbols": [x["s"] for x in sym_list], "detail": sym_list, "count": len(ALL_SYMBOLS), "nifty_count": len(NIFTY_UNIVERSE)}


# ══════════════════════════════════════════════════════════════════════════════
# OPTIONS TRADING ENGINE
# ══════════════════════════════════════════════════════════════════════════════

import math
from scipy.stats import norm

def black_scholes(S, K, T, r, sigma, option_type="call"):
    """Black-Scholes option pricing."""
    if T <= 0 or sigma <= 0:
        intrinsic = max(S - K, 0) if option_type == "call" else max(K - S, 0)
        return {"price": intrinsic, "delta": 1 if option_type == "call" and S > K else 0,
                "gamma": 0, "theta": 0, "vega": 0, "rho": 0}

    d1 = (math.log(S / K) + (r + sigma**2 / 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)

    if option_type == "call":
        price = S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
        delta = norm.cdf(d1)
    else:
        price = K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
        delta = norm.cdf(d1) - 1

    gamma = norm.pdf(d1) / (S * sigma * math.sqrt(T))
    theta = (-S * norm.pdf(d1) * sigma / (2 * math.sqrt(T))
             - r * K * math.exp(-r * T) * norm.cdf(d2 if option_type == "call" else -d2)
             * (1 if option_type == "call" else -1)) / 365
    vega = S * norm.pdf(d1) * math.sqrt(T) / 100
    rho = (K * T * math.exp(-r * T) * norm.cdf(d2 if option_type == "call" else -d2)
           * (1 if option_type == "call" else -1)) / 100

    return {
        "price": round(price, 2), "delta": round(delta, 4), "gamma": round(gamma, 6),
        "theta": round(theta, 2), "vega": round(vega, 2), "rho": round(rho, 2),
    }


def implied_volatility(market_price, S, K, T, r, option_type="call", tol=1e-5, max_iter=100):
    """Newton-Raphson implied volatility calculation."""
    sigma = 0.3  # initial guess
    for _ in range(max_iter):
        bs = black_scholes(S, K, T, r, sigma, option_type)
        diff = bs["price"] - market_price
        if abs(diff) < tol:
            return round(sigma * 100, 2)  # return as percentage
        vega = bs["vega"] * 100  # un-scale
        if abs(vega) < 1e-10:
            break
        sigma -= diff / vega
        sigma = max(0.01, min(sigma, 5.0))
    return round(sigma * 100, 2)


OPTIONS_STRATEGIES = {
    # ═══════════════════════════════════════════════════════════════════════════
    # BULLISH STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "long_call": {
        "name": "Long Call", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}],
        "description": "Bullish — buy a call option. Unlimited profit, limited loss to premium paid.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "low", "expiry": "any"}
    },
    "long_itm_call": {
        "name": "Long ITM Call", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": -2}],
        "description": "Deep bullish — buy an ITM call for high delta exposure with less time decay risk.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,gamma+,theta-", "vol_view": "neutral", "complexity": "low", "expiry": "any"}
    },
    "long_otm_call": {
        "name": "Long OTM Call", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 3}],
        "description": "Aggressive bullish — cheap OTM call with high leverage but low probability.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,vega+,theta-", "vol_view": "expansion", "complexity": "low", "expiry": "weekly"}
    },
    "bull_call_spread": {
        "name": "Bull Call Spread", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2}],
        "description": "Moderately bullish — buy lower strike call, sell higher. Limited risk and reward.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta~,vega~", "vol_view": "neutral", "complexity": "low", "expiry": "any"}
    },
    "bull_put_spread": {
        "name": "Bull Put Spread", "category": "bullish",
        "legs": [{"type": "put", "side": "sell", "strike_offset": 0}, {"type": "put", "side": "buy", "strike_offset": -2}],
        "description": "Moderately bullish credit spread — collect premium, profit if price stays above short put.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta+,vega-", "vol_view": "contraction", "complexity": "low", "expiry": "any"}
    },
    "itm_call_spread": {
        "name": "ITM Call Spread", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": -2}, {"type": "call", "side": "sell", "strike_offset": 0}],
        "description": "Conservative bullish — higher cost but higher probability of profit.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta~", "vol_view": "neutral", "complexity": "low", "expiry": "monthly"}
    },
    "covered_call": {
        "name": "Covered Call", "category": "bullish",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "call", "side": "sell", "strike_offset": 1}],
        "description": "Mild bullish — hold stock + sell OTM call for income. Caps upside.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,theta+", "vol_view": "contraction", "complexity": "low", "expiry": "monthly"}
    },
    "cash_secured_put": {
        "name": "Cash Secured Put", "category": "bullish",
        "legs": [{"type": "put", "side": "sell", "strike_offset": -1}],
        "description": "Bullish income — sell OTM put with cash reserve. Profit from premium if stock stays above strike.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "naked", "greeks": "delta+,theta+,vega-", "vol_view": "contraction", "complexity": "low", "expiry": "monthly"}
    },
    "synthetic_long": {
        "name": "Synthetic Long", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": 0}],
        "description": "Synthetic stock position — same P&L as owning stock but with less capital.",
        "tags": {"bias": "bullish", "risk": "unlimited", "margin": "naked", "greeks": "delta+,gamma+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },
    "risk_reversal_bullish": {
        "name": "Risk Reversal (Bullish)", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 2}, {"type": "put", "side": "sell", "strike_offset": -2}],
        "description": "Bullish risk reversal — buy OTM call funded by selling OTM put. Near zero-cost bullish bet.",
        "tags": {"bias": "bullish", "risk": "unlimited", "margin": "naked", "greeks": "delta+,vega+", "vol_view": "expansion", "complexity": "medium", "expiry": "monthly"}
    },
    "call_ratio_spread": {
        "name": "Call Ratio Spread (1x2)", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2, "qty_mult": 2}],
        "description": "Bullish with cap — buy 1 ATM call, sell 2 OTM calls. Profits in moderate rise, risk if sharp rally.",
        "tags": {"bias": "bullish", "risk": "unlimited", "margin": "naked", "greeks": "delta+,theta+,vega-", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "call_backspread": {
        "name": "Call Backspread", "category": "bullish",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 0}, {"type": "call", "side": "buy", "strike_offset": 2, "qty_mult": 2}],
        "description": "Volatile bullish — sell 1 ATM call, buy 2 OTM calls. Big profit on sharp rally.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,gamma+,vega+", "vol_view": "expansion", "complexity": "high", "expiry": "event"}
    },
    "bull_call_ladder": {
        "name": "Bull Call Ladder", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2}, {"type": "call", "side": "sell", "strike_offset": 4}],
        "description": "Moderate bullish — buy 1 call, sell 2 higher calls at different strikes. Risk above top strike.",
        "tags": {"bias": "bullish", "risk": "unlimited", "margin": "naked", "greeks": "delta+,theta+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # BEARISH STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "long_put": {
        "name": "Long Put", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 0}],
        "description": "Bearish — buy a put option. Profit from price decline, loss limited to premium.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "hedged", "greeks": "delta-,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "low", "expiry": "any"}
    },
    "long_itm_put": {
        "name": "Long ITM Put", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 2}],
        "description": "Deep bearish — buy ITM put for high delta, acts almost like short stock.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "hedged", "greeks": "delta-,gamma+", "vol_view": "neutral", "complexity": "low", "expiry": "any"}
    },
    "bear_put_spread": {
        "name": "Bear Put Spread", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": -2}],
        "description": "Moderately bearish — buy higher put, sell lower. Limited risk/reward.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,theta~,vega~", "vol_view": "neutral", "complexity": "low", "expiry": "any"}
    },
    "bear_call_spread": {
        "name": "Bear Call Spread", "category": "bearish",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 0}, {"type": "call", "side": "buy", "strike_offset": 2}],
        "description": "Moderately bearish credit spread — collect premium, profit if price stays below short call.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,theta+,vega-", "vol_view": "contraction", "complexity": "low", "expiry": "any"}
    },
    "itm_put_spread": {
        "name": "ITM Put Spread", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 2}, {"type": "put", "side": "sell", "strike_offset": 0}],
        "description": "Conservative bearish — higher cost but higher probability of profit on decline.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,theta~", "vol_view": "neutral", "complexity": "low", "expiry": "monthly"}
    },
    "synthetic_short": {
        "name": "Synthetic Short", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 0}],
        "description": "Synthetic short stock — same P&L as shorting stock with options.",
        "tags": {"bias": "bearish", "risk": "unlimited", "margin": "naked", "greeks": "delta-,gamma+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },
    "risk_reversal_bearish": {
        "name": "Risk Reversal (Bearish)", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": -2}, {"type": "call", "side": "sell", "strike_offset": 2}],
        "description": "Bearish risk reversal — buy OTM put funded by selling OTM call.",
        "tags": {"bias": "bearish", "risk": "unlimited", "margin": "naked", "greeks": "delta-,vega+", "vol_view": "expansion", "complexity": "medium", "expiry": "monthly"}
    },
    "put_ratio_spread": {
        "name": "Put Ratio Spread (1x2)", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": -2, "qty_mult": 2}],
        "description": "Bearish with cap — buy 1 ATM put, sell 2 OTM puts. Profits on moderate decline.",
        "tags": {"bias": "bearish", "risk": "unlimited", "margin": "naked", "greeks": "delta-,theta+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "put_backspread": {
        "name": "Put Backspread", "category": "bearish",
        "legs": [{"type": "put", "side": "sell", "strike_offset": 0}, {"type": "put", "side": "buy", "strike_offset": -2, "qty_mult": 2}],
        "description": "Volatile bearish — sell 1 ATM put, buy 2 OTM puts. Big profit on crash.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,gamma+,vega+", "vol_view": "expansion", "complexity": "high", "expiry": "event"}
    },
    "bear_put_ladder": {
        "name": "Bear Put Ladder", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": -2}, {"type": "put", "side": "sell", "strike_offset": -4}],
        "description": "Moderate bearish — buy 1 put, sell 2 lower puts. Risk below lowest strike.",
        "tags": {"bias": "bearish", "risk": "unlimited", "margin": "naked", "greeks": "delta-,theta+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # NEUTRAL / RANGE-BOUND STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "short_straddle": {
        "name": "Short Straddle", "category": "neutral",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": 0}],
        "description": "Neutral premium selling — sell ATM call + put. Max profit at strike, unlimited risk.",
        "tags": {"bias": "neutral", "risk": "unlimited", "margin": "naked", "greeks": "delta~,theta+,vega-,gamma-", "vol_view": "contraction", "complexity": "medium", "expiry": "weekly"}
    },
    "short_strangle": {
        "name": "Short Strangle", "category": "neutral",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 2}, {"type": "put", "side": "sell", "strike_offset": -2}],
        "description": "Neutral — sell OTM call + put. Wider profit zone than straddle, unlimited risk.",
        "tags": {"bias": "neutral", "risk": "unlimited", "margin": "naked", "greeks": "delta~,theta+,vega-,gamma-", "vol_view": "contraction", "complexity": "medium", "expiry": "weekly"}
    },
    "iron_condor": {
        "name": "Iron Condor", "category": "neutral",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -3}, {"type": "put", "side": "sell", "strike_offset": -1},
            {"type": "call", "side": "sell", "strike_offset": 1}, {"type": "call", "side": "buy", "strike_offset": 3}
        ],
        "description": "Neutral — profit if price stays in range. Limited risk on both sides.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega-,gamma-", "vol_view": "contraction", "complexity": "medium", "expiry": "any"}
    },
    "iron_butterfly": {
        "name": "Iron Butterfly", "category": "neutral",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -2}, {"type": "put", "side": "sell", "strike_offset": 0},
            {"type": "call", "side": "sell", "strike_offset": 0}, {"type": "call", "side": "buy", "strike_offset": 2}
        ],
        "description": "Neutral — tighter range than iron condor. Higher premium collected, ATM short.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega-,gamma-", "vol_view": "contraction", "complexity": "medium", "expiry": "weekly"}
    },
    "butterfly_spread": {
        "name": "Butterfly Spread", "category": "neutral",
        "legs": [
            {"type": "call", "side": "buy", "strike_offset": -2}, {"type": "call", "side": "sell", "strike_offset": 0, "qty_mult": 2},
            {"type": "call", "side": "buy", "strike_offset": 2}
        ],
        "description": "Neutral — max profit if price pins at middle strike at expiry. Very cheap to enter.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,gamma-", "vol_view": "contraction", "complexity": "medium", "expiry": "weekly"}
    },
    "broken_wing_butterfly": {
        "name": "Broken Wing Butterfly", "category": "neutral",
        "legs": [
            {"type": "call", "side": "buy", "strike_offset": -1}, {"type": "call", "side": "sell", "strike_offset": 0, "qty_mult": 2},
            {"type": "call", "side": "buy", "strike_offset": 3}
        ],
        "description": "Neutral with directional skew — asymmetric butterfly with zero risk on one side.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "broken_wing_iron_condor": {
        "name": "Broken Wing Iron Condor", "category": "neutral",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -4}, {"type": "put", "side": "sell", "strike_offset": -1},
            {"type": "call", "side": "sell", "strike_offset": 1}, {"type": "call", "side": "buy", "strike_offset": 2}
        ],
        "description": "Skewed iron condor — uneven wings to take credit and directional bias.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega-", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "covered_strangle": {
        "name": "Covered Strangle", "category": "neutral",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "call", "side": "sell", "strike_offset": 2}, {"type": "put", "side": "sell", "strike_offset": -2}],
        "description": "Hold stock + sell OTM call and OTM put. Enhanced income, large margin requirement.",
        "tags": {"bias": "neutral", "risk": "unlimited", "margin": "naked", "greeks": "delta+,theta+", "vol_view": "contraction", "complexity": "medium", "expiry": "monthly"}
    },
    "christmas_tree": {
        "name": "Christmas Tree Spread", "category": "neutral",
        "legs": [
            {"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2},
            {"type": "call", "side": "sell", "strike_offset": 3}
        ],
        "description": "Neutral-to-bullish — like a ladder, profits in moderate move, risk beyond top strike.",
        "tags": {"bias": "neutral", "risk": "unlimited", "margin": "naked", "greeks": "delta+,theta+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # VOLATILITY EXPANSION STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "long_straddle": {
        "name": "Long Straddle", "category": "volatility",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "buy", "strike_offset": 0}],
        "description": "Expecting big move in either direction — buy ATM call + put.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "low", "expiry": "event"}
    },
    "long_strangle": {
        "name": "Long Strangle", "category": "volatility",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 2}, {"type": "put", "side": "buy", "strike_offset": -2}],
        "description": "Expecting big move — buy OTM call + OTM put. Cheaper than straddle, needs bigger move.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "low", "expiry": "event"}
    },
    "strip": {
        "name": "Strip", "category": "volatility",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "buy", "strike_offset": 0, "qty_mult": 2}],
        "description": "Bearish volatile — 1 call + 2 puts at same strike. Extra profit on downside.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "hedged", "greeks": "delta-,gamma+,vega+", "vol_view": "expansion", "complexity": "medium", "expiry": "event"}
    },
    "strap": {
        "name": "Strap", "category": "volatility",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0, "qty_mult": 2}, {"type": "put", "side": "buy", "strike_offset": 0}],
        "description": "Bullish volatile — 2 calls + 1 put at same strike. Extra profit on upside.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,gamma+,vega+", "vol_view": "expansion", "complexity": "medium", "expiry": "event"}
    },
    "long_guts": {
        "name": "Long Guts", "category": "volatility",
        "legs": [{"type": "call", "side": "buy", "strike_offset": -1}, {"type": "put", "side": "buy", "strike_offset": 1}],
        "description": "Volatile — buy ITM call + ITM put. Higher cost but profit zone starts immediately.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "medium", "expiry": "event"}
    },
    "reverse_iron_condor": {
        "name": "Reverse Iron Condor", "category": "volatility",
        "legs": [
            {"type": "put", "side": "sell", "strike_offset": -3}, {"type": "put", "side": "buy", "strike_offset": -1},
            {"type": "call", "side": "buy", "strike_offset": 1}, {"type": "call", "side": "sell", "strike_offset": 3}
        ],
        "description": "Breakout play — debit position that profits from big move in either direction.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "medium", "expiry": "event"}
    },
    "reverse_iron_butterfly": {
        "name": "Reverse Iron Butterfly", "category": "volatility",
        "legs": [
            {"type": "put", "side": "sell", "strike_offset": -2}, {"type": "put", "side": "buy", "strike_offset": 0},
            {"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2}
        ],
        "description": "Breakout from pin — profits from big move away from ATM, capped by sold wings.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,gamma+,vega+", "vol_view": "expansion", "complexity": "medium", "expiry": "event"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # TIME-BASED / CALENDAR STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "calendar_spread": {
        "name": "Call Calendar Spread", "category": "time_based",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 0, "expiry": "near"}, {"type": "call", "side": "buy", "strike_offset": 0, "expiry": "far"}],
        "description": "Time decay play — sell near-month call, buy same-strike far-month call.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega+", "vol_view": "contraction", "complexity": "medium", "expiry": "monthly"}
    },
    "put_calendar": {
        "name": "Put Calendar Spread", "category": "time_based",
        "legs": [{"type": "put", "side": "sell", "strike_offset": 0, "expiry": "near"}, {"type": "put", "side": "buy", "strike_offset": 0, "expiry": "far"}],
        "description": "Time decay with bearish lean — sell near put, buy far put at same strike.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega+", "vol_view": "contraction", "complexity": "medium", "expiry": "monthly"}
    },
    "double_calendar": {
        "name": "Double Calendar", "category": "time_based",
        "legs": [
            {"type": "put", "side": "sell", "strike_offset": -2, "expiry": "near"}, {"type": "put", "side": "buy", "strike_offset": -2, "expiry": "far"},
            {"type": "call", "side": "sell", "strike_offset": 2, "expiry": "near"}, {"type": "call", "side": "buy", "strike_offset": 2, "expiry": "far"}
        ],
        "description": "Neutral time decay — two calendar spreads at different strikes for wider profit zone.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "diagonal_call_spread": {
        "name": "Diagonal Call Spread", "category": "time_based",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 2, "expiry": "near"}, {"type": "call", "side": "buy", "strike_offset": 0, "expiry": "far"}],
        "description": "Bullish calendar — sell near OTM call, buy far ATM call. Time + directional play.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta+,vega+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },
    "diagonal_put_spread": {
        "name": "Diagonal Put Spread", "category": "time_based",
        "legs": [{"type": "put", "side": "sell", "strike_offset": -2, "expiry": "near"}, {"type": "put", "side": "buy", "strike_offset": 0, "expiry": "far"}],
        "description": "Bearish calendar — sell near OTM put, buy far ATM put.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,theta+,vega+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },
    "pmcc": {
        "name": "Poor Man's Covered Call", "category": "time_based",
        "legs": [{"type": "call", "side": "buy", "strike_offset": -3, "expiry": "far"}, {"type": "call", "side": "sell", "strike_offset": 1, "expiry": "near"}],
        "description": "Budget covered call — buy deep ITM LEAP call, sell near OTM call against it.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },
    "pmcp": {
        "name": "Poor Man's Covered Put", "category": "time_based",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 3, "expiry": "far"}, {"type": "put", "side": "sell", "strike_offset": -1, "expiry": "near"}],
        "description": "Budget covered put — buy deep ITM LEAP put, sell near OTM put against it.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,theta+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # HEDGING & PROTECTION STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "protective_put": {
        "name": "Protective Put", "category": "hedging",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "put", "side": "buy", "strike_offset": -1}],
        "description": "Hold stock + buy OTM put for downside protection. Insurance strategy.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,gamma+,vega+", "vol_view": "expansion", "complexity": "low", "expiry": "monthly"}
    },
    "collar": {
        "name": "Collar", "category": "hedging",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "put", "side": "buy", "strike_offset": -2}, {"type": "call", "side": "sell", "strike_offset": 2}],
        "description": "Hold stock + buy put + sell call. Zero-cost protection that caps upside.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta+", "vol_view": "neutral", "complexity": "low", "expiry": "monthly"}
    },
    "zero_cost_collar": {
        "name": "Zero Cost Collar", "category": "hedging",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "put", "side": "buy", "strike_offset": -1}, {"type": "call", "side": "sell", "strike_offset": 1}],
        "description": "Collar where put cost is exactly offset by call premium. True zero-cost hedge.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta+", "vol_view": "neutral", "complexity": "low", "expiry": "monthly"}
    },
    "tail_hedge": {
        "name": "Tail Hedge (Far OTM Put)", "category": "hedging",
        "legs": [{"type": "put", "side": "buy", "strike_offset": -5}],
        "description": "Crash protection — buy far OTM put cheaply for black swan events.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~,vega+", "vol_view": "expansion", "complexity": "low", "expiry": "monthly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # EXPIRY-SPECIFIC / 0DTE STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "expiry_straddle": {
        "name": "Expiry Day Short Straddle", "category": "expiry",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": 0}],
        "description": "Sell ATM straddle on expiry day — extreme theta decay, gamma risk. For experienced traders.",
        "tags": {"bias": "neutral", "risk": "unlimited", "margin": "naked", "greeks": "delta~,theta++,gamma-", "vol_view": "contraction", "complexity": "high", "expiry": "weekly"}
    },
    "intraday_iron_fly": {
        "name": "Intraday Iron Fly (0DTE)", "category": "expiry",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -1}, {"type": "put", "side": "sell", "strike_offset": 0},
            {"type": "call", "side": "sell", "strike_offset": 0}, {"type": "call", "side": "buy", "strike_offset": 1}
        ],
        "description": "Same-day iron butterfly — tight strikes for max theta extraction.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta++,gamma-", "vol_view": "contraction", "complexity": "high", "expiry": "weekly"}
    },
    "narrow_iron_condor_0dte": {
        "name": "Narrow Iron Condor (0DTE)", "category": "expiry",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -2}, {"type": "put", "side": "sell", "strike_offset": -1},
            {"type": "call", "side": "sell", "strike_offset": 1}, {"type": "call", "side": "buy", "strike_offset": 2}
        ],
        "description": "Tight iron condor for expiry day — narrow strikes, fast decay.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta++,gamma-", "vol_view": "contraction", "complexity": "high", "expiry": "weekly"}
    },
    "pin_risk_butterfly": {
        "name": "Pin Risk Butterfly", "category": "expiry",
        "legs": [
            {"type": "call", "side": "buy", "strike_offset": -1}, {"type": "call", "side": "sell", "strike_offset": 0, "qty_mult": 2},
            {"type": "call", "side": "buy", "strike_offset": 1}
        ],
        "description": "Expiry pin play — butterfly centered at max pain strike expecting price to pin.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,gamma-", "vol_view": "contraction", "complexity": "high", "expiry": "weekly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # ADVANCED / INSTITUTIONAL STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "box_spread": {
        "name": "Box Spread", "category": "advanced",
        "legs": [
            {"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2},
            {"type": "put", "side": "buy", "strike_offset": 2}, {"type": "put", "side": "sell", "strike_offset": 0}
        ],
        "description": "Arbitrage — bull call spread + bear put spread. Riskless profit if mispriced.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~", "vol_view": "neutral", "complexity": "high", "expiry": "monthly"}
    },
    "conversion": {
        "name": "Conversion", "category": "advanced",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "call", "side": "sell", "strike_offset": 0}, {"type": "put", "side": "buy", "strike_offset": 0}],
        "description": "Arbitrage — long stock + synthetic short. Locks in riskless profit if mispriced.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~", "vol_view": "neutral", "complexity": "high", "expiry": "monthly"}
    },
    "reversal": {
        "name": "Reversal", "category": "advanced",
        "legs": [{"type": "stock", "side": "sell"}, {"type": "call", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": 0}],
        "description": "Arbitrage — short stock + synthetic long. Opposite of conversion.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~", "vol_view": "neutral", "complexity": "high", "expiry": "monthly"}
    },
    "jade_lizard": {
        "name": "Jade Lizard", "category": "advanced",
        "legs": [
            {"type": "put", "side": "sell", "strike_offset": -2},
            {"type": "call", "side": "sell", "strike_offset": 1}, {"type": "call", "side": "buy", "strike_offset": 3}
        ],
        "description": "Neutral-bullish — short put + bear call spread. No risk on upside if structured right.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta+,vega-", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "double_diagonal": {
        "name": "Double Diagonal", "category": "advanced",
        "legs": [
            {"type": "put", "side": "sell", "strike_offset": -2, "expiry": "near"}, {"type": "put", "side": "buy", "strike_offset": -1, "expiry": "far"},
            {"type": "call", "side": "sell", "strike_offset": 2, "expiry": "near"}, {"type": "call", "side": "buy", "strike_offset": 1, "expiry": "far"}
        ],
        "description": "Two diagonal spreads — combines time decay + directional play in both directions.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega+", "vol_view": "neutral", "complexity": "high", "expiry": "monthly"}
    },
    "broken_wing_iron_fly": {
        "name": "Broken Wing Iron Fly", "category": "advanced",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -3}, {"type": "put", "side": "sell", "strike_offset": 0},
            {"type": "call", "side": "sell", "strike_offset": 0}, {"type": "call", "side": "buy", "strike_offset": 2}
        ],
        "description": "Skewed iron butterfly — asymmetric wings, zero risk on one side, extra credit.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega-", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
}

# Strategy category metadata
STRATEGY_CATEGORIES = {
    "bullish": {"icon": "📈", "color": "#00d4aa", "label": "Bullish"},
    "bearish": {"icon": "📉", "color": "#ff5252", "label": "Bearish"},
    "neutral": {"icon": "↔️", "color": "#ffab40", "label": "Neutral / Range-Bound"},
    "volatility": {"icon": "⚡", "color": "#7c4dff", "label": "Volatility"},
    "time_based": {"icon": "⏳", "color": "#40c4ff", "label": "Time-Based / Calendar"},
    "hedging": {"icon": "🛡️", "color": "#69f0ae", "label": "Hedging & Protection"},
    "expiry": {"icon": "🎯", "color": "#ff6e40", "label": "Expiry Day / 0DTE"},
    "advanced": {"icon": "🏛️", "color": "#b388ff", "label": "Advanced / Institutional"},
}


@app.get("/api/options/chain/{symbol}", tags=["Options Lab"], summary="Get options chain",
    description="Fetch the options chain for a stock or index. Returns all available strikes with call/put prices, OI, volume, IV, and Greeks (Delta, Gamma, Theta, Vega). Supports NIFTY, BANKNIFTY, FINNIFTY, and all F&O stocks. Falls back to Black-Scholes synthetic pricing when live data is unavailable.")
async def options_chain(symbol: str, expiry: str = "", user=Depends(get_current_user)):
    """Fetch options chain — tries Groww API first, falls back to Black-Scholes synthetic."""
    import yfinance as yf  # kept: Black-Scholes fallback needs index hist vol
    from datetime import datetime, timedelta, date
    import random, calendar, urllib.request, urllib.error

    sym_upper = symbol.upper()
    cache_key = f"options_chain:{sym_upper}:{expiry}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    INDEX_MAP = {"NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK", "FINNIFTY": "^CNXFIN",
                 "MIDCPNIFTY": "^NSEI", "SENSEX": "^BSESN"}
    LOT_SIZES = {"NIFTY": 25, "BANKNIFTY": 15, "FINNIFTY": 25, "RELIANCE": 250,
                 "TCS": 150, "INFY": 300, "HDFCBANK": 550, "ICICIBANK": 700,
                 "SBIN": 750, "TATAMOTORS": 575, "ITC": 1600, "BAJFINANCE": 125,
                 "MARUTI": 100, "WIPRO": 1500, "SUNPHARMA": 700, "TATASTEEL": 550,
                 "LT": 150, "AXISBANK": 600, "BHARTIARTL": 475, "M&M": 350,
                 "ADANIENT": 400, "HCLTECH": 350, "KOTAKBANK": 400, "TITAN": 375,
                 "HINDALCO": 1400, "JSWSTEEL": 675, "CIPLA": 650, "DRREDDY": 125,
                 "ONGC": 3250, "NTPC": 2250, "POWERGRID": 2700, "COALINDIA": 2100}
    is_index = sym_upper in INDEX_MAP
    lot_size = LOT_SIZES.get(sym_upper, 50)
    today = date.today()

    # ── Generate expiry dates ────────────────────────────────────────────────
    def get_expiry_dates():
        expiries = []
        days_to_thu = (3 - today.weekday()) % 7
        if days_to_thu == 0:
            days_to_thu = 7
        nxt = today + timedelta(days=days_to_thu)
        if is_index:
            for _ in range(6):
                expiries.append(nxt.isoformat())
                nxt += timedelta(days=7)
        else:
            for i in range(5):
                month = today.month + i
                year = today.year + (month - 1) // 12
                month = ((month - 1) % 12) + 1
                last_day = calendar.monthrange(year, month)[1]
                ld = date(year, month, last_day)
                while ld.weekday() != 3:
                    ld -= timedelta(days=1)
                if ld > today:
                    expiries.append(ld.isoformat())
        return expiries or [(today + timedelta(days=7*i+7)).isoformat() for i in range(4)]

    expiry_dates = get_expiry_dates()

    # ── Try Groww API first ──────────────────────────────────────────────────
    groww_token = await get_groww_token()
    groww_success = False
    chains = []
    spot_price = 0
    data_source = "synthetic"

    if groww_token:
        try:
            loop = asyncio.get_event_loop()

            # Get spot price from Groww LTP
            async def groww_get(url):
                req_obj = urllib.request.Request(url, headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {groww_token}",
                    "X-API-VERSION": "1.0"
                })
                return await loop.run_in_executor(None, lambda: urllib.request.urlopen(req_obj, timeout=10).read().decode())

            # Spot price via Groww LTP
            ltp_segment = "CASH"
            ltp_sym = f"NSE_{sym_upper}"
            try:
                ltp_resp = json.loads(await groww_get(
                    f"https://api.groww.in/v1/live-data/ltp?segment={ltp_segment}&exchange_symbols={ltp_sym}"
                ))
                if ltp_resp.get("status") == "SUCCESS" and ltp_resp.get("payload", {}).get(ltp_sym):
                    spot_price = float(ltp_resp["payload"][ltp_sym])
            except:
                pass

            # Fetch chain for each expiry from Groww
            target_expiries = [expiry] if expiry else expiry_dates[:4]
            for exp_str in target_expiries:
                try:
                    chain_url = f"https://api.groww.in/v1/option-chain/exchange/NSE/underlying/{sym_upper}?expiry_date={exp_str}"
                    chain_resp = json.loads(await groww_get(chain_url))

                    if chain_resp.get("status") != "SUCCESS":
                        continue

                    payload = chain_resp["payload"]
                    if not spot_price and payload.get("underlying_ltp"):
                        spot_price = float(payload["underlying_ltp"])

                    strikes_data = payload.get("strikes", {})
                    if not strikes_data:
                        continue

                    exp_data = {"expiry": exp_str, "calls": [], "puts": []}

                    for strike_str, contracts in strikes_data.items():
                        strike = float(strike_str)

                        # Call
                        ce = contracts.get("CE", {})
                        if ce:
                            greeks = ce.get("greeks", {})
                            exp_data["calls"].append({
                                "strike": strike,
                                "ltp": round(float(ce.get("ltp", 0)), 2),
                                "bid": 0, "ask": 0,
                                "iv": round(float(greeks.get("iv", 0)), 1),
                                "oi": int(ce.get("open_interest", 0)),
                                "volume": int(ce.get("volume", 0)),
                                "itm": strike < spot_price,
                                "delta": round(float(greeks.get("delta", 0)), 4),
                                "gamma": round(float(greeks.get("gamma", 0)), 6),
                                "theta": round(float(greeks.get("theta", 0)), 2),
                                "vega": round(float(greeks.get("vega", 0)), 2),
                                "trading_symbol": ce.get("trading_symbol", ""),
                            })

                        # Put
                        pe = contracts.get("PE", {})
                        if pe:
                            greeks = pe.get("greeks", {})
                            exp_data["puts"].append({
                                "strike": strike,
                                "ltp": round(float(pe.get("ltp", 0)), 2),
                                "bid": 0, "ask": 0,
                                "iv": round(float(greeks.get("iv", 0)), 1),
                                "oi": int(pe.get("open_interest", 0)),
                                "volume": int(pe.get("volume", 0)),
                                "itm": strike > spot_price,
                                "delta": round(float(greeks.get("delta", 0)), 4),
                                "gamma": round(float(greeks.get("gamma", 0)), 6),
                                "theta": round(float(greeks.get("theta", 0)), 2),
                                "vega": round(float(greeks.get("vega", 0)), 2),
                                "trading_symbol": pe.get("trading_symbol", ""),
                            })

                    # Sort by strike
                    exp_data["calls"].sort(key=lambda x: x["strike"])
                    exp_data["puts"].sort(key=lambda x: x["strike"])

                    if exp_data["calls"] or exp_data["puts"]:
                        chains.append(exp_data)
                        groww_success = True

                except Exception as exp_err:
                    print(f"Groww chain fetch error for {exp_str}: {exp_err}")
                    continue

            if groww_success:
                data_source = "groww"

        except Exception as groww_err:
            print(f"Groww API error: {groww_err}")
            groww_success = False

    # ── Fallback: Synthetic Black-Scholes chain ──────────────────────────────
    if not groww_success:
        try:
            loop = asyncio.get_event_loop()
            yf_sym = INDEX_MAP.get(sym_upper, f"{sym_upper}.NS")
            ticker = await loop.run_in_executor(None, lambda: yf.Ticker(yf_sym))
            hist = await loop.run_in_executor(None, lambda: ticker.history(period="60d"))
            if hist.empty:
                raise HTTPException(status_code=404, detail=f"No data for {symbol}")

            spot_price = round(float(hist["Close"].iloc[-1]), 2)
            returns = hist["Close"].pct_change().dropna()
            hist_vol = float(returns.std() * (252 ** 0.5)) if len(returns) > 10 else 0.20

            # Strike step
            if spot_price > 10000: step = 100
            elif spot_price > 1000: step = 50 if is_index else 20
            elif spot_price > 500: step = 10
            else: step = 5

            atm = round(spot_price / step) * step
            num_strikes = 20
            strikes = [atm + (i - num_strikes) * step for i in range(num_strikes * 2 + 1)]
            strikes = [s for s in strikes if s > 0]
            r = 0.07

            target_expiries = [expiry] if expiry else expiry_dates[:4]
            for exp_str in target_expiries:
                days_to_exp = max(1, (datetime.strptime(exp_str, "%Y-%m-%d").date() - today).days)
                T = days_to_exp / 365
                exp_data = {"expiry": exp_str, "calls": [], "puts": []}

                for strike in strikes:
                    moneyness = abs(strike - spot_price) / spot_price
                    iv_adj = hist_vol * (1 + 0.3 * moneyness + 0.1 * moneyness ** 2)
                    iv_adj = max(0.08, min(iv_adj, 1.0))
                    dist = abs(strike - atm) / step
                    base_oi = max(100, int(50000 * math.exp(-0.08 * dist ** 1.3)))
                    noise = random.uniform(0.7, 1.3)

                    c_g = black_scholes(spot_price, strike, T, r, iv_adj, "call")
                    exp_data["calls"].append({
                        "strike": strike, "ltp": c_g["price"], "bid": round(c_g["price"]*0.99,2), "ask": round(c_g["price"]*1.01,2),
                        "iv": round(iv_adj*100,1), "oi": int(base_oi*noise*(1.2 if strike>atm else 0.8)),
                        "volume": int(base_oi*noise*random.uniform(0.05,0.25)), "itm": strike<spot_price,
                        "delta": c_g["delta"], "gamma": c_g["gamma"], "theta": c_g["theta"], "vega": c_g["vega"],
                    })
                    p_g = black_scholes(spot_price, strike, T, r, iv_adj, "put")
                    exp_data["puts"].append({
                        "strike": strike, "ltp": p_g["price"], "bid": round(p_g["price"]*0.99,2), "ask": round(p_g["price"]*1.01,2),
                        "iv": round(iv_adj*100,1), "oi": int(base_oi*noise*(0.8 if strike>atm else 1.2)),
                        "volume": int(base_oi*noise*random.uniform(0.05,0.25)), "itm": strike>spot_price,
                        "delta": p_g["delta"], "gamma": p_g["gamma"], "theta": p_g["theta"], "vega": p_g["vega"],
                    })
                chains.append(exp_data)
            data_source = "synthetic"
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Options chain error: {str(e)}")

    # ── PCR & Max Pain ───────────────────────────────────────────────────────
    total_call_oi = sum(c["oi"] for ch in chains for c in ch["calls"])
    total_put_oi = sum(p["oi"] for ch in chains for p in ch["puts"])
    pcr = round(total_put_oi / total_call_oi, 2) if total_call_oi > 0 else 0

    max_pain_strike = spot_price
    if chains and chains[0]["calls"]:
        all_strikes = sorted(set(c["strike"] for c in chains[0]["calls"]))
        min_pain = float("inf")
        for s in all_strikes:
            pain = sum(max(0, s - c["strike"]) * c["oi"] for c in chains[0]["calls"]) + \
                   sum(max(0, p["strike"] - s) * p["oi"] for p in chains[0]["puts"])
            if pain < min_pain:
                min_pain = pain
                max_pain_strike = s

    # Historical vol (for display)
    hist_vol_pct = 0
    if data_source == "groww":
        try:
            loop = asyncio.get_event_loop()
            yf_sym = INDEX_MAP.get(sym_upper, f"{sym_upper}.NS")
            ticker = await loop.run_in_executor(None, lambda: yf.Ticker(yf_sym))
            hist = await loop.run_in_executor(None, lambda: ticker.history(period="60d"))
            if not hist.empty:
                rets = hist["Close"].pct_change().dropna()
                hist_vol_pct = round(float(rets.std() * (252**0.5)) * 100, 1)
        except:
            pass
    elif data_source == "synthetic":
        hist_vol_pct = round(hist_vol * 100, 1) if 'hist_vol' in locals() else 0

    result = {
        "symbol": sym_upper, "spot_price": round(spot_price, 2),
        "lot_size": lot_size, "hist_vol": hist_vol_pct,
        "expiry_dates": expiry_dates[:6], "chains": chains,
        "pcr": pcr, "max_pain": max_pain_strike,
        "total_call_oi": total_call_oi, "total_put_oi": total_put_oi,
        "data_source": data_source,
        "note": "Live data via Groww API" if data_source == "groww" else "Theoretical pricing via Black-Scholes (set Groww token in Admin for live data)"
    }

    ttl = 60 if data_source == "groww" else 180
    if redis_client:
        await redis_client.setex(cache_key, ttl, json.dumps(result))
    return result


@app.get("/api/options/strategies", tags=["Options Lab"], summary="List options strategies",
    description="Returns 65+ options strategies with classification tags (bias, risk, margin, greeks, volatility view, complexity). Filter by category, bias, risk type, or complexity.")
async def list_options_strategies(
    category: str = "", bias: str = "", risk: str = "", complexity: str = "",
    user=Depends(get_current_user)
):
    """Return all available options strategies with classification tags."""
    results = []
    for k, v in OPTIONS_STRATEGIES.items():
        tags = v.get("tags", {})
        # Apply filters
        if category and v.get("category", "") != category:
            continue
        if bias and tags.get("bias", "") != bias:
            continue
        if risk and tags.get("risk", "") != risk:
            continue
        if complexity and tags.get("complexity", "") != complexity:
            continue
        results.append({
            "id": k, "name": v["name"], "description": v["description"],
            "legs": len(v["legs"]), "category": v.get("category", ""),
            "tags": tags,
        })
    return {
        "strategies": results,
        "total": len(results),
        "categories": STRATEGY_CATEGORIES,
        "filters": {
            "bias": ["bullish", "bearish", "neutral"],
            "risk": ["limited", "unlimited"],
            "complexity": ["low", "medium", "high"],
            "vol_view": ["expansion", "contraction", "neutral"],
            "expiry": ["any", "weekly", "monthly", "event"],
        }
    }


@app.post("/api/options/suggest", tags=["Options Lab"], summary="Strategy suggestion engine",
    description="Suggest optimal options strategies based on market view, IV rank, PCR, time to expiry, and risk tolerance. Analyzes OI data and market conditions to recommend the best strategies.")
async def suggest_strategies(req: dict, user=Depends(get_current_user)):
    """AI-powered strategy suggestion based on market conditions."""
    bias = req.get("bias", "neutral")  # bullish, bearish, neutral, volatile
    iv_rank = float(req.get("iv_rank", 50))  # 0-100
    iv_percentile = float(req.get("iv_percentile", 50))
    pcr = float(req.get("pcr", 1.0))
    days_to_expiry = int(req.get("days_to_expiry", 30))
    risk_tolerance = req.get("risk_tolerance", "moderate")  # conservative, moderate, aggressive
    capital = float(req.get("capital", 100000))
    event_nearby = req.get("event_nearby", False)  # budget, earnings, RBI policy
    oi_signal = req.get("oi_signal", "")  # call_resistance, put_support, long_buildup, short_buildup, unwinding

    suggestions = []
    scores = {}

    for k, v in OPTIONS_STRATEGIES.items():
        tags = v.get("tags", {})
        score = 0
        reasons = []

        # ── Directional bias matching ──
        strat_bias = tags.get("bias", "neutral")
        if bias == "volatile":
            if tags.get("vol_view") == "expansion":
                score += 30
                reasons.append("Matches volatility expansion view")
            elif tags.get("vol_view") == "contraction":
                score -= 20
        elif bias == strat_bias:
            score += 25
            reasons.append(f"Matches {bias} directional view")
        elif bias == "neutral" and strat_bias == "neutral":
            score += 25
        elif strat_bias == "neutral" and bias != "volatile":
            score += 5  # Neutral strategies are always somewhat relevant

        # ── IV Rank scoring ──
        if iv_rank > 70:  # High IV — sell premium
            if tags.get("vol_view") == "contraction":
                score += 20
                reasons.append(f"High IV ({iv_rank}) favors premium selling")
            elif "theta+" in tags.get("greeks", ""):
                score += 15
            if tags.get("vol_view") == "expansion":
                score -= 15
        elif iv_rank < 30:  # Low IV — buy premium
            if tags.get("vol_view") == "expansion":
                score += 20
                reasons.append(f"Low IV ({iv_rank}) favors buying options")
            elif "vega+" in tags.get("greeks", ""):
                score += 15
            if tags.get("vol_view") == "contraction":
                score -= 10

        # ── PCR scoring ──
        if pcr > 1.3:  # Bullish signal (high put writing)
            if strat_bias == "bullish":
                score += 10
                reasons.append(f"PCR {pcr} indicates bullish sentiment")
        elif pcr < 0.7:  # Bearish signal
            if strat_bias == "bearish":
                score += 10
                reasons.append(f"PCR {pcr} indicates bearish sentiment")

        # ── Time to expiry ──
        if days_to_expiry <= 3:  # Expiry week
            if v.get("category") == "expiry":
                score += 25
                reasons.append("Designed for expiry day trading")
            elif "theta++" in tags.get("greeks", "") or "theta+" in tags.get("greeks", ""):
                score += 10
            if tags.get("expiry") in ["monthly", "far"]:
                score -= 20
        elif days_to_expiry <= 7:
            if tags.get("expiry") in ["weekly", "any"]:
                score += 5
            if v.get("category") == "time_based":
                score -= 10
        elif days_to_expiry > 21:
            if v.get("category") == "time_based":
                score += 15
                reasons.append("Calendar strategies work best with time")
            if v.get("category") == "expiry":
                score -= 25

        # ── Risk tolerance ──
        strat_risk = tags.get("risk", "limited")
        strat_complexity = tags.get("complexity", "low")
        if risk_tolerance == "conservative":
            if strat_risk == "limited":
                score += 15
            elif strat_risk == "unlimited":
                score -= 25
            if strat_complexity == "high":
                score -= 10
        elif risk_tolerance == "aggressive":
            if strat_risk == "unlimited" and "theta+" in tags.get("greeks", ""):
                score += 10  # Aggressive traders can sell premium
            if strat_complexity == "low":
                score -= 5  # They want more sophisticated strategies

        # ── Event proximity ──
        if event_nearby:
            if tags.get("vol_view") == "expansion":
                score += 15
                reasons.append("Event nearby favors volatility plays")
            elif tags.get("expiry") == "event":
                score += 20

        # ── OI-based signals ──
        if oi_signal == "call_resistance":
            if strat_bias == "bearish" or strat_bias == "neutral":
                score += 10
                reasons.append("Call OI resistance suggests selling calls")
            if k in ["bear_call_spread", "iron_condor", "short_strangle"]:
                score += 15
        elif oi_signal == "put_support":
            if strat_bias == "bullish" or strat_bias == "neutral":
                score += 10
                reasons.append("Put OI support suggests bullish bias")
            if k in ["bull_put_spread", "iron_condor", "synthetic_long"]:
                score += 15
        elif oi_signal == "long_buildup":
            if strat_bias == "bullish":
                score += 15
                reasons.append("Long build-up confirms bullish momentum")
        elif oi_signal == "short_buildup":
            if strat_bias == "bearish":
                score += 15
                reasons.append("Short build-up confirms bearish pressure")
        elif oi_signal == "short_covering":
            if k in ["call_backspread", "reverse_iron_condor", "long_straddle"]:
                score += 20
                reasons.append("Short covering → potential breakout")
        elif oi_signal == "long_unwinding":
            if strat_bias == "bearish":
                score += 15
                reasons.append("Long unwinding signals weakness")

        if score > 0:
            scores[k] = {"score": score, "reasons": reasons}

    # Sort by score and return top 10
    top = sorted(scores.items(), key=lambda x: x[1]["score"], reverse=True)[:10]
    suggestions = []
    for k, data in top:
        v = OPTIONS_STRATEGIES[k]
        suggestions.append({
            "id": k, "name": v["name"], "description": v["description"],
            "category": v.get("category", ""),
            "tags": v.get("tags", {}),
            "legs": len(v["legs"]),
            "match_score": data["score"],
            "reasons": data["reasons"],
        })

    return {
        "suggestions": suggestions,
        "input": {"bias": bias, "iv_rank": iv_rank, "pcr": pcr, "days_to_expiry": days_to_expiry,
                  "risk_tolerance": risk_tolerance, "event_nearby": event_nearby, "oi_signal": oi_signal},
        "total": len(suggestions),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# OI INTELLIGENCE ENGINE (Phase 3)
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/options/oi-analysis/{symbol}", tags=["Options Lab"], summary="OI Intelligence Analysis",
    description="Comprehensive Open Interest analysis — PCR, max pain, OI build-up/unwinding detection, support/resistance from OI clusters, and strategy recommendations based on OI data.")
async def oi_analysis(symbol: str, expiry: str = "", user=Depends(get_current_user)):
    """Full OI intelligence analysis — reuses the existing chain endpoint data (Groww/synthetic)."""
    sym_upper = symbol.upper()
    cache_key = f"oi_analysis:{sym_upper}:{expiry}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    # Call the existing options_chain endpoint to get data
    try:
        chain_data = await options_chain(sym_upper, expiry, user)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot fetch chain for {sym_upper}: {str(e)}")

    spot_price = chain_data.get("spot_price", 0)
    if not spot_price:
        raise HTTPException(status_code=400, detail=f"No spot price for {sym_upper}")

    chains = chain_data.get("chains", [])
    if not chains:
        raise HTTPException(status_code=400, detail=f"No chain data for {sym_upper}")

    # Use first expiry chain for analysis
    target_chain = chains[0]
    target_expiry = target_chain.get("expiry", "")
    calls = target_chain.get("calls", [])
    puts = target_chain.get("puts", [])

    # Build OI data from chain
    call_oi_map = {c["strike"]: c.get("oi", 0) for c in calls}
    put_oi_map = {p["strike"]: p.get("oi", 0) for p in puts}
    call_vol_map = {c["strike"]: c.get("volume", 0) for c in calls}
    put_vol_map = {p["strike"]: p.get("volume", 0) for p in puts}
    call_iv_map = {c["strike"]: c.get("iv", 0) for c in calls}
    put_iv_map = {p["strike"]: p.get("iv", 0) for p in puts}

    strikes = sorted(set(list(call_oi_map.keys()) + list(put_oi_map.keys())))
    if not strikes:
        raise HTTPException(status_code=400, detail="No strike data available")

    total_call_oi = sum(call_oi_map.values())
    total_put_oi = sum(put_oi_map.values())
    total_call_vol = sum(call_vol_map.values())
    total_put_vol = sum(put_vol_map.values())

    pcr_oi = round(total_put_oi / max(total_call_oi, 1), 3)
    pcr_vol = round(total_put_vol / max(total_call_vol, 1), 3)

    # Use chain-level PCR/max_pain if available (from Groww)
    if chain_data.get("pcr"):
        pcr_oi = chain_data["pcr"]
    if chain_data.get("max_pain"):
        chain_max_pain = chain_data["max_pain"]
    else:
        chain_max_pain = 0

    # Strike-wise OI data
    oi_data = []
    for strike in strikes:
        c_oi = int(call_oi_map.get(strike, 0))
        p_oi = int(put_oi_map.get(strike, 0))
        c_vol = int(call_vol_map.get(strike, 0))
        p_vol = int(put_vol_map.get(strike, 0))
        c_iv = round(float(call_iv_map.get(strike, 0)), 1)
        p_iv = round(float(put_iv_map.get(strike, 0)), 1)
        oi_data.append({
            "strike": float(strike), "call_oi": c_oi, "put_oi": p_oi,
            "call_vol": c_vol, "put_vol": p_vol,
            "call_iv": c_iv, "put_iv": p_iv,
            "net_oi": p_oi - c_oi,
        })

    # ── Max Pain Calculation ──
    max_pain_strike = chain_max_pain if chain_max_pain else None
    if not max_pain_strike:
        min_pain_value = float("inf")
        for target_strike in strikes:
            total_pain = 0
            for s in strikes:
                c_oi = int(call_oi_map.get(s, 0))
                p_oi = int(put_oi_map.get(s, 0))
                if target_strike > s:
                    total_pain += (target_strike - s) * c_oi
                elif target_strike < s:
                    total_pain += (s - target_strike) * p_oi
            if total_pain < min_pain_value:
                min_pain_value = total_pain
                max_pain_strike = float(target_strike)

    # ── OI-based Support & Resistance ──
    sorted_by_put_oi = sorted(oi_data, key=lambda x: x["put_oi"], reverse=True)
    sorted_by_call_oi = sorted(oi_data, key=lambda x: x["call_oi"], reverse=True)
    support_levels = [{"strike": x["strike"], "put_oi": x["put_oi"]} for x in sorted_by_put_oi[:3] if x["put_oi"] > 0]
    resistance_levels = [{"strike": x["strike"], "call_oi": x["call_oi"]} for x in sorted_by_call_oi[:3] if x["call_oi"] > 0]

    # ── OI Build-up / Unwinding Detection ──
    buildup_signals = []
    for item in oi_data:
        s = item["strike"]
        c_ratio = item["call_vol"] / max(item["call_oi"], 1)
        p_ratio = item["put_vol"] / max(item["put_oi"], 1)
        if item["call_oi"] > total_call_oi * 0.08 and c_ratio > 0.5:
            buildup_signals.append({"strike": s, "type": "call", "signal": "active_buildup", "strength": round(c_ratio, 2)})
        if item["put_oi"] > total_put_oi * 0.08 and p_ratio > 0.5:
            buildup_signals.append({"strike": s, "type": "put", "signal": "active_buildup", "strength": round(p_ratio, 2)})

    # ── Market Signal ──
    if pcr_oi > 1.3:
        market_signal = "bullish"
        signal_desc = f"PCR {pcr_oi} is elevated — heavy put writing indicates bullish sentiment"
    elif pcr_oi < 0.7:
        market_signal = "bearish"
        signal_desc = f"PCR {pcr_oi} is low — heavy call writing indicates bearish sentiment"
    elif 0.9 <= pcr_oi <= 1.1:
        market_signal = "neutral"
        signal_desc = f"PCR {pcr_oi} is balanced — no strong directional bias from options writers"
    else:
        market_signal = "mildly_bullish" if pcr_oi > 1 else "mildly_bearish"
        signal_desc = f"PCR {pcr_oi} shows slight {'bullish' if pcr_oi > 1 else 'bearish'} lean"

    # ── OI-triggered Strategy Recommendations ──
    oi_strategies = []
    if resistance_levels and support_levels:
        r1 = resistance_levels[0]["strike"]
        s1 = support_levels[0]["strike"]
        if r1 > s1 and spot_price > s1 and spot_price < r1:
            oi_strategies.append({
                "strategy": "iron_condor", "name": "Iron Condor",
                "reason": f"Price between OI support ({s1}) and resistance ({r1}) — range-bound play",
                "confidence": "high" if 0.85 <= pcr_oi <= 1.15 else "medium"
            })
            oi_strategies.append({
                "strategy": "short_strangle", "name": "Short Strangle",
                "reason": "Sell OTM options around support/resistance levels for premium",
                "confidence": "medium"
            })
    if max_pain_strike and abs(spot_price - max_pain_strike) / spot_price < 0.02:
        oi_strategies.append({
            "strategy": "pin_risk_butterfly", "name": "Pin Risk Butterfly",
            "reason": f"Spot near max pain ({max_pain_strike}) — price likely to pin near expiry",
            "confidence": "high"
        })
        oi_strategies.append({
            "strategy": "short_straddle", "name": "Short Straddle at Max Pain",
            "reason": f"Max pain {max_pain_strike} close to spot — sell straddle for decay",
            "confidence": "medium"
        })
    if pcr_oi > 1.3:
        oi_strategies.append({"strategy": "bull_put_spread", "name": "Bull Put Spread",
            "reason": "Heavy put writing (PCR > 1.3) — put sellers providing support", "confidence": "high"})
        oi_strategies.append({"strategy": "synthetic_long", "name": "Synthetic Long",
            "reason": "Strong put writing suggests floor — synthetic long for bullish exposure", "confidence": "medium"})
    elif pcr_oi < 0.7:
        oi_strategies.append({"strategy": "bear_call_spread", "name": "Bear Call Spread",
            "reason": "Heavy call writing (PCR < 0.7) — call sellers creating ceiling", "confidence": "high"})
    any_breakout = any(b for b in buildup_signals if b["strength"] > 1.0)
    if any_breakout:
        oi_strategies.append({"strategy": "reverse_iron_condor", "name": "Reverse Iron Condor",
            "reason": "High volume/OI ratio — potential breakout, buy wings", "confidence": "medium"})
        oi_strategies.append({"strategy": "long_straddle", "name": "Long Straddle",
            "reason": "Active OI buildup signals big directional move incoming", "confidence": "medium"})

    result = {
        "symbol": sym_upper, "spot_price": spot_price,
        "expiry": target_expiry,
        "available_expiries": chain_data.get("expiry_dates", []),
        "pcr": {"oi": pcr_oi, "volume": pcr_vol},
        "total_oi": {"calls": total_call_oi, "puts": total_put_oi},
        "total_volume": {"calls": total_call_vol, "puts": total_put_vol},
        "max_pain": {"strike": max_pain_strike, "distance_pct": round((max_pain_strike - spot_price) / spot_price * 100, 2) if max_pain_strike else 0},
        "support_levels": support_levels, "resistance_levels": resistance_levels,
        "market_signal": {"signal": market_signal, "description": signal_desc},
        "oi_buildup": buildup_signals[:10],
        "oi_data": oi_data,
        "data_source": chain_data.get("data_source", "synthetic"),
        "strategy_recommendations": oi_strategies,
    }

    if redis_client:
        await redis_client.set(cache_key, json.dumps(result), ex=300)

    return result


@app.post("/api/options/payoff", tags=["Options Lab"], summary="Calculate options strategy payoff",
    description="Enhanced payoff calculator — returns at-expiry payoff, position Greeks, probability of profit, margin estimate, and time-decay P&L grid for risk heatmap visualization.")
async def calculate_payoff(req: dict, user=Depends(get_current_user)):
    """Calculate payoff diagram with position Greeks, PoP, margin, and time-based P&L."""
    import math
    from scipy.stats import norm

    spot = float(req.get("spot_price", 0))
    legs = req.get("legs", [])
    lot_size = int(req.get("lot_size", 1))
    days_to_expiry = int(req.get("days_to_expiry", 30))
    risk_free = float(req.get("risk_free_rate", 7.0)) / 100

    if not spot or not legs:
        raise HTTPException(status_code=400, detail="Need spot_price and legs")

    # ── 1. At-Expiry Payoff ──────────────────────────────────────────────────
    low = spot * 0.80
    high = spot * 1.20
    prices = [round(low + i * (high - low) / 100, 2) for i in range(101)]

    payoff_data = []
    for price in prices:
        total_pnl = 0
        for leg in legs:
            leg_type = leg.get("type", "call")
            side = leg.get("side", "buy")
            strike = float(leg.get("strike", spot))
            premium = float(leg.get("premium", 0))
            qty = int(leg.get("quantity", lot_size))
            multiplier = 1 if side == "buy" else -1

            if leg_type == "call":
                intrinsic = max(0, price - strike)
                pnl = (intrinsic - premium) * qty * multiplier
            elif leg_type == "put":
                intrinsic = max(0, strike - price)
                pnl = (intrinsic - premium) * qty * multiplier
            elif leg_type == "stock":
                pnl = (price - spot) * qty * multiplier
            else:
                pnl = 0
            total_pnl += pnl
        payoff_data.append({"price": price, "pnl": round(total_pnl, 2)})

    max_profit = max(p["pnl"] for p in payoff_data)
    max_loss = min(p["pnl"] for p in payoff_data)
    breakevens = []
    for i in range(1, len(payoff_data)):
        if payoff_data[i-1]["pnl"] * payoff_data[i]["pnl"] < 0:
            breakevens.append(payoff_data[i]["price"])

    net_premium = sum(
        float(l.get("premium", 0)) * int(l.get("quantity", lot_size)) * (1 if l.get("side") == "buy" else -1)
        for l in legs if l.get("type") != "stock"
    )

    # ── 2. Position Greeks (aggregate across all legs) ────────────────────────
    T = max(1, days_to_expiry) / 365
    position_greeks = {"delta": 0, "gamma": 0, "theta": 0, "vega": 0, "rho": 0, "net_premium": round(net_premium, 2)}

    for leg in legs:
        leg_type = leg.get("type", "call")
        if leg_type == "stock":
            qty = int(leg.get("quantity", lot_size))
            mult = 1 if leg.get("side") == "buy" else -1
            position_greeks["delta"] += qty * mult
            continue

        strike = float(leg.get("strike", spot))
        premium = float(leg.get("premium", 0))
        qty = int(leg.get("quantity", lot_size))
        side = leg.get("side", "buy")
        mult = 1 if side == "buy" else -1

        # Estimate IV from premium using Newton's method if premium > 0
        iv = 0.15  # default 15%
        if premium > 0 and spot > 0 and strike > 0:
            try:
                iv = implied_volatility(premium, spot, strike, T, risk_free, leg_type) / 100
                iv = max(0.05, min(iv, 2.0))
            except:
                iv = 0.15

        try:
            g = black_scholes(spot, strike, T, risk_free, iv, leg_type)
            position_greeks["delta"] += round(g["delta"] * qty * mult, 2)
            position_greeks["gamma"] += round(g["gamma"] * qty * mult, 6)
            position_greeks["theta"] += round(g["theta"] * qty * mult, 2)
            position_greeks["vega"] += round(g["vega"] * qty * mult, 2)
            position_greeks["rho"] += round(g["rho"] * qty * mult, 2)
        except:
            pass

    for k in ["delta", "gamma", "theta", "vega", "rho"]:
        position_greeks[k] = round(position_greeks[k], 4 if k == "gamma" else 2)

    # ── 3. Probability of Profit (PoP) ────────────────────────────────────────
    # Using log-normal distribution: probability that strategy P&L > 0 at expiry
    pop = 50.0  # default
    try:
        # Estimate average IV across legs
        ivs = []
        for leg in legs:
            if leg.get("type") == "stock": continue
            strike = float(leg.get("strike", spot))
            premium = float(leg.get("premium", 0))
            if premium > 0:
                try:
                    leg_iv = implied_volatility(premium, spot, strike, T, risk_free, leg.get("type", "call")) / 100
                    ivs.append(max(0.05, min(leg_iv, 2.0)))
                except:
                    ivs.append(0.15)
        avg_iv = sum(ivs) / len(ivs) if ivs else 0.15

        # Monte Carlo-lite: count what % of the payoff curve is profitable
        profitable = sum(1 for p in payoff_data if p["pnl"] > 0)
        pop_simple = round(profitable / len(payoff_data) * 100, 1)

        # Also use log-normal for breakeven-based PoP
        if breakevens and avg_iv > 0:
            pop_parts = []
            drift = (risk_free - 0.5 * avg_iv**2) * T
            vol_sqrt_t = avg_iv * math.sqrt(T)
            if len(breakevens) == 1:
                be = breakevens[0]
                # For debit strategies (net buyer), profitable above/below BE
                p_above = 1 - norm.cdf((math.log(be / spot) - drift) / vol_sqrt_t)
                p_below = norm.cdf((math.log(be / spot) - drift) / vol_sqrt_t)
                # Check which side is profitable
                mid_payoff = next((p["pnl"] for p in payoff_data if p["price"] >= be + spot*0.01), 0)
                pop = round((p_above if mid_payoff > 0 else p_below) * 100, 1)
            elif len(breakevens) == 2:
                be_low, be_high = sorted(breakevens)
                p_between = norm.cdf((math.log(be_high / spot) - drift) / vol_sqrt_t) - \
                            norm.cdf((math.log(be_low / spot) - drift) / vol_sqrt_t)
                # Check if profitable between or outside breakevens
                mid_price = (be_low + be_high) / 2
                mid_payoff = next((p["pnl"] for p in payoff_data if p["price"] >= mid_price), 0)
                pop = round((p_between if mid_payoff > 0 else (1 - p_between)) * 100, 1)
            else:
                pop = pop_simple
        else:
            pop = pop_simple

        pop = max(0, min(100, pop))
    except:
        pop = round(sum(1 for p in payoff_data if p["pnl"] > 0) / len(payoff_data) * 100, 1)

    # ── 4. Margin Estimate (SPAN-like approximation for NSE) ──────────────────
    margin_estimate = 0
    try:
        for leg in legs:
            if leg.get("type") == "stock": continue
            strike = float(leg.get("strike", spot))
            premium = float(leg.get("premium", 0))
            qty = int(leg.get("quantity", lot_size))
            side = leg.get("side", "buy")

            if side == "buy":
                # Long options: just premium paid
                margin_estimate += premium * qty
            else:
                # Short options: SPAN margin ≈ max(premium + OTM_amount, spot * margin_pct) * qty
                if leg.get("type") == "call":
                    otm = max(0, strike - spot)
                else:
                    otm = max(0, spot - strike)
                span_margin = max(premium * 1.5, spot * 0.12 - otm * 0.5) * qty
                margin_estimate += span_margin

        # If it's a spread (has both buy and sell), reduce margin
        has_buy = any(l.get("side") == "buy" and l.get("type") != "stock" for l in legs)
        has_sell = any(l.get("side") == "sell" for l in legs)
        if has_buy and has_sell:
            # Spread margin = max loss (usually)
            margin_estimate = min(margin_estimate, abs(max_loss) * 1.2) if max_loss < 0 else margin_estimate * 0.5
    except:
        margin_estimate = abs(max_loss) if max_loss < 0 else 0

    # ── 5. Time-Decay P&L Grid (for Risk Heatmap) ─────────────────────────────
    # P&L at different spots × different days to expiry
    time_grid = []
    try:
        spot_steps = 21  # -10% to +10%
        time_steps = [days_to_expiry, int(days_to_expiry*0.75), int(days_to_expiry*0.5),
                      int(days_to_expiry*0.25), max(1, int(days_to_expiry*0.1)), 1]
        time_steps = sorted(set(max(1, t) for t in time_steps), reverse=True)

        spot_range = [round(spot * (0.90 + i * 0.01), 2) for i in range(spot_steps)]

        for dte in time_steps:
            T_dte = max(1, dte) / 365
            row = {"dte": dte, "pnl": []}
            for s_price in spot_range:
                total_pnl = 0
                for leg in legs:
                    leg_type = leg.get("type", "call")
                    side = leg.get("side", "buy")
                    strike = float(leg.get("strike", spot))
                    premium = float(leg.get("premium", 0))
                    qty = int(leg.get("quantity", lot_size))
                    mult = 1 if side == "buy" else -1

                    if leg_type == "stock":
                        total_pnl += (s_price - spot) * qty * mult
                        continue

                    iv_est = 0.15
                    if premium > 0:
                        try:
                            iv_est = implied_volatility(premium, spot, strike, T, risk_free, leg_type) / 100
                            iv_est = max(0.05, min(iv_est, 2.0))
                        except:
                            iv_est = 0.15

                    try:
                        bs = black_scholes(s_price, strike, T_dte, risk_free, iv_est, leg_type)
                        curr_val = bs["price"]
                        cost = premium
                        pnl = (curr_val - cost) * qty * mult
                        total_pnl += pnl
                    except:
                        pass

                row["pnl"].append(round(total_pnl, 2))
            time_grid.append(row)
    except:
        time_grid = []

    return {
        "payoff": payoff_data, "spot": spot,
        "max_profit": round(max_profit, 2),
        "max_loss": round(max_loss, 2),
        "breakevens": breakevens,
        "net_premium": round(net_premium, 2),
        "risk_reward": round(abs(max_profit / max_loss), 2) if max_loss != 0 else 0,
        "position_greeks": position_greeks,
        "probability_of_profit": pop,
        "margin_estimate": round(margin_estimate, 2),
        "time_grid": {
            "spot_range": [round(spot * (0.90 + i * 0.01), 2) for i in range(21)] if time_grid else [],
            "data": time_grid,
        },
        "days_to_expiry": days_to_expiry,
    }


@app.post("/api/options/compare", tags=["Options Lab"], summary="Compare strategies",
    description="Compare 2-3 options strategies side by side. Returns payoff curves, Greeks, PoP, margin, and risk-reward for each strategy.")
async def compare_strategies(req: dict, user=Depends(get_current_user)):
    """Compare multiple strategies head to head."""
    strategies = req.get("strategies", [])
    if not strategies or len(strategies) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 strategies to compare")
    if len(strategies) > 4:
        strategies = strategies[:4]

    results = []
    for strat in strategies:
        # Each strategy has: name, spot_price, legs, lot_size, days_to_expiry
        try:
            payoff_result = await calculate_payoff(strat, user)
            results.append({
                "name": strat.get("name", f"Strategy {len(results)+1}"),
                "payoff": payoff_result["payoff"],
                "max_profit": payoff_result["max_profit"],
                "max_loss": payoff_result["max_loss"],
                "breakevens": payoff_result["breakevens"],
                "net_premium": payoff_result["net_premium"],
                "risk_reward": payoff_result["risk_reward"],
                "position_greeks": payoff_result["position_greeks"],
                "probability_of_profit": payoff_result["probability_of_profit"],
                "margin_estimate": payoff_result["margin_estimate"],
                "legs": len(strat.get("legs", [])),
            })
        except Exception as e:
            results.append({"name": strat.get("name", "?"), "error": str(e)})

    return {"strategies": results, "count": len(results)}


@app.get("/api/options/greeks", tags=["Options Lab"], summary="Calculate option Greeks",
    description="Calculate Black-Scholes Greeks (Delta, Gamma, Theta, Vega, Rho) for a single option. Provide spot price, strike, expiry date, risk-free rate, and IV.")
async def calculate_greeks(
    spot: float, strike: float, expiry_days: int, iv: float,
    option_type: str = "call", r: float = 7.0, user=Depends(get_current_user)
):
    """Calculate Greeks for a single option."""
    T = max(1, expiry_days) / 365
    greeks = black_scholes(spot, strike, T, r / 100, iv / 100, option_type)
    greeks["iv"] = iv
    greeks["expiry_days"] = expiry_days
    greeks["intrinsic"] = round(max(0, spot - strike) if option_type == "call" else max(0, strike - spot), 2)
    greeks["time_value"] = round(greeks["price"] - greeks["intrinsic"], 2)
    greeks["moneyness"] = "ITM" if greeks["intrinsic"] > 0 else ("ATM" if abs(spot - strike) / spot < 0.01 else "OTM")
    return greeks


# ══════════════════════════════════════════════════════════════════════════════
# SEBI ADVISORY REPORT SYSTEM
# ══════════════════════════════════════════════════════════════════════════════

def generate_rationale(symbol: str, call_type: str, tech: dict, fund: dict, rationale_type: str = "quantamental") -> str:
    """Auto-generate SEBI-compliant rationale from technical + fundamental data."""
    tech_parts = []
    fund_parts = []
    is_buy = call_type.upper() == "BUY"
    price = tech.get("price", 0)

    # ── Technical rationale ──────────────────────────────────────────────────
    if is_buy:
        if tech.get("above_200dma"): tech_parts.append(f"{symbol} is trading above its 200-day moving average (₹{tech.get('sma_200',0)}), confirming a long-term uptrend")
        if tech.get("above_50dma"): tech_parts.append(f"The stock is above its 50-day SMA (₹{tech.get('sma_50',0)}), indicating positive short-term momentum")
        rsi = tech.get("rsi", 50)
        if rsi < 35: tech_parts.append(f"RSI at {rsi} places the stock in deeply oversold territory, historically a zone where reversals tend to occur")
        elif rsi < 45: tech_parts.append(f"RSI at {rsi} suggests the stock is approaching oversold levels, presenting a favourable risk-reward entry")
        elif 50 < rsi < 70: tech_parts.append(f"RSI at {rsi} reflects healthy bullish momentum with room to run before reaching overbought levels")
        if tech.get("macd_cross_up"): tech_parts.append("MACD has recently made a bullish crossover above its signal line, a reliable buy trigger")
        elif tech.get("macd_hist", 0) > 0: tech_parts.append(f"MACD histogram is positive at {tech.get('macd_hist',0)}, supporting the bullish thesis")
        if tech.get("golden_cross"): tech_parts.append("A Golden Cross (50 DMA crossing above 200 DMA) has formed - historically one of the most reliable long-term bullish signals")
        if tech.get("vol_ratio", 0) > 2: tech_parts.append(f"Volume is {tech.get('vol_ratio',0)}x above the 20-day average, suggesting strong institutional participation")
        elif tech.get("vol_ratio", 0) > 1.5: tech_parts.append(f"Volume at {tech.get('vol_ratio',0)}x average indicates above-normal buying interest")
        rs3m = tech.get("rs_3m", 0)
        if rs3m > 15: tech_parts.append(f"3-month relative strength of +{rs3m}% shows significant outperformance versus the broader market, indicating strong institutional interest")
        elif rs3m > 5: tech_parts.append(f"3-month relative strength of +{rs3m}% indicates the stock is outperforming the market")
        if tech.get("minervini_score", 0) >= 5: tech_parts.append(f"The stock passes {tech.get('minervini_score',0)} out of 7 Minervini trend template criteria, qualifying it as a Stage 2 uptrend candidate")
        w52h = tech.get("w52_high", 0)
        w52l = tech.get("w52_low", 0)
        if w52h and price and w52h > 0:
            pct_from_high = round((price - w52h) / w52h * 100, 1)
            if pct_from_high > -5: tech_parts.append(f"Trading within 5% of its 52-week high (₹{w52h}), demonstrating sustained buying pressure at higher levels")
            elif pct_from_high < -25: tech_parts.append(f"Currently {abs(pct_from_high)}% below 52-week high, offering a potential value entry with recovery upside")
        if w52l and price and w52l > 0:
            pct_from_low = round((price - w52l) / w52l * 100, 1)
            if pct_from_low > 50: tech_parts.append(f"The stock has rallied {pct_from_low}% from its 52-week low (₹{w52l}), confirming a strong uptrend")
        # Support/resistance context
        sma200 = tech.get("sma_200", 0)
        sma50 = tech.get("sma_50", 0)
        if sma50 and sma200 and price:
            tech_parts.append(f"Key support levels: 50 DMA at ₹{sma50}, 200 DMA at ₹{sma200}. Immediate resistance near 52-week high at ₹{w52h}" if w52h else "")
    else:
        if not tech.get("above_200dma"): tech_parts.append(f"{symbol} is trading below its 200-day moving average, indicating a structural downtrend")
        if not tech.get("above_50dma"): tech_parts.append("Price is below its 50-day SMA, confirming short-to-medium term bearish momentum")
        rsi = tech.get("rsi", 50)
        if rsi > 75: tech_parts.append(f"RSI at {rsi} places the stock in deeply overbought territory, significantly increasing the probability of a pullback")
        elif rsi > 70: tech_parts.append(f"RSI at {rsi} is in overbought territory, where mean-reversion risk increases")
        if tech.get("death_cross"): tech_parts.append("A Death Cross (50 DMA crossing below 200 DMA) has formed - a bearish structural signal that often precedes further downside")
        rs3m = tech.get("rs_3m", 0)
        if rs3m < -10: tech_parts.append(f"3-month relative strength of {rs3m}% shows significant underperformance, indicating potential structural weakness")
        elif rs3m < -3: tech_parts.append(f"3-month relative strength of {rs3m}% reflects underperformance versus the broader market")
        if tech.get("macd_hist", 0) < 0: tech_parts.append(f"MACD histogram at {tech.get('macd_hist',0)} confirms bearish momentum is intact")
    # Filter empty strings
    tech_parts = [p for p in tech_parts if p]

    # ── Fundamental rationale ────────────────────────────────────────────────
    pe = fund.get("pe_ratio", 0)
    roe = fund.get("roe", 0)
    div_yield = fund.get("dividend_yield", 0)
    de = fund.get("debt_equity", 0)
    mcap = fund.get("market_cap", 0)
    sector = fund.get("sector", "")
    name = fund.get("name", symbol)

    if name and name != symbol:
        fund_parts.append(f"{name} ({symbol})" + (f" operates in the {sector} sector" if sector else ""))

    if is_buy:
        if pe and 0 < pe < 20: fund_parts.append(f"P/E ratio of {pe:.1f}x suggests reasonable valuation relative to earnings")
        elif pe and 20 <= pe < 35: fund_parts.append(f"P/E ratio of {pe:.1f}x is moderate, justifiable if growth trajectory continues")
        if roe and roe > 18: fund_parts.append(f"ROE of {roe:.1f}% reflects excellent capital efficiency and shareholder value creation")
        elif roe and roe > 12: fund_parts.append(f"ROE of {roe:.1f}% indicates adequate return on equity")
        if div_yield and div_yield > 1.5: fund_parts.append(f"Dividend yield of {div_yield:.1f}% provides regular income support to investors")
        elif div_yield and div_yield > 0.5: fund_parts.append(f"The company pays a dividend yield of {div_yield:.1f}%")
        if de and 0 < de < 0.5: fund_parts.append(f"Very low debt-to-equity ratio of {de:.2f} indicates a conservatively managed balance sheet")
        elif de and de < 1: fund_parts.append(f"Debt-to-equity ratio of {de:.2f} is within comfortable levels")
        if mcap:
            if mcap > 500e9: fund_parts.append("As a large-cap company, it offers relative stability and liquidity")
            elif mcap > 50e9: fund_parts.append("Mid-cap positioning offers a balance of growth potential and stability")
    else:
        if pe and pe > 50: fund_parts.append(f"P/E ratio of {pe:.1f}x appears significantly stretched, limiting further upside")
        elif pe and pe > 35: fund_parts.append(f"P/E ratio of {pe:.1f}x is elevated relative to sector peers")
        if roe and roe < 8: fund_parts.append(f"ROE of {roe:.1f}% is below industry average, suggesting weak capital efficiency")
        if de and de > 2: fund_parts.append(f"Debt-to-equity ratio of {de:.2f} raises concerns about financial leverage and interest burden")
        elif de and de > 1.5: fund_parts.append(f"Elevated debt-to-equity of {de:.2f} may constrain future growth")

    # ── Compose based on rationale type ──────────────────────────────────────
    parts = []
    if rationale_type == "technical":
        parts = tech_parts[:]
        if not parts:
            parts.append(f"Based on technical analysis, {symbol} at ₹{price} {'shows bullish price structure' if is_buy else 'shows bearish price structure'}")
    elif rationale_type == "fundamental":
        parts = fund_parts[:]
        if not parts:
            parts.append(f"Based on fundamental analysis, {symbol} {'presents a value opportunity at current levels' if is_buy else 'appears overvalued at current levels'}")
    else:  # quantamental
        if tech_parts:
            parts.append("TECHNICAL: " + ". ".join(tech_parts))
        if fund_parts:
            parts.append("FUNDAMENTAL: " + ". ".join(fund_parts))
        if not parts:
            parts.append(f"Based on quantamental analysis of {symbol}, the current price at ₹{price} {'supports a bullish' if is_buy else 'suggests a bearish'} outlook")

    # Add conclusion
    if is_buy:
        parts.append(f"CONCLUSION: Based on the above analysis, we recommend a BUY on {symbol} at current levels of ₹{price} with the target and stop-loss as mentioned above. Investors should monitor the stock for any change in the underlying thesis and adjust positions accordingly")
    else:
        parts.append(f"CONCLUSION: Based on the above analysis, we recommend a SELL / EXIT on {symbol} at current levels of ₹{price}. The risk-reward is unfavourable for fresh long positions at this juncture")

    return ". ".join(parts) + "."


def _sanitize_for_pdf(text: str) -> str:
    """Replace Unicode characters that reportlab can't render."""
    return text.replace("₹", "Rs.").replace("—", "-").replace("–", "-")


def generate_single_advisory_pdf(report: dict, rec: dict, output_path: str, template: str = "professional"):
    """Generate a professional SEBI-compliant advisory PDF for a single recommendation."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.units import mm
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY

    doc = SimpleDocTemplate(output_path, pagesize=A4,
                            topMargin=18*mm, bottomMargin=18*mm,
                            leftMargin=18*mm, rightMargin=18*mm)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='RTitle', parent=styles['Title'], fontSize=16, textColor=colors.HexColor('#1a1a2e'), spaceAfter=4))
    styles.add(ParagraphStyle(name='RSub', parent=styles['Normal'], fontSize=10, textColor=colors.HexColor('#555555'), spaceAfter=10))
    styles.add(ParagraphStyle(name='RSec', parent=styles['Heading2'], fontSize=12, textColor=colors.HexColor('#0d47a1'), spaceBefore=10, spaceAfter=4))
    styles.add(ParagraphStyle(name='RBuy', parent=styles['Normal'], fontSize=14, textColor=colors.HexColor('#2e7d32'), fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle(name='RSell', parent=styles['Normal'], fontSize=14, textColor=colors.HexColor('#c62828'), fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle(name='RBody', parent=styles['Normal'], fontSize=10, textColor=colors.HexColor('#333333'), leading=14, alignment=TA_JUSTIFY))
    styles.add(ParagraphStyle(name='RDisc', parent=styles['Normal'], fontSize=7, textColor=colors.HexColor('#999999'), leading=9))
    styles.add(ParagraphStyle(name='RLabel', parent=styles['Normal'], fontSize=9, textColor=colors.HexColor('#777777')))

    story = []
    created = report.get("created_at", "")
    date_str = created[:10] if created else datetime.utcnow().strftime("%Y-%m-%d")
    sym = rec.get("symbol", "")
    call = rec.get("call_type", "BUY").upper()
    entry = rec.get("entry_price", 0)
    target = rec.get("target_price", 0)
    sl = rec.get("stop_loss", 0)
    horizon = rec.get("time_horizon", "short_term").replace("_", " ").title()
    rationale = _sanitize_for_pdf(rec.get("rationale", ""))
    tech = rec.get("technical_data", {}) or {}
    fund = rec.get("fundamental_data", {}) or {}
    if isinstance(tech, str):
        try: tech = json.loads(tech)
        except: tech = {}
    if isinstance(fund, str):
        try: fund = json.loads(fund)
        except: fund = {}

    # ── Header ──
    story.append(Paragraph("INVESTMENT ADVISORY REPORT", styles['RTitle']))
    sub = [f"Date: {date_str}"]
    advisor = report.get("advisor_name", "")
    reg_no = report.get("ria_reg_no", "")
    if advisor: sub.append(f"Advisor: {advisor}")
    if reg_no: sub.append(f"SEBI Reg: {reg_no}")
    story.append(Paragraph(" | ".join(sub), styles['RSub']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#0d47a1'), spaceAfter=12))

    # ── Stock Header ──
    company_name = fund.get("name", sym)
    sector = fund.get("sector", "")
    title_line = f"{company_name}" if company_name != sym else sym
    if sector: title_line += f" ({sector})"
    story.append(Paragraph(f"<b>{title_line}</b> | NSE: {sym}", styles['RSec']))
    call_style = styles['RBuy'] if call == 'BUY' else styles['RSell']
    story.append(Paragraph(f"RECOMMENDATION: {call}", call_style))
    story.append(Spacer(1, 8))

    # ── Price Summary Table ──
    row1 = ["", "Entry Price", "Target Price", "Stop Loss", "Time Horizon"]
    row2 = ["Values", f"Rs. {entry:,.2f}" if entry else "-", f"Rs. {target:,.2f}" if target else "-",
            f"Rs. {sl:,.2f}" if sl else "-", horizon]
    rows = [row1, row2]
    if target and entry and entry > 0:
        upside = round((target - entry) / entry * 100, 1)
        risk = round(abs(entry - sl) / entry * 100, 1) if sl else 0
        rr = round(upside / risk, 1) if risk > 0 else 0
        rows.append(["Analysis", f"Upside: {upside}%", f"Risk: {risk}%", f"R:R 1:{rr}" if rr else "-", ""])

    pt = Table(rows, colWidths=[60, 100, 100, 100, 100])
    pt.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0d47a1')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BACKGROUND', (0, 1), (0, -1), colors.HexColor('#e8eaf6')),
        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#90a4ae')),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ]))
    story.append(pt)
    story.append(Spacer(1, 12))

    # ── Technical Snapshot Table ──
    if tech:
        story.append(Paragraph("TECHNICAL SNAPSHOT", styles['RSec']))
        tech_rows = [["Indicator", "Value", "Signal"]]
        price = tech.get("price", entry)
        if price: tech_rows.append(["Current Price", f"Rs. {price:,.2f}", ""])
        sma50 = tech.get("sma_50", 0)
        sma200 = tech.get("sma_200", 0)
        if sma50: tech_rows.append(["50 DMA", f"Rs. {sma50:,.2f}", "Above" if price > sma50 else "Below"])
        if sma200: tech_rows.append(["200 DMA", f"Rs. {sma200:,.2f}", "Above" if price > sma200 else "Below"])
        rsi = tech.get("rsi", 0)
        if rsi: tech_rows.append(["RSI (14)", f"{rsi:.1f}", "Oversold" if rsi < 30 else "Overbought" if rsi > 70 else "Neutral"])
        macd_h = tech.get("macd_hist", 0)
        tech_rows.append(["MACD Histogram", f"{macd_h:.2f}" if macd_h else "-", "Bullish" if macd_h and macd_h > 0 else "Bearish"])
        vr = tech.get("vol_ratio", 0)
        if vr: tech_rows.append(["Volume Ratio", f"{vr:.1f}x", "High" if vr > 1.5 else "Normal"])
        rs3m = tech.get("rs_3m", 0)
        if rs3m: tech_rows.append(["3M Rel. Strength", f"{rs3m:+.1f}%", "Outperforming" if rs3m > 0 else "Underperforming"])
        w52h = tech.get("w52_high", 0)
        w52l = tech.get("w52_low", 0)
        if w52h: tech_rows.append(["52-Week High", f"Rs. {w52h:,.2f}", f"{round((price-w52h)/w52h*100,1)}% from high" if price and w52h else ""])
        if w52l: tech_rows.append(["52-Week Low", f"Rs. {w52l:,.2f}", f"{round((price-w52l)/w52l*100,1)}% from low" if price and w52l else ""])

        tt = Table(tech_rows, colWidths=[120, 120, 200])
        tt.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e3f2fd')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#cfd8dc')),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        story.append(tt)
        story.append(Spacer(1, 8))

    # ── Fundamental Snapshot Table ──
    if fund and any(fund.get(k) for k in ["pe_ratio", "roe", "dividend_yield", "debt_equity"]):
        story.append(Paragraph("FUNDAMENTAL SNAPSHOT", styles['RSec']))
        fund_rows = [["Metric", "Value", "Assessment"]]
        pe = fund.get("pe_ratio", 0)
        if pe and pe > 0:
            assess = "Attractive" if pe < 15 else "Moderate" if pe < 30 else "Expensive"
            fund_rows.append(["P/E Ratio", f"{pe:.1f}x", assess])
        roe = fund.get("roe", 0)
        if roe and roe > 0:
            assess = "Excellent" if roe > 18 else "Good" if roe > 12 else "Average"
            fund_rows.append(["Return on Equity", f"{roe:.1f}%", assess])
        dy = fund.get("dividend_yield", 0)
        if dy and dy > 0: fund_rows.append(["Dividend Yield", f"{dy:.1f}%", "Income support" if dy > 1.5 else "Modest"])
        de = fund.get("debt_equity", 0)
        if de and de > 0:
            assess = "Conservative" if de < 0.5 else "Moderate" if de < 1.5 else "High leverage"
            fund_rows.append(["Debt/Equity", f"{de:.2f}", assess])
        mcap = fund.get("market_cap", 0)
        if mcap:
            if mcap > 500e9: cap_cat = "Large Cap"
            elif mcap > 50e9: cap_cat = "Mid Cap"
            else: cap_cat = "Small Cap"
            fund_rows.append(["Market Cap", f"Rs. {mcap/1e9:,.0f}B", cap_cat])

        ft = Table(fund_rows, colWidths=[120, 120, 200])
        ft.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#fce4ec')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#cfd8dc')),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        story.append(ft)
        story.append(Spacer(1, 8))

    # ════ CLIENT SUMMARY (1-page simplified) ════
    if template == "client_summary":
        story.append(Paragraph("STOCK RECOMMENDATION", styles['RTitle']))
        story.append(Paragraph(f"Date: {date_str}", styles['RSub']))
        story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor('#0d47a1'), spaceAfter=12))
        company = fund.get("name", sym)
        sector_v = fund.get("sector", "")
        story.append(Paragraph(f"<b>{company}</b> ({sym}){' | '+sector_v if sector_v else ''}", styles['RSec']))
        call_style = styles['RBuy'] if call == 'BUY' else styles['RSell']
        story.append(Paragraph(f"Our View: {call}", call_style))
        story.append(Spacer(1, 8))
        upside = round((target - entry) / entry * 100, 1) if entry > 0 and target else 0
        rows = [["Buy At", "Target", "Stop Loss", "Expected Return", "Time Frame"],
                [f"Rs.{entry:,.0f}" if entry else "-", f"Rs.{target:,.0f}" if target else "-",
                 f"Rs.{sl:,.0f}" if sl else "-", f"+{upside}%" if upside > 0 else f"{upside}%", horizon]]
        pt = Table(rows, colWidths=[90, 90, 90, 100, 90])
        pt.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#0d47a1')),('TEXTCOLOR',(0,0),(-1,0),colors.white),
            ('FONTNAME',(0,0),(-1,-1),'Helvetica'),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),10),
            ('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#b0bec5')),('ALIGN',(0,0),(-1,-1),'CENTER'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
        story.append(pt)
        story.append(Spacer(1, 10))
        story.append(Paragraph("Why This Stock?", styles['RSec']))
        narr = ""
        alpha = tech.get("alpha_metrics", {}) or {}
        if alpha.get("alphascore"): narr += f"{company} scores {alpha['alphascore']}/100 on AlphaMarket Stock 360 ({alpha.get('grade','')}: {alpha.get('signal','')}). "
        if alpha.get("confluence_pct"): narr += f"Confluence shows {alpha['confluence_pct']}% conviction with {alpha.get('active_signals',0)} signals agreeing. "
        if alpha.get("smart_money_verdict"): narr += f"Institutional flow: {alpha['smart_money_verdict'].lower()}. "
        if not narr: narr = _sanitize_for_pdf(rationale[:300]) if rationale else f"{sym} meets our criteria."
        story.append(Paragraph(_sanitize_for_pdf(narr), styles['RBody']))
        story.append(Spacer(1, 8))
        kn = []
        pe_v = fund.get("pe_ratio", 0)
        if pe_v and pe_v > 0: kn.append(f"P/E: {pe_v:.1f}")
        roe_v = fund.get("roe", 0)
        if roe_v and roe_v > 0: kn.append(f"ROE: {roe_v:.1f}%")
        ph_v = fund.get("promoter_holding", 0)
        if ph_v: kn.append(f"Promoter: {ph_v:.1f}%")
        rsi_v = tech.get("rsi", 0)
        if rsi_v: kn.append(f"RSI: {rsi_v:.0f}")
        if kn:
            story.append(Paragraph(f"<b>Key Numbers:</b> {' | '.join(kn)}", styles['RBody']))
        story.append(Spacer(1, 12))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#cccccc'), spaceAfter=6))
        story.append(Paragraph("<b>DISCLAIMER:</b> Not a guarantee of returns. Investments subject to market risks. Consult your advisor.", styles['RDisc']))
        doc.build(story)
        return output_path

    # ════ RESEARCH NOTE (2-page concise) ════
    if template == "research_note":
        story.append(Paragraph("RESEARCH NOTE", styles['RTitle']))
        sub = [f"Date: {date_str}"]
        advisor = report.get("advisor_name", "")
        if advisor: sub.append(f"Analyst: {advisor}")
        story.append(Paragraph(" | ".join(sub), styles['RSub']))
        story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor('#e84215'), spaceAfter=10))
        company = fund.get("name", sym)
        sector_v = fund.get("sector", "")
        call_style = styles['RBuy'] if call == 'BUY' else styles['RSell']
        story.append(Paragraph(f"<b>{company}</b> (NSE: {sym}){' | '+sector_v if sector_v else ''}", styles['RSec']))
        story.append(Paragraph(f"{call} | Entry: Rs.{entry:,.0f} | Target: Rs.{target:,.0f} | SL: Rs.{sl:,.0f} | {horizon}", call_style))
        story.append(Spacer(1, 8))
        alpha = tech.get("alpha_metrics", {}) or {}
        if alpha.get("alphascore"):
            dims = alpha.get("dimensions", {})
            dim_txt = ", ".join([f"{k.replace('_',' ').title()}: {v:.0f}" for k,v in dims.items()]) if dims else ""
            story.append(Paragraph(f"<b>AlphaScore: {alpha['alphascore']}/100 ({alpha.get('grade','')}: {alpha.get('signal','')})</b>", styles['RBody']))
            if dim_txt: story.append(Paragraph(_sanitize_for_pdf(f"Dimensions: {dim_txt}"), styles['RLabel']))
            story.append(Spacer(1, 4))
        if alpha.get("confluence_pct"):
            sigs = ", ".join(alpha.get("confluence_signals", [])[:4])
            story.append(Paragraph(f"<b>Confluence: {alpha['confluence_pct']}% ({alpha.get('confluence_conviction','')})</b> - {alpha.get('active_signals',0)} signals: {sigs}", styles['RBody']))
            story.append(Spacer(1, 4))
        if alpha.get("smart_money_score"):
            story.append(Paragraph(f"<b>Smart Money: {alpha['smart_money_score']}/100 ({alpha.get('smart_money_verdict','')})</b>", styles['RBody']))
            story.append(Spacer(1, 4))
        scr_list = alpha.get("screener_appearances", [])
        if scr_list:
            scr_names = [s.replace("_"," ").title() for s in scr_list]
            story.append(Paragraph(f"<b>In {len(scr_list)} screeners:</b> {', '.join(scr_names)}", styles['RBody']))
            story.append(Spacer(1, 6))
        story.append(Paragraph("Investment Thesis", styles['RSec']))
        story.append(Paragraph(_sanitize_for_pdf(rationale.replace("CONCLUSION:","").replace("TECHNICAL:","").replace("FUNDAMENTAL:","").strip()), styles['RBody']))
        story.append(Spacer(1, 6))
        fund_parts = []
        pe_v = fund.get("pe_ratio", 0)
        if pe_v and pe_v > 0: fund_parts.append(f"P/E {pe_v:.1f}")
        roe_v = fund.get("roe", 0)
        if roe_v: fund_parts.append(f"ROE {roe_v:.1f}%")
        eg = fund.get("earnings_growth", 0)
        if eg: fund_parts.append(f"EPS Growth {eg:.0f}%")
        ph_v = fund.get("promoter_holding", 0)
        if ph_v: fund_parts.append(f"Promoter {ph_v:.1f}%")
        if fund_parts: story.append(Paragraph(f"<b>Fundamentals:</b> {' | '.join(fund_parts)}", styles['RBody']))
        tech_parts = []
        rsi_v = tech.get("rsi", 0)
        if rsi_v: tech_parts.append(f"RSI {rsi_v:.0f}")
        tech_parts.append("Above 200DMA" if tech.get("above_200dma") else "Below 200DMA")
        story.append(Paragraph(f"<b>Technicals:</b> {' | '.join(tech_parts)}", styles['RBody']))
        story.append(Spacer(1, 10))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#cccccc'), spaceAfter=6))
        story.append(Paragraph(f"<b>DISCLAIMER:</b> For informational purposes only. Past performance does not guarantee future results. Investments subject to market risks.", styles['RDisc']))
        story.append(Paragraph(f"Generated: {date_str} | AlphaLab - alphamarket.co.in", styles['RDisc']))
        doc.build(story)
        return output_path

    # ════ PROFESSIONAL & INSTITUTIONAL (full report continues below) ════
    is_inst = template == "institutional"

    # ── PROPRIETARY INTELLIGENCE ──
    alpha = tech.get("alpha_metrics", {}) or {}
    if alpha.get("alphascore") or alpha.get("confluence_pct") or alpha.get("smart_money_score"):
        story.append(Paragraph("ALPHAMARKET PROPRIETARY INTELLIGENCE", styles['RSec']))
        asc_v = alpha.get("alphascore", 0)
        grade = alpha.get("grade", "")
        sig = alpha.get("signal", "")
        dims = alpha.get("dimensions", {})
        cf_pct = alpha.get("confluence_pct", 0)
        conv = alpha.get("confluence_conviction", "")
        n_sig = alpha.get("active_signals", 0)
        sms_v = alpha.get("smart_money_score", 0)
        verdict = alpha.get("smart_money_verdict", "")

        if is_inst:
            # INSTITUTIONAL: Data tables
            intel_rows = [["Metric", "Score", "Rating", "Detail"]]
            if asc_v:
                best_d = max(dims, key=dims.get).replace("_"," ").title() if dims else "-"
                worst_d = min(dims, key=dims.get).replace("_"," ").title() if dims else "-"
                intel_rows.append(["AlphaScore", f"{asc_v}/100", f"{grade} ({sig})", f"Best: {best_d} | Weakest: {worst_d}"])
            if cf_pct:
                sigs_list = alpha.get("confluence_signals", [])
                intel_rows.append(["Confluence", f"{cf_pct}%", conv, f"{n_sig} signals: {', '.join(sigs_list[:3])}"])
            if sms_v:
                intel_rows.append(["Smart Money", f"{sms_v}/100", verdict, ""])
            if alpha.get("pattern_verdict"):
                intel_rows.append(["Patterns", f"{alpha.get('pattern_score',0)}/100", alpha["pattern_verdict"], f"Bull: {alpha.get('bullish_signals',0)} | Bear: {alpha.get('bearish_signals',0)}"])
            if alpha.get("screener_count"):
                intel_rows.append(["Screener Visibility", f"{alpha['screener_count']}/34", "", ", ".join([s.replace('_',' ').title() for s in alpha.get('screener_appearances',[])[:5]])])

            if len(intel_rows) > 1:
                it = Table(intel_rows, colWidths=[100, 65, 85, 210])
                it.setStyle(TableStyle([
                    ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#0d47a1')),('TEXTCOLOR',(0,0),(-1,0),colors.white),
                    ('FONTNAME',(0,0),(-1,-1),'Helvetica'),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),
                    ('FONTSIZE',(0,0),(-1,-1),9),('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#b0bec5')),
                    ('ALIGN',(1,0),(2,-1),'CENTER'),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
                ]))
                story.append(it)
                story.append(Spacer(1, 8))

            # Dim breakdown table
            if dims:
                dim_rows = [["Dimension", "Score", "Bar"]]
                for dk, dv in sorted(dims.items(), key=lambda x: x[1], reverse=True):
                    bar = "|" * int(dv / 5)
                    dim_rows.append([dk.replace("_"," ").title(), f"{dv:.0f}/100", bar])
                dt = Table(dim_rows, colWidths=[120, 70, 270])
                dt.setStyle(TableStyle([
                    ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#263238')),('TEXTCOLOR',(0,0),(-1,0),colors.white),
                    ('FONTNAME',(0,0),(-1,-1),'Helvetica'),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),
                    ('FONTSIZE',(0,0),(-1,-1),9),('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#ccc')),
                    ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),
                ]))
                story.append(dt)
                story.append(Spacer(1, 8))

            # Institutional tech/fund data tables
            tech_rows = [["Indicator", "Value", "Signal"]]
            tp = tech.get("price", 0)
            if tp: tech_rows.append(["Current Price", f"Rs.{tp:,.1f}", ""])
            s50 = tech.get("sma_50", 0)
            if s50: tech_rows.append(["50 DMA", f"Rs.{s50:,.1f}", "Above" if tp > s50 else "Below"])
            s200 = tech.get("sma_200", 0)
            if s200: tech_rows.append(["200 DMA", f"Rs.{s200:,.1f}", "Above" if tp > s200 else "Below"])
            rsi_v = tech.get("rsi", 0)
            if rsi_v: tech_rows.append(["RSI (14)", f"{rsi_v:.1f}", "Overbought" if rsi_v > 70 else "Oversold" if rsi_v < 30 else "Neutral"])
            mh = tech.get("macd_hist", 0)
            if mh: tech_rows.append(["MACD Histogram", f"{mh:.2f}", "Bullish" if mh > 0 else "Bearish"])
            vr = tech.get("vol_ratio", 0)
            if vr: tech_rows.append(["Volume Ratio", f"{vr:.1f}x", "High" if vr > 1.5 else "Normal"])
            rs3 = tech.get("rs_3m", 0)
            if rs3: tech_rows.append(["3M Rel. Strength", f"{rs3:.1f}%", "Outperforming" if rs3 > 0 else "Underperforming"])
            w52h = tech.get("w52_high", 0)
            if w52h and tp: tech_rows.append(["52-Week High", f"Rs.{w52h:,.1f}", f"{((tp/w52h-1)*100):.1f}% from high"])
            if len(tech_rows) > 1:
                story.append(Paragraph("TECHNICAL DATA", styles['RSec']))
                tt = Table(tech_rows, colWidths=[130, 110, 220])
                tt.setStyle(TableStyle([
                    ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#0d47a1')),('TEXTCOLOR',(0,0),(-1,0),colors.white),
                    ('FONTNAME',(0,0),(-1,-1),'Helvetica'),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),
                    ('FONTSIZE',(0,0),(-1,-1),9),('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#b0bec5')),
                    ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
                ]))
                story.append(tt)
                story.append(Spacer(1, 8))

            fund_rows = [["Metric", "Value", "Assessment"]]
            pe_v = fund.get("pe_ratio", 0)
            if pe_v and pe_v > 0: fund_rows.append(["P/E Ratio", f"{pe_v:.1f}x", "Expensive" if pe_v > 40 else "Moderate" if pe_v > 20 else "Cheap"])
            roe_v = fund.get("roe", 0)
            if roe_v: fund_rows.append(["Return on Equity", f"{roe_v:.1f}%", "Excellent" if roe_v > 20 else "Good" if roe_v > 12 else "Average"])
            dy = fund.get("dividend_yield", 0)
            if dy: fund_rows.append(["Dividend Yield", f"{dy:.1f}%", "Income support" if dy > 2 else "Modest"])
            de = fund.get("debt_equity", 0)
            if de: fund_rows.append(["Debt/Equity", f"{de:.2f}", "Conservative" if de < 1 else "Moderate" if de < 2 else "High leverage"])
            mc = fund.get("market_cap", 0)
            if mc:
                if mc > 1e12: cap_s = f"Rs.{mc/1e12:.0f}T"
                elif mc > 1e9: cap_s = f"Rs.{mc/1e9:.0f}B"
                else: cap_s = f"Rs.{mc/1e7:.0f}Cr"
                fund_rows.append(["Market Cap", cap_s, fund.get("cap_segment", "Large Cap") if mc > 2e11 else "Mid Cap" if mc > 5e10 else "Small Cap"])
            pm = fund.get("profit_margin", 0)
            if pm: fund_rows.append(["Profit Margin", f"{pm:.1f}%", "Strong" if pm > 15 else "Moderate" if pm > 8 else "Thin"])
            eg = fund.get("earnings_growth", 0)
            if eg: fund_rows.append(["Earnings Growth", f"{eg:.1f}%", "High growth" if eg > 20 else "Steady" if eg > 5 else "Declining"])
            ph = fund.get("promoter_holding", 0)
            if ph: fund_rows.append(["Promoter Holding", f"{ph:.1f}%", "Strong" if ph > 60 else "Moderate" if ph > 40 else "Low"])
            if len(fund_rows) > 1:
                story.append(Paragraph("FUNDAMENTAL DATA", styles['RSec']))
                ft = Table(fund_rows, colWidths=[130, 110, 220])
                ft.setStyle(TableStyle([
                    ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#0d47a1')),('TEXTCOLOR',(0,0),(-1,0),colors.white),
                    ('FONTNAME',(0,0),(-1,-1),'Helvetica'),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),
                    ('FONTSIZE',(0,0),(-1,-1),9),('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#b0bec5')),
                    ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
                ]))
                story.append(ft)
                story.append(Spacer(1, 8))

            # Assessment scores table
            vs = alpha.get("value_score", 0)
            gs = alpha.get("growth_score", 0)
            qs = alpha.get("quality_score", 0)
            if vs or gs or qs:
                story.append(Paragraph("VALUE / GROWTH / QUALITY ASSESSMENT", styles['RSec']))
                ass_rows = [["Type", "Score", "Verdict"]]
                if vs: ass_rows.append(["Value", f"{vs}/100", alpha.get("value_verdict", "")])
                if gs: ass_rows.append(["Growth", f"{gs}/100", alpha.get("growth_verdict", "")])
                if qs: ass_rows.append(["Quality", f"{qs}/100", alpha.get("quality_verdict", "")])
                at = Table(ass_rows, colWidths=[130, 110, 220])
                at.setStyle(TableStyle([
                    ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#263238')),('TEXTCOLOR',(0,0),(-1,0),colors.white),
                    ('FONTNAME',(0,0),(-1,-1),'Helvetica'),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),
                    ('FONTSIZE',(0,0),(-1,-1),9),('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#ccc')),
                    ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
                ]))
                story.append(at)
                story.append(Spacer(1, 8))
        else:
            # PROFESSIONAL: Narrative style (existing)
            intel_narr = ""
            if asc_v:
                intel_narr += f"AlphaMarket Stock 360 rates {sym} at {asc_v}/100 (Grade: {grade}, Signal: {sig}). "
                if dims:
                    best = max(dims, key=dims.get)
                    worst = min(dims, key=dims.get)
                    intel_narr += f"Strongest: {best.replace('_',' ').title()} at {dims[best]:.0f}/100. "
                    intel_narr += f"Needs attention: {worst.replace('_',' ').title()} at {dims[worst]:.0f}/100. "
            if cf_pct:
                intel_narr += f"Confluence Engine: {cf_pct}% ({conv}) with {n_sig} signals active. "
                sigs = alpha.get("confluence_signals", [])
                if sigs: intel_narr += f"Signals: {', '.join(sigs[:4])}. "
            if sms_v:
                intel_narr += f"Smart Money: {sms_v}/100 ({verdict}). "
                pos = alpha.get("sm_positives", [])
                risks = alpha.get("sm_risks", [])
                if pos: intel_narr += f"Positive: {'; '.join(pos[:2])}. "
                if risks: intel_narr += f"Risks: {'; '.join(risks[:2])}. "
            if intel_narr:
                story.append(Paragraph(_sanitize_for_pdf(intel_narr), styles['RBody']))
            story.append(Spacer(1, 8))

    # ── SCREENER APPEARANCES ──
    scr_list = alpha.get("screener_appearances", [])
    if scr_list:
        story.append(Paragraph("SCREENER VISIBILITY", styles['RSec']))
        scr_names = [s.replace("_"," ").title() for s in scr_list]
        scr_narr = f"{sym} appears in {len(scr_list)} of 34 screeners: {', '.join(scr_names)}. "
        story.append(Paragraph(_sanitize_for_pdf(scr_narr), styles['RBody']))
        story.append(Spacer(1, 8))

    # ── PATTERN ANALYSIS ──
    if alpha.get("pattern_verdict"):
        story.append(Paragraph("PATTERN ANALYSIS", styles['RSec']))
        pat_narr = f"Pattern analysis: {alpha['pattern_verdict']} with {alpha.get('bullish_signals',0)} bullish and {alpha.get('bearish_signals',0)} bearish signals. "
        story.append(Paragraph(_sanitize_for_pdf(pat_narr), styles['RBody']))
        story.append(Spacer(1, 8))

        # ── Rationale ──
    story.append(Paragraph("INVESTMENT RATIONALE", styles['RSec']))
    if "TECHNICAL:" in rationale and "FUNDAMENTAL:" in rationale:
        # Structured rationale with sections
        parts = rationale.split("FUNDAMENTAL:")
        tech_part = parts[0].replace("TECHNICAL:", "").strip()
        fund_part = parts[1].strip() if len(parts) > 1 else ""
        # Split conclusion
        conclusion = ""
        if "CONCLUSION:" in fund_part:
            fp = fund_part.split("CONCLUSION:")
            fund_part = fp[0].strip()
            conclusion = fp[1].strip() if len(fp) > 1 else ""
        elif "CONCLUSION:" in tech_part:
            tp = tech_part.split("CONCLUSION:")
            tech_part = tp[0].strip()
            conclusion = tp[1].strip() if len(tp) > 1 else ""
        if tech_part:
            story.append(Paragraph("<b>Technical View:</b>", styles['RLabel']))
            story.append(Paragraph(_sanitize_for_pdf(tech_part), styles['RBody']))
            story.append(Spacer(1, 4))
        if fund_part:
            story.append(Paragraph("<b>Fundamental View:</b>", styles['RLabel']))
            story.append(Paragraph(_sanitize_for_pdf(fund_part), styles['RBody']))
            story.append(Spacer(1, 4))
        if conclusion:
            story.append(Paragraph("<b>Conclusion:</b>", styles['RLabel']))
            story.append(Paragraph(_sanitize_for_pdf(conclusion), styles['RBody']))
    else:
        # Plain rationale — render once, split conclusion
        rat_text = rationale
        conclusion = ""
        if "CONCLUSION:" in rat_text:
            rp = rat_text.split("CONCLUSION:")
            rat_text = rp[0].strip()
            conclusion = rp[1].strip() if len(rp) > 1 else ""
        if rat_text:
            story.append(Paragraph(_sanitize_for_pdf(rat_text), styles['RBody']))
            story.append(Spacer(1, 4))
        if conclusion:
            story.append(Paragraph("<b>Conclusion:</b>", styles['RLabel']))
            story.append(Paragraph(_sanitize_for_pdf(conclusion), styles['RBody']))
    story.append(Spacer(1, 10))

    # ── Disclaimer ──
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#cccccc'), spaceAfter=6))
    disclaimer = report.get("disclaimer", "") or (
        "DISCLAIMER: This report is prepared by a SEBI Registered Investment Advisor for informational purposes only. "
        "The recommendations are based on technical and fundamental analysis and do not constitute a guarantee of returns. "
        "Past performance is not indicative of future results. Investors are advised to conduct their own due diligence "
        "and consult with their financial advisor before making investment decisions. The advisor and firm shall not be "
        "responsible for any losses arising from the use of this report. Investments in securities market are subject to "
        "market risks. Read all related documents carefully before investing. "
        f"Generated via AlphaLab on {date_str}."
    )
    story.append(Paragraph("<b>IMPORTANT DISCLAIMER</b>", styles['RLabel']))
    story.append(Paragraph(_sanitize_for_pdf(disclaimer), styles['RDisc']))
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"Report ID: {report.get('id','')} | Generated: {date_str} | AlphaLab - alphamarket.co.in", styles['RDisc']))

    doc.build(story)
    return output_path


@app.get("/api/advisory/pdf-templates", tags=["Advisory & Reports"])
async def get_pdf_templates():
    """List available PDF report templates."""
    return [
        {"id": "professional", "name": "Professional Advisory", "description": "Full SEBI-compliant report with proprietary intelligence, narrative analysis, and detailed fundamentals.", "pages": "3-5"},
        {"id": "research_note", "name": "Research Note", "description": "Concise 2-page research brief with AlphaScore, Confluence signals, screener visibility, and key metrics.", "pages": "1-2"},
        {"id": "institutional", "name": "Institutional Brief", "description": "Data-heavy report with tables for all metrics, proprietary scores, and detailed technical/fundamental breakdowns.", "pages": "3-5"},
        {"id": "client_summary", "name": "Client Summary", "description": "Simple 1-page summary in plain language. Key numbers, our view, and why.", "pages": "1"},
    ]


@app.post("/api/advisory/report", tags=["Advisory & Reports"], summary="Create advisory report",
    description="Create a new SEBI-compliant advisory report. Stores report content, type, and metadata for regulatory audit trail.")
async def create_advisory_report(req: dict, user=Depends(get_current_user)):
    """Create a new advisory report."""
    async with db_pool.acquire() as conn:
        report_id = await conn.fetchval("""
            INSERT INTO advisory_reports (user_id, title, report_type, advisor_name, ria_reg_no, disclaimer)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        """, user["id"], req.get("title", "Advisory Report"),
           req.get("report_type", "screener"),
           req.get("advisor_name", user.get("name", "")),
           req.get("ria_reg_no", ""),
           req.get("disclaimer", ""))
    return {"id": report_id, "message": "Report created"}


@app.get("/api/symbols/price/{symbol}", tags=["Stock Data"], summary="Get current stock price",
    description="Get the current/latest price for a single stock symbol.")
async def get_symbol_price(symbol: str, user=Depends(get_current_user)):
    """Get current price of a symbol via data service."""
    try:
        q = await ds_quote(symbol)
        if q and q.get("price"):
            return {"symbol": symbol.upper(), "price": round(q["price"], 2), "change_pct": round(q.get("change_pct", 0), 2)}
    except: pass
    return {"symbol": symbol.upper(), "price": 0}


@app.post("/api/advisory/recommend", tags=["Advisory & Reports"], summary="Create stock recommendation",
    description="Create a BUY/SELL/HOLD recommendation for a stock with entry price, target, stop-loss, timeframe, and rationale. Timestamped for SEBI compliance.")
async def add_recommendation(req: dict, user=Depends(get_current_user)):
    """Add a stock recommendation with auto-generated rationale."""

    symbol = req.get("symbol", "").upper()
    call_type = req.get("call_type", "BUY").upper()
    report_id = req.get("report_id")

    if not symbol:
        raise HTTPException(status_code=400, detail="Symbol required")

    # Auto-create report if not provided
    if not report_id:
        async with db_pool.acquire() as conn:
            report_id = await conn.fetchval("""
                INSERT INTO advisory_reports (user_id, title, report_type, advisor_name)
                VALUES ($1, $2, 'individual', $3) RETURNING id
            """, user["id"], f"Advisory - {datetime.utcnow().strftime('%d %b %Y')}",
               user.get("name", ""))

    # Fetch technical data
    loop = asyncio.get_event_loop()
    tech_data = {}
    fund_data = {}
    try:
        _rows = await ds_ohlcv(symbol, "1y")
        if _rows:
            hist = pd.DataFrame(_rows)
            hist.columns = [c.lower() for c in hist.columns]
            for dc in ["date","datetime","timestamp"]:
                if dc in hist.columns:
                    hist[dc] = pd.to_datetime(hist[dc])
                    hist = hist.set_index(dc)
                    break
        else:
            hist = pd.DataFrame()
        if not hist.empty:
            c = hist["close"]
            price = float(c.iloc[-1])
            sma_50 = float(c.rolling(50).mean().iloc[-1]) if len(c) >= 50 else price
            sma_200 = float(c.rolling(200).mean().iloc[-1]) if len(c) >= 200 else price

            # RSI
            delta = c.diff()
            gain = delta.clip(lower=0).rolling(14).mean()
            loss = (-delta.clip(upper=0)).rolling(14).mean()
            rs = gain / loss
            rsi = float(100 - (100 / (1 + rs)).iloc[-1]) if not loss.iloc[-1] == 0 else 50

            # MACD
            ema12 = c.ewm(span=12).mean()
            ema26 = c.ewm(span=26).mean()
            macd_line = ema12 - ema26
            macd_signal = macd_line.ewm(span=9).mean()
            macd_cross_up = float(macd_line.iloc[-1]) > float(macd_signal.iloc[-1]) and float(macd_line.iloc[-2]) <= float(macd_signal.iloc[-2])

            vol_avg = hist["volume"].rolling(20).mean().iloc[-1]
            vol_ratio = round(float(hist["volume"].iloc[-1]) / float(vol_avg), 2) if vol_avg > 0 else 1

            c252 = c.iloc[-min(252, len(c)):]
            rs_3m = round(float(c.iloc[-1] / c.iloc[-min(60, len(c))] - 1) * 100, 1) if len(c) > 60 else 0

            tech_data = {
                "price": round(price, 2), "sma_50": round(sma_50, 2), "sma_200": round(sma_200, 2),
                "rsi": round(rsi, 1), "above_200dma": price > sma_200, "above_50dma": price > sma_50,
                "macd_cross_up": macd_cross_up, "macd_hist": round(float((macd_line - macd_signal).iloc[-1]), 2),
                "vol_ratio": vol_ratio, "rs_3m": rs_3m,
                "golden_cross": False, "death_cross": False,
                "minervini_score": sum([price > sma_50, price > sma_200, sma_50 > sma_200]),
                "w52_high": round(float(c252.max()), 2), "w52_low": round(float(c252.min()), 2),
            }

        fdata = await ds_fundamentals(symbol)
        if fdata:
            def sf(v, d=0):
                try: v=float(v); return d if (v!=v or v==float('inf')) else v
                except: return d
            pe = sf(fdata.get("pe_trailing") or fdata.get("pe_forward") or fdata.get("pe_ratio", 0))
            roe_val = sf(fdata.get("roe", 0))
            roe = roe_val * 100 if roe_val and roe_val < 1 else roe_val
            dy = sf(fdata.get("dividend_yield", 0))
            fund_data = {
                "pe_ratio": round(pe, 2),
                "roe": round(roe, 2),
                "dividend_yield": round(dy, 2),
                "debt_equity": round(sf(fdata.get("debt_equity", 0)), 2),
                "market_cap": sf(fdata.get("market_cap", 0)),
                "sector": fdata.get("sector", ""),
                "name": fdata.get("name", symbol),
                "pb": round(sf(fdata.get("pb", 0)), 2),
                "profit_margin": round(sf(fdata.get("profit_margin", 0)), 2),
            }
    except Exception as e:
        print(f"Data fetch error for {symbol}: {e}")

    # ── Enrich with proprietary metrics (AlphaScore, Confluence, Smart Money) ──
    alpha_data = {}
    try:
        s360 = await stock360(symbol, user)
        if s360 and "alphascore" in s360:
            asc = s360.get("alphascore", {})
            alpha_data["alphascore"] = round(asc.get("alphascore", 0), 1)
            alpha_data["grade"] = asc.get("grade", "")
            alpha_data["signal"] = asc.get("signal", "")
            alpha_data["dimensions"] = asc.get("dimensions", {})
        if s360 and "confluence" in s360:
            cf = s360.get("confluence", {})
            alpha_data["confluence_pct"] = cf.get("probability", 0)
            alpha_data["confluence_conviction"] = cf.get("conviction", "")
            alpha_data["active_signals"] = cf.get("active_signal_count", 0)
            alpha_data["signal_categories"] = cf.get("category_diversity", 0)
            alpha_data["confluence_signals"] = [s.get("name","") for s in cf.get("active_signals", [])[:6]]
        if s360 and "smart_money" in s360:
            sm = s360.get("smart_money", {})
            alpha_data["smart_money_score"] = round(sm.get("smart_money_score", 0), 1)
            alpha_data["smart_money_verdict"] = sm.get("verdict", "")
            alpha_data["sm_positives"] = [s.get("text","") for s in sm.get("positive_signals", [])[:3]]
            alpha_data["sm_risks"] = [s.get("text","") for s in sm.get("risk_flags", [])[:3]]
        if s360 and "patterns" in s360:
            pt = s360.get("patterns", {})
            alpha_data["pattern_verdict"] = pt.get("verdict", "")
            alpha_data["pattern_score"] = pt.get("score", 0)
            alpha_data["bullish_signals"] = pt.get("bullish_signals", 0)
            alpha_data["bearish_signals"] = pt.get("bearish_signals", 0)
        if s360 and "alphaview" in s360:
            av = s360.get("alphaview", {})
            assess = av.get("assessment", {})
            alpha_data["value_score"] = assess.get("value_score", 0)
            alpha_data["growth_score"] = assess.get("growth_score", 0)
            alpha_data["quality_score"] = assess.get("quality_score", 0)
            alpha_data["value_verdict"] = assess.get("value_verdict", "")
            alpha_data["growth_verdict"] = assess.get("growth_verdict", "")
            alpha_data["quality_verdict"] = assess.get("quality_verdict", "")
            avf = av.get("fundamentals", {})
            for fk in ["pe_forward","pb","roce","profit_margin","operating_margin","revenue_growth","earnings_growth","promoter_holding","book_value","eps","dividend_yield","debt_equity","pe_trailing"]:
                if avf.get(fk): fund_data[fk] = avf[fk]
            if not fund_data.get("pe_ratio") and avf.get("pe_trailing"): fund_data["pe_ratio"] = avf["pe_trailing"]
            if not fund_data.get("pe_ratio") and avf.get("pe_forward"): fund_data["pe_ratio"] = avf["pe_forward"]
            if not fund_data.get("roe") and avf.get("roce"): fund_data["roe"] = avf["roce"]
            if not fund_data.get("name"):
                fund_data["name"] = av.get("name", symbol)
                fund_data["sector"] = av.get("sector", "")
                fund_data["market_cap"] = av.get("summary", {}).get("market_cap", 0)
            if not tech_data.get("price"):
                summ = av.get("summary", {})
                mavg = av.get("moving_averages", {})
                tch = av.get("technicals", {})
                tech_data["price"] = summ.get("price", 0)
                tech_data["sma_50"] = mavg.get("sma50", 0)
                tech_data["sma_200"] = mavg.get("sma200", 0)
                tech_data["rsi"] = tch.get("rsi", 50)
                tech_data["above_200dma"] = mavg.get("above_200dma", False)
                tech_data["above_50dma"] = mavg.get("above_50dma", False)
                tech_data["macd_hist"] = tch.get("macd_histogram", 0)
                tech_data["vol_ratio"] = summ.get("volume_ratio", 1)
                tech_data["w52_high"] = summ.get("high_52w", 0)
                tech_data["w52_low"] = summ.get("low_52w", 0)
            rs = av.get("relative_strength", {})
            if rs:
                tech_data["rs_1m"] = rs.get("rs_1m", 0)
                tech_data["rs_3m"] = rs.get("rs_3m", 0)
                tech_data["rs_6m"] = rs.get("rs_6m", 0)
    except Exception as _e360:
        print(f"Stock360 enrichment error for {symbol}: {_e360}")

    # ── Scan screener appearances ──
    screener_appearances = []
    try:
        if redis_client:
            all_scr_keys = await redis_client.keys("screener:*")
            for sk in all_scr_keys:
                scr_cached = await redis_client.get(sk)
                if scr_cached:
                    scr_data = json.loads(scr_cached)
                    scr_stocks = scr_data.get("stocks", scr_data) if isinstance(scr_data, dict) else scr_data
                    if isinstance(scr_stocks, list):
                        for ss in scr_stocks:
                            if ss.get("symbol") == symbol:
                                scr_name = sk.split(":")[1] if ":" in sk else sk
                                screener_appearances.append(scr_name)
                                break
        alpha_data["screener_appearances"] = screener_appearances
        alpha_data["screener_count"] = len(screener_appearances)
    except:
        pass

    tech_data["alpha_metrics"] = alpha_data

    # Generate rationale — include screener strategy context if available
    rationale_type = req.get("rationale_type", "quantamental")
    screener_strategy = req.get("screener_strategy", "")
    screener_signals = req.get("signals", {})

    # Build screener context prefix
    screener_prefix = ""
    if screener_strategy:
        strategy_descriptions = {
            "momentum": f"{symbol} was identified by the Momentum Screener. The stock shows strong price momentum with consistent higher highs and higher lows, indicating institutional accumulation.",
            "oversold": f"{symbol} was flagged by the Oversold Screener. RSI has dropped to deeply oversold levels, historically a zone where sharp reversals occur in quality stocks.",
            "overbought": f"{symbol} was flagged by the Overbought Screener. RSI is in overbought territory, suggesting the stock may be due for a pullback or consolidation.",
            "breakout": f"{symbol} was detected by the Breakout Screener. The stock is breaking above key resistance levels with increasing volume, a classic sign of trend continuation.",
            "golden_cross": f"{symbol} triggered a Golden Cross signal. The 50-day moving average has crossed above the 200-day moving average, one of the most reliable long-term bullish signals.",
            "death_cross": f"{symbol} triggered a Death Cross signal. The 50-day moving average has crossed below the 200-day moving average, a bearish structural signal.",
            "bb_squeeze": f"{symbol} was identified by the Bollinger Band Squeeze Screener. Narrowing bands indicate compressed volatility, often preceding a significant directional move.",
            "minervini": f"{symbol} passes the Mark Minervini Trend Template criteria. The stock exhibits Stage 2 uptrend characteristics: price above key moving averages, rising earnings momentum, and strong relative strength.",
            "pullback_buy": f"{symbol} was flagged by the Pullback Buy Screener. The stock has pulled back to key support levels within an ongoing uptrend, offering a favourable risk-reward entry.",
            "volume": f"{symbol} was detected by the Volume Surge Screener. Abnormally high trading volume suggests significant institutional activity or a catalyst-driven move.",
            "up_on_volume": f"{symbol} was identified by the Up-on-Volume Screener. Price advance accompanied by heavy volume indicates strong buying conviction.",
            "relative_strength": f"{symbol} ranks high on Relative Strength. The stock is outperforming the broader market significantly over the past 1-3 months.",
            "trend_strong": f"{symbol} was identified by the Strong Trend Screener. ADX above 25 confirms a well-established directional trend with high probability of continuation.",
            "52w_high": f"{symbol} is trading near its 52-week high. Stocks making new highs tend to continue higher, especially when backed by strong fundamentals.",
            "52w_low": f"{symbol} is near its 52-week low. This could represent a deep value opportunity if fundamentals remain intact.",
            "macd_crossover": f"{symbol} has triggered a MACD bullish crossover. The MACD line crossing above the signal line is a widely followed buy signal.",
            "macd_bearish": f"{symbol} shows a bearish MACD signal. The MACD line has crossed below the signal line, indicating weakening momentum.",
            "supertrend_buy": f"{symbol} is trading above the Supertrend indicator, confirming bullish trend continuation with defined trailing support.",
            "growth_momentum": f"{symbol} was identified by the Growth Momentum Screener. The stock combines strong earnings growth with positive price momentum.",
            "safe_haven": f"{symbol} qualifies as a Safe Haven pick. Low volatility, consistent dividends, and strong balance sheet make it suitable for conservative portfolios.",
            "high_roe": f"{symbol} ranks among high ROE stocks, indicating superior management efficiency in generating returns on shareholder equity.",
            "low_pe": f"{symbol} was flagged by the Low PE Screener. Trading at an attractive earnings multiple relative to peers, suggesting potential undervaluation.",
            "dividend_yield": f"{symbol} offers an attractive dividend yield, providing regular income alongside potential capital appreciation.",
            "sector_rotation": f"{symbol} was identified by the Sector Rotation Screener. The stock belongs to a sector showing improving relative strength and fund flows.",
            "multi_timeframe": f"{symbol} shows bullish alignment across multiple timeframes (daily, weekly), a high-conviction setup when both trends agree.",
            "gap_up": f"{symbol} opened with a significant gap up, indicating strong overnight buying interest or a positive catalyst.",
            "gap_down": f"{symbol} gapped down significantly, which may present a mean-reversion opportunity if fundamentals remain sound.",
            "range_breakout": f"{symbol} has broken out of a well-defined trading range, suggesting the start of a new trending move.",
            "recent_breakout": f"{symbol} recently broke through key resistance. Fresh breakouts with volume confirmation offer high-probability trade setups.",
            "turnaround": f"{symbol} was identified by the Turnaround Screener. The stock shows early signs of recovery from a prolonged downtrend.",
            "volume_dry": f"{symbol} exhibits a volume dry-up pattern. Decreasing volume during consolidation often precedes a breakout.",
            "high_beta": f"{symbol} is a high-beta stock, offering amplified returns in bullish markets but requiring disciplined risk management.",
        }
        screener_prefix = strategy_descriptions.get(screener_strategy, f"{symbol} was identified by the {screener_strategy.replace('_',' ').title()} strategy screener.")

    rationale = req.get("rationale", "")
    if not rationale:
        base_rationale = generate_rationale(symbol, call_type, tech_data, fund_data, rationale_type)
        rationale = (screener_prefix + " " + base_rationale).strip() if screener_prefix else base_rationale
    entry_price = req.get("entry_price") or tech_data.get("price", 0)
    target_price = req.get("target_price") or (entry_price * 1.15 if call_type == "BUY" else entry_price * 0.85)
    stop_loss = req.get("stop_loss") or (entry_price * 0.92 if call_type == "BUY" else entry_price * 1.08)

    async with db_pool.acquire() as conn:
        rec_id = await conn.fetchval("""
            INSERT INTO advisory_recommendations
            (report_id, user_id, symbol, call_type, entry_price, target_price, stop_loss,
             time_horizon, rationale, technical_data, fundamental_data)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id
        """, report_id, user["id"], symbol, call_type,
           entry_price, target_price, stop_loss,
           req.get("time_horizon", "short_term"), rationale,
           json.dumps(tech_data), json.dumps(fund_data))

    return {
        "id": rec_id, "report_id": report_id, "symbol": symbol,
        "call_type": call_type, "rationale": rationale,
        "entry_price": round(entry_price, 2),
        "target_price": round(target_price, 2),
        "stop_loss": round(stop_loss, 2),
        "technical_data": tech_data, "fundamental_data": fund_data,
    }


@app.put("/api/advisory/recommend/{rec_id}", tags=["Advisory & Reports"], summary="Update recommendation",
    description="Update an existing recommendation — modify target, stop-loss, or status (open/achieved/stopped_out/closed).")
async def update_recommendation(rec_id: int, req: dict, user=Depends(get_current_user)):
    """Update rationale or prices for a recommendation."""
    updates = []
    params = [rec_id, user["id"]]
    idx = 3
    for field in ["rationale", "call_type", "entry_price", "target_price", "stop_loss", "time_horizon"]:
        if field in req:
            updates.append(f"{field}=${idx}")
            params.append(req[field])
            idx += 1
    if "rationale" in req:
        updates.append(f"rationale_edited=true")

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    async with db_pool.acquire() as conn:
        await conn.execute(
            f"UPDATE advisory_recommendations SET {', '.join(updates)} WHERE id=$1 AND user_id=$2",
            *params
        )
    return {"message": "Updated", "id": rec_id}


@app.delete("/api/advisory/recommend/{rec_id}", tags=["Advisory & Reports"], summary="Delete recommendation",
    description="Delete an advisory recommendation.")
async def delete_recommendation(rec_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM advisory_recommendations WHERE id=$1 AND user_id=$2", rec_id, user["id"])
    return {"message": "Deleted"}


@app.get("/api/advisory/reports", tags=["Advisory & Reports"], summary="List advisory reports",
    description="List all advisory reports created by the authenticated user, sorted by most recent.")
async def list_advisory_reports(user=Depends(get_current_user)):
    """List all advisory reports for the user."""
    async with db_pool.acquire() as conn:
        reports = await conn.fetch("""
            SELECT r.*, COUNT(rec.id) as rec_count
            FROM advisory_reports r
            LEFT JOIN advisory_recommendations rec ON rec.report_id = r.id
            WHERE r.user_id = $1
            GROUP BY r.id ORDER BY r.created_at DESC LIMIT 50
        """, user["id"])
    return [dict(r) for r in reports]


@app.get("/api/advisory/report/{report_id}", tags=["Advisory & Reports"], summary="Get advisory report",
    description="Get full details of a specific advisory report by ID.")
async def get_advisory_report(report_id: int, user=Depends(get_current_user)):
    """Get report with all recommendations."""
    async with db_pool.acquire() as conn:
        report = await conn.fetchrow("SELECT * FROM advisory_reports WHERE id=$1 AND user_id=$2", report_id, user["id"])
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        recs = await conn.fetch(
            "SELECT * FROM advisory_recommendations WHERE report_id=$1 ORDER BY created_at", report_id)
    r = dict(report)
    r["created_at"] = r["created_at"].isoformat() if r["created_at"] else ""
    r["recommendations"] = []
    for rec in recs:
        rd = dict(rec)
        rd["created_at"] = rd["created_at"].isoformat() if rd["created_at"] else ""
        rd["technical_data"] = json.loads(rd["technical_data"]) if isinstance(rd["technical_data"], str) else rd["technical_data"]
        rd["fundamental_data"] = json.loads(rd["fundamental_data"]) if isinstance(rd["fundamental_data"], str) else rd["fundamental_data"]
        r["recommendations"].append(rd)
    return r


@app.post("/api/advisory/report/{report_id}/pdf", tags=["Advisory & Reports"], summary="Generate report PDF",
    description="Generate a SEBI-compliant PDF for an advisory report. Returns base64-encoded PDF data ready for download.")
async def generate_report_pdf(report_id: int, req: dict = {}, user=Depends(get_current_user)):
    """Generate individual PDFs for each recommendation in a report."""
    from fastapi.responses import JSONResponse
    import os
    template = req.get("template", "professional") if isinstance(req, dict) else "professional"

    async with db_pool.acquire() as conn:
        report = await conn.fetchrow("SELECT * FROM advisory_reports WHERE id=$1 AND user_id=$2", report_id, user["id"])
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        recs = await conn.fetch(
            "SELECT * FROM advisory_recommendations WHERE report_id=$1 ORDER BY created_at", report_id)

    if not recs:
        raise HTTPException(status_code=400, detail="No recommendations in this report")

    report_dict = dict(report)
    report_dict["created_at"] = report_dict["created_at"].isoformat() if report_dict["created_at"] else ""

    os.makedirs("/tmp/advisory_pdfs", exist_ok=True)
    pdf_paths = []

    async with db_pool.acquire() as conn:
        for rec in recs:
            rd = dict(rec)
            rd["technical_data"] = json.loads(rd["technical_data"]) if isinstance(rd["technical_data"], str) else rd["technical_data"]
            rd["fundamental_data"] = json.loads(rd["fundamental_data"]) if isinstance(rd["fundamental_data"], str) else rd["fundamental_data"]
            pdf_name = f"advisory_{report_id}_{rd['id']}_{rd['symbol']}_{rd['call_type']}.pdf"
            pdf_path = f"/tmp/advisory_pdfs/{pdf_name}"
            generate_single_advisory_pdf(report_dict, rd, pdf_path, template=template)
            await conn.execute("UPDATE advisory_recommendations SET pdf_path=$1 WHERE id=$2", pdf_path, rd["id"])
            pdf_paths.append({"rec_id": rd["id"], "symbol": rd["symbol"], "call_type": rd["call_type"], "pdf_name": pdf_name})

        await conn.execute("UPDATE advisory_reports SET status='published', published_at=NOW() WHERE id=$1", report_id)

    return {"message": f"{len(pdf_paths)} PDFs generated", "pdfs": pdf_paths}


@app.get("/api/advisory/recommend/{rec_id}/pdf", tags=["Advisory & Reports"], summary="Generate recommendation PDF",
    description="Generate a PDF for a specific stock recommendation with entry/target/SL, rationale, and SEBI disclaimer.")
async def download_recommendation_pdf(rec_id: int, user=Depends(get_current_user)):
    """Download individual recommendation PDF."""
    from fastapi.responses import FileResponse
    import os

    async with db_pool.acquire() as conn:
        rec = await conn.fetchrow("SELECT * FROM advisory_recommendations WHERE id=$1 AND user_id=$2", rec_id, user["id"])
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")

    pdf_path = rec.get("pdf_path", "")
    if not pdf_path or not os.path.exists(pdf_path):
        # Generate on the fly
        report = None
        async with db_pool.acquire() as conn:
            report = await conn.fetchrow("SELECT * FROM advisory_reports WHERE id=$1", rec["report_id"])
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")

        report_dict = dict(report)
        report_dict["created_at"] = report_dict["created_at"].isoformat() if report_dict["created_at"] else ""
        rd = dict(rec)
        rd["technical_data"] = json.loads(rd["technical_data"]) if isinstance(rd["technical_data"], str) else rd["technical_data"]
        rd["fundamental_data"] = json.loads(rd["fundamental_data"]) if isinstance(rd["fundamental_data"], str) else rd["fundamental_data"]

        import os
        os.makedirs("/tmp/advisory_pdfs", exist_ok=True)
        pdf_path = f"/tmp/advisory_pdfs/advisory_{rec['report_id']}_{rec['id']}_{rec['symbol']}.pdf"
        generate_single_advisory_pdf(report_dict, rd, pdf_path)
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE advisory_recommendations SET pdf_path=$1 WHERE id=$2", pdf_path, rec["id"])

    sym = rec.get("symbol", "")
    return FileResponse(pdf_path, media_type="application/pdf",
                       filename=f"AlphaLab_{sym}_{rec.get('call_type','BUY')}_{rec_id}.pdf")


@app.put("/api/advisory/report/{report_id}", tags=["Advisory & Reports"], summary="Update advisory report",
    description="Update an existing advisory report content.")
async def update_report(report_id: int, req: dict, user=Depends(get_current_user)):
    """Update report metadata."""
    updates = []
    params = [report_id, user["id"]]
    idx = 3
    for field in ["title", "advisor_name", "ria_reg_no", "disclaimer", "report_type"]:
        if field in req:
            updates.append(f"{field}=${idx}")
            params.append(req[field])
            idx += 1
    if updates:
        async with db_pool.acquire() as conn:
            await conn.execute(f"UPDATE advisory_reports SET {', '.join(updates)} WHERE id=$1 AND user_id=$2", *params)
    return {"message": "Updated"}


@app.delete("/api/advisory/report/{report_id}", tags=["Advisory & Reports"], summary="Delete advisory report",
    description="Delete an advisory report.")
async def delete_report(report_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM advisory_reports WHERE id=$1 AND user_id=$2", report_id, user["id"])
    return {"message": "Deleted"}


# ══════════════════════════════════════════════════════════════════════════════
# SECTOR ANALYSIS & ROTATION ENGINE
# ══════════════════════════════════════════════════════════════════════════════

# Build reverse map: sector -> [symbols]
SECTOR_SYMBOLS = {}
for _sym, _sec in SECTOR_MAP.items():
    SECTOR_SYMBOLS.setdefault(_sec, []).append(_sym)
SECTOR_LIST = sorted(SECTOR_SYMBOLS.keys())

# Build reverse map: industry -> [symbols]
INDUSTRY_SYMBOLS = {}
for _sym, _ind in INDUSTRY_MAP.items():
    INDUSTRY_SYMBOLS.setdefault(_ind, []).append(_sym)
INDUSTRY_LIST = sorted(INDUSTRY_SYMBOLS.keys())

# Build reverse map: basic_industry -> [symbols]
BASIC_INDUSTRY_SYMBOLS = {}
for _sym, _bi in BASIC_INDUSTRY_MAP.items():
    BASIC_INDUSTRY_SYMBOLS.setdefault(_bi, []).append(_sym)
BASIC_INDUSTRY_LIST = sorted(BASIC_INDUSTRY_SYMBOLS.keys())


@app.get("/api/sectors", tags=["Sector Analysis"], summary="List all sectors",
    description="List all 49 sectors with stock counts and sample stock symbols.")
async def list_sectors(user=Depends(get_current_user)):
    """List all sectors with stock counts."""
    return {"sectors": [{
        "name": s, "count": len(SECTOR_SYMBOLS.get(s, [])),
        "stocks": sorted(SECTOR_SYMBOLS.get(s, []))[:10]
    } for s in SECTOR_LIST], "total": len(SECTOR_LIST)}


@app.get("/api/industries", tags=["Sector Analysis"], summary="List industries",
    description="List all industries with stock counts. Optionally filter by sector.")
async def list_industries(sector: str = "", user=Depends(get_current_user)):
    """List all industries with stock counts. Optionally filter by sector."""
    results = []
    for ind in INDUSTRY_LIST:
        syms = INDUSTRY_SYMBOLS[ind]
        if sector:
            syms = [s for s in syms if SECTOR_MAP.get(s, "Other") == sector]
        if not syms:
            continue
        results.append({"name": ind, "count": len(syms), "stocks": sorted(syms)[:8]})
    return {"industries": results, "total": len(results)}


@app.get("/api/basic-industries", tags=["Sector Analysis"], summary="List basic industries",
    description="List all basic industry classifications (most granular level) with stock counts. Filter by sector or industry.")
async def list_basic_industries(sector: str = "", industry: str = "", user=Depends(get_current_user)):
    """List all basic industries. Optionally filter by sector and/or industry."""
    results = []
    for bi in BASIC_INDUSTRY_LIST:
        syms = BASIC_INDUSTRY_SYMBOLS[bi]
        if sector:
            syms = [s for s in syms if SECTOR_MAP.get(s, "Other") == sector]
        if industry:
            syms = [s for s in syms if INDUSTRY_MAP.get(s, "Other") == industry]
        if not syms:
            continue
        results.append({"name": bi, "count": len(syms), "stocks": sorted(syms)[:6]})
    return {"basic_industries": results, "total": len(results)}


@app.get("/api/sector-rotation", tags=["Sector Analysis"], summary="Sector rotation heatmap",
    description="Get sector rotation data showing relative performance of all sectors vs Nifty 50 benchmark. Returns RS-Ratio and RS-Momentum for heatmap visualization.")
async def sector_rotation(user=Depends(get_current_user)):
    """Calculate sector performance over multiple timeframes for rotation analysis."""
    from datetime import date, timedelta

    cache_key = "sector_rotation_v2"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    # Pick top 3 liquid stocks per sector as sector proxies
    major_sectors = [s for s in SECTOR_LIST if len(SECTOR_SYMBOLS.get(s, [])) >= 3]
    proxy_map = {}
    all_syms = set()
    for sec in major_sectors:
        proxies = SECTOR_SYMBOLS[sec][:5]
        proxy_map[sec] = proxies
        all_syms.update(proxies)

    start = (date.today() - timedelta(days=200)).isoformat()
    end = date.today().isoformat()

    yf_syms = [f"{s}.NS" for s in all_syms]
    all_data = await batch_download_yf(yf_syms, start, end, batch_size=50)

    # Calculate sector returns
    sector_perf = []
    for sec in major_sectors:
        returns = {"1w": [], "1m": [], "3m": [], "6m": []}
        for sym in proxy_map[sec]:
            yf_sym = f"{sym}.NS"
            if yf_sym not in all_data:
                continue
            df = all_data[yf_sym]
            if df.empty or "Close" not in df.columns:
                continue
            c = df["Close"].astype(float).dropna()
            if len(c) < 10:
                continue
            price = float(c.iloc[-1])
            for period, days in [("1w", 5), ("1m", 21), ("3m", 63), ("6m", 126)]:
                idx = min(days, len(c)-1)
                if idx > 0:
                    ret = (price / float(c.iloc[-idx]) - 1) * 100
                    if not np.isnan(ret) and not np.isinf(ret):
                        returns[period].append(ret)

        if not any(returns.values()):
            continue

        avg = {k: round(np.mean(v), 2) if v else 0 for k, v in returns.items()}
        # Momentum score: weighted average across timeframes
        mom_score = round(avg["1w"] * 0.1 + avg["1m"] * 0.3 + avg["3m"] * 0.4 + avg["6m"] * 0.2, 2)

        sector_perf.append({
            "sector": sec, "stock_count": len(SECTOR_SYMBOLS[sec]),
            "return_1w": avg["1w"], "return_1m": avg["1m"],
            "return_3m": avg["3m"], "return_6m": avg["6m"],
            "momentum_score": mom_score,
            "trend": "bullish" if avg["1m"] > 0 and avg["3m"] > 0 else "bearish" if avg["1m"] < 0 and avg["3m"] < 0 else "neutral",
        })

    sector_perf.sort(key=lambda x: x["momentum_score"], reverse=True)

    result = {"sectors": sector_perf, "as_of": end, "total_sectors": len(sector_perf)}
    if redis_client:
        await redis_client.set(cache_key, json.dumps(result), ex=600)  # 10 min cache
    return result


@app.get("/api/sector-rrg", tags=["Sector Analysis"], summary="Relative Rotation Graph (RRG)",
    description="Compute RRG data using JdK RS-Ratio and RS-Momentum methodology. Returns trail data for each sector plotted in 4 quadrants: Leading, Weakening, Lagging, Improving. Configurable lookback weeks (8-20). First load takes 30-60 seconds as it computes relative strength across all sectors.")
async def sector_rrg(weeks: int = 12, user=Depends(get_current_user)):
    """Relative Rotation Graph — JdK RS-Ratio & RS-Momentum for sector rotation analysis.
    Returns trail data (last N weeks) for each sector plotted on a 2D plane.
    X-axis: RS-Ratio (relative strength vs Nifty 50, centered at 100)
    Y-axis: RS-Momentum (rate of change of RS-Ratio, centered at 100)
    Quadrants: Leading(TR), Weakening(BR), Lagging(BL), Improving(TL)
    """
    import yfinance as yf  # kept: ^NSEI benchmark index not in data service
    from datetime import date, timedelta

    weeks = min(max(weeks, 4), 26)  # Clamp 4-26 weeks
    cache_key = f"sector_rrg_v1:{weeks}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    # We need enough history: weeks + lookback for RS calculation
    lookback_days = (weeks + 14) * 7  # Extra 14 weeks for RS-Ratio smoothing
    start = (date.today() - timedelta(days=lookback_days)).isoformat()
    end = date.today().isoformat()

    # Pick top sectors with enough stocks
    major_sectors = [s for s in SECTOR_LIST if len(SECTOR_SYMBOLS.get(s, [])) >= 8][:12]  # Top 12 major sectors only

    # Download benchmark (Nifty 50)
    loop = asyncio.get_event_loop()
    benchmark_raw = await loop.run_in_executor(None, lambda: yf.download(
        "^NSEI", start=start, end=end, interval="1wk", auto_adjust=True, progress=False
    ))
    if benchmark_raw.empty:
        return {"sectors": [], "error": "Benchmark data unavailable"}

    bench_close = benchmark_raw["Close"].astype(float).dropna()
    if hasattr(bench_close, 'columns'):
        bench_close = bench_close.iloc[:, 0]

    # Download sector proxies
    proxy_map = {}
    all_syms = set()
    for sec in major_sectors:
        proxies = SECTOR_SYMBOLS[sec][:5]
        proxy_map[sec] = proxies
        all_syms.update(proxies)

    yf_syms = [f"{s}.NS" for s in all_syms]
    all_data = await batch_download_yf(yf_syms, start, end, batch_size=50)

    # Build weekly sector indices (equal-weighted average of proxy stocks)
    sector_weekly = {}
    for sec in major_sectors:
        weekly_prices = []
        for sym in proxy_map[sec]:
            yf_sym = f"{sym}.NS"
            if yf_sym not in all_data or all_data[yf_sym].empty:
                continue
            df = all_data[yf_sym]
            if "Close" not in df.columns:
                continue
            c = df["Close"].astype(float).dropna()
            if len(c) < 20:
                continue
            # Resample to weekly
            weekly = c.resample("W-FRI").last().dropna()
            weekly_prices.append(weekly)

        if len(weekly_prices) < 2:
            continue

        # Align and average
        combined = pd.concat(weekly_prices, axis=1).dropna()
        if len(combined) < weeks + 10:
            continue
        sector_weekly[sec] = combined.mean(axis=1)

    # Calculate RS-Ratio and RS-Momentum for each sector
    # RS-Ratio = (sector_price / benchmark_price) * 100, then smoothed
    # RS-Momentum = rate of change of RS-Ratio, smoothed
    bench_weekly = bench_close.resample("W-FRI").last().dropna()

    rrg_data = []
    for sec, sec_prices in sector_weekly.items():
        # Align sector and benchmark
        common_idx = sec_prices.index.intersection(bench_weekly.index)
        if len(common_idx) < weeks + 10:
            continue
        sp = sec_prices.loc[common_idx]
        bp = bench_weekly.loc[common_idx]

        # Raw relative strength (sector / benchmark)
        raw_rs = (sp / bp) * 100

        # Normalize RS to center around 100 using z-score over rolling window
        rs_mean = raw_rs.rolling(window=10, min_periods=5).mean()
        rs_std = raw_rs.rolling(window=10, min_periods=5).std()
        # JdK RS-Ratio: normalized to 100 +/- standard deviations
        rs_ratio = 100 + ((raw_rs - rs_mean) / rs_std.replace(0, 1)) * 2

        # JdK RS-Momentum: rate of change of RS-Ratio
        rs_mom_raw = rs_ratio.diff(1)
        rs_mom_mean = rs_mom_raw.rolling(window=5, min_periods=3).mean()
        rs_mom_std = rs_mom_raw.rolling(window=5, min_periods=3).std()
        rs_momentum = 100 + ((rs_mom_raw - rs_mom_mean) / rs_mom_std.replace(0, 1)) * 2

        # Clean NaN/Inf
        rs_ratio = rs_ratio.replace([np.inf, -np.inf], np.nan).dropna()
        rs_momentum = rs_momentum.replace([np.inf, -np.inf], np.nan).dropna()

        common = rs_ratio.index.intersection(rs_momentum.index)
        if len(common) < weeks:
            continue

        # Extract last N weeks of trail data
        trail = []
        for dt in common[-weeks:]:
            r = float(rs_ratio.loc[dt])
            m = float(rs_momentum.loc[dt])
            if not np.isnan(r) and not np.isnan(m):
                # Clamp to reasonable range
                r = max(90, min(110, r))
                m = max(90, min(110, m))
                trail.append({
                    "date": dt.strftime("%Y-%m-%d"),
                    "rs_ratio": round(r, 2),
                    "rs_momentum": round(m, 2),
                })

        if len(trail) < 4:
            continue

        # Current position (latest point)
        current = trail[-1]
        # Determine quadrant
        if current["rs_ratio"] >= 100 and current["rs_momentum"] >= 100:
            quadrant = "leading"
        elif current["rs_ratio"] >= 100 and current["rs_momentum"] < 100:
            quadrant = "weakening"
        elif current["rs_ratio"] < 100 and current["rs_momentum"] < 100:
            quadrant = "lagging"
        else:
            quadrant = "improving"

        rrg_data.append({
            "sector": sec,
            "stock_count": len(SECTOR_SYMBOLS.get(sec, [])),
            "quadrant": quadrant,
            "current_rs_ratio": current["rs_ratio"],
            "current_rs_momentum": current["rs_momentum"],
            "trail": trail,
        })

    # Sort by quadrant priority: improving > leading > weakening > lagging
    quad_order = {"improving": 0, "leading": 1, "weakening": 2, "lagging": 3}
    rrg_data.sort(key=lambda x: (quad_order.get(x["quadrant"], 9), -x["current_rs_ratio"]))

    result = {
        "sectors": rrg_data,
        "benchmark": "Nifty 50",
        "weeks": weeks,
        "as_of": end,
        "total_sectors": len(rrg_data),
    }
    if redis_client:
        await redis_client.set(cache_key, json.dumps(result), ex=900)  # 15 min cache
    return result


# ══════════════════════════════════════════════════════════════════════════════
# TECHNICAL CHARTS DATA API
# ══════════════════════════════════════════════════════════════════════════════



# ═══ COMMODITY PRICE FEED (via Kite) ═══
COMMODITY_SYMBOLS = {
    "GOLD": {"exchange": "MCX", "name": "Gold", "lot_size": 100, "unit": "10 grams"},
    "GOLDM": {"exchange": "MCX", "name": "Gold Mini", "lot_size": 10, "unit": "1 gram"},
    "GOLDGUINEA": {"exchange": "MCX", "name": "Gold Guinea", "lot_size": 1, "unit": "8 grams"},
    "GOLDPETAL": {"exchange": "MCX", "name": "Gold Petal", "lot_size": 1, "unit": "1 gram"},
    "SILVER": {"exchange": "MCX", "name": "Silver", "lot_size": 30, "unit": "1 kg"},
    "SILVERM": {"exchange": "MCX", "name": "Silver Mini", "lot_size": 5, "unit": "1 kg"},
    "SILVERMIC": {"exchange": "MCX", "name": "Silver Micro", "lot_size": 1, "unit": "1 kg"},
    "CRUDEOIL": {"exchange": "MCX", "name": "Crude Oil", "lot_size": 100, "unit": "1 barrel"},
    "CRUDEOILM": {"exchange": "MCX", "name": "Crude Oil Mini", "lot_size": 10, "unit": "1 barrel"},
    "NATURALGAS": {"exchange": "MCX", "name": "Natural Gas", "lot_size": 1250, "unit": "mmBtu"},
    "COPPER": {"exchange": "MCX", "name": "Copper", "lot_size": 2500, "unit": "1 kg"},
    "ZINC": {"exchange": "MCX", "name": "Zinc", "lot_size": 5000, "unit": "1 kg"},
    "ALUMINIUM": {"exchange": "MCX", "name": "Aluminium", "lot_size": 5000, "unit": "1 kg"},
    "LEAD": {"exchange": "MCX", "name": "Lead", "lot_size": 5000, "unit": "1 kg"},
    "NICKEL": {"exchange": "MCX", "name": "Nickel", "lot_size": 1500, "unit": "1 kg"},
    "MENTHAOIL": {"exchange": "MCX", "name": "Mentha Oil", "lot_size": 360, "unit": "1 kg"},
    "COTTONCANDY": {"exchange": "MCX", "name": "Cotton", "lot_size": 25, "unit": "1 bale"},
}

@app.get("/api/commodity/symbols", tags=["Commodity"], summary="List all commodity symbols")
async def commodity_symbols():
    return {"symbols": COMMODITY_SYMBOLS}

@app.get("/api/commodity/search/{query}", tags=["Commodity"], summary="Search commodity symbols (3+ chars)")
async def commodity_search(query: str):
    q = query.upper()
    matches = {}
    for sym, info in COMMODITY_SYMBOLS.items():
        if q in sym or q in info["name"].upper():
            matches[sym] = info
    return {"matches": matches, "query": query}

# MCX instruments cache
_mcx_instruments: list = []
_mcx_cache_time = 0

async def _load_mcx_instruments():
    """Load MCX instruments from Kite (cached 24h)"""
    global _mcx_instruments, _mcx_cache_time
    import time as _t
    if _mcx_instruments and _t.time() - _mcx_cache_time < 86400:
        return _mcx_instruments
    import urllib.request, csv, io
    try:
        url = "https://api.kite.trade/instruments"
        resp = urllib.request.urlopen(url, timeout=30)
        data = resp.read().decode()
        reader = csv.DictReader(io.StringIO(data))
        _mcx_instruments = [r for r in reader if r.get("exchange") == "MCX"]
        _mcx_cache_time = _t.time()
        print(f"[Commodity] Loaded {len(_mcx_instruments)} MCX instruments")
    except Exception as e:
        print(f"[Commodity] Failed to load instruments: {e}")
    return _mcx_instruments

def _find_nearest_future(instruments: list, name: str) -> str:
    """Find nearest expiry futures contract for a commodity"""
    from datetime import date
    today = date.today().isoformat()
    futs = [i for i in instruments if i.get("name","").upper() == name.upper() and i.get("instrument_type") == "FUT" and i.get("expiry","") >= today]
    futs.sort(key=lambda x: x.get("expiry",""))
    return futs[0]["tradingsymbol"] if futs else ""

@app.get("/api/commodity/quote/{symbol}", tags=["Commodity"], summary="Get commodity LTP via Kite (nearest futures)")
async def commodity_quote(symbol: str):
    sym = symbol.upper().strip()
    if sym not in COMMODITY_SYMBOLS:
        raise HTTPException(404, f"{sym} is not a recognized commodity symbol")
    
    from routers.arbitrage import _fetch_kite_quotes, _is_kite_connected
    if not _is_kite_connected():
        raise HTTPException(503, "Kite not connected. Login via DYOR Settings.")
    
    instruments = await _load_mcx_instruments()
    fut_sym = _find_nearest_future(instruments, sym)
    if not fut_sym:
        return {"symbol": sym, "exchange": "MCX", "ltp": 0, "error": f"No active futures contract for {sym}"}
    
    kite_sym = f"MCX:{fut_sym}"
    try:
        quotes = await _fetch_kite_quotes([kite_sym])
        if quotes and kite_sym in quotes:
            ltp = quotes[kite_sym].get("last_price", 0)
            info = COMMODITY_SYMBOLS[sym]
            return {
                "symbol": sym, "trading_symbol": fut_sym, "exchange": "MCX",
                "name": info["name"], "ltp": ltp, "lot_size": info["lot_size"],
                "unit": info["unit"], "source": "kite",
                "timestamp": __import__("time").time()
            }
        return {"symbol": sym, "exchange": "MCX", "ltp": 0, "error": "No quote data from Kite"}
    except HTTPException: raise
    except Exception as e:
        return {"symbol": sym, "exchange": "MCX", "ltp": 0, "error": str(e)}


# ── BSE Equity Quotes (no auth — internal use by AlphaMarket) ─────────────
@app.get("/api/bse/quote/{symbol}", tags=["BSE"], summary="Get BSE equity quote via Groww")
async def bse_quote(symbol: str):
    """Get BSE equity quote via Kite Connect API."""
    import json as _json, urllib.request as _req, urllib.error as _uerr, psycopg2 as _pg
    sym = symbol.upper().strip()
    try:
        cn = _pg.connect("postgresql://dyor_user:DyorSecure2026Mar@localhost:5432/dyor_db")
        cr = cn.cursor(); cr.execute("SELECT value FROM api_settings WHERE key='kite_token'")
        row = cr.fetchone(); cr.close(); cn.close()
        if not row: raise HTTPException(503, "Kite token not available")
        tk = _json.loads(row[0]).get("access_token")
        url = f"https://api.kite.trade/quote?i=BSE:{sym}"
        rq = _req.Request(url, headers={"Authorization": f"token wmwpq34kw5th0y2l:{tk}"})
        rsp = _req.urlopen(rq, timeout=10)
        data = _json.loads(rsp.read().decode())
        if data.get("status") == "success":
            q = data["data"].get(f"BSE:{sym}", {})
            return {"symbol": sym, "exchange": "BSE", "ltp": q.get("last_price", 0),
                    "change": q.get("net_change", 0), "changePercent": q.get("ohlc", {}).get("close", 0) and round((q.get("net_change", 0) / q["ohlc"]["close"]) * 100, 2) if q.get("ohlc", {}).get("close") else 0,
                    "open": q.get("ohlc", {}).get("open", 0), "high": q.get("ohlc", {}).get("high", 0),
                    "low": q.get("ohlc", {}).get("low", 0), "close": q.get("ohlc", {}).get("close", 0),
                    "volume": q.get("volume", 0), "source": "kite_bse"}
    except _uerr.HTTPError as e:
        if e.code == 403: raise HTTPException(503, "Kite session expired. Please re-login.")
        raise HTTPException(502, f"Kite error: {e.code}")
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(500, f"BSE quote error: {str(e)[:100]}")


@app.get("/api/bse/ltp", tags=["BSE"], summary="Get BSE LTP for multiple symbols")
async def bse_ltp(symbols: str = ""):
    """Get BSE LTP for multiple symbols via Kite Connect API."""
    import json as _json, urllib.request as _req, urllib.error as _uerr, psycopg2 as _pg
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not symbol_list: raise HTTPException(400, "No symbols provided")
    try:
        cn = _pg.connect("postgresql://dyor_user:DyorSecure2026Mar@localhost:5432/dyor_db")
        cr = cn.cursor(); cr.execute("SELECT value FROM api_settings WHERE key='kite_token'")
        row = cr.fetchone(); cr.close(); cn.close()
        if not row: raise HTTPException(503, "Kite token not available")
        tk = _json.loads(row[0]).get("access_token")
        params = "&".join([f"i=BSE:{s}" for s in symbol_list])
        url = f"https://api.kite.trade/quote/ltp?{params}"
        rq = _req.Request(url, headers={"Authorization": f"token wmwpq34kw5th0y2l:{tk}"})
        rsp = _req.urlopen(rq, timeout=10)
        data = _json.loads(rsp.read().decode())
        result = {}
        if data.get("status") == "success":
            for k, v in data["data"].items():
                sym = k.replace("BSE:", "")
                result[sym] = {"ltp": v.get("last_price", 0), "exchange": "BSE", "source": "kite_bse"}
        return result
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(500, f"BSE LTP error: {str(e)[:100]}")


@app.get("/api/commodity/futures/{symbol}", tags=["Commodity"], summary="List all futures contracts for a commodity")
async def commodity_futures(symbol: str):
    sym = symbol.upper().strip()
    instruments = await _load_mcx_instruments()
    from datetime import date
    today = date.today().isoformat()
    futs = [i for i in instruments if i.get("name","").upper() == sym and i.get("instrument_type") == "FUT" and i.get("expiry","") >= today]
    futs.sort(key=lambda x: x.get("expiry",""))
    return {"symbol": sym, "contracts": [{"tradingsymbol": f["tradingsymbol"], "expiry": f["expiry"], "lot_size": f["lot_size"]} for f in futs]}

@app.get("/api/commodity/options/{symbol}", tags=["Commodity"], summary="Get options chain for a commodity")
async def commodity_options(symbol: str, expiry: str = None):
    sym = symbol.upper().strip()
    instruments = await _load_mcx_instruments()
    from datetime import date
    today = date.today().isoformat()
    
    # Get available expiries
    opts = [i for i in instruments if i.get("name","").upper() == sym and i.get("instrument_type") in ("CE","PE") and i.get("expiry","") >= today]
    expiries = sorted(set(o.get("expiry","") for o in opts))
    
    if not expiry and expiries:
        expiry = expiries[0]  # nearest
    
    chain = [i for i in opts if i.get("expiry") == expiry]
    strikes = sorted(set(float(o.get("strike",0)) for o in chain))
    
    # Fetch LTPs for all options in chain
    from routers.arbitrage import _fetch_kite_quotes, _is_kite_connected
    ltp_map = {}
    if _is_kite_connected() and chain:
        kite_syms = [f"MCX:{o['tradingsymbol']}" for o in chain[:60]]  # limit to 60
        try:
            quotes = await _fetch_kite_quotes(kite_syms)
            if quotes:
                for k, v in quotes.items():
                    ltp_map[k.replace("MCX:","")] = v.get("last_price", 0)
        except: pass
    
    result = []
    for strike in strikes:
        ce = next((o for o in chain if float(o.get("strike",0)) == strike and o.get("instrument_type") == "CE"), None)
        pe = next((o for o in chain if float(o.get("strike",0)) == strike and o.get("instrument_type") == "PE"), None)
        result.append({
            "strike": strike,
            "ce_symbol": ce["tradingsymbol"] if ce else None,
            "ce_ltp": ltp_map.get(ce["tradingsymbol"], 0) if ce else 0,
            "pe_symbol": pe["tradingsymbol"] if pe else None,
            "pe_ltp": ltp_map.get(pe["tradingsymbol"], 0) if pe else 0,
        })
    
    return {"symbol": sym, "expiry": expiry, "expiries": expiries, "chain": result, "total_strikes": len(strikes)}


# ── NFO Option Chain via Kite (added 20 May 2026) ────────────────────────
@app.get("/api/nfo/option-chain/{symbol}", tags=["NFO"], summary="Get NFO option chain via Kite")
async def nfo_option_chain(symbol: str, expiry: str = None):
    # Validate and fix expiry format
    if expiry:
        import re as _re
        # Fix zero-padded months: 2026-0-26 -> 2026-07-26 (can't guess, so try to fix)
        parts = expiry.split("-")
        if len(parts) == 3:
            try:
                y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
                if m == 0:
                    m = datetime.now().month  # Use current month as fallback
                expiry = f"{y:04d}-{m:02d}-{d:02d}"
            except (ValueError, IndexError):
                raise HTTPException(400, f"Invalid expiry format: {expiry}. Expected YYYY-MM-DD")
    """Fetch live option chain for NSE F&O symbols using Kite instrument_master + LTP quotes.
    No auth required (bypass in alphamarket_auth.py). Used by AlphaMarket advisory dashboard."""
    import asyncpg
    from datetime import date
    from routers.arbitrage import _fetch_kite_quotes, _is_kite_connected

    sym = symbol.upper().strip()
    today = date.today()

    # Get instruments from instrument_master (alphamarket_db)
    conn = await asyncpg.connect(
        host="127.0.0.1", port=5432,
        user="alphamarket_user", password="AlphaMkt2026",
        database="alphamarket_db"
    )
    try:
        # Get available expiries
        expiry_rows = await conn.fetch("""
            SELECT DISTINCT expiry::text AS expiry
            FROM instrument_master
            WHERE exchange='NFO' AND name=$1
              AND instrument_type IN ('CE','PE')
              AND expiry >= $2
            ORDER BY expiry
        """, sym, today)
        expiries = [r["expiry"].isoformat() if hasattr(r["expiry"], "isoformat") else str(r["expiry"]) for r in expiry_rows]

        if not expiry and expiries:
            expiry = expiries[0]

        if not expiry:
            return {"symbol": sym, "expiry": None, "expiries": expiries, "chain": [], "total_strikes": 0}

        # Get all CE/PE instruments for this expiry
        inst_rows = await conn.fetch("""
            SELECT tradingsymbol, instrument_type, strike, instrument_token
            FROM instrument_master
            WHERE exchange='NFO' AND name=$1
              AND instrument_type IN ('CE','PE')
              AND expiry=$2
            ORDER BY strike
        """, sym, date.fromisoformat(expiry))
    finally:
        await conn.close()

    if not inst_rows:
        return {"symbol": sym, "expiry": expiry, "expiries": expiries, "chain": [], "total_strikes": 0}

    # Build strike map
    strikes_map = {}
    for r in inst_rows:
        strike = float(r["strike"])
        if strike not in strikes_map:
            strikes_map[strike] = {"strike": strike}
        if r["instrument_type"] == "CE":
            strikes_map[strike]["ce_symbol"] = r["tradingsymbol"]
            strikes_map[strike]["ce_token"] = r["instrument_token"]
        else:
            strikes_map[strike]["pe_symbol"] = r["tradingsymbol"]
            strikes_map[strike]["pe_token"] = r["instrument_token"]

    sorted_strikes = sorted(strikes_map.keys())

    # Limit to ~120 strikes nearest ATM (60 above, 60 below midpoint)
    if len(sorted_strikes) > 120:
        mid = len(sorted_strikes) // 2
        lo = max(0, mid - 60)
        hi = min(len(sorted_strikes), mid + 60)
        sorted_strikes = sorted_strikes[lo:hi]

    # Batch fetch LTPs from Kite
    ltp_map = {}
    if _is_kite_connected():
        kite_syms = []
        for s in sorted_strikes:
            info = strikes_map[s]
            if "ce_symbol" in info:
                kite_syms.append(f"NFO:{info['ce_symbol']}")
            if "pe_symbol" in info:
                kite_syms.append(f"NFO:{info['pe_symbol']}")

        # Kite allows ~500 per call; batch if needed
        for i in range(0, len(kite_syms), 200):
            batch = kite_syms[i:i+200]
            try:
                quotes = await _fetch_kite_quotes(batch)
                if quotes:
                    for k, v in quotes.items():
                        ts = k.replace("NFO:", "")
                        ltp_map[ts] = v.get("last_price", 0)
            except Exception as e:
                print(f"[NFO chain] Kite LTP batch error: {e}")

    # Build response in same shape as commodity options
    chain = []
    for s in sorted_strikes:
        info = strikes_map[s]
        chain.append({
            "strikePrice": s,
            "ce": {
                "ltp": ltp_map.get(info.get("ce_symbol", ""), 0),
                "tradingSymbol": info.get("ce_symbol", ""),
            } if "ce_symbol" in info else None,
            "pe": {
                "ltp": ltp_map.get(info.get("pe_symbol", ""), 0),
                "tradingSymbol": info.get("pe_symbol", ""),
            } if "pe_symbol" in info else None,
        })

    return {
        "symbol": sym,
        "expiry": expiry,
        "expiries": expiries,
        "chain": chain,
        "total_strikes": len(chain),
        "source": "kite"
    }

@app.post("/api/commodity/quotes", tags=["Commodity"], summary="Bulk commodity quotes (nearest futures)")
async def commodity_quotes_bulk(req: dict):
    symbols = req.get("symbols", [])
    if not symbols:
        raise HTTPException(400, "No symbols provided")
    
    from routers.arbitrage import _fetch_kite_quotes, _is_kite_connected
    if not _is_kite_connected():
        raise HTTPException(503, "Kite not connected")
    
    instruments = await _load_mcx_instruments()
    kite_syms = []
    sym_map = {}  # kite_sym -> original sym
    for s in symbols:
        su = s.upper()
        if su in COMMODITY_SYMBOLS:
            fut = _find_nearest_future(instruments, su)
            if fut:
                ks = f"MCX:{fut}"
                kite_syms.append(ks)
                sym_map[ks] = su
    
    if not kite_syms:
        raise HTTPException(400, "No valid commodity symbols with active futures")
    
    quotes = await _fetch_kite_quotes(kite_syms)
    result = {}
    for ks, orig in sym_map.items():
        if quotes and ks in quotes:
            info = COMMODITY_SYMBOLS.get(orig, {})
            result[orig] = {
                "ltp": quotes[ks].get("last_price", 0),
                "name": info.get("name", orig),
                "lot_size": info.get("lot_size", 0),
                "exchange": "MCX",
                "trading_symbol": ks.replace("MCX:","")
            }
    return {"quotes": result}


@app.get("/api/chart/{symbol}", tags=["Technical Charts"], summary="Get chart data with indicators",
    description="Get OHLCV candlestick data for a stock with pre-computed technical indicators (SMA 20/50/200, EMA 9/21, RSI, MACD, Bollinger Bands, Supertrend, volume). Supports periods: 1m, 3m, 6m, 1y, 2y, 3y, 5y.")
async def chart_data(symbol: str, period: str = "1y", interval: str = "1d", user=Depends(get_current_user)):
    """Return OHLCV + indicators for TradingView Lightweight Charts."""
    from datetime import date, timedelta

    cache_key = f"chart:{symbol.upper()}:{period}:{interval}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    period_days = {"1m": 30, "3m": 90, "6m": 180, "1y": 365, "2y": 730, "3y": 1095, "5y": 1825, "max": 3650}
    days = period_days.get(period, 365)
    start = (date.today() - timedelta(days=days + 50)).isoformat()
    end = date.today().isoformat()
    # Map period to DS-compatible: use "1y" minimum for indicator computation
    ds_period = period if period in ("1y","2y","3y","5y","max") else "1y"
    _ds_rows = await ds_ohlcv(symbol, ds_period)
    if _ds_rows:
        df = pd.DataFrame(_ds_rows)
        df.columns = [col.lower() for col in df.columns]
        for dc in ["date","datetime","timestamp"]:
            if dc in df.columns:
                df[dc] = pd.to_datetime(df[dc])
                df = df.set_index(dc)
                break
        df.index.name = "date"
        keep = [col for col in ["open","high","low","close","volume"] if col in df.columns]
        df = df[keep].astype({col: float for col in keep}).dropna().sort_index()

        # Append today's forming candle from Kite quote if missing
        from datetime import date as _dt_date
        today_str = _dt_date.today().isoformat()
        last_date = df.index[-1].strftime("%Y-%m-%d") if len(df) > 0 else ""
        if last_date < today_str:
            try:
                _today_ds = await ds_ohlcv(symbol, "5d")
                if _today_ds:
                    for row in _today_ds:
                        rd = row.get("date","")
                        if rd > last_date:
                            new_row = pd.DataFrame([{
                                "open": float(row["open"]), "high": float(row["high"]),
                                "low": float(row["low"]), "close": float(row["close"]),
                                "volume": float(row.get("volume",0))
                            }], index=[pd.Timestamp(rd)])
                            new_row.index.name = "date"
                            df = pd.concat([df, new_row])
                    df = df.sort_index()
            except Exception as _kq_err:
                pass  # Today's candle unavailable, continue with historical
    else:
        raise HTTPException(status_code=404, detail=f"No chart data available for {symbol}")
    if df.empty:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")

    if "Close" in df.columns:
        df = df.rename(columns={"Close":"close","Open":"open","High":"high","Low":"low","Volume":"volume"})
    df = df.sort_index().astype({"open":float,"high":float,"low":float,"close":float,"volume":float}).dropna()

    # Compute all indicators
    try:
        df = compute_indicators(df)
    except Exception as _ci_err:
        print(f"compute_indicators error for {symbol}: {_ci_err}")
        # Continue without indicators — basic OHLCV still works

    # Build response — OHLCV candles
    candles = []
    for dt, row in df.iterrows():
        ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else int(pd.Timestamp(dt).timestamp())
        candles.append({
            "time": ts, "open": round(float(row["open"]),2), "high": round(float(row["high"]),2),
            "low": round(float(row["low"]),2), "close": round(float(row["close"]),2)
        })

    # Volume bars
    volumes = []
    for dt, row in df.iterrows():
        ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else int(pd.Timestamp(dt).timestamp())
        color = "rgba(0,212,170,0.4)" if row["close"] >= row["open"] else "rgba(239,83,80,0.4)"
        volumes.append({"time": ts, "value": int(row["volume"]), "color": color})

    # SMA overlays
    def series_out(col):
        out = []
        for dt, row in df.iterrows():
            if col in df.columns and not np.isnan(row[col]):
                ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else int(pd.Timestamp(dt).timestamp())
                out.append({"time": ts, "value": round(float(row[col]), 2)})
        return out

    # Bollinger Bands
    bb_upper, bb_lower = [], []
    if "bb_upper" in df.columns:
        for dt, row in df.iterrows():
            ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else int(pd.Timestamp(dt).timestamp())
            if not np.isnan(row.get("bb_upper", float("nan"))):
                bb_upper.append({"time": ts, "value": round(float(row["bb_upper"]), 2)})
                bb_lower.append({"time": ts, "value": round(float(row["bb_lower"]), 2)})

    # RSI
    rsi_data = series_out("rsi_14")

    # MACD
    macd_line, macd_signal_line, macd_hist = [], [], []
    for dt, row in df.iterrows():
        ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else int(pd.Timestamp(dt).timestamp())
        if "macd" in df.columns and not np.isnan(row.get("macd", float("nan"))):
            macd_line.append({"time": ts, "value": round(float(row["macd"]), 2)})
        if "macd_signal" in df.columns and not np.isnan(row.get("macd_signal", float("nan"))):
            macd_signal_line.append({"time": ts, "value": round(float(row["macd_signal"]), 2)})
        if "macd_hist" in df.columns and not np.isnan(row.get("macd_hist", float("nan"))):
            color = "rgba(0,212,170,0.7)" if row["macd_hist"] >= 0 else "rgba(239,83,80,0.7)"
            macd_hist.append({"time": ts, "value": round(float(row["macd_hist"]), 2), "color": color})

    # ADX
    adx_data = series_out("adx") if "adx" in df.columns else []

    # Supertrend
    supertrend_data = series_out("supertrend") if "supertrend" in df.columns else []

    # ATR
    atr_data = series_out("atr") if "atr" in df.columns else []

    # Latest stats
    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last
    price = float(last["close"])
    change = price - float(prev["close"])
    change_pct = change / float(prev["close"]) * 100

    stats = {
        "symbol": symbol.upper(), "price": round(price, 2),
        "change": round(change, 2), "change_pct": round(change_pct, 2),
        "open": round(float(last["open"]), 2), "high": round(float(last["high"]), 2),
        "low": round(float(last["low"]), 2), "volume": int(last["volume"]),
        "rsi": round(float(last["rsi_14"]), 1) if "rsi_14" in df.columns and not np.isnan(last.get("rsi_14", float("nan"))) else None,
        "sma_50": round(float(last["sma_50"]), 2) if "sma_50" in df.columns and not np.isnan(last.get("sma_50", float("nan"))) else None,
        "sma_200": round(float(last["sma_200"]), 2) if "sma_200" in df.columns and not np.isnan(last.get("sma_200", float("nan"))) else None,
        "macd_hist": round(float(last["macd_hist"]), 2) if "macd_hist" in df.columns and not np.isnan(last.get("macd_hist", float("nan"))) else None,
        "adx": round(float(last["adx"]), 1) if "adx" in df.columns and not np.isnan(last.get("adx", float("nan"))) else None,
        "atr": round(float(last["atr"]), 2) if "atr" in df.columns and not np.isnan(last.get("atr", float("nan"))) else None,
        "sector": SECTOR_MAP.get(symbol.upper(), "Other"), "industry": INDUSTRY_MAP.get(symbol.upper(), "Other"), "basic_industry": BASIC_INDUSTRY_MAP.get(symbol.upper(), "Other"),
        "above_50dma": price > float(last["sma_50"]) if "sma_50" in df.columns and not np.isnan(last.get("sma_50", float("nan"))) else None,
        "above_200dma": price > float(last["sma_200"]) if "sma_200" in df.columns and not np.isnan(last.get("sma_200", float("nan"))) else None,
    }

    result = {
        "candles": candles, "volume": volumes,
        "sma_20": series_out("sma_20") if "sma_20" in df.columns else [],
        "sma_50": series_out("sma_50"),
        "sma_200": series_out("sma_200"),
        "ema_12": series_out("ema_12") if "ema_12" in df.columns else [],
        "ema_26": series_out("ema_26") if "ema_26" in df.columns else [],
        "bb_upper": bb_upper, "bb_lower": bb_lower,
        "supertrend": supertrend_data,
        "rsi": rsi_data, "macd_line": macd_line, "macd_signal": macd_signal_line, "macd_hist": macd_hist,
        "adx": adx_data, "atr": atr_data,
        "stats": stats, "total_candles": len(candles),
    }

    if redis_client:
        await redis_client.setex(cache_key, 120, json.dumps(result))
    return result


@app.get("/api/chart/{symbol}/backtest-markers", tags=["Technical Charts"], summary="Get backtest markers for chart overlay",
    description="Get BUY/SELL signal markers from a completed backtest to overlay on a price chart. Returns marker positions with entry/exit prices and trade P&L.")
async def chart_backtest_markers(symbol: str, backtest_id: int, user=Depends(get_current_user)):
    """Get trade entry/exit markers from a completed backtest to overlay on chart."""
    async with db_pool.acquire() as conn:
        bt = await conn.fetchrow("SELECT * FROM backtests WHERE id=$1 AND user_id=$2", backtest_id, user["id"])
        if not bt or not bt["result"]:
            raise HTTPException(status_code=404, detail="Backtest not found")

        result = json.loads(bt["result"]) if isinstance(bt["result"], str) else bt["result"]
        trades = result.get("trades", [])
        markers = []
        for t in trades:
            action = t.get("action", "")
            markers.append({
                "time": int(pd.Timestamp(t["date"]).timestamp()) if t.get("date") else 0,
                "position": "belowBar" if "BUY" in action else "aboveBar",
                "color": "#00d4aa" if "BUY" in action else "#ef5350",
                "shape": "arrowUp" if "BUY" in action else "arrowDown",
                "text": f"{action} ₹{t.get('price', 0)}"
            })
        return {"markers": markers, "symbol": symbol.upper(), "backtest_id": backtest_id}


# ══════════════════════════════════════════════════════════════════════════════
# MODEL PORTFOLIO ENGINE
# ══════════════════════════════════════════════════════════════════════════════

MODEL_PORTFOLIO_TEMPLATES = {
    "momentum_kings": {
        "name": "Momentum Kings", "description": "Top momentum stocks above 200 DMA with volume confirmation",
        "screener": "momentum", "backtest": "MOMENTUM", "forward": "MOMENTUM",
        "params": {"min_price": 100, "max_price": 10000}, "max_holdings": 15, "weighting": "equal"
    },
    "value_picks": {
        "name": "Deep Value Picks", "description": "Low P/E + Low P/B stocks with quality filters",
        "screener": "oversold", "backtest": "VALUE_DEEP_VALUE", "forward": "VALUE_DEEP_VALUE",
        "params": {"max_pb": 1.5, "max_ev_ebitda": 8}, "max_holdings": 12, "weighting": "equal"
    },
    "quality_compounders": {
        "name": "Quality Compounders", "description": "High ROE + Low Debt + Strong margins — buy & hold",
        "screener": "minervini", "backtest": "QUALITY_MOAT", "forward": "QUALITY_MOAT",
        "params": {"min_roe": 18, "min_operating_margin": 15}, "max_holdings": 10, "weighting": "equal"
    },
    "growth_stars": {
        "name": "Growth Stars", "description": "High EPS growth companies with breakout confirmation",
        "screener": "breakout", "backtest": "HYBRID_GROWTH_BREAKOUT", "forward": "HYBRID_GROWTH_BREAKOUT",
        "params": {"min_earnings_growth": 15}, "max_holdings": 12, "weighting": "equal"
    },
    "dividend_income": {
        "name": "Dividend Income", "description": "High dividend yield stocks for passive income",
        "screener": "trend_strong", "backtest": "VALUE_HIGH_DIVIDEND", "forward": "VALUE_HIGH_DIVIDEND",
        "params": {"min_dividend_yield": 2}, "max_holdings": 15, "weighting": "equal"
    },
    "techno_fundamental": {
        "name": "Techno-Fundamental", "description": "Quality fundamentals + MACD momentum timing",
        "screener": "minervini", "backtest": "HYBRID_QUALITY_MOMENTUM", "forward": "HYBRID_QUALITY_MOMENTUM",
        "params": {"min_roe": 15, "min_profit_margin": 10}, "max_holdings": 10, "weighting": "equal"
    },
    "breakout_warriors": {
        "name": "Breakout Warriors", "description": "52-week high breakouts with volume surge",
        "screener": "breakout", "backtest": "BREAKOUT", "forward": "BREAKOUT",
        "params": {"window": 20}, "max_holdings": 10, "weighting": "equal"
    },
    "low_volatility": {
        "name": "Low Volatility Shield", "description": "Low beta, steady stocks for capital preservation",
        "screener": "trend_strong", "backtest": "FACTOR_LOW_VOLATILITY", "forward": "FACTOR_LOW_VOLATILITY",
        "params": {"vol_threshold_pct": 20}, "max_holdings": 15, "weighting": "equal"
    },
    "small_cap_gems": {
        "name": "Small Cap Gems", "description": "Small cap momentum with fundamental quality filter",
        "screener": "relative_strength", "backtest": "FACTOR_SIZE", "forward": "FACTOR_SIZE",
        "params": {"max_market_cap_cr": 10000}, "max_holdings": 15, "weighting": "equal"
    },
    "turnaround_plays": {
        "name": "Turnaround Plays", "description": "Oversold quality stocks near support — contrarian entry",
        "screener": "oversold", "backtest": "HYBRID_VALUE_REVERSAL", "forward": "HYBRID_VALUE_REVERSAL",
        "params": {"pe_max": 20, "oversold": 35}, "max_holdings": 10, "weighting": "equal"
    },
    "golden_cross_portfolio": {
        "name": "Golden Cross Portfolio", "description": "Stocks with 50 DMA crossing above 200 DMA",
        "screener": "golden_cross", "backtest": "GOLDEN_CROSS", "forward": "GOLDEN_CROSS",
        "params": {}, "max_holdings": 15, "weighting": "equal"
    },
    "all_weather": {
        "name": "All Weather Portfolio", "description": "Balanced mix: quality + low vol + dividend across sectors",
        "screener": "trend_strong", "backtest": "FACTOR_QUALITY", "forward": "FACTOR_QUALITY",
        "params": {}, "max_holdings": 20, "weighting": "equal"
    },
    # ── Sector Themed Portfolios ──────────────────────────────────────────
    "banking_sector": {
        "name": "Banking & Finance", "description": "Top banking stocks — momentum + quality across PSU & private banks",
        "screener": "relative_strength", "backtest": "HYBRID_ROE_TREND", "forward": "HYBRID_ROE_TREND",
        "params": {"sector_filter": "Banking"}, "max_holdings": 10, "weighting": "equal"
    },
    "it_sector": {
        "name": "IT & Technology", "description": "Best Indian IT companies — growth momentum + quality",
        "screener": "trend_strong", "backtest": "HYBRID_QUALITY_MOMENTUM", "forward": "HYBRID_QUALITY_MOMENTUM",
        "params": {"sector_filter": "IT"}, "max_holdings": 10, "weighting": "equal"
    },
    "pharma_healthcare": {
        "name": "Pharma & Healthcare", "description": "Pharma + hospital chains — defensive growth portfolio",
        "screener": "relative_strength", "backtest": "QUALITY_HIGH_ROE", "forward": "QUALITY_HIGH_ROE",
        "params": {"sector_filter": "Pharma"}, "max_holdings": 10, "weighting": "equal"
    },
    "infra_capex": {
        "name": "Infra & Capital Goods", "description": "India capex theme — infra, industrial, defence plays",
        "screener": "breakout", "backtest": "MOMENTUM", "forward": "MOMENTUM",
        "params": {"sector_filter": "Infra"}, "max_holdings": 12, "weighting": "equal"
    },
    "defence_theme": {
        "name": "Defence & Aerospace", "description": "Make in India defence — HAL, BEL, BDL, shipyards",
        "screener": "relative_strength", "backtest": "MOMENTUM", "forward": "MOMENTUM",
        "params": {"sector_filter": "Defence"}, "max_holdings": 8, "weighting": "equal"
    },
    "consumption_theme": {
        "name": "India Consumption", "description": "FMCG + consumer + retail — domestic demand play",
        "screener": "trend_strong", "backtest": "QUALITY_MOAT", "forward": "QUALITY_MOAT",
        "params": {"sector_filter": "FMCG"}, "max_holdings": 12, "weighting": "equal"
    },
    "realty_housing": {
        "name": "Real Estate Boom", "description": "Realty + building materials — housing upcycle beneficiaries",
        "screener": "breakout", "backtest": "MOMENTUM", "forward": "MOMENTUM",
        "params": {"sector_filter": "Realty"}, "max_holdings": 8, "weighting": "equal"
    },
    "energy_transition": {
        "name": "Energy & Power", "description": "Oil & gas, power, renewables — energy security theme",
        "screener": "relative_strength", "backtest": "HYBRID_ROE_TREND", "forward": "HYBRID_ROE_TREND",
        "params": {"sector_filter": "Energy"}, "max_holdings": 10, "weighting": "equal"
    },
    "metal_commodities": {
        "name": "Metals & Mining", "description": "Steel, aluminium, copper — commodity upcycle portfolio",
        "screener": "momentum", "backtest": "MOMENTUM", "forward": "MOMENTUM",
        "params": {"sector_filter": "Metal"}, "max_holdings": 8, "weighting": "equal"
    },
    "auto_ev": {
        "name": "Auto & EV Play", "description": "OEMs + auto ancillaries — EV & export theme",
        "screener": "trend_strong", "backtest": "HYBRID_QUALITY_MOMENTUM", "forward": "HYBRID_QUALITY_MOMENTUM",
        "params": {"sector_filter": "Auto"}, "max_holdings": 10, "weighting": "equal"
    },
    "chemical_specialty": {
        "name": "Chemicals & Specialty", "description": "Specialty chemicals — China+1 beneficiaries",
        "screener": "relative_strength", "backtest": "QUALITY_HIGH_ROE", "forward": "QUALITY_HIGH_ROE",
        "params": {"sector_filter": "Chemical"}, "max_holdings": 10, "weighting": "equal"
    },
}


async def build_model_portfolio(portfolio_id: int, user_id: int):
    """Build portfolio: run screener -> rank by quality -> apply filters -> allocate weights -> save."""
    from datetime import date, timedelta

    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", portfolio_id, user_id)
        if not mp:
            return {"error": "Portfolio not found"}

        params = json.loads(mp["params"]) if isinstance(mp["params"], str) else (mp["params"] or {})
        screener_strat = mp["screener_strategy"]
        bt_strat = mp["backtest_strategy"]
        max_h = mp["max_holdings"]
        capital = mp["initial_capital"]
        weighting = mp["weighting"]
        sector_filter = params.get("sector_filter", "")
        port_type = mp["portfolio_type"] or ""

        # Step 1: Get candidate stocks from screener cache
        screener_stocks = []
        if screener_strat and redis_client:
            all_keys = await redis_client.keys(f"screener:{__import__('datetime').date.today().isoformat()}:{screener_strat}:*")
            if all_keys:
                cached = await redis_client.get(all_keys[0])
                if cached:
                    data = json.loads(cached)
                    screener_stocks = data.get("stocks", data) if isinstance(data, dict) else data
            if not screener_stocks:
                cached = await redis_client.get(f"screener:{__import__('datetime').date.today().isoformat()}:{screener_strat}")
                if cached:
                    data = json.loads(cached)
                    screener_stocks = data.get("stocks", data) if isinstance(data, dict) else data

        # Step 2: Apply sector filter
        if sector_filter and screener_stocks:
            screener_stocks = [s for s in screener_stocks if sector_filter.lower() in (s.get("sector", "") or "").lower()]

        # Step 3: Determine symbols to scan
        if screener_stocks:
            symbols_to_scan = [s.get("symbol", "") for s in screener_stocks if s.get("symbol")][:80]
        else:
            symbols_to_scan = list(NIFTY_UNIVERSE)
            if sector_filter:
                symbols_to_scan = [s for s in symbols_to_scan if sector_filter.lower() in SECTOR_MAP.get(s, "Other").lower()]
            symbols_to_scan = symbols_to_scan[:100]

        if not symbols_to_scan:
            return {"holdings": 0, "message": "No stocks in universe for this portfolio criteria"}

        # Step 4: Download price data
        start_date = (date.today() - timedelta(days=300)).isoformat()
        end_date = date.today().isoformat()
        yf_syms = [f"{s}.NS" for s in symbols_to_scan]
        all_data = await batch_download_yf(yf_syms, start_date, end_date, batch_size=40)
        all_data = {k: v for k, v in all_data.items() if not v.empty and len(v) >= 50}

        candidates = []
        for sym in symbols_to_scan:
            yf_sym = f"{sym}.NS"
            if yf_sym not in all_data:
                continue
            try:
                df = all_data[yf_sym].copy()
                if "Close" in df.columns:
                    df = df.rename(columns={"Close": "close", "Open": "open", "High": "high", "Low": "low", "Volume": "volume"})
                df = df.sort_index().astype({"open": float, "high": float, "low": float, "close": float, "volume": float}).dropna()
                if len(df) < 50:
                    continue

                df = compute_indicators(df)
                price = float(df["close"].iloc[-1])

                # Quality gate
                if price < 30:
                    continue
                avg_vol = float(df["volume"].rolling(20).mean().iloc[-1]) if len(df) >= 20 else 0
                if avg_vol < 10000:
                    continue

                # Compute metrics
                rsi = float(df["rsi_14"].iloc[-1]) if "rsi_14" in df.columns and not np.isnan(df["rsi_14"].iloc[-1]) else 50
                vol_ratio = float(df["volume"].iloc[-1] / df["volume"].rolling(20).mean().iloc[-1]) if len(df) >= 20 else 1
                sma50 = float(df["sma_50"].iloc[-1]) if "sma_50" in df.columns and not np.isnan(df["sma_50"].iloc[-1]) else price
                sma200 = float(df["sma_200"].iloc[-1]) if "sma_200" in df.columns and len(df) >= 200 and not np.isnan(df["sma_200"].iloc[-1]) else price
                above_50 = 1 if price > sma50 else 0
                above_200 = 1 if price > sma200 else 0
                atr_val = float(df["atr"].iloc[-1]) if "atr" in df.columns and not np.isnan(df["atr"].iloc[-1]) else price * 0.02
                change_1m = float((price - float(df["close"].iloc[-22])) / float(df["close"].iloc[-22]) * 100) if len(df) > 22 else 0
                change_3m = float((price - float(df["close"].iloc[-66])) / float(df["close"].iloc[-66]) * 100) if len(df) > 66 else 0
                high_52w = float(df["high"].max())
                pct_from_high = round((price / high_52w - 1) * 100, 1) if high_52w > 0 else 0

                # Fetch fundamentals
                fund = {}
                try:
                    fund = fetch_fundamentals_sync(sym) or {}
                except:
                    pass

                pe = fund.get("pe_trailing") or fund.get("pe_forward")
                pb = fund.get("pb")
                roe_val = fund.get("roe") or fund.get("returnOnEquity", 0)
                if roe_val and 0 < abs(roe_val) < 1: roe_val = round(roe_val * 100, 2)
                de_val = fund.get("debt_equity") or fund.get("debtToEquity", 0)
                div_yield = fund.get("dividend_yield") or fund.get("dividendYield", 0)
                if div_yield and 0 < div_yield < 1: div_yield = round(div_yield * 100, 2)
                profit_margin = fund.get("profit_margin") or fund.get("profitMargins", 0)
                if profit_margin and 0 < abs(profit_margin) < 1: profit_margin = round(profit_margin * 100, 2)
                earnings_growth = fund.get("earnings_growth") or fund.get("earningsGrowth", 0)
                if earnings_growth and 0 < abs(earnings_growth) < 1: earnings_growth = round(earnings_growth * 100, 2)
                market_cap = fund.get("market_cap") or fund.get("marketCap", 0)
                mcap_cr = round(market_cap / 10000000, 0) if market_cap else 0

                # Run strategy signal
                last_sig = 0
                if bt_strat:
                    try:
                        p = dict(params)
                        p["_symbol"] = sym
                        p["_fundamentals"] = fund
                        fn = STRATEGY_MAP.get(bt_strat, strategy_sma_crossover)
                        sig_series = fn(df, p)
                        last_sig = int(sig_series.iloc[-1]) if len(sig_series) > 0 else 0
                    except:
                        last_sig = 0

                # SCORING ENGINE
                score = 0
                include = True

                if "momentum" in port_type or bt_strat == "MOMENTUM":
                    if not above_200: include = False
                    if rsi > 80 or rsi < 35: include = False
                    score = round(change_1m * 2 + change_3m * 0.5 + above_200 * 15 + above_50 * 10 + min(vol_ratio, 3) * 5 + (70 - abs(rsi - 60)) * 0.5)

                elif "value" in port_type or bt_strat in ("VALUE_DEEP_VALUE", "VALUE_HIGH_DIVIDEND"):
                    if pe and pe > 0: score += max(0, 30 - pe)
                    if pb and pb > 0: score += max(0, int(15 - pb * 5))
                    if div_yield: score += int(div_yield * 10)
                    if roe_val and roe_val > 0: score += int(min(roe_val, 30))
                    if pe and pe > 50: include = False

                elif "quality" in port_type or bt_strat in ("QUALITY_MOAT", "QUALITY_HIGH_ROE", "FACTOR_QUALITY"):
                    if roe_val and roe_val > 0: score += int(min(roe_val * 2, 50))
                    if profit_margin and profit_margin > 0: score += int(min(profit_margin, 30))
                    if de_val is not None and de_val >= 0: score += max(0, int(20 - de_val * 0.3))
                    if above_200: score += 10
                    if roe_val and roe_val < 8: include = False

                elif "growth" in port_type or bt_strat == "HYBRID_GROWTH_BREAKOUT":
                    if earnings_growth and earnings_growth > 0: score += int(min(earnings_growth, 50))
                    score += int(change_1m * 1.5)
                    if above_200: score += 15
                    if vol_ratio > 1.2: score += 10

                elif "breakout" in port_type or bt_strat == "BREAKOUT":
                    score += max(0, int(100 + pct_from_high))
                    if vol_ratio > 1.5: score += 20
                    if above_50 and above_200: score += 15
                    if pct_from_high < -20: include = False

                elif "golden_cross" in port_type or bt_strat == "GOLDEN_CROSS":
                    sma50_prev = float(df["sma_50"].iloc[-5]) if "sma_50" in df.columns and len(df) > 5 and not np.isnan(df["sma_50"].iloc[-5]) else 0
                    sma200_prev = float(df["sma_200"].iloc[-5]) if "sma_200" in df.columns and len(df) > 205 and not np.isnan(df["sma_200"].iloc[-5]) else 0
                    if sma50 > sma200 and sma50_prev <= sma200_prev: score += 50
                    elif above_50 and above_200: score += 20
                    else: include = False

                elif "turnaround" in port_type or bt_strat == "HYBRID_VALUE_REVERSAL":
                    if rsi < 40: score += int(40 - rsi) * 2
                    if pe and 0 < pe < 20: score += 15
                    if change_1m < -5: score += int(abs(change_1m))
                    if roe_val and roe_val > 10: score += 10

                elif "low_vol" in port_type or bt_strat == "FACTOR_LOW_VOLATILITY":
                    atr_pct = atr_val / price * 100 if price > 0 else 5
                    score += max(0, int(50 - atr_pct * 15))
                    if above_200: score += 15
                    if div_yield and div_yield > 1: score += 10
                    if atr_pct > 3: include = False

                elif "small_cap" in port_type or bt_strat == "FACTOR_SIZE":
                    max_mcap = float(params.get("max_market_cap_cr", 10000))
                    if mcap_cr > max_mcap: include = False
                    score += int(change_1m * 2) + above_200 * 15
                    if roe_val and roe_val > 12: score += 15

                else:
                    score += above_200 * 15 + above_50 * 10 + int(change_1m * 1.5)
                    if roe_val and roe_val > 0: score += int(min(roe_val, 25))
                    if vol_ratio > 1: score += 5
                    if last_sig == 1: score += 20

                # Subtle screener rank boost
                scr_idx = next((i for i, s in enumerate(screener_stocks) if s.get("symbol") == sym), -1)
                if scr_idx >= 0: score += max(0, 10 - scr_idx)

                if not include:
                    continue

                candidates.append({
                    "symbol": sym, "price": round(price, 2),
                    "signal": "BUY" if last_sig == 1 else ("HOLD" if above_200 else "WATCH"),
                    "strength": min(100, max(10, score)), "score": score,
                    "rsi": round(rsi, 1), "change_1m": round(change_1m, 1), "change_3m": round(change_3m, 1),
                    "above_50dma": above_50, "above_200dma": above_200,
                    "pct_from_52w_high": pct_from_high, "volume_ratio": round(vol_ratio, 2),
                    "atr": round(atr_val, 2), "sector": SECTOR_MAP.get(sym, "Other"),
                    "industry": INDUSTRY_MAP.get(sym, "Other"), "basic_industry": BASIC_INDUSTRY_MAP.get(sym, "Other"),
                    "pe": round(pe, 1) if pe else None, "pb": round(pb, 1) if pb else None,
                    "roe": round(roe_val, 1) if roe_val else None, "de": round(de_val, 1) if de_val else None,
                    "div_yield": round(div_yield, 2) if div_yield else None,
                    "profit_margin": round(profit_margin, 1) if profit_margin else None,
                    "market_cap_cr": int(mcap_cr) if mcap_cr else None,
                    "weight": 0,
                })
            except:
                continue

        # Step 5: Rank and select
        candidates.sort(key=lambda x: x["score"], reverse=True)
        selected = candidates[:max_h]

        if not selected:
            return {"holdings": 0, "message": "No stocks matched criteria after quality filters"}

        # Step 6: Allocate weights
        if weighting == "equal":
            w = round(100 / len(selected), 2)
            for s in selected: s["weight"] = w
        elif weighting == "score_weighted":
            ts = sum(max(s["score"], 1) for s in selected)
            for s in selected: s["weight"] = round(max(s["score"], 1) / ts * 100, 2)
        elif weighting == "inverse_volatility":
            ti = sum(1 / max(s["atr"], 0.01) for s in selected)
            for s in selected: s["weight"] = round((1 / max(s["atr"], 0.01)) / ti * 100, 2)
        else:
            w = round(100 / len(selected), 2)
            for s in selected: s["weight"] = w

        # Step 7: Save to DB
        await conn.execute("DELETE FROM model_portfolio_holdings WHERE portfolio_id=$1", portfolio_id)

        total_val = 0
        for rank, s in enumerate(selected, 1):
            alloc = capital * s["weight"] / 100
            shares = int(alloc / s["price"]) if s["price"] > 0 else 0
            total_val += shares * s["price"]
            fd = {k: s[k] for k in ["pe","pb","roe","de","div_yield","profit_margin","market_cap_cr"] if s.get(k) is not None}
            await conn.execute("""
                INSERT INTO model_portfolio_holdings (portfolio_id,symbol,weight_pct,shares,entry_price,current_price,
                    screener_rank,signal_type,signal_strength,sector,fundamentals)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            """, portfolio_id, s["symbol"], s["weight"], shares, s["price"], s["price"],
                rank, s["signal"], min(100, max(1, s["strength"])), s["sector"], json.dumps(fd))

        await conn.execute("UPDATE model_portfolios SET updated_at=NOW() WHERE id=$1", portfolio_id)

        await conn.execute("""
            INSERT INTO model_portfolio_snapshots (portfolio_id,total_value,holdings_data,return_pct,snapshot_date)
            VALUES ($1,$2,$3,0,$4)
            ON CONFLICT (portfolio_id,snapshot_date) DO UPDATE SET total_value=$2,holdings_data=$3
        """, portfolio_id, round(total_val, 2),
            json.dumps([{"s":s["symbol"],"w":s["weight"],"p":s["price"],"sc":s["score"]} for s in selected]),
            date.today())

        return {
            "holdings": len(selected),
            "total_allocated": round(total_val, 2),
            "stocks": selected,
            "message": f"Portfolio built with {len(selected)} holdings"
        }


# ── Model Portfolio API Endpoints ────────────────────────────────────────────

@app.get("/api/model-portfolios/templates", tags=["Model Portfolios"], summary="List portfolio templates",
    description="Get all 23 pre-built model portfolio templates — Momentum, Value, Quality, Dividend, Sector Rotation, etc. Each template includes strategy, weighting method, rebalance frequency, and parameters.")
async def get_portfolio_templates(user=Depends(get_current_user)):
    return [{"id": k, **{kk: vv for kk, vv in v.items() if kk != "params"}} for k, v in MODEL_PORTFOLIO_TEMPLATES.items()]


@app.post("/api/model-portfolio/create", tags=["Model Portfolios"], summary="Create custom portfolio",
    description="Create a new model portfolio from scratch. Configure strategy source (screener/backtest/forward test), weighting (equal/market_cap/risk_parity), max holdings, rebalance frequency, and sector filters.")
async def create_model_portfolio(req: ModelPortfolioCreate, user=Depends(get_current_user)):
    p = dict(req.params)
    if req.sector_filter:
        p["sector_filter"] = req.sector_filter
    async with db_pool.acquire() as conn:
        pid = await conn.fetchval("""
            INSERT INTO model_portfolios (user_id,name,description,portfolio_type,screener_strategy,backtest_strategy,forward_strategy,
                params,initial_capital,weighting,max_holdings,rebalance_freq)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
        """, user["id"], req.name, req.description, req.portfolio_type,
            req.screener_strategy, req.backtest_strategy, req.forward_strategy,
            json.dumps(p), req.initial_capital, req.weighting, req.max_holdings, req.rebalance_freq)
        return {"id": pid}


@app.post("/api/model-portfolio/create-from-template/{template_id}", tags=["Model Portfolios"], summary="Create from template",
    description="Create a model portfolio from one of the 23 pre-built templates with default parameters.")
async def create_from_template(template_id: str, user=Depends(get_current_user)):
    tmpl = MODEL_PORTFOLIO_TEMPLATES.get(template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    async with db_pool.acquire() as conn:
        pid = await conn.fetchval("""
            INSERT INTO model_portfolios (user_id,name,description,portfolio_type,screener_strategy,backtest_strategy,forward_strategy,
                params,initial_capital,weighting,max_holdings,rebalance_freq)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,100000,$9,$10,'monthly') RETURNING id
        """, user["id"], tmpl["name"], tmpl["description"], template_id,
            tmpl.get("screener"), tmpl.get("backtest"), tmpl.get("forward"),
            json.dumps(tmpl.get("params", {})), tmpl.get("weighting", "equal"), tmpl.get("max_holdings", 15))
    return {"id": pid, "name": tmpl["name"]}


@app.get("/api/model-portfolios", tags=["Model Portfolios"], summary="List user portfolios",
    description="List all model portfolios created by the authenticated user with current status and holdings count.")
async def list_model_portfolios(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT mp.*,
                (SELECT COUNT(*) FROM model_portfolio_holdings WHERE portfolio_id=mp.id AND status='active') as num_holdings
            FROM model_portfolios mp WHERE mp.user_id=$1 ORDER BY mp.created_at DESC
        """, user["id"])
        return [_safe_row(r) for r in rows]


@app.get("/api/model-portfolio/{pid}", tags=["Model Portfolios"], summary="Get portfolio details",
    description="Get full details of a model portfolio — holdings with current prices, weights, P&L, sector allocation, and performance metrics.")
async def get_model_portfolio(pid: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Not found")

        holdings = await conn.fetch(
            "SELECT * FROM model_portfolio_holdings WHERE portfolio_id=$1 AND status='active' ORDER BY screener_rank ASC", pid
        )
        snapshots = await conn.fetch(
            "SELECT * FROM model_portfolio_snapshots WHERE portfolio_id=$1 ORDER BY snapshot_date ASC", pid
        )

        total_val = sum((h["current_price"] or h["entry_price"] or 0) * (h["shares"] or 0) for h in holdings)
        total_cost = sum((h["entry_price"] or 0) * (h["shares"] or 0) for h in holdings)
        total_ret = ((total_val / total_cost - 1) * 100) if total_cost > 0 else 0

        # Sector breakdown
        sectors = {}
        for h in holdings:
            sec = h["sector"] or "Other"
            val = (h["current_price"] or h["entry_price"] or 0) * (h["shares"] or 0)
            sectors[sec] = sectors.get(sec, 0) + val
        if total_val > 0:
            sectors = {k: round(v/total_val*100, 1) for k, v in sectors.items()}

        return {
            "portfolio": _safe_row(mp),
            "holdings": [_safe_row(h) for h in holdings],
            "snapshots": [_safe_row(s) for s in snapshots],
            "summary": {
                "total_value": round(total_val, 2), "total_cost": round(total_cost, 2),
                "return_pct": round(total_ret, 2), "num_holdings": len(holdings),
                "sectors": sectors,
            }
        }


@app.post("/api/model-portfolio/{pid}/build", tags=["Model Portfolios"], summary="Build/rebuild portfolio",
    description="Run the portfolio's strategy to populate or refresh holdings. Executes the screener, applies weighting, and selects stocks up to max_holdings.")
async def build_portfolio(pid: int, user=Depends(get_current_user)):
    """Run screener + strategy to build/rebalance portfolio holdings."""
    result = await build_model_portfolio(pid, user["id"])
    return result


@app.post("/api/model-portfolio/{pid}/deploy-paper", tags=["Model Portfolios"], summary="Deploy to paper trading",
    description="Convert a model portfolio into live paper trades — opens paper positions for all holdings at current market prices.")
async def deploy_to_paper(pid: int, user=Depends(get_current_user)):
    """Push all portfolio holdings to paper trading."""
    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Not found")

        holdings = await conn.fetch(
            "SELECT * FROM model_portfolio_holdings WHERE portfolio_id=$1 AND status='active' AND shares > 0", pid
        )
        deployed = 0
        for h in holdings:
            # Check if already has open paper trade for this symbol
            existing = await conn.fetchrow(
                "SELECT id FROM paper_trades WHERE user_id=$1 AND symbol=$2 AND status='open'", user["id"], h["symbol"]
            )
            if existing:
                continue

            atr = 0
            fund = json.loads(h["fundamentals"]) if isinstance(h["fundamentals"], str) else (h["fundamentals"] or {})
            sl = round(h["entry_price"] * 0.95, 2) if h["entry_price"] else None  # 5% SL
            tgt = round(h["entry_price"] * 1.15, 2) if h["entry_price"] else None  # 15% target

            tid = await conn.fetchval(
                "INSERT INTO paper_trades (user_id,symbol,trade_type,quantity,entry_price,stop_loss,target) VALUES ($1,$2,'BUY',$3,$4,$5,$6) RETURNING id",
                user["id"], h["symbol"], h["shares"], h["entry_price"], sl, tgt
            )
            await conn.execute("UPDATE model_portfolio_holdings SET paper_trade_id=$1 WHERE id=$2", tid, h["id"])
            deployed += 1

        return {"deployed": deployed, "total_holdings": len(holdings), "message": f"Deployed {deployed} positions to paper trading"}


@app.delete("/api/model-portfolio/{pid}", tags=["Model Portfolios"], summary="Delete portfolio",
    description="Delete a model portfolio and all its holdings.")
async def delete_model_portfolio(pid: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        return {"deleted": True}


# ── Model Portfolio Editing ─────────────────────────────────────────────────

@app.put("/api/model-portfolio/{pid}/holding/{hid}", tags=["Model Portfolios"], summary="Update holding",
    description="Update a specific holding in a portfolio — modify weight, quantity, or notes.")
async def update_holding(pid: int, hid: int, req: Request, user=Depends(get_current_user)):
    """Update a holding's weight or shares."""
    body = await req.json()
    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Portfolio not found")
        h = await conn.fetchrow("SELECT * FROM model_portfolio_holdings WHERE id=$1 AND portfolio_id=$2", hid, pid)
        if not h: raise HTTPException(status_code=404, detail="Holding not found")

        new_weight = body.get("weight_pct", h["weight_pct"])
        new_shares = body.get("shares", h["shares"])
        await conn.execute(
            "UPDATE model_portfolio_holdings SET weight_pct=$1, shares=$2 WHERE id=$3",
            float(new_weight), int(new_shares), hid
        )
        await conn.execute("UPDATE model_portfolios SET updated_at=NOW() WHERE id=$1", pid)
        return {"updated": True, "holding_id": hid}


@app.delete("/api/model-portfolio/{pid}/holding/{hid}", tags=["Model Portfolios"], summary="Remove holding",
    description="Remove a stock from a model portfolio.")
async def remove_holding(pid: int, hid: int, user=Depends(get_current_user)):
    """Remove a stock from the portfolio."""
    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Portfolio not found")
        await conn.execute("DELETE FROM model_portfolio_holdings WHERE id=$1 AND portfolio_id=$2", hid, pid)
        await conn.execute("UPDATE model_portfolios SET updated_at=NOW() WHERE id=$1", pid)
        return {"deleted": True}


@app.post("/api/model-portfolio/{pid}/add-stock", tags=["Model Portfolios"], summary="Add stock to portfolio",
    description="Manually add a stock to a model portfolio with specified quantity and weight.")
async def add_stock_to_portfolio(pid: int, req: Request, user=Depends(get_current_user)):
    """Manually add a stock to the portfolio."""
    body = await req.json()
    symbol = (body.get("symbol","")).upper().strip()
    weight_pct = float(body.get("weight_pct", 0))
    if not symbol: raise HTTPException(status_code=400, detail="Symbol required")

    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Portfolio not found")

        # Check duplicate
        existing = await conn.fetchrow(
            "SELECT id FROM model_portfolio_holdings WHERE portfolio_id=$1 AND symbol=$2 AND status='active'", pid, symbol
        )
        if existing: raise HTTPException(status_code=400, detail=f"{symbol} already in portfolio")

        # Get current price via data service
        price = 0
        try:
            _q = await ds_quote(symbol)
            if _q and _q.get("price"):
                price = round(_q["price"], 2)
        except: pass
        if not price or price <= 0: raise HTTPException(status_code=400, detail=f"Cannot get price for {symbol}")

        # Get sector from universe
        sector = SECTOR_MAP.get(symbol, "Other")

        capital = mp["initial_capital"] or 100000
        shares = int((capital * weight_pct / 100) / price) if weight_pct > 0 and price > 0 else 0

        hid = await conn.fetchval("""
            INSERT INTO model_portfolio_holdings (portfolio_id,symbol,weight_pct,shares,entry_price,current_price,
            screener_rank,signal_type,signal_strength,sector,status)
            VALUES ($1,$2,$3,$4,$5,$5,999,'MANUAL',0,$6,'active') RETURNING id
        """, pid, symbol, weight_pct, shares, price, sector)
        await conn.execute("UPDATE model_portfolios SET updated_at=NOW() WHERE id=$1", pid)
        return {"added": True, "holding_id": hid, "symbol": symbol, "price": price, "shares": shares}


@app.post("/api/model-portfolio/{pid}/reweight", tags=["Model Portfolios"], summary="Reweight portfolio",
    description="Rebalance portfolio weights using the specified method (equal, market_cap, risk_parity, or custom). Recalculates quantities based on current prices and capital.")
async def reweight_portfolio(pid: int, req: Request, user=Depends(get_current_user)):
    """Normalize weights to 100% and recalculate shares."""
    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Portfolio not found")

        holdings = await conn.fetch(
            "SELECT * FROM model_portfolio_holdings WHERE portfolio_id=$1 AND status='active'", pid
        )
        if not holdings: return {"message": "No holdings to reweight"}

        total_weight = sum(h["weight_pct"] or 0 for h in holdings)
        capital = mp["initial_capital"] or 100000

        for h in holdings:
            new_weight = ((h["weight_pct"] or 0) / total_weight * 100) if total_weight > 0 else (100.0 / len(holdings))
            price = h["current_price"] or h["entry_price"] or 1
            new_shares = int((capital * new_weight / 100) / price) if price > 0 else 0
            await conn.execute(
                "UPDATE model_portfolio_holdings SET weight_pct=$1, shares=$2 WHERE id=$3",
                round(new_weight, 2), new_shares, h["id"]
            )

        await conn.execute("UPDATE model_portfolios SET updated_at=NOW() WHERE id=$1", pid)
        return {"message": f"Reweighted {len(holdings)} holdings to 100%"}


@app.get("/api/dashboard/strategies", tags=["Dashboard"], summary="Strategy performance dashboard",
    description="Aggregated performance data across all strategies — screener hit rates, backtest results, forward test P&L, and top performing strategies. Powers the main dashboard view.")
async def get_strategy_dashboard(user=Depends(get_current_user)):
    """Get performance summary of all portfolios, backtests, and forward tests."""
    async with db_pool.acquire() as conn:
        # Model Portfolios with performance
        portfolios = await conn.fetch("""
            SELECT mp.*, 
                (SELECT COUNT(*) FROM model_portfolio_holdings WHERE portfolio_id=mp.id AND status='active') as num_holdings,
                (SELECT COALESCE(SUM(current_price * shares), 0) FROM model_portfolio_holdings WHERE portfolio_id=mp.id AND status='active') as total_value,
                (SELECT COALESCE(SUM(entry_price * shares), 0) FROM model_portfolio_holdings WHERE portfolio_id=mp.id AND status='active') as total_cost
            FROM model_portfolios mp WHERE mp.user_id=$1 AND mp.status='active' ORDER BY mp.updated_at DESC
        """, user["id"])

        portfolio_data = []
        for p in portfolios:
            tv = p["total_value"] or 0
            tc = p["total_cost"] or 0
            ret = ((tv / tc - 1) * 100) if tc > 0 else 0
            portfolio_data.append({
                "id": p["id"], "name": p["name"], "type": "portfolio",
                "strategy": p["screener_strategy"] or p["backtest_strategy"] or "custom",
                "num_holdings": p["num_holdings"], "total_value": round(tv, 0),
                "total_cost": round(tc, 0), "return_pct": round(ret, 2),
                "weighting": p["weighting"], "updated_at": str(p["updated_at"]) if p["updated_at"] else None
            })

        # Completed Backtests with results
        backtests = await conn.fetch("""
            SELECT id, name, symbol, strategy, status, 
                   result->'summary'->>'total_return' as total_return,
                   result->'summary'->>'sharpe_ratio' as sharpe,
                   result->'summary'->>'win_rate' as win_rate,
                   result->'summary'->>'num_trades' as num_trades,
                   created_at
            FROM backtests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20
        """, user["id"])

        backtest_data = []
        for b in backtests:
            backtest_data.append({
                "id": b["id"], "name": b["name"], "type": "backtest",
                "symbol": b["symbol"], "strategy": b["strategy"], "status": b["status"],
                "total_return": float(b["total_return"]) if b["total_return"] else None,
                "sharpe": float(b["sharpe"]) if b["sharpe"] else None,
                "win_rate": float(b["win_rate"]) if b["win_rate"] else None,
                "num_trades": int(b["num_trades"]) if b["num_trades"] else 0,
                "created_at": str(b["created_at"]) if b["created_at"] else None
            })

        # Forward Tests
        forward_tests = await conn.fetch("""
            SELECT ft.id, ft.name, ft.strategy, ft.status, ft.created_at, ft.last_scan_at,
                ft.current_capital, ft.initial_capital,
                (SELECT COUNT(*) FROM forward_test_positions WHERE fwd_test_id=ft.id AND status='open') as active_signals,
                (SELECT COUNT(*) FROM forward_test_positions WHERE fwd_test_id=ft.id) as total_signals,
                (SELECT COALESCE(
                    ROUND(COUNT(*) FILTER (WHERE unrealized_pnl_pct > 0)::numeric * 100.0 / NULLIF(COUNT(*),0), 1),
                    0
                ) FROM forward_test_positions WHERE fwd_test_id=ft.id AND status='closed') as hit_rate
            FROM forward_tests ft WHERE ft.user_id=$1 ORDER BY ft.last_scan_at DESC NULLS LAST LIMIT 20
        """, user["id"])

        fwd_data = []
        for f in forward_tests:
            ret_pct = ((f["current_capital"] / f["initial_capital"] - 1) * 100) if f["initial_capital"] and f["initial_capital"] > 0 else 0
            fwd_data.append({
                "id": f["id"], "name": f["name"], "type": "forward_test",
                "strategy": f["strategy"], "sector": "All",
                "status": f["status"],
                "active_signals": f["active_signals"] or 0,
                "total_signals": f["total_signals"] or 0,
                "hit_rate": round(float(f["hit_rate"]), 1) if f["hit_rate"] else 0,
                "return_pct": round(ret_pct, 2),
                "updated_at": str(f["last_scan_at"]) if f["last_scan_at"] else (str(f["created_at"]) if f["created_at"] else None)
            })

        return {
            "portfolios": portfolio_data,
            "backtests": backtest_data,
            "forward_tests": fwd_data
        }


# ── Alerts & Notifications System ──────────────────────────────────────────────

async def _create_notification(conn, user_id, title, message, notif_type="alert", alert_id=None, entity_type=None, entity_id=None):
    """Helper to create a notification record."""
    await conn.execute("""
        INSERT INTO notifications (user_id, alert_id, title, message, notif_type, entity_type, entity_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
    """, user_id, alert_id, title, message, notif_type, entity_type, entity_id)


async def _check_all_alerts():
    """Background: evaluate all active alerts and fire notifications."""
    if not db_pool:
        return
    async with db_pool.acquire() as conn:
        alerts = await conn.fetch("SELECT * FROM alerts WHERE status='active'")
        if not alerts:
            return
        print(f"[ALERTS] Checking {len(alerts)} active alerts...")
        from datetime import date

        for alert in alerts:
            try:
                conditions = alert["conditions"] if isinstance(alert["conditions"], dict) else json.loads(alert["conditions"] or "{}")
                fired = False
                msg = ""

                atype = alert["alert_type"]

                # ── Price Alerts ──
                if atype == "price_above" and alert["symbol"]:
                    target = float(conditions.get("price", 0))
                    if target > 0:
                        _aq = await ds_quote(alert["symbol"])
                        if _aq and _aq.get("price"):
                            price = float(_aq["price"])
                            if price >= target:
                                fired = True
                                msg = f"🔔 {alert['symbol']} crossed above ₹{target:.2f} — now at ₹{price:.2f}"

                elif atype == "price_below" and alert["symbol"]:
                    target = float(conditions.get("price", 0))
                    if target > 0:
                        _aq = await ds_quote(alert["symbol"])
                        if _aq and _aq.get("price"):
                            price = float(_aq["price"])
                            if price <= target:
                                fired = True
                                msg = f"🔔 {alert['symbol']} dropped below ₹{target:.2f} — now at ₹{price:.2f}"

                # ── Portfolio Alerts ──
                elif atype == "portfolio_return" and alert["entity_id"]:
                    threshold = float(conditions.get("return_pct", 0))
                    direction = conditions.get("direction", "above")  # above or below
                    holdings = await conn.fetch(
                        "SELECT entry_price, current_price, shares FROM model_portfolio_holdings WHERE portfolio_id=$1 AND status='active'",
                        alert["entity_id"]
                    )
                    if holdings:
                        tv = sum((h["current_price"] or h["entry_price"] or 0) * (h["shares"] or 0) for h in holdings)
                        tc = sum((h["entry_price"] or 0) * (h["shares"] or 0) for h in holdings)
                        ret = ((tv / tc - 1) * 100) if tc > 0 else 0
                        if direction == "above" and ret >= threshold:
                            fired = True
                            msg = f"📈 Portfolio return hit +{ret:.1f}% (target: {threshold}%)"
                        elif direction == "below" and ret <= threshold:
                            fired = True
                            msg = f"📉 Portfolio return dropped to {ret:.1f}% (threshold: {threshold}%)"

                elif atype == "portfolio_rebalance_due" and alert["entity_id"]:
                    mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1", alert["entity_id"])
                    if mp and mp["updated_at"]:
                        days_since = (datetime.utcnow() - mp["updated_at"]).days
                        freq = mp["rebalance_freq"] or "monthly"
                        due_days = {"daily": 1, "weekly": 7, "biweekly": 14, "monthly": 30, "quarterly": 90}.get(freq, 30)
                        if days_since >= due_days:
                            fired = True
                            msg = f"⏰ Portfolio '{mp['name']}' rebalance due — last updated {days_since} days ago ({freq})"

                # ── Backtest Strategy Alerts ──
                elif atype == "strategy_signal" and alert["symbol"]:
                    strategy = conditions.get("strategy", "momentum")
                    # Check if the stock currently appears in the screener for this strategy
                    cache_key = f"screener:{__import__('datetime').date.today().isoformat()}:{strategy}:50:10000:"
                    cached = await redis_client.get(cache_key) if redis_client else None
                    if cached:
                        results = json.loads(cached)
                        symbols_in_result = [r.get("symbol","").upper() for r in results] if isinstance(results, list) else []
                        if alert["symbol"].upper() in symbols_in_result:
                            fired = True
                            msg = f"🎯 {alert['symbol']} triggered {strategy.upper()} strategy signal!"

                # ── Forward Test Alerts ──
                elif atype == "forward_test_signal" and alert["entity_id"]:
                    # Check if new positions were opened since last check
                    last_check = alert["last_triggered_at"] or alert["created_at"]
                    new_positions = await conn.fetch(
                        "SELECT symbol, signal_type, entry_price FROM forward_test_positions WHERE fwd_test_id=$1 AND entry_date > $2 AND status='open'",
                        alert["entity_id"], last_check
                    )
                    if new_positions:
                        symbols = ", ".join([p["symbol"] for p in new_positions[:5]])
                        fired = True
                        msg = f"🔔 Forward test generated {len(new_positions)} new signal(s): {symbols}"

                elif atype == "forward_test_hit_rate" and alert["entity_id"]:
                    threshold = float(conditions.get("hit_rate", 50))
                    direction = conditions.get("direction", "below")
                    closed = await conn.fetch(
                        "SELECT unrealized_pnl_pct FROM forward_test_positions WHERE fwd_test_id=$1 AND status='closed'",
                        alert["entity_id"]
                    )
                    if len(closed) >= 3:
                        wins = sum(1 for c in closed if (c["unrealized_pnl_pct"] or 0) > 0)
                        hit_rate = (wins / len(closed)) * 100
                        if direction == "below" and hit_rate <= threshold:
                            fired = True
                            msg = f"⚠️ Forward test hit rate dropped to {hit_rate:.0f}% (threshold: {threshold}%)"
                        elif direction == "above" and hit_rate >= threshold:
                            fired = True
                            msg = f"✅ Forward test hit rate reached {hit_rate:.0f}% (target: {threshold}%)"

                # ── Advisory Alerts ──
                elif atype == "advisory_target_hit" and alert["entity_id"]:
                    rec = await conn.fetchrow(
                        "SELECT * FROM advisory_recommendations WHERE id=$1", alert["entity_id"]
                    )
                    if rec and rec["target_price"]:
                        _aq = await ds_quote(rec["symbol"])
                        if _aq and _aq.get("price"):
                            price = float(_aq["price"])
                            if rec["call_type"] == "BUY" and price >= rec["target_price"]:
                                fired = True
                                msg = f"🎯 Advisory: {rec['symbol']} hit target ₹{rec['target_price']:.2f} — now at ₹{price:.2f}"
                            elif rec["call_type"] == "SELL" and price <= rec["target_price"]:
                                fired = True
                                msg = f"🎯 Advisory: {rec['symbol']} hit target ₹{rec['target_price']:.2f} — now at ₹{price:.2f}"

                elif atype == "advisory_sl_hit" and alert["entity_id"]:
                    rec = await conn.fetchrow(
                        "SELECT * FROM advisory_recommendations WHERE id=$1", alert["entity_id"]
                    )
                    if rec and rec["stop_loss"]:
                        _aq = await ds_quote(rec["symbol"])
                        if _aq and _aq.get("price"):
                            price = float(_aq["price"])
                            if rec["call_type"] == "BUY" and price <= rec["stop_loss"]:
                                fired = True
                                msg = f"⛔ Advisory: {rec['symbol']} hit stop loss ₹{rec['stop_loss']:.2f} — now at ₹{price:.2f}"
                            elif rec["call_type"] == "SELL" and price >= rec["stop_loss"]:
                                fired = True
                                msg = f"⛔ Advisory: {rec['symbol']} hit stop loss ₹{rec['stop_loss']:.2f} — now at ₹{price:.2f}"

                # ── Fire notification ──
                if fired:
                    await _create_notification(conn, alert["user_id"], alert["name"], msg,
                        notif_type="alert", alert_id=alert["id"],
                        entity_type=alert["entity_type"], entity_id=alert["entity_id"])
                    await conn.execute(
                        "UPDATE alerts SET last_triggered_at=NOW(), trigger_count=trigger_count+1 WHERE id=$1",
                        alert["id"]
                    )
                    # Auto-deactivate one-shot alerts (price alerts)
                    if atype in ("price_above", "price_below", "advisory_target_hit", "advisory_sl_hit"):
                        await conn.execute("UPDATE alerts SET status='triggered' WHERE id=$1", alert["id"])
                    print(f"[ALERTS] Fired: {alert['name']} → {msg[:80]}")

            except Exception as e:
                print(f"[ALERTS] Error checking alert {alert['id']}: {e}")
                continue

        print(f"[ALERTS] Check complete.")


# ── Alert API Endpoints ─────────────────────────────────────────────────────

@app.post("/api/alerts/create", tags=["Alerts & Notifications"], summary="Create an alert",
    description="Create a price alert, strategy signal alert, or sector rotation alert. Supports conditions like price_above, price_below, rsi_oversold, volume_spike, etc.")
async def create_alert(req: Request, user=Depends(get_current_user)):
    body = await req.json()
    name = body.get("name", "").strip()
    alert_type = body.get("alert_type", "").strip()
    entity_type = body.get("entity_type", "").strip()
    if not name or not alert_type:
        raise HTTPException(status_code=400, detail="Name and alert_type required")

    async with db_pool.acquire() as conn:
        aid = await conn.fetchval("""
            INSERT INTO alerts (user_id, name, alert_type, entity_type, entity_id, symbol, conditions, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'active') RETURNING id
        """, user["id"], name, alert_type, entity_type,
            body.get("entity_id"), body.get("symbol"),
            json.dumps(body.get("conditions", {})))
        return {"id": aid, "message": f"Alert '{name}' created"}


@app.get("/api/alerts", tags=["Alerts & Notifications"], summary="List alerts",
    description="List all alerts for the authenticated user with their current status (active/triggered/paused).")
async def list_alerts(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        alerts = await conn.fetch(
            "SELECT * FROM alerts WHERE user_id=$1 ORDER BY created_at DESC", user["id"]
        )
        return [_safe_row(a) for a in alerts]


@app.delete("/api/alerts/{aid}", tags=["Alerts & Notifications"], summary="Delete alert",
    description="Delete a specific alert.")
async def delete_alert(aid: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM alerts WHERE id=$1 AND user_id=$2", aid, user["id"])
        return {"deleted": True}


@app.put("/api/alerts/{aid}/toggle", tags=["Alerts & Notifications"], summary="Toggle alert on/off",
    description="Toggle an alert between active and paused status.")
async def toggle_alert(aid: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        alert = await conn.fetchrow("SELECT status FROM alerts WHERE id=$1 AND user_id=$2", aid, user["id"])
        if not alert: raise HTTPException(status_code=404, detail="Not found")
        new_status = "paused" if alert["status"] == "active" else "active"
        await conn.execute("UPDATE alerts SET status=$1 WHERE id=$2", new_status, aid)
        return {"status": new_status}


@app.get("/api/notifications", tags=["Alerts & Notifications"], summary="Get notifications",
    description="Get recent notifications for the authenticated user — triggered alerts, system messages, and activity updates. Ordered by most recent.")
async def get_notifications(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        notifs = await conn.fetch(
            "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
            user["id"]
        )
        unread = await conn.fetchval(
            "SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=false", user["id"]
        )
        return {"notifications": [_safe_row(n) for n in notifs], "unread_count": unread}


@app.post("/api/notifications/read-all", tags=["Alerts & Notifications"], summary="Mark all notifications read",
    description="Mark all unread notifications as read for the authenticated user.")
async def mark_all_read(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE notifications SET is_read=true WHERE user_id=$1 AND is_read=false", user["id"])
        return {"marked": True}


@app.post("/api/notifications/{nid}/read", tags=["Alerts & Notifications"], summary="Mark notification read",
    description="Mark a specific notification as read.")
async def mark_read(nid: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2", nid, user["id"])
        return {"marked": True}


# ── Admin Routes ──────────────────────────────────────────────────────────────
@app.get("/api/admin/stats", tags=["Admin"], summary="Platform statistics",
    description="Admin only. Returns platform-wide stats — total users, active sessions, backtests run, screener usage, storage, and system health.")
async def admin_stats(user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        users = await conn.fetchval("SELECT COUNT(*) FROM users WHERE is_admin=false")
        backtests = await conn.fetchval("SELECT COUNT(*) FROM backtests")
        trades = await conn.fetchval("SELECT COUNT(*) FROM paper_trades")
        inv_used = await conn.fetchval("SELECT COUNT(*) FROM invite_codes WHERE used_by IS NOT NULL")
        inv_total = await conn.fetchval("SELECT COUNT(*) FROM invite_codes")
        return {"users": users, "backtests": backtests, "paper_trades": trades,
                "invites_used": inv_used, "invites_available": inv_total-inv_used, "capacity": f"{users}/{MAX_USERS}"}

@app.get("/api/admin/users", tags=["Admin"], summary="List all users",
    description="Admin only. List all registered users with their activity stats, last login, and account status.")
async def admin_users(user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT id,email,name,is_active,created_at FROM users ORDER BY created_at DESC")
        return [dict(r) for r in rows]

@app.post("/api/admin/invite", tags=["Admin"], summary="Generate invite codes",
    description="Admin only. Generate new invite codes for user registration. Specify count (1-50).")
async def create_invites(req: InviteRequest, user=Depends(get_admin_user)):
    codes = []
    async with db_pool.acquire() as conn:
        for _ in range(min(req.count, 20)):
            code = secrets.token_urlsafe(8).upper()
            await conn.execute("INSERT INTO invite_codes (code,created_by) VALUES ($1,$2)", code, user["id"])
            codes.append(code)
    return {"codes": codes, "count": len(codes)}

@app.get("/api/admin/invites", tags=["Admin"], summary="List invite codes",
    description="Admin only. List all generated invite codes with usage status.")
async def list_invites(user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM invite_codes ORDER BY created_at DESC")
        return [dict(r) for r in rows]

@app.post("/api/admin/user/{user_id}/deactivate", tags=["Admin"], summary="Deactivate user",
    description="Admin only. Deactivate a user account, preventing login.")
async def deactivate_user(user_id: int, user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE users SET is_active=false WHERE id=$1", user_id)
        return {"message": "User deactivated"}

@app.get("/api/morning-brief", tags=["Market Intelligence"], summary="Pre-market morning brief",
    description="Global cues (S&P 500, Dow, NASDAQ, Crude, Gold, USD/INR), India indices (NIFTY 50, BANK NIFTY), sector pulse (top 3 gainers/losers), screener picks (momentum, oversold, breakout), and composite sentiment score. Cached 15 min.")
async def morning_brief(user=Depends(get_current_user)):
    """Pre-market morning brief with global cues (S&P 500, Dow, NASDAQ, Crude, Gold, USD/INR), India indices (NIFTY 50, BANK NIFTY), sector pulse (top 3 gainers/losers), screener picks (momentum, oversold, breakout), and composite sentiment score. Cached in Redis for 15 minutes. Screener picks may be empty when market is closed."""
    import yfinance as yf  # kept: global tickers (^GSPC, CL=F etc) not in data service
    from datetime import date as _date
    cache_key = "morning_brief:" + _date.today().isoformat()
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached: return json.loads(cached)
    loop = asyncio.get_event_loop()
    global_tickers = {
        "sp500": {"sym": "^GSPC", "name": "S&P 500"},
        "dow": {"sym": "^DJI", "name": "Dow Jones"},
        "nasdaq": {"sym": "^IXIC", "name": "NASDAQ"},
        "crude": {"sym": "CL=F", "name": "Crude Oil (WTI)"},
        "gold": {"sym": "GC=F", "name": "Gold"},
        "usdinr": {"sym": "USDINR=X", "name": "USD/INR"},
    }
    global_cues = {}
    for key, info in global_tickers.items():
        try:
            tk = await loop.run_in_executor(None, lambda s=info["sym"]: yf.Ticker(s).history(period="5d"))
            if not tk.empty and len(tk) >= 2:
                last = round(float(tk["Close"].iloc[-1]), 2)
                prev = round(float(tk["Close"].iloc[-2]), 2)
                chg = round((last - prev) / prev * 100, 2) if prev else 0
                global_cues[key] = {"name": info["name"], "price": last, "prev": prev, "change_pct": chg}
        except: pass
    india = {}
    for key, sym, name in [("nifty","^NSEI","NIFTY 50"),("banknifty","^NSEBANK","BANK NIFTY")]:
        try:
            tk = await loop.run_in_executor(None, lambda s=sym: yf.Ticker(s).history(period="5d"))
            if not tk.empty and len(tk) >= 2:
                last = round(float(tk["Close"].iloc[-1]), 2)
                prev = round(float(tk["Close"].iloc[-2]), 2)
                high = round(float(tk["High"].iloc[-1]), 2)
                low = round(float(tk["Low"].iloc[-1]), 2)
                chg = round((last - prev) / prev * 100, 2) if prev else 0
                india[key] = {"name": name, "close": last, "prev": prev, "high": high, "low": low, "change_pct": chg}
        except: pass
    sector_pulse = {"gainers": [], "losers": []}
    try:
        sector_perf = []
        sample_sectors = {}
        for sym, sec in SECTOR_MAP.items():
            if sec and sec != "Others":
                sample_sectors.setdefault(sec, []).append(sym)
        for sec, syms in list(sample_sectors.items())[:15]:
            changes = []
            for s in syms[:3]:
                try:
                    tk = await loop.run_in_executor(None, lambda s=s: yf.Ticker(s+".NS").history(period="2d"))
                    if not tk.empty and len(tk) >= 2:
                        c = float(tk["Close"].iloc[-1])
                        p = float(tk["Close"].iloc[-2])
                        changes.append((c - p) / p * 100 if p else 0)
                except: pass
            if changes:
                avg = round(sum(changes) / len(changes), 2)
                sector_perf.append({"sector": sec, "change_pct": avg})
        sector_perf.sort(key=lambda x: x["change_pct"], reverse=True)
        sector_pulse["gainers"] = sector_perf[:3]
        sector_pulse["losers"] = sector_perf[-3:]
    except: pass
    top_picks = {"momentum": [], "oversold": [], "breakout": []}
    for strat in ["momentum", "oversold", "breakout"]:
        try:
            ck = f"screener:{__import__('datetime').date.today().isoformat()}:{strat}:50:10000:"
            if redis_client:
                cv = await redis_client.get(ck)
                if cv:
                    results = json.loads(cv)
                    top_picks[strat] = results[:5] if isinstance(results, list) else []
        except: pass
    us_avg = 0
    us_count = 0
    for k in ["sp500", "dow", "nasdaq"]:
        if k in global_cues:
            us_avg += global_cues[k]["change_pct"]
            us_count += 1
    us_avg = us_avg / us_count if us_count else 0
    crude_chg = global_cues.get("crude", {}).get("change_pct", 0)
    nifty_chg = india.get("nifty", {}).get("change_pct", 0)
    sentiment_score = 0
    signals = []
    if us_avg > 0.5: sentiment_score += 2; signals.append("US markets positive")
    elif us_avg < -0.5: sentiment_score -= 2; signals.append("US markets negative")
    else: signals.append("US markets flat")
    if crude_chg > 2: sentiment_score -= 1; signals.append("Crude up sharply (negative for India)")
    elif crude_chg < -2: sentiment_score += 1; signals.append("Crude down (positive for India)")
    if nifty_chg > 0.5: sentiment_score += 1; signals.append("NIFTY closed positive")
    elif nifty_chg < -0.5: sentiment_score -= 1; signals.append("NIFTY closed negative")
    gold_chg = global_cues.get("gold", {}).get("change_pct", 0)
    if gold_chg > 1: signals.append("Gold rallying (risk-off sentiment)")
    if sentiment_score >= 2: mood = "BULLISH"
    elif sentiment_score >= 1: mood = "MILDLY BULLISH"
    elif sentiment_score <= -2: mood = "BEARISH"
    elif sentiment_score <= -1: mood = "MILDLY BEARISH"
    else: mood = "NEUTRAL"
    sentiment = {"mood": mood, "score": sentiment_score, "signals": signals}
    import math
    def _sanitize(obj):
        if isinstance(obj, float):
            if math.isnan(obj) or math.isinf(obj): return 0
            return obj
        if isinstance(obj, dict): return {k: _sanitize(v) for k, v in obj.items()}
        if isinstance(obj, list): return [_sanitize(v) for v in obj]
        return obj

    result = _sanitize({
        "date": _date.today().isoformat(),
        "generated_at": datetime.now().strftime("%I:%M %p"),
        "global_cues": global_cues,
        "india": india,
        "sector_pulse": sector_pulse,
        "top_picks": top_picks,
        "sentiment": sentiment,
    })
    if redis_client:
        await redis_client.setex(cache_key, 900, json.dumps(result))
    return result


# ==============================================================================
# STOCK COMPARISON TOOL
# ==============================================================================

@app.get("/api/compare")
async def compare_stocks(symbols: str, user=Depends(get_current_user)):
    """Multi-stock comparison. Pass comma-separated NSE symbols (e.g., symbols=TCS,INFY,WIPRO). Returns price, P/E, P/B, ROE, market cap, sector, and other fundamentals side-by-side. Frontend panel not yet built — API only."""
    # yfinance replaced by data service
    from datetime import date as _date
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()][:5]
    if len(sym_list) < 2:
        raise HTTPException(400, "Need at least 2 symbols separated by commas")
    loop = asyncio.get_event_loop()
    results = []
    for sym in sym_list:
        cache_key = f"compare:{sym}:{_date.today().isoformat()}"
        cached = None
        if redis_client:
            cached = await redis_client.get(cache_key)
        if cached:
            results.append(json.loads(cached))
            continue
        try:
            info_raw = await ds_fundamentals(sym)
            info = {
                "shortName": (info_raw or {}).get("name", sym),
                "sector": (info_raw or {}).get("sector", ""),
                "industry": (info_raw or {}).get("industry", ""),
                "currentPrice": (info_raw or {}).get("price", 0),
                "marketCap": (info_raw or {}).get("market_cap", 0),
                "trailingPE": (info_raw or {}).get("pe_trailing", 0),
                "forwardPE": (info_raw or {}).get("pe_forward", 0),
                "priceToBook": (info_raw or {}).get("pb", 0),
                "returnOnEquity": (info_raw or {}).get("roe", 0),
                "debtToEquity": (info_raw or {}).get("debt_equity", 0),
                "dividendYield": (info_raw or {}).get("dividend_yield", 0),
                "trailingEps": (info_raw or {}).get("eps", 0),
                "revenueGrowth": (info_raw or {}).get("revenue_growth", 0),
                "earningsGrowth": (info_raw or {}).get("earnings_growth", 0),
                "bookValue": (info_raw or {}).get("book_value", 0),
                "beta": (info_raw or {}).get("beta", 0),
                "fiftyTwoWeekHigh": (info_raw or {}).get("high_52w", 0),
                "fiftyTwoWeekLow": (info_raw or {}).get("low_52w", 0),
                "profitMargins": (info_raw or {}).get("profit_margin", 0),
                "operatingMargins": (info_raw or {}).get("operating_margin", 0),
            }
            from datetime import date as _d2, timedelta as _td2
            hist = await ds_ohlcv(sym, "1y")
            if hist:
                import pandas as _pd2
                hist = _pd2.DataFrame(hist)
                hist.columns = [c.lower() for c in hist.columns]
                for dc in ["date","datetime","timestamp"]:
                    if dc in hist.columns:
                        hist[dc] = _pd2.to_datetime(hist[dc])
                        hist = hist.set_index(dc)
                        break
            else:
                hist = pd.DataFrame()
            perf_1m = perf_3m = perf_6m = perf_1y = 0
            if not hist.empty and len(hist) > 20:
                cur = float(hist["Close"].iloc[-1])
                if len(hist) > 21: perf_1m = round((cur / float(hist["Close"].iloc[-22]) - 1) * 100, 1)
                if len(hist) > 63: perf_3m = round((cur / float(hist["Close"].iloc[-64]) - 1) * 100, 1)
                if len(hist) > 126: perf_6m = round((cur / float(hist["Close"].iloc[-127]) - 1) * 100, 1)
                if len(hist) > 240: perf_1y = round((cur / float(hist["Close"].iloc[0]) - 1) * 100, 1)
            data = {
                "symbol": sym,
                "name": info.get("shortName", sym),
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "price": info.get("currentPrice", 0),
                "market_cap": info.get("marketCap", 0),
                "pe": round(info.get("trailingPE", 0) or 0, 1),
                "forward_pe": round(info.get("forwardPE", 0) or 0, 1),
                "pb": round(info.get("priceToBook", 0) or 0, 1),
                "roe": round((info.get("returnOnEquity", 0) or 0) * 100, 1),
                "debt_equity": round(info.get("debtToEquity", 0) or 0, 1),
                "div_yield": round((info.get("dividendYield", 0) or 0) * 100 if info.get("dividendYield",0) and info.get("dividendYield",0) < 1 else (info.get("dividendYield",0) or 0), 2),
                "eps": round(info.get("trailingEps", 0) or 0, 1),
                "revenue_growth": round((info.get("revenueGrowth", 0) or 0) * 100, 1),
                "earnings_growth": round((info.get("earningsGrowth", 0) or 0) * 100, 1),
                "beta": round(info.get("beta", 0) or 0, 2),
                "high_52w": info.get("fiftyTwoWeekHigh", 0),
                "low_52w": info.get("fiftyTwoWeekLow", 0),
                "book_value": round(info.get("bookValue", 0) or 0, 1),
                "free_cashflow": info.get("freeCashflow", 0),
                "perf_1m": perf_1m, "perf_3m": perf_3m, "perf_6m": perf_6m, "perf_1y": perf_1y,
            }
            results.append(data)
            if redis_client:
                await redis_client.setex(cache_key, 3600, json.dumps(data))
        except Exception as e:
            results.append({"symbol": sym, "error": str(e)})
    return {"stocks": results, "count": len(results)}


# ==============================================================================
# SECTOR HEATMAP
# ==============================================================================

@app.get("/api/sector-heatmap", tags=["Market Intelligence"], summary="Sector heatmap",
    description="Sector-wise performance heatmap showing 1-day returns for all 49 sectors. Cached 15 min.")
async def sector_heatmap(user=Depends(get_current_user)):
    """Sector rotation heatmap via data service. Cached 15 minutes."""
    # yfinance replaced by data service
    from datetime import date as _date
    cache_key = "sector_heatmap:" + _date.today().isoformat()
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached: return json.loads(cached)
    loop = asyncio.get_event_loop()
    sector_data = {}
    sample = {}
    for sym, sec in SECTOR_MAP.items():
        if sec and sec != "Others":
            sample.setdefault(sec, []).append(sym)
    heatmap = []
    for sec, syms in list(sample.items())[:20]:
        changes = []
        stocks_detail = []
        for s in syms[:5]:
            try:
                _sq = await ds_quote(s)
                if _sq and _sq.get("price"):
                    cur = float(_sq["price"])
                    prev = cur - float(_sq.get("change", 0))
                    chg = round((cur - prev) / prev * 100, 2) if prev else 0
                    changes.append(chg)
                    stocks_detail.append({"symbol": s, "price": round(cur, 2), "change": chg})
            except: pass
        if changes:
            avg = round(sum(changes) / len(changes), 2)
            heatmap.append({"sector": sec, "change_pct": avg, "stock_count": len(SECTOR_SYMBOLS.get(sec, [])), "top_stocks": sorted(stocks_detail, key=lambda x: x["change"], reverse=True)[:3]})
    heatmap.sort(key=lambda x: x["change_pct"], reverse=True)
    result = {"date": _date.today().isoformat(), "sectors": heatmap}
    if redis_client:
        await redis_client.setex(cache_key, 900, json.dumps(result))
    return result


# ==============================================================================
# DCF / INTRINSIC VALUE CALCULATOR
# ==============================================================================


async def ds_quote_fn(sym):
    """Get live quote from Data Service."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"http://localhost:5004/data/equity/quote/{sym}", headers={"X-API-Key": "alpha_data_internal_2026"})
            if r.status_code == 200:
                return r.json()
    except:
        pass
    return None

@app.get("/api/dcf/{symbol}", tags=["Market Intelligence"], summary="DCF intrinsic value calculator",
    description="Three-method valuation: EPS-based DCF, FCF-based DCF, and Graham Number. Returns intrinsic values, average fair value, margin of safety %, and verdict. Set growth_rate=0 for auto-detect.")
async def dcf_calculator(symbol: str, growth_rate: float = 0, discount_rate: float = 12, terminal_growth: float = 3, years: int = 10, user=Depends(get_current_user)):
    """DCF intrinsic value calculator. Three methods: EPS-based DCF, FCF-based DCF, and Graham Number. Set growth_rate=0 for auto-detect from earnings history. Returns intrinsic values, average fair value, margin of safety %, and verdict (UNDERVALUED / FAIRLY VALUED / OVERVALUED)."""
    import math
    sym = symbol.upper()
    try:
        info = await ds_fundamentals(sym)
        if not info or not info.get("symbol"):
            raise Exception("empty")
    except:
        try:
            import yfinance as yf
            loop = asyncio.get_event_loop()
            tk = await loop.run_in_executor(None, lambda: yf.Ticker(sym+".NS"))
            info = await loop.run_in_executor(None, lambda: tk.info)
        except:
            raise HTTPException(404, f"Could not fetch data for {sym}")
    eps = info.get("eps") or info.get("trailingEps", 0) or 0
    price = info.get("price") or info.get("currentPrice", 0) or 0
    pe = info.get("pe_trailing") or info.get("trailingPE", 0) or 0
    fcf = info.get("free_cashflow") or info.get("freeCashflow", 0) or 0
    shares = info.get("shares_outstanding") or info.get("sharesOutstanding", 0) or 0
    # Handle both formats: data service returns % directly, Yahoo returns decimal
    _rg = info.get("revenue_growth") or info.get("revenueGrowth", 0) or 0
    _eg = info.get("earnings_growth") or info.get("earningsGrowth", 0) or 0
    rev_growth = _rg if abs(_rg) > 1 else _rg * 100  # Already % if > 1
    earn_growth = _eg if abs(_eg) > 1 else _eg * 100
    bv = info.get("book_value") or info.get("bookValue", 0) or 0
    _roe_raw = info.get("roe") or info.get("returnOnEquity", 0) or 0
    roe = _roe_raw if abs(_roe_raw) > 1 else _roe_raw * 100  # Already % if > 1
    # Fix dividend_yield: data service sometimes returns wrong values
    _dy = info.get("dividend_yield") or info.get("dividendYield", 0) or 0
    if _dy > 15: _dy = _dy / 100  # Likely raw percentage, normalize
    if growth_rate == 0:
        growth_rate = max(5, min(25, earn_growth if earn_growth > 0 else rev_growth))
    dr = discount_rate / 100
    tg = terminal_growth / 100
    gr = growth_rate / 100
    # EPS-based DCF
    eps_projections = []
    pv_sum = 0
    for y in range(1, years + 1):
        proj_eps = eps * ((1 + gr) ** y)
        pv = proj_eps / ((1 + dr) ** y)
        pv_sum += pv
        eps_projections.append({"year": y, "eps": round(proj_eps, 2), "pv": round(pv, 2)})
    terminal_eps = eps * ((1 + gr) ** years) * (1 + tg)
    terminal_value = terminal_eps / (dr - tg) if dr > tg else 0
    pv_terminal = terminal_value / ((1 + dr) ** years)
    intrinsic_eps = round(pv_sum + pv_terminal, 2)
    # FCF-based DCF
    intrinsic_fcf = 0
    fcf_per_share = round(fcf / shares, 2) if shares else 0
    if fcf_per_share > 0:
        fcf_pv = 0
        for y in range(1, years + 1):
            proj = fcf_per_share * ((1 + gr) ** y)
            fcf_pv += proj / ((1 + dr) ** y)
        t_fcf = fcf_per_share * ((1 + gr) ** years) * (1 + tg)
        tv_fcf = t_fcf / (dr - tg) if dr > tg else 0
        pv_tv = tv_fcf / ((1 + dr) ** years)
        intrinsic_fcf = round(fcf_pv + pv_tv, 2)
    # Graham Number
    graham = round(math.sqrt(22.5 * max(0, eps) * max(0, bv)), 2) if eps > 0 and bv > 0 else 0
    # Margin of safety
    avg_intrinsic = round((intrinsic_eps + (intrinsic_fcf if intrinsic_fcf > 0 else intrinsic_eps)) / 2, 2)
    margin = round((avg_intrinsic - price) / avg_intrinsic * 100, 1) if avg_intrinsic > 0 else 0
    verdict = "UNDERVALUED" if margin > 15 else ("FAIRLY VALUED" if margin > -10 else "OVERVALUED")
    # Live price override from Data Service quote
    try:
        ds_quote = await ds_quote_fn(sym)
        if ds_quote and ds_quote.get("price", 0) > 0:
            price = ds_quote["price"]
            if eps > 0:
                pe = round(price / eps, 1)
    except:
        pass  # Keep fundamentals price as fallback

    # FCF plausibility guard — check financial_currency
    fcf_note = ""
    fin_currency = info.get("financial_currency", "INR")
    if fin_currency and fin_currency != "INR" and intrinsic_fcf > 0:
        fcf_note = f"FCF data is in {fin_currency}. Value may not be directly comparable to INR stock price."
        intrinsic_fcf = 0  # Do not use for average

    # EPV (Earnings Power Value) fallback
    epv_value = 0
    if eps > 0 and dr > 0:
        epv_value = round(eps / dr, 2)

    # Recalculate average with EPV as fallback when FCF is zero
    methods_used = [intrinsic_eps]
    if intrinsic_fcf > 0:
        methods_used.append(intrinsic_fcf)
    if epv_value > 0 and intrinsic_fcf <= 0:
        methods_used.append(epv_value)
    avg_intrinsic = round(sum(methods_used) / len(methods_used), 2) if methods_used else 0
    margin = round((avg_intrinsic - price) / avg_intrinsic * 100, 1) if avg_intrinsic > 0 else 0
    verdict = "UNDERVALUED" if margin > 15 else ("FAIRLY VALUED" if margin > -10 else "OVERVALUED")

    # Narration
    narration_parts = []
    narration_parts.append(f"{info.get('shortName', sym)} trades at Rs.{price:.0f} (PE {pe:.1f}x).")
    if intrinsic_eps > 0:
        prem_disc = "below" if price < intrinsic_eps else "above"
        narration_parts.append(f"EPS-based DCF values it at Rs.{intrinsic_eps:.0f}, current price is {abs(round((price/intrinsic_eps-1)*100))}% {prem_disc} this.")
    if intrinsic_fcf > 0:
        narration_parts.append(f"FCF-based DCF gives Rs.{intrinsic_fcf:.0f} per share.")
    elif fcf_note:
        narration_parts.append(fcf_note)
    elif epv_value > 0:
        narration_parts.append(f"FCF data unavailable; EPV (earnings capitalized at {discount_rate}%) gives Rs.{epv_value:.0f}.")
    if graham > 0:
        narration_parts.append(f"Graham Number is Rs.{graham:.0f}.")
    narration_parts.append(f"Average fair value: Rs.{avg_intrinsic:.0f}. Margin of safety: {margin}%. Verdict: {verdict}.")
    narration = " ".join(narration_parts)

    return {
        "symbol": sym, "price": price, "cmp": price, "eps": eps, "pe": round(pe, 1),
        "book_value": bv, "roe": round(roe, 1),
        "fcf_per_share": fcf_per_share,
        "assumptions": {"growth_rate": growth_rate, "discount_rate": discount_rate, "terminal_growth": terminal_growth, "years": years},
        "eps_dcf": {"intrinsic_value": intrinsic_eps, "projections": eps_projections, "terminal_value": round(pv_terminal, 2)},
        "fcf_dcf": {"intrinsic_value": intrinsic_fcf, "note": fcf_note},
        "epv": {"value": epv_value, "method": f"EPS / discount_rate ({discount_rate}%)"},
        "graham_number": graham,
        "avg_intrinsic": avg_intrinsic,
        "margin_of_safety": margin,
        "verdict": verdict,
        "narration": narration,
        "company": info.get("shortName", sym), "sector": info.get("sector", ""),
    }


# ==============================================================================
# DIVIDEND TRACKER
# ==============================================================================

@app.get("/api/dividends", tags=["Market Intelligence"], summary="Top dividend stocks",
    description="30 major Indian stocks sorted by dividend yield. Returns yield %, rate, payout ratio, P/E, market cap, sector, and ex-dividend dates. Cached 1 hour.")
async def dividend_tracker(user=Depends(get_current_user)):
    """Dividend tracker for 30 major Indian stocks sorted by yield. Uses Data Service for fundamentals + live prices."""
    from datetime import date as _date
    cache_key = "dividends:" + _date.today().isoformat()
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached: return json.loads(cached)

    top_div = ["COALINDIA","VEDL","IOC","HINDPETRO","BPCL","ONGC","NTPC","POWERGRID","GAIL","RECLTD",
               "PFC","NHPC","SAIL","NMDC","HDFCBANK","ICICIBANK","SBIN","ITC","TCS","INFY",
               "WIPRO","BAJAJ-AUTO","HEROMOTOCO","MARUTI","TATAMOTORS","RELIANCE","LT","TITAN","HINDALCO","TATASTEEL"]

    # Parallel DS fundamentals fetch
    import httpx as _hx
    async def _fetch_fund(sym):
        try:
            async with _hx.AsyncClient(timeout=5) as cl:
                r = await cl.get(f"http://localhost:5004/data/equity/fundamentals/{sym}",
                                 headers={"X-API-Key": "alpha_data_internal_2026"})
                if r.status_code == 200:
                    return sym, r.json()
        except:
            pass
        return sym, None

    # Parallel live quotes
    async def _fetch_quote(sym):
        try:
            async with _hx.AsyncClient(timeout=3) as cl:
                r = await cl.get(f"http://localhost:5004/data/equity/quote/{sym}",
                                 headers={"X-API-Key": "alpha_data_internal_2026"})
                if r.status_code == 200:
                    return sym, r.json()
        except:
            pass
        return sym, None

    fund_tasks = [_fetch_fund(sym) for sym in top_div]
    quote_tasks = [_fetch_quote(sym) for sym in top_div]
    fund_results = await asyncio.gather(*fund_tasks, return_exceptions=True)
    quote_results = await asyncio.gather(*quote_tasks, return_exceptions=True)

    quotes = {}
    for item in quote_results:
        if isinstance(item, tuple) and item[1]:
            quotes[item[0]] = item[1]

    dividends = []
    for item in fund_results:
        if isinstance(item, Exception) or not isinstance(item, tuple):
            continue
        sym, info = item
        if not info:
            continue
        try:
            # Live price from quote, fallback to fundamentals
            live = quotes.get(sym, {})
            price = live.get("price", 0) or info.get("price", 0) or 0
            if price <= 0:
                continue

            # Dividend yield: DS returns raw amount, not %. Always compute from rate/price.
            div_rate = info.get("dividend_rate", 0) or 0
            dy_raw = 0
            if div_rate > 0 and price > 0:
                dy_raw = round(div_rate / price * 100, 2)
            else:
                # Fallback: DS dividend_yield might be raw amount or %
                ds_dy = info.get("dividend_yield", 0) or 0
                if ds_dy > 0 and price > 0:
                    # If value is larger than 20, it is likely a raw amount not a %
                    if ds_dy > 20:
                        dy_raw = round(ds_dy / price * 100, 2)
                    elif ds_dy > 1:
                        dy_raw = round(ds_dy, 2)  # Already %
                    else:
                        dy_raw = round(ds_dy * 100, 2)  # Decimal

            pe = info.get("pe_trailing", 0) or info.get("pe_ratio", 0) or 0
            if pe <= 0 and price > 0:
                eps = info.get("eps", 0) or 0
                if eps > 0:
                    pe = round(price / eps, 1)

            dividends.append({
                "symbol": sym,
                "name": info.get("company_name", info.get("shortName", sym)),
                "sector": info.get("sector", ""),
                "price": round(price, 2),
                "dividend_rate": round(div_rate, 2) if div_rate else 0,
                "dividend_yield": round(dy_raw, 2),
                "ex_dividend_date": info.get("ex_dividend_date", ""),
                "upcoming": False,
                "payout_ratio": round(info.get("payout_ratio", 0) or 0, 1),
                "pe": round(pe, 1),
                "market_cap": info.get("market_cap", 0) or 0,
            })
        except:
            pass

    dividends.sort(key=lambda x: x["dividend_yield"], reverse=True)
    upcoming = [d for d in dividends if d.get("upcoming")]
    result = {
        "date": _date.today().isoformat(),
        "by_yield": dividends,
        "upcoming_ex_dates": upcoming,
        "count": len(dividends),
    }
    if redis_client:
        await redis_client.setex(cache_key, 3600, json.dumps(result))
    return result


@app.get("/api/patterns/{symbol}", tags=["Market Intelligence"], summary="Technical pattern scanner",
    description="Analyses 11 technical indicators and detects 8 chart patterns (Double Bottom/Top, Cup & Handle, H&S, Triangles, Wedges). Returns composite score (-100 to +100), pattern stages, targets, and narrative.")
async def detect_patterns(symbol: str, user=Depends(get_current_user)):
    """Technical pattern scanner. Analyses 11 indicators (SMA, EMA, RSI, MACD, Bollinger, Stochastic, Volume, Supertrend, ADX, Williams %R, CCI, OBV) and detects 8 chart patterns (Double Bottom/Top, Cup & Handle, Head & Shoulders, Ascending/Descending Triangle, Falling/Rising Wedge). Returns composite score (-100 to +100), pattern stages, targets, and auto-generated narrative."""
    # import yfinance as yf  # moved to fallback block
    import ta
    from datetime import date as _date
    sym = symbol.upper()
    cache_key = f"patterns:{sym}:{_date.today().isoformat()}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached: return json.loads(cached)
    try:
        info = await ds_fundamentals(sym) or {}
        _rows = await ds_ohlcv(sym, "1y")
        if _rows:
            hist = pd.DataFrame(_rows)
            hist.columns = [c.lower() for c in hist.columns]
            for dc in ["date","datetime","timestamp"]:
                if dc in hist.columns:
                    hist[dc] = pd.to_datetime(hist[dc])
                    hist = hist.set_index(dc)
                    break
        else:
            hist = pd.DataFrame()
        if hist.empty:
            raise Exception("empty")
    except:
        try:
            import yfinance as yf
            loop = asyncio.get_event_loop()
            tk = await loop.run_in_executor(None, lambda: yf.Ticker(sym+".NS"))
            info = await loop.run_in_executor(None, lambda: tk.info) or {}
            hist = await loop.run_in_executor(None, lambda: tk.history(period="1y"))
            if not hist.empty:
                hist.columns = [c.lower() for c in hist.columns]
        except:
            raise HTTPException(404, f"No data for {sym}")
    if hist.empty or len(hist) < 50:
        raise HTTPException(404, f"Insufficient data for {sym}")
    c_price = float(hist["close"].iloc[-1])
    h, l, cl, vol = hist["high"], hist["low"], hist["close"], hist["volume"]
    signals = []
    patterns = []
    # Moving Averages
    sma20 = float(cl.rolling(20).mean().iloc[-1])
    sma50 = float(cl.rolling(50).mean().iloc[-1])
    sma200 = float(cl.rolling(200).mean().iloc[-1]) if len(cl) >= 200 else 0
    ema12 = float(cl.ewm(span=12).mean().iloc[-1])
    ema26 = float(cl.ewm(span=26).mean().iloc[-1])
    if c_price > sma20 > sma50: signals.append({"signal":"BULLISH","name":"Price above SMA 20 & 50","strength":"strong"})
    elif c_price < sma20 < sma50: signals.append({"signal":"BEARISH","name":"Price below SMA 20 & 50","strength":"strong"})
    if sma200 > 0:
        if c_price > sma200: signals.append({"signal":"BULLISH","name":"Trading above 200 DMA","strength":"moderate"})
        else: signals.append({"signal":"BEARISH","name":"Trading below 200 DMA","strength":"moderate"})
    # Golden/Death Cross
    sma50_prev = float(cl.rolling(50).mean().iloc[-5])
    sma200_prev = float(cl.rolling(200).mean().iloc[-5]) if len(cl) >= 200 else 0
    if sma200 > 0:
        if sma50 > sma200 and sma50_prev <= sma200_prev:
            patterns.append({"pattern":"Golden Cross","type":"BULLISH","description":"50 DMA crossed above 200 DMA","reliability":"high"})
        elif sma50 < sma200 and sma50_prev >= sma200_prev:
            patterns.append({"pattern":"Death Cross","type":"BEARISH","description":"50 DMA crossed below 200 DMA","reliability":"high"})
    # RSI
    rsi = float(ta.momentum.RSIIndicator(cl, window=14).rsi().iloc[-1])
    rsi_prev = float(ta.momentum.RSIIndicator(cl, window=14).rsi().iloc[-2])
    if rsi < 30: signals.append({"signal":"BULLISH","name":f"RSI Oversold ({rsi:.1f})","strength":"strong"})
    elif rsi > 70: signals.append({"signal":"BEARISH","name":f"RSI Overbought ({rsi:.1f})","strength":"strong"})
    elif rsi > 50: signals.append({"signal":"BULLISH","name":f"RSI Bullish ({rsi:.1f})","strength":"weak"})
    else: signals.append({"signal":"BEARISH","name":f"RSI Bearish ({rsi:.1f})","strength":"weak"})
    # RSI Divergence
    price_higher = c_price > float(cl.iloc[-10])
    rsi_lower = rsi < float(ta.momentum.RSIIndicator(cl, window=14).rsi().iloc[-10])
    if price_higher and rsi_lower:
        patterns.append({"pattern":"Bearish RSI Divergence","type":"BEARISH","description":"Price making higher highs but RSI making lower highs","reliability":"moderate"})
    price_lower = c_price < float(cl.iloc[-10])
    rsi_higher = rsi > float(ta.momentum.RSIIndicator(cl, window=14).rsi().iloc[-10])
    if price_lower and rsi_higher:
        patterns.append({"pattern":"Bullish RSI Divergence","type":"BULLISH","description":"Price making lower lows but RSI making higher lows","reliability":"moderate"})
    # MACD
    macd_line = float(ta.trend.MACD(cl).macd().iloc[-1])
    macd_signal = float(ta.trend.MACD(cl).macd_signal().iloc[-1])
    macd_hist = float(ta.trend.MACD(cl).macd_diff().iloc[-1])
    macd_hist_prev = float(ta.trend.MACD(cl).macd_diff().iloc[-2])
    if macd_line > macd_signal: signals.append({"signal":"BULLISH","name":"MACD above signal line","strength":"moderate"})
    else: signals.append({"signal":"BEARISH","name":"MACD below signal line","strength":"moderate"})
    if macd_hist > 0 and macd_hist_prev <= 0:
        patterns.append({"pattern":"MACD Bullish Crossover","type":"BULLISH","description":"MACD histogram turned positive","reliability":"moderate"})
    elif macd_hist < 0 and macd_hist_prev >= 0:
        patterns.append({"pattern":"MACD Bearish Crossover","type":"BEARISH","description":"MACD histogram turned negative","reliability":"moderate"})
    # Bollinger Bands
    bb = ta.volatility.BollingerBands(cl, window=20, window_dev=2)
    bb_upper = float(bb.bollinger_hband().iloc[-1])
    bb_lower = float(bb.bollinger_lband().iloc[-1])
    bb_mid = float(bb.bollinger_mavg().iloc[-1])
    bb_width = (bb_upper - bb_lower) / bb_mid * 100
    bb_width_prev = float((bb.bollinger_hband().iloc[-20] - bb.bollinger_lband().iloc[-20]) / bb.bollinger_mavg().iloc[-20] * 100)
    if c_price >= bb_upper: signals.append({"signal":"BEARISH","name":"Price at upper Bollinger Band","strength":"moderate"})
    elif c_price <= bb_lower: signals.append({"signal":"BULLISH","name":"Price at lower Bollinger Band","strength":"moderate"})
    if bb_width < bb_width_prev * 0.6:
        patterns.append({"pattern":"Bollinger Squeeze","type":"NEUTRAL","description":"Bands contracting - breakout imminent","reliability":"moderate"})
    # Volume Analysis
    avg_vol = float(vol.rolling(20).mean().iloc[-1])
    cur_vol = float(vol.iloc[-1])
    vol_ratio = round(cur_vol / avg_vol, 1) if avg_vol > 0 else 1
    if vol_ratio > 2: signals.append({"signal":"BULLISH" if c_price > float(cl.iloc[-2]) else "BEARISH","name":f"Volume spike ({vol_ratio}x avg)","strength":"strong"})
    # Supertrend
    atr = ta.volatility.AverageTrueRange(h, l, cl, window=10).average_true_range()
    st_upper = float((h.rolling(10).mean().iloc[-1] + l.rolling(10).mean().iloc[-1])/2 + 3*atr.iloc[-1])
    st_lower = float((h.rolling(10).mean().iloc[-1] + l.rolling(10).mean().iloc[-1])/2 - 3*atr.iloc[-1])
    if c_price > st_lower: signals.append({"signal":"BULLISH","name":"Above Supertrend support","strength":"moderate"})
    else: signals.append({"signal":"BEARISH","name":"Below Supertrend resistance","strength":"moderate"})
    # Support/Resistance from pivots
    pivot = (float(h.iloc[-1]) + float(l.iloc[-1]) + c_price) / 3
    r1 = 2*pivot - float(l.iloc[-1])
    s1 = 2*pivot - float(h.iloc[-1])
    r2 = pivot + (float(h.iloc[-1]) - float(l.iloc[-1]))
    s2 = pivot - (float(h.iloc[-1]) - float(l.iloc[-1]))
    # 52-week position
    high_52w = info.get("fiftyTwoWeekHigh") or info.get("fifty_two_week_high") or info.get("high_52w") or float(cl.rolling(min(252,len(cl))).max().iloc[-1])
    low_52w = info.get("fiftyTwoWeekLow") or info.get("fifty_two_week_low") or info.get("low_52w") or float(cl.rolling(min(252,len(cl))).min().iloc[-1])
    from_high = round((c_price - high_52w)/high_52w*100,1) if high_52w and high_52w > 0 else None
    from_low = round((c_price - low_52w)/low_52w*100,1) if low_52w and low_52w > 0 else None
    if from_high is not None and from_high > -5:
        patterns.append({"pattern":"Near 52-Week High","type":"BULLISH","description":f"{from_high}% from 52W high - strength","reliability":"moderate"})
    if from_low is not None and from_low < 10:
        patterns.append({"pattern":"Near 52-Week Low","type":"BEARISH","description":f"{from_low}% from 52W low - weakness","reliability":"moderate"})
    # Stochastic
    stoch = ta.momentum.StochasticOscillator(h, l, cl, window=14, smooth_window=3)
    stoch_k = float(stoch.stoch().iloc[-1])
    stoch_d = float(stoch.stoch_signal().iloc[-1])
    if stoch_k < 20 and stoch_k > stoch_d:
        patterns.append({"pattern":"Stochastic Bullish Cross in Oversold","type":"BULLISH","description":"K crossed above D below 20","reliability":"high"})
    elif stoch_k > 80 and stoch_k < stoch_d:
        patterns.append({"pattern":"Stochastic Bearish Cross in Overbought","type":"BEARISH","description":"K crossed below D above 80","reliability":"high"})
    # ADX Trend Strength
    adx = float(ta.trend.ADXIndicator(h, l, cl, window=14).adx().iloc[-1])
    if adx > 25: signals.append({"signal":"NEUTRAL","name":f"Strong trend (ADX {adx:.0f})","strength":"info"})
    elif adx < 20: signals.append({"signal":"NEUTRAL","name":f"Weak/No trend (ADX {adx:.0f})","strength":"info"})
    # ══════════ CHART PATTERN DETECTION ══════════
    # Use last 60-120 days of data for pattern detection
    closes = [float(x) for x in cl.iloc[-120:]]
    highs = [float(x) for x in h.iloc[-120:]]
    lows = [float(x) for x in l.iloc[-120:]]
    n = len(closes)

    # Helper: find local peaks and troughs
    def find_peaks(data, order=5):
        peaks = []
        for i in range(order, len(data)-order):
            if all(data[i] >= data[i-j] for j in range(1,order+1)) and all(data[i] >= data[i+j] for j in range(1,order+1)):
                peaks.append((i, data[i]))
        return peaks

    def find_troughs(data, order=5):
        troughs = []
        for i in range(order, len(data)-order):
            if all(data[i] <= data[i-j] for j in range(1,order+1)) and all(data[i] <= data[i+j] for j in range(1,order+1)):
                troughs.append((i, data[i]))
        return troughs

    peaks = find_peaks(closes, 5)
    troughs = find_troughs(closes, 5)

    # ── Double Bottom ──
    if len(troughs) >= 2:
        t1, t2 = troughs[-2], troughs[-1]
        if abs(t1[1] - t2[1]) / t1[1] < 0.03:  # Within 3%
            # Find peak between troughs (neckline)
            mid_peaks = [p for p in peaks if t1[0] < p[0] < t2[0]]
            if mid_peaks:
                neckline = mid_peaks[0][1]
                target = neckline + (neckline - min(t1[1], t2[1]))
                if c_price < neckline:
                    stage = "FORMING"
                    pct_to_pivot = round((neckline - c_price) / c_price * 100, 1)
                    desc = f"Two bottoms at Rs.{t1[1]:,.0f} and Rs.{t2[1]:,.0f}. Neckline at Rs.{neckline:,.0f} ({pct_to_pivot}% above CMP). Breakout above neckline confirms pattern. Target: Rs.{target:,.0f}"
                elif c_price > neckline and c_price < target:
                    stage = "BREAKOUT"
                    pct_to_target = round((target - c_price) / c_price * 100, 1)
                    desc = f"Broke above neckline Rs.{neckline:,.0f}. Target Rs.{target:,.0f} ({pct_to_target}% upside remaining)"
                else:
                    stage = "COMPLETED"
                    desc = f"Pattern completed. Bottoms at Rs.{t1[1]:,.0f}/{t2[1]:,.0f}, neckline Rs.{neckline:,.0f}"
                patterns.append({"pattern": "Double Bottom (W)", "type": "BULLISH", "description": desc, "reliability": "high", "stage": stage, "neckline": round(neckline,2), "target": round(target,2)})

    # ── Double Top ──
    if len(peaks) >= 2:
        p1, p2 = peaks[-2], peaks[-1]
        if abs(p1[1] - p2[1]) / p1[1] < 0.03:
            mid_troughs = [t for t in troughs if p1[0] < t[0] < p2[0]]
            if mid_troughs:
                neckline = mid_troughs[0][1]
                target = neckline - (max(p1[1], p2[1]) - neckline)
                if c_price > neckline:
                    stage = "FORMING"
                    pct_to_pivot = round((c_price - neckline) / c_price * 100, 1)
                    desc = f"Two tops at Rs.{p1[1]:,.0f} and Rs.{p2[1]:,.0f}. Neckline at Rs.{neckline:,.0f} ({pct_to_pivot}% below CMP). Breakdown below neckline confirms. Target: Rs.{target:,.0f}"
                elif c_price < neckline and c_price > target:
                    stage = "BREAKDOWN"
                    desc = f"Broke below neckline Rs.{neckline:,.0f}. Target Rs.{target:,.0f}"
                else:
                    stage = "COMPLETED"
                    desc = f"Pattern completed. Tops at Rs.{p1[1]:,.0f}/{p2[1]:,.0f}"
                patterns.append({"pattern": "Double Top (M)", "type": "BEARISH", "description": desc, "reliability": "high", "stage": stage, "neckline": round(neckline,2), "target": round(target,2)})

    # ── Cup & Handle ──
    if len(troughs) >= 1 and len(peaks) >= 2 and n > 40:
        left_peak = None
        cup_bottom = None
        right_peak = None
        for p in peaks:
            if p[0] < n * 0.3:
                left_peak = p
        if left_peak:
            cup_troughs = [t for t in troughs if t[0] > left_peak[0] and t[0] < n * 0.7]
            if cup_troughs:
                cup_bottom = min(cup_troughs, key=lambda x: x[1])
                right_peaks = [p for p in peaks if p[0] > cup_bottom[0]]
                if right_peaks:
                    right_peak = right_peaks[0]
        if left_peak and cup_bottom and right_peak:
            if abs(left_peak[1] - right_peak[1]) / left_peak[1] < 0.05:
                cup_depth = round((left_peak[1] - cup_bottom[1]) / left_peak[1] * 100, 1)
                if 10 < cup_depth < 35:
                    rim = max(left_peak[1], right_peak[1])
                    target = rim + (rim - cup_bottom[1])
                    if c_price < rim:
                        stage = "HANDLE FORMING"
                        pct_to_pivot = round((rim - c_price) / c_price * 100, 1)
                        desc = f"Cup depth {cup_depth}%. Rim/pivot at Rs.{rim:,.0f} ({pct_to_pivot}% above CMP). Cup bottom Rs.{cup_bottom[1]:,.0f}. Breakout target: Rs.{target:,.0f}"
                    elif c_price >= rim:
                        stage = "BREAKOUT"
                        desc = f"Broke above rim at Rs.{rim:,.0f}. Target Rs.{target:,.0f}. Cup depth was {cup_depth}%"
                    patterns.append({"pattern": "Cup & Handle", "type": "BULLISH", "description": desc, "reliability": "high", "stage": stage, "neckline": round(rim,2), "target": round(target,2)})

    # ── Head & Shoulders ──
    if len(peaks) >= 3:
        last3 = peaks[-3:]
        head = max(last3, key=lambda x: x[1])
        shoulders = [p for p in last3 if p != head]
        if len(shoulders) == 2:
            if abs(shoulders[0][1] - shoulders[1][1]) / shoulders[0][1] < 0.05:
                if head[1] > shoulders[0][1] * 1.03:
                    relevant_troughs = [t for t in troughs if shoulders[0][0] < t[0] < shoulders[1][0]]
                    if relevant_troughs:
                        neckline = min(t[1] for t in relevant_troughs)
                        target = neckline - (head[1] - neckline)
                        if c_price > neckline:
                            stage = "FORMING"
                            desc = f"Head at Rs.{head[1]:,.0f}, shoulders at Rs.{shoulders[0][1]:,.0f}/{shoulders[1][1]:,.0f}. Neckline Rs.{neckline:,.0f}. Breakdown target: Rs.{target:,.0f}"
                        else:
                            stage = "BREAKDOWN"
                            desc = f"Broke neckline Rs.{neckline:,.0f}. Target Rs.{target:,.0f}"
                        patterns.append({"pattern": "Head & Shoulders", "type": "BEARISH", "description": desc, "reliability": "high", "stage": stage, "neckline": round(neckline,2), "target": round(target,2)})

    # ── Ascending Triangle ──
    if len(peaks) >= 2 and len(troughs) >= 2:
        recent_peaks = peaks[-3:]
        recent_troughs = troughs[-3:]
        peak_vals = [p[1] for p in recent_peaks]
        trough_vals = [t[1] for t in recent_troughs]
        flat_top = max(peak_vals) - min(peak_vals) < max(peak_vals) * 0.02
        rising_bottom = all(trough_vals[i] < trough_vals[i+1] for i in range(len(trough_vals)-1)) if len(trough_vals) > 1 else False
        if flat_top and rising_bottom:
            resistance = max(peak_vals)
            pct_to_breakout = round((resistance - c_price) / c_price * 100, 1)
            if c_price < resistance:
                stage = "FORMING"
                desc = f"Flat resistance at Rs.{resistance:,.0f} ({pct_to_breakout}% above) with rising support. Bullish breakout expected."
            else:
                stage = "BREAKOUT"
                desc = f"Broke above Rs.{resistance:,.0f} resistance. Ascending triangle confirmed."
            patterns.append({"pattern": "Ascending Triangle", "type": "BULLISH", "description": desc, "reliability": "moderate", "stage": stage, "neckline": round(resistance,2)})

    # ── Descending Triangle ──
        flat_bottom = max(trough_vals) - min(trough_vals) < max(trough_vals) * 0.02 if trough_vals else False
        falling_top = all(peak_vals[i] > peak_vals[i+1] for i in range(len(peak_vals)-1)) if len(peak_vals) > 1 else False
        if flat_bottom and falling_top:
            support = min(trough_vals)
            pct_to_break = round((c_price - support) / c_price * 100, 1)
            if c_price > support:
                stage = "FORMING"
                desc = f"Flat support at Rs.{support:,.0f} ({pct_to_break}% below) with falling resistance. Bearish breakdown expected."
            else:
                stage = "BREAKDOWN"
                desc = f"Broke below Rs.{support:,.0f} support. Descending triangle confirmed."
            patterns.append({"pattern": "Descending Triangle", "type": "BEARISH", "description": desc, "reliability": "moderate", "stage": stage, "neckline": round(support,2)})

    # ── Falling Wedge (Bullish) ──
    if len(peaks) >= 2 and len(troughs) >= 2:
        if all(peak_vals[i] > peak_vals[i+1] for i in range(len(peak_vals)-1)) and all(trough_vals[i] > trough_vals[i+1] for i in range(len(trough_vals)-1)):
            if (peak_vals[0] - peak_vals[-1]) > (trough_vals[0] - trough_vals[-1]):
                patterns.append({"pattern": "Falling Wedge", "type": "BULLISH", "description": "Both highs and lows falling but converging. Bullish reversal pattern. Watch for upside breakout.", "reliability": "moderate", "stage": "FORMING"})

    # ── Rising Wedge (Bearish) ──
        if all(peak_vals[i] < peak_vals[i+1] for i in range(len(peak_vals)-1)) and all(trough_vals[i] < trough_vals[i+1] for i in range(len(trough_vals)-1)):
            if (trough_vals[-1] - trough_vals[0]) > (peak_vals[-1] - peak_vals[0]):
                patterns.append({"pattern": "Rising Wedge", "type": "BEARISH", "description": "Both highs and lows rising but converging. Bearish reversal pattern. Watch for downside breakdown.", "reliability": "moderate", "stage": "FORMING"})

    # Update bull/bear counts after new pattern signals
    bull = sum(1 for s in signals if s["signal"]=="BULLISH")
    bear = sum(1 for s in signals if s["signal"]=="BEARISH")
    total = bull + bear
    score = round((bull - bear) / total * 100) if total > 0 else 0

    # Overall Score
    bull = sum(1 for s in signals if s["signal"]=="BULLISH")
    bear = sum(1 for s in signals if s["signal"]=="BEARISH")
    total = bull + bear
    score = round((bull - bear) / total * 100) if total > 0 else 0
    if score > 30: verdict = "BULLISH"
    elif score > 10: verdict = "MILDLY BULLISH"
    elif score < -30: verdict = "BEARISH"
    elif score < -10: verdict = "MILDLY BEARISH"
    else: verdict = "NEUTRAL"
    # Williams %R
    wr = float(ta.momentum.WilliamsRIndicator(h, l, cl, lbp=14).williams_r().iloc[-1])
    if wr > -20: signals.append({"signal":"BEARISH","name":f"Williams %R Overbought ({wr:.0f})","strength":"moderate"})
    elif wr < -80: signals.append({"signal":"BULLISH","name":f"Williams %R Oversold ({wr:.0f})","strength":"moderate"})
    # CCI
    cci = float(ta.trend.CCIIndicator(h, l, cl, window=20).cci().iloc[-1])
    if cci > 100: signals.append({"signal":"BEARISH","name":f"CCI Overbought ({cci:.0f})","strength":"weak"})
    elif cci < -100: signals.append({"signal":"BULLISH","name":f"CCI Oversold ({cci:.0f})","strength":"weak"})
    # OBV trend
    obv = ta.volume.OnBalanceVolumeIndicator(cl, vol).on_balance_volume()
    obv_sma = obv.rolling(20).mean()
    if float(obv.iloc[-1]) > float(obv_sma.iloc[-1]):
        signals.append({"signal":"BULLISH","name":"OBV above 20-day avg (accumulation)","strength":"moderate"})
    else:
        signals.append({"signal":"BEARISH","name":"OBV below 20-day avg (distribution)","strength":"moderate"})
    # EMA crossover
    if ema12 > ema26: signals.append({"signal":"BULLISH","name":"EMA 12 above EMA 26","strength":"moderate"})
    else: signals.append({"signal":"BEARISH","name":"EMA 12 below EMA 26","strength":"moderate"})
    # Day change
    day_chg = round((c_price / float(cl.iloc[-2]) - 1) * 100, 2)
    # Build narrative
    narrative_parts = []
    narrative_parts.append(f"{info.get('shortName',sym)} ({sym}) is currently trading at Rs.{c_price:,.2f}, {('up' if day_chg>=0 else 'down')} {abs(day_chg)}% in the latest session.")
    if sma200 > 0:
        if c_price > sma200:
            narrative_parts.append(f"The stock is trading above its 200-day moving average (Rs.{sma200:,.0f}), which is a long-term bullish structure.")
        else:
            narrative_parts.append(f"The stock is trading below its 200-day moving average (Rs.{sma200:,.0f}), indicating a long-term bearish structure.")
    if c_price > sma50:
        narrative_parts.append(f"It remains above the 50 DMA (Rs.{sma50:,.0f}), showing medium-term strength.")
    else:
        narrative_parts.append(f"It has slipped below the 50 DMA (Rs.{sma50:,.0f}), showing medium-term weakness.")
    if rsi < 30:
        narrative_parts.append(f"RSI at {rsi:.1f} is in deeply oversold territory, historically a zone where mean-reversion bounces tend to occur. This could present a buying opportunity for contrarian traders.")
    elif rsi > 70:
        narrative_parts.append(f"RSI at {rsi:.1f} is in overbought territory, suggesting the rally may be overextended. Profit-booking or a pullback is likely in the near term.")
    elif rsi > 55:
        narrative_parts.append(f"RSI at {rsi:.1f} shows bullish momentum without being overextended.")
    elif rsi < 45:
        narrative_parts.append(f"RSI at {rsi:.1f} leans bearish, indicating sellers are in control.")
    else:
        narrative_parts.append(f"RSI at {rsi:.1f} is neutral, offering no strong directional signal.")
    if macd_hist > 0:
        narrative_parts.append("MACD histogram is positive, confirming upward momentum.")
    else:
        narrative_parts.append("MACD histogram is negative, confirming downward momentum.")
    if vol_ratio > 1.5:
        narrative_parts.append(f"Volume is {vol_ratio}x the 20-day average, indicating strong institutional participation in today's move.")
    elif vol_ratio < 0.7:
        narrative_parts.append(f"Volume is weak at {vol_ratio}x average, suggesting the current move lacks conviction.")
    if adx > 25:
        narrative_parts.append(f"ADX at {adx:.0f} confirms a strong trend is in place. Trend-following strategies are appropriate.")
    else:
        narrative_parts.append(f"ADX at {adx:.0f} indicates a weak or range-bound market. Mean-reversion strategies may work better than trend-following.")
    for p in patterns:
        if p["reliability"] == "high":
            narrative_parts.append(f"IMPORTANT: {p['pattern']} detected -- {p['description']}. This is a high-reliability pattern.")
    # Prediction
    if score > 30:
        outlook = f"OUTLOOK: The weight of technical evidence is bullish. {sym} shows {bull} bullish signals against {bear} bearish. Near-term upside target is R1 at Rs.{r1:,.0f}, with support at S1 Rs.{s1:,.0f}. A break above Rs.{sma50:,.0f} (50 DMA) would strengthen the bullish case."
    elif score > 10:
        outlook = f"OUTLOOK: Mildly bullish with {bull} bullish vs {bear} bearish signals. The stock may see gradual upside towards R1 (Rs.{r1:,.0f}) but conviction is moderate. Watch for RSI to sustain above 50 and volume pickup for confirmation."
    elif score < -30:
        outlook = f"OUTLOOK: Technical signals are bearish with {bear} bearish vs {bull} bullish readings. Downside risk to S1 at Rs.{s1:,.0f} and potentially S2 at Rs.{s2:,.0f}. A recovery above 50 DMA (Rs.{sma50:,.0f}) would be the first sign of reversal."
    elif score < -10:
        outlook = f"OUTLOOK: Mildly bearish. The stock faces resistance at Rs.{r1:,.0f} and may drift lower towards S1 (Rs.{s1:,.0f}). Traders should wait for a clear reversal signal before entering longs."
    else:
        outlook = f"OUTLOOK: Neutral/consolidation phase. The stock is range-bound between S1 (Rs.{s1:,.0f}) and R1 (Rs.{r1:,.0f}). Wait for a decisive break in either direction before taking a position. Bollinger Band width at {bb_width:.1f}% {'suggests a squeeze is building' if bb_width < 10 else 'shows normal volatility'}."
    narrative_parts.append(outlook)
    # Add chart pattern narratives
    chart_patterns = [p for p in patterns if "stage" in p]
    if chart_patterns:
        narrative_parts.append("CHART PATTERNS:")
        for cp in chart_patterns:
            narrative_parts.append(f"{cp['pattern']} ({cp['stage']}): {cp['description']}")
    narrative = " ".join(narrative_parts)

    result = {
        "symbol": sym, "name": info.get("shortName",sym), "sector": info.get("sector",""),
        "price": round(c_price,2), "change_pct": round((c_price/float(cl.iloc[-2])-1)*100,2),
        "verdict": verdict, "score": score,
        "bullish_signals": bull, "bearish_signals": bear,
        "indicators": {
            "sma20": round(sma20,2), "sma50": round(sma50,2), "sma200": round(sma200,2),
            "rsi": round(rsi,1), "macd": round(macd_hist,2),
            "bb_upper": round(bb_upper,2), "bb_lower": round(bb_lower,2), "bb_width": round(bb_width,1),
            "volume_ratio": vol_ratio, "adx": round(adx,1),
            "stoch_k": round(stoch_k,1), "stoch_d": round(stoch_d,1),
        },
        "levels": {"pivot": round(pivot,2),"r1": round(r1,2),"r2": round(r2,2),"s1": round(s1,2),"s2": round(s2,2),
                   "high_52w": high_52w,"low_52w": low_52w,"from_high": from_high,"from_low": from_low},
        "signals": signals,
        "patterns": patterns,
        "narrative": narrative,
        "extra_indicators": {"williams_r": round(wr,1), "cci": round(cci,1), "ema12": round(ema12,2), "ema26": round(ema26,2)},
    }
    if redis_client:
        await redis_client.setex(cache_key, 900, json.dumps(result))
    return result


# ==============================================================================
# ══════════════════════════════════════════════════════════════════════════════
# DYOR → ALPHAMARKET BRIDGE (Publish calls to advisor strategies)
# ══════════════════════════════════════════════════════════════════════════════

ALPHAMARKET_URL = "https://alphamarket.co.in"
DYOR_BRIDGE_KEY = "dyor_bridge_2026_alphamarket"

@app.get("/api/bridge/strategies", tags=["Advisory & Reports"], summary="Get advisor strategies from AlphaMarket",
    description="Fetches the advisor's strategies from AlphaMarket for call publishing.")
async def bridge_get_strategies(user=Depends(get_current_user)):
    email = user.get("email")
    if not email:
        raise HTTPException(400, "User email not found")
    try:
        async with _httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{ALPHAMARKET_URL}/api/external/advisor-strategies",
                params={"email": email},
                headers={"X-DYOR-API-Key": DYOR_BRIDGE_KEY}
            )
            if r.status_code == 200:
                return r.json()
            elif r.status_code == 404:
                return {"error": "not_advisor", "message": "No advisor account found on AlphaMarket for this email. Register as an advisor at alphamarket.co.in first."}
            else:
                return {"error": "api_error", "message": r.text}
    except Exception as e:
        return {"error": "connection_error", "message": str(e)}

@app.get("/api/bridge/rationale-preview/{symbol}", tags=["Advisory & Reports"], summary="Get rich rationale preview for a stock")
async def bridge_rationale_preview(symbol: str, strategy: str = "", user=Depends(get_current_user)):
    """Returns auto-generated rationale for pre-filling the publish form."""
    sym = symbol.upper()
    parts = []
    try:
        if strategy:
            screener_reasons = {
                "momentum": "strong price momentum with consistent higher highs, above-average volume, and positive relative strength",
                "oversold": "RSI dropping to oversold levels while fundamentals remain intact, presenting a mean-reversion entry",
                "breakout": "breaking above key resistance with volume confirmation",
                "golden_cross": "50-day MA crossing above 200-day MA (Golden Cross)",
                "bb_squeeze": "Bollinger Bands narrowing to a tight squeeze, indicating compressed volatility",
                "minervini": "passing Minervini Stage 2 trend template criteria",
                "pullback_buy": "pulling back to key support within a confirmed uptrend",
                "up_on_volume": "advancing with significantly higher-than-average volume",
                "relative_strength": "outperforming the broader market over 1-3 months",
                "trend_strong": "ADX above 25 confirming a well-established directional trend",
                "supertrend_buy": "trading above Supertrend indicator, confirming bullish trend",
                "growth_momentum": "combining strong earnings growth with positive price momentum",
                "safe_haven": "low volatility, strong balance sheet, and consistent dividends",
                "high_roe": "high ROE indicating superior management efficiency",
                "low_pe": "low P/E ratio suggesting potential undervaluation",
                "dividend_yield": "attractive dividend yield providing regular income",
                "recent_breakout": "recently broke through key resistance with volume confirmation",
                "52w_high": "trading near 52-week high with sustained buying pressure",
                "macd_crossover": "MACD bullish crossover with positive histogram",
            }
            reason = screener_reasons.get(strategy, "meeting quantitative screening criteria")
            strat_label = strategy.replace("_", " ").title()
            parts.append(f"SCREENER SIGNAL: {sym} was identified by the {strat_label} Screener for {reason}.")

        s360 = await stock360(sym, user)
        ascore = s360.get("alphascore", {})
        if ascore and ascore.get("alphascore"):
            dims = ascore.get("dimensions", {})
            parts.append(f"ALPHASCORE: {ascore['alphascore']}/100 (Grade {ascore.get('grade','N/A')}, Signal: {ascore.get('signal','N/A')}). Technical: {dims.get('technical',0):.0f}, Fundamental: {dims.get('fundamental',0):.0f}, Ownership: {dims.get('ownership',0):.0f}, Momentum: {dims.get('momentum',0):.0f}.")
        conf = s360.get("confluence", {})
        if conf and conf.get("probability"):
            parts.append(f"CONFLUENCE: {conf['probability']}% probability ({conf.get('conviction','N/A')} conviction). Estimated return: {conf.get('estimated_return',0)}%.")
        sm = s360.get("smart_money", {})
        if sm and sm.get("smart_money_score"):
            pos_sigs = [s.get("text","") for s in sm.get("positive_signals", [])]
            parts.append(f"SMART MONEY: {sm['smart_money_score']}/100 ({sm.get('verdict','N/A')}). {'; '.join(pos_sigs[:3])}")
        pat = s360.get("patterns", {})
        if pat and pat.get("narrative"):
            narr = pat["narrative"][:400]
            parts.append(f"TECHNICAL OUTLOOK: {narr}")
    except Exception as e:
        parts.append(f"Analysis pending for {sym}.")
    return {"symbol": sym, "rationale": " ".join(parts), "strategy": strategy}

@app.post("/api/bridge/publish-call", tags=["Advisory & Reports"], summary="Publish stock call to AlphaMarket",
    description="Publishes a stock recommendation (BUY/SELL) to a strategy on AlphaMarket.")
async def bridge_publish_call(req: dict, user=Depends(get_current_user)):
    email = user.get("email")
    if not email:
        raise HTTPException(400, "User email not found")

    symbol = (req.get("stock_name") or "").upper()
    rationale = req.get("rationale", "")

    # Auto-generate rich rationale if basic/empty
    if not rationale or rationale.startswith("Screener:") or rationale == "Published from DYOR Research Platform" or len(rationale) < 50:
        try:
            parts = []
            screener_strat = req.get("screener_strategy", "")

            # ── SCREENER CONTEXT: Why this stock was filtered ──
            if screener_strat:
                strat_label = screener_strat.replace("_", " ").title()
                screener_reasons = {
                    "momentum": "strong price momentum with consistent higher highs, above-average volume, and positive relative strength vs the broader market",
                    "oversold": "RSI dropping to oversold levels while fundamentals remain intact, presenting a high-probability mean-reversion entry",
                    "overbought": "RSI reaching overbought territory, signaling potential for profit-taking or a short-term pullback",
                    "breakout": "breaking above key resistance with volume confirmation, indicating a fresh trend initiation",
                    "golden_cross": "50-day moving average crossing above 200-day MA (Golden Cross), one of the most reliable long-term bullish signals",
                    "death_cross": "50-day MA crossing below 200-day MA (Death Cross), indicating structural bearish shift",
                    "bb_squeeze": "Bollinger Bands narrowing to a tight squeeze, indicating compressed volatility that often precedes an explosive directional move",
                    "minervini": "passing Mark Minervini's Stage 2 trend template criteria: price above key MAs, rising earnings momentum, strong relative strength",
                    "pullback_buy": "pulling back to key support within a confirmed uptrend, offering low-risk entry near moving average support",
                    "up_on_volume": "advancing with significantly higher-than-average volume, indicating strong institutional buying conviction",
                    "volume": "abnormally high volume surge suggesting institutional activity or catalyst-driven accumulation",
                    "relative_strength": "outperforming the broader market significantly over the past 1-3 months, indicating sustained institutional demand",
                    "trend_strong": "ADX above 25 confirming a well-established directional trend with high probability of continuation",
                    "52w_high": "trading near its 52-week high with sustained buying pressure, often a sign of continued upside in quality stocks",
                    "52w_low": "near 52-week low, potentially offering deep value if business fundamentals remain intact",
                    "macd_crossover": "MACD line crossing above signal line with positive histogram, a widely followed momentum buy trigger",
                    "macd_bearish": "MACD showing bearish divergence, signaling weakening upward momentum",
                    "supertrend_buy": "trading above Supertrend indicator, confirming bullish trend with dynamic trailing support",
                    "growth_momentum": "combining strong earnings/revenue growth trajectory with positive price momentum",
                    "safe_haven": "low volatility, strong balance sheet, and consistent dividends, suitable for capital preservation",
                    "high_roe": "high Return on Equity indicating superior management efficiency in generating shareholder value",
                    "low_pe": "low P/E ratio relative to sector peers, suggesting potential undervaluation at current earnings",
                    "dividend_yield": "attractive dividend yield providing regular income alongside capital appreciation potential",
                    "sector_rotation": "belonging to a sector showing improving relative strength and increasing institutional fund flows",
                    "multi_timeframe": "bullish alignment across daily and weekly timeframes, a high-conviction setup",
                    "gap_up": "opening with a significant gap up on heavy volume, indicating strong overnight buying or positive catalyst",
                    "gap_down": "gapping down significantly, presenting potential mean-reversion opportunity if fundamentals are sound",
                    "range_breakout": "breaking out of a well-defined consolidation range, suggesting the start of a new trending leg",
                    "recent_breakout": "recent breakout through key resistance with volume confirmation",
                    "turnaround": "showing early signs of recovery from a prolonged downtrend with improving technicals",
                    "volume_dry": "volume drying up during consolidation, a classic pre-breakout setup",
                    "high_beta": "high-beta stock offering amplified upside in bullish markets",
                    "top_losers": "among the day's biggest losers, may present contrarian entry if decline is overdone",
                }
                reason = screener_reasons.get(screener_strat, "meeting the screener's quantitative filtering criteria")
                parts.append(f"SCREENER SIGNAL: {symbol} was identified by the {strat_label} Screener for {reason}.")

            # ── Screener signals data from cache ──
            if screener_strat and redis_client:
                try:
                    cache_key = f"screener:{__import__('datetime').date.today().isoformat()}:{screener_strat}:50:10000::::"
                    scr_cached = await redis_client.get(cache_key)
                    if scr_cached:
                        scr_data = json.loads(scr_cached)
                        scr_stocks = scr_data.get("stocks", [])
                        stock_data = next((s for s in scr_stocks if s.get("symbol") == symbol), None)
                        if stock_data:
                            sig_parts = []
                            rsi = stock_data.get("rsi")
                            if rsi: sig_parts.append(f"RSI at {rsi:.1f}")
                            vol_r = stock_data.get("vol_ratio")
                            if vol_r and vol_r > 1.2: sig_parts.append(f"Volume {vol_r:.1f}x above average")
                            if stock_data.get("above_200dma"): sig_parts.append("trading above 200-day MA")
                            if stock_data.get("above_50dma"): sig_parts.append("above 50-day MA")
                            if stock_data.get("macd_cross_up"): sig_parts.append("MACD bullish crossover active")
                            if stock_data.get("above_supertrend"): sig_parts.append("above Supertrend support")
                            rs3m = stock_data.get("rs_3m")
                            if rs3m and rs3m > 5: sig_parts.append(f"3-month relative strength +{rs3m:.1f}%")
                            mini = stock_data.get("minervini_score")
                            if mini and mini >= 4: sig_parts.append(f"Minervini score {mini}/7")
                            pct52h = stock_data.get("pct_from_52h")
                            if pct52h is not None and pct52h > -5: sig_parts.append(f"within {abs(pct52h):.1f}% of 52-week high")
                            pe = stock_data.get("pe_ratio")
                            if pe and pe > 0: sig_parts.append(f"P/E {pe:.1f}")
                            roe = stock_data.get("roe")
                            if roe and roe > 12: sig_parts.append(f"ROE {roe:.1f}%")
                            if sig_parts:
                                parts.append("KEY SIGNALS: " + ", ".join(sig_parts) + ".")
                except Exception as _e:
                    pass

            # ── Stock360 AlphaScore ──
            try:
                s360 = await stock360(symbol, user)
                ascore = s360.get("alphascore", {})
                if ascore and ascore.get("alphascore"):
                    dims = ascore.get("dimensions", {})
                    parts.append(f"ALPHASCORE: {ascore['alphascore']}/100 (Grade {ascore.get('grade','N/A')}, Signal: {ascore.get('signal','N/A')}). Technical: {dims.get('technical',0):.0f}, Fundamental: {dims.get('fundamental',0):.0f}, Ownership: {dims.get('ownership',0):.0f}, Momentum: {dims.get('momentum',0):.0f}, Risk: {dims.get('risk_alpha',0):.0f}.")

                conf = s360.get("confluence", {})
                if conf and conf.get("probability"):
                    parts.append(f"CONFLUENCE: {conf['probability']}% probability ({conf.get('conviction','N/A')} conviction). Estimated return: {conf.get('estimated_return',0)}% over {conf.get('holding_period_days',30)} days.")

                sm = s360.get("smart_money", {})
                if sm and sm.get("smart_money_score"):
                    pos_signals = [s.get("text","") for s in sm.get("positive_signals", [])]
                    risk_flags = [s.get("text","") for s in sm.get("risk_flags", [])]
                    parts.append(f"SMART MONEY: Score {sm['smart_money_score']}/100 ({sm.get('verdict','N/A')}).")
                    if pos_signals:
                        parts.append("Bullish signals: " + "; ".join(pos_signals[:3]) + ".")
                    if risk_flags:
                        parts.append("Risk flags: " + "; ".join(risk_flags[:2]) + ".")

                pat = s360.get("patterns", {})
                if pat and pat.get("narrative"):
                    narr = pat["narrative"]
                    if len(narr) > 400: narr = narr[:400] + "..."
                    parts.append(f"TECHNICAL OUTLOOK: {narr}")
            except Exception as _e360:
                print(f"[Bridge] Stock360 failed for {symbol}: {_e360}")

            if parts:
                rationale = " ".join(parts)
            else:
                rationale = req.get("rationale") or "Published from DYOR Research Platform"
            print(f"[Bridge] Rich rationale for {symbol}: {len(rationale)} chars")
        except Exception as e:
            print(f"[Bridge] Rationale generation failed for {symbol}: {e}")
            rationale = req.get("rationale") or "Published from DYOR Research Platform"

    payload = {
        "advisor_email": email,
        "strategy_id": req.get("strategy_id"),
        "stock_name": symbol,
        "action": req.get("action", "BUY"),
        "buy_range_start": req.get("buy_range_start"),
        "buy_range_end": req.get("buy_range_end"),
        "target_price": req.get("target_price"),
        "stop_loss": req.get("stop_loss"),
        "rationale": rationale,
        "profit_goal": req.get("profit_goal"),
        "publish_mode": req.get("publish_mode", "live"),
    }
    try:
        async with _httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{ALPHAMARKET_URL}/api/external/publish-call",
                json=payload,
                headers={"X-DYOR-API-Key": DYOR_BRIDGE_KEY, "Content-Type": "application/json"}
            )
            return r.json()
    except Exception as e:
        raise HTTPException(500, f"Failed to publish: {str(e)}")

@app.post("/api/bridge/publish-position", tags=["Advisory & Reports"], summary="Publish F&O position to AlphaMarket",
    description="Publishes an F&O position (futures/options) to a strategy on AlphaMarket.")
async def bridge_publish_position(req: dict, user=Depends(get_current_user)):
    email = user.get("email")
    if not email:
        raise HTTPException(400, "User email not found")
    payload = {
        "advisor_email": email,
        "strategy_id": req.get("strategy_id"),
        "symbol": req.get("symbol"),
        "segment": req.get("segment", "EQ"),
        "call_put": req.get("call_put"),
        "buy_sell": req.get("buy_sell", "BUY"),
        "entry_price": req.get("entry_price"),
        "target": req.get("target"),
        "stop_loss": req.get("stop_loss"),
        "lots": req.get("lots", 1),
        "expiry": req.get("expiry"),
        "strike_price": req.get("strike_price"),
        "rationale": req.get("rationale", "Published from DYOR Research Platform"),
        "publish_mode": req.get("publish_mode", "live"),
    }
    try:
        async with _httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{ALPHAMARKET_URL}/api/external/publish-position",
                json=payload,
                headers={"X-DYOR-API-Key": DYOR_BRIDGE_KEY, "Content-Type": "application/json"}
            )
            return r.json()
    except Exception as e:
        raise HTTPException(500, f"Failed to publish: {str(e)}")


@app.get("/api/bridge/check-permission", tags=["Advisory & Reports"], summary="Check DYOR publish permission")
async def bridge_check_permission(user=Depends(get_current_user)):
    email = user.get("email")
    if not email:
        return {"allowed": False, "reason": "no_email"}
    try:
        async with _httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{ALPHAMARKET_URL}/api/external/check-publish-permission",
                params={"email": email},
                headers={"X-DYOR-API-Key": DYOR_BRIDGE_KEY}
            )
            return r.json()
    except Exception as e:
        return {"allowed": False, "reason": "connection_error", "message": str(e)}

@app.post("/api/bridge/request-permission", tags=["Advisory & Reports"], summary="Request DYOR publish permission")
async def bridge_request_permission(user=Depends(get_current_user)):
    email = user.get("email")
    if not email:
        raise HTTPException(400, "User email not found")
    try:
        async with _httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{ALPHAMARKET_URL}/api/external/request-publish-permission",
                json={"email": email},
                headers={"X-DYOR-API-Key": DYOR_BRIDGE_KEY, "Content-Type": "application/json"}
            )
            return r.json()
    except Exception as e:
        raise HTTPException(500, f"Failed: {str(e)}")


# ALPHAVIEW - Comprehensive Stock Profile
# ==============================================================================

@app.get("/api/alphaview/{symbol}", tags=["AlphaView"], summary="AlphaView — Complete stock profile",
    description="Comprehensive single-page stock analysis combining price chart data, technical indicators, fundamental data, pattern detection, ratings, relative strength vs NIFTY, and sector context.")
async def alphaview(symbol: str, user=Depends(get_current_user)):
    """AlphaView: Complete stock profile — fundamentals + technicals + ratings + patterns in one view."""
    from datetime import date, timedelta
    import ta as _ta
    sym = symbol.upper()

    cache_key = f"alphaview:{sym}:{date.today().isoformat()}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    # ── 1. OHLCV Data (1 year) ──
    _rows = await ds_ohlcv(sym, "1y")
    if not _rows:
        raise HTTPException(404, f"No data for {sym}")
    df = pd.DataFrame(_rows)
    df.columns = [col.lower() for col in df.columns]
    for dc in ["date", "datetime", "timestamp"]:
        if dc in df.columns:
            df[dc] = pd.to_datetime(df[dc])
            df = df.set_index(dc)
            break
    df.index.name = "date"
    keep = [col for col in ["open", "high", "low", "close", "volume"] if col in df.columns]
    df = df[keep].astype({col: float for col in keep}).dropna().sort_index()
    if len(df) < 30:
        raise HTTPException(404, f"Insufficient data for {sym} ({len(df)} days)")

    c = df["close"].astype(float)
    h = df["high"].astype(float)
    l = df["low"].astype(float)
    v = df["volume"].astype(float)
    price = float(c.iloc[-1])
    prev_close = float(c.iloc[-2]) if len(c) > 1 else price

    # ── 2. Fundamentals ──
    fund = await ds_fundamentals(sym)
    if not fund:
        fund = {}

    def sf(val, default=None):
        if val is None:
            return default
        try:
            fv = float(val)
            return default if (np.isnan(fv) or np.isinf(fv)) else fv
        except:
            return default

    def fix_pct(val):
        """Convert to percentage display value. Only divide if over-scaled (>200)."""
        v = sf(val, 0)
        if not v: return 0
        if abs(v) > 200: return round(v / 100, 2)
        return round(v, 2)

    def fix_pct_smart(val, field_type="default"):
        """Field-aware percentage converter."""
        v = sf(val, 0)
        if not v: return 0
        if field_type == "div":
            if abs(v) < 0.1: return round(v * 100, 2)
            if abs(v) > 10: return round(v / 100, 2)
            return round(v, 2)
        elif field_type == "promoter":
            if abs(v) < 1: return round(v * 100, 2)
            return round(v, 2)
        elif field_type in ("roe", "margin", "growth"):
            if 0 < abs(v) < 1: return round(v * 100, 2)
            if abs(v) > 200: return round(v / 100, 2)
            return round(v, 2)
        else:
            if abs(v) > 200: return round(v / 100, 2)
            return round(v, 2)

    # Promoter holding overrides for banking stocks
    PROMOTER_OVERRIDES = {
        "HDFCBANK": 25.97, "SBIN": 57.49, "ICICIBANK": 0, "AXISBANK": 8.22,
        "KOTAKBANK": 25.89, "INDUSINDBK": 16.51, "BANDHANBNK": 39.98,
        "IDFCFIRSTB": 36.56, "FEDERALBNK": 0, "PNB": 73.15,
        "BANKBARODA": 63.97, "CANBK": 62.93, "UNIONBANK": 74.76,
    }
    promoter_override = PROMOTER_OVERRIDES.get(sym.upper())

    # ROE fallback from EPS/BookValue
    def compute_roe_fallback():
        eps_val = sf(fund.get("eps") or fund.get("trailingEps") or fund.get("eps_trailing"), 0)
        bv_val = sf(fund.get("book_value") or fund.get("bookValue"), 0)
        if eps_val and bv_val and bv_val > 0:
            return round((eps_val / bv_val) * 100, 2)
        return 0

    computed_roe = fix_pct_smart(fund.get("roe") or fund.get("returnOnEquity"), "roe")
    if not computed_roe or computed_roe == 0:
        computed_roe = compute_roe_fallback()

    # ── 3. Moving Averages & Trend ──
    sma20 = float(c.rolling(20).mean().iloc[-1]) if len(c) >= 20 else price
    sma50 = float(c.rolling(50).mean().iloc[-1]) if len(c) >= 50 else price
    sma200 = float(c.rolling(200).mean().iloc[-1]) if len(c) >= 200 else price
    ema9 = float(c.ewm(span=9).mean().iloc[-1])
    ema21 = float(c.ewm(span=21).mean().iloc[-1])
    above_20 = price > sma20
    above_50 = price > sma50
    above_200 = price > sma200

    # ── 4. Technical Indicators ──
    delta = c.diff()
    gain = delta.clip(lower=0).ewm(span=14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(span=14, adjust=False).mean()
    rs_val = float(gain.iloc[-1] / loss.iloc[-1]) if sf(loss.iloc[-1]) != 0 else 0
    rsi = round(100 - 100 / (1 + rs_val), 1) if rs_val else 50

    ema12 = c.ewm(span=12).mean()
    ema26 = c.ewm(span=26).mean()
    macd_line = ema12 - ema26
    signal_line = macd_line.ewm(span=9).mean()
    macd = round(float(macd_line.iloc[-1]), 2)
    macd_signal = round(float(signal_line.iloc[-1]), 2)
    macd_hist = round(macd - macd_signal, 2)

    bb_mid = c.rolling(20).mean()
    bb_std = c.rolling(20).std()
    bb_upper = round(float((bb_mid + 2 * bb_std).iloc[-1]), 2) if len(c) >= 20 else 0
    bb_lower = round(float((bb_mid - 2 * bb_std).iloc[-1]), 2) if len(c) >= 20 else 0

    vol_avg20 = float(v.rolling(20).mean().iloc[-1]) if len(v) >= 20 else float(v.mean())
    vol_ratio = round(float(v.iloc[-1]) / vol_avg20, 2) if vol_avg20 > 0 else 1

    # ADX
    adx_val = 0
    if len(df) >= 30:
        try:
            adx_i = _ta.trend.ADXIndicator(h, l, c, window=14)
            adx_val = round(float(adx_i.adx().iloc[-1]), 1)
        except:
            pass

    # Supertrend (simple approximation)
    atr = _ta.volatility.AverageTrueRange(h, l, c, window=10).average_true_range()
    st_upper = round(float((h.rolling(10).mean() + 3 * atr).iloc[-1]), 2) if len(c) >= 10 else 0
    st_lower = round(float((l.rolling(10).mean() - 3 * atr).iloc[-1]), 2) if len(c) >= 10 else 0
    supertrend_bullish = price > st_lower

    # Stochastic
    low14 = l.rolling(14).min()
    high14 = h.rolling(14).max()
    stoch_k = round(float(((c - low14) / (high14 - low14) * 100).iloc[-1]), 1) if len(c) >= 14 else 50
    stoch_d = round(float(((c - low14) / (high14 - low14) * 100).rolling(3).mean().iloc[-1]), 1) if len(c) >= 14 else 50

    # ── 5. Relative Strength vs NIFTY ──
    try:
        _nifty_rows = await ds_ohlcv("NIFTY", "1y")
        if not _nifty_rows:
            _nifty_rows = await ds_ohlcv("^NSEI", "1y")
        if _nifty_rows:
            nifty_df = pd.DataFrame(_nifty_rows)
            nifty_df.columns = [col.lower() for col in nifty_df.columns]
            for dc in ["date", "datetime", "timestamp"]:
                if dc in nifty_df.columns:
                    nifty_df[dc] = pd.to_datetime(nifty_df[dc])
                    nifty_df = nifty_df.set_index(dc)
                    break
            nc = nifty_df["close"].astype(float)
            stock_ret_1m = round((float(c.iloc[-1]) / float(c.iloc[-22]) - 1) * 100, 1) if len(c) > 22 else 0
            stock_ret_3m = round((float(c.iloc[-1]) / float(c.iloc[-66]) - 1) * 100, 1) if len(c) > 66 else 0
            stock_ret_6m = round((float(c.iloc[-1]) / float(c.iloc[-132]) - 1) * 100, 1) if len(c) > 132 else 0
            stock_ret_1y = round((float(c.iloc[-1]) / float(c.iloc[0]) - 1) * 100, 1) if len(c) > 200 else 0
            nifty_ret_1m = round((float(nc.iloc[-1]) / float(nc.iloc[-22]) - 1) * 100, 1) if len(nc) > 22 else 0
            nifty_ret_3m = round((float(nc.iloc[-1]) / float(nc.iloc[-66]) - 1) * 100, 1) if len(nc) > 66 else 0
            nifty_ret_6m = round((float(nc.iloc[-1]) / float(nc.iloc[-132]) - 1) * 100, 1) if len(nc) > 132 else 0
            nifty_ret_1y = round((float(nc.iloc[-1]) / float(nc.iloc[0]) - 1) * 100, 1) if len(nc) > 200 else 0
            rs_1m = round(stock_ret_1m - nifty_ret_1m, 1)
            rs_3m = round(stock_ret_3m - nifty_ret_3m, 1)
            rs_6m = round(stock_ret_6m - nifty_ret_6m, 1)
            rs_1y = round(stock_ret_1y - nifty_ret_1y, 1)
        else:
            stock_ret_1m = stock_ret_3m = stock_ret_6m = stock_ret_1y = 0
            nifty_ret_1m = nifty_ret_3m = nifty_ret_6m = nifty_ret_1y = 0
            rs_1m = rs_3m = rs_6m = rs_1y = 0
    except:
        stock_ret_1m = stock_ret_3m = stock_ret_6m = stock_ret_1y = 0
        nifty_ret_1m = nifty_ret_3m = nifty_ret_6m = nifty_ret_1y = 0
        rs_1m = rs_3m = rs_6m = rs_1y = 0

    # ── 6. Alpha Ratings (AlphaMarket Proprietary, 0-99) ──

    # --- 6a. MOMENTUM (price momentum + relative strength) ---
    # RS component: outperformance vs NIFTY (30%)
    rs_component = min(99, max(1, int(50 + rs_3m * 1.5 + rs_1m * 0.8)))
    # Price position: distance from 200 DMA (20%)
    pct_200dma = round((price / sma200 - 1) * 100, 1) if sma200 > 0 else 0
    pos_component = min(99, max(1, int(50 + pct_200dma * 1.5)))
    # RSI zone mapping (20%) — 30-70 is healthy, extremes penalized
    if rsi >= 50 and rsi <= 70: rsi_component = int(50 + (rsi - 50) * 2.4)
    elif rsi > 70: rsi_component = int(98 - (rsi - 70) * 1.5)  # overbought drag
    elif rsi >= 30: rsi_component = int(rsi * 1.0 + 20)
    else: rsi_component = int(rsi * 0.8)
    rsi_component = min(99, max(1, rsi_component))
    # MACD histogram direction (15%)
    macd_component = min(99, max(1, int(50 + macd_hist * 8)))
    # EMA cross (15%) — EMA9 vs EMA21
    ema_spread = round((ema9 / ema21 - 1) * 100, 2) if ema21 > 0 else 0
    ema_component = min(99, max(1, int(50 + ema_spread * 10)))

    momentum_rating = min(99, max(1, int(
        rs_component * 0.30 + pos_component * 0.20 + rsi_component * 0.20 +
        macd_component * 0.15 + ema_component * 0.15
    )))

    # --- 6b. FUNDAMENTALS (financial health + growth) ---
    eps_growth_val = sf(fund.get("earnings_growth") or fund.get("earningsGrowth"), 0)
    if eps_growth_val and abs(eps_growth_val) < 1:
        eps_growth_val = eps_growth_val * 100
    rev_growth_val = sf(fund.get("revenue_growth") or fund.get("revenueGrowth"), 0)
    if rev_growth_val and abs(rev_growth_val) < 1:
        rev_growth_val = rev_growth_val * 100
    roe_val = sf(fund.get("roe") or fund.get("returnOnEquity"), 0)
    if roe_val and abs(roe_val) < 1:
        roe_val = roe_val * 100
    margin_val = sf(fund.get("profit_margin") or fund.get("profitMargins"), 0)
    if margin_val and abs(margin_val) < 1:
        margin_val = margin_val * 100
    de_val = sf(fund.get("debt_equity") or fund.get("debtToEquity"), 0)

    # Earnings growth (25%) — higher is better, cap at 50%
    earn_comp = min(99, max(1, int(50 + min(eps_growth_val, 50) * 0.9))) if eps_growth_val else 40
    # ROE (25%) — above 15% is great
    roe_comp = min(99, max(1, int(roe_val * 3.5))) if roe_val > 0 else 25
    # Profit margin (20%) — above 15% is strong
    margin_comp = min(99, max(1, int(margin_val * 3.5))) if margin_val > 0 else 25
    # D/E health (15%) — lower is better, inverted scoring
    if de_val is not None and de_val >= 0:
        de_comp = min(99, max(1, int(99 - min(de_val, 200) * 0.45)))
    else:
        de_comp = 50
    # Revenue growth (15%)
    rev_comp = min(99, max(1, int(50 + min(rev_growth_val, 50) * 0.9))) if rev_growth_val else 40

    fundamentals_rating = min(99, max(1, int(
        earn_comp * 0.25 + roe_comp * 0.25 + margin_comp * 0.20 +
        de_comp * 0.15 + rev_comp * 0.15
    )))

    # --- 6c. ACCUMULATION (institutional activity signals) ---
    up_days = int((delta.iloc[-20:] > 0).sum()) if len(delta) >= 20 else 10
    down_days = 20 - up_days
    # Up-day vs down-day ratio (40%)
    ud_ratio_comp = min(99, max(1, int(up_days / 20 * 99)))
    # Volume ratio (30%) — current vs average
    vr_comp = min(99, max(1, int(min(vol_ratio, 3.0) * 33)))
    # OBV trend (30%) — is OBV rising over 20 days?
    try:
        obv = (v * delta.apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))).cumsum()
        obv_20ago = float(obv.iloc[-21]) if len(obv) > 20 else float(obv.iloc[0])
        obv_now = float(obv.iloc[-1])
        obv_change = (obv_now - obv_20ago) / abs(obv_20ago) * 100 if obv_20ago != 0 else 0
        obv_comp = min(99, max(1, int(50 + obv_change * 0.5)))
    except:
        obv_comp = 50

    accumulation_rating = min(99, max(1, int(
        ud_ratio_comp * 0.40 + vr_comp * 0.30 + obv_comp * 0.30
    )))

    # --- 6d. TREND (technical alignment) ---
    # SMA alignment (30%) — 20>50>200 = perfect bull, reverse = perfect bear
    sma_align = 0
    if sma20 > sma50 > sma200: sma_align = 99
    elif sma20 > sma50: sma_align = 75
    elif sma50 > sma200: sma_align = 55
    elif sma20 < sma50 < sma200: sma_align = 1
    elif sma20 < sma50: sma_align = 25
    else: sma_align = 50
    # ADX strength (25%)
    adx_comp = min(99, max(1, int(adx_val * 3))) if adx_val else 30
    # Supertrend (20%)
    st_comp = 80 if supertrend_bullish else 20
    # Stochastic position (15%)
    stoch_comp = min(99, max(1, int(stoch_k)))
    # BB width — tighter bands = breakout potential (10%)
    bb_w = (bb_upper - bb_lower) / price * 100 if price > 0 and bb_upper > 0 else 5
    bb_comp = min(99, max(1, int(99 - min(bb_w, 15) * 5)))  # tighter = higher

    trend_rating = min(99, max(1, int(
        sma_align * 0.30 + adx_comp * 0.25 + st_comp * 0.20 +
        stoch_comp * 0.15 + bb_comp * 0.10
    )))

    # --- 6e. SENTIMENT (news & events pulse via yfinance) ---
    sentiment_rating = 50  # neutral default
    try:
        import yfinance as _yf_news
        tk_news = _yf_news.Ticker(f"{sym}.NS")
        news_items = getattr(tk_news, "news", []) or []
        if news_items:
            from datetime import datetime as _dt_news
            pos_kw = ["upgrade","bullish","growth","profit","beat","expansion","dividend","buyback",
                       "partnership","acquisition","deal","record","outperform","buy","strong",
                       "rally","surge","breakout","approve","launch","fii buying","dii buying","bonus"]
            neg_kw = ["downgrade","bearish","loss","fraud","governance","resign","exit","probe",
                       "sebi","default","debt","sell","cut","slash","miss","warning","decline",
                       "fii selling","dii selling","ban","penalty","scam","investigation","layoff"]
            high_pos = ["acquisition","buyback","bonus","merger","record profit","fii buying"]
            high_neg = ["fraud","scam","ceo exit","ceo resign","sebi ban","default","governance"]
            score_sum = 0
            count = 0
            now_ts = __import__("time").time()
            for item in news_items[:10]:
                title = (item.get("title") or "").lower()
                pub_ts = item.get("providerPublishTime") or item.get("published", 0)
                if isinstance(pub_ts, str):
                    try: pub_ts = _dt_news.fromisoformat(pub_ts.replace("Z","+00:00")).timestamp()
                    except: pub_ts = 0
                age_days = (now_ts - pub_ts) / 86400 if pub_ts else 7
                recency_w = 3.0 if age_days <= 3 else (1.5 if age_days <= 7 else 1.0)
                s = 0
                for kw in high_pos:
                    if kw in title: s += 3
                for kw in high_neg:
                    if kw in title: s -= 3
                for kw in pos_kw:
                    if kw in title: s += 1
                for kw in neg_kw:
                    if kw in title: s -= 1
                score_sum += s * recency_w
                count += 1
            if count > 0:
                avg = score_sum / count
                sentiment_rating = min(99, max(1, int(50 + avg * 8)))
    except:
        sentiment_rating = 50

    # --- ALPHA SCORE™ (unified across entire platform) ---
    try:
        _sma20 = float(df["sma_20"].iloc[-1]) if "sma_20" in df.columns else price
        _sma50 = float(df["sma_50"].iloc[-1]) if "sma_50" in df.columns else price
        _sma200 = float(df["sma_200"].iloc[-1]) if "sma_200" in df.columns and len(df) >= 200 else price
        _av_data = {
            "rsi": rsi, "macd_hist": macd - macd_signal, "macd_cross_up": macd > macd_signal,
            "sma_50": _sma50, "sma_200": _sma200, "above_50dma": above_50, "above_200dma": above_200,
            "above_supertrend": supertrend_bullish, "vol_ratio": vol_ratio,
            "pct_from_52h": round((price / float(h.max()) - 1) * 100, 1) if float(h.max()) > 0 else -20,
            "pct_from_52l": round((price / float(l.min()) - 1) * 100, 1) if float(l.min()) > 0 else 0,
            "bb_upper": bb_upper, "bb_lower": bb_lower,
            "bb_width": round((bb_upper - bb_lower) / _sma20 * 100, 2) if _sma20 > 0 else 5,
            "gap_pct": 0,
            "price": price, "close": price,
            "pe_ratio": sf(fund.get("pe_trailing") or fund.get("pe_forward") or fund.get("pe_ratio"), 0),
            "roe": sf(fund.get("roe"), 0) * 100 if 0 < sf(fund.get("roe"), 0) < 1 else sf(fund.get("roe"), 0),
            "debt_equity": sf(fund.get("debt_equity"), 0),
            "dividend_yield": sf(fund.get("dividend_yield"), 0),
            "market_cap": sf(fund.get("market_cap") or fund.get("marketCap"), 0),
            "accumulation_score": accumulation_rating / 10.0,
            "momentum_score": momentum_rating / 10.0,
            "fundamental_score": fundamentals_rating / 10.0,
            "trend_score": trend_rating / 10.0,
            "sentiment_score": sentiment_rating / 10.0,
            "minervini_score": sum([above_50, above_200, price > _sma20, _sma50 > _sma200, rsi > 40, vol_ratio > 0.8, above_20, supertrend_bullish]),
            "rs_1m": 0, "rs_3m": 0,
            "wk_change": round((price / float(c.iloc[-5]) - 1) * 100, 2) if len(c) > 5 else 0,
            "change_pct": round((price - prev_close) / prev_close * 100, 2) if prev_close else 0,
            "alpha_rating": 0,
        }
        _as_result = compute_alphascore(sym, _av_data)
        alpha_score = int(_as_result["alphascore"])
    except Exception as _e:
        logger.warning(f"AlphaScore™ fallback for {sym}: {_e}")
        alpha_score = min(99, max(1, int(
            momentum_rating * 0.25 + fundamentals_rating * 0.25 +
            accumulation_rating * 0.20 + trend_rating * 0.15 +
            sentiment_rating * 0.15
        )))

    # Keep backward compat vars
    eps_growth = eps_growth_val

    sector = fund.get("sector") or SECTOR_MAP.get(sym, "Other")

    # ── 7. 52-week stats ──
    high_52w = round(float(h.max()), 2)
    low_52w = round(float(l.min()), 2)
    off_high = round((price / high_52w - 1) * 100, 1) if high_52w > 0 else 0
    off_low = round((price / low_52w - 1) * 100, 1) if low_52w > 0 else 0

    # ── 8. Price Data for Chart (last 250 days) ──
    chart_data_list = []
    for idx, row in df.tail(250).iterrows():
        ts = int(idx.timestamp()) if hasattr(idx, "timestamp") else 0
        chart_data_list.append({
            "time": ts,
            "open": round(float(row["open"]), 2),
            "high": round(float(row["high"]), 2),
            "low": round(float(row["low"]), 2),
            "close": round(float(row["close"]), 2),
            "volume": int(row["volume"]),
        })

    # ── 9. Cap Segment ──
    cap = get_cap_segment(sym)

    # ── 10. Trend Assessment ──
    bullish_count = sum([above_20, above_50, above_200, rsi > 50, macd > macd_signal, supertrend_bullish, adx_val > 20])
    bearish_count = sum([not above_20, not above_50, not above_200, rsi < 50, macd < macd_signal, not supertrend_bullish])
    if bullish_count >= 5: trend = "STRONG BULLISH"
    elif bullish_count >= 4: trend = "BULLISH"
    elif bearish_count >= 5: trend = "BEARISH"
    elif bearish_count >= 4: trend = "STRONG BEARISH"
    else: trend = "NEUTRAL"

    result = {
        "symbol": sym,
        "name": fund.get("name") or fund.get("longName") or sym,
        "sector": sector,
        "industry": fund.get("industry") or INDUSTRY_MAP.get(sym, "\u2014"),
        "cap_segment": cap,

        "summary": {
            "price": price,
            "prev_close": prev_close,
            "change": round(price - prev_close, 2),
            "change_pct": round((price - prev_close) / prev_close * 100, 2) if prev_close else 0,
            "high_52w": high_52w,
            "low_52w": low_52w,
            "off_high_pct": off_high,
            "off_low_pct": off_low,
            "market_cap": sf(fund.get("market_cap") or fund.get("marketCap")),
            "market_cap_cr": round(sf(fund.get("market_cap") or fund.get("marketCap"), 0) / 10000000, 0) if sf(fund.get("market_cap") or fund.get("marketCap"), 0) > 10000000 else round(sf(fund.get("market_cap") or fund.get("marketCap"), 0), 0),
            "shares_outstanding": sf(fund.get("shares_outstanding") or fund.get("sharesOutstanding")),
            "avg_volume": int(vol_avg20),
            "volume": int(v.iloc[-1]),
            "volume_ratio": vol_ratio,
            "beta": sf(fund.get("beta"), 0),
        },

        "ratings": {
            "alpha_score": alpha_score,
            "momentum": momentum_rating,
            "fundamentals": fundamentals_rating,
            "accumulation": accumulation_rating,
            "trend_rating": trend_rating,
            "sentiment": sentiment_rating,
            "trend": trend,
            "momentum_detail": {"rs": rs_component, "position": pos_component, "rsi": rsi_component, "macd": macd_component, "ema": ema_component},
            "fundamentals_detail": {"earnings": earn_comp, "roe": roe_comp, "margin": margin_comp, "debt": de_comp, "revenue": rev_comp},
            "accumulation_detail": {"up_days": ud_ratio_comp, "vol_ratio": vr_comp, "obv": obv_comp},
            "trend_detail": {"sma_align": sma_align, "adx": adx_comp, "supertrend": st_comp, "stochastic": stoch_comp, "bb": bb_comp},
        },

        "moving_averages": {
            "sma20": round(sma20, 2), "sma50": round(sma50, 2), "sma200": round(sma200, 2),
            "ema9": round(ema9, 2), "ema21": round(ema21, 2),
            "above_20dma": above_20, "above_50dma": above_50, "above_200dma": above_200,
            "price_vs_200dma_pct": round((price / sma200 - 1) * 100, 1) if sma200 > 0 else 0,
        },

        "technicals": {
            "rsi": rsi,
            "macd": macd, "macd_signal": macd_signal, "macd_histogram": macd_hist,
            "bb_upper": bb_upper, "bb_lower": bb_lower,
            "bb_width": round((bb_upper - bb_lower) / price * 100, 1) if price > 0 else 0,
            "adx": adx_val,
            "stoch_k": stoch_k, "stoch_d": stoch_d,
            "supertrend_bullish": supertrend_bullish,
            "supertrend_upper": st_upper, "supertrend_lower": st_lower,
            "volume_ratio": vol_ratio,
            "atr": round(float(atr.iloc[-1]), 2) if len(atr) > 0 else 0,
        },

        "relative_strength": {
            "rs_1m": rs_1m, "rs_3m": rs_3m, "rs_6m": rs_6m, "rs_1y": rs_1y,
            "stock_return": {"1m": stock_ret_1m, "3m": stock_ret_3m, "6m": stock_ret_6m, "1y": stock_ret_1y},
            "nifty_return": {"1m": nifty_ret_1m, "3m": nifty_ret_3m, "6m": nifty_ret_6m, "1y": nifty_ret_1y},
            "outperforming_1m": rs_1m > 0,
            "outperforming_3m": rs_3m > 0,
        },

        "fundamentals": {
            "eps": sf(fund.get("eps") or fund.get("trailingEps")),
            "pe_trailing": sf(fund.get("pe_trailing") or fund.get("trailingPE")),
            "pe_forward": sf(fund.get("pe_forward") or fund.get("forwardPE")),
            "pb": sf(fund.get("pb") or fund.get("priceToBook")),
            "roe": computed_roe,
            "roce": fix_pct_smart(fund.get("roce"), "roe"),
            "debt_equity": sf(fund.get("debt_equity") or fund.get("debtToEquity")),
            "dividend_yield": fix_pct_smart(fund.get("dividend_yield") or fund.get("dividendYield"), "div"),
            "dividend_rate": sf(fund.get("dividend_rate") or fund.get("dividendRate")),
            "book_value": sf(fund.get("book_value") or fund.get("bookValue")),
            "revenue": sf(fund.get("revenue")),
            "revenue_growth": fix_pct_smart(fund.get("revenue_growth") or fund.get("revenueGrowth"), "growth"),
            "earnings_growth": fix_pct_smart(fund.get("earnings_growth") or fund.get("earningsGrowth"), "growth"),
            "profit_margin": fix_pct_smart(fund.get("profit_margin") or fund.get("profitMargins"), "margin"),
            "operating_margin": fix_pct_smart(fund.get("operating_margin") or fund.get("operatingMargins"), "margin"),
            "promoter_holding": promoter_override if promoter_override is not None else (fix_pct_smart(fund.get("promoter_holding"), "promoter") or fix_pct_smart(fund.get("heldPercentInsiders"), "promoter")),
        },

        "levels": {
            "pivot": round((float(h.iloc[-1]) + float(l.iloc[-1]) + price) / 3, 2),
            "r1": round((float(h.iloc[-1]) + float(l.iloc[-1]) + price) / 3 * 2 - float(l.iloc[-1]), 2),
            "r2": round((float(h.iloc[-1]) + float(l.iloc[-1]) + price) / 3 + float(h.iloc[-1]) - float(l.iloc[-1]), 2),
            "s1": round((float(h.iloc[-1]) + float(l.iloc[-1]) + price) / 3 * 2 - float(h.iloc[-1]), 2),
            "s2": round((float(h.iloc[-1]) + float(l.iloc[-1]) + price) / 3 - float(h.iloc[-1]) + float(l.iloc[-1]), 2),
        },

        "chart": chart_data_list,
        "as_of": date.today().isoformat(),
        "data_points": len(df),
    }

    # ── 11. Patterns Data ──
    patterns_data = {}
    try:
        import ta as _ta2
        signals_list = []
        patterns_list = []
        narrative_parts = []

        # Pattern signals from indicators
        if rsi > 50: signals_list.append(f"RSI Bullish ({rsi})")
        elif rsi < 50: signals_list.append(f"RSI Bearish ({rsi})")
        if rsi > 70: signals_list.append(f"RSI Overbought ({rsi})")
        if rsi < 30: signals_list.append(f"RSI Oversold ({rsi})")
        if macd > macd_signal: signals_list.append("MACD above signal line")
        else: signals_list.append("MACD below signal line")
        if above_200: signals_list.append("Trading above 200 DMA")
        else: signals_list.append("Trading below 200 DMA")
        if above_50: signals_list.append("Above 50 DMA")
        else: signals_list.append("Below 50 DMA")
        if supertrend_bullish: signals_list.append("Above Supertrend support")
        else: signals_list.append("Below Supertrend resistance")
        if vol_ratio > 1.5: signals_list.append(f"High volume ({vol_ratio}x avg)")
        if adx_val > 25: signals_list.append(f"Strong trend (ADX {adx_val})")
        elif adx_val < 20: signals_list.append(f"Weak trend (ADX {adx_val})")

        # Williams %R
        wr = -100 * (float(h.rolling(14).max().iloc[-1]) - price) / (float(h.rolling(14).max().iloc[-1]) - float(l.rolling(14).min().iloc[-1])) if len(c) >= 14 else -50
        wr = round(wr, 1)
        if wr > -20: signals_list.append(f"Williams %R Overbought ({wr})")
        elif wr < -80: signals_list.append(f"Williams %R Oversold ({wr})")

        # OBV trend
        obv = (v * c.diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))).cumsum()
        obv_sma = obv.rolling(20).mean()
        if len(obv) >= 20 and float(obv.iloc[-1]) > float(obv_sma.iloc[-1]):
            signals_list.append("OBV above 20-day avg (accumulation)")
        elif len(obv) >= 20:
            signals_list.append("OBV below 20-day avg (distribution)")

        # EMA cross
        if ema9 > ema21: signals_list.append("EMA 9 above EMA 21")
        else: signals_list.append("EMA 12 below EMA 26")

        # Chart patterns detection
        if len(c) >= 60:
            # Double Bottom
            lows_60 = l.iloc[-60:]
            min1_idx = lows_60.iloc[:30].idxmin()
            min2_idx = lows_60.iloc[30:].idxmin()
            min1 = float(lows_60.loc[min1_idx])
            min2 = float(lows_60.loc[min2_idx])
            neckline = float(h.iloc[-60:].loc[min1_idx:min2_idx].max()) if min1_idx < min2_idx else 0
            if min1 > 0 and abs(min1 - min2) / min1 < 0.03 and neckline > 0:
                pct_above = round((neckline / price - 1) * 100, 1)
                target = round(neckline + (neckline - min((min1, min2))), 1)
                patterns_list.append({
                    "name": "Double Bottom (W)", "status": "FORMING" if price < neckline else "CONFIRMED",
                    "reliability": "high", "pivot": round(neckline, 0),
                    "target": target,
                    "description": f"Two bottoms at Rs.{round(min1)} and Rs.{round(min2)}. Neckline at Rs.{round(neckline)} ({pct_above}% above CMP). Breakout above neckline confirms pattern. Target: Rs.{target}"
                })

            # Head & Shoulders
            highs_60 = h.iloc[-60:]
            peak_idx = highs_60.idxmax()
            peak = float(highs_60.loc[peak_idx])
            left_shoulder = float(highs_60.iloc[:20].max())
            right_shoulder = float(highs_60.iloc[-20:].max())
            if peak > left_shoulder and peak > right_shoulder and left_shoulder > 0:
                pct_diff = abs(left_shoulder - right_shoulder) / left_shoulder
                if pct_diff < 0.05:
                    hs_neckline = float(l.iloc[-60:].min())
                    hs_target = round(hs_neckline - (peak - hs_neckline), 1)
                    patterns_list.append({
                        "name": "Head & Shoulders", "status": "FORMING",
                        "reliability": "high", "pivot": round(hs_neckline, 0),
                        "target": hs_target,
                        "description": f"Head at Rs.{round(peak)}, shoulders at Rs.{round(left_shoulder)}/{round(right_shoulder)}. Neckline Rs.{round(hs_neckline)}. Breakdown target: Rs.{hs_target}"
                    })

            # Near 52-week high/low
            if price >= high_52w * 0.95:
                patterns_list.append({"name": "Near 52-Week High", "status": "", "reliability": "moderate", "pivot": high_52w, "target": 0,
                    "description": f"{round((price/high_52w-1)*100, 1)}% from 52W high - strength"})
            if price <= low_52w * 1.05:
                patterns_list.append({"name": "Near 52-Week Low", "status": "", "reliability": "moderate", "pivot": low_52w, "target": 0,
                    "description": f"{round((price/low_52w-1)*100, 1)}% from 52W low - weakness"})

            # RSI divergence
            rsi_series = []
            for i in range(max(0, len(c)-30), len(c)):
                _g = delta.iloc[max(0,i-14):i].clip(lower=0).ewm(span=14, adjust=False).mean()
                _l2 = (-delta.iloc[max(0,i-14):i].clip(upper=0)).ewm(span=14, adjust=False).mean()
                if len(_l2) > 0 and float(_l2.iloc[-1]) != 0:
                    rsi_series.append(100 - 100 / (1 + float(_g.iloc[-1]) / float(_l2.iloc[-1])))
            if len(rsi_series) >= 10:
                price_lower = float(c.iloc[-1]) < float(c.iloc[-10])
                rsi_higher = rsi_series[-1] > rsi_series[-10] if len(rsi_series) > 10 else False
                if price_lower and rsi_higher:
                    patterns_list.append({"name": "Bullish RSI Divergence", "status": "", "reliability": "moderate", "pivot": 0, "target": 0,
                        "description": "Price making lower lows but RSI making higher lows"})

        # Build narrative
        narrative_parts.append(f"{sym} ({fund.get('name', sym)}) is currently trading at Rs.{price:,.2f}, {'up' if (price - prev_close)>=0 else 'down'} {abs(round((price - prev_close)/prev_close*100,2))}% in the latest session.")
        if above_200: narrative_parts.append(f"The stock is trading above its 200-day moving average (Rs.{sma200:,.0f}), indicating a long-term bullish structure.")
        else: narrative_parts.append(f"The stock is trading below its 200-day moving average (Rs.{sma200:,.0f}), indicating a long-term bearish structure.")
        if above_50: narrative_parts.append(f"It remains above the 50 DMA (Rs.{sma50:,.0f}), showing medium-term strength.")
        else: narrative_parts.append(f"It has slipped below the 50 DMA (Rs.{sma50:,.0f}), showing medium-term weakness.")
        narrative_parts.append(f"RSI at {rsi} is {'overbought' if rsi>70 else 'oversold' if rsi<30 else 'neutral'}, offering {'no strong' if 40<rsi<60 else 'a'} directional signal.")
        if macd_hist > 0: narrative_parts.append("MACD histogram is positive, confirming upward momentum.")
        else: narrative_parts.append("MACD histogram is negative, suggesting downward pressure.")
        if adx_val > 25: narrative_parts.append(f"ADX at {adx_val} indicates a strong trending market.")
        else: narrative_parts.append(f"ADX at {adx_val} indicates a weak or range-bound market. Mean-reversion strategies may work better than trend-following.")
        for pat in patterns_list:
            if pat["name"] and pat["description"]:
                narrative_parts.append(f"IMPORTANT: {pat['name']} detected \u2014 {pat['description']}")
        narrative_parts.append(f"OUTLOOK: The weight of technical evidence is {'bullish' if bullish_count >= 4 else 'bearish' if bearish_count >= 4 else 'mixed/neutral'}.")
        narrative_parts.append(f"{sym} shows {bullish_count} bullish signals against {bearish_count} bearish.")
        narrative_parts.append(f"Near-term upside target is R1 at Rs.{round((float(h.iloc[-1])+float(l.iloc[-1])+price)/3*2-float(l.iloc[-1]),0):,.0f}, with support at S1 Rs.{round((float(h.iloc[-1])+float(l.iloc[-1])+price)/3*2-float(h.iloc[-1]),0):,.0f}.")

        patterns_data = {
            "verdict": "BULLISH" if bullish_count >= 4 else "BEARISH" if bearish_count >= 4 else "NEUTRAL",
            "score": int((bullish_count / max(bullish_count + bearish_count, 1)) * 100),
            "bullish_signals": bullish_count,
            "bearish_signals": bearish_count,
            "signals": signals_list,
            "patterns": patterns_list,
            "narrative": " ".join(narrative_parts),
            "williams_r": wr,
        }
    except Exception as _pe:
        patterns_data = {"error": str(_pe), "signals": [], "patterns": [], "narrative": ""}

    result["patterns"] = patterns_data

    # ── 12. Quantamental Assessment ──
    pe = sf(fund.get("pe_trailing") or fund.get("trailingPE"), 0)
    pb_val = sf(fund.get("pb") or fund.get("priceToBook"), 0)
    roe_val = fix_pct_smart(fund.get("roe") or fund.get("returnOnEquity"), "roe")
    de = sf(fund.get("debt_equity") or fund.get("debtToEquity"), 0)
    rev_g = fix_pct_smart(fund.get("revenue_growth") or fund.get("revenueGrowth"), "growth")
    earn_g = fix_pct_smart(fund.get("earnings_growth") or fund.get("earningsGrowth"), "growth")
    pm = fix_pct_smart(fund.get("profit_margin") or fund.get("profitMargins"), "margin")

    # Value score
    value_score = 0
    if pe and 0 < pe < 15: value_score += 30
    elif pe and 15 <= pe < 25: value_score += 15
    if pb_val and pb_val < 2: value_score += 25
    elif pb_val and pb_val < 4: value_score += 10
    if fix_pct_smart(fund.get("dividend_yield") or fund.get("dividendYield"), "div") > 2: value_score += 20
    if de and de < 50: value_score += 15
    elif de and de < 100: value_score += 5
    if pm and pm > 15: value_score += 10

    # Growth score
    growth_score = 0
    if rev_g and rev_g > 15: growth_score += 30
    elif rev_g and rev_g > 5: growth_score += 15
    if earn_g and earn_g > 20: growth_score += 30
    elif earn_g and earn_g > 5: growth_score += 15
    if roe_val and roe_val > 15: growth_score += 20
    elif roe_val and roe_val > 10: growth_score += 10
    if rs_component > 60: growth_score += 20
    elif rs_component > 40: growth_score += 10

    # Quality score
    quality_score = 0
    if roe_val and roe_val > 15: quality_score += 25
    if pm and pm > 15: quality_score += 20
    if de and de < 30: quality_score += 20
    elif de and de < 80: quality_score += 10
    if fix_pct_smart(fund.get("operating_margin") or fund.get("operatingMargins"), "margin") > 15: quality_score += 15
    if vol_ratio < 2: quality_score += 10
    if adx_val > 20: quality_score += 10

    result["assessment"] = {
        "value_score": min(100, value_score),
        "growth_score": min(100, growth_score),
        "quality_score": min(100, quality_score),
        "value_verdict": "STRONG VALUE" if value_score >= 70 else "VALUE" if value_score >= 40 else "FAIRLY PRICED" if value_score >= 20 else "EXPENSIVE",
        "growth_verdict": "HIGH GROWTH" if growth_score >= 70 else "GROWTH" if growth_score >= 40 else "MODERATE" if growth_score >= 20 else "SLOW",
        "quality_verdict": "HIGH QUALITY" if quality_score >= 70 else "QUALITY" if quality_score >= 40 else "AVERAGE" if quality_score >= 20 else "WEAK",
    }

    if redis_client:
        await redis_client.setex(cache_key, 900, json.dumps(result))

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# SCREEN BUILDER — DYOR (installed 28 March 2026)
# ═══════════════════════════════════════════════════════════════════════════════

SCREENER_PARAMS = {
    "stocks": {
        "technical": [
            {"id":"price","label":"Current Price","unit":"Rs","field":"price"},
            {"id":"rsi","label":"RSI (14)","unit":"","field":"rsi"},
            {"id":"macd_hist","label":"MACD Histogram","unit":"","field":"macd_hist"},
            {"id":"sma_50","label":"SMA 50","unit":"Rs","field":"sma_50"},
            {"id":"sma_200","label":"SMA 200","unit":"Rs","field":"sma_200"},
            {"id":"ema_20","label":"EMA 20","unit":"Rs","field":"ema_20"},
            {"id":"price_vs_sma50","label":"Price vs SMA50 pct","unit":"%","field":"price_vs_sma50","computed":True},
            {"id":"price_vs_sma200","label":"Price vs SMA200 pct","unit":"%","field":"price_vs_sma200","computed":True},
            {"id":"vol_ratio","label":"Volume Ratio (vs 20D)","unit":"x","field":"vol_ratio"},
            {"id":"atr_pct","label":"ATR pct","unit":"%","field":"atr_pct"},
            {"id":"bb_width","label":"Bollinger Width","unit":"%","field":"bb_width"},
            {"id":"bb_pos","label":"BB Position","unit":"","field":"bb_pos"},
            {"id":"rs_3m","label":"Relative Strength 3M","unit":"%","field":"rs_3m"},
            {"id":"rs_6m","label":"Relative Strength 6M","unit":"%","field":"rs_6m"},
            {"id":"w52_high_pct","label":"pct from 52W High","unit":"%","field":"w52_high_pct","computed":True},
            {"id":"w52_low_pct","label":"pct from 52W Low","unit":"%","field":"w52_low_pct","computed":True},
            {"id":"adx","label":"ADX","unit":"","field":"adx"},
            {"id":"stoch_k","label":"Stochastic pctK","unit":"","field":"stoch_k"},
            {"id":"cci","label":"CCI (20)","unit":"","field":"cci"},
            {"id":"mfi","label":"Money Flow Index","unit":"","field":"mfi"},
            {"id":"supertrend","label":"Supertrend","unit":"","field":"supertrend","kind":"select"},
            {"id":"macd_signal","label":"MACD vs Signal","unit":"","field":"macd_signal","kind":"select"},
            {"id":"ma_cross","label":"MA Crossover","unit":"","field":"ma_cross","kind":"select"},
        ],
        "fundamental": [
            {"id":"market_cap","label":"Market Cap","unit":"Cr","field":"market_cap"},
            {"id":"pe_ratio","label":"P/E Ratio","unit":"x","field":"pe_ratio"},
            {"id":"pb_ratio","label":"P/B Ratio","unit":"x","field":"pb_ratio"},
            {"id":"ev_ebitda","label":"EV/EBITDA","unit":"x","field":"ev_ebitda"},
            {"id":"peg_ratio","label":"PEG Ratio","unit":"x","field":"peg_ratio"},
            {"id":"roe","label":"ROE","unit":"%","field":"roe"},
            {"id":"roce","label":"ROCE","unit":"%","field":"roce"},
            {"id":"debt_equity","label":"Debt/Equity","unit":"x","field":"debt_equity"},
            {"id":"current_ratio","label":"Current Ratio","unit":"x","field":"current_ratio"},
            {"id":"div_yield","label":"Dividend Yield","unit":"%","field":"dividend_yield"},
            {"id":"revenue_growth","label":"Revenue Growth YoY","unit":"%","field":"revenue_growth"},
            {"id":"pat_growth","label":"PAT Growth YoY","unit":"%","field":"pat_growth"},
            {"id":"eps_growth","label":"EPS Growth QoQ","unit":"%","field":"eps_growth"},
            {"id":"operating_margin","label":"Operating Margin","unit":"%","field":"operating_margin"},
            {"id":"net_margin","label":"Net Margin","unit":"%","field":"net_margin"},
        ],
        "ownership": [
            {"id":"promoter_hold","label":"Promoter Holding","unit":"%","field":"promoter_holding"},
            {"id":"promoter_pledge","label":"Promoter Pledge","unit":"%","field":"promoter_pledge"},
            {"id":"fii_hold","label":"FII Holding","unit":"%","field":"fii_holding"},
            {"id":"fii_chg","label":"FII Change QoQ","unit":"%","field":"fii_change"},
            {"id":"dii_hold","label":"DII Holding","unit":"%","field":"dii_holding"},
            {"id":"dii_chg","label":"DII Change QoQ","unit":"%","field":"dii_change"},
        ],
        "alpha": [
            {"id":"alpha_rating","label":"Alpha Rating","unit":"/100","field":"alpha_rating"},
            {"id":"momentum_score","label":"Momentum (25pct)","unit":"/100","field":"momentum_score"},
            {"id":"fundamental_score","label":"Fundamentals (25pct)","unit":"/100","field":"fundamental_score"},
            {"id":"accumulation_score","label":"Accumulation (20pct)","unit":"/100","field":"accumulation_score"},
            {"id":"trend_score","label":"Trend (15pct)","unit":"/100","field":"trend_score"},
            {"id":"sentiment_score","label":"Sentiment (15pct)","unit":"/100","field":"sentiment_score"},
        ],
        "sector": [
            {"id":"sector","label":"Sector","unit":"","field":"sector","kind":"multi_select"},
            {"id":"index","label":"Index","unit":"","field":"index_membership","kind":"multi_select"},
        ],
    },
    "futures": {
        "technical": [
            {"id":"price","label":"Futures Price","unit":"Rs","field":"price"},
            {"id":"rsi","label":"RSI (14)","unit":"","field":"rsi"},
            {"id":"macd_hist","label":"MACD Histogram","unit":"","field":"macd_hist"},
            {"id":"adx","label":"ADX","unit":"","field":"adx"},
            {"id":"vol_ratio","label":"Volume Ratio","unit":"x","field":"vol_ratio"},
            {"id":"supertrend","label":"Supertrend","unit":"","field":"supertrend","kind":"select"},
        ],
        "contract": [
            {"id":"basis","label":"Basis pct","unit":"%","field":"basis"},
            {"id":"basis_ann","label":"Annualized Basis","unit":"%","field":"basis_annualized"},
            {"id":"oi","label":"Open Interest","unit":"lots","field":"oi"},
            {"id":"oi_chg","label":"OI Change 1D","unit":"%","field":"oi_change"},
            {"id":"oi_buildup","label":"OI Buildup","unit":"","field":"oi_buildup","kind":"select"},
            {"id":"lot_size","label":"Lot Size","unit":"","field":"lot_size"},
            {"id":"expiry_days","label":"Days to Expiry","unit":"d","field":"expiry_days"},
            {"id":"rollover_pct","label":"Rollover pct","unit":"%","field":"rollover_pct"},
            {"id":"coc","label":"Cost of Carry","unit":"%","field":"cost_of_carry"},
        ],
        "alpha": [
            {"id":"alpha_rating","label":"Alpha Rating","unit":"/100","field":"alpha_rating"},
            {"id":"momentum_score","label":"Momentum Score","unit":"/100","field":"momentum_score"},
        ],
    },
    "options": {
        "contract": [
            {"id":"option_type","label":"Option Type","unit":"","field":"option_type","kind":"select"},
            {"id":"moneyness","label":"Moneyness","unit":"","field":"moneyness","kind":"select"},
            {"id":"expiry_days","label":"Days to Expiry","unit":"d","field":"expiry_days"},
            {"id":"strike_dist","label":"Strike Distance pct","unit":"%","field":"strike_distance"},
            {"id":"premium","label":"Premium","unit":"Rs","field":"premium"},
            {"id":"volume","label":"Volume","unit":"","field":"volume"},
            {"id":"oi","label":"Open Interest","unit":"lots","field":"oi"},
            {"id":"oi_chg","label":"OI Change pct","unit":"%","field":"oi_change"},
        ],
        "volatility": [
            {"id":"iv","label":"Implied Volatility","unit":"%","field":"iv"},
            {"id":"iv_rank","label":"IV Rank","unit":"%","field":"iv_rank"},
            {"id":"iv_pctl","label":"IV Percentile","unit":"%","field":"iv_percentile"},
            {"id":"hv_20","label":"HV 20D","unit":"%","field":"hv_20"},
            {"id":"iv_hv_diff","label":"IV-HV Spread","unit":"%","field":"iv_hv_spread"},
        ],
        "greeks": [
            {"id":"delta","label":"Delta","unit":"","field":"delta"},
            {"id":"gamma","label":"Gamma","unit":"","field":"gamma"},
            {"id":"theta","label":"Theta","unit":"Rs/day","field":"theta"},
            {"id":"vega","label":"Vega","unit":"Rs/pctIV","field":"vega"},
        ],
        "sentiment": [
            {"id":"pcr_oi","label":"PCR (OI)","unit":"","field":"pcr_oi"},
            {"id":"pcr_vol","label":"PCR (Volume)","unit":"","field":"pcr_volume"},
            {"id":"max_pain","label":"Max Pain Distance","unit":"%","field":"max_pain_dist"},
        ],
    },
}


def sb_apply_operator(value, operator, filter_values):
    if value is None:
        return False
    try:
        if isinstance(value, str) and operator not in ("eq", "in"):
            val = float(value)
        else:
            val = value
    except (TypeError, ValueError):
        return False
    if operator == "eq":
        if isinstance(val, str):
            return str(val).lower() == str(filter_values[0]).lower()
        try:
            return abs(float(val) - float(filter_values[0])) < 0.001
        except:
            return str(val) == str(filter_values[0])
    elif operator == "gt":
        return float(val) > float(filter_values[0])
    elif operator == "lt":
        return float(val) < float(filter_values[0])
    elif operator == "gte":
        return float(val) >= float(filter_values[0])
    elif operator == "lte":
        return float(val) <= float(filter_values[0])
    elif operator == "between":
        return float(filter_values[0]) <= float(val) <= float(filter_values[1])
    elif operator == "in":
        if isinstance(val, list):
            return any(v in filter_values for v in val)
        return val in filter_values
    return False


def sb_extract_value(data, param_id, category, asset_type):
    params_list = SCREENER_PARAMS.get(asset_type, {}).get(category, [])
    param_def = next((p for p in params_list if p["id"] == param_id), None)
    if not param_def:
        for cat_params in SCREENER_PARAMS.get(asset_type, {}).values():
            param_def = next((p for p in cat_params if p["id"] == param_id), None)
            if param_def:
                break
    field = param_def.get("field", param_id) if param_def else param_id
    if field in data:
        return data[field]
    ALT_FIELDS = {
        "w52_high_pct": "pct_from_52h", "w52_low_pct": "pct_from_52l",
        "price_vs_sma50": "sma_50", "price_vs_sma200": "sma_200",
        "change_pct": "change_pct", "vol_ratio": "vol_ratio",
        "basis_ann": "basis_annualized", "oi_chg": "oi_change",
        "fut_price": "futures_price", "iv": "atm_iv",
        "iv_hv_diff": "iv_hv_spread", "pcr": "pcr_oi",
        "hv_20": "hv_20", "strike_dist": "max_pain_dist",
        "premium": "atm_iv", "div_yield": "dividend_yield",
        "rs_score": "rs_3m", "momentum": "rs_1m",
        "above_200": "above_200dma", "above_50": "above_50dma",
    }
    if field in ALT_FIELDS and ALT_FIELDS[field] in data:
        return data[ALT_FIELDS[field]]
    if param_id in ALT_FIELDS and ALT_FIELDS[param_id] in data:
        return data[ALT_FIELDS[param_id]]
    if param_id in data:
        return data[param_id]
    if param_id == "price_vs_sma50":
        price = data.get("price"); sma50 = data.get("sma_50")
        if price and sma50 and float(sma50) > 0:
            return ((float(price) - float(sma50)) / float(sma50)) * 100
    elif param_id == "price_vs_sma200":
        price = data.get("price"); sma200 = data.get("sma_200")
        if price and sma200 and float(sma200) > 0:
            return ((float(price) - float(sma200)) / float(sma200)) * 100
    elif param_id == "w52_high_pct":
        price = data.get("price"); w52h = data.get("w52_high")
        if price and w52h and float(w52h) > 0:
            return ((float(price) - float(w52h)) / float(w52h)) * 100
    elif param_id == "w52_low_pct":
        price = data.get("price"); w52l = data.get("w52_low")
        if price and w52l and float(w52l) > 0:
            return ((float(price) - float(w52l)) / float(w52l)) * 100
    for section in ["technical", "fundamental", "ownership", "alpha"]:
        if section in data and isinstance(data[section], dict):
            if field in data[section]:
                return data[section][field]
    return None


def sb_evaluate_filters(data, filters, logic, asset_type):
    if not filters:
        return True
    results = []
    for f in filters:
        param_id = f.get("pid") or f.get("param_id")
        category = f.get("cat") or f.get("category")
        operator = f.get("op") or f.get("operator", "between")
        values = f.get("vals") or f.get("values", [])
        for cat_params in SCREENER_PARAMS.get(asset_type, {}).values():
            pd_ = next((p for p in cat_params if p["id"] == param_id), None)
            if pd_:
                if pd_.get("kind") == "multi_select":
                    operator = "in"
                break
        value = sb_extract_value(data, param_id, category, asset_type)
        results.append(sb_apply_operator(value, operator, values))
    return all(results) if logic == "AND" else any(results)


@app.get("/api/screener/params", tags=["Screen Builder"], summary="Get screener parameter catalog")
async def get_screener_params(asset_type: str = "stocks"):
    if asset_type not in SCREENER_PARAMS:
        return {"error": "Unknown asset type. Use: stocks, futures, options"}
    return {"asset_type": asset_type, "categories": SCREENER_PARAMS[asset_type]}


async def sb_get_full_universe() -> list:
    """Scan full 923-stock universe for Screen Builder. Redis-cached 4 hours."""
    from datetime import date, timedelta
    if redis_client:
        cached = await redis_client.get("sb_universe")
        if cached:
            return json.loads(cached)
    start = (date.today() - timedelta(days=400)).isoformat()
    end = date.today().isoformat()
    symbols_to_scan = list(NIFTY_UNIVERSE)
    yf_symbols = [f"{s}.NS" for s in symbols_to_scan]
    _batch_sz = 40 if len(yf_symbols) > 500 else 50
    all_data = await batch_download_yf(yf_symbols, start, end, batch_size=_batch_sz)

    def sf(v, d=0):
        try:
            v = float(v)
            return d if (np.isnan(v) or np.isinf(v)) else v
        except:
            return d

    stocks = []
    for sym in symbols_to_scan:
        try:
            yf_sym = f"{sym}.NS"
            if yf_sym not in all_data:
                continue
            df = all_data[yf_sym].dropna()
            if len(df) < 30:
                continue
            c = df["Close"].astype(float)
            h = df["High"].astype(float)
            l = df["Low"].astype(float)
            v = df["Volume"].astype(float)
            price = float(c.iloc[-1])
            prev = float(c.iloc[-2])
            change_pct = sf((price - prev) / prev * 100)
            vol = int(v.iloc[-1])
            vol_avg = int(v.rolling(20).mean().iloc[-1]) if len(v) >= 20 else int(v.mean())
            vol_ratio = sf(vol / vol_avg, 1.0) if vol_avg > 0 else 1.0
            delta = c.diff()
            gain = delta.clip(lower=0).ewm(span=14, adjust=False).mean()
            loss = (-delta.clip(upper=0)).ewm(span=14, adjust=False).mean()
            rs_val = gain.iloc[-1] / loss.iloc[-1] if sf(loss.iloc[-1]) != 0 else 0
            rsi = sf(100 - 100 / (1 + rs_val), 50)
            sma_50 = sf(c.rolling(50).mean().iloc[-1])
            sma_200 = sf(c.rolling(200).mean().iloc[-1]) if len(c) >= 200 else sf(c.mean())
            c_252 = c.iloc[-min(252, len(c)):]
            w52_high = sf(c_252.max())
            w52_low = sf(c_252.min())
            pct_from_52h = sf((price - w52_high) / w52_high * 100) if w52_high > 0 else 0
            pct_from_52l = sf((price - w52_low) / w52_low * 100) if w52_low > 0 else 0
            bb_mid = c.rolling(20).mean()
            bb_std = c.rolling(20).std()
            bb_upper = sf((bb_mid + 2 * bb_std).iloc[-1])
            bb_lower_val = sf((bb_mid - 2 * bb_std).iloc[-1])
            bb_width = sf((bb_upper - bb_lower_val) / sf(bb_mid.iloc[-1], 1) * 100) if sf(bb_mid.iloc[-1]) > 0 else 0
            ema12 = c.ewm(span=12, adjust=False).mean()
            ema26 = c.ewm(span=26, adjust=False).mean()
            macd_line = ema12 - ema26
            macd_signal_line = macd_line.ewm(span=9, adjust=False).mean()
            macd_hist = sf((macd_line - macd_signal_line).iloc[-1])
            macd_cross_up = sf(macd_line.iloc[-1]) > sf(macd_signal_line.iloc[-1]) and sf(macd_line.iloc[-2]) <= sf(macd_signal_line.iloc[-2])
            rs_3m = sf(c.iloc[-1] / c.iloc[-60] - 1, 0) * 100 if len(c) >= 60 and sf(c.iloc[-60]) > 0 else change_pct
            rs_1m = sf(c.iloc[-1] / c.iloc[-22] - 1, 0) * 100 if len(c) >= 22 and sf(c.iloc[-22]) > 0 else change_pct
            sma50_s = c.rolling(50).mean()
            sma200_s = c.rolling(200).mean() if len(c) >= 200 else c.rolling(min(len(c), 100)).mean()
            golden_cross = False
            if len(sma50_s.dropna()) >= 2 and len(sma200_s.dropna()) >= 2:
                golden_cross = bool(sf(sma50_s.iloc[-1]) > sf(sma200_s.iloc[-1]) and sf(sma50_s.iloc[-2]) <= sf(sma200_s.iloc[-2]))
            tr = pd.concat([h - l, (h - df["Close"].shift(1)).abs(), (l - df["Close"].shift(1)).abs()], axis=1).max(axis=1)
            atr = tr.rolling(10).mean()
            st_lower_val = (h + l) / 2 - 3 * atr
            above_supertrend = bool(price > sf(st_lower_val.iloc[-1])) if len(atr.dropna()) > 0 else bool(price > sma_200)
            minervini_score = sum([
                bool(price > sf(c.rolling(150).mean().iloc[-1])) if len(c) >= 150 else False,
                bool(price > sma_200), bool(price > sma_50), bool(sma_50 > sma_200),
                bool(pct_from_52l >= 25), bool(pct_from_52h >= -25),
            ])
            wk_change = sf((price / sf(c.iloc[-6], price) - 1) * 100) if len(c) >= 6 else change_pct
            gap_pct = sf((float(df["Open"].iloc[-1]) - prev) / prev * 100) if prev > 0 else 0
            stocks.append({
                "symbol": sym, "name": sym,
                "price": round(sf(price), 2), "change_pct": round(change_pct, 2), "change": round(change_pct, 2),
                "volume": vol, "vol_ratio": round(vol_ratio, 2), "rsi": round(rsi, 1),
                "macd_hist": round(macd_hist, 2), "sma_50": round(sma_50, 2), "sma_200": round(sma_200, 2),
                "w52_high": round(w52_high, 2), "w52_low": round(w52_low, 2),
                "pct_from_52h": round(pct_from_52h, 1), "pct_from_52l": round(pct_from_52l, 1),
                "bb_width": round(bb_width, 2), "rs_1m": round(rs_1m, 1), "rs_3m": round(rs_3m, 1),
                "gap_pct": round(gap_pct, 2), "wk_change": round(wk_change, 2),
                "above_200dma": bool(price > sma_200), "above_50dma": bool(price > sma_50),
                "golden_cross": golden_cross, "above_supertrend": above_supertrend,
                "macd_cross_up": macd_cross_up, "minervini_score": minervini_score,
                "sector": SECTOR_MAP.get(sym, "Other"), "industry": INDUSTRY_MAP.get(sym, "Other"),
                "cap_segment": get_cap_segment(sym),
                "pe_ratio": 0, "roe": 0, "dividend_yield": 0, "debt_equity": 0,
                "market_cap": 0, "alpha_rating": 0, "momentum_score": 0,
                "fundamental_score": 0, "accumulation_score": 0, "trend_score": 0, "sentiment_score": 0,
            })
        except Exception:
            continue
    if redis_client and stocks:
        await redis_client.set("sb_universe", json.dumps(stocks), ex=14400)
    return stocks




# ══════════════════════════════════════════════════════════════════════════════
# MTF COMBINER (server-side) — reads sb_universe from Redis, applies multiple
# strategy filters in one pass, returns confluence-scored results.
# ══════════════════════════════════════════════════════════════════════════════

MTF_TF_MAP = {
    "short": ["momentum", "up_on_volume", "gap_up", "bb_squeeze", "macd_crossover", "supertrend_buy", "volume", "overbought", "top_losers", "volume_dry", "gap_down"],
    "medium": ["breakout", "pullback_buy", "relative_strength", "recent_breakout", "range_breakout", "oversold", "near_support", "high_beta", "macd_bearish", "trend_strong", "turnaround", "sector_rotation"],
    "long": ["golden_cross", "death_cross", "52w_high", "52w_low", "minervini", "multi_timeframe", "growth_momentum", "safe_haven"],
    "fundamental": ["low_pe", "high_roe", "dividend_yield"],
}

MTF_STRAT_MAP = {
    "momentum": lambda s: s.get("change_pct", 0) > 1 and s.get("vol_ratio", 0) > 1.5 and s.get("rsi", 0) > 50,
    "oversold": lambda s: s.get("rsi", 50) < 35,
    "overbought": lambda s: s.get("rsi", 50) > 70,
    "volume": lambda s: s.get("vol_ratio", 0) > 3,
    "breakout": lambda s: s.get("pct_from_52h", -100) > -3 and s.get("vol_ratio", 0) > 2,
    "52w_high": lambda s: s.get("pct_from_52h", -100) > -2,
    "52w_low": lambda s: s.get("pct_from_52l", 100) < 5,
    "golden_cross": lambda s: s.get("above_200dma") and s.get("above_50dma") and s.get("sma_50", 0) > s.get("sma_200", 0),
    "death_cross": lambda s: not s.get("above_200dma") and not s.get("above_50dma"),
    "gap_up": lambda s: s.get("gap_pct", 0) > 2,
    "gap_down": lambda s: s.get("gap_pct", 0) < -2,
    "up_on_volume": lambda s: s.get("change_pct", 0) > 0 and s.get("vol_ratio", 0) > 2,
    "bb_squeeze": lambda s: s.get("bb_width", 100) < 10,
    "macd_crossover": lambda s: s.get("macd_cross_up", False),
    "minervini": lambda s: s.get("minervini_score", 0) >= 5,
    "relative_strength": lambda s: s.get("rs_3m", 0) > 15 and s.get("rs_1m", 0) > 5,
    "recent_breakout": lambda s: s.get("pct_from_52h", -100) > -5 and s.get("vol_ratio", 0) > 1.5,
    "pullback_buy": lambda s: s.get("above_200dma") and s.get("rsi", 50) < 45 and s.get("pct_from_52h", 0) < -10,
    "top_losers": lambda s: s.get("change_pct", 0) < -2,
    "near_support": lambda s: s.get("pct_from_52l", 100) < 10 and s.get("above_200dma"),
    "trend_strong": lambda s: s.get("above_supertrend") and s.get("above_200dma") and s.get("rsi", 0) > 55,
    "high_beta": lambda s: abs(s.get("rs_1m", 0)) > 10,
    "range_breakout": lambda s: s.get("bb_width", 0) > 30 and s.get("vol_ratio", 0) > 1.5,
    "volume_dry": lambda s: s.get("vol_ratio", 1) < 0.4,
    "macd_bearish": lambda s: not s.get("macd_cross_up", False) and s.get("macd_hist", 0) < 0,
    "supertrend_buy": lambda s: s.get("above_supertrend"),
    "dividend_yield": lambda s: True,
    "low_pe": lambda s: True,
    "high_roe": lambda s: True,
    "growth_momentum": lambda s: s.get("rs_3m", 0) > 10 and s.get("above_200dma"),
    "safe_haven": lambda s: s.get("above_200dma") and s.get("rsi", 50) < 60 and s.get("vol_ratio", 1) < 1.5,
    "turnaround": lambda s: s.get("rs_1m", 0) > 5 and s.get("pct_from_52l", 100) < 20 and not s.get("above_200dma"),
    "sector_rotation": lambda s: s.get("rs_1m", 0) > 3 and s.get("rs_3m", 0) < 0,
    "multi_timeframe": lambda s: s.get("above_200dma") and s.get("above_50dma") and s.get("rsi", 0) > 50 and s.get("change_pct", 0) > 0 and s.get("rs_1m", 0) > 0 and s.get("rs_3m", 0) > 0,
}

def _mtf_get_tf(strat: str) -> str:
    for tf, strats in MTF_TF_MAP.items():
        if strat in strats:
            return tf
    return "short"


@app.get("/api/mtf-scan", tags=["MTF Combiner"], summary="Multi-timeframe strategy combiner",
    description="Run multiple strategies in one pass against the cached stock universe. Returns stocks with confluence scoring — how many strategies each stock passes and across how many timeframes. Much faster than calling /api/screener N times.")
async def mtf_scan(
    strategies: str = "momentum,breakout,golden_cross,relative_strength",
    min_price: float = 0, max_price: float = 999999,
    sector: str = "", min_confluence: int = 2,
    user=Depends(get_current_user)
):
    selected = [s.strip() for s in strategies.split(",") if s.strip()]
    if len(selected) < 2:
        return {"error": "Select at least 2 strategies (comma-separated)"}

    # Load universe from Redis cache (pre-computed by warm_cache / sb_get_full_universe)
    stocks = []
    if redis_client:
        cached = await redis_client.get("sb_universe")
        if cached:
            stocks = json.loads(cached)
    if not stocks:
        return {"stocks": [], "count": 0, "cached": False,
                "message": "Universe cache is empty. Please wait for cache warm to complete or trigger POST /api/screener/warm-all."}

    # Pre-filter by price and sector
    if int(min_price) > 0 or int(max_price) < 999999:
        stocks = [s for s in stocks if min_price <= s.get("price", 0) <= max_price]
    if sector:
        stocks = [s for s in stocks if s.get("sector", "").lower() == sector.lower()]

    # Run all strategies in one pass
    per_strat_results = {}
    for strat in selected:
        fn = MTF_STRAT_MAP.get(strat)
        if not fn:
            continue
        tf = _mtf_get_tf(strat)
        hits = []
        for s in stocks:
            try:
                if fn(s):
                    hits.append(s["symbol"])
            except Exception:
                continue
        per_strat_results[strat] = {"timeframe": tf, "hits": set(hits), "count": len(hits)}

    # Combine & score
    smap = {}
    for strat, info in per_strat_results.items():
        tf = info["timeframe"]
        for sym in info["hits"]:
            if sym not in smap:
                # Find the stock data
                sd = next((s for s in stocks if s["symbol"] == sym), None)
                if not sd:
                    continue
                smap[sym] = {
                    "symbol": sym, "name": sd.get("name", sym),
                    "price": sd.get("price", 0), "change_pct": sd.get("change_pct", 0),
                    "rsi": sd.get("rsi", 0), "vol_ratio": sd.get("vol_ratio", 0),
                    "sector": sd.get("sector", ""), "industry": sd.get("industry", ""),
                    "cap_segment": sd.get("cap_segment", ""),
                    "above_200dma": sd.get("above_200dma", False),
                    "rs_1m": sd.get("rs_1m", 0), "rs_3m": sd.get("rs_3m", 0),
                    "market_cap": sd.get("market_cap", 0),
                    "strategies": [], "timeframes": set(),
                    "tf_details": {"short": [], "medium": [], "long": [], "fundamental": []},
                }
            smap[sym]["strategies"].append(strat)
            smap[sym]["timeframes"].add(tf)
            smap[sym]["tf_details"][tf].append(strat)

    # Filter by min confluence & score
    result_stocks = []
    for sym, data in smap.items():
        if len(data["strategies"]) < min_confluence:
            continue
        tf_count = len(data["timeframes"])
        strat_count = len(data["strategies"])
        score = tf_count * 10 + strat_count * 3 + (5 if data["above_200dma"] else 0)
        result_stocks.append({
            **{k: v for k, v in data.items() if k not in ("timeframes", "tf_details")},
            "strat_count": strat_count,
            "tf_count": tf_count,
            "score": score,
            "timeframes": list(data["timeframes"]),
            "tf_details": {k: v for k, v in data["tf_details"].items() if v},
        })

    result_stocks.sort(key=lambda x: (x["score"], x["strat_count"]), reverse=True)

    return {
        "stocks": result_stocks,
        "count": len(result_stocks),
        "total_universe": len(stocks),
        "total_unique_hits": len(smap),
        "strategies_run": len(per_strat_results),
        "per_strategy": {k: {"timeframe": v["timeframe"], "count": v["count"]} for k, v in per_strat_results.items()},
        "cached": True,
    }


async def sb_enrich_fundamentals(stocks: list) -> list:
    """Fetch fundamentals for all stocks concurrently, in batches of 25."""
    import asyncio
    def sf(v, d=0):
        try:
            v = float(v)
            return d if (np.isnan(v) or np.isinf(v)) else v
        except:
            return d
    async def fetch_one(s):
        try:
            fdata = await ds_fundamentals(s["symbol"])
            if fdata:
                pe = sf(fdata.get("pe_trailing") or fdata.get("pe_forward") or fdata.get("pe_ratio", 0))
                roe_val = sf(fdata.get("roe", 0))
                if roe_val == 0:
                    roe_val = sf(fdata.get("roce", 0))
                roe = roe_val * 100 if roe_val and roe_val < 1 else (roe_val or 0)
                dy = sf(fdata.get("dividend_yield", 0))
                de = sf(fdata.get("debt_equity", 0))
                mc = sf(fdata.get("market_cap", 0))
                pb = sf(fdata.get("pb", 0))
                pm = sf(fdata.get("profit_margin", 0))
                s["pe_ratio"] = round(pe, 2)
                s["roe"] = round(roe, 2)
                s["dividend_yield"] = round(dy, 2)
                s["debt_equity"] = round(de, 2)
                s["market_cap"] = mc
                s["pb"] = round(pb, 2)
                s["profit_margin"] = round(pm, 2)
                s["name"] = fdata.get("name", s.get("name", s["symbol"]))
        except:
            pass
        return s
    batch_size = 25
    enriched = []
    for i in range(0, len(stocks), batch_size):
        batch = stocks[i:i + batch_size]
        results = await asyncio.gather(*[fetch_one(s) for s in batch])
        enriched.extend(results)
    return enriched


@app.post("/api/screener/warm-fundamentals", tags=["Screen Builder"], summary="Pre-warm stock universe + fundamentals cache")
async def screener_warm_fundamentals(request: Request, user=None):
    import asyncio, time as _time
    t0 = _time.time()
    if not redis_client:
        return {"error": "Redis not available"}
    existing = await redis_client.get("sb_universe_enriched")
    if existing:
        ttl = await redis_client.ttl("sb_universe_enriched")
        if ttl > 7200:
            return {"status": "already_warm", "ttl_seconds": ttl}
    stocks = await sb_get_full_universe()
    enriched = await sb_enrich_fundamentals([s.copy() for s in stocks])
    await redis_client.set("sb_universe_enriched", json.dumps(enriched), ex=14400)
    elapsed = round(_time.time() - t0, 1)
    non_zero_pe = sum(1 for s in enriched if s.get("pe_ratio", 0) > 0)
    return {"status": "ok", "total": len(enriched), "with_pe": non_zero_pe, "elapsed_s": elapsed}


def sb_get_fno_symbol(symbol: str, expiry_date) -> str:
    mon = expiry_date.strftime("%b").upper()
    yr = expiry_date.strftime("%y")
    return f"NSE_{symbol}{yr}{mon}FUT"

def sb_get_near_expiry():
    from datetime import date, timedelta
    import calendar
    today = date.today()
    for month_offset in range(3):
        month = today.month + month_offset
        year = today.year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        last_day = calendar.monthrange(year, month)[1]
        ld = date(year, month, last_day)
        while ld.weekday() != 3:
            ld -= timedelta(days=1)
        if ld >= today:
            return ld
    return today + timedelta(days=30)


async def sb_build_futures_cache() -> dict:
    import urllib.request, urllib.error, urllib.parse, math
    from datetime import date
    LOT_SIZES = {
        "NIFTY": 25, "BANKNIFTY": 15, "FINNIFTY": 25,
        "RELIANCE": 250, "TCS": 150, "INFY": 300, "HDFCBANK": 550,
        "ICICIBANK": 700, "SBIN": 750, "TATAMOTORS": 575, "ITC": 1600,
        "BAJFINANCE": 125, "MARUTI": 100, "WIPRO": 1500, "SUNPHARMA": 700,
        "TATASTEEL": 550, "LT": 150, "AXISBANK": 600, "BHARTIARTL": 475,
        "M&M": 350, "ADANIENT": 400, "HCLTECH": 350, "KOTAKBANK": 400,
        "TITAN": 375, "HINDALCO": 1400, "JSWSTEEL": 675, "CIPLA": 650,
        "DRREDDY": 125, "ONGC": 3250, "NTPC": 2250, "POWERGRID": 2700,
        "COALINDIA": 2100,
    }
    INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY"}
    GROWW_SYMBOL_MAP = {"TATAMOTORS": "TMPV", "M&M": "M&M"}
    groww_token = await get_groww_token()
    if not groww_token:
        return {"error": "No Groww token"}
    expiry = sb_get_near_expiry()
    days_to_expiry = max(1, (expiry - date.today()).days)
    risk_free = 0.065

    async def groww_get(url):
        import asyncio
        loop = asyncio.get_event_loop()
        req_obj = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {groww_token}",
            "X-API-VERSION": "1.0"
        })
        return await loop.run_in_executor(None,
            lambda: urllib.request.urlopen(req_obj, timeout=10).read().decode())

    symbols = list(LOT_SIZES.keys())
    non_index_symbols = [s for s in symbols if s not in INDEX_SYMBOLS]
    cash_syms = [f"NSE_{GROWW_SYMBOL_MAP.get(s, s)}" for s in non_index_symbols]
    spot_prices = {}
    BATCH = 15
    for i in range(0, len(cash_syms), BATCH):
        batch_syms = cash_syms[i:i+BATCH]
        batch_names = non_index_symbols[i:i+BATCH]
        try:
            encoded = urllib.parse.quote(",".join(batch_syms), safe=",_")
            resp = json.loads(await groww_get(
                f"https://api.groww.in/v1/live-data/ltp?segment=CASH&exchange_symbols={encoded}"
            ))
            if resp.get("status") == "SUCCESS":
                for sym, gs in zip(batch_names, batch_syms):
                    spot_prices[sym] = float(resp["payload"].get(gs, 0))
        except:
            pass
    index_cash_map = {"NIFTY": "NSE_NIFTY_50", "BANKNIFTY": "NSE_NIFTY_BANK", "FINNIFTY": "NSE_NIFTY_FIN_SERVICE"}
    for idx, gsym in index_cash_map.items():
        try:
            resp = json.loads(await groww_get(
                f"https://api.groww.in/v1/live-data/ltp?segment=CASH&exchange_symbols={gsym}"
            ))
            if resp.get("status") == "SUCCESS" and resp["payload"].get(gsym):
                spot_prices[idx] = float(resp["payload"][gsym])
        except:
            pass

    def make_fut_sym(s, exp):
        gs = GROWW_SYMBOL_MAP.get(s, s)
        mon = exp.strftime("%b").upper()
        yr = exp.strftime("%y")
        return f"NSE_{gs}{yr}{mon}FUT"

    fut_syms = [make_fut_sym(s, expiry) for s in symbols]
    fut_prices = {}
    for i in range(0, len(fut_syms), BATCH):
        batch_fsyms = fut_syms[i:i+BATCH]
        batch_names = symbols[i:i+BATCH]
        try:
            encoded = urllib.parse.quote(",".join(batch_fsyms), safe=",_")
            resp = json.loads(await groww_get(
                f"https://api.groww.in/v1/live-data/ltp?segment=FNO&exchange_symbols={encoded}"
            ))
            if resp.get("status") == "SUCCESS":
                for sym, fsym in zip(batch_names, batch_fsyms):
                    fut_prices[sym] = float(resp["payload"].get(fsym, 0))
        except:
            pass

    results = {}
    for sym in symbols:
        try:
            spot = spot_prices.get(sym, 0)
            fut = fut_prices.get(sym, 0)
            lot = LOT_SIZES.get(sym, 50)
            if not spot and not fut:
                continue
            if not fut and spot:
                t = days_to_expiry / 365
                fut = round(spot * math.exp(risk_free * t), 2)
            basis = round(fut - spot, 2) if spot else 0
            basis_pct = round(basis / spot * 100, 2) if spot else 0
            t = days_to_expiry / 365
            basis_ann = round((basis_pct / 100) / t * 100, 2) if t > 0 and spot > 0 else 0
            data = {
                "symbol": sym, "spot": round(spot, 2),
                "futures_price": round(fut, 2), "price": round(fut, 2),
                "basis": basis, "basis_pct": basis_pct, "basis_annualized": basis_ann,
                "lot_size": lot, "expiry": expiry.isoformat(),
                "days_to_expiry": days_to_expiry,
                "oi": 0, "oi_change": 0, "oi_buildup": "long_buildup",
                "change_pct": round((fut - spot) / spot * 100, 2) if spot else 0,
                "is_fno": True, "is_index": sym in INDEX_SYMBOLS,
                "sector": SECTOR_MAP.get(sym, "Index" if sym in INDEX_SYMBOLS else "Other"),
            }
            if redis_client:
                await redis_client.set(f"futures:{sym}", json.dumps(data), ex=3600)
            results[sym] = data
        except:
            continue
    return results


@app.post("/api/screener/warm-fno", tags=["Screen Builder"], summary="Pre-warm futures cache for all F&O stocks")
async def screener_warm_fno(request: Request, user=None):
    import time as _time
    t0 = _time.time()
    if not redis_client:
        return {"error": "Redis not available"}
    fut_results = await sb_build_futures_cache()
    elapsed = round(_time.time() - t0, 1)
    return {
        "status": "ok", "futures_cached": len(fut_results),
        "elapsed_s": elapsed, "symbols": list(fut_results.keys()),
        "error": fut_results.get("error")
    }


async def sb_build_options_cache() -> dict:
    import asyncio
    LOT_SIZES = {
        "NIFTY": 25, "BANKNIFTY": 15, "FINNIFTY": 25,
        "RELIANCE": 250, "TCS": 150, "INFY": 300, "HDFCBANK": 550,
        "ICICIBANK": 700, "SBIN": 750, "TATAMOTORS": 575, "ITC": 1600,
        "BAJFINANCE": 125, "MARUTI": 100, "WIPRO": 1500, "SUNPHARMA": 700,
        "TATASTEEL": 550, "LT": 150, "AXISBANK": 600, "BHARTIARTL": 475,
        "M&M": 350, "ADANIENT": 400, "HCLTECH": 350, "KOTAKBANK": 400,
        "TITAN": 375, "HINDALCO": 1400, "JSWSTEEL": 675, "CIPLA": 650,
        "DRREDDY": 125, "ONGC": 3250, "NTPC": 2250, "POWERGRID": 2700,
        "COALINDIA": 2100,
    }
    async def fetch_one(sym):
        try:
            import httpx
            svc_token = create_token(1, "service@alphamarket.co.in", True)
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"http://localhost:8001/api/options/chain/{sym}",
                    headers={"Authorization": f"Bearer {svc_token}"},
                    timeout=30
                )
                if resp.status_code != 200:
                    return None
                d = resp.json()
            spot = d.get("spot_price", 0)
            chains = d.get("chains", [])
            if not chains or not spot:
                return None
            c0 = chains[0]
            calls = c0.get("calls", [])
            puts = c0.get("puts", [])
            expiry = c0.get("expiry", "")
            atm_call = min(calls, key=lambda x: abs(x.get("strike", 0) - spot)) if calls else {}
            atm_put  = min(puts,  key=lambda x: abs(x.get("strike", 0) - spot)) if puts  else {}
            atm_iv   = round((atm_call.get("iv", 0) + atm_put.get("iv", 0)) / 2, 1)
            atm_strike = atm_call.get("strike", 0)
            otm_puts = [p for p in puts if p.get("strike", 0) < spot * 0.97]
            otm_put_iv = round(sum(p.get("iv", 0) for p in otm_puts[-3:]) / max(len(otm_puts[-3:]), 1), 1) if otm_puts else atm_iv
            iv_skew = round(otm_put_iv - atm_iv, 1)
            hv_20 = d.get("hist_vol", 0)
            pcr_oi   = d.get("pcr", 0)
            max_pain = d.get("max_pain", 0)
            max_pain_dist = round((max_pain - spot) / spot * 100, 2) if spot and max_pain else 0
            total_call_oi = d.get("total_call_oi", 0)
            total_put_oi  = d.get("total_put_oi", 0)
            from datetime import date
            try:
                exp_date = date.fromisoformat(expiry)
                days_to_expiry = max(0, (exp_date - date.today()).days)
            except:
                days_to_expiry = 0
            data = {
                "symbol": sym, "spot": spot,
                "atm_strike": atm_strike, "atm_iv": atm_iv,
                "iv_skew": iv_skew,
                "hv_20": round(float(hv_20 or 0) if float(hv_20 or 0) > 1 else float(hv_20 or 0) * 100, 1),
                "iv_hv_spread": round(atm_iv - (float(hv_20 or 0) if float(hv_20 or 0) > 1 else float(hv_20 or 0) * 100), 1),
                "pcr_oi": pcr_oi, "max_pain": max_pain, "max_pain_dist": max_pain_dist,
                "total_call_oi": total_call_oi, "total_put_oi": total_put_oi,
                "expiry": expiry, "days_to_expiry": days_to_expiry,
                "lot_size": LOT_SIZES.get(sym, 50),
                "delta": atm_call.get("delta", 0),
                "theta": atm_call.get("theta", 0),
                "vega": atm_call.get("vega", 0),
                "iv_rank": 0, "iv_percentile": 0,
                "is_fno": True,
                "sector": SECTOR_MAP.get(sym, "Index"),
            }
            if redis_client:
                await redis_client.set(f"options:{sym}", json.dumps(data), ex=3600)
            return (sym, data)
        except Exception:
            return None
    symbols = list(LOT_SIZES.keys())
    results = {}
    for i in range(0, len(symbols), 5):
        batch = symbols[i:i+5]
        batch_results = await asyncio.gather(*[fetch_one(s) for s in batch])
        for r in batch_results:
            if r:
                results[r[0]] = r[1]
    return results


@app.post("/api/screener/warm-options", tags=["Screen Builder"], summary="Pre-warm options cache for all F&O stocks")
async def screener_warm_options(request: Request, user=None):
    import time as _time
    t0 = _time.time()
    if not redis_client:
        return {"error": "Redis not available"}
    results = await sb_build_options_cache()
    elapsed = round(_time.time() - t0, 1)
    return {"status": "ok", "options_cached": len(results), "elapsed_s": elapsed, "symbols": list(results.keys())}


@app.post("/api/screener/scan", tags=["Screen Builder"], summary="Scan stocks/futures/options with custom filters")
async def screener_scan(request: Request, user=None):
    import time as _time
    t0 = _time.time()
    try:
        body = await request.json()
    except:
        return {"error": "Invalid JSON body"}
    asset_type = body.get("asset_type", "stocks")
    filters = body.get("filters", [])
    logic = body.get("logic", "AND").upper()
    sort_by = body.get("sort_by", "alpha_rating")
    sort_order = body.get("sort_order", "desc")
    limit = min(body.get("limit", 50), 200)
    if not filters:
        return {"error": "No filters provided"}
    if asset_type not in SCREENER_PARAMS:
        return {"error": "Unknown asset type"}
    if not redis_client:
        return {"error": "Redis not available"}
    results = []
    scanned = 0

    if asset_type == "stocks":
        FUNDAMENTAL_PIDS = {"pe_ratio", "roe", "dividend_yield", "debt_equity", "market_cap"}
        has_fundamental = any(f.get("pid") in FUNDAMENTAL_PIDS for f in filters)
        if has_fundamental:
            enriched_raw = await redis_client.get("sb_universe_enriched")
            if enriched_raw:
                all_stocks = json.loads(enriched_raw)
            else:
                base = await sb_get_full_universe()
                all_stocks = await sb_enrich_fundamentals([s.copy() for s in base])
                await redis_client.set("sb_universe_enriched", json.dumps(all_stocks), ex=14400)
        else:
            all_stocks = await sb_get_full_universe()
        seen = set()
        unique_stocks = []
        for s in all_stocks:
            sym = s.get("symbol", "")
            if sym and sym not in seen:
                seen.add(sym)
                unique_stocks.append(s)
        scanned = len(unique_stocks)
        for data in unique_stocks:
            try:
                if not data.get("price") and not data.get("symbol"):
                    continue
                if sb_evaluate_filters(data, filters, logic, asset_type):
                    results.append({
                        "symbol": data.get("symbol", ""), "name": data.get("name", ""),
                        "price": data.get("price", 0), "change": data.get("change_pct", 0),
                        "alpha_rating": data.get("alpha_rating", 0),
                        "rsi": data.get("rsi"), "macd_hist": data.get("macd_hist"),
                        "vol_ratio": data.get("vol_ratio"),
                        "pe_ratio": data.get("pe_ratio"), "roe": data.get("roe"),
                        "debt_equity": data.get("debt_equity"), "market_cap": data.get("market_cap"),
                        "sector": data.get("sector", ""), "rs_3m": data.get("rs_3m"),
                        "sma_50": data.get("sma_50"), "sma_200": data.get("sma_200"),
                        "w52_high": data.get("w52_high"), "w52_low": data.get("w52_low"),
                        "bb_width": data.get("bb_width"),
                        "pct_from_52h": data.get("pct_from_52h"),
                        "pct_from_52l": data.get("pct_from_52l"),
                        "momentum_score": data.get("momentum_score"),
                        "fundamental_score": data.get("fundamental_score"),
                        "accumulation_score": data.get("accumulation_score"),
                        "trend_score": data.get("trend_score"),
                        "sentiment_score": data.get("sentiment_score"),
                        "div_yield": data.get("dividend_yield"),
                    })
            except:
                continue

    elif asset_type == "futures":
        keys = await redis_client.keys("futures:*")
        scanned = len(keys)
        for key in keys:
            try:
                raw = await redis_client.get(key)
                if not raw:
                    continue
                data = json.loads(raw)
                key_str = key.decode() if isinstance(key, bytes) else key
                if not data.get("is_fno") and "futures:" not in key_str:
                    continue
                if sb_evaluate_filters(data, filters, logic, asset_type):
                    results.append({
                        "symbol": data.get("symbol", "") + " FUT",
                        "price": data.get("futures_price") or data.get("price", 0),
                        "spot": data.get("spot", 0), "change": data.get("change_pct", 0),
                        "basis": data.get("basis", 0),
                        "basis_annualized": data.get("basis_annualized", 0),
                        "oi": data.get("oi", 0), "oi_change": data.get("oi_change", 0),
                        "oi_buildup": data.get("oi_buildup", ""),
                        "lot_size": data.get("lot_size", 0),
                        "expiry_days": data.get("days_to_expiry", 0),
                        "alpha_rating": data.get("alpha_rating", 0),
                    })
            except:
                continue

    elif asset_type == "options":
        keys = await redis_client.keys("options:*")
        scanned = len(keys)
        for key in keys:
            try:
                raw = await redis_client.get(key)
                if not raw:
                    continue
                data = json.loads(raw)
                if sb_evaluate_filters(data, filters, logic, asset_type):
                    results.append({
                        "symbol": data.get("symbol", ""), "spot": data.get("spot", 0),
                        "atm_strike": data.get("atm_strike", 0),
                        "atm_iv": data.get("atm_iv", 0), "iv": data.get("atm_iv", 0),
                        "iv_skew": data.get("iv_skew", 0), "hv_20": data.get("hv_20", 0),
                        "iv_hv_spread": data.get("iv_hv_spread", 0),
                        "pcr_oi": data.get("pcr_oi", 0), "max_pain": data.get("max_pain", 0),
                        "max_pain_dist": data.get("max_pain_dist", 0),
                        "total_call_oi": data.get("total_call_oi", 0),
                        "total_put_oi": data.get("total_put_oi", 0),
                        "delta": data.get("delta", 0), "theta": data.get("theta", 0),
                        "vega": data.get("vega", 0), "expiry": data.get("expiry", ""),
                        "days_to_expiry": data.get("days_to_expiry", 0),
                        "lot_size": data.get("lot_size", 0), "sector": data.get("sector", ""),
                        "iv_rank": data.get("iv_rank", 0),
                        "iv_percentile": data.get("iv_percentile", 0),
                    })
            except:
                continue

    reverse = sort_order == "desc"
    try:
        results.sort(key=lambda x: x.get(sort_by, 0) or 0, reverse=reverse)
    except:
        pass
    results = results[:limit]
    elapsed = int((_time.time() - t0) * 1000)
    return {
        "results": results, "count": len(results), "scanned": scanned,
        "scan_time_ms": elapsed, "asset_type": asset_type,
        "filters_applied": len(filters), "logic": logic,
    }


@app.post("/api/internal/warm-all", tags=["System"], include_in_schema=False)
async def internal_warm_all(request: Request):
    """Internal-only endpoint to trigger full cache warm. Only accessible from localhost."""
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Internal only")
    results = {}
    try:
        base = await sb_get_full_universe()
        results["sb_universe"] = len(base)
    except Exception as e:
        results["sb_universe"] = f"error: {e}"
    try:
        enriched = await sb_enrich_fundamentals([s.copy() for s in base])
        if redis_client and enriched:
            await redis_client.set("sb_universe_enriched", json.dumps(enriched), ex=14400)
        results["sb_universe_enriched"] = len(enriched)
    except Exception as e:
        results["sb_universe_enriched"] = f"error: {e}"
    warmed = []
    for strat in ["momentum","breakout","relative_strength","golden_cross","oversold","minervini","volume","52w_high","trend_strong","macd_crossover","supertrend_buy","pullback_buy","growth_momentum","top_losers","multi_timeframe","up_on_volume","gap_up","recent_breakout","overbought","safe_haven","bb_squeeze","turnaround","sector_rotation","death_cross","high_beta","range_breakout","52w_low","near_support","macd_bearish","volume_dry","gap_down","dividend_yield","low_pe","high_roe"]:
        try:
            await _run_screener_internal(strat)
            warmed.append(strat)
        except Exception as e:
            results[f"error_{strat}"] = str(e)
    results["strategies_warmed"] = len(warmed)
    return {"status": "ok", "results": results}

@app.post("/api/screener/save", tags=["Screen Builder"], summary="Save a screen")
async def save_screen(request: Request, user=Depends(get_current_user)):
    try:
        body = await request.json()
    except:
        return {"error": "Invalid JSON"}
    name = body.get("name", "").strip()
    if not name:
        return {"error": "Screen name is required"}
    asset_type = body.get("asset_type", "stocks")
    filters = body.get("filters", [])
    logic = body.get("logic", "AND")
    sort_by = body.get("sort_by", "alpha_rating")
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO saved_screens (user_id, name, asset_type, filters, logic, sort_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at",
            user["id"], name, asset_type, json.dumps(filters), logic, sort_by
        )
    return {"id": row["id"], "name": name, "asset_type": asset_type, "filters": filters, "logic": logic, "created_at": str(row["created_at"])}


@app.get("/api/screener/saved", tags=["Screen Builder"], summary="List saved screens")
async def get_saved_screens(request: Request, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, asset_type, filters, logic, sort_by, created_at, updated_at FROM saved_screens WHERE user_id=$1 ORDER BY updated_at DESC",
            user["id"]
        )
    return {"screens": [{"id": r["id"], "name": r["name"], "asset_type": r["asset_type"],
        "filters": json.loads(r["filters"]) if isinstance(r["filters"], str) else r["filters"],
        "logic": r["logic"], "sort_by": r["sort_by"],
        "created_at": str(r["created_at"]), "updated_at": str(r["updated_at"])} for r in rows]}


@app.delete("/api/screener/saved/{screen_id}", tags=["Screen Builder"], summary="Delete a saved screen")
async def delete_saved_screen(screen_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM saved_screens WHERE id=$1 AND user_id=$2", screen_id, user["id"]
        )
    if "DELETE 0" in result:
        return {"error": "Screen not found or not owned by you"}
    return {"deleted": True, "id": screen_id}


# ══ STOCK 360 — Unified Stock Intelligence ═════════════════════════════════
@app.get("/api/stock360/{symbol}", tags=["Stock 360"], summary="Unified stock analysis")
async def stock360(symbol: str, user=Depends(get_current_user)):
    """Stock 360: AlphaView + Alpha Intel + Patterns in one call."""
    sym = symbol.upper()
    results = {"symbol": sym}
    try:
        av = await alphaview(sym, user)
        results["alphaview"] = av
    except Exception as e:
        results["alphaview"] = {"error": str(e)}
    try:
        if "alphaview" in results and "error" not in results.get("alphaview", {}):
            av = results["alphaview"]
            tech = av.get("technicals", {})
            fund = av.get("fundamentals", {})
            ma = av.get("moving_averages", {})
            summ = av.get("summary", {})
            rs = av.get("relative_strength", {})
            ratings = av.get("ratings", {})
            sd = {
                "symbol": sym, "price": summ.get("price", 0),
                "rsi": tech.get("rsi", 50), "macd_hist": tech.get("macd_histogram", 0),
                "macd_cross_up": tech.get("macd", 0) > tech.get("macd_signal", 0),
                "sma_50": ma.get("sma50", 0), "sma_200": ma.get("sma200", 0),
                "above_50dma": ma.get("above_50dma", False), "above_200dma": ma.get("above_200dma", False),
                "above_supertrend": tech.get("supertrend_bullish", False),
                "vol_ratio": tech.get("volume_ratio", 1),
                "pct_from_52h": summ.get("off_high_pct", -10), "pct_from_52l": summ.get("off_low_pct", 10),
                "bb_upper": tech.get("bb_upper", 0), "bb_lower": tech.get("bb_lower", 0),
                "bb_width": tech.get("bb_width", 5), "gap_pct": 0, "close": summ.get("price", 0),
                "pe_ratio": fund.get("pe_trailing", 0), "roe": fund.get("roe", 0),
                "debt_equity": fund.get("debt_equity", 0), "dividend_yield": fund.get("dividend_yield", 0),
                "market_cap": summ.get("market_cap", 0),
                "accumulation_score": ratings.get("accumulation", 0) / 10.0,
                "momentum_score": ratings.get("momentum", 0) / 10.0,
                "fundamental_score": ratings.get("fundamentals", 0) / 10.0,
                "trend_score": ratings.get("trend_rating", 0) / 10.0,
                "sentiment_score": ratings.get("sentiment", 0) / 10.0,
                "minervini_score": 5, "rs_1m": rs.get("rs_1m", 0), "rs_3m": rs.get("rs_3m", 0),
                "wk_change": 0, "change_pct": summ.get("change_pct", 0), "alpha_rating": 0,
            }
            results["alphascore"] = compute_alphascore(sym, sd)
            results["confluence"] = compute_confluence(sym, sd)
            results["smart_money"] = compute_smart_money_score(sym, sd)
    except Exception as e:
        results["alphascore"] = {"error": str(e)}
    try:
        pat = await detect_patterns(sym, user)
        results["patterns"] = pat
    except Exception as e:
        results["patterns"] = {"error": str(e)}
    return results
