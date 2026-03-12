'use client'

// components/analyze/DatasetFilterBar.tsx

interface Filters {
  source:     'all' | 'study' | 'upload'
  visibility: 'all' | 'private' | 'public'
  status:     'all' | 'active' | 'archived'
}

interface Props {
  filters:   Filters
  onChange:  (f: Filters) => void
}

const HERMES = '#E8632A'

type FilterKey = keyof Filters

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={'px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ' +
        (active
          ? 'text-white border-transparent'
          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300')}
      style={active ? { background: HERMES } : {}}
    >
      {label}
    </button>
  )
}

export default function DatasetFilterBar({ filters, onChange }: Props) {
  function set(key: FilterKey, val: string) {
    onChange({ ...filters, [key]: val } as Filters)
  }

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 font-medium mr-1">Source</span>
        {(['all', 'study', 'upload'] as const).map(function(v) {
          return (
            <Pill
              key={v}
              label={v === 'all' ? 'All' : v === 'study' ? 'Survey' : 'Upload'}
              active={filters.source === v}
              onClick={function() { set('source', v) }}
            />
          )
        })}
      </div>

      <div className="w-px h-5 bg-gray-200" />

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 font-medium mr-1">Visibility</span>
        {(['all', 'private', 'public'] as const).map(function(v) {
          return (
            <Pill
              key={v}
              label={v.charAt(0).toUpperCase() + v.slice(1)}
              active={filters.visibility === v}
              onClick={function() { set('visibility', v) }}
            />
          )
        })}
      </div>

      <div className="w-px h-5 bg-gray-200" />

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 font-medium mr-1">Status</span>
        {(['all', 'active', 'archived'] as const).map(function(v) {
          return (
            <Pill
              key={v}
              label={v.charAt(0).toUpperCase() + v.slice(1)}
              active={filters.status === v}
              onClick={function() { set('status', v) }}
            />
          )
        })}
      </div>
    </div>
  )
}
