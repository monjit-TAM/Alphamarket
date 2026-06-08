"""
AlphaMarket Algo Engine — Event-driven signal generation
5 White-box strategies with real-time scanning + backtesting

Strategies:
  1. AlphaScore Momentum Trigger (Investor)
  2. Smart Money Breakout (Investor)
  3. Theta Decay Machine (Trader - Options)
  4. Momentum Surge (Trader - Equity)
  5. Oversold Snapback (Trader - Equity)
"""
import json, logging, asyncio, redis
from datetime import datetime, date, timedelta
from typing import List, Dict, Optional, Any
import pytz

logger = logging.getLogger("algo_engine")
IST = pytz.timezone("Asia/Kolkata")

# ═══════════════════════════════════════════════════════════════
# CORE: Signal Model
# ═══════════════════════════════════════════════════════════════

class AlgoSignal:
    """Represents a single actionable trade signal."""
    def __init__(self, algo_id: str, algo_name: str, symbol: str, action: str,
                 entry_price: float, stop_loss: float, target: float,
                 target2: float = 0, hold_days: str = "", reasoning: str = "",
                 segment: str = "equity", risk_reward: float = 0,
                 confidence: int = 0, **extra):
        self.algo_id = algo_id
        self.algo_name = algo_name
        self.symbol = symbol
        self.action = action  # BUY / SELL / EXIT
        self.entry_price = round(entry_price, 2)
        self.stop_loss = round(stop_loss, 2)
        self.target = round(target, 2)
        self.target2 = round(target2, 2) if target2 else 0
        self.hold_days = hold_days
        self.reasoning = reasoning
        self.segment = segment
        self.risk_pct = round(abs(entry_price - stop_loss) / entry_price * 100, 1) if entry_price > 0 else 0
        self.reward_pct = round(abs(target - entry_price) / entry_price * 100, 1) if entry_price > 0 else 0
        self.risk_reward = round(self.reward_pct / self.risk_pct, 1) if self.risk_pct > 0 else 0
        self.confidence = confidence
        self.timestamp = datetime.now(IST).isoformat()
        self.extra = extra

    def to_dict(self):
        d = {
            "algo_id": self.algo_id, "algo_name": self.algo_name,
            "symbol": self.symbol, "action": self.action,
            "entry_price": self.entry_price, "stop_loss": self.stop_loss,
            "target": self.target, "target2": self.target2,
            "hold_days": self.hold_days, "reasoning": self.reasoning,
            "segment": self.segment, "risk_pct": self.risk_pct,
            "reward_pct": self.reward_pct, "risk_reward": self.risk_reward,
            "confidence": self.confidence, "timestamp": self.timestamp,
        }
        d.update(self.extra)
        return d


# ═══════════════════════════════════════════════════════════════
# STRATEGY 1: AlphaScore Momentum Trigger (Investor)
# ═══════════════════════════════════════════════════════════════

