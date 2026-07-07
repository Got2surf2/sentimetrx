// lib/substack.ts
// Substack public API client — no auth required for free publications
// Endpoints: /api/v1/archive (posts), /api/v1/post/{id}/comments

const USER_AGENT = 'sentimetrx:substack-reader:v1.0 (datanautix.com)'
const RATE_DELAY = 500 // ms between requests — Substack has no observed rate limits but be polite

let lastRequest = 0

async function throttle(): Promise<void> {
  const now = Date.now()
  const wait = RATE_DELAY - (now - lastRequest)
  if (wait > 0) await new Promise(function(r) { setTimeout(r, wait) })
  lastRequest = Date.now()
}

async function substackGet(url: string): Promise<unknown> {
  await throttle()
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error('Substack API ' + res.status + ': ' + url)
  return res.json()
}

// ── Types ────────────────────────────────────────────────────────────────────

// Shapes of the raw Substack API JSON (only the fields this client reads).
interface RawByline {
  name?: string
  handle?: string
}

interface RawTag {
  name?: string
}

interface RawSubstackPost {
  id: number
  title?: string
  subtitle?: string
  slug?: string
  post_date?: string
  reaction_count?: number
  comment_count?: number
  restacks?: number
  wordcount?: number
  audience?: string
  canonical_url?: string
  cover_image?: string | null
  publishedBylines?: RawByline[]
  postTags?: (RawTag | string)[]
}

interface RawSubstackComment {
  id: number | string
  body?: string
  deleted?: boolean
  name?: string
  handle?: string
  reaction_count?: number
  metadata?: { is_author?: boolean }
  date?: string
  ancestor_path?: string
  children_count?: number
  children?: RawSubstackComment[]
  restacks?: number
  edited_at?: string | null
}

export interface SubstackPost {
  id: number
  title: string
  subtitle: string
  slug: string
  post_date: string
  author_name: string
  author_handle: string
  reaction_count: number
  comment_count: number
  restacks: number
  wordcount: number
  audience: string          // 'everyone' or 'only_paid'
  canonical_url: string
  cover_image: string | null
  tags: string[]
}

export interface SubstackComment {
  comment_id: string
  post_id: number
  post_title: string
  post_date: string
  author: string
  author_handle: string
  body: string
  likes: number
  is_author_reply: boolean
  comment_date: string
  depth: number
  parent_id: string
  children_count: number
  restacks: number
  edited: boolean
}

// ── Resolve publication base URL ─────────────────────────────────────────────

export function resolveBaseUrl(input: string): string {
  var url = input.trim().replace(/\/+$/, '')
  // If user pastes a full URL, extract the base
  if (url.match(/^https?:\/\//)) {
    var parsed = new URL(url)
    return parsed.origin
  }
  // If just a subdomain name like "mattyglesias"
  if (!url.includes('.')) {
    return 'https://' + url + '.substack.com'
  }
  // If domain without protocol
  return 'https://' + url
}

// ── Fetch publication info ───────────────────────────────────────────────────

export interface SubstackPublication {
  name: string
  description: string
  author_name: string
  base_url: string
  logo_url: string | null
}

export async function fetchPublication(baseUrl: string): Promise<SubstackPublication> {
  // Fetch a single post to extract publication metadata
  var data = await substackGet(baseUrl + '/api/v1/archive?sort=new&limit=1')
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('No posts found at this publication')
  }
  var post = data[0]
  var byline = post.publishedBylines?.[0] || {}
  return {
    name: post.publication?.name || byline.name || 'Unknown Publication',
    description: post.publication?.description || '',
    author_name: byline.name || '',
    base_url: baseUrl,
    logo_url: post.publication?.logo_url || null,
  }
}

// ── Fetch posts (paginated) ──────────────────────────────────────────────────

export async function fetchPosts(baseUrl: string, limit: number = 50, offset: number = 0): Promise<SubstackPost[]> {
  var data = await substackGet(baseUrl + '/api/v1/archive?sort=new&limit=' + limit + '&offset=' + offset)
  if (!Array.isArray(data)) return []
  return data.map(function(d: RawSubstackPost): SubstackPost {
    var byline = d.publishedBylines?.[0] || {}
    return {
      id: d.id,
      title: d.title || '',
      subtitle: d.subtitle || '',
      slug: d.slug || '',
      post_date: d.post_date || '',
      author_name: byline.name || '',
      author_handle: byline.handle || '',
      reaction_count: d.reaction_count || 0,
      comment_count: d.comment_count || 0,
      restacks: d.restacks || 0,
      wordcount: d.wordcount || 0,
      audience: d.audience || 'everyone',
      canonical_url: d.canonical_url || '',
      cover_image: d.cover_image || null,
      tags: (d.postTags || []).map(function(t: RawTag | string): string { return ((t as RawTag).name || t) as string }),
    }
  })
}

// ── Fetch all comments for a post ────────────────────────────────────────────

export async function fetchPostComments(baseUrl: string, postId: number, postTitle: string, postDate: string): Promise<SubstackComment[]> {
  var data = await substackGet(baseUrl + '/api/v1/post/' + postId + '/comments?all_comments=true&sort=best_first')
  var comments: SubstackComment[] = []
  flattenComments((data as { comments?: RawSubstackComment[] })?.comments || (data as RawSubstackComment[]) || [], postId, postTitle, postDate, comments, 0)
  return comments
}

function flattenComments(
  children: RawSubstackComment[],
  postId: number,
  postTitle: string,
  postDate: string,
  out: SubstackComment[],
  depth: number,
): void {
  if (!Array.isArray(children)) return
  for (var child of children) {
    var body = child.body || ''
    if (!body.trim() || child.deleted) continue

    out.push({
      comment_id: String(child.id),
      post_id: postId,
      post_title: postTitle,
      post_date: postDate,
      author: child.name || '',
      author_handle: child.handle || '',
      body: body,
      likes: child.reaction_count || 0,
      is_author_reply: !!(child.metadata?.is_author),
      comment_date: child.date || '',
      depth: depth,
      parent_id: child.ancestor_path ? String(child.ancestor_path.split('/').pop()) : '',
      children_count: child.children_count || (child.children?.length) || 0,
      restacks: child.restacks || 0,
      edited: !!child.edited_at,
    })

    if (child.children && child.children.length > 0) {
      flattenComments(child.children, postId, postTitle, postDate, out, depth + 1)
    }
  }
}

// ── Convert a SubstackComment to a flat dataset row ─────────────────────────

export function commentToRow(c: SubstackComment): Record<string, unknown> {
  var dateStr = c.comment_date
    ? new Date(c.comment_date).toISOString().split('T')[0]
    : ''
  return {
    comment_id: c.comment_id,
    author: c.author,
    author_handle: c.author_handle,
    body: c.body,
    likes: c.likes,
    is_author_reply: c.is_author_reply,
    post_title: c.post_title,
    post_date: c.post_date ? new Date(c.post_date).toISOString().split('T')[0] : '',
    comment_date: dateStr,
    depth: c.depth,
    parent_id: c.parent_id,
    children_count: c.children_count,
    restacks: c.restacks,
  }
}
