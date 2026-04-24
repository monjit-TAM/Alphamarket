"""
Signal Tracker — Saves, monitors, and auto-closes Alpha Options signals.
Records P&L, market context, and generates evaluation narratives.
"""
import json, logging, asyncio
from datetime import datetime, date, timedelta
import pytz

logger = logging.getLogger("signal_tracker")
IST = pytz.timezone("Asia/Kolkata")

async def save_signal(pool, signal: dict):
    """Persist a new signal to PostgreSQL."""
    alpha = signal.get("alpha_data", {})
    total = signal.get("total", {})
    pl = signal.get("per_lot", {})
    ml = total.get("max_loss", 0)
    if not isinstance(ml, (int, float)): ml = 0
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO alpha_options_signals
            (signal_date, symbol, strategy, strategy_name, direction,
             trigger_type, trigger_reason, legs, lot_size, lots,
             entry_price, net_debit_credit, capital_required,
             max_profit, max_loss, breakeven, risk_reward,
             probability_of_profit, alphascore, grade, confluence,
             smart_money, regime, vix_at_entry, status,
             expiry_date, conviction, risk_level)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'OPEN',$25,$26,$27)
            RETURNING id
        """,
            datetime.now(IST).date(),
            signal.get("symbol", ""),
            signal.get("strategy", ""),
            signal.get("strategy_name", ""),
            signal.get("direction", ""),
            signal.get("trigger", ""),
            signal.get("trigger_reason", ""),
            json.dumps(signal.get("legs", [])),
            signal.get("lot_size", 0),
            signal.get("lots", 0),
            signal.get("legs", [{}])[0].get("strike", 0) if signal.get("legs") else 0,
            signal.get("net_debit", signal.get("net_credit", 0)),
            total.get("capital_required", 0),
            total.get("max_profit", 0),
            float(ml),
            pl.get("breakeven", pl.get("upper_breakeven", 0)),
            signal.get("risk_reward", 0),
            signal.get("probability_of_profit", 0),
            alpha.get("alphascore", 0),
            alpha.get("grade", ""),
            alpha.get("confluence", 0),
            alpha.get("smart_money", 0),
            signal.get("regime_key", ""),
            signal.get("vix", 0),
            date.fromisoformat(signal["expiry"]) if signal.get("expiry") else datetime.now(IST).date() + timedelta(days=7),
            signal.get("conviction", 0),
            signal.get("risk_level", ""),
        )
        return row["id"]

async def get_open_signals(pool):
    """Get all open signals."""
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM alpha_options_signals WHERE status='OPEN' ORDER BY signal_date DESC")
        return [dict(r) for r in rows]

async def close_signal(pool, signal_id: int, close_data: dict):
    """Close a signal with P&L and evaluation."""
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE alpha_options_signals SET
                status=$2, close_date=$3, close_price=$4,
                actual_pnl=$5, actual_pnl_pct=$6, close_reason=$7,
                nifty_close=$8, nifty_change_pct=$9, vix_at_close=$10,
                market_sentiment=$11, evaluation=$12,
                days_held=$13, closed_at=NOW()
            WHERE id=$1
        """,
            signal_id,
            close_data.get("status", "CLOSED_EXPIRY"),
            datetime.now(IST).date(),
            close_data.get("close_price", 0),
            close_data.get("pnl", 0),
            close_data.get("pnl_pct", 0),
            close_data.get("close_reason", ""),
            close_data.get("nifty_close", 0),
            close_data.get("nifty_change_pct", 0),
            close_data.get("vix", 0),
            close_data.get("market_sentiment", "FLAT"),
            close_data.get("evaluation", ""),
            close_data.get("days_held", 0),
        )

def _get_live_price(symbol):
    """Get current price from Yahoo."""
    try:
        import yfinance as yf
        sym = symbol.upper()
        idx_map = {"NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK", "FINNIFTY": "^CNXFIN"}
        yf_sym = idx_map.get(sym, f"{sym}.NS")
        t = yf.Ticker(yf_sym)
        h = t.history(period="2d")
        if h.empty: return None
        price = float(h["Close"].iloc[-1])
        prev = float(h["Close"].iloc[-2]) if len(h) > 1 else price
        chg_pct = round((price - prev) / prev * 100, 2) if prev else 0
        return {"price": price, "change_pct": chg_pct}
    except:
        return None

