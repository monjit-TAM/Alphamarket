/**
 * server/broker-integrations/xts/adapter.ts
 *
 * The XTS adapter. Orchestrates:
 *  1. Fetch credentials from broker_connections
 *  2. Check per-advisor/per-strategy mapping
 *  3. Validate data
 *  4. Build payload (config-driven)
 *  5. Publish to XTS with auth
 *  6. Handle token refresh on 401
 *  7. Write audit log
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";

import type {
  BrokerAdapter, BrokerEvent, AdapterResult,
  InternalCall, InternalPosition, InternalStrategy, InternalAdvisor,
} from "../core/types";
import { ValidationFailure } from "../core/types";
import { validateEquityCall, validateFnoPosition, normalizeOptionType } from "../core/validation";
import { httpRequest } from "../core/http";
import { adapterLog, adapterError, logPublishAttempt } from "../core/audit";

import { XTS_ENDPOINTS, XTS_TIMEOUTS, XTS_SUCCESS_CODES } from "./spec";
import { getToken, invalidateToken, isAuthFailure } from "./auth";
import { buildEquityCallPayload, buildFnoPositionPayload, type BuildConfig, type XtsPayload } from "./payload-builder";
import { buildConfigFromDb, PRESET_CURRENT } from "./config";
import { lookupEquity, lookupFuture, lookupOption, InstrumentNotFound } from "./instrument-lookup";

// ─── DB row shapes ───────────────────────────────────────────────

interface BrokerConnection {
  id: string;
  name: string;
  broker_type: string;
  base_url: string;
  vendor_code: string;
  vendor_key: string;
  is_enabled: boolean;
  payload_config?: any;     // jsonb (optional new column)
}

interface AdvisorMapping {
  advisor_id: string;
  is_enabled: boolean;
  push_equity_calls: boolean;
  push_fno_positions: boolean;
  push_basket: boolean;
}

interface StrategyMapping {
  strategy_id: string;
  is_enabled: boolean;
  custom_strategy_name: string | null;
}

// ─── DB helpers ──────────────────────────────────────────────────

async function getActiveXtsConnection(): Promise<BrokerConnection | null> {
  const result = await db.execute(sql`
    SELECT id, name, broker_type, base_url, vendor_code, vendor_key, is_enabled
    FROM broker_connections
    WHERE broker_type = 'XTS' AND is_enabled = true
    LIMIT 1
  `);
  return (result.rows[0] as unknown as BrokerConnection) ?? null;
}

async function getAdvisorMapping(
  connId: string, advisorId: string
): Promise<AdvisorMapping | null> {
  const result = await db.execute(sql`
    SELECT advisor_id, is_enabled, push_equity_calls, push_fno_positions, push_basket
    FROM broker_advisor_mappings
    WHERE broker_connection_id = ${connId}
      AND advisor_id = ${advisorId}
      AND is_enabled = true
  `);
  return (result.rows[0] as unknown as AdvisorMapping) ?? null;
}

async function getStrategyMapping(
  connId: string, strategyId: string
): Promise<StrategyMapping | null> {
  const result = await db.execute(sql`
    SELECT strategy_id, is_enabled, custom_strategy_name
    FROM broker_strategy_mappings
    WHERE broker_connection_id = ${connId}
      AND strategy_id = ${strategyId}
      AND is_enabled = true
  `);
  return (result.rows[0] as unknown as StrategyMapping) ?? null;
}

// ─── Adapter ────────────────────────────────────────────────────

class XtsAdapter implements BrokerAdapter {
  public readonly brokerType = "XTS";

  async publish(event: BrokerEvent): Promise<AdapterResult> {
    // 1. Active connection
    const conn = await getActiveXtsConnection();
    if (!conn) {
      return { status: "skipped", reason: "No active XTS broker connection" };
    }

    // 2. Advisor permission
    const advisorMapping = await getAdvisorMapping(conn.id, event.advisorId);
    if (!advisorMapping) {
      const result: AdapterResult = { status: "skipped", reason: "Advisor not mapped for XTS" };
      await logPublishAttempt(conn.id, event, {}, result);
      return result;
    }

    if (event.callType === "EQUITY_CALL" && !advisorMapping.push_equity_calls) {
      const result: AdapterResult = { status: "skipped", reason: "Advisor disabled for equity calls" };
      await logPublishAttempt(conn.id, event, {}, result);
      return result;
    }
    if (event.callType === "FNO_POSITION" && !advisorMapping.push_fno_positions) {
      const result: AdapterResult = { status: "skipped", reason: "Advisor disabled for F&O positions" };
      await logPublishAttempt(conn.id, event, {}, result);
      return result;
    }

    // 3. Strategy mapping (optional — if missing, still publish with default name)
    const strategyMapping = await getStrategyMapping(conn.id, event.strategy.id);

    // 4. Validate data
    const validationErrors =
      event.callType === "EQUITY_CALL"
        ? validateEquityCall(event.call!, event.strategy, event.advisor)
        : validateFnoPosition(event.position!, event.strategy, event.advisor);

    if (validationErrors.length > 0) {
      const result: AdapterResult = { status: "validation_failed", errors: validationErrors };
      await logPublishAttempt(conn.id, event, {}, result);
      adapterError("XTS", `Validation failed for ${event.callType} ${event.position?.symbol ?? event.call?.symbol}`,
        new Error(validationErrors.map(e => `${e.field}: ${e.reason}`).join("; ")));
      return result;
    }

    // 5. Build payload
    const config: BuildConfig = {
      ...buildConfigFromDb(conn.payload_config ?? PRESET_CURRENT),
      strategyNameOverride: strategyMapping?.custom_strategy_name ?? null,
    };

    let payload: XtsPayload;
    try {
      payload =
        event.callType === "EQUITY_CALL"
          ? await buildPayloadForCall(event.call!, event.strategy, event.advisor, config, event.eventType)
          : await buildPayloadForPosition(event.position!, event.strategy, event.advisor, config, event.eventType);
    } catch (err: any) {
      const result: AdapterResult = {
        status: "validation_failed",
        errors: [{ field: "payload_build", reason: err.message ?? String(err) }],
      };
      await logPublishAttempt(conn.id, event, {}, result);
      return result;
    }

    // 6. Publish (with single retry on auth failure)
    const result = await publishToXts(conn, payload);
    await logPublishAttempt(conn.id, event, payload, result);

    const symbol = event.call?.symbol ?? event.position?.symbol ?? "";
    if (result.status === "success") {
      adapterLog("XTS", `✓ Published ${event.eventType} ${symbol}`);
    } else if (result.status === "error") {
      adapterError("XTS", `✗ Failed ${event.eventType} ${symbol}: ${result.errorMessage}`);
    } else if (result.status === "network_error") {
      adapterError("XTS", `✗ Network ${event.eventType} ${symbol}: ${result.errorMessage}`);
    }
    return result;
  }
}

// ─── Payload build with instrument lookup if needed ────────────

async function buildPayloadForCall(
  call: InternalCall,
  strategy: InternalStrategy,
  advisor: InternalAdvisor,
  config: BuildConfig,
  eventType: any
): Promise<XtsPayload> {
  const symbol = call.symbol ?? call.stockName ?? call.stock_name ?? "";
  let instrument = null;
  if (config.instrumentIdStrategy !== "symbol") {
    try {
      instrument = await lookupEquity(symbol);
    } catch (err) {
      if (err instanceof InstrumentNotFound) {
        adapterLog("XTS", `Instrument lookup failed, falling back to symbol: ${symbol}`);
        instrument = null;
      } else throw err;
    }
  }
  return buildEquityCallPayload(call, strategy, advisor, instrument, config, eventType);
}

async function buildPayloadForPosition(
  pos: InternalPosition,
  strategy: InternalStrategy,
  advisor: InternalAdvisor,
  config: BuildConfig,
  eventType: any
): Promise<XtsPayload> {
  let instrument = null;
  if (config.instrumentIdStrategy !== "symbol") {
    try {
      const symbol = pos.symbol ?? "";
      if (pos.segment === "Future") {
        instrument = await lookupFuture(symbol, pos.expiry!);
      } else if (pos.segment === "Option") {
        const optType = normalizeOptionType(pos.call_put ?? pos.callPut ?? "");
        const strike = Number(pos.strike_price ?? pos.strikePrice);
        instrument = await lookupOption(symbol, pos.expiry!, strike, optType);
      } else {
        instrument = await lookupEquity(symbol);
      }
    } catch (err) {
      if (err instanceof InstrumentNotFound) {
        const symbol = pos.symbol ?? "";
        adapterLog("XTS", `Instrument lookup failed, falling back to symbol: ${symbol}`);
        instrument = null;
      } else throw err;
    }
  }
  return buildFnoPositionPayload(pos, strategy, advisor, instrument, config, eventType);
}

// ─── HTTP publish with auth retry ─────────────────────────────

async function publishToXts(
  conn: BrokerConnection,
  payload: XtsPayload
): Promise<AdapterResult> {
  const creds = {
    connectionId: conn.id,
    baseUrl: conn.base_url,
    vendorCode: conn.vendor_code,
    vendorKey: conn.vendor_key,
  };

  // First attempt
  let token: string;
  try {
    token = await getToken(creds);
  } catch (err: any) {
    return { status: "network_error", errorMessage: `getToken failed: ${err.message ?? err}` };
  }

  const url = `${conn.base_url.replace(/\/$/, "")}${XTS_ENDPOINTS.publishWebhook}`;
  const doRequest = async (t: string) => httpRequest({
    url, method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": t },
    body: payload,
    timeoutMs: XTS_TIMEOUTS.publishMs,
  });

  let http = await doRequest(token);

  // Retry once if auth failed
  if (http.status === 0) {
    return { status: "network_error", errorMessage: http.networkError ?? "unknown" };
  }
  if (isAuthFailure(http.status, http.body)) {
    adapterLog("XTS", "Auth failed on publish, refreshing token and retrying");
    invalidateToken(conn.id);
    try {
      token = await getToken(creds);
    } catch (err: any) {
      return { status: "network_error", errorMessage: `retry getToken failed: ${err.message ?? err}` };
    }
    http = await doRequest(token);
    if (http.status === 0) {
      return { status: "network_error", errorMessage: http.networkError ?? "unknown" };
    }
  }

  // Interpret response
  const body = http.body;
  if (body?.type === "success") {  // XTS's `type` field is authoritative
    return { status: "success", response: body };
  }
  const snippet = JSON.stringify(body ?? http.rawText ?? {}).slice(0, 500);
  return { status: "error", response: body ?? http.rawText, errorMessage: snippet };
}

// ─── Exported singleton ───────────────────────────────────────

export const xtsAdapter = new XtsAdapter();
