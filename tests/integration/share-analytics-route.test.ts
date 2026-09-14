// GET /api/share/analytics — the public shared-analytics endpoint: token gate,
// bounded row load (exact ≤50K, deterministic sample above), primary-vs-
// benchmark split, numeric z-tests, theme proportion tests, the completion
// funnel, and the summaries the shared page renders. Supabase is the
// filter-honoring fake; only the block sampler is mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeFakeService, type FakeService, type Row } from '../helpers/fakeSupabase'
import type * as SampleMod from '@/lib/bulkRowSample'

let svc: FakeService
vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: () => svc }))
const pageSampledRows = vi.fn()
vi.mock('@/lib/bulkRowSample', async () => ({ ...(await vi.importActual<typeof SampleMod>('@/lib/bulkRowSample')), pageSampledRows: (...a: unknown[]) => pageSampledRows(...a) }))

import { GET } from '@/app/api/share/analytics/route'

const future = new Date(Date.now() + 7 * 86400000).toISOString()
const past = new Date(Date.now() - 86400000).toISOString()
const req = (token?: string) => new NextRequest('http://localhost/api/share/analytics' + (token ? '?token=' + token : ''))

const FIELDS = [
  { field: 'region', type: 'categorical', label: 'Region' },
  { field: 'experience_score', type: 'numeric', sqt: 'rating', label: 'Experience' },
  { field: 'score', type: 'numeric', label: 'Score', remapping: { '1': 1 } },
  { field: 'duration_sec', type: 'numeric', label: 'Duration' },
  { field: 'comment', type: 'open-ended', label: 'Tell us more' },
  { field: 'cq1', type: 'categorical', section: 'custom', label: 'Custom 1' },
  { field: 'ps1', type: 'categorical', section: 'psychographic', label: 'Psycho 1' },
  { field: 'dm1', type: 'categorical', section: 'demographic', label: 'Age' },
  { field: 'status', type: 'categorical', label: 'Status' },
]
const THEME_MODEL = { fieldNames: ['comment'], themes: [
  { id: 't1', name: 'Wait', keywords: ['wait', 'slow'], sentiment: 'negative', description: 'Waiting' },
  { id: 't2', name: 'Empty', keywords: [] },
  { id: 't3', name: 'Praise', keywords: ['great'] },
] }

function rows(): Row[] {
  const out: Row[] = []
  for (let i = 0; i < 40; i++) {
    const east = i < 20
    out.push({ id: 'r' + i, dataset_id: 'ds1', row_index: i, data: {
      region: east ? 'East' : (i < 35 ? 'West' : 'North'),
      experience_score: east ? 5 : 2,
      score: east ? 8 + (i % 3) : 3 + (i % 3),
      duration_sec: 100 + i,
      comment: east ? (i % 2 ? 'the wait was slow' : 'great food') : (i % 5 === 0 ? 'wait' : ''),
      cq1: i % 4 ? 'a' : '', ps1: i % 3 ? 'p' : '', dm1: i % 2 ? '35-44' : '',
      status: i % 4 === 0 ? 'partial' : 'complete',
    } })
  }
  return out
}

