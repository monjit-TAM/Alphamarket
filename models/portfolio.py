"""Portfolio models"""
from sqlalchemy import Column, String, Float, Integer, ForeignKey, DateTime, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base
from datetime import datetime
import uuid


class Portfolio(Base):
    __tablename__ = "portfolios"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    portfolio_type = Column(String(50), default="MODEL")  # MODEL, BASKET, WATCHLIST
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PortfolioHolding(Base):
    __tablename__ = "portfolio_holdings"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    portfolio_id = Column(UUID(as_uuid=True), ForeignKey("portfolios.id"), nullable=False)
    symbol = Column(String(50), nullable=False)
    exchange = Column(String(10), default="NSE")
    weight_pct = Column(Float, default=0)
    notes = Column(Text)
