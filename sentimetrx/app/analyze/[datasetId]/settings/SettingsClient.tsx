'use client'

// app/analyze/[datasetId]/settings/SettingsClient.tsx
// Rename, visibility, schema editor, archive, delete

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import SchemaEditor from '@/components/analyze/SchemaEditor'
import type { SchemaConfig, Dataset } from '@/lib/analyzeTypes'

interface Props {
  dataset:  Pick<Dataset, 'id' | 'name' | 'description' | 'visibility' | 'status' | 'row_count'>
  schema:   SchemaConfig
  isOwner:  boolean
}

const HERMES = '#E8632A'

export default function SettingsClient({ dataset, schema: initialSchema, isOwner }: Props) {
  const router = useRouter()

  const [name,        setName]        = useState(dataset.name)
  const [description, setDescription] = useState(dataset.description || '')
  const [visibility,  setVisibility]  = useState<'private' | 'public'>(dataset.visibility)
  const [schema,      setSchema]      = useState<SchemaConfig>(initialSchema)
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [delConfirm,  setDelConfirm]  = useState(false)
  const [deleting,    setDeleting]    = useState(false)
  const [error,       setError]       = useState('')

  async function handleSaveDetails() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/datasets/' + dataset.id, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: name.trim(), description: description || null, visibility }),
      })
      if (!res.ok) { setError('Failed to save'); return }
      setSaved(true)
      setTimeout(function() { setSaved(false) }, 2000)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveSchema(updated: SchemaConfig) {
    setSchema(updated)
    await fetch('/api/datasets/' + dataset.id + '/state', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ schema_config: updated }),
    })
  }

  async function handleArchive() {
    const newStatus = dataset.status === 'active' ? 'archived' : 'active'
    await fetch('/api/datasets/' + dataset.id, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: newStatus }),
    })
    router.refresh()
  }

  async function handleDelete() {
    if (!delConfirm) { setDelConfirm(true); return }
    setDeleting(true)
    try {
      const res = await fetch('/api/datasets/' + dataset.id, { method: 'DELETE' })
      if (res.ok) {
        router.push('/analyze')
      } else {
        setError('Failed to delete dataset')
        setDeleting(false)
      }
    } catch {
      setError('Unexpected error')
      setDeleting(false)
    }
  }

  const inputCls = 'w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-800 outline-none focus:border-orange-400 transition-colors'

  return (
    <div className="flex flex-col gap-6 py-6 max-w-2xl">

      {/* Details */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
        <h2 className="font-bold text-gray-800">Details</h2>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-gray-700">Name</label>
          <input value={name} onChange={function(e) { setName(e.target.value) }} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-gray-700">Description <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea
            value={description}
            onChange={function(e) { setDescription(e.target.value) }}
            rows={2}
            className={inputCls + ' resize-none'}
          />
        </div>
        <button
          onClick={handleSaveDetails}
          disabled={saving || !name.trim()}
          className="self-start px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all hover:opacity-90"
          style={{ background: HERMES }}
        >
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Update details'}
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {/* Visibility */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
        <h2 className="font-bold text-gray-800">Visibility</h2>
        <div className="flex gap-3">
          {(['private', 'public'] as const).map(function(v) {
            return (
              <label key={v} className={'flex items-center gap-2.5 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ' +
                (visibility === v ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-gray-300')}>
                <input type="radio" name="visibility" value={v} checked={visibility === v}
                  onChange={function() { setVisibility(v) }} className="accent-orange-500" />
                <div>
                  <p className="text-sm font-semibold text-gray-700">{v.charAt(0).toUpperCase() + v.slice(1)}</p>
                  <p className="text-xs text-gray-400">{v === 'private' ? 'Only your org can access this dataset' : 'Visible to anyone with the link'}</p>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* Schema editor */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
        <div>
          <h2 className="font-bold text-gray-800">Schema</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Assign field types to control how each column is used in analysis.
            {dataset.row_count > 0 && (' ' + dataset.row_count.toLocaleString() + ' rows loaded.')}
          </p>
        </div>
        <SchemaEditor schema={schema} onChange={handleSaveSchema} />
      </div>

      {/* Danger zone */}
      {isOwner && (
        <div className="bg-white border border-red-200 rounded-2xl p-6 flex flex-col gap-4">
          <h2 className="font-bold text-red-600">Danger zone</h2>
          <div className="flex items-center justify-between gap-4 py-3 border-t border-gray-100">
            <div>
              <p className="text-sm font-semibold text-gray-700">
                {dataset.status === 'active' ? 'Archive dataset' : 'Restore dataset'}
              </p>
              <p className="text-xs text-gray-400">
                {dataset.status === 'active'
                  ? 'Hides the dataset from the main list. Reversible.'
                  : 'Restore this dataset to active status.'}
              </p>
            </div>
            <button
              onClick={handleArchive}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors flex-shrink-0"
            >
              {dataset.status === 'active' ? 'Archive' : 'Restore'}
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 py-3 border-t border-gray-100">
            <div>
              <p className="text-sm font-semibold text-gray-700">Delete dataset</p>
              <p className="text-xs text-gray-400">Permanently deletes all rows and analysis state. This cannot be undone.</p>
            </div>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={'px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-shrink-0 ' +
                (delConfirm ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100')}
            >
              {deleting ? 'Deleting...' : delConfirm ? 'Confirm delete' : 'Delete'}
            </button>
          </div>
          {delConfirm && (
            <button onClick={function() { setDelConfirm(false) }} className="text-xs text-gray-400 self-start">
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}
