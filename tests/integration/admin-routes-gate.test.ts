// tests/integration/admin-routes-gate.test.ts
//
// Phase 1 — platform-admin gate for every internal admin/* route. Per the
// CLAUDE.md / SECURITY.md invariant ("internal-only routes wrap requireAdmin
// from day one; URL obscurity is not a defense"), each of these must reject a
// non-admin caller. Most use requireAdmin() (404 to hide existence); a couple
// (bulk-invite, invite-preview) gate inline on is_admin_org/owner (401/403).
//
// The contract asserted here: a NON-admin caller — authenticated or not —
// never gets a 2xx from any admin route+verb (status ∈ {401,403,404}).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type AuthUser = { id: string; email?: string }
type QueryResult = { data: unknown; error: unknown }

const ctx = {
  authUser: null as AuthUser | null,
  results: {} as Record<string, QueryResult>,
}
function reset() { ctx.authUser = null; ctx.results = {} }

type Builder = {
  [k: string]: (...args: unknown[]) => unknown
} & {
  single: () => Promise<QueryResult>
  maybeSingle: () => Promise<QueryResult>
  then: (res: (v: QueryResult) => unknown, rej: (e: unknown) => unknown) => Promise<unknown>
}

function builder(table: string): Builder {
  const b = {} as Builder
  for (const m of ['select', 'eq', 'order', 'in', 'limit', 'neq', 'range', 'update', 'delete', 'insert', 'upsert']) b[m] = () => b
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = b.single
  b.then = (res: (v: QueryResult) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}
const client = () => ({
  from: (t: string) => builder(t),
  auth: { getUser: async () => ({ data: { user: ctx.authUser }, error: null }) },
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => client(),
  createServiceRoleClient: () => client(),
  getAuthUser: async () => ctx.authUser,
}))
// Heavy / side-effecting libs — admin gate rejects before any of these run.
vi.mock('@/lib/aiKey', () => ({}))
vi.mock('@/lib/backupS3', () => ({}))
vi.mock('@/lib/orgSnapshot', () => ({ TABLE_SPECS: [] }))
vi.mock('@/lib/orgTransfer', () => ({}))
vi.mock('@/lib/reoVocabulary', () => ({}))
vi.mock('@/lib/email/inviteTemplate', () => ({}))
vi.mock('@/lib/email/sendInvite', () => ({}))
vi.mock('@/lib/guardrails', () => ({}))
vi.mock('@/lib/contentGuard', () => ({ checkMessage: () => ({ ok: true }) }))

import * as agentTester from '@/app/api/admin/agent-tester/route'
import * as bulkInvite from '@/app/api/admin/bulk-invite/route'
import * as clients from '@/app/api/admin/clients/route'
import * as clientsId from '@/app/api/admin/clients/[id]/route'
import * as invitePreview from '@/app/api/admin/invite-preview/route'
import * as orgSnapshots from '@/app/api/admin/org-snapshots/[orgId]/route'
import * as orgSnapshotsRestore from '@/app/api/admin/org-snapshots/[orgId]/restore/route'
import * as orgsId from '@/app/api/admin/orgs/[id]/route'
import * as orgsAiKey from '@/app/api/admin/orgs/[id]/ai-key/route'
import * as orgsFeatures from '@/app/api/admin/orgs/[id]/features/route'
import * as reoGoldSet from '@/app/api/admin/reo-gold-set/route'
import * as usersId from '@/app/api/admin/users/[id]/route'
import * as usersFeatures from '@/app/api/admin/users/[id]/features/route'

const req = (method = 'POST', body: unknown = {}) =>
  new Request('http://t/x', { method, body: method === 'GET' ? undefined : JSON.stringify(body) }) as unknown as NextRequest
const idP: { params: Promise<{ id: string }> } = { params: Promise.resolve({ id: 'x_1' }) }
const orgP: { params: Promise<{ orgId: string }> } = { params: Promise.resolve({ orgId: 'o_1' }) }

// Every admin route+verb, called with its props.
const calls: { name: string; call: () => Promise<Response> }[] = [
  { name: 'agent-tester GET', call: () => agentTester.GET() },
  { name: 'agent-tester POST', call: () => agentTester.POST(req('POST', {})) },
  { name: 'bulk-invite POST', call: () => bulkInvite.POST(req('POST', { org_id: 'o', users: [{ email: 'a@b.com' }] })) },
  { name: 'clients GET', call: () => clients.GET(req('GET')) },
  { name: 'clients POST', call: () => clients.POST(req('POST', {})) },
  { name: 'clients/[id] GET', call: () => clientsId.GET(req('GET'), idP) },
  { name: 'clients/[id] PATCH', call: () => clientsId.PATCH(req('PATCH', {}), idP) },
  { name: 'invite-preview POST', call: () => invitePreview.POST(req('POST', { org_id: 'o' })) },
  { name: 'org-snapshots/[orgId] GET', call: () => orgSnapshots.GET(req('GET'), orgP) },
  { name: 'org-snapshots/[orgId] POST', call: () => orgSnapshots.POST(req('POST', {}), orgP) },
  { name: 'org-snapshots/[orgId]/restore POST', call: () => orgSnapshotsRestore.POST(req('POST', {}), orgP) },
  { name: 'orgs/[id] GET', call: () => orgsId.GET(req('GET'), idP) },
  { name: 'orgs/[id] PATCH', call: () => orgsId.PATCH(req('PATCH', {}), idP) },
  { name: 'orgs/[id] DELETE', call: () => orgsId.DELETE(req('DELETE'), idP) },
  { name: 'orgs/[id]/ai-key GET', call: () => orgsAiKey.GET(req('GET'), idP) },
  { name: 'orgs/[id]/ai-key PUT', call: () => orgsAiKey.PUT(req('PUT', {}), idP) },
  { name: 'orgs/[id]/ai-key DELETE', call: () => orgsAiKey.DELETE(req('DELETE'), idP) },
  { name: 'orgs/[id]/features GET', call: () => orgsFeatures.GET(req('GET'), idP) },
  { name: 'orgs/[id]/features PUT', call: () => orgsFeatures.PUT(req('PUT', {}), idP) },
  { name: 'reo-gold-set GET', call: () => reoGoldSet.GET() },
  { name: 'reo-gold-set POST', call: () => reoGoldSet.POST(req('POST', {})) },
  { name: 'users/[id] PATCH', call: () => usersId.PATCH(req('PATCH', {}), idP) },
  { name: 'users/[id]/features PUT', call: () => usersFeatures.PUT(req('PUT', {}), idP) },
]

beforeEach(reset)

describe.each(calls)('admin route $name', ({ call }) => {
  it('rejects an unauthenticated caller (not 2xx)', async () => {
    ctx.authUser = null
    const status = (await call()).status
    expect([401, 403, 404]).toContain(status)
  })

  it('rejects a non-admin authenticated caller (not 2xx)', async () => {
    ctx.authUser = { id: 'u1', email: 'u1@x' }
    ctx.results['users'] = { data: { org_id: 'orgA', role: 'member', organizations: { is_admin_org: false } }, error: null }
    const status = (await call()).status
    expect([401, 403, 404]).toContain(status)
  })
})
