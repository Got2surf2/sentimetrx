// /api/admin/taxonomy-pilot/[datasetId]
//
// Admin-only paged read of rows + their taxonomy for the Ruth's Chris pilot.
// Returns up to pageSize rows ordered by row_index, joined with
// dataset_row_taxonomy via (dataset_id, row_id).

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface Params { params: Promise<{ datasetId: string }> }

export async function GET(req: Request, props: Params) {
  const params = await props.params;
  const guard = await requireAdmin()
  if (guard) return guard

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10)))
  const filter = url.searchParams.get('filter') || ''  // 'alert' | 'unclassified' | ''
  const axisSub = url.searchParams.get('axisSub') || ''  // 'attribute:food safety' style

  const service = createServiceRoleClient()

  const { data: dataset, error: dsErr } = await service
    .from('datasets')
    .select('id, name, row_count, org_id, brand_tag, description, created_at')
    .eq('id', params.datasetId)
    .single()
  if (dsErr || !dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const offset = (page - 1) * pageSize

  // Pull rows
  let rowsQuery = service
    .from('dataset_rows_flat')
    .select('id, row_index, data', { count: 'exact' })
    .eq('dataset_id', params.datasetId)
    .order('row_index', { ascending: true })
    .range(offset, offset + pageSize - 1)

  const { data: rows, error: rowsErr, count: totalRows } = await rowsQuery
  if (rowsErr) return serverError(rowsErr, 'admin.taxonomyPilot.rows', { orgId: dataset.org_id })

  const rowIds = (rows ?? []).map((r: any) => r.id)
  let taxonomy: any[] = []
  if (rowIds.length > 0) {
    const { data: tax, error: taxErr } = await service
      .from('dataset_row_taxonomy')
      .select('*')
      .eq('dataset_id', params.datasetId)
      .eq('org_id', dataset.org_id)
      .in('row_id', rowIds)
    if (taxErr) return serverError(taxErr, 'admin.taxonomyPilot.taxonomy', { orgId: dataset.org_id })
    taxonomy = tax ?? []
  }
  const taxByRow = new Map<number, any>()
  for (const t of taxonomy) taxByRow.set(t.row_id, t)

  // Counts
  const { count: classifiedCount } = await service
    .from('dataset_row_taxonomy')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_id', params.datasetId)
    .eq('org_id', dataset.org_id)

  const { count: alertCount } = await service
    .from('dataset_row_taxonomy')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_id', params.datasetId)
    .eq('org_id', dataset.org_id)
    .not('alert_tags', 'eq', '{}')

  const merged = (rows ?? []).map((r: any) => {
    const t = taxByRow.get(r.id)
    return {
      row_id: r.id,
      row_index: r.row_index,
      review_text: r.data?.description ?? '',
      review_rating: r.data?.review_rating ?? null,
      unit_name: r.data?.unit_name ?? '',
      city: r.data?.city ?? '',
      state: r.data?.state ?? '',
      legacy_tags: r.data?.legacy_tags ?? [],
      taxonomy: t ? {
        axis_touchpoint: t.axis_touchpoint ?? [],
        axis_attribute:  t.axis_attribute  ?? [],
        axis_product:    t.axis_product    ?? [],
        axis_beverage:   t.axis_beverage   ?? [],
        axis_ambiance:   t.axis_ambiance   ?? [],
        axis_context:    t.axis_context    ?? [],
        axis_outcome:    t.axis_outcome    ?? [],
        alert_tags:      t.alert_tags      ?? [],
        assertions:      t.assertions      ?? [],
        classified_by:   t.classified_by   ?? null,
        model_used:      t.model_used      ?? null,
        prompt_version:  t.prompt_version  ?? null,
        created_at:      t.created_at,
      } : null,
    }
  })

  return NextResponse.json({
    dataset: {
      id: dataset.id,
      name: dataset.name,
      brand_tag: dataset.brand_tag,
      row_count: dataset.row_count,
      created_at: dataset.created_at,
    },
    counts: {
      total_rows: totalRows ?? 0,
      classified: classifiedCount ?? 0,
      alerts: alertCount ?? 0,
    },
    page,
    pageSize,
    rows: merged,
  })
}
