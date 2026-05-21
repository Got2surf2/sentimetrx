// app/api/townhall/live/[sessionId]/route.ts
// GET — Public endpoint for live presenter screen. No auth required.
// Returns ONLY aggregate data — no PII, no individual responses.

import { NextResponse, NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { buildKwRegex, lexiconScore } from '@/lib/themeUtils'
import { bleepText } from '@/lib/contentGuard'
import { trendingTerms } from '@/lib/trendingWords'
import { resolveTownHall, projectHallAsSession } from '@/lib/townHallAdapter'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

// Direct PostgREST call with explicit cache: 'no-store' — bypasses any layer
// Supabase JS or Next.js could be caching internally. Critical for the live
// screen which polls and must reflect moderator changes within a single tick.
async function pgrest<T = any>(path: string): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  const res = await fetch(url + '/rest/v1/' + path, {
    cache: 'no-store',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Accept: 'application/json',
      Prefer: 'count=exact',
    },
  })
  if (!res.ok) throw new Error('PostgREST ' + res.status + ': ' + (await res.text()))
  return res.json() as Promise<T>
}

function classifySentiment(pos: number, neg: number): string {
  if (pos === 0 && neg === 0) return 'neutral'
  if (pos > neg * 2) return 'positive'
  if (neg > pos * 2) return 'negative'
  return 'mixed'
}

// Phase-3 live screen handler — pulls aggregate stats from
// town_halls + town_hall_topics + town_hall_conversations + conversations
// + conversation_turns. Returns the same JSON shape the legacy handler
// returns so /th/[sessionId]/live/page.tsx renders without conditional UI.
//
// Trending / keyword-frequency / per-topic example-quote enrichment is
// intentionally minimal — analytics rebuild on the new substrate is a
// separate commit; the presenter screen ships functional, not rich.
async function phase3Live(identifier: string): Promise<NextResponse> {
  const db = createServiceRoleClient() as any
  const hall = await resolveTownHall(db, identifier)
  if (!hall) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = projectHallAsSession(hall)
  const config = session.config as any

  // Topics — analogous to townhall_themes
  const { data: topics } = await db
    .from('town_hall_topics')
    .select('id, label, description, state, source, response_target, response_count, mention_count, keywords, example_quote, sort_order')
    .eq('town_hall_id', hall.id)
    .eq('org_id', hall.org_id)
    .order('sort_order', { ascending: true })

  // Conversations linked to the town hall
  const { data: linkRows } = await db
    .from('town_hall_conversations')
    .select('conversation_id, conversations!inner(id, session_id, participant_id, org_id)')
    .eq('town_hall_id', hall.id)
    .eq('org_id', hall.org_id)
    .limit(2000)
  const conversations = ((linkRows || []) as any[])
    .map(r => Array.isArray(r.conversations) ? r.conversations[0] : r.conversations)
    .filter(Boolean)
  const convIds = conversations.map(c => c.id)
  const participants = new Set(conversations.map(c => c.participant_id || c.session_id))

  // User turns for response count + sentiment
  let userTurns: any[] = []
  if (convIds.length > 0) {
    const { data } = await db
      .from('conversation_turns')
      .select('content, content_en, sentiment, topic_id, created_at')
      .in('conversation_id', convIds)
      .eq('role', 'user')
      .eq('org_id', hall.org_id)
      .limit(5000)
    userTurns = data || []
  }

  // Per-topic response counts from turn.topic_id
  const perTopicCount: Record<string, number> = {}
  for (const t of userTurns) {
    if (t.topic_id) perTopicCount[t.topic_id] = (perTopicCount[t.topic_id] || 0) + 1
  }

  const sentimentCounts: Record<string, number> = { positive: 0, negative: 0, mixed: 0, neutral: 0 }
  for (const t of userTurns) {
    const s = t.sentiment || 'neutral'
    sentimentCounts[s] = (sentimentCounts[s] || 0) + 1
  }

  const visibleThemes = (topics || [])
    .filter((t: any) => t.state !== 'rejected' && t.state !== 'pending')
    .map((t: any) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      state: t.state,
      source: t.source === 'auto_detected' ? 'auto_detected' : (t.source === 'manual' ? 'custom' : 'guide'),
      sentiment: 'neutral',
      response_count: perTopicCount[t.id] || t.response_count || 0,
      response_target: t.response_target,
      mention_count: t.mention_count || 0,
      percentage: userTurns.length > 0 ? Math.round(((perTopicCount[t.id] || 0) / userTurns.length) * 100) : 0,
      top_keywords: [] as { word: string; count: number }[],
      example_quote: t.example_quote,
    }))

  // Timeline bucketed by 5 min from started_at
  const timeline: { time: string; count: number }[] = []
  if (userTurns.length > 0 && hall.started_at) {
    const start = new Date(hall.started_at).getTime()
    const bucketMs = 5 * 60 * 1000
    const buckets: Record<number, number> = {}
    for (const t of userTurns) {
      const ts = new Date(t.created_at).getTime()
      const bucket = Math.floor((ts - start) / bucketMs) * bucketMs + start
      buckets[bucket] = (buckets[bucket] || 0) + 1
    }
    for (const [ts, count] of Object.entries(buckets).sort((a, b) => +a[0] - +b[0])) {
      timeline.push({ time: new Date(+ts).toISOString(), count })
    }
  }

  return NextResponse.json({
    session: {
      id: hall.id,
      name: hall.name,
      slug: hall.slug,
      status: session.status,                       // mapped legacy status
      bot_name: config?.bot_name || 'PulseIQ',
      bot_emoji: config?.bot_emoji || '💬',
      started_at: hall.started_at,
      ended_at: hall.ended_at,
    },
    stats: {
      participants: participants.size,
      responses: userTurns.length,
      total_turns: userTurns.length,                // user-turn count; no skip concept yet
      skipped: 0,
    },
    sentiment: sentimentCounts,
    themes: visibleThemes,
    timeline,
    trending: [],                                    // analytics rebuild deferred
  }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
  })
}

