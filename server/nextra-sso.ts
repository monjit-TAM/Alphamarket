/**
 * server/nextra-sso.ts
 *
 * Nextra/Kambala OAuth SSO callback handler.
 * COMPLETELY INDEPENDENT — does not touch webhooks, Upstox, Dreamstreet, or XTS.
 *
 * Flow:
 * 1. Nextra redirects user to /auth/nextra/callback?code=xxx
 * 2. We call GenAcsTok to exchange code for access token
 * 3. We call UserDetails to get user info
 * 4. We create/update shadow user + session
 * 5. We redirect to the embedded dashboard
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import type { Express } from "express";

// ─── Nextra API Helper ──────────────────────────────────────────

interface NextraConfig {
  partnerId: string;
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  redirectUrl: string;
  accessMode: string;
  paymentMode: string;
  landingPage: string;
}

async function getNextraConfig(): Promise<NextraConfig | null> {
  try {
    const result = await db.execute(sql`
      SELECT id, sso_client_id, sso_client_secret, sso_api_url, sso_redirect_url,
             access_mode, payment_mode, landing_page
      FROM partner_configs
      WHERE sso_enabled = true AND sso_provider = 'nextra'
      LIMIT 1
    `);
    const row = (result.rows as any[])[0];
    if (!row) return null;
    return {
      partnerId: row.id,
      clientId: row.sso_client_id,
      clientSecret: row.sso_client_secret,
      apiUrl: row.sso_api_url,
      redirectUrl: row.sso_redirect_url,
      accessMode: row.access_mode || "marketplace",
      paymentMode: row.payment_mode || "user_pays",
      landingPage: row.landing_page || "/dashboard/strategies",
    };
  } catch (err: any) {
    console.error("[Nextra SSO] Config fetch error:", err.message);
    return null;
  }
}

function generateChecksum(clientId: string, secretKey: string, code: string): string {
  // SHA-256 of clientId + secretKey + code concatenated without spaces
  const raw = clientId + secretKey + code;
  return createHash("sha256").update(raw).digest("hex");
}

async function callGenAcsTok(apiUrl: string, code: string, checksum: string): Promise<any> {
  const url = apiUrl + "/GenAcsTok";
  const body = 'jData={"code":"' + code + '","checksum":"' + checksum + '"}';

  console.log("[Nextra SSO] Calling GenAcsTok:", url);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: body,
  });

  const text = await response.text();
  console.log("[Nextra SSO] GenAcsTok response status:", response.status);

  try {
    return JSON.parse(text);
  } catch {
    console.error("[Nextra SSO] GenAcsTok non-JSON response:", text.substring(0, 200));
    return { stat: "Not_Ok", emsg: "Invalid response from Nextra" };
  }
}

async function callUserDetails(apiUrl: string, uid: string, accessToken: string): Promise<any> {
  const url = apiUrl + "/UserDetails";
  const body = 'jData={"uid":"' + uid + '"}';

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "Authorization": "Bearer " + accessToken,
    },
    body: body,
  });

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    console.error("[Nextra SSO] UserDetails non-JSON response:", text.substring(0, 200));
    return null;
  }
}

async function createOrUpdateShadowUser(
  partnerId: string,
  uid: string,
  brokerId: string,
  email: string | null,
  displayName: string | null,
  phone: string | null,
  brokerName: string | null,
  accessToken: string,
  userData: any,
): Promise<string> {
  // Use uid + brokerId as the unique key (hashed_key = uid for Nextra)
  const result = await db.execute(sql`
    INSERT INTO partner_shadow_users
      (id, partner_id, hashed_key, broker_id, uid, email, display_name, phone, broker_name, access_token, user_data, last_seen)
    VALUES
      (gen_random_uuid(), ${partnerId}, ${uid}, ${brokerId}, ${uid}, ${email}, ${displayName}, ${phone}, ${brokerName}, ${accessToken}, ${JSON.stringify(userData || {})}::jsonb, NOW())
    ON CONFLICT (hashed_key, broker_id) DO UPDATE SET
      uid = ${uid},
      email = COALESCE(${email}, partner_shadow_users.email),
      display_name = COALESCE(${displayName}, partner_shadow_users.display_name),
      phone = COALESCE(${phone}, partner_shadow_users.phone),
      broker_name = COALESCE(${brokerName}, partner_shadow_users.broker_name),
      access_token = ${accessToken},
      user_data = ${JSON.stringify(userData || {})}::jsonb,
      last_seen = NOW()
    RETURNING id
  `);

  return (result.rows as any[])[0].id;
}

async function createSession(shadowUserId: string, partnerId: string, product: string): Promise<string> {
  const token = "nst_" + randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await db.execute(sql`
    INSERT INTO partner_sessions (id, token, shadow_user_id, partner_id, product, expires_at)
    VALUES (gen_random_uuid(), ${token}, ${shadowUserId}, ${partnerId}, ${product}, ${expiresAt})
  `);

  return token;
}

// ─── Route Registration ─────────────────────────────────────────

export function registerNextraSSO(app: Express) {
  /**
   * GET /auth/nextra/callback?code=xxx
   *
   * OAuth callback — Nextra redirects here after user login.
   * Exchanges code for access token, fetches user details,
   * creates shadow user + session, redirects to dashboard.
   */
  app.get("/auth/nextra/callback", async (req: any, res: any) => {
    try {
      const code = req.query.code as string;
      if (!code) {
        console.error("[Nextra SSO] No code in callback URL");
        return res.status(400).send(`
          <html><body style="font-family:Arial;text-align:center;padding:60px;">
            <h2>Authentication Failed</h2>
            <p>No authorization code received. Please try logging in again.</p>
          </body></html>
        `);
      }

      console.log("[Nextra SSO] Callback received with code:", code.substring(0, 8) + "...");

      // 1. Get Nextra config
      const config = await getNextraConfig();
      if (!config) {
        console.error("[Nextra SSO] No active Nextra config found");
        return res.status(500).send(`
          <html><body style="font-family:Arial;text-align:center;padding:60px;">
            <h2>Configuration Error</h2>
            <p>SSO is not configured. Please contact support.</p>
          </body></html>
        `);
      }

      // 2. Generate checksum and call GenAcsTok
      const checksum = generateChecksum(config.clientId, config.clientSecret, code);
      const tokenResponse = await callGenAcsTok(config.apiUrl, code, checksum);

      if (tokenResponse.stat === "Not_Ok" || !tokenResponse.susertoken) {
        console.error("[Nextra SSO] GenAcsTok failed:", tokenResponse.emsg || JSON.stringify(tokenResponse));
        return res.status(401).send(`
          <html><body style="font-family:Arial;text-align:center;padding:60px;">
            <h2>Authentication Failed</h2>
            <p>${tokenResponse.emsg || "Could not verify your identity. Please try again."}</p>
          </body></html>
        `);
      }

      const accessToken = tokenResponse.susertoken;
      const uid = tokenResponse.uid || tokenResponse.actid || "";

      console.log("[Nextra SSO] Token obtained for uid:", uid);

      // 3. Fetch user details
      let email: string | null = null;
      let displayName: string | null = null;
      let phone: string | null = null;
      let brokerName: string | null = null;
      let userData: any = {};

      try {
        const userDetails = await callUserDetails(config.apiUrl, uid, accessToken);
        if (userDetails) {
          email = userDetails.email || null;
          displayName = userDetails.uname || userDetails.cname || null;
          phone = userDetails.m_num || null;
          brokerName = userDetails.brkname || null;
          userData = userDetails;
        }
      } catch (udErr: any) {
        // Non-fatal — we can proceed with just uid
        console.error("[Nextra SSO] UserDetails fetch failed (non-fatal):", udErr.message);
      }

      // 4. Create/update shadow user
      const brokerId = brokerName || "nextra";
      const shadowUserId = await createOrUpdateShadowUser(
        config.partnerId, uid, brokerId,
        email, displayName, phone, brokerName,
        accessToken, userData,
      );

      console.log("[Nextra SSO] Shadow user:", shadowUserId, "uid:", uid, "broker:", brokerId);

      // 5. Create session
      const sessionToken = await createSession(shadowUserId, config.partnerId, "alphamarket");

      console.log("[Nextra SSO] Session created, redirecting to dashboard");

      // 6. Redirect to embedded dashboard
      const embedUrl = "/dashboard/strategies?embed=true&token=" + sessionToken;
      res.redirect(embedUrl);

    } catch (err: any) {
      console.error("[Nextra SSO] Callback error:", err.message, err.stack);
      res.status(500).send(`
        <html><body style="font-family:Arial;text-align:center;padding:60px;">
          <h2>Something Went Wrong</h2>
          <p>Please try again. If the issue persists, contact support.</p>
        </body></html>
      `);
    }
  });

  /**
   * GET /auth/nextra/test
   *
   * Test endpoint — shows SSO config status (no secrets exposed).
   */
  app.get("/auth/nextra/test", async (_req: any, res: any) => {
    try {
      const config = await getNextraConfig();
      if (!config) {
        return res.json({ status: "not_configured", message: "No active Nextra SSO config found" });
      }
      res.json({
        status: "ready",
        clientId: config.clientId,
        apiUrl: config.apiUrl,
        redirectUrl: config.redirectUrl,
        accessMode: config.accessMode,
        paymentMode: config.paymentMode,
        landingPage: config.landingPage,
        message: "Nextra SSO is configured and ready. Redirect users to Nextra OAuth with client_id=" + config.clientId,
      });
    } catch (err: any) {
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  console.log("[Nextra SSO] Routes registered: /auth/nextra/callback, /auth/nextra/test");
}
