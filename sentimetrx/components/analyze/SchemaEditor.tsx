'use client'

// components/analyze/SchemaEditor.tsx
// Full-width row cards. Click to expand inline editor.
// Hermes orange palette throughout.

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
  { id: 'open-text',     label: 'Open Text',     icon: '\u270e', baseType: 'open-ended',  sqt: 'open-text',     color: '#2563eb', bg: '#eff6ff', desc: 'Free text response' },
  { id: 'single-select', label: 'Single Select',  icon: '\u25c9', baseType: 'categorical', sqt: 'single-select', color: '#7c3aed', bg: '#f5f3ff', desc: 'One choice from a list' },
  { id: 'multi-select',  label: 'Multi Select',   icon: '\u2611', baseType: 'categorical', sqt: 'multi-select',  color: '#0891b2', bg: '#ecfeff', desc: 'Multiple choices allowed' },
  { id: 'likert',        label: 'Likert',          icon: '\u21d4', baseType: 'categorical', sqt: 'likert',        color: '#059669', bg: '#ecfdf5', desc: 'Agreement scale' },
  { id: 'rating',        label: 'Rating Scale',   icon: '\u2605', baseType: 'numeric',     sqt: 'rating',        color: '#d97706', bg: '#fffbeb', desc: 'Numeric scale' },
  { id: 'nps',           label: 'NPS',             icon: '\u25ce', baseType: 'numeric',     sqt: 'nps',           color: '#e8622a', bg: '#fff4ef', desc: 'Net Promoter Score (0–10)' },
  { id: 'numeric-input', label: 'Numeric',         icon: '#',      baseType: 'numeric',     sqt: 'numeric-input', color: '#16a34a', bg: '#f0fdf4', desc: 'Free numeric entry' },
  { id: 'date',          label: 'Date',            icon: '\u25f7', baseType: 'date',        sqt: null,            color: '#d97706', bg: '#fffbeb', desc: 'Date or time field' },
  { id: 'id',            label: 'ID',              icon: '\u2317', baseType: 'id',          sqt: null,            color: '#6b7280', bg: '#f9fafb', desc: 'Unique identifier' },
  { id: 'ignore',        label: 'Ignore',          icon: '\u2205', baseType: 'ignore',      sqt: null,            color: '#9ca3af', bg: '#f9fafb', desc: 'Exclude from analysis' },
]

const HERMES  = '#e8622a'
const PREVIEW = 10

// Palette
const P = {
  bg:        '#f7f7f8',
  white:     '#ffffff',
  border:    '#e8e8ec',
  borderMid: '#d1d5db',
  text:      '#111827',
  textMid:   '#374151',
  textMute:  '#6b7280',
  textFaint: '#9ca3af',
  accent:    '#e8622a',
  accentBg:  '#fff4ef',
  accentMid: '#fcd5c0',
  amber:     '#d97706',
  amberBg:   '#fffbeb',
  amberBorder: '#fde68a',
}

function getActiveType(f: SchemaFieldConfig): UnifiedType {
  if (f.sqt) {
    const m = UNIFIED_TYPES.find(function(u) { return u.sqt === f.sqt })
    if (m) return m
  }
  return UNIFIED_TYPES.find(function(u) { return u.baseType === f.type }) || UNIFIED_TYPES[UNIFIED_TYPES.length - 1]
}