function tables(): Record<string, Row[]> {
  return {
    shared_links: [
      { token: 'ok', type: 'analytics', expires_at: future, metadata: {
        dataset_id: 'ds1', label: 'East vs rest', includeThemes: true,
        filters: { region: { type: 'cat', mode: 'include', values: ['East', 'West'], excludeBlanks: false }, score: { type: 'range', values: [0, 20], includeBlanks: true } },
        primary: { field: 'region', label: 'Region', values: ['East'] }, inViewValues: ['East', 'West'],
        dateRange: { field: 'created_at', label: 'Date', min: '2026-01-01', max: '2026-02-01' },
      } },
      { token: 'noprimary', type: 'analytics', expires_at: future, metadata: { dataset_id: 'ds1', filters: {} } },
      { token: 'expired', type: 'analytics', expires_at: past, metadata: { dataset_id: 'ds1' } },
      { token: 'wrongtype', type: 'dataset', expires_at: future, metadata: {} },
      { token: 'nometa', type: 'analytics', expires_at: future, metadata: {} },
      { token: 'nods', type: 'analytics', expires_at: future, metadata: { dataset_id: 'missing' } },
      { token: 'coll', type: 'analytics', expires_at: future, metadata: { dataset_id: 'col1', filters: {}, includeThemes: false } },
      { token: 'reviews', type: 'analytics', expires_at: future, metadata: { dataset_id: 'gr1', filters: {} } },
    ],
    datasets: [
      { id: 'ds1', name: 'Coastal survey', source: 'study', row_count: 40, study_id: 'st1' },
      { id: 'col1', name: 'Region collection', source: 'collection', row_count: 40, study_id: null },
      { id: 'gr1', name: 'Google reviews', source: 'google_reviews', row_count: 40, study_id: null },
    ],
    studies: [{ id: 'st1', config: { ratingType: 'experience' } }],
    collections: [{ id: 'c1', dataset_id: 'col1', org_id: 'org-1' }],
    collection_members: [{ collection_id: 'c1', dataset_id: 'ds1', label: 'Coastal', sort_order: 0 }],
    dataset_state: [
      { dataset_id: 'ds1', schema_config: { fields: FIELDS }, theme_model: THEME_MODEL },
      { dataset_id: 'col1', schema_config: { fields: FIELDS }, theme_model: THEME_MODEL },
      { dataset_id: 'gr1', schema_config: { fields: [{ field: 'rating', type: 'numeric', label: 'Rating' }, { field: 'text', type: 'open-ended' }] }, theme_model: null },
    ],
    dataset_rows_flat: [...rows(), ...Array.from({ length: 12 }, (_, i) => ({ id: 'g' + i, dataset_id: 'gr1', row_index: i, data: { rating: 4, text: 'fine' } }))],
  }
}

beforeEach(() => { svc = makeFakeService({ tables: tables() }); pageSampledRows.mockReset() })

describe('token gate', () => {
  it('400 without a token, 404 unknown, 400 wrong type, 410 expired, 400 bad metadata, 404 missing dataset', async () => {
    expect((await GET(req())).status).toBe(400)
    expect((await GET(req('nope'))).status).toBe(404)
    expect((await GET(req('wrongtype'))).status).toBe(400)
    const exp = await GET(req('expired'))
    expect(exp.status).toBe(410)
    expect((await exp.json()).error).toMatch(/expired/)
    expect((await GET(req('nometa'))).status).toBe(400)
    expect((await GET(req('nods'))).status).toBe(404)
  })
  it('records last_accessed_at on a valid link', async () => {
    await GET(req('ok'))
    const upd = svc.writesTo('shared_links')
    expect(upd).toHaveLength(1)
    expect(upd[0].filters).toEqual([{ op: 'eq', col: 'token', val: 'ok' }])
    expect(upd[0].payload).toHaveProperty('last_accessed_at')
  })
})

