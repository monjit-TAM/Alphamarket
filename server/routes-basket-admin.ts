/**
 * server/routes-basket-admin.ts
 *
 * Admin API for publishing model-portfolio baskets to brokers.
 *
 * Mirrors the shape of the existing /api/admin/broker-calls/* endpoints so the
 * admin UI feels the same — but it is an entirely separate router on a separate
 * path prefix. It registers no routes under /api/admin/broker-calls and touches
 * nothing the live recommendation webhook depends on.
 *
 * Mount with ONE line in routes.ts:
 *
 *     import { registerBasketAdminRoutes } from "./routes-basket-admin";
 *     registerBasketAdminRoutes(app, requireAdmin);
 *
 * requireAdmin is passed in rather than imported, so this file has no opinion
 * about how auth is wired and cannot accidentally diverge from it.
 */

import type { Express, Request, Response, RequestHandler } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";

import {
  dispatchBasket,
  previewBasket,
  getBasketConnection,
  getBasketState,
  ensureBasketState,
  setBasketEnabled,
  listBasketAdapters,
  getBasketAdapter,
  decideLifecycle,
  BasketNotFound,
} from "./basket-dispatcher";

import {
  listBasketStrategies,
  loadCanonicalBasket,
} from "./broker-integrations/core/basket-loader";

import { validateBasketForBroker } from "./broker-integrations/core/basket-validation";

const DEFAULT_BROKER = "UPSTOX_BASKET";

function userId(req: Request): string | null {
  return (req as any)?.user?.id ?? (req as any)?.session?.userId ?? null;
}

