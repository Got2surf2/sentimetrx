// lib/scaleUtils.ts
// Ordinal scale detection, intelligent mapping suggestions, and smart axis ordering.

// ── Known ordinal scales ──────────────────────────────────────────────────
var AGREE_SCALE = ['Strongly Disagree', 'Disagree', 'Neither', 'Neutral', 'Agree', 'Strongly Agree']
var FREQ_SCALE  = ['Never', 'Rarely', 'Sometimes', 'Often', 'Always']
var SAT_SCALE   = ['Very Dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very Satisfied']
var LIKE_SCALE  = ['Very Unlikely', 'Unlikely', 'Neutral', 'Likely', 'Very Likely']
var SAT5_SCALE  = ['Highly Dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Highly Satisfied']
var QUALITY_SCALE = ['Very Poor', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent']
var IMPORT_SCALE  = ['Not at all Important', 'Slightly Important', 'Moderately Important', 'Important', 'Very Important', 'Extremely Important']
var YES_NO_SCALE  = ['No', 'Yes']
var BOOL_SCALE    = ['False', 'True']
var SIZE_SCALE    = ['Very Small', 'Small', 'Medium', 'Large', 'Very Large']
var PRIORITY_SCALE = ['Low', 'Medium', 'High', 'Critical']

var ALL_SCALES = [
  AGREE_SCALE, FREQ_SCALE, SAT_SCALE, LIKE_SCALE, SAT5_SCALE,
  QUALITY_SCALE, IMPORT_SCALE, YES_NO_SCALE, BOOL_SCALE,
  SIZE_SCALE, PRIORITY_SCALE,
]

// ── Detect which known scale a set of values matches ──────────────────────
export function detectScale(values: string[]): string[] | null {
  if (!values || values.length < 2) return null
  var lower = values.map(function(v) { return v.toLowerCase().trim() })

  for (var i = 0; i < ALL_SCALES.length; i++) {
    var scale = ALL_SCALES[i]
    var hits = scale.filter(function(s) {
      return lower.some(function(v) { return v === s.toLowerCase() || v.includes(s.toLowerCase()) })
    })
    if (hits.length >= 2) {
      // Return the ordered subset that matches
      var ordered = scale.map(function(s) {
        return values.find(function(v) { return v.toLowerCase() === s.toLowerCase() || v.toLowerCase().includes(s.toLowerCase()) })
      }).filter(Boolean) as string[]
      var remaining = values.filter(function(v) { return !ordered.includes(v) })
      return ordered.concat(remaining)
    }
  }
  return null
}

// ── Smart ordering for chart axes ─────────────────────────────────────────
export function smartOrder(values: string[]): string[] {
  var detected = detectScale(values)
  if (detected) return detected

  // Try pure numeric sort
  var allNumeric = values.every(function(v) { return !isNaN(Number(v)) })
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

  // Try pure numeric values already
  var allNumeric = values.every(function(v) { return !isNaN(Number(v)) })
  if (allNumeric) {
    var numMap: Record<string, number> = {}
    values.forEach(function(v) { numMap[v] = Number(v) })
    return numMap
  }

  // No intelligent suggestion possible
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
  return detected[0] + ' → ' + detected[detected.length - 1]
}
