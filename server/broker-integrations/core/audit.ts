/**
 * server/broker-integrations/core/audit.ts
 *
 * Centralized audit logging for broker publish attempts.
 * Writes to xts_publish_log (for backward compatibility — one day we rename
 * this table to broker_publish_log and generalize).
 *
 * Every publish attempt — success, error, skipped, or validation_failed —
 * produces exactly one row. Never silently drops a record.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import type { BrokerEvent, AdapterResult } from "./types";

export async function logPublishAttempt(
  brokerConnectionId: string,
  event: BrokerEvent,
  payload: any,
  result: AdapterResult
): Promise<void> {
  const callId = event.call?.id ?? event.position?.id ?? "unknown";
  const symbol =
    event.call?.symbol ??
    event.call?.stock_name ??
    event.call?.stockName ??
    event.position?.symbol ??
    "unknown";
  const messageId = payload?.messageID ?? callId;
  const strategyId = event.strategy.id;
  const advisorId = event.advisorId;

  let status: string;
  let errorMessage: string | null = null;
  let responseJson: any = null;

  switch (result.status) {
    case "success":
      status = "success";
      responseJson = result.response;
      break;
    case "error":
      status = "error";
      responseJson = result.response;
      errorMessage = result.errorMessage;
      break;
    case "validation_failed":
      status = "validation_failed";
      errorMessage = result.errors
        .map(e => `${e.field}: ${e.reason}${e.value !== undefined ? ` (got: ${JSON.stringify(e.value)})` : ""}`)
        .join(" | ");
      responseJson = { validation_errors: result.errors };
      break;
    case "skipped":
      status = "skipped";
      errorMessage = result.reason;
      break;
    case "network_error":
      status = "error";
      errorMessage = result.errorMessage;
      responseJson = { network_error: result.errorMessage };
      break;
  }

  try {
    await db.execute(sql`
      INSERT INTO xts_publish_log (
        broker_connection_id, call_id, call_type, event_type, message_id,
        symbol, advisor_id, strategy_id,
        payload, response, status, error_message, retry_count, published_at
      ) VALUES (
        ${brokerConnectionId},
        ${callId},
        ${event.callType},
        ${event.eventType},
        ${messageId},
        ${symbol},
        ${advisorId},
        ${strategyId},
        ${JSON.stringify(payload ?? {})}::jsonb,
        ${JSON.stringify(responseJson ?? {})}::jsonb,
        ${status},
        ${errorMessage},
        0,
        NOW()
      )
    `);
  } catch (err: any) {
    // Logging must never throw upward — but we want to know if it fails.
    console.error("[broker-audit] Failed to write publish log:", err.message);
  }
}

/**
 * Structured console logger with a consistent prefix so production logs
 * are easy to grep.
 */
export function adapterLog(broker: string, msg: string, meta?: any) {
  const suffix = meta ? " " + JSON.stringify(meta) : "";
  console.log(`[${broker}] ${msg}${suffix}`);
}

export function adapterError(broker: string, msg: string, err?: any) {
  const suffix = err ? ` :: ${err?.message ?? err}` : "";
  console.error(`[${broker}] ${msg}${suffix}`);
}
