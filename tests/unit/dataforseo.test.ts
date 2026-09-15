// lib/dataforseo.ts — the DataForSEO client behind Google Maps location search,
// Google/Tripadvisor review pulls, keyword volume, and organic SERP. Boundary =
// `fetch` (stubbed per test with a response queue) and the credit monitor
// (mocked). The polling loops sleep for real seconds, so those tests run on
// fake timers and drain them with runAllTimersAsync.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const recordCreditError = vi.fn(async () => {})
vi.mock('@/lib/serviceHealth', () => ({ recordCreditError: (...a: unknown[]) => recordCreditError(...(a as [])) }))

import {
  getDataForSeoBalance, searchLocations, submitReviewTask, checkReviewTask, fetchReviews,
  fetchReviewsBatch, searchTripadvisorLocations, submitTripadvisorReviewTask,
  classifySearchInterest, getSearchVolumes, searchGoogle,
} from '@/lib/dataforseo'

type Call = { url: string; method: string; body: unknown }
let calls: Call[]
let queue: Array<{ status: number; body: unknown; raw?: string }>

function enqueue(status: number, body: unknown, raw?: string) { queue.push({ status, body, raw }) }
function task(over: Record<string, unknown>) { return { tasks: [{ status_code: 20000, ...over }] } }

beforeEach(() => {
  calls = []; queue = []
  recordCreditError.mockClear()
  process.env.DATAFORSEO_LOGIN = 'user'
  process.env.DATAFORSEO_PASSWORD = 'pw'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    const next = queue.shift()
    if (!next) throw new Error('fetch called with an empty response queue: ' + url)
    return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => next.raw ?? JSON.stringify(next.body) }
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('transport', () => {
  it('refuses to call out without credentials', async () => {
    delete process.env.DATAFORSEO_LOGIN
    await expect(searchLocations('x')).rejects.toThrow(/DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/)
    expect(calls).toHaveLength(0)
  })

  it('sends Basic auth and JSON bodies to the v3 base URL', async () => {
    enqueue(200, task({ result: [{ items: [] }] }))
    await searchLocations('Cheddars')
    expect(calls[0].url).toBe('https://api.dataforseo.com/v3/serp/google/maps/live/advanced')
    expect(calls[0].method).toBe('POST')
    expect((calls[0].body as Array<{ keyword: string; depth: number }>)[0]).toMatchObject({ keyword: 'Cheddars', depth: 700 })
    const auth = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(auth.Authorization).toBe('Basic ' + Buffer.from('user:pw').toString('base64'))
  })

  it('HTTP 402 on a POST feeds the credit monitor and throws', async () => {
    enqueue(402, null, 'insufficient funds')
    await expect(searchLocations('x')).rejects.toThrow(/HTTP 402/)
    expect(recordCreditError).toHaveBeenCalledWith('dataforseo', { code: 402, message: 'insufficient funds' })
  })

  it('non-402 HTTP errors and non-JSON bodies throw without touching the monitor', async () => {
    enqueue(500, null, 'boom')
    await expect(searchLocations('x')).rejects.toThrow(/HTTP 500: boom/)
    enqueue(200, null, '<html>not json</html>')
    await expect(searchLocations('x')).rejects.toThrow(/returned non-JSON/)
    enqueue(200, null, 'nope')
    await expect(getDataForSeoBalance()).rejects.toThrow(/returned non-JSON/)
    enqueue(503, null, 'down')
    await expect(getDataForSeoBalance()).rejects.toThrow(/HTTP 503/)
    expect(recordCreditError).not.toHaveBeenCalled()
  })
})

describe('getDataForSeoBalance', () => {
  it('reads money.balance from user_data', async () => {
    enqueue(200, task({ result: [{ money: { balance: 42.5 } }] }))
    expect(await getDataForSeoBalance()).toBe(42.5)
    expect(calls[0].url).toMatch(/\/appendix\/user_data$/)
    expect(calls[0].method).toBe('GET')
  })
  it('throws when the balance is missing', async () => {
    enqueue(200, task({ result: [{}] }))
    await expect(getDataForSeoBalance()).rejects.toThrow(/no money.balance/)
  })
})

describe('searchLocations', () => {
  it('parses maps_search items, preferring structured address_info and falling back to the address string', async () => {
    enqueue(200, task({ result: [{ items: [
      { type: 'maps_search', place_id: 'p1', title: 'Cheddars Tampa', address: '1 Main St, Tampa, FL 33602', address_info: { city: 'Tampa', region: 'FL', zip: '33602' }, rating: { value: 4.2, votes_count: 1200 }, phone: '555', latitude: 27.9, longitude: -82.4 },
      { type: 'maps_search', place_id: 'p2', title: 'Cheddars Orlando', address: '2 Elm Ave, Orlando, FL 32801' },
      { type: 'maps_search', place_id: 'p3', title: 'State only', address: 'Somewhere, Austin, TX, USA' },
      { type: 'maps_search', place_id: 'p4', title: 'Country code only', address: 'Foo, US, ' },
      { type: 'maps_search', place_id: 'p5', title: 'No address', address: '' },
      { type: 'maps_paid_item', place_id: 'ad' },
      { type: 'maps_search' },
    ] }] }))
    const out = await searchLocations('Cheddars')
    expect(out.map(l => l.place_id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    expect(out[0]).toMatchObject({ city: 'Tampa', state: 'FL', zip: '33602', rating: 4.2, review_count: 1200, phone: '555', latitude: 27.9 })
    expect(out[1]).toMatchObject({ city: 'Orlando', state: 'FL', zip: '32801', rating: null, review_count: 0, phone: null })
    expect(out[2]).toMatchObject({ city: 'Austin', state: 'TX', zip: null })
    expect(out[3]).toMatchObject({ city: null, state: null, zip: null })
    expect(out[4]).toMatchObject({ city: null, state: null, zip: null, address: null })
  })
  it('surfaces a failed task with its status message', async () => {
    enqueue(200, { tasks: [{ status_code: 40501, status_message: 'Invalid Field' }] })
    await expect(searchLocations('x')).rejects.toThrow(/Search failed: Invalid Field/)
    enqueue(200, { tasks: [] })
    await expect(searchLocations('x')).rejects.toThrow(/Unknown error/)
  })
})

describe('review tasks (Google)', () => {
  it('submitReviewTask falls through to the business_data path when the reviews path rejects', async () => {
    enqueue(500, null, 'first path down')
    enqueue(200, { tasks: [{ id: 't-2', status_code: 20100 }] })
    const ref = await submitReviewTask('place-1', 9999, 'relevant')
    expect(ref).toEqual({ taskId: 't-2', getPath: '/business_data/google/reviews/task_get/' })
    expect(calls[0].url).toMatch(/\/reviews\/google\/task_post$/)
    expect((calls[0].body as Array<{ depth: number; sort_by: string; keyword: string }>)[0]).toMatchObject({ depth: 4490, sort_by: 'relevant', keyword: 'place_id:place-1' })
    expect(calls[1].url).toMatch(/\/business_data\/google\/reviews\/task_post$/)
  })
  it('submitReviewTask reports the last failure when every path declines', async () => {
    enqueue(200, { tasks: [{ status_code: 40000, status_message: 'nope A' }] })
    enqueue(200, { tasks: [{ status_code: 40000, status_message: 'nope B' }] })
    await expect(submitReviewTask('p')).rejects.toThrow(/Failed to submit review task: \/business_data\/google\/reviews\/task_post: nope B/)
  })

  const ref = { taskId: 't1', getPath: '/business_data/google/reviews/task_get/' }
  it('checkReviewTask: ready → parsed reviews (id fallbacks, rating object, profile_url)', async () => {
    enqueue(200, task({ result: [{ reviews_count: 3, items: [
      { review_id: 'r1', profile_name: 'Ann', rating: 5, review_text: 'Great', timestamp: '2026-01-02T00:00:00+00:00', owner_answer: 'Thanks', owner_timestamp: '2026-01-03T00:00:00+00:00', review_url: 'u', reviews_count: 7 },
      { id: 'r2', author_name: 'Bob', rating: { value: 3 }, timestamp: '2026-01-01T00:00:00+00:00', profile_url: 'pu' },
      { profile_name: 'Cy', timestamp: 'ts', rank_absolute: 9 },
    ] }] }))
    const res = await checkReviewTask(ref)
    expect(res.status).toBe('ready')
    if (res.status !== 'ready') return
    expect(calls[0].url).toBe('https://api.dataforseo.com/v3' + ref.getPath + 't1')
    expect(res.reviews[0]).toMatchObject({ review_id: 'r1', profile_name: 'Ann', rating: 5, owner_answer: 'Thanks', review_url: 'u', review_likes: 7 })
    expect(res.reviews[1]).toMatchObject({ review_id: 'r2', profile_name: 'Bob', rating: 3, review_url: 'pu', review_text: null, review_likes: 0 })
    expect(res.reviews[2]).toMatchObject({ review_id: 'Cy:ts', profile_name: 'Cy', rating: 0 })
  })
  it('checkReviewTask: queue/processing codes and a missing task are pending; ≥40000 is an error', async () => {
    for (const code of [40402, 40602, 140607]) {
      enqueue(200, { tasks: [{ status_code: code }] })
      expect(await checkReviewTask(ref)).toEqual({ status: 'pending' })
    }
    enqueue(200, { tasks: [] })
    expect(await checkReviewTask(ref)).toEqual({ status: 'pending' })
    enqueue(200, { tasks: [{ status_code: 40501, status_message: 'Invalid Field' }] })
    expect(await checkReviewTask(ref)).toEqual({ status: 'error', message: '(40501): Invalid Field' })
    enqueue(200, { tasks: [{ status_code: 20000, result: [] }] })
    expect(await checkReviewTask(ref)).toEqual({ status: 'pending' })
  })
  it('checkReviewTask: ready with reviews_count but empty items warns and returns zero reviews', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    enqueue(200, task({ result: [{ reviews_count: 12, items: [] }] }))
    const res = await checkReviewTask(ref)
    expect(res).toEqual({ status: 'ready', reviews: [] })
    // logWarn emits its structured line after awaiting the request-id lookup
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.objectContaining({ at: 'dataforseo.checkReviewTask' })))
    warn.mockRestore()
  })

  it('fetchReviews polls until ready (fake timers) and throws on a task error', async () => {
    vi.useFakeTimers()
    enqueue(200, { tasks: [{ id: 't9' }] })                       // submit
    enqueue(200, { tasks: [{ status_code: 40402 }] })             // poll 1: pending
    enqueue(200, task({ result: [{ items: [{ review_id: 'z', profile_name: 'Z', rating: 4, timestamp: 't' }] }] }))
    const p = fetchReviews('place')
    await vi.runAllTimersAsync()
    const reviews = await p
    expect(reviews.map(r => r.review_id)).toEqual(['z'])
    expect(calls).toHaveLength(3)

    enqueue(200, { tasks: [{ id: 't10' }] })
    enqueue(200, { tasks: [{ status_code: 40501, status_message: 'bad' }] })
    const p2 = fetchReviews('place').catch(e => e)
    await vi.runAllTimersAsync()
    expect((await p2).message).toBe('(40501): bad')
  })

  it('fetchReviewsBatch tags tasks by place_id and drops non-retryable failures', async () => {
    vi.useFakeTimers()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    enqueue(200, { tasks: [{ id: 'a', data: { tag: 'P1' } }, { id: 'b', data: { tag: 'P2' } }, { status_code: 40000 }] })
    enqueue(200, task({ result: [{ items: [{ review_id: 'r', profile_name: 'A', rating: 5, timestamp: 't' }] }] }))  // a ready
    enqueue(200, { tasks: [{ status_code: 40501, status_message: 'dead' }] })                                     // b fails
    const p = fetchReviewsBatch(['P1', 'P2'])
    await vi.runAllTimersAsync()
    const out = await p
    expect(Array.from(out.keys())).toEqual(['P1'])
    expect(out.get('P1')?.[0].review_id).toBe('r')
    await vi.waitFor(() => expect(err).toHaveBeenCalledWith(expect.objectContaining({ at: 'dataforseo.fetchReviewsBatch', err: expect.stringMatching(/Review task b failed: dead/) })))
    expect((calls[0].body as Array<{ tag: string }>).map(t => t.tag)).toEqual(['P1', 'P2'])
    err.mockRestore()
  })
})

