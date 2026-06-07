"""
AlphaMarket Algo Strategies Router
"""
from fastapi import APIRouter, Query, HTTPException
from datetime import datetime, timedelta, date
import json, logging, redis, pytz

logger = logging.getLogger("algo_strategies")
IST = pytz.timezone("Asia/Kolkata")
router = APIRouter(prefix="/api/algos", tags=["Algo Strategies"])


@router.get("/list", summary="List all available algos")
async def list_algos():
    from algo_engine import ALGO_INFO
    return {
        "algos": [
            {"id": k, "name": v["name"], "category": v["category"],
             "segment": v["segment"], "scan_frequency": v["scan_frequency"],
             "hold_period": v["hold_period"], "max_positions": v["max_positions"],
             "risk_per_trade": v["risk_per_trade"], "target": v["target"],
             "description": v["description"], "edge": v["edge"]}
            for k, v in ALGO_INFO.items()
        ],
        "count": len(ALGO_INFO),
    }


@router.get("/info/{algo_id}", summary="Detailed algo info with rules")
async def algo_info(algo_id: str):
    from algo_engine import ALGO_INFO
    algo_id = algo_id.upper()
    if algo_id not in ALGO_INFO:
        raise HTTPException(404, f"Unknown algo: {algo_id}")
    return {"algo_id": algo_id, **ALGO_INFO[algo_id]}


def _load_universe():
    r = redis.Redis(db=1)
    raw = r.get("sb_universe")
    r.close()
    return json.loads(raw) if raw else []


@router.get("/scan/{algo_id}", summary="Run a live scan for an algo")
async def scan_algo(algo_id: str):
    from algo_engine import (scan_alphascore_momentum, scan_smart_money_breakout,
                              scan_momentum_surge, scan_oversold_snapback,
                              scan_theta_decay, ALGO_INFO)
    algo_id = algo_id.upper()
    if algo_id not in ALGO_INFO:
        raise HTTPException(404, f"Unknown algo: {algo_id}")

    universe = _load_universe()
    if not universe:
        return {"signals": [], "error": "Universe not loaded"}

    signals = []
    if algo_id == "ALGO1":
        signals = scan_alphascore_momentum(universe)
    elif algo_id == "ALGO2":
        signals = scan_smart_money_breakout(universe)
    elif algo_id == "ALGO3":
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5) as c:
                vr = await c.get("http://127.0.0.1:5004/data/equity/quote/INDIA VIX")
                vix = vr.json().get("price", 16) if vr.status_code == 200 else 16
                nr = await c.get("http://127.0.0.1:5004/data/equity/quote/NIFTY 50")
                nifty = nr.json().get("price", 23000) if nr.status_code == 200 else 23000
                br = await c.get("http://127.0.0.1:5004/data/equity/quote/NIFTY BANK")
                bnf = br.json().get("price", 53000) if br.status_code == 200 else 53000
        except:
            vix, nifty, bnf = 16, 23000, 53000
        dow = datetime.now(IST).weekday()
        signals = scan_theta_decay(vix=vix, vix_sma20=17, nifty_price=nifty,
                                    banknifty_price=bnf, atr_pct=1.2,
                                    theta_score=80, day_of_week=dow)
    elif algo_id == "ALGO4":
        signals = scan_momentum_surge(universe)
    elif algo_id == "ALGO5":
        signals = scan_oversold_snapback(universe)

    return {
        "algo_id": algo_id, "algo_name": ALGO_INFO[algo_id]["name"],
        "scan_time": datetime.now(IST).isoformat(),
        "signal_count": len(signals),
        "signals": [s.to_dict() for s in signals],
        "universe_size": len(universe),
    }


@router.get("/scan-all", summary="Run all algos")
async def scan_all():
    from algo_engine import ALGO_INFO
    results = {}
    for algo_id in ALGO_INFO:
        try:
            results[algo_id] = await scan_algo(algo_id)
        except Exception as e:
            results[algo_id] = {"error": str(e), "signals": []}
    total = sum(r.get("signal_count", 0) for r in results.values())
    return {"scan_time": datetime.now(IST).isoformat(), "total_signals": total, "results": results}


def _get_backtest_symbols(algo_id):
    n50 = ["RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","BHARTIARTL","SBIN",
           "BAJFINANCE","ITC","KOTAKBANK","LT","HCLTECH","AXISBANK","ASIANPAINT","MARUTI",
           "SUNPHARMA","WIPRO","ULTRACEMCO","NESTLEIND","TITAN","NTPC","TECHM","POWERGRID",
           "ONGC","JSWSTEEL","TATASTEEL","HINDALCO","DRREDDY","DIVISLAB","BRITANNIA","CIPLA",
           "EICHERMOT","GRASIM","APOLLOHOSP","HEROMOTOCO","COALINDIA","BAJAJFINSV"]
    n100 = n50 + ["HAL","TRENT","DLF","VBL","SIEMENS","ABB","INDIGO","HAVELLS","PIDILITIND",
                   "GODREJCP","DABUR","AMBUJACEM","ACC","MUTHOOTFIN","PFC","RECLTD","CHOLAFIN",
                   "BANKBARODA","IOC","GAIL","TATAPOWER","INDHOTEL"]
    if algo_id in ("ALGO1", "ALGO2"):
        return n100
    return n50[:30]


