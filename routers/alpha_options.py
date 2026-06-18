"""
Alpha Options Engine API Router
Endpoints for volatility regime, signal generation, and trade ideas.
"""
from fastapi import APIRouter, Request, HTTPException, Query
import json, logging, redis as sync_redis
from datetime import date, datetime
import pytz
_IST = pytz.timezone('Asia/Kolkata')

logger = logging.getLogger("alpha_options_api")
router = APIRouter(prefix="/api/alpha-options", tags=["Alpha Options Engine"])

_DATA_ERROR_MSG = "We are experiencing Data Connectivity Issue from the Broker. Please wait and try again. This might take a couple of minutes to a couple of hours to establish connectivity. If the issue persists for over 15 minutes, please drop a WhatsApp message to Admin at +91-9108967788 to get the status. Thank You."
_MARKET_CLOSED_MSG = "Markets are closed. Please try generating signals when markets are open (Mon-Fri 9:15 AM - 3:30 PM IST)."

def _is_market_open():
    now = datetime.now(_IST)
    wd = now.weekday()
    if wd >= 5: return False  # Sat/Sun
    h, m = now.hour, now.minute
    mins = h * 60 + m
    return 555 <= mins <= 930  # 9:15 AM to 3:30 PM

def _get_redis():
    return sync_redis.Redis(host="127.0.0.1", port=6379, db=3, decode_responses=True)

def _get_vix_data():
    """Fetch India VIX from Yahoo."""
    try:
        import yfinance as yf
        vix = yf.Ticker("^INDIAVIX")
        h = vix.history(period="1mo")
        if h.empty:
            return {"vix": 15, "vix_sma20": 15}
        current = float(h["Close"].iloc[-1])
        sma20 = float(h["Close"].rolling(20).mean().iloc[-1]) if len(h) >= 20 else current
        return {"vix": round(current, 2), "vix_sma20": round(sma20, 2)}
    except Exception as e:
        logger.error(f"VIX fetch failed: {e}")
        return {"vix": 15, "vix_sma20": 15}

def _get_nifty_technicals():
    """Fetch Nifty technicals for regime classification."""
    try:
        import yfinance as yf
        import ta
        nifty = yf.Ticker("^NSEI")
        h = nifty.history(period="3mo")
        if h.empty:
            return {"price": 24000, "bb_width": 5, "atr_pct": 1, "trend": "NEUTRAL", "pcr": 1}
        c = h["Close"]
        price = float(c.iloc[-1])
        bb = ta.volatility.BollingerBands(c)
        bb_u = float(bb.bollinger_hband().iloc[-1])
        bb_l = float(bb.bollinger_lband().iloc[-1])
        sma20 = float(c.rolling(20).mean().iloc[-1])
        bb_width = round((bb_u - bb_l) / sma20 * 100, 2) if sma20 > 0 else 5
        atr = ta.volatility.AverageTrueRange(h["High"], h["Low"], c).average_true_range()
        atr_pct = round(float(atr.iloc[-1]) / price * 100, 2) if len(atr.dropna()) > 0 else 1
        sma50 = float(c.rolling(50).mean().iloc[-1]) if len(c) >= 50 else price
        if price > sma20 and sma20 > sma50: trend = "BULLISH"
        elif price < sma20 and sma20 < sma50: trend = "BEARISH"
        else: trend = "NEUTRAL"
        return {"price": round(price, 1), "bb_width": bb_width, "atr_pct": atr_pct, "trend": trend, "pcr": 1.0}
    except Exception as e:
        logger.error(f"Nifty technicals failed: {e}")
        return {"price": 24000, "bb_width": 5, "atr_pct": 1, "trend": "NEUTRAL", "pcr": 1}

def _get_banknifty_price():
    try:
        import yfinance as yf
        h = yf.Ticker("^NSEBANK").history(period="5d")
        return round(float(h["Close"].iloc[-1]), 1) if not h.empty else 51000
    except: return 51000

