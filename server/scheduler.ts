import { storage } from "./storage";
import { db } from "./db";
import { calls, positions, strategies } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getLiveQuote, getOptionPremiumLTP } from "./groww";
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

    if (hours !== 15 || minutes < 25 || minutes > 30) return;

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
        let sellPrice = entryPrice;
        let gainPercent = 0;
        let callPriceSource = "entry_fallback";

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
          console.error(`[Scheduler] Could not fetch live price for ${call.stockName}, using entry price`);
        }

        await storage.updateCall(call.id, {
          status: "Closed",
          sellPrice: String(sellPrice.toFixed(2)),
          gainPercent: String(gainPercent.toFixed(2)),
          exitDate: new Date(),
        });
        console.log(`[Scheduler] Auto-squared off intraday call ${call.id} (${call.stockName}) at ${"\u20B9"}${sellPrice.toFixed(2)}, P&L: ${gainPercent.toFixed(2)}% [source: ${callPriceSource}]`);
      }

      const activePositions = await db
        .select()
        .from(positions)
        .where(and(eq(positions.strategyId, strategy.id), eq(positions.status, "Active")));

      for (const pos of activePositions) {
        const entryPx = Number(pos.entryPrice || 0);
        let exitPx = entryPx;
        let posGainPercent = 0;
        let priceSource = "entry_fallback";

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
          console.error(`[Scheduler] Could not fetch live price for position ${pos.symbol}, using entry price`);
        }

        await storage.updatePosition(pos.id, {
          status: "Closed",
          exitPrice: String(exitPx.toFixed(2)),
          gainPercent: String(posGainPercent.toFixed(2)),
          exitDate: new Date(),
        });
        console.log(`[Scheduler] Auto-squared off intraday position ${pos.id} (${pos.symbol}) at \u20B9${exitPx.toFixed(2)}, P&L: ${posGainPercent.toFixed(2)}% [source: ${priceSource}]`);
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

    const allStrategies = await db.select().from(strategies);

    for (const strategy of allStrategies) {
      if (strategy.horizon === "Intraday") continue;

      const activeCalls = await db.select().from(calls).where(
        and(eq(calls.strategyId, strategy.id), eq(calls.status, "Active"), eq(calls.isPublished, true))
      );

      for (const call of activeCalls) {
        const entryPrice = Number(call.entryPrice || call.buyRangeStart || 0);
        const stopLoss = Number(call.stopLoss || 0);
        const targetPrice = Number(call.targetPrice || 0);
        if (entryPrice === 0 || (stopLoss === 0 && targetPrice === 0)) continue;

        try {
          const quote = await getLiveQuote(call.stockName, strategy.type);
          if (!quote || !quote.ltp || quote.ltp <= 0) continue;
          const ltp = quote.ltp;
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
            console.log(`[Scheduler] ${reason}: ${call.stockName} at \u20B9${ltp.toFixed(2)}, P&L: ${gainPercent}%`);
            const subPayload = buildCallClosedSubscriberNotification(call, ltp, gainPercent, reason, strategy.name);
            notifyStrategySubscribers(call.strategyId, strategy.name, "call_closed", subPayload);
            const wlPayload = buildCallClosedWatchlistNotification(call, gainPercent, strategy.name);
            notifyWatchlistUsers(call.strategyId, strategy.name, "call_closed_masked", wlPayload);
          }

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
              console.log(`[Scheduler] Trailing SL triggered: ${call.stockName} at \u20B9${ltp.toFixed(2)}`);
              const reason = "Trailing Stop Loss triggered automatically";
              const subPayload = buildCallClosedSubscriberNotification(call, ltp, gp, reason, strategy.name);
              notifyStrategySubscribers(call.strategyId, strategy.name, "call_closed", subPayload);
              const wlPayload = buildCallClosedWatchlistNotification(call, gp, strategy.name);
              notifyWatchlistUsers(call.strategyId, strategy.name, "call_closed_masked", wlPayload);
            }
          }
        } catch (priceErr) {}
      }

      const activePositions = await db.select().from(positions).where(
        and(eq(positions.strategyId, strategy.id), eq(positions.status, "Active"), eq(positions.isPublished, true))
      );

      for (const pos of activePositions) {
        const entryPx = Number(pos.entryPrice || 0);
        const sl = Number(pos.stopLoss || 0);
        const tgt = Number(pos.target || 0);
        if (entryPx === 0 || (sl === 0 && tgt === 0)) continue;
        try {
          let ltp = 0;
          if (pos.strikePrice && pos.expiry && pos.callPut) {
            const p = await getOptionPremiumLTP(pos.symbol || "", pos.expiry, Number(pos.strikePrice), pos.callPut);
            if (p != null && p > 0) ltp = p;
          } else {
            const q = await getLiveQuote(pos.symbol || "", strategy.type);
            if (q && q.ltp > 0) ltp = q.ltp;
          }
          if (ltp <= 0) continue;
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
            await storage.updatePosition(pos.id, {
              status: "Closed", exitPrice: String(ltp.toFixed(2)), gainPercent: gp, exitDate: new Date(),
            });
            console.log(`[Scheduler] Position ${triggered === "SL" ? "Stop Loss" : "Target"}: ${pos.symbol} at \u20B9${ltp.toFixed(2)}, P&L: ${gp}%`);
            const subPayload = buildPositionClosedSubscriberNotification(pos, ltp, gp, strategy.name);
            notifyStrategySubscribers(pos.strategyId, strategy.name, "position_closed", subPayload);
            const wlPayload = buildPositionClosedWatchlistNotification(pos, gp, strategy.name);
            notifyWatchlistUsers(pos.strategyId, strategy.name, "position_closed_masked", wlPayload);
          }
        } catch (priceErr) {}
      }
    }
  } catch (err) {
    console.error("[Scheduler] Error in SL/Target check:", err);
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(() => {
    autoSquareOffIntraday();
    checkStopLossAndTargets();
  }, 60 * 1000);

  console.log("[Scheduler] Started: Intraday auto-square-off + SL/Target monitoring (every minute)");
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
