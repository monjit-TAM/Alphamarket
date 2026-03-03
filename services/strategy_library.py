"""
AlphaForge — Strategy Library (Live Signal Evaluation)
Used by ForwardTestingEngine to generate signals from live price ticks.
"""

from datetime import datetime
from typing import List, Dict, Any
from core.redis_client import redis_client


class StrategyLibrary:

    @staticmethod
    async def evaluate_live(config: dict, prices: dict) -> List[dict]:
        """
        Evaluate a strategy against the latest price tick.
        Returns a list of signal dicts if signals are triggered.
        Uses Redis to maintain a rolling price buffer per symbol.
        """
        strategy = config.get("strategy", "sma_crossover")
        symbols = config.get("symbols", list(prices.keys()))
        params = config.get("params", {})
        signals = []

        for symbol in symbols:
            if symbol not in prices:
                continue

            current_price = prices[symbol].get("ltp", 0)
            change_pct = prices[symbol].get("change_pct", 0)

            # Maintain a rolling buffer of the last 200 prices in Redis
            buffer_key = f"fwd_buffer:{symbol}"
            buffer = await redis_client.get(buffer_key) or []
            buffer.append(current_price)
            if len(buffer) > 200:
                buffer = buffer[-200:]
            await redis_client.set(buffer_key, buffer, ttl=86400)

            if len(buffer) < 30:
                continue  # Not enough data

            signal = None

            if strategy == "sma_crossover":
                fast = params.get("fast", 10)
                slow = params.get("slow", 30)
                if len(buffer) >= slow:
                    sma_fast = sum(buffer[-fast:]) / fast
                    sma_slow = sum(buffer[-slow:]) / slow
                    sma_fast_prev = sum(buffer[-fast-1:-1]) / fast
                    sma_slow_prev = sum(buffer[-slow-1:-1]) / slow
                    if sma_fast > sma_slow and sma_fast_prev <= sma_slow_prev:
                        signal = {"type": "BUY", "reason": f"SMA{fast} crossed above SMA{slow}"}
                    elif sma_fast < sma_slow and sma_fast_prev >= sma_slow_prev:
                        signal = {"type": "SELL", "reason": f"SMA{fast} crossed below SMA{slow}"}

            elif strategy == "rsi_mean_reversion":
                oversold = params.get("oversold", 30)
                overbought = params.get("overbought", 70)
                rsi = StrategyLibrary._calc_rsi(buffer, 14)
                if rsi is not None:
                    if rsi < oversold:
                        signal = {"type": "BUY", "reason": f"RSI oversold at {rsi:.1f}"}
                    elif rsi > overbought:
                        signal = {"type": "SELL", "reason": f"RSI overbought at {rsi:.1f}"}

            elif strategy == "momentum":
                lookback = params.get("lookback", 20)
                threshold = params.get("threshold", 1.0)
                if len(buffer) >= lookback + 1:
                    mom = (buffer[-1] / buffer[-lookback - 1] - 1) * 100
                    if mom > threshold:
                        signal = {"type": "BUY", "reason": f"Momentum +{mom:.2f}% over {lookback} ticks"}
                    elif mom < -threshold:
                        signal = {"type": "SELL", "reason": f"Momentum {mom:.2f}% over {lookback} ticks"}

            elif strategy == "quantamental":
                # Simplified live version — combine RSI + momentum
                rsi = StrategyLibrary._calc_rsi(buffer, 14)
                mom20 = (buffer[-1] / buffer[-21] - 1) * 100 if len(buffer) >= 21 else 0
                if rsi and rsi < 35 and mom20 > -2:
                    signal = {"type": "BUY", "reason": f"Quantamental: RSI {rsi:.1f}, Mom {mom20:.2f}%"}
                elif rsi and rsi > 70:
                    signal = {"type": "SELL", "reason": f"Quantamental: RSI overbought {rsi:.1f}"}

            if signal:
                signals.append({
                    "symbol": symbol,
                    "signal": signal["type"],
                    "reason": signal["reason"],
                    "price": current_price,
                    "change_pct": change_pct,
                    "strategy": strategy,
                    "timestamp": datetime.utcnow().isoformat(),
                    "strength": "STRONG" if abs(change_pct) > 1 else "MODERATE",
                })

        return signals

    @staticmethod
    def _calc_rsi(prices: list, period: int = 14) -> float:
        if len(prices) < period + 1:
            return None
        recent = prices[-(period + 1):]
        changes = [recent[i] - recent[i-1] for i in range(1, len(recent))]
        gains = [c for c in changes if c > 0]
        losses = [-c for c in changes if c < 0]
        avg_gain = sum(gains) / period if gains else 0
        avg_loss = sum(losses) / period if losses else 0
        if avg_loss == 0:
            return 100
        rs = avg_gain / avg_loss
        return 100 - 100 / (1 + rs)
