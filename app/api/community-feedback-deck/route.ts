// GET /api/community-feedback-deck — "Gathering Community Feedback: A New
// Approach" capability deck, rendered HTML/CSS → PDF (16:9). Same render
// pipeline as the other warm-editorial PDF decks (reportPdf.ts).

import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildCommunityFeedbackHtml } from '@/lib/decks/communityFeedbackHtml'

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
  await logDeckDownload('community-feedback-deck')

  const html = buildCommunityFeedbackHtml()
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
        'Content-Disposition': 'attachment; filename="Gathering-Community-Feedback.pdf"',
      },
    })
  } finally {
    await browser.close()
  }
}