export async function GET(_req: NextRequest, { params }: { params: { sessionId: string } }) {
  const sid = encodeURIComponent(params.sessionId)

  // Phase-3 substrate fast path: if the identifier matches a town_halls
  // row (slug OR uuid), serve from the new substrate. Tried BEFORE the
  // legacy PostgREST lookup because a phase-3 slug isn't a valid uuid
  // and the legacy lookup would just 404 anyway.
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.sessionId)
  if (!isUUID) {
    const r = await phase3Live(params.sessionId)
    if (r.status !== 404) return r
  }

  // Fetch session — raw PostgREST, no Supabase JS in the hot path
  const sessions = await pgrest<any[]>(
    'townhall_sessions?id=eq.' + sid +
    '&select=id,name,slug,status,config,started_at,ended_at,response_counter'
  )
  const session = sessions[0]
  if (!session) {
    // Last resort for UUID-shaped phase-3 town halls (the slug branch
    // above only ran for non-UUIDs).
    if (isUUID) {
      const r = await phase3Live(params.sessionId)
      if (r.status !== 404) return r
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const config = session.config as any

  // Fetch themes — raw PostgREST
  const themes = await pgrest<any[]>(
    'townhall_themes?session_id=eq.' + sid +
    '&select=id,label,description,state,source,response_target,response_count,mention_count,keywords,sentiment,example_quote,sort_order' +
    '&order=sort_order.asc'
  )

  // Fetch turn stats (aggregate only) — raw PostgREST
  const turns = await pgrest<any[]>(
    'townhall_turns?session_id=eq.' + sid +
    '&select=participant_id,skipped,user_message_en,user_message,created_at'
  )

  const allTurns = turns || []
  const participants = new Set(allTurns.map(t => t.participant_id))
  const answered = allTurns.filter(t => !t.skipped && (t.user_message_en || t.user_message))

  // Compute overall sentiment from all responses
  let totalPos = 0, totalNeg = 0
  for (const t of answered) {
    const text = (t.user_message_en || t.user_message || '').trim()
    if (text) {
      const s = lexiconScore(text)
      totalPos += s.pos
      totalNeg += s.neg
    }
  }

  const sentimentCounts: Record<string, number> = { positive: 0, negative: 0, mixed: 0, neutral: 0 }
  for (const t of answered) {
    const text = (t.user_message_en || t.user_message || '').trim()
    if (text) {
      const s = lexiconScore(text)
      sentimentCounts[classifySentiment(s.pos, s.neg)]++
    }
  }

  // Compute live response_count per theme from turns — raw PostgREST
  const turnCountRows = await pgrest<any[]>(
    'townhall_turns?session_id=eq.' + sid +
    '&select=theme_id&user_message=not.is.null&skipped=eq.false'
  )
  const liveCounts: Record<string, number> = {}
  for (const r of turnCountRows || []) { if (r.theme_id) liveCounts[r.theme_id] = (liveCounts[r.theme_id] || 0) + 1 }

  // Per-theme enrichment (keyword matching for counts)
  const allTexts = answered.map(t => (t.user_message_en || t.user_message || '').trim()).filter(Boolean)
  const enrichedThemes = (themes || []).map(t => {
    const keywords: string[] = (t as any).keywords || []
    const regexes = keywords.slice(0, 15).map(kw => {
      try { return buildKwRegex(kw) } catch { return null }
    }).filter(Boolean) as RegExp[]

    let matchCount = 0
    const kwFreq: Record<string, number> = {}
    if (regexes.length > 0) {
      for (const text of allTexts) {
        const lower = text.toLowerCase()
        if (regexes.some(re => re.test(lower))) {
          matchCount++
          for (const kw of keywords) {
            try { if (buildKwRegex(kw).test(lower)) kwFreq[kw] = (kwFreq[kw] || 0) + 1 } catch {}
          }
        }
      }
    }

    const topKw = Object.entries(kwFreq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word, count]) => ({ word, count }))
    const pct = allTexts.length > 0 ? Math.round((matchCount / allTexts.length) * 100) : 0

    return {
      id: t.id,
      label: t.label,
      description: t.description,
      state: t.state,
      source: t.source,
      sentiment: t.sentiment || 'neutral',
      response_count: liveCounts[t.id] || 0,
      response_target: t.response_target,
      mention_count: matchCount || t.mention_count,
      percentage: pct,
      top_keywords: topKw,
      example_quote: t.example_quote,
    }
  })

  // Response timeline (bucketed by 5 min)
  const timeline: { time: string; count: number }[] = []
  if (answered.length > 0 && session.started_at) {
    const start = new Date(session.started_at).getTime()
    const bucketMs = 5 * 60 * 1000
    const buckets: Record<number, number> = {}
    for (const t of answered) {
      const ts = new Date(t.created_at).getTime()
      const bucket = Math.floor((ts - start) / bucketMs) * bucketMs + start
      buckets[bucket] = (buckets[bucket] || 0) + 1
    }
    for (const [ts, count] of Object.entries(buckets).sort((a, b) => +a[0] - +b[0])) {
      timeline.push({ time: new Date(+ts).toISOString(), count })
    }
  }

  const visibleThemes = enrichedThemes.filter(t => t.state !== 'dismissed' && t.state !== 'detected')

  // ── Trending Now: recent (last 5 min) vs whole session ─────────────
  // Surfaces emerging concerns on the live screen as the session unfolds.
  const fiveMinAgo = Date.now() - 5 * 60 * 1000
  const recentTexts: string[] = []
  const baselineTexts: string[] = []
  for (const t of answered) {
    const text = (t.user_message_en || t.user_message || '').trim()
    if (!text) continue
    const ts = new Date(t.created_at).getTime()
    if (ts >= fiveMinAgo) recentTexts.push(text)
    else baselineTexts.push(text)
  }
  const trending = trendingTerms(recentTexts, baselineTexts, { n: 8, minRecentCount: 2 })

  return NextResponse.json({
    session: {
      id: session.id,
      name: session.name,
      slug: session.slug,
      status: session.status,
      bot_name: config?.bot_name || 'PulseIQ',
      bot_emoji: config?.bot_emoji || '\uD83D\uDCAC',
      started_at: session.started_at,
      ended_at: session.ended_at,
    },
    stats: {
      participants: participants.size,
      responses: answered.length,
      total_turns: allTurns.length,
      skipped: allTurns.filter(t => t.skipped).length,
    },
    sentiment: sentimentCounts,
    themes: visibleThemes,
    timeline,
    trending,
  }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
  })
}
