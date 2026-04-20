/**
 * server/broker-integrations/xts/config.ts
 *
 * Load the per-connection payload config from broker_connections.payload_config
 * (jsonb column). This lets us experiment with different payload formats
 * without code changes — once we know the correct format, we set it here.
 */

import { BUILD_CONFIG_DEFAULT, type BuildConfig } from "./payload-builder";
import type { InstrumentIdStrategy, ExchangeFieldFormat } from "./spec";

/**
 * Merge a partial config object (from DB) with defaults.
 */
export function buildConfigFromDb(dbConfig: any): BuildConfig {
  if (!dbConfig || typeof dbConfig !== "object") {
    return { ...PRESET_CURRENT };
  }

  const result: BuildConfig = { ...BUILD_CONFIG_DEFAULT };

  if (
    typeof dbConfig.instrumentIdStrategy === "string" &&
    ["symbol", "numeric_from_master", "numeric_with_segment_override"].includes(dbConfig.instrumentIdStrategy)
  ) {
    result.instrumentIdStrategy = dbConfig.instrumentIdStrategy as InstrumentIdStrategy;
  }

  if (
    typeof dbConfig.exchangeFieldFormat === "string" &&
    ["NSE", "NSECM", "NSEFO"].includes(dbConfig.exchangeFieldFormat)
  ) {
    result.exchangeFieldFormat = dbConfig.exchangeFieldFormat as ExchangeFieldFormat;
  }

  if (typeof dbConfig.useExchangeSegmentField === "boolean") {
    result.useExchangeSegmentField = dbConfig.useExchangeSegmentField;
  }
  if (typeof dbConfig.emitTopLevelSegment === "boolean") {
    result.emitTopLevelSegment = dbConfig.emitTopLevelSegment;
  }
  if (typeof dbConfig.truncateTheoryChars === "number" && dbConfig.truncateTheoryChars > 0) {
    result.truncateTheoryChars = dbConfig.truncateTheoryChars;
  }
  if (typeof dbConfig.asciiOnlyTheory === "boolean") {
    result.asciiOnlyTheory = dbConfig.asciiOnlyTheory;
  }

  return result;
}

/**
 * Config presets for quick switching. Each represents a hypothesis we've tested.
 * If we later discover the right format, we set `PRESET_CURRENT` to it.
 */
export const CONFIG_PRESETS = {
  // What used to work on Apr 1/9 and part of Apr 13 (we think)
  LEGACY_SYMBOL_NSE: {
    instrumentIdStrategy: "symbol" as InstrumentIdStrategy,
    exchangeFieldFormat: "NSE" as ExchangeFieldFormat,
    useExchangeSegmentField: false,
    emitTopLevelSegment: false,
  },
  // Symphony Interactive convention — segment code + numeric ID
  SYMPHONY_NUMERIC_SEGMENT: {
    instrumentIdStrategy: "numeric_from_master" as InstrumentIdStrategy,
    exchangeFieldFormat: "NSECM" as ExchangeFieldFormat,
    useExchangeSegmentField: true,
    emitTopLevelSegment: true,
  },

  // Confirmed by Shashank on 20 Apr 2026 call — exact format XTS expects
  SHASHANK_CONFIRMED_20260420: {
    instrumentIdStrategy: "numeric_from_master" as InstrumentIdStrategy,
    exchangeFieldFormat: "NSECM" as ExchangeFieldFormat,
    useExchangeSegmentField: false,  // field name: "exchange" (not exchangeSegment)
    emitTopLevelSegment: false,       // no top-level exchangeSegment field
  },
    // Numeric ID but keep "exchange" field name
  NUMERIC_WITH_NSE: {
    instrumentIdStrategy: "numeric_from_master" as InstrumentIdStrategy,
    exchangeFieldFormat: "NSE" as ExchangeFieldFormat,
    useExchangeSegmentField: false,
    emitTopLevelSegment: false,
  },
};

export const PRESET_CURRENT = CONFIG_PRESETS.SHASHANK_CONFIRMED_20260420;
