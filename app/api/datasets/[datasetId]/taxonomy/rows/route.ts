// app/api/datasets/[datasetId]/taxonomy/rows/route.ts
// GET — the comments behind a taxonomy tag, for the Taxonomy tab's drill-down.
//   ?axis=<axis>&sub=<sub>   reviews tagged that axis/sub
//   ?axis=<axis>             reviews tagged ANYWHERE on that axis (any sub)
//   ?alert=<tag>             reviews flagged at alert/crisis severity for that tag
//   ?limit=<n>               default 100, max 200
// Org-gated: pairs the dataset's org_id (multi-tenancy invariant); non-admins
// must own the dataset. Reads the verdicts embedded in dataset_rows_flat.data
// via the taxonomy_drill_rows RPC (sql/151) — row text and tags come from the
// same row. Returns matched-evidence quotes so the UI can highlight why each
// comment was tagged.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { taxonomyFieldKey } from '@/lib/dimensionFields'
import { resolveMemberDatasetIds } from '@/lib/collectionScope'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ datasetId: string }> }

// Allowlist so the `axis` query param can never reach SQL as an arbitrary key.
const AXIS_SET = new Set(['touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome', 'emotion'])

/** Best-effort pick of the human-readable text from a flat row. */
function pickText(data: Record<string, unknown>): string {
  for (const k of ['review_text', 'comment', 'feedback', 'response', 'text']) {
    const v = data?.[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  // Fallback: the longest string value on the row.
  let best = ''
  for (const v of Object.values(data ?? {})) {
    if (typeof v === 'string' && v.trim().length > best.length) best = v.trim()
  }
  return best
}

/** Collect the evidence quotes from a row's assertions that match the clicked tag. */
function collectEvidence(assertions: unknown, axis: string, sub: string, alert: string): string[] {
  if (!Array.isArray(assertions)) return []
  const out = new Set<string>()
  for (const a of assertions as { axis?: string; sub?: string; evidence?: string }[]) {
    // sub empty → axis-level drill: match any assertion on this axis.
    const hit = alert ? a?.sub === alert : (a?.axis === axis && (sub ? a?.sub === sub : true))
    if (hit && typeof a?.evidence === 'string' && a.evidence.trim()) out.add(a.evidence.trim())
  }
  return [...out]
}

/** Every distinct (axis, sub) tag on a row — so the UI can show what else the comment hit. */
function collectTags(assertions: unknown): { axis: string; sub: string; evidence: string[] }[] {
  if (!Array.isArray(assertions)) return []
  const map = new Map<string, { axis: string; sub: string; evidence: Set<string> }>()
  for (const a of assertions as { axis?: string; sub?: string; evidence?: string }[]) {
    if (!a?.axis || !a?.sub) continue
    const k = a.axis + '\u0001' + a.sub
    if (!map.has(k)) map.set(k, { axis: a.axis, sub: a.sub, evidence: new Set() })
    if (typeof a.evidence === 'string' && a.evidence.trim()) map.get(k)!.evidence.add(a.evidence.trim())
  }
  return [...map.values()].map(t => ({ axis: t.axis, sub: t.sub, evidence: [...t.evidence] }))
}

export async function GET(req: Request, props: Params) {
  const { datasetId } = await props.params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  const { data: dataset } = await supabase
    .from('datasets').select('org_id').eq('id', datasetId).single()
  if (!dataset) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) {
    return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  }
  const url = new URL(req.url)
  const axis  = (url.searchParams.get('axis')  || '').trim()
  const sub   = (url.searchParams.get('sub')   || '').trim()
  const alert = (url.searchParams.get('alert') || '').trim()
  // The analyzed field SET (one or more), → the canonical combined key the tags are
  // stored under. Repeated `fields=` params, NOT a CSV — field names can contain
  // commas (survey question text). (?field= single accepted for back-compat.)
  const multiFields = url.searchParams.getAll('fields').map(s => s.trim()).filter(Boolean)
  const selFields = multiFields.length
    ? multiFields
    : (url.searchParams.get('field') ? [(url.searchParams.get('field') as string).trim()].filter(Boolean) : [])
  const fieldKey = taxonomyFieldKey(selFields)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 200)

  const service = createServiceRoleClient()

  let label: string
  if (alert) {
    label = alert
  } else {
    if (!AXIS_SET.has(axis)) return NextResponse.json({ error: 'a valid axis (with optional sub) or alert is required' }, { status: 400 })
    label = sub ? `${axis} · ${sub}` : axis
  }
  // The UI always scopes to the analyzed field(s); an older caller without one
  // gets the dataset's primary classified field (same resolution Charts uses).
  let effFieldKey = fieldKey
  if (!effFieldKey) {
    const { data: pf } = await service.rpc('taxonomy_primary_field', { p_dataset_id: datasetId })
    effFieldKey = (pf as string | null) ?? ''
  }
  if (!effFieldKey) return NextResponse.json({ label, count: 0, comments: [] })

  // The embedded verdicts and the row text live on the same row now — one RPC
  // returns both plus the window count (the old sidecar read needed a second
  // lookup for the text). A collection owns no rows, so the drill runs over its
  // members and the pages are merged: counts add up, and each member
  // contributes at most `limit` comments before the merged list is trimmed
  // back to it.
  type DrillRow = { row_id: number; data: Record<string, unknown>; tx: { as?: unknown } | null; total_count: number }
  const datasetIds = await resolveMemberDatasetIds(service, datasetId)
  const pages: DrillRow[][] = []
  let count = 0
  for (const memberId of datasetIds) {
    const { data: tax, error } = await service.rpc('taxonomy_drill_rows', {
      p_dataset_id: memberId,
      p_field_key:  effFieldKey,
      p_axis:       alert ? null : axis,
      p_sub:        !alert && sub ? sub : null,
      p_alert:      alert || null,
      p_limit:      limit,
    })
    if (error) return serverError(error, 'datasets.taxonomyRows', { orgId: orgId ?? undefined })
    const page = (tax ?? []) as DrillRow[]
    if (page.length) count += Number(page[0].total_count)   // window count is per member — they add up
    pages.push(page)
  }
  // Interleaved, not concatenated: on a collection the first member would
  // otherwise fill the whole page and the second brand would never appear.
  const rows: DrillRow[] = []
  for (let i = 0; rows.length < limit; i++) {
    const before = rows.length
    for (const page of pages) {
      if (i < page.length && rows.length < limit) rows.push(page[i])
    }
    if (rows.length === before) break
  }

  const comments = rows.map(t => {
    const data = t.data ?? {}
    // Show the text of the FIELD that was classified (the per-field drill), not a
    // heuristic pick — otherwise a row's other open-ended column can be displayed
    // while the chips/evidence come from the classified field, which reads as a
    // false positive (e.g. a "Review" tagged product:chicken shown next to a
    // different column with no "chicken"). Fall back to pickText only when no
    // field is scoped or that cell is empty.
    // Show the analyzed field(s) text — the combined text the chips/evidence came
    // from — not a heuristic pick. Multiple fields are joined with a blank line.
    const fieldText = selFields.length
      ? selFields.map(f => String((data as Record<string, unknown>)[f] ?? '').trim()).filter(Boolean).join('\n\n')
      : ''
    return {
      text:     fieldText || pickText(data),
      rating:   (data.rating as number) ?? null,
      date:     (data.review_date as string) || (data.date as string) || null,
      evidence: collectEvidence(t.tx?.as, axis, sub, alert),
      tags:     collectTags(t.tx?.as),
    }
  }).filter(c => c.text)

  return NextResponse.json({ label, count: count || comments.length, comments })
}
