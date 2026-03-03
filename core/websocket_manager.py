"""
AlphaForge — WebSocket Connection Manager
Manages real-time connections for price feeds and signal broadcasting
"""

from fastapi import WebSocket
from typing import Dict, Set
import json
import logging
import asyncio

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        # client_id -> WebSocket (price feed connections)
        self.price_connections: Dict[str, WebSocket] = {}
        # client_id -> WebSocket (signal connections)
        self.signal_connections: Dict[str, WebSocket] = {}
        # symbol -> set of client_ids subscribed
        self.symbol_subscribers: Dict[str, Set[str]] = {}

    # ── Price Feed ─────────────────────────────────────────────────────────
    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.price_connections[client_id] = websocket
        logger.info(f"Price WS connected: {client_id} ({len(self.price_connections)} total)")

    def disconnect(self, client_id: str):
        self.price_connections.pop(client_id, None)
        # Remove from all subscriptions
        for subs in self.symbol_subscribers.values():
            subs.discard(client_id)
        logger.info(f"Price WS disconnected: {client_id}")

    async def broadcast_prices(self, prices: dict):
        """Broadcast prices only to clients subscribed to those symbols"""
        if not self.price_connections:
            return

        # Build per-client payloads based on subscriptions
        client_payloads: Dict[str, dict] = {}
        for symbol, data in prices.items():
            subscribers = self.symbol_subscribers.get(symbol, set())
            # Also send to clients subscribed to "ALL"
            all_subs = self.symbol_subscribers.get("__ALL__", set())
            targets = subscribers | all_subs
            for client_id in targets:
                if client_id not in client_payloads:
                    client_payloads[client_id] = {}
                client_payloads[client_id][symbol] = data

        # Send concurrently
        tasks = []
        for client_id, payload in client_payloads.items():
            ws = self.price_connections.get(client_id)
            if ws:
                tasks.append(self._safe_send(ws, client_id, {"type": "prices", "data": payload}))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def send_to_client(self, client_id: str, message: dict):
        ws = self.price_connections.get(client_id)
        if ws:
            await self._safe_send(ws, client_id, message)

    # ── Signals ────────────────────────────────────────────────────────────
    async def connect_signals(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.signal_connections[client_id] = websocket
        logger.info(f"Signal WS connected: {client_id}")

    def disconnect_signals(self, client_id: str):
        self.signal_connections.pop(client_id, None)

    async def send_signal(self, client_id: str, signal: dict):
        ws = self.signal_connections.get(client_id)
        if ws:
            await self._safe_send(ws, client_id, {"type": "signal", "data": signal})

    async def broadcast_signal(self, signal: dict):
        """Broadcast a signal to all connected signal clients"""
        tasks = [
            self._safe_send(ws, cid, {"type": "signal", "data": signal})
            for cid, ws in self.signal_connections.items()
        ]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    # ── Subscription Management ────────────────────────────────────────────
    def subscribe(self, client_id: str, symbols: list):
        for symbol in symbols:
            if symbol not in self.symbol_subscribers:
                self.symbol_subscribers[symbol] = set()
            self.symbol_subscribers[symbol].add(client_id)

    def unsubscribe(self, client_id: str, symbols: list):
        for symbol in symbols:
            if symbol in self.symbol_subscribers:
                self.symbol_subscribers[symbol].discard(client_id)

    def subscribe_all(self, client_id: str):
        """Subscribe client to all symbols (useful for screener/dashboard)"""
        if "__ALL__" not in self.symbol_subscribers:
            self.symbol_subscribers["__ALL__"] = set()
        self.symbol_subscribers["__ALL__"].add(client_id)

    # ── Helpers ────────────────────────────────────────────────────────────
    async def _safe_send(self, ws: WebSocket, client_id: str, message: dict):
        try:
            await ws.send_json(message)
        except Exception as e:
            logger.warning(f"Failed to send to {client_id}: {e}")
            self.disconnect(client_id)

    @property
    def total_connections(self) -> int:
        return len(self.price_connections) + len(self.signal_connections)
