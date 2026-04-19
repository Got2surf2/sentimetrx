// lib/reddit.ts
// Reddit public JSON API client — no auth required for public subreddits/posts
// Uses .json endpoint appended to Reddit URLs

const USER_AGENT = 'sentimetrx:reddit-downloader:v1.0 (by /u/sentimetrx)'
const BASE = 'https://www.reddit.com'
const RATE_DELAY = 1200 // ms between requests to respect rate limits

let lastRequest = 0

async function throttle(): Promise<void> {
  const now = Date.now()
  const wait = RATE_DELAY - (now - lastRequest)
  if (wait > 0) await new Promise(function(r) { setTimeout(r, wait) })
  lastRequest = Date.now()
}

async function redditGet(path: string): Promise<any> {
  await throttle()
  const url = `${BASE}${path}`
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  })
  if (res.status === 429) {
    // Rate limited — wait and retry once
    await new Promise(function(r) { setTimeout(r, 3000) })
    const retry = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!retry.ok) throw new Error(`Reddit API ${retry.status}: ${path}`)
    return retry.json()
  }
  if (!res.ok) throw new Error(`Reddit API ${res.status}: ${path}`)
  return res.json()
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface RedditThread {
  thread_id: string
  subreddit: string
  title: string
  author: string
  selftext: string
  score: number
  ups: number
  downs: number
  upvote_ratio: number
  comment_count: number
  permalink: string
  created_utc: number
  url: string
  gilded: number
  total_awards: number
}

export interface RedditComment {
  comment_id: string
  thread_id: string
  subreddit: string
  thread_title: string
  author: string
  body: string
  score: number
  ups: number
  downs: number
  controversiality: number
  is_submitter: boolean
  gilded: number
  total_awards: number
  permalink: string
  created_utc: number
  depth: number
  parent_id: string
}

// ── Search subreddits ────────────────────────────────────────────────────────

export interface SubredditResult {
  name: string
  title: string
  description: string
  subscribers: number
  icon_url: string | null
}

export async function searchSubreddits(query: string): Promise<SubredditResult[]> {
  const data = await redditGet(`/subreddits/search.json?q=${encodeURIComponent(query)}&limit=25&sort=relevance`)
  const children = data?.data?.children || []
  return children.map(function(c: any) {
    const d = c.data
    return {
      name: d.display_name,
      title: d.title || d.display_name,
      description: (d.public_description || '').slice(0, 200),
      subscribers: d.subscribers || 0,
      icon_url: d.icon_img || d.community_icon?.split('?')[0] || null,
    }
  })
}

// ── Search posts within subreddits ───────────────────────────────────────────

export async function searchPosts(query: string, subreddit?: string, sort: string = 'relevance', limit: number = 50): Promise<RedditThread[]> {
  const sub = subreddit ? `/r/${subreddit}` : ''
  const data = await redditGet(`${sub}/search.json?q=${encodeURIComponent(query)}&sort=${sort}&limit=${Math.min(limit, 100)}&restrict_sr=${subreddit ? 'true' : 'false'}&type=link`)
  const children = data?.data?.children || []
  return children.map(function(c: any): RedditThread {
    const d = c.data
    return {
      thread_id: d.id,
      subreddit: d.subreddit,
      title: d.title,
      author: d.author || '[deleted]',
      selftext: d.selftext || '',
      score: d.score || 0,
      ups: d.ups || 0,
      downs: d.downs || 0,
      upvote_ratio: d.upvote_ratio || 0,
      comment_count: d.num_comments || 0,
      permalink: d.permalink,
      created_utc: d.created_utc,
      url: d.url,
      gilded: d.gilded || 0,
      total_awards: d.total_awards_received || 0,
    }
  })
}

// ── Fetch all comments for a thread ──────────────────────────────────────────

