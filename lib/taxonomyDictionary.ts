// lib/taxonomyDictionary.ts
// Layered keyword-dictionary resolver (productization plan, Phase 2). Composes
// the shared CORE dictionary (generic, true for all restaurants) with an
// optional per-brand OVERLAY (menu items, idioms, promotions mined from that
// brand's reviews). Brand phrases never pollute the core — they're only added
// when a brand is named. The matcher's own default stays core ⊕ RC-learned for
// backward-compat with the RC/CG pilot scripts; this resolver is the general,
// brand-aware path used by the persisting classifier + CLI.

import { KEYWORD_DICTIONARY, type KeywordEntry } from './taxonomyKeywords'
import { LEARNED_KEYWORD_DICTIONARY as RC_OVERLAY } from './taxonomyKeywordsLearned'
import { LEARNED_KEYWORD_DICTIONARY as CHUYS_OVERLAY } from './taxonomyKeywordsChuys'

export type BrandOverlay = 'core' | 'rc' | 'chuys'
export const BRAND_OVERLAYS: Record<Exclude<BrandOverlay, 'core'>, KeywordEntry[]> = {
  rc:    RC_OVERLAY,
  chuys: CHUYS_OVERLAY,
}
export const KNOWN_BRANDS: BrandOverlay[] = ['core', 'rc', 'chuys']

/** Compose the dictionary for a brand: core, or core ⊕ that brand's overlay. */
export function resolveDictionary(brand: BrandOverlay = 'core'): KeywordEntry[] {
  if (brand === 'core') return KEYWORD_DICTIONARY
  return [...KEYWORD_DICTIONARY, ...BRAND_OVERLAYS[brand]]
}
