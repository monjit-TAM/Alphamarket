"""Backtest result storage"""
from sqlalchemy import Column, String, Float, Integer, ForeignKey, DateTime, Text, JSON
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base
from datetime import datetime
import uuid


class BacktestResultModel(Base):
    __tablename__ = "backtest_results"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    strategy_name = Column(String(100), nullable=False)
    strategy_type = Column(String(50))
    perspective = Column(String(50))
    symbols = Column(Text)               # comma-separated
    period_days = Column(Integer)
    initial_capital = Column(Float)
    final_capital = Column(Float)
    total_return_pct = Column(Float)
    annualized_return_pct = Column(Float)
    max_drawdown_pct = Column(Float)
    sharpe_ratio = Column(Float)
    sortino_ratio = Column(Float)
    win_rate_pct = Column(Float)
    total_trades = Column(Integer)
    params = Column(JSON)                # strategy parameters used
    full_result = Column(JSON)           # complete result JSON
    created_at = Column(DateTime, default=datetime.utcnow)
    name = Column(String(200))           # user-given name for this run
