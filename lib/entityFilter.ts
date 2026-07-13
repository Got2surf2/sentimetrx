import 'server-only'

// lib/entityFilter.ts
//
// Read side of the entity rebuild. Three jobs:
//   1. resolveEntityScope — given any dataset id, work out which
//      entity_catalog scope it reads (its own, or a shared collection /
//      brand-collection catalog) and which member datasets back it.
//   2. getEntitiesWithCounts — read the flat catalog for a scope and
//      attach LIVE full-text row counts (entity_catalog never stores
//      counts; they're computed at read time via count_entity_terms so
//      they stay accurate across the whole dataset, not a sample).
//   3. getRowsByEntity — pull the actual rows that mention one entity.
//
// Discovery (lib/entityDiscovery.ts) is the write side and shares
// resolveEntityScope + slugify from here.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SchemaConfig } from '@/lib/analyzeTypes'
import { logError } from '@/lib/log'

// ── slugify — JS mirror of sql/060 public.slugify() ────────────────────────
// Must stay byte-for-byte equivalent: it's the join key between catalog
// rows discovered in-app and rows the SQL layer / triggers produce.
export function slugify(input: string): string {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '') // strip one leading article
    .replace(/['`’]/g, '')         // strip apostrophes / curly quotes
    .replace(/[^a-z0-9]+/g, '_')   // non-alphanumeric runs -> underscore
    .replace(/^_+|_+$/g, '')       // trim underscores
}

// ── Scope resolution ───────────────────────────────────────────────────────

export interface EntityScope {
  found:            boolean
  scopeType:        'dataset' | 'collection'
  scopeId:          string
  memberDatasetIds: string[]
  orgId:            string | null
}

/** Resolve the entity_catalog scope for any dataset id.
 *
 *  - collection virtual dataset  -> ('collection', collections.id), counted
 *    across its collection_members
 *  - dataset with a brand_tag    -> ('collection', brand_collection_id),
 *    counted across every dataset sharing that brand-collection
 *  - plain dataset               -> ('dataset', dataset.id), counted alone
 *
 *  Caller is responsible for org-scope authorisation (use the returned
 *  orgId — admins bypass, non-admins must match). */
export async function resolveEntityScope(
  service: SupabaseClient,
  datasetId: string,
): Promise<EntityScope> {
  const { data: ds, error: dsErr } = await service
    .from('datasets')
    .select('id, source, org_id, brand_collection_id')
    .eq('id', datasetId)
    .single()
  if (dsErr) void logError('entityFilter.resolveEntityScope', dsErr)

  if (!ds) {
    return { found: false, scopeType: 'dataset', scopeId: datasetId, memberDatasetIds: [], orgId: null }
  }
  const dsRow = ds as { id: string; source: string | null; org_id: string | null; brand_collection_id: string | null }
  const orgId = dsRow.org_id

  // Collection virtual dataset → collection scope across its members.
  if (dsRow.source === 'collection') {
    const { data: col, error: colErr } = await service
      .from('collections').select('id').eq('dataset_id', datasetId).single()
    if (colErr) void logError('entityFilter.resolveEntityScope', colErr, { orgId: orgId ?? undefined })
    if (col) {
      const colId = (col as { id: string }).id
      const { data: members, error: membersErr } = await service
        .from('collection_members').select('dataset_id').eq('collection_id', colId)
      if (membersErr) void logError('entityFilter.resolveEntityScope', membersErr, { orgId: orgId ?? undefined })
      const memberIds = ((members || []) as Array<{ dataset_id: string }>).map(m => m.dataset_id)
      return {
        found: true, scopeType: 'collection', scopeId: colId,
        memberDatasetIds: memberIds.length > 0 ? memberIds : [datasetId],
        orgId,
      }
    }
    // collection link row missing — degrade to dataset scope.
    return { found: true, scopeType: 'dataset', scopeId: datasetId, memberDatasetIds: [datasetId], orgId }
  }

  // Branded dataset → shared brand-collection catalog across the brand's datasets.
  const brandColId = dsRow.brand_collection_id
  if (brandColId) {
    const { data: siblings, error: siblingsErr } = await service
      .from('datasets').select('id').eq('brand_collection_id', brandColId)
    if (siblingsErr) void logError('entityFilter.resolveEntityScope', siblingsErr, { orgId: orgId ?? undefined })
    const memberIds = ((siblings || []) as Array<{ id: string }>).map(s => s.id)
    return {
      found: true, scopeType: 'collection', scopeId: brandColId,
      memberDatasetIds: memberIds.length > 0 ? memberIds : [datasetId],
      orgId,
    }
  }

  // Plain dataset → own scope.
  return { found: true, scopeType: 'dataset', scopeId: datasetId, memberDatasetIds: [datasetId], orgId }
}

// ── Open-ended field resolution ────────────────────────────────────────────

/** The field keys eligible for entity extraction from a dataset's schema:
 *  `open-ended` type and not explicitly opted out (`entityExtraction !==
 *  false`). Categorical (location / state) columns, numerics, dates, and
 *  ignored fields are excluded — feeding their values to entity NER or
 *  matching entities against them just produces noise like "Florida". Shared
 *  by the write side (lib/entityDiscovery.ts) and the read side below. */
export function eligibleEntityFields(schemaConfig: unknown): string[] {
  const fields = (schemaConfig as SchemaConfig | null)?.fields
  if (!Array.isArray(fields)) return []
  return fields
    .filter(f => f.type === 'open-ended' && f.entityExtraction !== false)
    .map(f => f.field)
}

/** Map each member dataset to its entity-eligible open-ended field keys.
 *  Passed to count_entity_terms / get_rows_by_entity as the `p_text_fields`
 *  jsonb so full-text entity matches are rechecked against review prose only,
 *  never structured columns like a `location` label. A dataset with no
 *  eligible fields is omitted — it contributes no entity matches. */
async function resolveScopeTextFields(
  service: SupabaseClient,
  datasetIds: string[],
): Promise<Record<string, string[]>> {
  if (datasetIds.length === 0) return {}
  const { data, error: stateErr } = await service
    .from('dataset_state')
    .select('dataset_id, schema_config')
    .in('dataset_id', datasetIds)
  if (stateErr) void logError('entityFilter.resolveScopeTextFields', stateErr)
  const out: Record<string, string[]> = {}
  for (const row of (data || []) as Array<{ dataset_id: string; schema_config: unknown }>) {
    const fields = eligibleEntityFields(row.schema_config)
    if (fields.length > 0) out[row.dataset_id] = fields
  }
  return out
}

/** Like resolveScopeTextFields but narrows each dataset's eligible fields to a
 *  caller-supplied subset (still intersected with eligibility so a non-text or
 *  extraction-disabled key can't widen the search). Used by the deck export to
 *  scope entity counts to the *selected* field (e.g. "Charities donated to")
 *  instead of every open-ended field — so a place named in a different field
 *  doesn't surface on a charity entity slide. Returns {} when nothing matches
 *  (caller falls back to the unscoped map). */
async function scopeTextFieldsToKeys(
  service: SupabaseClient,
  datasetIds: string[],
  keys: string[],
): Promise<Record<string, string[]>> {
  const all = await resolveScopeTextFields(service, datasetIds)
  const keySet = new Set(keys)
  const out: Record<string, string[]> = {}
  for (const [dsId, fields] of Object.entries(all)) {
    const kept = fields.filter(f => keySet.has(f))
    if (kept.length > 0) out[dsId] = kept
  }
  return out
}

// ── Entity query construction ──────────────────────────────────────────────

/** Build one websearch_to_tsquery string for a catalog entity: the canonical
 *  plus every alias, each quoted as a phrase, OR'd together. Embedded quotes
 *  stripped so websearch parsing stays predictable. */
export function buildEntityQuery(canonical: string, aliases: string[]): string {
  const variants = [canonical, ...(aliases || [])]
  const seen = new Set<string>()
  const quoted: string[] = []
  for (const v of variants) {
    const clean = (v || '').replace(/["']/g, '').trim()
    if (clean.length < 2) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    quoted.push('"' + clean + '"')
  }
  return quoted.join(' OR ')
}

/** Build a websearch query from a theme's keyword list (OR'd phrases). */
export function buildThemeQuery(keywords: string[]): string | null {
  const quoted = (keywords || [])
    .map(k => (k || '').replace(/["']/g, '').trim())
    .filter(k => k.length >= 2)
    .map(k => '"' + k + '"')
  return quoted.length > 0 ? quoted.join(' OR ') : null
}

// ── Entity mention counts (stored + sampled at scale) ──────────────────────
// getEntitiesWithCounts attaches a live full-text `mentions` count per catalog
// entity via count_entity_terms — on EVERY read (entities aren't client-cached).
// At ~1M rows that RPC 57014s (common terms match hundreds of thousands of rows
// × up to ~300 catalog terms). Two mechanisms close it (sql/172):
//   * SAMPLED compute for single-dataset scope above the 50K cap
//     (sampled_count_entity_terms, keyset-paged over idx_drf_sample, scaled).
//   * STORED counts on entity_catalog, keyed by the scope row total, served on
//     default reads with zero scans and refreshed in the background on drift.

/** Platform 50K sampling cap, shared with the bulk-rows/signal-stats family. */
const ENTITY_SAMPLE_CAP = 50000
const ENTITY_PAGE_TERMROW_BUDGET = 80000 // term×rows per page → per-page well under the 8s timeout

/** Sum of stored row_count across a scope's member datasets (O(1) per member —
 *  reads the stored column, no scan). The staleness key for stored counts. */
async function scopeRowTotal(service: SupabaseClient, datasetIds: string[]): Promise<number> {
  if (datasetIds.length === 0) return 0
  const { data } = await service.from('datasets').select('row_count').in('id', datasetIds)
  return ((data || []) as Array<{ row_count: number | null }>).reduce((a, r) => a + (Number(r.row_count) || 0), 0)
}

/** Sampled entity counts for ONE dataset above the cap — keyset-pages the 50K
 *  idx_drf_sample (sql/172) and scales counts by total/scanned. Page size adapts
 *  to the term count so no single RPC page approaches the statement timeout.
 *  Returns raw scaled counts keyed by term (the websearch query string). */
async function sampledEntityTermCounts(
  service: SupabaseClient, datasetId: string, terms: string[],
  themeQuery: string | null, textFields: string[], total: number,
): Promise<Map<string, number>> {
  const raw = new Map<string, number>()
  if (terms.length === 0) return raw
  const pageSize = Math.min(5000, Math.max(500, Math.round(ENTITY_PAGE_TERMROW_BUDGET / terms.length)))
  let scanned = 0, afterHash = -1, afterId = -1
  while (scanned < ENTITY_SAMPLE_CAP) {
    const { data, error } = await service.rpc('sampled_count_entity_terms', {
      p_dataset_id: datasetId,
      p_terms: terms,
      p_theme_query: themeQuery,
      p_text_fields: textFields.length ? textFields : null,
      p_after_hash: afterHash,
      p_after_id: afterId,
      p_limit: Math.min(pageSize, ENTITY_SAMPLE_CAP - scanned),
    })
    if (error) throw new Error('sampled_count_entity_terms: ' + error.message)
    const page = data as { n_scanned?: number; counts?: [string, number][]; last_hash?: number | null; last_id?: number | null } | null
    const n = Number(page?.n_scanned) || 0
    if (!page || n === 0) break
    scanned += n
    for (const c of page.counts || []) raw.set(c[0], (raw.get(c[0]) || 0) + Number(c[1]))
    if (page.last_hash == null || page.last_id == null) break
    afterHash = Number(page.last_hash); afterId = Number(page.last_id)
  }
  // Scale sample matches to the full dataset (exact below the cap: scanned==total).
  const scaled = new Map<string, number>()
  for (const [term, n] of raw) scaled.set(term, scanned > 0 ? Math.round(n * total / scanned) : 0)
  return scaled
}

interface CatalogEntry { slug: string; canonical: string; category: string; aliases: string[]; source: string; hidden: boolean }

/** Compute live full-text counts for a catalog, choosing the sampled twin for a
 *  single dataset above the cap and the exact count_entity_terms otherwise.
 *  Returns counts keyed by the entity query string + whether they're sampled. */
async function computeEntityCounts(
  service: SupabaseClient,
  scope: EntityScope,
  queryByEntity: Map<string, string>,
  themeQuery: string | null,
  total: number,
  textFieldKeys?: string[],
): Promise<{ countByTerm: Map<string, number>; sampled: boolean }> {
  const countByTerm = new Map<string, number>()
  const terms = Array.from(new Set(Array.from(queryByEntity.values()).filter(Boolean)))
  if (terms.length === 0) return { countByTerm, sampled: false }

  // Scope counts to caller-selected fields when asked, else every eligible field.
  let textFields = (textFieldKeys && textFieldKeys.length > 0)
    ? await scopeTextFieldsToKeys(service, scope.memberDatasetIds, textFieldKeys)
    : await resolveScopeTextFields(service, scope.memberDatasetIds)
  if (Object.keys(textFields).length === 0) {
    textFields = await resolveScopeTextFields(service, scope.memberDatasetIds)
  }

  // A single member dataset above the cap → sampled (never 57014s). Covers both
  // plain datasets and single-member brand collections (a branded upload with
  // no siblings still resolves to collection scope). Multi-member collections
  // stay on the live path (many small member datasets, not 1M-row ones).
  const singleDataset = scope.memberDatasetIds.length === 1
  if (singleDataset && total > ENTITY_SAMPLE_CAP) {
    const dsId = scope.memberDatasetIds[0]
    const scaled = await sampledEntityTermCounts(service, dsId, terms, themeQuery, textFields[dsId] || [], total)
    for (const [term, n] of scaled) countByTerm.set(term, n)
    return { countByTerm, sampled: true }
  }

  const { data: counts, error: countsErr } = await service.rpc('count_entity_terms', {
    p_dataset_ids: scope.memberDatasetIds,
    p_terms:       terms,
    p_theme_query: themeQuery,
    p_text_fields: textFields,
  })
  if (countsErr) void logError('entityFilter.computeEntityCounts', countsErr)
  for (const c of (counts || []) as Array<{ term: string; row_count: number }>) {
    countByTerm.set(c.term, Number(c.row_count) || 0)
  }
  return { countByTerm, sampled: false }
}

/** Recompute + store the default (no theme, no field-scoping) mention counts for
 *  a dataset's scope, keyed by the current row total. Called at discovery /
 *  manual-add time (the catalog already rebuilds then) and fired in the
 *  background by getEntitiesWithCounts when stored counts drift. Best-effort:
 *  logs and swallows failures so it never breaks its caller. */
export async function storeEntityMentionCounts(service: SupabaseClient, datasetId: string): Promise<void> {
  try {
    const scope = await resolveEntityScope(service, datasetId)
    if (!scope.found) return
    let q = service
      .from('entity_catalog')
      .select('slug, canonical, aliases, hidden')
      .eq('scope_type', scope.scopeType)
      .eq('scope_id', scope.scopeId)
      .eq('hidden', false)
    if (scope.scopeType === 'collection') q = q.neq('category', 'person')
    const { data: catalog, error } = await q
    if (error) { void logError('entityFilter.storeEntityMentionCounts', error); return }
    const rows = (catalog || []) as Array<{ slug: string; canonical: string; aliases: string[] | null }>
    if (rows.length === 0) return
    const queryByEntity = new Map<string, string>()
    for (const e of rows) queryByEntity.set(e.slug, buildEntityQuery(e.canonical, e.aliases || []))
    const total = await scopeRowTotal(service, scope.memberDatasetIds)
    const { countByTerm, sampled } = await computeEntityCounts(service, scope, queryByEntity, null, total)
    const bySlug: Record<string, number> = {}
    for (const e of rows) bySlug[e.slug] = countByTerm.get(queryByEntity.get(e.slug) || '') || 0
    const { error: applyErr } = await service.rpc('apply_entity_mention_counts', {
      p_scope_type: scope.scopeType, p_scope_id: scope.scopeId,
      p_row_total: total, p_sampled: sampled, p_counts: bySlug,
    })
    if (applyErr) void logError('entityFilter.storeEntityMentionCounts', applyErr)
  } catch (e) {
    void logError('entityFilter.storeEntityMentionCounts', e instanceof Error ? e : new Error(String(e)))
  }
}

// ── getEntitiesWithCounts ──────────────────────────────────────────────────

export interface EntityWithCount {
  slug:      string
  canonical: string
  category:  string
  aliases:   string[]
  /** Live full-text row count. Named `mentions` for back-compat with the
   *  theme-card + Schema-panel UI that already reads this field. */
  mentions:  number
  /** Present only when getEntitiesWithCounts is called with includeHidden=true
   *  (the Manage Entities panel). UI uses this to badge manual vs discovered
   *  and to surface hide/unhide state. */
  source?:   'discovered' | 'manual'
  hidden?:   boolean
}

export interface EntitiesResult {
  entities:       EntityWithCount[]
  categories:     { category: string; mentions: number }[]
  total_distinct: number
  scope_type:     'dataset' | 'collection'
  last_refresh:   { triggered_at: string; triggered_by: string; entities_after: number | null } | null
  /** true when counts were estimated over the 50K sample + scaled (dataset
   *  above the cap) — the UI shows a "~". sql/172. */
  sampled?:       boolean
}

/** Read the entity catalog for a dataset's scope and attach live counts.
 *  `themeKeywords` intersects counts with a theme's keyword match (powers
 *  the theme card "Top entities" section). Returns { notFound: true } when
 *  the dataset id doesn't resolve. */
export async function getEntitiesWithCounts(opts: {
  service:       SupabaseClient
  datasetId:     string
  themeKeywords?: string[]
  limit?:        number
  catalogLimit?: number
  /** Manage Entities panel only. When true the read includes hidden rows
   *  and returns source/hidden flags so the UI can show curation state.
   *  All other callers (cloud, compare, drill) leave this off. */
  includeHidden?: boolean
  /** Restrict live counts to these open-ended field keys (intersected with
   *  each dataset's entity-eligible fields). Default (undefined/empty) counts
   *  across every eligible field. The deck export passes the selected entity
   *  field so counts reflect that field only. */
  textFieldKeys?: string[]
}): Promise<EntitiesResult | { notFound: true }> {
  const { service, datasetId, includeHidden } = opts
  const limit        = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const catalogLimit = Math.min(Math.max(opts.catalogLimit ?? 300, 1), 500)

  const scope = await resolveEntityScope(service, datasetId)
  if (!scope.found) return { notFound: true }

  // Catalog for this scope. Default reads sort by sample_count DESC (NER's
  // hit-frequency hint) and cap at catalogLimit so cheap previews stay fast.
  // hidden rows are soft-deleted (lib/entityDiscovery.ts skips them on upsert;
  // we drop them here so they never reach cloud / compare / drill UI).
  //
  // Manage Entities passes includeHidden=true. Two important diffs in that
  // mode:
  //   1. Sort by `source ASC` first so 'discovered' < 'manual' alphabetically
  //      — pulls manual entries to the top. Manual entries from a menu seed
  //      have sample_count=1 (the seed never bumps them via NER samples), so
  //      sort-by-sample_count alone would push them past the catalogLimit
  //      cutoff on big catalogs (e.g. Fleming's 557 rows, 500 cap).
  //   2. No cap. The Manage panel needs the COMPLETE catalog so users can
  //      hide / unhide / edit any row, not just the top N. Catalog size is
  //      bounded by the discovery cap (MAX_ENTITIES=400 + manual entries),
  //      so even with no limit this is a few hundred rows at most.
  //
  // At collection scope (brand-collections covering many locations), person
  // entities are noise — staff names from hundreds of restaurants, each
  // mentioned in 1–2 reviews. They dominate the catalog and add no brand-
  // wide signal. Suppressed from default reads (cloud / compare / drill /
  // schema preview / Ask Ana). The Manage panel keeps seeing them so users
  // can hide specific ones or recategorise standout chefs as 'brand'.
  // Standalone dataset scope (single-location operators) keeps person —
  // there, "Maria got 40 mentions" is genuine signal.
  let catalogQuery = service
    .from('entity_catalog')
    .select('slug, canonical, category, aliases, sample_count, source, hidden, mention_count, mention_count_sampled, mention_count_row_total')
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
  if (includeHidden) {
    catalogQuery = catalogQuery
      .order('source', { ascending: false })       // 'manual' > 'discovered'
      .order('sample_count', { ascending: false }) // tiebreak
  } else {
    catalogQuery = catalogQuery
      .order('sample_count', { ascending: false })
      .limit(catalogLimit)
  }
  if (!includeHidden) catalogQuery = catalogQuery.eq('hidden', false)
  if (!includeHidden && scope.scopeType === 'collection') {
    catalogQuery = catalogQuery.neq('category', 'person')
  }
  const { data: catalog, error: catalogErr } = await catalogQuery
  if (catalogErr) void logError('entityFilter.getEntitiesWithCounts', catalogErr)

  const entries = (catalog || []) as Array<{
    slug: string; canonical: string; category: string; aliases: string[]; sample_count: number; source: string; hidden: boolean
    mention_count: number | null; mention_count_sampled: boolean | null; mention_count_row_total: number | null
  }>

  // Latest refresh audit row — drives the "last refreshed" UI.
  const { data: refreshRows, error: refreshErr } = await service
    .from('entity_catalog_refresh')
    .select('triggered_at, triggered_by, entities_after')
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
    .order('triggered_at', { ascending: false })
    .limit(1)
  if (refreshErr) void logError('entityFilter.getEntitiesWithCounts', refreshErr)
  const last_refresh = (refreshRows && (refreshRows[0] as EntitiesResult['last_refresh'])) || null

  if (entries.length === 0) {
    return { entities: [], categories: [], total_distinct: 0, scope_type: scope.scopeType, last_refresh }
  }

  // One websearch query per entity; dedupe identical queries.
  const queryByEntity = new Map<string, string>()
  for (const e of entries) queryByEntity.set(e.slug, buildEntityQuery(e.canonical, e.aliases))

  const themeQuery = opts.themeKeywords ? buildThemeQuery(opts.themeKeywords) : null

  // A DEFAULT read (no theme, no field scoping, not the Manage panel) is the hot
  // path (Schema tab, cloud, Ask Ana) and can serve STORED counts (sql/172) with
  // zero scans when they're present + keyed to the current scope row total. The
  // theme / field-scoped / manage paths always compute live (their counts vary
  // per request and aren't cached).
  const isDefaultRead = !themeQuery && !(opts.textFieldKeys && opts.textFieldKeys.length) && !includeHidden
  const total = await scopeRowTotal(service, scope.memberDatasetIds)

  const countByTerm = new Map<string, number>()
  let sampled = false
  const storedFresh = isDefaultRead && entries.every(e =>
    e.mention_count != null && Number(e.mention_count_row_total) === total)

  if (storedFresh) {
    for (const e of entries) countByTerm.set(queryByEntity.get(e.slug) || '', Number(e.mention_count) || 0)
    sampled = entries.some(e => !!e.mention_count_sampled)
  } else {
    const computed = await computeEntityCounts(service, scope, queryByEntity, themeQuery, total, opts.textFieldKeys)
    for (const [term, n] of computed.countByTerm) countByTerm.set(term, n)
    sampled = computed.sampled
    // Populate / refresh the store in the background (default reads only) so the
    // next read is a zero-scan hit. Fire-and-forget — never blocks this response.
    if (isDefaultRead) void storeEntityMentionCounts(service, datasetId)
  }

  // Attach counts. Default reads drop zero-count entries — discovery
  // sometimes surfaces a canonical too generic to match cleanly, and the
  // catalog self-heals on the next discovery run. Manage Entities keeps
  // zeros visible so the user can see (and curate) entries that aren't yet
  // matching against any row.
  const withCounts: EntityWithCount[] = entries
    .map(e => ({
      slug:      e.slug,
      canonical: e.canonical,
      category:  e.category,
      aliases:   e.aliases || [],
      mentions:  countByTerm.get(queryByEntity.get(e.slug) || '') || 0,
      ...(includeHidden ? { source: (e.source as 'discovered' | 'manual') || 'discovered', hidden: !!e.hidden } : {}),
    }))
    .filter(e => includeHidden || e.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions)

  const categoryAgg = new Map<string, number>()
  for (const e of withCounts) {
    categoryAgg.set(e.category, (categoryAgg.get(e.category) || 0) + e.mentions)
  }
  const categories = Array.from(categoryAgg.entries())
    .map(([category, mentions]) => ({ category, mentions }))
    .sort((a, b) => b.mentions - a.mentions)

  return {
    entities:       withCounts.slice(0, limit),
    categories,
    total_distinct: withCounts.length,
    scope_type:     scope.scopeType,
    last_refresh,
    sampled,
  }
}

// ── getRowsByEntity ────────────────────────────────────────────────────────

export interface RowsByEntityResult {
  rows:     Array<{ id: number; dataset_id: string; row_index: number; data: Record<string, unknown> }>
  entity:   { slug: string; canonical: string; category: string } | null
  total:    number | null
  notFound?: true
}

/** Pull the rows that mention one catalog entity, across the scope's member
 *  datasets. `entitySlug` is the entity_catalog.slug. */
export async function getRowsByEntity(opts: {
  service:    SupabaseClient
  datasetId:  string
  entitySlug: string
  limit?:     number
  offset?:    number
}): Promise<RowsByEntityResult> {
  const { service, datasetId, entitySlug } = opts
  const limit  = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const offset = Math.max(opts.offset ?? 0, 0)

  const scope = await resolveEntityScope(service, datasetId)
  if (!scope.found) return { rows: [], entity: null, total: null, notFound: true }

  const { data: entityRow, error: entityRowErr } = await service
    .from('entity_catalog')
    .select('slug, canonical, category, aliases')
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
    .eq('slug', entitySlug)
    .single()
  if (entityRowErr) void logError('entityFilter.getRowsByEntity', entityRowErr)
  if (!entityRow) return { rows: [], entity: null, total: 0 }

  const entityRowTyped = entityRow as { slug: string; canonical: string; category: string; aliases: string[] | null }
  const entity = {
    slug:      entityRowTyped.slug,
    canonical: entityRowTyped.canonical,
    category:  entityRowTyped.category,
  }
  const query = buildEntityQuery(entity.canonical, entityRowTyped.aliases || [])
  if (!query) return { rows: [], entity, total: 0 }

  const textFields = await resolveScopeTextFields(service, scope.memberDatasetIds)
  const { data: rpcRows, error: rpcRowsErr } = await service.rpc('get_rows_by_entity', {
    p_dataset_ids: scope.memberDatasetIds,
    p_query:       query,
    p_text_fields: textFields,
    p_limit:       limit,
    p_offset:      offset,
  })
  if (rpcRowsErr) void logError('entityFilter.getRowsByEntity', rpcRowsErr)

  const matched = (rpcRows || []) as Array<{
    id: number; dataset_id: string; row_index: number
    data: Record<string, unknown>; total_count: number
  }>
  return {
    rows:   matched.map(r => ({ id: r.id, dataset_id: r.dataset_id, row_index: r.row_index, data: r.data })),
    entity,
    total:  matched.length > 0 ? Number(matched[0].total_count) : 0,
  }
}
