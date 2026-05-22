// One-off scrape: pull ALL entries (Shop / Dine / Amenity) from
// flymco.com's shops-restaurants-services directory.
//
// Strategy: each filter pill -> paginate. Per page, do ONE page.evaluate()
// that walks the card DOM in the browser and returns plain JS objects.
// Much faster + more robust than nested Playwright xpath locators.
//
// Output: /tmp/mco_directory.json
//
// Run: node scripts/_mco_scrape_directory.mjs

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const DIRECTORY_URL = 'https://flymco.com/shops-restaurants-services/'
const CATEGORIES = ['Shop', 'Dine', 'Amenity']
const MAX_PAGES = 200

const browser = await chromium.launch()
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0' })
const page = await ctx.newPage()

console.log('navigating to directory...')
await page.goto(DIRECTORY_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
// Initial card-render settle
await page.waitForFunction(() => document.querySelectorAll('[class*="PoiCardBadge"]').length > 0, { timeout: 20_000 }).catch(() => {})

const seen = new Set()
const entries = []

async function harvestCurrentPage(category) {
  // Run extraction inside the page — one round-trip.
  const cards = await page.evaluate(() => {
    const out = []
    const badges = document.querySelectorAll('[class*="PoiCardBadge"]')
    for (const badge of badges) {
      // Walk up to the nearest ancestor that contains both a heading-ish
      // node AND the badge. Heading is usually within 2-3 ancestors above.
      let root = badge.parentElement
      let heading = null
      for (let i = 0; i < 5 && root; i++) {
        heading = root.querySelector('h2, h3, h4, h5, [class*="Heading"]')
        if (heading && heading.textContent && heading.textContent.trim()) break
        root = root.parentElement
      }
      const name = heading ? heading.textContent.trim() : ''
      const location = (badge.textContent || '').trim()
      // Detail URL: first placemarkId href under root
      let detail_url = null
      if (root) {
        const a = root.querySelector('a[href*="placemarkId"]')
        if (a) detail_url = a.getAttribute('href')
      }
      if (name && location) out.push({ name, location, detail_url })
    }
    return out
  })
  let added = 0
  for (const c of cards) {
    const key = category + '|' + c.name.toLowerCase() + '|' + c.location.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({
      name: c.name,
      category,
      location: c.location,
      detail_url: c.detail_url ? new globalThis.URL(c.detail_url, 'https://flymco.com').toString() : null,
    })
    added++
  }
  return added
}

async function readPager() {
  // Pager appears as "1 of 113 pages". Find it once per turn so we know when to stop.
  return await page.evaluate(() => {
    const re = /(\d+)\s+of\s+(\d+)\s+pages?/i
    for (const el of document.querySelectorAll('body *')) {
      const t = (el.textContent || '').trim()
      if (t.length < 8 || t.length > 30) continue
      const m = t.match(re)
      if (m) return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) }
    }
    return null
  })
}

async function clickFilter(name) {
  console.log(`\n=== category: ${name} ===`)
  // Tap the visible pill — buttons or links.
  const tapped = await page.evaluate((n) => {
    const re = new RegExp('^' + n + '$', 'i')
    const all = document.querySelectorAll('button, a, [role="button"]')
    for (const el of all) {
      const t = (el.textContent || '').trim()
      if (re.test(t)) { el.click(); return true }
    }
    return false
  }, name)
  if (!tapped) throw new Error(`Filter pill "${name}" not found`)
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  await page.waitForFunction(() => document.querySelectorAll('[class*="PoiCardBadge"]').length > 0, { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(600)
}

async function clickNext() {
  return await page.evaluate(() => {
    const all = document.querySelectorAll('button, a, [role="button"]')
    for (const el of all) {
      const t = (el.textContent || '').trim()
      if (/^Next$/i.test(t)) {
        if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false
        el.click()
        return true
      }
    }
    return false
  })
}

for (const cat of CATEGORIES) {
  await clickFilter(cat)
  let lastTotal = null
  for (let p = 1; p <= MAX_PAGES; p++) {
    const pager = await readPager()
    if (pager) lastTotal = pager.total
    const added = await harvestCurrentPage(cat)
    console.log(`  ${cat} page ${pager?.current ?? p}${pager?.total ? '/' + pager.total : ''}: +${added}  (running total ${entries.length})`)
    if (pager && pager.current >= pager.total) break
    const clicked = await clickNext()
    if (!clicked) { console.log('  (Next not clickable — stopping this category)'); break }
    // Wait for the pager to advance
    if (pager) {
      await page.waitForFunction(
        (prev) => {
          const re = /(\d+)\s+of\s+(\d+)\s+pages?/i
          for (const el of document.querySelectorAll('body *')) {
            const t = (el.textContent || '').trim()
            const m = t.match(re)
            if (m) return parseInt(m[1], 10) > prev
          }
          return false
        },
        pager.current,
        { timeout: 10_000 },
      ).catch(() => {})
    } else {
      await page.waitForTimeout(700)
    }
  }
  console.log(`  ${cat} total this category: ${entries.filter(e => e.category === cat).length}${lastTotal ? '  (expected ~' + lastTotal + ' pages)' : ''}`)
}

writeFileSync('/tmp/mco_directory.json', JSON.stringify({
  fetched_at: new Date().toISOString(),
  source_url: DIRECTORY_URL,
  count: entries.length,
  by_category: Object.fromEntries(CATEGORIES.map(c => [c, entries.filter(e => e.category === c).length])),
  entries,
}, null, 2))
console.log(`\nwrote /tmp/mco_directory.json with ${entries.length} entries`)
console.log('by category:', Object.fromEntries(CATEGORIES.map(c => [c, entries.filter(e => e.category === c).length])))
await browser.close()
