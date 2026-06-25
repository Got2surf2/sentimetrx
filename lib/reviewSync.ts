// lib/reviewSync.ts
// Core sync algorithm for Google Reviews
// Two-phase: submit tasks → check results across multiple sync calls

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { submitReviewTask, submitTripadvisorReviewTask, checkReviewTask, type ReviewTaskRef, type DfsReview } from './dataforseo'
import { buildGoogleReviewsSchema, enrichSchemaWithStats, mergeSchemaStats } from './datasetUtils'
import { computeAnalyticsSQL } from './analyticsCompute'
import { getReviewBudget, logReviewDownload } from './reviewLimits'
import { classifyPendingRows } from './taxonomyClassify'

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
  // Progress context for UI
  pending_locations: string[]   // names of locations with pending tasks
  processing_location: string | null  // name of the location currently being checked/submitted
  // True when the org's monthly review-download cap stopped task submission.
  limit_reached: boolean
}

const BATCH_SIZE = 3
// Phase 1 drains pending DataForSEO tasks via task_get (a cheap single GET
// per location, ~200-500ms each). Use a larger batch than Phase 2 so a
// queue of N pending tasks clears in N/PHASE1_BATCH_SIZE cron ticks rather
// than N/BATCH_SIZE — at 3-per-tick a 29-task backlog took 10 cron cycles
// (≈10 weeks at 168h sync cadence, see Flemings 2026-05-11 incident).
const PHASE1_BATCH_SIZE = 10
const CHUNK_SIZE = 500
const TIME_BUDGET_MS = 45000 // bail before Vercel's 60s timeout
// Prefix for pending task refs stored in error_message column
const TASK_PREFIX = 'pending_task:'
// Skip refreshing a location that was synced more recently than this. Keeps a
// single sync session from re-refreshing the same location twice; both cron
// (6h) and the UI's manual button cycle past this comfortably.
const REFRESH_STALE_MS = 60 * 60 * 1000  // 1 hour

