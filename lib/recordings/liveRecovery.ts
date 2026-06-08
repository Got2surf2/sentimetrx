// lib/recordings/liveRecovery.ts
//
// Client-side crash durability for Town Hall live capture (§ 15, hardening item 1).
// As the meeting records, each MediaRecorder chunk is mirrored into IndexedDB.
// If the tab crashes / is refreshed / closed before Stop, the chunks persist;
// reopening the live page detects them and offers to upload + process the
// recovered audio. On a normal Stop (or a successful recovery) the store is
// cleared. Best-effort — if IndexedDB is unavailable, recovery simply no-ops.

const DB_NAME = 'townhall-live'
const CHUNKS = 'chunks'
const META = 'meta'
const VERSION = 1

export interface PendingLive {
  recordingId: string
  chunks: Blob[]
  mime: string
  bytes: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no indexedDB'))
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(CHUNKS)) {
          const s = db.createObjectStore(CHUNKS, { autoIncrement: true })
          s.createIndex('recordingId', 'recordingId', { unique: false })
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'recordingId' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

/** Append one recorded chunk. Awaited internally; callers should serialize to keep order. */
export async function appendLiveChunk(recordingId: string, blob: Blob, mime: string): Promise<void> {
  try {
    const db = await getDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([CHUNKS, META], 'readwrite')
      tx.objectStore(CHUNKS).add({ recordingId, blob })
      tx.objectStore(META).put({ recordingId, mime })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch { /* best-effort durability */ }
}

/** Return any persisted chunks for a recording (from an interrupted session), or null. */
export async function getPendingLive(recordingId: string): Promise<PendingLive | null> {
  try {
    const db = await getDb()
    const [chunks, mime] = await Promise.all([
      new Promise<Blob[]>((resolve, reject) => {
        const tx = db.transaction(CHUNKS, 'readonly')
        const idx = tx.objectStore(CHUNKS).index('recordingId')
        const req = idx.getAll(recordingId)
        req.onsuccess = () => resolve((req.result as Array<{ blob: Blob }>).map(r => r.blob))
        req.onerror = () => reject(req.error)
      }),
      new Promise<string>((resolve) => {
        const tx = db.transaction(META, 'readonly')
        const req = tx.objectStore(META).get(recordingId)
        req.onsuccess = () => resolve((req.result as { mime?: string } | undefined)?.mime || 'audio/webm')
        req.onerror = () => resolve('audio/webm')
      }),
    ])
    if (!chunks.length) return null
    const bytes = chunks.reduce((sum, b) => sum + b.size, 0)
    if (bytes === 0) return null
    return { recordingId, chunks, mime, bytes }
  } catch {
    return null
  }
}

/** Drop a recording's persisted chunks (normal Stop, successful recovery, or discard). */
export async function clearLiveChunks(recordingId: string): Promise<void> {
  try {
    const db = await getDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([CHUNKS, META], 'readwrite')
      const idx = tx.objectStore(CHUNKS).index('recordingId')
      const req = idx.openCursor(recordingId)
      req.onsuccess = () => {
        const cur = req.result
        if (cur) { cur.delete(); cur.continue() }
      }
      tx.objectStore(META).delete(recordingId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch { /* best-effort */ }
}
