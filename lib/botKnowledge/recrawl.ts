// lib/botKnowledge/recrawl.ts
// AGENT_TIERS Phase 2 P2e — per-page hash-diff re-crawl for Super Agents.
//
// The weekly cron (app/api/cron/agent-recrawl) calls recrawlAgentPages once per
// super agent with its training_urls. For each URL we fetch the current page,
// extract text (the SAME crawlText.htmlToText the deep crawl uses), and hash it.
// If the hash matches the stored one (sql/177 agent_kb_page_hashes) the page is
// UNCHANGED → skipped: no re-chunk, no re-embed. That's the whole point of
// hash-diffing — a stable site costs one cheap fetch per page, no embedding
// spend. When the hash differs (or the page is new) we replace that page's KB
// chunks and re-embed through the SHARED ingest path (ingestKnowledgeText, P2b
// dedup/budget) so there's one chunk→embed pipeline, no drift.
//
// Per-page replace: re-crawled chunks are tagged metadata.source = <url> and
// source_type = 're-crawl'. On a change we delete this URL's existing chunks
// (by metadata->>source) BEFORE re-ingesting — required because the append-path
// near-dup guard would otherwise see the page's own prior chunks as ≥0.95-similar
// and skip the fresh ones. A delete-first window is acceptable here: it's one
// page of a multi-page KB in a background weekly sweep, and it self-heals — the
// hash is only written on a successful ingest, so a transient insert failure
// leaves the old hash and the page is retried next run.

import 'server-only'
import { createHash } from 'crypto'
import type { createServiceRoleClient } from '@/lib/supabase/server'
import { safeFetch } from '@/lib/safeFetch'
import { htmlToText } from '@/lib/crawlText'
import { ingestKnowledgeText, KnowledgeInsertError, type IngestBot } from '@/lib/botKnowledge/ingest'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

/** source_type tag on re-crawled chunks. Protected from editor-save prune in ingest.ts. */
export const RECRAWL_SOURCE_TYPE = 're-crawl'

const FETCH_TIMEOUT_MS = 10000
const MIN_TEXT_LEN = 50
const UA = 'Mozilla/5.0 (compatible; Datanautix Deep Crawler/1.0)'

/** sha256 hex of the extracted page text — the freshness signal. Exported for tests. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export type RecrawlPageStatus = 'unchanged' | 'updated' | 'new' | 'unreachable' | 'empty' | 'error'

export interface RecrawlPageResult {
  url: string
  status: RecrawlPageStatus
  chunksAdded: number
}

export interface RecrawlResult {
  pages: RecrawlPageResult[]
  fetched: number       // pages actually fetched this run (skipped-by-deadline excluded)
  unchanged: number
  updated: number
  added: number         // new pages
  unreachable: number
  chunksAdded: number
}

async function fetchPageText(url: string): Promise<{ title: string; text: string } | null> {
  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('html') && !contentType.includes('text')) return null
    const html = await res.text()
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : url
    const text = htmlToText(html, url)
    return { title, text }
  } catch {
    return null
  }
}

export interface RecrawlOpts {
  /** Cap the URLs processed this run (fairness / cost). */
  maxUrls?: number
  /** Epoch ms; stop starting new pages past this so the cron stays under maxDuration. */
  deadline?: number
}

/**
 * Re-crawl a super agent's training_urls, re-embedding only the pages whose
 * extracted text changed since the last stored hash. Returns per-page results
 * plus roll-up counts. Never throws for a single bad page — it's marked
 * 'unreachable'/'error' and the sweep continues.
 */
export async function recrawlAgentPages(
  service: ServiceClient,
  agent: IngestBot,
  urls: string[],
  opts: RecrawlOpts = {},
): Promise<RecrawlResult> {
  const cleaned = Array.from(new Set(urls.map((u) => (u || '').trim()).filter(Boolean)))
  const capped = typeof opts.maxUrls === 'number' ? cleaned.slice(0, opts.maxUrls) : cleaned

  // One read of all stored hashes for this agent.
  const { data: hashRows } = await service
    .from('agent_kb_page_hashes')
    .select('url, content_hash')
    .eq('agent_id', agent.id)
  const stored = new Map<string, string>((hashRows || []).map((r: { url: string; content_hash: string }) => [r.url, r.content_hash]))

  const pages: RecrawlPageResult[] = []

  for (const url of capped) {
    if (opts.deadline && Date.now() > opts.deadline) break

    const page = await fetchPageText(url)
    if (!page) { pages.push({ url, status: 'unreachable', chunksAdded: 0 }); continue }
    if (page.text.length < MIN_TEXT_LEN) { pages.push({ url, status: 'empty', chunksAdded: 0 }); continue }

    const hash = contentHash(page.text)
    const prev = stored.get(url)

    if (prev === hash) {
      // Unchanged — no embed. Touch last_crawled_at so the ledger reflects the sweep.
      await service
        .from('agent_kb_page_hashes')
        .update({ last_crawled_at: new Date().toISOString() })
        .eq('agent_id', agent.id).eq('url', url).eq('org_id', agent.org_id)
      pages.push({ url, status: 'unchanged', chunksAdded: 0 })
      continue
    }

    // Changed or new — replace this page's chunks (delete-first so the near-dup
    // guard doesn't reject the fresh chunks against the page's own prior copy).
    await service
      .from('agent_knowledge_chunks')
      .delete()
      .eq('bot_id', agent.id)
      .eq('metadata->>source', url)

    const heading = page.title.replace(/\s*[|–—]\s*.+$/, '').replace(/\s*-\s*$/, '').trim() || 'Page'
    const md = '## ' + heading + '\nOfficial page: ' + url + '\n\n' + page.text

    let chunksAdded = 0
    try {
      const r = await ingestKnowledgeText(service, agent, md, { source: url, sourceType: RECRAWL_SOURCE_TYPE })
      chunksAdded = r.stored
    } catch (e) {
      // Insert failed — do NOT write the hash so the page is retried next run.
      if (!(e instanceof KnowledgeInsertError)) {
        console.error({ at: 'recrawl', msg: 'ingest failed', url, err: e instanceof Error ? e.message : undefined })
      }
      pages.push({ url, status: 'error', chunksAdded: 0 })
      continue
    }

    await service
      .from('agent_kb_page_hashes')
      .upsert(
        { org_id: agent.org_id, agent_id: agent.id, url, content_hash: hash, last_crawled_at: new Date().toISOString() },
        { onConflict: 'agent_id,url' },
      )

    pages.push({ url, status: prev ? 'updated' : 'new', chunksAdded })
  }

  return {
    pages,
    fetched: pages.length,
    unchanged: pages.filter((p) => p.status === 'unchanged').length,
    updated: pages.filter((p) => p.status === 'updated').length,
    added: pages.filter((p) => p.status === 'new').length,
    unreachable: pages.filter((p) => p.status === 'unreachable').length,
    chunksAdded: pages.reduce((s, p) => s + p.chunksAdded, 0),
  }
}
