// POST — download a batch of comments from regulations.gov into a dataset
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { listComments, fetchCommentsBatch, commentToRow } from '@/lib/regulations'
import { mergeSchemaStats } from '@/lib/datasetUtils'
import { computeAnalyticsSQL } from '@/lib/analyticsCompute'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CHUNK_SIZE = 500

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { dataset_id, docket_id, page, finalize, use_search } = body

  if (!dataset_id || !docket_id) return NextResponse.json({ error: 'dataset_id and docket_id required' }, { status: 400 })

  const service = createServiceRoleClient()

  // Cross-org gate: service-role bypasses RLS, so we must explicitly confirm
  // the caller's org owns this dataset. Without this, an authed user from any
  // org could POST { dataset_id: <other-org>, finalize: true } and trigger
  // analytics-compute / metadata writes on another tenant's dataset.
  const { data: userData } = await supabase
    .from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org === true : orgRel?.is_admin_org === true
  const { data: dsCheck } = await service.from('datasets').select('org_id').eq('id', dataset_id).single()
  if (!dsCheck || (!isAdmin && dsCheck.org_id !== userData?.org_id)) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }

  // If finalizing (last step), compute analytics and mark complete. We also
  // do a full-dataset schema scan here as a safety net — per-batch merges
  // (below) keep the schema current during the download, but a final pass
  // guarantees nothing was missed if a batch insert raced with a schema read.
  if (finalize) {
    try {
      const { data: stateRow } = await service.from('dataset_state').select('schema_config').eq('dataset_id', dataset_id).single()
      const schema = stateRow?.schema_config
      if (schema?.fields?.length) {
        // Full scan of dataset_rows_flat — page through all rows, merge each
        // page's distinct values into the schema. Replaces the previous
        // 100-row sample which froze the schema at whichever 100 rows the
        // database returned first.
        let merged = schema
        let off = 0
        const PAGE = 1000
        while (true) {
          const { data: page } = await service.from('dataset_rows_flat')
            .select('data').eq('dataset_id', dataset_id)
            .order('row_index', { ascending: true }).range(off, off + PAGE - 1)
          if (!page || page.length === 0) break
          const rows = page.map(function(r: { data: Record<string, unknown> }) { return r.data })
          merged = mergeSchemaStats(merged, rows)
          if (page.length < PAGE) break
          off += PAGE
        }
        await service.from('dataset_state').update({ schema_config: merged, updated_at: new Date().toISOString() }).eq('dataset_id', dataset_id)
        const analytics = await computeAnalyticsSQL(service, dataset_id, merged)
        await service.from('dataset_state').update({ analytics, updated_at: new Date().toISOString() }).eq('dataset_id', dataset_id)
      }
    } catch (err) {
      console.error('[regulations] analytics compute failed:', err)
    }
    // Mark download as complete in description
    try {
      const { data: ds } = await service.from('datasets').select('description').eq('id', dataset_id).single()
      if (ds?.description) {
        const meta = typeof ds.description === 'string' ? JSON.parse(ds.description) : ds.description
        meta.download_status = 'complete'
        await service.from('datasets').update({ description: JSON.stringify(meta) }).eq('id', dataset_id)
      }
    } catch {}
    return NextResponse.json({ ok: true })
  }

  // Step 1: List comment IDs for this page (10 per batch to stay within 60s timeout)
  const listResult = await listComments(docket_id, page || 1, 10, use_search || false)
  console.log('[regulations-dl] page', page, 'listed', listResult.data.length, 'total', listResult.totalElements, 'usedSearch', listResult.usedSearch)
  const commentIds = listResult.data.map(function(c) { return c.id })

  if (commentIds.length === 0) {
    return NextResponse.json({ inserted: 0, fetched: 0, totalElements: listResult.totalElements, lastPage: listResult.lastPage, usedSearch: listResult.usedSearch || false })
  }

  // Step 2: Fetch full text for each comment
  const details = await fetchCommentsBatch(commentIds)

  // Step 3: Convert to rows and insert
  const rows = details.map(commentToRow).filter(Boolean) as Record<string, unknown>[]

  if (rows.length > 0) {
    const syncTimestamp = new Date().toISOString()
    const { data: maxRowResp } = await service
      .from('dataset_rows_flat').select('row_index').eq('dataset_id', dataset_id)
      .order('row_index', { ascending: false }).limit(1)
    let nextRowIndex = maxRowResp?.length ? maxRowResp[0].row_index + 1 : 0
    const { data: dsData } = await service
      .from('datasets').select('row_count').eq('id', dataset_id).single()
    let currentTotal = dsData?.row_count || 0

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE)
      const flatRows = chunk.map(function(r, j) {
        return { dataset_id, row_index: nextRowIndex + j, data: r }
      })
      await service.from('dataset_rows_flat').insert(flatRows)
      currentTotal += chunk.length
      nextRowIndex += chunk.length
    }

    await service.from('datasets').update({
      row_count: currentTotal, updated_at: syncTimestamp,
    }).eq('id', dataset_id)

    // Merge this batch's distinct values into the schema so categorical fields
    // (agency, docket_id, country, state, title, ...) grow as comments come
    // in — the user can filter on real values mid-download instead of waiting
    // for finalize. Ignored if there's no schema yet (regulations-sources
    // creates one upfront, but be defensive).
    try {
      const { data: stateRow } = await service.from('dataset_state').select('schema_config').eq('dataset_id', dataset_id).single()
      const schema = stateRow?.schema_config
      if (schema?.fields?.length) {
        const merged = mergeSchemaStats(schema, rows)
        await service.from('dataset_state').update({ schema_config: merged, updated_at: syncTimestamp }).eq('dataset_id', dataset_id)
      }
    } catch (err) {
      console.error('[regulations] per-batch schema merge failed:', err)
    }
  }

  // Update download progress in description
  try {
    const { data: ds } = await service.from('datasets').select('description').eq('id', dataset_id).single()
    if (ds?.description) {
      const meta = typeof ds.description === 'string' ? JSON.parse(ds.description) : ds.description
      meta.next_page = (page || 1) + 1
      if (listResult.usedSearch) meta.use_search = true
      await service.from('datasets').update({ description: JSON.stringify(meta) }).eq('id', dataset_id)
    }
  } catch {}

  return NextResponse.json({
    inserted: rows.length,
    fetched: commentIds.length,
    totalElements: listResult.totalElements,
    lastPage: listResult.lastPage,
    usedSearch: listResult.usedSearch || false,
  })
}
