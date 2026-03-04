"""Portfolio router"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import List, Optional
import uuid
from core.database import get_db
from core.auth import get_current_user
from models.user import User
from models.portfolio import Portfolio, PortfolioHolding

router = APIRouter()

class HoldingSchema(BaseModel):
    symbol: str
    exchange: str = "NSE"
    weight_pct: float
    notes: Optional[str] = None

class PortfolioRequest(BaseModel):
    name: str
    description: Optional[str] = None
    portfolio_type: str = "MODEL"
    holdings: List[HoldingSchema] = []

@router.post("/")
async def create_portfolio(req: PortfolioRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    portfolio = Portfolio(id=uuid.uuid4(), user_id=current_user.id, name=req.name, description=req.description, portfolio_type=req.portfolio_type)
    db.add(portfolio)
    await db.flush()
    for h in req.holdings:
        db.add(PortfolioHolding(id=uuid.uuid4(), portfolio_id=portfolio.id, symbol=h.symbol, exchange=h.exchange, weight_pct=h.weight_pct, notes=h.notes))
    return {"id": str(portfolio.id), "name": portfolio.name}

@router.get("/")
async def list_portfolios(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Portfolio).where(Portfolio.user_id == current_user.id).order_by(Portfolio.created_at.desc()))
    portfolios = result.scalars().all()
    out = []
    for p in portfolios:
        holdings = await db.execute(select(PortfolioHolding).where(PortfolioHolding.portfolio_id == p.id))
        out.append({"id": str(p.id), "name": p.name, "type": p.portfolio_type, "holdings": [{"symbol": h.symbol, "weight_pct": h.weight_pct} for h in holdings.scalars()], "created_at": p.created_at.isoformat()})
    return out

@router.delete("/{portfolio_id}")
async def delete_portfolio(portfolio_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == current_user.id))
    portfolio = result.scalar_one_or_none()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    await db.delete(portfolio)
    return {"message": "Deleted"}
