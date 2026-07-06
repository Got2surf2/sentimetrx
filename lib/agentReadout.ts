// lib/agentReadout.ts
//
// The Agent Conversation Readout — the content-first companion to the Agent
// Study (lib/agentStudy.ts). Where the Study leads with health/ops metrics
// (volume, depth, response rate), the Readout answers the two questions a
// stakeholder actually asks after a town hall or a campaign:
//
//   1. "What did people ASK?"      → questionThemes — every substantive user
//                                     question, grouped by theme.
//   2. "What did people RAISE on    → beyondThemes — the observations, concerns,
//       their own?"                   suggestions, and opinions users volunteered
//                                     beyond their questions, grouped by theme.
//
// Theming is HYBRID: the agent's declared focuses are the scaffold (a question
// that fits one is filed under it), and an emergent label is mined for anything
// outside the catalog — so the readout surfaces topics the builder never
// configured, which is the whole point of "beyond the questions." Agents with
// no focuses fall through to fully-emergent theming.
//
// Reuses the Agent Study's turn loading + review gate + exchange shaping (the
// exported helpers in lib/agentStudy.ts) so the two reports never disagree on
// which conversations count. Memoized in agent_readout_cache, keyed on a
// content hash, exactly like the study.

import crypto from 'crypto'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { logError } from '@/lib/log'
import {
  loadTurns, groupSessions, partitionByReview, buildExchanges, text, runConcurrent,
  type Exchange,
} from '@/lib/agentStudy'
import { resolveBrandGlossary, glossaryTerms } from '@/lib/correction/glossary'
import { polishVerbatims } from '@/lib/correction/polish'

// ── Types ────────────────────────────────────────────────────────────────────
interface Sentiment { positive: number; neutral: number; negative: number }

export interface QuestionTheme {
  label: string
  source: 'focus' | 'emergent'   // declared focus vs mined-from-the-data
  slug: string | null            // focus slug when source==='focus'
  questions: number              // substantive question exchanges in this theme
  sessions: number               // distinct conversations that touched it
  sentiment: Sentiment
  samples: { text: string; language: string; sentiment: string | null }[]  // representative verbatim questions
}

export interface BeyondTheme {
  label: string
  comments: number               // volunteered comments in this theme
  sessions: number
  sentiment: Sentiment
  samples: { quote: string; sentiment: string | null }[]  // representative verbatim comments
}

export interface AgentReadout {
  bot: { id: string; name: string }
  title: string                  // per-agent override (bot.config.readoutTitle) or default
  generatedAt: string
  cacheKey: string
  range: { first: string | null; last: string | null; activeDays: number }
  scope: {
    conversations: number        // useful sessions (the denominator for honesty)
    questions: number            // total substantive question exchanges themed
    beyondComments: number       // total volunteered comments themed
    focusesConfigured: number    // how many declared focuses the agent has
  }
  questionThemes: QuestionTheme[]
  beyondThemes: BeyondTheme[]
  summary: { overview: string; takeaways: string[] }
  meta: { method: string; classifiedExchanges: number }
}

interface BotRow {
  id: string
  name: string
  org_id: string
  focuses: { slug: string; label: string; description?: string; enabled?: boolean }[]
  config: Record<string, any>
}

// Per-exchange tag from the classify pass. A single user turn can carry both a
// question and a volunteered comment, so both fields are independent.
interface ReadoutTag {
  focus: string | null    // declared-focus slug the question fits, or null
  qLabel: string | null   // short emergent topic for the question (used when focus is null); null if not a real question
  comment: string | null  // verbatim volunteered observation/concern/suggestion, or null
  cLabel: string | null   // short emergent topic for the comment
}

const blankSentiment = (): Sentiment => ({ positive: 0, neutral: 0, negative: 0 })
function tallySentiment(s: Sentiment, sent: string | null) {
  if (sent === 'positive' || sent === 'negative') s[sent]++
  else s.neutral++
}

