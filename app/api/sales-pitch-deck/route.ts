// GET /api/sales-pitch-deck?client=<slug> — the reusable Sentimetrx sales-pitch
// TEMPLATE (lib/pptx/salesPitchDeck). Renders a client's SalesPitchConfig; defaults
// to the Bareburger sample. Admin-gated like every deck route.

import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildSalesPitchDeck, SALES_PITCH_CONFIGS } from '@/lib/pptx/salesPitchDeck'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const denied = await requireAdmin()
  if (denied) return denied

  const slug = new URL(request.url).searchParams.get('client') || 'bareburger'
  const cfg = SALES_PITCH_CONFIGS[slug]
  if (!cfg) {
    return new Response(`Unknown client "${slug}". Known: ${Object.keys(SALES_PITCH_CONFIGS).join(', ')}`, { status: 404 })
  }
  await logDeckDownload('sales-pitch-deck', slug)

  const pptx = new PptxGenJS()
  await buildSalesPitchDeck(pptx, cfg)
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${cfg.filename}"`,
    },
  })
}
