// app/api/bots/[id]/crawl-job/route.ts
// AGENT_TIERS Phase 2 P2d — resumable deep crawl for Super Agents (300+ pages).
//
// A D16a browser-driven loop: the editor POSTs {action:'start'} once, then loops
// {action:'step'} until done. Each step fetches a bounded batch (time-budgeted),
// ingests it through the SHARED knowledge ingest (P2b dedup/budget), and rewrites
// the cursor in agent_crawl_jobs (sql/176). If the tab closes the job row survives
// at its cursor; reopening resumes from {action:'status'} → step loop.
//
// Super-tier only (the big KB is a paid perk); standard agents use /deep-crawl.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { safeFetch } from '@/lib/safeFetch'
import { htmlToText, extractLinks, parseSitemapUrls, stripBoilerplate } from '@/lib/crawlText'
import { withLinkIntegrityGuardrail } from '@/lib/agentLinks'
import { ingestKnowledgeText } from '@/lib/botKnowledge/ingest'
import { resolveCapability, normalizeCapability } from '@/lib/agentCapability'
import { takeBatch, mergeDiscovered, crawlIsDone, CRAWL_BATCH_PAGES, CRAWL_TIME_BUDGET_MS } from '@/lib/botKnowledge/crawlQueue'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRAWL_TIMEOUT = 10000
const MAX_CHILD_SITEMAPS = 3

interface Params { params: Promise<{ id: string }> }

type OrgRel = { is_admin_org: boolean | null }
type UserWithOrg = { org_id: string | null; organizations: OrgRel | OrgRel[] | null }

type AgentRow = {
  id: string; org_id: string; subject: string | null
  opponents: Array<string | { name?: string }> | null
  capability: string | null; capability_config: Record<string, unknown> | null
  guardrails: unknown
}
type JobRow = {
  id: string; org_id: string; agent_id: string
  base_urls: string[]; queue: string[]; visited: string[]
  page_cap: number; pages_crawled: number; chunks_added: number
  near_dup_skipped: number; budget_skipped: number; status: string
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Datanautix Deep Crawler/1.0)', 'Accept': 'application/xml,text/xml' },
      signal: AbortSignal.timeout(CRAWL_TIMEOUT),
    })
    if (!res.ok) return null
    return await res.text()
  } catch { return null }
}

async function sitemapSeeds(baseUrl: URL, cap: number): Promise<string[]> {
  const rootXml = await fetchXml(baseUrl.origin + '/sitemap.xml')
  if (!rootXml) return []
  const { pages, childSitemaps } = parseSitemapUrls(rootXml, baseUrl.hostname)
  if (pages.length > 0) return pages.slice(0, cap * 2)
  const collected: string[] = []
  for (const child of childSitemaps.slice(0, MAX_CHILD_SITEMAPS)) {
    const childXml = await fetchXml(child)
    if (childXml) collected.push(...parseSitemapUrls(childXml, baseUrl.hostname).pages)
    if (collected.length >= cap * 2) break
  }
  return collected
}

export async function POST(req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgRel = (userData as UserWithOrg | null)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!orgRel?.is_admin_org

  const service = createServiceRoleClient()
  const { data: bot } = await service
    .from('agents')
    .select('id, org_id, subject, opponents, capability, capability_config, guardrails')
    .eq('id', params.id)
    .single()
  if (!bot || (!isAdmin && bot.org_id !== userData.org_id)) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }
  const agent = bot as AgentRow

  const body = await req.json().catch(() => ({}))
  const action = body.action as string

  try {
    if (action === 'start') return await startJob(service, agent, body)
    if (action === 'step') return await stepJob(service, agent, body.jobId as string)
    if (action === 'status') return await jobStatus(service, agent.id, agent.org_id, body.jobId as string)
    if (action === 'cancel') return await cancelJob(service, agent.id, agent.org_id, body.jobId as string)
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return serverError(e, 'bots.crawlJob')
  }
}

