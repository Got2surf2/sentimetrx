// lib/reviewSync.ts
// Core sync algorithm for Google Reviews
// Two-phase: submit tasks → check results across multiple sync calls

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
  locations_submitted: number
  errors: string[]
  // Per-sync stats
  expected_reviews: number   // from Google's review_count
  with_comments: number
  without_comments: number
}

const BATCH_SIZE = 10
const CHUNK_SIZE = 50
// Prefix for pending task refs stored in error_message column
const TASK_PREFIX = 'pending_task:'

/**
 * Sync reviews — designed for repeated calls from the UI auto-sync loop.
 *
 * Phase 1: Check locations that have pending tasks (submitted in a previous call)
 * Phase 2: Submit new tasks for locations that don't have one yet
 *
 * Each call completes in <15 seconds — no polling loops.
 */
export async function syncReviewSource(
  sourceId: string,
  service: SupabaseClient,
): Promise<SyncResult> {
  const result: SyncResult = {
    synced: 0, total: 0, locations_synced: 0, locations_remaining: 0,
    locations_errored: 0, locations_submitted: 0, errors: [],
    expected_reviews: 0, with_comments: 0, without_comments: 0,
  }

  const { data: source, error: srcErr } = await service
    .from('review_sources').select('*').eq('id', sourceId).single()
  if (srcErr || !source) throw new Error('Review source not found: ' + (srcErr?.message || sourceId))
  if (!source.dataset_id) throw new Error('Review source has no linked dataset')

  const allNewRows: Record<string, unknown>[] = []

  // Load date range from dataset description (if set)
  const { data: dsData } = await service
    .from('datasets').select('description').eq('id', source.dataset_id).single()
  let dateStart: string | null = null
  let dateEnd: string | null = null
  try {
    const meta = JSON.parse(dsData?.description || '{}')
    dateStart = meta.start_date || null
    dateEnd = meta.end_date || null
  } catch {}

  // ── Phase 1: Check pending tasks ──────────────────────────────────────
  const { data: pendingLocs } = await service
    .from('review_source_locations')
    .select('*')
    .eq('review_source_id', sourceId)
    .eq('selected', true)
    .like('error_message', TASK_PREFIX + '%')
    .limit(BATCH_SIZE)

  if (pendingLocs && pendingLocs.length > 0) {
    for (const loc of pendingLocs) {
      try {
        const ref = parseTaskRef(loc.error_message!)
        const check = await checkReviewTask(ref)

        if (check.status === 'ready') {
          var newReviews = filterNewReviews(check.reviews, loc.last_review_id, loc.last_review_date)
          newReviews = filterByDateRange(newReviews, dateStart, dateEnd)
          result.expected_reviews += loc.review_count || 0
          for (const rev of newReviews) {
            if (rev.review_text) result.with_comments++
            else result.without_comments++
          }
          if (check.reviews.length === 0) {
            result.errors.push(`${loc.name}: API returned 0 reviews (expected ~${loc.review_count})`)
          }
          const label = formatLocationLabel(loc.name, loc.city, loc.state)
          for (const rev of newReviews) {
            allNewRows.push(reviewToRow(rev, loc, label))
          }
          const newest = check.reviews[0]
          await service.from('review_source_locations').update({
            last_review_id: newest ? newest.review_id : loc.last_review_id,
            last_review_date: newest ? newest.timestamp : loc.last_review_date,
            total_pulled: loc.total_pulled + newReviews.length,
            last_synced_at: new Date().toISOString(),
            error_message: check.reviews.length === 0 ? 'API returned 0 reviews' : null,
          }).eq('id', loc.id)
          result.locations_synced++
        } else if (check.status === 'error') {
          result.locations_errored++
          result.errors.push(`${loc.name}: ${check.message}`)
          await service.from('review_source_locations').update({
            error_message: check.message?.slice(0, 500),
          }).eq('id', loc.id)
        }
        // status === 'pending' → leave task ref in place, check again next call
      } catch (err: any) {
        result.locations_errored++
        result.errors.push(`${loc.name}: ${err.message?.slice(0, 150)}`)
        await service.from('review_source_locations').update({
          error_message: err.message?.slice(0, 500),
        }).eq('id', loc.id)
      }
    }
  }

  // ── Phase 2: Submit new tasks for unsynced locations ──────────────────
  const { data: unsyncedLocs } = await service
    .from('review_source_locations')
    .select('*')
    .eq('review_source_id', sourceId)
    .eq('selected', true)
    .is('last_synced_at', null)
    .is('error_message', null)
    .limit(BATCH_SIZE)

  if (unsyncedLocs && unsyncedLocs.length > 0) {
    for (const loc of unsyncedLocs) {
      try {
        const isInitial = !loc.last_review_id
        // Use the location's review_count to set depth, capped at DataForSEO's 4490 max
        const depth = isInitial ? Math.min(Math.max(loc.review_count || 1000, 1000), 4490) : 200
        const ref = await submitReviewTask(loc.place_id, depth, 'newest')
        // Store task ref so next call can check it
        await service.from('review_source_locations').update({
          error_message: serializeTaskRef(ref),
        }).eq('id', loc.id)
        result.locations_submitted++
      } catch (err: any) {
        result.locations_errored++
        result.errors.push(`${loc.name}: ${err.message?.slice(0, 150)}`)
        await service.from('review_source_locations').update({
          error_message: err.message?.slice(0, 500),
        }).eq('id', loc.id)
      }
    }
  }

  // ── Save results ──────────────────────────────────────────────────────
  if (allNewRows.length > 0) {
    await insertReviewRows(service, source.dataset_id, allNewRows)
    result.synced = allNewRows.length
  }

  const { data: ds } = await service
    .from('datasets').select('row_count').eq('id', source.dataset_id).single()
  result.total = ds?.row_count || 0

  // Remaining = pending tasks (in progress) + unsynced without errors
  const { count: pendingCount } = await service
    .from('review_source_locations')
    .select('id', { count: 'exact', head: true })
    .eq('review_source_id', sourceId)
    .eq('selected', true)
    .like('error_message', TASK_PREFIX + '%')
  const { count: unsyncedCount } = await service
    .from('review_source_locations')
    .select('id', { count: 'exact', head: true })
    .eq('review_source_id', sourceId)
    .eq('selected', true)
    .is('last_synced_at', null)
    .is('error_message', null)
  result.locations_remaining = (pendingCount || 0) + (unsyncedCount || 0)

  await updateSourceTimestamps(service, source)
  if (allNewRows.length > 0) {
    await ensureSchemaAndRecompute(service, source.dataset_id, allNewRows)
  }

  return result
}