def _load_alpha_universe():
    """Load F&O stocks from DYOR screener caches with enrichment."""
    # Source 1: short-lived cache
    try:
        rc = _get_redis()
        raw = rc.get("alpha_options_universe")
        if raw:
            data = json.loads(raw)
            if len(data) >= 5:
                rc.close()
                return data
        rc.close()
    except: pass

    from alphascore import compute_alphascore
    from confluence_engine import compute_confluence
    from flow_signals import compute_smart_money_score

    enriched = []
    # Source 2: DYOR screener caches (momentum + trend_strong)
    try:
        rc = sync_redis.Redis(host="127.0.0.1", port=6379, db=1, decode_responses=True)
        all_keys = rc.keys("screener:*")
        seen = set()
        for key in all_keys:
            try:
                raw = rc.get(key)
                if not raw: continue
                data = json.loads(raw)
                stocks = data.get("stocks", data) if isinstance(data, dict) else data
                if not isinstance(stocks, list): continue
                for stk in stocks:
                    sym = stk.get("symbol", "")
                    if not sym or sym in seen: continue
                    if stk.get("price", 0) <= 0: continue
                    seen.add(sym)
                    try:
                        asc = compute_alphascore(sym, stk)
                        conf = compute_confluence(sym, stk)
                        sms = compute_smart_money_score(sym, stk)
                        enriched.append({
                            "symbol": sym, "price": stk.get("price", 0),
                            "change_pct": stk.get("change_pct", stk.get("rs_1m", 0)),
                            "sector": stk.get("sector", ""),
                            "alphascore": asc.get("alphascore", 0),
                            "grade": asc.get("grade", ""),
                            "confluence_probability": conf.get("probability", 0),
                            "smart_money_score": sms.get("smart_money_score", 0),
                        })
                    except: continue
            except: continue
        rc.close()
    except Exception as e:
        logger.error(f"Screener cache load failed: {e}")

    if not enriched:
        logger.warning("No stocks from screener caches")

    # Cache for 10 min
    if enriched:
        try:
            rc2 = _get_redis()
            rc2.set("alpha_options_universe", json.dumps(enriched), ex=600)
            rc2.close()
        except: pass
    return enriched

# ═══════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.get("/regime", summary="Current volatility regime")
async def get_regime():
    """Classify current market into one of 4 volatility regimes with recommended strategies."""
    from alpha_options_engine import classify_regime
    vix_data = _get_vix_data()
    nifty = _get_nifty_technicals()
    regime = classify_regime(
        vix=vix_data["vix"], vix_sma20=vix_data["vix_sma20"],
        bb_width=nifty["bb_width"], atr_pct=nifty["atr_pct"],
        trend=nifty["trend"], pcr=nifty.get("pcr", 1)
    )
    regime["nifty_price"] = nifty["price"]
    return regime

@router.get("/signals", summary="Generate trade signals")
async def get_signals(
    capital: float = Query(500000, description="Total capital to deploy (INR)"),
    max_positions: int = Query(5, description="Max simultaneous positions (1-10)", ge=1, le=10),
    risk_level: str = Query("MEDIUM", description="Risk appetite: LOW, MEDIUM, HIGH"),
):
    """Generate actionable F&O trade ideas."""
    if not _is_market_open():
        return {"date": str(datetime.now(_IST).date()), "market_closed": True,
                "message": _MARKET_CLOSED_MSG, "signal_count": 0, "signals": []}
    from alpha_options_engine import classify_regime, generate_signals, format_signal
    
    vix_data = _get_vix_data()
    nifty = _get_nifty_technicals()
    regime = classify_regime(
        vix=vix_data["vix"], vix_sma20=vix_data["vix_sma20"],
        bb_width=nifty["bb_width"], atr_pct=nifty["atr_pct"],
        trend=nifty["trend"], pcr=nifty.get("pcr", 1)
    )
    
    # Adjust max positions by risk level
    if risk_level == "LOW": max_positions = min(max_positions, 3)
    elif risk_level == "HIGH": max_positions = min(max_positions, 7)
    
    universe = _load_alpha_universe()
    bnf_price = _get_banknifty_price()
    
    signals = generate_signals(
        universe=universe, regime=regime, capital=capital,
        max_positions=max_positions, vix=vix_data["vix"],
        index_prices={"NIFTY": nifty["price"], "BANKNIFTY": bnf_price}
    )
    
    # Format each signal for trader
    formatted = [format_signal(s) for s in signals]
    # Add buy zone to each signal
    for sig in formatted:
        for leg in sig.get("legs", []):
            prem = leg.get("premium", 0)
            if prem and prem > 0:
                leg["buy_zone_low"] = round(prem * 0.9, 2)
                leg["buy_zone_high"] = round(prem * 1.1, 2)
                leg["buy_zone"] = f"Rs.{leg['buy_zone_low']} - Rs.{leg['buy_zone_high']}"
        # Overall signal buy zone
        if sig.get("legs"):
            sig["buy_zone"] = " | ".join([f"{l.get('action','')} {l.get('strike','')} {l.get('type','')}: {l.get('buy_zone','')}" for l in sig["legs"] if l.get("buy_zone")])
            sig["status"] = "ACTIVE"
            sig["signal_time"] = sig.get("generated_at", "")
    
    return {
        "date": datetime.now(_IST).date().isoformat(),
        "regime": regime,
        "capital": capital,
        "risk_level": risk_level,
        "max_positions": max_positions,
        "signal_count": len(formatted),
        "signals": formatted,
        "disclaimer": "These are algorithmic signals, not investment advice. Always do your own research. Past performance does not guarantee future results. Consult a SEBI-registered advisor.",
    }

