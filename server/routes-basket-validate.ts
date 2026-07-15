/**
 * server/routes-basket-validate.ts
 *
 * Advisor-facing draft-basket eligibility check.
 *
 * WHY THIS EXISTS
 * The builder's SymbolAutocomplete searches a STATIC json file
 * (data/nse-symbols.json) that is NOT the tradeable instrument universe.
 * data/nse-symbols.json has "ABSMARINE"; instrument_master has it only as
 * "ABSMARINE-ST". So an advisor picks a symbol that looks valid but resolves to
 * no exchange_token — and the whole basket fails at the broker later.
 *
 * This endpoint validates a DRAFT (unsaved) basket against the SAME machinery
 * the publisher uses:
 *   - real instrument_master resolution (with -ST/-BE/... series fallback)
 *   - the same per-broker capability gates (validateBasketForBroker)
 *
 * Single source of truth: the builder and the admin publish gate can never
 * disagree, because they call the same validator over the same data.
 *
 * ISOLATION: new file, new route. Reuses the basket-integration core (all
 * read-only). Touches nothing on the live call/webhook path. Mounted with one
 * line, exactly like routes-basket-admin.ts.
 *
 *   import { registerBasketValidateRoutes } from "./routes-basket-validate";
 *   registerBasketValidateRoutes(app, requireAdvisor);
 */

import type { Express, Request, Response, RequestHandler } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";

import {
  percentToBps,
  type CanonicalBasket,
  type CanonicalBasketLeg,
} from "./broker-integrations/core/basket-types";
import { validateBasketForBroker } from "./broker-integrations/core/basket-validation";
import { getBasketAdapter } from "./basket-dispatcher";

const DEFAULT_BROKER = "UPSTOX_BASKET";
const SERIES_SUFFIXES = ["-ST", "-BE", "-SM", "-BZ", "-RE"];

/** Same resolution ladder as basket-loader: bare symbol first, then suffixes. */
async function resolveTokens(
  symbols: string[]
): Promise<Map<string, { resolved: string; token: number }>> {
  const out = new Map<string, { resolved: string; token: number }>();
  const uniq = Array.from(new Set(symbols.filter(Boolean)));
  if (uniq.length === 0) return out;

  const candidates: Array<{ raw: string; candidate: string }> = [];
  for (const s of uniq) {
    candidates.push({ raw: s, candidate: s });
    for (const suf of SERIES_SUFFIXES) candidates.push({ raw: s, candidate: `${s}${suf}` });
  }

  const list = candidates.map(c => c.candidate);
  const arrayLiteral =
    "{" + list.map(s => '"' + String(s).replace(/(["\\])/g, "\\$1") + '"').join(",") + "}";

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

  for (const { raw, candidate } of candidates) {
    if (out.has(raw)) continue;
    const token = found.get(candidate);
    if (token != null) out.set(raw, { resolved: candidate, token });
  }
  return out;
}

interface DraftLeg {
  symbol: string;
  exchange?: string;
  weightPercent: number | string;
  action?: string;
  quantity?: number | null;
}

export function registerBasketValidateRoutes(app: Express, requireAdvisor: RequestHandler): void {
  /**
   * POST /api/strategies/:id/basket/validate-eligibility
   * body: { broker?, constituents: DraftLeg[] }
   *
   * Pure validation. Saves NOTHING. Returns per-broker eligibility for the
   * draft as it currently stands, plus per-symbol resolution so the UI can
   * mark exactly which leg is unresolved.
   */
  app.post("/api/strategies/:id/basket/validate-eligibility", requireAdvisor, async (req: Request, res: Response) => {
    try {
      const brokerType = String(req.body.broker || DEFAULT_BROKER);
      const adapter = getBasketAdapter(brokerType);
      if (!adapter) return res.status(400).json({ error: `Unknown basket broker "${brokerType}"` });

      const strategy = await storageGetStrategy(req.params.id);
      if (!strategy) return res.status(404).json({ error: "Strategy not found" });
      if (strategy.advisor_id !== (req as any).session?.userId) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const draftLegs: DraftLeg[] = Array.isArray(req.body.constituents) ? req.body.constituents : [];
      if (draftLegs.length === 0) {
        return res.json({
          brokerType,
          eligible: false,
          errors: [{ field: "orders", reason: "No stocks added yet." }],
          warnings: [],
          legResolution: [],
          capabilities: adapter.capabilities,
        });
      }

      const tokenMap = await resolveTokens(draftLegs.map(l => l.symbol));

      const legs: CanonicalBasketLeg[] = draftLegs.map((l, i) => {
        const hit = tokenMap.get(l.symbol);
        return {
          symbol: hit?.resolved ?? l.symbol,
          rawSymbol: l.symbol,
          exchange: (l.exchange || "NSE").toUpperCase() === "BSE" ? "BSE" : "NSE",
          segment: "EQ",
          exchangeToken: hit?.token ?? null,
          direction: String(l.action || "Buy").toUpperCase() === "SELL" ? "SELL"
            : String(l.action || "Buy").toUpperCase() === "HOLD" ? "SELL" // Hold is non-BUY -> ineligible, treat as SELL for gate
            : "BUY",
          weightBps: percentToBps(l.weightPercent),
          legId: i + 1,
          quantity: l.quantity ?? null,
          priceAtRebalance: null,
        };
      });

      // Build a canonical basket from the DRAFT legs + the SAVED strategy fields.
      const basket: CanonicalBasket = {
        basketId: strategy.id,
        rebalanceId: "draft",
        version: 0,
        advisorId: strategy.advisor_id,
        name: strategy.name,
        description: (strategy.description || strategy.name || "").split("\n")[0]?.trim() || strategy.name,
        rationale: (strategy.description || "").trim(),
        product: "EQUITY",
        horizon: strategy.horizon,
        riskProfile: strategy.risk_level,
        rebalanceFrequency: strategy.rebalance_frequency,
        minInvestment: strategy.minimum_investment != null ? Number(strategy.minimum_investment) : null,
        ra: {
          regNumber: strategy.sebi_reg_number,
          legalName: strategy.company_name,
          displayName: strategy.company_name || strategy.username,
        },
        tags: [],
        legs,
        lifecycle: "CREATE",
        strategyStatus: strategy.status,
        effectiveDate: null,
        rebalanceNotes: null,
      };

      const elig = validateBasketForBroker(basket, adapter.capabilities);

      const legResolution = legs.map(l => ({
        rawSymbol: l.rawSymbol,
        resolved: l.exchangeToken != null ? l.symbol : null,
        exchangeToken: l.exchangeToken,
        resolvedViaSuffix: l.exchangeToken != null && l.symbol !== l.rawSymbol,
        direction: l.direction,
        weightBps: l.weightBps,
      }));

      res.json({
        brokerType,
        eligible: elig.eligible,
        errors: elig.eligible ? [] : elig.errors,
        warnings: elig.warnings,
        legResolution,
        capabilities: adapter.capabilities,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });
}

/** Strategy + advisor join, matching the fields the validator needs. */
async function storageGetStrategy(id: string): Promise<any | null> {
  const res = await db.execute(sql`
    SELECT
      s.id, s.advisor_id, s.name, s.type::text AS type, s.description,
      s.status::text AS status, s.horizon, s.risk_level, s.rebalance_frequency,
      s.minimum_investment,
      u.sebi_reg_number, u.company_name, u.username
    FROM strategies s
    JOIN users u ON u.id = s.advisor_id
    WHERE s.id = ${id}
    LIMIT 1
  `);
  return (res.rows[0] as any) ?? null;
}