// Value pills
function ValuePills({ values }: { values: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const shown  = expanded ? values : values.slice(0, PREVIEW)
  const hidden = values.length - PREVIEW
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
      {shown.map(function(v) {
        return (
          <span key={v} style={{ fontSize: 11, padding: '2px 9px', background: P.bg, color: P.textMid, borderRadius: 5, border: '1px solid ' + P.border, whiteSpace: 'nowrap' }}>
            {v}
          </span>
        )
      })}
      {!expanded && hidden > 0 && (
        <button onClick={function() { setExpanded(true) }}
          style={{ fontSize: 11, padding: '2px 9px', background: P.accentBg, color: P.accent, borderRadius: 5, border: '1px solid ' + P.accentMid, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>
          +{hidden} more
        </button>
      )}
      {expanded && values.length > PREVIEW && (
        <button onClick={function() { setExpanded(false) }}
          style={{ fontSize: 11, fontWeight: 600, color: P.textMute, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          show less
        </button>
      )}
    </div>
  )
}

// Expanded inline editor
function FieldEditor({ f, onTypeChange, onAliasChange }: {
  f:             SchemaFieldConfig
  onTypeChange:  (field: string, baseType: AnaFieldType, sqt: AnaFieldSqt) => void
  onAliasChange: (field: string, alias: string) => void
}) {
  const ut     = getActiveType(f)
  const isAuto = !f.sqt

  return (
    <div style={{ borderTop: '1px solid ' + P.border, marginTop: 14, paddingTop: 14 }}>

      {/* Alias */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: P.textFaint, letterSpacing: '.08em', textTransform: 'uppercase' as const, marginBottom: 5 }}>
          Export Alias <span style={{ fontWeight: 400 }}>(optional)</span>
        </div>
        <input
          value={f.label || ''}
          onChange={function(e) { onAliasChange(f.field, e.target.value) }}
          placeholder={f.field}
          style={{ width: '100%', maxWidth: 360, padding: '6px 10px', fontSize: 12, border: '1.5px solid ' + P.border, borderRadius: 8, background: P.bg, color: P.text, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const, transition: 'border-color .15s' }}
          onFocus={function(e) { e.target.style.borderColor = P.accent }}
          onBlur={function(e)  { e.target.style.borderColor = P.border }}
        />
      </div>

      {/* Type picker */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: P.textFaint, letterSpacing: '.08em', textTransform: 'uppercase' as const, marginBottom: 6 }}>Field Type</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {UNIFIED_TYPES.map(function(type) {
            const active = ut.id === type.id
            return (
              <button key={type.id} title={type.desc}
                onClick={function() { onTypeChange(f.field, type.baseType, type.sqt) }}
                style={{
                  padding: '5px 11px', fontSize: 11, fontWeight: active ? 700 : 500,
                  background: active ? type.bg : P.white,
                  border: '1.5px solid ' + (active ? type.color : P.border),
                  borderRadius: 7, cursor: 'pointer',
                  color: active ? type.color : P.textMute,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontFamily: 'inherit', transition: 'all .12s',
                }}>
                {type.icon} {type.label}
                {active && isAuto && type.sqt && <span style={{ fontSize: 9, opacity: 0.55, fontWeight: 400 }}>(auto)</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Data preview */}
      {(f.type === 'id' || f.type === 'ignore') && (
        <p style={{ fontSize: 11, color: P.textFaint, fontStyle: 'italic', margin: '4px 0 0' }}>
          {f.type === 'id' ? 'Identifier — excluded from analysis' : 'Field excluded from analysis'}
        </p>
      )}
      {f.values && f.values.length > 0 && <ValuePills values={f.values} />}
      {(!f.values || !f.values.length) && f.sample && f.sample.length > 0 && f.type === 'open-ended' && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: P.textFaint, fontStyle: 'italic', marginBottom: 4 }}>Sample responses</div>
          {f.sample.slice(0, 2).map(function(v, i) {
            return (
              <div key={i} style={{ fontSize: 11, color: P.textMid, background: P.bg, borderRadius: 7, padding: '4px 10px', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderLeft: '3px solid ' + P.accentMid }}>
                {v}
              </div>
            )
          })}
        </div>
      )}
      {f.type === 'numeric' && f.min != null && f.max != null && (
        <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 11, color: P.textFaint }}>
          <span>Min <strong style={{ color: P.textMid }}>{f.min}</strong></span>
          <span>Max <strong style={{ color: P.textMid }}>{f.max}</strong></span>
          {f.avg && <span>Avg <strong style={{ color: P.textMid }}>{f.avg}</strong></span>}
        </div>
      )}
    </div>
  )
}

// Full-width row card
function FieldCard({ f, onTypeChange, onAliasChange, onScoreToggle, readOnly, index }: {
  f:             SchemaFieldConfig
  onTypeChange:  (field: string, baseType: AnaFieldType, sqt: AnaFieldSqt) => void
  onAliasChange: (field: string, alias: string) => void
  onScoreToggle: (field: string) => void
  readOnly?:     boolean
  index:         number
}) {
  const [expanded, setExpanded] = useState(false)
  const [editingAlias, setEditingAlias] = useState(false)
  const [aliasVal, setAliasVal] = useState(f.label || '')
  const ut       = getActiveType(f)
  const isIgnored = f.type === 'ignore' || f.type === 'id'

  function commitAlias() {
    var trimmed = aliasVal.trim()
    onAliasChange(f.field, trimmed === f.field ? '' : trimmed)
    setEditingAlias(false)
  }

  return (
    <div
      onClick={readOnly ? undefined : function() { if (!editingAlias) setExpanded(function(v) { return !v }) }}
      style={{
        background: expanded ? P.white : P.white,
        border: '1px solid ' + (expanded ? ut.color + '60' : P.border),
        borderLeft: '3px solid ' + (expanded ? ut.color : P.border),
        borderRadius: 10,
        padding: '0',
        boxShadow: expanded ? '0 2px 12px rgba(0,0,0,.06)' : '0 1px 2px rgba(0,0,0,.03)',
        cursor: readOnly ? 'default' : 'pointer',
        transition: 'all .15s',
        opacity: isIgnored ? 0.55 : 1,
      }}>

      {/* Row header — always visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '10px 14px' }}>

        {/* Index number */}
        <div style={{ width: 22, fontSize: 10, fontWeight: 700, color: P.textFaint, flexShrink: 0, userSelect: 'none' as const }}>
          {index + 1}
        </div>

        {/* Type icon square */}
        <div style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: ut.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, color: ut.color, marginRight: 12,
          border: '1px solid ' + ut.color + '30',
        }}>
          {ut.icon}
        </div>

        {/* Field name + inline alias editing */}
        <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
          {editingAlias ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={function(e) { e.stopPropagation() }}>
              <input
                autoFocus
                value={aliasVal}
                onChange={function(e) { setAliasVal(e.target.value) }}
                onKeyDown={function(e) {
                  if (e.key === 'Enter') commitAlias()
                  if (e.key === 'Escape') { setAliasVal(f.label || ''); setEditingAlias(false) }
                }}
                placeholder={f.field}
                style={{ flex: 1, padding: '2px 6px', fontSize: 13, fontWeight: 700, border: '1.5px solid ' + P.accent, borderRadius: 5, outline: 'none', color: P.text, background: P.white, fontFamily: 'inherit', minWidth: 0 }}
              />
              <button onClick={commitAlias}
                style={{ width: 22, height: 22, borderRadius: 5, background: P.accent, color: 'white', border: 'none', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {'\u2713'}
              </button>
              <button onClick={function() { setAliasVal(f.label || ''); setEditingAlias(false) }}
                style={{ width: 22, height: 22, borderRadius: 5, background: P.bg, color: P.textFaint, border: '1px solid ' + P.border, cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {'\u2715'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: P.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.label && f.label !== f.field ? f.label : f.field}
                </div>
                {f.label && f.label !== f.field && (
                  <div style={{ fontSize: 10, color: P.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.field}
                  </div>
                )}
              </div>
              {!readOnly && (
                <button
                  title="Rename field alias"
                  onClick={function(e) { e.stopPropagation(); setAliasVal(f.label || f.field); setEditingAlias(true) }}
                  style={{ width: 20, height: 20, borderRadius: 4, background: 'transparent', border: 'none', color: P.textFaint, cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: 0.5, transition: 'opacity .12s' }}
                  onMouseEnter={function(e) { (e.target as HTMLElement).style.opacity = '1' }}
                  onMouseLeave={function(e) { (e.target as HTMLElement).style.opacity = '0.5' }}>
                  {'\u270E'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Stats */}
        {f.nonNullCount != null && (
          <div style={{ fontSize: 11, color: P.textFaint, marginRight: 20, flexShrink: 0, textAlign: 'right' as const, minWidth: 80 }}>
            <span style={{ color: P.textMid, fontWeight: 600 }}>{f.nonNullCount.toLocaleString()}</span> rows
            {f.uniqueRatio && (
              <div style={{ fontSize: 10 }}>{f.uniqueRatio}% unique</div>
            )}
          </div>
        )}

        {/* Type badge */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
          background: ut.bg, color: ut.color,
          border: '1px solid ' + ut.color + '50',
          whiteSpace: 'nowrap', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', gap: 3,
          marginRight: readOnly ? 0 : 10,
        }}>
          {ut.label}
        </span>

        {/* Scoring flag toggle */}
        {!readOnly && !isIgnored && (f.type === 'numeric' || f.type === 'categorical') && (
          <button
            title={f.scoreField ? 'Remove scoring flag' : 'Flag as scoring field'}
            onClick={function(e) {
              e.stopPropagation()
              onScoreToggle(f.field)
            }}
            style={{
              width: 28, height: 28, borderRadius: 6, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: f.scoreField ? '#fff7ed' : 'transparent',
              border: '1.5px solid ' + (f.scoreField ? '#fb923c' : P.border),
              color: f.scoreField ? '#ea580c' : P.textFaint,
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              marginRight: 4, transition: 'all .12s', opacity: f.scoreField ? 1 : 0.5,
            }}
            onMouseEnter={function(e) { (e.target as HTMLElement).style.opacity = '1' }}
            onMouseLeave={function(e) { if (!f.scoreField) (e.target as HTMLElement).style.opacity = '0.5' }}>
            {'\u2605'}
          </button>
        )}

        {/* Ignore/Include toggle — quick toggle without expanding */}
        {!readOnly && (
          <button
            title={isIgnored ? 'Include this field in analysis' : 'Exclude this field from analysis'}
            onClick={function(e) {
              e.stopPropagation()
              if (isIgnored) {
                // Restore to open-ended as default include type
                onTypeChange(f.field, 'open-ended', 'open-text')
              } else {
                onTypeChange(f.field, 'ignore', null)
              }
            }}
            style={{
              width: 28, height: 28, borderRadius: 6, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isIgnored ? P.bg : '#f0fdf4',
              border: '1.5px solid ' + (isIgnored ? P.border : '#bbf7d0'),
              color: isIgnored ? P.textFaint : '#16a34a',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              marginRight: 10, transition: 'all .12s',
            }}>
            {isIgnored ? '\u2205' : '\u2713'}
          </button>
        )}

        {/* Chevron */}
        {!readOnly && (
          <div style={{ fontSize: 11, color: expanded ? ut.color : P.textFaint, flexShrink: 0, transition: 'transform .15s', transform: expanded ? 'rotate(180deg)' : 'none', lineHeight: 1 }}>
            &#8964;
          </div>
        )}
      </div>

      {/* Expanded editor */}
      {expanded && !readOnly && (
        <div style={{ padding: '0 14px 14px' }} onClick={function(e) { e.stopPropagation() }}>
          <FieldEditor f={f} onTypeChange={onTypeChange} onAliasChange={onAliasChange} />
        </div>
      )}
    </div>
  )
}

// Main SchemaEditor
export default function SchemaEditor({ schema, onChange, readOnly }: Props) {
  const [sortAZ,     setSortAZ]     = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)

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

  function handleScoreToggle(field: string) {
    applyUpdate({ ...schema,
      fields: schema.fields.map(function(f) {
        return f.field === field ? { ...f, scoreField: !f.scoreField } : f
      }) })
  }

  function handleSelectAll() {
    applyUpdate({ ...schema, autoDetected: false, version: schema.version + 1,
      fields: schema.fields.map(function(f) {
        return { ...f, type: 'open-ended' as AnaFieldType, sqt: 'open-text' as AnaFieldSqt }
      }) })
  }

  function handleIgnoreAll() {
    applyUpdate({ ...schema, autoDetected: false, version: schema.version + 1,
      fields: schema.fields.map(function(f) {
        return { ...f, type: 'ignore' as AnaFieldType, sqt: undefined }
      }) })
  }

  async function handleSave() {
    if (!onChange) return
    setSaving(true)
    try {
      const parts     = window.location.pathname.split('/')
      const datasetId = parts[2]
      await fetch('/api/datasets/' + datasetId + '/state', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema_config: schema,
          theme_model:   { themes: [], aiGenerated: false, version: 1 },
          saved_charts:  [],
          saved_stats:   [],
          filter_state:  {},
        }),
      })
      setSaved(true)
      setTimeout(function() { setSaved(false) }, 2200)
    } finally {
      setSaving(false)
    }
  }

  if (!schema.fields || schema.fields.length === 0) {
    return (
      <div style={{ padding: 40, background: P.bg, borderRadius: 12, border: '1px dashed ' + P.border, fontSize: 13, color: P.textMute, textAlign: 'center' }}>
        No schema yet. Upload a dataset or sync a study to auto-detect fields.
      </div>
    )
  }

  // Count per type for filter bar
  const counts: Record<string, number> = {}
  for (const f of schema.fields) {
    const uid = getActiveType(f).id
    counts[uid] = (counts[uid] || 0) + 1
  }

  // Filter + sort
  let display = typeFilter === 'all'
    ? schema.fields
    : schema.fields.filter(function(f) { return getActiveType(f).id === typeFilter })
  if (sortAZ) display = [...display].sort(function(a, b) { return a.field.localeCompare(b.field) })

  const allIgnored  = schema.fields.every(function(f) { return f.type === 'ignore' })
  const allSelected = schema.fields.every(function(f) { return f.type !== 'ignore' })

  const btnBase: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 7,
    cursor: 'pointer', fontFamily: 'inherit', border: '1.5px solid',
    transition: 'all .12s',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: P.text, margin: '0 0 1px' }}>Data Schema</h2>
          <p style={{ fontSize: 12, color: P.textMute, margin: 0 }}>
            {schema.fields.length} fields &middot; {display.length} shown
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={function() { setSortAZ(function(v) { return !v }) }}
            style={{ ...btnBase, background: sortAZ ? P.accentBg : 'transparent', color: sortAZ ? P.accent : P.textMute, borderColor: sortAZ ? P.accent : P.border }}>
            {sortAZ ? '\u2195 Original' : 'A\u2013Z'}
          </button>
          {!readOnly && (
            <button onClick={handleSelectAll}
              style={{ ...btnBase, background: allSelected ? P.accentBg : 'transparent', color: allSelected ? P.accent : P.textMute, borderColor: allSelected ? P.accent : P.border }}>
              Select All
            </button>
          )}
          {!readOnly && (
            <button onClick={handleIgnoreAll}
              style={{ ...btnBase, background: allIgnored ? P.bg : 'transparent', color: allIgnored ? P.textMid : P.textMute, borderColor: allIgnored ? P.borderMid : P.border }}>
              Ignore All
            </button>
          )}
          {!readOnly && onChange && (
            <button onClick={handleSave} disabled={saving}
              style={{ ...btnBase, fontSize: 12, padding: '5px 18px', borderRadius: 9, background: saving ? P.accentBg : HERMES, color: saving ? P.accent : 'white', borderColor: HERMES, opacity: saving ? 0.7 : 1 }}>
              {saved ? '\u2713 Saved' : saving ? 'Saving...' : 'Save Schema'}
            </button>
          )}
        </div>
      </div>

      {/* Auto-detect notice */}
      {schema.autoDetected && (
        <div style={{ padding: '8px 13px', background: P.amberBg, border: '1px solid ' + P.amberBorder, borderRadius: 8, marginBottom: 12, fontSize: 11, color: P.amber, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13 }}>&#9888;</span>
          Field types were auto-detected. Click any row to review and confirm.
        </div>
      )}

      {/* Type filter bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
        <button onClick={function() { setTypeFilter('all') }}
          style={{ ...btnBase, padding: '3px 11px', fontWeight: typeFilter === 'all' ? 700 : 500, background: typeFilter === 'all' ? P.text : 'transparent', color: typeFilter === 'all' ? 'white' : P.textMute, borderColor: typeFilter === 'all' ? P.text : P.border }}>
          All ({schema.fields.length})
        </button>
        {Object.entries(counts).map(function([uid, n]) {
          const ut = UNIFIED_TYPES.find(function(u) { return u.id === uid })
          if (!ut) return null
          const active = typeFilter === uid
          return (
            <button key={uid} onClick={function() { setTypeFilter(active ? 'all' : uid) }}
              style={{ ...btnBase, padding: '3px 11px', fontWeight: active ? 700 : 500, background: active ? ut.bg : 'transparent', color: active ? ut.color : P.textMute, borderColor: active ? ut.color : P.border }}>
              {ut.icon} {ut.label} ({n})
            </button>
          )
        })}
      </div>

      {/* Full-width row list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {display.map(function(f, i) {
          return (
            <FieldCard key={f.field} f={f} index={i}
              onTypeChange={handleTypeChange}
              onAliasChange={handleAliasChange}
              onScoreToggle={handleScoreToggle}
              readOnly={readOnly}
            />
          )
        })}
      </div>

      {display.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: P.textFaint }}>
          No fields match this filter.
        </div>
      )}
    </div>
  )
}
