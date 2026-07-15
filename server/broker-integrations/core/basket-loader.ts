/**
 * server/broker-integrations/core/basket-loader.ts
 *
 * Reads the model-portfolio basket out of Postgres and produces a
 * CanonicalBasket. This is the ONLY place that knows the DB shape; every
 * adapter downstream sees the canonical form.
 *
 * Tables read (READ-ONLY — this module never writes):
 *   strategies            (type='Basket')
 *   basket_rebalances     (version snapshots)
 *   basket_constituents   (weighted legs, FK to a specific rebalance)
 *   users                 (RA details: sebi_reg_number, company_name)
 *   instrument_master     (exchange_token resolution)
 *
 * Explicitly NOT touched: advisor_basket_strategies (multi-leg F&O order
 * baskets — a different, live product), positions, calls, broker_webhook_logs.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";

import {
  percentToBps,
  type BasketLifecycle,
  type CanonicalBasket,
  type CanonicalBasketLeg,
} from "./basket-types";

/**
 * Series suffixes to try when a bare symbol does not resolve in
 * instrument_master.
 *
 * Real case: advisor entered "ABSMARINE"; instrument_master has
 * "ABSMARINE-ST" (NSE SME / ST series). Exact-match join returned null, which
 * would have failed the entire 33-leg basket at the broker with an opaque error.
 *
 * Ordered by likelihood.
 */
const SERIES_SUFFIXES = ["-ST", "-BE", "-SM", "-BZ", "-RE"];

interface StrategyRow {
  id: string;
  advisor_id: string;
  name: string;
  type: string;
  description: string | null;
  status: string;
  horizon: string | null;
  risk_level: string | null;
  rebalance_frequency: string | null;
  minimum_investment: string | null;
  theme: string[] | null;
  key_sectors: string[] | null;
  sebi_reg_number: string | null;
  company_name: string | null;
  username: string | null;
}

interface RebalanceRow {
  id: string;
  version: number;
  effective_date: Date | null;
  notes: string | null;
}

interface ConstituentRow {
  symbol: string;
  exchange: string | null;
  weight_percent: string;
  quantity: number | null;
  price_at_rebalance: string | null;
  action: string | null;
  resolved_symbol: string | null;
  exchange_token: number | null;
}

export class BasketNotFound extends Error {
  constructor(strategyId: string) {
    super(`No basket found for strategy ${strategyId}`);
    this.name = "BasketNotFound";
  }
}

/**
 * Resolve symbols to exchange tokens, with series-suffix fallback.
 *
 * Done as ONE query for all legs rather than N queries. The COALESCE ladder
 * tries the bare symbol first, then each suffix in turn.
 */
