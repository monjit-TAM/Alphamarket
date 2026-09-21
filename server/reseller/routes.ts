// ============================================================================
// STAGE B2 — Reseller routes
// SAVE AS: server/reseller/routes.ts   (new folder server/reseller/)
// Registered from server/index.ts (or wherever registerAuthRoutes is called):
//     import { registerResellerRoutes } from "./reseller/routes";
//     registerResellerRoutes(app, storage);
// ============================================================================

import type { Express } from "express";
import crypto from "crypto";
import { db } from "../db";
import { resellers, resellerCustomers } from "../../shared/schema";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "../auth/passwords";
import {
  sendRegistrationNotification,
  sendUserWelcomeEmail,
} from "../auth/email";

// Generate a short, human-friendly referral code, e.g. "AV7K3Q2P"
function makeReferralCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing 0/O/1/I
  let code = "AV";
  for (let i = 0; i < 6; i++) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return code;
}

async function uniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeReferralCode();
    const existing = await db.select({ id: resellers.id })
      .from(resellers).where(eq(resellers.referralCode, code)).limit(1);
    if (existing.length === 0) return code;
  }
  // extremely unlikely fallback
  return "AV" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

export function registerResellerRoutes(
  app: Express,
  storage: {
    getUserByUsername: (username: string) => Promise<any>;
    getUserByEmail: (email: string) => Promise<any>;
    getUser: (id: string) => Promise<any>;
    createUser: (data: any) => Promise<any>;
  }
): void {

  // ── Reseller self-registration ──
  app.post("/api/reseller/register", async (req, res) => {
    try {
      const { username, email, password, phone, firmName, agreementConsent } = req.body;

      if (!username || !email || !password) {
        return res.status(400).send("Username, email, and password are required");
      }
      if (password.length < 6) {
        return res.status(400).send("Password must be at least 6 characters");
      }
      if (!agreementConsent) {
        return res.status(400).send("You must accept the Reseller Partner Agreement");
      }

      const existing = await storage.getUserByUsername(username);
      if (existing) return res.status(400).send("Username already taken");
      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) return res.status(400).send("Email already registered");

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        username,
        email,
        password: hashedPassword,
        phone: phone || null,
        role: "reseller",
        companyName: firmName || null,
        overview: null,
        themes: null,
        logoUrl: null,
        sebiCertUrl: null,
        sebiRegNumber: null,
        isRegistered: false,   // pending admin approval
        isApproved: false,
        agreementConsent: true,
        agreementConsentDate: new Date(),
        activeSince: new Date(),
      });

      // create the reseller record with a unique referral code
      const referralCode = await uniqueReferralCode();
      const [reseller] = await db.insert(resellers).values({
        userId: user.id,
        firmName: firmName || null,
        referralCode,
        commissionRate: "50",
        status: "pending",
      }).returning();

      req.session.userId = user.id;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).send("Registration failed");
        }
        const { password: _, ...safeUser } = user;
        res.json({ ...safeUser, reseller });
      });

      // fire-and-forget notifications (reuse existing email helpers)
      sendRegistrationNotification({
        username, email, phone: phone || undefined,
        role: "reseller",
        companyName: firmName || undefined,
      }).catch((e) => console.error("[Reseller] notify error:", e));
      sendUserWelcomeEmail({
        email, username, role: "reseller",
        companyName: firmName || undefined,
      }).catch((e) => console.error("[Reseller] welcome error:", e));

    } catch (err: any) {
      console.error("[Reseller] Registration error:", err);
      res.status(500).send(err.message);
    }
  });

  // ── Resolve a referral code to a public reseller name (for signup UI) ──
  app.get("/api/reseller/by-code/:code", async (req, res) => {
    try {
      const code = String(req.params.code || "").trim().toUpperCase();
      if (!code) return res.status(400).send("Missing code");
      const rows = await db.select({
        id: resellers.id, firmName: resellers.firmName, status: resellers.status,
      }).from(resellers).where(eq(resellers.referralCode, code)).limit(1);
      if (rows.length === 0 || rows[0].status === "suspended") {
        return res.status(404).send("Invalid referral code");
      }
      res.json({ resellerId: rows[0].id, firmName: rows[0].firmName });
    } catch (err: any) {
      console.error("[Reseller] by-code error:", err);
      res.status(500).send(err.message);
    }
  });

  // ── Link an already-registered customer to a reseller by referral code ──
  //    Called right after a normal customer signs up with ?ref=CODE.
  app.post("/api/reseller/attach", async (req, res) => {
    try {
      const { referralCode } = req.body;
      const customerId = (req.session as any)?.userId;
      if (!customerId) return res.status(401).send("Not logged in");
      if (!referralCode) return res.status(400).send("referralCode is required");
      const code = String(referralCode).trim().toUpperCase();
      const rows = await db.select({ id: resellers.id, status: resellers.status })
        .from(resellers).where(eq(resellers.referralCode, code)).limit(1);
      if (rows.length === 0 || rows[0].status === "suspended") {
        return res.status(404).send("Invalid referral code");
      }
      const resellerId = rows[0].id;

      // block self-referral
      const own = await db.select({ id: resellers.id }).from(resellers)
        .where(eq(resellers.userId, customerId)).limit(1);
      if (own.length && own[0].id === resellerId) {
        return res.status(400).send("Cannot refer yourself");
      }

      // idempotent: ignore if already linked (unique constraint covers it)
      await db.insert(resellerCustomers)
        .values({ resellerId, customerId, status: "active" })
        .onConflictDoNothing();

      res.json({ ok: true, resellerId });
    } catch (err: any) {
      console.error("[Reseller] attach error:", err);
      res.status(500).send(err.message);
    }
  });
}
