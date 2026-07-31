/**
 * server/basket-auto-dispatch.ts
 *
 * Fires a broker dispatch after an advisor rebalances a basket.
 *
 * ─────────────────────────────────────────────────────────────────
 * DESIGN: FIRE-AND-FORGET, NEVER BLOCKING
 * ─────────────────────────────────────────────────────────────────
 * The advisor's save must NEVER depend on a broker being reachable. If Upstox
 * is down, slow, or rejects the basket, the rebalance still succeeds locally
 * and the advisor sees no error. The dispatch outcome is recorded in
 * broker_basket_publish_log and surfaced in the admin panel.
 *
 * This is why the call site does not await this function.
 *
 * BEHAVIOUR ON AN INELIGIBLE NEW VERSION (policy choice (b)):
 *   An advisor rebalances an already-published basket and the new version is
 *   ineligible — say they added a SELL leg. We:
 *     - let the local save succeed (it is a valid AlphaMarket basket)
 *     - skip the dispatch
 *     - leave broker_basket_state showing drift (last_synced_version behind)
 *       plus last_error explaining why
 *   The admin panel then shows it as out-of-sync and needs attention.
 *
 *   The alternative — blocking the advisor's save because a downstream broker
 *   is unhappy — conflates two concerns and makes AlphaMarket's own product
 *   hostage to a third party. Switch AUTO_DISPATCH_POLICY if you disagree.
 *
 * ISOLATION: new file. Called from exactly one place (the existing
 * /basket/rebalance route), on a line that cannot throw into the request.
 * Nothing on the recommendation-webhook path is touched.
 */

import { dispatchBasket, getBasketState } from "./basket-dispatcher";

/** Brokers to auto-dispatch to. Add here as adapters are registered. */
const AUTO_DISPATCH_BROKERS = ["UPSTOX_BASKET"];

/**
 * Called after a successful rebalance. NOT awaited by the caller.
 *
 * Only dispatches when ALL of:
 *   - a broker_basket_state row exists for (strategy, broker)
 *   - that row has is_enabled = true  (explicit admin opt-in)
 *   - sync_state = 'created'          (basket already lives on the broker)
 *
 * A basket that has never been published is NOT auto-created here. First
 * publication stays a deliberate admin action — we don't want an advisor's
 * routine edit to silently push a brand-new product onto a broker's platform.
 */
export function autoDispatchOnRebalance(
  strategyId: string,
  advisorUserId: string | null
): void {
  // Detach from the request lifecycle entirely.
  setImmediate(async () => {
    for (const brokerType of AUTO_DISPATCH_BROKERS) {
      try {
        const state = await getBasketState(strategyId, brokerType);

        if (!state) continue;                        // never configured for this broker
        if (!state.isEnabled) continue;              // admin has not opted this basket in
        if (state.syncState !== "created") continue; // not live on the broker yet

        const result = await dispatchBasket(strategyId, brokerType, {
          triggeredBy: "advisor-rebalance",
          triggeredByUserId: advisorUserId,
        });

        const outcome = result.outcome?.status ?? "noop";
        if (outcome === "success") {
          console.log(`[basket-auto-dispatch] ${strategyId} -> ${brokerType}: ${result.lifecycle} OK`);
        } else {
          // Not an exception — an expected, recorded outcome. The admin panel
          // shows the detail; this line is for the ops log.
          console.warn(
            `[basket-auto-dispatch] ${strategyId} -> ${brokerType}: ${outcome} — ${result.reason}`
          );
        }
      } catch (err: any) {
        // Must never escape. The advisor's save has already been committed and
        // responded to; there is nothing left to fail.
        console.error(
          `[basket-auto-dispatch] ${strategyId} -> ${brokerType} threw:`,
          err?.message ?? err
        );
      }
    }
  });
}
