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
// Restore-fidelity rework (2026-07-04, after the first full DR drill
// surfaced three bug classes):
//   1. FK ORDERING — tables restore in TABLE_SPECS dependency order (not
//      manifest order, which fossilizes the ordering bugs of the code that
//      wrote it), and tables with FK-blocked rows re-run after the rest
//      have landed. datasets ↔ collections is genuinely CIRCULAR
//      (datasets.brand_collection_id vs collections.dataset_id), so no
//      static order alone can be sufficient — the retry rounds are load-
//      bearing, not defensive.
//   2. REFERENTIAL DEBT — a row whose parent exists nowhere in the target
//      (org-transfer leftovers pointing at other orgs'/deleted rows) is
//      skipped and counted as `skipped_fk` instead of poisoning its whole
//      batch: PostgREST writes are all-or-nothing, so one debt row used to
//      sink up to 499 good rows with it. Failing batches bisect down to
//      the individual offenders.
//   3. SILENT LOSS — the restore verifies itself: after all writes it
//      re-queries the target for the rows it claims to have landed and
//      reports any shortfall as `missing`. It must never report success
//      for dropped rows, whatever the mechanism (cascade deletes, partial
//      writes, under-delivering streams — the last two are also counted
//      inline as errors now, as are pre-delete failures).
//
// Semantics (unchanged from v1):
//   mode='merge' (default): chunked upsert by `id`; rows not in the
//     snapshot are left alone.
//   mode='replace': additionally deletes current rows (matched via org_id)
//     whose id is not in the snapshot. Destructive; opt-in.
//   tables: optional allowlist.
//   verify: post-write verification pass (default ON; opt out with false).
//
// Tables that can't upsert by `id` (identity ids, composite PKs) restore
// replace-per-parent via REPLACE_PER_PARENT below; an id-less table NOT
// registered there is reported and skipped rather than guessed at.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrgSnapshot } from '@/lib/orgSnapshot'
import { TABLE_SPECS } from '@/lib/orgSnapshot'
import { snapshotSourceFromV1, type SnapshotSource } from '@/lib/orgSnapshotV2'

export interface TableReport {
  table: string
  attempted: number
  upserted: number
  deleted: number
  errors: number
  // Referential debt: rows skipped because a referenced parent exists
  // nowhere in the target even after the retry rounds. Reported, not fatal.
  skipped_fk: number
  // Rows skipped on a non-id unique collision (e.g. collections'
  // (org_id, slug) WHERE kind='brand' partial index when re-restoring over
  // an existing org whose brand collection has a different id).
  skipped_conflict: number
  // Post-write verification: rows this restore claimed to land that were
  // NOT found in the target afterwards. Non-zero missing = restore FAILED.
  missing: number
  first_error?: string
}

