import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

// POST /api/townhall/sessions/[id]/round — round-based pacing: advance the room
// to round N. Completes any still-active earlier-round guide themes (so the
// topic picker stops serving them and participants hold between rounds) and
// activates round N's themes from their initial 'paused' seed. Re-posting the
// same N just re-asserts that state.
//
// Tranche 2 (docs/CONVERGENCE.md § 4.2): operates on pulseiq_sessions +
// pulseiq_topics. Vocabulary note: legacy source='guide' = new source='seed'
// (CHECK-enforced on pulseiq_topics).
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org
  const callerOrg = (userData as any)?.org_id as string | null
  if (!callerOrg && !isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { round?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const round = Number(body.round)
  if (!Number.isInteger(round) || round < 1) {
    return NextResponse.json({ error: 'round must be a positive integer' }, { status: 400 })
  }

  const db = createServiceRoleClient()
  const { data: session } = await db
    .from('pulseiq_sessions').select('org_id').eq('id', params.id).maybeSingle()
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const sessionOrgId = (session as { org_id: string }).org_id
  if (!isAdmin && sessionOrgId !== callerOrg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const nowIso = new Date().toISOString()

  // Complete any still-active earlier-round seed topics. The topic picker only
  // serves 'active' topics, so completing the prior round is what holds
  // participants until they're routed into round N.
  await db.from('pulseiq_topics')
    .update({ state: 'completed', completed_at: nowIso })
    .eq('town_hall_id', params.id)
    .eq('org_id', sessionOrgId)
    .eq('source', 'seed')
    .eq('state', 'active')
    .not('round_number', 'is', null)
    .lt('round_number', round)

  // Activate this round's topics (from their 'paused' seed).
  const { data: activated, error } = await db.from('pulseiq_topics')
    .update({ state: 'active', completed_at: null })
    .eq('town_hall_id', params.id)
    .eq('org_id', sessionOrgId)
    .eq('source', 'seed')
    .eq('round_number', round)
    .select('id')
  if (error) return serverError(error, 'townhall.sessions.round', { orgId: sessionOrgId })

  return NextResponse.json({ success: true, round, activated: (activated || []).length })
}
