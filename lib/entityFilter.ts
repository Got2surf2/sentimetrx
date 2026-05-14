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
function buildThemeQuery(keywords: string[]): string | null {
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
}): Promise<EntitiesResult | { notFound: true }> {
  const { service, datasetId } = opts
  const limit        = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const catalogLimit = Math.min(Math.max(opts.catalogLimit ?? 300, 1), 500)

  const scope = await resolveEntityScope(service, datasetId)
  if (!scope.found) return { notFound: true }

  // Catalog for this scope, most-sampled first.
  const { data: catalog } = await service
    .from('entity_catalog')
    .select('slug, canonical, category, aliases, sample_count')
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
    .order('sample_count', { ascending: false })
    .limit(catalogLimit)

  const entries = (catalog || []) as Array<{
    slug: string; canonical: string; category: string; aliases: string[]; sample_count: number
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
    const { data: counts } = await service.rpc('count_entity_terms', {
      p_dataset_ids: scope.memberDatasetIds,
      p_terms:       terms,
      p_theme_query: themeQuery,
    })
    for (const c of (counts || []) as Array<{ term: string; row_count: number }>) {
      countByTerm.set(c.term, Number(c.row_count) || 0)
    }
  }

  // Attach counts; drop zero-count entries — discovery sometimes surfaces a
  // canonical too generic to match cleanly. The catalog self-heals on the
  // next discovery run; meanwhile the UI only shows entities actually present.
  const withCounts: EntityWithCount[] = entries
    .map(e => ({
      slug:      e.slug,
      canonical: e.canonical,
      category:  e.category,
      aliases:   e.aliases || [],
      mentions:  countByTerm.get(queryByEntity.get(e.slug) || '') || 0,
    }))
    .filter(e => e.mentions > 0)
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

  const { data: rows, count } = await service
    .from('dataset_rows_flat')
    .select('id, dataset_id, row_index, data', { count: 'exact' })
    .in('dataset_id', scope.memberDatasetIds)
    .textSearch('tsv', query, { type: 'websearch', config: 'english' })
    .order('row_index', { ascending: true })
    .range(offset, offset + limit - 1)

  return {
    rows:   (rows || []) as RowsByEntityResult['rows'],
    entity,
    total:  typeof count === 'number' ? count : null,
  }
}
