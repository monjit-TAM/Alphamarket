/**
 * server/nextra-admin.ts
 *
 * Admin API endpoints for Partner/Nextra management.
 * Provides data for the Broker Integration admin dashboard.
 * COMPLETELY INDEPENDENT — no impact on webhooks/Upstox/Dreamstreet/XTS.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import type { Express } from "express";

export function registerNextraAdmin(app: Express) {

  // GET /api/admin/partners — List all partner configs
  app.get("/api/admin/partners", async (_req: any, res: any) => {
    try {
      const result = await db.execute(sql`
        SELECT pc.*,
          (SELECT COUNT(*) FROM partner_shadow_users WHERE partner_id = pc.id) as total_users,
          (SELECT COUNT(*) FROM partner_sessions WHERE partner_id = pc.id AND expires_at > NOW()) as active_sessions,
          (SELECT COUNT(*) FROM partner_shadow_users WHERE partner_id = pc.id AND last_seen > NOW() - INTERVAL '24 hours') as users_24h
        FROM partner_configs pc
        ORDER BY pc.created_at DESC
      `);
      res.json(result.rows);
    } catch (err: any) {
      console.error("[Nextra Admin] List partners error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/partners/:id — Get partner details
  app.get("/api/admin/partners/:id", async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`SELECT * FROM partner_configs WHERE id = ${req.params.id}`);
      const partner = (result.rows as any[])[0];
      if (!partner) return res.status(404).json({ error: "Partner not found" });
      res.json(partner);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/admin/partners/:id — Update partner config
  app.put("/api/admin/partners/:id", async (req: any, res: any) => {
    try {
      const { sso_enabled, sso_client_id, sso_client_secret, sso_api_url, sso_redirect_url,
              access_mode, payment_mode, landing_page, whitelabel_config, is_active,
              contact_email, contact_name } = req.body;
      await db.execute(sql`
        UPDATE partner_configs SET
          sso_enabled = COALESCE(${sso_enabled}, sso_enabled),
          sso_client_id = COALESCE(${sso_client_id}, sso_client_id),
          sso_client_secret = COALESCE(${sso_client_secret}, sso_client_secret),
          sso_api_url = COALESCE(${sso_api_url}, sso_api_url),
          sso_redirect_url = COALESCE(${sso_redirect_url}, sso_redirect_url),
          access_mode = COALESCE(${access_mode}, access_mode),
          payment_mode = COALESCE(${payment_mode}, payment_mode),
          landing_page = COALESCE(${landing_page}, landing_page),
          whitelabel_config = COALESCE(${whitelabel_config ? JSON.stringify(whitelabel_config) : null}::jsonb, whitelabel_config),
          is_active = COALESCE(${is_active}, is_active),
          contact_email = COALESCE(${contact_email}, contact_email),
          contact_name = COALESCE(${contact_name}, contact_name),
          updated_at = NOW()
        WHERE id = ${req.params.id}
      `);
      res.json({ status: "success" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/partners — Add new partner
  app.post("/api/admin/partners", async (req: any, res: any) => {
    try {
      const { partner_name, contact_email, contact_name, sso_provider,
              sso_client_id, sso_client_secret, sso_api_url } = req.body;
      if (!partner_name) return res.status(400).json({ error: "partner_name required" });

      const crypto = require("crypto");
      const partnerKey = sso_provider + "_live_" + crypto.randomBytes(16).toString("hex");
      const partnerSecret = crypto.randomBytes(32).toString("hex");

      const result = await db.execute(sql`
        INSERT INTO partner_configs (id, partner_name, partner_key, partner_secret, is_active,
          contact_email, contact_name, sso_provider, sso_client_id, sso_client_secret, sso_api_url,
          sso_redirect_url, sso_enabled, access_mode, payment_mode, landing_page)
        VALUES (gen_random_uuid(), ${partner_name}, ${partnerKey}, ${partnerSecret}, true,
          ${contact_email || null}, ${contact_name || null}, ${sso_provider || 'nextra'},
          ${sso_client_id || null}, ${sso_client_secret || null}, ${sso_api_url || null},
          ${'https://alphamarket.co.in/auth/nextra/callback'}, ${!!sso_client_id},
          'marketplace', 'user_pays', '/dashboard/strategies')
        RETURNING *
      `);
      res.json((result.rows as any[])[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/partners/:id/shadow-users — List shadow users for a partner
  app.get("/api/admin/partners/:id/shadow-users", async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`
        SELECT psu.*,
          (SELECT COUNT(*) FROM partner_sessions WHERE shadow_user_id = psu.id AND expires_at > NOW()) as active_sessions,
          (SELECT MAX(created_at) FROM partner_sessions WHERE shadow_user_id = psu.id) as last_login
        FROM partner_shadow_users psu
        WHERE psu.partner_id = ${req.params.id}
        ORDER BY psu.last_seen DESC NULLS LAST
        LIMIT 500
      `);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/partners/:id/sessions — List recent sessions
  app.get("/api/admin/partners/:id/sessions", async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`
        SELECT ps.id, ps.product, ps.created_at, ps.expires_at,
          psu.uid, psu.email, psu.display_name, psu.broker_name, psu.broker_id
        FROM partner_sessions ps
        JOIN partner_shadow_users psu ON psu.id = ps.shadow_user_id
        WHERE ps.partner_id = ${req.params.id}
        ORDER BY ps.created_at DESC
        LIMIT 200
      `);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/partners/:id/broker-configs — List broker configurations under this partner
  app.get("/api/admin/partners/:id/broker-configs", async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`
        SELECT pbc.*,
          (SELECT COUNT(*) FROM partner_shadow_users WHERE partner_id = ${req.params.id} AND broker_id = pbc.broker_id) as user_count
        FROM partner_broker_configs pbc
        WHERE pbc.partner_id = ${req.params.id}
        ORDER BY pbc.created_at DESC
      `);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/partners/:id/stats — Dashboard stats
  app.get("/api/admin/partners/:id/stats", async (req: any, res: any) => {
    try {
      const id = req.params.id;
      const stats = await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM partner_shadow_users WHERE partner_id = ${id}) as total_users,
          (SELECT COUNT(*) FROM partner_shadow_users WHERE partner_id = ${id} AND last_seen > NOW() - INTERVAL '24 hours') as active_24h,
          (SELECT COUNT(*) FROM partner_sessions WHERE partner_id = ${id} AND expires_at > NOW()) as live_sessions,
          (SELECT COUNT(*) FROM partner_sessions WHERE partner_id = ${id} AND created_at > NOW() - INTERVAL '24 hours') as logins_24h,
          (SELECT COUNT(DISTINCT broker_id) FROM partner_shadow_users WHERE partner_id = ${id}) as unique_brokers,
          (SELECT COUNT(*) FROM partner_access_grants WHERE shadow_user_id IN (SELECT id FROM partner_shadow_users WHERE partner_id = ${id})) as total_grants
      `);
      res.json((stats.rows as any[])[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/partners/:id/sessions/expired — Clean up expired sessions
  app.delete("/api/admin/partners/:id/sessions/expired", async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`
        DELETE FROM partner_sessions WHERE partner_id = ${req.params.id} AND expires_at < NOW()
      `);
      res.json({ status: "success", deleted: result.rowCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log("[Nextra Admin] Routes registered: /api/admin/partners/*");
}