def _get_market_context():
    """Get Nifty close, VIX, and sentiment for today."""
    try:
        import yfinance as yf
        nifty = yf.Ticker("^NSEI").history(period="2d")
        vix_h = yf.Ticker("^INDIAVIX").history(period="2d")
        n_close = float(nifty["Close"].iloc[-1]) if not nifty.empty else 0
        n_prev = float(nifty["Close"].iloc[-2]) if len(nifty) > 1 else n_close
        n_chg = round((n_close - n_prev) / n_prev * 100, 2) if n_prev else 0
        vix_val = float(vix_h["Close"].iloc[-1]) if not vix_h.empty else 15
        if n_chg > 0.3: sentiment = "GREEN"
        elif n_chg < -0.3: sentiment = "RED"
        else: sentiment = "FLAT"
        return {"nifty_close": round(n_close, 1), "nifty_change_pct": n_chg,
                "vix": round(vix_val, 1), "market_sentiment": sentiment}
    except:
        return {"nifty_close": 0, "nifty_change_pct": 0, "vix": 15, "market_sentiment": "FLAT"}

def _estimate_current_pnl(signal_row, live_price):
    """Estimate current P&L for an open signal based on price move."""
    strategy = signal_row["strategy"]
    legs = json.loads(signal_row["legs"]) if isinstance(signal_row["legs"], str) else signal_row["legs"]
    lots = signal_row["lots"] or 1
    lot_size = signal_row["lot_size"] or 50
    cap = signal_row["capital_required"] or 1
    max_profit = signal_row["max_profit"] or 0
    max_loss = signal_row["max_loss"] or 0
    entry_strike = signal_row["entry_price"] or 0
    spot = live_price

    if strategy in ("CE_BUY", "PE_BUY"):
        # Single leg: P&L = (current_premium - entry_premium) * lots * lot_size
        # Approximate via price move
        entry_strike = legs[0]["strike"] if legs else entry_strike
        entry_prem = signal_row["net_debit_credit"] or 0
        if strategy == "CE_BUY":
            intrinsic = max(0, spot - entry_strike)
            current_est = max(intrinsic, entry_prem * 0.3)  # minimum time value
            pnl = (current_est - entry_prem) * lot_size * lots
        else:
            intrinsic = max(0, entry_strike - spot)
            current_est = max(intrinsic, entry_prem * 0.3)
            pnl = (current_est - entry_prem) * lot_size * lots
        # Cap at target/SL
        target = max_profit  # 50% of premium
        sl = -abs(max_loss)  # full premium
        pnl = max(pnl, sl)
        pnl_pct = round(pnl / cap * 100, 2) if cap > 0 else 0
        return round(pnl, 0), pnl_pct
    elif strategy == "BULL_CALL_SPREAD":
        buy_k = legs[0]["strike"] if legs else entry_strike
        sell_k = legs[1]["strike"] if len(legs) > 1 else buy_k + 100
        net_debit = signal_row["net_debit_credit"] or 0
        if spot >= sell_k:
            pnl = max_profit
        elif spot <= buy_k:
            pnl = -abs(max_loss)
        else:
            intrinsic = (spot - buy_k) * lot_size * lots
            pnl = intrinsic - (net_debit * lot_size * lots)
    elif strategy == "BEAR_PUT_SPREAD":
        buy_k = legs[0]["strike"] if legs else entry_strike
        sell_k = legs[1]["strike"] if len(legs) > 1 else buy_k - 100
        net_debit = signal_row["net_debit_credit"] or 0
        if spot <= sell_k:
            pnl = max_profit
        elif spot >= buy_k:
            pnl = -abs(max_loss)
        else:
            intrinsic = (buy_k - spot) * lot_size * lots
            pnl = intrinsic - (net_debit * lot_size * lots)
    elif strategy in ("IRON_CONDOR", "SHORT_STRANGLE"):
        sell_pe = 0; sell_ce = 0
        for l in legs:
            if l.get("action") == "SELL" and l.get("type") == "PE": sell_pe = l["strike"]
            if l.get("action") == "SELL" and l.get("type") == "CE": sell_ce = l["strike"]
        credit = signal_row["net_debit_credit"] or 0
        if sell_pe <= spot <= sell_ce:
            pnl = max_profit  # In profit zone
        elif spot < sell_pe:
            breach = (sell_pe - spot) * lot_size * lots
            pnl = max_profit - breach
        else:
            breach = (spot - sell_ce) * lot_size * lots
            pnl = max_profit - breach
        pnl = max(pnl, -abs(max_loss)) if max_loss else pnl
    elif strategy == "EXPIRY_THETA_SCALP":
        # Short strangle on expiry day - profit if spot stays between strikes
        sell_pe = 0; sell_ce = 0
        for l in legs:
            if l.get("action") == "SELL" and l.get("type") == "PE": sell_pe = l["strike"]
            if l.get("action") == "SELL" and l.get("type") == "CE": sell_ce = l["strike"]
        credit = signal_row["net_debit_credit"] or 0
        if sell_pe and sell_ce and sell_pe <= spot <= sell_ce:
            # In profit zone - theta decay accruing. On expiry day, assume ~50% captured during market hours
            expiry = signal_row.get("expiry_date") or signal_row["signal_date"]
            days_to_expiry = max(0, (expiry - datetime.now(IST).date()).days)
            total_days = max(1, (expiry - signal_row["signal_date"]).days)
            if days_to_expiry == 0:
                # Expiry day - use time-of-day proxy: more theta captured as day progresses
                hour = datetime.now(IST).hour
                theta_factor = min(0.9, max(0.3, (hour - 9) / 6.5))  # 9:15 AM start, 3:30 PM end
            else:
                theta_factor = min(0.9, (total_days - days_to_expiry) / total_days)
            pnl = max_profit * theta_factor
        elif sell_pe and spot < sell_pe:
            breach = (sell_pe - spot) * lot_size * lots
            pnl = max_profit - breach
        elif sell_ce and spot > sell_ce:
            breach = (spot - sell_ce) * lot_size * lots
            pnl = max_profit - breach
        else:
            pnl = 0
        pnl = max(pnl, -abs(max_loss)) if max_loss else pnl
    elif strategy == "EARNINGS_IV_CRUSH":
        # Short straddle/strangle near earnings - profits from IV collapse
        credit = signal_row["net_debit_credit"] or 0
        if entry_strike:
            move_pct = abs(spot - entry_strike) / entry_strike * 100 if entry_strike else 0
            if move_pct < 2:
                pnl = max_profit * 0.6  # Good IV crush, modest price move
            elif move_pct < 4:
                pnl = max_profit * 0.2
            else:
                breach = (move_pct - 4) / 100 * entry_strike * lot_size * lots
                pnl = -min(abs(max_loss), breach)
        else:
            pnl = 0
        pnl = max(pnl, -abs(max_loss)) if max_loss else pnl
    else:
        pnl = 0

    pnl_pct = round(pnl / cap * 100, 2) if cap > 0 else 0
    return round(pnl, 0), pnl_pct

