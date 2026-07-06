import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { checkTransferTarget, recordOrgTransfer } from '@/lib/orgTransfer'
import { getTownHallAsLegacy, fetchAllRows } from '@/lib/townHallAdapter'
import { computeSessionAnalytics, type AnalyticsTurn } from '@/lib/townhallAnalytics'
import { checkActivationReadiness } from '@/lib/townhallActivationGate'
import { serverError } from '@/lib/apiError'

// Always serve fresh — moderator must see latest theme states, never a cache.
export const dynamic = 'force-dynamic'

// ── Local row/shape types (service-role selects are untyped) ─────────────────
interface OrgIsAdmin { is_admin_org?: boolean }
interface UserOrgRow {
  org_id: string | null
  organizations: OrgIsAdmin | OrgIsAdmin[] | null
}
// A discussion_guide topic as stored in JSON on the session.
interface GuideTopic {
  label: string
  description?: string | null
  opening_question?: string
  follow_up_angles?: unknown
  keywords?: unknown
  response_target?: number
  enabled?: boolean
}
interface CohortConfig {
  engine?: { default_response_target?: number }
  [key: string]: unknown
}
// pulseiq_sessions row (superset of the columns any handler selects here).
interface SessionRow {
  id: string
  org_id: string
  status: string
  discussion_guide: GuideTopic[]
  cohort_config: CohortConfig | null
  started_at: string | null
  ended_at: string | null
  [key: string]: unknown
}
// pulseiq_topics row as selected for guide-sync (id, label, state, source).
interface TopicRow { id: string; label: string; state: string; source: string }

// Verifies the caller's org owns the session (or the caller is an admin-org member).
// Without this, any authed user can read/edit/delete any org's PulseIQ session via service role.
async function gateSessionAccess(supabase: Awaited<ReturnType<typeof createClient>>, db: ReturnType<typeof createServiceRoleClient>, userId: string, sessionId: string): Promise<{ ok: true; isAdmin: boolean; userOrgId: string | null } | { ok: false; status: number; error: string }> {
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', userId)
    .single()
  const orgRel = (userData as UserOrgRow | null)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!orgRel?.is_admin_org
  const userOrgId = (userData as UserOrgRow | null)?.org_id as string | null

  let hall: { org_id: string } | null = null
  if (/^[0-9a-f-]{36}$/i.test(sessionId)) {
    const { data } = await db.from('pulseiq_sessions').select('org_id').eq('id', sessionId).maybeSingle()
    if (data) hall = data
  }
  if (!hall) {
    const { data } = await db.from('pulseiq_sessions').select('org_id').eq('slug', sessionId.toLowerCase()).maybeSingle()
    if (data) hall = data
  }
  if (!hall) return { ok: false, status: 404, error: 'Session not found' }
  if (!isAdmin && hall.org_id !== userOrgId) return { ok: false, status: 404, error: 'Session not found' }
  return { ok: true, isAdmin, userOrgId }
}

// ── Phase-3 status maps (legacy ↔ pulseiq_sessions) ─────────────────────────────
// PATCH body sends legacy status strings ('setup','active','paused','ended');
// pulseiq_sessions accepts 'draft'|'live'|'paused'|'closed'.
const LEGACY_TO_PHASE3_STATUS: Record<string, string> = {
  setup:  'draft',
  active: 'live',
  paused: 'paused',
  ended:  'closed',
}

// Translates a legacy `discussion_guide` topic into the `pulseiq_topics`
// insert shape. Used by both the status=active seed and the discussion_guide
// sync block below. NOWOCATS doesn't use `target_mode`/`target_pct` — pass
// through if present.
function guideTopicToHallTopic(topic: GuideTopic, sortOrder: number, defaultResponseTarget: number): Record<string, unknown> {
  return {
    label:             topic.label,
    description:       topic.description || null,
    question:          topic.opening_question || '',
    follow_up_angles:  topic.follow_up_angles || [],
    keywords:          topic.keywords || [],
    state:             'active',
    source:            'seed',
    response_target:   topic.response_target || defaultResponseTarget,
    sort_order:        sortOrder,
  }
}

