// lib/entityVariants.ts
// Plural / lemma expansion for entity terms at READ time.
//
// Why: highlightEntityTerms uses a literal-string regex with word boundaries,
// so it won't highlight "Brussels Sprout" when the catalog canonical is
// "Brussels Sprouts" (or vice versa). FTS counts mostly already collapse
// regular plurals via Postgres's English stemmer, but irregular plurals
// (geese/goose, leaves/leaf) slip through. This helper expands a term into
// every reasonable surface form so the highlight regex catches all of them
// and the FTS query is robust to irregular cases.

import { lemmatize as irregularLemmatize } from './lemmas'

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

function singularizeWord(word: string): string | null {
  const lw = word.toLowerCase()
  if (lw.length < 3) return null

  // Irregular plurals: check the lemma map first (covers geese→goose etc.)
  const irreg = irregularLemmatize(lw)
  if (irreg !== lw && irreg.length >= 2) return preserveCase(word, irreg)

  // -ies → -y  (cherries → cherry)
  if (lw.endsWith('ies') && lw.length > 4) {
    return preserveCase(word.slice(0, -3) + 'y', word.slice(0, -3) + 'y')
  }
  // -ves → -f / -fe  (leaves → leaf, knives → knife)
  if (lw.endsWith('ves') && lw.length > 4) {
    return preserveCase(word, word.slice(0, -3) + 'f')
  }
  // -ses, -xes, -zes, -ches, -shes → strip "es"  (boxes → box, dishes → dish)
  if (/(s|x|z|ch|sh)es$/.test(lw)) return preserveCase(word, word.slice(0, -2))
  // -oes → -o  (tomatoes → tomato)
  if (lw.endsWith('oes') && lw.length > 4) return preserveCase(word, word.slice(0, -2))
  // -s but not -ss, -us, -is  (filets → filet, but not "boss" → "bos")
  if (lw.endsWith('s') && !/(ss|us|is)$/.test(lw)) return preserveCase(word, word.slice(0, -1))

  return null
}

function pluralizeWord(word: string): string | null {
  const lw = word.toLowerCase()
  if (lw.length < 2) return null

  // Already plural? Skip — singularize side will handle it.
  if (singularizeWord(word)) return null

  // consonant + y → -ies  (cherry → cherries)
  if (lw.endsWith('y') && lw.length > 2 && !VOWELS.has(lw[lw.length - 2])) {
    return preserveCase(word, word.slice(0, -1) + 'ies')
  }
  // -f → -ves  (leaf → leaves)
  if (lw.endsWith('f') && lw.length > 2) {
    return preserveCase(word, word.slice(0, -1) + 'ves')
  }
  // -fe → -ves  (knife → knives)
  if (lw.endsWith('fe') && lw.length > 3) {
    return preserveCase(word, word.slice(0, -2) + 'ves')
  }
  // -s, -x, -z, -ch, -sh → +es  (box → boxes)
  if (/(s|x|z|ch|sh)$/.test(lw)) return preserveCase(word, word + 'es')
  // consonant + o → +es  (tomato → tomatoes)  — heuristic, not perfect
  if (lw.endsWith('o') && lw.length > 2 && !VOWELS.has(lw[lw.length - 2])) {
    return preserveCase(word, word + 'es')
  }
  // default
  return preserveCase(word, word + 's')
}

// Match the casing of the source word when generating a variant. "Filet" → "Filets",
// "FILET" → "FILETS", "filet" → "filets". Multi-case mixes default to lowercase.
function preserveCase(source: string, variant: string): string {
  if (!source) return variant
  if (source === source.toUpperCase()) return variant.toUpperCase()
  if (source[0] === source[0].toUpperCase() && source.slice(1) === source.slice(1).toLowerCase()) {
    return variant[0].toUpperCase() + variant.slice(1).toLowerCase()
  }
  return variant.toLowerCase()
}

/**
 * Expand an entity term into its plural/singular variants. Multi-word phrases
 * are varied only on their HEAD noun (last word) — modifiers stay fixed.
 *
 *   "Filet"          → ["Filet", "Filets"]
 *   "Filet Mignon"   → ["Filet Mignon", "Filet Mignons"]
 *   "Brussels Sprouts" → ["Brussels Sprouts", "Brussels Sprout"]
 *   "Old Fashioned"  → ["Old Fashioned", "Old Fashioneds"]
 *
 * Returns the original term first, then any generated variants. Always
 * deduplicated. Always preserves the original casing.
 */
export function entityTermVariants(term: string): string[] {
  const trimmed = (term || '').trim()
  if (trimmed.length < 2) return trimmed ? [trimmed] : []

  const parts = trimmed.split(/\s+/)
  const head = parts[parts.length - 1]
  const prefix = parts.slice(0, -1).join(' ')
  const joinHead = function(h: string): string { return prefix ? prefix + ' ' + h : h }

  const out = new Set<string>([trimmed])

  const singular = singularizeWord(head)
  if (singular && singular.toLowerCase() !== head.toLowerCase()) {
    out.add(joinHead(singular))
  }

  const plural = pluralizeWord(head)
  if (plural && plural.toLowerCase() !== head.toLowerCase()) {
    out.add(joinHead(plural))
  }

  return Array.from(out)
}

/** Expand a list of entity terms (canonical + aliases) into all variants,
 *  deduplicated case-insensitively. The first surface form of each
 *  case-insensitive key wins so casing stays presentable. */
export function expandEntityTerms(terms: string[]): string[] {
  const seen = new Map<string, string>()
  for (const t of terms) {
    for (const v of entityTermVariants(t)) {
      const key = v.toLowerCase()
      if (!seen.has(key)) seen.set(key, v)
    }
  }
  const out: string[] = []
  seen.forEach(function(v) { out.push(v) })
  return out
}
