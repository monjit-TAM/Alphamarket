"""
AlphaForge — Redis Client (Price Cache + Rate Limiting + Sessions)
"""

import json
import logging
from typing import Any, Optional
import redis.asyncio as aioredis
from core.config import settings

logger = logging.getLogger(__name__)


class RedisClient:
    def __init__(self):
        self.client: Optional[aioredis.Redis] = None

    async def connect(self):
        self.client = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=20,
        )
        await self.client.ping()
        logger.info("✅ Redis connected")

    async def disconnect(self):
        if self.client:
            await self.client.aclose()

    async def get(self, key: str) -> Optional[Any]:
        val = await self.client.get(key)
        if val is None:
            return None
        try:
            return json.loads(val)
        except json.JSONDecodeError:
            return val

    async def set(self, key: str, value: Any, ttl: int = 300):
        serialized = json.dumps(value) if not isinstance(value, str) else value
        await self.client.setex(key, ttl, serialized)

    async def delete(self, key: str):
        await self.client.delete(key)

    async def publish(self, channel: str, message: Any):
        serialized = json.dumps(message) if not isinstance(message, str) else message
        await self.client.publish(channel, serialized)

    async def get_pubsub(self):
        return self.client.pubsub()

    # ── Price Cache ────────────────────────────────────────────────────────
    async def cache_price(self, symbol: str, price_data: dict):
        await self.set(f"price:{symbol}", price_data, ttl=10)

    async def get_cached_price(self, symbol: str) -> Optional[dict]:
        return await self.get(f"price:{symbol}")

    async def cache_all_prices(self, prices: dict):
        """Bulk cache all prices using pipeline for performance"""
        pipe = self.client.pipeline()
        for symbol, data in prices.items():
            pipe.setex(f"price:{symbol}", 10, json.dumps(data))
        await pipe.execute()

    # ── Rate Limiting ──────────────────────────────────────────────────────
    async def check_rate_limit(self, key: str, limit: int, window: int = 60) -> bool:
        """Returns True if request is allowed, False if rate limited"""
        count = await self.client.incr(f"rl:{key}")
        if count == 1:
            await self.client.expire(f"rl:{key}", window)
        return count <= limit

    # ── Session Store ──────────────────────────────────────────────────────
    async def store_session(self, session_id: str, data: dict, ttl: int = 86400):
        await self.set(f"session:{session_id}", data, ttl=ttl)

    async def get_session(self, session_id: str) -> Optional[dict]:
        return await self.get(f"session:{session_id}")


redis_client = RedisClient()
