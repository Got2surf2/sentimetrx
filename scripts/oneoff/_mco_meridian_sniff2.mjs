// Find the Meridian API token by capturing the Authorization header on
// the SVG request from flymco.com/terminal-maps/map.

import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0' })
const page = await ctx.newPage()

page.on('request', (r) => {
  const u = r.url()
  if (u.includes('meridianapps.com')) {
    const h = r.headers()
    console.log('---', r.method(), u)
    for (const k of Object.keys(h)) {
      if (/auth|token|key/i.test(k)) console.log('   ' + k + ': ' + h[k])
    }
  }
})

await page.goto('https://flymco.com/terminal-maps/map', { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
await page.waitForTimeout(3000)
await browser.close()
