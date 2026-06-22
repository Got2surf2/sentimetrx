// app/api/datasets/[datasetId]/improvement-plan-deck/route.ts
// GET — render the brand Guest Experience Improvement Plan as a Datanautix-
// branded PPTX (the leave-behind for the /improvement-plan page). Same predictor
// object backs both. Org-scoped (the owning org or an admin), per the deck-
// export brand exception.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeOutletPredictor } from '@/lib/outletReport'
import { buildImprovementPlanDeck } from '@/lib/pptx/improvementPlanDeck'
import { renderDeck } from '@/lib/pptx/slideRenderer'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(_req: NextRequest, props: { params: Promise<{ datasetId: string }> }) {
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
  const deck = buildImprovementPlanDeck(predictor, brand)
  const buffer = await renderDeck(deck, brand)
  const fileName = brand.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') + '_Guest_Experience_Plan.pptx'

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
