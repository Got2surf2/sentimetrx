// lib/projectReportLoad.ts — the loaders that turn a collection's members
// (town hall recording, agent, reviews, CSAT) into normalized ProjectInputModels,
// the deterministic shared-theme scoring, and the route-facing tenancy +
// dispatch gate. Supabase is the filter-honoring fake; the Agent Study, the two
// model builders/renderers and the block sampler are mocked at their boundary.
// Panel filtering, Q&A display precedence, theme regexes and clustering run real.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeService, type FakeService, type Row } from '../helpers/fakeSupabase'
import type * as SampleMod from '@/lib/bulkRowSample'

let svc: FakeService
vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: () => svc }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
const getAgentStudy = vi.fn()
vi.mock('@/lib/agentStudy', () => ({ getAgentStudy: (...a: unknown[]) => getAgentStudy(...a) }))
const buildProjectReportModel = vi.fn(async (name: string, inputs: unknown[], stamp: string, opts: unknown) => ({ name, n: inputs.length, stamp, opts }))
vi.mock('@/lib/projectReport', () => ({ buildProjectReportModel: (...a: unknown[]) => buildProjectReportModel(...(a as [string, unknown[], string, unknown])) }))
vi.mock('@/lib/projectReportHtml', () => ({ renderProjectReportHtml: (m: { name: string }) => `<html>community:${m.name}</html>` }))
const buildCompareModel = vi.fn(async (name: string, purpose: string, inputs: unknown[], stamp: string, opts: unknown) => ({ name, purpose, n: inputs.length, opts }))
vi.mock('@/lib/projectCompare', () => ({
  buildCompareModel: (...a: unknown[]) => buildCompareModel(...(a as [string, string, unknown[], string, unknown])),
  renderCompareReportHtml: (m: { purpose: string }) => `<html>compare:${m.purpose}</html>`,
}))
// The sampler is driven from the fake's dataset_rows_flat so the shared-theme
// path reads the same rows the own-theme path samples.
const pageSampledRows = vi.fn(async (_svc: unknown, datasetId: string, cap: number, cb: (r: { data: Row }) => void) => {
  const rows = (svc.tables.dataset_rows_flat || []).filter(r => r.dataset_id === datasetId).slice(0, cap)
  for (const r of rows) cb({ data: r.data as Row })
  return rows.length
})
vi.mock('@/lib/bulkRowSample', async () => ({ ...(await vi.importActual<typeof SampleMod>('@/lib/bulkRowSample')), pageSampledRows: (...a: unknown[]) => pageSampledRows(...(a as [unknown, string, number, (r: { data: Row }) => void])) }))

import { loadInputsForDatasets, loadProjectInputs, inferPurpose, buildProjectModelForCollection, buildProjectReportForCollection } from '@/lib/projectReportLoad'

const STUDY = {
  bot: { id: 'abc-123', name: 'Ana' },
  range: { first: '2026-06-01T00:00:00Z', last: '2026-06-20T00:00:00Z', activeDays: 3 },
  focuses: [
    { slug: 'timeline', label: 'Timeline', exchanges: 3, sessions: 2, sentiment: { positive: 2, neutral: 1, negative: 0 }, entities: [], samples: [
      { question: 'When does it start?', answer: '2027.', language: 'en', sentiment: 'positive' },
      { question: 'Phase 2?', answer: '2029.', language: 'en', sentiment: null },
      { question: 'Third question', answer: 'Third answer', language: 'en', sentiment: 'neutral' },
    ] },
    { slug: 'cost', label: 'Cost', exchanges: 1, sessions: 1, sentiment: { positive: 0, neutral: 0, negative: 2 }, entities: [], samples: [] },
  ],
  publicComments: [{ quote: 'We need a crosswalk', focus: 'Access', sentiment: 'negative', sessionId: 's', createdAt: 'x' }],
  entities: [{ name: 'SR 429', mentions: 4, focuses: ['timeline'] }],
  presentation: { overview: 'Ana covers SR 429.', items: [] },
}

const ANALYSIS = {
  executive_summary: 'Residents focused on traffic.', headline: 'Traffic dominates', sentiment_overall: 'mixed',
  sentiment_breakdown: { positive: 2, neutral: 1, negative: 1, mixed: 2 },
  topic_summaries: [{ topic: 'Traffic', qa_count: 2, summary: 'Slow signals.', sentiment: 'negative', representative_exchanges: [{ question: 'Why so slow?', answer: 'Signals.' }, { question: '', answer: '' }, { question: 'Third', answer: 'x' }] }],
  decisions: [], generated_at: '', model: '',
}
const PROCEEDINGS = { overview: 'The team presented the plan.', items: [
  { title: 'Schedule', presenter: 'Jane Doe', what_was_presented: 'Phasing', key_figures: [{ label: 'Miles', value: '12' }], slide_refs: [3, 4] },
  { title: 'Budget', presenter: null, what_was_presented: 'Costs', key_figures: [], slide_refs: [] },
], generated_at: '', model: '' }

