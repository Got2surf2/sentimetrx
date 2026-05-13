import 'server-only'

// lib/entityExtraction.ts
//
// Canonicalise + categorise open-ended entity mentions (orgs, products,
// people, places named in survey answers / reviews / comments) and persist
// per-row tags to public.entity_mentions.
//
// Pipeline mirrors the existing entity-analysis-deck route, but with two
// changes for in-product use:
//   1. Row provenance is preserved — each mention is written with its
//      source row_id so we can filter rows by entity (TextMine) and join
//      entity mentions to themes (theme card "Top entities").
//   2. Results land in the DB, not a PPTX. The deck route can keep using
//      `canonicaliseEntities` directly without the DB write.

import type { SupabaseClient } from '@supabase/supabase-js'
import { callAI } from '@/lib/ai'

export const MAX_ROWS_PER_EXTRACTION = 10_000

// ── Helpers ────────────────────────────────────────────────────────────────

/** Split a raw cell value into individual entity mentions. Generous on
 *  delimiters: commas, semicolons, " and ", " & ", slashes, newlines. */
export function splitMentions(raw: string): string[] {
  if (!raw || typeof raw !== 'string') return []
  return raw
    .split(/\s*(?:,|;|\/|\n|\band\b|&)\s*/i)
    .map(s => s.trim())
    .filter(s => s.length >= 2 && s.length <= 120)
    .filter(s => !/^(none|n\/a|na|nothing|no|n\.a\.|nope|unknown)$/i.test(s))
}

/** AI placeholder canonicals to drop — Claude sometimes emits these when
 *  it can't confidently normalise a mention. They pollute the top-N
 *  rankings if kept. */
const CANONICAL_BLOCKLIST = new Set<string>([
  'unspecified',
  'unable to classify',
  'unknown',
  'various',
  'a few',
  'multiple',
  'several',
  'n/a',
  'not specified',
  'not applicable',
  'others',
  'other',
])

function isBlockedCanonical(s: string): boolean {
  const norm = s.toLowerCase().trim()
  return CANONICAL_BLOCKLIST.has(norm) || norm.length < 2
}

const CATEGORIES = [
  'religious', 'health', 'humanitarian', 'education', 'youth', 'animal',
  'veterans', 'environmental', 'community', 'arts', 'business',
  'government', 'media', 'sports', 'food', 'other',
]

/** Canonicalise a list of raw mentions via Claude Haiku. Returns a map
 *  raw → { canonical, category }. Done in batches of up to 200. */
export async function canonicaliseEntities(uniqueRaw: string[]): Promise<Record<string, { canonical: string; category: string }>> {
  const result: Record<string, { canonical: string; category: string }> = {}
  const BATCH = 200
  for (let i = 0; i < uniqueRaw.length; i += BATCH) {
    const batch = uniqueRaw.slice(i, i + BATCH)
    const prompt =
`You are normalising a list of entity names (organisations, brands, products, places, people) extracted from open-ended text responses. For each input, output a JSON object mapping the raw input to a canonical name and a category. Group obvious variants of the same entity together ("Red Cross" / "ARC" / "American Red Cross" → "American Red Cross"). Preserve real distinctions ("SPCA" vs "ASPCA" — different organisations).

Categories (pick the single best fit; lower-case):
- religious        — faith-based, church, religious order
- health           — disease research, hospitals, medical
- humanitarian     — international aid, refugees, disaster relief, hunger
- education        — schools, universities, scholarships
- youth            — children, mentoring, scouting
- animal           — animal welfare, wildlife
- veterans         — military veterans and families
- environmental    — climate, conservation, sustainability
- community        — local food banks, shelters, community foundations
- arts             — museums, performing arts, public broadcasting
- business         — companies, brands, restaurants, products
- government       — agencies, public services, politicians
- media            — news outlets, publications, broadcasters
- sports           — teams, leagues, athletes, sports orgs
- food             — restaurants, food brands, cuisines
- other            — anything that does not fit cleanly above

Return ONLY a JSON object. No prose, no markdown fences. Keys are the raw inputs verbatim. Values are { "canonical": "...", "category": "..." }.

Raw inputs:
${batch.map(s => `- ${s}`).join('\n')}`
    try {
      const res = await callAI({
        tier: 'fast',
        system: 'You are a precise data normaliser. Output valid JSON only.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 4000,
        timeoutMs: 30_000,
      })
      const text = res.text?.trim() || ''
      const jsonStart = text.indexOf('{')
      const jsonEnd = text.lastIndexOf('}')
      if (jsonStart < 0 || jsonEnd < 0) continue
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1))
      for (const [k, v] of Object.entries(parsed)) {
        const vv = v as any
        if (vv && typeof vv.canonical === 'string' && typeof vv.category === 'string') {
          const cat = vv.category.toLowerCase().trim()
          result[k] = {
            canonical: vv.canonical.trim(),
            category: CATEGORIES.includes(cat) ? cat : 'other',
          }
        }
      }
    } catch {
      // Fall through — uncanonicalised entries default to themselves below
    }
  }
  // Fill in any missing entries with the raw value + "other"
  for (const raw of uniqueRaw) {
    if (!result[raw]) result[raw] = { canonical: raw, category: 'other' }
  }
  // Drop AI-placeholder canonicals.
  for (const raw of Object.keys(result)) {
    if (isBlockedCanonical(result[raw].canonical)) delete result[raw]
  }
  return result
}

// ── Persistence: pull rows, canonicalise, write entity_mentions ────────────

export interface ExtractionResult {
  rows_scanned: number
  rows_with_value: number
  mentions_inserted: number
  distinct_canonical: number
  distinct_categories: number
  field: string
}

