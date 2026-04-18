'use client'

// app/analyze/new/UploadClient.tsx
// Source selector → Upload (CSV) or Google Reviews wizard

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { autoDetectSchema } from '@/lib/datasetUtils'
import LottieLoader from '@/components/ui/LottieLoader'
import GoogleReviewsWizard from '@/components/analyze/GoogleReviewsWizard'
import RedditWizard from '@/components/analyze/RedditWizard'

const HERMES     = '#E8632A'
const CHUNK_SIZE = 50                   // rows per POST
const MAX_BYTES  = 3 * 1024 * 1024     // 3 MB safety ceiling per POST

type SourceMode = 'select' | 'upload' | 'google_reviews' | 'reddit'
type Step = 1 | 2 | 3

interface ParsedFile {
  rows:          Record<string, unknown>[]
  columns:       string[]
  filename:      string
  sourceFormat?: 'csv' | 'tsv' | 'json' | 'surveymonkey'
}

function splitCSVFields(line: string): string[] {
  const vals: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQ = !inQ }
    else if (ch === ',' && !inQ) { vals.push(cur); cur = '' }
    else cur += ch
  }
  vals.push(cur)
  return vals.map(function(v) { return v.trim().replace(/^"|"$/g, '') })
}

function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.trim().split('\n').filter(function(l) { return l.trim() })
  if (lines.length < 2) return []
  const headers = splitCSVFields(lines[0])
  return lines.slice(1).map(function(line) {
    const vals = splitCSVFields(line)
    const row: Record<string, unknown> = {}
    headers.forEach(function(h, i) { row[h] = vals[i] ?? '' })
    return row
  })
}

// ── SurveyMonkey detection & parsing ──────────────────────────────────────

const SM_META_COLS = ['respondent id', 'collector id', 'start date', 'end date', 'ip address', 'email address', 'first name', 'last name', 'custom data']
const SM_SUB_NOISE = ['', 'response', 'open-ended response', 'other (please specify)', 'comment']

function isSurveyMonkeyCSV(text: string): boolean {
  const lines = text.trim().split('\n')
  if (lines.length < 3) return false
  const row1 = splitCSVFields(lines[0])
  const row2 = splitCSVFields(lines[1])
  if (row1.length !== row2.length) return false

  // Check 1: first column looks like SM metadata
  const firstLower = (row1[0] || '').toLowerCase().trim()
  const hasSmMeta = SM_META_COLS.some(function(m) { return firstLower.includes(m) })

  // Check 2: row1 has duplicate headers (matrix questions)
  const seen = new Set<string>()
  let dupeCount = 0
  row1.forEach(function(h) {
    const lh = h.toLowerCase().trim()
    if (lh && seen.has(lh)) dupeCount++
    seen.add(lh)
  })

  // Check 3: row2 mostly has short/noise sub-labels, not full data
  let noiseCount = 0
  row2.forEach(function(v) {
    if (SM_SUB_NOISE.includes(v.toLowerCase().trim())) noiseCount++
  })
  const row2IsSubHeader = noiseCount > row2.length * 0.3

  // Check 4: row3 looks like data (has numbers, dates, actual content)
  const row3 = lines.length > 2 ? splitCSVFields(lines[2]) : []
  const dataLike = row3.filter(function(v) {
    const t = v.trim()
    return t && (t.match(/^\d/) || t.length > 2)
  }).length

  return (hasSmMeta && row2IsSubHeader) || (dupeCount >= 2 && row2IsSubHeader) || (hasSmMeta && dupeCount >= 2)
}

function parseSurveyMonkeyCSV(text: string): { rows: Record<string, unknown>[]; mergedHeaders: string[] } {
  const lines = text.trim().split('\n').filter(function(l) { return l.trim() })
  if (lines.length < 3) return { rows: [], mergedHeaders: [] }

  const row1 = splitCSVFields(lines[0])
  const row2 = splitCSVFields(lines[1])

  // Merge the two header rows into one clean set of column names
  const headers: string[] = []
  let lastParent = ''
  const colCounts: Record<string, number> = {}

  for (let c = 0; c < row1.length; c++) {
    let parent = (row1[c] || '').trim()
    const sub = (row2[c] || '').trim()
    const subLower = sub.toLowerCase()

    // Track the parent for matrix continuation (blank row1 = same question)
    if (parent) lastParent = parent
    else parent = lastParent

    let merged = ''
    if (!sub || SM_SUB_NOISE.includes(subLower) || sub === parent) {
      // No meaningful sub-label — just use parent
      merged = parent
    } else {
      // Combine parent + sub for matrix items
      merged = parent + ' - ' + sub
    }

    // Deduplicate: if we've seen this header, append a number
    if (!merged) merged = 'Column ' + (c + 1)
    if (colCounts[merged]) {
      colCounts[merged]++
      merged = merged + ' (' + colCounts[merged] + ')'
    } else {
      colCounts[merged] = 1
    }

    headers.push(merged)
  }

  // Parse data rows (skip first 2 header rows)
  const rows = lines.slice(2).map(function(line) {
    const vals = splitCSVFields(line)
    const row: Record<string, unknown> = {}
    headers.forEach(function(h, i) { row[h] = vals[i] ?? '' })
    return row
  })

  return { rows: rows, mergedHeaders: headers }
}