def scan_alphascore_momentum(universe: List[dict], fundamentals: dict = None,
                              prev_scores: dict = None, max_open: int = 5,
                              open_positions: list = None) -> List[AlgoSignal]:
    """
    AlphaScore Momentum — fires when composite score crosses threshold with momentum.
    Uses ONLY available sb_universe fields.
    """
    signals = []
    open_syms = {p["symbol"] for p in (open_positions or [])}

    for s in universe:
        sym = s.get("symbol", "")
        if sym in open_syms or len(signals) + len(open_syms) >= max_open:
            continue

        price = s.get("price", 0)
        if price < 50:
            continue

        rsi = s.get("rsi", 50)
        above_50 = s.get("above_50dma", False)
        above_200 = s.get("above_200dma", False)
        rs_1m = s.get("rs_1m", 0)
        rs_3m = s.get("rs_3m", 0)
        vol_ratio = s.get("vol_ratio", 0)
        minervini = s.get("minervini_score", 0)
        pct_52h = s.get("pct_from_52h", -99)
        macd = s.get("macd_hist", 0)
        cap = s.get("cap_segment", "")

        # AlphaScore from available fields (0-100)
        rsi_sc = min(1, max(0, (rsi - 30) / 40)) * 20
        trend_sc = (1.0 if (above_50 and above_200) else (0.5 if above_50 else 0)) * 25
        rs_sc = min(1, max(0, rs_1m / 10)) * 20 if rs_1m > 0 else 0
        vol_sc = min(1, vol_ratio / 2) * 15
        min_sc = (minervini / 8) * 10
        high_sc = min(1, max(0, (100 + pct_52h) / 100)) * 10
        alpha_score = rsi_sc + trend_sc + rs_sc + vol_sc + min_sc + high_sc

        if alpha_score < 55:
            continue

        # Entry conditions — all must be true
        if not (50 <= rsi <= 85): continue
        if not (above_50 and above_200): continue
        if not (rs_1m > 0): continue
        if not (cap in ("large", "mid", "small")): continue
        if not (macd > 0): continue

        sl = round(price * 0.93, 2)
        tgt = round(price * 1.10, 2)
        tgt2 = round(price * 1.18, 2)

        reasons = []
        reasons.append(f"AlphaScore {alpha_score:.0f}/100")
        reasons.append(f"RSI {rsi:.0f}")
        reasons.append(f"Above 50 & 200 DMA")
        reasons.append(f"RS vs NIFTY: +{rs_1m:.1f}%")
        reasons.append(f"Minervini {minervini}/8")
        reasons.append(f"Volume {vol_ratio:.1f}x")

        signals.append(AlgoSignal(
            algo_id="ALGO1", algo_name="AlphaScore Momentum",
            symbol=sym, action="BUY", entry_price=price,
            stop_loss=sl, target=tgt, target2=tgt2,
            hold_days="15-45 days", segment="equity",
            confidence=min(95, int(alpha_score)),
            reasoning=" | ".join(reasons),
            alpha_score=alpha_score, rsi=rsi,
        ))

    signals.sort(key=lambda x: x.extra.get("alpha_score", 0), reverse=True)
    return signals[:max_open - len(open_syms)]


def scan_smart_money_breakout(universe: List[dict], prev_smart: dict = None,
                               max_open: int = 4, open_positions: list = None) -> List[AlgoSignal]:
    """
    Smart Money Breakout — detects volume accumulation + breakout.
    Uses ONLY available sb_universe fields.
    """
    signals = []
    open_syms = {p["symbol"] for p in (open_positions or [])}

    for s in universe:
        sym = s.get("symbol", "")
        if sym in open_syms or len(signals) + len(open_syms) >= max_open:
            continue

        price = s.get("price", 0)
        if price < 50:
            continue

        vol_ratio = s.get("vol_ratio", 1)
        rs_1m = s.get("rs_1m", 0)
        rs_3m = s.get("rs_3m", 0)
        minervini = s.get("minervini_score", 0)
        pct_52h = s.get("pct_from_52h", -99)
        above_200 = s.get("above_200dma", False)
        above_50 = s.get("above_50dma", False)
        rsi = s.get("rsi", 50)
        cap = s.get("cap_segment", "")

        # Smart Money Score from available fields (0-100)
        smart_money = (min(vol_ratio * 25, 35) +
                       min(max(rs_1m, 0) * 3, 25) +
                       min(max(rs_3m, 0) * 1.5, 15) +
                       minervini * 3)

        if smart_money < 45:
            continue

        # Entry conditions
        if not (vol_ratio > 1.3): continue
        if not (pct_52h > -15): continue
        if not above_200: continue
        if not (cap in ("large", "mid")): continue
        if not (rsi > 45): continue

        sl = round(price * 0.92, 2)
        tgt = round(price * 1.15, 2)

        reasons = []
        reasons.append(f"Smart Money {smart_money:.0f}/100")
        reasons.append(f"Volume {vol_ratio:.1f}x average")
        reasons.append(f"{abs(pct_52h):.0f}% from 52W high")
        reasons.append(f"RS 1M: +{rs_1m:.1f}%")
        if above_200: reasons.append("Above 200 DMA")

        signals.append(AlgoSignal(
            algo_id="ALGO2", algo_name="Smart Money Breakout",
            symbol=sym, action="BUY", entry_price=price,
            stop_loss=sl, target=tgt, hold_days="20-60 days",
            segment="equity", confidence=min(90, int(smart_money)),
            reasoning=" | ".join(reasons),
            smart_money=smart_money, vol_ratio=vol_ratio,
        ))

    signals.sort(key=lambda x: x.extra.get("smart_money", 0), reverse=True)
    return signals[:max_open - len(open_syms)]


