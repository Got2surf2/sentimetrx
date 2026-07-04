// app/api/townhall/sessions/[id]/analyze/route.ts
// POST — Create or sync a dataset from Town Hall turns.
// First call: creates dataset + schema + imports turns.
// Subsequent: syncs new turns into existing dataset.
// Returns { dataset_id, synced, total, created }
//
// Substrate-aware (2026-05-22): if the session id (or slug) resolves to
// a phase-3 `pulseiq_sessions` row, sources turns from pulseiq_session_conversations
// → conversations → conversation_turns and topics from pulseiq_topics.
// Same row shape so the dataset Ana receives is identical regardless of
// substrate — datasets can be combined across legacy + phase-3 sessions
// without any client-side branching. See docs/CONVERGENCE.md § 10
// changelog (Gap #5).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { buildTownHallSchema } from '@/lib/datasetUtils'
import { THEME_PALETTE } from '@/lib/themeUtils'
import { resolveTownHall, fetchAllRows } from '@/lib/townHallAdapter'
import { serverError } from '@/lib/apiError'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

interface Params { params: Promise<{ id: string }> }

type ServiceClient = ReturnType<typeof createServiceRoleClient>

interface DatasetRow {
  turn_id:         string
  participant_id:  string | null
  turn_number:     number
  bot_message:     string
  user_message:    string
  topic:           string
  topic_type:      string
  source:          string
  language:        string
  sentiment:       string | null
  sentiment_score: number | null
  responded_at:    string
}

// Sync town hall topics → dataset_state.theme_model. Substrate-agnostic
// caller passes the labeled topic list already projected from whichever
// table it came from.
async function syncThemeModel(
  service: ServiceClient,
  datasetId: string,
  topics: { label: string; description: string | null; keywords: string[]; source: string; state: string }[],
): Promise<void> {
  if (topics.length === 0) return
  const anaThemes = topics.map((t, i) => {
    const palette = THEME_PALETTE[i % THEME_PALETTE.length]
    const origin = t.source === 'guide' || t.source === 'seed' ? 'seed'
      : (t.state === 'active' || t.state === 'completed') ? 'organic-promoted'
      : 'organic'
    return {
      id: 't' + (i + 1),
      name: t.label,
      label: t.label,
      keywords: t.keywords || [],
      color: palette.border,
      description: t.description || '',
      origin,
    }
  })
  await service.from('dataset_state').update({
    theme_model: {
      themes: anaThemes,
      fieldName: 'user_message',
      aiGenerated: true,
      version: 1,
      themeSource: 'townhall',
    },
  }).eq('dataset_id', datasetId)
}

