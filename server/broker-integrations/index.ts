/**
 * server/broker-integrations/index.ts
 *
 * Entry point. Wires the new adapter stack into the existing event pipeline.
 *
 * Feature flag: USE_NEW_BROKER_ADAPTER environment variable (default false).
 * - When false: do nothing (existing xts-bridge.ts handles events as before).
 * - When true : new adapter handles XTS events.
 *
 * Future: add Upstox and Dreamstreet adapters to ADAPTERS map.
 */

import type { BrokerEvent, InternalCall, InternalPosition, InternalStrategy, InternalAdvisor, BrokerEventType } from "./core/types";
import { xtsAdapter } from "./xts/adapter";
import { adapterLog, adapterError } from "./core/audit";
import { db } from "../db";
import { sql } from "drizzle-orm";

// Feature flag
export const USE_NEW_BROKER_ADAPTER =
  (process.env.USE_NEW_BROKER_ADAPTER ?? "").toLowerCase() === "true";

// Adapter registry — broker_type → adapter instance
const ADAPTERS: Record<string, typeof xtsAdapter> = {
  XTS: xtsAdapter,
};

/**
 * Dispatch an event to all enabled brokers.
 * Each broker is called independently; one broker's failure does not affect others.
 */
export async function dispatchToBrokers(event: BrokerEvent): Promise<void> {
  const results = await Promise.allSettled(
    Object.values(ADAPTERS).map(adapter => adapter.publish(event))
  );
  for (const r of results) {
    if (r.status === "rejected") {
      adapterError("broker-dispatch", "Adapter threw unexpectedly", r.reason);
    }
  }
}

/**
 * Drop-in replacement for handleXTSEvent. Signature matches the old bridge
 * so existing call sites can switch behind the feature flag.
 *
 * When USE_NEW_BROKER_ADAPTER=false, this is a no-op — allowing the old
 * bridge to continue running unchanged in parallel.
 */
export async function handleBrokerEvent(
  event: BrokerEventType,
  data: Record<string, any>,
  advisorId: string
): Promise<void> {
  if (!USE_NEW_BROKER_ADAPTER) return;

  // Normalize upstream field names. webhook-dispatcher's buildCallEventData/buildPositionEventData
  // use `uid` and camelCase (stockName); our validator checks `id` primarily with pickFirst fallbacks.
  // Only `uid`→`id` needs explicit mapping; others are handled by pickFirst in validators.
  if (data && (data as any).uid && !(data as any).id) {
    (data as any).id = (data as any).uid;
  }

  try {
    // Load strategy + advisor (one query)
    const res = await db.execute(sql`
      SELECT s.id, s.advisor_id, s.name, s.type, s.description, s.theme, s.benchmark,
             s.volatility, s.horizon, s.management_style, s.key_sectors,
             u.username, u.company_name, u.email, u.sebi_reg_number, u.logo_url, u.sebi_cert_url
      FROM strategies s
      JOIN users u ON u.id = s.advisor_id
      WHERE s.id = ${data.strategyId}
    `);
    const row = res.rows[0] as any;
    if (!row) {
      adapterError("broker-dispatch", `Strategy not found: ${data.strategyId}`);
      return;
    }

    const strategy: InternalStrategy = {
      id: row.id,
      advisor_id: row.advisor_id,
      name: row.name,
      type: row.type,
      description: row.description,
      theme: row.theme,
      benchmark: row.benchmark,
      volatility: row.volatility,
      horizon: row.horizon,
      management_style: row.management_style,
      key_sectors: row.key_sectors,
    };

    const advisor: InternalAdvisor = {
      id: row.advisor_id,
      username: row.username,
      company_name: row.company_name,
      email: row.email,
      sebi_reg_number: row.sebi_reg_number,
      logo_url: row.logo_url,
      sebi_cert_url: row.sebi_cert_url,
    };

    const isFnO =
      data.type === "FnO" ||
      data.segment === "Option" ||
      data.segment === "Future";

    const brokerEvent: BrokerEvent = {
      eventType: event,
      callType: isFnO ? "FNO_POSITION" : "EQUITY_CALL",
      call: isFnO ? undefined : (data as InternalCall),
      position: isFnO ? (data as InternalPosition) : undefined,
      strategy,
      advisor,
      advisorId,
    };

    await dispatchToBrokers(brokerEvent);
  } catch (err: any) {
    adapterError("broker-dispatch", `Error handling ${event}`, err);
  }
}

/**
 * Called at server startup — log which mode is active and perform warmup.
 */
export function initBrokerAdapters(): void {
  if (USE_NEW_BROKER_ADAPTER) {
    adapterLog("broker-dispatch", "✓ NEW broker adapter stack ENABLED (XTS)");
  } else {
    adapterLog("broker-dispatch", "NEW broker adapter stack disabled (set USE_NEW_BROKER_ADAPTER=true to enable)");
  }
}

// Re-exports for convenience
export { xtsAdapter } from "./xts/adapter";
export type { BrokerEvent, BrokerEventType, AdapterResult } from "./core/types";
