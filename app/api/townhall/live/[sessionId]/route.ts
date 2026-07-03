// app/api/townhall/live/[sessionId]/route.ts
// GET — Public endpoint for live presenter screen. No auth required.
// Returns ONLY aggregate data — no PII, no individual responses.
//
// Tranche 2 (docs/CONVERGENCE.md § 4.2): serves entirely from the new
// substrate (pulseiq_sessions + pulseiq_topics + pulseiq_session_conversations
// → conversations → conversation_turns). The legacy townhall_* leg is
// retired, and the analytics the legacy leg computed (per-theme keyword
// matching, top keywords, trending terms, lexicon sentiment fallback,
// skip counting) are now computed here so the presenter screen keeps
// parity through the cutover.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { buildKwRegex, lexiconScore } from '@/lib/themeUtils'
import { trendingTerms } from '@/lib/trendingWords'
import { resolveTownHall, projectHallAsSession } from '@/lib/townHallAdapter'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

function classifySentiment(pos: number, neg: number): string {
  if (pos === 0 && neg === 0) return 'neutral'
  if (pos > neg * 2) return 'positive'
  if (neg > pos * 2) return 'negative'
  return 'mixed'
}

// Bracketed transcript markers ([Skipped …], [filtered], [Language switch …])
// are stored as user turns on the unified path — they are not answers.
const SKIP_MARKER = /^\[Skipped/i
const NON_ANSWER_MARKER = /^\[(Skipped|filtered|Language switch)/i

interface TopicRow {
  id: string; label: string; description: string | null; state: string; source: string
  response_target: number | null; response_count: number | null; mention_count: number | null
  keywords: string[] | null; example_quote: string | null; sort_order: number | null
}
interface ConvRow { id: string; session_id: string; participant_id: string | null; org_id: string }
interface UserTurn { content: string | null; content_en: string | null; sentiment: string | null; topic_id: string | null; created_at: string }

export async function GET(_req: NextRequest, props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params;
  const db = createServiceRoleClient()
  const hall = await resolveTownHall(db, params.sessionId)
  if (!hall) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = projectHallAsSession(hall)
  const config = session.config as { bot_name?: string; bot_emoji?: string }

  // Topics — the new-substrate theme pool
  const { data: topics } = await db
    .from('pulseiq_topics')
    .select('id, label, description, state, source, response_target, response_count, mention_count, keywords, example_quote, sort_order')
    .eq('town_hall_id', hall.id)
    .eq('org_id', hall.org_id)
    .order('sort_order', { ascending: true })

  // Conversations linked to the town hall
  const { data: linkRows } = await db
    .from('pulseiq_session_conversations')
    .select('conversation_id, conversations!inner(id, session_id, participant_id, org_id)')
    .eq('town_hall_id', hall.id)
    .eq('org_id', hall.org_id)
    .limit(2000)
  const conversations = ((linkRows || []) as { conversations: ConvRow | ConvRow[] }[])
    .map(r => Array.isArray(r.conversations) ? r.conversations[0] : r.conversations)
    .filter(Boolean)
  const convIds = conversations.map(c => c.id)
  const participants = new Set(conversations.map(c => c.participant_id || c.session_id))

  // User turns for response count + sentiment + keyword analytics
  let userTurns: UserTurn[] = []
  if (convIds.length > 0) {
    const { data } = await db
      .from('conversation_turns')
      .select('content, content_en, sentiment, topic_id, created_at')
      .in('conversation_id', convIds)
      .eq('role', 'user')
      .eq('org_id', hall.org_id)
      .limit(5000)
    userTurns = (data || []) as UserTurn[]
  }

  const skipped = userTurns.filter(t => SKIP_MARKER.test(String(t.content || ''))).length
  const answered = userTurns.filter(t => !NON_ANSWER_MARKER.test(String(t.content || '')))
  const answerText = (t: UserTurn) => String(t.content_en || t.content || '').trim()
  const allTexts = answered.map(answerText).filter(Boolean)

  // Per-topic response counts from turn.topic_id (live — the persisted
  // pulseiq_topics counters lag behind the async aggregator).
  const perTopicCount: Record<string, number> = {}
  for (const t of answered) {
    if (t.topic_id) perTopicCount[t.topic_id] = (perTopicCount[t.topic_id] || 0) + 1
  }

  // Sentiment: stored per-turn sentiment when chatCore scored it, lexicon
  // fallback otherwise (parity with the legacy lexicon-only computation).
  const sentimentCounts: Record<string, number> = { positive: 0, negative: 0, mixed: 0, neutral: 0 }
  for (const t of answered) {
    let s: string = t.sentiment || ''
    if (!sentimentCounts.hasOwnProperty(s)) {
      const text = answerText(t)
      if (!text) continue
      const score = lexiconScore(text)
      s = classifySentiment(score.pos, score.neg)
    }
    sentimentCounts[s] = (sentimentCounts[s] || 0) + 1
  }

  // Per-theme keyword enrichment (match counts + top keywords), as legacy.
  const enrichedThemes = ((topics || []) as TopicRow[]).map(t => {
    const keywords: string[] = t.keywords || []
    const regexes = keywords.slice(0, 15).map((kw: string) => {
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
    const responseCount = perTopicCount[t.id] || t.response_count || 0
    const pct = allTexts.length > 0
      ? Math.round(((matchCount || responseCount) / allTexts.length) * 100)
      : 0

    return {
      id: t.id,
      label: t.label,
      description: t.description,
      state: t.state,
      source: t.source === 'auto_detected' ? 'auto_detected' : (t.source === 'manual' ? 'custom' : 'guide'),
      sentiment: 'neutral',
      response_count: responseCount,
      response_target: t.response_target,
      mention_count: matchCount || t.mention_count || 0,
      percentage: pct,
      top_keywords: topKw,
      example_quote: t.example_quote,
    }
  })

  // Hide moderation-hidden topics in both vocabularies (sql/082 lets the
  // moderation route write legacy state values onto pulseiq_topics).
  const visibleThemes = enrichedThemes.filter(t =>
    !['rejected', 'pending', 'dismissed', 'detected'].includes(t.state))

  // Response timeline (bucketed by 5 min)
  const timeline: { time: string; count: number }[] = []
  if (answered.length > 0 && hall.started_at) {
    const start = new Date(hall.started_at).getTime()
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

  // ── Trending Now: recent (last 5 min) vs whole session ─────────────
  // Surfaces emerging concerns on the live screen as the session unfolds.
  const fiveMinAgo = Date.now() - 5 * 60 * 1000
  const recentTexts: string[] = []
  const baselineTexts: string[] = []
  for (const t of answered) {
    const text = answerText(t)
    if (!text) continue
    const ts = new Date(t.created_at).getTime()
    if (ts >= fiveMinAgo) recentTexts.push(text)
    else baselineTexts.push(text)
  }
  const trending = trendingTerms(recentTexts, baselineTexts, { n: 8, minRecentCount: 2 })

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
      responses: answered.length,
      total_turns: userTurns.length,
      skipped,
    },
    sentiment: sentimentCounts,
    themes: visibleThemes,
    timeline,
    trending,
  }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
  })
}
