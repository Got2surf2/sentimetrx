// app/api/datasets/[datasetId]/taxonomy/route.ts
// GET  — the tag-analytics roll-up for the in-app Taxonomy tab. Fast path:
//        the rollup stored in dataset_state.analytics.taxonomy at classify
//        time (sql/151 embed architecture); falls back to computing from the
//        embedded row verdicts when no stored entry exists yet.
// POST — self-serve classifier. Runs one chunk of the keyword-tier classifier
//        over the dataset's rows starting at a cursor; the client loops until
//        `done`. Keyword-only (no AI cost), idempotent per (row, fieldKey).
// Both org-gated: pair the dataset's org_id (multi-tenancy invariant);
// non-admins must own the dataset.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeTaxonomyRollup, readStoredTaxonomy, type TaxonomyRollup } from '@/lib/taxonomyRollup'
import { classifyDatasetKeyword, classifyPendingRows } from '@/lib/taxonomyClassify'
import { orgTaxonomyEnabled } from '@/lib/resolveOrg'
import { taxonomyFieldKey } from '@/lib/dimensionFields'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// Rows scanned per POST. Keyword matching is pure-CPU and fast; the DB round
// trips dominate. 10K keeps a single chunk comfortably inside maxDuration
// while minimising the number of client round trips on large datasets.
const CHUNK = 10000

interface Params { params: Promise<{ datasetId: string }> }

interface TextField { field: string; label: string }

function prettifyField(field: string): string {
  return field.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Detect which columns hold free-text worth classifying, so the UI can let the
 * user pick (a review dataset uses `review_text`; a survey might use `comment`,
 * `feedback`, etc.). Samples rows rather than trusting schema detection, which
 * may not have run yet. A column qualifies when its sampled values are mostly
 * multi-word strings of reasonable length. Labels come from schema_config when
 * present. Returns candidates (most text-like first) + a recommended default.
 */
async function detectTextFields(
  service: SupabaseClient,
  datasetId: string,
): Promise<{ textFields: TextField[]; defaultField: string | null }> {
  const [{ data: rows }, { data: stateRow }] = await Promise.all([
    service.from('dataset_rows_flat').select('data').eq('dataset_id', datasetId)
      .order('row_index', { ascending: true }).limit(25),
    service.from('dataset_state').select('schema_config').eq('dataset_id', datasetId).maybeSingle(),
  ])

  const labels: Record<string, string> = {}
  for (const f of (stateRow?.schema_config?.fields ?? []) as { field: string; label?: string }[]) {
    if (f?.field && f.label) labels[f.field] = f.label
  }

  const stat: Record<string, { strs: number; spaced: number; len: number }> = {}
  for (const r of (rows ?? []) as { data: Record<string, unknown> }[]) {
    for (const [k, v] of Object.entries(r.data ?? {})) {
      const s = stat[k] ?? (stat[k] = { strs: 0, spaced: 0, len: 0 })
      if (typeof v === 'string' && v.trim()) {
        s.strs++; s.len += v.trim().length
        if (/\s/.test(v.trim())) s.spaced++
      }
    }
  }

  const sampled = (rows ?? []).length
  const candidates = Object.entries(stat)
    .filter(([, s]) => s.strs >= Math.max(1, sampled * 0.5) && s.spaced >= s.strs * 0.4 && s.len / s.strs >= 12)
    .map(([field, s]) => ({ field, avgLen: s.len / s.strs }))
    .sort((a, b) => b.avgLen - a.avgLen)

  const textFields = candidates.map(c => ({ field: c.field, label: labels[c.field] || prettifyField(c.field) }))
  const defaultField = textFields.find(f => f.field === 'review_text')?.field || textFields[0]?.field || null
  return { textFields, defaultField }
}

/** Resolve the dataset and enforce org ownership. Returns the dataset row or a NextResponse error. */
async function gateDataset(datasetId: string, select: string) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  const { data: dataset } = await supabase
    .from('datasets').select(select).eq('id', datasetId).single()
  if (!dataset) return { error: NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 }) }
  if (!isAdmin && (dataset as any).org_id !== orgId) {
    return { error: NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 }) }
  }
  return { dataset: dataset as any }
}

