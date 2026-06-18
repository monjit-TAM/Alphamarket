"""
Alpha Ideas Engine — Daily actionable trade & investment ideas.
Combines technical signals (from sb_universe cache) with fundamental data
(from Alpha Fundamentals API) to generate scored, horizon-based ideas.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
import json, asyncio
from datetime import datetime, date
from services.idea_reasoning import breakout_reason, reversion_reason, momentum_reason, squeeze_reason, quality_reason, value_reason, garp_reason

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
        if sym in live:
            idea["current_price"] = live[sym]
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
            # Buy zone: -3% to +2% of entry
            idea["buy_zone_low"] = round(idea["entry"] * 0.97, 2)
            idea["buy_zone_high"] = round(idea["entry"] * 1.02, 2)
            idea["buy_zone_msg"] = f"Buy zone: Rs.{idea['buy_zone_low']} - Rs.{idea['buy_zone_high']}"
            idea["in_buy_zone"] = idea["buy_zone_low"] <= idea["entry"] <= idea["buy_zone_high"]
            idea["status"] = "IN_BUY_ZONE" if idea["in_buy_zone"] else ("ABOVE_ZONE" if idea["entry"] > idea["buy_zone_high"] else "BELOW_ZONE")
            idea["rr_ratio"] = round(idea["reward_pct"] / idea["risk_pct"], 1) if idea["risk_pct"] > 0 else 0
    return ideas

def _sf(v):
    if v is None: return None
    try: return float(v)
    except: return None
router = APIRouter(prefix="/api/alpha-ideas", tags=["Alpha Ideas"])

def _swing_breakout(stocks):
    ideas = []
    for s in stocks:
        if (s.get("price", 0) >= s.get("high_20", 0) * 0.99
            and s.get("vol_ratio", 0) >= 1.8
            and 40 < s.get("rsi", 50) < 72
            and s.get("above_50dma")
            and s.get("change_pct", 0) > 0.5):
            price = s["price"]
            stop = round(max(s.get("sma_50", price * 0.95), price * 0.96), 2)
            target = round(price * 1.06, 2)
            risk_pct = round((price - stop) / price * 100, 1)
            reward_pct = round((target - price) / price * 100, 1)
            if risk_pct <= 0: continue
            confidence = min(10, 4 + (1 if s.get("above_200dma") else 0) + (1 if s.get("above_supertrend") else 0) + (1 if s.get("macd_cross_up") else 0) + min(2, int(s.get("vol_ratio", 0) / 2)) + (1 if s.get("rs_1m", 0) > 5 else 0))
            ideas.append({"symbol": s["symbol"], "price": price, "entry": price, "target": target, "stop": stop, "risk_pct": risk_pct, "reward_pct": reward_pct, "rr_ratio": round(reward_pct / risk_pct, 1) if risk_pct > 0 else 0, "horizon": "SWING", "strategy": "Breakout", "confidence": confidence, "risk": "MEDIUM" if risk_pct < 5 else "HIGH", "signals": {"rsi": s.get("rsi"), "vol_ratio": round(s.get("vol_ratio", 0), 1), "above_200dma": s.get("above_200dma"), "rs_1m": s.get("rs_1m")}, "reasoning": breakout_reason(s), "sector": s.get("sector", ""), "cap_segment": s.get("cap_segment", "")})
    return sorted(ideas, key=lambda x: x["confidence"], reverse=True)

def _swing_mean_reversion(stocks):
    ideas = []
    for s in stocks:
        if (s.get("rsi", 50) < 35 and s.get("above_200dma") and s.get("price", 0) <= s.get("bb_lower", 0) * 1.02 and s.get("pct_from_52h", 0) < -15):
            price = s["price"]
            stop = round(price * 0.96, 2)
            target = round(s.get("sma_50", price * 1.08), 2)
            risk_pct = round((price - stop) / price * 100, 1)
            reward_pct = round((target - price) / price * 100, 1)
            if risk_pct <= 0 or reward_pct <= 0: continue
            confidence = min(10, 4 + (1 if s.get("vol_ratio", 0) > 1.3 else 0) + (1 if s.get("pct_from_52l", 0) > 20 else 0) + (1 if s.get("rs_3m", 0) > -10 else 0) + (1 if s.get("above_supertrend") else 0))
            ideas.append({"symbol": s["symbol"], "price": price, "entry": price, "target": target, "stop": stop, "risk_pct": risk_pct, "reward_pct": reward_pct, "rr_ratio": round(reward_pct / risk_pct, 1), "horizon": "SWING", "strategy": "Mean Reversion", "confidence": confidence, "risk": "MEDIUM", "signals": {"rsi": s.get("rsi"), "bb_lower": s.get("bb_lower"), "pct_from_52h": s.get("pct_from_52h")}, "reasoning": reversion_reason(s), "sector": s.get("sector", ""), "cap_segment": s.get("cap_segment", "")})
    return sorted(ideas, key=lambda x: x["confidence"], reverse=True)

def _short_momentum(stocks):
    ideas = []
    for s in stocks:
        if (s.get("minervini_score", 0) >= 5 and s.get("rs_1m", 0) > 5 and s.get("rs_3m", 0) > 10 and s.get("above_50dma") and s.get("above_200dma") and 50 < s.get("rsi", 50) < 75):
            price = s["price"]
            stop = round(s.get("sma_50", price * 0.93), 2)
            target = round(price * 1.12, 2)
            risk_pct = round((price - stop) / price * 100, 1)
            reward_pct = round((target - price) / price * 100, 1)
            if risk_pct <= 0: continue
            confidence = min(10, 3 + min(2, s.get("minervini_score", 0) - 4) + (1 if s.get("macd_hist", 0) > 0 else 0) + (1 if s.get("above_supertrend") else 0) + (1 if s.get("vol_ratio", 0) > 1.2 else 0) + (1 if s.get("rs_3m", 0) > 20 else 0))
            ideas.append({"symbol": s["symbol"], "price": price, "entry": price, "target": target, "stop": stop, "risk_pct": risk_pct, "reward_pct": reward_pct, "rr_ratio": round(reward_pct / risk_pct, 1), "horizon": "SHORT", "strategy": "Momentum", "confidence": confidence, "risk": "MEDIUM", "signals": {"minervini": s.get("minervini_score"), "rs_1m": s.get("rs_1m"), "rs_3m": s.get("rs_3m"), "rsi": s.get("rsi")}, "reasoning": momentum_reason(s), "sector": s.get("sector", ""), "cap_segment": s.get("cap_segment", "")})
    return sorted(ideas, key=lambda x: x["confidence"], reverse=True)

def _short_bollinger_squeeze(stocks):
    ideas = []
    for s in stocks:
        if (s.get("bb_width", 10) < 4 and s.get("above_200dma") and s.get("above_50dma") and 45 < s.get("rsi", 50) < 65):
            price = s["price"]
            stop = round(s.get("bb_lower", price * 0.95), 2)
            target = round(price + (s.get("bb_upper", price) - s.get("bb_lower", price)) * 1.5, 2)
            risk_pct = round((price - stop) / price * 100, 1)
            reward_pct = round((target - price) / price * 100, 1)
            if risk_pct <= 0 or reward_pct <= 0: continue
            confidence = min(10, 4 + (1 if s.get("above_supertrend") else 0) + (1 if s.get("macd_hist", 0) > 0 else 0) + (1 if s.get("rs_1m", 0) > 0 else 0) + (1 if s.get("vol_ratio", 0) < 0.8 else 0))
            ideas.append({"symbol": s["symbol"], "price": price, "entry": price, "target": target, "stop": stop, "risk_pct": risk_pct, "reward_pct": reward_pct, "rr_ratio": round(reward_pct / risk_pct, 1), "horizon": "SHORT", "strategy": "Volatility Squeeze", "confidence": confidence, "risk": "LOW", "signals": {"bb_width": s.get("bb_width"), "rsi": s.get("rsi"), "above_supertrend": s.get("above_supertrend")}, "reasoning": squeeze_reason(s), "sector": s.get("sector", ""), "cap_segment": s.get("cap_segment", "")})
    return sorted(ideas, key=lambda x: x["confidence"], reverse=True)

def _medium_quality_momentum(stocks, fund_map):
    ideas = []
    for s in stocks:
        sym = s["symbol"]
        f = fund_map.get(sym, {})
        roe = _sf(f.get("roe")) or 0; roce = _sf(f.get("roce")) or 0; de = _sf(f.get("debt_to_equity")); pe = _sf(f.get("pe_ttm")) or 0; margin = _sf(f.get("ebitda_margin")) or _sf(f.get("net_margin")) or 0; rev_g = _sf(f.get("revenue_growth_yoy")) or 0
        if not (roe > 14 and roce > 12 and (de is None or de < 1.5) and 0 < pe < 40): continue
        if not (s.get("above_200dma") and s.get("above_50dma") and s.get("rs_3m", 0) > 5): continue
        price = s["price"]; stop = round(s.get("sma_200", price * 0.88), 2); target = round(price * 1.20, 2)
        risk_pct = round((price - stop) / price * 100, 1); reward_pct = round((target - price) / price * 100, 1)
        if risk_pct <= 0: continue
        confidence = min(10, 3 + (1 if roe > 20 else 0) + (1 if roce > 20 else 0) + (1 if rev_g > 10 else 0) + (1 if margin > 15 else 0) + (1 if s.get("minervini_score", 0) >= 5 else 0) + (1 if s.get("above_supertrend") else 0) + (1 if pe < 25 else 0))
        ideas.append({"symbol": sym, "price": price, "entry": price, "target": target, "stop": stop, "risk_pct": risk_pct, "reward_pct": reward_pct, "rr_ratio": round(reward_pct / risk_pct, 1), "horizon": "MEDIUM", "strategy": "Quality + Momentum", "confidence": confidence, "risk": "LOW" if de is not None and de < 0.5 else "MEDIUM", "signals": {"roe": round(roe, 1), "roce": round(roce, 1), "pe_ttm": round(pe, 1), "de": round(de, 2) if de else None, "margin": round(margin, 1), "rs_3m": s.get("rs_3m"), "minervini": s.get("minervini_score")}, "fundamentals": {"roe": round(roe, 1), "roce": round(roce, 1), "pe_ttm": round(pe, 1), "debt_to_equity": round(de, 2) if de else None, "ebitda_margin": round(margin, 1), "revenue_growth": round(rev_g, 1)}, "reasoning": quality_reason(s, roe, roce, pe, margin, rev_g, de), "sector": s.get("sector", ""), "cap_segment": s.get("cap_segment", "")})
    return sorted(ideas, key=lambda x: x["confidence"], reverse=True)

def _long_deep_value(stocks, fund_map):
    ideas = []
    for s in stocks:
        sym = s["symbol"]; f = fund_map.get(sym, {})
        pe = _sf(f.get("pe_ttm")) or 0; pb = _sf(f.get("pb_ratio")) or 0; roe = _sf(f.get("roe")) or 0; de = _sf(f.get("debt_to_equity")); div_y = _sf(f.get("dividend_yield")) or 0; ev_ebitda = _sf(f.get("ev_ebitda")) or 0; margin = _sf(f.get("ebitda_margin")) or _sf(f.get("net_margin")) or 0
        if not (0 < pe < 15 and pb > 0 and pb < 2.5 and roe > 10): continue
        if de is not None and de > 1.0: continue
        price = s["price"]; stop = round(price * 0.85, 2); target = round(price * 1.35, 2)
        risk_pct = round((price - stop) / price * 100, 1); reward_pct = round((target - price) / price * 100, 1)
        confidence = min(10, 3 + (1 if pe < 10 else 0) + (1 if pb < 1.5 else 0) + (1 if roe > 15 else 0) + (1 if div_y > 2 else 0) + (1 if de is not None and de < 0.3 else 0) + (1 if ev_ebitda > 0 and ev_ebitda < 10 else 0) + (1 if s.get("above_200dma") else 0))
        ideas.append({"symbol": sym, "price": price, "entry": price, "target": target, "stop": stop, "risk_pct": risk_pct, "reward_pct": reward_pct, "rr_ratio": round(reward_pct / risk_pct, 1), "horizon": "LONG", "strategy": "Deep Value", "confidence": confidence, "risk": "LOW", "signals": {"pe_ttm": round(pe, 1), "pb": round(pb, 1), "roe": round(roe, 1), "de": round(de, 2) if de else None, "div_yield": round(div_y, 1)}, "fundamentals": {"pe_ttm": round(pe, 1), "pb_ratio": round(pb, 1), "roe": round(roe, 1), "debt_to_equity": round(de, 2) if de else None, "dividend_yield": round(div_y, 1), "ev_ebitda": round(ev_ebitda, 1), "ebitda_margin": round(margin, 1)}, "reasoning": value_reason(s, pe, pb, roe, de, div_y, ev_ebitda), "sector": s.get("sector", ""), "cap_segment": s.get("cap_segment", "")})
    return sorted(ideas, key=lambda x: x["confidence"], reverse=True)

def _long_garp(stocks, fund_map):
    ideas = []
    for s in stocks:
        sym = s["symbol"]; f = fund_map.get(sym, {})
        pe = _sf(f.get("pe_ttm")) or 0; roe = _sf(f.get("roe")) or 0; rev_g = _sf(f.get("revenue_growth_yoy")) or 0; pat_g = _sf(f.get("pat_growth_yoy")) or 0; eps_g = _sf(f.get("eps_growth_yoy")) or 0; margin = _sf(f.get("ebitda_margin")) or 0
        growth = max(rev_g, pat_g, eps_g)
        if not (0 < pe < 35 and growth > 12 and roe > 12): continue
        calc_peg = pe / growth if growth > 0 else 99
        if calc_peg > 2.0: continue
        price = s["price"]; stop = round(s.get("sma_200", price * 0.85), 2); target = round(price * 1.30, 2)
        risk_pct = round((price - stop) / price * 100, 1); reward_pct = round((target - price) / price * 100, 1)
        if risk_pct <= 0: continue
        confidence = min(10, 3 + (1 if calc_peg < 1.0 else 0) + (1 if growth > 20 else 0) + (1 if roe > 18 else 0) + (1 if margin > 15 else 0) + (1 if s.get("above_200dma") else 0) + (1 if s.get("rs_3m", 0) > 10 else 0) + (1 if s.get("above_supertrend") else 0))
        ideas.append({"symbol": sym, "price": price, "entry": price, "target": target, "stop": stop, "risk_pct": risk_pct, "reward_pct": reward_pct, "rr_ratio": round(reward_pct / risk_pct, 1), "horizon": "LONG", "strategy": "GARP", "confidence": confidence, "risk": "MEDIUM", "signals": {"pe_ttm": round(pe, 1), "peg": round(calc_peg, 2), "growth": round(growth, 1), "roe": round(roe, 1)}, "fundamentals": {"pe_ttm": round(pe, 1), "peg_ratio": round(calc_peg, 2), "roe": round(roe, 1), "revenue_growth": round(rev_g, 1), "pat_growth": round(pat_g, 1), "ebitda_margin": round(margin, 1)}, "reasoning": garp_reason(s, pe, calc_peg, growth, roe, margin, rev_g), "sector": s.get("sector", ""), "cap_segment": s.get("cap_segment", "")})
    return sorted(ideas, key=lambda x: x["confidence"], reverse=True)

@router.get("", summary="Daily Alpha Ideas")
@router.get("/", summary="Daily Alpha Ideas", include_in_schema=False)
async def get_alpha_ideas(horizon: Optional[str] = Query(None, description="SWING, SHORT, MEDIUM, LONG or ALL"), strategy: Optional[str] = None, sector: Optional[str] = None, min_confidence: int = Query(5, ge=1, le=10), limit: int = Query(30, ge=1, le=100)):
    from services.data_service import af_bulk
    import redis.asyncio as aioredis
    try:
        redis = await aioredis.from_url("redis://localhost:6379/1", decode_responses=True)
        cached = await redis.get("sb_universe") or await redis.get("sb_universe_enriched")
        await redis.close()
        if not cached:
            raise HTTPException(503, "Universe cache not ready. Try again after market hours warm-up.")
        stocks = json.loads(cached)
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(503, f"Cache unavailable: {str(e)}")
    if not stocks:
        raise HTTPException(503, "No stock data in cache")
    if sector:
        stocks = [s for s in stocks if s.get("sector", "").lower() == sector.lower()]
    all_ideas = []; now = datetime.now()
    if not horizon or horizon.upper() in ("SWING", "ALL"):
        all_ideas.extend(_swing_breakout(stocks)[:8])
        all_ideas.extend(_swing_mean_reversion(stocks)[:5])
    if not horizon or horizon.upper() in ("SHORT", "ALL"):
        all_ideas.extend(_short_momentum(stocks)[:8])
        all_ideas.extend(_short_bollinger_squeeze(stocks)[:5])
    if not horizon or horizon.upper() in ("MEDIUM", "LONG", "ALL"):
        candidates = sorted(stocks, key=lambda x: x.get("rs_3m", 0), reverse=True)[:150]
        candidate_syms = [s["symbol"] for s in candidates]
        fund_map = {}
        for i in range(0, len(candidate_syms), 50):
            batch = candidate_syms[i:i+50]
            try:
                bulk = await af_bulk(batch)
                if bulk and bulk.get("success"):
                    for item in bulk.get("data", []):
                        fund_map[item.get("symbol", "")] = item
            except Exception as e:
                print(f"[AlphaIdeas] Bulk fundamentals error: {e}")
        if not horizon or horizon.upper() in ("MEDIUM", "ALL"):
            all_ideas.extend(_medium_quality_momentum(candidates, fund_map)[:10])
        if not horizon or horizon.upper() in ("LONG", "ALL"):
            all_stocks_sorted = sorted(stocks, key=lambda x: x.get("price", 0), reverse=True)[:200]
            all_syms = [s["symbol"] for s in all_stocks_sorted]
            for i in range(0, len(all_syms), 50):
                batch = all_syms[i:i+50]
                try:
                    bulk = await af_bulk(batch)
                    if bulk and bulk.get("success"):
                        for item in bulk.get("data", []):
                            if item.get("symbol") not in fund_map:
                                fund_map[item["symbol"]] = item
                except Exception: pass
            all_ideas.extend(_long_deep_value(all_stocks_sorted, fund_map)[:8])
            all_ideas.extend(_long_garp(all_stocks_sorted, fund_map)[:8])
    if strategy:
        all_ideas = [i for i in all_ideas if strategy.lower() in i["strategy"].lower()]
    all_ideas = [i for i in all_ideas if i["confidence"] >= min_confidence]
    # ── Safety filters: remove penny stocks (<Rs50) and ASM/GSM stocks ──
    from main import is_asm_gsm
    all_ideas = [i for i in all_ideas if i.get("price", 0) >= 50 and not is_asm_gsm(i["symbol"])]

    # ── Cap-balanced selection (SEBI/AMFI aligned) ──
    # Target: 35% large, 35% mid, 25% small, 5% micro
    cap_quotas = {"large": 0.35, "mid": 0.35, "small": 0.25, "micro": 0.05}
    by_cap = {"large": [], "mid": [], "small": [], "micro": [], "unknown": []}
    for idea in sorted(all_ideas, key=lambda x: x["confidence"], reverse=True):
        seg = idea.get("cap_segment", "unknown")
        if seg not in by_cap: seg = "unknown"
        by_cap[seg].append(idea)
    
    seen = {}; deduped = []
    # First pass: fill quotas
    for cap, quota in cap_quotas.items():
        cap_limit = max(2, int(limit * quota))
        for idea in by_cap.get(cap, []):
            if idea["symbol"] not in seen and len([d for d in deduped if d.get("cap_segment") == cap]) < cap_limit:
                seen[idea["symbol"]] = True
                deduped.append(idea)
    # Second pass: fill remaining slots with best confidence (any cap)
    remaining = limit - len(deduped)
    if remaining > 0:
        for cap in ["large", "mid", "small", "micro", "unknown"]:
            for idea in by_cap.get(cap, []):
                if idea["symbol"] not in seen and remaining > 0:
                    seen[idea["symbol"]] = True
                    deduped.append(idea)
                    remaining -= 1
    deduped = sorted(deduped, key=lambda x: x["confidence"], reverse=True)[:limit]
    by_horizon = {}
    for idea in deduped:
        h = idea["horizon"]
        if h not in by_horizon: by_horizon[h] = []
        by_horizon[h].append(idea)
    deduped = await _enrich_live_prices(deduped)
    return {"ideas": deduped, "count": len(deduped), "timestamp": now.isoformat(), "date": now.strftime("%d-%b-%Y"), "market_date": now.strftime("%A, %d %B %Y"), "summary": {h: {"count": len(ideas), "top": ideas[0]["symbol"] if ideas else None} for h, ideas in by_horizon.items()}, "filters": {"horizon": horizon, "strategy": strategy, "sector": sector, "min_confidence": min_confidence}}

@router.get("/horizons", summary="Ideas grouped by horizon")
async def get_ideas_by_horizon(sector: Optional[str] = None, min_confidence: int = 5):
    full = await get_alpha_ideas(horizon="ALL", sector=sector, min_confidence=min_confidence, limit=50)
    ideas = full.get("ideas", [])
    horizons = {}
    for h in ["SWING", "SHORT", "MEDIUM", "LONG"]:
        h_ideas = [i for i in ideas if i["horizon"] == h]
        horizons[h] = {"label": {"SWING": "Swing (1-5 days)", "SHORT": "Short Term (1-4 weeks)", "MEDIUM": "Medium Term (1-3 months)", "LONG": "Long Term (6+ months)"}[h], "count": len(h_ideas), "ideas": h_ideas[:10], "avg_confidence": round(sum(i["confidence"] for i in h_ideas) / len(h_ideas), 1) if h_ideas else 0}
    return {"horizons": horizons, "total": len(ideas), "timestamp": full["timestamp"], "date": full["date"]}

@router.get("/top", summary="Top 5 highest-conviction ideas")
async def get_top_ideas():
    full = await get_alpha_ideas(horizon="ALL", min_confidence=5, limit=50)
    ideas = full.get("ideas", [])
    top = []; horizon_count = {}
    for idea in ideas:
        h = idea["horizon"]
        if horizon_count.get(h, 0) < 2:
            top.append(idea); horizon_count[h] = horizon_count.get(h, 0) + 1
        if len(top) >= 5: break
    if len(top) < 5:
        for idea in ideas:
            if idea not in top: top.append(idea)
            if len(top) >= 5: break
    return {"top_ideas": top, "count": len(top), "timestamp": full["timestamp"], "date": full["date"], "market_date": full["market_date"]}

@router.get("/sectors", summary="Sector-wise idea distribution")
async def get_sector_ideas():
    full = await get_alpha_ideas(horizon="ALL", min_confidence=4, limit=100)
    ideas = full.get("ideas", [])
    sectors = {}
    for idea in ideas:
        sec = idea.get("sector", "Other")
        if sec not in sectors: sectors[sec] = {"count": 0, "ideas": []}
        sectors[sec]["count"] += 1; sectors[sec]["ideas"].append(idea["symbol"])
    for sec in sectors:
        sec_ideas = [i for i in ideas if i.get("sector") == sec]
        sectors[sec]["avg_confidence"] = round(sum(i["confidence"] for i in sec_ideas) / len(sec_ideas), 1) if sec_ideas else 0
    sorted_sectors = dict(sorted(sectors.items(), key=lambda x: x[1]["count"], reverse=True))
    return {"sectors": sorted_sectors, "total_ideas": len(ideas), "timestamp": full["timestamp"]}

@router.post("/log", summary="Log an idea to track performance")
async def log_idea(request: dict):
    import asyncpg
    pool = None
    try:
        pool = await asyncpg.create_pool("postgresql://dyor_user:DyorSecure2026Mar@localhost/dyor_db", min_size=1, max_size=2)
        async with pool.acquire() as conn:
            tid = await conn.fetchval(
                "INSERT INTO alpha_ideas_log (symbol,horizon,strategy,entry_price,target_price,stop_price,paper_trade_id,reasoning) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
                request.get("symbol",""), request.get("horizon","SWING"), request.get("strategy",""),
                request.get("entry_price",0), request.get("target_price",0), request.get("stop_price",0),
                request.get("paper_trade_id"), request.get("reasoning","")
            )
        return {"id": tid, "status": "logged"}
    except Exception as e:
        return {"error": str(e)}
    finally:
        if pool: await pool.close()

@router.get("/performance", summary="Performance metrics for tracked ideas")
async def get_performance():
    import asyncpg
    pool = None
    try:
        pool = await asyncpg.create_pool("postgresql://dyor_user:DyorSecure2026Mar@localhost/dyor_db", min_size=1, max_size=2)
        async with pool.acquire() as conn:
            trades = await conn.fetch("SELECT * FROM alpha_ideas_log ORDER BY created_at DESC LIMIT 100")
            trades = [dict(t) for t in trades]
        total = len(trades)
        closed = [t for t in trades if t["status"] != "OPEN"]
        winners = [t for t in closed if t.get("pnl_pct", 0) > 0]
        win_rate = (len(winners) / len(closed) * 100) if closed else 0
        avg_pnl = sum(t.get("pnl_pct", 0) for t in closed) / len(closed) if closed else 0
        target_hit = len([t for t in closed if t.get("close_reason") == "TARGET_HIT"])
        sl_hit = len([t for t in closed if t.get("close_reason") == "SL_HIT"])
        by_strategy = {}
        for t in closed:
            s = t.get("strategy", "Unknown")
            if s not in by_strategy: by_strategy[s] = {"total": 0, "wins": 0, "pnls": [], "best": -999, "worst": 999}
            by_strategy[s]["total"] += 1
            pnl = t.get("pnl_pct", 0)
            by_strategy[s]["pnls"].append(pnl)
            if pnl > 0: by_strategy[s]["wins"] += 1
            if pnl > by_strategy[s]["best"]: by_strategy[s]["best"] = pnl
            if pnl < by_strategy[s]["worst"]: by_strategy[s]["worst"] = pnl
        for s in by_strategy:
            bs = by_strategy[s]
            bs["win_rate"] = bs["wins"] / bs["total"] * 100 if bs["total"] else 0
            bs["avg_pnl"] = sum(bs["pnls"]) / len(bs["pnls"]) if bs["pnls"] else 0
            del bs["pnls"]; del bs["wins"]
        # Enrich open trades with live prices
        import httpx
        open_trades = [t for t in trades if t["status"] == "OPEN"]
        if open_trades:
            async with httpx.AsyncClient(timeout=8) as client:
                for t in open_trades:
                    try:
                        r = await client.get(f"http://127.0.0.1:5004/data/equity/quote/{t['symbol']}")
                        if r.status_code == 200:
                            d = r.json()
                            if d.get("price") and d["price"] > 0:
                                t["current_price"] = round(float(d["price"]), 2)
                                if t.get("entry_price") and t["entry_price"] > 0:
                                    t["pnl_pct"] = round((t["current_price"] - t["entry_price"]) / t["entry_price"] * 100, 2)
                    except: pass
        for t in trades:
            for k in ["created_at", "closed_at"]:
                if t.get(k): t[k] = t[k].isoformat()
        return {"summary": {"total": total, "closed": len(closed), "open": total - len(closed), "win_rate": win_rate, "avg_pnl": avg_pnl, "target_hit": target_hit, "sl_hit": sl_hit}, "by_strategy": by_strategy, "trades": trades[:50]}
    except Exception as e:
        return {"summary": {"total": 0, "win_rate": 0, "avg_pnl": 0, "target_hit": 0, "sl_hit": 0}, "trades": [], "error": str(e)}
    finally:
        if pool: await pool.close()

@router.post("/log", summary="Log idea for tracking")
async def log_idea(request: dict):
    import asyncpg
    pool = None
    try:
        pool = await asyncpg.create_pool("postgresql://dyor_user:DyorSecure2026Mar@localhost/dyor_db", min_size=1, max_size=2)
        async with pool.acquire() as conn:
            tid = await conn.fetchval("INSERT INTO alpha_ideas_log (symbol,horizon,strategy,entry_price,target_price,stop_price,paper_trade_id,reasoning) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", request.get("symbol",""), request.get("horizon","SWING"), request.get("strategy",""), request.get("entry_price",0), request.get("target_price",0), request.get("stop_price",0), request.get("paper_trade_id"), request.get("reasoning",""))
        return {"id": tid, "status": "logged"}
    except Exception as e: return {"error": str(e)}
    finally:
        if pool: await pool.close()

@router.get("/performance", summary="Performance metrics")
async def get_performance():
    import asyncpg
    pool = None
    try:
        pool = await asyncpg.create_pool("postgresql://dyor_user:DyorSecure2026Mar@localhost/dyor_db", min_size=1, max_size=2)
        async with pool.acquire() as conn:
            trades = [dict(t) for t in await conn.fetch("SELECT * FROM alpha_ideas_log ORDER BY created_at DESC LIMIT 100")]
        total = len(trades); closed = [t for t in trades if t["status"] != "OPEN"]; winners = [t for t in closed if t.get("pnl_pct", 0) > 0]
        win_rate = (len(winners) / len(closed) * 100) if closed else 0; avg_pnl = sum(t.get("pnl_pct", 0) for t in closed) / len(closed) if closed else 0
        target_hit = len([t for t in closed if t.get("close_reason") == "TARGET_HIT"]); sl_hit = len([t for t in closed if t.get("close_reason") == "SL_HIT"])
        by_strategy = {}
        for t in closed:
            s = t.get("strategy", "Unknown")
            if s not in by_strategy: by_strategy[s] = {"total": 0, "wins": 0, "pnls": [], "best": -999, "worst": 999}
            by_strategy[s]["total"] += 1; pnl = t.get("pnl_pct", 0); by_strategy[s]["pnls"].append(pnl)
            if pnl > 0: by_strategy[s]["wins"] += 1
            if pnl > by_strategy[s]["best"]: by_strategy[s]["best"] = pnl
            if pnl < by_strategy[s]["worst"]: by_strategy[s]["worst"] = pnl
        for s in by_strategy:
            bs = by_strategy[s]; bs["win_rate"] = bs["wins"] / bs["total"] * 100 if bs["total"] else 0; bs["avg_pnl"] = sum(bs["pnls"]) / len(bs["pnls"]) if bs["pnls"] else 0; del bs["pnls"]; del bs["wins"]
        for t in trades:
            for k in ["created_at", "closed_at"]:
                if t.get(k): t[k] = t[k].isoformat()
        return {"summary": {"total": total, "closed": len(closed), "open": total - len(closed), "win_rate": win_rate, "avg_pnl": avg_pnl, "target_hit": target_hit, "sl_hit": sl_hit}, "by_strategy": by_strategy, "trades": trades[:50]}
    except Exception as e: return {"summary": {"total": 0, "win_rate": 0, "avg_pnl": 0, "target_hit": 0, "sl_hit": 0}, "trades": [], "error": str(e)}
    finally:
        if pool: await pool.close()
