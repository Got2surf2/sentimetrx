import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getEntitiesWithCounts, storeEntityMentionCounts } from '@/lib/entityFilter'

// A failed entity count is NOT a measured zero.
//
// `count_entity_terms` 57014s (statement timeout) on large scopes — Sentry saw
// 12 such events from the entity-discovery cron. The error used to be logged and
// swallowed, leaving an empty count map that is indistinguishable from "every
// term has zero mentions". Two things then went wrong, and these tests pin both:
//
//   1. storeEntityMentionCounts PERSISTED those zeros via
//      apply_entity_mention_counts, so a transient timeout durably zeroed the
//      catalog.
//   2. getEntitiesWithCounts drops zero-count entries on default reads, so the
//      UI showed an EMPTY entity list rather than an error.

const SCOPE_ROWS = [
  { slug: 'chicken', canonical: 'Chicken', aliases: [], hidden: false, category: 'dish', source: 'discovered', mention_count: null, mention_count_sampled: null, mention_count_row_total: null },
  { slug: 'pasta', canonical: 'Pasta', aliases: [], hidden: false, category: 'dish', source: 'discovered', mention_count: null, mention_count_sampled: null, mention_count_row_total: null },
]

/** Minimal chained-query stand-in. `countError` drives the count RPC outcome;
 *  `sampledCounts` makes the sampled fallback succeed with real counts. */
function makeService(opts: { countError?: { message: string }; rpcCalls: string[]; sampledCounts?: [string, number][]; _sampledServed?: boolean }) {
  const table = (rows: unknown[]) => {
    const q: Record<string, unknown> = {}
    const self = () => q
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'gte', 'lte']) q[m] = self
    q.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
    q.single = () => Promise.resolve({ data: rows[0] ?? null, error: null })
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
    return q
  }
  return {
    from: (t: string) => {
      if (t === 'entity_catalog') return table(SCOPE_ROWS)
      if (t === 'datasets') return table([{ id: 'd1', row_count: 100, org_id: 'o1' }])
      if (t === 'dataset_state') return table([{ dataset_id: 'd1', schema_config: { fields: [{ field: 'text', type: 'open-ended' }] } }])
      return table([])
    },
    rpc: (fn: string) => {
      opts.rpcCalls.push(fn)
      if (fn === 'count_entity_terms') {
        return Promise.resolve({ data: null, error: opts.countError ?? null })
      }
      if (fn === 'sampled_count_entity_terms_blocks' && opts.sampledCounts) {
        // One page carrying real counts, then exhaustion.
        const first = !opts._sampledServed
        opts._sampledServed = true
        return Promise.resolve({
          data: first
            ? { n_scanned: 100, counts: opts.sampledCounts, last_row_index: null }
            : { n_scanned: 0, counts: [], last_row_index: null },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    },
  } as unknown as SupabaseClient
}

describe('entity counts — a failed count must not read as a measured zero', () => {
  it('storeEntityMentionCounts does NOT persist zeros when the count RPC errors', async () => {
    const rpcCalls: string[] = []
    const svc = makeService({ countError: { message: 'canceling statement due to statement timeout' }, rpcCalls })

    await storeEntityMentionCounts(svc, 'd1')

    // The write is the whole risk: apply_entity_mention_counts would set
    // mention_count = 0 for every entity in the scope.
    expect(rpcCalls).not.toContain('apply_entity_mention_counts')
  })

  it('storeEntityMentionCounts DOES persist when the count succeeds', async () => {
    const rpcCalls: string[] = []
    const svc = makeService({ rpcCalls })

    await storeEntityMentionCounts(svc, 'd1')

    // Guard against "fixed" by never writing at all.
    expect(rpcCalls).toContain('apply_entity_mention_counts')
  })

  it('getEntitiesWithCounts flags counts_failed and keeps entities visible', async () => {
    const rpcCalls: string[] = []
    const svc = makeService({ countError: { message: 'canceling statement due to statement timeout' }, rpcCalls })

    const res = await getEntitiesWithCounts({ service: svc, datasetId: 'd1' })
    if ('notFound' in res) throw new Error('scope should resolve')

    // Unknown, not zero — the caller must be able to tell.
    expect(res.counts_failed).toBe(true)
    // ...and the zero-count drop is suspended, so the catalog doesn't blank out
    // on a transient timeout.
    expect(res.entities.length).toBeGreaterThan(0)
  })

  it('getEntitiesWithCounts leaves counts_failed falsy on a clean read', async () => {
    const rpcCalls: string[] = []
    const svc = makeService({ rpcCalls })

    const res = await getEntitiesWithCounts({ service: svc, datasetId: 'd1' })
    if ('notFound' in res) throw new Error('scope should resolve')

    expect(res.counts_failed).toBeFalsy()
  })
})

describe('entity counts — exact-path timeout falls back to the sampled twins', () => {
  it('persists sampled counts (not zeros, not failure) when the fallback finds real mentions', async () => {
    const rpcCalls: string[] = []
    const svc = makeService({
      countError: { message: 'canceling statement due to statement timeout' },
      sampledCounts: [['"Chicken"', 12]],
      rpcCalls,
    })

    await storeEntityMentionCounts(svc, 'd1')

    expect(rpcCalls).toContain('sampled_count_entity_terms_blocks')
    expect(rpcCalls).toContain('apply_entity_mention_counts')   // real counts DO persist
  })

  it('an all-zero fallback still refuses to persist (indistinguishable from a scan that never ran)', async () => {
    const rpcCalls: string[] = []
    const svc = makeService({
      countError: { message: 'canceling statement due to statement timeout' },
      sampledCounts: [],
      rpcCalls,
    })

    await storeEntityMentionCounts(svc, 'd1')

    expect(rpcCalls).not.toContain('apply_entity_mention_counts')
  })
})
