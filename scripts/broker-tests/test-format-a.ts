/**
 * test-format-a.ts
 *
 * Quick dry-run that prints Format A JSON for real data in the DB.
 * Compare the output against thealphamarket.com's webhook spec PDF.
 *
 * Run from /var/www/alphamarket:
 *   npx tsx test-format-a.ts
 */

import { db } from "./server/db";
import { sql } from "drizzle-orm";
import {
  buildFormatAEquity,
  buildFormatAFno,
  loadStrategyAndAdvisor,
} from "./server/webhook-format-a";

async function test(label: string, fn: () => Promise<any>) {
  console.log("\n" + "═".repeat(72));
  console.log(" " + label);
  console.log("═".repeat(72));
  try {
    const envelope = await fn();
    if (!envelope) {
      console.log("  (no data found)");
      return;
    }
    console.log(JSON.stringify(envelope, null, 2));
  } catch (err: any) {
    console.log("  ✗ FAILED:", err.message);
    console.log(err.stack);
  }
}

async function main() {
  console.log("Format A dry-run test");
  console.log("Comparing our builder output against thealphamarket.com spec");

  // Test 1: Active equity call (CREATED event)
  await test("TEST 1: Equity CALL_CREATED (active call)", async () => {
    const r = await db.execute(sql`
      SELECT * FROM calls WHERE is_published = true AND status = 'Active'
      ORDER BY call_date DESC LIMIT 1
    `);
    if (!r.rows.length) return null;
    const call = r.rows[0] as any;
    const loaded = await loadStrategyAndAdvisor(call.strategy_id);
    if (!loaded) throw new Error("strategy or advisor not found");
    return buildFormatAEquity({
      event: "CALL_CREATED",
      call,
      strategy: loaded.strategy,
      advisor: loaded.advisor,
    });
  });

  // Test 2: Closed equity call (TARGET_ACHIEVED event)
  await test("TEST 2: Equity TARGET_ACHIEVED (closed call)", async () => {
    const r = await db.execute(sql`
      SELECT * FROM calls WHERE is_published = true AND status = 'Closed'
      ORDER BY exit_date DESC NULLS LAST LIMIT 1
    `);
    if (!r.rows.length) return null;
    const call = r.rows[0] as any;
    const loaded = await loadStrategyAndAdvisor(call.strategy_id);
    if (!loaded) throw new Error("strategy or advisor not found");
    return buildFormatAEquity({
      event: "TARGET_ACHIEVED",
      call,
      strategy: loaded.strategy,
      advisor: loaded.advisor,
    });
  });

  // Test 3: F&O position (POSITION_CREATED event)
  await test("TEST 3: F&O POSITION_CREATED", async () => {
    const r = await db.execute(sql`
      SELECT * FROM positions WHERE is_published = true
      ORDER BY created_at DESC LIMIT 1
    `);
    if (!r.rows.length) return null;
    const pos = r.rows[0] as any;
    const loaded = await loadStrategyAndAdvisor(pos.strategy_id);
    if (!loaded) throw new Error("strategy or advisor not found");
    return buildFormatAFno({
      event: "POSITION_CREATED",
      position: pos,
      strategy: loaded.strategy,
      advisor: loaded.advisor,
      lotSize: 1,
    });
  });

  console.log("\n" + "═".repeat(72));
  console.log(" ✓ Dry-run complete. Review outputs vs thealphamarket.com spec PDF.");
  console.log("═".repeat(72));
  process.exit(0);
}

main().catch(err => {
  console.error("\nFatal:", err.message);
  console.error(err.stack);
  process.exit(1);
});
