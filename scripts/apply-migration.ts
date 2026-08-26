#!/usr/bin/env tsx
// Apply a migration AND record it in the schema_migrations ledger (sql/147).
//
// Replaces the bare `supabase db query --linked --file sql/NNN_x.sql` step: it
// runs the same command, then records (filename, sha256, applied_at, applied_by)
// so `scripts/migrations-status.ts` can tell what's applied vs. just committed.
//
// Usage:
//   tsx scripts/apply-migration.ts sql/147_schema_migrations.sql
//   npm run migrate sql/147_schema_migrations.sql
//
// Idempotent record: re-applying updates the row (ON CONFLICT). The DB apply
// itself must be written idempotently (IF NOT EXISTS / CREATE OR REPLACE), same
// as always.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { existsSync, readFileSync as readEnv } from 'node:fs'

// Load .env.local if present — PROD_DB_URL naturally lives there next to
// TEST_DB_URL, and `npm run migrate` is a plain tsx invocation with no env
// loading of its own.
if (existsSync('.env.local')) {
  for (const line of readEnv('.env.local', 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

// How to reach the database.
//
// `--linked` goes through the Management API, but the CLI then provisions a
// TEMP ROLE and connects to the project's direct host to run the statement.
// That host (db.<ref>.supabase.co) resolves to IPv6 ONLY, so on any network
// without IPv6 it dies with a misleading
// `LegacyDbConfigConnectTempRoleError: ... Connection timed out` whose
// suggestion blames SUPABASE_DB_PASSWORD (2026-08-26).
//
// Set PROD_DB_URL to the SESSION POOLER string (aws-0-<region>.pooler.supabase.com,
// which is IPv4) and every step below routes through it instead. Same shape as
// the TEST_DB_URL already in .env.local.
const DB_URL = process.env.PROD_DB_URL || process.env.SUPABASE_DB_URL || ''
const CONN: string[] = DB_URL ? ['--db-url', DB_URL] : ['--linked']

function sh(args: string[]): string {
  return execFileSync('supabase', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: tsx scripts/apply-migration.ts <sql/NNN_name.sql>')
    process.exit(2)
  }
  const name = basename(file)
  const contents = readFileSync(file, 'utf8')
  const sha = createHash('sha256').update(contents).digest('hex')
  const who = process.env.MIGRATION_ACTOR || process.env.USER || 'operator'

  console.log(`==> Applying ${name} (sha ${sha.slice(0, 12)}…) via ${DB_URL ? 'PROD_DB_URL (pooler)' : '--linked'}`)
  sh(['db', 'query', ...CONN, '--file', file])

  console.log('==> Recording in schema_migrations')
  const insert =
    `INSERT INTO public.schema_migrations (filename, sha256, applied_by) ` +
    `VALUES ('${name}', '${sha}', '${who.replace(/'/g, "''")}') ` +
    `ON CONFLICT (filename) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = now(), applied_by = EXCLUDED.applied_by;`
  sh(['db', 'query', ...CONN, insert])

  // Refresh the committed schema snapshot (docs/db/schema.sql) so the repo
  // always carries an exact, replayable copy of the current prod schema —
  // the disaster-recovery blueprint. Best-effort: a dump failure must not
  // mask a successful migration.
  console.log('==> Refreshing docs/db/schema.sql snapshot')
  try {
    sh(['db', 'dump', ...CONN, '--schema', 'public', '-f', 'docs/db/schema.sql'])
    console.log('    snapshot refreshed — commit docs/db/schema.sql with this migration')
  } catch {
    console.warn('    WARNING: schema snapshot refresh failed — run `npm run schema:snapshot` manually')
  }

  console.log(`✅ ${name} applied and recorded.`)
}

main()
