// GET /api/pitch-deck-v2 — warm-editorial Sentimetrx investor deck, rendered
// HTML/CSS → PDF (16:9) with headless Chrome.
//
// Deliberately NOT pptxgenjs: this is the design-forward variant that matches
// datanautix.com's look (Fraunces serif + DM Sans, warm paper canvas, Ana
// orange + Sarina teal accents, editorial layouts built from typographic lists
// and hairline rules rather than colored chip-grids). The classic editable
// pptx lives at /api/pitch-deck; this is the polished PDF to attach/share.
// Markup lives in lib/decks/pitchDeckV2Html.ts (mirrors reportHtml/reportPdf).
//
// Chrome resolution mirrors lib/recordings/reportPdf.ts: @sparticuz/chromium on
// the Linux serverless runtime, an installed Chrome locally (key off
// process.platform, NOT process.env.VERCEL — .env.local sets VERCEL=1).

import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildPitchDeckV2Html } from '@/lib/decks/pitchDeckV2Html'

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
  await logDeckDownload('pitch-deck-v2')

  const html = buildPitchDeckV2Html()
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
    // 'load' resolves the Google-Fonts stylesheet; fonts.ready then waits for the
    // actual Fraunces / DM Sans files to finish before we print.
    await page.evaluateHandle('document.fonts.ready')
    const pdf = await page.pdf({ width: '1280px', height: '720px', printBackground: true })
    return new NextResponse(new Uint8Array(Buffer.from(pdf)), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Sentimetrx-Pitch-Deck.pdf"',
      },
    })
  } finally {
    await browser.close()
  }
}
