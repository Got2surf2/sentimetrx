// app/api/datasets/[datasetId]/comments/route.ts
// POST — the rows matching the unified Comments filter: any mix of themes,
// entities, and dimensions, AND-combined across facets (OR within each).
// Powers the TextMine Comments tab's combined filter bar.
//
// Body: {
//   fields:     string[]                                   // active text fields (theme/entity recheck)
//   themes?:    { keywords: string[] }[]                   // selected themes — keywords OR'd
//   entities?:  { canonical: string; aliases: string[] }[] // selected entities — terms OR'd
//   dimensions?:{ axis: string; sub: string }[]            // selected dimension subs — OR'd
//   limit?: number  offset?: number
// }

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { getRowsByFilters } from '@/lib/commentFilter'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface Params { params: Promise<{ datasetId: string }> }

export async function POST(req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service
    .from('datasets').select('id, org_id').eq('id', params.datasetId).single()
  if (!ds) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && (ds as { org_id?: string }).org_id !== orgId) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }

  let body: {
    fields?: string[]
    themes?: { keywords?: string[] }[]
    entities?: { canonical?: string; aliases?: string[] }[]
    dimensions?: { axis?: string; sub?: string }[]
    limit?: number
    offset?: number
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const fields = (body.fields || []).filter(f => typeof f === 'string' && f.length > 0)
  // Flatten the selected themes' keywords into one OR'd set.
  const themeKeywords = (body.themes || []).flatMap(t => (t.keywords || [])).filter(Boolean)
  const entities = (body.entities || [])
    .map(e => ({ canonical: String(e.canonical || ''), aliases: (e.aliases || []).map(String) }))
    .filter(e => e.canonical.length > 0)
  const dimensions = (body.dimensions || [])
    .map(d => ({ axis: String(d.axis || ''), sub: String(d.sub || '') }))
    .filter(d => d.axis && d.sub)

  // Nothing selected → no filter; the client uses its own all-rows view instead.
  if (themeKeywords.length === 0 && entities.length === 0 && dimensions.length === 0) {
    return NextResponse.json({ rows: [], total: 0 })
  }

  const result = await getRowsByFilters({
    service,
    datasetId: params.datasetId,
    fields,
    themeKeywords,
    entities,
    dimensions,
    limit: typeof body.limit === 'number' ? body.limit : 200,
    offset: typeof body.offset === 'number' ? body.offset : 0,
  })

  return NextResponse.json(result)
}
