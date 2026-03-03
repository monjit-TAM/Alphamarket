"""
AlphaForge — Backtest Router
POST /api/backtest/run      — Run a backtest
GET  /api/backtest/history  — User's backtest history
GET  /api/backtest/{id}     — Fetch specific result
GET  /api/backtest/strategies — List all available strategies
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import uuid, json
from datetime import datetime, timedelta

from core.database import get_db
from core.auth import get_current_user
from models.user import User
from models.backtest_result import BacktestResultModel
from services.groww_service import GrowwService
from services.backtest_engine import backtest_engine

router = APIRouter()
groww = GrowwService()


# ── Schemas ────────────────────────────────────────────────────────────────
class BacktestRequest(BaseModel):
    name: str = "My Backtest"
    strategy: str                        # e.g. "quantamental"
    symbols: List[str]                   # e.g. ["RELIANCE", "TCS"]
    exchange: str = "NSE"
    period_days: int = 365               # How many days of history to test
    initial_capital: float = 1_000_000
    allocation_method: str = "EQUAL"     # EQUAL | MARKET_CAP | CUSTOM
    custom_weights: Optional[Dict[str, float]] = None
    params: Dict[str, Any] = {}          # strategy-specific params
    commission_pct: float = 0.03
    slippage_pct: float = 0.01
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    perspective: str = "MIXED"           # VALUE | GROWTH | QUANTAMENTAL


AVAILABLE_STRATEGIES = [
    {"id": "sma_crossover",      "name": "SMA Crossover",       "type": "Technical",     "perspective": "Growth",        "params": [{"key": "fast", "label": "Fast Period", "default": 20, "min": 5, "max": 100}, {"key": "slow", "label": "Slow Period", "default": 50, "min": 20, "max": 200}]},
    {"id": "ema_crossover",      "name": "EMA Crossover",       "type": "Technical",     "perspective": "Growth",        "params": [{"key": "fast", "default": 12}, {"key": "slow", "default": 26}]},
    {"id": "rsi_mean_reversion", "name": "RSI Mean Reversion",  "type": "Technical",     "perspective": "Value",         "params": [{"key": "oversold", "label": "Oversold Level", "default": 30, "min": 10, "max": 45}, {"key": "overbought", "label": "Overbought Level", "default": 70, "min": 55, "max": 90}, {"key": "period", "default": 14}]},
    {"id": "macd_crossover",     "name": "MACD Crossover",      "type": "Technical",     "perspective": "Growth",        "params": []},
    {"id": "bollinger_breakout", "name": "Bollinger Breakout",  "type": "Technical",     "perspective": "Value",         "params": [{"key": "period", "default": 20}, {"key": "std", "default": 2}]},
    {"id": "supertrend",         "name": "Supertrend",          "type": "Technical",     "perspective": "Growth",        "params": [{"key": "period", "default": 10}, {"key": "multiplier", "default": 3}]},
    {"id": "momentum",           "name": "Price Momentum",      "type": "Technical",     "perspective": "Growth",        "params": [{"key": "lookback", "default": 20}, {"key": "threshold", "default": 5.0}]},
    {"id": "volume_price_trend", "name": "Volume Price Trend",  "type": "Technical",     "perspective": "Growth",        "params": []},
    {"id": "value",              "name": "Value Investing",     "type": "Fundamental",   "perspective": "Value",         "params": []},
    {"id": "growth_momentum",    "name": "Growth Momentum",     "type": "Fundamental",   "perspective": "Growth",        "params": []},
    {"id": "quantamental",       "name": "Quantamental",        "type": "Quantamental",  "perspective": "Mixed",         "params": []},
    {"id": "dividend_yield",     "name": "Dividend Yield",      "type": "Fundamental",   "perspective": "Value",         "params": []},
]


@router.get("/strategies")
async def list_strategies():
    return {"strategies": AVAILABLE_STRATEGIES}


@router.post("/run")
async def run_backtest(
    req: BacktestRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Run a full backtest. Fetches historical data from Groww for each symbol,
    runs the selected strategy, and returns comprehensive performance metrics.
    """
    if not req.symbols:
        raise HTTPException(status_code=400, detail="At least one symbol required")
    if len(req.symbols) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 symbols per backtest")

    # Validate strategy
    valid_strategies = {s["id"] for s in AVAILABLE_STRATEGIES}
    if req.strategy not in valid_strategies:
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {req.strategy}")

    # Fetch historical data and fundamentals for each symbol
    from_date = datetime.utcnow() - timedelta(days=req.period_days)
    to_date = datetime.utcnow()

    groww_svc = GrowwService()
    await groww_svc.authenticate()

    # Get all instruments for fundamental data lookup
    instruments = await groww_svc.get_all_instruments()
    instr_map = {i["symbol"]: i for i in instruments}

    stock_data = []
    failed_symbols = []

    for symbol in req.symbols:
        try:
            df = await groww_svc.get_historical_data(
                symbol=symbol,
                exchange=req.exchange,
                interval="1d",
                from_date=from_date,
                to_date=to_date,
            )
            if df is None or len(df) < 30:
                failed_symbols.append(symbol)
                continue

            instr = instr_map.get(symbol, {})
            fundamentals = {
                "symbol":      symbol,
                "name":        instr.get("name", symbol),
                "sector":      instr.get("sector", "Unknown"),
                "exchange":    req.exchange,
                "market_cap":  instr.get("market_cap", 0),
                # These come from a fundamentals lookup if available
                # For now using reasonable defaults — can extend with BSE/NSE API
                "pe":          instr.get("pe", 25),
                "pb":          instr.get("pb", 3),
                "roe":         instr.get("roe", 15),
                "debt_equity": instr.get("debt_equity", 0.5),
                "div_yield":   instr.get("div_yield", 1),
                "ev_ebitda":   instr.get("ev_ebitda", 15),
                "ocf_growth":  instr.get("ocf_growth", 10),
            }
            stock_data.append({"df": df, "fundamentals": fundamentals})

        except Exception as e:
            failed_symbols.append(symbol)

    if not stock_data:
        raise HTTPException(status_code=422, detail="Could not fetch data for any of the provided symbols")

    # Run the backtest engine
    try:
        portfolio_result = backtest_engine.run_portfolio(
            stock_data=stock_data,
            strategy_name=req.strategy,
            params=req.params,
            initial_capital=req.initial_capital,
            allocation_method=req.allocation_method,
            custom_weights=req.custom_weights,
            commission_pct=req.commission_pct,
            slippage_pct=req.slippage_pct,
            stop_loss_pct=req.stop_loss_pct,
            take_profit_pct=req.take_profit_pct,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backtest engine error: {str(e)}")

    # Save to DB
    result_model = BacktestResultModel(
        id=uuid.uuid4(),
        user_id=current_user.id,
        strategy_name=req.strategy,
        strategy_type=portfolio_result.strategy_type,
        perspective=req.perspective,
        symbols=",".join(req.symbols),
        period_days=req.period_days,
        initial_capital=req.initial_capital,
        final_capital=portfolio_result.final_capital,
        total_return_pct=portfolio_result.total_return_pct,
        annualized_return_pct=portfolio_result.annualized_return_pct,
        max_drawdown_pct=portfolio_result.max_drawdown_pct,
        sharpe_ratio=portfolio_result.sharpe_ratio,
        sortino_ratio=portfolio_result.sortino_ratio,
        win_rate_pct=portfolio_result.win_rate_pct,
        total_trades=portfolio_result.total_trades,
        params=req.params,
        name=req.name,
    )
    db.add(result_model)

    # Serialize result (exclude full equity curves to keep DB lean)
    result_dict = {
        "id": str(result_model.id),
        "strategy_name": portfolio_result.strategy_name,
        "strategy_type": portfolio_result.strategy_type,
        "perspective": portfolio_result.perspective,
        "period_days": portfolio_result.period_days,
        "initial_capital": portfolio_result.initial_capital,
        "final_capital": portfolio_result.final_capital,
        "total_return_pct": portfolio_result.total_return_pct,
        "annualized_return_pct": portfolio_result.annualized_return_pct,
        "max_drawdown_pct": portfolio_result.max_drawdown_pct,
        "sharpe_ratio": portfolio_result.sharpe_ratio,
        "sortino_ratio": portfolio_result.sortino_ratio,
        "calmar_ratio": portfolio_result.calmar_ratio,
        "win_rate_pct": portfolio_result.win_rate_pct,
        "profit_factor": portfolio_result.profit_factor,
        "total_trades": portfolio_result.total_trades,
        "benchmark_return_pct": portfolio_result.benchmark_return_pct,
        "alpha": portfolio_result.alpha,
        "sector_allocation": portfolio_result.sector_allocation,
        "portfolio_equity_curve": portfolio_result.portfolio_equity_curve,
        "failed_symbols": failed_symbols,
        "stock_results": [
            {
                "symbol": r.symbol, "name": r.name, "sector": r.sector,
                "total_return_pct": r.total_return_pct,
                "annualized_return_pct": r.annualized_return_pct,
                "max_drawdown_pct": r.max_drawdown_pct,
                "sharpe_ratio": r.sharpe_ratio, "sortino_ratio": r.sortino_ratio,
                "calmar_ratio": r.calmar_ratio, "var_95": r.var_95,
                "total_trades": r.total_trades, "win_rate_pct": r.win_rate_pct,
                "profit_factor": r.profit_factor, "alpha": r.alpha,
                "avg_win_pct": r.avg_win_pct, "avg_loss_pct": r.avg_loss_pct,
                "max_consecutive_losses": r.max_consecutive_losses,
                "avg_holding_days": r.avg_holding_days,
                "final_capital": r.final_capital,
                "equity_curve": r.equity_curve,
                "monthly_returns": r.monthly_returns,
            }
            for r in portfolio_result.stock_results
        ],
    }

    return result_dict


@router.get("/history")
async def get_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(BacktestResultModel)
        .where(BacktestResultModel.user_id == current_user.id)
        .order_by(BacktestResultModel.created_at.desc())
        .limit(50)
    )
    rows = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "strategy_name": r.strategy_name,
            "strategy_type": r.strategy_type,
            "period_days": r.period_days,
            "initial_capital": r.initial_capital,
            "total_return_pct": r.total_return_pct,
            "sharpe_ratio": r.sharpe_ratio,
            "total_trades": r.total_trades,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
