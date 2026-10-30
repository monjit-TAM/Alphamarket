import { storage } from "./storage";
import { fireWebhookEvent, buildCallEventData, buildPositionEventData } from "./webhook-dispatcher";
import { handleXTSEvent } from "./xts-bridge";
import { db } from "./db";
import { calls, positions, strategies } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getLiveQuote, getOptionPremiumLTP, getBulkLTP, getLastKnownPrice } from "./groww";
import {
  notifyStrategySubscribers,
  notifyWatchlistUsers,
  buildCallClosedSubscriberNotification,
  buildCallClosedWatchlistNotification,
  buildPositionClosedSubscriberNotification,
  buildPositionClosedWatchlistNotification,
} from "./push";

function getISTTime(): Date {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(now.getTime() + istOffset + now.getTimezoneOffset() * 60 * 1000);
}

// ── Square-off price safety (Phase A, 22 Sep 2026) ──
// An intraday item is closed ONLY at a real traded price of that exact instrument.
// Options: the option's own premium, never the underlying and never an estimate.
// Equity/futures: live quote, or a last-known price of the same symbol no older than 2 minutes.
// No price -> the item stays Active, is flagged for admin, and retried in the next run.
const SQUAREOFF_LAST_KNOWN_MAX_AGE_MS = 2 * 60 * 1000;

export const unpricedSquareOffs: Map<string, {
  kind: string; id: string; symbol: string; strategy: string; reason: string; firstSeen: string; lastTry: string;
}> = new Map();

function flagUnpriced(kind: string, id: string, symbol: string, strategyName: string, reason: string) {
  const now = new Date().toISOString();
  const prev = unpricedSquareOffs.get(id);
  unpricedSquareOffs.set(id, { kind, id, symbol, strategy: strategyName, reason, firstSeen: prev?.firstSeen || now, lastTry: now });
  console.error(`[PRICE-ALERT] Square-off skipped: ${kind} ${symbol} (${id}) in "${strategyName}" - ${reason}. Left ACTIVE; admin must close it at the real price.`);
}

async function realExitPrice(opts: {
  symbol: string; strategyType?: string;
  option?: { expiry: string; strike: number; callPut: string };
}): Promise<{ price: number; source: string } | null> {
  if (opts.option) {
    const p = await getOptionPremiumLTP(opts.symbol, opts.option.expiry, opts.option.strike, opts.option.callPut);
    return p != null && p > 0 ? { price: p, source: "option_premium" } : null;
  }
  const q = await getLiveQuote(opts.symbol, opts.strategyType);
  if (q && q.ltp > 0) return { price: q.ltp, source: "live_quote" };
  const lk = getLastKnownPrice(opts.symbol);
  if (lk && lk.ltp > 0 && Date.now() - lk.timestamp <= SQUAREOFF_LAST_KNOWN_MAX_AGE_MS) {
    return { price: lk.ltp, source: "last_known_" + lk.source };
  }
  return null;
}

