'use client'
// components/analyze/FilterContext.tsx
// Shared filter state for TextMine, Charts, and Statistics.
// Wraps the dataset workspace so all modules access the same filters.
// Supports lockedFilters for location-scoped access (immutable, always applied).

import { createContext, useContext, useState, useMemo } from 'react'
import type { Filters } from '@/lib/filterUtils'

interface FilterContextValue {
  filters: Filters
  setFilters: (f: Filters | ((prev: Filters) => Filters)) => void
  lockedFilters: Filters
  setLockedFilters: (f: Filters) => void
  effectiveFilters: Filters    // lockedFilters merged with user filters
  showFilters: boolean
  setShowFilters: (v: boolean) => void
}

var FilterCtx = createContext<FilterContextValue>({
  filters: {},
  setFilters: function() {},
  lockedFilters: {},
  setLockedFilters: function() {},
  effectiveFilters: {},
  showFilters: false,
  setShowFilters: function() {},
})

export function useFilters() { return useContext(FilterCtx) }

export function FilterProvider({ children }: { children: React.ReactNode }) {
  var [filters, setFilters] = useState<Filters>({})
  var [lockedFilters, setLockedFilters] = useState<Filters>({})
  var [showFilters, setShowFilters] = useState(false)

  // Merge locked filters with user filters — locked take priority
  var effectiveFilters = useMemo(function() {
    return Object.assign({}, filters, lockedFilters)
  }, [filters, lockedFilters])

  return (
    <FilterCtx.Provider value={{
      filters: filters,
      setFilters: setFilters,
      lockedFilters: lockedFilters,
      setLockedFilters: setLockedFilters,
      effectiveFilters: effectiveFilters,
      showFilters: showFilters,
      setShowFilters: setShowFilters,
    }}>
      {children}
    </FilterCtx.Provider>
  )
}
