#!/usr/bin/env tsx
// Pre-commit guard: when staged code maps to a spec doc (via scripts/specMap.ts)
// and that doc isn't also staged, block the commit and tell the user which doc
// to update.
//
// Escape hatch: `SKIP_SPEC_CHECK=1 git commit ...` bypasses for legitimate
// code-only changes (pure refactors, formatting, no behavioral spec impact).
//
// Exit 0 = OK, exit 1 = block. Initial commits (no HEAD yet) are skipped.

import { execSync } from 'node:child_process'
import { SPEC_MAP, type SpecKey } from './specMap'

if (process.env.SKIP_SPEC_CHECK) {
  console.log('spec-drift check skipped (SKIP_SPEC_CHECK set).')
  process.exit(0)
}

function globToRegex(glob: string): RegExp {
  let pattern = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  pattern = pattern.replace(/\*\*/g, '.+')
  pattern = pattern.replace(/\*/g, '[^/]*')
  pattern = pattern.replace(/\?/g, '.')
  return new RegExp('^' + pattern + '$')
}

const REGEX_CACHE = new Map<string, RegExp>()
function matches(file: string, globs: string[]): boolean {
  for (const g of globs) {
    let re = REGEX_CACHE.get(g)
    if (!re) {
      re = globToRegex(g)
      REGEX_CACHE.set(g, re)
    }
    if (re.test(file)) return true
  }
  return false
}

function staged(): string[] {
  // --diff-filter=ACMR: added/copied/modified/renamed — skip deletes (deleting a
  // file rarely requires a same-commit spec update; the next change will).
  let raw = ''
  try {
    raw = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
  } catch {
    // initial commit etc.
    return []
  }
  return raw.split('\n').map(s => s.trim()).filter(Boolean)
}

const stagedFiles = staged()
if (stagedFiles.length === 0) process.exit(0)

// Per spec: which staged files map to it, and is the spec itself staged?
const missing: Array<{ spec: SpecKey; triggers: string[] }> = []
for (const [spec, globs] of Object.entries(SPEC_MAP) as [SpecKey, string[]][]) {
  const triggers = stagedFiles.filter(f => f !== spec && matches(f, globs))
  if (triggers.length === 0) continue
  if (stagedFiles.includes(spec)) continue
  missing.push({ spec, triggers })
}

if (missing.length === 0) process.exit(0)

console.error('Spec drift: staged code maps to a spec doc that is NOT staged.\n')
for (const { spec, triggers } of missing) {
  console.error(`  ${spec} (triggered by):`)
  for (const t of triggers.slice(0, 8)) console.error(`    - ${t}`)
  if (triggers.length > 8) console.error(`    … and ${triggers.length - 8} more`)
}
console.error('\nUpdate the spec(s) in this commit, or set SKIP_SPEC_CHECK=1 if the change is genuinely doc-irrelevant (pure refactor, formatting, etc.).')
process.exit(1)
