// D4 (AGENT_TIERS §2) — crawl-quality "Spacy class" fix. Pure helpers behind
// the website deep-crawl: link preservation, boilerplate strip, sitemap
// parsing, and the build-time Official Links Directory + link-integrity
// guardrail that stop agents from inventing URLs.
import { describe, it, expect } from 'vitest'
import { htmlToText, stripBoilerplate, parseSitemapUrls } from '@/lib/crawlText'
import {
  buildLinksDirectory,
  attachLinksDirectory,
  withLinkIntegrityGuardrail,
  normalizeOfficialLinks,
  hasLinksDirectory,
  LINKS_DIRECTORY_HEADER,
  LINK_INTEGRITY_GUARDRAIL,
} from '@/lib/agentLinks'

describe('htmlToText — D4(a) link preservation', () => {
  it('preserves in-body links as [label](absoluteUrl), resolving relatives', () => {
    const html = '<p>Visit our <a href="/about">About Us</a> page.</p>'
    const out = htmlToText(html, 'https://example.com/home')
    expect(out).toContain('[About Us](https://example.com/about)')
  })

  it('resolves absolute hrefs verbatim and strips the URL fragment', () => {
    const out = htmlToText('<a href="https://example.com/x#frag">X</a>', 'https://example.com/')
    expect(out).toContain('[X](https://example.com/x)')
  })

  it('drops mailto/tel/anchor links to plain text (never a fake URL)', () => {
    const out = htmlToText('<a href="mailto:a@b.com">Email us</a> <a href="#top">Top</a>', 'https://example.com/')
    expect(out).toContain('Email us')
    expect(out).toContain('Top')
    expect(out).not.toContain('mailto:')
    expect(out).not.toContain('](#')
  })
})

describe('stripBoilerplate — D4(c)', () => {
  it('removes a line that appears on more than a third of pages, keeps unique lines', () => {
    const pages = [
      'Home | About | Contact\nWelcome to page one\nunique one',
      'Home | About | Contact\nThis is page two body\nunique two',
      'Home | About | Contact\nPage three content here\nunique three',
      'Home | About | Contact\nFourth page material\nunique four',
    ]
    const cleaned = stripBoilerplate(pages)
    for (const p of cleaned) expect(p).not.toContain('Home | About | Contact')
    expect(cleaned[0]).toContain('unique one')
    expect(cleaned[1]).toContain('This is page two body')
  })

  it('is a no-op under 3 pages (ratio not meaningful)', () => {
    const pages = ['nav\nbody a', 'nav\nbody b']
    expect(stripBoilerplate(pages)).toEqual(pages)
  })
})

describe('parseSitemapUrls — D4(b)', () => {
  it('returns same-host page locs from a urlset, dropping other-host + assets', () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/a</loc></url>
      <url><loc>https://example.com/b/</loc></url>
      <url><loc>https://evil.com/c</loc></url>
      <url><loc>https://example.com/x.pdf</loc></url>
    </urlset>`
    const { pages, childSitemaps } = parseSitemapUrls(xml, 'example.com')
    expect(pages).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(childSitemaps).toEqual([])
  })

  it('returns child sitemaps (not pages) for a sitemapindex', () => {
    const xml = `<sitemapindex>
      <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
      <sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap>
    </sitemapindex>`
    const { pages, childSitemaps } = parseSitemapUrls(xml, 'example.com')
    expect(pages).toEqual([])
    expect(childSitemaps).toEqual(['https://example.com/sitemap-1.xml', 'https://example.com/sitemap-2.xml'])
  })
})

describe('agentLinks — D4(d) build-time Links Directory + guardrail', () => {
  const links = [
    { label: 'Home', url: 'https://example.com/' },
    { label: 'Hours', url: 'https://example.com/hours' },
  ]

  it('buildLinksDirectory carries the header, real URLs, and an end marker; empty for no valid links', () => {
    const dir = buildLinksDirectory(links)
    expect(dir).toContain(LINKS_DIRECTORY_HEADER)
    expect(dir).toContain('- Home: https://example.com/')
    expect(dir).toContain('- Hours: https://example.com/hours')
    expect(buildLinksDirectory([{ label: 'x', url: 'not-a-url' }])).toBe('')
  })

  it('normalizeOfficialLinks drops non-http and dedups by URL', () => {
    const out = normalizeOfficialLinks([
      { label: 'A', url: 'https://e.com/a' },
      { label: 'A dup', url: 'https://e.com/a' },
      { label: 'bad', url: 'ftp://e.com/x' },
    ])
    expect(out).toEqual([{ label: 'A', url: 'https://e.com/a' }])
  })

  it('attachLinksDirectory appends when absent and REPLACES a prior block (idempotent)', () => {
    const base = 'You are a helpful guide.'
    const once = attachLinksDirectory(base, links)
    expect(once.startsWith(base)).toBe(true)
    expect(hasLinksDirectory(once)).toBe(true)

    // Re-crawl with a changed set must not stack a second directory.
    const twice = attachLinksDirectory(once, [{ label: 'Hours', url: 'https://example.com/hours-new' }])
    // exactly one directory block (the intro line appears once per block)
    expect((twice.match(/These are the ONLY official URLs/g) || []).length).toBe(1)
    expect(twice).toContain('https://example.com/hours-new')
    expect(twice).not.toContain('- Hours: https://example.com/hours\n') // old line gone
    expect(twice.startsWith(base)).toBe(true)
  })

  it('withLinkIntegrityGuardrail adds the rule once, never twice', () => {
    const g1 = withLinkIntegrityGuardrail([])
    expect(g1).toContain(LINK_INTEGRITY_GUARDRAIL)
    const g2 = withLinkIntegrityGuardrail(g1)
    expect(g2).toHaveLength(1)
  })
})
