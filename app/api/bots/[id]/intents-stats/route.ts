// app/api/bots/[id]/intents-stats/route.ts
// GET — returns detection counts and recent detections for each configured intent

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

  // Load bot + verify ownership (admin-org bypass)
  const { data: bot } = await service.from('agents').select('id, org_id, intents').eq('id', params.id).single()
  if (!bot || (!isAdmin && bot.org_id !== userData.org_id)) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })

  const intents: any[] = bot.intents || []
  if (intents.length === 0) return NextResponse.json({ intents: [] })

  // Query all turns with intent flags for this bot. READ_PHASE3 switches to
  // the new substrate via the conversations join; downstream code only reads
  // session_id, content_flags, created_at — both paths feed those.
  let flaggedTurns: { session_id: string; content_flags: unknown; created_at: string }[] | null = null
  if (isPhase3ReadSafe()) {
    const { data } = await service
      .from('conversation_turns')
      .select('content_flags, created_at, conversations!inner(session_id, bot_id)')
      .eq('conversations.bot_id', params.id)
      .eq('role', 'user')
      .not('content_flags', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1000)
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
      .eq('role', 'user')
      .not('content_flags', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1000)
    flaggedTurns = data
  }

  // Build stats per intent
  const stats = intents.map(function(intent: any) {
    var flag = 'intent:' + (intent.label || '').toLowerCase().replace(/\s+/g, '_')
    var detections: { session_id: string; created_at: string }[] = []

    if (flaggedTurns) {
      for (var t of flaggedTurns) {
        var flags = Array.isArray(t.content_flags) ? t.content_flags : []
        if (flags.includes(flag)) {
          detections.push({ session_id: t.session_id, created_at: t.created_at })
        }
      }
    }

    return {
      label: intent.label,
      description: intent.description || '',
      keywords: intent.keywords || [],
      url: intent.url || '',
      message: intent.message || '',
      enabled: intent.enabled !== false,
      detection_count: detections.length,
      last_detected: detections.length > 0 ? detections[0].created_at : null,
      recent_sessions: detections.slice(0, 5).map(function(d) { return d.session_id }),
    }
  })

  return NextResponse.json({ intents: stats })
}
