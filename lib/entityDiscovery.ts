import 'server-only'

// lib/entityDiscovery.ts
//
// Write side of the entity rebuild. Discovers named entities for a scope by
// running a small Haiku NER sample over the scope's rows, then upserts a flat
// canonical catalog into entity_catalog and logs the run to
// entity_catalog_refresh.
//
// Why a sample, not a full scan: discovery only needs the *list* of entities
// a brand's data talks about — typically 50-200 names. Real counts come later
// and live, from full-text search (lib/entityFilter.ts), so they stay
// accurate regardless of sample size. v1's mistake was per-row NER on
// comma-split fragments, which produced garbage ("attentive", "Great food",
// "service"). The NER prompt below is deliberately strict: only specific
// *named* things — never adjectives, sentiments, or generic nouns.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SchemaConfig } from '@/lib/analyzeTypes'
import { callAI } from '@/lib/ai'
import { resolveEntityScope, slugify, eligibleEntityFields } from '@/lib/entityFilter'

export type DiscoveryMode = 'initial' | 'incremental' | 'manual' | 'cron'

const DEFAULT_SAMPLE_SIZE = 300  // rows sampled across the scope's datasets
const ROWS_PER_BATCH      = 25   // rows per Haiku NER call
const NER_CONCURRENCY     = 4    // batches in flight at once
const MAX_ENTITIES        = 400  // hard cap on discovered entities per run
const MAX_ALIASES         = 25   // per catalog entry
const MAX_CONTEXT_VALUES  = 60   // structured values fed to the NER prompt as "do not extract"

const CATEGORIES = ['food', 'drink', 'place', 'person', 'brand', 'other']

export interface DiscoveryResult {
  scope_type:       'dataset' | 'collection'
  scope_id:         string
  mode:             DiscoveryMode
  sample_size:      number
  datasets_sampled: string[]
  entities_before:  number
  entities_after:   number
  entities_new:     number
  duration_ms:      number
  cost_est_cents:   number
  error:            string | null
}

interface DiscoveredEntity {
  canonical:   string
  category:    string
  aliases:     Set<string>
  sampleCount: number
}

/** What the scope's data is *about* — handed to the NER prompt as a "do not
 *  extract" list. Without it the extractor pulls the subject brand and its
 *  own locations out of review prose and surfaces them as findings. */
interface DiscoveryContext {
  brandNames:       string[]
  structuredValues: string[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Concatenate the values of a row's selected entity-extraction fields into
 *  one text blob for NER. `allowedKeys` restricts which `data` keys are read —
 *  only the schema's chosen open-ended fields, never categorical/location
 *  columns. Skips short / numeric-only values and caps length to bound token
 *  cost. */
function rowText(data: unknown, allowedKeys: Set<string>): string {
  if (!data || typeof data !== 'object' || allowedKeys.size === 0) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!allowedKeys.has(k)) continue
    if (typeof v === 'string' && v.trim().length > 2 && /[a-zA-Z]/.test(v)) {
      parts.push(v.trim())
    }
  }
  return parts.join(' · ').slice(0, 600)
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit)
    const res = await Promise.all(chunk.map(fn))
    out.push(...res)
  }
  return out
}

/** Pull a random-ish sample of row texts across the scope's member datasets,
 *  split evenly per dataset. Each dataset contributes only the values of its
 *  schema-selected open-ended fields (see eligibleEntityFields) — a dataset
 *  with none selected contributes nothing. Non-deterministic on purpose — a
 *  re-run should explore different rows and surface new entities. */
