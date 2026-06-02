// lib/taxonomyMapping.ts
//
// Map a raw legacy Classification label (from the prospect's CSV) to a
// canonical taxonomy assertion or quarantine bucket. The mapping is a coarse
// first-pass projection: it covers the known parent-label patterns. Anything
// novel falls into `_unmapped` for the LLM extractor to resolve (or for
// monthly triage).
//
// Why this exists at all (since the LLM will read the verbatim text):
//   1. Audit trail — every legacy label maps somewhere we can defend.
//   2. Validation — the LLM's emissions are compared against the legacy
//      projection on the same row; agreement increases confidence.
//   3. Cold-start filtering — for the side-by-side viewer before the
//      classifier has run on a given row, we can still surface legacy tags.
//
// Per project_rc_taxonomy_pilot.md "229 legacy labels" findings:
//   - Case duplicates: 'Menu - Salads' vs 'menu - salads' → canonicalize.
//   - Three parallel parents for service: Service-X / SERV-X / Staff-X.
//   - TEST (~21% of rows) → quarantine to system_tags.
//   - Alert - Food Safety has false-alarms (Burger King, gnats, dirty
//     carpets) — the mapping emits attribute=food safety + severity=alert
//     but the LLM is responsible for downgrading when the text doesn't
//     support food-safety semantics.

import type { Axis, Severity } from './taxonomyVocabulary'

export type Quarantine = 'campaign_tags' | 'system_tags' | 'competitor_menu' | '_unmapped'

export interface LegacyAssertion {
  axis: Axis
  sub: string
  item?: string
  severity: Severity
}

export interface MappingResult {
  // Either an assertion (or list) maps the label into the 7-axis model,
  // or it goes into one of the quarantine buckets.
  assertions: LegacyAssertion[]
  quarantine?: Quarantine
  raw: string
  canonical: string
}

// ── Canonicalization ─────────────────────────────────────────────────────────

/**
 * Lowercase, collapse whitespace, normalize delimiter ` - ` (handles `Menu-X`,
 * `Menu - X`, `menu - X` → `menu - x`). Trim trailing punctuation.
 */
export function canonicalizeLegacyLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/[.,;]$/, '')
    .trim()
}

// ── Pattern matchers (ordered: most specific first) ──────────────────────────

const MENU_SUBS: Record<string, { sub: string; item?: string }> = {
  'sides': { sub: 'sides' },
  'side dishes': { sub: 'sides' },
  'side dishes & vegetables': { sub: 'sides' },
  'appetizers': { sub: 'apps' },
  'apps': { sub: 'apps' },
  'desserts': { sub: 'desserts' },
  'dessert': { sub: 'desserts' },
  'salads': { sub: 'salads' },
  'salad': { sub: 'salads' },
  'soup': { sub: 'soup' },
  'soups': { sub: 'soup' },
  'seafood': { sub: 'seafood' },
  'pasta': { sub: 'pasta' },
  'beef': { sub: 'beef' },
  'pork': { sub: 'pork' },
  'chicken': { sub: 'chicken' },
  'kids': { sub: 'kids' },
  'breakfast': { sub: 'breakfast' },
  'bread': { sub: 'bread' },
  'condiments': { sub: 'condiments' },
  'fries': { sub: 'fries' },
  'steak': { sub: 'steak' },
  'steaks': { sub: 'steak' },
  'filet': { sub: 'steak', item: 'filet' },
  'ribeye': { sub: 'steak', item: 'ribeye' },
  'ny strip': { sub: 'steak', item: 'ny strip' },
  'porterhouse': { sub: 'steak', item: 'porterhouse' },
  't-bone': { sub: 'steak', item: 't-bone' },
  'sirloin': { sub: 'steak', item: 'sirloin' },
  'prime rib': { sub: 'steak', item: 'prime rib' },
  'turkey': { sub: 'chicken' },        // closest match — pilot vocab lacks turkey
  'veal': { sub: 'beef' },             // ditto
  'lamb': { sub: 'beef' },             // ditto
  'calamari': { sub: 'apps' },
  // unmapped (food category but outside closed vocab) falls through
}