describe('analytics payload', () => {
  it('splits primary vs benchmark inside the filtered view and flags a significant numeric gap', async () => {
    const res = await GET(req('ok'))
    expect(res.status).toBe(200)
    const b = await res.json()
    expect(b).toMatchObject({ label: 'East vs rest', datasetName: 'Coastal survey', sampled: false, totalSourceRows: 40, includeThemes: true })
    expect(b.filtered.n).toBe(20)      // East
    expect(b.benchmark.n).toBe(15)     // West (North is filtered out of view)
    expect(b.inView.n).toBe(35)
    expect(b.total.n).toBe(40)
    expect(b.dateRange).toEqual({ field: 'created_at', label: 'Date', min: '2026-01-01', max: '2026-02-01' })
    // numeric: experience 5 vs 2 has zero benchmark variance → no z-test; score varies → significant, above
    expect(b.numeric.experience_score.filtered).toMatchObject({ n: 20, mean: 5 })
    expect(b.numeric.experience_score.outlier).toBeNull()
    expect(b.numeric.experience_score.valueAliases).toBeTruthy()     // legacy rating field enriched from the study's ratingType
    expect(b.numeric.experience_score.counts).toEqual({ '5': 20 })
    expect(b.numeric.score.outlier).toMatchObject({ significant: true, direction: 'above' })
    expect(b.numeric.score.remapping).toEqual({ '1': 1 })
    expect(b.numeric.duration_sec).toBeUndefined()                     // replaced by the funnel
    // summaries
    expect(b.filterSummary).toEqual({ Region: 'East, West', Score: '0 - 20' })
    expect(b.primarySummary).toEqual({ field: 'Region', values: ['East'], comparisonValues: ['West'] })
    expect(b.themeFieldLabels).toEqual(['Tell us more'])
    expect(b.commentCount).toBe(20)
  })

  it('themes: keyword-less themes skipped, rates per side, proportion test where the sample allows, sorted by filtered rate', async () => {
    const b = await (await GET(req('ok'))).json()
    expect(b.themes.map((t: { name: string }) => t.name)).toEqual(['Wait', 'Praise'])
    const wait = b.themes[0]
    expect(wait).toMatchObject({ sentiment: 'negative', description: 'Waiting', keywords: ['wait', 'slow'] })
    expect(wait.filtered).toEqual({ count: 10, rate: 0.5 })
    expect(wait.benchmark.count).toBe(3)
    expect(wait.outlier).toMatchObject({ significant: true, direction: 'over' })
    expect(b.themes[1].filtered.count).toBe(10)
    expect(b.themes[1].outlier).toMatchObject({ direction: 'over' })
  })

  it('completion funnel: started → rating → conversation → custom/psycho/demo groups → completed', async () => {
    const b = await (await GET(req('ok'))).json()
    expect(b.completion.started).toBe(20)
    expect(b.completion.completed).toBe(15)
    expect(b.completion.stages.map((s: { label: string; count: number }) => [s.label, s.count])).toEqual([
      ['Started', 20], ['Experience', 20], ['Conversation', 20], ['Survey Questions (1)', 15], ['Psychographics (1)', 13], ['Demographics (optional)', 10], ['Completed', 15],
    ])
  })

  it('no primary → every in-view row is "filtered", no benchmark, no outlier tests', async () => {
    const b = await (await GET(req('noprimary'))).json()
    expect(b.filtered.n).toBe(40)
    expect(b.benchmark.n).toBe(0)
    expect(b.primarySummary).toBeNull()
    expect(b.label).toBe('Filtered View')
    expect(b.numeric.score.outlier).toBeNull()
    expect(b.themes[0].outlier).toBeNull()
  })

  it('collections fan out over members with _collection_label and resolve rating aliases through a member study', async () => {
    const b = await (await GET(req('coll'))).json()
    expect(b.datasetName).toBe('Region collection')
    expect(b.total.n).toBe(40)
    expect(b.numeric.experience_score.valueAliases).toBeTruthy()
    expect(b.includeThemes).toBe(false)
    // funnel still applies — the schema carries survey sections
    expect(b.completion).not.toBeNull()
  })

  it('a non-survey source gets no completion funnel', async () => {
    const b = await (await GET(req('reviews'))).json()
    expect(b.completion).toBeNull()
    expect(b.filtered.n).toBe(12)
    expect(b.numeric.rating.filtered.mean).toBe(4)
    expect(b.themes).toEqual([])
    expect(b.themeFieldLabels).toEqual(['text'])
  })

  it('above the 50K cap the deterministic sampler is used and the payload says so; a sampler failure falls back to the sequential load', async () => {
    svc.counts.dataset_rows_flat = 60_000
    pageSampledRows.mockImplementation(async (_svc: unknown, _ds: string, cap: number, cb: (r: { data: Row }) => void) => {
      for (let i = 0; i < 25; i++) cb({ data: { region: 'East', score: 9, comment: 'wait', status: 'complete' } })
      return Math.min(cap, 25)
    })
    const b = await (await GET(req('noprimary'))).json()
    expect(b.sampled).toBe(true)
    expect(b.totalSourceRows).toBe(60_000)
    expect(b.total.n).toBe(25)
    expect(pageSampledRows).toHaveBeenCalledWith(expect.anything(), 'ds1', 50_000, expect.any(Function))

    pageSampledRows.mockRejectedValue(new Error('PGRST202'))
    const fb = await (await GET(req('noprimary'))).json()
    expect(fb.sampled).toBe(true)
    expect(fb.total.n).toBe(40)   // sequential fallback loaded the seeded rows
  })
})
