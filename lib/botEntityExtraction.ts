// lib/botEntityExtraction.ts
//
// Entity-from-KB extractor for agents (docs/BOTS.md § 9.y).
//
// Reads all bot_knowledge_chunks for an agent, asks Haiku to identify named
// entities (one Haiku call per ~5 chunks), aggregates + dedupes by slug, and
// UPSERTs into entity_catalog with scope_type='bot' / scope_id=botId. New
// rows with sample_count=1 land hidden=true (low-confidence noise reduction
// per § 9.y open Q3). Logs one row to entity_catalog_refresh per run.
//
// Trigger: manual only (admin clicks the "Re-extract entities" button on
// /bots/[id]/entities). No auto-trigger on KB chunk insert (§ 9.y open Q1).
//
// Service-role only — every query pairs (id, bot_id, org_id) where the row
// shape has those keys, per CLAUDE.md multi-tenancy invariants.

import 'server-only'
import { callAI } from './ai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { slugify } from './entityFilter'
import { rollupAgentEntitiesToBrand } from './correction/rollup'
import { mergeProvenance, authorityOf, type SourceKind, type Provenance } from './correction/provenance'

// An agent's knowledge base is "extracted text from training URLs/docs" (sql/020)
// — every chunk is an OFFICIAL record. Classify each as a crawled URL vs an
// uploaded document from its ingestion metadata ({source, source_type}); both are
// authoritative-tier, so bot-extracted entities may own a canonical spelling.
export function classifyChunkSource(metadata: unknown): { kind: SourceKind; ref: Record<string, unknown> } {
  const m = (metadata ?? {}) as Record<string, unknown>
  const src = String(m.source ?? '')
  const type = String(m.source_type ?? '').toLowerCase()
  const isUrl = /^https?:\/\//i.test(src) || ['url', 'crawl', 'website', 'link', 'sitemap'].includes(type)
  const kind: SourceKind = isUrl ? 'crawl' : 'document'
  const ref: Record<string, unknown> = {}
  if (src) ref[isUrl ? 'url' : 'source'] = src
  if (type) ref.source_type = type
  return { kind, ref }
}

// 8 categories per § 9.y open Q2.
export const BOT_ENTITY_CATEGORIES = [
  'person',
  'place',
  'organization',
  'product',
  'program',
  'event',
  'policy',
  'other',
] as const
export type BotEntityCategory = (typeof BOT_ENTITY_CATEGORIES)[number]

interface ExtractedEntity {
  canonical: string
  category: BotEntityCategory
}

interface ExtractResult {
  added: number
  total: number
  costCents: number
  durationMs: number
  brandPushed?: number   // entities rolled up into the brand collection (Phase 3); undefined if the agent has no brand_tag
}

// Roughly 5 chunks per call, capped on character budget so we don't blow
// past the model's context window when individual chunks are long.
const CHUNKS_PER_BATCH = 5
const MAX_CHARS_PER_BATCH = 6000

function normalizeCategory(c: unknown): BotEntityCategory {
  const s = String(c || '').toLowerCase().trim()
  return (BOT_ENTITY_CATEGORIES as readonly string[]).includes(s) ? (s as BotEntityCategory) : 'other'
}

