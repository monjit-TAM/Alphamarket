/**
 * server/broker-integrations/core/validation.ts
 *
 * Pre-flight data validation. If any validator returns errors, the publish is
 * aborted with a `validation_failed` status and the specific field/reason is
 * logged. No garbage goes on the wire to XTS.
 *
 * This catches problems at the source — e.g., the ICICIBANK row we saw with
 * segment=Future but call_put=Put (garbage data that was silently sent).
 */

import type {
  InternalCall, InternalPosition, InternalStrategy, InternalAdvisor,
  ValidationError
} from "./types";

// ─── Helpers ───────────────────────────────────────────────────────────

function asNum(v: any): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function isNonEmptyString(v: any): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function pickFirst<T>(...values: (T | null | undefined)[]): T | null {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== "") return v as T;
  }
  return null;
}

// ─── Equity call validation ──────────────────────────────────────────

export function validateEquityCall(
  call: InternalCall,
  strategy: InternalStrategy,
  advisor: InternalAdvisor
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required identifiers
  if (!isNonEmptyString(call.id)) {
    errors.push({ field: "call.id", reason: "required" });
  }

  const symbol = pickFirst<string>(call.symbol, call.stockName, call.stock_name);
  if (!isNonEmptyString(symbol)) {
    errors.push({ field: "call.symbol", reason: "required (symbol/stock_name must be non-empty)" });
  } else if (!/^[A-Z0-9&\-]+$/i.test(symbol!)) {
    errors.push({ field: "call.symbol", reason: "invalid characters", value: symbol });
  }

  // Strategy
  if (!isNonEmptyString(strategy.id)) {
    errors.push({ field: "strategy.id", reason: "required" });
  }
  if (!isNonEmptyString(strategy.name)) {
    errors.push({ field: "strategy.name", reason: "required" });
  }

  // Advisor
  if (!isNonEmptyString(advisor.id)) {
    errors.push({ field: "advisor.id", reason: "required" });
  }
  const advisorName = pickFirst<string>(advisor.company_name, advisor.companyName, advisor.username);
  if (!isNonEmptyString(advisorName)) {
    errors.push({ field: "advisor.name", reason: "required (company_name or username must be non-empty)" });
  }

  // Prices — for a BUY call, we need at least one of: entry_price, buy_range_start
  const entryPrice = asNum(pickFirst(call.entry_price, call.entryPrice));
  const buyRangeStart = asNum(pickFirst(call.buy_range_start, call.buyRangeStart));
  if (entryPrice == null && buyRangeStart == null) {
    errors.push({
      field: "call.entry_price/buy_range_start",
      reason: "at least one must be present to publish a call"
    });
  }

  // Target and stop loss are strongly recommended but not technically required.
  // We allow nulls but flag it as a warning via metadata (not an error).

  return errors;
}

// ─── F&O position validation ──────────────────────────────────────────

export function validateFnoPosition(
  position: InternalPosition,
  strategy: InternalStrategy,
  advisor: InternalAdvisor
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isNonEmptyString(position.id)) {
    errors.push({ field: "position.id", reason: "required" });
  }

  if (!isNonEmptyString(position.symbol)) {
    errors.push({ field: "position.symbol", reason: "required" });
  }

  const segment = position.segment;
  const validSegments = ["Option", "Future", "Equity", "Basket", "Commodity"];
  if (!isNonEmptyString(segment) || !validSegments.includes(segment!)) {
    errors.push({
      field: "position.segment",
      reason: `must be one of ${validSegments.join("|")}`,
      value: segment
    });
  }

  const callPut = pickFirst<string>(position.call_put, position.callPut);
  const isOption = segment === "Option";

  // CRITICAL: Consistency check — Future should NOT have call_put set,
  // Option MUST have call_put set to Call or Put.
  if (isOption) {
    if (!isNonEmptyString(callPut)) {
      errors.push({
        field: "position.call_put",
        reason: "required when segment=Option (must be Call or Put)"
      });
    } else {
      const normalized = callPut!.toUpperCase();
      if (!["CALL", "PUT", "CE", "PE", "C", "P"].includes(normalized)) {
        errors.push({
          field: "position.call_put",
          reason: "must be Call|Put|CE|PE",
          value: callPut
        });
      }
    }

    // Option requires strike price
    const strike = asNum(pickFirst(position.strike_price, position.strikePrice));
    if (strike == null || strike <= 0) {
      errors.push({
        field: "position.strike_price",
        reason: "required for Option (must be > 0)",
        value: position.strike_price
      });
    }
  } else if (segment === "Future") {
    // Future must NOT have call_put. If it does, data is corrupt (e.g., ICICIBANK Apr 13 case)
    if (isNonEmptyString(callPut)) {
      errors.push({
        field: "position.call_put",
        reason: "must be null for Future (data corruption — Futures have no Call/Put)",
        value: callPut
      });
    }
  }

  // Expiry for F&O
  if (isOption || segment === "Future") {
    if (!position.expiry) {
      errors.push({
        field: "position.expiry",
        reason: `required for segment=${segment}`
      });
    }
  }

  // Entry price and lots
  const entryPrice = asNum(pickFirst(position.entry_price, position.entryPrice));
  if (entryPrice == null || entryPrice <= 0) {
    errors.push({
      field: "position.entry_price",
      reason: "required (must be > 0)",
      value: position.entry_price
    });
  }

  const lots = position.lots;
  if (lots != null && (!Number.isInteger(lots) || lots < 1)) {
    errors.push({
      field: "position.lots",
      reason: "must be a positive integer if provided",
      value: lots
    });
  }

  // Strategy/advisor — same checks as equity
  if (!isNonEmptyString(strategy.id)) {
    errors.push({ field: "strategy.id", reason: "required" });
  }
  if (!isNonEmptyString(strategy.name)) {
    errors.push({ field: "strategy.name", reason: "required" });
  }
  if (!isNonEmptyString(advisor.id)) {
    errors.push({ field: "advisor.id", reason: "required" });
  }
  const advisorName = pickFirst<string>(advisor.company_name, advisor.companyName, advisor.username);
  if (!isNonEmptyString(advisorName)) {
    errors.push({ field: "advisor.name", reason: "required" });
  }

  return errors;
}

// ─── Normalization helpers (used by payload builders after validation passes) ───

/**
 * Normalize call_put value to XTS standard CE/PE.
 * Accepts Call|Put|CALL|PUT|CE|PE|C|P (case-insensitive) and returns CE or PE.
 */
export function normalizeOptionType(callPut: string): "CE" | "PE" {
  const s = callPut.toUpperCase().trim();
  if (s.startsWith("C")) return "CE";
  if (s.startsWith("P")) return "PE";
  throw new Error(`Cannot normalize option type: ${callPut}`);
}

/**
 * Normalize BUY/SELL side.
 */
export function normalizeOrderSide(side: string): "BUY" | "SELL" {
  const s = (side || "").toUpperCase().trim();
  return s.startsWith("S") ? "SELL" : "BUY";
}

/**
 * Format expiry date to XTS format: "DD MMM YYYY" (e.g., "28 Apr 2026").
 */
export function formatExpiry(expiry: string | Date): string {
  const d = new Date(expiry);
  if (isNaN(d.getTime())) throw new Error(`Invalid expiry: ${expiry}`);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

/**
 * Sanitize theory text: strip non-ASCII (XTS may not handle Unicode well),
 * truncate to max length.
 */
export function sanitizeTheory(text: string | null | undefined, maxChars: number): string {
  if (!text) return "";
  return text.replace(/[^\x20-\x7E\n]/g, "").substring(0, maxChars);
}
