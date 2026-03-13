'use client'

// components/analyze/SchemaEditor.tsx
// Ana-style schema editor matching Ana.html SchemaTab

import { useState } from 'react'
import type { SchemaConfig, SchemaFieldConfig, AnaFieldType, AnaFieldSqt } from '@/lib/analyzeTypes'

interface Props {
  schema:    SchemaConfig
  onChange?: (s: SchemaConfig) => void
  readOnly?: boolean
}

// Matches Ana's UNIFIED_TYPES
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
  { id: 'open-text',     label: 'Open Text',     icon: 'T',  baseType: 'open-ended',  sqt: 'open-text',     color: '#2563eb', bg: '#eff6ff', desc: 'Free text / verbatim response' },
  { id: 'single-select', label: 'Single Select', icon: 'o',  baseType: 'categorical', sqt: 'single-select', color: '#7c3aed', bg: '#f5f3ff', desc: 'One choice from a list' },
  { id: 'multi-select',  label: 'Multi Select',  icon: 'M',  baseType: 'categorical', sqt: 'multi-select',  color: '#0891b2', bg: '#ecfeff', desc: 'Multiple choices allowed' },
  { id: 'likert',        label: 'Likert',         icon: 'L',  baseType: 'categorical', sqt: 'likert',        color: '#059669', bg: '#ecfdf5', desc: 'Agreement / satisfaction scale' },
  { id: 'rating',        label: 'Rating Scale',  icon: '*',  baseType: 'numeric',     sqt: 'rating',        color: '#d97706', bg: '#fffbeb', desc: 'Numeric scale (1-5, 1-10)' },
  { id: 'nps',           label: 'NPS',            icon: 'N',  baseType: 'numeric',     sqt: 'nps',           color: '#e8622a', bg: '#fff4ef', desc: 'Net Promoter Score (0-10)' },
  { id: 'numeric-input', label: 'Numeric',        icon: '#',  baseType: 'numeric',     sqt: 'numeric-input', color: '#16a34a', bg: '#f0fdf4', desc: 'Free numeric entry' },
  { id: 'date',          label: 'Date',           icon: 'D',  baseType: 'date',        sqt: null,            color: '#d97706', bg: '#fffbeb', desc: 'Date or time field' },
  { id: 'id',            label: 'ID',             icon: 'i',  baseType: 'id',          sqt: null,            color: '#6b7280', bg: '#f9fafb', desc: 'Unique identifier -- excluded from analysis' },
  { id: 'ignore',        label: 'Ignore',         icon: 'x',  baseType: 'ignore',      sqt: null,            color: '#6b7280', bg: '#f9fafb', desc: 'Exclude this field entirely' },
]

const PREVIEW_COLS = 8
const HERMES = '#e8622a'

function getActiveType(f: SchemaFieldConfig): UnifiedType {
  // Match by sqt first, then baseType
  if (f.sqt) {
    const bySqt = UNIFIED_TYPES.find(function(u) { return u.sqt === f.sqt })
    if (bySqt) return bySqt
  }
  const byBase = UNIFIED_TYPES.find(function(u) { return u.baseType === f.type && !u.sqt })
    || UNIFIED_TYPES.find(function(u) { return u.baseType === f.type })
    || UNIFIED_TYPES[UNIFIED_TYPES.length - 1]
  return byBase
}

// Summary badge count by type
function TypeSummary({ schema }: { schema: SchemaConfig }) {
  const counts: Record<string, number> = {}
  for (const f of schema.fields) {
    const ut = getActiveType(f)
    counts[ut.id] = (counts[ut.id] || 0) + 1
  }
  const entries = Object.entries(counts)
  if (!entries.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      {entries.map(function([uid, n]) {
        const ut = UNIFIED_TYPES.find(function(u) { return u.id === uid })
        if (!ut) return null
        return (
          <span
            key={uid}
            className="text-xs font-semibold px-2.5 py-1 rounded-full border"
            style={{ background: ut.bg, color: ut.color, borderColor: ut.color + '40' }}
          >
            {ut.icon} {n} {ut.label}
          </span>
        )
      })}
    </div>
  )
}

// Value pills with expand/collapse
function ValuePills({ values, fieldKey }: { values: string[], fieldKey: string }) {
  const [expanded, setExpanded] = useState(false)
  const shown  = expanded ? values : values.slice(0, PREVIEW_COLS)
  const hidden = values.length - PREVIEW_COLS
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {shown.map(function(v) {
        return (
          <span key={v} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 bg-gray-50 text-gray-500 whitespace-nowrap">
            {v}
          </span>
        )
      })}
      {!expanded && hidden > 0 && (
        <button
          onClick={function() { setExpanded(true) }}
          className="text-xs px-2.5 py-1 rounded-md font-semibold border"
          style={{ background: '#fff4ef', color: HERMES, borderColor: '#fbd5c2' }}
        >
          +{hidden} more
        </button>
      )}
      {expanded && values.length > PREVIEW_COLS && (
        <button
          onClick={function() { setExpanded(false) }}
          className="text-xs font-semibold text-gray-400 bg-transparent border-0 cursor-pointer"
        >
          show less
        </button>
      )}
    </div>
  )
}

