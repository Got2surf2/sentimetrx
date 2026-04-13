// lib/dataforseo.ts
// DataForSEO API client for Google Maps business search and Google Reviews

const BASE = 'https://api.dataforseo.com/v3'

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) throw new Error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD env vars required')
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64')
}

async function post(path: string, body: unknown[]): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Authorization': authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`DataForSEO ${path} HTTP ${res.status}: ${text.slice(0, 200)}`)
  try { return JSON.parse(text) } catch {
    throw new Error(`DataForSEO ${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
}

async function get(path: string): Promise<any> {
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

  const items = tasks[0].result?.[0]?.items || []
  return items
    .filter((item: any) => item?.type === 'maps_search')
    .map(parseBusinessItem)
    .filter((l: DfsLocation | null) => l !== null)
}

function parseBusinessItem(item: any): DfsLocation | null {
  if (!item?.place_id) return null
  // Use structured address_info if available, fall back to parsing address string
  const ai = item.address_info || {}
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
    } catch (err: any) {
      lastError = `${attempt.path}: ${err.message?.slice(0, 150)}`
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

  if (task.status_code === 20000 && task.result?.length) {
    const resultData = task.result[0]
    const items = resultData?.items || []
    console.log('[dataforseo] task ready — items:', items.length, 'sample keys:', items[0] ? Object.keys(items[0]).join(',') : 'none', 'reviews_count:', resultData?.reviews_count)
    if (items.length === 0 && resultData?.reviews_count > 0) {
      // Items empty but reviews exist — might be nested differently
      console.warn('[dataforseo] reviews_count > 0 but items is empty. Full result keys:', Object.keys(resultData).join(','))
    }
    const reviews = items.map(parseReviewItem).filter((r: DfsReview | null) => r !== null) as DfsReview[]
    if (items.length > 0 && reviews.length === 0) {
      console.warn('[dataforseo] parseReviewItem filtered all items. Sample item:', JSON.stringify(items[0]).slice(0, 300))
    }
    return { status: 'ready', reviews }
  }
  if (task.status_code === 40402 || task.status_code === 40602) {
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
      .filter((t: any) => t.id)
      .map((t: any) => ({ id: t.id, tag: t.data?.tag || '' }))

    // Poll all tasks
    const pending = new Set<string>(taskIds.map((t: any) => t.id))
    const tagMap = new Map<string, string>(taskIds.map((t: any) => [t.id, t.tag]))
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
            const items: any[] = task.result[0]?.items || []
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

function parseReviewItem(item: any): DfsReview | null {
  if (!item || !item.review_text) return null
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
