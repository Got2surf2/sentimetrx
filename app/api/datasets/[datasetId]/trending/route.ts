// app/api/datasets/[datasetId]/trending/route.ts
// GET — top words/phrases ("trending terms") for a dataset.
// Concatenates text from all open-ended fields and returns the most-frequent
// terms. For very large datasets the row sample is capped so the response
// stays fast (term frequency is statistically stable past ~5k samples).

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { topTerms } from '@/lib/trendingWords'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_ROWS = 5000

interface Params { params: { datasetId: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const orgId = userRow?.org_id
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const service = createServiceRoleClient()

  const { data: dataset } = await service.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (dataset.org_id !== orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: stateRow } = await service
    .from('dataset_state')
    .select('schema_config')
    .eq('dataset_id', params.datasetId)
    .single()

  const fields = ((stateRow?.schema_config as any)?.fields || []) as { field: string; type?: string }[]
  const textFields = fields.filter(f => f.type === 'open-ended').map(f => f.field)
  if (textFields.length === 0) {
    return NextResponse.json({ terms: [], textFields: [] })
  }

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '20'), 50)
  const includeBigrams = req.nextUrl.searchParams.get('bigrams') !== 'false'

  // Pull a sample of rows — bounded so we never block on huge datasets.
  const { data: rows } = await service
    .from('dataset_rows_flat')
    .select('data')
    .eq('dataset_id', params.datasetId)
    .limit(MAX_ROWS)

  const texts: string[] = []
  for (const r of rows || []) {
    const data = r.data as Record<string, unknown>
    for (const f of textFields) {
      const v = data?.[f]
      if (typeof v === 'string' && v.trim()) texts.push(v)
    }
  }

  const terms = topTerms(texts, { n: limit, minCount: 3, includeBigrams })
  return NextResponse.json({ terms, textFields, sampleSize: rows?.length || 0 })
}
