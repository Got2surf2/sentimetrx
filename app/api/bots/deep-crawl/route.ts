// app/api/bots/deep-crawl/route.ts
// POST — deep-crawl a website: follows internal links, keeps full text per page,
// returns all pages as structured sections ready for RAG chunking.
// No AI summarization — preserves all detail for search-based retrieval.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { safeFetch } from '@/lib/safeFetch'
import { htmlToText, extractLinks, parseSitemapUrls, stripBoilerplate } from '@/lib/crawlText'
import { buildLinksDirectory, LINK_INTEGRITY_GUARDRAIL, type OfficialLink } from '@/lib/agentLinks'

export const dynamic = 'force-dynamic'
export const maxDuration = 120   // 2 min — crawling multiple pages

const MAX_PAGES = 30             // max pages to crawl
const CRAWL_TIMEOUT = 10000      // 10s per page fetch
const MAX_CHILD_SITEMAPS = 3     // D4(b): cap sitemap-index fan-out

// D4(b): seed the crawl queue from sitemap.xml (falls back to BFS when absent).
// A sitemap gives the site's OWN list of real pages, so we don't depend on the
// homepage happening to link to everything.
async function sitemapSeeds(baseUrl: URL): Promise<string[]> {
  const fetchXml = async (u: string): Promise<string | null> => {
    try {
      const res = await safeFetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Datanautix Deep Crawler/1.0)', 'Accept': 'application/xml,text/xml' },
        signal: AbortSignal.timeout(CRAWL_TIMEOUT),
      })
      if (!res.ok) return null
      return await res.text()
    } catch { return null }
  }
  const rootXml = await fetchXml(baseUrl.origin + '/sitemap.xml')
  if (!rootXml) return []
  const { pages, childSitemaps } = parseSitemapUrls(rootXml, baseUrl.hostname)
  if (pages.length > 0) return pages
  // sitemap index → fetch a bounded number of child sitemaps
  const collected: string[] = []
  for (const child of childSitemaps.slice(0, MAX_CHILD_SITEMAPS)) {
    const childXml = await fetchXml(child)
    if (childXml) collected.push(...parseSitemapUrls(childXml, baseUrl.hostname).pages)
    if (collected.length >= MAX_PAGES * 2) break
  }
  return collected
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  // Support single URL (string) or multiple URLs (array or newline-separated)
  var urls: string[] = []
  if (Array.isArray(body.urls)) {
    urls = body.urls.filter(function(u: unknown) { return typeof u === 'string' && u.trim() })
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
    // D4(b): sitemap-seeded queue (the entry URL first, then the site's own
    // page list), falling back to pure BFS when there is no sitemap.
    var seeds = await sitemapSeeds(baseUrl)
    var queue: string[] = [baseUrl.origin + baseUrl.pathname.replace(/\/+$/, ''), ...seeds]

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

  // D4(c): strip repeated nav/header/footer chrome (a line on >⅓ of pages).
  var cleanedTexts = stripBoilerplate(pages.map(function(p) { return p.text }))

  // Build structured knowledge base — full text per page, with markdown headings
  var officialLinks: OfficialLink[] = []
  var sections = pages.map(function(p, idx) {
    // Use page title as section heading, clean it up
    var heading = p.title
      .replace(/\s*[\|–—]\s*.+$/, '')  // strip "| Site Name" suffixes
      .replace(/\s*-\s*$/, '')
      .trim() || 'Page'
    officialLinks.push({ label: heading, url: p.url })
    // Each chunk carries its own real URL (the Spacy "Official page:" pattern).
    return '## ' + heading + '\nOfficial page: ' + p.url + '\n\n' + cleanedTexts[idx]
  })

  // D4(d): a generated Official Links Directory + the standing link-integrity
  // guardrail — returned so the agent editor attaches them at build time to
  // system_prompt / guardrails, making every website-sourced agent immune to
  // URL hallucination by default.
  var linksDirectory = buildLinksDirectory(officialLinks)

  var fullText = '# Deep Crawl Knowledge Base\n\n' + sections.join('\n\n---\n\n')

  return NextResponse.json({
    text: fullText,
    pages_crawled: pages.length,
    pages_found: visited.size,
    sites_crawled: baseUrls.length,
    urls: pages.map(function(p) { return p.url }),
    official_links: officialLinks,
    links_directory: linksDirectory,
    link_integrity_guardrail: LINK_INTEGRITY_GUARDRAIL,
  })
}
