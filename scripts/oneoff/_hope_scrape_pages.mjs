// Broad scrape of foundationsproject.org + centralfloridahomeless.org so the
// Hope agent has authoritative KB content for both sites. Same Playwright
// pattern as _mco_scrape_pages.mjs (handles JS-rendered Wix + WordPress).
//
// Each page is tagged with `site: 'foundations' | 'coalition'` so the seeder
// can store that on every chunk's metadata. Hope uses that tag to bias
// retrieval based on which site she's embedded on (?site=foundations|coalition).
//
// Output: /tmp/hope_pages.json — { fetched_at, pages: [{url, site, title, blocks}] }
//
// Run: node scripts/_hope_scrape_pages.mjs

import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'fs'

const FDN_URLS = readFileSync('/tmp/fdn_urls_final.txt', 'utf-8').trim().split('\n').filter(Boolean)
const COALITION_URLS = readFileSync('/tmp/coalition_urls_final.txt', 'utf-8').trim().split('\n').filter(Boolean)
const TARGETS = [
  ...FDN_URLS.map(u => ({ url: u, site: 'foundations' })),
  ...COALITION_URLS.map(u => ({ url: u, site: 'coalition' })),
]

const NAV_TIMEOUT = 35_000
const SETTLE_TIMEOUT = 15_000

const browser = await chromium.launch()
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (compatible; Sentimetrx-Hope/1.0)' })
const page = await ctx.newPage()
page.on('pageerror', () => {})
page.on('console', () => {})

