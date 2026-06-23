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
  if (type === "Option") return ["F&O"];
  if (type === "Future" || type === "FnO") return ["F&O"];
  if (type === "Commodity" || type === "CommodityFuture") return ["Commodity"];
  if (type === "Basket") return ["F&O"];
  return ["Equity"];
}

// Cache: leg_group_id → shared recommendationId for multi-leg positions
const multiLegRecIdCache: Record<string, string> = {};

// Ensures same recId across all brokers for one event (dispatcher calls buildFormatA per broker)
const eventRecIdCache: Map<string, string> = new Map();
setInterval(() => { if (eventRecIdCache.size > 50) eventRecIdCache.clear(); }, 30000);

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

async function lookupInstrument(symbol: string, preferExchange?: string): Promise<{companyName: string, token: string, exchange: string}> {
  try {
    let r;
    if (preferExchange === "MCX") {
      r = await db.execute(sql`SELECT company_name, instrument_token, exchange FROM nse_instruments WHERE symbol = ${symbol} ORDER BY CASE WHEN exchange = 'MCX' THEN 0 WHEN exchange = 'NSE' THEN 1 ELSE 2 END LIMIT 1`);
    } else {
      r = await db.execute(sql`SELECT company_name, instrument_token, exchange FROM nse_instruments WHERE symbol = ${symbol} ORDER BY CASE WHEN exchange = 'NSE' THEN 0 ELSE 1 END LIMIT 1`);
    }
    const row = (r.rows[0] as any);
    return { companyName: row?.company_name || symbol, token: row?.instrument_token || "", exchange: row?.exchange || preferExchange || "NSE" };
  } catch { return { companyName: symbol, token: "", exchange: preferExchange || "NSE" }; }
}

