// GET /api/entity-analysis-deck — entity analysis of an open-ended field.
// Built to be additive to a StoryTime deck (uses the same renderDeck() so the
// look-and-feel matches exactly).
//
// Pulls rows from a dataset (or collection — expanded to member datasets),
// extracts the named field, splits multi-entity responses (commas, "and",
// semicolons, newlines), AI-canonicalises variants ("Red Cross" / "ARC" /
// "American Red Cross" → one entity), categorises, and renders 4 slides:
//   1. Entity grid — top 24 by mentions
//   2. Bar chart  — by category
//   3. Entity grid — the long tail (next 24)
//   4. Quotes     — representative raw mentions
//
// Query params:
//   ?dataset=<id>   (required) dataset OR collection-dataset id
//   ?field=<name>   (optional) field name; default "Charities donated to"
//   ?title=<text>   (optional) deck title; default "Entity Analysis"

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { renderDeck, type DeckSpec, type SlideSpec } from '@/lib/pptx/slideRenderer'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_ROWS = 10_000
const DEFAULT_FIELD = 'Charities donated to'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Split a raw response into individual entity mentions. Generous on
 *  delimiters: commas, semicolons, " and ", " & ", newlines. */
function splitMentions(raw: string): string[] {
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
async function canonicaliseEntities(uniqueRaw: string[]): Promise<Record<string, { canonical: string; category: string }>> {
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
const CATEGORY_COLORS: Record<string, string> = {
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

function titleCaseCategory(cat: string): string {
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(req.url)
  const datasetId = url.searchParams.get('dataset')?.trim()
  const field = (url.searchParams.get('field') || DEFAULT_FIELD).trim()
  const customTitle = url.searchParams.get('title')?.trim() || null
  if (!datasetId) {
    return new NextResponse('Missing ?dataset=<id>', { status: 400 })
  }
  await logDeckDownload('entity-analysis-deck', `${datasetId}:${field}`)

  const service = createServiceRoleClient()

  // ── Resolve dataset / collection ──
  const { data: dataset } = await service
    .from('datasets')
    .select('id, name, source')
    .eq('id', datasetId)
    .single()
  if (!dataset) {
    return new NextResponse('Dataset not found', { status: 404 })
  }
  const datasetName = (dataset as any).name as string

  let memberIds: string[] = [datasetId]
  if ((dataset as any).source === 'collection') {
    const { data: col } = await service.from('collections').select('id').eq('dataset_id', datasetId).single()
    if (col) {
      const { data: members } = await service
        .from('collection_members')
        .select('dataset_id')
        .eq('collection_id', (col as any).id)
      if (members && members.length > 0) memberIds = members.map((m: any) => m.dataset_id)
    }
  }

  // ── Pull rows + extract field values ──
  const allRaw: string[] = []
  const PAGE = 1000
  for (const dsId of memberIds) {
    let offset = 0
    while (allRaw.length < MAX_ROWS) {
      const { data: rows, error } = await service
        .from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', dsId)
        .order('row_index', { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (error || !rows || rows.length === 0) break
      for (const r of rows) {
        const val = (r as any).data?.[field]
        if (typeof val === 'string' && val.trim()) {
          for (const m of splitMentions(val)) allRaw.push(m)
        }
      }
      if (rows.length < PAGE) break
      offset += PAGE
    }
  }

  if (allRaw.length === 0) {
    return new NextResponse(`No values found for field "${field}" in dataset.`, { status: 404 })
  }

  // ── Canonicalise via AI ──
  const uniqueRaw = Array.from(new Set(allRaw.map(s => s.trim()))).slice(0, 1000)
  const mapping = await canonicaliseEntities(uniqueRaw)

  // ── Aggregate counts per canonical + category ──
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

  // ── Pick representative quotes (4-6 distinct raw mentions across categories) ──
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

  // ── Build DeckSpec ──
  const totalMentions = sorted.reduce((s, r) => s + r.count, 0)
  const top24 = sorted.slice(0, 24)
  const longTail = sorted.slice(24, 48)
  const catCounts: Record<string, number> = {}
  for (const row of sorted) catCounts[row.category] = (catCounts[row.category] || 0) + row.count
  const catBars = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => ({ label: titleCaseCategory(cat), value: n, color: CATEGORY_COLORS[cat] || CATEGORY_COLORS.other }))

  const slides: SlideSpec[] = []

  slides.push({
    type: 'entity_grid',
    title: `${field} — Top 24 organisations`,
    subtitle: `${sorted.length.toLocaleString()} distinct organisations · ${totalMentions.toLocaleString()} total mentions`,
    entities: top24.map(r => ({ name: r.canonical, mentions: r.count, category: titleCaseCategory(r.category) })),
    accentColor: 'E8B84B',
    insight: `Top ${top24.length} entities account for ${Math.round(top24.reduce((s, r) => s + r.count, 0) / totalMentions * 100)}% of all mentions.`,
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
      title: 'Representative mentions',
      subtitle: 'Verbatim phrasing from respondents · one per category',
      quotes: quoteCandidates.map(q => ({ text: q })),
    })
  }

  const deck: DeckSpec = {
    title: customTitle || `${datasetName} — ${field} entity analysis`,
    subtitle: 'Entity analysis · add-on to the StoryTime deck',
    slides,
  }

  const buffer = await renderDeck(deck, datasetName)
  const uint8 = new Uint8Array(buffer)
  const filenameSafe = `${datasetName} — ${field}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filenameSafe || 'entity-analysis'}.pptx"`,
    },
  })
}
