// lib/recordings/normalize.ts
//
// Pure (client-safe) deterministic entity-spelling normalization — the
// "Corrected" transcript view (docs/RECORDINGS.md §3.5b). Thin Town Hall adapter
// over the shared brand-correction layer (lib/correction/normalize): the meeting
// EntityMap is projected onto the neutral {canonical, aliases} glossary shape and
// the shared replacement builder + normalizer do the work, so Town Hall, agent
// reports, and surveys all canonicalize through one code path.
//
// NOT an AI rewrite: only the listed mis-heard spellings change; all other text
// is byte-identical. The stored raw ASR transcript is never mutated — this
// derives the corrected view on read.

import type { TranscriptSegment, EntityMap } from '@/lib/recordings/types'
import {
  buildReplacements as buildReplacementsFromGlossary,
  normalizeText,
  type GlossaryEntry,
} from '@/lib/correction/normalize'

// normalizeText is product-agnostic — re-export the shared implementation.
export { normalizeText }

// EntityMap → neutral glossary entries (the meeting's `variants` become the
// glossary `aliases`). The shared builder drops any alias equal to the canonical,
// so the resulting replacement set is identical to the historical recordings
// logic that lived here.
function entityMapToGlossary(entityMap: EntityMap | null): GlossaryEntry[] {
  if (!entityMap) return []
  return entityMap.entities.map(e => ({ canonical: e.canonical, aliases: e.variants }))
}

// variant → canonical replacements (longest-variant-first, whole-word, case-
// insensitive). Delegates to the shared builder.
export function buildReplacements(entityMap: EntityMap | null): Array<{ re: RegExp; to: string }> {
  return buildReplacementsFromGlossary(entityMapToGlossary(entityMap))
}

// Apply the corrections to transcript segments, returning new segment objects
// (callers leave the raw segments untouched).
export function normalizeSegments(segments: TranscriptSegment[], entityMap: EntityMap | null): TranscriptSegment[] {
  const repl = buildReplacements(entityMap)
  if (repl.length === 0) return segments
  return segments.map(s => ({ ...s, text: normalizeText(s.text, repl) }))
}
