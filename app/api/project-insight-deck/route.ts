// GET /api/project-insight-deck — "Project Insight" PE teaser deck.
//
// A 10-slide first-conversation teaser for an AI-native consolidation of the
// organizational-feedback software market. Framing (Option B): survey/feedback
// software is the acquisition vehicle; the AI insight layer is the product.
// Numbers are qualitative by design — see lib/pptx/projectInsightDeck.ts.

import { NextResponse } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildProjectInsightDeck } from '@/lib/pptx/projectInsightDeck'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  await logDeckDownload('project-insight-deck')

  const pptx = new PptxGenJS()
  buildProjectInsightDeck(pptx)

  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  const uint8 = new Uint8Array(buffer)

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="Project-Insight-Teaser.pptx"',
    },
  })
}
