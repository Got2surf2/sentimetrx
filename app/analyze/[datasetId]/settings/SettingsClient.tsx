'use client'

// app/analyze/[datasetId]/settings/SettingsClient.tsx
// Rename, visibility, schema editor, archive, delete

import { postJsonWithRetry } from '@/lib/postJsonWithRetry'
import { ROWS_PER_BATCH } from '@/lib/constants'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import TransferOrg from '@/components/ui/TransferOrg'
import SchemaEditor from '@/components/analyze/SchemaEditor'
import LocationManager from '@/components/analyze/LocationManager'
import UserLocationAssigner from '@/components/analyze/UserLocationAssigner'
import SyncCadenceControl from '@/components/analyze/SyncCadenceControl'
import RegulationsDownloadBanner from '@/components/analyze/RegulationsDownloadBanner'
import ReviewSyncStatus from '@/components/analyze/ReviewSyncStatus'
import type { SchemaConfig, Dataset } from '@/lib/analyzeTypes'

interface OrgOption { id: string; name: string }

interface ReviewLocation { selected?: boolean; last_synced_at?: string | null; error_message?: string | null }

interface FieldGrown { field: string; before: number; after: number }
interface SchemaRefreshMember { name?: string; datasetId?: string; rowsScanned?: number; fieldsGrown?: FieldGrown[] }

