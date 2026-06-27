// lib/recordings/brandGlossary.ts
//
// Brand-entity convergence (docs/RECORDINGS.md §3.5c). Pulls a brand's curated
// entity catalog so a Town Hall meeting's spelling-correction draws on it:
//   - the brand collection's entity_catalog (collection scope), resolved from the
//     recording's brand_tag (same slug the sql/062 trigger uses), and
//   - the linked agent's bot-scope entity_catalog (bot entities aren't collection
//     members, so they're unioned in here at read time).
// These known canonicals feed the extraction prompt (so ASR phonetic variants
// cluster under the right spelling) and are merged into the resulting entity_map
// (so brand names not mentioned are still seeded + the corrected-transcript view
// has their aliases). Best-effort throughout — seeding never blocks the pipeline.
//
// The cross-scope catalog read + union now lives in the shared brand-correction
// layer (lib/correction/glossary.resolveBrandGlossary); this module projects the
// neutral {canonical, aliases, category} result onto the Town Hall EntityMapEntry
// shape (typed + canonical-in-variants) the meeting pipeline expects.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { slugify } from '@/lib/entityFilter'
import { resolveBrandGlossary } from '@/lib/correction/glossary'
import type { EntityMapEntry, EntityType } from '@/lib/recordings/types'

// entity_catalog.category (dataset: food/drink/place/person/brand/other; bot:
// person/place/organization/product/program/event/policy/other) → the recording
// EntityType set (person/place/org/project/term).
function categoryToType(cat: string): EntityType {
  switch ((cat || '').toLowerCase()) {
    case 'person': return 'person'
    case 'place': return 'place'
    case 'organization':
    case 'org':
    case 'brand': return 'org'
    case 'product':
    case 'program':
    case 'policy':
    case 'event':
    case 'project': return 'project'
    default: return 'term'
  }
}

// Read-only fetch of a brand's curated entities (collection ∪ linked-agent bot
// scope), projected onto the Town Hall EntityMapEntry shape. The cross-scope
// catalog read + slug-union is the shared resolver; here we just map each neutral
// {canonical, aliases, category} entry to a typed entry (category→EntityType,
// canonical folded into `variants`, mentions seeded at 1). Never throws.
export async function fetchBrandEntities(
  service: SupabaseClient,
  opts: { orgId: string; brandTag?: string | null; agentId?: string | null },
): Promise<EntityMapEntry[]> {
  const entries = await resolveBrandGlossary(service, {
    orgId: opts.orgId,
    brandTag: opts.brandTag,
    agentId: opts.agentId,
    // Only seed/correct toward canonicals from an OFFICIAL record or a human —
    // never a UGC-invented name (provenance authority, owner requirement).
    authoritativeOnly: true,
  })
  return entries.map(e => {
    const seen = new Set<string>()
    const variants: string[] = []
    for (const v of [e.canonical, ...(e.aliases ?? [])]) {
      const s = String(v ?? '').trim()
      if (!s || seen.has(s.toLowerCase())) continue
      seen.add(s.toLowerCase())
      variants.push(s)
    }
    return { canonical: e.canonical, variants, type: categoryToType(e.category ?? ''), mentions: 1 }
  })
}

// Merge brand-catalog entries into the meeting's extracted map. Brand canonicals
// are authoritative (canonical + type win on a slug match); the meeting's
// variants are unioned in, and meeting-only entities are kept. Brand entities
// not mentioned in the meeting are still included so the reviewer sees the full
// known set and the corrected-transcript view has every alias.
export function mergeBrandEntities(
  extracted: EntityMapEntry[],
  brand: EntityMapEntry[],
): EntityMapEntry[] {
  const bySlug = new Map<string, EntityMapEntry>()
  for (const b of brand) {
    const k = slugify(b.canonical)
    if (k) bySlug.set(k, { ...b, variants: [...b.variants] })
  }
  for (const e of extracted) {
    const k = slugify(e.canonical)
    if (!k) continue
    const existing = bySlug.get(k)
    if (!existing) { bySlug.set(k, { ...e, variants: [...e.variants] }); continue }
    const seen = new Set(existing.variants.map(v => v.toLowerCase()))
    for (const v of e.variants) {
      if (!seen.has(v.toLowerCase())) { existing.variants.push(v); seen.add(v.toLowerCase()) }
    }
    existing.mentions = Math.max(existing.mentions, e.mentions)
  }
  return [...bySlug.values()].sort((a, b) => b.mentions - a.mentions)
}
