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

// One-line definition + tiny example per Domain>Aspect. Shown inline in the
// review UI so labeling is "does this match the definition?" rather than guessing
// from a blank palette. Keyed by `${domain}>${aspect}`. The wording deliberately
// disambiguates the tricky overlaps (Taste vs Quality vs Preparation; Menu = the
// offering/variety, NOT a specific dish's execution).
export const REO_ASPECT_DEF: Record<string, string> = {
  // FoodBeverage — Quality = the food's inherent quality/freshness; Preparation =
  // what the kitchen DID to it (doneness/temp); Taste = flavor/seasoning judgment.
  'FoodBeverage>Taste':        'Flavor & seasoning judgment. e.g. "bland", "delicious", "too salty"',
  'FoodBeverage>Quality':      'Inherent food quality / freshness / cut. e.g. "frozen lobster", "not fresh", "tough cut"',
  'FoodBeverage>Preparation':  'Cooking execution: doneness, temp, over/undercooked. e.g. "overcooked", "served cold", "raw"',
  'FoodBeverage>Presentation': 'Plating / visual / how it arrives. e.g. "beautiful plate", "sizzling", "sloppy"',
  'FoodBeverage>Menu':         'The menu OFFERING/variety/options — NOT one dish. e.g. "few veg options", "no NA drinks", "seasonal menu"',
  'FoodBeverage>Portion':      'Amount / size of the serving. e.g. "tiny portion", "huge plate"',
  'FoodBeverage>Desserts':     'Dessert items specifically. e.g. "cheesecake", "bread pudding"',
  'FoodBeverage>Beverages':    'Drinks: cocktails, wine, beer, coffee. e.g. "watered-down martini", "great wine list"',
  // Service
  'Service>Friendliness':      'Warmth / courtesy / attitude. e.g. "rude", "so welcoming", "service is bland"',
  'Service>Attentiveness':     'Presence / checking in / refills. e.g. "never saw our server", "no water"',
  'Service>Professionalism':   'Competence / polish / conduct. e.g. "untrained", "unprofessional", "discriminated"',
  'Service>Knowledge':         'Menu/wine knowledge & recommendations. e.g. "great recommendations", "didn’t know the menu"',
  'Service>Responsiveness':    'Speed of acting on requests. e.g. "took forever", "drinks were slow"',
  'Service>Accuracy':          'Order correctness / requests honored. e.g. "wrong dish", "allergy not honored"',
  'Service>Recovery':          'How a complaint/mistake was HANDLED. e.g. "comped it", "manager argued", "snotty when I complained"',
  'Service>Management':        'Manager presence / conduct specifically. e.g. "GM visited table", "manager was rude"',
  // Environment
  'Environment>Ambiance':      'Overall vibe/atmosphere. e.g. "romantic", "generic", "warm"',
  'Environment>Cleanliness':   'Cleanliness & smell. e.g. "dirty restroom", "smells moldy"',
  'Environment>Noise':         'Noise / music volume / acoustics. e.g. "too loud", "couldn’t hear"',
  'Environment>Comfort':       'Seating comfort, spacing, temperature. e.g. "cramped", "freezing", "comfy booth"',
  'Environment>Design':        'Decor / look / fit-out. e.g. "nicely decorated", "feels like a sports bar", "needs remodel"',
  // Operations
  'Operations>WaitTime':       'Waiting: to be seated, for food, for the check. e.g. "40 min for entree", "slow"',
  'Operations>Reservations':   'Reservation handling/honoring. e.g. "seated late despite booking", "refused our reso"',
  'Operations>Ordering':       'Ease/flow of ordering, coursing, takeout flow. e.g. "apps & salad came together", "takeout"',
  'Operations>Payment':        'Checkout / payment / change. e.g. "didn’t give change", "slow to pay"',
  'Operations>Capacity':       'Staffing levels / crowding / turnover. e.g. "short staffed", "packed"',
  // Value
  'Value>Pricing':             'The price itself cited as grievance/praise. e.g. "$68 ribeye", "overpriced"',
  'Value>ValueForMoney':       'Worth-it verdict (price vs experience). e.g. "not worth it", "super mid"',
  'Value>Fees':                'Surcharges / service charges / hidden fees. e.g. "service charge", "hidden fee"',
  // Access
  'Access>Parking':            'Parking availability/cost. e.g. "no parking", "valet"',
  'Access>Transit':            'Public transit / walkability. e.g. "near the train", "hard to reach"',
  'Access>Safety':             'Neighborhood/area safety, lighting. e.g. "sketchy area", "well-lit lot"',
  'Access>Convenience':        'Location convenience / hours. e.g. "great location", "closed early"',
  // Digital
  'Digital>Website':           'Website experience. e.g. "site wouldn’t load"',
  'Digital>MobileApp':         'Mobile app experience. e.g. "app crashed"',
  'Digital>OnlineOrdering':    'Online/app ordering flow. e.g. "online order was wrong"',
  'Digital>DigitalPayments':   'Digital/contactless payment. e.g. "couldn’t pay by app"',
  // CustomerRelationship
  'CustomerRelationship>Recognition':    'Being recognized/made to feel special (esp. first-time/occasion). e.g. "made us feel special", "ignored on our anniversary"',
  'CustomerRelationship>Loyalty':        'Return/recommend intent. e.g. "won’t be back", "we’ll return"',
  'CustomerRelationship>Personalization':'Tailored touches to this guest. e.g. "remembered our usual"',
  'CustomerRelationship>Community':      'Local engagement / events / regulars culture. e.g. "great with locals"',
  // Brand
  'Brand>Reputation':          'Overall reputation / recommend-to-others. e.g. "never recommend", "best in town"',
  'Brand>Trust':               'Trust / fairness / integrity. e.g. "felt discriminated", "honest"',
  'Brand>Consistency':         'Consistency vs prior visits/locations. e.g. "not the same anymore", "by far the worst location"',
  'Brand>Identity':            'Brand identity / what it stands for. e.g. "lost its character"',
  // Occasion (visit context — usually Neutral)
  'Occasion>EverydayMeal':     'Routine / casual meal',
  'Occasion>DateNight':        'Date night',
  'Occasion>FamilyDinner':     'Family meal',
  'Occasion>BusinessMeeting':  'Business / work meal',
  'Occasion>Celebration':      'General celebration',
  'Occasion>Birthday':         'Birthday visit',
  'Occasion>Anniversary':      'Anniversary visit',
  'Occasion>GroupEvent':       'Large group / party',
  'Occasion>QuickLunch':       'Quick lunch',
  'Occasion>TakeoutOnly':      'Takeout / to-go only',
}

export function aspectDef(domain: string, aspect: string): string {
  return REO_ASPECT_DEF[`${domain}>${aspect}`] || ''
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
