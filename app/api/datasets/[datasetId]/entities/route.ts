// app/api/datasets/[datasetId]/entities/route.ts
// GET  — list catalog entities for a dataset's scope, with LIVE full-text
//        counts. Scope-resolving: a plain dataset reads its own catalog; a
//        branded or collection dataset reads the shared collection catalog
//        and counts across every member dataset.
//          ?theme=<themeId>   intersect counts with the theme's keyword match
//          ?limit=<n>         default 50, max 200
// POST — create one or many `source='manual'` catalog entries for the scope.
//        Body: { entities: [{ canonical, category?, aliases? }, ...] } or a
//        single { canonical, category?, aliases? } object. Used by the
//        Manage Entities panel (single-add and bulk-paste) and by menu-PDF
//        seeding through Claude Code. Existing rows with the same slug are
//        merged (alias-union); discovery-source rows are converted to manual
//        when explicitly re-added by a user.
//
// Used by the Schema-tab ExtractEntitiesPanel, the theme-card "Top entities"
// section, and Ask Ana.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { getEntitiesWithCounts, resolveEntityScope, slugify } from '@/lib/entityFilter'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

const CATEGORIES = ['food', 'drink', 'place', 'person', 'brand', 'other']
const MAX_ALIASES_PER_ENTITY = 25
const MAX_BULK = 500

interface Params { params: Promise<{ datasetId: string }> }

interface ThemeModelTheme { id: string; keywords?: string[] }

export async function GET(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service
    .from('datasets').select('id, org_id').eq('id', params.datasetId).single()
  if (!ds) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && (ds as { org_id: string }).org_id !== orgId) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const themeId = url.searchParams.get('theme')
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200)
  const manage = url.searchParams.get('manage') === '1'

  // Theme path: resolve the theme's keywords so counts intersect the theme.
  let themeKeywords: string[] | undefined
  if (themeId) {
    const { data: stateRow } = await service
      .from('dataset_state').select('theme_model').eq('dataset_id', params.datasetId).single()
    const themeModel = ((stateRow as { theme_model?: unknown } | null)?.theme_model ?? {}) as { themes?: ThemeModelTheme[] }
    const theme = (themeModel.themes || []).find(t => t.id === themeId)
    if (!theme || !theme.keywords || theme.keywords.length === 0) {
      return NextResponse.json({ entities: [], categories: [], total_distinct: 0, theme_id: themeId, note: 'theme not found or has no keywords' })
    }
    themeKeywords = theme.keywords
  }

  const result = await getEntitiesWithCounts({
    service,
    datasetId: params.datasetId,
    themeKeywords,
    limit:        manage ? 500 : limit,
    catalogLimit: manage ? 500 : undefined,
    includeHidden: manage,
  })

  if ('notFound' in result) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }

  return NextResponse.json(themeId ? { ...result, theme_id: themeId } : result)
}

interface IncomingEntity { canonical?: unknown; category?: unknown; aliases?: unknown }

interface ExistingCatalogRow {
  slug: string
  canonical: string
  category: string
  aliases: string[] | null
  sample_count: number | null
  source: string | null
  hidden: boolean | null
}

function normaliseAliases(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of input) {
    if (typeof v !== 'string') continue
    const clean = v.trim().toLowerCase()
    if (clean.length < 2) continue
    if (seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
    if (out.length >= MAX_ALIASES_PER_ENTITY) break
  }
  return out
}

