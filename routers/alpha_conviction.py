"""Alpha Conviction Engine + Intraday Levels Engine"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
import json, redis.asyncio as aioredis
from datetime import datetime, date
from services.data_service import af_bulk, ds_ohlcv

router = APIRouter(tags=["Alpha Conviction & Intraday"])

async def _enrich_live_prices(ideas):
    """Replace cached EOD prices with live quotes from Groww."""
    if not ideas: return ideas
    import httpx
    syms = list(set(i["symbol"] for i in ideas))
    live = {}
    async with httpx.AsyncClient(timeout=8) as client:
        for sym in syms:
            try:
                r = await client.get(f"http://127.0.0.1:5004/data/equity/quote/{sym}")
                if r.status_code == 200:
                    d = r.json()
                    if d.get("price") and d["price"] > 0:
                        live[sym] = float(d["price"])
            except: pass
    for idea in ideas:
        sym = idea["symbol"]
        if sym in live and idea.get("entry", 0) > 0:
            old_price = idea["entry"]
            new_price = live[sym]
            ratio = new_price / old_price if old_price > 0 else 1
            idea["entry"] = round(new_price, 2)
            idea["price"] = round(new_price, 2)
            idea["target"] = round(idea["target"] * ratio, 2)
            idea["stop"] = round(idea["stop"] * ratio, 2)
            idea["risk_pct"] = round((idea["entry"] - idea["stop"]) / idea["entry"] * 100, 1) if idea["entry"] > idea["stop"] else idea.get("risk_pct", 5)
            idea["reward_pct"] = round((idea["target"] - idea["entry"]) / idea["entry"] * 100, 1)
            idea["rr_ratio"] = round(idea["reward_pct"] / idea["risk_pct"], 1) if idea["risk_pct"] > 0 else 0
    return ideas

def _sf(v):
    if v is None: return None
    try: return float(v)
    except: return None

def _score_trend(s):
    score = 0
    if s.get("above_200dma"): score += 25
    if s.get("above_50dma"): score += 20
    if s.get("minervini_score", 0) >= 5: score += 20
    elif s.get("minervini_score", 0) >= 3: score += 10
    if s.get("above_supertrend"): score += 15
    if s.get("golden_cross"): score += 15
    elif s.get("sma_50", 0) > s.get("sma_200", 0): score += 10
    if s.get("pct_from_52h", -99) > -10: score += 5
    return min(score, 100)

def _score_momentum(s):
    score = 0
    rs3 = s.get("rs_3m", 0); rs1 = s.get("rs_1m", 0); rsi = s.get("rsi", 50)
    if rs3 > 20: score += 25
    elif rs3 > 10: score += 15
    elif rs3 > 0: score += 5
    if rs1 > 10: score += 20
    elif rs1 > 5: score += 10
    if 50 <= rsi <= 70: score += 20
    elif 40 <= rsi < 50: score += 10
    if s.get("macd_hist", 0) > 0: score += 15
    if s.get("macd_cross_up"): score += 15
    if s.get("change_pct", 0) > 0.5: score += 5
    return min(score, 100)

def _score_quality(f):
    score = 0
    roe = _sf(f.get("roe")) or 0; roce = _sf(f.get("roce")) or 0; de = _sf(f.get("debt_to_equity"))
    margin = _sf(f.get("ebitda_margin")) or _sf(f.get("net_margin")) or 0; rev_g = _sf(f.get("revenue_growth_yoy")) or 0
    if roe > 20: score += 25
    elif roe > 15: score += 18
    elif roe > 10: score += 8
    if roce > 20: score += 20
    elif roce > 15: score += 12
    if de is not None:
        if de < 0.3: score += 20
        elif de < 0.7: score += 12
        elif de < 1.0: score += 5
    else: score += 10
    if margin > 20: score += 15
    elif margin > 12: score += 8
    if rev_g > 15: score += 15
    elif rev_g > 8: score += 8
    return min(score, 100)

def _score_value(f):
    score = 0
    pe = _sf(f.get("pe_ttm")) or 0; pb = _sf(f.get("pb_ratio")) or 0; peg = _sf(f.get("peg_ratio")) or 0
    ev_eb = _sf(f.get("ev_ebitda")) or 0; dy = _sf(f.get("dividend_yield")) or 0
    if 0 < pe < 12: score += 25
    elif 0 < pe < 20: score += 18
    elif 0 < pe < 30: score += 8
    if 0 < pb < 1.5: score += 20
    elif 0 < pb < 3: score += 12
    elif 0 < pb < 5: score += 5
    if 0 < peg < 1: score += 20
    elif 0 < peg < 1.5: score += 12
    if 0 < ev_eb < 10: score += 15
    elif 0 < ev_eb < 15: score += 8
    if dy > 3: score += 10
    elif dy > 1: score += 5
    return min(score, 100)

def _score_volume(s):
    score = 0; vr = s.get("vol_ratio", 0); chg = s.get("change_pct", 0)
    if vr > 2.5: score += 30
    elif vr > 1.8: score += 22
    elif vr > 1.3: score += 15
    elif vr > 1.0: score += 8
    if chg > 0 and vr > 1.2: score += 20
    elif chg > 0 and vr > 0.8: score += 10
    if s.get("above_50dma") and vr > 1.0: score += 15
    bb_w = s.get("bb_width", 10)
    if bb_w < 4 and vr > 1.2: score += 20
    elif bb_w < 6: score += 10
    if s.get("pct_from_52l", 0) > 30 and s.get("above_200dma"): score += 15
    return min(score, 100)

@router.get("/api/alpha-conviction", summary="Multi-signal conviction picks")
async def get_conviction_picks(min_dimensions: int = Query(4, ge=2, le=5), sector: Optional[str] = None, cap: Optional[str] = None, sort: str = Query("composite"), limit: int = Query(30, ge=1, le=100)):
    try:
        redis = await aioredis.from_url("redis://localhost:6379/1", decode_responses=True)
        cached = await redis.get("sb_universe") or await redis.get("sb_universe_enriched")
        await redis.close()
        if not cached: raise HTTPException(503, "Universe cache not ready")
        stocks = json.loads(cached)
    except HTTPException: raise
    except Exception as e: raise HTTPException(503, f"Cache error: {e}")
    if sector: stocks = [s for s in stocks if s.get("sector", "").lower() == sector.lower()]
    if cap: stocks = [s for s in stocks if s.get("cap_segment", "").lower() == cap.lower()]
    candidates = [s for s in stocks if s.get("above_200dma") or s.get("above_50dma") or s.get("rs_3m", 0) > 0]
    candidates = sorted(candidates, key=lambda x: x.get("rs_3m", 0), reverse=True)[:200]
    fund_map = {}
    syms = [s["symbol"] for s in candidates]
    for i in range(0, len(syms), 50):
        batch = syms[i:i+50]
        try:
            bulk = await af_bulk(batch)
            if bulk and bulk.get("success"):
                for item in bulk.get("data", []): fund_map[item.get("symbol", "")] = item
        except: pass
    results = []
    for s in candidates:
        sym = s["symbol"]; f = fund_map.get(sym, {})
        trend = _score_trend(s); momentum = _score_momentum(s); quality = _score_quality(f); value = _score_value(f); volume = _score_volume(s)
        dims = {"trend": {"score": trend, "bullish": trend >= 50}, "momentum": {"score": momentum, "bullish": momentum >= 50}, "quality": {"score": quality, "bullish": quality >= 50}, "value": {"score": value, "bullish": value >= 40}, "volume": {"score": volume, "bullish": volume >= 45}}
        bull_cnt = sum(1 for d in dims.values() if d["bullish"])
        composite = round(trend * 0.25 + momentum * 0.25 + quality * 0.20 + value * 0.15 + volume * 0.15, 1)
        if bull_cnt >= 5: verdict = "STRONG CONVICTION"
        elif bull_cnt >= 4: verdict = "HIGH CONVICTION"
        elif bull_cnt >= 3: verdict = "MODERATE"
        else: continue
        if bull_cnt < min_dimensions: continue
        entry = s.get("price", 0)
        if entry <= 0: continue
        stop = round(s.get("sma_50", entry * 0.93), 2) if s.get("above_50dma") else round(entry * 0.93, 2)
        target = round(entry * 1.15, 2) if bull_cnt >= 5 else round(entry * 1.12, 2)
        risk_pct = round((entry - stop) / entry * 100, 1) if entry > stop else 5
        reward_pct = round((target - entry) / entry * 100, 1)
        strong = [k.upper() for k, v in dims.items() if v["bullish"]]
        weak = [k.upper() for k, v in dims.items() if not v["bullish"]]
        reasoning = f"{verdict}: {'+'.join(strong)} all bullish ({bull_cnt}/5)."
        if weak: reasoning += f" Watch: {', '.join(weak)}."
        pe = _sf(f.get("pe_ttm")); roe = _sf(f.get("roe")); roce = _sf(f.get("roce"))
        results.append({"symbol": sym, "price": entry, "entry": entry, "target": target, "stop": stop, "risk_pct": risk_pct, "reward_pct": reward_pct, "rr_ratio": round(reward_pct / risk_pct, 1) if risk_pct > 0 else 0, "conviction": {"composite": composite, "bullish_dimensions": bull_cnt, "verdict": verdict, "dimensions": dims}, "sector": s.get("sector", ""), "cap_segment": s.get("cap_segment", ""), "key_metrics": {"pe": round(pe, 1) if pe else None, "roe": round(roe, 1) if roe else None, "roce": round(roce, 1) if roce else None, "rs_3m": s.get("rs_3m"), "rsi": s.get("rsi"), "minervini": s.get("minervini_score"), "vol_ratio": s.get("vol_ratio")}, "reasoning": reasoning})
    if sort == "trend": results.sort(key=lambda x: x["conviction"]["dimensions"]["trend"]["score"], reverse=True)
    elif sort == "momentum": results.sort(key=lambda x: x["conviction"]["dimensions"]["momentum"]["score"], reverse=True)
    elif sort == "quality": results.sort(key=lambda x: x["conviction"]["dimensions"]["quality"]["score"], reverse=True)
    elif sort == "value": results.sort(key=lambda x: x["conviction"]["dimensions"]["value"]["score"], reverse=True)
    else: results.sort(key=lambda x: x["conviction"]["composite"], reverse=True)
    results = results[:limit]
    sectors = {}
    for r in results: sectors[r["sector"]] = sectors.get(r["sector"], 0) + 1
    results = await _enrich_live_prices(results)
    
    # ── Safety: remove penny stocks and ASM/GSM ──
    from main import is_asm_gsm
    results = [r for r in results if r.get("price", 0) >= 50 and not is_asm_gsm(r.get("symbol", ""))]
    return {"picks": results, "count": len(results), "min_dimensions": min_dimensions, "timestamp": datetime.now().isoformat(), "date": datetime.now().strftime("%d-%b-%Y"), "sector_distribution": dict(sorted(sectors.items(), key=lambda x: x[1], reverse=True))}

def _compute_pivots(h, l, c):
    pp = round((h + l + c) / 3, 2)
    r1 = round(2 * pp - l, 2); s1 = round(2 * pp - h, 2)
    r2 = round(pp + (h - l), 2); s2 = round(pp - (h - l), 2)
    r3 = round(h + 2 * (pp - l), 2); s3 = round(l - 2 * (h - pp), 2)
    bc = round((h + l) / 2, 2); tc = round(2 * pp - bc, 2); cpr_width = round(abs(tc - bc) / c * 100, 2) if c > 0 else 0
    rng = h - l
    fib_r1 = round(pp + 0.382 * rng, 2); fib_s1 = round(pp - 0.382 * rng, 2)
    fib_r2 = round(pp + 0.618 * rng, 2); fib_s2 = round(pp - 0.618 * rng, 2)
    fib_r3 = round(pp + rng, 2); fib_s3 = round(pp - rng, 2)
    cam_r1 = round(c + rng * 1.1 / 12, 2); cam_s1 = round(c - rng * 1.1 / 12, 2)
    cam_r2 = round(c + rng * 1.1 / 6, 2); cam_s2 = round(c - rng * 1.1 / 6, 2)
    cam_r3 = round(c + rng * 1.1 / 4, 2); cam_s3 = round(c - rng * 1.1 / 4, 2)
    cam_r4 = round(c + rng * 1.1 / 2, 2); cam_s4 = round(c - rng * 1.1 / 2, 2)
    return {"standard": {"pp": pp, "r1": r1, "r2": r2, "r3": r3, "s1": s1, "s2": s2, "s3": s3}, "fibonacci": {"pp": pp, "r1": fib_r1, "r2": fib_r2, "r3": fib_r3, "s1": fib_s1, "s2": fib_s2, "s3": fib_s3}, "camarilla": {"r1": cam_r1, "r2": cam_r2, "r3": cam_r3, "r4": cam_r4, "s1": cam_s1, "s2": cam_s2, "s3": cam_s3, "s4": cam_s4}, "cpr": {"tc": tc, "pp": pp, "bc": bc, "width_pct": cpr_width, "narrow": cpr_width < 0.5}}

@router.get("/api/intraday-levels/{symbol}", summary="Intraday levels and setups for a stock")
async def get_intraday_levels(symbol: str):
    from datetime import timedelta
    sym = symbol.upper()
    start = (date.today() - timedelta(days=30)).isoformat(); end = date.today().isoformat()
    df = await ds_ohlcv(sym, start, end)
    if df.empty or len(df) < 5: raise HTTPException(404, f"Insufficient data for {sym}")
    prev = df.iloc[-1]
    h, l, c, o = float(prev.get("high", 0)), float(prev.get("low", 0)), float(prev.get("close", 0)), float(prev.get("open", 0))
    if h == 0 or l == 0 or c == 0: raise HTTPException(404, f"Invalid OHLC for {sym}")
    pivots = _compute_pivots(h, l, c)
    recent = df.tail(15); trs = []
    if len(recent) >= 2:
        for i in range(1, len(recent)):
            cur_h = float(recent.iloc[i].get("high", 0)); cur_l = float(recent.iloc[i].get("low", 0)); prev_c = float(recent.iloc[i-1].get("close", 0))
            trs.append(max(cur_h - cur_l, abs(cur_h - prev_c), abs(cur_l - prev_c)))
    atr = round(sum(trs) / len(trs), 2) if trs else round(h - l, 2)
    atr_pct = round(atr / c * 100, 2) if c > 0 else 0
    day_range = round(h - l, 2); day_range_pct = round(day_range / c * 100, 2) if c > 0 else 0
    body_pct = round(abs(c - o) / c * 100, 2) if c > 0 else 0
    candle = "DOJI" if body_pct < 0.1 else ("BULLISH" if c > o else "BEARISH")
    tech = {}
    try:
        redis = await aioredis.from_url("redis://localhost:6379/1", decode_responses=True)
        enr = await redis.get("sb_universe") or await redis.get("sb_universe_enriched")
        await redis.close()
        if enr:
            for s in json.loads(enr):
                if s["symbol"] == sym: tech = s; break
    except: pass
    # Generate setups
    pp = pivots["standard"]["pp"]; r1 = pivots["standard"]["r1"]; s1 = pivots["standard"]["s1"]; cpr = pivots["cpr"]
    setups = []
    rsi = tech.get("rsi", 50)
    if cpr["narrow"]:
        if c > pp: setups.append({"type": "BREAKOUT_LONG", "trigger": f"Narrow CPR ({cpr['width_pct']:.1f}%) + close above pivot {pp}. Trending day UP expected. Buy above R1 ({r1}), target R2 ({pivots['standard']['r2']}). Stop at pivot ({pp}). ATR range: {round(atr,1)} pts.", "entry": f"Buy above {r1}", "target": pivots['standard']['r2'], "stop": pp, "bias": "BULLISH"})
        else: setups.append({"type": "BREAKOUT_SHORT", "trigger": f"Narrow CPR ({cpr['width_pct']:.1f}%) + close below pivot {pp}. Trending day DOWN expected. Sell below S1 ({s1}), target S2 ({pivots['standard']['s2']}). Stop at pivot ({pp}). ATR range: {round(atr,1)} pts.", "entry": f"Sell below {s1}", "target": pivots['standard']['s2'], "stop": pp, "bias": "BEARISH"})
    if rsi < 35 and c > tech.get("sma_200", 0): setups.append({"type": "MEAN_REVERSION", "trigger": f"RSI oversold at {rsi:.0f} but price holds above 200 DMA -- bounce expected. Buy near S1 ({s1}), target pivot ({pp}). Stop below S2 ({pivots['standard']['s2']}). Look for reversal candle for confirmation.", "entry": f"Buy near {s1}", "target": pp, "stop": pivots['standard']['s2'], "bias": "BULLISH"})
    elif rsi > 70: setups.append({"type": "MEAN_REVERSION", "trigger": f"RSI overbought at {rsi:.0f} -- pullback expected. Sell near R1 ({r1}), target pivot ({pp}). Stop above R2 ({pivots['standard']['r2']}). Wait for rejection candle before entry.", "entry": f"Sell near {r1}", "target": pp, "stop": pivots['standard']['r2'], "bias": "BEARISH"})
    if not cpr["narrow"] and cpr["width_pct"] > 0.8: setups.append({"type": "RANGE_TRADE", "trigger": f"Wide CPR ({cpr['width_pct']}%). Range-bound day.", "entry": f"Buy {cpr['bc']}, Sell {cpr['tc']}", "target": cpr['tc'], "stop": pivots['standard']['s1'], "bias": "NEUTRAL"})
    cam = pivots["camarilla"]
    if c > cam["r3"]: setups.append({"type": "CAMARILLA_BREAKOUT", "trigger": f"Above Camarilla R3. Strong momentum.", "entry": f"Buy above {cam['r3']}", "target": cam['r4'], "stop": cam['r2'], "bias": "BULLISH"})
    elif c < cam["s3"]: setups.append({"type": "CAMARILLA_BREAKOUT", "trigger": f"Below Camarilla S3. Breakdown.", "entry": f"Sell below {cam['s3']}", "target": cam['s4'], "stop": cam['s2'], "bias": "BEARISH"})
    if not setups:
        bias = "BULLISH" if c > pp else "BEARISH"
        gap_from_pp = round(abs(c - pp) / c * 100, 1)
        if bias == "BULLISH":
            trigger = f"Closed {gap_from_pp}% above pivot at {pp}. R1 ({r1}) is first resistance -- breakout above targets R2 ({pivots['standard']['r2']}). Support at S1 ({s1}). {'Narrow CPR suggests trending day. ' if cpr['narrow'] else ''}RSI: {rsi:.0f}."
            setups.append({"type": "BULLISH_SETUP", "trigger": trigger, "entry": f"Buy above {r1} or pullback to {pp}", "target": pivots['standard']['r2'], "stop": s1, "bias": bias})
        else:
            trigger = f"Closed {gap_from_pp}% below pivot at {pp}. S1 ({s1}) is first support -- breakdown below targets S2 ({pivots['standard']['s2']}). Resistance at R1 ({r1}). {'Narrow CPR suggests trending day. ' if cpr['narrow'] else ''}RSI: {rsi:.0f}."
            setups.append({"type": "BEARISH_SETUP", "trigger": trigger, "entry": f"Short below {s1} or pullback to {pp}", "target": pivots['standard']['s2'], "stop": r1, "bias": bias})
    return {"symbol": sym, "date": end, "previous_day": {"open": o, "high": h, "low": l, "close": c, "range": day_range, "range_pct": day_range_pct, "body_pct": body_pct, "candle": candle}, "pivots": pivots, "atr": {"value": atr, "pct": atr_pct}, "expected_range": {"high": round(c + atr, 2), "low": round(c - atr, 2)}, "bias": "BULLISH" if c > pp else "BEARISH", "setups": setups, "key_levels": sorted(set([pivots['standard']['s2'], pivots['standard']['s1'], cpr['bc'], pp, cpr['tc'], pivots['standard']['r1'], pivots['standard']['r2']]))}

@router.get("/api/intraday-levels", summary="Batch intraday levels for watchlist")
async def get_intraday_batch(symbols: str = Query(None, description="Comma-separated symbols. If empty, auto-picks top volume F&O stocks")):
    if symbols:
        sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()][:20]
    else:
        # Auto-pick diverse set from universe cache
        try:
            redis = await aioredis.from_url("redis://localhost:6379/1", decode_responses=True)
            cached = await redis.get("sb_universe") or await redis.get("sb_universe_enriched")
            await redis.close()
            if cached:
                stocks = json.loads(cached)
                # Pick top 20 by volume ratio across different sectors
                stocks = [s for s in stocks if s.get("price", 0) > 100]
                stocks.sort(key=lambda x: x.get("vol_ratio", 0), reverse=True)
                seen_sectors = {}
                sym_list = []
                for s in stocks:
                    sec = s.get("sector", "Other")
                    if seen_sectors.get(sec, 0) >= 3: continue
                    seen_sectors[sec] = seen_sectors.get(sec, 0) + 1
                    sym_list.append(s["symbol"])
                    if len(sym_list) >= 20: break
            else:
                sym_list = ["RELIANCE","HDFCBANK","TCS","INFY","ICICIBANK","SBIN","LT","AXISBANK","ITC","MARUTI","TATAMOTORS","WIPRO","BHARTIARTL","SUNPHARMA","ADANIENT"]
        except:
            sym_list = ["RELIANCE","HDFCBANK","TCS","INFY","ICICIBANK","SBIN","LT","AXISBANK","ITC","MARUTI"]
    results = []
    for sym in sym_list:
        try:
            data = await get_intraday_levels(sym)
            results.append({"symbol": sym, "close": data["previous_day"]["close"], "pivot": data["pivots"]["standard"]["pp"], "r1": data["pivots"]["standard"]["r1"], "s1": data["pivots"]["standard"]["s1"], "r2": data["pivots"]["standard"]["r2"], "s2": data["pivots"]["standard"]["s2"], "cpr_width": data["pivots"]["cpr"]["width_pct"], "cpr_narrow": data["pivots"]["cpr"]["narrow"], "atr": data["atr"]["value"], "atr_pct": data["atr"]["pct"], "expected_high": data["expected_range"]["high"], "expected_low": data["expected_range"]["low"], "bias": data["bias"], "setups": len(data["setups"]), "top_setup": data["setups"][0]["type"] if data["setups"] else None, "setup_detail": data["setups"][0]["trigger"] if data["setups"] else "", "setup_entry": data["setups"][0].get("entry","") if data["setups"] else "", "setup_target": data["setups"][0].get("target","") if data["setups"] else None, "setup_stop": data["setups"][0].get("stop","") if data["setups"] else None})
        except: pass
    bullish = sum(1 for r in results if r["bias"] == "BULLISH"); bearish = len(results) - bullish
    return {"levels": results, "count": len(results), "market_bias": "BULLISH" if bullish > bearish else "BEARISH" if bearish > bullish else "NEUTRAL", "bullish_count": bullish, "bearish_count": bearish, "timestamp": datetime.now().isoformat(), "date": datetime.now().strftime("%d-%b-%Y")}
