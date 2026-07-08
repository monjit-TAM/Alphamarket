import { checkUsageLimit, checkDyorAccess, checkAnalyzerAccess, logToolUsage, getUsageStats, getUsageCount, getMonetizationConfig, clearConfigCache, getActiveSubscription, getAccessGrant, getAccessGrantForAnyTool, validateCoupon, useCoupon, incrementSubUsage } from "./usage-tracking";
import { generateLinkingCode, getUserTelegramStatus, initTelegramBot } from "./telegram";
import type { Express, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { registerBrokerApiRoutes, getSwaggerSpec } from "./broker-api";
import { registerBrokerApiRoutesV2 } from "./broker-api-v2";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { scrypt, randomBytes, timingSafeEqual, createHmac } from "crypto";
import { promisify } from "util";
import { setupSession, registerAuthRoutes, setupGoogleAuth, setupGithubAuth, sendEsignAgreementEmail } from "./auth";
import { getLiveQuote, getLivePrices, setGrowwAccessToken, getGrowwTokenStatus, getOptionChainExpiries, getOptionChain } from "./groww";
import type { Plan, BasketRebalance } from "@shared/schema";
import { esignAgreements, appSettings, calls, positions, strategies } from "@shared/schema";
import { db } from "./db";
import { handleXTSEvent, buildCallEventData, buildPositionEventData, fireWebhookEvent } from "./webhook-dispatcher";
import { handleXTSEvent as xtsHandleEvent } from "./xts-bridge";
import { and, eq, desc, sql } from "drizzle-orm";
import nseSymbols from "./data/nse-symbols.json";
import { createCashfreeOrder, fetchCashfreeOrder, fetchCashfreePayments, verifyCashfreeWebhook } from "./cashfree";
import {
  notifyStrategySubscribers, notifyWatchlistUsers, notifyAllUsers, notifyAllVisitors,
  vapidPublicKey, pushEnabled,
  buildNewCallSubscriberNotification, buildNewCallWatchlistNotification,
  buildCallClosedSubscriberNotification, buildCallClosedWatchlistNotification,
  buildCallUpdateSubscriberNotification,
  buildNewPositionSubscriberNotification, buildNewPositionWatchlistNotification,
  buildPositionClosedSubscriberNotification, buildPositionClosedWatchlistNotification,
  buildPositionUpdateSubscriberNotification,
} from "./push";
import { parseCASPdf } from "./cas-parser";
import { getLiveQuote } from "./groww";
import { sendAadhaarOtp, verifyAadhaarOtp, verifyPan, isSandboxConfigured, verifyBankAccount, fuzzyNameMatch } from "./sandbox-kyc";

const scryptAsync = promisify(scrypt);

function generateVerifyToken(orderId: string, userId: string): string {
  const secret = process.env.SESSION_SECRET!;
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  return createHmac("sha256", secret).update(`${orderId}:${userId}:${hourBucket}`).digest("hex").slice(0, 32);
}

function validateVerifyToken(token: string, orderId: string, userId: string): boolean {
  if (!token || token.length !== 32) return false;
  const secret = process.env.SESSION_SECRET!;
  const now = Math.floor(Date.now() / (1000 * 60 * 60));
  for (let i = 0; i <= 2; i++) {
    const bucket = now - i;
    const expected = createHmac("sha256", secret).update(`${orderId}:${userId}:${bucket}`).digest("hex").slice(0, 32);
    if (timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return true;
  }
  return false;
}

import { initXTSBridge } from "./xts-bridge";
import { initBrokerAdapters, handleBrokerEvent } from "./broker-integrations";
import { registerNextraSSO } from "./nextra-sso";
import { registerNextraAdmin } from "./nextra-admin";
import { registerNextraTrade } from "./nextra-trade";
import { registerNextraSimulator } from "./nextra-simulator";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Strip empty strings from numeric/integer DB fields to prevent Postgres type errors
  const NUMERIC_FIELDS = new Set([
    "minimumInvestment","cagr","buyRangeStart","buyRangeEnd","targetPrice",
    "profitGoal","stopLoss","entryPrice","sellPrice","gainPercent","duration",
    "strikePrice","lots","target","exitPrice","weightPercent","quantity",
    "priceAtRebalance","amount","durationDays","riskLevel",
  ]);
  function sanitizeBody(body: Record<string, any>): Record<string, any> {
    const out = { ...body };
    for (const key of Object.keys(out)) {
      if (NUMERIC_FIELDS.has(key) && (out[key] === "" || out[key] === null)) {
        delete out[key];
      }
    }
    return out;
  }
  setupSession(app);
  registerAuthRoutes(app, storage);
  setupGoogleAuth(app, storage);
  setupGithubAuth(app, storage);

  // Broker API v1 + Swagger
  registerBrokerApiRoutes(app);
  registerNextraSSO(app);
  registerNextraAdmin(app);
  registerNextraTrade(app);
  registerNextraSimulator(app);
  registerBrokerApiRoutesV2(app);
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(getSwaggerSpec(), { customCss: ".swagger-ui .topbar { display: none }", customSiteTitle: "AlphaMarket Broker API" }));

  // ═══ BROKER INTEGRATION SWAGGER (separate from XTS docs) ═══
  app.get("/api/broker-spec.json", (_req: any, res: any) => { try { const s = require("fs").readFileSync(require("path").join(__dirname, "public", "broker-swagger.json"), "utf-8"); res.type("json").send(s); } catch { res.json({}); } });
  app.get("/api/broker-guide", (_req: any, res: any) => { try { res.sendFile(require("path").join(__dirname, "public", "broker-guide.html")); } catch { res.status(404).send("Not found"); } });
  app.get("/api/webhook-docs", (_req: any, res: any) => { try { res.sendFile(require("path").join(__dirname, "public", "webhook-api.html")); } catch { res.status(404).send("Not found"); } });

  // ═══════════════════════════════════════════════════════════════════════════
  // OAuth SSO — Partner Platform Integration (NOREN/Kambala)
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /api/oauth/noren/session — Create authenticated session for partner user
  app.post("/api/oauth/noren/session", async (req: any, res: any) => {
    try {
      const { partner_key, hashed_key, broker_id, product, timestamp, signature } = req.body;
      if (!partner_key || !hashed_key || !broker_id || !product) {
        return res.status(400).json({ status: "error", message: "Missing required fields: partner_key, hashed_key, broker_id, product" });
      }
      if (!["alphamarket", "alphalab", "alphalens"].includes(product)) {
        return res.status(400).json({ status: "error", message: "Invalid product. Must be: alphamarket, alphalab, or alphalens" });
      }

      // 1. Validate partner
      const partnerResult = await db.execute(sql`SELECT id, partner_name, partner_secret, is_active FROM partner_configs WHERE partner_key = ${partner_key} LIMIT 1`);
      const partner = (partnerResult.rows as any[])[0];
      if (!partner) return res.status(401).json({ status: "error", message: "Invalid partner_key" });
      if (!partner.is_active) return res.status(403).json({ status: "error", message: "Partner account is inactive" });

      // 2. Verify HMAC signature
      if (signature) {
        const crypto = require("crypto");
        const rawBody = JSON.stringify(req.body);
        const expected = crypto.createHmac("sha256", partner.partner_secret).update(rawBody).digest("hex");
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
          return res.status(401).json({ status: "error", message: "Invalid signature" });
        }
      }

      // 3. Check timestamp freshness (5 min window)
      if (timestamp) {
        const tsAge = Math.abs(Date.now() - new Date(timestamp).getTime());
        if (tsAge > 300000) {
          return res.status(401).json({ status: "error", message: "Timestamp too old (>5 min)" });
        }
      }

      // 4. Check broker activation
      const brokerResult = await db.execute(sql`SELECT id, products_enabled, is_active FROM partner_broker_configs WHERE partner_id = ${partner.id} AND broker_id = ${broker_id} LIMIT 1`);
      const brokerConfig = (brokerResult.rows as any[])[0];
      if (brokerConfig) {
        if (!brokerConfig.is_active) return res.status(403).json({ status: "error", message: "Broker is inactive" });
        if (brokerConfig.products_enabled && !brokerConfig.products_enabled.includes(product)) {
          return res.status(403).json({ status: "error", message: "Product not enabled for this broker" });
        }
      }
      // If no broker config exists, allow access (default: all products enabled)

      // 5. Create or find shadow user
      const shadowResult = await db.execute(sql`
        INSERT INTO partner_shadow_users (partner_id, hashed_key, broker_id)
        VALUES (${partner.id}, ${hashed_key}, ${broker_id})
        ON CONFLICT (hashed_key, broker_id) DO UPDATE SET last_seen = NOW()
        RETURNING id
      `);
      const shadowUserId = (shadowResult.rows as any[])[0].id;

      // 6. Generate session token
      const crypto = require("crypto");
      const sessionToken = "nst_" + crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await db.execute(sql`
        INSERT INTO partner_sessions (token, shadow_user_id, partner_id, product, expires_at)
        VALUES (${sessionToken}, ${shadowUserId}, ${partner.id}, ${product}, ${expiresAt})
      `);

      // 7. Build embed URL based on product
      const embedUrls: Record<string, string> = {
        alphamarket: "https://alphamarket.co.in/embed?token=" + sessionToken,
        alphalens: "https://stocks.alphamarket.co.in/embed?token=" + sessionToken,
        alphalab: "https://testalpha.in/embed?token=" + sessionToken,
      };

      console.log("[OAuth] Session created for partner=" + partner.partner_name + " broker=" + broker_id + " product=" + product);

      res.json({
        status: "success",
        session_token: sessionToken,
        embed_url: embedUrls[product],
        expires_in: 86400,
      });
    } catch (err: any) {
      console.error("[OAuth] Session error:", err.message);
      res.status(500).json({ status: "error", message: "Internal server error" });
    }
  });

  // POST /api/oauth/noren/grant-access — Grant strategy access (broker-managed billing)
  app.post("/api/oauth/noren/grant-access", async (req: any, res: any) => {
    try {
      const { partner_key, hashed_key, broker_id, strategy_ids, valid_until, signature } = req.body;
      if (!partner_key || !hashed_key || !broker_id || !strategy_ids || !Array.isArray(strategy_ids)) {
        return res.status(400).json({ status: "error", message: "Missing required fields" });
      }

      // Validate partner
      const partnerResult = await db.execute(sql`SELECT id, partner_secret, is_active FROM partner_configs WHERE partner_key = ${partner_key} LIMIT 1`);
      const partner = (partnerResult.rows as any[])[0];
      if (!partner || !partner.is_active) return res.status(401).json({ status: "error", message: "Invalid or inactive partner" });

      // Verify signature
      if (signature) {
        const crypto = require("crypto");
        const expected = crypto.createHmac("sha256", partner.partner_secret).update(JSON.stringify(req.body)).digest("hex");
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
          return res.status(401).json({ status: "error", message: "Invalid signature" });
        }
      }

      // Find shadow user
      const shadowResult = await db.execute(sql`SELECT id FROM partner_shadow_users WHERE hashed_key = ${hashed_key} AND broker_id = ${broker_id} LIMIT 1`);
      const shadowUser = (shadowResult.rows as any[])[0];
      if (!shadowUser) return res.status(404).json({ status: "error", message: "Shadow user not found. Create a session first." });

      // Grant access for each strategy
      const validUntil = valid_until ? new Date(valid_until) : null;
      let granted = 0;
      for (const strategyId of strategy_ids) {
        await db.execute(sql`
          INSERT INTO partner_access_grants (shadow_user_id, strategy_id, granted_by, valid_until)
          VALUES (${shadowUser.id}, ${strategyId}, ${broker_id}, ${validUntil})
          ON CONFLICT (shadow_user_id, strategy_id) DO UPDATE SET valid_until = ${validUntil}, granted_by = ${broker_id}
        `);
        granted++;
      }

      console.log("[OAuth] Access granted: " + granted + " strategies for broker=" + broker_id);
      res.json({ status: "success", granted, shadow_user_id: shadowUser.id });
    } catch (err: any) {
      console.error("[OAuth] Grant access error:", err.message);
      res.status(500).json({ status: "error", message: "Internal server error" });
    }
  });

  // POST /api/oauth/noren/broker-config — Configure broker product activation
  app.post("/api/oauth/noren/broker-config", async (req: any, res: any) => {
    try {
      const { partner_key, broker_id, broker_name, products_enabled, signature } = req.body;
      if (!partner_key || !broker_id) {
        return res.status(400).json({ status: "error", message: "Missing partner_key and broker_id" });
      }

      const partnerResult = await db.execute(sql`SELECT id, partner_secret, is_active FROM partner_configs WHERE partner_key = ${partner_key} LIMIT 1`);
      const partner = (partnerResult.rows as any[])[0];
      if (!partner || !partner.is_active) return res.status(401).json({ status: "error", message: "Invalid or inactive partner" });

      if (signature) {
        const crypto = require("crypto");
        const expected = crypto.createHmac("sha256", partner.partner_secret).update(JSON.stringify(req.body)).digest("hex");
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
          return res.status(401).json({ status: "error", message: "Invalid signature" });
        }
      }

      const products = products_enabled || ["alphamarket", "alphalab", "alphalens"];
      await db.execute(sql`
        INSERT INTO partner_broker_configs (partner_id, broker_id, broker_name, products_enabled)
        VALUES (${partner.id}, ${broker_id}, ${broker_name || broker_id}, ${products})
        ON CONFLICT (partner_id, broker_id) DO UPDATE SET
          broker_name = COALESCE(${broker_name}, partner_broker_configs.broker_name),
          products_enabled = ${products}
      `);

      console.log("[OAuth] Broker configured: " + broker_id + " products=" + products.join(","));
      res.json({ status: "success", broker_id, products_enabled: products });
    } catch (err: any) {
      console.error("[OAuth] Broker config error:", err.message);
      res.status(500).json({ status: "error", message: "Internal server error" });
    }
  });

  // GET /api/oauth/noren/validate — Validate a session token (used by AlphaLens + AlphaLab for cross-domain validation)
  app.get("/api/oauth/noren/validate", async (req: any, res: any) => {
    try {
      const token = req.query.token as string;
      if (!token) return res.status(400).json({ status: "error", message: "Token required" });

      const result = await db.execute(sql`
        SELECT ps.id, ps.product, ps.expires_at, psu.hashed_key, psu.broker_id, pc.partner_name
        FROM partner_sessions ps
        JOIN partner_shadow_users psu ON psu.id = ps.shadow_user_id
        JOIN partner_configs pc ON pc.id = ps.partner_id
        WHERE ps.token = ${token} AND ps.expires_at > NOW()
        LIMIT 1
      `);
      const session = (result.rows as any[])[0];
      if (!session) return res.status(401).json({ status: "error", message: "Invalid or expired token" });

      res.json({
        status: "success",
        valid: true,
        product: session.product,
        partner: session.partner_name,
        broker_id: session.broker_id,
        hashed_key: session.hashed_key,
        expires_at: session.expires_at,
      });
    } catch (err: any) {
      res.status(500).json({ status: "error", message: "Internal server error" });
    }
  });

  // GET /embed — Serve the app without top navigation (for iFrame/WebView embedding)
  app.get("/embed", async (req: any, res: any) => {
    try {
      const token = req.query.token as string;
      if (!token) return res.status(401).send("Missing token");

      // Validate token
      const result = await db.execute(sql`
        SELECT ps.id, ps.product, ps.expires_at, psu.id as shadow_user_id, psu.hashed_key, psu.broker_id
        FROM partner_sessions ps
        JOIN partner_shadow_users psu ON psu.id = ps.shadow_user_id
        WHERE ps.token = ${token} AND ps.expires_at > NOW()
        LIMIT 1
      `);
      const session = (result.rows as any[])[0];
      if (!session) return res.status(401).send("Invalid or expired token");

      // Update last seen
      await db.execute(sql`UPDATE partner_shadow_users SET last_seen = NOW() WHERE id = ${session.shadow_user_id}`);

      // Redirect to real SPA route with embed flag
      return res.redirect("/dashboard/strategies?embed=true&token=" + token);

      // Serve the SPA with embed mode flag (fallback)
      const indexPath = require("path").resolve(__dirname, "public", "index.html");
      let html = require("fs").readFileSync(indexPath, "utf-8");

      // Inject embed mode script before </head> — hides navigation
      const embedScript = '<script>window.__EMBED_MODE__=true;window.__EMBED_TOKEN__="' + token + '";window.__EMBED_PRODUCT__="' + session.product + '";</script>';
      html = html.replace("</head>", embedScript + "</head>");

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (err: any) {
      console.error("[OAuth] Embed error:", err.message);
      res.status(500).send("Internal server error");
    }
  });


  app.get("/api/broker-docs", (_req: any, res: any) => {
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>AlphaMarket Broker Integration API</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" /><style>body{margin:0;background:#fafafa}.swagger-ui .topbar{display:none}.swagger-ui .info hgroup.main h2{font-size:14px;color:#666}</style></head><body><div id="swagger-ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"><\/script><script>SwaggerUIBundle({url:"/api/broker-spec.json",dom_id:"#swagger-ui",deepLinking:true,layout:"BaseLayout",defaultModelsExpandDepth:2,docExpansion:"list"});<\/script></body></html>`);
  });

  // ═══ BROKER INTEGRATION v2 (Pull + Webhook Push) ═══
  app.get("/api/broker-spec-v2.json", (_req: any, res: any) => { try { const s = require("fs").readFileSync(require("path").join(__dirname, "public", "broker-swagger-v2.json"), "utf-8"); res.type("json").send(s); } catch { res.json({}); } });
  app.get("/api/broker-guide-v2", (_req: any, res: any) => { try { res.sendFile(require("path").join(__dirname, "public", "broker-guide-v2.html")); } catch { res.status(404).send("Not found"); } });
  app.get("/api/broker-docs-v2", (_req: any, res: any) => {
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>AlphaMarket Broker Integration API v2</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" /><style>body{margin:0;background:#fafafa}.swagger-ui .topbar{display:none}.swagger-ui .info hgroup.main h2{font-size:14px;color:#666}</style></head><body><div id="swagger-ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"><\/script><script>SwaggerUIBundle({url:"/api/broker-spec-v2.json",dom_id:"#swagger-ui",deepLinking:true,layout:"BaseLayout",defaultModelsExpandDepth:2,docExpansion:"list"});<\/script></body></html>`);
  });

  function requireAuth(req: Request, res: Response, next: Function) {
    if (!req.session.userId) {
      return res.status(401).send("Not authenticated");
    }
    next();
  }

  async function requireAdmin(req: Request, res: Response, next: Function) {
    if (!req.session.userId) {
      return res.status(401).send("Not authenticated");
    }
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "admin") {
      return res.status(403).send("Admin access required");
    }
    next();
  }

  async function requireAdvisor(req: Request, res: Response, next: Function) {
    if (!req.session.userId) {
      return res.status(401).send("Not authenticated");
    }
    const user = await storage.getUser(req.session.userId);
    if (!user || user.role !== "advisor") {
      return res.status(403).send("Advisor access required");
    }
    next();
  }

  app.get("/sitemap.xml", async (_req, res) => {
    try {
      const baseUrl = process.env.SITE_DOMAIN
        ? `https://${process.env.SITE_DOMAIN}`
        : "https://alphamarket.co.in";

      const strategies = await storage.getPublishedStrategies();
      const advisors = await storage.getAdvisors();

      const staticPages = [
        { loc: "/", priority: "1.0", changefreq: "daily" },
        { loc: "/strategies", priority: "0.9", changefreq: "daily" },
        { loc: "/advisors", priority: "0.9", changefreq: "daily" },
        { loc: "/market-outlook", priority: "0.8", changefreq: "daily" },
        { loc: "/learn", priority: "0.8", changefreq: "weekly" },
        { loc: "/login", priority: "0.5", changefreq: "monthly" },
        { loc: "/register", priority: "0.5", changefreq: "monthly" },
        { loc: "/terms-and-conditions", priority: "0.3", changefreq: "yearly" },
        { loc: "/cancellation-policy", priority: "0.3", changefreq: "yearly" },
        { loc: "/privacy-policy", priority: "0.3", changefreq: "yearly" },
        { loc: "/legal-agreement", priority: "0.3", changefreq: "yearly" },
        { loc: "/shipping-and-delivery", priority: "0.3", changefreq: "yearly" },
        { loc: "/contact-us", priority: "0.4", changefreq: "monthly" },
      ];

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

      for (const page of staticPages) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}${page.loc}</loc>\n`;
        xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
        xml += `    <priority>${page.priority}</priority>\n`;
        xml += `  </url>\n`;
      }

      for (const strategy of strategies) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/strategies/${strategy.id}</loc>\n`;
        xml += `    <changefreq>daily</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `  </url>\n`;
      }

      for (const advisor of advisors) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/advisors/${advisor.id}</loc>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `  </url>\n`;
      }

      xml += `</urlset>`;

      res.set("Content-Type", "application/xml");
      res.send(xml);
    } catch (err: any) {
      res.status(500).send("Error generating sitemap");
    }
  });

  // Advisor public routes (only approved advisors)
  app.get("/api/advisors", async (_req, res) => {
    try {
      const advisors = await storage.getAdvisors();
      const result = [];
      for (const a of advisors) {
        const strats = await storage.getStrategies(a.id);
        const liveStrategies = strats.filter((s) => s.status === "Published").length;
        const { password: _, ...safe } = a;
        result.push({ ...safe, liveStrategies });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/advisors/:id", async (req, res) => {
    try {
      const advisor = await storage.getAdvisorWithDetails(req.params.id);
      if (!advisor) return res.status(404).send("Not found");
      const { password: _, ...safe } = advisor;
      res.json(safe);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/content/public/:type", async (req, res) => {
    try {
      const items = await storage.getPublicContentByType(req.params.type);
      res.json(items);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/content/:id", async (req, res) => {
    try {
      const item = await storage.getContentById(req.params.id);
      if (!item) return res.status(404).send("Content not found");
      res.json(item);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/strategies/:id/positions", async (req, res) => {
    try {
      const allPositions = await storage.getPositions(req.params.id);
      const publishedPositions = allPositions.filter((p: any) => p.publishMode === "live" || p.isPublished);
      const userId = req.session?.userId;

      if (userId) {
        const currentUser = await storage.getUser(userId);
        if (currentUser?.role === "admin" || currentUser?.role === "advisor") {
          return res.json(publishedPositions);
        }
        const sub = await storage.getUserSubscriptionForStrategy(userId, req.params.id);
        if (sub) return res.json(publishedPositions);
      }

      const closedOnly = publishedPositions.filter((p: any) => p.status === "Closed");
      res.json(closedOnly);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/live-call-counts", async (_req, res) => {
    try {
      const strats = await storage.getPublishedStrategies();
      const counts: Record<string, number> = {
        "Intraday": 0,
        "F&O": 0,
        "Swing": 0,
        "Positional": 0,
        "Multi Leg": 0,
        "Commodities": 0,
        "Basket": 0,
      };
      for (const s of strats) {
        const activeCalls = await storage.getCalls(s.id);
        const activePositions = await storage.getPositions(s.id);
        const activeCallCount = activeCalls.filter((c: any) => c.status === "Active").length;
        const activePosCount = activePositions.filter((p: any) => p.status === "Active").length;
        const activeCount = activeCallCount + activePosCount;
        const horizon = (s.horizon || "").toLowerCase();
        const type = s.type;

        if (horizon.includes("intraday")) counts["Intraday"] += activeCount;
        if (type === "Future" || type === "Option" || type === "Index") counts["F&O"] += activeCount;
        if (horizon.includes("swing")) counts["Swing"] += activeCount;
        if (horizon.includes("positional") || horizon.includes("long term") || horizon.includes("short term")) counts["Positional"] += activeCount;
        if (type === "Commodity" || type === "CommodityFuture") counts["Commodities"] += activeCount;
        if (type === "Basket") counts["Basket"] += activeCount;
      }
      res.json(counts);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Strategy public routes
  app.get("/api/strategies/public", async (_req, res) => {
    try {
      const strats = await storage.getPublishedStrategies();
      res.json(strats);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/strategies/:id", async (req, res) => {
    try {
      const s = await storage.getStrategy(req.params.id);
      if (!s) return res.status(404).send("Not found");
      res.json(s);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/strategies/:id/performance", requireAuth, async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy) return res.status(404).send("Strategy not found");

      const allCalls = await storage.getCalls(req.params.id);
      const allPositions = await storage.getPositions(req.params.id);

      const closedCalls = allCalls.filter((c: any) => c.status === "Closed");
      const closedPositions = allPositions.filter((p: any) => p.status === "Closed");

      interface ClosedEntry {
        type: "call" | "position";
        id: string;
        label: string;
        gainPercent: number;
        entryPrice: number;
        exitPrice: number;
        exitDate: Date | null;
        createdAt: Date | null;
      }

      const entries: ClosedEntry[] = [
        ...closedCalls.map((c: any) => ({
          type: "call" as const,
          id: c.id,
          label: c.stockName,
          gainPercent: Number(c.gainPercent || 0),
          entryPrice: Number(c.entryPrice || c.buyRangeStart || 0),
          exitPrice: Number(c.sellPrice || 0),
          exitDate: c.exitDate ? new Date(c.exitDate) : null,
          createdAt: c.createdAt ? new Date(c.createdAt) : null,
        })),
        ...closedPositions.map((p: any) => ({
          type: "position" as const,
          id: p.id,
          label: `${p.symbol || ""}${p.expiry ? " " + p.expiry : ""}${p.strikePrice ? " " + p.strikePrice : ""}${p.callPut ? " " + p.callPut : ""}`.trim(),
          gainPercent: Number(p.gainPercent || 0),
          entryPrice: Number(p.entryPrice || 0),
          exitPrice: Number(p.exitPrice || 0),
          exitDate: p.exitDate ? new Date(p.exitDate) : null,
          createdAt: p.createdAt ? new Date(p.createdAt) : null,
        })),
      ];

      const closedCount = entries.length;
      const profitableCount = entries.filter((e) => e.gainPercent > 0).length;
      const lossCount = entries.filter((e) => e.gainPercent < 0).length;
      const hitRate = closedCount > 0 ? Math.round((profitableCount / closedCount) * 10000) / 100 : 0;
      const absoluteReturn = entries.reduce((sum, e) => sum + e.gainPercent, 0);
      const avgReturn = closedCount > 0 ? Math.round((absoluteReturn / closedCount) * 100) / 100 : 0;

      const profitableEntries = entries.filter((e) => e.gainPercent > 0);
      const lossEntries = entries.filter((e) => e.gainPercent < 0);
      const maxProfitEntry = profitableEntries.length > 0 ? profitableEntries.reduce((best, e) => e.gainPercent > best.gainPercent ? e : best, profitableEntries[0]) : null;
      const maxDrawdownEntry = lossEntries.length > 0 ? lossEntries.reduce((worst, e) => e.gainPercent < worst.gainPercent ? e : worst, lossEntries[0]) : null;

      const now = new Date();
      const periodDefs = [
        { label: "1W", days: 7 },
        { label: "1M", days: 30 },
        { label: "3M", days: 90 },
        { label: "6M", days: 180 },
        { label: "1Y", days: 365 },
        { label: "3Y", days: 1095 },
        { label: "Max", days: 99999 },
      ];

      const periods = periodDefs.map(({ label, days }) => {
        const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        const filtered = entries.filter((e) => {
          const d = e.exitDate || e.createdAt;
          return d && d >= cutoff;
        });
        const count = filtered.length;
        const profitable = filtered.filter((e) => e.gainPercent > 0).length;
        const totalReturn = filtered.reduce((s, e) => s + e.gainPercent, 0);
        return {
          label,
          closedCount: count,
          profitableCount: profitable,
          hitRate: count > 0 ? Math.round((profitable / count) * 10000) / 100 : 0,
          absoluteReturn: Math.round(totalReturn * 100) / 100,
          avgReturn: count > 0 ? Math.round((totalReturn / count) * 100) / 100 : 0,
        };
      });

      const strategyType = strategy.type;
      const isHitRateStrategy = ["Option", "Future", "CommodityFuture"].includes(strategyType) ||
        (strategy.horizon && ["Intraday"].includes(strategy.horizon));

      res.json({
        strategyId: req.params.id,
        strategyType,
        isHitRateStrategy,
        totals: {
          closedCount,
          profitableCount,
          lossCount,
          hitRate,
          absoluteReturn: Math.round(absoluteReturn * 100) / 100,
          avgReturn,
        },
        periods,
        maxProfit: maxProfitEntry ? {
          type: maxProfitEntry.type,
          id: maxProfitEntry.id,
          label: maxProfitEntry.label,
          gainPercent: maxProfitEntry.gainPercent,
          exitDate: maxProfitEntry.exitDate,
        } : null,
        maxDrawdown: maxDrawdownEntry ? {
          type: maxDrawdownEntry.type,
          id: maxDrawdownEntry.id,
          label: maxDrawdownEntry.label,
          gainPercent: maxDrawdownEntry.gainPercent,
          exitDate: maxDrawdownEntry.exitDate,
        } : null,
      });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/symbols/search", async (req, res) => {
    try {
      const q = ((req.query.q as string) || "").toLowerCase().trim();
      const segment = (req.query.segment as string) || "";
      if (!q || q.length < 1) return res.json([]);
      
      // MCX Commodity symbols
      if (segment === "Commodity") {
        try {
          const dRes = await fetch("http://localhost:8001/api/commodity/search/" + encodeURIComponent(q), { signal: AbortSignal.timeout(5000) });
          if (dRes.ok) {
            const d = await dRes.json();
            const matches = Object.entries(d.matches || {}).map(([sym, info]: [string, any]) => ({
              symbol: sym, name: info.name, exchange: "MCX", segment: "Commodity",
              isFnO: true, lot_size: info.lot_size, unit: info.unit,
            }));
            return res.json(matches.slice(0, 20));
          }
        } catch {}
        return res.json([]);
      }

      // Sensex 30 stocks available on BSE
      const sensex30 = ["RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","ITC","SBIN","BHARTIARTL","KOTAKBANK","LT","AXISBANK","ASIANPAINT","MARUTI","BAJFINANCE","TITAN","SUNPHARMA","HCLTECH","WIPRO","ULTRACEMCO","NESTLEIND","TECHM","M&M","TATAMOTORS","POWERGRID","NTPC","INDUSINDBK","BAJAJFINSV","ADANIPORTS","JSWSTEEL"];
      // Create BSE-tagged versions of NSE symbols for Sensex stocks
      const bseSymbols = nseSymbols
        .filter((s: any) => sensex30.includes(s.symbol))
        .map((s: any) => ({ ...s, exchange: "BSE", segment: s.segment, displayName: s.name + " (BSE)" }));
      const allSymbols = [...nseSymbols, ...bseSymbols];
      let filtered = allSymbols.filter((s: any) => {
        const matchesQuery = s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || (s.displayName || "").toLowerCase().includes(q);
        if (!matchesQuery) return false;
        if (segment === "Equity") return s.segment === "Equity";
        if (segment === "FnO") return s.isFnO === true;
        if (segment === "Commodity") return s.segment === "Commodity";
        if (segment === "Index") return s.segment === "Index";
        return true;
      });
      // Sort: exact match first, then symbol prefix, then name prefix, then rest
      filtered.sort((a: any, b: any) => {
        const aSymL = a.symbol.toLowerCase(), bSymL = b.symbol.toLowerCase();
        const aNameL = a.name.toLowerCase(), bNameL = b.name.toLowerCase();
        const aExact = aSymL === q ? 0 : 1, bExact = bSymL === q ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        const aPrefix = aSymL.startsWith(q) ? 0 : 1, bPrefix = bSymL.startsWith(q) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        const aNamePfx = aNameL.startsWith(q) ? 0 : 1, bNamePfx = bNameL.startsWith(q) ? 0 : 1;
        if (aNamePfx !== bNamePfx) return aNamePfx - bNamePfx;
        return aSymL.localeCompare(bSymL);
      });
      res.json(filtered.slice(0, 20));
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/option-chain/expiries", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "NIFTY";
      const exchange = (req.query.exchange as string) || "NSE";
      // Route ALL expiries through DYOR Kite API (primary, reliable)
      const isMCX = exchange === "MCX";
      const kiteUrl = isMCX
        ? `http://localhost:8001/api/commodity/options/${encodeURIComponent(symbol.toUpperCase())}`
        : `http://localhost:8001/api/nfo/option-chain/${encodeURIComponent(symbol)}`;
      try {
        const kiteRes = await fetch(kiteUrl, {
          headers: { "x-shared-secret": "alphamarket-shared-2026" },
          signal: AbortSignal.timeout(10000)
        });
        if (kiteRes.ok) {
          const kd = await kiteRes.json();
          const expiries = kd.expiries || [];
          if (expiries.length > 0) return res.json(expiries);
        }
      } catch (e) { console.error("[Kite expiries]", e); }
      // Fallback to Groww only if Kite fails
      const now = new Date();
      const year = parseInt(req.query.year as string) || now.getFullYear();
      const month = parseInt(req.query.month as string) || (now.getMonth() + 1);
      const expiries = await getOptionChainExpiries(exchange, symbol, year, month);
      res.json(expiries);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/option-chain", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "NIFTY";
      const exchange = (req.query.exchange as string) || "NSE";
      const expiry = req.query.expiry as string;
      if (!expiry) return res.status(400).send("expiry query parameter is required");
      // MCX commodities: use DYOR Kite API
      if (exchange === "MCX") {
        try {
          const dRes = await fetch("http://localhost:8001/api/commodity/options/" + encodeURIComponent(symbol.toUpperCase()) + "?expiry=" + encodeURIComponent(expiry), { signal: AbortSignal.timeout(15000) });
          if (dRes.ok) {
            const d = await dRes.json();
            const chain = (d.chain || []).map((s: any) => ({
              strikePrice: s.strike,
              ce: s.ce_symbol ? { symbol: s.ce_symbol, ltp: s.ce_ltp || 0 } : null,
              pe: s.pe_symbol ? { symbol: s.pe_symbol, ltp: s.pe_ltp || 0 } : null,
            }));
            return res.json(chain);
          }
        } catch(e) { console.error("[MCX chain]", e); }
        return res.json([]);
      }
      // Kite primary for all option chains (NSE/NFO)
      try {
        const kiteChainRes = await fetch(`http://localhost:8001/api/nfo/option-chain/${encodeURIComponent(symbol)}?expiry=${encodeURIComponent(expiry)}`, {
          headers: { "x-shared-secret": "alphamarket-shared-2026" },
          signal: AbortSignal.timeout(10000)
        });
        if (kiteChainRes.ok) {
          const kcd = await kiteChainRes.json();
          if (kcd.chain && kcd.chain.length > 0) {
            const mapped = kcd.chain.map((s: any) => ({
              strikePrice: s.strike || s.strikePrice,
              ce: (s.ce_symbol || s.ce) ? { ltp: s.ce_ltp || s.ce?.ltp || 0, change: 0, oi: s.ce_oi || 0, volume: s.ce_volume || 0, tradingSymbol: s.ce_symbol || s.ce?.tradingSymbol || "" } : undefined,
              pe: (s.pe_symbol || s.pe) ? { ltp: s.pe_ltp || s.pe?.ltp || 0, change: 0, oi: s.pe_oi || 0, volume: s.pe_volume || 0, tradingSymbol: s.pe_symbol || s.pe?.tradingSymbol || "" } : undefined,
            }));
            return res.json(mapped);
          }
        }
      } catch (kErr: any) { console.error("[Kite chain direct]", kErr.message); }
      // Fallback to Groww
      const chain = await getOptionChain(exchange, symbol, expiry);
      res.json(chain);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/strategies/:id/calls", async (req, res) => {
    try {
      const allCalls = await storage.getCalls(req.params.id);
      const publishedCalls = allCalls.filter((c: any) => c.publishMode === "live" || c.isPublished);
      const userId = req.session?.userId;

      if (userId) {
        const currentUser = await storage.getUser(userId);
        if (currentUser?.role === "admin" || currentUser?.role === "advisor") {
          return res.json(publishedCalls);
        }
        const sub = await storage.getUserSubscriptionForStrategy(userId, req.params.id);
        if (sub) return res.json(publishedCalls);
      }

      const closedOnly = publishedCalls.filter((c: any) => c.status === "Closed");
      res.json(closedOnly);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/strategies/:id/plans", async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy) return res.status(404).send("Strategy not found");
      const advisorPlans = await storage.getPlans(strategy.advisorId);
      if (strategy.planIds && strategy.planIds.length > 0) {
        const filtered = advisorPlans.filter((p: Plan) => strategy.planIds.includes(p.id));
        return res.json(filtered.length > 0 ? filtered : advisorPlans);
      }
      res.json(advisorPlans);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Subscribe to strategy
  app.post("/api/strategies/:id/subscribe", requireAuth, async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy) return res.status(404).send("Strategy not found");
      const { planId } = req.body || {};
      const advisorPlans = await storage.getPlans(strategy.advisorId);
      const strategyPlanIds = strategy.planIds && strategy.planIds.length > 0 ? strategy.planIds : advisorPlans.map((p: Plan) => p.id);
      let plan;
      if (planId) {
        plan = advisorPlans.find((p: Plan) => p.id === planId);
        if (plan && !strategyPlanIds.includes(plan.id)) {
          return res.status(400).send("Selected plan is not available for this strategy");
        }
      }
      if (!plan) {
        const availablePlans = advisorPlans.filter((p: Plan) => strategyPlanIds.includes(p.id));
        plan = availablePlans[0] || advisorPlans[0];
      }
      if (!plan) return res.status(400).send("No plans available");
      const sub = await storage.createSubscription({
        planId: plan.id,
        strategyId: strategy.id,
        userId: req.session.userId!,
        advisorId: strategy.advisorId,
        status: "active",
        ekycDone: false,
        riskProfiling: false,
      });
      res.json(sub);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // ==================== Payment Routes (Cashfree) ====================

  app.post("/api/payments/create-order", requireAuth, async (req, res) => {
    try {
      const { strategyId, planId } = req.body;
      if (!strategyId || !planId) return res.status(400).send("strategyId and planId are required");

      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) return res.status(404).send("Strategy not found");

      const advisorPlans = await storage.getPlans(strategy.advisorId);
      const plan = advisorPlans.find((p: Plan) => p.id === planId);
      if (!plan) return res.status(404).send("Plan not found");

      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).send("User not found");

      const signedAgreement = await storage.getEsignAgreementByUserAndStrategy(user.id, strategyId, planId);
      if (!signedAgreement || signedAgreement.status !== "signed") {
        return res.status(400).send("You must sign the Investment Advisory Services Agreement before proceeding to payment.");
      }

      const orderId = `AM_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const amount = Number(plan.amount);
      const verifyToken = generateVerifyToken(orderId, user.id);

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const returnUrl = `${baseUrl}/payment-callback?order_id=${orderId}&vt=${verifyToken}`;

      const cfOrder = await createCashfreeOrder({
        orderId,
        amount,
        customerName: user.companyName || user.username,
        customerEmail: user.email,
        customerPhone: user.phone || "9999999999",
        customerId: user.id,
        returnUrl,
      });

      const payment = await storage.createPayment({
        orderId,
        userId: user.id,
        strategyId: strategy.id,
        planId: plan.id,
        advisorId: strategy.advisorId,
        amount: amount.toString(),
        currency: "INR",
        status: "PENDING",
        cfOrderId: cfOrder.cf_order_id?.toString() || null,
        paymentSessionId: cfOrder.payment_session_id || null,
        paymentMethod: null,
        cfPaymentId: null,
        subscriptionId: null,
        paidAt: null,
      });

      res.json({
        orderId,
        paymentSessionId: cfOrder.payment_session_id,
        cfOrderId: cfOrder.cf_order_id,
        paymentId: payment.id,
        verifyToken,
      });
    } catch (err: any) {
      console.error("Cashfree create order error:", err?.response?.data || err.message);
      res.status(500).json({ error: err?.response?.data?.message || err.message });
    }
  });

  app.post("/api/payments/verify", async (req, res) => {
    try {
      const { orderId, verifyToken } = req.body;
      if (!orderId) return res.status(400).send("orderId is required");

      const payment = await storage.getPaymentByOrderId(orderId);
      if (!payment) {
        console.error("Payment verify: order not found in DB:", orderId);
        return res.status(404).send("Payment not found");
      }

      const isSessionOwner = req.session.userId === payment.userId;
      const isTokenValid = verifyToken && validateVerifyToken(verifyToken, orderId, payment.userId);

      if (!isSessionOwner && !isTokenValid) {
        console.error("Payment verify: unauthorized - no valid session or token for order:", orderId);
        return res.status(403).send("Not authorized to verify this payment");
      }

      if (payment.status === "PAID" && payment.subscriptionId) {
        return res.json({ success: true, orderStatus: "PAID", subscriptionId: payment.subscriptionId });
      }

      console.log(`Payment verify: checking Cashfree for order ${orderId}, current status: ${payment.status}`);
      const cfOrder = await fetchCashfreeOrder(orderId);
      const orderStatus = cfOrder.order_status;
      console.log(`Payment verify: Cashfree order status for ${orderId}: ${orderStatus}`);

      if (orderStatus === "PAID" && payment.status !== "PAID") {
        let paymentMethod: string | null = null;
        let cfPaymentId: string | null = null;
        try {
          const cfPayments = await fetchCashfreePayments(orderId);
          if (cfPayments && cfPayments.length > 0) {
            const successPayment = cfPayments.find((p: any) => p.payment_status === "SUCCESS");
            if (successPayment) {
              paymentMethod = successPayment.payment_group || null;
              cfPaymentId = successPayment.cf_payment_id?.toString() || null;
            }
          }
        } catch (payErr: any) {
          console.error("Payment verify: error fetching CF payments:", payErr?.message);
        }

        const freshPayment = await storage.getPaymentByOrderId(orderId);
        if (freshPayment && freshPayment.subscriptionId) {
          return res.json({ success: true, orderStatus: "PAID", subscriptionId: freshPayment.subscriptionId });
        }

        await storage.updatePayment(payment.id, {
          status: "PAID",
          paymentMethod,
          cfPaymentId,
          paidAt: new Date(),
        });

        const sub = await storage.createSubscription({
          planId: payment.planId!,
          strategyId: payment.strategyId!,
          userId: payment.userId,
          advisorId: payment.advisorId!,
          status: "active",
          ekycDone: false,
          riskProfiling: false,
        });

        await storage.updatePayment(payment.id, { subscriptionId: sub.id });

        const esignAgreement = await storage.getEsignAgreementByUserAndStrategy(
          payment.userId, payment.strategyId!, payment.planId!
        );
        if (esignAgreement) {
          await storage.updateEsignAgreement(esignAgreement.id, { subscriptionId: sub.id });
        }

        console.log(`Payment verify: subscription created for order ${orderId}, sub: ${sub.id}`);

        res.json({ success: true, orderStatus: "PAID", subscriptionId: sub.id });
      } else if (orderStatus === "PAID") {
        res.json({ success: true, orderStatus: "PAID", subscriptionId: payment.subscriptionId });
      } else {
        await storage.updatePayment(payment.id, { status: orderStatus });
        res.json({ success: false, orderStatus });
      }
    } catch (err: any) {
      console.error("Cashfree verify error:", err?.response?.data || err.message, err?.stack);
      res.status(500).json({ error: "Payment verification failed. Please contact support." });
    }
  });

  app.post("/api/webhooks/cashfree", async (req: any, res) => {
    try {
      const signature = req.headers["x-webhook-signature"] as string;
      const timestamp = req.headers["x-webhook-timestamp"] as string;

      if (!signature || !timestamp) {
        console.error("Cashfree webhook: missing signature or timestamp headers");
        return res.status(400).send("Missing webhook signature");
      }

      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      const valid = verifyCashfreeWebhook(signature, rawBody, timestamp);
      if (!valid) {
        console.error("Cashfree webhook: invalid signature");
        return res.status(400).send("Invalid webhook signature");
      }

      const webhookData = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const eventType = webhookData?.type;
      const orderData = webhookData?.data?.order;
      const paymentData = webhookData?.data?.payment;

      if (eventType === "PAYMENT_SUCCESS_WEBHOOK" || eventType === "ORDER_PAID") {
        const orderId = orderData?.order_id;
        if (orderId) {
          const payment = await storage.getPaymentByOrderId(orderId);
          if (payment && payment.status !== "PAID" && !payment.subscriptionId) {
            await storage.updatePayment(payment.id, {
              status: "PAID",
              paymentMethod: paymentData?.payment_group || null,
              cfPaymentId: paymentData?.cf_payment_id?.toString() || null,
              paidAt: new Date(),
            });

            const freshPayment = await storage.getPaymentByOrderId(orderId);
            if (freshPayment && !freshPayment.subscriptionId) {
              const sub = await storage.createSubscription({
                planId: payment.planId!,
                strategyId: payment.strategyId!,
                userId: payment.userId,
                advisorId: payment.advisorId!,
                status: "active",
                ekycDone: false,
                riskProfiling: false,
              });

              await storage.updatePayment(payment.id, { subscriptionId: sub.id });

              const esignAg = await storage.getEsignAgreementByUserAndStrategy(
                payment.userId, payment.strategyId!, payment.planId!
              );
              if (esignAg) {
                await storage.updateEsignAgreement(esignAg.id, { subscriptionId: sub.id });
              }
            }
          }
        }
      }

      res.status(200).send("OK");
    } catch (err: any) {
      console.error("Cashfree webhook error:", err.message);
      res.status(200).send("OK");
    }
  });

  app.get("/api/payments/history", requireAuth, async (req, res) => {
    try {
      const payments = await storage.getPaymentsByUser(req.session.userId!);
      res.json(payments);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/advisor/payments", requireAdvisor, async (req, res) => {
    try {
      const payments = await storage.getPaymentsByAdvisor(req.session.userId!);
      const enriched = await Promise.all(payments.map(async (p: any) => {
        const user = await storage.getUser(p.userId);
        const strategy = p.strategyId ? await storage.getStrategy(p.strategyId) : null;
        const plan = p.planId ? await storage.getPlan(p.planId) : null;
        return {
          ...p,
          customerName: user?.companyName || user?.username || "Unknown",
          customerEmail: user?.email || "",
          strategyName: strategy?.name || "",
          planName: plan?.name || "",
          pmlaDone: sub.pmlaDone || false,
        };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // ==================== End Payment Routes ====================

  app.get("/api/live-price/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const strategyType = req.query.strategyType as string | undefined;
      const exchange = req.query.exchange as string | undefined;
      const quote = await getLiveQuote(symbol, strategyType, exchange);
      if (!quote) return res.status(404).json({ error: "Price not available" });
      res.json(quote);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/live-prices/bulk", async (req, res) => {
    try {
      const { symbols } = req.body;
      if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ error: "symbols array required" });
      }
      const items = symbols.map((s: any) => ({
        symbol: typeof s === "string" ? s : s.symbol,
        strategyType: typeof s === "string" ? undefined : s.strategyType,
      }));
      const prices = await getLivePrices(items);
      res.json(prices);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor dashboard routes (require advisor role)
  app.get("/api/advisor/strategies", requireAdvisor, async (req, res) => {
    try {
      const strats = await storage.getStrategies(req.session.userId!);
      const enriched = await Promise.all(strats.map(async (s) => {
        const calls = await storage.getCallsByStrategy(s.id);
        const positions = await storage.getPositionsByStrategy(s.id);
        const activeCalls = calls.filter(c => c.status === "Active");
        const activePositions = positions.filter(p => p.status === "Active");
        return {
          ...s,
          activeCalls: activeCalls.length,
          activePositions: activePositions.length,
          activeCallDetails: activeCalls.filter(c => c.isPublished),
          activePositionDetails: activePositions.filter(p => p.isPublished),
        };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/strategies", requireAdvisor, async (req, res) => {
    try {
      const numericFields = ["minimumInvestment", "cagr", "riskLevel"];
      const body = { ...req.body };
      for (const f of numericFields) {
        if (body[f] === "" || body[f] === null) delete body[f];
      }
      const s = await storage.createStrategy({
        ...body,
        advisorId: req.session.userId,
      });
      res.json(s);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.patch("/api/strategies/:id", requireAdvisor, async (req, res) => {
    try {
      const existing = await storage.getStrategy(req.params.id);
      if (!existing) return res.status(404).send("Strategy not found");
      if (existing.advisorId !== req.session.userId) return res.status(403).send("Not authorized");
      const body = { ...req.body };
      for (const f of ["minimumInvestment", "cagr", "riskLevel"]) {
        if (body[f] === "" || body[f] === null) delete body[f];
      }
      const s = await storage.updateStrategy(req.params.id, body);
      res.json(s);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.delete("/api/strategies/:id", requireAdvisor, async (req, res) => {
    try {
      const existing = await storage.getStrategy(req.params.id);
      if (!existing) return res.status(404).send("Strategy not found");
      if (existing.advisorId !== req.session.userId) return res.status(403).send("Not authorized");
      await storage.deleteStrategy(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/strategies/:id/basket/close-all", requireAdvisor, async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy || strategy.advisorId !== req.session.userId) return res.status(403).send("Not authorized");
      const { exitPrice } = req.body;

      const activePositions = await db.select().from(positions)
        .where(and(eq(positions.strategyId, req.params.id), eq(positions.status, "Active")));
      const activeCalls = await db.select().from(calls)
        .where(and(eq(calls.strategyId, req.params.id), eq(calls.status, "Active")));

      const results = { closedPositions: 0, closedCalls: 0 };
      const now = new Date();

      for (const pos of activePositions) {
        const entryPx = Number(pos.entryPrice || 0);
        const exitPx = Number(exitPrice || entryPx);
        const isSell = pos.buySell === "Sell";
        const gainPercent = entryPx > 0 && exitPx > 0
          ? (isSell ? ((entryPx - exitPx) / entryPx) * 100 : ((exitPx - entryPx) / entryPx) * 100).toFixed(2)
          : null;
        await storage.updatePosition(pos.id, {
          status: "Closed", exitPrice: String(exitPx), exitDate: now, gainPercent,
        });
        if (pos.isPublished) {
          const closedPos = { ...pos, exitPrice: String(exitPx), gainPercent, status: "Closed", exitDate: now };
          fireWebhookEvent("POSITION_CLOSED", buildPositionEventData(closedPos, strategy), strategy.advisorId)
            .catch((err: any) => console.error("[routes basket/close-all] POSITION_CLOSED webhook failed:", err));
        }
        results.closedPositions++;
      }

      for (const call of activeCalls) {
        const entryPx = Number(call.entryPrice || call.buyRangeStart || 0);
        const exitPx = Number(exitPrice || entryPx);
        const gainPercent = entryPx > 0 && exitPx > 0
          ? (((exitPx - entryPx) / entryPx) * 100).toFixed(2) : null;
        await storage.updateCall(call.id, {
          status: "Closed", sellPrice: String(exitPx), exitDate: now, gainPercent: gainPercent || "0",
        });
        if (call.isPublished) {
          const closedCall = { ...call, sellPrice: String(exitPx), gainPercent: gainPercent || "0", status: "Closed", exitDate: now };
          fireWebhookEvent("CALL_CLOSED", buildCallEventData(closedCall, strategy), strategy.advisorId)
            .catch((err: any) => console.error("[routes basket/close-all] CALL_CLOSED webhook failed:", err));
        }
        results.closedCalls++;
      }

      const subPayload = { strategyName: strategy.name, message: "Basket has been closed by advisor", exitPrice: exitPrice || "market" };
      notifyStrategySubscribers(req.params.id, strategy.name, "basket_closed", subPayload);

      res.json({ success: true, ...results });
    } catch (err: any) { res.status(500).send(err.message); }
  });

  app.get("/api/strategies/:id/basket/rebalances", async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy || strategy.type !== "Basket") return res.status(404).send("Basket strategy not found");
      const rebalances = await storage.getBasketRebalances(req.params.id);
      res.json(rebalances);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/strategies/:id/basket/constituents", async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy || strategy.type !== "Basket") return res.status(404).send("Basket strategy not found");

      if (!req.session.userId) return res.status(401).send("Login required");
      const userId = req.session.userId;
      const requestUser = await storage.getUser(userId);
      const isAdvisorOrAdmin = requestUser && (requestUser.role === "advisor" || requestUser.role === "admin");
      if (!isAdvisorOrAdmin) {
        const subscriptions = await storage.getSubscriptionsByUser(userId);
        const isSubscribed = subscriptions.some(s => s.strategyId === req.params.id && s.status === "active");
        if (!isSubscribed) return res.status(403).send("Subscription required to view current basket composition");
      }

      const rebalanceId = req.query.rebalanceId as string;
      let constituents;
      if (rebalanceId && rebalanceId !== "latest") {
        constituents = await storage.getBasketConstituents(rebalanceId);
      } else {
        constituents = await storage.getBasketConstituentsByStrategy(req.params.id);
      }
      res.json(constituents);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/strategies/:id/basket/past-recommendations", async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy || strategy.type !== "Basket") return res.status(404).send("Basket strategy not found");

      if (!req.session.userId) return res.status(401).send("Login required to view past recommendations");

      const rebalances = await storage.getBasketRebalances(req.params.id);
      if (rebalances.length < 2) return res.json([]);

      const latestRebalance = rebalances[0];
      const currentConstituents = await storage.getBasketConstituents(latestRebalance.id);
      const currentSymbols = new Set(currentConstituents.map(c => c.symbol));

      const allConstituents = await storage.getAllBasketConstituents(req.params.id);

      const rebalanceMap = new Map<string, BasketRebalance>();
      for (const r of rebalances) rebalanceMap.set(r.id, r);

      const pastMap = new Map<string, any>();
      for (const c of allConstituents) {
        if (currentSymbols.has(c.symbol)) continue;
        if (c.rebalanceId === latestRebalance.id) continue;
        if (!pastMap.has(c.symbol)) {
          const rebalance = rebalanceMap.get(c.rebalanceId);
          pastMap.set(c.symbol, {
            symbol: c.symbol,
            exchange: c.exchange,
            weightPercent: c.weightPercent,
            quantity: c.quantity,
            priceAtRebalance: c.priceAtRebalance,
            action: c.action,
            rebalanceVersion: rebalance?.version || null,
            removedDate: latestRebalance.effectiveDate,
            addedDate: rebalance?.effectiveDate || null,
          });
        }
      }

      res.json(Array.from(pastMap.values()));
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/strategies/:id/basket/rebalance", requireAdvisor, async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy) return res.status(404).send("Strategy not found");
      if (strategy.advisorId !== req.session.userId) return res.status(403).send("Not authorized");
      if (strategy.type !== "Basket") return res.status(400).send("Strategy is not a Basket type");

      const { constituents, notes } = req.body;
      if (!constituents || !Array.isArray(constituents) || constituents.length === 0) {
        return res.status(400).send("At least one constituent is required");
      }

      const totalWeight = constituents.reduce((sum: number, c: any) => sum + Number(c.weightPercent || 0), 0);
      if (Math.abs(totalWeight - 100) > 0.5) {
        return res.status(400).send(`Weights must sum to 100%. Current total: ${totalWeight.toFixed(1)}%`);
      }

      const existing = await storage.getBasketRebalances(req.params.id);
      const version = existing.length > 0 ? existing[0].version + 1 : 1;

      const rebalance = await storage.createBasketRebalance({
        strategyId: req.params.id,
        version,
        notes: notes || null,
        effectiveDate: new Date(),
      });

      const constituentData = constituents.map((c: any) => ({
        strategyId: req.params.id,
        rebalanceId: rebalance.id,
        symbol: c.symbol,
        exchange: c.exchange || "NSE",
        weightPercent: String(c.weightPercent),
        quantity: c.quantity || null,
        priceAtRebalance: c.priceAtRebalance ? String(c.priceAtRebalance) : null,
        action: c.action || "Buy",
      }));

      const createdConstituents = await storage.createBasketConstituents(constituentData);

      if (version === 1) {
        await storage.createBasketNavSnapshot({
          strategyId: req.params.id,
          asOfDate: new Date(),
          nav: "100",
          totalReturn: "0",
          dailyReturn: "0",
        });
      }

      res.json({ rebalance, constituents: createdConstituents });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/strategies/:id/basket/rationales", async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy || strategy.type !== "Basket") return res.status(404).send("Basket strategy not found");
      const rationales = await storage.getBasketRationales(req.params.id);
      res.json(rationales);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/strategies/:id/basket/rationale", requireAdvisor, async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy) return res.status(404).send("Strategy not found");
      if (strategy.advisorId !== req.session.userId) return res.status(403).send("Not authorized");
      if (strategy.type !== "Basket") return res.status(400).send("Strategy is not a Basket type");

      const { title, body, category, attachments } = req.body;
      if (!title || !title.trim()) return res.status(400).send("Title is required");

      const rationale = await storage.createBasketRationale({
        strategyId: req.params.id,
        title: title.trim(),
        body: body || null,
        category: category || "general",
        attachments: attachments || null,
      });

      res.json(rationale);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.delete("/api/strategies/:id/basket/rationale/:rationaleId", requireAdvisor, async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy) return res.status(404).send("Strategy not found");
      if (strategy.advisorId !== req.session.userId) return res.status(403).send("Not authorized");
      await storage.deleteBasketRationale(req.params.rationaleId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/strategies/:id/basket/performance", async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy || strategy.type !== "Basket") return res.status(404).send("Basket strategy not found");

      const navSnapshots = await storage.getBasketNavSnapshots(req.params.id);
      const constituents = await storage.getBasketConstituentsByStrategy(req.params.id);
      const rebalances = await storage.getBasketRebalances(req.params.id);

      const latestNav = navSnapshots.length > 0 ? navSnapshots[navSnapshots.length - 1] : null;

      res.json({
        strategyId: req.params.id,
        currentNav: latestNav ? Number(latestNav.nav) : 100,
        totalReturn: latestNav ? Number(latestNav.totalReturn || 0) : 0,
        navHistory: navSnapshots.map((s) => ({
          date: s.asOfDate,
          nav: Number(s.nav),
          totalReturn: Number(s.totalReturn || 0),
          dailyReturn: Number(s.dailyReturn || 0),
        })),
        constituents: constituents.map((c) => ({
          symbol: c.symbol,
          exchange: c.exchange,
          weightPercent: Number(c.weightPercent),
          quantity: c.quantity,
          priceAtRebalance: c.priceAtRebalance ? Number(c.priceAtRebalance) : null,
          action: c.action,
        })),
        rebalanceCount: rebalances.length,
        lastRebalanceDate: rebalances.length > 0 ? rebalances[0].effectiveDate : null,
      });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/strategies/:id/calls", requireAdvisor, async (req, res) => {
    try {
      const validModes = ["draft", "watchlist", "live"];
      const publishMode = req.body.publishMode || (req.body.isPublished ? "live" : "draft");
      if (!validModes.includes(publishMode)) {
        return res.status(400).send("Invalid publishMode. Must be draft, watchlist, or live");
      }
      const isPublished = publishMode === "live";
      if (isPublished && (!req.body.rationale || !req.body.rationale.trim())) {
        return res.status(400).send("Rationale is required to publish a call");
      }
      const c = await storage.createCall({
        ...sanitizeBody(req.body),
        strategyId: req.params.id,
        publishMode,
        isPublished,
        trailingSlEnabled: req.body.trailingSlEnabled || false,
        trailingSlType: req.body.trailingSlType || "PERCENTAGE",
        trailingSlValue: req.body.trailingSlValue || null,});
      if (isPublished) {
        const strategy = await storage.getStrategy(req.params.id);
        if (strategy) {
          const subPayload = buildNewCallSubscriberNotification(c, strategy.name);
          notifyStrategySubscribers(req.params.id, strategy.name, "new_call", subPayload);
          const wlPayload = buildNewCallWatchlistNotification(c, strategy.name);
          notifyWatchlistUsers(req.params.id, strategy.name, "new_call_masked", wlPayload);
          fireWebhookEvent("CALL_CREATED", buildCallEventData(c, strategy), strategy.advisorId).catch((err: any) => console.error("[routes 1221 bulk CREATE] fireWebhookEvent failed:", err));
        }
      }
      res.json(c);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/strategies/:id/positions", requireAdvisor, async (req, res) => {
    try {
      const validModes = ["draft", "watchlist", "live"];
      const publishMode = req.body.publishMode || "draft";
      if (!validModes.includes(publishMode)) {
        return res.status(400).send("Invalid publishMode. Must be draft, watchlist, or live");
      }
      const isPublished = publishMode === "live" || publishMode === "watchlist";
      if (isPublished && (!req.body.rationale || !req.body.rationale.trim())) {
        return res.status(400).send("Rationale is required to publish a position");
      }
      // ── Auto-correct segment if advisor selected wrong one ──
      const body = req.body;
      let segment = body.segment || "";
      if (segment === "Equity" && body.strikePrice && body.callPut && body.expiry) {
        // Has strike + callPut + expiry = this is an option, not equity
        segment = "Option";
        body.segment = "Option";
        console.log("[routes] Auto-corrected segment from Equity to Option for", body.symbol, body.strikePrice, body.callPut);
      }
      const isFnOPosition = segment === "Option" || segment === "Future" || segment === "Index" ||
        !!(body.strikePrice && body.callPut);
      if (isFnOPosition && isPublished && body.entryPrice) {
        const entryPx = Number(body.entryPrice);
        const targetPx = Number(body.target || 0);
        const slPx = Number(body.stopLoss || 0);
        const strikePx = Number(body.strikePrice || 0);

        // Option premiums are almost always < strike price (except deep ITM)
        if (segment === "Option" && strikePx > 0 && entryPx > strikePx) {
          return res.status(400).send(
            `Entry price (₹${entryPx}) is higher than strike price (₹${strikePx}). ` +
            `For options, entry price should be the premium amount (typically ₹1-₹2000), not the stock price. ` +
            `Please correct and try again.`
          );
        }

        // Option premiums rarely exceed ₹5000 (even deep ITM NIFTY)
        if ((segment === "Option" || segment === "Index") && entryPx > 5000 && strikePx > 0) {
          return res.status(400).send(
            `Entry price (₹${entryPx}) seems too high for an option premium. ` +
            `Did you enter the stock price instead of the option premium? Please verify and try again.`
          );
        }

        // BUY with SL above entry = wrong direction (futures/equity only)
        if (slPx > 0 && entryPx > 0 && segment !== "Option" && segment !== "Index") {
          const action = (body.buySell || body.buy_sell || "Buy").toLowerCase();
          if (action === "buy" && slPx > entryPx) {
            return res.status(400).send(
              "Stop-loss (" + slPx + ") is above entry price (" + entryPx + ") for a BUY position. " +
              "For BUY, stop-loss should be below entry price."
            );
          }
          if (action === "sell" && slPx < entryPx) {
            return res.status(400).send(
              "Stop-loss (" + slPx + ") is below entry price (" + entryPx + ") for a SELL position. " +
              "For SELL, stop-loss should be above entry price."
            );
          }
        }

        // SL absurdly far from entry (more than 80% away) — likely a typo
        if (slPx > 0 && entryPx > 0) {
          const slDistance = Math.abs(slPx - entryPx) / entryPx;
          if (slDistance > 0.8) {
            return res.status(400).send(
              "Stop-loss (" + slPx + ") is " + Math.round(slDistance * 100) + "% away from entry (" + entryPx + "). " +
              "This looks like a typo. Please verify and re-submit."
            );
          }
        }

        // BUY: target should be > entry, SL < entry
        const isSell = (body.buySell || "Buy") === "Sell";
        if (!isSell && targetPx > 0 && slPx > 0) {
          if (targetPx < entryPx && slPx > entryPx) {
            return res.status(400).send(
              `For a BUY position: Target (₹${targetPx}) should be above Entry (₹${entryPx}) ` +
              `and Stop Loss (₹${slPx}) should be below Entry. Values appear swapped.`
            );
          }
        }
        // SELL: target should be < entry, SL > entry
        if (isSell && targetPx > 0 && slPx > 0) {
          if (targetPx > entryPx && slPx < entryPx) {
            return res.status(400).send(
              `For a SELL position: Target (₹${targetPx}) should be below Entry (₹${entryPx}) ` +
              `and Stop Loss (₹${slPx}) should be above Entry. Values appear swapped.`
            );
          }
        }
      }

      const p = await storage.createPosition({
        ...sanitizeBody(req.body),
        strategyId: req.params.id,
        publishMode,
        isPublished,
      });
      if (isPublished) {
        const strategy = await storage.getStrategy(req.params.id);
        if (strategy) {
          const subPayload = buildNewPositionSubscriberNotification(p, strategy.name);
          notifyStrategySubscribers(req.params.id, strategy.name, "new_position", subPayload);
          const wlPayload = buildNewPositionWatchlistNotification(p, strategy.name);
          notifyWatchlistUsers(req.params.id, strategy.name, "new_position_masked", wlPayload);
          fireWebhookEvent("POSITION_CREATED", buildPositionEventData(p, strategy), strategy.advisorId).catch((err: any) => console.error("[routes 1255 bulk POSITION] fireWebhookEvent failed:", err));
        }
      }
      res.json(p);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // ── Multi-Leg Position Creation (added 20 May 2026) ──
  app.post("/api/strategies/:id/positions/multi-leg", requireAdvisor, async (req, res) => {
    try {
      const { legs, rationale, publishMode, duration, durationUnit, theme, enableLeg, legName } = req.body;
      if (!legs || !Array.isArray(legs) || legs.length < 2) {
        return res.status(400).send("Multi-leg requires at least 2 legs");
      }
      const validModes = ["draft", "watchlist", "live"];
      const mode = publishMode || "draft";
      if (!validModes.includes(mode)) return res.status(400).send("Invalid publishMode");
      const isPublished = mode === "live" || mode === "watchlist";
      if (isPublished && (!rationale || !rationale.trim())) {
        return res.status(400).send("Rationale is required to publish");
      }

      const { randomUUID } = await import("crypto");
      const legGroupId = randomUUID();
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }

      // ── Entry Price Sanity Check for Multi-Leg ──
      for (let v = 0; v < legs.length; v++) {
        const vleg = legs[v];
        const vSegment = vleg.segment || "";
        const vIsFnO = vSegment === "Option" || vSegment === "Future" || vSegment === "Index" ||
          !!(vleg.strikePrice && vleg.callPut);
        if (vIsFnO && isPublished && vleg.entryPrice) {
          const vEntry = Number(vleg.entryPrice);
          const vStrike = Number(vleg.strikePrice || 0);
          if (vSegment === "Option" && vStrike > 0 && vEntry > vStrike) {
            return res.status(400).send(
              `Leg ${v + 1}: Entry price (₹${vEntry}) is higher than strike price (₹${vStrike}). ` +
              `For options, entry price should be the premium, not the stock price.`
            );
          }
          if ((vSegment === "Option" || vSegment === "Index") && vEntry > 5000 && vStrike > 0) {
            return res.status(400).send(
              `Leg ${v + 1}: Entry price (₹${vEntry}) seems too high for an option premium. Please verify.`
            );
          }
        }
      }

      const created: any[] = [];
      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        const p = await storage.createPosition({
          ...sanitizeBody(leg),
          strategyId: req.params.id,
          publishMode: mode,
          isPublished,
          enableLeg: true,
          legGroupId,
          legName: leg.legName || legName || `Leg ${i + 1}`,
          rationale,
          duration: duration ? parseInt(duration) : undefined,
          durationUnit: duration ? durationUnit : undefined,
          theme: theme || undefined,
        });
        created.push(p);

        if (isPublished) {
          const subPayload = buildNewPositionSubscriberNotification(p, strategy.name);
          notifyStrategySubscribers(req.params.id, strategy.name, "new_position", subPayload);
          const wlPayload = buildNewPositionWatchlistNotification(p, strategy.name);
          notifyWatchlistUsers(req.params.id, strategy.name, "new_position_masked", wlPayload);
        }
      }

      // Fire ONE combined webhook for all legs (not per-leg)
      if (isPublished && created.length > 0) {
        const allLegsData = created.map(p => buildPositionEventData(p, strategy));
        const combinedData = {
          ...allLegsData[0],
          multiLeg: true,
          legGroupId,
          allLegs: allLegsData,
        };
        fireWebhookEvent("POSITION_CREATED", combinedData, strategy.advisorId)
          .catch((err: any) => console.error("[routes multi-leg] fireWebhookEvent failed:", err));
      }

      console.log(`[MultiLeg] Created ${created.length} legs with group ${legGroupId}`);
      res.json({ legGroupId, legs: created });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // ── Close All Legs in a Group (added 20 May 2026) ──
  app.post("/api/positions/close-group/:legGroupId", requireAdvisor, async (req, res) => {
    try {
      const { legGroupId } = req.params;
      const exitPrice = req.body.exitPrice || null;
      
      // Find all active positions in this leg group
      const allPositions = await db.select().from(positions).where(
        sql`leg_group_id = ${legGroupId} AND status = 'Active'`
      );
      
      if (!allPositions.length) return res.status(404).send("No active positions in this leg group");
      
      // Verify ownership
      const strategy = await storage.getStrategy(allPositions[0].strategyId);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }

      const closed: any[] = [];
      for (const pos of allPositions) {
        const entryPx = Number(pos.entryPrice || 0);
        const legExitPrice = req.body.legExitPrices?.[pos.id] || exitPrice || null;
        const exitPx = Number(legExitPrice || entryPx || 0);
        let gainPercent: string | null = null;
        if (entryPx > 0 && exitPx > 0) {
          const isSell = pos.buySell === "Sell";
          gainPercent = (isSell ? ((entryPx - exitPx) / entryPx) * 100 : ((exitPx - entryPx) / entryPx) * 100).toFixed(2);
        }
        const updated = await storage.updatePosition(pos.id, {
          status: "Closed",
          exitPrice: String(exitPx),
          exitDate: new Date(),
          gainPercent: gainPercent,
        });
        closed.push(updated);

        if (pos.isPublished) {
          const subPayload = buildPositionClosedSubscriberNotification(pos, exitPx, gainPercent || "0", strategy.name);
          notifyStrategySubscribers(pos.strategyId, strategy.name, "position_closed", subPayload);
          const wlPayload = buildPositionClosedWatchlistNotification(pos, gainPercent || "0", strategy.name);
          notifyWatchlistUsers(pos.strategyId, strategy.name, "position_closed_masked", wlPayload);

          // Fire webhook for broker integrations (Upstox, Dreamstreet, etc.)
          const closedPos = { ...pos, exitPrice: String(exitPx), gainPercent, status: "Closed", exitDate: new Date() };
          fireWebhookEvent("POSITION_CLOSED", buildPositionEventData(closedPos, strategy), strategy.advisorId)
            .catch((err: any) => console.error("[routes close-group] fireWebhookEvent POSITION_CLOSED failed:", err));
        }
      }
      console.log(`[MultiLeg] Closed ${closed.length} legs in group ${legGroupId}`);
      res.json({ legGroupId, closed });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/advisor/strategies/:id/calls", requireAdvisor, async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id as string);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }
      const c = await storage.getCalls(req.params.id as string);
      res.json(c);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/advisor/strategies/:id/positions", requireAdvisor, async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id as string);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }
      const p = await storage.getPositions(req.params.id as string);
      res.json(p);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.patch("/api/calls/:id", requireAdvisor, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id as string);
      if (!call) return res.status(404).send("Call not found");
      const strategy = await storage.getStrategy(call.strategyId);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }
      if (call.status !== "Active") {
        return res.status(400).send("Can only edit active calls");
      }
      const { targetPrice, stopLoss, rationale, rationaleAttachment } = req.body;
      const updateData: any = {};
      if (targetPrice !== undefined) updateData.targetPrice = targetPrice;
      if (stopLoss !== undefined) updateData.stopLoss = stopLoss;
      if (rationale !== undefined) updateData.rationale = rationale;
      if (rationaleAttachment !== undefined) updateData.rationaleAttachment = rationaleAttachment;
      const updated = await storage.updateCall(call.id, updateData);
      if (call.isPublished && (targetPrice !== undefined || stopLoss !== undefined)) {
        const changes: string[] = [];
        if (stopLoss !== undefined && stopLoss !== call.stopLoss) changes.push(`Stop Loss: ₹${stopLoss}`);
        if (targetPrice !== undefined && targetPrice !== call.targetPrice) changes.push(`Target: ₹${targetPrice}`);
        if (changes.length > 0) {
          const updatePayload = buildCallUpdateSubscriberNotification(call, changes, strategy.name);
          notifyStrategySubscribers(call.strategyId, strategy.name, "call_update", updatePayload);
        }
        // Fire CALL_MODIFIED webhook to all brokers (Upstox, Dreamstreet, etc.)
        fireWebhookEvent('CALL_MODIFIED', buildCallEventData(updated || call, strategy), strategy.advisorId)
          .catch((err: any) => console.error('[routes PATCH /calls/:id] CALL_MODIFIED webhook failed:', err));
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/calls/:id/close", requireAdvisor, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id as string);
      if (!call) return res.status(404).send("Call not found");
      const strategy = await storage.getStrategy(call.strategyId);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }
      if (call.status !== "Active") {
        return res.status(400).send("Call is already closed");
      }
      const { sellPrice, reason, closeAtMarket } = req.body || {};
      const entryPrice = Number(call.entryPrice || call.buyRangeStart || 0);
      const exitPrice = sellPrice ? Number(sellPrice) : entryPrice;
      const isSellAction = call.action === "Sell";
      const gainPercent = entryPrice > 0
        ? (isSellAction
            ? (((entryPrice - exitPrice) / entryPrice) * 100).toFixed(2)
            : (((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2))
        : "0";
      const updated = await storage.updateCall(call.id, {
        status: "Closed",
        sellPrice: String(exitPrice),
        gainPercent,
        exitDate: new Date(),
      });
      if (call.isPublished) {
        const subPayload = buildCallClosedSubscriberNotification(call, exitPrice, gainPercent, reason, strategy.name);
        notifyStrategySubscribers(call.strategyId, strategy.name, "call_closed", subPayload);
        const wlPayload = buildCallClosedWatchlistNotification(call, gainPercent, strategy.name);
        notifyWatchlistUsers(call.strategyId, strategy.name, "call_closed_masked", wlPayload);

        // Fire broker events for XTS/Upstox/Dreamstreet (mirrors CREATE pattern at line ~1416)
        const closedCall = { ...call, sellPrice: String(exitPrice), gainPercent, status: "Closed", exitDate: new Date() };
        fireWebhookEvent("CALL_CLOSED", buildCallEventData(closedCall, strategy), strategy.advisorId)
          .catch((err: any) => console.error("[routes /close] fireWebhookEvent failed:", err));
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.patch("/api/calls/:id/exit", requireAdvisor, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id as string);
      if (!call) return res.status(404).send("Call not found");
      const strategy = await storage.getStrategy(call.strategyId);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }
      if (call.status !== "Closed") {
        return res.status(400).send("Can only update exit data on closed calls");
      }
      const { exitPrice } = req.body;
      if (!exitPrice || Number(exitPrice) <= 0) {
        return res.status(400).send("Valid exit price is required");
      }
      const entryPx = Number(call.entryPrice || call.buyRangeStart || 0);
      const exitPx = Number(exitPrice);
      let gainPercent: string | null = null;
      if (entryPx > 0 && exitPx > 0) {
        const isSell = call.action === "Sell";
        gainPercent = (isSell ? ((entryPx - exitPx) / entryPx) * 100 : ((exitPx - entryPx) / entryPx) * 100).toFixed(2);
      }
      const updated = await storage.updateCall(call.id, {
        sellPrice: String(exitPx),
        gainPercent,
        exitDate: call.exitDate || new Date(),
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/calls/:id/publish", requireAdvisor, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id as string);
      if (!call) return res.status(404).send("Call not found");
      const strategy = await storage.getStrategy(call.strategyId);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }
      if (call.status !== "Active") {
        return res.status(400).send("Can only publish active calls");
      }
      if (!call.rationale || !call.rationale.trim()) {
        return res.status(400).send("Rationale is required to publish a call");
      }
      const updated = await storage.updateCall(call.id, {
        publishMode: "live",
        isPublished: true,
      });
      const subPayload = buildNewCallSubscriberNotification(call, strategy.name);
      notifyStrategySubscribers(call.strategyId, strategy.name, "new_call", subPayload);
      const wlPayload = buildNewCallWatchlistNotification(call, strategy.name);
      notifyWatchlistUsers(call.strategyId, strategy.name, "new_call_masked", wlPayload);
      fireWebhookEvent("CALL_CREATED", buildCallEventData(call, strategy), strategy.advisorId).catch((err: any) => console.error("[routes /publish CALL] fireWebhookEvent failed:", err));
      res.json(updated);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/positions/:id/publish", requireAdvisor, async (req, res) => {
    try {
      const pos = await storage.getPosition(req.params.id as string);
      if (!pos) return res.status(404).send("Position not found");
      const strategy = await storage.getStrategy(pos.strategyId);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }
      if (pos.status !== "Active") {
        return res.status(400).send("Can only publish active positions");
      }
      if (!pos.rationale || !pos.rationale.trim()) {
        return res.status(400).send("Rationale is required to publish a position");
      }
      const updated = await storage.updatePosition(pos.id, {
        publishMode: "live",
        isPublished: true,
      });
      const subPayload = buildNewPositionSubscriberNotification(pos, strategy.name);
      notifyStrategySubscribers(pos.strategyId, strategy.name, "new_position", subPayload);
      const wlPayload = buildNewPositionWatchlistNotification(pos, strategy.name);
      notifyWatchlistUsers(pos.strategyId, strategy.name, "new_position_masked", wlPayload);
      fireWebhookEvent("POSITION_CREATED", buildPositionEventData(pos, strategy), strategy.advisorId).catch((err: any) => console.error("[routes /publish POSITION] fireWebhookEvent failed:", err));
      res.json(updated);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.patch("/api/positions/:id", requireAdvisor, async (req, res) => {
    try {
      const pos = await storage.getPosition(req.params.id as string);
      if (!pos) return res.status(404).send("Position not found");
      const strategy = await storage.getStrategy(pos.strategyId);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }
      if (pos.status !== "Active") {
        return res.status(400).send("Can only edit active positions");
      }
      const { target, stopLoss, rationale } = req.body;
      const updated = await storage.updatePosition(pos.id, {
        ...(target !== undefined ? { target } : {}),
        ...(stopLoss !== undefined ? { stopLoss } : {}),
        ...(rationale !== undefined ? { rationale } : {}),
      });
      if (pos.isPublished && (target !== undefined || stopLoss !== undefined)) {
        const changes: string[] = [];
        if (stopLoss !== undefined && stopLoss !== pos.stopLoss) changes.push(`Stop Loss: ₹${stopLoss}`);
        if (target !== undefined && target !== pos.target) changes.push(`Target: ₹${target}`);
        if (changes.length > 0) {
          const updatePayload = buildPositionUpdateSubscriberNotification(pos, changes, strategy.name);
          notifyStrategySubscribers(pos.strategyId, strategy.name, "position_update", updatePayload);
        }
        // Fire POSITION_MODIFIED webhook to all brokers
        fireWebhookEvent('POSITION_MODIFIED', buildPositionEventData(updated || pos, strategy), strategy.advisorId)
          .catch((err: any) => console.error('[routes PATCH /positions/:id] POSITION_MODIFIED webhook failed:', err));
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/positions/:id/close", requireAdvisor, async (req, res) => {
    try {
      const pos = await storage.getPosition(req.params.id as string);
      if (!pos) return res.status(404).send("Position not found");
      const strategy = await storage.getStrategy(pos.strategyId);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }
      if (pos.status !== "Active") {
        return res.status(400).send("Position is already closed");
      }
      const exitPrice = req.body.exitPrice || req.body.sellPrice || null;
      const entryPx = Number(pos.entryPrice || 0);
      const exitPx = Number(exitPrice || entryPx || 0);
      let gainPercent: string | null = null;
      if (entryPx > 0 && exitPx > 0) {
        const isSell = pos.buySell === "Sell";
        gainPercent = (isSell ? ((entryPx - exitPx) / entryPx) * 100 : ((exitPx - entryPx) / entryPx) * 100).toFixed(2);
      }

      // Partial close: reduce lots on original, create closed record for exited portion
      const totalLots = Number(pos.lots || 1);
      const lotsToClose = req.body.lotsToClose ? Number(req.body.lotsToClose) : totalLots;
      const isPartial = lotsToClose > 0 && lotsToClose < totalLots;

      if (isPartial) {
        await storage.updatePosition(pos.id, { lots: String(totalLots - lotsToClose) });
        const { id: _id, createdAt: _c, updatedAt: _u, ...posData } = pos as any;
        await db.insert(positions).values({
          ...posData,
          lots: String(lotsToClose),
          status: "Closed",
          exitPrice: String(exitPx),
          exitDate: new Date(),
          gainPercent: gainPercent,
          isPublished: false,
          rationale: `Partial close of ${lotsToClose} lot(s) (original position: ${pos.id})`,
        });
        return res.json({ partial: true, closedLots: lotsToClose, remainingLots: totalLots - lotsToClose });
      }

      const updated = await storage.updatePosition(pos.id, {
        status: "Closed",
        exitPrice: String(exitPx),
        exitDate: new Date(),
        gainPercent: gainPercent,
      });
      if (pos.isPublished) {
        const subPayload = buildPositionClosedSubscriberNotification(pos, exitPx, gainPercent || "0", strategy.name);
        notifyStrategySubscribers(pos.strategyId, strategy.name, "position_closed", subPayload);
        const wlPayload = buildPositionClosedWatchlistNotification(pos, gainPercent || "0", strategy.name);
        notifyWatchlistUsers(pos.strategyId, strategy.name, "position_closed_masked", wlPayload);

        // Fire webhook for broker integrations (Upstox, Dreamstreet, etc.)
        const closedPos = { ...pos, exitPrice: String(exitPx), gainPercent, status: "Closed", exitDate: new Date() };
        fireWebhookEvent("POSITION_CLOSED", buildPositionEventData(closedPos, strategy), strategy.advisorId)
          .catch((err: any) => console.error("[routes /close] fireWebhookEvent POSITION_CLOSED failed:", err));
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.patch("/api/positions/:id/exit", requireAdvisor, async (req, res) => {
    try {
      const pos = await storage.getPosition(req.params.id as string);
      if (!pos) return res.status(404).send("Position not found");
      const strategy = await storage.getStrategy(pos.strategyId);
      if (!strategy || strategy.advisorId !== req.session.userId) {
        return res.status(403).send("Not authorized");
      }
      if (pos.status !== "Closed") {
        return res.status(400).send("Can only update exit data on closed positions");
      }
      const { exitPrice } = req.body;
      if (!exitPrice || Number(exitPrice) <= 0) {
        return res.status(400).send("Valid exit price is required");
      }
      const entryPx = Number(pos.entryPrice || 0);
      const exitPx = Number(exitPrice);
      let gainPercent: string | null = null;
      if (entryPx > 0 && exitPx > 0) {
        const isSell = pos.buySell === "Sell";
        gainPercent = (isSell ? ((entryPx - exitPx) / entryPx) * 100 : ((exitPx - entryPx) / entryPx) * 100).toFixed(2);
      }
      const updated = await storage.updatePosition(pos.id, {
        exitPrice: String(exitPx),
        gainPercent,
        exitDate: pos.exitDate || new Date(),
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/strategies/:id/subscription-status", requireAuth, async (req, res) => {
    try {
      const sub = await storage.getUserSubscriptionForStrategy(req.session.userId!, req.params.id as string);
      if (!sub) return res.json({ subscribed: false });
      const advisor = await storage.getUser(sub.advisorId);
      const requiresRiskProfiling = advisor?.requireRiskProfiling || false;
      const requiresPmla = advisor?.requirePmla || false;
      res.json({
        subscribed: true,
        subscriptionId: sub.id,
        ekycDone: sub.ekycDone || false,
        pmlaDone: sub.pmlaDone || false,
        requiresPmla,
        riskProfilingDone: sub.riskProfiling || false,
        requiresRiskProfiling,
        allComplianceDone: (sub.ekycDone || false) && (!requiresRiskProfiling || (sub.riskProfiling || false)) && (!requiresPmla || (sub.pmlaDone || false)),
      });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Plans
  app.get("/api/advisor/plans", requireAdvisor, async (req, res) => {
    try {
      const p = await storage.getPlans(req.session.userId!);
      res.json(p);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/plans", requireAdvisor, async (req, res) => {
    try {
      const p = await storage.createPlan({
        ...sanitizeBody(req.body),
        advisorId: req.session.userId,
      });
      res.json(p);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.delete("/api/plans/:id", requireAdvisor, async (req, res) => {
    try {
      await storage.deletePlan(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Subscriptions
  app.get("/api/advisor/subscribers", requireAdvisor, async (req, res) => {
    try {
      const subs = await storage.getSubscriptions(req.session.userId!);
      const enriched = await Promise.all(subs.map(async (sub) => {
        const u = await storage.getUser(sub.userId);
        const strategy = sub.strategyId ? await storage.getStrategy(sub.strategyId) : null;
        const plan = sub.planId ? await storage.getPlan(sub.planId) : null;
        return {
          ...sub,
          customerName: u?.companyName || u?.username || "Unknown",
          customerEmail: u?.email || "",
          customerPhone: u?.phone || "",
          strategyName: strategy?.name || "",
          planName: plan?.name || "",
        };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/advisor/subscriptions", requireAdvisor, async (req, res) => {
    try {
      const subs = await storage.getSubscriptions(req.session.userId!);
      res.json(subs);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Content
  app.get("/api/advisor/content", requireAdvisor, async (req, res) => {
    try {
      const c = await storage.getContent(req.session.userId!);
      res.json(c);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/content", requireAdvisor, async (req, res) => {
    try {
      const c = await storage.createContent({
        ...req.body,
        advisorId: req.session.userId,
      });
      res.json(c);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.delete("/api/content/:id", requireAdvisor, async (req, res) => {
    try {
      await storage.deleteContent(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Scores
  app.get("/api/advisor/scores", requireAdvisor, async (req, res) => {
    try {
      const s = await storage.getScores(req.session.userId!);
      res.json(s);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/advisor/scores", requireAdvisor, async (req, res) => {
    try {
      const s = await storage.createScore({
        ...req.body,
        advisorId: req.session.userId,
      });
      res.json(s);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Profile update
  app.patch("/api/advisor/profile", requireAdvisor, async (req, res) => {
    try {
      const u = await storage.updateUser(req.session.userId!, sanitizeBody(req.body));
      const { password: _, ...safe } = u;
      res.json(safe);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Reports download
  app.get("/api/advisor/reports/download", requireAdvisor, async (req, res) => {
    try {
      const type = req.query.type as string;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${type}.csv"`);

      if (type === "Calls Report") {
        const strats = await storage.getStrategies(req.session.userId!);
        let csv = "Strategy,Stock,Action,Entry Price,Entry Date,Entry Time,Target,Stop Loss,Exit Price,Exit Date,Exit Time,Status,Gain %\n";
        for (const s of strats) {
          const callsList = await storage.getCalls(s.id);
          for (const c of callsList) {
            const entryDt = c.createdAt || c.callDate;
            const entryDate = entryDt ? new Date(entryDt).toLocaleDateString("en-IN") : "";
            const entryTime = entryDt ? new Date(entryDt).toLocaleTimeString("en-IN") : "";
            const exitDt = c.exitDate;
            const exitDate = exitDt ? new Date(exitDt).toLocaleDateString("en-IN") : "";
            const exitTime = exitDt ? new Date(exitDt).toLocaleTimeString("en-IN") : "";
            csv += `"${s.name}","${c.stockName}","${c.action}","${c.entryPrice || c.buyRangeStart || ""}","${entryDate}","${entryTime}","${c.targetPrice || ""}","${c.stopLoss || ""}","${c.sellPrice || ""}","${exitDate}","${exitTime}","${c.status}","${c.gainPercent || ""}"\n`;
          }
          const positionsList = await storage.getPositions(s.id);
          for (const p of positionsList) {
            const entryDt = p.createdAt;
            const entryDate = entryDt ? new Date(entryDt).toLocaleDateString("en-IN") : "";
            const entryTime = entryDt ? new Date(entryDt).toLocaleTimeString("en-IN") : "";
            const exitDt = p.exitDate;
            const exitDate = exitDt ? new Date(exitDt).toLocaleDateString("en-IN") : "";
            const exitTime = exitDt ? new Date(exitDt).toLocaleTimeString("en-IN") : "";
            const symbolLabel = `${p.symbol || ""}${p.expiry ? " " + p.expiry : ""}${p.strikePrice ? " " + p.strikePrice : ""}${p.callPut ? " " + p.callPut : ""}`;
            csv += `"${s.name}","${symbolLabel.trim()}","${p.buySell || "Buy"}","${p.entryPrice || ""}","${entryDate}","${entryTime}","${p.target || ""}","${p.stopLoss || ""}","${p.exitPrice || ""}","${exitDate}","${exitTime}","${p.status}","${p.gainPercent || ""}"\n`;
          }
        }
        res.send(csv);
      } else if (type === "Customer Acquisition Report") {
        const subs = await storage.getSubscriptions(req.session.userId!);
        let csv = "Subscriber,Plan,EKYC Done,Risk Profiling,Status,Subscription Date,Subscription Time,Start Date,End Date\n";
        for (const s of subs) {
          const subDt = s.createdAt;
          const subDate = subDt ? new Date(subDt).toLocaleDateString("en-IN") : "";
          const subTime = subDt ? new Date(subDt).toLocaleTimeString("en-IN") : "";
          const startDate = subDt ? new Date(subDt).toLocaleDateString("en-IN") : "";
          const plan = await storage.getPlan(s.planId);
          const durationDays = plan?.durationDays || 30;
          const endDt = subDt ? new Date(new Date(subDt).getTime() + durationDays * 86400000) : null;
          const endDate = endDt ? endDt.toLocaleDateString("en-IN") : "";
          csv += `"${s.userId}","${plan?.name || s.planId}","${s.ekycDone ? "Yes" : "No"}","${s.riskProfiling ? "Yes" : "No"}","${s.status}","${subDate}","${subTime}","${startDate}","${endDate}"\n`;
        }
        res.send(csv);
      } else if (type === "Financial Report") {
        const subs = await storage.getSubscriptions(req.session.userId!);
        const pls = await storage.getPlans(req.session.userId!);
        let csv = "Plan,Code,Amount,Duration Days,Subscriber,Payment Date,Payment Time,Start Date,End Date,Status\n";
        for (const s of subs) {
          const plan = pls.find((p) => p.id === s.planId);
          const subDt = s.createdAt;
          const payDate = subDt ? new Date(subDt).toLocaleDateString("en-IN") : "";
          const payTime = subDt ? new Date(subDt).toLocaleTimeString("en-IN") : "";
          const startDate = subDt ? new Date(subDt).toLocaleDateString("en-IN") : "";
          const durationDays = plan?.durationDays || 30;
          const endDt = subDt ? new Date(new Date(subDt).getTime() + durationDays * 86400000) : null;
          const endDate = endDt ? endDt.toLocaleDateString("en-IN") : "";
          csv += `"${plan?.name || s.planId}","${plan?.code || ""}","${plan?.amount || ""}","${durationDays}","${s.userId}","${payDate}","${payTime}","${startDate}","${endDate}","${s.status}"\n`;
        }
        if (subs.length === 0) {
          for (const p of pls) {
            csv += `"${p.name}","${p.code}","${p.amount}","${p.durationDays || ""}","","","","","",""\n`;
          }
        }
        res.send(csv);
      } else {
        const scrs = await storage.getScores(req.session.userId!);
        let csv = "Beginning,Received,Resolved,Pending,Reasons\n";
        for (const s of scrs) {
          csv += `"${s.beginningOfMonth || 0}","${s.receivedDuring || 0}","${s.resolvedDuring || 0}","${s.pendingAtEnd || 0}","${s.pendencyReasons || ""}"\n`;
        }
        res.send(csv);
      }
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // ========== ADMIN ROUTES ==========

  // Get all users (admin)
  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const safe = allUsers.map(({ password: _, ...u }) => u);
      res.json(safe);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Update user (admin - approve/disapprove/edit)
  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const u = await storage.updateUser(req.params.id, sanitizeBody(req.body));
      const { password: _, ...safe } = u;
      res.json(safe);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Delete user (admin)
  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteUser(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Get all strategies (admin)
  app.get("/api/admin/strategies", requireAdmin, async (_req, res) => {
    try {
      const strats = await storage.getAllStrategies();
      res.json(strats);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Update any strategy (admin)
  app.patch("/api/admin/strategies/:id", requireAdmin, async (req, res) => {
    try {
      const s = await storage.updateStrategy(req.params.id, sanitizeBody(req.body));
      res.json(s);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // Delete any strategy (admin)
  app.delete("/api/admin/strategies/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteStrategy(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/admin/groww-token-status", requireAdmin, async (_req, res) => {
    try {
      const status = getGrowwTokenStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/admin/groww-token", requireAdmin, async (req, res) => {
    try {
      const { token } = req.body;
      if (!token || typeof token !== "string" || token.trim().length < 10) {
        return res.status(400).json({ error: "Please provide a valid access token" });
      }
      const result = setGrowwAccessToken(token.trim());
      res.json(result);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // ==================== Advisor Revenue Route ====================
  app.get("/api/advisor/revenue", requireAdvisor, async (req, res) => {
    try {
      const allPayments = await storage.getPaymentsByAdvisor(req.session.userId!);
      const successfulPayments = allPayments.filter(p => p.status === "PAID");
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const monthlyRevenue = successfulPayments
        .filter(p => p.paidAt && new Date(p.paidAt).getMonth() === currentMonth && new Date(p.paidAt).getFullYear() === currentYear)
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const ytdRevenue = successfulPayments
        .filter(p => p.paidAt && new Date(p.paidAt).getFullYear() === currentYear)
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);
      res.json({ monthlyRevenue, ytdRevenue, totalPayments: successfulPayments.length });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // ==================== Investor Dashboard Routes ====================
  app.get("/api/investor/subscriptions", requireAuth, async (req, res) => {
    try {
      const subs = await storage.getSubscriptionsByUserId(req.session.userId!);
      const enriched = await Promise.all(subs.map(async (sub) => {
        const strategy = sub.strategyId ? await storage.getStrategy(sub.strategyId) : null;
        const plan = sub.planId ? await storage.getPlan(sub.planId) : null;
        const advisor = strategy?.advisorId ? await storage.getUser(strategy.advisorId) : null;
        const requiresRiskProfiling = advisor?.requireRiskProfiling || false;
      const requiresPmla = advisor?.requirePmla || false;
        return {
          ...sub,
          strategyName: strategy?.name || "",
          strategyType: strategy?.type || "",
          strategySegment: strategy?.segment || "",
          strategyCagr: strategy?.cagr || "0",
          strategyHorizon: strategy?.horizon || "",
          strategyRisk: strategy?.riskLevel || "",
          strategyStatus: strategy?.status || "",
          strategyDescription: strategy?.description || "",
          advisorName: advisor?.companyName || advisor?.username || "",
          advisorSebi: advisor?.sebiRegNumber || "",
          planName: plan?.name || "",
          planDuration: plan?.durationDays ? `${plan.durationDays} days` : "",
          planPrice: plan?.amount || "0",
          requiresRiskProfiling,
          requiresPmla,
        };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/investor/recommendations", requireAuth, async (req, res) => {
    try {
      const subs = await storage.getSubscriptionsByUserId(req.session.userId!);
      const activeSubs = subs.filter(s => s.status === "active");
      const allCalls: any[] = [];
      const allPositions: any[] = [];
      for (const sub of activeSubs) {
        if (!sub.strategyId) continue;
        const strategy = await storage.getStrategy(sub.strategyId);
        const advisor = strategy?.advisorId ? await storage.getUser(strategy.advisorId) : null;
        if (advisor?.requireRiskProfiling && !sub.riskProfiling) continue;
        if (advisor?.requirePmla && !sub.pmlaDone) continue;
        const subDate = sub.createdAt ? new Date(sub.createdAt) : new Date(0);
        const strategyCalls = await storage.getCallsByStrategy(sub.strategyId);
        const strategyPositions = await storage.getPositionsByStrategy(sub.strategyId);
        const advisorName = advisor?.companyName || "";
        const strategyType = strategy?.type || "";
        const filteredCalls = strategyCalls.filter(c => {
          const isClosed = c.status === "Closed" || !!c.exitDate;
          const isLive = !c.publishMode || c.publishMode === "live";
          if (!isLive && !isClosed) return false;
          const callDate = c.createdAt ? new Date(c.createdAt) : new Date();
          if (callDate >= subDate) return true;
          if (c.status === "Active" && isLive) return true;
          const exitDate = c.exitDate ? new Date(c.exitDate) : null;
          if (exitDate && exitDate >= subDate) return true;
          if (isClosed) return true;
          return false;
        });
        const filteredPositions = strategyPositions.filter(p => {
          const isClosed = p.status === "Closed" || !!p.exitDate;
          const isLive = !p.publishMode || p.publishMode === "live";
          if (!isLive && !isClosed) return false;
          const posDate = p.createdAt ? new Date(p.createdAt) : new Date();
          if (posDate >= subDate) return true;
          if (p.status === "Active" && isLive) return true;
          const exitDate = p.exitDate ? new Date(p.exitDate) : null;
          if (exitDate && exitDate >= subDate) return true;
          if (isClosed) return true;
          return false;
        });
        for (const c of filteredCalls) {
          allCalls.push({ ...c, strategyName: strategy?.name || "", advisorName, strategyType });
        }
        for (const p of filteredPositions) {
          allPositions.push({ ...p, strategyName: strategy?.name || "", advisorName, strategyType });
        }
      }
      res.json({ calls: allCalls, positions: allPositions });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // ── Watchlist routes ──
  app.get("/api/investor/watchlist", requireAuth, async (req, res) => {
    try {
      const items = await storage.getWatchlistByUser(req.session.userId!);
      const enriched: any[] = [];
      for (const item of items) {
        if (item.itemType === "strategy") {
          const strategy = await storage.getStrategy(item.itemId);
          if (strategy) {
            const activeCalls = await storage.getActiveCallsByStrategy(item.itemId);
            const activePositions = await storage.getActivePositionsByStrategy(item.itemId);
            const newCallsSinceWatch = activeCalls.filter(c => c.publishMode === "live" && c.createdAt && item.createdAt && new Date(c.createdAt) > new Date(item.createdAt)).length;
            const newPosSinceWatch = activePositions.filter(p => p.publishMode === "live" && p.createdAt && item.createdAt && new Date(p.createdAt) > new Date(item.createdAt)).length;
            const { password: _, ...safeAdvisor } = strategy.advisor || {} as any;
            enriched.push({ ...item, strategy: { ...strategy, advisor: safeAdvisor }, newCalls: newCallsSinceWatch + newPosSinceWatch });
          }
        } else if (item.itemType === "advisor") {
          const advisor = await storage.getUser(item.itemId);
          if (advisor) {
            const { password: _, ...safeAdvisor } = advisor;
            enriched.push({ ...item, advisor: safeAdvisor });
          }
        }
      }
      res.json(enriched);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/investor/watchlist", requireAuth, async (req, res) => {
    try {
      const { itemType, itemId } = req.body;
      if (!itemType || !itemId) return res.status(400).send("itemType and itemId required");
      if (!["strategy", "advisor"].includes(itemType)) return res.status(400).send("Invalid itemType");
      const item = await storage.addWatchlistItem({ userId: req.session.userId!, itemType, itemId });
      res.json(item);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.delete("/api/investor/watchlist", requireAuth, async (req, res) => {
    try {
      const { itemType, itemId } = req.body;
      if (!itemType || !itemId) return res.status(400).send("itemType and itemId required");
      await storage.removeWatchlistItem(req.session.userId!, itemType, itemId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/investor/watchlist/check", requireAuth, async (req, res) => {
    try {
      const { itemType, itemId } = req.query;
      if (!itemType || !itemId) return res.status(400).send("itemType and itemId required");
      const result = await storage.isWatchlisted(req.session.userId!, itemType as string, itemId as string);
      res.json({ watchlisted: result });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/investor/watchlist/ids", requireAuth, async (req, res) => {
    try {
      const items = await storage.getWatchlistByUser(req.session.userId!);
      const strategyIds = items.filter(i => i.itemType === "strategy").map(i => i.itemId);
      const advisorIds = items.filter(i => i.itemType === "advisor").map(i => i.itemId);
      res.json({ strategyIds, advisorIds });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // ── Advisor Questions routes ──
  app.post("/api/advisors/:id/questions", async (req, res) => {
    try {
      const advisorId = req.params.id;
      const advisor = await storage.getUser(advisorId);
      if (!advisor || advisor.role !== "advisor") return res.status(404).send("Advisor not found");

      let name: string, email: string, phone: string | undefined;
      const { question } = req.body;
      if (!question || !question.trim()) return res.status(400).send("Question is required");

      if (req.session.userId) {
        const user = await storage.getUser(req.session.userId);
        if (user) {
          name = user.companyName || user.username;
          email = user.email;
          phone = user.phone || undefined;
        } else {
          return res.status(400).send("User not found");
        }
      } else {
        name = req.body.name;
        email = req.body.email;
        phone = req.body.phone;
        if (!name || !email) return res.status(400).send("Name and email are required for guest users");
      }

      const q = await storage.createAdvisorQuestion({
        advisorId,
        userId: req.session.userId || null,
        name,
        email,
        phone: phone || null,
        question: question.trim(),
      });
      res.json(q);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/advisor/questions", requireAdvisor, async (req, res) => {
    try {
      const questions = await storage.getQuestionsByAdvisor(req.session.userId!);
      res.json(questions);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/advisor/questions/unread-count", requireAdvisor, async (req, res) => {
    try {
      const count = await storage.getUnreadQuestionCount(req.session.userId!);
      res.json({ count });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.patch("/api/advisor/questions/:id", requireAdvisor, async (req, res) => {
    try {
      const { answer, isRead } = req.body;
      const data: any = {};
      if (answer !== undefined) {
        data.answer = answer;
        data.answeredAt = new Date();
        data.isRead = true;
      }
      if (isRead !== undefined) data.isRead = isRead;
      const q = await storage.updateAdvisorQuestion(req.params.id, data, req.session.userId!);
      if (!q) return res.status(404).send("Question not found or not yours");
      res.json(q);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // --- Risk Profiling Routes ---

  function computeRiskScores(data: any) {
    let capacityRaw = 0;
    let capacityMax = 0;

    const incomeScores: Record<string, number> = { "below_3l": 1, "3l_10l": 2, "10l_25l": 3, "above_25l": 4 };
    const surplusScores: Record<string, number> = { "below_1l": 1, "1l_5l": 2, "5l_25l": 3, "above_25l": 4 };
    const assetsScores: Record<string, number> = { "below_5l": 1, "5l_25l": 2, "25l_1cr": 3, "above_1cr": 4 };
    const liabilityScores: Record<string, number> = { "none": 4, "below_5l": 3, "5l_25l": 2, "above_25l": 1 };
    const emergencyScores: Record<string, number> = { "below_3m": 0, "3m_6m": 1, "6m_12m": 2, "above_12m": 3 };
    const lossScores: Record<string, number> = { "below_5": 0, "5_15": 1, "15_30": 2, "above_30": 3 };

    capacityRaw += incomeScores[data.annualIncome] || 0; capacityMax += 4;
    capacityRaw += surplusScores[data.investibleSurplus] || 0; capacityMax += 4;
    capacityRaw += assetsScores[data.totalFinancialAssets] || 0; capacityMax += 4;
    capacityRaw += liabilityScores[data.totalLiabilities] || 0; capacityMax += 4;
    capacityRaw += emergencyScores[data.emergencyFund] || 0; capacityMax += 3;
    capacityRaw += lossScores[data.affordableLoss] || 0; capacityMax += 3;

    const horizonScores: Record<string, number> = { "below_1y": 0, "1y_3y": 1, "3y_7y": 2, "7y_15y": 3, "above_15y": 4 };
    capacityRaw += horizonScores[data.timeHorizon] || 0; capacityMax += 4;

    const capacityScore = capacityMax > 0 ? Math.round((capacityRaw / capacityMax) * 100) : 0;

    let toleranceRaw = 0;
    let toleranceMax = 0;

    const knowledgeScores: Record<string, number> = { "none": 0, "basic": 1, "moderate": 2, "advanced": 3 };
    toleranceRaw += knowledgeScores[data.marketKnowledge] || 0; toleranceMax += 3;

    const expInstruments = data.investmentExperience || [];
    let instrScore = 0;
    if (expInstruments.includes("bank_fd")) instrScore = Math.max(instrScore, 1);
    if (expInstruments.includes("equity_mf")) instrScore = Math.max(instrScore, 2);
    if (expInstruments.includes("direct_equity")) instrScore = Math.max(instrScore, 2);
    if (expInstruments.includes("derivatives")) instrScore = Math.max(instrScore, 3);
    if (expInstruments.includes("structured")) instrScore = Math.max(instrScore, 3);
    toleranceRaw += instrScore; toleranceMax += 3;

    const yearsScores: Record<string, number> = { "0": 0, "below_2y": 1, "2y_5y": 2, "above_5y": 3 };
    toleranceRaw += yearsScores[data.yearsOfExperience] || 0; toleranceMax += 3;

    const pastScores: Record<string, number> = { "sold": 0, "held": 1, "bought_more": 2 };
    toleranceRaw += pastScores[data.pastBehavior] || 0; toleranceMax += 2;

    const fallScores: Record<string, number> = { "sell_most": 0, "sell_some": 1, "do_nothing": 2, "buy_more": 3 };
    toleranceRaw += fallScores[data.portfolioFallReaction] || 0; toleranceMax += 3;

    const returnScores: Record<string, number> = { "below_6": 0, "6_10": 1, "10_15": 2, "15_25": 3, "above_25": 4 };
    toleranceRaw += returnScores[data.expectedReturn] || 0; toleranceMax += 4;

    const volComfort = Math.min(Math.max(Number(data.volatilityComfort) || 0, 0), 5);
    toleranceRaw += Math.round(volComfort * 0.8); toleranceMax += 4;

    const stmtScores: Record<string, number> = { "no_loss": 0, "small_fluctuations": 1, "significant_fluctuations": 2, "high_risk": 3 };
    toleranceRaw += stmtScores[data.riskStatement] || 0; toleranceMax += 3;

    const toleranceScore = toleranceMax > 0 ? Math.round((toleranceRaw / toleranceMax) * 100) : 0;

    const overallScore = Math.round(capacityScore * 0.6 + toleranceScore * 0.4);

    let riskCategory = "Conservative";
    if (overallScore >= 85) riskCategory = "Very Aggressive";
    else if (overallScore >= 70) riskCategory = "Aggressive";
    else if (overallScore >= 50) riskCategory = "Moderate";
    else if (overallScore >= 25) riskCategory = "Moderately Conservative";

    return { capacityScore, toleranceScore, overallScore, riskCategory };
  }

  app.patch("/api/advisor/settings/risk-profiling", requireAdvisor, async (req, res) => {
    try {
      const { requireRiskProfiling } = req.body;
      const updated = await storage.updateUser(req.session.userId!, { requireRiskProfiling: !!requireRiskProfiling });
      res.json({ requireRiskProfiling: updated.requireRiskProfiling });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/advisor/settings/risk-profiling", requireAdvisor, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      res.json({ requireRiskProfiling: user?.requireRiskProfiling || false });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/risk-profiles", requireAuth, async (req, res) => {
    try {
      const { subscriptionId, ...profileData } = req.body;
      if (!subscriptionId) return res.status(400).send("subscriptionId required");

      const sub = await storage.getSubscription(subscriptionId);
      if (!sub) return res.status(404).send("Subscription not found");
      if (sub.userId !== req.session.userId!) return res.status(403).send("Not your subscription");

      const existing = await storage.getRiskProfileBySubscription(subscriptionId);
      if (existing) return res.status(400).send("Risk profile already completed for this subscription");

      const scores = computeRiskScores(profileData);

      const riskProfile = await storage.createRiskProfile({
        subscriptionId,
        userId: req.session.userId!,
        advisorId: sub.advisorId,
        ...profileData,
        ...scores,
      });

      await storage.updateSubscription(subscriptionId, { riskProfiling: true });

      res.json(riskProfile);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/risk-profiles/:subscriptionId", requireAuth, async (req, res) => {
    try {
      const rp = await storage.getRiskProfileBySubscription(req.params.subscriptionId);
      if (!rp) return res.status(404).send("Risk profile not found");
      const user = await storage.getUser(req.session.userId!);
      if (rp.userId !== req.session.userId! && rp.advisorId !== req.session.userId! && user?.role !== "admin") {
        return res.status(403).send("Access denied");
      }
      res.json(rp);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  // ─── eKYC Routes ───

  // ==================== eSign Agreement Routes ====================

  app.post("/api/esign/otp", requireAuth, async (req, res) => {
    try {
      const { strategyId, planId, aadhaarNumber } = req.body;
      if (!strategyId || !planId || !aadhaarNumber) return res.status(400).send("strategyId, planId and aadhaarNumber required");
      if (!/^\d{12}$/.test(aadhaarNumber)) return res.status(400).send("Invalid Aadhaar number format");

      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) return res.status(404).send("Strategy not found");

      const result = await sendAadhaarOtp(aadhaarNumber);

      const existing = await storage.getEsignAgreementByUserAndStrategy(req.session.userId!, strategyId, planId);
      if (existing) {
        await storage.updateEsignAgreement(existing.id, {
          status: "otp_sent",
          aadhaarRefId: String(result.referenceId),
          aadhaarLast4: aadhaarNumber.slice(-4),
        });
      } else {
        await storage.createEsignAgreement({
          userId: req.session.userId!,
          advisorId: strategy.advisorId,
          strategyId,
          planId,
          status: "otp_sent",
          aadhaarRefId: String(result.referenceId),
          aadhaarLast4: aadhaarNumber.slice(-4),
          agreementVersion: "1.0",
        });
      }

      res.json({ success: true, message: result.message, referenceId: result.referenceId });
    } catch (err: any) {
      console.error("[eSign] OTP send error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/esign/verify", requireAuth, async (req, res) => {
    try {
      const { strategyId, planId, referenceId, otp } = req.body;
      if (!strategyId || !planId || !referenceId || !otp) {
        return res.status(400).send("strategyId, planId, referenceId and otp required");
      }

      const result = await verifyAadhaarOtp(Number(referenceId), otp);

      const agreements = await db.select().from(esignAgreements)
        .where(and(
          eq(esignAgreements.userId, req.session.userId!),
          eq(esignAgreements.strategyId, strategyId),
          eq(esignAgreements.planId, planId),
          eq(esignAgreements.status, "otp_sent")
        ))
        .orderBy(desc(esignAgreements.createdAt))
        .limit(1);

      const agreement = agreements[0];
      if (!agreement) return res.status(404).send("No pending agreement found");

      await storage.updateEsignAgreement(agreement.id, {
        status: "signed",
        aadhaarName: result.name,
        aadhaarTransactionId: result.transactionId,
        signedAt: new Date(),
        rawResponse: {
          name: result.name,
          dob: result.dob,
          gender: result.gender,
          transactionId: result.transactionId,
        },
      });

      const strategy = await storage.getStrategy(strategyId);
      const user = await storage.getUser(req.session.userId!);
      const advisor = await storage.getUser(agreement.advisorId);

      if (user && advisor && strategy) {
        sendEsignAgreementEmail({
          investorName: user.companyName || user.username,
          investorEmail: user.email,
          advisorName: advisor.companyName || advisor.username,
          advisorEmail: advisor.email,
          strategyName: strategy.name,
          signedAt: new Date(),
          aadhaarName: result.name,
          aadhaarLast4: agreement.aadhaarLast4 || "",
        }).catch(err => console.error("[eSign] Email error:", err));
      }

      res.json({ success: true, agreementId: agreement.id, name: result.name });
    } catch (err: any) {
      console.error("[eSign] Verify error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/esign/status", requireAuth, async (req, res) => {
    try {
      const { strategyId, planId } = req.query;
      if (!strategyId || !planId) return res.status(400).send("strategyId and planId required");

      const agreement = await storage.getEsignAgreementByUserAndStrategy(
        req.session.userId!, strategyId as string, planId as string
      );

      if (agreement && agreement.status === "signed") {
        res.json({
          signed: true,
          agreementId: agreement.id,
          signedAt: agreement.signedAt,
          aadhaarName: agreement.aadhaarName,
        });
      } else {
        res.json({ signed: false });
      }
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/advisor/agreements/:subscriptionId", requireAdvisor, async (req, res) => {
    try {
      const { subscriptionId } = req.params;
      const sub = await storage.getSubscription(subscriptionId);
      if (!sub) return res.status(404).send("Subscription not found");
      if (sub.advisorId !== req.session.userId) return res.status(403).send("Not authorized");

      const agreement = await storage.getEsignAgreementBySubscription(subscriptionId);
      if (!agreement) return res.status(404).json({ found: false });

      const user = await storage.getUser(agreement.userId);

      res.json({
        found: true,
        agreementId: agreement.id,
        investorName: user?.username || "Unknown",
        investorEmail: user?.email || "",
        aadhaarName: agreement.aadhaarName,
        aadhaarLast4: agreement.aadhaarLast4,
        signedAt: agreement.signedAt,
        agreementVersion: agreement.agreementVersion,
        status: agreement.status,
      });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/ekyc/configured", (req, res) => {
    res.json({ configured: isSandboxConfigured() });
  });

  app.get("/api/ekyc/status", requireAuth, async (req, res) => {
    try {
      const { subscriptionId } = req.query;
      if (!subscriptionId) return res.status(400).send("subscriptionId required");

      const sub = await storage.getSubscription(subscriptionId as string);
      if (!sub) return res.status(404).send("Subscription not found");
      if (sub.userId !== req.session.userId) return res.status(403).send("Not authorized");

      const aadhaarVerification = await storage.getEkycBySubscriptionAndType(subscriptionId as string, "aadhaar");
      const panVerification = await storage.getEkycBySubscriptionAndType(subscriptionId as string, "pan");

      res.json({
        subscriptionId: sub.id,
        ekycDone: sub.ekycDone,
        aadhaar: aadhaarVerification ? {
          status: aadhaarVerification.status,
          name: aadhaarVerification.aadhaarName,
          last4: aadhaarVerification.aadhaarLast4,
          verifiedAt: aadhaarVerification.verifiedAt,
        } : null,
        pan: panVerification ? {
          status: panVerification.status,
          panNumber: panVerification.panNumber,
          panName: panVerification.panName,
          verifiedAt: panVerification.verifiedAt,
        } : null,
      });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/ekyc/aadhaar/otp", requireAuth, async (req, res) => {
    try {
      const { subscriptionId, aadhaarNumber } = req.body;
      if (!subscriptionId || !aadhaarNumber) return res.status(400).send("subscriptionId and aadhaarNumber required");
      if (!/^\d{12}$/.test(aadhaarNumber)) return res.status(400).send("Invalid Aadhaar number format");

      const sub = await storage.getSubscription(subscriptionId);
      if (!sub) return res.status(404).send("Subscription not found");
      if (sub.userId !== req.session.userId) return res.status(403).send("Not authorized");

      const result = await sendAadhaarOtp(aadhaarNumber);

      const existing = await storage.getEkycBySubscriptionAndType(subscriptionId, "aadhaar");
      if (existing) {
        await storage.updateEkycVerification(existing.id, {
          status: "otp_sent",
          aadhaarRefId: String(result.referenceId),
          aadhaarTransactionId: result.transactionId,
          aadhaarLast4: aadhaarNumber.slice(-4),
        });
      } else {
        await storage.createEkycVerification({
          subscriptionId,
          userId: sub.userId,
          advisorId: sub.advisorId,
          verificationType: "aadhaar",
          status: "otp_sent",
          aadhaarRefId: String(result.referenceId),
          aadhaarTransactionId: result.transactionId,
          aadhaarLast4: aadhaarNumber.slice(-4),
        });
      }

      res.json({ success: true, message: result.message, referenceId: result.referenceId });
    } catch (err: any) {
      console.error("[eKYC] Aadhaar OTP error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ekyc/aadhaar/verify", requireAuth, async (req, res) => {
    try {
      const { subscriptionId, referenceId, otp } = req.body;
      if (!subscriptionId || !referenceId || !otp) return res.status(400).send("subscriptionId, referenceId and otp required");

      const sub = await storage.getSubscription(subscriptionId);
      if (!sub) return res.status(404).send("Subscription not found");
      if (sub.userId !== req.session.userId) return res.status(403).send("Not authorized");

      const result = await verifyAadhaarOtp(Number(referenceId), otp);

      const existing = await storage.getEkycBySubscriptionAndType(subscriptionId, "aadhaar");
      if (existing) {
        await storage.updateEkycVerification(existing.id, {
          status: "verified",
          aadhaarName: result.name,
          aadhaarDob: result.dob,
          aadhaarGender: result.gender,
          aadhaarAddress: result.address,
          aadhaarPhoto: result.photo,
          aadhaarTransactionId: result.transactionId,
          verifiedAt: new Date(),
        });
      }

      const panVerification = await storage.getEkycBySubscriptionAndType(subscriptionId, "pan");
      if (panVerification?.status === "verified") {
        await storage.updateSubscription(sub.id, { ekycDone: true });
      }

      res.json({
        success: true,
        name: result.name,
        dob: result.dob,
        gender: result.gender,
      });
    } catch (err: any) {
      console.error("[eKYC] Aadhaar verify error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ekyc/pan/verify", requireAuth, async (req, res) => {
    try {
      const { subscriptionId, pan, nameAsPan, dateOfBirth } = req.body;
      if (!subscriptionId || !pan) return res.status(400).send("subscriptionId and pan required");
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(pan)) return res.status(400).send("Invalid PAN format");

      const sub = await storage.getSubscription(subscriptionId);
      if (!sub) return res.status(404).send("Subscription not found");
      if (sub.userId !== req.session.userId) return res.status(403).send("Not authorized");

      const result = await verifyPan(pan, nameAsPan || "", dateOfBirth || "");

      const maskedPan = pan.slice(0, 2) + "****" + pan.slice(-2);

      const existing = await storage.getEkycBySubscriptionAndType(subscriptionId, "pan");
      if (existing) {
        await storage.updateEkycVerification(existing.id, {
          status: result.status === "valid" ? "verified" : "failed",
          panNumber: maskedPan,
          panStatus: result.status,
          panName: result.pan,
          panCategory: result.category,
          panAadhaarLinked: result.aadhaarLinked,
          verifiedAt: result.status === "valid" ? new Date() : null,
        });
      } else {
        await storage.createEkycVerification({
          subscriptionId,
          userId: sub.userId,
          advisorId: sub.advisorId,
          verificationType: "pan",
          status: result.status === "valid" ? "verified" : "failed",
          panNumber: maskedPan,
          panStatus: result.status,
          panName: result.pan,
          panCategory: result.category,
          panAadhaarLinked: result.aadhaarLinked,
        });
      }

      const aadhaarVerification = await storage.getEkycBySubscriptionAndType(subscriptionId, "aadhaar");
      if (aadhaarVerification?.status === "verified" && result.status === "valid") {
        await storage.updateSubscription(sub.id, { ekycDone: true });
      }

      res.json({
        success: true,
        status: result.status,
        category: result.category,
        nameMatch: result.nameMatch,
        dobMatch: result.dobMatch,
        aadhaarLinked: result.aadhaarLinked,
      });
    } catch (err: any) {
      console.error("[eKYC] PAN verify error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });


  // Import CAS/CAMS PDF statement
  app.post("/api/portfolio/:id/import-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const portfolio = await db.execute(sql`SELECT * FROM customer_portfolios WHERE id = ${req.params.id} AND user_id = ${req.session.userId} LIMIT 1`);
      if (!(portfolio as any).rows?.length) return res.status(404).json({ error: "Portfolio not found" });
      if (!req.files || !req.files.file) return res.status(400).json({ error: "No PDF uploaded" });
      const file = req.files.file;
      if (!file.name.toLowerCase().endsWith(".pdf")) return res.status(400).json({ error: "Only PDF files accepted" });
      const parsed = await parseCASPdf(file.data);
      let imported = 0;
      for (const h of parsed.holdings) {
        if (!h.name) continue;
        const invested = h.costValue || (h.units * h.nav) || 0;
        const current = h.currentValue || invested;
        await db.execute(sql`INSERT INTO portfolio_holdings (portfolio_id, asset_type, name, isin, quantity, avg_buy_price, invested_value, current_price, current_value, gain_loss, gain_loss_percent) VALUES (${req.params.id}, ${h.assetType}, ${h.name}, ${h.isin || null}, ${h.units}, ${h.nav}, ${invested}, ${h.nav}, ${current}, ${current - invested}, ${invested > 0 ? ((current - invested) / invested) * 100 : 0})`);
        imported++;
      }
      await db.execute(sql`UPDATE customer_portfolios SET import_method = ${"cas_pdf"}, last_synced = NOW() WHERE id = ${req.params.id}`);
      res.json({ success: true, imported, source: parsed.source, investorName: parsed.investorName, pan: parsed.pan });
    } catch (err: any) {
      console.error("[Portfolio] PDF import error:", err.message);
      res.status(500).json({ error: "Failed to parse PDF: " + err.message });
    }
  });

  app.post("/api/advisor/portfolio/:portfolioId/import-pdf", requireAdvisor, async (req: any, res: any) => {
    try {
      const portfolio = await db.execute(sql`SELECT p.* FROM customer_portfolios p JOIN subscriptions s ON s.user_id = p.user_id AND s.advisor_id = ${req.session.userId} AND s.status = ${"active"} WHERE p.id = ${req.params.portfolioId} LIMIT 1`);
      if (!(portfolio as any).rows?.length) return res.status(403).json({ error: "Not authorized" });
      if (!req.files || !req.files.file) return res.status(400).json({ error: "No PDF uploaded" });
      const parsed = await parseCASPdf(req.files.file.data);
      let imported = 0;
      for (const h of parsed.holdings) {
        if (!h.name) continue;
        const invested = h.costValue || (h.units * h.nav) || 0;
        const current = h.currentValue || invested;
        await db.execute(sql`INSERT INTO portfolio_holdings (portfolio_id, asset_type, name, isin, quantity, avg_buy_price, invested_value, current_price, current_value, gain_loss, gain_loss_percent) VALUES (${req.params.portfolioId}, ${h.assetType}, ${h.name}, ${h.isin || null}, ${h.units}, ${h.nav}, ${invested}, ${h.nav}, ${current}, ${current - invested}, ${invested > 0 ? ((current - invested) / invested) * 100 : 0})`);
        imported++;
      }
      await db.execute(sql`UPDATE customer_portfolios SET import_method = ${"advisor_cas_pdf"}, last_synced = NOW() WHERE id = ${req.params.portfolioId}`);
      res.json({ success: true, imported, source: parsed.source, investorName: parsed.investorName });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to parse PDF: " + err.message });
    }
  });

    // Sync live prices for portfolio holdings

  // ─── Non-Equity Price Sync Helper ────────────────────────────
  async function syncNonEquityPrice(h: any): Promise<{ currentPrice: number; currentValue: number } | null> {
    const type = h.asset_type;
    const qty = Number(h.quantity) || 0;
    const invested = Number(h.invested_value) || (qty * Number(h.avg_buy_price || 0));

    // ETF — same as equity, use Groww live quote
    if (type === "etf" && (h.symbol || h.name)) {
      const quote = await getLiveQuote(h.symbol || h.name);
      if (quote) return { currentPrice: quote.ltp, currentValue: qty * quote.ltp };
    }

    // Real estate — manual update only
    if (type === "real_estate") {
      return null;
    }

    // Gold — manual update only (no reliable auto-sync)
    // GOLDBEES ETF is ~0.01g gold after 1:100 split, not a valid 1:1 proxy
    // TODO: Integrate a gold price API (e.g. metals-api.com) and add domain to network allowlist
    if (type === "gold") {
      return null;
    }

    // FD — compound interest: A = P(1 + r/4)^(4t) (quarterly compounding)
    if (type === "fd") {
      const rate = Number(h.interest_rate) || 0;
      const buyDate = h.buy_date ? new Date(h.buy_date) : null;
      if (rate > 0 && buyDate) {
        const years = (Date.now() - buyDate.getTime()) / (365.25 * 86400000);
        const currentValue = invested * Math.pow(1 + rate / 400, 4 * years);
        return { currentPrice: currentValue, currentValue };
      }
      return null;
    }

    // PPF — annual compounding at declared rate (default 7.1%)
    if (type === "ppf") {
      const rate = Number(h.interest_rate) || 7.1;
      const buyDate = h.buy_date ? new Date(h.buy_date) : null;
      if (buyDate) {
        const years = (Date.now() - buyDate.getTime()) / (365.25 * 86400000);
        const currentValue = invested * Math.pow(1 + rate / 100, years);
        return { currentPrice: currentValue, currentValue };
      }
      return null;
    }

    // EPF — annual compounding at declared rate (default 8.25%)
    if (type === "epf") {
      const rate = Number(h.interest_rate) || 8.25;
      const buyDate = h.buy_date ? new Date(h.buy_date) : null;
      if (buyDate) {
        const years = (Date.now() - buyDate.getTime()) / (365.25 * 86400000);
        const currentValue = invested * Math.pow(1 + rate / 100, years);
        return { currentPrice: currentValue, currentValue };
      }
      return null;
    }

    // NPS — annual compounding at declared rate (default 9.5%)
    if (type === "nps") {
      const rate = Number(h.interest_rate) || 9.5;
      const buyDate = h.buy_date ? new Date(h.buy_date) : null;
      if (buyDate) {
        const years = (Date.now() - buyDate.getTime()) / (365.25 * 86400000);
        const currentValue = invested * Math.pow(1 + rate / 100, years);
        return { currentPrice: currentValue, currentValue };
      }
      return null;
    }

    // Bonds — simple coupon accrual
    if (type === "bond") {
      const rate = Number(h.interest_rate) || 0;
      const buyDate = h.buy_date ? new Date(h.buy_date) : null;
      if (rate > 0 && buyDate) {
        const years = (Date.now() - buyDate.getTime()) / (365.25 * 86400000);
        const accrued = invested * (rate / 100) * years;
        const currentValue = invested + accrued;
        return { currentPrice: currentValue / (qty || 1), currentValue };
      }
      // If no rate, try Groww by symbol (for listed bonds)
      if (h.symbol) {
        const quote = await getLiveQuote(h.symbol);
        if (quote) return { currentPrice: quote.ltp, currentValue: qty * quote.ltp };
      }
      return null;
    }

    // Insurance — current value stays as invested (no market price)
    // Real Estate — manual only, skip
    return null;
  }

  app.post("/api/portfolio/:id/sync-prices", requireAuth, async (req: any, res: any) => {
    try {
      const portfolio = await db.execute(sql`SELECT * FROM customer_portfolios WHERE id = ${req.params.id} LIMIT 1`);
      if (!(portfolio as any).rows?.length) return res.status(404).json({ error: "Portfolio not found" });

      const holdings = await db.execute(sql`SELECT * FROM portfolio_holdings WHERE portfolio_id = ${req.params.id}`);
      const rows = (holdings as any).rows || [];
      let updated = 0;

      for (const h of rows) {
        let currentPrice = 0;
        let currentValue = 0;
        let useDirect = false; // flag for lump-sum assets where currentValue is computed directly

        if (h.asset_type === "equity" && (h.symbol || h.name)) {
          const quote = await getLiveQuote(h.symbol || h.name);
          if (quote) currentPrice = quote.ltp;
        } else if (h.asset_type === "mutual_fund" || h.asset_type === "elss") {
          try {
            const sName = (h.name || "").replace(/^[A-Z0-9]{2,10}[-]/i, "").trim();
            const keywords = sName.replace(/\s*-\s*/g, " ").replace(/\b(fund|plan|growth|option)\b/gi, "").replace(/\s+/g, " ").trim().split(" ").filter((w: string) => w.length > 2).slice(0, 4).join(" ");
            if (keywords) {
              const searchRes = await fetch("https://api.mfapi.in/mf/search?q=" + encodeURIComponent(keywords));
              if (searchRes.ok) {
                const results = await searchRes.json();
                if (results && results.length > 0) {
                  const nameLower = (h.name || "").toLowerCase();
                  const isDirect = nameLower.includes("direct");
                  const isGrowth = nameLower.includes("growth");
                  let best = results[0];
                  for (const r of results) {
                    const rLower = r.schemeName.toLowerCase();
                    const directMatch = isDirect ? rLower.includes("direct") : !rLower.includes("direct");
                    const growthMatch = isGrowth ? rLower.includes("growth") : true;
                    if (directMatch && growthMatch) { best = r; break; }
                  }
                  const navRes = await fetch("https://api.mfapi.in/mf/" + best.schemeCode + "/latest");
                  if (navRes.ok) {
                    const navData = await navRes.json();
                    if (navData?.data?.[0]?.nav) {
                      currentPrice = parseFloat(navData.data[0].nav);
                    }
                  }
                }
              }
            }
          } catch (e: any) { console.warn("[Portfolio] MF NAV lookup failed for " + h.name + ": " + e.message); }
        } else {
          // Non-equity/MF: Gold, FD, PPF, EPF, NPS, ETF, Bond
          const result = await syncNonEquityPrice(h);
          if (result) {
            currentPrice = result.currentPrice;
            currentValue = result.currentValue;
            useDirect = true;
          }
        }

        if (currentPrice > 0 || useDirect) {
          const qty = Number(h.quantity) || 0;
          const invested = Number(h.invested_value) || (qty * Number(h.avg_buy_price || 0));
          if (!useDirect) currentValue = qty * currentPrice;
          const gl = currentValue - invested;
          const glp = invested > 0 ? (gl / invested) * 100 : 0;

          await db.execute(sql`
            UPDATE portfolio_holdings SET
              current_price = ${currentPrice},
              current_value = ${currentValue},
              invested_value = ${invested || Number(h.invested_value) || 0},
              gain_loss = ${gl},
              gain_loss_percent = ${glp},
              updated_at = NOW()
            WHERE id = ${h.id}
          `);
          updated++;
        }
      }

      await db.execute(sql`UPDATE customer_portfolios SET last_synced = NOW() WHERE id = ${req.params.id}`);
      res.json({ success: true, updated, total: rows.length });
    } catch (err: any) {
      console.error("[Portfolio] Sync prices error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor: Sync prices for subscriber portfolio
  app.post("/api/advisor/portfolio/:portfolioId/sync-prices", requireAdvisor, async (req: any, res: any) => {
    try {
      const portfolio = await db.execute(sql`
        SELECT p.* FROM customer_portfolios p
        JOIN subscriptions s ON s.user_id = p.user_id AND s.advisor_id = ${req.session.userId} AND s.status = ${"active"}
        WHERE p.id = ${req.params.portfolioId} LIMIT 1
      `);
      if (!(portfolio as any).rows?.length) return res.status(403).json({ error: "Not authorized" });

      const holdings = await db.execute(sql`SELECT * FROM portfolio_holdings WHERE portfolio_id = ${req.params.portfolioId}`);
      const rows = (holdings as any).rows || [];
      let updated = 0;

      for (const h of rows) {
        let currentPrice = 0;
        let currentValue = 0;
        let useDirect = false;
        if (h.asset_type === "equity" && (h.symbol || h.name)) {
          const quote = await getLiveQuote(h.symbol || h.name);
          if (quote) currentPrice = quote.ltp;
        } else if (h.asset_type === "mutual_fund" || h.asset_type === "elss") {
          try {
            const sName = (h.name || "").replace(/^[A-Z0-9]{2,10}[-]/i, "").trim();
            const keywords = sName.replace(/\s*-\s*/g, " ").replace(/\b(fund|plan|growth|option)\b/gi, "").replace(/\s+/g, " ").trim().split(" ").filter((w: string) => w.length > 2).slice(0, 4).join(" ");
            if (keywords) {
              const searchRes = await fetch("https://api.mfapi.in/mf/search?q=" + encodeURIComponent(keywords));
              if (searchRes.ok) {
                const results = await searchRes.json();
                if (results && results.length > 0) {
                  const nameLower = (h.name || "").toLowerCase();
                  const isDirect = nameLower.includes("direct");
                  const isGrowth = nameLower.includes("growth");
                  let best = results[0];
                  for (const r of results) {
                    const rLower = r.schemeName.toLowerCase();
                    const directMatch = isDirect ? rLower.includes("direct") : !rLower.includes("direct");
                    const growthMatch = isGrowth ? rLower.includes("growth") : true;
                    if (directMatch && growthMatch) { best = r; break; }
                  }
                  const navRes = await fetch("https://api.mfapi.in/mf/" + best.schemeCode + "/latest");
                  if (navRes.ok) {
                    const navData = await navRes.json();
                    if (navData?.data?.[0]?.nav) {
                      currentPrice = parseFloat(navData.data[0].nav);
                    }
                  }
                }
              }
            }
          } catch (e: any) { console.warn("[Portfolio] MF NAV lookup failed for " + h.name + ": " + e.message); }
        } else {
          const result = await syncNonEquityPrice(h);
          if (result) { currentPrice = result.currentPrice; currentValue = result.currentValue; useDirect = true; }
        }
        if (currentPrice > 0 || useDirect) {
          const qty = Number(h.quantity) || 0;
          const invested = Number(h.invested_value) || (qty * Number(h.avg_buy_price || 0));
          if (!useDirect) currentValue = qty * currentPrice;
          const gl = currentValue - invested;
          const glp = invested > 0 ? (gl / invested) * 100 : 0;
          await db.execute(sql`
            UPDATE portfolio_holdings SET current_price = ${currentPrice}, current_value = ${currentValue},
              invested_value = ${invested || Number(h.invested_value) || 0},
              gain_loss = ${gl}, gain_loss_percent = ${glp}, updated_at = NOW()
            WHERE id = ${h.id}
          `);
          updated++;
        }
      }
      await db.execute(sql`UPDATE customer_portfolios SET last_synced = NOW() WHERE id = ${req.params.portfolioId}`);
      res.json({ success: true, updated, total: rows.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

    // Portfolio CSV templates
  app.get("/api/portfolio/templates/:type", (req: any, res: any) => {
    const templates: any = {
      stocks: "/var/www/alphamarket/uploads/templates/stocks_portfolio_template.csv",
      mutual_funds: "/var/www/alphamarket/uploads/templates/mutual_funds_template.csv",
      combined: "/var/www/alphamarket/uploads/templates/combined_portfolio_template.csv",
    };
    const filePath = templates[req.params.type];
    if (!filePath) return res.status(404).json({ error: "Template not found" });
    res.download(filePath);
  });

    // ─── Portfolio Analyzer Routes ──────────────────────────────────────

  // Get user's portfolios
  app.get("/api/portfolio", requireAuth, async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`
        SELECT p.*, 
          (SELECT COUNT(*) FROM portfolio_holdings WHERE portfolio_id = p.id) as holding_count,
          (SELECT COALESCE(SUM(invested_value), 0) FROM portfolio_holdings WHERE portfolio_id = p.id) as total_invested,
          (SELECT COALESCE(SUM(current_value), 0) FROM portfolio_holdings WHERE portfolio_id = p.id) as total_current
        FROM customer_portfolios p
        WHERE p.user_id = ${req.session.userId}
        ORDER BY p.created_at DESC
      `);
      res.json((result as any).rows || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create portfolio
  app.post("/api/portfolio", requireAuth, async (req: any, res: any) => {
    try {
      const { name, shareWithAdvisors } = req.body;
      const result = await db.execute(sql`
        INSERT INTO customer_portfolios (user_id, name, share_with_advisors, import_method)
        VALUES (${req.session.userId}, ${name || "My Portfolio"}, ${!!shareWithAdvisors}, ${"manual"})
        RETURNING *
      `);
      res.json((result as any).rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update portfolio sharing
  app.patch("/api/portfolio/:id", requireAuth, async (req: any, res: any) => {
    try {
      const { name, shareWithAdvisors } = req.body;
      await db.execute(sql`
        UPDATE customer_portfolios 
        SET name = COALESCE(${name || null}, name),
            share_with_advisors = COALESCE(${shareWithAdvisors !== undefined ? shareWithAdvisors : null}, share_with_advisors)
        WHERE id = ${req.params.id} AND user_id = ${req.session.userId}
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete portfolio
  app.delete("/api/portfolio/:id", requireAuth, async (req: any, res: any) => {
    try {
      await db.execute(sql`DELETE FROM customer_portfolios WHERE id = ${req.params.id} AND user_id = ${req.session.userId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get holdings for a portfolio
  app.get("/api/portfolio/:id/holdings", requireAuth, async (req: any, res: any) => {
    try {
      const portfolio = await db.execute(sql`SELECT * FROM customer_portfolios WHERE id = ${req.params.id} AND user_id = ${req.session.userId} LIMIT 1`);
      if (!(portfolio as any).rows?.length) return res.status(404).json({ error: "Portfolio not found" });

      const holdings = await db.execute(sql`
        SELECT * FROM portfolio_holdings WHERE portfolio_id = ${req.params.id} ORDER BY current_value DESC
      `);
      res.json((holdings as any).rows || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add single holding
  app.post("/api/portfolio/:id/holding", requireAuth, async (req: any, res: any) => {
    try {
      const portfolio = await db.execute(sql`SELECT * FROM customer_portfolios WHERE id = ${req.params.id} AND user_id = ${req.session.userId} LIMIT 1`);
      if (!(portfolio as any).rows?.length) return res.status(404).json({ error: "Portfolio not found" });

      const { assetType, symbol, isin, name, quantity, avgBuyPrice, sector, assetClass, buyDate, premium, sumAssured, maturityDate, interestRate, policyNumber, provider } = req.body;
      if (!name || !assetType) return res.status(400).json({ error: "name and assetType required" });

      const qty = Number(quantity) || 0;
      const price = Number(avgBuyPrice) || 0;
      const invested = qty * price;

      const result = await db.execute(sql`
        INSERT INTO portfolio_holdings (portfolio_id, asset_type, symbol, isin, name, quantity, avg_buy_price, invested_value, sector, asset_class, buy_date, premium, sum_assured, maturity_date, interest_rate, policy_number, provider)
        VALUES (${req.params.id}, ${assetType}, ${symbol || null}, ${isin || null}, ${name}, ${qty}, ${price}, ${invested}, ${sector || null}, ${assetClass || null}, ${buyDate || null}, ${premium ? Number(premium) : null}, ${sumAssured ? Number(sumAssured) : null}, ${maturityDate || null}, ${interestRate ? Number(interestRate) : null}, ${policyNumber || null}, ${provider || null})
        RETURNING *
      `);
      res.json((result as any).rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update holding
  app.patch("/api/portfolio/holding/:holdingId", requireAuth, async (req: any, res: any) => {
    try {
      const { quantity, avgBuyPrice, currentPrice } = req.body;
      const qty = Number(quantity); const buy = Number(avgBuyPrice); const curr = Number(currentPrice) || 0;
      const invested = qty * buy; const current = qty * curr;
      const gl = current - invested; const glp = invested > 0 ? (gl / invested) * 100 : 0;

      await db.execute(sql`
        UPDATE portfolio_holdings SET
          quantity = ${qty}, avg_buy_price = ${buy}, current_price = ${curr},
          invested_value = ${invested}, current_value = ${current},
          gain_loss = ${gl}, gain_loss_percent = ${glp}, updated_at = NOW()
        WHERE id = ${req.params.holdingId}
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete holding
  app.delete("/api/portfolio/holding/:holdingId", requireAuth, async (req: any, res: any) => {
    try {
      await db.execute(sql`DELETE FROM portfolio_holdings WHERE id = ${req.params.holdingId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update holding (manual price update for gold, real estate, etc.)
  app.put("/api/portfolio/holding/:holdingId", requireAuth, async (req: any, res: any) => {
    try {
      const { currentPrice, quantity, avgBuyPrice } = req.body;
      const holding = ((await db.execute(sql`SELECT * FROM portfolio_holdings WHERE id = ${req.params.holdingId}`)) as any).rows?.[0];
      if (!holding) return res.status(404).json({ error: "Holding not found" });

      const qty = quantity !== undefined ? Number(quantity) : Number(holding.quantity);
      const buyPrice = avgBuyPrice !== undefined ? Number(avgBuyPrice) : Number(holding.avg_buy_price);
      const curPrice = currentPrice !== undefined ? Number(currentPrice) : Number(holding.current_price);
      const invested = qty * buyPrice;
      const curValue = qty * curPrice;
      const gl = curValue - invested;
      const glPct = invested > 0 ? (gl / invested) * 100 : 0;

      await db.execute(sql`UPDATE portfolio_holdings SET
        quantity = ${qty}, avg_buy_price = ${buyPrice}, current_price = ${curPrice},
        current_value = ${curValue}, invested_value = ${invested},
        gain_loss = ${gl}, gain_loss_percent = ${glPct}, updated_at = NOW()
        WHERE id = ${req.params.holdingId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // CSV Import
  app.post("/api/portfolio/:id/import-csv", requireAuth, async (req: any, res: any) => {
    try {
      const portfolio = await db.execute(sql`SELECT * FROM customer_portfolios WHERE id = ${req.params.id} AND user_id = ${req.session.userId} LIMIT 1`);
      if (!(portfolio as any).rows?.length) return res.status(404).json({ error: "Portfolio not found" });

      if (!req.files || !req.files.file) return res.status(400).json({ error: "No file uploaded" });
      const fileContent = req.files.file.data.toString("utf-8");
      const lines = fileContent.split("\n").map((l: string) => l.trim()).filter((l: string) => l);
      if (lines.length < 2) return res.status(400).json({ error: "File must have header + at least one row" });

      const header = lines[0].toLowerCase();
      const isStockFormat = header.includes("symbol") || header.includes("stock") || header.includes("scrip");
      const isMfFormat = header.includes("scheme") || header.includes("fund") || header.includes("nav");
      const assetType = isMfFormat ? "mutual_fund" : "equity";

      const headers = lines[0].split(",").map((h: string) => h.trim().toLowerCase().replace(/['"]/g, ""));
      let imported = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c: string) => c.trim().replace(/['"]/g, ""));
        if (cols.length < 2) continue;

        const row: any = {};
        headers.forEach((h: string, idx: number) => { row[h] = cols[idx] || ""; });

        const name = row.name || row["stock name"] || row.stock || row.symbol || row.scrip || row.scheme || row["fund name"] || row["scheme name"] || row["scrip name"] || row["company name"] || row["company"] || "";
        const symbol = row.symbol || row["stock name"] || row.scrip || row.ticker || row["stock symbol"] || row["trading symbol"] || "";
        const isin = row.isin || row["isin code"] || row["isin number"] || "";
        const qty = parseFloat(row.quantity || row.qty || row.units || row["no. of units"] || row["total units"] || row["holding qty"] || "0") || 0;
        const buyPrice = parseFloat(row["buy price"] || row["avg price"] || row["average price"] || row["purchase price"] || row["avg nav"] || row.price || row["buy rate"] || row["avg cost"] || row["cost price"] || "0") || 0;
        const buyDate = row["buy date"] || row["purchase date"] || row.date || row["trade date"] || "";
        const sector = row.sector || row.industry || "";

        if (!name && !symbol) continue;

        const invested = qty * buyPrice;
        await db.execute(sql`
          INSERT INTO portfolio_holdings (portfolio_id, asset_type, symbol, isin, name, quantity, avg_buy_price, invested_value, sector)
          VALUES (${req.params.id}, ${assetType}, ${symbol || null}, ${isin || null}, ${name || symbol}, ${qty}, ${buyPrice}, ${invested}, ${sector || null})
        `);
        imported++;
      }

      await db.execute(sql`UPDATE customer_portfolios SET import_method = ${"csv"}, last_synced = NOW() WHERE id = ${req.params.id}`);
      res.json({ success: true, imported, assetType });
    } catch (err: any) {
      console.error("[Portfolio] CSV import error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Portfolio analytics summary
  app.get("/api/portfolio/:id/analytics", requireAuth, async (req: any, res: any) => {
    try {
      const portfolio = await db.execute(sql`SELECT * FROM customer_portfolios WHERE id = ${req.params.id} AND user_id = ${req.session.userId} LIMIT 1`);
      if (!(portfolio as any).rows?.length) return res.status(404).json({ error: "Portfolio not found" });

      const holdingsResult = await db.execute(sql`SELECT * FROM portfolio_holdings WHERE portfolio_id = ${req.params.id}`);
      const holdings = (holdingsResult as any).rows || [];

      const totalInvested = holdings.reduce((s: number, h: any) => s + Number(h.invested_value || 0), 0);
      const totalCurrent = holdings.reduce((s: number, h: any) => s + Number(h.current_value || 0), 0);
      const totalGainLoss = totalCurrent - totalInvested;
      const totalGainLossPercent = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;

      const assetAllocation: any = {};
      const sectorAllocation: any = {};
      holdings.forEach((h: any) => {
        const type = h.asset_type || "other";
        assetAllocation[type] = (assetAllocation[type] || 0) + Number(h.current_value || h.invested_value || 0);
        if (h.sector) {
          sectorAllocation[h.sector] = (sectorAllocation[h.sector] || 0) + Number(h.current_value || h.invested_value || 0);
        }
      });

      const topHoldings = [...holdings].sort((a: any, b: any) => Number(b.current_value || b.invested_value || 0) - Number(a.current_value || a.invested_value || 0)).slice(0, 5);
      const winners = holdings.filter((h: any) => Number(h.gain_loss || 0) > 0).length;
      const losers = holdings.filter((h: any) => Number(h.gain_loss || 0) < 0).length;

      const top5Value = topHoldings.reduce((s: number, h: any) => s + Number(h.current_value || h.invested_value || 0), 0);
      const concentrationRisk = totalCurrent > 0 ? (top5Value / totalCurrent) * 100 : 0;

      res.json({
        summary: {
          totalHoldings: holdings.length,
          equityCount: holdings.filter((h: any) => h.asset_type === "equity").length,
          mfCount: holdings.filter((h: any) => h.asset_type === "mutual_fund").length,
          totalInvested, totalCurrent, totalGainLoss, totalGainLossPercent,
          winners, losers,
        },
        assetAllocation,
        sectorAllocation,
        topHoldings: topHoldings.map((h: any) => ({
          name: h.name, symbol: h.symbol, assetType: h.asset_type,
          investedValue: h.invested_value, currentValue: h.current_value,
          gainLoss: h.gain_loss, gainLossPercent: h.gain_loss_percent,
        })),
        concentrationRisk,
        deepAnalysisLinks: {
          stocks: "https://stocks.alphamarket.co.in",
          mf: "https://mf.alphamarket.co.in",
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor: View subscriber portfolio (only if shared)
  app.get("/api/advisor/subscriber/:userId/portfolio", requireAdvisor, async (req: any, res: any) => {
    try {
      const sub = await db.execute(sql`
        SELECT id FROM subscriptions WHERE user_id = ${req.params.userId} AND advisor_id = ${req.session.userId} AND status = ${"active"} LIMIT 1
      `);
      if (!(sub as any).rows?.length) return res.status(403).json({ error: "Not your subscriber" });

      const portfolios = await db.execute(sql`
        SELECT p.*, 
          (SELECT COUNT(*) FROM portfolio_holdings WHERE portfolio_id = p.id) as holding_count,
          (SELECT COALESCE(SUM(invested_value), 0) FROM portfolio_holdings WHERE portfolio_id = p.id) as total_invested,
          (SELECT COALESCE(SUM(current_value), 0) FROM portfolio_holdings WHERE portfolio_id = p.id) as total_current
        FROM customer_portfolios p
        WHERE p.user_id = ${req.params.userId} AND p.share_with_advisors = true
        ORDER BY p.created_at DESC
      `);

      const user = await storage.getUser(req.params.userId);
      const allPortfolios = (portfolios as any).rows || [];

      const portfoliosWithHoldings = await Promise.all(allPortfolios.map(async (p: any) => {
        const holdings = await db.execute(sql`SELECT * FROM portfolio_holdings WHERE portfolio_id = ${p.id} ORDER BY current_value DESC`);
        return { ...p, holdings: (holdings as any).rows || [] };
      }));

      res.json({
        investor: { name: user?.companyName || user?.username || "Unknown", email: user?.email || "" },
        portfolios: portfoliosWithHoldings,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

    // Advisor: Create portfolio for subscriber
  app.post("/api/advisor/subscriber/:userId/portfolio", requireAdvisor, async (req: any, res: any) => {
    try {
      const sub = await db.execute(sql`
        SELECT id FROM subscriptions WHERE user_id = ${req.params.userId} AND advisor_id = ${req.session.userId} AND status = ${"active"} LIMIT 1
      `);
      if (!(sub as any).rows?.length) return res.status(403).json({ error: "Not your subscriber" });

      const { name } = req.body;
      const result = await db.execute(sql`
        INSERT INTO customer_portfolios (user_id, name, share_with_advisors, import_method)
        VALUES (${req.params.userId}, ${name || "Portfolio (by Advisor)"}, true, ${"advisor_created"})
        RETURNING *
      `);
      res.json((result as any).rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor: Add holding to subscriber portfolio
  app.post("/api/advisor/portfolio/:portfolioId/holding", requireAdvisor, async (req: any, res: any) => {
    try {
      const portfolio = await db.execute(sql`
        SELECT p.* FROM customer_portfolios p
        JOIN subscriptions s ON s.user_id = p.user_id AND s.advisor_id = ${req.session.userId} AND s.status = ${"active"}
        WHERE p.id = ${req.params.portfolioId} LIMIT 1
      `);
      if (!(portfolio as any).rows?.length) return res.status(403).json({ error: "Not authorized" });

      const { assetType, symbol, isin, name, quantity, avgBuyPrice, sector, assetClass,
        provider, interestRate, maturityDate, lockInUntil, premium, sumAssured, policyNumber, buyDate } = req.body;
      if (!name || !assetType) return res.status(400).json({ error: "name and assetType required" });
      const lumpSumTypes = ["fd","ppf","nps","epf","insurance","cash","real_estate"];
      const isLumpSum = lumpSumTypes.includes(assetType);
      const qty = isLumpSum ? 1 : (Number(quantity) || 0);
      const price = Number(avgBuyPrice) || 0;
      const invested = isLumpSum ? price : qty * price;
      const currentValue = invested; // Will be updated by price sync

      const result = await db.execute(sql`
        INSERT INTO portfolio_holdings (portfolio_id, asset_type, symbol, isin, name, quantity, avg_buy_price, invested_value, current_price, current_value, sector, asset_class, provider, interest_rate, maturity_date, lock_in_until, premium, sum_assured, policy_number, buy_date)
        VALUES (${req.params.portfolioId}, ${assetType}, ${symbol || null}, ${isin || null}, ${name}, ${qty}, ${price}, ${invested}, ${price}, ${currentValue}, ${sector || null}, ${assetClass || null}, ${provider || null}, ${Number(interestRate) || null}, ${maturityDate || null}, ${lockInUntil || null}, ${Number(premium) || null}, ${Number(sumAssured) || null}, ${policyNumber || null}, ${buyDate || null})
        RETURNING *
      `);
      res.json((result as any).rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor: CSV import for subscriber portfolio
  app.post("/api/advisor/portfolio/:portfolioId/import-csv", requireAdvisor, async (req: any, res: any) => {
    try {
      const portfolio = await db.execute(sql`
        SELECT p.* FROM customer_portfolios p
        JOIN subscriptions s ON s.user_id = p.user_id AND s.advisor_id = ${req.session.userId} AND s.status = ${"active"}
        WHERE p.id = ${req.params.portfolioId} LIMIT 1
      `);
      if (!(portfolio as any).rows?.length) return res.status(403).json({ error: "Not authorized" });

      if (!req.files || !req.files.file) return res.status(400).json({ error: "No file uploaded" });
      const fileContent = req.files.file.data.toString("utf-8");
      const lines = fileContent.split("\n").map((l: string) => l.trim()).filter((l: string) => l);
      if (lines.length < 2) return res.status(400).json({ error: "File needs header + data rows" });

      const header = lines[0].toLowerCase();
      const assetType = (header.includes("scheme") || header.includes("fund") || header.includes("nav")) ? "mutual_fund" : "equity";
      const headers = lines[0].split(",").map((h: string) => h.trim().toLowerCase().replace(/['"]/g, ""));
      let imported = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c: string) => c.trim().replace(/['"]/g, ""));
        if (cols.length < 2) continue;
        const row: any = {};
        headers.forEach((h: string, idx: number) => { row[h] = cols[idx] || ""; });

        const name = row.name || row["stock name"] || row.stock || row.symbol || row.scrip || row.scheme || row["fund name"] || row["scheme name"] || row["scrip name"] || row["company name"] || row["company"] || "";
        const symbol = row.symbol || row["stock name"] || row.scrip || row.ticker || row["stock symbol"] || row["trading symbol"] || "";
        const isin = row.isin || row["isin code"] || row["isin number"] || "";
        const qty = parseFloat(row.quantity || row.qty || row.units || row["no. of units"] || row["total units"] || row["holding qty"] || "0") || 0;
        const buyPrice = parseFloat(row["buy price"] || row["avg price"] || row["average price"] || row["purchase price"] || row["avg nav"] || row.price || row["buy rate"] || row["avg cost"] || row["cost price"] || "0") || 0;
        const buyDate = row["buy date"] || row["purchase date"] || row.date || row["trade date"] || "";
        const sector = row.sector || row.industry || "";

        if (!name && !symbol) continue;
        const invested = qty * buyPrice;
        await db.execute(sql`
          INSERT INTO portfolio_holdings (portfolio_id, asset_type, symbol, isin, name, quantity, avg_buy_price, invested_value, sector)
          VALUES (${req.params.portfolioId}, ${assetType}, ${symbol || null}, ${isin || null}, ${name || symbol}, ${qty}, ${buyPrice}, ${invested}, ${sector || null})
        `);
        imported++;
      }

      await db.execute(sql`UPDATE customer_portfolios SET import_method = ${"advisor_csv"}, last_synced = NOW() WHERE id = ${req.params.portfolioId}`);
      res.json({ success: true, imported, assetType });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

    // Upload attachment for recommendation
  app.post("/api/advisor/recommendation/upload", requireAdvisor, async (req: any, res: any) => {
    try {
      if (!req.files || !req.files.file) return res.status(400).json({ error: "No file uploaded" });
      const file = req.files.file;
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["pdf", "jpg", "jpeg", "png", "xlsx", "csv", "docx"].includes(ext || "")) {
        return res.status(400).json({ error: "Allowed: PDF, images, Excel, CSV, Word" });
      }
      const fileName = req.session.userId + "-rec-" + Date.now() + "." + ext;
      const fs = require("fs");
      const dir = "/var/www/alphamarket/uploads/recommendations";
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await file.mv(dir + "/" + fileName);
      res.json({ url: "/uploads/recommendations/" + fileName, name: file.name });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

    
  // ─── Rationale File Upload (for calls and positions) ─────────────
  app.post("/api/advisor/rationale/upload", requireAdvisor, async (req: any, res: any) => {
    try {
      if (!req.files || !req.files.file) return res.status(400).json({ error: "No file uploaded" });
      const file = req.files.file;
      const ext = file.name.split(".").pop()?.toLowerCase();
      const allowed = ["pdf", "jpg", "jpeg", "png", "xlsx", "xls", "docx", "doc"];
      if (!allowed.includes(ext || "")) {
        return res.status(400).json({ error: "Allowed file types: PDF, JPEG, PNG, Word (.docx), Excel (.xlsx). Max size: 5MB." });
      }
      if (file.size > 5 * 1024 * 1024) {
        return res.status(400).json({ error: "File size must be under 5MB" });
      }
      const fileName = req.session.userId + "-rat-" + Date.now() + "." + ext;
      const fs = require("fs");
      const dir = "/var/www/alphamarket/uploads/rationale";
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await file.mv(dir + "/" + fileName);
      res.json({ url: "/uploads/rationale/" + fileName, name: file.name, size: file.size, type: ext });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  // ─── Advisor Recommendation Engine ─────────────────────────────────

  // Advisor: Create recommendation for subscriber
  app.post("/api/advisor/recommendation", requireAdvisor, async (req: any, res: any) => {
    try {
      const { investorId, portfolioId, title, summary, actions, attachments } = req.body;
      if (!investorId || !title) return res.status(400).json({ error: "investorId and title required" });

      const sub = await db.execute(sql`SELECT id FROM subscriptions WHERE user_id = ${investorId} AND advisor_id = ${req.session.userId} AND status = ${"active"} LIMIT 1`);
      if (!(sub as any).rows?.length) return res.status(403).json({ error: "Not your subscriber" });

      const result = await db.execute(sql`
        INSERT INTO advisor_recommendations (advisor_id, investor_id, portfolio_id, title, summary, actions, attachments)
        VALUES (${req.session.userId}, ${investorId}, ${portfolioId || null}, ${title}, ${summary || null}, ${JSON.stringify(actions || [])}, ${JSON.stringify(attachments || [])})
        RETURNING *
      `);
      res.json((result as any).rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor: List own recommendations
  app.get("/api/advisor/recommendations", requireAdvisor, async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`
        SELECT r.*, u.username as investor_name, u.company_name as investor_company, u.email as investor_email
        FROM advisor_recommendations r
        JOIN users u ON u.id = r.investor_id
        WHERE r.advisor_id = ${req.session.userId}
        ORDER BY r.created_at DESC
      `);
      res.json((result as any).rows || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor: Update / send recommendation
  app.patch("/api/advisor/recommendation/:id", requireAdvisor, async (req: any, res: any) => {
    try {
      const { title, summary, actions, status } = req.body;
      const rec = await db.execute(sql`SELECT * FROM advisor_recommendations WHERE id = ${req.params.id} AND advisor_id = ${req.session.userId} LIMIT 1`);
      if (!(rec as any).rows?.length) return res.status(404).json({ error: "Not found" });

      const isSending = status === "sent" && (rec as any).rows[0].status !== "sent";

      await db.execute(sql`
        UPDATE advisor_recommendations SET
          title = COALESCE(${title || null}, title),
          summary = COALESCE(${summary || null}, summary),
          actions = COALESCE(${actions ? JSON.stringify(actions) : null}, actions),
          status = COALESCE(${status || null}, status),
          sent_at = ${isSending ? new Date().toISOString() : (rec as any).rows[0].sent_at}
        WHERE id = ${req.params.id} AND advisor_id = ${req.session.userId}
      `);

      if (isSending) {
        const investor = await storage.getUser((rec as any).rows[0].investor_id);
        const advisor = await storage.getUser(req.session.userId!);
        if (investor) {
          await storage.createNotification({
            userId: investor.id,
            title: "New Recommendation from " + (advisor?.companyName || "Your Advisor"),
            message: title || "Your advisor has sent you a new portfolio recommendation. Check your dashboard.",
            type: "recommendation",
          });
        }
      }

      res.json({ success: true, sent: isSending });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor: Delete recommendation
  app.delete("/api/advisor/recommendation/:id", requireAdvisor, async (req: any, res: any) => {
    try {
      await db.execute(sql`DELETE FROM advisor_recommendations WHERE id = ${req.params.id} AND advisor_id = ${req.session.userId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Investor: Get recommendations from advisors
  app.get("/api/investor/recommendations-from-advisor", requireAuth, async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`
        SELECT r.*, u.username as advisor_name, u.company_name as advisor_company
        FROM advisor_recommendations r
        JOIN users u ON u.id = r.advisor_id
        WHERE r.investor_id = ${req.session.userId} AND r.status = ${"sent"}
        ORDER BY r.sent_at DESC
      `);

      const recs = (result as any).rows || [];
      for (const rec of recs) {
        if (!rec.viewed_at) {
          await db.execute(sql`UPDATE advisor_recommendations SET viewed_at = NOW(), status = ${"viewed"} WHERE id = ${rec.id}`);
          rec.viewed_at = new Date().toISOString();
          rec.status = "viewed";
        }
      }

      res.json(recs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Investor: Mark action as done
  app.patch("/api/investor/recommendation/:id/action/:idx", requireAuth, async (req: any, res: any) => {
    try {
      const rec = await db.execute(sql`SELECT * FROM advisor_recommendations WHERE id = ${req.params.id} AND investor_id = ${req.session.userId} LIMIT 1`);
      if (!(rec as any).rows?.length) return res.status(404).json({ error: "Not found" });

      const actions = (rec as any).rows[0].actions || [];
      const idx = parseInt(req.params.idx);
      if (idx >= 0 && idx < actions.length) {
        actions[idx].done = !actions[idx].done;
        await db.execute(sql`UPDATE advisor_recommendations SET actions = ${JSON.stringify(actions)} WHERE id = ${req.params.id}`);
      }

      const allDone = actions.every((a: any) => a.done);
      if (allDone) {
        await db.execute(sql`UPDATE advisor_recommendations SET status = ${"completed"} WHERE id = ${req.params.id}`);
      }

      res.json({ success: true, actions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

    // ─── Financial Goals Routes ──────────────────────────────────────

  // Get user's goals
  app.get("/api/goals", requireAuth, async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`SELECT * FROM financial_goals WHERE user_id = ${req.session.userId} ORDER BY priority ASC, created_at DESC`);
      const goals = (result as any).rows || [];

      const enriched = goals.map((g: any) => {
        const target = Number(g.target_amount);
        const current = Number(g.current_amount || 0);
        const horizon = Number(g.horizon_years || 10);
        const sip = Number(g.monthly_sip || 0);
        const ret = Number(g.expected_return || 12) / 100;
        const inf = Number(g.inflation_rate || 6) / 100;

        const inflationAdjustedTarget = target * Math.pow(1 + inf, horizon);
        const corpusGrowth = current * Math.pow(1 + ret, horizon);

        let sipAccum = 0;
        let annualSIP = sip * 12;
        for (let y = 1; y <= horizon; y++) {
          sipAccum += annualSIP * Math.pow(1 + ret, horizon - y);
          annualSIP *= 1.1;
        }

        const projected = corpusGrowth + sipAccum;
        const gap = Math.max(0, inflationAdjustedTarget - projected);
        const probability = Math.min(95, Math.max(5, Math.round((projected / inflationAdjustedTarget) * 100)));

        const additionalSIP = gap > 0 && horizon > 0
          ? Math.round(gap / (((Math.pow(1 + ret, horizon) - 1) / ret) * 12))
          : 0;

        const progress = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

        return {
          ...g,
          inflationAdjustedTarget: Math.round(inflationAdjustedTarget),
          projectedValue: Math.round(projected),
          gap: Math.round(gap),
          probability,
          onTrack: probability >= 70,
          additionalSIPNeeded: additionalSIP,
          progress,
        };
      });

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create goal
  app.post("/api/goals", requireAuth, async (req: any, res: any) => {
    try {
      const { name, goalType, targetAmount, currentAmount, targetDate, horizonYears,
              monthlySip, inflationRate, expectedReturn, priority, notes } = req.body;
      if (!name || !goalType || !targetAmount) return res.status(400).json({ error: "name, goalType, targetAmount required" });

      const result = await db.execute(sql`
        INSERT INTO financial_goals (user_id, created_by, name, goal_type, target_amount, current_amount, target_date, horizon_years, monthly_sip, inflation_rate, expected_return, priority, notes)
        VALUES (${req.session.userId}, ${req.session.userId}, ${name}, ${goalType}, ${targetAmount}, ${currentAmount || 0}, ${targetDate || null}, ${horizonYears || 10}, ${monthlySip || 0}, ${inflationRate || 6}, ${expectedReturn || 12}, ${priority || "medium"}, ${notes || null})
        RETURNING *
      `);
      res.json((result as any).rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update goal
  app.patch("/api/goals/:id", requireAuth, async (req: any, res: any) => {
    try {
      const { name, targetAmount, currentAmount, targetDate, horizonYears,
              monthlySip, inflationRate, expectedReturn, priority, notes, status } = req.body;
      await db.execute(sql`
        UPDATE financial_goals SET
          name = COALESCE(${name || null}, name),
          target_amount = COALESCE(${targetAmount || null}, target_amount),
          current_amount = COALESCE(${currentAmount !== undefined ? currentAmount : null}, current_amount),
          target_date = COALESCE(${targetDate || null}, target_date),
          horizon_years = COALESCE(${horizonYears || null}, horizon_years),
          monthly_sip = COALESCE(${monthlySip !== undefined ? monthlySip : null}, monthly_sip),
          inflation_rate = COALESCE(${inflationRate || null}, inflation_rate),
          expected_return = COALESCE(${expectedReturn || null}, expected_return),
          priority = COALESCE(${priority || null}, priority),
          notes = COALESCE(${notes || null}, notes),
          status = COALESCE(${status || null}, status),
          updated_at = NOW()
        WHERE id = ${req.params.id} AND user_id = ${req.session.userId}
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete goal
  app.delete("/api/goals/:id", requireAuth, async (req: any, res: any) => {
    try {
      await db.execute(sql`DELETE FROM financial_goals WHERE id = ${req.params.id} AND user_id = ${req.session.userId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor: Create goal for subscriber
  app.post("/api/advisor/subscriber/:userId/goal", requireAdvisor, async (req: any, res: any) => {
    try {
      const sub = await db.execute(sql`SELECT id FROM subscriptions WHERE user_id = ${req.params.userId} AND advisor_id = ${req.session.userId} AND status = ${"active"} LIMIT 1`);
      if (!(sub as any).rows?.length) return res.status(403).json({ error: "Not your subscriber" });

      const { name, goalType, targetAmount, currentAmount, horizonYears, monthlySip, priority, notes } = req.body;
      const result = await db.execute(sql`
        INSERT INTO financial_goals (user_id, created_by, name, goal_type, target_amount, current_amount, horizon_years, monthly_sip, priority, notes)
        VALUES (${req.params.userId}, ${req.session.userId}, ${name}, ${goalType}, ${targetAmount}, ${currentAmount || 0}, ${horizonYears || 10}, ${monthlySip || 0}, ${priority || "medium"}, ${notes || null})
        RETURNING *
      `);
      res.json((result as any).rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor: View subscriber goals
  app.get("/api/advisor/subscriber/:userId/goals", requireAdvisor, async (req: any, res: any) => {
    try {
      const sub = await db.execute(sql`SELECT id FROM subscriptions WHERE user_id = ${req.params.userId} AND advisor_id = ${req.session.userId} AND status = ${"active"} LIMIT 1`);
      if (!(sub as any).rows?.length) return res.status(403).json({ error: "Not your subscriber" });

      const result = await db.execute(sql`SELECT * FROM financial_goals WHERE user_id = ${req.params.userId} ORDER BY priority ASC`);
      res.json((result as any).rows || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

    // ─── Suggestion Engine Routes ──────────────────────────────────────

  // Generate suggestions for a portfolio (rules-based)
  app.post("/api/portfolio/:id/generate-suggestions", requireAuth, async (req: any, res: any) => {
    try {
      const portfolio = await db.execute(sql`SELECT * FROM customer_portfolios WHERE id = ${req.params.id} LIMIT 1`);
      if (!(portfolio as any).rows?.length) return res.status(404).json({ error: "Portfolio not found" });
      const p = (portfolio as any).rows[0];
      if (p.user_id !== req.session.userId) {
        const advCheck = await db.execute(sql`SELECT id FROM subscriptions WHERE user_id = ${p.user_id} AND advisor_id = ${req.session.userId} AND status = ${"active"} LIMIT 1`);
        if (!(advCheck as any).rows?.length) return res.status(403).json({ error: "Not authorized" });
      }

      const holdingsResult = await db.execute(sql`SELECT * FROM portfolio_holdings WHERE portfolio_id = ${req.params.id}`);
      const holdings = (holdingsResult as any).rows || [];
      if (holdings.length === 0) return res.status(400).json({ error: "Portfolio has no holdings" });

      const totalValue = holdings.reduce((s: number, h: any) => s + Number(h.invested_value || 0), 0);
      const suggestions: any[] = [];

      // Asset allocation
      const equityValue = holdings.filter((h: any) => h.asset_type === "equity").reduce((s: number, h: any) => s + Number(h.invested_value || 0), 0);
      const mfValue = holdings.filter((h: any) => h.asset_type === "mutual_fund").reduce((s: number, h: any) => s + Number(h.invested_value || 0), 0);
      const debtValue = holdings.filter((h: any) => ["debt", "fd"].includes(h.asset_type)).reduce((s: number, h: any) => s + Number(h.invested_value || 0), 0);
      const equityPct = totalValue > 0 ? (equityValue + mfValue) / totalValue * 100 : 0;
      const debtPct = totalValue > 0 ? debtValue / totalValue * 100 : 0;

      // Rule 1: High equity concentration
      if (equityPct > 85) {
        suggestions.push({ type: "asset_allocation", asset_class: "cross_asset", title: "High Equity Concentration", description: "Your portfolio is " + equityPct.toFixed(0) + "% in equities. Consider adding 15-20% debt/fixed income for stability and downside protection.", action: "rebalance", priority: "high" });
      }

      // Rule 2: No debt allocation
      if (debtPct < 5 && totalValue > 100000) {
        suggestions.push({ type: "asset_allocation", asset_class: "debt", title: "Add Debt Component", description: "You have almost no debt allocation. Consider adding short-duration debt funds or FDs for emergency corpus and portfolio stability.", action: "buy", priority: "high" });
      }

      // Rule 3: Single stock concentration
      holdings.forEach((h: any) => {
        const pct = totalValue > 0 ? Number(h.invested_value || 0) / totalValue * 100 : 0;
        if (pct > 20 && h.asset_type === "equity") {
          suggestions.push({ type: "concentration", asset_class: "equity", title: "High Concentration in " + h.name, description: h.name + " is " + pct.toFixed(0) + "% of your portfolio. Single stock risk is elevated. Consider trimming to below 15%.", action: "reduce", symbol: h.symbol, priority: "high", current_allocation: pct, suggested_allocation: 15 });
        }
      });

      // Rule 4: Too many small positions
      const tinyPositions = holdings.filter((h: any) => totalValue > 0 && (Number(h.invested_value || 0) / totalValue * 100) < 1);
      if (tinyPositions.length > 3) {
        suggestions.push({ type: "portfolio_cleanup", asset_class: "equity", title: "Too Many Small Positions", description: "You have " + tinyPositions.length + " holdings each less than 1% of portfolio. These barely impact returns. Consider consolidating into your high-conviction picks.", action: "review", priority: "medium" });
      }

      // Rule 5: Sector concentration
      const sectorMap: any = {};
      holdings.forEach((h: any) => { if (h.sector) { sectorMap[h.sector] = (sectorMap[h.sector] || 0) + Number(h.invested_value || 0); } });
      Object.entries(sectorMap).forEach(([sector, value]: any) => {
        const pct = totalValue > 0 ? value / totalValue * 100 : 0;
        if (pct > 35) {
          suggestions.push({ type: "sector_concentration", asset_class: "equity", title: "High " + sector + " Exposure", description: sector + " sector is " + pct.toFixed(0) + "% of your portfolio. Sector downturns could significantly impact your returns. Diversify across sectors.", action: "rebalance", priority: "medium", current_allocation: pct, suggested_allocation: 25 });
        }
      });

      // Rule 6: No MF allocation for diversification
      if (mfValue === 0 && equityValue > 200000 && holdings.filter((h: any) => h.asset_type === "equity").length > 5) {
        suggestions.push({ type: "diversification", asset_class: "mutual_fund", title: "Consider Mutual Funds for Diversification", description: "Your portfolio is 100% direct equity. Adding index funds or flexi-cap funds can provide broader market exposure with lower effort.", action: "buy", priority: "medium" });
      }

      // Rule 7: MF expense ratio check (if MF names suggest regular plans)
      holdings.filter((h: any) => h.asset_type === "mutual_fund").forEach((h: any) => {
        const name = (h.name || "").toLowerCase();
        if (name.includes("regular") && !name.includes("direct")) {
          suggestions.push({ type: "cost_optimization", asset_class: "mutual_fund", title: "Switch " + h.name + " to Direct Plan", description: "This appears to be a regular plan MF. Switching to direct plan can save 0.5-1.5% annually in expense ratio, significantly boosting long-term returns.", action: "switch", symbol: h.symbol, priority: "medium" });
        }
      });

      // Rule 8: Portfolio too concentrated (less than 5 holdings with significant value)
      if (holdings.length < 5 && totalValue > 200000) {
        suggestions.push({ type: "diversification", asset_class: "cross_asset", title: "Portfolio Under-Diversified", description: "Only " + holdings.length + " holdings. A well-diversified portfolio typically has 12-15 stocks across sectors, plus debt and MF allocation.", action: "buy", priority: "medium" });
      }

      // Rule 9: Over-diversified
      if (holdings.filter((h: any) => h.asset_type === "equity").length > 25) {
        suggestions.push({ type: "portfolio_cleanup", asset_class: "equity", title: "Over-Diversified Stock Portfolio", description: "You hold " + holdings.filter((h: any) => h.asset_type === "equity").length + " stocks. Beyond 15-20, additional diversification adds complexity without meaningful risk reduction. Focus on best ideas.", action: "review", priority: "low" });
      }

      // Rule 10: Large cash/FD allocation
      const fdValue = holdings.filter((h: any) => h.asset_type === "fd" || h.asset_type === "other").reduce((s: number, h: any) => s + Number(h.invested_value || 0), 0);
      const fdPct = totalValue > 0 ? fdValue / totalValue * 100 : 0;
      if (fdPct > 40) {
        suggestions.push({ type: "asset_allocation", asset_class: "cross_asset", title: "High Cash/FD Allocation", description: "FDs and cash are " + fdPct.toFixed(0) + "% of your portfolio. After keeping 6 months expenses as emergency fund, consider deploying excess into equity SIPs for better long-term returns.", action: "rebalance", priority: "low" });
      }

      // Clear old suggestions and insert new ones
      await db.execute(sql`DELETE FROM portfolio_suggestions WHERE portfolio_id = ${req.params.id} AND advisor_approved = false`);

      for (const s of suggestions) {
        await db.execute(sql`
          INSERT INTO portfolio_suggestions (portfolio_id, advisor_id, type, asset_class, title, description, action, symbol, current_allocation, suggested_allocation, priority)
          VALUES (${req.params.id}, ${req.session.userId !== p.user_id ? req.session.userId : null}, ${s.type}, ${s.asset_class || null}, ${s.title}, ${s.description}, ${s.action || null}, ${s.symbol || null}, ${s.current_allocation || null}, ${s.suggested_allocation || null}, ${s.priority || "medium"})
        `);
      }

      res.json({ success: true, count: suggestions.length, suggestions });
    } catch (err: any) {
      console.error("[Suggestions] Generate error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Get suggestions for a portfolio
  app.get("/api/portfolio/:id/suggestions", requireAuth, async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`
        SELECT s.*, u.username as advisor_name, u.company_name as advisor_company
        FROM portfolio_suggestions s
        LEFT JOIN users u ON u.id = s.advisor_id
        WHERE s.portfolio_id = ${req.params.id}
        ORDER BY CASE s.priority WHEN ${"high"} THEN 1 WHEN ${"medium"} THEN 2 ELSE 3 END, s.created_at DESC
      `);
      res.json((result as any).rows || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor: Approve/reject/add notes to suggestion
  app.patch("/api/suggestion/:id", requireAdvisor, async (req: any, res: any) => {
    try {
      const { advisorApproved, advisorNotes, status } = req.body;
      await db.execute(sql`
        UPDATE portfolio_suggestions SET
          advisor_approved = COALESCE(${advisorApproved !== undefined ? advisorApproved : null}, advisor_approved),
          advisor_notes = COALESCE(${advisorNotes || null}, advisor_notes),
          status = COALESCE(${status || null}, status)
        WHERE id = ${req.params.id}
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Advisor: Add custom suggestion
  app.post("/api/portfolio/:id/suggestion", requireAdvisor, async (req: any, res: any) => {
    try {
      const { type, assetClass, title, description, action, symbol, priority } = req.body;
      if (!title || !description) return res.status(400).json({ error: "title and description required" });

      const result = await db.execute(sql`
        INSERT INTO portfolio_suggestions (portfolio_id, advisor_id, type, asset_class, title, description, action, symbol, priority, advisor_approved)
        VALUES (${req.params.id}, ${req.session.userId}, ${type || "custom"}, ${assetClass || null}, ${title}, ${description}, ${action || null}, ${symbol || null}, ${priority || "medium"}, true)
        RETURNING *
      `);
      res.json((result as any).rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Investor: Respond to suggestion
  app.patch("/api/suggestion/:id/respond", requireAuth, async (req: any, res: any) => {
    try {
      const { response } = req.body;
      await db.execute(sql`
        UPDATE portfolio_suggestions SET investor_response = ${response}, status = ${response === "accepted" ? "accepted" : "rejected"}
        WHERE id = ${req.params.id}
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

    // ─── Advisor Microsite Routes ─────────────────────────────────────

  // Public: Get microsite by slug (no auth needed)
  app.get("/api/microsite/:slug", async (req: any, res: any) => {
    try {
      const { slug } = req.params;
      const result = await db.execute(sql`
        SELECT m.*, u.username, u.company_name, u.overview, u.themes, u.logo_url as user_logo,
               u.sebi_reg_number, u.active_since, u.require_risk_profiling, u.require_pmla
        FROM advisor_microsites m
        JOIN users u ON u.id = m.advisor_id
        WHERE m.slug = ${slug} AND m.is_active = true AND u.is_approved = true
        LIMIT 1
      `);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: "Microsite not found" });

      const strategies = await storage.getStrategies(row.advisor_id);
      const publishedStrategies = strategies.filter((s: any) => s.status === "Published");

      const plans = await storage.getPlans(row.advisor_id);

      // Build per-strategy plan mapping
      const strategyPlans: Record<string, any[]> = {};
      for (const s of publishedStrategies) {
        if (s.planIds && s.planIds.length > 0) {
          strategyPlans[s.id] = plans.filter((p: any) => s.planIds!.includes(p.id));
          if (strategyPlans[s.id].length === 0) strategyPlans[s.id] = plans;
        } else {
          strategyPlans[s.id] = plans;
        }
      }

      res.json({
        microsite: {
          slug: row.slug,
          tagline: row.tagline,
          about: row.about || row.overview,
          servicesOffered: row.services_offered || [],
          themeColor: row.theme_color,
          logoUrl: row.logo_url || row.user_logo,
          bannerImageUrl: row.banner_image_url,
          address: row.address,
          city: row.city,
          state: row.state,
          pincode: row.pincode,
          contactPhone: row.contact_phone,
          contactEmail: row.contact_email,
          websiteUrl: row.website_url,
          socialLinkedin: row.social_linkedin,
          socialTwitter: row.social_twitter,
          socialYoutube: row.social_youtube,
          socialTelegram: row.social_telegram,
          showPerformance: row.show_performance,
          showTestimonials: row.show_testimonials,
          showContact: row.show_contact,
          showFaq: row.show_faq,
          showAbout: row.show_about,
          testimonials: row.testimonials || [],
          faq: row.faq || [],
        },
        advisor: {
          id: row.advisor_id,
          companyName: row.company_name || row.username,
          username: row.username,
          sebiRegNumber: row.sebi_reg_number,
          themes: row.themes || [],
          activeSince: row.active_since,
          requireRiskProfiling: row.require_risk_profiling,
          requirePmla: row.require_pmla,
        },
        plans: plans.map((p: any) => ({
          id: p.id, name: p.name, amount: p.amount, durationDays: p.durationDays, code: p.code,
        })),
        strategyPlans,
        strategies: publishedStrategies.map((s: any) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          description: s.description,
          horizon: s.horizon,
          riskLevel: s.riskLevel,
          cagr: s.cagr,
          totalRecommendations: s.totalRecommendations,
        })),
      });
    } catch (err: any) {
      console.error("[Microsite] Public fetch error:", err.message);
      res.status(500).json({ error: "Failed to load microsite" });
    }
  });

  // Advisor: Get own microsite config
  app.get("/api/advisor/microsite", requireAdvisor, async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`
        SELECT * FROM advisor_microsites WHERE advisor_id = ${req.session.userId} LIMIT 1
      `);
      const row = (result as any).rows?.[0];
      if (row) {
        row.services_offered = row.services_offered || [];
      }
      if (!row) {
        const user = await storage.getUser(req.session.userId!);
        const defaultSlug = (user?.companyName || user?.username || "advisor").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 50);
        return res.json({ exists: false, suggestedSlug: defaultSlug });
      }
      res.json({ exists: true, ...row });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to get microsite" });
    }
  });

  // Advisor: Create or update microsite
  app.post("/api/advisor/microsite", requireAdvisor, async (req: any, res: any) => {
    try {
      const userId = req.session.userId!;
      const { slug, tagline, about, themeColor, logoUrl, bannerImageUrl,
              address, city, state, pincode, contactPhone, contactEmail,
              websiteUrl, socialLinkedin, socialTwitter, socialYoutube, socialTelegram,
              showPerformance, showTestimonials, showContact, showFaq, showAbout,
              testimonials, faq, servicesOffered } = req.body;

      if (!slug || slug.length < 3) return res.status(400).json({ error: "Slug must be at least 3 characters" });
      if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: "Slug can only contain lowercase letters, numbers, and hyphens" });

      const existing = await db.execute(sql`SELECT id FROM advisor_microsites WHERE advisor_id = ${userId} LIMIT 1`);

      if ((existing as any).rows?.length > 0) {
        await db.execute(sql`
          UPDATE advisor_microsites SET
            slug = ${slug}, tagline = ${tagline || null}, about = ${about || null},
            theme_color = ${themeColor || "#E53E3E"}, logo_url = ${logoUrl || null},
            banner_image_url = ${bannerImageUrl || null}, address = ${address || null},
            city = ${city || null}, state = ${state || null}, pincode = ${pincode || null},
            contact_phone = ${contactPhone || null}, contact_email = ${contactEmail || null},
            website_url = ${websiteUrl || null}, social_linkedin = ${socialLinkedin || null},
            social_twitter = ${socialTwitter || null}, social_youtube = ${socialYoutube || null},
            social_telegram = ${socialTelegram || null},
            show_performance = ${showPerformance !== false}, show_testimonials = ${!!showTestimonials},
            show_contact = ${showContact !== false}, show_faq = ${!!showFaq},
            show_about = ${showAbout !== false},
            testimonials = ${JSON.stringify(testimonials || [])},
            faq = ${JSON.stringify(faq || [])},
            services_offered = ${JSON.stringify(servicesOffered || [])},
            updated_at = NOW()
          WHERE advisor_id = ${userId}
        `);
      } else {
        const slugCheck = await db.execute(sql`SELECT id FROM advisor_microsites WHERE slug = ${slug} LIMIT 1`);
        if ((slugCheck as any).rows?.length > 0) return res.status(409).json({ error: "This URL slug is already taken" });

        await db.execute(sql`
          INSERT INTO advisor_microsites (advisor_id, slug, tagline, about, theme_color, logo_url,
            banner_image_url, address, city, state, pincode, contact_phone, contact_email,
            website_url, social_linkedin, social_twitter, social_youtube, social_telegram,
            show_performance, show_testimonials, show_contact, show_faq, show_about, testimonials, faq, services_offered)
          VALUES (${userId}, ${slug}, ${tagline || null}, ${about || null}, ${themeColor || "#E53E3E"},
            ${logoUrl || null}, ${bannerImageUrl || null}, ${address || null}, ${city || null},
            ${state || null}, ${pincode || null}, ${contactPhone || null}, ${contactEmail || null},
            ${websiteUrl || null}, ${socialLinkedin || null}, ${socialTwitter || null},
            ${socialYoutube || null}, ${socialTelegram || null},
            ${showPerformance !== false}, ${!!showTestimonials}, ${showContact !== false},
            ${!!showFaq}, ${showAbout !== false}, ${JSON.stringify(testimonials || [])},
            ${JSON.stringify(faq || [])}, ${JSON.stringify(servicesOffered || [])})
        `);
      }

      res.json({ success: true, slug });
    } catch (err: any) {
      if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
        return res.status(409).json({ error: "This URL slug is already taken" });
      }
      console.error("[Microsite] Save error:", err.message);
      res.status(500).json({ error: "Failed to save microsite" });
    }
  });

  // Advisor: Check slug availability
  app.get("/api/advisor/microsite/check-slug/:slug", requireAdvisor, async (req: any, res: any) => {
    try {
      const { slug } = req.params;
      const result = await db.execute(sql`
        SELECT advisor_id FROM advisor_microsites WHERE slug = ${slug} LIMIT 1
      `);
      const row = (result as any).rows?.[0];
      const available = !row || row.advisor_id === req.session.userId;
      res.json({ available, slug });
    } catch (err) {
      res.status(500).json({ error: "Failed to check slug" });
    }
  });

  // File upload for microsite logos/banners
  app.post("/api/advisor/microsite/upload", requireAdvisor, async (req: any, res: any) => {
    try {
      if (!req.files || !req.files.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const file = req.files.file;
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["jpg", "jpeg", "png", "webp", "svg"].includes(ext || "")) {
        return res.status(400).json({ error: "Only image files allowed (jpg, png, webp, svg)" });
      }
      const fileName = req.session.userId + "-" + Date.now() + "." + ext;
      const uploadPath = "/var/www/alphamarket/uploads/microsites/" + fileName;

      const fs = require("fs");
      if (!fs.existsSync("/var/www/alphamarket/uploads/microsites")) {
        fs.mkdirSync("/var/www/alphamarket/uploads/microsites", { recursive: true });
      }

      await file.mv(uploadPath);
      const url = "/uploads/microsites/" + fileName;
      res.json({ url, fileName });
    } catch (err: any) {
      console.error("[Microsite] Upload error:", err.message);
      res.status(500).json({ error: "Failed to upload file" });
    }
  });

    

  // ─── Advisor Bank & Payment Routes ───────────────────────────

  // Get advisor bank details (advisor sees own, admin sees any)
  app.get("/api/advisor/bank-details", requireAdvisor, async (req: any, res: any) => {
    try {
      const result = await db.execute(
        sql`SELECT * FROM advisor_bank_details WHERE advisor_id = ${req.session.userId}`
      );
      const row = ((result as any).rows || [])[0];
      res.json(row || { advisor_id: req.session.userId });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Save advisor bank details
  app.put("/api/advisor/bank-details", requireAdvisor, async (req: any, res: any) => {
    try {
      const { bankName, accountNumber, ifscCode, accountHolderName, upiId, accountType, micrCode, branchAddress } = req.body;
      const existing = await db.execute(
        sql`SELECT id FROM advisor_bank_details WHERE advisor_id = ${req.session.userId}`
      );
      if (((existing as any).rows || []).length > 0) {
        await db.execute(sql`UPDATE advisor_bank_details SET
          bank_name = ${bankName || null}, account_number = ${accountNumber || null},
          ifsc_code = ${ifscCode || null}, account_holder_name = ${accountHolderName || null},
          upi_id = ${upiId || null}, account_type = ${accountType || 'savings'},
          micr_code = ${micrCode || null}, branch_address = ${branchAddress || null}, updated_at = NOW()
          WHERE advisor_id = ${req.session.userId}`);
      } else {
        await db.execute(sql`INSERT INTO advisor_bank_details (advisor_id, bank_name, account_number, ifsc_code, account_holder_name, upi_id, account_type, micr_code, branch_address)
          VALUES (${req.session.userId}, ${bankName || null}, ${accountNumber || null}, ${ifscCode || null}, ${accountHolderName || null}, ${upiId || null}, ${accountType || 'savings'}, ${micrCode || null}, ${branchAddress || null})`);
      }
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get advisor revenue summary
  app.get("/api/advisor/revenue", requireAdvisor, async (req: any, res: any) => {
    try {
      // Total revenue = sum of all credits
      const credits = await db.execute(
        sql`SELECT COALESCE(SUM(amount), 0) as total FROM advisor_payments WHERE advisor_id = ${req.session.userId} AND type = 'credit'`
      );
      const totalRevenue = Number(((credits as any).rows || [])[0]?.total) || 0;

      // Total paid = sum of completed debits (payouts)
      const debits = await db.execute(
        sql`SELECT COALESCE(SUM(amount), 0) as total FROM advisor_payments WHERE advisor_id = ${req.session.userId} AND type = 'debit' AND status = 'completed'`
      );
      const totalPaid = Number(((debits as any).rows || [])[0]?.total) || 0;

      // Pending requests
      const pending = await db.execute(
        sql`SELECT COALESCE(SUM(amount), 0) as total FROM advisor_payments WHERE advisor_id = ${req.session.userId} AND type = 'debit' AND status = 'pending'`
      );
      const pendingAmount = Number(((pending as any).rows || [])[0]?.total) || 0;

      const claimable = totalRevenue - totalPaid - pendingAmount;

      res.json({ totalRevenue, totalPaid, pendingAmount, claimable });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get advisor payment history
  app.get("/api/advisor/payments", requireAdvisor, async (req: any, res: any) => {
    try {
      const result = await db.execute(
        sql`SELECT * FROM advisor_payments WHERE advisor_id = ${req.session.userId} ORDER BY requested_at DESC`
      );
      res.json((result as any).rows || []);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Advisor requests payment
  app.post("/api/advisor/request-payment", requireAdvisor, async (req: any, res: any) => {
    try {
      const { amount, notes } = req.body;
      if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Invalid amount" });
      await db.execute(sql`INSERT INTO advisor_payments (advisor_id, amount, type, status, notes)
        VALUES (${req.session.userId}, ${Number(amount)}, 'debit', 'pending', ${notes || 'Payment request'})`);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });



  // ─── Admin: Monetization Config ────────────────────────────────

  // Public: Get monetization config (for frontends to check limits/pricing)
  app.get("/api/monetization-config", async (_req: any, res: any) => {
    try {
      const result = await db.execute(sql`SELECT value FROM app_settings WHERE key = 'monetization_config'`);
      const row = ((result as any).rows || [])[0];
      if (row) {
        res.json(JSON.parse(row.value));
      } else {
        // Default config
        res.json({
          dyor: {
            enabled: true,
            freeTierLimit: 5,
            freeTierPeriod: "month",
            proPrice: 299,
            proPeriod: "month",
            enterprisePrice: 0,
            label: "DYOR Research Tool",
          },
          stockAnalyzer: {
            enabled: true,
            freeTierLimit: 3,
            freeTierPeriod: "month",
            proPrice: 499,
            proPeriod: "month",
            label: "Stock Analyzer (AlphaLens)",
          },
          mfAnalyzer: {
            enabled: true,
            freeTierLimit: 2,
            freeTierPeriod: "month",
            proPrice: 399,
            proPeriod: "month",
            label: "MF Analyzer",
          },
          portfolioTool: {
            enabled: true,
            freeFeatures: "Basic portfolio view + sync",
            proPrice: 499,
            proPeriod: "month",
            quarterlyPrice: 1999,
            label: "Portfolio Evaluation Tool",
          },
          advisorPlatform: {
            enabled: true,
            freeClients: 10,
            freeStrategies: 1,
            proPrice: 2999,
            proPeriod: "month",
            label: "Advisor Platform",
          },
          onboarding: {
            ekycCost: 10,
            esignCost: 15,
            pmlaCost: 3,
            strategy: "absorb",
          },
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Get monetization config
  app.get("/api/admin/monetization-config", requireAdmin, async (_req: any, res: any) => {
    try {
      const result = await db.execute(sql`SELECT value FROM app_settings WHERE key = 'monetization_config'`);
      const row = ((result as any).rows || [])[0];
      if (row) {
        res.json(JSON.parse(row.value));
      } else {
        res.json(null);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Save monetization config
  app.put("/api/admin/monetization-config", requireAdmin, async (req: any, res: any) => {
    try {
      const config = req.body;
      if (!config || typeof config !== "object") return res.status(400).json({ error: "Invalid config" });
      const jsonStr = JSON.stringify(config);
      await db.execute(sql`INSERT INTO app_settings (key, value, updated_at)
        VALUES ('monetization_config', ${jsonStr}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = ${jsonStr}, updated_at = NOW()`);
      clearConfigCache();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  // ─── Admin: Advisor Analytics ────────────────────────────────

  // Admin: Get per-advisor analytics
  app.get("/api/admin/advisor/:id/analytics", requireAdmin, async (req: any, res: any) => {
    try {
      const advisorId = req.params.id;
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0,0,0,0);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfYear = new Date(now.getFullYear(), 0, 1);

      // A1: Calls + Positions Published & Performance
      const allCalls = await db.execute(
        sql`SELECT c.*, s.name as strategy_name, 'call' as rec_type FROM calls c
            JOIN strategies s ON s.id = c.strategy_id
            WHERE s.advisor_id = ${advisorId}`
      );
      const allPositions = await db.execute(
        sql`SELECT p.*, s.name as strategy_name, 'position' as rec_type FROM positions p
            JOIN strategies s ON s.id = p.strategy_id
            WHERE s.advisor_id = ${advisorId}`
      );
      const callRows = [...((allCalls as any).rows || []), ...((allPositions as any).rows || [])];

      const publishedRows = callRows.filter((c: any) => c.is_published === true || c.publish_mode === 'live');
      const activeRecs = callRows.filter((c: any) => c.status === 'Active').length;

      const callsThisWeek = callRows.filter((c: any) => new Date(c.created_at) >= startOfWeek).length;
      const callsThisMonth = callRows.filter((c: any) => new Date(c.created_at) >= startOfMonth).length;
      const callsYTD = callRows.filter((c: any) => new Date(c.created_at) >= startOfYear).length;

      const closedCalls = callRows.filter((c: any) => c.status === 'Closed' && c.gain_percent !== null);
      const hitRate = closedCalls.length > 0
        ? (closedCalls.filter((c: any) => Number(c.gain_percent) > 0).length / closedCalls.length * 100).toFixed(1)
        : "0";
      const avgReturn = closedCalls.length > 0
        ? (closedCalls.reduce((sum: number, c: any) => sum + Number(c.gain_percent || 0), 0) / closedCalls.length).toFixed(2)
        : "0";

      // A2: Customers per Advisor
      const subsResult = await db.execute(
        sql`SELECT s.*, u.username, u.email, u.created_at as user_created_at
            FROM subscriptions s JOIN users u ON u.id = s.user_id
            WHERE s.advisor_id = ${advisorId}`
      );
      const subRows = (subsResult as any).rows || [];
      const uniqueSubscribers = [...new Set(subRows.map((s: any) => s.user_id))];
      const totalSubscribers = uniqueSubscribers.length;
      const newThisWeek = subRows.filter((s: any) => new Date(s.created_at) >= startOfWeek)
        .map((s: any) => s.user_id).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).length;
      const newThisMonth = subRows.filter((s: any) => new Date(s.created_at) >= startOfMonth)
        .map((s: any) => s.user_id).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).length;
      const newYTD = subRows.filter((s: any) => new Date(s.created_at) >= startOfYear)
        .map((s: any) => s.user_id).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).length;
      const activeSubs = subRows.filter((s: any) => s.status === 'active').length;
      const churned = subRows.filter((s: any) => s.status !== 'active').length;

      // A3: Portfolio Analytics
      const portfolioResult = await db.execute(
        sql`SELECT cp.*, u.username FROM customer_portfolios cp
            JOIN users u ON u.id = cp.user_id
            JOIN subscriptions s ON s.user_id = cp.user_id AND s.advisor_id = ${advisorId}`
      );
      const portfolioRows = (portfolioResult as any).rows || [];
      const portfolioIds = portfolioRows.map((p: any) => p.id);

      let totalAUM = 0;
      let portfolioSizes: number[] = [];
      if (portfolioIds.length > 0) {
        const holdingsResult = await db.execute(
          sql`SELECT portfolio_id, SUM(CAST(current_value AS numeric)) as total_value
              FROM portfolio_holdings WHERE portfolio_id IN (${sql.join(portfolioIds.map((id: string) => sql`${id}`), sql`, `)})
              GROUP BY portfolio_id`
        );
        const holdingRows = (holdingsResult as any).rows || [];
        for (const h of holdingRows) {
          const val = Number(h.total_value) || 0;
          totalAUM += val;
          portfolioSizes.push(val);
        }
      }
      const avgPortfolioSize = portfolioSizes.length > 0 ? totalAUM / portfolioSizes.length : 0;
      const largestPortfolio = portfolioSizes.length > 0 ? Math.max(...portfolioSizes) : 0;

      // Size buckets
      const sizeBuckets = { 'Under 1L': 0, '1-5L': 0, '5-10L': 0, '10-25L': 0, '25-50L': 0, '50L+': 0 };
      for (const s of portfolioSizes) {
        if (s < 100000) sizeBuckets['Under 1L']++;
        else if (s < 500000) sizeBuckets['1-5L']++;
        else if (s < 1000000) sizeBuckets['5-10L']++;
        else if (s < 2500000) sizeBuckets['10-25L']++;
        else if (s < 5000000) sizeBuckets['25-50L']++;
        else sizeBuckets['50L+']++;
      }

      // A4: Sales Dashboard (from advisor_payments)
      const salesResult = await db.execute(
        sql`SELECT * FROM advisor_payments WHERE advisor_id = ${advisorId} AND type = 'credit'`
      );
      const salesRows = (salesResult as any).rows || [];
      const totalSalesRevenue = salesRows.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
      const weeklySales = salesRows
        .filter((r: any) => new Date(r.requested_at) >= startOfWeek)
        .reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
      const monthlySales = salesRows
        .filter((r: any) => new Date(r.requested_at) >= startOfMonth)
        .reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
      const ytdSales = salesRows
        .filter((r: any) => new Date(r.requested_at) >= startOfYear)
        .reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);

      // Also include subscription payments from the payments table
      const subPayments = await db.execute(
        sql`SELECT * FROM payments WHERE advisor_id = ${advisorId} AND status = 'PAID'`
      );
      const subPayRows = (subPayments as any).rows || [];
      const totalSubRevenue = subPayRows.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
      const weeklySubRevenue = subPayRows
        .filter((r: any) => r.paid_at && new Date(r.paid_at) >= startOfWeek)
        .reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
      const monthlySubRevenue = subPayRows
        .filter((r: any) => r.paid_at && new Date(r.paid_at) >= startOfMonth)
        .reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
      const ytdSubRevenue = subPayRows
        .filter((r: any) => r.paid_at && new Date(r.paid_at) >= startOfYear)
        .reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);

      res.json({
        calls: {
          total: callRows.length,
          published: publishedRows.length,
          active: activeRecs,
          closed: closedCalls.length,
          thisWeek: callsThisWeek,
          thisMonth: callsThisMonth,
          ytd: callsYTD,
          hitRate: Number(hitRate),
          avgReturn: Number(avgReturn),
          closedCount: closedCalls.length,
        },
        customers: {
          totalSubscribers,
          newThisWeek,
          newThisMonth,
          newYTD,
          activeSubs,
          churned,
        },
        portfolios: {
          totalPortfolios: portfolioRows.length,
          totalAUM,
          avgPortfolioSize,
          largestPortfolio,
          sizeBuckets,
        },
        sales: {
          totalRevenue: totalSalesRevenue + totalSubRevenue,
          weeklySales: weeklySales + weeklySubRevenue,
          monthlySales: monthlySales + monthlySubRevenue,
          ytdSales: ytdSales + ytdSubRevenue,
          advisorPayments: totalSalesRevenue,
          subscriptionRevenue: totalSubRevenue,
        },
      });
    } catch (err: any) {
      console.error("[Admin Analytics] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Get overall admin dashboard stats
  app.get("/api/admin/dashboard-stats", requireAdmin, async (_req: any, res: any) => {
    try {
      const advisorCount = await db.execute(sql`SELECT count(*) FROM users WHERE role = 'advisor'`);
      const investorCount = await db.execute(sql`SELECT count(*) FROM users WHERE role = 'investor'`);
      const strategyCount = await db.execute(sql`SELECT count(*) FROM strategies`);
      const activeSubCount = await db.execute(sql`SELECT count(*) FROM subscriptions WHERE status = 'active'`);
      const totalAUM = await db.execute(
        sql`SELECT COALESCE(SUM(CAST(current_value AS numeric)), 0) as total FROM portfolio_holdings`
      );
      const totalRevenue = await db.execute(
        sql`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'PAID'`
      );
      const totalAdvisorCredits = await db.execute(
        sql`SELECT COALESCE(SUM(amount), 0) as total FROM advisor_payments WHERE type = 'credit'`
      );
      const callsThisMonth = await db.execute(
        sql`SELECT count(*) FROM calls WHERE (is_published = true OR publish_mode = 'live')
            AND created_at >= date_trunc('month', CURRENT_DATE)`
      );

      res.json({
        totalAdvisors: Number(((advisorCount as any).rows || [])[0]?.count) || 0,
        totalInvestors: Number(((investorCount as any).rows || [])[0]?.count) || 0,
        totalStrategies: Number(((strategyCount as any).rows || [])[0]?.count) || 0,
        activeSubscriptions: Number(((activeSubCount as any).rows || [])[0]?.count) || 0,
        totalAUM: Number(((totalAUM as any).rows || [])[0]?.total) || 0,
        totalRevenue: Number(((totalRevenue as any).rows || [])[0]?.total) || 0,
        totalAdvisorCredits: Number(((totalAdvisorCredits as any).rows || [])[0]?.total) || 0,
        callsThisMonth: Number(((callsThisMonth as any).rows || [])[0]?.count) || 0,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  // ─── Admin: Per-Advisor Breakup Dashboard ────────────────────────
  app.get("/api/admin/advisor-breakup", requireAdmin, async (_req: any, res: any) => {
    try {
      // Get all advisors
      const advisors = await db.execute(
        sql`SELECT id, username, email, company_name, sebi_reg_number, is_approved, created_at, logo_url
             FROM users WHERE role = 'advisor' ORDER BY created_at DESC`
      );
      const advisorRows = (advisors as any).rows || [];

      const breakup = [];
      for (const adv of advisorRows) {
        // Strategies count & list
        const strats = await db.execute(
          sql`SELECT id, name, type, status, horizon FROM strategies WHERE advisor_id = ${adv.id}`
        );
        const stratRows = (strats as any).rows || [];

        // Calls (stock recommendations) count & this month
        const callStats = await db.execute(
          sql`SELECT
                COUNT(*) as total_calls,
                COUNT(*) FILTER (WHERE c.status = 'Active') as active_calls,
                COUNT(*) FILTER (WHERE c.status = 'Closed') as closed_calls,
                COUNT(*) FILTER (WHERE c.created_at >= date_trunc('month', CURRENT_DATE)) as calls_this_month,
                COUNT(*) FILTER (WHERE c.status = 'Closed' AND CAST(c.gain_percent AS numeric) > 0) as winning_calls,
                COUNT(*) FILTER (WHERE c.status = 'Closed' AND c.gain_percent IS NOT NULL) as settled_calls
              FROM calls c JOIN strategies s ON s.id = c.strategy_id
              WHERE s.advisor_id = ${adv.id}`
        );
        const cs = ((callStats as any).rows || [])[0] || {};

        // Positions (F&O calls)
        const posStats = await db.execute(
          sql`SELECT
                COUNT(*) as total_positions,
                COUNT(*) FILTER (WHERE p.status = 'Active') as active_positions,
                COUNT(*) FILTER (WHERE p.created_at >= date_trunc('month', CURRENT_DATE)) as positions_this_month
              FROM positions p JOIN strategies s ON s.id = p.strategy_id
              WHERE s.advisor_id = ${adv.id}`
        );
        const ps = ((posStats as any).rows || [])[0] || {};

        // Subscriptions & subscribers
        const subStats = await db.execute(
          sql`SELECT
                COUNT(*) as total_subs,
                COUNT(*) FILTER (WHERE status = 'active') as active_subs
              FROM subscriptions WHERE advisor_id = ${adv.id}`
        );
        const ss = ((subStats as any).rows || [])[0] || {};

        // Revenue
        const revStats = await db.execute(
          sql`SELECT COALESCE(SUM(amount), 0) as total_revenue
              FROM payments WHERE status = 'PAID'
              AND subscription_id IN (SELECT id FROM subscriptions WHERE advisor_id = ${adv.id})`
        );
        const rv = ((revStats as any).rows || [])[0] || {};

        // Advisor credits
        const creditStats = await db.execute(
          sql`SELECT
                COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) as total_credits,
                COALESCE(SUM(amount) FILTER (WHERE type = 'payout'), 0) as total_payouts
              FROM advisor_payments WHERE advisor_id = ${adv.id}`
        );
        const cr = ((creditStats as any).rows || [])[0] || {};

        // Portfolio AUM (from subscribers who shared portfolios)
        const aumStats = await db.execute(
          sql`SELECT
                COUNT(DISTINCT cp.id) as portfolio_count,
                COALESCE(SUM(CAST(ph.current_value AS numeric)), 0) as total_aum,
                COUNT(DISTINCT CASE WHEN ph.asset_class = 'mutual_fund' OR ph.isin LIKE 'INF%' THEN cp.id END) as mf_portfolios,
                COUNT(DISTINCT CASE WHEN ph.asset_class != 'mutual_fund' AND (ph.isin IS NULL OR ph.isin NOT LIKE 'INF%') THEN cp.id END) as stock_portfolios,
                COALESCE(SUM(CAST(ph.current_value AS numeric)) FILTER (WHERE ph.asset_class = 'mutual_fund' OR ph.isin LIKE 'INF%'), 0) as mf_aum,
                COALESCE(SUM(CAST(ph.current_value AS numeric)) FILTER (WHERE ph.asset_class != 'mutual_fund' AND (ph.isin IS NULL OR ph.isin NOT LIKE 'INF%')), 0) as stock_aum
              FROM customer_portfolios cp
              JOIN portfolio_holdings ph ON ph.portfolio_id = cp.id
              WHERE cp.share_with_advisors = true
              AND cp.user_id IN (SELECT user_id FROM subscriptions WHERE advisor_id = ${adv.id} AND status = 'active')`
        );
        const aum = ((aumStats as any).rows || [])[0] || {};

        // Strategy type breakup
        const stockStrategies = stratRows.filter((s: any) => s.type === 'Stock' || s.type === 'Equity').length;
        const fnoStrategies = stratRows.filter((s: any) => ['Option', 'Future', 'CommodityFuture'].includes(s.type)).length;
        const otherStrategies = stratRows.length - stockStrategies - fnoStrategies;

        // Hit rate
        const settledCount = Number(cs.settled_calls) || 0;
        const winCount = Number(cs.winning_calls) || 0;
        const hitRate = settledCount > 0 ? ((winCount / settledCount) * 100).toFixed(1) : "N/A";

        breakup.push({
          advisor_id: adv.id,
          name: adv.username || adv.company_name || "Unknown",
          email: adv.email,
          company: adv.company_name || "",
          sebi_reg: adv.sebi_reg_number || "",
          is_approved: adv.is_approved,
          joined: adv.created_at,
          logo: adv.logo_url,

          strategies: {
            total: stratRows.length,
            stock: stockStrategies,
            fno: fnoStrategies,
            other: otherStrategies,
            list: stratRows.map((s: any) => ({ id: s.id, name: s.name, type: s.type, status: s.status })),
          },

          calls: {
            total: Number(cs.total_calls) || 0,
            active: Number(cs.active_calls) || 0,
            closed: Number(cs.closed_calls) || 0,
            this_month: Number(cs.calls_this_month) || 0,
            hit_rate: hitRate,
          },

          positions: {
            total: Number(ps.total_positions) || 0,
            active: Number(ps.active_positions) || 0,
            this_month: Number(ps.positions_this_month) || 0,
          },

          subscribers: {
            total: Number(ss.total_subs) || 0,
            active: Number(ss.active_subs) || 0,
          },

          revenue: {
            total: Number(rv.total_revenue) || 0,
            credits: Number(cr.total_credits) || 0,
            payouts: Number(cr.total_payouts) || 0,
          },

          portfolios: {
            total: Number(aum.portfolio_count) || 0,
            stock_count: Number(aum.stock_portfolios) || 0,
            mf_count: Number(aum.mf_portfolios) || 0,
            total_aum: Number(aum.total_aum) || 0,
            stock_aum: Number(aum.stock_aum) || 0,
            mf_aum: Number(aum.mf_aum) || 0,
          },
        });
      }

      // Sort by total AUM descending
      breakup.sort((a: any, b: any) => b.portfolios.total_aum - a.portfolios.total_aum);

      res.json({
        advisors: breakup,
        total_advisors: breakup.length,
        summary: {
          total_strategies: breakup.reduce((s: number, a: any) => s + a.strategies.total, 0),
          total_calls: breakup.reduce((s: number, a: any) => s + a.calls.total, 0),
          total_aum: breakup.reduce((s: number, a: any) => s + a.portfolios.total_aum, 0),
          total_revenue: breakup.reduce((s: number, a: any) => s + a.revenue.total, 0),
          active_subscribers: breakup.reduce((s: number, a: any) => s + a.subscribers.active, 0),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


    
  // ─── External API: DYOR → AlphaMarket Bridge ────────────────────────
  // API-key authenticated endpoints for cross-platform integration

  const DYOR_API_KEY = "dyor_bridge_2026_alphamarket";

  function requireDyorApiKey(req: any, res: any, next: any) {
    const key = req.headers["x-dyor-api-key"] || req.query.api_key;
    if (key !== DYOR_API_KEY) return res.status(401).json({ error: "Invalid API key" });
    next();
  }

  // Get advisor's strategies (for DYOR strategy selector)
  app.get("/api/external/advisor-strategies", requireDyorApiKey, async (req: any, res: any) => {
    try {
      const email = req.query.email;
      if (!email) return res.status(400).json({ error: "email required" });
      const userResult = await db.execute(sql`SELECT id, username, company_name FROM users WHERE email = ${email} AND role = 'advisor'`);
      const user = ((userResult as any).rows || [])[0];
      if (!user) return res.status(404).json({ error: "Advisor not found" });
      const strats = await db.execute(sql`SELECT id, name, type, status, horizon FROM strategies WHERE advisor_id = ${user.id}`);
      res.json({
        advisor_id: user.id,
        advisor_name: user.username || user.company_name,
        strategies: ((strats as any).rows || []),
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Publish a stock call from DYOR
  app.post("/api/external/publish-call", requireDyorApiKey, async (req: any, res: any) => {
    try {
      const { advisor_email, strategy_id, stock_name, action, buy_range_start, buy_range_end,
              target_price, stop_loss, rationale, profit_goal, publish_mode } = req.body;
      if (!advisor_email || !strategy_id || !stock_name || !action) {
        return res.status(400).json({ error: "advisor_email, strategy_id, stock_name, action required" });
      }
      // Verify advisor owns the strategy
      const userResult = await db.execute(sql`SELECT id FROM users WHERE email = ${advisor_email} AND role = 'advisor'`);
      const user = ((userResult as any).rows || [])[0];
      if (!user) return res.status(404).json({ error: "Advisor not found" });
      const stratResult = await db.execute(sql`SELECT id, advisor_id FROM strategies WHERE id = ${strategy_id}`);
      const strat = ((stratResult as any).rows || [])[0];
      if (!strat || strat.advisor_id !== user.id) return res.status(403).json({ error: "Strategy does not belong to this advisor" });

      const mode = publish_mode || "live";
      const isPublished = mode === "live";
      const c = await storage.createCall({
        strategyId: strategy_id,
        stockName: stock_name,
        action: action,
        buyRangeStart: buy_range_start || null,
        buyRangeEnd: buy_range_end || null,
        targetPrice: target_price || null,
        stopLoss: stop_loss || null,
        rationale: rationale || "Published from DYOR Research Platform",
        profitGoal: profit_goal || null,
        publishMode: mode,
        isPublished: isPublished,
        source: "dyor",
      });

      const strategy = await storage.getStrategy(strategy_id);
      if (isPublished && strategy) {
          const subPayload = buildNewCallSubscriberNotification(c, strategy.name);
          notifyStrategySubscribers(strategy_id, strategy.name, "new_call", subPayload);
      }
      if (isPublished && strategy) {
          fireWebhookEvent("CALL_CREATED", buildCallEventData(c, strategy), strategy.advisorId).catch((err: any) => console.error("[routes 4670 bulk CREATE] fireWebhookEvent failed:", err));
        }
      res.json({ success: true, call_id: c.id, published: isPublished, source: "dyor" });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Publish an F&O position from DYOR
  app.post("/api/external/publish-position", requireDyorApiKey, async (req: any, res: any) => {
    try {
      const { advisor_email, strategy_id, symbol, segment, call_put, buy_sell,
              entry_price, target, stop_loss, lots, expiry, strike_price,
              rationale, publish_mode } = req.body;
      if (!advisor_email || !strategy_id || !symbol || !segment) {
        return res.status(400).json({ error: "advisor_email, strategy_id, symbol, segment required" });
      }
      const userResult = await db.execute(sql`SELECT id FROM users WHERE email = ${advisor_email} AND role = 'advisor'`);
      const user = ((userResult as any).rows || [])[0];
      if (!user) return res.status(404).json({ error: "Advisor not found" });
      const stratResult = await db.execute(sql`SELECT id, advisor_id FROM strategies WHERE id = ${strategy_id}`);
      const strat = ((stratResult as any).rows || [])[0];
      if (!strat || strat.advisor_id !== user.id) return res.status(403).json({ error: "Strategy does not belong to this advisor" });

      const mode = publish_mode || "live";
      const isPublished = mode === "live" || mode === "watchlist";
      const p = await storage.createPosition({
        strategyId: strategy_id,
        symbol: symbol,
        segment: segment || "EQ",
        callPut: call_put || null,
        buySell: buy_sell || "BUY",
        entryPrice: entry_price || null,
        target: target || null,
        stopLoss: stop_loss || null,
        lots: lots || 1,
        expiry: expiry || null,
        strikePrice: strike_price || null,
        rationale: rationale || "Published from DYOR Research Platform",
        publishMode: mode,
        isPublished: isPublished,
        source: "dyor",
      });

      const strategy = await storage.getStrategy(strategy_id);
      if (isPublished && strategy) {
          const subPayload = buildNewPositionSubscriberNotification(p, strategy.name);
          notifyStrategySubscribers(strategy_id, strategy.name, "new_position", subPayload);
      }
      if (isPublished && strategy) {
          fireWebhookEvent("POSITION_CREATED", buildPositionEventData(p, strategy), strategy.advisorId).catch((err: any) => console.error("[routes 4720 bulk POSITION] fireWebhookEvent failed:", err));
        }
      res.json({ success: true, position_id: p.id, published: isPublished, source: "dyor" });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });



  // Check if advisor has DYOR publish permission
  app.get("/api/external/check-publish-permission", requireDyorApiKey, async (req: any, res: any) => {
    try {
      const email = req.query.email;
      if (!email) return res.status(400).json({ error: "email required" });
      const userResult = await db.execute(sql`SELECT id, username, is_approved FROM users WHERE email = ${email} AND role = 'advisor'`);
      const user = ((userResult as any).rows || [])[0];
      if (!user) return res.json({ allowed: false, reason: "not_advisor" });
      if (!user.is_approved) return res.json({ allowed: false, reason: "advisor_not_approved" });
      const permResult = await db.execute(sql`SELECT status FROM dyor_publish_permissions WHERE email = ${email} ORDER BY requested_at DESC LIMIT 1`);
      const perm = ((permResult as any).rows || [])[0];
      if (!perm) return res.json({ allowed: false, reason: "not_requested", advisor_name: user.username });
      if (perm.status === 'approved') return res.json({ allowed: true, reason: "approved" });
      if (perm.status === 'rejected') return res.json({ allowed: false, reason: "rejected" });
      return res.json({ allowed: false, reason: "pending" });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Request DYOR publish permission
  app.post("/api/external/request-publish-permission", requireDyorApiKey, async (req: any, res: any) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "email required" });
      const userResult = await db.execute(sql`SELECT id, username, company_name, sebi_reg_number FROM users WHERE email = ${email} AND role = 'advisor'`);
      const user = ((userResult as any).rows || [])[0];
      if (!user) return res.status(404).json({ error: "Not registered as advisor on AlphaMarket" });
      // Check if already requested
      const existing = await db.execute(sql`SELECT id, status FROM dyor_publish_permissions WHERE email = ${email} ORDER BY requested_at DESC LIMIT 1`);
      const ex = ((existing as any).rows || [])[0];
      if (ex && ex.status === 'approved') return res.json({ success: true, status: "already_approved" });
      if (ex && ex.status === 'pending') return res.json({ success: true, status: "already_pending" });
      // Create request
      await db.execute(sql`INSERT INTO dyor_publish_permissions (advisor_id, email, status) VALUES (${user.id}, ${email}, 'pending')`);

      // Send email notifications via SendGrid
      try {
        const sgMail = require("@sendgrid/mail");
        sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");
        const fromEmail = process.env.SENDGRID_FROM_EMAIL || "hello@alphamarket.co.in";
        const advisorName = user.username || email;
        const company = user.company_name || "N/A";
        const sebi = user.sebi_reg_number || "N/A";

        // Email 1: Notify admin
        await sgMail.send({
          to: "hello@alphamarket.co.in",
          from: fromEmail,
          subject: `[AlphaMarket] New Publish Permission Request — ${advisorName}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
              <div style="background:#0D1B2A;padding:20px;text-align:center">
                <h2 style="color:#D4A017;margin:0">AlphaMarket Admin Alert</h2>
                <p style="color:#93C5FD;margin:4px 0 0">New DYOR Publish Permission Request</p>
              </div>
              <div style="padding:24px;background:#f8f9fa">
                <p style="color:#334155">A new advisor has requested permission to publish on DYOR:</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0">
                  <tr style="background:#e8edf4"><td style="padding:8px 12px;font-weight:bold;color:#0D1B2A;width:40%">Advisor Name</td><td style="padding:8px 12px;color:#334155">${advisorName}</td></tr>
                  <tr><td style="padding:8px 12px;font-weight:bold;color:#0D1B2A">Email</td><td style="padding:8px 12px;color:#334155">${email}</td></tr>
                  <tr style="background:#e8edf4"><td style="padding:8px 12px;font-weight:bold;color:#0D1B2A">Company</td><td style="padding:8px 12px;color:#334155">${company}</td></tr>
                  <tr><td style="padding:8px 12px;font-weight:bold;color:#0D1B2A">SEBI Reg No.</td><td style="padding:8px 12px;color:#334155">${sebi}</td></tr>
                  <tr style="background:#e8edf4"><td style="padding:8px 12px;font-weight:bold;color:#0D1B2A">Requested At</td><td style="padding:8px 12px;color:#334155">${new Date().toLocaleString("en-IN", {timeZone:"Asia/Kolkata"})}</td></tr>
                </table>
                <div style="text-align:center;margin:24px 0">
                  <a href="https://alphamarket.co.in/admin/dyor-publish-requests" style="background:#0D1B2A;color:#D4A017;padding:12px 28px;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px">Review Request in Admin Panel</a>
                </div>
                <p style="color:#647080;font-size:12px;text-align:center">AlphaMarket Admin System — hello@alphamarket.co.in</p>
              </div>
            </div>`,
        });

        // Email 2: Confirm to advisor
        await sgMail.send({
          to: email,
          from: fromEmail,
          subject: `Your AlphaMarket Publish Permission Request Has Been Received`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
              <div style="background:#0D1B2A;padding:20px;text-align:center">
                <h2 style="color:#D4A017;margin:0">AlphaMarket</h2>
                <p style="color:#93C5FD;margin:4px 0 0">Publish Permission Request Received</p>
              </div>
              <div style="padding:24px;background:#f8f9fa">
                <p style="color:#334155">Hi ${advisorName},</p>
                <p style="color:#334155">Thank you for requesting publish permission on <strong>DYOR by AlphaMarket</strong>. Your request has been received and is currently under review.</p>
                <div style="background:#FDFAED;border-left:4px solid #D4A017;padding:12px 16px;margin:16px 0">
                  <p style="margin:0;color:#334155"><strong>What happens next?</strong></p>
                  <ul style="color:#334155;margin:8px 0 0;padding-left:16px">
                    <li>Our team will verify your SEBI registration details</li>
                    <li>You will receive an email once your request is approved or if we need more information</li>
                    <li>Typical review time: 1–2 business days</li>
                  </ul>
                </div>
                <p style="color:#334155">If you have any questions, please reply to this email or reach us at <a href="mailto:hello@alphamarket.co.in" style="color:#0D1B2A">hello@alphamarket.co.in</a>.</p>
                <p style="color:#334155">Regards,<br><strong>AlphaMarket Team</strong></p>
                <p style="color:#647080;font-size:11px;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px">AlphaMarket Research Intelligence Platform · alphamarket.co.in<br>This is an automated notification. Please do not reply directly to this message.</p>
              </div>
            </div>`,
        });
      } catch (emailErr: any) {
        console.error("[Email] Failed to send publish permission notification:", emailErr.message);
        // Don't fail the request if email fails
      }

      res.json({ success: true, status: "requested", message: "Request submitted. Admin will review and approve." });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Admin: View DYOR publish requests
  app.get("/api/admin/dyor-publish-requests", requireAdmin, async (_req: any, res: any) => {
    try {
      const result = await db.execute(sql`SELECT dp.*, u.username, u.company_name, u.sebi_reg_number FROM dyor_publish_permissions dp LEFT JOIN users u ON u.id = dp.advisor_id ORDER BY dp.requested_at DESC`);
      res.json((result as any).rows || []);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Admin: Approve/Reject DYOR publish request
  app.post("/api/admin/dyor-publish-requests/:id/approve", requireAdmin, async (req: any, res: any) => {
    try {
      const action = req.body.action || 'approve';
      const status = action === 'reject' ? 'rejected' : 'approved';
      await db.execute(sql`UPDATE dyor_publish_permissions SET status = ${status}, approved_at = NOW(), approved_by = ${req.session.userId} WHERE id = ${parseInt(req.params.id)}`);

      // Send approval/rejection email to advisor
      try {
        const permResult = await db.execute(sql`SELECT dp.email, u.username, u.company_name FROM dyor_publish_permissions dp LEFT JOIN users u ON u.id = dp.advisor_id WHERE dp.id = ${parseInt(req.params.id)}`);
        const perm = ((permResult as any).rows || [])[0];
        if (perm?.email) {
          const sgMail = require("@sendgrid/mail");
          sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");
          const fromEmail = process.env.SENDGRID_FROM_EMAIL || "hello@alphamarket.co.in";
          const advisorName = perm.username || perm.email;
          const isApproved = status === "approved";
          await sgMail.send({
            to: perm.email,
            from: fromEmail,
            subject: isApproved
              ? `Your AlphaMarket Publish Permission Has Been Approved`
              : `Update on Your AlphaMarket Publish Permission Request`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                <div style="background:#0D1B2A;padding:20px;text-align:center">
                  <h2 style="color:#D4A017;margin:0">AlphaMarket</h2>
                  <p style="color:${isApproved ? "#86EFAC" : "#FCA5A5"};margin:4px 0 0">${isApproved ? "Publish Permission Approved ✓" : "Publish Permission Request Update"}</p>
                </div>
                <div style="padding:24px;background:#f8f9fa">
                  <p style="color:#334155">Hi ${advisorName},</p>
                  ${isApproved ? `
                  <div style="background:#F0FDF4;border-left:4px solid #16A34A;padding:12px 16px;margin:16px 0">
                    <p style="margin:0;color:#166534;font-weight:bold">Your publish permission has been approved!</p>
                    <p style="margin:8px 0 0;color:#166534">You can now publish investment ideas and advisory calls on DYOR by AlphaMarket.</p>
                  </div>
                  <p style="color:#334155">Log in to <a href="https://dyor.alphamarket.co.in" style="color:#0D1B2A;font-weight:bold">DYOR</a> and start publishing your research to your subscribers.</p>
                  ` : `
                  <div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:12px 16px;margin:16px 0">
                    <p style="margin:0;color:#B91C1C;font-weight:bold">Your publish permission request was not approved at this time.</p>
                    <p style="margin:8px 0 0;color:#B91C1C">Please contact us at hello@alphamarket.co.in for more information or to reapply.</p>
                  </div>
                  `}
                  <p style="color:#334155">For any questions, reach us at <a href="mailto:hello@alphamarket.co.in" style="color:#0D1B2A">hello@alphamarket.co.in</a>.</p>
                  <p style="color:#334155">Regards,<br><strong>AlphaMarket Team</strong></p>
                  <p style="color:#647080;font-size:11px;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px">AlphaMarket Research Intelligence Platform · alphamarket.co.in</p>
                </div>
              </div>`,
          });
        }
      } catch (emailErr: any) {
        console.error("[Email] Failed to send approval notification:", emailErr.message);
      }

      res.json({ success: true, status });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });


    // ─── Admin: Bank & Payment Management ────────────────────────

  // Admin: View advisor bank details
  app.get("/api/admin/advisor/:id/bank-details", requireAdmin, async (req: any, res: any) => {
    try {
      const result = await db.execute(
        sql`SELECT b.*, u.username, u.company_name, u.email FROM advisor_bank_details b
            JOIN users u ON u.id = b.advisor_id WHERE b.advisor_id = ${req.params.id}`
      );
      res.json(((result as any).rows || [])[0] || null);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Admin: View advisor revenue + payments
  app.get("/api/admin/advisor/:id/payments", requireAdmin, async (req: any, res: any) => {
    try {
      const payments = await db.execute(
        sql`SELECT * FROM advisor_payments WHERE advisor_id = ${req.params.id} ORDER BY requested_at DESC`
      );
      const credits = await db.execute(
        sql`SELECT COALESCE(SUM(amount), 0) as total FROM advisor_payments WHERE advisor_id = ${req.params.id} AND type = 'credit'`
      );
      const debits = await db.execute(
        sql`SELECT COALESCE(SUM(amount), 0) as total FROM advisor_payments WHERE advisor_id = ${req.params.id} AND type = 'debit' AND status = 'completed'`
      );
      const pending = await db.execute(
        sql`SELECT COALESCE(SUM(amount), 0) as total FROM advisor_payments WHERE advisor_id = ${req.params.id} AND type = 'debit' AND status = 'pending'`
      );
      const totalRevenue = Number(((credits as any).rows || [])[0]?.total) || 0;
      const totalPaid = Number(((debits as any).rows || [])[0]?.total) || 0;
      const pendingAmount = Number(((pending as any).rows || [])[0]?.total) || 0;
      res.json({
        payments: (payments as any).rows || [],
        summary: { totalRevenue, totalPaid, pendingAmount, claimable: totalRevenue - totalPaid - pendingAmount }
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Admin: Add revenue credit to advisor
  app.post("/api/admin/advisor/:id/add-revenue", requireAdmin, async (req: any, res: any) => {
    try {
      const { amount, notes } = req.body;
      if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Invalid amount" });
      await db.execute(sql`INSERT INTO advisor_payments (advisor_id, amount, type, status, notes, processed_by, processed_at)
        VALUES (${req.params.id}, ${Number(amount)}, 'credit', 'completed', ${notes || 'Revenue credit'}, ${req.session.userId}, NOW())`);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Admin: Process payment (approve/reject pending request)
  app.put("/api/admin/advisor/:id/process-payment/:paymentId", requireAdmin, async (req: any, res: any) => {
    try {
      const { status, notes } = req.body;
      if (!["completed", "rejected"].includes(status)) return res.status(400).json({ error: "Invalid status" });
      await db.execute(sql`UPDATE advisor_payments SET
        status = ${status}, processed_by = ${req.session.userId}, processed_at = NOW(),
        notes = COALESCE(${notes}, notes)
        WHERE id = ${req.params.paymentId} AND advisor_id = ${req.params.id}`);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

    // ─── Advisor Branding Routes ─────────────────────────────────

  // Upload advisor logo for PDF reports
  app.post("/api/advisor/branding/upload-logo", requireAdvisor, async (req: any, res: any) => {
    try {
      if (!req.files || !req.files.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const file = req.files.file;
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["jpg", "jpeg", "png", "webp"].includes(ext || "")) {
        return res.status(400).json({ error: "Only image files allowed (jpg, jpeg, png, webp)" });
      }
      const fileName = req.session.userId + "-logo-" + Date.now() + "." + ext;
      const uploadDir = "/var/www/alphamarket/uploads/logos";
      const fs = require("fs");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      await file.mv(uploadDir + "/" + fileName);
      const url = "/uploads/logos/" + fileName;

      // Save to users table
      await db.execute(sql`UPDATE users SET logo_url = ${url} WHERE id = ${req.session.userId}`);
      res.json({ url, fileName });
    } catch (err: any) {
      console.error("[Branding] Logo upload error:", err.message);
      res.status(500).json({ error: "Failed to upload logo" });
    }
  });

  // Upload advisor professional photo (for Upstox/broker integrations)
  // Photo specs: JPEG/PNG, max 2MB, min 400x400px recommended, white/plain background, professional headshot
  app.post("/api/advisor/profile/upload-photo", requireAdvisor, async (req: any, res: any) => {
    try {
      if (!req.files || !req.files.file) {
        return res.status(400).json({ error: "No file uploaded. Please upload a professional headshot photo (JPEG or PNG, max 2MB, minimum 400x400px, white/plain background)." });
      }
      const file = req.files.file;
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["jpg", "jpeg", "png"].includes(ext || "")) {
        return res.status(400).json({ error: "Only JPEG or PNG files allowed. Please upload a .jpg or .png photo." });
      }
      if (file.size > 2 * 1024 * 1024) {
        return res.status(400).json({ error: "File too large. Maximum size is 2MB. Please compress or resize your photo." });
      }
      const fileName = req.session.userId + "-photo-" + Date.now() + "." + ext;
      const uploadDir = "/var/www/alphamarket/uploads/photos";
      const fs = require("fs");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      await file.mv(uploadDir + "/" + fileName);
      const url = "/uploads/photos/" + fileName;
      await db.execute(sql`UPDATE users SET photo_url = ${url} WHERE id = ${req.session.userId}`);
      res.json({ url, fileName, specs: { maxSize: "2MB", formats: "JPEG, PNG", recommended: "400x400px minimum, white/plain background, professional headshot" } });
    } catch (err: any) {
      console.error("[Profile] Photo upload error:", err.message);
      res.status(500).json({ error: "Failed to upload photo" });
    }
  });

  // Update advisor investment methodology
  app.put("/api/advisor/profile/investment-methodology", requireAdvisor, async (req: any, res: any) => {
    try {
      const { investmentMethodology } = req.body;
      if (!investmentMethodology || typeof investmentMethodology !== "string") {
        return res.status(400).json({ error: "investmentMethodology is required (string, max 5000 chars)" });
      }
      if (investmentMethodology.length > 5000) {
        return res.status(400).json({ error: "Investment methodology text too long. Maximum 5000 characters." });
      }
      await db.execute(sql`UPDATE users SET investment_methodology = ${investmentMethodology} WHERE id = ${req.session.userId}`);
      res.json({ status: "updated", length: investmentMethodology.length });
    } catch (err: any) {
      console.error("[Profile] Methodology update error:", err.message);
      res.status(500).json({ error: "Failed to update investment methodology" });
    }
  });

  // Get advisor branding settings
  app.get("/api/advisor/branding", requireAdvisor, async (req: any, res: any) => {
    try {
      const result = await db.execute(
        sql`SELECT logo_url, sebi_reg_number, custom_disclaimer, advisor_contact, advisor_website, company_name
            FROM users WHERE id = ${req.session.userId}`
      );
      const row = ((result as any).rows || [])[0];
      res.json({
        logoUrl: row?.logo_url || null,
        sebiRegNumber: row?.sebi_reg_number || "",
        customDisclaimer: row?.custom_disclaimer || "",
        advisorContact: row?.advisor_contact || "",
        advisorWebsite: row?.advisor_website || "",
        companyName: row?.company_name || "",
      });
    } catch (err: any) {
      console.error("[Branding] Fetch error:", err.message);
      res.status(500).json({ error: "Failed to fetch branding" });
    }
  });

  // Save advisor branding settings
  app.put("/api/advisor/branding", requireAdvisor, async (req: any, res: any) => {
    try {
      const { sebiRegNumber, customDisclaimer, advisorContact, advisorWebsite } = req.body;
      await db.execute(sql`UPDATE users SET
        sebi_reg_number = ${sebiRegNumber || null},
        custom_disclaimer = ${customDisclaimer || null},
        advisor_contact = ${advisorContact || null},
        advisor_website = ${advisorWebsite || null}
        WHERE id = ${req.session.userId}`);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Branding] Save error:", err.message);
      res.status(500).json({ error: "Failed to save branding" });
    }
  });

  // ─── PMLA Routes ───────────────────────────────────────────────

  app.get("/api/pmla/status", requireAuth, async (req: any, res: any) => {
    try {
      const { subscriptionId } = req.query;
      if (!subscriptionId) return res.status(400).json({ error: "subscriptionId required" });
      const sub = await storage.getSubscription(subscriptionId as string);
      if (!sub) return res.status(404).json({ error: "Subscription not found" });
      if (sub.userId !== req.session.userId) return res.status(403).json({ error: "Not authorized" });

      const result = await db.execute(sql`
        SELECT * FROM pmla_verifications 
        WHERE subscription_id = ${subscriptionId} 
        ORDER BY created_at DESC LIMIT 1
      `);
      const record = (result as any).rows?.[0];

      res.json({
        required: true,
        done: sub.pmlaDone || false,
        verification: record || null,
      });
    } catch (err: any) {
      console.error("[PMLA] Status error:", err.message);
      res.status(500).json({ error: "Failed to check PMLA status" });
    }
  });

  app.post("/api/pmla/bank/verify", requireAuth, async (req: any, res: any) => {
    try {
      const { subscriptionId, accountNumber, ifsc } = req.body;
      if (!subscriptionId || !accountNumber || !ifsc) {
        return res.status(400).json({ error: "subscriptionId, accountNumber, and ifsc required" });
      }

      const sub = await storage.getSubscription(subscriptionId);
      if (!sub) return res.status(404).json({ error: "Subscription not found" });
      if (sub.userId !== req.session.userId) return res.status(403).json({ error: "Not authorized" });

      const bankResult = await verifyBankAccount(accountNumber, ifsc);

      const maskedAccount = "****" + accountNumber.slice(-4);

      const aadhaarRecord = await storage.getEkycBySubscriptionAndType(subscriptionId, "aadhaar");
      const panRecord = await storage.getEkycBySubscriptionAndType(subscriptionId, "pan");

      const aadhaarName = aadhaarRecord?.aadhaarName || "";
      const panName = panRecord?.panName || "";
      const nameMatch = fuzzyNameMatch(aadhaarName, panName);
      const bankNameMatch = fuzzyNameMatch(bankResult.accountHolder, aadhaarName);

      const panAadhaarLinked = panRecord?.panAadhaarLinked || false;

      const allPassed = bankResult.verified && 
        nameMatch.result !== "MISMATCH" && 
        bankNameMatch.result !== "MISMATCH" &&
        panAadhaarLinked;

      const overallStatus = allPassed ? "passed" : "review";

      const existing = await db.execute(sql`
        SELECT id FROM pmla_verifications WHERE subscription_id = ${subscriptionId} LIMIT 1
      `);

      if ((existing as any).rows?.length > 0) {
        await db.execute(sql`
          UPDATE pmla_verifications SET
            aadhaar_name = ${aadhaarName},
            pan_name = ${panName},
            name_match_score = ${nameMatch.score},
            name_match_result = ${nameMatch.result},
            pan_aadhaar_linked = ${panAadhaarLinked},
            bank_account_number = ${maskedAccount},
            bank_ifsc = ${ifsc},
            bank_account_holder = ${bankResult.accountHolder},
            bank_verified = ${bankResult.verified},
            bank_verification_method = ${"PENNY_LESS"},
            overall_status = ${overallStatus},
            verified_at = ${allPassed ? new Date().toISOString() : null}
          WHERE subscription_id = ${subscriptionId}
        `);
      } else {
        await db.execute(sql`
          INSERT INTO pmla_verifications (user_id, subscription_id, aadhaar_name, pan_name, name_match_score, name_match_result, pan_aadhaar_linked, bank_account_number, bank_ifsc, bank_account_holder, bank_verified, bank_verification_method, overall_status, verified_at)
          VALUES (${sub.userId}, ${subscriptionId}, ${aadhaarName}, ${panName}, ${nameMatch.score}, ${nameMatch.result}, ${panAadhaarLinked}, ${maskedAccount}, ${ifsc}, ${bankResult.accountHolder}, ${bankResult.verified}, ${"PENNY_LESS"}, ${overallStatus}, ${allPassed ? new Date().toISOString() : null})
        `);
      }

      if (allPassed) {
        await storage.updateSubscription(sub.id, { pmlaDone: true });
      }

      res.json({
        success: true,
        bankVerified: bankResult.verified,
        bankAccountHolder: bankResult.accountHolder,
        bankName: bankResult.bankName,
        nameMatch: nameMatch,
        bankNameMatch: bankNameMatch,
        panAadhaarLinked: panAadhaarLinked,
        overallStatus: overallStatus,
        pmlaDone: allPassed,
      });
    } catch (err: any) {
      console.error("[PMLA] Bank verify error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/advisor/pmla-setting", requireAdvisor, async (req: any, res: any) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      res.json({ requirePmla: user?.requirePmla || false });
    } catch (err) {
      res.status(500).json({ error: "Failed to get PMLA setting" });
    }
  });

  app.patch("/api/advisor/pmla-setting", requireAdvisor, async (req: any, res: any) => {
    try {
      const { requirePmla } = req.body;
      const updated = await storage.updateUser(req.session.userId!, { requirePmla: !!requirePmla });
      res.json({ requirePmla: updated.requirePmla });
    } catch (err) {
      res.status(500).json({ error: "Failed to update PMLA setting" });
    }
  });


    app.get("/api/advisor/ekyc/:subscriptionId", requireAdvisor, async (req, res) => {
    try {
      const { subscriptionId } = req.params;
      const sub = await storage.getSubscription(subscriptionId);
      if (!sub) return res.status(404).send("Subscription not found");
      if (sub.advisorId !== req.session.userId) return res.status(403).send("Not authorized");

      const aadhaarV = await storage.getEkycBySubscriptionAndType(subscriptionId, "aadhaar");
      const panV = await storage.getEkycBySubscriptionAndType(subscriptionId, "pan");
      const user = await storage.getUser(sub.userId);

      res.json({
        subscriptionId,
        investorName: user?.username || "Unknown",
        investorEmail: user?.email || "",
        ekycDone: sub.ekycDone,
        aadhaar: aadhaarV ? {
          status: aadhaarV.status,
          name: aadhaarV.aadhaarName,
          last4: aadhaarV.aadhaarLast4,
          dob: aadhaarV.aadhaarDob,
          gender: aadhaarV.aadhaarGender,
          address: aadhaarV.aadhaarAddress,
          photo: aadhaarV.aadhaarPhoto,
          verifiedAt: aadhaarV.verifiedAt,
        } : null,
        pan: panV ? {
          status: panV.status,
          number: panV.panNumber,
          name: panV.panName,
          category: panV.panCategory,
          aadhaarLinked: panV.panAadhaarLinked,
          verifiedAt: panV.verifiedAt,
        } : null,
      });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/advisor/pmla/:subscriptionId", requireAdvisor, async (req: any, res: any) => {
    try {
      const { subscriptionId } = req.params;
      const sub = await storage.getSubscription(subscriptionId);
      if (!sub) return res.status(404).json({ error: "Subscription not found" });
      if (sub.advisorId !== req.session.userId) return res.status(403).json({ error: "Not authorized" });

      const result = await db.execute(sql`
        SELECT * FROM pmla_verifications WHERE subscription_id = ${subscriptionId} ORDER BY created_at DESC LIMIT 1
      `);
      const record = (result as any).rows?.[0];
      const user = await storage.getUser(sub.userId);

      res.json({
        subscriptionId,
        investorName: user?.username || "Unknown",
        investorEmail: user?.email || "",
        pmlaDone: sub.pmlaDone || false,
        verification: record ? {
          aadhaarName: record.aadhaar_name,
          panName: record.pan_name,
          nameMatchScore: record.name_match_score,
          nameMatchResult: record.name_match_result,
          panAadhaarLinked: record.pan_aadhaar_linked,
          bankAccountNumber: record.bank_account_number,
          bankIfsc: record.bank_ifsc,
          bankAccountHolder: record.bank_account_holder,
          bankVerified: record.bank_verified,
          overallStatus: record.overall_status,
          verifiedAt: record.verified_at,
        } : null,
      });
    } catch (err: any) {
      console.error("[PMLA] Advisor view error:", err.message);
      res.status(500).json({ error: "Failed to get PMLA data" });
    }
  });

    // ─── Telegram Routes ───────────────────────────────────────────────

  app.get("/api/telegram/status", requireAuth, async (req: any, res: any) => {
    try {
      const status = await getUserTelegramStatus(req.session.userId);
      res.json(status);
    } catch (err) {
      console.error("[Telegram] Status check error:", err);
      res.status(500).json({ error: "Failed to check Telegram status" });
    }
  });

  app.post("/api/telegram/link", requireAuth, async (req: any, res: any) => {
    try {
      const code = await generateLinkingCode(req.session.userId);
      const botUsername = process.env.TELEGRAM_BOT_USERNAME || "AlphaMarketAlertsBot";
      const deepLink = "https://t.me/" + botUsername + "?start=" + code;
      res.json({ deepLink, code, expiresInSeconds: 600 });
    } catch (err) {
      console.error("[Telegram] Link generation error:", err);
      res.status(500).json({ error: "Failed to generate linking code" });
    }
  });

  app.post("/api/telegram/unlink", requireAuth, async (req: any, res: any) => {
    try {
      await db.execute(sql`
        UPDATE telegram_subscriptions 
        SET is_active = false, updated_at = NOW()
        WHERE user_id = ${req.session.userId} AND is_active = true
      `);
      res.json({ success: true, message: "Telegram alerts disabled" });
    } catch (err) {
      console.error("[Telegram] Unlink error:", err);
      res.status(500).json({ error: "Failed to unlink Telegram" });
    }
  });


  app.get("/api/notifications/vapid-key", (req, res) => {
    if (!pushEnabled || !vapidPublicKey) {
      return res.status(503).json({ error: "Push notifications not configured" });
    }
    res.json({ publicKey: vapidPublicKey });
  });

  app.post("/api/notifications/subscribe", async (req, res) => {
    try {
      const { subscription } = req.body;
      if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).send("Invalid push subscription");
      }
      if (!req.session?.userId) {
        return res.status(401).send("Login required to enable notifications");
      }
      const userId = req.session.userId;
      await storage.createPushSubscription({
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.delete("/api/notifications/subscribe", async (req, res) => {
    try {
      const { endpoint } = req.body;
      if (!endpoint) return res.status(400).send("Endpoint required");
      await storage.deletePushSubscription(endpoint);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/notifications/recent", requireAuth, async (req, res) => {
    try {
      const allNotifications = await storage.getRecentNotifications(100);
      const userSubs = await storage.getSubscriptionsByUserId(req.session.userId!);
      const subscribedStrategyIds = new Set(userSubs.filter(s => s.status === "active" && s.strategyId).map(s => s.strategyId));
      const userWatchlist = await storage.getWatchlistByUser(req.session.userId!);
      const watchlistedStrategyIds = new Set(userWatchlist.filter(w => w.itemType === "strategy").map(w => w.itemId));

      const filtered = allNotifications.filter(n => {
        if (n.targetScope === "all_users" || n.targetScope === "all_visitors") return true;
        if (n.targetScope === "strategy_subscribers" && n.strategyId) {
          return subscribedStrategyIds.has(n.strategyId);
        }
        if (n.targetScope === "strategy_watchlist" && n.strategyId) {
          return watchlistedStrategyIds.has(n.strategyId) && !subscribedStrategyIds.has(n.strategyId);
        }
        return false;
      });
      res.json(filtered.slice(0, 50));
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.post("/api/admin/notifications", requireAdmin, async (req, res) => {
    try {
      const { title, body, url, scope } = req.body;
      if (!title || !body) return res.status(400).send("Title and body required");

      const payload = { title, body, url: url || "/", tag: "admin-alert", data: { url: url || "/" } };
      if (scope === "all_visitors") {
        await notifyAllVisitors(payload);
      } else {
        await notifyAllUsers(payload);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });

  app.get("/api/risk-profiling/check", requireAuth, async (req, res) => {
    try {
      const { subscriptionId } = req.query;
      if (!subscriptionId) return res.status(400).send("subscriptionId required");

      const sub = await storage.getSubscription(subscriptionId as string);
      if (!sub) return res.status(404).send("Subscription not found");

      const advisor = await storage.getUser(sub.advisorId);
      const requiresRiskProfiling = advisor?.requireRiskProfiling || false;
      const requiresPmla = advisor?.requirePmla || false;

      const existing = await storage.getRiskProfileBySubscription(subscriptionId as string);

      res.json({
        requiresRiskProfiling,
        completed: !!existing,
        subscriptionId: sub.id,
        advisorId: sub.advisorId,
        advisorName: advisor?.companyName || advisor?.username,
      });
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  });


  // ============================================================
  // SHARED TOKEN API — Single source of truth for all apps
  // ============================================================
  const SHARED_TOKEN_SECRET = process.env.SHARED_TOKEN_SECRET || "alphamarket-shared-2026";

  // GET /api/shared/token/groww — Any app on the server can fetch the current Groww token
  app.get("/api/shared/token/groww", async (req: any, res: any) => {
    try {
      const secret = req.headers["x-shared-secret"] || req.query.secret;
      if (secret !== SHARED_TOKEN_SECRET) return res.status(401).json({ error: "Invalid shared secret" });

      const row = await db.select().from(appSettings).where(eq(appSettings.key, "groww_access_token")).limit(1);
      if (!row.length) return res.status(404).json({ error: "No Groww token found" });

      const data = JSON.parse(row[0].value);
      res.json({
        token: data.token,
        expiry: data.expiry,
        setAt: data.setAt,
        source: "alphamarket",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/shared/token/groww — Update Groww token from any app (e.g. admin panel)
  app.post("/api/shared/token/groww", async (req: any, res: any) => {
    try {
      const secret = req.headers["x-shared-secret"] || req.query.secret;
      if (secret !== SHARED_TOKEN_SECRET) return res.status(401).json({ error: "Invalid shared secret" });

      const { token } = req.body;
      if (!token) return res.status(400).json({ error: "Token required" });

      // Use the existing setGrowwAccessToken function
      const { setGrowwAccessToken } = require("./groww");
      const result = setGrowwAccessToken(token);

      res.json({ success: true, expiresIn: result.expiresIn, message: "Token updated across all apps" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/shared/tokens — Status of all tokens (for admin dashboard)
  app.get("/api/shared/tokens", async (req: any, res: any) => {
    try {
      const secret = req.headers["x-shared-secret"] || req.query.secret;
      if (secret !== SHARED_TOKEN_SECRET) return res.status(401).json({ error: "Invalid shared secret" });

      const { getGrowwTokenStatus } = require("./groww");
      const growwStatus = getGrowwTokenStatus();

      res.json({
        groww: {
          hasToken: growwStatus.hasToken,
          expiresIn: growwStatus.expiresIn,
          setAt: growwStatus.setAt,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });



  // ============================================================
  // DEEP ANALYSIS INTEGRATION
  // ============================================================
  const STOCK_ANALYZER_URL = "http://localhost:5003";
  const INTERNAL_API_KEY = "ak_test_anandrathi_2026";

  function generateMFSuggestions(holdings: any[]): any[] {
    const suggestions: any[] = [];
    for (const h of holdings) {
      if (h.name && h.name.match(/Regular/i) && !h.name.match(/Direct/i)) {
        suggestions.push({ type: "switch_to_direct", fund: h.name, message: "Consider switching to Direct plan to save expense ratio", priority: "medium" });
      }
      if (h.gainLossPercent < -20) {
        suggestions.push({ type: "review_underperformer", fund: h.name, message: h.name + " is down " + h.gainLossPercent.toFixed(1) + "%. Review fund thesis.", priority: "high" });
      }
      if (h.currentValue < 2000 && h.currentValue > 0) {
        suggestions.push({ type: "consolidate", fund: h.name, message: h.name + " has very small value. Consider consolidating.", priority: "low" });
      }
    }
    return suggestions;
  }

  app.post("/api/portfolio/:id/deep-analysis", requireAuth, async (req: any, res: any) => {
    try {
      const holdings = await db.execute(sql`SELECT * FROM portfolio_holdings WHERE portfolio_id = ${req.params.id}`);
      const rows = (holdings as any).rows || [];
      const equityHoldings = rows.filter((h: any) => h.asset_type === "equity" && h.symbol);
      const mfHoldings = rows.filter((h: any) => h.asset_type === "mutual_fund");
      const otherHoldings = rows.filter((h: any) => !["equity", "mutual_fund"].includes(h.asset_type));
      const results: any = { equity: null, mutualFunds: null, otherAssets: null, combined: null };

      if (equityHoldings.length > 0) {
        try {
          const stockPayload = equityHoldings.map((h: any) => ({
            stockName: h.symbol || h.name,
            buyPrice: parseFloat(h.avg_buy_price) || 0,
            quantity: parseFloat(h.quantity) || 0,
            buyDate: h.buy_date || undefined,
          }));
          const stockRes = await fetch(STOCK_ANALYZER_URL + "/api/v1/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-shared-secret": "alphamarket-shared-2026" },
            body: JSON.stringify({ holdings: stockPayload }),
          });
          if (stockRes.ok) {
            const stockData = await stockRes.json();
            if (stockData.success) {
              results.equity = {
                summary: stockData.data.summary,
                healthScore: stockData.data.healthScore,
                sectorAllocation: stockData.data.sectorAllocation,
                riskMetrics: stockData.data.riskMetrics,
                recommendations: stockData.data.recommendations,
                enhancedRecommendations: stockData.data.enhancedRecommendations,
                holdings: stockData.data.holdings,
                valueAnalysis: stockData.data.valueAnalysis,
                rebalancing: stockData.data.rebalancing,
                taxImpact: stockData.data.taxImpact,
                investmentStyle: stockData.data.investmentStyle,
                scenarios: stockData.data.scenarios,
                tailRisk: stockData.data.tailRisk,
                behavior: stockData.data.behavior,
                dividends: stockData.data.dividends,
                growthAnalysis: stockData.data.growthAnalysis,
                quantamental: stockData.data.quantamental,
                advancedMetrics: stockData.data.advancedMetrics,
                benchmarks: stockData.data.benchmarks,
              };
            }
          }
        } catch (err: any) {
          console.error("[Deep Analysis] Stock analyzer error:", err.message);
          results.equity = { error: "Stock analyzer unavailable" };
        }
      }

      if (mfHoldings.length > 0) {
        // Try MF Analyzer API first (port 5002), fallback to inline analysis
        let mfAnalyzed = false;
        try {
          const mfPayload = mfHoldings.map((h: any) => ({
            name: h.name,
            schemeName: h.name,
            isin: h.isin,
            investedValue: parseFloat(h.invested_value) || 0,
            units: parseFloat(h.quantity) || 0,
            avgNav: parseFloat(h.avg_buy_price) || 0,
            category: h.asset_class || null,
            buyDate: h.buy_date || undefined,
          }));
          
          const mfRes = await fetch("http://localhost:5002/api/analyze-direct", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ holdings: mfPayload }),
            signal: AbortSignal.timeout(30000),
          });
          
          if (mfRes.ok) {
            const mfData = await mfRes.json();
            if (mfData.success && mfData.data) {
              const apiHoldings = mfData.data.holdings || [];
              const apiAnalysis = mfData.data.analysis || {};
              
              // Map API response to the format expected by PDF report
              const totalMFInvested = apiHoldings.reduce((s: number, h: any) => s + Number(h.investedAmount || 0), 0);
              const totalMFCurrent = apiHoldings.reduce((s: number, h: any) => s + Number(h.currentValue || 0), 0);
              
              const mfSummary = apiHoldings.map((h: any) => ({
                name: h.schemeName || "",
                isin: h.schemeCode || "",
                units: h.totalUnits || 0,
                nav: h.currentNav || 0,
                invested: h.investedAmount || 0,
                currentValue: h.currentValue || 0,
                gainLoss: h.absoluteReturn || 0,
                gainLossPercent: h.investedAmount > 0 ? ((h.currentValue - h.investedAmount) / h.investedAmount) * 100 : 0,
                category: h.category || h.subCategory || "Equity",
                isDirect: (h.schemeName || "").toLowerCase().includes("direct"),
                isRegular: !(h.schemeName || "").toLowerCase().includes("direct"),
                performanceRating: h.cagr > 15 ? "Outperformer" : h.cagr > 5 ? "In-line" : "Underperformer",
                xirr: h.xirr || 0,
                cagr: h.cagr || 0,
              }));

              // Build category allocation
              const catAlloc: Record<string, number> = {};
              for (const f of mfSummary) { catAlloc[f.category] = (catAlloc[f.category] || 0) + f.currentValue; }
              const totalMF = totalMFCurrent || 1;
              const categoryData = Object.entries(catAlloc).map(([cat, val]) => ({ name: cat, value: val, percent: (val / totalMF) * 100 })).sort((a, b) => b.value - a.value);

              results.mutualFunds = {
                summary: { totalInvested: totalMFInvested, currentValue: totalMFCurrent, totalPnl: totalMFCurrent - totalMFInvested, totalPnlPercent: totalMFInvested > 0 ? ((totalMFCurrent - totalMFInvested) / totalMFInvested) * 100 : 0, holdingsCount: apiHoldings.length },
                holdings: mfSummary,
                recommendations: apiAnalysis.recommendations || [],
                suggestions: apiAnalysis.insights || [],
                categoryAllocation: categoryData,
                riskMetrics: apiAnalysis.riskMetrics || { avgVolatility: 0, avgExpectedReturn: 0, avgMaxDrawdown: 0, portfolioRisk: "Unknown" },
                healthCheck: apiAnalysis.healthCheck || null,
                overlapAnalysis: apiAnalysis.overlapAnalysis || null,
                forwardProjections: apiAnalysis.forwardProjections || null,
                stressTests: apiAnalysis.stressTests || null,
                executiveSummary: apiAnalysis.executiveSummary || null,
              };
              mfAnalyzed = true;
              console.log("[Deep Analysis] MF Analyzer API: " + apiHoldings.length + " funds analyzed");
            }
          }
        } catch (err: any) {
          console.warn("[Deep Analysis] MF Analyzer API failed, using inline:", err.message);
        }

        // Fallback to inline analysis if API failed
        if (!mfAnalyzed) {
          let totalMFInvested = 0, totalMFCurrent = 0;
          const mfSummary = mfHoldings.map((h: any) => {
            const invested = parseFloat(h.invested_value) || 0;
            const current = parseFloat(h.current_value) || 0;
            totalMFInvested += invested; totalMFCurrent += current;
            const name = h.name || "";
            const isDirect = name.toLowerCase().includes("direct");
            return { name, isin: h.isin, units: parseFloat(h.quantity) || 0, nav: parseFloat(h.current_price) || 0,
              invested, currentValue: current, gainLoss: current - invested,
              gainLossPercent: invested > 0 ? ((current - invested) / invested) * 100 : 0,
              category: "Equity", isDirect, isRegular: !isDirect,
              performanceRating: "In-line", xirr: 0, cagr: 0 };
          });
          const catAlloc: Record<string, number> = {};
          for (const f of mfSummary) { catAlloc[f.category] = (catAlloc[f.category] || 0) + f.currentValue; }
          const totalMF = totalMFCurrent || 1;
          const categoryData = Object.entries(catAlloc).map(([cat, val]) => ({ name: cat, value: val, percent: (val / totalMF) * 100 })).sort((a, b) => b.value - a.value);
          results.mutualFunds = {
            summary: { totalInvested: totalMFInvested, currentValue: totalMFCurrent, totalPnl: totalMFCurrent - totalMFInvested, totalPnlPercent: totalMFInvested > 0 ? ((totalMFCurrent - totalMFInvested) / totalMFInvested) * 100 : 0, holdingsCount: mfHoldings.length },
            holdings: mfSummary, recommendations: [], suggestions: generateMFSuggestions(mfSummary),
            categoryAllocation: categoryData, riskMetrics: { avgVolatility: 0, avgExpectedReturn: 0, avgMaxDrawdown: 0, portfolioRisk: "Unknown" },
          };
          console.log("[Deep Analysis] MF inline fallback: " + mfSummary.length + " funds");
        }
      }

      // ── Other Asset Classes (Gold, RE, FD, Insurance, PPF, NPS, etc.) ──
      if (otherHoldings.length > 0) {
        const otherByType: Record<string, any[]> = {};
        let otherTotalInvested = 0, otherTotalCurrent = 0;
        const otherRecs: any[] = [];

        for (const h of otherHoldings) {
          const type = h.asset_type || "other";
          if (!otherByType[type]) otherByType[type] = [];
          const inv = Number(h.invested_value) || (Number(h.quantity) * Number(h.avg_buy_price)) || 0;
          const cur = Number(h.current_value) || inv;
          const gl = cur - inv;
          const glp = inv > 0 ? (gl / inv) * 100 : 0;
          const item = {
            name: h.name, type, quantity: Number(h.quantity) || 0,
            investedValue: inv, currentValue: cur, gainLoss: gl, gainLossPercent: glp,
            provider: h.provider, interestRate: Number(h.interest_rate) || null,
            maturityDate: h.maturity_date, premium: Number(h.premium) || null,
            sumAssured: Number(h.sum_assured) || null, policyNumber: h.policy_number, buyDate: h.buy_date,
          };
          otherByType[type].push(item);
          otherTotalInvested += inv;
          otherTotalCurrent += cur;

          // Generate recommendations per asset type
          if (type === "fd") {
            if (item.interestRate && item.interestRate < 7) {
              otherRecs.push({ asset: item.name, type: "FD", action: "Review Rate", priority: "medium", reason: "FD rate of " + item.interestRate + "% is below current best rates (~8-8.5%). Consider switching at maturity." });
            }
            if (item.maturityDate && new Date(item.maturityDate) < new Date(Date.now() + 90 * 86400000)) {
              otherRecs.push({ asset: item.name, type: "FD", action: "Maturing Soon", priority: "high", reason: "FD matures on " + item.maturityDate + ". Plan reinvestment or redeployment." });
            }
          }
          // Gold % check moved after loop (needs full totals)
          if (type === "real_estate") {
            otherRecs.push({ asset: item.name, type: "Real Estate", action: "Review Valuation", priority: "low", reason: "Update current market value periodically. Real estate is illiquid — ensure emergency fund covers 6+ months." });
          }
          if (type === "insurance") {
            if (item.sumAssured && item.premium) {
              const coverRatio = item.sumAssured / item.premium;
              if (coverRatio < 10) {
                otherRecs.push({ asset: item.name, type: "Insurance", action: "Low Coverage", priority: "high", reason: "Sum assured is only " + coverRatio.toFixed(0) + "x premium. Consider term insurance for better coverage-to-cost ratio." });
              }
            }
          }
          if (type === "ppf" || type === "epf" || type === "nps") {
            if (type === "ppf" && inv > 0) {
              otherRecs.push({ asset: item.name, type: type.toUpperCase(), action: "Maximize", priority: "low", reason: "Ensure annual PPF contribution reaches Rs 1.5L limit for maximum Section 80C benefit." });
            }
            if (type === "nps") {
              otherRecs.push({ asset: item.name, type: "NPS", action: "Review Allocation", priority: "low", reason: "Review equity-debt split in NPS based on retirement timeline. Additional Rs 50K deduction under 80CCD(1B)." });
            }
          }
        }

        // Post-loop: percentage-based recommendations using full portfolio totals
        const fullPortfolioValue = otherTotalCurrent + (Number(results.equity?.summary?.currentValue) || Number(results.equity?.summary?.totalInvested) || 0) + (Number(results.mutualFunds?.summary?.currentValue) || Number(results.mutualFunds?.summary?.totalInvested) || 0);
        if (otherByType["gold"]) {
          for (const g of otherByType["gold"]) {
            const goldPct = fullPortfolioValue > 0 ? (g.currentValue / fullPortfolioValue) * 100 : 0;
            if (goldPct > 20) {
              otherRecs.push({ asset: g.name, type: "Gold", action: "Overweight", priority: "medium", reason: "Gold allocation is ~" + goldPct.toFixed(0) + "% of portfolio. Consider limiting to 10-15% for optimal diversification." });
            }
          }
        }
        if (otherByType["fd"]) {
          const fdTotal = otherByType["fd"].reduce((s: number, i: any) => s + i.currentValue, 0);
          const fdPct = fullPortfolioValue > 0 ? (fdTotal / fullPortfolioValue) * 100 : 0;
          if (fdPct > 30) {
            otherRecs.push({ asset: "Fixed Deposits", type: "FD", action: "High FD Allocation", priority: "low", reason: "FDs are ~" + fdPct.toFixed(0) + "% of portfolio. After emergency fund, consider deploying excess into equity SIPs." });
          }
        }

        // ── Enhanced Analysis (Task 4.6) ──

        // FD Ladder Strategy
        if (otherByType["fd"] && otherByType["fd"].length >= 1) {
          const fds = otherByType["fd"];
          const fdTotal = fds.reduce((s: number, i: any) => s + i.currentValue, 0);
          if (fds.length === 1) {
            otherRecs.push({ asset: "FD Portfolio", type: "FD", action: "Build FD Ladder", priority: "medium", reason: "You have only 1 FD. Consider splitting into 3-5 FDs with staggered maturities (1yr, 2yr, 3yr, 5yr) for better liquidity and to capture rising interest rates." });
          }
          if (fds.some((f: any) => f.interestRate && f.interestRate < 7.5)) {
            otherRecs.push({ asset: "FD Portfolio", type: "FD", action: "Compare Rates", priority: "low", reason: "Current best FD rates: SBI 7.1%, HDFC 7.25%, Post Office SCSS 8.2%, RBI Floating Rate Bond 8.05%. Consider switching low-rate FDs at maturity." });
          }
        }

        // Insurance: Term vs ULIP, Adequate Coverage
        if (otherByType["insurance"]) {
          for (const ins of otherByType["insurance"]) {
            if (ins.sumAssured && ins.premium) {
              const coverRatio = ins.sumAssured / ins.premium;
              if (coverRatio < 15) {
                otherRecs.push({ asset: ins.name, type: "Insurance", action: "Consider Term Plan", priority: "high", reason: "Coverage ratio is only " + coverRatio.toFixed(0) + "x premium. A pure term plan offers 500-1000x coverage at lower cost. E.g., Rs 1Cr term cover costs ~Rs 10-15K/yr for a 30-yr-old." });
              }
            }
          }
          // Adequate coverage check (10-15x annual income estimate)
          const totalCoverage = otherByType["insurance"].reduce((s: number, i: any) => s + (i.sumAssured || 0), 0);
          if (totalCoverage > 0 && totalCoverage < 5000000) {
            otherRecs.push({ asset: "Insurance Portfolio", type: "Insurance", action: "Inadequate Coverage", priority: "high", reason: "Total life coverage of " + (totalCoverage / 100000).toFixed(0) + "L may be insufficient. Rule of thumb: life cover should be 10-15x annual income. For a Rs 10L income, target Rs 1-1.5Cr cover via term insurance." });
          }
        }

        // Gold: Historical returns comparison, optimal allocation
        if (otherByType["gold"]) {
          const goldTotal = otherByType["gold"].reduce((s: number, i: any) => s + i.currentValue, 0);
          const goldPct = fullPortfolioValue > 0 ? (goldTotal / fullPortfolioValue) * 100 : 0;
          otherRecs.push({ asset: "Gold Holdings", type: "Gold", action: "Allocation Check", priority: goldPct > 15 ? "medium" : "low", reason: "Gold allocation: " + goldPct.toFixed(1) + "%. Historical CAGR: Gold ~11% vs Nifty ~14% vs FD ~7% (10yr). Optimal gold allocation is 5-15% for inflation hedge. " + (goldPct < 5 ? "Consider adding gold via Sovereign Gold Bonds (SGBs) for 2.5% annual interest + capital gains." : goldPct > 15 ? "Reduce gold to 10-15% and redeploy into equity/MF for higher long-term growth." : "Your gold allocation is within the optimal range.") });
          // SGB recommendation
          if (otherByType["gold"].some((g: any) => g.name?.toLowerCase().includes("physical"))) {
            otherRecs.push({ asset: "Physical Gold", type: "Gold", action: "Switch to SGB", priority: "medium", reason: "Physical gold has storage costs and no yield. Sovereign Gold Bonds (SGBs) offer 2.5% annual interest, no capital gains tax on maturity (8yr), and are backed by RBI." });
          }
        }

        // PPF: Tax benefit optimization
        if (otherByType["ppf"]) {
          for (const ppf of otherByType["ppf"]) {
            const annualLimit = 150000;
            otherRecs.push({ asset: ppf.name, type: "PPF", action: "Tax Optimization", priority: "low", reason: "PPF offers EEE tax benefit (exempt at investment, growth, and withdrawal). Current rate: 7.1% p.a. (tax-free). Effective pre-tax return: ~10.1% for 30% tax bracket. Max annual contribution: Rs 1.5L under Section 80C." });
            if (ppf.investedValue && ppf.investedValue > 0) {
              const yearsInvested = ppf.buyDate ? (Date.now() - new Date(ppf.buyDate).getTime()) / (365.25 * 86400000) : 5;
              const projectedAt15 = ppf.investedValue * Math.pow(1.071, Math.max(0, 15 - yearsInvested));
              otherRecs.push({ asset: ppf.name, type: "PPF", action: "Maturity Projection", priority: "low", reason: "At 7.1% p.a., your PPF corpus is projected to grow to Rs " + (projectedAt15 / 100000).toFixed(1) + "L by maturity (15yr lock-in). Adding Rs 1.5L/yr from now would yield ~Rs 40L+ at maturity." });
            }
          }
        }

        // NPS: Tax benefit + retirement projection
        if (otherByType["nps"]) {
          for (const nps of otherByType["nps"]) {
            otherRecs.push({ asset: nps.name, type: "NPS", action: "Tax Benefits", priority: "low", reason: "NPS offers triple tax benefit: Rs 1.5L under 80C + additional Rs 50K under 80CCD(1B) = Rs 2L total deduction. At 30% tax bracket, this saves Rs 60K/yr in taxes." });
            otherRecs.push({ asset: nps.name, type: "NPS", action: "Equity Allocation", priority: "medium", reason: "NPS allows up to 75% equity (Active Choice) till age 50. Higher equity allocation in early years can significantly boost retirement corpus. Review your asset mix (Scheme E/C/G) annually." });
            if (nps.investedValue && nps.investedValue > 0) {
              const retCorpus25yr = nps.investedValue * Math.pow(1.095, 25); // 9.5% assumed
              otherRecs.push({ asset: nps.name, type: "NPS", action: "Retirement Projection", priority: "low", reason: "At assumed 9.5% return, current NPS corpus of Rs " + (nps.investedValue / 100000).toFixed(1) + "L could grow to Rs " + (retCorpus25yr / 10000000).toFixed(1) + "Cr in 25 years. Regular contributions of Rs 50K/yr would add Rs " + ((50000 * (Math.pow(1.095, 25) - 1) / 0.095) / 10000000).toFixed(1) + "Cr more." });
            }
          }
        }

        // EPF optimization
        if (otherByType["epf"]) {
          for (const epf of otherByType["epf"]) {
            otherRecs.push({ asset: epf.name, type: "EPF", action: "VPF Consideration", priority: "low", reason: "EPF earns 8.25% p.a. tax-free (up to Rs 2.5L/yr contribution). Consider Voluntary Provident Fund (VPF) for additional contributions at the same rate — one of the best risk-free returns available." });
          }
        }

        // Bond analysis
        if (otherByType["bond"]) {
          for (const bond of otherByType["bond"]) {
            if (bond.interestRate) {
              const yieldComp = bond.interestRate < 8 ? "below" : "competitive with";
              otherRecs.push({ asset: bond.name, type: "Bond", action: "Yield Review", priority: bond.interestRate < 7 ? "medium" : "low", reason: "Bond yield of " + bond.interestRate + "% is " + yieldComp + " current market rates. RBI Floating Rate Bond: 8.05%, SDL: 7.5-8%, Corporate AAA: 7.5-8.5%. Consider redeployment at maturity if yield is below 7.5%." });
            }
          }
        }

        // Overall asset allocation optimization
        const eqPct = fullPortfolioValue > 0 ? ((Number(results.equity?.summary?.currentValue) || 0) / fullPortfolioValue) * 100 : 0;
        const mfPct = fullPortfolioValue > 0 ? ((Number(results.mutualFunds?.summary?.currentValue) || 0) / fullPortfolioValue) * 100 : 0;
        const debtPct = fullPortfolioValue > 0 ? ((otherByType["fd"] || []).concat(otherByType["ppf"] || [], otherByType["epf"] || [], otherByType["bond"] || []).reduce((s: number, i: any) => s + i.currentValue, 0) / fullPortfolioValue * 100) : 0;
        const rePct = fullPortfolioValue > 0 ? ((otherByType["real_estate"] || []).reduce((s: number, i: any) => s + i.currentValue, 0) / fullPortfolioValue * 100) : 0;

        otherRecs.push({ asset: "Overall Portfolio", type: "Asset Allocation", action: "Allocation Review", priority: "medium",
          reason: "Current allocation: Equity " + eqPct.toFixed(0) + "%, MF " + mfPct.toFixed(0) + "%, Debt/FD " + debtPct.toFixed(0) + "%, Real Estate " + rePct.toFixed(0) + "%. " +
          (eqPct + mfPct < 30 ? "Equity+MF is under 30% — consider increasing for long-term wealth creation (target 50-70% for aggressive, 30-50% for moderate risk profile)." :
           eqPct + mfPct > 80 ? "Equity+MF is over 80% — high growth potential but vulnerable to market downturns. Consider 10-20% in debt/FD for stability." :
           "Equity+MF allocation appears balanced. Review annually based on market conditions and life stage.")
        });

        const categoryBreakdown = Object.entries(otherByType).map(([type, items]) => ({
          type, label: type === "fd" ? "Fixed Deposits" : type === "gold" ? "Gold" : type === "real_estate" ? "Real Estate" : type === "insurance" ? "Insurance" : type === "ppf" ? "PPF" : type === "nps" ? "NPS" : type === "epf" ? "EPF" : type === "bond" ? "Bonds" : type === "crypto" ? "Crypto" : type === "cash" ? "Cash" : type,
          count: items.length,
          totalInvested: items.reduce((s, i) => s + i.investedValue, 0),
          totalCurrent: items.reduce((s, i) => s + i.currentValue, 0),
          holdings: items,
        }));

        results.otherAssets = {
          summary: { totalInvested: otherTotalInvested, currentValue: otherTotalCurrent, holdingsCount: otherHoldings.length },
          categories: categoryBreakdown,
          holdings: otherHoldings.map((h: any) => ({ name: h.name, type: h.asset_type, investedValue: Number(h.invested_value) || 0, currentValue: Number(h.current_value) || Number(h.invested_value) || 0, provider: h.provider, interestRate: Number(h.interest_rate) || null, maturityDate: h.maturity_date, premium: Number(h.premium) || null, sumAssured: Number(h.sum_assured) || null })),
          recommendations: otherRecs,
        };
      }

      const eqI = results.equity?.summary?.totalInvested || 0;
      const eqC = results.equity?.summary?.currentValue || 0;
      const mfI = results.mutualFunds?.summary?.totalInvested || 0;
      const mfC = results.mutualFunds?.summary?.currentValue || 0;
      const othI = results.otherAssets?.summary?.totalInvested || 0;
      const othC = results.otherAssets?.summary?.currentValue || 0;
      const totI = eqI + mfI + othI, totC = eqC + mfC + othC;

      // Build full asset allocation
      const assetAllocation: any = {
        equity: { invested: eqI, current: eqC, percent: totC > 0 ? (eqC / totC) * 100 : 0 },
        mutualFunds: { invested: mfI, current: mfC, percent: totC > 0 ? (mfC / totC) * 100 : 0 },
      };
      // Add each other asset type to allocation
      if (results.otherAssets?.categories) {
        for (const cat of results.otherAssets.categories) {
          assetAllocation[cat.type] = { invested: cat.totalInvested, current: cat.totalCurrent, percent: totC > 0 ? (cat.totalCurrent / totC) * 100 : 0 };
        }
      }

      results.combined = {
        totalInvested: totI, currentValue: totC, totalPnl: totC - totI,
        totalPnlPercent: totI > 0 ? ((totC - totI) / totI) * 100 : 0,
        assetAllocation,
        healthScore: results.equity?.healthScore?.overall || null,
        stockCount: results.equity?.summary?.holdingsCount || 0,
        mfCount: results.mutualFunds?.summary?.holdingsCount || 0,
        otherCount: otherHoldings.length,
      };

      // ── P3: Enhanced MF Analysis (ported from MF Analyzer) ──
      if (results.mutualFunds?.holdings?.length > 0) {
        const mfHolds = results.mutualFunds.holdings;
        const totalMFVal = mfHolds.reduce((s: number, h: any) => s + (h.currentValue || 0), 0);

        // MF Stress Tests
        const mfStressScenarios = [
          { name: "Interest Rate Hike (+200bps)", equityImpact: -0.08, debtImpact: -0.04, description: "RBI raises repo rate by 200 basis points" },
          { name: "Currency Depreciation (10%)", equityImpact: -0.05, debtImpact: -0.01, description: "INR depreciates 10% against USD" },
          { name: "Global Recession", equityImpact: -0.25, debtImpact: 0.02, description: "Major global economic slowdown" },
          { name: "FII Outflow (Large)", equityImpact: -0.15, debtImpact: -0.03, description: "Significant FII selling" },
          { name: "Oil Price Shock (+50%)", equityImpact: -0.12, debtImpact: -0.02, description: "Crude oil prices surge by 50%" },
        ];

        results.mutualFunds.stressTests = mfStressScenarios.map(sc => {
          let stressed = 0;
          for (const h of mfHolds) {
            const cat = (h.category || "").toLowerCase();
            let impact = sc.equityImpact;
            if (cat.includes("debt") || cat.includes("liquid")) impact = sc.debtImpact;
            if (cat.includes("small cap")) impact *= 1.3;
            else if (cat.includes("mid cap")) impact *= 1.15;
            else if (cat.includes("large cap") || cat.includes("index")) impact *= 0.9;
            stressed += (h.currentValue || 0) * (1 + impact);
          }
          return { scenario: sc.name, description: sc.description, projectedLoss: Math.round(stressed - totalMFVal), portfolioImpact: totalMFVal > 0 ? +((stressed - totalMFVal) / totalMFVal * 100).toFixed(1) : 0, severity: Math.abs(stressed - totalMFVal) / (totalMFVal || 1) > 0.15 ? "High" : Math.abs(stressed - totalMFVal) / (totalMFVal || 1) > 0.08 ? "Medium" : "Low" };
        });

        // MF Forward Projections
        const rm = results.mutualFunds.riskMetrics;
        const pRet = (rm?.avgExpectedReturn || 13) / 100;
        const pVol = (rm?.avgVolatility || 16) / 100;
        results.mutualFunds.forwardProjections = [1, 3, 5, 7, 10, 15, 20].map(yr => {
          const expected = totalMFVal * Math.pow(1 + pRet, yr);
          const optimistic = totalMFVal * Math.pow(1 + pRet + pVol, yr);
          const pessimistic = totalMFVal * Math.pow(1 + Math.max(pRet - pVol, -0.3), yr);
          return { years: yr, expectedValue: Math.round(expected), optimisticValue: Math.round(optimistic), pessimisticValue: Math.round(pessimistic), expectedCAGR: +(pRet * 100).toFixed(1), wealthMultiple: +(expected / totalMFVal).toFixed(2) };
        });

        // MF Overlap Analysis (category-based)
        const catGroups: Record<string, any[]> = {};
        mfHolds.forEach((h: any) => { const k = h.category || "Other"; if (!catGroups[k]) catGroups[k] = []; catGroups[k].push(h); });
        const overlaps: any[] = [];
        for (const [cat, funds] of Object.entries(catGroups)) {
          if (funds.length >= 2) {
            const basePct = cat.toLowerCase().includes("large cap") || cat.toLowerCase().includes("index") ? 70 : cat.toLowerCase().includes("mid cap") ? 50 : cat.toLowerCase().includes("flexi") || cat.toLowerCase().includes("multi") ? 45 : 30;
            overlaps.push({ category: cat, funds: funds.map((f: any) => (f.name || "").substring(0, 35)), overlapPct: Math.min(90, basePct), severity: basePct > 60 ? "High" : basePct > 40 ? "Medium" : "Low" });
          }
        }
        const avgOverlap = overlaps.length > 0 ? overlaps.reduce((s, o) => s + o.overlapPct, 0) / overlaps.length : 0;
        results.mutualFunds.overlapAnalysis = { overlaps, overallLevel: avgOverlap > 50 ? "High" : avgOverlap > 30 ? "Moderate" : "Low", overallScore: Math.round(avgOverlap), consolidationOpportunities: overlaps.filter(o => o.severity === "High").length };

        // MF Health Check
        const directPct = mfHolds.filter((h: any) => h.isDirect).length / (mfHolds.length || 1) * 100;
        const diversified = Object.keys(catGroups).length;
        results.mutualFunds.healthCheck = {
          directVsRegular: { score: Math.round(directPct), status: directPct >= 70 ? "Good" : directPct >= 40 ? "Fair" : "Poor", message: directPct >= 70 ? "Most funds in Direct plan" : "Switch Regular plans to Direct to save on expense ratio" },
          diversification: { score: Math.min(100, diversified * 25), status: diversified >= 4 ? "Good" : diversified >= 2 ? "Fair" : "Poor", message: diversified + " categories covered" },
          overlapRisk: { score: Math.max(0, 100 - Math.round(avgOverlap)), status: avgOverlap < 30 ? "Good" : avgOverlap < 50 ? "Fair" : "Poor", message: overlaps.length + " overlapping category groups found" },
          portfolioRisk: { score: rm?.portfolioRisk === "Low" ? 85 : rm?.portfolioRisk === "Moderate" ? 60 : 35, status: rm?.portfolioRisk || "Unknown", message: "Volatility: " + (rm?.avgVolatility || 0) + "%, Max DD: " + (rm?.avgMaxDrawdown || 0) + "%" },
        };

        results.mutualFunds.isEnhanced = true;
      }

      // ── P4: Stock-MF Overlap (cross-asset) ──
      if (results.equity?.holdings?.length > 0 && results.mutualFunds?.holdings?.length > 0) {
        const stockHoldings = results.equity.holdings;
        const mfHolds = results.mutualFunds.holdings;
        const eqTotal = stockHoldings.reduce((s: number, h: any) => s + (h.currentValue || h.marketValue || 0), 0);
        const mfTotal = mfHolds.reduce((s: number, h: any) => s + (h.currentValue || 0), 0);
        const portfolioTotal = eqTotal + mfTotal;

        // Known top holdings for common MF categories
        const categoryTopStocks: Record<string, string[]> = {
          "Large Cap": ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "BHARTIARTL", "ITC", "SBIN", "KOTAKBANK", "LT"],
          "Flexi/Multi Cap": ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "BHARTIARTL", "ITC", "TCS", "AXISBANK", "SBIN", "LT"],
          "Mid Cap": ["HAL", "PERSISTENT", "COFORGE", "DIXON", "POLYCAB", "TRENT", "BEL", "MPHASIS", "TIINDIA", "DEEPAKNTR"],
          "Small Cap": ["THERMAX", "ATUL", "DEEPAKNTR", "IEX", "POLYCAB", "DIXON", "TIINDIA", "BEL", "TRENT", "PERSISTENT"],
          "ELSS": ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "AXISBANK", "BHARTIARTL", "ITC", "SBIN", "MARUTI"],
          "Value/Contra": ["SBIN", "ITC", "NTPC", "ONGC", "HDFCBANK", "ICICIBANK", "BHARTIARTL", "RELIANCE", "AXISBANK", "LT"],
          "Focused": ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "BHARTIARTL", "TCS", "AXISBANK", "SBIN", "LT", "ITC"],
          "Large & Mid Cap": ["RELIANCE", "HDFCBANK", "ICICIBANK", "HAL", "BHARTIARTL", "INFY", "DLF", "SBIN", "TCS", "LT"],
        };

        const overlapMap: Record<string, { directPct: number; mfPct: number; mfSources: string[] }> = {};
        // Direct exposures
        for (const h of stockHoldings) {
          const sym = (h.stockName || h.symbol || "").toUpperCase();
          const val = h.currentValue || h.marketValue || 0;
          if (sym && portfolioTotal > 0) {
            overlapMap[sym] = { directPct: (val / portfolioTotal) * 100, mfPct: 0, mfSources: [] };
          }
        }

        // Estimate MF exposures
        for (const mf of mfHolds) {
          const cat = mf.category || "Flexi/Multi Cap";
          const topStocks = categoryTopStocks[cat] || categoryTopStocks["Flexi/Multi Cap"];
          const mfWeight = (mf.currentValue || 0) / (portfolioTotal || 1);
          for (const stock of topStocks) {
            if (overlapMap[stock]) {
              const estWeight = mfWeight * (10 / topStocks.length) * 100; // Rough estimate: top 10 holdings ~10% each
              overlapMap[stock].mfPct += estWeight;
              overlapMap[stock].mfSources.push((mf.name || "").substring(0, 30) + " (~" + estWeight.toFixed(1) + "%)");
            }
          }
        }

        // Filter to actual overlaps and sort
        const stockOverlap = Object.entries(overlapMap)
          .filter(([_, v]) => v.directPct > 0 && v.mfPct > 0)
          .map(([stock, v]) => ({
            stockName: stock,
            directExposure: +v.directPct.toFixed(1),
            mfExposure: +v.mfPct.toFixed(2),
            totalExposure: +(v.directPct + v.mfPct).toFixed(1),
            mfSources: v.mfSources,
            concentrationRisk: (v.directPct + v.mfPct) > 15 ? "Critical" : (v.directPct + v.mfPct) > 10 ? "High" : (v.directPct + v.mfPct) > 5 ? "Medium" : "Low",
          }))
          .sort((a, b) => b.totalExposure - a.totalExposure);

        if (stockOverlap.length > 0) {
          results.stockOverlap = stockOverlap;
        }
      }

      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });



  // POST /api/portfolio/:id/report — Generate PDF report
  app.post("/api/portfolio/:id/report", requireAuth, async (req: any, res: any) => {
    try {
      // First run the deep analysis
      const holdings = await db.execute(sql`SELECT * FROM portfolio_holdings WHERE portfolio_id = ${req.params.id}`);
      const rows = (holdings as any).rows || [];
      const equityHoldings = rows.filter((h: any) => h.asset_type === "equity" && h.symbol);
      const mfHoldings = rows.filter((h: any) => h.asset_type === "mutual_fund");

      let equityData = null;
      if (equityHoldings.length > 0) {
        const stockPayload = equityHoldings.map((h: any) => ({
          stockName: h.symbol || h.name, buyPrice: parseFloat(h.avg_buy_price) || 0,
          quantity: parseFloat(h.quantity) || 0, buyDate: h.buy_date || undefined,
        }));
        try {
          const stockRes = await fetch(STOCK_ANALYZER_URL + "/api/v1/analyze", {
            method: "POST", headers: { "Content-Type": "application/json", "x-shared-secret": "alphamarket-shared-2026" },
            body: JSON.stringify({ holdings: stockPayload }),
          });
          if (stockRes.ok) {
            const sd = await stockRes.json();
            if (sd.success) equityData = sd.data;
          }
        } catch (e) {}
      }

      // Build MF data (reuse the same logic)
      let mfData = null;
      if (mfHoldings.length > 0) {
        const MF_BM: Record<string, any> = {
          "Large Cap": { expectedReturn: 12.5, volatility: 14, maxDrawdown: -25, expenseRatioDirect: 0.4, expenseRatioRegular: 1.5, benchmarkName: "Nifty 50 TRI" },
          "Mid Cap": { expectedReturn: 15, volatility: 18, maxDrawdown: -32, expenseRatioDirect: 0.5, expenseRatioRegular: 1.8, benchmarkName: "Nifty Midcap 150 TRI" },
          "Small Cap": { expectedReturn: 17, volatility: 24, maxDrawdown: -40, expenseRatioDirect: 0.6, expenseRatioRegular: 2.0, benchmarkName: "Nifty Smallcap 250 TRI" },
          "Flexi/Multi Cap": { expectedReturn: 14, volatility: 16, maxDrawdown: -28, expenseRatioDirect: 0.5, expenseRatioRegular: 1.7, benchmarkName: "Nifty 500 TRI" },
          "ELSS": { expectedReturn: 14, volatility: 16, maxDrawdown: -30, expenseRatioDirect: 0.5, expenseRatioRegular: 1.8, benchmarkName: "Nifty 500 TRI" },
          "Value/Contra": { expectedReturn: 13, volatility: 15, maxDrawdown: -28, expenseRatioDirect: 0.5, expenseRatioRegular: 1.7, benchmarkName: "Nifty 500 Value 50 TRI" },
          "Focused": { expectedReturn: 13.5, volatility: 15.5, maxDrawdown: -27, expenseRatioDirect: 0.5, expenseRatioRegular: 1.7, benchmarkName: "Nifty 50 TRI" },
          "Large & Mid Cap": { expectedReturn: 13.5, volatility: 16, maxDrawdown: -28, expenseRatioDirect: 0.5, expenseRatioRegular: 1.7, benchmarkName: "Nifty LargeMidcap 250 TRI" },
        };
        function catFund(name: string) {
          const l = (name || "").toLowerCase();
          if (l.includes("elss") || l.includes("tax sav")) return "ELSS";
          if (l.includes("small cap")) return "Small Cap";
          if (l.includes("mid cap")) return "Mid Cap";
          if (l.includes("large cap") || l.includes("bluechip")) return "Large Cap";
          if (l.includes("large and mid")) return "Large & Mid Cap";
          if (l.includes("flexi") || l.includes("multi cap")) return "Flexi/Multi Cap";
          if (l.includes("focused")) return "Focused";
          if (l.includes("value") || l.includes("contra")) return "Value/Contra";
          return "Flexi/Multi Cap";
        }
        let mfI = 0, mfC = 0;
        const mfHolds = mfHoldings.map((h: any) => {
          const inv = parseFloat(h.invested_value) || 0; const cur = parseFloat(h.current_value) || 0;
          mfI += inv; mfC += cur;
          const cat = catFund(h.name); const bm = MF_BM[cat] || MF_BM["Flexi/Multi Cap"];
          const isDirect = (h.name || "").toLowerCase().includes("direct");
          const gl = cur - inv; const glp = inv > 0 ? (gl / inv) * 100 : 0;
          return { name: h.name, isin: h.isin, nav: parseFloat(h.current_price) || 0, units: parseFloat(h.quantity) || 0, invested: inv, currentValue: cur, gainLossPercent: glp, category: cat, isDirect, performanceRating: glp - bm.expectedReturn > 5 ? "Outperformer" : glp - bm.expectedReturn > -3 ? "In-line" : "Underperformer", benchmark: bm.benchmarkName };
        });
        const avgVol = mfHolds.reduce((s: number, f: any) => s + (MF_BM[f.category]?.volatility || 16) * (f.currentValue / (mfC || 1)), 0);
        const avgRet = mfHolds.reduce((s: number, f: any) => s + (MF_BM[f.category]?.expectedReturn || 13) * (f.currentValue / (mfC || 1)), 0);
        const avgDD = mfHolds.reduce((s: number, f: any) => s + (MF_BM[f.category]?.maxDrawdown || -28) * (f.currentValue / (mfC || 1)), 0);
        mfData = { summary: { totalInvested: mfI, currentValue: mfC }, holdings: mfHolds, riskMetrics: { avgExpectedReturn: +avgRet.toFixed(1), avgVolatility: +avgVol.toFixed(1), avgMaxDrawdown: +avgDD.toFixed(1), portfolioRisk: avgVol > 20 ? "High" : avgVol > 14 ? "Moderate" : "Low" }, recommendations: [] };
      }

      const eqI = equityData?.summary?.totalInvested || 0; const eqC = equityData?.summary?.currentValue || 0;
      const mfI2 = mfData?.summary?.totalInvested || 0; const mfC2 = mfData?.summary?.currentValue || 0;
      const totI = eqI + mfI2, totC = eqC + mfC2;

      // If pre-analyzed data sent from frontend (with advisor edits), use it
      const preAnalyzed = req.body?.deepAnalysis;

      // Resolve investor name
      let investorName = req.body.investorName || req.body.clientName || "";
      if (!investorName) {
        try {
          const portfolio = await db.execute(sql`SELECT user_id FROM customer_portfolios WHERE id = ${req.params.id}`);
          const pRow = ((portfolio as any).rows || [])[0];
          if (pRow?.user_id) {
            const subUser = await db.execute(sql`SELECT username, email FROM users WHERE id = ${pRow.user_id}`);
            const sRow = ((subUser as any).rows || [])[0];
            investorName = sRow?.username || sRow?.email || "";
          }
        } catch (e) {}
      }

      // Resolve advisor name
      let advisorName = req.body.generatedBy || req.body.advisorName || "";
      if (!advisorName && req.session?.userId) {
        try {
          const advUser = await db.execute(sql`SELECT username, email, company_name FROM users WHERE id = ${req.session.userId}`);
          const aRow = ((advUser as any).rows || [])[0];
          advisorName = aRow?.company_name || aRow?.username || aRow?.email || "";
        } catch (e) {}
      }

      const rptId = "RPT-" + Date.now().toString(36).toUpperCase();
      const rptDate = new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Kolkata" });

      // Fetch advisor branding for PDF
      let branding: any = {};
      if (req.session?.userId) {
        try {
          const brandRes = await db.execute(
            sql`SELECT logo_url, sebi_reg_number, custom_disclaimer, advisor_contact, advisor_website, company_name
                FROM users WHERE id = ${req.session.userId}`
          );
          const bRow = ((brandRes as any).rows || [])[0];
          if (bRow) {
            branding = {
              logoUrl: bRow.logo_url || null,
              sebiRegNumber: bRow.sebi_reg_number || "",
              customDisclaimer: bRow.custom_disclaimer || "",
              advisorContact: bRow.advisor_contact || "",
              advisorWebsite: bRow.advisor_website || "",
              companyName: bRow.company_name || "",
            };
          }
        } catch (e) {}
      }
      // Merge frontend branding overrides (from dialog) if provided
      if (req.body?.branding) {
        branding = { ...branding, ...req.body.branding };
      }

      let reportData;
      if (preAnalyzed) {
        // Use advisor-edited data directly
        reportData = {
          ...preAnalyzed,
          investorName, generatedBy: advisorName, reportId: rptId, generatedAt: rptDate, branding, sections: req.body?.sections,
        };
      } else {
        reportData = {
          equity: equityData ? { ...equityData, healthScore: equityData.healthScore, sectorAllocation: equityData.sectorAllocation, enhancedRecommendations: equityData.enhancedRecommendations, quantamental: equityData.quantamental, rebalancing: equityData.rebalancing, taxImpact: equityData.taxImpact, dividends: equityData.dividends, scenarios: equityData.scenarios, investmentStyle: equityData.investmentStyle, valueAnalysis: equityData.valueAnalysis, growthAnalysis: equityData.growthAnalysis } : null,
          mutualFunds: mfData,
          combined: { totalInvested: totI, currentValue: totC, totalPnl: totC - totI, totalPnlPercent: totI > 0 ? ((totC - totI) / totI) * 100 : 0, assetAllocation: { equity: { current: eqC, percent: totC > 0 ? (eqC / totC) * 100 : 0 }, mutualFunds: { current: mfC2, percent: totC > 0 ? (mfC2 / totC) * 100 : 0 } } },
          investorName, generatedBy: advisorName, reportId: rptId, generatedAt: rptDate, branding, sections: req.body?.sections,
        };
      }

      const { generatePortfolioReport } = require("./pdf-report");
      const pdfBuffer = await generatePortfolioReport(reportData);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=AlphaMarket_Report_" + rptId + ".pdf");
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("[PDF Report] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });


  // ─── File Upload (Local Storage — replaces Replit Object Storage) ────────────
  const uploadDir = "/var/www/alphamarket/uploads/general";

  app.post("/api/uploads/request-url", async (req, res) => {
    try {
      const { name, size, contentType } = req.body;
      if (!name) return res.status(400).json({ error: "File name is required" });

      const ext = name.includes(".") ? "." + name.split(".").pop() : "";
      const fileId = randomBytes(16).toString("hex");
      const fileName = fileId + ext;
      const objectPath = "/uploads/general/" + fileName;
      const uploadURL = "/api/uploads/" + fileId + ext;

      res.json({
        uploadURL,
        objectPath,
        metadata: { name, size: size || 0, contentType: contentType || "application/octet-stream" },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/uploads/:fileId", async (req, res) => {
    try {
      const fs = await import("fs");
      const path = await import("path");

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, req.params.fileId);
      const chunks: Buffer[] = [];

      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(filePath, buffer);
        res.status(200).send("OK");
      });
      req.on("error", (err: Error) => {
        res.status(500).json({ error: err.message });
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve uploaded files
  app.use("/uploads", (await import("express")).static("/var/www/alphamarket/uploads"));




  // ── Usage Tracking: Check remaining quota ──────────────────────
  app.get("/api/usage/check/:tool", requireAuth, async (req: any, res: any) => {
    try {
      const tool = req.params.tool;
      const config = await getMonetizationConfig();
      const toolConfig = config[tool];
      if (!toolConfig) return res.status(404).json({ error: "Unknown tool" });

      const period = toolConfig.freeTierPeriod || "month";
      const used = await getUsageCount(req.session.userId, tool, period);
      const limit = toolConfig.freeTierLimit || 999999;

      res.json({
        tool: tool,
        label: toolConfig.label || tool,
        used: used,
        limit: limit,
        remaining: Math.max(0, limit - used),
        period: period,
        allowed: used < limit,
        proPrice: toolConfig.proPrice,
        proPeriod: toolConfig.proPeriod || "month",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Usage Tracking: Log usage from frontend (DYOR etc) ────────
  app.post("/api/usage/log", requireAuth, async (req: any, res: any) => {
    try {
      const { tool, endpoint, metadata } = req.body;
      if (!tool) return res.status(400).json({ error: "tool is required" });

      const config = await getMonetizationConfig();
      const toolConfig = config[tool];
      if (!toolConfig || !toolConfig.enabled) return res.status(403).json({ error: "Tool disabled" });

      const period = toolConfig.freeTierPeriod || "month";
      const used = await getUsageCount(req.session.userId, tool, period);
      const limit = toolConfig.freeTierLimit || 999999;

      if (used >= limit) {
        return res.status(429).json({
          error: "Usage limit reached",
          tool: toolConfig.label || tool,
          used: used,
          limit: limit,
          period: period,
          upgrade: {
            message: "You have used all " + limit + " free " + (toolConfig.label || tool) + " analyses this " + period + ". Upgrade to Pro for unlimited access.",
            proPrice: toolConfig.proPrice,
            proPeriod: toolConfig.proPeriod || "month",
          },
        });
      }

      await logToolUsage(req.session.userId, tool, endpoint || null, metadata || {});
      res.json({ success: true, used: used + 1, limit: limit, remaining: Math.max(0, limit - used - 1) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Usage analytics dashboard ──────────────────────────
  app.get("/api/admin/usage-stats", requireAdmin, async (req: any, res: any) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const stats = await getUsageStats(days);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Tool Subscription: Create Cashfree order ───────────────────
  app.post("/api/tool-subscribe", requireAuth, async (req: any, res: any) => {
    try {
      const { tool, planType: reqPlanType, couponCode } = req.body;
      const planType = reqPlanType || "monthly";
      if (!tool) return res.status(400).json({ error: "tool is required" });

      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });

      const config = await getMonetizationConfig();
      let amount = 0;
      let analysesIncluded: number | null = null;
      let toolConfig: any = null;

      const validTools = ["alpha_bot", "options_alpha", "alpha_ideas", "algo_trading", "dyor_bundle", "stockMfBundle", "dyor"];
      if (!validTools.includes(tool)) return res.status(400).json({ error: "Unknown tool: " + tool });

      // Map legacy "dyor" to "dyor_bundle"
      const toolKey = tool === "dyor" ? "dyor_bundle" : tool;
      toolConfig = config[toolKey] || {};

      // Check broker-pays mode — skip payment for partner users
      const shadowResult = await db.execute(sql`SELECT psu.id, pc.payment_mode FROM partner_shadow_users psu JOIN partner_configs pc ON pc.id = psu.partner_id WHERE psu.user_data->>'appUserId' = ${user.id} LIMIT 1`);
      const shadow = ((shadowResult as any).rows || [])[0];
      if (shadow && (shadow.payment_mode === "broker_pays" || shadow.payment_mode === "free")) {
        // Auto-activate subscription without payment
        const expiresAt = new Date();
        if (planType === "annual") expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        else if (planType === "quarterly") expiresAt.setMonth(expiresAt.getMonth() + 3);
        else expiresAt.setMonth(expiresAt.getMonth() + 1);
        const bundleTools = toolConfig.includes || [];
        const toolsToGrant = bundleTools.length > 0 ? [toolKey, ...bundleTools] : [toolKey];
        for (const t of toolsToGrant) {
          await db.execute(sql`INSERT INTO tool_subscriptions (user_id, tool, plan_type, status, amount, analyses_included, expires_at) VALUES (${user.id}, ${t}, ${planType || "monthly"}, 'active', 0, ${analysesIncluded}, ${expiresAt.toISOString()})`);
        }
        return res.json({ success: true, status: "active", message: "Access granted by broker", broker_pays: true });
      }

      // Get price based on plan type
      if (planType === "quarterly") amount = toolConfig.quarterlyPrice || toolConfig.monthlyPrice * 3;
      else if (planType === "annual") amount = toolConfig.annualPrice || toolConfig.monthlyPrice * 12;
      else amount = toolConfig.monthlyPrice || 999;

      if (toolKey === "stockMfBundle") analysesIncluded = toolConfig.includedAnalyses || 3;

      let discountAmount = 0;
      if (couponCode) {
        const couponResult = await validateCoupon(couponCode, tool, amount);
        if (!couponResult.valid) return res.status(400).json({ error: couponResult.error });
        discountAmount = couponResult.discount;
      }

      const finalAmount = Math.max(amount - discountAmount, 1);
      const orderId = "TOOL_" + tool.toUpperCase() + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      const verifyToken = generateVerifyToken(orderId, user.id);
      const baseUrl = req.protocol + "://" + req.get("host");
      const returnUrl = baseUrl + "/payment-callback?order_id=" + orderId + "&vt=" + verifyToken + "&type=tool";

      const cfOrder = await createCashfreeOrder({
        orderId,
        amount: finalAmount,
        customerName: user.companyName || user.username,
        customerEmail: user.email,
        customerPhone: user.phone || "9999999999",
        customerId: user.id,
        returnUrl,
      });

      // Store pending subscription
      const expiresAt = new Date();
      if (planType === "annual") expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      else if (planType === "quarterly") expiresAt.setMonth(expiresAt.getMonth() + 3);
      else expiresAt.setMonth(expiresAt.getMonth() + 1);

      // For bundles, create subscriptions for all included tools
      const bundleTools = toolConfig.includes || [];
      const toolsToSubscribe = bundleTools.length > 0 ? [toolKey, ...bundleTools] : [toolKey];
      for (const t of toolsToSubscribe) {
        await db.execute(sql`INSERT INTO tool_subscriptions (user_id, tool, plan_type, status, amount, analyses_included, payment_order_id, coupon_code, discount_amount, expires_at)
          VALUES (${user.id}, ${t}, ${planType}, 'pending', ${finalAmount}, ${analysesIncluded}, ${orderId}, ${couponCode || null}, ${discountAmount}, ${expiresAt.toISOString()})`);
      }

      if (couponCode) await useCoupon(couponCode);

      res.json({
        orderId,
        paymentSessionId: cfOrder.payment_session_id,
        cfOrderId: cfOrder.cf_order_id,
        amount: finalAmount,
        originalAmount: amount,
        discount: discountAmount,
        couponCode: couponCode || null,
        verifyToken,
      });
    } catch (err: any) {
      console.error("[ToolSubscribe] Error:", err?.response?.data || err.message);
      res.status(500).json({ error: err?.response?.data?.message || err.message });
    }
  });

  // ── Tool Subscription: Verify payment & activate ──────────────
  app.post("/api/tool-subscribe/verify", requireAuth, async (req: any, res: any) => {
    try {
      const { orderId } = req.body;
      if (!orderId) return res.status(400).json({ error: "orderId required" });

      const cfOrder = await fetchCashfreeOrder(orderId);
      const status = cfOrder.order_status;

      if (status === "PAID") {
        await db.execute(sql`UPDATE tool_subscriptions SET status = 'active', starts_at = NOW() WHERE payment_order_id = ${orderId} AND status = 'pending'`);
        const sub = await db.execute(sql`SELECT * FROM tool_subscriptions WHERE payment_order_id = ${orderId}`);
        const row = ((sub as any).rows || [])[0];
        res.json({ success: true, status: "active", subscription: row });
      } else {
        await db.execute(sql`UPDATE tool_subscriptions SET status = ${status.toLowerCase()} WHERE payment_order_id = ${orderId} AND status = 'pending'`);
        res.json({ success: false, status: status });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Tool Subscription: Pay for additional analysis (overage) ──
  app.post("/api/tool-subscribe/overage", requireAuth, async (req: any, res: any) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });

      const config = await getMonetizationConfig();
      const bundleConfig = config.stockMfBundle || {};
      const amount = bundleConfig.additionalAnalysisPrice || 499;

      const orderId = "OVERAGE_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      const verifyToken = generateVerifyToken(orderId, user.id);
      const baseUrl = req.protocol + "://" + req.get("host");
      const returnUrl = baseUrl + "/payment-callback?order_id=" + orderId + "&vt=" + verifyToken + "&type=overage";

      const cfOrder = await createCashfreeOrder({
        orderId,
        amount,
        customerName: user.companyName || user.username,
        customerEmail: user.email,
        customerPhone: user.phone || "9999999999",
        customerId: user.id,
        returnUrl,
      });

      res.json({
        orderId,
        paymentSessionId: cfOrder.payment_session_id,
        cfOrderId: cfOrder.cf_order_id,
        amount,
        verifyToken,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Tool Subscription: Verify overage & increment quota ───────
  app.post("/api/tool-subscribe/overage/verify", requireAuth, async (req: any, res: any) => {
    try {
      const { orderId } = req.body;
      if (!orderId) return res.status(400).json({ error: "orderId required" });

      const cfOrder = await fetchCashfreeOrder(orderId);
      if (cfOrder.order_status === "PAID") {
        const sub = await getActiveSubscription(req.session.userId!, "stockMfBundle");
        if (sub) {
          await db.execute(sql`UPDATE tool_subscriptions SET analyses_included = analyses_included + 1 WHERE id = ${sub.id}`);
        }
        res.json({ success: true, message: "Additional analysis unlocked" });
      } else {
        res.json({ success: false, status: cfOrder.order_status });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── My subscriptions ──────────────────────────────────────────
  app.get("/api/my-subscriptions", requireAuth, async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`SELECT * FROM tool_subscriptions WHERE user_id = ${req.session.userId} ORDER BY created_at DESC`);
      res.json((result as any).rows || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Coupon: Validate (public, for checkout) ───────────────────
  app.post("/api/coupon/validate", requireAuth, async (req: any, res: any) => {
    try {
      const { code, tool, amount } = req.body;
      if (!code || !tool || !amount) return res.status(400).json({ error: "code, tool, amount required" });
      const result = await validateCoupon(code, tool, amount);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: CRUD coupon codes ──────────────────────────────────
  app.get("/api/admin/coupons", requireAdmin, async (_req: any, res: any) => {
    try {
      const result = await db.execute(sql`SELECT * FROM coupon_codes ORDER BY created_at DESC`);
      res.json((result as any).rows || []);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/coupons", requireAdmin, async (req: any, res: any) => {
    try {
      const { code, description, discountType, discountValue, applicableTools, maxUses, minAmount, maxDiscount, validFrom, validUntil } = req.body;
      if (!code || !discountValue) return res.status(400).json({ error: "code and discountValue required" });
      const toolsArr = applicableTools && applicableTools.length > 0 ? applicableTools : [];
      const toolsLiteral = "{" + toolsArr.join(",") + "}";
      await db.execute(sql`INSERT INTO coupon_codes (code, description, discount_type, discount_value, applicable_tools, max_uses, min_amount, max_discount, valid_from, valid_until)
        VALUES (${code.toUpperCase()}, ${description || null}, ${discountType || "percentage"}, ${discountValue}, ${toolsLiteral}::text[], ${maxUses || null}, ${minAmount || 0}, ${maxDiscount || null}, ${validFrom || new Date().toISOString()}, ${validUntil || null})`);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/admin/coupons/:id", requireAdmin, async (req: any, res: any) => {
    try {
      const { isActive, maxUses, validUntil, discountValue, maxDiscount } = req.body;
      const id = parseInt(req.params.id);
      if (isActive !== undefined) await db.execute(sql`UPDATE coupon_codes SET is_active = ${isActive} WHERE id = ${id}`);
      if (maxUses !== undefined) await db.execute(sql`UPDATE coupon_codes SET max_uses = ${maxUses} WHERE id = ${id}`);
      if (validUntil !== undefined) await db.execute(sql`UPDATE coupon_codes SET valid_until = ${validUntil} WHERE id = ${id}`);
      if (discountValue !== undefined) await db.execute(sql`UPDATE coupon_codes SET discount_value = ${discountValue} WHERE id = ${id}`);
      if (maxDiscount !== undefined) await db.execute(sql`UPDATE coupon_codes SET max_discount = ${maxDiscount} WHERE id = ${id}`);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/coupons/:id", requireAdmin, async (req: any, res: any) => {
    try {
      await db.execute(sql`DELETE FROM coupon_codes WHERE id = ${parseInt(req.params.id)}`);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Admin: View all tool subscriptions ────────────────────────
  app.get("/api/admin/tool-subscriptions", requireAdmin, async (req: any, res: any) => {
    try {
      const result = await db.execute(sql`SELECT ts.*, u.username, u.email, u.role FROM tool_subscriptions ts JOIN users u ON u.id = ts.user_id ORDER BY ts.created_at DESC LIMIT 200`);
      res.json((result as any).rows || []);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });


  // ── Admin: User Access Grants ─────────────────────────────────
  app.get("/api/admin/access-grants", requireAdmin, async (_req: any, res: any) => {
    try {
      const result = await db.execute(sql`SELECT ag.*, u.username, u.email, u.role, g.username AS granted_by_name
        FROM user_access_grants ag JOIN users u ON u.id = ag.user_id LEFT JOIN users g ON g.id = ag.granted_by
        ORDER BY ag.created_at DESC LIMIT 200`);
      res.json((result as any).rows || []);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/access-grants", requireAdmin, async (req: any, res: any) => {
    try {
      const { userId, tool, grantType, extraAnalyses, validUntil, note } = req.body;
      if (!userId || !tool || !grantType) return res.status(400).json({ error: "userId, tool, grantType required" });
      await db.execute(sql`INSERT INTO user_access_grants (user_id, tool, grant_type, extra_analyses, valid_until, note, granted_by)
        VALUES (${userId}, ${tool}, ${grantType}, ${extraAnalyses || null}, ${validUntil || null}, ${note || null}, ${req.session.userId})`);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/admin/access-grants/:id", requireAdmin, async (req: any, res: any) => {
    try {
      const { isActive, validUntil, extraAnalyses, note } = req.body;
      const id = parseInt(req.params.id);
      if (isActive !== undefined) await db.execute(sql`UPDATE user_access_grants SET is_active = ${isActive} WHERE id = ${id}`);
      if (validUntil !== undefined) await db.execute(sql`UPDATE user_access_grants SET valid_until = ${validUntil} WHERE id = ${id}`);
      if (extraAnalyses !== undefined) await db.execute(sql`UPDATE user_access_grants SET extra_analyses = ${extraAnalyses} WHERE id = ${id}`);
      if (note !== undefined) await db.execute(sql`UPDATE user_access_grants SET note = ${note} WHERE id = ${id}`);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/access-grants/:id", requireAdmin, async (req: any, res: any) => {
    try {
      await db.execute(sql`DELETE FROM user_access_grants WHERE id = ${parseInt(req.params.id)}`);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Admin: Search users (for grants UI) ───────────────────────
  app.get("/api/admin/users-search", requireAdmin, async (req: any, res: any) => {
    try {
      const q = req.query.q || "";
      const result = await db.execute(sql`SELECT id, username, email, role, is_approved, company_name FROM users
        WHERE username ILIKE ${'%' + q + '%'} OR email ILIKE ${'%' + q + '%'} OR company_name ILIKE ${'%' + q + '%'}
        ORDER BY created_at DESC LIMIT 20`);
      res.json((result as any).rows || []);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });


  // ═══ BROKER / XTS ADMIN MODULE ═══════════════════════════════════════════
  app.get("/api/admin/broker-connections", requireAdmin, async (_req, res) => {
    try {
      const result = await db.execute(sql.raw(`
        SELECT bc.*,
          COALESCE(COUNT(DISTINCT bam.advisor_id),0)::int as advisor_count,
          COALESCE(COUNT(DISTINCT bsm.strategy_id),0)::int as strategy_count,
          COALESCE((SELECT COUNT(*) FROM xts_publish_log xl WHERE xl.broker_connection_id=bc.id AND xl.status='success'),0)::int as total_published,
          COALESCE((SELECT COUNT(*) FROM xts_publish_log xl WHERE xl.broker_connection_id=bc.id AND xl.status='error'),0)::int as total_errors,
          COALESCE((SELECT COUNT(*) FROM xts_publish_log xl WHERE xl.broker_connection_id=bc.id AND xl.published_at>NOW()-INTERVAL '24 hours'),0)::int as published_24h
        FROM broker_connections bc
        LEFT JOIN broker_advisor_mappings bam ON bam.broker_connection_id=bc.id AND bam.is_enabled=true
        LEFT JOIN broker_strategy_mappings bsm ON bsm.broker_connection_id=bc.id AND bsm.is_enabled=true
        GROUP BY bc.id ORDER BY bc.created_at DESC
      `));
      res.json(result.rows);
    } catch(err:any){res.status(500).send(err.message);}
  });
  app.post("/api/admin/broker-connections", requireAdmin, async (req, res) => {
    try {
      const {name,brokerType,baseUrl,vendorCode,vendorKey,notes}=req.body;
      if(!name||!baseUrl||!vendorCode||!vendorKey) return res.status(400).send("name,baseUrl,vendorCode,vendorKey required");
      const result=await db.execute(sql`INSERT INTO broker_connections(name,broker_type,base_url,vendor_code,vendor_key,notes) VALUES(${name},${brokerType||'XTS'},${baseUrl},${vendorCode},${vendorKey},${notes||null}) RETURNING *`);
      res.json(result.rows[0]);
    } catch(err:any){res.status(500).send(err.message);}
  });
  app.patch("/api/admin/broker-connections/:id", requireAdmin, async (req, res) => {
    try {
      const {name,baseUrl,vendorCode,vendorKey,isEnabled,notes}=req.body;
      const result=await db.execute(sql`UPDATE broker_connections SET name=COALESCE(${name??null},name),base_url=COALESCE(${baseUrl??null},base_url),vendor_code=COALESCE(${vendorCode??null},vendor_code),vendor_key=COALESCE(${vendorKey??null},vendor_key),is_enabled=COALESCE(${isEnabled??null},is_enabled),notes=COALESCE(${notes??null},notes),updated_at=NOW() WHERE id=${req.params.id} RETURNING *`);
      if(!result.rows.length) return res.status(404).send("Not found");
      res.json(result.rows[0]);
    } catch(err:any){res.status(500).send(err.message);}
  });
  app.delete("/api/admin/broker-connections/:id", requireAdmin, async (req, res) => {
    try{await db.execute(sql`DELETE FROM broker_connections WHERE id=${req.params.id}`);res.json({ok:true});}
    catch(err:any){res.status(500).send(err.message);}
  });
  app.post("/api/admin/broker-connections/:id/test", requireAdmin, async (req, res) => {
    try {
      const connResult=await db.execute(sql`SELECT * FROM broker_connections WHERE id=${req.params.id}`);
      if(!connResult.rows.length) return res.status(404).send("Not found");
      const conn=connResult.rows[0] as any;
      let pingStatus='error',pingError:string|null=null,token:string|null=null;
      try {
        const response=await fetch(`${conn.base_url}/sessiontoken`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vendorCode:conn.vendor_code,vendorKey:conn.vendor_key}),signal:AbortSignal.timeout(10000)});
        const data=await response.json() as any;
        token=data?.result?.token||data?.token||null;
        pingStatus=token?'ok':'error';
        if(!token) pingError=JSON.stringify(data).slice(0,300);
        await db.execute(sql`UPDATE broker_connections SET last_ping_at=NOW(),last_ping_status=${pingStatus},last_ping_error=${pingError},token=${token},token_issued_at=${token?new Date():null},updated_at=NOW() WHERE id=${req.params.id}`);
        res.json({status:pingStatus,token:token?'received':null,error:pingError,rawResponse:data});
      } catch(fetchErr:any){
        pingError=fetchErr.message;
        await db.execute(sql`UPDATE broker_connections SET last_ping_at=NOW(),last_ping_status='error',last_ping_error=${pingError},updated_at=NOW() WHERE id=${req.params.id}`);
        res.json({status:'error',error:pingError});
      }
    } catch(err:any){res.status(500).send(err.message);}
  });



  // XTS Call Log — Download (CSV / XLSX / PDF)
  app.get("/api/admin/xts-call-log/download", requireAdmin, async (req, res) => {
    try {
      const format = ((req.query.format as string) || "csv").toLowerCase();
      const period = req.query.period as string;
      const from = req.query.from as string;
      const to = req.query.to as string;
      const now = new Date();

      let dateFilter = "AND 1=1";
      if (period === "daily") {
        dateFilter = "AND published_at >= NOW() - INTERVAL '1 day'";
      } else if (period === "weekly") {
        dateFilter = "AND published_at >= NOW() - INTERVAL '7 days'";
      } else if (period === "monthly") {
        dateFilter = "AND published_at >= NOW() - INTERVAL '30 days'";
      } else if (period === "custom" && from && to) {
        dateFilter = "AND published_at >= '" + from + "'::timestamptz AND published_at <= '" + to + "'::timestamptz";
      }

      const result = await db.execute(sql.raw(
        "SELECT " +
        "  l.id, " +
        "  l.published_at, " +
        "  l.event_type, " +
        "  l.call_type, " +
        "  l.symbol, " +
        "  l.advisor_id, " +
        "  u.company_name AS advisor_name, " +
        "  u.email AS advisor_email, " +
        "  u.sebi_reg_number AS advisor_sebi_reg_no, " +
        "  l.strategy_id, " +
        "  s.name AS strategy_name, " +
        "  s.type AS strategy_type, " +
        "  l.message_id AS recommendation_id, " +
        "  l.status AS publish_status, " +
        "  l.error_message, " +
        "  l.retry_count, " +
        "  l.payload->>'strategyname' AS strategy_full_name, " +
        "  l.payload->>'theory' AS rationale, " +
        "  l.payload->>'badge' AS badge, " +
        "  l.payload->>'validity' AS validity, " +
        "  l.payload->>'thematicCollection' AS thematic_collection, " +
        "  l.payload->>'exchangeInstrumentID' AS exchange_instrument_id, " +
        "  l.payload->>'limitPrice' AS limit_price, " +
        "  l.payload->>'targetPrice' AS target_price, " +
        "  l.payload->>'stopLossPrice' AS stop_loss_price, " +
        "  l.payload->>'profitBookedPrice' AS profit_booked_price, " +
        "  l.payload->'orders'->0->>'series' AS series, " +
        "  l.payload->'orders'->0->>'productType' AS product_type, " +
        "  l.payload->'orders'->0->>'orderSide' AS order_side, " +
        "  l.payload->'orders'->0->>'exchange' AS exchange, " +
        "  l.payload->'orders'->0->>'legId' AS leg_id, " +
        "  l.payload->'orders'->0->>'name' AS instrument_name, " +
        "  l.payload->'orders'->0->>'orderQuantity' AS lots, " +
        "  l.payload->'orders'->0->>'stopLoss' AS order_stop_loss, " +
        "  l.payload->'orders'->0->>'target' AS order_target, " +
        "  l.payload->'orders'->0->>'createdAt' AS call_date, " +
        "  l.response->>'code' AS xts_response_code, " +
        "  l.response->>'description' AS xts_response_description, " +
        "  l.payload AS full_payload " +
        "FROM xts_publish_log l " +
        "LEFT JOIN users u ON u.id = l.advisor_id " +
        "LEFT JOIN strategies s ON s.id = l.strategy_id " +
        "WHERE 1=1 " + dateFilter + " " +
        "ORDER BY l.published_at DESC LIMIT 5000"
      ));

      const rows = result.rows as any[];
      const filename = "xts_call_log_" + (period || "custom") + "_" + now.toISOString().slice(0, 10);

      if (format === "csv") {
        let csv = "";
        if (rows.length === 0) {
          csv = "No data";
        } else {
          const headers = Object.keys(rows[0]);
          csv = headers.join(",") + "\n";
          for (const row of rows) {
            csv += headers.map((h) => {
              const v = row[h] == null ? "" : String(row[h]).replace(/"/g, '""');
              return '"' + v + '"';
            }).join(",") + "\n";
          }
        }
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '.csv"');
        return res.send(csv);
      }

      if (format === "xlsx") {
        const ExcelJS = require("exceljs");
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("XTS Call Log");
        if (rows.length > 0) {
          ws.columns = Object.keys(rows[0]).map((k: string) => ({ header: k, key: k, width: 22 }));
          for (const row of rows) ws.addRow(row);
          ws.getRow(1).font = { bold: true };
          ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a1a2e" } };
          ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        }
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '.xlsx"');
        await wb.xlsx.write(res);
        return res.end();
      }

      if (format === "pdf") {
        const PDFDocument = require("pdfkit");
        const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '.pdf"');
        doc.pipe(res);
        doc.fontSize(14).font("Helvetica-Bold").text("XTS Call Log — AlphaMarket", { align: "center" });
        doc.fontSize(9).font("Helvetica").text("Period: " + (period || "custom") + " | Generated: " + now.toLocaleString("en-IN"), { align: "center" });
        doc.moveDown(0.5);
        const cols = ["published_at", "advisor_company", "strategy_name", "symbol", "call_type", "buy_price", "target_price", "stop_loss", "publish_status"];
        const colW = 115;
        let x = 30;
        let y = doc.y;
        doc.fontSize(7).font("Helvetica-Bold");
        for (const c of cols) { doc.text(c, x, y, { width: colW, ellipsis: true }); x += colW; }
        y += 14;
        doc.font("Helvetica");
        for (const row of rows.slice(0, 300)) {
          if (y > 540) { doc.addPage({ layout: "landscape" }); y = 30; }
          x = 30;
          for (const c of cols) {
            const v = row[c] == null ? "" : c === "published_at" ? new Date(row[c]).toLocaleString("en-IN") : String(row[c]);
            doc.fontSize(6).text(v, x, y, { width: colW, ellipsis: true });
            x += colW;
          }
          y += 11;
        }
        if (rows.length > 300) {
          doc.fontSize(7).text("... and " + (rows.length - 300) + " more rows. Use CSV/XLSX for full export.", 30, y + 10);
        }
        doc.end();
        return;
      }

      res.status(400).json({ error: "Invalid format. Use csv, xlsx, or pdf" });
    } catch (err: any) {
      console.error("[XTS Download]", err);
      res.status(500).send(err.message);
    }
  });

  app.get("/api/admin/broker-connections/:id/advisor-mappings", requireAdmin, async (req, res) => {
    try {
      const result=await db.execute(sql`SELECT u.id,u.email,u.username,u.company_name as "companyName",u.role,u.is_approved as "isApproved",bam.id as mapping_id,bam.is_enabled as mapping_enabled,bam.push_equity_calls,bam.push_fno_positions,bam.push_basket,bam.thematic_collection_override FROM users u LEFT JOIN broker_advisor_mappings bam ON bam.advisor_id=u.id AND bam.broker_connection_id=${req.params.id} WHERE u.role='advisor' ORDER BY u.company_name`);
      res.json(result.rows);
    } catch(err:any){res.status(500).send(err.message);}
  });
  app.post("/api/admin/broker-connections/:id/advisor-mappings", requireAdmin, async (req, res) => {
    try {
      const {advisorId,isEnabled,pushEquityCalls,pushFnoPositions,pushBasket,thematicCollectionOverride}=req.body;
      const result=await db.execute(sql`INSERT INTO broker_advisor_mappings(broker_connection_id,advisor_id,is_enabled,push_equity_calls,push_fno_positions,push_basket,thematic_collection_override) VALUES(${req.params.id},${advisorId},${isEnabled??true},${pushEquityCalls??true},${pushFnoPositions??true},${pushBasket??false},${thematicCollectionOverride||null}) ON CONFLICT(broker_connection_id,advisor_id) DO UPDATE SET is_enabled=EXCLUDED.is_enabled,push_equity_calls=EXCLUDED.push_equity_calls,push_fno_positions=EXCLUDED.push_fno_positions,push_basket=EXCLUDED.push_basket,thematic_collection_override=EXCLUDED.thematic_collection_override RETURNING *`);
      res.json(result.rows[0]);
    } catch(err:any){res.status(500).send(err.message);}
  });
  app.get("/api/admin/broker-connections/:id/strategy-mappings", requireAdmin, async (req, res) => {
    try {
      const connId = req.params.id.replace(/[^a-f0-9-]/gi, '');
      const result=await db.execute(sql.raw(`SELECT s.id,s.name,s.type,s.status,s.advisor_id as "advisorId",u.company_name as advisor_name,bsm.id as mapping_id,bsm.is_enabled as mapping_enabled,bsm.custom_strategy_name FROM strategies s LEFT JOIN users u ON u.id=s.advisor_id LEFT JOIN broker_strategy_mappings bsm ON bsm.strategy_id=s.id AND bsm.broker_connection_id='${connId}' WHERE s.status='Published' ORDER BY u.company_name,s.name`));
      res.json(result.rows);
    } catch(err:any){res.status(500).send(err.message);}
  });
  app.post("/api/admin/broker-connections/:id/strategy-mappings", requireAdmin, async (req, res) => {
    try {
      const {strategyId,isEnabled,customStrategyName}=req.body;
      const result=await db.execute(sql`INSERT INTO broker_strategy_mappings(broker_connection_id,strategy_id,is_enabled,custom_strategy_name) VALUES(${req.params.id},${strategyId},${isEnabled??true},${customStrategyName||null}) ON CONFLICT(broker_connection_id,strategy_id) DO UPDATE SET is_enabled=EXCLUDED.is_enabled,custom_strategy_name=EXCLUDED.custom_strategy_name RETURNING *`);
      res.json(result.rows[0]);
    } catch(err:any){res.status(500).send(err.message);}
  });
  app.get("/api/admin/broker-connections/:id/publish-log", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string || '50'), 5000);
      const offset = parseInt(req.query.offset as string || '0');
      const status = req.query.status as string;
      const from = req.query.from as string;
      const to = req.query.to as string;
      const format = req.query.format as string;

      const conditions = [sql`xl.broker_connection_id=${req.params.id}`];
      if (status) conditions.push(sql`xl.status=${status}`);
      if (from) conditions.push(sql`xl.published_at >= ${from}::timestamptz`);
      if (to) conditions.push(sql`xl.published_at <= ${to}::timestamptz + INTERVAL '1 day'`);

      const where = sql.join(conditions, sql` AND `);

      const countResult = await db.execute(sql`SELECT COUNT(*)::int as total FROM xts_publish_log xl WHERE ${where}`);
      const total = (countResult.rows[0] as any).total;

      const result = await db.execute(sql`SELECT xl.*, u.company_name as advisor_name, s.name as strategy_name FROM xts_publish_log xl LEFT JOIN users u ON u.id=xl.advisor_id LEFT JOIN strategies s ON s.id=xl.strategy_id WHERE ${where} ORDER BY xl.published_at DESC LIMIT ${limit} OFFSET ${offset}`);

      if (format === 'csv') {
        const rows = result.rows as any[];
        const header = 'published_at,event_type,symbol,advisor_name,strategy_name,status,error_message,retry_count\n';
        const csv = header + rows.map((r: any) =>
          [r.published_at, r.event_type, r.symbol, r.advisor_name || '', r.strategy_name || '', r.status, (r.error_message || '').replace(/,/g, ';'), r.retry_count].join(',')
        ).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=xts-publish-log.csv');
        return res.send(csv);
      }

      res.json({ rows: result.rows, total, limit, offset });
    } catch(err:any){res.status(500).send(err.message);}
  });
  app.get("/api/admin/xts-dashboard", requireAdmin, async (_req, res) => {
    try {
      const [conns,stats]=await Promise.all([
        db.execute(sql`SELECT COUNT(*)::int as total,SUM(CASE WHEN is_enabled THEN 1 ELSE 0 END)::int as enabled FROM broker_connections`),
        db.execute(sql`SELECT COUNT(*) FILTER(WHERE status='success')::int as total_success,COUNT(*) FILTER(WHERE status='error')::int as total_error,COUNT(*) FILTER(WHERE status='success' AND published_at>NOW()-INTERVAL '24 hours')::int as success_24h,COUNT(*) FILTER(WHERE status='error' AND published_at>NOW()-INTERVAL '24 hours')::int as error_24h FROM xts_publish_log`),
      ]);
      res.json({brokers:conns.rows[0],publishing:stats.rows[0]});
    } catch(err:any){res.status(500).send(err.message);}
  });

  // ═══ PULL API BROKER ADMIN ROUTES ═══
  app.get("/api/admin/pull-api/brokers", requireAdmin, async (_req, res) => {
    try {
      const keys = await db.execute(sql`SELECT k.*, 
        (SELECT COUNT(*)::int FROM broker_api_logs WHERE api_key_id=k.id AND created_at > NOW()-INTERVAL '24 hours') as requests_24h,
        (SELECT COUNT(*)::int FROM broker_webhook_logs WHERE api_key_id=k.id AND created_at > NOW()-INTERVAL '24 hours' AND delivered=true) as webhooks_24h,
        (SELECT COUNT(*)::int FROM broker_webhook_logs WHERE api_key_id=k.id AND created_at > NOW()-INTERVAL '24 hours' AND delivered=false) as webhook_errors_24h
        FROM broker_api_keys k ORDER BY k.created_at DESC`);
      res.json(keys.rows);
    } catch(err:any){res.status(500).send(err.message);}
  });

  app.post("/api/admin/pull-api/brokers", requireAdmin, async (req, res) => {
    try {
      const { brokerName, contactEmail, contactName, permissions, rateLimit, ipWhitelist, webhookUrl, webhookEvents, notes, webhookPayloadVersion, allowedSegments, allowedStrategies, webhookTimeoutMs } = req.body;
      if (!brokerName) return res.status(400).send("brokerName required");
      const crypto = require("crypto");
      const apiKey = "amk_live_" + crypto.randomBytes(24).toString("hex");
      const apiSecret = crypto.randomBytes(32).toString("hex");
      const result = await db.execute(sql`INSERT INTO broker_api_keys (broker_name, api_key, api_secret, contact_email, contact_name, permissions, rate_limit, ip_whitelist, webhook_url, webhook_events, webhook_payload_version, allowed_segments, allowed_strategies, webhook_timeout_ms)
        VALUES (${brokerName}, ${apiKey}, ${apiSecret}, ${contactEmail||null}, ${contactName||null}, ${permissions||['read']}, ${rateLimit||100}, ${ipWhitelist||null}, ${webhookUrl||null}, ${webhookEvents||null}, ${webhookPayloadVersion||'v1_thealphamarket'}, ${allowedSegments||null}, ${allowedStrategies||null}, ${webhookTimeoutMs||10000})
        RETURNING *`);
      res.status(201).json({...result.rows[0], api_key: apiKey, api_secret: apiSecret});
    } catch(err:any){res.status(500).send(err.message);}
  });

  app.patch("/api/admin/pull-api/brokers/:id", requireAdmin, async (req, res) => {
    try {
      const b = req.body;
      const id = req.params.id;
      const parts: any[] = [];
      if (b.brokerName !== undefined) parts.push(sql`broker_name = ${b.brokerName}`);
      if (b.isActive !== undefined) parts.push(sql`is_active = ${b.isActive}`);
      if (b.contactEmail !== undefined) parts.push(sql`contact_email = ${b.contactEmail}`);
      if (b.contactName !== undefined) parts.push(sql`contact_name = ${b.contactName}`);
      if (b.rateLimit !== undefined) parts.push(sql`rate_limit = ${b.rateLimit}`);
      if (b.webhookUrl !== undefined) parts.push(sql`webhook_url = ${b.webhookUrl}`);
      if (b.webhookPayloadVersion !== undefined) parts.push(sql`webhook_payload_version = ${b.webhookPayloadVersion}`);
      if (b.webhookTimeoutMs !== undefined) parts.push(sql`webhook_timeout_ms = ${b.webhookTimeoutMs}`);
      if (b.notes !== undefined) parts.push(sql`notes = ${b.notes}`);
      if (b.allowedSegments !== undefined) {
        const v = Array.isArray(b.allowedSegments) && b.allowedSegments.length > 0
          ? '{"' + b.allowedSegments.join('","') + '"}'
          : null;
        parts.push(sql`allowed_segments = ${v}::text[]`);
      }
      if (b.allowedStrategies !== undefined) {
        const v = Array.isArray(b.allowedStrategies) && b.allowedStrategies.length > 0
          ? '{"' + b.allowedStrategies.join('","') + '"}'
          : null;
        parts.push(sql`allowed_strategies = ${v}::text[]`);
      }
      if (b.webhookEvents !== undefined) {
        const v = Array.isArray(b.webhookEvents) && b.webhookEvents.length > 0
          ? '{"' + b.webhookEvents.join('","') + '"}'
          : null;
        parts.push(sql`webhook_events = ${v}::text[]`);
      }
      if (b.ipWhitelist !== undefined) {
        const v = Array.isArray(b.ipWhitelist) && b.ipWhitelist.length > 0
          ? '{"' + b.ipWhitelist.join('","') + '"}'
          : null;
        parts.push(sql`ip_whitelist = ${v}::text[]`);
      }
      if (parts.length === 0) return res.json({status:"no changes"});
      await db.execute(sql`UPDATE broker_api_keys SET ${sql.join(parts, sql`, `)} WHERE id = ${id}`);
      res.json({status:"updated"});
    } catch(err:any){res.status(500).send(err.message);}
  });

  app.put("/api/admin/pull-api/brokers/:id/advisors", requireAdmin, async (req, res) => {
    try {
      const { advisorIds } = req.body;
      const pgArray = Array.isArray(advisorIds) && advisorIds.length > 0
        ? '{' + advisorIds.map((id: string) => '"' + id.replace(/"/g, '\\"') + '"').join(',') + '}'
        : null;
      await db.execute(sql`UPDATE broker_api_keys SET allowed_advisors = ${pgArray}::text[] WHERE id=${req.params.id}`);
      res.json({status:"updated"});
    } catch(err:any){res.status(500).send(err.message);}
  });

  app.get("/api/admin/pull-api/brokers/:id/advisors", requireAdmin, async (req, res) => {
    try {
      const key = await db.execute(sql`SELECT allowed_advisors FROM broker_api_keys WHERE id=${req.params.id}`);
      const allowed = key.rows[0]?.allowed_advisors || [];
      const advisors = await storage.getAdvisors();
      const mapped = advisors.filter((a:any) => a.isApproved).map((a:any) => ({
        id: a.id, username: a.username, companyName: a.companyName, email: a.email, isApproved: a.isApproved,
        enabled: allowed.length === 0 || allowed.includes(a.id)
      }));
      res.json(mapped);
    } catch(err:any){res.status(500).send(err.message);}
  });

  app.get("/api/admin/pull-api/brokers/:id/logs", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string)||50, 200);
      const logs = await db.execute(sql`SELECT * FROM broker_api_logs WHERE api_key_id=${req.params.id} ORDER BY created_at DESC LIMIT ${limit}`);
      res.json(logs.rows);
    } catch(err:any){res.status(500).send(err.message);}
  });

  
  // ─── GET /api/admin/strategies/list — for admin multi-select of allowed_strategies ───
  app.get("/api/admin/strategies/list", requireAdmin, async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT s.id, s.slug, s.name, s.type, s.status,
               u.id AS advisor_id, u.company_name AS advisor_name, u.username AS advisor_username
        FROM strategies s
        JOIN users u ON u.id = s.advisor_id
        WHERE s.status != 'Draft'
        ORDER BY u.company_name NULLS LAST, s.name
      `);
      res.json(r.rows);
    } catch (e: any) {
      console.error("[admin strategies list]", e);
      res.status(500).json({ error: "Failed to fetch strategies" });
    }
  });

  
  // ─── GET /api/admin/pull-api/brokers/:id/strategies ───
  // Lists all non-draft strategies with an 'enabled' flag indicating whether
  // this broker's allowed_strategies includes them.
  app.get("/api/admin/pull-api/brokers/:id/strategies", requireAdmin, async (req, res) => {
    try {
      const brokerId = req.params.id;
      const brokerQ = await db.execute(sql`
        SELECT allowed_strategies FROM broker_api_keys WHERE id = ${brokerId}
      `);
      if (!brokerQ.rows.length) return res.status(404).json({ error: "Broker not found" });
      const allowed = (brokerQ.rows[0] as any).allowed_strategies as string[] | null;

      const r = await db.execute(sql`
        SELECT s.id, s.slug, s.name, s.type, s.status,
               u.id AS advisor_id, u.company_name AS advisor_name, u.username AS advisor_username
        FROM strategies s
        JOIN users u ON u.id = s.advisor_id
        WHERE s.status != 'Draft'
        ORDER BY u.company_name NULLS LAST, s.name
      `);

      const out = (r.rows as any[]).map(row => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        type: row.type,
        status: row.status,
        advisor_id: row.advisor_id,
        advisor_name: row.advisor_name || row.advisor_username,
        enabled: allowed ? allowed.includes(row.id) : false,
      }));
      res.json(out);
    } catch (e: any) {
      console.error("[admin pull-api broker strategies]", e);
      res.status(500).json({ error: "Failed to fetch strategies" });
    }
  });

  // ─── PUT /api/admin/pull-api/brokers/:id/strategies ───
  // Updates broker_api_keys.allowed_strategies. Empty/null array means "no restriction".
  app.put("/api/admin/pull-api/brokers/:id/strategies", requireAdmin, async (req, res) => {
    try {
      const brokerId = req.params.id;
      const { strategyIds } = req.body;
      if (!Array.isArray(strategyIds)) {
        return res.status(400).json({ error: "strategyIds must be an array" });
      }
      // Empty array → null (no restriction). Non-empty → array of UUIDs.
      const pgArray = strategyIds.length > 0
        ? '{' + strategyIds.map((id: string) => '"' + id.replace(/"/g, '\\"') + '"').join(',') + '}'
        : null;
      await db.execute(sql`
        UPDATE broker_api_keys
        SET allowed_strategies = ${pgArray}::text[]
        WHERE id = ${brokerId}
      `);
      res.json({ status: "UPDATED", count: strategyIds.length });
    } catch (e: any) {
      console.error("[admin pull-api update strategies]", e);
      res.status(500).json({ error: "Failed to update strategies" });
    }
  });

  app.get("/api/admin/pull-api/brokers/:id/webhook-logs", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string || '50'), 5000);
      const offset = parseInt(req.query.offset as string || '0');
      const from = req.query.from as string;
      const to = req.query.to as string;
      const format = req.query.format as string;

      const conditions = [sql`api_key_id=${req.params.id}`];
      if (from) conditions.push(sql`created_at >= ${from}::timestamptz`);
      if (to) conditions.push(sql`created_at <= ${to}::timestamptz + INTERVAL '1 day'`);

      const where = sql.join(conditions, sql` AND `);

      const countResult = await db.execute(sql`SELECT COUNT(*)::int as total FROM broker_webhook_logs WHERE ${where}`);
      const total = (countResult.rows[0] as any).total;

      const logs = await db.execute(sql`SELECT 
        bwl.*,
        COALESCE(bwl.payload->'equityCall'->>'symbol', bwl.payload->'data'->'equityCall'->>'symbol') AS symbol,
        COALESCE(bwl.payload->'equityCall'->>'name', bwl.payload->'data'->'equityCall'->>'name', bwl.payload->>'symbol') AS stock_name,
        COALESCE(bwl.payload->>'callStatus', bwl.payload->'data'->'equityCall'->>'status', bwl.payload->'data'->'fnoCall'->0->>'status') AS call_status,
        COALESCE(bwl.payload->>'callType', bwl.payload->'data'->'equityCall'->>'callType', bwl.payload->'data'->'fnoCall'->0->>'callType') AS call_type,
        COALESCE(bwl.payload->'equityCall'->>'exitType', bwl.payload->'data'->'equityCall'->>'exitType', bwl.payload->'data'->'fnoCall'->0->>'exitType') AS exit_type,
        COALESCE(bwl.payload->'equityCall'->>'buyPrice', bwl.payload->'data'->'equityCall'->>'buyPrice', bwl.payload->'data'->'fnoCall'->0->>'buyPrice') AS buy_price,
        COALESCE(bwl.payload->'equityCall'->>'sellPrice', bwl.payload->'data'->'equityCall'->>'sellPrice', bwl.payload->'data'->'fnoCall'->0->>'sellPrice') AS sell_price,
        COALESCE(bwl.payload->'equityCall'->>'profitLossPercent', bwl.payload->'data'->'equityCall'->>'profitLossPercent', bwl.payload->'data'->'fnoCall'->0->>'profitLossPercent') AS pnl_percent,
        COALESCE(bwl.payload->>'advisorName', bwl.payload->'data'->>'advisorName') AS advisor_name,
        COALESCE(bwl.payload->>'strategyName', bwl.payload->'data'->>'strategyName') AS strategy_name,
        COALESCE(bwl.payload->>'strategyType', bwl.payload->'data'->>'strategyType') AS strategy_type,
        COALESCE(
          bwl.payload->>'symbol',
          bwl.payload->'equityCall'->>'symbol',
          bwl.payload->'data'->'equityCall'->>'symbol',
          bwl.payload->'fnoCall'->0->>'symbol',
          bwl.payload->'data'->'fnoCall'->0->>'symbol',
          bwl.payload->'data'->>'symbol'
        ) AS display_symbol,
        COALESCE(bwl.payload->>'legGroupId', bwl.payload->'data'->>'legGroupId') AS leg_group_id,
        bwl.payload->>'recommendationId' AS recommendation_id,
        CASE
          WHEN jsonb_typeof(bwl.payload->'data'->'fnoCall') = 'array' AND jsonb_array_length(bwl.payload->'data'->'fnoCall') > 1 THEN 'Multileg'
          WHEN (COALESCE(bwl.payload->>'isMultiLeg', bwl.payload->'data'->>'isMultiLeg'))::text = 'true' THEN 'Multileg'
          WHEN jsonb_typeof(bwl.payload->'data'->'fnoCall') = 'array' AND jsonb_array_length(bwl.payload->'data'->'fnoCall') = 1 THEN
            CASE
              WHEN bwl.payload->'data'->'horizon' ? 'Intraday' THEN 'FnO Intraday'
              WHEN bwl.payload->'data'->>'strategyType' = 'Future' THEN 'Futures'
              WHEN bwl.payload->'data'->>'strategyType' = 'CommodityFuture' THEN 'Commodity'
              ELSE COALESCE('FnO ' || (bwl.payload->'data'->'fnoCall'->0->>'optionType'), 'F&O')
            END
          WHEN bwl.payload->'data'->'equityCall' IS NOT NULL THEN
            CASE
              WHEN bwl.payload->'data'->'horizon' ? 'Intraday' THEN 'Equity Intraday'
              WHEN bwl.payload->'data'->'horizon' ? 'BTST' THEN 'BTST'
              WHEN bwl.payload->'data'->'horizon' ? 'Short Term' THEN 'Short Term'
              WHEN bwl.payload->'data'->'horizon' ? 'Positional' THEN 'Positional'
              ELSE 'Equity'
            END
          ELSE
            CASE
              WHEN (COALESCE(bwl.payload->>'isMultiLeg', bwl.payload->'data'->>'isMultiLeg'))::text = 'true' THEN 'Multileg'
              WHEN bwl.payload->'data'->'horizon' ? 'Intraday' THEN 'FnO Intraday'
              WHEN bwl.payload->'data'->>'strategyType' IN ('Option','Future') THEN 'F&O'
              ELSE 'Unknown'
            END
        END AS instrument_type
      FROM broker_webhook_logs bwl WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`);

      if (format === 'csv') {
        const rows = logs.rows as any[];
        const header = 'created_at,event,status_code,delivered,error_message,delivered_at\n';
        const csv = header + rows.map((r: any) =>
          [r.created_at, r.event, r.status_code, r.delivered, (r.error_message || '').replace(/,/g, ';'), r.delivered_at || ''].join(',')
        ).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=webhook-logs.csv');
        return res.send(csv);
      }

      res.json({ rows: logs.rows, total, limit, offset });
    } catch(err:any){res.status(500).send(err.message);}
  });

  app.get("/api/admin/pull-api/dashboard", requireAdmin, async (_req, res) => {
    try {
      const [keys,apiLogs,whLogs] = await Promise.all([
        db.execute(sql`SELECT COUNT(*)::int as total, SUM(CASE WHEN is_active THEN 1 ELSE 0 END)::int as active FROM broker_api_keys`),
        db.execute(sql`SELECT COUNT(*)::int as requests_24h FROM broker_api_logs WHERE created_at > NOW()-INTERVAL '24 hours'`),
        db.execute(sql`SELECT COUNT(*) FILTER(WHERE delivered=true)::int as delivered_24h, COUNT(*) FILTER(WHERE delivered=false)::int as failed_24h FROM broker_webhook_logs WHERE created_at > NOW()-INTERVAL '24 hours'`),
      ]);
      res.json({brokers: keys.rows[0], api: apiLogs.rows[0], webhooks: whLogs.rows[0]});
    } catch(err:any){res.status(500).send(err.message);}
  });

  app.delete("/api/admin/pull-api/brokers/:id", requireAdmin, async (req, res) => {
    try {
      await db.execute(sql`DELETE FROM broker_api_keys WHERE id=${req.params.id}`);
      res.json({status:"deleted"});
    } catch(err:any){res.status(500).send(err.message);}
  });


  
  

  // ADMIN: Closed Calls Management

  app.get("/api/admin/calls/closed", requireAdmin, async (req, res) => {
    try {
      const pg = parseInt(req.query.page as string) || 1;
      const lim = 50;
      const off = (pg - 1) * lim;
      const countR = await db.execute(sql`SELECT COUNT(*) as total FROM calls WHERE status = 'Closed'`);
      const total = Number(countR.rows[0]?.total || 0);
      const rows = await db.execute(sql`SELECT c.*, st.name as strategy_name, st.type as strategy_type, us.username as advisor_name, us.email as advisor_email FROM calls c JOIN strategies st ON c.strategy_id = st.id JOIN users us ON st.advisor_id = us.id WHERE c.status = 'Closed' ORDER BY c.exit_date DESC NULLS LAST, c.call_date DESC LIMIT 50 OFFSET ${off}`);
      res.json({ calls: rows.rows, total, page: pg, limit: lim, pages: Math.ceil(total / lim) });
    } catch (err: any) { res.status(500).send(err.message); }
  });

  app.patch("/api/admin/calls/:id", requireAdmin, async (req, res) => {
    try {
      const cid = req.params.id;
      const upd = req.body;
      // Build update using drizzle ORM
      const updateData: any = {};
      if (upd.stockName !== undefined) updateData.stockName = upd.stockName;
      if (upd.stock_name !== undefined) updateData.stockName = upd.stock_name;
      if (upd.action !== undefined) updateData.action = upd.action;
      if (upd.buyRangeStart !== undefined) updateData.buyRangeStart = upd.buyRangeStart;
      if (upd.buyRangeEnd !== undefined) updateData.buyRangeEnd = upd.buyRangeEnd;
      if (upd.targetPrice !== undefined) updateData.targetPrice = upd.targetPrice;
      if (upd.profitGoal !== undefined) updateData.profitGoal = upd.profitGoal;
      if (upd.stopLoss !== undefined) updateData.stopLoss = upd.stopLoss;
      if (upd.rationale !== undefined) updateData.rationale = upd.rationale;
      if (upd.status !== undefined) updateData.status = upd.status;
      if (upd.entryPrice !== undefined) updateData.entryPrice = upd.entryPrice;
      if (upd.sellPrice !== undefined) updateData.sellPrice = upd.sellPrice;
      if (upd.gainPercent !== undefined) updateData.gainPercent = upd.gainPercent;
      if (upd.exitDate !== undefined) updateData.exitDate = upd.exitDate ? new Date(upd.exitDate) : null;
      if (upd.theme !== undefined) updateData.theme = upd.theme;
      if (upd.rationaleAttachment !== undefined) updateData.rationaleAttachment = upd.rationaleAttachment;
      if (Object.keys(updateData).length === 0) return res.status(400).send("No valid fields");
      const [updated] = await db.update(calls).set(updateData).where(eq(calls.id, cid)).returning();
      // Fire CALL_MODIFIED webhook if target or SL changed (admin edit)
      if (updated && (upd.targetPrice !== undefined || upd.stopLoss !== undefined)) {
        try {
          const strat = await storage.getStrategy(updated.strategyId);
          if (strat) {
            fireWebhookEvent("CALL_MODIFIED", buildCallEventData(updated, strat), strat.advisorId)
              .catch((err: any) => console.error("[routes admin PATCH /calls/:id] CALL_MODIFIED webhook failed:", err));
          }
        } catch (whErr: any) { console.error("[routes admin PATCH] webhook lookup failed:", whErr.message); }
      }
      res.json(updated || { status: "updated" });
    } catch (err: any) { res.status(500).send(err.message); }
  });

  app.post("/api/admin/calls/:id/reactivate", requireAdmin, async (req, res) => {
    try {
      const cid = req.params.id;
      await db.update(calls).set({ status: "Active", exitDate: null, sellPrice: null, gainPercent: null }).where(eq(calls.id, cid));
      res.json({ status: "reactivated", id: cid });
    } catch (err: any) { res.status(500).send(err.message); }
  });

  app.post("/api/admin/calls/:id/close", requireAdmin, async (req, res) => {
    try {
      const cid = req.params.id;
      const { sellPrice, gainPercent, exitDate } = req.body;
      await db.update(calls).set({
        status: "Closed",
        sellPrice: sellPrice || null,
        gainPercent: gainPercent || null,
        exitDate: exitDate ? new Date(exitDate) : new Date(),
      }).where(eq(calls.id, cid));

      // Fire webhook for admin close
      try {
        const closedCall = await storage.getCall(cid);
        if (closedCall) {
          const strategy = await storage.getStrategy(closedCall.strategyId);
          if (strategy && closedCall.isPublished) {
            fireWebhookEvent("CALL_CLOSED", buildCallEventData({ ...closedCall, sellPrice, gainPercent, status: "Closed" }, strategy), strategy.advisorId)
              .catch((err: any) => console.error("[admin /close] CALL_CLOSED webhook failed:", err));
          }
        }
      } catch (whErr: any) { console.error("[admin /close] webhook error:", whErr.message); }

      res.json({ status: "closed", id: cid });
    } catch (err: any) { res.status(500).send(err.message); }
  });

  
  // Admin delete a call permanently
  app.delete("/api/admin/calls/:id", requireAdmin, async (req, res) => {
    try {
      const cid = req.params.id;
      await db.delete(calls).where(eq(calls.id, cid));
      console.log("[ADMIN] Call " + cid + " permanently deleted");
      res.json({ status: "deleted", id: cid });
    } catch (err: any) { res.status(500).send(err.message); }
  });

  app.get("/api/admin/calls/strategies", requireAdmin, async (_req, res) => {
    try {
      const rows = await db.execute(sql`SELECT DISTINCT st.id, st.name, st.type, us.username as advisor_name FROM strategies st JOIN users us ON st.advisor_id = us.id JOIN calls cl ON cl.strategy_id = st.id AND cl.status = 'Closed' ORDER BY us.username, st.name`);
      res.json(rows.rows);
    } catch (err: any) { res.status(500).send(err.message); }
  });


  // Initialize XTS Bridge

  // ═══════════════════════════════════════════════════════════════════════════
  // BROKER CALL MANAGEMENT & PERFORMANCE REPORTS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Active Broker Calls (calls + positions with webhook_rec_id) ──
  app.get("/api/admin/broker-calls/active", requireAdmin, async (req, res) => {
    try {
      const broker = req.query.broker as string || "";
      const type = req.query.type as string || "";  // equity, fno, commodity
      const advisor = req.query.advisor as string || "";

      const showAll = req.query.showAll === 'true';
      const callsWhere = showAll ? "WHERE c.status = 'Active'" : "WHERE c.status = 'Active' AND c.webhook_rec_id IS NOT NULL";
      const conn = await db.execute(sql.raw(`
        SELECT c.id, c.stock_name as symbol, c.action, c.buy_range_start as entry_price,
               c.target_price, c.stop_loss, c.sell_price, c.status, c.webhook_rec_id,
               c.created_at, c.strategy_id, 'equity' as call_type,
               s.name as strategy_name, s.type as strategy_type,
               u.username as advisor_name, u.company_name as advisor_company
        FROM calls c
        JOIN strategies s ON s.id = c.strategy_id
        JOIN users u ON u.id = s.advisor_id
        ${callsWhere}
        ORDER BY c.created_at DESC
      `));

      const posConn = await db.execute(sql.raw(`
        SELECT p.id, p.symbol, COALESCE(p.buy_sell, 'Buy') as action, p.entry_price,
               p.target, p.stop_loss, p.exit_price as sell_price, p.status, p.webhook_rec_id,
               p.created_at, p.strategy_id, 'fno' as call_type,
               p.segment, p.strike_price, p.call_put, p.expiry, p.leg_group_id,
               s.name as strategy_name, s.type as strategy_type,
               u.username as advisor_name, u.company_name as advisor_company
        FROM positions p
        JOIN strategies s ON s.id = p.strategy_id
        JOIN users u ON u.id = s.advisor_id
        ${showAll ? "WHERE p.status = 'Active' AND p.is_published = true" : "WHERE p.status = 'Active' AND p.webhook_rec_id IS NOT NULL"}
        ORDER BY p.created_at DESC
      `))

      let calls = (conn.rows as any[]).map(r => ({ ...r, source: 'calls' }));
      let positions = (posConn.rows as any[]).map(r => ({ ...r, source: 'positions' }));
      let all = [...calls, ...positions].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (type === 'equity') all = all.filter((c: any) => c.call_type === 'equity');
      if (type === 'fno') all = all.filter((c: any) => c.call_type === 'fno');
      if (advisor) all = all.filter((c: any) => (c.advisor_company || c.advisor_name || '').toLowerCase().includes(advisor.toLowerCase()));

      res.json({ total: all.length, calls: all });
    } catch (err: any) { res.status(500).send(err.message); }
  });

  // ── Close a broker call from admin ──
  app.post("/api/admin/broker-calls/:id/close", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { source, exitPrice } = req.body; // source: 'calls' or 'positions'

      if (source === 'positions') {
        const pos = await db.execute(sql`SELECT * FROM positions WHERE id = ${id}`);
        const p = (pos.rows[0] as any);
        if (!p) return res.status(404).send("Position not found");
        await db.execute(sql`UPDATE positions SET status = 'Closed', exit_price = ${exitPrice || p.entry_price}, exit_date = NOW() WHERE id = ${id}`);
        // Fire webhook
        const strategy = await storage.getStrategy(p.strategy_id);
        if (strategy && p.webhook_rec_id) {
          fireWebhookEvent("POSITION_CLOSED", buildPositionEventData({ ...p, status: 'Closed', exitPrice: exitPrice || p.entry_price, exit_date: new Date() }, strategy), strategy.advisorId)
            .catch((err: any) => console.error("[admin broker-calls close position]", err));
        }
        return res.json({ success: true, type: 'position', symbol: p.symbol });
      } else {
        const call = await db.execute(sql`SELECT * FROM calls WHERE id = ${id}`);
        const c = (call.rows[0] as any);
        if (!c) return res.status(404).send("Call not found");
        await db.execute(sql`UPDATE calls SET status = 'Closed', sell_price = ${exitPrice || c.buy_range_start}, exit_date = NOW() WHERE id = ${id}`);
        // Fire webhook
        const strategy = await storage.getStrategy(c.strategy_id);
        if (strategy && c.webhook_rec_id) {
          fireWebhookEvent("CALL_CLOSED", buildCallEventData({ ...c, status: 'Closed', sellPrice: exitPrice || c.buy_range_start, exit_date: new Date() }, strategy), strategy.advisorId)
            .catch((err: any) => console.error("[admin broker-calls close call]", err));
        }
        return res.json({ success: true, type: 'call', symbol: c.stock_name });
      }
    } catch (err: any) { res.status(500).send(err.message); }
  });

  // ── Modify a broker call (target/SL) from admin ──
  app.patch("/api/admin/broker-calls/:id/modify", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { source, targetPrice, stopLoss } = req.body;

      if (source === 'positions') {
        await db.execute(sql`UPDATE positions SET target = ${targetPrice}, stop_loss = ${stopLoss} WHERE id = ${id}`);
        const pos = await db.execute(sql`SELECT * FROM positions WHERE id = ${id}`);
        const p = (pos.rows[0] as any);
        const strategy = await storage.getStrategy(p.strategy_id);
        if (strategy && p.webhook_rec_id) {
          fireWebhookEvent("POSITION_MODIFIED", buildPositionEventData(p, strategy), strategy.advisorId)
            .catch((err: any) => console.error("[admin broker-calls modify position]", err));
        }
        return res.json({ success: true, type: 'position', symbol: p.symbol });
      } else {
        await db.execute(sql`UPDATE calls SET target_price = ${targetPrice}, stop_loss = ${stopLoss} WHERE id = ${id}`);
        const call = await db.execute(sql`SELECT * FROM calls WHERE id = ${id}`);
        const c = (call.rows[0] as any);
        const strategy = await storage.getStrategy(c.strategy_id);
        if (strategy && c.webhook_rec_id) {
          fireWebhookEvent("CALL_MODIFIED", buildCallEventData(c, strategy), strategy.advisorId)
            .catch((err: any) => console.error("[admin broker-calls modify call]", err));
        }
        return res.json({ success: true, type: 'call', symbol: c.stock_name });
      }
    } catch (err: any) { res.status(500).send(err.message); }
  });

  // ── Broker Performance Report ──
  app.get("/api/admin/broker-reports", requireAdmin, async (req, res) => {
    try {
      const from = req.query.from as string || new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const to = req.query.to as string || new Date().toISOString().split('T')[0];
      const broker = req.query.broker as string || '';
      const period = req.query.period as string || 'daily'; // daily, weekly, monthly

      let brokerFilter = '';
      if (broker) {
        brokerFilter = `AND bwl.api_key_id = (SELECT id FROM broker_api_keys WHERE broker_name ILIKE '%${broker}%' LIMIT 1)`;
      }

      // Per-advisor breakdown
      const advisorStats = await db.execute(sql.raw(`
        SELECT 
          COALESCE(payload->'data'->>'advisorName', 'Unknown') as advisor_name,
          COUNT(*) FILTER (WHERE event = 'CALL_CREATED' OR event = 'POSITION_CREATED') as calls_published,
          COUNT(*) FILTER (WHERE event = 'CALL_CLOSED' OR event = 'POSITION_CLOSED') as calls_closed,
          COUNT(*) FILTER (WHERE event = 'TARGET_ACHIEVED') as targets_achieved,
          COUNT(*) FILTER (WHERE event = 'STOPLOSS_TRIGGERED') as stoploss_triggered,
          COUNT(*) FILTER (WHERE event = 'CALL_MODIFIED' OR event = 'POSITION_MODIFIED') as calls_modified,
          COUNT(*) FILTER (WHERE event = 'TRAILING_SL_TRIGGERED') as trailing_sl,
          COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 300) as successful,
          COUNT(*) FILTER (WHERE status_code >= 400) as failed,
          COUNT(DISTINCT CASE WHEN event IN ('CALL_CREATED','POSITION_CREATED') THEN payload->'data'->>'recommendationId' END) as unique_calls
        FROM broker_webhook_logs bwl
        WHERE bwl.created_at >= '${from}T00:00:00Z' 
          AND bwl.created_at <= '${to}T23:59:59Z'
          ${brokerFilter}
        GROUP BY advisor_name
        ORDER BY calls_published DESC
      `));

      // Summary totals
      const summary = await db.execute(sql.raw(`
        SELECT 
          COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE event = 'CALL_CREATED' OR event = 'POSITION_CREATED') as total_published,
          COUNT(*) FILTER (WHERE event = 'CALL_CLOSED' OR event = 'POSITION_CLOSED') as total_closed,
          COUNT(*) FILTER (WHERE event = 'TARGET_ACHIEVED') as total_targets,
          COUNT(*) FILTER (WHERE event = 'STOPLOSS_TRIGGERED') as total_stoploss,
          COUNT(*) FILTER (WHERE event = 'CALL_MODIFIED' OR event = 'POSITION_MODIFIED') as total_modified,
          COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 300) as total_success,
          COUNT(*) FILTER (WHERE status_code >= 400) as total_errors,
          COUNT(DISTINCT payload->'data'->>'advisorName') as active_advisors
        FROM broker_webhook_logs bwl
        WHERE bwl.created_at >= '${from}T00:00:00Z' 
          AND bwl.created_at <= '${to}T23:59:59Z'
          ${brokerFilter}
      `));

      // Daily breakdown
      const dailyBreakdown = await db.execute(sql.raw(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) FILTER (WHERE event = 'CALL_CREATED' OR event = 'POSITION_CREATED') as published,
          COUNT(*) FILTER (WHERE event = 'CALL_CLOSED' OR event = 'POSITION_CLOSED') as closed,
          COUNT(*) FILTER (WHERE event = 'TARGET_ACHIEVED') as targets,
          COUNT(*) FILTER (WHERE event = 'STOPLOSS_TRIGGERED') as stoploss,
          COUNT(*) FILTER (WHERE status_code >= 400) as errors
        FROM broker_webhook_logs bwl
        WHERE bwl.created_at >= '${from}T00:00:00Z' 
          AND bwl.created_at <= '${to}T23:59:59Z'
          ${brokerFilter}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `));

      // Broker-wise breakdown
      const brokerBreakdown = await db.execute(sql.raw(`
        SELECT 
          bak.broker_name,
          COUNT(*) FILTER (WHERE bwl.event = 'CALL_CREATED' OR bwl.event = 'POSITION_CREATED') as published,
          COUNT(*) FILTER (WHERE bwl.event = 'CALL_CLOSED' OR bwl.event = 'POSITION_CLOSED') as closed,
          COUNT(*) FILTER (WHERE bwl.event = 'TARGET_ACHIEVED') as targets,
          COUNT(*) FILTER (WHERE bwl.event = 'STOPLOSS_TRIGGERED') as stoploss,
          COUNT(*) FILTER (WHERE bwl.status_code >= 200 AND bwl.status_code < 300) as success,
          COUNT(*) FILTER (WHERE bwl.status_code >= 400) as errors
        FROM broker_webhook_logs bwl
        JOIN broker_api_keys bak ON bak.id = bwl.api_key_id
        WHERE bwl.created_at >= '${from}T00:00:00Z' 
          AND bwl.created_at <= '${to}T23:59:59Z'
        GROUP BY bak.broker_name
        ORDER BY published DESC
      `));

      res.json({
        period: { from, to },
        summary: summary.rows[0] || {},
        advisors: advisorStats.rows,
        daily: dailyBreakdown.rows,
        brokers: brokerBreakdown.rows,
      });
    } catch (err: any) { res.status(500).send(err.message); }
  });

  // ── Enhanced Advisor Performance Report ──
  app.get("/api/admin/broker-reports/advisor-performance", requireAdmin, async (req, res) => {
    try {
      const from = req.query.from as string || new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const to = req.query.to as string || new Date().toISOString().split('T')[0];

      // Get advisor-wise call performance from calls table
      const equityPerf = await db.execute(sql.raw(`
        SELECT 
          u.company_name as advisor_name,
          u.username,
          COUNT(*) FILTER (WHERE c.status = 'Active') as open_calls,
          COUNT(*) FILTER (WHERE c.status = 'Closed') as closed_calls,
          COUNT(*) FILTER (WHERE c.status = 'Closed' AND c.sell_price > c.buy_range_start AND c.action = 'Buy') as profitable_buy,
          COUNT(*) FILTER (WHERE c.status = 'Closed' AND c.sell_price < c.buy_range_start AND c.action = 'Buy') as loss_buy,
          COUNT(*) FILTER (WHERE c.status = 'Closed' AND c.sell_price < c.buy_range_start AND c.action = 'Sell') as profitable_sell,
          COUNT(*) FILTER (WHERE c.status = 'Closed' AND c.sell_price > c.buy_range_start AND c.action = 'Sell') as loss_sell,
          ROUND(AVG(CASE 
            WHEN c.status = 'Closed' AND c.buy_range_start > 0 AND c.action = 'Buy' 
            THEN ((c.sell_price - c.buy_range_start) / c.buy_range_start) * 100 
            WHEN c.status = 'Closed' AND c.buy_range_start > 0 AND c.action = 'Sell' 
            THEN ((c.buy_range_start - c.sell_price) / c.buy_range_start) * 100 
          END)::numeric, 2) as avg_return_pct,
          ROUND(SUM(CASE 
            WHEN c.status = 'Closed' AND c.action = 'Buy' THEN c.sell_price - c.buy_range_start 
            WHEN c.status = 'Closed' AND c.action = 'Sell' THEN c.buy_range_start - c.sell_price 
            ELSE 0 END)::numeric, 2) as total_absolute_return,
          COUNT(*) as total_calls
        FROM calls c
        JOIN strategies s ON s.id = c.strategy_id
        JOIN users u ON u.id = s.advisor_id
        WHERE c.webhook_rec_id IS NOT NULL
          AND c.created_at >= '${from}T00:00:00Z'
          AND c.created_at <= '${to}T23:59:59Z'
        GROUP BY u.company_name, u.username
      `));

      // Get advisor-wise position performance
      const fnoPerf = await db.execute(sql.raw(`
        SELECT 
          u.company_name as advisor_name,
          u.username,
          COUNT(*) FILTER (WHERE p.status = 'Active') as open_positions,
          COUNT(*) FILTER (WHERE p.status = 'Closed') as closed_positions,
          COUNT(*) FILTER (WHERE p.status = 'Closed' AND p.exit_price > p.entry_price AND COALESCE(p.buy_sell, 'Buy') = 'Buy') as profitable_buy,
          COUNT(*) FILTER (WHERE p.status = 'Closed' AND p.exit_price < p.entry_price AND COALESCE(p.buy_sell, 'Buy') = 'Buy') as loss_buy,
          COUNT(*) FILTER (WHERE p.status = 'Closed' AND p.exit_price < p.entry_price AND COALESCE(p.buy_sell, 'Buy') = 'Sell') as profitable_sell,
          COUNT(*) FILTER (WHERE p.status = 'Closed' AND p.exit_price > p.entry_price AND COALESCE(p.buy_sell, 'Buy') = 'Sell') as loss_sell,
          ROUND(AVG(CASE 
            WHEN p.status = 'Closed' AND p.entry_price > 0 AND COALESCE(p.buy_sell, 'Buy') = 'Buy'
            THEN ((p.exit_price - p.entry_price) / p.entry_price) * 100
            WHEN p.status = 'Closed' AND p.entry_price > 0 AND COALESCE(p.buy_sell, 'Buy') = 'Sell'
            THEN ((p.entry_price - p.exit_price) / p.entry_price) * 100
          END)::numeric, 2) as avg_return_pct,
          COUNT(*) as total_positions
        FROM positions p
        JOIN strategies s ON s.id = p.strategy_id
        JOIN users u ON u.id = s.advisor_id
        WHERE p.webhook_rec_id IS NOT NULL
          AND p.created_at >= '${from}T00:00:00Z'
          AND p.created_at <= '${to}T23:59:59Z'
        GROUP BY u.company_name, u.username
      `));

      // YTD performance
      const ytdStart = new Date().getFullYear() + '-01-01';
      const ytdPerf = await db.execute(sql.raw(`
        SELECT 
          u.company_name as advisor_name,
          ROUND(AVG(CASE 
            WHEN c.status = 'Closed' AND c.buy_range_start > 0 AND c.action = 'Buy' 
            THEN ((c.sell_price - c.buy_range_start) / c.buy_range_start) * 100 
            WHEN c.status = 'Closed' AND c.buy_range_start > 0 AND c.action = 'Sell' 
            THEN ((c.buy_range_start - c.sell_price) / c.buy_range_start) * 100 
          END)::numeric, 2) as ytd_avg_return,
          ROUND(SUM(CASE 
            WHEN c.status = 'Closed' AND c.action = 'Buy' THEN c.sell_price - c.buy_range_start 
            WHEN c.status = 'Closed' AND c.action = 'Sell' THEN c.buy_range_start - c.sell_price 
            ELSE 0 END)::numeric, 2) as ytd_total_return,
          COUNT(*) FILTER (WHERE c.status = 'Closed') as ytd_closed,
          COUNT(*) FILTER (WHERE c.status = 'Active') as ytd_open
        FROM calls c
        JOIN strategies s ON s.id = c.strategy_id
        JOIN users u ON u.id = s.advisor_id
        WHERE c.webhook_rec_id IS NOT NULL AND c.created_at >= '${ytdStart}T00:00:00Z'
        GROUP BY u.company_name
      `));

      // Merge equity + F&O per advisor
      const advisorMap: Record<string, any> = {};
      (equityPerf.rows as any[]).forEach((r: any) => {
        const name = r.advisor_name || r.username;
        advisorMap[name] = {
          advisor: name,
          equity_open: parseInt(r.open_calls) || 0,
          equity_closed: parseInt(r.closed_calls) || 0,
          equity_profitable: (parseInt(r.profitable_buy) || 0) + (parseInt(r.profitable_sell) || 0),
          equity_loss: (parseInt(r.loss_buy) || 0) + (parseInt(r.loss_sell) || 0),
          equity_avg_return: parseFloat(r.avg_return_pct) || 0,
          equity_total_return: parseFloat(r.total_absolute_return) || 0,
          fno_open: 0, fno_closed: 0, fno_profitable: 0, fno_loss: 0, fno_avg_return: 0,
        };
      });
      (fnoPerf.rows as any[]).forEach((r: any) => {
        const name = r.advisor_name || r.username;
        if (!advisorMap[name]) advisorMap[name] = { advisor: name, equity_open: 0, equity_closed: 0, equity_profitable: 0, equity_loss: 0, equity_avg_return: 0, equity_total_return: 0 };
        advisorMap[name].fno_open = parseInt(r.open_positions) || 0;
        advisorMap[name].fno_closed = parseInt(r.closed_positions) || 0;
        advisorMap[name].fno_profitable = (parseInt(r.profitable_buy) || 0) + (parseInt(r.profitable_sell) || 0);
        advisorMap[name].fno_loss = (parseInt(r.loss_buy) || 0) + (parseInt(r.loss_sell) || 0);
        advisorMap[name].fno_avg_return = parseFloat(r.avg_return_pct) || 0;
      });

      // Calculate combined metrics
      const advisors = Object.values(advisorMap).map((a: any) => {
        const totalOpen = a.equity_open + a.fno_open;
        const totalClosed = a.equity_closed + a.fno_closed;
        const totalProfitable = a.equity_profitable + a.fno_profitable;
        const totalLoss = a.equity_loss + a.fno_loss;
        const winRate = (totalProfitable + totalLoss) > 0 ? Math.round((totalProfitable / (totalProfitable + totalLoss)) * 100) : 0;
        const totalCalls = totalOpen + totalClosed;
        
        // Weakness analysis
        const weaknesses: string[] = [];
        if (totalCalls < 3) weaknesses.push("Low activity — fewer than 3 calls");
        if (winRate < 30 && totalClosed >= 2) weaknesses.push("Low win rate — below 30%");
        if (a.equity_avg_return < -2) weaknesses.push("Negative avg equity return");
        if (totalOpen > 0 && totalClosed === 0) weaknesses.push("No closed calls — all still open");
        if (totalLoss > totalProfitable && totalClosed >= 3) weaknesses.push("More losses than wins");

        return {
          ...a,
          total_open: totalOpen,
          total_closed: totalClosed,
          total_profitable: totalProfitable,
          total_loss: totalLoss,
          win_rate: winRate,
          total_calls: totalCalls,
          is_weak: weaknesses.length > 0,
          weaknesses,
        };
      }).sort((a: any, b: any) => b.total_calls - a.total_calls);

      // YTD map
      const ytdMap: Record<string, any> = {};
      (ytdPerf.rows as any[]).forEach((r: any) => {
        ytdMap[r.advisor_name] = { ytd_avg_return: parseFloat(r.ytd_avg_return) || 0, ytd_total_return: parseFloat(r.ytd_total_return) || 0, ytd_closed: parseInt(r.ytd_closed) || 0, ytd_open: parseInt(r.ytd_open) || 0 };
      });

      res.json({ period: { from, to }, advisors, ytd: ytdMap });
    } catch (err: any) { res.status(500).send(err.message); }
  });



  // ── Enhanced New Calls Report (from DB, not webhook logs) ──
  app.get("/api/admin/broker-reports/new-calls", requireAdmin, async (req, res) => {
    try {
      const from = req.query.from as string || new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const to = req.query.to as string || new Date().toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];

      const advisorNewCalls = await db.execute(sql.raw(`
        WITH equity AS (
          SELECT u.company_name as advisor_name,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE c.created_at::date = '${today}'::date) as today_count,
            COUNT(*) FILTER (WHERE c.created_at >= (CURRENT_DATE - INTERVAL '7 days')) as week_count,
            COUNT(*) FILTER (WHERE c.status = 'Active') as open_count,
            COUNT(*) FILTER (WHERE c.status = 'Closed') as closed_count,
            COUNT(*) FILTER (WHERE c.status = 'Closed' AND c.sell_price > c.buy_range_start AND c.action = 'Buy') +
            COUNT(*) FILTER (WHERE c.status = 'Closed' AND c.sell_price < c.buy_range_start AND c.action = 'Sell') as profitable,
            COUNT(*) FILTER (WHERE c.status = 'Closed' AND c.sell_price < c.buy_range_start AND c.action = 'Buy') +
            COUNT(*) FILTER (WHERE c.status = 'Closed' AND c.sell_price > c.buy_range_start AND c.action = 'Sell') as loss,
            ROUND(AVG(CASE
              WHEN c.status = 'Closed' AND c.buy_range_start > 0 AND c.action = 'Buy' THEN ((c.sell_price - c.buy_range_start) / c.buy_range_start) * 100
              WHEN c.status = 'Closed' AND c.buy_range_start > 0 AND c.action = 'Sell' THEN ((c.buy_range_start - c.sell_price) / c.buy_range_start) * 100
            END)::numeric, 2) as avg_return_pct,
            COUNT(*) FILTER (WHERE c.webhook_rec_id IS NOT NULL) as sent_to_broker
          FROM calls c
          JOIN strategies s ON s.id = c.strategy_id
          JOIN users u ON u.id = s.advisor_id
          WHERE c.is_published = true
            AND c.created_at >= '${from}T00:00:00Z' AND c.created_at <= '${to}T23:59:59Z'
          GROUP BY u.company_name
        ),
        fno AS (
          SELECT u.company_name as advisor_name,
            COUNT(DISTINCT COALESCE(p.leg_group_id, p.id::text)) as total,
            COUNT(DISTINCT COALESCE(p.leg_group_id, p.id::text)) FILTER (WHERE p.created_at::date = '${today}'::date) as today_count,
            COUNT(DISTINCT COALESCE(p.leg_group_id, p.id::text)) FILTER (WHERE p.created_at >= (CURRENT_DATE - INTERVAL '7 days')) as week_count,
            COUNT(DISTINCT COALESCE(p.leg_group_id, p.id::text)) FILTER (WHERE p.status = 'Active') as open_count,
            COUNT(DISTINCT COALESCE(p.leg_group_id, p.id::text)) FILTER (WHERE p.status = 'Closed') as closed_count,
            COUNT(DISTINCT COALESCE(p.leg_group_id, p.id::text)) FILTER (WHERE p.status = 'Closed' AND p.gain_percent::numeric > 0) as profitable,
            COUNT(DISTINCT COALESCE(p.leg_group_id, p.id::text)) FILTER (WHERE p.status = 'Closed' AND p.gain_percent::numeric <= 0) as loss,
            ROUND(AVG(CASE WHEN p.status = 'Closed' THEN p.gain_percent::numeric END)::numeric, 2) as avg_return_pct,
            COUNT(DISTINCT COALESCE(p.leg_group_id, p.id::text)) FILTER (WHERE p.webhook_rec_id IS NOT NULL) as sent_to_broker
          FROM positions p
          JOIN strategies s ON s.id = p.strategy_id
          JOIN users u ON u.id = s.advisor_id
          WHERE p.is_published = true
            AND p.created_at >= '${from}T00:00:00Z' AND p.created_at <= '${to}T23:59:59Z'
          GROUP BY u.company_name
        )
        SELECT
          COALESCE(e.advisor_name, f.advisor_name) as advisor_name,
          COALESCE(e.total, 0) + COALESCE(f.total, 0) as total_new,
          COALESCE(e.total, 0) as equity_new,
          COALESCE(f.total, 0) as fno_new,
          COALESCE(e.today_count, 0) + COALESCE(f.today_count, 0) as today_new,
          COALESCE(e.week_count, 0) + COALESCE(f.week_count, 0) as week_new,
          COALESCE(e.open_count, 0) + COALESCE(f.open_count, 0) as open_count,
          COALESCE(e.closed_count, 0) + COALESCE(f.closed_count, 0) as closed_count,
          COALESCE(e.profitable, 0) + COALESCE(f.profitable, 0) as profitable,
          COALESCE(e.loss, 0) + COALESCE(f.loss, 0) as loss,
          ROUND(((COALESCE(e.avg_return_pct, 0) * COALESCE(e.closed_count, 0) + COALESCE(f.avg_return_pct, 0) * COALESCE(f.closed_count, 0))
            / NULLIF(COALESCE(e.closed_count, 0) + COALESCE(f.closed_count, 0), 0))::numeric, 2) as avg_return_pct,
          COALESCE(e.sent_to_broker, 0) + COALESCE(f.sent_to_broker, 0) as sent_to_broker
        FROM equity e
        FULL OUTER JOIN fno f ON e.advisor_name = f.advisor_name
        ORDER BY total_new DESC
      `));

      const summary = await db.execute(sql.raw(`
        WITH eq AS (
          SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE created_at::date = '${today}'::date) as today_count,
            COUNT(*) FILTER (WHERE created_at >= (CURRENT_DATE - INTERVAL '7 days')) as week_count,
            COUNT(*) FILTER (WHERE status = 'Active') as open_count,
            COUNT(*) FILTER (WHERE status = 'Closed') as closed_count,
            COUNT(*) FILTER (WHERE status = 'Closed' AND sell_price > buy_range_start AND action = 'Buy') +
            COUNT(*) FILTER (WHERE status = 'Closed' AND sell_price < buy_range_start AND action = 'Sell') as profit,
            COUNT(*) FILTER (WHERE status = 'Closed' AND sell_price < buy_range_start AND action = 'Buy') +
            COUNT(*) FILTER (WHERE status = 'Closed' AND sell_price > buy_range_start AND action = 'Sell') as loss
          FROM calls WHERE is_published = true
            AND created_at >= '${from}T00:00:00Z' AND created_at <= '${to}T23:59:59Z'
        ),
        fno AS (
          SELECT COUNT(DISTINCT COALESCE(leg_group_id, id::text)) as total,
            COUNT(DISTINCT COALESCE(leg_group_id, id::text)) FILTER (WHERE created_at::date = '${today}'::date) as today_count,
            COUNT(DISTINCT COALESCE(leg_group_id, id::text)) FILTER (WHERE created_at >= (CURRENT_DATE - INTERVAL '7 days')) as week_count,
            COUNT(DISTINCT COALESCE(leg_group_id, id::text)) FILTER (WHERE status = 'Active') as open_count,
            COUNT(DISTINCT COALESCE(leg_group_id, id::text)) FILTER (WHERE status = 'Closed') as closed_count,
            COUNT(DISTINCT COALESCE(leg_group_id, id::text)) FILTER (WHERE status = 'Closed' AND gain_percent::numeric > 0) as profit,
            COUNT(DISTINCT COALESCE(leg_group_id, id::text)) FILTER (WHERE status = 'Closed' AND gain_percent::numeric <= 0) as loss
          FROM positions WHERE is_published = true
            AND created_at >= '${from}T00:00:00Z' AND created_at <= '${to}T23:59:59Z'
        )
        SELECT
          (SELECT total FROM eq) + (SELECT total FROM fno) as total_new,
          (SELECT total FROM eq) as equity_new,
          (SELECT total FROM fno) as fno_new,
          (SELECT today_count FROM eq) + (SELECT today_count FROM fno) as today_new,
          (SELECT week_count FROM eq) + (SELECT week_count FROM fno) as week_new,
          (SELECT open_count FROM eq) + (SELECT open_count FROM fno) as total_open,
          (SELECT closed_count FROM eq) + (SELECT closed_count FROM fno) as total_closed,
          (SELECT profit FROM eq) + (SELECT profit FROM fno) as total_profitable,
          (SELECT loss FROM eq) + (SELECT loss FROM fno) as total_loss
      `));

      const daily = await db.execute(sql.raw(`
        WITH eq_daily AS (
          SELECT created_at::date as dt, COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'Closed') as closed,
            COUNT(*) FILTER (WHERE status = 'Closed' AND sell_price > buy_range_start AND action = 'Buy') as profit,
            COUNT(*) FILTER (WHERE status = 'Closed' AND sell_price < buy_range_start AND action = 'Buy') as loss
          FROM calls WHERE is_published = true
            AND created_at >= '${from}T00:00:00Z' AND created_at <= '${to}T23:59:59Z'
          GROUP BY created_at::date
        ),
        fno_daily AS (
          SELECT created_at::date as dt,
            COUNT(DISTINCT COALESCE(leg_group_id, id::text)) as total,
            COUNT(DISTINCT COALESCE(leg_group_id, id::text)) FILTER (WHERE status = 'Closed') as closed,
            COUNT(DISTINCT COALESCE(leg_group_id, id::text)) FILTER (WHERE status = 'Closed' AND gain_percent::numeric > 0) as profit,
            COUNT(DISTINCT COALESCE(leg_group_id, id::text)) FILTER (WHERE status = 'Closed' AND gain_percent::numeric <= 0) as loss
          FROM positions WHERE is_published = true
            AND created_at >= '${from}T00:00:00Z' AND created_at <= '${to}T23:59:59Z'
          GROUP BY created_at::date
        )
        SELECT COALESCE(e.dt, f.dt) as date,
          COALESCE(e.total, 0) + COALESCE(f.total, 0) as new_calls,
          COALESCE(e.total, 0) as equity,
          COALESCE(f.total, 0) as fno,
          COALESCE(e.closed, 0) + COALESCE(f.closed, 0) as closed,
          COALESCE(e.profit, 0) + COALESCE(f.profit, 0) as profitable,
          COALESCE(e.loss, 0) + COALESCE(f.loss, 0) as loss
        FROM eq_daily e
        FULL OUTER JOIN fno_daily f ON e.dt = f.dt
        ORDER BY date DESC
      `));

      // Daily per-advisor breakdown
      const dailyAdvisor = await db.execute(sql.raw(
        "WITH eq AS (" +
        "  SELECT c.created_at::date as dt, u.company_name as advisor," +
        "    COUNT(*) as equity_calls," +
        "    COUNT(*) FILTER (WHERE c.status = 'Active') as eq_open," +
        "    COUNT(*) FILTER (WHERE c.status = 'Closed') as eq_closed," +
        "    COUNT(*) FILTER (WHERE c.status = 'Closed' AND c.sell_price > c.buy_range_start AND c.action = 'Buy') as eq_profit," +
        "    COUNT(*) FILTER (WHERE c.webhook_rec_id IS NOT NULL) as eq_mapped" +
        "  FROM calls c JOIN strategies s ON s.id = c.strategy_id JOIN users u ON u.id = s.advisor_id" +
        "  WHERE c.is_published = true" +
        "    AND c.created_at >= '" + from + "T00:00:00Z' AND c.created_at <= '" + to + "T23:59:59Z'" +
        "  GROUP BY c.created_at::date, u.company_name" +
        "), fno AS (" +
        "  SELECT p.created_at::date as dt, u.company_name as advisor," +
        "    COUNT(*) as fno_positions," +
        "    COUNT(*) FILTER (WHERE p.status = 'Active') as fno_open," +
        "    COUNT(*) FILTER (WHERE p.status = 'Closed') as fno_closed," +
        "    COUNT(*) FILTER (WHERE p.status = 'Closed' AND p.gain_percent::numeric > 0) as fno_profit," +
        "    COUNT(*) FILTER (WHERE p.webhook_rec_id IS NOT NULL) as fno_mapped" +
        "  FROM positions p JOIN strategies s ON s.id = p.strategy_id JOIN users u ON u.id = s.advisor_id" +
        "  WHERE p.is_published = true" +
        "    AND p.created_at >= '" + from + "T00:00:00Z' AND p.created_at <= '" + to + "T23:59:59Z'" +
        "  GROUP BY p.created_at::date, u.company_name" +
        ") SELECT COALESCE(e.dt, f.dt) as date, COALESCE(e.advisor, f.advisor) as advisor," +
        "  COALESCE(e.equity_calls, 0) as equity, COALESCE(f.fno_positions, 0) as fno," +
        "  COALESCE(e.equity_calls, 0) + COALESCE(f.fno_positions, 0) as total," +
        "  COALESCE(e.eq_open, 0) + COALESCE(f.fno_open, 0) as open," +
        "  COALESCE(e.eq_closed, 0) + COALESCE(f.fno_closed, 0) as closed," +
        "  COALESCE(e.eq_profit, 0) + COALESCE(f.fno_profit, 0) as profitable," +
        "  COALESCE(e.eq_mapped, 0) + COALESCE(f.fno_mapped, 0) as mapped_to_broker" +
        " FROM eq e FULL OUTER JOIN fno f ON e.dt = f.dt AND e.advisor = f.advisor" +
        " ORDER BY date DESC, total DESC"
      ));

      const brokerCalls = await db.execute(sql.raw(
        "SELECT bak.broker_name," +
        "  payload->'data'->>'advisorName' as advisor," +
        "  COUNT(*) FILTER (WHERE event IN ('CALL_CREATED','POSITION_CREATED')) as creates," +
        "  COUNT(*) FILTER (WHERE event IN ('CALL_CLOSED','POSITION_CLOSED','STOPLOSS_TRIGGERED','TARGET_ACHIEVED')) as closes," +
        "  COUNT(*) FILTER (WHERE event = 'STOPLOSS_TRIGGERED') as sl_triggered," +
        "  COUNT(*) FILTER (WHERE event = 'TARGET_ACHIEVED') as target_hit," +
        "  COUNT(*) FILTER (WHERE status_code = 200) as ok," +
        "  COUNT(*) FILTER (WHERE status_code != 200) as errors" +
        " FROM broker_webhook_logs bwl" +
        " JOIN broker_api_keys bak ON bak.id = bwl.api_key_id" +
        " WHERE bwl.created_at >= '" + from + "T00:00:00Z' AND bwl.created_at <= '" + to + "T23:59:59Z'" +
        " GROUP BY bak.broker_name, payload->'data'->>'advisorName'" +
        " ORDER BY bak.broker_name, creates DESC"
      ));

      res.json({
        period: { from, to },
        summary: summary.rows[0] || {},
        advisors: advisorNewCalls.rows,
        daily: daily.rows,
        dailyAdvisor: dailyAdvisor.rows,
        brokerAdvisor: brokerCalls.rows,
      });
    } catch (err: any) { res.status(500).send(err.message); }
  });

  // ── Live Prices for Admin Dashboard (Kite+TrueData combined) ──
  app.get("/api/admin/broker-calls/live-prices", requireAdmin, async (req, res) => {
    try {
      const symbols = req.query.symbols as string || "";
      if (!symbols) return res.json({ quotes: {} });
      // Fetch from Kite+TrueData combined endpoint
      const kiteRes = await fetch(`http://localhost:8001/api/shared/kite-quotes?symbols=${encodeURIComponent(symbols)}`, {
        headers: { "x-shared-secret": "alphamarket-shared-2026" },
        signal: AbortSignal.timeout(5000)
      });
      let quotes: Record<string, any> = {};
      let sources: Record<string, number> = {};
      if (kiteRes.ok) {
        const data = await kiteRes.json();
        quotes = data.quotes || {};
        sources = data.sources || {};
      }
      // For any missing symbols, try TrueData directly
      const rawSyms = symbols.split(",").map((s: string) => s.trim()).filter(Boolean);
      const missing = rawSyms.filter((s: string) => !quotes[s]);
      if (missing.length > 0) {
        // Also try SYMBOL-I format for commodity/futures
        const tdSyms = [...missing];
        for (const s of missing) {
          if (!s.endsWith("-I")) tdSyms.push(s + "-I");
        }
        try {
          const tdRes = await fetch(`http://localhost:8001/api/shared/truedata-quotes?symbols=${encodeURIComponent(tdSyms.join(","))}`, {
            headers: { "x-shared-secret": "alphamarket-shared-2026" },
            signal: AbortSignal.timeout(3000)
          });
          if (tdRes.ok) {
            const tdData = await tdRes.json();
            for (const [sym, val] of Object.entries(tdData.quotes || {})) {
              const baseSym = sym.endsWith("-I") ? sym.slice(0, -2) : sym;
              const origSym = missing.includes(sym) ? sym : (missing.includes(baseSym) ? baseSym : sym);
              quotes[origSym] = { price: (val as any).ltp, source: "truedata", high: (val as any).high, low: (val as any).low };
              sources["truedata"] = (sources["truedata"] || 0) + 1;
            }
          }
        } catch {}
      }
      return res.json({ quotes, sources, timestamp: Date.now() });
    } catch (err: any) { res.json({ quotes: {}, error: err.message }); }
  });

  // ── Option Premium Prices for Admin Dashboard ──
  app.get("/api/admin/broker-calls/option-prices", requireAdmin, async (req, res) => {
    try {
      const positions = JSON.parse(req.query.positions as string || "[]");
      if (!positions.length) return res.json({ quotes: {} });
      
      const results: Record<string, any> = {};
      const kiteSymbols: string[] = [];
      const posMap: Record<string, string> = {};
      
      for (const pos of positions) {
        const { id, symbol, strike, callPut, expiry } = pos;
        if (!symbol || !strike || !callPut || !expiry) continue;
        
        const series = callPut === "Call" ? "CE" : "PE";
        const strikeNum = parseFloat(strike);
        if (isNaN(strikeNum)) continue;
        
        const expiryDate = new Date(expiry);
        if (isNaN(expiryDate.getTime())) continue;
        const expiryStr = expiryDate.toISOString().split("T")[0];
        
        const lookup = await db.execute(
          sql`SELECT tradingsymbol, exchange_token FROM instrument_master
              WHERE name = ${symbol} AND strike = ${strikeNum}
              AND instrument_type = ${series}
              AND exchange IN ('NFO','BFO')
              AND expiry::date = ${expiryStr}::date
              LIMIT 1`
        );
        
        if (lookup.rows.length > 0) {
          const row = lookup.rows[0] as any;
          const kiteSym = "NFO:" + row.tradingsymbol;
          kiteSymbols.push(kiteSym);
          posMap[kiteSym] = id;
        }
      }
      
      if (kiteSymbols.length === 0) return res.json({ quotes: {} });
      
      const kiteRes = await fetch("http://localhost:8001/api/shared/kite-quotes-raw?symbols=" + encodeURIComponent(kiteSymbols.join(",")), {
        headers: { "x-shared-secret": "alphamarket-shared-2026" },
        signal: AbortSignal.timeout(5000)
      });
      
      if (kiteRes.ok) {
        const data = await kiteRes.json();
        for (const [kiteSym, val] of Object.entries(data.quotes || {})) {
          const posId = posMap[kiteSym];
          if (posId) {
            results[posId] = { price: (val as any).price || (val as any).ltp || 0, source: "kite", tradingsymbol: kiteSym.replace("NFO:", "") };
          }
        }
      }
      
      res.json({ quotes: results, count: Object.keys(results).length });
    } catch (err: any) { res.json({ quotes: {}, error: err.message }); }
  });

  // ── Download Broker Report (XLSX / PDF) ──
  app.get("/api/admin/broker-reports/download", requireAdmin, async (req, res) => {
    try {
      const from = req.query.from as string || new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const to = req.query.to as string || new Date().toISOString().split('T')[0];
      const format = req.query.format as string || 'xlsx';
      const broker = req.query.broker as string || '';

      let brokerFilter = '';
      if (broker) {
        brokerFilter = `AND bwl.api_key_id = (SELECT id FROM broker_api_keys WHERE broker_name ILIKE '%${broker}%' LIMIT 1)`;
      }

      const data = await db.execute(sql.raw(`
        SELECT 
          DATE(bwl.created_at) as date,
          bwl.event,
          COALESCE(payload->'data'->'equityCall'->>'symbol', payload->'data'->'fnoCall'->0->>'symbol') as symbol,
          COALESCE(payload->'data'->'equityCall'->>'callType', payload->'data'->'fnoCall'->0->>'callType') as call_type,
          payload->'data'->>'advisorName' as advisor,
          payload->'data'->>'strategyName' as strategy,
          payload->'data'->>'recommendationId' as rec_id,
          COALESCE(payload->'data'->'equityCall'->>'buyPrice', payload->'data'->'fnoCall'->0->>'buyPrice') as entry_price,
          COALESCE(payload->'data'->'equityCall'->>'targetPriceRange', payload->'data'->'fnoCall'->0->>'targetPriceRange') as target,
          COALESCE(payload->'data'->'equityCall'->>'stopLoss', payload->'data'->'fnoCall'->0->>'stopLoss') as stoploss,
          bwl.status_code,
          bak.broker_name,
          bwl.created_at
        FROM broker_webhook_logs bwl
        JOIN broker_api_keys bak ON bak.id = bwl.api_key_id
        WHERE bwl.created_at >= '${from}T00:00:00Z' 
          AND bwl.created_at <= '${to}T23:59:59Z'
          ${brokerFilter}
        ORDER BY bwl.created_at DESC
      `));

      if (format === 'xlsx') {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'AlphaMarket';

        // Sheet 1: Detailed Logs
        const ws = workbook.addWorksheet('Webhook Logs');
        ws.columns = [
          { header: 'Date', key: 'date', width: 12 },
          { header: 'Event', key: 'event', width: 20 },
          { header: 'Symbol', key: 'symbol', width: 15 },
          { header: 'Action', key: 'call_type', width: 8 },
          { header: 'Advisor', key: 'advisor', width: 25 },
          { header: 'Strategy', key: 'strategy', width: 25 },
          { header: 'Rec ID', key: 'rec_id', width: 10 },
          { header: 'Entry', key: 'entry_price', width: 10 },
          { header: 'Target', key: 'target', width: 10 },
          { header: 'Stop Loss', key: 'stoploss', width: 10 },
          { header: 'Broker', key: 'broker_name', width: 15 },
          { header: 'HTTP Status', key: 'status_code', width: 10 },
        ];
        ws.getRow(1).font = { bold: true };
        (data.rows as any[]).forEach(r => ws.addRow(r));

        // Sheet 2: Advisor Summary
        const ws2 = workbook.addWorksheet('Advisor Summary');
        ws2.columns = [
          { header: 'Advisor', key: 'advisor', width: 25 },
          { header: 'Published', key: 'published', width: 12 },
          { header: 'Closed', key: 'closed', width: 12 },
          { header: 'Target Hit', key: 'targets', width: 12 },
          { header: 'SL Hit', key: 'stoploss', width: 12 },
          { header: 'Modified', key: 'modified', width: 12 },
        ];
        ws2.getRow(1).font = { bold: true };

        const advisorMap: Record<string, any> = {};
        (data.rows as any[]).forEach((r: any) => {
          const adv = r.advisor || 'Unknown';
          if (!advisorMap[adv]) advisorMap[adv] = { advisor: adv, published: 0, closed: 0, targets: 0, stoploss: 0, modified: 0 };
          if (r.event === 'CALL_CREATED' || r.event === 'POSITION_CREATED') advisorMap[adv].published++;
          if (r.event === 'CALL_CLOSED' || r.event === 'POSITION_CLOSED') advisorMap[adv].closed++;
          if (r.event === 'TARGET_ACHIEVED') advisorMap[adv].targets++;
          if (r.event === 'STOPLOSS_TRIGGERED') advisorMap[adv].stoploss++;
          if (r.event === 'CALL_MODIFIED' || r.event === 'POSITION_MODIFIED') advisorMap[adv].modified++;
        });
        Object.values(advisorMap).forEach((a: any) => ws2.addRow(a));

        // Sheet 3: Advisor Summary (equity + FnO combined)
        const ws3 = workbook.addWorksheet('Advisor Summary');
        const advSummData = await db.execute(sql.raw(
          "WITH eq AS (" +
          "  SELECT u.company_name as advisor, COUNT(*) as equity_calls," +
          "    COUNT(*) FILTER (WHERE c.status = 'Active') as eq_open," +
          "    COUNT(*) FILTER (WHERE c.status = 'Closed') as eq_closed," +
          "    COUNT(*) FILTER (WHERE c.status = 'Closed' AND c.sell_price > c.buy_range_start AND c.action = 'Buy') as eq_profit," +
          "    COUNT(*) FILTER (WHERE c.webhook_rec_id IS NOT NULL) as eq_mapped" +
          "  FROM calls c JOIN strategies s ON s.id = c.strategy_id JOIN users u ON u.id = s.advisor_id" +
          "  WHERE c.is_published = true AND c.created_at >= '" + from + "T00:00:00Z' AND c.created_at <= '" + to + "T23:59:59Z'" +
          "  GROUP BY u.company_name" +
          "), fno AS (" +
          "  SELECT u.company_name as advisor, COUNT(*) as fno_positions," +
          "    COUNT(*) FILTER (WHERE p.status = 'Active') as fno_open," +
          "    COUNT(*) FILTER (WHERE p.status = 'Closed') as fno_closed," +
          "    COUNT(*) FILTER (WHERE p.status = 'Closed' AND p.gain_percent::numeric > 0) as fno_profit," +
          "    COUNT(*) FILTER (WHERE p.webhook_rec_id IS NOT NULL) as fno_mapped" +
          "  FROM positions p JOIN strategies s ON s.id = p.strategy_id JOIN users u ON u.id = s.advisor_id" +
          "  WHERE p.is_published = true AND p.created_at >= '" + from + "T00:00:00Z' AND p.created_at <= '" + to + "T23:59:59Z'" +
          "  GROUP BY u.company_name" +
          ") SELECT COALESCE(e.advisor, f.advisor) as advisor," +
          "  COALESCE(e.equity_calls, 0) as equity_calls, COALESCE(f.fno_positions, 0) as fno_positions," +
          "  COALESCE(e.equity_calls, 0) + COALESCE(f.fno_positions, 0) as total," +
          "  COALESCE(e.eq_open, 0) + COALESCE(f.fno_open, 0) as open_count," +
          "  COALESCE(e.eq_closed, 0) + COALESCE(f.fno_closed, 0) as closed," +
          "  COALESCE(e.eq_profit, 0) + COALESCE(f.fno_profit, 0) as profitable," +
          "  COALESCE(e.eq_mapped, 0) + COALESCE(f.fno_mapped, 0) as mapped" +
          " FROM eq e FULL OUTER JOIN fno f ON e.advisor = f.advisor ORDER BY total DESC"
        ));
        ws3.columns = [
          { header: 'Advisor', key: 'advisor', width: 30 },
          { header: 'Equity Calls', key: 'equity_calls', width: 12 },
          { header: 'F&O Positions', key: 'fno_positions', width: 14 },
          { header: 'Total', key: 'total', width: 10 },
          { header: 'Open', key: 'open_count', width: 10 },
          { header: 'Closed', key: 'closed', width: 10 },
          { header: 'Profitable', key: 'profitable', width: 12 },
          { header: 'Mapped', key: 'mapped', width: 12 },
        ];
        for (const row of advSummData.rows) { ws3.addRow(row); }
        ws3.getRow(1).font = { bold: true };

        // Sheet 4: Daily Per Advisor
        const ws4 = workbook.addWorksheet('Daily Per Advisor');
        const dailyAdvData = await db.execute(sql.raw(
          "WITH eq AS (" +
          "  SELECT c.created_at::date as dt, u.company_name as advisor, COUNT(*) as equity" +
          "  FROM calls c JOIN strategies s ON s.id = c.strategy_id JOIN users u ON u.id = s.advisor_id" +
          "  WHERE c.is_published = true AND c.created_at >= '" + from + "T00:00:00Z' AND c.created_at <= '" + to + "T23:59:59Z'" +
          "  GROUP BY c.created_at::date, u.company_name" +
          "), fno AS (" +
          "  SELECT p.created_at::date as dt, u.company_name as advisor, COUNT(*) as fno" +
          "  FROM positions p JOIN strategies s ON s.id = p.strategy_id JOIN users u ON u.id = s.advisor_id" +
          "  WHERE p.is_published = true AND p.created_at >= '" + from + "T00:00:00Z' AND p.created_at <= '" + to + "T23:59:59Z'" +
          "  GROUP BY p.created_at::date, u.company_name" +
          ") SELECT COALESCE(e.dt, f.dt) as date, COALESCE(e.advisor, f.advisor) as advisor," +
          "  COALESCE(e.equity, 0) as equity, COALESCE(f.fno, 0) as fno," +
          "  COALESCE(e.equity, 0) + COALESCE(f.fno, 0) as total" +
          " FROM eq e FULL OUTER JOIN fno f ON e.dt = f.dt AND e.advisor = f.advisor" +
          " ORDER BY date DESC, total DESC"
        ));
        ws4.columns = [
          { header: 'Date', key: 'date', width: 12 },
          { header: 'Advisor', key: 'advisor', width: 30 },
          { header: 'Equity', key: 'equity', width: 12 },
          { header: 'F&O', key: 'fno', width: 12 },
          { header: 'Total', key: 'total', width: 10 },
        ];
        for (const row of dailyAdvData.rows) { ws4.addRow(row); }
        ws4.getRow(1).font = { bold: true };

        // Sheet 5: Broker Breakdown
        const ws5 = workbook.addWorksheet('Broker Breakdown');
        const brokerAdvData = await db.execute(sql.raw(
          "SELECT bak.broker_name, payload->'data'->>'advisorName' as advisor," +
          "  COUNT(*) FILTER (WHERE event IN ('CALL_CREATED','POSITION_CREATED')) as creates," +
          "  COUNT(*) FILTER (WHERE event IN ('CALL_CLOSED','POSITION_CLOSED','STOPLOSS_TRIGGERED','TARGET_ACHIEVED')) as closes," +
          "  COUNT(*) FILTER (WHERE event = 'STOPLOSS_TRIGGERED') as sl_triggered," +
          "  COUNT(*) FILTER (WHERE event = 'TARGET_ACHIEVED') as target_hit," +
          "  COUNT(*) FILTER (WHERE status_code = 200) as ok," +
          "  COUNT(*) FILTER (WHERE status_code != 200) as errors" +
          " FROM broker_webhook_logs bwl JOIN broker_api_keys bak ON bak.id = bwl.api_key_id" +
          " WHERE bwl.created_at >= '" + from + "T00:00:00Z' AND bwl.created_at <= '" + to + "T23:59:59Z'" +
          " GROUP BY bak.broker_name, payload->'data'->>'advisorName'" +
          " ORDER BY bak.broker_name, creates DESC"
        ));
        ws5.columns = [
          { header: 'Broker', key: 'broker_name', width: 20 },
          { header: 'Advisor', key: 'advisor', width: 30 },
          { header: 'Creates', key: 'creates', width: 10 },
          { header: 'Closes', key: 'closes', width: 10 },
          { header: 'SL Triggered', key: 'sl_triggered', width: 12 },
          { header: 'Target Hit', key: 'target_hit', width: 12 },
          { header: 'OK', key: 'ok', width: 10 },
          { header: 'Errors', key: 'errors', width: 10 },
        ];
        for (const row of brokerAdvData.rows) { ws5.addRow(row); }
        ws5.getRow(1).font = { bold: true };

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=AlphaMarket_Broker_Report_${from}_to_${to}.xlsx`);
        return res.send(Buffer.from(buffer));
      }

      // CSV fallback
      const headers = ['Date','Event','Symbol','Action','Advisor','Strategy','RecID','Entry','Target','StopLoss','Broker','Status'];
      const csv = [headers.join(','), ...(data.rows as any[]).map((r: any) =>
        [r.date, r.event, r.symbol, r.call_type, `"${r.advisor || ''}"`, `"${r.strategy || ''}"`, r.rec_id, r.entry_price, r.target, r.stoploss, r.broker_name, r.status_code].join(',')
      )].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=AlphaMarket_Broker_Report_${from}_to_${to}.csv`);
      return res.send(csv);
    } catch (err: any) { res.status(500).send(err.message); }
  });



  initXTSBridge();
  initBrokerAdapters();

  return httpServer;
}
