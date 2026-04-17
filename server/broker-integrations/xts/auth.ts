/**
 * server/broker-integrations/xts/auth.ts
 *
 * XTS JWT session token management.
 *
 * Key design decisions vs old bridge:
 * - Cache keyed by broker_connection.id (not module-level variable).
 *   Multiple XTS connections (different vendors) don't fight over one cache slot.
 * - Refresh buffer is based on JWT's actual exp claim, not a hardcoded 30 minutes.
 * - Token DB persistence is optional (Postgres may be slow on write); memory cache
 *   is the primary, DB cache is a best-effort write for diagnostics.
 * - On 401 or session-expired error, caller invalidates and requests a new one.
 */

import { httpRequest } from "../core/http";
import { XTS_ENDPOINTS, XTS_TIMEOUTS, XTS_ERROR_CODES } from "./spec";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { adapterLog, adapterError } from "../core/audit";

interface XtsCreds {
  connectionId: string;
  baseUrl: string;
  vendorCode: string;
  vendorKey: string;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;     // absolute epoch ms
  connectionId: string;
}

// Per-connection cache (not a global module-level variable)
const tokenCache = new Map<string, CachedToken>();

// Refresh 2 minutes BEFORE expiry to allow for slow requests
const REFRESH_SAFETY_MARGIN_MS = 2 * 60 * 1000;

/**
 * Decode JWT exp claim (without validating signature — we trust XTS).
 * Returns absolute epoch ms, or null if unparseable.
 */
function decodeJwtExpiryMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64").toString("utf8")
    );
    if (typeof payload.exp === "number") {
      return payload.exp * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch a fresh JWT from XTS. Always makes the network call; does not consult cache.
 */
async function fetchFreshToken(creds: XtsCreds): Promise<string> {
  const url = `${creds.baseUrl.replace(/\/$/, "")}${XTS_ENDPOINTS.sessionToken}`;
  adapterLog("XTS:auth", "Fetching new session token", { connectionId: creds.connectionId });

  const result = await httpRequest({
    url,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { vendorCode: creds.vendorCode, vendorKey: creds.vendorKey },
    timeoutMs: XTS_TIMEOUTS.tokenFetchMs,
  });

  if (result.status === 0) {
    throw new Error(`[XTS:auth] Network error: ${result.networkError}`);
  }

  const token = result.body?.result?.token ?? result.body?.token ?? null;
  if (!token) {
    const snippet = JSON.stringify(result.body ?? result.rawText ?? {}).slice(0, 300);
    throw new Error(`[XTS:auth] Token fetch failed (status=${result.status}): ${snippet}`);
  }
  return token;
}

/**
 * Public: get a valid token for this connection, using cache when possible.
 */
export async function getToken(creds: XtsCreds): Promise<string> {
  const cached = tokenCache.get(creds.connectionId);
  const now = Date.now();

  if (cached && cached.expiresAtMs - REFRESH_SAFETY_MARGIN_MS > now) {
    return cached.token;
  }

  const token = await fetchFreshToken(creds);
  const expiryMs = decodeJwtExpiryMs(token) ?? (now + 23 * 60 * 60 * 1000);

  tokenCache.set(creds.connectionId, {
    token,
    expiresAtMs: expiryMs,
    connectionId: creds.connectionId,
  });

  // Best-effort DB update (for admin UI visibility). Don't block on failure.
  db.execute(sql`
    UPDATE broker_connections
    SET token=${token}, token_issued_at=NOW(),
        last_ping_at=NOW(), last_ping_status='ok', last_ping_error=NULL,
        updated_at=NOW()
    WHERE id=${creds.connectionId}
  `).catch(err => adapterError("XTS:auth", "DB token update failed (non-fatal)", err));

  adapterLog("XTS:auth", "Token refreshed", {
    connectionId: creds.connectionId,
    validForMin: Math.round((expiryMs - now) / 60000),
  });
  return token;
}

/**
 * Explicitly invalidate this connection's cached token.
 * Call this when an XTS response indicates the token is rejected.
 */
export function invalidateToken(connectionId: string): void {
  tokenCache.delete(connectionId);
  adapterLog("XTS:auth", "Token invalidated", { connectionId });
}

/**
 * Is a response body an auth failure?
 */
export function isAuthFailure(httpStatus: number, body: any): boolean {
  if (httpStatus === 401) return true;
  const code = body?.code ?? "";
  if (typeof code === "string") {
    return code.includes("session") || code === XTS_ERROR_CODES.SESSION_EXPIRED;
  }
  return false;
}