@router.get("/signal/{symbol}", summary="Generate signal for specific stock")
async def get_stock_signal(
    symbol: str,
    capital: float = Query(100000, description="Capital for this trade (INR)"),
    direction: str = Query("AUTO", description="AUTO, BULLISH, BEARISH, NEUTRAL"),
):
    """Generate F&O trade idea for a specific stock."""
    if not _is_market_open():
        return {"date": str(datetime.now(_IST).date()), "market_closed": True,
                "message": _MARKET_CLOSED_MSG, "signal_count": 0, "signal": None}
    from alpha_options_engine import (classify_regime, bull_call_spread, 
                                       bear_put_spread, iron_condor, format_signal)
    from alphascore import compute_alphascore
    from confluence_engine import compute_confluence
    from flow_signals import compute_smart_money_score
    
    sym = symbol.upper()
    vix_data = _get_vix_data()
    vix = vix_data["vix"]
    
    # Get stock data
    try:
        import yfinance as yf, ta
        t = yf.Ticker(f"{sym}.NS")
        h = t.history(period="1y")
        if h.empty: raise HTTPException(404, f"Stock {sym} not found")
        info = t.info or {}
        c = h["Close"]; price = float(c.iloc[-1])
        rsi_s = ta.momentum.rsi(c, window=14)
        rsi = float(rsi_s.iloc[-1]) if len(rsi_s.dropna()) > 0 else 50
        sma50 = float(c.rolling(50).mean().iloc[-1]) if len(c) >= 50 else price
        sma200 = float(c.rolling(200).mean().iloc[-1]) if len(c) >= 200 else price
        macd = ta.trend.macd(c); macd_sig = ta.trend.macd_signal(c)
        macd_h = float((macd - macd_sig).iloc[-1]) if len(macd.dropna()) > 0 else 0
        vol = h["Volume"]; va = float(vol.rolling(20).mean().iloc[-1]) if len(vol) >= 20 else float(vol.mean())
        vr = round(float(vol.iloc[-1]) / va, 2) if va > 0 else 1
        bb = ta.volatility.BollingerBands(c)
        bb_u = float(bb.bollinger_hband().iloc[-1]); bb_l = float(bb.bollinger_lband().iloc[-1])
        sma20 = float(c.rolling(20).mean().iloc[-1]) if len(c) >= 20 else price
        h52 = float(h["High"].max()); l52 = float(h["Low"].min())
        sd = {
            "symbol": sym, "price": price, "change_pct": 0,
            "rsi": round(rsi, 1), "macd_hist": round(macd_h, 2), "macd_cross_up": macd_h > 0,
            "sma_50": round(sma50, 2), "sma_200": round(sma200, 2),
            "above_50dma": price > sma50, "above_200dma": price > sma200,
            "above_supertrend": price > sma200, "vol_ratio": vr,
            "pct_from_52h": round((price / h52 - 1) * 100, 1),
            "pct_from_52l": round((price / l52 - 1) * 100, 1),
            "bb_upper": round(bb_u, 2), "bb_lower": round(bb_l, 2),
            "bb_width": round((bb_u - bb_l) / sma20 * 100, 2) if sma20 > 0 else 5,
            "close": price, "pe_ratio": info.get("trailingPE", 0) or 0,
            "roe": (info.get("returnOnEquity", 0) or 0) * 100 if (info.get("returnOnEquity") or 0) < 1 else info.get("returnOnEquity", 0) or 0,
            "debt_equity": info.get("debtToEquity", 0) or 0,
            "dividend_yield": (info.get("dividendYield", 0) or 0) * 100,
            "market_cap": info.get("marketCap", 0) or 0,
            "sector": info.get("sector", ""), "gap_pct": 0,
            "accumulation_score": 5, "momentum_score": 5, "fundamental_score": 5,
            "trend_score": 5, "sentiment_score": 5,
            "minervini_score": sum([price > sma50, price > sma200, sma50 > sma200, rsi > 40, vr > 0.8]),
            "rs_1m": 0, "rs_3m": 0, "wk_change": 0, "alpha_rating": 0,
        }
        asc = compute_alphascore(sym, sd)
        conf = compute_confluence(sym, sd)
        sms = compute_smart_money_score(sym, sd)
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(500, f"Error analyzing {sym}: {str(e)}")
    
    # Determine direction
    if direction == "AUTO":
        if asc["alphascore"] >= 60 and sms["smart_money_score"] >= 50:
            direction = "BULLISH"
        elif asc["alphascore"] < 40 and sms["smart_money_score"] < 40:
            direction = "BEARISH"
        else:
            direction = "NEUTRAL"
    
    if direction == "BULLISH":
        sig = bull_call_spread(sym, price, capital, vix)
    elif direction == "BEARISH":
        sig = bear_put_spread(sym, price, capital, vix)
    else:
        sig = iron_condor(sym, price, capital, vix)
    
    sig["alpha_data"] = {
        "alphascore": round(asc["alphascore"], 1), "grade": asc["grade"],
        "signal": asc["signal"], "dimensions": asc.get("dimensions", {}),
        "confluence": round(conf["probability"], 0), "conviction": conf.get("conviction", ""),
        "active_signals": conf.get("active_signal_count", 0),
        "smart_money": round(sms["smart_money_score"], 0), "verdict": sms.get("verdict", ""),
    }
    sig["auto_direction"] = direction
    sig["trigger_reason"] = f"AlphaScore {asc['alphascore']:.0f} ({asc['grade']}) + Confluence {conf['probability']:.0f}% + Smart Money {sms['smart_money_score']:.0f} ({sms['verdict']})"
    
    return {
        "date": datetime.now(_IST).date().isoformat(),
        "signal": format_signal(sig),
        "disclaimer": "Algorithmic signal, not investment advice. Consult a SEBI-registered advisor.",
    }


