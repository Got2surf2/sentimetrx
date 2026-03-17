// lib/filterUtils.ts
// Filter types and application function.
// Shared between client (TextMine, Charts, Stats) and server.

export interface CatFilter {
  type: 'cat'
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
export interface SerializedCatFilter { type: 'cat'; values: string[]; excludeBlanks: boolean }
export interface SerializedRangeFilter { type: 'range'; values: [number, number]; includeBlanks: boolean }
export interface SerializedDateRangeFilter { type: 'daterange'; values: [number, number]; includeBlanks: boolean }
export type SerializedFilter = SerializedCatFilter | SerializedRangeFilter | SerializedDateRangeFilter
export type SerializedFilters = Record<string, SerializedFilter>

export function serializeFilters(filters: Filters): SerializedFilters {
  var out: SerializedFilters = {}
  Object.entries(filters).forEach(function(entry) {
    var field = entry[0], f = entry[1]
    if (f.type === 'cat') {
      out[field] = { type: 'cat', values: Array.from(f.values), excludeBlanks: f.excludeBlanks }
    } else if (f.type === 'range') {
      out[field] = { type: 'range', values: f.values, includeBlanks: f.includeBlanks }
    } else if (f.type === 'daterange') {
      out[field] = { type: 'daterange', values: f.values, includeBlanks: f.includeBlanks }
    }
  })
  return out
}

export function deserializeFilters(raw: SerializedFilters): Filters {
  var out: Filters = {}
  Object.entries(raw).forEach(function(entry) {
    var field = entry[0], f = entry[1]
    if (f.type === 'cat') {
      out[field] = { type: 'cat', values: new Set(f.values), excludeBlanks: f.excludeBlanks }
    } else if (f.type === 'range') {
      out[field] = f as RangeFilter
    } else if (f.type === 'daterange') {
      out[field] = f as DateRangeFilter
    }
  })
  return out
}

function parseDate(s: string): Date | null {
  var d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export function applyFilters(rows: Record<string, unknown>[], filters: Filters): Record<string, unknown>[] {
  if (!filters || !Object.keys(filters).length) return rows
  return rows.filter(function(r) {
    return Object.entries(filters).every(function(entry) {
      var field = entry[0], f = entry[1]
      var val = r[field]
      if (f.type === 'cat') {
        var str = (val == null || String(val).trim() === '') ? '(blank)' : String(val)
        if (str === '(blank)' && f.excludeBlanks) return false
        return f.values.has(str)
      }
      if (f.type === 'range') {
        var n = parseFloat(String(val ?? ''))
        if (isNaN(n)) return f.includeBlanks !== false
        return n >= f.values[0] && n <= f.values[1]
      }
      if (f.type === 'daterange') {
        if (val == null || String(val).trim() === '') return f.includeBlanks !== false
        var dd = parseDate(String(val))
        if (!dd) return f.includeBlanks !== false
        var ts = dd.getTime()
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
    var field = entry[0], f = entry[1]
    var label = aliases[field] || field
    if (f.type === 'cat') {
      var vals = Array.from(f.values)
      if (vals.length <= 2) return label + ': ' + vals.join(', ')
      return label + ': ' + vals.length + ' values'
    }
    if (f.type === 'range') return label + ': ' + f.values[0] + '\u2013' + f.values[1]
    if (f.type === 'daterange') {
      var fmt = function(ts: number) { var d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() }
      return label + ': ' + fmt(f.values[0]) + '\u2013' + fmt(f.values[1])
    }
    return label
  }).join(' \u00B7 ')
}


