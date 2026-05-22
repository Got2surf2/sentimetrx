// lib/entityMentionDetector.ts
//
// Entity-mention detector for user turns (docs/BOTS.md § 9.y).
//
// At chat time, after the probe-focus classifier fires, this function reads
// the agent's entity_catalog (bot-scoped, visible-only) and runs a literal
// word-boundary regex match against the user message. Matched entities get
// flagged on the user turn's content_flags as `entity:<slug>`.
//
// Cost: $0 per turn. Pure string match. AI cost only at extraction time.
//
// The catalog is cached per bot_id with a short TTL so the hot path doesn't
// re-query Supabase every turn. Cache is invalidated on extract via
// invalidateEntityCache(botId).

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expandEntityTerms } from './entityVariants'

interface CatalogEntry {
  slug: string
  terms: string[]   // expanded variants from canonical + aliases
}

interface CacheEntry {
  loadedAt: number
  entries: CatalogEntry[]
  // Pre-compiled regex covering every term, capturing the slug via group.
  // Falsy if there were no visible entities.
  matcher: { regex: RegExp; termSlug: Map<string, string> } | null
}

const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CacheEntry>()

/** Escape a string for safe inclusion in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildMatcher(entries: CatalogEntry[]): CacheEntry['matcher'] {
  if (entries.length === 0) return null
  // Build a map from lowercased term -> slug so multiple entities sharing
  // a surface form (unlikely but possible) collapse correctly.
  const termSlug = new Map<string, string>()
  for (const e of entries) {
    for (const t of e.terms) {
      const key = t.toLowerCase()
      if (key.length < 2) continue
      // First-write wins to keep behavior stable across calls.
      if (!termSlug.has(key)) termSlug.set(key, e.slug)
    }
  }
  if (termSlug.size === 0) return null
  // Sort longest-first so multi-word entities take precedence over substrings
  // that happen to live inside them.
  const terms = Array.from(termSlug.keys()).sort((a, b) => b.length - a.length)
  const pattern = '\\b(' + terms.map(escapeRegex).join('|') + ')\\b'
  return { regex: new RegExp(pattern, 'gi'), termSlug }
}

async function loadCatalog(
  service: SupabaseClient,
  botId: string,
): Promise<CacheEntry> {
  const { data: rows } = await service
    .from('entity_catalog')
    .select('slug, canonical, aliases, hidden')
    .eq('scope_type', 'bot')
    .eq('scope_id', botId)
    .eq('hidden', false)

  const entries: CatalogEntry[] = []
  for (const r of rows || []) {
    const slug = (r as any).slug as string
    if (!slug) continue
    const canonical = (r as any).canonical as string
    const aliases = Array.isArray((r as any).aliases) ? ((r as any).aliases as string[]) : []
    const terms = expandEntityTerms([canonical, ...aliases].filter(Boolean))
    if (terms.length === 0) continue
    entries.push({ slug, terms })
  }

  return {
    loadedAt: Date.now(),
    entries,
    matcher: buildMatcher(entries),
  }
}

/**
 * Detect catalog entities mentioned in a user message.
 *
 * Returns an array of entity slugs (deduped, in first-seen order). Every
 * occurrence in the text is folded into a single slug — we don't multi-
 * count within one turn, but every TURN with a mention emits a flag (per
 * § 9.y open Q4 — "flag every mention" is at the turn granularity, not the
 * occurrence granularity).
 */
export async function detectEntityMentions(
  service: SupabaseClient,
  botId: string,
  userMessage: string,
): Promise<string[]> {
  const text = (userMessage || '').trim()
  if (text.length < 2) return []

  let entry = cache.get(botId)
  if (!entry || Date.now() - entry.loadedAt > TTL_MS) {
    entry = await loadCatalog(service, botId)
    cache.set(botId, entry)
  }
  if (!entry.matcher) return []

  const found: string[] = []
  const seen = new Set<string>()
  // Reset lastIndex before each call so the shared regex is reusable.
  entry.matcher.regex.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = entry.matcher.regex.exec(text)) !== null) {
    const key = m[1].toLowerCase()
    const slug = entry.matcher.termSlug.get(key)
    if (slug && !seen.has(slug)) {
      seen.add(slug)
      found.push(slug)
    }
  }
  return found
}

/**
 * Invalidate the cached catalog for a bot. Call after extraction so the next
 * turn sees freshly discovered / unhidden entries.
 */
export function invalidateEntityCache(botId: string): void {
  cache.delete(botId)
}

/** Test seam — overwrite the cached catalog for a bot without hitting the DB. */
export function __setEntityCacheForTest(botId: string, entries: CatalogEntry[]): void {
  cache.set(botId, {
    loadedAt: Date.now(),
    entries,
    matcher: buildMatcher(entries),
  })
}

/** Test seam — clear all cached catalogs. */
export function __clearEntityCacheForTest(): void {
  cache.clear()
}
