import TelegramBot from "node-telegram-bot-api";
import { db } from "./db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { storage } from "./storage";

let bot: TelegramBot | null = null;

export function initTelegramBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("[Telegram] TELEGRAM_BOT_TOKEN not set - bot disabled");
    return;
  }
  bot = new TelegramBot(token, { polling: true });
  console.log("[Telegram] Bot started with polling");
  bot.onText(/\/start(.*)/, handleStart);
  bot.onText(/\/unlink/, handleUnlink);
  bot.onText(/\/status/, handleStatus);
  bot.onText(/\/help/, handleHelp);
  bot.on("polling_error", (err) => {
    console.error("[Telegram] Polling error:", err.message);
  });
}

async function handleStart(msg: TelegramBot.Message, match: RegExpMatchArray | null): Promise<void> {
  const chatId = msg.chat.id;
  const linkingCode = match?.[1]?.trim();

  if (!linkingCode) {
    await bot?.sendMessage(
      chatId,
      "Welcome to AlphaMarket Alerts!\n\n" +
      "To receive strategy alerts here, link your account:\n\n" +
      "1. Go to your Dashboard on alphamarket.co.in\n" +
      "2. Click Connect Telegram\n" +
      "3. It will bring you back here with a linking code\n\n" +
      "Type /help for all commands."
    );
    return;
  }

  try {
    const result = await db.execute(sql`
      SELECT user_id, code, expires_at
      FROM telegram_linking_codes
      WHERE code = ${linkingCode} AND expires_at > NOW()
      LIMIT 1
    `);

    const row = (result as any).rows?.[0];
    if (!row) {
      await bot?.sendMessage(chatId, "Invalid or expired linking code. Please generate a new one from your dashboard.");
      return;
    }

    const userId = row.user_id;

    const existing = await db.execute(sql`
      SELECT id FROM telegram_subscriptions
      WHERE user_id = ${userId} AND strategy_id IS NULL
      LIMIT 1
    `);

    if ((existing as any).rows?.length > 0) {
      await db.execute(sql`
        UPDATE telegram_subscriptions
        SET telegram_chat_id = ${chatId},
            telegram_username = ${msg.from?.username || null},
            is_active = true,
            updated_at = NOW()
        WHERE user_id = ${userId} AND strategy_id IS NULL
      `);
    } else {
      await db.execute(sql`
        INSERT INTO telegram_subscriptions (user_id, telegram_chat_id, telegram_username, strategy_id, is_active)
        VALUES (${userId}, ${chatId}, ${msg.from?.username || null}, NULL, true)
      `);
    }

    await db.execute(sql`DELETE FROM telegram_linking_codes WHERE code = ${linkingCode}`);

    const user = await storage.getUser(userId);

    await bot?.sendMessage(
      chatId,
      "Account linked successfully!\n\n" +
      "Account: " + (user?.username || user?.email || "Unknown") + "\n\n" +
      "You will now receive alerts for all your subscribed strategies.\n\n" +
      "Type /status to check your subscriptions."
    );
    console.log("[Telegram] Linked user " + userId + " to chat " + chatId);

  } catch (err) {
    console.error("[Telegram] Error handling /start:", err);
    await bot?.sendMessage(chatId, "Something went wrong. Please try again.");
  }
}

async function handleUnlink(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  try {
    const result = await db.execute(sql`
      UPDATE telegram_subscriptions
      SET is_active = false, updated_at = NOW()
      WHERE telegram_chat_id = ${chatId} AND is_active = true
    `);
    const rowCount = (result as any).rowCount || 0;
    if (rowCount > 0) {
      await bot?.sendMessage(chatId, "Telegram alerts disabled. Re-link anytime from your dashboard.");
    } else {
      await bot?.sendMessage(chatId, "No active Telegram link found for this chat.");
    }
  } catch (err) {
    console.error("[Telegram] Error handling /unlink:", err);
    await bot?.sendMessage(chatId, "Something went wrong. Please try again.");
  }
}

