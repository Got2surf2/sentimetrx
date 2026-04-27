// lib/regulations.ts
// Regulations.gov API v4 client
// Docs: https://open.gsa.gov/api/regulationsgov/

const BASE = 'https://api.regulations.gov/v4'
const RATE_DELAY = 3600 // ~1000 requests/hour = 1 per 3.6s, round up for safety

let lastRequest = 0

async function throttle(): Promise<void> {
  const now = Date.now()
  const wait = RATE_DELAY - (now - lastRequest)
  if (wait > 0) await new Promise(function(r) { setTimeout(r, wait) })
  lastRequest = Date.now()
}

function getApiKey(): string {
  const key = process.env.REGULATIONS_GOV_API_KEY
  if (!key) throw new Error('REGULATIONS_GOV_API_KEY not configured')
  return key
}

async function regGet(path: string, params?: Record<string, string>): Promise<any> {
  await throttle()
  const url = new URL(BASE + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v)
    }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: { 'X-Api-Key': getApiKey() },
      signal: controller.signal,
    })
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('Regulations.gov API timed out (15s)')
    throw new Error('Regulations.gov API network error: ' + (err.message || 'fetch failed'))
  }
  clearTimeout(timeout)
  if (res.status === 429) {
    // Rate limited — wait 60s and retry once
    await new Promise(function(r) { setTimeout(r, 60000) })
    const retry = await fetch(url.toString(), {
      headers: { 'X-Api-Key': getApiKey() },
    })
    if (!retry.ok) {
      const body = await retry.text().catch(() => '')
      throw new Error(`Regulations.gov API ${retry.status}: ${body || path}`)
    }
    return retry.json()
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Regulations.gov API ${res.status}: ${body || path}`)
  }
  return res.json()
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface RegDocket {
  id: string
  type: string
  attributes: {
    agencyId: string
    docketType: string
    highlightedContent: string
    lastModifiedDate: string
    objectId: string
    title: string
  }
}

export interface RegDocument {
  id: string
  type: string
  attributes: {
    agencyId: string
    commentEndDate: string | null
    commentStartDate: string | null
    docketId: string
    documentType: string
    highlightedContent: string
    lastModifiedDate: string
    objectId: string
    postedDate: string
    title: string
    withdrawn: boolean
    commentCount?: number
  }
}

export interface RegCommentListItem {
  id: string
  attributes: {
    agencyId: string
    commentOnDocumentId: string
    docketId: string
    documentType: string
    highlightedContent: string
    lastModifiedDate: string
    objectId: string
    postedDate: string
    title: string
    withdrawn: boolean
  }
}

export interface RegCommentDetail {
  id: string
  attributes: {
    agencyId: string
    comment: string  // full text
    commentOnDocumentId: string
    docketId: string
    documentType: string
    firstName: string | null
    lastName: string | null
    organization: string | null
    city: string | null
    country: string | null
    stateProvinceRegion: string | null
    zip: string | null
    postedDate: string
    title: string
    trackingNbr: string
    withdrawn: boolean
  }
}

// ── Search dockets ─────────────────────────────────────────────────────────

export async function searchDockets(query: string, page: number = 1): Promise<{ data: RegDocket[]; totalElements: number }> {
  // If query looks like a docket or document ID (e.g. USDA-2024-0003 or USDA-2024-0003-0262),
  // try direct docket lookup first, stripping any trailing document suffix
  var trimmed = query.trim()
  if (page === 1 && /^[A-Z]+-\d{4}-[A-Z0-9]+-?\d*$/i.test(trimmed)) {
    // Try the full ID first, then without trailing segment (document ID → docket ID)
    var candidates = [trimmed]
    var parts = trimmed.split('-')
    if (parts.length > 3) candidates.push(parts.slice(0, 3).join('-'))

    for (var cand of candidates) {
      try {
        var direct = await regGet('/dockets/' + encodeURIComponent(cand))
        if (direct?.data) return { data: [direct.data], totalElements: 1 }
      } catch {}
    }
  }

  const result = await regGet('/dockets', {
    'filter[searchTerm]': query,
    'page[size]': '25',
    'page[number]': String(page),
    'sort': '-lastModifiedDate',
  })
  return {
    data: result.data || [],
    totalElements: result.meta?.totalElements || 0,
  }
}

// ── Search documents (rules, notices, proposed rules) ──────────────────────

export async function searchDocuments(query: string, docketId?: string, page: number = 1): Promise<{ data: RegDocument[]; totalElements: number }> {
  const params: Record<string, string> = {
    'page[size]': '25',
    'page[number]': String(page),
    'sort': '-postedDate',
  }
  if (docketId) params['filter[docketId]'] = docketId
  if (query) params['filter[searchTerm]'] = query
  const result = await regGet('/documents', params)
  return {
    data: result.data || [],
    totalElements: result.meta?.totalElements || 0,
  }
}

// ── List comments (IDs only — full text requires detail call) ──────────────

export async function listComments(docketId: string, page: number = 1, pageSize: number = 250, useSearch?: boolean): Promise<{ data: RegCommentListItem[]; totalElements: number; lastPage: number; usedSearch?: boolean }> {
  // Some dockets don't return results with filter[docketId] but do with searchTerm
  // Regulations.gov API bug: page[size]=1 returns 0 results, so use minimum of 5
  var params: Record<string, string> = {
    'page[size]': String(Math.min(Math.max(pageSize, 5), 250)),
    'page[number]': String(page),
    'sort': '-postedDate',
  }
  if (useSearch) {
    params['filter[searchTerm]'] = docketId
  } else {
    params['filter[docketId]'] = docketId
  }
  const result = await regGet('/comments', params)
  var total = result.meta?.totalElements || 0

  // If filter[docketId] returned 0 and we haven't tried search yet, try searchTerm fallback
  if (!useSearch && total === 0 && page === 1) {
    var searchResult = await listComments(docketId, page, pageSize, true)
    if (searchResult.totalElements > 0) return { ...searchResult, usedSearch: true }
  }

  return {
    data: result.data || [],
    totalElements: total,
    lastPage: result.meta?.lastPage || 1,
    ...(useSearch ? { usedSearch: true } : {}),
  }
}

// ── Get single comment detail (includes full text) ─────────────────────────

export async function getCommentDetail(commentId: string): Promise<RegCommentDetail> {
  const result = await regGet('/comments/' + encodeURIComponent(commentId))
  return result.data
}

// ── Batch fetch comment details ────────────────────────────────────────────

export async function fetchCommentsBatch(commentIds: string[]): Promise<RegCommentDetail[]> {
  const results: RegCommentDetail[] = []
  for (const id of commentIds) {
    try {
      const detail = await getCommentDetail(id)
      results.push(detail)
    } catch (err) {
      console.warn('[regulations] failed to fetch comment', id, err)
    }
  }
  return results
}

// ── Convert comment to dataset row ─────────────────────────────────────────

export function commentToRow(c: RegCommentDetail): Record<string, unknown> {
  const a = c.attributes
  const name = [a.firstName, a.lastName].filter(Boolean).join(' ') || 'Anonymous'
  return {
    comment_id: c.id,
    comment_text: a.comment || '',
    commenter_name: name,
    organization: a.organization || '',
    city: a.city || '',
    state: a.stateProvinceRegion || '',
    country: a.country || '',
    posted_date: a.postedDate ? a.postedDate.split('T')[0] : '',
    agency: a.agencyId || '',
    docket_id: a.docketId || '',
    document_id: a.commentOnDocumentId || '',
    title: a.title || '',
    tracking_number: a.trackingNbr || '',
  }
}
