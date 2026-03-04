"""
DYOR Trading Tools — Jobbing & Scalping Scanners
"""
import os, json, logging, math
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException

from core.trading_config import (FNO_LOT_SIZES, get_lot_size, get_sector,
    calculate_costs, check_position_risk, RISK_RULES, TRADING_WINDOWS, SECTOR_MAP)

logger = logging.getLogger("dyor.trading")
router = APIRouter(prefix="/api/trading", tags=["Trading Tools"])

from routers.arbitrage import (_kite_store, _is_kite_connected, _get_kite_headers,
                                FNO_UNIVERSE, _get_current_month_expiry, _format_kite_expiry)

@router.get("/jobbing/candidates")
async def jobbing_candidates(limit: int = 50):
    if not _is_kite_connected():
        raise HTTPException(401, "Broker not connected")
    import urllib.request
    headers = _get_kite_headers()
    expiry = _get_current_month_expiry()
    expiry_str = _format_kite_expiry(expiry)
    cash_symbols = [f"NSE:{sym}" for sym in FNO_UNIVERSE[:limit]]
    fut_symbols = [f"NFO:{sym}{expiry_str}FUT" for sym in FNO_UNIVERSE[:limit]]
    params = "&".join([f"i={s}" for s in cash_symbols + fut_symbols])
    url = f"https://api.kite.trade/quote/ohlc?{params}"
    try:
        req = urllib.request.Request(url, headers=headers)
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())
        if data.get("status") != "success":
            raise HTTPException(500, "Failed to fetch quotes")
        quotes = data["data"]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Data fetch error: {str(e)}")

    candidates = []
    for sym in FNO_UNIVERSE[:limit]:
        cash = quotes.get(f"NSE:{sym}", {})
        fut = quotes.get(f"NFO:{sym}{expiry_str}FUT", {})
        cash_ltp = cash.get("last_price", 0)
        fut_ltp = fut.get("last_price", 0)
        ohlc = cash.get("ohlc", {})
        cash_high = ohlc.get("high", 0)
        cash_low = ohlc.get("low", 0)
        cash_close = ohlc.get("close", cash_ltp)
        if cash_ltp <= 0 or fut_ltp <= 0:
            continue
        spread = abs(fut_ltp - cash_ltp)
        spread_pct = (spread / cash_ltp) * 100
        day_range = max(cash_high - cash_low, 0.01)
        day_range_pct = (day_range / cash_ltp) * 100
        day_change = ((cash_ltp - cash_close) / cash_close) * 100 if cash_close > 0 else 0
        volatility = day_range_pct
        score = 0
        if spread_pct < 0.05: score += 3
        elif spread_pct < 0.1: score += 2.5
        elif spread_pct < 0.2: score += 1.5
        if cash_ltp > 2000: score += 2
        elif cash_ltp > 500: score += 1.5
        elif cash_ltp > 200: score += 1
        if 0.5 < volatility < 2.0: score += 2.5
        elif 0.3 < volatility < 3.0: score += 1.5
        else: score += 0.5
        if day_range > 10: score += 2
        elif day_range > 5: score += 1
        risk_per_share = cash_ltp * 0.001
        target_per_share = spread * 0.5
        signal = "STRONG" if score >= 7 else "GOOD" if score >= 5 else "FAIR" if score >= 3 else "WEAK"
        lot = get_lot_size(sym)
        sector = get_sector(sym)
        margin = cash_ltp * lot * 0.20  # Intraday margin
        costs = calculate_costs(cash_ltp, lot, "intraday")
        target_profit = (cash_ltp * 0.0005) * lot  # 0.05% target
        breakeven_moves = costs["total"] / lot if lot > 0 else 0  # Price move needed to breakeven

        # Enhanced scoring with lot-adjusted metrics
        if costs["total"] < target_profit * 0.5: score += 0.5  # Low cost bonus

        candidates.append({
            "symbol": sym, "spot": round(cash_ltp, 2), "futures": round(fut_ltp, 2),
            "spread": round(spread, 2), "spread_pct": round(spread_pct, 4),
            "day_high": round(cash_high, 2), "day_low": round(cash_low, 2),
            "day_range": round(day_range, 2), "day_range_pct": round(day_range_pct, 2),
            "day_change": round(day_change, 2), "volatility": round(volatility, 2),
            "risk_per_share": round(risk_per_share, 2),
            "target_per_share": round(target_per_share, 2),
            "rr_ratio": round(target_per_share / risk_per_share, 2) if risk_per_share > 0 else 0,
            "score": round(min(score, 10), 1), "signal": signal,
            "lot_size": lot, "sector": sector,
            "margin": round(margin, 0),
            "cost_per_trade": costs["total"],
            "target_profit_lot": round(target_profit, 2),
            "breakeven_move": round(breakeven_moves, 2),
            "best_window": "09:15-10:00" if datetime.now().hour < 12 else "14:30-15:15",
        })
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return {"candidates": candidates, "count": len(candidates),
            "timestamp": datetime.now().isoformat(),
            "market_status": "OPEN" if 9 <= datetime.now().hour < 16 else "CLOSED"}

