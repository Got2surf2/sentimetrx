// app/api/admin/sentry/issues/route.ts
// GET  — fetch the live unresolved-issues list from Sentry. Used by the
//        /admin/sentry page on demand (not cached). Daily snapshots come from
//        a separate cron route.
// POST — change an issue's status (resolve / archive / reopen) from the same
//        page. Admin-gated; the Sentry write happens server-side so the
//        encrypted token never reaches the browser.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { fetchUnresolvedIssues, updateIssueStatus, type SentryIssueStatus } from '@/lib/sentry'

export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  const digest = await fetchUnresolvedIssues(50)
  return NextResponse.json(digest)
}

const VALID_STATUS: readonly SentryIssueStatus[] = ['resolved', 'ignored', 'unresolved']

export async function POST(req: Request) {
  const denied = await requireAdmin()
  if (denied) return denied

  let body: { id?: unknown; status?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'Invalid JSON body.' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const status = body.status
  if (!id) {
    return NextResponse.json({ ok: false, reason: 'Missing issue id.' }, { status: 400 })
  }
  if (typeof status !== 'string' || !VALID_STATUS.includes(status as SentryIssueStatus)) {
    return NextResponse.json({ ok: false, reason: `status must be one of: ${VALID_STATUS.join(', ')}.` }, { status: 400 })
  }

  const result = await updateIssueStatus(id, status as SentryIssueStatus)
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