# ═══════════════════════════════════════════════════════════════
# SIGNAL TRACKING & PERFORMANCE
# ═══════════════════════════════════════════════════════════════

async def _get_pool():
    """Get DB pool from main module."""
    try:
        import main
        if main.db_pool:
            return main.db_pool
    except Exception as e:
        logger.error(f"DB pool access failed: {e}")
    raise HTTPException(503, "Database not available")

@router.post("/signals/generate-and-save", summary="Generate signals and save to DB")
async def generate_and_save(
    capital: float = Query(500000, description="Capital (INR)"),
    max_positions: int = Query(5, ge=1, le=10),
    risk_level: str = Query("MEDIUM"),
):
    """Generate today's signals and persist them for tracking. Skips if already generated today."""
    try:
        from alpha_options_engine import classify_regime, generate_signals, format_signal
        from signal_tracker import save_signal
    except Exception as e:
        raise HTTPException(500, f"Import error: {str(e)}")

    pool = await _get_pool()

    # Check if already generated today
    async with pool.acquire() as conn:
        existing = await conn.fetchval(
            "SELECT COUNT(*) FROM alpha_options_signals WHERE signal_date=CURRENT_DATE AND status='OPEN'")
    if existing > 0:
        return {"message": f"Already have {existing} open signals for today.",
                "existing": existing}

    vix_data = _get_vix_data()
    nifty = _get_nifty_technicals()
    regime = classify_regime(
        vix=vix_data["vix"], vix_sma20=vix_data["vix_sma20"],
        bb_width=nifty["bb_width"], atr_pct=nifty["atr_pct"],
        trend=nifty["trend"], pcr=nifty.get("pcr", 1)
    )

    if risk_level == "LOW": max_positions = min(max_positions, 3)
    elif risk_level == "HIGH": max_positions = min(max_positions, 7)

    universe = _load_alpha_universe()
    bnf_price = _get_banknifty_price()

    signals = generate_signals(
        universe=universe, regime=regime, capital=capital,
        max_positions=max_positions, vix=vix_data["vix"],
        index_prices={"NIFTY": nifty["price"], "BANKNIFTY": bnf_price}
    )

    saved_ids = []
    for sig in signals[:max_positions]:
        sig["regime_key"] = regime["regime"]
        sig["vix"] = vix_data["vix"]
        try:
            sid = await save_signal(pool, sig)
            saved_ids.append(sid)
        except Exception as e:
            logger.error(f"Failed to save signal {sig.get('symbol')}: {e}")

    formatted = [format_signal(s) for s in signals[:max_positions]]
    return {
        "date": datetime.now(_IST).date().isoformat(),
        "regime": regime,
        "saved_count": len(saved_ids),
        "signal_ids": saved_ids,
        "signals": formatted,
    }

