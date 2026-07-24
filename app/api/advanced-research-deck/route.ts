// GET /api/advanced-research-deck?client=<name> — the reusable, client-agnostic
// "Four Advanced Research Capabilities" capability overview (Conversational
// Surveys · Town Hall · PulseIQ · Analytics). Fixed content; an optional ?client=
// name is injected on the cover + footer only. Admin-gated like every deck route.

import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildAdvancedResearchDeck } from '@/lib/pptx/advancedResearchDeck'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const denied = await requireAdmin()
  if (denied) return denied

  const client = new URL(request.url).searchParams.get('client')
  await logDeckDownload('advanced-research-deck', client || undefined)

  const pptx = new PptxGenJS()
  await buildAdvancedResearchDeck(pptx, { client })
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="Sentimetrx-Advanced-Research-Capabilities.pptx"',
    },
  })
}
