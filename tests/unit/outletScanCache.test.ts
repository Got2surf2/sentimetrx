// lib/outletScanCache + lib/outletReport.loadScan — the persisted-scan cache
// (sql/195, PERFORMANCE_REVIEW.md §8). Driven through the real public entry
// points with a stateful fake service client, so the test pins the ACTUAL
// contract: cold call = full row page-through + cache write; warm call = zero
// row reads and byte-identical output; any fingerprint component moving
// (row count, sync stamp, theme model, taxonomy updatedAt, hierarchy
// designation) forces a re-scan; a corrupt/foreign cache blob degrades to a
// re-scan, never an error.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const tables: Record<string, Record<string, unknown>[]> = {}
let flatRangeCalls = 0
let cacheWrites = 0

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit', 'neq']) b[m] = () => b
  b.range = (from: number, to: number) => {
    if (table === 'dataset_rows_flat') flatRangeCalls++
    return Promise.resolve({ data: (tables[table] || []).slice(from, to + 1), error: null })
  }
  b.maybeSingle = async () => ({ data: (tables[table] || [])[0] ?? null, error: null })
  b.single = b.maybeSingle
  // update(...).eq(...) is awaited by loadScan; the builder object is awaitable
  // as a plain value and destructures to { error: undefined } — like a resolved
  // PostgREST response. The payload is applied to the first row immediately.
  b.update = (payload: Record<string, unknown>) => {
    if (table === 'dataset_state' && 'outlet_scan_cache' in payload) cacheWrites++
    const row = (tables[table] || [])[0]
    if (row) Object.assign(row, payload)
    return b
  }
  return b
}
vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: () => ({ from: (t: string) => builder(t) }) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

import { computeOutletReportWithPredictor, computeOutletLeaderboard, computeHierarchyReport } from '@/lib/outletReport'
import type { SchemaFieldConfig } from '@/lib/analyzeTypes'

let nextId = 0
function review(placeId: string, region: string, opts: { rating: number; text: string; month: number; owner?: boolean }) {
  return {
    id: ++nextId,
    data: {
      place_id: placeId,
      location_name: `Store ${placeId}`, location_city: placeId === 'pA' ? 'Orlando' : 'Tampa', location_state: 'FL',
      location_address: `${placeId} Main St`,
      region,
      rating: opts.rating,
      review_text: opts.text,
      review_date: `2026-${String(opts.month).padStart(2, '0')}-15`,
      owner_response: opts.owner ? 'Thanks!' : '',
      _tx: { f: { review_text: { as: [{ axis: 'touchpoint', sub: 'speed', polarity: opts.rating >= 4 ? 'pos' : 'neg', evidence: opts.text.slice(0, 30) }] } } },
    },
  }
}

const FIELDS: SchemaFieldConfig[] = [
  { field: 'region', label: 'Region', type: 'categorical', hierarchyLevel: 1 },
  { field: 'location_name', label: 'Location', type: 'categorical', hierarchyLevel: 2 },
]

function seed() {
  nextId = 0
  flatRangeCalls = 0
  cacheWrites = 0
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < 12; i++) rows.push(review('pA', 'East', { rating: 5, month: (i % 6) + 1, owner: i % 2 === 0, text: 'The service was amazing and our waiter was wonderful.' }))
  for (let i = 0; i < 12; i++) rows.push(review('pB', 'West', { rating: 1, month: (i % 6) + 1, text: 'The service was terrible and the waiter was rude.' }))
  // one rated stray row without a place_id — must still count in network trends
  rows.push({ id: ++nextId, data: { rating: 3, review_text: 'ok', review_date: '2026-03-15' } })
  tables['datasets'] = [{ name: 'Cache Bistro', row_count: rows.length, last_synced_at: '2026-09-01T00:00:00Z' }]
  tables['dataset_state'] = [{
    theme_model: { themes: [{ name: 'Service', keywords: ['service', 'waiter'] }] },
    schema_config: { fields: FIELDS },
    tax: { fields: { review_text: { updatedAt: '2026-08-01T00:00:00Z' } } },
    outlet_scan_cache: null,
  }]
  tables['dataset_rows_flat'] = rows
}

beforeEach(seed)

async function allOutputs() {
  const rp = await computeOutletReportWithPredictor('d1', 'pA')
  const lb = await computeOutletLeaderboard('d1')
  const hRoot = await computeHierarchyReport('d1', FIELDS, [])
  const hEast = await computeHierarchyReport('d1', FIELDS, ['East'])
  return JSON.parse(JSON.stringify({ rp, lb, hRoot, hEast }))
}

