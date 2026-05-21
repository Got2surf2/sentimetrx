// lib/townHallAdapter.ts
//
// Phase 5 commit 6 (docs/CONVERGENCE.md § 4): the facilitator dashboard
// surfaces (`/api/townhall/sessions` list + `/api/townhall/sessions/[id]`
// detail) were originally written against the legacy townhall_sessions
// + townhall_themes + townhall_turns schema. Phase 5 introduced the new
// substrate (town_halls + town_hall_topics + town_hall_conversations
// over conversations + conversation_turns) but didn't rewire the read
// path.
//
// Rather than rewrite the 718-line analytics pipeline against the new
// schema, this module projects new-substrate rows into the SAME JSON
// shape the existing SessionDetailClient (and list page) already
// consume. Surfaces that pre-date the convergence keep their existing
// view; new town_halls slugs appear alongside them without any UI
// change.
//
// Mutations (theme PATCH/POST, session PATCH, etc.) are NOT routed
// through this adapter today. New-substrate town halls are read-only
// from the facilitator surface for now. Mutation surfaces will rewire
// in a follow-on commit when there's an actual customer demand
// (zero live PulseIQ customers as of 2026-05-22, so urgency is low).
//
// Heavy analytics — keyword-regex matching, per-theme sentiment, time
// series, top-keyword frequencies, example-quote extraction — are not
// computed in this projector. They return empty arrays. When a real
// town hall ships and the facilitator needs analytics, that's the
// time to invest; for the sarina-cohort row used in Phase 5 testing
// the basic stats panel + topic list is enough.
//
// Status mapping (new → legacy):
//   draft  → setup
//   live   → active
//   paused → paused
//   closed → ended

