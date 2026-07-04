// app/api/cron/org-snapshot/route.ts
// Nightly Vercel cron. Loops every org and streams tenant-scoped state to
// S3 as a snapshot v2 — one gzipped NDJSON object per table plus a
// manifest commit marker (lib/orgSnapshotV2), UNCAPPED and constant-memory
// regardless of tenant size.
//
// Designed to be re-runnable: the destination prefix is deterministic per
// org+day, so a retry overwrites the same keys (S3 versioning preserves
// prior copies for forensic recovery).
//
// Time-budgeted continuation (ARCHITECTURE.md D16b, added 2026-07-04):
// orgs are processed in deterministic id order; when TIME_BUDGET_MS
// expires with orgs remaining, the run re-invokes itself via waitUntil
// with `?after=<last-org-id>&hop=N` so each hop handles a slice and the
// chain covers every org — no single-invocation 300 s ceiling. Each hop
// reports its own slice loudly (non-2xx + Sentry via logError); a hop's
// failure never blocks the continuation for the orgs after it.
//
// Auth: Vercel cron header via lib/cronAuth.ts. Same fail-closed semantics
// as every other /api/cron route. Continuation hops send the same
// `Bearer CRON_SECRET` header.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { checkCronAuth } from '@/lib/cronAuth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { dumpOrgSnapshotV2 } from '@/lib/orgSnapshotV2'
import { s3SnapshotStore } from '@/lib/backupS3'
import { serverError } from '@/lib/apiError'
import { logError } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes per hop; the org loop bails at TIME_BUDGET_MS

// Bail out of the org loop at ~240 s — headroom under maxDuration for the
// org already in flight plus the continuation kick.
const TIME_BUDGET_MS = 240_000
// Runaway-chain breaker. Each hop strictly advances ?after past at least one
// org, so a chain deeper than this means something is wrong — refuse it.
const MAX_HOPS = 20

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const url = new URL(req.url)
  const after = url.searchParams.get('after')
  const hop = Number(url.searchParams.get('hop') || '0')
  if (!Number.isInteger(hop) || hop < 0 || hop > MAX_HOPS) {
    return serverError(
      new Error('org-snapshot refused hop=' + url.searchParams.get('hop') + ' (cap ' + MAX_HOPS + ') — runaway continuation chain?'),
      'cron.orgSnapshot.hopCap',
    )
  }

  const service = createServiceRoleClient()
  let query = service.from('organizations').select('id, name')
  if (after) query = query.gt('id', after) // cursor strictly advances: only orgs past the last processed id
  // Deterministic id order — the continuation cursor depends on it.
  const { data: orgs, error } = await query.order('id', { ascending: true })

  if (error) {
    return serverError(error, 'cron.orgSnapshot.listOrgs')
  }

  const started = Date.now()
  const all = (orgs || []) as Array<{ id: string; name: string | null }>
  const results: Array<{ org_id: string; org_name: string | null; key?: string; size_bytes?: number; row_counts?: Record<string, number>; fetch_errors?: Record<string, string>; error?: string; ms: number }> = []
  let processed = 0

  for (const org of all) {
    // Budget bail — but never before the first org, so every hop advances the
    // cursor past at least one org (the other half of the runaway-chain guard).
    if (processed > 0 && Date.now() - started > TIME_BUDGET_MS) break
    const orgStart = Date.now()
    try {
      const { manifestKey, meta } = await dumpOrgSnapshotV2(service, org.id, s3SnapshotStore())
      const fetchErrors = meta.fetch_errors
      const hasFetchErrors = Object.keys(fetchErrors).length > 0
      if (hasFetchErrors) {
        // A table failed to read → the uploaded snapshot is INCOMPLETE. Surface
        // it as an error so the run can't report a green backup that silently
        // dropped a content table.
        console.error('[org-snapshot] org ' + org.id + ' INCOMPLETE — fetch errors:', JSON.stringify(fetchErrors))
      }
      results.push({
        org_id: org.id,
        org_name: org.name,
        key: manifestKey,
        size_bytes: meta.total_bytes,
        row_counts: meta.table_row_counts,
        ...(hasFetchErrors ? { fetch_errors: fetchErrors, error: 'incomplete snapshot: ' + Object.keys(fetchErrors).join(', ') } : {}),
        ms: Date.now() - orgStart,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[org-snapshot] org ' + org.id + ' failed:', msg)
      results.push({
        org_id: org.id,
        org_name: org.name,
        error: msg,
        ms: Date.now() - orgStart,
      })
    }
    processed++
  }

  // Continuation: budget expired with orgs left → re-invoke self for the rest,
  // via waitUntil so THIS hop's response (its slice's pass/fail) returns first.
  const remaining = all.length - processed
  let continued = false
  if (remaining > 0) {
    const nextHop = hop + 1
    const nextAfter = all[processed - 1].id
    if (nextHop > MAX_HOPS) {
      // Can't hand off — surface the unbacked-up orgs as this hop's failure.
      const capErr = new Error('org-snapshot hop cap (' + MAX_HOPS + ') reached with ' + remaining + ' orgs left unbacked-up')
      await logError('cron.orgSnapshot.hopCap', capErr, { hop, orgs_remaining: remaining })
      results.push({
        org_id: all[processed].id,
        org_name: all[processed].name,
        error: 'hop cap reached — this org and ' + (remaining - 1) + ' after it were NOT backed up',
        ms: 0,
      })
    } else {
      const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai').replace(/\/$/, '')
      const nextUrl = baseUrl + '/api/cron/org-snapshot?after=' + encodeURIComponent(nextAfter) + '&hop=' + nextHop
      const kick = fetch(nextUrl, { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } })
        .then(res => {
          // The child hop self-reports its failures (logError below), but a
          // hop that never ran (network error, 401, crash) would otherwise
          // vanish silently — the chain's only reader is this status check.
          if (!res.ok) return logError('cron.orgSnapshot.continuation', new Error('continuation hop ' + nextHop + ' returned HTTP ' + res.status), { hop: nextHop, after: nextAfter })
        })
        .catch((e: unknown) => logError('cron.orgSnapshot.continuation', e, { hop: nextHop, after: nextAfter }))
      // Outside a request context (tests/scripts) waitUntil throws — fall back.
      try { waitUntil(kick) } catch { void kick }
      continued = true
    }
  }

  const successCount = results.filter(r => !r.error).length
  const failedCount = results.length - successCount
  const totalBytes = results.reduce((s, r) => s + (r.size_bytes || 0), 0)

  // Each hop reports its own slice loudly. The non-2xx below only reaches the
  // Vercel cron log for hop 0 — continuation hops' responses are read by no
  // one — so failures also go to Sentry explicitly, every hop.
  if (failedCount > 0) {
    await logError('cron.orgSnapshot.run', new Error('org-snapshot hop ' + hop + ': ' + failedCount + '/' + results.length + ' orgs failed'), { hop, orgs_failed: failedCount })
  }

  // Fail the run (non-2xx) if any org's backup failed or was incomplete, so the
  // Vercel cron surfaces red instead of a silent "ok" over a bad backup.
  return NextResponse.json({
    ok: failedCount === 0,
    hop,
    after: after || null,
    orgs_total: results.length,
    orgs_succeeded: successCount,
    orgs_failed: failedCount,
    orgs_remaining: remaining,
    continued,
    next_after: continued ? all[processed - 1].id : null,
    total_bytes_uploaded: totalBytes,
    elapsed_ms: Date.now() - started,
    results,
  }, { status: failedCount === 0 ? 200 : 500 })
}