export interface RestoreResult {
  reports: TableReport[]
  totals: {
    upserted: number
    deleted: number
    errors: number
    skipped_fk: number
    skipped_conflict: number
    missing: number
  }
  // errors === 0 && missing === 0. Skips are surfaced but not fatal —
  // referential debt is a property of the source data, not of the restore.
  ok: boolean
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

// Columns a DB trigger reacts to, restored in a DEFERRED second pass.
// datasets.brand_tag fires set_brand_collection_id (migration 062): on a
// restore, datasets insert BEFORE collections (FK direction), so the
// trigger's find-or-create would mint a PHANTOM brand collection (new id)
// per brand — which then 23505-blocks the snapshot's real collections row
// and FK-blocks its collection_members (the 2026-07-04 drill's
// "collections 12/17" anomaly). Phase 1 inserts rows with these columns
// nulled (no trigger effect); after every table has landed, the retained
// full rows re-upsert, so the trigger's find-or-create takes its fast path
// to the SNAPSHOT's collection. The AFTER trigger
// (sync_brand_collection_members) also inserts a membership row on that
// transition — a duplicate of the snapshot's own (no unique pair
// constraint), so dedupChildPairs removes the non-snapshot twin.
const DEFERRED_COLUMNS: Record<string, {
  columns: string[]
  dedupChildPairs?: { table: string; parentCol: string; otherCol: string }
}> = {
  datasets: {
    columns: ['brand_tag', 'brand_collection_id'],
    dedupChildPairs: { table: 'collection_members', parentCol: 'dataset_id', otherCol: 'collection_id' },
  },
}

const CHUNK = 500
const FK_VIOLATION = '23503'
const UNIQUE_VIOLATION = '23505'

// Restore in registry order — "parents before children" is a property of
// TABLE_SPECS, and sorting here (rather than trusting source.tableNames)
// means a manifest written by older code with a mis-ordered registry still
// restores correctly today. Unknown tables sort last, original order kept.
const RESTORE_RANK = new Map<string, number>(TABLE_SPECS.map((s, i) => [s.name, i]))
function orderForRestore(names: string[]): string[] {
  return [...names].sort(
    (a, b) => (RESTORE_RANK.get(a) ?? Number.MAX_SAFE_INTEGER) - (RESTORE_RANK.get(b) ?? Number.MAX_SAFE_INTEGER),
  )
}

interface TableRun {
  report: TableReport
  // What this run claims to have landed, for verification:
  claimIds: Set<unknown> | null // plain tables: upserted ids
  claimParents: Map<unknown, number> | null // identity tables: rows per parent
  identity: { parentKey: string; stripId?: boolean } | undefined
  // Full original rows whose DEFERRED_COLUMNS were nulled in phase 1 —
  // re-upserted after all tables land.
  deferredRows: Record<string, unknown>[]
}

function freshReport(table: string): TableReport {
  return { table, attempted: 0, upserted: 0, deleted: 0, errors: 0, skipped_fk: 0, skipped_conflict: 0, missing: 0 }
}

// Write a batch, classifying failures. PostgREST writes are all-or-nothing,
// so a failing batch with a referential/unique code bisects until the
// individual offending rows are isolated — good rows land, debt rows are
// counted as skips (FK skips may still land in a retry round).
async function writeRows(
  db: SupabaseClient,
  run: TableRun,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return
  const table = run.report.table
  const res = run.identity
    ? await db.from(table).insert(rows).select(run.identity.parentKey)
    : await db.from(table).upsert(rows, { onConflict: 'id' }).select('id')

  if (!res.error) {
    const returned = res.data?.length ?? rows.length
    run.report.upserted += returned
    if (returned < rows.length) {
      // Should be impossible (all-or-nothing), but if the server confirms
      // fewer rows than we sent, the difference is NOT a success.
      run.report.errors += rows.length - returned
      if (!run.report.first_error) run.report.first_error = `partial write: server returned ${returned}/${rows.length} rows`
    }
    if (run.identity && run.claimParents) {
      for (const r of rows) {
        const p = r[run.identity.parentKey]
        run.claimParents.set(p, (run.claimParents.get(p) ?? 0) + 1)
      }
    } else if (run.claimIds) {
      for (const r of rows) run.claimIds.add(r.id)
    }
    return
  }

  const code = (res.error as { code?: string }).code
  if ((code === FK_VIOLATION || code === UNIQUE_VIOLATION) && rows.length > 1) {
    const mid = Math.ceil(rows.length / 2)
    await writeRows(db, run, rows.slice(0, mid))
    await writeRows(db, run, rows.slice(mid))
    return
  }
  if (code === FK_VIOLATION) run.report.skipped_fk += rows.length
  else if (code === UNIQUE_VIOLATION) run.report.skipped_conflict += rows.length
  else run.report.errors += rows.length
  if (!run.report.first_error) run.report.first_error = res.error.message
}

async function restoreTableOnce(
  db: SupabaseClient,
  source: SnapshotSource,
  tableName: string,
  mode: 'merge' | 'replace',
): Promise<TableRun> {
  const identity = REPLACE_PER_PARENT[tableName]
  const run: TableRun = {
    report: freshReport(tableName),
    claimIds: identity ? null : new Set<unknown>(),
    claimParents: identity ? new Map<unknown, number>() : null,
    identity,
    deferredRows: [],
  }
  const report = run.report
  const deferred = DEFERRED_COLUMNS[tableName]

  // Identity tables: replace-per-parent. The dump writes rows grouped
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
      let clearFailed = false
      for (let i = 0; i < newParents.length; i += CHUNK) {
        const { error } = await db.from(tableName).delete().in(identity.parentKey, newParents.slice(i, i + CHUNK))
        if (error) {
          clearFailed = true
          if (!report.first_error) report.first_error = 'pre-delete: ' + error.message
        }
      }
      if (clearFailed) {
        // Inserting on top of an uncleared parent would duplicate rows —
        // count the batch as failed instead (a later batch may retry the
        // clear, since these parents are not marked cleared).
        report.errors += batch.length
        continue
      }
      newParents.forEach(p => clearedParents.add(p))
      const slice = identity.stripId ? batch.map(({ id: _id, ...rest }) => rest) : batch
      await writeRows(db, run, slice)
      continue
    }

