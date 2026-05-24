// One-off network sniff of flymco.com/security. Looking for any XHR/fetch
// to api.goaa.aero (or similar) that might power a live TSA wait widget,
// like the parking-availability page does for lots.

import { chromium } from 'playwright'

const URL = 'https://flymco.com/security'
const browser = await chromium.launch()
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0' })
const page = await ctx.newPage()

const seen = []
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('goaa') || u.includes('wait') || u.includes('security') || u.includes('tsa') || u.includes('checkpoint')) {
    seen.push({ method: r.method(), url: u })
  }
})
page.on('response', async (r) => {
  const u = r.url()
  if ((u.includes('goaa') || u.includes('wait') || u.includes('checkpoint') || u.includes('/tsa/')) && r.status() === 200) {
    try {
      const text = await r.text()
      console.log('---RESPONSE---', u, r.status())
      console.log(text.slice(0, 500))
    } catch (e) {}
  }
})

console.log('navigating...')
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
// Some pages lazily fetch on interaction — try scrolling
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(3000)

console.log('\nMatched requests (' + seen.length + '):')
for (const r of seen) console.log('  ' + r.method + ' ' + r.url)

// Look for any wait-time-like content on the rendered page
const visible = await page.evaluate(() => {
  const t = document.body.innerText || ''
  // Find numbers near wait/queue/minutes
  const lines = t.split(/\n+/).filter(l => /(wait|queue|checkpoint|tsa|line|min(ute)?s?)/i.test(l)).slice(0, 30)
  return lines
})
console.log('\nWait-related visible text:')
for (const l of visible) console.log('  ' + l)

// Also check page source for any embedded JSON
const pageHTML = await page.content()
const apiMatches = pageHTML.match(/https?:\/\/[^\s"']+(wait|security|checkpoint|tsa)[^\s"']*/gi) || []
console.log('\nAPI-like URLs in page HTML:')
for (const m of new Set(apiMatches)) console.log('  ' + m)

await browser.close()
