// app/api/datasets/[datasetId]/entities/route.ts
// GET — list canonical entities for a dataset, sorted by mention count.
//   ?theme=<themeId>       intersect with rows matching the theme's keywords
//   ?field=<sourceField>   restrict to one source field
//   ?limit=<n>             default 50, max 200
//
// Used by the theme card "Top entities" section, TextMine entity chips,
// and the Schema-tab last-extracted view.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

interface ThemeModelTheme {
  id: string
  keywords: string[]
}

interface SchemaField {
  key: string
  label?: string
  type?: string
  status?: string
  role?: string
}

export async function GET(req: Request, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org

  const url = new URL(req.url)
  const themeId = url.searchParams.get('theme')
  const sourceField = url.searchParams.get('field')
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200)

  const service = createServiceRoleClient()
  const { data: dataset } = await service
    .from('datasets').select('id, source, org_id').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && (dataset as any).org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }

  // Resolve member dataset ids (entity_mentions lives on members for
  // collections). The `dataset_id` column on entity_mentions is the
  // dataset that was extracted — when an admin extracts on a collection
  // the rows still live in member datasets, but the SQL function operates
  // per-dataset, so we union across members for the theme path.
  let memberIds: string[] = [params.datasetId]
  if ((dataset as any).source === 'collection') {
    const { data: col } = await service.from('collections').select('id').eq('dataset_id', params.datasetId).single()
    if (col) {
      const { data: members } = await service
        .from('collection_members')
        .select('dataset_id')
        .eq('collection_id', (col as any).id)
      if (members && members.length > 0) memberIds = members.map((m: any) => m.dataset_id)
    }
  }

  // ── Theme-filtered path: union per-member results ──────────────
  if (themeId) {
    // Resolve theme keywords + analyzable fields from dataset_state.
    const { data: stateRow } = await service
      .from('dataset_state')
      .select('theme_model, schema_config')
      .eq('dataset_id', params.datasetId)
      .single()
    const themeModel = ((stateRow as any)?.theme_model ?? {}) as { themes?: ThemeModelTheme[] }
    const theme = (themeModel.themes || []).find(function(t) { return t.id === themeId })
    if (!theme || !theme.keywords || theme.keywords.length === 0) {
      return NextResponse.json({ entities: [], theme_id: themeId, note: 'theme not found or has no keywords' })
    }
    const schemaConfig = ((stateRow as any)?.schema_config ?? {}) as { fields?: SchemaField[] }
    const fields = (schemaConfig.fields || [])
      .filter(function(f) { return f.status !== 'ignored' && (f.type === 'text' || f.type === 'open-ended' || f.role === 'text') })
      .map(function(f) { return f.key })
    if (fields.length === 0) {
      return NextResponse.json({ entities: [], theme_id: themeId, note: 'no analyzable text fields' })
    }

    // Union per member dataset
    type Agg = { canonical: string; category: string; mentions: number; distinct_rows: number }
    const agg = new Map<string, Agg>()
    for (const memberId of memberIds) {
      const { data: rows, error } = await service.rpc('top_entities_for_theme', {
        p_dataset_id: memberId,
        p_field_keys: fields,
        p_keywords: theme.keywords,
        p_source_field: sourceField || null,
        p_limit: limit * 2, // overfetch per member so the union still produces a strong top-N
      })
      if (error) continue
      for (const r of (rows || []) as any[]) {
        const key = r.canonical
        const existing = agg.get(key)
        if (existing) {
          existing.mentions += Number(r.mentions) || 0
          existing.distinct_rows += Number(r.distinct_rows) || 0
        } else {
          agg.set(key, {
            canonical: r.canonical,
            category: r.category,
            mentions: Number(r.mentions) || 0,
            distinct_rows: Number(r.distinct_rows) || 0,
          })
        }
      }
    }
    const entities = Array.from(agg.values())
      .sort(function(a, b) { return b.mentions - a.mentions })
      .slice(0, limit)
    return NextResponse.json({ entities, theme_id: themeId })
  }

  // ── Plain path: aggregate from entity_mentions directly ────────
  // For collections we sum across member datasets.
  type CatRow = { canonical: string; category: string; mentions: number; distinct_rows: number }
  const agg = new Map<string, CatRow>()

  for (const memberId of memberIds) {
    let query = service
      .from('entity_mentions')
      .select('canonical, category, row_id')
      .eq('dataset_id', memberId)
    if (sourceField) query = query.eq('source_field', sourceField)

    const { data: rows } = await query.limit(50_000)
    if (!rows) continue
    for (const r of rows as any[]) {
      const key = r.canonical
      const existing = agg.get(key)
      if (existing) {
        existing.mentions += 1
        existing.distinct_rows += 1 // each entity_mentions row is one (row, canonical) pair already
      } else {
        agg.set(key, { canonical: r.canonical, category: r.category, mentions: 1, distinct_rows: 1 })
      }
    }
  }

  // Build category rollup as well
  const categoryAgg = new Map<string, number>()
  agg.forEach(function(v) {
    categoryAgg.set(v.category, (categoryAgg.get(v.category) || 0) + v.mentions)
  })

  const entities = Array.from(agg.values())
    .sort(function(a, b) { return b.mentions - a.mentions })
    .slice(0, limit)

  const categories = Array.from(categoryAgg.entries())
    .map(function(e) { return { category: e[0], mentions: e[1] } })
    .sort(function(a, b) { return b.mentions - a.mentions })

  return NextResponse.json({ entities, categories, total_distinct: agg.size })
}
