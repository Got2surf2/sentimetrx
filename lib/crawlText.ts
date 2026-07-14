// lib/crawlText.ts
// D4 (AGENT_TIERS §2) — pure text helpers for the website deep-crawl. Split
// out of the route so the link-preservation, boilerplate-strip and sitemap
// logic are unit-testable. No network here; the route does the fetching.

export const MAX_TEXT_PER_PAGE = 30000  // 30KB per page (full detail, not compressed)

/**
 * Convert an in-body anchor to markdown `[label](absoluteUrl)`, resolving the
 * href against the page URL. Drops non-navigational links (mailto/tel/js/#).
 */
function anchorToMarkdown(rawHref: string, innerHtml: string, pageUrl: string): string {
  const href = rawHref.trim()
  // Strip tags inside the anchor to a plain label.
  const label = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) {
    return label // keep the text, drop the non-link
  }
  try {
    const resolved = new URL(href, pageUrl)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return label
    const clean = resolved.href.replace(/#.*$/, '')
    return label ? `[${label}](${clean})` : clean
  } catch {
    return label
  }
}

/**
 * Extract text from HTML as markdown-ish text, PRESERVING in-body links as
 * `[label](url)`. Without this the model has no real URLs to hand out and
 * invents them (the Spacy incident).
 */
export function htmlToText(html: string, pageUrl: string): string {
  let text = html
    // Remove script, style, noscript blocks
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // D4(a): preserve links BEFORE stripping tags
    .replace(/<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => ' ' + anchorToMarkdown(href, inner, pageUrl) + ' ')
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

/** Extract same-host internal links from HTML for BFS crawling. */
export function extractLinks(html: string, baseUrl: URL): string[] {
  const links: string[] = []
  const seen = new Set<string>()
  const re = /href=["']([^"'#]+)/gi
  let match: RegExpExecArray | null

  while ((match = re.exec(html)) !== null) {
    const href = match[1]
    try {
      const resolved = new URL(href, baseUrl.origin)
      if (resolved.hostname !== baseUrl.hostname) continue
      if (/\.(pdf|jpg|jpeg|png|gif|svg|css|js|zip|mp4|mp3|doc|xls|pptx?)$/i.test(resolved.pathname)) continue
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue
      const normalized = resolved.origin + resolved.pathname.replace(/\/+$/, '')
      if (!seen.has(normalized)) {
        seen.add(normalized)
        links.push(normalized)
      }
    } catch { /* skip malformed href */ }
  }
  return links
}

/**
 * D4(b): parse a sitemap.xml (or sitemap index) into same-host page URLs.
 * Returns page `<loc>` URLs for a urlset, or child-sitemap `<loc>` URLs for a
 * sitemapindex (caller fetches those next). Non-HTML resources are dropped.
 */
export function parseSitemapUrls(xml: string, hostname: string): { pages: string[]; childSitemaps: string[] } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml)
  const locs: string[] = []
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  const seen = new Set<string>()
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1].replace(/&amp;/g, '&').trim()
    try {
      const u = new URL(raw)
      if (u.hostname !== hostname) continue
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      if (!isIndex && /\.(pdf|jpg|jpeg|png|gif|svg|css|js|zip|mp4|mp3|doc|xls|pptx?)$/i.test(u.pathname)) continue
      const norm = isIndex ? u.href : u.origin + u.pathname.replace(/\/+$/, '')
      if (!seen.has(norm)) { seen.add(norm); locs.push(norm) }
    } catch { /* skip malformed loc */ }
  }
  return isIndex ? { pages: [], childSitemaps: locs } : { pages: locs, childSitemaps: [] }
}

/**
 * D4(c): strip repeated nav/header/footer chrome. A non-blank line that
 * appears on more than a third of the crawled pages is boilerplate (the same
 * menu on every page) and is removed from each page. Only kicks in at >= 3
 * pages, where the ratio is meaningful. Mutates nothing; returns new texts.
 */
export function stripBoilerplate(texts: string[]): string[] {
  if (texts.length < 3) return texts
  const freq = new Map<string, number>()
  for (const t of texts) {
    const uniqueLines = new Set(t.split('\n').map((l) => l.trim()).filter(Boolean))
    for (const line of uniqueLines) freq.set(line, (freq.get(line) || 0) + 1)
  }
  const threshold = texts.length / 3
  const chrome = new Set<string>()
  for (const [line, count] of freq) {
    if (count > threshold) chrome.add(line)
  }
  if (chrome.size === 0) return texts
  return texts.map((t) =>
    t.split('\n')
      .filter((l) => !chrome.has(l.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  )
}
