// lib/dimensionFields.ts
// Shared helpers for exposing taxonomy ("Dimensions") axes as synthetic
// categorical fields in Charts / Stats. A dimension field is named
// `__dim_<axis>__` (e.g. `__dim_product__`) and its values are the axis
// sub-buckets (steak, seafood, …). Unlike `__themes__` (re-derived from row
// text client-side), dimension values are aggregated server-side from the
// verdicts embedded in dataset_rows_flat.data._tx (sql/151) via the tax_*
// /aggregate ops — client re-derivation of the 250+ keyword dictionary is too
// slow (~30s/50K rows).

import { ALL_AXES, type Axis } from './taxonomyVocabulary'

export type { Axis }
// All embeddable axes: the 7 ABSA axes + the keyword-tier `emotion` axis
// (emotion-language flags, lib/emotionFlags.ts — expressed-language framing).
export const DIM_AXES = ALL_AXES

export const DIM_AXIS_LABEL: Record<Axis, string> = {
  touchpoint: 'Touchpoint',
  attribute:  'Attribute',
  product:    'Product',
  beverage:   'Beverage',
  ambiance:   'Ambiance',
  context:    'Context',
  outcome:    'Outcome',
  emotion:    'Emotion Language',
}

// Verbose, customer-facing axis names. Single source of truth: the Dimensions tab
// pills/cards use these (taxonomyRollup re-exports this as AXIS_LABEL), and the
// chart picker shows the short DIM_AXIS_LABEL with THIS as the hover tooltip.
export const DIM_AXIS_LABEL_LONG: Record<Axis, string> = {
  touchpoint: 'Service — who served you',
  attribute:  'Staff & food attributes',
  product:    'Food — what they ate',
  beverage:   'Drinks — bar & wine',
  ambiance:   'Room — ambiance & décor',
  context:    'Occasion — when & why',
  outcome:    'Outcome — will they return',
  emotion:    'Emotion — disappointment, blame & churn-intent language',
}

// Per-axis identity color — the single source of truth for axis dots/chips
// everywhere Dimensions render: the Dimensions view (TaxonomyModule) pills +
// cards, and the theme-card / Theme-cloud "Dimensions" chip rows. Import this
// map rather than re-declaring the literals so the colors can never drift.
export const AXIS_COLOR: Record<Axis, string> = {
  touchpoint: '#0EA5E9',
  attribute:  '#8B5CF6',
  product:    '#EA580C',
  beverage:   '#0891B2',
  ambiance:   '#16A34A',
  context:    '#CA8A04',
  outcome:    '#DB2777',
  emotion:    '#DC2626',
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

// Canonical key for a (possibly multi-field) taxonomy classification. The
// per-field table's `field` column stores this: a single field is just its name;
// multiple selected open-ends combine (sorted, ' + '-joined) so the same set maps
// to the same stored classification regardless of selection order. Single-field
// keys are unchanged, so existing rows stay valid.
export function taxonomyFieldKey(fields: string[]): string {
  return [...(fields || [])].filter(Boolean).sort().join(' + ')
}

// The 7 synthetic categorical field defs to splice into a chart/stats field
// list when a dataset has taxonomy ("Dimensions") classification.
export function dimVirtualFields(): Array<{ field: string; type: 'categorical'; label: string }> {
  return DIM_AXES.map(function(a) {
    return { field: dimFieldName(a), type: 'categorical' as const, label: DIM_AXIS_LABEL[a] }
  })
}
