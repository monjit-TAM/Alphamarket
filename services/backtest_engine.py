"""
AlphaForge — Backtesting Engine
Vectorized backtesting for Technical, Fundamental, Growth, Value & Quantamental strategies.
Uses Pandas/NumPy for high-performance computation on full NSE/BSE universe.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


# ── Result Structures ──────────────────────────────────────────────────────
@dataclass
class Trade:
    symbol: str
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    quantity: int
    pnl: float
    pnl_pct: float
    holding_days: int
    signal: str


@dataclass
class BacktestResult:
    symbol: str
    name: str
    sector: str
    exchange: str

    # Returns
    total_return_pct: float
    annualized_return_pct: float
    benchmark_return_pct: float  # Nifty 50 return for same period
    alpha: float                 # excess return over benchmark

    # Risk
    max_drawdown_pct: float
    volatility_annualized: float
    sharpe_ratio: float
    sortino_ratio: float
    calmar_ratio: float
    var_95: float                # Value at Risk (95% confidence)

    # Trade stats
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate_pct: float
    avg_win_pct: float
    avg_loss_pct: float
    profit_factor: float
    avg_holding_days: float
    max_consecutive_losses: int

    # Capital
    initial_capital: float
    final_capital: float
    peak_capital: float

    # Data
    equity_curve: List[float] = field(default_factory=list)
    drawdown_series: List[float] = field(default_factory=list)
    trades: List[Trade] = field(default_factory=list)
    monthly_returns: Dict[str, float] = field(default_factory=dict)


@dataclass
class PortfolioBacktestResult:
    strategy_name: str
    strategy_type: str
    perspective: str
    period_days: int
    from_date: str
    to_date: str
    initial_capital: float
    final_capital: float
    total_return_pct: float
    annualized_return_pct: float
    max_drawdown_pct: float
    sharpe_ratio: float
    sortino_ratio: float
    calmar_ratio: float
    win_rate_pct: float
    profit_factor: float
    total_trades: int
    benchmark_return_pct: float
    alpha: float
    stock_results: List[BacktestResult] = field(default_factory=list)
    portfolio_equity_curve: List[float] = field(default_factory=list)
    sector_allocation: Dict[str, float] = field(default_factory=dict)


# ── Technical Indicators ──────────────────────────────────────────────────
class Indicators:
    @staticmethod
    def sma(series: pd.Series, period: int) -> pd.Series:
        return series.rolling(period).mean()

    @staticmethod
    def ema(series: pd.Series, period: int) -> pd.Series:
        return series.ewm(span=period, adjust=False).mean()

    @staticmethod
    def rsi(series: pd.Series, period: int = 14) -> pd.Series:
        delta = series.diff()
        gain = delta.where(delta > 0, 0).rolling(period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(period).mean()
        rs = gain / loss.replace(0, np.inf)
        return 100 - (100 / (1 + rs))

    @staticmethod
    def macd(series: pd.Series, fast=12, slow=26, signal=9):
        ema_fast = Indicators.ema(series, fast)
        ema_slow = Indicators.ema(series, slow)
        macd_line = ema_fast - ema_slow
        signal_line = Indicators.ema(macd_line, signal)
        histogram = macd_line - signal_line
        return macd_line, signal_line, histogram

    @staticmethod
    def bollinger_bands(series: pd.Series, period=20, std_dev=2):
        mid = series.rolling(period).mean()
        std = series.rolling(period).std()
        upper = mid + std_dev * std
        lower = mid - std_dev * std
        return upper, mid, lower

    @staticmethod
    def atr(high: pd.Series, low: pd.Series, close: pd.Series, period=14) -> pd.Series:
        tr = pd.concat([
            high - low,
            (high - close.shift()).abs(),
            (low - close.shift()).abs(),
        ], axis=1).max(axis=1)
        return tr.rolling(period).mean()

    @staticmethod
    def adx(high: pd.Series, low: pd.Series, close: pd.Series, period=14) -> pd.Series:
        atr = Indicators.atr(high, low, close, period)
        dm_plus = (high - high.shift()).where((high - high.shift()) > (low.shift() - low), 0).clip(lower=0)
        dm_minus = (low.shift() - low).where((low.shift() - low) > (high - high.shift()), 0).clip(lower=0)
        di_plus = 100 * dm_plus.rolling(period).mean() / atr
        di_minus = 100 * dm_minus.rolling(period).mean() / atr
        dx = 100 * (di_plus - di_minus).abs() / (di_plus + di_minus)
        return dx.rolling(period).mean()

    @staticmethod
    def supertrend(high: pd.Series, low: pd.Series, close: pd.Series, period=10, multiplier=3):
        atr = Indicators.atr(high, low, close, period)
        hl2 = (high + low) / 2
        upper = hl2 + multiplier * atr
        lower = hl2 - multiplier * atr
        supertrend = pd.Series(index=close.index, dtype=float)
        direction = pd.Series(index=close.index, dtype=int)

        for i in range(1, len(close)):
            if close.iloc[i] > upper.iloc[i - 1]:
                direction.iloc[i] = 1
            elif close.iloc[i] < lower.iloc[i - 1]:
                direction.iloc[i] = -1
            else:
                direction.iloc[i] = direction.iloc[i - 1]
            supertrend.iloc[i] = lower.iloc[i] if direction.iloc[i] == 1 else upper.iloc[i]

        return supertrend, direction

    @staticmethod
    def stochastic(high, low, close, k_period=14, d_period=3):
        lowest_low = low.rolling(k_period).min()
        highest_high = high.rolling(k_period).max()
        k = 100 * (close - lowest_low) / (highest_high - lowest_low)
        d = k.rolling(d_period).mean()
        return k, d

    @staticmethod
    def williams_r(high, low, close, period=14):
        highest_high = high.rolling(period).max()
        lowest_low = low.rolling(period).min()
        return -100 * (highest_high - close) / (highest_high - lowest_low)

    @staticmethod
    def momentum(series: pd.Series, period: int) -> pd.Series:
        return (series / series.shift(period) - 1) * 100

    @staticmethod
    def volume_sma(volume: pd.Series, period: int = 20) -> pd.Series:
        return volume.rolling(period).mean()


# ── Strategy Implementations ──────────────────────────────────────────────
class Strategies:

    @staticmethod
    def sma_crossover(df: pd.DataFrame, fast: int = 20, slow: int = 50) -> pd.Series:
        """Classic moving average crossover — Golden/Death cross"""
        sma_f = Indicators.sma(df["close"], fast)
        sma_s = Indicators.sma(df["close"], slow)
        signal = pd.Series(0, index=df.index)
        signal[(sma_f > sma_s) & (sma_f.shift() <= sma_s.shift())] = 1   # BUY
        signal[(sma_f < sma_s) & (sma_f.shift() >= sma_s.shift())] = -1  # SELL
        return signal

    @staticmethod
    def ema_crossover(df: pd.DataFrame, fast: int = 12, slow: int = 26) -> pd.Series:
        """EMA crossover — more responsive than SMA"""
        ema_f = Indicators.ema(df["close"], fast)
        ema_s = Indicators.ema(df["close"], slow)
        signal = pd.Series(0, index=df.index)
        signal[(ema_f > ema_s) & (ema_f.shift() <= ema_s.shift())] = 1
        signal[(ema_f < ema_s) & (ema_f.shift() >= ema_s.shift())] = -1
        return signal

    @staticmethod
    def rsi_mean_reversion(df: pd.DataFrame, oversold: int = 30, overbought: int = 70, period: int = 14) -> pd.Series:
        """RSI oversold/overbought mean reversion"""
        rsi = Indicators.rsi(df["close"], period)
        signal = pd.Series(0, index=df.index)
        signal[(rsi < oversold) & (rsi.shift() >= oversold)] = 1
        signal[(rsi > overbought) & (rsi.shift() <= overbought)] = -1
        return signal

    @staticmethod
    def macd_crossover(df: pd.DataFrame) -> pd.Series:
        """MACD line crossing signal line"""
        macd_line, signal_line, _ = Indicators.macd(df["close"])
        signal = pd.Series(0, index=df.index)
        signal[(macd_line > signal_line) & (macd_line.shift() <= signal_line.shift())] = 1
        signal[(macd_line < signal_line) & (macd_line.shift() >= signal_line.shift())] = -1
        return signal

    @staticmethod
    def bollinger_breakout(df: pd.DataFrame, period=20, std=2) -> pd.Series:
        """Bollinger Band breakout/mean reversion"""
        upper, mid, lower = Indicators.bollinger_bands(df["close"], period, std)
        signal = pd.Series(0, index=df.index)
        signal[df["close"] < lower] = 1   # Buy at lower band
        signal[df["close"] > upper] = -1  # Sell at upper band
        return signal

    @staticmethod
    def supertrend_strategy(df: pd.DataFrame, period=10, multiplier=3) -> pd.Series:
        """Supertrend trend-following strategy"""
        _, direction = Indicators.supertrend(df["high"], df["low"], df["close"], period, multiplier)
        signal = pd.Series(0, index=df.index)
        signal[(direction == 1) & (direction.shift() == -1)] = 1
        signal[(direction == -1) & (direction.shift() == 1)] = -1
        return signal

    @staticmethod
    def momentum_strategy(df: pd.DataFrame, lookback: int = 20, threshold: float = 5.0) -> pd.Series:
        """Price momentum strategy (Growth perspective)"""
        mom = Indicators.momentum(df["close"], lookback)
        signal = pd.Series(0, index=df.index)
        signal[mom > threshold] = 1
        signal[mom < -threshold] = -1
        return signal

    @staticmethod
    def volume_price_trend(df: pd.DataFrame) -> pd.Series:
        """Volume-confirmed price trend strategy"""
        sma20 = Indicators.sma(df["close"], 20)
        vol_sma = Indicators.volume_sma(df["volume"], 20)
        price_above = df["close"] > sma20
        volume_above = df["volume"] > vol_sma
        signal = pd.Series(0, index=df.index)
        signal[price_above & volume_above & ~(price_above.shift() & volume_above.shift())] = 1
        signal[~price_above & ~(~price_above.shift())] = -1
        return signal

    @staticmethod
    def value_strategy(df: pd.DataFrame, fundamentals: dict) -> pd.Series:
        """
        Fundamental value investing strategy.
        Buy when price drops and fundamentals are strong.
        Sell when price reaches fair value (margin of safety exhausted).
        """
        signal = pd.Series(0, index=df.index)
        pe = fundamentals.get("pe", 999)
        pb = fundamentals.get("pb", 999)
        roe = fundamentals.get("roe", 0)

        # Only trade value stocks (low PE, low PB, high ROE)
        is_value = pe < 25 and pb < 3 and roe > 12

        if is_value:
            sma50 = Indicators.sma(df["close"], 50)
            rsi = Indicators.rsi(df["close"], 14)
            # Buy when oversold and price near 52-week low
            low_52w = df["close"].rolling(252).min()
            near_52w_low = df["close"] < low_52w * 1.15
            signal[(rsi < 40) & near_52w_low] = 1
            # Sell when RSI overbought (valuation restored)
            high_52w = df["close"].rolling(252).max()
            near_52w_high = df["close"] > high_52w * 0.88
            signal[(rsi > 65) & near_52w_high] = -1

        return signal

    @staticmethod
    def growth_momentum(df: pd.DataFrame, fundamentals: dict) -> pd.Series:
        """
        Growth investing strategy.
        Buys high-quality growth companies on pullbacks.
        """
        roe = fundamentals.get("roe", 0)
        revenue_growth = fundamentals.get("revenue_growth", 0)
        is_growth = roe > 20 and revenue_growth > 15

        signal = pd.Series(0, index=df.index)
        if is_growth:
            ema20 = Indicators.ema(df["close"], 20)
            ema50 = Indicators.ema(df["close"], 50)
            rsi = Indicators.rsi(df["close"], 14)
            # Buy on pullback to 20 EMA in uptrend
            in_uptrend = ema20 > ema50
            pullback = df["close"] < ema20 * 1.02
            signal[in_uptrend & pullback & (rsi > 40) & (rsi < 55)] = 1
            # Sell when price extends too far above EMA
            extended = df["close"] > ema20 * 1.15
            signal[extended & (rsi > 75)] = -1

        return signal

    @staticmethod
    def quantamental(df: pd.DataFrame, fundamentals: dict) -> pd.Series:
        """
        Quantamental strategy — combines fundamental scoring with
        technical entry/exit timing for best of both worlds.
        """
        # ── Fundamental Score (0–10) ─────────────────────────────────
        score = 0
        pe = fundamentals.get("pe", 999)
        pb = fundamentals.get("pb", 999)
        roe = fundamentals.get("roe", 0)
        debt_equity = fundamentals.get("debt_equity", 999)
        div_yield = fundamentals.get("div_yield", 0)
        ev_ebitda = fundamentals.get("ev_ebitda", 999)
        ocf_growth = fundamentals.get("ocf_growth", 0)

        if pe < 15: score += 2
        elif pe < 25: score += 1
        if pb < 2: score += 2
        elif pb < 4: score += 1
        if roe > 20: score += 2
        elif roe > 12: score += 1
        if debt_equity < 0.3: score += 1
        elif debt_equity < 0.7: score += 0.5
        if div_yield > 2: score += 1
        if ev_ebitda < 12: score += 1
        if ocf_growth > 10: score += 1

        # Only trade if fundamental score >= 5
        signal = pd.Series(0, index=df.index)
        if score < 5:
            return signal

        # ── Technical Entry/Exit ─────────────────────────────────────
        rsi = Indicators.rsi(df["close"], 14)
        macd_line, signal_line, hist = Indicators.macd(df["close"])
        sma50 = Indicators.sma(df["close"], 50)
        sma200 = Indicators.sma(df["close"], 200)
        vol_sma = Indicators.volume_sma(df["volume"], 20)

        # Buy conditions (multiple confirmations required)
        tech_buy = (
            (rsi < 45) &                                  # Not overbought
            (df["close"] > sma50) &                      # Above 50 SMA
            (sma50 > sma200) &                            # Golden cross regime
            (hist > hist.shift()) &                       # MACD improving
            (df["volume"] > vol_sma * 0.8)               # Reasonable volume
        )
        signal[tech_buy & ~tech_buy.shift().fillna(False)] = 1

        # Sell conditions
        tech_sell = (
            (rsi > 72) |                                  # Overbought
            (df["close"] < sma50) |                      # Lost key support
            (hist < 0) & (hist.shift() >= 0)             # MACD negative crossover
        )
        signal[tech_sell & ~tech_sell.shift().fillna(False)] = -1

        return signal

    @staticmethod
    def dividend_yield_strategy(df: pd.DataFrame, fundamentals: dict) -> pd.Series:
        """High dividend yield value strategy"""
        signal = pd.Series(0, index=df.index)
        div_yield = fundamentals.get("div_yield", 0)
        payout_ratio = fundamentals.get("payout_ratio", 100)
        if div_yield < 2.5 or payout_ratio > 80:
            return signal
        rsi = Indicators.rsi(df["close"], 14)
        sma100 = Indicators.sma(df["close"], 100)
        signal[(rsi < 40) & (df["close"] > sma100 * 0.95)] = 1
        signal[rsi > 68] = -1
        return signal


# ── Core Backtesting Engine ───────────────────────────────────────────────
class BacktestEngine:

    def __init__(self):
        self.strategies = {
            "sma_crossover":        Strategies.sma_crossover,
            "ema_crossover":        Strategies.ema_crossover,
            "rsi_mean_reversion":   Strategies.rsi_mean_reversion,
            "macd_crossover":       Strategies.macd_crossover,
            "bollinger_breakout":   Strategies.bollinger_breakout,
            "supertrend":           Strategies.supertrend_strategy,
            "momentum":             Strategies.momentum_strategy,
            "volume_price_trend":   Strategies.volume_price_trend,
            "value":                Strategies.value_strategy,
            "growth_momentum":      Strategies.growth_momentum,
            "quantamental":         Strategies.quantamental,
            "dividend_yield":       Strategies.dividend_yield_strategy,
        }

    def run(
        self,
        df: pd.DataFrame,
        strategy_name: str,
        fundamentals: dict,
        params: dict,
        initial_capital: float = 1_000_000,
        commission_pct: float = 0.03,   # 0.03% per trade (Groww charges)
        slippage_pct: float = 0.01,     # 0.01% slippage
        position_size_pct: float = 100, # % of capital per trade
        stop_loss_pct: Optional[float] = None,
        take_profit_pct: Optional[float] = None,
    ) -> Optional[BacktestResult]:
        """
        Run a vectorized backtest on a single stock.
        Returns a BacktestResult or None if insufficient data.
        """
        if df is None or len(df) < 60:
            return None

        df = df.copy().reset_index(drop=True)
        df.columns = [c.lower() for c in df.columns]

        # Generate signals
        try:
            strategy_fn = self.strategies[strategy_name]
            if strategy_name in ("value", "growth_momentum", "quantamental", "dividend_yield"):
                raw_signals = strategy_fn(df, fundamentals, **params) if params else strategy_fn(df, fundamentals)
            else:
                raw_signals = strategy_fn(df, **params) if params else strategy_fn(df)
        except Exception as e:
            logger.error(f"Strategy signal generation failed: {e}")
            return None

        # ── Simulate Trades ────────────────────────────────────────────────
        cash = initial_capital
        shares = 0
        entry_price = 0
        entry_idx = 0
        trades = []
        equity_curve = []
        position_active = False

        for i, row in df.iterrows():
            price = row["close"]
            sig = raw_signals.iloc[i] if i < len(raw_signals) else 0

            # Stop loss / take profit checks
            if position_active:
                if stop_loss_pct and price < entry_price * (1 - stop_loss_pct / 100):
                    sig = -1  # Force exit
                elif take_profit_pct and price > entry_price * (1 + take_profit_pct / 100):
                    sig = -1  # Force exit

            # Execute BUY
            if sig == 1 and not position_active:
                exec_price = price * (1 + slippage_pct / 100)
                invest = cash * (position_size_pct / 100)
                shares = int(invest / exec_price)
                if shares > 0:
                    cost = shares * exec_price * (1 + commission_pct / 100)
                    cash -= cost
                    entry_price = exec_price
                    entry_idx = i
                    position_active = True

            # Execute SELL
            elif sig == -1 and position_active:
                exec_price = price * (1 - slippage_pct / 100)
                proceeds = shares * exec_price * (1 - commission_pct / 100)
                cash += proceeds
                pnl = proceeds - (shares * entry_price * (1 + commission_pct / 100))
                pnl_pct = (exec_price / entry_price - 1) * 100

                holding = i - entry_idx
                entry_date = str(df.iloc[entry_idx].get("date", entry_idx))
                exit_date = str(row.get("date", i))

                trades.append(Trade(
                    symbol=fundamentals.get("symbol", ""),
                    entry_date=entry_date, exit_date=exit_date,
                    entry_price=round(entry_price, 2), exit_price=round(exec_price, 2),
                    quantity=shares, pnl=round(pnl, 2), pnl_pct=round(pnl_pct, 4),
                    holding_days=holding, signal=strategy_name,
                ))
                shares = 0
                position_active = False

            equity_curve.append(cash + shares * price)

        # Force close any open position at last price
        if position_active:
            last_price = df["close"].iloc[-1]
            proceeds = shares * last_price * (1 - commission_pct / 100)
            cash += proceeds
            equity_curve[-1] = cash

        # ── Performance Metrics ────────────────────────────────────────────
        eq = pd.Series(equity_curve)
        returns = eq.pct_change().dropna()

        total_return_pct = (eq.iloc[-1] / initial_capital - 1) * 100
        n_years = len(df) / 252
        annualized_return_pct = ((1 + total_return_pct / 100) ** (1 / max(n_years, 0.01)) - 1) * 100

        # Drawdown
        rolling_max = eq.cummax()
        drawdowns = (eq - rolling_max) / rolling_max * 100
        max_drawdown_pct = drawdowns.min()

        # Sharpe (assuming 6.5% risk-free rate for India)
        rf_daily = 0.065 / 252
        excess_returns = returns - rf_daily
        sharpe = (excess_returns.mean() / excess_returns.std() * np.sqrt(252)) if excess_returns.std() > 0 else 0

        # Sortino (downside deviation only)
        downside = returns[returns < 0].std()
        sortino = (excess_returns.mean() / downside * np.sqrt(252)) if downside > 0 else 0

        # Calmar
        calmar = annualized_return_pct / abs(max_drawdown_pct) if max_drawdown_pct != 0 else 0

        # VaR 95%
        var_95 = np.percentile(returns, 5) * 100 if len(returns) > 0 else 0

        # Trade statistics
        winning = [t for t in trades if t.pnl > 0]
        losing = [t for t in trades if t.pnl <= 0]
        win_rate = len(winning) / len(trades) * 100 if trades else 0
        avg_win = np.mean([t.pnl_pct for t in winning]) if winning else 0
        avg_loss = np.mean([t.pnl_pct for t in losing]) if losing else 0
        gross_profit = sum(t.pnl for t in winning)
        gross_loss = abs(sum(t.pnl for t in losing))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0

        # Max consecutive losses
        consec_losses = 0
        max_consec = 0
        for t in trades:
            if t.pnl <= 0:
                consec_losses += 1
                max_consec = max(max_consec, consec_losses)
            else:
                consec_losses = 0

        # Monthly returns
        monthly = {}
        if "date" in df.columns:
            df["equity"] = equity_curve
            df["date"] = pd.to_datetime(df["date"])
            df["month"] = df["date"].dt.to_period("M")
            for month, group in df.groupby("month"):
                if len(group) >= 2:
                    mr = (group["equity"].iloc[-1] / group["equity"].iloc[0] - 1) * 100
                    monthly[str(month)] = round(mr, 2)

        return BacktestResult(
            symbol=fundamentals.get("symbol", ""),
            name=fundamentals.get("name", ""),
            sector=fundamentals.get("sector", ""),
            exchange=fundamentals.get("exchange", "NSE"),
            total_return_pct=round(total_return_pct, 2),
            annualized_return_pct=round(annualized_return_pct, 2),
            benchmark_return_pct=round(n_years * 13.5, 2),  # Nifty ~13.5% CAGR historically
            alpha=round(annualized_return_pct - n_years * 13.5, 2),
            max_drawdown_pct=round(max_drawdown_pct, 2),
            volatility_annualized=round(returns.std() * np.sqrt(252) * 100, 2),
            sharpe_ratio=round(sharpe, 3),
            sortino_ratio=round(sortino, 3),
            calmar_ratio=round(calmar, 3),
            var_95=round(var_95, 3),
            total_trades=len(trades),
            winning_trades=len(winning),
            losing_trades=len(losing),
            win_rate_pct=round(win_rate, 2),
            avg_win_pct=round(avg_win, 2),
            avg_loss_pct=round(avg_loss, 2),
            profit_factor=round(profit_factor, 3),
            avg_holding_days=round(np.mean([t.holding_days for t in trades]), 1) if trades else 0,
            max_consecutive_losses=max_consec,
            initial_capital=initial_capital,
            final_capital=round(cash, 2),
            peak_capital=round(eq.max(), 2),
            equity_curve=[round(v, 2) for v in equity_curve],
            drawdown_series=[round(v, 2) for v in drawdowns.tolist()],
            trades=trades,
            monthly_returns=monthly,
        )

    def run_portfolio(
        self,
        stock_data: List[dict],       # [{"df": df, "fundamentals": {...}}, ...]
        strategy_name: str,
        params: dict,
        initial_capital: float,
        allocation_method: str = "EQUAL",  # EQUAL, MARKET_CAP, RISK_PARITY, CUSTOM
        custom_weights: Optional[Dict[str, float]] = None,
        commission_pct: float = 0.03,
        slippage_pct: float = 0.01,
        stop_loss_pct: Optional[float] = None,
        take_profit_pct: Optional[float] = None,
    ) -> PortfolioBacktestResult:
        """Run backtest across a portfolio of stocks and aggregate results"""

        n = len(stock_data)
        if n == 0:
            raise ValueError("No stock data provided")

        # Determine capital allocation
        if allocation_method == "EQUAL":
            weights = {s["fundamentals"]["symbol"]: 1 / n for s in stock_data}
        elif allocation_method == "CUSTOM" and custom_weights:
            total_w = sum(custom_weights.values())
            weights = {k: v / total_w for k, v in custom_weights.items()}
        elif allocation_method == "MARKET_CAP":
            total_mc = sum(s["fundamentals"].get("market_cap", 1) for s in stock_data)
            weights = {s["fundamentals"]["symbol"]: s["fundamentals"].get("market_cap", 1) / total_mc for s in stock_data}
        else:
            weights = {s["fundamentals"]["symbol"]: 1 / n for s in stock_data}

        # Run individual backtests
        results = []
        for stock in stock_data:
            sym = stock["fundamentals"]["symbol"]
            alloc = initial_capital * weights.get(sym, 1 / n)
            result = self.run(
                df=stock["df"],
                strategy_name=strategy_name,
                fundamentals=stock["fundamentals"],
                params=params,
                initial_capital=alloc,
                commission_pct=commission_pct,
                slippage_pct=slippage_pct,
                stop_loss_pct=stop_loss_pct,
                take_profit_pct=take_profit_pct,
            )
            if result:
                results.append(result)

        if not results:
            raise ValueError("No valid backtest results")

        # Aggregate portfolio metrics
        total_final = sum(r.final_capital for r in results)
        total_return = (total_final / initial_capital - 1) * 100
        avg_annual = np.mean([r.annualized_return_pct for r in results])
        avg_sharpe = np.mean([r.sharpe_ratio for r in results])
        avg_sortino = np.mean([r.sortino_ratio for r in results])
        avg_calmar = np.mean([r.calmar_ratio for r in results])
        worst_dd = min(r.max_drawdown_pct for r in results)
        total_trades = sum(r.total_trades for r in results)
        all_wins = sum(r.winning_trades for r in results)
        win_rate = all_wins / total_trades * 100 if total_trades > 0 else 0

        gross_profit = sum(sum(t.pnl for t in r.trades if t.pnl > 0) for r in results)
        gross_loss = abs(sum(sum(t.pnl for t in r.trades if t.pnl <= 0) for r in results))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0

        # Sector allocation
        sector_capital = {}
        for r in results:
            sector_capital[r.sector] = sector_capital.get(r.sector, 0) + r.initial_capital
        sector_allocation = {k: round(v / initial_capital * 100, 1) for k, v in sector_capital.items()}

        # Portfolio equity curve (weighted sum)
        min_len = min(len(r.equity_curve) for r in results)
        portfolio_eq = [
            sum(r.equity_curve[i] for r in results if i < len(r.equity_curve))
            for i in range(min_len)
        ]

        period_days = max(len(r.equity_curve) for r in results)

        return PortfolioBacktestResult(
            strategy_name=strategy_name,
            strategy_type=self._classify_strategy(strategy_name),
            perspective=self._strategy_perspective(strategy_name),
            period_days=period_days,
            from_date=str(datetime.utcnow().date()),
            to_date=str(datetime.utcnow().date()),
            initial_capital=initial_capital,
            final_capital=round(total_final, 2),
            total_return_pct=round(total_return, 2),
            annualized_return_pct=round(avg_annual, 2),
            max_drawdown_pct=round(worst_dd, 2),
            sharpe_ratio=round(avg_sharpe, 3),
            sortino_ratio=round(avg_sortino, 3),
            calmar_ratio=round(avg_calmar, 3),
            win_rate_pct=round(win_rate, 2),
            profit_factor=round(profit_factor, 3),
            total_trades=total_trades,
            benchmark_return_pct=round(period_days / 252 * 13.5 * 100 / 100, 2),
            alpha=round(total_return - (period_days / 252 * 13.5), 2),
            stock_results=results,
            portfolio_equity_curve=[round(v, 2) for v in portfolio_eq],
            sector_allocation=sector_allocation,
        )

    def _classify_strategy(self, name: str) -> str:
        technical = {"sma_crossover", "ema_crossover", "rsi_mean_reversion", "macd_crossover",
                     "bollinger_breakout", "supertrend", "momentum", "volume_price_trend"}
        fundamental = {"value", "growth_momentum", "dividend_yield"}
        if name in technical:
            return "Technical"
        if name in fundamental:
            return "Fundamental"
        return "Quantamental"

    def _strategy_perspective(self, name: str) -> str:
        growth = {"momentum", "growth_momentum", "ema_crossover", "supertrend"}
        value = {"value", "dividend_yield", "rsi_mean_reversion", "bollinger_breakout"}
        if name in growth:
            return "Growth"
        if name in value:
            return "Value"
        return "Quantamental"


# Singleton
backtest_engine = BacktestEngine()
