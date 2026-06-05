// lib/agentStudy.ts
//
// The Agent Study — one analysis object, two consumers (the HTML report page
// and the PPTX export). Computed in two tiers:
//
//   Tier 1 (health)  — pure counts, no AI. Powers the agent-card health strip
//                      and the report's "study status" act. Cheap, recomputed
//                      on demand.
//   Tier 2 (study)   — AI classification (focus per exchange, entities,
//                      narrative insights) + non-AI aggregates (intents,
//                      languages, open questions). Memoized in
//                      agent_study_cache, keyed on a content hash so it
//                      self-heals when conversations or config change.
//
// Key data-model fact (lib/chatCore.ts:1002): turn rows are written only on
// the first user message, so every persisted session already has >=1 user
// turn. Pure widget-opens leave no trace — agent_impressions (the beacon) is
// the only source of true invocation counts. "Normalize" = strip the
// greeting/askName preamble (source='greeting') and count Q/A pairs
// (source='normal' user turns); sessions with 0 pairs are counted as
// abandoned but excluded from AI classification.

import crypto from 'crypto'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { isPhase3ReadSafe } from '@/lib/phase3Read'
import { isSubstantive, autoFlagReasons, resolveReviewStatus, includedInReports, duplicateFingerprintSet } from '@/lib/conversationReview'

// ── Types ───────────────────────────────────────────────────────────────────
export interface DailyPoint { date: string; opens: number; conversations: number }

export interface AgentHealth {
  conversations7d: number
  conversations30d: number
  conversationsTrendPct: number | null   // 7d vs prior 7d
  opens7d: number | null                  // null when no beacon data exists yet
  responseRatePct: number | null          // conversations7d / opens7d
  medianPairs: number
  maxPairs: number
  openQuestions: number                   // unanswered logged_questions
  lastActiveAt: string | null
  dailyActivity: DailyPoint[]             // last 30 days
  dot: 'green' | 'amber' | 'red' | 'idle'
}

export interface FocusSummary {
  slug: string
  label: string
  exchanges: number
  sessions: number
  sentiment: { positive: number; neutral: number; negative: number }
  entities: { name: string; mentions: number }[]
  samples: { question: string; answer: string; language: string; sentiment: string | null }[]
}

export interface AgentStudy {
  bot: { id: string; name: string }
  generatedAt: string
  cacheKey: string
  health: AgentHealth
  range: { first: string | null; last: string | null; activeDays: number }
  totals: {
    impressions: number | null
    totalSessions: number        // ALL distinct sessions — the official count shown on the agent card (= conversations + initiatedNotEntered + abandonedNoInput + flaggedExcluded)
    initiated: number            // sessions with >=1 user turn (any)
    conversations: number        // USEFUL: sessions with >=1 substantive user turn (the main count)
    initiatedNotEntered: number  // initiated but trivial-only (chip tap / one-word ack, no real message)
    abandonedNoInput: number     // sessions with no user turn at all (silence-probe only; rare)
    flaggedExcluded: number      // troll/bot/off-topic or human-excluded — kept in DB, out of the report
    openedNotEngaged: number | null  // beacon opens - initiated (beacon required)
    totalPairs: number
    medianPairs: number
    answeredPairs: number              // totalPairs minus validated unanswered (open) questions
    answerRatePct: number | null       // answeredPairs / totalPairs — the agent's "strength" number
  }
  depth: { bucket: string; sessions: number }[]   // normalized pair-count buckets
  focuses: FocusSummary[]
  entities: { name: string; mentions: number; focuses: string[] }[]
  intents: { label: string; detections: number; sessions: number; lastAt: string | null }[]
  languages: { language: string; sessions: number; pct: number }[]
  openQuestions: {
    byClassification: { classification: string; count: number }[]
    byStatus: { status: string; count: number }[]
    total: number          // count of logged_questions.status='open' — matches the agent card exactly
    open: { question: string; context: string; after: string; classification: string; language: string | null; suggestedKb: string | null; createdAt: string; sessionPairs: number }[]
  }
  insights: {
    commonQuestions: string[]
    patterns: string[]
    dropOff: string
    knowledgeGaps: string[]
    recommendations: string[]
    topQuotes: string[]
  }
  meta: {
    classifiedExchanges: number
    excludedZeroPair: number
    method: string
  }
}

interface Turn {
  session_id: string
  turn_number: number
  role: string
  content: string
  content_en: string | null
  language: string
  source: string | null
  sentiment: string | null
  content_flags: string[] | null
  created_at: string
}

interface BotRow {
  id: string
  name: string
  org_id: string
  focuses: { slug: string; label: string; description?: string; enabled?: boolean }[]
  intents: { label: string; enabled?: boolean }[]
}

