// Broad scrape of flymco.com's traveler-facing info pages.
// Captures the prose content (title, headings, paragraphs, list items) of
// each page in TARGET_URLS so the seeder can chunk + embed them into the
// agent's KB. Replaces deflections like "check flymco.com/X" with first-class
// answers Ana can deliver inline.
//
// Strategy: Playwright (same as _mco_scrape_directory.mjs because flymco.com
// is a JS-heavy site). For each URL, navigate, wait for the main content
// container to populate, then run a single page.evaluate() that flattens
// the main content into structured records ({type, text}).
//
// Output: /tmp/mco_pages.json — { fetched_at, pages: [{url, title, blocks}] }
//
// Run: node scripts/_mco_scrape_pages.mjs

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

// Traveler-relevant URLs selected from the sitemap. Priority 1: anything an
// arriving / departing / transferring passenger could ask about. Excludes:
// employee/HR pages, business/finance pages, executive-airport (different
// facility), construction projects, photo galleries, real-time data pages
// (we use the API for parking + flight status), and pure legal/privacy.
const TARGET_URLS = [
  // FAQ tree — the highest-density Q&A on flymco.com.
  // Note: /faqs is the EMPLOYEE FAQ (recognition program, badges, etc.) —
  // explicitly excluded. The traveler-facing FAQ tree is under
  // /frequently-asked-questions/*.
  'https://flymco.com/frequently-asked-questions/security-questions',
  'https://flymco.com/frequently-asked-questions/terminal-c',
  'https://flymco.com/frequently-asked-questions/international-visitors',
  'https://flymco.com/frequently-asked-questions/faq-ground-transportation',
  'https://flymco.com/frequently-asked-questions/checking-in',
  'https://flymco.com/frequently-asked-questions/pets-service-animals',
  'https://flymco.com/frequently-asked-questions/other',
  'https://flymco.com/frequently-asked-questions/picking-up-dropping-off',
  'https://flymco.com/frequently-asked-questions/getting-around',
  'https://flymco.com/frequently-asked-questions/while-youre-waiting',
  'https://flymco.com/frequently-asked-questions/faq-lost-and-found',
  // Accessibility + services
  'https://flymco.com/accessibility',
  'https://flymco.com/accessibility/annies-space-sensory-room',
  'https://flymco.com/wifi',
  'https://flymco.com/lost-and-found',
  'https://flymco.com/family-friendly-amenities',
  'https://flymco.com/family-friendly-amenities/mco-paw-pilots',
  'https://flymco.com/concierge-services',
  'https://flymco.com/concierge-services/skysquad',
  'https://flymco.com/concierge-services/allways',
  'https://flymco.com/concierge-services/air-general-traveler-services',
  'https://flymco.com/concierge-services/clear-ambassador-assist',
  'https://flymco.com/experience-mco-visitor-pass-program',
  // Security + airport navigation
  'https://flymco.com/speed-through-mco',
  'https://flymco.com/speed-through-mco/enhanced-passenger-processing-epp',
  'https://flymco.com/airport-info',
  'https://flymco.com/airport-info/mco-reserve',
  'https://flymco.com/security',
  'https://flymco.com/customs',
  'https://flymco.com/mco-app',
  'https://flymco.com/about-us',
  'https://flymco.com/hotel',
  'https://flymco.com/train-service',
  'https://flymco.com/packtheplane',
  'https://flymco.com/7-eleven-travel-plaza',
  // Ground transportation (18 pages — large category)
  'https://flymco.com/ground-transportation',
  'https://flymco.com/ground-transportation/out-of-town-shuttles',
  'https://flymco.com/ground-transportation/sunrail',
  'https://flymco.com/ground-transportation/shuttle-vans',
  'https://flymco.com/ground-transportation/greyhound',
  'https://flymco.com/ground-transportation/mears-destination-services',
  'https://flymco.com/ground-transportation/hotel-shuttles',
  'https://flymco.com/ground-transportation/vehicles-for-hire',
  'https://flymco.com/ground-transportation/taxi-cabs',
  'https://flymco.com/ground-transportation/local-bus',
  'https://flymco.com/ground-transportation/cruise-transfers',
  'https://flymco.com/ground-transportation/cell-phone-lot',
  'https://flymco.com/ground-transportation/brightline-trains',
  'https://flymco.com/ground-transportation/amtrak',
  'https://flymco.com/ground-transportation/rental-cars-off-airport',
  'https://flymco.com/ground-transportation/rental-cars-on-airport',
  'https://flymco.com/ground-transportation/ride-share',
  'https://flymco.com/ground-transportation/peer-to-peer',
  'https://flymco.com/rental-cars',
  'https://flymco.com/rental-cars/gas-petrol-stations',
  'https://flymco.com/to-from',
  // Parking — info + reservations (each lot has its own page)
  'https://flymco.com/parking-information',
  'https://flymco.com/parking-information/north-cell-phone-lot',
  'https://flymco.com/parking-information/parking-garage-c',
  'https://flymco.com/parking-information/parking-garage-b',
  'https://flymco.com/parking-information/parking-garage-a',
  'https://flymco.com/parking-information/terminal-top',
  'https://flymco.com/parking-information/surface-lot-atlantis',
  'https://flymco.com/parking-information/surface-lot-endeavour',
  'https://flymco.com/parking-information/surface-lot-discovery',
  'https://flymco.com/parking-information/south-cell-phone-lot',
  'https://flymco.com/parking-reservations',
  'https://flymco.com/parking-reservations/south-park-place-economy-lot',
  'https://flymco.com/parking-reservations/north-park-place-economy-lot',
  'https://flymco.com/parking-reservations/west-park-economy-lot',
  'https://flymco.com/parking-reservations/hotel-guest-parking',
  'https://flymco.com/parking-reservations/hyatt-valet-parking',
  'https://flymco.com/parking-reservations/valet-parking',
  // Travel info
  'https://flymco.com/terminal-maps',
  'https://flymco.com/airlines',
  'https://flymco.com/destinations',
  // Orlando experience (theme parks etc — useful for "what's nearby")
  'https://flymco.com/orlando-experience/walt-disney-world-resort',
  'https://flymco.com/orlando-experience/universal-orlando-resort',
  'https://flymco.com/orlando-experience/seaworld',
  'https://flymco.com/orlando-experience/convention-center',
  'https://flymco.com/orlando-experience/port-canaveral',
  'https://flymco.com/orlando-experience/visit-orlando',
  'https://flymco.com/orlando-experience/city-of-orlando',
]

