// app/api/admin/org-snapshots/[orgId]/restore/route.ts
// POST — restore an org from a given snapshot S3 key. Accepts BOTH formats:
// a v1 key (.../snapshot.json.gz, whole-JSON) and a v2 manifest key
// (.../v2/manifest.json) — v2 restores STREAM table parts in ≤500-row
// batches, so an uncapped snapshot restores in constant memory.
//
// Body: { key: string, mode?: 'merge' | 'replace', tables?: string[] }
//   mode='merge' (default): upsert all rows from the snapshot by id; leaves
//     any current rows not present in the snapshot untouched.
//   mode='replace' (destructive): in addition, deletes current rows whose
//     id is not in the snapshot. Opt-in only.
//   tables: optional allowlist — restrict the restore to specific tables.
//     Useful for "just restore the bots, not the dataset rows."
//
// Safety:
//   - admin-org gated (requireAdmin)
//   - snapshot must declare matching org_id in meta (rejects key swap)
//   - all writes use service role; per-row upsert by `id`
//   - returns a per-table report of inserts / updates / deletes / errors

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { s3SnapshotStore } from '@/lib/backupS3'
import { openSnapshot, type SnapshotSource } from '@/lib/orgSnapshotV2'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { recordAdminAction } from '@/lib/orgTransfer'
import { restoreOrgSnapshotFromSource } from '@/lib/orgRestore'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface Params { params: Promise<{ orgId: string }> }

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const key = String(body?.key || '')
  if (!key.startsWith('org-snapshots/')) {
    return NextResponse.json({ error: 'Invalid snapshot key' }, { status: 400 })
  }
  const mode: 'merge' | 'replace' = body?.mode === 'replace' ? 'replace' : 'merge'
  const tableAllow: string[] | null = Array.isArray(body?.tables) && body.tables.length > 0 ? body.tables.map(String) : null

  let source: SnapshotSource
  try {
    source = await openSnapshot(s3SnapshotStore(), key)
  } catch (e: any) {
    return serverError(e, 'admin.orgSnapshots.restore.download', { orgId: params.orgId })
  }

  if (source.orgId !== params.orgId) {
    return NextResponse.json({ error: 'Snapshot org_id does not match URL org_id (refusing — possible key swap)' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Shared restore core (lib/orgRestore) — same implementation the
  // cross-environment clone script uses; this route targets the SAME
  // environment's database. Includes the post-write verification pass:
  // `ok` is false if any row errored OR any claimed row is missing from
  // the target afterwards (never report success for dropped rows).
  const { reports, totals, ok } = await restoreOrgSnapshotFromSource(service as any, source, { mode, tables: tableAllow })

  // Audit: restoring a snapshot overwrites (merge) or replaces a tenant's live
  // data — the most destructive admin op there is. Always traced.
  const supabase = await createClient()
  const actor = await getAuthUser(supabase)
  await recordAdminAction({
    service, actionType: 'org.snapshot_restore', resourceType: 'org', resourceId: params.orgId,
    targetOrgId: params.orgId, initiatedBy: actor?.id || null, initiatedByEmail: actor?.email || null,
    metadata: { key, mode, snapshot_version: source.version, snapshot_taken_at: source.takenAt, tables_restored: reports.length, ...totals },
  })

  return NextResponse.json({
    ok,
    org_id: params.orgId,
    snapshot_taken_at: source.takenAt,
    mode,
    tables_restored: reports.length,
    totals,
    reports,
  })
}
