'use client'

// app/analyze/new/UploadClient.tsx
// Three-step upload: parse → name → confirm + chunked upload + compute

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { autoDetectSchema } from '@/lib/datasetUtils'

const HERMES     = '#E8632A'
const CHUNK_SIZE = 50                   // rows per POST
const MAX_BYTES  = 3 * 1024 * 1024     // 3 MB safety ceiling per POST

type Step = 1 | 2 | 3

interface ParsedFile {
  rows:     Record<string, unknown>[]
  columns:  string[]
  filename: string
}

function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.trim().split('\n').filter(function(l) { return l.trim() })
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(function(h) { return h.trim().replace(/^"|"$/g, '') })
  return lines.slice(1).map(function(line) {
    const vals: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { vals.push(cur); cur = '' }
      else cur += ch
    }
    vals.push(cur)
    const row: Record<string, unknown> = {}
    headers.forEach(function(h, i) { row[h] = (vals[i] ?? '').replace(/^"|"$/g, '') })
    return row
  })
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

  function handleFile(file: File) {
    setParseError('')
    const reader = new FileReader()
    reader.onload = function(e) {
      const text = e.target?.result as string
      try {
        let rows: Record<string, unknown>[] = []
        if (file.name.endsWith('.json')) {
          rows = JSON.parse(text)
          if (!Array.isArray(rows)) rows = [rows]
        } else if (file.name.endsWith('.tsv')) {
          rows = parseTSV(text)
        } else {
          rows = parseCSV(text)
        }
        if (rows.length === 0) { setParseError('No data rows found.'); return }
        setParsed({ rows, columns: Object.keys(rows[0] || {}), filename: file.name })
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
    setCreating(true); setError(''); setUploadPct(0); setUploadMsg('Creating dataset...')
    try {
      const schema = autoDetectSchema(parsed.rows)

      // 1. Create dataset record
      const dsRes  = await fetch('/api/datasets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description || null, source: 'upload', visibility }),
      })
      const dsData = await dsRes.json()
      if (!dsRes.ok) { setError(dsData.error || 'Failed to create dataset'); return }

      // 2. Upload rows in safe-sized chunks
      const chunks = splitChunks(parsed.rows)
      for (let i = 0; i < chunks.length; i++) {
        setUploadMsg('Uploading rows — batch ' + (i + 1) + ' of ' + chunks.length)
        const res = await fetch('/api/datasets/' + dsData.id + '/rows', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunks[i], source_ref: parsed.filename }),
        })
        if (!res.ok) {
          const e = await res.json().catch(function() { return {} })
          setError('Upload failed on batch ' + (i + 1) + ': ' + (e.error || 'server error'))
          return
        }
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

  const chunks         = parsed ? splitChunks(parsed.rows) : []
  const estimatedChunks = chunks.length

  return (
    <div className="flex flex-col gap-6">

      <div>
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
          <button onClick={function() { router.push('/analyze') }} className="hover:text-gray-600 transition-colors">Analyze</button>
          <span>/</span>
          <span className="text-gray-700 font-medium">Upload Dataset</span>
        </div>
        <h1 className="text-2xl font-black text-gray-800">Upload a Dataset</h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3">
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
              <p className="text-xs text-green-600">{parsed.rows.length.toLocaleString()} rows · {parsed.columns.length} columns</p>
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
              ['Columns',    String(parsed.columns.length)],
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
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Columns</p>
              <div className="flex flex-wrap gap-1.5">
                {parsed.columns.map(function(c) {
                  return <span key={c} className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-1 rounded-lg">{c}</span>
                })}
              </div>
            </div>
          </div>

          {creating && (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-xs text-gray-500">
                <span>{uploadMsg}</span><span>{uploadPct}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-300" style={{ width: uploadPct + '%', background: HERMES }} />
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
    </div>
  )
}
