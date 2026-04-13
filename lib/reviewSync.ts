// lib/reviewSync.ts
// Core sync algorithm for Google Reviews — used by both manual sync and cron

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchReviews, type DfsReview } from './dataforseo'
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

// How many locations to process per invocation (must fit in Vercel's 60s timeout)
// Each location takes ~10-20s to fetch reviews from DataForSEO
const LOCATIONS_PER_BATCH = 3
const CHUNK_SIZE = 50

/**
 * Sync reviews for a review source. Handles both initial pull and incremental updates.
 * Processes up to LOCATIONS_PER_BATCH locations per call — returns partial results
 * so the cron can continue on the next tick.
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

  // 2. Load selected locations that need syncing (prioritise unsynced, then oldest)
  const { data: locations, error: locErr } = await service
    .from('review_source_locations')
    .select('*')
    .eq('review_source_id', sourceId)
    .eq('selected', true)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(LOCATIONS_PER_BATCH)

  if (locErr) throw new Error('Failed to load locations: ' + locErr.message)
  if (!locations || locations.length === 0) return result

  // 3. Pull reviews for each location
  const allNewRows: Record<string, unknown>[] = []

  for (const loc of locations) {
    try {
      const isInitial = !loc.last_review_id
      const depth = isInitial ? 700 : 100

      const reviews = await fetchReviews(loc.place_id, depth, 'newest')
      const newReviews = filterNewReviews(reviews, loc.last_review_id, loc.last_review_date)

      // Build row objects
      const locationLabel = formatLocationLabel(loc.name, loc.city, loc.state)
      for (const rev of newReviews) {
        allNewRows.push({
          review_id:        rev.review_id,
          author:           rev.profile_name,
          rating:           rev.rating,
          review_text:      rev.review_text || '',
          review_date:      rev.timestamp ? rev.timestamp.split('T')[0] : '',
          location:         locationLabel,
          location_name:    loc.name,
          location_address: loc.address || '',
          location_city:    loc.city || '',
          location_state:   loc.state || '',
          place_id:         loc.place_id,
          owner_response:   rev.owner_answer || '',
          review_likes:     rev.review_likes || 0,
        })
      }

      // Update location sync state
      const newest = reviews[0] // sorted by newest first
      await service.from('review_source_locations').update({
        last_review_id:   newest ? newest.review_id : loc.last_review_id,
        last_review_date: newest ? newest.timestamp : loc.last_review_date,
        total_pulled:     loc.total_pulled + newReviews.length,
        last_synced_at:   new Date().toISOString(),
        error_message:    null,
      }).eq('id', loc.id)

      result.locations_synced++
    } catch (err: any) {
      result.locations_errored++
      const msg = `${loc.name}: ${err?.message || String(err)}`
      result.errors.push(msg)
      await service.from('review_source_locations').update({
        error_message: err?.message || String(err),
      }).eq('id', loc.id)
    }
  }

  // 4. Insert new rows into dataset
  if (allNewRows.length > 0) {
    await insertReviewRows(service, source.dataset_id, allNewRows)
    result.synced = allNewRows.length
  }

  // 5. Get updated total + remaining locations
  const { data: ds } = await service
    .from('datasets').select('row_count').eq('id', source.dataset_id).single()
  result.total = ds?.row_count || 0

  // Count locations still needing sync (never synced AND no error)
  const { count: remaining } = await service
    .from('review_source_locations')
    .select('id', { count: 'exact', head: true })
    .eq('review_source_id', sourceId)
    .eq('selected', true)
    .is('last_synced_at', null)
    .is('error_message', null)
  result.locations_remaining = remaining || 0

  // 6. Update source sync timestamps
  const now = new Date().toISOString()
  const nextSync = new Date(Date.now() + source.sync_frequency_hours * 3600 * 1000).toISOString()
  await service.from('review_sources').update({
    last_synced_at: now,
    next_sync_at:   nextSync,
    updated_at:     now,
    status:         'active',
    error_message:  result.errors.length > 0 ? `${result.locations_errored} location(s) failed` : null,
  }).eq('id', sourceId)

  // 7. Set schema if first sync, then recompute analytics
  if (allNewRows.length > 0) {
    await ensureSchemaAndRecompute(service, source.dataset_id, allNewRows)
  }

  return result
}

/**
 * Filter reviews to only those newer than the last known review.
 * Reviews are sorted newest-first by DataForSEO.
 */
