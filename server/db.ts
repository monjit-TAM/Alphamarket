import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

export async function ensureBasketTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS basket_rebalances (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        strategy_id varchar NOT NULL,
        version integer NOT NULL DEFAULT 1,
        effective_date timestamp DEFAULT now(),
        notes text,
        created_at timestamp DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS basket_constituents (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        strategy_id varchar NOT NULL,
        rebalance_id varchar NOT NULL,
        symbol text NOT NULL,
        exchange text DEFAULT 'NSE',
        weight_percent numeric NOT NULL,
        quantity integer,
        price_at_rebalance numeric,
        action text DEFAULT 'Buy',
        created_at timestamp DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS basket_rationales (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        strategy_id varchar NOT NULL,
        title text NOT NULL,
        body text,
        category text DEFAULT 'general',
        attachments text[],
        created_at timestamp DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS basket_nav_snapshots (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        strategy_id varchar NOT NULL,
        as_of_date timestamp NOT NULL,
        nav numeric NOT NULL,
        total_return numeric,
        daily_return numeric,
        created_at timestamp DEFAULT now()
      );
    `);
    await client.query(`
      ALTER TABLE strategies ADD COLUMN IF NOT EXISTS rebalance_frequency text;
    `);
    console.log("[DB] Basket tables verified/created");
  } catch (err) {
    console.error("[DB] Error ensuring basket tables:", err);
  } finally {
    client.release();
  }
}
