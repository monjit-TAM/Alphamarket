import { db } from "./db";
import { sql } from "drizzle-orm";

/**
 * Checks whether a user is entitled to receive alerts/calls for a strategy.
 * A user is entitled ONLY when ALL of these hold:
 *   1. subscription status = 'active'
 *   2. expires_at > now()
 *   3. a PAID payment exists for that subscription
 *
 * Risk profiling (SEBI requirement) is checked separately and logged as a warning.
 */
export async function isEntitled(userId: string, strategyId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT s.id, s.risk_profiling, s.expires_at
    FROM subscriptions s
    JOIN payments p ON p.subscription_id = s.id AND p.status = 'PAID'
    WHERE s.user_id = ${userId}
      AND s.strategy_id = ${strategyId}
      AND s.status = 'active'
      AND (s.expires_at IS NULL OR s.expires_at > NOW())
    LIMIT 1
  `);

  if ((result.rows as any[]).length === 0) return false;

  const sub = (result.rows as any[])[0];
  if (!sub.risk_profiling) {
    console.warn(`[Entitlement] User ${userId} strategy ${strategyId}: subscription active but risk_profiling not done (SEBI compliance flag)`);
  }

  return true;
}

/**
 * Returns entitled user IDs for a strategy (for batch alert sending).
 * This replaces the simple status='active' check used in push.ts.
 */
export async function getEntitledUserIds(strategyId: string): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT s.user_id
    FROM subscriptions s
    JOIN payments p ON p.subscription_id = s.id AND p.status = 'PAID'
    WHERE s.strategy_id = ${strategyId}
      AND s.status = 'active'
      AND (s.expires_at IS NULL OR s.expires_at > NOW())
  `);
  return (result.rows as any[]).map((r: any) => r.user_id);
}
