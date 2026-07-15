/**
 * server/basket-dispatcher.ts
 *
 * Broker-agnostic dispatcher for model-portfolio baskets.
 *
 * ─────────────────────────────────────────────────────────────────
 * ISOLATION CONTRACT
 * ─────────────────────────────────────────────────────────────────
 * This is a SEPARATE dispatcher. It shares nothing with the live
 * recommendation webhook path:
 *
 *   NOT used : webhook-dispatcher.ts, scheduler.ts, xts-bridge.ts,
 *              broker-api.ts, broker-api-v2.ts
 *   NOT written : broker_webhook_logs, xts_publish_log, positions, calls
 *   NOT shared  : the HMAC signing (X-AlphaMarket-Signature), the payload
 *                 shape, the retry worker, the event types
 *
 * The only things reused are pure, stateless helpers: core/http.ts.
 *
 * The live Upstox/Dreamstreet call path is at 100% success on ~25-50 calls/day.
 * Nothing in this file can change its behaviour.
 * ─────────────────────────────────────────────────────────────────
 *
 * STATE MACHINE
 *
 *   sync_state=never_sent                          -> CREATE
 *   sync_state=created,  our version > last_synced -> REBALANCE
 *   sync_state=created,  our version = last_synced -> no-op (already in sync)
 *   strategy archived/closed                       -> CLOSE
 *   sync_state=closed                              -> no-op
 *
 * We never emit MODIFY. basket_rebalances bumps `version` on every change, so
 * every change is a REBALANCE. Subscribers on the broker always see an honest
 * version diff; we never silently mutate an allocation someone already bought.
 *
 * CONFLICT RECONCILIATION (this is what stops 409 loops)
 *
 *   409 on CREATE  -> broker already has it. Our state was stale. Set
 *                     sync_state='created' and re-dispatch ONCE as REBALANCE.
 *   404 on REBALANCE/CLOSE -> broker does not have it. Our state was ahead.
 *                     Set sync_state='never_sent' and re-dispatch ONCE as CREATE.
 *
 * Exactly one reconciliation hop. No loops.
 */

import { randomUUID } from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";

import {
  loadCanonicalBasket,
  BasketNotFound,
} from "./broker-integrations/core/basket-loader";

import { validateBasketForBroker } from "./broker-integrations/core/basket-validation";

import type {
  BasketAdapter,
  BasketBrokerConnection,
  BasketDispatchOutcome,
  BasketLifecycle,
  BasketSyncState,
  BasketValidationError,
  CanonicalBasket,
} from "./broker-integrations/core/basket-types";

import { upstoxBasketAdapter } from "./broker-integrations/upstox-basket/adapter";

// ─── Adapter registry ────────────────────────────────────────────
// Adding a broker = adding an entry here + a capabilities object.
// No changes to this file's logic.

const ADAPTERS = new Map<string, BasketAdapter>([
  [upstoxBasketAdapter.brokerType, upstoxBasketAdapter],
]);

export function getBasketAdapter(brokerType: string): BasketAdapter | null {
  return ADAPTERS.get(brokerType) ?? null;
}

export function listBasketAdapters(): BasketAdapter[] {
  return Array.from(ADAPTERS.values());
}

// ─── DB access ───────────────────────────────────────────────────

export async function getBasketConnection(
  brokerType: string
): Promise<BasketBrokerConnection | null> {
  const res = await db.execute(sql`
    SELECT id, name, broker_type, base_url, vendor_code, vendor_key, token, is_enabled
    FROM broker_connections
    WHERE broker_type = ${brokerType}
    ORDER BY is_enabled DESC, created_at DESC
    LIMIT 1
  `);
  const r = res.rows[0] as any;
  if (!r) return null;
  return {
    id: String(r.id),
    name: String(r.name),
    brokerType: String(r.broker_type),
    baseUrl: String(r.base_url),
    vendorCode: String(r.vendor_code ?? ""),
    vendorKey: String(r.vendor_key ?? ""),
    token: r.token ?? null,
    isEnabled: Boolean(r.is_enabled),
  };
}

export interface BasketState {
  strategyId: string;
  brokerType: string;
  syncState: BasketSyncState;
  brokerVersion: number | null;
  lastRebalanceId: string | null;
  lastSyncedVersion: number | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  isEnabled: boolean;
}

