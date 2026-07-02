// app/api/datasets/[datasetId]/outlet-plan-deck/route.ts
// GET ?outlet=<place_id> — render ONE outlet's GM action plan as a Datanautix-
// branded PPTX (the per-store leave-behind). Org-scoped, per the deck-export
// brand exception. Same predictor as the Action Plan tab + the brand deck.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeOutletPredictor } from '@/lib/outletReport'
import { buildOutletPlanDeck } from '@/lib/pptx/outletPlanDeck'
import { renderDeck } from '@/lib/pptx/slideRenderer'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest, props: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await props.params
  const outlet = new URL(req.url).searchParams.get('outlet')
  if (!outlet) return NextResponse.json({ error: 'Missing ?outlet=<place_id>' }, { status: 400 })

  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service.from('datasets').select('org_id, name').eq('id', datasetId).single()
  if (!ds) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && ds.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const predictor = await computeOutletPredictor(datasetId)
  const brand = ds.name || 'Brand'
  const deck = buildOutletPlanDeck(predictor, outlet, brand)
  if (!deck) return NextResponse.json({ error: 'No plan for that outlet (not enough rated, themed reviews).' }, { status: 400 })

  const buffer = await renderDeck(deck, brand)
  const loc = deck.title.split(' — ')[0].replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_')
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${loc}_GM_Action_Plan.pptx"`,
    },
  })
}
