#!/usr/bin/env tsx
// Pre-commit guard: when staged changes include real code (app/, lib/, sql/,
// components/, scripts/) and no weekly devlog file is also staged, block
// the commit and tell the user to append a Why + What changed block to
// the current week's devlog.
//
// Rationale: every meaningful change should leave a traceable "why we did
// this" entry, so future sessions (and a buyer's DD review) can reconstruct
// intent from git + devlog without having to ask the human. The rule lives
// in CLAUDE.md but sessions drop it routinely — the only durable fix is to
// make the rule load-bearing at commit time.
//
// Escape hatch: `SKIP_DEVLOG_CHECK=1 git commit ...` bypasses for genuinely
// trivial commits (typos, whitespace, package-lock churn, dependency bumps
// with no behavior change, fixture/snapshot updates).
//
// Exit 0 = OK, exit 1 = block. Initial commits (no HEAD yet) are skipped.

import { execSync } from 'node:child_process'

if (process.env.SKIP_DEVLOG_CHECK) {
  console.log('devlog-drift check skipped (SKIP_DEVLOG_CHECK set).')
  process.exit(0)
}

// Globs that signal a "meaningful change worth logging". Documentation-only
// commits (docs/*.md) don't trigger this — those have their own spec-drift
// guardrail and are themselves a form of WHY documentation.
const CODE_GLOBS = [
  /^app\//,
  /^lib\//,
  /^sql\//,
  /^components\//,
  /^scripts\//,
  /^middleware\.ts$/,
  /^next\.config\.(js|ts|mjs)$/,
  /^vercel\.json$/,
]

// Files that count as "you wrote a devlog entry for this commit."
const DEVLOG_RE = /^docs\/weekly-reports\/\d{4}-W\d{2}-devlog\.md$/

function staged(): string[] {
  let raw = ''
  try {
    raw = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
  } catch {
    return []
  }
  return raw.split('\n').map((s) => s.trim()).filter(Boolean)
}

const stagedFiles = staged()
if (stagedFiles.length === 0) process.exit(0)

const codeFiles = stagedFiles.filter((f) => CODE_GLOBS.some((re) => re.test(f)))
if (codeFiles.length === 0) process.exit(0)

const devlogStaged = stagedFiles.some((f) => DEVLOG_RE.test(f))
if (devlogStaged) process.exit(0)

// Compute the current week's expected devlog path so the suggestion is precise.
function isoWeekFile(): string {
  const d = new Date()
  // ISO week calculation per RFC 3339 (Monday-start weeks).
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `docs/weekly-reports/${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}-devlog.md`
}

const expected = isoWeekFile()

console.error('Devlog drift: meaningful changes staged but no weekly devlog entry.\n')
console.error('  Triggered by:')
for (const f of codeFiles.slice(0, 8)) console.error(`    - ${f}`)
if (codeFiles.length > 8) console.error(`    … and ${codeFiles.length - 8} more`)
console.error(`\nAppend a Why + What changed block to ${expected}, stage it,`)
console.error('and retry the commit. Pattern:\n')
console.error('  ## YYYY-MM-DD — short title')
console.error('')
console.error('  **Why**: ...one paragraph that captures intent, not just what code moved...')
console.error('')
console.error('  **What changed**:')
console.error('  - file/component — change summary')
console.error('')
console.error('Or set SKIP_DEVLOG_CHECK=1 for genuinely trivial commits (typos,')
console.error('whitespace, package-lock churn, dependency bumps with no behavior change).')
process.exit(1)
