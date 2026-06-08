// lib/reoVocabulary.ts
//
// Restaurant Experience Ontology (REO) — LEAN CUT vocabulary.
// Scope per the 2026-06-08 owner decision: Domain > Aspect + Sentiment only.
// The fine Concept layer, Emotion layer, and Journey layer from the full REO
// spec are deliberately OUT of this cut (deferred to a later experimental v2).
//
// This is the closed vocabulary the gold-set review UI labels against, and the
// eventual target taxonomy for the classifier. It is intentionally separate from
// the legacy 7-axis lib/taxonomyVocabulary.ts (which still drives production);
// the two coexist until the REO migration lands.

export const REO_DOMAINS = [
  'FoodBeverage',
  'Service',
  'Environment',
  'Operations',
  'Value',
  'Access',
  'Digital',
  'CustomerRelationship',
  'Brand',
  'Occasion',
] as const

export type ReoDomain = typeof REO_DOMAINS[number]

// Domain → allowed Aspect values. The Occasion domain has no Aspect layer in the
// full spec (it jumps straight to concepts); for the lean Domain>Aspect model we
// surface the occasion types as its aspects so it stays labelable.
export const REO_ASPECTS: Record<ReoDomain, readonly string[]> = {
  FoodBeverage:         ['Taste', 'Quality', 'Preparation', 'Presentation', 'Menu', 'Portion', 'Desserts', 'Beverages'],
  Service:              ['Friendliness', 'Attentiveness', 'Professionalism', 'Knowledge', 'Responsiveness', 'Accuracy', 'Recovery', 'Management'],
  Environment:          ['Ambiance', 'Cleanliness', 'Noise', 'Comfort', 'Design'],
  Operations:           ['WaitTime', 'Reservations', 'Ordering', 'Payment', 'Capacity'],
  Value:                ['Pricing', 'ValueForMoney', 'Fees'],
  Access:               ['Parking', 'Transit', 'Safety', 'Convenience'],
  Digital:              ['Website', 'MobileApp', 'OnlineOrdering', 'DigitalPayments'],
  CustomerRelationship: ['Recognition', 'Loyalty', 'Personalization', 'Community'],
  Brand:                ['Reputation', 'Trust', 'Consistency', 'Identity'],
  Occasion:             ['EverydayMeal', 'DateNight', 'FamilyDinner', 'BusinessMeeting', 'Celebration', 'Birthday', 'Anniversary', 'GroupEvent', 'QuickLunch', 'TakeoutOnly'],
}

export const REO_SENTIMENTS = ['Positive', 'Negative', 'Neutral'] as const
export type ReoSentiment = typeof REO_SENTIMENTS[number]

// Cross-cutting severity, NOT an aspect. 'crisis' = food safety / allergy / injury /
// discrimination-grade; 'alert' = sharp dissatisfaction. Kept so the REO migration
// never loses the escalation signal the legacy system carried.
export const REO_SEVERITIES = ['none', 'alert', 'crisis'] as const
export type ReoSeverity = typeof REO_SEVERITIES[number]

// One labeled observation. A review yields zero or more of these (multi-label).
export interface ReoObservation {
  domain:    ReoDomain
  aspect:    string
  sentiment: ReoSentiment
  /** Shortest verbatim span from the review that triggered this observation. */
  evidence?: string
  severity?: ReoSeverity
  /** Optional labeler note (judgment call, ambiguity, guidance). */
  note?:     string
}

export function isValidDomain(d: string): d is ReoDomain {
  return (REO_DOMAINS as readonly string[]).includes(d)
}

export function isValidDomainAspect(domain: string, aspect: string): boolean {
  if (!isValidDomain(domain)) return false
  return REO_ASPECTS[domain].includes(aspect)
}

// Stable per-domain colors for pills/badges in the review UI.
export const REO_DOMAIN_COLOR: Record<ReoDomain, string> = {
  FoodBeverage:         '#E8632A', // orange
  Service:              '#0EA5E9', // sky
  Environment:          '#16A34A', // green
  Operations:           '#7C3AED', // violet
  Value:                '#CA8A04', // amber
  Access:               '#0D9488', // teal
  Digital:              '#2563EB', // blue
  CustomerRelationship: '#DB2777', // pink
  Brand:                '#9333EA', // purple
  Occasion:             '#64748B', // slate
}
