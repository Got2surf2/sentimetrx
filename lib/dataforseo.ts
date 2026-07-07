import 'server-only'

// lib/dataforseo.ts
// DataForSEO API client for Google Maps business search and Google Reviews

import { recordCreditError } from '@/lib/serviceHealth'

const BASE = 'https://api.dataforseo.com/v3'

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) throw new Error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD env vars required')
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64')
}

async function post(path: string, body: unknown[]): Promise<DfsResponse> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Authorization': authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    // HTTP 402 = out of account balance (the Rubio's stall, 2026-06-16).
    // Surface it to the credit monitor instead of only burying it in a
    // per-location error_message.
    if (res.status === 402) void recordCreditError('dataforseo', { code: 402, message: text.slice(0, 200) })
    throw new Error(`DataForSEO ${path} HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  try { return JSON.parse(text) } catch {
    throw new Error(`DataForSEO ${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
}

async function get(path: string): Promise<DfsResponse> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: { 'Authorization': authHeader() },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`DataForSEO ${path} HTTP ${res.status}: ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch {
    throw new Error(`DataForSEO ${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
}

// Current account balance in USD, for the service-credit monitor (§ /admin/health
// + service-balance cron). /v3/appendix/user_data returns money.balance for the
// authed account. Throws on HTTP/parse error (incl. the 402 that means broke).
export async function getDataForSeoBalance(): Promise<number> {
  const data = await get('/appendix/user_data')
  const bal = data?.tasks?.[0]?.result?.[0]?.money?.balance
  if (typeof bal !== 'number') throw new Error('DataForSEO user_data: no money.balance in response')
  return bal
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DfsLocation {
  place_id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  rating: number | null
  review_count: number
  phone: string | null
  latitude: number | null
  longitude: number | null
}

export interface DfsReview {
  review_id: string
  profile_name: string
  rating: number
  review_text: string | null
  timestamp: string            // ISO UTC
  owner_answer: string | null
  owner_timestamp: string | null
  review_url: string | null
  review_likes: number
}

// ---------------------------------------------------------------------------
// Loosely-typed DataForSEO JSON response shapes (only the fields we read).
// ---------------------------------------------------------------------------

interface DfsMoney { balance?: number }
interface MonthlySearch { year: number; month: number; search_volume: number }

interface DfsResult {
  items?: unknown[]
  reviews_count: number
  money?: DfsMoney
  // search_volume/live returns keyword rows directly as result entries
  keyword?: string
  search_volume?: number
  monthly_searches?: MonthlySearch[]
}

interface DfsTask {
  id?: string
  status_code: number
  status_message?: string
  result?: DfsResult[] | null
  data?: { tag?: string }
}

interface DfsResponse {
  tasks?: DfsTask[]
}

interface RatingObj { value?: number | null; votes_count?: number }
interface AddressInfo { city?: string; region?: string; zip?: string }

interface DfsBusinessItem {
  type?: string
  place_id?: string
  title?: string
  address?: string
  address_info?: AddressInfo
  rating?: RatingObj
  phone?: string
  latitude?: number | null
  longitude?: number | null
  url_path?: string
  reviews_count?: number
}

interface DfsReviewItem {
  review_id?: string
  id?: string
  profile_name: string
  author_name?: string
  timestamp: string
  rank_absolute?: number
  rating?: number | RatingObj
  review_text?: string | null
  owner_answer?: string | null
  owner_timestamp?: string | null
  review_url?: string | null
  profile_url?: string | null
  reviews_count?: number
  // Tripadvisor-specific fields
  responses?: { text?: string | null; timestamp?: string | null }[]
  user_profile?: { name?: string }
  url?: string | null
}

interface DfsSerpItem {
  type?: string
  url?: string
  title?: string
  description?: string
}

// ---------------------------------------------------------------------------
// Search locations (live endpoint — instant results)
// ---------------------------------------------------------------------------

export async function searchLocations(keyword: string): Promise<DfsLocation[]> {
  // Use Google Maps SERP to find all locations of a brand/chain
  const data = await post('/serp/google/maps/live/advanced', [{
    keyword,
    location_code: 2840,       // United States
    language_code: 'en',
    device: 'desktop',
    os: 'windows',
    depth: 700,                // max results
  }])

  const tasks = data?.tasks
  if (!tasks?.length || tasks[0].status_code !== 20000) {
    throw new Error(`Search failed: ${tasks?.[0]?.status_message || 'Unknown error'}`)
  }

  const items = (tasks[0].result?.[0]?.items || []) as DfsBusinessItem[]
  return items
    .filter((item) => item?.type === 'maps_search')
    .map(parseBusinessItem)
    .filter((l: DfsLocation | null) => l !== null)
}

function parseBusinessItem(item: DfsBusinessItem): DfsLocation | null {
  if (!item?.place_id) return null
  // Use structured address_info if available, fall back to parsing address string
  const ai: AddressInfo = item.address_info || {}
  const fallback = ai.city ? null : parseAddressString(item.address || '')
  return {
    place_id: item.place_id,
    name: item.title || '',
    address: item.address || null,
    city: ai.city || fallback?.city || null,
    state: ai.region || fallback?.state || null,
    zip: ai.zip || fallback?.zip || null,
    rating: item.rating?.value ?? null,
    review_count: item.rating?.votes_count ?? 0,
    phone: item.phone || null,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
  }
}

function parseAddressString(address: string): { city: string | null; state: string | null; zip: string | null } {
  if (!address) return { city: null, state: null, zip: null }
  // Search anywhere in the string for a US state code + optional zip
  // Matches "FL 33602" or "FL" when preceded by comma/space context
  const stateZipMatch = address.match(/,\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/)
  if (stateZipMatch) {
    const state = stateZipMatch[1]
    const zip = stateZipMatch[2]
    // City is the part before the state match
    const beforeState = address.substring(0, stateZipMatch.index!)
    const parts = beforeState.split(',').map(p => p.trim()).filter(Boolean)
    const city = parts.length > 0 ? parts[parts.length - 1] : null
    return { city, state, zip }
  }
  // Try just state code without zip: ", FL," or ", FL "
  const stateOnly = address.match(/,\s*([A-Z]{2})\s*(?:,|$)/)
  if (stateOnly) {
    const state = stateOnly[1]
    // Skip common non-state codes
    if (['US', 'UK'].includes(state)) return { city: null, state: null, zip: null }
    const beforeState = address.substring(0, stateOnly.index!)
    const parts = beforeState.split(',').map(p => p.trim()).filter(Boolean)
    const city = parts.length > 0 ? parts[parts.length - 1] : null
    return { city, state, zip: null }
  }
  return { city: null, state: null, zip: null }
}

// ---------------------------------------------------------------------------
// Fetch reviews — standard async queue (cheaper, used for bulk pulls)
// ---------------------------------------------------------------------------

// Submit a review task — returns the task ID and API path, does NOT wait for results
export interface ReviewTaskRef {
  taskId: string
  getPath: string
}

export async function submitReviewTask(
  placeId: string,
  depth: number = 700,
  sortBy: 'newest' | 'relevant' = 'newest',
): Promise<ReviewTaskRef> {
  // Try API paths in order until one accepts the task
  const attempts = [
    { path: '/reviews/google/task_post', getPath: '/reviews/google/task_get/', body: { keyword: 'place_id:' + placeId, location_code: 2840, language_code: 'en', depth: Math.min(depth, 4490), sort_by: sortBy } },
    { path: '/business_data/google/reviews/task_post', getPath: '/business_data/google/reviews/task_get/', body: { place_id: placeId, depth: Math.min(depth, 4490), sort_by: sortBy, language_code: 'en' } },
  ]

  let lastError = ''
  for (const attempt of attempts) {
    try {
      const postData = await post(attempt.path, [attempt.body])
      const taskStatus = postData?.tasks?.[0]
      if (taskStatus?.id) {
        return { taskId: taskStatus.id, getPath: attempt.getPath }
      }
      lastError = `${attempt.path}: ${taskStatus?.status_message || 'no task ID'}`
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      lastError = `${attempt.path}: ${message.slice(0, 150)}`
    }
  }
  throw new Error(`Failed to submit review task: ${lastError}`)
}

// Check if a previously submitted task has results ready
export type TaskCheckResult =
  | { status: 'ready'; reviews: DfsReview[] }
  | { status: 'pending' }
  | { status: 'error'; message: string }

export async function checkReviewTask(ref: ReviewTaskRef): Promise<TaskCheckResult> {
  const result = await get(ref.getPath + ref.taskId)
  const task = result?.tasks?.[0]
  if (!task) return { status: 'pending' }

  // The task's getPath is a reliable platform discriminator, so old pending
  // task refs (which carry no explicit source) still route correctly.
  const parseItem = ref.getPath.includes('tripadvisor') ? parseTripadvisorReviewItem : parseReviewItem

  if (task.status_code === 20000 && task.result?.length) {
    const resultData = task.result[0]
    const items = (resultData?.items || []) as DfsReviewItem[]
    console.log('[dataforseo] task ready — items:', items.length, 'sample keys:', items[0] ? Object.keys(items[0]).join(',') : 'none', 'reviews_count:', resultData?.reviews_count)
    if (items.length === 0 && resultData?.reviews_count > 0) {
      // Items empty but reviews exist — might be nested differently
      console.warn('[dataforseo] reviews_count > 0 but items is empty. Full result keys:', Object.keys(resultData).join(','))
    }
    const reviews = items.map(parseItem).filter((r: DfsReview | null) => r !== null) as DfsReview[]
    if (items.length > 0 && reviews.length === 0) {
      console.warn('[dataforseo] parseReviewItem filtered all items. Sample item:', JSON.stringify(items[0]).slice(0, 300))
    }
    return { status: 'ready', reviews }
  }
  // 40402/40602 = task in queue/processing, 140607 = "Task Handed" (assigned to worker, still processing)
  if (task.status_code === 40402 || task.status_code === 40602 || task.status_code === 140607) {
    return { status: 'pending' }
  }
  if (task.status_code >= 40000) {
    return { status: 'error', message: `(${task.status_code}): ${task.status_message}` }
  }
  return { status: 'pending' }
}

// Legacy wrapper — submits and polls (only use for small one-off calls, NOT in serverless)
export async function fetchReviews(
  placeId: string,
  depth: number = 700,
  sortBy: 'newest' | 'relevant' = 'newest',
): Promise<DfsReview[]> {
  const ref = await submitReviewTask(placeId, depth, sortBy)
  for (let i = 0; i < 15; i++) {
    await sleep(3000)
    const result = await checkReviewTask(ref)
    if (result.status === 'ready') return result.reviews
    if (result.status === 'error') throw new Error(result.message)
  }
  throw new Error('Review task timed out')
}

// Batch version: submit multiple place_ids at once, poll all
export async function fetchReviewsBatch(
  placeIds: string[],
  depth: number = 700,
  sortBy: 'newest' | 'relevant' = 'newest',
): Promise<Map<string, DfsReview[]>> {
  // Submit up to 100 tasks per POST
  const results = new Map<string, DfsReview[]>()
  const chunks = chunkArray(placeIds, 100)

  for (const chunk of chunks) {
    const tasks = chunk.map(pid => ({
      place_id: pid,
      depth: Math.min(depth, 4490),
      sort_by: sortBy,
      language_code: 'en',
      tag: pid,   // use place_id as tag for matching results back
    }))

    const postData = await post('/business_data/google/reviews/task_post', tasks)
    const taskIds = (postData?.tasks || [])
      .filter((t): t is DfsTask & { id: string } => Boolean(t.id))
      .map((t) => ({ id: t.id, tag: t.data?.tag || '' }))

    // Poll all tasks
    const pending = new Set<string>(taskIds.map((t) => t.id))
    const tagMap = new Map<string, string>(taskIds.map((t): [string, string] => [t.id, t.tag]))
    const maxAttempts = 40
    const pollInterval = 5000

    for (let attempt = 0; attempt < maxAttempts && pending.size > 0; attempt++) {
      await sleep(pollInterval)
      for (const taskId of Array.from(pending)) {
        try {
          const result = await get(`/business_data/google/reviews/task_get/${taskId}`)
          const task = result?.tasks?.[0]
          if (!task) continue

          if (task.status_code === 20000 && task.result?.length) {
            const items = (task.result[0]?.items || []) as DfsReviewItem[]
            const placeId: string = tagMap.get(taskId) || ''
            const reviews: DfsReview[] = items.map(parseReviewItem).filter(Boolean) as DfsReview[]
            results.set(placeId, reviews)
            pending.delete(taskId)
          } else if (task.status_code !== 40402) {
            // Non-retryable error
            console.error(`Review task ${taskId} failed: ${task.status_message}`)
            pending.delete(taskId)
          }
        } catch (err) {
          console.error(`Error polling task ${taskId}:`, err)
        }
      }
    }

    if (pending.size > 0) {
      console.warn(`${pending.size} review tasks timed out`)
    }
  }

  return results
}

function parseReviewItem(item: DfsReviewItem): DfsReview | null {
  if (!item) return null
  // Generate a stable ID from profile + timestamp if no review_id field
  const reviewId = item.review_id || item.id || (item.profile_name + ':' + item.timestamp) || String(item.rank_absolute)
  return {
    review_id: String(reviewId),
    profile_name: item.profile_name || item.author_name || 'Anonymous',
    rating: typeof item.rating === 'number' ? item.rating : (item.rating?.value ?? 0),
    review_text: item.review_text || null,
    timestamp: item.timestamp || '',
    owner_answer: item.owner_answer || null,
    owner_timestamp: item.owner_timestamp || null,
    review_url: item.review_url || item.profile_url || null,
    review_likes: item.reviews_count || 0,
  }
}

// ---------------------------------------------------------------------------
// Tripadvisor — business search + reviews
//
// Tripadvisor search and reviews are both task-based (no live endpoint). A
// business is identified by its url_path (e.g. the path of its Tripadvisor
// page), which we store in the same place_id column Google uses.
// ---------------------------------------------------------------------------

/** Search Tripadvisor for a brand/category. Submits a task and polls within
 *  the calling route's time budget (search has no live endpoint). */
export async function searchTripadvisorLocations(keyword: string): Promise<DfsLocation[]> {
  const postData = await post('/business_data/tripadvisor/search/task_post', [{
    keyword,
    location_name: 'United States',
    depth: 210,                // Tripadvisor search max
  }])
  const taskId = postData?.tasks?.[0]?.id
  if (!taskId) {
    throw new Error(`Tripadvisor search failed: ${postData?.tasks?.[0]?.status_message || 'no task ID'}`)
  }

  // Poll task_get — ~25s worst case, inside the route's 30s maxDuration.
  for (let i = 0; i < 10; i++) {
    await sleep(2500)
    const result = await get('/business_data/tripadvisor/search/task_get/' + taskId)
    const task = result?.tasks?.[0]
    if (!task) continue
    if (task.status_code === 20000 && task.result?.length) {
      const items = (task.result[0]?.items || []) as DfsBusinessItem[]
      return items
        .filter((it) => it?.url_path)
        .map(parseTripadvisorBusinessItem)
        .filter((l: DfsLocation | null) => l !== null)
    }
    // 40402/40602 = queued, 140607 = handed to a worker — keep polling.
    if (task.status_code === 40402 || task.status_code === 40602 || task.status_code === 140607) continue
    if (task.status_code >= 40000) {
      throw new Error(`Tripadvisor search failed (${task.status_code}): ${task.status_message}`)
    }
  }
  throw new Error('Tripadvisor search timed out — please try again')
}

function parseTripadvisorBusinessItem(item: DfsBusinessItem): DfsLocation | null {
  if (!item?.url_path) return null
  // Search titles arrive rank-prefixed: "1. Salami Social Club" — strip it.
  // Tripadvisor search does not return structured address fields.
  const name = String(item.title || '').replace(/^\d+\.\s*/, '')
  return {
    place_id: item.url_path,
    name,
    address: null,
    city: null,
    state: null,
    zip: null,
    rating: item.rating?.value ?? null,
    review_count: item.reviews_count ?? 0,
    phone: null,
    latitude: null,
    longitude: null,
  }
}

/** Submit a Tripadvisor reviews task. Mirrors submitReviewTask's signature so
 *  callers can dispatch on source without translating arguments. */
export async function submitTripadvisorReviewTask(
  urlPath: string,
  depth: number = 700,
  sortBy: 'newest' | 'relevant' = 'newest',
): Promise<ReviewTaskRef> {
  const tripSort = sortBy === 'newest' ? 'most_recent' : 'detailed_reviews'
  const postData = await post('/business_data/tripadvisor/reviews/task_post', [{
    url_path: urlPath,
    depth: Math.min(depth, 4490),
    sort_by: tripSort,
    language_code: 'en',
  }])
  const taskStatus = postData?.tasks?.[0]
  if (taskStatus?.id) {
    return { taskId: taskStatus.id, getPath: '/business_data/tripadvisor/reviews/task_get/' }
  }
  throw new Error(`Failed to submit Tripadvisor review task: ${taskStatus?.status_message || 'no task ID'}`)
}

// Tripadvisor returns timestamps as "2025-06-08 00:00:00 +00:00"; downstream
// code expects an ISO string it can .split('T')[0] and compare lexically.
function normalizeTimestamp(ts: string | null | undefined): string {
  if (!ts) return ''
  const t = ts.trim()
  if (!t || t.includes('T')) return t
  return t.replace(' ', 'T').replace(/\s+/g, '')
}

function parseTripadvisorReviewItem(item: DfsReviewItem): DfsReview | null {
  if (!item) return null
  const reviewId = item.review_id || item.id || (item.rank_absolute != null ? String(item.rank_absolute) : '')
  if (!reviewId) return null
  const response = Array.isArray(item.responses) ? item.responses[0] : null
  return {
    review_id: String(reviewId),
    profile_name: item.user_profile?.name || 'Anonymous',
    rating: typeof item.rating === 'number' ? item.rating : (item.rating?.value ?? 0),
    review_text: item.review_text || null,
    timestamp: normalizeTimestamp(item.timestamp),
    owner_answer: response?.text || null,
    owner_timestamp: response ? (normalizeTimestamp(response.timestamp) || null) : null,
    review_url: item.url || null,
    review_likes: 0,
  }
}

// ---------------------------------------------------------------------------
// Keyword search volume (Google Ads data)
// ---------------------------------------------------------------------------

import type { SearchInterestTier, SearchTrend } from './themeUtils'

export interface SearchVolumeResult {
  keyword: string
  searchVolume: number
  trend: SearchTrend
}

export function classifySearchInterest(volume: number): SearchInterestTier {
  if (volume >= 1_000_000) return 'high'
  if (volume >= 100_000) return 'moderate'
  if (volume >= 5_000) return 'low'
  return null
}

/** Compare recent 3 months vs prior 3 months to determine trend direction. */
function classifyTrend(monthly: { year: number; month: number; search_volume: number }[] | undefined): SearchTrend {
  if (!monthly || monthly.length < 6) return null
  // monthly is newest-first from DataForSEO
  const recent = monthly.slice(0, 3).reduce((s, m) => s + (m.search_volume || 0), 0)
  const prior = monthly.slice(3, 6).reduce((s, m) => s + (m.search_volume || 0), 0)
  if (prior === 0) return recent > 0 ? 'up' : null
  const change = (recent - prior) / prior
  if (change >= 0.2) return 'up'
  if (change <= -0.2) return 'down'
  return 'steady'
}

/** Fetch monthly search volumes for up to 1000 keywords (US, English). */
export async function getSearchVolumes(keywords: string[]): Promise<SearchVolumeResult[]> {
  if (!keywords.length) return []
  const data = await post('/keywords_data/google_ads/search_volume/live', [{
    keywords: keywords.slice(0, 1000),
    location_code: 2840,
    language_code: 'en',
  }])
  const items = data?.tasks?.[0]?.result || []
  return items.map((item) => ({
    keyword: String(item.keyword || ''),
    searchVolume: item.search_volume ?? 0,
    trend: classifyTrend(item.monthly_searches),
  }))
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Google Organic SERP — search the web for a person/org/topic
// ---------------------------------------------------------------------------

export interface SerpResult {
  url: string
  title: string
  description: string
}

/** Search Google for a query and return top organic results (URLs + snippets). */
export async function searchGoogle(query: string, depth: number = 10): Promise<SerpResult[]> {
  const data = await post('/serp/google/organic/live/advanced', [{
    keyword: query,
    location_code: 2840, // US
    language_code: 'en',
    device: 'desktop',
    depth,
  }])

  const items = (data?.tasks?.[0]?.result?.[0]?.items || []) as DfsSerpItem[]
  const results: SerpResult[] = []
  for (const item of items) {
    if (item.type === 'organic' && item.url) {
      results.push({
        url: item.url,
        title: item.title || '',
        description: item.description || '',
      })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}
