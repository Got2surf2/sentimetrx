'use client'
// components/analyze/FilterContext.tsx
// Shared filter state for TextMine, Charts, and Statistics.
// Wraps the dataset workspace so all modules access the same filters.
// Supports lockedFilters for location-scoped access (immutable, always applied).

import { createContext, useContext, useState, useMemo } from 'react'
import { serializeFilters, deserializeFilters, serializedFiltersEqual } from '@/lib/filterUtils'
import type { Filters, SerializedFilters } from '@/lib/filterUtils'

// The saved view currently loaded into the workspace. `filters` is the view's
// stored serialized state; we diff the live filters against it to know whether
// the user has diverged ("modified"). See docs/SAVED_VIEWS.md §5.1.
interface ActiveView {
  id:      string
  name:    string
  filters: SerializedFilters
}

interface FilterContextValue {
  filters: Filters
  setFilters: (f: Filters | ((prev: Filters) => Filters)) => void
  lockedFilters: Filters
  setLockedFilters: (f: Filters) => void
  effectiveFilters: Filters    // lockedFilters merged with user filters
  showFilters: boolean
  setShowFilters: (v: boolean) => void
  // Saved views
  activeView: ActiveView | null
  loadView: (view: { id: string; name: string; filter_config: { filters?: SerializedFilters } | null }) => void
  clearActiveView: () => void
  isViewDirty: boolean         // true once live filters diverge from the loaded view
}

var FilterCtx = createContext<FilterContextValue>({
  filters: {},
  setFilters: function() {},
  lockedFilters: {},
  setLockedFilters: function() {},
  effectiveFilters: {},
  showFilters: false,
  setShowFilters: function() {},
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
  var [activeView, setActiveView] = useState<ActiveView | null>(null)

  // Merge locked filters with user filters — locked take priority
  var effectiveFilters = useMemo(function() {
    return Object.assign({}, filters, lockedFilters)
  }, [filters, lockedFilters])

  function loadView(view: { id: string; name: string; filter_config: { filters?: SerializedFilters } | null }) {
    var stored = (view.filter_config && view.filter_config.filters) || {}
    setFilters(deserializeFilters(stored))
    setActiveView({ id: view.id, name: view.name, filters: stored })
  }

  function clearActiveView() {
    setActiveView(null)
  }

  // Dirty = a view is loaded AND the live filters no longer match its stored
  // config. Drives the "(modified)" header and whether a freeze inherits the
  // view name.
  var isViewDirty = useMemo(function() {
    if (!activeView) return false
    return !serializedFiltersEqual(serializeFilters(filters), activeView.filters)
  }, [filters, activeView])

  return (
    <FilterCtx.Provider value={{
      filters: filters,
      setFilters: setFilters,
      lockedFilters: lockedFilters,
      setLockedFilters: setLockedFilters,
      effectiveFilters: effectiveFilters,
      showFilters: showFilters,
      setShowFilters: setShowFilters,
      activeView: activeView,
      loadView: loadView,
      clearActiveView: clearActiveView,
      isViewDirty: isViewDirty,
    }}>
      {children}
    </FilterCtx.Provider>
  )
}
