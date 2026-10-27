"""
AlphaLab pages inside DYOR. DYOR signs the person in to AlphaLab (testalpha.in) server to server and shows the
AlphaLab page in a frame. Each AlphaMarket user has their own AlphaLab account, so Proof history, Telegram alerts,
goals and reports stay separate per person.

    GET /api/alphalab/open?page=KEY    -> {"url": ...} to load in the frame, or 403 {"locked": true, ...}
    GET /api/alphalab/ui.js            the DYOR menu group and panels

Who sees what (decided here and again by AlphaLab on every call, from the token's claims):
    signal pages (Alpha Signal, Options Lab): admins, approved advisors, investors with signal access
    advisor pages (Proof, reports): AlphaMarket admins and approved advisors. Proof is held to advisors while
        compliance reviews retail access, as the AlphaLab entitlement note requires
    everything else: any signed-in user
Broker push, data push, admin and US markets are never reachable from DYOR.
"""
import hashlib
import hmac
import json
import os
import time
import urllib.parse

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from middleware.signal_gate import decide, _q, _session_user

router = APIRouter(prefix="/api/alphalab", tags=["AlphaLab in DYOR"])
HERE = os.path.dirname(os.path.abspath(__file__))
UI_JS = os.path.join(HERE, "alphalab_embed.js")
SECRET_FILE = os.path.join(HERE, ".dyor_sso_secret")
AL = "https://testalpha.in"

PAGES = {   # key: (AlphaLab path, who)
    "proof": ("/dashboard/proof", "adv"),
    "stock360": ("/dashboard/equities", "all"),
    "charts": ("/dashboard/charts", "all"),
    "bases": ("/dashboard/bases", "all"),
    "gallery": ("/dashboard/patterns/gallery", "all"),
    "screens": ("/dashboard/screens", "all"),
    "alphasignal": ("/dashboard/alpha-signal", "sig"),
    "optionslab": ("/dashboard/options-lab", "sig"),
    "cascheck": ("/dashboard/cas-check", "all"),
    "planning": ("/dashboard/planning", "all"),
    "portfolioguide": ("/dashboard/portfolio-guide", "all"),
    "telegram": ("/dashboard/alerts/telegram", "all"),
    "rep_sebi": ("/dashboard/reports/sebi", "adv"),
    "rep_client": ("/dashboard/reports/client", "adv"),
    "rep_dossier": ("/dashboard/reports/dossier", "adv"),
}
MSG = {"sig": "This is a signal feature for SEBI-registered advisors on AlphaMarket. You can request access and our team will review it.",
       "adv": "This is open to SEBI-registered advisors on AlphaMarket while compliance reviews access for investors."}
_tok = {}   # am user id -> (time, token, me, sig, adv)
_TOK_S = 30 * 60


def _secret():
    try:
        return open(SECRET_FILE).read().strip().encode()
    except OSError:
        return b""


def _advisor(am_id):
    u = _q("SELECT role::text AS role, is_approved FROM users WHERE id = %s", (am_id,), one=True) or {}
    return u.get("role") == "admin" or (u.get("role") == "advisor" and bool(u.get("is_approved")))


@router.get("/ui.js", include_in_schema=False)
async def ui_js():
    try:
        return Response(open(UI_JS).read(), media_type="application/javascript", headers={"Cache-Control": "no-store"})
    except OSError:
        return Response("", media_type="application/javascript")


@router.get("/access", summary="Which AlphaLab pages this person can open")
async def access(request: Request):
    user = _session_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"detail": "Please log in at alphamarket.co.in"})
    sig, adv = decide(user["id"])["allowed"], _advisor(user["id"])
    return {k: (who == "all" or (who == "sig" and sig) or (who == "adv" and adv)) for k, (_, who) in PAGES.items()}


@router.get("/open", summary="A signed-in AlphaLab address for one page")
async def open_page(page: str, request: Request):
    user = _session_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"detail": "Please log in at alphamarket.co.in"})
    if page not in PAGES:
        return JSONResponse(status_code=404, content={"detail": "Unknown page"})
    path, who = PAGES[page]
    am_id = user["id"]
    sig, adv = decide(am_id)["allowed"], _advisor(am_id)
    if (who == "sig" and not sig) or (who == "adv" and not adv):
        return JSONResponse(status_code=403, content={"locked": True, "kind": who, "detail": MSG[who]})
    hit = _tok.get(am_id)
    if not (hit and time.time() - hit[0] < _TOK_S and hit[3] == sig and hit[4] == adv):
        secret = _secret()
        if len(secret) < 32:
            return JSONResponse(status_code=503, content={"detail": "AlphaLab sign-in is not configured"})
        body = json.dumps({"am_user_id": str(am_id), "name": user.get("username") or user.get("email") or "DYOR user",
                           "signals": sig, "advisor": adv}).encode()
        ts = str(int(time.time()))
        mac = hmac.new(secret, ts.encode() + b"\n" + body, hashlib.sha256).hexdigest()
        try:
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.post(AL + "/api/sso/dyor", content=body,
                                 headers={"Content-Type": "application/json", "X-DYOR-TS": ts, "X-DYOR-SIG": mac})
        except Exception as e:
            return JSONResponse(status_code=502, content={"detail": f"AlphaLab did not answer ({type(e).__name__})"})
        if r.status_code != 200:
            return JSONResponse(status_code=502, content={"detail": f"AlphaLab sign-in failed (HTTP {r.status_code})"})
        d = r.json()
        hit = (time.time(), d["token"], d["me"], sig, adv)
        _tok[am_id] = hit
    frag = urllib.parse.urlencode({"t": hit[1], "me": json.dumps(hit[2]), "next": path})
    return {"url": f"{AL}/new/sso#{frag}"}
