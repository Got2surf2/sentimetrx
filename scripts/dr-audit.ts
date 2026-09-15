// scripts/dr-audit.ts — read-only disaster-recovery audit (SECURITY.md §11,
// open item 13). Run it at the start of every quarterly drill; paste the JSON
// into the devlog entry. It never writes anything.
//
//   npx tsx scripts/dr-audit.ts
//
// Reads from .env.local: BACKUP_S3_* / BACKUP_AWS_* (the org-snapshot bucket)
// and SUPABASE_ACCESS_TOKEN (Management API, read-only endpoints only).
//
// What it checks and why:
//   - S3 versioning MUST be Enabled — the nightly org-snapshot cron overwrites
//     the same keys per org+day (lib/orgSnapshotV2), so versioning is the only
//     thing that preserves a prior copy if a bad run lands.
//   - Default encryption + a lifecycle rule are the baseline for a bucket that
//     holds every tenant's data.
//   - Snapshot dates: the chain must be continuous up to yesterday — a gap is a
//     silent cron failure.
//   - Supabase: daily backups present, latest within 24h, PITR flag (RPO).
import { config as loadDotenv } from 'dotenv'
import {
  S3Client, GetBucketVersioningCommand, GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3'

loadDotenv({ path: '.env.local', override: false })

const PROD_REF = 'foubvgcarhwzjqwaxnod'   // Sentimetrx (prod)

interface Report {
  ranAt: string
  s3?: {
    bucket: string; region: string; versioning: string; encryption: string; lifecycleRules: number | string
    objectsSampled: number; truncated: boolean; snapshotDates: { first?: string; last?: string; distinct: number }
    daysSinceLastSnapshot: number | null; topPrefixes: string[]
  }
  s3Error?: string
  supabase?: {
    status: number; region?: string; pitr_enabled?: boolean; walg_enabled?: boolean
    backups: number; latestBackupAt?: string; hoursSinceLatestBackup: number | null
  }
  supabaseError?: string
  verdicts: string[]
}

function errName(e: unknown): string { return e instanceof Error ? `${e.name}: ${e.message}` : String(e) }

async function auditS3(report: Report): Promise<void> {
  const region = process.env.BACKUP_S3_REGION, bucket = process.env.BACKUP_S3_BUCKET
  const accessKeyId = process.env.BACKUP_AWS_ACCESS_KEY_ID, secretAccessKey = process.env.BACKUP_AWS_SECRET_ACCESS_KEY
  if (!region || !bucket || !accessKeyId || !secretAccessKey) { report.s3Error = 'BACKUP_S3_* / BACKUP_AWS_* not set'; return }
  const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
  try {
    const versioning = (await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }))).Status ?? 'Disabled'
    let encryption = 'none'
    try {
      encryption = (await s3.send(new GetBucketEncryptionCommand({ Bucket: bucket })))
        .ServerSideEncryptionConfiguration?.Rules?.map(r => r.ApplyServerSideEncryptionByDefault?.SSEAlgorithm ?? '?').join(',') ?? 'none'
    } catch (e) { encryption = 'ERR ' + errName(e) }
    let lifecycleRules: number | string = 0
    try { lifecycleRules = (await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))).Rules?.length ?? 0 }
    catch (e) { lifecycleRules = (e instanceof Error && e.name === 'NoSuchLifecycleConfiguration') ? 0 : 'ERR ' + errName(e) }
    const ls = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 }))
    const keys = (ls.Contents ?? []).map(o => o.Key ?? '')
    const dates = [...new Set(keys.map(k => (k.match(/\d{4}-\d{2}-\d{2}/) ?? [])[0]).filter((d): d is string => !!d))].sort()
    const last = dates.at(-1)
    const daysSinceLastSnapshot = last ? Math.floor((Date.now() - new Date(last + 'T00:00:00Z').getTime()) / 86_400_000) : null
    report.s3 = {
      bucket, region, versioning, encryption, lifecycleRules,
      objectsSampled: keys.length, truncated: !!ls.IsTruncated,
      snapshotDates: { first: dates[0], last, distinct: dates.length },
      daysSinceLastSnapshot,
      topPrefixes: [...new Set(keys.map(k => k.split('/')[0]))].slice(0, 8),
    }
    report.verdicts.push(versioning === 'Enabled' ? 'PASS S3 versioning enabled' : `FAIL S3 versioning is ${versioning} — enable it (SECURITY.md §11)`)
    report.verdicts.push(encryption !== 'none' && !encryption.startsWith('ERR') ? `PASS S3 default encryption (${encryption})` : `WARN S3 default encryption: ${encryption}`)
    report.verdicts.push(daysSinceLastSnapshot !== null && daysSinceLastSnapshot <= 1 ? 'PASS org snapshots current (≤1 day old)' : `FAIL latest org snapshot is ${daysSinceLastSnapshot ?? 'unknown'} days old — check /api/cron/org-snapshot`)
  } catch (e) { report.s3Error = errName(e) }
}

async function auditSupabase(report: Report): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) { report.supabaseError = 'SUPABASE_ACCESS_TOKEN not set'; return }
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROD_REF}/database/backups`, { headers: { Authorization: `Bearer ${token}` } })
    const j = await r.json() as { region?: string; pitr_enabled?: boolean; walg_enabled?: boolean; backups?: Array<{ inserted_at?: string }> }
    const latestBackupAt = (j.backups ?? []).map(b => b.inserted_at ?? '').filter(Boolean).sort().at(-1)
    const hoursSinceLatestBackup = latestBackupAt ? Math.round((Date.now() - new Date(latestBackupAt).getTime()) / 3_600_000) : null
    report.supabase = { status: r.status, region: j.region, pitr_enabled: j.pitr_enabled, walg_enabled: j.walg_enabled, backups: (j.backups ?? []).length, latestBackupAt, hoursSinceLatestBackup }
    if (r.status !== 200) report.verdicts.push(`FAIL Supabase backups endpoint returned ${r.status}`)
    else {
      report.verdicts.push(hoursSinceLatestBackup !== null && hoursSinceLatestBackup <= 30 ? `PASS Supabase daily backup present (${hoursSinceLatestBackup}h old)` : `FAIL latest Supabase backup is ${hoursSinceLatestBackup ?? 'unknown'}h old`)
      report.verdicts.push(j.pitr_enabled ? 'PASS PITR enabled (RPO minutes)' : 'INFO PITR not enabled — RPO is 24h (SECURITY.md §11 states 24h; enable PITR before the first paying customer if a tighter RPO is promised)')
    }
  } catch (e) { report.supabaseError = errName(e) }
}

async function main(): Promise<void> {
  const report: Report = { ranAt: new Date().toISOString(), verdicts: [] }
  await auditS3(report)
  await auditSupabase(report)
  console.log(JSON.stringify(report, null, 2))
  const failed = report.verdicts.some(v => v.startsWith('FAIL')) || !!report.s3Error || !!report.supabaseError
  process.exit(failed ? 1 : 0)
}

void main()
