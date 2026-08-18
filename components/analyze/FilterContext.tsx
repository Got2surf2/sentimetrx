'use client'
// components/analyze/FilterContext.tsx
// Shared filter state for TextMine, Charts, and Statistics.
// Wraps the dataset workspace so all modules access the same filters.
// Supports lockedFilters for location-scoped access (immutable, always applied)
// and a relative `period` (saved-view periods — docs/SAVED_VIEWS.md §3).

import { createContext, useContext, useState, useMemo } from 'react'
import { serializeFilters, deserializeFilters, serializedFiltersEqual, resolvePeriod, periodToDateFilter } from '@/lib/filterUtils'
import type { Filters, SerializedFilters, PeriodSpec } from '@/lib/filterUtils'

// The saved view currently loaded into the workspace. `filters`/`period` are the
// view's stored state; we diff the live ones against them to know whether the
// user has diverged ("modified"). See docs/SAVED_VIEWS.md §5.1.
interface ActiveView {
  id:      string
  name:    string
  filters: SerializedFilters
  period:  PeriodSpec | null
}

interface FilterContextValue {
  filters: Filters
  setFilters: (f: Filters | ((prev: Filters) => Filters)) => void
  lockedFilters: Filters
  setLockedFilters: (f: Filters) => void
  effectiveFilters: Filters    // lockedFilters + resolved period merged onto user filters
  showFilters: boolean
  setShowFilters: (v: boolean) => void
  // Relative period (stored as intent; resolved into a date filter at read time)
  period: PeriodSpec | null
  setPeriod: (p: PeriodSpec | null) => void
  // Saved views
  activeView: ActiveView | null
  loadView: (view: { id: string; name: string; filter_config: { filters?: SerializedFilters; period?: PeriodSpec | null } | null }) => void
  clearActiveView: () => void
  isViewDirty: boolean         // true once live filters/period diverge from the loaded view
}

function periodsEqual(a: PeriodSpec | null, b: PeriodSpec | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

var FilterCtx = createContext<FilterContextValue>({
  filters: {},
  setFilters: function() {},
  lockedFilters: {},
  setLockedFilters: function() {},
  effectiveFilters: {},
  showFilters: false,
  setShowFilters: function() {},
  period: null,
  setPeriod: function() {},
  activeView: null,
  loadView: function() {},
  clearActiveView: function() {},
  isViewDirty: false,
})

export function useFilters() { return useContext(FilterCtx) }

export function FilterProvider({ children }: { children: React.ReactNode }) {
  var [filters, setFilters] = useState<Filters>({})
  var [lockedFilters, setLockedFilters] = useState<Filters>({})
  var [showFilters, setShowFilters] = useState(false)
  var [period, setPeriod] = useState<PeriodSpec | null>(null)
  var [activeView, setActiveView] = useState<ActiveView | null>(null)

  // user filters → resolved period (re-resolves against "now", so "current
  // quarter" stays current) → locked filters (highest priority).
  var effectiveFilters = useMemo(function() {
    var base = Object.assign({}, filters)
    if (period && period.field) {
      // eslint-disable-next-line react-hooks/purity -- re-resolving against a fresh `now` is the POINT here (a relative period like 'current quarter' must stay current); a frozen timestamp would be the bug
      base[period.field] = periodToDateFilter(resolvePeriod(period.primary, { now: Date.now() }))
    }
    return Object.assign(base, lockedFilters)
  }, [filters, lockedFilters, period])

  function loadView(view: { id: string; name: string; filter_config: { filters?: SerializedFilters; period?: PeriodSpec | null } | null }) {
    var storedFilters = (view.filter_config && view.filter_config.filters) || {}
    var storedPeriod = (view.filter_config && view.filter_config.period) || null
    setFilters(deserializeFilters(storedFilters))
    setPeriod(storedPeriod)
    setActiveView({ id: view.id, name: view.name, filters: storedFilters, period: storedPeriod })
  }

  function clearActiveView() {
    setActiveView(null)
  }

  // Dirty = a view is loaded AND the live filters OR period no longer match its
  // stored config. Compares period INTENT (not the materialized range), so a
  // "current quarter" view doesn't read dirty just because the quarter rolled.
  var isViewDirty = useMemo(function() {
    if (!activeView) return false
    if (!periodsEqual(period, activeView.period)) return true
    return !serializedFiltersEqual(serializeFilters(filters), activeView.filters)
  }, [filters, period, activeView])

  return (
    <FilterCtx.Provider value={{
      filters: filters,
      setFilters: setFilters,
      lockedFilters: lockedFilters,
      setLockedFilters: setLockedFilters,
      effectiveFilters: effectiveFilters,
      showFilters: showFilters,
      setShowFilters: setShowFilters,
      period: period,
      setPeriod: setPeriod,
      activeView: activeView,
      loadView: loadView,
      clearActiveView: clearActiveView,
      isViewDirty: isViewDirty,
    }}>
      {children}
    </FilterCtx.Provider>
  )
}