def _generate_evaluation(signal_row, pnl, pnl_pct, mkt):
    """Generate plain English evaluation of why trade worked or failed."""
    sym = signal_row["symbol"]
    strategy = signal_row["strategy_name"] or signal_row["strategy"]
    direction = signal_row["direction"]
    sentiment = mkt.get("market_sentiment", "FLAT")
    n_chg = mkt.get("nifty_change_pct", 0)
    days = signal_row.get("days_held") or (datetime.now(IST).date() - signal_row["signal_date"]).days

    won = pnl > 0
    result = "PROFIT" if won else "LOSS"

    parts = [f"{sym} {strategy} ({direction}) closed in {result} after {days} day(s)."]

    if won:
        parts.append(f"The trade earned Rs.{abs(pnl):,.0f} ({abs(pnl_pct):.1f}% return on capital).")
        if direction == "BULLISH" and sentiment == "GREEN":
            parts.append(f"Market was supportive — Nifty closed {n_chg:+.1f}% green, which helped the bullish bias.")
        elif direction == "NEUTRAL":
            parts.append(f"As expected, {sym} stayed within the profit zone. Theta decay worked in our favor.")
        elif direction == "BEARISH" and sentiment == "RED":
            parts.append(f"Market weakness confirmed the bearish thesis — Nifty was {n_chg:+.1f}% red.")
        else:
            parts.append("Stock-specific factors drove the outcome despite market conditions.")
    else:
        parts.append(f"The trade lost Rs.{abs(pnl):,.0f} ({abs(pnl_pct):.1f}% of capital).")
        if direction == "BULLISH" and sentiment == "RED":
            parts.append(f"Broad market selloff (Nifty {n_chg:+.1f}%) dragged the stock down against our bullish position.")
        elif direction == "NEUTRAL" and abs(n_chg) > 1.5:
            parts.append(f"Market moved sharply ({n_chg:+.1f}%), breaking outside the profit zone. Vol spike was the primary risk.")
        elif direction == "BEARISH" and sentiment == "GREEN":
            parts.append(f"Market rallied (Nifty {n_chg:+.1f}%) against our bearish position.")
        else:
            parts.append("Stock-specific movement or volatility changes drove the adverse outcome.")

    vix_entry = signal_row.get("vix_at_entry", 0)
    vix_close = mkt.get("vix", 0)
    if vix_entry and vix_close:
        vix_chg = vix_close - vix_entry
        if abs(vix_chg) > 2:
            parts.append(f"VIX moved from {vix_entry:.1f} to {vix_close:.1f} ({'up' if vix_chg > 0 else 'down'} {abs(vix_chg):.1f} points) — {'hurt' if (vix_chg > 0 and direction == 'NEUTRAL') else 'helped'} the position.")

    alphascore = signal_row.get("alphascore", 0)
    if alphascore:
        if won and alphascore >= 60:
            parts.append(f"AlphaScore of {alphascore:.0f} correctly identified this as a strong setup.")
        elif not won and alphascore >= 60:
            parts.append(f"Despite a decent AlphaScore ({alphascore:.0f}), external factors overrode the signal.")

    return " ".join(parts)