// ── Pass A: classify each exchange (AI, batched — mirrors agentStudy) ─────────
async function classifyExchanges(botId: string, orgId: string, botName: string, focuses: BotRow['focuses'], exchanges: Exchange[]): Promise<ReadoutTag[]> {
  const enabled = focuses.filter(f => f.enabled !== false)
  const catalog = enabled.map(f => `- ${f.slug}: ${f.label}${f.description ? ' — ' + f.description : ''}`).join('\n')
  const BATCH = 12
  const batches: Exchange[][] = []
  for (let i = 0; i < exchanges.length; i += BATCH) batches.push(exchanges.slice(i, i + BATCH))

  const results = await runConcurrent(batches, 5, async (batch) => {
    const lines = batch.map((e, i) => `[${i}] USER: ${text(e.question).slice(0, 400)}\n    AGENT: ${(e.answer ? text(e.answer) : '').slice(0, 200)}`).join('\n')
    const system = `You are organizing what people said to an agent called "${botName}" so a stakeholder can see what was asked and raised.

For each USER message, return four fields:

1. "focus": ${catalog ? `the slug of the ONE focus area below the question best fits, or null if none fit:\n${catalog}` : 'there is no focus catalog, so always null.'}

2. "q_label": a SHORT topic label (2–4 words, Title Case) for what the user is ASKING about — e.g. "Construction Timeline", "Traffic at Kelly Park", "Cost & Funding". Set null if the message is NOT a real question/information request (pure greeting, acknowledgement, or small talk). Always provide q_label for a genuine question, even when "focus" is also set.

3. "comment": if the user VOLUNTEERS a substantive observation, concern, complaint, suggestion, or opinion about the project/area (beyond just asking) — e.g. "the queue at Kelly Park backs up with no signal", "we need a crosswalk near the school" — set this to their verbatim message (lightly cleaned of typos, NOT paraphrased). Set null when the message is ONLY a question, greeting, ack, or small talk. A message can be BOTH a question and a comment.

4. "c_label": a SHORT topic label (2–4 words, Title Case) for the comment, or null when comment is null.

Return ONLY a JSON array, one object per index, no markdown:
[{"i":0,"focus":"slug_or_null","q_label":"Topic_or_null","comment":"verbatim_or_null","c_label":"Topic_or_null"}, ...]`
    const res = await callAI({ tier: 'fast', maxTokens: 1800, timeoutMs: 40000, system, messages: [{ role: 'user', content: lines }] })
    logUsage({ org_id: orgId, resource_type: 'bot', resource_id: botId, event_type: 'agent_readout_classify' }, res.usage)
    let parsed: any[] = []
    try { parsed = JSON.parse(res.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()) } catch { parsed = [] }
    return batch.map((_e, i) => {
      const p = parsed.find((x: any) => x && x.i === i) || {}
      const focus = typeof p.focus === 'string' && enabled.some(f => f.slug === p.focus) ? p.focus : null
      const qLabel = typeof p.q_label === 'string' && p.q_label.trim().length > 1 ? p.q_label.trim() : null
      const comment = typeof p.comment === 'string' && p.comment.trim().length > 3 ? p.comment.trim() : null
      const cLabel = comment && typeof p.c_label === 'string' && p.c_label.trim().length > 1 ? p.c_label.trim() : null
      return { focus, qLabel, comment, cLabel } as ReadoutTag
    })
  })
  return results.flat()
}

// ── Pass B: consolidate emergent labels into canonical themes (AI) ────────────
// The per-exchange labels drift heavily: "Traffic Operations", "Congestion
// Patterns", "Freeway Operations" are one theme; "Study Overview", "Project
// Overview", "NOWOCATS Overview" are another. Hand the model the distinct labels
// WITH their frequencies and get back a raw→canonical map that collapses
// synonyms into a compact set. Uses the standard tier (Sonnet) — the label list
// is tiny, so this is cheap, and clustering quality matters far more here than
// speed (Haiku under-merged). Question labels and comment labels are
// consolidated separately so each gets a focused taxonomy. `kind` only shapes
// the example in the prompt.
async function consolidateLabels(botId: string, orgId: string, botName: string, kind: 'question' | 'comment', counts: Map<string, number>): Promise<Map<string, string>> {
  const distinct = [...counts.keys()].map(l => l.trim()).filter(Boolean)
  const map = new Map<string, string>(distinct.map(l => [l, l]))   // identity fallback
  if (distinct.length < 2) return map
  const listing = distinct.map(l => `${l} (${counts.get(l)})`).join('\n')
  const example = kind === 'question'
    ? `e.g. "Study Overview", "Project Overview", "NOWOCATS Overview", "Study Information" all → "About the Study"`
    : `e.g. "Traffic Operations", "Congestion Patterns", "Freeway Operations", "Traffic Patterns" all → "Traffic & Congestion"`
  const res = await callAI({
    tier: 'standard', maxTokens: 1500, timeoutMs: 45000,
    system: `These are draft ${kind} topic labels (with frequencies) from conversations with an agent called "${botName}". Collapse them into a COMPACT set of canonical themes.
- Aggressively merge synonyms and overlapping/parent-child topics into one theme (${example}).
- But keep genuinely DISTINCT concerns separate — e.g. safety, congestion, and bike/pedestrian infrastructure are three different themes, not one.
- Aim for roughly 6–12 themes total unless the topics are truly diverse. Each canonical theme: clear, 2–4 words, Title Case.
Return ONLY a JSON object mapping EVERY input label (without its count) to its canonical theme, no markdown:
{"Traffic Operations":"Traffic & Congestion","Congestion Patterns":"Traffic & Congestion", ...}`,
    messages: [{ role: 'user', content: listing }],
  })
  logUsage({ org_id: orgId, resource_type: 'bot', resource_id: botId, event_type: 'agent_readout_consolidate' }, res.usage)
  try {
    const obj = JSON.parse(res.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    for (const raw of distinct) {
      const canon = obj[raw]
      if (typeof canon === 'string' && canon.trim().length > 1) map.set(raw, canon.trim())
    }
  } catch { /* keep identity map */ }
  return map
}

function countLabels(labels: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of labels) { const k = l.trim(); if (k) m.set(k, (m.get(k) || 0) + 1) }
  return m
}