interface Props {
  dataset:    Pick<Dataset, 'id' | 'name' | 'description' | 'source' | 'visibility' | 'status' | 'row_count' | 'taxonomy_enabled'>
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
  const [taxonomyEnabled, setTaxonomyEnabled] = useState(!!dataset.taxonomy_enabled)
  const [taxSaving, setTaxSaving] = useState(false)
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
        var unsynced = locs.filter(function(l: ReviewLocation) { return l.selected && !l.last_synced_at && !l.error_message })
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
      // Matches the server's ROWS_PER_BATCH stride — see UploadClient's note; it
      // must not exceed it or the rollback DELETE spans the wrong row_index range.
      var BATCH = ROWS_PER_BATCH
      var total = 0
      for (var i = 0; i < appendPreview.rows.length; i += BATCH) {
        var chunk = appendPreview.rows.slice(i, i + BATCH)
        // Retries a transient upstream blip rather than losing the append — a
        // single dropped socket used to abort the whole upload. See
        // lib/postJsonWithRetry; the server retries the insert too.
        var res = await postJsonWithRetry('/api/datasets/' + dataset.id + '/rows',
          { rows: chunk, source_ref: appendFile?.name || 'append' })
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
    } catch (err) {
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
      setAppendError(((err instanceof Error ? err.message : '') || 'Failed to append data') + '. Partial upload has been rolled back.')
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

  // Re-scan all rows to widen the schema's per-field value lists. Useful when
  // a dataset's filter values look incomplete (e.g. only one location showing
  // up after additional locations have synced — the schema was frozen on its
  // first batch). Idempotent.
  const [refreshingSchema, setRefreshingSchema] = useState(false)
  const [schemaRefreshMsg, setSchemaRefreshMsg] = useState<string>('')
  async function handleRefreshSchema() {
    setRefreshingSchema(true); setSchemaRefreshMsg('')
    try {
      const res = await fetch('/api/datasets/' + dataset.id + '/refresh-schema', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setSchemaRefreshMsg('Refresh failed: ' + (data.error || 'unknown error'))
        return
      }
      const fmtGrew = function(grew: { field: string; before: number; after: number }[]): string {
        if (grew.length === 0) return 'no changes'
        const summary = grew.slice(0, 4).map(function(g) { return g.field + ' (' + g.before + ' → ' + g.after + ')' }).join(', ')
        const more = grew.length > 4 ? ', +' + (grew.length - 4) + ' more' : ''
        return summary + more
      }
      const grew = data.fieldsGrown || []
      let msg = ''
      if (data.isCollection) {
        // Collection: report the collection-level result PLUS per-member.
        const memberLines: string[] = (data.members || []).map(function(m: SchemaRefreshMember) {
          return '  · ' + (m.name || m.datasetId) + ': scanned ' + (m.rowsScanned || 0).toLocaleString() + ' rows — ' + fmtGrew(m.fieldsGrown || [])
        })
        msg = 'Collection scanned ' + (data.rowsScanned || 0).toLocaleString() + ' rows total. Collection schema: ' + fmtGrew(grew) + (memberLines.length ? '\n' + memberLines.join('\n') : '')
      } else {
        msg = 'Scanned ' + (data.rowsScanned || 0).toLocaleString() + ' rows. ' + (grew.length === 0 ? 'Schema already up to date.' : 'Updated: ' + fmtGrew(grew))
      }
      setSchemaRefreshMsg(msg)
      if (grew.length > 0 || (data.members && data.members.some(function(m: SchemaRefreshMember) { return (m.fieldsGrown || []).length > 0 }))) {
        router.refresh()
      }
    } catch (e) {
      setSchemaRefreshMsg('Refresh failed: ' + ((e instanceof Error ? e.message : '') || 'network error'))
    } finally {
      setRefreshingSchema(false)
    }
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

      {/* Regulations.gov download progress */}
      {dataset.source === 'regulations' && dataset.description && (
        <RegulationsDownloadBanner datasetId={dataset.id} description={dataset.description} />
      )}

      {/* Google Reviews download status: pre-flight estimate, in-progress
          counter, success/partial completion banner with errored locations. */}
      {dataset.source === 'google_reviews' && reviewSourceId && (
        <ReviewSyncStatus sourceId={reviewSourceId} />
      )}

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
          onClick={() => { void handleSaveDetails() }}
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

      {/* Dimensions (taxonomy) — per-dataset opt-in, persisted immediately */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-3">
        <h2 className="font-bold text-gray-800">Dimensions</h2>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={taxonomyEnabled} disabled={taxSaving}
            onChange={() => { void (async function() {
              const next = !taxonomyEnabled
              setTaxonomyEnabled(next); setTaxSaving(true); setError('')
              try {
                const res = await fetch('/api/datasets/' + dataset.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taxonomy_enabled: next }) })
                if (!res.ok) { setTaxonomyEnabled(!next); const d = await res.json().catch(function() { return {} }); setError(d.error || 'Failed to update Dimensions') }
              } catch { setTaxonomyEnabled(!next); setError('Failed to update Dimensions') }
              finally { setTaxSaving(false) }
            })() }}
            className="accent-orange-500 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-gray-700">Apply Dimensions{taxSaving && <span className="text-xs text-gray-400 font-normal"> · saving…</span>}</p>
            <p className="text-xs text-gray-400">Reveals the <strong>Dimensions</strong> tab for this dataset, plus dimension breakdowns in Charts &amp; Stats. Restaurant data (Google reviews, restaurant orgs) gets the full restaurant taxonomy — service, food, drinks, ambiance, value…; <strong>every other dataset gets the universal Emotion dimension</strong> (disappointment, blame, and churn-intent language). You don’t need this toggle for Google-reviews datasets — just open the Dimensions tab and click <strong>Enable Dimensions</strong> there, which turns it on and classifies in one step. For every other dataset, this toggle (or restaurant detection at mining time) is what reveals the tab.</p>
          </div>
        </label>
      </div>

