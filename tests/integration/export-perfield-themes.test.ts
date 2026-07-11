// tests/integration/export-perfield-themes.test.ts
//
// Per-field theme sets in the export routes (2026-07-11). A dataset with two
// open-ended prompts (Liked Most / Liked Least) stores one theme set per
// prompt in theme_model.fields; exports must surface BOTH — each counted
// against its own question's responses — instead of only the active set.
//
// PPTX: captures the DeckSpec passed to renderDeck and asserts one labeled
// Theme Analysis section per set (theme ids deliberately collide across sets
// — t1/t2 in both — the exact case a flat selectedThemeIds list can't handle).
// HTML: asserts each open-ended slide carries its own set's themes.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Fixture: two prompts, two theme sets, six rows ──────────────────────────
const MOST_THEMES = [
  { id: 't1', name: 'Fresh Pasta', description: 'Praise for the pasta', keywords: ['pasta'], sentiment: 'positive', count: 0, percentage: 0, relatedThemes: [] },
  { id: 't2', name: 'Great Service', description: 'Praise for the staff', keywords: ['service'], sentiment: 'positive', count: 0, percentage: 0, relatedThemes: [] },
]
const LEAST_THEMES = [
  { id: 't1', name: 'Long Waits', description: 'Waiting too long', keywords: ['wait'], sentiment: 'negative', count: 0, percentage: 0, relatedThemes: [] },
  { id: 't2', name: 'Too Loud', description: 'Noise complaints', keywords: ['loud'], sentiment: 'negative', count: 0, percentage: 0, relatedThemes: [] },
]
const THEME_MODEL = {
  themes: MOST_THEMES, summary: '', fieldName: 'liked_most', fieldNames: ['liked_most'], themeSource: 'ai',
  fields: {
    liked_most:  { themes: MOST_THEMES,  summary: '', fieldName: 'liked_most',  fieldNames: ['liked_most'] },
    liked_least: { themes: LEAST_THEMES, summary: '', fieldName: 'liked_least', fieldNames: ['liked_least'] },
  },
}
const ROWS = [
  { liked_most: 'The pasta was outstanding', liked_least: 'The wait for a table was far too long' },
  { liked_most: 'Loved the pasta and the sauce', liked_least: 'Way too loud in the dining room' },
  { liked_most: 'Service was quick and friendly', liked_least: 'The wait dragged on forever' },
  { liked_most: 'Wonderful service from our waiter', liked_least: 'Very loud crowd near the bar' },
  { liked_most: 'Best pasta in town', liked_least: 'Long wait even with a reservation' },
  { liked_most: 'Attentive service all evening', liked_least: 'Music was too loud to talk' },
]
const SCHEMA_FIELDS = [
  { field: 'liked_most', label: 'Liked Most', type: 'open-ended', status: 'active' },
  { field: 'liked_least', label: 'Liked Least', type: 'open-ended', status: 'active' },
]
const ANALYTICS = {
  totalRows: ROWS.length,
  computedAt: '2026-07-11T00:00:00Z',
  fieldSummaries: {
    liked_most:  { type: 'open-ended', nonNull: ROWS.length, avgWordCount: 5, sample: ROWS.map(r => r.liked_most) },
    liked_least: { type: 'open-ended', nonNull: ROWS.length, avgWordCount: 6, sample: ROWS.map(r => r.liked_least) },
  },
}

vi.mock('@/lib/auth/orgAccess', () => ({
  getCallerOrgContext: async () => ({ userId: 'u1', orgId: 'orgA', isAdmin: false }),
}))

type Thenable = {
  select: (..._a: unknown[]) => Thenable
  eq: () => Thenable
  order: () => Thenable
  range: () => Thenable
  in: () => Thenable
  limit: () => Thenable
  single: () => Promise<{ data: unknown; error: null }>
  maybeSingle: () => Promise<{ data: unknown; error: null }>
  then: (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) => Promise<unknown>
}

vi.mock('@/lib/supabase/server', () => {
  const builder = (table: string): Thenable => {
    const single =
      table === 'datasets'
        ? { id: 'ds_1', name: 'Carrabbas QC', source: 'upload', row_count: ROWS.length, ana_library: null, study_id: null, org_id: 'orgA', taxonomy_enabled: false, taxonomy_suppressed: false, studies: null }
        : table === 'dataset_state'
          ? { schema_config: { fields: SCHEMA_FIELDS }, analytics: ANALYTICS, theme_model: THEME_MODEL }
          : { id: 'x', org_id: 'orgA' }
    const listPayload =
      table === 'dataset_rows_flat'
        ? { data: ROWS.map(r => ({ data: r })), error: null, count: ROWS.length }
        : { data: [], error: null, count: 0 }
    const b = {} as Thenable
    for (const m of ['select', 'eq', 'order', 'range', 'in', 'limit'] as const) b[m] = () => b
    b.single = async () => ({ data: single, error: null })
    b.maybeSingle = async () => ({ data: single, error: null })
    b.then = (res, rej) => Promise.resolve(listPayload).then(res, rej)
    return b
  }
  return {
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: (t: string) => builder(t) }),
    createServiceRoleClient: () => ({ from: (t: string) => builder(t) }),
    getAuthUser: async () => ({ id: 'u1' }),
  }
})

