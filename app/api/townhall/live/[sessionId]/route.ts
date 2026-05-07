// app/api/townhall/live/[sessionId]/route.ts
// GET — Public endpoint for live presenter screen. No auth required.
// Returns ONLY aggregate data — no PII, no individual responses.

import { NextResponse, NextRequest } from 'next/server'
import { buildKwRegex, lexiconScore } from '@/lib/themeUtils'
import { bleepText } from '@/lib/contentGuard'

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

export async function GET(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const debug = req.nextUrl.searchParams.get('debug') === '1'
  const sid = encodeURIComponent(params.sessionId)

  // Fetch session — raw PostgREST, no Supabase JS in the hot path
  const sessions = await pgrest<any[]>(
    'townhall_sessions?id=eq.' + sid +
    '&select=id,name,slug,status,config,started_at,ended_at,response_counter'
  )
  const session = sessions[0]
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

  // Diagnostic payload \u2014 request with ?debug=1 to inspect why a theme might not appear.
  const debugPayload = debug ? {
    resolved_session_id: session.id,
    resolved_session_name: session.name,
    request_param: params.sessionId,
    raw_themes_count: (themes || []).length,
    enriched_count: enrichedThemes.length,
    visible_count: visibleThemes.length,
    state_breakdown: (themes || []).reduce((acc: Record<string, number>, t: any) => {
      acc[t.state || 'null'] = (acc[t.state || 'null'] || 0) + 1
      return acc
    }, {}),
    active_themes: (themes || []).filter((t: any) => t.state === 'active').map((t: any) => ({ id: t.id, label: t.label, source: t.source })),
    all_themes: (themes || []).map((t: any) => ({ label: t.label, state: t.state, source: t.source })),
  } : undefined

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
    ...(debugPayload ? { _debug: debugPayload } : {}),
  }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
  })
}