@router.get("/jobbing/calculator")
async def jobbing_calc(price: float = 0, qty: int = 1, target_pct: float = 0.05,
                       stop_pct: float = 0.1, trades_per_day: int = 20):
    if price <= 0:
        raise HTTPException(400, "Price must be > 0")
    target_amt = price * (target_pct / 100) * qty
    stop_amt = price * (stop_pct / 100) * qty
    turnover = price * qty * 2
    brokerage = min(turnover * 0.0003, 40)
    stt = turnover * 0.000125
    exchange = turnover * 0.0000345
    gst = (brokerage + exchange) * 0.18
    stamp = price * qty * 0.00003
    sebi = turnover * 0.000001
    total_cost = brokerage + stt + exchange + gst + stamp + sebi
    net_profit_win = target_amt - total_cost
    net_loss_lose = stop_amt + total_cost
    win_rate = 0.6
    daily_wins = trades_per_day * win_rate
    daily_losses = trades_per_day * (1 - win_rate)
    daily_gross = (daily_wins * target_amt) - (daily_losses * stop_amt)
    daily_costs = trades_per_day * total_cost
    daily_net = daily_gross - daily_costs
    return {
        "per_trade": {"target_profit": round(target_amt, 2), "stop_loss": round(stop_amt, 2),
                      "total_cost": round(total_cost, 2), "net_profit_win": round(net_profit_win, 2),
                      "net_loss_lose": round(net_loss_lose, 2), "rr_ratio": round(target_amt / stop_amt, 2) if stop_amt > 0 else 0},
        "cost_breakup": {"brokerage": round(brokerage, 2), "stt": round(stt, 2),
                         "exchange": round(exchange, 2), "gst": round(gst, 2)},
        "daily_projection": {"trades": trades_per_day, "win_rate": f"{win_rate*100:.0f}%",
                             "gross_pnl": round(daily_gross, 2), "total_costs": round(daily_costs, 2),
                             "net_pnl": round(daily_net, 2), "capital_required": round(price * qty * 0.2, 2)},
        "monthly_projection": round(daily_net * 22, 2)}

