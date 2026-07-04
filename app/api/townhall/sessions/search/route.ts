// app/api/townhall/sessions/search/route.ts
// GET /api/townhall/sessions/search?q=<text>
//
// Searches conversation content across the org's PulseIQ sessions
// (content + content_en on conversation_turns, both roles) and returns
// matching sessions with a hit count + a short snippet from the first match.
//
// Tranche 2 (docs/CONVERGENCE.md § 4.2): reads the new substrate —
// pulseiq_sessions → pulseiq_session_conversations → conversation_turns.
// Bracketed transcript markers ([Skipped …], [filtered], [Language switch …])
// are excluded from results the same way legacy excluded skipped=true turns.
//
// Uses ILIKE — fine for the current data volumes (turns are small per
// session and total session count is moderate). If this scales we can
// move to a tsv index on conversation_turns later.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/townHallAdapter'

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
  const supabase = await createClient()
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
  const { data: orgHalls } = await service
    .from('pulseiq_sessions')
    .select('id, name')
    .eq('org_id', orgId)
  if (!orgHalls?.length) return NextResponse.json({ results: [], query: q })

  const sessionMap: Record<string, string> = {}
  for (const s of orgHalls as { id: string; name: string }[]) sessionMap[s.id] = s.name
  const hallIds = Object.keys(sessionMap)

  // Two layers of escaping:
  //  1. SQL ILIKE pattern metas (\, %, _) — so the user can't use them as wildcards.
  //  2. PostgREST or() value-quote — wrap the value in "..." so a comma or
  //     paren in the query can't break out of the OR expression and
  //     inject an extra filter clause.
  const sqlEscaped = q.replace(/[\\%_]/g, '\\$&')
  const orQuoted = sqlEscaped.replace(/[\\"]/g, '\\$&')
  const like = '"%' + orQuoted + '%"'

  // Pull matching turns. We OR across content and content_en (covers user
  // and bot messages — role distinguishes them in the new schema). Turns are
  // grouped by their stamped town_hall_id — the old conversation-id hop via
  // pulseiq_session_conversations broke at a few hundred participants on URL
  // length. Paged up to a 2000-hit result bound (a single select truncates
  // at 1000).
  const turns = await fetchAllRows<{ id: string; town_hall_id: string; role: string; content: string | null; content_en: string | null; created_at: string }>((from, to) => service
    .from('conversation_turns')
    .select('id, town_hall_id, role, content, content_en, created_at')
    .in('town_hall_id', hallIds)
    .eq('org_id', orgId)
    .or('content.ilike.' + like + ',content_en.ilike.' + like)
    .order('created_at', { ascending: true })
    .range(from, to), 2000)

  type TurnHit = { id: string; town_hall_id: string; role: string; content: string | null; content_en: string | null; created_at: string }

  // Exclude bracketed transcript markers (skip/filter/language-switch rows).
  const isMarker = (t: TurnHit) => /^\[(Skipped|filtered|Language switch)/i.test(String(t.content || ''))

  // Group by session, keep first hit's snippet
  const bySession = new Map<string, { hits: number; firstTurn: TurnHit }>()
  for (const t of turns as TurnHit[]) {
    if (isMarker(t)) continue
    const hallId = t.town_hall_id
    if (!hallId) continue
    const cur = bySession.get(hallId)
    if (!cur) bySession.set(hallId, { hits: 1, firstTurn: t })
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
    const matchText = ((t.content_en && t.content_en.toLowerCase().includes(lower)) ? t.content_en
      : (t.content && t.content.toLowerCase().includes(lower)) ? t.content
      : t.content_en || t.content)
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
