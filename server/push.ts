import webpush from "web-push";
import { storage } from "./storage";
import type { PushSubscription as DBPushSubscription } from "@shared/schema";

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@alphamarket.com";
let pushEnabled = false;

if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    pushEnabled = true;
    console.log("[Push] Web push notifications configured successfully");
  } catch (err) {
    console.error("[Push] Failed to configure VAPID:", err);
  }
} else {
  console.warn("[Push] VAPID keys not configured - push notifications disabled");
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  data?: Record<string, any>;
}

const DISCLAIMER = "Disclaimer: Investment in securities market are subject to market risks. Read all the related documents carefully before investing.";

function formatDateTime(): string {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

async function sendToSubscriptions(subs: DBPushSubscription[], payload: PushPayload): Promise<void> {
  if (!pushEnabled || subs.length === 0) return;
  const jsonPayload = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          jsonPayload
        );
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await storage.deletePushSubscription(sub.endpoint);
        }
        throw err;
      }
    })
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.log(`Push notifications: ${results.length - failed} sent, ${failed} failed/expired`);
  }
}

export async function notifyStrategySubscribers(
  strategyId: string,
  strategyName: string,
  type: string,
  payload: PushPayload
): Promise<void> {
  try {
    await storage.createNotification({
      type,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      targetScope: "strategy_subscribers",
      strategyId,
    });

    const activeSubs = await storage.getActiveSubscriptionsByStrategy(strategyId);
    const userIds = Array.from(new Set(activeSubs.map((s) => s.userId)));
    const pushSubs = await storage.getPushSubscriptionsForUserIds(userIds);
    if (pushSubs.length > 0) {
      await sendToSubscriptions(pushSubs, payload);
    }
  } catch (err) {
    console.error("Error sending strategy notifications:", err);
  }
}

export async function notifyWatchlistUsers(
  strategyId: string,
  strategyName: string,
  type: string,
  payload: PushPayload
): Promise<void> {
  try {
    await storage.createNotification({
      type,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      targetScope: "strategy_watchlist",
      strategyId,
    });

    const activeSubs = await storage.getActiveSubscriptionsByStrategy(strategyId);
    const subscriberIds = Array.from(new Set(activeSubs.map((s) => s.userId)));
    const watchlistUserIds = await storage.getWatchlistUserIdsForStrategy(strategyId, subscriberIds);
    if (watchlistUserIds.length > 0) {
      const pushSubs = await storage.getPushSubscriptionsForUserIds(watchlistUserIds);
      if (pushSubs.length > 0) {
        await sendToSubscriptions(pushSubs, payload);
      }
    }
  } catch (err) {
    console.error("Error sending watchlist notifications:", err);
  }
}

function buildFnOLabel(item: { symbol?: string | null; segment?: string | null; callPut?: string | null; strikePrice?: string | number | null; expiry?: string | null; buySell?: string | null }): string {
  const parts: string[] = [];
  if (item.symbol) parts.push(item.symbol);
  if (item.segment === "F&O" || item.segment === "Options" || item.segment === "Futures") {
    if (item.callPut) parts.push(item.callPut);
    if (item.strikePrice) parts.push(`Strike: ${item.strikePrice}`);
    if (item.expiry) parts.push(`Exp: ${item.expiry}`);
  }
  return parts.join(" | ") || item.segment || "Position";
}

export function buildNewCallSubscriberNotification(
  call: { stockName: string; action: string; buyRangeStart?: string | null; buyRangeEnd?: string | null; entryPrice?: string | null; targetPrice?: string | null; stopLoss?: string | null; profitGoal?: string | null; rationale?: string | null; id: string; strategyId: string },
  strategyName: string
): PushPayload {
  const dt = formatDateTime();
  const buyZone = call.buyRangeStart && call.buyRangeEnd
    ? `Buy Zone: ₹${call.buyRangeStart} - ₹${call.buyRangeEnd}`
    : call.entryPrice ? `Buy Price: ₹${call.entryPrice}` : "";
  const target = call.targetPrice ? `Target: ₹${call.targetPrice}` : "";
  const sl = call.stopLoss ? `Stop Loss: ₹${call.stopLoss}` : "";
  const rationale = call.rationale ? `\nRationale: ${call.rationale.substring(0, 100)}${call.rationale.length > 100 ? "..." : ""}` : "";
  const lines = [`${call.action} ${call.stockName}`, buyZone, target, sl].filter(Boolean);
  return {
    title: `📈 New Call: ${call.stockName} - ${strategyName}`,
    body: `${lines.join(" | ")}${rationale}\n\n${dt}\n${DISCLAIMER}`,
    tag: `call-${call.id}`,
    url: `/strategies/${call.strategyId}`,
    data: { strategyId: call.strategyId, callId: call.id, type: "new_call" },
  };
}

