'use client'

import { useState } from 'react'
import type { SchemaConfig, SchemaFieldConfig, AnaFieldType } from '@/lib/analyzeTypes'

interface Props {
  schema:      SchemaConfig
  onSave:      (schema: SchemaConfig) => Promise<void>
  isSaving?:   boolean
}

const FIELD_TYPES: AnaFieldType[] = ['open-ended', 'categorical', 'numeric', 'date', 'id', 'ignore']

const TYPE_COLORS: Record<AnaFieldType, string> = {
  'open-ended':   'bg-purple-100 text-purple-700',
  'categorical':  'bg-blue-100 text-blue-700',
  'numeric':      'bg-green-100 text-green-700',
  'date':         'bg-amber-100 text-amber-700',
  'id':           'bg-gray-100 text-gray-500',
  'ignore':       'bg-red-50 text-red-400',
}

export default function SchemaEditor({ schema, onSave, isSaving }: Props) {
  const [fields, setFields] = useState<SchemaFieldConfig[]>(schema.fields)
  const [dirty, setDirty]   = useState(false)

  function updateFieldType(index: number, type: AnaFieldType) {
    const next = fields.map((f, i) => i === index ? { ...f, type } : f)
    setFields(next)
    setDirty(true)
  }

  function updateFieldLabel(index: number, label: string) {
    const next = fields.map((f, i) => i === index ? { ...f, label } : f)
    setFields(next)
    setDirty(true)
  }

  function toggleHidden(index: number) {
    const next = fields.map((f, i) => i === index ? { ...f, hidden: !f.hidden } : f)
    setFields(next)
    setDirty(true)
  }

  async function handleSave() {
    const updated: SchemaConfig = {
      ...schema,
      fields,
      autoDetected: false,
      version: schema.version + 1,
    }
    await onSave(updated)
    setDirty(false)
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">Field Schema</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {schema.autoDetected
              ? 'Types were auto-detected. Review and confirm before analyzing.'
              : 'Schema confirmed — version ' + schema.version + '.'}
          </p>
        </div>
        {dirty && (
          <button onClick={handleSave} disabled={isSaving}
            className="text-sm font-medium px-4 py-1.5 rounded-lg text-white transition-opacity"
            style={{ background: '#E8632A', opacity: isSaving ? 0.6 : 1 }}>
            {isSaving ? 'Saving...' : 'Save schema'}
          </button>
        )}
      </div>

      {/* Fields table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-1/3">Field</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-1/4">Type</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">Display label</th>
              <th className="text-center px-4 py-2.5 font-medium text-gray-600 w-20">Hide</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <FieldRow
                key={f.field}
                field={f}
                index={i}
                onTypeChange={updateFieldType}
                onLabelChange={updateFieldLabel}
                onToggleHidden={toggleHidden}
              />
            ))}
          </tbody>
        </table>
      </div>

      {fields.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-6">
          No fields detected. Upload a dataset to get started.
        </p>
      )}
    </div>
  )
}

// Extracted as named function per SWC rules
function FieldRow({ field, index, onTypeChange, onLabelChange, onToggleHidden }: {
  field:           SchemaFieldConfig
  index:           number
  onTypeChange:    (i: number, t: AnaFieldType) => void
  onLabelChange:   (i: number, l: string) => void
  onToggleHidden:  (i: number) => void
}) {
  const TYPE_COLORS: Record<AnaFieldType, string> = {
    'open-ended':  'bg-purple-100 text-purple-700',
    'categorical': 'bg-blue-100 text-blue-700',
    'numeric':     'bg-green-100 text-green-700',
    'date':        'bg-amber-100 text-amber-700',
    'id':          'bg-gray-100 text-gray-500',
    'ignore':      'bg-red-50 text-red-400',
  }
  const FIELD_TYPES: AnaFieldType[] = ['open-ended', 'categorical', 'numeric', 'date', 'id', 'ignore']

  return (
    <tr className={"border-b border-gray-100 last:border-0 " + (field.hidden ? 'opacity-40' : '')}>
      <td className="px-4 py-2.5">
        <span className="font-mono text-xs text-gray-700">{field.field}</span>
      </td>
      <td className="px-4 py-2.5">
        <select
          value={field.type}
          onChange={e => onTypeChange(index, e.target.value as AnaFieldType)}
          className={"text-xs px-2 py-1 rounded-full border-0 font-medium cursor-pointer " + TYPE_COLORS[field.type]}>
          {FIELD_TYPES.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5">
        <input
          type="text"
          value={field.label || ''}
          placeholder={field.field}
          onChange={e => onLabelChange(index, e.target.value)}
          className="text-sm text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-orange-400 outline-none w-full transition-colors py-0.5"
        />
      </td>
      <td className="px-4 py-2.5 text-center">
        <input
          type="checkbox"
          checked={!!field.hidden}
          onChange={() => onToggleHidden(index)}
          className="w-4 h-4 accent-orange-500 cursor-pointer"
        />
      </td>
    </tr>
  )
}
