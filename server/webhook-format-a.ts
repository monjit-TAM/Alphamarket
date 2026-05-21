/**
 * server/webhook-format-a.ts
 *
 * Format A payload builder — matches Upstox UAT expected schema exactly.
 * Used for brokers with webhook_payload_version = 'v1_thealphamarket'.
 *
 * Key fields required by Upstox:
 *   - recommendationId (unique per recommendation, from DB sequence)
 *   - advisorId (slug format: "company-name.NNNNNN")
 *   - clientId ("upstox")
 *   - env ("uat" or "production")
 *   - callStatus, symbol, callType at root level
 *   - equityCall or fnoCall with full details
 *   - dayMonth (DDMM format)
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

// ─── Types ──────────────────────────────────────────────────────

export interface FormatAEnvelope {
  advisorId: string;
  clientId: string;
  env: string;
  callStatus: string;
  dayMonth: string;
  symbol: string;
  callType: string;
  strategyId: string;
  recommendationId: string;
  rational: string | null;
  theme: string[] | null;
  thematicCollection: string[] | null;
  managementStyle: string[] | null;
  volatility: string[] | null;
  horizon: string[] | null;
  strategyName: string;
  strategyDescription: string | null;
  benchmark: string | null;
  strategyType: string;
  advisorName: string;
  profilePic: string | null;
  advisorSebiRegistrationNo: string | null;
  equityCall: any | null;
  fnoCall: any[] | null;
  status: string;
  creationDate: { $date: string };
  isActive: boolean;
  _class: string;
  // Legacy wrapper fields for backward compat
  data?: any;
  statusCode?: number;
  message?: any;
}

// ─── Helpers ────────────────────────────────────────────────────

function toDateObj(d: Date | string | number | null | undefined): { $date: string } {
  if (!d) return { $date: new Date().toISOString() };
  if (typeof d === "number") return { $date: new Date(d).toISOString() };
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return { $date: new Date().toISOString() };
  return { $date: date.toISOString() };
}

function toEpoch(d: Date | string | number | null | undefined): number {
  if (!d) return Date.now();
  if (typeof d === "number") return d;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return Date.now();
  return date.getTime();
}

function getDayMonth(d?: Date | string | number | null): string {
  const date = d ? (typeof d === "number" ? new Date(d) : new Date(d)) : new Date();
  if (isNaN(date.getTime())) return "0000";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return day + month;
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

function mapCallStatus(eventType: string, internalStatus: string): string {
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

function buildAdvisorSlug(companyName: string | null, advisorId: string): string {
  const name = (companyName || "advisor").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const suffix = (advisorId || "000000").replace(/-/g, "").substring(0, 6);
  return `${name}.${suffix}`;
}

function buildFnoSymbol(underlying: string, expiry: string | null, optionType: string, strike: number | null): string {
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

function mapOptionType(segment: string | null, callPut: string | null): string {
  if (segment === "Future") return "Future";
  if (segment === "Option" || segment === "Equity") {
    if (!callPut) return "Option";
    const cp = callPut.toUpperCase();
    if (cp.startsWith("C") || cp === "CE") return "Call";
    if (cp.startsWith("P") || cp === "PE") return "Put";
    return "Option";
  }
  return segment || "";
}

async function getNextRecommendationId(): Promise<string> {
  try {
    const result = await db.execute(sql`SELECT nextval('recommendation_id_seq')::text as rec_id`);
    return (result.rows[0] as any)?.rec_id || String(Date.now());
  } catch {
    return String(Date.now());
  }
}

function deriveTheme(strategy: any): string[] | null {
  const t = strategy?.theme;
  if (Array.isArray(t) && t.length > 0) return t;
  const type = strategy?.type;
  if (!type) return null;
  if (type === "Equity") return ["Equity"];
  if (type === "Future" || type === "Option" || type === "FnO") return ["F&O"];
  if (type === "CommodityFuture") return ["Commodity"];
  if (type === "Basket") return ["Equity", "Basket"];
  return [String(type)];
}

// ─── Main builders ──────────────────────────────────────────────

export async function buildFormatAEquity(params: {
  event: string;
  call: any;
  strategy: any;
  advisor: any;
}): Promise<FormatAEnvelope> {
  const { event, call, strategy, advisor } = params;

  const callStatus = mapCallStatus(event, call.status);
  const isClosed = callStatus === "CLOSED";
  const buyPriceNum = toNum(call.entry_price) ?? toNum(call.buy_range_start) ?? 0;
  const recId = await getNextRecommendationId();
  const legId = recId;

  const equityCall: any = {
    exchange: "NSE",
    legId,
    exchangeToken: "",
    symbol: call.stock_name,
    name: call.stock_name,
    buyDate: toDateObj(call.call_date),
    buyPrice: buyPriceNum,
    buyPriceRangeEnd: toNum(call.buy_range_end),
    buyPriceRangeStart: toNum(call.buy_range_start),
    callType: String(call.action || "BUY").toUpperCase(),
    targetPriceRange: numToStr(call.target_price),
    profitGoal: numToStr(call.profit_goal) || "",
    stopLoss: numToStr(call.stop_loss),
    status: callStatus,
  };

  if (isClosed) {
    equityCall.sellPrice = toNum(call.sell_price);
    equityCall.sellDate = toDateObj(call.exit_date);
    equityCall.exitType = mapExitType(event, call.status);
    equityCall.profitLossPercent = toNum(call.gain_percent);
    equityCall.rational = equityCall.exitType || "ManualClose";
  }

  // Rationals array
  if (call.rationale) {
    equityCall.rational = call.rationale;
    equityCall.rationals = [{
      rational: call.rationale,
      date: toDateObj(call.created_at || call.call_date),
      name: null, path: null, fileName: null,
      createdBy: advisor?.username || null,
    }];
  }

  const innerData = {
    advisorId: buildAdvisorSlug(advisor?.company_name, advisor?.id),
    clientId: "upstox",
    env: "uat",
    callStatus,
    dayMonth: getDayMonth(call.call_date || call.created_at),
    symbol: call.stock_name,
    callType: String(call.action || "BUY").toUpperCase(),
    strategyId: strategy.slug || strategy.id,
    recommendationId: recId,
    rational: call.rationale || null,
    theme: deriveTheme(strategy),
    thematicCollection: null,
    managementStyle: toStringArray(strategy.management_style) || ["Active"],
    volatility: toStringArray(strategy.volatility),
    horizon: toStringArray(strategy.horizon),
    keySector: toStringArray(strategy.key_sectors),
    strategyName: strategy.name,
    strategyDescription: strategy.description || null,
    benchmark: strategy.benchmark || "Nifty 50",
    strategyType: "Equity",
    advisorName: advisor?.company_name || advisor?.username,
    profilePic: advisor?.logo_url ? `https://alphamarket.co.in${advisor.logo_url}` : "",
    certificateURl: "",
    advisorSebiRegistrationNo: advisor?.sebi_reg_number || "",
    equityCall,
    fnoCall: null,
    status: "SEND",
    creationDate: toDateObj(call.created_at || call.call_date),
    isActive: !isClosed,
    _class: "com.alpha.market.dao.StrategyIntegration",
  };
  return { status: "SEND", statusCode: 200, message: { key: "GET", message: "Get Successfully" }, data: innerData } as any;
}

export async function buildFormatAFno(params: {
  event: string;
  position: any;
  strategy: any;
  advisor: any;
}): Promise<FormatAEnvelope> {
  const { event, position, strategy, advisor } = params;

  const callStatus = mapCallStatus(event, position.status);
  const isClosed = callStatus === "CLOSED";
  const buyPriceNum = toNum(position.entry_price) ?? 0;
  const strike = toNum(position.strike_price) ?? 0;
  const optType = mapOptionType(position.segment, position.call_put);
  const recId = await getNextRecommendationId();
  const legId = recId;
  const fnoSymbol = buildFnoSymbol(position.symbol, position.expiry, optType, strike);

  const fnoCall: any = {
    exchange: "NSE",
    legId,
    series: position.segment === "Equity" ? "EQ" : "XX",
    symbol: fnoSymbol,
    name: position.symbol,
    isStoppLossAbsolute: { code: "Y", name: "Yes" },
    expiryDate: toEpoch(position.expiry),
    lotSize: toNum(position.lots) || 1,
    strike,
    optionType: optType,
    buyDate: toDateObj(position.created_at),
    buyPrice: buyPriceNum,
    buyPriceRangeEnd: null,
    buyPriceRangeStart: null,
    callType: String(position.buy_sell || "BUY").toUpperCase(),
    targetPriceRange: numToStr(position.target),
    profitGoal: null,
    stopLoss: numToStr(position.stop_loss),
    status: callStatus,
    creationDate: toEpoch(position.created_at),
  };

  if (isClosed) {
    fnoCall.sellPrice = toNum(position.exit_price);
    fnoCall.sellDate = toEpoch(position.exit_date);
    fnoCall.exitType = mapExitType(event, position.status);
    fnoCall.profitLossPercent = toNum(position.gain_percent);
    fnoCall.rational = fnoCall.exitType || "ManualClose";
  }

  if (position.rationale) {
    fnoCall.rational = position.rationale;
    fnoCall.rationals = [{
      rational: position.rationale,
      date: toEpoch(position.created_at),
      name: null, path: null, fileName: null,
      createdBy: advisor?.username || null,
    }];
  }

  // Determine strategy type for root level
  let rootStrategyType = "Option";
  if (optType === "Future") rootStrategyType = "Future";
  if (strategy?.type === "CommodityFuture") rootStrategyType = "CommodityFuture";

  const innerData = {
    advisorId: buildAdvisorSlug(advisor?.company_name, advisor?.id),
    clientId: "upstox",
    env: "uat",
    callStatus,
    dayMonth: getDayMonth(position.created_at),
    symbol: position.symbol || fnoSymbol,
    callType: String(position.buy_sell || "BUY").toUpperCase(),
    strategyId: strategy.slug || strategy.id,
    recommendationId: recId,
    rational: position.rationale || null,
    theme: deriveTheme(strategy),
    thematicCollection: null,
    managementStyle: toStringArray(strategy.management_style) || ["Active"],
    volatility: toStringArray(strategy.volatility),
    horizon: toStringArray(strategy.horizon),
    keySector: toStringArray(strategy.key_sectors),
    strategyName: strategy.name,
    strategyDescription: strategy.description || null,
    benchmark: strategy.benchmark || "Nifty 50",
    strategyType: rootStrategyType,
    advisorName: advisor?.company_name || advisor?.username,
    profilePic: advisor?.logo_url ? `https://alphamarket.co.in${advisor.logo_url}` : "",
    certificateURl: "",
    advisorSebiRegistrationNo: advisor?.sebi_reg_number || "",
    equityCall: null,
    fnoCall: [fnoCall],
    status: "SEND",
    creationDate: toDateObj(position.created_at),
    isActive: !isClosed,
    _class: "com.alpha.market.dao.StrategyIntegration",
  };
  return { status: "SEND", statusCode: 200, message: { key: "GET", message: "Get Successfully" }, data: innerData } as any;
}

/**
 * Fetch strategy + advisor. Returns null if strategy not found.
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
      id: row.s_id, slug: row.s_slug, advisor_id: row.advisor_id,
      name: row.s_name, type: row.s_type, description: row.s_description,
      theme: row.s_theme, management_style: row.management_style,
      horizon: row.horizon, volatility: row.volatility,
      key_sectors: row.key_sectors, benchmark: row.benchmark,
    },
    advisor: {
      id: row.u_id, username: row.username, company_name: row.company_name,
      email: row.email, sebi_reg_number: row.sebi_reg_number,
      logo_url: row.logo_url, sebi_cert_url: row.sebi_cert_url,
    },
  };
}

/**
 * Top-level: build Format A payload for a dispatch event.
 * Called by webhook-dispatcher when broker's webhook_payload_version === 'v1_thealphamarket'.
 */
