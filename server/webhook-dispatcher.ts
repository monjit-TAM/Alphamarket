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
