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
  if (!res.ok) throw new Error(`DataForSEO ${path} HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: { 'Authorization': authHeader() },
  })
  if (!res.ok) throw new Error(`DataForSEO ${path} HTTP ${res.status}: ${await res.text()}`)
  return res.json()
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
  // Use the live endpoint for instant results in the UI
  const data = await post('/business_data/google/my_business_info/live', [{
    keyword,
    location_code: 2840,       // United States
    language_code: 'en',
  }])

  const tasks = data?.tasks
  if (!tasks?.length || tasks[0].status_code !== 20000) {
    throw new Error(`Search failed: ${tasks?.[0]?.status_message || 'Unknown error'}`)
  }

  const items = tasks[0].result?.[0]?.items || []
  return items.map(parseBusinessItem).filter((l: DfsLocation | null) => l !== null)
}

function parseBusinessItem(item: any): DfsLocation | null {
  if (!item?.place_id) return null
  const ai = item.address_info || {}
  return {
    place_id: item.place_id,
    name: item.title || item.original_title || '',
    address: item.address || null,
    city: ai.city || null,
    state: ai.region || null,
    zip: ai.zip || null,
    rating: item.rating?.value ?? null,
    review_count: item.rating?.votes_count ?? 0,
    phone: item.phone || null,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
  }
}

// ---------------------------------------------------------------------------
// Fetch reviews — standard async queue (cheaper, used for bulk pulls)
// ---------------------------------------------------------------------------

export async function fetchReviews(
  placeId: string,
  depth: number = 700,
  sortBy: 'newest' | 'relevant' = 'newest',
): Promise<DfsReview[]> {
  // 1. Post the task
  const postData = await post('/business_data/google/reviews/task_post', [{
    place_id: placeId,
    depth: Math.min(depth, 4490),
    sort_by: sortBy,
    language_code: 'en',
  }])

  const taskId = postData?.tasks?.[0]?.id
  if (!taskId) throw new Error(`Review task creation failed: ${JSON.stringify(postData?.tasks?.[0])}`)

  // 2. Poll for results (standard queue can take up to 2 minutes)
  const maxAttempts = 30
  const pollInterval = 5000 // 5s
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(pollInterval)
    const result = await get(`/business_data/google/reviews/task_get/${taskId}`)
    const task = result?.tasks?.[0]
    if (!task) continue

    if (task.status_code === 20000 && task.result?.length) {
      const items = task.result[0]?.items || []
      return items.map(parseReviewItem).filter((r: DfsReview | null) => r !== null)
    }
    // 40402 = task not ready yet — keep polling
    if (task.status_code === 40402) continue
    // Any other error
    if (task.status_code >= 40000) {
      throw new Error(`Review task failed (${task.status_code}): ${task.status_message}`)
    }
  }
  throw new Error(`Review task ${taskId} timed out after ${maxAttempts * pollInterval / 1000}s`)
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
  if (!item?.review_id) return null
  return {
    review_id: item.review_id,
    profile_name: item.profile_name || 'Anonymous',
    rating: item.rating?.value ?? 0,
    review_text: item.review_text || null,
    timestamp: item.timestamp || '',
    owner_answer: item.owner_answer || null,
    owner_timestamp: item.owner_timestamp || null,
    review_url: item.review_url || null,
    review_likes: item.rating?.votes_count ?? 0,
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
