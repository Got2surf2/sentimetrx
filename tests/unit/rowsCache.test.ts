// lib/rowsCache — freshness key semantics for the IndexedDB repeat-open cache.
// The IDB read/write paths are exercised in-browser (they no-op outside a
// browser); what MUST be pinned here is the invalidation contract: any change
// to row count, sync stamp, or the schema (aliases are baked into cached
// rows) produces a different key, and identical inputs produce the same one.
import { describe, it, expect } from 'vitest'
import { rowsFreshness, readRowsCache, writeRowsCache } from '@/lib/rowsCache'

const FIELDS = [{ field: 'rating', type: 'numeric', valueAliases: { '1': 'Poor' } }]

describe('rowsFreshness', () => {
  it('is deterministic for identical inputs', () => {
    expect(rowsFreshness(100, '2026-09-01T00:00:00Z', FIELDS)).toBe(rowsFreshness(100, '2026-09-01T00:00:00Z', [...FIELDS]))
  })

  it('changes when row count, sync stamp, or schema changes', () => {
    const base = rowsFreshness(100, '2026-09-01T00:00:00Z', FIELDS)
    expect(rowsFreshness(101, '2026-09-01T00:00:00Z', FIELDS)).not.toBe(base)
    expect(rowsFreshness(100, '2026-09-02T00:00:00Z', FIELDS)).not.toBe(base)
    expect(rowsFreshness(100, '2026-09-01T00:00:00Z', [{ ...FIELDS[0], valueAliases: { '1': 'Bad' } }])).not.toBe(base)
  })

  it('tolerates null sync stamp and undefined schema', () => {
    expect(rowsFreshness(0, null, undefined)).toBe(rowsFreshness(0, undefined, undefined))
  })
})

describe('IDB helpers outside a browser', () => {
  it('read returns null and write resolves without touching anything', async () => {
    expect(await readRowsCache('d1', 'k')).toBeNull()
    await expect(writeRowsCache('d1', 'k', { rows: [], totalRows: 0, sampled: false })).resolves.toBeUndefined()
  })
})
