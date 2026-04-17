import { db } from "./db";
import { sql } from "drizzle-orm";

// ============================================================================
// XTS Bridge Module — AlphaMarket → XTS Symphony Fintech
// ============================================================================

interface BrokerConnection {
  id: string;
  name: string;
  broker_type: string;
  base_url: string;
  vendor_code: string;
  vendor_key: string;
  is_enabled: boolean;
  token: string | null;
  token_issued_at: string | null;
}

interface AdvisorMapping {
  advisor_id: string;
  is_enabled: boolean;
  push_equity_calls: boolean;
  push_fno_positions: boolean;
  push_basket: boolean;
  thematic_collection_override: string | null;
}

interface StrategyMapping {
  strategy_id: string;
  is_enabled: boolean;
  custom_strategy_name: string | null;
}

interface XTSOrder {
  exchange: string;
  exchangeInstrumentID: string;
  series: string;
  name: string;
  productType: string;
  orderType: string;
  orderSide: string;
  timeInForce: string;
  orderQuantity: number;
  limitPrice: number | null;
  stopLoss: number | null;
  target: number | null;
  profitBooked: number | null;
  createdAt: string;
  legId: string;
}

interface XTSPayload {
  strategyname: string;
  messageID: string;
  stopLossPrice: number | null;
  targetPrice: number | null;
  profitBookedPrice: number | null;
  limitPrice: number | null;
  badge: string;
  theory: string;
  validity: string;
  createdAt: string;
  exchangeInstrumentID: string;
  orders: XTSOrder[];
  thematicCollection: string;
}

// --- Token Manager ---
const TOKEN_REFRESH_BUFFER_MS = 30 * 60 * 1000;
let cachedToken: string | null = null;
let tokenIssuedAt: number = 0;

