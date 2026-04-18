import { db } from "./db";
import { sql } from "drizzle-orm";
import { createHmac } from "crypto";
import { handleXTSEvent } from "./xts-bridge";
import { handleBrokerEvent } from "./broker-integrations";
import { buildFormatAPayload, inferSegment } from "./webhook-format-a";

interface WebhookTarget {
  api_key_id: string;
  webhook_url: string;
  api_secret: string;
  broker_name: string;
  allowed_advisors: string[] | null;
  webhook_events: string[] | null;
  webhook_payload_version: string | null;
  allowed_segments: string[] | null;
  allowed_strategies: string[] | null;
  webhook_timeout_ms: number | null;
}

interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, any>;
  signature?: string;
}

// Retry configuration
const RETRY_DELAYS = [5000, 30000, 120000]; // 5s, 30s, 2min
const WEBHOOK_TIMEOUT_DEFAULT = 10000; // 10 second default; per-broker override via webhook_timeout_ms

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
      SELECT id AS api_key_id, webhook_url, api_secret, broker_name, allowed_advisors, webhook_events,
             webhook_payload_version, allowed_segments, allowed_strategies, webhook_timeout_ms
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
          continue; // Skip - advisor not in broker's selected list
        }
      }

      // Segment filter (allowed_segments) — e.g. Dreamstreet wants equity only
      if (target.allowed_segments && target.allowed_segments.length > 0) {
        const seg = inferSegment(event, data);
        if (seg && !target.allowed_segments.includes(seg)) {
          continue; // Skip - segment not allowed for this broker
        }
      }

      // Strategy filter (allowed_strategies) — fine-grained per-strategy opt-in
      if (target.allowed_strategies && target.allowed_strategies.length > 0) {
        const sid = (data as any).strategyId || (data as any).strategy_id;
        if (sid && !target.allowed_strategies.includes(sid)) {
          continue; // Skip - strategy not in broker's allowed list
        }
      }

      // Build payload — version-aware
      const payloadVersion = target.webhook_payload_version || 'v1_flat';
      let payloadBody: any;

      try {
        if (payloadVersion === 'v1_thealphamarket') {
          // Format A — matches thealphamarket.com webhook shape exactly
          payloadBody = await buildFormatAPayload(event, { ...data, advisorId });
        } else {
          // Default v1_flat — current simple shape
          payloadBody = {
            event,
            timestamp: new Date().toISOString(),
            data: { ...data, advisorId },
          };
        }
      } catch (buildErr: any) {
        console.error(`[Webhook] Payload build failed for ${target.broker_name} (${payloadVersion}):`, buildErr.message);
        continue; // Skip this target — don't block other deliveries
      }

      // Sign
      const payloadStr = JSON.stringify(payloadBody);
      const signature = createHmac("sha256", target.api_secret)
        .update(payloadStr)
        .digest("hex");

      // Attach signature in a way that doesn't mutate the canonical body used for verification.
      // We store it on the wrapper so the deliverWebhook function can send it as header.
      webhookQueue.push({ target, payload: { ...payloadBody, __signature: signature, __event: event } as any, attempt: 1 });
    }

    // Process queue
    processQueue();

    // XTS Bridge — fire in parallel, never blocks webhook delivery
    handleXTSEvent(event, data, advisorId || "").catch((err) => console.error("[XTS Bridge] Unhandled:", err));
    handleBrokerEvent(event as any, data, advisorId || "").catch((err) => console.error("[broker-dispatch] Unhandled:", err));
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
  const timeoutMs = (target as any).webhook_timeout_ms || WEBHOOK_TIMEOUT_DEFAULT;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(target.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AlphaMarket-Event": (payload as any).__event || (payload as any).event || "",
        "X-AlphaMarket-Signature": "sha256=" + ((payload as any).__signature || ""),
        "X-AlphaMarket-Timestamp": String(Math.floor(Date.now() / 1000)),
        "X-AlphaMarket-Event-Id": (payload as any).__event_id || ((payload as any).messageId) || (payload as any).__event || "",
        "User-Agent": "AlphaMarket-Webhook/1.0",
      },
      body: (() => {
        const clean = { ...(payload as any) };
        delete clean.__signature;
        delete clean.__event;
        delete clean.__event_id;
        return JSON.stringify(clean);
      })(),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    statusCode = response.status;
    responseBody = await response.text().catch(() => "");
    delivered = statusCode >= 200 && statusCode < 300;
  } catch (err: any) {
    errorMessage = err.message || "Unknown error";
    if (err.name === "AbortError") {
      errorMessage = `Webhook request timed out (${timeoutMs}ms)`;
    }
  }

  // Log the delivery attempt
  try {
    await db.execute(sql`
      INSERT INTO broker_webhook_logs (api_key_id, event, payload, status_code, response_body, attempt, delivered, error_message, delivered_at)
      VALUES (
        ${target.api_key_id},
        ${(payload as any).__event || (payload as any).event || 'UNKNOWN'},
        ${JSON.stringify((() => { const c = { ...(payload as any) }; delete c.__event; delete c.__event_id; delete c.__signature; return c; })())}::jsonb,
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
      `[Webhook] ${target.broker_name} delivery failed after ${attempt} attempts for event ${(payload as any).__event || "UNKNOWN"}`
    );
  } else {
    console.log(
      `[Webhook] ${target.broker_name} delivered: ${(payload as any).__event || "UNKNOWN"} (${statusCode})`
    );
  }
}

/**
 * Helper to build call event data
 */
export function buildCallEventData(call: any, strategy?: any, advisor?: any) {
  // Defensive: handle both Drizzle (camelCase) and raw SQL (snake_case) inputs.
  // Without this, raw SQL callers silently produce undefined fields.
  const c = call || {};
  return {
    uid: c.id,
    type: "EQUITY",
    symbol: c.stockName ?? c.stock_name,
    strategyId: c.strategyId ?? c.strategy_id,
    strategyName: strategy?.name,
    advisorId: strategy?.advisorId ?? strategy?.advisor_id ?? advisor?.id,
    advisorName: advisor?.companyName ?? advisor?.company_name ?? advisor?.username,
    action: c.action,
    buyRangeStart: c.buyRangeStart ?? c.buy_range_start,
    buyRangeEnd: c.buyRangeEnd ?? c.buy_range_end,
    targetPrice: c.targetPrice ?? c.target_price,
    stopLoss: c.stopLoss ?? c.stop_loss,
    entryPrice: c.entryPrice ?? c.entry_price,
    sellPrice: c.sellPrice ?? c.sell_price,
    exitDate: c.exitDate ?? c.exit_date,
    rationale: c.rationale,
    duration: c.duration,
    theme: c.theme,
    gainOrLossPercentage: c.gainPercent ?? c.gain_percent,
    trailingStopLoss: (c.trailing_sl_enabled ?? c.trailingSlEnabled)
      ? {
          enabled: true,
          type: c.trailing_sl_type ?? c.trailingSlType,
          value: c.trailing_sl_value ?? c.trailingSlValue,
          currentSL: c.trailing_sl_current_sl ?? c.trailingSlCurrentSl,
          highestPrice: c.trailing_sl_highest_price ?? c.trailingSlHighestPrice,
          triggeredAt: c.trailing_sl_triggered_at ?? c.trailingSlTriggeredAt,
        }
      : { enabled: false },
    status: c.status === "Active" ? "ACTIVE" : "CLOSED",
    publishMode: c.publishMode ?? c.publish_mode,
  };
}

/**
 * Helper to build position event data
 */
export function buildPositionEventData(position: any, strategy?: any, advisor?: any) {
  // Defensive: handle both Drizzle (camelCase) and raw SQL (snake_case) inputs.
  const p = position || {};
  return {
    uid: p.id,
    type: p.segment || "FnO",
    symbol: p.symbol,
    strategyId: p.strategyId ?? p.strategy_id,
    strategyName: strategy?.name,
    advisorId: strategy?.advisorId ?? strategy?.advisor_id ?? advisor?.id,
    advisorName: advisor?.companyName ?? advisor?.company_name ?? advisor?.username,
    segment: p.segment,
    callPut: p.callPut ?? p.call_put,
    buySell: p.buySell ?? p.buy_sell,
    expiry: p.expiry,
    strikePrice: p.strikePrice ?? p.strike_price,
    entryPrice: p.entryPrice ?? p.entry_price,
    lots: p.lots,
    target: p.target,
    stopLoss: p.stopLoss ?? p.stop_loss,
    exitPrice: p.exitPrice ?? p.exit_price,
    exitDate: p.exitDate ?? p.exit_date,
    rationale: p.rationale,
    trailingStopLoss: (p.trailing_sl_enabled ?? p.trailingSlEnabled)
      ? {
          enabled: true,
          type: p.trailing_sl_type ?? p.trailingSlType,
          value: p.trailing_sl_value ?? p.trailingSlValue,
          currentSL: p.trailing_sl_current_sl ?? p.trailingSlCurrentSl,
          highestPrice: p.trailing_sl_highest_price ?? p.trailingSlHighestPrice,
          triggeredAt: p.trailing_sl_triggered_at ?? p.trailingSlTriggeredAt,
        }
      : { enabled: false },
    status: p.status === "Active" ? "ACTIVE" : "CLOSED",
  };
}

console.log("[Webhook] Dispatcher initialized");
