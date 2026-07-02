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

  console.log(`==> Applying ${name} (sha ${sha.slice(0, 12)}…) to the linked project`)
  sh(['db', 'query', '--linked', '--file', file])

  console.log('==> Recording in schema_migrations')
  const insert =
    `INSERT INTO public.schema_migrations (filename, sha256, applied_by) ` +
    `VALUES ('${name}', '${sha}', '${who.replace(/'/g, "''")}') ` +
    `ON CONFLICT (filename) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = now(), applied_by = EXCLUDED.applied_by;`
  sh(['db', 'query', '--linked', insert])

  console.log(`✅ ${name} applied and recorded.`)
}

main()
