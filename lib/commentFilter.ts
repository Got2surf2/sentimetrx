import 'server-only'

// lib/commentFilter.ts
//
// Read side of the unified Comments filter (TextMine Comments tab). Returns the
// rows matching ALL active facets — theme keywords AND entity terms AND
// dimension (taxonomy) tags — across a dataset's comment scope. AND across
// facets, OR within each. Backs the get_rows_by_filters RPC (sql/113).
//
// Comment scope deliberately differs from entity-catalog scope: a collection
// virtual dataset spans its members, but a plain *branded* dataset is just
// itself (the Comments view loads that one dataset's rows, not brand siblings).
// That mirrors what /rows returns, so the server filter and the client view
// agree on the row population.

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildEntityQuery, buildThemeQuery } from '@/lib/entityFilter'
import { ALL_AXES, type Axis } from '@/lib/taxonomyVocabulary'
import { logError } from '@/lib/log'

/** Collection → member dataset ids; any other dataset → itself. */
async function resolveCommentDatasetIds(service: SupabaseClient, datasetId: string): Promise<string[]> {
  const { data: ds, error: dsErr } = await service
    .from('datasets').select('source').eq('id', datasetId).single()
  if (dsErr) void logError('commentFilter.resolveCommentDatasetIds', dsErr)
  if ((ds as { source?: string } | null)?.source !== 'collection') return [datasetId]
  const { data: col, error: colErr } = await service
    .from('collections').select('id').eq('dataset_id', datasetId).single()
  if (colErr) void logError('commentFilter.resolveCommentDatasetIds', colErr)
  if (!col) return [datasetId]
  const { data: members, error: membersErr } = await service
    .from('collection_members').select('dataset_id').eq('collection_id', (col as { id: string }).id)
  if (membersErr) void logError('commentFilter.resolveCommentDatasetIds', membersErr)
  const ids = ((members || []) as { dataset_id: string }[]).map(m => m.dataset_id)
  return ids.length > 0 ? ids : [datasetId]
}

export interface CommentFilterResult {
  rows:  Array<{ id: number; dataset_id: string; row_index: number; data: Record<string, unknown>; dimEvidence?: string[] }>
  total: number
}

export async function getRowsByFilters(opts: {
  service:       SupabaseClient
  datasetId:     string
  fields:        string[]
  themeKeywords?: string[]
  entities?:     { canonical: string; aliases: string[] }[]
  dimensions?:   { axis: string; sub: string }[]
  limit?:        number
  offset?:       number
}): Promise<CommentFilterResult> {
  const { service, datasetId, fields } = opts
  const limit  = Math.min(Math.max(opts.limit ?? 200, 1), 500)
  const offset = Math.max(opts.offset ?? 0, 0)

  const datasetIds = await resolveCommentDatasetIds(service, datasetId)

  // Same text fields for every member (collections share a schema) — restricts
  // the FTS recheck to the prose the Comments view shows.
  const textFields: Record<string, string[]> = {}
  if (fields.length > 0) for (const did of datasetIds) textFields[did] = fields

  const themeQuery = (opts.themeKeywords && opts.themeKeywords.length > 0)
    ? buildThemeQuery(opts.themeKeywords) : null

  // OR each selected entity's (canonical + aliases) query together.
  const entityQuery = (opts.entities && opts.entities.length > 0)
    ? (opts.entities.map(e => buildEntityQuery(e.canonical, e.aliases)).filter(Boolean).join(' OR ') || null)
    : null

  // One text[] of selected subs per axis (OR'd across axes in SQL).
  const subsByAxis: Record<Axis, string[]> = {
    touchpoint: [], attribute: [], product: [], beverage: [], ambiance: [], context: [], outcome: [], emotion: [],
  }
  for (const d of (opts.dimensions || [])) {
    if ((ALL_AXES as readonly string[]).includes(d.axis) && d.sub) subsByAxis[d.axis as Axis].push(d.sub)
  }
  const hasDim = (opts.dimensions || []).length > 0

  const rpcArgs: Record<string, unknown> = {
    p_dataset_ids:    datasetIds,
    p_text_fields:    Object.keys(textFields).length > 0 ? textFields : null,
    p_theme_query:    themeQuery,
    p_entity_query:   entityQuery,
    p_sub_touchpoint: subsByAxis.touchpoint.length ? subsByAxis.touchpoint : null,
    p_sub_attribute:  subsByAxis.attribute.length  ? subsByAxis.attribute  : null,
    p_sub_product:    subsByAxis.product.length    ? subsByAxis.product    : null,
    p_sub_beverage:   subsByAxis.beverage.length   ? subsByAxis.beverage   : null,
    p_sub_ambiance:   subsByAxis.ambiance.length   ? subsByAxis.ambiance   : null,
    p_sub_context:    subsByAxis.context.length    ? subsByAxis.context    : null,
    p_sub_outcome:    subsByAxis.outcome.length    ? subsByAxis.outcome    : null,
    p_has_dim:        hasDim,
    p_limit:          limit,
    p_offset:         offset,
  }
  // Only sent when an emotion chip is actually selected: the param defaults to
  // NULL server-side, and omitting it keeps this call compatible with the
  // pre-sql/158 function signature (deploy-order safety).
  if (subsByAxis.emotion.length) rpcArgs.p_sub_emotion = subsByAxis.emotion
  const { data: rpcRows, error } = await service.rpc('get_rows_by_filters', rpcArgs)
  if (error) throw new Error(error.message)

  const matched = (rpcRows || []) as Array<{
    id: number; dataset_id: string; row_index: number; data: Record<string, unknown>
    dim_evidence?: string[] | null; total_count: number
  }>
  return {
    // dim_evidence (sql/196): the matched dimension assertions' evidence
    // windows for THIS row — what the Comments view highlights. Absent on a
    // pre-196 database (deploy-order safety) -> no dimension highlights, same
    // as before.
    rows:  matched.map(r => ({ id: r.id, dataset_id: r.dataset_id, row_index: r.row_index, data: r.data, dimEvidence: r.dim_evidence || undefined })),
    total: matched.length > 0 ? Number(matched[0].total_count) : 0,
  }
}
