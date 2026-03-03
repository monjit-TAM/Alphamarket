import { storage } from "./storage";
import { db } from "./db";
import { calls, positions, strategies } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getLiveQuote, getOptionPremiumLTP } from "./groww";

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

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(() => {
    autoSquareOffIntraday();
  }, 60 * 1000);

  console.log("[Scheduler] Intraday auto-square-off scheduler started (checks every minute)");
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
