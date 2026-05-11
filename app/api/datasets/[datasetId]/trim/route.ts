// app/api/datasets/[datasetId]/trim/route.ts
// POST — delete rows from a dataset where a date field is before a cutoff date
// Body: { date_field: string, before_date: string (ISO) }
// Returns: { deleted: number, remaining: number }

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeAnalyticsSQL } from '@/lib/analyticsCompute'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: { datasetId: string } }

export async function POST(req: Request, { params }: Params) {
  try {
    const supabase = createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId, isAdmin } = await getCallerOrgContext(supabase)
    if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    const service = createServiceRoleClient()

    // Verify dataset access (admin Phase E: super-admins cross-org)
    const { data: dataset } = await service
      .from('datasets').select('id, org_id, row_count').eq('id', params.datasetId).single()
    if (!dataset || (!isAdmin && dataset.org_id !== orgId)) {
      return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
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
    for (let i = 0; i < deleteIds.length; i += 500) {
      const chunk = deleteIds.slice(i, i + 500)
      await service.from('dataset_rows_flat').delete().in('id', chunk)
    }

    // Update dataset row count from authoritative flat table count
    const { count: totalRemaining } = await service
      .from('dataset_rows_flat')
      .select('id', { count: 'exact', head: true })
      .eq('dataset_id', params.datasetId)

    await service.from('datasets').update({
      row_count: totalRemaining || 0,
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
