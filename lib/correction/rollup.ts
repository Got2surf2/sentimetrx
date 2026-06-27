// lib/correction/rollup.ts
//
// Shared brand-correction layer, Phase 3: roll an agent's curated entity
// catalog (entity_catalog, scope_type='bot') up into its brand collection's
// shared catalog (scope_type='collection'). This is what makes the brand
// glossary AUTHORITATIVE — once an agent (e.g. Sarina) is brand-tagged, her
// reviewed entity spellings become the brand's, so Town Hall spelling
// correction, the What We Heard readout, and (later) survey correction all draw
// on one curated source instead of re-inferring names per product.
//
// Direction is bot→brand and ADDITIVE (a brand catalog is a UNION across many
// sources — datasets, multiple agents, hand-curation): the rollup never deletes
// brand rows and never overwrites a brand row that's been hand-curated
// (source='manual') or hidden. It mirrors the discovery upsert contract in
// lib/entityDiscovery.ts (first canonical/category wins, aliases union,
// sample_count accumulates, skip manual/hidden brand rows).
//
// Best-effort throughout — a rollup failure must never break the entity
// extract/curate action that triggered it.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { slugify } from '@/lib/entityFilter'

const MAX_ALIASES = 50

export interface CatalogEntity {
  canonical: string
  slug: string
  category: string
  aliases: string[]
  sample_count: number
  source: string
  hidden: boolean
}

export interface BrandUpsertRow {
  scope_type: 'collection'
  scope_id: string
  canonical: string
  slug: string
  category: string
  aliases: string[]
  sample_count: number
  source: 'discovered'
  hidden: false
  last_seen_at: string
}

// Pure merge: given the brand collection's existing rows and the agent's
// (already-visible) bot rows, produce the upsert payload. First canonical /
// category wins (no flapping on re-roll); aliases union (incl. the bot canonical
// folded in as a brand alias when it differs); sample_count accumulates. A brand
// row that's source='manual' or hidden is left untouched (skipped).
export function mergeBotEntitiesIntoBrand(
  scopeId: string,
  brandRows: CatalogEntity[],
  botRows: CatalogEntity[],
  nowIso: string,
): BrandUpsertRow[] {
  const brandBySlug = new Map<string, CatalogEntity>()
  for (const r of brandRows) brandBySlug.set(r.slug, r)

  const out: BrandUpsertRow[] = []
  for (const bot of botRows) {
    const slug = bot.slug || slugify(bot.canonical)
    if (!slug) continue
    const prev = brandBySlug.get(slug)
    // Never trample hand-curated or soft-deleted brand entries.
    if (prev && (prev.source === 'manual' || prev.hidden)) continue
    const aliasUnion = Array.from(new Set([
      ...(prev?.aliases ?? []),
      ...bot.aliases,
      // fold the bot's canonical in as a brand alias when the brand keeps a
      // different canonical surface form
      bot.canonical,
    ])).filter(a => a && a.toLowerCase() !== (prev?.canonical ?? bot.canonical).toLowerCase())
      .slice(0, MAX_ALIASES)
    out.push({
      scope_type: 'collection',
      scope_id: scopeId,
      canonical: prev?.canonical || bot.canonical,
      slug,
      category: prev?.category || bot.category,
      aliases: aliasUnion,
      sample_count: (prev?.sample_count ?? 0) + bot.sample_count,
      source: 'discovered',
      hidden: false,
      last_seen_at: nowIso,
    })
  }
  return out
}

export interface RollupResult {
  collectionId: string
  pushed: number
}

// Resolve the agent's brand collection (find-or-create, same as the dataset
// trigger), read its existing catalog + the agent's visible bot entities, merge,
// and upsert. Returns null when the agent has no brand_tag (nothing to do) or the
// tag doesn't resolve. Never throws — logs and returns null on any failure.
//
// Caller must have already verified (agentId, orgId) belong together.
export async function rollupAgentEntitiesToBrand(
  service: SupabaseClient,
  opts: { agentId: string; orgId: string; brandTag?: string | null; createdBy?: string | null },
): Promise<RollupResult | null> {
  try {
    let brandTag = (opts.brandTag ?? '').trim()
    let createdBy = opts.createdBy ?? null
    if (!opts.brandTag || createdBy === undefined) {
      const { data: agent } = await service
        .from('agents').select('brand_tag, created_by, org_id')
        .eq('id', opts.agentId).eq('org_id', opts.orgId).maybeSingle()
      if (!agent) return null
      if (!opts.brandTag) brandTag = String((agent as any).brand_tag ?? '').trim()
      createdBy = (agent as any).created_by ?? null
    }
    if (!brandTag) return null

    // Resolve (find-or-create) the brand collection — same slugify find-or-create
    // the sql/062 dataset trigger uses, so an agent and a dataset tagged with the
    // same brand land in ONE collection.
    const { data: collectionId, error: rpcErr } = await service
      .rpc('find_or_create_brand_collection', { p_org_id: opts.orgId, p_brand_tag: brandTag, p_created_by: createdBy })
    if (rpcErr || !collectionId) return null

    // The agent's VISIBLE curated entities (hidden ones are deliberately not
    // promoted — the admin said "don't surface this").
    const { data: botRows } = await service
      .from('entity_catalog')
      .select('canonical, slug, category, aliases, sample_count, source, hidden')
      .eq('scope_type', 'bot').eq('scope_id', opts.agentId).eq('hidden', false)
    const bot = (botRows ?? []) as CatalogEntity[]
    if (bot.length === 0) return { collectionId: collectionId as string, pushed: 0 }

    const { data: brandRows } = await service
      .from('entity_catalog')
      .select('canonical, slug, category, aliases, sample_count, source, hidden')
      .eq('scope_type', 'collection').eq('scope_id', collectionId as string)
    const brand = (brandRows ?? []) as CatalogEntity[]

    const nowIso = new Date().toISOString()
    const upsertRows = mergeBotEntitiesIntoBrand(collectionId as string, brand, bot, nowIso)
    let pushed = 0
    for (let i = 0; i < upsertRows.length; i += 200) {
      const chunk = upsertRows.slice(i, i + 200)
      const { error } = await service
        .from('entity_catalog')
        .upsert(chunk, { onConflict: 'scope_type,scope_id,slug' })
      if (error) return { collectionId: collectionId as string, pushed }
      pushed += chunk.length
    }
    return { collectionId: collectionId as string, pushed }
  } catch {
    return null
  }
}
