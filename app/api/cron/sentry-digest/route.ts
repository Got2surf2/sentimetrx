// app/api/cron/sentry-digest/route.ts
// Daily Sentry snapshot. Fetches the current unresolved-issues list and
// writes one row to sentry_snapshots. Trend over time is then visible
// on the /admin/sentry page (count by day) as more rows accumulate.
//
// Scheduled by vercel.json: 0 13 * * *  (13:00 UTC ≈ 9:00 ET).

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkCronAuth } from '@/lib/cronAuth'
import { fetchUnresolvedIssues } from '@/lib/sentry'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const digest = await fetchUnresolvedIssues(50)
  const service = createServiceRoleClient()
  const { error } = await service.from('sentry_snapshots').insert({
    unresolved_count: digest.total,
    issues:           digest.issues,
    error:            digest.ok ? null : (digest.reason || 'unknown'),
  })
  if (error) {
    console.error('[cron/sentry-digest] insert error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok:               digest.ok,
    configured:       digest.configured,
    unresolved_count: digest.total,
  })
}
