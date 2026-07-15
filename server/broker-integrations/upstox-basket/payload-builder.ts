/**
 * server/broker-integrations/upstox-basket/payload-builder.ts
 *
 * CanonicalBasket -> Upstox wire JSON. Pure. No I/O, no DB, no side effects.
 *
 * Purity matters: the admin "preview payload" endpoint calls this to show a
 * human EXACTLY what will go on the wire before anything is dispatched. If this
 * function had side effects, preview would not be safe.
 */

import {
  legsToFractions,
  type CanonicalBasket,
} from "../core/basket-types";

import {
  UPSTOX_BASKET_LIMITS,
  UPSTOX_BASKET_STATUS,
  UPSTOX_DIRECTION,
  UPSTOX_PRODUCT,
  UPSTOX_SEGMENT,
  formatUpstoxDate,
  truncateText,
  type UpstoxBasketStatus,
} from "./spec";

export interface UpstoxBasketOrder {
  symbol: string;
  legId: number;
  exchangeToken: number;
  segment: string;
  direction: string;
  weight: number;
}

export interface UpstoxBasketPayload {
  id: string;
  basketStatus: UpstoxBasketStatus;
  name?: string;
  direction?: string;
  product?: string;
  modelName?: string;
  tags?: string[];
  generationTime?: string;
  nextRebalanceDate?: string;
  lastRebalanceTime?: string;
  rationale?: string;
  raDetails?: { raId: string; raName: string; displayName: string };
  description?: string;
  riskProfile?: string;
  rebalanceFrequency?: string;
  minInvestment?: string;
  returns?: Record<string, string>;
  orders: UpstoxBasketOrder[];
}

/**
 * Map our lifecycle to Upstox's basketStatus.
 *
 * We NEVER emit MODIFIED. AlphaMarket's basket_rebalances bumps `version` on
 * every constituent change, so there is no "rectify in place without bumping"
 * concept to map to. Every change is a REBALANCED. This keeps the version
 * history on Upstox honest — subscribers see a real diff for every change,
 * and we never silently mutate an allocation they already bought into.
 */
function toBasketStatus(basket: CanonicalBasket): UpstoxBasketStatus {
  switch (basket.lifecycle) {
    case "CREATE":
      return UPSTOX_BASKET_STATUS.CREATED;
    case "REBALANCE":
      return UPSTOX_BASKET_STATUS.REBALANCED;
    case "CLOSE":
      return UPSTOX_BASKET_STATUS.CLOSED;
    case "MODIFY":
      // Defensive. The dispatcher never produces this. If it somehow does,
      // a REBALANCED is the safe interpretation (bumps version, appends an
      // immutable snapshot) rather than silently overwriting a live version.
      return UPSTOX_BASKET_STATUS.REBALANCED;
  }
}

function toOverallDirection(basket: CanonicalBasket): string {
  const hasBuy = basket.legs.some(l => l.direction === "BUY");
  const hasSell = basket.legs.some(l => l.direction === "SELL");
  if (hasBuy && hasSell) return UPSTOX_DIRECTION.BOTH;
  if (hasSell) return UPSTOX_DIRECTION.SELL;
  return UPSTOX_DIRECTION.BUY;
}

/**
 * Build the orders array.
 *
 * Weights: canonical form is integer basis points. legsToFractions() converts
 * to fractions and pushes any rounding drift into the final leg, so the emitted
 * numbers sum to exactly 1.0 no matter how many legs there are. Upstox rejects
 * anything outside 1.0 +/- 0.0001 with an opaque HTTP 410, and on a 33-leg
 * basket that error names no leg — so we make the failure impossible rather
 * than debuggable.
 */
function buildOrders(basket: CanonicalBasket): UpstoxBasketOrder[] {
  const fractions = legsToFractions(basket.legs, 4);

  return basket.legs.map((leg, i) => {
    if (leg.exchangeToken == null) {
      // Should be unreachable — validation gates this before dispatch.
      // Throwing beats emitting a null token and getting an unattributable
      // broker-side failure on a large payload.
      throw new Error(
        `Cannot build Upstox payload: leg ${leg.legId} (${leg.rawSymbol}) has no exchangeToken. Validation should have caught this.`
      );
    }
    return {
      symbol: leg.symbol,
      legId: leg.legId,
      exchangeToken: leg.exchangeToken,
      segment: UPSTOX_SEGMENT.NSE_EQ,
      direction: leg.direction,
      weight: fractions[i],
    };
  });
}

export function buildUpstoxBasketPayload(basket: CanonicalBasket): UpstoxBasketPayload {
  const basketStatus = toBasketStatus(basket);

  // CLOSED takes only id + basketStatus + empty orders. Sending a full body
  // is pointless and only widens the surface for a validation rejection.
  if (basketStatus === UPSTOX_BASKET_STATUS.CLOSED) {
    return {
      id: basket.basketId,
      basketStatus: UPSTOX_BASKET_STATUS.CLOSED,
      orders: [],
    };
  }

  const payload: UpstoxBasketPayload = {
    id: basket.basketId,
    basketStatus,
    name: basket.name,
    direction: toOverallDirection(basket),
    product: UPSTOX_PRODUCT.EQUITY,
    rationale: truncateText(
      (basket.rationale || "").trim(),
      UPSTOX_BASKET_LIMITS.maxRationaleChars
    ),
    description: truncateText(
      (basket.description || basket.name).trim(),
      UPSTOX_BASKET_LIMITS.maxDescriptionChars
    ),
    orders: buildOrders(basket),
  };

  // raDetails is required on CREATED. We send it on REBALANCED too — harmless,
  // and it keeps the RA attribution current if the advisor's registration
  // details change between versions.
  if (basket.ra.regNumber && basket.ra.legalName) {
    payload.raDetails = {
      raId: basket.ra.regNumber,
      raName: basket.ra.legalName,
      displayName: basket.ra.displayName || basket.ra.legalName,
    };
  }

  // minInvestment MUST be a numeric string. Spec: a non-numeric or missing
  // value on CREATED returns HTTP 500 rather than a clean validation error —
  // which a naive retry worker would read as transient and retry forever.
  if (basket.minInvestment != null && Number.isFinite(Number(basket.minInvestment))) {
    payload.minInvestment = String(Math.round(Number(basket.minInvestment)));
  }

  if (basket.riskProfile) payload.riskProfile = basket.riskProfile;
  if (basket.rebalanceFrequency) payload.rebalanceFrequency = basket.rebalanceFrequency;
  if (basket.tags.length > 0) payload.tags = basket.tags;

  if (basket.effectiveDate) {
    payload.generationTime = formatUpstoxDate(new Date(basket.effectiveDate));
    if (basketStatus === UPSTOX_BASKET_STATUS.REBALANCED) {
      payload.lastRebalanceTime = formatUpstoxDate(new Date(basket.effectiveDate));
    }
  }

  // `returns` is deliberately omitted.
  //
  // It is optional in the spec, and basket_nav_snapshots currently holds ~2
  // rows across all baskets — there is no real return history to publish.
  // Emitting a naive backward-applied return (today's allocation projected onto
  // past prices) would be a misrepresentation shown to retail investors, with
  // SEBI implications, not merely an engineering shortcut. Omit until a proper
  // point-in-time backtest exists that replays actual historical allocations.

  return payload;
}
