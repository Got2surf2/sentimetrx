// GET /api/ea-nps-pitch-deck — "Beyond the Score" pitch to run EA's summer NPS
// program as a regret-vs-disappointment specific-emotion engine. Sentimetrx-forward;
// admin-gated like every deck route.

import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildEaNpsPitchDeck } from '@/lib/pptx/eaNpsPitchDeck'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  await logDeckDownload('ea-nps-pitch-deck')

  const pptx = new PptxGenJS()
  buildEaNpsPitchDeck(pptx)
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="Sentimetrx-EA-Beyond-The-Score.pptx"',
    },
  })
}
