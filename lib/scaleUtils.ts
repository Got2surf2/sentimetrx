// lib/scaleUtils.ts
// Ordinal scale detection, intelligent mapping suggestions, and smart axis ordering.

import { SIGNAL_TIER_ORDER, SIGNAL_TIER_ORDER_REDDIT, SIGNAL_TIER_ORDER_SUBSTACK } from './signalTier'

// ── Known ordinal scales (canonical form, lowest to highest) ──────────────
// Each scale entry: [canonicalLabel, ...aliases]
// Detection matches against ALL aliases, not just the canonical form.

var SCALES: { name: string; points: { canonical: string; aliases: string[] }[] }[] = [
  { name: 'satisfaction-5', points: [
    { canonical: 'Very Dissatisfied', aliases: ['very dissatisfied', 'highly dissatisfied', 'extremely dissatisfied', 'very unsatisfied'] },
    { canonical: 'Dissatisfied', aliases: ['dissatisfied', 'unsatisfied', 'somewhat dissatisfied'] },
    { canonical: 'Neutral', aliases: ['neutral', 'neither satisfied nor dissatisfied', 'neither', 'neither agree nor disagree', 'neither satisfied or dissatisfied', 'neither dissatisfied nor satisfied', 'indifferent', 'mixed feelings'] },
    { canonical: 'Satisfied', aliases: ['satisfied', 'somewhat satisfied'] },
    { canonical: 'Very Satisfied', aliases: ['very satisfied', 'highly satisfied', 'extremely satisfied'] },
  ]},
  { name: 'agreement-5', points: [
    { canonical: 'Strongly Disagree', aliases: ['strongly disagree'] },
    { canonical: 'Disagree', aliases: ['disagree', 'somewhat disagree'] },
    { canonical: 'Neutral', aliases: ['neutral', 'neither', 'neither agree nor disagree', 'undecided'] },
    { canonical: 'Agree', aliases: ['agree', 'somewhat agree'] },
    { canonical: 'Strongly Agree', aliases: ['strongly agree'] },
  ]},
  { name: 'likelihood-5', points: [
    { canonical: 'Very Unlikely', aliases: ['very unlikely', 'extremely unlikely', 'highly unlikely'] },
    { canonical: 'Unlikely', aliases: ['unlikely', 'somewhat unlikely'] },
    { canonical: 'Neutral', aliases: ['neutral', 'neither likely nor unlikely', 'undecided'] },
    { canonical: 'Likely', aliases: ['likely', 'somewhat likely'] },
    { canonical: 'Very Likely', aliases: ['very likely', 'extremely likely', 'highly likely', 'definitely'] },
  ]},
  { name: 'frequency-5', points: [
    { canonical: 'Never', aliases: ['never', 'not at all'] },
    { canonical: 'Rarely', aliases: ['rarely', 'seldom', 'almost never'] },
    { canonical: 'Sometimes', aliases: ['sometimes', 'occasionally'] },
    { canonical: 'Often', aliases: ['often', 'frequently', 'most of the time'] },
    { canonical: 'Always', aliases: ['always', 'all the time', 'every time'] },
  ]},
  { name: 'quality-perf-5', points: [
    { canonical: 'Poor',      aliases: ['poor', 'bad'] },
    { canonical: 'Fair',      aliases: ['fair'] },
    { canonical: 'Average',   aliases: ['average', 'okay', 'ok', 'adequate'] },
    { canonical: 'Good',      aliases: ['good', 'above average'] },
    { canonical: 'Excellent', aliases: ['excellent', 'outstanding', 'exceptional', 'very good', 'great', 'superb'] },
  ]},
  { name: 'quality-5', points: [
    { canonical: 'Very Poor', aliases: ['very poor', 'terrible', 'awful'] },
    { canonical: 'Poor', aliases: ['poor', 'bad'] },
    { canonical: 'Fair', aliases: ['fair', 'okay', 'ok', 'adequate'] },
    { canonical: 'Good', aliases: ['good', 'above average'] },
    { canonical: 'Excellent', aliases: ['excellent', 'outstanding', 'exceptional', 'very good', 'great', 'superb'] },
  ]},
  { name: 'importance-5', points: [
    { canonical: 'Not Important', aliases: ['not important', 'not at all important', 'unimportant'] },
    { canonical: 'Slightly Important', aliases: ['slightly important', 'a little important'] },
    { canonical: 'Moderately Important', aliases: ['moderately important', 'somewhat important'] },
    { canonical: 'Important', aliases: ['important', 'quite important'] },
    { canonical: 'Very Important', aliases: ['very important', 'extremely important', 'critically important'] },
  ]},
  { name: 'yes-no', points: [
    { canonical: 'No', aliases: ['no', 'false', '0'] },
    { canonical: 'Yes', aliases: ['yes', 'true', '1'] },
  ]},
  { name: 'size-4', points: [
    { canonical: 'Small', aliases: ['small', 'very small', 'tiny'] },
    { canonical: 'Medium', aliases: ['medium', 'moderate', 'average'] },
    { canonical: 'Large', aliases: ['large', 'big'] },
    { canonical: 'Very Large', aliases: ['very large', 'huge', 'massive'] },
  ]},
  { name: 'priority-3', points: [
    { canonical: 'Low', aliases: ['low', 'minor'] },
    { canonical: 'Medium', aliases: ['medium', 'moderate', 'normal'] },
    { canonical: 'High', aliases: ['high', 'critical', 'urgent'] },
  ]},
  { name: 'difficulty-5', points: [
    { canonical: 'Very Easy', aliases: ['very easy', 'extremely easy'] },
    { canonical: 'Easy', aliases: ['easy', 'somewhat easy'] },
    { canonical: 'Moderate', aliases: ['moderate', 'neutral', 'neither easy nor difficult'] },
    { canonical: 'Difficult', aliases: ['difficult', 'hard', 'somewhat difficult'] },
    { canonical: 'Very Difficult', aliases: ['very difficult', 'extremely difficult', 'very hard'] },
  ]},
  { name: 'amount-5', points: [
    { canonical: 'Much Less', aliases: ['much less', 'far less', 'significantly less'] },
    { canonical: 'Less', aliases: ['less', 'somewhat less', 'a little less'] },
    { canonical: 'About the Same', aliases: ['about the same', 'same', 'no change', 'unchanged'] },
    { canonical: 'More', aliases: ['more', 'somewhat more', 'a little more'] },
    { canonical: 'Much More', aliases: ['much more', 'far more', 'significantly more'] },
  ]},
  { name: 'nps-3', points: [
    { canonical: 'Detractor', aliases: ['detractor', 'detractors'] },
    { canonical: 'Passive', aliases: ['passive', 'passives', 'neutral'] },
    { canonical: 'Promoter', aliases: ['promoter', 'promoters'] },
  ]},
]