// Errors we treat as "this will probably work next time, leave the location
// alone so the cron retries it instead of permanently parking it."
//   - DataforSEO 40601 (Task Handed) / 40401 (Task Not Found) / 40602 (Task
//     In Queue): the task lifecycle had a transient issue. Re-submitting
//     usually works.
//   - Network / timeout / fetch failed: standard transient infra noise.
//   - "All review API attempts failed": our own retry wrapper exhausted —
//     usually a transient DataforSEO incident.
function isTransientError(err: any): boolean {
  const msg = String(err?.message || err || '')
  return /timeout|FUNCTION_INVOCATION_TIMEOUT|network|ECONNRESET|fetch failed|40601|40401|40602|All review API attempts failed/i.test(msg)
}

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
  opts: { drainOnly?: boolean } = {},
): Promise<SyncResult> {
  // drainOnly: run Phase 1 (retrieve already-submitted DataForSEO tasks — cost
  // already incurred) but skip Phase 2/3, which submit NEW paid tasks. Used by
  // the cron for Manual sources so their pending tasks still get drained in the
  // background without auto-submitting new downloads.
  const drainOnly = opts.drainOnly === true
  const result: SyncResult = {
    synced: 0, total: 0, locations_synced: 0, locations_remaining: 0,
    locations_errored: 0, locations_submitted: 0, errors: [],
    expected_reviews: 0, with_comments: 0, without_comments: 0,
    pending_locations: [], processing_location: null, limit_reached: false,
  }

  const { data: source, error: srcErr } = await service
    .from('review_sources').select('*').eq('id', sourceId).single()
  if (srcErr || !source) throw new Error('Review source not found: ' + (srcErr?.message || sourceId))
  if (!source.dataset_id) throw new Error('Review source has no linked dataset')

  // Dispatch review-task submission on the source's platform. checkReviewTask
  // (Phase 1) self-routes off the stored task ref, so only submission branches.
  const submitTask = source.source === 'tripadvisor' ? submitTripadvisorReviewTask : submitReviewTask

  // Monthly review-download budget (Darden-pilot cost guard). `remainingBudget`
  // is null for uncapped orgs; otherwise it's decremented as Phase 2/3 submit
  // tasks, so a single sync call can't blow past the org's cap. See
  // lib/reviewLimits. Phase 1 (draining already-submitted tasks) is never
  // gated — its cost was already incurred at submit time.
  const budget = await getReviewBudget(service, source.org_id)
  let remainingBudget = budget.remaining

  const startTime = Date.now()
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
    .limit(PHASE1_BATCH_SIZE)

  if (pendingLocs && pendingLocs.length > 0) {
    result.pending_locations = pendingLocs.map(function(l) { return l.name })
    for (const loc of pendingLocs) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break
      try {
        result.processing_location = loc.name
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
        // Preserve the pending task ref on transient errors so the location
        // gets retried next call instead of getting permanently parked.
        if (!isTransientError(err)) {
          await service.from('review_source_locations').update({
            error_message: err.message?.slice(0, 500),
          }).eq('id', loc.id)
        }
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

  if (!drainOnly && unsyncedLocs && unsyncedLocs.length > 0) {
    for (const loc of unsyncedLocs) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break
      // Monthly cap reached — stop submitting new download tasks. Any
      // in-flight tasks still drain via Phase 1; the org resumes next month.
      if (remainingBudget !== null && remainingBudget <= 0) {
        result.limit_reached = true
        result.errors.push('Monthly review-download limit reached — new downloads paused')
        break
      }
      try {
        result.processing_location = loc.name
        const isInitial = !loc.last_review_id
        let depth = isInitial
          ? estimateDepth(loc.review_count, loc.created_at, dateStart, dateEnd)
          : 200
        // Cap depth to the remaining monthly budget. Tasks are newest-first,
        // so a budget-capped task pulls the most-recent N reviews.
        if (remainingBudget !== null) depth = Math.min(depth, remainingBudget)
        const ref = await submitTask(loc.place_id, depth, 'newest')
        // Store task ref so next call can check it
        await service.from('review_source_locations').update({
          error_message: serializeTaskRef(ref),
        }).eq('id', loc.id)
        if (remainingBudget !== null) remainingBudget -= depth
        result.locations_submitted++
      } catch (err: any) {
        result.locations_errored++
        result.errors.push(`${loc.name}: ${err.message?.slice(0, 150)}`)
        // Skip writing error_message for transient failures so the cron
        // picks the location up again next cycle. Without this, a single
        // DataforSEO timeout / network blip / "Task In Queue" / "Task
        // Handed" / "Task Not Found" permanently parks the location and
        // it never refreshes again until manually unstuck.
        if (!isTransientError(err)) {
          await service.from('review_source_locations').update({
            error_message: err.message?.slice(0, 500),
          }).eq('id', loc.id)
        }
      }
    }
  }

  // ── Phase 3: Incremental refresh for already-synced locations ─────────
  // Picks BATCH_SIZE oldest-synced locations whose last_synced_at is older
  // than REFRESH_STALE_MS, submits a depth-200 newest-first task. Phase 1
  // retrieves the task on a subsequent call; filterNewReviews dedupes
  // against last_review_id / last_review_date so only genuinely new
  // reviews are inserted.
  const refreshCutoff = new Date(Date.now() - REFRESH_STALE_MS).toISOString()
  if (!drainOnly && Date.now() - startTime < TIME_BUDGET_MS) {
    const { data: staleLocs } = await service
      .from('review_source_locations')
      .select('*')
      .eq('review_source_id', sourceId)
      .eq('selected', true)
      .not('last_synced_at', 'is', null)
      .lt('last_synced_at', refreshCutoff)
      .is('error_message', null)
      .order('last_synced_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (staleLocs && staleLocs.length > 0) {
      for (const loc of staleLocs) {
        if (Date.now() - startTime > TIME_BUDGET_MS) break
        // Monthly cap reached — pause refreshes too (a refresh still costs a
        // DataForSEO task). Resumes next calendar month.
        if (remainingBudget !== null && remainingBudget <= 0) {
          result.limit_reached = true
          result.errors.push('Monthly review-download limit reached — refresh paused')
          break
        }
        try {
          result.processing_location = loc.name
          let depth = 200
          if (remainingBudget !== null) depth = Math.min(depth, remainingBudget)
          const ref = await submitTask(loc.place_id, depth, 'newest')
          await service.from('review_source_locations').update({
            error_message: serializeTaskRef(ref),
          }).eq('id', loc.id)
          if (remainingBudget !== null) remainingBudget -= depth
          result.locations_submitted++
        } catch (err: any) {
          result.locations_errored++
          result.errors.push(`${loc.name}: ${err.message?.slice(0, 150)}`)
          // Same transient-error guard as Phase 2 — don't poison
          // last_synced'd locations on a flaky DataforSEO response.
          if (!isTransientError(err)) {
            await service.from('review_source_locations').update({
              error_message: err.message?.slice(0, 500),
            }).eq('id', loc.id)
          }
        }
      }
    }
  }

  // ── Save results ──────────────────────────────────────────────────────
  if (allNewRows.length > 0) {
    await insertReviewRows(service, source.dataset_id, allNewRows)
    result.synced = allNewRows.length
    // Ledger the ingested records against the org's monthly budget.
    await logReviewDownload(service, {
      orgId:          source.org_id,
      reviewSourceId: source.id,
      datasetId:      source.dataset_id,
      source:         source.source,
      records:        allNewRows.length,
    })
  }

  const { data: ds } = await service
    .from('datasets').select('row_count').eq('id', source.dataset_id).single()
  result.total = ds?.row_count || 0

  // Remaining = pending tasks (in progress) + unsynced without errors +
  // already-synced-but-stale locations that Phase 3 will pick up next call.
  // Including the stale count keeps the UI's auto-poll loop running until
  // every selected location has been refreshed in the current cycle.
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
  const { count: staleCount } = await service
    .from('review_source_locations')
    .select('id', { count: 'exact', head: true })
    .eq('review_source_id', sourceId)
    .eq('selected', true)
    .not('last_synced_at', 'is', null)
    .lt('last_synced_at', refreshCutoff)
    .is('error_message', null)
  result.locations_remaining = (pendingCount || 0) + (unsyncedCount || 0) + (staleCount || 0)

  await updateSourceTimestamps(service, source, (pendingCount || 0) > 0)
  if (allNewRows.length > 0) {
    await ensureSchemaAndRecompute(service, source.dataset_id, allNewRows)

    // Auto-classify safety net: keep the Dimensions (taxonomy) tab current.
    // If this dataset has already been classified (the user opted in), classify
    // the freshly-synced rows that still lack tags — otherwise newly synced
    // reviews would be invisible to Dimensions until a manual Re-classify.
    // Gated on prior classification (never auto-starts an un-opted dataset),
    // capped, and non-fatal so a hiccup can't fail the sync.
    try {
      // Gate on the legacy table — the historical "opted-in / classified before"
      // record (existing datasets predate the per-field table). classifyPendingRows
      // dual-writes, so this also backfills the new per-field table over time.
      const { count: taxCount } = await service
        .from('dataset_row_taxonomy')
        .select('row_id', { count: 'exact', head: true })
        .eq('dataset_id', source.dataset_id)
      if (taxCount && taxCount > 0) {
        const { classified } = await classifyPendingRows({
          service, datasetId: source.dataset_id, orgId: source.org_id,
          textFields: ['review_text'], brand: 'core', maxRows: 10000,
        })
        if (classified > 0) console.log({ at: 'reviewSync.autoClassify', datasetId: source.dataset_id, classified })
      }
    } catch (e) {
      console.error({ at: 'reviewSync.autoClassify', datasetId: source.dataset_id, err: e })
    }
  }

  // Stamp the dataset only when the refresh cycle is genuinely complete —
  // no pending, unsynced, or stale locations. An earlier version stamped on
  // every call, but that misled the UI: Phase 3 submitting tasks and
  // returning would update last_synced_at even though new reviews hadn't
  // landed yet. With this gate, "Synced just now" means "everything is
  // actually fresh".
  if (result.locations_remaining === 0) {
    await service.from('datasets').update({
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', source.dataset_id)
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

/**
 * Estimate how many reviews to request based on date range.
 * Reviews are sorted newest-first, so we only need enough depth to cover
 * the date range. Uses a 1.5x buffer + 200 minimum for safety.
 */
function estimateDepth(reviewCount: number, locationCreatedAt: string | null, startDate: string | null, endDate: string | null): number {
  const total = reviewCount || 1000
  if (!startDate) return Math.min(Math.max(total, 1000), 4490)

  // Estimate the location's review history span (default 5 years if unknown)
  const now = new Date()
  const endDt = endDate ? new Date(endDate) : now
  const startDt = new Date(startDate)
  const rangeDays = Math.max((endDt.getTime() - startDt.getTime()) / 86400000, 1)

  // Assume reviews span ~5 years if we don't know the location's age
  const historyDays = 5 * 365
  const fraction = Math.min(rangeDays / historyDays, 1)

  // Estimate reviews in range, add 1.5x buffer, clamp to [200, 4490]
  const estimated = Math.ceil(total * fraction * 1.5)
  return Math.min(Math.max(estimated, 200), 4490)
}

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

async function updateSourceTimestamps(service: SupabaseClient, source: any, hasPending: boolean): Promise<void> {
  const now = new Date().toISOString()
  // sync_frequency_hours = 0 means "manual mode" — don't schedule a future
  // auto-sync. Park next_sync_at way in the future so the cron query
  // (.lte('next_sync_at', now)) never matches it.
  //
  // If pending DataForSEO tasks remain after this run (Phase 1 couldn't
  // drain all of them in one call), short-circuit next_sync_at to ~5min
  // from now so the next cron tick (top of the next 6h window) picks the
  // source back up to drain more. Without this, a source with a long
  // sync_frequency_hours (e.g. 168h weekly) would sit on pending tasks
  // for the whole interval — see 2026-05-11 Flemings: 29 tasks queued,
  // next_sync_at pushed 168h out, tasks would have taken ~10 weeks to
  // drain at the old BATCH_SIZE=3 / 1-call-per-week cadence.
  let nextSync: string
  if (hasPending) {
    // Drain already-submitted (already-paid) tasks promptly — checked FIRST so
    // it applies to Manual sources too. Without this, a Manual source with
    // pending tasks parked next_sync_at at 2999 and the cron never drained them
    // (the cron now picks up due Manual sources in drain-only mode).
    nextSync = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  } else if (source.sync_frequency_hours <= 0) {
    // Manual mode, nothing pending — don't schedule a future auto-sync.
    nextSync = new Date('2999-01-01').toISOString()
  } else {
    nextSync = new Date(Date.now() + source.sync_frequency_hours * 3600 * 1000).toISOString()
  }
  await service.from('review_sources').update({
    last_synced_at: now, next_sync_at: nextSync, updated_at: now, status: 'active',
  }).eq('id', source.id)
}

// Content-addressed dedup key for a review flat-row. Keyed on stable persisted
// fields (NOT review_id — that's fabricated as `profile_name:timestamp` when
// Google omits it, see dataforseo.ts:parseReviewItem). A later backfill can
// recompute the identical key from the stored `data` object.
export function reviewDedupKey(data: Record<string, unknown>): string {
  const s = (v: unknown) => (v == null ? '' : String(v))
  const placeId = s(data.place_id)
  const author = s(data.author).trim().toLowerCase()
  const reviewDate = s(data.review_date)
  const text = s(data.review_text).slice(0, 200).toLowerCase()
  const basis = `${placeId}|${author}|${reviewDate}|${text}`
  return createHash('sha1').update(basis).digest('hex')
}

// Probe URL length cap: keep `.in()` batches small so the query string stays
// well under PostgREST/proxy URL limits (each sha1 key is 40 chars).
const DEDUP_PROBE_CHUNK = 200

async function insertReviewRows(service: SupabaseClient, datasetId: string, rows: Record<string, unknown>[]): Promise<void> {
  const syncTimestamp = new Date().toISOString()

  // 1. Compute dedup_key per row.
  const keyed = rows.map(function(r) { return { data: r, dedup_key: reviewDedupKey(r) } })

  // 2. Drop in-batch dupes (same key), keeping the first occurrence.
  const seen = new Set<string>()
  const deduped = keyed.filter(function(k) {
    if (seen.has(k.dedup_key)) return false
    seen.add(k.dedup_key)
    return true
  })

  // 3. Find which keys already exist in this dataset (chunked .in() probe).
  const allKeys = deduped.map(function(k) { return k.dedup_key })
  const existing = new Set<string>()
  for (let i = 0; i < allKeys.length; i += DEDUP_PROBE_CHUNK) {
    const probe = allKeys.slice(i, i + DEDUP_PROBE_CHUNK)
    const { data: present } = await service
      .from('dataset_rows_flat').select('dedup_key')
      .eq('dataset_id', datasetId).in('dedup_key', probe)
    if (present) for (const row of present) { if (row.dedup_key) existing.add(row.dedup_key as string) }
  }

  // 4. Keep only rows whose key isn't already present.
  const toInsert = deduped.filter(function(k) { return !existing.has(k.dedup_key) })

  // 5. Insert the new rows with a fresh contiguous row_index range.
  if (toInsert.length > 0) {
    const { data: maxRowResp } = await service
      .from('dataset_rows_flat').select('row_index').eq('dataset_id', datasetId)
      .order('row_index', { ascending: false }).limit(1)
    let nextRowIndex = maxRowResp?.length ? maxRowResp[0].row_index + 1 : 0

    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE)
      const flatRows = chunk.map(function(k, j) {
        return { dataset_id: datasetId, row_index: nextRowIndex + j, data: k.data, dedup_key: k.dedup_key }
      })
      await service.from('dataset_rows_flat').insert(flatRows)
      nextRowIndex += chunk.length
    }
  }

  // 6. Reconcile row_count to the ACTUAL count(*) — the old running counter
  // (currentTotal += chunk.length) drifted both ways across syncs.
  const { count } = await service
    .from('dataset_rows_flat').select('*', { count: 'exact', head: true })
    .eq('dataset_id', datasetId)

  await service.from('datasets').update({
    row_count: count ?? 0, last_synced_at: syncTimestamp, updated_at: syncTimestamp,
  }).eq('id', datasetId)
}

async function ensureSchemaAndRecompute(service: SupabaseClient, datasetId: string, sampleRows: Record<string, unknown>[]): Promise<void> {
  const { data: stateRow } = await service
    .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).single()
  let schema = stateRow?.schema_config
  if (!schema?.fields?.length) {
    schema = buildGoogleReviewsSchema()
    schema = enrichSchemaWithStats(schema, sampleRows)
  } else if (sampleRows.length > 0) {
    // Merge new-batch distinct values into existing f.values so per-location
    // fields (location, location_city, location_state, author, ...) grow as
    // additional locations sync — instead of being frozen at the first batch.
    schema = mergeSchemaStats(schema, sampleRows)
  }
  if (schema?.fields?.length) {
    await service.from('dataset_state').update({
      schema_config: schema, updated_at: new Date().toISOString(),
    }).eq('dataset_id', datasetId)
    try {
      const analytics = await computeAnalyticsSQL(service, datasetId, schema)
      await service.from('dataset_state').update({
        analytics, updated_at: new Date().toISOString(),
      }).eq('dataset_id', datasetId)
    } catch (err) { console.error('[reviewSync] analytics compute failed:', err) }
  }
}
