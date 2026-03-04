"""
AlphaForge — Groww API Service
Full integration with Groww Trading API for NSE/BSE/MCX
Handles: Authentication, Instruments, Live Data, Historical Data,
         Orders (Paper + Live), WebSocket Price Feed
"""

import asyncio
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import pandas as pd

from core.config import settings
from core.redis_client import redis_client

logger = logging.getLogger(__name__)


class GrowwService:
    """
    Wraps the Groww Python SDK with async support and caching.
    SDK docs: https://groww.in/trade-api/docs/python-sdk
    """

    def __init__(self):
        self.groww = None          # GrowwAPI instance
        self.access_token = None
        self._running = False
        self._price_task = None
        self._instruments_cache: Dict[str, dict] = {}
        self._client_strategy_map: Dict[str, dict] = {}  # client_id -> strategy config

    # ── Authentication ────────────────────────────────────────────────────
    async def authenticate(self):
        """
        Authenticate with Groww API.
        Supports both API Key/Secret and TOTP flows.
        Set GROWW_AUTH_FLOW in your .env to "apikey" or "totp"
        """
        try:
            from growwapi import GrowwAPI
            import pyotp

            if settings.GROWW_AUTH_FLOW == "totp":
                # TOTP Flow — no daily expiry issues
                totp_gen = pyotp.TOTP(settings.GROWW_TOTP_SECRET)
                totp = totp_gen.now()
                self.access_token = GrowwAPI.get_access_token(
                    api_key=settings.GROWW_API_KEY,
                    totp=totp,
                )
            else:
                # API Key + Secret flow (requires daily re-auth approval)
                self.access_token = GrowwAPI.get_access_token(
                    api_key=settings.GROWW_API_KEY,
                    secret=settings.GROWW_API_SECRET,
                )

            self.groww = GrowwAPI(self.access_token)
            logger.info("✅ Groww API authenticated successfully")
            return True

        except ImportError:
            logger.warning("growwapi package not installed. Run: pip install growwapi pyotp")
            logger.info("⚠️  Running in SIMULATION MODE (no live data)")
            self._simulation_mode = True
            return False
        except Exception as e:
            logger.error(f"Groww authentication failed: {e}")
            self._simulation_mode = True
            return False

    # ── Instruments (All NSE/BSE/MCX Stocks) ─────────────────────────────
    async def get_all_instruments(self) -> List[dict]:
        """
        Fetch the complete instrument list from Groww.
        Returns 4000+ stocks across NSE, BSE, MCX.
        Results are cached in Redis for 24 hours.
        """
        # Try Redis cache first
        cached = await redis_client.get("instruments:all")
        if cached:
            return cached

        if not self.groww:
            await self.authenticate()

        try:
            # Groww SDK: fetch instruments for each exchange
            instruments = []
            for exchange in ["NSE", "BSE", "MCX"]:
                try:
                    data = self.groww.get_instruments(exchange=exchange)
                    if data:
                        for item in data:
                            instruments.append({
                                "symbol":        item.get("trading_symbol", ""),
                                "name":          item.get("name", ""),
                                "exchange":      exchange,
                                "segment":       item.get("segment", "CASH"),
                                "instrument_key": item.get("instrument_key", ""),
                                "isin":          item.get("isin", ""),
                                "lot_size":      item.get("lot_size", 1),
                                "tick_size":     item.get("tick_size", 0.05),
                                "token":         item.get("instrument_token", ""),
                            })
                except Exception as e:
                    logger.warning(f"Failed to fetch {exchange} instruments: {e}")

            # Cache for 24 hours
            await redis_client.set("instruments:all", instruments, ttl=86400)
            logger.info(f"✅ Loaded {len(instruments)} instruments from Groww")
            return instruments

        except Exception as e:
            logger.error(f"get_all_instruments failed: {e}")
            return self._get_fallback_instruments()

    async def search_instruments(self, query: str, exchange: str = "ALL") -> List[dict]:
        """Search instruments by name or symbol"""
        all_instruments = await self.get_all_instruments()
        q = query.upper()
        results = [
            i for i in all_instruments
            if q in i["symbol"].upper() or q in i["name"].upper()
            and (exchange == "ALL" or i["exchange"] == exchange)
        ]
        return results[:50]

    # ── Live Market Data ──────────────────────────────────────────────────
    async def get_ltp(self, symbols: List[str], exchange: str = "NSE") -> Dict[str, float]:
        """Get Last Traded Price for multiple symbols"""
        # Check Redis cache first (prices cached for 5 seconds)
        result = {}
        uncached = []

        for symbol in symbols:
            cached = await redis_client.get_cached_price(symbol)
            if cached:
                result[symbol] = cached
            else:
                uncached.append(symbol)

        if uncached and self.groww:
            try:
                # Batch LTP fetch from Groww (max 500 per call per rate limits)
                for i in range(0, len(uncached), 500):
                    batch = uncached[i:i+500]
                    ltp_data = self.groww.get_ltp(
                        trading_symbols=batch,
                        exchange=exchange,
                        segment="CASH",
                    )
                    if ltp_data:
                        for item in ltp_data:
                            sym = item.get("trading_symbol")
                            price_info = {
                                "ltp":        item.get("ltp", 0),
                                "open":       item.get("open", 0),
                                "high":       item.get("high", 0),
                                "low":        item.get("low", 0),
                                "close":      item.get("close", 0),
                                "volume":     item.get("volume", 0),
                                "change":     item.get("change", 0),
                                "change_pct": item.get("change_percent", 0),
                                "timestamp":  datetime.utcnow().isoformat(),
                            }
                            result[sym] = price_info
                            await redis_client.cache_price(sym, price_info)
            except Exception as e:
                logger.error(f"get_ltp failed: {e}")

        return result

    async def get_quote(self, symbol: str, exchange: str = "NSE") -> Optional[dict]:
        """Get full market quote including depth"""
        if not self.groww:
            return None
        try:
            data = self.groww.get_market_quote(
                trading_symbol=symbol,
                exchange=exchange,
                segment="CASH",
            )
            return data
        except Exception as e:
            logger.error(f"get_quote failed for {symbol}: {e}")
            return None

    # ── Historical Data (for Backtesting) ────────────────────────────────
    async def get_historical_data(
        self,
        symbol: str,
        exchange: str = "NSE",
        interval: str = "1d",
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ) -> Optional[pd.DataFrame]:
        """
        Fetch OHLCV historical data for backtesting.
        interval: "1m", "5m", "15m", "30m", "1h", "1d", "1w", "1mo"
        Returns a Pandas DataFrame with columns: date, open, high, low, close, volume
        """
        cache_key = f"hist:{symbol}:{interval}:{from_date}:{to_date}"
        cached = await redis_client.get(cache_key)
        if cached:
            return pd.DataFrame(cached)

        if not from_date:
            from_date = datetime.utcnow() - timedelta(days=365 * 5)  # 5 years default
        if not to_date:
            to_date = datetime.utcnow()

        if not self.groww:
            return self._generate_simulated_ohlcv(symbol, from_date, to_date, interval)

        try:
            data = self.groww.get_historical_data(
                trading_symbol=symbol,
                exchange=exchange,
                segment="CASH",
                resolution=interval,
                from_date=int(from_date.timestamp()),
                to_date=int(to_date.timestamp()),
            )

            if not data or not data.get("candles"):
                return self._generate_simulated_ohlcv(symbol, from_date, to_date, interval)

            candles = data["candles"]
            df = pd.DataFrame(candles, columns=["timestamp", "open", "high", "low", "close", "volume"])
            df["date"] = pd.to_datetime(df["timestamp"], unit="s")
            df = df.sort_values("date").reset_index(drop=True)

            # Cache daily data for 1 hour, intraday for 60 seconds
            ttl = 3600 if interval == "1d" else 60
            await redis_client.set(cache_key, df.to_dict("records"), ttl=ttl)
            return df

        except Exception as e:
            logger.error(f"get_historical_data failed for {symbol}: {e}")
            return self._generate_simulated_ohlcv(symbol, from_date, to_date, interval)

    # ── WebSocket Price Feed ──────────────────────────────────────────────
    async def start_price_feed(self, manager):
        """
        Connect to Groww WebSocket feed and broadcast prices to all clients.
        Falls back to simulated prices if Groww WS unavailable.
        """
        self._running = True
        await self.authenticate()

        if self.groww and not getattr(self, "_simulation_mode", False):
            await self._start_groww_websocket(manager)
        else:
            logger.info("Starting simulated price feed...")
            await self._start_simulated_feed(manager)

    async def _start_groww_websocket(self, manager):
        """Connect to Groww's real WebSocket feed"""
        try:
            # Groww WebSocket SDK usage
            # The feed module handles connection and reconnection
            instruments = await self.get_all_instruments()
            # Subscribe to first 1000 instruments (Groww limit per connection)
            tokens = [i["token"] for i in instruments[:1000] if i.get("token")]

            async def on_tick(tick_data):
                """Called by Groww SDK for each price tick"""
                prices = {}
                for tick in tick_data:
                    symbol = tick.get("trading_symbol")
                    if symbol:
                        prices[symbol] = {
                            "ltp":        tick.get("ltp", 0),
                            "change_pct": tick.get("change_percent", 0),
                            "volume":     tick.get("volume", 0),
                            "high":       tick.get("high", 0),
                            "low":        tick.get("low", 0),
                            "timestamp":  datetime.utcnow().isoformat(),
                        }

                if prices:
                    await redis_client.cache_all_prices(prices)
                    await manager.broadcast_prices(prices)
                    # Also run forward test strategies
                    await self._run_forward_strategies(prices, manager)

            # Start Groww feed (SDK handles reconnection internally)
            feed = self.groww.get_feed()
            await feed.connect(tokens=tokens, on_tick=on_tick)

        except Exception as e:
            logger.error(f"Groww WebSocket failed, falling back to simulation: {e}")
            await self._start_simulated_feed(manager)

    async def _start_simulated_feed(self, manager):
        """Simulated price feed when Groww WS is unavailable (dev/testing)"""
        import random
        from services.instrument_service import NIFTY500_SYMBOLS
        prices = {sym: 500 + random.random() * 2000 for sym in NIFTY500_SYMBOLS[:200]}

        while self._running:
            batch = {}
            for sym in prices:
                change_pct = (random.random() - 0.497) * 0.8
                prices[sym] *= (1 + change_pct / 100)
                batch[sym] = {
                    "ltp":        round(prices[sym], 2),
                    "change_pct": round(change_pct, 4),
                    "volume":     random.randint(1000, 500000),
                    "timestamp":  datetime.utcnow().isoformat(),
                }
            await redis_client.cache_all_prices(batch)
            await manager.broadcast_prices(batch)
            await self._run_forward_strategies(batch, manager)
            await asyncio.sleep(1.5)  # ~40 ticks/minute

    # ── Forward Testing ───────────────────────────────────────────────────
    async def attach_strategy(self, client_id: str, config: dict, manager):
        self._client_strategy_map[client_id] = {"config": config, "manager": manager}
        logger.info(f"Strategy attached for {client_id}: {config.get('name')}")

    async def detach_strategy(self, client_id: str):
        self._client_strategy_map.pop(client_id, None)

    async def cleanup_client(self, client_id: str):
        await self.detach_strategy(client_id)

    async def _run_forward_strategies(self, prices: dict, manager):
        """Evaluate live strategies and emit signals"""
        from services.strategy_library import StrategyLibrary
        for client_id, entry in list(self._client_strategy_map.items()):
            try:
                config = entry["config"]
                signals = await StrategyLibrary.evaluate_live(config, prices)
                for signal in signals:
                    await manager.send_signal(client_id, signal)
            except Exception as e:
                logger.error(f"Forward strategy error for {client_id}: {e}")

    # ── Orders ────────────────────────────────────────────────────────────
    async def place_order(
        self,
        symbol: str,
        qty: int,
        transaction_type: str,  # "BUY" or "SELL"
        order_type: str = "MARKET",
        price: float = 0,
        exchange: str = "NSE",
        product: str = "CNC",
        paper: bool = True,
    ) -> dict:
        """
        Place order. paper=True for paper trading, paper=False for live.
        WARNING: paper=False places REAL orders with REAL money.
        """
        if paper:
            # Paper orders handled by paper_trading service, not Groww
            raise ValueError("Paper orders should use PaperTradingService")

        if not self.groww:
            raise RuntimeError("Groww API not authenticated")

        return self.groww.place_order(
            trading_symbol=symbol,
            quantity=qty,
            validity=self.groww.VALIDITY_DAY,
            exchange=self.groww.EXCHANGE_NSE if exchange == "NSE" else self.groww.EXCHANGE_BSE,
            segment=self.groww.SEGMENT_CASH,
            product=self.groww.PRODUCT_CNC if product == "CNC" else self.groww.PRODUCT_MIS,
            order_type=self.groww.ORDER_TYPE_MARKET if order_type == "MARKET" else self.groww.ORDER_TYPE_LIMIT,
            transaction_type=self.groww.TRANSACTION_TYPE_BUY if transaction_type == "BUY" else self.groww.TRANSACTION_TYPE_SELL,
            price=price if order_type == "LIMIT" else 0,
        )

    async def stop(self):
        self._running = False

    # ── Fallback / Simulation Helpers ──────────────────────────────────────
    def _get_fallback_instruments(self) -> List[dict]:
        """Return a static list of major Indian stocks when API is unavailable"""
        from services.instrument_service import FALLBACK_INSTRUMENTS
        return FALLBACK_INSTRUMENTS

    def _generate_simulated_ohlcv(
        self, symbol: str, from_date: datetime, to_date: datetime, interval: str
    ) -> pd.DataFrame:
        """Generate realistic simulated OHLCV data for backtesting"""
        import random
        import numpy as np
        days = max((to_date - from_date).days, 1)
        n = days if interval == "1d" else min(days * 78, 5000)  # ~78 candles/day for 5min

        dates = pd.date_range(start=from_date, periods=n, freq="B" if interval == "1d" else "5min")
        price = 100 + random.random() * 2000
        prices = [price]
        for _ in range(n - 1):
            drift = 0.0002
            vol = 0.015
            ret = drift + vol * np.random.randn()
            prices.append(max(prices[-1] * (1 + ret), 1))

        opens, highs, lows, closes, vols = [], [], [], [], []
        for p in prices:
            spread = p * 0.008
            o = p + (random.random() - 0.5) * spread
            c = p + (random.random() - 0.5) * spread
            opens.append(round(o, 2))
            closes.append(round(c, 2))
            highs.append(round(max(o, c) + random.random() * spread, 2))
            lows.append(round(min(o, c) - random.random() * spread, 2))
            vols.append(random.randint(10000, 5000000))

        return pd.DataFrame({
            "date": dates[:n], "open": opens, "high": highs,
            "low": lows, "close": closes, "volume": vols,
        })
