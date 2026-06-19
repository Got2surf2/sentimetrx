// GET /api/pitch-deck-v3 — SHORT (9-slide core + appendix) warm-editorial deck,
// rendered HTML/CSS → PDF (16:9). The full 17-slide version is /api/pitch-deck-v2.
// Same render pipeline as pitch-deck-v2 / reportPdf.ts.

import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildPitchDeckV3Html } from '@/lib/decks/pitchDeckV3Html'

export const dynamic = 'force-dynamic'

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

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  await logDeckDownload('pitch-deck-v3')

  const html = buildPitchDeckV3Html()
  const puppeteer = (await import('puppeteer-core')).default
  const onServerless = process.platform === 'linux'

  let browser
  if (onServerless) {
    const chromium = (await import('@sparticuz/chromium')).default
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  } else {
    const exe = localChromePath()
    if (!exe) throw new Error('No local Chrome found — set PUPPETEER_EXECUTABLE_PATH')
    browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
  }

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluateHandle('document.fonts.ready')
    const pdf = await page.pdf({ width: '1280px', height: '720px', printBackground: true })
    return new NextResponse(new Uint8Array(Buffer.from(pdf)), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Sentimetrx-Anthology-Short.pdf"',
      },
    })
  } finally {
    await browser.close()
  }
}