@router.get("/signals/open", summary="View all open signals")
async def view_open_signals():
    """List all currently open (active) signals with estimated P&L."""
    from signal_tracker import get_open_signals, _get_live_price, _estimate_current_pnl

    pool = await _get_pool()
    signals = await get_open_signals(pool)

    results = []
    for sig in signals:
        live = _get_live_price(sig["symbol"])
        pnl, pnl_pct = 0, 0
        current_price = 0
        if live:
            current_price = live["price"]
            pnl, pnl_pct = _estimate_current_pnl(sig, current_price)
        results.append({
            "id": sig["id"],
            "date": str(sig["signal_date"]),
            "symbol": sig["symbol"],
            "strategy": sig.get("strategy_name") or sig["strategy"],
            "direction": sig["direction"],
            "capital": sig["capital_required"],
            "max_profit": sig["max_profit"],
            "max_loss": sig["max_loss"],
            "expiry": str(sig.get("expiry_date", "")),
            "current_price": current_price,
            "estimated_pnl": pnl,
            "estimated_pnl_pct": pnl_pct,
            "days_open": (datetime.now(_IST).date() - sig["signal_date"]).days,
            "trigger": sig.get("trigger_reason", ""),
            "alphascore": sig.get("alphascore", 0),
            "conviction": sig.get("conviction", 0),
        })
    return {"open_count": len(results), "signals": results}

@router.post("/signals/close-expired", summary="Auto-close expired/stopped signals")
async def close_expired_signals():
    """Run auto-close logic: closes signals at expiry, stop loss, or target."""
    from signal_tracker import auto_close_expired
    pool = await _get_pool()
    result = await auto_close_expired(pool)
    return result

@router.get("/performance", summary="Historical performance")
async def get_performance_report(
    days: int = Query(30, description="Look-back period in days", ge=1, le=365),
):
    """
    Complete performance report: win rate, P&L, by strategy, by regime,
    plus recent trade details with evaluations.
    """
    from signal_tracker import get_performance
    pool = await _get_pool()
    return await get_performance(pool, days)

@router.get("/signals/history", summary="All closed signals with evaluations")
async def signal_history(
    limit: int = Query(50, ge=1, le=200),
    symbol: str = Query("", description="Filter by symbol"),
):
    """Full trade history with P&L, market context, and AI evaluation."""
    pool = await _get_pool()
    async with pool.acquire() as conn:
        if symbol:
            rows = await conn.fetch("""
                SELECT * FROM alpha_options_signals
                WHERE status != 'OPEN' AND symbol=$1
                ORDER BY close_date DESC LIMIT $2
            """, symbol.upper(), limit)
        else:
            rows = await conn.fetch("""
                SELECT * FROM alpha_options_signals
                WHERE status != 'OPEN'
                ORDER BY close_date DESC LIMIT $1
            """, limit)

    trades = []
    for r in rows:
        t = dict(r)
        t["signal_date"] = str(t["signal_date"]) if t.get("signal_date") else ""
        t["close_date"] = str(t["close_date"]) if t.get("close_date") else ""
        t["expiry_date"] = str(t["expiry_date"]) if t.get("expiry_date") else ""
        t["created_at"] = str(t["created_at"]) if t.get("created_at") else ""
        t["closed_at"] = str(t["closed_at"]) if t.get("closed_at") else ""
        t["legs"] = json.loads(t["legs"]) if isinstance(t.get("legs"), str) else t.get("legs", [])
        trades.append(t)
    return {"count": len(trades), "trades": trades}

