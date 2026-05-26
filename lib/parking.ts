import 'server-only'

// lib/parking.ts
//
// Live parking availability for Orlando International Airport (MCO).
// Talks to the public GOAA API at api.goaa.aero — the same endpoint flymco.com
// uses to power its /parking-availability grid. Discovered via a Playwright
// network sniff (see W21 devlog entry).
//
// The `api-key` value is NOT a secret: it's shipped in the public frontend
// JavaScript on flymco.com, identical for every visitor. We read it from
// GOAA_API_KEY env var for cleanliness, falling back to the known public
// value so the demo works without any env setup.
//
// Cache: 60 seconds, in-memory module-level. Fine for a single-region
// prototype. Production would use lib/runtimeCache.ts (Vercel Runtime Cache,
// shared across function instances per region) — flagged in MCO_AGENT.md §6.3.

const AVAILABILITY_URL = 'https://api.goaa.aero/parking/availability/MCO'
const RATES_URL = 'https://api.goaa.aero/parking/rates/MCO'
const PUBLIC_GOAA_KEY = '8eaac7209c824616a8fe58d22268cd59' // public site key, not a secret
const CACHE_TTL_MS = 60_000

export interface ParkingLot {
  id: string                        // GOAA's id, e.g. "parking-garage-c"
  name: string                      // GOAA's display name
  category: string                  // "garage" | "economy" | "cell_phone" | "hotel" | "surface" | …
  status: 'open' | 'closed' | string
  available: number | null          // null when the live counter isn't wired
  occupied: number | null
  total: number | null
  terminalId: string | null         // "a" | "b" | "c" | null
  terminalName: string | null
  lastUpdatedTimestamp: number      // unix seconds
  rate: { hourly?: string; daily?: string } | null   // joined from /rates
}

interface GoaaAvailabilityResponse {
  data?: { parkingAvailability?: any[] }
  status?: { code: number; message: string }
}
interface GoaaRatesResponse {
  data?: { rates?: any[] }
  status?: { code: number; message: string }
}

let cache: { at: number; lots: ParkingLot[] } | null = null
let inFlight: Promise<ParkingLot[]> | null = null

async function fetchAvailability(): Promise<any[]> {
  const key = process.env.GOAA_API_KEY || PUBLIC_GOAA_KEY
  const res = await fetch(AVAILABILITY_URL, {
    headers: {
      'api-key': key,
      // GOAA requires an api-version header. 140 is what flymco.com's
      // frontend currently sends (verified via Playwright network sniff
      // on 2026-05-21). When GOAA deprecates a version it returns
      // 412 "API version is no longer supported!" — bump this constant.
      'api-version': '140',
      'Referer': 'https://flymco.com/',
      'User-Agent': 'Sentimetrx-MCO/1.0',
    },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error('availability ' + res.status)
  const json = (await res.json()) as GoaaAvailabilityResponse
  return Array.isArray(json?.data?.parkingAvailability) ? json.data!.parkingAvailability! : []
}

async function fetchRates(): Promise<Record<string, ParkingLot['rate']>> {
  const key = process.env.GOAA_API_KEY || PUBLIC_GOAA_KEY
  try {
    const res = await fetch(RATES_URL, {
      headers: {
      'api-key': key,
      // GOAA requires an api-version header. 140 is what flymco.com's
      // frontend currently sends (verified via Playwright network sniff
      // on 2026-05-21). When GOAA deprecates a version it returns
      // 412 "API version is no longer supported!" — bump this constant.
      'api-version': '140',
      'Referer': 'https://flymco.com/',
      'User-Agent': 'Sentimetrx-MCO/1.0',
    },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return {}
    const json = (await res.json()) as GoaaRatesResponse
    const out: Record<string, ParkingLot['rate']> = {}
    for (const r of (json?.data?.rates || [])) {
      // Rates come as a flat array with one row per (lot, tier). For v1 we
      // just take the "default" tier's `rate` string and label it as daily
      // (matches what flymco.com's parking-rates page shows). Future: pull
      // out hourly + daily separately by looking at GOAA's tier strings.
      if (r?.tier !== 'default') continue
      out[r.id] = { daily: String(r.rate) }
    }
    return out
  } catch {
    return {}
  }
}

async function load(): Promise<ParkingLot[]> {
  const [avail, rates] = await Promise.all([fetchAvailability(), fetchRates()])
  const lots: ParkingLot[] = avail.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    category: String(r.category || 'unknown'),
    status: r.status === 'open' || r.status === 'closed' ? r.status : (r.status ? String(r.status) : 'open'),
    available: typeof r.available === 'number' ? r.available : null,
    occupied: typeof r.occupied === 'number' ? r.occupied : null,
    total: typeof r.total === 'number' ? r.total : null,
    terminalId: typeof r.terminalId === 'string' ? r.terminalId : null,
    terminalName: typeof r.terminalName === 'string' ? r.terminalName : null,
    lastUpdatedTimestamp: typeof r.lastUpdatedTimestamp === 'number' ? r.lastUpdatedTimestamp : 0,
    rate: rates[String(r.id)] || null,
  }))
  return lots
}

/**
 * Live parking availability for MCO. 60s in-memory cache, dedupes
 * concurrent callers via inFlight promise so a burst of requests results
 * in exactly one outbound call.
 *
 * Returns an empty array on upstream failure — callers should fall back
 * to whatever static data they want to show.
 */
// Backoff after a failed refresh — keep serving the stale cache for this
// long before retrying upstream. Prevents a hot Vercel instance from
// hammering GOAA when the upstream is temporarily flaky.
const FAILURE_BACKOFF_MS = 30_000

export async function fetchParkingAvailability(): Promise<ParkingLot[]> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.lots
  if (inFlight) return inFlight
  inFlight = load()
    .then((lots) => {
      cache = { at: Date.now(), lots }
      return lots
    })
    .catch(() => {
      // On failure: keep serving the stale cache (better than empty), but
      // ALSO bump cache.at so subsequent requests don't retry immediately.
      // Without this bump every request after a failed refresh would re-hit
      // GOAA, potentially DOS'ing them if they're recovering from an issue.
      if (cache) cache.at = Date.now() - (CACHE_TTL_MS - FAILURE_BACKOFF_MS)
      return cache?.lots || []
    })
    .finally(() => { inFlight = null })
  return inFlight
}

// Map our ui_hints `highlight` slugs to GOAA lot ids, since the ui_hints
// schema uses snake_case (garage_c, north_economy) but GOAA uses kebab-case
// (parking-garage-c, north-park-place). Cards pass the hint slugs straight
// through; this map resolves them.
export const HIGHLIGHT_TO_GOAA_ID: Record<string, string> = {
  garage_a: 'parking-garage-a',
  garage_b: 'parking-garage-b',
  garage_c: 'parking-garage-c',
  terminal_top: 'terminal-top',
  atlantis: 'surface-lot-1',
  discovery: 'surface-lot-2',
  endeavour: 'surface-lot-3',
  north_economy: 'north-park-place',
  south_economy: 'south-park-place',
  west_economy: 'west-park-place',
  north_cell: 'north-cell-phone-lot',
  south_cell: 'south-cell-phone-lot',
  valet: 'valet-parking',
}
