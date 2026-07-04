// lib/snapshotStore.ts
// Object-store abstraction for org snapshots (docs/BACKUPS.md). Two
// implementations of one tiny interface:
//   - S3SnapshotStore — the real backing store (BACKUP_* env vars); large
//     objects stream through multipart upload so a table of any size moves
//     in constant memory.
//   - LocalDirSnapshotStore — a directory on disk. Used by unit tests and
//     by laptop workflows (clone --fresh) when the BACKUP_* creds aren't
//     available locally (Vercel marks them Sensitive, so `vercel env pull`
//     writes them empty).
//
// Stores move opaque bytes; compression/encoding is the caller's concern
// (lib/orgSnapshotV2 pipes NDJSON through gzip before putStream).

import type { Readable } from 'node:stream'
import { PassThrough } from 'node:stream'
import { mkdirSync, createWriteStream, createReadStream, statSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

export interface StoreListItem {
  key: string
  last_modified: string
  size_bytes: number
}

export interface SnapshotStore {
  put(key: string, body: Buffer): Promise<{ size_bytes: number }>
  putStream(key: string, body: Readable): Promise<{ size_bytes: number }>
  get(key: string): Promise<Buffer>
  getStream(key: string): Promise<Readable>
  list(prefix: string): Promise<StoreListItem[]>
}

// ---------------------------------------------------------------------------
// S3

let _client: S3Client | null = null

function s3Client(): S3Client {
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

function s3Bucket(): string {
  const bucket = process.env.BACKUP_S3_BUCKET
  if (!bucket) throw new Error('BACKUP_S3_BUCKET env var missing')
  return bucket
}

export function hasBackupS3Env(): boolean {
  return !!(process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_REGION
    && process.env.BACKUP_AWS_ACCESS_KEY_ID && process.env.BACKUP_AWS_SECRET_ACCESS_KEY)
}

function s3Encryption(): Record<string, string> {
  const kmsKey = process.env.BACKUP_S3_KMS_KEY_ID
  return kmsKey
    ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: kmsKey }
    : { ServerSideEncryption: 'AES256' }
}

export class S3SnapshotStore implements SnapshotStore {
  async put(key: string, body: Buffer): Promise<{ size_bytes: number }> {
    await s3Client().send(new PutObjectCommand({
      Bucket: s3Bucket(), Key: key, Body: body,
      ContentType: 'application/json',
      ...s3Encryption(),
    }))
    return { size_bytes: body.length }
  }

  async putStream(key: string, body: Readable): Promise<{ size_bytes: number }> {
    // Count bytes as they pass so callers get a real size without buffering.
    let size = 0
    const counter = new PassThrough()
    counter.on('data', (chunk: Buffer) => { size += chunk.length })
    body.pipe(counter)
    const upload = new Upload({
      client: s3Client(),
      params: {
        Bucket: s3Bucket(), Key: key, Body: counter,
        ContentType: 'application/octet-stream',
        ...s3Encryption(),
      },
    })
    await upload.done()
    return { size_bytes: size }
  }

  async get(key: string): Promise<Buffer> {
    const out = await s3Client().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }))
    if (!out.Body) throw new Error('Empty S3 response body for ' + key)
    const chunks: Buffer[] = []
    for await (const chunk of out.Body as unknown as AsyncIterable<Buffer | Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  async getStream(key: string): Promise<Readable> {
    const out = await s3Client().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }))
    if (!out.Body) throw new Error('Empty S3 response body for ' + key)
    return out.Body as unknown as Readable
  }

  async list(prefix: string): Promise<StoreListItem[]> {
    const items: StoreListItem[] = []
    let token: string | undefined
    do {
      const out = await s3Client().send(new ListObjectsV2Command({
        Bucket: s3Bucket(), Prefix: prefix, ContinuationToken: token,
      }))
      for (const o of out.Contents || []) {
        items.push({
          key: o.Key || '',
          last_modified: o.LastModified ? o.LastModified.toISOString() : '',
          size_bytes: o.Size || 0,
        })
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined
    } while (token)
    return items
  }
}

// ---------------------------------------------------------------------------
// Local directory (tests + laptop fallback)

export class LocalDirSnapshotStore implements SnapshotStore {
  constructor(private baseDir: string) {}

  private resolve(key: string): string {
    const p = path.join(this.baseDir, key)
    if (!p.startsWith(path.resolve(this.baseDir) + path.sep) && path.resolve(p) !== path.resolve(this.baseDir)) {
      throw new Error('Key escapes store base dir: ' + key)
    }
    return p
  }

  async put(key: string, body: Buffer): Promise<{ size_bytes: number }> {
    const p = this.resolve(key)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, body)
    return { size_bytes: body.length }
  }

  async putStream(key: string, body: Readable): Promise<{ size_bytes: number }> {
    const p = this.resolve(key)
    mkdirSync(path.dirname(p), { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(p)
      body.pipe(out)
      out.on('finish', () => resolve())
      out.on('error', reject)
      body.on('error', reject)
    })
    return { size_bytes: statSync(p).size }
  }

  async get(key: string): Promise<Buffer> {
    return readFileSync(this.resolve(key))
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key))
  }

  async list(prefix: string): Promise<StoreListItem[]> {
    const items: StoreListItem[] = []
    const base = path.resolve(this.baseDir)
    const walk = (dir: string) => {
      let entries: string[]
      try { entries = readdirSync(dir) } catch { return }
      for (const name of entries) {
        const full = path.join(dir, name)
        const st = statSync(full)
        if (st.isDirectory()) { walk(full); continue }
        const key = path.relative(base, full).split(path.sep).join('/')
        if (key.startsWith(prefix)) {
          items.push({ key, last_modified: st.mtime.toISOString(), size_bytes: st.size })
        }
      }
    }
    walk(base)
    return items
  }
}
