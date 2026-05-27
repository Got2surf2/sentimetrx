// lib/taxonomyVocabulary.ts
//
// Ruth's Chris taxonomy pilot — closed vocabulary for the 7-axis ABSA model.
// Severity is a cross-cutting flag, NOT an 8th axis.
//
// The DB stores arrays of these sub-bucket names. The LLM classifier in
// lib/taxonomyExtractor.ts is required to emit only sub-buckets from this
// vocabulary; anything outside is captured in the `_unmapped` bucket for
// monthly triage.

export const TOUCHPOINT_SUBS = [
  'server',
  'manager',
  'host',
  'bartender',
  'busser',
  'chef',
  'sommelier',
  'cashier',
] as const

export const ATTRIBUTE_SUBS = [
  'flavor',
  'speed',
  'attentive',
  'clean',
  'knowledge',
  'accuracy',
  'pace',
  'temp',
  'portion',
  'presentation',
  'professional',
  'friendly',
  'food safety',
  'pests',
  'rude',
] as const

export const PRODUCT_SUBS = [
  'steak',
  'sides',
  'apps',
  'desserts',
  'salads',
  'soup',
  'seafood',
  'pasta',
  'beef',
  'pork',
  'chicken',
  'kids',
  'breakfast',
  'bread',
  'condiments',
  'fries',
] as const

// Specific products under the steak/beef umbrella — captured in the
// per-assertion `item` field (NOT a sub bucket), but the closed vocab
// gates which items the LLM is allowed to emit.
export const PRODUCT_ITEMS = [
  'filet',
  'ribeye',
  'ny strip',
  'porterhouse',
  't-bone',
  'sirloin',
  'prime rib',
  'tomahawk',
  'mac and cheese',
  'lobster mac',
  'creamed spinach',
  'lobster tail',
  'crab cake',
  'shrimp cocktail',
  'caesar salad',
  'wedge salad',
  'cheesecake',
  'bread pudding',
] as const

export const BEVERAGE_SUBS = [
  'wine',
  'cocktail',
  'beer',
  'nab',
  'coffee',
  'champagne',
  'martini',
  'margarita',
  'tea',
  'sangria',
  'milkshakes',
] as const

export const AMBIANCE_SUBS = [
  'noise',
  'light',
  'music',
  'decor',
  'clean',
  'location',
  'odor',
  'dress code',
  'safety',
  'appearance',
  'tv',
] as const

export const CONTEXT_DAYPART = [
  'breakfast',
  'lunch',
  'dinner',
  'happy-hour',
  'late-night',
] as const

export const CONTEXT_HOLIDAY = [
  'valentines',
  'mothers-day',
  'fathers-day',
  'thanksgiving',
  'christmas',
  'new-years',
  'easter',
  'birthday',
  'anniversary',
] as const

export const CONTEXT_CHANNEL = [
  'to-go',
  'delivery',
  'catering',
  'doordash',
  'uber-eats',
  'curbside',
  'drive-thru',
] as const

// Context axis subs are unioned — any of daypart, holiday, weekend,
// prime-hour, sporting-event, or channel value can appear in axis_context.
export const CONTEXT_SUBS = [
  ...CONTEXT_DAYPART,
  ...CONTEXT_HOLIDAY,
  ...CONTEXT_CHANNEL,
  'weekend',
  'prime-hour',
  'sporting-event',
] as const

export const OUTCOME_SUBS = [
  // Intent-of-Repurchase family
  'return',
  'recommend',
  'loyalty',
  'frequency',
  'check-in',
  'brand-love',
  'not-recommend',
  'lost-customer',
  // Value perception
  'expensive',
  'affordable',
  'discount',
  'price-increase',
  // Improvement / suggestion
  'improvement',
] as const

export const SEVERITY_VALUES = ['normal', 'alert', 'crisis'] as const
export const POLARITY_VALUES = ['pos', 'neg', 'neu'] as const

export type Touchpoint = typeof TOUCHPOINT_SUBS[number]
export type Attribute  = typeof ATTRIBUTE_SUBS[number]
export type Product    = typeof PRODUCT_SUBS[number]
export type ProductItem = typeof PRODUCT_ITEMS[number]
export type Beverage   = typeof BEVERAGE_SUBS[number]
export type Ambiance   = typeof AMBIANCE_SUBS[number]
export type Context    = typeof CONTEXT_SUBS[number]
export type Outcome    = typeof OUTCOME_SUBS[number]
export type Severity   = typeof SEVERITY_VALUES[number]
export type Polarity   = typeof POLARITY_VALUES[number]

export type Axis =
  | 'touchpoint'
  | 'attribute'
  | 'product'
  | 'beverage'
  | 'ambiance'
  | 'context'
  | 'outcome'

export const AXES: Axis[] = [
  'touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome',
]

/**
 * Where this assertion came from.
 *   'keyword' — Tier 1 deterministic keyword matcher (lib/taxonomyKeywordMatcher.ts)
 *   'llm'     — Tier 2 LLM extractor (lib/taxonomyExtractor.ts)
 *   'both'    — emitted by Tier 1 AND confirmed by Tier 2 on the same axis:sub
 */
export type AssertionSource = 'keyword' | 'llm' | 'both'

export interface Assertion {
  axis: Axis
  sub: string
  item?: string
  polarity: Polarity
  confidence: number
  severity: Severity
  /** Short verbatim span from the review that triggered this assertion. */
  evidence?: string
  source?: AssertionSource
}

// Axis → set of allowed sub-bucket values. Used by the extractor's
// closed-vocab validator (drops anything not in the set).
export const AXIS_VOCAB: Record<Axis, readonly string[]> = {
  touchpoint: TOUCHPOINT_SUBS,
  attribute:  ATTRIBUTE_SUBS,
  product:    PRODUCT_SUBS,
  beverage:   BEVERAGE_SUBS,
  ambiance:   AMBIANCE_SUBS,
  context:    CONTEXT_SUBS,
  outcome:    OUTCOME_SUBS,
}

export function isValidAxisSub(axis: Axis, sub: string): boolean {
  return (AXIS_VOCAB[axis] as readonly string[]).includes(sub)
}

export function isAlertSeverity(s: string): s is Exclude<Severity, 'normal'> {
  return s === 'alert' || s === 'crisis'
}
