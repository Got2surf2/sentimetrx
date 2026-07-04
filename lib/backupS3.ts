// lib/backupS3.ts
// S3 catalog for per-tenant backups: store factory + snapshot listing.
// Used by the nightly snapshot cron, the admin backups UI, and
// scripts/clone-org-to-test.ts.
//
// Env required (see docs/BACKUPS.md):
//   BACKUP_S3_BUCKET            — bucket name (e.g. "sentimetrx-backups")
//   BACKUP_S3_REGION            — region (e.g. "us-east-1")
//   BACKUP_AWS_ACCESS_KEY_ID
//   BACKUP_AWS_SECRET_ACCESS_KEY
//   BACKUP_S3_KMS_KEY_ID        — optional; if set, uses SSE-KMS
//
// Storage layout (bucket versioning keeps same-day overwrites retrievable):
//   v1 (legacy, read-only): org-snapshots/<org_id>/<Y>/<M>/<D>/snapshot.json.gz
//   v2 (current):           org-snapshots/<org_id>/<Y>/<M>/<D>/v2/tables/<table>.ndjson.gz
//                           org-snapshots/<org_id>/<Y>/<M>/<D>/v2/manifest.json
//
// A v2 snapshot appears in listings as ONE item keyed by its manifest
// (the commit marker — written last), with size aggregated across its
// table parts. v2 days without a manifest are incomplete and hidden.

import { S3SnapshotStore } from './snapshotStore'

let _store: S3SnapshotStore | null = null

export function s3SnapshotStore(): S3SnapshotStore {
  if (!_store) _store = new S3SnapshotStore()
  return _store
}

export interface SnapshotListItem {
  key: string
  last_modified: string
  size_bytes: number
  snapshot_version: 1 | 2
}

// Pure grouping — exported for tests.
export function groupSnapshotObjects(objects: { key: string; last_modified: string; size_bytes: number }[]): SnapshotListItem[] {
  const items: SnapshotListItem[] = []
  // v2: group all objects under each .../v2/ prefix; emit only if the
  // manifest exists.
  const v2Groups = new Map<string, { manifest?: { key: string; last_modified: string }; bytes: number }>()

  for (const o of objects) {
    const v2Idx = o.key.indexOf('/v2/')
    if (v2Idx >= 0) {
      const groupPrefix = o.key.slice(0, v2Idx + 4)
      const g = v2Groups.get(groupPrefix) || { bytes: 0 }
      g.bytes += o.size_bytes
      if (o.key.endsWith('/v2/manifest.json')) g.manifest = { key: o.key, last_modified: o.last_modified }
      v2Groups.set(groupPrefix, g)
      continue
    }
    if (o.key.endsWith('snapshot.json.gz')) {
      items.push({ key: o.key, last_modified: o.last_modified, size_bytes: o.size_bytes, snapshot_version: 1 })
    }
  }
  for (const g of v2Groups.values()) {
    if (!g.manifest) continue // incomplete — dump died before the commit marker
    items.push({ key: g.manifest.key, last_modified: g.manifest.last_modified, size_bytes: g.bytes, snapshot_version: 2 })
  }

  return items.sort((a, b) => (a.last_modified < b.last_modified ? 1 : -1))
}

export async function listOrgSnapshots(orgId: string, max = 100): Promise<SnapshotListItem[]> {
  const prefix = 'org-snapshots/' + orgId + '/'
  const objects = await s3SnapshotStore().list(prefix)
  return groupSnapshotObjects(objects).slice(0, max)
}
