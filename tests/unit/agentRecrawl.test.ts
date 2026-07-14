// AGENT_TIERS Phase 2 P2e — per-page hash-diff re-crawl (lib/botKnowledge/recrawl).
// The freshness contract: an UNCHANGED page (stored hash == current text hash)
// is skipped entirely — no delete, no re-embed — while a CHANGED or NEW page
// replaces its chunks (delete-by-source-url then shared ingest) and writes the
// new hash. A single unreachable page is fail-soft and never writes a hash.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { ingestMock, FakeInsertError } = vi.hoisted(() => {
  class FakeInsertError extends Error {}
  return { ingestMock: vi.fn(async (..._args: unknown[]) => ({ stored: 3, removed: 0, near_dup_skipped: 0, budget_skipped: 0 })), FakeInsertError }
})

vi.mock('@/lib/botKnowledge/ingest', () => ({
  ingestKnowledgeText: (...args: unknown[]) => ingestMock(...(args as [])),
  KnowledgeInsertError: FakeInsertError,
}))

// Per-URL html served by the fetch mock; missing url → unreachable.
const pageHtml: Record<string, string | null> = {}
vi.mock('@/lib/safeFetch', () => ({
  safeFetch: async (url: string) => {
    const html = pageHtml[url]
    if (html == null) return { ok: false, headers: { get: () => '' }, text: async () => '' }
    return { ok: true, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => html }
  },
}))

import { recrawlAgentPages, contentHash } from '@/lib/botKnowledge/recrawl'
import { htmlToText } from '@/lib/crawlText'

const agent = { id: 'b1', org_id: 'o1', subject: null, opponents: null, capability: 'super', capability_config: {} }

// In-memory service mock. `.eq(...)` doubles as chain link + awaitable terminal.
type Store = {
  hashes: { url: string; content_hash: string }[]
  deletes: Record<string, unknown>[]
  upserts: Record<string, unknown>[]
  updates: { table: string; filters: Record<string, unknown> }[]
}
let store: Store

function service() {
  const chain = (table: string) => {
    const b: Record<string, unknown> = { _op: '', _filters: {} as Record<string, unknown> }
    b.select = () => { b._op = 'select'; return b }
    b.delete = () => { b._op = 'delete'; return b }
    b.update = () => { b._op = 'update'; return b }
    b.eq = (col: string, val: unknown) => { (b._filters as Record<string, unknown>)[col] = val; return b }
    b.upsert = (row: Record<string, unknown>) => { store.upserts.push(row); return Promise.resolve({ error: null }) }
    b.then = (resolve: (v: unknown) => unknown) => {
      if (b._op === 'select' && table === 'agent_kb_page_hashes') return resolve({ data: store.hashes })
      if (b._op === 'delete' && table === 'agent_knowledge_chunks') { store.deletes.push({ ...(b._filters as object) }); return resolve({ error: null }) }
      if (b._op === 'update') { store.updates.push({ table, filters: { ...(b._filters as object) } }); return resolve({ error: null }) }
      return resolve({ data: null, error: null })
    }
    return b
  }
  return { from: (t: string) => chain(t) } as never
}

beforeEach(() => {
  store = { hashes: [], deletes: [], upserts: [], updates: [] }
  ingestMock.mockClear()
  for (const k of Object.keys(pageHtml)) delete pageHtml[k]
})

describe('contentHash', () => {
  it('is deterministic and changes with content', () => {
    expect(contentHash('hello world')).toBe(contentHash('hello world'))
    expect(contentHash('hello world')).not.toBe(contentHash('hello worlds'))
  })
})

describe('recrawlAgentPages', () => {
  const URL_A = 'https://example.org/about'

  it('ingests a NEW page and stores its hash', async () => {
    pageHtml[URL_A] = '<html><title>About Us</title><body><h1>About</h1><p>We build widgets for everyone in the world.</p></body></html>'
    const res = await recrawlAgentPages(service(), agent, [URL_A])

    expect(ingestMock).toHaveBeenCalledTimes(1)
    // Tagged source = the page URL, source_type = 're-crawl'.
    const opts = ingestMock.mock.calls[0][3] as { source: string; sourceType: string }
    expect(opts.source).toBe(URL_A)
    expect(opts.sourceType).toBe('re-crawl')
    expect(store.upserts).toHaveLength(1)
    expect(res.pages[0]).toMatchObject({ url: URL_A, status: 'new', chunksAdded: 3 })
    expect(store.deletes).toHaveLength(1) // delete-first (no-op for a new page, still issued)
  })

  it('SKIPS an unchanged page — no delete, no ingest, only touches last_crawled_at', async () => {
    const html = '<html><title>About</title><body><p>Stable content that has not changed at all since the last weekly re-crawl ran against this page.</p></body></html>'
    pageHtml[URL_A] = html
    store.hashes = [{ url: URL_A, content_hash: contentHash(htmlToText(html, URL_A)) }]

    const res = await recrawlAgentPages(service(), agent, [URL_A])

    expect(ingestMock).not.toHaveBeenCalled()
    expect(store.deletes).toHaveLength(0)
    expect(store.upserts).toHaveLength(0)
    expect(store.updates).toHaveLength(1) // last_crawled_at touch
    expect(res.pages[0].status).toBe('unchanged')
    expect(res.unchanged).toBe(1)
  })

  it('REPLACES a changed page — delete by source url, re-ingest, new hash', async () => {
    pageHtml[URL_A] = '<html><title>About</title><body><p>Brand new different content after a site update.</p></body></html>'
    store.hashes = [{ url: URL_A, content_hash: 'stale-old-hash' }]

    const res = await recrawlAgentPages(service(), agent, [URL_A])

    expect(store.deletes[0]).toMatchObject({ bot_id: 'b1', 'metadata->>source': URL_A })
    expect(ingestMock).toHaveBeenCalledTimes(1)
    expect(store.upserts).toHaveLength(1)
    expect(res.pages[0].status).toBe('updated')
    expect(res.updated).toBe(1)
  })

  it('marks an unreachable page and writes no hash', async () => {
    const res = await recrawlAgentPages(service(), agent, ['https://example.org/gone'])
    expect(ingestMock).not.toHaveBeenCalled()
    expect(store.upserts).toHaveLength(0)
    expect(res.pages[0].status).toBe('unreachable')
    expect(res.unreachable).toBe(1)
  })

  it('does not write a hash when ingest throws (retried next run)', async () => {
    pageHtml[URL_A] = '<html><title>About</title><body><p>Content that will fail to ingest this time because the insert throws a database error.</p></body></html>'
    ingestMock.mockRejectedValueOnce(new FakeInsertError('insert failed'))

    const res = await recrawlAgentPages(service(), agent, [URL_A])
    expect(store.upserts).toHaveLength(0)
    expect(res.pages[0].status).toBe('error')
  })

  it('honors the deadline — stops starting new pages', async () => {
    pageHtml['https://example.org/a'] = '<html><title>A</title><body><p>Page A body content here now.</p></body></html>'
    pageHtml['https://example.org/b'] = '<html><title>B</title><body><p>Page B body content here now.</p></body></html>'
    const res = await recrawlAgentPages(service(), agent, ['https://example.org/a', 'https://example.org/b'], { deadline: Date.now() - 1 })
    expect(res.pages).toHaveLength(0)
    expect(ingestMock).not.toHaveBeenCalled()
  })
})
