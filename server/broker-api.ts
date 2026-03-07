import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import { fireWebhookEvent, buildCallEventData, buildPositionEventData } from "./webhook-dispatcher";

interface BrokerApiKey {
  id: string;
  broker_name: string;
  api_key: string;
  api_secret: string;
  tenant_code: string;
  permissions: string[];
  rate_limit: number;
  is_active: boolean;
  ip_whitelist: string[] | null;
  webhook_url: string | null;
  contact_email: string | null;
  last_used_at: Date | null;
  expires_at: Date | null;
  allowed_advisors: string[] | null;
  webhook_events: string[] | null;
}

interface BrokerRequest extends Request {
  broker?: BrokerApiKey;
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(apiKey: string, limit: number): boolean {
  const now = Date.now();
  const window = rateLimitMap.get(apiKey);
  if (!window || now > window.resetAt) {
    rateLimitMap.set(apiKey, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (window.count >= limit) return false;
  window.count++;
  return true;
}

async function authenticateBroker(req: BrokerRequest, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const apiKey = req.headers["x-api-key"] as string;
  const signature = req.headers["x-api-signature"] as string;
  const timestamp = req.headers["x-api-timestamp"] as string;

  if (!apiKey) return res.status(401).json({ error: "Missing x-api-key header" });

  try {
    const result = await db.execute(sql`SELECT * FROM broker_api_keys WHERE api_key = ${apiKey} AND is_active = true`);
    const broker = result.rows[0] as unknown as BrokerApiKey;
    if (!broker) return res.status(401).json({ error: "Invalid or inactive API key" });

    if (broker.expires_at && new Date(broker.expires_at) < new Date()) {
      return res.status(401).json({ error: "API key has expired" });
    }

    if (broker.ip_whitelist && broker.ip_whitelist.length > 0) {
      const clientIp = req.ip || req.socket.remoteAddress || "";
      if (!broker.ip_whitelist.includes(clientIp)) {
        return res.status(403).json({ error: "IP not whitelisted" });
      }
    }

    if (signature && timestamp) {
      const age = Math.abs(Date.now() - parseInt(timestamp));
      if (age > 300000) return res.status(401).json({ error: "Request timestamp expired" });
      const body = req.method === "GET" ? "" : JSON.stringify(req.body || {});
      const payload = req.method + ":" + req.path + ":" + timestamp + ":" + body;
      const expected = createHmac("sha256", broker.api_secret).update(payload).digest("hex");
      try {
        if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
          return res.status(401).json({ error: "Invalid signature" });
        }
      } catch {
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    if (!checkRateLimit(apiKey, broker.rate_limit || 100)) {
      return res.status(429).json({ error: "Rate limit exceeded", retryAfter: 60 });
    }

    db.execute(sql`UPDATE broker_api_keys SET last_used_at = NOW() WHERE id = ${broker.id}`).catch(() => {});
    req.broker = broker;
    next();

    const responseTime = Date.now() - startTime;
    db.execute(sql`INSERT INTO broker_api_logs (api_key_id, method, path, status_code, response_time_ms, ip_address, user_agent) VALUES (${broker.id}, ${req.method}, ${req.path}, ${res.statusCode}, ${responseTime}, ${req.ip || ""}, ${req.headers["user-agent"] || ""})`).catch(() => {});
  } catch (err) {
    console.error("Broker auth error:", err);
    return res.status(500).json({ error: "Authentication failed" });
  }
}

function requirePermission(perm: string) {
  return (req: BrokerRequest, res: Response, next: NextFunction) => {
    if (!req.broker?.permissions?.includes(perm) && !req.broker?.permissions?.includes("admin")) {
      return res.status(403).json({ error: "Permission '" + perm + "' required" });
    }
    next();
  };
}

export function getSwaggerSpec() {
  return {
    openapi: "3.0.3",
    info: {
      title: "AlphaMarket Broker API",
      version: "2.2.0",
      description: "AlphaMarket Broker API Integration Guide v2.2\n\nSEBI-registered research analyst marketplace API for broker integrations. Provides access to advisors, strategies, portfolio recommendations, and live calls.\n\n**What\'s New in v2.2:**\n- Email notifications to subscribers on call/position events (new, update, close)\n- Auto Stop Loss & Target detection (every 60s during market hours)\n- Trailing Stop Loss monitoring with auto-trigger\n- Push + In-app + Email notification pipeline\n- Webhook events for all call/position lifecycle changes\n\n**v2.1:**\n- PRICE (₹) trailing SL type across all Equity and F&O forms\n- Trailing Stop Loss fully supported on F&O Position creation\n- Revised trailing SL types: PERCENTAGE | POINTS | PRICE (replaces FIXED)\n\nAuthentication via x-api-key header. Optional HMAC-SHA256 signature for enhanced security.",
      contact: { email: "hello@alphamarket.co.in", name: "AlphaMarket Team", url: "https://alphamarket.co.in" },
    },
    servers: [{ url: "https://alphamarket.co.in/api/v1", description: "Production" }],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key", description: "Broker API key (e.g., amk_live_...)" },
        SignatureAuth: { type: "apiKey", in: "header", name: "x-api-signature", description: "HMAC-SHA256 signature: sign(METHOD:PATH:TIMESTAMP:BODY, api_secret)" },
      },
      schemas: {
        Advisor: {
          type: "object",
          properties: {
            uid: { type: "string", format: "uuid" },
            companyName: { type: "string" },
            emailId: { type: "string", format: "email" },
            advisorId: { type: "string" },
            name: { type: "string" },
            theme: { type: "array", items: { type: "string" } },
            sebiRegistrationNo: { type: "string" },
            overview: { type: "string" },
            profilePicUrl: { type: "string" },
            isApproved: { type: "string" },
            status: { type: "string", enum: ["ACTIVE", "DRAFT", "SUSPENDED"] },
            active: { type: "boolean" },
          },
        },
        Strategy: {
          type: "object",
          properties: {
            uid: { type: "string", format: "uuid" },
            strategyId: { type: "string" },
            strategyName: { type: "string" },
            advisorId: { type: "string" },
            advisorName: { type: "string" },
            strategyType: { type: "string", enum: ["Equity", "Basket", "Future", "Commodity", "Option"] },
            theme: { type: "array", items: { type: "string" } },
            description: { type: "string" },
            cagr: { type: "number" },
            minimumInvestment: { type: "number" },
            rebalanceFrequency: { type: "string" },
            status: { type: "string", enum: ["ACTIVE", "DRAFT"] },
            totalRecommendations: { type: "integer" },
            active: { type: "boolean" },
          },
        },
        PortfolioRecommendation: {
          type: "object",
          required: ["symbol", "strategyId"],
          properties: {
            uid: { type: "string", format: "uuid" },
            tenantCode: { type: "string" },
            advisorId: { type: "string" },
            strategyId: { type: "string" },
            symbol: { type: "string" },
            name: { type: "string" },
            equityType: { type: "string" },
            optionType: { type: "string" },
            buyDate: { type: "string", format: "date-time" },
            buyPrice: { type: "number" },
            quantity: { type: "integer" },
            entryPrice: { type: "number" },
            sellPrice: { type: "number" },
            buyPriceRangeStart: { type: "number" },
            buyPriceRangeEnd: { type: "number" },
            targetPriceRange: { type: "string" },
            profitGoal: { type: "string" },
            stopLoss: { type: "string" },
            callType: { type: "string" },
            positionType: { type: "string" },
            status: { type: "string", enum: ["DRAFT", "ACTIVE", "CLOSED"] },
            rational: { type: "string" },
            gamePlan: { type: "string" },
            strategyType: { type: "string" },
            expiry: { type: "string", format: "date-time" },
            strikePrice: { type: "number" },
            active: { type: "boolean" },
            trailingSlEnabled: { type: "boolean", description: "Enable trailing stop loss" },
            trailingSlType: { type: "string", enum: ["PERCENTAGE", "POINTS", "PRICE"], description: "Trailing SL type: PERCENTAGE (trail by %), POINTS (trail by fixed points), PRICE (trail by fixed ₹ amount) - PRICE is NEW in v2.1" },
            trailingSlValue: { type: "string", description: "Trail value (e.g., '3' for 3%, '50' for 50 pts, '250' for ₹250)" },
          },
        },
        TrailingStopLoss: {
          type: "object",
          description: "Trailing Stop Loss configuration. Auto-adjusts SL as price moves favorably. NEW in v2.1: PRICE type added, F&O support added.",
          properties: {
            enabled: { type: "boolean", description: "Whether trailing SL is active" },
            type: { type: "string", enum: ["PERCENTAGE", "POINTS", "PRICE"], description: "PERCENTAGE = trail by % of highest price, POINTS = trail by fixed points, PRICE = trail by fixed ₹ amount (NEW in v2.1)" },
            value: { type: "number", description: "Trail value: percentage (e.g., 3.0), points (e.g., 20), or rupees (e.g., 250)" },
            currentSL: { type: "string", description: "Current computed stop loss price (read-only)" },
            highestPrice: { type: "string", description: "Highest price since entry (read-only)" },
            triggeredAt: { type: "number", nullable: true, description: "Price at which SL was triggered (null if active)" },
          },
        },
        WebhookPayload: {
          type: "object",
          description: "Webhook POST payload. Verify signature with HMAC-SHA256. Return HTTP 200 within 5s. Retries: 3x (5s, 30s, 120s backoff).",
          properties: {
            event: { type: "string", enum: ["CALL_CREATED", "CALL_MODIFIED", "CALL_CLOSED", "TARGET_ACHIEVED", "STOPLOSS_TRIGGERED", "TRAILING_SL_TRIGGERED", "TRAILING_SL_UPDATED", "POSITION_CREATED", "POSITION_MODIFIED", "POSITION_CLOSED"] },
            timestamp: { type: "string", format: "date-time" },
            data: { type: "object", description: "Call or Position object with trailingStopLoss if enabled" },
            signature: { type: "string", description: "HMAC-SHA256 signature for verification" },
          },
        },
      },
    },
    paths: {
      "/alpha/advisor": {
        get: {
          tags: ["Advisors"],
          summary: "List all approved advisors",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "theme", in: "query", schema: { type: "string" }, description: "Filter by theme" },
          ],
          responses: { "200": { description: "List of advisors" } },
        },
        post: {
          tags: ["Advisors"],
          summary: "Create or update an advisor",
          requestBody: { required: true, content: { "application/json": { schema: { "$ref": "#/components/schemas/Advisor" } } } },
          responses: { "200": { description: "Advisor created/updated" } },
        },
      },
      "/alpha/advisor/{advisorId}": {
        get: {
          tags: ["Advisors"],
          summary: "Get advisor by ID",
          parameters: [{ name: "advisorId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Advisor details" }, "404": { description: "Not found" } },
        },
      },
      "/alpha/strategy": {
        get: {
          tags: ["Strategies"],
          summary: "List published strategies",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "advisorId", in: "query", schema: { type: "string" } },
            { name: "type", in: "query", schema: { type: "string", enum: ["Equity", "Basket", "Future"] } },
          ],
          responses: { "200": { description: "List of strategies" } },
        },
        post: {
          tags: ["Strategies"],
          summary: "Create a new strategy",
          requestBody: { required: true, content: { "application/json": { schema: { "$ref": "#/components/schemas/Strategy" } } } },
          responses: { "201": { description: "Strategy created" } },
        },
      },
      "/alpha/strategy/{strategyId}": {
        get: {
          tags: ["Strategies"],
          summary: "Get strategy with portfolio details",
          parameters: [{ name: "strategyId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Strategy details with calls and positions" } },
        },
        put: {
          tags: ["Strategies"],
          summary: "Update a strategy",
          parameters: [{ name: "strategyId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { "$ref": "#/components/schemas/Strategy" } } } },
          responses: { "200": { description: "Updated" } },
        },
      },
      "/alpha/strategy/portfolio": {
        post: {
          tags: ["Portfolio"],
          summary: "Create a portfolio recommendation",
          description: "Primary endpoint for brokers to push stock recommendations/calls. Supports Equity calls and F&O positions. NEW in v2.1: F&O positions now support trailingSlEnabled, trailingSlType (PERCENTAGE/POINTS/PRICE), and trailingSlValue fields.",
          requestBody: { required: true, content: { "application/json": { schema: { "$ref": "#/components/schemas/PortfolioRecommendation" } } } },
          responses: { "201": { description: "Recommendation created" } },
        },
      },
      "/alpha/strategy/{strategyId}/portfolio": {
        get: {
          tags: ["Portfolio"],
          summary: "Get all recommendations for a strategy",
          parameters: [
            { name: "strategyId", in: "path", required: true, schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["ACTIVE", "CLOSED", "ALL"] } },
          ],
          responses: { "200": { description: "List of recommendations" } },
        },
      },
      "/alpha/strategy/{strategyId}/portfolio/{callId}": {
        put: {
          tags: ["Portfolio"],
          summary: "Update a recommendation (close call, update target/SL, modify trailing SL)",
          parameters: [
            { name: "strategyId", in: "path", required: true, schema: { type: "string" } },
            { name: "callId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { "$ref": "#/components/schemas/PortfolioRecommendation" } } } },
          responses: { "200": { description: "Updated" } },
        },
      },
      "/alpha/live-calls": {
        get: {
          tags: ["Live Calls"],
          summary: "Get all active live calls across strategies (includes trailing SL data)",
          description: "Primary polling endpoint. Returns active calls with trailingStopLoss object when enabled. Filter by type (EQUITY/FnO). Recommended: use webhooks for real-time, poll this every 30-60s as fallback.",
          parameters: [{ name: "type", in: "query", schema: { type: "string", enum: ["EQUITY", "FnO"] }, description: "Filter by EQUITY or FnO" }],
          responses: { "200": { description: "Active calls with trailingStopLoss data. TrailingStopLoss types: PERCENTAGE, POINTS, PRICE (NEW in v2.1)" } },
        },
      },
      "/alpha/api-keys": {
        get: {
          tags: ["Admin"],
          summary: "List all API keys (admin only)",
          responses: { "200": { description: "List of API keys" } },
        },
      },
      "/alpha/api-logs": {
        get: {
          tags: ["Admin"],
          summary: "View API request logs (admin only)",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 50 } }],
          responses: { "200": { description: "Recent API logs" } },
        },
      },
      "/health": {
        get: {
          tags: ["System"],
          summary: "Health check (no auth required)",
          security: [],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };
}

export function registerBrokerApiRoutes(app: Express) {
  const prefix = "/api/v1";

  // Health check - no auth
  app.get(prefix + "/health", (_req, res) => {
    res.json({ status: "ok", version: "1.0.0", timestamp: new Date().toISOString() });
  });

  // All /alpha/* routes require API key
  app.use(prefix + "/alpha", authenticateBroker as any);

  // ========== ADVISORS ==========
  app.get(prefix + "/alpha/advisor", requirePermission("read") as any, async (req: BrokerRequest, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const theme = req.query.theme as string;
      const advisors = await storage.getAdvisors();
      let filtered = advisors.filter(a => a.isApproved);
      if (theme) filtered = filtered.filter(a => a.themes?.some(t => t.toLowerCase().includes(theme.toLowerCase())));
      const total = filtered.length;
      const paginated = filtered.slice((page - 1) * limit, page * limit);
      const mapped = paginated.map(a => ({
        uid: a.id,
        tenantCode: req.broker?.tenant_code,
        companyName: a.companyName,
        emailId: a.email,
        advisorId: a.id,
        name: a.username,
        theme: a.themes || [],
        sebiRegistrationNo: a.sebiRegNumber,
        overview: a.overview,
        profilePicUrl: a.logoUrl,
        isApproved: a.isApproved ? "Y" : "N",
        status: "ACTIVE",
        active: true,
      }));
      res.json({ data: mapped, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(prefix + "/alpha/advisor/:advisorId", requirePermission("read") as any, async (req: BrokerRequest, res) => {
    try {
      const advisor = await storage.getAdvisorWithDetails(req.params.advisorId);
      if (!advisor) return res.status(404).json({ error: "Advisor not found" });
      const user = advisor.advisor || advisor;
      res.json({
        uid: user.id,
        tenantCode: req.broker?.tenant_code,
        companyName: user.companyName,
        emailId: user.email,
        advisorId: user.id,
        name: user.username,
        theme: user.themes || [],
        sebiRegistrationNo: user.sebiRegNumber,
        overview: user.overview,
        profilePicUrl: user.logoUrl,
        isApproved: user.isApproved ? "Y" : "N",
        numberOfLiveStrategy: advisor.strategies?.length || 0,
        status: "ACTIVE",
        active: true,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(prefix + "/alpha/advisor", requirePermission("write") as any, async (req: BrokerRequest, res) => {
    try {
      const { emailId, name, companyName, sebiRegistrationNo, overview, theme } = req.body;
      if (!emailId || !name) return res.status(400).json({ error: "emailId and name are required" });
      const existing = await storage.getUserByEmail(emailId);
      if (existing) {
        const updated = await storage.updateUser(existing.id, {
          companyName: companyName || existing.companyName,
          overview: overview || existing.overview,
          sebiRegNumber: sebiRegistrationNo || existing.sebiRegNumber,
          themes: theme || existing.themes,
        });
        return res.json({ uid: updated.id, status: "UPDATED" });
      }
      const user = await storage.createUser({
        username: name,
        email: emailId,
        password: "broker_managed_" + Date.now(),
        role: "advisor",
        companyName,
        overview,
        sebiRegNumber: sebiRegistrationNo,
        themes: theme,
        isApproved: false,
      });
      res.status(201).json({ uid: user.id, status: "CREATED" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== STRATEGIES ==========
  app.get(prefix + "/alpha/strategy", requirePermission("read") as any, async (req: BrokerRequest, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const advisorId = req.query.advisorId as string;
      const type = req.query.type as string;
      let strats = await storage.getPublishedStrategies();
      if (advisorId) strats = strats.filter((s: any) => s.advisorId === advisorId);
      if (type) strats = strats.filter((s: any) => s.type === type);
      const total = strats.length;
      const paginated = strats.slice((page - 1) * limit, page * limit);
      const mapped = paginated.map((s: any) => ({
        uid: s.id,
        tenantCode: req.broker?.tenant_code,
        strategyId: s.id,
        strategyName: s.name,
        advisorId: s.advisorId,
        advisorName: s.advisor?.companyName || s.advisor?.username,
        strategyType: s.type,
        theme: s.theme || [],
        description: s.description,
        cagr: parseFloat(s.cagr || "0"),
        minimumInvestment: parseFloat(s.minimumInvestment || "0"),
        rebalanceFrequency: s.rebalanceFrequency,
        totalRecommendations: s.totalRecommendations,
        stocksInBuyZone: s.stocksInBuyZone,
        status: s.status === "Published" ? "ACTIVE" : "DRAFT",
        active: s.status === "Published",
      }));
      res.json({ data: mapped, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(prefix + "/alpha/strategy/:strategyId", requirePermission("read") as any, async (req: BrokerRequest, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.strategyId);
      if (!strategy) return res.status(404).json({ error: "Strategy not found" });
      const callsList = await storage.getCalls(strategy.id);
      const positionsList = await storage.getPositions(strategy.id);
      res.json({
        uid: strategy.id,
        tenantCode: req.broker?.tenant_code,
        strategyId: strategy.id,
        strategyName: strategy.name,
        advisorId: strategy.advisorId,
        advisorName: strategy.advisor?.companyName || strategy.advisor?.username,
        strategyType: strategy.type,
        theme: strategy.theme || [],
        description: strategy.description,
        cagr: parseFloat(strategy.cagr || "0"),
        status: strategy.status === "Published" ? "ACTIVE" : "DRAFT",
        portfolio: callsList.map(c => ({
          uid: c.id, symbol: c.stockName, buyPriceRangeStart: c.buyRangeStart, buyPriceRangeEnd: c.buyRangeEnd,
          targetPriceRange: c.targetPrice, stopLoss: c.stopLoss, rational: c.rationale,
          entryPrice: c.entryPrice, sellPrice: c.sellPrice, exitDate: c.exitDate,
          gainOrLossPercentage: c.gainPercent,
          status: c.status === "Active" ? "ACTIVE" : "CLOSED", active: c.status === "Active",
        })),
        positions: positionsList.map(p => ({
          uid: p.id, segment: p.segment, symbol: p.symbol, callPut: p.callPut, buySell: p.buySell,
          expiry: p.expiry, strikePrice: p.strikePrice, entryPrice: p.entryPrice, target: p.target,
          stopLoss: p.stopLoss, exitPrice: p.exitPrice, exitDate: p.exitDate,
          status: p.status === "Active" ? "ACTIVE" : "CLOSED", active: p.status === "Active",
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(prefix + "/alpha/strategy", requirePermission("write") as any, async (req: BrokerRequest, res) => {
    try {
      const { advisorId, strategyName, strategyType, description, theme, benchmark, minimumInvestment, cagr } = req.body;
      if (!advisorId || !strategyName) return res.status(400).json({ error: "advisorId and strategyName are required" });
      const advisor = await storage.getUser(advisorId);
      if (!advisor) return res.status(404).json({ error: "Advisor not found" });
      const strategy = await storage.createStrategy({
        advisorId, name: strategyName, type: strategyType || "Equity",
        description, theme: theme || [], benchmark,
        minimumInvestment: minimumInvestment?.toString(),
        cagr: cagr?.toString(), status: "Draft",
      });
      res.status(201).json({ uid: strategy.id, strategyId: strategy.id, status: "CREATED" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put(prefix + "/alpha/strategy/:strategyId", requirePermission("write") as any, async (req: BrokerRequest, res) => {
    try {
      const existing = await storage.getStrategy(req.params.strategyId);
      if (!existing) return res.status(404).json({ error: "Strategy not found" });
      const { strategyName, description, theme, status, benchmark, minimumInvestment, cagr } = req.body;
      const updated = await storage.updateStrategy(req.params.strategyId, {
        ...(strategyName && { name: strategyName }),
        ...(description !== undefined && { description }),
        ...(theme && { theme }),
        ...(status && { status: status === "ACTIVE" ? "Published" as const : "Draft" as const }),
        ...(benchmark && { benchmark }),
        ...(minimumInvestment && { minimumInvestment: minimumInvestment.toString() }),
        ...(cagr && { cagr: cagr.toString() }),
      });
      res.json({ uid: updated.id, status: "UPDATED" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== PORTFOLIO / RECOMMENDATIONS ==========
  app.post(prefix + "/alpha/strategy/portfolio", requirePermission("write") as any, async (req: BrokerRequest, res) => {
    try {
      const { strategyId, symbol, buyPrice, quantity, targetPriceRange, profitGoal, stopLoss, rational, callType, buyPriceRangeStart, buyPriceRangeEnd, equityType, optionType, expiry, strikePrice } = req.body;
      if (!strategyId || !symbol) return res.status(400).json({ error: "strategyId and symbol are required" });
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) return res.status(404).json({ error: "Strategy not found" });

      const isDerivative = equityType === "FnO" || optionType || expiry || strikePrice;
      if (isDerivative) {
        const position = await storage.createPosition({
          strategyId, segment: equityType || "FnO", callPut: optionType || null,
          buySell: callType || "Buy", symbol, expiry: expiry || null,
          strikePrice: strikePrice?.toString() || null, entryPrice: buyPrice?.toString() || null,
          lots: quantity || null, target: targetPriceRange?.toString() || profitGoal?.toString() || null,
          stopLoss: stopLoss?.toString() || null, rationale: rational || null,
          status: "Active", isPublished: true, publishMode: "live", theme: callType || null,
        });
        // Fire webhook
        fireWebhookEvent("POSITION_CREATED", buildPositionEventData(position, strategy), strategy.advisorId).catch(() => {});
        return res.status(201).json({ uid: position.id, type: "POSITION", status: "CREATED" });
      }

      const { trailingStopLoss } = req.body;
      const call = await storage.createCall({
        strategyId, stockName: symbol, action: callType || "Buy",
        buyRangeStart: buyPriceRangeStart?.toString() || buyPrice?.toString() || null,
        buyRangeEnd: buyPriceRangeEnd?.toString() || buyPrice?.toString() || null,
        targetPrice: targetPriceRange?.toString() || null, profitGoal: profitGoal?.toString() || null,
        stopLoss: stopLoss?.toString() || null, rationale: rational || null,
        entryPrice: buyPrice?.toString() || null,
        status: "Active", isPublished: true, publishMode: "live", theme: callType || null,
        trailing_sl_enabled: trailingStopLoss?.enabled || false,
        trailing_sl_type: trailingStopLoss?.type || "PERCENTAGE",
        trailing_sl_value: trailingStopLoss?.value?.toString() || null,
        trailing_sl_highest_price: buyPrice?.toString() || null,
        trailing_sl_current_sl: trailingStopLoss?.enabled ? stopLoss?.toString() : null,
      });
      // Fire webhook
      fireWebhookEvent("CALL_CREATED", buildCallEventData(call, strategy), strategy.advisorId).catch(() => {});
      res.status(201).json({ uid: call.id, type: "CALL", status: "CREATED" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(prefix + "/alpha/strategy/:strategyId/portfolio", requirePermission("read") as any, async (req: BrokerRequest, res) => {
    try {
      const status = req.query.status as string;
      let callsList = await storage.getCalls(req.params.strategyId);
      let positionsList = await storage.getPositions(req.params.strategyId);
      if (status && status !== "ALL") {
        const dbStatus = status === "ACTIVE" ? "Active" : "Closed";
        callsList = callsList.filter(c => c.status === dbStatus);
        positionsList = positionsList.filter(p => p.status === dbStatus);
      }
      const portfolio = [
        ...callsList.map(c => ({
          uid: c.id, type: "EQUITY", symbol: c.stockName, buyDate: c.callDate,
          buyPriceRangeStart: c.buyRangeStart, buyPriceRangeEnd: c.buyRangeEnd,
          targetPriceRange: c.targetPrice, stopLoss: c.stopLoss, rational: c.rationale,
          entryPrice: c.entryPrice, sellPrice: c.sellPrice, exitDate: c.exitDate,
          gainOrLossPercentage: c.gainPercent,
          status: c.status === "Active" ? "ACTIVE" : "CLOSED", active: c.status === "Active",
        })),
        ...positionsList.map(p => ({
          uid: p.id, type: p.segment || "FnO", symbol: p.symbol, callPut: p.callPut,
          buySell: p.buySell, expiry: p.expiry, strikePrice: p.strikePrice,
          entryPrice: p.entryPrice, target: p.target, stopLoss: p.stopLoss,
          exitPrice: p.exitPrice, exitDate: p.exitDate, gainOrLossPercentage: p.gainPercent,
          status: p.status === "Active" ? "ACTIVE" : "CLOSED", active: p.status === "Active",
        })),
      ];
      res.json({ data: portfolio, total: portfolio.length, strategyId: req.params.strategyId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put(prefix + "/alpha/strategy/:strategyId/portfolio/:callId", requirePermission("write") as any, async (req: BrokerRequest, res) => {
    try {
      const { callId, strategyId } = req.params;
      const { sellPrice, exitDate, status, targetPriceRange, stopLoss, rational } = req.body;

      const call = await storage.getCall(callId);
      if (call && call.strategyId === strategyId) {
        const updateData: any = {};
        if (sellPrice) updateData.sellPrice = sellPrice.toString();
        if (exitDate) updateData.exitDate = new Date(exitDate);
        if (status) updateData.status = status === "CLOSED" ? "Closed" : "Active";
        if (targetPriceRange) updateData.targetPrice = targetPriceRange.toString();
        if (stopLoss) updateData.stopLoss = stopLoss.toString();
        if (rational) updateData.rationale = rational;
        if (sellPrice && updateData.status === "Closed" && call.entryPrice) {
          updateData.gainPercent = (((parseFloat(sellPrice) - parseFloat(call.entryPrice)) / parseFloat(call.entryPrice)) * 100).toFixed(2);
        }
        const updated = await storage.updateCall(callId, updateData);
        const evtType = updateData.status === "Closed" ? "CALL_CLOSED" : "CALL_MODIFIED";
        fireWebhookEvent(evtType, buildCallEventData({ ...call, ...updateData }), call.strategyId).catch(() => {});
        return res.json({ uid: updated.id, type: "CALL", status: "UPDATED" });
      }

      const position = await storage.getPosition(callId);
      if (position && position.strategyId === strategyId) {
        const updateData: any = {};
        if (sellPrice) updateData.exitPrice = sellPrice.toString();
        if (exitDate) updateData.exitDate = new Date(exitDate);
        if (status) updateData.status = status === "CLOSED" ? "Closed" : "Active";
        if (targetPriceRange) updateData.target = targetPriceRange.toString();
        if (stopLoss) updateData.stopLoss = stopLoss.toString();
        if (rational) updateData.rationale = rational;
        const updated = await storage.updatePosition(callId, updateData);
        const posEvtType = updateData.status === "Closed" ? "POSITION_CLOSED" : "POSITION_MODIFIED";
        fireWebhookEvent(posEvtType, buildPositionEventData({ ...position, ...updateData }), position.strategyId).catch(() => {});
        return res.json({ uid: updated.id, type: "POSITION", status: "UPDATED" });
      }

      res.status(404).json({ error: "Call/Position not found for this strategy" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== LIVE CALLS ==========
  app.get(prefix + "/alpha/live-calls", requirePermission("read") as any, async (req: BrokerRequest, res) => {
    try {
      const type = req.query.type as string;
      const activeCalls = await storage.getAllActiveCalls();
      const activePositions = await storage.getAllActivePositions();
      const results = [
        ...activeCalls.map(c => ({
          uid: c.id, type: "EQUITY", symbol: c.stockName, strategyId: c.strategyId,
          action: c.action, buyRangeStart: c.buyRangeStart, buyRangeEnd: c.buyRangeEnd,
          targetPrice: c.targetPrice, stopLoss: c.stopLoss, entryPrice: c.entryPrice,
          callDate: c.callDate, rationale: c.rationale, trailingStopLoss: c.trailing_sl_enabled ? {
            enabled: true, type: c.trailing_sl_type, value: c.trailing_sl_value,
            currentSL: c.trailing_sl_current_sl, highestPrice: c.trailing_sl_highest_price
          } : { enabled: false },
          status: "ACTIVE",
        })),
        ...activePositions.map(p => ({
          uid: p.id, type: p.segment || "FnO", symbol: p.symbol, strategyId: p.strategyId,
          callPut: p.callPut, buySell: p.buySell, expiry: p.expiry, strikePrice: p.strikePrice,
          entryPrice: p.entryPrice, target: p.target, stopLoss: p.stopLoss,
          rationale: p.rationale, status: "ACTIVE",
        })),
      ];
      let filtered = type ? results.filter(r => r.type === type) : results;
      // Filter by allowed advisors if configured on API key
      if (req.broker?.allowed_advisors && req.broker.allowed_advisors.length > 0) {
        const allowedSet = new Set(req.broker.allowed_advisors);
        filtered = filtered.filter(r => {
          const advId = (r as any).advisorId;
          return !advId || allowedSet.has(advId);
        });
      }
      res.json({ data: filtered, total: filtered.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========== ADMIN: API KEY MANAGEMENT ==========
  app.get(prefix + "/alpha/api-keys", requirePermission("admin") as any, async (_req: BrokerRequest, res) => {
    try {
      const result = await db.execute(sql`SELECT id, broker_name, api_key, permissions, rate_limit, is_active, ip_whitelist, webhook_url, contact_email, last_used_at, created_at, expires_at FROM broker_api_keys ORDER BY created_at DESC`);
      res.json({ data: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(prefix + "/alpha/api-logs", requirePermission("admin") as any, async (req: BrokerRequest, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
      const result = await db.execute(sql`SELECT l.*, k.broker_name FROM broker_api_logs l LEFT JOIN broker_api_keys k ON l.api_key_id = k.id ORDER BY l.created_at DESC LIMIT ${limit}`);
      res.json({ data: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Webhook logs endpoint
  app.get(prefix + "/alpha/webhook-logs", requirePermission("admin") as any, async (req: BrokerRequest, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
      const result = await db.execute(sql`SELECT w.*, k.broker_name FROM broker_webhook_logs w LEFT JOIN broker_api_keys k ON w.api_key_id = k.id ORDER BY w.created_at DESC LIMIT ${limit}`);
      res.json({ data: result.rows });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Set allowed advisors for a broker API key
  app.put(prefix + "/alpha/api-keys/:keyId/advisors", requirePermission("admin") as any, async (req: BrokerRequest, res) => {
    try {
      const { advisorIds } = req.body;
      if (!Array.isArray(advisorIds)) return res.status(400).json({ error: "advisorIds must be an array" });
      await db.execute(sql`UPDATE broker_api_keys SET allowed_advisors = ${advisorIds} WHERE id = ${req.params.keyId}`);
      res.json({ status: "UPDATED", allowedAdvisors: advisorIds });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Set webhook URL for a broker API key
  app.put(prefix + "/alpha/api-keys/:keyId/webhook", requirePermission("admin") as any, async (req: BrokerRequest, res) => {
    try {
      const { webhookUrl, events } = req.body;
      if (webhookUrl) {
        await db.execute(sql`UPDATE broker_api_keys SET webhook_url = ${webhookUrl} WHERE id = ${req.params.keyId}`);
      }
      if (events && Array.isArray(events)) {
        await db.execute(sql`UPDATE broker_api_keys SET webhook_events = ${events} WHERE id = ${req.params.keyId}`);
      }
      res.json({ status: "UPDATED", webhookUrl, events });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  console.log("Broker API v1 routes registered at /api/v1/alpha/*");
}
