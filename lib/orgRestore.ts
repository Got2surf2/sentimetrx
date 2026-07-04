// lib/orgRestore.ts
//
// Restore an org snapshot into ANY Supabase project — shared by the admin
// same-environment restore route and the cross-environment clone
// (prod snapshot → TEST project). The `db` parameter decides the target.
//
// Snapshot v2 (2026-07-04): the core is STREAMING — it consumes a
// SnapshotSource (lib/orgSnapshotV2.openSnapshot) in ≤500-row batches, so
// an uncapped snapshot restores in constant memory on serverless. The
// original in-memory entry point remains as a thin wrapper for laptop
// callers that materialize first (clone identity-remap needs whole tables).
//
// Semantics (unchanged from v1):
//   mode='merge' (default): chunked upsert by `id`; rows not in the
//     snapshot are left alone.
//   mode='replace': additionally deletes current rows (matched via org_id)
//     whose id is not in the snapshot. Destructive; opt-in.
//   tables: optional allowlist.
//
// Tables that can't upsert by `id` (identity ids, composite PKs) restore
// replace-per-parent via REPLACE_PER_PARENT below; an id-less table NOT
// registered there is reported and skipped rather than guessed at.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrgSnapshot } from '@/lib/orgSnapshot'
import { snapshotSourceFromV1, type SnapshotSource } from '@/lib/orgSnapshotV2'

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

// Tables that can't upsert by `id`, restored as INSERTs after clearing the
// target's existing rows for the same parents — replace-per-parent:
//   - stripId: `id` is GENERATED ALWAYS AS IDENTITY, so Postgres rejects
//     any explicit id value (discovered live 2026-07-03: the original
//     upsert-by-id path could never restore dataset_rows_flat anywhere).
//   - no id at all: composite-PK config tables (org_features PK is
//     (org_id, feature), etc.) — previously reported-and-skipped, i.e.
//     backed up but silently unrestorable (caught live 2026-07-04).
const REPLACE_PER_PARENT: Record<string, { parentKey: string; stripId?: boolean }> = {
  dataset_rows_flat: { parentKey: 'dataset_id', stripId: true },
  archived_dataset_rows_flat: { parentKey: 'dataset_id', stripId: true },
  org_features: { parentKey: 'org_id' },
  user_features: { parentKey: 'user_id' },
  user_favorites: { parentKey: 'user_id' },
}

const CHUNK = 500

export async function restoreOrgSnapshotFromSource(
  db: SupabaseClient,
  source: SnapshotSource,
  opts: { mode?: 'merge' | 'replace'; tables?: string[] | null } = {},
): Promise<RestoreResult> {
  const mode = opts.mode === 'replace' ? 'replace' : 'merge'
  const tableAllow = opts.tables && opts.tables.length > 0 ? opts.tables : null
  const orgId = source.orgId
  const reports: TableReport[] = []

  for (const tableName of source.tableNames) {
    if (tableAllow && !tableAllow.includes(tableName)) continue
    if (source.rowCount(tableName) === 0) continue

    const report: TableReport = { table: tableName, attempted: 0, upserted: 0, deleted: 0, errors: 0 }
    const identity = REPLACE_PER_PARENT[tableName]

    // Identity-id tables: replace-per-parent. The dump writes rows grouped
    // by parent, but correctness doesn't depend on it — the target's rows
    // for a parent are deleted exactly once, on the parent's FIRST
    // appearance in the stream, before any insert for that parent.
    const clearedParents = new Set<unknown>()
    // Replace mode: collect streamed ids so post-pass deletion can remove
    // live rows absent from the snapshot (ids only — small).
    const seenIds = mode === 'replace' ? new Set<unknown>() : null
    let sawMissingId = false

    for await (const batch of source.readTable(tableName)) {
      report.attempted += batch.length

      if (identity) {
        const newParents = Array.from(new Set(batch.map(r => r[identity.parentKey]).filter(Boolean)))
          .filter(p => !clearedParents.has(p))
        for (let i = 0; i < newParents.length; i += CHUNK) {
          const { error } = await db.from(tableName).delete().in(identity.parentKey, newParents.slice(i, i + CHUNK))
          if (error && !report.first_error) report.first_error = 'pre-delete: ' + error.message
        }
        newParents.forEach(p => clearedParents.add(p))
        const slice = identity.stripId ? batch.map(({ id: _id, ...rest }) => rest) : batch
        const { error } = await db.from(tableName).insert(slice)
        if (error) {
          report.errors += slice.length
          if (!report.first_error) report.first_error = error.message
        } else {
          report.upserted += slice.length
        }
        continue
      }

      if (batch.some(r => !r || typeof r !== 'object' || !('id' in r))) {
        sawMissingId = true
        report.errors += batch.length
        if (!report.first_error) report.first_error = 'Rows missing id column — skipped (table has composite PK)'
        continue
      }
      if (seenIds) batch.forEach(r => seenIds.add(r.id))

      // Upsert in chunks of 500 to stay under PostgREST limits.
      const { error, data } = await db.from(tableName).upsert(batch, { onConflict: 'id' }).select('id')
      if (error) {
        report.errors += batch.length
        if (!report.first_error) report.first_error = error.message
      } else {
        report.upserted += (data?.length || batch.length)
      }
    }

    // Replace mode: delete rows currently present in the org that are NOT
    // in the snapshot. Only acts on tables org-scoped via `org_id`
    // (parent-via tables are skipped to avoid scope ambiguity).
    if (mode === 'replace' && !identity && !sawMissingId && seenIds) {
      const { data: current } = await db.from(tableName).select('id, org_id').eq('org_id', orgId)
      if (current) {
        const toDelete = current.filter((r: { id: unknown }) => !seenIds.has(r.id)).map((r: { id: unknown }) => r.id)
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

// Backward-compatible in-memory entry point (v1 shape) — the clone script
// materializes a snapshot, rewrites identities/stubs, then restores here.
export async function restoreOrgSnapshot(
  db: SupabaseClient,
  snapshot: OrgSnapshot,
  opts: { mode?: 'merge' | 'replace'; tables?: string[] | null } = {},
): Promise<RestoreResult> {
  return restoreOrgSnapshotFromSource(db, snapshotSourceFromV1(snapshot), opts)
}
