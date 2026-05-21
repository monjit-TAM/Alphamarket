/**
 * server/webhook-format-a.ts
 *
 * Format A payload builder — matches Upstox UAT accepted payload EXACTLY.
 * Field names, field order, types, and structure verified against 3 working
 * payloads from thealphamarket.com that Upstox parsed successfully.
 *
 * Brokers opt-in via broker_api_keys.webhook_payload_version = 'v1_thealphamarket'.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

// ─── Helpers ────────────────────────────────────────────────────

/** MongoDB-style date: {"$date": "ISO string"} — Upstox expects this exact format */
function mongoDate(d: Date | string | number | null | undefined): { $date: string } {
  if (!d) return { $date: new Date().toISOString() };
  if (typeof d === "number") return { $date: new Date(d).toISOString() };
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return { $date: new Date().toISOString() };
  return { $date: date.toISOString() };
}

/** Epoch millis — used for fnoCall dates */
function epochMs(d: Date | string | number | null | undefined): number {
  if (!d) return Date.now();
  if (typeof d === "number") return d;
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? Date.now() : date.getTime();
}

/** DDMM format */
function getDayMonth(d?: Date | string | number | null): string {
  const date = d ? (typeof d === "number" ? new Date(d) : new Date(d)) : new Date();
  if (isNaN(date.getTime())) return "0000";
  return String(date.getDate()).padStart(2, "0") + String(date.getMonth() + 1).padStart(2, "0");
}

function toArr(s: string | null | undefined | string[]): string[] | null {
  if (!s) return null;
  if (Array.isArray(s)) return s.length ? s : null;
  return [String(s)];
}

function toNum(n: number | string | null | undefined): number | null {
  if (n == null || n === "") return null;
  const num = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(num) ? num : null;
}

function toStr(n: number | string | null | undefined): string | null {
  if (n == null || n === "") return null;
  return String(n);
}

function advisorSlug(companyName: string | null, id: string): string {
  const name = (companyName || "advisor").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const suffix = (id || "000000").replace(/-/g, "").substring(0, 6);
  return `${name}.${suffix}`;
}

function callStatus(eventType: string, internalStatus: string): string {
  const CLOSING = new Set(["CALL_CLOSED","POSITION_CLOSED","TARGET_ACHIEVED","STOPLOSS_TRIGGERED","TRAILING_SL_TRIGGERED"]);
  if (CLOSING.has(eventType)) return "CLOSED";
  if (internalStatus === "Closed") return "CLOSED";
  return "PUBLISHED";
}

function exitType(eventType: string, internalStatus: string): string | null {
  switch (eventType) {
    case "TARGET_ACHIEVED": return "TargetAchieved";
    case "STOPLOSS_TRIGGERED": return "StoplossTriggered";
    case "TRAILING_SL_TRIGGERED": return "TrailingSLTriggered";
    case "CALL_CLOSED": case "POSITION_CLOSED": return "ManualClose";
    default: return internalStatus === "Closed" ? "ManualClose" : null;
  }
}

function optionType(segment: string | null, callPut: string | null): string {
  if (segment === "Future") return "Future";
  if (!callPut) return "Option";
  const cp = callPut.toUpperCase();
  if (cp.startsWith("C") || cp === "CE") return "Call";
  if (cp.startsWith("P") || cp === "PE") return "Put";
  return "Option";
}

function fnoSymbol(underlying: string, expiry: string | null, opt: string, strike: number | null): string {
  if (!expiry) return underlying;
  const d = new Date(expiry);
  if (isNaN(d.getTime())) return underlying;
  const yr = String(d.getUTCFullYear()).slice(-2);
  const mn = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][d.getUTCMonth()];
  if (opt === "Future") return `${underlying}${yr}${mn}FUT`;
  const cp = opt === "Call" ? "CE" : "PE";
  return `${underlying}${yr}${mn}${strike ? Math.round(strike) : 0}${cp}`;
}

function deriveTheme(strategy: any): string[] {
  const t = strategy?.theme;
  if (Array.isArray(t) && t.length > 0) return t;
  const type = strategy?.type;
  if (type === "Equity") return ["Equity"];
  if (type === "Future" || type === "Option" || type === "FnO") return ["F&O"];
  if (type === "CommodityFuture") return ["Commodity"];
  return ["Equity"];
}

