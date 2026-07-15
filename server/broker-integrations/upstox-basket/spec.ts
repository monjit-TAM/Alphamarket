/**
 * server/broker-integrations/upstox-basket/spec.ts
 *
 * Constants from the Upstox "Vendor Equity Basket API — Integration Guide"
 * (received 13 Jul 2026). Every literal that appears on the wire lives here.
 * If Upstox revises the spec, this file changes — nowhere else.
 *
 * IMPORTANT: this is a DIFFERENT Upstox surface from the live recommendation
 * webhook. That path (CALL_CREATED / POSITION_CLOSED, X-AlphaMarket-Signature
 * HMAC, broker_webhook_logs) is at 100% success and is NOT touched by anything
 * in this directory.
 *
 *   recommendation webhook : we sign, they verify.  Inbound-credentialed.
 *   basket API             : we send a Bearer token. Outbound-credentialed.
 *
 * They share nothing — not the URL, not the headers, not the payload, not the
 * retry semantics.
 */

// ─── Endpoint ────────────────────────────────────────────────────

/** POST /advisory/v2/{vendorName}/equity-baskets */
export function basketEndpoint(vendorName: string): string {
  return `/advisory/v2/${vendorName}/equity-baskets`;
}

export const UPSTOX_BASKET_BASE_URLS = {
  production: "https://callback.upstox.com",
  staging: "https://callback-uat.upstox.com",
} as const;

// ─── basketStatus ────────────────────────────────────────────────

export const UPSTOX_BASKET_STATUS = {
  CREATED: "CREATED",
  MODIFIED: "MODIFIED",
  REBALANCED: "REBALANCED",
  CLOSED: "CLOSED",
} as const;

export type UpstoxBasketStatus =
  (typeof UPSTOX_BASKET_STATUS)[keyof typeof UPSTOX_BASKET_STATUS];

// ─── Enums ───────────────────────────────────────────────────────

export const UPSTOX_PRODUCT = {
  EQUITY: "EQUITY",
  FNO: "FNO",
  MTF: "MTF",
  MIS: "MIS",
  COMMODITY: "COMMODITY",
} as const;

export const UPSTOX_DIRECTION = {
  BUY: "BUY",
  SELL: "SELL",
  BOTH: "BUY & SELL",
} as const;

/**
 * Segment. Per the spec: "Only NSE_EQ currently resolves — any other value
 * (e.g. NSE_FO, BSE_EQ) will not match."
 *
 * This is why F&O and commodity baskets cannot go through this API at all,
 * regardless of what the `product` enum appears to allow.
 */
export const UPSTOX_SEGMENT = {
  NSE_EQ: "NSE_EQ",
} as const;

// ─── HTTP status semantics ───────────────────────────────────────

/**
 * The retry classification. Getting this wrong is the single most damaging
 * possible bug in this module.
 *
 *   410 — validation failure (weight sum != 1.0, SELL leg on CREATE).
 *         Can NEVER succeed on retry. If this enters an exponential-backoff
 *         loop, we hammer Upstox's gateway forever with a payload that is
 *         definitionally invalid. TERMINAL.
 *
 *   409 — duplicate on creation. We think the basket is new; they already
 *         have it. Retrying CREATE is futile. Reconcile our sync_state to
 *         'created' and re-dispatch as REBALANCED. CONFLICT.
 *
 *   404 — basket not found for MODIFIED/REBALANCED/CLOSED. Our sync_state is
 *         ahead of theirs. Reset to 'never_sent' and re-dispatch as CREATE.
 *         CONFLICT.
 *
 *   400 — unsupported basketStatus. We sent something structurally wrong.
 *         Our bug, not a transient. TERMINAL.
 *
 *   500 — unexpected server error. Spec explicitly notes a non-numeric or
 *         missing minInvestment on CREATED returns 500 rather than a clean
 *         validation error. So a 500 MAY be our fault and permanently
 *         unfixable-by-retry. We pre-validate minInvestment hard (see
 *         basket-validation.ts) precisely so that any 500 reaching here is
 *         plausibly genuine, and only then treat it as retryable.
 */
export const UPSTOX_BASKET_HTTP = {
  TERMINAL: [400, 401, 403, 410, 422],
  CONFLICT: [404, 409],
  // Everything else (5xx, 429, network) is retryable.
} as const;

export function classifyHttpStatus(
  status: number
): "success" | "terminal" | "conflict" | "retryable" {
  if (status >= 200 && status < 300) return "success";
  if ((UPSTOX_BASKET_HTTP.TERMINAL as readonly number[]).includes(status)) return "terminal";
  if ((UPSTOX_BASKET_HTTP.CONFLICT as readonly number[]).includes(status)) return "conflict";
  return "retryable";
}

// ─── Limits / timeouts ───────────────────────────────────────────

export const UPSTOX_BASKET_TIMEOUTS = {
  publishMs: 20_000,
};

/**
 * Rationale cap.
 *
 * The Upstox basket spec does not document a length limit. But Dreamstreet
 * 403s above ~2500 chars on the calls path, and we discovered that the
 * expensive way. Assume brokers have undocumented caps until proven otherwise;
 * truncate on a word boundary rather than discovering the limit in production.
 */
export const UPSTOX_BASKET_LIMITS = {
  maxRationaleChars: 2000,
  maxDescriptionChars: 500,
  minLegs: 1,
  maxLegs: null as number | null,
  /** Spec: weights must sum to exactly 1.0, tolerance +/-0.0001 => 1 bps. */
  weightToleranceBps: 1,
};

/** Truncate on a word boundary and mark it, rather than hard-cutting mid-word. */
export function truncateText(text: string, max: number): string {
  if (!text || text.length <= max) return text;
  const slice = text.slice(0, max - 3);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}...`;
}

/** yyyy-MM-dd'T'HH:mm:ss.SSSX in IST, per the spec's format string. */
export function formatUpstoxDate(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}` +
    `T${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}` +
    `.${p(ist.getUTCMilliseconds(), 3)}+0530`
  );
}
