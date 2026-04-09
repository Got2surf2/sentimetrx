// Simple in-memory rate limiter for serverless API routes.
// Resets on cold starts — sufficient for basic abuse prevention.
// For production-grade rate limiting, use Vercel Edge Middleware + KV.

var buckets: Record<string, { count: number; resetAt: number }> = {}

// Clean expired buckets every 60s to prevent memory leak
var lastClean = Date.now()
function cleanExpired() {
  var now = Date.now()
  if (now - lastClean < 60000) return
  lastClean = now
  var keys = Object.keys(buckets)
  for (var i = 0; i < keys.length; i++) {
    if (buckets[keys[i]].resetAt < now) delete buckets[keys[i]]
  }
}

/**
 * Check if a request should be rate-limited.
 * @param key - Unique identifier (e.g., IP address, user ID)
 * @param maxRequests - Max requests allowed in the window
 * @param windowMs - Time window in milliseconds (default 60s)
 * @returns { limited: boolean, remaining: number }
 */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number = 60000): { limited: boolean; remaining: number } {
  cleanExpired()
  var now = Date.now()
  var bucket = buckets[key]
  if (!bucket || bucket.resetAt < now) {
    buckets[key] = { count: 1, resetAt: now + windowMs }
    return { limited: false, remaining: maxRequests - 1 }
  }
  bucket.count++
  if (bucket.count > maxRequests) {
    return { limited: true, remaining: 0 }
  }
  return { limited: false, remaining: maxRequests - bucket.count }
}
