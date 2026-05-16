// app/api/bots/[id]/analyze/route.ts
// POST — Create or sync a dataset from this bot's conversation turns.
// First call: creates dataset + bot schema + imports turns.
// Subsequent: syncs new turns into the existing dataset.
// Returns { dataset_id, synced, total, created }
//
// Mirrors /api/townhall/sessions/[id]/analyze. The link between dataset and
// bot lives in dataset.description ('bot:<id>') because the study_id FK
// only points at studies — same pattern as TH datasets which use 'th:<id>'.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { buildBotSchema, mergeSchemaStats } from '@/lib/datasetUtils'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

interface Params { params: { id: string } }

export async function POST(_req: Request, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const botId = params.id

  // Verify bot exists; admin Phase E allows cross-org. Both branches
  // return the same 404 + message so existence isn't leaked.
  const { data: bot } = await service
    .from('bots')
    .select('id, name, org_id')
    .eq('id', botId)
    .single()
  if (!bot) return NextResponse.json({ error: "This bot isn't available to your account." }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: "This bot isn't available to your account." }, { status: 404 })

  // Existing bot dataset?
  const { data: existingArr } = await service
    .from('datasets')
    .select('id, row_count, last_synced_at')
    .eq('source', 'bot')
    .eq('org_id', bot.org_id)
    .like('description', 'bot:' + botId + '%')
    .limit(1)
  const existing = existingArr && existingArr.length > 0 ? existingArr[0] : null

  let datasetId: string
  let created = false

  if (existing) {
    datasetId = existing.id
  } else {
    const { data: newDs, error: createErr } = await service
      .from('datasets')
      .insert({
        name: bot.name + ' — Conversations',
        description: 'bot:' + botId,
        source: 'bot',
        study_id: null,
        org_id: bot.org_id,
        created_by: user.id,
        visibility: 'private',
        status: 'active',
        row_count: 0,
      })
      .select('id')
      .single()

    if (createErr || !newDs) {
      return NextResponse.json({ error: 'Failed to create dataset', detail: createErr?.message }, { status: 500 })
    }

    datasetId = newDs.id
    created = true

    await service.from('dataset_state').insert({
      dataset_id: datasetId,
      schema_config: buildBotSchema(),
      theme_model: { themes: [], aiGenerated: false, version: 1 },
    })
  }

  // Fetch turns (sequential, all roles) since last sync.
  const lastSynced = existing?.last_synced_at || null
  let turnsQuery = service
    .from('bot_conversation_turns')
    .select('id, session_id, turn_number, role, content, content_en, language, sentiment, sentiment_score, created_at')
    .eq('bot_id', botId)
    .order('session_id', { ascending: true })
    .order('turn_number', { ascending: true })

  if (lastSynced) {
    turnsQuery = turnsQuery.gt('created_at', lastSynced)
  }

  const { data: turns, error: turnsErr } = await turnsQuery
  if (turnsErr) return NextResponse.json({ error: 'Failed to fetch turns', detail: turnsErr.message }, { status: 500 })

  if (!turns || turns.length === 0) {
    return NextResponse.json({ dataset_id: datasetId, synced: 0, total: existing?.row_count || 0, created })
  }

  // For incremental sync: pair each user turn with its preceding assistant
  // turn within the same session. To do that correctly across the boundary
  // of the gt(lastSynced) cutoff, fetch the assistant turn that came just
  // before the first new user turn for each affected session — otherwise
  // a user turn answered a bot question that's "before" the cutoff would
  // get a blank bot_message.
  const affectedSessions = Array.from(new Set(turns.filter(t => t.role === 'user').map(t => t.session_id)))
  const priorByKey: Record<string, { content: string; turn_number: number }> = {}
  if (lastSynced && affectedSessions.length > 0) {
    // Pull all turns in affected sessions up to the cutoff so we can find
    // the assistant turn immediately preceding each new user turn. This
    // is bounded by session size, not corpus size.
    const { data: priorTurns } = await service
      .from('bot_conversation_turns')
      .select('session_id, turn_number, role, content, content_en')
      .in('session_id', affectedSessions)
      .lte('created_at', lastSynced)
      .order('turn_number', { ascending: true })
    for (const p of (priorTurns || [])) {
      if (p.role !== 'assistant') continue
      // Track the latest assistant turn per session under the cutoff.
      const cur = priorByKey[p.session_id]
      if (!cur || p.turn_number > cur.turn_number) {
        priorByKey[p.session_id] = { content: p.content_en || p.content, turn_number: p.turn_number }
      }
    }
  }

  // Walk turns and emit one row per user turn, with bot_message taken from
  // the last assistant turn in the same session whose turn_number is < the
  // user turn's. Standalone assistants (greeting with no user reply) are
  // skipped — they aren't a "response".
  type Pending = { content: string; turn_number: number }
  const pendingBySession: Record<string, Pending> = {}
  // Seed with priors (so first user turns past the cutoff still pair).
  for (const sid of Object.keys(priorByKey)) pendingBySession[sid] = priorByKey[sid]

  const rows: any[] = []
  for (const t of turns) {
    if (t.role === 'assistant') {
      const cur = pendingBySession[t.session_id]
      if (!cur || t.turn_number > cur.turn_number) {
        pendingBySession[t.session_id] = { content: t.content_en || t.content, turn_number: t.turn_number }
      }
      continue
    }
    // role === 'user'
    const pending = pendingBySession[t.session_id]
    rows.push({
      turn_id:         t.id,
      session_id:      t.session_id,
      turn_number:     t.turn_number,
      bot_message:     pending?.content || '',
      user_message:    t.content_en || t.content,
      language:        t.language || 'en',
      sentiment:       t.sentiment ?? null,
      sentiment_score: t.sentiment_score ?? null,
      responded_at:    t.created_at,
    })
  }

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

  const flatRows = rows.map(function(r, i) {
    return { dataset_id: datasetId, row_index: startIndex + i, data: r }
  })
  const { error: flatErr } = await service.from('dataset_rows_flat').insert(flatRows)
  if (flatErr) return NextResponse.json({ error: 'Failed to insert rows', detail: flatErr.message }, { status: 500 })

  const newTotal = (existing?.row_count || 0) + rows.length

  await service
    .from('datasets')
    .update({ row_count: newTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp })
    .eq('id', datasetId)

  // Merge this batch's distinct values (language, sentiment, session_id, ...)
  // into the schema so categorical filter options grow as more turns sync.
  // buildBotSchema() ships with empty f.values, and there was no enrichment
  // step here before — so without this, the filter modal had to fall back to
  // filter-options' top-200 list every time, masking long-tail values.
  try {
    const { data: stateRow } = await service.from('dataset_state').select('schema_config').eq('dataset_id', datasetId).single()
    const schema = stateRow?.schema_config
    if (schema?.fields?.length) {
      const merged = mergeSchemaStats(schema, rows)
      await service.from('dataset_state').update({ schema_config: merged, updated_at: syncTimestamp }).eq('dataset_id', datasetId)
    }
  } catch (err) {
    console.error({ at: 'bots/analyze', msg: "schema merge failed", err: err })
  }

  return NextResponse.json({ dataset_id: datasetId, synced: rows.length, total: newTotal, created })
}
