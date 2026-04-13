// lib/aliasUtils.ts
// Shared value-alias utilities used by Charts, TextMine, Filters, and Comments.
// Schema fields can define valueAliases: Record<string, string> that remap raw
// data values to user-friendly display labels.

interface AliasableField {
  field: string
  valueAliases?: Record<string, string>
}

/** Resolve a single value's alias for a given field. Returns the alias if one exists, else the original value. */
export function resolveAlias(field: string, value: string, schema: AliasableField[]): string {
  var f = schema.find(function(s) { return s.field === field })
  if (f && f.valueAliases) {
    var alias = f.valueAliases[value]
    if (alias) return alias
  }
  return value
}

/** Transform a counts object by applying value aliases to all keys. Merges counts when two raw keys map to the same alias. */
export function aliasedCounts(field: string, counts: Record<string, number>, schema: AliasableField[]): Record<string, number> {
  var f = schema.find(function(s) { return s.field === field })
  var aliases = f?.valueAliases
  if (!aliases || Object.keys(aliases).length === 0) return counts
  var out: Record<string, number> = {}
  Object.entries(counts).forEach(function(e) {
    var key = aliases![e[0]] || e[0]
    out[key] = (out[key] || 0) + e[1]
  })
  return out
}

/** Alias an array of values for a given field. */
export function aliasValues(field: string, values: string[], schema: AliasableField[]): string[] {
  var f = schema.find(function(s) { return s.field === field })
  if (!f || !f.valueAliases) return values
  var aliases = f.valueAliases
  return values.map(function(v) { return aliases[v] || v })
}

/** Build a lookup map of field → valueAliases for all fields that have aliases defined. */
export function buildAliasMap(schema: AliasableField[]): Record<string, Record<string, string>> {
  var map: Record<string, Record<string, string>> = {}
  schema.forEach(function(f) {
    if (f.valueAliases && Object.keys(f.valueAliases).length > 0) {
      map[f.field] = f.valueAliases
    }
  })
  return map
}