export async function getBasketState(
  strategyId: string,
  brokerType: string
): Promise<BasketState | null> {
  const res = await db.execute(sql`
    SELECT strategy_id, broker_type, sync_state, broker_version,
           last_rebalance_id, last_synced_version, last_synced_at,
           last_error, is_enabled
    FROM broker_basket_state
    WHERE strategy_id = ${strategyId} AND broker_type = ${brokerType}
    LIMIT 1
  `);
  const r = res.rows[0] as any;
  if (!r) return null;
  return {
    strategyId: String(r.strategy_id),
    brokerType: String(r.broker_type),
    syncState: String(r.sync_state) as BasketSyncState,
    brokerVersion: r.broker_version != null ? Number(r.broker_version) : null,
    lastRebalanceId: r.last_rebalance_id ?? null,
    lastSyncedVersion: r.last_synced_version != null ? Number(r.last_synced_version) : null,
    lastSyncedAt: r.last_synced_at ?? null,
    lastError: r.last_error ?? null,
    isEnabled: Boolean(r.is_enabled),
  };
}

export async function ensureBasketState(
  strategyId: string,
  brokerType: string,
  connectionId: string | null
): Promise<BasketState> {
  await db.execute(sql`
    INSERT INTO broker_basket_state (strategy_id, broker_type, broker_connection_id)
    VALUES (${strategyId}, ${brokerType}, ${connectionId})
    ON CONFLICT (strategy_id, broker_type) DO NOTHING
  `);
  const s = await getBasketState(strategyId, brokerType);
  if (!s) throw new Error(`Failed to create basket state for ${strategyId}/${brokerType}`);
  return s;
}

export async function setBasketEnabled(
  strategyId: string,
  brokerType: string,
  enabled: boolean,
  connectionId: string | null
): Promise<void> {
  await ensureBasketState(strategyId, brokerType, connectionId);
  await db.execute(sql`
    UPDATE broker_basket_state
    SET is_enabled = ${enabled}, updated_at = now()
    WHERE strategy_id = ${strategyId} AND broker_type = ${brokerType}
  `);
}

async function updateStateAfterSuccess(
  strategyId: string,
  brokerType: string,
  lifecycle: BasketLifecycle,
  rebalanceId: string,
  ourVersion: number,
  brokerVersion: number | null
): Promise<void> {
  const newSync: BasketSyncState = lifecycle === "CLOSE" ? "closed" : "created";
  await db.execute(sql`
    UPDATE broker_basket_state
    SET sync_state          = ${newSync},
        broker_version      = ${brokerVersion},
        last_rebalance_id   = ${rebalanceId},
        last_synced_version = ${ourVersion},
        last_synced_at      = now(),
        last_attempt_at     = now(),
        last_error          = NULL,
        updated_at          = now()
    WHERE strategy_id = ${strategyId} AND broker_type = ${brokerType}
  `);
}

async function updateStateAfterFailure(
  strategyId: string,
  brokerType: string,
  errorMessage: string
): Promise<void> {
  await db.execute(sql`
    UPDATE broker_basket_state
    SET last_error = ${errorMessage.slice(0, 2000)},
        last_attempt_at = now(),
        updated_at = now()
    WHERE strategy_id = ${strategyId} AND broker_type = ${brokerType}
  `);
}

async function forceSyncState(
  strategyId: string,
  brokerType: string,
  syncState: BasketSyncState
): Promise<void> {
  await db.execute(sql`
    UPDATE broker_basket_state
    SET sync_state = ${syncState}, updated_at = now()
    WHERE strategy_id = ${strategyId} AND broker_type = ${brokerType}
  `);
}

// ─── Audit log ───────────────────────────────────────────────────

interface LogArgs {
  basket: CanonicalBasket;
  brokerType: string;
  connectionId: string | null;
  basketStatus: string;
  xRequestId: string;
  payload: any;
  outcome: BasketDispatchOutcome;
  triggeredBy: string;
  triggeredByUserId: string | null;
}

