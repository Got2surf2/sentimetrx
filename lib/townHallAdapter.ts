// lib/townHallAdapter.ts
//
// Phase 5 commit 6 (docs/CONVERGENCE.md § 4): the facilitator dashboard
// surfaces (`/api/townhall/sessions` list + `/api/townhall/sessions/[id]`
// detail) were originally written against the legacy townhall_sessions
// + townhall_themes + townhall_turns schema. Phase 5 introduced the new
// substrate (pulseiq_sessions + pulseiq_topics + pulseiq_session_conversations
// over conversations + conversation_turns) but didn't rewire the read
// path.
//
// Rather than rewrite the 718-line analytics pipeline against the new
// schema, this module projects new-substrate rows into the SAME JSON
// shape the existing SessionDetailClient (and list page) already
// consume. Surfaces that pre-date the convergence keep their existing
// view; new pulseiq_sessions slugs appear alongside them without any UI
// change.
//
// Mutations (theme PATCH/POST, session PATCH, etc.) are NOT routed
// through this adapter today. New-substrate town halls are read-only
// from the facilitator surface for now. Mutation surfaces will rewire
// in a follow-on commit when there's an actual customer demand
// (zero live PulseIQ customers as of 2026-05-22, so urgency is low).
//
// Analytics-mode (2026-07-04): the ?analytics=true branch computes REAL
// analytics via the shared lib/townhallAnalytics pipeline (extracted from
// the legacy route) over fetchTurnsAsLegacy projections — identical
// numbers and response shape to the legacy route, so the analytics panel
// works on both substrates.
//
// Status mapping (new → legacy):
//   draft  → setup
//   live   → active
//   paused → paused
//   closed → ended

import type { createServiceRoleClient } from '@/lib/supabase/server'
import { logError } from '@/lib/log'
import { computeSessionAnalytics } from '@/lib/townhallAnalytics'
import type { ContentSafetyConfig } from '@/lib/contentGuard'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

// ── Row / projection shapes ─────────────────────────────────────────────────
// Minimal structural types for the new-substrate rows this adapter reads and
// the legacy-shaped JSON it projects them into. The service-role client is
// untyped (no Database generic), so `select('*')` yields `any` rows — these
// interfaces annotate the projection functions so downstream callers get a
// real shape rather than `any`.

interface CohortConfig {
  bot_name?: string
  bot_emoji?: string
  context?: {
    org_name?: string
    event_description?: string
    tone?: string
    sensitive_topics?: unknown[]
    priority_areas?: unknown[]
  }
  opening_message?: string
  closing_message?: string
  engine?: Record<string, unknown>
  session_end?: Record<string, unknown>
  display?: Record<string, unknown>
  content_safety?: Partial<ContentSafetyConfig>
  [key: string]: unknown
}

interface PulseiqTopicRow {
  id: string
  label: string
  description?: string | null
  question: string
  follow_up_angles?: unknown[]
  state?: string
  source?: string
  response_target?: number
  response_count?: number
  mention_count?: number
  keywords?: string[]
  sort_order?: number
  detected_at?: string | null
  approved_at?: string | null
  completed_at?: string | null
  created_at: string
  example_quote?: string | null
  round_number?: number | null
}

interface PulseiqSessionRow {
  id: string
  org_id: string
  bot_id: string
  created_by: string | null
  name: string
  slug: string
  status: string
  cohort_config: CohortConfig | null
  discussion_guide: unknown
  started_at: string | null
  ended_at: string | null
  created_at: string
  updated_at: string
}

interface LegacyTheme {
  id: string
  session_id: string
  label: string
  description: string | null
  question: string
  follow_up_angles: unknown[]
  state: string
  source: string
  response_target: number
  response_count: number
  mention_count: number
  keywords: string[]
  sentiment: string | null
  sort_order: number
  detected_at: string | null
  approved_at: string | null
  completed_at: string | null
  created_at: string
  example_quote: string | null
}

interface LegacySession {
  id: string
  study_id: null
  org_id: string
  created_by: string | null
  name: string
  slug: string
  status: 'setup' | 'active' | 'paused' | 'ended'
  config: CohortConfig
  discussion_guide: unknown[]
  response_counter: number
  started_at: string | null
  ended_at: string | null
  created_at: string
  updated_at: string
  __substrate: string
}

