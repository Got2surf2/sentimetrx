// app/api/bots/deep-crawl/route.ts
// POST — deep-crawl a website: follows internal links, keeps full text per page,
// returns all pages as structured sections ready for RAG chunking.
// No AI summarization — preserves all detail for search-based retrieval.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { safeFetch, SafeFetchError } from '@/lib/safeFetch'

export const dynamic = 'force-dynamic'
export const maxDuration = 120   // 2 min — crawling multiple pages

const MAX_PAGES = 30             // max pages to crawl
const MAX_TEXT_PER_PAGE = 30000  // 30KB per page (full detail, not compressed)
const CRAWL_TIMEOUT = 10000      // 10s per page fetch

// Extract text from HTML, preserving structure as markdown-ish headings
function htmlToText(html: string, url: string): string {
  var text = html
    // Remove script, style, nav blocks
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Convert headings to markdown
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n')
    // Convert list items to bullets
    .replace(/<li[^>]*>/gi, '\n- ')
    // Convert br and p to newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' | ')
    // Remove remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode entities
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    // Collapse whitespace (but keep newlines)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()

  if (text.length > MAX_TEXT_PER_PAGE) {
    text = text.slice(0, MAX_TEXT_PER_PAGE)
  }

  return text
}

// Extract internal links from HTML
function extractLinks(html: string, baseUrl: URL): string[] {
  var links: string[] = []
  var seen = new Set<string>()
  var re = /href=["']([^"'#]+)/gi
  var match: RegExpExecArray | null

  while ((match = re.exec(html)) !== null) {
    var href = match[1]
    try {
      var resolved = new URL(href, baseUrl.origin)
      // Only follow same-host links
      if (resolved.hostname !== baseUrl.hostname) continue
      // Skip non-HTML resources
      if (/\.(pdf|jpg|jpeg|png|gif|svg|css|js|zip|mp4|mp3|doc|xls|pptx?)$/i.test(resolved.pathname)) continue
      // Skip anchors, mailto, tel
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue
      // Normalize: strip query params and trailing slash for dedup
      var normalized = resolved.origin + resolved.pathname.replace(/\/+$/, '')
      if (!seen.has(normalized)) {
        seen.add(normalized)
        links.push(normalized)
      }
    } catch {}
  }
  return links
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  // Support single URL (string) or multiple URLs (array or newline-separated)
  var urls: string[] = []
  if (Array.isArray(body.urls)) {
    urls = body.urls.filter(function(u: any) { return typeof u === 'string' && u.trim() })
  } else if (typeof body.url === 'string') {
    urls = body.url.split('\n').map(function(u: string) { return u.trim() }).filter(Boolean)
  }
  if (urls.length === 0) {
    return NextResponse.json({ error: 'At least one URL is required' }, { status: 400 })
  }

  // Validate all URLs upfront
  var baseUrls: URL[] = []
  for (var u = 0; u < urls.length; u++) {
    try { baseUrls.push(new URL(urls[u])) } catch {
      return NextResponse.json({ error: 'Invalid URL: ' + urls[u] }, { status: 400 })
    }
  }

  // BFS crawl across all provided URLs, sharing the page budget
  var visited = new Set<string>()
  var pages: { url: string; title: string; text: string }[] = []

  for (var b = 0; b < baseUrls.length && pages.length < MAX_PAGES; b++) {
    var baseUrl = baseUrls[b]
    var queue: string[] = [baseUrl.origin + baseUrl.pathname.replace(/\/+$/, '')]

    while (queue.length > 0 && pages.length < MAX_PAGES) {
      var currentUrl = queue.shift()!
      if (visited.has(currentUrl)) continue
      visited.add(currentUrl)

      try {
        // safeFetch handles its own redirects with re-validation per hop,
        // so we can drop the explicit `redirect: 'follow'`. Each crawled
        // URL (initial + every internal link below) gets the same SSRF
        // gate so an attacker can't seed a public page that links to
        // 169.254.169.254 to read metadata.
        var res = await safeFetch(currentUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Datanautix Deep Crawler/1.0)',
            'Accept': 'text/html,application/xhtml+xml,text/plain',
          },
          signal: AbortSignal.timeout(CRAWL_TIMEOUT),
        })

        if (!res.ok) continue
        var contentType = res.headers.get('content-type') || ''
        if (!contentType.includes('html') && !contentType.includes('text')) continue

        var html = await res.text()

        // Extract title
        var titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
        var title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : currentUrl

        // Extract text
        var text = htmlToText(html, currentUrl)
        if (text.length < 50) continue  // skip empty pages

        pages.push({ url: currentUrl, title, text })

        // Extract and queue internal links
        var links = extractLinks(html, baseUrl)
        for (var i = 0; i < links.length; i++) {
          if (!visited.has(links[i]) && queue.length + pages.length < MAX_PAGES * 2) {
            queue.push(links[i])
          }
        }
      } catch {
        // Skip failed pages, keep crawling
      }
    }
  }

  if (pages.length === 0) {
    return NextResponse.json({ error: 'No content found — this site may require JavaScript to render. Try using Research instead (enter the site name as a search query).' }, { status: 502 })
  }

  // Build structured knowledge base — full text per page, with markdown headings
  var sections = pages.map(function(p) {
    // Use page title as section heading, clean it up
    var heading = p.title
      .replace(/\s*[\|–—]\s*.+$/, '')  // strip "| Site Name" suffixes
      .replace(/\s*-\s*$/, '')
      .trim() || 'Page'
    return '## ' + heading + '\nSource: ' + p.url + '\n\n' + p.text
  })

  var fullText = '# Deep Crawl Knowledge Base\n\n' + sections.join('\n\n---\n\n')

  return NextResponse.json({
    text: fullText,
    pages_crawled: pages.length,
    pages_found: visited.size,
    sites_crawled: baseUrls.length,
    urls: pages.map(function(p) { return p.url }),
  })
}
