// app/api/studies/[id]/analyze/route.ts
// POST — Create or find a dataset linked to this study, sync responses, redirect to Ana.
// First call: creates dataset + schema + syncs all completed responses.
// Subsequent: syncs only new responses since last sync.
// Returns { dataset_id, synced, total, created }

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { buildStudySchema, formatResponsesAsRows } from '@/lib/datasetUtils'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface Params { params: Promise<{ id: string }> }

export async function POST(_req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const studyId = params.id

  // Verify study exists; admin Phase E lets super-admins cross-org.
  const { data: study } = await service
    .from('studies')
    .select('id, name, config, org_id')
    .eq('id', studyId)
    .single()

  if (!study) return NextResponse.json({ error: "This study isn't available to your account." }, { status: 404 })
  if (!isAdmin && study.org_id !== orgId) return NextResponse.json({ error: "This study isn't available to your account." }, { status: 404 })

  // Check for existing dataset linked to this study
  const { data: existing } = await service
    .from('datasets')
    .select('id, row_count, last_synced_at')
    .eq('source', 'study')
    .eq('study_id', studyId)
    .limit(1)

  let datasetId: string
  let created = false

  if (existing && existing.length > 0) {
    datasetId = existing[0].id
  } else {
    // Create new dataset. For admins running this cross-org, the dataset
    // should belong to the STUDY's org, not the admin's \u2014 otherwise it
    // ends up orphaned in the admin org. For non-admins study.org_id
    // matches orgId by the gate above, so no behavior change.
    const { data: newDs, error: createErr } = await service
      .from('datasets')
      .insert({
        name: study.name + ' \u2014 Analytics',
        source: 'study',
        study_id: studyId,
        org_id: study.org_id,
        created_by: user.id,
        visibility: 'private',
        status: 'active',
        row_count: 0,
      })
      .select('id')
      .single()

    if (createErr || !newDs) {
      return serverError(createErr, 'studies.analyze.createDataset', { orgId: study.org_id })
    }

    datasetId = newDs.id
    created = true

    // Create dataset_state with study schema
    const schema = buildStudySchema(study.config)
    await service.from('dataset_state').insert({
      dataset_id: datasetId,
      schema_config: schema,
      theme_model: { themes: [], aiGenerated: false, version: 1 },
    })
  }

  // Fetch all responses (complete + partial), newer than last sync
  const lastSynced = (!created && existing?.[0]?.last_synced_at) || null
  let respQuery = service
    .from('responses')
    .select('id, completed_at, nps_score, experience_score, sentiment, duration_sec, payload, status')
    .eq('study_id', studyId)
    .order('id', { ascending: true })

  if (lastSynced) {
    respQuery = respQuery.gt('completed_at', lastSynced)
  }

  const { data: responses, error: respErr } = await respQuery
  if (respErr) return serverError(respErr, 'studies.analyze.fetchResponses', { orgId: study.org_id })

  if (!responses || responses.length === 0) {
    return NextResponse.json({ dataset_id: datasetId, synced: 0, total: existing?.[0]?.row_count || 0, created })
  }

  // Format responses as dataset rows
  const rows = formatResponsesAsRows(responses as Parameters<typeof formatResponsesAsRows>[0], study as Parameters<typeof formatResponsesAsRows>[1])

  const syncTimestamp = new Date().toISOString()

  // Determine next row_index (append after existing rows)
  const { data: maxRowResp } = await service
    .from('dataset_rows_flat')
    .select('row_index')
    .eq('dataset_id', datasetId)
    .order('row_index', { ascending: false })
    .limit(1)
  const startIndex = maxRowResp && maxRowResp.length > 0 ? maxRowResp[0].row_index + 1 : 0

  const flatRows = rows.map(function(r: Record<string, unknown>, i: number) {
    return { dataset_id: datasetId, row_index: startIndex + i, data: r }
  })
  const { error: flatErr } = await service.from('dataset_rows_flat').insert(flatRows)
  if (flatErr) return serverError(flatErr, 'studies.analyze.insertRows', { orgId: study.org_id })

  const newTotal = (existing?.[0]?.row_count || 0) + rows.length

  await service
    .from('datasets')
    .update({ row_count: newTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp })
    .eq('id', datasetId)

  return NextResponse.json({ dataset_id: datasetId, synced: rows.length, total: newTotal, created })
}
