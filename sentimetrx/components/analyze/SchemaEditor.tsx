'use client'

// components/analyze/SchemaEditor.tsx
// Compact grid layout with field-type filter. Click a card to expand and edit.
// Matches Ana.html design language inside each expanded card.

import { useState } from 'react'
import type { SchemaConfig, SchemaFieldConfig, AnaFieldType, AnaFieldSqt } from '@/lib/analyzeTypes'

interface Props {
  schema:    SchemaConfig
  onChange?: (s: SchemaConfig) => void
  readOnly?: boolean
}

interface UnifiedType {
  id:       string
  label:    string
  icon:     string
  baseType: AnaFieldType
  sqt:      AnaFieldSqt
  color:    string
  bg:       string
  desc:     string
}

const UNIFIED_TYPES: UnifiedType[] = [
  { id: 'open-text',     label: 'Open Text',    icon: '\u270e', baseType: 'open-ended',  sqt: 'open-text',     color: '#2563eb', bg: '#eff6ff', desc: 'Free text response' },
  { id: 'single-select', label: 'Single Select', icon: '\u25c9', baseType: 'categorical', sqt: 'single-select', color: '#7c3aed', bg: '#f5f3ff', desc: 'One choice from a list' },
  { id: 'multi-select',  label: 'Multi Select',  icon: '\u2611', baseType: 'categorical', sqt: 'multi-select',  color: '#0891b2', bg: '#ecfeff', desc: 'Multiple choices allowed' },
  { id: 'likert',        label: 'Likert',         icon: '\u21d4', baseType: 'categorical', sqt: 'likert',        color: '#059669', bg: '#ecfdf5', desc: 'Agreement scale' },
  { id: 'rating',        label: 'Rating Scale',  icon: '\u2605', baseType: 'numeric',     sqt: 'rating',        color: '#d97706', bg: '#fffbeb', desc: 'Numeric scale' },
  { id: 'nps',           label: 'NPS',            icon: '\u25ce', baseType: 'numeric',     sqt: 'nps',           color: '#e8622a', bg: '#fff4ef', desc: 'Net Promoter Score (0-10)' },
  { id: 'numeric-input', label: 'Numeric',        icon: '#',      baseType: 'numeric',     sqt: 'numeric-input', color: '#16a34a', bg: '#f0fdf4', desc: 'Free numeric entry' },
  { id: 'date',          label: 'Date',           icon: '\u25f7', baseType: 'date',        sqt: null,            color: '#d97706', bg: '#fffbeb', desc: 'Date or time field' },
  { id: 'id',            label: 'ID',             icon: '\u2317', baseType: 'id',          sqt: null,            color: '#6b7280', bg: '#f9fafb', desc: 'Unique identifier' },
  { id: 'ignore',        label: 'Ignore',         icon: '\u2205', baseType: 'ignore',      sqt: null,            color: '#6b7280', bg: '#f9fafb', desc: 'Exclude from analysis' },
]

const PREVIEW_COLS = 8
const HERMES = '#e8622a'

const TC = {
  bg: '#f4f5f7', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  amber: '#d97706', amberBg: '#fffbeb',
}

function getActiveType(f: SchemaFieldConfig): UnifiedType {
  if (f.sqt) {
    const match = UNIFIED_TYPES.find(function(u) { return u.sqt === f.sqt })
    if (match) return match
  }
  return UNIFIED_TYPES.find(function(u) { return u.baseType === f.type }) || UNIFIED_TYPES[UNIFIED_TYPES.length - 1]
}

