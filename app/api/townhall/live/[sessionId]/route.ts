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
import { resolveTownHall, projectHallAsSession, fetchAllRows } from '@/lib/townHallAdapter'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

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

// "Trending Now" is a SEMANTIC judgment, not a word count (owner feedback
// 2026-07-03: frequency surfaced typos and topic words — "just words, not
// things of potential interest"). A small fast AI pass extracts up to 5
// short phrases of NEW, specific interest from the recent window, excluding
// the session's planned topics. Cached 60s per session so the 10s-polled
// public endpoint costs one AI call per minute per session; the word-count
// heuristic is the fallback when the AI call fails or the window is thin.
const TRENDING_TTL_MS = 60_000
const trendingCache = new Map<string, { at: number; terms: { word: string; recentCount: number; baselineCount: number; ratio: number }[] }>()

async function aiEmergingInterests(
  recentItems: { text: string; source: string }[],
  topicLabels: string[],
  orgId: string,
  townHallId: string,
): Promise<{ word: string; recentCount: number; baselineCount: number; ratio: number }[] | null> {
  try {
    const responses = recentItems.slice(-40).map((r, i) => (i + 1) + '. ' + r.text.slice(0, 300)).join('\n')
    const res = await callAI({
      tier: 'fast', maxTokens: 200, timeoutMs: 3500,
      system: 'You spot EMERGING points of interest in live participant feedback for a session moderator.\n' +
        'The session already plans to cover these topics (do NOT list them or their obvious keywords): ' + (topicLabels.join(', ') || '(none)') + '\n' +
        'From the recent responses, extract up to 5 SHORT phrases (2-4 words each, lowercase) that capture NEW, specific, concrete things participants are raising — places, problems, suggestions, recurring concerns. Skip generic words, pleasantries, typos, and anything already covered by the planned topics.\n' +
        'Return ONLY a JSON array of strings, e.g. ["speeding on brooks lane","no bike lanes"]. Return [] if nothing genuinely stands out.',
      messages: [{ role: 'user', content: 'Recent responses:\n' + responses }],
    })
    logUsage({ org_id: orgId, resource_type: 'townhall', resource_id: townHallId, event_type: 'trending_extract' }, res.usage)
    const cleaned = (res.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
    const m = cleaned.match(/\[[\s\S]*\]/)
    if (!m) return null
    const phrases = (JSON.parse(m[0]) as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 5)
    return phrases.map(pRaw => {
      const p = pRaw.trim().toLowerCase()
      const hits = recentItems.filter(r => r.text.toLowerCase().includes(p)).length
      return { word: p, recentCount: Math.max(hits, 1), baselineCount: 0, ratio: 1 }
    })
  } catch {
    return null
  }
}

interface TopicRow {
  id: string; label: string; description: string | null; state: string; source: string
  response_target: number | null; response_count: number | null; mention_count: number | null
  keywords: string[] | null; example_quote: string | null; sort_order: number | null
}
interface ConvRow { id: string; session_id: string; participant_id: string | null; org_id: string }
interface UserTurn { conversation_id: string; content: string | null; content_en: string | null; sentiment: string | null; topic_id: string | null; created_at: string }

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

  // Conversations linked to the town hall (paged — PostgREST caps a single
  // select at 1000 rows regardless of .limit())
  const linkRows = await fetchAllRows<{ conversations: ConvRow | ConvRow[] }>((from, to) => db
    .from('pulseiq_session_conversations')
    .select('conversation_id, conversations!inner(id, session_id, participant_id, org_id)')
    .eq('town_hall_id', hall.id)
    .eq('org_id', hall.org_id)
    .order('conversation_id', { ascending: true })
    .range(from, to), 5000)
  const conversations = linkRows
    .map(r => Array.isArray(r.conversations) ? r.conversations[0] : r.conversations)
    .filter(Boolean)
  const convIds = conversations.map(c => c.id)
  const participants = new Set(conversations.map(c => c.participant_id || c.session_id))

  // User turns for response count + sentiment + keyword analytics. Filtered
  // on the stamped town_hall_id column — the old `.in(conversation_id,
  // convIds)` broke at a few hundred participants on URL length. The link
  // fetch above stays for the participant count.
  let userTurns: UserTurn[] = []
  if (convIds.length > 0) {
    userTurns = await fetchAllRows<UserTurn>((from, to) => db
      .from('conversation_turns')
      .select('conversation_id, content, content_en, sentiment, topic_id, created_at')
      .eq('town_hall_id', hall.id)
      .eq('role', 'user')
      .eq('org_id', hall.org_id)
      .order('created_at', { ascending: true })
      .range(from, to), 20000)
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
    const compiled = keywords.map((kw: string) => {
      try { return { kw, re: buildKwRegex(kw) } } catch { return null }
    })
    const regexes = compiled.slice(0, 15).filter(Boolean).map(c => c!.re)

    let matchCount = 0
    const kwFreq: Record<string, number> = {}
    if (regexes.length > 0) {
      for (const text of allTexts) {
        const lower = text.toLowerCase()
        if (regexes.some(re => re.test(lower))) {
          matchCount++
          for (const c of compiled) {
            if (c && c.re.test(lower)) kwFreq[c.kw] = (kwFreq[c.kw] || 0) + 1
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
  const recentItems: { text: string; source: string }[] = []
  const baselineTexts: string[] = []
  for (const t of answered) {
    const text = answerText(t)
    if (!text) continue
    const ts = new Date(t.created_at).getTime()
    if (ts >= fiveMinAgo) recentItems.push({ text, source: t.conversation_id })
    else baselineTexts.push(text)
  }
  // Suppress words the session is already themed on (topic labels +
  // keywords) — a seeded theme isn't "trending" — and require each term to
  // come from ≥2 distinct conversations so one participant's typos can't
  // trend. Cross-participant requirement only kicks in once the room has
  // more than one voice.
  const themedWords = new Set<string>()
  for (const t of (topics || []) as TopicRow[]) {
    for (const w of String(t.label || '').toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3) themedWords.add(w)
    for (const kw of (t.keywords || [])) for (const w of String(kw).toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3) themedWords.add(w)
  }
  const distinctRecentConvs = new Set(recentItems.map(i => i.source)).size
  let trending: { word: string; recentCount: number; baselineCount: number; ratio: number }[]
  const cached = trendingCache.get(hall.id)
  if (cached && Date.now() - cached.at < TRENDING_TTL_MS) {
    trending = cached.terms
  } else {
    let aiTerms: typeof trending | null = null
    if (recentItems.length >= 2) {
      aiTerms = await aiEmergingInterests(
        recentItems,
        ((topics || []) as TopicRow[]).map(t => t.label),
        hall.org_id, hall.id,
      )
    }
    trending = aiTerms ?? trendingTerms(recentItems, baselineTexts, {
      n: 8, minRecentCount: 2, exclude: themedWords,
      minSources: distinctRecentConvs > 1 ? 2 : 1,
    })
    trendingCache.set(hall.id, { at: Date.now(), terms: trending })
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