async function handleStatus(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  try {
    const result = await db.execute(sql`
      SELECT ts.user_id, ts.is_active, u.username, u.email
      FROM telegram_subscriptions ts
      JOIN users u ON u.id = ts.user_id
      WHERE ts.telegram_chat_id = ${chatId}
      ORDER BY ts.is_active DESC
      LIMIT 1
    `);
    const row = (result as any).rows?.[0];
    if (!row) {
      await bot?.sendMessage(chatId, "This chat is not linked to any AlphaMarket account.\n\nUse the Connect Telegram button on alphamarket.co.in to link.");
      return;
    }
    const account = row.username || row.email || "Unknown";
    if (row.is_active) {
      await bot?.sendMessage(chatId, "Telegram alerts are ACTIVE\n\nAccount: " + account + "\nYou are receiving alerts for all subscribed strategies.");
    } else {
      await bot?.sendMessage(chatId, "Telegram alerts are DISABLED\n\nAccount: " + account + "\nRe-link from your dashboard to enable.");
    }
  } catch (err) {
    console.error("[Telegram] Error handling /status:", err);
    await bot?.sendMessage(chatId, "Something went wrong. Please try again.");
  }
}

async function handleHelp(msg: TelegramBot.Message): Promise<void> {
  await bot?.sendMessage(
    msg.chat.id,
    "AlphaMarket Alerts Bot\n\n" +
    "Commands:\n" +
    "/start - Link your account\n" +
    "/status - Check subscription status\n" +
    "/unlink - Disable alerts\n" +
    "/help - Show this message\n\n" +
    "Visit alphamarket.co.in to manage strategies."
  );
}

export async function sendTelegramAlertToStrategy(
  strategyId: string,
  title: string,
  body: string
): Promise<void> {
  if (!bot) return;

  try {
    const result = await db.execute(sql`
      SELECT DISTINCT ts.telegram_chat_id
      FROM telegram_subscriptions ts
      JOIN subscriptions sub ON sub.user_id = ts.user_id AND sub.strategy_id = ${strategyId}
      WHERE ts.is_active = true
        AND (ts.strategy_id = ${strategyId} OR ts.strategy_id IS NULL)
        AND sub.status = 'active'
    `);

    const chatIds = (result as any).rows || [];
    if (chatIds.length === 0) return;

    const message = title + "\n\n" + body;

    console.log("[Telegram] Sending alert to " + chatIds.length + " subscribers for strategy " + strategyId);

    for (let i = 0; i < chatIds.length; i++) {
      try {
        if (i > 0 && i % 25 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        await bot.sendMessage(chatIds[i].telegram_chat_id, message);
      } catch (err: any) {
        if (err?.response?.statusCode === 403 || err?.response?.statusCode === 400) {
          console.log("[Telegram] Deactivating chat " + chatIds[i].telegram_chat_id + " - blocked/invalid");
          await db.execute(sql`
            UPDATE telegram_subscriptions
            SET is_active = false, updated_at = NOW()
            WHERE telegram_chat_id = ${chatIds[i].telegram_chat_id}
          `);
        } else {
          console.error("[Telegram] Failed to send to " + chatIds[i].telegram_chat_id + ":", err.message);
        }
      }
    }
  } catch (err) {
    console.error("[Telegram] Error sending alerts:", err);
  }
}

export async function generateLinkingCode(userId: string): Promise<string> {
  const code = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.execute(sql`DELETE FROM telegram_linking_codes WHERE user_id = ${userId}`);
  await db.execute(sql`
    INSERT INTO telegram_linking_codes (user_id, code, expires_at)
    VALUES (${userId}, ${code}, ${expiresAt})
  `);

  return code;
}

export async function getUserTelegramStatus(userId: string): Promise<{
  linked: boolean;
  username?: string;
}> {
  const result = await db.execute(sql`
    SELECT telegram_chat_id, telegram_username
    FROM telegram_subscriptions
    WHERE user_id = ${userId} AND is_active = true
    LIMIT 1
  `);
  const row = (result as any).rows?.[0];
  if (row) {
    return { linked: true, username: row.telegram_username };
  }
  return { linked: false };
}