describe('loadScan cache — cold vs warm', () => {
  it('cold call pages the rows once and writes the cache', async () => {
    await computeOutletLeaderboard('d1')
    expect(flatRangeCalls).toBeGreaterThan(0)
    expect(cacheWrites).toBe(1)
    const cache = tables['dataset_state'][0].outlet_scan_cache as { v: number; fingerprint: string; rows: unknown[] }
    expect(cache.v).toBe(1)
    expect(cache.fingerprint).toContain('25:') // row_count leads the fingerprint
    expect(cache.rows).toHaveLength(25)
  })

  it('warm calls read ZERO rows and return byte-identical output across every entry point', async () => {
    const cold = await allOutputs()
    const coldRange = flatRangeCalls
    const coldWrites = cacheWrites
    expect(coldWrites).toBe(1) // later calls in the cold batch already hit the cache
    const warm = await allOutputs()
    expect(flatRangeCalls).toBe(coldRange) // no new row pages
    expect(cacheWrites).toBe(coldWrites)   // no re-write
    expect(warm).toEqual(cold)
    // sanity: warm output is real, not empty — the strong outlet leads Service
    expect(warm.lb.themes[0].ranked[0].placeId).toBe('pA')
    expect(warm.rp.report.selected.placeId).toBe('pA')
    expect(warm.hRoot.children.map((c: { key: string }) => c.key).sort()).toEqual(['East', 'West'])
    expect(warm.hEast.outletCount).toBe(1)
  })

  it('the stray no-place_id row survives the digest round-trip in the network trend', async () => {
    const cold = await computeOutletReportWithPredictor('d1', 'pA')
    const warm = await computeOutletReportWithPredictor('d1', 'pA')
    const march = (t: { month: string; networkAvg: number }[]) => t.find((p) => p.month === '2026-03')
    // March = 2×5★ (pA) + 2×1★ (pB) + 1×3★ (stray) = 15/5
    expect(march(cold.report.selected!.trend)!.networkAvg).toBeCloseTo(3)
    expect(march(warm.report.selected!.trend)!.networkAvg).toBeCloseTo(3)
  })
})

describe('loadScan cache — invalidation', () => {
  async function warmUp() {
    await computeOutletLeaderboard('d1')
    const before = flatRangeCalls
    await computeOutletLeaderboard('d1')
    expect(flatRangeCalls).toBe(before) // confirmed warm
    return before
  }

  it('re-scans when row_count moves', async () => {
    const before = await warmUp()
    ;(tables['datasets'][0] as { row_count: number }).row_count++
    await computeOutletLeaderboard('d1')
    expect(flatRangeCalls).toBeGreaterThan(before)
    expect(cacheWrites).toBe(2)
  })

  it('re-scans when last_synced_at moves (in-place resync, same row count)', async () => {
    const before = await warmUp()
    tables['datasets'][0].last_synced_at = '2026-09-02T00:00:00Z'
    await computeOutletLeaderboard('d1')
    expect(flatRangeCalls).toBeGreaterThan(before)
  })

  it('re-scans when the theme model changes', async () => {
    const before = await warmUp()
    tables['dataset_state'][0].theme_model = { themes: [{ name: 'Service', keywords: ['service'] }] }
    await computeOutletLeaderboard('d1')
    expect(flatRangeCalls).toBeGreaterThan(before)
  })

  it('re-scans when a taxonomy rollup updatedAt bumps (classify completion)', async () => {
    const before = await warmUp()
    tables['dataset_state'][0].tax = { fields: { review_text: { updatedAt: '2026-09-01T12:00:00Z' } } }
    await computeOutletLeaderboard('d1')
    expect(flatRangeCalls).toBeGreaterThan(before)
  })

  it('re-scans when hierarchy designations change', async () => {
    const before = await warmUp()
    tables['dataset_state'][0].schema_config = { fields: [FIELDS[1]] } // Region undesignated
    await computeOutletLeaderboard('d1')
    expect(flatRangeCalls).toBeGreaterThan(before)
  })

  it('treats an unknown cache version as a miss, not an error', async () => {
    await warmUp()
    tables['dataset_state'][0].outlet_scan_cache = { v: 99, fingerprint: 'x' }
    const before = flatRangeCalls
    const lb = await computeOutletLeaderboard('d1')
    expect(flatRangeCalls).toBeGreaterThan(before)
    expect(lb.outletCount).toBe(2)
  })
})
