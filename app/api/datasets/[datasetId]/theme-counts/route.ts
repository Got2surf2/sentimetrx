// app/api/datasets/[datasetId]/theme-counts/route.ts
// Server-side theme counting using dataset_rows_flat + SQL regex matching.
// Falls back to batch streaming if flat table is empty.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { countNonEmptyRows } from '@/lib/nonEmptyCount'
import { memberRowCounts } from '@/lib/signalStats'
import { kwPatternFragment } from '@/lib/themeUtils'
import { sampledSignalCounts, SIGNAL_SAMPLE_CAP, type SampledSignalCounts } from '@/lib/sampledSignalCounts'
import { sampledThemeCooccurrence, sampledThemeTopical, sampledThemeDimensions, sampledThemeExtras } from '@/lib/sampledThemeExtras'
import { themeCountsKey, readThemeCountsCache, writeThemeCountsCache } from '@/lib/themeCountsCache'

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
    // Two-phase load (2026-08-15). The theme CARDS need only `counts` +
    // `totalNonEmpty`; co-occurrence and Dimensions fill chip rows that already
    // render skeleton placeholders. Cold, the counts scan is ~13s and the extras
    // are ~18s more, so bundling them made the cards wait ~33s for data they
    // don't use. The client now asks for counts first (cooccurrence/dimensions
    // false) and the extras second with this flag, which skips the counts work
    // entirely instead of recomputing it. Absent = the original single-request
    // behaviour, so any other caller is unaffected.
    extrasOnly?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { themes, fields, cooccurrence, topical, dimensions } = body
  const extrasOnly = body.extrasOnly === true
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

  // Server-side cache (2026-08-14). Above the sampling cap a cold request runs
  // THREE independent 10-page keyset scans over the 50K sample — measured 33.4s
  // on the 128,619-row Outback dataset (13.4 counts + 9.1 co-occurrence + 10.9
  // dimensions). The only cache was the client's in-memory one, which dies on
  // page reload, so every fresh TextMine load paid it again. Keyed on the theme
  // model + fields + extras flags + row count, so a theme edit or a sync
  // invalidates exactly as they already do for signal_stats.
  //
  // Filtered requests are deliberately NOT cached: the row-id set is per-view
  // and the exact path over a bounded subset is cheap anyway.
  const cacheKey = filterRowIds ? null : themeCountsKey({ themes, fields, cooccurrence, topical, dimensions, extrasOnly })
  let analyticsBlob: Record<string, unknown> | null = null
  if (cacheKey) {
    const { data: stateRow } = await service
      .from('dataset_state').select('analytics').eq('dataset_id', params.datasetId).maybeSingle()
    analyticsBlob = (stateRow as { analytics?: Record<string, unknown> | null } | null)?.analytics || null
    const hit = readThemeCountsCache(analyticsBlob, cacheKey, totalFlat)
    if (hit) return NextResponse.json(hit)
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
    // extrasOnly skips this scan outright — it is ~13s cold and produces only
    // the counts/denominator, which that phase does not return.
    if (!filterRowIds && !extrasOnly) {
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
    //
    // Two-count model (sql/181): the prevalence numerator is gated to
    // substantive rows (p_substantive_only) so it divides by the substantive
    // denominator in lockstep — a full-match numerator over a substantive
    // denominator would overstate every theme's fit.
    async function themeMatchCount(did: string, patterns: string[]): Promise<number> {
      const base = { p_dataset_id: did, p_field_keys: fields, p_keywords: patterns, p_substantive_only: true }
      if (filterRowIds) {
        const r = await service.rpc('count_theme_matches', { ...base, p_row_ids: filterRowIds })
        if (!r.error || r.error.code !== 'PGRST202') return Number(r.data) || 0
      }
      const { data } = await service.rpc('count_theme_matches', base)
      return Number(data) || 0
    }

    // Total SUBSTANTIVE comments (denominator), summed across members — the
    // two-count-model base for every theme prevalence % (sql/178/179/181).
    let totalNonEmpty = 0
    for (const [fi, f] of (extrasOnly ? [] : fields.entries())) {
      let fieldTotal = 0
      for (const did of datasetIds) {
        const s = sampledByMember.get(did)
        if (s) {
          // Substantive denominator (two-count model), EXACT over the 50K sample
          // — Model A (owner 2026-07-14): the sample is the view, so no scaling
          // to the full dataset (the "Sampled" chip is the disclosure).
          fieldTotal += s.recordsSubstantivePerField[fi] || 0
          continue
        }
        // Comma-safe count (sql/161) — the raw PostgREST filter used here
        // silently returned 0 for question-sentence column names, zeroing
        // the percentage denominator. Filter-scoped via p_row_ids (sql/170)
        // when active. Substantive-gated (sql/179) for the two-count base.
        // Degrade to 0 on failure (old behavior).
        try { fieldTotal += await countNonEmptyRows(service, did, f, filterRowIds, true) } catch { /* keep old swallow */ }
      }
      totalNonEmpty = Math.max(totalNonEmpty, fieldTotal)
    }

    const counts = extrasOnly ? [] : await runPool(themes.map((t, ti) => async () => {
      const kws = (t.keywords || []).filter(Boolean)
      if (!kws.length) return { id: t.id, count: 0, percentage: 0 }

      let c = 0
      for (const did of datasetIds) {
        const s = sampledByMember.get(did)
        if (s) {
          // Substantive per-theme numerator (sql/181), EXACT over the 50K sample
          // (Model A — no scaling), in lockstep with the substantive denominator.
          c += s.perThemeSubstantive[ti] || 0
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
    // ── One walk for BOTH extras (sql/187) ───────────────────────────────
    // Co-occurrence and Dimensions used to page the same 50,000 scattered rows
    // independently. That walk IS the cost: the sample is hash-ordered so it's
    // physically scattered, and its price is buffer-cache residency — measured
    // 2,967 disk reads / 1,895ms for one 5,000-row page on the 128K dataset vs
    // 11 reads / 28ms on the 56K one, same rows, same buffers touched. Merging
    // the walks measured 29% off the extras phase with byte-identical output.
    // Anything not covered here (below the cap, a collection member, a
    // pre-migration database) still falls through to the per-extra pagers.
    const oneWalk = new Map<string, {
      cooccurrence: Record<string, Record<string, number>>
      dimensions: Record<string, Record<string, { axis: string; sub: string; count: number }>>
    }>()
    if (!filterRowIds && (cooccurrence || dimensions)) {
      const walkThemes = themes
        .filter(t => (t.keywords || []).filter(Boolean).length > 0)
        .map(t => ({ id: t.id, keywords: (t.keywords || []).filter(Boolean).map(kwPatternFragment) }))
      if (walkThemes.length) {
        await Promise.all(datasetIds.map(async did => {
          if ((rowCounts.get(did) || 0) <= SIGNAL_SAMPLE_CAP) return
          try {
            oneWalk.set(did, await sampledThemeExtras(
              service, did, fields, walkThemes, rowCounts.get(did) || 0,
              { cooccurrence: !!cooccurrence, dimensions: !!dimensions }))
          } catch { /* per-extra pagers below */ }
        }))
      }
    }

    let cooccurrenceMatrix: Record<string, Record<string, number>> | undefined
    if (cooccurrence) {
      cooccurrenceMatrix = {}
      const themesPayload = themes
        .filter(t => (t.keywords || []).filter(Boolean).length > 0)
        .map(t => ({ id: t.id, keywords: (t.keywords || []).filter(Boolean).map(kwPatternFragment) }))

      // Above the 50K cap the exact matrix full-scans and 57014s → sampled twin
      // (sql/173) keyset-pages idx_drf_sample + scales; below the cap, exact.
      const memberMatrices = await runPool(datasetIds.map(did => async () => {
        const walked = oneWalk.get(did)
        if (walked) return walked.cooccurrence
        if ((rowCounts.get(did) || 0) > SIGNAL_SAMPLE_CAP) {
          try { return await sampledThemeCooccurrence(service, did, fields, themesPayload, rowCounts.get(did) || 0) }
          catch { /* fall through to exact (pre-sql/173) */ }
        }
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
      // Themes with keywords (RAW — extract_theme_topical_words + the sampled
      // twin both build the pattern internally). Above the 50K cap the exact
      // per-theme scans 57014, so a member uses ONE multi-theme sampled twin
      // (sql/173) covering every theme; below the cap, the exact per-theme RPC.
      const topicalThemes = themes
        .map(t => ({ id: t.id, keywords: (t.keywords || []).filter(Boolean) }))
        .filter(t => t.keywords.length > 0)
      // Per member → { themeId: { word: count } }.
      const memberMaps = await runPool(datasetIds.map(did => async (): Promise<Record<string, Record<string, number>>> => {
        if ((rowCounts.get(did) || 0) > SIGNAL_SAMPLE_CAP) {
          try { return await sampledThemeTopical(service, did, fields, topicalThemes, [], rowCounts.get(did) || 0) }
          catch { /* fall through to exact */ }
        }
        const out: Record<string, Record<string, number>> = {}
        for (const t of topicalThemes) {
          const { data } = await service.rpc('extract_theme_topical_words', {
            p_dataset_id: did,
            p_field_keys: fields,
            p_keywords: t.keywords,
            p_extra_excludes: [],
            p_max_results: 15,  // a bit wider than 5 so the post-merge top-5 has room
          })
          const wm: Record<string, number> = {}
          for (const [w, c] of ((data as [string, number][] | null) || [])) wm[w] = (wm[w] || 0) + Number(c)
          out[t.id] = wm
        }
        return out
      }), 5)
      // Merge per-theme word counts across members, then top-5.
      const mergedByTheme: Record<string, Record<string, number>> = {}
      for (const mm of memberMaps) {
        for (const [tid, wm] of Object.entries(mm)) {
          const acc = mergedByTheme[tid] || (mergedByTheme[tid] = {})
          for (const [w, c] of Object.entries(wm)) acc[w] = (acc[w] || 0) + c
        }
      }
      topicalWords = Object.fromEntries(themes.map(t => [t.id,
        Object.entries(mergedByTheme[t.id] || {}).sort((a, b) => b[1] - a[1]).slice(0, 5) as [string, number][],
      ]))
    }

    // Optional: per-theme Dimensions breakdown. For each theme, the top
    // taxonomy sub-buckets (across all 7 axes) carried by the reviews that
    // match the theme — the classification analog of "Items mentioned".
    // Summed across member datasets for collections; only meaningful when the
    // dataset has been classified (datasets without taxonomy rows just return
    // empty arrays, which the client suppresses).
    let themeDimensions: Record<string, { axis: string; sub: string; count: number }[]> | undefined
    if (dimensions) {
      // Themes with FRAGMENTED keywords (theme_dimension_counts + the sampled
      // twin both expect the pre-fragmented pattern parts). Above the cap the
      // exact per-theme scan 57014s → one multi-theme sampled twin per member.
      const dimThemes = themes
        .map(t => ({ id: t.id, keywords: (t.keywords || []).filter(Boolean).map(kwPatternFragment) }))
        .filter(t => t.keywords.length > 0)
      // Per member → { themeId: { "axis:sub": {axis,sub,count} } }.
      const memberMaps = await runPool(datasetIds.map(did => async (): Promise<Record<string, Record<string, { axis: string; sub: string; count: number }>>> => {
        const walked = oneWalk.get(did)
        if (walked) return walked.dimensions
        if ((rowCounts.get(did) || 0) > SIGNAL_SAMPLE_CAP) {
          try { return await sampledThemeDimensions(service, did, fields, dimThemes, rowCounts.get(did) || 0) }
          catch { /* fall through to exact */ }
        }
        const out: Record<string, Record<string, { axis: string; sub: string; count: number }>> = {}
        for (const t of dimThemes) {
          const { data } = await service.rpc('theme_dimension_counts', {
            p_dataset_id: did,
            p_field_keys: fields,
            p_keywords: t.keywords,
            p_limit: 12,   // a bit wider than the card shows so the post-merge top-N has room
          })
          const dm: Record<string, { axis: string; sub: string; count: number }> = {}
          for (const r of ((data || []) as { axis: string; sub: string; count: number }[])) {
            const k = r.axis + ':' + r.sub
            if (!dm[k]) dm[k] = { axis: r.axis, sub: r.sub, count: 0 }
            dm[k].count += Number(r.count) || 0
          }
          out[t.id] = dm
        }
        return out
      }), 5)
      // Merge per-theme (axis,sub) counts across members, then top-8.
      const mergedByTheme: Record<string, Record<string, { axis: string; sub: string; count: number }>> = {}
      for (const mm of memberMaps) {
        for (const [tid, dm] of Object.entries(mm)) {
          const acc = mergedByTheme[tid] || (mergedByTheme[tid] = {})
          for (const [k, v] of Object.entries(dm)) {
            if (!acc[k]) acc[k] = { axis: v.axis, sub: v.sub, count: 0 }
            acc[k].count += v.count
          }
        }
      }
      themeDimensions = Object.fromEntries(themes.map(t => [t.id,
        Object.values(mergedByTheme[t.id] || {}).sort((a, b) => b.count - a.count).slice(0, 8),
      ]))
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
    const payload = {
      counts, totalNonEmpty,
      sampled: sampledByMember.size > 0, sampleSize,
      cooccurrence: cooccurrenceMatrix, topical: topicalWords, dimensions: themeDimensions,
    }
    // Awaited, not fire-and-forget: on serverless the response ending can kill
    // the invocation before a detached write lands, which would silently leave
    // the cache empty and every load paying the full 33s again.
    if (cacheKey) await writeThemeCountsCache(service, params.datasetId, analyticsBlob, cacheKey, totalFlat, payload)
    return NextResponse.json(payload)
  }

  // No flat rows for this dataset/collection → nothing to count. (The legacy
  // dataset_rows batch-streaming fallback was removed 2026-07-02; dataset_rows_flat
  // is the sole source of truth, so totalFlat === 0 means there is no data.)
  return NextResponse.json({
    counts: themes.map(t => ({ id: t.id, count: 0, percentage: 0 })),
    totalNonEmpty: 0,
  })
}