const ATTRIBUTE_SUBS: Record<string, string> = {
  'flavor': 'flavor',
  'taste': 'flavor',
  'speed': 'speed',
  'attentive': 'attentive',
  'attentiveness': 'attentive',
  'clean': 'clean',
  'cleanliness': 'clean',
  'knowledge': 'knowledge',
  'knowledgeable': 'knowledge',
  'accuracy': 'accuracy',
  'accurate': 'accuracy',
  'pace': 'pace',
  'temp': 'temp',
  'temperature': 'temp',
  'portion': 'portion',
  'portions': 'portion',
  'presentation': 'presentation',
  'professional': 'professional',
  'professionalism': 'professional',
  'friendly': 'friendly',
  'friendliness': 'friendly',
  'food safety': 'food safety',
  'pests': 'pests',
  'rude': 'rude',
  'rudeness': 'rude',
  // Cross-brand vendor scheme additions (2026-06-02).
  'quality': 'quality',
  'prep': 'prep',
  'menu variety': 'menu variety',
  'eighty-sixed': 'eighty-sixed',
  'eighty sixed': 'eighty-sixed',
  'eighty - sixed': 'eighty-sixed',   // canonicalizer splits the internal hyphen
  '86ed': 'eighty-sixed',
  'experience': 'experience',
  'sequence': 'sequence',
  'ziosk': 'ziosk',
}

const AMBIANCE_SUBS: Record<string, string> = {
  'noise': 'noise',
  'noisy': 'noise',
  'light': 'light',
  'lighting': 'light',
  'music': 'music',
  'decor': 'decor',
  'décor': 'decor',
  'clean': 'clean',
  'cleanliness': 'clean',
  'location': 'location',
  'odor': 'odor',
  'smell': 'odor',
  'dress code': 'dress code',
  'safety': 'safety',
  'appearance': 'appearance',
  'tv': 'tv',
}

const BEVERAGE_SUBS: Record<string, string> = {
  'wine': 'wine',
  'wine list': 'wine',
  'cocktail': 'cocktail',
  'cocktails': 'cocktail',
  'beer': 'beer',
  'nab': 'nab',
  'na': 'nab',
  'coffee': 'coffee',
  'champagne': 'champagne',
  'martini': 'martini',
  'margarita': 'margarita',
  'tea': 'tea',
  'sangria': 'sangria',
  'milkshakes': 'milkshakes',
  'milkshake': 'milkshakes',
  // Cross-brand vendor scheme additions (2026-06-02).
  'alcohol': 'alcohol',
  'assort': 'assortment',
  'assort.': 'assortment',
  'assortment': 'assortment',
  'flavor': 'flavor',
}

const OUTCOME_SUBS: Record<string, string> = {
  'value': 'expensive',           // legacy "Value" tag without qualifier — coarse default
  'expensive': 'expensive',
  'affordable': 'affordable',
  'discount': 'discount',
  'price increase': 'price-increase',
  'return': 'return',
  'recommend': 'recommend',
  'not recommend': 'not-recommend',
  'loyalty': 'loyalty',
  'frequency': 'frequency',
  'check-in': 'check-in',
  'brand love': 'brand-love',
  'ior': 'return',
  'improvement': 'improvement',
  'check in': 'check-in',   // vendor scheme: IOR - Check in (space variant)
}

// Daypart / holiday / occasion / channel labels → context axis.
const DAYPART_SUBS: Record<string, string> = {
  'breakfast': 'breakfast', 'lunch': 'lunch', 'dinner': 'dinner',
  'happy hour': 'happy-hour', 'happy-hour': 'happy-hour',
  'latenight': 'late-night', 'late night': 'late-night', 'late-night': 'late-night',
}
const HOLIDAY_SUBS: Record<string, string> = {
  'christmas': 'christmas', "valentine's day": 'valentines', 'valentines day': 'valentines',
  "valentine's": 'valentines', "mother's day": 'mothers-day', 'mothers day': 'mothers-day',
  "father's day": 'fathers-day', 'fathers day': 'fathers-day',
  'easter': 'easter', 'thanksgiving': 'thanksgiving',
  "new year's": 'new-years', 'new years': 'new-years', "new year's eve": 'new-years',
}
// NOTE: canonicalizeLegacyLabel turns internal hyphens into " - " (e.g.
// "to-go" → "to - go"), so the split variants are included alongside.
const CHANNEL_SUBS: Record<string, string> = {
  'to-go': 'to-go', 'to go': 'to-go', 'togo': 'to-go', 'to - go': 'to-go',
  'total off premise': 'to-go', 'off premise': 'to-go', 'off-premise': 'to-go', 'off - premise': 'to-go',
  'delivery': 'delivery', 'catering': 'catering', 'doordash': 'doordash',
  'uber-eats': 'uber-eats', 'uber eats': 'uber-eats', 'uber - eats': 'uber-eats',
  'curbside': 'curbside', 'drive-thru': 'drive-thru', 'drive - thru': 'drive-thru',
}

