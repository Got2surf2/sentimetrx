// lib/pptx/slideRenderer — renderDeck driven with the REAL pptxgenjs over a
// deck containing every slide type, then the produced .pptx validated as an
// archive. Mock-free by design: the ENGINEERING §6 lesson is that a deck can
// look right through mocks and LibreOffice yet be "repaired" (shapes stripped)
// by real PowerPoint — the documented tripwire is any 9+-digit attribute value
// in the slide XML (legal alpha max 100000, angle max 21600000), which this
// suite runs on every slide of every render.
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { renderDeck, fmtWallClock, type DeckSpec, type SlideSpec } from '@/lib/pptx/slideRenderer'

const kpi = { value: '4.8', label: 'Avg rating', sub: 'n=1,204' }
const bars = [
  { label: 'Service', value: 62 },
  { label: 'Food', value: 48 },
  { label: 'Value', value: 21 },
]

const ALL_SLIDES: SlideSpec[] = [
  { type: 'bar_chart', title: 'BarChartUnique', data: bars, insight: 'Service leads mentions.' },
  { type: 'column_chart', title: 'ColumnChartUnique', valueSuffix: '%', data: [...bars, { label: 'Opened only', value: 9, muted: true }] },
  { type: 'kpi_grid', title: 'KpiGridUnique', kpis: [kpi, { value: '89%', label: 'Positive' }] },
  { type: 'table', title: 'TableUnique', columns: ['Theme', 'Mentions'], rows: [['Service', '62'], ['Food', '48']] },
  { type: 'bullets', title: 'BulletsUnique', bullets: ['First finding', 'Second finding'] },
  { type: 'quotes', title: 'QuotesUnique', quotes: [{ text: 'The service was wonderful.', attribution: '5-star review' }] },
  { type: 'two_column', title: 'TwoColumnUnique', left: { heading: 'Strengths', bullets: ['Fast seating'] }, right: { heading: 'Gaps', bullets: ['Slow refills'] } },
  { type: 'entity_grid', title: 'EntityGridUnique', entities: [{ name: 'Margarita', mentions: 44, pct: 12 }] },
  {
    type: 'provenance', title: 'ProvenanceUnique', wallClockSeconds: 95,
    inputs: [{ label: 'Reviews', value: '1,204' }], processing: [{ label: 'Themes', value: '9' }], outputs: [{ label: 'Slides', value: '20' }],
    pipelineStages: ['Ingest', 'Mine', 'Render'], humanEquivLow: 20, humanEquivHigh: 40,
  },
  { type: 'custom_decks', title: 'CustomDecksUnique', capabilities: ['Any audience', 'Any cut of the data'] },
  { type: 'section', title: 'SectionUnique', eyebrow: 'THEMES' },
  {
    type: 'theme_cards', title: 'ThemeCardsUnique',
    cards: [{ name: 'Service', pct: 62, count: 745, total: 1204, sentiment: 'Positive', keywords: [{ word: 'waiter', pct: 31 }] }],
  },
  { type: 'comments_grid', title: 'CommentsGridUnique', comments: [{ text: 'Great patio.', pills: [{ label: 'Age 35-44', tone: 'demo' }] }] },
  {
    type: 'numeric_stats', title: 'NumericStatsUnique', stats: [{ label: 'Mean', value: '4.2' }],
    histogram: [{ label: '1', count: 40 }, { label: '5', count: 700 }], meanFrac: 0.8, meanLabel: 'avg 4.2',
  },
  { type: 'dist_bars', title: 'DistBarsUnique', kpis: [kpi], data: bars },
  { type: 'compact_grid', title: 'CompactGridUnique', cells: [{ label: 'Age', total: 100, bars: [{ label: '18-34', value: 40 }, { label: '35+', value: 60 }] }] },
  { type: 'survey_funnel', title: 'SurveyFunnelUnique', kpis: [kpi], stages: [{ label: 'Started', count: 100 }, { label: 'Finished', count: 80 }] },
  {
    type: 'theme_impact', title: 'ThemeImpactUnique', interpretation: 'Speed drives the score.',
    impacts: [{ themeName: 'Speed', coefficient: 0.4, significant: true }, { themeName: 'Decor', coefficient: -0.1, significant: false }],
  },
]

const DECK: DeckSpec = {
  title: 'Guest Experience Readout',
  subtitle: 'FY26 review analysis',
  preparedFor: 'Coastal Grill Ops',
  slides: ALL_SLIDES,
}

async function renderAndOpen(deck: DeckSpec) {
  const buf = await renderDeck(deck, 'Coastal Reviews FY26')
  const zip = await JSZip.loadAsync(buf)
  const slideNames = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
  const slideXml: string[] = []
  for (const name of slideNames.sort()) slideXml.push(await zip.files[name].async('string'))
  return { buf, zip, slideNames, slideXml, allXml: slideXml.join('\n') }
}

describe('renderDeck — full-deck render through real pptxgenjs', () => {
  it('renders a valid archive with a title slide plus one slide per spec, every type present', async () => {
    const { buf, slideNames, allXml } = await renderAndOpen(DECK)
    expect(buf.subarray(0, 2).toString()).toBe('PK') // zip magic
    expect(slideNames).toHaveLength(1 + ALL_SLIDES.length)
    expect(allXml).toContain('Guest Experience Readout') // title slide
    for (const s of ALL_SLIDES) {
      expect(allXml).toContain((s as { title: string }).title)
    }
    // Representative content survived into the XML
    expect(allXml).toContain('The service was wonderful.')
    // fmtWallClock(95) renders as separate number + unit boxes on provenance
    expect(allXml).toContain('minutes')
  })

  it('produces no out-of-range OOXML attribute values (ENGINEERING §6 corruption tripwire)', async () => {
    const { slideXml, slideNames } = await renderAndOpen(DECK)
    slideXml.forEach((xml, i) => {
      // idx="4294967295" is a legitimate placeholder index (unsigned-int max);
      // the corruption class is 9+-digit EFFECT values (dir/dist/blurRad/alpha)
      const suspects = (xml.match(/[a-zA-Z]+="[0-9]{9,}"/g) || []).filter((m) => !m.startsWith('idx='))
      expect(suspects, `9+-digit attribute in ${slideNames[i]}`).toEqual([])
    })
  })

  it('stamps the Datanautix company brand into the file metadata (not Sentimetrx)', async () => {
    const { zip } = await renderAndOpen(DECK)
    const core = await zip.files['docProps/core.xml'].async('string')
    const app = await zip.files['docProps/app.xml'].async('string')
    expect(core).toContain('Datanautix')
    expect(app).toContain('Datanautix')
    expect(core + app).not.toContain('Sentimetrx')
  })

  it('renders an unknown slide type as a bullets fallback instead of throwing', async () => {
    const deck: DeckSpec = {
      title: 'Fallback Deck',
      slides: [{ type: 'hologram', title: 'MysterySlide' } as unknown as SlideSpec],
    }
    const { slideNames, allXml } = await renderAndOpen(deck)
    expect(slideNames).toHaveLength(2)
    expect(allXml).toContain('MysterySlide')
  })
})

describe('fmtWallClock', () => {
  it('picks seconds / minutes / hours by magnitude', () => {
    expect(fmtWallClock(42)).toBe('42 seconds')
    expect(fmtWallClock(95)).toBe('2 minutes')
    expect(fmtWallClock(7200)).toBe('2.0 hours')
  })
})