async function sampleRowTexts(
  service: SupabaseClient,
  datasetIds: string[],
  totalSample: number,
): Promise<string[]> {
  if (datasetIds.length === 0) return []
  const perDataset = Math.max(1, Math.floor(totalSample / datasetIds.length))
  const texts: string[] = []

  for (const dsId of datasetIds) {
    const { data: ds } = await service
      .from('datasets').select('row_count').eq('id', dsId).single()
    const rowCount = ((ds as any)?.row_count as number) || 0
    if (rowCount === 0) continue

    // Only this dataset's selected open-ended fields feed NER.
    const { data: stateRow } = await service
      .from('dataset_state').select('schema_config').eq('dataset_id', dsId).single()
    const allowedKeys = new Set(eligibleEntityFields((stateRow as any)?.schema_config))
    if (allowedKeys.size === 0) continue

    let rows: Array<{ data: unknown }> | null = null
    if (rowCount <= perDataset) {
      const { data } = await service
        .from('dataset_rows_flat').select('data').eq('dataset_id', dsId).limit(perDataset)
      rows = data as any
    } else {
      const idxSet = new Set<number>()
      let guard = 0
      while (idxSet.size < perDataset && guard < perDataset * 5) {
        idxSet.add(Math.floor(Math.random() * rowCount))
        guard += 1
      }
      const { data } = await service
        .from('dataset_rows_flat').select('data').eq('dataset_id', dsId)
        .in('row_index', Array.from(idxSet))
      rows = data as any
    }
    for (const r of rows || []) {
      const t = rowText(r.data, allowedKeys)
      if (t) texts.push(t)
    }
  }
  return texts
}

/** Collect the "subject" of a scope's data: the brand(s) the reviews are
 *  about (datasets.brand_tag) and the structured location / category labels
 *  already attached to rows (the distinct `values` of every categorical
 *  field). The NER prompt is told NOT to re-extract any of these — they are
 *  what the data is about, not findings within it. */
async function gatherDiscoveryContext(
  service: SupabaseClient,
  datasetIds: string[],
): Promise<DiscoveryContext> {
  if (datasetIds.length === 0) return { brandNames: [], structuredValues: [] }

  const { data: dsRows } = await service
    .from('datasets').select('brand_tag').in('id', datasetIds)
  const brandNames = Array.from(new Set(
    ((dsRows || []) as Array<{ brand_tag: string | null }>)
      .map(d => (d.brand_tag || '').trim())
      .filter(Boolean),
  ))

  const { data: stateRows } = await service
    .from('dataset_state').select('schema_config').in('dataset_id', datasetIds)
  const valueSet = new Set<string>()
  for (const row of (stateRows || []) as Array<{ schema_config: unknown }>) {
    const fields = (row.schema_config as SchemaConfig | null)?.fields
    if (!Array.isArray(fields)) continue
    for (const f of fields) {
      if (f.type !== 'categorical' || !Array.isArray(f.values)) continue
      for (const v of f.values) {
        const clean = (v || '').trim()
        if (clean.length >= 2) valueSet.add(clean)
      }
    }
  }
  // Shortest first — bare cities / states before long compound labels — then
  // cap to bound NER prompt token cost.
  const structuredValues = Array.from(valueSet)
    .sort((a, b) => a.length - b.length)
    .slice(0, MAX_CONTEXT_VALUES)

  return { brandNames, structuredValues }
}

// ── NER batch ──────────────────────────────────────────────────────────────

const NER_SYSTEM =
  'You are a precise named-entity extractor. Output valid JSON only. When in doubt, leave it out — a false entity is worse than a missed one.'

/** A "do not extract" preamble built from the scope's subject — the brand the
 *  reviews are about and the structured location / category labels already on
 *  the rows. Empty string when there's no context to pass. */
function contextBlock(ctx: DiscoveryContext): string {
  const lines: string[] = []
  if (ctx.brandNames.length > 0) {
    lines.push(`These texts are customer reviews ABOUT: ${ctx.brandNames.join(', ')}.`)
  }
  if (ctx.structuredValues.length > 0) {
    lines.push(`Every row is already labelled with structured location / category metadata drawn from this set: ${ctx.structuredValues.join(', ')}.`)
  }
  if (lines.length === 0) return ''
  return lines.join('\n') +
    `\nDo NOT extract the subject brand(s) above, their formal or legal names, or any of those location / category names — they are what the data is ABOUT, not findings within it. A review mentioning the subject brand at one of its known locations should yield neither the brand nor that location. Extract only the specific things reviewers talk about: dishes, drinks, named staff, competitor brands.

`
}