/** Every attempt produces exactly one row. Never silently drops a record. */
async function logAttempt(a: LogArgs): Promise<void> {
  const o = a.outcome;

  let status: string;
  let httpStatus: number | null = null;
  let response: any = null;
  let errorMessage: string | null = null;

  switch (o.status) {
    case "success":
      status = "success";
      httpStatus = o.httpStatus;
      response = o.response;
      break;
    case "terminal":
      status = "terminal";
      httpStatus = o.httpStatus;
      response = o.response;
      errorMessage = o.errorMessage;
      break;
    case "conflict":
      status = "conflict";
      httpStatus = o.httpStatus;
      response = o.response;
      errorMessage = o.errorMessage;
      break;
    case "retryable":
      status = "retryable";
      httpStatus = o.httpStatus;
      response = o.response;
      errorMessage = o.errorMessage;
      break;
    case "validation_failed":
      status = "validation_failed";
      errorMessage = o.errors.map(e => `${e.field}: ${e.reason}`).join("; ");
      break;
    case "skipped":
      status = "skipped";
      errorMessage = o.reason;
      break;
  }

  try {
    await db.execute(sql`
      INSERT INTO broker_basket_publish_log (
        strategy_id, advisor_id, rebalance_id, broker_connection_id,
        broker_type, basket_status, version, x_request_id,
        payload, response, http_status, status, error_message,
        triggered_by, triggered_by_user_id
      ) VALUES (
        ${a.basket.basketId}, ${a.basket.advisorId}, ${a.basket.rebalanceId}, ${a.connectionId},
        ${a.brokerType}, ${a.basketStatus}, ${a.basket.version}, ${a.xRequestId},
        ${JSON.stringify(a.payload ?? {})}::jsonb,
        ${JSON.stringify(response ?? {})}::jsonb,
        ${httpStatus}, ${status}, ${errorMessage},
        ${a.triggeredBy}, ${a.triggeredByUserId}
      )
    `);
  } catch (err) {
    // Logging must never break dispatch, but a silent audit gap is worse than
    // noise. Surface it.
    console.error("[basket-dispatcher] FAILED TO WRITE AUDIT LOG", err);
  }
}

// ─── Lifecycle decision ──────────────────────────────────────────

export type LifecycleDecision =
  | { action: BasketLifecycle; reason: string }
  | { action: "NOOP"; reason: string };

export function decideLifecycle(
  state: BasketState | null,
  latestVersion: number,
  latestRebalanceId: string,
  strategyStatus: string
): LifecycleDecision {
  const archived = ["archived", "closed", "inactive", "deleted"].includes(
    (strategyStatus || "").toLowerCase()
  );

  if (!state || state.syncState === "never_sent") {
    if (archived) {
      return { action: "NOOP", reason: "Strategy is archived and was never published to this broker." };
    }
    return { action: "CREATE", reason: "Never published to this broker." };
  }

  if (state.syncState === "closed") {
    return { action: "NOOP", reason: "Already closed on this broker." };
  }

  // sync_state === 'created'
  if (archived) {
    return { action: "CLOSE", reason: `Strategy status is "${strategyStatus}".` };
  }

  if (state.lastSyncedVersion == null || latestVersion > state.lastSyncedVersion) {
    return {
      action: "REBALANCE",
      reason: `Our version ${latestVersion} > last synced ${state.lastSyncedVersion ?? "none"}.`,
    };
  }

  if (state.lastRebalanceId !== latestRebalanceId) {
    return {
      action: "REBALANCE",
      reason: "Latest rebalance snapshot differs from the one last synced.",
    };
  }

  return { action: "NOOP", reason: `Already in sync at version ${latestVersion}.` };
}

// ─── Preview (no network) ────────────────────────────────────────

export interface BasketPreview {
  strategyId: string;
  brokerType: string;
  connectionConfigured: boolean;
  tokenConfigured: boolean;
  isEnabled: boolean;
  syncState: BasketSyncState;
  ourVersion: number;
  lastSyncedVersion: number | null;
  decision: LifecycleDecision;
  eligible: boolean;
  errors: BasketValidationError[];
  warnings: BasketValidationError[];
  payload: any | null;
}

/**
 * Everything a human needs to decide whether to press Publish — and NOTHING
 * hits the broker. Pure read + pure build.
 */
