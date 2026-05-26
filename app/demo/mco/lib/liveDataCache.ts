// app/demo/mco/lib/liveDataCache.ts
//
// Tiny localStorage helper used by the live-data cards (Parking, Security,
// WelcomeCard's parking strip) so that:
//   1. On mount, the card immediately shows the last-good response —
//      no "Loading…" flash, no blank state on remount.
//   2. When a refetch returns empty (e.g. transient GOAA hiccup, cold
//      Vercel instance), the card keeps showing the prior data instead
//      of blanking.
//   3. Freshness is reported using the actual per-row `lastUpdatedTimestamp`
//      from GOAA (max across rows = the most recent upstream refresh),
//      not our server-call time. Anything older than STALE_THRESHOLD_S
//      paints a "Last known status — N min ago" warning in amber.
//
// Plain JSON in window.localStorage; quotas are tiny here (a few KB total).

export const STALE_THRESHOLD_S = 5 * 60 // 5 minutes

export function loadCache<T>(key: string): { payload: T; saved_at: number } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.saved_at !== 'number') return null
    return parsed as { payload: T; saved_at: number }
  } catch { return null }
}

export function saveCache<T>(key: string, payload: T): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify({ payload, saved_at: Math.floor(Date.now() / 1000) }))
  } catch { /* quota or disabled — ignore */ }
}

// Pick the most recent unix-second timestamp from a list. Returns 0 if empty.
export function maxTimestamp(times: Array<number | null | undefined>): number {
  let max = 0
  for (const t of times) if (typeof t === 'number' && t > max) max = t
  return max
}

export function relativeTime(unixSeconds: number): string {
  if (!unixSeconds) return ''
  const ms = Date.now() - unixSeconds * 1000
  if (ms < 60_000) return Math.max(0, Math.floor(ms / 1000)) + ' sec ago'
  if (ms < 3_600_000) return Math.floor(ms / 60_000) + ' min ago'
  return Math.floor(ms / 3_600_000) + ' h ago'
}

export function isStale(unixSeconds: number): boolean {
  if (!unixSeconds) return false
  return Date.now() / 1000 - unixSeconds > STALE_THRESHOLD_S
}
