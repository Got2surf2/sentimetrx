// app/api/cron/review-sync/route.ts
// Cron endpoint: syncs Google Reviews for sources due for update.
// Runs every 6 hours via Vercel Cron.
//
// vercel.json config:
// { "crons": [{ "path": "/api/cron/review-sync", "schedule": "0 */6 * * *" }] }

import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { syncReviewSource } from '@/lib/reviewSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceRoleClient()
  const now = new Date().toISOString()

  // Find active sources due for sync
  const { data: dueSources, error } = await service
    .from('review_sources')
    .select('id, brand_name')
    .eq('status', 'active')
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

      // Mark source as error after failure
      await service.from('review_sources').update({
        error_message: err?.message || 'Cron sync failed',
        status: 'error',
        updated_at: now,
      }).eq('id', source.id)

      // Stop if too many consecutive errors (likely a systemic issue)
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