async function resolveTokens(
  symbols: string[]
): Promise<Map<string, { resolved: string; token: number }>> {
  const out = new Map<string, { resolved: string; token: number }>();
  if (symbols.length === 0) return out;

  const uniq = Array.from(new Set(symbols));

  // Candidate list: bare symbol + every suffixed variant.
  const candidates: Array<{ raw: string; candidate: string }> = [];
  for (const s of uniq) {
    candidates.push({ raw: s, candidate: s });
    for (const suf of SERIES_SUFFIXES) {
      candidates.push({ raw: s, candidate: `${s}${suf}` });
    }
  }

  // Postgres array literal. Drizzle binds a JS array as a record, not a text[],
  // so ANY(${arr}::text[]) fails with "cannot cast type record to text[]".
  // Build the literal ourselves. Symbols come from instrument_master-adjacent
  // data, but escape quotes anyway.
  const candidateList = candidates.map(c => c.candidate);
  const arrayLiteral =
    "{" + candidateList.map(s => '"' + String(s).replace(/(["\\])/g, "\\$1") + '"').join(",") + "}";

  const res = await db.execute(sql`
    SELECT tradingsymbol, exchange_token
    FROM instrument_master
    WHERE exchange = 'NSE'
      AND tradingsymbol = ANY(${arrayLiteral}::text[])
  `);

  const found = new Map<string, number>();
  for (const row of res.rows as any[]) {
    found.set(String(row.tradingsymbol), Number(row.exchange_token));
  }

  // Walk candidates in priority order; first hit per raw symbol wins.
  for (const { raw, candidate } of candidates) {
    if (out.has(raw)) continue;
    const token = found.get(candidate);
    if (token != null) {
      out.set(raw, { resolved: candidate, token });
    }
  }

  return out;
}

/** Map basket_constituents.exchange ('NSE') to canonical exchange+segment. */
function mapExchange(ex: string | null): { exchange: "NSE" | "BSE"; segment: "EQ" } {
  const e = (ex || "NSE").toUpperCase();
  return { exchange: e === "BSE" ? "BSE" : "NSE", segment: "EQ" };
}

/**
 * Load the given strategy's basket at its LATEST rebalance version.
 *
 * @param strategyId  strategies.id
 * @param lifecycle   what we intend to do with it (affects validation only)
 * @param rebalanceId optional — pin to a specific version instead of latest
 */
export async function loadCanonicalBasket(
  strategyId: string,
  lifecycle: BasketLifecycle,
  rebalanceId?: string
): Promise<CanonicalBasket> {
  const sres = await db.execute(sql`
    SELECT
      s.id, s.advisor_id, s.name, s.type::text AS type, s.description,
      s.status::text AS status, s.horizon, s.risk_level, s.rebalance_frequency,
      s.minimum_investment, s.theme, s.key_sectors,
      u.sebi_reg_number, u.company_name, u.username
    FROM strategies s
    JOIN users u ON u.id = s.advisor_id
    WHERE s.id = ${strategyId}
    LIMIT 1
  `);
  const s = sres.rows[0] as unknown as StrategyRow | undefined;
  if (!s) throw new BasketNotFound(strategyId);

  const rres = rebalanceId
    ? await db.execute(sql`
        SELECT id, version, effective_date, notes
        FROM basket_rebalances
        WHERE id = ${rebalanceId} AND strategy_id = ${strategyId}
        LIMIT 1
      `)
    : await db.execute(sql`
        SELECT id, version, effective_date, notes
        FROM basket_rebalances
        WHERE strategy_id = ${strategyId}
        ORDER BY version DESC
        LIMIT 1
      `);
  const r = rres.rows[0] as unknown as RebalanceRow | undefined;
  if (!r) throw new BasketNotFound(strategyId);

  const cres = await db.execute(sql`
    SELECT symbol, exchange, weight_percent, quantity, price_at_rebalance, action
    FROM basket_constituents
    WHERE rebalance_id = ${r.id}
    ORDER BY created_at ASC, id ASC
  `);
  const rows = cres.rows as unknown as ConstituentRow[];

  const tokenMap = await resolveTokens(rows.map(c => c.symbol));

  const legs: CanonicalBasketLeg[] = rows.map((c, i) => {
    const hit = tokenMap.get(c.symbol);
    const { exchange, segment } = mapExchange(c.exchange);
    return {
      symbol: hit?.resolved ?? c.symbol,
      rawSymbol: c.symbol,
      exchange,
      segment,
      exchangeToken: hit?.token ?? null,
      direction: String(c.action || "Buy").toUpperCase() === "SELL" ? "SELL" : "BUY",
      weightBps: percentToBps(c.weight_percent),
      legId: i + 1,
      quantity: c.quantity ?? null,
      priceAtRebalance: c.price_at_rebalance != null ? Number(c.price_at_rebalance) : null,
    };
  });

  // description vs rationale.
  //
  // Upstox's `description` is "one-line description shown in basket listings".
  // Upstox's `rationale` is the investment thesis.
  //
  // AlphaMarket has a single strategies.description holding the FULL thesis
  // (multi-line). So the natural mapping is inverted from the field names:
  //   rationale   <- the whole description text
  //   description <- its first line
  // No schema change needed.
  const fullText = (s.description || "").trim();
  const firstLine = fullText.split("\n").map(x => x.trim()).filter(Boolean)[0] || s.name;

  const tags = [
    ...(Array.isArray(s.theme) ? s.theme : []),
    ...(Array.isArray(s.key_sectors) ? s.key_sectors : []),
  ].filter(Boolean);

  return {
    basketId: s.id,
    rebalanceId: r.id,
    version: Number(r.version),
    advisorId: s.advisor_id,
    name: s.name,
    description: firstLine,
    rationale: fullText,
    product: "EQUITY",
    horizon: s.horizon,
    riskProfile: s.risk_level,
    rebalanceFrequency: s.rebalance_frequency,
    minInvestment: s.minimum_investment != null ? Number(s.minimum_investment) : null,
    ra: {
      regNumber: s.sebi_reg_number,
      legalName: s.company_name,
      displayName: s.company_name || s.username,
    },
    tags,
    legs,
    lifecycle,
    strategyStatus: s.status,
    effectiveDate: r.effective_date,
    rebalanceNotes: r.notes,
  };
}

/** All model-portfolio baskets (strategies with at least one rebalance). */
export async function listBasketStrategies(): Promise<
  Array<{
    strategyId: string;
    name: string;
    advisorId: string;
    advisorName: string | null;
    status: string;
    horizon: string | null;
    version: number;
    rebalanceId: string;
    legCount: number;
    weightBps: number;
    sellLegs: number;
  }>
> {
  const res = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (strategy_id) strategy_id, id, version
      FROM basket_rebalances
      ORDER BY strategy_id, version DESC
    )
    SELECT
      s.id                                                     AS strategy_id,
      s.name,
      s.advisor_id,
      u.company_name                                           AS advisor_name,
      s.status::text                                           AS status,
      s.horizon,
      l.version,
      l.id                                                     AS rebalance_id,
      COUNT(bc.id)::int                                        AS leg_count,
      COALESCE(SUM(bc.weight_percent) * 100, 0)::int           AS weight_bps,
      COUNT(*) FILTER (WHERE UPPER(bc.action) <> 'BUY')::int   AS sell_legs
    FROM latest l
    JOIN strategies s ON s.id = l.strategy_id
    JOIN users u      ON u.id = s.advisor_id
    LEFT JOIN basket_constituents bc ON bc.rebalance_id = l.id
    GROUP BY s.id, s.name, s.advisor_id, u.company_name, s.status, s.horizon, l.version, l.id
    ORDER BY s.name
  `);

  return (res.rows as any[]).map(r => ({
    strategyId: String(r.strategy_id),
    name: String(r.name),
    advisorId: String(r.advisor_id),
    advisorName: r.advisor_name ?? null,
    status: String(r.status),
    horizon: r.horizon ?? null,
    version: Number(r.version),
    rebalanceId: String(r.rebalance_id),
    legCount: Number(r.leg_count),
    weightBps: Number(r.weight_bps),
    sellLegs: Number(r.sell_legs),
  }));
}
