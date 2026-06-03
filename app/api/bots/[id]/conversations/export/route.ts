// app/api/bots/[id]/conversations/export/route.ts
// GET ?format=csv|xlsx — export all conversations for a bot.
//   ?shape=turns (default) — one row per turn (Session, Turn, Role, Content, …)
//   ?shape=pairs          — one row per Q&A pair (Question → Answer), the
//                           "list of every question/answer" export.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { dataResponse, parseExportFormat } from '@/lib/xlsxExport'
import { isPhase3ReadSafe } from '@/lib/phase3Read'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
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

  const { data: bot } = await service.from('agents').select('id, name, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== userOrgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let turns: { session_id: string; turn_number: number; role: string; content: string; language: string | null; created_at: string; source: string | null }[] | null = null
  if (isPhase3ReadSafe()) {
    const { data } = await service
      .from('conversation_turns')
      .select('turn_number, role, content, language, created_at, source, conversations!inner(session_id, bot_id)')
      .eq('conversations.bot_id', params.id)
      .order('turn_number', { ascending: true })
      .limit(5000)
    turns = (data || []).map((r: any) => ({
      session_id: r.conversations?.session_id,
      turn_number: r.turn_number,
      role: r.role,
      content: r.content,
      language: r.language,
      created_at: r.created_at,
      source: r.source,
    }))
  } else {
    const { data } = await service
      .from('bot_conversation_turns')
      .select('session_id, turn_number, role, content, language, created_at, source')
      .eq('bot_id', params.id)
      .order('session_id')
      .order('turn_number', { ascending: true })
      .limit(5000)
    turns = data
  }

  if (!turns || turns.length === 0) {
    return NextResponse.json({ error: 'No conversations to export' }, { status: 404 })
  }

  const format = parseExportFormat(req.nextUrl.searchParams.get('format'))
  const shape = req.nextUrl.searchParams.get('shape') === 'pairs' ? 'pairs' : 'turns'
  const clean = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim()

  if (shape === 'pairs') {
    // Pair each user question with the agent's next reply. Greeting-preamble
    // turns and the historical internal-prompt leak are skipped so the export is
    // a clean record of what people actually asked and how the agent answered.
    const isLeak = (t: string) => /^greet the user warmly\b/i.test((t || '').trim())
    const bySession = new Map<string, typeof turns>()
    for (const t of turns) {
      if (!bySession.has(t.session_id)) bySession.set(t.session_id, [])
      bySession.get(t.session_id)!.push(t)
    }
    const rows: (string | number | null)[][] = []
    let pairNo = 0
    for (const [sid, ts] of bySession) {
      ts.sort((a, b) => a.turn_number - b.turn_number)
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i]
        if (t.role !== 'user' || t.source === 'greeting' || isLeak(t.content)) continue
        let answer = ''
        for (let j = i + 1; j < ts.length; j++) { if (ts[j].role === 'assistant') { answer = clean(ts[j].content); break } }
        rows.push([++pairNo, sid, t.created_at, clean(t.content), answer, t.language])
      }
    }
    const fileBase = bot.name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') + '_QA_Pairs'
    return dataResponse(format, fileBase, [{
      name: 'Q&A Pairs',
      headers: ['#', 'Session ID', 'Timestamp', 'Question (user)', 'Answer (agent)', 'Language'],
      rows,
    }])
  }

  const fileBase = bot.name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') + '_Conversations'
  return dataResponse(format, fileBase, [{
    name: 'Conversations',
    headers: ['Session ID', 'Turn', 'Role', 'Content', 'Language', 'Timestamp'],
    rows: turns.map(t => [t.session_id, t.turn_number, t.role, (t.content || '').replace(/\n/g, ' '), t.language, t.created_at]),
  }]);
}
