// lib/reviewSync.ts
// Core sync algorithm for Google Reviews
// Uses submit-then-check pattern to avoid long polling in serverless

import type { SupabaseClient } from '@supabase/supabase-js'
import { submitReviewTask, checkReviewTask, type ReviewTaskRef, type DfsReview } from './dataforseo'
import { buildGoogleReviewsSchema, enrichSchemaWithStats } from './datasetUtils'
import { computeAnalytics, computeAnalyticsSQL } from './analyticsCompute'

export interface SyncResult {
  synced: number
  total: number
  locations_synced: number
  locations_remaining: number
  locations_errored: number
  errors: string[]
}

const SUBMIT_BATCH = 10   // submit up to 10 tasks at once
const CHECK_DELAY = 8000  // wait 8s before checking results
const CHECK_ROUNDS = 4    // check up to 4 times (8s + 4*5s = 28s total)
const CHUNK_SIZE = 50

/**
 * Sync reviews for a review source.
 * 1. Submit review tasks for unsynced locations (fast, no waiting)
 * 2. Wait briefly, then check which tasks completed
 * 3. Save results for completed tasks
 * Designed to complete well within Vercel's 60s timeout.
 */
export async function syncReviewSource(
  sourceId: string,
  service: SupabaseClient,
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, total: 0, locations_synced: 0, locations_remaining: 0, locations_errored: 0, errors: [] }

  // 1. Load source
  const { data: source, error: srcErr } = await service
    .from('review_sources').select('*').eq('id', sourceId).single()
  if (srcErr || !source) throw new Error('Review source not found: ' + (srcErr?.message || sourceId))
  if (!source.dataset_id) throw new Error('Review source has no linked dataset')

  // 2. Load locations needing sync (skip errored ones)
  const { data: locations, error: locErr } = await service
    .from('review_source_locations')
    .select('*')
    .eq('review_source_id', sourceId)
    .eq('selected', true)
    .is('error_message', null)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(SUBMIT_BATCH)

  if (locErr) throw new Error('Failed to load locations: ' + locErr.message)
  if (!locations || locations.length === 0) {
    // Count remaining for the response
    const { count } = await service
      .from('review_source_locations')
      .select('id', { count: 'exact', head: true })
      .eq('review_source_id', sourceId)
      .eq('selected', true)
      .is('last_synced_at', null)
      .is('error_message', null)
    result.locations_remaining = count || 0
    return result
  }

  // 3. Submit all tasks at once (very fast — just POST calls)
  const pending: { loc: typeof locations[0]; ref: ReviewTaskRef }[] = []
  for (const loc of locations) {
    try {
      const isInitial = !loc.last_review_id
      const depth = isInitial ? 700 : 100
      const ref = await submitReviewTask(loc.place_id, depth, 'newest')
      pending.push({ loc, ref })
    } catch (err: any) {
      result.locations_errored++
      result.errors.push(`${loc.name}: ${err.message?.slice(0, 150)}`)
      await service.from('review_source_locations').update({
        error_message: err.message?.slice(0, 500),
      }).eq('id', loc.id)
    }
  }

  if (pending.length === 0) {
    await updateSourceTimestamps(service, source)
    return result
  }

  // 4. Wait for tasks to process, then check results
  await sleep(CHECK_DELAY)

  const allNewRows: Record<string, unknown>[] = []
  let stillPending = [...pending]

  for (let round = 0; round < CHECK_ROUNDS && stillPending.length > 0; round++) {
    if (round > 0) await sleep(5000) // additional wait between check rounds

    const nextPending: typeof stillPending = []
    for (const item of stillPending) {
      try {
        const check = await checkReviewTask(item.ref)
        if (check.status === 'ready') {
          // Filter to only new reviews
          const newReviews = filterNewReviews(check.reviews, item.loc.last_review_id, item.loc.last_review_date)
          const locationLabel = formatLocationLabel(item.loc.name, item.loc.city, item.loc.state)
          for (const rev of newReviews) {
            allNewRows.push({
              review_id: rev.review_id, author: rev.profile_name, rating: rev.rating,
              review_text: rev.review_text || '', review_date: rev.timestamp ? rev.timestamp.split('T')[0] : '',
              location: locationLabel, location_name: item.loc.name,
              location_address: item.loc.address || '', location_city: item.loc.city || '',
              location_state: item.loc.state || '', place_id: item.loc.place_id,
              owner_response: rev.owner_answer || '', review_likes: rev.review_likes || 0,
            })
          }
          const newest = check.reviews[0]
          await service.from('review_source_locations').update({
            last_review_id: newest ? newest.review_id : item.loc.last_review_id,
            last_review_date: newest ? newest.timestamp : item.loc.last_review_date,
            total_pulled: item.loc.total_pulled + newReviews.length,
            last_synced_at: new Date().toISOString(),
            error_message: null,
          }).eq('id', item.loc.id)
          result.locations_synced++
        } else if (check.status === 'error') {
          result.locations_errored++
          result.errors.push(`${item.loc.name}: ${check.message}`)
          await service.from('review_source_locations').update({
            error_message: check.message?.slice(0, 500),
          }).eq('id', item.loc.id)
        } else {
          // Still pending — try again next round
          nextPending.push(item)
        }
      } catch (err: any) {
        result.locations_errored++
        result.errors.push(`${item.loc.name}: ${err.message?.slice(0, 150)}`)
        await service.from('review_source_locations').update({
          error_message: err.message?.slice(0, 500),
        }).eq('id', item.loc.id)
      }
    }
    stillPending = nextPending
  }

  // Any still-pending tasks — don't error them, just leave for next sync
  // (they'll be picked up since last_synced_at is still null)

  // 5. Insert new rows
  if (allNewRows.length > 0) {
    await insertReviewRows(service, source.dataset_id, allNewRows)
    result.synced = allNewRows.length
  }

  // 6. Get totals
  const { data: ds } = await service
    .from('datasets').select('row_count').eq('id', source.dataset_id).single()
  result.total = ds?.row_count || 0

  const { count: remaining } = await service
    .from('review_source_locations')
    .select('id', { count: 'exact', head: true })
    .eq('review_source_id', sourceId)
    .eq('selected', true)
    .is('last_synced_at', null)
    .is('error_message', null)
  result.locations_remaining = remaining || 0

  // 7. Update source + schema/analytics
  await updateSourceTimestamps(service, source)
  if (allNewRows.length > 0) {
    await ensureSchemaAndRecompute(service, source.dataset_id, allNewRows)
  }

  return result
}