export function buildNewCallWatchlistNotification(
  call: { profitGoal?: string | null; targetPrice?: string | null; entryPrice?: string | null; buyRangeStart?: string | null; id: string; strategyId: string },
  strategyName: string
): PushPayload {
  const dt = formatDateTime();
  let upsideText = "";
  const profitGoal = call.profitGoal ? Number(call.profitGoal) : null;
  if (profitGoal) {
    upsideText = `Potential upside: ${profitGoal}%`;
  } else if (call.targetPrice && (call.entryPrice || call.buyRangeStart)) {
    const entry = Number(call.entryPrice || call.buyRangeStart || 0);
    const target = Number(call.targetPrice);
    if (entry > 0) {
      const pct = (((target - entry) / entry) * 100).toFixed(1);
      upsideText = `Potential upside: ${pct}%`;
    }
  }
  return {
    title: `🔔 New Call Added - ${strategyName}`,
    body: `A new investment call has been published with ${upsideText || "attractive potential"}.\n\n👉 Subscribe to reveal stock name, buy price & target.\n\n${dt}\n${DISCLAIMER}`,
    tag: `wl-call-${call.id}`,
    url: `/strategies/${call.strategyId}`,
    data: { strategyId: call.strategyId, callId: call.id, type: "new_call_masked" },
  };
}

export function buildNewPositionSubscriberNotification(
  pos: { symbol?: string | null; segment?: string | null; callPut?: string | null; strikePrice?: string | number | null; expiry?: string | null; buySell?: string | null; entryPrice?: string | number | null; target?: string | number | null; stopLoss?: string | number | null; rationale?: string | null; id: string; strategyId: string },
  strategyName: string
): PushPayload {
  const dt = formatDateTime();
  const label = buildFnOLabel(pos);
  const entry = pos.entryPrice ? `Entry: ₹${pos.entryPrice}` : "";
  const target = pos.target ? `Target: ₹${pos.target}` : "";
  const sl = pos.stopLoss ? `Stop Loss: ₹${pos.stopLoss}` : "";
  const rationale = pos.rationale ? `\nRationale: ${pos.rationale.substring(0, 100)}${pos.rationale.length > 100 ? "..." : ""}` : "";
  const lines = [`${pos.buySell || "Buy"} ${label}`, entry, target, sl].filter(Boolean);
  return {
    title: `📈 New Position: ${label} - ${strategyName}`,
    body: `${lines.join(" | ")}${rationale}\n\n${dt}\n${DISCLAIMER}`,
    tag: `position-${pos.id}`,
    url: `/strategies/${pos.strategyId}`,
    data: { strategyId: pos.strategyId, positionId: pos.id, type: "new_position" },
  };
}

export function buildNewPositionWatchlistNotification(
  pos: { target?: string | number | null; entryPrice?: string | number | null; id: string; strategyId: string },
  strategyName: string
): PushPayload {
  const dt = formatDateTime();
  let upsideText = "";
  if (pos.target && pos.entryPrice) {
    const entry = Number(pos.entryPrice);
    const target = Number(pos.target);
    if (entry > 0) {
      const pct = (((target - entry) / entry) * 100).toFixed(1);
      upsideText = `Potential upside: ${pct}%`;
    }
  }
  return {
    title: `🔔 New Position Added - ${strategyName}`,
    body: `A new position has been added with ${upsideText || "attractive potential"}.\n\n👉 Subscribe to reveal stock name, entry & target details.\n\n${dt}\n${DISCLAIMER}`,
    tag: `wl-position-${pos.id}`,
    url: `/strategies/${pos.strategyId}`,
    data: { strategyId: pos.strategyId, positionId: pos.id, type: "new_position_masked" },
  };
}

export function buildCallClosedSubscriberNotification(
  call: { stockName: string; action: string; entryPrice?: string | null; buyRangeStart?: string | null; id: string; strategyId: string },
  exitPrice: number,
  gainPercent: string,
  reason: string | undefined,
  strategyName: string
): PushPayload {
  const dt = formatDateTime();
  const gain = Number(gainPercent);
  const resultLabel = gain >= 0 ? "✅ Profit" : "❌ Loss";
  const reasonText = reason ? `\nExit Rationale: ${reason.substring(0, 100)}${reason.length > 100 ? "..." : ""}` : "";
  return {
    title: `${resultLabel}: ${call.stockName} - ${strategyName}`,
    body: `${call.stockName} | Exit Price: ₹${exitPrice} | ${gain >= 0 ? "Gain" : "Loss"}: ${Math.abs(gain)}%${reasonText}\n\n${dt}\n${DISCLAIMER}`,
    tag: `call-close-${call.id}`,
    url: `/strategies/${call.strategyId}`,
    data: { strategyId: call.strategyId, callId: call.id, type: "call_closed" },
  };
}

