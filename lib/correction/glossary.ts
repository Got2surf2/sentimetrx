// lib/correction/glossary.ts
//
// Product-agnostic brand-glossary resolver — the shared canonicalization source
// every product (Town Hall, agent reports / What We Heard, surveys) draws on.
// Generalizes lib/recordings/brandGlossary.fetchBrandEntities: reads the curated
// entity_catalog across the relevant scopes (brand collection ∪ bot ∪ dataset),
// unions by slug, and returns a neutral {canonical, aliases} list usable by both
// the deterministic normalizer (lib/correction/normalize) and the AI polish pass.
//
// Best-effort throughout — never throws; returns [] on any failure so correction
// degrades to "no glossary" rather than breaking a report.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { slugify } from '@/lib/entityFilter'
import type { GlossaryEntry } from '@/lib/correction/normalize'
import { hasAuthoritativeSource, type Provenance } from '@/lib/correction/provenance'
import { logError } from '@/lib/log'

interface CatalogRow { canonical: string; category: string | null; aliases: string[] | null; source?: string | null; provenance?: Provenance | null }

function rowToEntry(r: CatalogRow): GlossaryEntry {
  const seen = new Set<string>()
  const aliases: string[] = []
  for (const v of (r.aliases ?? [])) {
    const s = String(v ?? '').trim()
    if (!s || s.toLowerCase() === r.canonical.toLowerCase() || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    aliases.push(s)
  }
  return { canonical: r.canonical, aliases, category: r.category ?? undefined, authoritative: hasAuthoritativeSource(r.source, r.provenance) }
}

function unionInto(map: Map<string, GlossaryEntry>, entries: GlossaryEntry[]) {
  for (const e of entries) {
    const k = slugify(e.canonical)
    if (!k) continue
    const existing = map.get(k)
    // First scope to define a slug wins canonical + category; later scopes only
    // union aliases. Authoritative-ness is OR'd across every contributing scope.
    if (!existing) { map.set(k, { canonical: e.canonical, aliases: [...(e.aliases ?? [])], category: e.category, authoritative: e.authoritative }); continue }
    if (e.authoritative) existing.authoritative = true
    const seen = new Set((existing.aliases ?? []).map(v => v.toLowerCase()))
    for (const v of (e.aliases ?? [])) {
      if (!seen.has(v.toLowerCase())) { existing.aliases!.push(v); seen.add(v.toLowerCase()) }
    }
  }
}

async function readScope(service: SupabaseClient, scopeType: 'collection' | 'bot' | 'dataset', scopeId: string): Promise<GlossaryEntry[]> {
  const { data, error: scopeErr } = await service
    .from('entity_catalog')
    .select('canonical, category, aliases, source, provenance')
    .eq('scope_type', scopeType).eq('scope_id', scopeId).eq('hidden', false)
  if (scopeErr) void logError('glossary.readScope', scopeErr)
  return ((data ?? []) as CatalogRow[]).map(rowToEntry)
}

// Resolve a brand glossary by unioning every scope the caller provides:
//   - brandTag / collectionId → the brand collection's catalog
//   - agentId                 → the bot's catalog (bot entities aren't collection members)
//   - datasetId               → the dataset's own catalog
export async function resolveBrandGlossary(
  service: SupabaseClient,
  opts: { orgId: string; brandTag?: string | null; collectionId?: string | null; agentId?: string | null; datasetId?: string | null; authoritativeOnly?: boolean },
): Promise<GlossaryEntry[]> {
  const bySlug = new Map<string, GlossaryEntry>()
  try {
    // brand collection — by explicit id, else resolved from brand_tag (same slug
    // the sql/062 trigger uses).
    let collectionId = (opts.collectionId ?? '').trim() || null
    if (!collectionId && (opts.brandTag ?? '').trim()) {
      const slug = slugify(opts.brandTag!)
      if (slug) {
        const { data: col, error: colErr } = await service
          .from('collections').select('id')
          .eq('org_id', opts.orgId).eq('kind', 'brand').eq('slug', slug)
          .maybeSingle()
        if (colErr) void logError('glossary.resolveBrandGlossary', colErr, { orgId: opts.orgId })
        collectionId = (col as { id: string } | null)?.id ?? null
      }
    }
    if (collectionId) unionInto(bySlug, await readScope(service, 'collection', collectionId))

    if (opts.agentId) {
      // Verify the agent is in the caller's org before reading its catalog.
      const { data: bot, error: botErr } = await service.from('agents').select('id, org_id').eq('id', opts.agentId).maybeSingle()
      if (botErr) void logError('glossary.resolveBrandGlossary', botErr, { orgId: opts.orgId })
      if (bot && (bot as { id: string; org_id: string }).org_id === opts.orgId) unionInto(bySlug, await readScope(service, 'bot', opts.agentId))
    }

    if (opts.datasetId) unionInto(bySlug, await readScope(service, 'dataset', opts.datasetId))
  } catch {
    /* best-effort — return whatever resolved */
  }
  const entries = [...bySlug.values()]
  // For CORRECTION (normalize/polish), keep only canonicals backed by an OFFICIAL
  // record or a human — never "correct" text toward a UGC-invented canonical.
  return opts.authoritativeOnly ? entries.filter(e => e.authoritative) : entries
}

// Convenience: just the canonical strings (what the AI polish prompt wants).
export function glossaryTerms(entries: GlossaryEntry[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of entries) {
    const c = (e.canonical ?? '').trim()
    if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c) }
  }
  return out
}
