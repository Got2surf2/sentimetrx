'use client'

// app/analyze/[datasetId]/settings/SettingsClient.tsx
// Rename, visibility, schema editor, archive, delete

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import SchemaEditor from '@/components/analyze/SchemaEditor'
import LocationManager from '@/components/analyze/LocationManager'
import UserLocationAssigner from '@/components/analyze/UserLocationAssigner'
import type { SchemaConfig, Dataset } from '@/lib/analyzeTypes'

interface OrgOption { id: string; name: string }

interface Props {
  dataset:    Pick<Dataset, 'id' | 'name' | 'description' | 'source' | 'visibility' | 'status' | 'row_count'>
  schema:     SchemaConfig
  isOwner:    boolean
  isAdmin?:   boolean
  allOrgs?:   OrgOption[]
  reviewSourceId?: string | null
}

const HERMES = '#E8632A'

export default function SettingsClient({ dataset, schema: initialSchema, isOwner, isAdmin = false, allOrgs = [], reviewSourceId = null }: Props) {
  const router = useRouter()

  const [name,        setName]        = useState(dataset.name)
  const [description, setDescription] = useState(dataset.description || '')
  const [visibility,  setVisibility]  = useState<'private' | 'public'>(dataset.visibility)
  const [schema,      setSchema]      = useState<SchemaConfig>(initialSchema)
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [delConfirm,  setDelConfirm]  = useState(false)
  const [deleting,    setDeleting]    = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [transferOrgId, setTransferOrgId] = useState('')
  const [error,       setError]       = useState('')

  // Trim data state
  const [trimField, setTrimField] = useState('')
  const [trimDate, setTrimDate] = useState('')
  const [trimming, setTrimming] = useState(false)
  const [trimResult, setTrimResult] = useState<string | null>(null)
  const [trimConfirm, setTrimConfirm] = useState(false)

  // Google Reviews download status
  const [downloadComplete, setDownloadComplete] = useState(dataset.source !== 'google_reviews')
  useEffect(function() {
    if (dataset.source !== 'google_reviews' || !reviewSourceId) return
    fetch('/api/review-sources/' + reviewSourceId)
      .then(function(r) { return r.json() })
      .then(function(data) {
        var locs = data.locations || []
        var unsynced = locs.filter(function(l: any) { return l.selected && !l.last_synced_at && !l.error_message })
        setDownloadComplete(unsynced.length === 0 && locs.length > 0)
      })
      .catch(function() {})
  }, [dataset.source, reviewSourceId])

  // Append data state
  const fileRef = useRef<HTMLInputElement>(null)
  const [appendFile, setAppendFile] = useState<File | null>(null)
  const [appendPreview, setAppendPreview] = useState<{ headers: string[]; rowCount: number; rows: Record<string, unknown>[] } | null>(null)
  const [appending, setAppending] = useState(false)
  const [appendDone, setAppendDone] = useState<number | null>(null)
  const [appendError, setAppendError] = useState('')

  var parseCSV = useCallback(function(text: string): Record<string, unknown>[] {
    var lines = text.split('\n').map(function(l) { return l.trim() }).filter(Boolean)
    if (lines.length < 2) return []
    var headers = lines[0].split(',').map(function(h) { return h.replace(/^"|"$/g, '').trim() })
    return lines.slice(1).map(function(line) {
      var vals = line.split(',').map(function(v) { return v.replace(/^"|"$/g, '').trim() })
      var row: Record<string, unknown> = {}
      headers.forEach(function(h, i) { row[h] = vals[i] || '' })
      return row
    })
  }, [])

  function handleAppendFile(file: File) {
    setAppendFile(file)
    setAppendError('')
    setAppendDone(null)
    var reader = new FileReader()
    reader.onload = function(e) {
      var text = e.target?.result as string
      var rows = parseCSV(text)
      if (!rows.length) { setAppendError('No data rows found in file'); return }
      var headers = Object.keys(rows[0])
      setAppendPreview({ headers: headers, rowCount: rows.length, rows: rows })
    }
    reader.readAsText(file)
  }

  async function handleAppend() {
    if (!appendPreview) return
    setAppending(true)
    setAppendError('')
    var uploadedBatches: number[] = []
    try {
      var BATCH = 50
      var total = 0
      for (var i = 0; i < appendPreview.rows.length; i += BATCH) {
        var chunk = appendPreview.rows.slice(i, i + BATCH)
        var res = await fetch('/api/datasets/' + dataset.id + '/rows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk, source_ref: appendFile?.name || 'append' }),
        })
        if (!res.ok) throw new Error('Upload failed at batch ' + Math.floor(i / BATCH + 1))
        var resData = await res.json().catch(function() { return {} })
        if (resData.batch_index != null) uploadedBatches.push(resData.batch_index)
        total += chunk.length
      }
      // Recompute analytics
      await fetch('/api/datasets/' + dataset.id + '/compute', { method: 'POST' })
      setAppendDone(total)
      setAppendPreview(null)
      setAppendFile(null)
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    } catch (err: any) {
      // Rollback: delete any batches that were uploaded before the failure
      if (uploadedBatches.length > 0) {
        try {
          await fetch('/api/datasets/' + dataset.id + '/rows', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch_indexes: uploadedBatches }),
          })
        } catch {}
      }
      setAppendError((err.message || 'Failed to append data') + '. Partial upload has been rolled back.')
    } finally {
      setAppending(false)
    }
  }

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

  // Schema edits update local state only — SchemaEditor's own Save button handles persistence
  function handleSaveSchema(updated: SchemaConfig) {
    setSchema(updated)
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
    <div className="flex flex-col gap-6 py-6 max-w-5xl">

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
      <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4" style={{ opacity: downloadComplete ? 1 : 0.5, pointerEvents: downloadComplete ? 'auto' : 'none' }}>
        <div>
          <h2 className="font-bold text-gray-800">Schema</h2>
          {!downloadComplete && <p className="text-xs text-amber-600 mt-1">Schema editing available after all reviews are downloaded.</p>}
          <p className="text-sm text-gray-500 mt-0.5">
            Assign field types to control how each column is used in analysis.
            {dataset.row_count > 0 && (' ' + dataset.row_count.toLocaleString() + ' rows loaded.')}
          </p>
        </div>
        <SchemaEditor schema={schema} onChange={handleSaveSchema} onSave={function() { router.refresh() }} />
      </div>

      {/* Append data — not for google_reviews datasets */}
      {dataset.source !== 'google_reviews' && <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
        <div>
          <h2 className="font-bold text-gray-800">Append Data</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Add more rows to this dataset from a CSV file. Columns should match the existing schema.
          </p>
        </div>
        <div
          onDragOver={function(e) { e.preventDefault() }}
          onDrop={function(e) { e.preventDefault(); var f = e.dataTransfer.files[0]; if (f) handleAppendFile(f) }}
          className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-orange-300 transition-colors"
          onClick={function() { fileRef.current?.click() }}
        >
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={function(e) { var f = e.target.files?.[0]; if (f) handleAppendFile(f) }} />
          <p className="text-sm text-gray-500">{appendFile ? appendFile.name : 'Drop a CSV file here or click to browse'}</p>
        </div>
        {appendPreview && (
          <div className="bg-gray-50 rounded-xl p-4 text-sm">
            <p className="font-semibold text-gray-700">{appendPreview.rowCount.toLocaleString()} rows found</p>
            <p className="text-xs text-gray-400 mt-1">Columns: {appendPreview.headers.slice(0, 8).join(', ')}{appendPreview.headers.length > 8 ? ' + ' + (appendPreview.headers.length - 8) + ' more' : ''}</p>
            <div className="flex items-center gap-3 mt-3">
              <button onClick={handleAppend} disabled={appending}
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all hover:opacity-90"
                style={{ background: HERMES }}>
                {appending ? 'Uploading...' : 'Append ' + appendPreview.rowCount.toLocaleString() + ' rows'}
              </button>
              <button onClick={function() { setAppendPreview(null); setAppendFile(null); if (fileRef.current) fileRef.current.value = '' }}
                className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          </div>
        )}
        {appendDone !== null && (
          <p className="text-sm text-green-600 font-semibold">{appendDone.toLocaleString()} rows appended successfully. Analytics recomputed.</p>
        )}
        {appendError && <p className="text-xs text-red-500">{appendError}</p>}
      </div>}

      {/* Trim data by date */}
      {schema.fields.some(function(f) { return f.type === 'date' }) && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
          <div>
            <h2 className="font-bold text-gray-800">Trim Data</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Remove rows where a date field is before a cutoff date. This permanently deletes the data.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs font-semibold text-gray-600">Date field</label>
              <select value={trimField} onChange={function(e) { setTrimField(e.target.value); setTrimConfirm(false) }}
                className={inputCls}>
                <option value="">Select a date field...</option>
                {schema.fields.filter(function(f) { return f.type === 'date' }).map(function(f) {
                  return <option key={f.field} value={f.field}>{f.label || f.field}</option>
                })}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-600">Remove rows before</label>
              <input type="date" value={trimDate} onChange={function(e) { setTrimDate(e.target.value); setTrimConfirm(false) }}
                className={inputCls} style={{ width: 180 }} />
            </div>
            <button
              onClick={async function() {
                if (!trimField || !trimDate) return
                if (!trimConfirm) { setTrimConfirm(true); return }
                setTrimming(true); setTrimResult(null); setTrimConfirm(false)
                try {
                  var res = await fetch('/api/datasets/' + dataset.id + '/trim', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ date_field: trimField, before_date: trimDate }),
                  })
                  var data = await res.json()
                  if (res.ok) {
                    setTrimResult('Removed ' + data.deleted.toLocaleString() + ' rows. ' + data.remaining.toLocaleString() + ' rows remaining.')
                    router.refresh()
                  } else {
                    setTrimResult('Error: ' + (data.error || 'Failed'))
                  }
                } catch (err: any) {
                  setTrimResult('Error: ' + (err?.message || 'Failed'))
                } finally { setTrimming(false) }
              }}
              disabled={trimming || !trimField || !trimDate}
              className={'px-5 py-2.5 rounded-xl text-sm font-semibold transition-all flex-shrink-0 disabled:opacity-50 ' +
                (trimConfirm ? 'bg-red-600 text-white hover:bg-red-700' : 'text-white hover:opacity-90')}
              style={trimConfirm ? {} : { background: HERMES }}
            >
              {trimming ? 'Removing...' : trimConfirm ? 'Confirm Remove' : 'Remove'}
            </button>
          </div>
          {trimConfirm && (
            <p className="text-xs text-red-500">This will permanently delete all rows where <strong>{trimField}</strong> is before {trimDate}. Click "Confirm Remove" to proceed.</p>
          )}
          {trimResult && (
            <p className={'text-xs ' + (trimResult.startsWith('Error') ? 'text-red-500' : 'text-green-600 font-semibold')}>{trimResult}</p>
          )}
        </div>
      )}

      {/* Google Reviews: Location management */}
      {dataset.source === 'google_reviews' && reviewSourceId && (
        <LocationManager sourceId={reviewSourceId} />
      )}

      {/* Google Reviews: User location assignments (admin only) */}
      {dataset.source === 'google_reviews' && reviewSourceId && (isOwner || isAdmin) && (
        <UserLocationAssigner sourceId={reviewSourceId} />
      )}

      {/* Admin: transfer to another org */}
      {isAdmin && allOrgs.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
          <div>
            <h2 className="font-bold text-gray-800">Transfer Organization</h2>
            <p className="text-sm text-gray-400 mt-0.5">Move this dataset to a different organization.</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              disabled={transferring}
              value={transferOrgId}
              onChange={function(e) { setTransferOrgId(e.target.value) }}
              className={inputCls + ' flex-1 disabled:opacity-50'}
            >
              <option value="" disabled>Select organization...</option>
              {allOrgs.map(function(o) {
                return <option key={o.id} value={o.id}>{o.name}</option>
              })}
            </select>
            <button
              disabled={transferring}
              onClick={async function() {
                if (!transferOrgId) return
                const orgLabel = (allOrgs.find(function(o) { return o.id === transferOrgId }) || {}).name || transferOrgId
                if (!confirm('Transfer "' + name + '" to ' + orgLabel + '?')) return
                var newOrgId = transferOrgId
                setTransferring(true)
                setError('')
                try {
                  const res = await fetch('/api/datasets/' + dataset.id, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ org_id: newOrgId }),
                  })
                  if (!res.ok) throw new Error('Failed to transfer dataset')
                  router.push('/analyze')
                } catch {
                  setError('Failed to transfer dataset')
                  setTransferring(false)
                }
              }}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all hover:opacity-90"
              style={{ background: HERMES }}
            >
              {transferring ? 'Transferring...' : 'Transfer'}
            </button>
          </div>
        </div>
      )}

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