function tables(): Record<string, Row[]> {
  return {
    datasets: [
      { id: 'col', source: 'collection', name: 'Tampa competitive set', org_id: 'org-1', row_count: 0, description: null, brand_tag: null },
      { id: 'col-th', source: 'collection', name: 'Kelly Park engagement', org_id: 'org-1', row_count: 0, description: null, brand_tag: null },
      { id: 'col-empty', source: 'collection', name: 'Empty', org_id: 'org-1', row_count: 0, description: null, brand_tag: null },
      { id: 'rec-ds', source: 'recording', name: 'Meeting 2 recording', org_id: 'org-1', row_count: 19, description: null, brand_tag: null },
      { id: 'bot-ds', source: 'bot', name: 'Ana conversations', org_id: 'org-1', row_count: 40, description: 'bot:abc-123', brand_tag: null },
      { id: 'bot-bad', source: 'bot', name: 'Unlinked bot', org_id: 'org-1', row_count: 1, description: 'no link', brand_tag: null },
      { id: 'rev1', source: 'google_reviews', name: 'Cheddars Tampa', org_id: 'org-1', row_count: 3, description: null, brand_tag: 'Cheddars' },
      { id: 'rev2', source: 'google_reviews', name: 'Rival Grill', org_id: 'org-1', row_count: 1, description: null, brand_tag: null },
      { id: 'csat', source: 'study', name: 'CSAT wave 1', org_id: 'org-1', row_count: 0, description: null, brand_tag: null },
    ],
    collections: [{ id: 'c1', dataset_id: 'col', org_id: 'org-1' }, { id: 'c2', dataset_id: 'col-th', org_id: 'org-1' }, { id: 'c3', dataset_id: 'col-empty', org_id: 'org-1' }],
    collection_members: [
      { collection_id: 'c1', dataset_id: 'rev1', label: 'Cheddars', sort_order: 0 },
      { collection_id: 'c1', dataset_id: 'rev2', label: '', sort_order: 1 },
      { collection_id: 'c1', dataset_id: 'csat', label: 'CSAT', sort_order: 2 },
      { collection_id: 'c1', dataset_id: 'ghost', label: 'gone', sort_order: 3 },
      { collection_id: 'c2', dataset_id: 'rec-ds', label: 'Community Meeting #2', sort_order: 0 },
      { collection_id: 'c2', dataset_id: 'bot-ds', label: '', sort_order: 1 },
    ],
    dataset_state: [
      { dataset_id: 'rev1', theme_model: { themes: [{ name: 'Wait Time', keywords: ['wait', 'slow'], count: 7, sentiment: 'negative', avgRating: 2.5 }, { label: 'Service', keywords: ['friendly', 'server'], count: 9, sentiment: 'positive' }] } },
      { dataset_id: 'rev2', theme_model: { themes: [{ name: 'Wait Times', keywords: ['wait', 'slow', 'line'] }, { name: 'nokw', keywords: [] }] } },
      { dataset_id: 'csat', theme_model: null },
    ],
    dataset_rows_flat: [
      { dataset_id: 'rev1', row_index: 0, data: { review_text: 'The wait was slow but our server was friendly', rating: 4, review_date: '2026-05-03', author: 'Ann' } },
      { dataset_id: 'rev1', row_index: 1, data: { review_text: 'short', rating: 2, review_date: '2026-05-20' } },
      { dataset_id: 'rev1', row_index: 2, data: { body: 'Great food, slow wait', rating: '5', date: '2026-06-01', reviewer: 'Bo' } },
      { dataset_id: 'rev2', row_index: 0, data: { review_text: 'long line and slow', rating: 1, review_date: '2026-05-10', sentiment: 'negative' } },
    ],
    recordings: [{ id: 'rec-1', dataset_id: 'rec-ds', name: 'Community Meeting 2', meeting_date: '2026-06-16T00:00:00Z', setup_inputs: { panel: [{ name: 'Jane Doe', role: 'PM' }] }, proceedings_summary: PROCEEDINGS, analysis_summary: ANALYSIS }],
    recording_extractions: [
      { recording_id: 'rec-1', unit_type: 'qa_pair', topic: 'Traffic', sort_order: 1, payload: { question: 'Why is Kelly Park so slow?', answer: 'We are adding signals.', asker_name: 'Bob Smith', panelist_name: 'Jane Doe', question_typology: 'ask', sentiment: 'negative', polished_question: 'Why is Kelly Park traffic so slow?' } },
      { recording_id: 'rec-1', unit_type: 'qa_pair', topic: 'Traffic', sort_order: 0, payload: { question: 'Panel-side question', answer: 'n/a', asker_name: 'Jane Doe', question_typology: 'ask' } },
      { recording_id: 'rec-1', unit_type: 'qa_pair', topic: 'Safety', sort_order: 2, payload: { question: 'The crossing is dangerous', answer: '', asker_name: 'Cy', question_typology: 'commentary', sentiment: 'negative' } },
      { recording_id: 'rec-1', unit_type: 'action_item', topic: null, sort_order: 9, payload: { description: 'Follow up' } },
    ],
  }
}

