'use client'

// components/analyze/SchemaEditor.tsx
// Phase 1: read-only display of field types with editable dropdowns
// Phase 2: full Ana schema editor with remapping + derived fields

import { useState } from 'react'
import type { SchemaConfig, SchemaFieldConfig, AnaFieldType } from '@/lib/analyzeTypes'

interface Props {
  schema:    SchemaConfig
  onChange?: (s: SchemaConfig) => void
  readOnly?: boolean
}

const HERMES = '#E8632A'

const FIELD_TYPES: AnaFieldType[] = ['open-ended', 'categorical', 'numeric', 'date', 'id', 'ignore']

const TYPE_COLORS: Record<AnaFieldType, string> = {
  'open-ended':  'bg-purple-50 text-purple-700 border-purple-200',
  'categorical': 'bg-blue-50 text-blue-700 border-blue-200',
  'numeric':     'bg-green-50 text-green-700 border-green-200',
  'date':        'bg-amber-50 text-amber-700 border-amber-200',
  'id':          'bg-gray-50 text-gray-500 border-gray-200',
  'ignore':      'bg-red-50 text-red-500 border-red-200',
}

function FieldRow({ field, onTypeChange, readOnly }: {
  field: SchemaFieldConfig
  onTypeChange: (type: AnaFieldType) => void
  readOnly?: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50/50 transition-colors">
      <span className="flex-1 text-sm font-mono text-gray-700 truncate">{field.field}</span>
      {field.label && (
        <span className="text-xs text-gray-400 truncate max-w-32">{field.label}</span>
      )}
      {readOnly ? (
        <span className={'text-xs font-semibold px-2.5 py-1 rounded-full border ' + TYPE_COLORS[field.type]}>
          {field.type}
        </span>
      ) : (
        <select
          value={field.type}
          onChange={function(e) { onTypeChange(e.target.value as AnaFieldType) }}
          className={'text-xs font-semibold px-2 py-1 rounded-lg border outline-none cursor-pointer ' + TYPE_COLORS[field.type]}
        >
          {FIELD_TYPES.map(function(t) {
            return <option key={t} value={t}>{t}</option>
          })}
        </select>
      )}
    </div>
  )
}

export default function SchemaEditor({ schema, onChange, readOnly }: Props) {
  const [saving, setSaving] = useState(false)

  function handleTypeChange(fieldName: string, newType: AnaFieldType) {
    if (!onChange) return
    const updated: SchemaConfig = {
      ...schema,
      fields: schema.fields.map(function(f) {
        return f.field === fieldName ? { ...f, type: newType } : f
      }),
      version: schema.version + 1,
      autoDetected: false,
    }
    onChange(updated)
  }

  async function handleSave() {
    if (!onChange) return
    setSaving(true)
    try {
      await fetch(window.location.pathname.replace('/settings', '') + '/state', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ schema_config: schema }),
      })
    } finally {
      setSaving(false)
    }
  }

  if (!schema.fields || schema.fields.length === 0) {
    return (
      <div className="text-center py-10 text-gray-400 text-sm">
        No schema configured yet. Upload a dataset or sync a study to populate the schema.
      </div>
    )
  }

  const primaryField = schema.primaryTextField

  return (
    <div className="flex flex-col gap-4">
      {schema.autoDetected && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <span className="text-amber-500 text-sm">i</span>
          <span className="text-xs text-amber-700 font-medium">
            Field types were auto-detected. Review and confirm before analysis.
          </span>
        </div>
      )}

      {primaryField && (
        <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-xl px-4 py-2.5">
          <span className="text-purple-500 text-sm">T</span>
          <span className="text-xs text-purple-700 font-medium">
            TextMine primary field: <span className="font-mono">{primaryField}</span>
          </span>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-bold text-gray-700">{schema.fields.length} fields</span>
          <span className="text-xs text-gray-400">v{schema.version}</span>
        </div>
        {schema.fields.map(function(f) {
          return (
            <FieldRow
              key={f.field}
              field={f}
              onTypeChange={function(t) { handleTypeChange(f.field, t) }}
              readOnly={readOnly}
            />
          )
        })}
      </div>

      {!readOnly && onChange && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="self-start px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all hover:opacity-90"
          style={{ background: HERMES }}
        >
          {saving ? 'Saving...' : 'Save schema'}
        </button>
      )}
    </div>
  )
}