type TownHallListItem = LegacySession & {
  participants: number
  turns: number
  org_name: string | null
}

// Shapes returned by the conversation-link + turn-count fetches in
// computeBasicStats (mirrors the LinkConv type used by fetchTurnsAsLegacy).
type LinkConvRow = { id: string; session_id: string; participant_id: string | null; org_id: string }
type LinkRow = { conversation_id: string; conversations: LinkConvRow | LinkConvRow[] }
type TurnCountRow = { conversation_id: string; topic_id: string | null; created_at: string }

/**
 * PostgREST caps any single select at the project max-rows setting (1000
 * here — see sql/146's comment). A `.limit(5000)` or `.range(0, 49999)` is
 * a CEILING, not a fetch size: the response silently truncates at 1000.
 * This helper pages through in 1000-row chunks up to `cap` total rows.
 * The caller rebuilds the query per page (PostgREST builders are single-use).
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<unknown>,
  cap = 50000,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = (await build(from, Math.min(from + PAGE, cap) - 1)) as { data: T[] | null; error: unknown }
    if (error) { void logError('townHallAdapter.fetchAllRows', error); break }
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

const STATUS_MAP: Record<string, 'setup' | 'active' | 'paused' | 'ended'> = {
  draft:  'setup',
  live:   'active',
  paused: 'paused',
  closed: 'ended',
}

function projectStatus(s: string): 'setup' | 'active' | 'paused' | 'ended' {
  return STATUS_MAP[s] || 'setup'
}

// Projects a pulseiq_topics row into the legacy townhall_themes JSON
// shape. Fields the dashboard doesn't render are still populated with
// sensible defaults so downstream code doesn't NPE.
function projectTopicAsTheme(t: PulseiqTopicRow, sessionId: string): LegacyTheme {
  return {
    id:               t.id,
    session_id:       sessionId,
    label:            t.label,
    description:      t.description ?? null,
    question:         t.question,
    follow_up_angles: t.follow_up_angles ?? [],
    state:            t.state === 'rejected' ? 'dismissed' : (t.state === 'pending' ? 'detected' : (t.state || 'active')),
    source:           t.source === 'auto_detected' ? 'auto_detected' : (t.source === 'manual' ? 'custom' : 'guide'),
    response_target:  t.response_target ?? 5,
    response_count:   t.response_count ?? 0,
    mention_count:    t.mention_count ?? 0,
    keywords:         t.keywords ?? [],
    sentiment:        null,
    sort_order:       t.sort_order ?? 0,
    detected_at:      t.detected_at ?? null,
    approved_at:      t.approved_at ?? null,
    completed_at:     t.completed_at ?? null,
    created_at:       t.created_at,
    example_quote:    t.example_quote ?? null,
  }
}

// Projects a pulseiq_sessions row into a legacy-shaped townhall_sessions row
// (no themes, no turns — just the parent fields). Used by both list +
// detail surfaces.
function projectTownHallAsSession(h: PulseiqSessionRow): LegacySession {
  const cohortConfig: CohortConfig = (h.cohort_config && typeof h.cohort_config === 'object') ? h.cohort_config : {}
  const minimalConfig = {
    bot_name:  cohortConfig.bot_name  || h.name || 'Agent',
    bot_emoji: cohortConfig.bot_emoji || '🗳️',
    context: {
      org_name:          cohortConfig?.context?.org_name          || '',
      event_description: cohortConfig?.context?.event_description || '',
      tone:              cohortConfig?.context?.tone               || '',
      sensitive_topics:  cohortConfig?.context?.sensitive_topics   || [],
      priority_areas:    cohortConfig?.context?.priority_areas     || [],
    },
    opening_message: cohortConfig.opening_message || '',
    closing_message: cohortConfig.closing_message || '',
    engine: cohortConfig.engine || {
      theme_detection_mode:              'auto',
      theme_detection_interval_minutes:  60,
      theme_detection_every_n_responses: 20,
      max_turns_per_participant:         30,
      default_response_target:           5,
      max_active_themes:                 12,
      ai_timeout_ms:                     20000,
    },
    session_end: cohortConfig.session_end || { mode: 'manual', duration_minutes: null, inactivity_timeout_minutes: null },
    display:     cohortConfig.display     || { skip_label: 'Skip', done_label: 'Done' },
    content_safety: cohortConfig.content_safety || {},
    ...cohortConfig,
  }
  return {
    id:               h.id,
    study_id:         null,
    org_id:           h.org_id,
    created_by:       h.created_by,
    name:             h.name,
    slug:             h.slug,
    status:           projectStatus(h.status),
    config:           minimalConfig,
    discussion_guide: Array.isArray(h.discussion_guide) ? h.discussion_guide : [],
    response_counter: 0,
    started_at:       h.started_at,
    ended_at:         h.ended_at,
    created_at:       h.created_at,
    updated_at:       h.updated_at,
    // Marker so callers can identify substrate (e.g. tagging behavior)
    __substrate:      'phase3',
  }
}

// Compute basic participant/turn stats from pulseiq_session_conversations →
// conversations → conversation_turns for a single town hall.
//
// Phase-3 fix 2026-05-26: also return per-conversation turn count, first
// and last activity timestamps, and per-topic response counts (computed
// live the same way chatCore picks the next topic — by counting
// conversation_turns.topic_id rather than reading the async-updated
// pulseiq_topics.response_count column). The persisted column lags
// behind real activity by up to ~15 min (cron) and was showing 0 on the
// Responses tab and theme cards even for fully populated sessions.
async function computeBasicStats(db: ServiceClient, townHallId: string, orgId: string): Promise<{
  participants: number
  turns: number
  conversations: { id: string; session_id: string; participant_id: string | null }[]
  perConv: Record<string, { turns: number; firstAt: string | null; lastAt: string | null; topicCount: number }>
  // For each topic_id: response_count = distinct conversations that touched
  // this topic (how many participants we've heard from on it — the semantic
  // the cron aggregator and chatCore's "under-target" sort already use).
  // mention_count = total user turns tagged with this topic (how many times
  // it came up in user messages overall — a conversation that stayed on one
  // topic for 3 turns contributes 3 mentions but 1 response).
  perTopic: Record<string, { responses: number; mentions: number }>
}> {
  const linkRows = await fetchAllRows<LinkRow>((from, to) => db
    .from('pulseiq_session_conversations')
    .select('conversation_id, conversations!inner(id, session_id, participant_id, org_id)')
    .eq('town_hall_id', townHallId)
    .eq('org_id', orgId)
    .order('conversation_id', { ascending: true })
    .range(from, to), 5000)

  const conversations = linkRows
    .map(r => Array.isArray(r.conversations) ? r.conversations[0] : r.conversations)
    .filter(Boolean)
    .map(c => ({ id: c.id as string, session_id: c.session_id as string, participant_id: c.participant_id ?? null }))

  if (conversations.length === 0) {
    return { participants: 0, turns: 0, conversations: [], perConv: {}, perTopic: {} }
  }

  // One query shape: user-role turns with conversation + topic + timestamp.
  // Lets us derive total turns, per-participant turns, and per-topic counts
  // without three separate aggregations. Filtered on the stamped
  // town_hall_id column — the old `.in(conversation_id, convIds)` broke at
  // a few hundred participants on URL length. Paged — the unbounded select
  // was silently capped at 1000 rows by PostgREST.
  const turnRows = await fetchAllRows<TurnCountRow>((from, to) => db
    .from('conversation_turns')
    .select('conversation_id, topic_id, created_at')
    .eq('town_hall_id', townHallId)
    .eq('role', 'user')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .range(from, to), 50000)

  const perConv: Record<string, { turns: number; firstAt: string | null; lastAt: string | null; topicCount: number; topicSet: Set<string> }> = {}
  for (const c of conversations) perConv[c.id] = { turns: 0, firstAt: null, lastAt: null, topicCount: 0, topicSet: new Set<string>() }

  // For each topic, track which conversations touched it (Set for distinct
  // count → response_count) and how many turns mentioned it (raw counter
  // → mention_count).
  const perTopicConvs: Record<string, Set<string>> = {}
  const perTopicMentions: Record<string, number> = {}

  for (const t of turnRows) {
    const cid = t.conversation_id as string
    const entry = perConv[cid]
    if (!entry) continue
    entry.turns += 1
    if (!entry.firstAt) entry.firstAt = t.created_at as string
    entry.lastAt = t.created_at as string
    if (t.topic_id) {
      const tid = t.topic_id as string
      entry.topicSet.add(tid)
      if (!perTopicConvs[tid]) perTopicConvs[tid] = new Set<string>()
      perTopicConvs[tid].add(cid)
      perTopicMentions[tid] = (perTopicMentions[tid] || 0) + 1
    }
  }

  const perTopic: Record<string, { responses: number; mentions: number }> = {}
  for (const tid of Object.keys(perTopicMentions)) {
    perTopic[tid] = { responses: perTopicConvs[tid].size, mentions: perTopicMentions[tid] }
  }

  // Flatten topicSet → count
  const perConvOut: Record<string, { turns: number; firstAt: string | null; lastAt: string | null; topicCount: number }> = {}
  for (const cid of Object.keys(perConv)) {
    const e = perConv[cid]
    perConvOut[cid] = { turns: e.turns, firstAt: e.firstAt, lastAt: e.lastAt, topicCount: e.topicSet.size }
  }

  const totalTurns = Object.values(perConvOut).reduce((s, e) => s + e.turns, 0)
  const participantKeys = new Set<string>()
  for (const c of conversations) participantKeys.add(c.participant_id || c.session_id)

  return { participants: participantKeys.size, turns: totalTurns, conversations, perConv: perConvOut, perTopic }
}

// ── PUBLIC ────────────────────────────────────────────────────────────────

/**
 * Resolves a slug or uuid to a pulseiq_sessions row and returns the full
 * facilitator-dashboard JSON payload in the same shape as the legacy
 * `/api/townhall/sessions/[id]` GET (session + themes + stats +
 * participants). Returns null if the identifier doesn't match a
 * pulseiq_sessions row — the caller should fall back to the legacy path.
 *
 * Analytics-mode (the ?analytics=true branch) computes the full legacy
 * analytics payload from the new substrate (shared lib/townhallAnalytics).
 */
