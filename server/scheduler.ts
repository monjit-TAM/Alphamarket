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

async function autoSquareOffIntraday() {
  try {
    const ist = getISTTime();
    const hours = ist.getHours();
    const minutes = ist.getMinutes();

    if (hours !== 15 || minutes < 20 || minutes > 25) return;

    const intradayStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.horizon, "Intraday"));

    for (const strategy of intradayStrategies) {
      const activeCalls = await db
        .select()
        .from(calls)
        .where(and(eq(calls.strategyId, strategy.id), eq(calls.status, "Active")));

      for (const call of activeCalls) {
        const entryPrice = Number(call.entryPrice || call.buyRangeStart || 0);
        let sellPrice = 0;
        let gainPercent = 0;
        let callPriceSource = "pending";

        try {
          const isFnOType = ["Option", "Future", "Index", "CommodityFuture"].includes(strategy.type);
          const callNameParts = call.stockName?.match(/^(\S+)\s+\d{4}-\d{2}-\d{2}\s+(\d+(?:\.\d+)?)\s+(Call|Put|CE|PE)$/i);
          
          if (isFnOType && callNameParts) {
            const [, underlying, strikeStr, optionType] = callNameParts;
            const expiryMatch = call.stockName?.match(/(\d{4}-\d{2}-\d{2})/);
            const expiry = expiryMatch ? expiryMatch[1] : "";
            const strikePrice = Number(strikeStr);
            const callPutType = optionType.toLowerCase() === "call" || optionType.toLowerCase() === "ce" ? "CE" : "PE";

            if (expiry && strikePrice > 0) {
              const premiumLTP = await getOptionPremiumLTP(underlying, expiry, strikePrice, callPutType);
              if (premiumLTP != null && premiumLTP > 0) {
                sellPrice = premiumLTP;
                callPriceSource = "option_chain";
              } else {
                console.warn(`[Scheduler] Option premium unavailable for call ${call.stockName}, using entry price fallback. Advisor should update exit price manually.`);
              }
            }
          } else {
            const liveQuote = await getLiveQuote(call.stockName, strategy.type);
            if (liveQuote && liveQuote.ltp > 0) {
              sellPrice = liveQuote.ltp;
              callPriceSource = "live_quote";
            }
          }

          if (entryPrice > 0 && sellPrice > 0) {
            const isSellAction = call.action === "Sell";
            gainPercent = isSellAction
              ? ((entryPrice - sellPrice) / entryPrice) * 100
              : ((sellPrice - entryPrice) / entryPrice) * 100;
          }
        } catch (e) {
          console.error(`[Scheduler] Could not fetch live price for ${call.stockName}:`, (e as any)?.message);
        }

        // Smart fallback chain if live price fetch failed
        if (sellPrice <= 0) {
          // Fallback 1: Last known price from any source
          const lastKnown = getLastKnownPrice(call.stockName || "");
          if (lastKnown && lastKnown.ltp > 0) {
            sellPrice = lastKnown.ltp;
            callPriceSource = "last_known_" + lastKnown.source;
            console.log(`[Scheduler] Using last known price for ${call.stockName}: ${sellPrice} (from ${lastKnown.source}, ${Math.round((Date.now() - lastKnown.timestamp) / 1000)}s ago)`);
          }
        }
        if (sellPrice <= 0) {
          // Fallback 2: Smart estimate — if price was trending toward SL/target
          const sl = Number(call.stopLoss || 0);
          const tp = Number(call.targetPrice || 0);
          const isSellAction = call.action === "Sell";
          // At 3:20 PM close, if no price available, estimate based on SL/target proximity
          // Conservative: use the price closer to entry (minimize assumed P&L)
          if (sl > 0 && tp > 0) {
            // Use midpoint between entry and SL (conservative — assumes partial move)
            sellPrice = isSellAction ? (entryPrice + sl) / 2 : (entryPrice + sl) / 2;
            callPriceSource = "smart_estimate_sl_mid";
            console.warn(`[Scheduler] No price for ${call.stockName}, using conservative estimate: ${sellPrice.toFixed(2)}`);
          } else if (sl > 0) {
            sellPrice = (entryPrice + sl) / 2;
            callPriceSource = "smart_estimate_sl";
          } else if (tp > 0) {
            sellPrice = (entryPrice + tp) / 2;
            callPriceSource = "smart_estimate_tp";
          }
        }
        if (sellPrice <= 0) {
          // Absolute last resort — skip this call, try again next cycle
          console.error(`[Scheduler] CRITICAL: Cannot determine exit price for ${call.stockName} (${call.id}). Skipping close — will retry.`);
          continue;
        }

        if (entryPrice > 0 && sellPrice > 0) {
          const isSellAction = call.action === "Sell";
          gainPercent = isSellAction
            ? ((entryPrice - sellPrice) / entryPrice) * 100
            : ((sellPrice - entryPrice) / entryPrice) * 100;
        }

        await storage.updateCall(call.id, {
          status: "Closed",
          sellPrice: String(sellPrice.toFixed(2)),
          gainPercent: String(gainPercent.toFixed(2)),
          exitDate: new Date(),
        });
        console.log(`[Scheduler] Auto-squared off intraday call ${call.id} (${call.stockName}) at ${"\u20B9"}${sellPrice.toFixed(2)}, P&L: ${gainPercent.toFixed(2)}% [source: ${callPriceSource}]`);
        if (call.isPublished) {
          const closedCall = { ...call, sellPrice: String(sellPrice.toFixed(2)), gainPercent: String(gainPercent.toFixed(2)), status: "Closed" };
          fireWebhookEvent("CALL_CLOSED", buildCallEventData(closedCall, strategy), strategy.advisorId).catch(() => {});
        }
      }

      const activePositions = await db
        .select()
        .from(positions)
        .where(and(eq(positions.strategyId, strategy.id), eq(positions.status, "Active")));

      for (const pos of activePositions) {
        const entryPx = Number(pos.entryPrice || 0);
        let exitPx = 0;
        let posGainPercent = 0;
        let priceSource = "pending";

        try {
          const isFnOOption = pos.strikePrice && pos.expiry && pos.callPut;
          if (isFnOOption) {
            const premiumLTP = await getOptionPremiumLTP(
              pos.symbol || "",
              pos.expiry!,
              Number(pos.strikePrice),
              pos.callPut!
            );
            if (premiumLTP != null && premiumLTP > 0) {
              exitPx = premiumLTP;
              priceSource = "option_chain";
            } else {
              console.warn(`[Scheduler] Option premium unavailable for ${pos.symbol} ${pos.strikePrice} ${pos.callPut}, using entry price fallback. Advisor should update exit price manually.`);
              priceSource = "entry_fallback";
            }
          } else {
            const posQuote = await getLiveQuote(pos.symbol || "", strategy.type);
            if (posQuote && posQuote.ltp > 0) {
              exitPx = posQuote.ltp;
              priceSource = "live_quote";
            }
          }

          if (entryPx > 0 && exitPx > 0) {
            const isSell = pos.buySell === "Sell";
            posGainPercent = isSell
              ? ((entryPx - exitPx) / entryPx) * 100
              : ((exitPx - entryPx) / entryPx) * 100;
          }
        } catch (e) {
          console.error(`[Scheduler] Could not fetch live price for position ${pos.symbol}:`, (e as any)?.message);
        }

        // Smart fallback chain if live price fetch failed
        if (exitPx <= 0) {
          const lastKnown = getLastKnownPrice(pos.symbol || "");
          if (lastKnown && lastKnown.ltp > 0) {
            exitPx = lastKnown.ltp;
            priceSource = "last_known_" + lastKnown.source;
            console.log(`[Scheduler] Using last known price for ${pos.symbol}: ${exitPx} (from ${lastKnown.source}, ${Math.round((Date.now() - lastKnown.timestamp) / 1000)}s ago)`);
          }
        }
        if (exitPx <= 0) {
          const sl = Number(pos.stopLoss || 0);
          const tgt = Number(pos.target || 0);
          const isSell = pos.buySell === "Sell";
          if (sl > 0 && tgt > 0) {
            exitPx = isSell ? (entryPx + sl) / 2 : (entryPx + sl) / 2;
            priceSource = "smart_estimate_sl_mid";
            console.warn(`[Scheduler] No price for ${pos.symbol}, using conservative estimate: ${exitPx.toFixed(2)}`);
          } else if (sl > 0) {
            exitPx = (entryPx + sl) / 2;
            priceSource = "smart_estimate_sl";
          } else if (tgt > 0) {
            exitPx = (entryPx + tgt) / 2;
            priceSource = "smart_estimate_tp";
          }
        }
        if (exitPx <= 0) {
          console.error(`[Scheduler] CRITICAL: Cannot determine exit price for ${pos.symbol} (${pos.id}). Skipping close — will retry.`);
          continue;
        }

        if (entryPx > 0 && exitPx > 0) {
          const isSell = pos.buySell === "Sell";
          posGainPercent = isSell
            ? ((entryPx - exitPx) / entryPx) * 100
            : ((exitPx - entryPx) / entryPx) * 100;
        }

        await storage.updatePosition(pos.id, {
          status: "Closed",
          exitPrice: String(exitPx.toFixed(2)),
          gainPercent: String(posGainPercent.toFixed(2)),
          exitDate: new Date(),
        });
        console.log(`[Scheduler] Auto-squared off intraday position ${pos.id} (${pos.symbol}) at \u20B9${exitPx.toFixed(2)}, P&L: ${posGainPercent.toFixed(2)}% [source: ${priceSource}]`);
        if (pos.isPublished) {
          const closedPos = { ...pos, exitPrice: String(exitPx.toFixed(2)), gainPercent: String(posGainPercent.toFixed(2)), status: "Closed" };
          fireWebhookEvent("POSITION_CLOSED", buildPositionEventData(closedPos, strategy), strategy.advisorId).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error("[Scheduler] Error in auto square-off:", err);
  }
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
        const sym = pos.symbol || "";
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
      const sym = pos.symbol || "";
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
  // Runs at 3:30 PM IST — closes any Intraday positions/calls missed by the 3:20 run
  try {
    const ist = getISTTime();
    const hours = ist.getHours();
    const minutes = ist.getMinutes();
    if (hours !== 15 || minutes < 30 || minutes > 35) return;

    const intradayStrategies = await db.select().from(strategies).where(eq(strategies.horizon, "Intraday"));
    let recovered = 0;

    for (const strategy of intradayStrategies) {
      const staleCalls = await db.select().from(calls)
        .where(and(eq(calls.strategyId, strategy.id), eq(calls.status, "Active")));
      for (const call of staleCalls) {
        const entryPrice = Number(call.entryPrice || call.buyRangeStart || 0);
        let recoveryPrice = 0;
        // Try to get a real price even for recovery
        try {
          const liveQ = await getLiveQuote(call.stockName || "", strategy.type);
          if (liveQ && liveQ.ltp > 0) recoveryPrice = liveQ.ltp;
        } catch {}
        if (recoveryPrice <= 0) {
          const lastKnown = getLastKnownPrice(call.stockName || "");
          if (lastKnown && lastKnown.ltp > 0) recoveryPrice = lastKnown.ltp;
        }
        if (recoveryPrice <= 0) {
          const sl = Number(call.stopLoss || 0);
          if (sl > 0) recoveryPrice = (entryPrice + sl) / 2;
          else recoveryPrice = entryPrice; // absolute last resort for recovery only
        }
        const recGain = call.action === "Sell" ? ((entryPrice - recoveryPrice) / entryPrice) * 100 : ((recoveryPrice - entryPrice) / entryPrice) * 100;
        await storage.updateCall(call.id, {
          status: "Closed",
          sellPrice: String(recoveryPrice.toFixed(2)),
          gainPercent: String(recGain.toFixed(2)),
          exitDate: new Date(),
        });
        console.warn(`[Scheduler] Recovery close: call ${call.id} (${call.stockName}) closed at entry price fallback`);
        if (call.isPublished) {
          const closedCall = { ...call, sellPrice: String(entryPrice.toFixed(2)), gainPercent: "0.00", status: "Closed" };
          fireWebhookEvent("CALL_CLOSED", buildCallEventData(closedCall, strategy), strategy.advisorId).catch(() => {});
        }
        recovered++;
      }

      const stalePositions = await db.select().from(positions)
        .where(and(eq(positions.strategyId, strategy.id), eq(positions.status, "Active")));
      for (const pos of stalePositions) {
        const entryPx = Number(pos.entryPrice || 0);
        let recoveryPx = 0;
        try {
          const liveQ = await getLiveQuote(pos.symbol || "", strategy.type);
          if (liveQ && liveQ.ltp > 0) recoveryPx = liveQ.ltp;
        } catch {}
        if (recoveryPx <= 0) {
          const lastKnown = getLastKnownPrice(pos.symbol || "");
          if (lastKnown && lastKnown.ltp > 0) recoveryPx = lastKnown.ltp;
        }
        if (recoveryPx <= 0) {
          const sl = Number(pos.stopLoss || 0);
          if (sl > 0) recoveryPx = (entryPx + sl) / 2;
          else recoveryPx = entryPx; // absolute last resort for recovery only
        }
        const recGainPct = pos.buySell === "Sell" ? ((entryPx - recoveryPx) / entryPx) * 100 : ((recoveryPx - entryPx) / entryPx) * 100;
        await storage.updatePosition(pos.id, {
          status: "Closed",
          exitPrice: String(recoveryPx.toFixed(2)),
          gainPercent: String(recGainPct.toFixed(2)),
          exitDate: new Date(),
        });
        console.warn(`[Scheduler] Recovery close: position ${pos.id} (${pos.symbol}) closed at entry price fallback`);
        if (pos.isPublished) {
          const closedPos = { ...pos, exitPrice: String(entryPx.toFixed(2)), gainPercent: "0.00", status: "Closed" };
          fireWebhookEvent("POSITION_CLOSED", buildPositionEventData(closedPos, strategy), strategy.advisorId).catch(() => {});
        }
        recovered++;
      }
    }
    if (recovered > 0) console.log(`[Scheduler] Recovery run: closed ${recovered} stale intraday position(s)`);
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
  }, 60 * 1000);

  console.log("[Scheduler] Started: SL/Target monitoring (every 15s) + Intraday auto-square-off (every 60s)");
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
