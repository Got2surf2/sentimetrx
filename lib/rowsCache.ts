// lib/rowsCache.ts
// Client-side IndexedDB cache for the bulk rows payload (PERF §8 follow-up,
// 2026-09-02). First-open of a big dataset costs a ~10-90MB fetch + parse;
// REOPENING one paid it all again. This caches the FINAL processed rows
// (post value-alias / signal-tier injection) per dataset, keyed by a
// freshness string, so a repeat open hydrates locally in ~1-2s.
//
// Freshness = row_count : last_synced_at : hash(schemaFields). The schema is
// part of the key because aliases are baked into the cached rows and
// ignore/hidden fields shape the server payload (sql/186 dropKeys) — any
// schema edit must invalidate. Rows changing without a row_count move bumps
// last_synced_at (same contract sql/194 filter_options relies on).
//
// Every IDB touch is best-effort: quota errors, private-browsing restrictions
// and SSR all degrade to "no cache", never to a broken load.

export interface CachedRowsPayload {
  rows: Record<string, unknown>[]
  totalRows: number
  sampled: boolean
}

const DB_NAME = 'sentimetrx-rows-cache'
const STORE = 'bulk'
const MAX_ENTRIES = 4 // most-recent datasets kept; older entries pruned on write

function h32(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Deterministic freshness key — same inputs, same key. */
export function rowsFreshness(
  rowCount: number,
  lastSyncedAt: string | null | undefined,
  schemaFields: unknown,
): string {
  return `${rowCount}:${lastSyncedAt || ''}:${h32(JSON.stringify(schemaFields ?? null))}`
}

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'datasetId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Cached payload for the dataset IF its freshness matches; null otherwise. */
export async function readRowsCache(datasetId: string, freshness: string): Promise<CachedRowsPayload | null> {
  if (!idbAvailable()) return null
  try {
    const db = await openDb()
    const entry = await new Promise<{ freshness?: string; payload?: CachedRowsPayload } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(datasetId)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    if (entry && entry.freshness === freshness && entry.payload && Array.isArray(entry.payload.rows)) {
      return entry.payload
    }
    return null
  } catch {
    return null
  }
}

/** Store the payload (best-effort) and prune to the MAX_ENTRIES most recent. */
export async function writeRowsCache(datasetId: string, freshness: string, payload: CachedRowsPayload): Promise<void> {
  if (!idbAvailable()) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ datasetId, freshness, savedAt: Date.now(), payload })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error) // quota exceeded aborts the tx
    })
    // Prune oldest entries beyond the cap (separate tx; failures ignored).
    const entries = await new Promise<{ datasetId: string; savedAt: number }[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result || []) as { datasetId: string; savedAt: number }[])
      req.onerror = () => reject(req.error)
    })
    if (entries.length > MAX_ENTRIES) {
      const stale = entries.sort((a, b) => b.savedAt - a.savedAt).slice(MAX_ENTRIES)
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite')
        for (const e of stale) tx.objectStore(STORE).delete(e.datasetId)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
    }
    db.close()
  } catch { /* quota / private mode / anything — cache is optional */ }
}