async function getXTSToken(conn: BrokerConnection): Promise<string> {
  if (cachedToken && (Date.now() - tokenIssuedAt) < TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken;
  }
  if (conn.token && conn.token_issued_at) {
    const issuedAt = new Date(conn.token_issued_at).getTime();
    if ((Date.now() - issuedAt) < TOKEN_REFRESH_BUFFER_MS) {
      cachedToken = conn.token;
      tokenIssuedAt = issuedAt;
      return conn.token;
    }
  }
  console.log("[XTS Bridge] Fetching new session token...");
  const response = await fetch(`${conn.base_url}/sessiontoken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vendorCode: conn.vendor_code, vendorKey: conn.vendor_key }),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await response.json()) as any;
  const token = data?.result?.token || data?.token || null;
  if (!token) {
    const errMsg = JSON.stringify(data).slice(0, 300);
    await updatePingStatus(conn.id, "error", errMsg);
    throw new Error(`[XTS Bridge] Token fetch failed: ${errMsg}`);
  }
  cachedToken = token;
  tokenIssuedAt = Date.now();
  await db.execute(sql`UPDATE broker_connections SET token=${token},token_issued_at=NOW(),last_ping_at=NOW(),last_ping_status='ok',last_ping_error=NULL,updated_at=NOW() WHERE id=${conn.id}`);
  console.log("[XTS Bridge] Token refreshed successfully");
  return token;
}

async function updatePingStatus(connId: string, status: string, error: string | null) {
  await db.execute(sql`UPDATE broker_connections SET last_ping_at=NOW(),last_ping_status=${status},last_ping_error=${error},updated_at=NOW() WHERE id=${connId}`);
}

// --- Instrument Master ---
const instrumentMaster: Map<string, string> = new Map();

export async function loadInstrumentMaster(): Promise<void> {
  try {
    const all = await db.execute(sql.raw(`SELECT name, series, exchange_instrument_id FROM xts_instrument_master`));
    instrumentMaster.clear();
    for (const row of all.rows as any[]) {
      if (row.series === 'EQ' || row.series === 'FUTIDX' || row.series === 'FUTSTK') {
        instrumentMaster.set(row.name.toUpperCase(), row.exchange_instrument_id);
      } else {
        instrumentMaster.set(row.name.toUpperCase(), row.exchange_instrument_id);
      }
    }
    console.log(`[XTS Bridge] Loaded ${instrumentMaster.size} instruments from DB`);
  } catch {
    console.log("[XTS Bridge] Instrument master table not found — will use symbol as fallback");
  }
}

function lookupInstrumentID(symbol: string, exchange?: string): string {
  const key = symbol.toUpperCase();
  if (instrumentMaster.has(key)) return instrumentMaster.get(key)!;
  if (exchange && instrumentMaster.has(`${exchange}:${key}`)) return instrumentMaster.get(`${exchange}:${key}`)!;
  console.warn(`[XTS Bridge] No instrument ID for ${symbol}, using symbol as fallback`);
  return symbol;
}

// --- Permission Checks ---
async function getActiveConnection(): Promise<BrokerConnection | null> {
  const result = await db.execute(sql`SELECT * FROM broker_connections WHERE broker_type='XTS' AND is_enabled=true LIMIT 1`);
  return (result.rows[0] as BrokerConnection) || null;
}

async function getAdvisorMapping(connId: string, advisorId: string): Promise<AdvisorMapping | null> {
  const result = await db.execute(sql`SELECT * FROM broker_advisor_mappings WHERE broker_connection_id=${connId} AND advisor_id=${advisorId} AND is_enabled=true`);
  return (result.rows[0] as AdvisorMapping) || null;
}

async function getStrategyMapping(connId: string, strategyId: string): Promise<StrategyMapping | null> {
  const result = await db.execute(sql`SELECT * FROM broker_strategy_mappings WHERE broker_connection_id=${connId} AND strategy_id=${strategyId} AND is_enabled=true`);
  return (result.rows[0] as StrategyMapping) || null;
}

// --- Payload Mapping ---
const INDEX_SYMBOLS = ["NIFTY","BANKNIFTY","FINNIFTY","MIDCPNIFTY","SENSEX","BANKEX"];

function deriveSeries(segment?: string, callPut?: string, symbol?: string): string {
  if (segment === "Option") {
    const isIndex = symbol && INDEX_SYMBOLS.includes(symbol.toUpperCase());
    return isIndex ? "OPTIDX" : "OPTSTK";
  }
  if (segment === "Future") {
    const isIndex = symbol && INDEX_SYMBOLS.includes(symbol.toUpperCase());
    return isIndex ? "FUTIDX" : "FUTSTK";
  }
  return "EQ";
}

function deriveProductType(durationUnit?: string, segment?: string): string {
  if (segment === "Option" || segment === "Future") return "NRML";
  if (durationUnit === "Intraday") return "MIS";
  return "CNC";
}

function formatValidity(duration?: number, durationUnit?: string): string {
  if (!duration || !durationUnit) return "Until Further Notice";
  return `${duration} ${durationUnit}`;
}

function mapEquityCallToXTS(call: any, strategy: any, advisor: any, sm: StrategyMapping | null): XTSPayload {
  const symbol = call.symbol || call.stockName || call.stock_name;
  const exchange = "NSE";
  const instrumentID = lookupInstrumentID(symbol, exchange);
  const strategyName = sm?.custom_strategy_name || `${strategy.name} | ${advisor.company_name || advisor.username}`;
  const order: XTSOrder = {
    exchange, exchangeInstrumentID: instrumentID, series: "EQ", name: symbol,
    productType: deriveProductType(call.durationUnit || call.duration_unit),
    orderType: (call.buyRangeStart || call.buy_range_start) ? "LIMIT" : "MARKET",
    orderSide: (call.action || "BUY").toUpperCase(), timeInForce: "DAY", orderQuantity: 1,
    limitPrice: parseFloat(call.entryPrice || call.entry_price || call.buyRangeStart || call.buy_range_start) || null,
    stopLoss: parseFloat(call.stopLoss || call.stop_loss) || null,
    target: parseFloat(call.targetPrice || call.target_price) || null,
    profitBooked: parseFloat(call.sellPrice || call.sell_price) || null,
    createdAt: new Date(call.callDate || call.call_date || call.createdAt || call.created_at || Date.now()).toISOString(),
    legId: `${call.id || call.uid}-L1`,
  };
  return {
    strategyname: strategyName, messageID: call.id || call.uid,
    stopLossPrice: order.stopLoss, targetPrice: order.target, profitBookedPrice: order.profitBooked,
    limitPrice: order.limitPrice, badge: call.theme || strategy.horizon || "Short Term",
    theory: (call.rationale || "").replace(/[^\x00-\x7F]/g, "").substring(0, 500), validity: formatValidity(call.duration, call.durationUnit || call.duration_unit),
    createdAt: order.createdAt, exchangeInstrumentID: instrumentID, orders: [order], thematicCollection: "Equity",
  };
}

function mapPositionToXTS(pos: any, strategy: any, advisor: any, sm: StrategyMapping | null): XTSPayload {
  const symbol = pos.symbol;
  const exchange = "NSE";
  const instrumentID = lookupInstrumentID(symbol, exchange);
  const strategyName = sm?.custom_strategy_name || `${strategy.name} | ${advisor.company_name || advisor.username}`;
  const expiryStr = pos.expiry ? new Date(pos.expiry).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) : "";
  const contractName = pos.segment === "Option"
    ? `${symbol} ${pos.strikePrice||pos.strike_price} ${(pos.callPut||pos.call_put||"").substring(0,2).toUpperCase()} ${expiryStr}`
    : `${symbol} FUT ${expiryStr}`;
  const order: XTSOrder = {
    exchange, exchangeInstrumentID: instrumentID, series: deriveSeries(pos.segment, pos.callPut||pos.call_put, pos.symbol),
    name: contractName, productType: deriveProductType(pos.durationUnit||pos.duration_unit, pos.segment),
    orderType: "LIMIT", orderSide: (pos.buySell||pos.buy_sell||"BUY").toUpperCase(), timeInForce: "DAY",
    orderQuantity: pos.lots || 1,
    limitPrice: parseFloat(pos.entryPrice||pos.entry_price) || null,
    stopLoss: parseFloat(pos.stopLoss||pos.stop_loss) || null,
    target: parseFloat(pos.target) || null,
    profitBooked: parseFloat(pos.exitPrice||pos.exit_price) || null,
    createdAt: new Date(pos.createdAt||pos.created_at||Date.now()).toISOString(),
    legId: `${pos.id||pos.uid}-L1`,
  };
  return {
    strategyname: strategyName, messageID: pos.id || pos.uid,
    stopLossPrice: order.stopLoss, targetPrice: order.target, profitBookedPrice: order.profitBooked,
    limitPrice: order.limitPrice, badge: pos.theme || strategy.horizon || "Short Term",
    theory: (pos.rationale || "").replace(/[^\x00-\x7F]/g, "").substring(0, 500), validity: formatValidity(pos.duration, pos.durationUnit||pos.duration_unit),
    createdAt: order.createdAt, exchangeInstrumentID: instrumentID, orders: [order], thematicCollection: "F&O",
  };
}

// --- Publisher ---
async function publishToXTS(conn: BrokerConnection, payload: XTSPayload): Promise<{success:boolean;response:any;error?:string}> {
  const token = await getXTSToken(conn);
  const response = await fetch(`${conn.base_url}/publishwebhook`, {
    method: "POST", headers: {"Content-Type":"application/json","Authorization":token},
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (data?.type === "success") return { success: true, response: data };
  if (response.status === 401 || data?.code?.includes("token") || data?.code?.includes("session")) {
    console.log("[XTS Bridge] Token rejected, refreshing...");
    cachedToken = null;
    const freshToken = await getXTSToken(conn);
    const r2 = await fetch(`${conn.base_url}/publishwebhook`, {
      method:"POST",headers:{"Content-Type":"application/json","Authorization":freshToken},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(15000),
    });
    const d2 = await r2.json();
    if (d2?.type === "success") return {success:true,response:d2};
    return {success:false,response:d2,error:JSON.stringify(d2).slice(0,500)};
  }
  cachedToken = null; return {success:false,response:data,error:JSON.stringify(data).slice(0,500)};
}

// --- Audit Logger ---
async function logPublishAttempt(connId:string,callId:string,callType:string,eventType:string,symbol:string,advisorId:string,strategyId:string,payload:any,response:any,status:"success"|"error"|"skipped",errorMessage?:string) {
  try {
    await db.execute(sql`INSERT INTO xts_publish_log(broker_connection_id,call_id,call_type,event_type,message_id,symbol,advisor_id,strategy_id,payload,response,status,error_message,retry_count,published_at) VALUES(${connId},${callId},${callType},${eventType},${payload?.messageID||callId},${symbol},${advisorId},${strategyId},${JSON.stringify(payload||{})}::jsonb,${JSON.stringify(response||{})}::jsonb,${status},${errorMessage||null},0,NOW())`);
  } catch(err) { console.error("[XTS Bridge] Failed to write publish log:", err); }
}


// --- Enriched Call Logger ---
async function logEnrichedCallLog(
  connId: string, callId: string, strategyId: string, advisorId: string,
  payload: XTSPayload, xtsResponse: any, status: "success"|"error"|"skipped",
  errorMessage: string|undefined, rawData: any, strategy: any, advisor: any, env: string = "uat"
) {
  try {
    const now = new Date();
    const d = now.getDate(); const m = now.getMonth()+1;
    const dayMonth = String(d).padStart(2,"0") + String(m).padStart(2,"0");
    const order = payload.orders?.[0];
    const isFnO = rawData.type === "FnO" || rawData.segment === "Option" || rawData.segment === "Future";

    // Build equityCall block (matches reference format)
    const equityCall = !isFnO ? {
      exchange: order?.exchange || "NSE",
      legId: order?.legId || null,
      exchangeToken: payload.exchangeInstrumentID || null,
      symbol: rawData.symbol || rawData.stockName || rawData.stock_name || null,
      name: rawData.stockName || rawData.stock_name || rawData.symbol || null,
      buyDate: rawData.callDate || rawData.call_date || rawData.createdAt || rawData.created_at || now,
      buyPrice: parseFloat(rawData.entryPrice || rawData.entry_price || rawData.buyRangeStart || rawData.buy_range_start) || null,
      buyPriceRangeStart: parseFloat(rawData.buyRangeStart || rawData.buy_range_start || rawData.entryPrice) || null,
      buyPriceRangeEnd: parseFloat(rawData.buyRangeEnd || rawData.buy_range_end || rawData.entryPrice) || null,
      callType: (rawData.action || rawData.callType || "BUY").toUpperCase(),
      targetPriceRange: rawData.targetPrice || rawData.target_price || null,
      profitGoal: rawData.profitGoal || rawData.profit_goal || null,
      stopLoss: rawData.stopLoss || rawData.stop_loss || null,
      status: status === "success" ? "PUBLISHED" : "FAILED",
    } : null;

    // Build fnoCall block
    const fnoCall = isFnO ? {
      exchange: order?.exchange || "NSE",
      legId: order?.legId || null,
      exchangeToken: payload.exchangeInstrumentID || null,
      symbol: rawData.symbol || null,
      segment: rawData.segment || null,
      callPut: rawData.callPut || rawData.call_put || null,
      buySell: rawData.buySell || rawData.buy_sell || "BUY",
      expiry: rawData.expiry || null,
      strikePrice: rawData.strikePrice || rawData.strike_price || null,
      entryPrice: parseFloat(rawData.entryPrice || rawData.entry_price) || null,
      lots: rawData.lots || 1,
      target: rawData.target || rawData.targetPrice || null,
      stopLoss: rawData.stopLoss || rawData.stop_loss || null,
      exitPrice: rawData.exitPrice || rawData.exit_price || null,
      series: order?.series || null,
      productType: order?.productType || null,
      status: status === "success" ? "PUBLISHED" : "FAILED",
    } : null;

    const sym = rawData.symbol || rawData.stockName || rawData.stock_name || null;
    const callType = isFnO
      ? (rawData.buySell || rawData.buy_sell || "BUY").toUpperCase()
      : (rawData.action || "BUY").toUpperCase();

    await db.execute(sql`
      INSERT INTO xts_call_log (
        advisor_id, client_id, env, call_status, day_month, symbol, call_type,
        strategy_id, recommendation_id, rational, status, is_active,
        theme, thematic_collection, management_style, volatility, horizon,
        strategy_name, strategy_description, benchmark, strategy_type,
        advisor_name, profile_pic, advisor_sebi_reg_no, advisor_email, advisor_company,
        equity_call, fno_call, xts_payload, xts_response,
        publish_status, error_message, retry_count, creation_date, published_at
      ) VALUES (
        ${advisorId}, 'XTS', ${env},
        ${status === "success" ? "PUBLISHED" : "FAILED"},
        ${dayMonth}, ${sym}, ${callType},
        ${strategyId}, ${callId}, ${rawData.rationale || null},
        ${status === "success" ? "SEND" : "FAILED"}, true,
        ${JSON.stringify([rawData.theme || strategy.type || "Equity"])}::jsonb,
        ${JSON.stringify([payload.thematicCollection || strategy.type || "Equity"])}::jsonb,
        ${JSON.stringify(["Active"])}::jsonb,
        ${JSON.stringify([strategy.volatility || "Medium"])}::jsonb,
        ${JSON.stringify([strategy.horizon || payload.badge || "Short Term"])}::jsonb,
        ${strategy.name || null}, ${strategy.description || null},
        ${strategy.benchmark || "Nifty 50"}, ${strategy.type || null},
        ${advisor.company_name || advisor.username || null},
        ${advisor.profile_pic || strategy.profile_pic || null},
        ${advisor.sebi_reg_number || strategy.sebi_reg_number || null},
        ${advisor.email || null}, ${advisor.company_name || null},
        ${equityCall ? JSON.stringify(equityCall) : null}::jsonb,
        ${fnoCall ? JSON.stringify(fnoCall) : null}::jsonb,
        ${JSON.stringify(payload)}::jsonb,
        ${JSON.stringify(xtsResponse || {})}::jsonb,
        ${status}, ${errorMessage || null}, 0, NOW(), NOW()
      )
    `);
  } catch(err) {
    console.error("[XTS Bridge] Failed to write enriched call log:", err);
  }
}


// --- Main Event Handler ---
export async function handleXTSEvent(event: string, data: Record<string,any>, advisorId: string) {
  try {
    const conn = await getActiveConnection();
    if (!conn) return;
    const advisorMapping = await getAdvisorMapping(conn.id, advisorId);
    if (!advisorMapping) return;
    const isEquity = data.type === "EQUITY";
    const isFnO = data.type === "FnO" || data.segment === "Option" || data.segment === "Future";
    if (isEquity && !advisorMapping.push_equity_calls) {
      await logPublishAttempt(conn.id,data.uid,"EQUITY_CALL",event,data.symbol,advisorId,data.strategyId,{messageID:data.uid},null,"skipped","Advisor not enabled for equity calls");
      return;
    }
    if (isFnO && !advisorMapping.push_fno_positions) {
      await logPublishAttempt(conn.id,data.uid,"FNO_POSITION",event,data.symbol,advisorId,data.strategyId,{messageID:data.uid},null,"skipped","Advisor not enabled for F&O positions");
      return;
    }
    const strategyMapping = await getStrategyMapping(conn.id, data.strategyId);
    const strategyResult = await db.execute(sql`SELECT s.*,u.company_name,u.username,u.email,u.sebi_reg_number,u.sebi_cert_url FROM strategies s JOIN users u ON u.id=s.advisor_id WHERE s.id=${data.strategyId}`);
    const strategy = strategyResult.rows[0] as any;
    if (!strategy) { console.warn(`[XTS Bridge] Strategy ${data.strategyId} not found`); return; }
    const advisor = { company_name: strategy.company_name, username: strategy.username, email: strategy.email, sebi_reg_number: strategy.sebi_reg_number, profile_pic: strategy.sebi_cert_url };
    let payload: XTSPayload;
    let callType: string;
    if (isEquity) { callType = "EQUITY_CALL"; payload = mapEquityCallToXTS(data, strategy, advisor, strategyMapping); }
    else { callType = "FNO_POSITION"; payload = mapPositionToXTS(data, strategy, advisor, strategyMapping); }
    if (["CALL_CLOSED","POSITION_CLOSED","TARGET_ACHIEVED","STOPLOSS_TRIGGERED","TRAILING_SL_TRIGGERED"].includes(event)) {
      payload.profitBookedPrice = parseFloat(data.sellPrice||data.exitPrice||data.entryPrice) || null;
      if (payload.orders.length > 0) payload.orders[0].profitBooked = payload.profitBookedPrice;
    }
    if (event === "TRAILING_SL_UPDATED" && data.trailingStopLoss?.currentSL) {
      payload.stopLossPrice = parseFloat(data.trailingStopLoss.currentSL);
      if (payload.orders.length > 0) payload.orders[0].stopLoss = payload.stopLossPrice;
    }
    console.log(`[XTS Bridge] Publishing ${event} for ${data.symbol} (${callType})...`);
    const result = await publishToXTS(conn, payload);
    await logPublishAttempt(conn.id,data.uid,callType,event,data.symbol,advisorId,data.strategyId,payload,result.response,result.success?"success":"error",result.error);
    await logEnrichedCallLog(conn.id,data.uid,data.strategyId,advisorId,payload,result.response,result.success?"success":"error",result.error,data,strategy,advisor);
    if (result.success) console.log(`[XTS Bridge] ✓ Published ${event} for ${data.symbol}`);
    else console.error(`[XTS Bridge] ✗ Failed ${event} for ${data.symbol}: ${result.error}`);
  } catch(err:any) {
    console.error(`[XTS Bridge] Error handling ${event}:`, err.message);
    try {
      const conn = await getActiveConnection();
      if (conn) await logPublishAttempt(conn.id,data.uid,data.type==="EQUITY"?"EQUITY_CALL":"FNO_POSITION",event,data.symbol,advisorId,data.strategyId,{messageID:data.uid},null,"error",err.message);
    } catch {}
  }
}

export function initXTSBridge() {
  loadInstrumentMaster().catch(()=>{});
  console.log("[XTS Bridge] Module initialized");
}

console.log("[XTS Bridge] Module loaded");
