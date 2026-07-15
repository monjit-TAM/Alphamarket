/**
 * server/broker-integrations/core/basket-validation.ts
 *
 * Per-broker eligibility gates for model-portfolio baskets.
 *
 * Philosophy: FAIL LOUDLY AND EARLY, IN OUR OWN CODE.
 *
 * A basket that would be rejected by the broker with an opaque 410 should never
 * leave this process. On a 33-leg payload, a broker-side "Order weights must sum
 * to 1.0" tells you nothing about WHICH leg is wrong. Our errors name the leg,
 * the field, and the value.
 *
 * Nothing here is Upstox-specific. Everything is driven by BasketCapabilities,
 * so adding a second broker means adding a capabilities object, not editing
 * this file.
 */

import {
  BPS_TOTAL,
  sumBps,
  type BasketCapabilities,
  type BasketEligibility,
  type BasketValidationError,
  type CanonicalBasket,
} from "./basket-types";

export function validateBasketForBroker(
  basket: CanonicalBasket,
  caps: BasketCapabilities
): BasketEligibility {
  const errors: BasketValidationError[] = [];
  const warnings: BasketValidationError[] = [];

  // ─── Product ───────────────────────────────────────────────────
  if (!caps.products.includes(basket.product)) {
    errors.push({
      field: "product",
      reason: `${caps.broker} does not accept product "${basket.product}". Accepts: ${caps.products.join(", ")}`,
      value: basket.product,
    });
  }

  // ─── Horizon ───────────────────────────────────────────────────
  // Upstox baskets are HELD model portfolios. An intraday basket would mean
  // creating and closing a basket on their platform every single day.
  if (basket.horizon && caps.excludedHorizons.some(h => h.toLowerCase() === basket.horizon!.toLowerCase())) {
    errors.push({
      field: "horizon",
      reason: `${caps.broker} does not accept horizon "${basket.horizon}" for model-portfolio baskets. Excluded: ${caps.excludedHorizons.join(", ")}`,
      value: basket.horizon,
    });
  }

  // ─── Legs present ──────────────────────────────────────────────
  if (basket.legs.length < caps.minLegs) {
    errors.push({
      field: "orders",
      reason: `Needs at least ${caps.minLegs} leg(s), got ${basket.legs.length}`,
      value: basket.legs.length,
    });
  }
  if (caps.maxLegs != null && basket.legs.length > caps.maxLegs) {
    errors.push({
      field: "orders",
      reason: `${caps.broker} accepts at most ${caps.maxLegs} legs, got ${basket.legs.length}`,
      value: basket.legs.length,
    });
  }

  // ─── Weight sum ────────────────────────────────────────────────
  // Canonical form is integer bps, so this is an exact integer comparison.
  // If this passes, the fraction conversion in legsToFractions() cannot drift.
  const total = sumBps(basket.legs);
  if (Math.abs(total - BPS_TOTAL) > caps.weightToleranceBps) {
    errors.push({
      field: "orders[].weight",
      reason: `Weights must sum to 100% (${BPS_TOTAL} bps), got ${total} bps (${(total / 100).toFixed(2)}%)`,
      value: total,
    });
  }

  // ─── Per-leg checks ────────────────────────────────────────────
  const allowedSegments = new Set(caps.segments);
  const seenLegIds = new Set<number>();

  for (const leg of basket.legs) {
    const where = `orders[${leg.legId}] (${leg.rawSymbol})`;

    // Instrument resolution. A single null token kills the whole basket at the
    // broker, so we surface it by name.
    if (leg.exchangeToken == null) {
      errors.push({
        field: `${where}.exchangeToken`,
        reason: `Symbol "${leg.rawSymbol}" could not be resolved in instrument_master. Check for a series suffix (e.g. -ST for SME scrips), a rename, or a stale instrument master.`,
        value: null,
      });
    }

    // Segment
    const segKey = `${leg.exchange}:${leg.segment}`;
    if (!allowedSegments.has(segKey)) {
      errors.push({
        field: `${where}.segment`,
        reason: `${caps.broker} cannot resolve "${segKey}". Accepts: ${caps.segments.join(", ")}`,
        value: segKey,
      });
    }

    // Direction
    if (leg.direction !== "BUY" && leg.direction !== "SELL") {
      errors.push({
        field: `${where}.direction`,
        reason: `Direction must be BUY or SELL, got "${leg.direction}"`,
        value: leg.direction,
      });
    }
    if (leg.direction === "SELL") {
      const creating = basket.lifecycle === "CREATE";
      if (creating && !caps.allowsSellOnCreate) {
        errors.push({
          field: `${where}.direction`,
          reason: `${caps.broker} permits only BUY legs on basket creation. This basket has a SELL leg and cannot be created.`,
          value: "SELL",
        });
      } else if (!creating && !caps.allowsSellOnRebalance) {
        errors.push({
          field: `${where}.direction`,
          reason: `${caps.broker} does not permit SELL legs.`,
          value: "SELL",
        });
      }
    }

    // Weight sanity
    if (!Number.isInteger(leg.weightBps) || leg.weightBps <= 0) {
      errors.push({
        field: `${where}.weight`,
        reason: `Weight must be a positive value, got ${leg.weightBps} bps`,
        value: leg.weightBps,
      });
    }

    // legId uniqueness
    if (seenLegIds.has(leg.legId)) {
      errors.push({
        field: `${where}.legId`,
        reason: `Duplicate legId ${leg.legId}`,
        value: leg.legId,
      });
    }
    seenLegIds.add(leg.legId);

    // Series-suffix warning. We resolved it, but whether the broker's own
    // instrument universe carries SME/ST-series scrips is a separate question
    // and must be confirmed with them.
    if (leg.symbol !== leg.rawSymbol) {
      warnings.push({
        field: `${where}.symbol`,
        reason: `Resolved "${leg.rawSymbol}" -> "${leg.symbol}" via series-suffix fallback. Confirm ${caps.broker} supports this series.`,
        value: leg.symbol,
      });
    }
  }

  // ─── minInvestment ─────────────────────────────────────────────
  // Upstox: a non-numeric or missing minInvestment on CREATED returns HTTP 500,
  // not a clean 4xx. A 500 looks transient to a retry worker, which would then
  // retry forever against a payload that can never succeed. Hard gate.
  if (caps.requiresMinInvestment) {
    const mi = basket.minInvestment;
    if (mi == null || !Number.isFinite(Number(mi)) || Number(mi) <= 0) {
      errors.push({
        field: "minInvestment",
        reason: `${caps.broker} requires a positive numeric minimum investment. A missing/non-numeric value causes an opaque HTTP 500.`,
        value: mi,
      });
    }
  }

  // ─── rationale ─────────────────────────────────────────────────
  if (caps.requiresRationale && !basket.rationale?.trim()) {
    errors.push({
      field: "rationale",
      reason: `${caps.broker} requires a rationale. Falls back to strategies.description — populate one of them.`,
      value: null,
    });
  }
  if (
    caps.maxRationaleChars != null &&
    basket.rationale != null &&
    basket.rationale.length > caps.maxRationaleChars
  ) {
    warnings.push({
      field: "rationale",
      reason: `Rationale is ${basket.rationale.length} chars; ${caps.broker} cap is ${caps.maxRationaleChars}. It will be truncated on send.`,
      value: basket.rationale.length,
    });
  }

  // ─── raDetails ─────────────────────────────────────────────────
  if (caps.requiresRaDetails) {
    if (!basket.ra.regNumber?.trim()) {
      errors.push({
        field: "raDetails.raId",
        reason: `${caps.broker} requires the RA's SEBI registration number (users.sebi_reg_number).`,
        value: null,
      });
    }
    if (!basket.ra.legalName?.trim()) {
      errors.push({
        field: "raDetails.raName",
        reason: `${caps.broker} requires the RA's legal/registered name (users.company_name).`,
        value: null,
      });
    }
    if (!basket.ra.displayName?.trim()) {
      errors.push({
        field: "raDetails.displayName",
        reason: `${caps.broker} requires a public display name.`,
        value: null,
      });
    }
  }

  // ─── description ───────────────────────────────────────────────
  if (!basket.description?.trim()) {
    warnings.push({
      field: "description",
      reason: "No one-line description; falling back to basket name.",
      value: null,
    });
  }

  // ─── Advisor-content sanity (warnings only) ────────────────────
  // Not a technical failure, but this text is shown to end investors on the
  // broker's platform, so a mismatch is worth surfacing to the advisor.
  const claimed = basket.rationale?.match(/~?\s*(\d{1,3})\s*stocks?/i);
  if (claimed) {
    const n = Number(claimed[1]);
    if (Math.abs(n - basket.legs.length) > Math.max(3, n * 0.15)) {
      warnings.push({
        field: "rationale",
        reason: `Rationale mentions ~${n} stocks but the basket has ${basket.legs.length}. Investors will see this text.`,
        value: n,
      });
    }
  }

  if (basket.strategyStatus && basket.strategyStatus.toLowerCase() !== "published") {
    warnings.push({
      field: "strategyStatus",
      reason: `Strategy status is "${basket.strategyStatus}", not Published.`,
      value: basket.strategyStatus,
    });
  }

  return errors.length > 0
    ? { eligible: false, errors, warnings }
    : { eligible: true, warnings };
}