// ── Pass C: executive summary over the themed structure (AI, one call) ────────
async function summarize(botId: string, orgId: string, botName: string, questionThemes: QuestionTheme[], beyondThemes: BeyondTheme[], conversations: number): Promise<AgentReadout['summary']> {
  const empty = { overview: '', takeaways: [] as string[] }
  if (!questionThemes.length && !beyondThemes.length) return empty
  const qBlock = questionThemes.map(t => `- ${t.label} (${t.questions} questions): ${t.samples.slice(0, 2).map(s => '"' + s.text.slice(0, 140) + '"').join('; ')}`).join('\n')
  const bBlock = beyondThemes.map(t => `- ${t.label} (${t.comments} comments): ${t.samples.slice(0, 2).map(s => '"' + s.quote.slice(0, 140) + '"').join('; ')}`).join('\n')
  const res = await callAI({
    tier: 'standard', maxTokens: 1200, timeoutMs: 45000,
    system: `You are writing the opening of a readout summarizing ${conversations} conversations people had with an agent called "${botName}". You are given the themes of what people ASKED and what they RAISED beyond their questions, with counts and sample verbatims.
Write a tight, factual synthesis — no fabricated statistics, no praise, just what the conversations show. Ground every claim in the supplied themes/counts.
Return ONLY JSON, no markdown:
{"overview":"2–3 sentence plain-English summary of what people asked and raised","takeaways":["4–6 specific, evidence-grounded bullets a decision-maker should note"]}`,
    messages: [{ role: 'user', content: `QUESTIONS BY THEME:\n${qBlock || '(none)'}\n\nRAISED BEYOND THE QUESTIONS:\n${bBlock || '(none)'}` }],
  })
  logUsage({ org_id: orgId, resource_type: 'bot', resource_id: botId, event_type: 'agent_readout_summary' }, res.usage)
  try {
    const a = JSON.parse(res.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    return { overview: typeof a.overview === 'string' ? a.overview : '', takeaways: Array.isArray(a.takeaways) ? a.takeaways.filter((s: any) => typeof s === 'string') : [] }
  } catch { return empty }
}

// ── Cache key ────────────────────────────────────────────────────────────────
// Bump when the AgentReadout SHAPE changes so stale cached readouts recompute.
//   v1 (2026-06-26): initial — questionThemes (hybrid) + beyondThemes + summary.
//   v2 (2026-06-27): sample verbatims polished via the shared correction layer
//   (lib/correction) — typos/mis-spellings cleaned, brand glossary applied.
const READOUT_SCHEMA_VERSION = 'v2'
function cacheKeyFor(pairTotal: number, bot: BotRow, title: string): string {
  const h = crypto.createHash('sha1')
  h.update(`${READOUT_SCHEMA_VERSION}|${pairTotal}|${title}|${JSON.stringify(bot.focuses || [])}`)
  return h.digest('hex').slice(0, 16)
}

// User-facing report name is "What We Heard" (the internal feature / route /
// table / file names stay "readout" per the project's slug-stays convention).
function defaultTitle(botName: string): string {
  return `${botName} — What We Heard`
}

// ── Main: getAgentReadout (compute-if-stale, cached) ──────────────────────────
export async function getAgentReadout(botId: string, opts: { force?: boolean } = {}): Promise<AgentReadout | null> {
  const service = createServiceRoleClient()
  const { data: botData, error: botDataErr } = await service
    .from('agents')
    .select('id, name, org_id, focuses, config')
    .eq('id', botId)
    .single()
  if (botDataErr) void logError('agentReadout.getAgentReadout', botDataErr)
  if (!botData) return null
  const bot: BotRow = {
    id: botData.id, name: botData.name, org_id: botData.org_id,
    focuses: Array.isArray(botData.focuses) ? botData.focuses : [],
    config: botData.config && typeof botData.config === 'object' ? botData.config : {},
  }
  const title = (typeof bot.config.readoutTitle === 'string' && bot.config.readoutTitle.trim())
    ? bot.config.readoutTitle.trim()
    : defaultTitle(bot.name)

  // Same gate + exchange shaping as the Agent Study (shared helpers).
  const allTurns = await loadTurns(service, botId)
  const { included: sessions } = await partitionByReview(service, botId, groupSessions(allTurns))
  const turns = [...sessions.values()].flat()

  let conversations = 0, totalPairs = 0
  const allExchanges: Exchange[] = []
  for (const [, ts] of sessions) {
    const ex = buildExchanges(ts)
    if (ex.length > 0) { conversations++; totalPairs += ex.length; allExchanges.push(...ex) }
  }
  const cacheKey = cacheKeyFor(totalPairs, bot, title)

  if (!opts.force) {
    const { data: cached, error: cachedErr } = await service.from('agent_readout_cache').select('cache_key, analysis').eq('bot_id', botId).single()
    if (cachedErr && cachedErr.code !== 'PGRST116') void logError('agentReadout.getAgentReadout', cachedErr, { orgId: bot.org_id })
    if (cached && cached.cache_key === cacheKey && cached.analysis) return cached.analysis as AgentReadout
  }

  // Pass A: classify every exchange.
  const tags = await classifyExchanges(botId, bot.org_id, bot.name, bot.focuses, allExchanges)

  // Pass B: consolidate the EMERGENT labels (questions with no focus, and all
  // comment labels) into canonical themes. Focus-matched questions keep their
  // declared label — only the mined labels need merging.
  const focusLabel = new Map(bot.focuses.filter(f => f.enabled !== false).map(f => [f.slug, f.label] as [string, string]))
  const emergentQ = allExchanges.map((_e, i) => (!tags[i].focus && tags[i].qLabel) ? tags[i].qLabel! : null).filter(Boolean) as string[]
  const emergentC = tags.map(t => t.cLabel).filter(Boolean) as string[]
  const [qCanon, cCanon] = await Promise.all([
    consolidateLabels(botId, bot.org_id, bot.name, 'question', countLabels(emergentQ)),
    consolidateLabels(botId, bot.org_id, bot.name, 'comment', countLabels(emergentC)),
  ])
  const qCanonOf = (raw: string) => qCanon.get(raw.trim()) || raw.trim()
  const cCanonOf = (raw: string) => cCanon.get(raw.trim()) || raw.trim()

  // ── Aggregate question themes (hybrid) ──
  interface QAgg { label: string; source: 'focus' | 'emergent'; slug: string | null; questions: number; sessions: Set<string>; sentiment: Sentiment; samples: QuestionTheme['samples'] }
  const qThemes = new Map<string, QAgg>()
  allExchanges.forEach((ex, i) => {
    const tag = tags[i]
    let key: string, label: string, source: 'focus' | 'emergent', slug: string | null
    if (tag.focus) {
      key = 'focus:' + tag.focus; label = focusLabel.get(tag.focus) || tag.focus; source = 'focus'; slug = tag.focus
    } else if (tag.qLabel) {
      label = qCanonOf(tag.qLabel); key = 'emergent:' + label.toLowerCase(); source = 'emergent'; slug = null
    } else {
      return  // not a real question (greeting/ack) — not a question theme
    }
    if (!qThemes.has(key)) qThemes.set(key, { label, source, slug, questions: 0, sessions: new Set(), sentiment: blankSentiment(), samples: [] })
    const agg = qThemes.get(key)!
    agg.questions++
    agg.sessions.add(ex.sessionId)
    tallySentiment(agg.sentiment, ex.question.sentiment)
    if (agg.samples.length < 5) agg.samples.push({ text: text(ex.question).slice(0, 280), language: ex.question.language, sentiment: ex.question.sentiment })
  })
  const questionThemes: QuestionTheme[] = [...qThemes.values()]
    .map(a => ({ label: a.label, source: a.source, slug: a.slug, questions: a.questions, sessions: a.sessions.size, sentiment: a.sentiment, samples: a.samples }))
    .sort((a, b) => b.questions - a.questions)

  // ── Aggregate "beyond the questions" themes ──
  interface BAgg { label: string; comments: number; sessions: Set<string>; sentiment: Sentiment; samples: BeyondTheme['samples'] }
  const bThemes = new Map<string, BAgg>()
  allExchanges.forEach((ex, i) => {
    const tag = tags[i]
    if (!tag.comment) return
    const label = tag.cLabel ? cCanonOf(tag.cLabel) : 'Other'
    const key = label.toLowerCase()
    if (!bThemes.has(key)) bThemes.set(key, { label, comments: 0, sessions: new Set(), sentiment: blankSentiment(), samples: [] })
    const agg = bThemes.get(key)!
    agg.comments++
    agg.sessions.add(ex.sessionId)
    tallySentiment(agg.sentiment, ex.question.sentiment)
    if (agg.samples.length < 5) agg.samples.push({ quote: tag.comment.slice(0, 320), sentiment: ex.question.sentiment })
  })
  const beyondThemes: BeyondTheme[] = [...bThemes.values()]
    .map(a => ({ label: a.label, comments: a.comments, sessions: a.sessions.size, sentiment: a.sentiment, samples: a.samples }))
    .sort((a, b) => b.comments - a.comments)

  // ── Polish sample verbatims (shared brand-correction layer) ──
  // Clean the verbatims we'll SHOW (typos / mis-spellings / grammar) via the
  // product-agnostic polish pass, seeded with the agent's brand+bot glossary —
  // same correction layer Town Hall uses. The raw source (conversation_turns) is
  // never mutated; we polish only the derived sample strings in this object. Done
  // BEFORE summarize so the executive summary cites cleaned text.
  try {
    const glossary = glossaryTerms(await resolveBrandGlossary(service, { orgId: bot.org_id, agentId: botId, authoritativeOnly: true }))
    const refs: Array<{ kind: 'q' | 'b'; t: number; s: number }> = []
    const toPolish: string[] = []
    questionThemes.forEach((th, t) => th.samples.forEach((s, si) => { refs.push({ kind: 'q', t, s: si }); toPolish.push(s.text) }))
    beyondThemes.forEach((th, t) => th.samples.forEach((s, si) => { refs.push({ kind: 'b', t, s: si }); toPolish.push(s.quote) }))
    if (toPolish.length) {
      const polished = await polishVerbatims(toPolish, { glossary, usage: { org_id: bot.org_id, resource_type: 'bot', resource_id: botId, event_type: 'verbatim_polish' } })
      refs.forEach((r, i) => {
        const p = polished[i]
        if (!p) return
        if (r.kind === 'q') questionThemes[r.t].samples[r.s].text = p
        else beyondThemes[r.t].samples[r.s].quote = p
      })
    }
  } catch (e: any) {
    console.error({ at: 'agent-readout', msg: 'verbatim polish failed (showing raw)', err: e?.message })
  }

  // Pass C: executive summary over the (now polished) themed structure.
  const summary = await summarize(botId, bot.org_id, bot.name, questionThemes, beyondThemes, conversations)

  const allDates = turns.map(t => new Date(t.created_at).getTime()).sort((a, b) => a - b)
  const activeDays = new Set(turns.map(t => t.created_at.slice(0, 10))).size
  const totalQuestions = questionThemes.reduce((s, t) => s + t.questions, 0)
  const totalComments = beyondThemes.reduce((s, t) => s + t.comments, 0)

  const readout: AgentReadout = {
    bot: { id: bot.id, name: bot.name },
    title,
    generatedAt: new Date().toISOString(),
    cacheKey,
    range: {
      first: allDates.length ? new Date(allDates[0]).toISOString() : null,
      last: allDates.length ? new Date(allDates[allDates.length - 1]).toISOString() : null,
      activeDays,
    },
    scope: {
      conversations,
      questions: totalQuestions,
      beyondComments: totalComments,
      focusesConfigured: bot.focuses.filter(f => f.enabled !== false).length,
    },
    questionThemes,
    beyondThemes,
    summary,
    meta: {
      classifiedExchanges: allExchanges.length,
      method: 'Questions and volunteered comments are themed from every substantive user message in the conversations we count as good (the same review gate as the Agent Study; trolls/bots/off-topic excluded). Themes are hybrid: a question matched to one of the agent’s declared focuses is filed there, otherwise its theme is mined from the message and near-duplicate themes are merged. Non-English messages are themed on their translation.',
    },
  }

  await service.from('agent_readout_cache').upsert({
    bot_id: botId, org_id: bot.org_id, cache_key: cacheKey, analysis: readout as any, updated_at: new Date().toISOString(),
  }, { onConflict: 'bot_id' })

  return readout
}
