// app/api/datasets/[datasetId]/filter-options/route.ts
// Returns distinct values and numeric ranges for filter UI.
// Uses dataset_rows_flat with SQL functions — instant at any scale.
// Falls back to pre-computed analytics if flat table is empty.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { countNonEmptyRows } from '@/lib/nonEmptyCount'
import { sampledFilterOptions, FILTER_SAMPLE_CAP } from '@/lib/sampledFilterOptions'
import { scaleSampledCount } from '@/lib/sampledSignalCounts'

interface Props { params: Promise<{ datasetId: string }> }

export const dynamic = 'force-dynamic'
// Serial per-field aggregate RPCs — on wide/large datasets the loop can
// outlive the default function budget (each statement still bounded by the
// DB's 8s timeout). Same budget as the peer dataset routes. Note this route
// only fires when the filter modal opens BEFORE the bulk rows finish loading;
// afterwards the modal derives options client-side from the loaded sample.
export const maxDuration = 60

export async function GET(_req: Request, props: Props) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify access (admin Phase E: super-admins cross-org)
  const { data: dataset } = await supabase.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

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

  const options: Record<string, { type: string; label: string; values?: string[]; min?: number; max?: number; dateMin?: string; dateMax?: string; blanks?: number; valuesCapped?: boolean; sampled?: boolean }> = {}

  if (hasFlat) {
    // One keyset-paged pass over the deterministic 50K sample (sql/168) —
    // replaces the serial per-field full-scan RPCs that 57014'd at 1M (perf
    // review §7 Brief B). Below 50K the walk reaches every row = EXACT (and
    // returns up to 500 distinct categorical values vs the old 200 — the
    // owner-reported "missing values" fix); above it, counts/blanks are scaled
    // to the total and flagged `sampled`. Falls back to the legacy per-field
    // loop if the RPC hasn't reached this database yet (deploy-order safety).
    const totalRows = flatCount || 0
    const isSampled = totalRows > FILTER_SAMPLE_CAP
    try {
      const { options: sampled, scanned } = await sampledFilterOptions(
        service, params.datasetId, fields.map(f => ({ field: f.field, type: f.type })))
      for (const f of fields) {
        const s = sampled[f.field]
        const opt: typeof options[string] = { type: f.type, label: f.label || f.field }
        if (s) {
          // Blanks = total − non-empty (scaled to total when sampled). The modal
          // is fed synthetic rows so it can't derive blanks itself.
          const nonEmptyTotal = isSampled ? scaleSampledCount(s.nonempty, totalRows, scanned) : s.nonempty
          opt.blanks = Math.max(0, totalRows - nonEmptyTotal)
          if (f.type === 'categorical') {
            if (s.values) opt.values = s.values
            if (s.valuesCapped) opt.valuesCapped = true
          }
          if (f.type === 'numeric') {
            if (s.min != null) opt.min = s.min
            if (s.max != null) opt.max = s.max
          }
          if (f.type === 'date') {
            if (s.dateMin != null) opt.dateMin = s.dateMin
            if (s.dateMax != null) opt.dateMax = s.dateMax
          }
          if (isSampled) opt.sampled = true
        }
        options[f.field] = opt
      }
      return NextResponse.json({ fields: options })
    } catch {
      // sampled_filter_options unavailable (PGRST202) or errored — fall through
      // to the legacy per-field path (pre-sql/168 behavior). Above 50K this can
      // still 57014, i.e. no worse than before the sampled path existed.
    }
  }

  if (hasFlat) {
    // Legacy per-field full-scan path (deploy-order fallback for sql/168).
    for (const f of fields) {
      const opt: typeof options[string] = { type: f.type, label: f.label || f.field }

      // True blank count for this field (null key OR empty string). The filter
      // modal is fed synthetic rows (one per distinct value), so it can't derive
      // blank counts itself — it must come from here, against the live table.
      // Comma-safe count (sql/161): the raw PostgREST filter counted 0 non-blank
      // for question-sentence column names, marking EVERY row blank.
      let nonBlank = 0
      try { nonBlank = await countNonEmptyRows(service, params.datasetId, f.field) } catch { /* blanks stay best-effort */ }
      opt.blanks = Math.max(0, (flatCount || 0) - nonBlank)

      if (f.type === 'categorical' || f.type === 'open-ended') {
        const { data } = await service.rpc('count_field_values', {
          p_dataset_id: params.datasetId,
          p_field_key: f.field,
          p_limit: 200,
        })
        if (data) opt.values = data.map((r: { value: string }) => r.value).sort()
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
        // Date range = the actual earliest/latest VALUE, not insertion order.
        // Reviews sync per-location in arbitrary order, so ordering by row_index
        // returned two random rows' dates (a ~1-month window on multi-year data).
        // ISO date / timestamp strings sort lexically by date, so ordering on the
        // JSON text value gives the true min/max; empties are excluded so a blank
        // doesn't sort to the front as the "min".
        const { data } = await service
          .from('dataset_rows_flat')
          .select('data')
          .eq('dataset_id', params.datasetId)
          .not('data->' + f.field, 'is', null)
          .neq('data->>' + f.field, '')
          .order('data->>' + f.field, { ascending: true })
          .limit(1)
        const { data: dataMax } = await service
          .from('dataset_rows_flat')
          .select('data')
          .eq('dataset_id', params.datasetId)
          .not('data->' + f.field, 'is', null)
          .neq('data->>' + f.field, '')
          .order('data->>' + f.field, { ascending: false })
          .limit(1)
        if (data?.[0]) opt.dateMin = String((data[0] as { data: Record<string, unknown> }).data[f.field] || '')
        if (dataMax?.[0]) opt.dateMax = String((dataMax[0] as { data: Record<string, unknown> }).data[f.field] || '')
      }

      options[f.field] = opt
    }
  } else {
    // Fallback: use pre-computed analytics (same as before)
    const analytics = stateRow.analytics as { fieldSummaries?: Record<string, { counts?: Record<string, number>; min?: number; max?: number }> } | null
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
