/**
 * server/broker-integrations/xts/instrument-lookup.ts
 *
 * Lookup instruments in xts_instrument_master. Returns XTS's native numeric ID
 * for a specific contract.
 *
 * Old code's problem: silent fallback — if lookup failed, return the symbol.
 * That fallback concealed data problems and occasionally sent wrong IDs.
 *
 * New behavior: throw InstrumentNotFound on miss. Caller decides whether
 * to fall back to the symbol (config-driven) or fail the publish.
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { XTS_EXCHANGE_SEGMENT, XTS_SERIES, XTS_INSTRUMENT_MASTER_OPTION_TYPE } from "./spec";

export class InstrumentNotFound extends Error {
  constructor(spec: string) {
    super(`XTS instrument not found: ${spec}`);
    this.name = "InstrumentNotFound";
  }
}

export interface XtsInstrument {
  exchangeSegment: string;
  exchangeInstrumentID: string;
  name: string;
  series: string;
  displayName?: string | null;
  lotSize?: number | null;
  strikePrice?: number | null;
  optionType?: string | null;   // normalized "CE"/"PE"
  contractExpiration?: string | null;
}

/**
 * Lookup equity instrument (EQ series, NSECM segment).
 * e.g., ASHOKLEY → { id: "212", segment: "NSECM", series: "EQ" }
 */
export async function lookupEquity(symbol: string): Promise<XtsInstrument> {
  const result = await db.execute(sql`
    SELECT name, series, exchange_instrument_id, exchange_segment,
           display_name, lot_size, strike_price, option_type, contract_expiration
    FROM xts_instrument_master
    WHERE UPPER(name) = UPPER(${symbol})
      AND series = 'EQ'
      AND exchange_segment = 'NSECM'
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) throw new InstrumentNotFound(`EQ ${symbol}`);
  return rowToInstrument(row);
}

/**
 * Lookup futures contract by symbol + expiry.
 * Picks the row with matching expiry date (YYYY-MM-DD).
 * For NIFTY FUTIDX there can be multiple rows per expiry (different IDs); we pick the lowest ID.
 */
export async function lookupFuture(
  symbol: string,
  expiry: Date | string,
  seriesHint?: "FUTIDX" | "FUTSTK"
): Promise<XtsInstrument> {
  const expiryIso = typeof expiry === "string" ? expiry : expiry.toISOString();
  const series = seriesHint ?? [XTS_SERIES.FUT_INDEX, XTS_SERIES.FUT_STOCK];

  const result = await db.execute(sql`
    SELECT name, series, exchange_instrument_id, exchange_segment,
           display_name, lot_size, strike_price, option_type, contract_expiration
    FROM xts_instrument_master
    WHERE UPPER(name) = UPPER(${symbol})
      AND ${
        Array.isArray(series)
          ? sql`series IN ('FUTIDX','FUTSTK')`
          : sql`series = ${series}`
      }
      AND DATE(contract_expiration) = DATE(${expiryIso})
    ORDER BY CAST(exchange_instrument_id AS BIGINT) ASC
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) throw new InstrumentNotFound(`FUT ${symbol} ${expiryIso}`);
  return rowToInstrument(row);
}

/**
 * Lookup option contract by symbol + expiry + strike + CE/PE.
 */
export async function lookupOption(
  symbol: string,
  expiry: Date | string,
  strike: number,
  optionType: "CE" | "PE",
  seriesHint?: "OPTIDX" | "OPTSTK"
): Promise<XtsInstrument> {
  const expiryIso = typeof expiry === "string" ? expiry : expiry.toISOString();
  // xts_instrument_master stores option_type as "3" (CE) or "4" (PE)
  const numericOptionType = optionType === "CE" ? "3" : "4";

  const result = await db.execute(sql`
    SELECT name, series, exchange_instrument_id, exchange_segment,
           display_name, lot_size, strike_price, option_type, contract_expiration
    FROM xts_instrument_master
    WHERE UPPER(name) = UPPER(${symbol})
      AND ${
        seriesHint
          ? sql`series = ${seriesHint}`
          : sql`series IN ('OPTIDX','OPTSTK')`
      }
      AND DATE(contract_expiration) = DATE(${expiryIso})
      AND strike_price = ${strike}
      AND option_type = ${numericOptionType}
    ORDER BY CAST(exchange_instrument_id AS BIGINT) ASC
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) {
    throw new InstrumentNotFound(`OPT ${symbol} ${expiryIso} ${strike} ${optionType}`);
  }
  return rowToInstrument(row);
}

function rowToInstrument(row: any): XtsInstrument {
  return {
    exchangeSegment: row.exchange_segment,
    exchangeInstrumentID: String(row.exchange_instrument_id),
    name: row.name,
    series: row.series,
    displayName: row.display_name,
    lotSize: row.lot_size ?? null,
    strikePrice: row.strike_price != null ? Number(row.strike_price) : null,
    optionType: XTS_INSTRUMENT_MASTER_OPTION_TYPE[row.option_type] ?? null,
    contractExpiration: row.contract_expiration ? new Date(row.contract_expiration).toISOString() : null,
  };
}
