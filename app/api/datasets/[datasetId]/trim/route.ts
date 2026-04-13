// app/api/datasets/[datasetId]/trim/route.ts
// POST — delete rows from a dataset where a date field is before a cutoff date
// Body: { date_field: string, before_date: string (ISO) }
// Returns: { deleted: number, remaining: number }

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { computeAnalytics, computeAnalyticsSQL } from '@/lib/analyticsCompute'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: { datasetId: string } }

export async function POST(req: Request, { params }: Params) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users').select('org_id').eq('id', user.id).single()
    if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    const service = createServiceRoleClient()

    // Verify dataset ownership
    const { data: dataset } = await service
      .from('datasets').select('id, org_id, row_count').eq('id', params.datasetId).single()
    if (!dataset || dataset.org_id !== userData.org_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await req.json()
    const { date_field, before_date } = body
    if (!date_field || !before_date) {
      return NextResponse.json({ error: 'date_field and before_date are required' }, { status: 400 })
    }

    // Find rows in flat table where the date field is before the cutoff
    // JSONB query: data ->> 'field_name' < 'date_string'
    const { data: rowsToDelete, error: queryErr } = await service
      .from('dataset_rows_flat')
      .select('id, row_index')
      .eq('dataset_id', params.datasetId)
      .lt('data->>' + date_field, before_date)

    if (queryErr) {
      return NextResponse.json({ error: 'Query failed: ' + queryErr.message }, { status: 500 })
    }

    const deleteCount = rowsToDelete?.length || 0
    if (deleteCount === 0) {
      return NextResponse.json({ deleted: 0, remaining: dataset.row_count })
    }

    // Delete from flat table
    const deleteIds = rowsToDelete!.map(function(r: any) { return r.id })
    // Delete in chunks of 500 to avoid URL length limits
    for (let i = 0; i < deleteIds.length; i += 500) {
      const chunk = deleteIds.slice(i, i + 500)
      await service.from('dataset_rows_flat').delete().in('id', chunk)
    }

    // Rebuild batched table from flat table (simpler than trying to edit JSONB arrays)
    // Delete all batched rows and re-insert from flat
    await service.from('dataset_rows').delete().eq('dataset_id', params.datasetId)

    // Read remaining flat rows in pages and re-batch
    const BATCH_SIZE = 200
    let offset = 0
    let batchIndex = 0
    let totalRemaining = 0

    while (true) {
      const { data: page } = await service
        .from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', params.datasetId)
        .order('row_index', { ascending: true })
        .range(offset, offset + BATCH_SIZE - 1)

      if (!page || page.length === 0) break
      totalRemaining += page.length

      const rows = page.map(function(r: any) { return r.data })
      await service.from('dataset_rows').insert({
        dataset_id: params.datasetId,
        rows: rows,
        row_count: rows.length,
        batch_index: batchIndex,
        source_ref: 'trim:' + new Date().toISOString(),
      })

      batchIndex++
      offset += BATCH_SIZE
    }

    // Update dataset row count
    const remaining = dataset.row_count - deleteCount
    await service.from('datasets').update({
      row_count: remaining > 0 ? remaining : totalRemaining,
      updated_at: new Date().toISOString(),
    }).eq('id', params.datasetId)

    // Recompute analytics
    const { data: stateRow } = await service
      .from('dataset_state').select('schema_config').eq('dataset_id', params.datasetId).single()
    if (stateRow?.schema_config?.fields?.length) {
      try {
        const analytics = await computeAnalyticsSQL(service, params.datasetId, stateRow.schema_config)
        await service.from('dataset_state').update({
          analytics,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        }).eq('dataset_id', params.datasetId)
      } catch (err) {
        console.error('[trim] analytics recompute failed:', err)
      }
    }

    return NextResponse.json({
      deleted: deleteCount,
      remaining: totalRemaining || (dataset.row_count - deleteCount),
    })
  } catch (err: any) {
    console.error('[trim] error:', err)
    return NextResponse.json({ error: err?.message || 'Trim failed' }, { status: 500 })
  }
}