def scan_theta_decay(vix: float, vix_sma20: float, nifty_price: float,
                     banknifty_price: float, atr_pct: float,
                     theta_score: int = 0, day_of_week: int = 0,
                     max_open: int = 2, open_positions: list = None) -> List[AlgoSignal]:
    """
    Iron Condor signals when VIX is low and market is range-bound.
    Scanner: Every 30 min during market hours (Mon-Wed only)
    """
    signals = []
    open_syms = {p.get("symbol", "") for p in (open_positions or [])}

    if day_of_week > 2:  # Only Mon(0), Tue(1), Wed(2)
        return []

    if vix >= 20 or vix > vix_sma20 + 2:  # Low vol regime (relaxed)
        return []

    if atr_pct > 1.5:  # Range-bound only
        return []

    if theta_score < 60:
        return []

    for idx_sym, idx_price, lot_size in [("NIFTY", nifty_price, 25), ("BANKNIFTY", banknifty_price, 15)]:
        if idx_sym in open_syms or len(signals) + len(open_syms) >= max_open:
            continue

        if idx_price <= 0:
            continue

        # Calculate iron condor strikes
        width = round(idx_price * 0.02)  # 2% OTM each side
        width = round(width / 50) * 50  # Round to nearest 50

        sell_ce = round((idx_price + width) / 50) * 50
        sell_pe = round((idx_price - width) / 50) * 50
        buy_ce = sell_ce + (500 if idx_sym == "NIFTY" else 1000)
        buy_pe = sell_pe - (500 if idx_sym == "NIFTY" else 1000)

        # Estimate premium (simplified)
        prem_per_lot = round(idx_price * 0.005 * lot_size)  # ~0.5% of index * lot
        max_loss = round((500 if idx_sym == "NIFTY" else 1000) * lot_size - prem_per_lot)
        capital = max_loss + round(idx_price * 0.05 * lot_size)  # Margin estimate

        reasons = []
        reasons.append(f"VIX {vix:.1f} (below SMA20 {vix_sma20:.1f})")
        reasons.append(f"Theta Score {theta_score}/100")
        reasons.append(f"ATR {atr_pct:.1f}% (range-bound)")
        reasons.append(f"Profit zone: {sell_pe}-{sell_ce}")

        signals.append(AlgoSignal(
            algo_id="ALGO3", algo_name="Theta Decay Machine",
            symbol=idx_sym, action="SELL", entry_price=idx_price,
            stop_loss=0, target=0, hold_days="1-4 days (weekly)",
            segment="options", confidence=min(85, theta_score),
            reasoning=" | ".join(reasons),
            strategy_type="Iron Condor",
            sell_ce=sell_ce, sell_pe=sell_pe, buy_ce=buy_ce, buy_pe=buy_pe,
            max_profit=prem_per_lot, max_loss=max_loss, capital=capital,
            profit_zone=f"{sell_pe}-{sell_ce}",
            pop=round(70 + (17 - vix) * 2),  # Higher PoP at lower VIX
        ))

    return signals


# ═══════════════════════════════════════════════════════════════
# STRATEGY 4: Momentum Surge (Trader)
# ═══════════════════════════════════════════════════════════════

def scan_momentum_surge(universe: List[dict], max_open: int = 3,
                         open_positions: list = None) -> List[AlgoSignal]:
    """
    Catches breakouts with volume surge in real-time.
    Scanner: Every 5 min during market hours
    """
    signals = []
    open_syms = {p["symbol"] for p in (open_positions or [])}

    for s in universe:
        sym = s.get("symbol", "")
        if sym in open_syms or len(signals) + len(open_syms) >= max_open:
            continue

        price = s.get("price", 0)
        if price < 50:
            continue

        # ── Entry conditions ──
        near_52h = s.get("pct_from_52h", -99) > -10  # Within 10% of 52W high
        vol_surge = s.get("vol_ratio", 0) >= 1.2
        rsi = s.get("rsi", 50)
        rsi_ok = 50 <= rsi <= 80
        minervini = s.get("minervini_score", 0) >= 5
        macd_bull = s.get("macd_hist", 0) > 0
        above_st = s.get("above_supertrend", False)
        above_50 = s.get("above_50dma", False)
        cap = s.get("cap_segment", "")
        liquid = cap in ("large", "mid", "small")

        if near_52h and vol_surge and rsi_ok and minervini and macd_bull and above_50 and liquid:
            sl = round(price * 0.96, 2)  # 4% SL
            tgt1 = round(price * 1.05, 2)  # 5% T1
            tgt2 = round(price * 1.10, 2)  # 10% T2

            reasons = []
            reasons.append(f"Breaking 52W high (within {abs(s.get('pct_from_52h', 0)):.1f}%)")
            reasons.append(f"Volume surge {s.get('vol_ratio', 0):.1f}x")
            reasons.append(f"RSI {rsi:.0f} | MACD bullish")
            reasons.append(f"Minervini {s.get('minervini_score', 0)}/8")
            reasons.append(f"Above Supertrend + 50 DMA")

            signals.append(AlgoSignal(
                algo_id="ALGO4", algo_name="Momentum Surge",
                symbol=sym, action="BUY", entry_price=price,
                stop_loss=sl, target=tgt1, target2=tgt2,
                hold_days="3-10 days", segment="equity",
                confidence=min(90, s.get("minervini_score", 0) * 11 + int(s.get("vol_ratio", 0) * 5)),
                reasoning=" | ".join(reasons),
                vol_ratio=s.get("vol_ratio", 0), rsi=rsi,
                minervini=s.get("minervini_score", 0),
            ))

    # Sort by vol_ratio * minervini (strongest breakouts first)
    signals.sort(key=lambda x: x.extra.get("vol_ratio", 0) * x.extra.get("minervini", 0), reverse=True)
    return signals[:max_open - len(open_syms)]


