// app/api/datasets/[datasetId]/taxonomy/rows/route.ts
// GET — the comments behind a taxonomy tag, for the Taxonomy tab's drill-down.
//   ?axis=<axis>&sub=<sub>   reviews tagged that axis/sub
//   ?axis=<axis>             reviews tagged ANYWHERE on that axis (any sub)
//   ?alert=<tag>             reviews flagged at alert/crisis severity for that tag
//   ?limit=<n>               default 100, max 200
// Org-gated: pairs the dataset's org_id (multi-tenancy invariant); non-admins
// must own the dataset. Reads dataset_row_taxonomy (GIN-indexed axis arrays) →
// joins dataset_rows_flat for the row text. Returns matched-evidence quotes so
// the UI can highlight why each comment was tagged.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ datasetId: string }> }

// axis name → the denormalized text[] column on dataset_row_taxonomy. Acts as
// an allowlist so the `axis` query param can never name an arbitrary column.
const AXIS_COL: Record<string, string> = {
  touchpoint: 'axis_touchpoint', attribute: 'axis_attribute', product: 'axis_product',
  beverage: 'axis_beverage', ambiance: 'axis_ambiance', context: 'axis_context', outcome: 'axis_outcome',
}

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
    const k = a.axis + '' + a.sub
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
  const orgIdForRead = dataset.org_id as string

  const url = new URL(req.url)
  const axis  = (url.searchParams.get('axis')  || '').trim()
  const sub   = (url.searchParams.get('sub')   || '').trim()
  const alert = (url.searchParams.get('alert') || '').trim()
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 200)

  const service = createServiceRoleClient()
  let q = service
    .from('dataset_row_taxonomy')
    .select('row_id, assertions', { count: 'exact' })
    .eq('dataset_id', datasetId)
    .eq('org_id', orgIdForRead)

  let label: string
  if (alert) {
    q = q.contains('alert_tags', [alert])
    label = alert
  } else {
    const col = AXIS_COL[axis]
    if (!col) return NextResponse.json({ error: 'a valid axis (with optional sub) or alert is required' }, { status: 400 })
    if (sub) {
      q = q.contains(col, [sub])           // specific sub-dimension
      label = `${axis} · ${sub}`
    } else {
      q = q.neq(col, '{}')                  // any tag on this axis (non-empty array)
      label = axis
    }
  }

  const { data: tax, count, error } = await q.limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rowIds = (tax ?? []).map(t => t.row_id)
  const byId: Record<number, Record<string, unknown>> = {}
  if (rowIds.length) {
    const { data: rows } = await service
      .from('dataset_rows_flat').select('id, data').in('id', rowIds)
    for (const r of (rows ?? []) as { id: number; data: Record<string, unknown> }[]) byId[r.id] = r.data
  }

  const comments = (tax ?? []).map(t => {
    const data = byId[t.row_id] ?? {}
    return {
      text:     pickText(data),
      rating:   (data.rating as number) ?? null,
      date:     (data.review_date as string) || (data.date as string) || null,
      evidence: collectEvidence(t.assertions, axis, sub, alert),
      tags:     collectTags(t.assertions),
    }
  }).filter(c => c.text)

  return NextResponse.json({ label, count: count ?? comments.length, comments })
}