@router.get("/paper-trades/list", summary="List F&O paper trades from Options Alpha")
async def list_fno_paper_trades():
    """Returns all paper trades (manual and auto) from Options Alpha including open and closed signals."""
    from signal_tracker import _get_live_price, _estimate_current_pnl
    pool = await _get_pool()
    async with pool.acquire() as conn:
        # Include both OPEN signals with PAPER_TRADE trigger and all CLOSED signals
        rows = await conn.fetch("""
            SELECT id, signal_date, symbol, strategy, strategy_name, direction,
                   legs, lots, lot_size, capital_required, max_profit, max_loss,
                   entry_price, net_debit_credit, expiry_date, trigger_reason,
                   status, close_price, actual_pnl as pnl, actual_pnl_pct as pnl_pct, close_reason, close_date as closed_at,
                   alphascore, conviction
            FROM alpha_options_signals
            WHERE (trigger_reason LIKE '%%PAPER%%' OR trigger_reason LIKE '%%Manual paper%%' OR status LIKE 'CLOSED%%')
            ORDER BY signal_date DESC, id DESC
            LIMIT 100
        """)
    results = []
    for sig in rows:
        s = dict(sig)
        # For open signals, compute live P&L
        if s["status"] == "OPEN":
            live = _get_live_price(s["symbol"])
            if live:
                pnl, pnl_pct = _estimate_current_pnl(s, live["price"])
                s["live_pnl"] = pnl
                s["live_pnl_pct"] = pnl_pct
                s["current_price"] = live["price"]
            else:
                s["live_pnl"] = 0
                s["live_pnl_pct"] = 0
                s["current_price"] = 0
        # Convert dates and clean up
        s["signal_date"] = str(s["signal_date"])
        if s.get("expiry_date"): s["expiry_date"] = str(s["expiry_date"])
        if s.get("closed_at"): s["closed_at"] = str(s["closed_at"])
        s.pop("legs", None)  # Don't send full legs to reduce payload
        results.append(s)
    return {"count": len(results), "trades": results}

@router.post("/paper-trade", summary="Log a paper trade")
async def log_paper_trade(payload: dict):
    """Save a paper trade from the frontend."""
    pool = await _get_pool()
    from signal_tracker import save_signal
    sig = payload.get("signal", {})
    if not sig.get("symbol"): raise HTTPException(400, "Missing symbol")
    sig["trigger"] = "PAPER_TRADE"
    sig["trigger_reason"] = "Manual paper trade from Options Alpha dashboard"
    try:
        sid = await save_signal(pool, sig)
        return {"saved": True, "id": sid, "symbol": sig["symbol"], "strategy": sig.get("strategy_name","")}
    except Exception as e:
        raise HTTPException(500, f"Save failed: {str(e)}")

@router.get("/notifications", summary="Check for new signals today")
async def check_notifications():
    """Returns new signals generated today for notification display."""
    pool = await _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, symbol, strategy_name, direction, conviction,
                   capital_required, max_profit, trigger_reason
            FROM alpha_options_signals
            WHERE signal_date = CURRENT_DATE AND status = 'OPEN'
            ORDER BY conviction DESC
        """)
    signals = [dict(r) for r in rows]
    return {"date": str(datetime.now(_IST).date()), "count": len(signals), "signals": signals}

@router.get("/info", summary="Engine methodology")
async def engine_info():
    """Explain how the Alpha Options Engine works."""
    return {
        "name": "Alpha Options Engine",
        "version": "1.0",
        "patent": "Pending",
        "pillars": {
            "pillar_1": {
                "name": "Confluence-Triggered Directional",
                "description": "Uses AlphaScore + Confluence Engine + Smart Money Flow to identify high-conviction directional trades. Only enters when ALL three engines agree.",
                "when_bullish": "AlphaScore >= 60 + Confluence >= 60% + Smart Money >= 55 -> Bull Call Spread",
                "when_bearish": "AlphaScore < 40 + Confluence >= 50% bearish + Smart Money < 40 -> Bear Put Spread",
            },
            "pillar_2": {
                "name": "Volatility Regime + Theta Harvesting",
                "description": "Classifies market into 4 regimes using VIX, ATR, Bollinger Bands, trend. Each regime has optimal strategies.",
                "regimes": ["LOW_VOL_TRENDING (sell strangles)", "LOW_VOL_RANGEBOUND (iron condors)", "HIGH_VOL_TRENDING (buy spreads)", "HIGH_VOL_RANGEBOUND (iron butterflies)"],
            },
            "pillar_3": {
                "name": "Event-Driven Alpha (Coming Soon)",
                "description": "Earnings IV crush + Expiry theta acceleration. Identifies stocks with inflated IV before earnings and generates premium-selling signals.",
            },
        },
        "risk_management": {
            "max_2pct": "Maximum 2% of capital per trade",
            "defined_risk": "All strategies use defined risk (spreads, condors) — never naked options",
            "max_positions": "Default 5 simultaneous positions",
            "stop_loss": "Every signal includes specific stop loss rules",
            "no_first_15": "No trades in first/last 15 min of market",
        },
    }
