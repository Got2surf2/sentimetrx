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
  const { data: ds } = await service
    .from('datasets')
    .select('id, source, org_id, brand_collection_id')
    .eq('id', datasetId)
    .single()

  if (!ds) {
    return { found: false, scopeType: 'dataset', scopeId: datasetId, memberDatasetIds: [], orgId: null }
  }
  const orgId = (ds as any).org_id as string | null

  // Collection virtual dataset → collection scope across its members.
  if ((ds as any).source === 'collection') {
    const { data: col } = await service
      .from('collections').select('id').eq('dataset_id', datasetId).single()
    if (col) {
      const { data: members } = await service
        .from('collection_members').select('dataset_id').eq('collection_id', (col as any).id)
      const memberIds = (members || []).map((m: any) => m.dataset_id as string)
      return {
        found: true, scopeType: 'collection', scopeId: (col as any).id as string,
        memberDatasetIds: memberIds.length > 0 ? memberIds : [datasetId],
        orgId,
      }
    }
    // collection link row missing — degrade to dataset scope.
    return { found: true, scopeType: 'dataset', scopeId: datasetId, memberDatasetIds: [datasetId], orgId }
  }

  // Branded dataset → shared brand-collection catalog across the brand's datasets.
  const brandColId = (ds as any).brand_collection_id as string | null
  if (brandColId) {
    const { data: siblings } = await service
      .from('datasets').select('id').eq('brand_collection_id', brandColId)
    const memberIds = (siblings || []).map((s: any) => s.id as string)
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
  const { data } = await service
    .from('dataset_state')
    .select('dataset_id, schema_config')
    .in('dataset_id', datasetIds)
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
    .select('slug, canonical, category, aliases, sample_count, source, hidden')
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
  const { data: catalog } = await catalogQuery

  const entries = (catalog || []) as Array<{
    slug: string; canonical: string; category: string; aliases: string[]; sample_count: number; source: string; hidden: boolean
  }>

  // Latest refresh audit row — drives the "last refreshed" UI.
  const { data: refreshRows } = await service
    .from('entity_catalog_refresh')
    .select('triggered_at, triggered_by, entities_after')
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
    .order('triggered_at', { ascending: false })
    .limit(1)
  const last_refresh = (refreshRows && (refreshRows[0] as any)) || null

  if (entries.length === 0) {
    return { entities: [], categories: [], total_distinct: 0, scope_type: scope.scopeType, last_refresh }
  }

  // One websearch query per entity; dedupe identical queries.
  const queryByEntity = new Map<string, string>()
  for (const e of entries) queryByEntity.set(e.slug, buildEntityQuery(e.canonical, e.aliases))
  const terms = Array.from(new Set(Array.from(queryByEntity.values()).filter(Boolean)))

  const themeQuery = opts.themeKeywords ? buildThemeQuery(opts.themeKeywords) : null

  const countByTerm = new Map<string, number>()
  if (terms.length > 0) {
    // Scope counts to caller-selected fields when asked, else every eligible field.
    // Fall back to the unscoped map if the requested keys match nothing (so the
    // deck still renders entities rather than coming back empty).
    let textFields = (opts.textFieldKeys && opts.textFieldKeys.length > 0)
      ? await scopeTextFieldsToKeys(service, scope.memberDatasetIds, opts.textFieldKeys)
      : await resolveScopeTextFields(service, scope.memberDatasetIds)
    if (Object.keys(textFields).length === 0) {
      textFields = await resolveScopeTextFields(service, scope.memberDatasetIds)
    }
    const { data: counts } = await service.rpc('count_entity_terms', {
      p_dataset_ids: scope.memberDatasetIds,
      p_terms:       terms,
      p_theme_query: themeQuery,
      p_text_fields: textFields,
    })
    for (const c of (counts || []) as Array<{ term: string; row_count: number }>) {
      countByTerm.set(c.term, Number(c.row_count) || 0)
    }
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

  const { data: entityRow } = await service
    .from('entity_catalog')
    .select('slug, canonical, category, aliases')
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
    .eq('slug', entitySlug)
    .single()
  if (!entityRow) return { rows: [], entity: null, total: 0 }

  const entity = {
    slug:      (entityRow as any).slug as string,
    canonical: (entityRow as any).canonical as string,
    category:  (entityRow as any).category as string,
  }
  const query = buildEntityQuery(entity.canonical, (entityRow as any).aliases || [])
  if (!query) return { rows: [], entity, total: 0 }

  const textFields = await resolveScopeTextFields(service, scope.memberDatasetIds)
  const { data: rpcRows } = await service.rpc('get_rows_by_entity', {
    p_dataset_ids: scope.memberDatasetIds,
    p_query:       query,
    p_text_fields: textFields,
    p_limit:       limit,
    p_offset:      offset,
  })

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
