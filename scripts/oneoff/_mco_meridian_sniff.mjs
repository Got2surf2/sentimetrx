// Sniff flymco.com/terminal-maps/map to learn how the Meridian SDK loads
// floor-plan images and what URL pattern they follow. The meridian API
// endpoints we already use (api.goaa.aero/content/meridian_*) return
// imageUrl=null for every map, so the image URL must be constructed
// client-side from the map id. We need to know how.

import { chromium } from 'playwright'

const URL = 'https://flymco.com/terminal-maps/map'
const browser = await chromium.launch()
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0' })
const page = await ctx.newPage()

const imageReqs = []
const apiReqs = []
const tileReqs = []
page.on('request', (r) => {
  const u = r.url()
  const t = r.resourceType()
  if (t === 'image' || /\.(png|jpg|jpeg|webp|svg)(\?|$)/i.test(u)) imageReqs.push(u)
  if (/meridian|map.*tile|tile.*map|cdn.*map/i.test(u)) tileReqs.push(u)
  if (u.includes('goaa.aero') || u.includes('aruba') || u.includes('mappedin')) apiReqs.push({ method: r.method(), url: u })
})

console.log('navigating...')
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
await page.waitForTimeout(3000)

// Try clicking around if there's a level selector or a map area
const candidateLinks = await page.$$eval('button, a', els =>
  els.map(e => e.textContent?.trim()).filter(t => t && t.length < 50 && /level|gate|terminal|map/i.test(t)).slice(0, 30)
)
console.log('candidate clickables:', candidateLinks)

console.log('\nAPI requests:')
for (const r of apiReqs) console.log('  ' + r.method + ' ' + r.url)

console.log('\nImage requests (' + imageReqs.length + '):')
const unique = Array.from(new Set(imageReqs))
// Show distinct hosts + path patterns
const byHost = {}
for (const u of unique) {
  try {
    const h = new URL(u).host
    byHost[h] = (byHost[h] || []).concat([u])
  } catch {}
}
for (const [host, urls] of Object.entries(byHost)) {
  console.log('  HOST ' + host + ' (' + urls.length + ' urls):')
  for (const u of urls.slice(0, 5)) console.log('    ' + u)
  if (urls.length > 5) console.log('    ... and ' + (urls.length - 5) + ' more')
}

console.log('\nTile-like requests (' + tileReqs.length + '):')
for (const u of tileReqs.slice(0, 20)) console.log('  ' + u)

// Look at the page HTML for hardcoded Meridian config / API keys
const html = await page.content()
const meridianRefs = (html.match(/[a-z]+\.[a-z]+\/[\w\/.-]*meridian[\w\/.-]*/gi) || []).slice(0, 5)
console.log('\nMeridian refs in HTML:')
for (const m of new Set(meridianRefs)) console.log('  ' + m)

const tokens = (html.match(/['"]([a-z0-9]{20,40})['"]/gi) || []).slice(0, 5)
console.log('\nPossible API tokens in HTML:')
for (const t of new Set(tokens)) console.log('  ' + t)

await browser.close()
