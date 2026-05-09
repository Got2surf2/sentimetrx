// app/api/townhall/sessions/search/route.ts
// GET /api/townhall/sessions/search?q=<text>
//
// Searches across non-skipped townhall_turns content (user_message,
// user_message_en, bot_message) for the query and returns matching
// sessions with a hit count + a short snippet from the first match.
//
// Uses ILIKE — fine for the current data volumes (turns are small per
// session and total session count is moderate). If this scales we can
// move to a tsv index on townhall_turns later.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

interface MatchHit {
  session_id: string
  session_name: string
  hit_count: number
  snippet: string
  turn_id: string
}

export async function GET(req: Request) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const orgId = userData?.org_id
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim()
  if (!q) return NextResponse.json({ results: [], query: '' })
  if (q.length > 200) return NextResponse.json({ error: 'query too long' }, { status: 400 })

  const service = createServiceRoleClient()

  // Limit to this org's sessions
  const { data: orgSessions } = await service
    .from('townhall_sessions')
    .select('id, name')
    .eq('org_id', orgId)
  if (!orgSessions?.length) return NextResponse.json({ results: [], query: q })

  const sessionMap: Record<string, string> = {}
  for (const s of orgSessions as any[]) sessionMap[s.id] = s.name
  const sessionIds = Object.keys(sessionMap)

  // Two layers of escaping:
  //  1. SQL ILIKE pattern metas (\, %, _) — so the user can't use them as wildcards.
  //  2. PostgREST or() value-quote — wrap the value in "..." so a comma or
  //     paren in the query can't break out of the OR expression and
  //     inject an extra filter clause.
  const sqlEscaped = q.replace(/[\\%_]/g, '\\$&')
  const orQuoted = sqlEscaped.replace(/[\\"]/g, '\\$&')
  const like = '"%' + orQuoted + '%"'

  // Pull matching turns. We OR across user_message, user_message_en, bot_message.
  const { data: turns, error } = await service
    .from('townhall_turns')
    .select('id, session_id, turn_number, bot_message, user_message, user_message_en, created_at')
    .in('session_id', sessionIds)
    .eq('skipped', false)
    .or('user_message.ilike.' + like + ',user_message_en.ilike.' + like + ',bot_message.ilike.' + like)
    .order('created_at', { ascending: true })
    .limit(2000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by session, keep first hit's snippet
  const bySession = new Map<string, { hits: number; firstTurn: any }>()
  for (const t of (turns || []) as any[]) {
    const cur = bySession.get(t.session_id)
    if (!cur) bySession.set(t.session_id, { hits: 1, firstTurn: t })
    else cur.hits++
  }

  const lower = q.toLowerCase()
  function snippet(text: string, max = 180): string {
    if (!text) return ''
    const idx = text.toLowerCase().indexOf(lower)
    if (idx === -1) return text.replace(/\s+/g, ' ').slice(0, max)
    const start = Math.max(0, idx - 60)
    const end = Math.min(text.length, idx + q.length + 100)
    return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '')
  }

  const results: MatchHit[] = Array.from(bySession.entries()).map(([sid, v]) => {
    const t = v.firstTurn
    const matchText = ((t.user_message_en && t.user_message_en.toLowerCase().includes(lower)) ? t.user_message_en
      : (t.user_message && t.user_message.toLowerCase().includes(lower)) ? t.user_message
      : t.bot_message)
    return {
      session_id: sid,
      session_name: sessionMap[sid],
      hit_count: v.hits,
      snippet: snippet(String(matchText || '')),
      turn_id: t.id,
    }
  }).sort((a, b) => b.hit_count - a.hit_count)

  return NextResponse.json({ results, query: q })
}