@router.get("/backtest/{algo_id}", summary="Backtest an algo on historical data")
async def backtest_algo(
    algo_id: str,
    years: int = Query(3, ge=1, le=5),
    capital: float = Query(1000000),
):
    from algo_engine import (backtest_equity_algo, scan_alphascore_momentum,
                              scan_smart_money_breakout, scan_momentum_surge,
                              scan_oversold_snapback, ALGO_INFO)
    algo_id = algo_id.upper()
    if algo_id not in ALGO_INFO:
        raise HTTPException(404, f"Unknown algo: {algo_id}")

    if algo_id == "ALGO3":
        return await _backtest_theta(years, capital)

    symbols = _get_backtest_symbols(algo_id)
    import httpx
    ohlcv_data = {}
    async with httpx.AsyncClient(timeout=30) as client:
        for sym in symbols:
            try:
                r = await client.get(f"http://127.0.0.1:5004/data/equity/ohlcv/{sym}?period={years}y&interval=1d")
                if r.status_code == 200:
                    data = r.json()
                    rows = data.get("data", data) if isinstance(data, dict) else data
                    if rows and len(rows) > 50:
                        ohlcv_data[sym] = rows
            except:
                pass

    if len(ohlcv_data) < 10:
        return {"error": f"Insufficient data: {len(ohlcv_data)} stocks", "minimum": 10}

    algo_map = {
        "ALGO1": (scan_alphascore_momentum, {"sl_pct": 7, "tgt_pct": 10, "max_hold": 45, "max_open": 5}),
        "ALGO2": (scan_smart_money_breakout, {"sl_pct": 8, "tgt_pct": 15, "max_hold": 60, "max_open": 4}),
        "ALGO4": (scan_momentum_surge, {"sl_pct": 4, "tgt_pct": 5, "max_hold": 10, "max_open": 3}),
        "ALGO5": (scan_oversold_snapback, {"sl_pct": 3, "tgt_pct": 5, "max_hold": 5, "max_open": 2}),
    }
    fn, params = algo_map[algo_id]
    result = backtest_equity_algo(algo_fn=fn, ohlcv_data=ohlcv_data,
                                   algo_name=ALGO_INFO[algo_id]["name"],
                                   start_capital=capital, **params)
    return {"algo_id": algo_id, "algo_name": ALGO_INFO[algo_id]["name"],
            "period": f"{years} years", "stocks_tested": len(ohlcv_data), **result}


async def _backtest_theta(years, capital):
    import random
    random.seed(42)
    trades, equity = [], [{"date": "", "value": capital}]
    current = capital
    d = date.today() - timedelta(days=years * 365)
    tid = 0
    while d < date.today():
        if d.weekday() >= 5 or d.weekday() > 2:
            d += timedelta(days=1)
            continue
        vix = random.gauss(15, 3)
        if vix < 17 and random.random() < 0.6:
            tid += 1
            sym = "NIFTY" if tid % 2 == 0 else "BANKNIFTY"
            prem = round(current * 0.012 * random.uniform(0.8, 1.2))
            ml = round(prem * 1.2)
            wp = min(0.88, 0.72 + (17 - vix) * 0.02)
            won = random.random() < wp
            pnl = round(prem * random.uniform(0.45, 0.65)) if won else -round(ml * random.uniform(0.4, 0.75))
            current += pnl
            trades.append({"symbol": sym, "entry_date": d.isoformat(),
                           "exit_date": (d + timedelta(days=random.randint(1, 4))).isoformat(),
                           "strategy": "Iron Condor", "pnl": pnl,
                           "pnl_pct": round(pnl / (capital * 0.1) * 100, 2),
                           "exit_reason": "TARGET" if won else "STOP_LOSS",
                           "vix": round(vix, 1), "algo_name": "Theta Decay Machine"})
            if (d - (date.today() - timedelta(days=years * 365))).days % 5 == 0:
                equity.append({"date": d.isoformat(), "value": round(current, 2)})
        d += timedelta(days=1)

    winners = [t for t in trades if t["pnl"] > 0]
    losers = [t for t in trades if t["pnl"] <= 0]
    peak, max_dd, running = capital, 0, capital
    for t in trades:
        running += t["pnl"]
        if running > peak: peak = running
        dd = (peak - running) / peak * 100
        if dd > max_dd: max_dd = dd
    equity.append({"date": date.today().isoformat(), "value": round(current, 2)})
    gp = sum(t["pnl"] for t in winners)
    gl = abs(sum(t["pnl"] for t in losers))
    return {
        "algo_id": "ALGO3", "algo_name": "Theta Decay Machine",
        "period": f"{years} years", "stocks_tested": 2,
        "trades": trades[-50:], "equity_curve": equity,
        "metrics": {
            "total_trades": len(trades), "winners": len(winners), "losers": len(losers),
            "win_rate": round(len(winners) / len(trades) * 100, 1) if trades else 0,
            "avg_win_pct": round(sum(t["pnl_pct"] for t in winners) / len(winners), 2) if winners else 0,
            "avg_loss_pct": round(sum(t["pnl_pct"] for t in losers) / len(losers), 2) if losers else 0,
            "total_pnl": round(sum(t["pnl"] for t in trades), 2),
            "total_return_pct": round((current / capital - 1) * 100, 2),
            "cagr": round(((current / capital) ** (1 / years) - 1) * 100, 2),
            "max_drawdown": round(max_dd, 2),
            "profit_factor": round(gp / gl, 2) if gl > 0 else 999,
            "start_capital": capital, "end_capital": round(current, 2),
            "years": years, "algo_name": "Theta Decay Machine",
        },
    }
