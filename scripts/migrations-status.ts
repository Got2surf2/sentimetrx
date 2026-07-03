#!/usr/bin/env tsx
// Migration drift report: diff the sql/ directory against the schema_migrations
// ledger (sql/147) in the linked database.
//
//   tsx scripts/migrations-status.ts            # report only
//   tsx scripts/migrations-status.ts --backfill # one-time: mark every current
//                                               # sql/ file as applied (seed the
//                                               # ledger for pre-147 history)
//
// Reports two drift classes:
//   • committed but NOT recorded applied  → someone forgot to run it (or ran the
//     bare `supabase db query` without recording)
//   • recorded applied but NO file        → a file was deleted/renamed after apply
//
// Only the numbered `NNN_*.sql` files are tracked (the phase*/one-off escape
// hatches are excluded, same as the tx-wrap guard).

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const SQL_DIR = join(__dirname, '..', 'sql')

function shJson(args: string[]): unknown {
  const out = execFileSync('supabase', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  // CLI output shapes seen in the wild:
  //   - bare JSON array of rows (older CLI)
  //   - { "warning": "...untrusted data...", "rows": [...] } (newer CLI wraps
  //     query results with an untrusted-data boundary)
  // Either way there may be a leading warning banner — parse from the first
  // '{' or '[', then unwrap .rows when present.
  const start = Math.min(...['[', '{'].map(c => out.indexOf(c)).filter(i => i >= 0))
  if (!Number.isFinite(start)) return []
  const parsed = JSON.parse(out.slice(start)) as unknown
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as { rows?: unknown[] }).rows)) {
    return (parsed as { rows: unknown[] }).rows
  }
  return parsed
}

function localFiles(): { name: string; sha: string }[] {
  return readdirSync(SQL_DIR)
    .filter(f => /^\d{3}_.*\.sql$/.test(f))
    .sort()
    .map(name => ({ name, sha: createHash('sha256').update(readFileSync(join(SQL_DIR, name), 'utf8')).digest('hex') }))
}

function backfill() {
  const files = localFiles()
  const values = files.map(f => `('${f.name}', '${f.sha}', 'backfill')`).join(',\n  ')
  const sql =
    `INSERT INTO public.schema_migrations (filename, sha256, applied_by) VALUES\n  ${values}\n` +
    `ON CONFLICT (filename) DO NOTHING;`
  execFileSync('supabase', ['db', 'query', '--linked', sql], { stdio: 'inherit' })
  console.log(`✅ Backfilled ${files.length} migration rows (existing rows untouched).`)
}

function main() {
  if (process.argv.includes('--backfill')) { backfill(); return }

  const files = localFiles()
  const rows = shJson(['db', 'query', '--linked', 'SELECT filename, sha256 FROM public.schema_migrations;']) as { filename: string; sha256: string }[]
  const applied = new Map(rows.map(r => [r.filename, r.sha256]))
  const localNames = new Set(files.map(f => f.name))

  const notApplied = files.filter(f => !applied.has(f.name)).map(f => f.name)
  const shaMismatch = files.filter(f => applied.has(f.name) && applied.get(f.name) !== f.sha).map(f => f.name)
  const orphanRows = [...applied.keys()].filter(n => !localNames.has(n))

  console.log(`Tracked migrations: ${files.length} local, ${applied.size} recorded applied.`)
  if (notApplied.length) console.log('\n⚠️  Committed but NOT recorded applied:\n  ' + notApplied.join('\n  '))
  if (shaMismatch.length) console.log('\n⚠️  Applied but file changed since (sha mismatch):\n  ' + shaMismatch.join('\n  '))
  if (orphanRows.length) console.log('\n⚠️  Recorded applied but no file (deleted/renamed):\n  ' + orphanRows.join('\n  '))
  if (!notApplied.length && !shaMismatch.length && !orphanRows.length) console.log('\n✅ In sync — every committed migration is recorded applied.')

  process.exit(notApplied.length || orphanRows.length ? 1 : 0)
}

main()