describe('Tripadvisor', () => {
  it('searchTripadvisorLocations polls the task and strips rank prefixes from titles', async () => {
    vi.useFakeTimers()
    enqueue(200, { tasks: [{ id: 'ta1' }] })
    enqueue(200, { tasks: [{ status_code: 140607 }] })
    enqueue(200, { tasks: [] })
    enqueue(200, task({ result: [{ items: [
      { url_path: '/Restaurant_Review-x', title: '1. Salami Social Club', rating: { value: 4.5 }, reviews_count: 88 },
      { title: 'no url_path' },
    ] }] }))
    const p = searchTripadvisorLocations('salami')
    await vi.runAllTimersAsync()
    const out = await p
    expect(out).toEqual([{ place_id: '/Restaurant_Review-x', name: 'Salami Social Club', address: null, city: null, state: null, zip: null, rating: 4.5, review_count: 88, phone: null, latitude: null, longitude: null }])
    expect((calls[0].body as Array<{ location_name: string; depth: number }>)[0]).toMatchObject({ location_name: 'United States', depth: 210 })
  })
  it('searchTripadvisorLocations: no task id, hard error, and timeout each throw', async () => {
    vi.useFakeTimers()
    enqueue(200, { tasks: [{ status_message: 'quota' }] })
    await expect(searchTripadvisorLocations('x')).rejects.toThrow(/Tripadvisor search failed: quota/)

    enqueue(200, { tasks: [{ id: 't' }] })
    enqueue(200, { tasks: [{ status_code: 40501, status_message: 'bad' }] })
    const p = searchTripadvisorLocations('x').catch(e => e)
    await vi.runAllTimersAsync()
    expect((await p).message).toMatch(/failed \(40501\): bad/)

    enqueue(200, { tasks: [{ id: 't' }] })
    for (let i = 0; i < 10; i++) enqueue(200, { tasks: [{ status_code: 40402 }] })
    const p2 = searchTripadvisorLocations('x').catch(e => e)
    await vi.runAllTimersAsync()
    expect((await p2).message).toMatch(/timed out/)
  })
  it('submitTripadvisorReviewTask maps sort order and returns the tripadvisor get path', async () => {
    enqueue(200, { tasks: [{ id: 'tr1' }] })
    expect(await submitTripadvisorReviewTask('/x', 99999, 'newest')).toEqual({ taskId: 'tr1', getPath: '/business_data/tripadvisor/reviews/task_get/' })
    expect((calls[0].body as Array<{ sort_by: string; depth: number }>)[0]).toMatchObject({ sort_by: 'most_recent', depth: 4490 })
    enqueue(200, { tasks: [{ id: 'tr2' }] })
    await submitTripadvisorReviewTask('/x', 10, 'relevant')
    expect((calls[1].body as Array<{ sort_by: string }>)[0].sort_by).toBe('detailed_reviews')
    enqueue(200, { tasks: [{ status_message: 'no' }] })
    await expect(submitTripadvisorReviewTask('/x')).rejects.toThrow(/Failed to submit Tripadvisor review task: no/)
  })
  it('checkReviewTask routes tripadvisor refs to the tripadvisor parser (responses, user_profile, timestamp normalization)', async () => {
    const ref = { taskId: 't', getPath: '/business_data/tripadvisor/reviews/task_get/' }
    enqueue(200, task({ result: [{ items: [
      { review_id: 'ta-1', user_profile: { name: 'Dee' }, rating: { value: 4 }, review_text: 'ok', timestamp: '2025-06-08 00:00:00 +00:00', responses: [{ text: 'thx', timestamp: '2025-06-09 10:00:00 +00:00' }], url: 'https://ta/x' },
      { rank_absolute: 3, timestamp: '2025-01-01T00:00:00Z' },
      { profile_name: 'no id at all', timestamp: '' },
    ] }] }))
    const res = await checkReviewTask(ref)
    expect(res.status).toBe('ready')
    if (res.status !== 'ready') return
    expect(res.reviews).toHaveLength(2)
    expect(res.reviews[0]).toMatchObject({ review_id: 'ta-1', profile_name: 'Dee', rating: 4, timestamp: '2025-06-08T00:00:00+00:00', owner_answer: 'thx', owner_timestamp: '2025-06-09T10:00:00+00:00', review_url: 'https://ta/x', review_likes: 0 })
    expect(res.reviews[1]).toMatchObject({ review_id: '3', profile_name: 'Anonymous', rating: 0, timestamp: '2025-01-01T00:00:00Z', owner_answer: null, owner_timestamp: null })
  })
})

