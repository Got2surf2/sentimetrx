// lib/filterUtils.ts
// Filter types and application function.
// Shared between client (TextMine, Charts, Stats) and server.

export interface CatFilter {
  type: 'cat'
  // 'include' = allowlist (keep rows whose value is in `values`).
  // 'exclude' = denylist (drop rows whose value is in `values`).
  // The modal picks 'exclude' when the user starts from "All" and unchecks
  // a few values, so long-tail values not visible in the top-N list still
  // pass. 'include' is used when the user clicks "None" then re-selects.
  // Old saved filters (no mode field) deserialize as 'include' for back-
  // compat, matching pre-refactor behavior.
  mode: 'include' | 'exclude'
  values: Set<string>
  excludeBlanks: boolean
}

export interface RangeFilter {
  type: 'range'
  values: [number, number]
  includeBlanks: boolean
}

export interface DateRangeFilter {
  type: 'daterange'
  values: [number, number] // timestamps
  includeBlanks: boolean
}

export type FieldFilter = CatFilter | RangeFilter | DateRangeFilter

export type Filters = Record<string, FieldFilter>

// Serializable versions (for JSON storage — Sets become arrays)
export interface SerializedCatFilter { type: 'cat'; mode?: 'include' | 'exclude'; values: string[]; excludeBlanks: boolean }
export interface SerializedRangeFilter { type: 'range'; values: [number, number]; includeBlanks: boolean }
export interface SerializedDateRangeFilter { type: 'daterange'; values: [number, number]; includeBlanks: boolean }
export type SerializedFilter = SerializedCatFilter | SerializedRangeFilter | SerializedDateRangeFilter
export type SerializedFilters = Record<string, SerializedFilter>

export function serializeFilters(filters: Filters): SerializedFilters {
  const out: SerializedFilters = {}
  Object.entries(filters).forEach(function(entry) {
    const field = entry[0], f = entry[1]
    if (f.type === 'cat') {
      out[field] = { type: 'cat', mode: f.mode, values: Array.from(f.values), excludeBlanks: f.excludeBlanks }
    } else if (f.type === 'range') {
      out[field] = { type: 'range', values: f.values, includeBlanks: f.includeBlanks }
    } else if (f.type === 'daterange') {
      out[field] = { type: 'daterange', values: f.values, includeBlanks: f.includeBlanks }
    }
  })
  return out
}

export function deserializeFilters(raw: SerializedFilters): Filters {
  const out: Filters = {}
  Object.entries(raw).forEach(function(entry) {
    const field = entry[0], f = entry[1]
    if (f.type === 'cat') {
      // Default to 'include' for filters serialized before mode existed —
      // matches their old applyFilters behavior so saved sessions don't
      // suddenly invert.
      out[field] = { type: 'cat', mode: f.mode || 'include', values: new Set(f.values), excludeBlanks: f.excludeBlanks }
    } else if (f.type === 'range') {
      out[field] = f as RangeFilter
    } else if (f.type === 'daterange') {
      out[field] = f as DateRangeFilter
    }
  })
  return out
}

function parseDate(s: string): Date | null {
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export function applyFilters(rows: Record<string, unknown>[], filters: Filters): Record<string, unknown>[] {
  if (!filters || !Object.keys(filters).length) return rows
  return rows.filter(function(r) {
    return Object.entries(filters).every(function(entry) {
      const field = entry[0], f = entry[1]
      const val = r[field]
      if (f.type === 'cat') {
        // Blank rows are governed solely by `excludeBlanks` (regardless of
        // mode) so the modal's "Include blanks" checkbox actually means what
        // it says.
        const isBlank = val == null || String(val).trim() === ''
        if (isBlank) return !f.excludeBlanks
        // mode='exclude': drop rows whose value is in the denylist (long-tail
        // values never present in the modal's top-N list still pass).
        // mode='include': keep only rows whose value is in the allowlist (so
        // "None" → pick a few" still works as expected).
        if (f.mode === 'exclude') return !f.values.has(String(val))
        return f.values.has(String(val))
      }
      if (f.type === 'range') {
        const n = parseFloat(String(val ?? ''))
        if (isNaN(n)) return f.includeBlanks !== false
        return n >= f.values[0] && n <= f.values[1]
      }
      if (f.type === 'daterange') {
        if (val == null || String(val).trim() === '') return f.includeBlanks !== false
        const dd = parseDate(String(val))
        if (!dd) return f.includeBlanks !== false
        const ts = dd.getTime()
        return ts >= f.values[0] && ts <= f.values[1]
      }
      return true
    })
  })
}

export function filterCount(filters: Filters): number {
  return Object.keys(filters).length
}

export function filterSummary(filters: Filters, aliases: Record<string, string>): string {
  if (!Object.keys(filters).length) return ''
  return Object.entries(filters).map(function(entry) {
    const field = entry[0], f = entry[1]
    const label = aliases[field] || field
    if (f.type === 'cat') {
      const vals = Array.from(f.values)
      const prefix = f.mode === 'exclude' ? 'not ' : ''
      if (vals.length <= 2) return label + ': ' + prefix + vals.join(', ')
      return label + ': ' + prefix + vals.length + ' values'
    }
    if (f.type === 'range') return label + ': ' + f.values[0] + '\u2013' + f.values[1]
    if (f.type === 'daterange') {
      const fmt = function(ts: number) { const d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() }
      return label + ': ' + fmt(f.values[0]) + '\u2013' + fmt(f.values[1])
    }
    return label
  }).join(' \u00B7 ')
}