export async function getTownHallAsLegacy(
  db: ServiceClient,
  slugOrId: string,
  opts: { analyticsMode?: boolean; bucketParam?: string | null } = {},
  // Return type stays `any` (rather than the structured TownHallLegacyPayload
  // below) because a stale verification script reads analytics fields that
  // moved under `.analytics` — narrowing here would break its typecheck.
): Promise<any | null> {
  // First try id, then slug. Slug is the more common public lookup.
  let hall: PulseiqSessionRow | null = null
  if (/^[0-9a-f-]{36}$/i.test(slugOrId)) {
    const { data, error: idErr } = await db.from('pulseiq_sessions').select('*').eq('id', slugOrId).maybeSingle()
    if (idErr) void logError('townHallAdapter.getTownHallAsLegacy', idErr)
    if (data) hall = data
  }
  if (!hall) {
    const { data, error: slugErr } = await db.from('pulseiq_sessions').select('*').eq('slug', slugOrId.toLowerCase()).maybeSingle()
    if (slugErr) void logError('townHallAdapter.getTownHallAsLegacy', slugErr)
    if (data) hall = data
  }
  if (!hall) return null

  const session = projectTownHallAsSession(hall)

  const { data: topics, error: topicsErr } = await db
    .from('pulseiq_topics')
    .select('*')
    .eq('town_hall_id', hall.id)
    .eq('org_id', hall.org_id)
    .order('sort_order', { ascending: true })
  if (topicsErr) void logError('townHallAdapter.getTownHallAsLegacy', topicsErr, { orgId: hall.org_id })

  const basics = await computeBasicStats(db, hall.id, hall.org_id)

  // Overlay live counts onto the persisted pulseiq_topics columns so
  // theme cards reflect current activity rather than the lagging
  // async-aggregator value:
  //   - response_count = distinct conversations on this topic
  //     ("how many people we've heard from" — the same semantic the
  //     cron aggregator and pickNextTopic's under-target sort use).
  //   - mention_count  = total user turns tagged with this topic
  //     ("how many times the topic came up overall" — a conversation
  //     that stayed on one topic for 3 turns contributes 3 mentions
  //     but 1 response).
  const themes = (topics || []).map((t: PulseiqTopicRow) => {
    const projected = projectTopicAsTheme(t, hall.id)
    const live = basics.perTopic[t.id]
    if (live) {
      projected.response_count = Math.max(projected.response_count || 0, live.responses)
      projected.mention_count  = Math.max(projected.mention_count  || 0, live.mentions)
    }
    return projected
  })

  const stats = {
    joined:           basics.participants,
    total_turns:      basics.turns,
    answered:         basics.turns,
    skipped:          0,
    skip_rate:        0,
    avg_words:        0,
    avg_turns:        basics.participants > 0 ? +(basics.turns / basics.participants).toFixed(1) : 0,
    survey_responses: 0,
  }

  const participantSummary = basics.conversations.map(c => {
    const conv = basics.perConv[c.id] || { turns: 0, firstAt: null, lastAt: null, topicCount: 0 }
    return {
      participant_id: c.participant_id || c.session_id,
      turns:          conv.turns,
      answered:       conv.turns,
      skipped:        0,
      topics:         conv.topicCount,
      last_source:    null,
      is_complete:    false,
      started_at:     conv.firstAt,
      last_activity:  conv.lastAt,
    }
  })

  if (!opts.analyticsMode) {
    return { session, themes, stats, participants: participantSummary }
  }

  // Analytics mode — same pipeline as the legacy route (extracted to
  // lib/townhallAnalytics 2026-07-04), fed by the legacy-shaped turn
  // projection the exports already use. The old empty-analytics shell
  // also had the WRONG shape (top-level fields instead of the `analytics`
  // object TownHallAnalyticsPanel reads), so new-substrate sessions
  // rendered a blank panel.
  const legacyTurns = await fetchTurnsAsLegacy(db, hall.id, hall.org_id)
  const { enrichedThemes, analytics } = computeSessionAnalytics({
    turns: legacyTurns,
    themes,
    safetyConfig: session.config?.content_safety || {},
    bucketParam: opts.bucketParam ?? null,
  })

  return {
    session,
    themes: enrichedThemes,
    stats,
    participants: participantSummary,
    analytics,
  }
}

