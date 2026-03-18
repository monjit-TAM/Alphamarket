import { db } from "./db";
import { sql } from "drizzle-orm";

// ── Cache ──────────────────────────────────────────────────────────
let cachedConfig: any = null;
let cacheTime = 0;
const CACHE_TTL = 60_000;

export async function getMonetizationConfig(): Promise<Record<string, any>> {
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) return cachedConfig;
  try {
    const result = await db.execute(sql`SELECT value FROM app_settings WHERE key = 'monetization_config'`);
    const row = ((result as any).rows || [])[0];
    cachedConfig = row ? JSON.parse(row.value) : {};
  } catch {
    cachedConfig = {};
  }
  cacheTime = Date.now();
  return cachedConfig;
}

export function clearConfigCache() { cachedConfig = null; cacheTime = 0; }

// ── Period helpers ─────────────────────────────────────────────────
function getPeriodStart(period: string): Date {
  const now = new Date();
  if (period === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d; }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// ── Usage count ───────────────────────────────────────────────────
export async function getUsageCount(userId: string, tool: string, period: string = "month"): Promise<number> {
  const since = getPeriodStart(period);
  const result = await db.execute(
    sql`SELECT COUNT(*)::int AS cnt FROM tool_usage WHERE user_id = ${userId} AND tool = ${tool} AND created_at >= ${since.toISOString()}`
  );
  return ((result as any).rows || [])[0]?.cnt || 0;
}

// ── Log usage ─────────────────────────────────────────────────────
export async function logToolUsage(userId: string, tool: string, endpoint?: string, metadata?: any): Promise<void> {
  await db.execute(
    sql`INSERT INTO tool_usage (user_id, tool, endpoint, metadata) VALUES (${userId}, ${tool}, ${endpoint || null}, ${JSON.stringify(metadata || {})}::jsonb)`
  );
}

// ── Active subscription ───────────────────────────────────────────
export async function getActiveSubscription(userId: string, tool: string): Promise<any> {
  const result = await db.execute(
    sql`SELECT * FROM tool_subscriptions WHERE user_id = ${userId} AND tool = ${tool} AND status = 'active' AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1`
  );
  return ((result as any).rows || [])[0] || null;
}

// ── Increment subscription usage ──────────────────────────────────
export async function incrementSubUsage(subId: number): Promise<void> {
  await db.execute(sql`UPDATE tool_subscriptions SET analyses_used = analyses_used + 1 WHERE id = ${subId}`);
}

// ── DYOR Middleware ────────────────────────────────────────────────
export function checkDyorAccess() {
  return async (req: any, res: any, next: Function) => {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: "Login required" });

    try {
      const userResult = await db.execute(sql`SELECT role, is_approved, created_at FROM users WHERE id = ${req.session.userId}`);
      const user = ((userResult as any).rows || [])[0];
      if (!user) return res.status(401).json({ error: "User not found" });

      // Admins always pass
      if (user.role === "admin") return next();

      const config = await getMonetizationConfig();
      const dyorConfig = config.dyor || {};

      // Approved advisors get free access
      if (user.role === "advisor" && user.is_approved && dyorConfig.freeForApprovedAdvisors !== false) {
        return next();
      }

      // Check active subscription
      const sub = await getActiveSubscription(req.session.userId, "dyor");
      if (sub) return next();

      // Check trial period
      const trialDays = dyorConfig.trialDays || 10;
      const createdAt = new Date(user.created_at);
      const trialEnd = new Date(createdAt.getTime() + trialDays * 24 * 60 * 60 * 1000);
      const now = new Date();

      if (now <= trialEnd) {
        res.setHeader("X-Trial-Remaining-Days", String(Math.ceil((trialEnd.getTime() - now.getTime()) / (24*60*60*1000))));
        return next();
      }

      // Trial expired, no subscription
      return res.status(429).json({
        error: "Trial expired",
        tool: "dyor",
        label: dyorConfig.label || "DYOR Research Tool",
        trialDays: trialDays,
        trialExpired: true,
        upgrade: {
          message: "Your " + trialDays + "-day DYOR trial has expired. Subscribe for Rs " + (dyorConfig.monthlyPrice || 4999) + "/month to continue.",
          monthlyPrice: dyorConfig.monthlyPrice || 4999,
        },
      });
    } catch (err: any) {
      console.error("[DyorAccess] Error:", err.message);
      next();
    }
  };
}

