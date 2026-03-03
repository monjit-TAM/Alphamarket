#!/bin/bash
# ============================================================
# AlphaMarket Phase 8 Deployment Script
# Features: Webhooks, Trailing Stop Loss, Advisor Filtering
# ============================================================
set -e
echo "====================================="
echo "Phase 8: Webhooks + Trailing SL + Advisor Filtering"
echo "====================================="

# ============================================================
# STEP 1: Database Migration
# ============================================================
echo ""
echo ">>> STEP 1: Database Migration"

sudo -u postgres psql -d alphamarket_db << 'SQL'

-- 1A: Add trailing stop loss columns to calls table
ALTER TABLE calls ADD COLUMN IF NOT EXISTS trailing_sl_enabled BOOLEAN DEFAULT false;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS trailing_sl_type TEXT DEFAULT 'PERCENTAGE';
ALTER TABLE calls ADD COLUMN IF NOT EXISTS trailing_sl_value TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS trailing_sl_highest_price TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS trailing_sl_current_sl TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS trailing_sl_triggered_at TEXT;

-- 1B: Add trailing stop loss columns to positions table
ALTER TABLE positions ADD COLUMN IF NOT EXISTS trailing_sl_enabled BOOLEAN DEFAULT false;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS trailing_sl_type TEXT DEFAULT 'PERCENTAGE';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS trailing_sl_value TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS trailing_sl_highest_price TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS trailing_sl_current_sl TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS trailing_sl_triggered_at TEXT;

-- 1C: Add allowed_advisors and webhook_events to broker_api_keys
ALTER TABLE broker_api_keys ADD COLUMN IF NOT EXISTS allowed_advisors TEXT[];
ALTER TABLE broker_api_keys ADD COLUMN IF NOT EXISTS webhook_events TEXT[] DEFAULT ARRAY[
  'CALL_CREATED', 'CALL_MODIFIED', 'CALL_CLOSED',
  'TARGET_ACHIEVED', 'STOPLOSS_TRIGGERED',
  'TRAILING_SL_TRIGGERED', 'TRAILING_SL_UPDATED',
  'POSITION_CREATED', 'POSITION_MODIFIED', 'POSITION_CLOSED'
];

-- 1D: Create webhook delivery log table
CREATE TABLE IF NOT EXISTS broker_webhook_logs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  api_key_id VARCHAR REFERENCES broker_api_keys(id),
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  status_code INTEGER,
  response_body TEXT,
  attempt INTEGER DEFAULT 1,
  delivered BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  delivered_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_key_date ON broker_webhook_logs(api_key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event ON broker_webhook_logs(event);

-- Grant permissions
GRANT ALL ON TABLE broker_webhook_logs TO alphamarket_user;
GRANT ALL ON TABLE broker_api_keys TO alphamarket_user;
GRANT ALL ON TABLE broker_api_logs TO alphamarket_user;

-- Verify
SELECT 'Migration complete' AS status;
\dt broker_webhook_logs
SELECT column_name FROM information_schema.columns WHERE table_name = 'calls' AND column_name LIKE 'trailing%';
SELECT column_name FROM information_schema.columns WHERE table_name = 'broker_api_keys' AND column_name IN ('allowed_advisors', 'webhook_events');

SQL

echo ">>> Database migration complete"

# ============================================================
# STEP 2: Create webhook-dispatcher.ts
# ============================================================
echo ""
echo ">>> STEP 2: Creating webhook-dispatcher.ts"

cat > /var/www/alphamarket/server/webhook-dispatcher.ts << 'TSEOF'
import { db } from "./db";
import { sql } from "drizzle-orm";
import { createHmac } from "crypto";

interface WebhookTarget {
  api_key_id: string;
  webhook_url: string;
  api_secret: string;
  broker_name: string;
  allowed_advisors: string[] | null;
  webhook_events: string[] | null;
}

interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, any>;
  signature?: string;
}

// Retry configuration
const RETRY_DELAYS = [5000, 30000, 120000]; // 5s, 30s, 2min
const WEBHOOK_TIMEOUT = 5000; // 5 second timeout

// Queue for webhook deliveries
const webhookQueue: Array<{
  target: WebhookTarget;
  payload: WebhookPayload;
  attempt: number;
}> = [];

