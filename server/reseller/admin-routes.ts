// ============================================================================
// STAGE D — Admin reseller API
// SAVE AS: server/reseller/admin-routes.ts
// Registered from server/routes.ts, passing the existing requireAdmin:
//     import { registerResellerAdminRoutes } from "./reseller/admin-routes";
//     registerResellerAdminRoutes(app, requireAdmin);
// (requireAdmin is the middleware already defined in server/routes.ts)
// ============================================================================

import type { Express, RequestHandler, Request, Response } from "express";
import { db } from "../db";
import { resellers, resellerCustomers, resellerLedger } from "../../shared/schema";
import { users, payments } from "../../shared/schema";
import { eq, sql, inArray } from "drizzle-orm";

export function registerResellerAdminRoutes(app: Express, requireAdmin: RequestHandler): void {

  // ── List all resellers with activity metrics ──
  app.get("/api/admin/resellers", requireAdmin, async (_req: Request, res: Response) => {
    try {
      // base reseller rows joined to their user
      const rows = await db.select({
        id: resellers.id,
        userId: resellers.userId,
        firmName: resellers.firmName,
        referralCode: resellers.referralCode,
        commissionRate: resellers.commissionRate,
        status: resellers.status,
        createdAt: resellers.createdAt,
        username: users.username,
        email: users.email,
        phone: users.phone,
      }).from(resellers).innerJoin(users, eq(users.id, resellers.userId));

      if (rows.length === 0) return res.json([]);

      const resellerIds = rows.map((r) => r.id);

      // customers introduced (total + active) per reseller
      const custAgg = await db.select({
        resellerId: resellerCustomers.resellerId,
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${resellerCustomers.status} = 'active')::int`,
      }).from(resellerCustomers)
        .where(inArray(resellerCustomers.resellerId, resellerIds))
        .groupBy(resellerCustomers.resellerId);

      // revenue metrics from the ledger per reseller
      const ledgerAgg = await db.select({
        resellerId: resellerLedger.resellerId,
        productsSold: sql<number>`count(*)::int`,
        grossRevenue: sql<string>`coalesce(sum(${resellerLedger.grossAmount}), 0)`,
        shareTotal: sql<string>`coalesce(sum(${resellerLedger.shareAmount}), 0)`,
        sharePending: sql<string>`coalesce(sum(${resellerLedger.shareAmount}) filter (where ${resellerLedger.status} = 'accrued'), 0)`,
      }).from(resellerLedger)
        .where(inArray(resellerLedger.resellerId, resellerIds))
        .groupBy(resellerLedger.resellerId);

      const custMap = new Map(custAgg.map((c) => [c.resellerId, c]));
      const ledMap = new Map(ledgerAgg.map((l) => [l.resellerId, l]));

      const out = rows.map((r) => {
        const c = custMap.get(r.id);
        const l = ledMap.get(r.id);
        return {
          ...r,
          totalCustomers: c?.total ?? 0,
          activeCustomers: c?.active ?? 0,
          productsSold: l?.productsSold ?? 0,
          grossRevenue: Number(l?.grossRevenue ?? 0),
          shareTotal: Number(l?.shareTotal ?? 0),
          sharePending: Number(l?.sharePending ?? 0),
        };
      });
      res.json(out);
    } catch (err: any) {
      console.error("[Admin/Reseller] list error:", err);
      res.status(500).send(err.message);
    }
  });

  // ── Approve / suspend / reactivate a reseller ──
  app.patch("/api/admin/resellers/:id/status", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { status } = req.body; // "approved" | "suspended" | "pending"
      if (!["approved", "suspended", "pending"].includes(status)) {
        return res.status(400).send("Invalid status");
      }
      const adminId = (req.session as any)?.userId || null;
      const patch: any = { status };
      if (status === "approved") { patch.approvedBy = adminId; patch.approvedAt = new Date(); }
      const [updated] = await db.update(resellers).set(patch)
        .where(eq(resellers.id, req.params.id)).returning();
      if (!updated) return res.status(404).send("Reseller not found");
      res.json(updated);
    } catch (err: any) {
      console.error("[Admin/Reseller] status error:", err);
      res.status(500).send(err.message);
    }
  });

  // ── Edit a reseller's commission rate ──
  app.patch("/api/admin/resellers/:id/commission", requireAdmin, async (req: Request, res: Response) => {
    try {
      const rate = Number(req.body?.commissionRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return res.status(400).send("Commission rate must be between 0 and 100");
      }
      const [updated] = await db.update(resellers)
        .set({ commissionRate: String(rate) })
        .where(eq(resellers.id, req.params.id)).returning();
      if (!updated) return res.status(404).send("Reseller not found");
      res.json(updated);
    } catch (err: any) {
      console.error("[Admin/Reseller] commission error:", err);
      res.status(500).send(err.message);
    }
  });

  // ── Drill-in: one reseller's customers ──
  app.get("/api/admin/resellers/:id/customers", requireAdmin, async (req: Request, res: Response) => {
    try {
      const rows = await db.select({
        id: resellerCustomers.id,
        customerId: resellerCustomers.customerId,
        status: resellerCustomers.status,
        enrolledAt: resellerCustomers.enrolledAt,
        username: users.username,
        email: users.email,
      }).from(resellerCustomers)
        .innerJoin(users, eq(users.id, resellerCustomers.customerId))
        .where(eq(resellerCustomers.resellerId, req.params.id));
      res.json(rows);
    } catch (err: any) {
      console.error("[Admin/Reseller] customers error:", err);
      res.status(500).send(err.message);
    }
  });
}
