"""
Research features for DYOR, served by the data service on this machine (127.0.0.1:5004), the same
service AlphaLab (testalpha.in) uses for them, so both products show the same figures.

  /api/research/models/list                 the ten stock selection models     (advisors: signal gate)
  /api/research/models/{key}                one model: holdings, past, method  (advisors: signal gate)
  /api/research/models/report/{symbol}      research note PDF for a holding    (advisors: signal gate)
  /api/research/base-rates                  how every pattern and scan has played out
  /api/research/base-rates/signal           one signal split by context
  /api/research/base-rates/live/{symbol}    what the engine sees on a stock today, with track records
  /api/research/stock/{symbol}              deep research for one company
  /api/research/stock-risk/{symbol}         pledge, promoter behaviour, exit liquidity, surveillance
  /api/research/mf/..., etf/..., debt/...   mutual funds, ETFs, bonds (whitelisted data service paths)
  /api/research/insurance/questions         the protection interview
  /api/research/insurance/protection-map    POST the answers, get the risk map
  /api/research/ui.js, funds.js             the DYOR panels for the above

Every route needs a signed-in AlphaMarket user (auth middleware). Models also need signal access.
"""
import os
import time

import httpx
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response

DS = "http://127.0.0.1:5004"
HERE = os.path.dirname(os.path.abspath(__file__))
UI_JS = os.path.join(HERE, "research_ui.js")
FUNDS_JS = os.path.join(HERE, "research_funds.js")
router = APIRouter(prefix="/api/research", tags=["Research"])

_cache = {}   # url -> (time, status, body, media type)


async def _get(path, params=None, ttl=0, timeout=60):
    key = path + "?" + "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
    hit = _cache.get(key)
    if ttl and hit and time.time() - hit[0] < ttl:
        return Response(content=hit[2], status_code=hit[1], media_type=hit[3])
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(DS + path, params={k: v for k, v in (params or {}).items() if v is not None})
    except Exception as e:
        return JSONResponse(status_code=502, content={"detail": f"Research service unavailable ({type(e).__name__})"})
    mt = r.headers.get("content-type", "application/json").split(";")[0]
    if ttl and r.status_code == 200:
        _cache[key] = (time.time(), r.status_code, r.content, mt)
        if len(_cache) > 500:
            _cache.clear()
    return Response(content=r.content, status_code=r.status_code, media_type=mt)


def _sym(s):
    return "".join(ch for ch in s.upper() if ch.isalnum() or ch in "&-_")[:30]


def _js(path):
    try:
        return Response(open(path).read(), media_type="application/javascript", headers={"Cache-Control": "no-store"})
    except OSError:
        return Response("", media_type="application/javascript")


@router.get("/ui.js", include_in_schema=False)
async def ui_js():
    return _js(UI_JS)


@router.get("/funds.js", include_in_schema=False)
async def funds_js():
    return _js(FUNDS_JS)


# Mutual funds, ETFs and bonds: only these data service paths, GET only, query string passed through
ALLOWED = {
    "mf": {"screener", "search", "xray", "dna-board", "dna", "behaviour", "probability", "horizon", "stayed", "whatif",
           "holdings-xray", "forward-outlook"},
    "etf": {"screener", "chooser", "detail"},
    "debt": {"board", "yields", "curve-shift"},
}
TTL = {"screener": 600, "search": 300, "dna-board": 900, "board": 600, "yields": 600, "curve-shift": 900, "chooser": 900}


async def _family(fam, sub, request):
    parts = [x for x in sub.split("/") if x]
    if not parts or parts[0] not in ALLOWED[fam] or len(parts) > 2 or any(not all(c.isalnum() or c in "-_&" for c in x) for x in parts):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    params = {k: v[:100] for k, v in request.query_params.items()}
    return await _get(f"/data/{fam}/" + "/".join(parts), params, ttl=TTL.get(parts[0], 300), timeout=60)


@router.get("/mf/{sub:path}", summary="Mutual fund research (screener, X-ray, probability, what-if and more)")
async def mf(sub: str, request: Request):
    return await _family("mf", sub, request)


@router.get("/etf/{sub:path}", summary="ETF research (premium to NAV, chooser, detail)")
async def etf(sub: str, request: Request):
    return await _family("etf", sub, request)


@router.get("/debt/{sub:path}", summary="Bonds research (SGBs, G-secs, corporate bonds, T-bill yields)")
async def debt(sub: str, request: Request):
    return await _family("debt", sub, request)


@router.get("/insurance/questions", summary="The protection interview questions")
async def ins_questions(employment: str = None):
    return await _get("/data/insurance/questions", {"employment": employment}, ttl=3600)


@router.post("/insurance/protection-map", summary="The risk map for one set of interview answers")
async def ins_map(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"detail": "JSON body required"})
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(DS + "/data/insurance/protection-map", json=body)
    except Exception as e:
        return JSONResponse(status_code=502, content={"detail": f"Research service unavailable ({type(e).__name__})"})
    return Response(content=r.content, status_code=r.status_code, media_type="application/json")


@router.get("/models/list", summary="The ten rules-based stock selection models")
async def models_list():
    return await _get("/data/models/list", ttl=120)


@router.get("/models/report/{symbol}", summary="Research note (PDF) for one model holding")
async def models_report(symbol: str, model: str = None):
    return await _get(f"/data/conviction/report/{_sym(symbol)}", {"model": model}, timeout=90)


@router.get("/models/{model_key}", summary="One model: thesis, method, holdings and closed positions")
async def models_detail(model_key: str):
    return await _get(f"/data/models/{''.join(c for c in model_key if c.isalnum() or c == '_')[:40]}", ttl=60)


@router.get("/base-rates", summary="How every pattern, candlestick and scan has played out")
async def base_rates(horizon: int = Query(20)):
    return await _get("/data/base-rates", {"horizon": horizon if horizon in (5, 10, 20, 60) else 20}, ttl=600)


@router.get("/base-rates/signal", summary="One signal split by market regime, liquidity, trend and volume")
async def base_rates_signal(name: str, direction: str = None):
    return await _get("/data/base-rates/signal", {"name": name[:80], "direction": direction}, ttl=600)


@router.get("/base-rates/live/{symbol}", summary="Signals on a stock's latest session, with their track records")
async def base_rates_live(symbol: str):
    return await _get(f"/data/base-rates/live/{_sym(symbol)}", ttl=300)


@router.get("/stock/{symbol}", summary="Deep research for one company")
async def stock_research(symbol: str):
    return await _get(f"/data/stock/deep-research/{_sym(symbol)}", ttl=900, timeout=60)


@router.get("/stock-risk/{symbol}", summary="Pledge, promoter behaviour, exit liquidity and surveillance status")
async def stock_risk(symbol: str, position_value: float = None):
    return await _get(f"/data/stock/risk/{_sym(symbol)}", {"position_value": position_value}, ttl=900, timeout=40)
