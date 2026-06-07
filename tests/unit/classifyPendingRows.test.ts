import { describe, it, expect } from 'vitest'
import { classifyPendingRows } from '@/lib/taxonomyClassify'

// Minimal mock of the Supabase service: rpc() yields successive pending-row
// pages; from(table).upsert() captures what would be written, per table.
// classifyPendingRows dual-writes: the legacy `dataset_row_taxonomy` (base rows,
// no `field`) AND the per-field `dataset_row_field_taxonomy` (base + `field`).
function mockService(pages: Array<Array<{ id: number; data: any }>>) {
  let call = 0
  const byTable: Record<string, any[]> = {}
  const service: any = {
    rpc: async (_name: string, _args: any) => {
      const page = pages[call] ?? []
      call++
      return { data: page, error: null }
    },
    from: (t: string) => ({
      upsert: async (rows: any[], _o: any) => { (byTable[t] ??= []).push(...rows); return { error: null } },
    }),
  }
  return { service, byTable, rpcCalls: () => call }
}

const ROW = (id: number, text: string) => ({ id, data: { review_text: text } })

describe('classifyPendingRows (auto-classify safety net)', () => {
  it('classifies a drained page, dual-writes both tables, and stops', async () => {
    const { service, byTable } = mockService([
      [ROW(1, 'The ribeye steak was overcooked and the manager was rude'), ROW(2, 'great service, loved the wine')],
      [], // drained
    ])
    const r = await classifyPendingRows({ service, datasetId: 'd', orgId: 'o', textFields: ['review_text'], maxRows: 10000 })
    expect(r.classified).toBe(2)
    expect(r.hasMore).toBe(false)

    const legacy = byTable['dataset_row_taxonomy'] ?? []
    const perField = byTable['dataset_row_field_taxonomy'] ?? []
    expect(legacy).toHaveLength(2)
    expect(perField).toHaveLength(2)

    // Legacy rows carry the base shape + real keyword assertions, and NO field.
    expect(legacy[0]).toMatchObject({ dataset_id: 'd', org_id: 'o', row_id: 1, classified_by: 'keyword' })
    expect(legacy[0]).not.toHaveProperty('field')
    expect(Array.isArray(legacy[0].assertions)).toBe(true)
    expect(legacy[0].assertions.length).toBeGreaterThan(0) // steak/manager/etc fire
    expect(legacy[0]).toHaveProperty('axis_product')

    // Per-field rows are the same base + the field they were derived from.
    expect(perField[0]).toMatchObject({ row_id: 1, field: 'review_text' })
  })

  it('respects the maxRows cap and reports hasMore', async () => {
    // maxRows=2 → first (and only) page is limited to 2; full page → cap hit
    const { service, byTable } = mockService([[ROW(1, 'steak'), ROW(2, 'service')]])
    const r = await classifyPendingRows({ service, datasetId: 'd', orgId: 'o', textFields: ['review_text'], maxRows: 2 })
    expect(r.classified).toBe(2)
    expect(r.hasMore).toBe(true)
    expect(byTable['dataset_row_taxonomy']).toHaveLength(2)
    expect(byTable['dataset_row_field_taxonomy']).toHaveLength(2)
  })

  it('no pending rows → no work', async () => {
    const { service, byTable } = mockService([[]])
    const r = await classifyPendingRows({ service, datasetId: 'd', orgId: 'o', textFields: ['review_text'] })
    expect(r.classified).toBe(0)
    expect(r.hasMore).toBe(false)
    expect(byTable['dataset_row_taxonomy'] ?? []).toHaveLength(0)
    expect(byTable['dataset_row_field_taxonomy'] ?? []).toHaveLength(0)
  })
})
