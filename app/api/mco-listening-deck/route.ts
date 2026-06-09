// GET /api/mco-listening-deck
// "Listening to Your Guests" — guest-experience intelligence teaser for
// Orlando International Airport (MCO). High-level leave-behind that recaps the
// 2015–2020 engagement and outlines a path forward (continuous voice-of-guest
// analytics, peer benchmarking, and the agentic MCO Concierge prototype).
// Admin-only, Datanautix-branded.

import { NextResponse } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildMcoListeningDeck } from '@/lib/pptx/mcoListeningDeck'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  await logDeckDownload('mco-listening-deck')

  const pptx = new PptxGenJS()
  buildMcoListeningDeck(pptx)

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="MCO-Listening-To-Your-Guests.pptx"',
    },
  })
}