let isProcessing = false;

/**
 * Fire a webhook event for all subscribed brokers
 */
export async function fireWebhookEvent(
  event: string,
  data: Record<string, any>,
  advisorId?: string
) {
  try {
    // Get all active API keys with webhook URLs configured
    const result = await db.execute(sql`
      SELECT id AS api_key_id, webhook_url, api_secret, broker_name, allowed_advisors, webhook_events
      FROM broker_api_keys
      WHERE is_active = true AND webhook_url IS NOT NULL AND webhook_url != ''
    `);

    const targets = result.rows as unknown as WebhookTarget[];

    for (const target of targets) {
      // Check if broker subscribes to this event
      if (target.webhook_events && !target.webhook_events.includes(event)) {
        continue;
      }

      // Check if advisor is in broker's allowed list
      if (advisorId && target.allowed_advisors && target.allowed_advisors.length > 0) {
        if (!target.allowed_advisors.includes(advisorId)) {
          continue; // Skip - this advisor is not in broker's selected list
        }
      }

      const payload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        data: { ...data, advisorId },
      };

      // Sign the payload
      const payloadStr = JSON.stringify(payload);
      payload.signature = createHmac("sha256", target.api_secret)
        .update(payloadStr)
        .digest("hex");

      webhookQueue.push({ target, payload, attempt: 1 });
    }

    // Process queue
    processQueue();
  } catch (err) {
    console.error("[Webhook] Error firing event:", event, err);
  }
}

async function processQueue() {
  if (isProcessing || webhookQueue.length === 0) return;
  isProcessing = true;

  while (webhookQueue.length > 0) {
    const item = webhookQueue.shift()!;
    await deliverWebhook(item.target, item.payload, item.attempt);
  }

  isProcessing = false;
}

async function deliverWebhook(
  target: WebhookTarget,
  payload: WebhookPayload,
  attempt: number
) {
  const logId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
  let statusCode = 0;
  let responseBody = "";
  let delivered = false;
  let errorMessage = "";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT);

    const response = await fetch(target.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AlphaMarket-Event": payload.event,
        "X-AlphaMarket-Signature": payload.signature || "",
        "X-AlphaMarket-Timestamp": payload.timestamp,
        "User-Agent": "AlphaMarket-Webhook/1.0",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    statusCode = response.status;
    responseBody = await response.text().catch(() => "");
    delivered = statusCode >= 200 && statusCode < 300;
  } catch (err: any) {
    errorMessage = err.message || "Unknown error";
    if (err.name === "AbortError") {
      errorMessage = "Webhook request timed out (5s)";
    }
  }

  // Log the delivery attempt
  try {
    await db.execute(sql`
      INSERT INTO broker_webhook_logs (api_key_id, event, payload, status_code, response_body, attempt, delivered, error_message, delivered_at)
      VALUES (
        ${target.api_key_id},
        ${payload.event},
        ${JSON.stringify(payload)}::jsonb,
        ${statusCode},
        ${responseBody.substring(0, 500)},
        ${attempt},
        ${delivered},
        ${errorMessage || null},
        ${delivered ? new Date() : null}
      )
    `);
  } catch {}

  // Retry if failed
  if (!delivered && attempt <= RETRY_DELAYS.length) {
    const delay = RETRY_DELAYS[attempt - 1];
    console.log(
      `[Webhook] ${target.broker_name} delivery failed (attempt ${attempt}), retrying in ${delay / 1000}s...`
    );
    setTimeout(() => {
      webhookQueue.push({ target, payload, attempt: attempt + 1 });
      processQueue();
    }, delay);
  } else if (!delivered) {
    console.error(
      `[Webhook] ${target.broker_name} delivery failed after ${attempt} attempts for event ${payload.event}`
    );
  } else {
    console.log(
      `[Webhook] ${target.broker_name} delivered: ${payload.event} (${statusCode})`
    );
  }
}

/**
 * Helper to build call event data
 */
