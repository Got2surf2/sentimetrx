// GET /api/ea-membership-deck — Sentimetrx conversational-membership-research capability
// deck, prepared for the EA meeting. Sentimetrx-forward; admin-gated like every deck route.

import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildEaMembershipDeck } from '@/lib/pptx/eaMembershipDeck'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  await logDeckDownload('ea-membership-deck')

  const pptx = new PptxGenJS()
  buildEaMembershipDeck(pptx)
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="Sentimetrx-EA-Membership-Research.pptx"',
    },
  })
}