function parseTSV(text: string): Record<string, unknown>[] {
  const lines = text.trim().split('\n').filter(function(l) { return l.trim() })
  if (lines.length < 2) return []
  const headers = lines[0].split('\t').map(function(h) { return h.trim() })
  return lines.slice(1).map(function(line) {
    const vals = line.split('\t')
    const row: Record<string, unknown> = {}
    headers.forEach(function(h, i) { row[h] = vals[i] ?? '' })
    return row
  })
}

function bytesOf(rows: Record<string, unknown>[]): number {
  return new Blob([JSON.stringify(rows)]).size
}

function splitChunks(rows: Record<string, unknown>[]): Record<string, unknown>[][] {
  const chunks: Record<string, unknown>[][] = []
  let i = 0
  while (i < rows.length) {
    let size  = CHUNK_SIZE
    let chunk = rows.slice(i, i + size)
    while (bytesOf(chunk) > MAX_BYTES && size > 1) {
      size  = Math.floor(size / 2)
      chunk = rows.slice(i, i + size)
    }
    chunks.push(chunk)
    i += chunk.length
  }
  return chunks
}

export default function UploadClient() {
  const router = useRouter()
  const [sourceMode,  setSourceMode]  = useState<SourceMode>('select')
  const [step,        setStep]        = useState<Step>(1)
  const [parsed,      setParsed]      = useState<ParsedFile | null>(null)
  const [parseError,  setParseError]  = useState('')
  const [dragging,    setDragging]    = useState(false)
  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [visibility,  setVisibility]  = useState<'private' | 'public'>('private')
  const [creating,    setCreating]    = useState(false)
  const [uploadPct,   setUploadPct]   = useState(0)
  const [uploadMsg,   setUploadMsg]   = useState('')
  const [error,       setError]       = useState('')
  const [fieldInclude, setFieldInclude] = useState<Record<string, boolean>>({})
  const [fieldAlias,   setFieldAlias]   = useState<Record<string, string>>({})

  function handleFile(file: File) {
    setParseError('')
    const reader = new FileReader()
    reader.onload = function(e) {
      const text = e.target?.result as string
      try {
        let rows: Record<string, unknown>[] = []
        let fmt: ParsedFile['sourceFormat'] = 'csv'
        if (file.name.endsWith('.json')) {
          rows = JSON.parse(text)
          if (!Array.isArray(rows)) rows = [rows]
          fmt = 'json'
        } else if (file.name.endsWith('.tsv')) {
          rows = parseTSV(text)
          fmt = 'tsv'
        } else if (isSurveyMonkeyCSV(text)) {
          const smResult = parseSurveyMonkeyCSV(text)
          rows = smResult.rows
          fmt = 'surveymonkey'
        } else {
          rows = parseCSV(text)
          fmt = 'csv'
        }
        if (rows.length === 0) { setParseError('No data rows found.'); return }
        const cols = Object.keys(rows[0] || {})
        const inc: Record<string, boolean> = {}
        cols.forEach(function(c) { inc[c] = true })
        setFieldInclude(inc)
        setFieldAlias({})
        setParsed({ rows, columns: cols, filename: file.name, sourceFormat: fmt })
        setName(file.name.replace(/\.[^/.]+$/, ''))
        setStep(2)
      } catch {
        setParseError('Could not parse this file. Please check the format.')
      }
    }
    reader.readAsText(file)
  }

  const handleDrop = useCallback(function(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  async function handleCreate() {
    if (!parsed || !name.trim()) return
    setCreating(true); setError(''); setUploadPct(0); setUploadMsg('Preparing data...')
    try {
      // Filter rows to only include selected fields
      const includedCols = parsed.columns.filter(function(c) { return fieldInclude[c] !== false })
      if (includedCols.length === 0) { setError('Select at least one field.'); setCreating(false); return }
      const filteredRows = parsed.rows.map(function(row) {
        const filtered: Record<string, unknown> = {}
        includedCols.forEach(function(c) { filtered[c] = row[c] })
        return filtered
      })

      const schema = autoDetectSchema(filteredRows)

      // Apply user-provided aliases
      schema.fields.forEach(function(f) {
        const alias = fieldAlias[f.field]
        if (alias && alias.trim()) f.label = alias.trim()
      })

      // 1. Create dataset record
      const dsRes  = await fetch('/api/datasets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description || null, source: 'upload', visibility }),
      })
      const dsData = await dsRes.json()
      if (!dsRes.ok) { setError(dsData.error || 'Failed to create dataset'); return }

      // 2. Upload rows in safe-sized chunks — track batches for rollback
      const chunks = splitChunks(filteredRows)
      const uploadedBatches: number[] = []
      for (let i = 0; i < chunks.length; i++) {
        setUploadMsg('Uploading rows — batch ' + (i + 1) + ' of ' + chunks.length)
        const res = await fetch('/api/datasets/' + dsData.id + '/rows', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunks[i], source_ref: parsed.filename }),
        })
        if (!res.ok) {
          const e = await res.json().catch(function() { return {} })
          // Rollback: delete uploaded batches and the dataset itself
          if (uploadedBatches.length > 0) {
            try { await fetch('/api/datasets/' + dsData.id + '/rows', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch_indexes: uploadedBatches }) }) } catch {}
          }
          try { await fetch('/api/datasets/' + dsData.id, { method: 'DELETE' }) } catch {}
          setError('Upload failed on batch ' + (i + 1) + ': ' + (e.error || 'server error') + '. Upload rolled back.')
          return
        }
        const resData = await res.json().catch(function() { return {} })
        if (resData.batch_index != null) uploadedBatches.push(resData.batch_index)
        setUploadPct(Math.round(((i + 1) / (chunks.length + 2)) * 100))
      }

      // 3. Save schema to state
      setUploadMsg('Saving schema...')
      await fetch('/api/datasets/' + dsData.id + '/state', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema_config: schema,
          theme_model:   { themes: [], aiGenerated: false, version: 1 },
          saved_charts:  [],
          saved_stats:   [],
          filter_state:  {},
        }),
      })
      setUploadPct(Math.round(((chunks.length + 1) / (chunks.length + 2)) * 100))

      // 4. Trigger analytics compute (non-blocking on failure — user can re-trigger from settings)
      setUploadMsg('Computing analytics...')
      const computeRes = await fetch('/api/datasets/' + dsData.id + '/compute', { method: 'POST' })
      if (!computeRes.ok) {
        console.warn('[upload] analytics compute failed — will show stale until re-triggered')
      }
      setUploadPct(100)

      router.push('/analyze/' + dsData.id + '/settings')
    } catch (err) {
      setError('Unexpected error: ' + String(err))
    } finally {
      setCreating(false)
    }
  }

  const includedColsList = parsed ? parsed.columns.filter(function(c) { return fieldInclude[c] !== false }) : []
  const previewRows = parsed ? parsed.rows.map(function(row) {
    const filtered: Record<string, unknown> = {}
    includedColsList.forEach(function(c) { filtered[c] = row[c] })
    return filtered
  }) : []
  const chunks         = previewRows.length ? splitChunks(previewRows) : []
  const estimatedChunks = chunks.length

  return (
    <div className="flex flex-col gap-6">

      <div>
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
          <button onClick={function() { router.push('/analyze') }} className="hover:text-gray-600 transition-colors">Analyze</button>
          <span>/</span>
          <span className="text-gray-700 font-medium">New Dataset</span>
        </div>
        <h1 className="text-2xl font-black text-gray-800">Create a Dataset</h1>
      </div>

      {/* Source selector */}
      {sourceMode === 'select' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500">Choose how to create your dataset</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button onClick={function() { setSourceMode('upload') }}
              className="bg-white border-2 border-gray-200 rounded-2xl p-6 text-left hover:border-orange-400 hover:bg-orange-50 transition-all group">
              <div className="text-3xl mb-3">📂</div>
              <h3 className="font-bold text-gray-800 mb-1 group-hover:text-orange-700">Upload a File</h3>
              <p className="text-xs text-gray-400">CSV, TSV, JSON, or SurveyMonkey export</p>
            </button>
            <button onClick={function() { setSourceMode('google_reviews') }}
              className="bg-white border-2 border-gray-200 rounded-2xl p-6 text-left hover:border-orange-400 hover:bg-orange-50 transition-all group">
              <div className="text-3xl mb-3">⭐</div>
              <h3 className="font-bold text-gray-800 mb-1 group-hover:text-orange-700">Download Google Reviews</h3>
              <p className="text-xs text-gray-400">Search for a brand, select locations, pull all reviews</p>
            </button>
            <button onClick={function() { setSourceMode('reddit') }}
              className="bg-white border-2 border-gray-200 rounded-2xl p-6 text-left hover:border-orange-400 hover:bg-orange-50 transition-all group">
              <div className="text-3xl mb-3">💬</div>
              <h3 className="font-bold text-gray-800 mb-1 group-hover:text-orange-700">Download Reddit Posts</h3>
              <p className="text-xs text-gray-400">Search Reddit, select threads, download all comments</p>
            </button>
          </div>
        </div>
      )}

      {/* Google Reviews wizard */}
      {sourceMode === 'google_reviews' && (
        <GoogleReviewsWizard onBack={function() { setSourceMode('select') }} />
      )}

      {/* Reddit wizard */}
      {sourceMode === 'reddit' && (
        <RedditWizard onBack={function() { setSourceMode('select') }} />
      )}

      {/* Upload flow */}
      {sourceMode === 'upload' && <>

      {/* Step indicator */}
      <div className="flex items-center gap-3">
        <button onClick={function() { setSourceMode('select'); setStep(1); setParsed(null) }}
          className="text-xs text-gray-400 hover:text-gray-600 mr-2">← Back</button>
        {([1, 2, 3] as Step[]).map(function(s) {
          const labels: Record<Step, string> = { 1: 'Upload', 2: 'Details', 3: 'Confirm' }
          const done = step > s; const current = step === s
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ' + (done ? 'bg-green-500 text-white' : current ? 'text-white' : 'bg-gray-100 text-gray-400')}
                style={current ? { background: HERMES } : {}}>
                {done ? '✓' : s}
              </div>
              <span className={'text-sm font-medium ' + (current ? 'text-gray-800' : 'text-gray-400')}>{labels[s]}</span>
              {s < 3 && <div className="w-8 h-px bg-gray-200" />}
            </div>
          )
        })}
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div onDragOver={function(e) { e.preventDefault(); setDragging(true) }} onDragLeave={function() { setDragging(false) }} onDrop={handleDrop}
            className={'border-2 border-dashed rounded-2xl p-12 text-center transition-all ' + (dragging ? 'border-orange-400 bg-orange-50' : 'border-gray-300 hover:border-gray-400 bg-white')}>
            <div className="text-4xl mb-3">📂</div>
            <p className="text-gray-600 font-semibold mb-1">Drag and drop your file here</p>
            <p className="text-gray-400 text-sm mb-4">CSV, TSV, or JSON · any size</p>
            <label className="cursor-pointer">
              <span className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white inline-block hover:opacity-90 transition-all" style={{ background: HERMES }}>Browse files</span>
              <input type="file" accept=".csv,.tsv,.json" className="hidden"
                onChange={function(e) { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            </label>
          </div>
          {parseError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{parseError}</div>}
        </div>
      )}

      {/* Step 2: Name */}
      {step === 2 && parsed && (
        <div className="flex flex-col gap-4">
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-green-500 text-lg">✓</span>
            <div>
              <p className="text-sm font-semibold text-green-700">{parsed.filename}</p>
              <p className="text-xs text-green-600">
                {parsed.rows.length.toLocaleString()} rows · {parsed.columns.length} columns
                {parsed.sourceFormat === 'surveymonkey' && (
                  <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: '#fff4ef', color: '#e8622a', border: '1px solid #fbd5c2' }}>
                    SurveyMonkey format detected
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-700">Dataset name</label>
              <input value={name} onChange={function(e) { setName(e.target.value) }} placeholder="e.g. Q1 2026 Customer Feedback"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm outline-none focus:border-orange-400 transition-colors" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-700">Description <span className="text-gray-400 font-normal">(optional)</span></label>
              <textarea value={description} onChange={function(e) { setDescription(e.target.value) }} rows={2}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm outline-none focus:border-orange-400 transition-colors resize-none" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-gray-700">Visibility</label>
              <div className="flex gap-3">
                {(['private', 'public'] as const).map(function(v) {
                  return (
                    <label key={v} className={'flex items-center gap-2.5 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ' + (visibility === v ? 'border-orange-400 bg-orange-50' : 'border-gray-200')}>
                      <input type="radio" name="visibility" value={v} checked={visibility === v} onChange={function() { setVisibility(v) }} className="accent-orange-500" />
                      <div>
                        <p className="text-sm font-semibold text-gray-700 capitalize">{v}</p>
                        <p className="text-xs text-gray-400">{v === 'private' ? 'Only your org' : 'Anyone with link'}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Field selection + aliases */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Fields</h3>
                <p className="text-xs text-gray-400">Uncheck fields you don't need. Add aliases for cleaner column names.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={function() { const inc: Record<string, boolean> = {}; parsed.columns.forEach(function(c) { inc[c] = true }); setFieldInclude(inc) }}
                  className="text-xs font-semibold text-orange-600 hover:underline">All</button>
                <button onClick={function() { const inc: Record<string, boolean> = {}; parsed.columns.forEach(function(c) { inc[c] = false }); setFieldInclude(inc) }}
                  className="text-xs font-semibold text-gray-400 hover:underline">None</button>
              </div>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {parsed.columns.map(function(col) {
                const included = fieldInclude[col] !== false
                return (
                  <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8, background: included ? '#fff' : '#f9fafb', border: '1px solid ' + (included ? '#e5e7eb' : '#f3f4f6'), opacity: included ? 1 : 0.5, transition: 'all .15s' }}>
                    <input type="checkbox" checked={included}
                      onChange={function() { setFieldInclude(function(prev) { return Object.assign({}, prev, { [col]: !included }) }) }}
                      style={{ width: 14, height: 14, accentColor: HERMES, cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#374151', fontFamily: 'monospace', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={col}>{col}</span>
                    <input
                      type="text"
                      value={fieldAlias[col] || ''}
                      onChange={function(e) { setFieldAlias(function(prev) { return Object.assign({}, prev, { [col]: e.target.value }) }) }}
                      placeholder="Alias"
                      disabled={!included}
                      style={{ width: 140, flexShrink: 0, padding: '4px 8px', fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 6, outline: 'none', color: '#374151', background: included ? '#fff' : '#f9fafb' }}
                    />
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400">{parsed.columns.filter(function(c) { return fieldInclude[c] !== false }).length} of {parsed.columns.length} fields selected</p>
          </div>

          <div className="flex gap-3">
            <button onClick={function() { setStep(1) }} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600 transition-colors">Back</button>
            <button onClick={function() { setStep(3) }} disabled={!name.trim()}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all" style={{ background: HERMES }}>Continue</button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 3 && parsed && (
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-3">
            <h3 className="font-bold text-gray-800">Summary</h3>
            {([
              ['Name',       name],
              ['Rows',       parsed.rows.length.toLocaleString()],
              ['Columns',    includedColsList.length + ' of ' + parsed.columns.length],
              ['Format',     parsed.sourceFormat === 'surveymonkey' ? 'SurveyMonkey (auto-detected)' : parsed.sourceFormat === 'tsv' ? 'TSV' : parsed.sourceFormat === 'json' ? 'JSON' : 'CSV'],
              ['Batches',    estimatedChunks + ' × ' + CHUNK_SIZE + ' rows'],
              ['Visibility', visibility],
            ] as [string, string][]).map(function([label, val]) {
              return (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-800 font-semibold">{val}</span>
                </div>
              )
            })}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Included fields</p>
              <div className="flex flex-wrap gap-1.5">
                {includedColsList.map(function(c) {
                  const alias = fieldAlias[c]
                  return <span key={c} className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-1 rounded-lg">{alias && alias.trim() ? alias.trim() + ' (' + c + ')' : c}</span>
                })}
              </div>
            </div>
          </div>

          {creating && (
            <div className="flex flex-col gap-3 items-center py-2">
              <LottieLoader size={64} message={uploadMsg || 'Uploading...'} />
              <div className="w-full flex flex-col gap-1">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>{uploadPct}% complete</span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: uploadPct + '%', background: HERMES }} />
                </div>
              </div>
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}

          <div className="flex gap-3">
            <button onClick={function() { setStep(2) }} disabled={creating}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600 disabled:opacity-50">Back</button>
            <button onClick={handleCreate} disabled={creating}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all" style={{ background: HERMES }}>
              {creating ? 'Uploading...' : 'Create Dataset'}
            </button>
          </div>
        </div>
      )}

      </>}
    </div>
  )
}
