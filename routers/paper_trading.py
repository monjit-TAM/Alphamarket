"""
AlphaForge — Paper Trading Router
Full paper trading with persistent P&L tracking per user.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

from core.database import get_db
from core.auth import get_current_user
from models.user import User
from models.paper_trade import PaperAccount, PaperPosition, PaperOrder
from services.groww_service import GrowwService

router = APIRouter()
_groww = GrowwService()


class OrderRequest(BaseModel):
    symbol: str
    exchange: str = "NSE"
    transaction_type: str           # BUY | SELL
    quantity: int
    order_type: str = "MARKET"      # MARKET | LIMIT
    price: Optional[float] = None   # Required for LIMIT orders
    product: str = "CNC"            # CNC | MIS
    strategy_tag: Optional[str] = None
    notes: Optional[str] = None


async def get_or_create_account(user_id, db: AsyncSession) -> PaperAccount:
    result = await db.execute(select(PaperAccount).where(PaperAccount.user_id == user_id))
    account = result.scalar_one_or_none()
    if not account:
        account = PaperAccount(id=uuid.uuid4(), user_id=user_id)
        db.add(account)
        await db.flush()
    return account


@router.get("/account")
async def get_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account = await get_or_create_account(current_user.id, db)
    positions = await db.execute(
        select(PaperPosition).where(PaperPosition.user_id == current_user.id, PaperPosition.quantity > 0)
    )
    pos_list = positions.scalars().all()

    # Get live prices for open positions
    symbols = [p.symbol for p in pos_list]
    live_prices = await _groww.get_ltp(symbols) if symbols else {}

    positions_data = []
    unrealized_pnl = 0
    for p in pos_list:
        ltp = live_prices.get(p.symbol, {}).get("ltp", p.avg_price)
        pnl = (ltp - p.avg_price) * p.quantity
        pnl_pct = (ltp / p.avg_price - 1) * 100
        unrealized_pnl += pnl
        positions_data.append({
            "symbol": p.symbol, "exchange": p.exchange, "quantity": p.quantity,
            "avg_price": p.avg_price, "ltp": ltp, "pnl": round(pnl, 2),
            "pnl_pct": round(pnl_pct, 3), "current_value": round(ltp * p.quantity, 2),
            "invested": round(p.avg_price * p.quantity, 2),
        })

    portfolio_value = sum(p["current_value"] for p in positions_data)
    total_value = account.cash_balance + portfolio_value

    return {
        "cash_balance": account.cash_balance,
        "portfolio_value": round(portfolio_value, 2),
        "total_value": round(total_value, 2),
        "initial_capital": account.initial_capital,
        "realized_pnl": round(account.total_pnl, 2),
        "unrealized_pnl": round(unrealized_pnl, 2),
        "total_pnl": round(account.total_pnl + unrealized_pnl, 2),
        "total_return_pct": round((total_value / account.initial_capital - 1) * 100, 3),
        "positions": positions_data,
    }


@router.post("/order")
async def place_order(
    req: OrderRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account = await get_or_create_account(current_user.id, db)

    # Get current price
    prices = await _groww.get_ltp([req.symbol], req.exchange)
    market_price = prices.get(req.symbol, {}).get("ltp")
    if not market_price:
        raise HTTPException(status_code=404, detail=f"Cannot fetch price for {req.symbol}")

    exec_price = req.price if req.order_type == "LIMIT" and req.price else market_price

    if req.transaction_type == "BUY":
        cost = exec_price * req.quantity * 1.0003  # 0.03% commission
        if cost > account.cash_balance:
            raise HTTPException(status_code=400, detail=f"Insufficient funds. Need ₹{cost:.2f}, have ₹{account.cash_balance:.2f}")

        account.cash_balance -= cost

        # Update position
        pos_result = await db.execute(
            select(PaperPosition).where(
                PaperPosition.user_id == current_user.id,
                PaperPosition.symbol == req.symbol,
            )
        )
        pos = pos_result.scalar_one_or_none()
        if pos:
            total_qty = pos.quantity + req.quantity
            pos.avg_price = (pos.avg_price * pos.quantity + exec_price * req.quantity) / total_qty
            pos.quantity = total_qty
        else:
            pos = PaperPosition(
                id=uuid.uuid4(), user_id=current_user.id,
                symbol=req.symbol, exchange=req.exchange,
                quantity=req.quantity, avg_price=exec_price, product=req.product,
            )
            db.add(pos)

        order_pnl = 0

    elif req.transaction_type == "SELL":
        pos_result = await db.execute(
            select(PaperPosition).where(
                PaperPosition.user_id == current_user.id,
                PaperPosition.symbol == req.symbol,
            )
        )
        pos = pos_result.scalar_one_or_none()
        if not pos or pos.quantity < req.quantity:
            raise HTTPException(status_code=400, detail=f"Insufficient holdings. Have {pos.quantity if pos else 0} shares of {req.symbol}")

        proceeds = exec_price * req.quantity * 0.9997  # after commission
        order_pnl = (exec_price - pos.avg_price) * req.quantity
        account.cash_balance += proceeds
        account.total_pnl += order_pnl
        pos.quantity -= req.quantity

    else:
        raise HTTPException(status_code=400, detail="transaction_type must be BUY or SELL")

    # Record the order
    order = PaperOrder(
        id=uuid.uuid4(), user_id=current_user.id,
        symbol=req.symbol, exchange=req.exchange,
        transaction_type=req.transaction_type,
        quantity=req.quantity, price=exec_price,
        order_type=req.order_type, status="COMPLETE",
        pnl=round(order_pnl, 2),
        strategy_tag=req.strategy_tag, notes=req.notes,
    )
    db.add(order)

    return {
        "status": "COMPLETE",
        "symbol": req.symbol,
        "transaction_type": req.transaction_type,
        "quantity": req.quantity,
        "executed_price": round(exec_price, 2),
        "pnl": round(order_pnl, 2),
        "cash_balance": round(account.cash_balance, 2),
    }


@router.get("/orders")
async def get_orders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = 100,
):
    result = await db.execute(
        select(PaperOrder)
        .where(PaperOrder.user_id == current_user.id)
        .order_by(PaperOrder.executed_at.desc())
        .limit(limit)
    )
    orders = result.scalars().all()
    return [
        {
            "id": str(o.id), "symbol": o.symbol, "exchange": o.exchange,
            "transaction_type": o.transaction_type, "quantity": o.quantity,
            "price": o.price, "pnl": o.pnl, "strategy_tag": o.strategy_tag,
            "executed_at": o.executed_at.isoformat(),
        }
        for o in orders
    ]


@router.post("/reset")
async def reset_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reset paper trading account to initial capital"""
    account = await get_or_create_account(current_user.id, db)
    account.cash_balance = account.initial_capital
    account.total_pnl = 0

    # Delete all positions
    positions = await db.execute(select(PaperPosition).where(PaperPosition.user_id == current_user.id))
    for p in positions.scalars():
        await db.delete(p)

    return {"message": "Paper trading account reset successfully", "cash_balance": account.initial_capital}
