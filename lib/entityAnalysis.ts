// lib/entityAnalysis.ts
//
// Shared entity-analysis core for open-ended fields that name organisations
// (e.g. "Charities donated to"). Extracts mentions, AI-canonicalises variants
// ("Red Cross" / "ARC" / "American Red Cross" → one entity), categorises, and
// produces the slide specs. Used by:
//   - GET /api/entity-analysis-deck      (standalone add-on deck)
//   - the StoryTime PPTX export route    (native entity slides)
// so both render identical analysis from one implementation.

import { callAI } from '@/lib/ai'
import type { SlideSpec } from '@/lib/pptx/slideRenderer'

/** Split a raw response into individual entity mentions. Generous on
 *  delimiters: commas, semicolons, " and ", " & ", newlines. */
export function splitMentions(raw: string): string[] {
  if (!raw || typeof raw !== 'string') return []
  return raw
    .split(/\s*(?:,|;|\n|\band\b|&)\s*/i)
    .map(s => s.trim())
    .filter(s => s.length >= 2 && s.length <= 120)
    .filter(s => !/^(none|n\/a|na|nothing|no|n\.a\.)$/i.test(s))
}

/** Call Claude Haiku to canonicalise a list of raw mentions to canonical
 *  names plus a category. Returns a map { rawMention: { canonical, category } }.
 *  Done in batches of up to 200 unique mentions per call. */