/**
 * Resolves a slug or uuid against `pulseiq_sessions` and returns the parent
 * row directly (no theme/stat enrichment). Used by participant-facing
 * routes (`/api/townhall/join`, `/api/townhall/live`) that only need
 * session-level fields. Returns null if no match.
 */
export async function resolveTownHall(
  db: ServiceClient,
  slugOrId: string,
): Promise<PulseiqSessionRow | null> {
  let hall: PulseiqSessionRow | null = null
  if (/^[0-9a-f-]{36}$/i.test(slugOrId)) {
    const { data, error: idErr } = await db.from('pulseiq_sessions').select('*').eq('id', slugOrId).maybeSingle()
    if (idErr) void logError('townHallAdapter.resolveTownHall', idErr)
    if (data) hall = data
  }
  if (!hall) {
    const { data, error: slugErr } = await db.from('pulseiq_sessions').select('*').eq('slug', slugOrId.toLowerCase()).maybeSingle()
    if (slugErr) void logError('townHallAdapter.resolveTownHall', slugErr)
    if (data) hall = data
  }
  return hall
}

/**
 * Projects a `pulseiq_sessions` row into the same `session` shape `getTownHallAsLegacy`
 * returns — exposed so participant routes (`/api/townhall/join`) can reuse
 * the projection without re-fetching topics / stats. Static; never hits the DB.
 */
