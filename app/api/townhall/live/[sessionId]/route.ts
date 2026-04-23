// app/api/townhall/live/[sessionId]/route.ts
// GET — Public endpoint for live presenter screen. No auth required.
// Returns ONLY aggregate data — no PII, no individual responses.

import { NextResponse, NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { buildKwRegex, lexiconScore } from '@/lib/themeUtils'
import { bleepText } from '@/lib/contentGuard'

export const dynamic = 'force-dynamic'

function classifySentiment(pos: number, neg: number): string {
  if (pos === 0 && neg === 0) return 'neutral'
  if (pos > neg * 2) return 'positive'
  if (neg > pos * 2) return 'negative'
  return 'mixed'
}

export async function GET(_req: NextRequest, { params }: { params: { sessionId: string } }) {
  const db = createServiceRoleClient()

  // Fetch session (only non-sensitive fields)
  const { data: session } = await db
    .from('townhall_sessions')
    .select('id, name, slug, status, config, started_at, ended_at, response_counter')
    .eq('id', params.sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const config = session.config as any

  // Fetch themes
  const { data: themes } = await db
    .from('townhall_themes')
    .select('id, label, description, state, source, response_target, response_count, mention_count, keywords, sentiment, example_quote, sort_order')
    .eq('session_id', params.sessionId)
    .order('sort_order', { ascending: true })

  // Fetch turn stats (aggregate only)
  const { data: turns } = await db
    .from('townhall_turns')
    .select('participant_id, skipped, user_message_en, user_message, created_at')
    .eq('session_id', params.sessionId)

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

  // Compute live response_count per theme from turns
  const { data: turnCountRows } = await db
    .from('townhall_turns')
    .select('theme_id')
    .eq('session_id', params.sessionId)
    .not('user_message', 'is', null)
    .eq('skipped', false)
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

  return NextResponse.json({
    session: {
      id: session.id,
      name: session.name,
      slug: session.slug,
      status: session.status,
      bot_name: config?.bot_name || 'Town Hall',
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
    themes: enrichedThemes.filter(t => t.state !== 'dismissed' && t.state !== 'detected'),
    timeline,
  })
}
