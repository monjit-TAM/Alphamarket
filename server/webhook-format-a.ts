/**
 * server/webhook-format-a.ts
 *
 * Format A payload builder — matches thealphamarket.com's webhook format exactly.
 * Used for brokers integrated against the old backend (Upstox and any future broker
 * requesting backward-compatible shape).
 *
 * Brokers opt-in via broker_api_keys.webhook_payload_version = 'v1_thealphamarket'.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

// ─── Types ──────────────────────────────────────────────────────

export interface EquityCallFormatA {
  exchange: string;
  legId: string;
  legName: string | null;
  symbol: string;
  name: string;
  buyDate: number;
  buyPrice: number;
  buyPriceRangeEnd: number | null;
  buyPriceRangeStart: number | null;
  callType: string;
  profitLossPercent?: number;
  sellPrice: number | null;
  sellDate: number | null;
  targetPriceRange: string | null;
  profitGoal: string | null;
  stopLoss: string | null;
  rational: string | null; // note: no 'e' — thealphamarket's original spelling
  exitType?: string | null;
  rationals: Array<{
    rational: string;
    date: number;
    name: string | null;
    path: string | null;
    fileName: string | null;
    createdBy: string | null;
  }>;
  creationDate: number;
  status: string;
}

export interface FnoCallFormatA {
  exchange: string;
  legId: string;
  legName: string | null;
  symbol: string;
  name: string;
  series: string;
  isStoppLossAbsolute: { code: string; name: string };
  expiryDate: number;
  lotSize: number;
  strike: number;
  profitLossPercent?: number | null;
  optionType: string;
  buyDate: number;
  buyPrice: number;
  buyPriceRangeEnd: number | null;
  buyPriceRangeStart: number | null;
  callType: string;
  sellPrice: number | null;
  sellDate: number | null;
  targetPriceRange: string | null;
  profitGoal: string | null;
  stopLoss: string | null;
  exitType?: string | null;
  rational: string | null;
  rationals: Array<any>;
  creationDate: number;
  status: string;
}

export interface FormatAEnvelope {
  status: string;
  statusCode: number;
  message: { key: string; message: string };
  data: {
    strategyId: string;  // Uses strategies.slug (e.g. "growth-365")
    theme: string[] | null;
    managementStyle: string[] | null;
    volatility: string[] | null;
    marketCap: string[] | null;
    horizon: string[] | null;
    keySector: string[] | null;
    strategyName: string;
    strategyDescription: string | null;
    benchmark: string | null;
    strategyType: string;
    advisorName: string;
    profilePic: string | null;
    certificateURl: string | null; // note: lowercase 'l' per Format A spec
    advisorSebiRegistrationNo: string | null;
    equityCall: EquityCallFormatA | null;
    fnoCall: FnoCallFormatA[] | null;
  };
}

// ─── Helpers ────────────────────────────────────────────────────

/** Convert Date/string to Unix epoch milliseconds (number). Upstox UAT requires epoch millis, not ISO strings. */
function toThealphamarketEpoch(d: Date | string | null | undefined): number {
  if (!d) return Date.now();
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return Date.now();
  return date.getTime();
}

function toStringArray(s: string | null | undefined | string[]): string[] | null {
  if (!s) return null;
  if (Array.isArray(s)) return s.length ? s : null;
  return [String(s)];
}

function numToStr(n: number | string | null | undefined): string | null {
  if (n == null || n === "") return null;
  const num = typeof n === "number" ? n : parseFloat(String(n));
  if (!Number.isFinite(num)) return null;
  return String(num);
}

function toNum(n: number | string | null | undefined): number | null {
  if (n == null || n === "") return null;
  const num = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(num) ? num : null;
}

function mapStatusForEvent(eventType: string, internalStatus: string): string {
  const CLOSING = new Set([
    "CALL_CLOSED", "POSITION_CLOSED",
    "TARGET_ACHIEVED", "STOPLOSS_TRIGGERED", "TRAILING_SL_TRIGGERED",
  ]);
  if (CLOSING.has(eventType)) return "CLOSED";
  if (internalStatus === "Closed") return "CLOSED";
  return "PUBLISHED";
}

function mapExitType(eventType: string, internalStatus: string): string | null {
  switch (eventType) {
    case "TARGET_ACHIEVED": return "TargetAchieved";
    case "STOPLOSS_TRIGGERED": return "StoplossTriggered";
    case "TRAILING_SL_TRIGGERED": return "TrailingSLTriggered";
    case "CALL_CLOSED": return "ManualClose";
    case "POSITION_CLOSED": return "ManualClose";
    default:
      return internalStatus === "Closed" ? "ManualClose" : null;
  }
}

