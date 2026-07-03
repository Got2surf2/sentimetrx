// lib/orgRestore.ts
//
// Restore an org snapshot (lib/orgSnapshot.ts shape) into ANY Supabase
// project — extracted from the admin same-environment restore route so the
// cross-environment clone (prod snapshot → TEST project) shares one
// implementation. The `db` parameter decides the target: pass the prod
// service client for a same-env recovery, or a client built from the
// SUPABASE_TEST_* creds for a clone-down.
//
// Semantics (unchanged from the route):
//   mode='merge' (default): chunked upsert by `id`; rows not in the
//     snapshot are left alone.
//   mode='replace': additionally deletes current rows (matched via org_id)
//     whose id is not in the snapshot. Destructive; opt-in.
//   tables: optional allowlist.
//
// Composite-PK tables (rows without an `id` column) are reported and
// skipped, same as before.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrgSnapshot } from '@/lib/orgSnapshot'

export interface TableReport {
  table: string
  attempted: number
  upserted: number
  deleted: number
  errors: number
  first_error?: string
}

export interface RestoreResult {
  reports: TableReport[]
  totals: { upserted: number; deleted: number; errors: number }
}

// Tables whose `id` is GENERATED ALWAYS AS IDENTITY: Postgres rejects any
// explicit id value (even in an upsert), so these restore as strip-id
// INSERTs after clearing the target's existing rows for the same parents —
// replace-per-parent semantics. Discovered live 2026-07-03: the original
// upsert-by-id path could never restore dataset_rows_flat anywhere.
const IDENTITY_TABLES: Record<string, { parentKey: string }> = {
  dataset_rows_flat: { parentKey: 'dataset_id' },
  archived_dataset_rows_flat: { parentKey: 'dataset_id' },
}

export async function restoreOrgSnapshot(
  db: SupabaseClient,
  snapshot: OrgSnapshot,
  opts: { mode?: 'merge' | 'replace'; tables?: string[] | null } = {},
): Promise<RestoreResult> {
  const mode = opts.mode === 'replace' ? 'replace' : 'merge'
  const tableAllow = opts.tables && opts.tables.length > 0 ? opts.tables : null
  const orgId = snapshot.meta.org_id
  const reports: TableReport[] = []
  const CHUNK = 500

  for (const tableName of Object.keys(snapshot.tables)) {
    if (tableAllow && !tableAllow.includes(tableName)) continue
    const rows = (snapshot.tables as Record<string, unknown[]>)[tableName] as Record<string, unknown>[]
    if (!Array.isArray(rows) || rows.length === 0) continue

    // Identity-id tables: replace-per-parent (delete target rows for the
    // parents present in the snapshot, then insert with id stripped).
    const identity = IDENTITY_TABLES[tableName]
    if (identity) {
      const report: TableReport = { table: tableName, attempted: rows.length, upserted: 0, deleted: 0, errors: 0 }
      const parentIds = Array.from(new Set(rows.map(r => r[identity.parentKey]).filter(Boolean)))
      for (let i = 0; i < parentIds.length; i += CHUNK) {
        const { error } = await db.from(tableName).delete().in(identity.parentKey, parentIds.slice(i, i + CHUNK))
        if (error && !report.first_error) report.first_error = 'pre-delete: ' + error.message
      }
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK).map(({ id: _id, ...rest }) => rest)
        const { error } = await db.from(tableName).insert(slice)
        if (error) {
          report.errors += slice.length
          if (!report.first_error) report.first_error = error.message
        } else {
          report.upserted += slice.length
        }
      }
      reports.push(report)
      continue
    }

    if (rows.some(r => !r || typeof r !== 'object' || !('id' in r))) {
      reports.push({ table: tableName, attempted: rows.length, upserted: 0, deleted: 0, errors: rows.length, first_error: 'Rows missing id column — skipped (table has composite PK)' })
      continue
    }

    const report: TableReport = { table: tableName, attempted: rows.length, upserted: 0, deleted: 0, errors: 0 }

    // Upsert in chunks of 500 to stay under PostgREST limits.
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK)
      const { error, data } = await db.from(tableName).upsert(slice, { onConflict: 'id' }).select('id')
      if (error) {
        report.errors += slice.length
        if (!report.first_error) report.first_error = error.message
      } else {
        report.upserted += (data?.length || slice.length)
      }
    }

    // Replace mode: delete rows currently present in the org that are NOT
    // in the snapshot. Only acts on tables org-scoped via `org_id`
    // (parent-via tables are skipped to avoid scope ambiguity).
    if (mode === 'replace') {
      const snapshotIds = new Set(rows.map(r => r.id))
      const { data: current } = await db.from(tableName).select('id, org_id').eq('org_id', orgId)
      if (current) {
        const toDelete = current.filter((r: { id: unknown }) => !snapshotIds.has(r.id)).map((r: { id: unknown }) => r.id)
        for (let i = 0; i < toDelete.length; i += CHUNK) {
          const slice = toDelete.slice(i, i + CHUNK)
          const { error } = await db.from(tableName).delete().in('id', slice)
          if (error) {
            if (!report.first_error) report.first_error = 'delete: ' + error.message
            report.errors += slice.length
          } else {
            report.deleted += slice.length
          }
        }
      }
    }

    reports.push(report)
  }

  const totals = reports.reduce(
    (acc, r) => ({ upserted: acc.upserted + r.upserted, deleted: acc.deleted + r.deleted, errors: acc.errors + r.errors }),
    { upserted: 0, deleted: 0, errors: 0 },
  )
  return { reports, totals }
}
