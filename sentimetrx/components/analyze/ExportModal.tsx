'use client'

// components/analyze/ExportModal.tsx
// PowerPoint export modal — field picker + audience selector + generate.

import { useState, useEffect } from 'react'

const DN = {
  teal:     '#2A7A6F',
  tealPale: '#E6F4F2',
  orange:   '#E85A1A',
  ink:      '#1A1714',
  inkSoft:  '#2E2A25',
  warmMid:  '#8C7E6E',
  warmLight:'#B8ADA0',
  cream:    '#FAF6F0',
  divider:  '#E4DDD4',
  white:    '#FFFFFF',
}

interface SchemaField {
  field: string
  type: string
  label?: string
  status?: string
}

interface Props {
  datasetId:   string
  datasetName: string
  onClose:     () => void
}

const AUDIENCE_OPTIONS = [
  { key: 'executive', label: 'Executive', desc: 'Short, high-level — titles, key insights, top quotes only' },
  { key: 'stakeholder', label: 'Stakeholder', desc: 'Full charts, distributions, and field breakdowns' },
  { key: 'full', label: 'Full Team', desc: 'Everything — detailed stats, more verbatims, all fields' },
]

const EXPORTABLE_TYPES = new Set(['open-ended', 'categorical', 'numeric', 'date'])

