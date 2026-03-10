'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import TopNav from '@/components/nav/TopNav'

interface Props {
  userEmail: string
  fullName:  string
}

type Step = 'upload' | 'name' | 'confirm'

interface ParsedFile {
  name:     string
  rows:     Record<string, unknown>[]
  columns:  string[]
  rawText:  string
}

const HERMES = '#E8632A'

// Simple CSV parser -- handles quoted fields and common delimiters
function parseCSV(text: string, delimiter: string): Record<string, unknown>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(delimiter).map(h => h.replace(/^"|"$/g, '').trim())
  return lines.slice(1).map(line => {
    const vals = line.split(delimiter).map(v => v.replace(/^"|"$/g, '').trim())
    const row: Record<string, unknown> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  })
}

function detectDelimiter(text: string): string {
  const sample = text.slice(0, 500)
  const tabs   = (sample.match(/\t/g) || []).length
  const commas = (sample.match(/,/g)  || []).length
  return tabs > commas ? '\t' : ','
}

function parseJSON(text: string): Record<string, unknown>[] {
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

export default function UploadClient({ userEmail, fullName }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep]           = useState<Step>('upload')
  const [parsed, setParsed]       = useState<ParsedFile | null>(null)
  const [parseError, setParseError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [datasetName, setDatasetName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility]   = useState<'private' | 'public'>('private')
  const [creating, setCreating]       = useState(false)
  const [createError, setCreateError] = useState('')

  function handleFile(file: File) {
    setParseError('')
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      try {
        let rows: Record<string, unknown>[]
        if (file.name.endsWith('.json')) {
          rows = parseJSON(text)
        } else {
          const delim = detectDelimiter(text)
          rows = parseCSV(text, delim)
        }
        if (rows.length === 0) throw new Error('No data rows found in file')
        const columns = Object.keys(rows[0])
        const baseName = file.name.replace(/\.(csv|tsv|json)$/, '')
        setParsed({ name: file.name, rows, columns, rawText: text })
        setDatasetName(baseName)
        setStep('name')
      } catch (err: any) {
        setParseError(err.message || 'Could not parse file')
      }
    }
    reader.readAsText(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  async function handleCreate() {
    if (!parsed || !datasetName.trim()) return
    setCreating(true)
    setCreateError('')
    try {
      // Create dataset record
      const createRes = await fetch('/api/datasets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:        datasetName.trim(),
          description: description.trim() || null,
          source:      'upload',
          visibility,
        }),
      })
      if (!createRes.ok) {
        const err = await createRes.json()
        throw new Error(err.error || 'Failed to create dataset')
      }
      const { id } = await createRes.json()

      // Upload rows
      const rowsRes = await fetch('/api/datasets/' + id + '/rows', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rows: parsed.rows, source_ref: parsed.name }),
      })
      if (!rowsRes.ok) {
        const err = await rowsRes.json()
        throw new Error(err.error || 'Failed to upload rows')
      }

      // Navigate to schema editor (settings page)
      router.push('/analyze/' + id + '/settings?new=1')
    } catch (err: any) {
      setCreateError(err.message || 'Something went wrong')
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav userEmail={userEmail} fullName={fullName} analyzeEnabled={true} currentPage="analyze" />

      <main className="pt-14">
        <div className="max-w-2xl mx-auto px-5 py-10">

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
            <Link href="/analyze" className="hover:text-orange-600 transition-colors">Analyze</Link>
            <span>/</span>
            <span className="text-gray-700">Upload Dataset</span>
          </div>

          {/* Step indicator */}
          <StepIndicator step={step} />

          {/* Step: Upload */}
          {step === 'upload' && (
            <div className="mt-8">
              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={"border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors " +
                  (isDragging ? 'border-orange-400 bg-orange-50' : 'border-gray-300 hover:border-orange-300 bg-white')}>
                <div className="text-4xl mb-3">📁</div>
                <p className="font-medium text-gray-700">Drop your file here, or click to browse</p>
                <p className="text-sm text-gray-400 mt-1">Accepts .csv, .tsv, .json</p>
                <input ref={fileRef} type="file" accept=".csv,.tsv,.json" className="hidden" onChange={handleFileInput} />
              </div>
              {parseError && (
                <p className="text-sm text-red-600 mt-3 text-center">{parseError}</p>
              )}
            </div>
          )}

          {/* Step: Name */}
          {step === 'name' && parsed && (
            <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6 flex flex-col gap-5">
              <PreviewTable columns={parsed.columns} rows={parsed.rows.slice(0, 5)} rowCount={parsed.rows.length} />

              <div className="flex flex-col gap-4 pt-2 border-t border-gray-100">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Dataset name *</label>
                  <input
                    type="text"
                    value={datasetName}
                    onChange={e => setDatasetName(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                    placeholder="e.g. Q1 Customer Feedback"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Visibility</label>
                  <div className="flex gap-3">
                    <VisibilityOption
                      value="private" current={visibility}
                      label="Private" desc="Only you and org members"
                      onSelect={() => setVisibility('private')}
                    />
                    <VisibilityOption
                      value="public" current={visibility}
                      label="Public" desc="Anyone in your org can view"
                      onSelect={() => setVisibility('public')}
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep('upload')}
                  className="text-sm text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
                  Back
                </button>
                <button
                  onClick={() => setStep('confirm')}
                  disabled={!datasetName.trim()}
                  className="text-sm font-medium px-4 py-2 rounded-lg text-white disabled:opacity-50"
                  style={{ background: HERMES }}>
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step: Confirm */}
          {step === 'confirm' && parsed && (
            <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6 flex flex-col gap-5">
              <h2 className="font-semibold text-gray-900">Confirm dataset</h2>
              <div className="flex flex-col gap-2 text-sm">
                <Row label="Name"        value={datasetName} />
                <Row label="Rows"        value={parsed.rows.length.toLocaleString()} />
                <Row label="Columns"     value={parsed.columns.length.toString()} />
                <Row label="Visibility"  value={visibility} />
              </div>
              {createError && (
                <p className="text-sm text-red-600">{createError}</p>
              )}
              <div className="flex gap-3">
                <button onClick={() => setStep('name')}
                  className="text-sm text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
                  Back
                </button>
                <button onClick={handleCreate} disabled={creating}
                  className="text-sm font-medium px-5 py-2 rounded-lg text-white disabled:opacity-60"
                  style={{ background: HERMES }}>
                  {creating ? 'Creating...' : 'Create Dataset'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

// Sub-components -- extracted as named functions per SWC rules

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload',  label: '1. Upload' },
    { key: 'name',    label: '2. Configure' },
    { key: 'confirm', label: '3. Confirm' },
  ]
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <span className={"text-sm font-medium px-3 py-1 rounded-full " +
            (s.key === step ? 'text-white' : 'text-gray-400 bg-gray-100')}
            style={s.key === step ? { background: '#E8632A' } : {}}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-gray-300">›</span>}
        </div>
      ))}
    </div>
  )
}

function PreviewTable({ columns, rows, rowCount }: { columns: string[]; rows: Record<string, unknown>[]; rowCount: number }) {
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-2">
        {'Preview — ' + rowCount.toLocaleString() + ' rows, ' + columns.length + ' columns'}
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 text-xs">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              {columns.slice(0, 6).map(col => (
                <th key={col} className="px-3 py-2 text-left font-medium text-gray-600 truncate max-w-[120px]">
                  {col}
                </th>
              ))}
              {columns.length > 6 && <th className="px-3 py-2 text-gray-400">+{columns.length - 6} more</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-100">
                {columns.slice(0, 6).map(col => (
                  <td key={col} className="px-3 py-2 text-gray-600 truncate max-w-[120px]">
                    {String(row[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VisibilityOption({ value, current, label, desc, onSelect }: {
  value: string; current: string; label: string; desc: string; onSelect: () => void
}) {
  const active = value === current
  return (
    <button onClick={onSelect}
      className={"flex-1 text-left border rounded-lg px-4 py-3 transition-colors " +
        (active ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-orange-200')}>
      <p className={"text-sm font-medium " + (active ? 'text-orange-700' : 'text-gray-700')}>{label}</p>
      <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
    </button>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-50">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  )
}