export function registerBasketAdminRoutes(app: Express, requireAdmin: RequestHandler): void {
  // ───────────────────────────────────────────────────────────────
  // GET /api/admin/baskets/brokers
  // Which basket brokers exist, are they configured, do they have a token.
  // ───────────────────────────────────────────────────────────────
  app.get("/api/admin/baskets/brokers", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const out = [];
      for (const adapter of listBasketAdapters()) {
        const conn = await getBasketConnection(adapter.brokerType);
        out.push({
          brokerType: adapter.brokerType,
          capabilities: adapter.capabilities,
          connection: conn
            ? {
                id: conn.id,
                name: conn.name,
                baseUrl: conn.baseUrl,
                vendorCode: conn.vendorCode,
                vendorKey: conn.vendorKey,
                isEnabled: conn.isEnabled,
                // Never leak the token. Only whether it exists.
                tokenConfigured: !!conn.token,
              }
            : null,
        });
      }
      res.json({ brokers: out });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/admin/baskets?broker=UPSTOX_BASKET
  //
  // Every model-portfolio basket, with per-broker eligibility computed live.
  // This is the page that answers "what can I actually publish today?"
  // ───────────────────────────────────────────────────────────────
  app.get("/api/admin/baskets", requireAdmin, async (req: Request, res: Response) => {
    try {
      const brokerType = String(req.query.broker || DEFAULT_BROKER);
      const adapter = getBasketAdapter(brokerType);
      if (!adapter) return res.status(400).json({ error: `Unknown basket broker "${brokerType}"` });

      const conn = await getBasketConnection(brokerType);
      const strategies = await listBasketStrategies();

      const rows = [];
      for (const s of strategies) {
        let eligible = false;
        let errors: any[] = [];
        let warnings: any[] = [];
        let decision: any = { action: "NOOP", reason: "Not evaluated" };

        try {
          const state = await getBasketState(s.strategyId, brokerType);
          const probe = await loadCanonicalBasket(s.strategyId, "CREATE");
          decision = decideLifecycle(state, probe.version, probe.rebalanceId, probe.strategyStatus);

          const lifecycle = decision.action === "NOOP" ? "REBALANCE" : decision.action;
          const basket = await loadCanonicalBasket(s.strategyId, lifecycle as any);
          const elig = validateBasketForBroker(basket, adapter.capabilities);

          eligible = elig.eligible;
          errors = elig.eligible ? [] : elig.errors;
          warnings = elig.warnings;

          rows.push({
            ...s,
            brokerType,
            syncState: state?.syncState ?? "never_sent",
            isEnabled: state?.isEnabled ?? false,
            brokerVersion: state?.brokerVersion ?? null,
            lastSyncedVersion: state?.lastSyncedVersion ?? null,
            lastSyncedAt: state?.lastSyncedAt ?? null,
            lastError: state?.lastError ?? null,
            decision,
            eligible,
            errors,
            warnings,
            unresolvedSymbols: basket.legs.filter(l => l.exchangeToken == null).map(l => l.rawSymbol),
            resolvedViaSuffix: basket.legs
              .filter(l => l.exchangeToken != null && l.symbol !== l.rawSymbol)
              .map(l => ({ from: l.rawSymbol, to: l.symbol })),
          });
        } catch (err: any) {
          rows.push({
            ...s,
            brokerType,
            syncState: "never_sent",
            isEnabled: false,
            eligible: false,
            errors: [{ field: "_load", reason: err?.message ?? String(err) }],
            warnings: [],
            decision,
            unresolvedSymbols: [],
            resolvedViaSuffix: [],
          });
        }
      }

      res.json({
        brokerType,
        capabilities: adapter.capabilities,
        connectionConfigured: !!conn,
        tokenConfigured: !!conn?.token,
        connectionEnabled: !!conn?.isEnabled,
        baskets: rows,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/admin/baskets/:strategyId/preview?broker=...
  //
  // Full dry run: eligibility, the lifecycle decision, and the EXACT JSON that
  // would go on the wire. Sends nothing. Use this before every first publish.
  // ───────────────────────────────────────────────────────────────
  app.get("/api/admin/baskets/:strategyId/preview", requireAdmin, async (req: Request, res: Response) => {
    try {
      const brokerType = String(req.query.broker || DEFAULT_BROKER);
      const preview = await previewBasket(String(req.params.strategyId), brokerType);
      res.json(preview);
    } catch (err: any) {
      if (err instanceof BasketNotFound) return res.status(404).json({ error: err.message });
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/admin/baskets/:strategyId/enable   { broker, enabled }
  // Per-basket, per-broker kill switch.
  // ───────────────────────────────────────────────────────────────
  app.post("/api/admin/baskets/:strategyId/enable", requireAdmin, async (req: Request, res: Response) => {
    try {
      const brokerType = String(req.body.broker || DEFAULT_BROKER);
      const enabled = Boolean(req.body.enabled);
      const conn = await getBasketConnection(brokerType);
      await setBasketEnabled(String(req.params.strategyId), brokerType, enabled, conn?.id ?? null);
      const state = await getBasketState(String(req.params.strategyId), brokerType);
      res.json({ ok: true, state });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/admin/baskets/:strategyId/publish
  //   { broker, force?: 'CREATE'|'REBALANCE'|'CLOSE', ignoreEnabled?: bool }
  //
  // THE ONLY ENDPOINT THAT TALKS TO THE BROKER.
  //
  // Everything else in this file is read-only. Publishing is always an explicit,
  // admin-initiated, audited action — there is no automatic scheduler firing
  // baskets at brokers behind your back.
  // ───────────────────────────────────────────────────────────────
  app.post("/api/admin/baskets/:strategyId/publish", requireAdmin, async (req: Request, res: Response) => {
    try {
      const brokerType = String(req.body.broker || DEFAULT_BROKER);
      const force = req.body.force ? String(req.body.force) : undefined;

      if (force && !["CREATE", "REBALANCE", "CLOSE"].includes(force)) {
        // MODIFY deliberately not offered: basket_rebalances bumps version on
        // every change, so every change is a REBALANCE.
        return res.status(400).json({ error: `Invalid force lifecycle "${force}". Allowed: CREATE, REBALANCE, CLOSE.` });
      }

      const result = await dispatchBasket(String(req.params.strategyId), brokerType, {
        forceLifecycle: force as any,
        ignoreEnabled: Boolean(req.body.ignoreEnabled),
        triggeredBy: "admin",
        triggeredByUserId: userId(req),
      });

      const ok = result.outcome?.status === "success";
      res.status(ok ? 200 : 422).json(result);
    } catch (err: any) {
      if (err instanceof BasketNotFound) return res.status(404).json({ error: err.message });
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/admin/baskets/logs?strategyId=&broker=&status=&limit=
  // ───────────────────────────────────────────────────────────────
  app.get("/api/admin/baskets/logs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const strategyId = req.query.strategyId ? String(req.query.strategyId) : null;
      const brokerType = req.query.broker ? String(req.query.broker) : null;
      const status = req.query.status ? String(req.query.status) : null;

      const result = await db.execute(sql`
        SELECT
          l.id, l.strategy_id, l.broker_type, l.basket_status, l.version,
          l.x_request_id, l.http_status, l.status, l.error_message,
          l.retry_count, l.triggered_by, l.published_at,
          l.payload, l.response,
          s.name AS strategy_name,
          u.company_name AS advisor_name
        FROM broker_basket_publish_log l
        LEFT JOIN strategies s ON s.id = l.strategy_id
        LEFT JOIN users u      ON u.id = l.advisor_id
        WHERE (${strategyId}::text IS NULL OR l.strategy_id = ${strategyId})
          AND (${brokerType}::text IS NULL OR l.broker_type = ${brokerType})
          AND (${status}::text     IS NULL OR l.status      = ${status})
        ORDER BY l.published_at DESC
        LIMIT ${limit}
      `);

      res.json({ logs: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // GET /api/admin/baskets/:strategyId/state?broker=...
  // ───────────────────────────────────────────────────────────────
  app.get("/api/admin/baskets/:strategyId/state", requireAdmin, async (req: Request, res: Response) => {
    try {
      const brokerType = String(req.query.broker || DEFAULT_BROKER);
      const conn = await getBasketConnection(brokerType);
      const state = await ensureBasketState(String(req.params.strategyId), brokerType, conn?.id ?? null);
      res.json({ state });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/admin/baskets/:strategyId/reset-state   { broker, syncState }
  //
  // Break-glass. If our state and the broker's have diverged in a way the
  // automatic 409/404 reconciliation cannot fix, an admin can force it.
  // Every use is logged.
  // ───────────────────────────────────────────────────────────────
  app.post("/api/admin/baskets/:strategyId/reset-state", requireAdmin, async (req: Request, res: Response) => {
    try {
      const brokerType = String(req.body.broker || DEFAULT_BROKER);
      const syncState = String(req.body.syncState || "");
      if (!["never_sent", "created", "closed"].includes(syncState)) {
        return res.status(400).json({ error: `Invalid syncState "${syncState}".` });
      }
      const strategyId = String(req.params.strategyId);
      const conn = await getBasketConnection(brokerType);
      await ensureBasketState(strategyId, brokerType, conn?.id ?? null);

      await db.execute(sql`
        UPDATE broker_basket_state
        SET sync_state = ${syncState},
            last_error = ${`Manually reset to '${syncState}' by admin`},
            updated_at = now()
        WHERE strategy_id = ${strategyId} AND broker_type = ${brokerType}
      `);

      const state = await getBasketState(strategyId, brokerType);
      res.json({ ok: true, state });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });
}
