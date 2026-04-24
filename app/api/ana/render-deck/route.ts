// app/api/ana/render-deck/route.ts
// POST — render a deck from Ana's slide specs and return PPTX binary

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { renderDeck } from '@/lib/pptx/slideRenderer'
import type { DeckSpec } from '@/lib/pptx/slideRenderer'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { deck, datasetName } = body as { deck: DeckSpec; datasetName: string }

  if (!deck || !deck.slides || deck.slides.length === 0) {
    return NextResponse.json({ error: 'No slides provided' }, { status: 400 })
  }

  try {
    const buffer = await renderDeck(deck, datasetName || 'Report')
    const safeName = (datasetName || 'report').replace(/[^a-z0-9]/gi, '_').slice(0, 40)
    const filename = safeName + '_ana_' + new Date().toISOString().slice(0, 10) + '.pptx'

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="' + filename + '"',
        'Content-Length': String(buffer.length),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Render failed: ' + (err?.message || String(err)) }, { status: 500 })
  }
}