// ── Task ref serialization ────────────────────────────────────────────────
function serializeTaskRef(ref: ReviewTaskRef): string {
  return TASK_PREFIX + ref.taskId + '|' + ref.getPath
}

function parseTaskRef(s: string): ReviewTaskRef {
  const body = s.slice(TASK_PREFIX.length)
  const [taskId, getPath] = body.split('|')
  return { taskId, getPath }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function filterByDateRange(reviews: DfsReview[], startDate: string | null, endDate: string | null): DfsReview[] {
  if (!startDate && !endDate) return reviews
  return reviews.filter(function(rev) {
    if (!rev.timestamp) return true
    const d = rev.timestamp.split('T')[0]
    if (startDate && d < startDate) return false
    if (endDate && d > endDate) return false
    return true
  })
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

function reviewToRow(rev: DfsReview, loc: any, label: string): Record<string, unknown> {
  return {
    review_id: rev.review_id, author: rev.profile_name, rating: rev.rating,
    review_text: rev.review_text || '', review_date: rev.timestamp ? rev.timestamp.split('T')[0] : '',
    location: label, location_name: loc.name, location_address: loc.address || '',
    location_city: loc.city || '', location_state: loc.state || '', place_id: loc.place_id,
    owner_response: rev.owner_answer || '', review_likes: rev.review_likes || 0,
  }
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
      const analytics = (flatCheck.count || 0) > 0
        ? await computeAnalyticsSQL(service, datasetId, schema)
        : await computeAnalytics(service, datasetId, schema)
      await service.from('dataset_state').update({
        analytics, updated_at: new Date().toISOString(),
      }).eq('dataset_id', datasetId)
    } catch (err) { console.error('[reviewSync] analytics compute failed:', err) }
  }
}
