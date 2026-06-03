// GET /api/review-intelligence-deck — the restaurant taxonomy classifier story.
// ?mode=full|alerts|capability (default full) · ?client=<name> (full/alerts).
// Datanautix-branded deliverable; admin-gated + download-logged.

import { NextResponse, type NextRequest } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildReviewIntelligenceDeck, type DeckMode } from '@/lib/pptx/reviewIntelligenceDeck'

export const dynamic = 'force-dynamic'

const MODES: DeckMode[] = ['full', 'alerts', 'capability']

export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(req.url)
  const modeParam = (url.searchParams.get('mode') || 'full').toLowerCase()
  const mode: DeckMode = (MODES as string[]).includes(modeParam) ? (modeParam as DeckMode) : 'full'
  const clientName = url.searchParams.get('client') || 'Ruth’s Chris'

  await logDeckDownload('review-intelligence-deck', mode)

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = `Datanautix — Review Intelligence (${mode})`

  buildReviewIntelligenceDeck(pptx, mode, clientName)

  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  const slug = mode === 'capability' ? 'Capability' : mode === 'alerts' ? 'Alert-Quality' : 'Full'
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="Datanautix-Review-Intelligence-${slug}.pptx"`,
    },
  })
}
