'use client'
// components/analyze/FilterContext.tsx
// Shared filter state for TextMine, Charts, and Statistics.
// Wraps the dataset workspace so all modules access the same filters.

import { createContext, useContext, useState } from 'react'
import type { Filters } from '@/lib/filterUtils'

interface FilterContextValue {
  filters: Filters
  setFilters: (f: Filters | ((prev: Filters) => Filters)) => void
  showFilters: boolean
  setShowFilters: (v: boolean) => void
}

var FilterCtx = createContext<FilterContextValue>({
  filters: {},
  setFilters: function() {},
  showFilters: false,
  setShowFilters: function() {},
})

export function useFilters() { return useContext(FilterCtx) }

export function FilterProvider({ children }: { children: React.ReactNode }) {
  var [filters, setFilters] = useState<Filters>({})
  var [showFilters, setShowFilters] = useState(false)

  return (
    <FilterCtx.Provider value={{ filters: filters, setFilters: setFilters, showFilters: showFilters, setShowFilters: setShowFilters }}>
      {children}
    </FilterCtx.Provider>
  )
}