export function projectHallAsSession(hall: PulseiqSessionRow): LegacySession {
  return projectTownHallAsSession(hall)
}

/**
 * Projects pulseiq_topics rows for a town hall into the legacy
 * townhall_themes JSON shape (source seed→guide / manual→custom, state
 * rejected→dismissed / pending→detected). Exposed for reader surfaces
 * (exports, PPTX) that consume theme rows directly.
 */
export async function fetchTopicsAsThemes(
  db: ServiceClient,
  townHallId: string,
  orgId: string,
): Promise<(LegacyTheme & { round_number: number | null })[]> {
  const { data: topics, error } = await db
    .from('pulseiq_topics')
    .select('*')
    .eq('town_hall_id', townHallId)
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
  if (error) void logError('townHallAdapter.fetchTopicsAsThemes', error, { orgId })
  return (topics || []).map((t: PulseiqTopicRow) => ({ ...projectTopicAsTheme(t, townHallId), round_number: t.round_number ?? null }))
}

// Legacy-shaped turn row (one row per user exchange, as townhall_turns
// stored it). Trailing unanswered assistant questions emit a row with
// user_message null so exports show the open question, matching legacy.
export interface LegacyShapedTurn {
  participant_id: string
  turn_number: number
  bot_message: string | null
  user_message: string | null
  user_message_en: string | null
  language: string | null
  theme_id: string | null
  theme_label: string | null
  source: string | null
  skipped: boolean
  sentiment: string | null
  sentiment_score: number | null
  created_at: string
}