      {/* Outlet reporting — per-dataset opt-in, saved with the schema */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-3">
        <h2 className="font-bold text-gray-800">Outlet reporting</h2>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={!!schema.outletReporting}
            onChange={() => {
              // Local state only, exactly like every other schema edit — the
              // SchemaEditor's own Save button persists the blob. Bumping
              // `version` keeps it consistent with how field edits mark a change.
              handleSaveSchema({ ...schema, autoDetected: false, version: schema.version + 1, outletReporting: !schema.outletReporting })
            }}
            className="accent-orange-500 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-gray-700">Enable the Leaderboard &amp; Outlet Deep-Dive</p>
            <p className="text-xs text-gray-400">
              Multi-location reporting: rank every location against the chain on each theme and
              dimension, and open a per-location deep-dive. Mark the column that identifies a
              location in the <strong>Schema</strong> list below to control how locations are
              grouped. Your organisation can also switch this on for every dataset at once —
              ask your account team. <strong>Remember to Save the schema</strong> after changing this.
            </p>
          </div>
        </label>
      </div>

      {/* Schema editor */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4" style={{ opacity: downloadComplete ? 1 : 0.5, pointerEvents: downloadComplete ? 'auto' : 'none' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-gray-800">Schema</h2>
            {!downloadComplete && <p className="text-xs text-amber-600 mt-1">Schema editing available after all reviews are downloaded.</p>}
            <p className="text-sm text-gray-500 mt-0.5">
              Assign field types to control how each column is used in analysis.
              {dataset.row_count > 0 && (' ' + dataset.row_count.toLocaleString() + ' rows loaded.')}
            </p>
          </div>
          <button onClick={() => { void handleRefreshSchema() }} disabled={refreshingSchema}
            title="Re-scan all rows and widen the filter value lists. Use this if filter options look incomplete (e.g. only one city showing up)."
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap flex-shrink-0">
            {refreshingSchema ? 'Refreshing…' : '↻ Refresh from data'}
          </button>
        </div>
        {schemaRefreshMsg && (
          <pre className={'text-xs whitespace-pre-wrap font-sans m-0 ' + (schemaRefreshMsg.startsWith('Refresh failed') ? 'text-red-600' : 'text-gray-600')}>{schemaRefreshMsg}</pre>
        )}
        <SchemaEditor schema={schema} datasetId={dataset.id} onChange={handleSaveSchema} onSave={function() { router.refresh() }} />
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
              <button onClick={() => { void handleAppend() }} disabled={appending}
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
              onClick={() => { void (async function() {
                if (!trimField || !trimDate) return
                if (!trimConfirm) { setTrimConfirm(true); return }
                setTrimming(true); setTrimResult(null); setTrimConfirm(false)
                try {
                  // Large trims run in server rounds — the route returns
                  // hasMore when its time budget ran out mid-trim; keep
                  // calling until the cutoff is fully applied.
                  var totalDeleted = 0
                  var remaining = 0
                  for (;;) {
                    var res = await fetch('/api/datasets/' + dataset.id + '/trim', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ date_field: trimField, before_date: trimDate }),
                    })
                    var data = await res.json()
                    if (!res.ok) {
                      setTrimResult('Error: ' + (data.error || 'Failed'))
                      return
                    }
                    totalDeleted += data.deleted
                    remaining = data.remaining
                    if (!data.hasMore) break
                    setTrimResult('Removing… ' + totalDeleted.toLocaleString() + ' rows removed so far.')
                  }
                  setTrimResult('Removed ' + totalDeleted.toLocaleString() + ' rows. ' + remaining.toLocaleString() + ' rows remaining.')
                  router.refresh()
                } catch (err) {
                  setTrimResult('Error: ' + ((err instanceof Error ? err.message : '') || 'Failed'))
                } finally { setTrimming(false) }
              })() }}
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

      {/* Google Reviews: Sync cadence (auto-refresh frequency / manual mode) */}
      {dataset.source === 'google_reviews' && reviewSourceId && (
        <SyncCadenceControl sourceId={reviewSourceId} />
      )}

      {/* Google Reviews: Location management */}
      {dataset.source === 'google_reviews' && reviewSourceId && (
        <LocationManager sourceId={reviewSourceId} />
      )}

      {/* Google Reviews: User location assignments (admin only) */}
      {dataset.source === 'google_reviews' && reviewSourceId && (isOwner || isAdmin) && (
        <UserLocationAssigner sourceId={reviewSourceId} />
      )}

      {/* Admin: transfer to another org — uses the shared TransferOrg
          component (active-only org list, audit logging on the server). */}
      {isAdmin && (
        <TransferOrg
          resourceName={name || 'Dataset'}
          resourceLabel="dataset"
          apiUrl={'/api/datasets/' + dataset.id}
          currentOrgId={(dataset as Dataset).org_id}
          onTransferred={() => router.push('/analyze')}
        />
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
              onClick={() => { void handleArchive() }}
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
              onClick={() => { void handleDelete() }}
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


