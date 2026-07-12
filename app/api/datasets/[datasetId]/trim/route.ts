// app/api/datasets/[datasetId]/trim/route.ts
// POST — delete rows from a dataset where a date field is before a cutoff date
// Body: { date_field: string, before_date: string (ISO) }
// Returns: { deleted: number, remaining: number }

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { recordAdminCrossOrgAction } from '@/lib/orgTransfer'
import { computeAnalyticsSQL } from '@/lib/analyticsCompute'
import { mergeDatasetAnalytics } from '@/lib/datasetAnalytics'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: Promise<{ datasetId: string }> }

export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const supabase = await createClient()
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

    // The raw `data->>field` PostgREST filter treats a comma in the column
    // name as a filter separator and silently matches NOTHING (the sql/161
    // class) — refuse instead of reporting "Removed 0 rows" for a real match.
    if (String(date_field).includes(',')) {
      return NextResponse.json({ error: 'Date field names containing a comma are not supported for trimming.' }, { status: 400 })
    }

    // Delete in select→delete rounds. PostgREST caps ANY select at 1000 rows
    // (verified live 2026-07-12: 1000 returned of 56,117 matching), so the
    // old single select silently trimmed at most 1000 rows per click while
    // reporting success. Loop until no matches remain — or the time budget is
    // nearly spent, then return hasMore so the client continues in a fresh
    // invocation (each round's filter scan re-evaluates against the shrunken
    // table, so progress is monotonic).
    const TRIM_PAGE = 1000
    const BUDGET_MS = 45_000 // headroom for recount + analytics within maxDuration 60
    const t0 = Date.now()
    let deleted = 0
    let hasMore = false
    for (;;) {
      if (Date.now() - t0 > BUDGET_MS) { hasMore = true; break }
      const { data: batch, error: queryErr } = await service
        .from('dataset_rows_flat')
        .select('id')
        .eq('dataset_id', params.datasetId)
        .lt('data->>' + date_field, before_date)
        .order('id', { ascending: true })
        .limit(TRIM_PAGE)
      if (queryErr) return serverError(queryErr, 'datasets.trim.query', { orgId })
      if (!batch || batch.length === 0) break
      const ids = (batch as { id: number }[]).map(function(r) { return r.id })
      for (let i = 0; i < ids.length; i += 500) {
        const { error: delErr } = await service.from('dataset_rows_flat').delete().in('id', ids.slice(i, i + 500))
        if (delErr) return serverError(delErr, 'datasets.trim.delete', { orgId })
      }
      deleted += ids.length
      if (batch.length < TRIM_PAGE) break
    }

    if (deleted === 0) {
      return NextResponse.json({ deleted: 0, remaining: dataset.row_count, hasMore: false })
    }

    // Audit cross-org admin destructive trim — SOC 2 evidence trail — with the
    // count actually deleted. Same-org calls are not logged (helper no-ops).
    await recordAdminCrossOrgAction({
      service,
      actionType:       'dataset.trim',
      resourceType:     'dataset',
      resourceId:       params.datasetId,
      targetOrgId:      dataset.org_id,
      actorOrgId:       orgId,
      initiatedBy:      user.id,
      initiatedByEmail: user.email ?? null,
      metadata:         { date_field, before_date, deleteCount: deleted, hasMore },
    })

    // Update dataset row count from authoritative flat table count
    const { count: totalRemaining } = await service
      .from('dataset_rows_flat')
      .select('id', { count: 'exact', head: true })
      .eq('dataset_id', params.datasetId)

    await service.from('datasets').update({
      row_count: totalRemaining || 0,
      updated_at: new Date().toISOString(),
    }).eq('id', params.datasetId)

    // Recompute analytics — MERGED per-key (sql/145 doctrine), never a full
    // blob replace: the old `.update({ analytics })` wiped every other
    // analytics key (`signal_stats`, `signal_stats_by_field`, the stored
    // `taxonomy` rollups + rowsWithText), which on a large classified dataset
    // dropped the Dimensions fast path until the next classify. The
    // signal-stats caches need no eager drop — they key on row_count, which
    // just changed. Skipped while hasMore (the client immediately continues;
    // recompute once at the end).
    if (!hasMore) {
      const { data: stateRow } = await service
        .from('dataset_state').select('schema_config').eq('dataset_id', params.datasetId).single()
      if (stateRow?.schema_config?.fields?.length) {
        try {
          const analytics = await computeAnalyticsSQL(service, params.datasetId, stateRow.schema_config)
          await mergeDatasetAnalytics(service, params.datasetId, analytics as unknown as Record<string, unknown>)
          await service.from('dataset_state').update({
            updated_at: new Date().toISOString(),
            updated_by: user.id,
          }).eq('dataset_id', params.datasetId)
        } catch (err) {
          console.error({ at: 'trim', msg: "analytics recompute failed", err: err })
        }
      }
    }

    return NextResponse.json({
      deleted,
      remaining: totalRemaining || Math.max(0, dataset.row_count - deleted),
      hasMore,
    })
  } catch (err: unknown) {
    return serverError(err, 'datasets.trim')
  }
}