export function buildCallEventData(call: any, strategy?: any, advisor?: any) {
  return {
    uid: call.id,
    type: "EQUITY",
    symbol: call.stockName,
    strategyId: call.strategyId,
    strategyName: strategy?.name,
    advisorId: strategy?.advisorId || advisor?.id,
    advisorName: advisor?.companyName || advisor?.username,
    action: call.action,
    buyRangeStart: call.buyRangeStart,
    buyRangeEnd: call.buyRangeEnd,
    targetPrice: call.targetPrice,
    stopLoss: call.stopLoss,
    entryPrice: call.entryPrice,
    sellPrice: call.sellPrice,
    exitDate: call.exitDate,
    rationale: call.rationale,
    duration: call.duration,
    theme: call.theme,
    gainOrLossPercentage: call.gainPercent,
    trailingStopLoss: call.trailing_sl_enabled
      ? {
          enabled: true,
          type: call.trailing_sl_type,
          value: call.trailing_sl_value,
          currentSL: call.trailing_sl_current_sl,
          highestPrice: call.trailing_sl_highest_price,
          triggeredAt: call.trailing_sl_triggered_at,
        }
      : { enabled: false },
    status: call.status === "Active" ? "ACTIVE" : "CLOSED",
    publishMode: call.publishMode,
  };
}

/**
 * Helper to build position event data
 */
export function buildPositionEventData(position: any, strategy?: any, advisor?: any) {
  return {
    uid: position.id,
    type: position.segment || "FnO",
    symbol: position.symbol,
    strategyId: position.strategyId,
    strategyName: strategy?.name,
    advisorId: strategy?.advisorId || advisor?.id,
    advisorName: advisor?.companyName || advisor?.username,
    segment: position.segment,
    callPut: position.callPut,
    buySell: position.buySell,
    expiry: position.expiry,
    strikePrice: position.strikePrice,
    entryPrice: position.entryPrice,
    lots: position.lots,
    target: position.target,
    stopLoss: position.stopLoss,
    exitPrice: position.exitPrice,
    exitDate: position.exitDate,
    rationale: position.rationale,
    trailingStopLoss: position.trailing_sl_enabled
      ? {
          enabled: true,
          type: position.trailing_sl_type,
          value: position.trailing_sl_value,
          currentSL: position.trailing_sl_current_sl,
          highestPrice: position.trailing_sl_highest_price,
          triggeredAt: position.trailing_sl_triggered_at,
        }
      : { enabled: false },
    status: position.status === "Active" ? "ACTIVE" : "CLOSED",
  };
}

console.log("[Webhook] Dispatcher initialized");
TSEOF

echo ">>> webhook-dispatcher.ts created ($(wc -l < /var/www/alphamarket/server/webhook-dispatcher.ts) lines)"

# ============================================================
# STEP 3: Patch broker-api.ts to add webhook triggers,
#          trailing SL fields, and advisor filtering
# ============================================================
echo ""
echo ">>> STEP 3: Patching broker-api.ts"

python3 << 'PYEOF'
import re

with open("/var/www/alphamarket/server/broker-api.ts", "r") as f:
    content = f.read()

# 3A: Add webhook import at top
old_import = 'import { createHmac, timingSafeEqual } from "crypto";'
new_import = '''import { createHmac, timingSafeEqual } from "crypto";
import { fireWebhookEvent, buildCallEventData, buildPositionEventData } from "./webhook-dispatcher";'''

if "fireWebhookEvent" not in content:
    content = content.replace(old_import, new_import)
    print("  Added webhook imports")

# 3B: Add allowed_advisors to BrokerApiKey interface
old_iface = "  expires_at: Date | null;\n}"
new_iface = """  expires_at: Date | null;
  allowed_advisors: string[] | null;
  webhook_events: string[] | null;
}"""
if "allowed_advisors" not in content:
    content = content.replace(old_iface, new_iface, 1)
    print("  Added allowed_advisors to interface")

# 3C: Add trailing SL to call creation
old_create_call = '''const call = await storage.createCall({
        strategyId, stockName: symbol, action: callType || "Buy",
        buyRangeStart: buyPriceRangeStart?.toString() || buyPrice?.toString() || null,
        buyRangeEnd: buyPriceRangeEnd?.toString() || buyPrice?.toString() || null,
        targetPrice: targetPriceRange?.toString() || null, profitGoal: profitGoal?.toString() || null,
        stopLoss: stopLoss?.toString() || null, rationale: rational || null,
        entryPrice: buyPrice?.toString() || null,
        status: "Active", isPublished: true, publishMode: "live", theme: callType || null,
      });
      res.status(201).json({ uid: call.id, type: "CALL", status: "CREATED" });'''