export async function GET(req: Request, props: Params) {
  const { datasetId } = await props.params
  const gate = await gateDataset(datasetId, 'org_id, row_count')
  if (gate.error) return gate.error
  const orgId = gate.dataset.org_id as string
  const totalRows = (gate.dataset.row_count as number) ?? null

  // Dimensions are per open-ended field SET — the client passes the ANALYZE
  // selection (one or more fields) so the rollup reacts to it. The set maps to a
  // canonical combined key the per-field rows are stored under. (?field= single is
  // still accepted for back-compat.)
  const url = new URL(req.url)
  // Repeated `fields=` params, NOT a CSV — open-ended field names are survey
  // question text and can themselves contain commas (e.g. "What, if anything,
  // did you like LEAST…?"), which a comma-split would shred into bogus fields.
  const multiFields = url.searchParams.getAll('fields').map(s => s.trim()).filter(Boolean)
  const selFields = multiFields.length
    ? multiFields
    : (url.searchParams.get('field') ? [(url.searchParams.get('field') as string).trim()].filter(Boolean) : [])
  const fieldKey = taxonomyFieldKey(selFields)

  const service = createServiceRoleClient()
  const fields = await detectTextFields(service, datasetId)

  // No field selected → nothing to roll up; the UI shows the "pick a field" state.
  if (!fieldKey) {
    return NextResponse.json({
      classifiedRows: 0, withSignal: 0, overallAvgRating: null, axes: [], subs: [], alerts: [], alertRows: 0,
      ...fields, totalRows, rowsWithText: 0, field: '',
    })
  }

  // Stored-rollup fast path (written at classify completion) — dashboards
  // never scan row blobs. Fallback: compute from the embedded verdicts (e.g.
  // a dataset classified before the rollup store existed).
  const [stored, rwt] = await Promise.all([
    readStoredTaxonomy(service, datasetId),
    service.rpc('dataset_rows_with_text_count', { p_dataset_id: datasetId, p_fields: selFields }),
  ])
  let rollup: TaxonomyRollup | undefined = stored?.fields?.[fieldKey]?.rollup
  if (!rollup) {
    rollup = await computeTaxonomyRollup({ service, datasetId, orgId, field: fieldKey })
  }
  // rowsWithText = the reconciling denominator (rows with text in ANY selected
  // field) — header reads "N rows with text · X% tagged", aligned with the strip.
  return NextResponse.json({ ...rollup, ...fields, totalRows, rowsWithText: Number(rwt.data ?? 0), field: fieldKey })
}

export async function POST(req: Request, props: Params) {
  const { datasetId } = await props.params
  const gate = await gateDataset(datasetId, 'org_id, row_count, source, taxonomy_suppressed')
  if (gate.error) return gate.error
  const { dataset } = gate

  const body = await req.json().catch(() => ({}))
  const cursor = Number.isFinite(body?.cursor) ? Math.max(0, Math.floor(body.cursor)) : 0
  // Which column(s) to classify — the client passes the ANALYZE selection (one or
  // more fields), combined into a single classification. JSONB key lookups, so an
  // unknown field simply yields no matches rather than erroring. (textField single
  // accepted for back-compat.)
  const textFields: string[] = Array.isArray(body?.textFields)
    ? body.textFields.map(String).map((s: string) => s.trim()).filter(Boolean)
    : (typeof body?.textField === 'string' && body.textField.trim() ? [body.textField.trim()] : ['review_text'])

  const service = createServiceRoleClient()

  // Classify tier is decided SERVER-SIDE (never client-passed): the full
  // restaurant ABSA dictionary only runs where restaurant vocabulary is
  // meaningful — google-reviews datasets and taxonomy-capable (restaurant)
  // orgs — and NEVER where the mine-themes AI judged the data non-food
  // (taxonomy_suppressed, sql/139: a hotel's google reviews). Every other
  // dataset gets the universal EMOTION-ONLY tier (disappointment / blame /
  // churn-intent language) — restaurant menu dimensions on, say, a donor
  // survey would be invented taxonomy. NB the per-dataset taxonomy_enabled
  // flag deliberately does NOT imply full: it now just reveals Dimensions;
  // a restaurant client org gets full via primaryIndustries/features.
  let mode: 'full' | 'emotion' = 'emotion'
  if (!dataset.taxonomy_suppressed) {
    if ((dataset.source as string) === 'google_reviews') mode = 'full'
    else {
      const { data: org } = await service
        .from('organizations').select('features').eq('id', dataset.org_id as string).single()
      if (orgTaxonomyEnabled(org?.features as { taxonomy?: boolean; primaryIndustries?: string[] } | null)) mode = 'full'
    }
  }

  // Drift nudge: classify ONLY the rows that lack a taxonomy entry (new since the
  // last classify). Non-destructive — existing tags are untouched — so it's safe
  // to surface contextually when rows have been added. One call drains up to 10K
  // pending rows; the client loops on hasMore.
  if (body?.pendingOnly) {
    const p = await classifyPendingRows({
      service, datasetId, orgId: dataset.org_id as string, brand: 'core', mode, textFields, maxRows: CHUNK,
    })
    return NextResponse.json({ classifiedThisCall: p.classified, done: !p.hasMore, pendingOnly: true, mode })
  }

  const r = await classifyDatasetKeyword({
    service, datasetId, orgId: dataset.org_id as string,
    brand: 'core', mode, textFields, offset: cursor, limit: CHUNK,
  })

  return NextResponse.json({
    classifiedThisCall: r.classified,
    scanned:            r.total,
    nextCursor:         r.nextOffset,
    done:               r.reachedEnd,
    totalRows:          (dataset.row_count as number) ?? null,
  })
}
