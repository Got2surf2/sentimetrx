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
  // §3.5c — authoritative canonical spellings from the brand/agent catalog.
  knownEntities?: Array<{ canonical: string; variants?: string[] }>
}): Promise<{ entityMap: EntityMap | null; cents: number }> {
  if (input.transcript.length === 0) return { entityMap: null, cents: 0 }

  let cents = 0
  try {
    const { system, userPrompt } = buildEntityExtractionPrompt({
      transcript: input.transcript,
      setup: { panel: input.setup.panel, agenda: input.setup.agenda },
      knownEntities: input.knownEntities,
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

const MAX_ENTITIES = 200
const MAX_LEN = 120

// Validate + clean a raw array of entity-like objects into well-formed entries.
// Shared by parseEntities (AI output) and sanitizeEntityMap (user-edited save).
export function sanitizeEntries(arr: unknown[]): EntityMapEntry[] {
  const out: EntityMapEntry[] = []
  for (const item of arr) {
    if (out.length >= MAX_ENTITIES) break
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const canonical = String(it.canonical ?? '').trim().slice(0, MAX_LEN)
    if (!canonical) continue
    const rawVariants = Array.isArray(it.variants) ? it.variants : []
    const seen = new Set<string>()
    const variants: string[] = []
    for (const v of rawVariants) {
      const s = String(v ?? '').trim().slice(0, MAX_LEN)
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

// Tolerant parse + sanitize of the extraction response into clean entries.
export function parseEntities(text: string): EntityMapEntry[] {
  const obj = parseJsonObject(text)
  return sanitizeEntries((obj?.entities ?? []) as unknown[])
}

// Sanitize a user-edited entity map (from the review gate) before persisting.
// Preserves the original extraction timestamp; stamps reviewed_at = now. Returns
// null when there are no valid entries (treated as "clear the map").
export function sanitizeEntityMap(raw: unknown, now: string): EntityMap | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const entities = sanitizeEntries(Array.isArray(r.entities) ? r.entities : [])
  if (entities.length === 0) return null
  const extracted_at = typeof r.extracted_at === 'string' ? r.extracted_at : now
  return { entities, extracted_at, reviewed_at: now }
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

// Deterministic variant→canonical normalization (the "Corrected" transcript
// view) lives in the client-safe ./normalize module so the report page can use
// it too. Re-exported here for the existing server-side callers + tests.
export { buildReplacements, normalizeText, normalizeSegments } from '@/lib/recordings/normalize'

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
