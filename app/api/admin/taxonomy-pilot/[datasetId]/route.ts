// /api/admin/taxonomy-pilot/[datasetId]
//
// Admin-only paged read of rows + their taxonomy for the Ruth's Chris pilot.
// Returns up to pageSize rows ordered by row_index; the verdicts come from the
// embedded data._tx block (sql/151) for the dataset's primary classified field.

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

  // The verdicts ride on the rows themselves (data._tx); resolve the dataset's
  // primary classified field once, then read each row's block for it.
  const { data: pf } = await service.rpc('taxonomy_primary_field', { p_dataset_id: params.datasetId })
  const fieldKey = (pf as string | null) ?? ''

  // Counts (classified rows / alert rows for the field)
  let classifiedCount = 0, alertCount = 0
  if (fieldKey) {
    const { data: counts, error: cntErr } = await service
      .rpc('taxonomy_counts', { p_dataset_id: params.datasetId, p_field_key: fieldKey })
    if (cntErr) return serverError(cntErr, 'admin.taxonomyPilot.counts', { orgId: dataset.org_id })
    const c = Array.isArray(counts) ? counts[0] : null
    classifiedCount = Number(c?.classified ?? 0)
    alertCount = Number(c?.alerts ?? 0)
  }

  const merged = (rows ?? []).map((r: any) => {
    const t = fieldKey ? r.data?._tx?.f?.[fieldKey] : null
    const a = t?.a ?? {}
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
        axis_touchpoint: a.touchpoint ?? [],
        axis_attribute:  a.attribute  ?? [],
        axis_product:    a.product    ?? [],
        axis_beverage:   a.beverage   ?? [],
        axis_ambiance:   a.ambiance   ?? [],
        axis_context:    a.context    ?? [],
        axis_outcome:    a.outcome    ?? [],
        alert_tags:      t.al         ?? [],
        assertions:      t.as         ?? [],
        classified_by:   t.by         ?? null,
        model_used:      t.m          ?? null,
        prompt_version:  t.v          ?? null,
        created_at:      t.at         ?? null,
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
