// lib/entityDiscovery.ts — the write side of the entity catalog: sample the
// scope's open-ended text, NER it in batches, canonicalise near-duplicates,
// merge into entity_catalog (never overwriting curation or resurfacing hidden
// rows), and log the run. Scope resolution and field eligibility run REAL over
// the fake Supabase; only the model calls and the mention-count store are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeService, type FakeService, type Row } from '../helpers/fakeSupabase'
import type * as EntityFilterMod from '@/lib/entityFilter'

const callAI = vi.fn()
vi.mock('@/lib/ai', () => ({ callAI: (...a: unknown[]) => callAI(...a) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(), errMessage: (e: unknown) => String(e) }))
const storeEntityMentionCounts = vi.fn(async () => {})
vi.mock('@/lib/entityFilter', async () => ({ ...(await vi.importActual<typeof EntityFilterMod>('@/lib/entityFilter')), storeEntityMentionCounts: (...a: unknown[]) => storeEntityMentionCounts(...(a as [])) }))

import { discoverEntities } from '@/lib/entityDiscovery'

let svc: FakeService
const SCHEMA = { fields: [
  { field: 'review_text', type: 'open-ended' },
  { field: 'notes', type: 'open-ended', entityExtraction: false },
  { field: 'city', type: 'categorical', values: ['Tampa', 'Orlando', 'X'] },
] }
function rows(n: number, ds = 'ds1'): Row[] {
  return Array.from({ length: n }, (_, i) => ({ dataset_id: ds, row_index: i, data: { review_text: `Review ${i}: the Filet was superb and our server Maria was great`, notes: 'never sampled', city: 'Tampa' } }))
}
function tables(): Record<string, Row[]> {
  return {
    datasets: [{ id: 'ds1', source: 'google_reviews', org_id: 'org-1', brand_collection_id: null, row_count: 4, brand_tag: 'Cheddars' }],
    dataset_state: [{ dataset_id: 'ds1', schema_config: SCHEMA }],
    dataset_rows_flat: rows(4),
    entity_catalog: [
      { scope_type: 'dataset', scope_id: 'ds1', slug: 'filet_mignon', canonical: 'Filet Mignon', category: 'food', aliases: ['filet'], sample_count: 3, source: 'review', hidden: false, provenance: { review: { count: 3, refs: [] } } },
      { scope_type: 'dataset', scope_id: 'ds1', slug: 'maria', canonical: 'Maria', category: 'person', aliases: [], sample_count: 1, source: 'manual', hidden: false, provenance: {} },
      { scope_type: 'dataset', scope_id: 'ds1', slug: 'old_fashioned', canonical: 'Old Fashioned', category: 'drink', aliases: [], sample_count: 2, source: 'review', hidden: true, provenance: {} },
    ],
    entity_catalog_refresh: [],
  }
}

const NER = [
  { canonical: 'Filet', category: 'food', aliases: ['the filet', ' FILET '] },
  { canonical: 'Maria', category: 'person', aliases: ['maria'] },
  { canonical: 'Old Fashioned', category: 'drink', aliases: [] },
  { canonical: 'Tysons Corner', category: 'PLACE', aliases: ['tysons'] },
  { canonical: 'x', category: 'food' },                    // too short → dropped
  { canonical: 'Yelp', category: 'weird', aliases: 7 },     // unknown category → other; bad aliases → []
  null,
]
function routeAI(over: { nerText?: (batch: number) => string; canonText?: string } = {}) {
  let nerCalls = 0
  callAI.mockImplementation(async (opts: { system: string; messages: { content: string }[] }) => {
    const usage = { input_tokens: 300_000, output_tokens: 20_000 }   // large enough that the cents estimate does not round to 0
    if (opts.messages[0].content.startsWith('Extract NAMED ENTITIES')) {
      const b = nerCalls++
      return { text: over.nerText ? over.nerText(b) : 'Sure! ' + JSON.stringify({ entities: NER }) + ' done', usage }
    }
    if (opts.messages[0].content.includes('normalising a list')) {
      return { text: over.canonText ?? JSON.stringify({ 'Filet': { canonical: 'Filet Mignon', category: 'food' }, 'tysons corner': { canonical: 'Tysons Corner', category: 'place' }, 'Yelp': { canonical: 'Yelp Inc', category: 'brand' } }), usage }
    }
    throw new Error('unexpected AI call')
  })
}

beforeEach(() => { svc = makeFakeService({ tables: tables() }); callAI.mockReset(); storeEntityMentionCounts.mockClear(); routeAI() })