// ── Match a value against a scale point (exact then fuzzy) ────────────────
function matchPointExact(value: string, point: { canonical: string; aliases: string[] }): boolean {
  var lower = value.toLowerCase().trim()
  return point.aliases.some(function(a) { return lower === a })
}

function matchPointFuzzy(value: string, point: { canonical: string; aliases: string[] }): boolean {
  var lower = value.toLowerCase().trim()
  // Partial match — value contains the canonical, but NOT a substring of another word
  var canon = point.canonical.toLowerCase()
  if (lower.includes(canon) && lower.length < canon.length * 3) return true
  // Also check if canonical contains value (e.g. value="satisfied", canonical="very satisfied")
  // but only if value is sufficiently long (4+ chars) to avoid false positives
  return false
}

// ── Detect which known scale a set of values matches ──────────────────────
export function detectScale(values: string[]): string[] | null {
  if (!values || values.length < 2) return null

  var bestScale: string[] | null = null
  var bestHits = 0

  for (var s = 0; s < SCALES.length; s++) {
    var scale = SCALES[s]
    var matched: { value: string; idx: number }[] = []
    var usedIndices = new Set<number>()
    var usedValues = new Set<string>()

    // Pass 1: exact alias matches only (highest confidence)
    values.forEach(function(v) {
      if (usedValues.has(v)) return
      for (var p = 0; p < scale.points.length; p++) {
        if (usedIndices.has(p)) continue
        if (matchPointExact(v, scale.points[p])) {
          matched.push({ value: v, idx: p })
          usedIndices.add(p)
          usedValues.add(v)
          return
        }
      }
    })

    // Pass 2: fuzzy matches for remaining values
    values.forEach(function(v) {
      if (usedValues.has(v)) return
      for (var p = 0; p < scale.points.length; p++) {
        if (usedIndices.has(p)) continue
        if (matchPointFuzzy(v, scale.points[p])) {
          matched.push({ value: v, idx: p })
          usedIndices.add(p)
          usedValues.add(v)
          return
        }
      }
    })

    if (matched.length >= 2 && matched.length > bestHits) {
      // Sort matched values by their scale position
      matched.sort(function(a, b) { return a.idx - b.idx })
      var ordered = matched.map(function(m) { return m.value })
      // Add unmatched values at the end
      var matchedValues = new Set(ordered)
      var remaining = values.filter(function(v) { return !matchedValues.has(v) })
      bestScale = ordered.concat(remaining)
      bestHits = matched.length
    }
  }

  return bestScale
}