function parseEntities(raw: string): ExtractedEntity[] {
  const text = (raw || '').trim()
  if (!text) return []
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  let parsed: any
  try { parsed = JSON.parse(match[0]) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const out: ExtractedEntity[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const canonical = String(item.canonical || '').trim()
    if (!canonical || canonical.length > 80) continue
    out.push({ canonical, category: normalizeCategory(item.category) })
  }
  return out
}

/**
 * Batch chunks into Haiku-sized groups for extraction. Each batch is at most
 * CHUNKS_PER_BATCH chunks and MAX_CHARS_PER_BATCH characters of content.
 * Exported so unit tests can verify boundary behavior without invoking AI.
 */
export function batchChunksForExtraction<T extends { content: string }>(
  chunks: T[],
): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let currentChars = 0
  for (const c of chunks) {
    const len = (c.content || '').length
    if (current.length >= CHUNKS_PER_BATCH || (current.length > 0 && currentChars + len > MAX_CHARS_PER_BATCH)) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(c)
    currentChars += len
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * Aggregate batch outputs into a deduped catalog keyed by slug. Variants
 * with the same slug are merged: canonical preserves the first surface form,
 * aliases[] collects every other surface form, category is voted by count
 * (ties resolved by first-seen). Exported for tests.
 */
export function aggregateExtractedEntities(
  batches: ExtractedEntity[][],
): Map<string, { canonical: string; category: BotEntityCategory; aliases: string[]; count: number }> {
  const out = new Map<string, { canonical: string; category: BotEntityCategory; aliases: string[]; count: number; categoryVotes: Map<BotEntityCategory, number> }>()
  for (const batch of batches) {
    for (const e of batch) {
      const slug = slugify(e.canonical)
      if (!slug) continue
      const existing = out.get(slug)
      if (!existing) {
        const votes = new Map<BotEntityCategory, number>()
        votes.set(e.category, 1)
        out.set(slug, { canonical: e.canonical, category: e.category, aliases: [], count: 1, categoryVotes: votes })
      } else {
        existing.count += 1
        existing.categoryVotes.set(e.category, (existing.categoryVotes.get(e.category) || 0) + 1)
        const lc = e.canonical.toLowerCase()
        const known = lc === existing.canonical.toLowerCase() || existing.aliases.some(a => a.toLowerCase() === lc)
        if (!known) existing.aliases.push(e.canonical)
      }
    }
  }
  // Resolve category votes to a final value (max count, first-seen tiebreak)
  const final = new Map<string, { canonical: string; category: BotEntityCategory; aliases: string[]; count: number }>()
  out.forEach((v, k) => {
    let best: BotEntityCategory = v.category
    let bestCount = -1
    v.categoryVotes.forEach((count, cat) => {
      if (count > bestCount) { best = cat; bestCount = count }
    })
    final.set(k, { canonical: v.canonical, category: best, aliases: v.aliases, count: v.count })
  })
  return final
}

const SYSTEM_PROMPT =
  'You are a named-entity extractor for an AI agent\'s knowledge base. ' +
  'Given excerpts from the knowledge base, return ONLY a JSON array of named entities mentioned. ' +
  'Each item: { "canonical": string, "category": "person"|"place"|"organization"|"product"|"program"|"event"|"policy"|"other" }.\n\n' +
  'Rules:\n' +
  '- Include proper nouns: people, places, organizations, products, programs, events, policies/ordinances.\n' +
  '- Skip common nouns (generic role words like "the team", "the airport", "our staff"), pronouns, generic descriptors.\n' +
  '- Skip dates, numbers, prices, addresses.\n' +
  '- Canonical = the entity\'s most common surface form in the text. Keep proper capitalization.\n' +
  '- Pick the BEST category for each. Use "policy" for ordinances, master plans, formal proposals, regulations. Use "other" only when none of the seven specific categories fit.\n' +
  '- Return at most 40 entities per batch. If unsure, omit.\n' +
  '- Respond with ONLY the JSON array. No prose, no markdown fences.'

async function extractFromBatch(
  batch: Array<{ title: string | null; content: string }>,
  usageCtx: { orgId: string; botId: string },
): Promise<{ entities: ExtractedEntity[]; costCents: number }> {
  const body = batch
    .map((c, i) => `--- chunk ${i + 1}${c.title ? ` (title: ${c.title})` : ''} ---\n${(c.content || '').slice(0, 1500)}`)
    .join('\n\n')

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 1500,
      timeoutMs: 25000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: body }],
      usage: { org_id: usageCtx.orgId, resource_type: 'bot', resource_id: usageCtx.botId, event_type: 'entity_extract' },
    })
    const entities = parseEntities(result.text || '')
    // Rough cost estimate for the audit log: Haiku input ≈ $0.0008 / 1k tokens,
    // output ≈ $0.004 / 1k tokens. Convert to cents (× 100).
    const u = result.usage
    const inputTokens = u?.input_tokens || 0
    const outputTokens = u?.output_tokens || 0
    const cacheReadTokens = u?.cache_read_tokens || 0
    // Cache-read is much cheaper but we don't have a separate rate here; collapse.
    const dollars = (inputTokens + cacheReadTokens * 0.1) * 0.0000008 + outputTokens * 0.000004
    return { entities, costCents: Math.round(dollars * 100) }
  } catch {
    return { entities: [], costCents: 0 }
  }
}