async function nextRecId(): Promise<string> {
  try {
    const r = await db.execute(sql`SELECT nextval('recommendation_id_seq')::text as v`);
    return (r.rows[0] as any)?.v || String(Date.now());
  } catch { return String(Date.now()); }
}

// ─── Equity Builder ─────────────────────────────────────────────

async function buildEquity(event: string, c: any, strategy: any, advisor: any): Promise<any> {
  const cs = callStatus(event, c.status);
  const isClosed = cs === "CLOSED";
  const recId = await nextRecId();
  const legId = String(Number(recId) + 1);

  // equityCall object — matches Upstox accepted format exactly
  const eq: any = {
    exchange: "NSE",
    legId: legId,
    exchangeToken: null,
    symbol: c.stock_name,
    name: c.stock_name,
    buyDate: mongoDate(c.call_date),
    buyPrice: toNum(c.entry_price) ?? toNum(c.buy_range_start) ?? 0,
    buyPriceRangeEnd: toNum(c.buy_range_end),
    buyPriceRangeStart: toNum(c.buy_range_start) ?? toNum(c.entry_price),
    callType: String(c.action || "BUY").toUpperCase(),
    targetPriceRange: toStr(c.target_price),
    profitGoal: toStr(c.profit_goal),
    stopLoss: toStr(c.stop_loss),
    status: cs,
  };

  // Add close fields only when closed
  if (isClosed) {
    eq.sellPrice = toNum(c.sell_price);
    eq.sellDate = mongoDate(c.exit_date);
    eq.exitType = exitType(event, c.status);
    eq.profitLossPercent = toNum(c.gain_percent);
    eq.rational = exitType(event, c.status) || "ManualClose";
  }

  // Rationals array
  if (c.rationale) {
    eq.rationals = [{
      rational: c.rationale,
      date: mongoDate(c.created_at || c.call_date),
      name: null,
      path: null,
      fileName: null,
      createdBy: advisor?.username || null,
    }];
  }

  // Root-level payload — field order matches Upstox accepted samples
  return {
    advisorId: advisorSlug(advisor?.company_name, advisor?.id),
    clientId: "upstox",
    env: "uat",
    callStatus: cs,
    dayMonth: getDayMonth(c.call_date || c.created_at),
    symbol: c.stock_name,
    callType: String(c.action || "BUY").toUpperCase(),
    strategyId: strategy.slug || strategy.id,
    recommendationId: recId,
    rational: c.rationale || null,
    theme: deriveTheme(strategy),
    thematicCollection: null,
    managementStyle: toArr(strategy.management_style) || ["Active"],
    volatility: toArr(strategy.volatility),
    horizon: toArr(strategy.horizon),
    keySector: toArr(strategy.key_sectors),
    strategyName: strategy.name,
    strategyDescription: strategy.description || null,
    benchmark: strategy.benchmark || "Nifty 50",
    strategyType: "Equity",
    advisorName: advisor?.company_name || advisor?.username,
    profilePic: advisor?.logo_url ? `https://alphamarket.co.in${advisor.logo_url}` : "",
    certificateURl: advisor?.sebi_cert_url || "",
    advisorSebiRegistrationNo: advisor?.sebi_reg_number || "",
    equityCall: eq,
    status: "SEND",
    creationDate: mongoDate(c.created_at || c.call_date),
    isActive: !isClosed,
    _class: "com.alpha.market.dao.StrategyIntegration",
  };
}

// ─── FnO Builder ────────────────────────────────────────────────

