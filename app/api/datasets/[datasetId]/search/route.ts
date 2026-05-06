// app/api/datasets/[datasetId]/search/route.ts
// GET — full-text search across dataset rows
// Query params:
//   q        — search query (required)
//   limit    — max results (default 50, max 200)
//   offset   — pagination offset (default 0)
//   ai       — if 'true', use AI to expand/interpret the query before searching

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: { datasetId: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify dataset ownership
  const { data: dataset } = await supabase.from('datasets').select('org_id, source').eq('id', params.datasetId).single()
  if (!dataset || dataset.org_id !== userData.org_id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
        usage: { org_id: userData.org_id, resource_type: 'dataset', resource_id: params.datasetId, event_type: 'search' },
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

  // Search each target via .textSearch (websearch_to_tsquery, OR semantics).
  // For multi-target collections, fetch up to `limit` from each then trim;
  // we accept that ordering across members is by member sort_order, not rank.
  type Hit = { id: number; row_index: number; data: Record<string, unknown>; rank: number; headline: string }
  var results: Hit[] = []
  var total = 0

  for (var ti = 0; ti < targets.length; ti++) {
    var t = targets[ti]
    var { data: matched, error: searchErr } = await service
      .from('dataset_rows_flat')
      .select('id, row_index, data')
      .eq('dataset_id', t.datasetId)
      .textSearch('tsv', tsQueryStr, { type: 'websearch', config: 'english' })
      .order('row_index', { ascending: true })
      .range(0, limit - 1)
    if (searchErr) return NextResponse.json({ error: searchErr.message }, { status: 500 })

    for (var ri = 0; ri < (matched || []).length; ri++) {
      var r = matched![ri]
      var data: Record<string, unknown> = r.data || {}
      if (t.label) data = { ...data, _collection_label: t.label }
      results.push({ id: r.id, row_index: r.row_index, data, rank: 1, headline: '' })
    }

    var { count } = await service
      .from('dataset_rows_flat')
      .select('id', { count: 'exact', head: true })
      .eq('dataset_id', t.datasetId)
      .textSearch('tsv', tsQueryStr, { type: 'websearch', config: 'english' })
    total += count || 0
  }

  // Apply offset/limit across the unioned result set
  var paged = results.slice(offset, offset + limit)

  return NextResponse.json({
    results: paged,
    total,
    query: rawQuery,
    searchQuery: searchQuery !== rawQuery ? searchQuery : undefined,
    aiInterpretation,
  })
}
