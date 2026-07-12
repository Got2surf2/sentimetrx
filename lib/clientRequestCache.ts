// lib/clientRequestCache.ts
// Tiny in-memory promise cache for analyze-tab metadata fetches.
//
// The /analyze/[id] tabs are separate route segments: the shared layout
// (rows, metric strip) persists across tab switches, but each tab's MODULE
// unmounts/remounts — so module-level fetches whose inputs didn't change
// re-fire on every Themes ↔ Charts ↔ Stats bounce. For server-computed
// aggregates (theme-counts is a per-theme SQL scan per request) that's the
// same result recomputed over and over (first-open efficiency audit,
// 2026-07-11).
//
// Cache keys must capture EVERY input (URL + full request body) so a changed
// theme model or field selection is a different key, never a stale hit. The
// cache clears on the theme-model change events and after a short TTL — it
// only needs to survive tab navigation, not a working session.
//
// Client-bundleable by design (no server-only imports). Callers pass a loader
// so this file knows nothing about fetch shapes. Failed loads are evicted so
// a transient error isn't cached.

const TTL_MS = 5 * 60 * 1000

const cache = new Map<string, { at: number; promise: Promise<unknown> }>()

let listenersInstalled = false
function installListeners() {
  if (listenersInstalled || typeof window === 'undefined') return
  listenersInstalled = true
  // Same events the metric strip refreshes on — any theme-model persist.
  for (const ev of ['dataset-themes-saved', 'ana-themes-changed']) {
    window.addEventListener(ev, function() { cache.clear() })
  }
}

export function cachedRequest<T>(key: string, loader: () => Promise<T>): Promise<T> {
  installListeners()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise as Promise<T>
  const promise = loader().catch(err => {
    if (cache.get(key)?.promise === promise) cache.delete(key)
    throw err
  })
  cache.set(key, { at: Date.now(), promise })
  return promise
}