async def auto_close_expired(pool):
    """Close all signals that have hit expiry. Called daily at 3:30 PM IST."""
    open_sigs = await get_open_signals(pool)
    mkt = _get_market_context()
    closed_count = 0

    for sig in open_sigs:
        exp = sig.get("expiry_date")
        if not exp: continue
        if isinstance(exp, str): exp = date.fromisoformat(exp)

        should_close = False
        close_reason = ""

        # Past expiry
        if datetime.now(IST).date() >= exp:
            should_close = True
            close_reason = "Expiry reached"
        # Check stop loss (if price moved too much)
        live = _get_live_price(sig["symbol"])
        if live:
            pnl, pnl_pct = _estimate_current_pnl(sig, live["price"])
            max_loss = sig["max_loss"] or 0
            # Auto-stop: if loss exceeds 1.5x max loss, close
            if max_loss and pnl < 0 and abs(pnl) > abs(max_loss) * 1.5:
                should_close = True
                close_reason = "Stop loss triggered (loss exceeded 1.5x max)"
            # Auto-target: if profit hits 60% of max profit
            max_p = sig["max_profit"] or 0
            if max_p and pnl > 0 and pnl >= max_p * 0.6:
                should_close = True
                close_reason = "Target reached (60% of max profit)"

        if not should_close:
            continue

        # Close it
        if not live:
            live = {"price": 0, "change_pct": 0}
        pnl, pnl_pct = _estimate_current_pnl(sig, live["price"])
        days_held = (datetime.now(IST).date() - sig["signal_date"]).days

        status = "CLOSED_PROFIT" if pnl > 0 else "CLOSED_LOSS"
        if "stop loss" in close_reason.lower(): status = "CLOSED_SL"
        elif "target" in close_reason.lower(): status = "CLOSED_TARGET"
        elif "expiry" in close_reason.lower(): status = "CLOSED_EXPIRY"

        evaluation = _generate_evaluation(sig, pnl, pnl_pct, mkt)

        await close_signal(pool, sig["id"], {
            "status": status,
            "close_price": live["price"],
            "pnl": pnl,
            "pnl_pct": pnl_pct,
            "close_reason": close_reason,
            "nifty_close": mkt.get("nifty_close", 0),
            "nifty_change_pct": mkt.get("nifty_change_pct", 0),
            "vix": mkt.get("vix", 0),
            "market_sentiment": mkt.get("market_sentiment", "FLAT"),
            "evaluation": evaluation,
            "days_held": days_held,
        })
        closed_count += 1
        logger.info(f"Closed signal #{sig['id']} {sig['symbol']} {sig['strategy']}: {status} PnL={pnl:+,.0f}")

    return {"closed": closed_count, "remaining_open": len(open_sigs) - closed_count}