export async function POST(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  // Multi-tenancy: pair id with org_id on the service-role lookup. Bare id
  // would leak across orgs (CLAUDE.md multi-tenancy rule, six May-2026
  // CRITICAL findings were this pattern).
  const dsQuery = service.from('datasets').select('id, org_id').eq('id', params.datasetId)
  const { data: ds } = isAdmin ? await dsQuery.single() : await dsQuery.eq('org_id', orgId).single()
  if (!ds) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  // Accept either a single entity object or { entities: [...] }.
  const bodyObj = (body && typeof body === 'object' ? body : {}) as { entities?: unknown }
  const incoming: IncomingEntity[] = Array.isArray(bodyObj.entities)
    ? (bodyObj.entities as IncomingEntity[])
    : (body && typeof body === 'object' && 'canonical' in bodyObj
        ? [body as IncomingEntity]
        : [])
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'Body must be a single entity ({canonical,...}) or {entities:[...]}.' }, { status: 400 })
  }
  if (incoming.length > MAX_BULK) {
    return NextResponse.json({ error: `Too many entities in one request (max ${MAX_BULK}).` }, { status: 400 })
  }

  const scope = await resolveEntityScope(service, params.datasetId)
  if (!scope.found) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  // Pre-existing rows for this scope so we can detect new-vs-merge and union
  // aliases. Keyed by slug.
  const { data: existing } = await service
    .from('entity_catalog')
    .select('slug, canonical, category, aliases, sample_count, source, hidden')
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
  const existingBySlug = new Map<string, { canonical: string; category: string; aliases: string[]; sample_count: number; source: string; hidden: boolean }>()
  for (const e of (existing || []) as ExistingCatalogRow[]) {
    existingBySlug.set(e.slug, {
      canonical: e.canonical, category: e.category,
      aliases: e.aliases || [], sample_count: e.sample_count || 0,
      source: e.source || 'discovered', hidden: !!e.hidden,
    })
  }

  const nowIso = new Date().toISOString()
  const upsertRows: Array<{
    scope_type: 'dataset' | 'collection'
    scope_id: string
    canonical: string
    slug: string
    category: string
    aliases: string[]
    sample_count: number
    source: 'manual'
    hidden: boolean
    last_seen_at: string
  }> = []
  const errors: Array<{ index: number; error: string }> = []
  let entitiesNew = 0
  let entitiesMerged = 0
  const seenSlugs = new Set<string>()

  for (let i = 0; i < incoming.length; i++) {
    const raw = incoming[i] || {}
    const canonical = typeof raw.canonical === 'string' ? raw.canonical.trim() : ''
    if (canonical.length < 2) {
      errors.push({ index: i, error: 'canonical missing or too short' })
      continue
    }
    const slug = slugify(canonical)
    if (!slug) {
      errors.push({ index: i, error: 'canonical produces empty slug' })
      continue
    }
    if (seenSlugs.has(slug)) {
      errors.push({ index: i, error: `duplicate slug "${slug}" in request` })
      continue
    }
    seenSlugs.add(slug)
    const categoryRaw = typeof raw.category === 'string' ? raw.category.trim().toLowerCase() : ''
    const category = CATEGORIES.includes(categoryRaw) ? categoryRaw : 'other'
    const aliasInput = normaliseAliases(raw.aliases)

    const prev = existingBySlug.get(slug)
    if (prev) {
      entitiesMerged += 1
    } else {
      entitiesNew += 1
    }

    const aliasUnion = Array.from(new Set([
      ...(prev?.aliases || []),
      ...aliasInput,
    ])).slice(0, MAX_ALIASES_PER_ENTITY)

    upsertRows.push({
      scope_type:   scope.scopeType,
      scope_id:     scope.scopeId,
      canonical:    prev?.canonical || canonical,
      slug,
      category:     prev?.category && prev.category !== 'other' ? prev.category : category,
      aliases:      aliasUnion,
      sample_count: prev?.sample_count || 1,
      source:       'manual',
      hidden:       false,
      last_seen_at: nowIso,
    })
  }

  if (upsertRows.length === 0) {
    return NextResponse.json({ error: 'No valid entities in request', errors }, { status: 400 })
  }

  // Chunked upsert to keep payload bounded; 200 matches lib/entityDiscovery.ts.
  for (let i = 0; i < upsertRows.length; i += 200) {
    const chunk = upsertRows.slice(i, i + 200)
    const { error } = await service
      .from('entity_catalog')
      .upsert(chunk, { onConflict: 'scope_type,scope_id,slug' })
    if (error) {
      return serverError(error, 'datasets.entities.upsert', { orgId })
    }
  }

  // ── Auto-hide alias-redundant discovered rows ────────────────────────────
  // The catalog's UNIQUE key is (scope, slug), but slugs come straight from
  // the canonical, so a discovered "Filet" (slug `filet`) and a manual
  // "Filet Mignon" (slug `filet_mignon`) coexist even though "filet" is in
  // the manual entity's aliases. Without this pass the cloud / compare /
  // pill list shows both, which reads as a dedup bug to users.
  //
  // Rule: for each manual row we just upserted, slugify every alias and hide
  // any discovered (source='discovered', hidden=false) row whose slug matches
  // an alias-slug *in the same category*. Soft-delete so re-discovery doesn't
  // resurface it; same-category guard so a food entity never hides a brand or
  // place entity that happens to share a name.
  const slugsToHideByCategory: Record<string, Set<string>> = {}
  for (const row of upsertRows) {
    const sluggedAliases = new Set<string>()
    for (const alias of row.aliases) {
      const s = slugify(alias)
      if (s && s !== row.slug) sluggedAliases.add(s)
    }
    if (sluggedAliases.size === 0) continue
    if (!slugsToHideByCategory[row.category]) slugsToHideByCategory[row.category] = new Set<string>()
    sluggedAliases.forEach(function(s) { slugsToHideByCategory[row.category].add(s) })
  }
  let entitiesAutoHidden = 0
  for (const category of Object.keys(slugsToHideByCategory)) {
    const slugs = Array.from(slugsToHideByCategory[category])
    if (slugs.length === 0) continue
    const { data: hidden } = await service
      .from('entity_catalog')
      .update({ hidden: true, last_seen_at: nowIso })
      .eq('scope_type', scope.scopeType)
      .eq('scope_id', scope.scopeId)
      .eq('source', 'discovered')
      .eq('category', category)
      .eq('hidden', false)
      .in('slug', slugs)
      .select('slug')
    entitiesAutoHidden += (hidden || []).length
  }

  // Append-only audit log entry so the Schema panel can show "Last updated"
  // covering manual edits as well as discovery runs.
  await service.from('entity_catalog_refresh').insert({
    scope_type:           scope.scopeType,
    scope_id:             scope.scopeId,
    triggered_by:         'manual',
    triggered_by_user:    userId,
    sample_size:          upsertRows.length,
    datasets_sampled:     scope.memberDatasetIds,
    entities_before:      existingBySlug.size,
    entities_after:       existingBySlug.size + entitiesNew,
    entities_new:         entitiesNew,
    haiku_cost_est_cents: 0,
    duration_ms:          0,
    error:                errors.length > 0
      ? `${errors.length} of ${incoming.length} entries rejected${entitiesAutoHidden > 0 ? `; ${entitiesAutoHidden} alias-redundant discovered rows auto-hidden` : ''}`
      : (entitiesAutoHidden > 0 ? `${entitiesAutoHidden} alias-redundant discovered rows auto-hidden` : null),
  })

  return NextResponse.json({
    accepted:               upsertRows.length,
    entities_new:           entitiesNew,
    entities_merged:        entitiesMerged,
    entities_auto_hidden:   entitiesAutoHidden,
    rejected:               errors,
    scope_type:             scope.scopeType,
  })
}
