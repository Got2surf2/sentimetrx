// lib/orgSnapshotV2.ts
// Snapshot v2: streamed, UNCAPPED per-org backups (docs/BACKUPS.md).
//
// v1 built one {meta, tables} JSON document in memory — which forced row
// caps in a serverless function and would truncate a real client tenant.
// v2 streams each table through gzip into its own NDJSON object:
//
//   org-snapshots/<org_id>/<YYYY>/<MM>/<DD>/v2/tables/<table>.ndjson.gz
//   org-snapshots/<org_id>/<YYYY>/<MM>/<DD>/v2/manifest.json      (written LAST)
//
// The manifest is the commit marker: it is uploaded only after every table
// part landed, so a manifest's presence means the snapshot is complete
// (readers never see a half-written snapshot). Memory profile is one
// 1000-row page + gzip buffers, regardless of table size.
//
// openSnapshot() reads BOTH formats behind one streaming interface —
// existing v1 S3 objects restore forever — and materializeSnapshot()
// rebuilds the in-memory v1 shape for laptop workflows (the clone script's
// identity-remap/stub logic wants whole tables).

import type { SupabaseClient } from '@supabase/supabase-js'
import { createGzip, createGunzip, gunzipSync } from 'node:zlib'
import { once } from 'node:events'
import type { SnapshotStore } from './snapshotStore'
import { TABLE_SPECS, iterateTablePages, type OrgSnapshot, type TableCursor } from './orgSnapshot'

export interface SnapshotV2Part {
  key: string
  rows: number
  bytes: number
}

export interface SnapshotV2TableEntry {
  name: string
  key: string
  rows: number
  bytes: number
  // Present when the table was dumped across >1 cron hop (deadline bail
  // mid-table): each part is an independent gzipped NDJSON object; readers
  // stream them in order. Absent = single object at `key` (the common case
  // and every pre-2026-07 snapshot).
  parts?: SnapshotV2Part[]
}

export interface OrgSnapshotV2Meta {
  snapshot_version: 2
  org_id: string
  org_name: string | null
  taken_at: string
  table_row_counts: Record<string, number>
  // NON-EMPTY = the snapshot is INCOMPLETE (a table failed mid-read and its
  // part holds only the rows fetched before the error). The cron fails loud.
  fetch_errors: Record<string, string>
  tables: SnapshotV2TableEntry[]
  total_bytes: number
}