// Internal-prompt leak: before 2026-06-03, the non-English greeting flow
// (ChatBot.tsx) POSTed the literal instruction "Greet the user warmly…" WITH a
// session_id, so chatCore persisted it as a user turn. The root cause is fixed
// (no session_id on that call), but historical rows still carry the leak — drop
// it so it never counts as user input, gets classified, or pollutes the
// transcript.
const INTERNAL_PROMPT_LEAK = /^greet the user warmly\b/i
function isLeakedTurn(t: Turn): boolean {
  return t.role === 'user' && INTERNAL_PROMPT_LEAK.test((t.content || '').trim())
}

// ── Turn loading (substrate-aware, mirrors insights-deck route) ──────────────
async function loadTurns(service: any, botId: string): Promise<Turn[]> {
  let rows: Turn[]
  if (isPhase3ReadSafe()) {
    const { data } = await service
      .from('conversation_turns')
      .select('turn_number, role, content, content_en, language, source, sentiment, content_flags, created_at, conversations!inner(session_id, bot_id)')
      .eq('conversations.bot_id', botId)
      .order('turn_number', { ascending: true })
      .limit(5000)
    rows = (data || []).map((r: any) => ({
      session_id: r.conversations?.session_id || '',
      turn_number: r.turn_number, role: r.role, content: r.content || '',
      content_en: r.content_en, language: r.language || 'en', source: r.source,
      sentiment: r.sentiment, content_flags: r.content_flags, created_at: r.created_at,
    }))
  } else {
    const { data } = await service
      .from('bot_conversation_turns')
      .select('session_id, turn_number, role, content, content_en, language, source, sentiment, content_flags, created_at')
      .eq('bot_id', botId)
      .order('session_id')
      .order('turn_number', { ascending: true })
      .limit(5000)
    rows = (data || []) as Turn[]
  }
  return rows.filter(t => !isLeakedTurn(t))
}

// ── Session / exchange shaping ───────────────────────────────────────────────
interface Exchange { sessionId: string; question: Turn; answer: Turn | null }

function groupSessions(turns: Turn[]): Map<string, Turn[]> {
  const m = new Map<string, Turn[]>()
  for (const t of turns) {
    if (!m.has(t.session_id)) m.set(t.session_id, [])
    m.get(t.session_id)!.push(t)
  }
  return m
}

// Apply the human-in-the-loop review gate: drop sessions a human excluded, or
// that auto-flag as troll/bot/wholly-off-topic and a human hasn't approved.
// Returns the included sessions + how many were excluded for review. One query.
async function partitionByReview(service: any, botId: string, sessions: Map<string, Turn[]>): Promise<{ included: Map<string, Turn[]>; flaggedExcluded: number }> {
  let human = new Map<string, 'approved' | 'excluded'>()
  try {
    const { data } = await service.from('conversation_reviews').select('session_id, status').eq('bot_id', botId)
    for (const r of (data || [])) human.set(r.session_id, r.status)
  } catch { /* table absent in prod yet → treat all as clean */ }
  const dup = duplicateFingerprintSet(sessions)
  const included = new Map<string, Turn[]>()
  let flaggedExcluded = 0
  for (const [sid, ts] of sessions) {
    const status = resolveReviewStatus(human.get(sid) ?? null, autoFlagReasons(ts, { duplicateFingerprints: dup }))
    if (includedInReports(status)) included.set(sid, ts)
    else flaggedExcluded++
  }
  return { included, flaggedExcluded }
}

// `isSubstantive` lives in lib/conversationReview.ts (shared with the auto-flag
// gate so the two never drift): a user turn counts only when it's a real
// message (>=3 words or contains '?') — one-word chip taps / acks don't.

// A normalized "pair" = a substantive user turn matched to the next assistant
// turn as its answer. Trivial turns are excluded so "Learn"/"Yes" never count
// as engagement depth or get classified into a focus.
function buildExchanges(sessionTurns: Turn[]): Exchange[] {
  const out: Exchange[] = []
  for (let i = 0; i < sessionTurns.length; i++) {
    const t = sessionTurns[i]
    if (isSubstantive(t)) {
      const answer = sessionTurns.slice(i + 1).find(x => x.role === 'assistant') || null
      out.push({ sessionId: t.session_id, question: t, answer })
    }
  }
  return out
}

function text(t: Turn): string { return (t.content_en || t.content || '').trim() }

