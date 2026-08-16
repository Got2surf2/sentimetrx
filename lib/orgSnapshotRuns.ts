// lib/orgSnapshotRuns.ts
// Durable record of per-tenant backup outcomes (sql/192).
//
// The nightly org-snapshot cron used to report only to its HTTP response,
// console.error and an aggregate Sentry count — none of which survive log
// rotation. On 2026-08-08 that meant an alert saying "1/9 orgs failed" and no
// way to tell WHICH org had no backup. Every outcome path now also writes here.
//
// Recording is deliberately BEST-EFFORT and never throws: a bookkeeping failure
// must not turn a successful backup into a failed cron run, nor mask a real
// backup error behind a write error. Failures are logged and swallowed.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from '@/lib/log'

/** ok = manifest committed clean · incomplete = manifest committed but a table
 *  failed to read (NEVER a green backup) · partial = out of time mid-org, parts
 *  uploaded but no manifest · failed = no usable snapshot. */
export type SnapshotRunStatus = 'ok' | 'incomplete' | 'partial' | 'failed'

export interface SnapshotRunRecord {
  orgId:       string
  day:         string            // YYYY-MM-DD
  status:      SnapshotRunStatus
  manifestKey?: string | null
  sizeBytes?:  number | null
  rowCounts?:  Record<string, number> | null
  fetchErrors?: Record<string, string> | null
  error?:      string | null
  durationMs?: number | null
  hop?:        number | null
  trigger?:    'cron' | 'manual'
}

/**
 * Upsert one (org, day) outcome. The cron is resumable and hops across
 * invocations, so an org can be touched several times a night — the row holds
 * the LATEST outcome and `attempts` counts the touches, rather than the table
 * accumulating a row per hop.
 */
export async function recordSnapshotRun(
  service: SupabaseClient,
  rec: SnapshotRunRecord,
): Promise<void> {
  try {
    const { error } = await service.rpc('record_org_snapshot_run', {
      p_org_id:       rec.orgId,
      p_day:          rec.day,
      p_status:       rec.status,
      p_manifest_key: rec.manifestKey ?? null,
      p_size_bytes:   rec.sizeBytes ?? null,
      p_row_counts:   rec.rowCounts ?? null,
      p_fetch_errors: rec.fetchErrors ?? null,
      p_error:        rec.error ? rec.error.slice(0, 500) : null,
      p_duration_ms:  rec.durationMs ?? null,
      p_hop:          rec.hop ?? null,
      p_trigger:      rec.trigger ?? 'cron',
    })
    if (error) throw error
  } catch (e) {
    // Never let bookkeeping fail the backup — or mask its real error.
    void logError('orgSnapshotRuns.record', e, { org_id: rec.orgId })
  }
}

export interface SnapshotHealthRow {
  org_id:       string
  snapshot_day: string
  status:       SnapshotRunStatus
  error:        string | null
  size_bytes:   number | null
  updated_at:   string
}

/**
 * The question the table exists to answer: which orgs do NOT have a good
 * snapshot for `day`. Returns every org whose latest row for that day is not
 * `ok`, PLUS orgs with no row at all — the silent case, and the one that
 * actually bit: an org the cron never reached leaves no trace anywhere else.
 */
export async function snapshotGapsForDay(
  service: SupabaseClient,
  day: string,
): Promise<{ gaps: SnapshotHealthRow[]; missing: string[]; total: number }> {
  const { data: orgs, error: orgErr } = await service.from('organizations').select('id')
  if (orgErr) { void logError('orgSnapshotRuns.gaps', orgErr); return { gaps: [], missing: [], total: 0 } }
  const allIds = ((orgs || []) as { id: string }[]).map(o => o.id)

  const { data: runs, error: runErr } = await service
    .from('org_snapshot_runs')
    .select('org_id, snapshot_day, status, error, size_bytes, updated_at')
    .eq('snapshot_day', day)
  if (runErr) { void logError('orgSnapshotRuns.gaps', runErr); return { gaps: [], missing: [], total: allIds.length } }

  const rows = (runs || []) as SnapshotHealthRow[]
  const seen = new Set(rows.map(r => r.org_id))
  return {
    gaps: rows.filter(r => r.status !== 'ok'),
    missing: allIds.filter(id => !seen.has(id)),
    total: allIds.length,
  }
}
