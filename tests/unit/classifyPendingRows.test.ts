import { describe, it, expect } from 'vitest'
import { classifyPendingRows } from '@/lib/taxonomyClassify'

// Minimal mock of the Supabase service: rpc() yields successive pending-row
// pages; from().upsert() captures what would be written.
function mockService(pages: Array<Array<{ id: number; data: any }>>) {
  let call = 0
  const upserted: any[] = []
  const service: any = {
    rpc: async (_name: string, _args: any) => {
      const page = pages[call] ?? []
      call++
      return { data: page, error: null }
    },
    from: (_t: string) => ({
      upsert: async (rows: any[], _o: any) => { upserted.push(...rows); return { error: null } },
    }),
  }
  return { service, upserted, rpcCalls: () => call }
}

const ROW = (id: number, text: string) => ({ id, data: { review_text: text } })

describe('classifyPendingRows (auto-classify safety net)', () => {
  it('classifies a drained page and stops', async () => {
    const { service, upserted } = mockService([
      [ROW(1, 'The ribeye steak was overcooked and the manager was rude'), ROW(2, 'great service, loved the wine')],
      [], // drained
    ])
    const r = await classifyPendingRows({ service, datasetId: 'd', orgId: 'o', maxRows: 10000 })
    expect(r.classified).toBe(2)
    expect(r.hasMore).toBe(false)
    expect(upserted).toHaveLength(2)
    // upsert rows carry the right shape + real keyword assertions
    expect(upserted[0]).toMatchObject({ dataset_id: 'd', org_id: 'o', row_id: 1, classified_by: 'keyword' })
    expect(Array.isArray(upserted[0].assertions)).toBe(true)
    expect(upserted[0].assertions.length).toBeGreaterThan(0) // steak/manager/etc fire
    expect(upserted[0]).toHaveProperty('axis_product')
  })

  it('respects the maxRows cap and reports hasMore', async () => {
    // maxRows=2 → first (and only) page is limited to 2; full page → cap hit
    const { service, upserted } = mockService([[ROW(1, 'steak'), ROW(2, 'service')]])
    const r = await classifyPendingRows({ service, datasetId: 'd', orgId: 'o', maxRows: 2 })
    expect(r.classified).toBe(2)
    expect(r.hasMore).toBe(true)
    expect(upserted).toHaveLength(2)
  })

  it('no pending rows → no work', async () => {
    const { service, upserted } = mockService([[]])
    const r = await classifyPendingRows({ service, datasetId: 'd', orgId: 'o' })
    expect(r.classified).toBe(0)
    expect(r.hasMore).toBe(false)
    expect(upserted).toHaveLength(0)
  })
})