// ── Tier 1: health (no AI) ───────────────────────────────────────────────────
function computeHealth(sessions: Map<string, Turn[]>, impressions: { created_at: string }[], openQuestionCount: number): AgentHealth {
  const now = Date.now()
  const DAY = 86400000
  // pairs per session + last-activity per session
  const sessionMeta = [...sessions.entries()].map(([sid, ts]) => {
    const pairs = ts.filter(isSubstantive).length
    const last = Math.max(...ts.map(t => new Date(t.created_at).getTime()))
    return { sid, pairs, last }
  }).filter(s => s.pairs > 0)

  const inWindow = (start: number, end: number) => sessionMeta.filter(s => s.last >= start && s.last < end).length
  const conversations7d = inWindow(now - 7 * DAY, now + DAY)
  const conversations30d = inWindow(now - 30 * DAY, now + DAY)
  const prior7d = inWindow(now - 14 * DAY, now - 7 * DAY)
  const trend = prior7d > 0 ? Math.round(((conversations7d - prior7d) / prior7d) * 100) : null

  const haveBeacon = impressions.length > 0
  const impTimes = impressions.map(i => new Date(i.created_at).getTime())
  const firstBeaconAt = haveBeacon ? Math.min(...impTimes) : null
  const opens7d = haveBeacon ? impTimes.filter(t => t >= now - 7 * DAY).length : null
  // Response rate = conversations ÷ opens, but ONLY over the period the beacon
  // has actually been collecting (capped at 7d). The beacon starts logging at
  // deploy, so dividing 7 days of pre-beacon conversation history by a day-old
  // open count printed nonsense (e.g. 36 ÷ 1 = 3600%). We therefore (a) align
  // the conversation window to the beacon's first record, (b) require a minimum
  // open sample so a handful of opens can't produce a noisy headline rate, and
  // (c) clamp at 100% — a conversation can persist even when its impression
  // insert was rate-limited or failed, which would otherwise exceed 100%.
  const MIN_OPENS_FOR_RATE = 10
  let responseRatePct: number | null = null
  if (haveBeacon && firstBeaconAt != null) {
    const rateStart = Math.max(now - 7 * DAY, firstBeaconAt)
    const opensInWindow = impTimes.filter(t => t >= rateStart).length
    if (opensInWindow >= MIN_OPENS_FOR_RATE) {
      const convInWindow = inWindow(rateStart, now + DAY)
      responseRatePct = Math.min(100, Math.round((convInWindow / opensInWindow) * 100))
    }
  }

  const pairCounts = sessionMeta.map(s => s.pairs).sort((a, b) => a - b)
  const medianPairs = pairCounts.length ? pairCounts[Math.floor(pairCounts.length / 2)] : 0
  const maxPairs = pairCounts.length ? pairCounts[pairCounts.length - 1] : 0
  const lastActive = sessionMeta.length ? Math.max(...sessionMeta.map(s => s.last)) : null

  // 30-day daily series
  const daily: DailyPoint[] = []
  for (let d = 29; d >= 0; d--) {
    const start = now - (d + 1) * DAY, end = now - d * DAY
    const date = new Date(end).toISOString().slice(0, 10)
    daily.push({
      date,
      conversations: sessionMeta.filter(s => s.last >= start && s.last < end).length,
      opens: haveBeacon ? impressions.filter(i => { const t = new Date(i.created_at).getTime(); return t >= start && t < end }).length : 0,
    })
  }

  // Health dot: idle if no recent activity; red if a real unanswered backlog
  // relative to volume; amber if quiet; else green.
  const daysSinceActive = lastActive ? (now - lastActive) / DAY : Infinity
  let dot: AgentHealth['dot'] = 'green'
  if (daysSinceActive > 14 || conversations30d === 0) dot = 'idle'
  else if (openQuestionCount >= 10 && openQuestionCount > conversations30d * 0.25) dot = 'red'
  else if (conversations7d === 0) dot = 'amber'

  return {
    conversations7d, conversations30d, conversationsTrendPct: trend,
    opens7d, responseRatePct, medianPairs, maxPairs,
    openQuestions: openQuestionCount,
    lastActiveAt: lastActive ? new Date(lastActive).toISOString() : null,
    dailyActivity: daily, dot,
  }
}

export async function getAgentHealth(botId: string): Promise<AgentHealth> {
  const service = createServiceRoleClient()
  const [turns, impRes, oqRes] = await Promise.all([
    loadTurns(service, botId),
    service.from('agent_impressions').select('created_at').eq('bot_id', botId).gte('created_at', new Date(Date.now() - 31 * 86400000).toISOString()),
    service.from('logged_questions').select('id', { count: 'exact', head: true }).eq('bot_id', botId).eq('status', 'open'),
  ])
  // Apply the same review gate as the full study so the card health and the
  // report agree (flagged troll/bot/off-topic sessions don't inflate the card).
  const { included } = await partitionByReview(service, botId, groupSessions(turns))
  return computeHealth(included, impRes.data || [], oqRes.count || 0)
}

// ── Tier 2: focus + entity classification (AI, batched) ──────────────────────
async function runConcurrent<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

interface ExchangeTag { focus: string | null; entities: string[] }

