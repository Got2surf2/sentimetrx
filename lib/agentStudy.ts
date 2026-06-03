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
    conversations: number       // analyzable sessions (>=1 pair)
    abandonedNoInput: number     // persisted sessions with 0 pairs (silence-probe only)
    openedNotEngaged: number | null  // opens - conversations (beacon required)
    totalPairs: number
    medianPairs: number
  }
  depth: { bucket: string; sessions: number }[]   // normalized pair-count buckets
  focuses: FocusSummary[]
  entities: { name: string; mentions: number; focuses: string[] }[]
  intents: { label: string; detections: number; sessions: number; lastAt: string | null }[]
  languages: { language: string; sessions: number; pct: number }[]
  openQuestions: {
    byClassification: { classification: string; count: number }[]
    byStatus: { status: string; count: number }[]
    open: { question: string; classification: string; language: string | null; suggestedKb: string | null; createdAt: string }[]
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

// ── Turn loading (substrate-aware, mirrors insights-deck route) ──────────────
async function loadTurns(service: any, botId: string): Promise<Turn[]> {
  if (isPhase3ReadSafe()) {
    const { data } = await service
      .from('conversation_turns')
      .select('turn_number, role, content, content_en, language, source, sentiment, content_flags, created_at, conversations!inner(session_id, bot_id)')
      .eq('conversations.bot_id', botId)
      .order('turn_number', { ascending: true })
      .limit(5000)
    return (data || []).map((r: any) => ({
      session_id: r.conversations?.session_id || '',
      turn_number: r.turn_number, role: r.role, content: r.content || '',
      content_en: r.content_en, language: r.language || 'en', source: r.source,
      sentiment: r.sentiment, content_flags: r.content_flags, created_at: r.created_at,
    }))
  }
  const { data } = await service
    .from('bot_conversation_turns')
    .select('session_id, turn_number, role, content, content_en, language, source, sentiment, content_flags, created_at')
    .eq('bot_id', botId)
    .order('session_id')
    .order('turn_number', { ascending: true })
    .limit(5000)
  return (data || []) as Turn[]
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

// A normalized "pair" = a source='normal' user turn (the askName/greeting
// preamble carries source='greeting' and is excluded). Each pair is matched to
// the next assistant turn in the session as its answer.
function buildExchanges(sessionTurns: Turn[]): Exchange[] {
  const out: Exchange[] = []
  for (let i = 0; i < sessionTurns.length; i++) {
    const t = sessionTurns[i]
    if (t.role === 'user' && (t.source === 'normal' || t.source === null)) {
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
    const pairs = ts.filter(t => t.role === 'user' && (t.source === 'normal' || t.source === null)).length
    const last = Math.max(...ts.map(t => new Date(t.created_at).getTime()))
    return { sid, pairs, last }
  }).filter(s => s.pairs > 0)

  const inWindow = (start: number, end: number) => sessionMeta.filter(s => s.last >= start && s.last < end).length
  const conversations7d = inWindow(now - 7 * DAY, now + DAY)
  const conversations30d = inWindow(now - 30 * DAY, now + DAY)
  const prior7d = inWindow(now - 14 * DAY, now - 7 * DAY)
  const trend = prior7d > 0 ? Math.round(((conversations7d - prior7d) / prior7d) * 100) : null

  const haveBeacon = impressions.length > 0
  const opens7d = haveBeacon ? impressions.filter(i => new Date(i.created_at).getTime() >= now - 7 * DAY).length : null
  const responseRatePct = (opens7d && opens7d > 0) ? Math.round((conversations7d / opens7d) * 100) : null

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
  return computeHealth(groupSessions(turns), impRes.data || [], oqRes.count || 0)
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

// ── Cache key ────────────────────────────────────────────────────────────────
function cacheKeyFor(pairTotal: number, bot: BotRow): string {
  const h = crypto.createHash('sha1')
  h.update(`${pairTotal}|${JSON.stringify(bot.focuses || [])}|${JSON.stringify(bot.intents || [])}`)
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

  const turns = await loadTurns(service, botId)
  const sessions = groupSessions(turns)

  // analyzable sessions (>=1 pair) vs abandoned (0 pairs)
  let analyzable = 0, abandoned = 0, totalPairs = 0
  const allExchanges: Exchange[] = []
  for (const [, ts] of sessions) {
    const ex = buildExchanges(ts)
    if (ex.length === 0) { abandoned++; continue }
    analyzable++
    totalPairs += ex.length
    allExchanges.push(...ex)
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
    service.from('logged_questions').select('user_message, classification, status, language, suggested_kb_addition, created_at').eq('bot_id', botId).order('created_at', { ascending: false }).limit(500),
  ])
  const impressions = impRes.data || []
  const allImpRes = await service.from('agent_impressions').select('id', { count: 'exact', head: true }).eq('bot_id', botId)
  const totalImpressions = allImpRes.count
  const loggedQ = oqRes.data || []

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
  const userTurns = turns.filter(t => t.role === 'user')
  const intentsArr = bot.intents.filter(i => i.enabled !== false).map(intent => {
    const flag = 'intent:' + (intent.label || '').toLowerCase().replace(/\s+/g, '_')
    const hits = userTurns.filter(t => Array.isArray(t.content_flags) && t.content_flags.includes(flag))
    const lastAt = hits.length ? hits.map(h => h.created_at).sort().slice(-1)[0] : null
    return { label: intent.label, detections: hits.length, sessions: new Set(hits.map(h => h.session_id)).size, lastAt }
  }).sort((a, b) => b.detections - a.detections)

  // ── languages (report by language; analysis ran on translated text) ──
  const langSessions = new Map<string, Set<string>>()
  for (const t of userTurns) {
    if (!langSessions.has(t.language)) langSessions.set(t.language, new Set())
    langSessions.get(t.language)!.add(t.session_id)
  }
  const langTotal = analyzable || 1
  const languagesArr = [...langSessions.entries()].map(([language, s]) => ({ language, sessions: s.size, pct: Math.round((s.size / langTotal) * 100) })).sort((a, b) => b.sessions - a.sessions)

  // ── open questions summary ──
  const byClass = new Map<string, number>(), byStatus = new Map<string, number>()
  for (const q of loggedQ) { byClass.set(q.classification, (byClass.get(q.classification) || 0) + 1); byStatus.set(q.status, (byStatus.get(q.status) || 0) + 1) }
  const openQuestions = {
    byClassification: [...byClass.entries()].map(([classification, count]) => ({ classification, count })).sort((a, b) => b.count - a.count),
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    open: loggedQ.filter((q: any) => q.status === 'open').slice(0, 40).map((q: any) => ({ question: q.user_message, classification: q.classification, language: q.language, suggestedKb: q.suggested_kb_addition, createdAt: q.created_at })),
  }

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
  const health = computeHealth(sessions, impressions, loggedQ.filter((q: any) => q.status === 'open').length)
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
      conversations: analyzable,
      abandonedNoInput: abandoned,
      openedNotEngaged: (totalImpressions != null && totalImpressions > 0) ? Math.max(0, totalImpressions - analyzable) : null,
      totalPairs,
      medianPairs,
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
      excludedZeroPair: abandoned,
      method: 'Deck-time batch classification (Haiku); existing live tags reused where present. Non-English analyzed on translated text, reported by source language.',
    },
  }

  // ── persist cache (service-role upsert; org_id paired) ──
  await service.from('agent_study_cache').upsert({
    bot_id: botId, org_id: bot.org_id, cache_key: cacheKey, analysis: study as any, updated_at: new Date().toISOString(),
  }, { onConflict: 'bot_id' })

  return study
}
