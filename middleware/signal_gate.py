"""
Advisor-only signals for DYOR.

Options Alpha, AlphaBot, Alpha Ideas (with Conviction and Intraday levels) and Emerging
Leaders are open only to:
  - AlphaMarket admins,
  - advisors whose registration AlphaMarket has approved (users.role='advisor', is_approved),
  - investors an admin has approved (an active user_access_grants row, tool 'dyor_signals').

Everyone else gets HTTP 403 with {"locked": true} and can ask for access. Requests land in
alphamarket_db.signal_access_requests; an admin approves or rejects them from DYOR's admin
page, and an approval writes the access grant.

Server-side callers are not affected: requests that carry the internal service key, and
requests made on this machine without going through nginx (no X-Real-IP header), pass.

Called from AlphaMarketAuthMiddleware.dispatch before anything else. handle() returns a
response to send, or None to carry on as before.
"""
import json
import logging
import os
import time
import urllib.parse
import urllib.request

from psycopg2.extras import RealDictCursor
from starlette.responses import JSONResponse, Response

from middleware.alphamarket_auth import _get_pool, parse_connect_sid, get_alphamarket_user, _INTERNAL_KEY

logger = logging.getLogger("dyor.signal_gate")

TOOL = "dyor_signals"
LOCKED_PREFIXES = (
    "/api/alpha-options/",      # Options Alpha
    "/api/alphabot/",           # AlphaBot
    "/api/alpha-ideas",         # Alpha Ideas (and its log and performance)
    "/api/alpha-conviction",    # Alpha Ideas: Conviction tab
    "/api/intraday-levels",     # Alpha Ideas: Intraday tab
    "/api/emerging-leaders/",   # Emerging Leaders
)
FEATURES = {"/api/alpha-options/": "Options Alpha", "/api/alphabot/": "AlphaBot",
            "/api/alpha-ideas": "Alpha Ideas", "/api/alpha-conviction": "Alpha Ideas",
            "/api/intraday-levels": "Alpha Ideas", "/api/emerging-leaders/": "Emerging Leaders"}
LOCK_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "signal_lock.js")
LOCKED_MSG = ("This feature is for SEBI-registered advisors on AlphaMarket. "
              "You can request access and our team will review it.")

_access_cache = {}          # am user id -> (time, decision dict)
_CACHE_S = 60

SCHEMA = """
CREATE TABLE IF NOT EXISTS signal_access_requests (
  id           SERIAL PRIMARY KEY,
  user_id      VARCHAR NOT NULL,
  email        TEXT,
  username     TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending, approved, rejected
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  decided_at   TIMESTAMP,
  decided_by   VARCHAR,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS signal_access_requests_user ON signal_access_requests (user_id, requested_at DESC);
"""


def _q(sql, args=(), one=False, write=False):
    conn = None
    try:
        conn = _get_pool().getconn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(sql, args)
        rows = cur.fetchall() if cur.description else []
        if write:
            conn.commit()
        cur.close()
        return (rows[0] if rows else None) if one else rows
    except Exception:
        if conn:
            try: conn.rollback()
            except Exception: pass
        raise
    finally:
        if conn:
            try: _get_pool().putconn(conn)
            except Exception: pass


def _session_user(request):
    sid = parse_connect_sid(request.cookies.get("connect.sid") or "")
    return get_alphamarket_user(sid) if sid else None


def _is_internal(request):
    if _INTERNAL_KEY and (request.headers.get("x-internal-key") or "") == _INTERNAL_KEY:
        return True
    # a call made on this server straight to :8001, not through nginx (nginx sets X-Real-IP)
    host = request.client.host if request.client else ""
    return host in ("127.0.0.1", "::1") and not request.headers.get("x-real-ip")


def decide(am_user_id):
    """{allowed, reason, is_admin} for one AlphaMarket user, cached for a minute."""
    hit = _access_cache.get(am_user_id)
    if hit and time.time() - hit[0] < _CACHE_S:
        return hit[1]
    u = _q("SELECT role::text AS role, is_approved FROM users WHERE id = %s", (am_user_id,), one=True) or {}
    role = u.get("role")
    if role == "admin":
        d = {"allowed": True, "reason": "admin", "is_admin": True}
    elif role == "advisor" and u.get("is_approved"):
        d = {"allowed": True, "reason": "approved advisor", "is_admin": False}
    else:
        g = _q("""SELECT id FROM user_access_grants WHERE user_id = %s AND tool = %s AND is_active = true
                   AND (valid_until IS NULL OR valid_until > NOW()) LIMIT 1""", (am_user_id, TOOL), one=True)
        d = {"allowed": bool(g), "reason": "access granted by admin" if g else
             ("advisor not yet approved" if role == "advisor" else "not an advisor"), "is_admin": False}
    _access_cache[am_user_id] = (time.time(), d)
    return d


def _latest_request(am_user_id):
    r = _q("SELECT id, status, requested_at, decided_at FROM signal_access_requests WHERE user_id = %s "
           "ORDER BY requested_at DESC LIMIT 1", (am_user_id,), one=True)
    if not r:
        return None
    return {"id": r["id"], "status": r["status"], "requested_at": str(r["requested_at"])[:16],
            "decided_at": str(r["decided_at"])[:16] if r["decided_at"] else None}


def _notify(text):
    """One line to the ops Telegram chat, if configured. Never blocks the request on failure."""
    try:
        env = {}
        for ln in open("/etc/alpha-alerts.env"):
            if "=" in ln and not ln.strip().startswith("#"):
                k, _, v = ln.strip().partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
        tok = env.get("TELEGRAM_BOT_TOKEN")
        chat = env.get("ALERT_CHAT_ID") or env.get("TELEGRAM_CHAT_ID") or env.get("OPS_CHAT_ID")
        if tok and chat:
            data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode()
            urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/sendMessage", data=data, timeout=5)
    except Exception as e:
        logger.warning(f"signal access notify failed: {e}")


