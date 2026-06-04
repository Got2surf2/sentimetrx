// lib/recordings/normalize.ts
//
// Pure (client-safe) deterministic entity-spelling normalization — the
// "Corrected" transcript view (docs/RECORDINGS.md §3.5b). Split out of
// entities.ts (which is `server-only` because it calls the AI) so the report
// page's Transcript tab can compute the corrected view client-side from the raw
// segments + the entity map, without shipping the raw transcript twice.
//
// NOT an AI rewrite: only the listed mis-heard spellings change; all other text
// is byte-identical. The stored raw ASR transcript is never mutated — this
// derives the corrected view on read.

import type { TranscriptSegment, EntityMap } from '@/lib/recordings/types'

// variant → canonical replacements. Case-insensitive, whole-word, longest-
// variant-first so "Kelly Park Road" is replaced before "Kelly Park".
export function buildReplacements(entityMap: EntityMap | null): Array<{ re: RegExp; to: string }> {
  if (!entityMap) return []
  const pairs: Array<{ from: string; to: string }> = []
  for (const e of entityMap.entities) {
    for (const v of e.variants) {
      if (!v || v.toLowerCase() === e.canonical.toLowerCase()) continue
      pairs.push({ from: v, to: e.canonical })
    }
  }
  pairs.sort((a, b) => b.from.length - a.from.length)
  return pairs.map(p => ({ re: new RegExp(`\\b${escapeRegExp(p.from)}\\b`, 'gi'), to: p.to }))
}

export function normalizeText(text: string, repl: Array<{ re: RegExp; to: string }>): string {
  let out = text
  for (const r of repl) out = out.replace(r.re, r.to)
  return out
}

// Apply the corrections to transcript segments, returning new segment objects
// (callers leave the raw segments untouched).
export function normalizeSegments(segments: TranscriptSegment[], entityMap: EntityMap | null): TranscriptSegment[] {
  const repl = buildReplacements(entityMap)
  if (repl.length === 0) return segments
  return segments.map(s => ({ ...s, text: normalizeText(s.text, repl) }))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