// Steak cut labels → product:steak (+ item where in closed vocab).
// Split-hyphen variants ("t - bone") included — see CHANNEL_SUBS note.
const STEAK_ITEMS: Record<string, string | null> = {
  'filet': 'filet', 'ny strip': 'ny strip', 'porterhouse': 'porterhouse',
  'ribeye': 'ribeye', 'ribeye bone-in': 'ribeye', 'ribeye bone - in': 'ribeye', 'bone-in ribeye': 'ribeye',
  'sirloin': 'sirloin', 't-bone': 't-bone', 't - bone': 't-bone', 'prime rib': 'prime rib',
  'tomahawk': 'tomahawk', 'all steak cuts': null,
}

const TOUCHPOINT_ROLES = ['server', 'manager', 'host', 'bartender', 'busser', 'chef', 'sommelier', 'cashier', 'delivery']
/** Resolve a service-label sub to a touchpoint role, or null. Normalizes the
 *  vendor's combined "Busser Janitor" label to busser. */
function normRole(s: string): string | null {
  const r = s.replace(/\s*\/\s*/g, ' ').trim()
  if (r === 'busser janitor' || r === 'janitor') return 'busser'
  if (TOUCHPOINT_ROLES.includes(r)) return r
  return null
}

// Competitor prefixes — quarantined.
const COMPETITOR_PREFIXES = ['lh menu', 'og menu', 'csk menu', 'darden']

// Campaign-tag patterns — quarantined.
function isCampaignTag(canon: string): boolean {
  return (
    canon.includes('plateware') ||
    canon.includes('moet tastemaker') ||
    canon.includes("mother's day corrected") ||
    canon.includes('mothers day corrected') ||
    canon.includes('gift cards 11/10') ||
    canon.includes('super bowl 2022') ||
    canon.includes('butcher & baker test') ||
    canon.includes('generous pour') ||   // Olive Garden wine promotion
    canon === '$10 off' ||
    canon === 'reopen'
  )
}

// System / QA-leak labels — quarantined.
function isSystemTag(canon: string): boolean {
  return canon === 'test' || canon === 'brand alert'
}

// ── Main mapping function ────────────────────────────────────────────────────

