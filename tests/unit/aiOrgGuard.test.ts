// lib/aiOrgGuard.ts — the single-tenant assertion on prompt material
// (SECURITY.md item 7). Pure row check + the dataset-ownership check against
// the filter-honoring fake, so a widened `in()` is caught the way it would be
// in a route.
import { describe, it, expect } from 'vitest'
import { assertSingleOrg, assertDatasetsBelongToOrg, CrossOrgPromptError } from '@/lib/aiOrgGuard'
import { makeFakeService } from '../helpers/fakeSupabase'

describe('assertSingleOrg', () => {
  it('returns the rows untouched when every row belongs to the expected org', () => {
    const rows = [{ org_id: 'o1', text: 'a' }, { org_id: 'o1', text: 'b' }]
    expect(assertSingleOrg(rows, 'o1', 't')).toBe(rows)
    expect(assertSingleOrg([], 'o1', 't')).toEqual([])
  })
  it('throws on a foreign org, naming the foreign org ids and counts — never row content', () => {
    const rows = [{ org_id: 'o1', text: 'SECRET-A' }, { org_id: 'o2', text: 'SECRET-B' }, { org_id: 'o3', text: 'x' }]
    let err: unknown
    try { assertSingleOrg(rows, 'o1', 'story.build') } catch (e) { err = e }
    expect(err).toBeInstanceOf(CrossOrgPromptError)
    const m = (err as Error).message
    expect(m).toContain('story.build')
    expect(m).toContain('3 rows')
    expect(m).toContain('2 foreign org(s) [o2, o3]')
    expect(m).not.toContain('SECRET')
    expect((err as CrossOrgPromptError).status).toBe(500)
  })
  it('refuses rows with no org_id — provenance must be positive', () => {
    expect(() => assertSingleOrg([{ org_id: 'o1' }, { org_id: null }, {}], 'o1', 't')).toThrow(/2 without org_id/)
  })
})

describe('assertDatasetsBelongToOrg', () => {
  const svc = makeFakeService({ tables: { datasets: [
    { id: 'd1', org_id: 'o1' }, { id: 'd2', org_id: 'o1' }, { id: 'd9', org_id: 'o2' },
  ] } })
  it('passes when every dataset exists and belongs to the org (ids deduped); empty list is a no-op', async () => {
    await expect(assertDatasetsBelongToOrg(svc, ['d1', 'd2', 'd1'], 'o1', 't')).resolves.toBeUndefined()
    await expect(assertDatasetsBelongToOrg(svc, [], 'o1', 't')).resolves.toBeUndefined()
  })
  it('throws when a member dataset belongs to another org — the collection fan-out leak', async () => {
    await expect(assertDatasetsBelongToOrg(svc, ['d1', 'd9'], 'o1', 'search')).rejects.toThrow(/1 outside org o1 \[d9\]/)
  })
  it('an unknown dataset id (stale collection member) is ignored — it contributes no rows, so it is not a leak', async () => {
    await expect(assertDatasetsBelongToOrg(svc, ['d1', 'nope'], 'o1', 'search')).resolves.toBeUndefined()
  })
  it('a query error is a refusal too, not a pass', async () => {
    const broken = makeFakeService({ tables: { datasets: [] }, errors: { datasets: { message: 'boom' } } })
    await expect(assertDatasetsBelongToOrg(broken, ['d1'], 'o1', 't')).rejects.toThrow(/could not verify dataset ownership \(boom\)/)
  })
})
