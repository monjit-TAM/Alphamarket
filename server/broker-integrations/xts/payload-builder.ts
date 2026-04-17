/**
 * server/broker-integrations/xts/payload-builder.ts
 *
 * Pure functions that build XTS payload JSON from internal types.
 * No DB access, no side effects — easy to unit test.
 *
 * Config-driven: the `InstrumentIdStrategy` in spec.ts controls whether
 * we send symbols or numeric IDs for exchangeInstrumentID.
 */

import type {
  InternalCall, InternalPosition, InternalStrategy, InternalAdvisor,
  BrokerEventType
} from "../core/types";
import {
  XTS_EXCHANGE_SEGMENT, XTS_SERIES, XTS_OPTION_TYPE, XTS_PRODUCT_TYPE,
  XTS_ORDER_TYPE, XTS_ORDER_SIDE, XTS_TIME_IN_FORCE, XTS_THEMATIC,
  INDEX_SYMBOLS, XTS_DEFAULT_CONFIG,
  InstrumentIdStrategy, ExchangeFieldFormat,
} from "./spec";
import {
  normalizeOptionType, normalizeOrderSide, formatExpiry, sanitizeTheory,
} from "../core/validation";
import type { XtsInstrument } from "./instrument-lookup";

// ─── XTS payload shape ────────────────────────────────────────────

export interface XtsOrderLeg {
  exchange?: string;
  exchangeSegment?: string;
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

export interface XtsPayload {
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
  orders: XtsOrderLeg[];
  thematicCollection: string;
  // Optional top-level segment (some XTS variants accept this)
  exchangeSegment?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function asNum(v: any): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function pickFirst<T>(...values: (T | null | undefined)[]): T | null {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== "") return v as T;
  }
  return null;
}