new_create_call = '''const { trailingStopLoss } = req.body;
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
      res.status(201).json({ uid: call.id, type: "CALL", status: "CREATED" });'''

if "trailingStopLoss" not in content or "CALL_CREATED" not in content:
    content = content.replace(old_create_call, new_create_call)
    print("  Added trailing SL to call creation + webhook")

# 3D: Add trailing SL to position creation
old_create_pos = '''return res.status(201).json({ uid: position.id, type: "POSITION", status: "CREATED" });'''
new_create_pos = '''// Fire webhook
        fireWebhookEvent("POSITION_CREATED", buildPositionEventData(position, strategy), strategy.advisorId).catch(() => {});
        return res.status(201).json({ uid: position.id, type: "POSITION", status: "CREATED" });'''

if "POSITION_CREATED" not in content:
    content = content.replace(old_create_pos, new_create_pos)
    print("  Added webhook to position creation")

# 3E: Add webhook to call update
old_call_update = '''const updated = await storage.updateCall(callId, updateData);
        return res.json({ uid: updated.id, type: "CALL", status: "UPDATED" });'''
new_call_update = '''const updated = await storage.updateCall(callId, updateData);
        const evtType = updateData.status === "Closed" ? "CALL_CLOSED" : "CALL_MODIFIED";
        fireWebhookEvent(evtType, buildCallEventData({ ...call, ...updateData }), call.strategyId).catch(() => {});
        return res.json({ uid: updated.id, type: "CALL", status: "UPDATED" });'''

if "CALL_CLOSED" not in content:
    content = content.replace(old_call_update, new_call_update)
    print("  Added webhook to call update")

# 3F: Add webhook to position update
old_pos_update = '''const updated = await storage.updatePosition(callId, updateData);
        return res.json({ uid: updated.id, type: "POSITION", status: "UPDATED" });'''
new_pos_update = '''const updated = await storage.updatePosition(callId, updateData);
        const posEvtType = updateData.status === "Closed" ? "POSITION_CLOSED" : "POSITION_MODIFIED";
        fireWebhookEvent(posEvtType, buildPositionEventData({ ...position, ...updateData }), position.strategyId).catch(() => {});
        return res.json({ uid: updated.id, type: "POSITION", status: "UPDATED" });'''

if "POSITION_CLOSED" not in content:
    content = content.replace(old_pos_update, new_pos_update)
    print("  Added webhook to position update")

# 3G: Add advisor filtering to live-calls endpoint
old_live = '''const filtered = type ? results.filter(r => r.type === type) : results;
      res.json({ data: filtered, total: filtered.length });'''
new_live = '''let filtered = type ? results.filter(r => r.type === type) : results;
      // Filter by allowed advisors if configured on API key
      if (req.broker?.allowed_advisors && req.broker.allowed_advisors.length > 0) {
        const allowedSet = new Set(req.broker.allowed_advisors);
        filtered = filtered.filter(r => {
          const advId = (r as any).advisorId;
          return !advId || allowedSet.has(advId);
        });
      }
      res.json({ data: filtered, total: filtered.length });'''

if "allowed_advisors" not in content or "allowedSet" not in content:
    content = content.replace(old_live, new_live)
    print("  Added advisor filtering to live-calls")

# 3H: Add trailing SL data to live-calls response
old_equity_map = '''status: "ACTIVE",
        })),'''
new_equity_map = '''trailingStopLoss: c.trailing_sl_enabled ? {
            enabled: true, type: c.trailing_sl_type, value: c.trailing_sl_value,
            currentSL: c.trailing_sl_current_sl, highestPrice: c.trailing_sl_highest_price
          } : { enabled: false },
          status: "ACTIVE",
        })),'''

# Only replace in the live-calls section - find the right occurrence
# This is the activeCalls.map section
if "trailingStopLoss: c.trailing_sl_enabled" not in content:
    # Replace the first occurrence after "LIVE CALLS" comment
    live_calls_idx = content.find("LIVE CALLS")
    if live_calls_idx > 0:
        rest = content[live_calls_idx:]
        first_status = rest.find('status: "ACTIVE",\n        })),')
        if first_status > 0:
            before = content[:live_calls_idx + first_status]
            after = content[live_calls_idx + first_status + len(old_equity_map):]
            content = before + new_equity_map + after
            print("  Added trailing SL to live-calls equity response")