const NAV_TIMEOUT = 30_000
const SETTLE_TIMEOUT = 15_000

const browser = await chromium.launch()
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (compatible; Sentimetrx-MCO/1.0)' })
const page = await ctx.newPage()

// Suppress noisy console/page errors — flymco.com triggers a lot of third-party
// analytics chatter that doesn't matter for content extraction.
page.on('pageerror', () => {})
page.on('console', () => {})

async function extractPage(url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT }).catch(() => {})
    // Wait for main content container to populate. Flymco wraps content in
    // either <main> or a Next.js layout div — we try several selectors before
    // giving up and extracting whatever's there.
    await page.waitForFunction(() => {
      const main = document.querySelector('main, [role="main"], #__next main, article')
      return main && main.textContent && main.textContent.trim().length > 200
    }, { timeout: 8_000 }).catch(() => {})

    const result = await page.evaluate(() => {
      // Locate the main content area. Prefer <main>, then <article>, then
      // the largest text-bearing div as a heuristic.
      let root = document.querySelector('main, [role="main"], article')
      if (!root) {
        const divs = Array.from(document.querySelectorAll('#__next > div, body > div'))
        root = divs
          .map(d => ({ d, len: (d.textContent || '').length }))
          .sort((a, b) => b.len - a.len)[0]?.d || document.body
      }

      // Recursively walk the root, emitting one block per content element.
      // Filter out navigation, footer, scripts, headers, cookie banners, etc.
      const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER', 'HEADER', 'IFRAME', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FORM', 'SVG', 'IMG', 'PICTURE', 'VIDEO'])
      const SKIP_CLASS_PATTERNS = [/cookie/i, /banner/i, /menu/i, /nav/i, /footer/i, /header/i, /search/i, /sidebar/i, /breadcrumb/i, /social/i]

      function shouldSkip(el) {
        if (SKIP_TAGS.has(el.tagName)) return true
        const cls = (el.className && typeof el.className === 'string') ? el.className : ''
        const id = el.id || ''
        const combined = (cls + ' ' + id).toLowerCase()
        return SKIP_CLASS_PATTERNS.some(re => re.test(combined))
      }

      function normText(s) { return (s || '').replace(/\s+/g, ' ').trim() }

      const blocks = []
      const seenText = new Set()

      function walk(el) {
        if (!el || el.nodeType !== 1) return
        if (shouldSkip(el)) return
        const tag = el.tagName

        // Headings (excluding nav/footer already filtered)
        if (/^H[1-6]$/.test(tag)) {
          const t = normText(el.textContent)
          if (t && !seenText.has('h:' + t)) {
            seenText.add('h:' + t)
            blocks.push({ type: 'h' + tag[1], text: t })
          }
          return
        }
        // Paragraphs
        if (tag === 'P') {
          const t = normText(el.textContent)
          if (t && t.length > 8 && !seenText.has('p:' + t)) {
            seenText.add('p:' + t)
            blocks.push({ type: 'p', text: t })
          }
          return
        }
        // Lists — capture each li
        if (tag === 'UL' || tag === 'OL') {
          const items = Array.from(el.querySelectorAll(':scope > li')).map(li => normText(li.textContent)).filter(t => t && t.length > 1)
          if (items.length > 0) {
            const key = 'l:' + items.join('|').slice(0, 200)
            if (!seenText.has(key)) {
              seenText.add(key)
              blocks.push({ type: tag === 'UL' ? 'ul' : 'ol', items })
            }
          }
          return
        }
        // Definition lists (rare but used for FAQ-style content)
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
        // Tables — flatten rows as text lines (simple but adequate for our content)
        if (tag === 'TABLE') {
          const rows = Array.from(el.querySelectorAll('tr')).map(tr =>
            Array.from(tr.querySelectorAll('th, td')).map(c => normText(c.textContent)).filter(Boolean).join(' · ')
          ).filter(Boolean)
          if (rows.length > 0) blocks.push({ type: 'table', rows })
          return
        }
        // Otherwise recurse into children
        for (const child of el.children) walk(child)
      }

      walk(root)

      // Page title strategy: flymco.com's H1 is the site name on every page
      // ("Orlando International Airport (MCO)"), so we prefer <title> with
      // its " - Orlando International Airport (MCO)" suffix stripped. If
      // the doc title is also the site name, fall back to the most specific
      // h2 inside the main content area.
      const SITE_TITLE_RE = /\s*[-|—]\s*Orlando International Airport.*$/i
      const docTitle = normText(document.title).replace(SITE_TITLE_RE, '').trim()
      let title = ''
      if (docTitle && !/^Orlando International Airport/i.test(docTitle)) {
        title = docTitle
      } else {
        const h2 = root.querySelector('h2')
        const h1 = root.querySelector('h1')
        title = normText(h2?.textContent) || normText(h1?.textContent) || docTitle || ''
      }

      return { title, blocks }
    })

    return { url, title: result.title, blocks: result.blocks, ok: true }
  } catch (e) {
    return { url, title: '', blocks: [], ok: false, error: String(e?.message || e) }
  }
}

console.log(`crawling ${TARGET_URLS.length} pages...`)
const pages = []
let i = 0
for (const url of TARGET_URLS) {
  i++
  const result = await extractPage(url)
  const blockCount = result.blocks.length
  const charCount = JSON.stringify(result.blocks).length
  console.log(`  [${i}/${TARGET_URLS.length}] ${result.ok ? '✓' : '✗'} ${url} — ${blockCount} blocks, ${charCount} chars${result.ok ? '' : '  ERR: ' + result.error}`)
  pages.push(result)
}

writeFileSync('/tmp/mco_pages.json', JSON.stringify({
  fetched_at: new Date().toISOString(),
  count: pages.length,
  pages,
}, null, 2))
console.log(`\nwrote /tmp/mco_pages.json — ${pages.length} pages, ${pages.filter(p => p.ok).length} ok / ${pages.filter(p => !p.ok).length} failed`)
await browser.close()