async function extractPage(url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT }).catch(() => {})
    // Wait for main content; Wix pages need a beat for the SPA to hydrate.
    await page.waitForFunction(() => {
      const main = document.querySelector('main, [role="main"], #SITE_PAGES, #SITE_CONTAINER, article, .entry-content')
      return main && main.textContent && main.textContent.trim().length > 150
    }, { timeout: 10_000 }).catch(() => {})

    const result = await page.evaluate(() => {
      // Pick a sensible root. Wix sites render under #SITE_PAGES / #SITE_CONTAINER.
      // WordPress falls back to <main> or <article>.
      let root =
        document.querySelector('main, [role="main"], article, .entry-content') ||
        document.querySelector('#SITE_PAGES') ||
        document.querySelector('#SITE_CONTAINER') ||
        null
      if (!root) {
        const divs = Array.from(document.querySelectorAll('#__next > div, body > div'))
        root = divs
          .map(d => ({ d, len: (d.textContent || '').length }))
          .sort((a, b) => b.len - a.len)[0]?.d || document.body
      }

      const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','NAV','FOOTER','HEADER','IFRAME','BUTTON','INPUT','SELECT','TEXTAREA','FORM','SVG','IMG','PICTURE','VIDEO'])
      const SKIP_CLASS_PATTERNS = [/cookie/i, /banner/i, /menu/i, /navigation/i, /\bnav\b/i, /footer/i, /\bheader\b/i, /search/i, /sidebar/i, /breadcrumb/i, /social/i, /skip-to/i]

      function shouldSkip(el) {
        if (SKIP_TAGS.has(el.tagName)) return true
        const cls = (el.className && typeof el.className === 'string') ? el.className : ''
        const id = el.id || ''
        const combined = (cls + ' ' + id).toLowerCase()
        return SKIP_CLASS_PATTERNS.some(re => re.test(combined))
      }

      function normText(s) { return (s || '').replace(/\s+/g, ' ').trim() }

      const blocks = []
      const seen = new Set()

      function walk(el) {
        if (!el || el.nodeType !== 1) return
        if (shouldSkip(el)) return
        const tag = el.tagName

        if (/^H[1-6]$/.test(tag)) {
          const t = normText(el.textContent)
          if (t && t.length > 1 && !seen.has('h:' + t)) {
            seen.add('h:' + t)
            blocks.push({ type: 'h' + tag[1], text: t })
          }
          return
        }
        if (tag === 'P') {
          const t = normText(el.textContent)
          if (t && t.length > 8 && !seen.has('p:' + t)) {
            seen.add('p:' + t)
            blocks.push({ type: 'p', text: t })
          }
          return
        }
        if (tag === 'BLOCKQUOTE') {
          const t = normText(el.textContent)
          if (t && t.length > 8 && !seen.has('q:' + t)) {
            seen.add('q:' + t)
            blocks.push({ type: 'p', text: '"' + t + '"' })
          }
          return
        }
        if (tag === 'UL' || tag === 'OL') {
          const items = Array.from(el.querySelectorAll(':scope > li')).map(li => normText(li.textContent)).filter(t => t && t.length > 1)
          if (items.length > 0) {
            const key = 'l:' + items.join('|').slice(0, 200)
            if (!seen.has(key)) {
              seen.add(key)
              blocks.push({ type: tag === 'UL' ? 'ul' : 'ol', items })
            }
          }
          return
        }
        if (tag === 'DL') {
          const items = []
          let cur = null
          for (const child of el.children) {
            if (child.tagName === 'DT') {
              if (cur) items.push(cur)
              cur = { q: normText(child.textContent), a: '' }
            } else if (child.tagName === 'DD' && cur) {
              cur.a = (cur.a + ' ' + normText(child.textContent)).trim()
            }
          }
          if (cur) items.push(cur)
          if (items.length > 0) blocks.push({ type: 'dl', items })
          return
        }
        if (tag === 'TABLE') {
          const rows = Array.from(el.querySelectorAll('tr')).map(tr =>
            Array.from(tr.querySelectorAll('th, td')).map(c => normText(c.textContent)).filter(Boolean).join(' · ')
          ).filter(Boolean)
          if (rows.length > 0) blocks.push({ type: 'table', rows })
          return
        }
        // Wix often wraps text in <span> chains inside divs — for divs with
        // a direct text-bearing class, capture once.
        if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
          for (const child of el.children) walk(child)
          return
        }
        // SPAN / other inline — descend
        for (const child of el.children) walk(child)
      }

      walk(root)

      // Title: prefer doc title minus site-name suffix, fall back to first h1/h2 in root.
      function bestTitle() {
        const doc = normText(document.title)
            .replace(/\s*[-|—]\s*Foundations Project.*$/i, '')
            .replace(/\s*[-|—]\s*Coalition for the Homeless.*$/i, '')
            .replace(/\s*\|\s*Coalition for the Homeless.*$/i, '')
            .replace(/\s*\|\s*Foundations Project.*$/i, '')
            .trim()
        if (doc && !/^Coalition for the Homeless/i.test(doc) && !/^Foundations Project/i.test(doc)) return doc
        const h1 = root.querySelector('h1')
        const h2 = root.querySelector('h2')
        return normText(h1?.textContent) || normText(h2?.textContent) || doc || ''
      }

      return { title: bestTitle(), blocks }
    })

    return { url, title: result.title, blocks: result.blocks, ok: true }
  } catch (e) {
    return { url, title: '', blocks: [], ok: false, error: String(e?.message || e) }
  }
}

console.log('crawling ' + TARGETS.length + ' pages (' + FDN_URLS.length + ' foundations + ' + COALITION_URLS.length + ' coalition)...')
const pages = []
let i = 0
for (const t of TARGETS) {
  i++
  const result = await extractPage(t.url)
  const blockCount = result.blocks.length
  const charCount = JSON.stringify(result.blocks).length
  console.log('  [' + i + '/' + TARGETS.length + '] ' + (result.ok ? '✓' : '✗') + ' [' + t.site + '] ' + t.url + ' — ' + blockCount + ' blocks, ' + charCount + ' chars' + (result.ok ? '' : '  ERR: ' + result.error))
  pages.push({ ...result, site: t.site })
}

writeFileSync('/tmp/hope_pages.json', JSON.stringify({
  fetched_at: new Date().toISOString(),
  count: pages.length,
  pages,
}, null, 2))
console.log('\nwrote /tmp/hope_pages.json — ' + pages.length + ' pages, ' + pages.filter(p => p.ok).length + ' ok / ' + pages.filter(p => !p.ok).length + ' failed')
await browser.close()
