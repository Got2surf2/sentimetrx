'use client'

// components/analyze/ExportModal.tsx
// PowerPoint export modal — styled to match the Ana/analyze system.

import { useState, useEffect } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

const HERMES = '#e8622a'

const S = {
  bg:        '#f7f7f8',
  white:     '#ffffff',
  border:    '#e8e8ec',
  text:      '#111827',
  textMid:   '#374151',
  textMute:  '#6b7280',
  textFaint: '#9ca3af',
  accentBg:  '#fff4ef',
  accentMid: '#fcd5c0',
}

const TYPE_COLOR: Record<string, string> = {
  'open-ended':  '#2563eb',
  'categorical': '#7c3aed',
  'numeric':     '#16a34a',
  'date':        '#d97706',
}

const TYPE_LABELS: Record<string, string> = {
  'open-ended':  'Open-ended',
  'categorical': 'Categorical',
  'numeric':     'Numeric',
  'date':        'Date',
}

const TYPE_ORDER = ['open-ended', 'categorical', 'numeric', 'date']

const AUDIENCE_OPTIONS = [
  { key: 'executive',   label: 'Executive',   desc: 'Short & high-level — key insights and top quotes' },
  { key: 'stakeholder', label: 'Stakeholder', desc: 'Charts, distributions, field breakdowns' },
  { key: 'full',        label: 'Full Team',   desc: 'Everything — detailed stats, more verbatims' },
]

const EXPORTABLE_TYPES = new Set(['open-ended', 'categorical', 'numeric', 'date'])

interface SchemaField { field: string; type: string; label?: string; status?: string }
interface Props { datasetId: string; datasetName: string; onClose: () => void }

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
        const pre = new Set<string>()
        f.forEach(function(fld) {
          if (fld.type === 'open-ended') pre.add(fld.field)
          if ((fld.type === 'categorical' || fld.type === 'numeric') && pre.size < 8) pre.add(fld.field)
        })
        setSelected(pre)
      })
      .catch(function() { setError('Could not load dataset fields') })
      .finally(function() { setLoading(false) })
  }, [datasetId])

  function toggleField(f: string) {
    setSelected(function(prev) {
      const next = new Set(prev); next.has(f) ? next.delete(f) : next.add(f); return next
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
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = datasetName.replace(/[^a-z0-9]/gi, '_').slice(0, 40) + '_report.pptx'
      a.click()
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

  // Show full-screen generating overlay
  if (generating) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: S.white, borderRadius: 16, padding: '48px 56px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, boxShadow: '0 24px 64px rgba(0,0,0,.25)', minWidth: 280 }}>
          <LottieLoader size={96} message="Building your PowerPoint…" />
          <p style={{ fontSize: 12, color: S.textFaint, margin: '8px 0 0', textAlign: 'center' }}>
            This can take 20–40 seconds while AI generates insights
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <div style={{ background: S.white, borderRadius: 12, width: '100%', maxWidth: 560, maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.22)', border: '1px solid ' + S.border, overflow: 'hidden' }}
        onClick={function(e) { e.stopPropagation() }}>

        {/* Header — orange bar matching the DatasetHeader nav */}
        <div style={{ background: HERMES, padding: '0 0 0 18px', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>📊</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'white', letterSpacing: '-.1px' }}>Generate PowerPoint</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.65)', marginTop: 1 }}>{datasetName}</div>
            </div>
          </div>
          <button onClick={onClose}
            style={{ height: 48, width: 48, background: 'transparent', border: 'none', color: 'rgba(255,255,255,.7)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '18px 20px' }}>
          {loading ? (
            <LottieLoader size={80} message="Loading fields…" />
          ) : (
            <>
              {/* Audience */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: S.textFaint, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Target Audience</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {AUDIENCE_OPTIONS.map(function(opt) {
                    const active = audience === opt.key
                    return (
                      <button key={opt.key} onClick={function() { setAudience(opt.key) }}
                        style={{ flex: 1, padding: '9px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', border: '1.5px solid ' + (active ? HERMES : S.border), background: active ? S.accentBg : S.bg, transition: 'all .12s' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: active ? HERMES : S.textMid, marginBottom: 2 }}>{opt.label}</div>
                        <div style={{ fontSize: 10, color: S.textMute, lineHeight: 1.4 }}>{opt.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Fields */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: S.textFaint, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                    Fields to Include
                    {selected.size > 0 && (
                      <span style={{ marginLeft: 7, padding: '1px 7px', borderRadius: 20, background: S.accentBg, color: HERMES, border: '1px solid ' + S.accentMid, fontSize: 10, fontWeight: 700 }}>
                        {selected.size}
                      </span>
                    )}
                  </div>
                  <button onClick={function() { setSelected(new Set(fields.map(f => f.field))) }}
                    style={{ fontSize: 11, color: HERMES, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
                    Select all
                  </button>
                </div>

                {TYPE_ORDER.filter(t => byType[t]?.length > 0).map(function(type) {
                  const tc = TYPE_COLOR[type]
                  return (
                    <div key={type} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid ' + S.border }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: tc, textTransform: 'uppercase', letterSpacing: '.06em', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: tc, display: 'inline-block' }} />
                          {TYPE_LABELS[type]}
                        </span>
                        <button onClick={function() { selectAllType(type) }}
                          style={{ fontSize: 10, color: S.textFaint, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                          All
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {byType[type].map(function(f) {
                          const checked = selected.has(f.field)
                          return (
                            <label key={f.field}
                              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 10px', borderRadius: 6, border: '1px solid ' + (checked ? HERMES : S.border), background: checked ? S.accentBg : S.white, cursor: 'pointer', transition: 'all .1s' }}>
                              <input type="checkbox" checked={checked} onChange={function() { toggleField(f.field) }}
                                style={{ accentColor: HERMES, width: 13, height: 13, flexShrink: 0 }} />
                              <span style={{ fontSize: 12, fontWeight: checked ? 600 : 400, color: checked ? HERMES : S.textMid, flex: 1 }}>
                                {f.label || f.field}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {error && (
                <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 7, padding: '8px 12px', marginBottom: 8 }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid ' + S.border, padding: '12px 20px', display: 'flex', gap: 10, flexShrink: 0, background: S.bg }}>
          <button onClick={handleGenerate} disabled={loading || selected.size === 0}
            style={{ flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700, color: 'white', background: selected.size === 0 ? S.textFaint : HERMES, border: 'none', borderRadius: 8, cursor: selected.size === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background .15s' }}>
            📊 Generate PowerPoint ({selected.size} fields)
          </button>
          <button onClick={onClose}
            style={{ padding: '10px 16px', fontSize: 12, fontWeight: 600, color: S.textMid, background: S.white, border: '1px solid ' + S.border, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