function filterNewReviews(reviews: DfsReview[], lastReviewId: string | null, lastReviewDate: string | null): DfsReview[] {
  if (!lastReviewId && !lastReviewDate) return reviews
  const out: DfsReview[] = []
  for (const rev of reviews) {
    if (lastReviewId && rev.review_id === lastReviewId) break
    if (lastReviewDate && rev.timestamp && rev.timestamp < lastReviewDate) break
    out.push(rev)
  }
  return out
}

function formatLocationLabel(name: string, city: string | null, state: string | null): string {
  const parts = [name]
  if (city && state) parts.push(`${city}, ${state}`)
  else if (city) parts.push(city)
  else if (state) parts.push(state)
  return parts.join(' - ')
}

async function updateSourceTimestamps(service: SupabaseClient, source: any): Promise<void> {
  const now = new Date().toISOString()
  const nextSync = new Date(Date.now() + source.sync_frequency_hours * 3600 * 1000).toISOString()
  await service.from('review_sources').update({
    last_synced_at: now, next_sync_at: nextSync, updated_at: now, status: 'active',
  }).eq('id', source.id)
}

async function insertReviewRows(service: SupabaseClient, datasetId: string, rows: Record<string, unknown>[]): Promise<void> {
  const syncTimestamp = new Date().toISOString()
  const { data: existingBatches } = await service
    .from('dataset_rows').select('batch_index').eq('dataset_id', datasetId)
    .order('batch_index', { ascending: false }).limit(1)
  let nextBatchIndex = existingBatches?.length ? existingBatches[0].batch_index + 1 : 0
  const { data: dsData } = await service
    .from('datasets').select('row_count').eq('id', datasetId).single()
  let currentTotal = dsData?.row_count || 0

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    await service.from('dataset_rows').insert({
      dataset_id: datasetId, rows: chunk, row_count: chunk.length,
      batch_index: nextBatchIndex, source_ref: 'google_reviews:' + syncTimestamp,
    })
    const flatRows = chunk.map(function(r, j) {
      return { dataset_id: datasetId, row_index: nextBatchIndex * 200 + j, data: r }
    })
    try { await service.from('dataset_rows_flat').insert(flatRows) } catch {}
    currentTotal += chunk.length
    nextBatchIndex++
  }

  await service.from('datasets').update({
    row_count: currentTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp,
  }).eq('id', datasetId)
}

async function ensureSchemaAndRecompute(service: SupabaseClient, datasetId: string, sampleRows: Record<string, unknown>[]): Promise<void> {
  const { data: stateRow } = await service
    .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).single()
  let schema = stateRow?.schema_config
  if (!schema?.fields?.length) {
    schema = buildGoogleReviewsSchema()
    schema = enrichSchemaWithStats(schema, sampleRows)
    await service.from('dataset_state').update({
      schema_config: schema, updated_at: new Date().toISOString(),
    }).eq('dataset_id', datasetId)
  }
  if (schema?.fields?.length) {
    try {
      const flatCheck = await service.from('dataset_rows_flat').select('id', { count: 'exact', head: true }).eq('dataset_id', datasetId)
      const hasFlat = (flatCheck.count || 0) > 0
      const analytics = hasFlat
        ? await computeAnalyticsSQL(service, datasetId, schema)
        : await computeAnalytics(service, datasetId, schema)
      await service.from('dataset_state').update({
        analytics, updated_at: new Date().toISOString(),
      }).eq('dataset_id', datasetId)
    } catch (err) { console.error('[reviewSync] analytics compute failed:', err) }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