function nerPrompt(texts: string[], ctx: DiscoveryContext): string {
  return `Extract NAMED ENTITIES from these customer review / survey / comment texts.

${contextBlock(ctx)}Extract ONLY specific, named things a person could point to:
- food: named dishes and menu items ("Filet Mignon", "Lobster Mac & Cheese", "Caesar Salad") — NOT generic food words ("steak", "appetizer", "dessert", "the food")
- drink: named beverages, wines, cocktails ("Old Fashioned", "Caymus Cabernet", "Tito's")
- place: named locations, cities, neighborhoods, specific named venues ("Tysons Corner", "the DC location", "Times Square")
- person: named individuals — staff, managers, public figures ("our server Maria", "Chef Tony")
- brand: named companies, competitor brands, named products ("OpenTable", "DoorDash", "Yelp")
- other: any other specific named entity that fits none of the above

DO NOT extract:
- adjectives or descriptions ("attentive", "delicious", "slow", "friendly")
- sentiments or opinions ("the service was great", "good value", "would come back")
- generic nouns or concepts ("service", "food", "atmosphere", "ambiance", "staff", "menu", "experience", "quality", "price", "wait")
- whole phrases or sentences

If a text mentions no specific named entity, skip it — that is expected and fine.

For each distinct entity output:
- "canonical": the cleanest standard form, properly capitalised
- "category": one of food | drink | place | person | brand | other
- "aliases": the raw variants seen in the text, lowercase, as written

Merge obvious variants under one canonical ("filet", "the filet mignon" -> canonical "Filet Mignon", aliases ["filet","the filet mignon"]).

Return ONLY a JSON object, no prose, no markdown fences:
{"entities": [{"canonical": "...", "category": "...", "aliases": ["..."]}]}

Texts:
${texts.map((t, i) => `[${i + 1}] ${t}`).join('\n')}`
}

interface BatchResult {
  entities: Array<{ canonical: string; category: string; aliases: string[] }>
  inputTokens: number
  outputTokens: number
  error: string | null
}

async function nerBatch(texts: string[], orgId: string | null, datasetId: string, ctx: DiscoveryContext): Promise<BatchResult> {
  try {
    const res = await callAI({
      tier: 'fast',
      system: NER_SYSTEM,
      messages: [{ role: 'user', content: nerPrompt(texts, ctx) }],
      maxTokens: 1500,
      timeoutMs: 30_000,
      usage: orgId
        ? { org_id: orgId, resource_type: 'dataset', resource_id: datasetId, event_type: 'entity_discovery' }
        : undefined,
    })
    const text = (res.text || '').trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    let entities: BatchResult['entities'] = []
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(parsed?.entities)) {
        entities = parsed.entities
          .filter((e: any) => e && typeof e.canonical === 'string' && e.canonical.trim().length >= 2)
          .map((e: any) => ({
            canonical: e.canonical.trim(),
            category: CATEGORIES.includes(String(e.category || '').toLowerCase())
              ? String(e.category).toLowerCase()
              : 'other',
            aliases: Array.isArray(e.aliases)
              ? e.aliases.filter((a: any) => typeof a === 'string' && a.trim()).map((a: string) => a.trim().toLowerCase())
              : [],
          }))
      }
    }
    return {
      entities,
      inputTokens: res.usage?.input_tokens || 0,
      outputTokens: res.usage?.output_tokens || 0,
      error: null,
    }
  } catch (err: any) {
    return { entities: [], inputTokens: 0, outputTokens: 0, error: err?.message || 'NER batch failed' }
  }
}

// ── Canonicalisation pass ──────────────────────────────────────────────────
// Per-batch NER produces near-duplicates across batches ("Filet" in one
// batch, "Filet Mignon" in another; "Brussels Sprout" vs "Brussels Sprouts").
// One Haiku call over the full entity list merges variants while preserving
// real distinctions — best-effort, a failed pass just leaves the raw map.