function rpc(name: string, params: Record<string, unknown>) {
  if (name === 'taxonomy_primary_field') return { data: params.p_dataset_id === 'rev1' ? 'review_text' : null, error: null }
  if (name === 'taxonomy_sub_counts') return { data: params.p_axis === 'touchpoint' ? [{ value: 'wait time', count: 5 }, { value: 'host stand', count: 2 }] : [], error: null }
  if (name === 'taxonomy_group_stats') return { data: params.p_axis === 'touchpoint' ? [{ group_val: 'wait time', avg_val: 2.4 }] : [], error: null }
  return { data: null, error: null }
}

beforeEach(() => {
  svc = makeFakeService({ tables: tables(), rpc })
  getAgentStudy.mockReset().mockImplementation(async (id: string) => (id === 'abc-123' ? STUDY : null))
  buildProjectReportModel.mockClear(); buildCompareModel.mockClear(); pageSampledRows.mockClear()
})

describe('loadInputsForDatasets — per-source loaders', () => {
  it('town hall: community voices only, Q&A vs commentary, presentation from proceedings, themes from topic summaries', async () => {
    const [rec] = await loadInputsForDatasets(['rec-ds'])
    expect(rec.source).toEqual({ id: 'rec-ds', kind: 'town_hall', name: 'Meeting 2 recording', date: '2026-06-16T00:00:00Z', badge: 'Town Hall · Jun 16', rowCount: 19 })
    expect(rec.qa).toEqual([{ question: 'Why is Kelly Park traffic so slow?', answer: 'We are adding signals.', topic: 'Traffic', asker: 'Bob Smith', panelist: 'Jane Doe', sentiment: 'negative', source: 'Town Hall · Jun 16' }])
    expect(rec.commentary).toEqual([{ quote: 'The crossing is dangerous', topic: 'Safety', sentiment: 'negative', speaker: 'Cy', source: 'Town Hall · Jun 16' }])
    expect(rec.sentiment).toEqual({ positive: 2, neutral: 3, negative: 1 })   // mixed folds into neutral
    expect(rec.themes).toEqual([{ label: 'Traffic', count: 2, sentiment: 'negative', avgRating: null, samples: ['Why so slow?', 'Third'] }])
    expect(rec.presentation).toEqual({ overview: 'The team presented the plan.', items: [
      { title: 'Schedule', attribution: 'Jane Doe', body: 'Phasing', figures: [{ label: 'Miles', value: '12' }], refs: 'Slides 3, 4' },
      { title: 'Budget', attribution: null, body: 'Costs', figures: [], refs: null },
    ] })
    expect(rec.dimensions).toEqual([]); expect(rec.entities).toEqual([])
  })

  it('agent: study focuses become Q&A + themes, public comments become commentary, entities pass through', async () => {
    const [bot] = await loadInputsForDatasets(['bot-ds'])
    expect(getAgentStudy).toHaveBeenCalledWith('abc-123')
    expect(bot.source).toEqual({ id: 'bot-ds', kind: 'agent', name: 'Ana conversations', date: '2026-06-20T00:00:00Z', badge: 'via Ana', rowCount: 40 })
    expect(bot.qa).toHaveLength(3)
    expect(bot.qa[0]).toEqual({ question: 'When does it start?', answer: '2027.', topic: 'Timeline', asker: null, panelist: null, sentiment: 'positive', source: 'via Ana' })
    expect(bot.commentary).toEqual([{ quote: 'We need a crosswalk', topic: 'Access', sentiment: 'negative', speaker: null, source: 'via Ana' }])
    expect(bot.sentiment).toEqual({ positive: 2, neutral: 1, negative: 2 })
    expect(bot.themes).toEqual([
      { label: 'Timeline', count: 3, sentiment: 'positive', avgRating: null, samples: ['When does it start?', 'Phase 2?'] },
      { label: 'Cost', count: 1, sentiment: 'negative', avgRating: null, samples: [] },
    ])
    expect(bot.entities).toEqual([{ name: 'SR 429', mentions: 4 }])
    expect(bot.presentation).toEqual(STUDY.presentation)
  })

  it('reviews (own themes): theme_model rows, a verbatim sample ≥8 chars, sentiment weighted by theme counts, Dimensions from the taxonomy RPCs', async () => {
    const [rev] = await loadInputsForDatasets(['rev1'])
    expect(rev.source).toMatchObject({ kind: 'reviews', name: 'Cheddars', badge: 'Cheddars', date: null, rowCount: 3 })
    expect(rev.themes).toEqual([
      { label: 'Wait Time', count: 7, sentiment: 'negative', avgRating: 2.5, samples: ['wait', 'slow'] },
      { label: 'Service', count: 9, sentiment: 'positive', avgRating: null, samples: ['friendly', 'server'] },
    ])
    expect(rev.commentary.map(c => [c.quote, c.speaker])).toEqual([['The wait was slow but our server was friendly', 'Ann'], ['Great food, slow wait', 'Bo']])
    expect(rev.sentiment).toEqual({ positive: 9, neutral: 0, negative: 7 })
    expect(rev.dimensions.map(d => [d.label.replace(/^.*: /, ''), d.count, d.sentiment, d.avgRating])).toEqual([['Wait Time', 5, 'negative', 2.4], ['Host Stand', 2, 'neutral', null]])
    expect(rev.monthlyRatings).toBeUndefined()
  })

  it('CSAT without a theme model → survey kind, no themes, no dimensions; unlinked bots and unknown ids are skipped', async () => {
    const out = await loadInputsForDatasets(['csat', 'bot-bad', 'nope'])
    expect(out).toHaveLength(1)
    expect(out[0].source.kind).toBe('survey')
    expect(out[0].themes).toEqual([]); expect(out[0].dimensions).toEqual([])
    expect(out[0].sentiment).toEqual({ positive: 0, neutral: 0, negative: 0 })
    expect(getAgentStudy).not.toHaveBeenCalled()
  })

  it('a recording member with no recordings row loads as null (skipped)', async () => {
    svc.tables.recordings = []
    expect(await loadInputsForDatasets(['rec-ds'])).toEqual([])
  })
})

