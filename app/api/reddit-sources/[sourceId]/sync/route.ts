// app/api/reddit-sources/[sourceId]/sync/route.ts
// POST — finalize a Reddit source after per-thread downloads: build schema + compute analytics

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { buildRedditSchema, enrichSchemaWithStats } from '@/lib/datasetUtils'
import { computeAnalyticsSQL } from '@/lib/analyticsCompute'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: { sourceId: string } }

export async function POST(_req: Request, { params }: Params) {
  try {
    var supabase = createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    var { data: userData } = await supabase
      .from('users').select('org_id').eq('id', user.id).single()
    var orgId = userData?.org_id
    if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    var service = createServiceRoleClient()

    // Verify ownership
    var { data: source } = await service
      .from('reddit_sources')
      .select('id, dataset_id, org_id')
      .eq('id', params.sourceId)
      .eq('org_id', orgId)
      .single()
    if (!source || !source.dataset_id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    var datasetId = source.dataset_id

    // Count totals from thread records
    var { data: threads } = await service
      .from('reddit_source_threads')
      .select('total_pulled, error_message')
      .eq('reddit_source_id', source.id)
    var totalComments = 0
    var errored = 0
    ;(threads || []).forEach(function(t: any) {
      totalComments += t.total_pulled || 0
      if (t.error_message) errored++
    })

    // Update source status
    await service.from('reddit_sources').update({
      status: errored > 0 && totalComments === 0 ? 'error' : 'done',
      total_comments: totalComments,
      total_posts: (threads || []).filter(function(t: any) { return t.total_pulled > 0 }).length,
      updated_at: new Date().toISOString(),
    }).eq('id', source.id)

    // Build schema + compute analytics
    var { data: stateRow } = await service
      .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).single()
    var schema = stateRow?.schema_config
    if (!schema?.fields?.length) {
      // Grab sample rows for stats enrichment
      var { data: sampleFlat } = await service
        .from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', datasetId)
        .limit(100)
      var sampleRows = (sampleFlat || []).map(function(r: any) { return r.data })
      schema = buildRedditSchema()
      schema = enrichSchemaWithStats(schema, sampleRows)
      await service.from('dataset_state').update({
        schema_config: schema, updated_at: new Date().toISOString(),
      }).eq('dataset_id', datasetId)
    }

    if (schema?.fields?.length) {
      try {
        const analytics = await computeAnalyticsSQL(service, datasetId, schema)
        await service.from('dataset_state').update({
          analytics, updated_at: new Date().toISOString(),
        }).eq('dataset_id', datasetId)
      } catch (err) { console.error({ at: 'reddit/sync', msg: "analytics compute failed", err: err }) }
    }

    return NextResponse.json({
      status: 'done',
      total_comments: totalComments,
      total_threads: (threads || []).length,
      errored: errored,
    })
  } catch (err: any) {
    console.error({ at: 'reddit-sources/sync', msg: "error", err: err })
    return NextResponse.json({ error: err?.message || 'Finalize failed' }, { status: 500 })
  }
}
