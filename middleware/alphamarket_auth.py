"""
Auth Bridge: Validates AlphaMarket session cookies in DYOR FastAPI backend.

Flow:
1. Read connect.sid cookie
2. Parse express-session format (s:SESSION_ID.SIGNATURE)
3. Query alphamarket_db.sessions to validate
4. Extract userId from session JSON
5. Look up user in alphamarket_db.users
6. Create/find matching user in dyor_db.users
7. Inject user into request state
"""

import json
import logging
from urllib.parse import unquote

import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger("dyor.auth_bridge")

ALPHAMARKET_DB_URL = "postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db"

# Routes that don't require authentication
PUBLIC_PATHS = {
    "/api/docs", "/api/openapi.json", "/api/redoc",
    "/docs", "/openapi.json", "/redoc",
    "/api/health", "/health",
    "/api/arbitrage/kite-callback", "/api/arbitrage/kite-status", "/api/arbitrage/kite-login",
    "/api/trading/jobbing/calculator", "/api/trading/scalping/calculator",
}


def parse_connect_sid(raw_cookie: str) -> str | None:
    """Parse express-session cookie: s:SESSION_ID.SIGNATURE → SESSION_ID"""
    if not raw_cookie:
        return None
    decoded = unquote(raw_cookie)
    if decoded.startswith("s:"):
        decoded = decoded[2:]
    session_id = decoded.split(".")[0]
    return session_id if session_id else None


def get_alphamarket_user(session_id: str) -> dict | None:
    """Validate session and return AlphaMarket user info."""
    try:
        conn = psycopg2.connect(ALPHAMARKET_DB_URL)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Look up session (table is 'sessions' plural)
        cur.execute(
            "SELECT sess FROM sessions WHERE sid = %s AND expire > NOW()",
            (session_id,)
        )
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return None

        sess_data = row["sess"]
        if isinstance(sess_data, str):
            sess_data = json.loads(sess_data)

        # Extract userId from session (format: {"cookie": {...}, "userId": "uuid"})
        user_id = sess_data.get("userId")
        if not user_id:
            cur.close()
            conn.close()
            return None

        # Look up user details
        cur.execute(
            "SELECT id, email, username FROM users WHERE id = %s",
            (user_id,)
        )
        user = cur.fetchone()
        cur.close()
        conn.close()

        return dict(user) if user else None

    except psycopg2.Error as e:
        logger.error(f"Auth bridge DB error: {e}")
        return None


def find_or_create_dyor_user(am_user: dict, dyor_db_url: str) -> dict | None:
    """Find or create a DYOR user linked to this AlphaMarket account."""
    try:
        conn = psycopg2.connect(dyor_db_url)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Check if user already exists by alphamarket_id
        cur.execute(
            "SELECT * FROM users WHERE alphamarket_id = %s LIMIT 1",
            (am_user["id"],)
        )
        existing = cur.fetchone()
        if existing:
            cur.close()
            conn.close()
            return dict(existing)

        # Also check by email
        cur.execute(
            "SELECT * FROM users WHERE email = %s LIMIT 1",
            (am_user["email"],)
        )
        existing = cur.fetchone()
        if existing:
            # Link to alphamarket_id
            cur.execute(
                "UPDATE users SET alphamarket_id = %s WHERE id = %s",
                (am_user["id"], existing["id"])
            )
            conn.commit()
            cur.close()
            conn.close()
            existing["alphamarket_id"] = am_user["id"]
            return dict(existing)

        # Create new user
        cur.execute(
            """INSERT INTO users (email, name, password_hash, is_active, alphamarket_id)
               VALUES (%s, %s, %s, true, %s)
               RETURNING *""",
            (
                am_user["email"],
                am_user.get("username", am_user["email"].split("@")[0]),
                "ALPHAMARKET_BRIDGE_NO_PASSWORD",
                am_user["id"],
            )
        )
        new_user = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        return dict(new_user) if new_user else None

    except psycopg2.Error as e:
        logger.error(f"DYOR user sync error: {e}")
        return None


class AlphaMarketAuthMiddleware(BaseHTTPMiddleware):
    """Middleware: authenticate DYOR requests via AlphaMarket session cookie."""

    def __init__(self, app, dyor_db_url: str):
        super().__init__(app)
        self.dyor_db_url = dyor_db_url

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip auth for public routes
        if path in PUBLIC_PATHS or path.startswith("/api/docs") or path.startswith("/api/trading/") or path.startswith("/api/arbitrage/"):
            return await call_next(request)

        # Skip OPTIONS (CORS preflight)
        if request.method == "OPTIONS":
            return await call_next(request)

        # Read connect.sid cookie
        raw_sid = request.cookies.get("connect.sid")
        logger.warning(f"AUTH DEBUG: path={path}, cookies={list(request.cookies.keys())}, raw_sid={'yes' if raw_sid else 'no'}, cookie_header={request.headers.get('cookie','NONE')[:80]}")
        if not raw_sid:
            return JSONResponse(
                status_code=401,
                content={"detail": "Not authenticated. Please log in at alphamarket.co.in"}
            )

        # Parse and validate
        session_id = parse_connect_sid(raw_sid)
        if not session_id:
            return JSONResponse(status_code=401, content={"detail": "Invalid session"})

        am_user = get_alphamarket_user(session_id)
        if not am_user:
            return JSONResponse(status_code=401, content={"detail": "Session expired. Please log in again."})

        # Find or create DYOR user
        dyor_user = find_or_create_dyor_user(am_user, self.dyor_db_url)
        if not dyor_user:
            return JSONResponse(status_code=500, content={"detail": "Failed to sync user"})

        # Attach to request state
        request.state.alphamarket_user = am_user
        request.state.dyor_user = dyor_user
        request.state.user_id = dyor_user["id"]

        return await call_next(request)
