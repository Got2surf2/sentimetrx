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

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { downloadOrgSnapshot } from '@/lib/backupS3'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { OrgSnapshot } from '@/lib/orgSnapshot'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface Params { params: Promise<{ orgId: string }> }

interface TableReport {
  table: string
  attempted: number
  upserted: number
  deleted: number
  errors: number
  first_error?: string
}

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
    return NextResponse.json({ error: 'Snapshot download failed: ' + (e?.message || String(e)) }, { status: 500 })
  }

  if (!snapshot?.meta || snapshot.meta.snapshot_version !== 1) {
    return NextResponse.json({ error: 'Unsupported snapshot_version' }, { status: 400 })
  }
  if (snapshot.meta.org_id !== params.orgId) {
    return NextResponse.json({ error: 'Snapshot org_id does not match URL org_id (refusing — possible key swap)' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const reports: TableReport[] = []

  // Tables that have a synthetic / hash primary key we know about. For
  // anything else, default to 'id'. The upsert call uses the table's
  // existing primary key to resolve conflicts.
  for (const tableName of Object.keys(snapshot.tables)) {
    if (tableAllow && !tableAllow.includes(tableName)) continue
    const rows = (snapshot.tables as any)[tableName] as any[]
    if (!Array.isArray(rows) || rows.length === 0) continue
    if (rows.some(r => !r || typeof r !== 'object' || !('id' in r))) {
      reports.push({ table: tableName, attempted: rows.length, upserted: 0, deleted: 0, errors: rows.length, first_error: 'Rows missing id column — skipped (table has composite PK)' })
      continue
    }

    const report: TableReport = { table: tableName, attempted: rows.length, upserted: 0, deleted: 0, errors: 0 }

    // Upsert in chunks of 500 to stay under PostgREST limits.
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK)
      const { error, data } = await service.from(tableName).upsert(slice, { onConflict: 'id' }).select('id')
      if (error) {
        report.errors += slice.length
        if (!report.first_error) report.first_error = error.message
      } else {
        report.upserted += (data?.length || slice.length)
      }
    }

    // Replace mode: delete rows currently present in the org that are NOT
    // in the snapshot. Only acts on tables that we KNOW are org-scoped via
    // `org_id` (skipping parent-via tables here to avoid scope ambiguity).
    if (mode === 'replace') {
      const snapshotIds = new Set(rows.map(r => r.id))
      // Best-effort: read current rows where org_id matches, diff IDs.
      // If the table doesn't have org_id, we don't try.
      const { data: current } = await service.from(tableName).select('id, org_id').eq('org_id', params.orgId)
      if (current) {
        const toDelete = current.filter((r: any) => !snapshotIds.has(r.id)).map((r: any) => r.id)
        if (toDelete.length > 0) {
          for (let i = 0; i < toDelete.length; i += CHUNK) {
            const slice = toDelete.slice(i, i + CHUNK)
            const { error } = await service.from(tableName).delete().in('id', slice)
            if (error) {
              if (!report.first_error) report.first_error = 'delete: ' + error.message
              report.errors += slice.length
            } else {
              report.deleted += slice.length
            }
          }
        }
      }
    }

    reports.push(report)
  }

  return NextResponse.json({
    ok: true,
    org_id: params.orgId,
    snapshot_taken_at: snapshot.meta.taken_at,
    mode,
    tables_restored: reports.length,
    reports,
  })
}
