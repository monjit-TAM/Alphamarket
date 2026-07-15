-- migrations/basket-broker-tables.sql
--
-- Model-portfolio basket -> broker publishing.
--
-- SAFETY: This migration ONLY creates new tables. It does not ALTER, DROP, or
-- otherwise touch any existing table. In particular it does not touch:
--   positions, calls, broker_webhook_logs, broker_api_keys,
--   broker_advisor_mappings, broker_connections, strategies, basket_*,
--   advisor_basket_strategies, xts_publish_log
--
-- The live Upstox/Dreamstreet recommendation webhook path is unaffected.
--
-- Run:  sudo -u postgres psql -d alphamarket_db -f migrations/basket-broker-tables.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- broker_basket_state
--
-- ONE ROW PER (basket, broker). Mutable. This is the state machine.
--
-- Without this, we cannot choose between CREATED / REBALANCED / CLOSED, and
-- every retry after a successful CREATE would 409. The publish log alone
-- cannot answer "what version does the broker currently think this is at?"
--
-- Per-broker (not per-basket) by design: the same basket can be listed on
-- Upstox, executable on XTS, and rejected by a third — each with independent
-- sync state.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broker_basket_state (
  strategy_id           varchar     NOT NULL REFERENCES strategies(id),
  broker_type           text        NOT NULL,   -- 'UPSTOX_BASKET' | 'XTS_BASKET' | ...
  broker_connection_id  uuid        REFERENCES broker_connections(id) ON DELETE SET NULL,

  -- never_sent | created | closed
  sync_state            text        NOT NULL DEFAULT 'never_sent',

  -- The version the BROKER reports back (data.version). May diverge from our
  -- basket_rebalances.version; theirs is authoritative for their platform.
  broker_version        integer,

  -- Which of OUR rebalance versions was last successfully synced. Comparing
  -- this against the latest basket_rebalances.id is how we detect drift.
  last_rebalance_id     varchar     REFERENCES basket_rebalances(id) ON DELETE SET NULL,
  last_synced_version   integer,

  last_synced_at        timestamptz,
  last_error            text,
  last_attempt_at       timestamptz,

  -- Admin kill switch. Nothing dispatches for this basket+broker while false.
  is_enabled            boolean     NOT NULL DEFAULT false,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (strategy_id, broker_type),
  CONSTRAINT broker_basket_state_sync_state_chk
    CHECK (sync_state IN ('never_sent', 'created', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_bbs_broker      ON broker_basket_state(broker_type);
CREATE INDEX IF NOT EXISTS idx_bbs_sync_state  ON broker_basket_state(sync_state);
CREATE INDEX IF NOT EXISTS idx_bbs_enabled     ON broker_basket_state(is_enabled);


-- ─────────────────────────────────────────────────────────────────
-- broker_basket_publish_log
--
-- APPEND-ONLY. One row per dispatch attempt — success, failure, validation
-- rejection, or skip. Never silently drops a record.
--
-- Mirrors the xts_publish_log pattern (including the delete-prevention rule),
-- but is a separate table so nothing here can affect that log or the calls it
-- audits.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broker_basket_publish_log (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  strategy_id           varchar     REFERENCES strategies(id) ON DELETE SET NULL,
  advisor_id            varchar     REFERENCES users(id) ON DELETE SET NULL,
  rebalance_id          varchar     REFERENCES basket_rebalances(id) ON DELETE SET NULL,
  broker_connection_id  uuid        REFERENCES broker_connections(id) ON DELETE SET NULL,

  broker_type           text        NOT NULL,
  -- CREATED | MODIFIED | REBALANCED | CLOSED
  basket_status         text        NOT NULL,
  -- Our version at time of send.
  version               integer,

  -- The correlation id we sent as X-Request-Id. This is the ONLY handle
  -- Upstox support will accept when investigating a failed request.
  x_request_id          text        NOT NULL,

  payload               jsonb,
  response              jsonb,
  http_status           integer,

  -- pending | success | terminal | conflict | retryable | validation_failed | skipped
  --
  -- 'terminal' is deliberately distinct from 'retryable'. A 410 (bad weight
  -- sum, SELL leg on create) can never succeed as-is; putting it in a backoff
  -- loop means hammering the broker forever. Any retry worker MUST filter on
  -- status = 'retryable' and nothing else.
  status                text        NOT NULL DEFAULT 'pending',
  error_message         text,
  retry_count           integer     NOT NULL DEFAULT 0,

  -- Who/what triggered this. 'admin' | 'advisor' | 'scheduler' | 'reconcile'
  triggered_by          text,
  triggered_by_user_id  varchar     REFERENCES users(id) ON DELETE SET NULL,

  published_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bbpl_status_chk CHECK (
    status IN ('pending','success','terminal','conflict','retryable','validation_failed','skipped')
  )
);

CREATE INDEX IF NOT EXISTS idx_bbpl_strategy   ON broker_basket_publish_log(strategy_id);
CREATE INDEX IF NOT EXISTS idx_bbpl_broker     ON broker_basket_publish_log(broker_type);
CREATE INDEX IF NOT EXISTS idx_bbpl_status     ON broker_basket_publish_log(status);
CREATE INDEX IF NOT EXISTS idx_bbpl_published  ON broker_basket_publish_log(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_bbpl_request_id ON broker_basket_publish_log(x_request_id);

-- Audit trail is immutable, same as xts_publish_log.
CREATE OR REPLACE RULE prevent_bbpl_delete AS
  ON DELETE TO broker_basket_publish_log DO INSTEAD NOTHING;

COMMIT;


-- ─────────────────────────────────────────────────────────────────
-- SEED (run separately, once you have credentials from Upstox)
--
-- broker_connections already has every column needed. The XTS adapter filters
-- on broker_type = 'XTS', so it will never see this row — zero impact.
--
-- Column mapping for the Upstox basket API:
--   base_url    -> https://callback-uat.upstox.com  (staging)
--                  https://callback.upstox.com      (production)
--   vendor_code -> X-Vendor-Id header       (doc example: "ALPMKT")
--   vendor_key  -> {vendorName} URL segment (doc example: "algo-bazar")
--   token       -> the Bearer token Upstox issues at vendor onboarding
--
-- NOTE: this Bearer token is NOT the same credential as the live recommendation
-- webhook. That one is INBOUND (broker_api_keys.api_secret — Upstox
-- authenticates to us). The basket API is OUTBOUND — we authenticate to them.
-- As of this migration we do not hold one; it must be requested.
--
-- The adapter refuses to dispatch while token IS NULL, so this row is safe to
-- create before the credential arrives.
-- ─────────────────────────────────────────────────────────────────
--
-- INSERT INTO broker_connections
--   (name, broker_type, base_url, vendor_code, vendor_key, is_enabled, token, notes)
-- VALUES
--   ('Upstox Baskets (UAT)',
--    'UPSTOX_BASKET',
--    'https://callback-uat.upstox.com',
--    'ALPMKT',            -- CONFIRM with Upstox
--    'alphamarket',       -- CONFIRM with Upstox ({vendorName} path segment)
--    true,
--    NULL,                -- Bearer token — PENDING from Upstox
--    'Vendor Equity Basket API. Model portfolios only (NSE_EQ, BUY-only on create, non-intraday). Separate from the recommendation webhook.'
--   );
