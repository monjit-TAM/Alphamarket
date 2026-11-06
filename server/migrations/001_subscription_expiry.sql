-- Migration: Add subscription expiry columns and backfill from payments
-- Run this manually on the production database

-- Step 1: Add columns (safe, no locks)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS starts_at TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

-- Step 2: Backfill starts_at from the payment's paid_at date
UPDATE subscriptions s
SET starts_at = p.paid_at
FROM payments p
WHERE p.subscription_id = s.id
  AND p.status = 'PAID'
  AND p.paid_at IS NOT NULL
  AND s.starts_at IS NULL;

-- Step 3: Backfill expires_at from starts_at + plan duration_days
UPDATE subscriptions s
SET expires_at = s.starts_at + (pl.duration_days || ' days')::INTERVAL
FROM plans pl
WHERE pl.id = s.plan_id
  AND pl.duration_days IS NOT NULL
  AND s.starts_at IS NOT NULL
  AND s.expires_at IS NULL;

-- Step 4: Expire subscriptions that are past their expiry date
UPDATE subscriptions
SET status = 'expired'
WHERE status = 'active'
  AND expires_at IS NOT NULL
  AND expires_at <= NOW();

-- Step 5: Verify
SELECT
  s.id,
  s.user_id,
  s.strategy_id,
  s.status,
  s.starts_at,
  s.expires_at,
  pl.duration_days,
  pl.name as plan_name
FROM subscriptions s
JOIN plans pl ON pl.id = s.plan_id
ORDER BY s.created_at DESC
LIMIT 20;