    if (batch.some(r => !r || typeof r !== 'object' || !('id' in r))) {
      sawMissingId = true
      report.errors += batch.length
      if (!report.first_error) report.first_error = 'Rows missing id column — skipped (table has composite PK)'
      continue
    }
    if (seenIds) batch.forEach(r => seenIds.add(r.id))

    // Phase 1 for trigger-sensitive columns: write the row with them
    // nulled, retain the full original for the deferred pass.
    let toWrite = batch
    if (deferred) {
      toWrite = batch.map(r => {
        if (!deferred.columns.some(c => r[c] != null)) return r
        run.deferredRows.push(r)
        const stripped = { ...r }
        for (const c of deferred.columns) stripped[c] = null
        return stripped
      })
    }

    // Upsert in chunks of 500 to stay under PostgREST limits.
    await writeRows(db, run, toWrite)
  }

  // A stream that ends early (truncated part, parse gap) must not read as
  // success — the manifest row count is the contract.
  const expected = source.rowCount(tableName)
  if (report.attempted < expected) {
    report.errors += expected - report.attempted
    if (!report.first_error) report.first_error = `stream under-delivered: ${report.attempted}/${expected} rows`
  }

  // Replace mode: delete rows currently present in the org that are NOT
  // in the snapshot. Only acts on tables org-scoped via `org_id`
  // (parent-via tables are skipped to avoid scope ambiguity).
  if (mode === 'replace' && !identity && !sawMissingId && seenIds) {
    const { data: current } = await db.from(tableName).select('id, org_id').eq('org_id', source.orgId)
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

  return run
}

// Post-write verification: re-query the target for what each table run
// claims to have landed. Any shortfall becomes `missing`. A verify query
// that itself fails counts its rows as missing — unverifiable is not
// success. (Identity tables verify as aggregate per-parent counts, which
// is exact because each parent was cleared before its inserts.)
async function verifyRun(db: SupabaseClient, run: TableRun): Promise<void> {
  const table = run.report.table
  if (run.claimParents && run.claimParents.size > 0) {
    const parents = [...run.claimParents.keys()]
    const expected = [...run.claimParents.values()].reduce((a, b) => a + b, 0)
    let found = 0
    for (let i = 0; i < parents.length; i += 200) {
      const chunk = parents.slice(i, i + 200)
      const { count, error } = await db
        .from(table)
        .select(run.identity!.parentKey, { count: 'exact', head: true })
        .in(run.identity!.parentKey, chunk)
      if (error) {
        if (!run.report.first_error) run.report.first_error = 'verify: ' + error.message
        continue // found stays short for these parents → counted missing
      }
      found += count ?? 0
    }
    run.report.missing = Math.max(0, expected - found)
    return
  }
  if (run.claimIds && run.claimIds.size > 0) {
    const ids = [...run.claimIds]
    let found = 0
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      const { data, error } = await db.from(table).select('id').in('id', chunk)
      if (error) {
        if (!run.report.first_error) run.report.first_error = 'verify: ' + error.message
        continue
      }
      found += data?.length ?? 0
    }
    run.report.missing = Math.max(0, ids.length - found)
  }
}

