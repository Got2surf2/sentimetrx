// lib/dataStory — the Data Story generator: payload built by the ENGINE's own
// recount, quotes gated by the verbatim-premise rule, renderer escaping and
// section gating. Pure functions, no mocks.
import { describe, it, expect } from 'vitest'
import {
  buildStoryPayload, deterministicNarrative, parseNarrative, renderDataStory,
  pickRatingField, pickSegmentField, type StoryData,
} from '@/lib/dataStory'
import { recountThemes, type ThemeModel } from '@/lib/themeUtils'
import type { SchemaFieldConfig, DatasetAnalytics } from '@/lib/analyzeTypes'

const THEMES = [
  { id: 't1', name: 'Service', description: 'staff and service', keywords: ['service', 'waiter'], sentiment: 'negative', count: 0, percentage: 0, relatedThemes: [] },
  { id: 't2', name: 'Food', description: 'the food', keywords: ['food', 'tacos'], sentiment: 'positive', count: 0, percentage: 0, relatedThemes: [] },
]
const MODEL: ThemeModel = { themes: THEMES, summary: '', fieldName: 'comment' }

const fields = [
  { field: 'comment', label: 'Comment', type: 'open-ended' },
  { field: 'rating', label: 'Rating', type: 'numeric' },
  { field: 'region', label: 'Region', type: 'categorical' },
] as unknown as SchemaFieldConfig[]

function rows(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < 60; i++) {
    out.push({
      comment: 'The service was terrible and the waiter was rude to our whole table tonight.',
      rating: 1, region: i % 2 ? 'East' : 'West',
    })
    out.push({
      comment: 'The food and tacos were absolutely delicious and fresh every single visit.',
      rating: 5, region: i % 2 ? 'East' : 'West',
    })
  }
  return out
}

const analytics = {
  totalRows: 120, computedAt: '', fieldSummaries: {
    region: { type: 'categorical', nonNull: 120, counts: { East: 60, West: 60 }, topN: ['East', 'West'], values: ['East', 'West'], uniqueCount: 2, uniqueRatio: 0.02 },
  },
} as unknown as DatasetAnalytics

const payload = () => buildStoryPayload({ rows: rows(), themeModel: MODEL, datasetName: 'Coastal Grill', totalRows: 120, fields, analytics })

describe('field heuristics', () => {
  it('picks the rating field by score-like name and the 2–6-value categorical as segment', () => {
    expect(pickRatingField(fields)).toBe('rating')
    expect(pickSegmentField(fields, analytics, 120)).toBe('region')
  })
  it('returns null without candidates', () => {
    expect(pickRatingField([fields[0]])).toBeNull()
    expect(pickSegmentField(fields, null, 120)).toBeNull()
  })
})

describe('buildStoryPayload', () => {
  it('theme figures equal the engine recount exactly', () => {
    const p = payload()
    const engine = recountThemes(THEMES, rows(), ['comment'], 'rating')
    for (const t of p.themes) {
      const e = engine.find(x => x.id === t.id)!
      expect([t.count, t.pct, t.avgRating]).toEqual([e.count, e.percentage, e.avgRating])
    }
    expect(p.substantiveBase).toBe(120)
    expect(p.overallAvgRating).toBe(3)
  })

  it('every quote carries its theme premise and a theme keyword', () => {
    const p = payload()
    expect(p.quotes.length).toBeGreaterThan(0)
    for (const q of p.quotes) {
      const theme = p.themes.find(t => t.name === q.theme)!
      expect(theme.keywords.some(k => q.text.toLowerCase().includes(k))).toBe(true)
      if (theme.sentiment === 'negative') expect(q.text).toMatch(/terrible|rude/)
      if (theme.sentiment === 'positive') expect(q.text).toMatch(/delicious|fresh/)
    }
  })

  it('builds per-segment profiles over each segment’s own recount', () => {
    const p = payload()
    expect(p.segmentFieldLabel).toBe('region')
    expect(p.segments.map(s => s.label).sort()).toEqual(['East', 'West'])
    for (const s of p.segments) expect(s.substantive).toBe(60)
  })

  it('drops the segment section when only one segment is thick enough', () => {
    const thin = rows().map((r, i) => ({ ...r, region: i < 5 ? 'West' : 'East' }))
    const p = buildStoryPayload({ rows: thin, themeModel: MODEL, datasetName: 'X', totalRows: 120, fields, analytics })
    expect(p.segments).toEqual([])
    expect(p.segmentFieldLabel).toBeNull()
  })
})

describe('narrative', () => {
  it('deterministic narrative states only payload facts', () => {
    const n = deterministicNarrative(payload())
    expect(n.lede).toContain('120')
    expect(n.themesIntro).toMatch(/Service|Food/)
  })
  it('parseNarrative takes valid JSON and falls back per-field on junk', () => {
    const fb = deterministicNarrative(payload())
    const ok = parseNarrative('```json\n{"lede":"A lede.","themesIntro":"Themes.","ratingIntro":null,"segmentIntro":"Segments."}\n```', fb)
    expect(ok.lede).toBe('A lede.')
    expect(ok.ratingIntro).toBe(fb.ratingIntro)
    expect(parseNarrative('not json at all', fb)).toEqual(fb)
  })
})

describe('renderDataStory', () => {
  const story = (): StoryData => { const p = payload(); return { ...p, narrative: deterministicNarrative(p) } }

  it('renders every engine figure and section, with no leakage artifacts', () => {
    const html = renderDataStory(story())
    expect(html).toContain('Coastal Grill')
    expect(html).toContain('datanautix')
    expect(html).not.toContain('Sentimetrx')
    for (const t of story().themes) expect(html).toContain(t.name)
    expect(html).toContain('What moves the score')
    expect(html).toContain('How it differs by region')
    expect(html).not.toMatch(/undefined|NaN/)
  })

  it('escapes hostile dataset names and quote text', () => {
    const s = story()
    s.datasetName = '<script>alert(1)</script>'
    s.quotes = [{ text: 'Bad "service" <img src=x>', theme: 'Service', meta: 'Service' }]
    const html = renderDataStory(s)
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('omits rating and segment sections when their data is absent', () => {
    const s = story()
    s.overallAvgRating = null
    s.segments = []
    s.narrative.ratingIntro = null
    s.narrative.segmentIntro = null
    const html = renderDataStory(s)
    expect(html).not.toContain('What moves the score')
    expect(html).not.toContain('How it differs by')
  })
})