// Phase-3 PATCH handler. Supports the operations a NOWOCATS facilitator
// actually needs: status change (with seed-on-activate), discussion_guide
// sync, name/config updates, restart, delete_participants, reanalyze.
// Slug edit + org_id transfer stay legacy-only — not blocking NOWOCATS
// launch; can rewire if a need surfaces.
async function handlePhase3Patch(
  db: ReturnType<typeof createServiceRoleClient>,
  hallId: string,
  body: Record<string, unknown>,
  _userId: string,
): Promise<NextResponse> {
  // Pull pulseiq_sessions + org for every downstream write.
  const { data: hall } = await db.from('pulseiq_sessions').select('*').eq('id', hallId).maybeSingle()
  if (!hall) return NextResponse.json({ error: 'Town hall not found' }, { status: 404 })
  const orgId = (hall as SessionRow).org_id

  // ── delete_participants ─────────────────────────────────────────
  // Resolve participant_id → conversations.id (via .participant_id) for
  // this town hall, then cascade-delete the linkage row (which cascades
  // to conversation_turns via the FK).
  if (body.delete_participants && Array.isArray(body.delete_participants)) {
    const pids: string[] = body.delete_participants as string[]
    if (pids.length === 0) return NextResponse.json({ error: 'No participant IDs provided' }, { status: 400 })

    const { data: convRows } = await db
      .from('pulseiq_session_conversations')
      .select('conversation_id, conversations!inner(id, participant_id, org_id)')
      .eq('town_hall_id', hallId)
      .eq('org_id', orgId)
    interface ConvInner { id: string; participant_id: string | null; org_id: string }
    interface ConvJoinRow { conversation_id: string; conversations: ConvInner | ConvInner[] }
    const targets = ((convRows || []) as ConvJoinRow[])
      .map(r => Array.isArray(r.conversations) ? r.conversations[0] : r.conversations)
      .filter(c => c && pids.includes(c.participant_id || ''))
    const convIds = targets.map((c: ConvInner) => c.id)

    if (convIds.length > 0) {
      // CASCADE on conversations.id deletes both the pulseiq_session_conversations
      // link AND the conversation_turns rows.
      await db.from('conversations').delete().in('id', convIds).eq('org_id', orgId)
    }
    // Their post-session demo/psycho answers go with them — the FK only
    // cascades on SESSION delete, not per-participant removal.
    await db.from('townhall_participant_responses').delete().eq('town_hall_id', hallId).in('participant_id', pids)
    return NextResponse.json({ deleted: pids.length, turns_deleted: null })
  }

  // ── restart ─────────────────────────────────────────────────────
  // Wipe all linked conversations + reset pulseiq_sessions to draft.
  if (body.restart) {
    const { data: convRows } = await db
      .from('pulseiq_session_conversations')
      .select('conversation_id')
      .eq('town_hall_id', hallId)
      .eq('org_id', orgId)
    const convIds = (convRows || []).map((r: { conversation_id: string }) => r.conversation_id)
    if (convIds.length > 0) {
      await db.from('conversations').delete().in('id', convIds).eq('org_id', orgId)
    }
    // Drop auto-detected topics; keep seeded.
    await db.from('pulseiq_topics').delete().eq('town_hall_id', hallId).eq('source', 'auto_detected')
    const { data, error } = await db
      .from('pulseiq_sessions')
      .update({ status: 'draft', started_at: null, ended_at: null })
      .eq('id', hallId)
      .select('id, status, started_at, ended_at')
      .single()
    if (error) return serverError(error, 'townhall.session.restart', { orgId })
    return NextResponse.json({ ...data, status: 'setup' })  // legacy-shape status on the way out
  }

  // ── reanalyze ──────────────────────────────────────────────────
  if (body.reanalyze) {
    await db.from('pulseiq_topics').delete().eq('town_hall_id', hallId).eq('source', 'auto_detected')
    const { detectThemesForTownHall } = await import('@/lib/cohortThemeAggregator')
    const result = await detectThemesForTownHall(hallId)
    return NextResponse.json({ reanalyzed: true, ...result })
  }

  // ── slug / org_id ───────────────────────────────────────────────
  // Slug edit + org transfer not wired for phase-3 yet (low priority for
  // NOWOCATS launch). Soft-fail with a clear message rather than silently
  // missing the change.
  if (body.slug !== undefined) {
    return NextResponse.json({ error: 'slug edit on phase-3 town halls not yet supported' }, { status: 405 })
  }
  if ('org_id' in body) {
    return NextResponse.json({ error: 'org_id transfer on phase-3 town halls not yet supported' }, { status: 405 })
  }

  // ── status / name / config / discussion_guide ───────────────────
  const updates: Record<string, unknown> = {}
  if ('name' in body) updates.name = body.name
  if ('discussion_guide' in body) updates.discussion_guide = body.discussion_guide
  if ('config' in body) updates.cohort_config = body.config              // legacy.config → phase-3.cohort_config

  let nextStatusLegacy: string | undefined
  if (body.reopen) {
    nextStatusLegacy = 'active'
    updates.status = 'live'
    updates.ended_at = null
  } else if (typeof body.status === 'string') {
    nextStatusLegacy = body.status
    updates.status = LEGACY_TO_PHASE3_STATUS[body.status] || body.status
    if (body.status === 'active') updates.started_at = new Date().toISOString()
    if (body.status === 'ended')  updates.ended_at   = new Date().toISOString()
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // Activation gate (phase-3): refuse the setup→live transition until the
  // discussion guide has real topics AND the event description grades >= 3.
  // Merge body overrides on top of the persisted row so a single PATCH that
  // edits config/discussion_guide and flips status in one go is evaluated
  // against the post-edit state.
  if (nextStatusLegacy === 'active') {
    const mergedGuide: unknown  = 'discussion_guide' in body ? body.discussion_guide : (hall as SessionRow).discussion_guide
    const mergedConfig = ('config' in body ? body.config : (hall as SessionRow).cohort_config) as Record<string, unknown>
    const readiness = await checkActivationReadiness({ config: mergedConfig, discussion_guide: mergedGuide })
    if (!readiness.ready) {
      return NextResponse.json({
        error: 'Town hall is not ready to start',
        readiness,
      }, { status: 400 })
    }
  }

  const { data: updated, error } = await db
    .from('pulseiq_sessions')
    .update(updates)
    .eq('id', hallId)
    .select('id, status, started_at, ended_at, discussion_guide, cohort_config')
    .single()
  if (error) return serverError(error, 'townhall.session.update', { orgId })

  // ── seed-on-activate: copy discussion_guide topics into pulseiq_topics
  // the first time we go live (skip if any seed topics already exist).
  if (nextStatusLegacy === 'active') {
    const { count: existingSeed } = await db
      .from('pulseiq_topics')
      .select('id', { count: 'exact', head: true })
      .eq('town_hall_id', hallId)
      .eq('source', 'seed')
    if (!existingSeed) {
      const guide = Array.isArray((updated as SessionRow).discussion_guide) ? (updated as SessionRow).discussion_guide : []
      const cfg: CohortConfig = (updated as SessionRow).cohort_config || {}
      const enabledTopics = guide.filter((t: GuideTopic) => t.enabled !== false)
      const defaultTarget = cfg?.engine?.default_response_target || 30
      const rows = enabledTopics.map((t: GuideTopic, i: number) => ({
        ...guideTopicToHallTopic(t, i, defaultTarget),
        town_hall_id: hallId,
        org_id: orgId,
      }))
      if (rows.length > 0) await db.from('pulseiq_topics').insert(rows)
    }
  }

  // ── discussion_guide sync (active/paused): add new topics, pause
  // disabled ones, re-activate re-enabled ones, update fields, dismiss
  // orphans. Mirrors the legacy logic with pulseiq_topics.
  if (updates.discussion_guide && !nextStatusLegacy) {
    const currentStatus = (updated as SessionRow).status
    if (currentStatus === 'live' || currentStatus === 'paused') {
      const guide = updates.discussion_guide as GuideTopic[]
      const { data: existingTopics } = await db
        .from('pulseiq_topics')
        .select('id, label, state, source')
        .eq('town_hall_id', hallId)
        .eq('org_id', orgId)

      const existingLabels = new Set((existingTopics || []).map((t: TopicRow) => t.label.toLowerCase()))

      const newTopics = guide.filter((t: GuideTopic) => t.enabled !== false && t.label?.trim() && !existingLabels.has(t.label.toLowerCase().trim()))
      if (newTopics.length > 0) {
        const maxOrder = (existingTopics || []).length
        const cfg: CohortConfig = (updated as SessionRow).cohort_config || {}
        const defaultTarget = cfg?.engine?.default_response_target || 30
        const rows = newTopics.map((t: GuideTopic, i: number) => ({
          ...guideTopicToHallTopic(t, maxOrder + i, defaultTarget),
          town_hall_id: hallId,
          org_id: orgId,
        }))
        await db.from('pulseiq_topics').insert(rows)
      }

      const disabledLabels = guide.filter((t: GuideTopic) => t.enabled === false && t.label?.trim()).map((t: GuideTopic) => t.label.toLowerCase().trim())
      const enabledLabels  = guide.filter((t: GuideTopic) => t.enabled !== false && t.label?.trim()).map((t: GuideTopic) => t.label.toLowerCase().trim())

      for (const t of (existingTopics || []) as TopicRow[]) {
        if (t.source !== 'seed') continue
        const lab = t.label.toLowerCase()
        if (t.state === 'active' && disabledLabels.includes(lab)) {
          await db.from('pulseiq_topics').update({ state: 'paused' }).eq('id', t.id)
        }
        if (t.state === 'paused' && enabledLabels.includes(lab)) {
          await db.from('pulseiq_topics').update({ state: 'active' }).eq('id', t.id)
        }
      }

      // Update existing seed topic fields to mirror the guide edits.
      for (const t of ((existingTopics || []) as TopicRow[]).filter((t: TopicRow) => t.source === 'seed')) {
        const guideTopic = guide.find((g: GuideTopic) => g.label?.toLowerCase().trim() === t.label.toLowerCase())
        if (guideTopic) {
          await db.from('pulseiq_topics').update({
            label: guideTopic.label,
            description: guideTopic.description || null,
            question: guideTopic.opening_question || '',
            follow_up_angles: guideTopic.follow_up_angles || [],
            keywords: guideTopic.keywords || [],
            response_target: guideTopic.response_target || 30,
          }).eq('id', t.id)
        }
      }

      // Orphans → dismissed.
      const guideLabelsLower = guide.map((g: GuideTopic) => g.label?.toLowerCase().trim()).filter(Boolean)
      for (const t of ((existingTopics || []) as TopicRow[]).filter((t: TopicRow) => t.source === 'seed' && !guideLabelsLower.includes(t.label.toLowerCase()))) {
        await db.from('pulseiq_topics').update({ state: 'dismissed' }).eq('id', t.id)
      }
    }
  }

  // Project status back to legacy shape for the client.
  const reverseStatus = Object.entries(LEGACY_TO_PHASE3_STATUS).find(([_, v]) => v === (updated as SessionRow).status)?.[0] || (updated as SessionRow).status
  return NextResponse.json({
    id: (updated as SessionRow).id,
    status: reverseStatus,
    started_at: (updated as SessionRow).started_at,
    ended_at: (updated as SessionRow).ended_at,
  })
}

// GET /api/townhall/sessions/:id — get session with themes + stats (+ analytics if ?analytics=true)
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role to bypass RLS (auth already verified above)
  const db = createServiceRoleClient()

  const gate = await gateSessionAccess(supabase, db, user.id, params.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  // Full payload (with optional analytics) via the adapter — shared
  // lib/townhallAnalytics pipeline over the conversation_turns projection.
  const analyticsMode = _req.nextUrl.searchParams.get('analytics') === 'true'
  const payload = await getTownHallAsLegacy(db, params.id, { analyticsMode, bucketParam: _req.nextUrl.searchParams.get('bucket') })
  if (!payload) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
  })
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role to bypass RLS (auth already verified above)
  const db = createServiceRoleClient()

  const gate = await gateSessionAccess(supabase, db, user.id, params.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Status changes (with seed-on-activate), restart, delete_participants,
  // reanalyze, discussion_guide sync, name/config edits. Status map:
  // setup↔draft, active↔live, paused↔paused, ended↔closed.
  return await handlePhase3Patch(db, params.id, body, user.id)
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceRoleClient()

  const gate = await gateSessionAccess(supabase, db, user.id, params.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  // Cascade through pulseiq_session_conversations → conversations →
  // conversation_turns (FK cascade) + pulseiq_topics + participant
  // responses (both FK cascade on pulseiq_sessions delete), then drop the
  // pulseiq_sessions row.
  {
    const { data: hall } = await db.from('pulseiq_sessions').select('id, org_id, bot_id').eq('id', params.id).maybeSingle()
    if (!hall) return NextResponse.json({ error: 'Town hall not found' }, { status: 404 })
    const hallRow = hall as { id: string; org_id: string; bot_id: string | null }
    const orgId = hallRow.org_id
    const { data: convRows } = await db
      .from('pulseiq_session_conversations')
      .select('conversation_id')
      .eq('town_hall_id', params.id)
      .eq('org_id', orgId)
    const convIds = (convRows || []).map((r: { conversation_id: string }) => r.conversation_id)
    if (convIds.length > 0) {
      await db.from('conversations').delete().in('id', convIds).eq('org_id', orgId)
    }
    const { error } = await db.from('pulseiq_sessions').delete().eq('id', params.id).eq('org_id', orgId)
    if (error) return serverError(error, 'townhall.session.delete', { orgId })
    // Remove the session's DEDICATED agent (created by sessions POST /
    // duplicate) so it doesn't survive as an orphan holding the
    // '<slug>-agent' slug. Marker-gated: a session pointed at a real
    // linked agent (e.g. Sarina) must never have that agent deleted.
    const botId = hallRow.bot_id
    if (botId) {
      const { data: agent } = await db.from('agents').select('id, config').eq('id', botId).eq('org_id', orgId).maybeSingle()
      if ((agent as { config?: { pulseiq_dedicated?: boolean } | null } | null)?.config?.pulseiq_dedicated) {
        await db.from('agents').delete().eq('id', botId).eq('org_id', orgId)
      }
    }
    return NextResponse.json({ deleted: true })
  }
}
