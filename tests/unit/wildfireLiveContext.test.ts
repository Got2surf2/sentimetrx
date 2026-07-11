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

const wfigsFeature = (name: string, lat: number, lng: number, over: Record<string, unknown> = {}) => ({
  attributes: {
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
      { match: 'zippopotam', body: { places: [{ 'place name': 'Boise', state: 'Idaho', latitude: '43.63', longitude: '-116.20' }] } },
      { match: 'arcgis', body: { features: [wfigsFeature('RANCH', 43.9, -115.8), wfigsFeature('SADIE', 45.0, -116.2)] } },
      { match: 'weather.gov', body: { features: [] } },
    ])
    const block = await buildWildfireLiveContext('is my area in danger?', ['hello', 'my zip is 83702'])
    expect(block).toContain('Boise, Idaho')
    expect(block).toContain('RANCH')
    // Nearest first: RANCH (~30mi) before SADIE (~95mi)
    expect(block.indexOf('RANCH')).toBeLessThan(block.indexOf('SADIE'))
    expect(block).toContain('40% contained')
    expect(block).toContain('NEVER tell the person they are safe')
    expect(block).toContain('no active fire-weather, smoke, or evacuation alerts')
  })

  it('labels prescribed burns and surfaces NWS alerts', async () => {
    mockFetchRoutes([
      { match: 'zippopotam', body: { places: [{ 'place name': 'Boise', state: 'Idaho', latitude: '43.63', longitude: '-116.20' }] } },
      { match: 'arcgis', body: { features: [wfigsFeature('SPRING RX', 43.8, -116.1, { IncidentTypeCategory: 'RX' })] } },
      {
        match: 'weather.gov',
        body: { features: [{ properties: { event: 'Red Flag Warning', severity: 'Severe', headline: 'Red Flag Warning until 8 PM', ends: '2026-07-11T20:00:00-06:00' } }] },
      },
    ])
    const block = await buildWildfireLiveContext('any fires burning near 83702?')
    expect(block).toContain('PRESCRIBED BURN')
    expect(block).toContain('RED FLAG WARNING')
  })

  it('reports an empty radius honestly', async () => {
    mockFetchRoutes([
      { match: 'zippopotam', body: { places: [{ 'place name': 'Boise', state: 'Idaho', latitude: '43.63', longitude: '-116.20' }] } },
      { match: 'arcgis', body: { features: [] } },
      { match: 'weather.gov', body: { features: [] } },
    ])
    const block = await buildWildfireLiveContext('active fires near 83702?')
    expect(block).toContain('none reported')
  })

  it('fails soft when the geocoder cannot resolve', async () => {
    mockFetchRoutes([{ match: 'nominatim', body: [] }])
    const block = await buildWildfireLiveContext('fires near Xyzzyville?')
    expect(block).toContain('LOCATION NOT RESOLVED')
  })

  it('fails soft when WFIGS is down but still shows alerts', async () => {
    mockFetchRoutes([
      { match: 'zippopotam', body: { places: [{ 'place name': 'Boise', state: 'Idaho', latitude: '43.63', longitude: '-116.20' }] } },
      { match: 'arcgis', body: {}, ok: false },
      { match: 'weather.gov', body: { features: [] } },
    ])
    const block = await buildWildfireLiveContext('fires near 83702?')
    expect(block).toContain('could not be reached')
    expect(block).toContain('inciweb.wildfire.gov')
  })
})