export async function previewBasket(
  strategyId: string,
  brokerType: string
): Promise<BasketPreview> {
  const adapter = getBasketAdapter(brokerType);
  if (!adapter) throw new Error(`No basket adapter registered for "${brokerType}"`);

  const conn = await getBasketConnection(brokerType);
  const state = await getBasketState(strategyId, brokerType);

  const probe = await loadCanonicalBasket(strategyId, "CREATE");
  const decision = decideLifecycle(
    state,
    probe.version,
    probe.rebalanceId,
    probe.strategyStatus
  );

  const lifecycle: BasketLifecycle =
    decision.action === "NOOP" ? "REBALANCE" : decision.action;
  const basket = await loadCanonicalBasket(strategyId, lifecycle);

  const elig = validateBasketForBroker(basket, adapter.capabilities);

  let payload: any = null;
  if (elig.eligible && conn) {
    try {
      payload = adapter.buildPayload(basket, conn);
    } catch (err: any) {
      payload = { _buildError: err?.message ?? String(err) };
    }
  }

  return {
    strategyId,
    brokerType,
    connectionConfigured: !!conn,
    tokenConfigured: !!conn?.token,
    isEnabled: state?.isEnabled ?? false,
    syncState: state?.syncState ?? "never_sent",
    ourVersion: basket.version,
    lastSyncedVersion: state?.lastSyncedVersion ?? null,
    decision,
    eligible: elig.eligible,
    errors: elig.eligible ? [] : elig.errors,
    warnings: elig.warnings,
    payload,
  };
}

// ─── Dispatch ────────────────────────────────────────────────────

export interface DispatchOptions {
  /** Bypass the decideLifecycle() decision. Admin-only escape hatch. */
  forceLifecycle?: BasketLifecycle;
  /** Ignore broker_basket_state.is_enabled. Admin "publish now". */
  ignoreEnabled?: boolean;
  triggeredBy?: string;
  triggeredByUserId?: string | null;
  /** Internal — guards the single reconciliation hop. */
  _isReconciliation?: boolean;
}

export interface DispatchResult {
  strategyId: string;
  brokerType: string;
  lifecycle: BasketLifecycle | "NOOP";
  outcome: BasketDispatchOutcome | null;
  xRequestId: string | null;
  reason: string;
  reconciled?: boolean;
}

