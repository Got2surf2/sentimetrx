'use client'

// components/analyze/ShareAnalyticsModal.tsx
// Modal for creating shared analytics links.
// Filters determine what's in view. User picks a field and selects
// "primary" values — comparison is against the remaining in-view values.

import { useState, useEffect } from 'react'
import { useFilters } from '@/components/analyze/FilterContext'
import { serializeFilters, filterSummary } from '@/lib/filterUtils'

var HERMES = '#E8632A'

function fmtDate(s: string): string {
  var d = new Date(s)
  if (isNaN(d.getTime())) return s.split('T')[0] || s
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface FieldOption {
  field: string
  label: string
  type: string
  values?: string[]
  dateMin?: string
  dateMax?: string
}

interface Props {
  datasetId: string
  datasetName: string
  onClose: () => void
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

  // Field options from API
  var [allFields, setAllFields] = useState<FieldOption[]>([])
  var [loading, setLoading] = useState(true)

  // Primary selection
  var [selectedField, setSelectedField] = useState('')
  var [primaryValues, setPrimaryValues] = useState<Set<string>>(new Set())

  // Date range
  var [selectedDateField, setSelectedDateField] = useState('')

  var hasFilters = Object.keys(activeFilters).length > 0
  var aliases: Record<string, string> = {}
  allFields.forEach(function(f) { aliases[f.field] = f.label })
  var summary = hasFilters ? filterSummary(activeFilters, aliases) : ''

  // Fetch field options
  useEffect(function() {
    fetch('/api/datasets/' + datasetId + '/filter-options')
      .then(function(r) { return r.json() })
      .then(function(data) {
        var fields = data.fields || {}
        var opts: FieldOption[] = []
        Object.entries(fields).forEach(function(entry) {
          var key = entry[0], opt = entry[1] as any
          if (opt.values && opt.values.length > 0) {
            opts.push({ field: key, label: opt.label || key, type: opt.type, values: opt.values, dateMin: opt.dateMin, dateMax: opt.dateMax })
          } else if (opt.type === 'date' && opt.dateMin && opt.dateMax) {
            opts.push({ field: key, label: opt.label || key, type: opt.type, dateMin: opt.dateMin, dateMax: opt.dateMax })
          }
        })
        setAllFields(opts)
        // Auto-select date field if only one
        var dateOpts = opts.filter(function(f) { return f.type === 'date' && f.dateMin && f.dateMax })
        if (dateOpts.length === 1) setSelectedDateField(dateOpts[0].field)
      })
      .catch(function() {})
      .finally(function() { setLoading(false) })
  }, [datasetId])

  // Categorical fields available for comparison
  var catFields = allFields.filter(function(f) { return f.type === 'categorical' && f.values && f.values.length > 1 })

  // For the selected field, compute which values are "in view" (filtered in)
  var inViewValues: string[] = []
  if (selectedField) {
    var opt = allFields.find(function(f) { return f.field === selectedField })
    var allVals = opt?.values || []
    var activeFilter = activeFilters[selectedField]
    if (activeFilter && activeFilter.type === 'cat') {
      // Only values that pass the filter
      var filterSet = activeFilter.values as Set<string>
      inViewValues = allVals.filter(function(v) { return filterSet.has(v) })
    } else {
      // No filter on this field — all values are in view
      inViewValues = allVals
    }
  }

  var comparisonValues = inViewValues.filter(function(v) { return !primaryValues.has(v) })
  var canCreate = selectedField && primaryValues.size > 0 && comparisonValues.length > 0

  // Date fields
  var dateFields = allFields.filter(function(f) { return f.type === 'date' && f.dateMin && f.dateMax })
  var selectedDate = dateFields.find(function(f) { return f.field === selectedDateField })

  async function handleCreate() {
    if (!canCreate) return
    setCreating(true)
    setCreateError('')
    try {
      // Build filters: start with active filters, then override the selected field
      // to only include the primary values (the comparison group is the rest in view)
      var serialized = hasFilters ? serializeFilters(activeFilters) : {}
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
            primary: { field: selectedField, label: aliases[selectedField] || selectedField, values: Array.from(primaryValues) },
            inViewValues: inViewValues,
            label: label || datasetName + ' — ' + (aliases[selectedField] || selectedField) + ': ' + (primaryValues.size === 1 ? Array.from(primaryValues)[0] : primaryValues.size + ' selected'),
            dateRange: selectedDate ? { field: selectedDate.field, label: selectedDate.label, min: fmtDate(selectedDate.dateMin!), max: fmtDate(selectedDate.dateMax!) } : undefined,
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
    } finally {
      setCreating(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(function() { setCopied(false) }, 2000)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}
      onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 520, width: '100%', margin: '0 16px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}
        onClick={function(e) { e.stopPropagation() }}>

        {step === 'configure' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 700, fontSize: 15, color: '#111827', margin: 0 }}>Share Analytics</h3>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#9ca3af', cursor: 'pointer' }}>&times;</button>
            </div>

            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px' }}>
              Select a field and choose which values to highlight. The report compares your selection against the remaining values{hasFilters ? ' in the current filtered view' : ''}.
            </p>

            {/* Report label */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Report Label</label>
              <input
                type="text"
                value={label}
                onChange={function(e) { setLabel(e.target.value) }}
                placeholder={'e.g., ' + datasetName}
                style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const }}
              />
            </div>

            {/* Active filters summary */}
            {hasFilters && (
              <div style={{ marginBottom: 16, padding: 12, background: '#fff4ef', borderRadius: 8, border: '1px solid #fbd5c2' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: HERMES, marginBottom: 4, textTransform: 'uppercase' as const }}>Filters Applied</div>
                <div style={{ fontSize: 12, color: '#374151' }}>{summary}</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>Only filtered-in values are available for comparison below.</div>
              </div>
            )}

            {/* Field picker */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Compare By</label>
              {loading ? (
                <div style={{ fontSize: 12, color: '#9ca3af', padding: 8 }}>Loading fields...</div>
              ) : catFields.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9ca3af', padding: 8 }}>No categorical fields available for comparison.</div>
              ) : (
                <select
                  value={selectedField}
                  onChange={function(e) { setSelectedField(e.target.value); setPrimaryValues(new Set()) }}
                  style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const }}>
                  <option value="">Select a field...</option>
                  {catFields.map(function(f) {
                    var af = activeFilters[f.field]
                    var count = (af && af.type === 'cat') ? (af.values as Set<string>).size : (f.values?.length || 0)
                    return <option key={f.field} value={f.field}>{f.label} ({count} values in view)</option>
                  })}
                </select>
              )}
            </div>

            {/* Value checkboxes — primary selection */}
            {selectedField && inViewValues.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                  Select Primary Values <span style={{ fontWeight: 400, color: '#9ca3af' }}>({primaryValues.size} selected)</span>
                </label>
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                  {inViewValues.map(function(val) {
                    var isPrimary = primaryValues.has(val)
                    return (
                      <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={isPrimary}
                          onChange={function() {
                            setPrimaryValues(function(prev) {
                              var next = new Set(prev)
                              if (isPrimary) next.delete(val)
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
              </div>
            )}

            {/* Comparison preview */}
            {selectedField && primaryValues.size > 0 && (
              <div style={{ marginBottom: 16, padding: 12, background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0284c7', marginBottom: 6, textTransform: 'uppercase' as const }}>Report Preview</div>
                <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>Primary:</span>{' '}
                  <span style={{ color: HERMES, fontWeight: 600 }}>{Array.from(primaryValues).join(', ')}</span>
                </div>
                {comparisonValues.length > 0 ? (
                  <div style={{ fontSize: 12, color: '#374151' }}>
                    <span style={{ fontWeight: 600 }}>Compared against:</span>{' '}
                    {comparisonValues.length <= 5
                      ? comparisonValues.join(', ')
                      : comparisonValues.length + ' other values'
                    }
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#dc2626' }}>
                    No values left for comparison — deselect at least one value.
                  </div>
                )}
              </div>
            )}

            {/* Date range */}
            {dateFields.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Date Range (shown on shared page)</label>
                {dateFields.length === 1 ? (
                  <div style={{ padding: '8px 12px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, color: '#374151' }}>
                    {dateFields[0].label}: <strong>{fmtDate(dateFields[0].dateMin!)}</strong> — <strong>{fmtDate(dateFields[0].dateMax!)}</strong>
                  </div>
                ) : (
                  <>
                    <select
                      value={selectedDateField}
                      onChange={function(e) { setSelectedDateField(e.target.value) }}
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 8, outline: 'none', marginBottom: 6, boxSizing: 'border-box' as const }}>
                      <option value="">Select date field...</option>
                      {dateFields.map(function(f) {
                        return <option key={f.field} value={f.field}>{f.label} ({fmtDate(f.dateMin!)} — {fmtDate(f.dateMax!)})</option>
                      })}
                    </select>
                    {selectedDate && (
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        Data covers <strong>{fmtDate(selectedDate.dateMin!)}</strong> — <strong>{fmtDate(selectedDate.dateMax!)}</strong>
                      </div>
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
            <button onClick={handleCreate} disabled={creating || !canCreate}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, border: 'none',
                cursor: canCreate ? 'pointer' : 'not-allowed',
                background: canCreate ? HERMES : '#e5e7eb',
                color: canCreate ? 'white' : '#9ca3af',
                opacity: creating ? 0.6 : 1,
              }}>
              {creating ? 'Creating...' : !selectedField ? 'Select a field to compare' : primaryValues.size === 0 ? 'Select primary values' : comparisonValues.length === 0 ? 'Need values for comparison' : 'Create Analytics Link'}
            </button>
          </>
        )}

        {step === 'created' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 700, fontSize: 15, color: '#111827', margin: 0 }}>Link Created</h3>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#9ca3af', cursor: 'pointer' }}>&times;</button>
            </div>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
              Anyone with this link can view the analytics comparison. No login required.
            </p>
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 12, wordBreak: 'break-all' as const, fontSize: 12, color: '#374151', marginBottom: 12, border: '1px solid #e5e7eb' }}>
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
