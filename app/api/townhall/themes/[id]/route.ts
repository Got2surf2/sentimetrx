import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/townhall/themes/:id/approve (or dismiss, pause, resume, close)
// Action is passed in the body: { action: 'approve' | 'dismiss' | 'pause' | 'resume' | 'close', response_target?, question? }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
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

  const { data, error } = await db
    .from('townhall_themes')
    .update(updates)
    .eq('id', params.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