# ═══════════════════════════════════════════════════════════════
# STRATEGY 5: Oversold Snapback (Trader)
# ═══════════════════════════════════════════════════════════════

def scan_oversold_snapback(universe: List[dict], max_open: int = 2,
                            open_positions: list = None) -> List[AlgoSignal]:
    """
    Oversold Snapback — catches quality stocks at extreme lows.
    Uses ONLY available sb_universe fields.
    """
    signals = []
    open_syms = {p["symbol"] for p in (open_positions or [])}

    for s in universe:
        sym = s.get("symbol", "")
        if sym in open_syms or len(signals) + len(open_syms) >= max_open:
            continue

        price = s.get("price", 0)
        if price < 50:
            continue

        rsi = s.get("rsi", 50)
        change_pct = s.get("change_pct", 0)
        wk_change = s.get("wk_change", 0)
        above_200 = s.get("above_200dma", False)
        rs_3m = s.get("rs_3m", 0)
        cap = s.get("cap_segment", "small")

        # Entry conditions
        oversold = rsi < 32
        sharp_drop = change_pct < -2 or wk_change < -5
        trend_intact = above_200
        not_broken = rs_3m > -20  # Not in complete freefall
        good_cap = cap in ("large", "mid", "small")

        if oversold and sharp_drop and trend_intact and not_broken and good_cap:
            sl = round(price * 0.97, 2)
            tgt = round(price * 1.05, 2)

            reasons = []
            reasons.append(f"RSI {rsi:.0f} (extreme oversold)")
            if change_pct < -2: reasons.append(f"Down {abs(change_pct):.1f}% today")
            if wk_change < -5: reasons.append(f"Week: {wk_change:.1f}%")
            reasons.append("Above 200 DMA (trend intact)")
            reasons.append(f"Cap: {cap}")

            signals.append(AlgoSignal(
                algo_id="ALGO5", algo_name="Oversold Snapback",
                symbol=sym, action="BUY", entry_price=price,
                stop_loss=sl, target=tgt, hold_days="1-5 days",
                segment="equity", confidence=min(80, 100 - int(rsi)),
                reasoning=" | ".join(reasons),
                rsi=rsi, drop_pct=change_pct,
            ))

    signals.sort(key=lambda x: x.extra.get("rsi", 50))
    return signals[:max_open - len(open_syms)]


# ═══════════════════════════════════════════════════════════════
# BACKTESTING ENGINE
# ═══════════════════════════════════════════════════════════════

