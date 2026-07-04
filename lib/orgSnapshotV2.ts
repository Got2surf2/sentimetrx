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
import { TABLE_SPECS, iterateTablePages, type OrgSnapshot } from './orgSnapshot'

export interface SnapshotV2TableEntry {
  name: string
  key: string
  rows: number
  bytes: number
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

// ---------------------------------------------------------------------------
// Dump

export async function dumpOrgSnapshotV2(
  db: SupabaseClient,
  orgId: string,
  store: SnapshotStore,
  opts: { prefix?: string } = {},
): Promise<{ manifestKey: string; meta: OrgSnapshotV2Meta }> {
  const prefix = opts.prefix ?? snapshotV2Prefix(orgId)
  const { data: org, error: orgErr } = await db.from('organizations').select('id, name').eq('id', orgId).single()
  if (orgErr || !org) throw new Error('Org not found for snapshot: ' + orgId + (orgErr ? ' (' + orgErr.message + ')' : ''))

  const meta: OrgSnapshotV2Meta = {
    snapshot_version: 2,
    org_id: orgId,
    org_name: (org as { name?: string | null }).name ?? null,
    taken_at: new Date().toISOString(),
    table_row_counts: {},
    fetch_errors: {},
    tables: [],
    total_bytes: 0,
  }

  for (const spec of TABLE_SPECS) {
    if (spec.filter.kind === 'skip') continue
    const key = prefix + 'tables/' + spec.name + '.ndjson.gz'

    const gzip = createGzip()
    // Capture an upload failure instead of letting it reject unhandled —
    // and race it against gzip 'drain' so a dead upload can't leave the
    // write loop waiting on backpressure that will never release.
    let uploadErr: unknown = null
    const uploadDone = store.putStream(key, gzip).catch((e: unknown) => { uploadErr = e; return { size_bytes: 0 } })
    let rows = 0
    let fetchError: string | undefined
    try {
      for await (const page of iterateTablePages(db, orgId, spec)) {
        if (uploadErr) break
        if (page.error) { fetchError = page.error }
        if (page.rows.length === 0) continue
        const lines = page.rows.map(r => ndjsonLine(r)).join('\n') + '\n'
        rows += page.rows.length
        if (!gzip.write(lines)) await Promise.race([once(gzip, 'drain'), uploadDone])
      }
    } finally {
      gzip.end()
    }
    const { size_bytes } = await uploadDone
    if (uploadErr) throw uploadErr instanceof Error ? uploadErr : new Error(String(uploadErr))

    meta.table_row_counts[spec.name] = rows
    meta.total_bytes += size_bytes
    meta.tables.push({ name: spec.name, key, rows, bytes: size_bytes })
    if (fetchError) meta.fetch_errors[spec.name] = fetchError
  }

  // Manifest LAST — the commit marker.
  const manifestKey = prefix + 'manifest.json'
  const manifestBody = Buffer.from(JSON.stringify(meta, null, 2), 'utf-8')
  const { size_bytes: manifestBytes } = await store.put(manifestKey, manifestBody)
  meta.total_bytes += manifestBytes

  return { manifestKey, meta }
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
  const raw = await store.getStream(entry.key)
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
