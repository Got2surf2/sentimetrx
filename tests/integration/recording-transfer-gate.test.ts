// tests/integration/recording-transfer-gate.test.ts
//
// Cross-org transfer gate on PATCH /api/recordings/[id]. Moving a recording
// across tenants is platform-admin-only and must run the atomic
// transfer_recording_org RPC + write an org_transfers audit row. We assert:
//   1. a non-platform-admin caller with { org_id } in the body → 403 (no RPC).
//   2. a platform-admin caller → the RPC fires with (recording, from, to) and
//      the transfer is audit-logged.
//   3. a plain rename (no org_id) never touches the transfer path.
//
// The deep data-isolation proof (old org can't read the moved rows) is covered
// by the env-gated cross-org-egress suite once sql/102 is applied; here we lock
// the route's authorization + orchestration with mocks.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  caller: { userId: 'u1', orgId: 'orgA', isAdminOrg: true, isAdmin: true, userEmail: 'a@x.io' } as any,
  recOrg: 'orgA',
  recOwner: 'u1',
}

const rpcCalls: Array<{ name: string; args: any }> = []
const moveCalls: Array<[string, string]> = []

vi.mock('@/lib/userContext', () => ({ getUserContext: async () => ctx.caller }))

vi.mock('@/lib/orgTransfer', () => ({
  checkTransferTarget: vi.fn(async () => ({ ok: true, toOrg: { id: 'orgB', name: 'B', status: 'active' } })),
  recordOrgTransfer: vi.fn(async () => {}),
}))

vi.mock('@/lib/supabase/server', () => {
  const builder = (table: string): any => {
    const row =
      table === 'recordings'
        ? { id: 'rec_1', org_id: ctx.recOrg, created_by: ctx.recOwner, name: 'Town Hall', dataset_id: 'ds_1' }
        : { id: 'x', org_id: ctx.recOrg }
    const b: any = {}
    for (const m of ['select', 'eq', 'order', 'in', 'update']) b[m] = () => b
    b.single = async () => ({ data: row, error: null })
    b.maybeSingle = async () => ({ data: row, error: null })
    // recording_files list read in transferRecordingOrg resolves to [] (no files).
    b.then = (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej)
    return b
  }
  const service = {
    from: (t: string) => builder(t),
    rpc: async (name: string, args: any) => { rpcCalls.push({ name, args }); return { error: null } },
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        move: async (a: string, bdst: string) => { moveCalls.push([a, bdst]); return { error: null } },
      }),
    },
  }
  return {
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: () => builder('users') }),
    createServiceRoleClient: () => service,
    getAuthUser: async () => ({ id: 'u1' }),
  }
})

import * as route from '@/app/api/recordings/[id]/route'
import { recordOrgTransfer } from '@/lib/orgTransfer'

function patch(body: any) {
  const req = new Request('http://t/api/recordings/rec_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return route.PATCH(req, { params: Promise.resolve({ id: 'rec_1' }) })
}

beforeEach(() => {
  rpcCalls.length = 0
  moveCalls.length = 0
  vi.mocked(recordOrgTransfer).mockClear()
  ctx.caller = { userId: 'u1', orgId: 'orgA', isAdminOrg: true, isAdmin: true, userEmail: 'a@x.io' }
})

describe('PATCH /api/recordings/[id] — org transfer gate', () => {
  it('rejects a non-platform-admin transfer with 403 and runs no RPC', async () => {
    ctx.caller = { userId: 'u1', orgId: 'orgA', isAdminOrg: false, isAdmin: true, userEmail: 'a@x.io' }
    const res = await patch({ org_id: 'orgB' })
    expect(res.status).toBe(403)
    expect(rpcCalls.length).toBe(0)
    expect(recordOrgTransfer).not.toHaveBeenCalled()
  })

  it('platform-admin transfer runs transfer_recording_org and audit-logs', async () => {
    const res = await patch({ org_id: 'orgB' })
    expect(res.status).toBe(200)
    const rpc = rpcCalls.find(c => c.name === 'transfer_recording_org')
    expect(rpc).toBeTruthy()
    expect(rpc!.args).toEqual({ p_recording_id: 'rec_1', p_from_org: 'orgA', p_to_org: 'orgB' })
    expect(recordOrgTransfer).toHaveBeenCalledOnce()
    expect(vi.mocked(recordOrgTransfer).mock.calls[0][0]).toMatchObject({
      resourceType: 'recording', resourceId: 'rec_1', fromOrgId: 'orgA', toOrgId: 'orgB',
    })
  })

  it('a plain rename never enters the transfer path', async () => {
    const res = await patch({ name: 'Renamed' })
    expect(res.status).toBe(200)
    expect(rpcCalls.length).toBe(0)
    expect(recordOrgTransfer).not.toHaveBeenCalled()
  })
})