# 3I: Add webhook admin endpoints
old_admin_log = '''  console.log("Broker API v1 routes registered at /api/v1/alpha/*");'''
new_admin_log = '''  // Webhook logs endpoint
  app.get(prefix + "/alpha/webhook-logs", requirePermission("admin") as any, async (req: BrokerRequest, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
      const result = await db.execute(sql\`SELECT w.*, k.broker_name FROM broker_webhook_logs w LEFT JOIN broker_api_keys k ON w.api_key_id = k.id ORDER BY w.created_at DESC LIMIT \${limit}\`);
      res.json({ data: result.rows });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Set allowed advisors for a broker API key
  app.put(prefix + "/alpha/api-keys/:keyId/advisors", requirePermission("admin") as any, async (req: BrokerRequest, res) => {
    try {
      const { advisorIds } = req.body;
      if (!Array.isArray(advisorIds)) return res.status(400).json({ error: "advisorIds must be an array" });
      await db.execute(sql\`UPDATE broker_api_keys SET allowed_advisors = \${advisorIds} WHERE id = \${req.params.keyId}\`);
      res.json({ status: "UPDATED", allowedAdvisors: advisorIds });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Set webhook URL for a broker API key
  app.put(prefix + "/alpha/api-keys/:keyId/webhook", requirePermission("admin") as any, async (req: BrokerRequest, res) => {
    try {
      const { webhookUrl, events } = req.body;
      if (webhookUrl) {
        await db.execute(sql\`UPDATE broker_api_keys SET webhook_url = \${webhookUrl} WHERE id = \${req.params.keyId}\`);
      }
      if (events && Array.isArray(events)) {
        await db.execute(sql\`UPDATE broker_api_keys SET webhook_events = \${events} WHERE id = \${req.params.keyId}\`);
      }
      res.json({ status: "UPDATED", webhookUrl, events });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  console.log("Broker API v1 routes registered at /api/v1/alpha/*");'''

if "webhook-logs" not in content:
    content = content.replace(old_admin_log, new_admin_log)
    print("  Added webhook admin endpoints")

with open("/var/www/alphamarket/server/broker-api.ts", "w") as f:
    f.write(content)

print(f"  broker-api.ts patched ({len(content.splitlines())} lines)")
PYEOF

echo ">>> broker-api.ts patched"

# ============================================================
# STEP 4: Patch schema.ts to add trailing SL fields
# ============================================================
echo ""
echo ">>> STEP 4: Patching schema.ts for trailing SL fields"

python3 << 'PYEOF'
schema_path = "/var/www/alphamarket/shared/schema.ts"
with open(schema_path, "r") as f:
    content = f.read()

# Check if trailing_sl_enabled already exists
if "trailing_sl_enabled" in content:
    print("  Schema already has trailing SL fields, skipping")
else:
    # Find the calls table definition and add trailing SL columns
    # Look for the last column before the closing of calls table
    # Pattern: find "calls" table and add columns
    
    # Add to calls table - find the line with stopLoss in the calls table context
    # We need to be careful to add after the right table
    
    call_trailing = '''  trailing_sl_enabled: boolean("trailing_sl_enabled").default(false),
  trailing_sl_type: text("trailing_sl_type").default("PERCENTAGE"),
  trailing_sl_value: text("trailing_sl_value"),
  trailing_sl_highest_price: text("trailing_sl_highest_price"),
  trailing_sl_current_sl: text("trailing_sl_current_sl"),
  trailing_sl_triggered_at: text("trailing_sl_triggered_at"),'''
    
    # Find "calls" table - look for createTable("calls" or pgTable("calls"
    import re
    
    # Try to find the calls table and add before its closing });
    # This is tricky without knowing exact format - let's try a safe approach
    # Search for "publishMode" in calls context (it's one of the last fields)
    
    # Find calls table section
    calls_match = re.search(r'(export const calls\s*=\s*\w+\(["\']calls["\'])', content)
    if calls_match:
        # Find the next }); after this
        start = calls_match.start()
        # Find publishMode or the last field before });
        publish_idx = content.find("publishMode", start)
        if publish_idx > 0:
            # Find the end of that line (the comma and newline)
            line_end = content.find("\n", publish_idx)
            if line_end > 0:
                content = content[:line_end+1] + call_trailing + "\n" + content[line_end+1:]
                print("  Added trailing SL fields to calls table")
    
    # Do the same for positions table
    pos_match = re.search(r'(export const positions\s*=\s*\w+\(["\']positions["\'])', content)
    if pos_match:
        start = pos_match.start()
        publish_idx = content.find("publishMode", start + 1) if content.find("publishMode", start + 1) > 0 else content.find("rationale", start)
        if publish_idx > start:
            line_end = content.find("\n", publish_idx)
            if line_end > 0:
                pos_trailing = call_trailing.replace("trailing_sl", "trailing_sl")  # same fields
                content = content[:line_end+1] + pos_trailing + "\n" + content[line_end+1:]
                print("  Added trailing SL fields to positions table")
    
    with open(schema_path, "w") as f:
        f.write(content)

