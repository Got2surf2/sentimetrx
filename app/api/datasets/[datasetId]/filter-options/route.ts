// app/api/datasets/[datasetId]/filter-options/route.ts
// Returns distinct values and numeric ranges for filter UI.
// Uses dataset_rows_flat with SQL functions — instant at any scale.
// Falls back to pre-computed analytics if flat table is empty.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

interface Props { params: { datasetId: string } }

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: Props) {
  const supabase = createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify access (admin Phase E: super-admins cross-org)
  const { data: dataset } = await supabase.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: stateRow } = await supabase
    .from('dataset_state')
    .select('schema_config, analytics')
    .eq('dataset_id', params.datasetId)
    .single()

  if (!stateRow?.schema_config) {
    return NextResponse.json({ error: 'No schema' }, { status: 404 })
  }

  const schema = stateRow.schema_config as { fields: { field: string; type: string; label?: string; hidden?: boolean }[] }
  // Honor schema-hidden fields. Charts/Stats already filter type='ignore'|'id'
  // via the schema; the Filter UI now does the same. The boolean `hidden`
  // flag is also respected for symmetry with SchemaFieldConfig's typed shape.
  const fields = (schema.fields || []).filter(function(f) {
    return f.type !== 'ignore' && f.type !== 'id' && f.hidden !== true
  })
  const service = createServiceRoleClient()

  // Check if flat table has data for this dataset
  const { count: flatCount } = await service
    .from('dataset_rows_flat')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_id', params.datasetId)

  const hasFlat = (flatCount || 0) > 0

  const options: Record<string, { type: string; label: string; values?: string[]; min?: number; max?: number; dateMin?: string; dateMax?: string }> = {}

  if (hasFlat) {
    // Use SQL helper functions on flat table — fast at any scale
    for (const f of fields) {
      const opt: typeof options[string] = { type: f.type, label: f.label || f.field }

      if (f.type === 'categorical' || f.type === 'open-ended') {
        const { data } = await service.rpc('count_field_values', {
          p_dataset_id: params.datasetId,
          p_field_key: f.field,
          p_limit: 200,
        })
        if (data) opt.values = data.map((r: any) => r.value).sort()
      }

      if (f.type === 'numeric') {
        const { data } = await service.rpc('numeric_field_stats', {
          p_dataset_id: params.datasetId,
          p_field_key: f.field,
        })
        if (data && data[0]) {
          opt.min = data[0].min_val
          opt.max = data[0].max_val
        }
      }

      if (f.type === 'date') {
        // Date ranges via direct query on flat table
        const { data } = await service
          .from('dataset_rows_flat')
          .select('data')
          .eq('dataset_id', params.datasetId)
          .not('data->' + f.field, 'is', null)
          .order('row_index', { ascending: true })
          .limit(1)
        const { data: dataMax } = await service
          .from('dataset_rows_flat')
          .select('data')
          .eq('dataset_id', params.datasetId)
          .not('data->' + f.field, 'is', null)
          .order('row_index', { ascending: false })
          .limit(1)
        if (data?.[0]) opt.dateMin = String((data[0] as any).data[f.field] || '')
        if (dataMax?.[0]) opt.dateMax = String((dataMax[0] as any).data[f.field] || '')
      }

      options[f.field] = opt
    }
  } else {
    // Fallback: use pre-computed analytics (same as before)
    const analytics = stateRow.analytics as { fieldSummaries?: Record<string, any> } | null
    const summaries = analytics?.fieldSummaries || {}

    for (const f of fields) {
      const opt: typeof options[string] = { type: f.type, label: f.label || f.field }
      const summary = summaries[f.field]

      if ((f.type === 'categorical' || f.type === 'open-ended') && summary?.counts) {
        opt.values = Object.keys(summary.counts).sort()
      }
      if (f.type === 'numeric' && summary?.min != null) {
        opt.min = summary.min; opt.max = summary.max
      }
      options[f.field] = opt
    }
  }

  return NextResponse.json({ fields: options })
}
