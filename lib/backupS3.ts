// lib/backupS3.ts
// S3 wrapper for per-tenant backup uploads. Used by the nightly snapshot
// cron + the admin restore flow.
//
// Env required:
//   BACKUP_S3_BUCKET            — bucket name (e.g. "sentimetrx-backups")
//   BACKUP_S3_REGION            — region (e.g. "us-east-1")
//   BACKUP_AWS_ACCESS_KEY_ID
//   BACKUP_AWS_SECRET_ACCESS_KEY
//   BACKUP_S3_KMS_KEY_ID        — optional; if set, uses SSE-KMS
//
// Storage layout:
//   s3://<bucket>/org-snapshots/<org_id>/<YYYY>/<MM>/<DD>/snapshot.json.gz
// Versioning is enabled on the bucket (configured via AWS console / IaC)
// so overwrites within the same day keep prior copies retrievable.

import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { gzipSync, gunzipSync } from 'zlib'

let _client: S3Client | null = null

function getClient(): S3Client {
  if (_client) return _client
  const region = process.env.BACKUP_S3_REGION
  const accessKeyId = process.env.BACKUP_AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.BACKUP_AWS_SECRET_ACCESS_KEY
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error('BACKUP_S3_REGION / BACKUP_AWS_ACCESS_KEY_ID / BACKUP_AWS_SECRET_ACCESS_KEY missing')
  }
  _client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
  return _client
}

function getBucket(): string {
  const bucket = process.env.BACKUP_S3_BUCKET
  if (!bucket) throw new Error('BACKUP_S3_BUCKET env var missing')
  return bucket
}

export function orgSnapshotKey(orgId: string, date: Date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return 'org-snapshots/' + orgId + '/' + y + '/' + m + '/' + d + '/snapshot.json.gz'
}

export async function uploadOrgSnapshot(orgId: string, payload: unknown): Promise<{ key: string; size_bytes: number }> {
  const client = getClient()
  const bucket = getBucket()
  const key = orgSnapshotKey(orgId)
  const json = JSON.stringify(payload)
  const compressed = gzipSync(Buffer.from(json, 'utf-8'))

  const kmsKey = process.env.BACKUP_S3_KMS_KEY_ID
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: compressed,
    ContentType: 'application/json',
    ContentEncoding: 'gzip',
    ...(kmsKey
      ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: kmsKey }
      : { ServerSideEncryption: 'AES256' }),
    Metadata: { org_id: orgId, snapshot_version: '1' },
  }))

  return { key, size_bytes: compressed.length }
}

export interface SnapshotListItem {
  key: string
  last_modified: string
  size_bytes: number
}

export async function listOrgSnapshots(orgId: string, maxKeys = 100): Promise<SnapshotListItem[]> {
  const client = getClient()
  const bucket = getBucket()
  const prefix = 'org-snapshots/' + orgId + '/'
  const out = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: maxKeys }))
  return (out.Contents || []).map(o => ({
    key: o.Key || '',
    last_modified: o.LastModified ? o.LastModified.toISOString() : '',
    size_bytes: o.Size || 0,
  })).sort((a, b) => (a.last_modified < b.last_modified ? 1 : -1))
}

export async function downloadOrgSnapshot(key: string): Promise<unknown> {
  const client = getClient()
  const bucket = getBucket()
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!out.Body) throw new Error('Empty S3 response body for ' + key)
  const stream = out.Body as any
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const compressed = Buffer.concat(chunks)
  const json = gunzipSync(compressed).toString('utf-8')
  return JSON.parse(json)
}
