// lib/auth/gate.ts — the one resource-access gate (SECURITY.md item 11). The
// policy under test: no org → 401; missing resource and cross-org resource
// are indistinguishable (same 404, same message); platform admins cross orgs;
// every resource type resolves through the right table, including the
// pulseiq slug fallback and the two-step "conversation" resolution.
import { describe, it, expect } from 'vitest'
import { gateResourceAccess, gateResourceForUser, resolveCallerOrg, resolveResourceOrgId, gateDenied, NOT_AVAILABLE } from '@/lib/auth/gate'
import { makeFakeService } from '../helpers/fakeSupabase'

function svc() {
  return makeFakeService({ tables: {
    users: [{ id: 'u1', org_id: 'o1' }, { id: 'u2', org_id: 'o2' }, { id: 'adm', org_id: 'oadm' }, { id: 'noorg', org_id: null }],
    organizations: [{ id: 'o1', is_admin_org: false }, { id: 'o2', is_admin_org: false }, { id: 'oadm', is_admin_org: true }],
    agents: [{ id: 'a1', org_id: 'o1' }],
    datasets: [{ id: 'd1', org_id: 'o1' }],
    collections: [{ id: 'c1', org_id: 'o1' }],
    studies: [{ id: 's1', org_id: 'o1' }],
    campaigns: [{ id: 'cp1', org_id: 'o2' }],
    pulseiq_sessions: [{ id: '11111111-1111-4111-8111-111111111111', slug: 'town-hall-1', org_id: 'o1' }],
    responses: [{ id: 'r1', study_id: 's1' }],
  } })
}
const NON_ADMIN_O1 = { orgId: 'o1', isAdmin: false }

describe('resolveCallerOrg', () => {
  it('reads org + platform-admin flag in two point reads; no org → not admin', async () => {
    const s = svc()
    expect(await resolveCallerOrg(s, 'u1')).toEqual({ orgId: 'o1', isAdmin: false })
    expect(await resolveCallerOrg(s, 'adm')).toEqual({ orgId: 'oadm', isAdmin: true })
    expect(await resolveCallerOrg(s, 'noorg')).toEqual({ orgId: null, isAdmin: false })
    expect(await resolveCallerOrg(s, 'ghost')).toEqual({ orgId: null, isAdmin: false })
  })
})

describe('resolveResourceOrgId', () => {
  it('maps every plain type to its table', async () => {
    const s = svc()
    expect(await resolveResourceOrgId(s, 'agent', 'a1')).toBe('o1')
    expect(await resolveResourceOrgId(s, 'dataset', 'd1')).toBe('o1')
    expect(await resolveResourceOrgId(s, 'collection', 'c1')).toBe('o1')
    expect(await resolveResourceOrgId(s, 'study', 's1')).toBe('o1')
    expect(await resolveResourceOrgId(s, 'campaign', 'cp1')).toBe('o2')
    expect(await resolveResourceOrgId(s, 'agent', 'nope')).toBeNull()
  })
  it('pulseiq sessions resolve by uuid, then by slug (case-insensitive)', async () => {
    const s = svc()
    expect(await resolveResourceOrgId(s, 'pulseiq_session', '11111111-1111-4111-8111-111111111111')).toBe('o1')
    expect(await resolveResourceOrgId(s, 'pulseiq_session', 'Town-Hall-1')).toBe('o1')
    expect(await resolveResourceOrgId(s, 'pulseiq_session', 'unknown-slug')).toBeNull()
  })
  it('a "conversation" is an agent id first, else a survey response resolved through its study', async () => {
    const s = svc()
    expect(await resolveResourceOrgId(s, 'conversation', 'a1')).toBe('o1')
    expect(await resolveResourceOrgId(s, 'conversation', 'r1')).toBe('o1')
    expect(await resolveResourceOrgId(s, 'conversation', 'nothing')).toBeNull()
  })
})

describe('gateResourceAccess policy', () => {
  it('no org on the caller → 401 before any resource lookup', async () => {
    const s = svc()
    expect(await gateResourceAccess(s, { orgId: null, isAdmin: false }, 'agent', 'a1')).toEqual({ ok: false, status: 401, error: 'Unauthorized' })
  })
  it('own-org resource → ok with the target org and caller context', async () => {
    expect(await gateResourceAccess(svc(), NON_ADMIN_O1, 'dataset', 'd1')).toEqual({ ok: true, targetOrgId: 'o1', userOrgId: 'o1', isAdmin: false })
  })
  it('cross-org and non-existent are the SAME 404 + message — no existence probe', async () => {
    const s = svc()
    const cross = await gateResourceAccess(s, NON_ADMIN_O1, 'campaign', 'cp1')   // belongs to o2
    const missing = await gateResourceAccess(s, NON_ADMIN_O1, 'campaign', 'nope')
    expect(cross).toEqual({ ok: false, status: 404, error: NOT_AVAILABLE })
    expect(missing).toEqual(cross)
  })
  it('platform admins cross orgs; a missing resource is still 404 for them', async () => {
    const s = svc()
    expect(await gateResourceAccess(s, { orgId: 'oadm', isAdmin: true }, 'campaign', 'cp1')).toMatchObject({ ok: true, targetOrgId: 'o2', isAdmin: true })
    expect(await gateResourceAccess(s, { orgId: 'oadm', isAdmin: true }, 'campaign', 'nope')).toMatchObject({ ok: false, status: 404 })
  })
  it('gateResourceForUser resolves the caller by user id, then applies the same policy', async () => {
    const s = svc()
    expect(await gateResourceForUser(s, 'u1', 'agent', 'a1')).toMatchObject({ ok: true, targetOrgId: 'o1' })
    expect(await gateResourceForUser(s, 'u2', 'agent', 'a1')).toMatchObject({ ok: false, status: 404 })
    expect(await gateResourceForUser(s, 'adm', 'agent', 'a1')).toMatchObject({ ok: true, isAdmin: true })
    expect(await gateResourceForUser(s, 'noorg', 'agent', 'a1')).toMatchObject({ ok: false, status: 401 })
  })
  it('gateDenied renders the denial as { error } with the denial status', async () => {
    const res = gateDenied({ ok: false, status: 404, error: NOT_AVAILABLE })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: NOT_AVAILABLE })
  })
})
