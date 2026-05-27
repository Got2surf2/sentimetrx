import 'server-only'

// lib/flights.ts
//
// Live flight + gate data for Orlando International Airport (MCO), sourced
// from the GOAA public API at api.goaa.aero. Same auth posture as the rest
// of our GOAA integrations (the api-key is a public site key from flymco's
// frontend, not a secret).
//
// Key gotcha: /flights requires api-version 150, NOT 140. Versions 140-145
// return 412 "API version is no longer supported" — they were retired more
// recently than the parking + security endpoints. If the version stops
// working, re-sniff flymco.com/flight-status to discover the new value.
//
// 60s in-memory cache on the full flight list. Per-instance — Vercel may
// spread across cold/hot instances; that's fine, GOAA is not rate-limited.
// 30s failure backoff after a load() error.

const ENDPOINT = 'https://api.goaa.aero/flights'
const PUBLIC_GOAA_KEY = '8eaac7209c824616a8fe58d22268cd59'
const CACHE_TTL_MS = 60_000
const FAILURE_BACKOFF_MS = 30_000
// 12-hour window — covers "is my flight today" queries for almost the
// whole day. 4 hours (the prior value) was too narrow: a user asking about
// their flight at 11 AM with a 6 PM departure got "no matching flights"
// because the flight wasn't in the next-4h window. The GOAA feed handles
// 12h queries fine (~500-700 flights in the response, still manageable).
const WINDOW_SECONDS = 12 * 3600

export interface Flight {
  iataOperatingAirline: string         // "DL"
  operatingAirlineFlightNumber: string // "DL1455"
  arrival: boolean
  status: string                        // "Scheduled" | "Boarding" | "Landed" | "Canceled" | ...
  isDelayed: boolean
  isVisible: boolean
  terminal: string | null               // "A" | "B" | "C"
  gate: string | null                   // "71", "C235", etc.
  baggageBelt: string[]
  departureAirport: string              // IATA
  arrivalAirport: string                // IATA
  viaAirport: string
  scheduledTimestamp: number            // unix seconds — scheduled
  actualTimestamp: number | null
  bestKnownTimestamp: number            // GOAA's best guess (sched if no actual)
  scheduledDate: string                 // "2026-05-27"
}

let cache: { at: number; flights: Flight[] } | null = null
let inFlight: Promise<Flight[]> | null = null

const headers = {
  'api-key': process.env.GOAA_API_KEY || PUBLIC_GOAA_KEY,
  'api-version': '150',
  'Referer': 'https://flymco.com/',
  'User-Agent': 'Sentimetrx-MCO/1.0',
}

async function load(): Promise<Flight[]> {
  const now = Math.floor(Date.now() / 1000)
  const end = now + WINDOW_SECONDS
  const url = `${ENDPOINT}?scheduledTimestamp=${now}..${end}`
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error('flights ' + res.status)
  const json = await res.json() as any
  const list = Array.isArray(json?.data?.flights) ? json.data.flights : []
  return list
    .filter((f: any) => f && f.isVisible !== false && !f.isDeleted)
    .map((f: any): Flight => ({
      iataOperatingAirline: String(f.iataOperatingAirline || ''),
      operatingAirlineFlightNumber: String(f.operatingAirlineFlightNumber || ''),
      arrival: !!f.arrival,
      status: String(f.status || ''),
      isDelayed: !!f.isDelayed,
      isVisible: f.isVisible !== false,
      terminal: f.terminal ? String(f.terminal) : null,
      gate: f.gate ? String(f.gate) : null,
      baggageBelt: Array.isArray(f.baggageBelt) ? f.baggageBelt.map(String) : [],
      departureAirport: String(f.departureAirport || ''),
      arrivalAirport: String(f.arrivalAirport || ''),
      viaAirport: String(f.viaAirport || ''),
      scheduledTimestamp: typeof f.scheduledTimestamp === 'number' ? f.scheduledTimestamp : 0,
      actualTimestamp: typeof f.actualTimestamp === 'number' ? f.actualTimestamp : null,
      bestKnownTimestamp: typeof f.bestKnownTimestamp === 'number' ? f.bestKnownTimestamp : 0,
      scheduledDate: String(f.scheduledDate || ''),
    }))
}

export async function fetchFlights(): Promise<Flight[]> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.flights
  if (inFlight) return inFlight
  inFlight = load()
    .then(flights => { cache = { at: Date.now(), flights }; return flights })
    .catch(() => {
      if (cache) cache.at = Date.now() - (CACHE_TTL_MS - FAILURE_BACKOFF_MS)
      return cache?.flights || []
    })
    .finally(() => { inFlight = null })
  return inFlight
}

// ── Lookup helpers ─────────────────────────────────────────────────────────

/**
 * Normalize a flight number string (DL1455, "DL 1455", "Delta 1455", etc.)
 * to { airline, number } for matching against the GOAA flight list. Returns
 * null if we can't parse one.
 */
export function parseFlightNumber(raw: string): { airline: string; number: string } | null {
  if (!raw) return null
  const s = raw.toUpperCase().trim()
  // IATA prefix "XX1234" / "XX 1234" / "XX-1234"
  const m = s.match(/\b([A-Z0-9]{2,3})[\s\-]?(\d{1,4}[A-Z]?)\b/)
  if (!m) return null
  return { airline: m[1], number: m[2] }
}

export function findFlightByNumber(flights: Flight[], raw: string): Flight | null {
  const parsed = parseFlightNumber(raw)
  if (!parsed) return null
  const full = parsed.airline + parsed.number
  // Try exact, departure first (more likely to be what the user is asking
  // about since they're at MCO), then arrival.
  const all = flights.filter(f => f.operatingAirlineFlightNumber.toUpperCase() === full)
  const dep = all.find(f => !f.arrival)
  if (dep) return dep
  return all[0] ?? null
}

/**
 * Find the next upcoming departure at a given gate. Prefers Scheduled /
 * Boarding flights with a future bestKnownTimestamp. Returns null if no
 * match — gate might be vacant or in arrival mode.
 */
export function nextDepartureAtGate(flights: Flight[], gate: string): Flight | null {
  if (!gate) return null
  const g = gate.toUpperCase().replace(/[^0-9A-Z]/g, '')
  const now = Math.floor(Date.now() / 1000)
  const candidates = flights
    .filter(f => !f.arrival && f.gate && f.gate.toUpperCase().replace(/[^0-9A-Z]/g, '') === g)
    .filter(f => f.bestKnownTimestamp > now - 30 * 60)  // include flights in past 30 min (boarding can run late)
    .sort((a, b) => a.bestKnownTimestamp - b.bestKnownTimestamp)
  return candidates[0] || null
}
