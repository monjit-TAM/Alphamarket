"""Forward Testing router"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from core.auth import get_current_user
from models.user import User

router = APIRouter()

class ForwardTestConfig(BaseModel):
    strategy: str
    symbols: List[str]
    exchange: str = "NSE"
    params: Dict[str, Any] = {}
    name: Optional[str] = None

@router.get("/strategies")
async def list_forward_strategies(current_user: User = Depends(get_current_user)):
    return {
        "strategies": [
            {"id": "sma_crossover", "name": "SMA Crossover"},
            {"id": "rsi_mean_reversion", "name": "RSI Mean Reversion"},
            {"id": "macd_crossover", "name": "MACD Crossover"},
            {"id": "momentum", "name": "Momentum"},
            {"id": "quantamental", "name": "Quantamental"},
            {"id": "supertrend", "name": "Supertrend"},
        ]
    }

@router.post("/start")
async def start_forward_test(config: ForwardTestConfig, current_user: User = Depends(get_current_user)):
    """
    Initiates a forward test. Connect via WebSocket /ws/signals/{client_id}
    and send {"action": "start_strategy", "config": {...}} to begin receiving signals.
    The WebSocket is the primary interface for real-time forward testing.
    """
    return {
        "message": "Connect to /ws/signals/{client_id} with your JWT token, then send start_strategy action",
        "config": config.dict(),
    }
