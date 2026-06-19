// lib/deckLastModified.ts
// Resolve "when was this deck's source last touched" with three fallbacks:
//   1. git log -1 (last commit timestamp on the file) — accurate on dev where
//      the git binary is in PATH.
//   2. fs.statSync mtime — works on Vercel runtime; equals checkout/deploy
//      time so all files end up with the same value, but at least matches the
//      build behavior.
//   3. NEXT_PUBLIC_BUILD_DATE — last-resort fallback if both fail.
//
// Cached at module scope so we only pay the cost once per cold start.

import { execSync } from 'child_process'
import { statSync } from 'fs'
import path from 'path'

const cache: Record<string, string | null> = {}

export function deckLastModified(relativePath: string): string | null {
  if (relativePath in cache) return cache[relativePath]

  // A deck was "last touched" at the LATER of its last commit and its last file
  // edit. Using commit-time alone was buggy: files committed together share one
  // timestamp, and edits made after the last commit (working-doc iteration)
  // never moved the date. So take max(gitCommitTime, mtime).
  //   - Locally: surfaces uncommitted edits, and de-bundles same-commit files.
  //   - On Vercel runtime: git is absent → gitTs is null → mtime (deploy time).

  let gitTs: string | null = null
  try {
    const ts = execSync(
      `git log -1 --format=%cI -- ${JSON.stringify(relativePath)}`,
      { encoding: 'utf-8', cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    if (ts) gitTs = ts
  } catch { /* git unavailable, or file untracked */ }

  let mtimeTs: string | null = null
  try {
    mtimeTs = statSync(path.join(process.cwd(), relativePath)).mtime.toISOString()
  } catch { /* file missing */ }

  // ISO-8601 strings sort lexicographically, so string compare = time compare.
  let best: string | null
  if (gitTs && mtimeTs) best = gitTs > mtimeTs ? gitTs : mtimeTs
  else best = gitTs || mtimeTs || process.env.NEXT_PUBLIC_BUILD_DATE || null

  cache[relativePath] = best
  return best
}
