/**
 * server/broker-integrations/core/types.ts
 *
 * Shared types for all broker integration adapters (XTS, Upstox, Dreamstreet, ...)
 */

/**
 * Internal event types that flow through AlphaMarket when advisors publish calls.
 * These are broker-agnostic; each adapter maps them to broker-specific API events.
 */
export type BrokerEventType =
  | "CALL_CREATED"
  | "CALL_MODIFIED"
  | "CALL_CLOSED"
  | "POSITION_CREATED"
  | "POSITION_MODIFIED"
  | "POSITION_CLOSED"
  | "TARGET_ACHIEVED"
  | "STOPLOSS_TRIGGERED"
  | "TRAILING_SL_TRIGGERED"
  | "TRAILING_SL_UPDATED";

/**
 * The internal call (equity) row as it appears in the calls table.
 * camelCase or snake_case both possible depending on caller context.
 */
export interface InternalCall {
  id: string;
  strategy_id?: string;
  strategyId?: string;
  stock_name?: string;
  stockName?: string;
  symbol?: string;
  action?: string; // Buy / Sell
  buy_range_start?: string | number | null;
  buyRangeStart?: string | number | null;
  buy_range_end?: string | number | null;
  buyRangeEnd?: string | number | null;
  target_price?: string | number | null;
  targetPrice?: string | number | null;
  stop_loss?: string | number | null;
  stopLoss?: string | number | null;
  entry_price?: string | number | null;
  entryPrice?: string | number | null;
  sell_price?: string | number | null;
  sellPrice?: string | number | null;
  exit_date?: string | Date | null;
  exitDate?: string | Date | null;
  rationale?: string | null;
  status?: string;
  is_published?: boolean;
  isPublished?: boolean;
  call_date?: string | Date | null;
  callDate?: string | Date | null;
  created_at?: string | Date | null;
  createdAt?: string | Date | null;
  duration?: number | null;
  duration_unit?: string | null;
  durationUnit?: string | null;
  theme?: string | null;
  gain_percent?: string | number | null;
  gainPercent?: string | number | null;
  // Trailing SL
  trailing_sl_enabled?: boolean;
  trailing_sl_type?: string | null;
  trailing_sl_value?: string | null;
  trailing_sl_current_sl?: string | null;
  trailing_sl_highest_price?: string | null;
  trailing_sl_triggered_at?: string | null;
}

/**
 * The internal position (F&O) row as it appears in the positions table.
 */
export interface InternalPosition {
  id: string;
  strategy_id?: string;
  strategyId?: string;
  symbol?: string;
  segment?: string; // "Option" | "Future" | "Equity" | "Basket"
  call_put?: string | null;
  callPut?: string | null;
  buy_sell?: string;
  buySell?: string;
  expiry?: string | Date | null;
  strike_price?: string | number | null;
  strikePrice?: string | number | null;
  entry_price?: string | number | null;
  entryPrice?: string | number | null;
  lots?: number | null;
  target?: string | number | null;
  stop_loss?: string | number | null;
  stopLoss?: string | number | null;
  exit_price?: string | number | null;
  exitPrice?: string | number | null;
  exit_date?: string | Date | null;
  exitDate?: string | Date | null;
  rationale?: string | null;
  status?: string;
  is_published?: boolean;
  isPublished?: boolean;
  created_at?: string | Date | null;
  createdAt?: string | Date | null;
  duration?: number | null;
  duration_unit?: string | null;
  durationUnit?: string | null;
  theme?: string | null;
  gain_percent?: string | number | null;
  gainPercent?: string | number | null;
  // Trailing SL
  trailing_sl_enabled?: boolean;
  trailing_sl_type?: string | null;
  trailing_sl_value?: string | null;
  trailing_sl_current_sl?: string | null;
  trailing_sl_highest_price?: string | null;
  trailing_sl_triggered_at?: string | null;
}

/**
 * Strategy row (from strategies + joined advisor info).
 */
export interface InternalStrategy {
  id: string;
  advisor_id?: string;
  advisorId?: string;
  name: string;
  type: string; // Equity | Option | Future | Commodity | Basket
  description?: string | null;
  theme?: string[] | string | null;
  benchmark?: string | null;
  volatility?: string | null;
  horizon?: string | null;
  key_sectors?: string[] | null;
  management_style?: string | null;
}

/**
 * Advisor (user) info joined with strategy.
 */
export interface InternalAdvisor {
  id: string;
  username?: string | null;
  company_name?: string | null;
  companyName?: string | null;
  email?: string | null;
  sebi_reg_number?: string | null;
  sebiRegNumber?: string | null;
  logo_url?: string | null;
  sebi_cert_url?: string | null;
}

/**
 * Generic broker event — what flows into every adapter.
 */
export interface BrokerEvent {
  eventType: BrokerEventType;
  callType: "EQUITY_CALL" | "FNO_POSITION";
  call?: InternalCall;
  position?: InternalPosition;
  strategy: InternalStrategy;
  advisor: InternalAdvisor;
  advisorId: string;
}

/**
 * Validation failure — pre-flight check rejected the data before calling broker.
 * We record these so the log shows WHY we didn't send rather than sending garbage.
 */
export interface ValidationError {
  field: string;
  reason: string;
  value?: any;
}

export class ValidationFailure extends Error {
  public readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super(
      `Validation failed: ${errors.map(e => `${e.field}: ${e.reason}`).join("; ")}`
    );
    this.name = "ValidationFailure";
    this.errors = errors;
  }
}

/**
 * Adapter result for a single publish attempt.
 */
export type AdapterResult =
  | { status: "success"; response: any }
  | { status: "error"; response: any; errorMessage: string }
  | { status: "validation_failed"; errors: ValidationError[] }
  | { status: "skipped"; reason: string }
  | { status: "network_error"; errorMessage: string };

/**
 * Each broker implements this interface.
 */
export interface BrokerAdapter {
  readonly brokerType: string; // "XTS" | "UPSTOX" | "DREAMSTREET"
  publish(event: BrokerEvent): Promise<AdapterResult>;
}
