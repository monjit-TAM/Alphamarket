/**
 * server/webhook-format-a.ts
 *
 * Format A payload builder — matches Upstox UAT accepted payload EXACTLY.
 * Verified field-by-field against SAIL/HDFCBANK/TATAPOWER accepted payloads.
 *
 * Brokers opt-in via broker_api_keys.webhook_payload_version = 'v1_thealphamarket'.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { randomBytes } from "crypto";

// ─── Helpers ────────────────────────────────────────────────────

function mongoDate(d: Date | string | number | null | undefined): { $date: string } {
  if (!d) return { $date: new Date().toISOString() };
  if (typeof d === "number") return { $date: new Date(d).toISOString() };
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? { $date: new Date().toISOString() } : { $date: date.toISOString() };
}

function mongoOid(): { $oid: string } {
  return { $oid: randomBytes(12).toString("hex") };
}

function epochMs(d: Date | string | number | null | undefined): number {
  if (!d) return Date.now();
  if (typeof d === "number") return d;
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? Date.now() : date.getTime();
}

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

function mapCallStatus(eventType: string, internalStatus: string): string {
  const CLOSING = new Set(["CALL_CLOSED","POSITION_CLOSED","TARGET_ACHIEVED","STOPLOSS_TRIGGERED","TRAILING_SL_TRIGGERED"]);
  if (CLOSING.has(eventType)) return "CLOSED";
  if (internalStatus === "Closed") return "CLOSED";
  return "PUBLISHED";
}

function mapExitType(eventType: string, internalStatus: string): string | null {
  switch (eventType) {
    case "TARGET_ACHIEVED": return "TargetAchieved";
    case "STOPLOSS_TRIGGERED": return "StoplossTriggered";
    case "TRAILING_SL_TRIGGERED": return "TrailingSLTriggered";
    case "CALL_CLOSED": case "POSITION_CLOSED": return "ManualClose";
    default: return internalStatus === "Closed" ? "ManualClose" : null;
  }
}

function mapOptionType(segment: string | null, callPut: string | null): string {
  if (segment === "Future") return "Future";
  if (!callPut) return "Option";
  const cp = callPut.toUpperCase();
  if (cp.startsWith("C") || cp === "CE") return "Call";
  if (cp.startsWith("P") || cp === "PE") return "Put";
  return "Option";
}

function buildFnoSymbol(underlying: string, expiry: string | null, opt: string, strike: number | null): string {
  if (!expiry) return underlying;
  const d = new Date(expiry);
  if (isNaN(d.getTime())) return underlying;
  const yr = String(d.getUTCFullYear()).slice(-2);
  const mn = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][d.getUTCMonth()];
  if (opt === "Future") return `${underlying}${yr}${mn}FUT`;
  return `${underlying}${yr}${mn}${strike ? Math.round(strike) : 0}${opt === "Call" ? "CE" : "PE"}`;
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
    const val = (r.rows[0] as any)?.v;
    if (val) return val;
    console.error("[Format A] nextRecId: sequence returned null");
    return String(Date.now());
  } catch (err: any) {
    console.error("[Format A] nextRecId error:", err.message);
    return String(Date.now());
  }
}

// ─── Equity Builder ─────────────────────────────────────────────
// Field order matches Upstox accepted SAIL/HDFCBANK/TATAPOWER payloads EXACTLY

async function buildEquity(event: string, c: any, strategy: any, advisor: any, inst?: {companyName: string, token: string}): Promise<any> {
  const cs = mapCallStatus(event, c.status);
  const isClosed = cs === "CLOSED";
  const recId = await nextRecId();
  const legId = String(Number(recId) + 1);
  const action = String(c.action || "BUY").toUpperCase();

  // Build equityCall — field order matches accepted payload
  const equityCall: any = {
    exchange: "NSE",
    legId: legId,
    exchangeToken: inst?.token || "",
    symbol: c.stock_name,
    name: inst?.companyName || c.stock_name,
    buyDate: mongoDate(c.call_date),
    buyPrice: toNum(c.entry_price) ?? toNum(c.buy_range_start) ?? 0,
    buyPriceRangeEnd: toNum(c.buy_range_end),
    buyPriceRangeStart: toNum(c.buy_range_start) ?? toNum(c.entry_price),
    callType: action,
    targetPriceRange: toStr(c.target_price),
    profitGoal: toStr(c.profit_goal) || (() => {
      const bp = toNum(c.entry_price) ?? toNum(c.buy_range_start) ?? 0;
      const tp = toNum(c.target_price);
      return (bp > 0 && tp) ? String(Math.round(((tp - bp) / bp) * 100)) : "";
    })(),
    stopLoss: toStr(c.stop_loss),
    thematicCollection: toArr(strategy.key_sectors),
    status: cs,
  };

  // Close-specific fields
  if (isClosed) {
    equityCall.sellPrice = toNum(c.sell_price);
    equityCall.sellDate = mongoDate(c.exit_date);
    equityCall.exitType = mapExitType(event, c.status);
    equityCall.profitLossPercent = toNum(c.gain_percent);
    equityCall.rational = mapExitType(event, c.status) || "ManualClose";
    equityCall.rationals = [{
      rational: mapExitType(event, c.status) || c.rationale || "ManualClose",
      date: mongoDate(c.exit_date || c.created_at),
      name: null, path: null, fileName: null,
      createdBy: advisor?.username || null,
    }];
  }

  // Rationals for publish
  if (!isClosed && c.rationale) {
    equityCall.rationals = [{
      rational: c.rationale,
      date: mongoDate(c.created_at || c.call_date),
      name: null, path: null, fileName: null,
      createdBy: advisor?.username || null,
    }];
  }

  // Root payload — EXACT field order matching Upstox accepted SAIL payload
  const payload: any = {};
  payload._id = mongoOid();
  payload.advisorId = advisorSlug(advisor?.company_name, advisor?.id);
  payload.clientId = "upstox";
  payload.env = "uat";
  payload.callStatus = cs;
  payload.dayMonth = getDayMonth(c.call_date || c.created_at);
  payload.symbol = c.stock_name;
  payload.callType = action;
  payload.strategyId = strategy.slug || strategy.id;
  payload.recommendationId = recId;
  payload.rational = c.rationale || null;
  payload.theme = deriveTheme(strategy);
  payload.thematicCollection = toArr(strategy.key_sectors);
  payload.managementStyle = toArr(strategy.management_style) || ["Active"];
  payload.volatility = toArr(strategy.volatility);
  payload.horizon = toArr(strategy.horizon);
  payload.strategyName = strategy.name;
  payload.strategyDescription = strategy.description || null;
  payload.benchmark = strategy.benchmark || "Nifty 50";
  payload.strategyType = "Equity";
  payload.advisorName = advisor?.company_name || advisor?.username;
  payload.profilePic = advisor?.logo_url ? `https://alphamarket.co.in${advisor.logo_url}` : "";
  payload.certificateURl = advisor?.sebi_cert_url ? (advisor.sebi_cert_url.startsWith("http") ? advisor.sebi_cert_url : "https://alphamarket.co.in" + advisor.sebi_cert_url) : "";
  payload.advisorSebiRegistrationNo = advisor?.sebi_reg_number || "";
  payload.equityCall = equityCall;
  payload.fnoCall = null;
  payload.status = "SEND";
  payload.creationDate = mongoDate(c.created_at || c.call_date);
  payload.isActive = !isClosed;
  payload._class = "com.alpha.market.dao.StrategyIntegration";

  return { status: "success", statusCode: 200, message: { key: "GET", message: "Get Successfully" }, data: payload };
}

// ─── FnO Builder ────────────────────────────────────────────────

async function buildFno(event: string, p: any, strategy: any, advisor: any): Promise<any> {
  const cs = mapCallStatus(event, p.status);
  const isClosed = cs === "CLOSED";
  const opt = mapOptionType(p.segment, p.call_put);
  const strike = toNum(p.strike_price) ?? 0;
  const recId = await nextRecId();
  const legId = String(Number(recId) + 1);
  const sym = buildFnoSymbol(p.symbol, p.expiry, opt, strike);
  const action = String(p.buy_sell || "BUY").toUpperCase();

  const fnoCall: any = {
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
    callType: action,
    targetPriceRange: toStr(p.target),
    profitGoal: null,
    stopLoss: toStr(p.stop_loss),
    status: cs,
    creationDate: epochMs(p.created_at),
  };

  if (isClosed) {
    fnoCall.sellPrice = toNum(p.exit_price);
    fnoCall.sellDate = epochMs(p.exit_date);
    fnoCall.exitType = mapExitType(event, p.status);
    fnoCall.profitLossPercent = toNum(p.gain_percent);
    fnoCall.rational = mapExitType(event, p.status) || "ManualClose";
  }

  if (p.rationale) {
    fnoCall.rational = p.rationale;
    fnoCall.rationals = [{
      rational: p.rationale,
      date: epochMs(p.created_at),
      name: null, path: null, fileName: null,
      createdBy: advisor?.username || null,
    }];
  }

  let rootType = "Option";
  if (opt === "Future") rootType = "Future";
  if (strategy?.type === "CommodityFuture") rootType = "CommodityFuture";

  const payload: any = {};
  payload._id = mongoOid();
  payload.advisorId = advisorSlug(advisor?.company_name, advisor?.id);
  payload.clientId = "upstox";
  payload.env = "uat";
  payload.callStatus = cs;
  payload.dayMonth = getDayMonth(p.created_at);
  payload.symbol = p.symbol || sym;
  payload.callType = action;
  payload.strategyId = strategy.slug || strategy.id;
  payload.recommendationId = recId;
  payload.rational = p.rationale || null;
  payload.theme = deriveTheme(strategy);
  payload.thematicCollection = toArr(strategy.key_sectors);
  payload.managementStyle = toArr(strategy.management_style) || ["Active"];
  payload.volatility = toArr(strategy.volatility);
  payload.horizon = toArr(strategy.horizon);
  payload.strategyName = strategy.name;
  payload.strategyDescription = strategy.description || null;
  payload.benchmark = strategy.benchmark || "Nifty 50";
  payload.strategyType = rootType;
  payload.advisorName = advisor?.company_name || advisor?.username;
  payload.profilePic = advisor?.logo_url ? `https://alphamarket.co.in${advisor.logo_url}` : "";
  payload.certificateURl = advisor?.sebi_cert_url ? (advisor.sebi_cert_url.startsWith("http") ? advisor.sebi_cert_url : "https://alphamarket.co.in" + advisor.sebi_cert_url) : "";
  payload.advisorSebiRegistrationNo = advisor?.sebi_reg_number || "";
  payload.fnoCall = [fnoCall];
  payload.status = "SEND";
  payload.creationDate = mongoDate(p.created_at);
  payload.isActive = !isClosed;
  payload._class = "com.alpha.market.dao.StrategyIntegration";

  return { status: "success", statusCode: 200, message: { key: "GET", message: "Get Successfully" }, data: payload };
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

async function lookupInstrument(symbol: string): Promise<{companyName: string, token: string}> {
  try {
    const r = await db.execute(sql`SELECT company_name, instrument_token FROM nse_instruments WHERE symbol = ${symbol} ORDER BY CASE WHEN exchange = 'NSE' THEN 0 ELSE 1 END LIMIT 1`);
    const row = (r.rows[0] as any);
    return { companyName: row?.company_name || symbol, token: row?.instrument_token || "" };
  } catch { return { companyName: symbol, token: "" }; }
}

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
  const inst = await lookupInstrument(n.stock_name || n.symbol || "");
  return buildEquity(event, n, loaded.strategy, loaded.advisor, inst);
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