describe('search interest + SERP', () => {
  it('classifySearchInterest tiers', () => {
    expect(classifySearchInterest(2_000_000)).toBe('high')
    expect(classifySearchInterest(100_000)).toBe('moderate')
    expect(classifySearchInterest(5_000)).toBe('low')
    expect(classifySearchInterest(4_999)).toBeNull()
  })
  it('getSearchVolumes: empty input short-circuits; trends compare recent vs prior 3 months', async () => {
    expect(await getSearchVolumes([])).toEqual([])
    expect(calls).toHaveLength(0)
    const months = (vals: number[]) => vals.map((v, i) => ({ year: 2026, month: 9 - i, search_volume: v }))
    enqueue(200, task({ result: [
      { keyword: 'up', search_volume: 900, monthly_searches: months([300, 300, 300, 200, 200, 200]) },
      { keyword: 'down', search_volume: 500, monthly_searches: months([100, 100, 100, 200, 200, 200]) },
      { keyword: 'steady', search_volume: 600, monthly_searches: months([210, 200, 200, 200, 200, 200]) },
      { keyword: 'fresh', search_volume: 10, monthly_searches: months([5, 5, 0, 0, 0, 0]) },
      { keyword: 'short', search_volume: 1, monthly_searches: months([1, 1]) },
      { search_volume: null },
    ] }))
    const out = await getSearchVolumes(Array.from({ length: 1200 }, (_, i) => 'k' + i))
    expect((calls[0].body as Array<{ keywords: string[] }>)[0].keywords).toHaveLength(1000)
    expect(out.map(o => [o.keyword, o.searchVolume, o.trend])).toEqual([
      ['up', 900, 'up'], ['down', 500, 'down'], ['steady', 600, 'steady'], ['fresh', 10, 'up'], ['short', 1, null], ['', 0, null],
    ])
  })
  it('searchGoogle keeps organic items with a url', async () => {
    enqueue(200, task({ result: [{ items: [
      { type: 'organic', url: 'https://a', title: 'A', description: 'da' },
      { type: 'paid', url: 'https://ad' },
      { type: 'organic' },
      { type: 'organic', url: 'https://b' },
    ] }] }))
    expect(await searchGoogle('sentimetrx', 20)).toEqual([
      { url: 'https://a', title: 'A', description: 'da' },
      { url: 'https://b', title: '', description: '' },
    ])
    expect((calls[0].body as Array<{ depth: number }>)[0].depth).toBe(20)
  })
})
