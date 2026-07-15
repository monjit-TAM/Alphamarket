/**
 * server/broker-integrations/core/basket-types.ts
 *
 * Canonical, broker-agnostic model for model-portfolio baskets
 * (smallcase-style: weighted equity allocations, versioned, rebalanced).
 *
 * This is DELIBERATELY SEPARATE from core/types.ts (BrokerEvent / BrokerAdapter),
 * which handles individual advisory calls + F&O positions. That path is live and
 * must not be disturbed. Nothing here imports from, or is imported by, that flow.
 *
 * NOT to be confused with:
 *   - advisor_basket_strategies  -> multi-leg ORDER baskets (F&O execution). Different product.
 *   - Intraday baskets           -> working, tested, live. Different product.
 *
 * Source of truth in DB:
 *   strategies (type='Basket')
 *     -> basket_rebalances    (version snapshots)
 *        -> basket_constituents (weighted legs per version)
 *
 * KEY DESIGN DECISION — weights are stored as INTEGER BASIS POINTS (weightBps).
 * 10000 bps = 100%. Each broker adapter converts to whatever it wants
 * (Upstox: fraction 0.0-1.0; others: percent, or absolute qty). Keeping the
 * canonical form as integers means the "weights must sum to exactly 1.0
 * (tolerance +/-0.0001)" class of bug is impossible by construction.
 */

// ─── Lifecycle ───────────────────────────────────────────────────

/**
 * Broker-agnostic lifecycle intent.
 *
 * NOTE on MODIFY: AlphaMarket's basket_rebalances bumps `version` on EVERY
 * constituent change, so there is no "correct in place without bumping" path.
 * We therefore never EMIT MODIFY. It stays in the type (and in
 * BasketCapabilities.supportsModify) so a future broker/product that needs
 * in-place rectification can use it without a type change.
 */
export type BasketLifecycle = "CREATE" | "MODIFY" | "REBALANCE" | "CLOSE";

/** What we think the broker currently believes about this basket. */
export type BasketSyncState = "never_sent" | "created" | "closed";

// ─── Canonical basket ────────────────────────────────────────────

export type BasketProduct = "EQUITY" | "FNO" | "MTF" | "MIS" | "COMMODITY";
export type BasketExchange = "NSE" | "BSE";
export type BasketSegment = "EQ" | "FO" | "CD" | "COM";
export type BasketDirection = "BUY" | "SELL";

export interface CanonicalBasketLeg {
  /** Resolved tradingsymbol as it exists in instrument_master (may carry a
   *  series suffix, e.g. "ABSMARINE-ST" for SME/ST-series scrips). */
  symbol: string;
  /** The raw symbol the advisor entered, pre-resolution. Kept for diagnostics. */
  rawSymbol: string;
  exchange: BasketExchange;
  segment: BasketSegment;
  /** Exchange token from instrument_master. Null => leg failed to resolve. */
  exchangeToken: number | null;
  direction: BasketDirection;
  /** Integer basis points. All legs in a basket must sum to exactly 10000. */
  weightBps: number;
  /** 1-based, stable, derived from constituent insertion order. */
  legId: number;
  quantity?: number | null;
  priceAtRebalance?: number | null;
}

export interface CanonicalBasketRA {
  /** SEBI registration number, e.g. "INA000021119". */
  regNumber: string | null;
  /** Legal / registered name of the RA entity. */
  legalName: string | null;
  /** Public-facing display name. */
  displayName: string | null;
}

export interface CanonicalBasket {
  /** strategies.id — stable, immutable, used as the vendor basket key. */
  basketId: string;
  /** basket_rebalances.id for the version being published. */
  rebalanceId: string;
  /** basket_rebalances.version. */
  version: number;

  advisorId: string;
  name: string;
  /** Short one-liner for listings. */
  description: string;
  /** Full investment thesis. */
  rationale: string;

  product: BasketProduct;
  horizon: string | null;
  riskProfile: string | null;
  rebalanceFrequency: string | null;
  /** Rupees. Must be present and numeric for most brokers. */
  minInvestment: number | null;

  ra: CanonicalBasketRA;
  tags: string[];

  legs: CanonicalBasketLeg[];

  lifecycle: BasketLifecycle;

  /** strategies.status — Draft | Published | Archived etc. */
  strategyStatus: string;
  effectiveDate: Date | null;
  rebalanceNotes: string | null;
}

// ─── Capabilities ────────────────────────────────────────────────

/**
 * What a given broker will accept. Eligibility is computed PER BROKER against
 * this, rather than with a hardcoded global gate — so the same basket can be
 * listable on one broker, executable on another, and rejected by a third
 * without any per-broker `if` statements leaking into shared code.
 */
export interface BasketCapabilities {
  broker: string;

  /** Allowed values for CanonicalBasket.product. */
  products: BasketProduct[];
  /** Allowed exchange+segment pairs, as "NSE:EQ" style keys. */
  segments: string[];

