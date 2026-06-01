import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/townhall/themes/:id/approve (or dismiss, pause, resume, close)
// Action is passed in the body: { action: 'approve' | 'dismiss' | 'pause' | 'resume' | 'close', response_target?, question? }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  // Phase-3 substrate first: if the id matches a town_hall_topics row,
  // mutate there. Otherwise fall through to the legacy townhall_themes
  // update. sql/082 extended town_hall_topics.state CHECK to accept the
  // full legacy vocab so the same `updates` object writes to both.
  const { data: topic } = await db.from('town_hall_topics').select('id, town_hall_id, org_id').eq('id', params.id).maybeSingle()
  if (topic) {
    const { data, error } = await db
      .from('town_hall_topics')
      .update(updates)
      .eq('id', params.id)
      .eq('org_id', (topic as any).org_id)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  const { data, error } = await db
    .from('townhall_themes')
    .update(updates)
    .eq('id', params.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