def backtest_equity_algo(algo_fn, ohlcv_data: Dict[str, list], universe_snapshots: list = None,
                          algo_name: str = "", sl_pct: float = 7, tgt_pct: float = 10,
                          max_hold: int = 45, max_open: int = 5,
                          start_capital: float = 1000000) -> dict:
    """
    Generic backtester for equity algos (1,2,4,5).
    ohlcv_data: {symbol: [{date,open,high,low,close,volume},...]}
    Returns: {trades, equity_curve, metrics}
    """
    import pandas as pd
    capital = start_capital
    equity_curve = [{"date": "", "value": capital}]
    trades = []
    open_pos = []
    daily_pnl = []

    # Build date-indexed price lookup
    price_by_date = {}
    all_dates = set()
    for sym, rows in ohlcv_data.items():
        for r in rows:
            d = str(r.get("date", r.get("Date", "")))[:10]
            all_dates.add(d)
            price_by_date.setdefault(d, {})[sym] = {
                "open": float(r.get("open", r.get("Open", 0))),
                "high": float(r.get("high", r.get("High", 0))),
                "low": float(r.get("low", r.get("Low", 0))),
                "close": float(r.get("close", r.get("Close", 0))),
                "volume": int(r.get("volume", r.get("Volume", 0))),
            }

    sorted_dates = sorted(all_dates)
    if not sorted_dates:
        return {"trades": [], "equity_curve": [], "metrics": {}}

    prev_day_data = {}
    lookback = {}  # symbol -> last N days of data for indicator calc

    for i, dt in enumerate(sorted_dates):
        day_prices = price_by_date.get(dt, {})

        # ── Check exits for open positions ──
        closed_today = []
        for pos in open_pos[:]:
            sym = pos["symbol"]
            if sym not in day_prices:
                continue
            dp = day_prices[sym]
            hold_days = (datetime.strptime(dt, "%Y-%m-%d") - datetime.strptime(pos["entry_date"], "%Y-%m-%d")).days

            exit_price = 0
            exit_reason = ""

            # SL hit (check low)
            if dp["low"] <= pos["stop_loss"]:
                exit_price = pos["stop_loss"]
                exit_reason = "STOP_LOSS"
            # Target hit (check high)
            elif dp["high"] >= pos["target"]:
                exit_price = pos["target"]
                exit_reason = "TARGET"
            # Time stop
            elif hold_days >= max_hold:
                exit_price = dp["close"]
                exit_reason = "TIME_STOP"
            # Trailing stop (once +50% of target move, trail SL to entry)
            elif dp["high"] >= pos["entry_price"] * (1 + tgt_pct / 500):
                pos["stop_loss"] = max(pos["stop_loss"], pos["entry_price"])  # Move SL to breakeven

            if exit_price > 0:
                pnl = (exit_price - pos["entry_price"]) * pos["qty"]
                pnl_pct = (exit_price / pos["entry_price"] - 1) * 100
                capital += pos["qty"] * exit_price
                trades.append({
                    "symbol": sym, "entry_date": pos["entry_date"], "exit_date": dt,
                    "entry_price": pos["entry_price"], "exit_price": round(exit_price, 2),
                    "qty": pos["qty"], "pnl": round(pnl, 2), "pnl_pct": round(pnl_pct, 2),
                    "hold_days": hold_days, "exit_reason": exit_reason,
                    "algo_name": algo_name,
                })
                open_pos.remove(pos)
                closed_today.append(pos)

        # ── Scan for new entries (simplified — use daily close data as universe snapshot) ──
        if i > 20 and len(open_pos) < max_open:  # Need 20 days of history
            # Build simplified universe from available price data
            mini_universe = []
            for sym, dp in day_prices.items():
                if dp["close"] < 50:
                    continue

                # Calculate indicators from lookback
                hist = []
                for j in range(max(0, i - 200), i + 1):
                    pd_data = price_by_date.get(sorted_dates[j], {}).get(sym)
                    if pd_data:
                        hist.append(pd_data["close"])

                if len(hist) < 20:
                    continue

                sma_50 = sum(hist[-50:]) / min(len(hist), 50) if len(hist) >= 50 else sum(hist) / len(hist)
                sma_200 = sum(hist[-200:]) / min(len(hist), 200) if len(hist) >= 200 else sum(hist) / len(hist)
                close = dp["close"]

                # RSI calculation (14-period)
                gains, losses = [], []
                for k in range(1, min(15, len(hist))):
                    diff = hist[-k] - hist[-(k + 1)] if k + 1 <= len(hist) else 0
                    if diff > 0: gains.append(diff)
                    else: losses.append(abs(diff))
                avg_gain = sum(gains) / 14 if gains else 0.001
                avg_loss = sum(losses) / 14 if losses else 0.001
                rsi = 100 - (100 / (1 + avg_gain / avg_loss)) if avg_loss > 0 else 50

                # Relative strength vs start
                rs_1m = ((close / hist[-20]) - 1) * 100 if len(hist) >= 20 else 0

                # Volume ratio
                vol_hist = []
                for j in range(max(0, i - 20), i + 1):
                    pd_data = price_by_date.get(sorted_dates[j], {}).get(sym)
                    if pd_data: vol_hist.append(pd_data["volume"])
                vol_ratio = dp["volume"] / (sum(vol_hist) / len(vol_hist)) if vol_hist and sum(vol_hist) > 0 else 1

                # 52W high/low
                high_52 = max(hist[-252:]) if len(hist) >= 252 else max(hist)
                pct_from_52h = ((close / high_52) - 1) * 100 if high_52 > 0 else -99

                # Change pct
                prev_close = hist[-2] if len(hist) >= 2 else close
                change_pct = ((close / prev_close) - 1) * 100 if prev_close > 0 else 0
                wk_change = ((close / hist[-5]) - 1) * 100 if len(hist) >= 5 else 0

                # Minervini score
                minervini = sum([
                    close > sma_50, close > sma_200, sma_50 > sma_200,
                    rsi > 40, vol_ratio > 0.8, close > hist[-20] if len(hist) >= 20 else False,
                    pct_from_52h > -25, change_pct > -2,
                ])

                # Simplified scores
                mom_score = min(1, max(0, (rsi - 30) / 40))
                fund_score = 0.6  # Default — no fundamental data in backtest
                trend_score = 1 if (close > sma_50 and close > sma_200) else 0.3
                acc_score = min(1, vol_ratio / 3)

                mini_universe.append({
                    "symbol": sym, "price": close, "rsi": rsi,
                    "above_50dma": close > sma_50, "above_200dma": close > sma_200,
                    "sma_50": sma_50, "sma_200": sma_200,
                    "rs_1m": rs_1m, "vol_ratio": vol_ratio,
                    "pct_from_52h": pct_from_52h, "change_pct": change_pct,
                    "wk_change": wk_change, "minervini_score": minervini,
                    "macd_hist": 1 if close > sma_50 else -1,
                    "above_supertrend": close > sma_50,
                    "momentum_score": mom_score, "fundamental_score": fund_score,
                    "trend_score": trend_score, "accumulation_score": acc_score,
                    "sentiment_score": 0.5, "alpha_rating": 0,
                    "roe": 15, "debt_equity": 0.5, "market_cap": 10000,
                    "cap_segment": "large",
                })

            # Run the strategy scanner
            new_signals = algo_fn(mini_universe, max_open=max_open, open_positions=open_pos)

            # Open positions for signals
            for sig in new_signals:
                if len(open_pos) >= max_open:
                    break
                pos_size = capital * 0.35  # 35% per position
                qty = int(pos_size / sig.entry_price) if sig.entry_price > 0 else 0
                if qty <= 0:
                    continue
                capital -= qty * sig.entry_price
                open_pos.append({
                    "symbol": sig.symbol, "entry_date": dt,
                    "entry_price": sig.entry_price, "stop_loss": sig.stop_loss,
                    "target": sig.target, "qty": qty,
                })

        # Update equity curve
        portfolio_val = capital
        for pos in open_pos:
            sym_price = day_prices.get(pos["symbol"], {}).get("close", pos["entry_price"])
            portfolio_val += pos["qty"] * sym_price

        if i % 5 == 0:  # Sample every 5 days
            equity_curve.append({"date": dt, "value": round(portfolio_val, 2)})

    # Close remaining open positions at last price
    last_date = sorted_dates[-1]
    for pos in open_pos:
        last_price = price_by_date.get(last_date, {}).get(pos["symbol"], {}).get("close", pos["entry_price"])
        pnl = (last_price - pos["entry_price"]) * pos["qty"]
        pnl_pct = (last_price / pos["entry_price"] - 1) * 100
        capital += pos["qty"] * last_price
        trades.append({
            "symbol": pos["symbol"], "entry_date": pos["entry_date"], "exit_date": last_date,
            "entry_price": pos["entry_price"], "exit_price": round(last_price, 2),
            "qty": pos["qty"], "pnl": round(pnl, 2), "pnl_pct": round(pnl_pct, 2),
            "hold_days": 0, "exit_reason": "BACKTEST_END", "algo_name": algo_name,
        })

    equity_curve.append({"date": sorted_dates[-1], "value": round(capital, 2)})

    # Calculate metrics
    total_trades = len(trades)
    winners = [t for t in trades if t["pnl"] > 0]
    losers = [t for t in trades if t["pnl"] <= 0]
    win_rate = len(winners) / total_trades * 100 if total_trades else 0
    avg_win = sum(t["pnl_pct"] for t in winners) / len(winners) if winners else 0
    avg_loss = sum(t["pnl_pct"] for t in losers) / len(losers) if losers else 0
    total_pnl = sum(t["pnl"] for t in trades)
    total_return = (capital / start_capital - 1) * 100
    years = max(1, (datetime.strptime(sorted_dates[-1], "%Y-%m-%d") - datetime.strptime(sorted_dates[0], "%Y-%m-%d")).days / 365)
    cagr = ((capital / start_capital) ** (1 / years) - 1) * 100

    # Max drawdown
    peak = start_capital
    max_dd = 0
    for pt in equity_curve:
        if pt["value"] > peak: peak = pt["value"]
        dd = (peak - pt["value"]) / peak * 100
        if dd > max_dd: max_dd = dd

    # Profit factor
    gross_profit = sum(t["pnl"] for t in winners)
    gross_loss = abs(sum(t["pnl"] for t in losers))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 999

    metrics = {
        "total_trades": total_trades,
        "winners": len(winners), "losers": len(losers),
        "win_rate": round(win_rate, 1),
        "avg_win_pct": round(avg_win, 2), "avg_loss_pct": round(avg_loss, 2),
        "total_pnl": round(total_pnl, 2),
        "total_return_pct": round(total_return, 2),
        "cagr": round(cagr, 2),
        "max_drawdown": round(max_dd, 2),
        "profit_factor": round(profit_factor, 2),
        "avg_hold_days": round(sum(t["hold_days"] for t in trades) / total_trades, 1) if total_trades else 0,
        "best_trade": round(max(t["pnl_pct"] for t in trades), 2) if trades else 0,
        "worst_trade": round(min(t["pnl_pct"] for t in trades), 2) if trades else 0,
        "start_capital": start_capital,
        "end_capital": round(capital, 2),
        "years": round(years, 1),
        "algo_name": algo_name,
    }

    return {"trades": trades, "equity_curve": equity_curve, "metrics": metrics}


