// lib/correction/normalize.ts
//
// Product-agnostic deterministic variant→canonical spelling normalization — the
// shared home for the logic that used to live only in lib/recordings/normalize.ts.
// Pure + client-safe (no AI, no server-only imports), so any surface can compute
// a "corrected" view from a glossary without mutating the raw source text.
//
// NOT an AI rewrite: only listed mis-spellings change; all other text is
// byte-identical. Used by Town Hall (recordings), agent reports (What We Heard),
// and surveys via one code path.

export interface GlossaryEntry {
  canonical: string
  aliases?: string[]   // variant spellings that should map to `canonical`
  category?: string    // optional source category (e.g. entity_catalog.category); ignored by the
                       // normalizer, carried through for typed consumers like Town Hall's entity map
  authoritative?: boolean  // canonical comes from an OFFICIAL record (crawl/document) or a human —
                           // used by correction consumers to avoid correcting toward a UGC-invented name
}

// variant → canonical replacements. Case-insensitive, whole-word, longest-
// variant-first so "Kelly Park Road" is replaced before "Kelly Park".
export function buildReplacements(glossary: GlossaryEntry[] | null | undefined): Array<{ re: RegExp; to: string }> {
  if (!glossary || glossary.length === 0) return []
  const pairs: Array<{ from: string; to: string }> = []
  for (const e of glossary) {
    for (const v of (e.aliases ?? [])) {
      if (!v || v.toLowerCase() === e.canonical.toLowerCase()) continue
      pairs.push({ from: v, to: e.canonical })
    }
  }
  pairs.sort((a, b) => b.from.length - a.from.length)
  return pairs.map(p => ({ re: new RegExp(`\\b${escapeRegExp(p.from)}\\b`, 'gi'), to: p.to }))
}

export function normalizeText(text: string, repl: Array<{ re: RegExp; to: string }>): string {
  let out = text
  for (const r of repl) out = out.replace(r.re, r.to)
  return out
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