export async function dispatchBasket(
  strategyId: string,
  brokerType: string,
  opts: DispatchOptions = {}
): Promise<DispatchResult> {
  const triggeredBy = opts.triggeredBy ?? "admin";
  const triggeredByUserId = opts.triggeredByUserId ?? null;

  const adapter = getBasketAdapter(brokerType);
  if (!adapter) throw new Error(`No basket adapter registered for "${brokerType}"`);

  const conn = await getBasketConnection(brokerType);
  if (!conn) {
    return {
      strategyId, brokerType, lifecycle: "NOOP", outcome: null, xRequestId: null,
      reason: `No broker_connections row with broker_type='${brokerType}'. Create one (see migrations/basket-broker-tables.sql).`,
    };
  }
  if (!conn.isEnabled) {
    return {
      strategyId, brokerType, lifecycle: "NOOP", outcome: null, xRequestId: null,
      reason: `Broker connection "${conn.name}" is disabled.`,
    };
  }

  const state = await ensureBasketState(strategyId, brokerType, conn.id);

  if (!state.isEnabled && !opts.ignoreEnabled) {
    return {
      strategyId, brokerType, lifecycle: "NOOP", outcome: null, xRequestId: null,
      reason: "This basket is not enabled for this broker. Enable it in the admin panel.",
    };
  }

  // Decide what to do.
  const probe = await loadCanonicalBasket(strategyId, "CREATE");
  const decision = decideLifecycle(state, probe.version, probe.rebalanceId, probe.strategyStatus);

  const lifecycle: BasketLifecycle | "NOOP" = opts.forceLifecycle ?? decision.action;
  if (lifecycle === "NOOP") {
    return {
      strategyId, brokerType, lifecycle: "NOOP", outcome: null, xRequestId: null,
      reason: decision.reason,
    };
  }

  const basket = await loadCanonicalBasket(strategyId, lifecycle);

  // Validate BEFORE the network. A 33-leg basket rejected with an opaque
  // broker-side 410 names no leg; our errors name the leg, field, and value.
  const elig = validateBasketForBroker(basket, adapter.capabilities);
  if (!elig.eligible) {
    const outcome: BasketDispatchOutcome = { status: "validation_failed", errors: elig.errors };
    const xRequestId = newRequestId(strategyId);
    await logAttempt({
      basket, brokerType, connectionId: conn.id,
      basketStatus: lifecycleToStatus(lifecycle),
      xRequestId, payload: null, outcome, triggeredBy, triggeredByUserId,
    });
    await updateStateAfterFailure(
      strategyId, brokerType,
      elig.errors.map(e => `${e.field}: ${e.reason}`).join("; ")
    );
    return {
      strategyId, brokerType, lifecycle, outcome, xRequestId,
      reason: `Failed pre-flight validation (${elig.errors.length} error(s)). Nothing was sent.`,
    };
  }

  const xRequestId = newRequestId(strategyId);
  const payload = safeBuild(adapter, basket, conn);
  const outcome = await adapter.dispatch(basket, conn, xRequestId);

  await logAttempt({
    basket, brokerType, connectionId: conn.id,
    basketStatus: lifecycleToStatus(lifecycle),
    xRequestId, payload, outcome, triggeredBy, triggeredByUserId,
  });

  if (outcome.status === "success") {
    await updateStateAfterSuccess(
      strategyId, brokerType, lifecycle,
      basket.rebalanceId, basket.version, outcome.brokerVersion
    );
    return {
      strategyId, brokerType, lifecycle, outcome, xRequestId,
      reason: `${lifecycleToStatus(lifecycle)} succeeded (broker version ${outcome.brokerVersion ?? "?"}).`,
    };
  }

  // ─── Conflict reconciliation ───────────────────────────────────
  // Our state and the broker's disagree. Fix our state, re-dispatch ONCE.
  // Guarded by _isReconciliation so this can never loop.
  if (outcome.status === "conflict" && !opts._isReconciliation) {
    const http = outcome.httpStatus;

    if (http === 409 && lifecycle === "CREATE") {
      // They already have it; we thought it was new.
      await forceSyncState(strategyId, brokerType, "created");
      const retry = await dispatchBasket(strategyId, brokerType, {
        ...opts,
        forceLifecycle: "REBALANCE",
        triggeredBy: "reconcile",
        _isReconciliation: true,
      });
      return { ...retry, reconciled: true, reason: `409 on CREATE — basket already exists on broker. Reconciled to 'created' and re-dispatched as REBALANCED. ${retry.reason}` };
    }

    if (http === 404 && (lifecycle === "REBALANCE" || lifecycle === "CLOSE")) {
      // They do not have it; our state was ahead.
      await forceSyncState(strategyId, brokerType, "never_sent");
      if (lifecycle === "CLOSE") {
        // Nothing to close. Leave it as never_sent and stop.
        await updateStateAfterFailure(strategyId, brokerType, "404 on CLOSE — broker has no such basket. State reset to never_sent.");
        return {
          strategyId, brokerType, lifecycle, outcome, xRequestId, reconciled: true,
          reason: "404 on CLOSE — the broker has no such basket. State reset to never_sent; nothing further to do.",
        };
      }
      const retry = await dispatchBasket(strategyId, brokerType, {
        ...opts,
        forceLifecycle: "CREATE",
        triggeredBy: "reconcile",
        _isReconciliation: true,
      });
      return { ...retry, reconciled: true, reason: `404 on REBALANCED — broker has no such basket. Reconciled to 'never_sent' and re-dispatched as CREATED. ${retry.reason}` };
    }
  }

  const errMsg =
    outcome.status === "skipped"
      ? outcome.reason
      : outcome.status === "validation_failed"
        ? outcome.errors.map(e => `${e.field}: ${e.reason}`).join("; ")
        : outcome.errorMessage;

  await updateStateAfterFailure(strategyId, brokerType, errMsg);

  // NOTE for whoever builds a retry worker on top of this:
  // ONLY rows with status='retryable' may be retried. A 'terminal' row (HTTP
  // 410 — weight sum wrong, SELL leg on create) can NEVER succeed as-is;
  // retrying it means hammering the broker's gateway forever with a payload
  // that is definitionally invalid.
  return {
    strategyId, brokerType, lifecycle, outcome, xRequestId,
    reason: `${lifecycleToStatus(lifecycle)} -> ${outcome.status}: ${errMsg}`,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function newRequestId(strategyId: string): string {
  const d = new Date();
  const stamp =
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `bskt-${stamp}-${strategyId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
}

function lifecycleToStatus(l: BasketLifecycle): string {
  switch (l) {
    case "CREATE": return "CREATED";
    case "REBALANCE": return "REBALANCED";
    case "CLOSE": return "CLOSED";
    case "MODIFY": return "MODIFIED";
  }
}

function safeBuild(adapter: BasketAdapter, basket: CanonicalBasket, conn: BasketBrokerConnection): any {
  try {
    return adapter.buildPayload(basket, conn);
  } catch (err: any) {
    return { _buildError: err?.message ?? String(err) };
  }
}

export { BasketNotFound };
