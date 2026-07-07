import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyPendingRows } from '@/lib/taxonomyClassify'
import type { TaxonomyFieldBlock } from '@/lib/taxonomyEmbed'
import type { StoredTaxonomy } from '@/lib/taxonomyRollup'

// Shapes of the RPC argument payloads the mock service inspects.
type RpcArgs = {
  p_field_key?: string
  p_items?: { id: number; tx: TaxonomyFieldBlock }[]
  p_patch?: { taxonomy: StoredTaxonomy }
}

// Minimal mock of the Supabase service for the embed write path (sql/151):
//   - rpc('dataset_rows_pending_field_taxonomy') yields successive pending pages
//   - rpc('apply_taxonomy_verdicts') captures the embedded {id, tx} items
//   - the end-of-run rollup refresh reads back the embedded verdicts
//     (taxonomy_rows_for_field), the rating stats, the current stored rollup,
//     and merges the new one (merge_dataset_analytics) — all mocked here.
function mockService(pages: Array<Array<{ id: number; data: Record<string, unknown> }>>) {
  let pendingCall = 0
  const applied: { fieldKey: string; items: { id: number; tx: TaxonomyFieldBlock }[] }[] = []
  const merged: { taxonomy: StoredTaxonomy }[] = []
  let rollupServed = false
  const service = {
    rpc: async (name: string, args: RpcArgs) => {
      if (name === 'dataset_rows_pending_field_taxonomy') {
        const page = pages[pendingCall] ?? []
        pendingCall++
        return { data: page, error: null }
      }
      if (name === 'apply_taxonomy_verdicts') {
        applied.push({ fieldKey: args.p_field_key!, items: args.p_items! })
        return { data: args.p_items!.length, error: null }
      }
      if (name === 'taxonomy_rows_for_field') {
        // Serve back everything embedded so far, once (single page).
        if (rollupServed) return { data: [], error: null }
        rollupServed = true
        return {
          data: applied.flatMap(a => a.items.map(i => ({ row_id: i.id, tx: i.tx, rating_val: null, date_val: null }))),
          error: null,
        }
      }
      if (name === 'numeric_field_stats') return { data: [], error: null }
      if (name === 'merge_dataset_analytics') { merged.push(args.p_patch!); return { data: null, error: null } }
      throw new Error(`unexpected rpc ${name}`)
    },
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: t === 'dataset_state' ? { schema_config: null, analytics: {} } : null, error: null }),
        }),
      }),
    }),
  }
  return { service: service as unknown as SupabaseClient, applied, merged }
}

const ROW = (id: number, text: string) => ({ id, data: { review_text: text } })

describe('classifyPendingRows (auto-classify safety net, embed path)', () => {
  it('classifies a drained page, embeds field blocks, and stores the rollup', async () => {
    const { service, applied, merged } = mockService([
      [ROW(1, 'The ribeye steak was overcooked and the manager was rude'), ROW(2, 'great service, loved the wine')],
      [], // drained
    ])
    const r = await classifyPendingRows({ service, datasetId: 'd', orgId: 'o', textFields: ['review_text'], maxRows: 10000 })
    expect(r.classified).toBe(2)
    expect(r.hasMore).toBe(false)

    // One embed batch under the field key, one item per row.
    const items = applied.flatMap(a => a.items)
    expect(applied.every(a => a.fieldKey === 'review_text')).toBe(true)
    expect(items).toHaveLength(2)

    // The block carries real keyword assertions + the axes projection + meta.
    const block = items.find(i => i.id === 1)!.tx
    expect(Array.isArray(block.as)).toBe(true)
    expect(block.as.length).toBeGreaterThan(0)       // steak/manager/etc fire
    expect(block.a.product).toContain('steak')
    expect(block.by).toBe('keyword')
    expect(block.v).toBeTruthy()

    // Drained run → the stored rollup was refreshed for this field key.
    expect(merged).toHaveLength(1)
    const stored = merged[0].taxonomy.fields['review_text']
    expect(stored.selFields).toEqual(['review_text'])
    expect(stored.rollup.classifiedRows).toBe(2)
    expect(stored.rollup.subs.some(s => s.axis === 'product' && s.sub === 'steak')).toBe(true)
  })

  it('respects the maxRows cap, reports hasMore, and defers the rollup', async () => {
    // maxRows=2 → first (and only) page is limited to 2; full page → cap hit
    const { service, applied, merged } = mockService([[ROW(1, 'steak'), ROW(2, 'service')]])
    const r = await classifyPendingRows({ service, datasetId: 'd', orgId: 'o', textFields: ['review_text'], maxRows: 2 })
    expect(r.classified).toBe(2)
    expect(r.hasMore).toBe(true)
    expect(applied.flatMap(a => a.items)).toHaveLength(2)
    // hasMore → rollup refresh waits for the drain-completing call.
    expect(merged).toHaveLength(0)
  })

  it('no pending rows → no work, no rollup write', async () => {
    const { service, applied, merged } = mockService([[]])
    const r = await classifyPendingRows({ service, datasetId: 'd', orgId: 'o', textFields: ['review_text'] })
    expect(r.classified).toBe(0)
    expect(r.hasMore).toBe(false)
    expect(applied).toHaveLength(0)
    expect(merged).toHaveLength(0)
  })

  it('multi-field selection embeds under the combined key with both texts', async () => {
    const { service, applied, merged } = mockService([
      [{ id: 7, data: { liked: 'the steak was perfect', disliked: 'the music was too loud' } }],
      [],
    ])
    await classifyPendingRows({ service, datasetId: 'd', orgId: 'o', textFields: ['liked', 'disliked'] })
    expect(applied[0].fieldKey).toBe('disliked + liked')  // sorted combined key
    const block = applied[0].items[0].tx
    const subs = block.as.map(a => a.sub)
    expect(subs).toContain('steak')   // from `liked`
    expect(subs).toContain('noise')   // from `disliked`
    expect(merged[0].taxonomy.fields['disliked + liked'].selFields).toEqual(['liked', 'disliked'])
  })
})
