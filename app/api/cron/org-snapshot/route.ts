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
// Auth: Vercel cron header via lib/cronAuth.ts. Same fail-closed semantics
// as every other /api/cron route.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cronAuth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { dumpOrgSnapshotV2 } from '@/lib/orgSnapshotV2'
import { s3SnapshotStore } from '@/lib/backupS3'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes — enough for ~30 orgs at present scale

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const service = createServiceRoleClient()
  const { data: orgs, error } = await service
    .from('organizations')
    .select('id, name')
    .order('created_at', { ascending: true })

  if (error) {
    return serverError(error, 'cron.orgSnapshot.listOrgs')
  }

  const started = Date.now()
  const results: Array<{ org_id: string; org_name: string | null; key?: string; size_bytes?: number; row_counts?: Record<string, number>; fetch_errors?: Record<string, string>; error?: string; ms: number }> = []

  for (const org of orgs || []) {
    const orgStart = Date.now()
    try {
      const { manifestKey, meta } = await dumpOrgSnapshotV2(service, (org as any).id, s3SnapshotStore())
      const fetchErrors = meta.fetch_errors
      const hasFetchErrors = Object.keys(fetchErrors).length > 0
      if (hasFetchErrors) {
        // A table failed to read → the uploaded snapshot is INCOMPLETE. Surface
        // it as an error so the run can't report a green backup that silently
        // dropped a content table.
        console.error('[org-snapshot] org ' + (org as any).id + ' INCOMPLETE — fetch errors:', JSON.stringify(fetchErrors))
      }
      results.push({
        org_id: (org as any).id,
        org_name: (org as any).name,
        key: manifestKey,
        size_bytes: meta.total_bytes,
        row_counts: meta.table_row_counts,
        ...(hasFetchErrors ? { fetch_errors: fetchErrors, error: 'incomplete snapshot: ' + Object.keys(fetchErrors).join(', ') } : {}),
        ms: Date.now() - orgStart,
      })
    } catch (e: any) {
      const msg = e?.message || String(e)
      console.error('[org-snapshot] org ' + (org as any).id + ' failed:', msg)
      results.push({
        org_id: (org as any).id,
        org_name: (org as any).name,
        error: msg,
        ms: Date.now() - orgStart,
      })
    }
  }

  const successCount = results.filter(r => !r.error).length
  const failedCount = results.length - successCount
  const totalBytes = results.reduce((s, r) => s + (r.size_bytes || 0), 0)

  // Fail the run (non-2xx) if any org's backup failed or was incomplete, so the
  // Vercel cron surfaces red instead of a silent "ok" over a bad backup.
  return NextResponse.json({
    ok: failedCount === 0,
    orgs_total: results.length,
    orgs_succeeded: successCount,
    orgs_failed: failedCount,
    total_bytes_uploaded: totalBytes,
    elapsed_ms: Date.now() - started,
    results,
  }, { status: failedCount === 0 ? 200 : 500 })
}