export async function fetchThreadComments(permalink: string, limit: number = 500): Promise<{ post: RedditThread; comments: RedditComment[] }> {
  // Reddit returns [post_listing, comment_listing]
  const data = await redditGet(`${permalink}.json?limit=${Math.min(limit, 500)}&depth=10&sort=top`)

  if (!Array.isArray(data) || data.length < 2) {
    throw new Error('Unexpected Reddit thread response format')
  }

  const postData = data[0]?.data?.children?.[0]?.data
  if (!postData) throw new Error('Could not parse thread post')

  const post: RedditThread = {
    thread_id: postData.id,
    subreddit: postData.subreddit,
    title: postData.title,
    author: postData.author || '[deleted]',
    selftext: postData.selftext || '',
    score: postData.score || 0,
    ups: postData.ups || 0,
    downs: postData.downs || 0,
    upvote_ratio: postData.upvote_ratio || 0,
    comment_count: postData.num_comments || 0,
    permalink: postData.permalink,
    created_utc: postData.created_utc,
    url: postData.url,
    gilded: postData.gilded || 0,
    total_awards: postData.total_awards_received || 0,
  }

  const comments: RedditComment[] = []
  flattenComments(data[1]?.data?.children || [], post.thread_id, post.subreddit, post.title, comments)

  return { post, comments }
}

function flattenComments(
  children: any[],
  threadId: string,
  subreddit: string,
  threadTitle: string,
  out: RedditComment[],
  depth: number = 0,
): void {
  for (const child of children) {
    if (child.kind !== 't1') continue // skip "more" stubs
    const d = child.data
    if (!d.body || d.body === '[deleted]' || d.body === '[removed]') continue

    out.push({
      comment_id: d.id,
      thread_id: threadId,
      subreddit: subreddit,
      thread_title: threadTitle,
      author: d.author || '[deleted]',
      body: d.body,
      score: d.score || 0,
      ups: d.ups || 0,
      downs: d.downs || 0,
      controversiality: d.controversiality || 0,
      is_submitter: !!d.is_submitter,
      gilded: d.gilded || 0,
      total_awards: d.total_awards_received || 0,
      permalink: d.permalink || '',
      created_utc: d.created_utc,
      depth: depth,
      parent_id: d.parent_id || '',
    })

    // Recurse into replies
    if (d.replies?.data?.children) {
      flattenComments(d.replies.data.children, threadId, subreddit, threadTitle, out, depth + 1)
    }
  }
}

// ── Convert a RedditComment to a flat dataset row ───────────────────────────

export function commentToRow(c: RedditComment): Record<string, unknown> {
  const dateStr = c.created_utc
    ? new Date(c.created_utc * 1000).toISOString().split('T')[0]
    : ''
  return {
    comment_id: c.comment_id,
    author: c.author,
    body: c.body,
    score: c.score,
    ups: c.ups,
    downs: c.downs,
    controversiality: c.controversiality,
    is_submitter: c.is_submitter,
    gilded: c.gilded,
    total_awards: c.total_awards,
    post_date: dateStr,
    subreddit: c.subreddit,
    thread_title: c.thread_title,
    thread_id: c.thread_id,
    depth: c.depth,
    permalink: c.permalink ? 'https://www.reddit.com' + c.permalink : '',
  }
}

// ── Fetch top/hot posts from a subreddit ─────────────────────────────────────

export async function fetchSubredditPosts(subreddit: string, sort: string = 'hot', limit: number = 50): Promise<RedditThread[]> {
  const data = await redditGet(`/r/${subreddit}/${sort}.json?limit=${Math.min(limit, 100)}`)
  const children = data?.data?.children || []
  return children.map(function(c: any): RedditThread {
    const d = c.data
    return {
      thread_id: d.id,
      subreddit: d.subreddit,
      title: d.title,
      author: d.author || '[deleted]',
      selftext: d.selftext || '',
      score: d.score || 0,
      ups: d.ups || 0,
      downs: d.downs || 0,
      upvote_ratio: d.upvote_ratio || 0,
      comment_count: d.num_comments || 0,
      permalink: d.permalink,
      created_utc: d.created_utc,
      url: d.url,
      gilded: d.gilded || 0,
      total_awards: d.total_awards_received || 0,
    }
  })
}
