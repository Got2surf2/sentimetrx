// Tests for lib/orgDelete.ts — tenant erasure sweep.
// Load-bearing guarantees: (1) clears every org-scoped table, (2) the
// retry-until-fixpoint loop tolerates FK ordering (a table blocked by a
// not-yet-deleted sibling succeeds on a later pass), (3) fail-closed — a
// permanently-blocked table ends up in `failed` (so the caller won't delete the
// org row and silently orphan data).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// A mock service whose per-table delete behavior each test configures.
let behavior: (table: string, deleted: Set<string>) => { error: { message: string } | null }
const deletedThisRun = new Set<string>()

function makeService() {
  return {
    from(table: string) {
      return {
        delete() {
          return {
            eq: async () => {
              const res = behavior(table, deletedThisRun)
              if (!res.error) deletedThisRun.add(table)
              return res
            },
          }
        },
      }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => makeService(),
}))

import { deleteOrgScopedData, ORG_SCOPED_TABLES } from '@/lib/orgDelete'

beforeEach(() => { deletedThisRun.clear() })

describe('deleteOrgScopedData', () => {
  it('clears every org-scoped table on the happy path', async () => {
    behavior = () => ({ error: null })
    const r = await deleteOrgScopedData('org1')
    expect(r.failed).toEqual({})
    expect(r.deleted.sort()).toEqual([...ORG_SCOPED_TABLES].sort())
  })

  it('retries FK-blocked tables until they succeed (fixpoint)', async () => {
    // 'agent_change_log' (first in the list) refuses until 'users' (last in the
    // list) has been deleted. A single pass would leave it failed; the fixpoint
    // loop must retry it on a later pass and end clean.
    behavior = (table, deleted) => {
      if (table === 'agent_change_log' && !deleted.has('users')) {
        return { error: { message: 'FK violation: users not yet deleted' } }
      }
      return { error: null }
    }
    const r = await deleteOrgScopedData('org1')
    expect(r.failed).toEqual({})
    expect(r.deleted).toContain('agent_change_log')
    expect(r.deleted.length).toBe(ORG_SCOPED_TABLES.length)
  })

  it('fails closed: a permanently-blocked table lands in `failed`', async () => {
    behavior = (table) =>
      table === 'townhall_sessions'
        ? { error: { message: 'RESTRICT: external reference' } }
        : { error: null }
    const r = await deleteOrgScopedData('org1')
    expect(Object.keys(r.failed)).toEqual(['townhall_sessions'])
    expect(r.failed.townhall_sessions).toContain('RESTRICT')
    expect(r.deleted).not.toContain('townhall_sessions')
  })
})
