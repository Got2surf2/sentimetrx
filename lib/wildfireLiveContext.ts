import 'server-only'

// lib/wildfireLiveContext.ts
//
// Builds a "LIVE WILDFIRE DATA" block to inject into a wildfire agent's
// system prompt for turns where the person is asking about current fires
// near a location ("what's the closest wildfire near me?", "is my area in
// danger?"). Without this block the agent can only speak from its static
// KB — it could never name an actual active incident.
//
// Cheap intent + location detection (regex — no synchronous AI call), then:
//   1. Geocode the location — ZIP via api.zippopotam.us, city/state via
//      Nominatim (OpenStreetMap). Both free, no API key.
//   2. NIFC/WFIGS current-incident points within RADIUS_MILES (public
//      ArcGIS feed, no key), sorted by distance.
//   3. NWS active alerts for the point (api.weather.gov), filtered to
//      fire-relevant events (Red Flag, Fire Weather, Evacuation, Smoke…).
// All fetches fail-soft; empty string when no live intent matches.
//
// Gated by chatCore on bot.config.liveContext === 'wildfire' — a config
// flag rather than a hardcoded bot id (works across TEST/prod ids).

const RADIUS_MILES = 150
const MAX_INCIDENTS = 8
const FETCH_TIMEOUT_MS = 6000
const UA = 'sentimetrx-wildfire-agent/1.0 (https://www.sentimetrx.ai)'

const WFIGS_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query'

interface GeoPoint {
  lat: number
  lng: number
  /** Human-readable resolved place ("Boise, Idaho"). */
  label: string
  /** What the user actually typed ("83702", "near Boise"). */
  raw: string
}

interface WfigsAttributes {
  IncidentName: string | null
  IncidentSize: number | null
  PercentContained: number | null
  FireDiscoveryDateTime: number | null
  ModifiedOnDateTime_dt: number | null
  POOCity: string | null
  POOCounty: string | null
  POOState: string | null
  IncidentTypeCategory: string | null
  FireBehaviorGeneral: string | null
  TotalIncidentPersonnel: number | null
}

interface Incident extends WfigsAttributes {
  lat: number
  lng: number
  distanceMiles: number
  compass: string
}

interface NwsAlert {
  event: string
  severity: string
  headline: string
  ends: string | null
}

// ── Intent + location detection ─────────────────────────────────────

const LIVE_INTENT_RE =
  /\b(near(est|by| me)?|close(st)?|around (me|here|us)|my (area|town|city|home|house|neighborhood|county|zip)|current(ly)?|active|right now|today|burning|any (fires?|wildfires?)|how (close|far)|danger|threat|safe(ty)?|evacuat\w*|alert|warning|red flag|air quality|aqi|smoke)\b/i

