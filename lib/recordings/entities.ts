// lib/recordings/entities.ts
//
// Entity-spelling normalization for Town Hall recordings (docs/RECORDINGS.md
// §3.5b). After transcription we auto-extract the proper nouns mentioned in the
// meeting, clustering the ASR's spelling/phonetic variants under a best-guess
// canonical. The user reviews/corrects the map at the gate; the confirmed map:
//   (a) feeds the polish-pass glossary (correct spellings in the polished Q&A), and
//   (b) powers a deterministic "Corrected" transcript view (variants → canonical).
// The raw ASR transcript is never mutated — the corrected view is derived here.

import 'server-only'
import { callAI } from '@/lib/ai'
import { buildEntityExtractionPrompt } from '@/lib/recordings/prompts/qa'
import type {
  TranscriptSegment,
  QaSetupInputs,
  EntityMap,
  EntityMapEntry,
  EntityType,
} from '@/lib/recordings/types'

const SONNET_MODEL = 'claude-sonnet-4-6'
const VALID_TYPES = new Set<EntityType>(['person', 'place', 'org', 'project', 'term'])

// Auto-extract the entity map from a transcript. One Sonnet call. Returns null on
// any parse/call failure (non-fatal — the gate just shows no candidates). The
// `extracted_at` stamp is supplied by the caller so this stays deterministic.
export async function extractEntities(input: {
  transcript: TranscriptSegment[]
  setup: QaSetupInputs
  org_id: string
  recording_id: string
  now: string
}): Promise<{ entityMap: EntityMap | null; cents: number }> {
  if (input.transcript.length === 0) return { entityMap: null, cents: 0 }

  let cents = 0
  try {
    const { system, userPrompt } = buildEntityExtractionPrompt({
      transcript: input.transcript,
      setup: { panel: input.setup.panel, agenda: input.setup.agenda },
    })
    const resp = await callAI({
      tier: 'advanced',
      modelOverride: SONNET_MODEL,
      maxTokens: 4000,
      timeoutMs: 300000,
      system: [{ type: 'text', text: system, cache: true }],
      messages: [{ role: 'user', content: userPrompt }],
      usage: {
        org_id: input.org_id,
        resource_type: 'recording',
        resource_id: input.recording_id,
        event_type: 'recording_entity_extract',
      },
    })
    cents = 10
    const entities = parseEntities(resp.text)
    if (entities.length === 0) return { entityMap: null, cents }
    return { entityMap: { entities, extracted_at: input.now, reviewed_at: null }, cents }
  } catch {
    return { entityMap: null, cents }
  }
}

// Tolerant parse + sanitize of the extraction response into clean entries.
export function parseEntities(text: string): EntityMapEntry[] {
  const obj = parseJsonObject(text)
  const arr = (obj?.entities ?? []) as unknown[]
  const out: EntityMapEntry[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const canonical = String(it.canonical ?? '').trim()
    if (!canonical) continue
    const rawVariants = Array.isArray(it.variants) ? it.variants : []
    const seen = new Set<string>()
    const variants: string[] = []
    for (const v of rawVariants) {
      const s = String(v ?? '').trim()
      if (!s || seen.has(s.toLowerCase())) continue
      seen.add(s.toLowerCase())
      variants.push(s)
    }
    // Always include the canonical itself as a variant so the corrected view is a
    // no-op for already-correct spellings and the chip list shows it.
    if (!seen.has(canonical.toLowerCase())) variants.unshift(canonical)
    const typeRaw = String(it.type ?? 'term').trim().toLowerCase() as EntityType
    const type = VALID_TYPES.has(typeRaw) ? typeRaw : 'term'
    const mentions = Math.max(1, Math.round(Number(it.mentions ?? variants.length) || variants.length))
    out.push({ canonical, variants, type, mentions })
  }
  // Most-mentioned first — the names most worth checking surface at the top.
  out.sort((a, b) => b.mentions - a.mentions)
  return out
}

// The polish-pass glossary = confirmed canonical spellings ∪ any manually-typed
// "Names & terms" entries. De-duped, case-insensitive. undefined when empty.
export function glossaryFromEntities(entityMap: EntityMap | null, manual?: string[]): string[] | undefined {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (s: unknown) => {
    const v = String(s ?? '').trim()
    if (!v || seen.has(v.toLowerCase())) return
    seen.add(v.toLowerCase())
    out.push(v)
  }
  for (const e of entityMap?.entities ?? []) add(e.canonical)
  for (const m of manual ?? []) add(m)
  return out.length > 0 ? out : undefined
}

// Deterministic variant → canonical replacement (the "Corrected" transcript
// view). NOT an AI rewrite: only the listed mis-heard spellings change; all other
// text is byte-identical. Case-insensitive, whole-word, longest-variant-first so
// "Kelly Park Road" is replaced before "Kelly Park". Never touches the stored raw.
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
// (the raw segments are left untouched by the caller).
export function normalizeSegments(segments: TranscriptSegment[], entityMap: EntityMap | null): TranscriptSegment[] {
  const repl = buildReplacements(entityMap)
  if (repl.length === 0) return segments
  return segments.map(s => ({ ...s, text: normalizeText(s.text, repl) }))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Tolerant JSON extractor — strips markdown fences, slices to the outer object.
function parseJsonObject(text: string): Record<string, unknown> | null {
  let t = text.trim()
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first < 0 || last < first) return null
  try {
    return JSON.parse(t.slice(first, last + 1))
  } catch {
    return null
  }
}