/** Resolve a dataset id to the list of member dataset ids when the dataset
 *  is a collection; otherwise just returns [datasetId]. */
async function resolveMemberDatasetIds(service: SupabaseClient, datasetId: string): Promise<string[]> {
  const { data: dataset } = await service
    .from('datasets').select('id, source').eq('id', datasetId).single()
  if (!dataset) return []
  if ((dataset as any).source !== 'collection') return [datasetId]
  const { data: col } = await service.from('collections').select('id').eq('dataset_id', datasetId).single()
  if (!col) return [datasetId]
  const { data: members } = await service
    .from('collection_members')
    .select('dataset_id')
    .eq('collection_id', (col as any).id)
  if (!members || members.length === 0) return [datasetId]
  return members.map((m: any) => m.dataset_id)
}

/** Run the extraction pipeline against one dataset+field and persist results
 *  to entity_mentions. Replaces any prior extraction for this dataset+field
 *  (full re-extract). Updates datasets.entity_extraction_state.
 *
 *  Caller is responsible for org-scope authorisation. */
export async function extractAndPersistEntities(opts: {
  service: SupabaseClient
  datasetId: string
  field: string
  maxRows?: number
}): Promise<ExtractionResult> {
  const { service, datasetId, field } = opts
  const maxRows = Math.min(opts.maxRows ?? MAX_ROWS_PER_EXTRACTION, MAX_ROWS_PER_EXTRACTION)

  const memberIds = await resolveMemberDatasetIds(service, datasetId)
  if (memberIds.length === 0) {
    throw new Error('Dataset not found')
  }

  // Page through rows, track row_id provenance per raw mention.
  const PAGE = 1000
  let rowsScanned = 0
  let rowsWithValue = 0
  // rowMentions: Map<row_id, Set<raw_mention>>
  const rowMentions = new Map<number, Set<string>>()
  const uniqueRawSet = new Set<string>()

  outer:
  for (const dsId of memberIds) {
    let offset = 0
    while (rowsScanned < maxRows) {
      const remaining = maxRows - rowsScanned
      const pageSize = Math.min(PAGE, remaining)
      const { data: rows, error } = await service
        .from('dataset_rows_flat')
        .select('id, data')
        .eq('dataset_id', dsId)
        .order('row_index', { ascending: true })
        .range(offset, offset + pageSize - 1)
      if (error || !rows || rows.length === 0) break
      for (const r of rows) {
        rowsScanned += 1
        const val = (r as any).data?.[field]
        if (typeof val !== 'string' || !val.trim()) continue
        const mentions = splitMentions(val)
        if (mentions.length === 0) continue
        rowsWithValue += 1
        const set = rowMentions.get((r as any).id) ?? new Set<string>()
        for (const m of mentions) {
          set.add(m)
          uniqueRawSet.add(m)
        }
        rowMentions.set((r as any).id, set)
        if (rowsScanned >= maxRows) break outer
      }
      if (rows.length < pageSize) break
      offset += pageSize
    }
  }

  if (uniqueRawSet.size === 0) {
    return {
      rows_scanned: rowsScanned,
      rows_with_value: 0,
      mentions_inserted: 0,
      distinct_canonical: 0,
      distinct_categories: 0,
      field,
    }
  }

  // Cap canonicalisation input to keep AI cost predictable.
  const uniqueRaw = Array.from(uniqueRawSet).slice(0, 2000)
  const mapping = await canonicaliseEntities(uniqueRaw)

  // Clear prior mentions for this dataset+field, then insert fresh.
  await service
    .from('entity_mentions')
    .delete()
    .eq('dataset_id', datasetId)
    .eq('source_field', field)

  // Build insert rows (one per row+canonical pair).
  type InsertRow = {
    dataset_id: string
    row_id: number
    source_field: string
    canonical: string
    raw_mention: string
    category: string
  }
  const inserts: InsertRow[] = []
  const canonSet = new Set<string>()
  const categorySet = new Set<string>()
  rowMentions.forEach(function(raws, rowId) {
    // Dedup canonicals within a single row
    const seenCanon = new Map<string, { raw: string; category: string }>()
    raws.forEach(function(raw) {
      const map = mapping[raw]
      if (!map) return // dropped by blocklist
      if (!seenCanon.has(map.canonical)) {
        seenCanon.set(map.canonical, { raw, category: map.category })
      }
    })
    seenCanon.forEach(function(v, canon) {
      inserts.push({
        dataset_id: datasetId,
        row_id: rowId,
        source_field: field,
        canonical: canon,
        raw_mention: v.raw,
        category: v.category,
      })
      canonSet.add(canon)
      categorySet.add(v.category)
    })
  })

  // Insert in chunks of 500.
  let inserted = 0
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500)
    const { error } = await service.from('entity_mentions').insert(chunk)
    if (error) throw new Error(`entity_mentions insert failed: ${error.message}`)
    inserted += chunk.length
  }

  // Update extraction-state JSON on the dataset.
  const { data: ds } = await service
    .from('datasets')
    .select('entity_extraction_state')
    .eq('id', datasetId)
    .single()
  const prevState = ((ds as any)?.entity_extraction_state as Record<string, unknown>) || {}
  const nextState = {
    ...prevState,
    [field]: {
      at: new Date().toISOString(),
      rows_scanned: rowsScanned,
      rows_with_value: rowsWithValue,
      mentions_inserted: inserted,
      distinct_canonical: canonSet.size,
    },
  }
  await service.from('datasets').update({ entity_extraction_state: nextState }).eq('id', datasetId)

  return {
    rows_scanned: rowsScanned,
    rows_with_value: rowsWithValue,
    mentions_inserted: inserted,
    distinct_canonical: canonSet.size,
    distinct_categories: categorySet.size,
    field,
  }
}