function toIsoString(v: any): string {
  if (!v) return new Date().toISOString();
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function isIndex(symbol: string): boolean {
  return INDEX_SYMBOLS.has(symbol.toUpperCase());
}

/**
 * Format the exchange field value based on segment config.
 */
function exchangeValue(segmentKind: "CASH" | "FO", format: ExchangeFieldFormat): string {
  if (format === "NSE") return "NSE";
  if (format === "NSECM") return segmentKind === "CASH" ? "NSECM" : "NSEFO";
  if (format === "NSEFO") return "NSEFO"; // unusual override — always FO
  return "NSE";
}

/**
 * Validity string (spec: "Until Further Notice" default; or "{n} {unit}")
 */
function formatValidity(duration?: number | null, unit?: string | null): string {
  if (!duration || !unit) return "Until Further Notice";
  return `${duration} ${unit}`;
}

/**
 * Build the thematicCollection value.
 */
function thematicFor(segmentKind: "CASH" | "FO", strategyType?: string): string {
  if (segmentKind === "FO") return XTS_THEMATIC.FNO;
  if (strategyType === "Commodity") return XTS_THEMATIC.COMMODITY;
  if (strategyType === "Basket") return XTS_THEMATIC.BASKET;
  return XTS_THEMATIC.EQUITY;
}

/**
 * Build the strategyname — the full string XTS stores on its advisory tile.
 */
function buildStrategyName(
  strategy: InternalStrategy,
  advisor: InternalAdvisor,
  override?: string | null
): string {
  if (override && override.trim()) return override.trim();
  const advisorName = pickFirst<string>(
    advisor.company_name, advisor.companyName, advisor.username
  ) ?? "Advisor";
  return `${strategy.name} | ${advisorName}`;
}

export interface BuildConfig {
  instrumentIdStrategy: InstrumentIdStrategy;
  exchangeFieldFormat: ExchangeFieldFormat;
  useExchangeSegmentField: boolean;   // if true, leg uses "exchangeSegment" instead of "exchange"
  emitTopLevelSegment: boolean;       // if true, also add top-level "exchangeSegment"
  truncateTheoryChars: number;
  asciiOnlyTheory: boolean;
  strategyNameOverride?: string | null;
}

export const BUILD_CONFIG_DEFAULT: BuildConfig = {
  instrumentIdStrategy: XTS_DEFAULT_CONFIG.instrumentIdStrategy,
  exchangeFieldFormat: XTS_DEFAULT_CONFIG.exchangeFieldFormat,
  useExchangeSegmentField: XTS_DEFAULT_CONFIG.useExchangeSegmentField,
  emitTopLevelSegment: false,
  truncateTheoryChars: XTS_DEFAULT_CONFIG.truncateTheoryChars,
  asciiOnlyTheory: XTS_DEFAULT_CONFIG.asciiOnlyTheory,
};

// ─── Equity call builder ──────────────────────────────────────────

export function buildEquityCallPayload(
  call: InternalCall,
  strategy: InternalStrategy,
  advisor: InternalAdvisor,
  instrument: XtsInstrument | null,    // null → config.instrumentIdStrategy === "symbol"
  config: BuildConfig = BUILD_CONFIG_DEFAULT,
  eventType: BrokerEventType = "CALL_CREATED"
): XtsPayload {
  const symbol = pickFirst<string>(call.symbol, call.stockName, call.stock_name) ?? "";
  const action = (call.action ?? "BUY").toUpperCase();
  const buyRange = asNum(pickFirst(call.buy_range_start, call.buyRangeStart));
  const entryPrice = asNum(pickFirst(call.entry_price, call.entryPrice));

  const exchangeInstrumentID = resolveInstrumentId(symbol, instrument, config);
  const orderType = buyRange != null ? XTS_ORDER_TYPE.LIMIT : XTS_ORDER_TYPE.MARKET;
  const productType = deriveEquityProductType(call);
  const orderSide = normalizeOrderSide(action);
  const createdAt = toIsoString(
    pickFirst(call.call_date, call.callDate, call.created_at, call.createdAt)
  );

  const limitPrice = asNum(pickFirst(call.entry_price, call.entryPrice, call.buy_range_start, call.buyRangeStart));
  const stopLoss = asNum(pickFirst(call.stop_loss, call.stopLoss));
  const target = asNum(pickFirst(call.target_price, call.targetPrice));
  const profitBooked = asNum(pickFirst(call.sell_price, call.sellPrice));

  const legName = symbol;
  const legId = `${call.id}-L1`;

  const leg: XtsOrderLeg = {
    exchangeInstrumentID,
    series: XTS_SERIES.EQUITY,
    name: legName,
    productType,
    orderType,
    orderSide,
    timeInForce: XTS_TIME_IN_FORCE.DAY,
    orderQuantity: 1,
    limitPrice,
    stopLoss,
    target,
    profitBooked,
    createdAt,
    legId,
  };
  if (config.useExchangeSegmentField) {
    leg.exchangeSegment = exchangeValue("CASH", config.exchangeFieldFormat);
  } else {
    leg.exchange = exchangeValue("CASH", config.exchangeFieldFormat);
  }

  const payload: XtsPayload = {
    strategyname: buildStrategyName(strategy, advisor, config.strategyNameOverride),
    messageID: call.id,
    stopLossPrice: stopLoss,
    targetPrice: target,
    profitBookedPrice: profitBooked,
    limitPrice,
    badge: pickFirst<string>(call.theme, strategy.horizon) ?? "Short Term",
    theory: config.asciiOnlyTheory
      ? sanitizeTheory(call.rationale, config.truncateTheoryChars)
      : (call.rationale ?? "").substring(0, config.truncateTheoryChars),
    validity: formatValidity(
      call.duration ?? null,
      pickFirst<string>(call.duration_unit, call.durationUnit)
    ),
    createdAt,
    exchangeInstrumentID,
    orders: [leg],
    thematicCollection: thematicFor("CASH", strategy.type),
  };

  if (config.emitTopLevelSegment) {
    payload.exchangeSegment = exchangeValue("CASH", config.exchangeFieldFormat);
  }

  applyEventOverrides(payload, eventType, pickFirst(call.sell_price, call.sellPrice));
  return payload;
}

// ─── F&O position builder ──────────────────────────────────────────

export function buildFnoPositionPayload(
  pos: InternalPosition,
  strategy: InternalStrategy,
  advisor: InternalAdvisor,
  instrument: XtsInstrument | null,
  config: BuildConfig = BUILD_CONFIG_DEFAULT,
  eventType: BrokerEventType = "POSITION_CREATED"
): XtsPayload {
  const symbol = pos.symbol ?? "";
  const segment = pos.segment ?? "";
  const callPut = pickFirst<string>(pos.call_put, pos.callPut);
  const expiry = pos.expiry!;
  const strikePrice = asNum(pickFirst(pos.strike_price, pos.strikePrice));
  const buySell = pickFirst<string>(pos.buy_sell, pos.buySell) ?? "BUY";
  const entryPrice = asNum(pickFirst(pos.entry_price, pos.entryPrice));
  const stopLoss = asNum(pickFirst(pos.stop_loss, pos.stopLoss));
  const target = asNum(pos.target);
  const exitPrice = asNum(pickFirst(pos.exit_price, pos.exitPrice));
  const lots = pos.lots ?? 1;
  const createdAt = toIsoString(pickFirst(pos.created_at, pos.createdAt));

  const exchangeInstrumentID = resolveInstrumentId(symbol, instrument, config);

  // Derive series based on segment + whether symbol is an index
  let series: string;
  if (segment === "Option") {
    series = isIndex(symbol) ? XTS_SERIES.OPT_INDEX : XTS_SERIES.OPT_STOCK;
  } else if (segment === "Future") {
    series = isIndex(symbol) ? XTS_SERIES.FUT_INDEX : XTS_SERIES.FUT_STOCK;
  } else {
    series = XTS_SERIES.EQUITY;
  }

  // Build the display name (XTS uses this string as the "title" of the advisory)
  let contractName: string;
  if (segment === "Option") {
    const normalizedType = normalizeOptionType(callPut!);
    contractName = `${symbol} ${strikePrice} ${normalizedType} ${formatExpiry(expiry)}`;
  } else if (segment === "Future") {
    contractName = `${symbol} FUT ${formatExpiry(expiry)}`;
  } else {
    contractName = symbol;
  }

  const leg: XtsOrderLeg = {
    exchangeInstrumentID,
    series,
    name: contractName,
    productType: deriveFnoProductType(pos),
    orderType: XTS_ORDER_TYPE.LIMIT,
    orderSide: normalizeOrderSide(buySell),
    timeInForce: XTS_TIME_IN_FORCE.DAY,
    orderQuantity: lots,
    limitPrice: entryPrice,
    stopLoss,
    target,
    profitBooked: exitPrice,
    createdAt,
    legId: `${pos.id}-L1`,
  };
  if (config.useExchangeSegmentField) {
    leg.exchangeSegment = exchangeValue("FO", config.exchangeFieldFormat);
  } else {
    leg.exchange = exchangeValue("FO", config.exchangeFieldFormat);
  }

  const payload: XtsPayload = {
    strategyname: buildStrategyName(strategy, advisor, config.strategyNameOverride),
    messageID: pos.id,
    stopLossPrice: stopLoss,
    targetPrice: target,
    profitBookedPrice: exitPrice,
    limitPrice: entryPrice,
    badge: pickFirst<string>(pos.theme, strategy.horizon) ?? "Short Term",
    theory: config.asciiOnlyTheory
      ? sanitizeTheory(pos.rationale, config.truncateTheoryChars)
      : (pos.rationale ?? "").substring(0, config.truncateTheoryChars),
    validity: formatValidity(
      pos.duration ?? null,
      pickFirst<string>(pos.duration_unit, pos.durationUnit)
    ),
    createdAt,
    exchangeInstrumentID,
    orders: [leg],
    thematicCollection: thematicFor("FO", strategy.type),
  };

  if (config.emitTopLevelSegment) {
    payload.exchangeSegment = exchangeValue("FO", config.exchangeFieldFormat);
  }

  applyEventOverrides(payload, eventType, pickFirst(pos.exit_price, pos.exitPrice));
  return payload;
}

// ─── Event-type overrides (CLOSED, TARGET_ACHIEVED, etc.) ────────

function applyEventOverrides(
  payload: XtsPayload,
  eventType: BrokerEventType,
  exitPrice: any
) {
  const CLOSE_EVENTS: BrokerEventType[] = [
    "CALL_CLOSED", "POSITION_CLOSED",
    "TARGET_ACHIEVED", "STOPLOSS_TRIGGERED", "TRAILING_SL_TRIGGERED",
  ];
  if (CLOSE_EVENTS.includes(eventType)) {
    const closed = asNum(exitPrice);
    if (closed != null) {
      payload.profitBookedPrice = closed;
      if (payload.orders.length > 0) payload.orders[0].profitBooked = closed;
    }
  }
}

// ─── Derivation helpers ─────────────────────────────────────────

function deriveEquityProductType(call: InternalCall): string {
  const unit = pickFirst<string>(call.duration_unit, call.durationUnit);
  if (unit === "Intraday") return XTS_PRODUCT_TYPE.MIS;
  return XTS_PRODUCT_TYPE.CNC;
}

function deriveFnoProductType(pos: InternalPosition): string {
  // F&O positions are NRML by convention unless explicitly intraday
  const unit = pickFirst<string>(pos.duration_unit, pos.durationUnit);
  if (unit === "Intraday") return XTS_PRODUCT_TYPE.MIS;
  return XTS_PRODUCT_TYPE.NRML;
}

function resolveInstrumentId(
  symbol: string,
  instrument: XtsInstrument | null,
  config: BuildConfig
): string {
  if (config.instrumentIdStrategy === "symbol") return symbol;
  if (!instrument) {
    // Caller should have ensured instrument is populated for non-symbol strategies.
    // Fallback to symbol rather than throwing — we log this condition upstream.
    return symbol;
  }
  return instrument.exchangeInstrumentID;
}
