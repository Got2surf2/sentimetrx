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

  // 1. Try git log — most accurate when the binary is available.
  try {
    const ts = execSync(
      `git log -1 --format=%cI -- ${JSON.stringify(relativePath)}`,
      { encoding: 'utf-8', cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    if (ts) {
      cache[relativePath] = ts
      return ts
    }
  } catch { /* git unavailable at runtime, or file untracked — fall through */ }

  // 2. Try filesystem mtime.
  try {
    const ts = statSync(path.join(process.cwd(), relativePath)).mtime.toISOString()
    cache[relativePath] = ts
    return ts
  } catch { /* fall through */ }

  // 3. Last resort — build date.
  const fallback = process.env.NEXT_PUBLIC_BUILD_DATE || null
  cache[relativePath] = fallback
  return fallback
}