// -- Value pills with expand -------------------------------------------
function ValuePills({ values }: { values: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const shown  = expanded ? values : values.slice(0, PREVIEW_COLS)
  const hidden = values.length - PREVIEW_COLS
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
      {shown.map(function(v) {
        return <span key={v} style={{ fontSize: 11, padding: '2px 8px', background: TC.bg, color: TC.textMid, borderRadius: 5, border: '1px solid ' + TC.border, whiteSpace: 'nowrap' }}>{v}</span>
      })}
      {!expanded && hidden > 0 && (
        <button onClick={function() { setExpanded(true) }}
          style={{ fontSize: 11, padding: '2px 8px', background: TC.accentBg, color: TC.accent, borderRadius: 5, border: '1px solid ' + TC.accentMid, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>
          +{hidden} more
        </button>
      )}
      {expanded && values.length > PREVIEW_COLS && (
        <button onClick={function() { setExpanded(false) }}
          style={{ fontSize: 11, fontWeight: 600, color: TC.textMute, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
          show less
        </button>
      )}
    </div>
  )
}

// -- Expanded field editor (Ana.html style) ----------------------------
function FieldEditor({ f, onTypeChange, onAliasChange }: {
  f:             SchemaFieldConfig
  onTypeChange:  (field: string, baseType: AnaFieldType, sqt: AnaFieldSqt) => void
  onAliasChange: (field: string, alias: string) => void
}) {
  const ut     = getActiveType(f)
  const isAuto = !f.sqt

  return (
    <div style={{ borderTop: '1px solid ' + TC.border, marginTop: 12, paddingTop: 14 }}>

      {/* Alias input */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: TC.textFaint, letterSpacing: '.07em', textTransform: 'uppercase' as const, marginBottom: 4 }}>
          Export Alias <span style={{ fontWeight: 400 }}>{'(optional)'}</span>
        </div>
        <input
          value={f.label || ''}
          onChange={function(e) { onAliasChange(f.field, e.target.value) }}
          placeholder={f.field}
          style={{ width: '100%', padding: '5px 9px', fontSize: 12, border: '1px solid ' + TC.border, borderRadius: 7, background: TC.bg, color: TC.text, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const }}
        />
      </div>

      {/* Type picker */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: TC.textFaint, letterSpacing: '.07em', textTransform: 'uppercase' as const, marginBottom: 6 }}>
          Field Type
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {UNIFIED_TYPES.map(function(type) {
            const active = ut.id === type.id
            return (
              <button key={type.id} title={type.desc}
                onClick={function() { onTypeChange(f.field, type.baseType, type.sqt) }}
                style={{ padding: '5px 10px', fontSize: 11, fontWeight: active ? 700 : 500, background: active ? type.bg : 'transparent', border: '1.5px solid ' + (active ? type.color : TC.border), borderRadius: 7, cursor: 'pointer', color: active ? type.color : TC.textMute, display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>
                {type.icon} {type.label}
                {active && isAuto && type.sqt && <span style={{ fontSize: 9, opacity: 0.6, fontWeight: 400 }}>(auto)</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Excluded notice / value pills / sample */}
      {(f.type === 'id' || f.type === 'ignore') && (
        <div style={{ fontSize: 11, color: TC.textFaint, fontStyle: 'italic', marginTop: 8 }}>
          {f.type === 'id' ? 'Identifier — excluded from analysis' : 'Field excluded from analysis'}
        </div>
      )}
      {f.values && f.values.length > 0 && <ValuePills values={f.values} />}
      {(!f.values || !f.values.length) && f.sample && f.sample.length > 0 && f.type === 'open-ended' && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: TC.textFaint, fontStyle: 'italic', marginBottom: 3 }}>Sample</div>
          {f.sample.slice(0, 2).map(function(v, i) {
            return <div key={i} style={{ fontSize: 11, color: TC.textMid, background: TC.bg, borderRadius: 6, padding: '3px 8px', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
          })}
        </div>
      )}
      {f.type === 'numeric' && f.min != null && f.max != null && (
        <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 11, color: TC.textFaint }}>
          <span>Min <strong style={{ color: TC.textMid }}>{f.min}</strong></span>
          <span>Max <strong style={{ color: TC.textMid }}>{f.max}</strong></span>
          {f.avg && <span>Avg <strong style={{ color: TC.textMid }}>{f.avg}</strong></span>}
        </div>
      )}
    </div>
  )
}

// -- Compact grid card -------------------------------------------------
function FieldCard({ f, onTypeChange, onAliasChange, readOnly }: {
  f:             SchemaFieldConfig
  onTypeChange:  (field: string, baseType: AnaFieldType, sqt: AnaFieldSqt) => void
  onAliasChange: (field: string, alias: string) => void
  readOnly?:     boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const ut     = getActiveType(f)
  const isAuto = !f.sqt

  return (
    <div style={{ background: 'white', border: '1px solid ' + TC.border, borderRadius: 12, padding: '12px 14px', boxShadow: '0 1px 3px rgba(0,0,0,.04)', cursor: readOnly ? 'default' : 'pointer', transition: 'box-shadow .15s' }}
      onClick={readOnly ? undefined : function() { setExpanded(function(v) { return !v }) }}>

      {/* Compact header: icon + name + badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 7, background: ut.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: ut.color, flexShrink: 0 }}>
          {ut.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TC.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {f.label && f.label !== f.field ? f.label : f.field}
          </div>
          {f.nonNullCount != null && (
            <div style={{ fontSize: 10, color: TC.textMute, marginTop: 1 }}>
              {f.nonNullCount} rows
              {f.uniqueRatio ? (' \u00b7 ' + f.uniqueRatio + '% unique') : ''}
            </div>
          )}
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: ut.bg, color: ut.color, border: '1px solid ' + ut.color + '40', whiteSpace: 'nowrap', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {ut.label}
          {isAuto && <span style={{ fontSize: 8, opacity: 0.6, fontWeight: 400 }}>(auto)</span>}
        </span>
        {!readOnly && (
          <span style={{ fontSize: 12, color: TC.textFaint, marginLeft: 2, flexShrink: 0 }}>
            {expanded ? '\u2303' : '\u2304'}
          </span>
        )}
      </div>

      {/* Expanded editor */}
      {expanded && !readOnly && (
        <div onClick={function(e) { e.stopPropagation() }}>
          <FieldEditor f={f} onTypeChange={onTypeChange} onAliasChange={onAliasChange} />
        </div>
      )}
    </div>
  )
}

// -- Main SchemaEditor -------------------------------------------------
export default function SchemaEditor({ schema, onChange, readOnly }: Props) {
  const [sortAZ,      setSortAZ]      = useState(false)
  const [typeFilter,  setTypeFilter]  = useState<string>('all')
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)

  function applyUpdate(next: SchemaConfig) { if (onChange) onChange(next) }

  function handleTypeChange(field: string, baseType: AnaFieldType, sqt: AnaFieldSqt) {
    applyUpdate({ ...schema, autoDetected: false, version: schema.version + 1,
      fields: schema.fields.map(function(f) {
        return f.field === field ? { ...f, type: baseType, sqt: sqt || undefined } : f
      }) })
  }

  function handleAliasChange(field: string, alias: string) {
    applyUpdate({ ...schema,
      fields: schema.fields.map(function(f) {
        return f.field === field ? { ...f, label: alias || undefined } : f
      }) })
  }

  function handleSelectAll() {
    applyUpdate({ ...schema, autoDetected: false, version: schema.version + 1,
      fields: schema.fields.map(function(f) { return { ...f, type: 'open-ended' as AnaFieldType, sqt: 'open-text' as AnaFieldSqt } }) })
  }

  function handleIgnoreAll() {
    applyUpdate({ ...schema, autoDetected: false, version: schema.version + 1,
      fields: schema.fields.map(function(f) { return { ...f, type: 'ignore' as AnaFieldType, sqt: undefined } }) })
  }

  async function handleSave() {
    if (!onChange) return
    setSaving(true)
    try {
      const parts     = window.location.pathname.split('/')
      const datasetId = parts[2]
      await fetch('/api/datasets/' + datasetId + '/state', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema_config: schema, theme_model: { themes: [], aiGenerated: false, version: 1 }, saved_charts: [], saved_stats: [], filter_state: {} }),
      })
      setSaved(true)
      setTimeout(function() { setSaved(false) }, 2000)
    } finally {
      setSaving(false)
    }
  }

  if (!schema.fields || schema.fields.length === 0) {
    return (
      <div style={{ padding: 32, background: TC.bg, borderRadius: 10, border: '1px dashed ' + TC.border, fontSize: 13, color: TC.textMute, textAlign: 'center' }}>
        No schema yet. Upload a dataset or sync a study to auto-detect fields.
      </div>
    )
  }

  // Type summary counts
  const counts: Record<string, number> = {}
  for (const f of schema.fields) {
    const ut = getActiveType(f)
    counts[ut.id] = (counts[ut.id] || 0) + 1
  }

  // Filter + sort
  let display = typeFilter === 'all'
    ? schema.fields
    : schema.fields.filter(function(f) { return getActiveType(f).id === typeFilter })
  if (sortAZ) display = [...display].sort(function(a, b) { return a.field.localeCompare(b.field) })

  const allIgnored  = schema.fields.every(function(f) { return f.type === 'ignore' })
  const allSelected = schema.fields.every(function(f) { return f.type !== 'ignore' })
  const mixed       = !allIgnored && !allSelected

  function bulkStyle(forIgnore: boolean): React.CSSProperties {
    const on = forIgnore ? allIgnored : allSelected
    return { fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 7,
      background: on ? TC.accent : (mixed ? 'transparent' : TC.bg),
      color:      on ? 'white'   : (mixed ? TC.textMute   : TC.textMid),
      border: '2px solid ' + (on ? TC.accent : (mixed ? TC.border : TC.borderMid)),
      cursor: 'pointer', opacity: mixed ? 0.45 : 1, fontFamily: 'inherit' }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: TC.text, margin: '0 0 2px' }}>Data Schema</h2>
          <p style={{ fontSize: 12, color: TC.textMid, margin: 0 }}>{schema.fields.length} fields detected</p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={function() { setSortAZ(function(v) { return !v }) }}
            style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 7, background: sortAZ ? TC.accentBg : 'transparent', color: sortAZ ? TC.accent : TC.textMute, border: '1px solid ' + (sortAZ ? TC.accent : TC.border), cursor: 'pointer', fontFamily: 'inherit' }}>
            {sortAZ ? '\u2195 Original' : 'A\u2013Z'}
          </button>
          {!readOnly && <button onClick={handleSelectAll} style={bulkStyle(false)}>Select All</button>}
          {!readOnly && <button onClick={handleIgnoreAll} style={bulkStyle(true)}>Ignore All</button>}
          {!readOnly && onChange && (
            <button onClick={handleSave} disabled={saving}
              style={{ fontSize: 12, fontWeight: 700, padding: '5px 16px', borderRadius: 9, background: HERMES, color: 'white', border: 'none', cursor: 'pointer', opacity: saving ? 0.6 : 1, fontFamily: 'inherit' }}>
              {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Schema'}
            </button>
          )}
        </div>
      </div>

      {/* Auto-detect notice */}
      {schema.autoDetected && (
        <div style={{ padding: '8px 12px', background: TC.amberBg, border: '1px solid ' + TC.amber + '40', borderRadius: 8, marginBottom: 12, fontSize: 11, color: TC.amber, fontWeight: 600 }}>
          ! Field types were auto-detected. Click any card to review and confirm.
        </div>
      )}

      {/* Type summary + filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 16 }}>
        <button onClick={function() { setTypeFilter('all') }}
          style={{ fontSize: 11, fontWeight: typeFilter === 'all' ? 700 : 500, padding: '3px 10px', borderRadius: 20, background: typeFilter === 'all' ? TC.text : 'transparent', color: typeFilter === 'all' ? 'white' : TC.textMute, border: '1px solid ' + (typeFilter === 'all' ? TC.text : TC.border), cursor: 'pointer', fontFamily: 'inherit' }}>
          All ({schema.fields.length})
        </button>
        {Object.entries(counts).map(function([uid, n]) {
          const ut = UNIFIED_TYPES.find(function(u) { return u.id === uid })
          if (!ut) return null
          const active = typeFilter === uid
          return (
            <button key={uid} onClick={function() { setTypeFilter(active ? 'all' : uid) }}
              style={{ fontSize: 11, fontWeight: active ? 700 : 500, padding: '3px 10px', borderRadius: 20, background: active ? ut.bg : 'transparent', color: active ? ut.color : TC.textMute, border: '1px solid ' + (active ? ut.color : TC.border), cursor: 'pointer', fontFamily: 'inherit' }}>
              {ut.icon} {ut.label} ({n})
            </button>
          )
        })}
      </div>

      {/* Grid of compact cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {display.map(function(f) {
          return (
            <FieldCard key={f.field} f={f}
              onTypeChange={handleTypeChange}
              onAliasChange={handleAliasChange}
              readOnly={readOnly}
            />
          )
        })}
      </div>

      {display.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: TC.textFaint }}>
          No fields match this filter.
        </div>
      )}
    </div>
  )
}
