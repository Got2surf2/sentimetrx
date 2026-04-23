// app/api/townhall/sessions/[id]/analyze/route.ts
// POST — Create or sync a dataset from Town Hall turns.
// First call: creates dataset + schema + imports turns.
// Subsequent: syncs new turns into existing dataset.
// Returns { dataset_id, synced, total, created }

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { buildTownHallSchema } from '@/lib/datasetUtils'
import { ROWS_PER_BATCH } from '@/lib/constants'
import { THEME_PALETTE } from '@/lib/themeUtils'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

interface Params { params: { id: string } }

export async function POST(_req: Request, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users').select('org_id').eq('id', user.id).single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const sessionId = params.id

  // Verify session exists and belongs to this org
  const { data: session } = await service
    .from('townhall_sessions')
    .select('id, name, org_id, config, discussion_guide')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.org_id !== userData.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Check for existing dataset linked to this TH session
  // TH datasets use description to store the session link (study_id FK references studies table)
  const { data: existingArr } = await service
    .from('datasets')
    .select('id, row_count, last_synced_at')
    .eq('source', 'townhall')
    .eq('org_id', userData.org_id)
    .like('description', 'th:' + sessionId + '%')
    .limit(1)
  const existing = existingArr && existingArr.length > 0 ? existingArr[0] : null

  let datasetId: string
  let created = false

  if (existing) {
    datasetId = existing.id
  } else {
    // Create new dataset
    const { data: newDs, error: createErr } = await service
      .from('datasets')
      .insert({
        name: session.name + ' \u2014 Analytics',
        description: 'th:' + sessionId,  // link to TH session (not study_id FK)
        source: 'townhall',
        study_id: null,
        org_id: userData.org_id,
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

    // Create dataset_state with TH schema (theme model added below)
    const schema = buildTownHallSchema()
    await service.from('dataset_state').insert({
      dataset_id: datasetId,
      schema_config: schema,
      theme_model: { themes: [], aiGenerated: false, version: 1 },
    })
  }

  // ── Sync TH themes → Ana theme model ─────────────────────────────────────
  // Carry over TH themes so Ana shows the same themes the facilitator saw.
  // Runs on every sync (creation + refresh) so new organic themes appear too.
  const { data: thThemes } = await service
    .from('townhall_themes')
    .select('id, label, description, keywords, sentiment, state, source')
    .eq('session_id', sessionId)
    .in('state', ['active', 'detected', 'completed'])
    .order('created_at', { ascending: true })

  if (thThemes && thThemes.length > 0) {
    const anaThemes = thThemes.map(function(t: any, i: number) {
      var palette = THEME_PALETTE[i % THEME_PALETTE.length]
      var origin = t.source === 'guide' ? 'seed'
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

  // Fetch turns — only non-skipped turns with actual user messages
  const lastSynced = existing?.last_synced_at || null
  let turnsQuery = service
    .from('townhall_turns')
    .select('id, participant_id, turn_number, bot_message, user_message, user_message_en, language, theme_id, source, created_at')
    .eq('session_id', sessionId)
    .eq('skipped', false)
    .not('user_message', 'is', null)
    .order('created_at', { ascending: true })

  if (lastSynced) {
    turnsQuery = turnsQuery.gt('created_at', lastSynced)
  }

  const { data: turns, error: turnsErr } = await turnsQuery
  if (turnsErr) return NextResponse.json({ error: 'Failed to fetch turns', detail: turnsErr.message }, { status: 500 })

  if (!turns || turns.length === 0) {
    return NextResponse.json({ dataset_id: datasetId, synced: 0, total: existing?.row_count || 0, created })
  }

  // Resolve theme labels
  const themeIds = Array.from(new Set(turns.filter(t => t.theme_id).map(t => t.theme_id)))
  const themeMap: Record<string, { label: string; source: string }> = {}
  if (themeIds.length > 0) {
    const { data: themes } = await service
      .from('townhall_themes')
      .select('id, label, source')
      .in('id', themeIds)
    ;(themes || []).forEach(t => { themeMap[t.id] = { label: t.label, source: t.source } })
  }

  // Format turns as dataset rows
  const rows = turns.map(function(t) {
    return {
      turn_id:        t.id,
      participant_id: t.participant_id,
      turn_number:    t.turn_number,
      bot_message:    t.bot_message,
      user_message:   t.user_message_en || t.user_message,
      topic:          t.theme_id ? (themeMap[t.theme_id]?.label || 'Unknown') : 'General',
      topic_type:     t.theme_id ? (themeMap[t.theme_id]?.source === 'guide' ? 'Seed' : 'Organic') : 'General',
      source:         t.source || 'guide',
      language:       t.language || 'en',
      responded_at:   t.created_at,
    }
  })

  // Get next batch index
  const { data: existingBatches } = await service
    .from('dataset_rows')
    .select('batch_index')
    .eq('dataset_id', datasetId)
    .order('batch_index', { ascending: false })
    .limit(1)

  const nextIndex = existingBatches && existingBatches.length > 0 ? existingBatches[0].batch_index + 1 : 0
  const syncTimestamp = new Date().toISOString()

  // Insert batch
  const { error: batchErr } = await service
    .from('dataset_rows')
    .insert({ dataset_id: datasetId, rows, row_count: rows.length, batch_index: nextIndex, source_ref: 'th-sync:' + syncTimestamp })

  if (batchErr) return NextResponse.json({ error: 'Failed to insert rows', detail: batchErr.message }, { status: 500 })

  // Insert flat rows
  const flatRows = rows.map(function(r, i) {
    return { dataset_id: datasetId, row_index: nextIndex * ROWS_PER_BATCH + i, data: r }
  })
  if (flatRows.length > 0) {
    try { await service.from('dataset_rows_flat').insert(flatRows) } catch {}
  }

  const newTotal = (existing?.row_count || 0) + rows.length

  await service
    .from('datasets')
    .update({ row_count: newTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp })
    .eq('id', datasetId)

  return NextResponse.json({ dataset_id: datasetId, synced: rows.length, total: newTotal, created })
}
