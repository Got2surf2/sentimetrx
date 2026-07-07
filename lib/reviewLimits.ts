import 'server-only'

// lib/reviewLimits.ts
//
// Review-download accounting + per-org monthly caps. Backs the Darden-pilot
// cost guard: orgs can be given a `review_records_monthly` limit, and
// lib/reviewSync.ts checks the remaining monthly budget before submitting
// (and to cap the depth of) DataForSEO review tasks.
//
// Ledger: public.review_downloads, one row per sync that ingested rows.
// Cap:    organizations.limits.review_records_monthly (absent = unlimited).
// Window: calendar month, UTC.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from '@/lib/log'

export interface ReviewBudget {
  /** Monthly record cap, or null when the org is uncapped. */
  cap:       number | null
  /** Records already downloaded this calendar month. */
  used:      number
  /** cap - used (never negative), or null when uncapped. */
  remaining: number | null
}

/** ISO timestamp for 00:00 UTC on the first of the current month. */
function monthStartIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/** Read an org's review-download budget for the current calendar month.
 *  `cap`/`remaining` are null when the org has no limit configured. */
export async function getReviewBudget(
  service: SupabaseClient,
  orgId: string,
): Promise<ReviewBudget> {
  const { data: org, error: orgErr } = await service
    .from('organizations')
    .select('limits')
    .eq('id', orgId)
    .single()
  if (orgErr) void logError('reviewLimits.getReviewBudget', orgErr, { orgId })

  const rawCap = (org as { limits?: { review_records_monthly?: unknown } | null } | null)?.limits?.review_records_monthly
  const cap = typeof rawCap === 'number' && rawCap > 0 ? Math.floor(rawCap) : null

  const { data: rows, error: rowsErr } = await service
    .from('review_downloads')
    .select('records')
    .eq('org_id', orgId)
    .gte('created_at', monthStartIso())
  if (rowsErr) void logError('reviewLimits.getReviewBudget', rowsErr, { orgId })

  const used = (rows || []).reduce((sum, r: { records?: number | null }) => sum + (r.records || 0), 0)

  return {
    cap,
    used,
    remaining: cap === null ? null : Math.max(0, cap - used),
  }
}

/** Append a row to the review-download ledger. Called once per sync call
 *  that ingested rows. No-op when `records` is 0. */
export async function logReviewDownload(
  service: SupabaseClient,
  opts: {
    orgId:           string
    reviewSourceId:  string | null
    datasetId:       string | null
    source:          string
    records:         number
  },
): Promise<void> {
  if (!opts.records || opts.records <= 0) return
  const source = opts.source === 'tripadvisor' ? 'tripadvisor' : 'google'
  await service.from('review_downloads').insert({
    org_id:           opts.orgId,
    review_source_id: opts.reviewSourceId,
    dataset_id:       opts.datasetId,
    source,
    records:          opts.records,
  })
}
