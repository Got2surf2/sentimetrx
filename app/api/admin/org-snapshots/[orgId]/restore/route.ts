// app/api/admin/org-snapshots/[orgId]/restore/route.ts
// POST — restore an org from a given snapshot S3 key.
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
import { downloadOrgSnapshot } from '@/lib/backupS3'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { recordAdminAction } from '@/lib/orgTransfer'
import type { OrgSnapshot } from '@/lib/orgSnapshot'
import { restoreOrgSnapshot } from '@/lib/orgRestore'
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

  let snapshot: OrgSnapshot
  try {
    snapshot = await downloadOrgSnapshot(key) as OrgSnapshot
  } catch (e: any) {
    return serverError(e, 'admin.orgSnapshots.restore.download', { orgId: params.orgId })
  }

  if (!snapshot?.meta || snapshot.meta.snapshot_version !== 1) {
    return NextResponse.json({ error: 'Unsupported snapshot_version' }, { status: 400 })
  }
  if (snapshot.meta.org_id !== params.orgId) {
    return NextResponse.json({ error: 'Snapshot org_id does not match URL org_id (refusing — possible key swap)' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Shared restore core (lib/orgRestore) — same implementation the
  // cross-environment clone script uses; this route targets the SAME
  // environment's database.
  const { reports, totals } = await restoreOrgSnapshot(service as any, snapshot, { mode, tables: tableAllow })

  // Audit: restoring a snapshot overwrites (merge) or replaces a tenant's live
  // data — the most destructive admin op there is. Always traced.
  const supabase = await createClient()
  const actor = await getAuthUser(supabase)
  await recordAdminAction({
    service, actionType: 'org.snapshot_restore', resourceType: 'org', resourceId: params.orgId,
    targetOrgId: params.orgId, initiatedBy: actor?.id || null, initiatedByEmail: actor?.email || null,
    metadata: { key, mode, snapshot_taken_at: snapshot.meta.taken_at, tables_restored: reports.length, ...totals },
  })

  return NextResponse.json({
    ok: true,
    org_id: params.orgId,
    snapshot_taken_at: snapshot.meta.taken_at,
    mode,
    tables_restored: reports.length,
    reports,
  })
}
