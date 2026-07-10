// GET /api/nepa-comment-deck — "Hearing the Blue Mountains": a Datanautix
// capability briefing for the USDA Forest Service on turning the NEPA public-
// comment period into a real-time objection-risk read. Anchored to the live
// Blue Mountains Forest Plan Revision. Admin-gated like every deck route.

import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildBlueMountainsNepaDeck } from '@/lib/pptx/blueMountainsNepaDeck'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  await logDeckDownload('nepa-comment-deck')

  const pptx = new PptxGenJS()
  buildBlueMountainsNepaDeck(pptx)
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="Datanautix-Blue-Mountains-NEPA.pptx"',
    },
  })
}
