// spec-drift: diff git history against scripts/specMap.ts and report which specs
// have likely drifted (code paths changed without their spec doc being updated).
//
// Usage:
//   npx tsx scripts/spec-drift.ts              # default: last 7 days
//   npx tsx scripts/spec-drift.ts <ref>        # since a specific ref (sha or 'HEAD~10' etc.)
//   npx tsx scripts/spec-drift.ts --since "2 weeks ago"
//   npx tsx scripts/spec-drift.ts --json       # machine-readable output
//
// Exit code: 0 always (drift is informational, not a build failure).

import { execSync } from 'child_process'
import { SPEC_MAP, TOP_LEVEL_SPECS, type SpecKey } from './specMap'

interface Commit {
  sha: string
  date: string
  author: string
  subject: string
  files: string[]
}

interface SpecDrift {
  spec: string
  status: 'clean' | 'updated' | 'drift'
  commitsTouchingCode: Commit[]
  commitsUpdatingSpec: Commit[]
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

function resolveSinceRef(sinceArg: string | undefined): string {
  if (sinceArg) return sinceArg
  const out = execSync('git log --until="7 days ago" --format=%H -n 1', { encoding: 'utf8' }).trim()
  if (out) return out
  return execSync('git rev-list --max-parents=0 HEAD', { encoding: 'utf8' }).trim().split('\n')[0]
}

function getCommits(sinceRef: string): Commit[] {
  // Format: <sha>\t<isoDate>\t<author>\t<subject>\n<files...>\n\n
  const raw = execSync(
    `git log ${sinceRef}..HEAD --pretty=format:'%x00%H%x09%cI%x09%an%x09%s' --name-only`,
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const commits: Commit[] = []
  for (const block of raw.split('\x00').filter(Boolean)) {
    const lines = block.split('\n').filter(l => l.length > 0)
    if (lines.length === 0) continue
    const header = lines[0].split('\t')
    if (header.length < 4) continue
    const [sha, date, author, ...subjectParts] = header
    commits.push({
      sha: sha.slice(0, 7),
      date: date.slice(0, 10),
      author,
      subject: subjectParts.join('\t'),
      files: lines.slice(1),
    })
  }
  return commits
}

function analyzeDrift(commits: Commit[]): { driftBySpec: Record<string, SpecDrift>, anyModuleDrift: boolean } {
  const driftBySpec: Record<string, SpecDrift> = {}
  for (const spec of Object.keys(SPEC_MAP)) {
    driftBySpec[spec] = { spec, status: 'clean', commitsTouchingCode: [], commitsUpdatingSpec: [] }
  }
  for (const spec of TOP_LEVEL_SPECS) {
    driftBySpec[spec] = { spec, status: 'clean', commitsTouchingCode: [], commitsUpdatingSpec: [] }
  }

  for (const commit of commits) {
    for (const [spec, globs] of Object.entries(SPEC_MAP) as [SpecKey, string[]][]) {
      const codeFiles = commit.files.filter(f => f !== spec && matches(f, globs))
      const specTouched = commit.files.includes(spec)
      if (codeFiles.length > 0) {
        driftBySpec[spec].commitsTouchingCode.push({ ...commit, files: codeFiles })
      }
      if (specTouched) {
        driftBySpec[spec].commitsUpdatingSpec.push(commit)
      }
    }
    for (const spec of TOP_LEVEL_SPECS) {
      if (commit.files.includes(spec)) {
        driftBySpec[spec].commitsUpdatingSpec.push(commit)
      }
    }
  }

  for (const drift of Object.values(driftBySpec)) {
    if (drift.commitsTouchingCode.length === 0 && drift.commitsUpdatingSpec.length === 0) {
      drift.status = 'clean'
    } else if (drift.commitsTouchingCode.length > 0 && drift.commitsUpdatingSpec.length === 0) {
      drift.status = 'drift'
    } else {
      drift.status = 'updated'
    }
  }

  const anyModuleDrift = Object.entries(driftBySpec).some(
    ([k, v]) => !TOP_LEVEL_SPECS.includes(k as (typeof TOP_LEVEL_SPECS)[number]) && v.status === 'drift',
  )

  return { driftBySpec, anyModuleDrift }
}

function renderMarkdown(sinceRef: string, commits: Commit[], driftBySpec: Record<string, SpecDrift>, anyModuleDrift: boolean): string {
  const out: string[] = []
  const today = new Date().toISOString().slice(0, 10)
  out.push(`# Spec drift report`)
  out.push(``)
  out.push(`**Date**: ${today}`)
  out.push(`**Range**: \`${sinceRef.slice(0, 7)}..HEAD\` — ${commits.length} commits`)
  out.push(``)

  const driftSpecs = Object.values(driftBySpec).filter(d => d.status === 'drift' && !TOP_LEVEL_SPECS.includes(d.spec as (typeof TOP_LEVEL_SPECS)[number]))
  const updatedSpecs = Object.values(driftBySpec).filter(d => d.status === 'updated' && !TOP_LEVEL_SPECS.includes(d.spec as (typeof TOP_LEVEL_SPECS)[number]))
  const cleanSpecs = Object.values(driftBySpec).filter(d => d.status === 'clean' && !TOP_LEVEL_SPECS.includes(d.spec as (typeof TOP_LEVEL_SPECS)[number]))

  if (commits.length === 0) {
    out.push(`No commits in range. Nothing to report.`)
    return out.join('\n')
  }

  // Summary
  out.push(`## Summary`)
  out.push(``)
  out.push(`| Status | Count | Specs |`)
  out.push(`|--------|-------|-------|`)
  out.push(`| ⚠️ Drift | ${driftSpecs.length} | ${driftSpecs.map(d => `\`${d.spec}\``).join(', ') || '—'} |`)
  out.push(`| ✅ Updated in range | ${updatedSpecs.length} | ${updatedSpecs.map(d => `\`${d.spec}\``).join(', ') || '—'} |`)
  out.push(`| 💤 Clean (no code touched) | ${cleanSpecs.length} | ${cleanSpecs.map(d => `\`${d.spec}\``).join(', ') || '—'} |`)
  out.push(``)

  // Top-level
  out.push(`## Top-level specs`)
  out.push(``)
  for (const spec of TOP_LEVEL_SPECS) {
    const d = driftBySpec[spec]
    if (d.commitsUpdatingSpec.length > 0) {
      out.push(`- ✅ \`${spec}\` was updated in this range (${d.commitsUpdatingSpec.length} commit${d.commitsUpdatingSpec.length === 1 ? '' : 's'}).`)
    } else if (anyModuleDrift) {
      out.push(`- ⚠️ \`${spec}\` (inventory doc) — module specs drifted, so this likely needs a sweep too.`)
    } else {
      out.push(`- 💤 \`${spec}\` — no module drift, no direct edits.`)
    }
  }
  out.push(``)

  // Per-spec drift detail
  if (driftSpecs.length > 0) {
    out.push(`## Drift detail`)
    out.push(``)
    for (const d of driftSpecs) {
      out.push(`### ⚠️ \`${d.spec}\``)
      out.push(``)
      out.push(`${d.commitsTouchingCode.length} commit${d.commitsTouchingCode.length === 1 ? '' : 's'} touched code mapped to this spec; the spec itself was not edited.`)
      out.push(``)
      for (const c of d.commitsTouchingCode) {
        out.push(`- \`${c.sha}\` ${c.date} ${c.author} — ${c.subject}`)
        const shown = c.files.slice(0, 6)
        for (const f of shown) {
          out.push(`  - \`${f}\``)
        }
        if (c.files.length > shown.length) {
          out.push(`  - …${c.files.length - shown.length} more`)
        }
      }
      out.push(``)
    }
  }

  if (updatedSpecs.length > 0) {
    out.push(`## Updated in range`)
    out.push(``)
    for (const d of updatedSpecs) {
      out.push(`- \`${d.spec}\` — ${d.commitsUpdatingSpec.length} edit${d.commitsUpdatingSpec.length === 1 ? '' : 's'} alongside ${d.commitsTouchingCode.length} code commit${d.commitsTouchingCode.length === 1 ? '' : 's'}.`)
    }
    out.push(``)
  }

  out.push(`---`)
  out.push(`*Map source: \`scripts/specMap.ts\`. Edit there to refine which paths belong to which spec.*`)
  return out.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  let sinceRef: string | undefined
  let asJson = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--json') asJson = true
    else if (a === '--since') sinceRef = execSync(`git log --until="${args[++i]}" --format=%H -n 1`, { encoding: 'utf8' }).trim()
    else if (!sinceRef) sinceRef = a
  }
  sinceRef = resolveSinceRef(sinceRef)
  const commits = getCommits(sinceRef)
  const { driftBySpec, anyModuleDrift } = analyzeDrift(commits)

  if (asJson) {
    console.log(JSON.stringify({ sinceRef, commitCount: commits.length, driftBySpec, anyModuleDrift }, null, 2))
  } else {
    console.log(renderMarkdown(sinceRef, commits, driftBySpec, anyModuleDrift))
  }
}

main()
