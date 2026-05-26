import 'server-only'

// lib/securityWait.ts
//
// Live TSA security wait times for Orlando International Airport (MCO).
// Talks to the public GOAA API at api.goaa.aero — same auth posture as
// lib/parking.ts (the `api-key` value is shipped in flymco.com's frontend
// JS, not a secret). Discovered via Playwright network sniff of
// flymco.com/security on 2026-05-24.
//
// Six entries (3 checkpoints × 2 lanes each):
//   West (Standard/PreCheck) — Terminal A (gates 1-59)
//   East (Standard/PreCheck) — Terminal B (gates 70-129)
//   South (Standard/PreCheck) — Terminal C (gates C230-C249)
//
// Cache: 60s in-memory module-level. Fine for a prototype; production
// would move to lib/runtimeCache.ts.

const WAITS_URL = 'https://api.goaa.aero/wait-times/checkpoint/MCO'
const PUBLIC_GOAA_KEY = '8eaac7209c824616a8fe58d22268cd59' // public site key, not a secret
const CACHE_TTL_MS = 60_000

export type Lane = 'general' | 'precheck' | string
export type Terminal = 'A' | 'B' | 'C' | null

export interface CheckpointWait {
  id: string                          // GOAA's id, e.g. "20466"
  name: string                        // GOAA's display name, e.g. "West Standard"
  lane: Lane
  isOpen: boolean
  waitSeconds: number | null          // current wait
  minWaitSeconds: number | null       // bounds
  maxWaitSeconds: number | null
  lastUpdatedTimestamp: number        // unix seconds
  minGate: string | null
  maxGate: string | null
  terminal: Terminal                  // derived from minGate via mapping below
}

interface GoaaWaitsResponse {
  data?: { wait_times?: any[] }
  status?: { code: number; message: string }
}

let cache: { at: number; rows: CheckpointWait[] } | null = null
let inFlight: Promise<CheckpointWait[]> | null = null

// Map GOAA gate ranges to MCO terminal letters. Confirmed by checking the
// gate-numbering convention on flymco.com/terminal-maps:
//   1-59     → Terminal A (West checkpoint)
//   70-129   → Terminal B (East checkpoint)
//   C100+    → Terminal C (South checkpoint, gates prefixed C)
function terminalFromGate(minGate: string | null): Terminal {
  if (!minGate) return null
  const g = String(minGate)
  if (/^C/i.test(g)) return 'C'
  const n = parseInt(g, 10)
  if (!Number.isNaN(n)) {
    if (n >= 1 && n <= 59) return 'A'
    if (n >= 70 && n <= 129) return 'B'
  }
  return null
}

async function fetchRaw(): Promise<any[]> {
  const key = process.env.GOAA_API_KEY || PUBLIC_GOAA_KEY
  const res = await fetch(WAITS_URL, {
    headers: {
      'api-key': key,
      'api-version': '140',
      'Referer': 'https://flymco.com/',
      'User-Agent': 'Sentimetrx-MCO/1.0',
    },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error('security_wait ' + res.status)
  const json = (await res.json()) as GoaaWaitsResponse
  return Array.isArray(json?.data?.wait_times) ? json.data!.wait_times! : []
}

async function load(): Promise<CheckpointWait[]> {
  const raw = await fetchRaw()
  return raw.map((r) => {
    const minGate = (r?.attributes?.minGate ?? null) as string | null
    const maxGate = (r?.attributes?.maxGate ?? null) as string | null
    return {
      id: String(r.id),
      name: String(r.name || ''),
      lane: typeof r.lane === 'string' ? r.lane : 'general',
      isOpen: !!r.isOpen,
      waitSeconds: typeof r.waitSeconds === 'number' ? r.waitSeconds : null,
      minWaitSeconds: typeof r.minWaitSeconds === 'number' ? r.minWaitSeconds : null,
      maxWaitSeconds: typeof r.maxWaitSeconds === 'number' ? r.maxWaitSeconds : null,
      lastUpdatedTimestamp: typeof r.lastUpdatedTimestamp === 'number' ? r.lastUpdatedTimestamp : 0,
      minGate,
      maxGate,
      terminal: terminalFromGate(minGate),
    }
  }).filter(r => r.isOpen || r.waitSeconds != null) // hide closed-and-empty rows
}

const FAILURE_BACKOFF_MS = 30_000

/**
 * Live TSA security wait times for MCO. 60s in-memory cache. Dedupes
 * concurrent callers via an in-flight promise. Returns whatever is cached
 * (even if stale) on upstream failure; empty array if nothing cached.
 * After a failed refresh we hold the stale cache for FAILURE_BACKOFF_MS
 * before retrying, so a hot Vercel instance doesn't hammer GOAA when
 * upstream is flaky.
 */
export async function fetchSecurityWaits(): Promise<CheckpointWait[]> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.rows
  if (inFlight) return inFlight
  inFlight = load()
    .then((rows) => {
      cache = { at: Date.now(), rows }
      return rows
    })
    .catch(() => {
      if (cache) cache.at = Date.now() - (CACHE_TTL_MS - FAILURE_BACKOFF_MS)
      return cache?.rows || []
    })
    .finally(() => { inFlight = null })
  return inFlight
}
