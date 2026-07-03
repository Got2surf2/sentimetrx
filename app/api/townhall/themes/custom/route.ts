import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

// POST /api/townhall/themes/custom — facilitator pushes a custom question
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve the caller's org + admin status. The insert below is gated to the
  // owning org (or a platform admin) — without this a logged-in user from any
  // org could push a custom question into another tenant's town hall by id.
  const { data: userData } = await supabase
    .from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org
  const callerOrg = (userData as any)?.org_id as string | null
  if (!callerOrg && !isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { session_id: string; label: string; question: string; response_target?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { session_id, label, question, response_target } = body
  if (!session_id || !label || !question) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const db = createServiceRoleClient()

  // Tranche 2 (docs/CONVERGENCE.md § 4.2): pulseiq_topics insert only — the
  // legacy townhall_themes fallback is retired. Map 'custom' source →
  // 'manual' (the value town_hall_topics_source_check accepts).
  const { data: hall } = await db.from('pulseiq_sessions').select('id, org_id').eq('id', session_id).maybeSingle()
  if (!hall) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && (hall as any).org_id !== callerOrg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { data, error } = await db
    .from('pulseiq_topics')
    .insert({
      town_hall_id: (hall as any).id,
      org_id:       (hall as any).org_id,
      label,
      description: null,
      question,
      state: 'active',
      source: 'manual',
      response_target: response_target || 30,
      approved_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error) return serverError(error, 'townhall.themes.custom', { orgId: (hall as any).org_id })
  return NextResponse.json(data, { status: 201 })
}
