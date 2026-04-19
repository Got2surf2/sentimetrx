'use client'

// components/analyze/ShareAnalyticsModal.tsx
// Modal for creating shared analytics links with filter criteria.
// Uses current active filters from FilterContext or lets user pick new ones.

import { useState, useEffect } from 'react'
import { useFilters } from '@/components/analyze/FilterContext'
import { serializeFilters, filterSummary } from '@/lib/filterUtils'
import type { Filters, SerializedFilters } from '@/lib/filterUtils'

var HERMES = '#E8632A'

interface Props {
  datasetId: string
  datasetName: string
  onClose: () => void
}

interface FilterOption {
  field: string
  label: string
  type: string
  values?: string[]
}

export default function ShareAnalyticsModal({ datasetId, datasetName, onClose }: Props) {
  var { filters: activeFilters } = useFilters()
  var [step, setStep] = useState<'configure' | 'created'>('configure')
  var [label, setLabel] = useState('')
  var [expiry, setExpiry] = useState('7d')
  var [creating, setCreating] = useState(false)
  var [createError, setCreateError] = useState('')
  var [shareUrl, setShareUrl] = useState('')
  var [copied, setCopied] = useState(false)

  // Filter selection state
  var [filterOptions, setFilterOptions] = useState<FilterOption[]>([])
  var [loadingOptions, setLoadingOptions] = useState(true)
  var [selectedField, setSelectedField] = useState('')
  var [selectedValues, setSelectedValues] = useState<Set<string>>(new Set())
  var [customFilters, setCustomFilters] = useState<Filters>({})
  var [useCurrentFilters, setUseCurrentFilters] = useState(Object.keys(activeFilters).length > 0)

  // Build aliases for filterSummary
  var aliases: Record<string, string> = {}
  filterOptions.forEach(function(f) { aliases[f.field] = f.label })

  // Fetch filter options (categorical fields with their values)
  useEffect(function() {
    fetch('/api/datasets/' + datasetId + '/filter-options')
      .then(function(r) { return r.json() })
      .then(function(data) {
        var fields = data.fields || {}
        var opts: FilterOption[] = []
        Object.entries(fields).forEach(function(entry) {
          var key = entry[0], opt = entry[1] as any
          if ((opt.type === 'categorical') && opt.values && opt.values.length > 0) {
            opts.push({ field: key, label: opt.label || key, type: opt.type, values: opt.values })
          }
        })
        setFilterOptions(opts)
      })
      .catch(function() {})
      .finally(function() { setLoadingOptions(false) })
  }, [datasetId])

  var effectiveFilters = useCurrentFilters ? activeFilters : customFilters
  var hasFilters = Object.keys(effectiveFilters).length > 0

  function addFilterFromSelection() {
    if (!selectedField || selectedValues.size === 0) return
    setCustomFilters(function(prev) {
      var next = Object.assign({}, prev)
      next[selectedField] = { type: 'cat' as const, values: new Set(selectedValues), excludeBlanks: true }
      return next
    })
    setSelectedField('')
    setSelectedValues(new Set())
  }

  function removeCustomFilter(field: string) {
    setCustomFilters(function(prev) {
      var next = Object.assign({}, prev)
      delete next[field]
      return next
    })
  }

  async function handleCreate() {
    if (!hasFilters) return
    setCreating(true)
    setCreateError('')
    try {
      var serialized = serializeFilters(effectiveFilters)
      var res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'analytics',
          target_id: datasetId,
          expires_in: expiry,
          metadata: {
            dataset_id: datasetId,
            filters: serialized,
            label: label || datasetName + ' — Filtered View',
          },
        }),
      })
      var data = await res.json()
      if (res.ok) {
        setShareUrl(data.url)
        setStep('created')
      } else {
        setCreateError(data.error || 'Failed to create link')
      }
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create link')
    }
    finally { setCreating(false) }
  }

  function handleCopy() {
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(function() { setCopied(false) }, 2000)
  }

  // Currently selected filter option details
  var selectedOpt = filterOptions.find(function(f) { return f.field === selectedField })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}
      onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 520, width: '100%', margin: '0 16px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}
        onClick={function(e) { e.stopPropagation() }}>

        {step === 'configure' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>Share Analytics</h3>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#9ca3af', cursor: 'pointer' }}>&times;</button>
            </div>

            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
              Create a read-only analytics link showing a filtered view compared against the system benchmark.
              No individual data from other entries is exposed — only aggregates.
            </p>

            {/* Label */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Report Label</label>
              <input
                type="text"
                value={label}
                onChange={function(e) { setLabel(e.target.value) }}
                placeholder="e.g., Restaurant X Performance"
                style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Filter source toggle (only if current filters exist) */}
            {Object.keys(activeFilters).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>Filter Source</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={function() { setUseCurrentFilters(true) }}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid',
                      background: useCurrentFilters ? HERMES : 'white',
                      color: useCurrentFilters ? 'white' : '#374151',
                      borderColor: useCurrentFilters ? HERMES : '#e5e7eb',
                    }}>
                    Use Current Filters
                  </button>
                  <button
                    onClick={function() { setUseCurrentFilters(false) }}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid',
                      background: !useCurrentFilters ? HERMES : 'white',
                      color: !useCurrentFilters ? 'white' : '#374151',
                      borderColor: !useCurrentFilters ? HERMES : '#e5e7eb',
                    }}>
                    Choose Different Filters
                  </button>
                </div>
              </div>
            )}

            {/* Show current filter summary if using current filters */}
            {useCurrentFilters && Object.keys(activeFilters).length > 0 && (
              <div style={{ marginBottom: 16, padding: 12, background: '#fff4ef', borderRadius: 8, border: '1px solid #fbd5c2' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: HERMES, marginBottom: 4, textTransform: 'uppercase' }}>Active Filters</div>
                <div style={{ fontSize: 12, color: '#374151' }}>{filterSummary(activeFilters, aliases)}</div>
              </div>
            )}

            {/* Custom filter picker */}
            {!useCurrentFilters && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>Select Filters</label>

                {/* Show existing custom filters */}
                {Object.keys(customFilters).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {Object.entries(customFilters).map(function(entry) {
                      var field = entry[0], f = entry[1]
                      var fieldLabel = aliases[field] || field
                      var desc = f.type === 'cat' ? Array.from(f.values).slice(0, 3).join(', ') + (f.values.size > 3 ? ' +' + (f.values.size - 3) : '') : ''
                      return (
                        <span key={field} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#fff4ef', border: '1px solid #fbd5c2', color: '#374151' }}>
                          <span style={{ color: HERMES, fontWeight: 700 }}>{fieldLabel}:</span> {desc}
                          <button onClick={function() { removeCustomFilter(field) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 12, padding: 0 }}>&times;</button>
                        </span>
                      )
                    })}
                  </div>
                )}

                {loadingOptions ? (
                  <div style={{ fontSize: 12, color: '#9ca3af', padding: 8 }}>Loading fields...</div>
                ) : filterOptions.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#9ca3af', padding: 8 }}>No categorical fields available for filtering.</div>
                ) : (
                  <>
                    {/* Field selector */}
                    <select
                      value={selectedField}
                      onChange={function(e) { setSelectedField(e.target.value); setSelectedValues(new Set()) }}
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8, outline: 'none' }}>
                      <option value="">Select a field...</option>
                      {filterOptions.filter(function(f) { return !customFilters[f.field] }).map(function(f) {
                        return <option key={f.field} value={f.field}>{f.label} ({f.values?.length} values)</option>
                      })}
                    </select>

                    {/* Value checkboxes */}
                    {selectedOpt && selectedOpt.values && (
                      <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, marginBottom: 8 }}>
                        {selectedOpt.values.map(function(val) {
                          var isChecked = selectedValues.has(val)
                          return (
                            <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={function() {
                                  setSelectedValues(function(prev) {
                                    var next = new Set(prev)
                                    if (isChecked) next.delete(val)
                                    else next.add(val)
                                    return next
                                  })
                                }}
                                style={{ accentColor: HERMES }}
                              />
                              {val}
                            </label>
                          )
                        })}
                      </div>
                    )}

                    {selectedField && selectedValues.size > 0 && (
                      <button onClick={addFilterFromSelection}
                        style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#374151', cursor: 'pointer' }}>
                        + Add Filter
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Expiry */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Link Expires In</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ key: '24h', label: '24 hours' }, { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }].map(function(opt) {
                  return (
                    <button key={opt.key} onClick={function() { setExpiry(opt.key) }}
                      style={{
                        fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid',
                        background: expiry === opt.key ? HERMES : 'white',
                        color: expiry === opt.key ? 'white' : '#374151',
                        borderColor: expiry === opt.key ? HERMES : '#e5e7eb',
                      }}>
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {createError && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12, color: '#dc2626' }}>
                {createError}
              </div>
            )}

            {/* Create button */}
            <button onClick={handleCreate} disabled={creating || !hasFilters}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, border: 'none', cursor: hasFilters ? 'pointer' : 'not-allowed',
                background: hasFilters ? HERMES : '#e5e7eb', color: hasFilters ? 'white' : '#9ca3af',
                opacity: creating ? 0.6 : 1,
              }}>
              {creating ? 'Creating...' : !hasFilters ? 'Select filters first' : 'Create Analytics Link'}
            </button>
          </>
        )}

        {step === 'created' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>Link Created</h3>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#9ca3af', cursor: 'pointer' }}>&times;</button>
            </div>
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
              Anyone with this link can view the filtered analytics comparison. No login required.
            </p>
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 12, wordBreak: 'break-all', fontSize: 12, color: '#374151', marginBottom: 12, border: '1px solid #e5e7eb' }}>
              {shareUrl}
            </div>
            <button onClick={handleCopy}
              style={{ width: '100%', padding: '10px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', background: HERMES, color: 'white' }}>
              {copied ? '\u2713 Copied!' : 'Copy Link'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
