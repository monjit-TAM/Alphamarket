"""Paper Trading models"""
from sqlalchemy import Column, String, Float, Integer, ForeignKey, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base
from datetime import datetime
import uuid


class PaperAccount(Base):
    __tablename__ = "paper_accounts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), unique=True, nullable=False)
    cash_balance = Column(Float, default=1_000_000.0)
    initial_capital = Column(Float, default=1_000_000.0)
    total_pnl = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PaperPosition(Base):
    __tablename__ = "paper_positions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    symbol = Column(String(50), nullable=False)
    exchange = Column(String(10), default="NSE")
    quantity = Column(Integer, default=0)
    avg_price = Column(Float, default=0.0)
    product = Column(String(10), default="CNC")
    opened_at = Column(DateTime, default=datetime.utcnow)


class PaperOrder(Base):
    __tablename__ = "paper_orders"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    symbol = Column(String(50), nullable=False)
    exchange = Column(String(10), default="NSE")
    transaction_type = Column(String(10), nullable=False)  # BUY / SELL
    quantity = Column(Integer, nullable=False)
    price = Column(Float, nullable=False)
    order_type = Column(String(20), default="MARKET")
    status = Column(String(20), default="COMPLETE")
    pnl = Column(Float, default=0.0)
    strategy_tag = Column(String(100))
    notes = Column(Text)
    executed_at = Column(DateTime, default=datetime.utcnow)
