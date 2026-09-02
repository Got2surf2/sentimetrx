// lib/anaViewSpec.ts
// Ana's set_view handoff (2026-09-02, owner: when Ana's recommendation is "go
// apply this filter and open that view", she should OFFER to do it, not hand
// the analyst a to-do list). The tool's constrained spec converts here into
// the app's live Filters shape; the panel dispatches it and DatasetShell /
// TextMine apply. Pure + unit-tested.

import type { Filters, FieldFilter } from '@/lib/filterUtils'

export interface AnaViewFilterSpec {
  field: string
  type: 'cat' | 'range'
  values?: string[]
  min?: number
  max?: number
}

export interface AnaViewSpec {
  summary?: string
  tab?: 'textmine' | 'charts' | 'stats'
  textField?: string
  filters?: AnaViewFilterSpec[]
}

export const ANA_VIEW_TABS = ['textmine', 'charts', 'stats']

/** Convert Ana's filter specs into the app's live Filters shape; invalid
 *  entries are dropped rather than failing the whole handoff. */
export function viewSpecFilters(specs: unknown): Filters {
  const out: Filters = {}
  if (!Array.isArray(specs)) return out
  for (const raw of specs.slice(0, 12)) {
    if (typeof raw !== 'object' || raw === null) continue
    const o = raw as Record<string, unknown>
    const field = typeof o.field === 'string' ? o.field.trim() : ''
    if (!field) continue
    if (o.type === 'cat' && Array.isArray(o.values) && o.values.length > 0) {
      const values = (o.values as unknown[]).filter(function(v): v is string { return typeof v === 'string' }).slice(0, 100)
      if (values.length === 0) continue
      out[field] = { type: 'cat', mode: 'include', values: new Set(values), excludeBlanks: false } as FieldFilter
    } else if (o.type === 'range') {
      const min = Number(o.min)
      const max = Number(o.max)
      const lo = Number.isFinite(min) ? min : -Infinity
      const hi = Number.isFinite(max) ? max : Infinity
      if (lo === -Infinity && hi === Infinity) continue
      out[field] = { type: 'range', values: [Number.isFinite(min) ? min : -1e15, Number.isFinite(max) ? max : 1e15], includeBlanks: false } as FieldFilter
    }
  }
  return out
}
