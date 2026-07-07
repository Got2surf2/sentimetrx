// app/api/bots/[id]/study/pdf/route.ts
// POST — server-rendered PDF of the Agent Study report. Renders the same baked
// HTML the share link uses (renderAgentStudyHtml) with headless Chrome's
// page.pdf(), so the download is pixel-faithful to the report — NOT a browser
// print. The print stylesheet in the baked HTML strips every <details> body, so
// the PDF is a flat summary with no conversation drill-downs.
//
// Chrome resolution: on Vercel/Lambda we use @sparticuz/chromium (a Linux
// chromium packaged for serverless); locally we point at an installed Chrome.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { getAgentStudy } from '@/lib/agentStudy'
import { renderAgentStudyHtml } from '@/lib/agentStudyHtml'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Common Chrome/Chromium locations for local dev (macOS + Linux).
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

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: botId } = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('org_id, name').eq('id', botId).single()
  if (!bot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const study = await getAgentStudy(botId)
  if (!study) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const html = renderAgentStudyHtml(study)

  const puppeteer = (await import('puppeteer-core')).default
  // @sparticuz/chromium ships a LINUX chromium binary and only runs on the
  // Linux serverless runtime. Key off the OS, NOT process.env.VERCEL — .env.local
  // sets VERCEL=1 to mimic prod, which would otherwise make local dev try to
  // exec the Linux binary on macOS (spawn ENOEXEC). On Linux (Vercel) use
  // @sparticuz; on macOS/Windows dev use an installed Chrome.
  const onServerless = process.platform === 'linux'

  let browser
  try {
    if (onServerless) {
      const chromium = (await import('@sparticuz/chromium')).default
      browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      })
    } else {
      const exe = localChromePath()
      if (!exe) return NextResponse.json({ error: 'No local Chrome found — set PUPPETEER_EXECUTABLE_PATH' }, { status: 500 })
      browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
    }
  } catch (e: unknown) {
    console.error({ at: 'study-pdf', msg: 'launch failed', err: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'PDF engine failed to start' }, { status: 500 })
  }

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } })
    const fileName = (bot.name || 'Agent').replace(/[^\w.-]+/g, '_') + '_Agent_Study.pdf'
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: unknown) {
    console.error({ at: 'study-pdf', msg: 'render failed', err: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  } finally {
    await browser.close()
  }
}
