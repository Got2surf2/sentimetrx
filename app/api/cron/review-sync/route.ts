// app/api/cron/review-sync/route.ts
// Cron endpoint: syncs Google Reviews for sources due for update.
// Runs every 6 hours via Vercel Cron.
//
// vercel.json config:
// { "crons": [{ "path": "/api/cron/review-sync", "schedule": "0 */6 * * *" }] }

import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { syncReviewSource } from '@/lib/reviewSync'
import { checkCronAuth } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const service = createServiceRoleClient()
  const now = new Date().toISOString()

  // Find active sources due for sync. sync_frequency_hours = 0 means manual
  // mode — don't pick those up automatically (their next_sync_at is also
  // pushed far out, but the explicit filter is belt-and-suspenders).
  const { data: dueSources, error } = await service
    .from('review_sources')
    .select('id, brand_name')
    .eq('status', 'active')
    .gt('sync_frequency_hours', 0)
    .lte('next_sync_at', now)
    .order('next_sync_at', { ascending: true })
    .limit(5) // Process up to 5 per run to stay within timeout

  if (error) {
    console.error('[cron/review-sync] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!dueSources?.length) {
    return NextResponse.json({ ok: true, synced: 0, message: 'No sources due for sync' })
  }

  const results: { brand: string; synced: number; errors: number }[] = []
  let consecutiveErrors = 0

  for (const source of dueSources) {
    try {
      const result = await syncReviewSource(source.id, service)
      results.push({
        brand: source.brand_name,
        synced: result.synced,
        errors: result.locations_errored,
      })
      consecutiveErrors = 0
    } catch (err: any) {
      console.error('[cron/review-sync] source', source.id, 'failed:', err)
      results.push({ brand: source.brand_name, synced: 0, errors: 1 })
      consecutiveErrors++

      // Stash the error message for visibility but DON'T flip status to
      // 'error'. Previously a single transient failure permanently parked
      // the source (cron query filters status='active', so it was never
      // retried). Now the source stays active; next_sync_at advances
      // naturally so the cron picks it up on the next cycle. Persistent
      // failures will keep logging but not silently disappear from the
      // refresh schedule.
      await service.from('review_sources').update({
        error_message: err?.message?.slice(0, 500) || 'Cron sync failed',
        next_sync_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        updated_at: now,
      }).eq('id', source.id)

      // Stop if too many consecutive errors (likely a systemic issue —
      // e.g. DataforSEO is down, our key is invalid). Other sources will
      // be tried on the next cron run.
      if (consecutiveErrors >= 3) break
    }
  }

  const totalSynced = results.reduce(function(sum, r) { return sum + r.synced }, 0)
  const totalErrors = results.reduce(function(sum, r) { return sum + r.errors }, 0)

  return NextResponse.json({
    ok: true,
    sources_processed: results.length,
    total_synced: totalSynced,
    total_errors: totalErrors,
    results,
  })
}
