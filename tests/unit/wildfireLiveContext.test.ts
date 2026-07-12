// Tests for the wildfire live-context builder (lib/wildfireLiveContext.ts) —
// the per-turn injection that lets the Ember agent answer "closest wildfire
// near me" from the live NIFC/WFIGS feed. Network is fully mocked; the
// load-bearing cases are location extraction (ZIP vs city vs none), the
// ask-for-location fallback, distance ordering, and the fail-soft paths.

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  extractLocationQuery,
  haversineMiles,
  compassDirection,
  pointInRings,
  distanceToRingsMiles,
  buildWildfireLiveContext,
} from '@/lib/wildfireLiveContext'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractLocationQuery', () => {
  it('finds a bare 5-digit ZIP', () => {
    expect(extractLocationQuery('any fires near 83702?')).toBe('83702')
  })
  it('ignores 5-digit acreage figures', () => {
    expect(extractLocationQuery('is the 12000 acres fire contained?')).toBeNull()
  })
  it('finds City, ST', () => {
    expect(extractLocationQuery('what about Boise, ID right now')).toBe('Boise, ID')
  })
  it('finds "near <place>"', () => {
    expect(extractLocationQuery('closest wildfire near Bend')).toBe('Bend')
  })
  it('does not treat "near me" as a place', () => {
    expect(extractLocationQuery('what is the closest wildfire near me?')).toBeNull()
  })
  it('returns null when no location present', () => {
    expect(extractLocationQuery('is my area in danger?')).toBeNull()
  })
})

describe('haversineMiles / compassDirection', () => {
  it('computes a known distance (Boise → Twin Falls ≈ 103 mi)', () => {
    const d = haversineMiles(43.6166, -116.2009, 42.5558, -114.4701)
    expect(d).toBeGreaterThan(95)
    expect(d).toBeLessThan(115)
  })
  it('points north for a due-north target', () => {
    expect(compassDirection(40, -116, 41, -116)).toBe('N')
  })
  it('points roughly southeast for Boise → Twin Falls', () => {
    expect(compassDirection(43.6166, -116.2009, 42.5558, -114.4701)).toBe('SE')
  })
})

// A ~0.2°-square test polygon (roughly 14mi across) centered on (lat,lng).
const squareRings = (lat: number, lng: number, half = 0.1) => [[
  [lng - half, lat - half], [lng + half, lat - half],
  [lng + half, lat + half], [lng - half, lat + half],
  [lng - half, lat - half],
]]

describe('pointInRings / distanceToRingsMiles', () => {
  const rings = squareRings(43.0, -116.0)
  it('detects inside vs outside', () => {
    expect(pointInRings(43.0, -116.0, rings)).toBe(true)
    expect(pointInRings(43.5, -116.0, rings)).toBe(false)
  })
  it('is 0 inside, and ~edge distance outside', () => {
    expect(distanceToRingsMiles(43.0, -116.0, rings)).toBe(0)
    // 43.2 is 0.1° north of the top edge (43.1) ≈ 6.9 mi
    const d = distanceToRingsMiles(43.2, -116.0, rings)
    expect(d).toBeGreaterThan(5.5)
    expect(d).toBeLessThan(8.5)
  })
})

const wfigsFeature = (name: string, lat: number, lng: number, over: Record<string, unknown> = {}) => ({
  attributes: {
    IrwinID: null,
    IncidentName: name,
    IncidentSize: 1200,
    PercentContained: 40,
    FireDiscoveryDateTime: Date.UTC(2026, 6, 8),
    ModifiedOnDateTime_dt: Date.UTC(2026, 6, 11),
    POOCity: null,
    POOCounty: 'Boise',
    POOState: 'US-ID',
    IncidentTypeCategory: 'WF',
    FireBehaviorGeneral: null,
    TotalIncidentPersonnel: 150,
    ...over,
  },
  geometry: { x: lng, y: lat },
})