def _feature(path):
    for p, name in FEATURES.items():
        if path.startswith(p):
            return name
    return "this feature"


async def handle(request, path):
    """A response to send now, or None to let the request carry on unchanged."""
    if path == "/api/signals-access/lock.js":
        try:
            return Response(open(LOCK_JS).read(), media_type="application/javascript",
                            headers={"Cache-Control": "no-store"})
        except OSError:
            return Response("", media_type="application/javascript")

    if path.startswith("/api/signals-access/"):
        return await _endpoints(request, path)

    if not path.startswith(LOCKED_PREFIXES) or request.method == "OPTIONS" or _is_internal(request):
        return None

    user = _session_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"locked": True, "logged_in": False,
                            "detail": "Please log in at alphamarket.co.in to use " + _feature(path) + "."})
    try:
        d = decide(user["id"])
    except Exception as e:
        logger.error(f"signal gate check failed: {e}")
        return JSONResponse(status_code=503, content={"locked": True, "detail": "Access check unavailable, please retry."})
    if d["allowed"]:
        return None
    return JSONResponse(status_code=403, content={"locked": True, "logged_in": True, "feature": _feature(path),
                        "detail": LOCKED_MSG, "request": _latest_request(user["id"])})


async def _endpoints(request, path):
    user = _session_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"logged_in": False, "detail": "Please log in at alphamarket.co.in"})
    d = decide(user["id"])

    if path == "/api/signals-access/status":
        return JSONResponse({"logged_in": True, "allowed": d["allowed"], "reason": d["reason"],
                             "is_admin": d["is_admin"], "request": _latest_request(user["id"]),
                             "message": None if d["allowed"] else LOCKED_MSG})

    if path == "/api/signals-access/request" and request.method == "POST":
        if d["allowed"]:
            return JSONResponse({"ok": True, "allowed": True})
        last = _latest_request(user["id"])
        if last and last["status"] == "pending":
            return JSONResponse({"ok": True, "request": last})
        note = ""
        try:
            note = str((await request.json() or {}).get("note") or "")[:500]
        except Exception:
            pass
        _q("INSERT INTO signal_access_requests (user_id, email, username, note) VALUES (%s, %s, %s, %s)",
           (user["id"], user.get("email"), user.get("username"), note or None), write=True)
        _notify(f"DYOR signal access requested by {user.get('email') or user.get('username')}. "
                f"Review it in DYOR > Admin.")
        return JSONResponse({"ok": True, "request": _latest_request(user["id"])})

    if not path.startswith("/api/signals-access/admin/"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    if not d["is_admin"]:
        return JSONResponse(status_code=403, content={"detail": "Admin only"})

    if path == "/api/signals-access/admin/list":
        reqs = _q("""SELECT r.id, r.user_id, r.email, r.username, r.status, r.note, r.requested_at, r.decided_at,
                            r.decided_by, u.role::text AS role
                       FROM signal_access_requests r LEFT JOIN users u ON u.id = r.user_id
                      ORDER BY (r.status = 'pending') DESC, r.requested_at DESC LIMIT 200""")
        grants = _q("""SELECT g.user_id, u.email, u.username, u.role::text AS role, g.granted_by, g.created_at
                         FROM user_access_grants g LEFT JOIN users u ON u.id = g.user_id
                        WHERE g.tool = %s AND g.is_active = true ORDER BY g.created_at DESC""", (TOOL,))
        fix = lambda rows: [{k: (str(v)[:16] if hasattr(v, "isoformat") else v) for k, v in r.items()} for r in rows]
        return JSONResponse({"requests": fix(reqs), "grants": fix(grants)})

    if request.method != "POST":
        return JSONResponse(status_code=405, content={"detail": "POST only"})
    try:
        body = await request.json() or {}
    except Exception:
        body = {}

    if path == "/api/signals-access/admin/decide":
        rid, action = body.get("id"), body.get("action")
        if action not in ("approve", "reject"):
            return JSONResponse(status_code=400, content={"detail": "action must be approve or reject"})
        r = _q("SELECT * FROM signal_access_requests WHERE id = %s", (rid,), one=True)
        if not r:
            return JSONResponse(status_code=404, content={"detail": "No such request"})
        _q("UPDATE signal_access_requests SET status = %s, decided_at = NOW(), decided_by = %s WHERE id = %s",
           ("approved" if action == "approve" else "rejected", user["id"], rid), write=True)
        if action == "approve":
            have = _q("SELECT id FROM user_access_grants WHERE user_id = %s AND tool = %s AND is_active = true",
                      (r["user_id"], TOOL), one=True)
            if not have:
                _q("""INSERT INTO user_access_grants (user_id, tool, grant_type, note, granted_by, is_active, created_at)
                      VALUES (%s, %s, 'full', %s, %s, true, NOW())""",
                   (r["user_id"], TOOL, f"DYOR signals, request {rid}", user["id"]), write=True)
        _access_cache.pop(r["user_id"], None)
        return JSONResponse({"ok": True})

    if path == "/api/signals-access/admin/revoke":
        uid = body.get("user_id")
        _q("UPDATE user_access_grants SET is_active = false WHERE user_id = %s AND tool = %s", (uid, TOOL), write=True)
        _access_cache.pop(uid, None)
        return JSONResponse({"ok": True})

    return JSONResponse(status_code=404, content={"detail": "Not found"})
