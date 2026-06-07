// app/api/datasets/[datasetId]/taxonomy/route.ts
// GET  — the tag-analytics roll-up for the in-app Taxonomy tab. Reads the
//        persisted dataset_row_taxonomy rows and returns axis/sub mention
//        rates, sentiment, and alert counts.
// POST — self-serve classifier. Runs one chunk of the keyword-tier classifier
//        over the dataset's rows starting at a cursor; the client loops until
//        `done`. Keyword-only (no AI cost), idempotent on (dataset_id, row_id).
// Both org-gated: pair the dataset's org_id (multi-tenancy invariant);
// non-admins must own the dataset.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeTaxonomyRollup } from '@/lib/taxonomyRollup'
import { classifyDatasetKeyword, classifyPendingRows } from '@/lib/taxonomyClassify'
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

export async function GET(_req: Request, props: Params) {
  const { datasetId } = await props.params
  const gate = await gateDataset(datasetId, 'org_id, row_count')
  if (gate.error) return gate.error

  const service = createServiceRoleClient()
  const [rollup, fields] = await Promise.all([
    computeTaxonomyRollup({ service, datasetId, orgId: gate.dataset.org_id as string }),
    detectTextFields(service, datasetId),
  ])
  // totalRows lets the tab detect drift (rows added since the last classify) and
  // surface a contextual "classify the new rows" nudge — not a permanent button.
  return NextResponse.json({ ...rollup, ...fields, totalRows: (gate.dataset.row_count as number) ?? null })
}

export async function POST(req: Request, props: Params) {
  const { datasetId } = await props.params
  const gate = await gateDataset(datasetId, 'org_id, row_count')
  if (gate.error) return gate.error
  const { dataset } = gate

  const body = await req.json().catch(() => ({}))
  const cursor = Number.isFinite(body?.cursor) ? Math.max(0, Math.floor(body.cursor)) : 0
  // Which column to classify. The client passes the user's pick; default to the
  // review field. It's a JSONB key lookup (object access, not SQL), so an
  // unknown field simply yields no matches rather than erroring.
  const textField = typeof body?.textField === 'string' && body.textField.trim()
    ? body.textField.trim() : 'review_text'

  const service = createServiceRoleClient()

  // Drift nudge: classify ONLY the rows that lack a taxonomy entry (new since the
  // last classify). Non-destructive — existing tags are untouched — so it's safe
  // to surface contextually when rows have been added. One call drains up to 10K
  // pending rows; the client loops on hasMore.
  if (body?.pendingOnly) {
    const p = await classifyPendingRows({
      service, datasetId, orgId: dataset.org_id as string, brand: 'core', textField, maxRows: CHUNK,
    })
    return NextResponse.json({ classifiedThisCall: p.classified, done: !p.hasMore, pendingOnly: true })
  }

  const r = await classifyDatasetKeyword({
    service, datasetId, orgId: dataset.org_id as string,
    brand: 'core', textField, offset: cursor, limit: CHUNK,
  })

  return NextResponse.json({
    classifiedThisCall: r.classified,
    scanned:            r.total,
    nextCursor:         r.nextOffset,
    done:               r.reachedEnd,
    totalRows:          (dataset.row_count as number) ?? null,
  })
}