/**
 * Extract entities from a bot's KB and UPSERT them into entity_catalog
 * under scope_type='bot' / scope_id=botId. Writes one entity_catalog_refresh
 * audit row at the end with the run summary.
 *
 * The caller is responsible for the multi-tenancy gate: botId + orgId must
 * already be verified to belong together before calling (see the
 * /api/bots/[id]/entities/extract route).
 */
export async function extractBotEntities(
  service: SupabaseClient,
  opts: {
    botId: string
    orgId: string
    triggeredByUser?: string | null
  },
): Promise<ExtractResult> {
  const startedAt = Date.now()

  // Snapshot the "before" count so the audit row reflects net new entities.
  const { count: entitiesBefore } = await service
    .from('entity_catalog')
    .select('id', { count: 'exact', head: true })
    .eq('scope_type', 'bot')
    .eq('scope_id', opts.botId)

  // Pull every chunk for this bot. Service role bypasses RLS; the caller's
  // org gate is the protection.
  const { data: chunkRows } = await service
    .from('bot_knowledge_chunks')
    .select('title, content, metadata')
    .eq('bot_id', opts.botId)

  const chunks = (chunkRows || [])
    .filter(c => typeof c.content === 'string' && c.content.trim().length > 0)
    .map(c => ({ title: c.title as string | null, content: c.content as string, ...classifyChunkSource((c as any).metadata) }))
  const batches = batchChunksForExtraction(chunks)

  let totalCostCents = 0
  const batchResults: ExtractedEntity[][] = []
  // Provenance accumulator: which authoritative KB source(s) each slug came from.
  // Attributed at batch granularity (the entity came from one of the batch's
  // chunks); the owning `source` is the highest-authority kind seen for the slug.
  const slugProvenance = new Map<string, Provenance>()
  const slugOwner = new Map<string, SourceKind>()
  for (const batch of batches) {
    const { entities, costCents } = await extractFromBatch(batch, { orgId: opts.orgId, botId: opts.botId })
    batchResults.push(entities)
    totalCostCents += costCents
    // Distinct authoritative sources present in this batch.
    const batchSources = new Map<string, { kind: SourceKind; ref: Record<string, unknown> }>()
    for (const c of batch) batchSources.set(JSON.stringify([c.kind, c.ref]), { kind: c.kind, ref: c.ref })
    for (const e of entities) {
      const slug = slugify(e.canonical)
      if (!slug) continue
      for (const { kind, ref } of batchSources.values()) {
        slugProvenance.set(slug, mergeProvenance(slugProvenance.get(slug), kind, ref, 1))
        const owner = slugOwner.get(slug)
        if (!owner || authorityOf(kind) > authorityOf(owner)) slugOwner.set(slug, kind)
      }
    }
  }

  const aggregated = aggregateExtractedEntities(batchResults)

  // Pull existing rows for this bot to determine which slugs are net new vs
  // an alias/count refresh. One round-trip rather than per-row reads.
  const { data: existingRows } = await service
    .from('entity_catalog')
    .select('id, slug, sample_count, aliases, source, hidden, provenance')
    .eq('scope_type', 'bot')
    .eq('scope_id', opts.botId)
  const existingBySlug = new Map<string, { id: string; sample_count: number; aliases: string[]; source: string; hidden: boolean; provenance: Provenance }>(
    (existingRows || []).map(r => [r.slug as string, {
      id: r.id as string,
      sample_count: (r.sample_count as number) || 0,
      aliases: Array.isArray(r.aliases) ? r.aliases as string[] : [],
      source: (r.source as string) || 'discovered',
      hidden: !!r.hidden,
      provenance: ((r as any).provenance ?? {}) as Provenance,
    }]),
  )

  let added = 0
  const nowIso = new Date().toISOString()
  const aggregatedEntries: Array<[string, { canonical: string; category: BotEntityCategory; aliases: string[]; count: number }]> = []
  aggregated.forEach((v, k) => { aggregatedEntries.push([k, v]) })
  for (const [slug, entity] of aggregatedEntries) {
    const existing = existingBySlug.get(slug)
    // Provenance for this slug (which authoritative KB sources it came from). KB
    // is always an official record, so the owning source is authoritative-tier
    // ('document'/'crawl') — these entities may own a brand canonical.
    const prov = slugProvenance.get(slug) ?? {}
    const owner = (slugOwner.get(slug) ?? 'document') as SourceKind
    if (!existing) {
      // New row. sample_count starts at the discovery count; hidden=true if
      // the entity surfaced only once (§ 9.y open Q3 — low-confidence noise).
      await service.from('entity_catalog').insert({
        scope_type: 'bot',
        scope_id: opts.botId,
        canonical: entity.canonical,
        slug,
        category: entity.category,
        aliases: entity.aliases,
        sample_count: entity.count,
        source: owner,
        provenance: prov,
        hidden: entity.count <= 1,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      })
      added += 1
    } else {
      // Existing row: bump sample_count, merge aliases. Never flip hidden
      // (admin's explicit choice wins). Don't overwrite canonical for
      // manual rows (user-curated).
      const mergedAliases = Array.from(new Set([
        ...existing.aliases,
        ...entity.aliases,
        // Also fold the new canonical in as an alias if it differs from
        // whatever's already in the row (we don't change canonical here).
        entity.canonical,
      ])).filter(a => a && a.toLowerCase() !== entity.canonical.toLowerCase())
      // Merge provenance; upgrade the owning source only if the new KB source
      // outranks it (e.g. a row first seen as 'discovered' becomes 'document').
      // Never downgrade a 'manual' row.
      let mergedProv = existing.provenance
      for (const [k, v] of Object.entries(prov)) {
        mergedProv = mergeProvenance(mergedProv, k as SourceKind, null, v.count)   // bump count once
        for (const ref of v.refs) mergedProv = mergeProvenance(mergedProv, k as SourceKind, ref, 0)  // add refs
      }
      const nextSource = authorityOf(owner) > authorityOf(existing.source) ? owner : (existing.source as SourceKind)
      await service
        .from('entity_catalog')
        .update({
          sample_count: existing.sample_count + entity.count,
          aliases: mergedAliases,
          source: nextSource,
          provenance: mergedProv,
          last_seen_at: nowIso,
        })
        .eq('id', existing.id)
    }
  }

  // Audit log entry. triggered_by='manual' for all bot extracts (§ 9.y Q1).
  const durationMs = Date.now() - startedAt
  const entitiesAfter = (entitiesBefore || 0) + added
  await service.from('entity_catalog_refresh').insert({
    scope_type: 'bot',
    scope_id: opts.botId,
    triggered_by: 'manual',
    triggered_by_user: opts.triggeredByUser || null,
    sample_size: chunks.length,
    entities_before: entitiesBefore || 0,
    entities_after: entitiesAfter,
    entities_new: added,
    haiku_cost_est_cents: totalCostCents,
    duration_ms: durationMs,
  })

  // Phase 3 (shared brand-correction layer): if this agent is brand-tagged, roll
  // its curated entities up into the brand collection's shared catalog so the
  // brand glossary is authoritative across products. Best-effort — never fails
  // the extract.
  const rollup = await rollupAgentEntitiesToBrand(service, { agentId: opts.botId, orgId: opts.orgId })

  return {
    added,
    total: entitiesAfter,
    costCents: totalCostCents,
    durationMs,
    brandPushed: rollup?.pushed,
  }
}