// Single field card
function FieldCard({
  f,
  onTypeChange,
  onAliasChange,
  readOnly,
}: {
  f:             SchemaFieldConfig
  onTypeChange:  (field: string, baseType: AnaFieldType, sqt: AnaFieldSqt) => void
  onAliasChange: (field: string, alias: string) => void
  readOnly?:     boolean
}) {
  const activeType = getActiveType(f)
  const hasValues  = f.values && f.values.length > 0
  const hasSample  = f.sample && f.sample.length > 0
  const showValues = hasValues && (f.type === 'categorical' || f.type === 'date' || f.type === 'id' || f.type === 'ignore')

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-3 shadow-sm">

      {/* Field header row */}
      <div className="flex items-center gap-3 mb-4">

        {/* Type icon square */}
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black flex-shrink-0"
          style={{ background: activeType.bg, color: activeType.color }}
        >
          {activeType.icon}
        </div>

        {/* Name + stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-gray-800">{f.field}</span>
            {f.label && (
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full border"
                style={{ background: '#fff4ef', color: HERMES, borderColor: '#fbd5c2' }}
              >
                {'->'} {f.label}
              </span>
            )}
          </div>
          {f.nonNullCount != null && (
            <div className="text-xs text-gray-400 mt-0.5">
              {f.nonNullCount} values
              {f.avgLen ? (' · avg ' + f.avgLen + ' chars') : ''}
              {f.avgWords ? (' · avg ' + f.avgWords + ' words') : ''}
              {f.uniqueRatio ? (' · ' + f.uniqueRatio + '% unique') : ''}
            </div>
          )}
        </div>

        {/* Current type badge */}
        <span
          className="text-xs font-bold px-2.5 py-1 rounded-full border flex-shrink-0"
          style={{ background: activeType.bg, color: activeType.color, borderColor: activeType.color + '40' }}
        >
          {activeType.icon} {activeType.label}
          {!f.sqt && f.type !== 'date' && f.type !== 'id' && f.type !== 'ignore' && (
            <span className="opacity-60 font-normal text-xs ml-1">(auto)</span>
          )}
        </span>
      </div>

      {/* Export alias input */}
      <div className="mb-3">
        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">
          Export Column Alias <span className="font-normal normal-case text-gray-300">(optional rename for exports)</span>
        </label>
        <input
          value={f.label || ''}
          onChange={function(e) { onAliasChange(f.field, e.target.value) }}
          placeholder={f.field}
          disabled={readOnly}
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-700 outline-none focus:border-orange-400 transition-colors disabled:opacity-50"
        />
      </div>

      {/* Field type picker */}
      {!readOnly && (
        <div className="mb-2">
          <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
            Field Type
          </label>
          <div className="flex flex-wrap gap-1.5">
            {UNIFIED_TYPES.map(function(ut) {
              const isActive = activeType.id === ut.id
              return (
                <button
                  key={ut.id}
                  title={ut.desc}
                  onClick={function() { onTypeChange(f.field, ut.baseType, ut.sqt) }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all"
                  style={{
                    background:   isActive ? ut.bg : 'transparent',
                    color:        isActive ? ut.color : '#6b7280',
                    borderColor:  isActive ? ut.color : '#e5e7eb',
                    borderWidth:  isActive ? '1.5px' : '1px',
                    fontWeight:   isActive ? 700 : 500,
                  }}
                >
                  {ut.icon} {ut.label}
                  {isActive && !f.sqt && ut.sqt && (
                    <span className="ml-1 opacity-60 text-xs font-normal">(auto)</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Value preview for categorical/date/id/ignore */}
      {showValues && f.values && f.values.length > 0 && (
        <div className="mt-3">
          {(f.type === 'id' || f.type === 'ignore') && (
            <p className="text-xs text-gray-400 italic mb-1.5">
              {f.type === 'id' ? 'Identifier field -- excluded' : 'Field excluded from analysis'}
            </p>
          )}
          <ValuePills values={f.values} fieldKey={f.field} />
        </div>
      )}

      {/* Sample values for open-ended */}
      {!showValues && hasSample && (f.type === 'open-ended') && (
        <div className="mt-3">
          <p className="text-xs text-gray-400 italic mb-1.5">Sample responses</p>
          <div className="flex flex-col gap-1">
            {(f.sample || []).slice(0, 3).map(function(v, i) {
              return (
                <p key={i} className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-1.5 truncate">
                  {v}
                </p>
              )
            })}
          </div>
        </div>
      )}

      {/* Numeric range */}
      {f.type === 'numeric' && f.min != null && f.max != null && (
        <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
          <span>Min <span className="font-semibold text-gray-600">{f.min}</span></span>
          <span>Max <span className="font-semibold text-gray-600">{f.max}</span></span>
          {f.avg && <span>Avg <span className="font-semibold text-gray-600">{f.avg}</span></span>}
        </div>
      )}
    </div>
  )
}

export default function SchemaEditor({ schema, onChange, readOnly }: Props) {
  const [sortAZ,   setSortAZ]   = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  const displaySchema = sortAZ
    ? [...schema.fields].sort(function(a, b) { return a.field.localeCompare(b.field) })
    : schema.fields

  function updateSchema(updated: SchemaConfig) {
    if (onChange) onChange(updated)
  }

  function handleTypeChange(field: string, baseType: AnaFieldType, sqt: AnaFieldSqt) {
    const next: SchemaConfig = {
      ...schema,
      autoDetected: false,
      version:      schema.version + 1,
      fields: schema.fields.map(function(f) {
        return f.field === field ? { ...f, type: baseType, sqt: sqt || undefined } : f
      }),
    }
    updateSchema(next)
  }

  function handleAliasChange(field: string, alias: string) {
    const next: SchemaConfig = {
      ...schema,
      fields: schema.fields.map(function(f) {
        return f.field === field ? { ...f, label: alias || undefined } : f
      }),
    }
    updateSchema(next)
  }

  function handleSelectAll() {
    const next: SchemaConfig = {
      ...schema,
      autoDetected: false,
      version:      schema.version + 1,
      fields: schema.fields.map(function(f) {
        return { ...f, type: 'open-ended' as AnaFieldType, sqt: 'open-text' as AnaFieldSqt }
      }),
    }
    updateSchema(next)
  }

  function handleIgnoreAll() {
    const next: SchemaConfig = {
      ...schema,
      autoDetected: false,
      version:      schema.version + 1,
      fields: schema.fields.map(function(f) {
        return { ...f, type: 'ignore' as AnaFieldType, sqt: undefined }
      }),
    }
    updateSchema(next)
  }

  async function handleSave() {
    if (!onChange) return
    setSaving(true)
    try {
      const datasetId = window.location.pathname.split('/')[2]
      await fetch('/api/datasets/' + datasetId + '/state', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          schema_config: schema,
          theme_model:   { themes: [], aiGenerated: false, version: 1 },
          saved_charts:  [],
          saved_stats:   [],
          filter_state:  {},
        }),
      })
      setSaved(true)
      setTimeout(function() { setSaved(false) }, 2000)
    } finally {
      setSaving(false)
    }
  }

  if (!schema.fields || schema.fields.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm bg-gray-50 border border-dashed border-gray-200 rounded-2xl">
        No schema configured yet. Upload a dataset or sync a study to auto-detect fields.
      </div>
    )
  }

  const allIgnored  = schema.fields.length > 0 && schema.fields.every(function(f) { return f.type === 'ignore' })
  const allSelected = schema.fields.length > 0 && schema.fields.every(function(f) { return f.type !== 'ignore' })

  return (
    <div>

      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <h2 className="text-xl font-black text-gray-800">Data Schema</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Set field types to control how each column is analysed.
          </p>
          <div className="mt-3">
            <TypeSummary schema={schema} />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={function() { setSortAZ(function(v) { return !v }) }}
            className="text-xs font-bold px-3 py-1.5 rounded-lg border transition-all"
            style={{
              background:  sortAZ ? '#fff4ef' : 'transparent',
              color:       sortAZ ? HERMES : '#6b7280',
              borderColor: sortAZ ? HERMES : '#e5e7eb',
            }}
          >
            {sortAZ ? 'Original' : 'A-Z'}
          </button>
          {!readOnly && (
            <>
              <button
                onClick={handleSelectAll}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition-colors"
                style={{ opacity: allSelected ? 0.4 : 1 }}
              >
                Select All
              </button>
              <button
                onClick={handleIgnoreAll}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition-colors"
                style={{ opacity: allIgnored ? 0.4 : 1 }}
              >
                Ignore All
              </button>
            </>
          )}
        </div>
      </div>

      {/* Auto-detected notice */}
      {schema.autoDetected && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4">
          <span className="text-amber-500 font-bold text-sm">!</span>
          <span className="text-xs text-amber-700 font-medium">
            Field types were auto-detected. Review and confirm before running analysis.
          </span>
        </div>
      )}

      {/* Field cards */}
      <div>
        {displaySchema.map(function(f) {
          return (
            <FieldCard
              key={f.field}
              f={f}
              onTypeChange={handleTypeChange}
              onAliasChange={handleAliasChange}
              readOnly={readOnly}
            />
          )
        })}
      </div>

      {/* Save button */}
      {!readOnly && onChange && (
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all hover:opacity-90"
            style={{ background: HERMES }}
          >
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save schema'}
          </button>
          <span className="text-xs text-gray-400">
            {schema.fields.length} fields · v{schema.version}
          </span>
        </div>
      )}
    </div>
  )
}