async function squareOffIntradayOnce(label: "squareoff" | "recovery") {
  const intradayStrategies = await db.select().from(strategies).where(eq(strategies.horizon, "Intraday"));
  let closed = 0, skipped = 0;

  for (const strategy of intradayStrategies) {
    const activeCalls = await db.select().from(calls)
      .where(and(eq(calls.strategyId, strategy.id), eq(calls.status, "Active")));

    for (const call of activeCalls) {
      const entryPrice = Number(call.entryPrice || call.buyRangeStart || 0);
      let px: { price: number; source: string } | null = null;
      try {
        const isFnOType = ["Option", "Future", "Index", "CommodityFuture"].includes(strategy.type as any);
        const parts = call.stockName?.match(/^(\S+)\s+\d{4}-\d{2}-\d{2}\s+(\d+(?:\.\d+)?)\s+(Call|Put|CE|PE)$/i);
        if (isFnOType && parts) {
          const [, underlying, strikeStr, optionType] = parts;
          const expiry = (call.stockName?.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
          const strike = Number(strikeStr);
          const cp = /^(call|ce)$/i.test(optionType) ? "CE" : "PE";
          if (expiry && strike > 0) px = await realExitPrice({ symbol: underlying, strategyType: strategy.type as any, option: { expiry, strike, callPut: cp } });
        } else if (isFnOType && /\b(CE|PE|CALL|PUT)\b/i.test(call.stockName || "")) {
          px = null; // looks like an option we cannot parse: never price it with the underlying
        } else {
          px = await realExitPrice({ symbol: call.stockName || "", strategyType: strategy.type as any });
        }
      } catch (e) {
        console.error(`[Scheduler] ${label}: price fetch failed for ${call.stockName}:`, (e as any)?.message);
      }
      if (!px) { flagUnpriced("call", call.id, call.stockName || "", strategy.name, `no real price at ${label}`); skipped++; continue; }

      const isSellAction = call.action === "Sell";
      const gain = entryPrice > 0
        ? (isSellAction ? ((entryPrice - px.price) / entryPrice) * 100 : ((px.price - entryPrice) / entryPrice) * 100)
        : 0;
      const sellPrice = String(px.price.toFixed(2));
      const gainPercent = String(gain.toFixed(2));
      await storage.updateCall(call.id, { status: "Closed", sellPrice, gainPercent, exitDate: new Date() });
      unpricedSquareOffs.delete(call.id);
      console.log(`[Scheduler] ${label}: intraday call ${call.id} (${call.stockName}) closed at ₹${sellPrice}, P&L: ${gainPercent}% [source: ${px.source}]`);
      if (call.isPublished) {
        const closedCall = { ...call, sellPrice, gainPercent, status: "Closed", exitDate: new Date() };
        fireWebhookEvent("CALL_CLOSED", buildCallEventData(closedCall, strategy), strategy.advisorId).catch(() => {});
      }
      closed++;
    }

    const activePositions = await db.select().from(positions)
      .where(and(eq(positions.strategyId, strategy.id), eq(positions.status, "Active")));

    for (const pos of activePositions) {
      const entryPx = Number(pos.entryPrice || 0);
      let px: { price: number; source: string } | null = null;
      const isOption = !!pos.callPut || pos.segment === "Option" || pos.segment === "Index";
      try {
        if (isOption) {
          if (pos.strikePrice && Number(pos.strikePrice) > 0 && pos.expiry && pos.callPut) {
            px = await realExitPrice({ symbol: pos.symbol || "", strategyType: strategy.type as any,
              option: { expiry: pos.expiry, strike: Number(pos.strikePrice), callPut: pos.callPut } });
          }
        } else {
          px = await realExitPrice({ symbol: pos.symbol || "", strategyType: strategy.type as any });
        }
      } catch (e) {
        console.error(`[Scheduler] ${label}: price fetch failed for position ${pos.symbol}:`, (e as any)?.message);
      }
      if (!px) {
        const what = isOption ? `${pos.symbol} ${pos.strikePrice || "?"} ${pos.callPut || "?"} ${pos.expiry || "?"}` : (pos.symbol || "");
        flagUnpriced("position", pos.id, what, strategy.name, `no real ${isOption ? "option premium" : "price"} at ${label}`);
        skipped++; continue;
      }

      const isSell = pos.buySell === "Sell";
      const gain = entryPx > 0 ? (isSell ? ((entryPx - px.price) / entryPx) * 100 : ((px.price - entryPx) / entryPx) * 100) : 0;
      const exitPrice = String(px.price.toFixed(2));
      const gainPercent = String(gain.toFixed(2));
      await storage.updatePosition(pos.id, { status: "Closed", exitPrice, gainPercent, exitDate: new Date() });
      unpricedSquareOffs.delete(pos.id);
      console.log(`[Scheduler] ${label}: intraday position ${pos.id} (${pos.symbol}) closed at ₹${exitPrice}, P&L: ${gainPercent}% [source: ${px.source}]`);
      if (pos.isPublished) {
        const closedPos = { ...pos, exitPrice, gainPercent, status: "Closed", exitDate: new Date() };
        fireWebhookEvent("POSITION_CLOSED", buildPositionEventData(closedPos, strategy), strategy.advisorId).catch(() => {});
      }
      closed++;
    }
  }
  if (closed || skipped) console.log(`[Scheduler] ${label} run: closed ${closed}, left open (no real price) ${skipped}`);
}

async function autoSquareOffIntraday() {
  try {
    const ist = getISTTime();
    if (ist.getHours() !== 15 || ist.getMinutes() < 20 || ist.getMinutes() > 25) return;
    await squareOffIntradayOnce("squareoff");
  } catch (err) {
    console.error("[Scheduler] Error in auto square-off:", err);
  }
}

// Before the open: anything intraday still Active from an earlier day is reported, never auto-closed
// at today's price (that would not be the price at which it should have been squared off).
async function staleIntradayMorningCheck() {
  try {
    const ist = getISTTime();
    if (ist.getHours() !== 9 || ist.getMinutes() < 5 || ist.getMinutes() > 6) return;
    const intradayStrategies = await db.select().from(strategies).where(eq(strategies.horizon, "Intraday"));
    const todayStartUtc = new Date(Date.UTC(ist.getFullYear(), ist.getMonth(), ist.getDate()) - 5.5 * 3600 * 1000);
    for (const strategy of intradayStrategies) {
      const ps = await db.select().from(positions).where(and(eq(positions.strategyId, strategy.id), eq(positions.status, "Active")));
      for (const p of ps) if (p.createdAt && new Date(p.createdAt) < todayStartUtc)
        flagUnpriced("position", p.id, `${p.symbol} ${p.strikePrice || ""} ${p.callPut || ""}`.trim(), strategy.name, "intraday item left open overnight");
      const cs = await db.select().from(calls).where(and(eq(calls.strategyId, strategy.id), eq(calls.status, "Active")));
      for (const c of cs) if (c.createdAt && new Date(c.createdAt) < todayStartUtc)
        flagUnpriced("call", c.id, c.stockName || "", strategy.name, "intraday item left open overnight");
    }
  } catch (err) {
    console.error("[Scheduler] Morning stale-intraday check error:", err);
  }
}


// Futures are priced on the continuous futures contract (TrueData "SYMBOL-I"), not the spot/index.
function priceKeyFor(pos: any): string {
  const sym = pos.symbol || "";
  if (pos.segment === "Future" && sym && !/\d/.test(sym) && !sym.endsWith("-I")) return sym + "-I";
  return sym;
}


async function checkStopLossAndTargets() {
  try {
    const ist = getISTTime();
    const hours = ist.getHours();
    const minutes = ist.getMinutes();
    if (hours < 9 || (hours === 9 && minutes < 15) || hours > 15 || (hours === 15 && minutes > 30)) return;

    // ── Phase 1: Load all active calls + positions + strategies in parallel ──
    const [allStrategies, allActiveCalls, allActivePositions] = await Promise.all([
      db.select().from(strategies),
      db.select().from(calls).where(and(eq(calls.status, "Active"), eq(calls.isPublished, true))),
      db.select().from(positions).where(and(eq(positions.status, "Active"))),
    ]);

    const strategyMap = new Map(allStrategies.map(s => [s.id, s]));

    // Filter out Basket Intraday strategies
    const filteredCalls = allActiveCalls.filter(c => {
      const strat = strategyMap.get(c.strategyId);
      return strat && !(strat.horizon === "Intraday" && strat.type === "Basket");
    });
    const filteredPositions = allActivePositions.filter(p => {
      const strat = strategyMap.get(p.strategyId);
      if (!strat) return false;
      if (strat.horizon === "Intraday") return true; // Intraday: check all active
      return (p as any).isPublished === true;
    });

    // ── Phase 2: Collect all symbols that need equity/futures prices ──
    const bulkSymbols: Array<{ symbol: string; strategyType?: string }> = [];
    const seenSymbols = new Set<string>();

    for (const call of filteredCalls) {
      const entryPrice = Number(call.entryPrice || call.buyRangeStart || 0);
      const sl = Number(call.stopLoss || 0);
      const tp = Number(call.targetPrice || 0);
      if (entryPrice === 0 || (sl === 0 && tp === 0)) continue;
      const sym = call.stockName || "";
      const strat = strategyMap.get(call.strategyId);
      const key = `${sym}_${strat?.type || ""}`;
      if (!seenSymbols.has(key) && sym) {
        seenSymbols.add(key);
        bulkSymbols.push({ symbol: sym, strategyType: strat?.type });
      }
    }

    // Non-option positions also need bulk LTP
    const optionPositions: typeof filteredPositions = [];
    const equityPositions: typeof filteredPositions = [];
    for (const pos of filteredPositions) {
      const entryPx = Number(pos.entryPrice || 0);
      const sl = Number(pos.stopLoss || 0);
      const tgt = Number(pos.target || 0);
      if (entryPx === 0 || (sl === 0 && tgt === 0)) continue;
      const isFutureSegment = pos.segment === "Future" || pos.segment === "Commodity" || pos.segment === "CommodityFuture";
      const hasValidStrike = pos.strikePrice && pos.strikePrice !== "" && pos.strikePrice !== "0" && Number(pos.strikePrice) > 0;
      const isOptionSegment = pos.segment === "Option" || pos.segment === "Index";
      if (!isFutureSegment && (isOptionSegment || (hasValidStrike && pos.expiry && pos.callPut))) {
        // Option/Index positions: use option premium LTP, not stock LTP
        if (hasValidStrike && pos.expiry && pos.callPut) {
          optionPositions.push(pos); // Can fetch premium via NFO
        }
        // If Option segment but missing strike/expiry, skip entirely (can't monitor)
        // Do NOT put in equityPositions — that would compare stock price vs option SL
      } else {
        equityPositions.push(pos);
        const sym = priceKeyFor(pos);
        const strat = strategyMap.get(pos.strategyId);
        const key = `${sym}_${strat?.type || ""}`;
        if (!seenSymbols.has(key) && sym) {
          seenSymbols.add(key);
          bulkSymbols.push({ symbol: sym, strategyType: strat?.type });
        }
      }
    }

    // ── Phase 3: Fetch all prices in parallel ──
    const [bulkPrices, ...optionPrices] = await Promise.all([
      bulkSymbols.length > 0 ? getBulkLTP(bulkSymbols) : Promise.resolve({} as Record<string, any>),
      ...optionPositions.map(pos =>
        getOptionPremiumLTP(pos.symbol || "", pos.expiry!, Number(pos.strikePrice), pos.callPut!)
          .then(ltp => ({ posId: pos.id, ltp }))
          .catch(() => ({ posId: pos.id, ltp: null }))
      ),
    ]);

    const optionLTPMap = new Map<string, number>();
    for (const op of optionPrices) {
      if (op && op.ltp != null && op.ltp > 0) optionLTPMap.set(op.posId, op.ltp);
    }

    // ── Phase 3.5: PRICING HEALTH CHECK — alert if coverage is low ──
    const totalCallSymbols = bulkSymbols.length;
    const pricedSymbols = Object.keys(bulkPrices).length;
    const coveragePct = totalCallSymbols > 0 ? Math.round(pricedSymbols / totalCallSymbols * 100) : 100;
    if (totalCallSymbols > 0 && coveragePct < 50) {
      console.error(`[Scheduler] CRITICAL: Pricing coverage only ${coveragePct}% (${pricedSymbols}/${totalCallSymbols} symbols). Kite may be down!`);
    }
    // Heartbeat every ~5 min (every 20th cycle at 15s interval)
    const now = Date.now();
    if (!globalThis.__schedulerLastHeartbeat || now - globalThis.__schedulerLastHeartbeat > 300000) {
      globalThis.__schedulerLastHeartbeat = now;
      const missedCalls: string[] = [];
      for (const call of filteredCalls) {
        const sym = call.stockName || "";
        const ep = Number(call.entryPrice || call.buyRangeStart || 0);
        const sl = Number(call.stopLoss || 0);
        const tp = Number(call.targetPrice || 0);
        if (ep === 0 || (sl === 0 && tp === 0)) continue;
        if (!bulkPrices[sym]) missedCalls.push(sym);
      }
      console.log(`[Scheduler] Heartbeat: ${filteredCalls.length} calls, ${filteredPositions.length} positions, ${pricedSymbols}/${totalCallSymbols} priced, ${optionPositions.length} options${missedCalls.length > 0 ? ", NO PRICE: " + missedCalls.slice(0, 10).join(",") : ""}`);
    }

    // ── Phase 4: Check calls against bulk prices ──
    for (const call of filteredCalls) {
      const entryPrice = Number(call.entryPrice || call.buyRangeStart || 0);
      const stopLoss = Number(call.stopLoss || 0);
      const targetPrice = Number(call.targetPrice || 0);
      if (entryPrice === 0 || (stopLoss === 0 && targetPrice === 0)) continue;

      const sym = call.stockName || "";
      const quote = bulkPrices[sym];
      if (!quote || !quote.ltp || quote.ltp <= 0) continue;
      const ltp = quote.ltp;
      const strategy = strategyMap.get(call.strategyId)!;
      const isSellAction = call.action === "Sell";
      let triggered: "SL" | "TARGET" | null = null;

      if (isSellAction) {
        if (stopLoss > 0 && ltp >= stopLoss) triggered = "SL";
        else if (targetPrice > 0 && ltp <= targetPrice) triggered = "TARGET";
      } else {
        if (stopLoss > 0 && ltp <= stopLoss) triggered = "SL";
        else if (targetPrice > 0 && ltp >= targetPrice) triggered = "TARGET";
      }

      if (triggered) {
        // Re-check status to prevent duplicate close from overlapping scheduler cycles
        const freshCall = await storage.getCall(call.id);
        if (!freshCall || freshCall.status !== "Active") {
          console.log("[Scheduler] Skipping already-closed call:", call.stockName, call.id);
          continue;
        }
        const gainPercent = isSellAction
          ? (((entryPrice - ltp) / entryPrice) * 100).toFixed(2)
          : (((ltp - entryPrice) / entryPrice) * 100).toFixed(2);
        await storage.updateCall(call.id, {
          status: "Closed",
          sellPrice: String(ltp.toFixed(2)),
          gainPercent,
          exitDate: new Date(),
        });
        const reason = triggered === "SL" ? "Stop Loss triggered automatically" : "Target achieved automatically";
        const evtType = triggered === "SL" ? "STOPLOSS_TRIGGERED" : "TARGET_ACHIEVED";
        const closedCall = {...call, sellPrice: String(ltp.toFixed(2)), gainPercent, status: "Closed"};
        fireWebhookEvent(evtType, buildCallEventData(closedCall, strategy), strategy.advisorId).catch(() => {});
        handleXTSEvent(evtType, buildCallEventData(closedCall, strategy), strategy.advisorId).catch(() => {});
        console.log(`[Scheduler] ${reason}: ${call.stockName} at \u20B9${ltp.toFixed(2)}, P&L: ${gainPercent}%`);
        const subPayload = buildCallClosedSubscriberNotification(call, ltp, gainPercent, reason, strategy.name);
        notifyStrategySubscribers(call.strategyId, strategy.name, "call_closed", subPayload);
        const wlPayload = buildCallClosedWatchlistNotification(call, gainPercent, strategy.name);
        notifyWatchlistUsers(call.strategyId, strategy.name, "call_closed_masked", wlPayload);
      }

      // Trailing SL check
      if (!triggered && call.trailing_sl_enabled && call.trailing_sl_value) {
        const trailValue = Number(call.trailing_sl_value);
        const highestPrice = Number(call.trailing_sl_highest_price || entryPrice);
        const currentSL = Number(call.trailing_sl_current_sl || stopLoss);
        if (ltp > highestPrice) {
          let newSL = currentSL;
          if (call.trailing_sl_type === "PERCENTAGE") {
            newSL = ltp * (1 - trailValue / 100);
          } else {
            newSL = ltp - trailValue;
          }
          if (newSL > currentSL) {
            await storage.updateCall(call.id, {
              trailing_sl_highest_price: String(ltp.toFixed(2)),
              trailing_sl_current_sl: String(newSL.toFixed(2)),
            });
          }
        } else if (currentSL > 0 && ltp <= currentSL) {
          const gp = (((ltp - entryPrice) / entryPrice) * 100).toFixed(2);
          await storage.updateCall(call.id, {
            status: "Closed", sellPrice: String(ltp.toFixed(2)), gainPercent: gp,
            exitDate: new Date(), trailing_sl_triggered_at: new Date().toISOString(),
          });
          fireWebhookEvent("TRAILING_SL_TRIGGERED", buildCallEventData({...call, sellPrice: String(ltp.toFixed(2)), gainPercent: gp, status: "Closed"}, strategy), strategy.advisorId).catch(() => {});
          handleXTSEvent("TRAILING_SL_TRIGGERED", buildCallEventData({...call, sellPrice: String(ltp.toFixed(2)), gainPercent: gp, status: "Closed"}, strategy), strategy.advisorId).catch(() => {});
          console.log(`[Scheduler] Trailing SL triggered: ${call.stockName} at \u20B9${ltp.toFixed(2)}`);
          const reason = "Trailing Stop Loss triggered automatically";
          const subPayload = buildCallClosedSubscriberNotification(call, ltp, gp, reason, strategy.name);
          notifyStrategySubscribers(call.strategyId, strategy.name, "call_closed", subPayload);
          const wlPayload = buildCallClosedWatchlistNotification(call, gp, strategy.name);
          notifyWatchlistUsers(call.strategyId, strategy.name, "call_closed_masked", wlPayload);
        }
      }
    }

    // ── Phase 5: Check equity/future positions against bulk prices ──
    for (const pos of equityPositions) {
      const entryPx = Number(pos.entryPrice || 0);
      const sl = Number(pos.stopLoss || 0);
      const tgt = Number(pos.target || 0);
      const sym = priceKeyFor(pos);
      const quote = bulkPrices[sym];
      if (!quote || !quote.ltp || quote.ltp <= 0) continue;
      const ltp = quote.ltp;
      const strategy = strategyMap.get(pos.strategyId)!;
      const isSell = pos.buySell === "Sell";
      let triggered: "SL" | "TARGET" | null = null;
      if (isSell) {
        if (sl > 0 && ltp >= sl) triggered = "SL";
        else if (tgt > 0 && ltp <= tgt) triggered = "TARGET";
      } else {
        if (sl > 0 && ltp <= sl) triggered = "SL";
        else if (tgt > 0 && ltp >= tgt) triggered = "TARGET";
      }
      if (triggered) {
        const gp = isSell ? (((entryPx - ltp) / entryPx) * 100).toFixed(2) : (((ltp - entryPx) / entryPx) * 100).toFixed(2);
        // Re-check status to prevent duplicate close from overlapping scheduler cycles
        const freshPos = await storage.getPosition(pos.id);
        if (!freshPos || freshPos.status !== "Active") {
          console.log("[Scheduler] Skipping already-closed position:", pos.symbol, pos.id);
          continue;
        }
        await storage.updatePosition(pos.id, {
          status: "Closed", exitPrice: String(ltp.toFixed(2)), gainPercent: gp, exitDate: new Date(),
        });
        console.log(`[Scheduler] Position ${triggered === "SL" ? "Stop Loss" : "Target"}: ${pos.symbol} at \u20B9${ltp.toFixed(2)}, P&L: ${gp}%`);
        const subPayload = buildPositionClosedSubscriberNotification(pos, ltp, gp, strategy.name);
        notifyStrategySubscribers(pos.strategyId, strategy.name, "position_closed", subPayload);
        const wlPayload = buildPositionClosedWatchlistNotification(pos, gp, strategy.name);
        notifyWatchlistUsers(pos.strategyId, strategy.name, "position_closed_masked", wlPayload);
        const posEvtType = triggered === "SL" ? "STOPLOSS_TRIGGERED" : "TARGET_ACHIEVED";
        const closedPos = { ...pos, exitPrice: String(ltp.toFixed(2)), gainPercent: gp, status: "Closed" };
        fireWebhookEvent(posEvtType, buildPositionEventData(closedPos, strategy), strategy.advisorId).catch(() => {});
      }
    }

    // ── Phase 6: Check option positions against parallel-fetched premiums ──
    for (const pos of optionPositions) {
      const entryPx = Number(pos.entryPrice || 0);
      const sl = Number(pos.stopLoss || 0);
      const tgt = Number(pos.target || 0);
      const ltp = optionLTPMap.get(pos.id) || 0;
      if (ltp <= 0) continue;
      const strategy = strategyMap.get(pos.strategyId)!;
      const isSell = pos.buySell === "Sell";
      let triggered: "SL" | "TARGET" | null = null;
      if (isSell) {
        if (sl > 0 && ltp >= sl) triggered = "SL";
        else if (tgt > 0 && ltp <= tgt) triggered = "TARGET";
      } else {
        if (sl > 0 && ltp <= sl) triggered = "SL";
        else if (tgt > 0 && ltp >= tgt) triggered = "TARGET";
      }
      if (triggered) {
        // Re-check status to prevent duplicate close from overlapping scheduler cycles
        const freshOptPos = await storage.getPosition(pos.id);
        if (!freshOptPos || freshOptPos.status !== "Active") {
          console.log("[Scheduler] Skipping already-closed option position:", pos.symbol, pos.id);
          continue;
        }
        const gp = isSell ? (((entryPx - ltp) / entryPx) * 100).toFixed(2) : (((ltp - entryPx) / entryPx) * 100).toFixed(2);
        await storage.updatePosition(pos.id, {
          status: "Closed", exitPrice: String(ltp.toFixed(2)), gainPercent: gp, exitDate: new Date(),
        });
        console.log(`[Scheduler] Option Position ${triggered === "SL" ? "Stop Loss" : "Target"}: ${pos.symbol} at \u20B9${ltp.toFixed(2)}, P&L: ${gp}%`);
        const subPayload = buildPositionClosedSubscriberNotification(pos, ltp, gp, strategy.name);
        notifyStrategySubscribers(pos.strategyId, strategy.name, "position_closed", subPayload);
        const wlPayload = buildPositionClosedWatchlistNotification(pos, gp, strategy.name);
        notifyWatchlistUsers(pos.strategyId, strategy.name, "position_closed_masked", wlPayload);
        const posEvtType = triggered === "SL" ? "STOPLOSS_TRIGGERED" : "TARGET_ACHIEVED";
        const closedPos = { ...pos, exitPrice: String(ltp.toFixed(2)), gainPercent: gp, status: "Closed" };
        fireWebhookEvent(posEvtType, buildPositionEventData(closedPos, strategy), strategy.advisorId).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[Scheduler] Error in SL/Target check:", err);
  }
}

async function recoverySquareOff() {
  // 3:30 PM IST retry for anything the 3:20 run could not price. Same rules: real prices only.
  try {
    const ist = getISTTime();
    if (ist.getHours() !== 15 || ist.getMinutes() < 30 || ist.getMinutes() > 35) return;
    await squareOffIntradayOnce("recovery");
  } catch (err) {
    console.error("[Scheduler] Recovery square-off error:", err);
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  if (schedulerInterval) return;

  // ── STARTUP SELF-TEST: Verify Kite pricing works before accepting market responsibility ──
  (async () => {
    try {
      const testRes = await fetch("http://localhost:8001/api/shared/kite-quotes?symbols=SBIN", {
        headers: { "x-shared-secret": "alphamarket-shared-2026" },
        signal: AbortSignal.timeout(5000)
      });
      if (testRes.ok) {
        const testData = await testRes.json();
        const hasPrices = Object.keys(testData.quotes || {}).length > 0;
        if (hasPrices) {
          console.log("[Scheduler] ✅ Kite pricing self-test PASSED — equity call monitoring is ACTIVE");
        } else {
          console.error("[Scheduler] ⚠️ Kite connected but returned 0 prices — token may be expired. Equity calls will NOT be auto-closed until Kite returns prices!");
        }
      } else {
        console.error(`[Scheduler] 🔴 CRITICAL: Kite self-test FAILED (HTTP ${testRes.status}). Equity call auto-close is BROKEN! Check x-shared-secret header and Kite token.`);
      }
    } catch (e: any) {
      console.error("[Scheduler] 🔴 CRITICAL: Kite self-test exception:", e?.message, "— Equity call auto-close will NOT work!");
    }
  })();

  // SL/Target check runs every 15 seconds for fast detection
  schedulerInterval = setInterval(() => {
    checkStopLossAndTargets();
  }, 15 * 1000);

  // Intraday square-off and recovery run every 60 seconds (only trigger at specific times anyway)
  setInterval(() => {
    autoSquareOffIntraday();
    recoverySquareOff();
    staleIntradayMorningCheck();
  }, 60 * 1000);

  console.log("[Scheduler] Started: SL/Target monitoring (every 15s) + Intraday auto-square-off (every 60s)");
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
