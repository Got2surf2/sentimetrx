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
// Time-budgeted continuation (ARCHITECTURE.md D16b, added 2026-07-04;
// intra-org resume added 2026-07-13): orgs are processed in deterministic
// id order; when TIME_BUDGET_MS expires the run re-invokes itself via
// waitUntil with `?after=<org-id>&hop=N` so each hop handles a slice and
// the chain covers every org. A SINGLE org whose dump outruns the budget
// no longer dies at the 300 s ceiling with nothing to show: the dump bails
// at a page boundary, checkpoints to `<prefix>partial.json` (invisible to
// listings — no manifest, no snapshot), and the continuation carries
// `&resume=<org-id>&d=<YYYY-MM-DD>` so the next hop picks the SAME org up
// mid-table (multi-part objects) instead of restarting it from scratch.
// Each hop reports its own slice loudly (non-2xx + Sentry via logError); a
// hop's failure never blocks the continuation for the orgs after it.
//
// Auth: Vercel cron header via lib/cronAuth.ts. Same fail-closed semantics
// as every other /api/cron route. Continuation hops send the same
// `Bearer CRON_SECRET` header.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { checkCronAuth } from '@/lib/cronAuth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  dumpOrgSnapshotV2Resumable,
  loadSnapshotCheckpoint,
  checkpointProgress,
  snapshotV2Prefix,
} from '@/lib/orgSnapshotV2'
import { s3SnapshotStore } from '@/lib/backupS3'
import { serverError } from '@/lib/apiError'
import { logError } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes per hop; the org loop bails at TIME_BUDGET_MS

// Bail out of the org loop at ~240 s — headroom under maxDuration for the
// page in flight, the part close/upload, and the continuation kick.
const TIME_BUDGET_MS = 240_000
// Runaway-chain breaker. Every hop advances the state — a finished org
// moves the ?after cursor, an unfinished one advances its checkpoint by at
// least one part — so a chain deeper than this (~80 min of dump work)
// means something is wrong; refuse it.
const MAX_HOPS = 20

