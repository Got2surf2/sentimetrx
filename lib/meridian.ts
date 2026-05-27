import 'server-only'

// lib/meridian.ts
//
// Indoor maps for Orlando International Airport (MCO), backed by the
// Meridian platform that flymco.com's /terminal-maps/map page already uses.
//
// Three data sources:
//   1. api.goaa.aero/content/meridian_map      — 32 floor maps (metadata)
//   2. api.goaa.aero/content/meridian_placemark — 2,313 placemarks (POIs
//      with x/y coords on those floors)
//   3. edit.meridianapps.com/api/locations/2315199/maps/<id>.svg — the
//      actual floor-plan SVG art (auth: Token JWT, see below)
//
// The JWT is shipped to every flymco visitor in their frontend JS bundle
// (just like the GOAA api-key for parking). Not a secret — same posture.
// Captured via Playwright sniff on 2026-05-27; expires per the SDK refresh
// cycle. If/when it does expire, re-run scripts/_mco_meridian_sniff2.mjs.
//
// 5-minute in-memory cache on the metadata. SVGs are proxied via
// /api/mco/indoor-map/svg/[id] with a long cache TTL (maps rarely change).

const GOAA_BASE = 'https://api.goaa.aero'
const MERIDIAN_BASE = 'https://edit.meridianapps.com/api/locations/2315199'
const PUBLIC_GOAA_KEY = '8eaac7209c824616a8fe58d22268cd59'
const PUBLIC_MERIDIAN_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ2YWx1ZSI6IjFiYmRmM2EzOWM4OTU3OTA3MGNjMDg1YWZkYzYzNmVkNjYyMDhmYzAiLCJ0IjoxNzI2MDYxMzg3fQ.iDieW-7z5ZAoOw3cbKYbuRZW1_dx2_PQqbpr3bLSvYM'
const CACHE_TTL_MS = 5 * 60_000   // 5 min for metadata
const SVG_CACHE_TTL_MS = 60 * 60_000  // 1 hour for SVG bodies (rarely change)

export interface MapInfo {
  id: string
  name: string
  group: string
  groupName: string         // "Terminal - A & B", "Terminal - C", "Parking - A & B", "Parking - C", "Entire Airport"
  level: number             // sortable level number
  levelLabel: string        // "L3", "A4", etc.
  airport: string
}

export interface Placemark {
  id: string
  name: string
  description: string
  keywords: string
  map: string                // map id this placemark belongs to
  x: number
  y: number
  type: string               // raw Meridian type slug, e.g. "gate", "restroom", "concession"
  typeName: string           // display name, e.g. "Gate", "Restroom"
  typeCategory: string       // typeName grouping ("Travel", "Amenities", "Dining")
  categoryIds: string[]
  url: string
  phone: string
  hideOnMap: boolean
  color: string | null
}

// Headers shared with all goaa.aero calls.
const goaaHeaders = {
  'api-key': process.env.GOAA_API_KEY || PUBLIC_GOAA_KEY,
  'api-version': '140',
  'Referer': 'https://flymco.com/',
  'User-Agent': 'Sentimetrx-MCO/1.0',
}

// Headers for meridianapps.com calls (auth: Token JWT).
const meridianHeaders = {
  'Authorization': 'Token ' + (process.env.MERIDIAN_TOKEN || PUBLIC_MERIDIAN_TOKEN),
  'User-Agent': 'Sentimetrx-MCO/1.0',
}

let mapsCache: { at: number; maps: MapInfo[] } | null = null
let placemarksCache: { at: number; pms: Placemark[] } | null = null
let mapsInFlight: Promise<MapInfo[]> | null = null
let pmsInFlight: Promise<Placemark[]> | null = null
const svgCache = new Map<string, { at: number; svg: string }>()

