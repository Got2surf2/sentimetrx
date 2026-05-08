-- 039: Persistent rate-limit storage + atomic check_rate_limit RPC
--
-- Replaces the in-memory bucket map in lib/rateLimit.ts. The previous
-- implementation reset on every cold start and was per-instance, so an
-- attacker hitting public AI endpoints (bot chat, townhall chat, etc.)
-- could bypass the limit by spreading load across function instances.
-- That's a cost-amplification risk against Anthropic billing.
--
-- This migration introduces a shared Postgres-backed bucket. The RPC
-- atomically increments via INSERT ... ON CONFLICT DO UPDATE, so two
-- concurrent requests cannot both observe an expired bucket and reset
-- the counter.
--
-- Apply via Supabase SQL Editor (staging + prod). The TS client falls
-- back to in-memory if the RPC is unreachable, so the deploy + migration
-- can land in either order.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key       TEXT PRIMARY KEY,
  count     INT  NOT NULL,
  reset_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_reset
  ON rate_limit_buckets(reset_at);

-- No RLS policies = no anon / authenticated access. The RPC below is
-- SECURITY DEFINER and granted to service_role only; that's the sole
-- legitimate path to read or write this table.
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key          TEXT,
  p_max_requests INT,
  p_window_ms    INT DEFAULT 60000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now    TIMESTAMPTZ := now();
  v_count  INT;
  v_reset  TIMESTAMPTZ;
BEGIN
  INSERT INTO rate_limit_buckets(key, count, reset_at)
  VALUES (p_key, 1, v_now + (p_window_ms::text || ' ms')::interval)
  ON CONFLICT (key) DO UPDATE SET
    count    = CASE
                 WHEN rate_limit_buckets.reset_at < v_now THEN 1
                 ELSE rate_limit_buckets.count + 1
               END,
    reset_at = CASE
                 WHEN rate_limit_buckets.reset_at < v_now
                   THEN v_now + (p_window_ms::text || ' ms')::interval
                 ELSE rate_limit_buckets.reset_at
               END
  RETURNING count, reset_at INTO v_count, v_reset;

  RETURN jsonb_build_object(
    'limited',   v_count > p_max_requests,
    'remaining', GREATEST(0, p_max_requests - v_count),
    'reset_at',  v_reset
  );
END;
$$;

REVOKE ALL    ON FUNCTION check_rate_limit(TEXT, INT, INT) FROM public;
GRANT  EXECUTE ON FUNCTION check_rate_limit(TEXT, INT, INT) TO service_role;

-- Sweep expired buckets opportunistically. Safe to call from a cron;
-- not strictly required because old buckets are inert (overwritten on
-- next hit for the same key).
CREATE OR REPLACE FUNCTION cleanup_rate_limit_buckets()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count int;
BEGIN
  DELETE FROM rate_limit_buckets
  WHERE reset_at < now() - interval '1 hour';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL    ON FUNCTION cleanup_rate_limit_buckets() FROM public;
GRANT  EXECUTE ON FUNCTION cleanup_rate_limit_buckets() TO service_role;