interface OrgResult {
  org_id: string
  org_name: string | null
  key?: string
  size_bytes?: number
  row_counts?: Record<string, number>
  fetch_errors?: Record<string, string>
  // Deadline bail mid-org: parts uploaded + checkpoint written, manifest
  // pending — the continuation hop finishes it. Not a failure.
  partial?: boolean
  error?: string
  ms: number
}

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const url = new URL(req.url)
  const after = url.searchParams.get('after')
  const resume = url.searchParams.get('resume')
  const resumeDay = url.searchParams.get('d') // YYYY-MM-DD (UTC) — the resumed org's prefix day
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
  const deadlineAt = started + TIME_BUDGET_MS
  const store = s3SnapshotStore()
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const all = (orgs || []) as Array<{ id: string; name: string | null }>
  const results: OrgResult[] = []
  // Set when an org's dump bailed on the deadline → continuation must carry
  // resume=<id>&d=<day> and must not start further orgs this hop.
  let resumeKick: { orgId: string; day: string } | null = null

  // ---- 1) A resumed org continues FIRST, from its checkpoint. -------------
  if (resume) {
    const orgStart = Date.now()
    const day = resumeDay && /^\d{4}-\d{2}-\d{2}$/.test(resumeDay) ? resumeDay : todayStr
    const prefix = snapshotV2Prefix(resume, new Date(day + 'T00:00:00Z'))
    try {
      // Checkpoint may be null (prior hop crashed before writing one) —
      // the dump then starts the org over, which is the correct fallback.
      const checkpoint = await loadSnapshotCheckpoint(store, prefix)
      const before = checkpointProgress(checkpoint)
      const out = await dumpOrgSnapshotV2Resumable(service, resume, store, { prefix, deadlineAt, checkpoint })
      if (out.done) {
        const fetchErrors = out.meta.fetch_errors
        const hasFetchErrors = Object.keys(fetchErrors).length > 0
        results.push({
          org_id: resume,
          org_name: out.meta.org_name,
          key: out.manifestKey,
          size_bytes: out.meta.total_bytes,
          row_counts: out.meta.table_row_counts,
          ...(hasFetchErrors ? { fetch_errors: fetchErrors, error: 'incomplete snapshot: ' + Object.keys(fetchErrors).join(', ') } : {}),
          ms: Date.now() - orgStart,
        })
      } else if (checkpointProgress(out.checkpoint) > before) {
        resumeKick = { orgId: resume, day }
        results.push({ org_id: resume, org_name: out.checkpoint.org_name, partial: true, ms: Date.now() - orgStart })
      } else {
        // A resume hop that advanced nothing would chain to the hop cap
        // doing zero work — give this org up for tonight, loudly, and let
        // the rest of the fleet back up.
        const stallErr = new Error('org-snapshot resume for org ' + resume + ' made no progress at hop ' + hop)
        await logError('cron.orgSnapshot.stalled', stallErr, { hop, org_id: resume })
        results.push({ org_id: resume, org_name: out.checkpoint.org_name, error: 'resume made no progress — org NOT backed up tonight', ms: Date.now() - orgStart })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[org-snapshot] resumed org ' + resume + ' failed:', msg)
      results.push({ org_id: resume, org_name: null, error: msg, ms: Date.now() - orgStart })
    }
  }

  // ---- 2) Fresh orgs, in id order, until the budget or a mid-org bail. ----
  let idx = 0
  if (!resumeKick) {
    for (; idx < all.length; idx++) {
      const org = all[idx]
      // Budget bail — but never before the hop's first unit of work (a
      // resumed org counts), so every hop advances the chain's state.
      if (results.length > 0 && Date.now() - started > TIME_BUDGET_MS) break
      const orgStart = Date.now()
      try {
        const out = await dumpOrgSnapshotV2Resumable(service, org.id, store, {
          prefix: snapshotV2Prefix(org.id, now),
          deadlineAt,
        })
        if (out.done) {
          const fetchErrors = out.meta.fetch_errors
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
            key: out.manifestKey,
            size_bytes: out.meta.total_bytes,
            row_counts: out.meta.table_row_counts,
            ...(hasFetchErrors ? { fetch_errors: fetchErrors, error: 'incomplete snapshot: ' + Object.keys(fetchErrors).join(', ') } : {}),
            ms: Date.now() - orgStart,
          })
        } else {
          resumeKick = { orgId: org.id, day: todayStr }
          results.push({ org_id: org.id, org_name: org.name, partial: true, ms: Date.now() - orgStart })
          idx++
          break
        }
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
    }
  }

  // ---- 3) Continuation for whatever is left. -------------------------------
  const remaining = all.length - idx
  let continued = false
  const needsContinuation = resumeKick !== null || remaining > 0
  if (needsContinuation) {
    const nextHop = hop + 1
    // A bailed org re-enters via resume; the ?after cursor moves past it so
    // the org list never serves it twice.
    const nextAfter = resumeKick ? resumeKick.orgId : idx > 0 ? all[idx - 1].id : after
    if (nextHop > MAX_HOPS) {
      // Can't hand off — surface the unbacked-up orgs as this hop's failure.
      const capErr = new Error('org-snapshot hop cap (' + MAX_HOPS + ') reached with ' + (remaining + (resumeKick ? 1 : 0)) + ' orgs left unbacked-up')
      await logError('cron.orgSnapshot.hopCap', capErr, { hop, orgs_remaining: remaining, resume_org: resumeKick?.orgId ?? null })
      const rk = resumeKick
      if (rk) {
        // The partial entry is NOT a completed backup once the chain ends here.
        const partialEntry = results.find(r => r.org_id === rk.orgId && r.partial)
        if (partialEntry) {
          partialEntry.error = 'hop cap reached mid-org — parts uploaded but NO manifest; org NOT backed up'
        }
      }
      if (remaining > 0) {
        results.push({
          org_id: all[idx].id,
          org_name: all[idx].name,
          error: 'hop cap reached — this org and ' + (remaining - 1) + ' after it were NOT backed up',
          ms: 0,
        })
      }
    } else {
      const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai').replace(/\/$/, '')
      let nextUrl = baseUrl + '/api/cron/org-snapshot?hop=' + nextHop
      if (nextAfter) nextUrl += '&after=' + encodeURIComponent(nextAfter)
      if (resumeKick) nextUrl += '&resume=' + encodeURIComponent(resumeKick.orgId) + '&d=' + resumeKick.day
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
    resumed: resume || null,
    orgs_total: results.length,
    orgs_succeeded: successCount,
    orgs_failed: failedCount,
    orgs_remaining: remaining,
    continued,
    next_after: continued ? (resumeKick ? resumeKick.orgId : idx > 0 ? all[idx - 1].id : after) : null,
    next_resume: continued && resumeKick ? resumeKick.orgId : null,
    total_bytes_uploaded: totalBytes,
    elapsed_ms: Date.now() - started,
    results,
  }, { status: failedCount === 0 ? 200 : 500 })
}
