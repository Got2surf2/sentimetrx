// app/api/datasets/[datasetId]/diligence-deck/route.ts
// GET — render the "Customer-Experience Diligence" deck as a Datanautix-branded
// PPTX: an independent acquirer's read of a multi-location brand from its Google
// reviews. Backed by the outlet predictor + lib/diligenceData, with an optional
// one-time live competitor benchmark (lib/competitorBenchmark). Org-scoped (the
// owning org or an admin), per the deck-export brand exception.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeOutletPredictor } from '@/lib/outletReport'
import { computeDiligenceData } from '@/lib/diligenceData'
import { computeCompetitorBenchmark } from '@/lib/competitorBenchmark'
import { buildDiligenceDeck, type DiligenceOpts } from '@/lib/pptx/diligenceDeck'
import { renderDeck } from '@/lib/pptx/slideRenderer'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest, props: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service.from('datasets').select('org_id, name').eq('id', datasetId).single()
  if (!ds) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && ds.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const predictor = await computeOutletPredictor(datasetId)
  if (!predictor.available || predictor.brandLevers.length === 0) {
    return NextResponse.json({ error: 'Not enough rated, themed reviews across outlets to build a plan.' }, { status: 400 })
  }

  const brand = ds.name || 'Brand'
  const dd = await computeDiligenceData(datasetId)

  const url = new URL(req.url)
  const competitorNames = (url.searchParams.get('competitors') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const franchiseStates = (url.searchParams.get('franchiseStates') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const preparedFor = url.searchParams.get('preparedFor')?.trim() || undefined

  const opts: DiligenceOpts = { franchiseStates, preparedFor }

  // Optional one-time live competitor benchmark. Never 500 the whole report if
  // the live pull fails — just ship the deck without the competitor slide.
  if (competitorNames.length) {
    try {
      const bench = await computeCompetitorBenchmark(brand, competitorNames, dd.topMarkets)
      if (bench.competitors.length) {
        opts.brandLifetime = bench.brandLifetime
        opts.competitors = bench.competitors
      }
    } catch (e) {
      console.warn('[diligence-deck] competitor benchmark pull failed; shipping without competitor slide:', e)
    }
  }

  const deck = buildDiligenceDeck(predictor, dd, brand, opts)
  const buffer = await renderDeck(deck, brand)
  const fileName = brand.replace(/[^a-z0-9]+/gi, '_') + '_CustomerExperience_Diligence.pptx'

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
