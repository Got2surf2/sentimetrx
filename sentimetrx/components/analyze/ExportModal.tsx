'use client'

// components/analyze/ExportModal.tsx
// PowerPoint export modal — styled to match the rest of the Ana/analyze system.

import { useState, useEffect } from 'react'

// Same palette as the rest of the analyze system
const T = {
  bg:        '#f4f5f7',
  bgCard:    '#ffffff',
  border:    '#e5e7eb',
  borderMid: '#d1d5db',
  text:      '#111827',
  textMid:   '#374151',
  textMute:  '#6b7280',
  textFaint: '#9ca3af',
  accent:    '#e8622a',
  accentBg:  '#fff4ef',
  accentMid: '#fcd5c0',
  green:     '#16a34a',
  greenBg:   '#f0fdf4',
}

interface SchemaField { field: string; type: string; label?: string; status?: string }

interface Props {
  datasetId:   string
  datasetName: string
  onClose:     () => void
}

const AUDIENCE_OPTIONS = [
  { key: 'executive',   label: 'Executive',   icon: '\u2605', desc: 'Short, high-level — key insights and top quotes only' },
  { key: 'stakeholder', label: 'Stakeholder', icon: '\u25A3', desc: 'Full charts, distributions, and field breakdowns' },
  { key: 'full',        label: 'Full Team',   icon: '\u2756', desc: 'Everything — detailed stats, more verbatims, all fields' },
]

const EXPORTABLE_TYPES = new Set(['open-ended', 'categorical', 'numeric', 'date'])

const TYPE_LABELS: Record<string, string> = {
  'open-ended':  'Open-ended responses',
  'categorical': 'Categorical fields',
  'numeric':     'Numeric fields',
  'date':        'Date fields',
}
const TYPE_ORDER = ['open-ended', 'categorical', 'numeric', 'date']

const TYPE_COLOR: Record<string, string> = {
  'open-ended':  '#2563eb',
  'categorical': '#7c3aed',
  'numeric':     '#16a34a',
  'date':        '#d97706',
}

export default function ExportModal({ datasetId, datasetName, onClose }: Props) {
  const [fields,     setFields]     = useState<SchemaField[]>([])
  const [selected,   setSelected]   = useState<Set<string>>(new Set())
  const [audience,   setAudience]   = useState('stakeholder')
  const [loading,    setLoading]    = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error,      setError]      = useState('')

  useEffect(function() {
    fetch('/api/datasets/' + datasetId + '/state')
      .then(function(r) { return r.json() })
      .then(function(d) {
        const f: SchemaField[] = (d.schema_config?.fields || [])
          .filter(function(f: SchemaField) { return EXPORTABLE_TYPES.has(f.type) && f.status !== 'ignored' })
        setFields(f)
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
      a.href = url; a.download = safeName + '_report.pptx'; a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Export failed — try again')
    } finally {
      setGenerating(false)
    }
  }

  const byType: Record<string, SchemaField[]> = {}
  fields.forEach(function(f) {
    if (!byType[f.type]) byType[f.type] = []
    byType[f.type].push(f)
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <div style={{ background: T.bgCard, borderRadius: 14, width: '100%', maxWidth: 580, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.25)', border: '1px solid ' + T.border }}
        onClick={function(e) { e.stopPropagation() }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, borderRadius: '14px 14px 0 0', background: T.bg }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: T.accentBg, border: '1px solid ' + T.accentMid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                {'\uD83D\uDCCA'}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.text, letterSpacing: '-.2px' }}>Generate PowerPoint Report</div>
                <div style={{ fontSize: 11, color: T.textMute, marginTop: 1 }}>{datasetName}</div>
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid ' + T.border, borderRadius: 7, padding: '5px 9px', color: T.textMute, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>
            {'\u00D7'}
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: T.textMute, fontSize: 13 }}>
              <div style={{ width: 20, height: 20, border: '3px solid ' + T.accentMid, borderTopColor: T.accent, borderRadius: '50%', animation: '_espin .75s linear infinite', margin: '0 auto 10px' }} />
              Loading fields…
            </div>
          ) : (
            <>
              {/* Audience selector */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Target Audience</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {AUDIENCE_OPTIONS.map(function(opt) {
                    const active = audience === opt.key
                    return (
                      <button key={opt.key} onClick={function() { setAudience(opt.key) }}
                        style={{
                          flex: 1, padding: '10px 10px', borderRadius: 9, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                          border: '1.5px solid ' + (active ? T.accent : T.border),
                          background: active ? T.accentBg : T.bg,
                          transition: 'all .1s',
                        }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: active ? T.accent : T.textMid, marginBottom: 3 }}>
                          {opt.icon} {opt.label}
                        </div>
                        <div style={{ fontSize: 10, color: T.textMute, lineHeight: 1.4 }}>{opt.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Field picker */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Fields to include
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: selected.size > 0 ? T.accentBg : T.bg, color: selected.size > 0 ? T.accent : T.textFaint, border: '1px solid ' + (selected.size > 0 ? T.accentMid : T.border) }}>
                      {selected.size} selected
                    </span>
                  </div>
                  <button onClick={function() { setSelected(new Set(fields.map(f => f.field))) }}
                    style={{ fontSize: 11, color: T.accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
                    Select all
                  </button>
                </div>

                {TYPE_ORDER.filter(t => byType[t]?.length > 0).map(function(type) {
                  const typeFields = byType[type] || []
                  const tc = TYPE_COLOR[type] || T.textMute
                  return (
                    <div key={type} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: tc, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: tc, display: 'inline-block', flexShrink: 0 }} />
                          {TYPE_LABELS[type]}
                        </div>
                        <button onClick={function() { selectAllType(type) }}
                          style={{ fontSize: 10, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                          All
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {typeFields.map(function(f) {
                          const checked = selected.has(f.field)
                          return (
                            <label key={f.field}
                              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 7, border: '1px solid ' + (checked ? T.accent : T.border), background: checked ? T.accentBg : T.bgCard, cursor: 'pointer', transition: 'all .1s' }}>
                              <input type="checkbox" checked={checked} onChange={function() { toggleField(f.field) }}
                                style={{ accentColor: T.accent, width: 13, height: 13, flexShrink: 0 }} />
                              <span style={{ fontSize: 12, fontWeight: checked ? 700 : 400, color: checked ? T.accent : T.textMid, flex: 1 }}>
                                {f.label || f.field}
                              </span>
                              <span style={{ fontSize: 9.5, color: T.textFaint, background: T.bg, padding: '1px 6px', borderRadius: 4, border: '1px solid ' + T.border, whiteSpace: 'nowrap' }}>{f.type}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {error && <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 7, padding: '8px 12px', marginBottom: 10 }}>{error}</div>}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid ' + T.border, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: T.bg, borderRadius: '0 0 14px 14px' }}>
          <button onClick={handleGenerate} disabled={generating || loading || selected.size === 0}
            style={{
              flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700, color: 'white',
              background: generating || selected.size === 0 ? T.textFaint : T.accent,
              border: 'none', borderRadius: 8, cursor: generating || selected.size === 0 ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background .15s',
            }}>
            {generating ? (
              <>
                <span style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,.4)', borderTopColor: 'white', borderRadius: '50%', animation: '_espin .7s linear infinite', display: 'inline-block' }} />
                Generating…
              </>
            ) : (
              '\uD83D\uDCCA Generate PowerPoint (' + selected.size + ' fields)'
            )}
          </button>
          <button onClick={onClose}
            style={{ padding: '10px 16px', fontSize: 12, fontWeight: 600, color: T.textMid, background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
        </div>
      </div>
      <style>{`@keyframes _espin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