function filterNewReviews(
  reviews: DfsReview[],
  lastReviewId: string | null,
  lastReviewDate: string | null,
): DfsReview[] {
  if (!lastReviewId && !lastReviewDate) return reviews // initial pull — take all

  const newReviews: DfsReview[] = []
  for (const rev of reviews) {
    // Stop when we hit the last known review
    if (lastReviewId && rev.review_id === lastReviewId) break
    // Safety fallback: stop if review is older than last known date
    if (lastReviewDate && rev.timestamp && rev.timestamp < lastReviewDate) break
    newReviews.push(rev)
  }
  return newReviews
}

function formatLocationLabel(name: string, city: string | null, state: string | null): string {
  const parts = [name]
  if (city && state) parts.push(`${city}, ${state}`)
  else if (city) parts.push(city)
  else if (state) parts.push(state)
  return parts.join(' - ')
}

/**
 * Insert review rows using the same dual-write pattern as study sync:
 * dataset_rows (batched) + dataset_rows_flat (individual)
 */
async function insertReviewRows(
  service: SupabaseClient,
  datasetId: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const syncTimestamp = new Date().toISOString()

  // Get next batch index
  const { data: existingBatches } = await service
    .from('dataset_rows')
    .select('batch_index')
    .eq('dataset_id', datasetId)
    .order('batch_index', { ascending: false })
    .limit(1)
  let nextBatchIndex = existingBatches?.length ? existingBatches[0].batch_index + 1 : 0

  // Current total for row_count update
  const { data: dsData } = await service
    .from('datasets').select('row_count').eq('id', datasetId).single()
  let currentTotal = dsData?.row_count || 0

  // Insert in chunks
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)

    // Batched table insert
    await service.from('dataset_rows').insert({
      dataset_id:  datasetId,
      rows:        chunk,
      row_count:   chunk.length,
      batch_index: nextBatchIndex,
      source_ref:  'google_reviews:' + syncTimestamp,
    })

    // Flat table insert
    const flatRows = chunk.map(function(r, j) {
      return { dataset_id: datasetId, row_index: nextBatchIndex * 200 + j, data: r }
    })
    try { await service.from('dataset_rows_flat').insert(flatRows) } catch {}

    currentTotal += chunk.length
    nextBatchIndex++
  }

  // Update dataset row_count
  await service.from('datasets').update({
    row_count:      currentTotal,
    last_synced_at: syncTimestamp,
    updated_at:     syncTimestamp,
  }).eq('id', datasetId)
}

/**
 * Ensure the Google Reviews schema is set on first sync, then recompute analytics.
 */
async function ensureSchemaAndRecompute(
  service: SupabaseClient,
  datasetId: string,
  sampleRows: Record<string, unknown>[],
): Promise<void> {
  const { data: stateRow } = await service
    .from('dataset_state')
    .select('schema_config')
    .eq('dataset_id', datasetId)
    .single()

  let schema = stateRow?.schema_config
  const needsSchema = !schema?.fields?.length

  if (needsSchema) {
    schema = buildGoogleReviewsSchema()
    schema = enrichSchemaWithStats(schema, sampleRows)
    await service.from('dataset_state').update({
      schema_config: schema,
      updated_at: new Date().toISOString(),
    }).eq('dataset_id', datasetId)
  }

  // Recompute analytics
  if (schema?.fields?.length) {
    try {
      const flatCheck = await service
        .from('dataset_rows_flat')
        .select('id', { count: 'exact', head: true })
        .eq('dataset_id', datasetId)
      const hasFlat = (flatCheck.count || 0) > 0
      const analytics = hasFlat
        ? await computeAnalyticsSQL(service, datasetId, schema)
        : await computeAnalytics(service, datasetId, schema)
      await service.from('dataset_state').update({
        analytics,
        updated_at: new Date().toISOString(),
      }).eq('dataset_id', datasetId)
    } catch (err) {
      console.error('[reviewSync] analytics compute failed:', err)
    }
  }
}
