// app/api/datasets/[datasetId]/search/route.ts
// GET — full-text search across dataset rows
// Query params:
//   q        — search query (required)
//   limit    — max results (default 50, max 200)
//   offset   — pagination offset (default 0)
//   ai       — if 'true', expand the query with AI synonyms then re-rank candidates by relevance

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { callAI } from '@/lib/ai'
import { serverError } from '@/lib/apiError'

// Number of candidates to pull from full-text per target before AI re-ranking.
// Larger pools give better recall but cost more tokens / latency.
const AI_CANDIDATE_POOL = 100
// Drop re-ranked candidates with relevance below this threshold.
const AI_RELEVANCE_THRESHOLD = 0.3

function snippetFromRow(data: Record<string, unknown>, maxChars: number): string {
  const parts: string[] = []
  for (const k in data) {
    const v = data[k]
    if (typeof v === 'string' && v.length > 2 && /[a-zA-Z]/.test(v)) {
      parts.push(v)
    }
  }
  const joined = parts.join(' | ')
  return joined.length > maxChars ? joined.slice(0, maxChars) + '…' : joined
}

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: Promise<{ datasetId: string }> }

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify dataset access (admin Phase E: super-admins cross-org)
  const { data: dataset } = await supabase.from('datasets').select('org_id, source').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

  const url = req.nextUrl
  var rawQuery = (url.searchParams.get('q') || '').trim()
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50')))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0'))
  const useAI = url.searchParams.get('ai') === 'true'

  if (!rawQuery) return NextResponse.json({ error: 'q parameter required' }, { status: 400 })

  const service = createServiceRoleClient()

  // AI query expansion: natural language → list of synonyms (OR-matched)
  var searchQuery = rawQuery
  var aiInterpretation: string | null = null
  var isExpanded = false

  if (useAI) {
    try {
      var result = await callAI({
        tier: 'fast',
        maxTokens: 100,
        timeoutMs: 5000,
        system: 'You are a search query optimizer. The user wants to search through survey responses, social comments, or discussion transcripts.\n\n' +
          'Given their natural language query, extract the key search terms that would match relevant text.\n' +
          'Focus on the core concepts, not filler words.\n' +
          'If the query implies sentiment (e.g., "negative comments about..."), include sentiment-related synonyms.\n' +
          'If the query mentions a demographic or attribute, include related terms.\n\n' +
          'Return ONLY the search terms, space-separated. No explanation.\n' +
          'Example: "find comments from parents worried about school safety" → "parent parents school safety worried concern unsafe"',
        messages: [{ role: 'user', content: rawQuery }],
        usage: { org_id: dataset.org_id, resource_type: 'dataset', resource_id: params.datasetId, event_type: 'search' },
      })
      var expanded = (result.text || '').trim()
      if (expanded && expanded.length > 2) {
        aiInterpretation = expanded
        searchQuery = expanded
        isExpanded = true
      }
    } catch {}
  }

  // Build a websearch-format query.
  // For expanded queries, OR the synonyms so any of them matches (vs. the default AND).
  // websearch_to_tsquery treats the literal token "OR" as an OR operator.
  var tsQueryStr = searchQuery
  if (isExpanded) {
    var terms = searchQuery.split(/\s+/).filter(function(w: string) { return w.length > 1 })
    if (terms.length > 1) tsQueryStr = terms.join(' OR ')
  }

  // Resolve dataset IDs to search across. For collections, union member datasets;
  // each member's row gets a `_collection_label` to identify which dataset it came from.
  var targets: Array<{ datasetId: string; label: string | null }> = [{ datasetId: params.datasetId, label: null }]
  if ((dataset as any).source === 'collection') {
    const { data: collection } = await service.from('collections').select('id').eq('dataset_id', params.datasetId).single()
    if (collection) {
      const { data: members } = await service
        .from('collection_members')
        .select('dataset_id, label')
        .eq('collection_id', collection.id)
        .order('sort_order', { ascending: true })
      if (members && members.length > 0) {
        targets = members.map(function(m: any) { return { datasetId: m.dataset_id, label: m.label } })
      } else {
        targets = []
      }
    }
  }

  // Search each target. Prefer the search_dataset_rows RPC because it returns rows
  // ordered by ts_rank (full-text relevance), so the AI re-ranker sees the densest
  // matches instead of an arbitrary slice by row_index. Fall back to .textSearch if
  // the RPC isn't available or returns zero (e.g. stale function still using
  // plainto_tsquery on an OR-expanded query).
  type Hit = { id: number; row_index: number; data: Record<string, unknown>; rank: number; headline: string }
  const candidatePool = useAI ? AI_CANDIDATE_POOL : limit
  const perTargetCap = targets.length > 0 ? Math.ceil(candidatePool / targets.length) : candidatePool
  var results: Hit[] = []
  var total = 0

  for (var ti = 0; ti < targets.length; ti++) {
    var t = targets[ti]
    var matched: Array<{ id: number; row_index: number; data: Record<string, unknown> }> | null = null

    // Try ts_rank-ordered RPC first
    const rpcResult = await service.rpc('search_dataset_rows', {
      p_dataset_id: t.datasetId,
      p_query: tsQueryStr,
      p_limit: perTargetCap,
      p_offset: 0,
    })
    if (!rpcResult.error && rpcResult.data && rpcResult.data.length > 0) {
      matched = rpcResult.data.map(function(r: any) { return { id: r.id, row_index: r.row_index, data: r.data || {} } })
    } else {
      // Fall back to .textSearch (no rank ordering, but works without the RPC update)
      const fb = await service
        .from('dataset_rows_flat')
        .select('id, row_index, data')
        .eq('dataset_id', t.datasetId)
        .textSearch('tsv', tsQueryStr, { type: 'websearch', config: 'english' })
        .order('row_index', { ascending: true })
        .range(0, perTargetCap - 1)
      if (fb.error) return serverError(fb.error, 'datasets.search', { orgId })
      matched = (fb.data || []).map(function(r: any) { return { id: r.id, row_index: r.row_index, data: r.data || {} } })
    }

    for (var ri = 0; ri < (matched || []).length; ri++) {
      var r = matched![ri]
      var data: Record<string, unknown> = r.data || {}
      if (t.label) data = Object.assign({}, data, { _collection_label: t.label })
      results.push({ id: r.id, row_index: r.row_index, data, rank: 1, headline: '' })
    }

    var { count } = await service
      .from('dataset_rows_flat')
      .select('id', { count: 'exact', head: true })
      .eq('dataset_id', t.datasetId)
      .textSearch('tsv', tsQueryStr, { type: 'websearch', config: 'english' })
    total += count || 0
  }

  // AI re-ranking: score each candidate by relevance to the user's intent (not just keyword presence).
  // We pass the candidates to a fast model with stable [N] indexes and ask for "index|score" per line.
  var reranked = false
  if (useAI && results.length > 1) {
    try {
      const numbered = results.map(function(r, i) {
        return '[' + (i + 1) + '] ' + snippetFromRow(r.data, 240)
      }).join('\n\n')

      const rankResult = await callAI({
        tier: 'fast',
        maxTokens: 1500,
        timeoutMs: 20000,
        system:
          'You are a strict search relevance scorer. Score each candidate snippet 0.0-1.0 for how fully it answers the user\'s query.\n\n' +
          'CRITICAL: identify every distinct concern in the query (split on "and", "+", commas, "with", lists). The score MUST reflect how many concerns the snippet actually addresses with substance — not just keyword presence.\n\n' +
          'For multi-concern queries (e.g. "X and Y", "A, B, and C"):\n' +
          '- A snippet must address ALL concerns substantively to score above 0.75.\n' +
          '- Addressing only one of two concerns: maximum 0.55.\n' +
          '- Addressing two of three concerns: maximum 0.65.\n' +
          'For single-concern queries:\n' +
          '- Snippet directly and substantively about the topic: 0.8-1.0.\n' +
          '- Mentions the topic in passing: 0.4-0.6.\n' +
          'Always:\n' +
          '- Coincidental keyword match without intent alignment: 0.0-0.2.\n' +
          '- Treat paraphrases as full matches ("staff hurried us" = "rushed service").\n\n' +
          'Return ONLY one line per candidate in the form "INDEX|SCORE". No explanation. No header. No extra text.',
        messages: [{ role: 'user', content: 'Query: ' + rawQuery + '\n\nCandidates:\n' + numbered }],
        usage: { org_id: dataset.org_id, resource_type: 'dataset', resource_id: params.datasetId, event_type: 'search_rerank' },
      })

      const scores = new Map<number, number>()
      const lines = (rankResult.text || '').split('\n')
      for (let li = 0; li < lines.length; li++) {
        const m = lines[li].match(/(\d+)\s*[|:]\s*([01](?:\.\d+)?)/)
        if (m) {
          const idx = parseInt(m[1]) - 1
          const score = parseFloat(m[2])
          if (idx >= 0 && idx < results.length && !isNaN(score)) {
            scores.set(idx, score)
          }
        }
      }

      if (scores.size > 0) {
        const annotated = results.map(function(r, i) { return Object.assign({}, r, { rank: scores.get(i) ?? 0 }) })
        annotated.sort(function(a, b) { return b.rank - a.rank })
        results = annotated.filter(function(r) { return r.rank >= AI_RELEVANCE_THRESHOLD })
        reranked = true
      }
    } catch (err) {
      console.error({ at: 'search/rerank', msg: "failed, falling back to keyword order", err: err })
    }
  }

  // Apply offset/limit across the (possibly re-ranked) result set
  var paged = results.slice(offset, offset + limit)

  return NextResponse.json({
    results: paged,
    total: reranked ? results.length : total,
    rawTotal: total,
    reranked,
    query: rawQuery,
    searchQuery: searchQuery !== rawQuery ? searchQuery : undefined,
    aiInterpretation,
  })
}