function legIdFromUuid(id: string): string {
  // Format A uses "00807"-style. Our IDs are UUIDs. Default: use first 5 hex chars.
  // If Upstox requires strict counter, swap for a real sequence column.
  const first = String(id || "").replace(/-/g, "").substring(0, 5);
  return first || "00000";
}

function mapOptionType(segment: string | null, callPut: string | null): string {
  if (segment === "Future") return "Future";
  if (segment === "Option") {
    if (!callPut) return "Option";
    const cp = callPut.toUpperCase();
    if (cp.startsWith("C") || cp === "CE") return "Call";
    if (cp.startsWith("P") || cp === "PE") return "Put";
    return "Option";
  }
  return segment || "";
}

function buildFnoSymbol(
  underlying: string,
  expiry: string | null,
  optionType: string,
  strike: number | null,
): string {
  if (!expiry) return underlying;
  const d = new Date(expiry);
  if (isNaN(d.getTime())) return underlying;
  const year = String(d.getUTCFullYear()).slice(-2);
  const monthNames = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const mon = monthNames[d.getUTCMonth()];
  if (optionType === "Future") return `${underlying}${year}${mon}FUT`;
  const cp = optionType === "Call" ? "CE" : "PE";
  const strk = strike ? Math.round(strike) : 0;
  return `${underlying}${year}${mon}${strk}${cp}`;
}

function mapSeries(segment: string | null): string {
  if (!segment || segment === "Equity") return "EQ";
  return "XX"; // futures + options per thealphamarket.com sample
}

// ─── Metadata fallbacks ─────────────────────────────────────────
// AlphaMarket strategies sometimes have empty theme[]/managementStyle/keySector
// in the DB (optional fields on strategy creation). Format A consumers expect
// meaningful categorization, so we derive fallbacks from what we do have.

function deriveThemeFallback(strategy: any): string[] | null {
  const t = strategy?.theme;
  if (Array.isArray(t) && t.length > 0) return t;
  // Fallback: derive from strategy.type
  const type = strategy?.type;
  if (!type) return null;
  if (type === "Equity") return ["Equity"];
  if (type === "Future" || type === "Option" || type === "FnO") return ["F&O"];
  if (type === "Basket") return ["Equity", "Basket"];
  return [String(type)];
}

function deriveManagementStyleFallback(strategy: any): string[] | null {
  const m = strategy?.management_style;
  if (Array.isArray(m) && m.length > 0) return m;
  if (typeof m === "string" && m.trim().length > 0) return [m];
  // AlphaMarket is an active-advisor platform. Default to "Active".
  return ["Active"];
}

// ─── Main builders ──────────────────────────────────────────────

export function buildFormatAEquity(params: {
  event: string;
  call: any;
  strategy: any;
  advisor: any;
}): FormatAEnvelope {
  const { event, call, strategy, advisor } = params;

  const isClosed = mapStatusForEvent(event, call.status) === "CLOSED";
  const buyPriceNum = toNum(call.entry_price) ?? toNum(call.buy_range_start) ?? 0;

  const equityCall: EquityCallFormatA = {
    exchange: "NSE",
    legId: legIdFromUuid(call.id),
    legName: null,
    symbol: call.stock_name,
    name: call.stock_name,
    buyDate: toThealphamarketEpoch(call.call_date),
    buyPrice: buyPriceNum,
    buyPriceRangeEnd: toNum(call.buy_range_end),
    buyPriceRangeStart: toNum(call.buy_range_start),
    callType: String(call.action || "BUY").toUpperCase(),
    sellPrice: isClosed ? toNum(call.sell_price) : null,
    sellDate: isClosed ? toThealphamarketEpoch(call.exit_date) : null,
    targetPriceRange: numToStr(call.target_price),
    profitGoal: numToStr(call.profit_goal),
    stopLoss: numToStr(call.stop_loss),
    rational: call.rationale || null,
    creationDate: toThealphamarketEpoch(call.created_at || call.call_date),
    status: mapStatusForEvent(event, call.status),
    rationals: [],
  };

  if (isClosed && call.gain_percent != null) {
    equityCall.profitLossPercent = toNum(call.gain_percent) ?? undefined;
  }

  const exitType = mapExitType(event, call.status);
  if (exitType) {
    equityCall.exitType = exitType;
    if (event === "TARGET_ACHIEVED") equityCall.rational = "TargetAchieved";
    else if (event === "STOPLOSS_TRIGGERED") equityCall.rational = "StoplossTriggered";
    else if (event === "TRAILING_SL_TRIGGERED") equityCall.rational = "TrailingSLTriggered";
  }

  if (call.rationale) {
    equityCall.rationals = [{
      rational: call.rationale,
      date: toThealphamarketEpoch(call.created_at || call.call_date),
      name: null,
      path: null,
      fileName: null,
      createdBy: advisor?.username || null,
    }];
  }

  return {
    status: "success",
    statusCode: 200,
    message: { key: "GET", message: "Get Successfully" },
    data: {
      strategyId: strategy.slug || strategy.id, // prefer slug, fall back to UUID if missing
      theme: deriveThemeFallback(strategy),
      managementStyle: deriveManagementStyleFallback(strategy),
      volatility: toStringArray(strategy.volatility),
      marketCap: null,
      horizon: toStringArray(strategy.horizon),
      keySector: toStringArray(strategy.key_sectors),
      strategyName: strategy.name,
      strategyDescription: strategy.description,
      benchmark: strategy.benchmark,
      strategyType: strategy.type || "Equity",
      advisorName: advisor?.company_name || advisor?.username,
      profilePic: advisor?.logo_url,
      certificateURl: advisor?.sebi_cert_url,
      advisorSebiRegistrationNo: advisor?.sebi_reg_number,
      equityCall,
      fnoCall: null,
    },
  };
}