async function buildFno(event: string, p: any, strategy: any, advisor: any): Promise<any> {
  const cs = callStatus(event, p.status);
  const isClosed = cs === "CLOSED";
  const opt = optionType(p.segment, p.call_put);
  const strike = toNum(p.strike_price) ?? 0;
  const recId = await nextRecId();
  const legId = String(Number(recId) + 1);
  const sym = fnoSymbol(p.symbol, p.expiry, opt, strike);

  const fno: any = {
    exchange: "NSE",
    legId: legId,
    series: p.segment === "Equity" ? "EQ" : "XX",
    symbol: sym,
    name: p.symbol,
    isStoppLossAbsolute: { code: "Y", name: "Yes" },
    expiryDate: epochMs(p.expiry),
    lotSize: toNum(p.lots) || 1,
    strike: strike,
    optionType: opt,
    buyDate: mongoDate(p.created_at),
    buyPrice: toNum(p.entry_price) ?? 0,
    buyPriceRangeEnd: null,
    buyPriceRangeStart: null,
    callType: String(p.buy_sell || "BUY").toUpperCase(),
    targetPriceRange: toStr(p.target),
    profitGoal: null,
    stopLoss: toStr(p.stop_loss),
    status: cs,
    creationDate: epochMs(p.created_at),
  };

  if (isClosed) {
    fno.sellPrice = toNum(p.exit_price);
    fno.sellDate = epochMs(p.exit_date);
    fno.exitType = exitType(event, p.status);
    fno.profitLossPercent = toNum(p.gain_percent);
    fno.rational = exitType(event, p.status) || "ManualClose";
  }

  if (p.rationale) {
    fno.rational = p.rationale;
    fno.rationals = [{
      rational: p.rationale,
      date: epochMs(p.created_at),
      name: null, path: null, fileName: null,
      createdBy: advisor?.username || null,
    }];
  }

  let rootType = "Option";
  if (opt === "Future") rootType = "Future";
  if (strategy?.type === "CommodityFuture") rootType = "CommodityFuture";

  return {
    advisorId: advisorSlug(advisor?.company_name, advisor?.id),
    clientId: "upstox",
    env: "uat",
    callStatus: cs,
    dayMonth: getDayMonth(p.created_at),
    symbol: p.symbol || sym,
    callType: String(p.buy_sell || "BUY").toUpperCase(),
    strategyId: strategy.slug || strategy.id,
    recommendationId: recId,
    rational: p.rationale || null,
    theme: deriveTheme(strategy),
    thematicCollection: null,
    managementStyle: toArr(strategy.management_style) || ["Active"],
    volatility: toArr(strategy.volatility),
    horizon: toArr(strategy.horizon),
    keySector: toArr(strategy.key_sectors),
    strategyName: strategy.name,
    strategyDescription: strategy.description || null,
    benchmark: strategy.benchmark || "Nifty 50",
    strategyType: rootType,
    advisorName: advisor?.company_name || advisor?.username,
    profilePic: advisor?.logo_url ? `https://alphamarket.co.in${advisor.logo_url}` : "",
    certificateURl: advisor?.sebi_cert_url || "",
    advisorSebiRegistrationNo: advisor?.sebi_reg_number || "",
    fnoCall: [fno],
    status: "SEND",
    creationDate: mongoDate(p.created_at),
    isActive: !isClosed,
    _class: "com.alpha.market.dao.StrategyIntegration",
  };
}

// ─── DB Loader ──────────────────────────────────────────────────

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

// ─── Normalizer ─────────────────────────────────────────────────

function normalize(data: Record<string, any>): any {
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

// ─── Entry Point ────────────────────────────────────────────────

export async function buildFormatAPayload(
  event: string,
  data: Record<string, any>,
): Promise<any> {
  const strategyId = data.strategyId || data.strategy_id;
  if (!strategyId) throw new Error("strategyId missing in event data");

  const loaded = await loadStrategyAndAdvisor(strategyId);
  if (!loaded) throw new Error(`Strategy ${strategyId} not found`);

  const isFno = data.type === "FnO" || data.segment === "Option" || data.segment === "Future" || data.segment === "Commodity";
  const n = normalize(data);

  if (isFno) {
    return buildFno(event, n, loaded.strategy, loaded.advisor);
  }
  return buildEquity(event, n, loaded.strategy, loaded.advisor);
}

export function inferSegment(event: string, data: Record<string, any>): string | null {
  const segment = data.segment;
  if (segment === "Option") return "fno_options";
  if (segment === "Future") return "fno_futures";
  if (data.type === "FnO") return "fno_options";
  if (data.publishMode === "intraday") return "equity_intraday";
  if (data.horizon === "Positional") return "equity_positional";
  return "equity_cash";
}