/**
 * Fetches conversation_turns for every conversation linked to a town hall
 * and projects them into the legacy townhall_turns row shape: each user
 * turn pairs with the most recent preceding assistant turn in the same
 * conversation. Skip markers (`[Skipped …]`) become skipped=true with a
 * null user_message; `[filtered]` keeps the marker text with skipped=true
 * (both match the legacy transcript conventions the export sheets and
 * PPTX aggregations already understand).
 */
export async function fetchTurnsAsLegacy(
  db: ServiceClient,
  townHallId: string,
  orgId: string,
): Promise<LegacyShapedTurn[]> {
  type LinkConv = { id: string; session_id: string; participant_id: string | null; org_id: string }
  const linkRows = await fetchAllRows<{ conversations: LinkConv | LinkConv[] }>((from, to) => db
    .from('pulseiq_session_conversations')
    .select('conversation_id, conversations!inner(id, session_id, participant_id, org_id)')
    .eq('town_hall_id', townHallId)
    .eq('org_id', orgId)
    .order('conversation_id', { ascending: true })
    .range(from, to), 5000)
  const convs = linkRows
    .map(r => Array.isArray(r.conversations) ? r.conversations[0] : r.conversations)
    .filter(Boolean)
  if (convs.length === 0) return []
  const partByConv: Record<string, string> = {}
  for (const c of convs) partByConv[c.id] = c.participant_id || c.session_id

  // Filtered on the stamped town_hall_id column — the old
  // `.in(conversation_id, …)` broke at a few hundred participants on URL
  // length. The link fetch above stays for the conversation → participant map.
  const cts = await fetchAllRows((from, to) => db
    .from('conversation_turns')
    .select('id, conversation_id, turn_number, role, content, content_en, language, source, sentiment, sentiment_score, topic_id, created_at')
    .eq('town_hall_id', townHallId)
    .eq('org_id', orgId)
    .order('conversation_id', { ascending: true })
    .order('turn_number', { ascending: true })
    .range(from, to), 50000)
  if (cts.length === 0) return []

  type MirrorTurn = {
    id: string; conversation_id: string; turn_number: number; role: string
    content: string | null; content_en: string | null; language: string | null
    source: string | null; sentiment: string | null; sentiment_score: number | null
    topic_id: string | null; created_at: string
  }
  const mirrorTurns = cts as MirrorTurn[]

  const topicIds = Array.from(new Set(mirrorTurns.map(t => t.topic_id).filter(Boolean))) as string[]
  const topicLabel: Record<string, string> = {}
  if (topicIds.length > 0) {
    const { data: topics } = await db.from('pulseiq_topics').select('id, label').in('id', topicIds).eq('org_id', orgId)
    for (const t of (topics || []) as { id: string; label: string }[]) topicLabel[t.id] = t.label
  }

  const byConv: Record<string, MirrorTurn[]> = {}
  for (const r of mirrorTurns) {
    if (!byConv[r.conversation_id]) byConv[r.conversation_id] = []
    byConv[r.conversation_id].push(r)
  }

  const out: LegacyShapedTurn[] = []
  for (const convId of Object.keys(byConv)) {
    const pid = partByConv[convId]
    let pendingAssistant: MirrorTurn | null = null
    // Legacy semantics: turn_number counts EXCHANGES per participant
    // (1, 2, 3, …) — not the raw per-message index of the new store
    // (which is 0,2,4,… for user messages and confused export readers).
    let exchangeNo = 0
    for (const ct of byConv[convId]) {
      if (ct.role === 'assistant') {
        pendingAssistant = ct
        continue
      }
      const content = String(ct.content || '')
      const isSkip = /^\[Skipped/i.test(content)
      const isFiltered = /^\[filtered\]/i.test(content)
      exchangeNo += 1
      out.push({
        participant_id: pid,
        turn_number: exchangeNo,
        bot_message: pendingAssistant?.content ?? null,
        user_message: isSkip ? null : content,
        user_message_en: isSkip ? null : (ct.content_en ?? null),
        language: ct.language ?? null,
        theme_id: ct.topic_id ?? null,
        theme_label: ct.topic_id ? (topicLabel[ct.topic_id] || null) : null,
        // The exchange's source describes how the BOT's side was served
        // (clarifier / standby / deflect …) — take it from the assistant
        // turn when present; the user side is almost always 'normal'.
        source: pendingAssistant?.source ?? ct.source ?? null,
        skipped: isSkip || isFiltered,
        sentiment: ct.sentiment ?? null,
        sentiment_score: typeof ct.sentiment_score === 'number' ? ct.sentiment_score : null,
        created_at: ct.created_at,
      })
      pendingAssistant = null
    }
    // Trailing open question (bot asked, nobody answered yet).
    if (pendingAssistant) {
      exchangeNo += 1
      out.push({
        participant_id: pid,
        turn_number: exchangeNo,
        bot_message: pendingAssistant.content ?? null,
        user_message: null,
        user_message_en: null,
        language: pendingAssistant.language ?? null,
        theme_id: pendingAssistant.topic_id ?? null,
        theme_label: pendingAssistant.topic_id ? (topicLabel[pendingAssistant.topic_id] || null) : null,
        source: pendingAssistant.source ?? null,
        skipped: false,
        sentiment: null,
        sentiment_score: null,
        created_at: pendingAssistant.created_at,
      })
    }
  }
  out.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
  return out
}

/**
 * Lists every pulseiq_sessions row in scope and returns each in the legacy
 * townhall_sessions list shape used by /api/townhall/sessions.
 *
 * Returns null on a query ERROR (so the route can 500 instead of rendering
 * a false "no sessions" empty state); [] means a genuine empty list.
 *
 * Admin callers may pass scopeOrgId=null to fetch across all orgs;
 * non-admin callers must pass their own orgId.
 */
export async function listTownHallsAsLegacy(
  db: ServiceClient,
  scopeOrgId: string | null,
): Promise<TownHallListItem[] | null> {
  let q = db
    .from('pulseiq_sessions')
    .select('id, org_id, name, slug, status, cohort_config, discussion_guide, response_target, started_at, ended_at, created_at, updated_at, created_by')
    .order('created_at', { ascending: false })
  if (scopeOrgId) q = q.eq('org_id', scopeOrgId)

  const { data: halls, error } = await q
  if (error) {
    void logError('townHallAdapter.listTownHallsAsLegacy', error, { orgId: scopeOrgId ?? undefined })
    return null
  }
  if (!halls || halls.length === 0) return []

  // Pull participants + turns counts per town hall in a small fan-out.
  // Number of town halls is small (1 today, low double digits realistic)
  // — no need for a heroic single-query CTE.
  const results: TownHallListItem[] = []
  // The list select omits bot_id (unused by the projection/stats below), so
  // the rows aren't structurally full PulseiqSessionRow — cast through unknown.
  for (const h of halls as unknown as PulseiqSessionRow[]) {
    const projected = projectTownHallAsSession(h)
    const basics = await computeBasicStats(db, h.id, h.org_id)
    results.push({
      ...projected,
      participants: basics.participants,
      turns:        basics.turns,
      org_name:     null, // list route fills this for admin
    })
  }
  return results
}
