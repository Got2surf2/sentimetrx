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

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { slugify } from '@/lib/entityFilter'
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

interface CatalogRow { canonical: string; category: string; aliases: string[] | null }

function rowToEntry(r: CatalogRow): EntityMapEntry {
  const seen = new Set<string>()
  const variants: string[] = []
  for (const v of [r.canonical, ...(r.aliases ?? [])]) {
    const s = String(v ?? '').trim()
    if (!s || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    variants.push(s)
  }
  return { canonical: r.canonical, variants, type: categoryToType(r.category), mentions: 1 }
}

function unionInto(map: Map<string, EntityMapEntry>, entries: EntityMapEntry[]) {
  for (const e of entries) {
    const k = slugify(e.canonical)
    if (!k) continue
    const existing = map.get(k)
    if (!existing) { map.set(k, { ...e, variants: [...e.variants] }); continue }
    const seen = new Set(existing.variants.map(v => v.toLowerCase()))
    for (const v of e.variants) {
      if (!seen.has(v.toLowerCase())) { existing.variants.push(v); seen.add(v.toLowerCase()) }
    }
  }
}

// Read-only fetch of a brand's curated entities (collection ∪ linked-agent bot
// scope). Never throws — returns [] on any failure.
export async function fetchBrandEntities(
  service: SupabaseClient,
  opts: { orgId: string; brandTag?: string | null; agentId?: string | null },
): Promise<EntityMapEntry[]> {
  const bySlug = new Map<string, EntityMapEntry>()
  try {
    const tag = (opts.brandTag ?? '').trim()
    if (tag) {
      const slug = slugify(tag)
      if (slug) {
        const { data: col } = await service
          .from('collections').select('id')
          .eq('org_id', opts.orgId).eq('kind', 'brand').eq('slug', slug)
          .maybeSingle()
        if ((col as any)?.id) {
          const { data: rows } = await service
            .from('entity_catalog')
            .select('canonical, category, aliases')
            .eq('scope_type', 'collection').eq('scope_id', (col as any).id).eq('hidden', false)
          unionInto(bySlug, ((rows ?? []) as CatalogRow[]).map(rowToEntry))
        }
      }
    }

    if (opts.agentId) {
      // Verify the agent is in the caller's org before reading its catalog.
      const { data: bot } = await service
        .from('agents').select('id, org_id').eq('id', opts.agentId).maybeSingle()
      if (bot && (bot as any).org_id === opts.orgId) {
        const { data: rows } = await service
          .from('entity_catalog')
          .select('canonical, category, aliases')
          .eq('scope_type', 'bot').eq('scope_id', opts.agentId).eq('hidden', false)
        unionInto(bySlug, ((rows ?? []) as CatalogRow[]).map(rowToEntry))
      }
    }
  } catch {
    /* best-effort */
  }
  return [...bySlug.values()]
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