// Phase-3 analyze path: pulseiq_sessions → pulseiq_session_conversations →
// conversations → conversation_turns. Pairs each user turn with the
// preceding assistant turn within the same conversation (mirrors the
// bot-level analyze pairing logic).
async function runPhase3Analyze(
  service: ServiceClient,
  hall: any,
  userId: string,
): Promise<NextResponse> {
  const orgId = hall.org_id as string

  // 1. Pull all conversations linked to this town hall (paged — PostgREST
  // caps a single select at 1000 rows regardless of .limit()).
  const linkRows = await fetchAllRows<any>((from, to) => service
    .from('pulseiq_session_conversations')
    .select('conversation_id, conversations!inner(id, session_id, participant_id, org_id)')
    .eq('town_hall_id', hall.id)
    .eq('org_id', orgId)
    .order('conversation_id', { ascending: true })
    .range(from, to), 5000)
  const conversations = linkRows
    .map(r => Array.isArray(r.conversations) ? r.conversations[0] : r.conversations)
    .filter(Boolean)
  const convIds = conversations.map((c: any) => c.id)
  const partByConv: Record<string, string | null> = {}
  for (const c of conversations) partByConv[c.id] = c.participant_id ?? null

  // 2. Pull topics — for theme model + label resolution on rows.
  const { data: topics } = await service
    .from('pulseiq_topics')
    .select('id, label, description, keywords, source, state')
    .eq('town_hall_id', hall.id)
    .eq('org_id', orgId)
    .in('state', ['active', 'detected', 'pending', 'completed'])

  // 3. Find existing dataset (or skip ahead if no conversations yet).
  const { data: existingArr } = await service
    .from('datasets')
    .select('id, row_count, last_synced_at')
    .eq('source', 'townhall')
    .eq('org_id', orgId)
    .like('description', 'th:' + hall.id + '%')
    .limit(1)
  const lastSynced = existingArr?.[0]?.last_synced_at || null

  // 4. Pull turns since lastSynced + their priors for pairing.
  let userTurns: any[] = []
  let assistantTurns: any[] = []
  if (convIds.length > 0) {
    // All user turns (cutoff-filtered; paged — the unbounded select was
    // silently capped at 1000 rows by PostgREST). Filtered on the stamped
    // town_hall_id column — the old `.in(conversation_id, convIds)` broke
    // at a few hundred participants on URL length.
    userTurns = await fetchAllRows<any>((from, to) => {
      let userQ = service
        .from('conversation_turns')
        .select('id, conversation_id, turn_number, content, content_en, language, source, sentiment, sentiment_score, topic_id, created_at')
        .eq('town_hall_id', hall.id)
        .eq('role', 'user')
        .eq('org_id', orgId)
        .order('conversation_id', { ascending: true })
        .order('turn_number', { ascending: true })
      if (lastSynced) userQ = userQ.gt('created_at', lastSynced)
      return userQ.range(from, to)
    }, 50000)

    // Pair-prior assistants: every conversation that has a new user turn
    // needs the preceding assistant turn for `bot_message`, including turns
    // from before the cutoff. Pull the hall's full assistant trail — the
    // old `.in(conversation_id, affectedConvIds)` hit the same URL-length
    // cliff on the first sync, when every conversation is "affected". The
    // pairing map below is keyed by conversation_id, so assistants from
    // conversations without new user turns are simply never looked up.
    if (userTurns.length > 0) {
      assistantTurns = await fetchAllRows<any>((from, to) => service
        .from('conversation_turns')
        .select('conversation_id, turn_number, content, content_en')
        .eq('town_hall_id', hall.id)
        .eq('role', 'assistant')
        .eq('org_id', orgId)
        .order('conversation_id', { ascending: true })
        .order('turn_number', { ascending: true })
        .range(from, to), 50000)
    }
  }

  // 5. Format rows. Pair each user turn with the highest-turn_number
  // assistant turn in the same conversation whose turn_number < user's.
  const assistantsByConv: Record<string, { turn_number: number; content: string }[]> = {}
  for (const a of assistantTurns) {
    if (!assistantsByConv[a.conversation_id]) assistantsByConv[a.conversation_id] = []
    assistantsByConv[a.conversation_id].push({ turn_number: a.turn_number, content: a.content_en || a.content })
  }

  const topicMap: Record<string, { label: string; source: string }> = {}
  for (const t of topics || []) topicMap[(t as any).id] = { label: (t as any).label, source: (t as any).source }

  const rows: DatasetRow[] = []
  for (const t of userTurns) {
    const trail = assistantsByConv[t.conversation_id] || []
    let bot_message = ''
    for (const a of trail) {
      if (a.turn_number < t.turn_number && (!bot_message || a.turn_number > 0)) {
        bot_message = a.content
      }
    }
    const topicHit = t.topic_id ? topicMap[t.topic_id] : null
    rows.push({
      turn_id:         t.id,
      participant_id:  partByConv[t.conversation_id],
      turn_number:     t.turn_number,
      bot_message,
      user_message:    t.content_en || t.content,
      topic:           topicHit?.label || 'General',
      topic_type:      topicHit ? (topicHit.source === 'seed' ? 'Seed' : (topicHit.source === 'manual' ? 'Custom' : 'Organic')) : 'General',
      source:          t.source || 'normal',
      language:        t.language || 'en',
      sentiment:       t.sentiment ?? null,
      sentiment_score: t.sentiment_score ?? null,
      responded_at:    t.created_at,
    })
  }

  // 6. Upsert dataset + flush rows. Theme model updates every sync.
  const projectedTopics = (topics || []).map((t: any) => ({
    label: t.label,
    description: t.description,
    keywords: t.keywords || [],
    source: t.source === 'seed' ? 'guide' : t.source, // map for downstream parity with legacy 'guide' label
    state: t.state === 'pending' ? 'detected' : (t.state === 'rejected' ? 'dismissed' : t.state),
  }))

  // Need the dataset_id to update theme_model — `upsertDatasetAndInsertRows`
  // creates it if needed and returns a NextResponse. We can't easily peel
  // it back out, so do the dataset find/create inline here for phase-3
  // to keep the theme sync coordinated.
  const existing = existingArr && existingArr.length > 0 ? existingArr[0] : null
  let datasetId: string
  let created = false
  if (existing) {
    datasetId = existing.id
  } else {
    const { data: newDs, error: createErr } = await service
      .from('datasets')
      .insert({
        name: hall.name + ' — Analytics',
        description: 'th:' + hall.id,
        source: 'townhall',
        study_id: null,
        org_id: orgId,
        created_by: userId,
        visibility: 'private',
        status: 'active',
        row_count: 0,
      })
      .select('id')
      .single()
    if (createErr || !newDs) {
      return serverError(createErr, 'townhall.analyze.createDataset', { orgId })
    }
    datasetId = newDs.id
    created = true
    const schema = buildTownHallSchema()
    await service.from('dataset_state').insert({
      dataset_id: datasetId,
      schema_config: schema,
      theme_model: { themes: [], aiGenerated: false, version: 1 },
    })
  }

  await syncThemeModel(service, datasetId, projectedTopics)

  if (rows.length === 0) {
    return NextResponse.json({ dataset_id: datasetId, synced: 0, total: existing?.row_count || 0, created })
  }

  const syncTimestamp = new Date().toISOString()
  const { data: maxRowResp } = await service
    .from('dataset_rows_flat')
    .select('row_index')
    .eq('dataset_id', datasetId)
    .order('row_index', { ascending: false })
    .limit(1)
  const startIndex = maxRowResp && maxRowResp.length > 0 ? maxRowResp[0].row_index + 1 : 0
  const flatRows = rows.map((r, i) => ({ dataset_id: datasetId, row_index: startIndex + i, data: r }))
  const { error: flatErr } = await service.from('dataset_rows_flat').insert(flatRows)
  if (flatErr) return serverError(flatErr, 'townhall.analyze.insertRows', { orgId })

  const newTotal = (existing?.row_count || 0) + rows.length
  await service
    .from('datasets')
    .update({ row_count: newTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp })
    .eq('id', datasetId)

  return NextResponse.json({ dataset_id: datasetId, synced: rows.length, total: newTotal, created })
}

export async function POST(_req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const sessionId = params.id

  // Tranche 2 (docs/CONVERGENCE.md § 4.2): pulseiq_sessions only (uuid or
  // slug) — the legacy townhall_sessions path is retired.
  const hall = await resolveTownHall(service, sessionId)
  if (!hall) return NextResponse.json({ error: "This session isn't available to your account." }, { status: 404 })
  if (!isAdmin && (hall as any).org_id !== orgId) return NextResponse.json({ error: "This session isn't available to your account." }, { status: 404 })
  return await runPhase3Analyze(service, hall, user.id)
}