function canonicalisePrompt(canonicals: string[]): string {
  return `You are normalising a list of named entities extracted from customer reviews. For each input, output the canonical (cleanest standard) form and a category.

Merge obvious variants of the SAME thing under one canonical:
- "Filet" / "Filet Mignon" / "Mignon" -> "Filet Mignon"
- "Brussels Sprout" / "Brussels Sprouts" -> "Brussels Sprouts"
- "Mac & Cheese" / "Mac and Cheese" / "mac n cheese" -> "Mac & Cheese"

PRESERVE real distinctions — do NOT over-merge different things:
- "Lobster" and "Lobster Mac & Cheese" are DIFFERENT dishes — keep separate
- "Ribeye" and "Filet Mignon" are different cuts — keep separate
- "Old Fashioned" and "Manhattan" are different cocktails — keep separate

Categories (pick the single best fit; lower-case): food | drink | place | person | brand | other

Return ONLY a JSON object, no prose, no markdown fences. Keys are the raw inputs verbatim. Values are { "canonical": "...", "category": "..." }.

Inputs:
${canonicals.map(c => `- ${c}`).join('\n')}`
}

/** Second-pass canonicalisation over the slug-aggregated entity map. Returns a
 *  new map keyed by the canonicalised slug (variants merged: aliases unioned,
 *  pre-merge canonicals kept as aliases so the FTS query still hits them,
 *  sample counts summed) plus the token cost. On any failure the original map
 *  is returned unchanged. */
async function canonicaliseDiscovered(
  discovered: Map<string, DiscoveredEntity>,
  orgId: string | null,
  datasetId: string,
): Promise<{ map: Map<string, DiscoveredEntity>; inputTokens: number; outputTokens: number }> {
  const entries = Array.from(discovered.values())
  if (entries.length < 2) return { map: discovered, inputTokens: 0, outputTokens: 0 }

  const mapping: Record<string, { canonical: string; category: string }> = {}
  let inputTokens = 0
  let outputTokens = 0
  const BATCH = 200
  const rawList = entries.map(e => e.canonical)
  for (let i = 0; i < rawList.length; i += BATCH) {
    const batch = rawList.slice(i, i + BATCH)
    try {
      const res = await callAI({
        tier: 'fast',
        system: 'You are a precise data normaliser. Output valid JSON only.',
        messages: [{ role: 'user', content: canonicalisePrompt(batch) }],
        maxTokens: 4000,
        timeoutMs: 30_000,
        usage: orgId
          ? { org_id: orgId, resource_type: 'dataset', resource_id: datasetId, event_type: 'entity_discovery' }
          : undefined,
      })
      inputTokens += res.usage?.input_tokens || 0
      outputTokens += res.usage?.output_tokens || 0
      const text = (res.text || '').trim()
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start < 0 || end <= start) continue
      const parsed = JSON.parse(text.slice(start, end + 1))
      for (const [k, v] of Object.entries(parsed)) {
        const vv = v as any
        if (vv && typeof vv.canonical === 'string' && vv.canonical.trim().length >= 2) {
          mapping[k] = {
            canonical: vv.canonical.trim(),
            category: CATEGORIES.includes(String(vv.category || '').toLowerCase())
              ? String(vv.category).toLowerCase()
              : '',
          }
        }
      }
    } catch {
      // Leave this batch uncanonicalised — its entries default to themselves.
    }
  }

  // Re-aggregate under the canonical names. An entry with no mapping keeps its
  // own canonical/category.
  const merged = new Map<string, DiscoveredEntity>()
  for (const e of entries) {
    const m = mapping[e.canonical]
    const canonical = m && m.canonical ? m.canonical : e.canonical
    const category = m && m.category ? m.category : e.category
    const slug = slugify(canonical)
    if (!slug) continue
    const cur = merged.get(slug)
    if (cur) {
      cur.sampleCount += e.sampleCount
      for (const a of Array.from(e.aliases)) cur.aliases.add(a)
      if (e.canonical.toLowerCase() !== canonical.toLowerCase()) cur.aliases.add(e.canonical.toLowerCase())
    } else {
      const aliases = new Set(Array.from(e.aliases))
      if (e.canonical.toLowerCase() !== canonical.toLowerCase()) aliases.add(e.canonical.toLowerCase())
      merged.set(slug, { canonical, category, aliases, sampleCount: e.sampleCount })
    }
  }
  return { map: merged, inputTokens, outputTokens }
}

// ── discoverEntities ───────────────────────────────────────────────────────

