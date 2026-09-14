// lib/reviewSync.ts — the two-phase Google/Tripadvisor review sync: drain
// pending DataForSEO tasks, submit new ones under the monthly budget, refresh
// stale locations, then insert deduped rows, reconcile counts, refresh the
// schema/analytics, and schedule the next run. The DataForSEO client, budget
// ledger, analytics and taxonomy collaborators are mocked at their boundary;
// the fake Supabase honors the like/is/not/lt/order filters the phases rely on.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeService, type FakeService, type Row } from '../helpers/fakeSupabase'

const submitReviewTask = vi.fn(), submitTripadvisorReviewTask = vi.fn(), checkReviewTask = vi.fn()
vi.mock('@/lib/dataforseo', () => ({
  submitReviewTask: (...a: unknown[]) => submitReviewTask(...a),
  submitTripadvisorReviewTask: (...a: unknown[]) => submitTripadvisorReviewTask(...a),
  checkReviewTask: (...a: unknown[]) => checkReviewTask(...a),
}))
const computeAnalyticsSQL = vi.fn(async () => ({ totalRows: 2 }))
vi.mock('@/lib/analyticsCompute', () => ({ computeAnalyticsSQL: (...a: unknown[]) => computeAnalyticsSQL(...(a as [])) }))
const getReviewBudget = vi.fn<() => Promise<{ remaining: number | null; cap: number | null; used: number }>>(async () => ({ remaining: null, cap: null, used: 0 }))
const logReviewDownload = vi.fn(async () => {})
vi.mock('@/lib/reviewLimits', () => ({ getReviewBudget: (...a: unknown[]) => getReviewBudget(...(a as [])), logReviewDownload: (...a: unknown[]) => logReviewDownload(...(a as [])) }))
const classifyPendingRows = vi.fn(async () => ({ classified: 3, hasMore: false }))
vi.mock('@/lib/taxonomyClassify', () => ({ classifyPendingRows: (...a: unknown[]) => classifyPendingRows(...(a as [])) }))
const readStoredTaxonomy = vi.fn(async () => null as unknown)
vi.mock('@/lib/taxonomyRollup', () => ({ readStoredTaxonomy: (...a: unknown[]) => readStoredTaxonomy(...(a as [])) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

import { syncReviewSource, reviewDedupKey } from '@/lib/reviewSync'

const HOUR = 3600_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const GET = '/business_data/google/reviews/task_get/'
function loc(over: Row): Row {
  return { id: 'L', review_source_id: 'src1', selected: true, name: 'Tampa', city: 'Tampa', state: 'FL', address: '1 Main St', place_id: 'p-tampa', review_count: 120, created_at: iso(400 * 24 * HOUR), last_review_id: null, last_review_date: null, last_synced_at: null, total_pulled: 0, error_message: null, ...over }
}
const REVIEWS = [
  { review_id: 'r1', profile_name: 'Ann', rating: 5, review_text: 'Great wait staff', timestamp: '2026-06-02T10:00:00+00:00', owner_answer: 'Thanks!', owner_timestamp: null, review_url: null, review_likes: 2 },
  { review_id: 'r2', profile_name: 'Bob', rating: 2, review_text: null, timestamp: '2026-05-01T10:00:00+00:00', owner_answer: null, owner_timestamp: null, review_url: null, review_likes: 0 },
  { review_id: 'r3', profile_name: 'Cy', rating: 4, review_text: 'Old review', timestamp: '2025-12-01T10:00:00+00:00', owner_answer: null, owner_timestamp: null, review_url: null, review_likes: 0 },
]

let svc: FakeService
function tables(): Record<string, Row[]> {
  return {
    review_sources: [{ id: 'src1', org_id: 'org-1', dataset_id: 'ds1', source: 'google', sync_frequency_hours: 24, status: 'active' }],
    datasets: [{ id: 'ds1', description: JSON.stringify({ start_date: '2026-01-01', end_date: '2026-12-31' }), row_count: 0 }],
    review_source_locations: [
      loc({ id: 'L1', error_message: 'pending_task:t1|' + GET }),                                    // Phase 1: ready
      loc({ id: 'L4', name: 'Orlando', place_id: 'p-orl', error_message: 'pending_task:t-err|' + GET }), // Phase 1: hard error
      loc({ id: 'L5', name: 'Miami', place_id: 'p-mia', error_message: 'pending_task:t-pend|' + GET }),  // Phase 1: still pending
      loc({ id: 'L2', name: 'Jax', place_id: 'p-jax', review_count: 300 }),                            // Phase 2: unsynced
      loc({ id: 'L3', name: 'Ocala', place_id: 'p-oca', last_synced_at: iso(48 * HOUR), last_review_id: 'old' }), // Phase 3: stale
      loc({ id: 'L6', name: 'Fresh', place_id: 'p-fre', last_synced_at: iso(10 * 60_000) }),          // recently synced → untouched
      loc({ id: 'L7', name: 'Unselected', selected: false }),
    ],
    dataset_rows_flat: [],
    dataset_state: [],
  }
}

beforeEach(() => {
  svc = makeFakeService({ tables: tables() })
  submitReviewTask.mockReset().mockImplementation(async (placeId: string) => ({ taskId: 'new-' + placeId, getPath: GET }))
  submitTripadvisorReviewTask.mockReset().mockImplementation(async (placeId: string) => ({ taskId: 'ta-' + placeId, getPath: '/business_data/tripadvisor/reviews/task_get/' }))
  checkReviewTask.mockReset().mockImplementation(async (ref: { taskId: string }) => {
    if (ref.taskId === 't1') return { status: 'ready', reviews: REVIEWS }
    if (ref.taskId === 't-err') return { status: 'error', message: '(40501): Invalid Field' }
    return { status: 'pending' }
  })
  computeAnalyticsSQL.mockClear(); getReviewBudget.mockReset().mockResolvedValue({ remaining: null, cap: null, used: 0 })
  logReviewDownload.mockClear(); classifyPendingRows.mockClear(); readStoredTaxonomy.mockReset().mockResolvedValue(null)
})

describe('syncReviewSource — guards', () => {
  it('throws for an unknown source and for a source with no dataset', async () => {
    await expect(syncReviewSource('nope', svc as never)).rejects.toThrow(/Review source not found/)
    svc.tables.review_sources[0].dataset_id = null
    await expect(syncReviewSource('src1', svc as never)).rejects.toThrow('Review source has no linked dataset')
  })
})

describe('syncReviewSource — the three phases + save', () => {
  it('drains ready tasks (date-ranged, deduped, counted), records hard errors, submits new + stale locations, inserts rows and schedules a 5-minute retry while tasks remain', async () => {
    const r = await syncReviewSource('src1', svc as never)
    // Phase 1 — L1 ready: r3 is outside the date range; r2 has no text
    expect(r.locations_synced).toBe(1)
    expect(r.expected_reviews).toBe(120)
    expect(r.with_comments).toBe(1); expect(r.without_comments).toBe(1)
    expect(r.pending_locations).toEqual(['Tampa', 'Orlando', 'Miami'])
    const L1 = svc.tables.review_source_locations.find(l => l.id === 'L1')!
    expect(L1).toMatchObject({ last_review_id: 'r1', last_review_date: '2026-06-02T10:00:00+00:00', total_pulled: 2, error_message: null })
    expect(L1.last_synced_at).toBeTruthy()
    // Phase 1 — L4 hard error parks the location with the message; L5 keeps its task ref
    expect(r.locations_errored).toBe(1)
    expect(r.errors).toContain('Orlando: (40501): Invalid Field')
    expect(svc.tables.review_source_locations.find(l => l.id === 'L4')!.error_message).toBe('(40501): Invalid Field')
    expect(svc.tables.review_source_locations.find(l => l.id === 'L5')!.error_message).toBe('pending_task:t-pend|' + GET)
    // Phase 2 — L2 initial pull: depth estimated from the date range → clamped to the 200 floor
    expect(submitReviewTask).toHaveBeenCalledWith('p-jax', 200, 'newest')
    expect(svc.tables.review_source_locations.find(l => l.id === 'L2')!.error_message).toBe('pending_task:new-p-jax|' + GET)
    // Phase 3 — L3 stale refresh at depth 200; the fresh one is left alone
    expect(submitReviewTask).toHaveBeenCalledWith('p-oca', 200, 'newest')
    expect(submitReviewTask).not.toHaveBeenCalledWith('p-fre', expect.anything(), expect.anything())
    expect(r.locations_submitted).toBe(2)
    // Save — two flat rows, contiguous row_index, substantive stamps, dedup keys; row_count reconciled to the real count
    expect(r.synced).toBe(2)
    const rows = svc.tables.dataset_rows_flat
    expect(rows.map(x => x.row_index)).toEqual([0, 1])
    expect(rows[0]).toMatchObject({ dataset_id: 'ds1', substantive_v: expect.any(Number) })
    expect(rows[0].data).toMatchObject({ review_id: 'r1', author: 'Ann', rating: 5, review_text: 'Great wait staff', review_date: '2026-06-02', location: 'Tampa - Tampa, FL', location_name: 'Tampa', place_id: 'p-tampa', owner_response: 'Thanks!', review_likes: 2 })
    expect(rows[1].data).toMatchObject({ review_id: 'r2', review_text: '', owner_response: '' })
    expect(rows[0].dedup_key).toBe(reviewDedupKey(rows[0].data as Record<string, unknown>))
    expect(svc.tables.datasets[0].row_count).toBe(2)
    expect(r.total).toBe(2)
    expect(logReviewDownload).toHaveBeenCalledWith(svc, { orgId: 'org-1', reviewSourceId: 'src1', datasetId: 'ds1', source: 'google', records: 2 })
    // remaining = pending (L5 + the two just submitted) + unsynced 0 + stale 0
    expect(r.locations_remaining).toBe(3)
    // schema built from scratch and analytics recomputed
    const state = svc.writesTo('dataset_state')
    expect(state.length).toBeGreaterThanOrEqual(1)
    expect((state[0].payload as { schema_config: { fields: unknown[] } }).schema_config.fields.length).toBeGreaterThan(5)
    expect(computeAnalyticsSQL).toHaveBeenCalledTimes(1)
    // next sync in ~5 minutes because tasks are still pending; dataset NOT stamped complete
    const src = svc.tables.review_sources[0]
    const nextMs = new Date(src.next_sync_at as string).getTime() - Date.now()
    expect(nextMs).toBeGreaterThan(4 * 60_000); expect(nextMs).toBeLessThan(6 * 60_000)
    expect(src.status).toBe('active')
    expect(svc.writesTo('datasets').filter(w => (w.payload as Row).last_synced_at && !(w.payload as Row).row_count)).toHaveLength(0)
  })

  it('drainOnly runs Phase 1 only; the monthly budget caps depth then pauses submissions', async () => {
    const d = await syncReviewSource('src1', svc as never, { drainOnly: true })
    expect(d.locations_synced).toBe(1)
    expect(submitReviewTask).not.toHaveBeenCalled()
    expect(d.locations_submitted).toBe(0)

    svc = makeFakeService({ tables: tables() })
    getReviewBudget.mockResolvedValue({ remaining: 150, cap: 1000, used: 850 })
    const b = await syncReviewSource('src1', svc as never)
    expect(submitReviewTask).toHaveBeenCalledTimes(1)                   // 150 spent on L2 → nothing left for Phase 3
    expect(submitReviewTask).toHaveBeenCalledWith('p-jax', 150, 'newest')
    expect(b.limit_reached).toBe(true)
    expect(b.errors).toContain('Monthly review-download limit reached — refresh paused')
  })

  it('transient submit failures keep the location retryable; permanent ones park it', async () => {
    submitReviewTask.mockImplementation(async (placeId: string) => {
      if (placeId === 'p-jax') throw new Error('fetch failed: ECONNRESET')
      throw new Error('(40501): Invalid Field')
    })
    const r = await syncReviewSource('src1', svc as never)
    expect(r.locations_errored).toBe(3)                                  // L4 (phase 1) + L2 + L3
    expect(svc.tables.review_source_locations.find(l => l.id === 'L2')!.error_message).toBeNull()
    expect(svc.tables.review_source_locations.find(l => l.id === 'L3')!.error_message).toBe('(40501): Invalid Field')
  })

  it('a ready task with zero reviews is flagged on the location; a transient check failure preserves the task ref', async () => {
    checkReviewTask.mockImplementation(async (ref: { taskId: string }) => {
      if (ref.taskId === 't1') return { status: 'ready', reviews: [] }
      if (ref.taskId === 't-err') throw new Error('network timeout')
      return { status: 'pending' }
    })
    const r = await syncReviewSource('src1', svc as never, { drainOnly: true })
    expect(r.errors).toContain('Tampa: API returned 0 reviews (expected ~120)')
    expect(svc.tables.review_source_locations.find(l => l.id === 'L1')!.error_message).toBe('API returned 0 reviews')
    expect(svc.tables.review_source_locations.find(l => l.id === 'L4')!.error_message).toBe('pending_task:t-err|' + GET)
    expect(r.synced).toBe(0)
    expect(computeAnalyticsSQL).not.toHaveBeenCalled()
  })

  it('incremental drain stops at the last known review; existing schema is merged; taxonomy-classified datasets auto-classify; a fully-fresh cycle stamps the dataset', async () => {
    svc.tables.review_source_locations = [loc({ id: 'L1', error_message: 'pending_task:t1|' + GET, last_review_id: 'r2', last_review_date: null, last_synced_at: iso(HOUR) })]
    svc.tables.dataset_state = [{ dataset_id: 'ds1', schema_config: { fields: [{ field: 'review_text', type: 'open-ended' }, { field: 'location', type: 'categorical', values: ['Old'] }] } }]
    readStoredTaxonomy.mockResolvedValue({ fields: { review_text: { selFields: ['review_text'] }, combo: { selFields: [] } } })
    const r = await syncReviewSource('src1', svc as never, { drainOnly: true })
    expect(r.synced).toBe(1)                                             // only r1 is newer than the last known r2
    expect(svc.tables.dataset_rows_flat[0].data).toMatchObject({ review_id: 'r1' })
    // Merge path (not rebuild): the user's two-field schema is preserved instead of being replaced by the full Google schema
    const merged = (svc.writesTo('dataset_state')[0].payload as { schema_config: { fields: { field: string; values?: string[] }[] } }).schema_config
    expect(merged.fields.map(f => f.field)).toEqual(['review_text', 'location'])
    expect(merged.fields.find(f => f.field === 'location')!.values).toEqual(expect.arrayContaining(['Old']))
    expect(classifyPendingRows).toHaveBeenCalledTimes(2)
    expect(classifyPendingRows).toHaveBeenCalledWith(expect.objectContaining({ datasetId: 'ds1', orgId: 'org-1', textFields: ['review_text'], brand: 'core', maxRows: 10000 }))
    expect(r.locations_remaining).toBe(0)
    expect(svc.tables.datasets[0].last_synced_at).toBeTruthy()
    // 24h cadence, nothing pending → next sync ≈ +24h
    const nextMs = new Date(svc.tables.review_sources[0].next_sync_at as string).getTime() - Date.now()
    expect(nextMs).toBeGreaterThan(23 * HOUR); expect(nextMs).toBeLessThan(25 * HOUR)
  })

  it('manual sources (frequency 0) with nothing pending are parked far in the future; Tripadvisor sources submit through the Tripadvisor client', async () => {
    svc.tables.review_sources[0].sync_frequency_hours = 0
    svc.tables.review_sources[0].source = 'tripadvisor'
    svc.tables.review_source_locations = [loc({ id: 'L2', name: 'Jax', place_id: '/Restaurant-x' })]
    checkReviewTask.mockResolvedValue({ status: 'pending' })
    await syncReviewSource('src1', svc as never)
    expect(submitTripadvisorReviewTask).toHaveBeenCalledWith('/Restaurant-x', 200, 'newest')
    expect(submitReviewTask).not.toHaveBeenCalled()
    // the just-submitted task is pending → 5-minute retry wins over manual parking
    let nextMs = new Date(svc.tables.review_sources[0].next_sync_at as string).getTime() - Date.now()
    expect(nextMs).toBeLessThan(6 * 60_000)
    svc.tables.review_source_locations = []
    await syncReviewSource('src1', svc as never)
    nextMs = new Date(svc.tables.review_sources[0].next_sync_at as string).getTime() - Date.now()
    expect(nextMs).toBeGreaterThan(100 * 365 * 24 * HOUR)
  })

  it('analytics failure is logged, not fatal; a classify failure is swallowed', async () => {
    computeAnalyticsSQL.mockRejectedValue(new Error('57014'))
    readStoredTaxonomy.mockResolvedValue({ fields: { review_text: { selFields: ['review_text'] } } })
    classifyPendingRows.mockRejectedValue(new Error('classify down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await syncReviewSource('src1', svc as never, { drainOnly: true })
    expect(r.synced).toBe(2)
    expect(err).toHaveBeenCalledTimes(2)
    err.mockRestore()
  })
})

describe('dedup', () => {
  it('reviewDedupKey is content-addressed and author-case-insensitive; in-batch and already-present duplicates are not re-inserted', async () => {
    const a = reviewDedupKey({ place_id: 'p', author: 'Ann', review_date: '2026-06-02', review_text: 'Great' })
    expect(a).toBe(reviewDedupKey({ place_id: 'p', author: ' ann ', review_date: '2026-06-02', review_text: 'great' }))
    expect(a).not.toBe(reviewDedupKey({ place_id: 'p', author: 'Ann', review_date: '2026-06-03', review_text: 'Great' }))
    expect(a).toMatch(/^[0-9a-f]{40}$/)

    // r1 already present in the dataset → only r2 is inserted, appended after the existing max row_index
    const existing = { review_id: 'r1', author: 'Ann', rating: 5, review_text: 'Great wait staff', review_date: '2026-06-02', location: 'Tampa - Tampa, FL', location_name: 'Tampa', location_address: '1 Main St', location_city: 'Tampa', location_state: 'FL', place_id: 'p-tampa', owner_response: 'Thanks!', review_likes: 2 }
    svc.tables.dataset_rows_flat = [{ dataset_id: 'ds1', row_index: 7, data: existing, dedup_key: reviewDedupKey(existing) }]
    checkReviewTask.mockResolvedValue({ status: 'ready', reviews: [REVIEWS[0], REVIEWS[0], REVIEWS[1]] })
    svc.tables.review_source_locations = [loc({ id: 'L1', error_message: 'pending_task:t1|' + GET })]
    const r = await syncReviewSource('src1', svc as never, { drainOnly: true })
    expect(r.synced).toBe(3)                                             // rows produced (the ledger counts what the API returned in range)
    expect(svc.tables.dataset_rows_flat.map(x => [x.row_index, (x.data as Row).review_id])).toEqual([[7, 'r1'], [8, 'r2']])
    expect(svc.tables.datasets[0].row_count).toBe(2)
  })
})