// "City, ST" — capitalized city tokens + uppercase two-letter state code
// (lowercase "near boise" still resolves via PREPOSITION_PLACE_RE below).
const CITY_STATE_RE = /\b([A-Z][A-Za-z.'’-]*(?:\s[A-Z][A-Za-z.'’-]*)*),\s*([A-Z]{2})\b/
// "near/in/around <place>" up to a sentence boundary. Deliberately loose;
// Nominatim decides whether it's a real place.
const PREPOSITION_PLACE_RE =
  /\b(?:near|in|around|outside|close to)\s+([A-Za-z][A-Za-z .'’-]{2,40}?)(?=[.?!,;]|$)/i
// Bare 5-digit ZIP — not preceded by $ / digit, not followed by "acres".
const ZIP_RE = /(?<![\d$])\b(\d{5})\b(?!\s*acres)/

// Phrases that read like place-prepositions but aren't places — reject any
// capture that STARTS with an article/pronoun/filler ("in a go-bag", "in my
// area", "in the west", "in general") rather than a proper place name.
const PLACE_STOPWORDS =
  /^(a|an|the|my|our|your|his|her|their|this|that|these|those|me|us|here|there|it|one|any|some|danger|trouble|general|case|fact|order|effect|advance|particular|response|regards?|terms)\b/i

/** Extract the best location string from a message, or null. Exported for tests. */
export function extractLocationQuery(message: string): string | null {
  const zip = message.match(ZIP_RE)
  if (zip) return zip[1]
  const cityState = message.match(CITY_STATE_RE)
  if (cityState) return cityState[1].trim() + ', ' + cityState[2].toUpperCase()
  const prep = message.match(PREPOSITION_PLACE_RE)
  if (prep) {
    const place = prep[1].trim()
    if (!PLACE_STOPWORDS.test(place)) return place
  }
  return null
}

// ── Geometry ────────────────────────────────────────────────────────

/** Great-circle distance in statute miles. Exported for tests. */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Compass direction FROM the user's point TO the fire. Exported for tests. */
export function compassDirection(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLng = toRad(toLng - fromLng)
  const y = Math.sin(dLng) * Math.cos(toRad(toLat))
  const x =
    Math.cos(toRad(fromLat)) * Math.sin(toRad(toLat)) -
    Math.sin(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.cos(dLng)
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(bearing / 45) % 8]
}

// ── Geocoding ───────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`)
  return res.json()
}

async function geocodeZip(zip: string): Promise<GeoPoint | null> {
  const data = (await fetchJson(`https://api.zippopotam.us/us/${zip}`)) as {
    places?: Array<{ 'place name': string; state: string; latitude: string; longitude: string }>
  }
  const place = data.places?.[0]
  if (!place) return null
  return {
    lat: parseFloat(place.latitude),
    lng: parseFloat(place.longitude),
    label: `${place['place name']}, ${place.state}`,
    raw: zip,
  }
}

async function geocodeCity(query: string): Promise<GeoPoint | null> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' +
    encodeURIComponent(query)
  const data = (await fetchJson(url)) as Array<{ lat: string; lon: string; display_name: string }>
  const hit = data[0]
  if (!hit) return null
  // display_name is long ("Boise, Ada County, Idaho, United States") — keep first + state-ish part.
  const parts = hit.display_name.split(',').map((s) => s.trim())
  const label = parts.length >= 2 ? `${parts[0]}, ${parts[parts.length - 2]}` : parts[0]
  return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), label, raw: query }
}

async function geocode(query: string): Promise<GeoPoint | null> {
  try {
    return /^\d{5}$/.test(query) ? await geocodeZip(query) : await geocodeCity(query)
  } catch {
    return null
  }
}

// ── Live data fetches ───────────────────────────────────────────────

async function fetchNearbyIncidents(point: GeoPoint): Promise<Incident[]> {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${point.lng},${point.lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(RADIUS_MILES),
    units: 'esriSRUnit_StatuteMile',
    outFields:
      'IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,ModifiedOnDateTime_dt,POOCity,POOCounty,POOState,IncidentTypeCategory,FireBehaviorGeneral,TotalIncidentPersonnel',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '100',
    f: 'json',
  })
  const data = (await fetchJson(`${WFIGS_URL}?${params}`)) as {
    features?: Array<{ attributes: WfigsAttributes; geometry?: { x: number; y: number } }>
    error?: { message?: string }
  }
  if (data.error) throw new Error(data.error.message || 'WFIGS query error')
  const incidents: Incident[] = []
  for (const f of data.features || []) {
    if (!f.geometry) continue
    const distanceMiles = haversineMiles(point.lat, point.lng, f.geometry.y, f.geometry.x)
    incidents.push({
      ...f.attributes,
      lat: f.geometry.y,
      lng: f.geometry.x,
      distanceMiles,
      compass: compassDirection(point.lat, point.lng, f.geometry.y, f.geometry.x),
    })
  }
  return incidents.sort((a, b) => a.distanceMiles - b.distanceMiles)
}

const FIRE_ALERT_RE = /fire|smoke|red flag|evacuation|air quality|dust/i