/** Run entity discovery for a dataset's scope: sample rows, NER them, upsert
 *  the catalog, log the run. `sampleDatasetIds` overrides which member
 *  datasets to sample (used by incremental mode — sample only the dataset
 *  that just joined). Caller must authorise scope access first. */
export async function discoverEntities(opts: {
  service:          SupabaseClient
  datasetId:        string
  mode:             DiscoveryMode
  triggeredByUser?: string | null
  sampleDatasetIds?: string[]
  sampleSize?:      number
}): Promise<DiscoveryResult> {
  const { service, datasetId, mode } = opts
  const startedAt = Date.now()

  const scope = await resolveEntityScope(service, datasetId)
  if (!scope.found) throw new Error('Dataset not found')

  const sampleSize = Math.min(Math.max(opts.sampleSize ?? DEFAULT_SAMPLE_SIZE, 25), 1000)
  const sampleFrom = (opts.sampleDatasetIds && opts.sampleDatasetIds.length > 0)
    ? opts.sampleDatasetIds
    : scope.memberDatasetIds

  // Manual runs rebuild the scope's catalog from scratch: this is how a user
  // clears entities discovered before field-selection existed (e.g. location
  // noise from a categorical column). Cron / incremental modes accumulate.
  if (mode === 'manual') {
    await service
      .from('entity_catalog')
      .delete()
      .eq('scope_type', scope.scopeType)
      .eq('scope_id', scope.scopeId)
  }

  // Existing catalog — for before/new counts and alias/sample-count merge.
  const { data: existing } = await service
    .from('entity_catalog')
    .select('slug, canonical, category, aliases, sample_count')
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
  const existingBySlug = new Map<string, { canonical: string; category: string; aliases: string[]; sample_count: number }>()
  for (const e of (existing || []) as any[]) {
    existingBySlug.set(e.slug, {
      canonical: e.canonical, category: e.category,
      aliases: e.aliases || [], sample_count: e.sample_count || 0,
    })
  }
  const entitiesBefore = existingBySlug.size

  const writeRefresh = async (result: Partial<DiscoveryResult> & { sample_size: number; error: string | null }) => {
    await service.from('entity_catalog_refresh').insert({
      scope_type:           scope.scopeType,
      scope_id:             scope.scopeId,
      triggered_by:         mode,
      triggered_by_user:    opts.triggeredByUser || null,
      sample_size:          result.sample_size,
      datasets_sampled:     sampleFrom,
      entities_before:      entitiesBefore,
      entities_after:       result.entities_after ?? entitiesBefore,
      entities_new:         result.entities_new ?? 0,
      haiku_cost_est_cents: result.cost_est_cents ?? 0,
      duration_ms:          Date.now() - startedAt,
      error:                result.error,
    })
  }

  // ── Sample ───────────────────────────────────────────────────────────────
  const texts = await sampleRowTexts(service, sampleFrom, sampleSize)
  if (texts.length === 0) {
    const emptyMsg = 'No rows to sample — check that at least one open-ended field is enabled for entity extraction in the Schema tab'
    await writeRefresh({ sample_size: 0, error: emptyMsg })
    return {
      scope_type: scope.scopeType, scope_id: scope.scopeId, mode,
      sample_size: 0, datasets_sampled: sampleFrom,
      entities_before: entitiesBefore, entities_after: entitiesBefore, entities_new: 0,
      duration_ms: Date.now() - startedAt, cost_est_cents: 0, error: emptyMsg,
    }
  }

  // ── NER ──────────────────────────────────────────────────────────────────
  // Context (subject brand + structured location labels) tells the extractor
  // what NOT to surface — the data's subject is not a finding within it.
  const context = await gatherDiscoveryContext(service, sampleFrom)
  const batches: string[][] = []
  for (let i = 0; i < texts.length; i += ROWS_PER_BATCH) {
    batches.push(texts.slice(i, i + ROWS_PER_BATCH))
  }
  const batchResults = await mapLimit(batches, NER_CONCURRENCY, b => nerBatch(b, scope.orgId, datasetId, context))

  let inputTokens = 0
  let outputTokens = 0
  const errors: string[] = []
  for (const br of batchResults) {
    inputTokens += br.inputTokens
    outputTokens += br.outputTokens
    if (br.error) errors.push(br.error)
  }
  let costCents = Math.round((inputTokens / 1_000_000) * 100 + (outputTokens / 1_000_000) * 500)

  // Every batch failed and nothing came back — surface the failure.
  const anyEntities = batchResults.some(br => br.entities.length > 0)
  if (!anyEntities && errors.length > 0) {
    const msg = errors[0]
    await writeRefresh({ sample_size: texts.length, error: msg, cost_est_cents: costCents })
    throw new Error(msg)
  }

  // ── Aggregate across batches by slug ─────────────────────────────────────
  const discovered = new Map<string, DiscoveredEntity>()
  for (const br of batchResults) {
    for (const e of br.entities) {
      const slug = slugify(e.canonical)
      if (!slug) continue
      const cur = discovered.get(slug)
      if (cur) {
        cur.sampleCount += 1
        for (const a of e.aliases) cur.aliases.add(a)
      } else {
        discovered.set(slug, {
          canonical: e.canonical,
          category: e.category,
          aliases: new Set(e.aliases),
          sampleCount: 1,
        })
      }
    }
  }

  // ── Canonicalise: merge cross-batch near-duplicates into one entity ──────
  const canon = await canonicaliseDiscovered(discovered, scope.orgId, datasetId)
  inputTokens += canon.inputTokens
  outputTokens += canon.outputTokens
  costCents = Math.round((inputTokens / 1_000_000) * 100 + (outputTokens / 1_000_000) * 500)

  // Cap to the strongest-signal entities if a run somehow over-produces.
  let discoveredList = Array.from(canon.map.entries())
  if (discoveredList.length > MAX_ENTITIES) {
    discoveredList = discoveredList
      .sort((a, b) => b[1].sampleCount - a[1].sampleCount)
      .slice(0, MAX_ENTITIES)
  }

  // ── Merge + upsert ───────────────────────────────────────────────────────
  // First canonical/category wins (avoids flapping on re-discovery); aliases
  // union; sample_count accumulates. first_seen_at/id omitted so upsert keeps
  // them on conflict and defaults them on insert.
  const nowIso = new Date().toISOString()
  let entitiesNew = 0
  const upsertRows = discoveredList.map(([slug, disc]) => {
    const prev = existingBySlug.get(slug)
    if (!prev) entitiesNew += 1
    const aliasUnion = Array.from(new Set([
      ...(prev?.aliases || []),
      ...Array.from(disc.aliases),
    ])).slice(0, MAX_ALIASES)
    return {
      scope_type:   scope.scopeType,
      scope_id:     scope.scopeId,
      canonical:    prev?.canonical || disc.canonical,
      slug,
      category:     prev?.category || disc.category,
      aliases:      aliasUnion,
      sample_count: (prev?.sample_count || 0) + disc.sampleCount,
      last_seen_at: nowIso,
    }
  })

  for (let i = 0; i < upsertRows.length; i += 200) {
    const chunk = upsertRows.slice(i, i + 200)
    const { error } = await service
      .from('entity_catalog')
      .upsert(chunk, { onConflict: 'scope_type,scope_id,slug' })
    if (error) {
      await writeRefresh({ sample_size: texts.length, error: error.message, cost_est_cents: costCents })
      throw new Error(`entity_catalog upsert failed: ${error.message}`)
    }
  }

  const entitiesAfter = entitiesBefore + entitiesNew
  const refreshError = errors.length > 0 ? `${errors.length} of ${batches.length} NER batches failed` : null
  await writeRefresh({
    sample_size: texts.length,
    entities_after: entitiesAfter,
    entities_new: entitiesNew,
    cost_est_cents: costCents,
    error: refreshError,
  })

  return {
    scope_type:       scope.scopeType,
    scope_id:         scope.scopeId,
    mode,
    sample_size:      texts.length,
    datasets_sampled: sampleFrom,
    entities_before:  entitiesBefore,
    entities_after:   entitiesAfter,
    entities_new:     entitiesNew,
    duration_ms:      Date.now() - startedAt,
    cost_est_cents:   costCents,
    error:            refreshError,
  }
}
