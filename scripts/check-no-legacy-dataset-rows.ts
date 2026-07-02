#!/usr/bin/env tsx
// Fail CI when app/ or lib/ code READS the legacy `dataset_rows` batch table.
//
// `dataset_rows_flat` is the sole source of truth (CLAUDE.md). The legacy
// `dataset_rows` table still physically exists with stale residue, so a
// `.from('dataset_rows').select(...)` compiles and runs but returns wrong/empty
// data silently — exactly the bug that left theme-impact broken for weeks
// (fixed 2026-07-02). Deletes are allowed (teardown purges legacy residue);
// only reads are banned.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'lib'].map(d => join(__dirname, '..', d))

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
}

function main() {
  const files: string[] = []
  for (const root of ROOTS) walk(root, files)

  const offenders: string[] = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // A reference to the legacy table that is NOT a .delete() call.
      if (/\.from\((['"])dataset_rows\1\)/.test(line) && !/\.delete\(/.test(line)) {
        offenders.push(file.replace(join(__dirname, '..') + '/', '') + ':' + (i + 1) + '  ' + line.trim())
      }
    })
  }

  if (offenders.length > 0) {
    console.error('Legacy `dataset_rows` READ detected — use dataset_rows_flat (the sole source of truth):')
    for (const o of offenders) console.error('  ' + o)
    console.error('\nIf this is a teardown delete, keep `.delete()` on the same line as `.from(...)`.')
    process.exit(1)
  }
  console.log('OK — no legacy dataset_rows reads in app/ or lib/.')
}

main()