export function buildFormatAFno(params: {
  event: string;
  position: any;
  strategy: any;
  advisor: any;
  lotSize?: number;
}): FormatAEnvelope {
  const { event, position, strategy, advisor, lotSize = 1 } = params;

  const optType = mapOptionType(position.segment, position.call_put);
  const isClosed = mapStatusForEvent(event, position.status) === "CLOSED";
  const buyPriceNum = toNum(position.entry_price) ?? 0;
  const strike = toNum(position.strike_price) ?? 0;

  const fnoCall: FnoCallFormatA = {
    exchange: "NSE",
    legId: legIdFromUuid(position.id),
    legName: null,
    symbol: buildFnoSymbol(position.symbol, position.expiry, optType, strike),
    name: position.symbol,
    series: mapSeries(position.segment),
    isStoppLossAbsolute: { code: "Y", name: "Yes" },
    expiryDate: toThealphamarketEpoch(position.expiry),
    lotSize: lotSize,
    strike: strike,
    optionType: optType,
    buyDate: toThealphamarketEpoch(position.created_at),
    buyPrice: buyPriceNum,
    buyPriceRangeEnd: null,
    buyPriceRangeStart: null,
    callType: String(position.buy_sell || "BUY").toUpperCase(),
    sellPrice: isClosed ? toNum(position.exit_price) : null,
    sellDate: isClosed ? toThealphamarketEpoch(position.exit_date) : null,
    targetPriceRange: numToStr(position.target),
    profitGoal: null,
    stopLoss: numToStr(position.stop_loss),
    rational: position.rationale || null,
    rationals: [],
    creationDate: toThealphamarketEpoch(position.created_at),
    status: mapStatusForEvent(event, position.status),
  };

  if (isClosed && position.gain_percent != null) {
    fnoCall.profitLossPercent = toNum(position.gain_percent);
  }

  const exitType = mapExitType(event, position.status);
  if (exitType) fnoCall.exitType = exitType;

  return {
    status: "success",
    statusCode: 200,
    message: { key: "GET", message: "Get Successfully" },
    data: {
      strategyId: strategy.slug || strategy.id,
      theme: deriveThemeFallback(strategy),
      managementStyle: deriveManagementStyleFallback(strategy),
      volatility: toStringArray(strategy.volatility),
      marketCap: null,
      horizon: toStringArray(strategy.horizon),
      keySector: toStringArray(strategy.key_sectors),
      strategyName: strategy.name,
      strategyDescription: strategy.description,
      benchmark: strategy.benchmark,
      strategyType: optType === "Future" ? "Future" : (optType === "Call" || optType === "Put" ? "Option" : strategy.type || "FnO"),
      advisorName: advisor?.company_name || advisor?.username,
      profilePic: advisor?.logo_url,
      certificateURl: advisor?.sebi_cert_url,
      advisorSebiRegistrationNo: advisor?.sebi_reg_number,
      equityCall: null,
      fnoCall: [fnoCall],
    },
  };
}

/**
 * Fetch strategy + advisor + slug. Returns null if strategy not found.
 */
