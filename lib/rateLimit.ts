// Postgres-backed rate limiter. Buckets live in rate_limit_buckets
// (shared across cold starts and function instances) and are mutated
// atomically by the check_rate_limit RPC. If the DB call fails for any
// reason, we fall back to an in-process map so the route does not lose
// rate limiting entirely. The fallback is intentionally permissive —
// per-instance state is already what we're trying to escape — and only
// activates on outage.

import { createServiceRoleClient } from '@/lib/supabase/server'

var memBuckets: Record<string, { count: number; resetAt: number }> = {}
var lastClean = Date.now()

function memCheck(key: string, maxRequests: number, windowMs: number): { limited: boolean; remaining: number } {
  var now = Date.now()
  if (now - lastClean > 60000) {
    lastClean = now
    var keys = Object.keys(memBuckets)
    for (var i = 0; i < keys.length; i++) {
      if (memBuckets[keys[i]].resetAt < now) delete memBuckets[keys[i]]
    }
  }
  var bucket = memBuckets[key]
  if (!bucket || bucket.resetAt < now) {
    memBuckets[key] = { count: 1, resetAt: now + windowMs }
    return { limited: false, remaining: maxRequests - 1 }
  }
  bucket.count++
  if (bucket.count > maxRequests) return { limited: true, remaining: 0 }
  return { limited: false, remaining: maxRequests - bucket.count }
}

/**
 * Check whether a request should be rate-limited.
 *
 * @param key          Unique identifier (typically `<route>:<ip>`).
 * @param maxRequests  Max requests permitted in the window.
 * @param windowMs     Window length in milliseconds (default 60s).
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number = 60000
): Promise<{ limited: boolean; remaining: number }> {
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key:          key,
      p_max_requests: maxRequests,
      p_window_ms:    windowMs,
    })
    if (error) throw error
    if (data && typeof data === 'object') {
      const d = data as any
      return {
        limited:   !!d.limited,
        remaining: Number(d.remaining) || 0,
      }
    }
  } catch {
    // RPC missing, network blip, env misconfig — degrade rather than fail open.
  }
  return memCheck(key, maxRequests, windowMs)
}
