// app/api/datasets/[datasetId]/signal-stats/route.ts
// Aggregate dataset-level signal stats for the Phase B "metric strip"
// rendered below the dataset detail header. Returns:
//   records       — total non-empty rows across (collection) members
//   signals       — sum of per-theme record counts (a row in 3 themes counts 3×)
//   inThemes      — rows matching ANY theme (union of all theme keywords)
//   themeFitPct   — round(inThemes / records × 100)
//   themeFitBand  — "Tight" (≥85), "Mixed" (60–84), "Diffuse" (<60)
//   themeCount    — number of themes in the saved model
//
// Uses count_theme_matches via Postgres RPC; for collections, resolves
// member dataset IDs via `collections` + `collection_members` and sums.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

interface Props { params: { datasetId: string } }

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Theme { id: string; keywords: string[] }
interface ThemeModel { themes?: Theme[]; fieldName?: string; fieldNames?: string[] }

function band(pct: number): 'Tight' | 'Mixed' | 'Diffuse' {
  if (pct >= 85) return 'Tight'
  if (pct >= 60) return 'Mixed'
  return 'Diffuse'
}

export async function GET(_req: Request, { params }: Props) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  // Load source + theme model
  const { data: ds } = await service
    .from('datasets')
    .select('id, source')
    .eq('id', params.datasetId)
    .single()
  if (!ds) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: stateRow } = await service
    .from('dataset_state')
    .select('theme_model')
    .eq('dataset_id', params.datasetId)
    .single()
  const themeModel = (stateRow as { theme_model: ThemeModel | null } | null)?.theme_model || null

  // Resolve underlying dataset IDs (collection members or self)
  let datasetIds: string[] = [params.datasetId]
  if ((ds as { source?: string }).source === 'collection') {
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

  // Resolve text fields used for theme matching
  let fields: string[] = []
  if (themeModel?.fieldNames && themeModel.fieldNames.length) fields = themeModel.fieldNames
  else if (themeModel?.fieldName) fields = [themeModel.fieldName]

  // No themes or no fields → return shape but with empty stats
  const themes: Theme[] = (themeModel?.themes || []).filter(
    t => Array.isArray(t.keywords) && t.keywords.filter(Boolean).length > 0,
  )

  if (!themes.length || !fields.length || !datasetIds.length) {
    return NextResponse.json({
      records: 0, signals: 0, inThemes: 0,
      themeFitPct: 0, themeFitBand: 'Diffuse',
      themeCount: themes.length,
    })
  }

  // Records = sum of non-empty across members (max over fields, like theme-counts route)
  let records = 0
  for (const f of fields) {
    let fieldTotal = 0
    for (const did of datasetIds) {
      const { count } = await service
        .from('dataset_rows_flat')
        .select('id', { count: 'exact', head: true })
        .eq('dataset_id', did)
        .not('data->' + f, 'is', null)
        .neq('data->>' + f, '')
      fieldTotal += count || 0
    }
    records = Math.max(records, fieldTotal)
  }

  // Signals = sum of per-theme record counts (a row in N themes contributes N)
  let signals = 0
  for (const t of themes) {
    for (const did of datasetIds) {
      const { data } = await service.rpc('count_theme_matches', {
        p_dataset_id: did,
        p_field_keys: fields,
        p_keywords: t.keywords.filter(Boolean),
      })
      signals += Number(data) || 0
    }
  }

  // inThemes = rows matching ANY theme — pass union of all keywords
  // through the same SQL function. Postgres regex alternation does the
  // de-duplication so we don't double-count rows that match multiple
  // theme keywords.
  const allKeywords = Array.from(
    new Set(themes.flatMap(t => t.keywords.filter(Boolean))),
  )
  let inThemes = 0
  for (const did of datasetIds) {
    const { data } = await service.rpc('count_theme_matches', {
      p_dataset_id: did,
      p_field_keys: fields,
      p_keywords: allKeywords,
    })
    inThemes += Number(data) || 0
  }

  const themeFitPct = records > 0 ? Math.round((inThemes / records) * 100) : 0
  return NextResponse.json({
    records,
    signals,
    inThemes,
    themeFitPct,
    themeFitBand: band(themeFitPct),
    themeCount: themes.length,
  })
}