async function classifyExchanges(botId: string, botName: string, focuses: BotRow['focuses'], exchanges: Exchange[]): Promise<ExchangeTag[]> {
  const enabled = focuses.filter(f => f.enabled !== false)
  const catalog = enabled.map(f => `- ${f.slug}: ${f.label}${f.description ? ' — ' + f.description : ''}`).join('\n')
  const BATCH = 12
  const batches: Exchange[][] = []
  for (let i = 0; i < exchanges.length; i += BATCH) batches.push(exchanges.slice(i, i + BATCH))

  const results = await runConcurrent(batches, 5, async (batch) => {
    const lines = batch.map((e, i) => `[${i}] USER: ${text(e.question).slice(0, 400)}\n    AGENT: ${(e.answer ? text(e.answer) : '').slice(0, 300)}`).join('\n')
    const system = `You are tagging exchanges from conversations with an agent called "${botName}".
${catalog ? `Classify each USER question into exactly ONE focus area from this catalog (use the slug), or null if none fit:\n${catalog}` : 'There is no focus catalog; set focus to null.'}

Also extract NAMED entities the USER mentions in their question (NOT from the agent's reply) — specific roads, intersections, places, organizations, named things. NOT generic words, sentiments, the agent's own name/website, or any URL. Canonicalize (e.g. "the 429" and "SR 429" -> "SR 429").

Return ONLY a JSON array, one object per exchange index, no markdown:
[{"i":0,"focus":"slug_or_null","entities":["Name","Name"]}, ...]`
    const res = await callAI({ tier: 'fast', maxTokens: 1500, timeoutMs: 40000, system, messages: [{ role: 'user', content: lines }] })
    logUsage({ resource_type: 'bot', resource_id: botId, event_type: 'agent_study_classify' }, res.usage)
    let parsed: any[] = []
    try { parsed = JSON.parse(res.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()) } catch { parsed = [] }
    // Drop URLs/domains and the agent's own name — these come from the agent's
    // replies, not from what users named (a credibility issue in entity analysis).
    const nameLc = botName.toLowerCase()
    const isJunk = (e: string) => /https?:|www\.|\.(com|org|net|gov|io|us)\b/i.test(e) || e.toLowerCase() === nameLc
    return batch.map((_e, i) => {
      const p = parsed.find((x: any) => x && x.i === i) || {}
      const slug = typeof p.focus === 'string' && enabled.some(f => f.slug === p.focus) ? p.focus : null
      const ents = Array.isArray(p.entities) ? p.entities.filter((s: any) => typeof s === 'string' && s.trim().length > 1 && !isJunk(s.trim())).slice(0, 6) : []
      return { focus: slug, entities: ents } as ExchangeTag
    })
  })
  return results.flat()
}

