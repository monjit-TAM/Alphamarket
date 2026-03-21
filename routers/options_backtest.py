from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import date, datetime, timedelta
import asyncpg, os, math, asyncio, pandas as pd, numpy as np

router = APIRouter(prefix="/api/options-backtest", tags=["Options Backtest"])

KITE_API_KEY = os.getenv("KITE_API_KEY", "wmwpq34kw5th0y2l")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://dyor_user:DyorSecure2026Mar@localhost:5432/dyor_db")

UNDERLYING_CONFIG = {
    "NIFTY":     {"lot_size": 25,  "strike_interval": 50,  "token": 256265},
    "BANKNIFTY": {"lot_size": 15,  "strike_interval": 100, "token": 260105},
    "FINNIFTY":  {"lot_size": 40,  "strike_interval": 50,  "token": 257801},
    "MIDCPNIFTY":{"lot_size": 75,  "strike_interval": 25,  "token": 288009},
    "SENSEX":    {"lot_size": 10,  "strike_interval": 100, "token": 265},
}

# ── Module-level Kite cache ───────────────────────────────────────────────────
_instruments_cache: Optional[pd.DataFrame] = None
_instruments_loaded: Optional[date] = None
_kite_session = None

async def _get_kite_token() -> str:
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        import json as _json
        row = await conn.fetchrow("SELECT value FROM api_settings WHERE key='kite_token'")
        await conn.close()
        if row:
            data = _json.loads(row["value"])
            return data.get("access_token", "")
    except: pass
    return ""