PYEOF

echo ">>> Schema patched"

# ============================================================
# STEP 5: Build and restart
# ============================================================
echo ""
echo ">>> STEP 5: Building and restarting"

cd /var/www/alphamarket
npm run build 2>&1 | tail -10

pm2 delete alphamarket 2>/dev/null || true
pm2 start ecosystem.config.cjs
sleep 3

# ============================================================
# STEP 6: Test everything
# ============================================================
echo ""
echo ">>> STEP 6: Testing"

API_KEY="amk_live_f387ae19154f71a6a95262dadd07184d6ee1115129987f5e"

echo "--- Health Check ---"
curl -k https://alphamarket.co.in/api/v1/health 2>/dev/null | python3 -m json.tool

echo ""
echo "--- Advisors ---"
curl -k -H "x-api-key: $API_KEY" https://alphamarket.co.in/api/v1/alpha/advisor 2>/dev/null | python3 -m json.tool | head -10

echo ""
echo "--- Live Calls ---"
curl -k -H "x-api-key: $API_KEY" https://alphamarket.co.in/api/v1/alpha/live-calls 2>/dev/null | python3 -m json.tool | head -10

echo ""
echo "--- Webhook Logs ---"
curl -k -H "x-api-key: $API_KEY" https://alphamarket.co.in/api/v1/alpha/webhook-logs 2>/dev/null | python3 -m json.tool | head -5

echo ""
echo "--- Check trailing SL columns ---"
sudo -u postgres psql -d alphamarket_db -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'calls' AND column_name LIKE 'trailing%' ORDER BY ordinal_position;"

echo ""
echo "====================================="
echo "Phase 8 Deployment Complete!"
echo ""
echo "New Features:"
echo "  1. Trailing Stop Loss - DB columns added to calls & positions"
echo "  2. Webhooks - Dispatcher fires events to broker webhook URLs"
echo "  3. Advisor Filtering - allowed_advisors on API keys"
echo "  4. Admin endpoints:"
echo "     PUT /api/v1/alpha/api-keys/:keyId/advisors"
echo "     PUT /api/v1/alpha/api-keys/:keyId/webhook"
echo "     GET /api/v1/alpha/webhook-logs"
echo ""
echo "Next: Set webhook URL for Paytm Money:"
echo "  curl -k -X PUT -H 'x-api-key: $API_KEY' -H 'Content-Type: application/json' \\"
echo "    -d '{\"webhookUrl\": \"https://api.paytmmoney.com/webhook/alphamarket\"}' \\"
echo "    https://alphamarket.co.in/api/v1/alpha/api-keys/b720beb6-8968-4606-a8d9-fc84a7150723/webhook"
echo ""
echo "Set allowed advisors:"
echo "  curl -k -X PUT -H 'x-api-key: $API_KEY' -H 'Content-Type: application/json' \\"
echo "    -d '{\"advisorIds\": [\"advisor-id-1\", \"advisor-id-2\"]}' \\"
echo "    https://alphamarket.co.in/api/v1/alpha/api-keys/b720beb6-8968-4606-a8d9-fc84a7150723/advisors"
echo "====================================="