async function startJob(service: ReturnType<typeof createServiceRoleClient>, agent: AgentRow, body: Record<string, unknown>): Promise<NextResponse> {
  // Super-tier only — the 300-page crawl is a paid perk.
  if (normalizeCapability(agent.capability) !== 'super') {
    return NextResponse.json({ error: 'Deep crawl (300 pages) is a Super Agent feature. Use Website Crawl for standard agents.' }, { status: 403 })
  }

  let urls: string[] = []
  if (Array.isArray(body.urls)) urls = (body.urls as unknown[]).filter((u): u is string => typeof u === 'string' && !!u.trim())
  else if (typeof body.url === 'string') urls = body.url.split('\n').map((u) => u.trim()).filter(Boolean)
  if (urls.length === 0) return NextResponse.json({ error: 'At least one URL is required' }, { status: 400 })

  const baseUrls: URL[] = []
  for (const u of urls) {
    try { baseUrls.push(new URL(u)) } catch { return NextResponse.json({ error: 'Invalid URL: ' + u }, { status: 400 }) }
  }

  const pageCap = resolveCapability(agent).crawlPageCap
  const queue: string[] = []
  const seen = new Set<string>()
  for (const b of baseUrls) {
    const entry = b.origin + b.pathname.replace(/\/+$/, '')
    if (!seen.has(entry)) { seen.add(entry); queue.push(entry) }
    for (const s of await sitemapSeeds(b, pageCap)) {
      if (!seen.has(s)) { seen.add(s); queue.push(s) }
    }
  }

  const { data: job, error } = await service
    .from('agent_crawl_jobs')
    .insert({
      org_id: agent.org_id,
      agent_id: agent.id,
      base_urls: baseUrls.map((b) => b.origin),
      queue: queue.slice(0, pageCap * 2),
      visited: [],
      page_cap: pageCap,
      status: 'running',
    })
    .select('id, queue, page_cap')
    .single()
  if (error) return serverError(error, 'bots.crawlJob.start')

  return NextResponse.json({ jobId: job.id, queued: job.queue.length, pageCap: job.page_cap })
}

async function loadJob(service: ReturnType<typeof createServiceRoleClient>, agentId: string, orgId: string, jobId: string): Promise<JobRow | null> {
  const { data } = await service
    .from('agent_crawl_jobs')
    .select('id, org_id, agent_id, base_urls, queue, visited, page_cap, pages_crawled, chunks_added, near_dup_skipped, budget_skipped, status')
    .eq('id', jobId)
    .eq('agent_id', agentId)
    .eq('org_id', orgId)
    .single()
  return (data as JobRow) || null
}