@router.get("/scalping/candidates")
async def scalping_candidates(limit: int = 50):
    if not _is_kite_connected():
        raise HTTPException(401, "Broker not connected")
    import urllib.request
    headers = _get_kite_headers()
    expiry = _get_current_month_expiry()
    expiry_str = _format_kite_expiry(expiry)
    cash_symbols = [f"NSE:{sym}" for sym in FNO_UNIVERSE[:limit]]
    fut_symbols = [f"NFO:{sym}{expiry_str}FUT" for sym in FNO_UNIVERSE[:limit]]
    params = "&".join([f"i={s}" for s in cash_symbols + fut_symbols])
    url = f"https://api.kite.trade/quote/ohlc?{params}"
    try:
        req = urllib.request.Request(url, headers=headers)
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())
        if data.get("status") != "success":
            raise HTTPException(500, "Failed to fetch quotes")
        quotes = data["data"]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Data fetch error: {str(e)}")

    candidates = []
    for sym in FNO_UNIVERSE[:limit]:
        cash = quotes.get(f"NSE:{sym}", {})
        fut = quotes.get(f"NFO:{sym}{expiry_str}FUT", {})
        cash_ltp = cash.get("last_price", 0)
        fut_ltp = fut.get("last_price", 0)
        ohlc = cash.get("ohlc", {})
        cash_open = ohlc.get("open", 0)
        cash_high = ohlc.get("high", 0)
        cash_low = ohlc.get("low", 0)
        cash_close = ohlc.get("close", cash_ltp)
        if cash_ltp <= 0 or cash_open <= 0:
            continue
        day_change = ((cash_ltp - cash_close) / cash_close) * 100 if cash_close > 0 else 0
        day_range = max(cash_high - cash_low, 0.01)
        day_range_pct = (day_range / cash_ltp) * 100
        vwap_approx = (cash_high + cash_low + cash_close) / 3
        vwap_dev = ((cash_ltp - vwap_approx) / vwap_approx) * 100 if vwap_approx > 0 else 0
        basis = fut_ltp - cash_ltp if fut_ltp > 0 else 0
        basis_pct = (basis / cash_ltp) * 100 if cash_ltp > 0 else 0
        if day_change > 0.5 and vwap_dev > 0: direction = "BULLISH"
        elif day_change < -0.5 and vwap_dev < 0: direction = "BEARISH"
        else: direction = "NEUTRAL"
        range_used = ((cash_ltp - cash_low) / day_range) * 100 if day_range > 0 else 50
        if range_used > 80: pattern = "NEAR HIGH"
        elif range_used < 20: pattern = "NEAR LOW"
        elif 40 < range_used < 60: pattern = "MID RANGE"
        elif range_used > 60: pattern = "UPPER HALF"
        else: pattern = "LOWER HALF"
        score = 0
        if abs(day_change) > 2: score += 3
        elif abs(day_change) > 1: score += 2
        elif abs(day_change) > 0.5: score += 1
        if day_range_pct > 2: score += 2.5
        elif day_range_pct > 1: score += 1.5
        elif day_range_pct > 0.5: score += 1
        if abs(vwap_dev) > 1: score += 2
        elif abs(vwap_dev) > 0.5: score += 1
        if (basis_pct > 0.1 and day_change > 0) or (basis_pct < -0.1 and day_change < 0): score += 1.5
        if cash_ltp > 1000: score += 1
        elif cash_ltp > 500: score += 0.5
        signal = "STRONG" if score >= 7 else "GOOD" if score >= 5 else "FAIR" if score >= 3 else "WEAK"
        if direction == "BULLISH":
            entry, target, stop = cash_ltp, round(cash_ltp * 1.005, 2), round(cash_ltp * 0.997, 2)
        elif direction == "BEARISH":
            entry, target, stop = cash_ltp, round(cash_ltp * 0.995, 2), round(cash_ltp * 1.003, 2)
        else:
            entry, target, stop = cash_ltp, round(cash_ltp * 1.003, 2), round(cash_ltp * 0.998, 2)
        lot = get_lot_size(sym)
        sector = get_sector(sym)
        margin = cash_ltp * lot * 0.20
        costs = calculate_costs(cash_ltp, lot, "intraday")
        potential_profit = abs(target - entry) * lot
        potential_loss = abs(stop - entry) * lot
        net_profit = potential_profit - costs["total"]
        net_loss = potential_loss + costs["total"]

        # Support/Resistance approximation
        pivot = (cash_high + cash_low + cash_close) / 3
        r1 = 2 * pivot - cash_low
        s1 = 2 * pivot - cash_high
        r2 = pivot + (cash_high - cash_low)
        s2 = pivot - (cash_high - cash_low)

        candidates.append({
            "symbol": sym, "spot": round(cash_ltp, 2), "futures": round(fut_ltp, 2),
            "open": round(cash_open, 2), "high": round(cash_high, 2), "low": round(cash_low, 2),
            "day_change": round(day_change, 2), "day_range_pct": round(day_range_pct, 2),
            "vwap_dev": round(vwap_dev, 2), "basis_pct": round(basis_pct, 3),
            "direction": direction, "pattern": pattern,
            "score": round(min(score, 10), 1), "signal": signal,
            "entry": round(entry, 2), "target": target, "stop": stop,
            "reward_risk": round(abs(target - entry) / abs(stop - entry), 2) if abs(stop - entry) > 0 else 0,
            "lot_size": lot, "sector": sector,
            "margin": round(margin, 0),
            "cost_per_trade": costs["total"],
            "net_profit_lot": round(net_profit, 2),
            "net_loss_lot": round(net_loss, 2),
            "pivot": round(pivot, 2),
            "r1": round(r1, 2), "s1": round(s1, 2),
            "r2": round(r2, 2), "s2": round(s2, 2),
        })
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return {"candidates": candidates, "count": len(candidates),
            "timestamp": datetime.now().isoformat(),
            "market_status": "OPEN" if 9 <= datetime.now().hour < 16 else "CLOSED"}

