#!/usr/bin/env tsx
// Fail CI when a *new* numbered migration (sql/NNN_*.sql) is missing an
// explicit BEGIN / COMMIT wrapper. Pre-existing migrations are grandfathered
// (see SQL_TX_CUTOFF) so we don't have to retrofit ~50 historical files.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Last migration number that is allowed to ship without an explicit
// BEGIN/COMMIT. Anything > this must be transaction-wrapped.
const SQL_TX_CUTOFF = 70

const SQL_DIR = join(__dirname, '..', 'sql')

function isWrapped(text: string): boolean {
  // Match BEGIN; and COMMIT; as standalone SQL statements anywhere in the file.
  // Word-boundary keeps us from matching inside identifiers like `committed`.
  return /\bBEGIN\s*;/i.test(text) && /\bCOMMIT\s*;/i.test(text)
}

function main() {
  const files = readdirSync(SQL_DIR).filter(f => /^\d{3}_.*\.sql$/.test(f))
  const offenders: string[] = []

  for (const name of files) {
    const num = Number(name.slice(0, 3))
    if (num <= SQL_TX_CUTOFF) continue
    const body = readFileSync(join(SQL_DIR, name), 'utf8')
    if (!isWrapped(body)) offenders.push(name)
  }

  if (offenders.length) {
    console.error(`New migrations missing BEGIN/COMMIT (cutoff = ${SQL_TX_CUTOFF}):`)
    for (const f of offenders) console.error(`  - sql/${f}`)
    console.error('\nWrap each migration in BEGIN; ... COMMIT; so partial failures roll back cleanly.')
    process.exit(1)
  }

  console.log(`OK — all migrations after ${SQL_TX_CUTOFF} are transaction-wrapped.`)
}

main()