async function stepJob(service: ReturnType<typeof createServiceRoleClient>, agent: AgentRow, jobId: string): Promise<NextResponse> {
  if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  const job = await loadJob(service, agent.id, agent.org_id, jobId)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (job.status !== 'running') {
    return NextResponse.json({ done: true, status: job.status, pagesCrawled: job.pages_crawled, chunksAdded: job.chunks_added })
  }

  const started = Date.now()
  const { batch, rest } = takeBatch(job.queue, job.visited, CRAWL_BATCH_PAGES, job.page_cap, job.pages_crawled)
  const hosts = new Set(job.base_urls.map((b) => { try { return new URL(b).hostname } catch { return b } }))

  const visitedNow: string[] = []
  const pageTexts: { url: string; title: string; text: string }[] = []
  const discovered: string[] = []

  for (const currentUrl of batch) {
    if (Date.now() - started > CRAWL_TIME_BUDGET_MS) break
    visitedNow.push(currentUrl)
    try {
      const res = await safeFetch(currentUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Datanautix Deep Crawler/1.0)', 'Accept': 'text/html,application/xhtml+xml,text/plain' },
        signal: AbortSignal.timeout(CRAWL_TIMEOUT),
      })
      if (!res.ok) continue
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('html') && !contentType.includes('text')) continue
      const html = await res.text()
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
      const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : currentUrl
      const text = htmlToText(html, currentUrl)
      if (text.length < 50) continue
      pageTexts.push({ url: currentUrl, title, text })
      // Enqueue same-host links (base = the matching host's origin).
      let baseUrl: URL | null = null
      try { baseUrl = new URL(currentUrl) } catch { baseUrl = null }
      if (baseUrl && hosts.has(baseUrl.hostname)) {
        for (const link of extractLinks(html, baseUrl)) discovered.push(link)
      }
    } catch { /* skip failed page, keep crawling */ }
  }

  // Which batch URLs did we NOT get to (time budget)? They go back on the queue.
  const attempted = new Set(visitedNow)
  const deferred = batch.filter((u) => !attempted.has(u))

  // Ingest this batch (boilerplate-stripped) through the shared path.
  let chunksAdded = 0, nearDup = 0, budgetSkipped = 0
  if (pageTexts.length > 0) {
    const cleaned = stripBoilerplate(pageTexts.map((p) => p.text))
    const sections = pageTexts.map((p, i) => {
      const heading = p.title.replace(/\s*[|–—]\s*.+$/, '').replace(/\s*-\s*$/, '').trim() || 'Page'
      return '## ' + heading + '\nOfficial page: ' + p.url + '\n\n' + cleaned[i]
    })
    const text = '# Deep Crawl\n\n' + sections.join('\n\n---\n\n')
    const result = await ingestKnowledgeText(service, agent, text, { source: 'deep-crawl', sourceType: 'deep-crawl' })
    chunksAdded = result.stored
    nearDup = result.near_dup_skipped
    budgetSkipped = result.budget_skipped
  }

  const newVisited = [...job.visited, ...visitedNow]
  const newPagesCrawled = job.pages_crawled + pageTexts.length
  const mergedQueue = mergeDiscovered([...deferred, ...rest], newVisited, discovered, job.page_cap, newPagesCrawled)
  const done = crawlIsDone(mergedQueue.length, newPagesCrawled, job.page_cap)

  const totals = {
    visited: newVisited,
    queue: done ? [] : mergedQueue,
    pages_crawled: newPagesCrawled,
    chunks_added: job.chunks_added + chunksAdded,
    near_dup_skipped: job.near_dup_skipped + nearDup,
    budget_skipped: job.budget_skipped + budgetSkipped,
    status: done ? 'done' : 'running',
    updated_at: new Date().toISOString(),
  }
  await service.from('agent_crawl_jobs').update(totals).eq('id', job.id).eq('org_id', agent.org_id)

  // On completion attach the standing link-integrity guardrail (idempotent).
  // Each ingested chunk already carries its real "Official page:" URL, so the
  // guardrail's "verbatim in your knowledge base" clause covers the links even
  // without a 300-entry directory block bloating the prompt.
  if (done) {
    const guardrails = Array.isArray(agent.guardrails) ? (agent.guardrails as string[]) : []
    const next = withLinkIntegrityGuardrail(guardrails)
    if (next.length !== guardrails.length) {
      await service.from('agents').update({ guardrails: next }).eq('id', agent.id).eq('org_id', agent.org_id)
    }
  }

  return NextResponse.json({
    done,
    status: totals.status,
    pagesCrawled: totals.pages_crawled,
    chunksAdded: totals.chunks_added,
    nearDupSkipped: totals.near_dup_skipped,
    budgetSkipped: totals.budget_skipped,
    queued: totals.queue.length,
    pageCap: job.page_cap,
  })
}

async function jobStatus(service: ReturnType<typeof createServiceRoleClient>, agentId: string, orgId: string, jobId: string): Promise<NextResponse> {
  // No jobId → look up the newest running job for this agent (resume-on-open).
  if (!jobId) {
    const { data } = await service
      .from('agent_crawl_jobs')
      .select('id, status, pages_crawled, chunks_added, page_cap, queue')
      .eq('agent_id', agentId).eq('org_id', orgId).eq('status', 'running')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!data) return NextResponse.json({ job: null })
    return NextResponse.json({ job: { jobId: data.id, status: data.status, pagesCrawled: data.pages_crawled, chunksAdded: data.chunks_added, pageCap: data.page_cap, queued: (data.queue as string[]).length } })
  }
  const job = await loadJob(service, agentId, orgId, jobId)
  if (!job) return NextResponse.json({ job: null })
  return NextResponse.json({ job: { jobId: job.id, status: job.status, pagesCrawled: job.pages_crawled, chunksAdded: job.chunks_added, pageCap: job.page_cap, queued: job.queue.length } })
}

async function cancelJob(service: ReturnType<typeof createServiceRoleClient>, agentId: string, orgId: string, jobId: string): Promise<NextResponse> {
  if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  await service.from('agent_crawl_jobs').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', jobId).eq('agent_id', agentId).eq('org_id', orgId).eq('status', 'running')
  return NextResponse.json({ canceled: true })
}
