// lib/dimensionFields.ts
// Shared helpers for exposing taxonomy ("Dimensions") axes as synthetic
// categorical fields in Charts / Stats. A dimension field is named
// `__dim_<axis>__` (e.g. `__dim_product__`) and its values are the axis
// sub-buckets (steak, seafood, …). Unlike `__themes__` (re-derived from row
// text client-side), dimension values are aggregated server-side from the
// stored dataset_row_taxonomy tags via the tax_* /aggregate ops — client
// re-derivation of the 250+ keyword dictionary is too slow (~30s/50K rows).

import { AXES, type Axis } from './taxonomyVocabulary'

export type { Axis }
export const DIM_AXES = AXES

export const DIM_AXIS_LABEL: Record<Axis, string> = {
  touchpoint: 'Touchpoint',
  attribute:  'Attribute',
  product:    'Product',
  beverage:   'Beverage',
  ambiance:   'Ambiance',
  context:    'Context',
  outcome:    'Outcome',
}

export function dimFieldName(axis: Axis): string {
  return '__dim_' + axis + '__'
}

export function isDimField(field: string): boolean {
  return typeof field === 'string' && field.startsWith('__dim_') && field.endsWith('__')
}

// Returns the axis for a `__dim_<axis>__` field, or null if not a valid one.
export function axisOfDimField(field: string): Axis | null {
  if (!isDimField(field)) return null
  const a = field.slice('__dim_'.length, -'__'.length)
  return (DIM_AXES as readonly string[]).includes(a) ? (a as Axis) : null
}

// Title-case a sub label for display (subs are stored lowercase, e.g.
// 'food safety' -> 'Food Safety').
export function dimSubLabel(sub: string): string {
  return sub.replace(/\b\w/g, function(c) { return c.toUpperCase() })
}

// The 7 synthetic categorical field defs to splice into a chart/stats field
// list when a dataset has taxonomy ("Dimensions") classification.
export function dimVirtualFields(): Array<{ field: string; type: 'categorical'; label: string }> {
  return DIM_AXES.map(function(a) {
    return { field: dimFieldName(a), type: 'categorical' as const, label: DIM_AXIS_LABEL[a] }
  })
}
