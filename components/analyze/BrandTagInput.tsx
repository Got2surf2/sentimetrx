'use client'

// components/analyze/BrandTagInput.tsx
// Shared brand-tag autocomplete for dataset-create forms. A free-text input
// backed by a <datalist> of the org's existing brand tags: typing an existing
// brand auto-suggests it (so a brand's datasets across sources land in one
// brand-collection and share one entity catalog), typing a new one creates
// the brand-collection on save (DB trigger, migration 062).
//
// Optional everywhere — a blank brand tag just means the dataset is its own
// entity scope.

import { useEffect, useState } from 'react'

interface Props {
  value:           string
  onChange:        (v: string) => void
  label?:          string
  placeholder?:    string
  hint?:           string
  containerStyle?: React.CSSProperties
  inputStyle?:     React.CSSProperties
}

// Module-lived cache — create flows are short and a user often spins up
// several datasets for the same brand back to back.
let _brandCache: string[] | null = null

const DEFAULT_HINT =
  'Datasets sharing a brand get one entity catalog across every source.'

export default function BrandTagInput({
  value,
  onChange,
  label = 'Brand (optional)',
  placeholder = 'e.g. Capital Grille',
  hint = DEFAULT_HINT,
  containerStyle,
  inputStyle,
}: Props) {
  const [brands, setBrands] = useState<string[]>(_brandCache || [])

  useEffect(function() {
    if (_brandCache) return
    let cancelled = false
    fetch('/api/brands')
      .then(function(r) { return r.ok ? r.json() : { brands: [] } })
      .then(function(d) {
        if (cancelled) return
        const list: string[] = Array.isArray(d.brands) ? d.brands : []
        _brandCache = list
        setBrands(list)
      })
      .catch(function() { /* autocomplete is best-effort */ })
    return function() { cancelled = true }
  }, [])

  const listId = 'brand-tags-datalist'

  return (
    <div style={containerStyle}>
      {label && (
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
          {label}
        </label>
      )}
      <input
        type="text"
        value={value}
        onChange={function(e) { onChange(e.target.value) }}
        placeholder={placeholder}
        list={listId}
        autoComplete="off"
        style={{
          width: '100%', padding: '8px 10px', borderRadius: 8,
          border: '1px solid #d1d5db', fontSize: 13, fontFamily: 'inherit',
          boxSizing: 'border-box',
          ...inputStyle,
        }}
      />
      <datalist id={listId}>
        {brands.map(function(b) { return <option key={b} value={b} /> })}
      </datalist>
      {hint && <p style={{ fontSize: 11, color: '#9ca3af', margin: '4px 0 0' }}>{hint}</p>}
    </div>
  )
}