async function fetchFireAlerts(point: GeoPoint): Promise<NwsAlert[]> {
  const url = `https://api.weather.gov/alerts/active?point=${point.lat.toFixed(4)},${point.lng.toFixed(4)}`
  const data = (await fetchJson(url)) as {
    features?: Array<{
      properties?: { event?: string; severity?: string; headline?: string; ends?: string | null; expires?: string | null }
    }>
  }
  const alerts: NwsAlert[] = []
  for (const f of data.features || []) {
    const p = f.properties
    if (!p?.event || !FIRE_ALERT_RE.test(p.event)) continue
    alerts.push({
      event: p.event,
      severity: p.severity || 'Unknown',
      headline: p.headline || '',
      ends: p.ends || p.expires || null,
    })
  }
  return alerts
}

// ── Formatting ──────────────────────────────────────────────────────

function fmtEpochDay(ms: number | null): string {
  if (!ms) return 'unknown date'
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtAcres(size: number | null): string {
  if (size == null) return 'size not yet reported'
  if (size < 1) return '<1 acre'
  return `${Math.round(size).toLocaleString('en-US')} acres`
}

function incidentLine(inc: Incident): string {
  const prescribed = inc.IncidentTypeCategory === 'RX'
  const name = (inc.IncidentName || 'Unnamed incident').trim()
  const where = [inc.POOCounty ? inc.POOCounty + ' County' : inc.POOCity, (inc.POOState || '').replace(/^US-/, '')]
    .filter(Boolean)
    .join(', ')
  const parts = [
    `${name}${prescribed ? ' (PRESCRIBED BURN — planned, not a wildfire)' : ''}`,
    `${inc.distanceMiles < 1 ? '<1' : Math.round(inc.distanceMiles)} mi ${inc.compass} of this location`,
    fmtAcres(inc.IncidentSize),
    inc.PercentContained != null ? `${Math.round(inc.PercentContained)}% contained` : 'containment not reported',
    `discovered ${fmtEpochDay(inc.FireDiscoveryDateTime)}`,
  ]
  if (where) parts.push(where)
  if (inc.FireBehaviorGeneral) parts.push(`behavior: ${inc.FireBehaviorGeneral}`)
  if (inc.TotalIncidentPersonnel) parts.push(`${inc.TotalIncidentPersonnel} personnel assigned`)
  if (inc.ModifiedOnDateTime_dt) parts.push(`updated ${fmtEpochDay(inc.ModifiedOnDateTime_dt)}`)
  return '  - ' + parts.join(' · ')
}

function fmtAlertLine(a: NwsAlert): string {
  const until = a.ends
    ? ` — in effect until ${new Date(a.ends).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : ''
  return `  - ${a.event.toUpperCase()} (severity: ${a.severity})${until}${a.headline ? `: ${a.headline}` : ''}`
}

const SAFETY_FOOTER =
  '────────────────────────────────────────────────────────────\n' +
  'THIS BLOCK IS THE GROUND TRUTH FOR THIS TURN. It SUPERSEDES any rule below that says you have no live fire data. For this turn ONLY:\n' +
  '1. Cite the incidents, distances, sizes, containment, and alerts above AS FACT, and start by echoing the location back (e.g. "Based on ZIP 83702 — Boise, Idaho…") so the person can correct it.\n' +
  '2. ALWAYS include the freshness caveat: this feed is interagency-reported, not real-time — brand-new fires and fast-moving changes may not appear yet, and it is NOT a substitute for official local alerts.\n' +
  '3. NEVER tell the person they are safe, out of danger, or "fine" — you cannot determine that. Report distances and official alerts, then direct them to their county emergency management / local alerting system (and sheriff or fire department social channels) for evacuation status. Name the county, but NEVER construct a URL, phone number, or address for a county or local agency — tell them to search "<county> emergency alerts" instead. The ONLY URLs you may give are inciweb.wildfire.gov, fire.airnow.gov, weather.gov, ready.gov/wildfires, and nifc.gov.\n' +
  '4. If ANY evacuation-related alert appears above, LEAD with it and tell them to follow official evacuation orders immediately — do not bury it.\n' +
  '5. If the person describes visible flames, nearby fire, or immediate danger, tell them to call 911 FIRST before anything else.\n' +
  '6. For incident details and maps, point to inciweb.wildfire.gov; for smoke and air quality, fire.airnow.gov.'

/**
 * Build the live-data system-prompt block for a wildfire agent turn.
 * Returns '' when the turn has no live-fire intent. Scans the current
 * message first, then recent user messages (newest first) so a ZIP or
 * city given earlier in the conversation carries forward.
 */
export async function buildWildfireLiveContext(
  userMessage: string,
  recentUserMessages: string[] = []
): Promise<string> {
  if (!userMessage) return ''
  const locationInMessage = extractLocationQuery(userMessage)
  if (!locationInMessage && !LIVE_INTENT_RE.test(userMessage)) return ''

  // Location: current message wins; otherwise walk back through recent turns.
  let locationQuery = locationInMessage
  if (!locationQuery) {
    for (let i = recentUserMessages.length - 1; i >= 0 && !locationQuery; i--) {
      locationQuery = extractLocationQuery(recentUserMessages[i])
    }
  }

  if (!locationQuery) {
    return (
      'LIVE WILDFIRE LOOKUP — LOCATION NEEDED: The person is asking about current fire activity or danger, but no location has been shared in this conversation. ' +
      'You DO have live access to the national active-fire feed once you know where they are. Ask for their ZIP code (preferred) or city and state — nothing more precise — and explain you will check the live national fire feed for their area. ' +
      'If they describe visible flames or immediate danger, tell them to call 911 first.'
    )
  }

  const point = await geocode(locationQuery)
  if (!point) {
    return (
      `LIVE WILDFIRE LOOKUP — LOCATION NOT RESOLVED: The person appears to have given a location ("${locationQuery}") but it could not be matched to a U.S. place. ` +
      'Ask them to confirm with a 5-digit ZIP code or a "City, State" — then you can check the live national fire feed.'
    )
  }

  const [incidents, alerts] = await Promise.all([
    fetchNearbyIncidents(point).catch(() => null),
    fetchFireAlerts(point).catch(() => null),
  ])

  const sections: string[] = []
  sections.push(`LOCATION FOR THIS LOOKUP: ${point.label} (from "${point.raw}")`)

  if (incidents === null) {
    sections.push(
      'ACTIVE INCIDENTS: the NIFC/WFIGS live feed could not be reached this turn. Say the live fire feed is temporarily unavailable and point to inciweb.wildfire.gov and local emergency management — do NOT guess at fire activity.'
    )
  } else if (incidents.length === 0) {
    sections.push(
      `ACTIVE INCIDENTS WITHIN ${RADIUS_MILES} MILES (NIFC/WFIGS interagency feed, retrieved just now): none reported. ` +
      'Note the caveat: very new starts may not be in the feed yet.'
    )
  } else {
    const shown = incidents.slice(0, MAX_INCIDENTS)
    const lines = shown.map(incidentLine).join('\n')
    const more = incidents.length > shown.length ? `\n  … and ${incidents.length - shown.length} more within ${RADIUS_MILES} miles.` : ''
    sections.push(
      `ACTIVE INCIDENTS WITHIN ${RADIUS_MILES} MILES, NEAREST FIRST (NIFC/WFIGS interagency feed, retrieved just now):\n${lines}${more}`
    )
  }

  if (alerts === null) {
    sections.push('NWS ALERTS: the weather.gov alert feed could not be reached this turn — direct them to weather.gov and local emergency alerts for warnings.')
  } else if (alerts.length === 0) {
    sections.push('NWS ALERTS AT THIS LOCATION (api.weather.gov, retrieved just now): no active fire-weather, smoke, or evacuation alerts.')
  } else {
    sections.push(
      `NWS ALERTS AT THIS LOCATION (api.weather.gov, retrieved just now):\n${alerts.map(fmtAlertLine).join('\n')}`
    )
  }

  return (
    '════════════════════════════════════════════════════════════\n' +
    '!! LIVE WILDFIRE DATA FOR THIS TURN — AUTHORITATIVE OVERRIDE !!\n' +
    '════════════════════════════════════════════════════════════\n\n' +
    sections.join('\n\n') +
    '\n\n' +
    SAFETY_FOOTER
  )
}