describe('discoverEntities', () => {
  it('throws for an unknown dataset', async () => {
    await expect(discoverEntities({ service: svc as never, datasetId: 'nope', mode: 'manual' })).rejects.toThrow('Dataset not found')
  })

  it('no eligible open-ended field → logged as an empty run with a user-facing hint, nothing extracted', async () => {
    svc.tables.dataset_state = [{ dataset_id: 'ds1', schema_config: { fields: [{ field: 'city', type: 'categorical' }] } }]
    const r = await discoverEntities({ service: svc as never, datasetId: 'ds1', mode: 'manual' })
    expect(r).toMatchObject({ scope_type: 'dataset', scope_id: 'ds1', mode: 'manual', sample_size: 0, entities_before: 3, entities_after: 3, entities_new: 0, cost_est_cents: 0 })
    expect(r.error).toMatch(/open-ended field is enabled for entity extraction/)
    expect(callAI).not.toHaveBeenCalled()
    const refresh = svc.writesTo('entity_catalog_refresh')
    expect(refresh).toHaveLength(1)
    expect(refresh[0].payload).toMatchObject({ scope_type: 'dataset', scope_id: 'ds1', triggered_by: 'manual', sample_size: 0, entities_before: 3, entities_after: 3, entities_new: 0 })
  })

  it('samples only eligible fields, NERs, canonicalises, and merges — curated rows untouched, hidden rows left alone, aliases unioned', async () => {
    const r = await discoverEntities({ service: svc as never, datasetId: 'ds1', mode: 'manual', triggeredByUser: 'user-1' })
    expect(r).toMatchObject({ sample_size: 4, datasets_sampled: ['ds1'], entities_before: 3, entities_new: 2, entities_after: 5, error: null })
    expect(r.cost_est_cents).toBeGreaterThan(0)
    // NER prompt: the brand is a "do not extract" subject; the opted-out field never reaches the model
    const nerPrompt = (callAI.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content
    expect(nerPrompt).toContain('customer reviews ABOUT: Cheddars')
    expect(nerPrompt).toContain('[1] Review 0: the Filet was superb')
    expect(nerPrompt).not.toContain('never sampled')
    expect(nerPrompt).not.toContain('DO NOT extract entities of these categories')
    // usage attributed to the org and dataset
    expect((callAI.mock.calls[0][0] as { usage: unknown }).usage).toEqual({ org_id: 'org-1', resource_type: 'dataset', resource_id: 'ds1', event_type: 'entity_discovery' })

    const up = svc.writesTo('entity_catalog')
    expect(up).toHaveLength(1)
    const payload = up[0].payload as Row[]
    const bySlug = Object.fromEntries(payload.map(p => [p.slug as string, p]))
    expect(Object.keys(bySlug).sort()).toEqual(['filet_mignon', 'tysons_corner', 'yelp_inc'])
    // existing discovered row: canonical kept (first-wins), aliases unioned + the pre-merge name, counts accumulate, provenance grows
    expect(bySlug.filet_mignon).toMatchObject({ scope_type: 'dataset', scope_id: 'ds1', canonical: 'Filet Mignon', category: 'food', sample_count: 4, source: 'review', hidden: false })
    expect((bySlug.filet_mignon.aliases as string[]).sort()).toEqual(['filet', 'the filet'])
    expect(bySlug.filet_mignon.provenance).toMatchObject({ review: { count: 4, refs: [{ dataset_id: 'ds1' }] } })
    // new rows carry the run's source kind (google_reviews → review) and the normalised category
    expect(bySlug.tysons_corner).toMatchObject({ canonical: 'Tysons Corner', category: 'place', aliases: ['tysons'], sample_count: 1, source: 'review' })
    expect(bySlug.yelp_inc).toMatchObject({ canonical: 'Yelp Inc', category: 'brand', sample_count: 1 })
    expect((bySlug.yelp_inc.aliases as string[])).toEqual(['yelp'])   // the pre-merge canonical is kept as an alias so FTS still hits it
    // manual + hidden rows never enter the upsert
    expect(bySlug.maria).toBeUndefined(); expect(bySlug.old_fashioned).toBeUndefined()
    // run logged, mention counts refreshed
    const refresh = svc.writesTo('entity_catalog_refresh')[0].payload as Row
    expect(refresh).toMatchObject({ triggered_by: 'manual', triggered_by_user: 'user-1', sample_size: 4, entities_before: 3, entities_after: 5, entities_new: 2, error: null })
    expect(storeEntityMentionCounts).toHaveBeenCalledWith(svc, 'ds1')
  })

  it('autoExcludeFromCurated: a category with enough manual rows is excluded from the prompt and dropped on return', async () => {
    const r = await discoverEntities({ service: svc as never, datasetId: 'ds1', mode: 'cron', autoExcludeFromCurated: true, autoExcludeThreshold: 1 })
    const nerPrompt = (callAI.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content
    expect(nerPrompt).toContain('DO NOT extract entities of these categories')
    expect(nerPrompt).toMatch(/\n- person\n/)
    expect(r.entities_new).toBe(2)
    const slugs = (svc.writesTo('entity_catalog')[0].payload as Row[]).map(p => p.slug)
    expect(slugs).not.toContain('maria')
  })

  it('every NER batch failing surfaces the error and logs the failed run', async () => {
    callAI.mockImplementation(async () => { throw new Error('provider down') })
    await expect(discoverEntities({ service: svc as never, datasetId: 'ds1', mode: 'manual' })).rejects.toThrow('provider down')
    const refresh = svc.writesTo('entity_catalog_refresh')[0].payload as Row
    expect(refresh).toMatchObject({ error: 'provider down', sample_size: 4 })
    expect(svc.writesTo('entity_catalog')).toHaveLength(0)
  })

  it('a partial batch failure still merges what came back and records "N of M batches failed"; canonicalisation garbage keeps identities', async () => {
    svc.tables.datasets[0].row_count = 30
    svc.tables.dataset_rows_flat = rows(30)
    routeAI({ nerText: (b) => { if (b === 1) throw new Error('timeout'); return JSON.stringify({ entities: NER.slice(0, 1) }) }, canonText: '<<not json>>' })
    const r = await discoverEntities({ service: svc as never, datasetId: 'ds1', mode: 'incremental', sampleSize: 60 })
    expect(r.sample_size).toBe(30)
    expect(r.error).toBe('1 of 2 NER batches failed')
    const payload = svc.writesTo('entity_catalog')[0].payload as Row[]
    expect(payload.map(p => p.slug)).toEqual(['filet'])          // identity canonical, no merge into filet_mignon
    expect(r.entities_new).toBe(1)
  })

  it('above the per-dataset sample the rows are picked by random row_index; sampleDatasetIds overrides the scope', async () => {
    svc.tables.datasets[0].row_count = 100
    svc.tables.dataset_rows_flat = rows(100)
    const r = await discoverEntities({ service: svc as never, datasetId: 'ds1', mode: 'manual', sampleSize: 25, sampleDatasetIds: ['ds1'] })
    expect(r.sample_size).toBeGreaterThan(0)
    expect(r.sample_size).toBeLessThanOrEqual(25)
  })

  it('a collection-scoped dataset resolves to the collection and samples every member; the run source kind is the lowest-authority member', async () => {
    svc.tables.datasets = [
      { id: 'colds', source: 'collection', org_id: 'org-1', brand_collection_id: null, row_count: 0, brand_tag: null },
      { id: 'up', source: 'upload', org_id: 'org-1', brand_collection_id: null, row_count: 2, brand_tag: null },
      { id: 'rv', source: 'google_reviews', org_id: 'org-1', brand_collection_id: null, row_count: 2, brand_tag: 'Rival' },
    ]
    svc.tables.collections = [{ id: 'c1', dataset_id: 'colds', org_id: 'org-1' }]
    svc.tables.collection_members = [{ collection_id: 'c1', dataset_id: 'up' }, { collection_id: 'c1', dataset_id: 'rv' }]
    svc.tables.dataset_state = [{ dataset_id: 'up', schema_config: SCHEMA }, { dataset_id: 'rv', schema_config: SCHEMA }]
    svc.tables.dataset_rows_flat = [...rows(2, 'up'), ...rows(2, 'rv')]
    svc.tables.entity_catalog = []
    const r = await discoverEntities({ service: svc as never, datasetId: 'colds', mode: 'manual' })
    expect(r).toMatchObject({ scope_type: 'collection', scope_id: 'c1', datasets_sampled: ['up', 'rv'], sample_size: 4, entities_before: 0 })
    const payload = svc.writesTo('entity_catalog')[0].payload as Row[]
    expect(payload.every(p => p.scope_type === 'collection' && p.scope_id === 'c1' && p.source === 'review')).toBe(true)   // review < document
  })

  it('an upsert failure logs the run and throws', async () => {
    svc.errors.entity_catalog = { message: 'permission denied' }
    await expect(discoverEntities({ service: svc as never, datasetId: 'ds1', mode: 'manual' })).rejects.toThrow('entity_catalog upsert failed: permission denied')
    expect((svc.writesTo('entity_catalog_refresh')[0].payload as Row).error).toBe('permission denied')
  })
})
