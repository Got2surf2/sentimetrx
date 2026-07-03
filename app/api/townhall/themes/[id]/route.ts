import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

// POST /api/townhall/themes/:id/approve (or dismiss, pause, resume, close)
// Action is passed in the body: { action: 'approve' | 'dismiss' | 'pause' | 'resume' | 'close', response_target?, question? }
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve the caller's org + admin status. Every mutation below is gated to
  // the owning org (or a platform admin) — without this a logged-in user from
  // any org could moderate another tenant's town-hall topics by id.
  const { data: userData } = await supabase
    .from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org
  const callerOrg = (userData as any)?.org_id as string | null
  if (!callerOrg && !isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { action: string; response_target?: number; question?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action, response_target, question } = body

  const updates: Record<string, unknown> = {}

  switch (action) {
    case 'approve':
      updates.state = 'active'
      updates.approved_at = new Date().toISOString()
      if (response_target) updates.response_target = response_target
      if (question) updates.question = question
      break
    case 'park':
      updates.state = 'parked'
      break
    case 'dismiss':
      updates.state = 'dismissed'
      break
    case 'undismiss':
      updates.state = 'detected'
      break
    case 'reopen':
      updates.state = 'active'
      updates.completed_at = null
      if (response_target) updates.response_target = (response_target as number)
      break
    case 'pause':
      updates.state = 'paused'
      break
    case 'resume':
    case 'activate':
      updates.state = 'active'
      break
    case 'close':
      updates.state = 'completed'
      updates.completed_at = new Date().toISOString()
      break
    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const db = createServiceRoleClient()

  // Tranche 2 (docs/CONVERGENCE.md § 4.2): pulseiq_topics only — the legacy
  // townhall_themes fallback is retired. sql/082 extended the state CHECK to
  // the full legacy vocab, so the same `updates` object still applies.
  const { data: topic } = await db.from('pulseiq_topics').select('id, town_hall_id, org_id').eq('id', params.id).maybeSingle()
  if (!topic) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && (topic as any).org_id !== callerOrg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { data, error } = await db
    .from('pulseiq_topics')
    .update(updates)
    .eq('id', params.id)
    .eq('org_id', (topic as any).org_id)
    .select('*')
    .single()
  if (error) return serverError(error, 'townhall.themes.action', { orgId: (topic as any).org_id })
  return NextResponse.json(data)
}