export async function loadStrategyAndAdvisor(strategyId: string) {
  const result = await db.execute(sql`
    SELECT
      s.id as s_id, s.slug as s_slug, s.advisor_id, s.name as s_name, s.type as s_type,
      s.description as s_description, s.theme as s_theme, s.management_style,
      s.horizon, s.volatility, s.key_sectors, s.benchmark,
      u.id as u_id, u.username, u.company_name, u.email,
      u.sebi_reg_number, u.logo_url, u.sebi_cert_url
    FROM strategies s
    JOIN users u ON u.id = s.advisor_id
    WHERE s.id = ${strategyId}
    LIMIT 1
  `);
  const row = (result.rows[0] as any);
  if (!row) return null;

  return {
    strategy: {
      id: row.s_id,
      slug: row.s_slug,
      advisor_id: row.advisor_id,
      name: row.s_name,
      type: row.s_type,
      description: row.s_description,
      theme: row.s_theme,
      management_style: row.management_style,
      horizon: row.horizon,
      volatility: row.volatility,
      key_sectors: row.key_sectors,
      benchmark: row.benchmark,
    },
    advisor: {
      id: row.u_id,
      username: row.username,
      company_name: row.company_name,
      email: row.email,
      sebi_reg_number: row.sebi_reg_number,
      logo_url: row.logo_url,
      sebi_cert_url: row.sebi_cert_url,
    },
  };
}

/**
 * Top-level: build Format A payload for a dispatch event, given raw internal data.
 * Used by webhook-dispatcher when broker's webhook_payload_version === 'v1_thealphamarket'.
 */
export async function buildFormatAPayload(
  event: string,
  data: Record<string, any>,
): Promise<FormatAEnvelope> {
  const strategyId = data.strategyId || data.strategy_id;
  if (!strategyId) throw new Error("strategyId missing in event data");

  const loaded = await loadStrategyAndAdvisor(strategyId);
  if (!loaded) throw new Error(`Strategy ${strategyId} not found`);

  const isFno =
    data.type === "FnO" ||
    data.segment === "Option" ||
    data.segment === "Future";

  const normalized = denormalizeForBuilder(data);

  if (isFno) {
    return buildFormatAFno({
      event,
      position: normalized,
      strategy: loaded.strategy,
      advisor: loaded.advisor,
    });
  }

  return buildFormatAEquity({
    event,
    call: normalized,
    strategy: loaded.strategy,
    advisor: loaded.advisor,
  });
}

/**
 * Internal data travels with camelCase keys (uid, stockName, buyRangeStart) because
 * the webhook-dispatcher's buildCallEventData outputs that shape. The Format A builder
 * expects snake_case (id, stock_name, buy_range_start) to match the DB schema. Map both.
 */
function denormalizeForBuilder(data: Record<string, any>): any {
  return {
    id: data.id ?? data.uid,
    strategy_id: data.strategy_id ?? data.strategyId,
    stock_name: data.stock_name ?? data.stockName ?? data.symbol,
    action: data.action,
    buy_range_start: data.buy_range_start ?? data.buyRangeStart,
    buy_range_end: data.buy_range_end ?? data.buyRangeEnd,
    target_price: data.target_price ?? data.targetPrice,
    profit_goal: data.profit_goal ?? data.profitGoal,
    stop_loss: data.stop_loss ?? data.stopLoss,
    rationale: data.rationale,
    status: data.status === "ACTIVE" ? "Active" : (data.status === "CLOSED" ? "Closed" : data.status),
    entry_price: data.entry_price ?? data.entryPrice,
    sell_price: data.sell_price ?? data.sellPrice,
    gain_percent: data.gain_percent ?? data.gainPercent ?? data.gainOrLossPercentage,
    call_date: data.call_date ?? data.callDate ?? data.creationDate,
    exit_date: data.exit_date ?? data.exitDate,
    created_at: data.created_at ?? data.createdAt ?? data.call_date ?? data.callDate,
    theme: data.theme,
    segment: data.segment,
    call_put: data.call_put ?? data.callPut,
    buy_sell: data.buy_sell ?? data.buySell ?? data.action,
    symbol: data.symbol,
    expiry: data.expiry,
    strike_price: data.strike_price ?? data.strikePrice,
    lots: data.lots,
    target: data.target ?? data.target_price ?? data.targetPrice,
    exit_price: data.exit_price ?? data.exitPrice,
  };
}

/**
 * Infer segment from internal event data for filter matching.
 */
export function inferSegment(event: string, data: Record<string, any>): string | null {
  const type = data.type;
  const segment = data.segment;
  const durUnit = data.duration_unit || data.durationUnit;

  if (segment === "Option") return "fno_options";
  if (segment === "Future") return "fno_futures";
  if (type === "FnO") return "fno_options";

  if (durUnit === "Intraday" || data.publishMode === "intraday") return "equity_intraday";
  if (durUnit === "Swing") return "equity_swing";
  if (durUnit === "Positional" || data.horizon === "Positional") return "equity_positional";
  return "equity_cash";
}
