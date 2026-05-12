// app/api/admin/sentry/issues/route.ts
// GET — fetch the live unresolved-issues list from Sentry. Used by the
// /admin/sentry page on demand (not cached). Daily snapshots come from a
// separate cron route.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { fetchUnresolvedIssues } from '@/lib/sentry'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  const digest = await fetchUnresolvedIssues(50)
  return NextResponse.json(digest)
}
