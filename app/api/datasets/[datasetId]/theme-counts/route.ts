// app/api/datasets/[datasetId]/theme-counts/route.ts
// Server-side theme counting using dataset_rows_flat + SQL regex matching.
// Falls back to batch streaming if flat table is empty.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

interface Props { params: { datasetId: string } }

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, { params }: Props) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    themes: { id: string; keywords: string[] }[]
    fields: string[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { themes, fields } = body
  if (!themes?.length || !fields?.length) {
    return NextResponse.json({ error: 'Provide themes and fields' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Resolve the set of dataset IDs that actually hold the rows. For a
  // regular dataset that's just [datasetId]. For a collection, rows live
  // in the member datasets — collections themselves have nothing in
  // dataset_rows_flat. Sum counts across members.
  const { data: datasetMeta } = await service
    .from('datasets')
    .select('source')
    .eq('id', params.datasetId)
    .single()

  let datasetIds: string[] = [params.datasetId]
  if ((datasetMeta as { source?: string } | null)?.source === 'collection') {
    const { data: collection } = await service
      .from('collections')
      .select('id')
      .eq('dataset_id', params.datasetId)
      .single()
    if (collection) {
      const { data: members } = await service
        .from('collection_members')
        .select('dataset_id')
        .eq('collection_id', (collection as { id: string }).id)
      datasetIds = ((members || []) as { dataset_id: string }[]).map(m => m.dataset_id)
    } else {
      datasetIds = []
    }
  }

  // Check if any of the underlying flat tables have data
  let totalFlat = 0
  for (const did of datasetIds) {
    const { count: flatCount } = await service
      .from('dataset_rows_flat')
      .select('id', { count: 'exact', head: true })
      .eq('dataset_id', did)
    totalFlat += flatCount || 0
  }

  if (totalFlat > 0) {
    // SQL-based counting using the count_theme_matches function, summed
    // across the resolved dataset IDs (1 entry for regular datasets, N
    // for collections).
    const counts: { id: string; count: number; percentage: number }[] = []

    // Get total non-empty rows (denominator), summed across members
    let totalNonEmpty = 0
    for (const f of fields) {
      let fieldTotal = 0
      for (const did of datasetIds) {
        const { count: nonEmpty } = await service
          .from('dataset_rows_flat')
          .select('id', { count: 'exact', head: true })
          .eq('dataset_id', did)
          .not('data->' + f, 'is', null)
          .neq('data->>' + f, '')
        fieldTotal += nonEmpty || 0
      }
      totalNonEmpty = Math.max(totalNonEmpty, fieldTotal)
    }

    for (const t of themes) {
      const kws = (t.keywords || []).filter(Boolean)
      if (!kws.length) { counts.push({ id: t.id, count: 0, percentage: 0 }); continue }

      let c = 0
      for (const did of datasetIds) {
        const { data: matchCount } = await service.rpc('count_theme_matches', {
          p_dataset_id: did,
          p_field_keys: fields,
          p_keywords: kws,
        })
        c += Number(matchCount) || 0
      }

      counts.push({
        id: t.id,
        count: c,
        percentage: totalNonEmpty > 0 ? Math.round(c / totalNonEmpty * 100) : 0,
      })
    }

    return NextResponse.json({ counts, totalNonEmpty })
  }

  // Fallback: batch streaming (same as before but simplified)
  const { expandLemma } = await import('@/lib/lemmas')

  function buildKwRegex(kw: string): RegExp {
    const forms = expandLemma(kw)
    const seen: Record<string, boolean> = {}
    const alts: string[] = []
    for (let i = 0; i < forms.length; i++) {
      const alt = forms[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*'
      if (!seen[alt]) { seen[alt] = true; alts.push(alt) }
    }
    const escOrig = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*'
    if (!seen[escOrig]) alts.push(escOrig)
    return new RegExp('(?<![a-z])(?:' + alts.join('|') + ')', 'i')
  }

  const themeRegexes = themes.map(t => ({
    id: t.id,
    regexes: (t.keywords || []).filter(Boolean).map(buildKwRegex),
  }))

  const BATCH_SIZE = 100
  let page = 0, hasMore = true, totalNonEmpty = 0
  const themeCounts: Record<string, number> = {}
  for (const t of themes) themeCounts[t.id] = 0

  while (hasMore) {
    const { data: batches } = await service
      .from('dataset_rows')
      .select('rows')
      .eq('dataset_id', params.datasetId)
      .order('batch_index', { ascending: true })
      .range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1)

    if (!batches || batches.length === 0) { hasMore = false; break }

    for (const batch of batches) {
      for (const row of ((batch as any).rows || [])) {
        const text = fields.map(f => String(row[f] || '')).join(' ').toLowerCase().trim()
        if (!text) continue
        totalNonEmpty++
        for (const t of themeRegexes) {
          if (t.regexes.length > 0 && t.regexes.some(re => re.test(text))) {
            themeCounts[t.id]++
          }
        }
      }
    }

    if (batches.length < BATCH_SIZE) hasMore = false
    page++
  }

  const counts = themes.map(t => ({
    id: t.id,
    count: themeCounts[t.id],
    percentage: totalNonEmpty > 0 ? Math.round(themeCounts[t.id] / totalNonEmpty * 100) : 0,
  }))

  return NextResponse.json({ counts, totalNonEmpty })
}
