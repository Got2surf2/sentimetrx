// app/api/datasets/[datasetId]/theme-counts/route.ts
// Server-side theme counting using dataset_rows_flat + SQL regex matching.
// Falls back to batch streaming if flat table is empty.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

interface Props { params: Promise<{ datasetId: string }> }

// Bounded promise pool — keeps at most `limit` RPCs in flight at once
// (Supabase Micro pooler; unbounded Promise.all would exhaust connections).
async function runPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }))
  return results
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, props: Props) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cross-org gate: this route reads theme/keyword counts + topical words over
  // the dataset's rows with the service-role client (RLS-bypassing), so confirm
  // the caller's org owns the dataset before any read — without this any authed
  // user could mine another tenant's reviews by id (admin-org bypass preserved).
  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  {
    const svc = createServiceRoleClient()
    const { data: dsOrg } = await svc.from('datasets').select('org_id').eq('id', params.datasetId).single()
    if (!dsOrg) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
    if (!isAdmin && (dsOrg as { org_id?: string }).org_id !== orgId) {
      return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
    }
  }

  let body: {
    themes: { id: string; keywords: string[] }[]
    fields: string[]
    cooccurrence?: boolean      // when true, also compute pairwise theme intersection counts
    topical?: boolean           // when true, also extract topical-word lists per theme
    dimensions?: boolean        // when true, also compute the per-theme Dimensions (taxonomy) breakdown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { themes, fields, cooccurrence, topical, dimensions } = body
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

    const counts = await runPool(themes.map(t => async () => {
      const kws = (t.keywords || []).filter(Boolean)
      if (!kws.length) return { id: t.id, count: 0, percentage: 0 }

      let c = 0
      for (const did of datasetIds) {
        const { data: matchCount } = await service.rpc('count_theme_matches', {
          p_dataset_id: did,
          p_field_keys: fields,
          p_keywords: kws,
        })
        c += Number(matchCount) || 0
      }

      return {
        id: t.id,
        count: c,
        percentage: totalNonEmpty > 0 ? Math.round(c / totalNonEmpty * 100) : 0,
      }
    }), 5)

    // Optional: full co-occurrence matrix via compute_theme_cooccurrence_matrix.
    // One RPC per member dataset returns the full N×N matrix in a single
    // row scan. Sum the per-member matrices for collections. ~10× faster
    // than the older pairwise count_theme_intersection loop (Capital
    // Grille: 1.8s for the matrix vs ~9s pairwise).
    let cooccurrenceMatrix: Record<string, Record<string, number>> | undefined
    if (cooccurrence) {
      cooccurrenceMatrix = {}
      const themesPayload = themes
        .filter(t => (t.keywords || []).filter(Boolean).length > 0)
        .map(t => ({ id: t.id, keywords: (t.keywords || []).filter(Boolean) }))

      const memberMatrices = await runPool(datasetIds.map(did => async () => {
        const { data } = await service.rpc('compute_theme_cooccurrence_matrix', {
          p_dataset_id: did,
          p_field_keys: fields,
          p_themes: themesPayload,
        })
        return (data as Record<string, Record<string, number>> | null) || {}
      }), 5)
      for (const memberMatrix of memberMatrices) {
        // Merge into the accumulator
        for (const [a, bs] of Object.entries(memberMatrix)) {
          if (!cooccurrenceMatrix[a]) cooccurrenceMatrix[a] = {}
          for (const [b, n] of Object.entries(bs)) {
            cooccurrenceMatrix[a][b] = (cooccurrenceMatrix[a][b] || 0) + Number(n)
          }
        }
      }
    }

    // Optional: topical words per theme. Sum word counts across member
    // datasets so a single "Often mentioned with" list represents the
    // whole collection.
    let topicalWords: Record<string, [string, number][]> | undefined
    if (topical) {
      const topicalEntries = await runPool(themes.map(t => async (): Promise<[string, [string, number][]]> => {
        const kws = (t.keywords || []).filter(Boolean)
        if (!kws.length) return [t.id, []]
        // Merge per-member word counts
        const merged: Record<string, number> = {}
        for (const did of datasetIds) {
          const { data } = await service.rpc('extract_theme_topical_words', {
            p_dataset_id: did,
            p_field_keys: fields,
            p_keywords: kws,
            p_extra_excludes: [],
            p_max_results: 15,  // a bit wider than 5 so the post-merge top-5 has room
          })
          const pairs = (data as [string, number][] | null) || []
          for (const [w, c] of pairs) {
            merged[w] = (merged[w] || 0) + Number(c)
          }
        }
        return [t.id, Object.entries(merged)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)]
      }), 5)
      topicalWords = Object.fromEntries(topicalEntries)
    }

    // Optional: per-theme Dimensions breakdown. For each theme, the top
    // taxonomy sub-buckets (across all 7 axes) carried by the reviews that
    // match the theme — the classification analog of "Items mentioned".
    // Summed across member datasets for collections; only meaningful when the
    // dataset has been classified (datasets without taxonomy rows just return
    // empty arrays, which the client suppresses).
    let themeDimensions: Record<string, { axis: string; sub: string; count: number }[]> | undefined
    if (dimensions) {
      const dimensionEntries = await runPool(themes.map(t => async (): Promise<[string, { axis: string; sub: string; count: number }[]]> => {
        const kws = (t.keywords || []).filter(Boolean)
        if (!kws.length) return [t.id, []]
        const merged: Record<string, { axis: string; sub: string; count: number }> = {}
        for (const did of datasetIds) {
          const { data } = await service.rpc('theme_dimension_counts', {
            p_dataset_id: did,
            p_field_keys: fields,
            p_keywords: kws,
            p_limit: 12,   // a bit wider than the card shows so the post-merge top-N has room
          })
          for (const r of ((data || []) as { axis: string; sub: string; count: number }[])) {
            const k = r.axis + ':' + r.sub
            if (!merged[k]) merged[k] = { axis: r.axis, sub: r.sub, count: 0 }
            merged[k].count += Number(r.count) || 0
          }
        }
        return [t.id, Object.values(merged)
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)]
      }), 5)
      themeDimensions = Object.fromEntries(dimensionEntries)
    }

    return NextResponse.json({ counts, totalNonEmpty, cooccurrence: cooccurrenceMatrix, topical: topicalWords, dimensions: themeDimensions })
  }

  // No flat rows for this dataset/collection → nothing to count. (The legacy
  // dataset_rows batch-streaming fallback was removed 2026-07-02; dataset_rows_flat
  // is the sole source of truth, so totalFlat === 0 means there is no data.)
  return NextResponse.json({
    counts: themes.map(t => ({ id: t.id, count: 0, percentage: 0 })),
    totalNonEmpty: 0,
  })
}
