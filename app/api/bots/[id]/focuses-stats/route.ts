// app/api/bots/[id]/focuses-stats/route.ts
// GET — returns detection counts and recent detections for each configured focus.
// Mirror of intents-stats, but scoped to assistant turns (since focus tagging
// happens on the bot reply, not the user message).

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { isPhase3ReadSafe } from '@/lib/phase3Read'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org

  const service = createServiceRoleClient()

  // Service-role read pairs id with org_id when not admin.
  const { data: bot } = await service.from('bots').select('id, org_id, focuses').eq('id', params.id).single()
  if (!bot || (!isAdmin && bot.org_id !== userData.org_id)) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })

  const focuses: any[] = bot.focuses || []
  if (focuses.length === 0) return NextResponse.json({ focuses: [] })

  // Query assistant turns with focus flags for this bot. READ_PHASE3 switches
  // to the new substrate via the conversations join.
  let flaggedTurns: { session_id: string; content_flags: unknown; created_at: string }[] | null = null
  if (isPhase3ReadSafe()) {
    const { data } = await service
      .from('conversation_turns')
      .select('content_flags, created_at, conversations!inner(session_id, bot_id)')
      .eq('conversations.bot_id', params.id)
      .eq('role', 'assistant')
      .not('content_flags', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2000)
    flaggedTurns = (data || []).map((r: any) => ({
      session_id: r.conversations?.session_id,
      content_flags: r.content_flags,
      created_at: r.created_at,
    }))
  } else {
    const { data } = await service
      .from('bot_conversation_turns')
      .select('session_id, content_flags, created_at')
      .eq('bot_id', params.id)
      .eq('role', 'assistant')
      .not('content_flags', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2000)
    flaggedTurns = data
  }

  const stats = focuses.map(function(focus: any) {
    const flag = 'focus:' + String(focus.slug || '').toLowerCase()
    const detections: { session_id: string; created_at: string }[] = []
    const uniqueSessions = new Set<string>()

    if (flaggedTurns) {
      for (const t of flaggedTurns) {
        const flags = Array.isArray(t.content_flags) ? t.content_flags : []
        if (flags.includes(flag)) {
          detections.push({ session_id: t.session_id, created_at: t.created_at })
          uniqueSessions.add(t.session_id)
        }
      }
    }

    return {
      slug: focus.slug,
      label: focus.label,
      description: focus.description || '',
      enabled: focus.enabled !== false,
      detection_count: detections.length,
      session_count: uniqueSessions.size,
      last_detected: detections.length > 0 ? detections[0].created_at : null,
      recent_sessions: detections.slice(0, 5).map(function(d) { return d.session_id }),
    }
  })

  return NextResponse.json({ focuses: stats })
}