import type { createServiceRoleClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

const STATUS_MAP: Record<string, 'setup' | 'active' | 'paused' | 'ended'> = {
  draft:  'setup',
  live:   'active',
  paused: 'paused',
  closed: 'ended',
}

function projectStatus(s: string): 'setup' | 'active' | 'paused' | 'ended' {
  return STATUS_MAP[s] || 'setup'
}

// Projects a town_hall_topics row into the legacy townhall_themes JSON
// shape. Fields the dashboard doesn't render are still populated with
// sensible defaults so downstream code doesn't NPE.
function projectTopicAsTheme(t: any, sessionId: string): any {
  return {
    id:               t.id,
    session_id:       sessionId,
    label:            t.label,
    description:      t.description ?? null,
    question:         t.question,
    follow_up_angles: t.follow_up_angles ?? [],
    state:            (t.state === 'rejected' ? 'dismissed' : t.state) || 'active',
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

// Projects a town_halls row into a legacy-shaped townhall_sessions row
// (no themes, no turns — just the parent fields). Used by both list +
// detail surfaces.
function projectTownHallAsSession(h: any): any {
  const cohortConfig = (h.cohort_config && typeof h.cohort_config === 'object') ? h.cohort_config : {}
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

// Compute basic participant/turn stats from town_hall_conversations →
// conversations → conversation_turns for a single town hall.
async function computeBasicStats(db: ServiceClient, townHallId: string, orgId: string): Promise<{
  participants: number
  turns: number
  conversations: { id: string; session_id: string; participant_id: string | null }[]
}> {
  const { data: linkRows } = await db
    .from('town_hall_conversations')
    .select('conversation_id, conversations!inner(id, session_id, participant_id, org_id)')
    .eq('town_hall_id', townHallId)
    .eq('org_id', orgId)
    .limit(2000)

  const conversations = ((linkRows || []) as any[])
    .map(r => Array.isArray(r.conversations) ? r.conversations[0] : r.conversations)
    .filter(Boolean)
    .map(c => ({ id: c.id as string, session_id: c.session_id as string, participant_id: c.participant_id ?? null }))

  if (conversations.length === 0) return { participants: 0, turns: 0, conversations: [] }

  const convIds = conversations.map(c => c.id)
  const { count: turnCount } = await db
    .from('conversation_turns')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', convIds)
    .eq('role', 'user')
    .eq('org_id', orgId)

  const participantKeys = new Set<string>()
  for (const c of conversations) participantKeys.add(c.participant_id || c.session_id)

  return { participants: participantKeys.size, turns: turnCount || 0, conversations }
}

// ── PUBLIC ────────────────────────────────────────────────────────────────

/**
 * Resolves a slug or uuid to a town_halls row and returns the full
 * facilitator-dashboard JSON payload in the same shape as the legacy
 * `/api/townhall/sessions/[id]` GET (session + themes + stats +
 * participants). Returns null if the identifier doesn't match a
 * town_halls row — the caller should fall back to the legacy path.
 *
 * Analytics-mode (the ?analytics=true branch) returns an empty-analytics
 * shell. Real analytics rebuild is a follow-on commit.
 */
export async function getTownHallAsLegacy(
  db: ServiceClient,
  slugOrId: string,
  opts: { analyticsMode?: boolean } = {},
): Promise<any | null> {
  // First try id, then slug. Slug is the more common public lookup.
  let hall: any = null
  if (/^[0-9a-f-]{36}$/i.test(slugOrId)) {
    const { data } = await db.from('town_halls').select('*').eq('id', slugOrId).maybeSingle()
    if (data) hall = data
  }
  if (!hall) {
    const { data } = await db.from('town_halls').select('*').eq('slug', slugOrId.toLowerCase()).maybeSingle()
    if (data) hall = data
  }
  if (!hall) return null

  const session = projectTownHallAsSession(hall)

  const { data: topics } = await db
    .from('town_hall_topics')
    .select('*')
    .eq('town_hall_id', hall.id)
    .eq('org_id', hall.org_id)
    .order('sort_order', { ascending: true })

  const themes = (topics || []).map((t: any) => projectTopicAsTheme(t, hall.id))

  const basics = await computeBasicStats(db, hall.id, hall.org_id)

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

  const participantSummary = basics.conversations.map(c => ({
    participant_id: c.participant_id || c.session_id,
    turns:          0,
    answered:       0,
    skipped:        0,
    topics:         0,
    last_source:    null,
    is_complete:    false,
    started_at:     null,
    last_activity:  null,
  }))

  if (!opts.analyticsMode) {
    return { session, themes, stats, participants: participantSummary }
  }

  // Analytics-mode shell — populated with the same field set the legacy
  // route returns so the client doesn't NPE on `.map` / `.length`. Real
  // computation (keyword regex, sentiment, time-series, top keywords)
  // is intentionally deferred until a paying town hall needs it.
  const enrichedThemes = themes.map(t => ({
    ...t,
    sentiment:      'neutral',
    match_count:    t.response_count,
    mention_count:  t.mention_count || t.response_count,
    response_count: t.response_count,
    percentage:     0,
    example_quotes: [] as string[],
    quote_matches:  [] as { text: string; match: string }[],
    top_keywords:   [] as { word: string; count: number }[],
  }))

  return {
    session,
    themes: enrichedThemes,
    stats,
    participants: participantSummary,
    overall_sentiment:    { positive: 0, negative: 0, neutral: 0, mixed: 0 },
    responses_over_time:  [] as { bucket: string; count: number }[],
    topic_frequency:      [] as { theme_id: string; label: string; series: { bucket: string; count: number }[] }[],
    bucket:               'hour',
  }
}

/**
 * Lists every town_halls row in scope and returns each in the legacy
 * townhall_sessions list shape used by /api/townhall/sessions. Caller
 * concatenates with the legacy list and sorts by created_at desc.
 *
 * Admin callers may pass scopeOrgId=null to fetch across all orgs;
 * non-admin callers must pass their own orgId.
 */
export async function listTownHallsAsLegacy(
  db: ServiceClient,
  scopeOrgId: string | null,
): Promise<any[]> {
  let q = db
    .from('town_halls')
    .select('id, org_id, name, slug, status, cohort_config, discussion_guide, response_target, started_at, ended_at, created_at, updated_at, created_by')
    .order('created_at', { ascending: false })
  if (scopeOrgId) q = q.eq('org_id', scopeOrgId)

  const { data: halls, error } = await q
  if (error || !halls || halls.length === 0) return []

  // Pull participants + turns counts per town hall in a small fan-out.
  // Number of town halls is small (1 today, low double digits realistic)
  // — no need for a heroic single-query CTE.
  const results: any[] = []
  for (const h of halls as any[]) {
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
