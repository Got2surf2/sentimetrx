// lib/htmlToPdf.ts
//
// Generic self-contained-HTML → PDF buffer via headless Chrome. Chrome resolution
// mirrors the Agent Study / Town Hall report routes: @sparticuz/chromium on the
// Vercel runtime (detected by process.platform === 'linux', NOT process.env.VERCEL
// — .env.local sets VERCEL=1), an installed local Chrome in dev. Used by the
// Project Report PDF route; the recordings reportPdf has its own copy with a
// branded running header/footer.

import 'server-only'
import { existsSync } from 'fs'
import type { Browser } from 'puppeteer-core'

const CHROME_FONT = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`
function escChrome(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Per-page running header + footer for the PDF-template STANDARD (memory:
 * feedback_pdf_template_rules) — REQUIRED on every new PDF:
 *   - header: the brand/project name, top-right
 *   - footer: confidentiality statement (left) · datanautix wordmark + datanautix.com
 *     (center) · "Page X of Y" (right)
 * Returns the templates + the margins that reserve the header/footer bands. Pair
 * with the `.keep` heading-wrapper CSS in the body so section titles never orphan.
 */
export function brandedPdfChrome(opts: { brand: string; confidentiality?: string }): {
  headerTemplate: string
  footerTemplate: string
  margin: { top: string; bottom: string; left: string; right: string }
} {
  const brand = escChrome(opts.brand)
  const conf = escChrome(opts.confidentiality || 'Confidential — for intended recipients only')
  // page.pdf templates render outside the document with no inherited styles, so
  // font-size MUST be set explicitly or they render at ~0. .pageNumber/.totalPages
  // are populated by Chrome.
  const headerTemplate =
    `<div style="width:100%;${CHROME_FONT};font-size:9px;color:#64748b;padding:0 12mm;text-align:right">` +
    `<span style="font-weight:700;color:#0f172a">${brand}</span></div>`
  const dn = `<span style="font-weight:700"><span style="color:#0F7173">data</span><span style="color:#E85A1A">nautix</span></span>`
  const footerTemplate =
    `<div style="width:100%;${CHROME_FONT};font-size:8px;color:#94a3b8;padding:0 12mm;display:flex;justify-content:space-between;align-items:center">` +
    `<span>${conf}</span>` +
    `<span>${dn} · datanautix.com</span>` +
    `<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>` +
    `</div>`
  return { headerTemplate, footerTemplate, margin: { top: '16mm', bottom: '18mm', left: '12mm', right: '12mm' } }
}

function localChromePath(): string | null {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean) as string[]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import('puppeteer-core')).default
  const onServerless = process.platform === 'linux'

  if (onServerless) {
    const chromium = (await import('@sparticuz/chromium')).default
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true })
  }
  const exe = localChromePath()
  if (!exe) throw new Error('No local Chrome found — set PUPPETEER_EXECUTABLE_PATH')
  return puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
}

// Module-scoped browser cache. On Vercel Fluid, module scope survives across
// invocations of a warm instance, so reusing one Chromium saves the ~1-2s
// launch per PDF. The browser is SHARED across concurrent invocations (pages
// are independent); pages are per-request and always closed, the browser is
// never closed on the success path. Caching the promise (not the browser)
// makes concurrent cold-start callers share a single launch.
let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const b = await browserPromise
      if (b.connected) return b
    } catch { /* previous launch failed — fall through to relaunch */ }
    browserPromise = null
  }
  browserPromise = launchBrowser()
  return browserPromise
}

export async function htmlToPdfBuffer(
  html: string,
  opts: {
    format?: 'letter' | 'a4'
    headerTemplate?: string
    footerTemplate?: string
    margin?: { top?: string; bottom?: string; left?: string; right?: string }
  } = {},
): Promise<Buffer> {
  const renderWith = async (browser: Browser): Promise<Buffer> => {
    const page = await browser.newPage()
    try {
      await page.setContent(html, { waitUntil: 'load' })
      const hasChrome = !!(opts.headerTemplate || opts.footerTemplate)
      const pdf = await page.pdf({
        format: opts.format || 'letter',
        printBackground: true,
        displayHeaderFooter: hasChrome,
        ...(hasChrome ? { headerTemplate: opts.headerTemplate || '<span></span>', footerTemplate: opts.footerTemplate || '<span></span>' } : {}),
        margin: opts.margin || { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
      })
      return Buffer.from(pdf)
    } finally {
      await page.close().catch(() => {})
    }
  }

  const attempt = async (): Promise<Buffer> => {
    const browser = await getBrowser()
    const cached = browserPromise
    try {
      return await renderWith(browser)
    } catch (err) {
      // Page-level failure — this browser may be wedged. Invalidate the cache
      // (only if it still points at the browser we used — a concurrent caller
      // may already have relaunched) and close the suspect in the background.
      if (browserPromise === cached) browserPromise = null
      void browser.close().catch(() => {})
      throw err
    }
  }

  try {
    return await attempt()
  } catch {
    return attempt() // retry ONCE with a fresh browser
  }
}
