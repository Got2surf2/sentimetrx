'use client'

import type { DatasetListFilters } from '@/lib/analyzeTypes'

interface Props {
  filters:   DatasetListFilters
  onChange:  (f: DatasetListFilters) => void
}

type SourceOption     = DatasetListFilters['source']
type VisibilityOption = DatasetListFilters['visibility']
type StatusOption     = DatasetListFilters['status']

export default function DatasetFilterBar({ filters, onChange }: Props) {

  function pill(label: string, active: boolean, onClick: () => void) {
    return (
      <button key={label} onClick={onClick}
        className={"text-sm px-3 py-1 rounded-full border transition-all " +
          (active
            ? 'bg-orange-500 text-white border-orange-500'
            : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300')}>
        {label}
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-6 py-3">

      {/* Source */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Source</span>
        <div className="flex gap-1">
          {pill('All',    filters.source === 'all',    () => onChange({ ...filters, source: 'all' as SourceOption }))}
          {pill('Survey', filters.source === 'study',  () => onChange({ ...filters, source: 'study' as SourceOption }))}
          {pill('Upload', filters.source === 'upload', () => onChange({ ...filters, source: 'upload' as SourceOption }))}
        </div>
      </div>

      {/* Visibility */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Visibility</span>
        <div className="flex gap-1">
          {pill('All',     filters.visibility === 'all',     () => onChange({ ...filters, visibility: 'all' as VisibilityOption }))}
          {pill('Private', filters.visibility === 'private', () => onChange({ ...filters, visibility: 'private' as VisibilityOption }))}
          {pill('Public',  filters.visibility === 'public',  () => onChange({ ...filters, visibility: 'public' as VisibilityOption }))}
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Status</span>
        <div className="flex gap-1">
          {pill('Active',   filters.status === 'active',   () => onChange({ ...filters, status: 'active' as StatusOption }))}
          {pill('Archived', filters.status === 'archived', () => onChange({ ...filters, status: 'archived' as StatusOption }))}
          {pill('All',      filters.status === 'all',      () => onChange({ ...filters, status: 'all' as StatusOption }))}
        </div>
      </div>
    </div>
  )
}
