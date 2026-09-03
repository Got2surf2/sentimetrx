// lib/dataStory — the Data Story generator: payload built by the ENGINE's own
// recount, quotes gated by the verbatim-premise rule, renderer escaping and
// section gating. Pure functions, no mocks.
import { describe, it, expect } from 'vitest'
import {
  buildStoryPayload, deterministicNarrative, parseNarrative, renderDataStory,
  pickRatingField, pickSegmentField, pickDateField, buildTimeline, buildBands,
  computeDrift, storyTitle, type StoryData,
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

describe('storyTitle', () => {
  it('collapses a stuttered trailing word and adapts the suffix to review datasets', () => {
    expect(storyTitle("Cheddar's Scratch Kitchen Reviews Reviews")).toBe("Cheddar's Scratch Kitchen: what the reviews say")
    expect(storyTitle('Acme Diner Reviews')).toBe('Acme Diner: what the reviews say')
    expect(storyTitle('Employee Survey')).toBe('Employee Survey: what the text says')
    expect(storyTitle('ea_football_reviews')).toBe('ea_football_reviews: what the text says')
  })
})

describe('renderDataStory', () => {
  const story = (): StoryData => { const p = payload(); return { ...p, narrative: deterministicNarrative(p) } }

  it('americanizes AI narrative prose but never verbatim quotes', () => {
    const s = story()
    s.narrative.lede = 'Players penalised the colour scheme whilst the organisation centred on defence.'
    s.quotes = [{ text: 'the colour and offence in this game are grey', theme: 'Service', meta: 'Service' }]
    const html = renderDataStory(s)
    expect(html).toContain('Players penalized the color scheme while the organization centered on defense.')
    // verbatim quote passes through untouched
    expect(html).toContain('the colour and offence in this game are grey')
  })

  it('renders every engine figure and section, with no leakage artifacts', () => {
    const html = renderDataStory(story())
    expect(html).toContain('Coastal Grill')
    expect(html).toContain('datanautix')
    expect(html).not.toContain('Sentimetrx')
    for (const t of story().themes) expect(html).toContain(t.name)
    // Findings-led heads: the rating section headline carries the claim.
    expect(html).toContain('drags the score hardest')
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
    s.narrative.ratingHead = null
    s.narrative.segmentIntro = null
    const html = renderDataStory(s)
    expect(html).not.toContain('drags the score hardest')
    expect(html).not.toContain('How it differs by')
  })

  it('renders the explorer with escaped embedded JSON and drops it below 40 items', () => {
    const s = story()
    const html = renderDataStory(s)
    expect(html).toContain('Read the responses yourselves')
    expect(html).toContain('id="xTheme"')
    // </script> injection through excerpt text must be neutralized
    const s2 = story()
    s2.explorer = s2.explorer.map(e => ({ ...e, t: e.t + ' </script><b>x</b>' }))
    expect(renderDataStory(s2)).not.toContain('</script><b>x</b>')
    const s3 = story()
    s3.explorer = s3.explorer.slice(0, 10)
    expect(renderDataStory(s3)).not.toContain('Read the responses yourselves')
  })

  it('renders timeline and bands sections when their payloads exist', () => {
    const s = story()
    s.timeline = {
      fieldLabel: 'review_date', unit: 'month',
      points: [
        { label: 'Jan 2026', count: 30, avgRating: 4.1, shares: { Service: 20 } },
        { label: 'Feb 2026', count: 30, avgRating: 3.9, shares: { Service: 24 } },
        { label: 'Mar 2026', count: 30, avgRating: 3.4, shares: { Service: 33 } },
        { label: 'Apr 2026', count: 30, avgRating: 3.2, shares: { Service: 41 } },
      ],
      tracked: ['Service'], ratingFrom: 4.1, ratingTo: 3.2,
      shiftTheme: { name: 'Service', fromPct: 20, toPct: 41 },
    }
    s.bands = {
      fieldLabel: 'playtime', lowest: { label: '≤ 2', avgRating: 2.9 },
      bands: [
        { label: '≤ 2', n: 100, avgRating: 2.9, topTheme: 'Service', topThemePct: 40 },
        { label: '2–8', n: 100, avgRating: 3.4, topTheme: 'Service', topThemePct: 30 },
        { label: '8–30', n: 100, avgRating: 3.8, topTheme: 'Service', topThemePct: 22 },
        { label: '> 30', n: 100, avgRating: 4.2, topTheme: 'Service', topThemePct: 12 },
      ],
    }
    s.narrative = deterministicNarrative(s)
    const html = renderDataStory(s)
    expect(html).toContain('moved from 20% to 41%')
    expect(html).toContain('band rates lowest')
    expect(html).toContain('playtime quartiles')
  })
})

// ── New deterministic analytics ─────────────────────────────────────────

describe('pickDateField / buildTimeline', () => {
  const dateFields = [...fields, { field: 'posted_at', label: 'Posted At', type: 'categorical' }] as unknown as SchemaFieldConfig[]
  function datedRows(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = []
    // 6 months; "service" complaints ramp up over time, ratings fall.
    for (let m = 0; m < 6; m++) {
      for (let i = 0; i < 40; i++) {
        const negShare = m / 6 // 0 → 5/6 across months
        const neg = i / 40 < negShare
        out.push({
          comment: neg
            ? 'The service was terrible and the waiter was rude to our whole table tonight.'
            : 'The food and tacos were absolutely delicious and fresh every single visit.',
          rating: neg ? 1 : 5,
          posted_at: `2026-0${m + 1}-15`,
        })
      }
    }
    return out
  }

  it('finds a parseable date-named field without a typed date column', () => {
    expect(pickDateField(dateFields, datedRows())).toBe('posted_at')
    expect(pickDateField(fields, rows())).toBeNull()
  })

  it('buckets by month, tracks theme shares, and finds the biggest shift', () => {
    const themes = recountThemes(THEMES, datedRows(), ['comment'], 'rating')
    const tl = buildTimeline(datedRows(), 'posted_at', 'rating', themes, ['comment'])!
    expect(tl).not.toBeNull()
    expect(tl.unit).toBe('month')
    expect(tl.points.length).toBe(6)
    expect(tl.points[0].label).toBe('Jan 2026')
    // service rises exactly as food falls — either is the biggest shift,
    // but the direction must match the theme picked
    const sh = tl.shiftTheme!
    expect(['Service', 'Food']).toContain(sh.name)
    if (sh.name === 'Service') expect(sh.toPct).toBeGreaterThan(sh.fromPct)
    else expect(sh.toPct).toBeLessThan(sh.fromPct)
    expect(Math.abs(sh.toPct - sh.fromPct)).toBeGreaterThan(20)
    expect(tl.ratingTo!).toBeLessThan(tl.ratingFrom!)
    // every point's share is that bucket's own recount base
    expect(tl.points[0].shares['Service']).toBeLessThan(tl.points[5].shares['Service'])
  })

  it('returns null on too few dated rows or too few buckets', () => {
    expect(buildTimeline(datedRows().slice(0, 50), 'posted_at', 'rating', [], ['comment'])).toBeNull()
  })
})

describe('buildBands / computeDrift', () => {
  it('splits on quartiles and finds the lowest-rated band', () => {
    const rs: Record<string, unknown>[] = []
    for (let i = 0; i < 400; i++) {
      const hours = i % 4 === 0 ? 1 : i % 4 === 1 ? 5 : i % 4 === 2 ? 20 : 100
      const neg = hours === 1 // the light users are the angry ones
      rs.push({
        comment: neg
          ? 'The service was terrible and the waiter was rude to our whole table tonight.'
          : 'The food and tacos were absolutely delicious and fresh every single visit.',
        rating: neg ? 1 : 5, hours,
      })
    }
    const summary = { type: 'numeric', nonNull: 400, min: 1, max: 100, avg: 31, median: 5, stddev: 40, p25: 1, p75: 20, histogram: [], uniqueCount: 4, isDiscrete: false } as never
    const themes = recountThemes(THEMES, rs, ['comment'], 'rating')
    const b = buildBands(rs, 'hours', summary, 'rating', themes, ['comment'])!
    expect(b.bands.length).toBe(4)
    expect(b.lowest!.label).toBe(b.bands[0].label)
    expect(b.bands[0].avgRating).toBe(1)
    expect(b.bands[0].topTheme).toBe('Service')
  })

  it('drift picks the theme with the widest cross-segment spread, ≥5pp', () => {
    expect(computeDrift([
      { label: 'A', substantive: 100, themes: [{ name: 'Service', pct: 40 }, { name: 'Food', pct: 30 }] },
      { label: 'B', substantive: 100, themes: [{ name: 'Service', pct: 12 }, { name: 'Food', pct: 28 }] },
    ])).toMatchObject({ theme: 'Service', maxSeg: 'A', maxPct: 40, minSeg: 'B', minPct: 12 })
    expect(computeDrift([
      { label: 'A', substantive: 100, themes: [{ name: 'Food', pct: 30 }] },
      { label: 'B', substantive: 100, themes: [{ name: 'Food', pct: 28 }] },
    ])).toBeNull()
  })
})
