/**
 * server/broker-integrations/xts/spec.ts
 *
 * Constants from the XTS TradeIdea API spec (v1.1.0, Feb 2026).
 * All literals that appear in the XTS payload are centralized here.
 * If XTS publishes a spec update, we change values here — nowhere else.
 */

// ─── Endpoints ───
export const XTS_ENDPOINTS = {
  sessionToken: "/sessiontoken",
  publishWebhook: "/publishwebhook",
} as const;

// ─── Exchange Segments (per Symphony Fintech convention, v2 documentation) ───
// Source: https://symphonyfintech.com/xts-market-data-front-end-api-v2/
export const XTS_EXCHANGE_SEGMENT = {
  NSE_CASH: "NSECM",       // numeric: 1
  NSE_FO: "NSEFO",         // numeric: 2
  NSE_CURRENCY: "NSECD",   // numeric: 3
  BSE_CASH: "BSECM",       // numeric: 11
  BSE_FO: "BSEFO",         // numeric: 12
  BSE_CURRENCY: "BSECD",   // numeric: 13
  MCX_FO: "MCXFO",
  NCDEX: "NCDEX",
} as const;

export const XTS_EXCHANGE_SEGMENT_NUMERIC: Record<string, number> = {
  NSECM: 1, NSEFO: 2, NSECD: 3,
  BSECM: 11, BSEFO: 12, BSECD: 13,
};

// ─── Series values per XTS ───
// Stock equity, Index futures, Stock futures, Index options, Stock options
export const XTS_SERIES = {
  EQUITY: "EQ",
  FUT_INDEX: "FUTIDX",
  FUT_STOCK: "FUTSTK",
  OPT_INDEX: "OPTIDX",
  OPT_STOCK: "OPTSTK",
} as const;

// ─── Option types (NSE convention, matches XTS PDF Page 6) ───
export const XTS_OPTION_TYPE = {
  CALL: "CE",   // Call European — NOT "CA", NOT "CALL"
  PUT: "PE",    // Put European  — NOT "PU", NOT "PUT"
} as const;

// In xts_instrument_master table, option_type column uses numeric codes:
// 3 = CE (Call), 4 = PE (Put)
export const XTS_INSTRUMENT_MASTER_OPTION_TYPE: Record<string, string> = {
  "3": XTS_OPTION_TYPE.CALL,
  "4": XTS_OPTION_TYPE.PUT,
};

// ─── Product Types ───
export const XTS_PRODUCT_TYPE = {
  CNC: "CNC",     // Cash & Carry — for equity delivery
  MIS: "MIS",     // Margin Intraday Square-off — for intraday
  NRML: "NRML",   // Normal — for F&O positional
} as const;

// ─── Order Types / Sides / Validity ───
export const XTS_ORDER_TYPE = {
  MARKET: "MARKET",
  LIMIT: "LIMIT",
} as const;

export const XTS_ORDER_SIDE = {
  BUY: "BUY",
  SELL: "SELL",
} as const;

export const XTS_TIME_IN_FORCE = {
  DAY: "DAY",
  IOC: "IOC",
} as const;

// ─── Success codes we expect from XTS ───
export const XTS_SUCCESS_CODES = [
  "s-advisory-publish-00001",
  "s-generateVendorSession-00041",
];

// ─── Error codes we recognize ───
export const XTS_ERROR_CODES = {
  SESSION_EXPIRED: "e-session-0007",
  PUBLISH_FAILED: "e-tradeidea-publish-00001",
};

// ─── Index symbols for series derivation ───
export const INDEX_SYMBOLS = new Set([
  "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50",
  "SENSEX", "BANKEX", "SENSEX50",
]);

// ─── Thematic collection (top-level payload field) ───
export const XTS_THEMATIC = {
  EQUITY: "Equity",
  FNO: "F&O",
  COMMODITY: "Commodity",
  BASKET: "Basket",
} as const;

// ─── Timeouts / retries ───
export const XTS_TIMEOUTS = {
  tokenFetchMs: 10_000,
  publishMs: 15_000,
};

// ─── Payload build config — what ID format to use for exchangeInstrumentID ───
// As of 2026-04-17, XTS has been rejecting all known formats.
// This enum lets us switch strategies via broker_connections.payload_config without code changes.
export type InstrumentIdStrategy =
  | "symbol"                          // "ASHOKLEY"       (historical working format Apr 1/9)
  | "numeric_from_master"             // "212"            (look up in xts_instrument_master)
  | "numeric_with_segment_override";  // numeric ID + send exchangeSegment instead of exchange

export type ExchangeFieldFormat =
  | "NSE"       // legacy — ours sends this
  | "NSECM"     // Symphony convention — cash market
  | "NSEFO";    // Symphony convention — F&O

/**
 * Default strategy (matches what used to work; easiest to verify against history).
 * Broker_connections row can override via a new `payload_config` jsonb column (optional).
 */
export const XTS_DEFAULT_CONFIG = {
  instrumentIdStrategy: "symbol" as InstrumentIdStrategy,
  exchangeFieldFormat: "NSE" as ExchangeFieldFormat,
  useExchangeSegmentField: false, // if true, emit "exchangeSegment" instead of "exchange"
  truncateTheoryChars: 500,
  asciiOnlyTheory: true,
};