export function buildCallClosedWatchlistNotification(
  call: { id: string; strategyId: string },
  gainPercent: string,
  strategyName: string
): PushPayload {
  const dt = formatDateTime();
  const gain = Number(gainPercent);
  const resultLabel = gain >= 0 ? "Closed in Profit" : "Closed in Loss";
  return {
    title: `🔔 Call ${resultLabel} - ${strategyName}`,
    body: `A call has been closed with ${Math.abs(gain)}% ${gain >= 0 ? "profit" : "loss"}.\n\n👉 Subscribe to reveal stock name, entry & exit details.\n\n${dt}\n${DISCLAIMER}`,
    tag: `wl-call-close-${call.id}`,
    url: `/strategies/${call.strategyId}`,
    data: { strategyId: call.strategyId, callId: call.id, type: "call_closed_masked" },
  };
}

export function buildPositionClosedSubscriberNotification(
  pos: { symbol?: string | null; segment?: string | null; callPut?: string | null; strikePrice?: string | number | null; expiry?: string | null; buySell?: string | null; id: string; strategyId: string },
  exitPrice: number,
  gainPercent: string,
  strategyName: string
): PushPayload {
  const dt = formatDateTime();
  const label = buildFnOLabel(pos);
  const gain = Number(gainPercent);
  const resultLabel = gain >= 0 ? "✅ Profit" : "❌ Loss";
  return {
    title: `${resultLabel}: ${label} - ${strategyName}`,
    body: `${label} | Exit Price: ₹${exitPrice} | ${gain >= 0 ? "Gain" : "Loss"}: ${Math.abs(gain)}%\n\n${dt}\n${DISCLAIMER}`,
    tag: `position-close-${pos.id}`,
    url: `/strategies/${pos.strategyId}`,
    data: { strategyId: pos.strategyId, positionId: pos.id, type: "position_closed" },
  };
}

export function buildPositionClosedWatchlistNotification(
  pos: { id: string; strategyId: string },
  gainPercent: string,
  strategyName: string
): PushPayload {
  const dt = formatDateTime();
  const gain = Number(gainPercent);
  const resultLabel = gain >= 0 ? "Closed in Profit" : "Closed in Loss";
  return {
    title: `🔔 Position ${resultLabel} - ${strategyName}`,
    body: `A position has been closed with ${Math.abs(gain)}% ${gain >= 0 ? "profit" : "loss"}.\n\n👉 Subscribe to reveal stock name, entry & exit details.\n\n${dt}\n${DISCLAIMER}`,
    tag: `wl-position-close-${pos.id}`,
    url: `/strategies/${pos.strategyId}`,
    data: { strategyId: pos.strategyId, positionId: pos.id, type: "position_closed_masked" },
  };
}

export function buildCallUpdateSubscriberNotification(
  call: { stockName: string; id: string; strategyId: string },
  changes: string[],
  strategyName: string
): PushPayload {
  const dt = formatDateTime();
  return {
    title: `⚠️ Alert: ${call.stockName} Updated - ${strategyName}`,
    body: `${call.stockName} | ${changes.join(", ")}\n\n${dt}\n${DISCLAIMER}`,
    tag: `call-update-${call.id}`,
    url: `/strategies/${call.strategyId}`,
    data: { strategyId: call.strategyId, callId: call.id, type: "call_update" },
  };
}

export function buildPositionUpdateSubscriberNotification(
  pos: { symbol?: string | null; segment?: string | null; callPut?: string | null; strikePrice?: string | number | null; expiry?: string | null; id: string; strategyId: string },
  changes: string[],
  strategyName: string
): PushPayload {
  const dt = formatDateTime();
  const label = buildFnOLabel(pos);
  return {
    title: `⚠️ Alert: ${label} Updated - ${strategyName}`,
    body: `${label} | ${changes.join(", ")}\n\n${dt}\n${DISCLAIMER}`,
    tag: `position-update-${pos.id}`,
    url: `/strategies/${pos.strategyId}`,
    data: { strategyId: pos.strategyId, positionId: pos.id, type: "position_update" },
  };
}

export async function notifyAllUsers(payload: PushPayload): Promise<void> {
  try {
    await storage.createNotification({
      type: "general_alert",
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      targetScope: "all_users",
    });

    const allSubs = await storage.getAllPushSubscriptions();
    const loggedInSubs = allSubs.filter((s) => s.userId);
    if (loggedInSubs.length > 0) {
      await sendToSubscriptions(loggedInSubs, payload);
    }
  } catch (err) {
    console.error("Error sending broadcast notifications:", err);
  }
}

export async function notifyAllVisitors(payload: PushPayload): Promise<void> {
  try {
    await storage.createNotification({
      type: "general_alert",
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      targetScope: "all_visitors",
    });

    const allSubs = await storage.getAllPushSubscriptions();
    if (allSubs.length > 0) {
      await sendToSubscriptions(allSubs, payload);
    }
  } catch (err) {
    console.error("Error sending visitor notifications:", err);
  }
}

export { vapidPublicKey, pushEnabled };
