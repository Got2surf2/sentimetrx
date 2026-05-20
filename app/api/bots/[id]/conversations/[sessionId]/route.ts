// app/api/bots/[id]/conversations/[sessionId]/route.ts
// GET — get all turns for a specific conversation session
// DELETE — delete all turns for a session + associated persona
// Admin-org members can read/delete across orgs (Phase E parity).

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: { id: string; sessionId: string } }

async function gateBotAccess(userId: string, botId: string): Promise<{ ok: true; service: ReturnType<typeof createServiceRoleClient> } | { ok: false; status: number; error: string }> {
  const service = createServiceRoleClient()
  const { data: userData } = await service
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', userId)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org : (orgRel as any)?.is_admin_org
  const userOrgId = (userData as any)?.org_id as string | null

  const { data: bot } = await service.from('bots').select('id, org_id').eq('id', botId).single()
  if (!bot) return { ok: false, status: 404, error: 'Bot not found' }
  if (!isAdmin && bot.org_id !== userOrgId) return { ok: false, status: 403, error: 'Forbidden' }
  return { ok: true, service }
}

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await gateBotAccess(user.id, params.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { data: turns, error } = await gate.service
    .from('bot_conversation_turns')
    .select('id, turn_number, role, content, content_en, language, created_at, content_flags, source, sentiment, sentiment_score')
    .eq('bot_id', params.id)
    .eq('session_id', params.sessionId)
    .order('turn_number', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ turns: turns || [] })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await gateBotAccess(user.id, params.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { error } = await gate.service
    .from('bot_conversation_turns')
    .delete()
    .eq('bot_id', params.id)
    .eq('session_id', params.sessionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await gate.service
    .from('bot_session_personas')
    .delete()
    .eq('bot_id', params.id)
    .eq('session_id', params.sessionId)

  return NextResponse.json({ deleted: true })
}