// One row → one physical line. JSON.stringify legally leaves U+2028/U+2029
// LINE SEPARATOR characters raw inside strings — and real tenant data has
// them (iPhone-pasted review text; caught live 2026-07-04 when Node's
// readline split a row on U+2028). Escape them so a line never contains
// any Unicode line terminator.
function ndjsonLine(row: unknown): string {
  return JSON.stringify(row).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

export function snapshotV2Prefix(orgId: string, date: Date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return 'org-snapshots/' + orgId + '/' + y + '/' + m + '/' + d + '/v2/'
}

export const V2_MANIFEST_SUFFIX = 'v2/manifest.json'
export const V2_CHECKPOINT_SUFFIX = 'v2/partial.json'

// ---------------------------------------------------------------------------
// Dump

// Durable intra-org resume state, written to `<prefix>partial.json` when a
// deadline bail interrupts the dump. Never surfaced by listings (only the
// manifest is a commit marker) and overwritten by each same-day re-run.
export interface SnapshotV2Checkpoint {
  checkpoint_version: 1
  org_id: string
  org_name: string | null
  taken_at: string // first hop's start — the manifest keeps it
  tables: SnapshotV2TableEntry[] // completed tables, TABLE_SPECS order
  fetch_errors: Record<string, string>
  resume: {
    table: string
    next_part: number // 1-based; part 1 is the un-suffixed key
    parts: SnapshotV2Part[] // completed parts of the in-progress table
    cursor: TableCursor
  } | null
}

export async function loadSnapshotCheckpoint(store: SnapshotStore, prefix: string): Promise<SnapshotV2Checkpoint | null> {
  try {
    const cp = JSON.parse((await store.get(prefix + 'partial.json')).toString('utf-8')) as SnapshotV2Checkpoint
    return cp?.checkpoint_version === 1 ? cp : null
  } catch {
    return null // missing or unparsable → start the org from scratch
  }
}

// Ordinal that strictly increases whenever a resumable dump advances (a
// table or a part completed). The cron uses it to refuse a continuation
// chain that spins without progress.
export function checkpointProgress(cp: SnapshotV2Checkpoint | null): number {
  if (!cp) return -1
  return cp.tables.length * 1_000_000 + (cp.resume ? cp.resume.next_part : 0)
}

export type ResumableDumpResult =
  | { done: true; manifestKey: string; meta: OrgSnapshotV2Meta }
  | { done: false; checkpoint: SnapshotV2Checkpoint }

function partKey(prefix: string, table: string, partNo: number): string {
  return prefix + 'tables/' + table + (partNo === 1 ? '' : '.part' + partNo) + '.ndjson.gz'
}

// Deadline-aware, checkpoint-resumable dump. Without `deadlineAt` it
// behaves exactly like the original single-shot dump (always done:true).
// With a deadline, it bails at a page boundary once the clock passes it:
// the in-flight gzip part is closed and uploaded (each part is a complete,
// independently-readable object), a checkpoint lands at
// `<prefix>partial.json`, and the caller re-invokes with that checkpoint
// next hop. Guarantees ≥1 page of progress per invocation, so every hop
// advances the checkpoint. The manifest still lands LAST, only when every
// table is complete — a mid-chain snapshot stays invisible to listings.
export async function dumpOrgSnapshotV2Resumable(
  db: SupabaseClient,
  orgId: string,
  store: SnapshotStore,
  opts: { prefix?: string; deadlineAt?: number; checkpoint?: SnapshotV2Checkpoint | null } = {},
): Promise<ResumableDumpResult> {
  const prefix = opts.prefix ?? snapshotV2Prefix(orgId)
  const deadlineAt = opts.deadlineAt ?? Infinity
  const cp = opts.checkpoint && opts.checkpoint.org_id === orgId ? opts.checkpoint : null

  const { data: org, error: orgErr } = await db.from('organizations').select('id, name').eq('id', orgId).single()
  if (orgErr || !org) throw new Error('Org not found for snapshot: ' + orgId + (orgErr ? ' (' + orgErr.message + ')' : ''))

  const doneTables: SnapshotV2TableEntry[] = cp ? [...cp.tables] : []
  const doneNames = new Set(doneTables.map(t => t.name))
  const fetchErrors: Record<string, string> = cp ? { ...cp.fetch_errors } : {}
  const takenAt = cp?.taken_at ?? new Date().toISOString()
  let resume = cp?.resume ?? null

  const writeCheckpoint = async (r: SnapshotV2Checkpoint['resume']): Promise<SnapshotV2Checkpoint> => {
    const checkpoint: SnapshotV2Checkpoint = {
      checkpoint_version: 1,
      org_id: orgId,
      org_name: (org as { name?: string | null }).name ?? null,
      taken_at: takenAt,
      tables: doneTables,
      fetch_errors: fetchErrors,
      resume: r,
    }
    await store.put(prefix + 'partial.json', Buffer.from(JSON.stringify(checkpoint), 'utf-8'))
    return checkpoint
  }

  let progressed = false // ≥1 part/table completed THIS invocation
  for (const spec of TABLE_SPECS) {
    if (spec.filter.kind === 'skip') continue
    if (doneNames.has(spec.name)) continue

    // Between-table bail — only after this invocation did some work, so a
    // continuation hop always advances the checkpoint.
    if (progressed && Date.now() > deadlineAt) {
      // `resume` still holds any not-yet-consumed in-progress state (its
      // table may sit later in the registry after a mid-chain deploy).
      return { done: false, checkpoint: await writeCheckpoint(resume) }
    }

    // A checkpoint's in-progress state applies only to its own table (the
    // registry can gain/lose tables across a deploy mid-chain).
    const tableResume = resume && resume.table === spec.name ? resume : null
    const parts: SnapshotV2Part[] = tableResume ? [...tableResume.parts] : []
    let partNo = tableResume ? tableResume.next_part : 1
    let cursor: TableCursor | null = tableResume ? tableResume.cursor : null
    let fetchError: string | undefined

    for (;;) {
      const key = partKey(prefix, spec.name, partNo)
      const gzip = createGzip()
      // Capture an upload failure instead of letting it reject unhandled —
      // and race it against gzip 'drain' so a dead upload can't leave the
      // write loop waiting on backpressure that will never release.
      let uploadErr: unknown = null
      const uploadDone = store.putStream(key, gzip).catch((e: unknown) => { uploadErr = e; return { size_bytes: 0 } })
      let partRows = 0
      let bailed = false
      try {
        for await (const page of iterateTablePages(db, orgId, spec, cursor)) {
          if (uploadErr) break
          if (page.error) { fetchError = page.error }
          if (page.rows.length > 0) {
            const lines = page.rows.map(r => ndjsonLine(r)).join('\n') + '\n'
            partRows += page.rows.length
            if (!gzip.write(lines)) await Promise.race([once(gzip, 'drain'), uploadDone])
          }
          cursor = page.cursor
          // Bail mid-table only with a resumable cursor and ≥1 page consumed
          // (the page just written IS the progress guarantee).
          if (cursor && Date.now() > deadlineAt) { bailed = true; break }
        }
      } finally {
        gzip.end()
      }
      const { size_bytes } = await uploadDone
      if (uploadErr) throw uploadErr instanceof Error ? uploadErr : new Error(String(uploadErr))

      // An extra part that caught zero rows (resume landed exactly at the
      // table's end) is dead weight — drop it from the accounting.
      if (partRows > 0 || partNo === 1) parts.push({ key, rows: partRows, bytes: size_bytes })
      progressed = true

      if (!bailed) break
      return {
        done: false,
        checkpoint: await writeCheckpoint({ table: spec.name, next_part: partNo + 1, parts, cursor: cursor as TableCursor }),
      }
    }

    const rows = parts.reduce((s, p) => s + p.rows, 0)
    const bytes = parts.reduce((s, p) => s + p.bytes, 0)
    doneTables.push({ name: spec.name, key: parts[0].key, rows, bytes, ...(parts.length > 1 ? { parts } : {}) })
    doneNames.add(spec.name)
    if (fetchError) fetchErrors[spec.name] = fetchError
    if (tableResume) resume = null
  }

  const meta: OrgSnapshotV2Meta = {
    snapshot_version: 2,
    org_id: orgId,
    org_name: (org as { name?: string | null }).name ?? null,
    taken_at: takenAt,
    table_row_counts: Object.fromEntries(doneTables.map(t => [t.name, t.rows])),
    fetch_errors: fetchErrors,
    tables: doneTables,
    total_bytes: doneTables.reduce((s, t) => s + t.bytes, 0),
  }

  // Manifest LAST — the commit marker.
  const manifestKey = prefix + 'manifest.json'
  const manifestBody = Buffer.from(JSON.stringify(meta, null, 2), 'utf-8')
  const { size_bytes: manifestBytes } = await store.put(manifestKey, manifestBody)
  meta.total_bytes += manifestBytes

  return { done: true, manifestKey, meta }
}

// Single-shot dump — the admin "Snapshot now" route and laptop scripts.
// No deadline → the resumable core always runs to the manifest.
export async function dumpOrgSnapshotV2(
  db: SupabaseClient,
  orgId: string,
  store: SnapshotStore,
  opts: { prefix?: string } = {},
): Promise<{ manifestKey: string; meta: OrgSnapshotV2Meta }> {
  const res = await dumpOrgSnapshotV2Resumable(db, orgId, store, { prefix: opts.prefix })
  if (!res.done) throw new Error('unreachable: dump without a deadline cannot bail')
  return { manifestKey: res.manifestKey, meta: res.meta }
}

// ---------------------------------------------------------------------------
// Read (both formats)

export interface SnapshotSource {
  version: 1 | 2
  orgId: string
  orgName: string | null
  takenAt: string
  tableNames: string[]
  rowCount(table: string): number
  fetchErrors: Record<string, string>
  // Yields ≤500-row batches. A table absent from the snapshot yields nothing.
  readTable(table: string): AsyncGenerator<Record<string, unknown>[]>
}

const BATCH = 500

export function isV2ManifestKey(key: string): boolean {
  return key.endsWith(V2_MANIFEST_SUFFIX)
}

export async function openSnapshot(store: SnapshotStore, key: string): Promise<SnapshotSource> {
  if (isV2ManifestKey(key)) {
    const manifest = JSON.parse((await store.get(key)).toString('utf-8')) as OrgSnapshotV2Meta
    if (manifest.snapshot_version !== 2) throw new Error('Expected snapshot_version 2 in ' + key)
    const byName = new Map(manifest.tables.map(t => [t.name, t]))
    return {
      version: 2,
      orgId: manifest.org_id,
      orgName: manifest.org_name,
      takenAt: manifest.taken_at,
      tableNames: manifest.tables.filter(t => t.rows > 0).map(t => t.name),
      rowCount: (t: string) => byName.get(t)?.rows ?? 0,
      fetchErrors: manifest.fetch_errors || {},
      readTable: (table: string) => readV2Table(store, byName.get(table)),
    }
  }

  // v1: one gzipped JSON document.
  const raw = await store.get(key)
  const snapshot = JSON.parse(gunzipSync(raw).toString('utf-8')) as OrgSnapshot
  if (snapshot?.meta?.snapshot_version !== 1) throw new Error('Unrecognized snapshot format at ' + key)
  return snapshotSourceFromV1(snapshot)
}

// In-memory v1 shape → SnapshotSource (also used by lib/orgRestore's
// backward-compatible wrapper).
export function snapshotSourceFromV1(snapshot: OrgSnapshot): SnapshotSource {
  const tables = snapshot.tables as Record<string, Record<string, unknown>[]>
  return {
    version: 1,
    orgId: snapshot.meta.org_id,
    orgName: snapshot.meta.org_name,
    takenAt: snapshot.meta.taken_at,
    tableNames: Object.keys(tables).filter(t => Array.isArray(tables[t]) && tables[t].length > 0),
    rowCount: (t: string) => (Array.isArray(tables[t]) ? tables[t].length : 0),
    fetchErrors: snapshot.meta.fetch_errors || {},
    readTable: async function* (table: string) {
      const rows = tables[table]
      if (!Array.isArray(rows)) return
      for (let i = 0; i < rows.length; i += BATCH) yield rows.slice(i, i + BATCH)
    },
  }
}

async function* readV2Table(store: SnapshotStore, entry: SnapshotV2TableEntry | undefined): AsyncGenerator<Record<string, unknown>[]> {
  if (!entry || entry.rows === 0) return
  // Multi-part tables (dumped across cron hops) stream part by part in
  // order; the single-key shape covers every pre-multi-part snapshot.
  const keys = entry.parts && entry.parts.length > 0
    ? entry.parts.filter(p => p.rows > 0).map(p => p.key)
    : [entry.key]
  for (const key of keys) {
    const raw = await store.getStream(key)
    const gunzip = raw.pipe(createGunzip())
    // Split on '\n' ONLY — deliberately NOT node:readline, which also breaks
    // lines on U+2028/U+2029 inside JSON strings (real tenant text contains
    // them; caught live 2026-07-04). setEncoding keeps multi-byte UTF-8
    // sequences intact across chunk boundaries.
    gunzip.setEncoding('utf8')
    let buf = ''
    let batch: Record<string, unknown>[] = []
    for await (const chunk of gunzip as AsyncIterable<string>) {
      buf += chunk
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (!line.trim()) continue
        batch.push(JSON.parse(line) as Record<string, unknown>)
        if (batch.length >= BATCH) { yield batch; batch = [] }
      }
    }
    if (buf.trim()) batch.push(JSON.parse(buf) as Record<string, unknown>)
    if (batch.length > 0) yield batch
  }
}

// Rebuild the v1 in-memory shape from any source — laptop-only (the whole
// org lands in RAM; that is exactly what serverless dump/restore avoids).
export async function materializeSnapshot(source: SnapshotSource): Promise<OrgSnapshot> {
  const tables: Record<string, unknown[]> = {}
  const table_row_counts: Record<string, number> = {}
  for (const t of source.tableNames) {
    const rows: unknown[] = []
    for await (const batch of source.readTable(t)) rows.push(...batch)
    tables[t] = rows
    table_row_counts[t] = rows.length
  }
  return {
    meta: {
      snapshot_version: 1,
      org_id: source.orgId,
      org_name: source.orgName,
      taken_at: source.takenAt,
      table_row_counts,
      truncated_tables: [],
      fetch_errors: source.fetchErrors,
    },
    tables,
  }
}
