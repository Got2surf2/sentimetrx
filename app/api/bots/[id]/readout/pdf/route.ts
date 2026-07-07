// app/api/bots/[id]/readout/pdf/route.ts
// POST — server-rendered PDF of the Agent Conversation Readout. Renders the
// shared baked HTML (renderAgentReadoutHtml, drill-downs expanded for print)
// with headless Chrome's page.pdf(), so the download is pixel-faithful to the
// interactive page — NOT a browser print. Mirrors the Agent Study PDF route.
//
// Chrome resolution: on Vercel/Lambda (Linux) we use @sparticuz/chromium;
// locally we point at an installed Chrome. NOTE: this route needs its
// @sparticuz/chromium bin/** traced into the function bundle — see
// outputFileTracingIncludes in next.config.js (per-PDF-route, or prod 500s with
// "bin does not exist").

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { getAgentReadout } from '@/lib/agentReadout'
import { renderAgentReadoutHtml } from '@/lib/agentReadoutHtml'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

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
  for (const c of candidates) { if (existsSync(c)) return c }
  return null
}

function fileStem(title: string): string {
  return (title || 'Agent_Readout').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Agent_Readout'
}

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: botId } = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('org_id').eq('id', botId).single()
  if (!bot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const readout = await getAgentReadout(botId)
  if (!readout) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const html = renderAgentReadoutHtml(readout)

  const puppeteer = (await import('puppeteer-core')).default
  // Key off the OS, NOT process.env.VERCEL (.env.local sets VERCEL=1, which
  // would make local dev exec the Linux binary on macOS → spawn ENOEXEC).
  const onServerless = process.platform === 'linux'

  let browser
  try {
    if (onServerless) {
      const chromium = (await import('@sparticuz/chromium')).default
      browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true })
    } else {
      const exe = localChromePath()
      if (!exe) return NextResponse.json({ error: 'No local Chrome found — set PUPPETEER_EXECUTABLE_PATH' }, { status: 500 })
      browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
    }
  } catch (e: unknown) {
    console.error({ at: 'readout-pdf', msg: 'launch failed', err: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'PDF engine failed to start' }, { status: 500 })
  }

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } })
    const fileName = fileStem(readout.title) + '.pdf'
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: unknown) {
    console.error({ at: 'readout-pdf', msg: 'render failed', err: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  } finally {
    await browser.close()
  }
}