// ── Narrative insights (AI) — folds in the old "Mine Conversations" report ───
async function computeInsights(botId: string, botName: string, sessions: Map<string, Turn[]>): Promise<AgentStudy['insights']> {
  let transcript = ''
  for (const [sid, ts] of sessions) {
    const block = `\n--- ${sid.slice(0, 8)} ---\n` + ts.filter(t => t.source !== 'greeting').map(t => `${t.role}: ${text(t).slice(0, 220)}`).join('\n') + '\n'
    if (transcript.length + block.length > 12000) break
    transcript += block
  }
  const empty = { commonQuestions: [], patterns: [], dropOff: '', knowledgeGaps: [], recommendations: [], topQuotes: [] }
  if (!transcript.trim()) return empty
  const res = await callAI({
    tier: 'standard', maxTokens: 1800, timeoutMs: 45000,
    system: `Analyze these conversations with an agent called "${botName}". Lines are prefixed "user:" (the human) or "assistant:" (the agent). NEVER attribute an "assistant:" line as a user quote.
Return ONLY JSON, no markdown:
{"common_questions":["top 5 things users ask/raise"],"conversation_patterns":["5 bullets on how users engage"],"drop_off_insights":"2-3 sentences on where/why conversations end","knowledge_gaps":["3-5 topics the agent answers poorly"],"recommendations":["4-5 actionable improvements"],"top_quotes":["6 verbatim USER quotes, >=15 words, from 'user:' lines only"]}`,
    messages: [{ role: 'user', content: transcript }],
  })
  logUsage({ resource_type: 'bot', resource_id: botId, event_type: 'agent_study_insights' }, res.usage)
  try {
    const a = JSON.parse(res.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    return {
      commonQuestions: a.common_questions || [], patterns: a.conversation_patterns || [],
      dropOff: a.drop_off_insights || '', knowledgeGaps: a.knowledge_gaps || [],
      recommendations: a.recommendations || [], topQuotes: a.top_quotes || [],
    }
  } catch { return empty }
}

// ── Open-question validation (filters false positives, adds context) ─────────
// logged_questions captures liberally (any uncertain reply), so the raw log is
// full of non-questions: acks ("yes"), context the user shared, fragments,
// chip taps. We pull the agent's preceding line for context and AI-validate
// each as a genuine unanswered question, restating it cleanly.
interface QVerdict { valid: boolean; restated: string; reason: string }

function findPriorAgentLine(sessions: Map<string, Turn[]>, sessionId: string, userMessage: string): string {
  const ts = sessions.get(sessionId)
  if (!ts) return ''
  const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const nq = norm(userMessage)
  const idx = ts.findIndex(t => t.role === 'user' && (norm(t.content) === nq || norm(t.content_en || '') === nq))
  if (idx < 0) return ''
  for (let j = idx - 1; j >= 0; j--) if (ts[j].role === 'assistant') return ts[j].content_en || ts[j].content || ''
  return ''
}

// The agent's reply that immediately FOLLOWED the user's question — i.e. the
// answer that was uncertain / a non-answer. Pairs with findPriorAgentLine so the
// report can show before (what teed it up) AND after (how the agent flubbed it).
function findFollowingAgentLine(sessions: Map<string, Turn[]>, sessionId: string, userMessage: string): string {
  const ts = sessions.get(sessionId)
  if (!ts) return ''
  const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const nq = norm(userMessage)
  const idx = ts.findIndex(t => t.role === 'user' && (norm(t.content) === nq || norm(t.content_en || '') === nq))
  if (idx < 0) return ''
  for (let j = idx + 1; j < ts.length; j++) if (ts[j].role === 'assistant') return ts[j].content_en || ts[j].content || ''
  return ''
}

async function validateOpenQuestions(botId: string, botName: string, items: { question: string; context: string }[]): Promise<QVerdict[]> {
  if (items.length === 0) return []
  const lines = items.map((it, i) => `[${i}] AGENT SAID BEFORE: ${(it.context || '(nothing)').slice(0, 220)}\n    USER MESSAGE: ${it.question.slice(0, 300)}`).join('\n')
  const res = await callAI({
    tier: 'fast', maxTokens: 1300, timeoutMs: 35000,
    system: `These USER messages were each flagged as "a question ${botName} could not answer." Many are FALSE POSITIVES — acknowledgements ("yes", "ok"), statements like "I'm here to learn", context the user shared about themselves, location fragments, or the agent's own text. Using the agent's preceding line as context, decide for each whether it is genuinely a question or request the agent failed to answer.
Return ONLY a JSON array, no markdown:
[{"i":0,"valid":true|false,"restated":"one-sentence clean restatement of the real question (empty string if not valid)","reason":"short why"}]`,
    messages: [{ role: 'user', content: lines }],
  })
  logUsage({ resource_type: 'bot', resource_id: botId, event_type: 'agent_study_validate_q' }, res.usage)
  let parsed: any[] = []
  try { parsed = JSON.parse(res.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()) } catch { parsed = [] }
  return items.map((_it, i) => {
    const p = parsed.find((x: any) => x && x.i === i) || {}
    return { valid: !!p.valid, restated: typeof p.restated === 'string' ? p.restated : '', reason: typeof p.reason === 'string' ? p.reason : '' }
  })
}

// ── Cache key ────────────────────────────────────────────────────────────────
// Bump when the AgentStudy object SHAPE changes (new fields, reworked
// computation) so stale cached studies recompute instead of serving an
// old-shape object that renders with missing/undefined fields.
//   v2 (2026-06-03): totalSessions, answerRatePct/answeredPairs, open[].after,
//   language-routing intents excluded.
//   v3 (2026-06-03): open[].sessionPairs (conversation depth per open question).
//   v4 (2026-06-05): openQuestions.total (= card's status='open' count); dropped
//   AI validation of open questions (open[].restated, autoFiltered, filteredExamples).
const STUDY_SCHEMA_VERSION = 'v4'
function cacheKeyFor(pairTotal: number, bot: BotRow): string {
  const h = crypto.createHash('sha1')
  h.update(`${STUDY_SCHEMA_VERSION}|${pairTotal}|${JSON.stringify(bot.focuses || [])}|${JSON.stringify(bot.intents || [])}`)
  return h.digest('hex').slice(0, 16)
}

function bucketFor(pairs: number): string {
  if (pairs <= 1) return '1'
  if (pairs === 2) return '2'
  if (pairs === 3) return '3'
  if (pairs <= 5) return '4–5'
  if (pairs <= 9) return '6–9'
  return '10+'
}
const BUCKET_ORDER = ['1', '2', '3', '4–5', '6–9', '10+']

// ── Main: getAgentStudy (compute-if-stale, cached) ───────────────────────────
export async function getAgentStudy(botId: string, opts: { force?: boolean } = {}): Promise<AgentStudy | null> {
  const service = createServiceRoleClient()
  const { data: botData } = await service
    .from('agents')
    .select('id, name, org_id, focuses, intents')
    .eq('id', botId)
    .single()
  if (!botData) return null
  const bot: BotRow = {
    id: botData.id, name: botData.name, org_id: botData.org_id,
    focuses: Array.isArray(botData.focuses) ? botData.focuses : [],
    intents: Array.isArray(botData.intents) ? botData.intents : [],
  }

  const allTurns = await loadTurns(service, botId)
  // Human-in-the-loop review gate: drop troll/bot/off-topic + human-excluded
  // sessions BEFORE any counting or classification. They stay in the DB; the
  // report just never sees them. Everything downstream works on `sessions`
  // (= included only) + `turns` (= their flattened turns).
  const { included: sessions, flaggedExcluded } = await partitionByReview(service, botId, groupSessions(allTurns))
  const turns = [...sessions.values()].flat()

  // Classify each session: useful (>=1 substantive exchange) vs initiated-but-
  // not-entered (has a user turn but only trivial ones) vs no-input.
  let useful = 0, initiated = 0, initiatedNotEntered = 0, abandonedNoInput = 0, totalPairs = 0
  const allExchanges: Exchange[] = []
  for (const [, ts] of sessions) {
    const hasUser = ts.some(t => t.role === 'user')
    const ex = buildExchanges(ts)
    if (hasUser) initiated++
    if (ex.length > 0) { useful++; totalPairs += ex.length; allExchanges.push(...ex) }
    else if (hasUser) initiatedNotEntered++
    else abandonedNoInput++
  }
  const pairTotal = totalPairs
  const cacheKey = cacheKeyFor(pairTotal, bot)

  // cache hit?
  if (!opts.force) {
    const { data: cached } = await service.from('agent_study_cache').select('cache_key, analysis').eq('bot_id', botId).single()
    if (cached && cached.cache_key === cacheKey && cached.analysis) {
      return cached.analysis as AgentStudy
    }
  }

  // ── impressions + open questions (no AI) ──
  const [impRes, oqRes] = await Promise.all([
    service.from('agent_impressions').select('created_at').eq('bot_id', botId).gte('created_at', new Date(Date.now() - 31 * 86400000).toISOString()),
    service.from('logged_questions').select('session_id, user_message, classification, status, language, suggested_kb_addition, created_at').eq('bot_id', botId).order('created_at', { ascending: false }).limit(500),
  ])
  const impressions = impRes.data || []
  const allImpRes = await service.from('agent_impressions').select('id', { count: 'exact', head: true }).eq('bot_id', botId)
  const totalImpressions = allImpRes.count
  const loggedQ = oqRes.data || []
  // Open-question count, computed the SAME way the agent card computes it
  // (logged_questions.status='open', no time/row cap) so the two never disagree.
  // The card lives in app/api/bots/route.ts; keep these in lockstep.
  const openCountRes = await service.from('logged_questions').select('id', { count: 'exact', head: true }).eq('bot_id', botId).eq('status', 'open')
  const openCount = openCountRes.count || 0

  // ── classify exchanges (AI) ──
  const tags = await classifyExchanges(botId, bot.name, bot.focuses, allExchanges)

  // ── aggregate focuses + entities + cross-tab ──
  const focusMap = new Map<string, FocusSummary>()
  const entityFocus = new Map<string, { mentions: number; focuses: Set<string> }>()
  const enabledFocuses = bot.focuses.filter(f => f.enabled !== false)
  const focusSessions = new Map<string, Set<string>>()
  allExchanges.forEach((ex, i) => {
    const tag = tags[i]
    // entities (global tally + cross-tab)
    for (const name of tag.entities) {
      const key = name.toLowerCase()
      if (!entityFocus.has(key)) entityFocus.set(key, { mentions: 0, focuses: new Set() })
      const e = entityFocus.get(key)!
      e.mentions++
      if (tag.focus) e.focuses.add(tag.focus)
    }
    if (!tag.focus) return
    const def = enabledFocuses.find(f => f.slug === tag.focus)
    if (!def) return
    if (!focusMap.has(tag.focus)) {
      focusMap.set(tag.focus, { slug: tag.focus, label: def.label, exchanges: 0, sessions: 0, sentiment: { positive: 0, neutral: 0, negative: 0 }, entities: [], samples: [] })
      focusSessions.set(tag.focus, new Set())
    }
    const f = focusMap.get(tag.focus)!
    f.exchanges++
    focusSessions.get(tag.focus)!.add(ex.sessionId)
    const sent = ex.question.sentiment
    if (sent === 'positive' || sent === 'negative') f.sentiment[sent]++
    else f.sentiment.neutral++
    if (f.samples.length < 6) f.samples.push({ question: text(ex.question).slice(0, 300), answer: ex.answer ? text(ex.answer).slice(0, 320) : '', language: ex.question.language, sentiment: sent })
  })
  // per-focus entity cross-tab + canonical entity casing
  const canonical = new Map<string, string>()
  allExchanges.forEach((ex, i) => { for (const n of tags[i].entities) if (!canonical.has(n.toLowerCase())) canonical.set(n.toLowerCase(), n) })
  for (const [slug, f] of focusMap) {
    f.sessions = focusSessions.get(slug)!.size
    const tally = new Map<string, number>()
    allExchanges.forEach((ex, i) => { if (tags[i].focus === slug) for (const n of tags[i].entities) tally.set(n.toLowerCase(), (tally.get(n.toLowerCase()) || 0) + 1) })
    f.entities = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ name: canonical.get(k) || k, mentions: v }))
  }
  const focusesArr = [...focusMap.values()].sort((a, b) => b.exchanges - a.exchanges)
  const entitiesArr = [...entityFocus.entries()].sort((a, b) => b[1].mentions - a[1].mentions).slice(0, 30)
    .map(([k, v]) => ({ name: canonical.get(k) || k, mentions: v.mentions, focuses: [...v.focuses] }))

  // ── intents (no AI — content_flags on user turns) ──
  // Language-routing intents (e.g. "Spanish" → switch language + referral) are
  // configured as intents so they trigger a handler, but they're not analytical
  // intents — and they're already covered by the Conversations-by-Language
  // panel. Exclude them from Intents Detected so a language doesn't masquerade
  // as a top intent. The handler/behavior is unaffected (this only filters the
  // analytics readout). Per owner 2026-06-03.
  const LANGUAGE_INTENT_LABELS = new Set(['spanish', 'english', 'french', 'german', 'portuguese', 'italian', 'chinese', 'mandarin', 'cantonese', 'japanese', 'korean', 'vietnamese', 'tagalog', 'arabic', 'russian', 'hindi', 'creole', 'haitian creole', 'polish', 'farsi', 'urdu', 'bengali'])
  const userTurns = turns.filter(t => t.role === 'user')
  const intentsArr = bot.intents.filter(i => i.enabled !== false && !LANGUAGE_INTENT_LABELS.has((i.label || '').toLowerCase().trim())).map(intent => {
    const flag = 'intent:' + (intent.label || '').toLowerCase().replace(/\s+/g, '_')
    const hits = userTurns.filter(t => Array.isArray(t.content_flags) && t.content_flags.includes(flag))
    const lastAt = hits.length ? hits.map(h => h.created_at).sort().slice(-1)[0] : null
    return { label: intent.label, detections: hits.length, sessions: new Set(hits.map(h => h.session_id)).size, lastAt }
  }).sort((a, b) => b.detections - a.detections)

  // ── languages (report by language; analysis ran on translated text) ──
  // Language breakdown over USEFUL conversations only (substantive turns), so
  // the percentages reconcile to the useful-conversation total.
  const langSessions = new Map<string, Set<string>>()
  for (const t of userTurns) {
    if (!isSubstantive(t)) continue
    if (!langSessions.has(t.language)) langSessions.set(t.language, new Set())
    langSessions.get(t.language)!.add(t.session_id)
  }
  const langTotal = useful || 1
  const languagesArr = [...langSessions.entries()].map(([language, s]) => ({ language, sessions: s.size, pct: Math.round((s.size / langTotal) * 100) })).sort((a, b) => b.sessions - a.sessions)

  // ── open questions summary ──
  // No AI cleanup: the open count IS logged_questions.status='open' (same as the
  // agent card). The team curates the queue by hand on the Questions page —
  // marking each Answered / Referred / N/A — and both surfaces reflect that one
  // status. The list below is the most recent 40 for display; `total` is the
  // true count and drives the headline metric.
  const byClass = new Map<string, number>(), byStatus = new Map<string, number>()
  for (const q of loggedQ) { byClass.set(q.classification, (byClass.get(q.classification) || 0) + 1); byStatus.set(q.status, (byStatus.get(q.status) || 0) + 1) }
  const open: AgentStudy['openQuestions']['open'] = loggedQ.filter((q: any) => q.status === 'open').slice(0, 40).map((q: any) => ({
    question: q.user_message,
    context: findPriorAgentLine(sessions, q.session_id, q.user_message),
    after: findFollowingAgentLine(sessions, q.session_id, q.user_message),
    classification: q.classification,
    language: q.language,
    suggestedKb: q.suggested_kb_addition,
    createdAt: q.created_at,
    // Conversation depth this question came from — an unanswered question from a
    // long, engaged chat is a higher-value gap than a one-and-done; the report
    // color-codes by this.
    sessionPairs: buildExchanges(sessions.get(q.session_id) || []).length,
  }))
  const openQuestions = {
    byClassification: [...byClass.entries()].map(([classification, count]) => ({ classification, count })).sort((a, b) => b.count - a.count),
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    total: openCount,
    open,
  }

  // ── answer rate (the "strength" number) ──
  // Of every Q&A pair the agent fielded, what share did it actually answer?
  // "Unanswered" = the open logged questions (status='open'); each maps to
  // roughly one pair where the agent hit a wall. Deflections (off-topic) are
  // intentional and NOT counted as failures.
  const answeredPairs = Math.max(0, totalPairs - openCount)
  const answerRatePct = totalPairs > 0 ? Math.min(100, Math.round((answeredPairs / totalPairs) * 100)) : null

  // ── narrative insights (AI) ──
  const insights = await computeInsights(botId, bot.name, sessions)

  // ── depth distribution ──
  const depthCounts = new Map<string, number>(BUCKET_ORDER.map(b => [b, 0] as [string, number]))
  for (const [, ts] of sessions) {
    const pairs = buildExchanges(ts).length
    if (pairs === 0) continue
    const b = bucketFor(pairs)
    depthCounts.set(b, (depthCounts.get(b) || 0) + 1)
  }
  const depth = BUCKET_ORDER.map(b => ({ bucket: b, sessions: depthCounts.get(b) || 0 })).filter(d => d.sessions > 0)

  // ── health + range ──
  const health = computeHealth(sessions, impressions, openCount)
  const allDates = turns.map(t => new Date(t.created_at).getTime()).sort((a, b) => a - b)
  const activeDays = new Set(turns.map(t => t.created_at.slice(0, 10))).size

  const pairCounts = [...sessions.values()].map(ts => buildExchanges(ts).length).filter(p => p > 0).sort((a, b) => a - b)
  const medianPairs = pairCounts.length ? pairCounts[Math.floor(pairCounts.length / 2)] : 0

  const study: AgentStudy = {
    bot: { id: bot.id, name: bot.name },
    generatedAt: new Date().toISOString(),
    cacheKey,
    health,
    range: {
      first: allDates.length ? new Date(allDates[0]).toISOString() : null,
      last: allDates.length ? new Date(allDates[allDates.length - 1]).toISOString() : null,
      activeDays,
    },
    totals: {
      impressions: totalImpressions ?? null,
      // Every loaded session lands in exactly one bucket, so this equals the
      // distinct-session count the agent card shows (the official record).
      totalSessions: useful + initiatedNotEntered + abandonedNoInput + flaggedExcluded,
      initiated,
      conversations: useful,
      initiatedNotEntered,
      abandonedNoInput,
      flaggedExcluded,
      openedNotEngaged: (totalImpressions != null && totalImpressions > 0) ? Math.max(0, totalImpressions - initiated) : null,
      totalPairs,
      medianPairs,
      answeredPairs,
      answerRatePct,
    },
    depth,
    focuses: focusesArr,
    entities: entitiesArr,
    intents: intentsArr,
    languages: languagesArr,
    openQuestions,
    insights,
    meta: {
      classifiedExchanges: allExchanges.length,
      excludedZeroPair: initiatedNotEntered,
      method: 'Useful conversations = a real user message (≥3 words or a question); one-word taps, greeting preamble, and internal-prompt leaks excluded. Deck-time batch classification (Haiku); open questions AI-validated to drop false positives. Non-English analyzed on translated text, reported by source language.',
    },
  }

  // ── persist cache (service-role upsert; org_id paired) ──
  await service.from('agent_study_cache').upsert({
    bot_id: botId, org_id: bot.org_id, cache_key: cacheKey, analysis: study as any, updated_at: new Date().toISOString(),
  }, { onConflict: 'bot_id' })

  return study
}