  /** Upstox: false — every leg must be BUY on basket creation. */
  allowsSellOnCreate: boolean;
  /** Whether SELL legs are permitted at all (on rebalance, say). */
  allowsSellOnRebalance: boolean;

  /** Whether the broker has an in-place MODIFY that does not bump version. */
  supportsModify: boolean;

  /** Weight sum tolerance, expressed in basis points. */
  weightToleranceBps: number;

  minLegs: number;
  maxLegs: number | null;

  requiresMinInvestment: boolean;
  requiresRationale: boolean;
  requiresRaDetails: boolean;

  /** Horizons this broker will NOT accept (Upstox baskets are held positions —
   *  an intraday basket would mean create+close every single day). */
  excludedHorizons: string[];

  /** Max chars for the rationale field before the broker rejects. null = no cap.
   *  (Dreamstreet 403s above ~2500 on the calls path — assume brokers have caps
   *  until proven otherwise.) */
  maxRationaleChars: number | null;
}

// ─── Validation ──────────────────────────────────────────────────

export interface BasketValidationError {
  field: string;
  reason: string;
  value?: any;
}

export type BasketEligibility =
  | { eligible: true; warnings: BasketValidationError[] }
  | { eligible: false; errors: BasketValidationError[]; warnings: BasketValidationError[] };

// ─── Adapter contract ────────────────────────────────────────────

/**
 * Terminal vs retryable is the single most important distinction here.
 *
 *   terminal  -> the request can NEVER succeed as-is. Do not retry. Ever.
 *                (Upstox 410: weight sum wrong, SELL leg on CREATE.)
 *                Retrying these just hammers the broker's gateway.
 *   conflict  -> broker state disagrees with ours. Reconcile, then re-dispatch.
 *                (Upstox 409: we said CREATE, they already have it.)
 *   retryable -> transient. Back off and try again. (5xx, network, timeout.)
 */
export type BasketDispatchOutcome =
  | { status: "success"; httpStatus: number; response: any; brokerVersion: number | null }
  | { status: "terminal"; httpStatus: number; response: any; errorMessage: string }
  | { status: "conflict"; httpStatus: number; response: any; errorMessage: string }
  | { status: "retryable"; httpStatus: number; response: any; errorMessage: string }
  | { status: "validation_failed"; errors: BasketValidationError[] }
  | { status: "skipped"; reason: string };

export interface BasketBrokerConnection {
  id: string;
  name: string;
  brokerType: string;
  baseUrl: string;
  /** Upstox: X-Vendor-Id (e.g. "ALPMKT"). */
  vendorCode: string;
  /** Upstox: the {vendorName} path segment (e.g. "alphamarket"). */
  vendorKey: string;
  /** Bearer token. Null => adapter refuses to dispatch. */
  token: string | null;
  isEnabled: boolean;
}

export interface BasketAdapter {
  readonly brokerType: string;
  readonly capabilities: BasketCapabilities;

  /**
   * Build the wire payload without sending. Pure. Used by the admin
   * "preview payload" endpoint so a human can eyeball exactly what will go out
   * before anything hits the broker.
   */
  buildPayload(basket: CanonicalBasket, conn: BasketBrokerConnection): any;

  dispatch(
    basket: CanonicalBasket,
    conn: BasketBrokerConnection,
    xRequestId: string
  ): Promise<BasketDispatchOutcome>;
}

// ─── Helpers ─────────────────────────────────────────────────────

export const BPS_TOTAL = 10_000;

/** Percent (e.g. 2, 25.5) -> basis points. Rounds to nearest bp. */
export function percentToBps(pct: number | string): number {
  return Math.round(Number(pct) * 100);
}

/** Basis points -> fraction (Upstox wants 0.02 for 2%). */
export function bpsToFraction(bps: number, dp = 4): number {
  return Number((bps / BPS_TOTAL).toFixed(dp));
}

/** Basis points -> percent. */
export function bpsToPercent(bps: number, dp = 2): number {
  return Number((bps / 100).toFixed(dp));
}

export function sumBps(legs: Array<{ weightBps: number }>): number {
  return legs.reduce((a, l) => a + l.weightBps, 0);
}

/**
 * Convert legs to fractions that sum to EXACTLY 1.0 in IEEE-754 terms.
 *
 * Naive per-leg division can drift: 33 legs each .toFixed(4) can sum to
 * 0.99999999999 or 1.00000000001, and Upstox's +/-0.0001 check is applied to
 * whatever we send. We fix this by giving the LAST leg the remainder, so the
 * emitted numbers always sum to 1.0 exactly regardless of leg count.
 */
export function legsToFractions(legs: Array<{ weightBps: number }>, dp = 4): number[] {
  if (legs.length === 0) return [];
  const out = legs.map(l => bpsToFraction(l.weightBps, dp));
  const sum = out.reduce((a, b) => a + b, 0);
  const drift = Number((1 - sum).toFixed(dp + 2));
  if (drift !== 0) {
    const lastIdx = out.length - 1;
    out[lastIdx] = Number((out[lastIdx] + drift).toFixed(dp + 2));
  }
  return out;
}