describe('loadProjectInputs — collection with shared themes', () => {
  it('scores every generic member against the collection’s own theme set, with commentary + monthly ratings from the sampled rows', async () => {
    svc.tables.dataset_state.push({ dataset_id: 'col', theme_model: { themes: [{ id: 't1', name: 'Wait', keywords: ['wait', 'slow'] }, { id: 't2', name: 'NoKw', keywords: [] }] } })
    const loaded = (await loadProjectInputs('col'))!
    expect(loaded.name).toBe('Tampa competitive set')
    expect(loaded.inputs.map(i => i.source.name)).toEqual(['Cheddars', 'Rival Grill', 'CSAT'])   // ghost member skipped; empty label → dataset name; brand_tag wins
    const [rev1, rev2, csat] = loaded.inputs
    expect(rev1.themes).toEqual([{ label: 'Wait', count: 2, sentiment: 'positive', avgRating: 4.5, samples: [] }])   // rows 1 + 3 match; ratings 4 and 5
    expect(rev1.monthlyRatings).toEqual([{ ym: '2026-05', sum: 6, n: 2 }, { ym: '2026-06', sum: 5, n: 1 }])
    expect(rev1.commentary.map(c => c.quote)).toEqual(['The wait was slow but our server was friendly', 'Great food, slow wait'])
    expect(rev2.themes).toEqual([{ label: 'Wait', count: 1, sentiment: 'negative', avgRating: 1, samples: [] }])
    expect(rev2.commentary[0]).toMatchObject({ sentiment: 'negative', source: 'Rival Grill' })
    expect(csat.themes).toEqual([{ label: 'Wait', count: 0, sentiment: 'neutral', avgRating: null, samples: [] }])
    expect(csat.monthlyRatings).toBeUndefined()   // only review inputs carry the trend substrate
    expect(pageSampledRows).toHaveBeenCalledTimes(3)
  })

  it('without a collection theme set, members’ own themes are clustered into one shared set so labels align', async () => {
    const loaded = (await loadProjectInputs('col'))!
    const labels = (i: number) => loaded.inputs[i].themes.map(t => t.label)
    expect(labels(0)).toEqual(['Wait Time', 'Service'])   // 'Wait Times' (rev2) merged into the shorter 'Wait Time' on keyword overlap
    expect(labels(1)).toEqual(labels(0))
    expect(labels(2)).toEqual(labels(0))
    expect(loaded.inputs[1].themes[0]).toMatchObject({ count: 1, avgRating: 1, sentiment: 'negative' })
  })

  it('a sampler failure degrades to empty rows, not a thrown report', async () => {
    svc.tables.dataset_state.push({ dataset_id: 'col', theme_model: { themes: [{ id: 't1', name: 'Wait', keywords: ['wait'] }] } })
    pageSampledRows.mockRejectedValue(new Error('57014'))
    const loaded = (await loadProjectInputs('col'))!
    expect(loaded.inputs[0].themes[0].count).toBe(0)
    expect(loaded.inputs[0].commentary).toEqual([])
  })

  it('town-hall + agent members load through their own loaders; missing collection → null; no members → empty inputs', async () => {
    const th = (await loadProjectInputs('col-th'))!
    expect(th.inputs.map(i => [i.source.kind, i.source.name])).toEqual([['town_hall', 'Community Meeting #2'], ['agent', 'Ana conversations']])
    expect(await loadProjectInputs('nope')).toBeNull()
    svc.tables.collections = svc.tables.collections.filter(c => c.id !== 'c2')
    expect(await loadProjectInputs('col-th')).toBeNull()
    expect(await loadProjectInputs('col-empty')).toEqual({ name: 'Empty', inputs: [] })
  })
})

