// app/api/bots/[id]/conversations/export/route.ts
// GET ?format=csv|xlsx — export all conversations for a bot

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { dataResponse, parseExportFormat } from '@/lib/xlsxExport'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: userData } = await service
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org : (orgRel as any)?.is_admin_org
  const userOrgId = (userData as any)?.org_id as string | null

  const { data: bot } = await service.from('bots').select('id, name, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== userOrgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: turns } = await service
    .from('bot_conversation_turns')
    .select('session_id, turn_number, role, content, language, created_at')
    .eq('bot_id', params.id)
    .order('session_id')
    .order('turn_number', { ascending: true })
    .limit(5000)

  if (!turns || turns.length === 0) {
    return NextResponse.json({ error: 'No conversations to export' }, { status: 404 })
  }

  const format = parseExportFormat(req.nextUrl.searchParams.get('format'))
  const fileBase = bot.name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') + '_Conversations'

  return dataResponse(format, fileBase, [{
    name: 'Conversations',
    headers: ['Session ID', 'Turn', 'Role', 'Content', 'Language', 'Timestamp'],
    rows: turns.map(t => [t.session_id, t.turn_number, t.role, (t.content || '').replace(/\n/g, ' '), t.language, t.created_at]),
  }])
}
