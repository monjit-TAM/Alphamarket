-- ============================================================
-- AlphaMarket Broker Integration v2 — Schema Migration
-- Phase A: Add columns for slug-based strategy IDs, webhook payload
--          versioning, segment/strategy scoping on broker API keys
-- ============================================================
-- This script is IDEMPOTENT — safe to run multiple times.
-- ============================================================

BEGIN;

-- ─── strategies.slug — for Upstox's expected "street-calls" / "growth>365" style IDs ───
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS slug text;

-- Index for fast lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategies_slug ON strategies (slug) WHERE slug IS NOT NULL;

COMMENT ON COLUMN strategies.slug IS
  'Human-readable strategy identifier used in broker webhook payloads (Format A). Auto-generated from name on first save. Editable via admin. Unique when set.';

-- Backfill: auto-generate slugs for existing strategies where slug is null
-- Pattern: lower-case + replace non-alphanumerics with '-' + collapse multiple '-' + trim
UPDATE strategies
SET slug = regexp_replace(
  regexp_replace(
    lower(trim(name)),
    '[^a-z0-9]+', '-', 'g'
  ),
  '(^-+|-+$)', '', 'g'
)
WHERE slug IS NULL AND name IS NOT NULL;

-- Handle duplicate slugs by appending short id suffix
-- (unlikely but possible if two strategies have similar names)
WITH dups AS (
  SELECT slug, COUNT(*) as cnt
  FROM strategies
  WHERE slug IS NOT NULL
  GROUP BY slug
  HAVING COUNT(*) > 1
),
offenders AS (
  SELECT s.id, s.slug, ROW_NUMBER() OVER (PARTITION BY s.slug ORDER BY s.created_at NULLS LAST, s.id) as rn
  FROM strategies s
  WHERE s.slug IN (SELECT slug FROM dups)
)
UPDATE strategies AS s
SET slug = o.slug || '-' || substring(s.id, 1, 6)
FROM offenders o
WHERE s.id = o.id AND o.rn > 1;

-- ─── broker_api_keys additions ───

ALTER TABLE broker_api_keys
  ADD COLUMN IF NOT EXISTS webhook_payload_version text DEFAULT 'v1_flat';

COMMENT ON COLUMN broker_api_keys.webhook_payload_version IS
  'Webhook payload shape. v1_flat = current simple {event, timestamp, data}. v1_thealphamarket = Format A matching thealphamarket.com legacy. New brokers can opt into either.';

ALTER TABLE broker_api_keys
  ADD COLUMN IF NOT EXISTS allowed_segments text[] DEFAULT NULL;

COMMENT ON COLUMN broker_api_keys.allowed_segments IS
  'Array of segment codes this broker is allowed to see. NULL/empty = all segments. Values: equity_cash, equity_intraday, equity_swing, equity_positional, fno_futures, fno_options.';

ALTER TABLE broker_api_keys
  ADD COLUMN IF NOT EXISTS allowed_strategies text[] DEFAULT NULL;

COMMENT ON COLUMN broker_api_keys.allowed_strategies IS
  'Array of strategy IDs this broker is allowed to see. NULL/empty = no strategy-level restriction (advisor+segment filters still apply).';

ALTER TABLE broker_api_keys
  ADD COLUMN IF NOT EXISTS webhook_timeout_ms integer DEFAULT 10000;

COMMENT ON COLUMN broker_api_keys.webhook_timeout_ms IS
  'Max time to wait for broker webhook response. Default 10s. Per-broker configurable.';

-- ─── Verification ───

SELECT 'strategies.slug backfilled: ' ||
  (SELECT COUNT(*) FROM strategies WHERE slug IS NOT NULL) || ' / ' ||
  (SELECT COUNT(*) FROM strategies) as status;

SELECT 'broker_api_keys columns added. Preview:' as msg;
SELECT broker_name, webhook_payload_version, allowed_segments, allowed_strategies, webhook_timeout_ms
FROM broker_api_keys;

COMMIT;