describe('inferPurpose', () => {
  it('community only when every input is a town hall or agent', async () => {
    const th = (await loadProjectInputs('col-th'))!
    expect(inferPurpose(th.inputs)).toBe('community')
    const mixed = (await loadProjectInputs('col'))!
    expect(inferPurpose(mixed.inputs)).toBe('competitive')
    expect(inferPurpose([])).toBe('community')
  })
})

describe('buildProjectModelForCollection — tenancy + dispatch', () => {
  const me = { orgId: 'org-1', isAdmin: false }
  it('404 unknown, 400 not a collection, 404 other org (non-admin), admin crosses orgs, 409 when nothing analyzable', async () => {
    expect(await buildProjectModelForCollection('nope', me)).toEqual({ ok: false, status: 404, error: 'Not found' })
    expect(await buildProjectModelForCollection('rev1', me)).toEqual({ ok: false, status: 400, error: 'Not a collection' })
    expect(await buildProjectModelForCollection('col', { orgId: 'org-2', isAdmin: false })).toEqual({ ok: false, status: 404, error: 'Not found' })
    expect((await buildProjectModelForCollection('col', { orgId: 'org-2', isAdmin: true })).ok).toBe(true)
    const empty = await buildProjectModelForCollection('col-empty', me)
    expect(empty).toMatchObject({ ok: false, status: 409 })
  })
  it('community collections build the community model; review collections default to competitive with the primary passed through', async () => {
    const th = await buildProjectModelForCollection('col-th', me)
    expect(th).toMatchObject({ ok: true, purpose: 'community', kind: 'community', name: 'Kelly Park engagement' })
    expect(buildProjectReportModel).toHaveBeenCalledWith('Kelly Park engagement', expect.any(Array), expect.any(String), { synthesize: true, orgId: 'org-1' })
    const cmp = await buildProjectModelForCollection('col', me, undefined, 'rev2')
    expect(cmp).toMatchObject({ ok: true, purpose: 'competitive', kind: 'compare' })
    expect(buildCompareModel).toHaveBeenCalledWith('Tampa competitive set', 'competitive', expect.any(Array), expect.any(String), { synthesize: true, primaryId: 'rev2', orgId: 'org-1' })
    const b360 = await buildProjectModelForCollection('col', me, 'brand_360')
    expect(b360).toMatchObject({ ok: true, purpose: 'brand_360', kind: 'compare' })
  })
  it('buildProjectReportForCollection renders the matching HTML and passes failures through', async () => {
    expect(await buildProjectReportForCollection('col-th', me)).toEqual({ ok: true, name: 'Kelly Park engagement', purpose: 'community', html: '<html>community:Kelly Park engagement</html>' })
    expect(await buildProjectReportForCollection('col', me)).toEqual({ ok: true, name: 'Tampa competitive set', purpose: 'competitive', html: '<html>compare:competitive</html>' })
    expect(await buildProjectReportForCollection('nope', me)).toEqual({ ok: false, status: 404, error: 'Not found' })
  })
})
