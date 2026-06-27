// lib/correction/provenance.ts
//
// Entity-catalog provenance + source authority (owner requirement, 2026-06-27).
//
// Every entity_catalog entry must trace to a valid SOURCE record, and a canonical
// spelling must come from an OFFICIAL record — a brand-site crawl or an uploaded
// source document (or a human). Conversations, survey responses, and ASR
// transcripts are CORROBORATING sources: they contribute aliases + mentions but
// never DEFINE or OVERRIDE an authoritative canonical (strict gating).
//
// This module is pure + dependency-free so every writer (agent KB extraction,
// dataset/collection discovery, the bot→brand rollup, the manual curate routes)
// and the read-side glossary share ONE authority model.

export type SourceKind =
  | 'manual'        // hand-curated by an admin — highest authority
  | 'document'      // uploaded official source doc (KB file, Town Hall agenda/slides)
  | 'crawl'         // crawled brand-site URL (agent training URLs)
  | 'transcript'    // ASR transcript (Town Hall) — corroborating
  | 'conversation'  // agent chat turns — corroborating
  | 'survey'        // survey open-ended responses — corroborating
  | 'review'        // review datasets (Google reviews, etc.) — corroborating
  | 'discovered'    // legacy / unknown automated write — lowest

// Higher = more authoritative. Used to decide who owns a canonical spelling.
export const SOURCE_AUTHORITY: Record<SourceKind, number> = {
  manual: 100,
  document: 80,
  crawl: 70,
  transcript: 30,
  conversation: 20,
  survey: 20,
  review: 10,
  discovered: 10,
}

// "Authoritative" = an OFFICIAL record (crawl/document) or a human (manual). Only
// these may define or change a canonical spelling, and only these qualify an
// entity for the correction glossary.
export const AUTHORITATIVE_MIN = SOURCE_AUTHORITY.crawl

export function authorityOf(kind: SourceKind | string | null | undefined): number {
  return SOURCE_AUTHORITY[(kind as SourceKind)] ?? 0
}

export function isAuthoritative(kind: SourceKind | string | null | undefined): boolean {
  return authorityOf(kind) >= AUTHORITATIVE_MIN
}

// Strict rule: an incoming source may SET or OVERWRITE the canonical only if it is
// authoritative AND at least as authoritative as the source that currently owns
// the canonical. UGC never sets the canonical.
export function canSetCanonical(incoming: SourceKind, existingOwner: SourceKind | null | undefined): boolean {
  if (!isAuthoritative(incoming)) return false
  if (!existingOwner) return true
  return authorityOf(incoming) >= authorityOf(existingOwner)
}

// Decide the canonical surface form + its owning source-kind, given the previous
// catalog entry (if any) and an incoming observation.
//   - new entity            → incoming owns it (even UGC seeds a PROVISIONAL
//                             canonical; its low authority is recorded so a later
//                             official source overrides, and the glossary filters
//                             non-authoritative canonicals out of correction).
//   - same surface          → keep canonical, upgrade owner if incoming outranks.
//   - different surface      → incoming replaces only if canSetCanonical; else the
//                             incoming surface is left to be folded in as an alias.
export function chooseCanonical(
  prev: { canonical: string; source: SourceKind } | null | undefined,
  incoming: { canonical: string; kind: SourceKind },
): { canonical: string; source: SourceKind } {
  // New entity → whoever first observed it owns it (UGC seeds a provisional
  // canonical; its low authority is recorded). Otherwise the incoming source
  // takes ownership of the exact spelling ONLY if it can set the canonical
  // (authoritative AND >= the current owner) — this also upgrades authority on a
  // same-surface re-observation. UGC and lower-tier sources keep the prev string.
  if (!prev) return { canonical: incoming.canonical, source: incoming.kind }
  if (canSetCanonical(incoming.kind, prev.source)) return { canonical: incoming.canonical, source: incoming.kind }
  return { canonical: prev.canonical, source: prev.source }
}

// ── Provenance trail ───────────────────────────────────────────────────────
// Stored on entity_catalog.provenance (jsonb), keyed by source-kind:
//   { "<kind>": { count: <int>, refs: [ {id?, url?, title?, ...}, ... ] } }
// refs are capped per kind so a high-volume UGC source can't grow the row
// unboundedly; count keeps the true total.

const MAX_REFS_PER_KIND = 20

export interface ProvenanceKindEntry { count: number; refs: Record<string, unknown>[] }
export type Provenance = Record<string, ProvenanceKindEntry>

export function mergeProvenance(
  prev: Provenance | null | undefined,
  kind: SourceKind,
  ref: Record<string, unknown> | null | undefined,
  count = 1,
): Provenance {
  const out: Provenance = { ...(prev ?? {}) }
  const cur: ProvenanceKindEntry = out[kind] ? { count: out[kind].count, refs: [...out[kind].refs] } : { count: 0, refs: [] }
  cur.count += count
  if (ref && Object.keys(ref).length > 0) {
    const key = JSON.stringify(ref)
    const seen = new Set(cur.refs.map(r => JSON.stringify(r)))
    if (!seen.has(key) && cur.refs.length < MAX_REFS_PER_KIND) cur.refs.push(ref)
  }
  out[kind] = cur
  return out
}

// Does this entity have at least one authoritative source? (Used by the glossary
// to keep only trustworthy canonicals for correction.)
export function hasAuthoritativeSource(source: SourceKind | string | null | undefined, provenance: Provenance | null | undefined): boolean {
  if (isAuthoritative(source)) return true
  if (provenance) for (const k of Object.keys(provenance)) if (isAuthoritative(k)) return true
  return false
}