async function lookupFnoInstrument(symbol: string, strike: number, series: string, expiry: any, exchange?: string): Promise<string> {
  try {
    const exch = exchange || "NSE";
    const instType = series; // CE, PE, or FUT
    // Try exact match on instrument_master: name + strike + instrument_type + nearest expiry
    const r = await db.execute(sql`
      SELECT exchange_token, instrument_token, tradingsymbol, expiry
      FROM instrument_master
      WHERE name = ${symbol}
        AND strike = ${strike}
        AND instrument_type = ${instType}
        AND expiry >= CURRENT_DATE
      ORDER BY expiry ASC
      LIMIT 1
    `);
    const row = (r.rows[0] as any);
    if (row?.exchange_token) return String(row.exchange_token);
    if (row?.instrument_token) return String(row.instrument_token);
    return "";
  } catch (err: any) {
    console.error("[Format A] lookupFnoInstrument error:", err.message);
    return "";
  }
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

async function buildEquity(event: string, c: any, strategy: any, advisor: any, upstoxStrategyType?: string): Promise<any> {
  const isClosed = event === "CALL_CLOSED" || event === "POSITION_CLOSED" || event === "TARGET_ACHIEVED" || event === "STOPLOSS_TRIGGERED" || event === "TRAILING_SL_TRIGGERED" || c.status === "Closed";
  const isModified = event === "CALL_MODIFIED" || event === "POSITION_MODIFIED";
  
  // For CLOSE/MODIFY events: reuse original recommendationId so broker can match
  let recId: string;
  let legId: string;
  const callId = c.id || c.uid;
  if ((isClosed || isModified) && callId) {
    try {
      const existing = await db.execute(sql`SELECT webhook_rec_id FROM calls WHERE id = ${callId}`);
      const storedRecId = (existing.rows[0] as any)?.webhook_rec_id;
      if (storedRecId) {
        recId = storedRecId;
        legId = String(Number(recId) + 1);
        console.log("[Format A] Reusing recId for CLOSE:", c.stock_name, "recId:", recId);
      } else {
        recId = await nextRecId();
        legId = String(Number(recId) + 1);
        console.log("[Format A] No stored recId for:", c.stock_name, callId);
      }
    } catch (err: any) {
      console.error("[Format A] recId lookup error:", err.message);
      recId = await nextRecId();
      legId = String(Number(recId) + 1);
    }
  } else {
    // Cache ensures same recId for all brokers in one event cycle
    const eqKey = "eq_" + (callId || "") + "_" + event;
    if (callId && eventRecIdCache.has(eqKey)) {
      recId = eventRecIdCache.get(eqKey)!;
    } else {
      recId = await nextRecId();
      if (callId) eventRecIdCache.set(eqKey, recId);
    }
    legId = String(Number(recId) + 1);
    // Store rec_id on CREATE for future CLOSE events
    if (callId && !isClosed) {
      try { await db.execute(sql`UPDATE calls SET webhook_rec_id = ${recId} WHERE id = ${callId} AND webhook_rec_id IS NULL`); } catch {}
    }
  }
  const inst = await lookupInstrument(c.stock_name || c.symbol || "");
  const action = String(c.action || "BUY").toUpperCase();
  const bp = toNum(c.entry_price) ?? toNum(c.buy_range_start) ?? toNum(c.buy_range_end) ?? 0;
  const tp = toNum(c.target_price);
  const profitGoal = toStr(c.profit_goal) || ((bp > 0 && tp) ? String(Math.round(Math.abs((tp - bp) / bp) * 100)) : null);

  // equityCall object
  const equityCall: any = {
    exchange: inst.exchange || "NSE",
    legId: legId,
    exchangeToken: inst.token || null,
    symbol: c.stock_name,
    name: inst.companyName,
    buyDate: (action === "SELL" && !isClosed) ? null : (action === "SELL" && isClosed) ? epochMs(c.exit_date) : epochMs(c.call_date),
    buyPrice: (action === "SELL" && !isClosed) ? null : (action === "SELL" && isClosed) ? toNum(c.sell_price) : bp,
    buyPriceRangeEnd: (action === "SELL" && !isClosed) ? null : (action === "SELL" && isClosed) ? toNum(c.sell_price) : toNum(c.buy_range_end),
    buyPriceRangeStart: (action === "SELL" && !isClosed) ? null : (action === "SELL" && isClosed) ? toNum(c.sell_price) : (toNum(c.buy_range_start) ?? bp),
    callType: action,
    sellPrice: (action === "SELL") ? bp : (isClosed ? toNum(c.sell_price) : null),
    sellDate: (action === "SELL") ? epochMs(c.call_date) : (isClosed ? epochMs(c.exit_date) : null),
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
    let pnlPct = toNum(c.gain_percent);
    if ((pnlPct === null || pnlPct === 0) && bp > 0 && toNum(c.sell_price) && toNum(c.sell_price) !== bp) {
      const sp = toNum(c.sell_price)!;
      const act = String(c.action || "BUY").toUpperCase();
      pnlPct = act === "SELL" ? Number(((bp - sp) / bp * 100).toFixed(2)) : Number(((sp - bp) / bp * 100).toFixed(2));
    }
    equityCall.profitLossPercent = pnlPct;
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
  data.strategyType = upstoxStrategyType || "Equity";
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

async function buildFno(event: string, p: any, strategy: any, advisor: any, upstoxStrategyType?: string): Promise<any> {
  const isClosed = event === "POSITION_CLOSED" || event === "TARGET_ACHIEVED" || event === "STOPLOSS_TRIGGERED" || event === "TRAILING_SL_TRIGGERED" || p.status === "Closed";
  const isModified = event === "POSITION_MODIFIED";
  // For multi-leg: all legs in same group share one recommendationId, different legIds
  const groupId = p.leg_group_id;
  let recId: string;
  if (groupId && multiLegRecIdCache[groupId]) {
    recId = multiLegRecIdCache[groupId];
  } else {
    recId = await nextRecId();
    if (groupId) multiLegRecIdCache[groupId] = recId;
  }
  // For CLOSE/MODIFY events: reuse original recommendationId
  const posId = p.id || p.uid;
  let legId: string;
  if ((isClosed || isModified) && posId) {
    try {
      const existing = await db.execute(sql`SELECT webhook_rec_id FROM positions WHERE id = ${posId}`);
      const storedRecId = (existing.rows[0] as any)?.webhook_rec_id;
      if (storedRecId) {
        recId = storedRecId;
        legId = String(Number(recId) + 1);
        console.log("[Format A] Reusing FnO recId for CLOSE:", p.symbol, "recId:", recId);
      } else {
        legId = String(await nextRecId());
        console.log("[Format A] No stored FnO recId for:", p.symbol, posId);
      }
    } catch (err: any) {
      console.error("[Format A] FnO recId lookup error:", err.message);
      legId = String(await nextRecId());
    }
  } else {
    legId = String(await nextRecId());
    // Store rec_id on CREATE for future CLOSE events
    if (posId && !isClosed) {
      try { await db.execute(sql`UPDATE positions SET webhook_rec_id = ${recId} WHERE id = ${posId} AND webhook_rec_id IS NULL`); } catch {}
    }
  }
  const action = String(p.buy_sell || "BUY").toUpperCase();
  const strike = toNum(p.strike_price) ?? 0;

  const cp = p.call_put ? String(p.call_put).toUpperCase() : "";
  let series = "CE";
  let optionType = "Option";
  if (cp.startsWith("P") || cp === "PE") { series = "PE"; }
  if (p.segment === "Future") { series = "XX"; optionType = "Future"; }

  const isCommodity = strategy.type === "Commodity" || strategy.type === "CommodityFuture" || p.segment === "Commodity";
  const inst = await lookupInstrument(p.symbol || "", isCommodity ? "MCX" : undefined);
  // Lookup per-contract token from instrument_master (strike + expiry + CE/PE/FUT)
  const fnoSeries = optionType === "Future" ? "FUT" : series;
  const fnoToken = await lookupFnoInstrument(p.symbol || "", strike, fnoSeries, p.expiry, isCommodity ? "MCX" : "NSE");
  const isSell = action === "SELL";
  const entryPrice = toNum(p.entry_price) ?? 0;
  const fnoLeg: any = {
    exchange: isCommodity ? "MCX" : "NSE",
    legId: legId,
    exchangeToken: fnoToken || inst.token || null,
    symbol: p.symbol,
    name: inst.companyName || p.symbol,
    series: series,
    isStoppLossAbsolute: { code: "Y", name: "Yes" },
    expiryDate: epochMs(p.expiry),
    lotSize: toNum(p.lots) || 1,
    strike: strike,
    profitLossPercent: isClosed ? (toNum(p.gain_percent) || (() => {
      const ep = toNum(p.entry_price) ?? 0;
      const xp = toNum(p.exit_price) ?? 0;
      if (ep > 0 && xp > 0 && ep !== xp) {
        const act = String(p.buy_sell || "Buy");
        return act === "Sell" ? Number(((ep - xp) / ep * 100).toFixed(2)) : Number(((xp - ep) / ep * 100).toFixed(2));
      }
      return null;
    })()) : null,
    optionType: optionType,
    buyDate: (action === "SELL" && !isClosed) ? null : (action === "SELL" && isClosed) ? epochMs(p.exit_date) : epochMs(p.created_at),
    buyPrice: (action === "SELL" && !isClosed) ? null : (action === "SELL" && isClosed) ? toNum(p.exit_price) : entryPrice,
    buyPriceRangeEnd: (action === "SELL" && !isClosed) ? null : (action === "SELL" && isClosed) ? toNum(p.exit_price) : entryPrice,
    buyPriceRangeStart: (action === "SELL" && !isClosed) ? null : (action === "SELL" && isClosed) ? toNum(p.exit_price) : entryPrice,
    callType: action,
    sellPrice: (action === "SELL") ? entryPrice : (isClosed ? toNum(p.exit_price) : null),
    sellDate: (action === "SELL") ? epochMs(p.created_at) : (isClosed ? epochMs(p.exit_date) : null),
    targetPriceRange: toNum(p.target),
    profitGoal: null,
    stopLoss: toNum(p.stop_loss),
    exitType: isClosed ? mapExitType(event, p.status) : null,
    status: isClosed ? "CLOSED" : "PUBLISHED",
  };

  let rootType = upstoxStrategyType || "Option";
  if (!upstoxStrategyType) {
    if (optionType === "Future") rootType = "Future";
  }

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
    gain_percent: data.gain_percent ?? data.gainPercent ?? data.gainOrLossPercentage,
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
    duration: data.duration,
    durationUnit: data.durationUnit ?? data.duration_unit,
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

  // Detect FnO/Commodity using multiple signals — handles data where segment is wrong
  const stratType = loaded.strategy.type;
  const seg = data.segment;
  const hasStrike = !!(data.strikePrice || data.strike_price);
  const hasCallPut = !!(data.callPut || data.call_put);

  const isFnoByStrategy = stratType === "Option" || stratType === "Future" || stratType === "Commodity" || stratType === "CommodityFuture" || stratType === "Basket";
  const isFnoBySegment = seg === "Option" || seg === "Future" || seg === "Commodity";
  const isFnoByData = data.type === "FnO" || (hasStrike && hasCallPut);
  const isFno = isFnoByStrategy || isFnoBySegment || isFnoByData;

  // Determine correct strategyType for Upstox
  let upstoxStrategyType = "Equity";
  if (stratType === "Option" || (hasStrike && hasCallPut)) upstoxStrategyType = "Option";
  else if (stratType === "Future") upstoxStrategyType = "Future";
  else if (stratType === "CommodityFuture" || stratType === "Commodity") upstoxStrategyType = "CommodityFuture";
  else if (stratType === "Basket") upstoxStrategyType = isFnoByData ? "Option" : "Equity";

  const n = normalize(data);

  const payload = isFno
    ? await buildFno(event, n, loaded.strategy, loaded.advisor, upstoxStrategyType)
    : await buildEquity(event, n, loaded.strategy, loaded.advisor, upstoxStrategyType);

  // Handle multi-leg: build all legs into one fnoCall array
  if (data.multiLeg && data.allLegs && Array.isArray(data.allLegs)) {
    const legs: any[] = [];
    const recId = await nextRecId();
    if (data.legGroupId) multiLegRecIdCache[data.legGroupId] = recId;

    for (const legData of data.allLegs) {
      const ln = normalize(legData);
      const legId = String(await nextRecId());
      const action = String(ln.buy_sell || "BUY").toUpperCase();
      const strike = toNum(ln.strike_price) ?? 0;
      const cp = ln.call_put ? String(ln.call_put).toUpperCase() : "";
      let series = "CE";
      let optionType = "Option";
      if (cp.startsWith("P") || cp === "PE") { series = "PE"; }
      if (ln.segment === "Future") { series = "XX"; optionType = "Future"; }
      const isCommodityLeg = loaded.strategy.type === "Commodity" || loaded.strategy.type === "CommodityFuture" || ln.segment === "Commodity";
      const instLeg = await lookupInstrument(ln.symbol || "", isCommodityLeg ? "MCX" : undefined);
      const fnoSeriesLeg = optionType === "Future" ? "FUT" : series;
      const fnoTokenLeg = await lookupFnoInstrument(ln.symbol || "", strike, fnoSeriesLeg, ln.expiry, isCommodityLeg ? "MCX" : "NSE");
      const entryPrice = toNum(ln.entry_price) ?? 0;

      // Store recId on each individual position for future CLOSE matching
      const posLegId = ln.id || ln.uid;
      if (posLegId) {
        try { await db.execute(sql`UPDATE positions SET webhook_rec_id = ${recId} WHERE id = ${posLegId} AND webhook_rec_id IS NULL`); } catch {}
      }

      legs.push({
        exchange: isCommodityLeg ? "MCX" : "NSE",
        legId,
        exchangeToken: fnoTokenLeg || instLeg.token || null,
        symbol: ln.symbol,
        name: instLeg.companyName || ln.symbol,
        series,
        isStoppLossAbsolute: { code: "Y", name: "Yes" },
        expiryDate: epochMs(ln.expiry),
        lotSize: toNum(ln.lots) || 1,
        strike,
        profitLossPercent: null,
        optionType,
        buyDate: action === "SELL" ? null : epochMs(ln.created_at),
        buyPrice: action === "SELL" ? null : entryPrice,
        buyPriceRangeEnd: action === "SELL" ? null : entryPrice,
        buyPriceRangeStart: action === "SELL" ? null : entryPrice,
        callType: action,
        sellPrice: action === "SELL" ? entryPrice : null,
        sellDate: action === "SELL" ? epochMs(ln.created_at) : null,
        targetPriceRange: toNum(ln.target),
        profitGoal: null,
        stopLoss: toNum(ln.stop_loss),
        exitType: null,
        status: "PUBLISHED",
      });
    }

    // Build envelope once with all legs
    const advisor = loaded.advisor;
    const mlData: any = {};
    mlData.strategyId = loaded.strategy.slug || loaded.strategy.id;
    mlData.recommendationId = recId;
    mlData.rational = n.rationale || null;
    mlData.creationDate = epochMs(n.created_at);
    mlData.theme = deriveTheme(loaded.strategy);
    mlData.managementStyle = toArr(loaded.strategy.management_style) || ["Active"];
    mlData.volatility = toArr(loaded.strategy.volatility);
    mlData.marketCap = null;
    mlData.horizon = toArr(loaded.strategy.horizon);
    mlData.keySector = toArr(loaded.strategy.key_sectors);
    mlData.strategyName = loaded.strategy.name;
    mlData.strategyDescription = loaded.strategy.description || null;
    mlData.benchmark = loaded.strategy.benchmark || "Nifty 50";
    mlData.strategyType = upstoxStrategyType || "Option";
    mlData.advisorName = advisor?.company_name || advisor?.username;
    mlData.profilePic = advisor?.logo_url ? "https://alphamarket.co.in" + advisor.logo_url : null;
    mlData.certificateURl = advisor?.sebi_cert_url ? (advisor.sebi_cert_url.startsWith("http") ? advisor.sebi_cert_url : "https://alphamarket.co.in" + advisor.sebi_cert_url) : null;
    mlData.advisorSebiRegistrationNo = advisor?.sebi_reg_number || null;
    mlData.equityCall = null;
    mlData.fnoCall = legs;
    mlData.thematicCollection = toArr(loaded.strategy.key_sectors);

    const mlPayload: any = { status: "success", statusCode: 200, message: { key: "GET", message: "Get Successfully" }, data: mlData };

    // Add duration for Dreamstreet
    if (brokerName && brokerName.toLowerCase().includes("dreamstreet") && mlPayload.data) {
      let mlDur = n.duration;
      if (!mlDur || mlDur === 0) {
        const hz2 = String(n.horizon || mlPayload.data.horizon || "").toLowerCase();
        if (hz2.includes("intraday")) mlDur = 1;
      }
      mlPayload.data.duration = mlDur || null;
      mlPayload.data.durationUnit = (n.durationUnit || "days").toLowerCase();
    }

    return mlPayload;
  }

  // Add duration field for Dreamstreet only (integer, number of days)
  if (brokerName && brokerName.toLowerCase().includes("dreamstreet") && payload?.data) {
    let dur = n.duration;
    if (!dur || dur === 0) {
      const hz = String(n.horizon || payload.data.horizon || "").toLowerCase();
      if (hz.includes("intraday")) dur = 1;
    }
    payload.data.duration = dur || null;
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