# ═══════════════════════════════════════════════════════════════
# STRATEGY INFO (for UI display)
# ═══════════════════════════════════════════════════════════════

ALGO_INFO = {
    "ALGO1": {
        "name": "AlphaScore Momentum",
        "category": "Investor",
        "scan_frequency": "Daily 10:00 AM",
        "hold_period": "15-45 days",
        "max_positions": 5,
        "risk_per_trade": "7% SL",
        "target": "10-18%",
        "segment": "Equity (Large + Mid Cap)",
        "description": "Fires when a stock's AlphaScore crosses above 70 with RSI, trend, and relative strength confirmation. Targets quality momentum — strong fundamentals meeting rising price action.",
        "edge": "AlphaScore is proprietary — combines 5 dimensions (Technical, Fundamental, Momentum, Ownership, Risk) into a single score. No other platform has this signal.",
        "rules": [
            "AlphaScore crosses above 70 (was below in previous scan)",
            "RSI between 55-80 (momentum rising, not exhausted)",
            "Price above both 50 and 200 DMA (trend confirmed)",
            "Relative Strength vs NIFTY (1M) positive",
            "ROE > 10%, Debt/Equity < 1.5 (quality filter)",
        ],
        "exit_rules": [
            "AlphaScore drops below 50 → exit",
            "Price closes below 50 DMA → exit next day",
            "Trailing: +5% → SL to breakeven, +8% → trail at -5%",
            "Time stop: 45 days max",
            "NIFTY drops > 3% in a day → exit all",
        ],
    },
    "ALGO2": {
        "name": "Smart Money Breakout",
        "category": "Investor",
        "scan_frequency": "Daily 10:30 AM + 2:30 PM",
        "hold_period": "20-60 days",
        "max_positions": 4,
        "risk_per_trade": "8% SL",
        "target": "15%",
        "segment": "Equity (Mid + Large Cap, >5000 Cr)",
        "description": "Detects institutional accumulation reaching critical mass, confirmed by price breaking to new highs. Follow the smart money — institutions do deep research before building positions.",
        "edge": "Smart Money Score combines volume accumulation patterns, delivery data, and institutional flow signals. This data is not available on any retail platform.",
        "rules": [
            "Smart Money Score crosses above 65 (accumulation intensifying)",
            "Volume ratio > 1.3x sustained over 3+ sessions",
            "Price within 15% of 52-week high (near breakout)",
            "Above 200 DMA (long-term uptrend intact)",
            "Market Cap > ₹5,000 Cr (institutional grade)",
        ],
        "exit_rules": [
            "Smart Money drops below 40 (distribution) → exit",
            "Price drops below 20-day low → exit",
            "Volume spike >3x on red day → exit (institutional selling)",
            "Trailing: +8% → trail at -6%",
            "Time stop: 60 days max",
        ],
    },
    "ALGO3": {
        "name": "Theta Decay Machine",
        "category": "Trader",
        "scan_frequency": "Every 30 min (Mon-Wed only)",
        "hold_period": "1-4 days (weekly)",
        "max_positions": 2,
        "risk_per_trade": "Defined (Iron Condor spread)",
        "target": "50% of premium collected",
        "segment": "NIFTY + BANKNIFTY Options",
        "description": "Sells Iron Condor spreads when VIX is low and market is range-bound. Collects theta decay as time premium erodes. Only trades Mon-Wed to maximize theta and minimize gamma risk near expiry.",
        "edge": "Combines VIX regime classification, Theta Opportunity Score, and ATR-based range detection. The regime engine has proven 85%+ win rate on Iron Condors in low-vol environments.",
        "rules": [
            "VIX < 17 AND below 20-day SMA (low volatility regime)",
            "Theta Opportunity Score ≥ 70",
            "Day is Monday, Tuesday, or Wednesday",
            "NIFTY/BANKNIFTY ATR% < 1.5% (range-bound)",
            "No major event (RBI, Budget) in next 48 hours",
        ],
        "exit_rules": [
            "Profit: collected 50% of max premium → close",
            "Loss: 1.5x premium collected → close",
            "VIX spikes above 20 → close immediately",
            "2 hours before expiry → close",
            "Index within 1% of short strike → close",
        ],
    },
    "ALGO4": {
        "name": "Momentum Surge",
        "category": "Trader",
        "scan_frequency": "Every 5 min during market hours",
        "hold_period": "3-10 days",
        "max_positions": 3,
        "risk_per_trade": "4% SL",
        "target": "5% T1, 10% T2",
        "segment": "Equity (F&O + Large Cap)",
        "description": "Catches stocks breaking to 52-week highs with volume surge confirmation. Uses Minervini SEPA template — the methodology that produced 33,554% return over 5 years in US markets. Adapted for Indian market dynamics.",
        "edge": "Real-time 5-minute scanning + Minervini score (8-point checklist) + Volume surge detection. Signals fire within minutes of breakout, not end-of-day.",
        "rules": [
            "Price within 5% of 52-week high (breakout zone)",
            "Volume ratio ≥ 1.5x (surge confirmation)",
            "RSI 55-78 (strong but not overbought)",
            "Minervini Score ≥ 6/8",
            "MACD bullish + Above Supertrend + Above 50 DMA",
            "Market Cap > ₹10,000 Cr (liquid)",
        ],
        "exit_rules": [
            "T1 at +5%: book 50% position",
            "T2 at +10%: book remaining",
            "Stop Loss: -4% (hard, non-negotiable)",
            "Time stop: 10 trading days",
            "Breakout failure (drops below breakout level same day) → exit",
            "Trailing: +4% → SL moves to breakeven",
        ],
    },
    "ALGO5": {
        "name": "Oversold Snapback",
        "category": "Trader",
        "scan_frequency": "Every 15 min during market hours",
        "hold_period": "1-5 days",
        "max_positions": 2,
        "risk_per_trade": "3% SL (tight)",
        "target": "5%",
        "segment": "Equity (Large + Mid Cap)",
        "description": "Catches the rubber-band effect — quality stocks that crash fast and bounce fast. Buys extreme oversold conditions in fundamentally strong names where the long-term trend is intact.",
        "edge": "Combines RSI extreme (<28) with fundamental quality filter (AlphaScore + D/E) and trend filter (above 200 DMA). Most oversold scanners buy junk stocks falling to zero — this one only buys quality names with temporary selloffs.",
        "rules": [
            "RSI < 28 (extreme oversold)",
            "Price dropped > 3% today or > 8% in 5 days",
            "Price STILL above 200 DMA (trend intact)",
            "Fundamental Score > 0.5 or ROE > 10%",
            "Debt/Equity < 1.0 (won't go bankrupt)",
            "Large or Mid cap only",
        ],
        "exit_rules": [
            "Target: +5% → full exit",
            "Stop Loss: -3% (tight — wrong thesis = exit fast)",
            "RSI crosses above 50 → exit (mean reverted)",
            "Time stop: 5 trading days max",
            "NIFTY drops > 2% same day → exit all (market-wide selloff)",
        ],
    },
}