@router.get("/scalping/calculator")
async def scalping_calc(price: float = 0, qty: int = 1, target_pct: float = 0.5,
                        stop_pct: float = 0.3, trades_per_day: int = 8):
    if price <= 0:
        raise HTTPException(400, "Price must be > 0")
    target_amt = price * (target_pct / 100) * qty
    stop_amt = price * (stop_pct / 100) * qty
    turnover = price * qty * 2
    brokerage = min(turnover * 0.0003, 40)
    stt = turnover * 0.000125
    exchange = turnover * 0.0000345
    gst = (brokerage + exchange) * 0.18
    stamp = price * qty * 0.00003
    sebi = turnover * 0.000001
    total_cost = brokerage + stt + exchange + gst + stamp + sebi
    net_win = target_amt - total_cost
    net_lose = stop_amt + total_cost
    win_rate = 0.55
    daily_wins = trades_per_day * win_rate
    daily_losses = trades_per_day * (1 - win_rate)
    daily_gross = (daily_wins * target_amt) - (daily_losses * stop_amt)
    daily_costs = trades_per_day * total_cost
    daily_net = daily_gross - daily_costs
    return {
        "per_trade": {"target": round(target_amt, 2), "stop_loss": round(stop_amt, 2),
                      "cost": round(total_cost, 2), "net_win": round(net_win, 2),
                      "net_lose": round(net_lose, 2), "rr_ratio": round(target_pct / stop_pct, 2)},
        "costs": {"brokerage": round(brokerage, 2), "stt": round(stt, 2),
                  "exchange": round(exchange, 2), "gst": round(gst, 2)},
        "daily": {"trades": trades_per_day, "win_rate": f"{win_rate*100:.0f}%",
                  "gross": round(daily_gross, 2), "costs": round(daily_costs, 2),
                  "net": round(daily_net, 2), "capital": round(price * qty * 0.2, 2)},
        "monthly": round(daily_net * 22, 2)}


@router.get("/risk-check")
async def risk_check(symbol: str, price: float, qty: int = 0, capital: float = 500000):
    """Check if a trade passes risk management rules"""
    lot = get_lot_size(symbol)
    if qty == 0:
        qty = lot
    result = check_position_risk(symbol, price, qty, capital)
    costs = calculate_costs(price, qty, "intraday")
    return {
        "symbol": symbol,
        "lot_size": lot,
        "qty": qty,
        "trade_value": round(price * qty, 2),
        "margin_required": round(price * qty * 0.20, 2),
        "costs": costs,
        "risk_check": result,
        "rules": RISK_RULES,
    }

@router.get("/trading-windows")
async def trading_windows():
    """Get current trading window status"""
    now = datetime.now()
    current_time = now.strftime("%H:%M")
    hour = now.hour
    minute = now.minute

    windows = TRADING_WINDOWS.copy()
    active_window = "CLOSED"
    if 9 <= hour < 16:
        if hour == 9 and minute < 15:
            active_window = "PRE-OPEN"
        elif (hour == 9 and minute >= 15) or (hour == 10 and minute == 0):
            active_window = "OPENING_VOLATILITY"
        elif 10 < hour < 12:
            active_window = "MORNING_SESSION"
        elif 12 <= hour < 14:
            active_window = "LUNCH_LULL"
        elif 14 <= hour < 15:
            active_window = "AFTERNOON_MOMENTUM"
        elif hour == 15 and minute < 15:
            active_window = "CLOSING_VOLATILITY"
        elif hour == 15:
            active_window = "CLOSING"

    is_expiry = now.weekday() == 3  # Thursday
    return {
        "current_time": current_time,
        "market_status": "OPEN" if 9 <= hour < 16 else "CLOSED",
        "active_window": active_window,
        "is_expiry_day": is_expiry,
        "reduce_size": is_expiry,
        "jobbing_optimal": active_window in ["OPENING_VOLATILITY", "CLOSING_VOLATILITY"],
        "scalping_optimal": active_window in ["OPENING_VOLATILITY", "MORNING_SESSION", "AFTERNOON_MOMENTUM"],
        "avoid_trading": active_window == "LUNCH_LULL",
        "windows": windows,
    }