export default function ExportModal({ datasetId, datasetName, onClose }: Props) {
  const [fields,     setFields]     = useState<SchemaField[]>([])
  const [selected,   setSelected]   = useState<Set<string>>(new Set())
  const [audience,   setAudience]   = useState('stakeholder')
  const [loading,    setLoading]    = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error,      setError]      = useState('')

  // Fetch schema on open
  useEffect(function() {
    fetch('/api/datasets/' + datasetId + '/state')
      .then(function(r) { return r.json() })
      .then(function(d) {
        const f: SchemaField[] = (d.schema_config?.fields || [])
          .filter(function(f: SchemaField) { return EXPORTABLE_TYPES.has(f.type) && f.status !== 'ignored' })
        setFields(f)
        // Pre-select open-ended + first few categorical/numeric
        const preselect = new Set<string>()
        f.forEach(function(fld) {
          if (fld.type === 'open-ended') preselect.add(fld.field)
          if ((fld.type === 'categorical' || fld.type === 'numeric') && preselect.size < 8) preselect.add(fld.field)
        })
        setSelected(preselect)
      })
      .catch(function() { setError('Could not load dataset fields') })
      .finally(function() { setLoading(false) })
  }, [datasetId])

  function toggleField(f: string) {
    setSelected(function(prev) {
      const next = new Set(prev)
      next.has(f) ? next.delete(f) : next.add(f)
      return next
    })
  }

  function selectAllType(type: string) {
    setSelected(function(prev) {
      const next = new Set(prev)
      fields.filter(f => f.type === type).forEach(f => next.add(f.field))
      return next
    })
  }

  async function handleGenerate() {
    if (selected.size === 0) { setError('Select at least one field.'); return }
    setGenerating(true); setError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/export/pptx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: Array.from(selected), audience }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Export failed')
      }
      const blob    = await res.blob()
      const url     = URL.createObjectURL(blob)
      const a       = document.createElement('a')
      const safeName = datasetName.replace(/[^a-z0-9]/gi, '_').slice(0, 40)
      a.href     = url
      a.download = safeName + '_report.pptx'
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Export failed — try again')
    } finally {
      setGenerating(false)
    }
  }

  // Group fields by type for display
  const byType: Record<string, SchemaField[]> = {}
  fields.forEach(function(f) {
    if (!byType[f.type]) byType[f.type] = []
    byType[f.type].push(f)
  })

  const TYPE_LABELS: Record<string, string> = {
    'open-ended':  'Open-ended responses',
    'categorical': 'Categorical fields',
    'numeric':     'Numeric fields',
    'date':        'Date fields',
  }
  const TYPE_ORDER = ['open-ended', 'categorical', 'numeric', 'date']

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(26,23,20,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <div style={{ background: DN.white, borderRadius: 14, width: '100%', maxWidth: 640, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,.3)' }}
        onClick={function(e) { e.stopPropagation() }}>

        {/* Header */}
        <div style={{ background: DN.teal, borderRadius: '14px 14px 0 0', padding: '16px 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 18, fontWeight: 900, fontStyle: 'italic', color: '#A8D5D0' }}>Data</span>
                <span style={{ fontSize: 18, fontWeight: 900, fontStyle: 'italic', color: '#F5A07A' }}>nautix</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginLeft: 4 }}>/ Export</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'white', marginTop: 2 }}>Generate PowerPoint Report</div>
            </div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 8, padding: '6px 10px', color: 'white', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '18px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: DN.warmMid }}>Loading fields...</div>
          ) : (
            <>
              {/* Audience selector */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: DN.warmMid, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Target Audience</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {AUDIENCE_OPTIONS.map(function(opt) {
                    const active = audience === opt.key
                    return (
                      <label key={opt.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 9, border: '1.5px solid ' + (active ? DN.teal : DN.divider), background: active ? DN.tealPale : DN.cream, cursor: 'pointer', transition: 'all .1s' }}>
                        <input type="radio" name="audience" value={opt.key} checked={active} onChange={function() { setAudience(opt.key) }}
                          style={{ marginTop: 3, accentColor: DN.teal }} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: active ? DN.teal : DN.inkSoft }}>{opt.label}</div>
                          <div style={{ fontSize: 11, color: DN.warmMid, marginTop: 1 }}>{opt.desc}</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Field picker */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: DN.warmMid, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Fields to include ({selected.size} selected)
                  </div>
                  <button onClick={function() { setSelected(new Set(fields.map(f => f.field))) }}
                    style={{ fontSize: 11, color: DN.teal, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
                    Select all
                  </button>
                </div>

                {TYPE_ORDER.filter(t => byType[t]?.length > 0).map(function(type) {
                  const typeFields = byType[type] || []
                  return (
                    <div key={type} style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: type === 'open-ended' ? DN.teal : DN.warmMid, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {TYPE_LABELS[type]}
                        </div>
                        <button onClick={function() { selectAllType(type) }}
                          style={{ fontSize: 10, color: DN.warmLight, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                          Select all
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {typeFields.map(function(f) {
                          const checked = selected.has(f.field)
                          return (
                            <label key={f.field} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 7, border: '1px solid ' + (checked ? DN.teal : DN.divider), background: checked ? DN.tealPale : 'white', cursor: 'pointer', transition: 'all .1s' }}>
                              <input type="checkbox" checked={checked} onChange={function() { toggleField(f.field) }}
                                style={{ accentColor: DN.teal, width: 14, height: 14 }} />
                              <span style={{ fontSize: 12, fontWeight: checked ? 700 : 400, color: checked ? DN.teal : DN.inkSoft }}>
                                {f.label || f.field}
                              </span>
                              <span style={{ fontSize: 10, color: DN.warmLight, marginLeft: 'auto' }}>{f.type}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {error && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10 }}>{error}</div>}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ borderTop: '1px solid ' + DN.divider, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: DN.cream, borderRadius: '0 0 14px 14px' }}>
          <button onClick={handleGenerate} disabled={generating || loading || selected.size === 0}
            style={{
              flex: 1, padding: '11px 0', fontSize: 14, fontWeight: 700, color: 'white',
              background: generating || selected.size === 0 ? DN.warmLight : DN.teal,
              border: 'none', borderRadius: 9, cursor: generating || selected.size === 0 ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            {generating ? (
              <>
                <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,.4)', borderTopColor: 'white', borderRadius: '50%', animation: '_espin .7s linear infinite', display: 'inline-block' }} />
                Generating report…
              </>
            ) : (
              '\uD83D\uDCCA Generate PowerPoint (' + selected.size + ' fields)'
            )}
          </button>
          <button onClick={onClose}
            style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: DN.warmMid, background: 'white', border: '1px solid ' + DN.divider, borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
        </div>
      </div>
      <style>{`@keyframes _espin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
