/**
 * server/broker-integrations/upstox-basket/adapter.ts
 *
 * The Upstox basket adapter. Declares what Upstox will accept, builds the
 * payload, and dispatches over HTTP.
 *
 * Reuses core/http.ts unchanged. Writes nothing to broker_webhook_logs,
 * xts_publish_log, positions, or calls. The live recommendation webhook path
 * cannot be affected by anything in this file.
 */

import { httpRequest } from "../core/http";

import type {
  BasketAdapter,
  BasketBrokerConnection,
  BasketCapabilities,
  BasketDispatchOutcome,
  CanonicalBasket,
} from "../core/basket-types";

import {
  UPSTOX_BASKET_LIMITS,
  UPSTOX_BASKET_TIMEOUTS,
  basketEndpoint,
  classifyHttpStatus,
} from "./spec";

import { buildUpstoxBasketPayload } from "./payload-builder";

/**
 * What Upstox's basket API will actually accept.
 *
 * Note the gap between what the docs SEEM to allow and what actually resolves:
 * the `product` enum lists FNO/MTF/MIS/COMMODITY, but the spec states plainly
 * that only NSE_EQ resolves server-side for segment. So F&O baskets are
 * impossible regardless of the product value. We encode the real constraint,
 * not the advertised one.
 */
export const UPSTOX_BASKET_CAPABILITIES: BasketCapabilities = {
  broker: "Upstox",

  products: ["EQUITY"],
  segments: ["NSE:EQ"],

  // Spec Validation 2: "For basketStatus = CREATED, every order must have
  // direction = BUY. SELL orders are not permitted at basket creation time."
  // -> HTTP 410.
  allowsSellOnCreate: false,
  // Not documented as forbidden on REBALANCED — a rebalance replacing one
  // holding with another is the whole point. Allowed, but flagged.
  allowsSellOnRebalance: true,

  // Upstox HAS a MODIFIED status. We simply never emit it (see
  // payload-builder.ts). Declared here so a future product that needs in-place
  // rectification can discover the capability.
  supportsModify: true,

  weightToleranceBps: UPSTOX_BASKET_LIMITS.weightToleranceBps,

  minLegs: UPSTOX_BASKET_LIMITS.minLegs,
  maxLegs: UPSTOX_BASKET_LIMITS.maxLegs,

  requiresMinInvestment: true,
  requiresRationale: true,
  requiresRaDetails: true,

  // Upstox baskets are HELD model portfolios that end users subscribe to and
  // buy. An intraday basket would mean creating and closing a basket on their
  // platform every single day — polluting their catalogue and confusing
  // subscribers. AlphaMarket's intraday and multi-leg baskets are a different,
  // already-working product and do not belong on this API.
  excludedHorizons: ["Intraday"],

  maxRationaleChars: UPSTOX_BASKET_LIMITS.maxRationaleChars,
};

export class UpstoxBasketAdapter implements BasketAdapter {
  readonly brokerType = "UPSTOX_BASKET";
  readonly capabilities = UPSTOX_BASKET_CAPABILITIES;

  buildPayload(basket: CanonicalBasket, _conn: BasketBrokerConnection): any {
    return buildUpstoxBasketPayload(basket);
  }

  async dispatch(
    basket: CanonicalBasket,
    conn: BasketBrokerConnection,
    xRequestId: string
  ): Promise<BasketDispatchOutcome> {
    // Refuse to dispatch without a Bearer token rather than firing an
    // unauthenticated request and logging a confusing 401.
    if (!conn.token) {
      return {
        status: "skipped",
        reason:
          "No Bearer token configured for the Upstox basket connection. Upstox issues this during vendor onboarding; it is NOT the same credential as the recommendation webhook (which is inbound — they authenticate to us). Set broker_connections.token.",
      };
    }
    if (!conn.vendorCode) {
      return { status: "skipped", reason: "No X-Vendor-Id (broker_connections.vendor_code) configured." };
    }
    if (!conn.vendorKey) {
      return { status: "skipped", reason: "No {vendorName} URL segment (broker_connections.vendor_key) configured." };
    }

    let payload: any;
    try {
      payload = buildUpstoxBasketPayload(basket);
    } catch (err: any) {
      return {
        status: "validation_failed",
        errors: [{ field: "payload", reason: err?.message ?? String(err) }],
      };
    }

    const url = `${conn.baseUrl.replace(/\/+$/, "")}${basketEndpoint(conn.vendorKey)}`;

    const res = await httpRequest({
      url,
      method: "POST",
      headers: {
        Authorization: `Bearer ${conn.token}`,
        "X-Vendor-Id": conn.vendorCode,
        // Upstox support will ask for this and accept nothing else as a handle
        // on a failed request. One per attempt, logged.
        "X-Request-Id": xRequestId,
        "Content-Type": "application/json",
      },
      body: payload,
      timeoutMs: UPSTOX_BASKET_TIMEOUTS.publishMs,
    });

    // Network-level failure — never reached their server. Always retryable.
    if (res.status === 0) {
      return {
        status: "retryable",
        httpStatus: 0,
        response: null,
        errorMessage: res.networkError ?? "Network error",
      };
    }

    const cls = classifyHttpStatus(res.status);
    const body = res.body ?? res.rawText ?? null;

    if (cls === "success") {
      const brokerVersion =
        body && typeof body === "object" && body.data && body.data.version != null
          ? Number(body.data.version)
          : null;
      return { status: "success", httpStatus: res.status, response: body, brokerVersion };
    }

    const errMsg =
      (body && typeof body === "object" && (body.error?.message || body.message)) ||
      (typeof body === "string" ? body.slice(0, 500) : null) ||
      `HTTP ${res.status}`;

    if (cls === "terminal") {
      // 410 = weight sum wrong, or SELL leg on CREATE. 400 = bad basketStatus.
      // These CANNOT succeed on retry. Marking them retryable would mean an
      // exponential-backoff worker hammering Upstox's gateway indefinitely with
      // a payload that is definitionally invalid.
      return { status: "terminal", httpStatus: res.status, response: body, errorMessage: errMsg };
    }

    if (cls === "conflict") {
      // 409: they already have this basket, we thought it was new.
      // 404: they do not have it, we thought they did.
      // Either way our sync_state is wrong. The dispatcher reconciles and
      // re-dispatches under the correct basketStatus — it does not blind-retry.
      return { status: "conflict", httpStatus: res.status, response: body, errorMessage: errMsg };
    }

    return { status: "retryable", httpStatus: res.status, response: body, errorMessage: errMsg };
  }
}

export const upstoxBasketAdapter = new UpstoxBasketAdapter();