export async function restoreOrgSnapshotFromSource(
  db: SupabaseClient,
  source: SnapshotSource,
  opts: { mode?: 'merge' | 'replace'; tables?: string[] | null; verify?: boolean } = {},
): Promise<RestoreResult> {
  const mode = opts.mode === 'replace' ? 'replace' : 'merge'
  const tableAllow = opts.tables && opts.tables.length > 0 ? opts.tables : null
  const names = orderForRestore(
    source.tableNames.filter(t => (!tableAllow || tableAllow.includes(t)) && source.rowCount(t) > 0),
  )

  const runs = new Map<string, TableRun>()
  for (const t of names) runs.set(t, await restoreTableOnce(db, source, t, mode))

  // FK retry rounds: rows skipped on referential grounds may have parents
  // NOW (restored by a later table, or the other half of the
  // datasets↔collections circle). Re-running the whole table is safe —
  // upserts are idempotent and identity tables re-clear per parent — and
  // avoids retaining failed rows in memory. Stop when a round makes no
  // progress: what remains is genuine referential debt.
  for (let round = 0; round < 2; round++) {
    const blocked = names.filter(t => runs.get(t)!.report.skipped_fk > 0)
    if (blocked.length === 0) break
    let progress = false
    for (const t of blocked) {
      const rerun = await restoreTableOnce(db, source, t, mode)
      if (rerun.report.skipped_fk < runs.get(t)!.report.skipped_fk) progress = true
      runs.set(t, rerun)
    }
    if (!progress) break
  }

  // Deferred trigger-sensitive columns (see DEFERRED_COLUMNS): re-upsert
  // the retained full rows now that every table has landed — the trigger's
  // find-or-create resolves to the snapshot's rows instead of minting
  // phantoms. Then remove the AFTER-trigger's duplicate child rows.
  for (const t of names) {
    const run = runs.get(t)!
    if (run.deferredRows.length === 0) continue
    for (let i = 0; i < run.deferredRows.length; i += CHUNK) {
      const chunk = run.deferredRows.slice(i, i + CHUNK)
      const { error } = await db.from(t).upsert(chunk, { onConflict: 'id' }).select('id')
      if (error) {
        run.report.errors += chunk.length
        if (!run.report.first_error) run.report.first_error = 'deferred-columns pass: ' + error.message
      }
    }
    const dedup = DEFERRED_COLUMNS[t]?.dedupChildPairs
    if (dedup) {
      const parentIds = run.deferredRows.map(r => r.id)
      const childClaims = runs.get(dedup.table)?.claimIds ?? null
      for (let i = 0; i < parentIds.length; i += 200) {
        const { data } = await db.from(dedup.table).select('id, ' + dedup.parentCol + ', ' + dedup.otherCol)
          .in(dedup.parentCol, parentIds.slice(i, i + 200))
        if (!data) continue
        const byPair = new Map<string, { id: unknown }[]>()
        for (const r of data as unknown as Record<string, unknown>[]) {
          const k = String(r[dedup.otherCol]) + '|' + String(r[dedup.parentCol])
          const arr = byPair.get(k) ?? []
          arr.push(r as { id: unknown })
          byPair.set(k, arr)
        }
        const extras: unknown[] = []
        for (const rows of byPair.values()) {
          if (rows.length < 2) continue
          const keep = rows.find(r => childClaims?.has(r.id)) ?? rows[0]
          for (const r of rows) if (r !== keep) extras.push(r.id)
        }
        if (extras.length > 0) await db.from(dedup.table).delete().in('id', extras)
      }
    }
  }

  if (opts.verify !== false) {
    for (const t of names) await verifyRun(db, runs.get(t)!)
  }

  const reports = names.map(t => runs.get(t)!.report)
  const totals = reports.reduce(
    (acc, r) => ({
      upserted: acc.upserted + r.upserted,
      deleted: acc.deleted + r.deleted,
      errors: acc.errors + r.errors,
      skipped_fk: acc.skipped_fk + r.skipped_fk,
      skipped_conflict: acc.skipped_conflict + r.skipped_conflict,
      missing: acc.missing + r.missing,
    }),
    { upserted: 0, deleted: 0, errors: 0, skipped_fk: 0, skipped_conflict: 0, missing: 0 },
  )
  return { reports, totals, ok: totals.errors === 0 && totals.missing === 0 }
}

// Backward-compatible in-memory entry point (v1 shape) — the clone script
// materializes a snapshot, rewrites identities/stubs, then restores here.
export async function restoreOrgSnapshot(
  db: SupabaseClient,
  snapshot: OrgSnapshot,
  opts: { mode?: 'merge' | 'replace'; tables?: string[] | null; verify?: boolean } = {},
): Promise<RestoreResult> {
  return restoreOrgSnapshotFromSource(db, snapshotSourceFromV1(snapshot), opts)
}
