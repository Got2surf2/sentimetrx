// GET /api/nepa-cara-deck — "If We Built CARA Today": a Datanautix capability
// briefing on reimagining the federal NEPA comment-analysis stack (CARA for the
// Forest Service, PEPC for the Park Service / DOI), worked live on the Blue
// Mountains comment record — including the open-questions layer and a measured
// answerability test against the deployed Blue Mountains assistant. Admin-gated
// like every deck route.

import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildNepaCaraReimaginedDeck } from '@/lib/pptx/nepaCaraReimaginedDeck'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  await logDeckDownload('nepa-cara-deck')

  const pptx = new PptxGenJS()
  buildNepaCaraReimaginedDeck(pptx)
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="Datanautix-If-We-Built-CARA-Today.pptx"',
    },
  })
}