async def get_performance(pool, days: int = 30):
    """Get historical performance summary."""
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM alpha_options_signals
            WHERE status != 'OPEN' AND close_date >= CURRENT_DATE - $1::int
            ORDER BY close_date DESC
        """, days)

    if not rows:
        return {"period_days": days, "total_trades": 0, "message": "No closed trades yet"}

    trades = [dict(r) for r in rows]
    winners = [t for t in trades if (t.get("actual_pnl") or 0) > 0]
    losers = [t for t in trades if (t.get("actual_pnl") or 0) <= 0]

    total_pnl = sum(t.get("actual_pnl", 0) or 0 for t in trades)
    avg_win = sum(t.get("actual_pnl", 0) or 0 for t in winners) / len(winners) if winners else 0
    avg_loss = sum(t.get("actual_pnl", 0) or 0 for t in losers) / len(losers) if losers else 0
    win_rate = len(winners) / len(trades) * 100 if trades else 0
    payoff = abs(avg_win / avg_loss) if avg_loss else 0

    by_strategy = {}
    for t in trades:
        s = t.get("strategy_name") or t.get("strategy", "Unknown")
        if s not in by_strategy:
            by_strategy[s] = {"count": 0, "wins": 0, "total_pnl": 0}
        by_strategy[s]["count"] += 1
        if (t.get("actual_pnl") or 0) > 0: by_strategy[s]["wins"] += 1
        by_strategy[s]["total_pnl"] += t.get("actual_pnl", 0) or 0
    for k, v in by_strategy.items():
        v["win_rate"] = round(v["wins"] / v["count"] * 100, 1) if v["count"] else 0
        v["total_pnl"] = round(v["total_pnl"])

    by_regime = {}
    for t in trades:
        r = t.get("regime") or "Unknown"
        if r not in by_regime:
            by_regime[r] = {"count": 0, "wins": 0, "total_pnl": 0}
        by_regime[r]["count"] += 1
        if (t.get("actual_pnl") or 0) > 0: by_regime[r]["wins"] += 1
        by_regime[r]["total_pnl"] += t.get("actual_pnl", 0) or 0
    for k, v in by_regime.items():
        v["win_rate"] = round(v["wins"] / v["count"] * 100, 1) if v["count"] else 0
        v["total_pnl"] = round(v["total_pnl"])

    return {
        "period_days": days,
        "total_trades": len(trades),
        "winners": len(winners),
        "losers": len(losers),
        "win_rate": round(win_rate, 1),
        "total_pnl": round(total_pnl),
        "avg_win": round(avg_win),
        "avg_loss": round(avg_loss),
        "payoff_ratio": round(payoff, 2),
        "expectancy": round(win_rate / 100 * avg_win + (1 - win_rate / 100) * avg_loss),
        "by_strategy": by_strategy,
        "by_regime": by_regime,
        "recent_trades": [{
            "id": t["id"], "date": str(t["signal_date"]), "symbol": t["symbol"],
            "strategy": t.get("strategy_name") or t["strategy"],
            "direction": t["direction"], "pnl": t.get("actual_pnl", 0),
            "pnl_pct": t.get("actual_pnl_pct", 0),
            "status": t["status"], "evaluation": t.get("evaluation", ""),
            "market": t.get("market_sentiment", ""),
        } for t in trades[:20]],
    }
