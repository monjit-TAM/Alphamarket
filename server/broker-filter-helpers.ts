/**
 * server/broker-filter-helpers.ts
 *
 * Per-broker scoping filters for v2 pull API handlers in broker-api-v2.ts.
 * Returns Drizzle SQL fragments that compose naturally into existing WHERE clauses
 * via `sql\`... AND ${filter}\`` — mirrors the pattern of existing advisorFilterSql.
 *
 * All filters are pass-through (sql\`TRUE\`) when the broker's allowlist is null/empty,
 * preserving current behavior for existing brokers.
 */

import { sql, SQL } from "drizzle-orm";
import type { BrokerApiKey } from "./broker-api";

// ──────────────────────────────────────────────────────────────────
// Segment filters
// ──────────────────────────────────────────────────────────────────

/**
 * Mapping from our allowed_segments codes to SQL fragments on calls.duration_unit.
 * Called from broker-api-v2 live-calls + strategies/:id/calls handlers.
 *
 * Semantics (matches our internal Duration values):
 *   equity_cash       → duration_unit IS NULL OR duration_unit IN ('Delivery','BTST')
 *   equity_intraday   → duration_unit = 'Intraday'
 *   equity_swing      → duration_unit IN ('Swing','Short Term')
 *   equity_positional → duration_unit IN ('Positional','Long Term','Medium Term')
 *
 * If only F&O segments are allowed (fno_*), returns FALSE → no equity calls.
 */
export function callsSegmentFilterSql(
  broker: BrokerApiKey,
  callsAlias: string = "c",
): SQL {
  const allowed = (broker as any).allowed_segments as string[] | null | undefined;
  if (!allowed || allowed.length === 0) return sql`TRUE`;

  const equity = allowed.filter((s) => s.startsWith("equity_"));
  if (equity.length === 0) {
    // Broker is F&O-only — exclude all equity calls
    return sql`FALSE`;
  }

  const parts: SQL[] = [];

  if (equity.includes("equity_cash")) {
    parts.push(sql.raw(
      `(${callsAlias}.duration_unit IS NULL OR ${callsAlias}.duration_unit IN ('Delivery','BTST'))`
    ));
  }
  if (equity.includes("equity_intraday")) {
    parts.push(sql.raw(`${callsAlias}.duration_unit = 'Intraday'`));
  }
  if (equity.includes("equity_swing")) {
    parts.push(sql.raw(`${callsAlias}.duration_unit IN ('Swing','Short Term')`));
  }
  if (equity.includes("equity_positional")) {
    parts.push(sql.raw(`${callsAlias}.duration_unit IN ('Positional','Long Term','Medium Term')`));
  }

  if (parts.length === 0) return sql`FALSE`;
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * Segment filter for positions table.
 *
 * Positions.segment is one of 'Equity','Future','Option'. Map:
 *   fno_futures  → Future
 *   fno_options  → Option
 *   equity_*     → Equity
 */
export function positionsSegmentFilterSql(
  broker: BrokerApiKey,
  positionsAlias: string = "p",
): SQL {
  const allowed = (broker as any).allowed_segments as string[] | null | undefined;
  if (!allowed || allowed.length === 0) return sql`TRUE`;

  const segIns: string[] = [];
  if (allowed.some((s) => s.startsWith("equity_"))) segIns.push("'Equity'");
  if (allowed.includes("fno_futures")) segIns.push("'Future'");
  if (allowed.includes("fno_options")) segIns.push("'Option'");

  if (segIns.length === 0) return sql`FALSE`;
  return sql.raw(`${positionsAlias}.segment IN (${segIns.join(",")})`);
}

// ──────────────────────────────────────────────────────────────────
// Strategy allowlist
// ──────────────────────────────────────────────────────────────────

/**
 * Strategy allowlist filter — for queries scoped by strategies table alias.
 * Usage in handler: `AND ${strategyAllowlistFilterSql(req.broker!, "s")}`
 */
export function strategyAllowlistFilterSql(
  broker: BrokerApiKey,
  strategiesAlias: string = "s",
): SQL {
  const allowed = (broker as any).allowed_strategies as string[] | null | undefined;
  if (!allowed || allowed.length === 0) return sql`TRUE`;
  return sql`${sql.raw(strategiesAlias + ".id")} = ANY(${allowed})`;
}

/**
 * Same filter but keyed by strategy_id column (for calls / positions queries
 * where strategies table may not be joined).
 */
export function strategyIdAllowlistFilterSql(
  broker: BrokerApiKey,
  strategyIdColumn: string = "c.strategy_id",
): SQL {
  const allowed = (broker as any).allowed_strategies as string[] | null | undefined;
  if (!allowed || allowed.length === 0) return sql`TRUE`;
  return sql`${sql.raw(strategyIdColumn)} = ANY(${allowed})`;
}

// ──────────────────────────────────────────────────────────────────
// Early access check (for handlers that take a specific :strategyId)
// ──────────────────────────────────────────────────────────────────

/**
 * Given a strategy row and a broker, return true if the broker is allowed to see this strategy.
 * Used by /alpha/strategies/:strategyId and /alpha/strategies/:strategyId/calls handlers
 * to return 404 / 403 BEFORE querying child data.
 *
 * (The existing advisorFilterSql already enforces advisor scoping at query time. This
 * function adds the strategy-level check on top of it.)
 */
export function isStrategyAccessible(
  broker: BrokerApiKey,
  strategyId: string,
): boolean {
  const allowed = (broker as any).allowed_strategies as string[] | null | undefined;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(strategyId);
}
