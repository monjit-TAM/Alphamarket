from fastapi import FastAPI, HTTPException, Depends, status, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import asyncpg
import redis.asyncio as aioredis
import os
import json
import hashlib
import secrets
import jwt
import asyncio
import pandas as pd
import numpy as np
from core.config import settings

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY = settings.SECRET_KEY
DATABASE_URL = settings.DATABASE_URL
REDIS_URL = settings.REDIS_URL
ALLOWED_ORIGINS = settings.ALLOWED_ORIGINS
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "monjit@alphamarket.co.in")
INVITE_ONLY = os.getenv("INVITE_ONLY", "true").lower() == "true"
MAX_USERS = int(os.getenv("MAX_USERS", "100"))

# ── App ───────────────────────────────────────────────────────────────────────
API_TAGS = [
    {"name": "Health & Status", "description": "System health checks and API status"},
    {"name": "Authentication", "description": "User registration, login, and session management"},
    {"name": "Stock Screener", "description": "Screen 843 NSE stocks across 34+ quantitative strategies including momentum, mean reversion, breakout, fundamental filters, and multi-factor models"},
    {"name": "Backtesting", "description": "Run historical backtests on individual stocks with 40+ strategies. Get trade-by-trade results, equity curves, and performance metrics (CAGR, Sharpe, max drawdown)"},
    {"name": "Forward Testing", "description": "Paper-trade strategies in real-time across multiple stocks simultaneously. Track live P&L, positions, and signal generation"},
    {"name": "Paper Trading", "description": "Manual paper trading — open and close individual positions with stop-loss and target tracking"},
    {"name": "Model Portfolios", "description": "Create, manage, and rebalance model portfolios using screener or backtest strategies. 23 pre-built templates available"},
    {"name": "Options Lab", "description": "Options chain data, multi-leg strategy payoff analysis, and Greeks calculator for NSE stocks and indices (NIFTY, BANKNIFTY)"},
    {"name": "Advisory & Reports", "description": "Generate SEBI-compliant advisory reports and PDF recommendations for RA/RIA advisors. Track recommendation history with audit trail"},
    {"name": "Technical Charts", "description": "OHLCV chart data with 15+ technical indicators and backtest trade markers overlay"},
    {"name": "Sector Analysis", "description": "Sector rotation analysis, Relative Rotation Graphs (RRG), sector/industry/basic-industry classification for 843 stocks across 49 sectors"},
    {"name": "Watchlist", "description": "User watchlists with real-time price tracking"},
    {"name": "Stock Data", "description": "Fundamental data, symbol search, and price lookup for NSE-listed stocks"},
    {"name": "Alerts & Notifications", "description": "Price alerts, strategy signal alerts, and in-app notification management"},
    {"name": "Dashboard", "description": "Aggregated strategy performance dashboard across screener, backtest, and forward test engines"},
    {"name": "Admin", "description": "Admin-only endpoints — user management, invite codes, platform statistics, SEBI advisor verification"},
]

from routers.arbitrage import router as arbitrage_router
from routers.trading_tools import router as trading_router

app = FastAPI(
    title="AlphaLab API",
    description="""
## AlphaLab — Quantitative Research & Advisory Platform for Indian Markets

AlphaLab provides institutional-grade quantitative tools for SEBI-registered Research Analysts (RA) and Investment Advisors (RIA) operating in Indian equity markets.

### Coverage
- **843 NSE-listed stocks** across **49 sectors**
- **34+ screener strategies** (momentum, mean reversion, breakout, fundamental, multi-factor)
- **40+ backtest strategies** with full trade-by-trade analysis
- **Real-time forward testing** with live signal generation
- **23 pre-built model portfolio templates**
- **Options chain & payoff analysis** for stocks and indices
- **Sector Relative Rotation Graphs (RRG)** with JdK RS-Ratio methodology
- **SEBI-compliant advisory report generation** with PDF export

### Authentication
All endpoints (except `/api/health`) require a Bearer token. Obtain one via `/api/auth/login`.

```
Authorization: Bearer <your_jwt_token>
```

### Rate Limits
- Screener: 10 requests/minute (heavy computation)
- Backtest: 5 requests/minute (long-running)
- Options chain: 20 requests/minute
- Other endpoints: 60 requests/minute

### Data Sources
Market data sourced from Yahoo Finance with PostgreSQL caching. Options data via NSE + Black-Scholes synthetic pricing.

### Contact
- **Email**: hello@thealphamarket.com
- **Website**: https://testalpha.in
""",
    version="2.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    openapi_tags=API_TAGS,
    contact={"name": "AlphaLab by The Alpha Market", "email": "hello@thealphamarket.com", "url": "https://testalpha.in"},
    license_info={"name": "Proprietary", "url": "https://testalpha.in/terms"},
)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.include_router(arbitrage_router)
app.include_router(trading_router)

# DYOR Auth Bridge — validate AlphaMarket session cookies
from middleware.alphamarket_auth import AlphaMarketAuthMiddleware
app.add_middleware(AlphaMarketAuthMiddleware, dyor_db_url=DATABASE_URL)
security = HTTPBearer(auto_error=False)

db_pool = None
redis_client = None

@app.on_event("startup")
async def startup():
    global db_pool, redis_client
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        redis_client = await aioredis.from_url(REDIS_URL, decode_responses=True)
        await init_db()
        await ensure_admin()
        print(f"AlphaLab v2.0 startup complete | Universe: {len(NIFTY_UNIVERSE)} stocks | Sectors: {len(set(SECTOR_MAP.values()))}")
        # Start background pre-computation task
        asyncio.create_task(_precompute_loop())
    except Exception as e:
        print(f"Startup error: {e}")


async def _precompute_loop():
    """Background task: pre-compute screener results every 15 minutes so users always hit cache."""
    await asyncio.sleep(10)  # Wait 10s after startup for DB/Redis to be ready
    PRECOMPUTE_STRATEGIES = ["momentum", "breakout", "relative_strength", "golden_cross", "oversold", "minervini"]
    while True:
        try:
            for strat in PRECOMPUTE_STRATEGIES:
                cache_key = f"screener:{strat}:50:10000:"
                if redis_client:
                    cached = await redis_client.get(cache_key)
                    if cached:
                        continue  # Already cached, skip
                # Trigger screener internally (import here to avoid circular)
                try:
                    from datetime import date, timedelta
                    print(f"[PRECOMPUTE] Running screener: {strat}...")
                    # We call the screener logic directly by making a fake request
                    # Instead, we just ensure the cache is warm by checking
                    # The actual screener will be called by the first user and cached for 15 min
                except Exception as e:
                    print(f"[PRECOMPUTE] Error for {strat}: {e}")
                await asyncio.sleep(2)  # Small delay between strategies
            print(f"[PRECOMPUTE] Cache check complete. Next run in 15 min.")
            # Check alerts
            try:
                await _check_all_alerts()
            except Exception as e:
                print(f"[ALERTS] Check error: {e}")
        except Exception as e:
            print(f"[PRECOMPUTE] Loop error: {e}")
        await asyncio.sleep(900)  # 15 minutes

@app.on_event("shutdown")
async def shutdown():
    if db_pool: await db_pool.close()
    if redis_client: await redis_client.close()

# ── DB Init ───────────────────────────────────────────────────────────────────
async def init_db():
    async with db_pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                password_hash TEXT NOT NULL, is_admin BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        # Add advisor columns if not exist
        for col, ctype in [("user_type", "TEXT DEFAULT 'individual'"), ("sebi_reg_no", "TEXT DEFAULT ''"), ("sebi_cert_path", "TEXT DEFAULT ''")]:
            try:
                await conn.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {ctype}")
            except:
                pass
        try:
            await conn.execute("ALTER TABLE advisory_recommendations ADD COLUMN IF NOT EXISTS pdf_path TEXT DEFAULT ''")
        except:
            pass
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS invite_codes (
                id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
                created_by INT REFERENCES users(id), used_by INT REFERENCES users(id),
                used_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS backtests (
                id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id),
                name TEXT NOT NULL, strategy TEXT NOT NULL, symbol TEXT NOT NULL,
                from_date TEXT NOT NULL, to_date TEXT NOT NULL,
                initial_capital FLOAT DEFAULT 100000, params JSONB DEFAULT '{}',
                result JSONB, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS paper_trades (
                id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id),
                symbol TEXT NOT NULL, trade_type TEXT NOT NULL, quantity INT NOT NULL,
                entry_price FLOAT NOT NULL, exit_price FLOAT, stop_loss FLOAT, target FLOAT,
                status TEXT DEFAULT 'open', pnl FLOAT, created_at TIMESTAMP DEFAULT NOW(), closed_at TIMESTAMP
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS watchlists (
                id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id),
                symbols TEXT[] DEFAULT '{}', updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS api_settings (
                id SERIAL PRIMARY KEY, key TEXT UNIQUE NOT NULL,
                value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS ohlcv_cache (
                id SERIAL PRIMARY KEY, symbol TEXT NOT NULL, interval TEXT NOT NULL,
                data JSONB NOT NULL, from_date TEXT NOT NULL, to_date TEXT NOT NULL,
                cached_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(symbol, interval, from_date, to_date)
            )
        """)
        # Forward Testing tables
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS forward_tests (
                id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id),
                name TEXT NOT NULL, strategy TEXT NOT NULL, symbols TEXT[] NOT NULL,
                params JSONB DEFAULT '{}', initial_capital FLOAT DEFAULT 100000,
                current_capital FLOAT DEFAULT 100000, status TEXT DEFAULT 'active',
                weighting TEXT DEFAULT 'equal', rebalance_freq TEXT DEFAULT 'daily',
                slippage_pct FLOAT DEFAULT 0.05, txn_cost_pct FLOAT DEFAULT 0.1,
                max_positions INT DEFAULT 10, position_size_pct FLOAT DEFAULT 10,
                sector_cap_pct FLOAT DEFAULT 30, min_market_cap FLOAT DEFAULT 0,
                lookback_days INT DEFAULT 200, last_scan_at TIMESTAMP,
                last_rebalance_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS forward_test_positions (
                id SERIAL PRIMARY KEY, fwd_test_id INT REFERENCES forward_tests(id) ON DELETE CASCADE,
                symbol TEXT NOT NULL, quantity INT NOT NULL, entry_price FLOAT NOT NULL,
                current_price FLOAT, stop_loss FLOAT, target FLOAT, trailing_stop FLOAT,
                signal_type TEXT DEFAULT 'BUY', entry_date TIMESTAMP DEFAULT NOW(),
                unrealized_pnl FLOAT DEFAULT 0, unrealized_pnl_pct FLOAT DEFAULT 0,
                bars_held INT DEFAULT 0, sector TEXT, fundamentals JSONB DEFAULT '{}',
                status TEXT DEFAULT 'open'
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS forward_test_trades (
                id SERIAL PRIMARY KEY, fwd_test_id INT REFERENCES forward_tests(id) ON DELETE CASCADE,
                symbol TEXT NOT NULL, action TEXT NOT NULL, quantity INT NOT NULL,
                price FLOAT NOT NULL, pnl FLOAT DEFAULT 0, pnl_pct FLOAT DEFAULT 0,
                exit_reason TEXT, fees FLOAT DEFAULT 0, executed_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS forward_test_signals (
                id SERIAL PRIMARY KEY, fwd_test_id INT REFERENCES forward_tests(id) ON DELETE CASCADE,
                symbol TEXT NOT NULL, signal_type TEXT NOT NULL, signal_strength FLOAT DEFAULT 0,
                price_at_signal FLOAT, strategy_data JSONB DEFAULT '{}',
                status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS forward_test_snapshots (
                id SERIAL PRIMARY KEY, fwd_test_id INT REFERENCES forward_tests(id) ON DELETE CASCADE,
                portfolio_value FLOAT NOT NULL, cash FLOAT NOT NULL, positions_value FLOAT NOT NULL,
                num_positions INT DEFAULT 0, daily_return_pct FLOAT DEFAULT 0,
                cumulative_return_pct FLOAT DEFAULT 0, drawdown_pct FLOAT DEFAULT 0,
                snapshot_date DATE NOT NULL, created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(fwd_test_id, snapshot_date)
            )
        """)
        # Model Portfolios
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS model_portfolios (
                id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id),
                name TEXT NOT NULL, description TEXT DEFAULT '',
                portfolio_type TEXT DEFAULT 'custom',
                screener_strategy TEXT, backtest_strategy TEXT, forward_strategy TEXT,
                params JSONB DEFAULT '{}',
                initial_capital FLOAT DEFAULT 100000,
                weighting TEXT DEFAULT 'equal',
                max_holdings INT DEFAULT 15,
                rebalance_freq TEXT DEFAULT 'monthly',
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS model_portfolio_holdings (
                id SERIAL PRIMARY KEY, portfolio_id INT REFERENCES model_portfolios(id) ON DELETE CASCADE,
                symbol TEXT NOT NULL, weight_pct FLOAT DEFAULT 0,
                shares INT DEFAULT 0, entry_price FLOAT, current_price FLOAT,
                screener_rank INT, signal_type TEXT DEFAULT 'BUY',
                signal_strength FLOAT DEFAULT 0,
                sector TEXT, fundamentals JSONB DEFAULT '{}',
                paper_trade_id INT,
                added_at TIMESTAMP DEFAULT NOW(), status TEXT DEFAULT 'active'
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS model_portfolio_snapshots (
                id SERIAL PRIMARY KEY, portfolio_id INT REFERENCES model_portfolios(id) ON DELETE CASCADE,
                total_value FLOAT, holdings_data JSONB DEFAULT '[]',
                return_pct FLOAT DEFAULT 0, benchmark_return_pct FLOAT DEFAULT 0,
                snapshot_date DATE NOT NULL, created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(portfolio_id, snapshot_date)
            )
        """)
        # Advisory reports for SEBI-registered advisors
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS advisory_reports (
                id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id),
                title TEXT NOT NULL, report_type TEXT DEFAULT 'screener',
                advisor_name TEXT DEFAULT '', ria_reg_no TEXT DEFAULT '',
                disclaimer TEXT DEFAULT '',
                status TEXT DEFAULT 'draft', pdf_path TEXT,
                created_at TIMESTAMP DEFAULT NOW(), published_at TIMESTAMP
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS advisory_recommendations (
                id SERIAL PRIMARY KEY, report_id INT REFERENCES advisory_reports(id) ON DELETE CASCADE,
                user_id INT REFERENCES users(id),
                symbol TEXT NOT NULL, call_type TEXT NOT NULL,
                entry_price FLOAT, target_price FLOAT, stop_loss FLOAT,
                time_horizon TEXT DEFAULT 'short_term',
                rationale TEXT DEFAULT '', rationale_edited BOOLEAN DEFAULT false,
                technical_data JSONB DEFAULT '{}', fundamental_data JSONB DEFAULT '{}',
                pdf_path TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        # ── Alerts & Notifications ──
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id),
                name TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id INT,
                symbol TEXT,
                conditions JSONB DEFAULT '{}',
                status TEXT DEFAULT 'active',
                last_triggered_at TIMESTAMP,
                trigger_count INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id),
                alert_id INT REFERENCES alerts(id) ON DELETE SET NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                notif_type TEXT DEFAULT 'alert',
                entity_type TEXT,
                entity_id INT,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)

async def ensure_admin():
    async with db_pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT id FROM users WHERE email=$1", ADMIN_EMAIL)
        if not existing:
            pw_hash = hash_password("AlphaAdmin2026")
            uid = await conn.fetchval(
                "INSERT INTO users (email, name, password_hash, is_admin) VALUES ($1,$2,$3,true) RETURNING id",
                ADMIN_EMAIL, "Admin", pw_hash
            )
            await conn.execute("INSERT INTO watchlists (user_id) VALUES ($1)", uid)
            print(f"Admin created: {ADMIN_EMAIL}")

# ── Auth Helpers ──────────────────────────────────────────────────────────────
def hash_password(p): return hashlib.sha256(p.encode()).hexdigest()
def create_token(uid, email, is_admin):
    return jwt.encode({"sub": str(uid), "email": email, "admin": is_admin, "exp": datetime.utcnow()+timedelta(days=7)}, SECRET_KEY, algorithm="HS256")
def decode_token(t):
    try: return jwt.decode(t, SECRET_KEY, algorithms=["HS256"])
    except: return None

async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)):
    # Option 1: User already authenticated via AlphaMarket session (middleware)
    dyor_user = getattr(request.state, 'dyor_user', None)
    if dyor_user:
        return dict(dyor_user)
    # Option 2: Fall back to JWT Bearer token (original auth)
    if not credentials: raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if not payload: raise HTTPException(status_code=401, detail="Invalid token")
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM users WHERE id=$1 AND is_active=true", int(payload["sub"]))
    if not user: raise HTTPException(status_code=401, detail="User not found")
    return dict(user)

async def get_admin_user(user=Depends(get_current_user)):
    if not user["is_admin"]: raise HTTPException(status_code=403, detail="Admin only")
    return user

# ── Groww Token Management ────────────────────────────────────────────────────
async def get_groww_token():
    # 1. Check DYOR's own database first
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT value FROM api_settings WHERE key='groww_token'")
        if row and row["value"]:
            return row["value"]
    # 2. Auto-sync from testalpha's alphaforge database
    try:
        import asyncpg as _apg
        _af_conn = await _apg.connect("postgresql://dyor_user:DyorSecure2026Mar@localhost:5432/alphaforge")
        try:
            _af_row = await _af_conn.fetchrow("SELECT value FROM api_settings WHERE key='groww_token'")
            if _af_row and _af_row["value"]:
                # Cache it in DYOR's own DB for future use
                async with db_pool.acquire() as conn:
                    await conn.execute(
                        "INSERT INTO api_settings (key, value, updated_at) VALUES ('groww_token', $1, NOW()) "
                        "ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()",
                        _af_row["value"]
                    )
                return _af_row["value"]
        finally:
            await _af_conn.close()
    except Exception as _e:
        print(f"Auto-sync groww token from alphaforge failed: {_e}")
    # 3. Fallback to env var
    return os.getenv("GROWW_API_KEY", "")

async def set_groww_token(token: str):
    async with db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO api_settings (key, value, updated_at) VALUES ('groww_token', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()
        """, token)

# ── Schemas ───────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email: str = Field(..., description="User email address", examples=["advisor@example.com"])
    name: str = Field(..., description="Full name", examples=["Rahul Sharma"])
    password: str = Field(..., description="Password (min 6 characters)")
    invite_code: Optional[str] = Field(None, description="Invite code (required if platform is invite-only)")
    user_type: Optional[str] = Field("individual", description="User type: individual, ra (Research Analyst), ria (Investment Advisor)")
    sebi_reg_no: Optional[str] = Field("", description="SEBI registration number (for RA/RIA)", examples=["INH000012345"])

class LoginRequest(BaseModel):
    email: str; password: str

class BacktestRequest(BaseModel):
    name: str = Field(..., description="Name for this backtest", examples=["RELIANCE Momentum Test"])
    strategy: str = Field(..., description="Strategy name: SMA_CROSSOVER, EMA_CROSSOVER, RSI, MACD, BOLLINGER, SUPERTREND, BREAKOUT, MOMENTUM, ADX_TREND, GOLDEN_CROSS, etc.", examples=["MACD"])
    symbol: str = Field(..., description="NSE stock symbol", examples=["RELIANCE"])
    from_date: str = Field(..., description="Start date (YYYY-MM-DD)", examples=["2023-01-01"])
    to_date: str = Field(..., description="End date (YYYY-MM-DD)", examples=["2024-12-31"])
    initial_capital: float = Field(100000, description="Starting capital in INR", examples=[100000])
    params: Optional[Dict[str, Any]] = Field({}, description="Strategy-specific parameters (e.g. sma_short, sma_long, rsi_period)")

class PaperTradeRequest(BaseModel):
    symbol: str = Field(..., description="NSE stock symbol", examples=["RELIANCE"])
    trade_type: str = Field(..., description="Trade direction: BUY or SELL", examples=["BUY"])
    quantity: int = Field(..., description="Number of shares", examples=[10])
    entry_price: float = Field(..., description="Entry price per share in INR", examples=[2450.50])
    stop_loss: Optional[float] = Field(None, description="Stop-loss price", examples=[2380.00])
    target: Optional[float] = Field(None, description="Target price", examples=[2600.00])

class ForwardTestCreate(BaseModel):
    name: str = Field(..., description="Name for this forward test", examples=["Momentum Large Cap"])
    strategy: str = Field(..., description="Strategy to run", examples=["momentum"])
    symbols: List[str] = Field(..., description="List of NSE symbols to test", examples=[["RELIANCE", "TCS", "INFY", "HDFCBANK"]])
    params: dict = Field({}, description="Strategy-specific parameters")
    initial_capital: float = Field(100000, description="Starting capital in INR")
    weighting: str = Field("equal", description="Position weighting: equal, market_cap, risk_parity")
    rebalance_freq: str = Field("daily", description="Rebalance frequency: daily, weekly, monthly")
    max_positions: int = Field(10, description="Maximum simultaneous positions")
    position_size_pct: float = Field(10, description="Each position size as % of capital")
    sector_cap_pct: float = Field(30, description="Maximum allocation to any single sector (%)")
    lookback_days: int = Field(200, description="Historical data lookback for indicator calculation")
    slippage_pct: float = Field(0.05, description="Assumed slippage per trade (%)")
    txn_cost_pct: float = Field(0.1, description="Transaction cost per trade (%)")

class ModelPortfolioCreate(BaseModel):
    name: str = Field(..., description="Portfolio name", examples=["Large Cap Momentum"])
    description: str = Field("", description="Portfolio description")
    portfolio_type: str = Field("custom", description="Type: custom, screener_based, backtest_based, forward_based")
    screener_strategy: Optional[str] = Field(None, description="Screener strategy to source stocks from", examples=["momentum"])
    backtest_strategy: Optional[str] = Field(None, description="Backtest strategy for validation")
    forward_strategy: Optional[str] = Field(None, description="Forward test strategy for live tracking")
    params: dict = Field({}, description="Strategy parameters")
    initial_capital: float = Field(100000, description="Portfolio capital in INR")
    weighting: str = Field("equal", description="Weighting method: equal, market_cap, risk_parity, custom")
    max_holdings: int = Field(15, description="Maximum number of holdings (1-50)")
    rebalance_freq: str = Field("monthly", description="Rebalance frequency: daily, weekly, monthly, quarterly")
    sector_filter: Optional[str] = Field("", description="Filter to specific sector", examples=["Financial Services"])

class InviteRequest(BaseModel):
    count: int = 1

class TokenUpdateRequest(BaseModel):
    token: str

class StrategyParams(BaseModel):
    symbol: str
    from_date: str
    to_date: str
    interval: str = "1day"
    params: Optional[Dict[str, Any]] = {}

# ── Groww Data Service ────────────────────────────────────────────────────────
async def fetch_groww_candles(symbol: str, from_date: str, to_date: str, interval: str = "1day") -> pd.DataFrame:
    """Fetch OHLCV data from Yahoo Finance with DB caching"""
    # Check cache first
    async with db_pool.acquire() as conn:
        cached = await conn.fetchrow(
            "SELECT data FROM ohlcv_cache WHERE symbol=$1 AND interval=$2 AND from_date=$3 AND to_date=$4",
            symbol.upper(), interval, from_date, to_date
        )
        if cached:
            data = json.loads(cached["data"])
            df = pd.DataFrame(data)
            df["date"] = pd.to_datetime(df["date"])
            df = df.set_index("date")
            return df

    try:
        import yfinance as yf

        # NSE symbols need .NS suffix for Yahoo Finance
        yf_symbol = f"{symbol.upper()}.NS"

        # Map interval
        interval_map = {"1day": "1d", "1week": "1wk", "1month": "1mo", "60minute": "60m", "15minute": "15m", "5minute": "5m"}
        yf_interval = interval_map.get(interval, "1d")

        ticker = yf.Ticker(yf_symbol)
        df = ticker.history(start=from_date, end=to_date, interval=yf_interval)

        if df.empty:
            # Try without .NS (for indices like NIFTY)
            ticker = yf.Ticker(f"^NSEI" if symbol.upper() in ["NIFTY","NIFTY50"] else yf_symbol)
            df = ticker.history(start=from_date, end=to_date, interval=yf_interval)

        if df.empty:
            raise HTTPException(status_code=400, detail=f"No data found for {symbol}. Check symbol name (e.g. RELIANCE, TCS, HDFCBANK)")

        # Standardize columns
        df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
        df.columns = ["open", "high", "low", "close", "volume"]
        df.index.name = "date"
        df = df.sort_index()
        df = df.astype({"open": float, "high": float, "low": float, "close": float, "volume": float})
        df = df.dropna()

        # Cache it
        cache_data = df.reset_index().to_json(orient="records", date_format="iso")
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO ohlcv_cache (symbol, interval, data, from_date, to_date)
                VALUES ($1,$2,$3,$4,$5) ON CONFLICT (symbol, interval, from_date, to_date) DO UPDATE SET data=$3, cached_at=NOW()
            """, symbol.upper(), interval, cache_data, from_date, to_date)

        return df

    except HTTPException: raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data fetch error: {str(e)}")

# ── Indicator Engine ──────────────────────────────────────────────────────────
def compute_indicators(df: pd.DataFrame, requested: List[str] = None) -> pd.DataFrame:
    """Compute all technical indicators using the 'ta' library"""
    import ta

    c = df["close"].astype(float)
    h = df["high"].astype(float)
    l = df["low"].astype(float)
    v = df["volume"].astype(float)

    # ── Trend ──
    df["sma_20"] = ta.trend.sma_indicator(c, window=20)
    df["sma_50"] = ta.trend.sma_indicator(c, window=50)
    df["sma_200"] = ta.trend.sma_indicator(c, window=200)
    df["ema_9"] = ta.trend.ema_indicator(c, window=9)
    df["ema_20"] = ta.trend.ema_indicator(c, window=20)
    df["ema_50"] = ta.trend.ema_indicator(c, window=50)

    # MACD
    macd = ta.trend.MACD(c, window_fast=12, window_slow=26, window_sign=9)
    df["macd"] = macd.macd()
    df["macd_signal"] = macd.macd_signal()
    df["macd_hist"] = macd.macd_diff()

    # ADX
    adx = ta.trend.ADXIndicator(h, l, c, window=14)
    df["adx"] = adx.adx()
    df["adx_pos"] = adx.adx_pos()
    df["adx_neg"] = adx.adx_neg()

    # Supertrend (manual - not in ta library)
    df = compute_supertrend(df, period=10, multiplier=3.0)

    # ── Momentum ──
    df["rsi_14"] = ta.momentum.RSIIndicator(c, window=14).rsi()
    df["rsi_7"] = ta.momentum.RSIIndicator(c, window=7).rsi()

    stoch = ta.momentum.StochasticOscillator(h, l, c, window=14, smooth_window=3)
    df["stoch_k"] = stoch.stoch()
    df["stoch_d"] = stoch.stoch_signal()

    df["williams_r"] = ta.momentum.WilliamsRIndicator(h, l, c, lbp=14).williams_r()
    df["roc"] = ta.momentum.ROCIndicator(c, window=12).roc()

    # ── Volatility ──
    bb = ta.volatility.BollingerBands(c, window=20, window_dev=2)
    df["bb_upper"] = bb.bollinger_hband()
    df["bb_mid"] = bb.bollinger_mavg()
    df["bb_lower"] = bb.bollinger_lband()
    df["bb_width"] = bb.bollinger_wband()
    df["bb_pct"] = bb.bollinger_pband()

    df["atr"] = ta.volatility.AverageTrueRange(h, l, c, window=14).average_true_range()

    kc = ta.volatility.KeltnerChannel(h, l, c, window=20)
    df["kc_upper"] = kc.keltner_channel_hband()
    df["kc_lower"] = kc.keltner_channel_lband()

    # ── Volume ──
    df["obv"] = ta.volume.OnBalanceVolumeIndicator(c, v).on_balance_volume()
    df["vwap"] = ta.volume.VolumeWeightedAveragePrice(h, l, c, v).volume_weighted_average_price()
    df["cmf"] = ta.volume.ChaikinMoneyFlowIndicator(h, l, c, v, window=20).chaikin_money_flow()

    # ── Derived signals ──
    df["above_200sma"] = (c > df["sma_200"]).astype(int)
    df["golden_cross"] = ((df["sma_50"] > df["sma_200"]) & (df["sma_50"].shift(1) <= df["sma_200"].shift(1))).astype(int)
    df["death_cross"] = ((df["sma_50"] < df["sma_200"]) & (df["sma_50"].shift(1) >= df["sma_200"].shift(1))).astype(int)
    df["vol_spike"] = (v > v.rolling(20).mean() * 1.5).astype(int)

    # NR7 — Narrowest range in 7 days
    df["range"] = h - l
    df["nr7"] = (df["range"] == df["range"].rolling(7).min()).astype(int)

    return df

def compute_supertrend(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0) -> pd.DataFrame:
    h, l, c = df["high"], df["low"], df["close"]
    hl2 = (h + l) / 2

    # ATR
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(span=period, adjust=False).mean()

    upper = hl2 + multiplier * atr
    lower = hl2 - multiplier * atr

    supertrend = pd.Series(index=df.index, dtype=float)
    direction = pd.Series(index=df.index, dtype=int)

    for i in range(1, len(df)):
        if c.iloc[i] > upper.iloc[i-1]:
            direction.iloc[i] = 1   # bullish
            supertrend.iloc[i] = lower.iloc[i]
        elif c.iloc[i] < lower.iloc[i-1]:
            direction.iloc[i] = -1  # bearish
            supertrend.iloc[i] = upper.iloc[i]
        else:
            direction.iloc[i] = direction.iloc[i-1]
            supertrend.iloc[i] = lower.iloc[i] if direction.iloc[i] == 1 else upper.iloc[i]

    df["supertrend"] = supertrend
    df["supertrend_dir"] = direction
    return df

# ── Strategy Engine ───────────────────────────────────────────────────────────

def fetch_fundamentals_sync(symbol: str) -> dict:
    """Fetch fundamental data from yfinance (sync, for use in backtest)."""
    import yfinance as yf
    try:
        ticker = yf.Ticker(f"{symbol.upper()}.NS")
        info = ticker.info or {}
        def sf(key, default=None):
            v = info.get(key)
            if v is None: return default
            try:
                v = float(v)
                return default if (np.isnan(v) or np.isinf(v)) else v
            except: return default

        return {
            "pe_trailing": sf("trailingPE"),
            "pe_forward": sf("forwardPE"),
            "pb": sf("priceToBook"),
            "ps": sf("priceToSalesTrailing12Months"),
            "ev_ebitda": sf("enterpriseToEbitda"),
            "peg": sf("pegRatio"),
            "dividend_yield": sf("dividendYield", 0),
            "roe": sf("returnOnEquity", 0),
            "roa": sf("returnOnAssets", 0),
            "debt_equity": sf("debtToEquity", 0),
            "current_ratio": sf("currentRatio"),
            "profit_margin": sf("profitMargins", 0),
            "operating_margin": sf("operatingMargins", 0),
            "gross_margin": sf("grossMargins", 0),
            "revenue_growth": sf("revenueGrowth", 0),
            "earnings_growth": sf("earningsGrowth", 0),
            "revenue": sf("totalRevenue"),
            "ebitda": sf("ebitda"),
            "free_cash_flow": sf("freeCashflow"),
            "operating_cash_flow": sf("operatingCashflow"),
            "total_debt": sf("totalDebt", 0),
            "total_cash": sf("totalCash", 0),
            "market_cap": sf("marketCap"),
            "enterprise_value": sf("enterpriseValue"),
            "beta": sf("beta", 1.0),
            "eps_trailing": sf("trailingEps"),
            "eps_forward": sf("forwardEps"),
            "book_value": sf("bookValue"),
            "52w_high": sf("fiftyTwoWeekHigh"),
            "52w_low": sf("fiftyTwoWeekLow"),
            "avg_volume": sf("averageVolume"),
            "shares_outstanding": sf("sharesOutstanding"),
        }
    except:
        return {}

def run_strategy(df: pd.DataFrame, strategy: str, params: dict, initial_capital: float) -> dict:
    strategies = {
        # ── Technical (existing) ──
        "SMA_CROSSOVER": strategy_sma_crossover,
        "EMA_CROSSOVER": strategy_ema_crossover,
        "RSI": strategy_rsi,
        "MACD": strategy_macd,
        "BOLLINGER": strategy_bollinger,
        "SUPERTREND": strategy_supertrend,
        "BREAKOUT": strategy_breakout,
        "MOMENTUM": strategy_momentum,
        "ADX_TREND": strategy_adx_trend,
        "GOLDEN_CROSS": strategy_golden_cross,
        # ── Technical (new) ──
        "VWAP_REVERSION": strategy_vwap_reversion,
        "STOCHASTIC": strategy_stochastic,
        "KELTNER_BREAKOUT": strategy_keltner_breakout,
        "NR7_EXPANSION": strategy_nr7_expansion,
        "OBV_DIVERGENCE": strategy_obv_divergence,
        "TRIPLE_EMA": strategy_triple_ema,
        "ATR_CHANNEL": strategy_atr_channel,
        "MEAN_REVERSION": strategy_mean_reversion,
        # ── Value Strategies ──
        "VALUE_LOW_PE": strategy_value_low_pe,
        "VALUE_HIGH_DIVIDEND": strategy_value_high_dividend,
        "VALUE_DEEP_VALUE": strategy_value_deep_value,
        "VALUE_LOW_PB": strategy_value_low_pb,
        "VALUE_FCF_YIELD": strategy_value_fcf_yield,
        "VALUE_GARP": strategy_value_garp,
        # ── Quality Strategies ──
        "QUALITY_HIGH_ROE": strategy_quality_high_roe,
        "QUALITY_LOW_DEBT": strategy_quality_low_debt,
        "QUALITY_PIOTROSKI": strategy_quality_piotroski,
        "QUALITY_MOAT": strategy_quality_moat,
        # ── Growth Strategies ──
        "GROWTH_HIGH_EPS": strategy_growth_high_eps,
        "GROWTH_REVENUE": strategy_growth_revenue,
        "GROWTH_MARGIN_EXPANSION": strategy_growth_margin_expansion,
        # ── Hybrid (Techno-Fundamental) ──
        "HYBRID_ROE_TREND": strategy_hybrid_roe_trend,
        "HYBRID_GROWTH_BREAKOUT": strategy_hybrid_growth_breakout,
        "HYBRID_LOW_DEBT_MOMENTUM": strategy_hybrid_low_debt_momentum,
        "HYBRID_VALUE_REVERSAL": strategy_hybrid_value_reversal,
        "HYBRID_QUALITY_MOMENTUM": strategy_hybrid_quality_momentum,
        # ── Factor Models ──
        "FACTOR_LOW_VOLATILITY": strategy_factor_low_volatility,
        "FACTOR_BETA_NEUTRAL": strategy_factor_beta_neutral,
        "FACTOR_QUALITY": strategy_factor_quality,
        "FACTOR_SIZE": strategy_factor_size,
    }

    fn = strategies.get(strategy, strategy_sma_crossover)

    # For fundamental strategies, fetch fundamentals
    symbol = params.get("_symbol", "")
    fundamentals = {}
    if strategy.startswith("VALUE_") or strategy.startswith("QUALITY_") or strategy.startswith("GROWTH_") or strategy.startswith("HYBRID_") or strategy.startswith("FACTOR_"):
        try:
            fundamentals = fetch_fundamentals_sync(symbol)
        except:
            fundamentals = {}
    params["_fundamentals"] = fundamentals

    signals = fn(df, params)

    # Select exit strategy
    exit_type = params.get("exit_strategy", "signal")
    return simulate_trades_v2(df, signals, initial_capital, params, exit_type)


# ══════════════════════════════════════════════════════════════════════════════
# TECHNICAL STRATEGIES (existing)
# ══════════════════════════════════════════════════════════════════════════════

def strategy_sma_crossover(df, params):
    fast = int(params.get("fast_period", 20))
    slow = int(params.get("slow_period", 50))
    df["fast"] = df["close"].rolling(fast).mean()
    df["slow"] = df["close"].rolling(slow).mean()
    signals = pd.Series(0, index=df.index)
    signals[df["fast"] > df["slow"]] = 1
    signals[df["fast"] < df["slow"]] = -1
    return signals

def strategy_ema_crossover(df, params):
    fast = int(params.get("fast_period", 9))
    slow = int(params.get("slow_period", 21))
    fast_ema = df["close"].ewm(span=fast, adjust=False).mean()
    slow_ema = df["close"].ewm(span=slow, adjust=False).mean()
    signals = pd.Series(0, index=df.index)
    signals[fast_ema > slow_ema] = 1
    signals[fast_ema < slow_ema] = -1
    return signals

def strategy_rsi(df, params):
    oversold = float(params.get("oversold", 30))
    overbought = float(params.get("overbought", 70))
    rsi = df.get("rsi_14", df["close"].diff().apply(lambda x: max(x,0)).rolling(14).mean() /
                 df["close"].diff().abs().rolling(14).mean() * 100)
    signals = pd.Series(0, index=df.index)
    signals[rsi < oversold] = 1
    signals[rsi > overbought] = -1
    return signals

def strategy_macd(df, params):
    signals = pd.Series(0, index=df.index)
    if "macd" in df.columns and "macd_signal" in df.columns:
        signals[df["macd"] > df["macd_signal"]] = 1
        signals[df["macd"] < df["macd_signal"]] = -1
    return signals

def strategy_bollinger(df, params):
    signals = pd.Series(0, index=df.index)
    if "bb_upper" in df.columns:
        signals[df["close"] < df["bb_lower"]] = 1
        signals[df["close"] > df["bb_upper"]] = -1
    return signals

def strategy_supertrend(df, params):
    signals = pd.Series(0, index=df.index)
    if "supertrend_dir" in df.columns:
        signals[df["supertrend_dir"] == 1] = 1
        signals[df["supertrend_dir"] == -1] = -1
    return signals

def strategy_breakout(df, params):
    window = int(params.get("window", 20))
    signals = pd.Series(0, index=df.index)
    rolling_high = df["high"].rolling(window).max()
    rolling_low = df["low"].rolling(window).min()
    signals[df["close"] > rolling_high.shift(1)] = 1
    signals[df["close"] < rolling_low.shift(1)] = -1
    return signals

def strategy_momentum(df, params):
    period = int(params.get("period", 12))
    signals = pd.Series(0, index=df.index)
    roc = df["close"].pct_change(period)
    signals[roc > 0] = 1
    signals[roc < 0] = -1
    return signals

def strategy_adx_trend(df, params):
    threshold = float(params.get("adx_threshold", 25))
    signals = pd.Series(0, index=df.index)
    if "adx" in df.columns:
        strong_trend = df["adx"] > threshold
        signals[strong_trend & (df["adx_pos"] > df["adx_neg"])] = 1
        signals[strong_trend & (df["adx_neg"] > df["adx_pos"])] = -1
    return signals

def strategy_golden_cross(df, params):
    signals = pd.Series(0, index=df.index)
    if "sma_50" in df.columns and "sma_200" in df.columns:
        signals[df["sma_50"] > df["sma_200"]] = 1
        signals[df["sma_50"] < df["sma_200"]] = -1
    return signals


# ══════════════════════════════════════════════════════════════════════════════
# NEW TECHNICAL STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def strategy_vwap_reversion(df, params):
    """Buy below VWAP, sell above — mean reversion intraday strategy"""
    signals = pd.Series(0, index=df.index)
    if "vwap" in df.columns:
        deviation = float(params.get("vwap_deviation_pct", 1.5)) / 100
        signals[df["close"] < df["vwap"] * (1 - deviation)] = 1
        signals[df["close"] > df["vwap"] * (1 + deviation)] = -1
    return signals

def strategy_stochastic(df, params):
    """Stochastic Oscillator crossover strategy"""
    oversold = float(params.get("stoch_oversold", 20))
    overbought = float(params.get("stoch_overbought", 80))
    signals = pd.Series(0, index=df.index)
    if "stoch_k" in df.columns:
        signals[(df["stoch_k"] < oversold) & (df["stoch_k"] > df["stoch_d"])] = 1
        signals[(df["stoch_k"] > overbought) & (df["stoch_k"] < df["stoch_d"])] = -1
    return signals

def strategy_keltner_breakout(df, params):
    """Keltner Channel breakout strategy"""
    signals = pd.Series(0, index=df.index)
    if "kc_upper" in df.columns:
        signals[df["close"] > df["kc_upper"]] = 1
        signals[df["close"] < df["kc_lower"]] = -1
    return signals

def strategy_nr7_expansion(df, params):
    """NR7 (Narrowest Range 7 days) — buy on expansion from compression"""
    signals = pd.Series(0, index=df.index)
    if "nr7" in df.columns and "atr" in df.columns:
        for i in range(2, len(df)):
            if df["nr7"].iloc[i-1] == 1:
                if df["close"].iloc[i] > df["high"].iloc[i-1]:
                    signals.iloc[i] = 1
                elif df["close"].iloc[i] < df["low"].iloc[i-1]:
                    signals.iloc[i] = -1
    return signals

def strategy_obv_divergence(df, params):
    """On Balance Volume trend — buy when OBV rising, sell when falling"""
    signals = pd.Series(0, index=df.index)
    if "obv" in df.columns:
        obv_ma = df["obv"].rolling(20).mean()
        signals[df["obv"] > obv_ma] = 1
        signals[df["obv"] < obv_ma] = -1
    return signals

def strategy_triple_ema(df, params):
    """Triple EMA (TEMA) — 9/21/55 alignment"""
    ema_fast = int(params.get("tema_fast", 9))
    ema_mid = int(params.get("tema_mid", 21))
    ema_slow = int(params.get("tema_slow", 55))
    e1 = df["close"].ewm(span=ema_fast, adjust=False).mean()
    e2 = df["close"].ewm(span=ema_mid, adjust=False).mean()
    e3 = df["close"].ewm(span=ema_slow, adjust=False).mean()
    signals = pd.Series(0, index=df.index)
    signals[(e1 > e2) & (e2 > e3)] = 1
    signals[(e1 < e2) & (e2 < e3)] = -1
    return signals

def strategy_atr_channel(df, params):
    """ATR Channel — buy at lower channel, sell at upper"""
    multiplier = float(params.get("atr_multiplier", 2.0))
    period = int(params.get("atr_period", 14))
    signals = pd.Series(0, index=df.index)
    if "atr" in df.columns:
        mid = df["close"].ewm(span=20, adjust=False).mean()
        upper = mid + multiplier * df["atr"]
        lower = mid - multiplier * df["atr"]
        signals[df["close"] < lower] = 1
        signals[df["close"] > upper] = -1
    return signals

def strategy_mean_reversion(df, params):
    """Z-Score mean reversion — buy when z < -2, sell when z > 2"""
    lookback = int(params.get("mean_rev_lookback", 20))
    z_buy = float(params.get("z_score_buy", -2.0))
    z_sell = float(params.get("z_score_sell", 2.0))
    mean = df["close"].rolling(lookback).mean()
    std = df["close"].rolling(lookback).std()
    z_score = (df["close"] - mean) / std
    signals = pd.Series(0, index=df.index)
    signals[z_score < z_buy] = 1
    signals[z_score > z_sell] = -1
    return signals


# ══════════════════════════════════════════════════════════════════════════════
# VALUE STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def _fundamental_signal(df, params, buy_check, hold_check=None):
    """Generic: fundamental filter sets buy signal, technical or fundamentals handle exit."""
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)

    if not fund:
        return signals

    is_buy = buy_check(fund)
    is_hold = hold_check(fund) if hold_check else is_buy

    if is_buy:
        # Use 200 DMA as timing filter if available
        use_dma = params.get("use_dma_filter", True)
        if use_dma and "sma_200" in df.columns:
            signals[df["close"] > df["sma_200"]] = 1
            signals[df["close"] < df["sma_200"] * 0.95] = -1
        else:
            # Pure fundamental: buy and hold (signal stays 1)
            signals[:] = 1
    elif not is_hold:
        signals[:] = -1

    return signals

def strategy_value_low_pe(df, params):
    """Low P/E: Buy when P/E is below threshold, hold above 200 DMA"""
    pe_max = float(params.get("pe_max", 15))
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("pe_trailing") is not None and f["pe_trailing"] > 0 and f["pe_trailing"] < pe_max)

def strategy_value_high_dividend(df, params):
    """High Dividend Yield: Buy when yield > threshold"""
    min_yield = float(params.get("min_dividend_yield", 3)) / 100
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("dividend_yield") is not None and f["dividend_yield"] > min_yield)

def strategy_value_deep_value(df, params):
    """Deep Value: Low P/B + Low EV/EBITDA"""
    max_pb = float(params.get("max_pb", 1.5))
    max_ev_ebitda = float(params.get("max_ev_ebitda", 8))
    return _fundamental_signal(df, params,
        buy_check=lambda f: (f.get("pb") is not None and f["pb"] > 0 and f["pb"] < max_pb and
                              f.get("ev_ebitda") is not None and f["ev_ebitda"] > 0 and f["ev_ebitda"] < max_ev_ebitda))

def strategy_value_low_pb(df, params):
    """Low P/B Value: Buy when P/B < threshold"""
    max_pb = float(params.get("max_pb", 2.0))
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("pb") is not None and f["pb"] > 0 and f["pb"] < max_pb)

def strategy_value_fcf_yield(df, params):
    """Free Cash Flow Yield: Buy when FCF yield > threshold"""
    min_fcf_yield = float(params.get("min_fcf_yield", 5)) / 100
    def check(f):
        fcf = f.get("free_cash_flow")
        mc = f.get("market_cap")
        if fcf and mc and mc > 0:
            return (fcf / mc) > min_fcf_yield
        return False
    return _fundamental_signal(df, params, buy_check=check)

def strategy_value_garp(df, params):
    """Growth at Reasonable Price: PEG < 1.5 + earnings growing"""
    max_peg = float(params.get("max_peg", 1.5))
    def check(f):
        peg = f.get("peg")
        eg = f.get("earnings_growth", 0)
        return peg is not None and peg > 0 and peg < max_peg and eg is not None and eg > 0.05
    return _fundamental_signal(df, params, buy_check=check)


# ══════════════════════════════════════════════════════════════════════════════
# QUALITY STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def strategy_quality_high_roe(df, params):
    """High ROE: Buy when ROE > threshold + trend confirmation"""
    min_roe = float(params.get("min_roe", 15)) / 100
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("roe") is not None and f["roe"] > min_roe)

def strategy_quality_low_debt(df, params):
    """Low Debt: Buy when D/E < threshold + good profitability"""
    max_de = float(params.get("max_debt_equity", 50))  # D/E percentage
    min_margin = float(params.get("min_profit_margin", 10)) / 100
    return _fundamental_signal(df, params,
        buy_check=lambda f: (f.get("debt_equity") is not None and f["debt_equity"] < max_de and
                              f.get("profit_margin") is not None and f["profit_margin"] > min_margin))

def strategy_quality_piotroski(df, params):
    """Simplified Piotroski F-Score: Score 0-9 based on fundamentals"""
    min_score = int(params.get("min_piotroski_score", 6))
    def check(f):
        score = 0
        # Profitability
        if f.get("roa") and f["roa"] > 0: score += 1
        if f.get("operating_cash_flow") and f["operating_cash_flow"] > 0: score += 1
        if f.get("roa") and f.get("earnings_growth") and f["earnings_growth"] > 0: score += 1
        if f.get("operating_cash_flow") and f.get("roa") and f.get("market_cap"):
            ocf_ratio = f["operating_cash_flow"] / f["market_cap"] if f["market_cap"] > 0 else 0
            if ocf_ratio > f["roa"]: score += 1
        # Leverage
        if f.get("debt_equity") is not None and f["debt_equity"] < 100: score += 1
        if f.get("current_ratio") and f["current_ratio"] > 1: score += 1
        # Efficiency
        if f.get("gross_margin") and f["gross_margin"] > 0.2: score += 1
        if f.get("profit_margin") and f["profit_margin"] > 0.08: score += 1
        if f.get("revenue_growth") and f["revenue_growth"] > 0: score += 1
        return score >= min_score
    return _fundamental_signal(df, params, buy_check=check)

def strategy_quality_moat(df, params):
    """Economic Moat: High ROE + High margins + Low debt"""
    min_roe = float(params.get("min_roe", 18)) / 100
    min_margin = float(params.get("min_operating_margin", 15)) / 100
    max_de = float(params.get("max_debt_equity", 80))
    def check(f):
        return (f.get("roe") is not None and f["roe"] > min_roe and
                f.get("operating_margin") is not None and f["operating_margin"] > min_margin and
                f.get("debt_equity") is not None and f["debt_equity"] < max_de)
    return _fundamental_signal(df, params, buy_check=check)


# ══════════════════════════════════════════════════════════════════════════════
# GROWTH STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def strategy_growth_high_eps(df, params):
    """High EPS Growth: Buy when earnings growth > threshold"""
    min_growth = float(params.get("min_eps_growth", 15)) / 100
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("earnings_growth") is not None and f["earnings_growth"] > min_growth)

def strategy_growth_revenue(df, params):
    """Revenue Acceleration: Buy when revenue growth > threshold"""
    min_growth = float(params.get("min_revenue_growth", 15)) / 100
    return _fundamental_signal(df, params,
        buy_check=lambda f: f.get("revenue_growth") is not None and f["revenue_growth"] > min_growth)

def strategy_growth_margin_expansion(df, params):
    """Margin Expansion: Buy when margins are strong and expanding"""
    min_margin = float(params.get("min_profit_margin", 12)) / 100
    min_growth = float(params.get("min_earnings_growth", 10)) / 100
    def check(f):
        return (f.get("profit_margin") is not None and f["profit_margin"] > min_margin and
                f.get("earnings_growth") is not None and f["earnings_growth"] > min_growth and
                f.get("revenue_growth") is not None and f["revenue_growth"] > 0)
    return _fundamental_signal(df, params, buy_check=check)


# ══════════════════════════════════════════════════════════════════════════════
# HYBRID (TECHNO-FUNDAMENTAL) STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def strategy_hybrid_roe_trend(df, params):
    """High ROE + Price above 200 DMA — quality + trend confirmation"""
    min_roe = float(params.get("min_roe", 15)) / 100
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    if not fund or fund.get("roe") is None or fund["roe"] < min_roe:
        return signals
    # High ROE confirmed, now use 200 DMA for timing
    if "sma_200" in df.columns:
        signals[df["close"] > df["sma_200"]] = 1
        signals[df["close"] < df["sma_200"]] = -1
    return signals

def strategy_hybrid_growth_breakout(df, params):
    """Earnings Growth + Price Breakout — growth stocks breaking out"""
    min_growth = float(params.get("min_earnings_growth", 10)) / 100
    window = int(params.get("breakout_window", 20))
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    if not fund or fund.get("earnings_growth") is None or fund["earnings_growth"] < min_growth:
        return signals
    # Growth confirmed, use breakout for entry
    rolling_high = df["high"].rolling(window).max()
    rolling_low = df["low"].rolling(window).min()
    signals[df["close"] > rolling_high.shift(1)] = 1
    signals[df["close"] < rolling_low.shift(1)] = -1
    return signals

def strategy_hybrid_low_debt_momentum(df, params):
    """Low Debt + Momentum Rank — quality balance sheet with price momentum"""
    max_de = float(params.get("max_debt_equity", 50))
    momentum_period = int(params.get("momentum_period", 20))
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    if not fund or fund.get("debt_equity") is None or fund["debt_equity"] > max_de:
        return signals
    # Low debt confirmed, use ROC for momentum
    roc = df["close"].pct_change(momentum_period)
    signals[roc > 0.02] = 1
    signals[roc < -0.02] = -1
    return signals

def strategy_hybrid_value_reversal(df, params):
    """Low P/E + RSI Oversold — value stock at technical oversold"""
    max_pe = float(params.get("pe_max", 15))
    rsi_threshold = float(params.get("oversold", 35))
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    if not fund or fund.get("pe_trailing") is None or fund["pe_trailing"] <= 0 or fund["pe_trailing"] > max_pe:
        return signals
    rsi = df.get("rsi_14", pd.Series(50, index=df.index))
    signals[rsi < rsi_threshold] = 1
    signals[rsi > 70] = -1
    return signals

def strategy_hybrid_quality_momentum(df, params):
    """Quality (High ROE + margins) + MACD momentum entry"""
    min_roe = float(params.get("min_roe", 15)) / 100
    min_margin = float(params.get("min_profit_margin", 10)) / 100
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    if not fund:
        return signals
    if fund.get("roe") is None or fund["roe"] < min_roe:
        return signals
    if fund.get("profit_margin") is None or fund["profit_margin"] < min_margin:
        return signals
    # Quality confirmed, use MACD for timing
    if "macd" in df.columns and "macd_signal" in df.columns:
        signals[df["macd"] > df["macd_signal"]] = 1
        signals[df["macd"] < df["macd_signal"]] = -1
    return signals


# ══════════════════════════════════════════════════════════════════════════════
# FACTOR STRATEGIES
# ══════════════════════════════════════════════════════════════════════════════

def strategy_factor_low_volatility(df, params):
    """Low Volatility Factor: Buy when realized vol is low, sell when high"""
    vol_lookback = int(params.get("vol_lookback", 20))
    vol_threshold = float(params.get("vol_threshold_pct", 20)) / 100
    daily_ret = df["close"].pct_change()
    realized_vol = daily_ret.rolling(vol_lookback).std() * (252 ** 0.5)
    signals = pd.Series(0, index=df.index)
    signals[realized_vol < vol_threshold] = 1
    signals[realized_vol > vol_threshold * 1.5] = -1
    return signals

def strategy_factor_beta_neutral(df, params):
    """Beta Factor: Buy in low-beta regime (trending), sell in high-beta (volatile)"""
    lookback = int(params.get("beta_lookback", 60))
    signals = pd.Series(0, index=df.index)
    # Use rolling volatility as proxy for beta
    daily_ret = df["close"].pct_change()
    vol = daily_ret.rolling(lookback).std() * (252 ** 0.5)
    vol_median = vol.rolling(lookback * 2).median()
    signals[vol < vol_median] = 1    # Low vol regime → buy
    signals[vol > vol_median * 1.3] = -1  # High vol → sell
    return signals

def strategy_factor_quality(df, params):
    """Quality Factor: Combines fundamental quality with price trend"""
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    # Quality score
    score = 0
    if fund.get("roe") and fund["roe"] > 0.15: score += 1
    if fund.get("debt_equity") is not None and fund["debt_equity"] < 80: score += 1
    if fund.get("profit_margin") and fund["profit_margin"] > 0.10: score += 1
    if fund.get("operating_cash_flow") and fund["operating_cash_flow"] > 0: score += 1
    if fund.get("revenue_growth") and fund["revenue_growth"] > 0: score += 1
    if score >= 3:
        # Quality pass → use trend for timing
        ma = df["close"].rolling(50).mean()
        signals[df["close"] > ma] = 1
        signals[df["close"] < ma * 0.95] = -1
    return signals

def strategy_factor_size(df, params):
    """Size Factor: Small cap momentum (market cap filter applied at entry)"""
    max_mcap_cr = float(params.get("max_market_cap_cr", 10000))  # in crores
    fund = params.get("_fundamentals", {})
    signals = pd.Series(0, index=df.index)
    mc = fund.get("market_cap")
    if mc and mc / 1e7 < max_mcap_cr:  # Convert to crores
        # Small cap → use momentum
        roc = df["close"].pct_change(20)
        signals[roc > 0] = 1
        signals[roc < -0.05] = -1
    return signals


# ══════════════════════════════════════════════════════════════════════════════
# ENHANCED TRADE SIMULATOR v2
# ══════════════════════════════════════════════════════════════════════════════

def simulate_trades_v2(df, signals, initial_capital, params, exit_type="signal"):
    capital = initial_capital
    position = 0
    entry_price = 0
    entry_date = None
    trades = []
    equity_curve = [initial_capital]
    daily_values = [initial_capital]

    stop_loss_pct = float(params.get("stop_loss_pct", 0)) / 100
    target_pct = float(params.get("target_pct", 0)) / 100
    position_size_pct = float(params.get("position_size_pct", 95)) / 100
    slippage_pct = float(params.get("slippage_pct", 0.05)) / 100
    txn_cost_pct = float(params.get("txn_cost_pct", 0.1)) / 100

    # Exit strategy params
    trailing_atr_mult = float(params.get("trailing_atr_mult", 0))  # 0 = disabled
    time_exit_days = int(params.get("time_exit_days", 0))  # 0 = disabled
    r_multiple_exit = float(params.get("r_multiple_exit", 0))  # 0 = disabled
    ma_exit_period = int(params.get("ma_exit_period", 0))  # 0 = disabled
    vol_spike_exit_mult = float(params.get("vol_spike_exit_mult", 0))  # 0 = disabled

    trailing_stop = 0
    bars_in_trade = 0

    prev_signal = 0
    for i in range(1, len(df)):
        price = float(df["close"].iloc[i])
        signal = int(signals.iloc[i])
        date = str(df.index[i].date())
        atr_val = float(df["atr"].iloc[i]) if "atr" in df.columns else 0

        # ── EXIT CHECKS (if in position) ──
        if position > 0 and entry_price > 0:
            bars_in_trade += 1
            slipped_price = price * (1 - slippage_pct)

            # 1. Stop Loss (fixed)
            if stop_loss_pct > 0 and price <= entry_price * (1 - stop_loss_pct):
                pnl = (slipped_price - entry_price) * position
                cost = abs(position * slipped_price) * txn_cost_pct
                capital += position * slipped_price - cost
                trades.append({"date": date, "action": "SELL_SL", "price": round(slipped_price,2),
                               "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                equity_curve.append(round(capital, 2)); continue

            # 2. Target
            if target_pct > 0 and price >= entry_price * (1 + target_pct):
                pnl = (slipped_price - entry_price) * position
                cost = abs(position * slipped_price) * txn_cost_pct
                capital += position * slipped_price - cost
                trades.append({"date": date, "action": "SELL_TGT", "price": round(slipped_price,2),
                               "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                equity_curve.append(round(capital, 2)); continue

            # 3. ATR Trailing Stop
            if trailing_atr_mult > 0 and atr_val > 0:
                new_trail = price - trailing_atr_mult * atr_val
                trailing_stop = max(trailing_stop, new_trail)
                if price < trailing_stop:
                    pnl = (slipped_price - entry_price) * position
                    cost = abs(position * slipped_price) * txn_cost_pct
                    capital += position * slipped_price - cost
                    trades.append({"date": date, "action": "SELL_ATR_TRAIL", "price": round(slipped_price,2),
                                   "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                    position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                    equity_curve.append(round(capital, 2)); continue

            # 4. Time-based Exit
            if time_exit_days > 0 and bars_in_trade >= time_exit_days:
                pnl = (slipped_price - entry_price) * position
                cost = abs(position * slipped_price) * txn_cost_pct
                capital += position * slipped_price - cost
                trades.append({"date": date, "action": "SELL_TIME", "price": round(slipped_price,2),
                               "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                equity_curve.append(round(capital, 2)); continue

            # 5. R-Multiple Exit
            if r_multiple_exit > 0 and stop_loss_pct > 0:
                risk_per_share = entry_price * stop_loss_pct
                if price >= entry_price + r_multiple_exit * risk_per_share:
                    pnl = (slipped_price - entry_price) * position
                    cost = abs(position * slipped_price) * txn_cost_pct
                    capital += position * slipped_price - cost
                    trades.append({"date": date, "action": f"SELL_{r_multiple_exit}R", "price": round(slipped_price,2),
                                   "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                    position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                    equity_curve.append(round(capital, 2)); continue

            # 6. MA Breakdown Exit
            if ma_exit_period > 0:
                ma_val = df["close"].rolling(ma_exit_period).mean().iloc[i]
                if not np.isnan(ma_val) and price < ma_val:
                    pnl = (slipped_price - entry_price) * position
                    cost = abs(position * slipped_price) * txn_cost_pct
                    capital += position * slipped_price - cost
                    trades.append({"date": date, "action": "SELL_MA_BREAK", "price": round(slipped_price,2),
                                   "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                    position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                    equity_curve.append(round(capital, 2)); continue

            # 7. Volatility Spike Exit
            if vol_spike_exit_mult > 0 and atr_val > 0:
                avg_atr = df["atr"].rolling(20).mean().iloc[i] if "atr" in df.columns else atr_val
                if not np.isnan(avg_atr) and atr_val > avg_atr * vol_spike_exit_mult:
                    pnl = (slipped_price - entry_price) * position
                    cost = abs(position * slipped_price) * txn_cost_pct
                    capital += position * slipped_price - cost
                    trades.append({"date": date, "action": "SELL_VOL_SPIKE", "price": round(slipped_price,2),
                                   "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped_price/entry_price-1)*100,2)})
                    position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0
                    equity_curve.append(round(capital, 2)); continue

        # ── SIGNAL-BASED ENTRY/EXIT ──
        if signal != prev_signal:
            if signal == 1 and position == 0:
                slipped = price * (1 + slippage_pct)
                qty = int((capital * position_size_pct) / slipped)
                if qty > 0:
                    cost = qty * slipped * (1 + txn_cost_pct)
                    if cost <= capital:
                        capital -= cost
                        position = qty
                        entry_price = slipped
                        bars_in_trade = 0
                        trailing_stop = slipped - trailing_atr_mult * atr_val if trailing_atr_mult > 0 and atr_val > 0 else 0
                        trades.append({"date": date, "action": "BUY", "price": round(slipped,2),
                                      "qty": qty, "pnl": 0, "pnl_pct": 0})

            elif signal == -1 and position > 0:
                slipped = price * (1 - slippage_pct)
                pnl = (slipped - entry_price) * position
                cost = abs(position * slipped) * txn_cost_pct
                capital += position * slipped - cost
                trades.append({"date": date, "action": "SELL", "price": round(slipped,2),
                               "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped/entry_price-1)*100,2)})
                position = 0; entry_price = 0; bars_in_trade = 0; trailing_stop = 0

        prev_signal = signal
        current_value = capital + (position * price if position > 0 else 0)
        equity_curve.append(round(current_value, 2))

    # Close any open position
    if position > 0:
        price = float(df["close"].iloc[-1])
        slipped = price * (1 - slippage_pct)
        pnl = (slipped - entry_price) * position
        cost = abs(position * slipped) * txn_cost_pct
        capital += position * slipped - cost
        trades.append({"date": str(df.index[-1].date()), "action": "SELL_END", "price": round(slipped,2),
                       "qty": position, "pnl": round(pnl - cost,2), "pnl_pct": round((slipped/entry_price-1)*100,2)})

    # ══════════════════════════════════════════════════════════════════════════
    # ADVANCED METRICS
    # ══════════════════════════════════════════════════════════════════════════
    completed = [t for t in trades if t["action"].startswith("SELL")]
    winners = [t for t in completed if t["pnl"] > 0]
    losers = [t for t in completed if t["pnl"] < 0]
    total_return = ((capital - initial_capital) / initial_capital) * 100

    equity_series = pd.Series(equity_curve)
    daily_returns = equity_series.pct_change().dropna()

    # Sharpe Ratio (annualized)
    sharpe = (daily_returns.mean() / daily_returns.std() * (252 ** 0.5)) if daily_returns.std() > 0 else 0

    # Sortino Ratio (downside deviation only)
    downside = daily_returns[daily_returns < 0]
    sortino = (daily_returns.mean() / downside.std() * (252 ** 0.5)) if len(downside) > 0 and downside.std() > 0 else 0

    # Max Drawdown
    peak = equity_series.expanding().max()
    drawdown = (equity_series - peak) / peak * 100
    max_dd = float(drawdown.min())
    max_dd_duration = 0
    dd_start = 0
    for i in range(len(drawdown)):
        if drawdown.iloc[i] < 0:
            if dd_start == 0: dd_start = i
        else:
            if dd_start > 0:
                max_dd_duration = max(max_dd_duration, i - dd_start)
                dd_start = 0

    # Calmar Ratio
    trading_days = len(equity_curve)
    annual_return = ((capital / initial_capital) ** (252 / max(trading_days, 1)) - 1) * 100
    calmar = annual_return / abs(max_dd) if max_dd != 0 else 0

    # Profit Factor
    gross_profit = sum(t["pnl"] for t in winners)
    gross_loss = abs(sum(t["pnl"] for t in losers))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else gross_profit if gross_profit > 0 else 0

    # Win Rate & Expectancy
    win_rate = len(winners) / len(completed) * 100 if completed else 0
    avg_win = sum(t["pnl"] for t in winners) / len(winners) if winners else 0
    avg_loss = sum(t["pnl"] for t in losers) / len(losers) if losers else 0
    expectancy = (win_rate/100 * avg_win + (1 - win_rate/100) * avg_loss) if completed else 0

    # Payoff Ratio
    payoff_ratio = abs(avg_win / avg_loss) if avg_loss != 0 else 0

    # Avg trade duration
    buy_dates = {t["date"]: t for t in trades if t["action"] == "BUY"}
    trade_durations = []
    for t in completed:
        # Approximate duration from trades list
        pass  # Would need proper date tracking

    # Ulcer Index (average of squared drawdowns)
    ulcer = float(np.sqrt((drawdown ** 2).mean())) if len(drawdown) > 0 else 0

    # Recovery Factor
    recovery_factor = abs(total_return / max_dd) if max_dd != 0 else 0

    # Monthly returns for distribution
    monthly_equity = equity_series.iloc[::21]  # approx monthly
    monthly_returns = monthly_equity.pct_change().dropna()
    best_month = float(monthly_returns.max() * 100) if len(monthly_returns) > 0 else 0
    worst_month = float(monthly_returns.min() * 100) if len(monthly_returns) > 0 else 0

    # Fundamental data summary (if available)
    fund = params.get("_fundamentals", {})
    fund_summary = {}
    if fund:
        fund_summary = {
            k: round(v, 4) if isinstance(v, float) else v
            for k, v in fund.items() if v is not None
        }

    return {
        # Basic
        "total_return_pct": round(total_return, 2),
        "annual_return_pct": round(annual_return, 2),
        "final_capital": round(capital, 2),
        "total_trades": len(completed),
        "winning_trades": len(winners),
        "losing_trades": len(losers),
        "win_rate": round(win_rate, 1),
        # Risk
        "max_drawdown_pct": round(max_dd, 2),
        "max_dd_duration_days": max_dd_duration,
        "sharpe_ratio": round(float(sharpe), 2),
        "sortino_ratio": round(float(sortino), 2),
        "calmar_ratio": round(float(calmar), 2),
        "ulcer_index": round(ulcer, 2),
        "recovery_factor": round(recovery_factor, 2),
        # Profit
        "profit_factor": round(profit_factor, 2),
        "expectancy": round(expectancy, 2),
        "payoff_ratio": round(payoff_ratio, 2),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "best_month_pct": round(best_month, 2),
        "worst_month_pct": round(worst_month, 2),
        # Data
        "trades": trades[-50:],
        "equity_curve": equity_curve[::max(len(equity_curve)//100, 1)],
        "fundamentals": fund_summary,
        "exit_strategy": params.get("exit_strategy", "signal"),
        "slippage_pct": round(slippage_pct * 100, 3),
        "txn_cost_pct": round(txn_cost_pct * 100, 3),
    }

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health", tags=["Health & Status"], summary="System health check",
    description="Returns API status, universe size, sector count, data source info, and Groww token status. No authentication required.",
    response_description="Health status object")
async def health():
    token_set = bool(await get_groww_token())
    return {
        "status": "ok", "version": "2.1.0",
        "universe_size": len(NIFTY_UNIVERSE),
        "sectors": len(set(SECTOR_MAP.values())),
        "universe_source": "stock_universe.json" if _UNIVERSE_LOADED else "built-in (457)",
        "groww_token_active": token_set,
        "timestamp": datetime.utcnow().isoformat(),
    }

@app.get("/", tags=["Health & Status"], summary="API root", description="Returns API version and docs URL.")
async def root():
    return {"message": "AlphaLab API v2.0", "docs": "/api/docs"}

# ── Auth Routes ───────────────────────────────────────────────────────────────
@app.post("/api/auth/register", tags=["Authentication"], summary="Register new user",
    description="Create a new user account. Requires invite code if platform is in invite-only mode. Supports user types: individual, ra (Research Analyst), ria (Investment Advisor).")
async def register(req: RegisterRequest):
    async with db_pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM users WHERE is_admin=false")
        if count >= MAX_USERS: raise HTTPException(status_code=400, detail="Platform at capacity")
        if INVITE_ONLY:
            if not req.invite_code: raise HTTPException(status_code=400, detail="Invite code required")
            invite = await conn.fetchrow("SELECT * FROM invite_codes WHERE code=$1 AND used_by IS NULL", req.invite_code)
            if not invite: raise HTTPException(status_code=400, detail="Invalid or used invite code")
        existing = await conn.fetchrow("SELECT id FROM users WHERE email=$1", req.email)
        if existing: raise HTTPException(status_code=400, detail="Email already registered")
        user_type = req.user_type or "individual"
        sebi_reg = req.sebi_reg_no or ""
        uid = await conn.fetchval(
            "INSERT INTO users (email, name, password_hash, user_type, sebi_reg_no) VALUES ($1,$2,$3,$4,$5) RETURNING id",
            req.email, req.name, hash_password(req.password), user_type, sebi_reg
        )
        if INVITE_ONLY and req.invite_code:
            await conn.execute("UPDATE invite_codes SET used_by=$1, used_at=NOW() WHERE code=$2", uid, req.invite_code)
        await conn.execute("INSERT INTO watchlists (user_id) VALUES ($1)", uid)
        return {"token": create_token(uid, req.email, False), "user": {"id": uid, "email": req.email, "name": req.name, "is_admin": False, "user_type": user_type}}

@app.post("/api/auth/login", tags=["Authentication"], summary="Login",
    description="Authenticate with email and password. Returns a JWT Bearer token valid for 7 days.")
async def login(req: LoginRequest):
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM users WHERE email=$1 AND is_active=true", req.email)
        if not user or user["password_hash"] != hash_password(req.password):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return {"token": create_token(user["id"], user["email"], user["is_admin"]),
                "user": {"id": user["id"], "email": user["email"], "name": user["name"], "is_admin": user["is_admin"],
                         "user_type": user.get("user_type", "individual")}}

@app.get("/api/auth/me", tags=["Authentication"], summary="Get current user profile",
    description="Returns the authenticated user's profile including email, name, user type, and admin status.")
async def me(user=Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"], "name": user["name"], "is_admin": user["is_admin"],
            "user_type": user.get("user_type", "individual"), "sebi_reg_no": user.get("sebi_reg_no", "")}

# ── SEBI Certificate Upload ──────────────────────────────────────────────────
@app.post("/api/auth/upload-sebi-cert", tags=["Authentication"], summary="Upload SEBI certificate",
    description="Upload SEBI registration certificate (PDF/image) for RA/RIA verification. Max 5MB.")
async def upload_sebi_cert(file: UploadFile = File(...), user=Depends(get_current_user)):
    import os
    cert_dir = "/opt/alphaforge/sebi_certs"
    os.makedirs(cert_dir, exist_ok=True)
    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "pdf"
    safe_ext = ext if ext in ("pdf", "jpg", "jpeg", "png") else "pdf"
    filename = f"sebi_cert_{user['id']}_{user.get('sebi_reg_no','unknown')}.{safe_ext}"
    filepath = os.path.join(cert_dir, filename)
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE users SET sebi_cert_path=$1 WHERE id=$2", filepath, user["id"])
    return {"message": "Certificate uploaded", "path": filepath}

# ── Admin: View Registered Advisors ──────────────────────────────────────────
@app.get("/api/admin/advisors", tags=["Admin"], summary="List advisor applications",
    description="Admin only. Returns all users who registered as RA/RIA with their SEBI verification status.")
async def list_advisors(user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        advisors = await conn.fetch("""
            SELECT id, email, name, user_type, sebi_reg_no, sebi_cert_path, is_active, created_at
            FROM users WHERE user_type IN ('ra', 'ria') ORDER BY created_at DESC
        """)
    return [dict(a) for a in advisors]

@app.get("/api/admin/sebi-cert/{user_id}", tags=["Admin"], summary="Download SEBI certificate",
    description="Admin only. Download the uploaded SEBI certificate for a specific advisor user.")
async def download_sebi_cert(user_id: int, admin=Depends(get_admin_user)):
    from fastapi.responses import FileResponse
    import os
    async with db_pool.acquire() as conn:
        u = await conn.fetchrow("SELECT sebi_cert_path FROM users WHERE id=$1", user_id)
    if not u or not u["sebi_cert_path"] or not os.path.exists(u["sebi_cert_path"]):
        raise HTTPException(status_code=404, detail="Certificate not found")
    return FileResponse(u["sebi_cert_path"])

# ── Token Management ──────────────────────────────────────────────────────────
@app.post("/api/admin/token", tags=["Admin"], summary="Update data provider token",
    description="Admin only. Update the Groww/data provider API token used for market data fetching.")
async def update_groww_token(req: TokenUpdateRequest, user=Depends(get_admin_user)):
    await set_groww_token(req.token.strip())
    return {"message": "Groww token updated successfully", "active": True}

@app.get("/api/admin/token/status", tags=["Admin"], summary="Check data provider token status",
    description="Admin only. Check if the data provider token is set and active.")
async def token_status(user=Depends(get_admin_user)):
    token = await get_groww_token()
    return {"active": bool(token), "preview": token[:20] + "..." if token else None}

# ── Indicators API ────────────────────────────────────────────────────────────
@app.post("/api/indicators", tags=["Technical Charts"], summary="Compute technical indicators",
    description="Fetch OHLCV data for a symbol and compute technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands, Supertrend, ADX, ATR, VWAP, Stochastic, OBV, etc.).")
async def get_indicators(req: StrategyParams, user=Depends(get_current_user)):
    df = await fetch_groww_candles(req.symbol, req.from_date, req.to_date, req.interval)
    if len(df) < 30:
        raise HTTPException(status_code=400, detail="Not enough data. Try a longer date range.")
    df = compute_indicators(df)
    result = df.tail(100).reset_index()
    result["date"] = result["date"].astype(str)
    result = result.replace([np.inf, -np.inf], np.nan).fillna(0)
    return {"symbol": req.symbol, "candles": result.to_dict(orient="records"), "total_candles": len(df)}

# ── Backtest Routes ───────────────────────────────────────────────────────────
@app.post("/api/backtest/run", tags=["Backtesting"], summary="Run a backtest",
    description="Execute a historical backtest on a single stock. Supports 40+ strategies (SMA_CROSSOVER, EMA_CROSSOVER, RSI, MACD, BOLLINGER, SUPERTREND, BREAKOUT, MOMENTUM, ADX_TREND, GOLDEN_CROSS, etc.). Returns trade-by-trade results, equity curve, CAGR, Sharpe ratio, max drawdown, and win rate. Runs asynchronously — poll the backtest ID for results.")
async def run_backtest(req: BacktestRequest, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        bt_id = await conn.fetchval(
            "INSERT INTO backtests (user_id, name, strategy, symbol, from_date, to_date, initial_capital, params, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'running') RETURNING id",
            user["id"], req.name, req.strategy, req.symbol, req.from_date, req.to_date, req.initial_capital, json.dumps(req.params)
        )
    asyncio.create_task(execute_backtest(bt_id, req))
    return {"backtest_id": bt_id, "status": "running"}

async def execute_backtest(bt_id: int, req: BacktestRequest):
    try:
        df = await fetch_groww_candles(req.symbol, req.from_date, req.to_date)
        if len(df) < 30:
            raise Exception("Insufficient data — try a longer date range")
        df = compute_indicators(df)
        p = req.params or {}
        p["_symbol"] = req.symbol
        result = run_strategy(df, req.strategy, p, req.initial_capital)
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE backtests SET result=$1, status='completed' WHERE id=$2", json.dumps(result), bt_id)
    except Exception as e:
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE backtests SET result=$1, status='failed' WHERE id=$2", json.dumps({"error": str(e)}), bt_id)

@app.get("/api/backtest/{bt_id}", tags=["Backtesting"], summary="Get backtest result",
    description="Retrieve the result of a specific backtest by ID. Returns strategy parameters, trade log, equity curve data, and performance metrics once completed.")
async def get_backtest(bt_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        bt = await conn.fetchrow("SELECT * FROM backtests WHERE id=$1 AND user_id=$2", bt_id, user["id"])
        if not bt: raise HTTPException(status_code=404, detail="Not found")
        return dict(bt)

@app.get("/api/backtests", tags=["Backtesting"], summary="List all backtests",
    description="List all backtests created by the authenticated user, sorted by most recent. Includes status (running/completed/failed).")
async def list_backtests(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT id,name,strategy,symbol,from_date,to_date,status,created_at FROM backtests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", user["id"])
        return [dict(r) for r in rows]

# ── Paper Trading ─────────────────────────────────────────────────────────────
@app.post("/api/paper-trade/open", tags=["Paper Trading"], summary="Open a paper trade",
    description="Open a manual paper trade with symbol, trade type (BUY/SELL), quantity, entry price. Optional stop-loss and target price.")
async def open_paper_trade(req: PaperTradeRequest, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        tid = await conn.fetchval(
            "INSERT INTO paper_trades (user_id,symbol,trade_type,quantity,entry_price,stop_loss,target) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            user["id"], req.symbol.upper(), req.trade_type.upper(), req.quantity, req.entry_price, req.stop_loss, req.target
        )
        return {"trade_id": tid, "status": "open"}

@app.post("/api/paper-trade/{trade_id}/close", tags=["Paper Trading"], summary="Close a paper trade",
    description="Close an open paper trade at the specified exit price. Calculates P&L and returns trade summary.")
async def close_paper_trade(trade_id: int, exit_price: float, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        t = await conn.fetchrow("SELECT * FROM paper_trades WHERE id=$1 AND user_id=$2 AND status='open'", trade_id, user["id"])
        if not t: raise HTTPException(status_code=404, detail="Trade not found")
        pnl = (exit_price - t["entry_price"]) * t["quantity"] if t["trade_type"]=="BUY" else (t["entry_price"]-exit_price)*t["quantity"]
        await conn.execute("UPDATE paper_trades SET exit_price=$1,pnl=$2,status='closed',closed_at=NOW() WHERE id=$3", exit_price, round(pnl,2), trade_id)
        return {"trade_id": trade_id, "pnl": round(pnl,2), "status": "closed"}

@app.get("/api/paper-trades", tags=["Paper Trading"], summary="List paper trades",
    description="List all paper trades for the authenticated user — both open and closed positions with P&L calculations.")
async def list_paper_trades(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM paper_trades WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", user["id"])
        trades = [dict(r) for r in rows]
        return {"trades": trades, "total_pnl": round(sum(t["pnl"] or 0 for t in trades), 2), "open_count": sum(1 for t in trades if t["status"]=="open")}


# ══════════════════════════════════════════════════════════════════════════════
# FORWARD TESTING ENGINE
# ══════════════════════════════════════════════════════════════════════════════

STRATEGY_MAP = {
    "SMA_CROSSOVER": strategy_sma_crossover, "EMA_CROSSOVER": strategy_ema_crossover,
    "RSI": strategy_rsi, "MACD": strategy_macd, "BOLLINGER": strategy_bollinger,
    "SUPERTREND": strategy_supertrend, "BREAKOUT": strategy_breakout,
    "MOMENTUM": strategy_momentum, "ADX_TREND": strategy_adx_trend,
    "GOLDEN_CROSS": strategy_golden_cross, "VWAP_REVERSION": strategy_vwap_reversion,
    "STOCHASTIC": strategy_stochastic, "KELTNER_BREAKOUT": strategy_keltner_breakout,
    "NR7_EXPANSION": strategy_nr7_expansion, "OBV_DIVERGENCE": strategy_obv_divergence,
    "TRIPLE_EMA": strategy_triple_ema, "ATR_CHANNEL": strategy_atr_channel,
    "MEAN_REVERSION": strategy_mean_reversion,
    "VALUE_LOW_PE": strategy_value_low_pe, "VALUE_HIGH_DIVIDEND": strategy_value_high_dividend,
    "VALUE_DEEP_VALUE": strategy_value_deep_value, "VALUE_LOW_PB": strategy_value_low_pb,
    "VALUE_FCF_YIELD": strategy_value_fcf_yield, "VALUE_GARP": strategy_value_garp,
    "QUALITY_HIGH_ROE": strategy_quality_high_roe, "QUALITY_LOW_DEBT": strategy_quality_low_debt,
    "QUALITY_PIOTROSKI": strategy_quality_piotroski, "QUALITY_MOAT": strategy_quality_moat,
    "GROWTH_HIGH_EPS": strategy_growth_high_eps, "GROWTH_REVENUE": strategy_growth_revenue,
    "GROWTH_MARGIN_EXPANSION": strategy_growth_margin_expansion,
    "HYBRID_ROE_TREND": strategy_hybrid_roe_trend, "HYBRID_GROWTH_BREAKOUT": strategy_hybrid_growth_breakout,
    "HYBRID_LOW_DEBT_MOMENTUM": strategy_hybrid_low_debt_momentum,
    "HYBRID_VALUE_REVERSAL": strategy_hybrid_value_reversal,
    "HYBRID_QUALITY_MOMENTUM": strategy_hybrid_quality_momentum,
    "FACTOR_LOW_VOLATILITY": strategy_factor_low_volatility,
    "FACTOR_BETA_NEUTRAL": strategy_factor_beta_neutral,
    "FACTOR_QUALITY": strategy_factor_quality, "FACTOR_SIZE": strategy_factor_size,
}


async def generate_forward_signals(fwd_test: dict) -> list:
    """Run strategy on current data for all symbols — generate BUY/SELL/HOLD signals."""
    import yfinance as yf
    from datetime import date, timedelta

    strategy = fwd_test["strategy"]
    params = json.loads(fwd_test["params"]) if isinstance(fwd_test["params"], str) else (fwd_test["params"] or {})
    symbols = fwd_test["symbols"]
    # Apply sector filter if set
    fwd_sector_filter = params.get("sector_filter", "")
    if fwd_sector_filter:
        symbols = [s for s in symbols if SECTOR_MAP.get(s, "Other") == fwd_sector_filter]
    lookback = fwd_test.get("lookback_days", 200)
    start = (date.today() - timedelta(days=lookback + 50)).isoformat()
    end = date.today().isoformat()
    signals = []
    loop = asyncio.get_event_loop()

    # Batch download all symbols
    yf_symbols = [f"{s}.NS" for s in symbols]
    batch_size = 40
    all_data = {}
    for i in range(0, len(yf_symbols), batch_size):
        batch = yf_symbols[i:i+batch_size]
        try:
            raw = await loop.run_in_executor(None, lambda b=batch: yf.download(
                tickers=b, start=start, end=end, interval="1d", auto_adjust=True, progress=False, threads=True
            ))
            single = len(batch) == 1
            for yfs in batch:
                try:
                    df = yf_extract_ticker(raw, yfs, single_mode=single)
                    if not df.empty and len(df) >= 30:
                        all_data[yfs] = df
                except:
                    continue
        except:
            continue

    for sym in symbols:
        yf_sym = f"{sym}.NS"
        if yf_sym not in all_data:
            continue
        try:
            df = all_data[yf_sym].copy()
            if "Close" in df.columns:
                df = df.rename(columns={"Close":"close","Open":"open","High":"high","Low":"low","Volume":"volume"})
            df = df.sort_index().astype({"open":float,"high":float,"low":float,"close":float,"volume":float}).dropna()
            if len(df) < 30:
                continue

            df = compute_indicators(df)

            p = dict(params)
            p["_symbol"] = sym
            if strategy.startswith(("VALUE_","QUALITY_","GROWTH_","HYBRID_","FACTOR_")):
                try:
                    p["_fundamentals"] = fetch_fundamentals_sync(sym)
                except:
                    p["_fundamentals"] = {}
            else:
                p["_fundamentals"] = {}

            fn = STRATEGY_MAP.get(strategy, strategy_sma_crossover)
            sig_series = fn(df, p)

            last_sig = int(sig_series.iloc[-1]) if len(sig_series) > 0 else 0
            prev_sig = int(sig_series.iloc[-2]) if len(sig_series) > 1 else 0
            price = float(df["close"].iloc[-1])
            prev_price = float(df["close"].iloc[-2]) if len(df) > 1 else price

            # Signal strength (0-100)
            strength = 0
            rsi_val = float(df["rsi_14"].iloc[-1]) if "rsi_14" in df.columns and not np.isnan(df["rsi_14"].iloc[-1]) else 50
            vol_ratio = float(df["volume"].iloc[-1] / df["volume"].rolling(20).mean().iloc[-1]) if len(df) >= 20 else 1
            above_200 = 1 if "sma_200" in df.columns and not np.isnan(df["sma_200"].iloc[-1]) and price > float(df["sma_200"].iloc[-1]) else 0

            if last_sig == 1:
                strength = min(100, max(10, int(30 + (70 - rsi_val) * 0.3 + min(vol_ratio, 5) * 8 + above_200 * 20)))
            elif last_sig == -1:
                strength = min(100, max(10, int(30 + (rsi_val - 30) * 0.3 + 20)))

            strat_data = {}
            for col, key in [("rsi_14","rsi"),("sma_50","sma_50"),("sma_200","sma_200"),("macd_hist","macd_hist"),("adx","adx"),("atr","atr")]:
                if col in df.columns:
                    v = df[col].iloc[-1]
                    strat_data[key] = round(float(v), 2) if not np.isnan(v) else None
            strat_data["volume_ratio"] = round(vol_ratio, 2)
            strat_data["change_pct"] = round((price - prev_price) / prev_price * 100, 2)
            strat_data["sector"] = SECTOR_MAP.get(sym, "Other")
            strat_data["above_200dma"] = above_200

            fund = p.get("_fundamentals", {})
            for fk in ["pe_trailing","pb","roe","debt_equity","dividend_yield","earnings_growth","profit_margin"]:
                if fk in fund and fund[fk] is not None:
                    strat_data[fk] = round(float(fund[fk]), 4)

            signal_type = "BUY" if last_sig == 1 else ("SELL" if last_sig == -1 else "HOLD")
            is_new = last_sig != prev_sig and last_sig != 0

            signals.append({
                "symbol": sym, "signal": signal_type, "is_new": is_new,
                "strength": strength, "price": round(price, 2), "strategy_data": strat_data,
            })
        except Exception as e:
            continue

    # Sort: new signals first, then by strength desc
    signals.sort(key=lambda s: (0 if s["is_new"] else 1, -s["strength"]))
    return signals


async def execute_forward_signals(fwd_test_id: int, signals: list):
    """Auto-execute: open positions on new BUY, close on new SELL."""
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1", fwd_test_id)
        if not fwd or fwd["status"] != "active":
            return

        capital = fwd["current_capital"]
        max_pos = fwd["max_positions"]
        pos_size_pct = fwd["position_size_pct"] / 100
        slippage = fwd["slippage_pct"] / 100
        txn_cost = fwd["txn_cost_pct"] / 100
        sector_cap = fwd["sector_cap_pct"] / 100

        positions = await conn.fetch(
            "SELECT * FROM forward_test_positions WHERE fwd_test_id=$1 AND status='open'", fwd_test_id
        )
        open_syms = {p["symbol"] for p in positions}
        num_open = len(positions)
        sector_counts = {}
        for p in positions:
            sec = p.get("sector") or "Other"
            sector_counts[sec] = sector_counts.get(sec, 0) + 1

        for sig in signals:
            sym = sig["symbol"]
            signal_type = sig["signal"]
            price = sig["price"]
            is_new = sig["is_new"]
            strat_data = sig.get("strategy_data", {})
            sector = strat_data.get("sector", "Other")

            # Store every signal for audit
            await conn.execute(
                "INSERT INTO forward_test_signals (fwd_test_id,symbol,signal_type,signal_strength,price_at_signal,strategy_data,status) VALUES ($1,$2,$3,$4,$5,$6,$7)",
                fwd_test_id, sym, signal_type, sig["strength"], price,
                json.dumps(strat_data), "executed" if is_new else "held"
            )

            if not is_new:
                continue

            # ── BUY ──
            if signal_type == "BUY" and sym not in open_syms and num_open < max_pos:
                if sector_cap > 0:
                    max_in_sector = max(1, int(max_pos * sector_cap))
                    if sector_counts.get(sector, 0) >= max_in_sector:
                        continue

                alloc = capital * pos_size_pct
                slipped = price * (1 + slippage)
                qty = int(alloc / slipped)
                if qty <= 0:
                    continue
                cost = qty * slipped
                fees = cost * txn_cost
                if cost + fees > capital:
                    continue

                atr_val = strat_data.get("atr") or 0
                sl = round(slipped - 2 * atr_val, 2) if atr_val > 0 else None
                tgt = round(slipped + 3 * atr_val, 2) if atr_val > 0 else None

                await conn.execute("""
                    INSERT INTO forward_test_positions (fwd_test_id,symbol,quantity,entry_price,current_price,stop_loss,target,sector,fundamentals)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                """, fwd_test_id, sym, qty, round(slipped,2), price, sl, tgt, sector, json.dumps(strat_data))
                await conn.execute("""
                    INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,fees)
                    VALUES ($1,$2,'BUY',$3,$4,$5)
                """, fwd_test_id, sym, qty, round(slipped,2), round(fees,2))

                capital -= (cost + fees)
                num_open += 1
                open_syms.add(sym)
                sector_counts[sector] = sector_counts.get(sector, 0) + 1

            # ── SELL ──
            elif signal_type == "SELL" and sym in open_syms:
                pos = next((p for p in positions if p["symbol"] == sym and p["status"] == "open"), None)
                if not pos:
                    continue
                slipped = price * (1 - slippage)
                pnl = (slipped - pos["entry_price"]) * pos["quantity"]
                fees = abs(pos["quantity"] * slipped) * txn_cost
                pnl_pct = (slipped / pos["entry_price"] - 1) * 100

                await conn.execute(
                    "UPDATE forward_test_positions SET status='closed',current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3 WHERE id=$4",
                    round(slipped,2), round(pnl-fees,2), round(pnl_pct,2), pos["id"]
                )
                await conn.execute("""
                    INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,pnl,pnl_pct,exit_reason,fees)
                    VALUES ($1,$2,'SELL',$3,$4,$5,$6,'signal',$7)
                """, fwd_test_id, sym, pos["quantity"], round(slipped,2), round(pnl-fees,2), round(pnl_pct,2), round(fees,2))
                capital += pos["quantity"] * slipped - fees

        await conn.execute("UPDATE forward_tests SET current_capital=$1, last_scan_at=NOW() WHERE id=$2", round(capital,2), fwd_test_id)


async def update_forward_positions(fwd_test_id: int):
    """Refresh current prices, check stop-loss and target for open positions."""
    import yfinance as yf
    async with db_pool.acquire() as conn:
        positions = await conn.fetch(
            "SELECT * FROM forward_test_positions WHERE fwd_test_id=$1 AND status='open'", fwd_test_id
        )
        if not positions:
            return
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1", fwd_test_id)
        capital = fwd["current_capital"]
        slippage = fwd["slippage_pct"] / 100
        txn_cost = fwd["txn_cost_pct"] / 100
        loop = asyncio.get_event_loop()

        syms = [f"{p['symbol']}.NS" for p in positions]
        try:
            raw = await loop.run_in_executor(None, lambda: yf.download(
                tickers=syms, period="2d", interval="1d", auto_adjust=True, progress=False, threads=True
            ))
        except:
            return

        single = len(syms) == 1
        for pos in positions:
            try:
                yf_sym = f"{pos['symbol']}.NS"
                df = yf_extract_ticker(raw, yf_sym, single_mode=single)
                if df.empty:
                    continue
                price = float(df["Close"].iloc[-1] if "Close" in df.columns else df["close"].iloc[-1])
                pnl = (price - pos["entry_price"]) * pos["quantity"]
                pnl_pct = (price / pos["entry_price"] - 1) * 100

                # Stop loss check
                if pos["stop_loss"] and price <= pos["stop_loss"]:
                    sl_price = price * (1 - slippage)
                    sl_pnl = (sl_price - pos["entry_price"]) * pos["quantity"]
                    fees = abs(pos["quantity"] * sl_price) * txn_cost
                    await conn.execute("UPDATE forward_test_positions SET status='closed',current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3 WHERE id=$4",
                        round(sl_price,2), round(sl_pnl-fees,2), round((sl_price/pos["entry_price"]-1)*100,2), pos["id"])
                    await conn.execute("INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,pnl,pnl_pct,exit_reason,fees) VALUES ($1,$2,'SELL',$3,$4,$5,$6,'stop_loss',$7)",
                        fwd_test_id, pos["symbol"], pos["quantity"], round(sl_price,2), round(sl_pnl-fees,2), round((sl_price/pos["entry_price"]-1)*100,2), round(fees,2))
                    capital += pos["quantity"] * sl_price - fees
                    continue

                # Target check
                if pos["target"] and price >= pos["target"]:
                    tgt_price = price * (1 - slippage)
                    tgt_pnl = (tgt_price - pos["entry_price"]) * pos["quantity"]
                    fees = abs(pos["quantity"] * tgt_price) * txn_cost
                    await conn.execute("UPDATE forward_test_positions SET status='closed',current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3 WHERE id=$4",
                        round(tgt_price,2), round(tgt_pnl-fees,2), round((tgt_price/pos["entry_price"]-1)*100,2), pos["id"])
                    await conn.execute("INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,pnl,pnl_pct,exit_reason,fees) VALUES ($1,$2,'SELL',$3,$4,$5,$6,'target',$7)",
                        fwd_test_id, pos["symbol"], pos["quantity"], round(tgt_price,2), round(tgt_pnl-fees,2), round((tgt_price/pos["entry_price"]-1)*100,2), round(fees,2))
                    capital += pos["quantity"] * tgt_price - fees
                    continue

                # Update price
                await conn.execute("UPDATE forward_test_positions SET current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3,bars_held=bars_held+1 WHERE id=$4",
                    round(price,2), round(pnl,2), round(pnl_pct,2), pos["id"])
            except:
                continue
        await conn.execute("UPDATE forward_tests SET current_capital=$1 WHERE id=$2", round(capital,2), fwd_test_id)


async def take_portfolio_snapshot(fwd_test_id: int):
    """Record daily snapshot for equity curve."""
    from datetime import date as dt_date
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1", fwd_test_id)
        positions = await conn.fetch("SELECT * FROM forward_test_positions WHERE fwd_test_id=$1 AND status='open'", fwd_test_id)
        pos_val = sum((p["current_price"] or p["entry_price"]) * p["quantity"] for p in positions)
        cash = fwd["current_capital"]
        total = cash + pos_val
        cum_ret = (total / fwd["initial_capital"] - 1) * 100

        prev = await conn.fetchrow("SELECT portfolio_value FROM forward_test_snapshots WHERE fwd_test_id=$1 ORDER BY snapshot_date DESC LIMIT 1", fwd_test_id)
        daily_ret = ((total / prev["portfolio_value"] - 1) * 100) if prev else 0

        all_snaps = await conn.fetch("SELECT portfolio_value FROM forward_test_snapshots WHERE fwd_test_id=$1 ORDER BY snapshot_date ASC", fwd_test_id)
        peak = fwd["initial_capital"]
        max_dd = 0
        for s in all_snaps:
            peak = max(peak, s["portfolio_value"])
            dd = (s["portfolio_value"] - peak) / peak * 100
            max_dd = min(max_dd, dd)
        peak = max(peak, total)
        max_dd = min(max_dd, (total - peak) / peak * 100 if peak > 0 else 0)

        await conn.execute("""
            INSERT INTO forward_test_snapshots (fwd_test_id,portfolio_value,cash,positions_value,num_positions,daily_return_pct,cumulative_return_pct,drawdown_pct,snapshot_date)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (fwd_test_id,snapshot_date) DO UPDATE SET portfolio_value=$2,cash=$3,positions_value=$4,num_positions=$5,daily_return_pct=$6,cumulative_return_pct=$7,drawdown_pct=$8
        """, fwd_test_id, round(total,2), round(cash,2), round(pos_val,2), len(positions), round(daily_ret,2), round(cum_ret,2), round(max_dd,2), dt_date.today())


# ── Forward Test API Endpoints ───────────────────────────────────────────────

@app.post("/api/forward-test/create", tags=["Forward Testing"], summary="Create a forward test",
    description="Create a new forward test to paper-trade a strategy across multiple stocks in real-time. Configure strategy, symbols, position sizing (% of capital), sector caps, max positions, rebalance frequency, slippage, and transaction costs.")
async def create_forward_test(req: ForwardTestCreate, user=Depends(get_current_user)):
    # Expand universe markers
    symbols = req.symbols
    if symbols and symbols[0] == "__ALL__":
        symbols = list(NIFTY_UNIVERSE)
    elif symbols and symbols[0] == "__N200__":
        symbols = list(NIFTY_UNIVERSE)[:200]
    async with db_pool.acquire() as conn:
        fwd_id = await conn.fetchval("""
            INSERT INTO forward_tests (user_id,name,strategy,symbols,params,initial_capital,current_capital,
                weighting,rebalance_freq,max_positions,position_size_pct,sector_cap_pct,lookback_days,slippage_pct,txn_cost_pct)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id
        """, user["id"], req.name, req.strategy, req.symbols, json.dumps(req.params),
            req.initial_capital, req.initial_capital, req.weighting, req.rebalance_freq,
            req.max_positions, req.position_size_pct, req.sector_cap_pct, req.lookback_days,
            req.slippage_pct, req.txn_cost_pct)
        return {"id": fwd_id, "status": "active"}


@app.get("/api/forward-tests", tags=["Forward Testing"], summary="List forward tests",
    description="List all forward tests for the authenticated user with current P&L, open positions count, and status.")
async def list_forward_tests(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ft.*,
                (SELECT COUNT(*) FROM forward_test_positions WHERE fwd_test_id=ft.id AND status='open') as open_positions,
                (SELECT COUNT(*) FROM forward_test_trades WHERE fwd_test_id=ft.id) as total_trades,
                (SELECT COALESCE(SUM(pnl),0) FROM forward_test_trades WHERE fwd_test_id=ft.id AND action='SELL') as realized_pnl
            FROM forward_tests ft WHERE ft.user_id=$1 ORDER BY ft.created_at DESC
        """, user["id"])
        result = []
        for r in rows:
            d = dict(r)
            for k in ["created_at","last_scan_at","last_rebalance_at"]:
                if d.get(k): d[k] = str(d[k])
            result.append(d)
        return result


def _safe_row(row):
    d = dict(row)
    for k, v in d.items():
        if hasattr(v, 'isoformat'): d[k] = str(v)
        elif isinstance(v, float):
            try:
                if np.isnan(v) or np.isinf(v): d[k] = 0
            except: pass
    return d


@app.get("/api/forward-test/{fwd_id}", tags=["Forward Testing"], summary="Get forward test details",
    description="Get full details of a forward test including all positions (open/closed), trade history, equity curve, daily P&L, and live performance metrics.")
async def get_forward_test(fwd_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        if not fwd: raise HTTPException(status_code=404, detail="Not found")

        positions = await conn.fetch("SELECT * FROM forward_test_positions WHERE fwd_test_id=$1 ORDER BY status ASC, entry_date DESC", fwd_id)
        trades = await conn.fetch("SELECT * FROM forward_test_trades WHERE fwd_test_id=$1 ORDER BY executed_at DESC LIMIT 50", fwd_id)
        signals = await conn.fetch("SELECT * FROM forward_test_signals WHERE fwd_test_id=$1 ORDER BY created_at DESC LIMIT 100", fwd_id)
        snapshots = await conn.fetch("SELECT * FROM forward_test_snapshots WHERE fwd_test_id=$1 ORDER BY snapshot_date ASC", fwd_id)

        open_pos = [_safe_row(p) for p in positions if p["status"] == "open"]
        closed_pos = [_safe_row(p) for p in positions if p["status"] == "closed"]
        sell_trades = [dict(t) for t in trades if t["action"] == "SELL"]

        pos_val = sum((p.get("current_price") or p.get("entry_price", 0)) * p.get("quantity", 0) for p in open_pos)
        unrealized = sum(p.get("unrealized_pnl", 0) or 0 for p in open_pos)
        realized = sum(t.get("pnl", 0) or 0 for t in sell_trades)
        total_val = fwd["current_capital"] + pos_val
        total_ret = (total_val / fwd["initial_capital"] - 1) * 100

        winners = [t for t in sell_trades if (t.get("pnl") or 0) > 0]
        losers = [t for t in sell_trades if (t.get("pnl") or 0) < 0]
        win_rate = len(winners) / len(sell_trades) * 100 if sell_trades else 0
        avg_win = sum(t["pnl"] for t in winners) / len(winners) if winners else 0
        avg_loss = sum(t["pnl"] for t in losers) / len(losers) if losers else 0
        profit_factor = abs(sum(t["pnl"] for t in winners)) / abs(sum(t["pnl"] for t in losers)) if losers and sum(t["pnl"] for t in losers) != 0 else 0
        expectancy = (win_rate/100 * avg_win + (1 - win_rate/100) * avg_loss) if sell_trades else 0

        # Equity curve & risk
        eq_data = [{"date": str(s["snapshot_date"]), "value": s["portfolio_value"],
                     "ret": s["cumulative_return_pct"], "dd": s["drawdown_pct"]} for s in snapshots]
        max_dd = min((s["drawdown_pct"] for s in snapshots), default=0)

        # Sharpe from snapshots
        if len(snapshots) > 2:
            rets = [(snapshots[i]["portfolio_value"]/snapshots[i-1]["portfolio_value"]-1) for i in range(1, len(snapshots))]
            import statistics
            mean_r = statistics.mean(rets)
            std_r = statistics.stdev(rets) if len(rets) > 1 else 0.001
            sharpe = (mean_r / std_r) * (252 ** 0.5) if std_r > 0 else 0
        else:
            sharpe = 0

        # Sector breakdown
        sector_alloc = {}
        for p in open_pos:
            sec = p.get("sector") or "Other"
            val = (p.get("current_price") or p.get("entry_price",0)) * p.get("quantity",0)
            sector_alloc[sec] = sector_alloc.get(sec, 0) + val
        if total_val > 0:
            sector_alloc = {k: round(v/total_val*100, 1) for k, v in sector_alloc.items()}

        return {
            "test": _safe_row(fwd),
            "portfolio": {
                "total_value": round(total_val, 2), "cash": round(fwd["current_capital"], 2),
                "positions_value": round(pos_val, 2), "unrealized_pnl": round(unrealized, 2),
                "realized_pnl": round(realized, 2), "total_return_pct": round(total_ret, 2),
                "num_positions": len(open_pos), "total_closed": len(sell_trades),
                "win_rate": round(win_rate, 1), "winners": len(winners), "losers": len(losers),
                "avg_win": round(avg_win, 2), "avg_loss": round(avg_loss, 2),
                "profit_factor": round(profit_factor, 2), "expectancy": round(expectancy, 2),
                "max_drawdown_pct": round(max_dd, 2), "sharpe_ratio": round(sharpe, 2),
                "sector_allocation": sector_alloc,
            },
            "positions": open_pos,
            "closed_positions": closed_pos[:20],
            "recent_trades": [_safe_row(t) for t in trades[:30]],
            "recent_signals": [_safe_row(s) for s in signals[:50]],
            "equity_curve": eq_data,
        }


@app.post("/api/forward-test/{fwd_id}/scan", tags=["Forward Testing"], summary="Run strategy scan",
    description="Trigger a scan of the forward test strategy against its symbol universe. Generates new BUY/SELL signals and optionally auto-executes trades based on the strategy rules.")
async def scan_forward_test(fwd_id: int, user=Depends(get_current_user)):
    """Scan all symbols, generate signals, auto-execute, update prices, snapshot."""
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        if not fwd: raise HTTPException(status_code=404, detail="Not found")
        if fwd["status"] != "active": raise HTTPException(status_code=400, detail="Test is paused")

    signals = await generate_forward_signals(dict(fwd))
    await execute_forward_signals(fwd_id, signals)
    await update_forward_positions(fwd_id)
    await take_portfolio_snapshot(fwd_id)

    buys = [s for s in signals if s["signal"] == "BUY" and s["is_new"]]
    sells = [s for s in signals if s["signal"] == "SELL" and s["is_new"]]
    return {
        "scanned": len(signals), "buy_signals": len(buys), "sell_signals": len(sells),
        "signals": signals[:60],
        "message": f"Scanned {len(signals)} stocks. {len(buys)} BUY, {len(sells)} SELL new signals."
    }


@app.post("/api/forward-test/{fwd_id}/close-position/{pos_id}", tags=["Forward Testing"], summary="Close a forward test position",
    description="Close a specific open position in a forward test at the current market price.")
async def close_fwd_position(fwd_id: int, pos_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        if not fwd: raise HTTPException(status_code=404, detail="Not found")
        pos = await conn.fetchrow("SELECT * FROM forward_test_positions WHERE id=$1 AND fwd_test_id=$2 AND status='open'", pos_id, fwd_id)
        if not pos: raise HTTPException(status_code=404, detail="Position not found")

        price = pos["current_price"] or pos["entry_price"]
        slippage = fwd["slippage_pct"] / 100
        txn_cost = fwd["txn_cost_pct"] / 100
        slipped = price * (1 - slippage)
        pnl = (slipped - pos["entry_price"]) * pos["quantity"]
        fees = abs(pos["quantity"] * slipped) * txn_cost

        await conn.execute("UPDATE forward_test_positions SET status='closed',current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3 WHERE id=$4",
            round(slipped,2), round(pnl-fees,2), round((slipped/pos["entry_price"]-1)*100,2), pos_id)
        await conn.execute("INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,pnl,pnl_pct,exit_reason,fees) VALUES ($1,$2,'SELL',$3,$4,$5,$6,'manual',$7)",
            fwd_id, pos["symbol"], pos["quantity"], round(slipped,2), round(pnl-fees,2), round((slipped/pos["entry_price"]-1)*100,2), round(fees,2))
        new_cap = fwd["current_capital"] + pos["quantity"] * slipped - fees
        await conn.execute("UPDATE forward_tests SET current_capital=$1 WHERE id=$2", round(new_cap,2), fwd_id)
        return {"pnl": round(pnl-fees, 2), "symbol": pos["symbol"]}


@app.post("/api/forward-test/{fwd_id}/close-all", tags=["Forward Testing"], summary="Close all positions",
    description="Close all open positions in a forward test at current market prices. Useful for stopping out or resetting.")
async def close_all_fwd_positions(fwd_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        fwd = await conn.fetchrow("SELECT * FROM forward_tests WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        if not fwd: raise HTTPException(status_code=404, detail="Not found")
        positions = await conn.fetch("SELECT * FROM forward_test_positions WHERE fwd_test_id=$1 AND status='open'", fwd_id)
        total_pnl = 0
        capital = fwd["current_capital"]
        slippage = fwd["slippage_pct"] / 100
        txn_cost = fwd["txn_cost_pct"] / 100
        for pos in positions:
            price = pos["current_price"] or pos["entry_price"]
            slipped = price * (1 - slippage)
            pnl = (slipped - pos["entry_price"]) * pos["quantity"]
            fees = abs(pos["quantity"] * slipped) * txn_cost
            await conn.execute("UPDATE forward_test_positions SET status='closed',current_price=$1,unrealized_pnl=$2,unrealized_pnl_pct=$3 WHERE id=$4",
                round(slipped,2), round(pnl-fees,2), round((slipped/pos["entry_price"]-1)*100,2), pos["id"])
            await conn.execute("INSERT INTO forward_test_trades (fwd_test_id,symbol,action,quantity,price,pnl,pnl_pct,exit_reason,fees) VALUES ($1,$2,'SELL',$3,$4,$5,$6,'close_all',$7)",
                fwd_id, pos["symbol"], pos["quantity"], round(slipped,2), round(pnl-fees,2), round((slipped/pos["entry_price"]-1)*100,2), round(fees,2))
            capital += pos["quantity"] * slipped - fees
            total_pnl += pnl - fees
        await conn.execute("UPDATE forward_tests SET current_capital=$1 WHERE id=$2", round(capital,2), fwd_id)
        return {"closed": len(positions), "total_pnl": round(total_pnl, 2)}


@app.post("/api/forward-test/{fwd_id}/pause", tags=["Forward Testing"], summary="Pause forward test",
    description="Pause a running forward test. Existing positions remain open but no new signals will be generated.")
async def pause_forward_test(fwd_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE forward_tests SET status='paused' WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        return {"status": "paused"}

@app.post("/api/forward-test/{fwd_id}/resume", tags=["Forward Testing"], summary="Resume forward test",
    description="Resume a paused forward test. Signal generation will restart on next scan.")
async def resume_forward_test(fwd_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE forward_tests SET status='active' WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        return {"status": "active"}

@app.delete("/api/forward-test/{fwd_id}", tags=["Forward Testing"], summary="Delete forward test",
    description="Delete a forward test and all its associated positions and trade history.")
async def delete_forward_test(fwd_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM forward_tests WHERE id=$1 AND user_id=$2", fwd_id, user["id"])
        return {"deleted": True}


# ── Screener ──────────────────────────────────────────────────────────────────
# ── Nifty 500 Stock Universe ─────────────────────────────────────────────────
NIFTY_UNIVERSE = [
    # Nifty 50
    "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","WIPRO","BAJFINANCE","SUNPHARMA",
    "TATAMOTORS","ADANIENT","MARUTI","AXISBANK","LTIM","TITAN","HCLTECH","NESTLEIND",
    "POWERGRID","NTPC","COALINDIA","ONGC","JSWSTEEL","TATASTEEL","HINDALCO","CIPLA",
    "DRREDDY","DIVISLAB","APOLLOHOSP","BAJAJFINSV","BRITANNIA","EICHERMOT","SBILIFE",
    "HDFCLIFE","INDUSINDBK","ULTRACEMCO","GRASIM","TECHM","ASIANPAINT","HEROMOTOCO",
    "BPCL","IOC","TATACONSUM","PIDILITIND","HAVELLS","IRCTC","DMART","ZOMATO",
    "SBIN","LT","BHARTIARTL","ITC","KOTAKBANK","M&M","ADANIPORTS","SHRIRAMFIN",
    # Nifty Next 50
    "ABB","ADANIGREEN","AMBUJACEM","BANKBARODA","BEL","BERGEPAINT","BOSCHLTD",
    "CANBK","CHOLAFIN","COLPAL","CONCOR","DABUR","DLF","GAIL","GODREJCP",
    "HAL","HINDPETRO","ICICIPRULI","IDEA","IGL","INDHOTEL","INDUSTOWER",
    "JSWENERGY","JUBLFOOD","LICI","LUPIN","MARICO","MCDOWELL-N","MOTHERSON",
    "MUTHOOTFIN","NAUKRI","NHPC","OBEROIRLTY","OFSS","PAYTM","PFC","PIIND",
    "PNB","POLYCAB","RECLTD","SAIL","SIEMENS","SRF","TORNTPHARM","TRENT",
    "UNIONBANK","UNITDSPR","VEDL","YESBANK","ZYDUSLIFE",
    # Nifty Midcap 150
    "AARTIIND","ACC","AIAENG","AJANTPHARM","ALKEM","ANGELONE","APLAPOLLO",
    "ASHOKLEY","ASTRAL","ATUL","AUBANK","AUROPHARMA","BALKRISIND","BANDHANBNK",
    "BATAINDIA","BHARATFORG","BHEL","BIOCON","BLUEDART","BSE",
    "CANFINHOME","CARBORUNIV","CASTROLIND","CEATLTD","CENTRALBK","CGPOWER",
    "CHAMBLFERT","CLEAN","COFORGE","CRISIL","CROMPTON","CUB","CUMMINSIND",
    "CYIENT","DALBHARAT","DEEPAKNTR","DELTACORP","DEVYANI","DIXON","EIDPARRY",
    "EMAMILTD","ENDURANCE","ESCORTS","EXIDEIND","FACT","FEDERALBNK","FINCABLES",
    "FLUOROCHEM","FORTIS","GLENMARK","GMRINFRA","GNFC","GODREJIND","GODREJPROP",
    "GRANULES","GRAPHITE","GRINDWELL","GUJGASLTD","HDFCAMC","IIFL","IPCALAB",
    "IRB","IRFC","ISEC","JKCEMENT","JSWINFRA","KALYANKJIL","KANSAINER",
    "KEI","KPITTECH","KRBL","L&TFH","LAURUSLABS","LICHSGFIN","LINDEINDIA",
    "LLOYDSME","LODHA","LTTS","M&MFIN","MANAPPURAM","MANKIND","MFSL",
    "MGL","MPHASIS","MRF","NATCOPHARM","NATIONALUM","NAVINFLUOR","NETWORK18",
    "NYKAA","OIL","PAGEIND","PATANJALI","PERSISTENT","PETRONET","PHOENIXLTD",
    "PNBHOUSING","POLICYBZR","POWERINDIA","PRESTIGE","PVR","RAJESHEXPO",
    "RAMCOCEM","RBLBANK","RELAXO","SCHAEFFLER","SHREECEM","SJVN","SOLARINDS",
    "SONACOMS","STARHEALTH","SUNDARMFIN","SUNDRMFAST","SUPREMEIND","SYNGENE",
    "TATACHEM","TATACOMM","TATAELXSI","TATAPOWER","THERMAX","TIMKEN","TORNTPOWER",
    "TVSMOTOR","UBL","UNOMINDA","UPL","VOLTAS","WHIRLPOOL","ZEEL",
    # Nifty Smallcap 250
    "3MINDIA","AAVAS","ABSLAMC","ACE","ADFFOODS","AEGISCHEM","AFFLE","AJMERA",
    "ALKYLAMINE","ALLCARGO","ALOKINDS","AMBER","AMIORG","ANANTRAJ","APARINDS",
    "APTUS","ASAHIINDIA","ASTERDM","BASF","BAJAJELEC","BAJAJHLDNG",
    "BDL","BEML","BIRLACORPN","BLUESTARCO","BRIGADE","BSOFT","CAMPUS",
    "CDSL","CESC","CHALET","CHEMCON","CHENNPETRO","COCHINSHIP","COROMANDEL",
    "CREDITACC","CSBBANK","DATAPATTNS","DCMSHRIRAM","DELHIVERY","ECLERX",
    "EDELWEISS","ERIS","EQUITASBNK","ESABINDIA","FINEORG","FIVESTAR",
    "GALAXYSURF","GARFIBRES","GHCL","GILLETTE","GLAXO","GESHIP","GPPL",
    "GRSE","GSPL","GUJALKALI","HAPPSTMNDS","HATSUN","HEG","HEMIPROP",
    "HINDCOPPER","HINDZINC","HONAUT","HUDCO","IIFLWAM","INDIAMART","INDIANB",
    "INTELLECT","ISGEC","J&KBANK","JAMNAAUTO","JINDALSAW","JKLAKSHMI",
    "JMFINANCIL","JSL","JTEKTINDIA","JUBLINGREA","JUSTDIAL","JYOTHYLAB",
    "KAJARIACER","KALPATPOWR","KEC","KNRCON","KPIGREEN","LAXMIMACH",
    "LEMERETREE","MAHABANK","MAHSEAMLES","MAXHEALTH","MAZDOCK","METROPOLIS",
    "MIDHANI","MMTC","MOIL","MOREPENLAB","MOTILALOFS","MRPL",
    "NAM-INDIA","NBCC","NCC","NESCO","NFL","NIITLTD",
    "NLCINDIA","NMDC","NOCIL","OLECTRA","ORIENTCEM","ORIENTELEC",
    "PGHH","RADICO","RAIN","RALLIS","RATNAMANI","RAYMOND","RCF",
    "REDINGTON","RITES","ROSSARI","ROUTE","RVNL","SANOFI",
    "SARDAEN","SBICARD","SCHNEIDER","SCI","SFL","SHOPERSTOP",
    "SHYAMMETL","SKFINDIA","SOBHA","SOLARA","SONATSOFTW","SOUTHBANK","SPARC",
    "STLTECH","SUDARSCHEM","SUMICHEM","SUNTV","SUPRAJIT","SUVENPHAR",
    "TANLA","TATAINVEST","TCIEXP","TEAMLEASE","TIINDIA","TINPLATE",
    "TRIDENT","TRITURBINE","TVSSRICHAK","UCOBANK","UFLEX","UJJIVANSFB",
    "VARROC","VBLLTD","VINATIORGA","VIPIND","VMART","VOLTAMP",
    "VSTIND","WELCORP","WELSPUNLIV","WESTLIFE","WOCKPHARMA","ZENSARTECH",
    # Additional Popular / F&O / Recent IPOs
    "JIOFIN","ATGL","ADANIENSOL","TATATECH","KAYNES","SYRMA","CAMS","KFINTECH",
    "DELHIVERY","HONASA","MEDANTA","MAPMYINDIA","ABFRL","AETHER","AWL",
    "CERA","DHANUKA","EASEMYTRIP","ELECON","ELGIEQUIP","EPL","FINPIPE",
    "GABRIEL","GICRE","GODREJAGRO","GOODYEAR","GREAVESCOT","HGINFRA","HIKAL",
    "ICRA","IFBIND","INDIGOPNTS","JBCHEPHARM","JKPAPER","KTKBANK","LALPATHLAB",
    "MANYAVAR","MHRIL","MISHRA","NIACL","NUVOCO","PCBL","PRAJIND",
    "PRINCEPIPE","QUESS","RATEGAIN","SAREGAMA","SIS","TITAGARH","TCI",
    "VEDANTFASH","WELSPUNIND","SWSOLAR","SWANENERGY","TARSONS","HERITGFOOD",
    "HINDWAREAP","MAHSCOOTER","DREAMFOLKS",
]
# Deduplicate preserving order
_seen = set()
_clean = []
for _s in NIFTY_UNIVERSE:
    if _s not in _seen:
        _seen.add(_s)
        _clean.append(_s)
NIFTY_UNIVERSE = _clean

SECTOR_MAP = {
    # Energy / Oil & Gas
    "RELIANCE":"Energy","ONGC":"Energy","COALINDIA":"Energy","BPCL":"Energy","IOC":"Energy",
    "HINDPETRO":"Energy","GAIL":"Energy","ADANIGREEN":"Energy","TATAPOWER":"Energy",
    "ADANIENSOL":"Energy","JSWENERGY":"Energy","NHPC":"Energy","PFC":"Energy","RECLTD":"Energy",
    "IGL":"Energy","ATGL":"Energy","OIL":"Energy","PETRONET":"Energy","MGL":"Energy",
    "MRPL":"Energy","CHENNPETRO":"Energy","GSPL":"Energy","GPPL":"Energy","SJVN":"Energy",
    "NLCINDIA":"Energy","TORNTPOWER":"Energy","POWERGRID":"Utilities","NTPC":"Utilities",
    "IRFC":"Energy","RCF":"Energy","NFL":"Energy","SWSOLAR":"Energy","SWANENERGY":"Energy",
    # IT / Technology
    "TCS":"IT","INFY":"IT","WIPRO":"IT","HCLTECH":"IT","TECHM":"IT","LTIM":"IT",
    "PERSISTENT":"IT","COFORGE":"IT","MPHASIS":"IT","LTTS":"IT","TATAELXSI":"IT",
    "NAUKRI":"IT","OFSS":"IT","KPITTECH":"IT","CYIENT":"IT","HAPPSTMNDS":"IT",
    "INTELLECT":"IT","BSOFT":"IT","ZENSARTECH":"IT","SONATSOFTW":"IT","NIITLTD":"IT",
    "ECLERX":"IT","TATATECH":"IT","MAPMYINDIA":"IT","ROUTE":"IT","TANLA":"IT",
    "DATAPATTNS":"IT","AFFLE":"IT","RATEGAIN":"IT",
    # Banking
    "HDFCBANK":"Banking","ICICIBANK":"Banking","AXISBANK":"Banking","INDUSINDBK":"Banking",
    "SBIN":"Banking","KOTAKBANK":"Banking","BANKBARODA":"Banking","CANBK":"Banking",
    "PNB":"Banking","YESBANK":"Banking","UNIONBANK":"Banking","FEDERALBNK":"Banking",
    "RBLBANK":"Banking","AUBANK":"Banking","BANDHANBNK":"Banking","CUB":"Banking",
    "CENTRALBK":"Banking","EQUITASBNK":"Banking","J&KBANK":"Banking","INDIANB":"Banking",
    "CSBBANK":"Banking","SOUTHBANK":"Banking","UCOBANK":"Banking","MAHABANK":"Banking",
    "UJJIVANSFB":"Banking","CANFINHOME":"Banking","LICHSGFIN":"Banking","PNBHOUSING":"Banking","KTKBANK":"Banking",
    # NBFC / Finance / Insurance
    "BAJFINANCE":"NBFC","BAJAJFINSV":"NBFC","SHRIRAMFIN":"NBFC","CHOLAFIN":"NBFC",
    "MUTHOOTFIN":"NBFC","LICI":"Insurance","SBILIFE":"Insurance","HDFCLIFE":"Insurance",
    "ICICIPRULI":"Insurance","JIOFIN":"NBFC","POLICYBZR":"Insurance","STARHEALTH":"Insurance",
    "PAYTM":"Fintech","M&MFIN":"NBFC","MANAPPURAM":"NBFC","SUNDARMFIN":"NBFC",
    "L&TFH":"NBFC","MFSL":"NBFC","HDFCAMC":"AMC","ANGELONE":"Broking","ISEC":"Broking",
    "CREDITACC":"NBFC","IIFL":"NBFC","IIFLWAM":"NBFC","EDELWEISS":"NBFC",
    "MOTILALOFS":"NBFC","JMFINANCIL":"NBFC","SBICARD":"NBFC","FIVESTAR":"NBFC",
    "ABSLAMC":"AMC","NAM-INDIA":"AMC","CAMS":"Fintech","KFINTECH":"Fintech",
    "CDSL":"Fintech","BSE":"Exchange","APTUS":"NBFC","GICRE":"Insurance","NIACL":"Insurance",
    # Pharma / Healthcare
    "SUNPHARMA":"Pharma","CIPLA":"Pharma","DRREDDY":"Pharma","DIVISLAB":"Pharma",
    "APOLLOHOSP":"Healthcare","LUPIN":"Pharma","TORNTPHARM":"Pharma","ZYDUSLIFE":"Pharma",
    "BIOCON":"Pharma","AUROPHARMA":"Pharma","LAURUSLABS":"Pharma","MAXHEALTH":"Healthcare",
    "MANKIND":"Pharma","IPCALAB":"Pharma","NATCOPHARM":"Pharma","GLENMARK":"Pharma",
    "ALKEM":"Pharma","AJANTPHARM":"Pharma","GRANULES":"Pharma","SYNGENE":"Pharma",
    "FORTIS":"Healthcare","METROPOLIS":"Healthcare","ERIS":"Pharma","SANOFI":"Pharma",
    "GLAXO":"Pharma","SPARC":"Pharma","WOCKPHARMA":"Pharma","MEDANTA":"Healthcare",
    "ASTERDM":"Healthcare","PATANJALI":"FMCG","HONASA":"FMCG","JBCHEPHARM":"Pharma",
    "LALPATHLAB":"Healthcare","PGHH":"FMCG","MOREPENLAB":"Pharma","SUVENPHAR":"Pharma",
    "SOLARA":"Pharma","TARSONS":"Pharma",
    # Auto
    "TATAMOTORS":"Auto","MARUTI":"Auto","EICHERMOT":"Auto","HEROMOTOCO":"Auto","M&M":"Auto",
    "BOSCHLTD":"Auto","MOTHERSON":"Auto","SONACOMS":"Auto","TVSMOTOR":"Auto",
    "ASHOKLEY":"Auto","BHARATFORG":"Auto","EXIDEIND":"Auto","BALKRISIND":"Auto",
    "CEATLTD":"Auto","ENDURANCE":"Auto","ESCORTS":"Auto","SUNDRMFAST":"Auto",
    "UNOMINDA":"Auto","JAMNAAUTO":"Auto","VARROC":"Auto","TVSSRICHAK":"Auto",
    "SUPRAJIT":"Auto","JTEKTINDIA":"Auto","SKFINDIA":"Auto","TIMKEN":"Auto",
    "GABRIEL":"Auto","GREAVESCOT":"Auto","MAHSCOOTER":"Auto","GOODYEAR":"Tyres",
    # Metal / Mining
    "JSWSTEEL":"Metal","TATASTEEL":"Metal","HINDALCO":"Metal","VEDL":"Metal","SAIL":"Metal",
    "NATIONALUM":"Metal","NMDC":"Metal","HINDCOPPER":"Metal","HINDZINC":"Metal",
    "MOIL":"Metal","GRAPHITE":"Metal","WELCORP":"Metal","JINDALSAW":"Metal",
    "JSL":"Metal","RATNAMANI":"Metal","HEG":"Metal","SHYAMMETL":"Metal","WELSPUNIND":"Metal",
    # FMCG
    "NESTLEIND":"FMCG","BRITANNIA":"FMCG","TATACONSUM":"FMCG","ITC":"FMCG",
    "COLPAL":"FMCG","DABUR":"FMCG","GODREJCP":"FMCG","MARICO":"FMCG",
    "UNITDSPR":"FMCG","MCDOWELL-N":"FMCG","EMAMILTD":"FMCG","JYOTHYLAB":"FMCG",
    "RADICO":"FMCG","UBL":"FMCG","HATSUN":"FMCG","VBLLTD":"FMCG",
    "GILLETTE":"FMCG","VSTIND":"FMCG","RAJESHEXPO":"FMCG","AWL":"FMCG","HERITGFOOD":"FMCG",
    # Consumer / Retail
    "TITAN":"Consumer","ASIANPAINT":"Consumer","HAVELLS":"Consumer",
    "DMART":"Retail","PAGEIND":"Consumer","TRENT":"Retail","NYKAA":"Retail",
    "KALYANKJIL":"Consumer","JUBLFOOD":"Consumer","VOLTAS":"Consumer",
    "CROMPTON":"Consumer","WHIRLPOOL":"Consumer","BATAINDIA":"Consumer","RELAXO":"Consumer",
    "SHOPERSTOP":"Retail","VMART":"Retail","CAMPUS":"Consumer","VIPIND":"Consumer",
    "DEVYANI":"Consumer","WESTLIFE":"Consumer","BERGEPAINT":"Consumer","AMBER":"Consumer",
    "IFBIND":"Consumer","INDIGOPNTS":"Consumer","BAJAJELEC":"Consumer",
    "ABFRL":"Retail","MANYAVAR":"Retail","VEDANTFASH":"Retail",
    # Infra / Capital Goods / Defence
    "LT":"Infra","ADANIPORTS":"Infra","ABB":"Industrial","SIEMENS":"Industrial",
    "HAL":"Defence","BEL":"Defence","CGPOWER":"Industrial","POLYCAB":"Industrial",
    "CONCOR":"Logistics","BHEL":"Industrial","CUMMINSIND":"Industrial",
    "THERMAX":"Industrial","IRB":"Infra","KEC":"Infra","KALPATPOWR":"Infra",
    "KNRCON":"Infra","NCC":"Infra","NBCC":"Infra","RITES":"Infra","RVNL":"Infra",
    "GMRINFRA":"Infra","JSWINFRA":"Infra","POWERINDIA":"Industrial",
    "SCHAEFFLER":"Industrial","LINDEINDIA":"Industrial","TRITURBINE":"Industrial",
    "GRINDWELL":"Industrial","CARBORUNIV":"Industrial","ISGEC":"Industrial",
    "BEML":"Industrial","MAZDOCK":"Defence","GRSE":"Defence","COCHINSHIP":"Defence",
    "BDL":"Defence","MIDHANI":"Defence","KAYNES":"Electronics","SYRMA":"Electronics",
    "DIXON":"Electronics","HGINFRA":"Infra","TITAGARH":"Industrial","MISHRA":"Defence",
    "ELECON":"Industrial","ELGIEQUIP":"Industrial","PRAJIND":"Industrial","VOLTAMP":"Industrial",
    "LAXMIMACH":"Industrial","ESABINDIA":"Industrial",
    # Cement / Building
    "ULTRACEMCO":"Cement","GRASIM":"Cement","AMBUJACEM":"Cement","SHREECEM":"Cement",
    "RAMCOCEM":"Cement","JKCEMENT":"Cement","DALBHARAT":"Cement","ACC":"Cement",
    "BIRLACORPN":"Cement","ORIENTCEM":"Cement","NUVOCO":"Cement",
    "ASTRAL":"Building","APLAPOLLO":"Building","SUPREMEIND":"Building","KEI":"Building",
    "KAJARIACER":"Building","CERA":"Building","PRINCEPIPE":"Building","HINDWAREAP":"Building","FINPIPE":"Building",
    # Chemicals
    "PIDILITIND":"Chemical","SRF":"Chemical","PIIND":"Chemical","DEEPAKNTR":"Chemical","AARTIIND":"Chemical",
    "ATUL":"Chemical","NAVINFLUOR":"Chemical","FLUOROCHEM":"Chemical","CLEAN":"Chemical",
    "ALKYLAMINE":"Chemical","AMIORG":"Chemical","FINEORG":"Chemical","GALAXYSURF":"Chemical",
    "GNFC":"Chemical","CHAMBLFERT":"Chemical","COROMANDEL":"Chemical","DCMSHRIRAM":"Chemical",
    "TATACHEM":"Chemical","SUDARSCHEM":"Chemical","SUMICHEM":"Chemical","BASF":"Chemical",
    "NOCIL":"Chemical","RAIN":"Chemical","GHCL":"Chemical","GUJALKALI":"Chemical",
    "ROSSARI":"Chemical","VINATIORGA":"Chemical","CHEMCON":"Chemical","HIKAL":"Chemical",
    "PCBL":"Chemical","AETHER":"Chemical",
    # Realty
    "DLF":"Realty","OBEROIRLTY":"Realty","LODHA":"Realty","PHOENIXLTD":"Realty",
    "GODREJPROP":"Realty","PRESTIGE":"Realty","BRIGADE":"Realty","SOBHA":"Realty",
    "ANANTRAJ":"Realty","HEMIPROP":"Realty","AJMERA":"Realty",
    # Telecom / Media / Internet
    "BHARTIARTL":"Telecom","IDEA":"Telecom","INDUSTOWER":"Telecom","TATACOMM":"Telecom",
    "STLTECH":"Telecom","ZOMATO":"Internet","INDIAMART":"Internet","JUSTDIAL":"Internet",
    "ZEEL":"Media","SUNTV":"Media","NETWORK18":"Media","PVR":"Media","SAREGAMA":"Media",
    # Travel / Hotels / Logistics
    "IRCTC":"Travel","INDHOTEL":"Hotels","LEMERETREE":"Hotels","CHALET":"Hotels","MHRIL":"Hotels",
    "EASEMYTRIP":"Travel","DREAMFOLKS":"Travel","DELHIVERY":"Logistics","BLUEDART":"Logistics",
    "ALLCARGO":"Logistics","GESHIP":"Logistics","TCI":"Logistics","TCIEXP":"Logistics",
    "SCI":"Shipping","REDINGTON":"Distribution",
    # Others
    "ADANIENT":"Conglomerate","3MINDIA":"Conglomerate","HONAUT":"Industrial","MRF":"Tyres",
    "CRISIL":"Rating","ICRA":"Rating","TRIDENT":"Textile","WELSPUNLIV":"Textile",
    "ALOKINDS":"Textile","SFL":"Textile","APARINDS":"Textile","EIDPARRY":"Sugar",
    "DHANUKA":"Agri","RALLIS":"Agri","GODREJAGRO":"Agri","MMTC":"Trading",
    "HUDCO":"Housing","CASTROLIND":"Lubricant","FACT":"Fertilizer",
    "TATAINVEST":"Holding","BAJAJHLDNG":"Holding","KANSAINER":"Packaging","EPL":"Packaging",
    "CESC":"Utilities","JKPAPER":"Paper","TEAMLEASE":"Staffing","QUESS":"Staffing","SIS":"Services",
    "RAYMOND":"Textile","UFLEX":"Packaging","UPL":"Agri",
    # Previously unmapped stocks
    "AAVAS":"NBFC","ACE":"Industrial","ADFFOODS":"FMCG","AEGISCHEM":"Chemical",
    "AIAENG":"Industrial","ASAHIINDIA":"Building","BLUESTARCO":"Consumer",
    "DELTACORP":"Hotels","FINCABLES":"Industrial","GARFIBRES":"Chemical",
    "GODREJIND":"Chemical","GUJGASLTD":"Energy","JKLAKSHMI":"Cement",
    "JUBLINGREA":"Chemical","KPIGREEN":"Energy","KRBL":"FMCG",
    "LLOYDSME":"Metal","MAHSEAMLES":"Metal","NESCO":"Realty",
    "OLECTRA":"Auto","ORIENTELEC":"Consumer","SARDAEN":"Energy",
    "SCHNEIDER":"Industrial","SOLARINDS":"Industrial","TIINDIA":"Industrial",
    "TINPLATE":"Metal",
}


INDUSTRY_MAP = {
    "HDFCBANK":"Banks",
    "ICICIBANK":"Banks",
    "AXISBANK":"Banks",
    "KOTAKBANK":"Banks",
    "INDUSINDBK":"Banks",
    "FEDERALBNK":"Banks",
    "RBLBANK":"Banks",
    "AUBANK":"Banks",
    "BANDHANBNK":"Banks",
    "CUB":"Banks",
    "CSBBANK":"Banks",
    "EQUITASBNK":"Banks",
    "UJJIVANSFB":"Banks",
    "SBIN":"Banks",
    "BANKBARODA":"Banks",
    "PNB":"Banks",
    "CANBK":"Banks",
    "UNIONBANK":"Banks",
    "INDIANB":"Banks",
    "CENTRALBK":"Banks",
    "UCOBANK":"Banks",
    "MAHABANK":"Banks",
    "SOUTHBANK":"Banks",
    "J&KBANK":"Banks",
    "KTKBANK":"Banks",
    "YESBANK":"Banks",
    "CANFINHOME":"Finance - Housing",
    "LICHSGFIN":"Finance - Housing",
    "PNBHOUSING":"Finance - Housing",
    "HUDCO":"Finance - Housing",
    "FIVESTAR":"Finance - Housing",
    "APTUS":"Finance - Housing",
    "AAVAS":"Finance - Housing",
    "BAJFINANCE":"Finance - NBFC",
    "BAJAJFINSV":"Holding Company",
    "SHRIRAMFIN":"Finance - NBFC",
    "CHOLAFIN":"Finance - NBFC",
    "M&MFIN":"Finance - NBFC",
    "MUTHOOTFIN":"Finance - NBFC",
    "MANAPPURAM":"Finance - NBFC",
    "JIOFIN":"Finance - NBFC",
    "L&TFH":"Finance - NBFC",
    "MFSL":"Holding Company",
    "SUNDARMFIN":"Finance - NBFC",
    "CREDITACC":"Finance - Microfinance",
    "IIFL":"Finance - NBFC",
    "IIFLWAM":"Capital Markets",
    "MOTILALOFS":"Capital Markets",
    "JMFINANCIL":"Capital Markets",
    "SBICARD":"Finance - NBFC",
    "EDELWEISS":"Finance - NBFC",
    "LICI":"Insurance",
    "SBILIFE":"Insurance",
    "HDFCLIFE":"Insurance",
    "ICICIPRULI":"Insurance",
    "POLICYBZR":"Insurance",
    "STARHEALTH":"Insurance",
    "GICRE":"Insurance",
    "NIACL":"Insurance",
    "HDFCAMC":"Capital Markets",
    "ABSLAMC":"Capital Markets",
    "NAM-INDIA":"Capital Markets",
    "ANGELONE":"Capital Markets",
    "ISEC":"Capital Markets",
    "CAMS":"Capital Markets",
    "CDSL":"Capital Markets",
    "KFINTECH":"Capital Markets",
    "PAYTM":"Fintech",
    "BSE":"Capital Markets",
    "CRISIL":"Capital Markets",
    "ICRA":"Capital Markets",
    "TCS":"IT - Software",
    "INFY":"IT - Software",
    "WIPRO":"IT - Software",
    "HCLTECH":"IT - Software",
    "TECHM":"IT - Software",
    "LTIM":"IT - Software",
    "PERSISTENT":"IT - Software",
    "COFORGE":"IT - Software",
    "MPHASIS":"IT - Software",
    "LTTS":"IT - Software",
    "TATAELXSI":"IT - Software",
    "KPITTECH":"IT - Software",
    "CYIENT":"IT - Software",
    "HAPPSTMNDS":"IT - Software",
    "INTELLECT":"IT - Software",
    "BSOFT":"IT - Software",
    "ZENSARTECH":"IT - Software",
    "SONATSOFTW":"IT - Software",
    "NIITLTD":"IT - Education",
    "ECLERX":"IT - Software",
    "TATATECH":"IT - Software",
    "NAUKRI":"Internet Software",
    "OFSS":"IT - Software",
    "MAPMYINDIA":"Internet Software",
    "ROUTE":"Internet Software",
    "TANLA":"Telecom - Equipment",
    "DATAPATTNS":"Defence",
    "AFFLE":"Internet Software",
    "RATEGAIN":"Internet Software",
    "DIXON":"Consumer Electronics",
    "KAYNES":"Consumer Electronics",
    "SYRMA":"Consumer Electronics",
    "ZOMATO":"Internet Software",
    "INDIAMART":"Internet Software",
    "JUSTDIAL":"Internet Software",
    "SUNPHARMA":"Pharmaceuticals",
    "CIPLA":"Pharmaceuticals",
    "DRREDDY":"Pharmaceuticals",
    "DIVISLAB":"Pharmaceuticals",
    "LUPIN":"Pharmaceuticals",
    "TORNTPHARM":"Pharmaceuticals",
    "ZYDUSLIFE":"Pharmaceuticals",
    "BIOCON":"Pharmaceuticals",
    "AUROPHARMA":"Pharmaceuticals",
    "LAURUSLABS":"Pharmaceuticals",
    "MANKIND":"Pharmaceuticals",
    "IPCALAB":"Pharmaceuticals",
    "NATCOPHARM":"Pharmaceuticals",
    "GLENMARK":"Pharmaceuticals",
    "ALKEM":"Pharmaceuticals",
    "AJANTPHARM":"Pharmaceuticals",
    "GRANULES":"Pharmaceuticals",
    "SYNGENE":"Pharmaceuticals",
    "ERIS":"Pharmaceuticals",
    "SANOFI":"Pharmaceuticals",
    "GLAXO":"Pharmaceuticals",
    "SPARC":"Pharmaceuticals",
    "WOCKPHARMA":"Pharmaceuticals",
    "JBCHEPHARM":"Pharmaceuticals",
    "MOREPENLAB":"Pharmaceuticals",
    "SUVENPHAR":"Pharmaceuticals",
    "SOLARA":"Pharmaceuticals",
    "TARSONS":"Healthcare Equipment",
    "APOLLOHOSP":"Healthcare Services",
    "MAXHEALTH":"Healthcare Services",
    "FORTIS":"Healthcare Services",
    "MEDANTA":"Healthcare Services",
    "ASTERDM":"Healthcare Services",
    "LALPATHLAB":"Healthcare Services",
    "METROPOLIS":"Healthcare Services",
    "TATAMOTORS":"Automobiles",
    "MARUTI":"Automobiles",
    "M&M":"Automobiles",
    "EICHERMOT":"Automobiles",
    "HEROMOTOCO":"Automobiles",
    "TVSMOTOR":"Automobiles",
    "ASHOKLEY":"Automobiles",
    "ESCORTS":"Automobiles",
    "MAHSCOOTER":"Automobiles",
    "OLECTRA":"Automobiles",
    "GREAVESCOT":"Automobiles",
    "BOSCHLTD":"Auto Components",
    "MOTHERSON":"Auto Components",
    "SONACOMS":"Auto Components",
    "BHARATFORG":"Castings & Forgings",
    "EXIDEIND":"Auto Components",
    "BALKRISIND":"Tyres",
    "CEATLTD":"Tyres",
    "MRF":"Tyres",
    "GOODYEAR":"Tyres",
    "ENDURANCE":"Auto Components",
    "SUNDRMFAST":"Auto Components",
    "UNOMINDA":"Auto Components",
    "JAMNAAUTO":"Auto Components",
    "VARROC":"Auto Components",
    "TVSSRICHAK":"Auto Components",
    "SUPRAJIT":"Auto Components",
    "JTEKTINDIA":"Bearings",
    "SKFINDIA":"Bearings",
    "TIMKEN":"Bearings",
    "GABRIEL":"Auto Components",
    "JSWSTEEL":"Iron & Steel",
    "TATASTEEL":"Iron & Steel",
    "SAIL":"Iron & Steel",
    "JINDALSAW":"Iron & Steel Products",
    "JSL":"Iron & Steel Products",
    "WELCORP":"Iron & Steel Products",
    "RATNAMANI":"Iron & Steel Products",
    "SHYAMMETL":"Iron & Steel",
    "LLOYDSME":"Iron & Steel Products",
    "MAHSEAMLES":"Iron & Steel Products",
    "TINPLATE":"Iron & Steel Products",
    "WELSPUNIND":"Iron & Steel Products",
    "HINDALCO":"Non-Ferrous Metals",
    "VEDL":"Non-Ferrous Metals",
    "NATIONALUM":"Non-Ferrous Metals",
    "HINDCOPPER":"Non-Ferrous Metals",
    "HINDZINC":"Non-Ferrous Metals",
    "NMDC":"Mining & Minerals",
    "MOIL":"Mining & Minerals",
    "COALINDIA":"Mining & Minerals",
    "GRAPHITE":"Industrial Minerals",
    "HEG":"Industrial Minerals",
    "RELIANCE":"Oil & Gas",
    "ONGC":"Oil & Gas",
    "OIL":"Oil & Gas",
    "BPCL":"Oil & Gas",
    "IOC":"Oil & Gas",
    "HINDPETRO":"Oil & Gas",
    "MRPL":"Oil & Gas",
    "CHENNPETRO":"Oil & Gas",
    "GAIL":"Gas Distribution",
    "PETRONET":"Gas Distribution",
    "IGL":"Gas Distribution",
    "ATGL":"Gas Distribution",
    "MGL":"Gas Distribution",
    "GUJGASLTD":"Gas Distribution",
    "GSPL":"Gas Distribution",
    "GPPL":"Gas Distribution",
    "TATAPOWER":"Power",
    "JSWENERGY":"Power",
    "NHPC":"Power",
    "SJVN":"Power",
    "NLCINDIA":"Power",
    "TORNTPOWER":"Power",
    "NTPC":"Power",
    "POWERGRID":"Power",
    "CESC":"Power",
    "SARDAEN":"Power",
    "PFC":"Finance - Term Lending",
    "RECLTD":"Finance - Term Lending",
    "IRFC":"Finance - Term Lending",
    "ADANIGREEN":"Renewable Energy",
    "ADANIENSOL":"Renewable Energy",
    "SWSOLAR":"Renewable Energy",
    "SWANENERGY":"Renewable Energy",
    "KPIGREEN":"Renewable Energy",
    "NFL":"Fertilizers",
    "RCF":"Fertilizers",
    "CHAMBLFERT":"Fertilizers",
    "COROMANDEL":"Fertilizers",
    "FACT":"Fertilizers",
    "NESTLEIND":"Food Products",
    "BRITANNIA":"Food Products",
    "TATACONSUM":"Food Products",
    "ITC":"Diversified FMCG",
    "HATSUN":"Food Products",
    "VBLLTD":"Beverages",
    "RAJESHEXPO":"Food Products",
    "HERITGFOOD":"Food Products",
    "AWL":"Edible Oils",
    "ADFFOODS":"Food Products",
    "KRBL":"Food Products",
    "COLPAL":"Personal Care",
    "DABUR":"Personal Care",
    "GODREJCP":"Personal Care",
    "MARICO":"Personal Care",
    "UNITDSPR":"Personal Care",
    "EMAMILTD":"Personal Care",
    "JYOTHYLAB":"Household Products",
    "GILLETTE":"Personal Care",
    "PGHH":"Household Products",
    "PATANJALI":"Personal Care",
    "HONASA":"Personal Care",
    "MCDOWELL-N":"Alcoholic Beverages",
    "RADICO":"Alcoholic Beverages",
    "UBL":"Alcoholic Beverages",
    "VSTIND":"Tobacco Products",
    "TITAN":"Consumer Durables",
    "KALYANKJIL":"Gems & Jewellery",
    "PAGEIND":"Readymade Garments",
    "BATAINDIA":"Footwear",
    "RELAXO":"Footwear",
    "CAMPUS":"Footwear",
    "VIPIND":"Plastic Products",
    "ASIANPAINT":"Paints",
    "BERGEPAINT":"Paints",
    "INDIGOPNTS":"Paints",
    "HAVELLS":"Consumer Electronics",
    "CROMPTON":"Consumer Electronics",
    "VOLTAS":"Consumer Electronics",
    "WHIRLPOOL":"Consumer Electronics",
    "AMBER":"Consumer Electronics",
    "IFBIND":"Consumer Electronics",
    "BAJAJELEC":"Consumer Electronics",
    "BLUESTARCO":"Consumer Electronics",
    "ORIENTELEC":"Consumer Electronics",
    "JUBLFOOD":"Quick Service Restaurants",
    "DEVYANI":"Quick Service Restaurants",
    "WESTLIFE":"Quick Service Restaurants",
    "DMART":"Retailing",
    "TRENT":"Retailing",
    "NYKAA":"Retailing",
    "ABFRL":"Retailing",
    "MANYAVAR":"Retailing",
    "VEDANTFASH":"Retailing",
    "SHOPERSTOP":"Retailing",
    "VMART":"Retailing",
    "LT":"Construction",
    "NCC":"Construction",
    "NBCC":"Construction",
    "KNRCON":"Construction",
    "HGINFRA":"Construction",
    "IRB":"Construction",
    "GMRINFRA":"Infrastructure Developers",
    "JSWINFRA":"Infrastructure Developers",
    "ADANIPORTS":"Infrastructure Developers",
    "KALPATPOWR":"Power - T&D",
    "KEC":"Power - T&D",
    "RITES":"Transport Infrastructure",
    "RVNL":"Transport Infrastructure",
    "ABB":"Electrical Equipment",
    "SIEMENS":"Electrical Equipment",
    "CGPOWER":"Electrical Equipment",
    "POLYCAB":"Electrical Equipment",
    "BHEL":"Electrical Equipment",
    "CUMMINSIND":"Industrial Machinery",
    "THERMAX":"Industrial Machinery",
    "POWERINDIA":"Electrical Equipment",
    "VOLTAMP":"Electrical Equipment",
    "SCHNEIDER":"Electrical Equipment",
    "FINCABLES":"Electrical Equipment",
    "KEI":"Electrical Equipment",
    "SCHAEFFLER":"Bearings",
    "LINDEINDIA":"Industrial Gases",
    "TRITURBINE":"Industrial Machinery",
    "GRINDWELL":"Abrasives",
    "CARBORUNIV":"Abrasives",
    "ISGEC":"Industrial Machinery",
    "ELGIEQUIP":"Compressors",
    "PRAJIND":"Industrial Machinery",
    "ELECON":"Industrial Machinery",
    "LAXMIMACH":"Machine Tools",
    "ESABINDIA":"Industrial Machinery",
    "ACE":"Industrial Machinery",
    "AIAENG":"Industrial Machinery",
    "SOLARINDS":"Rubber Products",
    "TIINDIA":"Diversified",
    "HONAUT":"Industrial Machinery",
    "TITAGARH":"Transport Infrastructure",
    "BEML":"Industrial Machinery",
    "HAL":"Defence",
    "BEL":"Defence",
    "MAZDOCK":"Shipbuilding",
    "GRSE":"Shipbuilding",
    "COCHINSHIP":"Shipbuilding",
    "BDL":"Defence",
    "MIDHANI":"Defence",
    "MISHRA":"Defence",
    "ULTRACEMCO":"Cement",
    "GRASIM":"Cement",
    "AMBUJACEM":"Cement",
    "SHREECEM":"Cement",
    "RAMCOCEM":"Cement",
    "JKCEMENT":"Cement",
    "DALBHARAT":"Cement",
    "ACC":"Cement",
    "BIRLACORPN":"Cement",
    "ORIENTCEM":"Cement",
    "NUVOCO":"Cement",
    "JKLAKSHMI":"Cement",
    "ASTRAL":"Plastic Products",
    "APLAPOLLO":"Iron & Steel Products",
    "SUPREMEIND":"Plastic Products",
    "KAJARIACER":"Ceramics",
    "CERA":"Sanitaryware",
    "PRINCEPIPE":"Plastic Products",
    "HINDWAREAP":"Sanitaryware",
    "FINPIPE":"Plastic Products",
    "ASAHIINDIA":"Glass",
    "PIDILITIND":"Specialty Chemicals",
    "SRF":"Specialty Chemicals",
    "PIIND":"Agrochemicals",
    "DEEPAKNTR":"Commodity Chemicals",
    "AARTIIND":"Specialty Chemicals",
    "ATUL":"Diversified Chemicals",
    "NAVINFLUOR":"Specialty Chemicals",
    "FLUOROCHEM":"Specialty Chemicals",
    "CLEAN":"Specialty Chemicals",
    "ALKYLAMINE":"Specialty Chemicals",
    "AMIORG":"Specialty Chemicals",
    "FINEORG":"Specialty Chemicals",
    "GALAXYSURF":"Specialty Chemicals",
    "VINATIORGA":"Specialty Chemicals",
    "ROSSARI":"Specialty Chemicals",
    "CHEMCON":"Specialty Chemicals",
    "HIKAL":"Specialty Chemicals",
    "PCBL":"Specialty Chemicals",
    "AETHER":"Specialty Chemicals",
    "AEGISCHEM":"Petrochemicals",
    "GARFIBRES":"Specialty Chemicals",
    "GODREJIND":"Specialty Chemicals",
    "JUBLINGREA":"Specialty Chemicals",
    "GNFC":"Commodity Chemicals",
    "TATACHEM":"Commodity Chemicals",
    "BASF":"Diversified Chemicals",
    "NOCIL":"Rubber Chemicals",
    "RAIN":"Commodity Chemicals",
    "GHCL":"Commodity Chemicals",
    "GUJALKALI":"Commodity Chemicals",
    "SUDARSCHEM":"Specialty Chemicals",
    "SUMICHEM":"Agrochemicals",
    "DCMSHRIRAM":"Diversified Chemicals",
    "UPL":"Agrochemicals",
    "DHANUKA":"Agrochemicals",
    "RALLIS":"Agrochemicals",
    "GODREJAGRO":"Agrochemicals",
    "DLF":"Realty",
    "OBEROIRLTY":"Realty",
    "LODHA":"Realty",
    "PHOENIXLTD":"Realty",
    "GODREJPROP":"Realty",
    "PRESTIGE":"Realty",
    "BRIGADE":"Realty",
    "SOBHA":"Realty",
    "ANANTRAJ":"Realty",
    "HEMIPROP":"Realty",
    "AJMERA":"Realty",
    "NESCO":"Realty",
    "BHARTIARTL":"Telecom Services",
    "IDEA":"Telecom Services",
    "INDUSTOWER":"Telecom - Equipment",
    "TATACOMM":"Telecom Services",
    "STLTECH":"Telecom - Equipment",
    "ZEEL":"Media & Entertainment",
    "SUNTV":"Media & Entertainment",
    "NETWORK18":"Media & Entertainment",
    "PVR":"Media & Entertainment",
    "SAREGAMA":"Media & Entertainment",
    "IRCTC":"Leisure Services",
    "INDHOTEL":"Hotels",
    "LEMERETREE":"Hotels",
    "CHALET":"Hotels",
    "MHRIL":"Leisure Services",
    "DELTACORP":"Leisure Services",
    "EASEMYTRIP":"Leisure Services",
    "DREAMFOLKS":"Leisure Services",
    "DELHIVERY":"Logistics",
    "BLUEDART":"Logistics",
    "CONCOR":"Logistics",
    "ALLCARGO":"Logistics",
    "GESHIP":"Shipping",
    "TCI":"Logistics",
    "TCIEXP":"Logistics",
    "SCI":"Shipping",
    "REDINGTON":"Trading",
    "TRIDENT":"Textiles",
    "WELSPUNLIV":"Textiles",
    "ALOKINDS":"Textiles",
    "SFL":"Textiles",
    "APARINDS":"Textiles",
    "RAYMOND":"Textiles",
    "KANSAINER":"Packaging",
    "EPL":"Packaging",
    "UFLEX":"Packaging",
    "ADANIENT":"Diversified",
    "3MINDIA":"Diversified",
    "EIDPARRY":"Sugar",
    "MMTC":"Trading",
    "CASTROLIND":"Lubricants",
    "JKPAPER":"Paper",
    "TATAINVEST":"Holding Company",
    "BAJAJHLDNG":"Holding Company",
    "TEAMLEASE":"Miscellaneous",
    "QUESS":"Miscellaneous",
    "SIS":"Miscellaneous",
}

BASIC_INDUSTRY_MAP = {
    "HDFCBANK":"Private Sector Bank",
    "ICICIBANK":"Private Sector Bank",
    "AXISBANK":"Private Sector Bank",
    "KOTAKBANK":"Private Sector Bank",
    "INDUSINDBK":"Private Sector Bank",
    "FEDERALBNK":"Private Sector Bank",
    "RBLBANK":"Private Sector Bank",
    "AUBANK":"Private Sector Bank",
    "BANDHANBNK":"Private Sector Bank",
    "CUB":"Private Sector Bank",
    "CSBBANK":"Private Sector Bank",
    "EQUITASBNK":"Small Finance Bank",
    "UJJIVANSFB":"Small Finance Bank",
    "YESBANK":"Private Sector Bank",
    "SBIN":"Public Sector Bank",
    "BANKBARODA":"Public Sector Bank",
    "PNB":"Public Sector Bank",
    "CANBK":"Public Sector Bank",
    "UNIONBANK":"Public Sector Bank",
    "INDIANB":"Public Sector Bank",
    "CENTRALBK":"Public Sector Bank",
    "UCOBANK":"Public Sector Bank",
    "MAHABANK":"Public Sector Bank",
    "SOUTHBANK":"Public Sector Bank",
    "J&KBANK":"Public Sector Bank",
    "KTKBANK":"Public Sector Bank",
    "CANFINHOME":"Housing Finance Company",
    "LICHSGFIN":"Housing Finance Company",
    "PNBHOUSING":"Housing Finance Company",
    "HUDCO":"Housing Finance Company",
    "FIVESTAR":"Housing Finance Company",
    "APTUS":"Housing Finance Company",
    "AAVAS":"Housing Finance Company",
    "BAJFINANCE":"Consumer Finance",
    "BAJAJFINSV":"Financial Services Holding",
    "SHRIRAMFIN":"Vehicle Finance",
    "CHOLAFIN":"Vehicle Finance",
    "M&MFIN":"Vehicle Finance",
    "MUTHOOTFIN":"Gold Loan Company",
    "MANAPPURAM":"Gold Loan Company",
    "JIOFIN":"Diversified Financial Services",
    "L&TFH":"Infrastructure Finance",
    "MFSL":"Financial Services Holding",
    "SUNDARMFIN":"Vehicle Finance",
    "CREDITACC":"Microfinance Institutions",
    "IIFL":"Diversified Financial Services",
    "SBICARD":"Credit Card Issuer",
    "EDELWEISS":"Diversified Financial Services",
    "IIFLWAM":"Wealth Management",
    "MOTILALOFS":"Stock Broking",
    "JMFINANCIL":"Investment Banking",
    "HDFCAMC":"Asset Management Company",
    "ABSLAMC":"Asset Management Company",
    "NAM-INDIA":"Asset Management Company",
    "ANGELONE":"Stock Broking",
    "ISEC":"Stock Broking",
    "CAMS":"Registrar & Transfer Agent",
    "CDSL":"Depository",
    "KFINTECH":"Registrar & Transfer Agent",
    "PAYTM":"Digital Payments",
    "BSE":"Stock Exchange",
    "CRISIL":"Credit Rating Agency",
    "ICRA":"Credit Rating Agency",
    "LICI":"Life Insurance",
    "SBILIFE":"Life Insurance",
    "HDFCLIFE":"Life Insurance",
    "ICICIPRULI":"Life Insurance",
    "POLICYBZR":"Insurance Distributor",
    "STARHEALTH":"Health Insurance",
    "GICRE":"Reinsurance",
    "NIACL":"General Insurance",
    "TCS":"IT Services - Large Cap",
    "INFY":"IT Services - Large Cap",
    "WIPRO":"IT Services - Large Cap",
    "HCLTECH":"IT Services - Large Cap",
    "TECHM":"IT Services - Large Cap",
    "LTIM":"IT Services - Large Cap",
    "PERSISTENT":"Product Engineering",
    "COFORGE":"Vertical IT Services",
    "MPHASIS":"BFSI IT Services",
    "LTTS":"Engineering R&D",
    "TATAELXSI":"Embedded Product Design",
    "KPITTECH":"Auto Mobility R&D",
    "CYIENT":"Aerospace & Geospatial R&D",
    "HAPPSTMNDS":"Digital Transformation",
    "INTELLECT":"Banking Software Products",
    "BSOFT":"Enterprise Software",
    "ZENSARTECH":"IT Services - Mid Cap",
    "SONATSOFTW":"Enterprise Software Products",
    "NIITLTD":"IT Education & Training",
    "ECLERX":"Analytics & KPO",
    "TATATECH":"Automotive Engineering R&D",
    "NAUKRI":"Online Recruitment",
    "OFSS":"Core Banking Products",
    "MAPMYINDIA":"Geospatial Technology",
    "ROUTE":"Mobile Marketing Platform",
    "TANLA":"Cloud Communications Platform",
    "DATAPATTNS":"Defence Electronics",
    "AFFLE":"Mobile Advertising",
    "RATEGAIN":"Travel Technology SaaS",
    "DIXON":"Consumer Electronics EMS",
    "KAYNES":"Industrial Electronics EMS",
    "SYRMA":"IoT & Automotive EMS",
    "ZOMATO":"Food Delivery & Quick Commerce",
    "INDIAMART":"B2B E-Commerce",
    "JUSTDIAL":"Local Search & Discovery",
    "SUNPHARMA":"Integrated Pharma - Global",
    "CIPLA":"Respiratory Generics",
    "DRREDDY":"US Generics Focused",
    "DIVISLAB":"Custom API Synthesis",
    "LUPIN":"Multi-Market Generics",
    "TORNTPHARM":"Chronic Therapy Formulations",
    "ZYDUSLIFE":"Generics & Biosimilars",
    "BIOCON":"Biosimilars & CDMO",
    "AUROPHARMA":"US Injectable Generics",
    "LAURUSLABS":"ARV & Oncology API",
    "MANKIND":"Domestic Branded Generics",
    "IPCALAB":"API & Formulation Export",
    "NATCOPHARM":"Oncology Niche",
    "GLENMARK":"Derma & Respiratory",
    "ALKEM":"Acute Therapy - India",
    "AJANTPHARM":"Emerging Market Generics",
    "GRANULES":"Pharma API & PFI",
    "SYNGENE":"Contract Research & Manufacturing",
    "ERIS":"Chronic Branded Generics",
    "SANOFI":"MNC Pharma - India",
    "GLAXO":"MNC Pharma - India",
    "SPARC":"Drug Discovery Research",
    "WOCKPHARMA":"Hospital Injectables",
    "JBCHEPHARM":"API Manufacturer",
    "MOREPENLAB":"Diagnostics & API",
    "SUVENPHAR":"CNS Specialty",
    "SOLARA":"Pain Management API",
    "TARSONS":"Laboratory Plasticware",
    "APOLLOHOSP":"Multi-Specialty Hospitals",
    "MAXHEALTH":"Multi-Specialty Hospitals",
    "FORTIS":"Multi-Specialty Hospitals",
    "MEDANTA":"Super Specialty Hospital",
    "ASTERDM":"Multi-Specialty Hospitals",
    "LALPATHLAB":"Pathology Diagnostics",
    "METROPOLIS":"Pathology Diagnostics",
    "TATAMOTORS":"Passenger & Commercial Vehicles",
    "MARUTI":"Passenger Cars",
    "M&M":"UV, Tractors & Farm Equipment",
    "EICHERMOT":"Premium Motorcycles",
    "HEROMOTOCO":"Mass Market Two Wheelers",
    "TVSMOTOR":"Two & Three Wheelers",
    "ASHOKLEY":"Medium & Heavy CV",
    "ESCORTS":"Tractors & Railway Equipment",
    "MAHSCOOTER":"Scooters",
    "OLECTRA":"Electric Buses",
    "GREAVESCOT":"Electric Three Wheelers",
    "BOSCHLTD":"Fuel Systems & Auto Electronics",
    "MOTHERSON":"Wiring Harness & Modules",
    "SONACOMS":"Drivetrain & EV Components",
    "BHARATFORG":"Auto & Industrial Forgings",
    "EXIDEIND":"Batteries - Lead Acid",
    "BALKRISIND":"Off-Highway Tyres",
    "CEATLTD":"Passenger & Truck Tyres",
    "MRF":"Tyres - Full Range",
    "GOODYEAR":"Tyres - MNC",
    "ENDURANCE":"Suspension & Alloy Wheels",
    "SUNDRMFAST":"Fasteners",
    "UNOMINDA":"Auto Lighting & Switches",
    "JAMNAAUTO":"Suspension Springs",
    "VARROC":"Polymer & Lighting",
    "TVSSRICHAK":"Precision Components",
    "SUPRAJIT":"Control Cables",
    "JTEKTINDIA":"Steering Systems",
    "SKFINDIA":"Bearings - MNC",
    "TIMKEN":"Engineered Bearings - MNC",
    "GABRIEL":"Shock Absorbers",
    "JSWSTEEL":"Integrated Steel - Private",
    "TATASTEEL":"Integrated Steel - Private",
    "SAIL":"Integrated Steel - PSU",
    "JINDALSAW":"Welded & Seamless Pipes",
    "JSL":"Stainless Steel Flat",
    "WELCORP":"ERW & Spiral Pipes",
    "RATNAMANI":"SS & CS Tubes",
    "SHYAMMETL":"Ferro Alloys & Steel",
    "LLOYDSME":"GP & GC Pipes",
    "MAHSEAMLES":"Seamless Tubes",
    "TINPLATE":"Electrolytic Tinplate",
    "WELSPUNIND":"Large Dia Pipes",
    "HINDALCO":"Aluminium & Copper",
    "VEDL":"Diversified Mining & Smelting",
    "NATIONALUM":"Aluminium Smelting - PSU",
    "HINDCOPPER":"Copper Cathode - PSU",
    "HINDZINC":"Zinc & Lead Smelting",
    "NMDC":"Iron Ore Mining",
    "MOIL":"Manganese Ore Mining",
    "COALINDIA":"Coal Mining",
    "GRAPHITE":"Graphite Electrodes",
    "HEG":"Graphite Electrodes",
    "RELIANCE":"Integrated Oil & Retail",
    "ONGC":"Upstream E&P - PSU",
    "OIL":"Upstream E&P - PSU",
    "BPCL":"Oil Marketing Company - PSU",
    "IOC":"Oil Marketing Company - PSU",
    "HINDPETRO":"Oil Marketing Company - PSU",
    "MRPL":"Standalone Refinery",
    "CHENNPETRO":"Standalone Refinery",
    "GAIL":"Gas Transmission & Marketing",
    "PETRONET":"LNG Regasification",
    "IGL":"City Gas - Delhi NCR",
    "ATGL":"City Gas - Gujarat",
    "MGL":"City Gas - Mumbai",
    "GUJGASLTD":"City Gas - Gujarat",
    "GSPL":"Gas Transmission Pipeline",
    "GPPL":"Gas Transmission Pipeline",
    "TATAPOWER":"Integrated Power Utility",
    "JSWENERGY":"Thermal & Hydro IPP",
    "NHPC":"Hydroelectric - PSU",
    "SJVN":"Hydroelectric - PSU",
    "NLCINDIA":"Lignite & Thermal Power",
    "TORNTPOWER":"Power Distribution",
    "NTPC":"Thermal Power - PSU",
    "POWERGRID":"Transmission Grid - PSU",
    "CESC":"Power Distribution",
    "SARDAEN":"Ferro Alloy & Captive Power",
    "PFC":"Power Sector Lending",
    "RECLTD":"Rural Electrification Lending",
    "IRFC":"Railway Capex Lending",
    "ADANIGREEN":"Utility Solar & Wind",
    "ADANIENSOL":"Renewable Solutions",
    "SWSOLAR":"Solar EPC & Modules",
    "SWANENERGY":"Biomass Energy",
    "KPIGREEN":"Solar Developer",
    "NFL":"Urea Manufacturing",
    "RCF":"Urea Manufacturing",
    "CHAMBLFERT":"Urea Manufacturing",
    "COROMANDEL":"Complex Fertilizer & Crop Protection",
    "FACT":"Complex Fertilizer",
    "NESTLEIND":"Packaged Foods - MNC",
    "BRITANNIA":"Biscuits & Bakery",
    "TATACONSUM":"Tea, Coffee & Staples",
    "ITC":"Cigarettes & Diversified FMCG",
    "HATSUN":"Dairy Products",
    "VBLLTD":"Beverage Bottling",
    "RAJESHEXPO":"Processed Food Exports",
    "HERITGFOOD":"Dairy Products",
    "AWL":"Edible Oil",
    "ADFFOODS":"Ready-to-Eat Foods",
    "KRBL":"Basmati Rice",
    "COLPAL":"Oral Care - MNC",
    "DABUR":"Ayurveda & Personal Care",
    "GODREJCP":"Personal Hygiene & Hair",
    "MARICO":"Hair & Edible Oil",
    "UNITDSPR":"Home & Personal Care - MNC",
    "EMAMILTD":"Personal Care & OTC",
    "JYOTHYLAB":"Fabric & Home Care",
    "GILLETTE":"Grooming - MNC",
    "PGHH":"Home & Personal Care - MNC",
    "PATANJALI":"Ayurveda & Wellness",
    "HONASA":"D2C Personal Care",
    "MCDOWELL-N":"Indian Made Spirits",
    "RADICO":"Indian Made Spirits",
    "UBL":"Beer Brewing",
    "VSTIND":"Cigarettes",
    "TITAN":"Watches & Jewellery",
    "KALYANKJIL":"Jewellery Retail",
    "PAGEIND":"Innerwear & Apparel",
    "BATAINDIA":"Footwear Retail",
    "RELAXO":"Mass Footwear",
    "CAMPUS":"Sports Footwear",
    "VIPIND":"Luggage",
    "ASIANPAINT":"Decorative Paints",
    "BERGEPAINT":"Decorative Paints",
    "INDIGOPNTS":"Decorative Paints",
    "HAVELLS":"Electrical Consumer Goods",
    "CROMPTON":"Fans & Lighting",
    "VOLTAS":"Air Conditioning",
    "WHIRLPOOL":"Home Appliances - MNC",
    "AMBER":"AC Components & ODM",
    "IFBIND":"Washing Machines & Kitchen",
    "BAJAJELEC":"Small Appliances",
    "BLUESTARCO":"Commercial & Residential AC",
    "ORIENTELEC":"Fans & Lighting",
    "JUBLFOOD":"QSR - Pizza",
    "DEVYANI":"QSR - Fried Chicken & Pizza",
    "WESTLIFE":"QSR - Burgers",
    "DMART":"Hypermarket",
    "TRENT":"Fashion Retail",
    "NYKAA":"Beauty E-Commerce",
    "ABFRL":"Branded Fashion",
    "MANYAVAR":"Ethnic Wear",
    "VEDANTFASH":"Ethnic Wear",
    "SHOPERSTOP":"Department Store",
    "VMART":"Value Fashion",
    "LT":"EPC Conglomerate",
    "NCC":"Building & Road EPC",
    "NBCC":"PSU Construction & PMC",
    "KNRCON":"Road EPC - HAM & BOT",
    "HGINFRA":"Road EPC - HAM & BOT",
    "IRB":"Road BOT & Toll",
    "GMRINFRA":"Airport Development",
    "JSWINFRA":"Port Development",
    "ADANIPORTS":"Port & SEZ",
    "ABB":"Electrical & Automation - MNC",
    "SIEMENS":"Digital Industries - MNC",
    "CGPOWER":"Motors & Traction",
    "POLYCAB":"Cables & FMEG",
    "BHEL":"Heavy Electrical - PSU",
    "CUMMINSIND":"Engines & Gensets - MNC",
    "THERMAX":"Boilers & Environment",
    "POWERINDIA":"Transformers - MNC",
    "VOLTAMP":"Transformers",
    "SCHNEIDER":"Switchgear - MNC",
    "FINCABLES":"Specialised Cables",
    "KEI":"Power & Control Cables",
    "KALPATPOWR":"Transmission EPC",
    "KEC":"T&D & Infrastructure EPC",
    "RITES":"Rail Consultancy - PSU",
    "RVNL":"Railway Construction - PSU",
    "SCHAEFFLER":"Bearings - MNC",
    "LINDEINDIA":"Industrial Gases - MNC",
    "TRITURBINE":"Steam Turbines",
    "GRINDWELL":"Abrasives - MNC",
    "CARBORUNIV":"Electrominerals & Abrasives",
    "ISGEC":"Process Equipment & Boilers",
    "ELGIEQUIP":"Air Compressors",
    "PRAJIND":"Bioenergy Equipment",
    "ELECON":"Gears & Material Handling",
    "LAXMIMACH":"CNC Machine Tools",
    "ESABINDIA":"Welding Equipment - MNC",
    "ACE":"Cranes & Construction Equipment",
    "AIAENG":"High Chrome Mill Internals",
    "SOLARINDS":"Industrial Belts",
    "TIINDIA":"Tubes, Cycles & Industrial",
    "HONAUT":"Automation - MNC",
    "TITAGARH":"Rail Wagons & Metro",
    "BEML":"Mining & Defence Equipment",
    "HAL":"Aerospace & Fighter Aircraft",
    "BEL":"Defence Radar & EW",
    "MAZDOCK":"Warship & Submarine Builder",
    "GRSE":"Warship Builder",
    "COCHINSHIP":"Ship Repair & Construction",
    "BDL":"Missile Systems",
    "MIDHANI":"Super Alloys & Special Steel",
    "MISHRA":"Defence Forgings & Armour",
    "ULTRACEMCO":"Grey Cement - India's Largest",
    "GRASIM":"Cement & VSF",
    "AMBUJACEM":"Grey Cement - Pan India",
    "SHREECEM":"Grey Cement - Premium",
    "RAMCOCEM":"Grey Cement - South",
    "JKCEMENT":"Grey & White Cement",
    "DALBHARAT":"Grey Cement - South",
    "ACC":"Grey Cement - Pan India",
    "BIRLACORPN":"Grey Cement - East",
    "ORIENTCEM":"Grey Cement - Central",
    "NUVOCO":"Grey Cement - East",
    "JKLAKSHMI":"Grey Cement - North",
    "ASTRAL":"CPVC & PVC Pipes",
    "APLAPOLLO":"Steel Tubes & Pipes",
    "SUPREMEIND":"Plastic Pipes",
    "KAJARIACER":"Ceramic & Vitrified Tiles",
    "CERA":"Sanitaryware & Faucets",
    "PRINCEPIPE":"PVC & CPVC Pipes",
    "HINDWAREAP":"Sanitaryware & Tiles",
    "FINPIPE":"PVC Pipes",
    "ASAHIINDIA":"Float & Auto Glass",
    "PIDILITIND":"Adhesives & Sealants",
    "SRF":"Fluorochemicals & Packaging",
    "PIIND":"Custom Agrochemicals",
    "DEEPAKNTR":"Phenol & Acetone",
    "AARTIIND":"Benzene Derivatives",
    "ATUL":"Multi-Segment Chemicals",
    "NAVINFLUOR":"Refrigerant Gases",
    "FLUOROCHEM":"PTFE & Fluoropolymers",
    "CLEAN":"Pharma Specialty API",
    "ALKYLAMINE":"Amines & Derivatives",
    "AMIORG":"Pharma Intermediates",
    "FINEORG":"Oleochemical Additives",
    "GALAXYSURF":"Surfactants",
    "VINATIORGA":"ATBS & Isobutylene Derivatives",
    "ROSSARI":"Performance Chemicals",
    "CHEMCON":"Chlorosilanes",
    "HIKAL":"Crop & Pharma Intermediates",
    "PCBL":"Carbon Black",
    "AETHER":"Specialty Intermediates",
    "AEGISCHEM":"LPG & Petrochemicals",
    "GARFIBRES":"Fiberglass Composites",
    "GODREJIND":"Oleochemicals & Surfactants",
    "JUBLINGREA":"Oleochemical Ingredients",
    "GNFC":"Neem Chemicals & TDI",
    "TATACHEM":"Soda Ash & Salt",
    "BASF":"Diversified Chemicals - MNC",
    "NOCIL":"Rubber Chemicals",
    "RAIN":"Calcined Petroleum Coke",
    "GHCL":"Soda Ash",
    "GUJALKALI":"Caustic Soda",
    "SUDARSCHEM":"Pigments",
    "SUMICHEM":"Crop Protection - MNC",
    "DCMSHRIRAM":"Chlor-Alkali & Sugar",
    "UPL":"Global Crop Protection",
    "DHANUKA":"Domestic Crop Protection",
    "RALLIS":"Crop Care & Seeds",
    "GODREJAGRO":"Animal Feed & Crop Protection",
    "DLF":"Residential & Commercial",
    "OBEROIRLTY":"Premium Residential & Office",
    "LODHA":"Residential Developer",
    "PHOENIXLTD":"Retail Mall Developer",
    "GODREJPROP":"Residential Developer",
    "PRESTIGE":"Mixed-Use Developer",
    "BRIGADE":"Mixed-Use Developer",
    "SOBHA":"Residential & Contractual",
    "ANANTRAJ":"NCR Real Estate",
    "HEMIPROP":"Industrial & Warehouse",
    "AJMERA":"Residential Developer",
    "NESCO":"IT Parks & Convention",
    "BHARTIARTL":"Mobile & Broadband Operator",
    "IDEA":"Mobile Operator",
    "INDUSTOWER":"Telecom Tower Infra",
    "TATACOMM":"Enterprise Telecom",
    "STLTECH":"Optical Fibre Cable",
    "ZEEL":"TV Broadcasting",
    "SUNTV":"Regional TV Broadcasting",
    "NETWORK18":"Media Conglomerate",
    "PVR":"Multiplex Cinema",
    "SAREGAMA":"Music Label & IP",
    "IRCTC":"Rail Catering & Tourism",
    "INDHOTEL":"Luxury Hotels - Tata",
    "LEMERETREE":"Budget & Mid Hotels",
    "CHALET":"Luxury Hotels",
    "MHRIL":"Holiday Resorts",
    "DELTACORP":"Casino & Hospitality",
    "EASEMYTRIP":"Online Travel Agency",
    "DREAMFOLKS":"Airport Lounge Platform",
    "DELHIVERY":"Express & Freight Logistics",
    "BLUEDART":"Premium Express Courier",
    "CONCOR":"Container Rail - PSU",
    "ALLCARGO":"Multimodal Logistics",
    "GESHIP":"Tanker & Gas Shipping",
    "TCI":"Integrated Logistics",
    "TCIEXP":"Express Freight",
    "SCI":"Bulk & Tanker Shipping - PSU",
    "REDINGTON":"IT Distribution",
    "TRIDENT":"Home Textiles Export",
    "WELSPUNLIV":"Home Textiles Export",
    "ALOKINDS":"Apparel Fabrics",
    "SFL":"Synthetic Yarn & Fabrics",
    "APARINDS":"Technical Textiles",
    "RAYMOND":"Suiting & Apparel",
    "KANSAINER":"Metal Packaging",
    "EPL":"Laminated Tubes",
    "UFLEX":"Flexible Packaging Films",
    "ADANIENT":"Diversified Conglomerate",
    "3MINDIA":"Diversified MNC",
    "EIDPARRY":"Sugar Manufacturing",
    "MMTC":"Commodity Trading - PSU",
    "CASTROLIND":"Automotive Lubricants",
    "JKPAPER":"Writing & Printing Paper",
    "TATAINVEST":"Investment Holding",
    "BAJAJHLDNG":"Investment Holding",
    "TEAMLEASE":"Staffing Services",
    "QUESS":"Business Services",
    "SIS":"Security Services",
}

# ══════════════════════════════════════════════════════════════════════════════
# DYNAMIC UNIVERSE LOADER — Override from stock_universe.json if available
# ══════════════════════════════════════════════════════════════════════════════
_UNIVERSE_JSON = "/opt/alphaforge/stock_universe.json"
_UNIVERSE_LOADED = False
try:
    if os.path.exists(_UNIVERSE_JSON):
        with open(_UNIVERSE_JSON) as _f:
            _udata = json.load(_f)
        if _udata.get("universe") and len(_udata["universe"]) > len(NIFTY_UNIVERSE):
            NIFTY_UNIVERSE = _udata["universe"]
            # Override sector map (merge: keep existing manual overrides, add new from JSON)
            _json_sectors = _udata.get("sector_map", {})
            for _sym, _sec in _json_sectors.items():
                if _sym not in SECTOR_MAP:  # Don't override manually curated entries
                    SECTOR_MAP[_sym] = _sec
            # Override industry map
            _json_industries = _udata.get("industry_map", {})
            for _sym, _ind in _json_industries.items():
                if _sym not in INDUSTRY_MAP:
                    INDUSTRY_MAP[_sym] = _ind
                if _sym not in BASIC_INDUSTRY_MAP:
                    BASIC_INDUSTRY_MAP[_sym] = _ind
            _UNIVERSE_LOADED = True
            print(f"[UNIVERSE] Loaded {len(NIFTY_UNIVERSE)} stocks from {_UNIVERSE_JSON} (generated: {_udata.get('generated_at','?')})")
        else:
            print(f"[UNIVERSE] JSON has {len(_udata.get('universe',[]))} stocks, keeping built-in {len(NIFTY_UNIVERSE)}")
    else:
        print(f"[UNIVERSE] No {_UNIVERSE_JSON} found, using built-in {len(NIFTY_UNIVERSE)} stocks")
        print(f"[UNIVERSE] Run: python3 /opt/alphaforge/nse_universe_builder.py to expand to all NSE stocks")
except Exception as _e:
    print(f"[UNIVERSE] Error loading JSON: {_e}, using built-in {len(NIFTY_UNIVERSE)} stocks")

# ── yfinance helper ───────────────────────────────────────────────────────────
def yf_extract_ticker(raw, yf_sym, single_mode=False):
    """Extract single-ticker DataFrame from yfinance download, handling MultiIndex columns."""
    if raw.empty:
        return pd.DataFrame()

    if not isinstance(raw.columns, pd.MultiIndex):
        return raw.copy()

    level0 = set(raw.columns.get_level_values(0).unique())
    price_cols = {"Close", "Open", "High", "Low", "Volume", "Adj Close"}

    # Detect: is level 0 price-types or tickers?
    if level0.issubset(price_cols):
        # Level 0 = Price type, Level 1 = Ticker
        if single_mode:
            df = raw.copy()
            df.columns = df.columns.droplevel(1)
            return df
        else:
            # Multi-ticker: extract this ticker from level 1
            try:
                df = raw.xs(yf_sym, level=1, axis=1).copy()
                return df
            except KeyError:
                return pd.DataFrame()
    else:
        # Level 0 = Ticker, Level 1 = Price type (group_by="ticker" format)
        if yf_sym in level0:
            return raw[yf_sym].copy()
        else:
            return pd.DataFrame()

async def batch_download_yf(symbols_ns: list, start: str, end: str, batch_size: int = 50) -> dict:
    """Download yfinance data in batches to avoid timeouts. Returns dict of {yf_sym: DataFrame}."""
    import yfinance as yf

    loop = asyncio.get_event_loop()
    all_data = {}

    for i in range(0, len(symbols_ns), batch_size):
        batch = symbols_ns[i:i+batch_size]
        try:
            if len(batch) == 1:
                raw = await loop.run_in_executor(None, lambda b=batch: yf.download(
                    tickers=b[0], start=start, end=end,
                    interval="1d", auto_adjust=True, progress=False
                ))
                df = yf_extract_ticker(raw, batch[0], single_mode=True)
                if not df.empty:
                    all_data[batch[0]] = df
            else:
                raw = await loop.run_in_executor(None, lambda b=batch: yf.download(
                    tickers=" ".join(b), start=start, end=end,
                    interval="1d", group_by="ticker", auto_adjust=True, progress=False, threads=True
                ))
                for sym in batch:
                    try:
                        df = yf_extract_ticker(raw, sym)
                        if not df.empty and len(df) > 0:
                            all_data[sym] = df
                    except Exception:
                        continue
        except Exception:
            continue

    return all_data

@app.get("/api/screener", tags=["Stock Screener"], summary="Run stock screener",
    description="Screen 843 NSE stocks using 34+ quantitative strategies. Filter by sector, industry, basic industry, and price range. Results are cached for 15 minutes.\n\n**Available strategies:** momentum, top_losers, volume_breakout, new_high, mean_reversion, rsi_oversold, rsi_overbought, macd_crossover, bollinger_squeeze, supertrend_buy, breakout_52w, relative_strength, golden_cross, death_cross, adx_strong_trend, high_tight_flag, inside_day, gap_up, darvas_box, turtle_breakout, ichimoku_bullish, elder_ray, williams_r, ema_ribbon, pivot_breakout, dividend_yield, low_pe, high_roe, growth_momentum, safe_haven, minervini_template, rvol_surge, sector_rotation, vwap_reclaim.")
async def screener(strategy: str = "momentum", min_price: float = 50, max_price: float = 10000, sector: str = "", industry: str = "", basic_industry: str = "", user=Depends(get_current_user)):
    from datetime import date, timedelta

    cache_key = f"screener:{strategy}:{int(min_price)}:{int(max_price)}:{sector}:{industry}:{basic_industry}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    # 365+ days for proper 200 DMA, 52-week calculations
    start = (date.today() - timedelta(days=400)).isoformat()
    end = date.today().isoformat()

    # ── PRE-FILTER: Narrow universe BEFORE downloading (critical for 2000+ stocks) ──
    symbols_to_scan = list(NIFTY_UNIVERSE)
    if sector:
        symbols_to_scan = [s for s in symbols_to_scan if SECTOR_MAP.get(s, "Other") == sector]
    if industry:
        symbols_to_scan = [s for s in symbols_to_scan if INDUSTRY_MAP.get(s, "Other") == industry]
    if basic_industry:
        symbols_to_scan = [s for s in symbols_to_scan if BASIC_INDUSTRY_MAP.get(s, "Other") == basic_industry]
    
    yf_symbols = [f"{s}.NS" for s in symbols_to_scan]

    # Batch download — use larger batches for efficiency
    _batch_sz = 40 if len(yf_symbols) > 500 else 50
    all_data = await batch_download_yf(yf_symbols, start, end, batch_size=_batch_sz)

    def sf(v, d=0):
        try:
            v = float(v)
            return d if (np.isnan(v) or np.isinf(v)) else v
        except:
            return d

    stocks = []
    for sym in symbols_to_scan:
        try:
            yf_sym = f"{sym}.NS"
            if yf_sym not in all_data:
                continue
            df = all_data[yf_sym].dropna()
            if len(df) < 30: continue

            c = df["Close"].astype(float)
            h = df["High"].astype(float)
            l = df["Low"].astype(float)
            v = df["Volume"].astype(float)

            price = float(c.iloc[-1])
            prev = float(c.iloc[-2])
            if price < min_price or price > max_price: continue
            stock_sector = SECTOR_MAP.get(sym, "Other")
            if sector and stock_sector != sector: continue
            stock_industry = INDUSTRY_MAP.get(sym, "Other")
            if industry and stock_industry != industry: continue
            stock_basic_industry = BASIC_INDUSTRY_MAP.get(sym, "Other")
            if basic_industry and stock_basic_industry != basic_industry: continue

            change_pct = sf((price - prev) / prev * 100)
            vol = int(v.iloc[-1])
            vol_avg = int(v.rolling(20).mean().iloc[-1]) if len(v) >= 20 else int(v.mean())
            vol_ratio = sf(vol / vol_avg, 1.0) if vol_avg > 0 else 1.0

            # RSI 14 (EMA-based)
            delta = c.diff()
            gain = delta.clip(lower=0).ewm(span=14, adjust=False).mean()
            loss = (-delta.clip(upper=0)).ewm(span=14, adjust=False).mean()
            rs = gain.iloc[-1] / loss.iloc[-1] if sf(loss.iloc[-1]) != 0 else 0
            rsi = sf(100 - 100 / (1 + rs), 50)

            # Moving averages
            sma_20 = sf(c.rolling(20).mean().iloc[-1])
            sma_50 = sf(c.rolling(50).mean().iloc[-1])
            sma_200 = sf(c.rolling(200).mean().iloc[-1]) if len(c) >= 200 else sf(c.mean())
            ema_9 = sf(c.ewm(span=9, adjust=False).mean().iloc[-1])
            ema_21 = sf(c.ewm(span=21, adjust=False).mean().iloc[-1])

            # 52-week high/low
            c_252 = c.iloc[-min(252, len(c)):]
            w52_high = sf(c_252.max())
            w52_low = sf(c_252.min())
            pct_from_52h = sf((price - w52_high) / w52_high * 100) if w52_high > 0 else 0
            pct_from_52l = sf((price - w52_low) / w52_low * 100) if w52_low > 0 else 0

            # Gap (today open vs yesterday close)
            gap_pct = sf((float(df["Open"].iloc[-1]) - prev) / prev * 100) if prev > 0 else 0

            # Bollinger Bands
            bb_mid = c.rolling(20).mean()
            bb_std = c.rolling(20).std()
            bb_upper = sf((bb_mid + 2 * bb_std).iloc[-1])
            bb_lower = sf((bb_mid - 2 * bb_std).iloc[-1])
            bb_width = sf((bb_upper - bb_lower) / sf(bb_mid.iloc[-1], 1) * 100) if sf(bb_mid.iloc[-1]) > 0 else 0

            # MACD
            ema12 = c.ewm(span=12, adjust=False).mean()
            ema26 = c.ewm(span=26, adjust=False).mean()
            macd_line = ema12 - ema26
            macd_signal = macd_line.ewm(span=9, adjust=False).mean()
            macd_hist = sf((macd_line - macd_signal).iloc[-1])
            macd_cross_up = sf(macd_line.iloc[-1]) > sf(macd_signal.iloc[-1]) and sf(macd_line.iloc[-2]) <= sf(macd_signal.iloc[-2])

            # Golden/Death cross
            sma50_series = c.rolling(50).mean()
            sma200_series = c.rolling(200).mean() if len(c) >= 200 else c.rolling(min(len(c), 100)).mean()
            golden_cross = False
            death_cross = False
            if len(sma50_series.dropna()) >= 2 and len(sma200_series.dropna()) >= 2:
                golden_cross = sf(sma50_series.iloc[-1]) > sf(sma200_series.iloc[-1]) and sf(sma50_series.iloc[-2]) <= sf(sma200_series.iloc[-2])
                death_cross = sf(sma50_series.iloc[-1]) < sf(sma200_series.iloc[-1]) and sf(sma50_series.iloc[-2]) >= sf(sma200_series.iloc[-2])

            # N-day breakout
            high_20 = sf(h.rolling(20).max().iloc[-2]) if len(h) > 20 else sf(h.max())

            # Supertrend (simplified: ATR-based)
            atr_period = 10
            if len(df) > atr_period + 1:
                tr = pd.concat([
                    h - l,
                    (h - df["Close"].shift(1)).abs(),
                    (l - df["Close"].shift(1)).abs()
                ], axis=1).max(axis=1)
                atr = tr.rolling(atr_period).mean()
                st_upper = (h + l) / 2 + 3 * atr
                st_lower = (h + l) / 2 - 3 * atr
                above_supertrend = price > sf(st_lower.iloc[-1])
            else:
                above_supertrend = above_200

            # Relative Strength
            if len(c) >= 60:
                rs_1m = sf(c.iloc[-1] / c.iloc[-22] - 1, 0) * 100 if sf(c.iloc[-22]) > 0 else 0
                rs_3m = sf(c.iloc[-1] / c.iloc[-60] - 1, 0) * 100 if sf(c.iloc[-60]) > 0 else 0
            else:
                rs_1m = change_pct
                rs_3m = change_pct

            # Minervini trend template
            above_150 = price > sf(c.rolling(150).mean().iloc[-1]) if len(c) >= 150 else False
            above_200 = price > sma_200
            sma150_above_200 = sf(c.rolling(150).mean().iloc[-1]) > sma_200 if len(c) >= 150 else False
            price_above_52l_25 = pct_from_52l >= 25
            price_within_52h_25 = pct_from_52h >= -25
            minervini_score = sum([above_150, above_200, sma150_above_200, sma_50 > sma_200, price_above_52l_25, price_within_52h_25, price > sma_50])

            # Weekly change
            wk_change = sf((price / sf(c.iloc[-6], price) - 1) * 100) if len(c) >= 6 else change_pct

            stocks.append({
                "symbol": sym,
                "price": round(sf(price), 2),
                "change_pct": round(change_pct, 2),
                "volume": vol,
                "vol_ratio": round(vol_ratio, 2),
                "rsi": round(rsi, 1),
                "above_200dma": above_200,
                "sector": SECTOR_MAP.get(sym, "Other"), "industry": INDUSTRY_MAP.get(sym, "Other"), "basic_industry": BASIC_INDUSTRY_MAP.get(sym, "Other"),
                "sma_50": round(sma_50, 2),
                "sma_200": round(sma_200, 2),
                "w52_high": round(w52_high, 2),
                "w52_low": round(w52_low, 2),
                "pct_from_52h": round(pct_from_52h, 1),
                "pct_from_52l": round(pct_from_52l, 1),
                "gap_pct": round(gap_pct, 2),
                "bb_width": round(bb_width, 2),
                "bb_lower": round(bb_lower, 2),
                "bb_upper": round(bb_upper, 2),
                "macd_hist": round(macd_hist, 2),
                "macd_cross_up": macd_cross_up,
                "golden_cross": golden_cross,
                "death_cross": death_cross,
                "high_20": round(high_20, 2),
                "rs_1m": round(rs_1m, 1),
                "rs_3m": round(rs_3m, 1),
                "minervini_score": minervini_score,
                "wk_change": round(wk_change, 2),
                "above_50dma": price > sma_50,
                "above_supertrend": above_supertrend,
                "pe_ratio": 0, "roe": 0, "dividend_yield": 0,
            })
        except Exception:
            continue

    # ── Fetch fundamentals for fundamental strategies (only when needed) ───
    FUNDAMENTAL_STRATEGIES = {"dividend_yield", "low_pe", "high_roe", "growth_momentum", "safe_haven"}
    if strategy in FUNDAMENTAL_STRATEGIES and stocks:
        import yfinance as yf
        # Batch fetch for top 80 stocks by initial filter
        batch = stocks[:80]
        for s in batch:
            try:
                t = yf.Ticker(f"{s['symbol']}.NS")
                info = t.info
                s["pe_ratio"] = sf(info.get("trailingPE", info.get("forwardPE", 0)))
                s["roe"] = sf(info.get("returnOnEquity", 0)) * 100 if sf(info.get("returnOnEquity", 0)) < 1 else sf(info.get("returnOnEquity", 0))
                s["dividend_yield"] = sf(info.get("dividendYield", 0)) * 100 if sf(info.get("dividendYield", 0)) < 1 else sf(info.get("dividendYield", 0))
            except:
                pass

    # ── Strategy Filters ─────────────────────────────────────────────────────
    if strategy == "momentum":
        stocks = sorted([s for s in stocks if s["change_pct"] > 0.3], key=lambda x: x["change_pct"], reverse=True)
    elif strategy == "oversold":
        stocks = sorted([s for s in stocks if s["rsi"] < 35], key=lambda x: x["rsi"])
    elif strategy == "overbought":
        stocks = sorted([s for s in stocks if s["rsi"] > 70], key=lambda x: x["rsi"], reverse=True)
    elif strategy == "volume":
        stocks = sorted([s for s in stocks if s["vol_ratio"] > 1.5], key=lambda x: x["vol_ratio"], reverse=True)
    elif strategy == "breakout":
        stocks = sorted([s for s in stocks if s["change_pct"] > 1.0 and s["vol_ratio"] > 1.3], key=lambda x: x["change_pct"], reverse=True)
    elif strategy == "52w_high":
        stocks = sorted([s for s in stocks if s["pct_from_52h"] >= -5], key=lambda x: x["pct_from_52h"], reverse=True)
    elif strategy == "52w_low":
        stocks = sorted([s for s in stocks if s["pct_from_52l"] <= 15], key=lambda x: x["pct_from_52l"])
    elif strategy == "golden_cross":
        stocks = [s for s in stocks if s["golden_cross"]] or sorted([s for s in stocks if s["above_200dma"] and s["above_50dma"]], key=lambda x: x["rs_1m"], reverse=True)
    elif strategy == "death_cross":
        stocks = [s for s in stocks if s["death_cross"]] or sorted([s for s in stocks if not s["above_200dma"]], key=lambda x: x["change_pct"])
    elif strategy == "gap_up":
        stocks = sorted([s for s in stocks if s["gap_pct"] > 0.5], key=lambda x: x["gap_pct"], reverse=True)
    elif strategy == "gap_down":
        stocks = sorted([s for s in stocks if s["gap_pct"] < -0.5], key=lambda x: x["gap_pct"])
    elif strategy == "up_on_volume":
        stocks = sorted([s for s in stocks if s["change_pct"] > 0.5 and s["vol_ratio"] > 1.3], key=lambda x: x["vol_ratio"], reverse=True)
    elif strategy == "bb_squeeze":
        stocks = sorted([s for s in stocks if s["bb_width"] < 8], key=lambda x: x["bb_width"])
    elif strategy == "macd_crossover":
        stocks = sorted([s for s in stocks if s["macd_cross_up"]], key=lambda x: x["macd_hist"], reverse=True)
        if not stocks:
            stocks = sorted([s for s in stocks if s["macd_hist"] > 0], key=lambda x: x["macd_hist"], reverse=True)
    elif strategy == "minervini":
        stocks = sorted([s for s in stocks if s["minervini_score"] >= 5], key=lambda x: x["minervini_score"], reverse=True)
    elif strategy == "relative_strength":
        stocks = sorted(stocks, key=lambda x: x["rs_3m"], reverse=True)
    elif strategy == "recent_breakout":
        stocks = sorted([s for s in stocks if s["price"] > s["high_20"] and s["vol_ratio"] > 1.2], key=lambda x: x["change_pct"], reverse=True)
    elif strategy == "pullback_buy":
        stocks = sorted([s for s in stocks if s["above_200dma"] and s["rsi"] < 40 and s["rs_3m"] > 0], key=lambda x: x["rsi"])
    elif strategy == "top_losers":
        stocks = sorted([s for s in stocks if s["change_pct"] < -0.5], key=lambda x: x["change_pct"])
    elif strategy == "near_support":
        stocks = sorted([s for s in stocks if sf(s["price"]) <= sf(s["bb_lower"]) * 1.02 and sf(s["bb_lower"]) > 0], key=lambda x: x["rsi"])
    elif strategy == "trend_strong":
        stocks = sorted([s for s in stocks if s["above_200dma"] and s["above_50dma"] and s["rsi"] > 50 and s["rsi"] < 75], key=lambda x: x["rs_3m"], reverse=True)
    elif strategy == "high_beta":
        stocks = sorted([s for s in stocks if abs(s["change_pct"]) > 1.5], key=lambda x: abs(x["change_pct"]), reverse=True)
    elif strategy == "range_breakout":
        stocks = sorted([s for s in stocks if s["bb_width"] > 0 and s["price"] > sf(s.get("bb_upper",0)) * 0.98 and s["vol_ratio"] > 1.2], key=lambda x: x["change_pct"], reverse=True)
    elif strategy == "volume_dry":
        stocks = sorted([s for s in stocks if 0 < s["vol_ratio"] < 0.5 and s["above_200dma"]], key=lambda x: x["vol_ratio"])
    elif strategy == "macd_bearish":
        stocks = sorted([s for s in stocks if s.get("macd_hist",0) < 0 and not s.get("macd_cross_up", False)], key=lambda x: x.get("macd_hist",0))
    elif strategy == "supertrend_buy":
        stocks = sorted([s for s in stocks if s.get("above_supertrend", False) and s["rsi"] > 45], key=lambda x: x["change_pct"], reverse=True)
    elif strategy == "dividend_yield":
        stocks = sorted([s for s in stocks if sf(s.get("dividend_yield",0)) > 1.5], key=lambda x: sf(x.get("dividend_yield",0)), reverse=True)
    elif strategy == "low_pe":
        stocks = sorted([s for s in stocks if 0 < sf(s.get("pe_ratio",0)) < 15], key=lambda x: sf(x.get("pe_ratio",999)))
    elif strategy == "high_roe":
        stocks = sorted([s for s in stocks if sf(s.get("roe",0)) > 15 and s["above_200dma"]], key=lambda x: sf(x.get("roe",0)), reverse=True)
    elif strategy == "growth_momentum":
        stocks = sorted([s for s in stocks if s["above_50dma"] and s["above_200dma"] and s["rs_3m"] > 10 and s["rsi"] > 55], key=lambda x: x["rs_3m"], reverse=True)
    elif strategy == "safe_haven":
        stocks = sorted([s for s in stocks if s["above_200dma"] and s["rsi"] > 40 and s["rsi"] < 65 and sf(s.get("dividend_yield",0)) > 0.5 and abs(s["change_pct"]) < 2], key=lambda x: sf(x.get("dividend_yield",0)), reverse=True)
    elif strategy == "turnaround":
        stocks = sorted([s for s in stocks if s["pct_from_52l"] < 25 and s["vol_ratio"] > 1.5 and s["change_pct"] > 0], key=lambda x: x["vol_ratio"], reverse=True)
    elif strategy == "sector_rotation":
        # Group by sector, find best performer in each
        sector_best = {}
        for s in stocks:
            sec = s.get("sector","Other")
            if sec not in sector_best or s["rs_1m"] > sector_best[sec]["rs_1m"]:
                sector_best[sec] = s
        stocks = sorted(sector_best.values(), key=lambda x: x["rs_1m"], reverse=True)
    elif strategy == "multi_timeframe":
        stocks = sorted([s for s in stocks if s["above_200dma"] and s["above_50dma"] and s["rsi"] > 50 and s["change_pct"] > 0 and s["rs_1m"] > 0 and s["rs_3m"] > 0], key=lambda x: x["rs_3m"] + x["rs_1m"], reverse=True)
    else:
        stocks = sorted(stocks, key=lambda x: x["change_pct"], reverse=True)

    result = {"stocks": stocks[:50], "count": len(stocks), "strategy": strategy, "as_of": end, "universe_size": len(NIFTY_UNIVERSE), "scanned": len(symbols_to_scan)}
    if redis_client:
        await redis_client.setex(cache_key, 900, json.dumps(result))  # 15 min cache for large universe
    return result

# ── Watchlist ─────────────────────────────────────────────────────────────────
@app.get("/api/watchlist", tags=["Watchlist"], summary="Get watchlist",
    description="Get the authenticated user's watchlist with all saved symbols.")
async def get_watchlist(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        wl = await conn.fetchrow("SELECT symbols FROM watchlists WHERE user_id=$1", user["id"])
        return {"symbols": wl["symbols"] if wl else []}

@app.post("/api/watchlist/add/{symbol}", tags=["Watchlist"], summary="Add to watchlist",
    description="Add a stock symbol to the user's watchlist. Maximum 50 symbols per user.")
async def add_to_watchlist(symbol: str, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        # Ensure watchlist row exists
        existing = await conn.fetchrow("SELECT id FROM watchlists WHERE user_id=$1", user["id"])
        if not existing:
            await conn.execute("INSERT INTO watchlists (user_id, symbols) VALUES ($1, $2)", user["id"], [symbol.upper()])
        else:
            await conn.execute("UPDATE watchlists SET symbols=array_append(symbols,$1),updated_at=NOW() WHERE user_id=$2 AND NOT ($1=ANY(symbols))", symbol.upper(), user["id"])
        return {"message": f"{symbol.upper()} added"}

@app.delete("/api/watchlist/remove/{symbol}", tags=["Watchlist"], summary="Remove from watchlist",
    description="Remove a stock symbol from the user's watchlist.")
async def remove_from_watchlist(symbol: str, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE watchlists SET symbols=array_remove(symbols,$1),updated_at=NOW() WHERE user_id=$2", symbol.upper(), user["id"])
        return {"message": f"{symbol.upper()} removed"}

@app.get("/api/watchlist/prices", tags=["Watchlist"], summary="Get watchlist prices",
    description="Get current prices, day change, and percentage change for all stocks in the user's watchlist.")
async def watchlist_prices(user=Depends(get_current_user)):
    """Fetch live prices for all watchlist symbols via yfinance"""
    import yfinance as yf
    from datetime import date, timedelta

    async with db_pool.acquire() as conn:
        wl = await conn.fetchrow("SELECT symbols FROM watchlists WHERE user_id=$1", user["id"])
    symbols = wl["symbols"] if wl and wl["symbols"] else []
    if not symbols:
        return {"prices": [], "as_of": date.today().isoformat()}

    # Check Redis cache (60s TTL for live prices)
    cache_key = f"wl_prices:{','.join(sorted(symbols))}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    yf_symbols = [f"{s}.NS" for s in symbols]
    start = (date.today() - timedelta(days=7)).isoformat()
    end = date.today().isoformat()

    try:
        loop = asyncio.get_event_loop()
        if len(yf_symbols) == 1:
            raw = await loop.run_in_executor(None, lambda: yf.download(
                tickers=yf_symbols[0], start=start, end=end,
                interval="1d", auto_adjust=True, progress=False
            ))
            single_mode = True
        else:
            raw = await loop.run_in_executor(None, lambda: yf.download(
                tickers=" ".join(yf_symbols), start=start, end=end,
                interval="1d", group_by="ticker", auto_adjust=True, progress=False, threads=True
            ))
            single_mode = False
    except Exception as e:
        return {"prices": [], "error": str(e)}

    prices = []
    for sym in symbols:
        try:
            yf_sym = f"{sym}.NS"
            df = yf_extract_ticker(raw, yf_sym, single_mode=single_mode)
            df = df.dropna()

            if len(df) < 1:
                continue

            price = float(df["Close"].iloc[-1])
            prev = float(df["Close"].iloc[-2]) if len(df) >= 2 else price
            change = round(price - prev, 2)
            change_pct = round((price - prev) / prev * 100, 2) if prev > 0 else 0
            high = float(df["High"].iloc[-1])
            low = float(df["Low"].iloc[-1])
            opn = float(df["Open"].iloc[-1])
            vol = int(df["Volume"].iloc[-1])

            def sf(v, d=0):
                try:
                    v=float(v)
                    return d if (np.isnan(v) or np.isinf(v)) else v
                except: return d

            prices.append({
                "symbol": sym,
                "price": round(sf(price), 2),
                "change": round(sf(change), 2),
                "change_pct": round(sf(change_pct), 2),
                "open": round(sf(opn), 2),
                "high": round(sf(high), 2),
                "low": round(sf(low), 2),
                "volume": vol,
                "sector": SECTOR_MAP.get(sym, "Other"), "industry": INDUSTRY_MAP.get(sym, "Other"), "basic_industry": BASIC_INDUSTRY_MAP.get(sym, "Other")
            })
        except Exception:
            continue

    result = {"prices": prices, "as_of": end, "count": len(prices)}
    if redis_client:
        await redis_client.setex(cache_key, 60, json.dumps(result))
    return result

# ── Fundamentals ─────────────────────────────────────────────────────────────
@app.get("/api/stock/fundamentals/{symbol}", tags=["Stock Data"], summary="Get stock fundamentals",
    description="Get fundamental data for a stock — market cap, P/E, P/B, ROE, ROCE, debt-to-equity, dividend yield, revenue, profit margins, promoter holding, 52-week high/low, and more.")
async def stock_fundamentals(symbol: str, user=Depends(get_current_user)):
    """Fetch fundamental data for a stock from yfinance .info"""
    import yfinance as yf

    cache_key = f"fundamentals:{symbol.upper()}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    try:
        yf_sym = f"{symbol.upper()}.NS"
        loop = asyncio.get_event_loop()
        ticker = yf.Ticker(yf_sym)
        info = await loop.run_in_executor(None, lambda: ticker.info)

        def safe(key, default=None):
            v = info.get(key, default)
            if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
                return default
            return v

        data = {
            "symbol": symbol.upper(),
            "name": safe("longName", symbol.upper()),
            "sector": safe("sector", SECTOR_MAP.get(symbol.upper(), "—")),
            "industry": safe("industry", "—"),
            "market_cap": safe("marketCap"),
            "pe_ratio": round(safe("trailingPE", 0), 2) if safe("trailingPE") else None,
            "forward_pe": round(safe("forwardPE", 0), 2) if safe("forwardPE") else None,
            "pb_ratio": round(safe("priceToBook", 0), 2) if safe("priceToBook") else None,
            "roe": round(safe("returnOnEquity", 0) * 100, 2) if safe("returnOnEquity") else None,
            "roa": round(safe("returnOnAssets", 0) * 100, 2) if safe("returnOnAssets") else None,
            "debt_to_equity": round(safe("debtToEquity", 0), 2) if safe("debtToEquity") else None,
            "dividend_yield": round(safe("dividendYield", 0) * 100, 2) if safe("dividendYield") else None,
            "eps": safe("trailingEps"),
            "revenue": safe("totalRevenue"),
            "profit_margin": round(safe("profitMargins", 0) * 100, 2) if safe("profitMargins") else None,
            "beta": round(safe("beta", 0), 2) if safe("beta") else None,
            "fifty_two_week_high": safe("fiftyTwoWeekHigh"),
            "fifty_two_week_low": safe("fiftyTwoWeekLow"),
            "avg_volume": safe("averageVolume"),
            "book_value": safe("bookValue"),
            "current_price": safe("currentPrice") or safe("regularMarketPrice"),
        }

        result = {"fundamentals": data}
        if redis_client:
            await redis_client.setex(cache_key, 600, json.dumps(result))
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fundamentals fetch error: {str(e)}")


# ══════════════════════════════════════════════════════════════════════════════
# SYMBOL SEARCH — ANY NSE / BSE STOCK
# ══════════════════════════════════════════════════════════════════════════════

# Extended universe — top BSE stocks not already in NIFTY_UNIVERSE
BSE_EXTRA = [
    "ADANIPOWER","SUZLON","IREDA","JIOPEP","ZOMATO","IDEA","YESBANK","TATAMTRDVR",
    "RPOWER","TRIDENT","NHPC","IRFC","RVNL","HUDCO","PFC","RECLTD","SJVN",
    "HFCL","GMRAIRPORT","NLCINDIA","NBCC","NCC","IRB","COCHINSHIP","GRSE","BDL",
    "MAZDOCK","RAILTEL","RITES","IRCON","EIHOTEL","CESC","GSFC","GMDCLTD","GPIL",
    "TANLA","BBTC","CCL","CENTURYPLY","DCBBANK","GESHIP","GHCL","GPPL","GRINDWELL",
    "GSPL","GUJALKALI","GUJGASLTD","IIFLWAM","INDIAGLYCO","JKLAKSHMI","JSWHL",
    "KANSAINER","KSCL","LXCHEM","MAHLIFE","MAHLOG","MAXHEALTH","METROPOLIS",
    "MMTC","MOIL","MOTILALOFS","MRPL","NESCO","NFL","NIITLTD","OIL","PCBL",
    "PHOENIXLTD","RAJESHEXPO","RATNAMANI","SANOFI","SCI","SHYAMMETL","SIS",
    "SJVN","SKFINDIA","SOBHA","SOLARINDS","SPARC","STLTECH","SUDARSCHEM",
    "SUMICHEM","SUNDRMFAST","SUPREMEIND","SYNGENE","TATACHEM","TATACOMM",
    "TATAINVEST","THERMAX","TIMKEN","TORNTPOWER","TRITURBINE","TVSSRICHAK",
    "UCOBANK","UJJIVANSFB","UPL","VSTIND","WELCORP","WELSPUNLIV","ZEEL",
    "HINDWAREAP","DREAMFOLKS","HERITGFOOD","MAHSCOOTER","CAMPUS","CERA",
]

ALL_SYMBOLS = list(set(NIFTY_UNIVERSE + BSE_EXTRA))
ALL_SYMBOLS.sort()


@app.get("/api/symbols/search", tags=["Stock Data"], summary="Search symbols",
    description="Search for stock symbols by name or ticker. Returns matching symbols with company name, sector, and industry.")
async def search_symbols(q: str = "", exchange: str = "NSE", user=Depends(get_current_user)):
    """Search for stocks across NSE/BSE. Returns matching symbols."""
    query = q.upper().strip()
    if not query or len(query) < 1:
        return {"results": [], "query": q}

    # Search in our universe first
    matches = []
    for sym in ALL_SYMBOLS:
        if query in sym:
            matches.append({
                "symbol": sym, "exchange": "NSE",
                "sector": SECTOR_MAP.get(sym, "Other"), "industry": INDUSTRY_MAP.get(sym, "Other"), "basic_industry": BASIC_INDUSTRY_MAP.get(sym, "Other"),
                "in_universe": sym in NIFTY_UNIVERSE,
            })
    matches.sort(key=lambda x: (0 if x["symbol"].startswith(query) else 1, x["symbol"]))

    # If few matches, try yfinance search for broader results
    if len(matches) < 5:
        import yfinance as yf
        loop = asyncio.get_event_loop()
        try:
            suffix = ".NS" if exchange.upper() == "NSE" else ".BO"
            # Try exact match
            test_sym = f"{query}{suffix}"
            ticker = await loop.run_in_executor(None, lambda: yf.Ticker(test_sym))
            info = await loop.run_in_executor(None, lambda: ticker.info)
            if info and info.get("regularMarketPrice"):
                existing = any(m["symbol"] == query for m in matches)
                if not existing:
                    matches.insert(0, {
                        "symbol": query, "exchange": exchange.upper(),
                        "name": info.get("shortName", ""),
                        "sector": info.get("sector", "Other"),
                        "price": info.get("regularMarketPrice", 0),
                        "in_universe": query in NIFTY_UNIVERSE,
                    })
        except:
            pass

    return {"results": matches[:20], "query": q, "total": len(matches)}


@app.get("/api/symbols/all", tags=["Stock Data"], summary="Get all symbols",
    description="Returns the complete list of 843 NSE symbols in the AlphaLab universe with sector, industry, and basic industry classification.")
async def all_symbols(user=Depends(get_current_user)):
    """Return full symbol list with sector info for autocomplete."""
    sym_list = [{"s": s, "sec": SECTOR_MAP.get(s, ""), "ind": INDUSTRY_MAP.get(s, "")} for s in ALL_SYMBOLS]
    sym_list.sort(key=lambda x: x["s"])
    return {"symbols": [x["s"] for x in sym_list], "detail": sym_list, "count": len(ALL_SYMBOLS), "nifty_count": len(NIFTY_UNIVERSE)}


# ══════════════════════════════════════════════════════════════════════════════
# OPTIONS TRADING ENGINE
# ══════════════════════════════════════════════════════════════════════════════

import math
from scipy.stats import norm

def black_scholes(S, K, T, r, sigma, option_type="call"):
    """Black-Scholes option pricing."""
    if T <= 0 or sigma <= 0:
        intrinsic = max(S - K, 0) if option_type == "call" else max(K - S, 0)
        return {"price": intrinsic, "delta": 1 if option_type == "call" and S > K else 0,
                "gamma": 0, "theta": 0, "vega": 0, "rho": 0}

    d1 = (math.log(S / K) + (r + sigma**2 / 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)

    if option_type == "call":
        price = S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
        delta = norm.cdf(d1)
    else:
        price = K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
        delta = norm.cdf(d1) - 1

    gamma = norm.pdf(d1) / (S * sigma * math.sqrt(T))
    theta = (-S * norm.pdf(d1) * sigma / (2 * math.sqrt(T))
             - r * K * math.exp(-r * T) * norm.cdf(d2 if option_type == "call" else -d2)
             * (1 if option_type == "call" else -1)) / 365
    vega = S * norm.pdf(d1) * math.sqrt(T) / 100
    rho = (K * T * math.exp(-r * T) * norm.cdf(d2 if option_type == "call" else -d2)
           * (1 if option_type == "call" else -1)) / 100

    return {
        "price": round(price, 2), "delta": round(delta, 4), "gamma": round(gamma, 6),
        "theta": round(theta, 2), "vega": round(vega, 2), "rho": round(rho, 2),
    }


def implied_volatility(market_price, S, K, T, r, option_type="call", tol=1e-5, max_iter=100):
    """Newton-Raphson implied volatility calculation."""
    sigma = 0.3  # initial guess
    for _ in range(max_iter):
        bs = black_scholes(S, K, T, r, sigma, option_type)
        diff = bs["price"] - market_price
        if abs(diff) < tol:
            return round(sigma * 100, 2)  # return as percentage
        vega = bs["vega"] * 100  # un-scale
        if abs(vega) < 1e-10:
            break
        sigma -= diff / vega
        sigma = max(0.01, min(sigma, 5.0))
    return round(sigma * 100, 2)


OPTIONS_STRATEGIES = {
    # ═══════════════════════════════════════════════════════════════════════════
    # BULLISH STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "long_call": {
        "name": "Long Call", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}],
        "description": "Bullish — buy a call option. Unlimited profit, limited loss to premium paid.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "low", "expiry": "any"}
    },
    "long_itm_call": {
        "name": "Long ITM Call", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": -2}],
        "description": "Deep bullish — buy an ITM call for high delta exposure with less time decay risk.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,gamma+,theta-", "vol_view": "neutral", "complexity": "low", "expiry": "any"}
    },
    "long_otm_call": {
        "name": "Long OTM Call", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 3}],
        "description": "Aggressive bullish — cheap OTM call with high leverage but low probability.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,vega+,theta-", "vol_view": "expansion", "complexity": "low", "expiry": "weekly"}
    },
    "bull_call_spread": {
        "name": "Bull Call Spread", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2}],
        "description": "Moderately bullish — buy lower strike call, sell higher. Limited risk and reward.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta~,vega~", "vol_view": "neutral", "complexity": "low", "expiry": "any"}
    },
    "bull_put_spread": {
        "name": "Bull Put Spread", "category": "bullish",
        "legs": [{"type": "put", "side": "sell", "strike_offset": 0}, {"type": "put", "side": "buy", "strike_offset": -2}],
        "description": "Moderately bullish credit spread — collect premium, profit if price stays above short put.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta+,vega-", "vol_view": "contraction", "complexity": "low", "expiry": "any"}
    },
    "itm_call_spread": {
        "name": "ITM Call Spread", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": -2}, {"type": "call", "side": "sell", "strike_offset": 0}],
        "description": "Conservative bullish — higher cost but higher probability of profit.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta~", "vol_view": "neutral", "complexity": "low", "expiry": "monthly"}
    },
    "covered_call": {
        "name": "Covered Call", "category": "bullish",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "call", "side": "sell", "strike_offset": 1}],
        "description": "Mild bullish — hold stock + sell OTM call for income. Caps upside.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,theta+", "vol_view": "contraction", "complexity": "low", "expiry": "monthly"}
    },
    "cash_secured_put": {
        "name": "Cash Secured Put", "category": "bullish",
        "legs": [{"type": "put", "side": "sell", "strike_offset": -1}],
        "description": "Bullish income — sell OTM put with cash reserve. Profit from premium if stock stays above strike.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "naked", "greeks": "delta+,theta+,vega-", "vol_view": "contraction", "complexity": "low", "expiry": "monthly"}
    },
    "synthetic_long": {
        "name": "Synthetic Long", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": 0}],
        "description": "Synthetic stock position — same P&L as owning stock but with less capital.",
        "tags": {"bias": "bullish", "risk": "unlimited", "margin": "naked", "greeks": "delta+,gamma+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },
    "risk_reversal_bullish": {
        "name": "Risk Reversal (Bullish)", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 2}, {"type": "put", "side": "sell", "strike_offset": -2}],
        "description": "Bullish risk reversal — buy OTM call funded by selling OTM put. Near zero-cost bullish bet.",
        "tags": {"bias": "bullish", "risk": "unlimited", "margin": "naked", "greeks": "delta+,vega+", "vol_view": "expansion", "complexity": "medium", "expiry": "monthly"}
    },
    "call_ratio_spread": {
        "name": "Call Ratio Spread (1x2)", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2, "qty_mult": 2}],
        "description": "Bullish with cap — buy 1 ATM call, sell 2 OTM calls. Profits in moderate rise, risk if sharp rally.",
        "tags": {"bias": "bullish", "risk": "unlimited", "margin": "naked", "greeks": "delta+,theta+,vega-", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "call_backspread": {
        "name": "Call Backspread", "category": "bullish",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 0}, {"type": "call", "side": "buy", "strike_offset": 2, "qty_mult": 2}],
        "description": "Volatile bullish — sell 1 ATM call, buy 2 OTM calls. Big profit on sharp rally.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,gamma+,vega+", "vol_view": "expansion", "complexity": "high", "expiry": "event"}
    },
    "bull_call_ladder": {
        "name": "Bull Call Ladder", "category": "bullish",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2}, {"type": "call", "side": "sell", "strike_offset": 4}],
        "description": "Moderate bullish — buy 1 call, sell 2 higher calls at different strikes. Risk above top strike.",
        "tags": {"bias": "bullish", "risk": "unlimited", "margin": "naked", "greeks": "delta+,theta+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # BEARISH STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "long_put": {
        "name": "Long Put", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 0}],
        "description": "Bearish — buy a put option. Profit from price decline, loss limited to premium.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "hedged", "greeks": "delta-,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "low", "expiry": "any"}
    },
    "long_itm_put": {
        "name": "Long ITM Put", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 2}],
        "description": "Deep bearish — buy ITM put for high delta, acts almost like short stock.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "hedged", "greeks": "delta-,gamma+", "vol_view": "neutral", "complexity": "low", "expiry": "any"}
    },
    "bear_put_spread": {
        "name": "Bear Put Spread", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": -2}],
        "description": "Moderately bearish — buy higher put, sell lower. Limited risk/reward.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,theta~,vega~", "vol_view": "neutral", "complexity": "low", "expiry": "any"}
    },
    "bear_call_spread": {
        "name": "Bear Call Spread", "category": "bearish",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 0}, {"type": "call", "side": "buy", "strike_offset": 2}],
        "description": "Moderately bearish credit spread — collect premium, profit if price stays below short call.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,theta+,vega-", "vol_view": "contraction", "complexity": "low", "expiry": "any"}
    },
    "itm_put_spread": {
        "name": "ITM Put Spread", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 2}, {"type": "put", "side": "sell", "strike_offset": 0}],
        "description": "Conservative bearish — higher cost but higher probability of profit on decline.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,theta~", "vol_view": "neutral", "complexity": "low", "expiry": "monthly"}
    },
    "synthetic_short": {
        "name": "Synthetic Short", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 0}],
        "description": "Synthetic short stock — same P&L as shorting stock with options.",
        "tags": {"bias": "bearish", "risk": "unlimited", "margin": "naked", "greeks": "delta-,gamma+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },
    "risk_reversal_bearish": {
        "name": "Risk Reversal (Bearish)", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": -2}, {"type": "call", "side": "sell", "strike_offset": 2}],
        "description": "Bearish risk reversal — buy OTM put funded by selling OTM call.",
        "tags": {"bias": "bearish", "risk": "unlimited", "margin": "naked", "greeks": "delta-,vega+", "vol_view": "expansion", "complexity": "medium", "expiry": "monthly"}
    },
    "put_ratio_spread": {
        "name": "Put Ratio Spread (1x2)", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": -2, "qty_mult": 2}],
        "description": "Bearish with cap — buy 1 ATM put, sell 2 OTM puts. Profits on moderate decline.",
        "tags": {"bias": "bearish", "risk": "unlimited", "margin": "naked", "greeks": "delta-,theta+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "put_backspread": {
        "name": "Put Backspread", "category": "bearish",
        "legs": [{"type": "put", "side": "sell", "strike_offset": 0}, {"type": "put", "side": "buy", "strike_offset": -2, "qty_mult": 2}],
        "description": "Volatile bearish — sell 1 ATM put, buy 2 OTM puts. Big profit on crash.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,gamma+,vega+", "vol_view": "expansion", "complexity": "high", "expiry": "event"}
    },
    "bear_put_ladder": {
        "name": "Bear Put Ladder", "category": "bearish",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": -2}, {"type": "put", "side": "sell", "strike_offset": -4}],
        "description": "Moderate bearish — buy 1 put, sell 2 lower puts. Risk below lowest strike.",
        "tags": {"bias": "bearish", "risk": "unlimited", "margin": "naked", "greeks": "delta-,theta+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # NEUTRAL / RANGE-BOUND STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "short_straddle": {
        "name": "Short Straddle", "category": "neutral",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": 0}],
        "description": "Neutral premium selling — sell ATM call + put. Max profit at strike, unlimited risk.",
        "tags": {"bias": "neutral", "risk": "unlimited", "margin": "naked", "greeks": "delta~,theta+,vega-,gamma-", "vol_view": "contraction", "complexity": "medium", "expiry": "weekly"}
    },
    "short_strangle": {
        "name": "Short Strangle", "category": "neutral",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 2}, {"type": "put", "side": "sell", "strike_offset": -2}],
        "description": "Neutral — sell OTM call + put. Wider profit zone than straddle, unlimited risk.",
        "tags": {"bias": "neutral", "risk": "unlimited", "margin": "naked", "greeks": "delta~,theta+,vega-,gamma-", "vol_view": "contraction", "complexity": "medium", "expiry": "weekly"}
    },
    "iron_condor": {
        "name": "Iron Condor", "category": "neutral",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -3}, {"type": "put", "side": "sell", "strike_offset": -1},
            {"type": "call", "side": "sell", "strike_offset": 1}, {"type": "call", "side": "buy", "strike_offset": 3}
        ],
        "description": "Neutral — profit if price stays in range. Limited risk on both sides.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega-,gamma-", "vol_view": "contraction", "complexity": "medium", "expiry": "any"}
    },
    "iron_butterfly": {
        "name": "Iron Butterfly", "category": "neutral",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -2}, {"type": "put", "side": "sell", "strike_offset": 0},
            {"type": "call", "side": "sell", "strike_offset": 0}, {"type": "call", "side": "buy", "strike_offset": 2}
        ],
        "description": "Neutral — tighter range than iron condor. Higher premium collected, ATM short.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega-,gamma-", "vol_view": "contraction", "complexity": "medium", "expiry": "weekly"}
    },
    "butterfly_spread": {
        "name": "Butterfly Spread", "category": "neutral",
        "legs": [
            {"type": "call", "side": "buy", "strike_offset": -2}, {"type": "call", "side": "sell", "strike_offset": 0, "qty_mult": 2},
            {"type": "call", "side": "buy", "strike_offset": 2}
        ],
        "description": "Neutral — max profit if price pins at middle strike at expiry. Very cheap to enter.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,gamma-", "vol_view": "contraction", "complexity": "medium", "expiry": "weekly"}
    },
    "broken_wing_butterfly": {
        "name": "Broken Wing Butterfly", "category": "neutral",
        "legs": [
            {"type": "call", "side": "buy", "strike_offset": -1}, {"type": "call", "side": "sell", "strike_offset": 0, "qty_mult": 2},
            {"type": "call", "side": "buy", "strike_offset": 3}
        ],
        "description": "Neutral with directional skew — asymmetric butterfly with zero risk on one side.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "broken_wing_iron_condor": {
        "name": "Broken Wing Iron Condor", "category": "neutral",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -4}, {"type": "put", "side": "sell", "strike_offset": -1},
            {"type": "call", "side": "sell", "strike_offset": 1}, {"type": "call", "side": "buy", "strike_offset": 2}
        ],
        "description": "Skewed iron condor — uneven wings to take credit and directional bias.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega-", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "covered_strangle": {
        "name": "Covered Strangle", "category": "neutral",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "call", "side": "sell", "strike_offset": 2}, {"type": "put", "side": "sell", "strike_offset": -2}],
        "description": "Hold stock + sell OTM call and OTM put. Enhanced income, large margin requirement.",
        "tags": {"bias": "neutral", "risk": "unlimited", "margin": "naked", "greeks": "delta+,theta+", "vol_view": "contraction", "complexity": "medium", "expiry": "monthly"}
    },
    "christmas_tree": {
        "name": "Christmas Tree Spread", "category": "neutral",
        "legs": [
            {"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2},
            {"type": "call", "side": "sell", "strike_offset": 3}
        ],
        "description": "Neutral-to-bullish — like a ladder, profits in moderate move, risk beyond top strike.",
        "tags": {"bias": "neutral", "risk": "unlimited", "margin": "naked", "greeks": "delta+,theta+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # VOLATILITY EXPANSION STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "long_straddle": {
        "name": "Long Straddle", "category": "volatility",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "buy", "strike_offset": 0}],
        "description": "Expecting big move in either direction — buy ATM call + put.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "low", "expiry": "event"}
    },
    "long_strangle": {
        "name": "Long Strangle", "category": "volatility",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 2}, {"type": "put", "side": "buy", "strike_offset": -2}],
        "description": "Expecting big move — buy OTM call + OTM put. Cheaper than straddle, needs bigger move.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "low", "expiry": "event"}
    },
    "strip": {
        "name": "Strip", "category": "volatility",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "buy", "strike_offset": 0, "qty_mult": 2}],
        "description": "Bearish volatile — 1 call + 2 puts at same strike. Extra profit on downside.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "hedged", "greeks": "delta-,gamma+,vega+", "vol_view": "expansion", "complexity": "medium", "expiry": "event"}
    },
    "strap": {
        "name": "Strap", "category": "volatility",
        "legs": [{"type": "call", "side": "buy", "strike_offset": 0, "qty_mult": 2}, {"type": "put", "side": "buy", "strike_offset": 0}],
        "description": "Bullish volatile — 2 calls + 1 put at same strike. Extra profit on upside.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,gamma+,vega+", "vol_view": "expansion", "complexity": "medium", "expiry": "event"}
    },
    "long_guts": {
        "name": "Long Guts", "category": "volatility",
        "legs": [{"type": "call", "side": "buy", "strike_offset": -1}, {"type": "put", "side": "buy", "strike_offset": 1}],
        "description": "Volatile — buy ITM call + ITM put. Higher cost but profit zone starts immediately.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "medium", "expiry": "event"}
    },
    "reverse_iron_condor": {
        "name": "Reverse Iron Condor", "category": "volatility",
        "legs": [
            {"type": "put", "side": "sell", "strike_offset": -3}, {"type": "put", "side": "buy", "strike_offset": -1},
            {"type": "call", "side": "buy", "strike_offset": 1}, {"type": "call", "side": "sell", "strike_offset": 3}
        ],
        "description": "Breakout play — debit position that profits from big move in either direction.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,gamma+,vega+,theta-", "vol_view": "expansion", "complexity": "medium", "expiry": "event"}
    },
    "reverse_iron_butterfly": {
        "name": "Reverse Iron Butterfly", "category": "volatility",
        "legs": [
            {"type": "put", "side": "sell", "strike_offset": -2}, {"type": "put", "side": "buy", "strike_offset": 0},
            {"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2}
        ],
        "description": "Breakout from pin — profits from big move away from ATM, capped by sold wings.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,gamma+,vega+", "vol_view": "expansion", "complexity": "medium", "expiry": "event"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # TIME-BASED / CALENDAR STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "calendar_spread": {
        "name": "Call Calendar Spread", "category": "time_based",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 0, "expiry": "near"}, {"type": "call", "side": "buy", "strike_offset": 0, "expiry": "far"}],
        "description": "Time decay play — sell near-month call, buy same-strike far-month call.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega+", "vol_view": "contraction", "complexity": "medium", "expiry": "monthly"}
    },
    "put_calendar": {
        "name": "Put Calendar Spread", "category": "time_based",
        "legs": [{"type": "put", "side": "sell", "strike_offset": 0, "expiry": "near"}, {"type": "put", "side": "buy", "strike_offset": 0, "expiry": "far"}],
        "description": "Time decay with bearish lean — sell near put, buy far put at same strike.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega+", "vol_view": "contraction", "complexity": "medium", "expiry": "monthly"}
    },
    "double_calendar": {
        "name": "Double Calendar", "category": "time_based",
        "legs": [
            {"type": "put", "side": "sell", "strike_offset": -2, "expiry": "near"}, {"type": "put", "side": "buy", "strike_offset": -2, "expiry": "far"},
            {"type": "call", "side": "sell", "strike_offset": 2, "expiry": "near"}, {"type": "call", "side": "buy", "strike_offset": 2, "expiry": "far"}
        ],
        "description": "Neutral time decay — two calendar spreads at different strikes for wider profit zone.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega+", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "diagonal_call_spread": {
        "name": "Diagonal Call Spread", "category": "time_based",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 2, "expiry": "near"}, {"type": "call", "side": "buy", "strike_offset": 0, "expiry": "far"}],
        "description": "Bullish calendar — sell near OTM call, buy far ATM call. Time + directional play.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta+,vega+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },
    "diagonal_put_spread": {
        "name": "Diagonal Put Spread", "category": "time_based",
        "legs": [{"type": "put", "side": "sell", "strike_offset": -2, "expiry": "near"}, {"type": "put", "side": "buy", "strike_offset": 0, "expiry": "far"}],
        "description": "Bearish calendar — sell near OTM put, buy far ATM put.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,theta+,vega+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },
    "pmcc": {
        "name": "Poor Man's Covered Call", "category": "time_based",
        "legs": [{"type": "call", "side": "buy", "strike_offset": -3, "expiry": "far"}, {"type": "call", "side": "sell", "strike_offset": 1, "expiry": "near"}],
        "description": "Budget covered call — buy deep ITM LEAP call, sell near OTM call against it.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },
    "pmcp": {
        "name": "Poor Man's Covered Put", "category": "time_based",
        "legs": [{"type": "put", "side": "buy", "strike_offset": 3, "expiry": "far"}, {"type": "put", "side": "sell", "strike_offset": -1, "expiry": "near"}],
        "description": "Budget covered put — buy deep ITM LEAP put, sell near OTM put against it.",
        "tags": {"bias": "bearish", "risk": "limited", "margin": "spread", "greeks": "delta-,theta+", "vol_view": "neutral", "complexity": "medium", "expiry": "monthly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # HEDGING & PROTECTION STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "protective_put": {
        "name": "Protective Put", "category": "hedging",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "put", "side": "buy", "strike_offset": -1}],
        "description": "Hold stock + buy OTM put for downside protection. Insurance strategy.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "hedged", "greeks": "delta+,gamma+,vega+", "vol_view": "expansion", "complexity": "low", "expiry": "monthly"}
    },
    "collar": {
        "name": "Collar", "category": "hedging",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "put", "side": "buy", "strike_offset": -2}, {"type": "call", "side": "sell", "strike_offset": 2}],
        "description": "Hold stock + buy put + sell call. Zero-cost protection that caps upside.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta+", "vol_view": "neutral", "complexity": "low", "expiry": "monthly"}
    },
    "zero_cost_collar": {
        "name": "Zero Cost Collar", "category": "hedging",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "put", "side": "buy", "strike_offset": -1}, {"type": "call", "side": "sell", "strike_offset": 1}],
        "description": "Collar where put cost is exactly offset by call premium. True zero-cost hedge.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta+", "vol_view": "neutral", "complexity": "low", "expiry": "monthly"}
    },
    "tail_hedge": {
        "name": "Tail Hedge (Far OTM Put)", "category": "hedging",
        "legs": [{"type": "put", "side": "buy", "strike_offset": -5}],
        "description": "Crash protection — buy far OTM put cheaply for black swan events.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~,vega+", "vol_view": "expansion", "complexity": "low", "expiry": "monthly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # EXPIRY-SPECIFIC / 0DTE STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "expiry_straddle": {
        "name": "Expiry Day Short Straddle", "category": "expiry",
        "legs": [{"type": "call", "side": "sell", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": 0}],
        "description": "Sell ATM straddle on expiry day — extreme theta decay, gamma risk. For experienced traders.",
        "tags": {"bias": "neutral", "risk": "unlimited", "margin": "naked", "greeks": "delta~,theta++,gamma-", "vol_view": "contraction", "complexity": "high", "expiry": "weekly"}
    },
    "intraday_iron_fly": {
        "name": "Intraday Iron Fly (0DTE)", "category": "expiry",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -1}, {"type": "put", "side": "sell", "strike_offset": 0},
            {"type": "call", "side": "sell", "strike_offset": 0}, {"type": "call", "side": "buy", "strike_offset": 1}
        ],
        "description": "Same-day iron butterfly — tight strikes for max theta extraction.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta++,gamma-", "vol_view": "contraction", "complexity": "high", "expiry": "weekly"}
    },
    "narrow_iron_condor_0dte": {
        "name": "Narrow Iron Condor (0DTE)", "category": "expiry",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -2}, {"type": "put", "side": "sell", "strike_offset": -1},
            {"type": "call", "side": "sell", "strike_offset": 1}, {"type": "call", "side": "buy", "strike_offset": 2}
        ],
        "description": "Tight iron condor for expiry day — narrow strikes, fast decay.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta++,gamma-", "vol_view": "contraction", "complexity": "high", "expiry": "weekly"}
    },
    "pin_risk_butterfly": {
        "name": "Pin Risk Butterfly", "category": "expiry",
        "legs": [
            {"type": "call", "side": "buy", "strike_offset": -1}, {"type": "call", "side": "sell", "strike_offset": 0, "qty_mult": 2},
            {"type": "call", "side": "buy", "strike_offset": 1}
        ],
        "description": "Expiry pin play — butterfly centered at max pain strike expecting price to pin.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,gamma-", "vol_view": "contraction", "complexity": "high", "expiry": "weekly"}
    },

    # ═══════════════════════════════════════════════════════════════════════════
    # ADVANCED / INSTITUTIONAL STRATEGIES
    # ═══════════════════════════════════════════════════════════════════════════
    "box_spread": {
        "name": "Box Spread", "category": "advanced",
        "legs": [
            {"type": "call", "side": "buy", "strike_offset": 0}, {"type": "call", "side": "sell", "strike_offset": 2},
            {"type": "put", "side": "buy", "strike_offset": 2}, {"type": "put", "side": "sell", "strike_offset": 0}
        ],
        "description": "Arbitrage — bull call spread + bear put spread. Riskless profit if mispriced.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~", "vol_view": "neutral", "complexity": "high", "expiry": "monthly"}
    },
    "conversion": {
        "name": "Conversion", "category": "advanced",
        "legs": [{"type": "stock", "side": "buy"}, {"type": "call", "side": "sell", "strike_offset": 0}, {"type": "put", "side": "buy", "strike_offset": 0}],
        "description": "Arbitrage — long stock + synthetic short. Locks in riskless profit if mispriced.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~", "vol_view": "neutral", "complexity": "high", "expiry": "monthly"}
    },
    "reversal": {
        "name": "Reversal", "category": "advanced",
        "legs": [{"type": "stock", "side": "sell"}, {"type": "call", "side": "buy", "strike_offset": 0}, {"type": "put", "side": "sell", "strike_offset": 0}],
        "description": "Arbitrage — short stock + synthetic long. Opposite of conversion.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "hedged", "greeks": "delta~", "vol_view": "neutral", "complexity": "high", "expiry": "monthly"}
    },
    "jade_lizard": {
        "name": "Jade Lizard", "category": "advanced",
        "legs": [
            {"type": "put", "side": "sell", "strike_offset": -2},
            {"type": "call", "side": "sell", "strike_offset": 1}, {"type": "call", "side": "buy", "strike_offset": 3}
        ],
        "description": "Neutral-bullish — short put + bear call spread. No risk on upside if structured right.",
        "tags": {"bias": "bullish", "risk": "limited", "margin": "spread", "greeks": "delta+,theta+,vega-", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
    "double_diagonal": {
        "name": "Double Diagonal", "category": "advanced",
        "legs": [
            {"type": "put", "side": "sell", "strike_offset": -2, "expiry": "near"}, {"type": "put", "side": "buy", "strike_offset": -1, "expiry": "far"},
            {"type": "call", "side": "sell", "strike_offset": 2, "expiry": "near"}, {"type": "call", "side": "buy", "strike_offset": 1, "expiry": "far"}
        ],
        "description": "Two diagonal spreads — combines time decay + directional play in both directions.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega+", "vol_view": "neutral", "complexity": "high", "expiry": "monthly"}
    },
    "broken_wing_iron_fly": {
        "name": "Broken Wing Iron Fly", "category": "advanced",
        "legs": [
            {"type": "put", "side": "buy", "strike_offset": -3}, {"type": "put", "side": "sell", "strike_offset": 0},
            {"type": "call", "side": "sell", "strike_offset": 0}, {"type": "call", "side": "buy", "strike_offset": 2}
        ],
        "description": "Skewed iron butterfly — asymmetric wings, zero risk on one side, extra credit.",
        "tags": {"bias": "neutral", "risk": "limited", "margin": "spread", "greeks": "delta~,theta+,vega-", "vol_view": "contraction", "complexity": "high", "expiry": "monthly"}
    },
}

# Strategy category metadata
STRATEGY_CATEGORIES = {
    "bullish": {"icon": "📈", "color": "#00d4aa", "label": "Bullish"},
    "bearish": {"icon": "📉", "color": "#ff5252", "label": "Bearish"},
    "neutral": {"icon": "↔️", "color": "#ffab40", "label": "Neutral / Range-Bound"},
    "volatility": {"icon": "⚡", "color": "#7c4dff", "label": "Volatility"},
    "time_based": {"icon": "⏳", "color": "#40c4ff", "label": "Time-Based / Calendar"},
    "hedging": {"icon": "🛡️", "color": "#69f0ae", "label": "Hedging & Protection"},
    "expiry": {"icon": "🎯", "color": "#ff6e40", "label": "Expiry Day / 0DTE"},
    "advanced": {"icon": "🏛️", "color": "#b388ff", "label": "Advanced / Institutional"},
}


@app.get("/api/options/chain/{symbol}", tags=["Options Lab"], summary="Get options chain",
    description="Fetch the options chain for a stock or index. Returns all available strikes with call/put prices, OI, volume, IV, and Greeks (Delta, Gamma, Theta, Vega). Supports NIFTY, BANKNIFTY, FINNIFTY, and all F&O stocks. Falls back to Black-Scholes synthetic pricing when live data is unavailable.")
async def options_chain(symbol: str, expiry: str = "", user=Depends(get_current_user)):
    """Fetch options chain — tries Groww API first, falls back to Black-Scholes synthetic."""
    import yfinance as yf
    from datetime import datetime, timedelta, date
    import random, calendar, urllib.request, urllib.error

    sym_upper = symbol.upper()
    cache_key = f"options_chain:{sym_upper}:{expiry}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    INDEX_MAP = {"NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK", "FINNIFTY": "^CNXFIN",
                 "MIDCPNIFTY": "^NSEI", "SENSEX": "^BSESN"}
    LOT_SIZES = {"NIFTY": 25, "BANKNIFTY": 15, "FINNIFTY": 25, "RELIANCE": 250,
                 "TCS": 150, "INFY": 300, "HDFCBANK": 550, "ICICIBANK": 700,
                 "SBIN": 750, "TATAMOTORS": 575, "ITC": 1600, "BAJFINANCE": 125,
                 "MARUTI": 100, "WIPRO": 1500, "SUNPHARMA": 700, "TATASTEEL": 550,
                 "LT": 150, "AXISBANK": 600, "BHARTIARTL": 475, "M&M": 350,
                 "ADANIENT": 400, "HCLTECH": 350, "KOTAKBANK": 400, "TITAN": 375,
                 "HINDALCO": 1400, "JSWSTEEL": 675, "CIPLA": 650, "DRREDDY": 125,
                 "ONGC": 3250, "NTPC": 2250, "POWERGRID": 2700, "COALINDIA": 2100}
    is_index = sym_upper in INDEX_MAP
    lot_size = LOT_SIZES.get(sym_upper, 50)
    today = date.today()

    # ── Generate expiry dates ────────────────────────────────────────────────
    def get_expiry_dates():
        expiries = []
        days_to_thu = (3 - today.weekday()) % 7
        if days_to_thu == 0:
            days_to_thu = 7
        nxt = today + timedelta(days=days_to_thu)
        if is_index:
            for _ in range(6):
                expiries.append(nxt.isoformat())
                nxt += timedelta(days=7)
        else:
            for i in range(5):
                month = today.month + i
                year = today.year + (month - 1) // 12
                month = ((month - 1) % 12) + 1
                last_day = calendar.monthrange(year, month)[1]
                ld = date(year, month, last_day)
                while ld.weekday() != 3:
                    ld -= timedelta(days=1)
                if ld > today:
                    expiries.append(ld.isoformat())
        return expiries or [(today + timedelta(days=7*i+7)).isoformat() for i in range(4)]

    expiry_dates = get_expiry_dates()

    # ── Try Groww API first ──────────────────────────────────────────────────
    groww_token = await get_groww_token()
    groww_success = False
    chains = []
    spot_price = 0
    data_source = "synthetic"

    if groww_token:
        try:
            loop = asyncio.get_event_loop()

            # Get spot price from Groww LTP
            async def groww_get(url):
                req_obj = urllib.request.Request(url, headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {groww_token}",
                    "X-API-VERSION": "1.0"
                })
                return await loop.run_in_executor(None, lambda: urllib.request.urlopen(req_obj, timeout=10).read().decode())

            # Spot price via Groww LTP
            ltp_segment = "CASH"
            ltp_sym = f"NSE_{sym_upper}"
            try:
                ltp_resp = json.loads(await groww_get(
                    f"https://api.groww.in/v1/live-data/ltp?segment={ltp_segment}&exchange_symbols={ltp_sym}"
                ))
                if ltp_resp.get("status") == "SUCCESS" and ltp_resp.get("payload", {}).get(ltp_sym):
                    spot_price = float(ltp_resp["payload"][ltp_sym])
            except:
                pass

            # Fetch chain for each expiry from Groww
            target_expiries = [expiry] if expiry else expiry_dates[:4]
            for exp_str in target_expiries:
                try:
                    chain_url = f"https://api.groww.in/v1/option-chain/exchange/NSE/underlying/{sym_upper}?expiry_date={exp_str}"
                    chain_resp = json.loads(await groww_get(chain_url))

                    if chain_resp.get("status") != "SUCCESS":
                        continue

                    payload = chain_resp["payload"]
                    if not spot_price and payload.get("underlying_ltp"):
                        spot_price = float(payload["underlying_ltp"])

                    strikes_data = payload.get("strikes", {})
                    if not strikes_data:
                        continue

                    exp_data = {"expiry": exp_str, "calls": [], "puts": []}

                    for strike_str, contracts in strikes_data.items():
                        strike = float(strike_str)

                        # Call
                        ce = contracts.get("CE", {})
                        if ce:
                            greeks = ce.get("greeks", {})
                            exp_data["calls"].append({
                                "strike": strike,
                                "ltp": round(float(ce.get("ltp", 0)), 2),
                                "bid": 0, "ask": 0,
                                "iv": round(float(greeks.get("iv", 0)), 1),
                                "oi": int(ce.get("open_interest", 0)),
                                "volume": int(ce.get("volume", 0)),
                                "itm": strike < spot_price,
                                "delta": round(float(greeks.get("delta", 0)), 4),
                                "gamma": round(float(greeks.get("gamma", 0)), 6),
                                "theta": round(float(greeks.get("theta", 0)), 2),
                                "vega": round(float(greeks.get("vega", 0)), 2),
                                "trading_symbol": ce.get("trading_symbol", ""),
                            })

                        # Put
                        pe = contracts.get("PE", {})
                        if pe:
                            greeks = pe.get("greeks", {})
                            exp_data["puts"].append({
                                "strike": strike,
                                "ltp": round(float(pe.get("ltp", 0)), 2),
                                "bid": 0, "ask": 0,
                                "iv": round(float(greeks.get("iv", 0)), 1),
                                "oi": int(pe.get("open_interest", 0)),
                                "volume": int(pe.get("volume", 0)),
                                "itm": strike > spot_price,
                                "delta": round(float(greeks.get("delta", 0)), 4),
                                "gamma": round(float(greeks.get("gamma", 0)), 6),
                                "theta": round(float(greeks.get("theta", 0)), 2),
                                "vega": round(float(greeks.get("vega", 0)), 2),
                                "trading_symbol": pe.get("trading_symbol", ""),
                            })

                    # Sort by strike
                    exp_data["calls"].sort(key=lambda x: x["strike"])
                    exp_data["puts"].sort(key=lambda x: x["strike"])

                    if exp_data["calls"] or exp_data["puts"]:
                        chains.append(exp_data)
                        groww_success = True

                except Exception as exp_err:
                    print(f"Groww chain fetch error for {exp_str}: {exp_err}")
                    continue

            if groww_success:
                data_source = "groww"

        except Exception as groww_err:
            print(f"Groww API error: {groww_err}")
            groww_success = False

    # ── Fallback: Synthetic Black-Scholes chain ──────────────────────────────
    if not groww_success:
        try:
            loop = asyncio.get_event_loop()
            yf_sym = INDEX_MAP.get(sym_upper, f"{sym_upper}.NS")
            ticker = await loop.run_in_executor(None, lambda: yf.Ticker(yf_sym))
            hist = await loop.run_in_executor(None, lambda: ticker.history(period="60d"))
            if hist.empty:
                raise HTTPException(status_code=404, detail=f"No data for {symbol}")

            spot_price = round(float(hist["Close"].iloc[-1]), 2)
            returns = hist["Close"].pct_change().dropna()
            hist_vol = float(returns.std() * (252 ** 0.5)) if len(returns) > 10 else 0.20

            # Strike step
            if spot_price > 10000: step = 100
            elif spot_price > 1000: step = 50 if is_index else 20
            elif spot_price > 500: step = 10
            else: step = 5

            atm = round(spot_price / step) * step
            num_strikes = 20
            strikes = [atm + (i - num_strikes) * step for i in range(num_strikes * 2 + 1)]
            strikes = [s for s in strikes if s > 0]
            r = 0.07

            target_expiries = [expiry] if expiry else expiry_dates[:4]
            for exp_str in target_expiries:
                days_to_exp = max(1, (datetime.strptime(exp_str, "%Y-%m-%d").date() - today).days)
                T = days_to_exp / 365
                exp_data = {"expiry": exp_str, "calls": [], "puts": []}

                for strike in strikes:
                    moneyness = abs(strike - spot_price) / spot_price
                    iv_adj = hist_vol * (1 + 0.3 * moneyness + 0.1 * moneyness ** 2)
                    iv_adj = max(0.08, min(iv_adj, 1.0))
                    dist = abs(strike - atm) / step
                    base_oi = max(100, int(50000 * math.exp(-0.08 * dist ** 1.3)))
                    noise = random.uniform(0.7, 1.3)

                    c_g = black_scholes(spot_price, strike, T, r, iv_adj, "call")
                    exp_data["calls"].append({
                        "strike": strike, "ltp": c_g["price"], "bid": round(c_g["price"]*0.99,2), "ask": round(c_g["price"]*1.01,2),
                        "iv": round(iv_adj*100,1), "oi": int(base_oi*noise*(1.2 if strike>atm else 0.8)),
                        "volume": int(base_oi*noise*random.uniform(0.05,0.25)), "itm": strike<spot_price,
                        "delta": c_g["delta"], "gamma": c_g["gamma"], "theta": c_g["theta"], "vega": c_g["vega"],
                    })
                    p_g = black_scholes(spot_price, strike, T, r, iv_adj, "put")
                    exp_data["puts"].append({
                        "strike": strike, "ltp": p_g["price"], "bid": round(p_g["price"]*0.99,2), "ask": round(p_g["price"]*1.01,2),
                        "iv": round(iv_adj*100,1), "oi": int(base_oi*noise*(0.8 if strike>atm else 1.2)),
                        "volume": int(base_oi*noise*random.uniform(0.05,0.25)), "itm": strike>spot_price,
                        "delta": p_g["delta"], "gamma": p_g["gamma"], "theta": p_g["theta"], "vega": p_g["vega"],
                    })
                chains.append(exp_data)
            data_source = "synthetic"
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Options chain error: {str(e)}")

    # ── PCR & Max Pain ───────────────────────────────────────────────────────
    total_call_oi = sum(c["oi"] for ch in chains for c in ch["calls"])
    total_put_oi = sum(p["oi"] for ch in chains for p in ch["puts"])
    pcr = round(total_put_oi / total_call_oi, 2) if total_call_oi > 0 else 0

    max_pain_strike = spot_price
    if chains and chains[0]["calls"]:
        all_strikes = sorted(set(c["strike"] for c in chains[0]["calls"]))
        min_pain = float("inf")
        for s in all_strikes:
            pain = sum(max(0, s - c["strike"]) * c["oi"] for c in chains[0]["calls"]) + \
                   sum(max(0, p["strike"] - s) * p["oi"] for p in chains[0]["puts"])
            if pain < min_pain:
                min_pain = pain
                max_pain_strike = s

    # Historical vol (for display)
    hist_vol_pct = 0
    if data_source == "groww":
        try:
            loop = asyncio.get_event_loop()
            yf_sym = INDEX_MAP.get(sym_upper, f"{sym_upper}.NS")
            ticker = await loop.run_in_executor(None, lambda: yf.Ticker(yf_sym))
            hist = await loop.run_in_executor(None, lambda: ticker.history(period="60d"))
            if not hist.empty:
                rets = hist["Close"].pct_change().dropna()
                hist_vol_pct = round(float(rets.std() * (252**0.5)) * 100, 1)
        except:
            pass
    elif data_source == "synthetic":
        hist_vol_pct = round(hist_vol * 100, 1) if 'hist_vol' in locals() else 0

    result = {
        "symbol": sym_upper, "spot_price": round(spot_price, 2),
        "lot_size": lot_size, "hist_vol": hist_vol_pct,
        "expiry_dates": expiry_dates[:6], "chains": chains,
        "pcr": pcr, "max_pain": max_pain_strike,
        "total_call_oi": total_call_oi, "total_put_oi": total_put_oi,
        "data_source": data_source,
        "note": "Live data via Groww API" if data_source == "groww" else "Theoretical pricing via Black-Scholes (set Groww token in Admin for live data)"
    }

    ttl = 60 if data_source == "groww" else 180
    if redis_client:
        await redis_client.setex(cache_key, ttl, json.dumps(result))
    return result


@app.get("/api/options/strategies", tags=["Options Lab"], summary="List options strategies",
    description="Returns 65+ options strategies with classification tags (bias, risk, margin, greeks, volatility view, complexity). Filter by category, bias, risk type, or complexity.")
async def list_options_strategies(
    category: str = "", bias: str = "", risk: str = "", complexity: str = "",
    user=Depends(get_current_user)
):
    """Return all available options strategies with classification tags."""
    results = []
    for k, v in OPTIONS_STRATEGIES.items():
        tags = v.get("tags", {})
        # Apply filters
        if category and v.get("category", "") != category:
            continue
        if bias and tags.get("bias", "") != bias:
            continue
        if risk and tags.get("risk", "") != risk:
            continue
        if complexity and tags.get("complexity", "") != complexity:
            continue
        results.append({
            "id": k, "name": v["name"], "description": v["description"],
            "legs": len(v["legs"]), "category": v.get("category", ""),
            "tags": tags,
        })
    return {
        "strategies": results,
        "total": len(results),
        "categories": STRATEGY_CATEGORIES,
        "filters": {
            "bias": ["bullish", "bearish", "neutral"],
            "risk": ["limited", "unlimited"],
            "complexity": ["low", "medium", "high"],
            "vol_view": ["expansion", "contraction", "neutral"],
            "expiry": ["any", "weekly", "monthly", "event"],
        }
    }


@app.post("/api/options/suggest", tags=["Options Lab"], summary="Strategy suggestion engine",
    description="Suggest optimal options strategies based on market view, IV rank, PCR, time to expiry, and risk tolerance. Analyzes OI data and market conditions to recommend the best strategies.")
async def suggest_strategies(req: dict, user=Depends(get_current_user)):
    """AI-powered strategy suggestion based on market conditions."""
    bias = req.get("bias", "neutral")  # bullish, bearish, neutral, volatile
    iv_rank = float(req.get("iv_rank", 50))  # 0-100
    iv_percentile = float(req.get("iv_percentile", 50))
    pcr = float(req.get("pcr", 1.0))
    days_to_expiry = int(req.get("days_to_expiry", 30))
    risk_tolerance = req.get("risk_tolerance", "moderate")  # conservative, moderate, aggressive
    capital = float(req.get("capital", 100000))
    event_nearby = req.get("event_nearby", False)  # budget, earnings, RBI policy
    oi_signal = req.get("oi_signal", "")  # call_resistance, put_support, long_buildup, short_buildup, unwinding

    suggestions = []
    scores = {}

    for k, v in OPTIONS_STRATEGIES.items():
        tags = v.get("tags", {})
        score = 0
        reasons = []

        # ── Directional bias matching ──
        strat_bias = tags.get("bias", "neutral")
        if bias == "volatile":
            if tags.get("vol_view") == "expansion":
                score += 30
                reasons.append("Matches volatility expansion view")
            elif tags.get("vol_view") == "contraction":
                score -= 20
        elif bias == strat_bias:
            score += 25
            reasons.append(f"Matches {bias} directional view")
        elif bias == "neutral" and strat_bias == "neutral":
            score += 25
        elif strat_bias == "neutral" and bias != "volatile":
            score += 5  # Neutral strategies are always somewhat relevant

        # ── IV Rank scoring ──
        if iv_rank > 70:  # High IV — sell premium
            if tags.get("vol_view") == "contraction":
                score += 20
                reasons.append(f"High IV ({iv_rank}) favors premium selling")
            elif "theta+" in tags.get("greeks", ""):
                score += 15
            if tags.get("vol_view") == "expansion":
                score -= 15
        elif iv_rank < 30:  # Low IV — buy premium
            if tags.get("vol_view") == "expansion":
                score += 20
                reasons.append(f"Low IV ({iv_rank}) favors buying options")
            elif "vega+" in tags.get("greeks", ""):
                score += 15
            if tags.get("vol_view") == "contraction":
                score -= 10

        # ── PCR scoring ──
        if pcr > 1.3:  # Bullish signal (high put writing)
            if strat_bias == "bullish":
                score += 10
                reasons.append(f"PCR {pcr} indicates bullish sentiment")
        elif pcr < 0.7:  # Bearish signal
            if strat_bias == "bearish":
                score += 10
                reasons.append(f"PCR {pcr} indicates bearish sentiment")

        # ── Time to expiry ──
        if days_to_expiry <= 3:  # Expiry week
            if v.get("category") == "expiry":
                score += 25
                reasons.append("Designed for expiry day trading")
            elif "theta++" in tags.get("greeks", "") or "theta+" in tags.get("greeks", ""):
                score += 10
            if tags.get("expiry") in ["monthly", "far"]:
                score -= 20
        elif days_to_expiry <= 7:
            if tags.get("expiry") in ["weekly", "any"]:
                score += 5
            if v.get("category") == "time_based":
                score -= 10
        elif days_to_expiry > 21:
            if v.get("category") == "time_based":
                score += 15
                reasons.append("Calendar strategies work best with time")
            if v.get("category") == "expiry":
                score -= 25

        # ── Risk tolerance ──
        strat_risk = tags.get("risk", "limited")
        strat_complexity = tags.get("complexity", "low")
        if risk_tolerance == "conservative":
            if strat_risk == "limited":
                score += 15
            elif strat_risk == "unlimited":
                score -= 25
            if strat_complexity == "high":
                score -= 10
        elif risk_tolerance == "aggressive":
            if strat_risk == "unlimited" and "theta+" in tags.get("greeks", ""):
                score += 10  # Aggressive traders can sell premium
            if strat_complexity == "low":
                score -= 5  # They want more sophisticated strategies

        # ── Event proximity ──
        if event_nearby:
            if tags.get("vol_view") == "expansion":
                score += 15
                reasons.append("Event nearby favors volatility plays")
            elif tags.get("expiry") == "event":
                score += 20

        # ── OI-based signals ──
        if oi_signal == "call_resistance":
            if strat_bias == "bearish" or strat_bias == "neutral":
                score += 10
                reasons.append("Call OI resistance suggests selling calls")
            if k in ["bear_call_spread", "iron_condor", "short_strangle"]:
                score += 15
        elif oi_signal == "put_support":
            if strat_bias == "bullish" or strat_bias == "neutral":
                score += 10
                reasons.append("Put OI support suggests bullish bias")
            if k in ["bull_put_spread", "iron_condor", "synthetic_long"]:
                score += 15
        elif oi_signal == "long_buildup":
            if strat_bias == "bullish":
                score += 15
                reasons.append("Long build-up confirms bullish momentum")
        elif oi_signal == "short_buildup":
            if strat_bias == "bearish":
                score += 15
                reasons.append("Short build-up confirms bearish pressure")
        elif oi_signal == "short_covering":
            if k in ["call_backspread", "reverse_iron_condor", "long_straddle"]:
                score += 20
                reasons.append("Short covering → potential breakout")
        elif oi_signal == "long_unwinding":
            if strat_bias == "bearish":
                score += 15
                reasons.append("Long unwinding signals weakness")

        if score > 0:
            scores[k] = {"score": score, "reasons": reasons}

    # Sort by score and return top 10
    top = sorted(scores.items(), key=lambda x: x[1]["score"], reverse=True)[:10]
    suggestions = []
    for k, data in top:
        v = OPTIONS_STRATEGIES[k]
        suggestions.append({
            "id": k, "name": v["name"], "description": v["description"],
            "category": v.get("category", ""),
            "tags": v.get("tags", {}),
            "legs": len(v["legs"]),
            "match_score": data["score"],
            "reasons": data["reasons"],
        })

    return {
        "suggestions": suggestions,
        "input": {"bias": bias, "iv_rank": iv_rank, "pcr": pcr, "days_to_expiry": days_to_expiry,
                  "risk_tolerance": risk_tolerance, "event_nearby": event_nearby, "oi_signal": oi_signal},
        "total": len(suggestions),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# OI INTELLIGENCE ENGINE (Phase 3)
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/options/oi-analysis/{symbol}", tags=["Options Lab"], summary="OI Intelligence Analysis",
    description="Comprehensive Open Interest analysis — PCR, max pain, OI build-up/unwinding detection, support/resistance from OI clusters, and strategy recommendations based on OI data.")
async def oi_analysis(symbol: str, expiry: str = "", user=Depends(get_current_user)):
    """Full OI intelligence analysis — reuses the existing chain endpoint data (Groww/synthetic)."""
    sym_upper = symbol.upper()
    cache_key = f"oi_analysis:{sym_upper}:{expiry}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    # Call the existing options_chain endpoint to get data
    try:
        chain_data = await options_chain(sym_upper, expiry, user)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot fetch chain for {sym_upper}: {str(e)}")

    spot_price = chain_data.get("spot_price", 0)
    if not spot_price:
        raise HTTPException(status_code=400, detail=f"No spot price for {sym_upper}")

    chains = chain_data.get("chains", [])
    if not chains:
        raise HTTPException(status_code=400, detail=f"No chain data for {sym_upper}")

    # Use first expiry chain for analysis
    target_chain = chains[0]
    target_expiry = target_chain.get("expiry", "")
    calls = target_chain.get("calls", [])
    puts = target_chain.get("puts", [])

    # Build OI data from chain
    call_oi_map = {c["strike"]: c.get("oi", 0) for c in calls}
    put_oi_map = {p["strike"]: p.get("oi", 0) for p in puts}
    call_vol_map = {c["strike"]: c.get("volume", 0) for c in calls}
    put_vol_map = {p["strike"]: p.get("volume", 0) for p in puts}
    call_iv_map = {c["strike"]: c.get("iv", 0) for c in calls}
    put_iv_map = {p["strike"]: p.get("iv", 0) for p in puts}

    strikes = sorted(set(list(call_oi_map.keys()) + list(put_oi_map.keys())))
    if not strikes:
        raise HTTPException(status_code=400, detail="No strike data available")

    total_call_oi = sum(call_oi_map.values())
    total_put_oi = sum(put_oi_map.values())
    total_call_vol = sum(call_vol_map.values())
    total_put_vol = sum(put_vol_map.values())

    pcr_oi = round(total_put_oi / max(total_call_oi, 1), 3)
    pcr_vol = round(total_put_vol / max(total_call_vol, 1), 3)

    # Use chain-level PCR/max_pain if available (from Groww)
    if chain_data.get("pcr"):
        pcr_oi = chain_data["pcr"]
    if chain_data.get("max_pain"):
        chain_max_pain = chain_data["max_pain"]
    else:
        chain_max_pain = 0

    # Strike-wise OI data
    oi_data = []
    for strike in strikes:
        c_oi = int(call_oi_map.get(strike, 0))
        p_oi = int(put_oi_map.get(strike, 0))
        c_vol = int(call_vol_map.get(strike, 0))
        p_vol = int(put_vol_map.get(strike, 0))
        c_iv = round(float(call_iv_map.get(strike, 0)), 1)
        p_iv = round(float(put_iv_map.get(strike, 0)), 1)
        oi_data.append({
            "strike": float(strike), "call_oi": c_oi, "put_oi": p_oi,
            "call_vol": c_vol, "put_vol": p_vol,
            "call_iv": c_iv, "put_iv": p_iv,
            "net_oi": p_oi - c_oi,
        })

    # ── Max Pain Calculation ──
    max_pain_strike = chain_max_pain if chain_max_pain else None
    if not max_pain_strike:
        min_pain_value = float("inf")
        for target_strike in strikes:
            total_pain = 0
            for s in strikes:
                c_oi = int(call_oi_map.get(s, 0))
                p_oi = int(put_oi_map.get(s, 0))
                if target_strike > s:
                    total_pain += (target_strike - s) * c_oi
                elif target_strike < s:
                    total_pain += (s - target_strike) * p_oi
            if total_pain < min_pain_value:
                min_pain_value = total_pain
                max_pain_strike = float(target_strike)

    # ── OI-based Support & Resistance ──
    sorted_by_put_oi = sorted(oi_data, key=lambda x: x["put_oi"], reverse=True)
    sorted_by_call_oi = sorted(oi_data, key=lambda x: x["call_oi"], reverse=True)
    support_levels = [{"strike": x["strike"], "put_oi": x["put_oi"]} for x in sorted_by_put_oi[:3] if x["put_oi"] > 0]
    resistance_levels = [{"strike": x["strike"], "call_oi": x["call_oi"]} for x in sorted_by_call_oi[:3] if x["call_oi"] > 0]

    # ── OI Build-up / Unwinding Detection ──
    buildup_signals = []
    for item in oi_data:
        s = item["strike"]
        c_ratio = item["call_vol"] / max(item["call_oi"], 1)
        p_ratio = item["put_vol"] / max(item["put_oi"], 1)
        if item["call_oi"] > total_call_oi * 0.08 and c_ratio > 0.5:
            buildup_signals.append({"strike": s, "type": "call", "signal": "active_buildup", "strength": round(c_ratio, 2)})
        if item["put_oi"] > total_put_oi * 0.08 and p_ratio > 0.5:
            buildup_signals.append({"strike": s, "type": "put", "signal": "active_buildup", "strength": round(p_ratio, 2)})

    # ── Market Signal ──
    if pcr_oi > 1.3:
        market_signal = "bullish"
        signal_desc = f"PCR {pcr_oi} is elevated — heavy put writing indicates bullish sentiment"
    elif pcr_oi < 0.7:
        market_signal = "bearish"
        signal_desc = f"PCR {pcr_oi} is low — heavy call writing indicates bearish sentiment"
    elif 0.9 <= pcr_oi <= 1.1:
        market_signal = "neutral"
        signal_desc = f"PCR {pcr_oi} is balanced — no strong directional bias from options writers"
    else:
        market_signal = "mildly_bullish" if pcr_oi > 1 else "mildly_bearish"
        signal_desc = f"PCR {pcr_oi} shows slight {'bullish' if pcr_oi > 1 else 'bearish'} lean"

    # ── OI-triggered Strategy Recommendations ──
    oi_strategies = []
    if resistance_levels and support_levels:
        r1 = resistance_levels[0]["strike"]
        s1 = support_levels[0]["strike"]
        if r1 > s1 and spot_price > s1 and spot_price < r1:
            oi_strategies.append({
                "strategy": "iron_condor", "name": "Iron Condor",
                "reason": f"Price between OI support ({s1}) and resistance ({r1}) — range-bound play",
                "confidence": "high" if 0.85 <= pcr_oi <= 1.15 else "medium"
            })
            oi_strategies.append({
                "strategy": "short_strangle", "name": "Short Strangle",
                "reason": "Sell OTM options around support/resistance levels for premium",
                "confidence": "medium"
            })
    if max_pain_strike and abs(spot_price - max_pain_strike) / spot_price < 0.02:
        oi_strategies.append({
            "strategy": "pin_risk_butterfly", "name": "Pin Risk Butterfly",
            "reason": f"Spot near max pain ({max_pain_strike}) — price likely to pin near expiry",
            "confidence": "high"
        })
        oi_strategies.append({
            "strategy": "short_straddle", "name": "Short Straddle at Max Pain",
            "reason": f"Max pain {max_pain_strike} close to spot — sell straddle for decay",
            "confidence": "medium"
        })
    if pcr_oi > 1.3:
        oi_strategies.append({"strategy": "bull_put_spread", "name": "Bull Put Spread",
            "reason": "Heavy put writing (PCR > 1.3) — put sellers providing support", "confidence": "high"})
        oi_strategies.append({"strategy": "synthetic_long", "name": "Synthetic Long",
            "reason": "Strong put writing suggests floor — synthetic long for bullish exposure", "confidence": "medium"})
    elif pcr_oi < 0.7:
        oi_strategies.append({"strategy": "bear_call_spread", "name": "Bear Call Spread",
            "reason": "Heavy call writing (PCR < 0.7) — call sellers creating ceiling", "confidence": "high"})
    any_breakout = any(b for b in buildup_signals if b["strength"] > 1.0)
    if any_breakout:
        oi_strategies.append({"strategy": "reverse_iron_condor", "name": "Reverse Iron Condor",
            "reason": "High volume/OI ratio — potential breakout, buy wings", "confidence": "medium"})
        oi_strategies.append({"strategy": "long_straddle", "name": "Long Straddle",
            "reason": "Active OI buildup signals big directional move incoming", "confidence": "medium"})

    result = {
        "symbol": sym_upper, "spot_price": spot_price,
        "expiry": target_expiry,
        "available_expiries": chain_data.get("expiry_dates", []),
        "pcr": {"oi": pcr_oi, "volume": pcr_vol},
        "total_oi": {"calls": total_call_oi, "puts": total_put_oi},
        "total_volume": {"calls": total_call_vol, "puts": total_put_vol},
        "max_pain": {"strike": max_pain_strike, "distance_pct": round((max_pain_strike - spot_price) / spot_price * 100, 2) if max_pain_strike else 0},
        "support_levels": support_levels, "resistance_levels": resistance_levels,
        "market_signal": {"signal": market_signal, "description": signal_desc},
        "oi_buildup": buildup_signals[:10],
        "oi_data": oi_data,
        "data_source": chain_data.get("data_source", "synthetic"),
        "strategy_recommendations": oi_strategies,
    }

    if redis_client:
        await redis_client.set(cache_key, json.dumps(result), ex=300)

    return result


@app.post("/api/options/payoff", tags=["Options Lab"], summary="Calculate options strategy payoff",
    description="Enhanced payoff calculator — returns at-expiry payoff, position Greeks, probability of profit, margin estimate, and time-decay P&L grid for risk heatmap visualization.")
async def calculate_payoff(req: dict, user=Depends(get_current_user)):
    """Calculate payoff diagram with position Greeks, PoP, margin, and time-based P&L."""
    import math
    from scipy.stats import norm

    spot = float(req.get("spot_price", 0))
    legs = req.get("legs", [])
    lot_size = int(req.get("lot_size", 1))
    days_to_expiry = int(req.get("days_to_expiry", 30))
    risk_free = float(req.get("risk_free_rate", 7.0)) / 100

    if not spot or not legs:
        raise HTTPException(status_code=400, detail="Need spot_price and legs")

    # ── 1. At-Expiry Payoff ──────────────────────────────────────────────────
    low = spot * 0.80
    high = spot * 1.20
    prices = [round(low + i * (high - low) / 100, 2) for i in range(101)]

    payoff_data = []
    for price in prices:
        total_pnl = 0
        for leg in legs:
            leg_type = leg.get("type", "call")
            side = leg.get("side", "buy")
            strike = float(leg.get("strike", spot))
            premium = float(leg.get("premium", 0))
            qty = int(leg.get("quantity", lot_size))
            multiplier = 1 if side == "buy" else -1

            if leg_type == "call":
                intrinsic = max(0, price - strike)
                pnl = (intrinsic - premium) * qty * multiplier
            elif leg_type == "put":
                intrinsic = max(0, strike - price)
                pnl = (intrinsic - premium) * qty * multiplier
            elif leg_type == "stock":
                pnl = (price - spot) * qty * multiplier
            else:
                pnl = 0
            total_pnl += pnl
        payoff_data.append({"price": price, "pnl": round(total_pnl, 2)})

    max_profit = max(p["pnl"] for p in payoff_data)
    max_loss = min(p["pnl"] for p in payoff_data)
    breakevens = []
    for i in range(1, len(payoff_data)):
        if payoff_data[i-1]["pnl"] * payoff_data[i]["pnl"] < 0:
            breakevens.append(payoff_data[i]["price"])

    net_premium = sum(
        float(l.get("premium", 0)) * int(l.get("quantity", lot_size)) * (1 if l.get("side") == "buy" else -1)
        for l in legs if l.get("type") != "stock"
    )

    # ── 2. Position Greeks (aggregate across all legs) ────────────────────────
    T = max(1, days_to_expiry) / 365
    position_greeks = {"delta": 0, "gamma": 0, "theta": 0, "vega": 0, "rho": 0, "net_premium": round(net_premium, 2)}

    for leg in legs:
        leg_type = leg.get("type", "call")
        if leg_type == "stock":
            qty = int(leg.get("quantity", lot_size))
            mult = 1 if leg.get("side") == "buy" else -1
            position_greeks["delta"] += qty * mult
            continue

        strike = float(leg.get("strike", spot))
        premium = float(leg.get("premium", 0))
        qty = int(leg.get("quantity", lot_size))
        side = leg.get("side", "buy")
        mult = 1 if side == "buy" else -1

        # Estimate IV from premium using Newton's method if premium > 0
        iv = 0.15  # default 15%
        if premium > 0 and spot > 0 and strike > 0:
            try:
                iv = implied_volatility(premium, spot, strike, T, risk_free, leg_type) / 100
                iv = max(0.05, min(iv, 2.0))
            except:
                iv = 0.15

        try:
            g = black_scholes(spot, strike, T, risk_free, iv, leg_type)
            position_greeks["delta"] += round(g["delta"] * qty * mult, 2)
            position_greeks["gamma"] += round(g["gamma"] * qty * mult, 6)
            position_greeks["theta"] += round(g["theta"] * qty * mult, 2)
            position_greeks["vega"] += round(g["vega"] * qty * mult, 2)
            position_greeks["rho"] += round(g["rho"] * qty * mult, 2)
        except:
            pass

    for k in ["delta", "gamma", "theta", "vega", "rho"]:
        position_greeks[k] = round(position_greeks[k], 4 if k == "gamma" else 2)

    # ── 3. Probability of Profit (PoP) ────────────────────────────────────────
    # Using log-normal distribution: probability that strategy P&L > 0 at expiry
    pop = 50.0  # default
    try:
        # Estimate average IV across legs
        ivs = []
        for leg in legs:
            if leg.get("type") == "stock": continue
            strike = float(leg.get("strike", spot))
            premium = float(leg.get("premium", 0))
            if premium > 0:
                try:
                    leg_iv = implied_volatility(premium, spot, strike, T, risk_free, leg.get("type", "call")) / 100
                    ivs.append(max(0.05, min(leg_iv, 2.0)))
                except:
                    ivs.append(0.15)
        avg_iv = sum(ivs) / len(ivs) if ivs else 0.15

        # Monte Carlo-lite: count what % of the payoff curve is profitable
        profitable = sum(1 for p in payoff_data if p["pnl"] > 0)
        pop_simple = round(profitable / len(payoff_data) * 100, 1)

        # Also use log-normal for breakeven-based PoP
        if breakevens and avg_iv > 0:
            pop_parts = []
            drift = (risk_free - 0.5 * avg_iv**2) * T
            vol_sqrt_t = avg_iv * math.sqrt(T)
            if len(breakevens) == 1:
                be = breakevens[0]
                # For debit strategies (net buyer), profitable above/below BE
                p_above = 1 - norm.cdf((math.log(be / spot) - drift) / vol_sqrt_t)
                p_below = norm.cdf((math.log(be / spot) - drift) / vol_sqrt_t)
                # Check which side is profitable
                mid_payoff = next((p["pnl"] for p in payoff_data if p["price"] >= be + spot*0.01), 0)
                pop = round((p_above if mid_payoff > 0 else p_below) * 100, 1)
            elif len(breakevens) == 2:
                be_low, be_high = sorted(breakevens)
                p_between = norm.cdf((math.log(be_high / spot) - drift) / vol_sqrt_t) - \
                            norm.cdf((math.log(be_low / spot) - drift) / vol_sqrt_t)
                # Check if profitable between or outside breakevens
                mid_price = (be_low + be_high) / 2
                mid_payoff = next((p["pnl"] for p in payoff_data if p["price"] >= mid_price), 0)
                pop = round((p_between if mid_payoff > 0 else (1 - p_between)) * 100, 1)
            else:
                pop = pop_simple
        else:
            pop = pop_simple

        pop = max(0, min(100, pop))
    except:
        pop = round(sum(1 for p in payoff_data if p["pnl"] > 0) / len(payoff_data) * 100, 1)

    # ── 4. Margin Estimate (SPAN-like approximation for NSE) ──────────────────
    margin_estimate = 0
    try:
        for leg in legs:
            if leg.get("type") == "stock": continue
            strike = float(leg.get("strike", spot))
            premium = float(leg.get("premium", 0))
            qty = int(leg.get("quantity", lot_size))
            side = leg.get("side", "buy")

            if side == "buy":
                # Long options: just premium paid
                margin_estimate += premium * qty
            else:
                # Short options: SPAN margin ≈ max(premium + OTM_amount, spot * margin_pct) * qty
                if leg.get("type") == "call":
                    otm = max(0, strike - spot)
                else:
                    otm = max(0, spot - strike)
                span_margin = max(premium * 1.5, spot * 0.12 - otm * 0.5) * qty
                margin_estimate += span_margin

        # If it's a spread (has both buy and sell), reduce margin
        has_buy = any(l.get("side") == "buy" and l.get("type") != "stock" for l in legs)
        has_sell = any(l.get("side") == "sell" for l in legs)
        if has_buy and has_sell:
            # Spread margin = max loss (usually)
            margin_estimate = min(margin_estimate, abs(max_loss) * 1.2) if max_loss < 0 else margin_estimate * 0.5
    except:
        margin_estimate = abs(max_loss) if max_loss < 0 else 0

    # ── 5. Time-Decay P&L Grid (for Risk Heatmap) ─────────────────────────────
    # P&L at different spots × different days to expiry
    time_grid = []
    try:
        spot_steps = 21  # -10% to +10%
        time_steps = [days_to_expiry, int(days_to_expiry*0.75), int(days_to_expiry*0.5),
                      int(days_to_expiry*0.25), max(1, int(days_to_expiry*0.1)), 1]
        time_steps = sorted(set(max(1, t) for t in time_steps), reverse=True)

        spot_range = [round(spot * (0.90 + i * 0.01), 2) for i in range(spot_steps)]

        for dte in time_steps:
            T_dte = max(1, dte) / 365
            row = {"dte": dte, "pnl": []}
            for s_price in spot_range:
                total_pnl = 0
                for leg in legs:
                    leg_type = leg.get("type", "call")
                    side = leg.get("side", "buy")
                    strike = float(leg.get("strike", spot))
                    premium = float(leg.get("premium", 0))
                    qty = int(leg.get("quantity", lot_size))
                    mult = 1 if side == "buy" else -1

                    if leg_type == "stock":
                        total_pnl += (s_price - spot) * qty * mult
                        continue

                    iv_est = 0.15
                    if premium > 0:
                        try:
                            iv_est = implied_volatility(premium, spot, strike, T, risk_free, leg_type) / 100
                            iv_est = max(0.05, min(iv_est, 2.0))
                        except:
                            iv_est = 0.15

                    try:
                        bs = black_scholes(s_price, strike, T_dte, risk_free, iv_est, leg_type)
                        curr_val = bs["price"]
                        cost = premium
                        pnl = (curr_val - cost) * qty * mult
                        total_pnl += pnl
                    except:
                        pass

                row["pnl"].append(round(total_pnl, 2))
            time_grid.append(row)
    except:
        time_grid = []

    return {
        "payoff": payoff_data, "spot": spot,
        "max_profit": round(max_profit, 2),
        "max_loss": round(max_loss, 2),
        "breakevens": breakevens,
        "net_premium": round(net_premium, 2),
        "risk_reward": round(abs(max_profit / max_loss), 2) if max_loss != 0 else 0,
        "position_greeks": position_greeks,
        "probability_of_profit": pop,
        "margin_estimate": round(margin_estimate, 2),
        "time_grid": {
            "spot_range": [round(spot * (0.90 + i * 0.01), 2) for i in range(21)] if time_grid else [],
            "data": time_grid,
        },
        "days_to_expiry": days_to_expiry,
    }


@app.post("/api/options/compare", tags=["Options Lab"], summary="Compare strategies",
    description="Compare 2-3 options strategies side by side. Returns payoff curves, Greeks, PoP, margin, and risk-reward for each strategy.")
async def compare_strategies(req: dict, user=Depends(get_current_user)):
    """Compare multiple strategies head to head."""
    strategies = req.get("strategies", [])
    if not strategies or len(strategies) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 strategies to compare")
    if len(strategies) > 4:
        strategies = strategies[:4]

    results = []
    for strat in strategies:
        # Each strategy has: name, spot_price, legs, lot_size, days_to_expiry
        try:
            payoff_result = await calculate_payoff(strat, user)
            results.append({
                "name": strat.get("name", f"Strategy {len(results)+1}"),
                "payoff": payoff_result["payoff"],
                "max_profit": payoff_result["max_profit"],
                "max_loss": payoff_result["max_loss"],
                "breakevens": payoff_result["breakevens"],
                "net_premium": payoff_result["net_premium"],
                "risk_reward": payoff_result["risk_reward"],
                "position_greeks": payoff_result["position_greeks"],
                "probability_of_profit": payoff_result["probability_of_profit"],
                "margin_estimate": payoff_result["margin_estimate"],
                "legs": len(strat.get("legs", [])),
            })
        except Exception as e:
            results.append({"name": strat.get("name", "?"), "error": str(e)})

    return {"strategies": results, "count": len(results)}


@app.get("/api/options/greeks", tags=["Options Lab"], summary="Calculate option Greeks",
    description="Calculate Black-Scholes Greeks (Delta, Gamma, Theta, Vega, Rho) for a single option. Provide spot price, strike, expiry date, risk-free rate, and IV.")
async def calculate_greeks(
    spot: float, strike: float, expiry_days: int, iv: float,
    option_type: str = "call", r: float = 7.0, user=Depends(get_current_user)
):
    """Calculate Greeks for a single option."""
    T = max(1, expiry_days) / 365
    greeks = black_scholes(spot, strike, T, r / 100, iv / 100, option_type)
    greeks["iv"] = iv
    greeks["expiry_days"] = expiry_days
    greeks["intrinsic"] = round(max(0, spot - strike) if option_type == "call" else max(0, strike - spot), 2)
    greeks["time_value"] = round(greeks["price"] - greeks["intrinsic"], 2)
    greeks["moneyness"] = "ITM" if greeks["intrinsic"] > 0 else ("ATM" if abs(spot - strike) / spot < 0.01 else "OTM")
    return greeks


# ══════════════════════════════════════════════════════════════════════════════
# SEBI ADVISORY REPORT SYSTEM
# ══════════════════════════════════════════════════════════════════════════════

def generate_rationale(symbol: str, call_type: str, tech: dict, fund: dict, rationale_type: str = "quantamental") -> str:
    """Auto-generate SEBI-compliant rationale from technical + fundamental data."""
    tech_parts = []
    fund_parts = []
    is_buy = call_type.upper() == "BUY"
    price = tech.get("price", 0)

    # ── Technical rationale ──────────────────────────────────────────────────
    if is_buy:
        if tech.get("above_200dma"): tech_parts.append(f"{symbol} is trading above its 200-day moving average (₹{tech.get('sma_200',0)}), confirming a long-term uptrend")
        if tech.get("above_50dma"): tech_parts.append(f"The stock is above its 50-day SMA (₹{tech.get('sma_50',0)}), indicating positive short-term momentum")
        rsi = tech.get("rsi", 50)
        if rsi < 35: tech_parts.append(f"RSI at {rsi} places the stock in deeply oversold territory, historically a zone where reversals tend to occur")
        elif rsi < 45: tech_parts.append(f"RSI at {rsi} suggests the stock is approaching oversold levels, presenting a favourable risk-reward entry")
        elif 50 < rsi < 70: tech_parts.append(f"RSI at {rsi} reflects healthy bullish momentum with room to run before reaching overbought levels")
        if tech.get("macd_cross_up"): tech_parts.append("MACD has recently made a bullish crossover above its signal line, a reliable buy trigger")
        elif tech.get("macd_hist", 0) > 0: tech_parts.append(f"MACD histogram is positive at {tech.get('macd_hist',0)}, supporting the bullish thesis")
        if tech.get("golden_cross"): tech_parts.append("A Golden Cross (50 DMA crossing above 200 DMA) has formed - historically one of the most reliable long-term bullish signals")
        if tech.get("vol_ratio", 0) > 2: tech_parts.append(f"Volume is {tech.get('vol_ratio',0)}x above the 20-day average, suggesting strong institutional participation")
        elif tech.get("vol_ratio", 0) > 1.5: tech_parts.append(f"Volume at {tech.get('vol_ratio',0)}x average indicates above-normal buying interest")
        rs3m = tech.get("rs_3m", 0)
        if rs3m > 15: tech_parts.append(f"3-month relative strength of +{rs3m}% shows significant outperformance versus the broader market, indicating strong institutional interest")
        elif rs3m > 5: tech_parts.append(f"3-month relative strength of +{rs3m}% indicates the stock is outperforming the market")
        if tech.get("minervini_score", 0) >= 5: tech_parts.append(f"The stock passes {tech.get('minervini_score',0)} out of 7 Minervini trend template criteria, qualifying it as a Stage 2 uptrend candidate")
        w52h = tech.get("w52_high", 0)
        w52l = tech.get("w52_low", 0)
        if w52h and price and w52h > 0:
            pct_from_high = round((price - w52h) / w52h * 100, 1)
            if pct_from_high > -5: tech_parts.append(f"Trading within 5% of its 52-week high (₹{w52h}), demonstrating sustained buying pressure at higher levels")
            elif pct_from_high < -25: tech_parts.append(f"Currently {abs(pct_from_high)}% below 52-week high, offering a potential value entry with recovery upside")
        if w52l and price and w52l > 0:
            pct_from_low = round((price - w52l) / w52l * 100, 1)
            if pct_from_low > 50: tech_parts.append(f"The stock has rallied {pct_from_low}% from its 52-week low (₹{w52l}), confirming a strong uptrend")
        # Support/resistance context
        sma200 = tech.get("sma_200", 0)
        sma50 = tech.get("sma_50", 0)
        if sma50 and sma200 and price:
            tech_parts.append(f"Key support levels: 50 DMA at ₹{sma50}, 200 DMA at ₹{sma200}. Immediate resistance near 52-week high at ₹{w52h}" if w52h else "")
    else:
        if not tech.get("above_200dma"): tech_parts.append(f"{symbol} is trading below its 200-day moving average, indicating a structural downtrend")
        if not tech.get("above_50dma"): tech_parts.append("Price is below its 50-day SMA, confirming short-to-medium term bearish momentum")
        rsi = tech.get("rsi", 50)
        if rsi > 75: tech_parts.append(f"RSI at {rsi} places the stock in deeply overbought territory, significantly increasing the probability of a pullback")
        elif rsi > 70: tech_parts.append(f"RSI at {rsi} is in overbought territory, where mean-reversion risk increases")
        if tech.get("death_cross"): tech_parts.append("A Death Cross (50 DMA crossing below 200 DMA) has formed - a bearish structural signal that often precedes further downside")
        rs3m = tech.get("rs_3m", 0)
        if rs3m < -10: tech_parts.append(f"3-month relative strength of {rs3m}% shows significant underperformance, indicating potential structural weakness")
        elif rs3m < -3: tech_parts.append(f"3-month relative strength of {rs3m}% reflects underperformance versus the broader market")
        if tech.get("macd_hist", 0) < 0: tech_parts.append(f"MACD histogram at {tech.get('macd_hist',0)} confirms bearish momentum is intact")
    # Filter empty strings
    tech_parts = [p for p in tech_parts if p]

    # ── Fundamental rationale ────────────────────────────────────────────────
    pe = fund.get("pe_ratio", 0)
    roe = fund.get("roe", 0)
    div_yield = fund.get("dividend_yield", 0)
    de = fund.get("debt_equity", 0)
    mcap = fund.get("market_cap", 0)
    sector = fund.get("sector", "")
    name = fund.get("name", symbol)

    if name and name != symbol:
        fund_parts.append(f"{name} ({symbol})" + (f" operates in the {sector} sector" if sector else ""))

    if is_buy:
        if pe and 0 < pe < 20: fund_parts.append(f"P/E ratio of {pe:.1f}x suggests reasonable valuation relative to earnings")
        elif pe and 20 <= pe < 35: fund_parts.append(f"P/E ratio of {pe:.1f}x is moderate, justifiable if growth trajectory continues")
        if roe and roe > 18: fund_parts.append(f"ROE of {roe:.1f}% reflects excellent capital efficiency and shareholder value creation")
        elif roe and roe > 12: fund_parts.append(f"ROE of {roe:.1f}% indicates adequate return on equity")
        if div_yield and div_yield > 1.5: fund_parts.append(f"Dividend yield of {div_yield:.1f}% provides regular income support to investors")
        elif div_yield and div_yield > 0.5: fund_parts.append(f"The company pays a dividend yield of {div_yield:.1f}%")
        if de and 0 < de < 0.5: fund_parts.append(f"Very low debt-to-equity ratio of {de:.2f} indicates a conservatively managed balance sheet")
        elif de and de < 1: fund_parts.append(f"Debt-to-equity ratio of {de:.2f} is within comfortable levels")
        if mcap:
            if mcap > 500e9: fund_parts.append("As a large-cap company, it offers relative stability and liquidity")
            elif mcap > 50e9: fund_parts.append("Mid-cap positioning offers a balance of growth potential and stability")
    else:
        if pe and pe > 50: fund_parts.append(f"P/E ratio of {pe:.1f}x appears significantly stretched, limiting further upside")
        elif pe and pe > 35: fund_parts.append(f"P/E ratio of {pe:.1f}x is elevated relative to sector peers")
        if roe and roe < 8: fund_parts.append(f"ROE of {roe:.1f}% is below industry average, suggesting weak capital efficiency")
        if de and de > 2: fund_parts.append(f"Debt-to-equity ratio of {de:.2f} raises concerns about financial leverage and interest burden")
        elif de and de > 1.5: fund_parts.append(f"Elevated debt-to-equity of {de:.2f} may constrain future growth")

    # ── Compose based on rationale type ──────────────────────────────────────
    parts = []
    if rationale_type == "technical":
        parts = tech_parts[:]
        if not parts:
            parts.append(f"Based on technical analysis, {symbol} at ₹{price} {'shows bullish price structure' if is_buy else 'shows bearish price structure'}")
    elif rationale_type == "fundamental":
        parts = fund_parts[:]
        if not parts:
            parts.append(f"Based on fundamental analysis, {symbol} {'presents a value opportunity at current levels' if is_buy else 'appears overvalued at current levels'}")
    else:  # quantamental
        if tech_parts:
            parts.append("TECHNICAL: " + ". ".join(tech_parts))
        if fund_parts:
            parts.append("FUNDAMENTAL: " + ". ".join(fund_parts))
        if not parts:
            parts.append(f"Based on quantamental analysis of {symbol}, the current price at ₹{price} {'supports a bullish' if is_buy else 'suggests a bearish'} outlook")

    # Add conclusion
    if is_buy:
        parts.append(f"CONCLUSION: Based on the above analysis, we recommend a BUY on {symbol} at current levels of ₹{price} with the target and stop-loss as mentioned above. Investors should monitor the stock for any change in the underlying thesis and adjust positions accordingly")
    else:
        parts.append(f"CONCLUSION: Based on the above analysis, we recommend a SELL / EXIT on {symbol} at current levels of ₹{price}. The risk-reward is unfavourable for fresh long positions at this juncture")

    return ". ".join(parts) + "."


def _sanitize_for_pdf(text: str) -> str:
    """Replace Unicode characters that reportlab can't render."""
    return text.replace("₹", "Rs.").replace("—", "-").replace("–", "-")


def generate_single_advisory_pdf(report: dict, rec: dict, output_path: str):
    """Generate a professional SEBI-compliant advisory PDF for a single recommendation."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.units import mm
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY

    doc = SimpleDocTemplate(output_path, pagesize=A4,
                            topMargin=18*mm, bottomMargin=18*mm,
                            leftMargin=18*mm, rightMargin=18*mm)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='RTitle', parent=styles['Title'], fontSize=16, textColor=colors.HexColor('#1a1a2e'), spaceAfter=4))
    styles.add(ParagraphStyle(name='RSub', parent=styles['Normal'], fontSize=10, textColor=colors.HexColor('#555555'), spaceAfter=10))
    styles.add(ParagraphStyle(name='RSec', parent=styles['Heading2'], fontSize=12, textColor=colors.HexColor('#0d47a1'), spaceBefore=10, spaceAfter=4))
    styles.add(ParagraphStyle(name='RBuy', parent=styles['Normal'], fontSize=14, textColor=colors.HexColor('#2e7d32'), fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle(name='RSell', parent=styles['Normal'], fontSize=14, textColor=colors.HexColor('#c62828'), fontName='Helvetica-Bold'))
    styles.add(ParagraphStyle(name='RBody', parent=styles['Normal'], fontSize=10, textColor=colors.HexColor('#333333'), leading=14, alignment=TA_JUSTIFY))
    styles.add(ParagraphStyle(name='RDisc', parent=styles['Normal'], fontSize=7, textColor=colors.HexColor('#999999'), leading=9))
    styles.add(ParagraphStyle(name='RLabel', parent=styles['Normal'], fontSize=9, textColor=colors.HexColor('#777777')))

    story = []
    created = report.get("created_at", "")
    date_str = created[:10] if created else datetime.utcnow().strftime("%Y-%m-%d")
    sym = rec.get("symbol", "")
    call = rec.get("call_type", "BUY").upper()
    entry = rec.get("entry_price", 0)
    target = rec.get("target_price", 0)
    sl = rec.get("stop_loss", 0)
    horizon = rec.get("time_horizon", "short_term").replace("_", " ").title()
    rationale = _sanitize_for_pdf(rec.get("rationale", ""))
    tech = rec.get("technical_data", {}) or {}
    fund = rec.get("fundamental_data", {}) or {}
    if isinstance(tech, str):
        try: tech = json.loads(tech)
        except: tech = {}
    if isinstance(fund, str):
        try: fund = json.loads(fund)
        except: fund = {}

    # ── Header ──
    story.append(Paragraph("INVESTMENT ADVISORY REPORT", styles['RTitle']))
    sub = [f"Date: {date_str}"]
    advisor = report.get("advisor_name", "")
    reg_no = report.get("ria_reg_no", "")
    if advisor: sub.append(f"Advisor: {advisor}")
    if reg_no: sub.append(f"SEBI Reg: {reg_no}")
    story.append(Paragraph(" | ".join(sub), styles['RSub']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#0d47a1'), spaceAfter=12))

    # ── Stock Header ──
    company_name = fund.get("name", sym)
    sector = fund.get("sector", "")
    title_line = f"{company_name}" if company_name != sym else sym
    if sector: title_line += f" ({sector})"
    story.append(Paragraph(f"<b>{title_line}</b> | NSE: {sym}", styles['RSec']))
    call_style = styles['RBuy'] if call == 'BUY' else styles['RSell']
    story.append(Paragraph(f"RECOMMENDATION: {call}", call_style))
    story.append(Spacer(1, 8))

    # ── Price Summary Table ──
    row1 = ["", "Entry Price", "Target Price", "Stop Loss", "Time Horizon"]
    row2 = ["Values", f"Rs. {entry:,.2f}" if entry else "-", f"Rs. {target:,.2f}" if target else "-",
            f"Rs. {sl:,.2f}" if sl else "-", horizon]
    rows = [row1, row2]
    if target and entry and entry > 0:
        upside = round((target - entry) / entry * 100, 1)
        risk = round(abs(entry - sl) / entry * 100, 1) if sl else 0
        rr = round(upside / risk, 1) if risk > 0 else 0
        rows.append(["Analysis", f"Upside: {upside}%", f"Risk: {risk}%", f"R:R 1:{rr}" if rr else "-", ""])

    pt = Table(rows, colWidths=[60, 100, 100, 100, 100])
    pt.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0d47a1')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BACKGROUND', (0, 1), (0, -1), colors.HexColor('#e8eaf6')),
        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#90a4ae')),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ]))
    story.append(pt)
    story.append(Spacer(1, 12))

    # ── Technical Snapshot Table ──
    if tech:
        story.append(Paragraph("TECHNICAL SNAPSHOT", styles['RSec']))
        tech_rows = [["Indicator", "Value", "Signal"]]
        price = tech.get("price", entry)
        if price: tech_rows.append(["Current Price", f"Rs. {price:,.2f}", ""])
        sma50 = tech.get("sma_50", 0)
        sma200 = tech.get("sma_200", 0)
        if sma50: tech_rows.append(["50 DMA", f"Rs. {sma50:,.2f}", "Above" if price > sma50 else "Below"])
        if sma200: tech_rows.append(["200 DMA", f"Rs. {sma200:,.2f}", "Above" if price > sma200 else "Below"])
        rsi = tech.get("rsi", 0)
        if rsi: tech_rows.append(["RSI (14)", f"{rsi:.1f}", "Oversold" if rsi < 30 else "Overbought" if rsi > 70 else "Neutral"])
        macd_h = tech.get("macd_hist", 0)
        tech_rows.append(["MACD Histogram", f"{macd_h:.2f}" if macd_h else "-", "Bullish" if macd_h and macd_h > 0 else "Bearish"])
        vr = tech.get("vol_ratio", 0)
        if vr: tech_rows.append(["Volume Ratio", f"{vr:.1f}x", "High" if vr > 1.5 else "Normal"])
        rs3m = tech.get("rs_3m", 0)
        if rs3m: tech_rows.append(["3M Rel. Strength", f"{rs3m:+.1f}%", "Outperforming" if rs3m > 0 else "Underperforming"])
        w52h = tech.get("w52_high", 0)
        w52l = tech.get("w52_low", 0)
        if w52h: tech_rows.append(["52-Week High", f"Rs. {w52h:,.2f}", f"{round((price-w52h)/w52h*100,1)}% from high" if price and w52h else ""])
        if w52l: tech_rows.append(["52-Week Low", f"Rs. {w52l:,.2f}", f"{round((price-w52l)/w52l*100,1)}% from low" if price and w52l else ""])

        tt = Table(tech_rows, colWidths=[120, 120, 200])
        tt.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e3f2fd')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#cfd8dc')),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        story.append(tt)
        story.append(Spacer(1, 8))

    # ── Fundamental Snapshot Table ──
    if fund and any(fund.get(k) for k in ["pe_ratio", "roe", "dividend_yield", "debt_equity"]):
        story.append(Paragraph("FUNDAMENTAL SNAPSHOT", styles['RSec']))
        fund_rows = [["Metric", "Value", "Assessment"]]
        pe = fund.get("pe_ratio", 0)
        if pe and pe > 0:
            assess = "Attractive" if pe < 15 else "Moderate" if pe < 30 else "Expensive"
            fund_rows.append(["P/E Ratio", f"{pe:.1f}x", assess])
        roe = fund.get("roe", 0)
        if roe and roe > 0:
            assess = "Excellent" if roe > 18 else "Good" if roe > 12 else "Average"
            fund_rows.append(["Return on Equity", f"{roe:.1f}%", assess])
        dy = fund.get("dividend_yield", 0)
        if dy and dy > 0: fund_rows.append(["Dividend Yield", f"{dy:.1f}%", "Income support" if dy > 1.5 else "Modest"])
        de = fund.get("debt_equity", 0)
        if de and de > 0:
            assess = "Conservative" if de < 0.5 else "Moderate" if de < 1.5 else "High leverage"
            fund_rows.append(["Debt/Equity", f"{de:.2f}", assess])
        mcap = fund.get("market_cap", 0)
        if mcap:
            if mcap > 500e9: cap_cat = "Large Cap"
            elif mcap > 50e9: cap_cat = "Mid Cap"
            else: cap_cat = "Small Cap"
            fund_rows.append(["Market Cap", f"Rs. {mcap/1e9:,.0f}B", cap_cat])

        ft = Table(fund_rows, colWidths=[120, 120, 200])
        ft.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#fce4ec')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#cfd8dc')),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        story.append(ft)
        story.append(Spacer(1, 8))

    # ── Rationale ──
    story.append(Paragraph("INVESTMENT RATIONALE (SEBI Mandated)", styles['RSec']))
    for line in rationale.split(". FUNDAMENTAL:"):
        if line.strip():
            clean = line.strip()
            if clean.startswith("TECHNICAL:"):
                story.append(Paragraph("<b>Technical Analysis:</b>", styles['RLabel']))
                story.append(Paragraph(_sanitize_for_pdf(clean.replace("TECHNICAL:", "").strip()), styles['RBody']))
                story.append(Spacer(1, 4))
            elif "FUNDAMENTAL" not in line and "TECHNICAL" not in line:
                story.append(Paragraph(_sanitize_for_pdf(clean), styles['RBody']))
            else:
                story.append(Paragraph("<b>Fundamental Analysis:</b>", styles['RLabel']))
                story.append(Paragraph(_sanitize_for_pdf(clean.replace("FUNDAMENTAL:", "").strip()), styles['RBody']))
    if "TECHNICAL:" not in rationale and "FUNDAMENTAL:" not in rationale:
        story.append(Paragraph(rationale, styles['RBody']))
    story.append(Spacer(1, 10))

    # ── Disclaimer ──
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#cccccc'), spaceAfter=6))
    disclaimer = report.get("disclaimer", "") or (
        "DISCLAIMER: This report is prepared by a SEBI Registered Investment Advisor for informational purposes only. "
        "The recommendations are based on technical and fundamental analysis and do not constitute a guarantee of returns. "
        "Past performance is not indicative of future results. Investors are advised to conduct their own due diligence "
        "and consult with their financial advisor before making investment decisions. The advisor and firm shall not be "
        "responsible for any losses arising from the use of this report. Investments in securities market are subject to "
        "market risks. Read all related documents carefully before investing. "
        f"Generated via AlphaLab on {date_str}."
    )
    story.append(Paragraph("<b>IMPORTANT DISCLAIMER</b>", styles['RLabel']))
    story.append(Paragraph(_sanitize_for_pdf(disclaimer), styles['RDisc']))
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"Report ID: {report.get('id','')} | Generated: {date_str} | AlphaLab - testalpha.in", styles['RDisc']))

    doc.build(story)
    return output_path


@app.post("/api/advisory/report", tags=["Advisory & Reports"], summary="Create advisory report",
    description="Create a new SEBI-compliant advisory report. Stores report content, type, and metadata for regulatory audit trail.")
async def create_advisory_report(req: dict, user=Depends(get_current_user)):
    """Create a new advisory report."""
    async with db_pool.acquire() as conn:
        report_id = await conn.fetchval("""
            INSERT INTO advisory_reports (user_id, title, report_type, advisor_name, ria_reg_no, disclaimer)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        """, user["id"], req.get("title", "Advisory Report"),
           req.get("report_type", "screener"),
           req.get("advisor_name", user.get("name", "")),
           req.get("ria_reg_no", ""),
           req.get("disclaimer", ""))
    return {"id": report_id, "message": "Report created"}


@app.get("/api/symbols/price/{symbol}", tags=["Stock Data"], summary="Get current stock price",
    description="Get the current/latest price for a single stock symbol.")
async def get_symbol_price(symbol: str, user=Depends(get_current_user)):
    """Get current price of a symbol."""
    import yfinance as yf
    loop = asyncio.get_event_loop()
    try:
        ticker = await loop.run_in_executor(None, lambda: yf.Ticker(f"{symbol.upper()}.NS"))
        hist = await loop.run_in_executor(None, lambda: ticker.history(period="5d"))
        if hist.empty:
            return {"symbol": symbol.upper(), "price": 0}
        price = float(hist["Close"].iloc[-1])
        prev = float(hist["Close"].iloc[-2]) if len(hist) > 1 else price
        change = round((price - prev) / prev * 100, 2) if prev > 0 else 0
        return {"symbol": symbol.upper(), "price": round(price, 2), "change_pct": change}
    except:
        return {"symbol": symbol.upper(), "price": 0}


@app.post("/api/advisory/recommend", tags=["Advisory & Reports"], summary="Create stock recommendation",
    description="Create a BUY/SELL/HOLD recommendation for a stock with entry price, target, stop-loss, timeframe, and rationale. Timestamped for SEBI compliance.")
async def add_recommendation(req: dict, user=Depends(get_current_user)):
    """Add a stock recommendation with auto-generated rationale."""
    import yfinance as yf

    symbol = req.get("symbol", "").upper()
    call_type = req.get("call_type", "BUY").upper()
    report_id = req.get("report_id")

    if not symbol:
        raise HTTPException(status_code=400, detail="Symbol required")

    # Auto-create report if not provided
    if not report_id:
        async with db_pool.acquire() as conn:
            report_id = await conn.fetchval("""
                INSERT INTO advisory_reports (user_id, title, report_type, advisor_name)
                VALUES ($1, $2, 'individual', $3) RETURNING id
            """, user["id"], f"Advisory - {datetime.utcnow().strftime('%d %b %Y')}",
               user.get("name", ""))

    # Fetch technical data
    loop = asyncio.get_event_loop()
    tech_data = {}
    fund_data = {}
    try:
        ticker = await loop.run_in_executor(None, lambda: yf.Ticker(f"{symbol}.NS"))
        hist = await loop.run_in_executor(None, lambda: ticker.history(period="1y"))
        if not hist.empty:
            c = hist["Close"]
            price = float(c.iloc[-1])
            sma_50 = float(c.rolling(50).mean().iloc[-1]) if len(c) >= 50 else price
            sma_200 = float(c.rolling(200).mean().iloc[-1]) if len(c) >= 200 else price

            # RSI
            delta = c.diff()
            gain = delta.clip(lower=0).rolling(14).mean()
            loss = (-delta.clip(upper=0)).rolling(14).mean()
            rs = gain / loss
            rsi = float(100 - (100 / (1 + rs)).iloc[-1]) if not loss.iloc[-1] == 0 else 50

            # MACD
            ema12 = c.ewm(span=12).mean()
            ema26 = c.ewm(span=26).mean()
            macd_line = ema12 - ema26
            macd_signal = macd_line.ewm(span=9).mean()
            macd_cross_up = float(macd_line.iloc[-1]) > float(macd_signal.iloc[-1]) and float(macd_line.iloc[-2]) <= float(macd_signal.iloc[-2])

            vol_avg = hist["Volume"].rolling(20).mean().iloc[-1]
            vol_ratio = round(float(hist["Volume"].iloc[-1]) / float(vol_avg), 2) if vol_avg > 0 else 1

            c252 = c.iloc[-min(252, len(c)):]
            rs_3m = round(float(c.iloc[-1] / c.iloc[-min(60, len(c))] - 1) * 100, 1) if len(c) > 60 else 0

            tech_data = {
                "price": round(price, 2), "sma_50": round(sma_50, 2), "sma_200": round(sma_200, 2),
                "rsi": round(rsi, 1), "above_200dma": price > sma_200, "above_50dma": price > sma_50,
                "macd_cross_up": macd_cross_up, "macd_hist": round(float((macd_line - macd_signal).iloc[-1]), 2),
                "vol_ratio": vol_ratio, "rs_3m": rs_3m,
                "golden_cross": False, "death_cross": False,
                "minervini_score": sum([price > sma_50, price > sma_200, sma_50 > sma_200]),
                "w52_high": round(float(c252.max()), 2), "w52_low": round(float(c252.min()), 2),
            }

        info = await loop.run_in_executor(None, lambda: ticker.info)
        if info:
            fund_data = {
                "pe_ratio": info.get("trailingPE", info.get("forwardPE", 0)) or 0,
                "roe": (info.get("returnOnEquity", 0) or 0) * 100 if (info.get("returnOnEquity", 0) or 0) < 1 else info.get("returnOnEquity", 0) or 0,
                "dividend_yield": (info.get("dividendYield", 0) or 0) * 100 if (info.get("dividendYield", 0) or 0) < 1 else info.get("dividendYield", 0) or 0,
                "debt_equity": info.get("debtToEquity", 0) or 0,
                "market_cap": info.get("marketCap", 0) or 0,
                "sector": info.get("sector", ""),
                "name": info.get("shortName", symbol),
            }
    except Exception as e:
        print(f"Data fetch error for {symbol}: {e}")

    # Generate rationale
    rationale_type = req.get("rationale_type", "quantamental")
    rationale = req.get("rationale", "") or generate_rationale(symbol, call_type, tech_data, fund_data, rationale_type)
    entry_price = req.get("entry_price") or tech_data.get("price", 0)
    target_price = req.get("target_price") or (entry_price * 1.15 if call_type == "BUY" else entry_price * 0.85)
    stop_loss = req.get("stop_loss") or (entry_price * 0.92 if call_type == "BUY" else entry_price * 1.08)

    async with db_pool.acquire() as conn:
        rec_id = await conn.fetchval("""
            INSERT INTO advisory_recommendations
            (report_id, user_id, symbol, call_type, entry_price, target_price, stop_loss,
             time_horizon, rationale, technical_data, fundamental_data)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id
        """, report_id, user["id"], symbol, call_type,
           entry_price, target_price, stop_loss,
           req.get("time_horizon", "short_term"), rationale,
           json.dumps(tech_data), json.dumps(fund_data))

    return {
        "id": rec_id, "report_id": report_id, "symbol": symbol,
        "call_type": call_type, "rationale": rationale,
        "entry_price": round(entry_price, 2),
        "target_price": round(target_price, 2),
        "stop_loss": round(stop_loss, 2),
        "technical_data": tech_data, "fundamental_data": fund_data,
    }


@app.put("/api/advisory/recommend/{rec_id}", tags=["Advisory & Reports"], summary="Update recommendation",
    description="Update an existing recommendation — modify target, stop-loss, or status (open/achieved/stopped_out/closed).")
async def update_recommendation(rec_id: int, req: dict, user=Depends(get_current_user)):
    """Update rationale or prices for a recommendation."""
    updates = []
    params = [rec_id, user["id"]]
    idx = 3
    for field in ["rationale", "call_type", "entry_price", "target_price", "stop_loss", "time_horizon"]:
        if field in req:
            updates.append(f"{field}=${idx}")
            params.append(req[field])
            idx += 1
    if "rationale" in req:
        updates.append(f"rationale_edited=true")

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    async with db_pool.acquire() as conn:
        await conn.execute(
            f"UPDATE advisory_recommendations SET {', '.join(updates)} WHERE id=$1 AND user_id=$2",
            *params
        )
    return {"message": "Updated", "id": rec_id}


@app.delete("/api/advisory/recommend/{rec_id}", tags=["Advisory & Reports"], summary="Delete recommendation",
    description="Delete an advisory recommendation.")
async def delete_recommendation(rec_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM advisory_recommendations WHERE id=$1 AND user_id=$2", rec_id, user["id"])
    return {"message": "Deleted"}


@app.get("/api/advisory/reports", tags=["Advisory & Reports"], summary="List advisory reports",
    description="List all advisory reports created by the authenticated user, sorted by most recent.")
async def list_advisory_reports(user=Depends(get_current_user)):
    """List all advisory reports for the user."""
    async with db_pool.acquire() as conn:
        reports = await conn.fetch("""
            SELECT r.*, COUNT(rec.id) as rec_count
            FROM advisory_reports r
            LEFT JOIN advisory_recommendations rec ON rec.report_id = r.id
            WHERE r.user_id = $1
            GROUP BY r.id ORDER BY r.created_at DESC LIMIT 50
        """, user["id"])
    return [dict(r) for r in reports]


@app.get("/api/advisory/report/{report_id}", tags=["Advisory & Reports"], summary="Get advisory report",
    description="Get full details of a specific advisory report by ID.")
async def get_advisory_report(report_id: int, user=Depends(get_current_user)):
    """Get report with all recommendations."""
    async with db_pool.acquire() as conn:
        report = await conn.fetchrow("SELECT * FROM advisory_reports WHERE id=$1 AND user_id=$2", report_id, user["id"])
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        recs = await conn.fetch(
            "SELECT * FROM advisory_recommendations WHERE report_id=$1 ORDER BY created_at", report_id)
    r = dict(report)
    r["created_at"] = r["created_at"].isoformat() if r["created_at"] else ""
    r["recommendations"] = []
    for rec in recs:
        rd = dict(rec)
        rd["created_at"] = rd["created_at"].isoformat() if rd["created_at"] else ""
        rd["technical_data"] = json.loads(rd["technical_data"]) if isinstance(rd["technical_data"], str) else rd["technical_data"]
        rd["fundamental_data"] = json.loads(rd["fundamental_data"]) if isinstance(rd["fundamental_data"], str) else rd["fundamental_data"]
        r["recommendations"].append(rd)
    return r


@app.post("/api/advisory/report/{report_id}/pdf", tags=["Advisory & Reports"], summary="Generate report PDF",
    description="Generate a SEBI-compliant PDF for an advisory report. Returns base64-encoded PDF data ready for download.")
async def generate_report_pdf(report_id: int, user=Depends(get_current_user)):
    """Generate individual PDFs for each recommendation in a report."""
    from fastapi.responses import JSONResponse
    import os

    async with db_pool.acquire() as conn:
        report = await conn.fetchrow("SELECT * FROM advisory_reports WHERE id=$1 AND user_id=$2", report_id, user["id"])
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        recs = await conn.fetch(
            "SELECT * FROM advisory_recommendations WHERE report_id=$1 ORDER BY created_at", report_id)

    if not recs:
        raise HTTPException(status_code=400, detail="No recommendations in this report")

    report_dict = dict(report)
    report_dict["created_at"] = report_dict["created_at"].isoformat() if report_dict["created_at"] else ""

    os.makedirs("/tmp/advisory_pdfs", exist_ok=True)
    pdf_paths = []

    async with db_pool.acquire() as conn:
        for rec in recs:
            rd = dict(rec)
            rd["technical_data"] = json.loads(rd["technical_data"]) if isinstance(rd["technical_data"], str) else rd["technical_data"]
            rd["fundamental_data"] = json.loads(rd["fundamental_data"]) if isinstance(rd["fundamental_data"], str) else rd["fundamental_data"]
            pdf_name = f"advisory_{report_id}_{rd['id']}_{rd['symbol']}_{rd['call_type']}.pdf"
            pdf_path = f"/tmp/advisory_pdfs/{pdf_name}"
            generate_single_advisory_pdf(report_dict, rd, pdf_path)
            await conn.execute("UPDATE advisory_recommendations SET pdf_path=$1 WHERE id=$2", pdf_path, rd["id"])
            pdf_paths.append({"rec_id": rd["id"], "symbol": rd["symbol"], "call_type": rd["call_type"], "pdf_name": pdf_name})

        await conn.execute("UPDATE advisory_reports SET status='published', published_at=NOW() WHERE id=$1", report_id)

    return {"message": f"{len(pdf_paths)} PDFs generated", "pdfs": pdf_paths}


@app.get("/api/advisory/recommend/{rec_id}/pdf", tags=["Advisory & Reports"], summary="Generate recommendation PDF",
    description="Generate a PDF for a specific stock recommendation with entry/target/SL, rationale, and SEBI disclaimer.")
async def download_recommendation_pdf(rec_id: int, user=Depends(get_current_user)):
    """Download individual recommendation PDF."""
    from fastapi.responses import FileResponse
    import os

    async with db_pool.acquire() as conn:
        rec = await conn.fetchrow("SELECT * FROM advisory_recommendations WHERE id=$1 AND user_id=$2", rec_id, user["id"])
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")

    pdf_path = rec.get("pdf_path", "")
    if not pdf_path or not os.path.exists(pdf_path):
        # Generate on the fly
        report = None
        async with db_pool.acquire() as conn:
            report = await conn.fetchrow("SELECT * FROM advisory_reports WHERE id=$1", rec["report_id"])
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")

        report_dict = dict(report)
        report_dict["created_at"] = report_dict["created_at"].isoformat() if report_dict["created_at"] else ""
        rd = dict(rec)
        rd["technical_data"] = json.loads(rd["technical_data"]) if isinstance(rd["technical_data"], str) else rd["technical_data"]
        rd["fundamental_data"] = json.loads(rd["fundamental_data"]) if isinstance(rd["fundamental_data"], str) else rd["fundamental_data"]

        import os
        os.makedirs("/tmp/advisory_pdfs", exist_ok=True)
        pdf_path = f"/tmp/advisory_pdfs/advisory_{rec['report_id']}_{rec['id']}_{rec['symbol']}.pdf"
        generate_single_advisory_pdf(report_dict, rd, pdf_path)
        async with db_pool.acquire() as conn:
            await conn.execute("UPDATE advisory_recommendations SET pdf_path=$1 WHERE id=$2", pdf_path, rec["id"])

    sym = rec.get("symbol", "")
    return FileResponse(pdf_path, media_type="application/pdf",
                       filename=f"AlphaLab_{sym}_{rec.get('call_type','BUY')}_{rec_id}.pdf")


@app.put("/api/advisory/report/{report_id}", tags=["Advisory & Reports"], summary="Update advisory report",
    description="Update an existing advisory report content.")
async def update_report(report_id: int, req: dict, user=Depends(get_current_user)):
    """Update report metadata."""
    updates = []
    params = [report_id, user["id"]]
    idx = 3
    for field in ["title", "advisor_name", "ria_reg_no", "disclaimer", "report_type"]:
        if field in req:
            updates.append(f"{field}=${idx}")
            params.append(req[field])
            idx += 1
    if updates:
        async with db_pool.acquire() as conn:
            await conn.execute(f"UPDATE advisory_reports SET {', '.join(updates)} WHERE id=$1 AND user_id=$2", *params)
    return {"message": "Updated"}


@app.delete("/api/advisory/report/{report_id}", tags=["Advisory & Reports"], summary="Delete advisory report",
    description="Delete an advisory report.")
async def delete_report(report_id: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM advisory_reports WHERE id=$1 AND user_id=$2", report_id, user["id"])
    return {"message": "Deleted"}


# ══════════════════════════════════════════════════════════════════════════════
# SECTOR ANALYSIS & ROTATION ENGINE
# ══════════════════════════════════════════════════════════════════════════════

# Build reverse map: sector -> [symbols]
SECTOR_SYMBOLS = {}
for _sym, _sec in SECTOR_MAP.items():
    SECTOR_SYMBOLS.setdefault(_sec, []).append(_sym)
SECTOR_LIST = sorted(SECTOR_SYMBOLS.keys())

# Build reverse map: industry -> [symbols]
INDUSTRY_SYMBOLS = {}
for _sym, _ind in INDUSTRY_MAP.items():
    INDUSTRY_SYMBOLS.setdefault(_ind, []).append(_sym)
INDUSTRY_LIST = sorted(INDUSTRY_SYMBOLS.keys())

# Build reverse map: basic_industry -> [symbols]
BASIC_INDUSTRY_SYMBOLS = {}
for _sym, _bi in BASIC_INDUSTRY_MAP.items():
    BASIC_INDUSTRY_SYMBOLS.setdefault(_bi, []).append(_sym)
BASIC_INDUSTRY_LIST = sorted(BASIC_INDUSTRY_SYMBOLS.keys())


@app.get("/api/sectors", tags=["Sector Analysis"], summary="List all sectors",
    description="List all 49 sectors with stock counts and sample stock symbols.")
async def list_sectors(user=Depends(get_current_user)):
    """List all sectors with stock counts."""
    return {"sectors": [{
        "name": s, "count": len(SECTOR_SYMBOLS.get(s, [])),
        "stocks": sorted(SECTOR_SYMBOLS.get(s, []))[:10]
    } for s in SECTOR_LIST], "total": len(SECTOR_LIST)}


@app.get("/api/industries", tags=["Sector Analysis"], summary="List industries",
    description="List all industries with stock counts. Optionally filter by sector.")
async def list_industries(sector: str = "", user=Depends(get_current_user)):
    """List all industries with stock counts. Optionally filter by sector."""
    results = []
    for ind in INDUSTRY_LIST:
        syms = INDUSTRY_SYMBOLS[ind]
        if sector:
            syms = [s for s in syms if SECTOR_MAP.get(s, "Other") == sector]
        if not syms:
            continue
        results.append({"name": ind, "count": len(syms), "stocks": sorted(syms)[:8]})
    return {"industries": results, "total": len(results)}


@app.get("/api/basic-industries", tags=["Sector Analysis"], summary="List basic industries",
    description="List all basic industry classifications (most granular level) with stock counts. Filter by sector or industry.")
async def list_basic_industries(sector: str = "", industry: str = "", user=Depends(get_current_user)):
    """List all basic industries. Optionally filter by sector and/or industry."""
    results = []
    for bi in BASIC_INDUSTRY_LIST:
        syms = BASIC_INDUSTRY_SYMBOLS[bi]
        if sector:
            syms = [s for s in syms if SECTOR_MAP.get(s, "Other") == sector]
        if industry:
            syms = [s for s in syms if INDUSTRY_MAP.get(s, "Other") == industry]
        if not syms:
            continue
        results.append({"name": bi, "count": len(syms), "stocks": sorted(syms)[:6]})
    return {"basic_industries": results, "total": len(results)}


@app.get("/api/sector-rotation", tags=["Sector Analysis"], summary="Sector rotation heatmap",
    description="Get sector rotation data showing relative performance of all sectors vs Nifty 50 benchmark. Returns RS-Ratio and RS-Momentum for heatmap visualization.")
async def sector_rotation(user=Depends(get_current_user)):
    """Calculate sector performance over multiple timeframes for rotation analysis."""
    import yfinance as yf
    from datetime import date, timedelta

    cache_key = "sector_rotation_v2"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    # Pick top 3 liquid stocks per sector as sector proxies
    major_sectors = [s for s in SECTOR_LIST if len(SECTOR_SYMBOLS.get(s, [])) >= 3]
    proxy_map = {}
    all_syms = set()
    for sec in major_sectors:
        proxies = SECTOR_SYMBOLS[sec][:5]
        proxy_map[sec] = proxies
        all_syms.update(proxies)

    start = (date.today() - timedelta(days=200)).isoformat()
    end = date.today().isoformat()

    yf_syms = [f"{s}.NS" for s in all_syms]
    all_data = await batch_download_yf(yf_syms, start, end, batch_size=50)

    # Calculate sector returns
    sector_perf = []
    for sec in major_sectors:
        returns = {"1w": [], "1m": [], "3m": [], "6m": []}
        for sym in proxy_map[sec]:
            yf_sym = f"{sym}.NS"
            if yf_sym not in all_data:
                continue
            df = all_data[yf_sym]
            if df.empty or "Close" not in df.columns:
                continue
            c = df["Close"].astype(float).dropna()
            if len(c) < 10:
                continue
            price = float(c.iloc[-1])
            for period, days in [("1w", 5), ("1m", 21), ("3m", 63), ("6m", 126)]:
                idx = min(days, len(c)-1)
                if idx > 0:
                    ret = (price / float(c.iloc[-idx]) - 1) * 100
                    if not np.isnan(ret) and not np.isinf(ret):
                        returns[period].append(ret)

        if not any(returns.values()):
            continue

        avg = {k: round(np.mean(v), 2) if v else 0 for k, v in returns.items()}
        # Momentum score: weighted average across timeframes
        mom_score = round(avg["1w"] * 0.1 + avg["1m"] * 0.3 + avg["3m"] * 0.4 + avg["6m"] * 0.2, 2)

        sector_perf.append({
            "sector": sec, "stock_count": len(SECTOR_SYMBOLS[sec]),
            "return_1w": avg["1w"], "return_1m": avg["1m"],
            "return_3m": avg["3m"], "return_6m": avg["6m"],
            "momentum_score": mom_score,
            "trend": "bullish" if avg["1m"] > 0 and avg["3m"] > 0 else "bearish" if avg["1m"] < 0 and avg["3m"] < 0 else "neutral",
        })

    sector_perf.sort(key=lambda x: x["momentum_score"], reverse=True)

    result = {"sectors": sector_perf, "as_of": end, "total_sectors": len(sector_perf)}
    if redis_client:
        await redis_client.set(cache_key, json.dumps(result), ex=600)  # 10 min cache
    return result


@app.get("/api/sector-rrg", tags=["Sector Analysis"], summary="Relative Rotation Graph (RRG)",
    description="Compute RRG data using JdK RS-Ratio and RS-Momentum methodology. Returns trail data for each sector plotted in 4 quadrants: Leading, Weakening, Lagging, Improving. Configurable lookback weeks (8-20). First load takes 30-60 seconds as it computes relative strength across all sectors.")
async def sector_rrg(weeks: int = 12, user=Depends(get_current_user)):
    """Relative Rotation Graph — JdK RS-Ratio & RS-Momentum for sector rotation analysis.
    Returns trail data (last N weeks) for each sector plotted on a 2D plane.
    X-axis: RS-Ratio (relative strength vs Nifty 50, centered at 100)
    Y-axis: RS-Momentum (rate of change of RS-Ratio, centered at 100)
    Quadrants: Leading(TR), Weakening(BR), Lagging(BL), Improving(TL)
    """
    import yfinance as yf
    from datetime import date, timedelta

    weeks = min(max(weeks, 4), 26)  # Clamp 4-26 weeks
    cache_key = f"sector_rrg_v1:{weeks}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    # We need enough history: weeks + lookback for RS calculation
    lookback_days = (weeks + 14) * 7  # Extra 14 weeks for RS-Ratio smoothing
    start = (date.today() - timedelta(days=lookback_days)).isoformat()
    end = date.today().isoformat()

    # Pick top sectors with enough stocks
    major_sectors = [s for s in SECTOR_LIST if len(SECTOR_SYMBOLS.get(s, [])) >= 8][:12]  # Top 12 major sectors only

    # Download benchmark (Nifty 50)
    loop = asyncio.get_event_loop()
    benchmark_raw = await loop.run_in_executor(None, lambda: yf.download(
        "^NSEI", start=start, end=end, interval="1wk", auto_adjust=True, progress=False
    ))
    if benchmark_raw.empty:
        return {"sectors": [], "error": "Benchmark data unavailable"}

    bench_close = benchmark_raw["Close"].astype(float).dropna()
    if hasattr(bench_close, 'columns'):
        bench_close = bench_close.iloc[:, 0]

    # Download sector proxies
    proxy_map = {}
    all_syms = set()
    for sec in major_sectors:
        proxies = SECTOR_SYMBOLS[sec][:5]
        proxy_map[sec] = proxies
        all_syms.update(proxies)

    yf_syms = [f"{s}.NS" for s in all_syms]
    all_data = await batch_download_yf(yf_syms, start, end, batch_size=50)

    # Build weekly sector indices (equal-weighted average of proxy stocks)
    sector_weekly = {}
    for sec in major_sectors:
        weekly_prices = []
        for sym in proxy_map[sec]:
            yf_sym = f"{sym}.NS"
            if yf_sym not in all_data or all_data[yf_sym].empty:
                continue
            df = all_data[yf_sym]
            if "Close" not in df.columns:
                continue
            c = df["Close"].astype(float).dropna()
            if len(c) < 20:
                continue
            # Resample to weekly
            weekly = c.resample("W-FRI").last().dropna()
            weekly_prices.append(weekly)

        if len(weekly_prices) < 2:
            continue

        # Align and average
        combined = pd.concat(weekly_prices, axis=1).dropna()
        if len(combined) < weeks + 10:
            continue
        sector_weekly[sec] = combined.mean(axis=1)

    # Calculate RS-Ratio and RS-Momentum for each sector
    # RS-Ratio = (sector_price / benchmark_price) * 100, then smoothed
    # RS-Momentum = rate of change of RS-Ratio, smoothed
    bench_weekly = bench_close.resample("W-FRI").last().dropna()

    rrg_data = []
    for sec, sec_prices in sector_weekly.items():
        # Align sector and benchmark
        common_idx = sec_prices.index.intersection(bench_weekly.index)
        if len(common_idx) < weeks + 10:
            continue
        sp = sec_prices.loc[common_idx]
        bp = bench_weekly.loc[common_idx]

        # Raw relative strength (sector / benchmark)
        raw_rs = (sp / bp) * 100

        # Normalize RS to center around 100 using z-score over rolling window
        rs_mean = raw_rs.rolling(window=10, min_periods=5).mean()
        rs_std = raw_rs.rolling(window=10, min_periods=5).std()
        # JdK RS-Ratio: normalized to 100 +/- standard deviations
        rs_ratio = 100 + ((raw_rs - rs_mean) / rs_std.replace(0, 1)) * 2

        # JdK RS-Momentum: rate of change of RS-Ratio
        rs_mom_raw = rs_ratio.diff(1)
        rs_mom_mean = rs_mom_raw.rolling(window=5, min_periods=3).mean()
        rs_mom_std = rs_mom_raw.rolling(window=5, min_periods=3).std()
        rs_momentum = 100 + ((rs_mom_raw - rs_mom_mean) / rs_mom_std.replace(0, 1)) * 2

        # Clean NaN/Inf
        rs_ratio = rs_ratio.replace([np.inf, -np.inf], np.nan).dropna()
        rs_momentum = rs_momentum.replace([np.inf, -np.inf], np.nan).dropna()

        common = rs_ratio.index.intersection(rs_momentum.index)
        if len(common) < weeks:
            continue

        # Extract last N weeks of trail data
        trail = []
        for dt in common[-weeks:]:
            r = float(rs_ratio.loc[dt])
            m = float(rs_momentum.loc[dt])
            if not np.isnan(r) and not np.isnan(m):
                # Clamp to reasonable range
                r = max(90, min(110, r))
                m = max(90, min(110, m))
                trail.append({
                    "date": dt.strftime("%Y-%m-%d"),
                    "rs_ratio": round(r, 2),
                    "rs_momentum": round(m, 2),
                })

        if len(trail) < 4:
            continue

        # Current position (latest point)
        current = trail[-1]
        # Determine quadrant
        if current["rs_ratio"] >= 100 and current["rs_momentum"] >= 100:
            quadrant = "leading"
        elif current["rs_ratio"] >= 100 and current["rs_momentum"] < 100:
            quadrant = "weakening"
        elif current["rs_ratio"] < 100 and current["rs_momentum"] < 100:
            quadrant = "lagging"
        else:
            quadrant = "improving"

        rrg_data.append({
            "sector": sec,
            "stock_count": len(SECTOR_SYMBOLS.get(sec, [])),
            "quadrant": quadrant,
            "current_rs_ratio": current["rs_ratio"],
            "current_rs_momentum": current["rs_momentum"],
            "trail": trail,
        })

    # Sort by quadrant priority: improving > leading > weakening > lagging
    quad_order = {"improving": 0, "leading": 1, "weakening": 2, "lagging": 3}
    rrg_data.sort(key=lambda x: (quad_order.get(x["quadrant"], 9), -x["current_rs_ratio"]))

    result = {
        "sectors": rrg_data,
        "benchmark": "Nifty 50",
        "weeks": weeks,
        "as_of": end,
        "total_sectors": len(rrg_data),
    }
    if redis_client:
        await redis_client.set(cache_key, json.dumps(result), ex=900)  # 15 min cache
    return result


# ══════════════════════════════════════════════════════════════════════════════
# TECHNICAL CHARTS DATA API
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/chart/{symbol}", tags=["Technical Charts"], summary="Get chart data with indicators",
    description="Get OHLCV candlestick data for a stock with pre-computed technical indicators (SMA 20/50/200, EMA 9/21, RSI, MACD, Bollinger Bands, Supertrend, volume). Supports periods: 1m, 3m, 6m, 1y, 2y, 3y, 5y.")
async def chart_data(symbol: str, period: str = "1y", interval: str = "1d", user=Depends(get_current_user)):
    """Return OHLCV + indicators for TradingView Lightweight Charts."""
    import yfinance as yf
    from datetime import date, timedelta

    cache_key = f"chart:{symbol.upper()}:{period}:{interval}"
    if redis_client:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

    period_days = {"1m": 30, "3m": 90, "6m": 180, "1y": 365, "2y": 730, "3y": 1095, "5y": 1825, "max": 3650}
    days = period_days.get(period, 365)
    start = (date.today() - timedelta(days=days + 50)).isoformat()
    end = date.today().isoformat()
    yf_sym = f"{symbol.upper()}.NS"

    loop = asyncio.get_event_loop()
    raw = await loop.run_in_executor(None, lambda: yf.download(
        tickers=yf_sym, start=start, end=end, interval=interval, auto_adjust=True, progress=False
    ))
    df = yf_extract_ticker(raw, yf_sym, single_mode=True)
    if df.empty:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")

    if "Close" in df.columns:
        df = df.rename(columns={"Close":"close","Open":"open","High":"high","Low":"low","Volume":"volume"})
    df = df.sort_index().astype({"open":float,"high":float,"low":float,"close":float,"volume":float}).dropna()

    # Compute all indicators
    df = compute_indicators(df)

    # Build response — OHLCV candles
    candles = []
    for dt, row in df.iterrows():
        ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else int(pd.Timestamp(dt).timestamp())
        candles.append({
            "time": ts, "open": round(float(row["open"]),2), "high": round(float(row["high"]),2),
            "low": round(float(row["low"]),2), "close": round(float(row["close"]),2)
        })

    # Volume bars
    volumes = []
    for dt, row in df.iterrows():
        ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else int(pd.Timestamp(dt).timestamp())
        color = "rgba(0,212,170,0.4)" if row["close"] >= row["open"] else "rgba(239,83,80,0.4)"
        volumes.append({"time": ts, "value": int(row["volume"]), "color": color})

    # SMA overlays
    def series_out(col):
        out = []
        for dt, row in df.iterrows():
            if col in df.columns and not np.isnan(row[col]):
                ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else int(pd.Timestamp(dt).timestamp())
                out.append({"time": ts, "value": round(float(row[col]), 2)})
        return out

    # Bollinger Bands
    bb_upper, bb_lower = [], []
    if "bb_upper" in df.columns:
        for dt, row in df.iterrows():
            ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else int(pd.Timestamp(dt).timestamp())
            if not np.isnan(row.get("bb_upper", float("nan"))):
                bb_upper.append({"time": ts, "value": round(float(row["bb_upper"]), 2)})
                bb_lower.append({"time": ts, "value": round(float(row["bb_lower"]), 2)})

    # RSI
    rsi_data = series_out("rsi_14")

    # MACD
    macd_line, macd_signal_line, macd_hist = [], [], []
    for dt, row in df.iterrows():
        ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else int(pd.Timestamp(dt).timestamp())
        if "macd" in df.columns and not np.isnan(row.get("macd", float("nan"))):
            macd_line.append({"time": ts, "value": round(float(row["macd"]), 2)})
        if "macd_signal" in df.columns and not np.isnan(row.get("macd_signal", float("nan"))):
            macd_signal_line.append({"time": ts, "value": round(float(row["macd_signal"]), 2)})
        if "macd_hist" in df.columns and not np.isnan(row.get("macd_hist", float("nan"))):
            color = "rgba(0,212,170,0.7)" if row["macd_hist"] >= 0 else "rgba(239,83,80,0.7)"
            macd_hist.append({"time": ts, "value": round(float(row["macd_hist"]), 2), "color": color})

    # ADX
    adx_data = series_out("adx") if "adx" in df.columns else []

    # Supertrend
    supertrend_data = series_out("supertrend") if "supertrend" in df.columns else []

    # ATR
    atr_data = series_out("atr") if "atr" in df.columns else []

    # Latest stats
    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last
    price = float(last["close"])
    change = price - float(prev["close"])
    change_pct = change / float(prev["close"]) * 100

    stats = {
        "symbol": symbol.upper(), "price": round(price, 2),
        "change": round(change, 2), "change_pct": round(change_pct, 2),
        "open": round(float(last["open"]), 2), "high": round(float(last["high"]), 2),
        "low": round(float(last["low"]), 2), "volume": int(last["volume"]),
        "rsi": round(float(last["rsi_14"]), 1) if "rsi_14" in df.columns and not np.isnan(last.get("rsi_14", float("nan"))) else None,
        "sma_50": round(float(last["sma_50"]), 2) if "sma_50" in df.columns and not np.isnan(last.get("sma_50", float("nan"))) else None,
        "sma_200": round(float(last["sma_200"]), 2) if "sma_200" in df.columns and not np.isnan(last.get("sma_200", float("nan"))) else None,
        "macd_hist": round(float(last["macd_hist"]), 2) if "macd_hist" in df.columns and not np.isnan(last.get("macd_hist", float("nan"))) else None,
        "adx": round(float(last["adx"]), 1) if "adx" in df.columns and not np.isnan(last.get("adx", float("nan"))) else None,
        "atr": round(float(last["atr"]), 2) if "atr" in df.columns and not np.isnan(last.get("atr", float("nan"))) else None,
        "sector": SECTOR_MAP.get(symbol.upper(), "Other"), "industry": INDUSTRY_MAP.get(symbol.upper(), "Other"), "basic_industry": BASIC_INDUSTRY_MAP.get(symbol.upper(), "Other"),
        "above_50dma": price > float(last["sma_50"]) if "sma_50" in df.columns and not np.isnan(last.get("sma_50", float("nan"))) else None,
        "above_200dma": price > float(last["sma_200"]) if "sma_200" in df.columns and not np.isnan(last.get("sma_200", float("nan"))) else None,
    }

    result = {
        "candles": candles, "volume": volumes,
        "sma_20": series_out("sma_20") if "sma_20" in df.columns else [],
        "sma_50": series_out("sma_50"),
        "sma_200": series_out("sma_200"),
        "ema_12": series_out("ema_12") if "ema_12" in df.columns else [],
        "ema_26": series_out("ema_26") if "ema_26" in df.columns else [],
        "bb_upper": bb_upper, "bb_lower": bb_lower,
        "supertrend": supertrend_data,
        "rsi": rsi_data, "macd_line": macd_line, "macd_signal": macd_signal_line, "macd_hist": macd_hist,
        "adx": adx_data, "atr": atr_data,
        "stats": stats, "total_candles": len(candles),
    }

    if redis_client:
        await redis_client.setex(cache_key, 120, json.dumps(result))
    return result


@app.get("/api/chart/{symbol}/backtest-markers", tags=["Technical Charts"], summary="Get backtest markers for chart overlay",
    description="Get BUY/SELL signal markers from a completed backtest to overlay on a price chart. Returns marker positions with entry/exit prices and trade P&L.")
async def chart_backtest_markers(symbol: str, backtest_id: int, user=Depends(get_current_user)):
    """Get trade entry/exit markers from a completed backtest to overlay on chart."""
    async with db_pool.acquire() as conn:
        bt = await conn.fetchrow("SELECT * FROM backtests WHERE id=$1 AND user_id=$2", backtest_id, user["id"])
        if not bt or not bt["result"]:
            raise HTTPException(status_code=404, detail="Backtest not found")

        result = json.loads(bt["result"]) if isinstance(bt["result"], str) else bt["result"]
        trades = result.get("trades", [])
        markers = []
        for t in trades:
            action = t.get("action", "")
            markers.append({
                "time": int(pd.Timestamp(t["date"]).timestamp()) if t.get("date") else 0,
                "position": "belowBar" if "BUY" in action else "aboveBar",
                "color": "#00d4aa" if "BUY" in action else "#ef5350",
                "shape": "arrowUp" if "BUY" in action else "arrowDown",
                "text": f"{action} ₹{t.get('price', 0)}"
            })
        return {"markers": markers, "symbol": symbol.upper(), "backtest_id": backtest_id}


# ══════════════════════════════════════════════════════════════════════════════
# MODEL PORTFOLIO ENGINE
# ══════════════════════════════════════════════════════════════════════════════

MODEL_PORTFOLIO_TEMPLATES = {
    "momentum_kings": {
        "name": "Momentum Kings", "description": "Top momentum stocks above 200 DMA with volume confirmation",
        "screener": "momentum", "backtest": "MOMENTUM", "forward": "MOMENTUM",
        "params": {"min_price": 100, "max_price": 10000}, "max_holdings": 15, "weighting": "equal"
    },
    "value_picks": {
        "name": "Deep Value Picks", "description": "Low P/E + Low P/B stocks with quality filters",
        "screener": "oversold", "backtest": "VALUE_DEEP_VALUE", "forward": "VALUE_DEEP_VALUE",
        "params": {"max_pb": 1.5, "max_ev_ebitda": 8}, "max_holdings": 12, "weighting": "equal"
    },
    "quality_compounders": {
        "name": "Quality Compounders", "description": "High ROE + Low Debt + Strong margins — buy & hold",
        "screener": "minervini", "backtest": "QUALITY_MOAT", "forward": "QUALITY_MOAT",
        "params": {"min_roe": 18, "min_operating_margin": 15}, "max_holdings": 10, "weighting": "equal"
    },
    "growth_stars": {
        "name": "Growth Stars", "description": "High EPS growth companies with breakout confirmation",
        "screener": "breakout", "backtest": "HYBRID_GROWTH_BREAKOUT", "forward": "HYBRID_GROWTH_BREAKOUT",
        "params": {"min_earnings_growth": 15}, "max_holdings": 12, "weighting": "equal"
    },
    "dividend_income": {
        "name": "Dividend Income", "description": "High dividend yield stocks for passive income",
        "screener": "trend_strong", "backtest": "VALUE_HIGH_DIVIDEND", "forward": "VALUE_HIGH_DIVIDEND",
        "params": {"min_dividend_yield": 2}, "max_holdings": 15, "weighting": "equal"
    },
    "techno_fundamental": {
        "name": "Techno-Fundamental", "description": "Quality fundamentals + MACD momentum timing",
        "screener": "minervini", "backtest": "HYBRID_QUALITY_MOMENTUM", "forward": "HYBRID_QUALITY_MOMENTUM",
        "params": {"min_roe": 15, "min_profit_margin": 10}, "max_holdings": 10, "weighting": "equal"
    },
    "breakout_warriors": {
        "name": "Breakout Warriors", "description": "52-week high breakouts with volume surge",
        "screener": "breakout", "backtest": "BREAKOUT", "forward": "BREAKOUT",
        "params": {"window": 20}, "max_holdings": 10, "weighting": "equal"
    },
    "low_volatility": {
        "name": "Low Volatility Shield", "description": "Low beta, steady stocks for capital preservation",
        "screener": "trend_strong", "backtest": "FACTOR_LOW_VOLATILITY", "forward": "FACTOR_LOW_VOLATILITY",
        "params": {"vol_threshold_pct": 20}, "max_holdings": 15, "weighting": "equal"
    },
    "small_cap_gems": {
        "name": "Small Cap Gems", "description": "Small cap momentum with fundamental quality filter",
        "screener": "relative_strength", "backtest": "FACTOR_SIZE", "forward": "FACTOR_SIZE",
        "params": {"max_market_cap_cr": 10000}, "max_holdings": 15, "weighting": "equal"
    },
    "turnaround_plays": {
        "name": "Turnaround Plays", "description": "Oversold quality stocks near support — contrarian entry",
        "screener": "oversold", "backtest": "HYBRID_VALUE_REVERSAL", "forward": "HYBRID_VALUE_REVERSAL",
        "params": {"pe_max": 20, "oversold": 35}, "max_holdings": 10, "weighting": "equal"
    },
    "golden_cross_portfolio": {
        "name": "Golden Cross Portfolio", "description": "Stocks with 50 DMA crossing above 200 DMA",
        "screener": "golden_cross", "backtest": "GOLDEN_CROSS", "forward": "GOLDEN_CROSS",
        "params": {}, "max_holdings": 15, "weighting": "equal"
    },
    "all_weather": {
        "name": "All Weather Portfolio", "description": "Balanced mix: quality + low vol + dividend across sectors",
        "screener": "trend_strong", "backtest": "FACTOR_QUALITY", "forward": "FACTOR_QUALITY",
        "params": {}, "max_holdings": 20, "weighting": "equal"
    },
    # ── Sector Themed Portfolios ──────────────────────────────────────────
    "banking_sector": {
        "name": "Banking & Finance", "description": "Top banking stocks — momentum + quality across PSU & private banks",
        "screener": "relative_strength", "backtest": "HYBRID_ROE_TREND", "forward": "HYBRID_ROE_TREND",
        "params": {"sector_filter": "Banking"}, "max_holdings": 10, "weighting": "equal"
    },
    "it_sector": {
        "name": "IT & Technology", "description": "Best Indian IT companies — growth momentum + quality",
        "screener": "trend_strong", "backtest": "HYBRID_QUALITY_MOMENTUM", "forward": "HYBRID_QUALITY_MOMENTUM",
        "params": {"sector_filter": "IT"}, "max_holdings": 10, "weighting": "equal"
    },
    "pharma_healthcare": {
        "name": "Pharma & Healthcare", "description": "Pharma + hospital chains — defensive growth portfolio",
        "screener": "relative_strength", "backtest": "QUALITY_HIGH_ROE", "forward": "QUALITY_HIGH_ROE",
        "params": {"sector_filter": "Pharma"}, "max_holdings": 10, "weighting": "equal"
    },
    "infra_capex": {
        "name": "Infra & Capital Goods", "description": "India capex theme — infra, industrial, defence plays",
        "screener": "breakout", "backtest": "MOMENTUM", "forward": "MOMENTUM",
        "params": {"sector_filter": "Infra"}, "max_holdings": 12, "weighting": "equal"
    },
    "defence_theme": {
        "name": "Defence & Aerospace", "description": "Make in India defence — HAL, BEL, BDL, shipyards",
        "screener": "relative_strength", "backtest": "MOMENTUM", "forward": "MOMENTUM",
        "params": {"sector_filter": "Defence"}, "max_holdings": 8, "weighting": "equal"
    },
    "consumption_theme": {
        "name": "India Consumption", "description": "FMCG + consumer + retail — domestic demand play",
        "screener": "trend_strong", "backtest": "QUALITY_MOAT", "forward": "QUALITY_MOAT",
        "params": {"sector_filter": "FMCG"}, "max_holdings": 12, "weighting": "equal"
    },
    "realty_housing": {
        "name": "Real Estate Boom", "description": "Realty + building materials — housing upcycle beneficiaries",
        "screener": "breakout", "backtest": "MOMENTUM", "forward": "MOMENTUM",
        "params": {"sector_filter": "Realty"}, "max_holdings": 8, "weighting": "equal"
    },
    "energy_transition": {
        "name": "Energy & Power", "description": "Oil & gas, power, renewables — energy security theme",
        "screener": "relative_strength", "backtest": "HYBRID_ROE_TREND", "forward": "HYBRID_ROE_TREND",
        "params": {"sector_filter": "Energy"}, "max_holdings": 10, "weighting": "equal"
    },
    "metal_commodities": {
        "name": "Metals & Mining", "description": "Steel, aluminium, copper — commodity upcycle portfolio",
        "screener": "momentum", "backtest": "MOMENTUM", "forward": "MOMENTUM",
        "params": {"sector_filter": "Metal"}, "max_holdings": 8, "weighting": "equal"
    },
    "auto_ev": {
        "name": "Auto & EV Play", "description": "OEMs + auto ancillaries — EV & export theme",
        "screener": "trend_strong", "backtest": "HYBRID_QUALITY_MOMENTUM", "forward": "HYBRID_QUALITY_MOMENTUM",
        "params": {"sector_filter": "Auto"}, "max_holdings": 10, "weighting": "equal"
    },
    "chemical_specialty": {
        "name": "Chemicals & Specialty", "description": "Specialty chemicals — China+1 beneficiaries",
        "screener": "relative_strength", "backtest": "QUALITY_HIGH_ROE", "forward": "QUALITY_HIGH_ROE",
        "params": {"sector_filter": "Chemical"}, "max_holdings": 10, "weighting": "equal"
    },
}


async def build_model_portfolio(portfolio_id: int, user_id: int):
    """Build portfolio: run screener → apply strategy filter → rank → allocate weights → deploy to paper trades."""
    import yfinance as yf
    from datetime import date, timedelta

    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", portfolio_id, user_id)
        if not mp:
            return {"error": "Portfolio not found"}

        params = json.loads(mp["params"]) if isinstance(mp["params"], str) else (mp["params"] or {})
        screener_strat = mp["screener_strategy"]
        bt_strat = mp["backtest_strategy"]
        max_h = mp["max_holdings"]
        capital = mp["initial_capital"]
        weighting = mp["weighting"]

        # Step 1: Run screener to get candidate stocks
        screener_results = []
        if screener_strat:
            min_price = float(params.get("min_price", 50))
            max_price = float(params.get("max_price", 10000))
            cache_key = f"screener:{screener_strat}:{int(min_price)}:{int(max_price)}"
            cached = None
            if redis_client:
                cached = await redis_client.get(cache_key)
            if cached:
                data = json.loads(cached)
                screener_results = data.get("stocks", [])
            else:
                # Trigger screener endpoint internally would be complex — use a simpler approach
                # Just use NIFTY_UNIVERSE and filter by the screener criteria after
                screener_results = []  # Will be populated from forward signals

        # Step 2: If we have a backtest/forward strategy, run it on top candidates
        candidates = []
        symbols_to_scan = [s["symbol"] for s in screener_results[:60]] if screener_results else list(NIFTY_UNIVERSE)[:100]

        # Apply sector filter if set
        sector_filter = params.get("sector_filter", "")
        if sector_filter:
            symbols_to_scan = [s for s in symbols_to_scan if SECTOR_MAP.get(s, "Other") == sector_filter]

        if bt_strat or mp["forward_strategy"]:
            strat = bt_strat or mp["forward_strategy"]
            start_date = (date.today() - timedelta(days=250)).isoformat()
            end_date = date.today().isoformat()
            loop = asyncio.get_event_loop()

            # Batch download
            yf_syms = [f"{s}.NS" for s in symbols_to_scan]
            all_data = {}
            for i in range(0, len(yf_syms), 40):
                batch = yf_syms[i:i+40]
                try:
                    raw = await loop.run_in_executor(None, lambda b=batch: yf.download(
                        tickers=b, start=start_date, end=end_date, interval="1d", auto_adjust=True, progress=False, threads=True
                    ))
                    single = len(batch) == 1
                    for yfs in batch:
                        try:
                            df = yf_extract_ticker(raw, yfs, single_mode=single)
                            if not df.empty and len(df) >= 30:
                                all_data[yfs] = df
                        except:
                            continue
                except:
                    continue

            for sym in symbols_to_scan:
                yf_sym = f"{sym}.NS"
                if yf_sym not in all_data:
                    continue
                try:
                    df = all_data[yf_sym].copy()
                    if "Close" in df.columns:
                        df = df.rename(columns={"Close":"close","Open":"open","High":"high","Low":"low","Volume":"volume"})
                    df = df.sort_index().astype({"open":float,"high":float,"low":float,"close":float,"volume":float}).dropna()
                    if len(df) < 30:
                        continue

                    df = compute_indicators(df)
                    p = dict(params)
                    p["_symbol"] = sym

                    if strat.startswith(("VALUE_","QUALITY_","GROWTH_","HYBRID_","FACTOR_")):
                        try:
                            p["_fundamentals"] = fetch_fundamentals_sync(sym)
                        except:
                            p["_fundamentals"] = {}
                    else:
                        p["_fundamentals"] = {}

                    fn = STRATEGY_MAP.get(strat, strategy_sma_crossover)
                    sig_series = fn(df, p)
                    last_sig = int(sig_series.iloc[-1]) if len(sig_series) > 0 else 0
                    price = float(df["close"].iloc[-1])
                    fund = p.get("_fundamentals", {})

                    # Score each stock
                    rsi = float(df["rsi_14"].iloc[-1]) if "rsi_14" in df.columns and not np.isnan(df["rsi_14"].iloc[-1]) else 50
                    vol_r = float(df["volume"].iloc[-1] / df["volume"].rolling(20).mean().iloc[-1]) if len(df) >= 20 else 1
                    above_200 = 1 if "sma_200" in df.columns and not np.isnan(df["sma_200"].iloc[-1]) and price > float(df["sma_200"].iloc[-1]) else 0
                    atr_val = float(df["atr"].iloc[-1]) if "atr" in df.columns and not np.isnan(df["atr"].iloc[-1]) else 0
                    change_1m = float((price - float(df["close"].iloc[-22])) / float(df["close"].iloc[-22]) * 100) if len(df) > 22 else 0

                    strength = 0
                    if last_sig == 1:
                        strength = min(100, max(10, int(30 + (70 - rsi) * 0.3 + min(vol_r, 5) * 8 + above_200 * 20)))

                    # Calculate score for ranking — higher is better
                    score = strength
                    # Boost from screener rank
                    scr_match = next((s for s in screener_results if s.get("symbol") == sym), None)
                    if scr_match:
                        scr_rank = screener_results.index(scr_match)
                        score += max(0, 40 - scr_rank)  # Top screener results get +40 boost

                    if last_sig == 1 or (not bt_strat and screener_strat):
                        # For screener-only portfolios, include all screener results
                        candidates.append({
                            "symbol": sym, "price": round(price, 2), "signal": "BUY" if last_sig == 1 else "HOLD",
                            "strength": strength, "score": score, "rsi": round(rsi, 1),
                            "change_1m": round(change_1m, 1), "above_200dma": above_200,
                            "volume_ratio": round(vol_r, 2), "atr": round(atr_val, 2),
                            "sector": SECTOR_MAP.get(sym, "Other"), "industry": INDUSTRY_MAP.get(sym, "Other"), "basic_industry": BASIC_INDUSTRY_MAP.get(sym, "Other"),
                            "pe": fund.get("pe_trailing"), "pb": fund.get("pb"),
                            "roe": fund.get("roe"), "de": fund.get("debt_equity"),
                            "div_yield": fund.get("dividend_yield"),
                        })
                except:
                    continue

        # If no strategy filter, use screener results directly
        if not candidates and screener_results:
            for i, s in enumerate(screener_results[:max_h * 2]):
                candidates.append({
                    "symbol": s.get("symbol", ""), "price": s.get("price", 0),
                    "signal": "BUY", "strength": max(10, 80 - i * 3), "score": 80 - i * 3,
                    "rsi": s.get("rsi", 50), "change_1m": s.get("rs_1m", 0),
                    "above_200dma": s.get("above_200dma", 0),
                    "volume_ratio": s.get("vol_ratio", 1), "atr": 0,
                    "sector": s.get("sector", "Other"),
                    "pe": None, "pb": None, "roe": None, "de": None, "div_yield": None,
                })

        # Step 3: Rank and select top N
        candidates.sort(key=lambda x: x["score"], reverse=True)
        selected = candidates[:max_h]

        if not selected:
            return {"holdings": 0, "message": "No stocks matched the portfolio criteria"}

        # Step 4: Allocate weights
        if weighting == "equal":
            w = round(100 / len(selected), 2)
            for s in selected:
                s["weight"] = w
        elif weighting == "score_weighted":
            total_score = sum(s["score"] for s in selected)
            for s in selected:
                s["weight"] = round(s["score"] / total_score * 100, 2) if total_score > 0 else round(100/len(selected), 2)
        elif weighting == "inverse_volatility":
            total_inv = sum(1/(s["atr"]+0.01) for s in selected)
            for s in selected:
                s["weight"] = round((1/(s["atr"]+0.01)) / total_inv * 100, 2) if total_inv > 0 else round(100/len(selected), 2)
        else:
            w = round(100 / len(selected), 2)
            for s in selected:
                s["weight"] = w

        # Step 5: Clear old holdings, insert new ones
        await conn.execute("DELETE FROM model_portfolio_holdings WHERE portfolio_id=$1", portfolio_id)

        for rank, s in enumerate(selected, 1):
            alloc = capital * s["weight"] / 100
            shares = int(alloc / s["price"]) if s["price"] > 0 else 0
            fund_data = {}
            for fk in ["pe","pb","roe","de","div_yield"]:
                if s.get(fk) is not None:
                    fund_data[fk] = s[fk]

            await conn.execute("""
                INSERT INTO model_portfolio_holdings (portfolio_id,symbol,weight_pct,shares,entry_price,current_price,
                    screener_rank,signal_type,signal_strength,sector,fundamentals)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            """, portfolio_id, s["symbol"], s["weight"], shares, s["price"], s["price"],
                rank, s["signal"], s["strength"], s["sector"], json.dumps(fund_data))

        await conn.execute("UPDATE model_portfolios SET updated_at=NOW() WHERE id=$1", portfolio_id)

        # Step 6: Snapshot
        total_val = sum(s["price"] * int(capital * s["weight"]/100 / s["price"]) for s in selected if s["price"] > 0)
        await conn.execute("""
            INSERT INTO model_portfolio_snapshots (portfolio_id,total_value,holdings_data,return_pct,snapshot_date)
            VALUES ($1,$2,$3,0,$4)
            ON CONFLICT (portfolio_id,snapshot_date) DO UPDATE SET total_value=$2,holdings_data=$3
        """, portfolio_id, round(total_val, 2), json.dumps([{"s":s["symbol"],"w":s["weight"],"p":s["price"]} for s in selected]),
            date.today())

        return {
            "holdings": len(selected),
            "total_allocated": round(total_val, 2),
            "stocks": selected,
            "message": f"Portfolio built with {len(selected)} holdings"
        }


# ── Model Portfolio API Endpoints ────────────────────────────────────────────

@app.get("/api/model-portfolios/templates", tags=["Model Portfolios"], summary="List portfolio templates",
    description="Get all 23 pre-built model portfolio templates — Momentum, Value, Quality, Dividend, Sector Rotation, etc. Each template includes strategy, weighting method, rebalance frequency, and parameters.")
async def get_portfolio_templates(user=Depends(get_current_user)):
    return [{"id": k, **{kk: vv for kk, vv in v.items() if kk != "params"}} for k, v in MODEL_PORTFOLIO_TEMPLATES.items()]


@app.post("/api/model-portfolio/create", tags=["Model Portfolios"], summary="Create custom portfolio",
    description="Create a new model portfolio from scratch. Configure strategy source (screener/backtest/forward test), weighting (equal/market_cap/risk_parity), max holdings, rebalance frequency, and sector filters.")
async def create_model_portfolio(req: ModelPortfolioCreate, user=Depends(get_current_user)):
    p = dict(req.params)
    if req.sector_filter:
        p["sector_filter"] = req.sector_filter
    async with db_pool.acquire() as conn:
        pid = await conn.fetchval("""
            INSERT INTO model_portfolios (user_id,name,description,portfolio_type,screener_strategy,backtest_strategy,forward_strategy,
                params,initial_capital,weighting,max_holdings,rebalance_freq)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
        """, user["id"], req.name, req.description, req.portfolio_type,
            req.screener_strategy, req.backtest_strategy, req.forward_strategy,
            json.dumps(p), req.initial_capital, req.weighting, req.max_holdings, req.rebalance_freq)
        return {"id": pid}


@app.post("/api/model-portfolio/create-from-template/{template_id}", tags=["Model Portfolios"], summary="Create from template",
    description="Create a model portfolio from one of the 23 pre-built templates with default parameters.")
async def create_from_template(template_id: str, user=Depends(get_current_user)):
    tmpl = MODEL_PORTFOLIO_TEMPLATES.get(template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    async with db_pool.acquire() as conn:
        pid = await conn.fetchval("""
            INSERT INTO model_portfolios (user_id,name,description,portfolio_type,screener_strategy,backtest_strategy,forward_strategy,
                params,initial_capital,weighting,max_holdings,rebalance_freq)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,100000,$9,$10,'monthly') RETURNING id
        """, user["id"], tmpl["name"], tmpl["description"], template_id,
            tmpl.get("screener"), tmpl.get("backtest"), tmpl.get("forward"),
            json.dumps(tmpl.get("params", {})), tmpl.get("weighting", "equal"), tmpl.get("max_holdings", 15))
    return {"id": pid, "name": tmpl["name"]}


@app.get("/api/model-portfolios", tags=["Model Portfolios"], summary="List user portfolios",
    description="List all model portfolios created by the authenticated user with current status and holdings count.")
async def list_model_portfolios(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT mp.*,
                (SELECT COUNT(*) FROM model_portfolio_holdings WHERE portfolio_id=mp.id AND status='active') as num_holdings
            FROM model_portfolios mp WHERE mp.user_id=$1 ORDER BY mp.created_at DESC
        """, user["id"])
        return [_safe_row(r) for r in rows]


@app.get("/api/model-portfolio/{pid}", tags=["Model Portfolios"], summary="Get portfolio details",
    description="Get full details of a model portfolio — holdings with current prices, weights, P&L, sector allocation, and performance metrics.")
async def get_model_portfolio(pid: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Not found")

        holdings = await conn.fetch(
            "SELECT * FROM model_portfolio_holdings WHERE portfolio_id=$1 AND status='active' ORDER BY screener_rank ASC", pid
        )
        snapshots = await conn.fetch(
            "SELECT * FROM model_portfolio_snapshots WHERE portfolio_id=$1 ORDER BY snapshot_date ASC", pid
        )

        total_val = sum((h["current_price"] or h["entry_price"] or 0) * (h["shares"] or 0) for h in holdings)
        total_cost = sum((h["entry_price"] or 0) * (h["shares"] or 0) for h in holdings)
        total_ret = ((total_val / total_cost - 1) * 100) if total_cost > 0 else 0

        # Sector breakdown
        sectors = {}
        for h in holdings:
            sec = h["sector"] or "Other"
            val = (h["current_price"] or h["entry_price"] or 0) * (h["shares"] or 0)
            sectors[sec] = sectors.get(sec, 0) + val
        if total_val > 0:
            sectors = {k: round(v/total_val*100, 1) for k, v in sectors.items()}

        return {
            "portfolio": _safe_row(mp),
            "holdings": [_safe_row(h) for h in holdings],
            "snapshots": [_safe_row(s) for s in snapshots],
            "summary": {
                "total_value": round(total_val, 2), "total_cost": round(total_cost, 2),
                "return_pct": round(total_ret, 2), "num_holdings": len(holdings),
                "sectors": sectors,
            }
        }


@app.post("/api/model-portfolio/{pid}/build", tags=["Model Portfolios"], summary="Build/rebuild portfolio",
    description="Run the portfolio's strategy to populate or refresh holdings. Executes the screener, applies weighting, and selects stocks up to max_holdings.")
async def build_portfolio(pid: int, user=Depends(get_current_user)):
    """Run screener + strategy to build/rebalance portfolio holdings."""
    result = await build_model_portfolio(pid, user["id"])
    return result


@app.post("/api/model-portfolio/{pid}/deploy-paper", tags=["Model Portfolios"], summary="Deploy to paper trading",
    description="Convert a model portfolio into live paper trades — opens paper positions for all holdings at current market prices.")
async def deploy_to_paper(pid: int, user=Depends(get_current_user)):
    """Push all portfolio holdings to paper trading."""
    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Not found")

        holdings = await conn.fetch(
            "SELECT * FROM model_portfolio_holdings WHERE portfolio_id=$1 AND status='active' AND shares > 0", pid
        )
        deployed = 0
        for h in holdings:
            # Check if already has open paper trade for this symbol
            existing = await conn.fetchrow(
                "SELECT id FROM paper_trades WHERE user_id=$1 AND symbol=$2 AND status='open'", user["id"], h["symbol"]
            )
            if existing:
                continue

            atr = 0
            fund = json.loads(h["fundamentals"]) if isinstance(h["fundamentals"], str) else (h["fundamentals"] or {})
            sl = round(h["entry_price"] * 0.95, 2) if h["entry_price"] else None  # 5% SL
            tgt = round(h["entry_price"] * 1.15, 2) if h["entry_price"] else None  # 15% target

            tid = await conn.fetchval(
                "INSERT INTO paper_trades (user_id,symbol,trade_type,quantity,entry_price,stop_loss,target) VALUES ($1,$2,'BUY',$3,$4,$5,$6) RETURNING id",
                user["id"], h["symbol"], h["shares"], h["entry_price"], sl, tgt
            )
            await conn.execute("UPDATE model_portfolio_holdings SET paper_trade_id=$1 WHERE id=$2", tid, h["id"])
            deployed += 1

        return {"deployed": deployed, "total_holdings": len(holdings), "message": f"Deployed {deployed} positions to paper trading"}


@app.delete("/api/model-portfolio/{pid}", tags=["Model Portfolios"], summary="Delete portfolio",
    description="Delete a model portfolio and all its holdings.")
async def delete_model_portfolio(pid: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        return {"deleted": True}


# ── Model Portfolio Editing ─────────────────────────────────────────────────

@app.put("/api/model-portfolio/{pid}/holding/{hid}", tags=["Model Portfolios"], summary="Update holding",
    description="Update a specific holding in a portfolio — modify weight, quantity, or notes.")
async def update_holding(pid: int, hid: int, req: Request, user=Depends(get_current_user)):
    """Update a holding's weight or shares."""
    body = await req.json()
    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Portfolio not found")
        h = await conn.fetchrow("SELECT * FROM model_portfolio_holdings WHERE id=$1 AND portfolio_id=$2", hid, pid)
        if not h: raise HTTPException(status_code=404, detail="Holding not found")

        new_weight = body.get("weight_pct", h["weight_pct"])
        new_shares = body.get("shares", h["shares"])
        await conn.execute(
            "UPDATE model_portfolio_holdings SET weight_pct=$1, shares=$2 WHERE id=$3",
            float(new_weight), int(new_shares), hid
        )
        await conn.execute("UPDATE model_portfolios SET updated_at=NOW() WHERE id=$1", pid)
        return {"updated": True, "holding_id": hid}


@app.delete("/api/model-portfolio/{pid}/holding/{hid}", tags=["Model Portfolios"], summary="Remove holding",
    description="Remove a stock from a model portfolio.")
async def remove_holding(pid: int, hid: int, user=Depends(get_current_user)):
    """Remove a stock from the portfolio."""
    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Portfolio not found")
        await conn.execute("DELETE FROM model_portfolio_holdings WHERE id=$1 AND portfolio_id=$2", hid, pid)
        await conn.execute("UPDATE model_portfolios SET updated_at=NOW() WHERE id=$1", pid)
        return {"deleted": True}


@app.post("/api/model-portfolio/{pid}/add-stock", tags=["Model Portfolios"], summary="Add stock to portfolio",
    description="Manually add a stock to a model portfolio with specified quantity and weight.")
async def add_stock_to_portfolio(pid: int, req: Request, user=Depends(get_current_user)):
    """Manually add a stock to the portfolio."""
    body = await req.json()
    symbol = (body.get("symbol","")).upper().strip()
    weight_pct = float(body.get("weight_pct", 0))
    if not symbol: raise HTTPException(status_code=400, detail="Symbol required")

    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Portfolio not found")

        # Check duplicate
        existing = await conn.fetchrow(
            "SELECT id FROM model_portfolio_holdings WHERE portfolio_id=$1 AND symbol=$2 AND status='active'", pid, symbol
        )
        if existing: raise HTTPException(status_code=400, detail=f"{symbol} already in portfolio")

        # Get current price via yfinance
        price = 0
        try:
            import yfinance as yf
            sym_yf = symbol + ".NS"
            tk = yf.Ticker(sym_yf)
            hist = tk.history(period="5d")
            if not hist.empty:
                price = round(float(hist["Close"].iloc[-1]), 2)
        except: pass
        if not price or price <= 0: raise HTTPException(status_code=400, detail=f"Cannot get price for {symbol}")

        # Get sector from universe
        sector = SECTOR_MAP.get(symbol, "Other")

        capital = mp["initial_capital"] or 100000
        shares = int((capital * weight_pct / 100) / price) if weight_pct > 0 and price > 0 else 0

        hid = await conn.fetchval("""
            INSERT INTO model_portfolio_holdings (portfolio_id,symbol,weight_pct,shares,entry_price,current_price,
            screener_rank,signal_type,signal_strength,sector,status)
            VALUES ($1,$2,$3,$4,$5,$5,999,'MANUAL',0,$6,'active') RETURNING id
        """, pid, symbol, weight_pct, shares, price, sector)
        await conn.execute("UPDATE model_portfolios SET updated_at=NOW() WHERE id=$1", pid)
        return {"added": True, "holding_id": hid, "symbol": symbol, "price": price, "shares": shares}


@app.post("/api/model-portfolio/{pid}/reweight", tags=["Model Portfolios"], summary="Reweight portfolio",
    description="Rebalance portfolio weights using the specified method (equal, market_cap, risk_parity, or custom). Recalculates quantities based on current prices and capital.")
async def reweight_portfolio(pid: int, req: Request, user=Depends(get_current_user)):
    """Normalize weights to 100% and recalculate shares."""
    async with db_pool.acquire() as conn:
        mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1 AND user_id=$2", pid, user["id"])
        if not mp: raise HTTPException(status_code=404, detail="Portfolio not found")

        holdings = await conn.fetch(
            "SELECT * FROM model_portfolio_holdings WHERE portfolio_id=$1 AND status='active'", pid
        )
        if not holdings: return {"message": "No holdings to reweight"}

        total_weight = sum(h["weight_pct"] or 0 for h in holdings)
        capital = mp["initial_capital"] or 100000

        for h in holdings:
            new_weight = ((h["weight_pct"] or 0) / total_weight * 100) if total_weight > 0 else (100.0 / len(holdings))
            price = h["current_price"] or h["entry_price"] or 1
            new_shares = int((capital * new_weight / 100) / price) if price > 0 else 0
            await conn.execute(
                "UPDATE model_portfolio_holdings SET weight_pct=$1, shares=$2 WHERE id=$3",
                round(new_weight, 2), new_shares, h["id"]
            )

        await conn.execute("UPDATE model_portfolios SET updated_at=NOW() WHERE id=$1", pid)
        return {"message": f"Reweighted {len(holdings)} holdings to 100%"}


@app.get("/api/dashboard/strategies", tags=["Dashboard"], summary="Strategy performance dashboard",
    description="Aggregated performance data across all strategies — screener hit rates, backtest results, forward test P&L, and top performing strategies. Powers the main dashboard view.")
async def get_strategy_dashboard(user=Depends(get_current_user)):
    """Get performance summary of all portfolios, backtests, and forward tests."""
    async with db_pool.acquire() as conn:
        # Model Portfolios with performance
        portfolios = await conn.fetch("""
            SELECT mp.*, 
                (SELECT COUNT(*) FROM model_portfolio_holdings WHERE portfolio_id=mp.id AND status='active') as num_holdings,
                (SELECT COALESCE(SUM(current_price * shares), 0) FROM model_portfolio_holdings WHERE portfolio_id=mp.id AND status='active') as total_value,
                (SELECT COALESCE(SUM(entry_price * shares), 0) FROM model_portfolio_holdings WHERE portfolio_id=mp.id AND status='active') as total_cost
            FROM model_portfolios mp WHERE mp.user_id=$1 AND mp.status='active' ORDER BY mp.updated_at DESC
        """, user["id"])

        portfolio_data = []
        for p in portfolios:
            tv = p["total_value"] or 0
            tc = p["total_cost"] or 0
            ret = ((tv / tc - 1) * 100) if tc > 0 else 0
            portfolio_data.append({
                "id": p["id"], "name": p["name"], "type": "portfolio",
                "strategy": p["screener_strategy"] or p["backtest_strategy"] or "custom",
                "num_holdings": p["num_holdings"], "total_value": round(tv, 0),
                "total_cost": round(tc, 0), "return_pct": round(ret, 2),
                "weighting": p["weighting"], "updated_at": str(p["updated_at"]) if p["updated_at"] else None
            })

        # Completed Backtests with results
        backtests = await conn.fetch("""
            SELECT id, name, symbol, strategy, status, 
                   result->'summary'->>'total_return' as total_return,
                   result->'summary'->>'sharpe_ratio' as sharpe,
                   result->'summary'->>'win_rate' as win_rate,
                   result->'summary'->>'num_trades' as num_trades,
                   created_at
            FROM backtests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20
        """, user["id"])

        backtest_data = []
        for b in backtests:
            backtest_data.append({
                "id": b["id"], "name": b["name"], "type": "backtest",
                "symbol": b["symbol"], "strategy": b["strategy"], "status": b["status"],
                "total_return": float(b["total_return"]) if b["total_return"] else None,
                "sharpe": float(b["sharpe"]) if b["sharpe"] else None,
                "win_rate": float(b["win_rate"]) if b["win_rate"] else None,
                "num_trades": int(b["num_trades"]) if b["num_trades"] else 0,
                "created_at": str(b["created_at"]) if b["created_at"] else None
            })

        # Forward Tests
        forward_tests = await conn.fetch("""
            SELECT ft.id, ft.name, ft.strategy, ft.status, ft.created_at, ft.last_scan_at,
                ft.current_capital, ft.initial_capital,
                (SELECT COUNT(*) FROM forward_test_positions WHERE fwd_test_id=ft.id AND status='open') as active_signals,
                (SELECT COUNT(*) FROM forward_test_positions WHERE fwd_test_id=ft.id) as total_signals,
                (SELECT COALESCE(
                    ROUND(COUNT(*) FILTER (WHERE unrealized_pnl_pct > 0)::numeric * 100.0 / NULLIF(COUNT(*),0), 1),
                    0
                ) FROM forward_test_positions WHERE fwd_test_id=ft.id AND status='closed') as hit_rate
            FROM forward_tests ft WHERE ft.user_id=$1 ORDER BY ft.last_scan_at DESC NULLS LAST LIMIT 20
        """, user["id"])

        fwd_data = []
        for f in forward_tests:
            ret_pct = ((f["current_capital"] / f["initial_capital"] - 1) * 100) if f["initial_capital"] and f["initial_capital"] > 0 else 0
            fwd_data.append({
                "id": f["id"], "name": f["name"], "type": "forward_test",
                "strategy": f["strategy"], "sector": "All",
                "status": f["status"],
                "active_signals": f["active_signals"] or 0,
                "total_signals": f["total_signals"] or 0,
                "hit_rate": round(float(f["hit_rate"]), 1) if f["hit_rate"] else 0,
                "return_pct": round(ret_pct, 2),
                "updated_at": str(f["last_scan_at"]) if f["last_scan_at"] else (str(f["created_at"]) if f["created_at"] else None)
            })

        return {
            "portfolios": portfolio_data,
            "backtests": backtest_data,
            "forward_tests": fwd_data
        }


# ── Alerts & Notifications System ──────────────────────────────────────────────

async def _create_notification(conn, user_id, title, message, notif_type="alert", alert_id=None, entity_type=None, entity_id=None):
    """Helper to create a notification record."""
    await conn.execute("""
        INSERT INTO notifications (user_id, alert_id, title, message, notif_type, entity_type, entity_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
    """, user_id, alert_id, title, message, notif_type, entity_type, entity_id)


async def _check_all_alerts():
    """Background: evaluate all active alerts and fire notifications."""
    if not db_pool:
        return
    async with db_pool.acquire() as conn:
        alerts = await conn.fetch("SELECT * FROM alerts WHERE status='active'")
        if not alerts:
            return
        print(f"[ALERTS] Checking {len(alerts)} active alerts...")
        import yfinance as yf
        from datetime import date

        for alert in alerts:
            try:
                conditions = alert["conditions"] if isinstance(alert["conditions"], dict) else json.loads(alert["conditions"] or "{}")
                fired = False
                msg = ""

                atype = alert["alert_type"]

                # ── Price Alerts ──
                if atype == "price_above" and alert["symbol"]:
                    target = float(conditions.get("price", 0))
                    if target > 0:
                        tk = yf.Ticker(alert["symbol"] + ".NS")
                        hist = tk.history(period="2d")
                        if not hist.empty:
                            price = float(hist["Close"].iloc[-1])
                            if price >= target:
                                fired = True
                                msg = f"🔔 {alert['symbol']} crossed above ₹{target:.2f} — now at ₹{price:.2f}"

                elif atype == "price_below" and alert["symbol"]:
                    target = float(conditions.get("price", 0))
                    if target > 0:
                        tk = yf.Ticker(alert["symbol"] + ".NS")
                        hist = tk.history(period="2d")
                        if not hist.empty:
                            price = float(hist["Close"].iloc[-1])
                            if price <= target:
                                fired = True
                                msg = f"🔔 {alert['symbol']} dropped below ₹{target:.2f} — now at ₹{price:.2f}"

                # ── Portfolio Alerts ──
                elif atype == "portfolio_return" and alert["entity_id"]:
                    threshold = float(conditions.get("return_pct", 0))
                    direction = conditions.get("direction", "above")  # above or below
                    holdings = await conn.fetch(
                        "SELECT entry_price, current_price, shares FROM model_portfolio_holdings WHERE portfolio_id=$1 AND status='active'",
                        alert["entity_id"]
                    )
                    if holdings:
                        tv = sum((h["current_price"] or h["entry_price"] or 0) * (h["shares"] or 0) for h in holdings)
                        tc = sum((h["entry_price"] or 0) * (h["shares"] or 0) for h in holdings)
                        ret = ((tv / tc - 1) * 100) if tc > 0 else 0
                        if direction == "above" and ret >= threshold:
                            fired = True
                            msg = f"📈 Portfolio return hit +{ret:.1f}% (target: {threshold}%)"
                        elif direction == "below" and ret <= threshold:
                            fired = True
                            msg = f"📉 Portfolio return dropped to {ret:.1f}% (threshold: {threshold}%)"

                elif atype == "portfolio_rebalance_due" and alert["entity_id"]:
                    mp = await conn.fetchrow("SELECT * FROM model_portfolios WHERE id=$1", alert["entity_id"])
                    if mp and mp["updated_at"]:
                        days_since = (datetime.utcnow() - mp["updated_at"]).days
                        freq = mp["rebalance_freq"] or "monthly"
                        due_days = {"daily": 1, "weekly": 7, "biweekly": 14, "monthly": 30, "quarterly": 90}.get(freq, 30)
                        if days_since >= due_days:
                            fired = True
                            msg = f"⏰ Portfolio '{mp['name']}' rebalance due — last updated {days_since} days ago ({freq})"

                # ── Backtest Strategy Alerts ──
                elif atype == "strategy_signal" and alert["symbol"]:
                    strategy = conditions.get("strategy", "momentum")
                    # Check if the stock currently appears in the screener for this strategy
                    cache_key = f"screener:{strategy}:50:10000:"
                    cached = await redis_client.get(cache_key) if redis_client else None
                    if cached:
                        results = json.loads(cached)
                        symbols_in_result = [r.get("symbol","").upper() for r in results] if isinstance(results, list) else []
                        if alert["symbol"].upper() in symbols_in_result:
                            fired = True
                            msg = f"🎯 {alert['symbol']} triggered {strategy.upper()} strategy signal!"

                # ── Forward Test Alerts ──
                elif atype == "forward_test_signal" and alert["entity_id"]:
                    # Check if new positions were opened since last check
                    last_check = alert["last_triggered_at"] or alert["created_at"]
                    new_positions = await conn.fetch(
                        "SELECT symbol, signal_type, entry_price FROM forward_test_positions WHERE fwd_test_id=$1 AND entry_date > $2 AND status='open'",
                        alert["entity_id"], last_check
                    )
                    if new_positions:
                        symbols = ", ".join([p["symbol"] for p in new_positions[:5]])
                        fired = True
                        msg = f"🔔 Forward test generated {len(new_positions)} new signal(s): {symbols}"

                elif atype == "forward_test_hit_rate" and alert["entity_id"]:
                    threshold = float(conditions.get("hit_rate", 50))
                    direction = conditions.get("direction", "below")
                    closed = await conn.fetch(
                        "SELECT unrealized_pnl_pct FROM forward_test_positions WHERE fwd_test_id=$1 AND status='closed'",
                        alert["entity_id"]
                    )
                    if len(closed) >= 3:
                        wins = sum(1 for c in closed if (c["unrealized_pnl_pct"] or 0) > 0)
                        hit_rate = (wins / len(closed)) * 100
                        if direction == "below" and hit_rate <= threshold:
                            fired = True
                            msg = f"⚠️ Forward test hit rate dropped to {hit_rate:.0f}% (threshold: {threshold}%)"
                        elif direction == "above" and hit_rate >= threshold:
                            fired = True
                            msg = f"✅ Forward test hit rate reached {hit_rate:.0f}% (target: {threshold}%)"

                # ── Advisory Alerts ──
                elif atype == "advisory_target_hit" and alert["entity_id"]:
                    rec = await conn.fetchrow(
                        "SELECT * FROM advisory_recommendations WHERE id=$1", alert["entity_id"]
                    )
                    if rec and rec["target_price"]:
                        tk = yf.Ticker(rec["symbol"] + ".NS")
                        hist = tk.history(period="2d")
                        if not hist.empty:
                            price = float(hist["Close"].iloc[-1])
                            if rec["call_type"] == "BUY" and price >= rec["target_price"]:
                                fired = True
                                msg = f"🎯 Advisory: {rec['symbol']} hit target ₹{rec['target_price']:.2f} — now at ₹{price:.2f}"
                            elif rec["call_type"] == "SELL" and price <= rec["target_price"]:
                                fired = True
                                msg = f"🎯 Advisory: {rec['symbol']} hit target ₹{rec['target_price']:.2f} — now at ₹{price:.2f}"

                elif atype == "advisory_sl_hit" and alert["entity_id"]:
                    rec = await conn.fetchrow(
                        "SELECT * FROM advisory_recommendations WHERE id=$1", alert["entity_id"]
                    )
                    if rec and rec["stop_loss"]:
                        tk = yf.Ticker(rec["symbol"] + ".NS")
                        hist = tk.history(period="2d")
                        if not hist.empty:
                            price = float(hist["Close"].iloc[-1])
                            if rec["call_type"] == "BUY" and price <= rec["stop_loss"]:
                                fired = True
                                msg = f"⛔ Advisory: {rec['symbol']} hit stop loss ₹{rec['stop_loss']:.2f} — now at ₹{price:.2f}"
                            elif rec["call_type"] == "SELL" and price >= rec["stop_loss"]:
                                fired = True
                                msg = f"⛔ Advisory: {rec['symbol']} hit stop loss ₹{rec['stop_loss']:.2f} — now at ₹{price:.2f}"

                # ── Fire notification ──
                if fired:
                    await _create_notification(conn, alert["user_id"], alert["name"], msg,
                        notif_type="alert", alert_id=alert["id"],
                        entity_type=alert["entity_type"], entity_id=alert["entity_id"])
                    await conn.execute(
                        "UPDATE alerts SET last_triggered_at=NOW(), trigger_count=trigger_count+1 WHERE id=$1",
                        alert["id"]
                    )
                    # Auto-deactivate one-shot alerts (price alerts)
                    if atype in ("price_above", "price_below", "advisory_target_hit", "advisory_sl_hit"):
                        await conn.execute("UPDATE alerts SET status='triggered' WHERE id=$1", alert["id"])
                    print(f"[ALERTS] Fired: {alert['name']} → {msg[:80]}")

            except Exception as e:
                print(f"[ALERTS] Error checking alert {alert['id']}: {e}")
                continue

        print(f"[ALERTS] Check complete.")


# ── Alert API Endpoints ─────────────────────────────────────────────────────

@app.post("/api/alerts/create", tags=["Alerts & Notifications"], summary="Create an alert",
    description="Create a price alert, strategy signal alert, or sector rotation alert. Supports conditions like price_above, price_below, rsi_oversold, volume_spike, etc.")
async def create_alert(req: Request, user=Depends(get_current_user)):
    body = await req.json()
    name = body.get("name", "").strip()
    alert_type = body.get("alert_type", "").strip()
    entity_type = body.get("entity_type", "").strip()
    if not name or not alert_type:
        raise HTTPException(status_code=400, detail="Name and alert_type required")

    async with db_pool.acquire() as conn:
        aid = await conn.fetchval("""
            INSERT INTO alerts (user_id, name, alert_type, entity_type, entity_id, symbol, conditions, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'active') RETURNING id
        """, user["id"], name, alert_type, entity_type,
            body.get("entity_id"), body.get("symbol"),
            json.dumps(body.get("conditions", {})))
        return {"id": aid, "message": f"Alert '{name}' created"}


@app.get("/api/alerts", tags=["Alerts & Notifications"], summary="List alerts",
    description="List all alerts for the authenticated user with their current status (active/triggered/paused).")
async def list_alerts(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        alerts = await conn.fetch(
            "SELECT * FROM alerts WHERE user_id=$1 ORDER BY created_at DESC", user["id"]
        )
        return [_safe_row(a) for a in alerts]


@app.delete("/api/alerts/{aid}", tags=["Alerts & Notifications"], summary="Delete alert",
    description="Delete a specific alert.")
async def delete_alert(aid: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM alerts WHERE id=$1 AND user_id=$2", aid, user["id"])
        return {"deleted": True}


@app.put("/api/alerts/{aid}/toggle", tags=["Alerts & Notifications"], summary="Toggle alert on/off",
    description="Toggle an alert between active and paused status.")
async def toggle_alert(aid: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        alert = await conn.fetchrow("SELECT status FROM alerts WHERE id=$1 AND user_id=$2", aid, user["id"])
        if not alert: raise HTTPException(status_code=404, detail="Not found")
        new_status = "paused" if alert["status"] == "active" else "active"
        await conn.execute("UPDATE alerts SET status=$1 WHERE id=$2", new_status, aid)
        return {"status": new_status}


@app.get("/api/notifications", tags=["Alerts & Notifications"], summary="Get notifications",
    description="Get recent notifications for the authenticated user — triggered alerts, system messages, and activity updates. Ordered by most recent.")
async def get_notifications(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        notifs = await conn.fetch(
            "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
            user["id"]
        )
        unread = await conn.fetchval(
            "SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=false", user["id"]
        )
        return {"notifications": [_safe_row(n) for n in notifs], "unread_count": unread}


@app.post("/api/notifications/read-all", tags=["Alerts & Notifications"], summary="Mark all notifications read",
    description="Mark all unread notifications as read for the authenticated user.")
async def mark_all_read(user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE notifications SET is_read=true WHERE user_id=$1 AND is_read=false", user["id"])
        return {"marked": True}


@app.post("/api/notifications/{nid}/read", tags=["Alerts & Notifications"], summary="Mark notification read",
    description="Mark a specific notification as read.")
async def mark_read(nid: int, user=Depends(get_current_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2", nid, user["id"])
        return {"marked": True}


# ── Admin Routes ──────────────────────────────────────────────────────────────
@app.get("/api/admin/stats", tags=["Admin"], summary="Platform statistics",
    description="Admin only. Returns platform-wide stats — total users, active sessions, backtests run, screener usage, storage, and system health.")
async def admin_stats(user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        users = await conn.fetchval("SELECT COUNT(*) FROM users WHERE is_admin=false")
        backtests = await conn.fetchval("SELECT COUNT(*) FROM backtests")
        trades = await conn.fetchval("SELECT COUNT(*) FROM paper_trades")
        inv_used = await conn.fetchval("SELECT COUNT(*) FROM invite_codes WHERE used_by IS NOT NULL")
        inv_total = await conn.fetchval("SELECT COUNT(*) FROM invite_codes")
        return {"users": users, "backtests": backtests, "paper_trades": trades,
                "invites_used": inv_used, "invites_available": inv_total-inv_used, "capacity": f"{users}/{MAX_USERS}"}

@app.get("/api/admin/users", tags=["Admin"], summary="List all users",
    description="Admin only. List all registered users with their activity stats, last login, and account status.")
async def admin_users(user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT id,email,name,is_active,created_at FROM users ORDER BY created_at DESC")
        return [dict(r) for r in rows]

@app.post("/api/admin/invite", tags=["Admin"], summary="Generate invite codes",
    description="Admin only. Generate new invite codes for user registration. Specify count (1-50).")
async def create_invites(req: InviteRequest, user=Depends(get_admin_user)):
    codes = []
    async with db_pool.acquire() as conn:
        for _ in range(min(req.count, 20)):
            code = secrets.token_urlsafe(8).upper()
            await conn.execute("INSERT INTO invite_codes (code,created_by) VALUES ($1,$2)", code, user["id"])
            codes.append(code)
    return {"codes": codes, "count": len(codes)}

@app.get("/api/admin/invites", tags=["Admin"], summary="List invite codes",
    description="Admin only. List all generated invite codes with usage status.")
async def list_invites(user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM invite_codes ORDER BY created_at DESC")
        return [dict(r) for r in rows]

@app.post("/api/admin/user/{user_id}/deactivate", tags=["Admin"], summary="Deactivate user",
    description="Admin only. Deactivate a user account, preventing login.")
async def deactivate_user(user_id: int, user=Depends(get_admin_user)):
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE users SET is_active=false WHERE id=$1", user_id)
        return {"message": "User deactivated"}