export function mapLegacyLabel(raw: string): MappingResult {
  const canon = canonicalizeLegacyLabel(raw)
  const result: MappingResult = { assertions: [], raw, canonical: canon }

  if (!canon) {
    result.quarantine = '_unmapped'
    return result
  }

  // Quarantine first — wins over any structural match.
  if (isSystemTag(canon)) {
    result.quarantine = 'system_tags'
    return result
  }
  if (isCampaignTag(canon)) {
    result.quarantine = 'campaign_tags'
    return result
  }
  if (COMPETITOR_PREFIXES.some(p => canon.startsWith(p))) {
    result.quarantine = 'competitor_menu'
    return result
  }

  // ── Alert family ─────────────────────────────────────────────────────────
  // 'alert - food safety' → attribute:food safety, severity:alert
  // 'alert - <attr>'      → attribute:<attr>, severity:alert
  if (canon.startsWith('alert - ')) {
    const sub = canon.slice('alert - '.length).trim()
    const attr = ATTRIBUTE_SUBS[sub] ?? ATTRIBUTE_SUBS[sub.replace(/s$/, '')]
    if (attr) {
      result.assertions.push({ axis: 'attribute', sub: attr, severity: 'alert' })
      return result
    }
    // unknown alert sub — drop to unmapped
    result.quarantine = '_unmapped'
    return result
  }

  // ── Service parallel parents ─────────────────────────────────────────────
  // service - x | serv - x | staff - x | staff-x → touchpoint:server + attribute:x (best-guess)
  // server / manager / host / bartender / busser / chef / sommelier / cashier as touchpoints
  const serviceMatch = canon.match(/^(service|serv|staff) - (.+)$/)
  if (serviceMatch) {
    const sub = serviceMatch[2].trim()
    // Touchpoint role embedded in label (e.g. 'serv - manager', 'serv - delivery',
    // 'serv - busser janitor') — resolve the specific role rather than collapsing
    // everything to server.
    const role = normRole(sub)
    if (role) {
      result.assertions.push({ axis: 'touchpoint', sub: role, severity: 'normal' })
      return result
    }
    const attr = ATTRIBUTE_SUBS[sub] ?? ATTRIBUTE_SUBS[sub.replace(/s$/, '')]
    if (attr) {
      result.assertions.push({ axis: 'touchpoint', sub: 'server', severity: 'normal' })
      result.assertions.push({ axis: 'attribute', sub: attr, severity: 'normal' })
      return result
    }
    result.assertions.push({ axis: 'touchpoint', sub: 'server', severity: 'normal' })
    return result
  }

  // ── Steak cuts (vendor scheme: 'steak - ribeye' etc.) ─────────────────────
  const steakMatch = canon.match(/^steak\s*-\s*(.+)$/)
  if (steakMatch) {
    const sub = steakMatch[1].trim()
    if (sub in STEAK_ITEMS) {
      const a: LegacyAssertion = { axis: 'product', sub: 'steak', severity: 'normal' }
      const item = STEAK_ITEMS[sub]
      if (item) a.item = item
      result.assertions.push(a)
      return result
    }
    result.assertions.push({ axis: 'product', sub: 'steak', severity: 'normal' })
    return result
  }

  // ── Intent on Return (vendor scheme: 'ior - return' etc.) ─────────────────
  const iorMatch = canon.match(/^ior - (.+)$/)
  if (iorMatch) {
    const sub = iorMatch[1].trim()
    const oc = OUTCOME_SUBS[sub] ?? OUTCOME_SUBS[sub.replace(/s$/, '')]
    if (oc) {
      result.assertions.push({ axis: 'outcome', sub: oc, severity: 'normal' })
      return result
    }
    result.quarantine = '_unmapped'
    return result
  }

  // ── Context: dayparts / holidays / occasions / channels ───────────────────
  const dayMatch = canon.match(/^dayparts?\s*-\s*(.+)$/)
  if (dayMatch) {
    const d = DAYPART_SUBS[dayMatch[1].trim()]
    if (d) { result.assertions.push({ axis: 'context', sub: d, severity: 'normal' }); return result }
    result.quarantine = '_unmapped'
    return result
  }
  if (DAYPART_SUBS[canon]) { result.assertions.push({ axis: 'context', sub: DAYPART_SUBS[canon], severity: 'normal' }); return result }
  if (HOLIDAY_SUBS[canon]) { result.assertions.push({ axis: 'context', sub: HOLIDAY_SUBS[canon], severity: 'normal' }); return result }
  if (CHANNEL_SUBS[canon]) { result.assertions.push({ axis: 'context', sub: CHANNEL_SUBS[canon], severity: 'normal' }); return result }
  if (canon === 'special occasions' || canon === 'special occasion') {
    result.assertions.push({ axis: 'context', sub: 'special-occasion', severity: 'normal' }); return result
  }
  if (canon === 'sporting event' || canon === 'sporting events') {
    result.assertions.push({ axis: 'context', sub: 'sporting-event', severity: 'normal' }); return result
  }

  // ── Menu family ──────────────────────────────────────────────────────────
  const menuMatch = canon.match(/^menu - (.+)$/) || canon.match(/^menu-(.+)$/)
  if (menuMatch) {
    const sub = menuMatch[1].trim()
    const m = MENU_SUBS[sub] ?? MENU_SUBS[sub.replace(/s$/, '')]
    if (m) {
      const a: LegacyAssertion = { axis: 'product', sub: m.sub, severity: 'normal' }
      if (m.item) a.item = m.item
      result.assertions.push(a)
      return result
    }
    result.quarantine = '_unmapped'
    return result
  }

  // ── Food - X ─────────────────────────────────────────────────────────────
  // 'food - flavor' / 'food - temp' / etc. → attribute axis
  // bare 'food' alone is too vague — quarantine to _unmapped
  if (canon === 'food') {
    result.quarantine = '_unmapped'
    return result
  }
  const foodMatch = canon.match(/^food - (.+)$/)
  if (foodMatch) {
    const sub = foodMatch[1].trim()
    const attr = ATTRIBUTE_SUBS[sub] ?? ATTRIBUTE_SUBS[sub.replace(/s$/, '')]
    if (attr) {
      result.assertions.push({ axis: 'attribute', sub: attr, severity: 'normal' })
      return result
    }
    result.quarantine = '_unmapped'
    return result
  }

  // ── Ambiance ─────────────────────────────────────────────────────────────
  if (canon === 'ambiance') {
    // Bare label — keep on the axis but with no sub-bucket commitment.
    // We choose 'decor' as the most common interpretation; LLM may revise.
    result.assertions.push({ axis: 'ambiance', sub: 'decor', severity: 'normal' })
    return result
  }
  const ambMatch = canon.match(/^ambiance - (.+)$/)
  if (ambMatch) {
    const sub = ambMatch[1].trim()
    const amb = AMBIANCE_SUBS[sub] ?? AMBIANCE_SUBS[sub.replace(/s$/, '')]
    if (amb) {
      result.assertions.push({ axis: 'ambiance', sub: amb, severity: 'normal' })
      return result
    }
    result.quarantine = '_unmapped'
    return result
  }

  // ── Beverage ─────────────────────────────────────────────────────────────
  const bevMatch = canon.match(/^(?:beverage|bev) - (.+)$/)
  if (bevMatch) {
    const sub = bevMatch[1].trim()
    const bev = BEVERAGE_SUBS[sub] ?? BEVERAGE_SUBS[sub.replace(/s$/, '')]
    if (bev) {
      result.assertions.push({ axis: 'beverage', sub: bev, severity: 'normal' })
      return result
    }
    result.quarantine = '_unmapped'
    return result
  }
  if (BEVERAGE_SUBS[canon]) {
    result.assertions.push({ axis: 'beverage', sub: BEVERAGE_SUBS[canon], severity: 'normal' })
    return result
  }

  // ── Outcome / Value ──────────────────────────────────────────────────────
  if (OUTCOME_SUBS[canon]) {
    result.assertions.push({ axis: 'outcome', sub: OUTCOME_SUBS[canon], severity: 'normal' })
    return result
  }
  const valMatch = canon.match(/^value - (.+)$/)
  if (valMatch) {
    const sub = valMatch[1].trim()
    const oc = OUTCOME_SUBS[sub] ?? OUTCOME_SUBS[sub.replace(/s$/, '')]
    if (oc) {
      result.assertions.push({ axis: 'outcome', sub: oc, severity: 'normal' })
      return result
    }
    result.assertions.push({ axis: 'outcome', sub: 'expensive', severity: 'normal' })
    return result
  }

  // ── Bare touchpoint role labels ─────────────────────────────────────────
  const bareRole = normRole(canon)
  if (bareRole) {
    result.assertions.push({ axis: 'touchpoint', sub: bareRole, severity: 'normal' })
    return result
  }

  // ── Bare attribute labels ───────────────────────────────────────────────
  if (ATTRIBUTE_SUBS[canon]) {
    result.assertions.push({ axis: 'attribute', sub: ATTRIBUTE_SUBS[canon], severity: 'normal' })
    return result
  }

  // ── Bare ambiance labels ────────────────────────────────────────────────
  if (AMBIANCE_SUBS[canon]) {
    result.assertions.push({ axis: 'ambiance', sub: AMBIANCE_SUBS[canon], severity: 'normal' })
    return result
  }

  result.quarantine = '_unmapped'
  return result
}

/**
 * Map every legacy label on a row. Aggregate assertions across all labels;
 * dedup by (axis, sub, item).
 */
export function mapLegacyLabels(rawLabels: string[]): {
  assertions: LegacyAssertion[]
  quarantine: Record<Quarantine, string[]>
  raw: string[]
  canonical: string[]
} {
  const quarantine: Record<Quarantine, string[]> = {
    campaign_tags: [],
    system_tags: [],
    competitor_menu: [],
    _unmapped: [],
  }
  const seen = new Set<string>()
  const assertions: LegacyAssertion[] = []
  const canonical: string[] = []

  for (const raw of rawLabels) {
    const r = mapLegacyLabel(raw)
    canonical.push(r.canonical)
    if (r.quarantine) quarantine[r.quarantine].push(r.canonical)
    for (const a of r.assertions) {
      const k = `${a.axis}|${a.sub}|${a.item ?? ''}|${a.severity}`
      if (seen.has(k)) continue
      seen.add(k)
      assertions.push(a)
    }
  }

  return { assertions, quarantine, raw: rawLabels, canonical }
}