// ── Stock/MF Bundle Middleware ─────────────────────────────────────
export function checkAnalyzerAccess(analyzerType: string) {
  return async (req: any, res: any, next: Function) => {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: "Login required" });

    try {
      const userResult = await db.execute(sql`SELECT role FROM users WHERE id = ${req.session.userId}`);
      const user = ((userResult as any).rows || [])[0];
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role === "admin") return next();

      const config = await getMonetizationConfig();
      const bundleConfig = config.stockMfBundle || {};

      // Check active bundle subscription
      const sub = await getActiveSubscription(req.session.userId, "stockMfBundle");
      if (!sub) {
        return res.status(429).json({
          error: "Subscription required",
          tool: "stockMfBundle",
          label: bundleConfig.label || "Stock & MF Analyzer Bundle",
          upgrade: {
            message: "Subscribe to the Stock & MF Analyzer Bundle for Rs " + (bundleConfig.monthlyPrice || 999) + "/month (includes " + (bundleConfig.includedAnalyses || 3) + " analyses).",
            monthlyPrice: bundleConfig.monthlyPrice || 999,
            includedAnalyses: bundleConfig.includedAnalyses || 3,
          },
        });
      }

      const included = sub.analyses_included || bundleConfig.includedAnalyses || 3;
      const used = sub.analyses_used || 0;

      if (used < included) {
        // Within included quota
        await incrementSubUsage(sub.id);
        res.setHeader("X-Analyses-Used", String(used + 1));
        res.setHeader("X-Analyses-Included", String(included));
        res.setHeader("X-Analyses-Remaining", String(included - used - 1));
        return next();
      }

      // Over quota — check if overage payment is included in this request
      const overagePrice = bundleConfig.additionalAnalysisPrice || 499;
      if (req.body && req.body._overagePaid === true) {
        await incrementSubUsage(sub.id);
        return next();
      }

      return res.status(429).json({
        error: "Analysis quota exhausted",
        tool: "stockMfBundle",
        label: bundleConfig.label || "Stock & MF Analyzer Bundle",
        used: used,
        included: included,
        overage: {
          message: "You have used all " + included + " included analyses. Pay Rs " + overagePrice + " for an additional analysis.",
          additionalAnalysisPrice: overagePrice,
          requiresPayment: true,
        },
      });
    } catch (err: any) {
      console.error("[AnalyzerAccess] Error:", err.message);
      next();
    }
  };
}

// ── Legacy middleware (backwards compat) ───────────────────────────
export function checkUsageLimit(tool: string) {
  if (tool === "dyor") return checkDyorAccess();
  if (tool === "stockAnalyzer" || tool === "mfAnalyzer") return checkAnalyzerAccess(tool);
  return async (_req: any, _res: any, next: Function) => next();
}

// ── Coupon validation ─────────────────────────────────────────────
export async function validateCoupon(code: string, tool: string, amount: number): Promise<{ valid: boolean; discount: number; error?: string }> {
  const result = await db.execute(sql`SELECT * FROM coupon_codes WHERE code = ${code.toUpperCase()} AND is_active = true`);
  const coupon = ((result as any).rows || [])[0];

  if (!coupon) return { valid: false, discount: 0, error: "Invalid coupon code" };

  const now = new Date();
  if (coupon.valid_from && new Date(coupon.valid_from) > now) return { valid: false, discount: 0, error: "Coupon not yet active" };
  if (coupon.valid_until && new Date(coupon.valid_until) < now) return { valid: false, discount: 0, error: "Coupon has expired" };
  if (coupon.max_uses && coupon.used_count >= coupon.max_uses) return { valid: false, discount: 0, error: "Coupon usage limit reached" };
  if (coupon.min_amount && amount < parseFloat(coupon.min_amount)) return { valid: false, discount: 0, error: "Minimum order amount is Rs " + coupon.min_amount };

  const applicableTools: string[] = coupon.applicable_tools || [];
  if (applicableTools.length > 0 && !applicableTools.includes(tool)) {
    return { valid: false, discount: 0, error: "Coupon not valid for this tool" };
  }

  let discount = 0;
  if (coupon.discount_type === "percentage") {
    discount = Math.round(amount * parseFloat(coupon.discount_value) / 100);
    if (coupon.max_discount) discount = Math.min(discount, parseFloat(coupon.max_discount));
  } else {
    discount = parseFloat(coupon.discount_value);
  }
  discount = Math.min(discount, amount);

  return { valid: true, discount };
}

export async function useCoupon(code: string): Promise<void> {
  await db.execute(sql`UPDATE coupon_codes SET used_count = used_count + 1 WHERE code = ${code.toUpperCase()}`);
}

// ── Admin stats ───────────────────────────────────────────────────
export async function getUsageStats(days: number = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  const [byTool, byDay, topUsers, subStats] = await Promise.all([
    db.execute(sql`
      SELECT tool, COUNT(*)::int AS total, COUNT(DISTINCT user_id)::int AS unique_users
      FROM tool_usage WHERE created_at >= ${sinceStr}
      GROUP BY tool ORDER BY total DESC
    `),
    db.execute(sql`
      SELECT tool, DATE(created_at)::text AS day, COUNT(*)::int AS total
      FROM tool_usage WHERE created_at >= ${sinceStr}
      GROUP BY tool, DATE(created_at) ORDER BY day DESC
    `),
    db.execute(sql`
      SELECT tu.user_id, u.username, u.email, u.role, tu.tool, COUNT(*)::int AS total
      FROM tool_usage tu JOIN users u ON u.id = tu.user_id
      WHERE tu.created_at >= ${sinceStr}
      GROUP BY tu.user_id, u.username, u.email, u.role, tu.tool
      ORDER BY total DESC LIMIT 50
    `),
    db.execute(sql`
      SELECT tool, status, COUNT(*)::int AS total, SUM(amount)::numeric AS revenue
      FROM tool_subscriptions WHERE created_at >= ${sinceStr}
      GROUP BY tool, status ORDER BY revenue DESC
    `),
  ]);

  return {
    period: { days, since: sinceStr },
    byTool: (byTool as any).rows || [],
    byDay: (byDay as any).rows || [],
    topUsers: (topUsers as any).rows || [],
    subscriptions: (subStats as any).rows || [],
  };
}
