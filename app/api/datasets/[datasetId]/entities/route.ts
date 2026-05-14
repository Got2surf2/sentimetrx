// app/api/datasets/[datasetId]/entities/route.ts
// GET — list catalog entities for a dataset's scope, with LIVE full-text
// counts. Scope-resolving: a plain dataset reads its own catalog; a branded
// or collection dataset reads the shared collection catalog and counts
// across every member dataset.
//   ?theme=<themeId>   intersect counts with the theme's keyword match
//   ?limit=<n>         default 50, max 200
//
// Used by the Schema-tab ExtractEntitiesPanel, the theme-card "Top entities"
// section, and Ask Ana.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { getEntitiesWithCounts } from '@/lib/entityFilter'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

interface ThemeModelTheme { id: string; keywords?: string[] }

export async function GET(req: Request, { params }: Params) {
  const supabase = createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service
    .from('datasets').select('id, org_id').eq('id', params.datasetId).single()
  if (!ds) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && (ds as any).org_id !== orgId) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const themeId = url.searchParams.get('theme')
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200)

  // Theme path: resolve the theme's keywords so counts intersect the theme.
  let themeKeywords: string[] | undefined
  if (themeId) {
    const { data: stateRow } = await service
      .from('dataset_state').select('theme_model').eq('dataset_id', params.datasetId).single()
    const themeModel = ((stateRow as any)?.theme_model ?? {}) as { themes?: ThemeModelTheme[] }
    const theme = (themeModel.themes || []).find(t => t.id === themeId)
    if (!theme || !theme.keywords || theme.keywords.length === 0) {
      return NextResponse.json({ entities: [], categories: [], total_distinct: 0, theme_id: themeId, note: 'theme not found or has no keywords' })
    }
    themeKeywords = theme.keywords
  }

  const result = await getEntitiesWithCounts({
    service,
    datasetId: params.datasetId,
    themeKeywords,
    limit,
  })

  if ('notFound' in result) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }

  return NextResponse.json(themeId ? { ...result, theme_id: themeId } : result)
}
