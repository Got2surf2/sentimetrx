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

export async function htmlToPdfBuffer(
  html: string,
  opts: {
    format?: 'letter' | 'a4'
    headerTemplate?: string
    footerTemplate?: string
    margin?: { top?: string; bottom?: string; left?: string; right?: string }
  } = {},
): Promise<Buffer> {
  const puppeteer = (await import('puppeteer-core')).default
  const onServerless = process.platform === 'linux'

  let browser
  if (onServerless) {
    const chromium = (await import('@sparticuz/chromium')).default
    browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true })
  } else {
    const exe = localChromePath()
    if (!exe) throw new Error('No local Chrome found — set PUPPETEER_EXECUTABLE_PATH')
    browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
  }

  try {
    const page = await browser.newPage()
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
    await browser.close()
  }
}
