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
import { chooseCanonical, mergeProvenance, type SourceKind, type Provenance } from '@/lib/correction/provenance'
import { logError } from '@/lib/log'

const MAX_ALIASES = 50

export interface CatalogEntity {
  canonical: string
  slug: string
  category: string
  aliases: string[]
  sample_count: number
  source: string
  hidden: boolean
  provenance?: Provenance
}

export interface BrandUpsertRow {
  scope_type: 'collection'
  scope_id: string
  canonical: string
  slug: string
  category: string
  aliases: string[]
  sample_count: number
  source: SourceKind
  provenance: Provenance
  hidden: false
  last_seen_at: string
}

// Pure merge: given the brand collection's existing rows and the agent's
// (already-visible) bot rows, produce the upsert payload. Authority-aware:
//   - canonical is chosen by source authority (chooseCanonical) — an authoritative
//     bot entity (KB = document/crawl) may CORRECT a brand canonical that a
//     low-authority source (e.g. review-text discovery) had set, but cannot
//     override an equal/higher-authority brand canonical.
//   - aliases union (incl. the loser surface folded in); sample_count accumulates;
//     provenance trails merge.
//   - a brand row that's source='manual' or hidden is left untouched (skipped).
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

    const botKind = (bot.source || 'document') as SourceKind
    const { canonical, source } = chooseCanonical(
      prev ? { canonical: prev.canonical, source: prev.source as SourceKind } : null,
      { canonical: bot.canonical, kind: botKind },
    )
    // Everything that isn't the chosen canonical becomes an alias.
    const aliasUnion = Array.from(new Set([
      ...(prev?.aliases ?? []),
      ...bot.aliases,
      prev?.canonical ?? '',
      bot.canonical,
    ])).filter(a => a && a.toLowerCase() !== canonical.toLowerCase())
      .slice(0, MAX_ALIASES)

    // Merge the bot entity's provenance trail into the brand's.
    let provenance: Provenance = { ...(prev?.provenance ?? {}) }
    for (const [k, v] of Object.entries(bot.provenance ?? {})) {
      provenance = mergeProvenance(provenance, k as SourceKind, null, v.count)
      for (const ref of v.refs) provenance = mergeProvenance(provenance, k as SourceKind, ref, 0)
    }

    out.push({
      scope_type: 'collection',
      scope_id: scopeId,
      canonical,
      slug,
      category: prev?.category || bot.category,
      aliases: aliasUnion,
      sample_count: (prev?.sample_count ?? 0) + bot.sample_count,
      source,
      provenance,
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
      const { data: agent, error: agentErr } = await service
        .from('agents').select('brand_tag, created_by, org_id')
        .eq('id', opts.agentId).eq('org_id', opts.orgId).maybeSingle()
      if (agentErr) void logError('rollup.rollupAgentEntitiesToBrand', agentErr, { orgId: opts.orgId })
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
    if (rpcErr) void logError('rollup.rollupAgentEntitiesToBrand', rpcErr, { orgId: opts.orgId })
    if (rpcErr || !collectionId) return null

    // The agent's VISIBLE curated entities (hidden ones are deliberately not
    // promoted — the admin said "don't surface this").
    const { data: botRows, error: botRowsErr } = await service
      .from('entity_catalog')
      .select('canonical, slug, category, aliases, sample_count, source, hidden, provenance')
      .eq('scope_type', 'bot').eq('scope_id', opts.agentId).eq('hidden', false)
    if (botRowsErr) void logError('rollup.rollupAgentEntitiesToBrand', botRowsErr, { orgId: opts.orgId })
    const bot = (botRows ?? []) as CatalogEntity[]
    if (bot.length === 0) return { collectionId: collectionId as string, pushed: 0 }

    const { data: brandRows, error: brandRowsErr } = await service
      .from('entity_catalog')
      .select('canonical, slug, category, aliases, sample_count, source, hidden, provenance')
      .eq('scope_type', 'collection').eq('scope_id', collectionId as string)
    if (brandRowsErr) void logError('rollup.rollupAgentEntitiesToBrand', brandRowsErr, { orgId: opts.orgId })
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