export async function buildFormatAPayload(
  event: string,
  data: Record<string, any>,
): Promise<FormatAEnvelope> {
  const strategyId = data.strategyId || data.strategy_id;
  if (!strategyId) throw new Error("strategyId missing in event data");

  const loaded = await loadStrategyAndAdvisor(strategyId);
  if (!loaded) throw new Error(`Strategy ${strategyId} not found`);

  const isFno = data.type === "FnO" || data.segment === "Option" || data.segment === "Future" || data.segment === "Commodity";
  const normalized = denormalizeForBuilder(data);

  if (isFno) {
    return buildFormatAFno({ event, position: normalized, strategy: loaded.strategy, advisor: loaded.advisor });
  }
  return buildFormatAEquity({ event, call: normalized, strategy: loaded.strategy, advisor: loaded.advisor });
}

/**
 * Map camelCase webhook-dispatcher output to snake_case for builder.
 */
function denormalizeForBuilder(data: Record<string, any>): any {
  return {
    id: data.id ?? data.uid,
    strategy_id: data.strategy_id ?? data.strategyId,
    stock_name: data.stock_name ?? data.stockName ?? data.symbol,
    action: data.action ?? data.buySell ?? data.buy_sell,
    buy_range_start: data.buy_range_start ?? data.buyRangeStart ?? data.entryPrice,
    buy_range_end: data.buy_range_end ?? data.buyRangeEnd,
    target_price: data.target_price ?? data.targetPrice ?? data.target,
    profit_goal: data.profit_goal ?? data.profitGoal,
    stop_loss: data.stop_loss ?? data.stopLoss,
    rationale: data.rationale,
    status: data.status === "ACTIVE" ? "Active" : (data.status === "CLOSED" ? "Closed" : data.status),
    entry_price: data.entry_price ?? data.entryPrice,
    sell_price: data.sell_price ?? data.sellPrice,
    exit_price: data.exit_price ?? data.exitPrice,
    gain_percent: data.gain_percent ?? data.gainPercent,
    call_date: data.call_date ?? data.callDate ?? data.creationDate,
    exit_date: data.exit_date ?? data.exitDate,
    created_at: data.created_at ?? data.createdAt ?? data.call_date ?? data.callDate,
    segment: data.segment,
    call_put: data.call_put ?? data.callPut,
    buy_sell: data.buy_sell ?? data.buySell ?? data.action,
    symbol: data.symbol ?? data.stock_name ?? data.stockName,
    expiry: data.expiry,
    strike_price: data.strike_price ?? data.strikePrice,
    lots: data.lots,
    target: data.target ?? data.target_price ?? data.targetPrice,
    leg_group_id: data.leg_group_id ?? data.legGroupId,
  };
}

/**
 * Infer segment from internal event data for filter matching.
 */
export function inferSegment(event: string, data: Record<string, any>): string | null {
  const type = data.type;
  const segment = data.segment;
  if (segment === "Option") return "fno_options";
  if (segment === "Future") return "fno_futures";
  if (type === "FnO") return "fno_options";
  if (data.publishMode === "intraday") return "equity_intraday";
  if (data.horizon === "Positional") return "equity_positional";
  return "equity_cash";
}
