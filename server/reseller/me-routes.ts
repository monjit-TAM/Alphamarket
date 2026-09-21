// ============================================================================
// STAGE C — Reseller self-serve API (the logged-in reseller's own data)
// SAVE AS: server/reseller/me-routes.ts
// Registered from server/routes.ts:
//     import { registerResellerMeRoutes } from "./reseller/me-routes";
//     registerResellerMeRoutes(app);
// ============================================================================

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { resellers, resellerCustomers, resellerLedger } from "../../shared/schema";
import { users } from "../../shared/schema";
import { eq, sql, desc } from "drizzle-orm";

// resolve the reseller row for the logged-in user
async function currentReseller(req: Request) {
  const userId = (req.session as any)?.userId;
  if (!userId) return null;
  const rows = await db.select().from(resellers).where(eq(resellers.userId, userId)).limit(1);
  return rows[0] || null;
}

export function registerResellerMeRoutes(app: Express): void {

  // ── The reseller's own summary + KPIs ──
  app.get("/api/reseller/me", async (req: Request, res: Response) => {
    try {
      const r = await currentReseller(req);
      if (!r) return res.status(403).send("Not a reseller account");

      const [cust] = await db.select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${resellerCustomers.status} = 'active')::int`,
      }).from(resellerCustomers).where(eq(resellerCustomers.resellerId, r.id));

      const [led] = await db.select({
        productsSold: sql<number>`count(*)::int`,
        grossRevenue: sql<string>`coalesce(sum(${resellerLedger.grossAmount}), 0)`,
        shareTotal: sql<string>`coalesce(sum(${resellerLedger.shareAmount}), 0)`,
        sharePending: sql<string>`coalesce(sum(${resellerLedger.shareAmount}) filter (where ${resellerLedger.status} = 'accrued'), 0)`,
        sharePaid: sql<string>`coalesce(sum(${resellerLedger.shareAmount}) filter (where ${resellerLedger.status} = 'paid'), 0)`,
      }).from(resellerLedger).where(eq(resellerLedger.resellerId, r.id));

      res.json({
        firmName: r.firmName,
        referralCode: r.referralCode,
        commissionRate: r.commissionRate,
        status: r.status,
        totalCustomers: cust?.total ?? 0,
        activeCustomers: cust?.active ?? 0,
        productsSold: led?.productsSold ?? 0,
        grossRevenue: Number(led?.grossRevenue ?? 0),
        shareTotal: Number(led?.shareTotal ?? 0),
        sharePending: Number(led?.sharePending ?? 0),
        sharePaid: Number(led?.sharePaid ?? 0),
      });
    } catch (err: any) {
      console.error("[Reseller/me] summary error:", err);
      res.status(500).send(err.message);
    }
  });

  // ── The reseller's own customers ──
  app.get("/api/reseller/me/customers", async (req: Request, res: Response) => {
    try {
      const r = await currentReseller(req);
      if (!r) return res.status(403).send("Not a reseller account");
      const rows = await db.select({
        id: resellerCustomers.id,
        customerId: resellerCustomers.customerId,
        status: resellerCustomers.status,
        enrolledAt: resellerCustomers.enrolledAt,
        username: users.username,
        email: users.email,
      }).from(resellerCustomers)
        .innerJoin(users, eq(users.id, resellerCustomers.customerId))
        .where(eq(resellerCustomers.resellerId, r.id))
        .orderBy(desc(resellerCustomers.enrolledAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[Reseller/me] customers error:", err);
      res.status(500).send(err.message);
    }
  });

  // ── The reseller's own earnings ledger ──
  app.get("/api/reseller/me/ledger", async (req: Request, res: Response) => {
    try {
      const r = await currentReseller(req);
      if (!r) return res.status(403).send("Not a reseller account");
      const rows = await db.select({
        id: resellerLedger.id,
        grossAmount: resellerLedger.grossAmount,
        commissionRate: resellerLedger.commissionRate,
        shareAmount: resellerLedger.shareAmount,
        status: resellerLedger.status,
        createdAt: resellerLedger.createdAt,
        paidAt: resellerLedger.paidAt,
        customerName: users.username,
      }).from(resellerLedger)
        .leftJoin(users, eq(users.id, resellerLedger.customerId))
        .where(eq(resellerLedger.resellerId, r.id))
        .orderBy(desc(resellerLedger.createdAt))
        .limit(200);
      res.json(rows);
    } catch (err: any) {
      console.error("[Reseller/me] ledger error:", err);
      res.status(500).send(err.message);
    }
  });
}
