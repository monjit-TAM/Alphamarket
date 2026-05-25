/**
 * server/webhook-format-a.ts
 *
 * Format A payload builder — matches Upstox UAT accepted payload EXACTLY.
 * Verified against F&O BANKNIFTY accepted sample + SAIL/HDFCBANK equity samples.
 *
 * Root envelope: { status: "success", statusCode: 200, message: {...}, data: {...} }
 * Inside data: strategyId first, then fields, then equityCall/fnoCall, NO extra fields.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

// ─── Helpers ────────────────────────────────────────────────────

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

function epochMs(d: Date | string | number | null | undefined): number {
  if (!d) return Date.now();
  if (typeof d === "number") return d;
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? Date.now() : date.getTime();
}

function deriveTheme(strategy: any): string[] {
  const t = strategy?.theme;
  if (Array.isArray(t) && t.length > 0) return t;
  const type = strategy?.type;
  if (type === "Equity") return ["Equity"];
  if (type === "Future" || type === "Option" || type === "FnO") return ["F&O"];
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

async function lookupInstrument(symbol: string): Promise<{companyName: string, token: string}> {
  try {
    const r = await db.execute(sql`SELECT company_name, instrument_token FROM nse_instruments WHERE symbol = ${symbol} ORDER BY CASE WHEN exchange = 'NSE' THEN 0 ELSE 1 END LIMIT 1`);
    const row = (r.rows[0] as any);
    return { companyName: row?.company_name || symbol, token: row?.instrument_token || "" };
  } catch { return { companyName: symbol, token: "" }; }
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

// ─── Equity Builder ─────────────────────────────────────────────

async function buildEquity(event: string, c: any, strategy: any, advisor: any): Promise<any> {
  const isClosed = event === "CALL_CLOSED" || event === "POSITION_CLOSED" || event === "TARGET_ACHIEVED" || event === "STOPLOSS_TRIGGERED" || event === "TRAILING_SL_TRIGGERED" || c.status === "Closed";
  const recId = await nextRecId();
  const legId = String(Number(recId) + 1);
  const inst = await lookupInstrument(c.stock_name || c.symbol || "");
  const action = String(c.action || "BUY").toUpperCase();
  const bp = toNum(c.entry_price) ?? toNum(c.buy_range_start) ?? 0;
  const tp = toNum(c.target_price);
  const profitGoal = toStr(c.profit_goal) || ((bp > 0 && tp) ? String(Math.round(((tp - bp) / bp) * 100)) : null);

  // equityCall object
  const equityCall: any = {
    exchange: "NSE",
    legId: legId,
    exchangeToken: inst.token || null,
    symbol: c.stock_name,
    name: inst.companyName,
    buyDate: epochMs(c.call_date),
    buyPrice: bp,
    buyPriceRangeEnd: toNum(c.buy_range_end),
    buyPriceRangeStart: toNum(c.buy_range_start) ?? bp,
    callType: action,
    sellPrice: isClosed ? toNum(c.sell_price) : null,
    sellDate: isClosed ? epochMs(c.exit_date) : null,
    targetPriceRange: toStr(c.target_price),
    profitGoal: profitGoal,
    stopLoss: toStr(c.stop_loss),
    exitType: isClosed ? mapExitType(event, c.status) : null,
    status: isClosed ? "CLOSED" : "PUBLISHED",
  };

  if (c.rationale) {
    equityCall.rational = c.rationale;
    equityCall.rationals = [{
      rational: c.rationale,
      date: epochMs(c.created_at || c.call_date),
      name: null, path: null, fileName: null,
      createdBy: advisor?.username || null,
    }];
  }

  if (isClosed) {
    equityCall.profitLossPercent = toNum(c.gain_percent);
  }

  // data object — field order matches Upstox accepted payload
  const data: any = {};
  data.strategyId = strategy.slug || strategy.id;
  data.recommendationId = recId;
  data.rational = c.rationale || null;
  data.creationDate = epochMs(c.created_at || c.call_date);
  data.theme = deriveTheme(strategy);
  data.managementStyle = toArr(strategy.management_style) || ["Active"];
  data.volatility = toArr(strategy.volatility);
  data.marketCap = null;
  data.horizon = toArr(strategy.horizon);
  data.keySector = toArr(strategy.key_sectors);
  data.strategyName = strategy.name;
  data.strategyDescription = strategy.description || null;
  data.benchmark = strategy.benchmark || "Nifty 50";
  data.strategyType = "Equity";
  data.advisorName = advisor?.company_name || advisor?.username;
  data.profilePic = advisor?.logo_url ? "https://alphamarket.co.in" + advisor.logo_url : null;
  data.certificateURl = advisor?.sebi_cert_url ? (advisor.sebi_cert_url.startsWith("http") ? advisor.sebi_cert_url : "https://alphamarket.co.in" + advisor.sebi_cert_url) : null;
  data.advisorSebiRegistrationNo = advisor?.sebi_reg_number || null;
  data.equityCall = equityCall;
  data.fnoCall = null;
  data.thematicCollection = toArr(strategy.key_sectors);

  // Root envelope
  const envelope: any = {};
  envelope.status = "success";
  envelope.statusCode = 200;
  envelope.message = { key: "GET", message: "Get Successfully" };
  envelope.data = data;

  // ── SAFETY: Validate payload before returning ──
  const requiredDataFields = ["strategyId","recommendationId","rational","creationDate","theme","managementStyle","volatility","marketCap","horizon","keySector","strategyName","benchmark","strategyType","advisorName","profilePic","certificateURl","advisorSebiRegistrationNo","equityCall","fnoCall"];
  for (const f of requiredDataFields) {
    if (!(f in data)) {
      console.error("[Format A] MISSING FIELD in equity payload:", f);
      data[f] = null; // Ensure field exists even if null
    }
  }
  if (!("thematicCollection" in data)) data.thematicCollection = null;

  return envelope;
}

// ─── FnO Builder ────────────────────────────────────────────────

async function buildFno(event: string, p: any, strategy: any, advisor: any): Promise<any> {
  const isClosed = event === "POSITION_CLOSED" || event === "TARGET_ACHIEVED" || event === "STOPLOSS_TRIGGERED" || event === "TRAILING_SL_TRIGGERED" || p.status === "Closed";
  const recId = await nextRecId();
  const legId = String(Number(recId) + 1);
  const action = String(p.buy_sell || "BUY").toUpperCase();
  const strike = toNum(p.strike_price) ?? 0;

  const cp = p.call_put ? String(p.call_put).toUpperCase() : "";
  let series = "CE";
  let optionType = "Option";
  if (cp.startsWith("P") || cp === "PE") { series = "PE"; }
  if (p.segment === "Future") { series = "XX"; optionType = "Future"; }

  const fnoLeg: any = {
    exchange: "NSE",
    legId: legId,
    exchangeToken: null,
    symbol: p.symbol,
    name: p.symbol,
    series: series,
    isStoppLossAbsolute: { code: "Y", name: "Yes" },
    expiryDate: epochMs(p.expiry),
    lotSize: toNum(p.lots) || 1,
    strike: strike,
    profitLossPercent: isClosed ? toNum(p.gain_percent) : null,
    optionType: optionType,
    buyDate: epochMs(p.created_at),
    buyPrice: toNum(p.entry_price) ?? 0,
    buyPriceRangeEnd: null,
    buyPriceRangeStart: null,
    callType: action,
    sellPrice: isClosed ? toNum(p.exit_price) : null,
    sellDate: isClosed ? epochMs(p.exit_date) : null,
    targetPriceRange: toNum(p.target),
    profitGoal: null,
    stopLoss: toNum(p.stop_loss),
    exitType: isClosed ? mapExitType(event, p.status) : null,
    status: isClosed ? "CLOSED" : "PUBLISHED",
  };

  let rootType = "Option";
  if (optionType === "Future") rootType = "Future";

  const data: any = {};
  data.strategyId = strategy.slug || strategy.id;
  data.recommendationId = recId;
  data.rational = p.rationale || null;
  data.creationDate = epochMs(p.created_at);
  data.theme = deriveTheme(strategy);
  data.managementStyle = toArr(strategy.management_style) || ["Active"];
  data.volatility = toArr(strategy.volatility);
  data.marketCap = null;
  data.horizon = toArr(strategy.horizon);
  data.keySector = toArr(strategy.key_sectors);
  data.strategyName = strategy.name;
  data.strategyDescription = strategy.description || null;
  data.benchmark = strategy.benchmark || "Nifty 50";
  data.strategyType = rootType;
  data.advisorName = advisor?.company_name || advisor?.username;
  data.profilePic = advisor?.logo_url ? "https://alphamarket.co.in" + advisor.logo_url : null;
  data.certificateURl = advisor?.sebi_cert_url ? (advisor.sebi_cert_url.startsWith("http") ? advisor.sebi_cert_url : "https://alphamarket.co.in" + advisor.sebi_cert_url) : null;
  data.advisorSebiRegistrationNo = advisor?.sebi_reg_number || null;
  data.equityCall = null;
  data.fnoCall = [fnoLeg];
  data.thematicCollection = toArr(strategy.key_sectors);

  const envelope: any = {};
  envelope.status = "success";
  envelope.statusCode = 200;
  envelope.message = { key: "GET", message: "Get Successfully" };
  envelope.data = data;

  // ── SAFETY: Validate payload before returning ──
  const requiredDataFields = ["strategyId","recommendationId","rational","creationDate","theme","managementStyle","volatility","marketCap","horizon","keySector","strategyName","benchmark","strategyType","advisorName","profilePic","certificateURl","advisorSebiRegistrationNo","equityCall","fnoCall"];
  for (const f of requiredDataFields) {
    if (!(f in data)) {
      console.error("[Format A] MISSING FIELD in fno payload:", f);
      data[f] = null;
    }
  }
  if (!("thematicCollection" in data)) data.thematicCollection = null;

  return envelope;
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
  brokerName?: string,
): Promise<any> {
  const strategyId = data.strategyId || data.strategy_id;
  if (!strategyId) throw new Error("strategyId missing in event data");

  const loaded = await loadStrategyAndAdvisor(strategyId);
  if (!loaded) throw new Error(`Strategy ${strategyId} not found`);

  const isFno = data.type === "FnO" || data.segment === "Option" || data.segment === "Future" || data.segment === "Commodity";
  const n = normalize(data);

  const payload = isFno
    ? await buildFno(event, n, loaded.strategy, loaded.advisor)
    : await buildEquity(event, n, loaded.strategy, loaded.advisor);

  // Add duration field for Dreamstreet only (integer, number of days)
  if (brokerName && brokerName.toLowerCase().includes("dreamstreet") && payload?.data) {
    payload.data.duration = n.duration || null;
    payload.data.durationUnit = (n.durationUnit || "days").toLowerCase();
  }

  return payload;
}

export function inferSegment(event: string, data: Record<string, any>): string | null {
  const segment = data.segment;
  if (segment === "Commodity" || data.type === "CommodityFuture") return "commodity_futures";
  if (segment === "Option") return "fno_options";
  if (segment === "Future") return "fno_futures";
  if (data.type === "FnO") return "fno_options";
  if (data.publishMode === "intraday") return "equity_intraday";
  if (data.horizon === "Positional") return "equity_positional";
  if (data.horizon === "Swing" || data.publishMode === "swing") return "equity_swing";
  return "equity_cash";
}