// ── Order by numeric remapping if available ───────────────────────────────
export function orderByRemapping(values: string[], remapping: Record<string, number>): string[] {
  if (!remapping || Object.keys(remapping).length === 0) return values
  return values.slice().sort(function(a, b) {
    var na = remapping[a], nb = remapping[b]
    if (na != null && nb != null) return na - nb
    if (na != null) return -1
    if (nb != null) return 1
    return a.localeCompare(b)
  })
}

// ── Smart ordering for chart axes ─────────────────────────────────────────
export function smartOrder(values: string[], remapping?: Record<string, number>): string[] {
  // Priority 1: use explicit numeric remapping
  if (remapping && Object.keys(remapping).length >= 2) {
    return orderByRemapping(values, remapping)
  }

  // Priority 2: signal tier canonical order (detect Reddit vs Substack by tier names)
  // Reversed so highest tier renders at the top of horizontal bar charts (Plotly draws bottom-up)
  var redditSet = new Set(SIGNAL_TIER_ORDER_REDDIT)
  var substackSet = new Set(SIGNAL_TIER_ORDER_SUBSTACK)
  if (values.length >= 2 && values.every(function(v) { return redditSet.has(v) })) {
    return SIGNAL_TIER_ORDER_REDDIT.filter(function(t) { return values.includes(t) }).reverse()
  }
  if (values.length >= 2 && values.every(function(v) { return substackSet.has(v) })) {
    return SIGNAL_TIER_ORDER_SUBSTACK.filter(function(t) { return values.includes(t) }).reverse()
  }

  // Priority 3: detect known ordinal scale
  var detected = detectScale(values)
  if (detected) return detected

  // Priority 3: try pure numeric sort
  var allNumeric = values.every(function(v) { return !isNaN(Number(v)) && v.trim() !== '' })
  if (allNumeric) return values.slice().sort(function(a, b) { return Number(a) - Number(b) })

  // Default alphabetical
  return values.slice().sort()
}

// ── Intelligent mapping suggestions for categorical → numeric ─────────────
export function suggestMapping(values: string[]): Record<string, number> | null {
  if (!values || values.length < 2) return null

  var detected = detectScale(values)
  if (detected) {
    var map: Record<string, number> = {}
    detected.forEach(function(v, i) {
      map[v] = i + 1
    })
    return map
  }

  // Try pure numeric values
  var allNumeric = values.every(function(v) { return !isNaN(Number(v)) && v.trim() !== '' })
  if (allNumeric) {
    var numMap: Record<string, number> = {}
    values.forEach(function(v) { numMap[v] = Number(v) })
    return numMap
  }

  return null
}

// ── Check if a value set looks like a known scale ─────────────────────────
export function isOrdinalScale(values: string[]): boolean {
  return detectScale(values) !== null
}

// ── Get scale direction label ─────────────────────────────────────────────
export function scaleDirectionLabel(values: string[]): string | null {
  var detected = detectScale(values)
  if (!detected || detected.length < 2) return null
  return detected[0] + ' \u2192 ' + detected[detected.length - 1]
}
