'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import SchemaEditor from '@/components/analyze/SchemaEditor'
import type { SchemaConfig, DatasetState } from '@/lib/analyzeTypes'

interface DatasetMeta {
  id:          string
  name:        string
  description: string | null
  visibility:  'private' | 'public'
  status:      string
  row_count:   number
  created_by:  string
}

interface Props {
  dataset:       DatasetMeta
  state:         DatasetState | null
  datasetId:     string
  isOwner:       boolean
  isNewDataset:  boolean
}

const HERMES = '#E8632A'

export default function SettingsClient({ dataset, state, datasetId, isOwner, isNewDataset }: Props) {
  const router = useRouter()

  const [name, setName]               = useState(dataset.name)
  const [description, setDescription] = useState(dataset.description || '')
  const [visibility, setVisibility]   = useState<'private' | 'public'>(dataset.visibility)
  const [savingMeta, setSavingMeta]   = useState(false)
  const [metaSaved, setMetaSaved]     = useState(false)

  const [savingSchema, setSavingSchema] = useState(false)

  const [deleting, setDeleting]   = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const schema = (state?.schema_config as SchemaConfig | null) || null

  async function handleSaveMeta() {
    setSavingMeta(true)
    await fetch('/api/datasets/' + datasetId, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: name.trim(), description: description.trim() || null, visibility }),
    })
    setSavingMeta(false)
    setMetaSaved(true)
    setTimeout(() => setMetaSaved(false), 2000)
    router.refresh()
  }

  async function handleSaveSchema(updated: SchemaConfig) {
    setSavingSchema(true)
    await fetch('/api/datasets/' + datasetId + '/state', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...state, schema_config: updated }),
    })
    setSavingSchema(false)
    router.refresh()
  }

  async function handleDelete() {
    if (deleteConfirm !== dataset.name) return
    setDeleting(true)
    await fetch('/api/datasets/' + datasetId, { method: 'DELETE' })
    router.push('/analyze')
  }

  return (
    <div className="max-w-2xl flex flex-col gap-8">

      {/* New dataset banner */}
      {isNewDataset && schema && schema.autoDetected && (
        <div className="rounded-xl border border-orange-200 p-4 text-sm"
          style={{ background: '#fff4ef' }}>
          <p className="font-medium text-orange-800">Dataset created. Field types were auto-detected.</p>
          <p className="text-orange-700 mt-0.5">Review the schema below and confirm field types before analyzing.</p>
        </div>
      )}

      {/* Details */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Details</h2>
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
              disabled={!isOwner} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
              placeholder="Optional" disabled={!isOwner} />
          </div>
          {isOwner && (
            <div className="flex items-center gap-3">
              <button onClick={handleSaveMeta} disabled={savingMeta}
                className="text-sm font-medium px-4 py-2 rounded-lg text-white"
                style={{ background: HERMES }}>
                {savingMeta ? 'Saving...' : 'Save changes'}
              </button>
              {metaSaved && <span className="text-sm text-green-600">Saved</span>}
            </div>
          )}
        </div>
      </section>

      {/* Visibility */}
      {isOwner && (
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-1">Visibility</h2>
          <p className="text-sm text-gray-500 mb-4">
            Private datasets are only visible to you and org members with Analyze access.
            Public datasets can be viewed (read-only) by anyone in your org.
          </p>
          <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3">
            <VisibilityToggle value={visibility} onChange={v => { setVisibility(v); setSavingMeta(false) }} />
            <button onClick={handleSaveMeta} disabled={savingMeta}
              className="self-start text-sm font-medium px-4 py-2 rounded-lg text-white"
              style={{ background: HERMES }}>
              {savingMeta ? 'Saving...' : 'Save visibility'}
            </button>
          </div>
        </section>
      )}

      {/* Schema editor */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Field Schema</h2>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          {schema && schema.fields.length > 0 ? (
            <SchemaEditor schema={schema} onSave={handleSaveSchema} isSaving={savingSchema} />
          ) : (
            <p className="text-sm text-gray-400">
              No schema yet. Upload data or sync a study to get started.
            </p>
          )}
        </div>
      </section>

      {/* Danger zone */}
      {isOwner && (
        <section>
          <h2 className="text-base font-semibold text-red-600 mb-4">Danger Zone</h2>
          <div className="bg-white rounded-xl border border-red-200 p-5 flex flex-col gap-4">

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">Delete dataset</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Permanently deletes all rows and analysis state. Cannot be undone.
                </p>
              </div>
              <button onClick={() => setShowDelete(true)}
                className="text-sm font-medium px-3 py-1.5 rounded-lg text-red-600 border border-red-200 hover:bg-red-50 transition-colors">
                Delete
              </button>
            </div>

            {showDelete && (
              <div className="border-t border-red-100 pt-4 flex flex-col gap-3">
                <p className="text-sm text-gray-700">
                  Type <strong>{dataset.name}</strong> to confirm deletion:
                </p>
                <input type="text" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                  className="border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400"
                  placeholder="Type dataset name to confirm" />
                <div className="flex gap-2">
                  <button onClick={handleDelete}
                    disabled={deleteConfirm !== dataset.name || deleting}
                    className="text-sm font-medium px-4 py-2 rounded-lg text-white bg-red-600 disabled:opacity-40">
                    {deleting ? 'Deleting...' : 'Confirm delete'}
                  </button>
                  <button onClick={() => { setShowDelete(false); setDeleteConfirm('') }}
                    className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function VisibilityToggle({ value, onChange }: {
  value:    'private' | 'public'
  onChange: (v: 'private' | 'public') => void
}) {
  return (
    <div className="flex gap-3">
      <button onClick={() => onChange('private')}
        className={"flex-1 text-left border rounded-lg px-4 py-3 transition-colors " +
          (value === 'private' ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-orange-200')}>
        <p className={"text-sm font-medium " + (value === 'private' ? 'text-orange-700' : 'text-gray-700')}>Private</p>
        <p className="text-xs text-gray-500 mt-0.5">Only you and org members</p>
      </button>
      <button onClick={() => onChange('public')}
        className={"flex-1 text-left border rounded-lg px-4 py-3 transition-colors " +
          (value === 'public' ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-orange-200')}>
        <p className={"text-sm font-medium " + (value === 'public' ? 'text-orange-700' : 'text-gray-700')}>Public</p>
        <p className="text-xs text-gray-500 mt-0.5">Anyone in your org can view</p>
      </button>
    </div>
  )
}