async function loadMaps(): Promise<MapInfo[]> {
  const res = await fetch(GOAA_BASE + '/content/meridian_map?lang=en-US', { headers: goaaHeaders, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error('meridian_map ' + res.status)
  const json = await res.json() as any
  const items = json?.data?.content?.items || {}
  const out: MapInfo[] = []
  for (const v of Object.values<any>(items)) {
    out.push({
      id: String(v.id),
      name: String(v.name || ''),
      group: String(v.group || ''),
      groupName: String(v.groupName || ''),
      level: typeof v.level === 'number' ? v.level : 0,
      levelLabel: String(v.levelLabel || ''),
      airport: String(v.airport || 'MCO'),
    })
  }
  return out
}

async function loadPlacemarks(): Promise<Placemark[]> {
  const res = await fetch(GOAA_BASE + '/content/meridian_placemark?lang=en-US', { headers: goaaHeaders, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error('meridian_placemark ' + res.status)
  const json = await res.json() as any
  const items = json?.data?.content?.items || {}
  const out: Placemark[] = []
  for (const v of Object.values<any>(items)) {
    out.push({
      id: String(v.id),
      name: String(v.name || ''),
      description: String(v.description || ''),
      keywords: String(v.keywords || ''),
      map: String(v.map || ''),
      x: typeof v.x === 'number' ? v.x : 0,
      y: typeof v.y === 'number' ? v.y : 0,
      type: String(v.type || ''),
      typeName: String(v.typeName || ''),
      typeCategory: String(v.typeCategory || ''),
      categoryIds: Array.isArray(v.categoryIds) ? v.categoryIds.map(String) : [],
      url: String(v.url || ''),
      phone: String(v.phone || ''),
      hideOnMap: !!v.hideOnMap,
      color: v.color ? String(v.color) : null,
    })
  }
  return out
}

export async function fetchMaps(): Promise<MapInfo[]> {
  const now = Date.now()
  if (mapsCache && now - mapsCache.at < CACHE_TTL_MS) return mapsCache.maps
  if (mapsInFlight) return mapsInFlight
  mapsInFlight = loadMaps()
    .then(maps => { mapsCache = { at: Date.now(), maps }; return maps })
    .catch(() => mapsCache?.maps || [])
    .finally(() => { mapsInFlight = null })
  return mapsInFlight
}

export async function fetchPlacemarks(): Promise<Placemark[]> {
  const now = Date.now()
  if (placemarksCache && now - placemarksCache.at < CACHE_TTL_MS) return placemarksCache.pms
  if (pmsInFlight) return pmsInFlight
  pmsInFlight = loadPlacemarks()
    .then(pms => { placemarksCache = { at: Date.now(), pms }; return pms })
    .catch(() => placemarksCache?.pms || [])
    .finally(() => { pmsInFlight = null })
  return pmsInFlight
}

/**
 * Fetch the raw SVG body for a given map id. Long cache (1 h) since
 * floor plans rarely change. Returns null on upstream failure.
 */
export async function fetchMapSvg(mapId: string): Promise<string | null> {
  const now = Date.now()
  const cached = svgCache.get(mapId)
  if (cached && now - cached.at < SVG_CACHE_TTL_MS) return cached.svg
  try {
    const res = await fetch(`${MERIDIAN_BASE}/maps/${encodeURIComponent(mapId)}.svg`, {
      headers: meridianHeaders,
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return cached?.svg ?? null
    const svg = await res.text()
    svgCache.set(mapId, { at: Date.now(), svg })
    return svg
  } catch {
    return cached?.svg ?? null
  }
}

/**
 * Parse the SVG's viewBox / width / height to know its coordinate system.
 * Returns null if the SVG isn't available or the viewBox can't be parsed.
 */
export async function fetchMapDimensions(mapId: string): Promise<{ width: number; height: number } | null> {
  const svg = await fetchMapSvg(mapId)
  if (!svg) return null
  // viewBox="x y w h" — most common case
  const vb = svg.match(/viewbox=["']\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*["']/i)
  if (vb) return { width: Number(vb[3]), height: Number(vb[4]) }
  // Fallback: explicit width="…" height="…"
  const w = svg.match(/width=["']([\d.]+)["']/i)
  const h = svg.match(/height=["']([\d.]+)["']/i)
  if (w && h) return { width: Number(w[1]), height: Number(h[1]) }
  return null
}

// ── Query helpers ──────────────────────────────────────────────────────────

export interface MapQuery {
  terminal?: 'A' | 'B' | 'C'
  level?: number | string   // e.g. 3 or "L3" or "A4"
  gate?: string             // e.g. "B22", "C235"
}

/**
 * Pick the most-likely map for a query.
 *
 *   - If gate is supplied, derive (terminal, gate range) → match the
 *     concourse map that contains that gate (Gates 1-29, 30-59, 70-99,
 *     100-129, or Terminal C levels with gate 230+).
 *   - Else if (terminal, level) supplied, match by group + level.
 *   - Else: terminal alone → return the Departures level (L3 for A/B,
 *     L2 for C — that's the most useful "I'm at the airport" floor).
 *
 * Returns null if no plausible match.
 */
export function findMap(maps: MapInfo[], q: MapQuery): MapInfo | null {
  if (q.gate) {
    const m = matchByGate(maps, q.gate)
    if (m) return m
  }
  const terminal = q.terminal
  if (!terminal) return null

  const groupRe = terminal === 'C' ? /^Terminal - C$/i : /^Terminal - A & B$/i
  const candidates = maps.filter(m => groupRe.test(m.groupName))
  if (candidates.length === 0) return null

  if (q.level != null) {
    // Try numeric, then label-string match
    const lvlNum = typeof q.level === 'number' ? q.level : Number(q.level)
    if (!Number.isNaN(lvlNum)) {
      const m = candidates.find(m => m.level === lvlNum)
      if (m) return m
    }
    const lvlStr = String(q.level).toUpperCase()
    const m = candidates.find(m => m.levelLabel.toUpperCase() === lvlStr)
    if (m) return m
  }
  // Default: Departures (L3 for A/B, L2 for C — flymco labels Departures L2 in C).
  const defaultLabel = terminal === 'C' ? 'L2' : 'L3'
  return candidates.find(m => m.levelLabel.toUpperCase() === defaultLabel) || candidates[0]
}

function matchByGate(maps: MapInfo[], gate: string): MapInfo | null {
  const g = gate.toUpperCase().trim()
  // Terminal C gates are formatted "C230"-style or just numeric ≥230 with
  // a C prefix elsewhere in context. Look for the C concourse first.
  if (/^C?\d{3,}$/.test(g)) {
    const n = Number(g.replace(/^C/, ''))
    if (n >= 230) {
      // C concourse — Level 2 in flymco data
      return maps.find(m => /^Terminal - C$/i.test(m.groupName) && m.levelLabel.toUpperCase() === 'L2') || null
    }
  }
  // Terminal A/B gates are pure numeric 1-129
  const n = Number(g.replace(/^[A-Z]+/, ''))
  if (!Number.isNaN(n)) {
    let label = ''
    if (n >= 1 && n <= 29) label = 'A1'
    else if (n >= 30 && n <= 59) label = 'A3'
    else if (n >= 70 && n <= 99) label = 'A4'
    else if (n >= 100 && n <= 129) label = 'A2'
    if (label) {
      return maps.find(m => /^Terminal - A & B$/i.test(m.groupName) && m.levelLabel.toUpperCase() === label) || null
    }
  }
  return null
}

/**
 * Return placemarks on a given map, optionally filtered by a category
 * keyword (matched against type / typeName / typeCategory / keywords).
 * `hideOnMap=true` entries are dropped — they're meta-pins Meridian
 * uses internally.
 */
export function placemarksForMap(all: Placemark[], mapId: string, category?: string): Placemark[] {
  const onMap = all.filter(p => p.map === mapId && !p.hideOnMap)
  if (!category) return onMap
  const re = new RegExp(category.replace(/[^a-z0-9 ]+/gi, '.'), 'i')
  return onMap.filter(p =>
    re.test(p.type) || re.test(p.typeName) || re.test(p.typeCategory) ||
    re.test(p.keywords) || re.test(p.name) || re.test(p.description),
  )
}
