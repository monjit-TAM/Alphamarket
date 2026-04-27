/**
 * Fire a synthetic CALL_CREATED webhook for Front Wave's most recent active call.
 * Purpose: hit our new Upstox Sandbox broker row to verify Format A output end-to-end.
 *
 * Run from /var/www/alphamarket:
 *   export DATABASE_URL='postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db'
 *   npx tsx fire-webhook-test.ts
 */

import { db } from "./server/db";
import { sql } from "drizzle-orm";
import { fireWebhookEvent, buildCallEventData } from "./server/webhook-dispatcher";

async function main() {
  console.log("Finding Front Wave Research's most recent active call...\n");

  const r = await db.execute(sql`
    SELECT c.*, s.id AS s_id, s.name AS s_name, s.advisor_id, s.slug as s_slug,
           s.type as s_type, s.description as s_description,
           u.username as u_username, u.company_name as u_company_name
    FROM calls c
    JOIN strategies s ON s.id = c.strategy_id
    JOIN users u ON u.id = s.advisor_id
    WHERE u.id = '6a1dda4a-6bbc-4913-9657-613c952e63be'
      AND c.status = 'Active'
      AND c.is_published = true
    ORDER BY c.call_date DESC
    LIMIT 1
  `);

  const row = r.rows[0] as any;
  if (!row) {
    console.log("No active call found. Exiting.");
    process.exit(1);
  }

  console.log(`  Call ID:     ${row.id}`);
  console.log(`  Symbol:      ${row.stock_name}`);
  console.log(`  Action:      ${row.action}`);
  console.log(`  Status:      ${row.status}`);
  console.log(`  Strategy:    ${row.s_name} (slug: ${row.s_slug})`);
  console.log(`  Advisor:     ${row.u_company_name || row.u_username}`);
  console.log();

  // Build the event payload using the existing helper
  const strategy = {
    id: row.s_id,
    name: row.s_name,
    slug: row.s_slug,
    type: row.s_type,
    description: row.s_description,
    advisorId: row.advisor_id,
  };

  const data = buildCallEventData(row, strategy);

  console.log("Firing CALL_CREATED event...");
  await fireWebhookEvent("CALL_CREATED", data, row.advisor_id);

  console.log("\n✓ Event fired. Check webhook.site tab for the incoming POST.");
  console.log("  Expected delivery within 1-3 seconds.");
  console.log();
  console.log("Waiting 8s for delivery to complete + get logged in broker_webhook_logs...");
  await new Promise((r) => setTimeout(r, 8000));

  // Check broker_webhook_logs for what we just sent
  console.log("\n═══ broker_webhook_logs (last 3 rows) ═══");
  const logs = await db.execute(sql`
    SELECT l.id, l.event, l.status_code, l.delivered, l.attempt,
           l.error_message, l.created_at,
           k.broker_name, k.webhook_payload_version
    FROM broker_webhook_logs l
    JOIN broker_api_keys k ON k.id = l.api_key_id
    ORDER BY l.created_at DESC
    LIMIT 3
  `);

  for (const lr of logs.rows as any[]) {
    console.log(`  [${lr.created_at}] ${lr.broker_name} (${lr.webhook_payload_version})`);
    console.log(`    event=${lr.event} status=${lr.status_code} delivered=${lr.delivered} attempt=${lr.attempt}`);
    if (lr.error_message) console.log(`    error: ${lr.error_message}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  console.error(e.stack);
  process.exit(1);
});
