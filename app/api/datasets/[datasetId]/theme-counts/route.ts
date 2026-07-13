// app/api/datasets/[datasetId]/theme-counts/route.ts
// Server-side theme counting using dataset_rows_flat + SQL regex matching.
// Falls back to batch streaming if flat table is empty.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { countNonEmptyRows } from '@/lib/nonEmptyCount'
import { memberRowCounts } from '@/lib/signalStats'
import { kwPatternFragment } from '@/lib/themeUtils'
import { sampledSignalCounts, scaleSampledCount, SIGNAL_SAMPLE_CAP, type SampledSignalCounts } from '@/lib/sampledSignalCounts'

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
    rowIds?: unknown            // filtered-view flat row ids → prevalence bars honor active filters (sql/170)
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

  // Active filters (Brief F escalation #2): the client sends the filtered
  // view's flat row-id set (a subset of the loaded 50K sample). Restrict the
  // prevalence numerator/denominator to it so the Charts theme bars reflect
  // filters instead of dataset-wide %. Bounded (≤ sample), so the filtered
  // path is EXACT — sampling (below) is only for scale on the unfiltered path.
  let filterRowIds: number[] | null = Array.isArray(body.rowIds)
    ? body.rowIds.filter((x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)).slice(0, 200000)
    : null
  if (filterRowIds && filterRowIds.length === 0) filterRowIds = null

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

  // Row totals from the stored datasets.row_count column (O(1)). Replaces the
  // old exact head-count-per-member loop (an O(N) index scan each, on every
  // TextMine/Charts visit) AND gates the sampled path below.
  const rowCounts = await memberRowCounts(service, datasetIds)
  let totalFlat = 0
  for (const c of rowCounts.values()) totalFlat += c

  // Stored 0 could be a stale row_count on an out-of-band load (it has
  // happened) — confirm with real head counts before concluding "no data".
  // Empty datasets are trivially cheap to count, so this guard costs nothing
  // on the path it protects.
  if (totalFlat === 0) {
    for (const did of datasetIds) {
      const { count: flatCount } = await service
        .from('dataset_rows_flat')
        .select('id', { count: 'exact', head: true })
        .eq('dataset_id', did)
      if (flatCount) rowCounts.set(did, flatCount)
      totalFlat += flatCount || 0
    }
  }

  if (totalFlat > 0) {
    // SQL-based counting, summed across the resolved dataset IDs (1 entry
    // for regular datasets, N for collections).
    //
    // Members ABOVE the 50K sampling cap: ONE single-pass sampled RPC
    // (sql/162, deterministic idx_drf_sample order — the same sample the bulk
    // rows route serves) yields the non-empty counts AND every theme's count,
    // scaled to the member's total. The exact per-theme full scans blow the
    // 8s DB statement timeout there (785K rows ≈ 1.4GB of jsonb per scan,
    // prod 2026-07-11). At or under the cap: exact counts, unchanged. If the
    // sampled RPC fails/isn't migrated yet, fall through to the exact path.
    // When filters are active the row-id set is bounded (≤ sample) so the exact
    // path with p_row_ids is cheap and correct — skip sampling entirely (a
    // sampled scaling denominator would be wrong for a filtered subset).
    const sampledByMember = new Map<string, SampledSignalCounts>()
    if (!filterRowIds) {
      await Promise.all(datasetIds.map(async did => {
        if ((rowCounts.get(did) || 0) <= SIGNAL_SAMPLE_CAP) return
        try {
          sampledByMember.set(did, await sampledSignalCounts(service, did, fields, themes))
        } catch { /* exact path below — pre-sql/162 behavior */ }
      }))
    }

    // count_theme_matches with filter-awareness (sql/170) + PGRST202 fallback:
    // append p_row_ids only when filters are active; drop it on an un-migrated
    // DB (filters ignored, the pre-fix behavior) instead of erroring.
    async function themeMatchCount(did: string, patterns: string[]): Promise<number> {
      const base = { p_dataset_id: did, p_field_keys: fields, p_keywords: patterns }
      if (filterRowIds) {
        const r = await service.rpc('count_theme_matches', { ...base, p_row_ids: filterRowIds })
        if (!r.error || r.error.code !== 'PGRST202') return Number(r.data) || 0
      }
      const { data } = await service.rpc('count_theme_matches', base)
      return Number(data) || 0
    }

    // Get total non-empty rows (denominator), summed across members
    let totalNonEmpty = 0
    for (const [fi, f] of fields.entries()) {
      let fieldTotal = 0
      for (const did of datasetIds) {
        const s = sampledByMember.get(did)
        if (s) {
          fieldTotal += scaleSampledCount(s.recordsPerField[fi] || 0, rowCounts.get(did) || 0, s.scanned)
          continue
        }
        // Comma-safe count (sql/161) — the raw PostgREST filter used here
        // silently returned 0 for question-sentence column names, zeroing
        // the percentage denominator. Filter-scoped via p_row_ids (sql/170)
        // when active. Degrade to 0 on failure (old behavior).
        try { fieldTotal += await countNonEmptyRows(service, did, f, filterRowIds) } catch { /* keep old swallow */ }
      }
      totalNonEmpty = Math.max(totalNonEmpty, fieldTotal)
    }

    const counts = await runPool(themes.map((t, ti) => async () => {
      const kws = (t.keywords || []).filter(Boolean)
      if (!kws.length) return { id: t.id, count: 0, percentage: 0 }

      let c = 0
      for (const did of datasetIds) {
        const s = sampledByMember.get(did)
        if (s) {
          c += scaleSampledCount(s.perTheme[ti] || 0, rowCounts.get(did) || 0, s.scanned)
          continue
        }
        // Canonical fragments (kwPatternFragment) — same patterns the client
        // matcher compiles, so SQL counts and client recounts agree. The RPC
        // splices these unescaped into its \m(…|…) alternation, which is why
        // raw keywords used to mean exact-adjacency phrases only. Filter-scoped
        // via p_row_ids (sql/170) when active.
        c += await themeMatchCount(did, kws.map(kwPatternFragment))
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
        .map(t => ({ id: t.id, keywords: (t.keywords || []).filter(Boolean).map(kwPatternFragment) }))

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
            p_keywords: kws.map(kwPatternFragment),
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

    // `sampled` — counts were computed over the deterministic 50K sample and
    // scaled (any member above the cap); the client labels them approximate.
    // `sampleSize` — rows actually scanned (sampled members' scan + exact
    // members' full rows), the honest "N of M responses sampled" numerator.
    let sampleSize = 0
    for (const did of datasetIds) {
      const s = sampledByMember.get(did)
      sampleSize += s ? s.scanned : (rowCounts.get(did) || 0)
    }
    return NextResponse.json({ counts, totalNonEmpty, sampled: sampledByMember.size > 0, sampleSize, cooccurrence: cooccurrenceMatrix, topical: topicalWords, dimensions: themeDimensions })
  }

  // No flat rows for this dataset/collection → nothing to count. (The legacy
  // dataset_rows batch-streaming fallback was removed 2026-07-02; dataset_rows_flat
  // is the sole source of truth, so totalFlat === 0 means there is no data.)
  return NextResponse.json({
    counts: themes.map(t => ({ id: t.id, count: 0, percentage: 0 })),
    totalNonEmpty: 0,
  })
}