vi.mock('@/lib/ai', () => ({ callAI: vi.fn(async () => ({ text: '{}', usage: {} })) }))
vi.mock('@/lib/export/scoreComments', () => ({
  pickBestComments: vi.fn(async (pool: string[], _info: unknown, n: number) => pool.slice(0, n)),
}))

// Capture the deck spec instead of rendering a real PPTX.
const captured: { spec: { slides: { type: string; title?: string; cards?: { name: string; count?: number; total?: number }[] }[] } | null } = { spec: null }
vi.mock('@/lib/pptx/slideRenderer', () => ({
  renderDeck: vi.fn(async (spec: never) => { captured.spec = spec; return new Uint8Array([0x50, 0x4b]) }),
}))

import * as pptxExport from '@/app/api/datasets/[datasetId]/export/pptx/route'
import * as htmlExport from '@/app/api/datasets/[datasetId]/export/html/route'

function req(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/datasets/ds_1/export', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({ datasetId: 'ds_1' }) }
const BASE_BODY = {
  mode: 'builder', fields: ['liked_most', 'liked_least'], audience: 'stakeholder', skipAI: true,
  includeThemeSlides: true, includeDimensions: false, includeCustomDecks: false,
  includeProvenance: false, includeRecap: false, commentConfig: {}, commentAnnotations: [],
}

beforeEach(() => { captured.spec = null })

describe('per-field theme sets — PPTX deck', () => {
  it('renders one labeled Theme Analysis section per set, each counted on its own field', async () => {
    const res = await pptxExport.POST(req(BASE_BODY) as never, ctx as never)
    expect(res.status).toBe(200)
    const slides = captured.spec!.slides
    const sections = slides.filter(s => s.type === 'section' && (s.title || '').startsWith('Theme Analysis'))
    expect(sections.map(s => s.title)).toEqual(
      expect.arrayContaining(['Theme Analysis — Liked Most', 'Theme Analysis — Liked Least'])
    )
    // The LEAST set's cards exist and are counted against liked_least text
    const cardSlides = slides.filter(s => s.type === 'theme_cards')
    const leastCards = cardSlides.flatMap(s => s.cards || []).filter(c => c.name === 'Long Waits' || c.name === 'Too Loud')
    expect(leastCards.length).toBe(2)
    for (const c of leastCards) expect(c.count).toBeGreaterThan(0)
    const mostCards = cardSlides.flatMap(s => s.cards || []).filter(c => c.name === 'Fresh Pasta' || c.name === 'Great Service')
    expect(mostCards.length).toBe(2)
  })

  it('selectedThemesByField filters a non-active set (colliding ids stay per-set)', async () => {
    const res = await pptxExport.POST(req({ ...BASE_BODY, selectedThemesByField: { liked_least: ['t1'] } }) as never, ctx as never)
    expect(res.status).toBe(200)
    const cards = captured.spec!.slides.filter(s => s.type === 'theme_cards').flatMap(s => s.cards || [])
    expect(cards.some(c => c.name === 'Long Waits')).toBe(true)   // t1 in the LEAST set kept
    expect(cards.some(c => c.name === 'Too Loud')).toBe(false)    // t2 in the LEAST set dropped
    expect(cards.some(c => c.name === 'Great Service')).toBe(true) // t2 in the ACTIVE set untouched
  })
})

describe('per-field theme sets — HTML report', () => {
  it('each open-ended slide carries its own set (LEAST themes only exist via the per-field path)', async () => {
    const res = await htmlExport.POST(req(BASE_BODY) as never, ctx as never)
    expect(res.status).toBe(200)
    const html = await (res as Response).text()
    // Active set renders as before
    expect(html).toContain('Fresh Pasta')
    // The LEAST field's slides use the LEAST set — under the old single-set
    // behavior these themes matched 0 rows on liked_least and were dropped.
    expect(html).toContain('Long Waits')
    expect(html).toContain('Too Loud')
  })
})