function mockFetchRoutes(routes: Array<{ match: string; body: unknown; ok?: boolean }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    const u = String(url)
    const route = routes.find(r => u.includes(r.match))
    if (!route) throw new Error('unexpected fetch: ' + u)
    return {
      ok: route.ok !== false,
      status: route.ok === false ? 500 : 200,
      json: async () => route.body,
    }
  }))
}

// Baseline happy-path routes; override per test by prepending a more
// specific entry (routes.find takes the first match).
const zipRoute = { match: 'zippopotam', body: { places: [{ 'place name': 'Boise', state: 'Idaho', latitude: '43.63', longitude: '-116.20' }] } }
const noPerimetersRoute = { match: 'Perimeters', body: { features: [] } }
const noAlertsRoute = { match: 'weather.gov', body: { features: [] } }
const noAqiRoute = { match: 'airnowgovapi', body: [] }
const noDroughtRoute = { match: 'USDM', body: { features: [] } }

describe('buildWildfireLiveContext', () => {
  it('returns empty string for a non-live turn', async () => {
    mockFetchRoutes([]) // any network call would throw
    expect(await buildWildfireLiveContext('what should be in a go-bag?')).toBe('')
  })

  it('asks for a location when live intent has no location anywhere', async () => {
    mockFetchRoutes([]) // any network call would throw
    const block = await buildWildfireLiveContext('what is the closest wildfire near me?', ['hi there'])
    expect(block).toContain('LOCATION NEEDED')
    expect(block).toContain('ZIP')
  })

  it('carries a ZIP forward from an earlier user message', async () => {
    mockFetchRoutes([
      zipRoute, noPerimetersRoute, noAlertsRoute, noAqiRoute, noDroughtRoute,
      { match: 'Incident_Locations', body: { features: [wfigsFeature('RANCH', 43.9, -115.8), wfigsFeature('SADIE', 45.0, -116.2)] } },
    ])
    const block = await buildWildfireLiveContext('is my area in danger?', ['hello', 'my zip is 83702'])
    expect(block).toContain('Boise, Idaho')
    expect(block).toContain('RANCH')
    // Nearest first: RANCH (~30mi) before SADIE (~95mi)
    expect(block.indexOf('RANCH')).toBeLessThan(block.indexOf('SADIE'))
    expect(block).toContain('40% contained')
    expect(block).toContain('no mapped perimeter yet')
    expect(block).toContain('NEVER tell the person they are safe')
    expect(block).toContain('no active fire-weather, smoke, or evacuation alerts')
  })

  it('labels prescribed burns and surfaces NWS alerts', async () => {
    mockFetchRoutes([
      zipRoute, noPerimetersRoute, noAqiRoute, noDroughtRoute,
      { match: 'Incident_Locations', body: { features: [wfigsFeature('SPRING RX', 43.8, -116.1, { IncidentTypeCategory: 'RX' })] } },
      {
        match: 'weather.gov',
        body: { features: [{ properties: { event: 'Red Flag Warning', severity: 'Severe', headline: 'Red Flag Warning until 8 PM', ends: '2026-07-11T20:00:00-06:00' } }] },
      },
    ])
    const block = await buildWildfireLiveContext('any fires burning near 83702?')
    expect(block).toContain('PRESCRIBED BURN')
    expect(block).toContain('RED FLAG WARNING')
  })

  it('joins a perimeter by IRWIN id and reports edge distance', async () => {
    mockFetchRoutes([
      zipRoute, noAlertsRoute, noAqiRoute, noDroughtRoute,
      // Fire origin ~34mi NE, but perimeter edge reaches to ~7mi north of Boise (43.63,-116.20)
      { match: 'Incident_Locations', body: { features: [wfigsFeature('CLAREMONT', 44.0, -115.7, { IrwinID: '{ABC-123}' })] } },
      { match: 'Perimeters', body: { features: [{ attributes: { poly_IncidentName: 'Claremont', poly_IRWINID: 'abc-123', poly_GISAcres: 6700 }, geometry: { rings: squareRings(43.83, -116.2) } }] } },
    ])
    const block = await buildWildfireLiveContext('how close is the fire to 83702?')
    expect(block).toContain('mapped fire EDGE ~7 mi from this location')
    expect(block).not.toContain('no mapped perimeter yet')
  })

  it('leads with an URGENT banner when the location is inside a perimeter', async () => {
    mockFetchRoutes([
      zipRoute, noAlertsRoute, noAqiRoute, noDroughtRoute,
      { match: 'Incident_Locations', body: { features: [wfigsFeature('CLAREMONT', 43.7, -116.1, { IrwinID: '{ABC-123}' })] } },
      { match: 'Perimeters', body: { features: [{ attributes: { poly_IncidentName: 'Claremont', poly_IRWINID: 'abc-123', poly_GISAcres: 6700 }, geometry: { rings: squareRings(43.63, -116.2) } }] } },
    ])
    const block = await buildWildfireLiveContext('is my area in danger? 83702')
    expect(block).toContain('INSIDE the mapped perimeter')
    expect(block).toContain('INSIDE THE MAPPED FIRE PERIMETER')
  })

  it('reports the worst-pollutant AirNow observation', async () => {
    mockFetchRoutes([
      zipRoute, noPerimetersRoute, noAlertsRoute, noDroughtRoute,
      { match: 'Incident_Locations', body: { features: [] } },
      { match: 'airnowgovapi', body: [
        { dataType: 'F', aqi: 58, category: 'Moderate', parameter: 'PM2.5', reportingArea: 'Boise', reportingAgency: 'Idaho DEQ' },
        { dataType: 'O', aqi: 132, category: 'Unhealthy for Sensitive Groups', parameter: 'PM2.5', reportingArea: 'Boise', reportingAgency: 'Idaho DEQ' },
        { dataType: 'O', aqi: 41, category: 'Good', parameter: 'OZONE', reportingArea: 'Boise', reportingAgency: 'Idaho DEQ' },
      ] },
    ])
    const block = await buildWildfireLiveContext('how is the air quality near 83702?')
    expect(block).toContain('AQI 132 — Unhealthy for Sensitive Groups')
    expect(block).toContain('current monitor reading')
  })

  it('reports the USDM drought class as context, worst class wins', async () => {
    mockFetchRoutes([
      zipRoute, noPerimetersRoute, noAlertsRoute, noAqiRoute,
      { match: 'Incident_Locations', body: { features: [] } },
      { match: 'USDM', body: { features: [{ attributes: { DM: 0, ReleaseDate: 1783582200000 } }, { attributes: { DM: 2, ReleaseDate: 1783582200000 } }] } },
    ])
    const block = await buildWildfireLiveContext('how dry is it near 83702? big drought?')
    expect(block).toContain('D2 — Severe Drought')
    expect(block).toContain('Do NOT convert it into a personal fire-risk rating')
    expect(block).toContain('drought.gov')
  })

  it('reports an empty radius honestly', async () => {
    mockFetchRoutes([
      zipRoute, noPerimetersRoute, noAlertsRoute, noAqiRoute, noDroughtRoute,
      { match: 'Incident_Locations', body: { features: [] } },
    ])
    const block = await buildWildfireLiveContext('active fires near 83702?')
    expect(block).toContain('none reported')
    expect(block).toContain('fire.airnow.gov')
  })

  it('fails soft when the geocoder cannot resolve', async () => {
    mockFetchRoutes([{ match: 'nominatim', body: [] }])
    const block = await buildWildfireLiveContext('fires near Xyzzyville?')
    expect(block).toContain('LOCATION NOT RESOLVED')
  })

  it('fails soft when WFIGS is down but still shows alerts', async () => {
    mockFetchRoutes([
      zipRoute, noPerimetersRoute, noAlertsRoute, noAqiRoute, noDroughtRoute,
      { match: 'Incident_Locations', body: {}, ok: false },
    ])
    const block = await buildWildfireLiveContext('fires near 83702?')
    expect(block).toContain('could not be reached')
    expect(block).toContain('inciweb.wildfire.gov')
  })
})