// ── Backfill: re-validate a bot's OPEN logged_questions, mark false positives ─
// "Corrects internally" so the Questions admin page also self-cleans. False
// positives get status='n_a' + a notes trail (no migration — existing columns).
// `apply:false` is a dry-run. Service-role; pairs bot_id + org_id on the write.
export async function revalidateOpenQuestions(botId: string, opts: { apply: boolean }): Promise<{ total: number; kept: number; filtered: { question: string; reason: string }[] }> {
  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, name, org_id').eq('id', botId).single()
  if (!bot) return { total: 0, kept: 0, filtered: [] }
  const turns = await loadTurns(service, botId)
  const sessions = groupSessions(turns)
  const { data: open } = await service.from('logged_questions')
    .select('id, session_id, user_message').eq('bot_id', botId).eq('status', 'open').limit(500)
  const rows = open || []
  if (rows.length === 0) return { total: 0, kept: 0, filtered: [] }
  const verdicts = await validateOpenQuestions(botId, bot.name, rows.map((q: any) => ({ question: q.user_message, context: findPriorAgentLine(sessions, q.session_id, q.user_message) })))
  const filtered: { question: string; reason: string }[] = []
  for (let i = 0; i < rows.length; i++) {
    const v = verdicts[i] || { valid: true, restated: '', reason: '' }
    if (v.valid) continue
    filtered.push({ question: rows[i].user_message, reason: v.reason })
    if (opts.apply) {
      await service.from('logged_questions')
        .update({ status: 'n_a', notes: 'Auto-filtered by agent study: not a real question — ' + (v.reason || 'no reason').slice(0, 200), resolved_at: new Date().toISOString() })
        .eq('id', rows[i].id).eq('org_id', bot.org_id)
    }
  }
  return { total: rows.length, kept: rows.length - filtered.length, filtered }
}