async def _load_instruments():
    global _instruments_cache, _instruments_loaded
    today = date.today()
    if _instruments_loaded == today and _instruments_cache is not None:
        return _instruments_cache
    try:
        import urllib.request, io
        token = await _get_kite_token()
        if not token: return None
        req = urllib.request.Request(
            "https://api.kite.trade/instruments/NFO",
            headers={"X-Kite-Version": "3", "Authorization": f"token {KITE_API_KEY}:{token}"}
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            df = pd.read_csv(io.StringIO(r.read().decode()))
        _instruments_cache = df
        _instruments_loaded = today
        return df
    except Exception as e:
        print(f"[DYOR optbt] instruments load failed: {e}")
        return None

def _bs_price(S, K, T, r, sigma, opt_type):
    if T <= 0 or sigma <= 0: return max(0, S-K) if opt_type=="CE" else max(0, K-S)
    from math import log, sqrt, exp
    try:
        from scipy.stats import norm
        d1 = (log(S/K) + (r + 0.5*sigma**2)*T) / (sigma*sqrt(T))
        d2 = d1 - sigma*sqrt(T)
        if opt_type == "CE": return S*norm.cdf(d1) - K*exp(-r*T)*norm.cdf(d2)
        else: return K*exp(-r*T)*norm.cdf(-d2) - S*norm.cdf(-d1)
    except:
        intrinsic = max(0, S-K) if opt_type=="CE" else max(0, K-S)
        return intrinsic + sigma*S*math.sqrt(T)*0.4

def _get_expiries(underlying: str, expiry_type: str, from_date: date, to_date: date) -> List[date]:
    expiries = []
    d = from_date
    while d <= to_date + timedelta(days=7):
        if expiry_type == "weekly":
            # Every Thursday
            days_ahead = 3 - d.weekday()
            if days_ahead <= 0: days_ahead += 7
            exp = d + timedelta(days=days_ahead)
        else:
            # Last Thursday of month
            import calendar
            last_day = calendar.monthrange(d.year, d.month)[1]
            last_date = date(d.year, d.month, last_day)
            days_back = (last_date.weekday() - 3) % 7
            exp = last_date - timedelta(days=days_back)
            if exp < d:
                if d.month == 12: exp_month = date(d.year+1, 1, 1)
                else: exp_month = date(d.year, d.month+1, 1)
                last_day = __import__('calendar').monthrange(exp_month.year, exp_month.month)[1]
                last_date = date(exp_month.year, exp_month.month, last_day)
                days_back = (last_date.weekday() - 3) % 7
                exp = last_date - timedelta(days=days_back)
        if exp not in expiries and exp >= from_date:
            expiries.append(exp)
        d = exp + timedelta(days=1)
    return sorted(set(expiries))

def _atm_strike(spot: float, interval: int) -> int:
    return int(round(spot / interval) * interval)

def _get_signals(ohlcv: pd.DataFrame, strategy: str, params: Dict) -> pd.Series:
    df = ohlcv.copy()
    sig = pd.Series(0, index=df.index)
    try:
        if strategy == "EMA_CROSSOVER":
            f, s = int(params.get("fast_ema",9)), int(params.get("slow_ema",21))
            fast = df["Close"].ewm(span=f).mean()
            slow = df["Close"].ewm(span=s).mean()
            sig[(fast > slow) & (fast.shift(1) <= slow.shift(1))] = 1
            sig[(fast < slow) & (fast.shift(1) >= slow.shift(1))] = -1
        elif strategy == "SMA_CROSSOVER":
            f, s = int(params.get("fast_sma",20)), int(params.get("slow_sma",50))
            fast = df["Close"].rolling(f).mean()
            slow = df["Close"].rolling(s).mean()
            sig[(fast > slow) & (fast.shift(1) <= slow.shift(1))] = 1
            sig[(fast < slow) & (fast.shift(1) >= slow.shift(1))] = -1
        elif strategy == "RSI":
            period = int(params.get("rsi_period",14))
            ob, os_ = float(params.get("overbought",65)), float(params.get("oversold",35))
            delta = df["Close"].diff()
            gain = delta.clip(lower=0).rolling(period).mean()
            loss = (-delta.clip(upper=0)).rolling(period).mean()
            rs = gain / loss.replace(0, 1e-9)
            rsi = 100 - (100/(1+rs))
            sig[(rsi < os_) & (rsi.shift(1) >= os_)] = 1
            sig[(rsi > ob) & (rsi.shift(1) <= ob)] = -1
        elif strategy == "MACD":
            f = int(params.get("fast",12)); s = int(params.get("slow",26)); sig_p = int(params.get("signal",9))
            macd = df["Close"].ewm(span=f).mean() - df["Close"].ewm(span=s).mean()
            signal_line = macd.ewm(span=sig_p).mean()
            sig[(macd > signal_line) & (macd.shift(1) <= signal_line.shift(1))] = 1
            sig[(macd < signal_line) & (macd.shift(1) >= signal_line.shift(1))] = -1
        elif strategy == "SUPERTREND":
            period = int(params.get("period",10)); mult = float(params.get("multiplier",3.0))
            hl2 = (df["High"] + df["Low"]) / 2
            atr = (df["High"] - df["Low"]).rolling(period).mean()
            upper = hl2 + mult * atr; lower = hl2 - mult * atr
            st = pd.Series(index=df.index, dtype=float)
            trend = pd.Series(1, index=df.index)
            for i in range(1, len(df)):
                if df["Close"].iloc[i] > upper.iloc[i-1]: trend.iloc[i] = 1
                elif df["Close"].iloc[i] < lower.iloc[i-1]: trend.iloc[i] = -1
                else: trend.iloc[i] = trend.iloc[i-1]
            sig[(trend == 1) & (trend.shift(1) == -1)] = 1
            sig[(trend == -1) & (trend.shift(1) == 1)] = -1
        elif strategy == "BOLLINGER":
            period = int(params.get("period",20)); std = float(params.get("std",2.0))
            ma = df["Close"].rolling(period).mean()
            band = df["Close"].rolling(period).std() * std
            upper = ma + band; lower = ma - band
            sig[(df["Close"] < lower) & (df["Close"].shift(1) >= lower.shift(1))] = 1
            sig[(df["Close"] > upper) & (df["Close"].shift(1) <= upper.shift(1))] = -1
        elif strategy == "VWAP_REVERSION":
            vwap = (df["Close"] * df["Volume"]).cumsum() / df["Volume"].cumsum()
            sig[(df["Close"] > vwap) & (df["Close"].shift(1) <= vwap.shift(1))] = 1
            sig[(df["Close"] < vwap) & (df["Close"].shift(1) >= vwap.shift(1))] = -1
    except Exception as e:
        print(f"Signal error: {e}")
    return sig

async def _fetch_kite_ohlcv(token: int, from_date: date, to_date: date, access_token: str) -> Optional[pd.DataFrame]:
    try:
        import urllib.request
        url = f"https://api.kite.trade/instruments/historical/{token}/day?from={from_date}&to={to_date}&continuous=0"
        req = urllib.request.Request(url, headers={"X-Kite-Version":"3","Authorization":f"token {KITE_API_KEY}:{access_token}"})
        with urllib.request.urlopen(req, timeout=20) as r:
            import json; data = json.loads(r.read())
        candles = data.get("data",{}).get("candles",[])
        if not candles: return None
        df = pd.DataFrame(candles, columns=["Date","Open","High","Low","Close","Volume","OI"])
        df["Date"] = pd.to_datetime(df["Date"]).dt.date
        df.set_index("Date", inplace=True)
        return df
    except: return None

async def _fetch_option_price_kite(symbol: str, expiry: date, strike: int, opt_type: str,
                                    entry_date: date, exit_date: date, access_token: str,
                                    instruments: Optional[pd.DataFrame]) -> tuple:
    if instruments is None: return None, None, "black_scholes"
    try:
        yy = str(expiry.year)[2:]; mm = expiry.month; dd = expiry.day
        sym1 = f"{symbol}{yy}{mm}{dd:02d}{strike}{opt_type}"
        sym2 = f"{symbol}{yy}{mm}{dd}{strike}{opt_type}"
        nfo = instruments[instruments["name"]==symbol]
        nfo = nfo[(nfo["instrument_type"]==opt_type) & (nfo["strike"]==float(strike))]
        nfo["expiry_date"] = pd.to_datetime(nfo["expiry"]).dt.date
        row = nfo[nfo["expiry_date"]==expiry]
        if row.empty: return None, None, "black_scholes"
        token = int(row.iloc[0]["instrument_token"])
        df = await _fetch_kite_ohlcv(token, entry_date, exit_date, access_token)
        if df is None or df.empty: return None, None, "black_scholes"
        entry_rows = df[df.index >= entry_date]
        exit_rows = df[df.index <= exit_date]
        if entry_rows.empty or exit_rows.empty: return None, None, "black_scholes"
        return float(entry_rows.iloc[0]["Close"]), float(exit_rows.iloc[-1]["Close"]), "kite"
    except Exception as e:
        print(f"Kite option price error: {e}")
        return None, None, "black_scholes"

class BacktestRequest(BaseModel):
    underlying: str = "NIFTY"
    strategy: str = "EMA_CROSSOVER"
    from_date: str = ""
    to_date: str = ""
    option_type: str = "BOTH"
    expiry_type: str = "weekly"
    exit_rule: str = "target_sl"
    target_pct: float = 50.0
    sl_pct: float = 30.0
    exit_dte: int = 1
    lots: int = 1
    params: Dict[str, Any] = {}

@router.post("/run")
async def run_backtest(req: BacktestRequest):
    underlying = req.underlying.upper()
    if underlying not in UNDERLYING_CONFIG:
        raise HTTPException(400, f"Unknown underlying: {underlying}")
    cfg = UNDERLYING_CONFIG[underlying]
    lot_size = cfg["lot_size"]
    interval = cfg["strike_interval"]
    from_date = date.fromisoformat(req.from_date) if req.from_date else date.today() - timedelta(days=180)
    to_date = date.fromisoformat(req.to_date) if req.to_date else date.today()

    access_token = await _get_kite_token()
    instruments = await _load_instruments()

    # Fetch underlying OHLCV
    ohlcv = None
    if access_token:
        ohlcv = await _fetch_kite_ohlcv(cfg["token"], from_date, to_date, access_token)
    if ohlcv is None or ohlcv.empty:
        raise HTTPException(500, "Could not fetch underlying OHLCV data")

    signals = _get_signals(ohlcv, req.strategy, req.params)
    expiries = _get_expiries(underlying, req.expiry_type, from_date, to_date)
    hv_series = ohlcv["Close"].pct_change().rolling(20).std() * math.sqrt(252)

    trades = []
    equity = 0.0
    equity_curve = []
    kite_count = 0

    signal_dates = signals[signals != 0].index.tolist()

    for sig_date in signal_dates:
        sig_val = signals[sig_date]
        if req.option_type == "CE" and sig_val != 1: continue
        if req.option_type == "PE" and sig_val != -1: continue
        opt_type = "CE" if sig_val == 1 else "PE"

        valid_expiries = [e for e in expiries if e > sig_date]
        if not valid_expiries: continue
        expiry = valid_expiries[0]
        dte = (expiry - sig_date).days

        spot_rows = ohlcv[ohlcv.index >= sig_date]
        if spot_rows.empty: continue
        spot = float(spot_rows.iloc[0]["Close"])
        strike = _atm_strike(spot, interval)

        hv = float(hv_series.get(sig_date, 0.15) or 0.15)

        # Try Kite price first
        exit_date_max = expiry - timedelta(days=req.exit_dte) if req.exit_rule == "dte" else expiry
        entry_p, exit_p, src = await _fetch_option_price_kite(
            underlying, expiry, strike, opt_type, sig_date, exit_date_max, access_token, instruments)

        if entry_p is None:
            # Black-Scholes fallback
            T_entry = dte / 365
            T_exit = max(1, dte // 2) / 365
            entry_p = _bs_price(spot, strike, T_entry, 0.065, hv, opt_type)
            exit_p = _bs_price(spot * (1 + (0.02 if opt_type=="CE" else -0.02)),
                               strike, T_exit, 0.065, hv * 0.9, opt_type)
            src = "black_scholes"
        else:
            kite_count += 1

        if entry_p <= 0: entry_p = 1.0
        if exit_p <= 0: exit_p = 0.1

        # Apply exit rules
        if req.exit_rule == "target_sl":
            target_p = entry_p * (1 + req.target_pct/100)
            sl_p = entry_p * (1 - req.sl_pct/100)
            if exit_p >= target_p: exit_p = target_p; reason = "target"
            elif exit_p <= sl_p: exit_p = sl_p; reason = "stop_loss"
            else: reason = "expiry"
        elif req.exit_rule == "dte":
            reason = "dte_exit"
        else:
            reason = "signal_exit"

        pnl_pts = round(exit_p - entry_p, 2)
        pnl_rs = round(pnl_pts * lot_size * req.lots, 2)
        pnl_pct = round((pnl_pts / entry_p) * 100, 1)
        equity += pnl_rs

        exit_dt = exit_date_max if src == "kite" else (sig_date + timedelta(days=max(1, dte//2)))

        trades.append({
            "entry_date": str(sig_date), "exit_date": str(exit_dt),
            "signal": "BUY" if sig_val==1 else "SELL",
            "option_type": opt_type, "strike": strike,
            "expiry": str(expiry), "dte_at_entry": dte,
            "entry_premium": round(entry_p, 2), "exit_premium": round(exit_p, 2),
            "pnl_pts": pnl_pts, "pnl_rs": pnl_rs, "pnl_pct": pnl_pct,
            "exit_reason": reason, "data_source": src,
            "cumulative_pnl": round(equity, 2)
        })
        equity_curve.append({"date": str(exit_dt), "pnl": round(equity, 2)})

    # Metrics
    n = len(trades)
    wins = [t for t in trades if t["pnl_rs"] > 0]
    losses = [t for t in trades if t["pnl_rs"] <= 0]
    win_rate = round(len(wins)/n*100, 1) if n else 0
    avg_win = round(sum(t["pnl_rs"] for t in wins)/len(wins), 0) if wins else 0
    avg_loss = round(sum(t["pnl_rs"] for t in losses)/len(losses), 0) if losses else 0
    rr = round(abs(avg_win/avg_loss), 2) if avg_loss else 0
    total_pnl = round(sum(t["pnl_rs"] for t in trades), 2)
    # Max drawdown
    peak = 0; max_dd = 0; running = 0
    for t in trades:
        running += t["pnl_rs"]
        if running > peak: peak = running
        dd = peak - running
        if dd > max_dd: max_dd = dd
    days = (to_date - from_date).days or 1
    cagr = round(((1 + total_pnl/max(1,abs(total_pnl)+10000))**(365/days)-1)*100, 1) if total_pnl else 0
    kite_pct = round(kite_count/n*100, 1) if n else 0

    return {
        "underlying": underlying, "strategy": req.strategy,
        "from_date": str(from_date), "to_date": str(to_date),
        "trades": trades, "equity_curve": equity_curve,
        "metrics": {
            "total_trades": n, "win_rate": win_rate,
            "total_pnl_rs": total_pnl, "avg_win_rs": avg_win,
            "avg_loss_rs": avg_loss, "rr_ratio": rr,
            "max_drawdown_rs": round(max_dd, 2), "cagr_pct": cagr,
            "kite_data_pct": kite_pct, "bs_fallback_pct": round(100-kite_pct, 1)
        }
    }

@router.get("/strategies")
async def get_strategies():
    return {"strategies": [
        {"id":"EMA_CROSSOVER","name":"EMA Crossover","params":["fast_ema","slow_ema"]},
        {"id":"SMA_CROSSOVER","name":"SMA Crossover","params":["fast_sma","slow_sma"]},
        {"id":"RSI","name":"RSI Reversal","params":["rsi_period","overbought","oversold"]},
        {"id":"MACD","name":"MACD Signal","params":["fast","slow","signal"]},
        {"id":"SUPERTREND","name":"Supertrend","params":["period","multiplier"]},
        {"id":"BOLLINGER","name":"Bollinger Bands","params":["period","std"]},
        {"id":"VWAP_REVERSION","name":"VWAP Reversion","params":[]}
    ]}

@router.get("/underlyings")
async def get_underlyings():
    return {"underlyings": list(UNDERLYING_CONFIG.keys())}

@router.get("/kite-data-check")
async def kite_data_check():
    instruments = await _load_instruments()
    if instruments is None:
        return {"kite_connected": False, "instruments_loaded": 0}
    nifty = instruments[instruments["name"]=="NIFTY"]
    return {"kite_connected": True, "instruments_loaded": len(instruments),
            "nifty_options": len(nifty[nifty["instrument_type"].isin(["CE","PE"])])}