export async function canonicaliseEntities(uniqueRaw: string[]): Promise<Record<string, { canonical: string; category: string }>> {
  const result: Record<string, { canonical: string; category: string }> = {}
  const BATCH = 200
  for (let i = 0; i < uniqueRaw.length; i += BATCH) {
    const batch = uniqueRaw.slice(i, i + BATCH)
    const prompt =
`You are normalising a list of charity / nonprofit organisation names from open-ended survey responses. For each input, output a JSON object mapping the raw input to a canonical name and a category. Group obvious variants of the same org together ("Red Cross" / "ARC" / "American Red Cross" → "American Red Cross"). Preserve real distinctions ("SPCA" vs "ASPCA" — different organisations).

Categories (pick the single best fit; lower-case):
- religious        — faith-based, church-affiliated, religious order
- health           — disease research, hospitals, medical aid
- humanitarian     — international aid, refugees, disaster relief, hunger
- education        — schools, universities, scholarships, literacy
- youth            — children, after-school, mentoring, scouting
- animal           — animal welfare, wildlife conservation
- veterans         — military veterans and their families
- environmental    — climate, conservation, sustainability
- community        — local food banks, community foundations, shelters
- arts             — museums, performing arts, public broadcasting
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
          result[k] = { canonical: vv.canonical.trim(), category: vv.category.toLowerCase().trim() }
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
  return result
}

// Category → display color for the bar chart slide
export const CATEGORY_COLORS: Record<string, string> = {
  religious:     'E8B84B', // gold
  health:        'DC2626', // red
  humanitarian:  '0F7173', // teal
  education:     '00B4D8', // sarinaBlue
  youth:         '6D28D9', // purple
  animal:        'D97706', // amber
  veterans:      '0D2B45', // navy
  environmental: '059669', // green
  community:     'E8632A', // hermesOrange
  arts:          '4A6572', // slateDark
  other:         '8FA3AE', // slate
}

export function titleCaseCategory(cat: string): string {
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

export interface EntityAggregate {
  sorted: { canonical: string; category: string; count: number; raw: Set<string> }[]
  catCounts: Record<string, number>
  totalMentions: number
  distinctCount: number
  quoteCandidates: string[]
}

/**
 * Take the raw per-row field values for an entity field (one string per row),
 * split → AI-canonicalise → aggregate. Returns null when there are no usable
 * mentions. Caps unique mentions at 1000 per AI canonicalisation pass.
 */
export async function aggregateEntities(rawValues: (string | null | undefined)[]): Promise<EntityAggregate | null> {
  const allRaw: string[] = []
  for (const v of rawValues) {
    if (typeof v === 'string' && v.trim()) {
      for (const m of splitMentions(v)) allRaw.push(m)
    }
  }
  if (allRaw.length === 0) return null

  const uniqueRaw = Array.from(new Set(allRaw.map(s => s.trim()))).slice(0, 1000)
  const mapping = await canonicaliseEntities(uniqueRaw)

  type AggRow = { canonical: string; category: string; count: number; raw: Set<string> }
  const agg: Record<string, AggRow> = {}
  for (const raw of allRaw) {
    const key = raw.trim()
    const map = mapping[key] || { canonical: key, category: 'other' }
    const canon = map.canonical
    if (!agg[canon]) agg[canon] = { canonical: canon, category: map.category, count: 0, raw: new Set() }
    agg[canon].count += 1
    agg[canon].raw.add(raw)
  }
  const sorted = Object.values(agg).sort((a, b) => b.count - a.count)

  // Representative quotes — one distinct raw mention per category, up to 6
  const quoteCandidates: string[] = []
  const usedCats = new Set<string>()
  for (const row of sorted) {
    if (usedCats.has(row.category)) continue
    const sample = Array.from(row.raw)[0]
    if (sample) {
      quoteCandidates.push(`${row.canonical} — mentioned as: "${sample}"`)
      usedCats.add(row.category)
    }
    if (quoteCandidates.length >= 6) break
  }

  const catCounts: Record<string, number> = {}
  for (const row of sorted) catCounts[row.category] = (catCounts[row.category] || 0) + row.count
  const totalMentions = sorted.reduce((s, r) => s + r.count, 0)

  return { sorted, catCounts, totalMentions, distinctCount: sorted.length, quoteCandidates }
}

/** An entity row as read from the stored entity catalog (getEntitiesWithCounts). */
export interface CatalogEntity { canonical: string; category: string; mentions: number; aliases?: string[] }

/**
 * Adapt pre-extracted catalog entities (canonical/category/mentions, already
 * canonicalised + categorised by the discovery pipeline, with live counts) into
 * the same EntityAggregate the slide builder consumes — so the deck reuses the
 * stored catalog with ZERO additional AI cost instead of re-extracting.
 */
export function catalogToAggregate(
  entities: CatalogEntity[],
  categories: { category: string; mentions: number }[],
): EntityAggregate {
  const sorted = entities
    .filter(e => e.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions)
    .map(e => ({ canonical: e.canonical, category: e.category, count: e.mentions, raw: new Set(e.aliases || []) }))

  const catCounts: Record<string, number> = {}
  for (const c of categories) if (c.mentions > 0) catCounts[c.category] = c.mentions

  const quoteCandidates: string[] = []
  const usedCats = new Set<string>()
  for (const row of sorted) {
    if (usedCats.has(row.category)) continue
    const sample = Array.from(row.raw)[0]
    quoteCandidates.push(`${row.canonical}${sample ? ` — mentioned as: "${sample}"` : ''}`)
    usedCats.add(row.category)
    if (quoteCandidates.length >= 6) break
  }

  return {
    sorted,
    catCounts,
    totalMentions: sorted.reduce((s, e) => s + e.count, 0),
    distinctCount: sorted.length,
    quoteCandidates,
  }
}

/**
 * Build the 4 entity-analysis slide specs (top-24 grid, by-category bar chart,
 * long-tail grid, representative quotes) from an aggregate.
 */
export function entitySlideSpecs(field: string, agg: EntityAggregate): SlideSpec[] {
  const { sorted, catCounts, totalMentions, distinctCount, quoteCandidates } = agg
  const top24 = sorted.slice(0, 24)
  const longTail = sorted.slice(24, 48)
  const catBars = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => ({ label: titleCaseCategory(cat), value: n, color: CATEGORY_COLORS[cat] || CATEGORY_COLORS.other }))

  const slides: SlideSpec[] = []

  slides.push({
    type: 'entity_grid',
    title: `${field} — Top 24 organisations`,
    subtitle: `${distinctCount.toLocaleString()} distinct organisations · ${totalMentions.toLocaleString()} total mentions`,
    entities: top24.map(r => ({ name: r.canonical, mentions: r.count, category: titleCaseCategory(r.category) })),
    accentColor: 'E8B84B',
    insight: totalMentions > 0
      ? `Top ${top24.length} entities account for ${Math.round(top24.reduce((s, r) => s + r.count, 0) / totalMentions * 100)}% of all mentions.`
      : undefined,
  })

  if (catBars.length > 0) {
    slides.push({
      type: 'bar_chart',
      title: `${field} — by category`,
      subtitle: `Total mentions across ${Object.keys(catCounts).length} categories`,
      data: catBars,
      insight: `The top category — ${catBars[0]?.label} — accounts for ${Math.round((catBars[0]?.value || 0) / totalMentions * 100)}% of mentions.`,
    })
  }

  if (longTail.length > 0) {
    slides.push({
      type: 'entity_grid',
      title: `${field} — the long tail`,
      subtitle: `Organisations ranked ${25}–${24 + longTail.length}`,
      entities: longTail.map(r => ({ name: r.canonical, mentions: r.count, category: titleCaseCategory(r.category) })),
      accentColor: '00B4D8',
    })
  }

  if (quoteCandidates.length > 0) {
    slides.push({
      type: 'quotes',
      title: `${field} — representative mentions`,
      subtitle: 'Verbatim phrasing from respondents · one per category',
      quotes: quoteCandidates.map(q => ({ text: q })),
    })
  }

  return slides
}
