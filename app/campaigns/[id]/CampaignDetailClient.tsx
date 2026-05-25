'use client'

import { useState, useRef, useEffect } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import ShareModal from '@/components/ui/ShareModal'
import DownloadButton from '@/components/ui/DownloadButton'
import Link from 'next/link'
import type { CampaignEmail, CampaignRespondent, CampaignStatus, EmailProviderType } from '@/lib/types'

const HERMES = '#E8632A'

interface CampaignData {
  id: string; name: string; status: CampaignStatus; study_id: string
  study_url: string; hidden_fields: string[]; target_responses: number | null
  email_provider: string; email_config: any; send_thank_you: boolean; send_incomplete: boolean
  study_name?: string; study_status?: string; study_guid?: string; study_slug?: string
  created_at: string
}
interface Props {
  logoUrl?: string; analyzeEnabled?: boolean; campaignsEnabled?: boolean; features?: Record<string, boolean>
  user: { email: string; fullName?: string; clientName?: string; isAdmin?: boolean; userId: string }
  campaign: CampaignData
  emails: CampaignEmail[]
  respondents: CampaignRespondent[]
  totalRespondents: number
}

type Tab = 'setup' | 'respondents' | 'emails' | 'send'

// -- File parser (CSV, TSV, JSON, Excel) ----------------------
type ParsedData = { headers: string[]; rows: Record<string, string>[] }

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; continue }
      if (ch === '"') { inQuotes = false; continue }
      current += ch
    } else {
      if (ch === '"') { inQuotes = true; continue }
      if (ch === delimiter) { result.push(current.trim()); current = ''; continue }
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function parseDelimited(text: string, delimiter: string): ParsedData {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = splitDelimitedLine(lines[0], delimiter)
  const rows = lines.slice(1).map(line => {
    const vals = splitDelimitedLine(line, delimiter)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] || '' })
    return row
  })
  return { headers, rows }
}

function parseJSON(text: string): ParsedData {
  const data = JSON.parse(text)
  const arr = Array.isArray(data) ? data : data.respondents || data.data || data.rows || []
  if (arr.length === 0) return { headers: [], rows: [] }
  const headers = Object.keys(arr[0]).filter(k => typeof arr[0][k] !== 'object')
  const rows = arr.map((item: any) => {
    const row: Record<string, string> = {}
    headers.forEach(h => { row[h] = item[h] != null ? String(item[h]) : '' })
    return row
  })
  return { headers, rows }
}

async function parseExcel(buffer: ArrayBuffer): Promise<ParsedData> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet)
  if (json.length === 0) return { headers: [], rows: [] }
  const headers = Object.keys(json[0])
  const rows = json.map(item => {
    const row: Record<string, string> = {}
    headers.forEach(h => { row[h] = item[h] != null ? String(item[h]) : '' })
    return row
  })
  return { headers, rows }
}

async function parseFile(file: File): Promise<ParsedData> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer()
    return parseExcel(buffer)
  }
  const text = await file.text()
  if (name.endsWith('.json')) return parseJSON(text)
  if (name.endsWith('.tsv') || name.endsWith('.tab')) return parseDelimited(text, '\t')
  return parseDelimited(text, ',')
}

// -- Edit Campaign Modal --------------------------------------
function EditCampaignModal({ campaign, onSave, onClose }: {
  campaign: CampaignData; onSave: (updates: Partial<CampaignData>) => void; onClose: () => void
}) {
  const [name, setName] = useState(campaign.name)
  const [target, setTarget] = useState(campaign.target_responses?.toString() || '')
  const [provider, setProvider] = useState(campaign.email_provider)
  const [thankYou, setThankYou] = useState(campaign.send_thank_you)
  const [incomplete, setIncomplete] = useState(campaign.send_incomplete)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/campaigns/' + campaign.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          target_responses: target ? parseInt(target) : null,
          email_provider: provider,
          send_thank_you: thankYou,
          send_incomplete: incomplete,
        }),
      })
      if (res.ok) {
        onSave({
          name: name.trim(),
          target_responses: target ? parseInt(target) : null,
          email_provider: provider,
          send_thank_you: thankYou,
          send_incomplete: incomplete,
        })
        onClose()
      }
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-800 text-base">Edit Campaign</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Campaign Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Target Responses</label>
            <input type="number" min={0} value={target} onChange={e => setTarget(e.target.value)}
              placeholder="Optional"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Email Provider</label>
            <select value={provider} onChange={e => setProvider(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400">
              <option value="resend">Resend</option>
              <option value="sendgrid">SendGrid</option>
              <option value="ses">AWS SES</option>
              <option value="smtp">Custom SMTP</option>
            </select>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={thankYou} onChange={e => setThankYou(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-orange-500" />
              Send thank you on completion
            </label>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={incomplete} onChange={e => setIncomplete(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-orange-500" />
              Remind on incomplete responses
            </label>
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium">Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            style={{ background: HERMES }}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// -- Respondent upload component ------------------------------
// -- Add single recipient inline form ----------------------------
function AddSingleRecipient({ campaignId, onDone }: { campaignId: string; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAdd = async () => {
    const trimmed = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError('Invalid email'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/campaigns/' + campaignId + '/respondents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ respondents: [{ email: trimmed, fields: {} }] }),
      })
      const data = await res.json()
      if (data.skipped_duplicate > 0) { setError('Already exists'); setSaving(false); return }
      onDone()
    } catch { setError('Failed'); setSaving(false) }
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <input type="email" value={email} onChange={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        placeholder="Enter email address..."
        className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-orange-400" />
      <button onClick={handleAdd} disabled={saving || !email.trim()}
        className="text-xs px-3 py-1.5 rounded-lg text-white font-medium disabled:opacity-50"
        style={{ background: HERMES }}>
        {saving ? 'Adding...' : 'Add'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}

function RespondentUpload({ campaignId, hiddenFields, onDone }: {
  campaignId: string; hiddenFields: string[]; onDone: () => void
}) {
  const [step, setStep] = useState<'upload' | 'map' | 'review' | 'confirm'>('upload')
  const [csvData, setCsvData] = useState<{ headers: string[]; rows: Record<string, string>[] }>({ headers: [], rows: [] })
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [emailCol, setEmailCol] = useState('')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped_duplicate: number; skipped_invalid: number } | null>(null)
  const [included, setIncluded] = useState<Set<number>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const [dragging, setDragging] = useState(false)

  const processFile = async (file: File) => {
    setParseError(null)
    try {
      const parsed = await parseFile(file)
      if (parsed.headers.length === 0) { setParseError('No data found in file'); return }
      setCsvData(parsed)
      const emailHeader = parsed.headers.find(h => h.toLowerCase().includes('email'))
      if (emailHeader) setEmailCol(emailHeader)
      const autoMap: Record<string, string> = {}
      for (const col of parsed.headers) {
        if (col === emailHeader) continue
        const fieldKey = col.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
        if (fieldKey) autoMap[fieldKey] = col
      }
      setMapping(autoMap)
      setStep('map')
    } catch { setParseError('Failed to parse file. Check the format and try again.') }
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await processFile(file)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    await processFile(file)
  }

  const goToReview = () => {
    // Include all rows by default
    setIncluded(new Set(csvData.rows.map((_, i) => i)))
    setStep('review')
  }

  const toggleRow = (i: number) => {
    setIncluded(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const toggleAll = () => {
    if (included.size === csvData.rows.length) setIncluded(new Set())
    else setIncluded(new Set(csvData.rows.map((_, i) => i)))
  }

  // Detect duplicate emails within the file
  const getDuplicateIndices = (): Set<number> => {
    const seen = new Map<string, number>()
    const dupes = new Set<number>()
    csvData.rows.forEach((row, i) => {
      if (!included.has(i)) return
      const email = (row[emailCol] || '').toLowerCase().trim()
      if (!email) return
      if (seen.has(email)) {
        dupes.add(i)
        dupes.add(seen.get(email)!)
      } else {
        seen.set(email, i)
      }
    })
    return dupes
  }

  const duplicateIndices = emailCol ? getDuplicateIndices() : new Set<number>()

  const handleUpload = async () => {
    setUploading(true)
    // Deduplicate: keep first occurrence of each email
    const seenEmails = new Set<string>()
    const respondents = csvData.rows
      .filter((_, i) => included.has(i))
      .map(row => {
        const fields: Record<string, string> = {}
        for (const [hf, col] of Object.entries(mapping)) {
          if (col && row[col]) fields[hf] = row[col]
        }
        return { email: (row[emailCol] || '').toLowerCase().trim(), fields }
      })
      .filter(r => {
        if (!r.email) return false
        if (seenEmails.has(r.email)) return false
        seenEmails.add(r.email)
        return true
      })

    try {
      const res = await fetch('/api/campaigns/' + campaignId + '/respondents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ respondents }),
      })
      const data = await res.json()
      setResult(data)
      setStep('confirm')
    } finally { setUploading(false) }
  }

  if (step === 'confirm' && result) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <p className="text-sm text-green-700 font-medium">Imported {result.imported} respondents</p>
        {(result.skipped_duplicate || 0) > 0 && <p className="text-xs text-blue-600 mt-1">{result.skipped_duplicate} duplicates skipped</p>}
        {result.skipped_invalid > 0 && <p className="text-xs text-yellow-600 mt-1">{result.skipped_invalid} invalid emails skipped</p>}
        <button onClick={onDone} className="mt-3 text-xs px-3 py-1.5 rounded-lg font-medium text-white" style={{ background: HERMES }}>Done</button>
      </div>
    )
  }

  // Review step — include/exclude individual rows
  if (step === 'review') {
    const allHeaders = [emailCol, ...hiddenFields.filter(hf => mapping[hf])].filter(Boolean)
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="font-semibold text-sm text-gray-800">Review recipients</h4>
            <p className="text-xs text-gray-500">
              {included.size} of {csvData.rows.length} selected
              {duplicateIndices.size > 0 && <span className="text-amber-600 ml-1">({Math.floor(duplicateIndices.size / 2)} duplicate email{Math.floor(duplicateIndices.size / 2) !== 1 ? 's' : ''} — first occurrence kept)</span>}
            </p>
          </div>
          <button onClick={toggleAll} className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 font-medium hover:bg-gray-200">
            {included.size === csvData.rows.length ? 'Deselect all' : 'Select all'}
          </button>
        </div>

        <div className="overflow-x-auto max-h-[400px] overflow-y-auto border border-gray-100 rounded-lg">
          <table className="text-xs w-full border-collapse">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="px-2 py-1.5 border-b border-gray-200 w-8"></th>
                <th className="text-left px-2 py-1.5 border-b border-gray-200 text-gray-600 font-semibold">#</th>
                {allHeaders.map(h => (
                  <th key={h} className="text-left px-2 py-1.5 border-b border-gray-200 text-gray-600 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csvData.rows.map((row, i) => {
                const isIn = included.has(i)
                const email = row[emailCol] || ''
                const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
                const isDupe = duplicateIndices.has(i)
                return (
                  <tr key={i} className={isIn ? '' : 'opacity-40'} onClick={() => toggleRow(i)} style={{ cursor: 'pointer' }}>
                    <td className="px-2 py-1 border-b border-gray-50">
                      <input type="checkbox" checked={isIn} readOnly
                        className="w-3.5 h-3.5 rounded border-gray-300 text-orange-500" />
                    </td>
                    <td className="px-2 py-1 border-b border-gray-50 text-gray-400">{i + 1}</td>
                    {allHeaders.map(h => {
                      const val = h === emailCol ? email : (mapping[h] ? row[mapping[h]] || '' : '')
                      const isEmailCol = h === emailCol
                      return (
                        <td key={h} className={'px-2 py-1 border-b border-gray-50 ' +
                          (isEmailCol && isDupe ? 'text-amber-600 font-medium' :
                           isEmailCol && !isValid && email ? 'text-red-500' : 'text-gray-700')}>
                          {val || <span className="text-gray-300">-</span>}
                          {isEmailCol && isDupe && <span className="text-[9px] ml-1 text-amber-500">dup</span>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={() => setStep('map')}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 font-medium">Back</button>
          <button onClick={handleUpload} disabled={included.size === 0 || uploading}
            className="text-xs px-4 py-1.5 rounded-lg text-white font-medium disabled:opacity-50"
            style={{ background: HERMES }}>
            {uploading ? 'Importing...' : 'Import ' + included.size + ' respondents'}
          </button>
        </div>
      </div>
    )
  }

  if (step === 'map') {
    // All columns except email are available for field mapping
    const otherCols = csvData.headers.filter(h => h !== emailCol)

    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h4 className="font-semibold text-sm text-gray-800 mb-2">Map columns</h4>
        <p className="text-xs text-gray-500 mb-3">
          {csvData.rows.length} rows, {csvData.headers.length} columns. Map each column to a field name — these become merge tags in your emails (e.g. {'{{first_name}}'}).
        </p>

        {/* Email column */}
        <div className="flex items-center gap-3 mb-3 pb-3 border-b border-gray-100">
          <label className="text-xs font-semibold text-gray-700 w-32">Email column *</label>
          <select value={emailCol} onChange={e => setEmailCol(e.target.value)}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400">
            <option value="">-- select --</option>
            {csvData.headers.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>

        {/* Map ALL other columns */}
        <p className="text-[10px] font-semibold text-gray-400 uppercase mb-2">Field mapping — include columns you want as merge tags</p>
        {otherCols.map(col => {
          // Auto-generate a clean field name from the column header
          const autoKey = col.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
          const isIncluded = mapping[autoKey] === col || Object.values(mapping).includes(col)
          const currentKey = Object.entries(mapping).find(([, v]) => v === col)?.[0] || ''

          return (
            <div key={col} className="flex items-center gap-3 mb-1.5">
              <label className="text-xs text-gray-600 w-32 truncate" title={col}>{col}</label>
              <span className="text-gray-300 text-xs">→</span>
              <input
                type="text"
                value={currentKey}
                onChange={e => {
                  // Remove old mapping for this column
                  const cleaned = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== col))
                  const newKey = e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
                  if (newKey) cleaned[newKey] = col
                  setMapping(cleaned)
                }}
                placeholder={autoKey || 'skip'}
                className={'flex-1 text-xs border rounded-lg px-2 py-1.5 outline-none focus:border-orange-400 ' +
                  (currentKey ? 'border-blue-200 bg-blue-50' : 'border-gray-200')}
              />
              {!currentKey && (
                <button type="button" onClick={() => setMapping(prev => ({ ...prev, [autoKey]: col }))}
                  className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 font-medium hover:bg-blue-100">
                  Include
                </button>
              )}
              {currentKey && (
                <button type="button" onClick={() => setMapping(prev => Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== col)))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-500 font-medium hover:bg-gray-200">
                  Skip
                </button>
              )}
            </div>
          )
        })}

        {/* Preview */}
        {csvData.rows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <p className="text-xs text-gray-500 mb-2">Preview (first 3 rows with mapped fields):</p>
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1 border-b border-gray-200 text-gray-600">email</th>
                  {Object.entries(mapping).map(([key]) => (
                    <th key={key} className="text-left px-2 py-1 border-b border-gray-200 text-blue-600">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvData.rows.slice(0, 3).map((row, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1 border-b border-gray-100 text-gray-700">{row[emailCol] || '-'}</td>
                    {Object.entries(mapping).map(([key, col]) => (
                      <td key={key} className="px-2 py-1 border-b border-gray-100 text-gray-500">{row[col] || '-'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={() => { setStep('upload'); setCsvData({ headers: [], rows: [] }); setMapping({}) }}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 font-medium">Back</button>
          <button onClick={goToReview} disabled={!emailCol}
            className="text-xs px-4 py-1.5 rounded-lg text-white font-medium disabled:opacity-50"
            style={{ background: HERMES }}>
            Review {csvData.rows.length} rows
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={'border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ' +
        (dragging ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white hover:border-gray-300')}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragEnter={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => fileRef.current?.click()}
    >
      <div className="text-3xl mb-2">{dragging ? '📥' : '📄'}</div>
      <p className="text-sm text-gray-600 mb-1">
        {dragging ? 'Drop your file here' : 'Drag & drop your file here, or click to browse'}
      </p>
      <p className="text-xs text-gray-400 mb-1">Supported formats: CSV, TSV, JSON, Excel (.xlsx)</p>
      <p className="text-xs text-gray-400 mb-4">Required column: email. Optional: {hiddenFields.join(', ') || 'none'}</p>
      {parseError && <p className="text-xs text-red-500 mb-3">{parseError}</p>}
      <input ref={fileRef} type="file" accept=".csv,.tsv,.tab,.txt,.json,.xlsx,.xls" onChange={handleFile} className="hidden" />
      <button onClick={e => { e.stopPropagation(); fileRef.current?.click() }}
        className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: HERMES }}>
        Choose file
      </button>
    </div>
  )
}

// -- Merge tag pill bar ----------------------------------------
function MergeTagBar({ tags, onInsert, target }: {
  tags: { key: string; label: string; color: string }[]
  onInsert: (tag: string) => void
  target: 'subject' | 'body'
}) {
  return (
    <div className="flex flex-wrap gap-1 mb-2">
      <span className="text-[10px] text-gray-400 font-medium self-center mr-1">Insert:</span>
      {tags.map(t => (
        <button key={t.key} type="button" onClick={() => onInsert('{{' + t.key + '}}')}
          title={'Insert {{' + t.key + '}} into ' + target}
          className="text-[11px] px-2 py-0.5 rounded-full font-medium transition-all hover:opacity-80"
          style={{ background: t.color + '18', color: t.color, border: '1px solid ' + t.color + '30' }}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// HTML entity escaper for user-controlled values in email templates
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// -- Template structure → HTML generator -------------------------
interface EmailBlock {
  type: 'text' | 'heading' | 'image' | 'numbered_step' | 'divider' | 'spacer' | 'signature' | 'button'
  content: string
  // image fields
  imageUrl?: string
  imageAlt?: string
  imageWidth?: string       // e.g. '100%' or '200px'
  imageAlign?: 'left' | 'center' | 'right'
  imageLink?: string        // optional clickable link
  // numbered_step fields
  stepNumber?: number
  stepHeading?: string
  // signature fields
  signatureName?: string
  signatureTitle?: string
  signatureImageUrl?: string
  // button fields
  buttonUrl?: string
  buttonColor?: string
}
interface TemplateStructure {
  headerColor: string
  headerText: string
  headerLogoUrl: string     // logo image URL for header
  headerLogoWidth: string   // logo width e.g. '150px'
  headerLayout: 'text' | 'logo' | 'logo-text' | 'dual-logo'  // header layout style
  headerLogoUrl2: string    // second logo for dual-logo layout
  greeting: string
  blocks: EmailBlock[]
  ctaText: string
  ctaColor: string          // button color (defaults to headerColor)
  closing: string
}

function parseStructureFromHtml(html: string): TemplateStructure {
  // Best-effort extraction from existing HTML templates
  const struct: TemplateStructure = {
    headerColor: '#E8632A',
    headerText: '',
    headerLogoUrl: '',
    headerLogoWidth: '150px',
    headerLayout: 'text',
    headerLogoUrl2: '',
    greeting: '',
    blocks: [],
    ctaText: 'Take the Survey',
    ctaColor: '',
    closing: '',
  }
  // Extract header text
  const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i)
  if (h1Match) struct.headerText = h1Match[1].replace(/<[^>]+>/g, '')
  // Extract header color
  const gradMatch = html.match(/background:\s*linear-gradient\([^,]+,\s*(#[0-9a-f]+)/i)
  if (gradMatch) struct.headerColor = gradMatch[1]
  // Extract header logo
  const headerLogoMatch = html.match(/data-block="header-logo"[^>]*src="([^"]+)"/i)
  if (headerLogoMatch) {
    struct.headerLogoUrl = headerLogoMatch[1]
    struct.headerLayout = struct.headerText ? 'logo-text' : 'logo'
  }
  // Extract CTA button color
  const ctaBtnMatch = html.match(/<a[^>]*style="[^"]*background:\s*(#[0-9a-f]+)/i)
  if (ctaBtnMatch) struct.ctaColor = ctaBtnMatch[1]
  // Extract numbered steps
  const stepMatches = Array.from(html.matchAll(/data-block="step"[^>]*>[\s\S]*?<td[^>]*style="[^"]*font-size:\s*28px[^"]*"[^>]*>(\d+)<\/td>[\s\S]*?<strong[^>]*>(.*?)<\/strong>[\s\S]*?<\/div>\s*([\s\S]*?)<\/td>/gi))
  const steps: EmailBlock[] = []
  for (const m of stepMatches) {
    steps.push({ type: 'numbered_step', content: m[3]?.replace(/<[^>]+>/g, '').trim() || '', stepNumber: parseInt(m[1]), stepHeading: m[2]?.replace(/<[^>]+>/g, '').trim() || '' })
  }
  // Extract image blocks
  const imgMatches = Array.from(html.matchAll(/data-block="image"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*(?:alt="([^"]*)")?/gi))
  for (const m of imgMatches) {
    struct.blocks.push({ type: 'image', content: '', imageUrl: m[1], imageAlt: m[2] || '' })
  }
  // Extract signature blocks
  const sigMatch = html.match(/data-block="signature"[\s\S]*?<strong[^>]*>(.*?)<\/strong>[\s\S]*?<span[^>]*>(.*?)<\/span>/i)
  if (sigMatch) {
    struct.blocks.push({ type: 'signature', content: '', signatureName: sigMatch[1].replace(/<[^>]+>/g, ''), signatureTitle: sigMatch[2].replace(/<[^>]+>/g, '') })
  }
  // Extract paragraphs (skip ones already captured as steps/signatures)
  const pMatches = html.match(/<p[^>]*>(.*?)<\/p>/gi) || []
  for (const p of pMatches) {
    const text = p.replace(/<[^>]+>/g, '').trim()
    if (!text || text.includes('Unsubscribe')) continue
    if (!struct.greeting && (text.startsWith('Hi') || text.startsWith('Hello') || text.startsWith('Dear'))) {
      struct.greeting = text
    } else if (text.length > 5) {
      struct.blocks.push({ type: 'text', content: text })
    }
  }
  // Add steps in order
  if (steps.length > 0) {
    // Insert steps before closing text blocks
    struct.blocks.splice(struct.blocks.length, 0, ...steps)
  }
  // Extract CTA text
  const ctaMatch = html.match(/<a[^>]*>([^<]+)<\/a>/i)
  if (ctaMatch) struct.ctaText = ctaMatch[1].trim()
  // Last block is closing if short
  if (struct.blocks.length > 0 && struct.blocks[struct.blocks.length - 1].type === 'text' && struct.blocks[struct.blocks.length - 1].content.length < 60) {
    struct.closing = struct.blocks.pop()!.content
  }
  // Defaults
  if (!struct.greeting) struct.greeting = 'Hi {{first_name}},'
  if (struct.blocks.length === 0) struct.blocks.push({ type: 'text', content: 'We value your input and would love to hear your thoughts.' })
  if (!struct.closing) struct.closing = 'Thank you for your time!'
  if (!struct.headerText) struct.headerText = '{{campaign_name}}'
  return struct
}

function buildHtmlFromStructure(s: TemplateStructure): string {
  const btnColor = s.ctaColor || s.headerColor
  const blocks = s.blocks.map(b => {
    switch (b.type) {
      case 'heading':
        return `    <h2 style="margin:0 0 12px;font-size:18px;color:#1a1a1a;font-weight:700">${escHtml(b.content)}</h2>`
      case 'image': {
        const w = b.imageWidth || '100%'
        const align = b.imageAlign || 'center'
        const alignStyle = align === 'center' ? 'margin:0 auto;display:block' : align === 'right' ? 'margin-left:auto;display:block' : ''
        const img = `<img src="${escAttr(b.imageUrl || '')}" alt="${escAttr(b.imageAlt || '')}" style="max-width:100%;width:${w};height:auto;border-radius:8px;${alignStyle}" data-block="image" />`
        return `    <div style="margin:16px 0;text-align:${align}">${b.imageLink ? `<a href="${escAttr(b.imageLink)}" style="text-decoration:none">${img}</a>` : img}</div>`
      }
      case 'numbered_step':
        return `    <table data-block="step" cellpadding="0" cellspacing="0" style="width:100%;margin:12px 0;border-collapse:collapse"><tr>
      <td style="width:44px;vertical-align:top;padding-right:12px"><div style="width:36px;height:36px;border-radius:50%;background:${btnColor};color:white;font-size:28px;font-weight:700;text-align:center;line-height:36px">${b.stepNumber || 1}</div></td>
      <td style="vertical-align:top"><div style="font-size:14px"><strong style="color:#1a1a1a">${escHtml(b.stepHeading || '')}</strong></div>${b.content ? `<div style="color:#6b7280;font-size:13px;margin-top:2px">${escHtml(b.content)}</div>` : ''}</td>
    </tr></table>`
      case 'divider':
        return `    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0" />`
      case 'spacer':
        return `    <div style="height:${parseInt(b.content) || 24}px"></div>`
      case 'button': {
        const bColor = b.buttonColor || btnColor
        return `    <p style="margin:20px 0;text-align:center"><a href="${escAttr(b.buttonUrl || '{{survey_link}}')}" style="display:inline-block;background:${bColor};color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">${escHtml(b.content || 'Click Here')}</a></p>`
      }
      case 'signature': {
        const sigImg = b.signatureImageUrl ? `<img src="${escAttr(b.signatureImageUrl)}" alt="signature" style="max-width:160px;height:auto;margin-top:8px" />` : ''
        return `    <div data-block="signature" style="margin:20px 0;padding-top:16px;border-top:1px solid #e5e7eb">
      ${sigImg}
      <div style="margin-top:4px"><strong style="color:#1a1a1a;font-size:14px">${escHtml(b.signatureName || '')}</strong></div>
      <span style="color:#6b7280;font-size:13px">${escHtml(b.signatureTitle || '')}</span>
    </div>`
      }
      default:
        return `    <p style="margin:0 0 12px;line-height:1.6">${b.content}</p>`
    }
  }).join('\n')

  // Build header based on layout
  let headerContent = ''
  if (s.headerLayout === 'logo' && s.headerLogoUrl) {
    headerContent = `<img data-block="header-logo" src="${s.headerLogoUrl}" alt="Logo" style="max-width:${s.headerLogoWidth || '150px'};height:auto" />`
  } else if (s.headerLayout === 'logo-text' && s.headerLogoUrl) {
    headerContent = `<img data-block="header-logo" src="${s.headerLogoUrl}" alt="Logo" style="max-width:${s.headerLogoWidth || '150px'};height:auto;margin-bottom:12px" />\n    <h1 style="color:white;margin:0;font-size:20px">${s.headerText}</h1>`
  } else if (s.headerLayout === 'dual-logo' && s.headerLogoUrl) {
    headerContent = `<table cellpadding="0" cellspacing="0" style="width:100%"><tr>
      <td style="text-align:left"><img data-block="header-logo" src="${s.headerLogoUrl}" alt="Logo" style="max-width:${s.headerLogoWidth || '150px'};height:auto" /></td>
      <td style="text-align:right"><img data-block="header-logo-2" src="${s.headerLogoUrl2 || ''}" alt="Logo 2" style="max-width:${s.headerLogoWidth || '150px'};height:auto" /></td>
    </tr></table>`
  } else {
    headerContent = `<h1 style="color:white;margin:0;font-size:20px">${s.headerText}</h1>`
  }

  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <div style="background:linear-gradient(135deg,${s.headerColor},${s.headerColor}cc);padding:24px;border-radius:12px 12px 0 0">
    ${headerContent}
  </div>
  <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb">
    <p style="margin:0 0 12px;line-height:1.6">${s.greeting}</p>
${blocks}
    <p style="margin:24px 0;text-align:center">
      <a href="{{survey_link}}" style="display:inline-block;background:${btnColor};color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">${s.ctaText}</a>
    </p>
    <p style="color:#6b7280;font-size:14px">${s.closing}</p>
  </div>
</div>`
}

// -- Email template editor component --------------------------
function EmailTemplateEditor({ campaignId, emails: initial, hiddenFields, respondentFieldKeys }: {
  campaignId: string; emails: CampaignEmail[]; hiddenFields: string[]; respondentFieldKeys: string[]
}) {
  const [emails, setEmails] = useState(initial)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [sendTo, setSendTo] = useState('all')
  const [delayHours, setDelayHours] = useState(0)
  const [sendTime, setSendTime] = useState<string>('')
  const [showPreview, setShowPreview] = useState(true)
  const [editorMode, setEditorMode] = useState<'builder' | 'html'>('builder')
  const [tmplStruct, setTmplStruct] = useState<TemplateStructure>({ headerColor: '#E8632A', headerText: '', headerLogoUrl: '', headerLogoWidth: '150px', headerLayout: 'text', headerLogoUrl2: '', greeting: '', blocks: [], ctaText: '', ctaColor: '', closing: '' })
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Build merge tags from all sources
  const allFieldKeys = Array.from(new Set([...hiddenFields, ...respondentFieldKeys]))
  const mergeTags: { key: string; label: string; color: string }[] = [
    // Respondent fields (from imported data)
    ...allFieldKeys.map(k => ({ key: k, label: k.replace(/_/g, ' '), color: '#2563eb' })),
    // Built-in tags
    { key: 'email', label: 'email', color: '#7c3aed' },
    { key: 'survey_link', label: 'survey link', color: '#16a34a' },
    { key: 'unsubscribe_link', label: 'unsubscribe', color: '#9ca3af' },
    { key: 'study_name', label: 'study name', color: '#e8622a' },
    { key: 'campaign_name', label: 'campaign name', color: '#e8622a' },
  ]

  const insertIntoSubject = (tag: string) => {
    const el = subjectRef.current
    if (!el) { setSubject(prev => prev + tag); return }
    const start = el.selectionStart ?? subject.length
    const end = el.selectionEnd ?? subject.length
    setSubject(subject.slice(0, start) + tag + subject.slice(end))
    setTimeout(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length) }, 0)
  }

  const insertIntoBody = (tag: string) => {
    const el = bodyRef.current
    if (!el) { setBodyHtml(prev => prev + tag); return }
    const start = el.selectionStart ?? bodyHtml.length
    const end = el.selectionEnd ?? bodyHtml.length
    setBodyHtml(bodyHtml.slice(0, start) + tag + bodyHtml.slice(end))
    setTimeout(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length) }, 0)
  }

  // Preview: replace merge tags with sample values
  const previewHtml = (html: string) => {
    const sampleVals: Record<string, string> = {
      email: 'jane@example.com', survey_link: '#', unsubscribe_link: '#',
      study_name: 'Customer Feedback', campaign_name: 'Q1 Outreach',
      first_name: 'Jane', last_name: 'Smith', company: 'Acme Corp',
      name: 'Jane Smith', department: 'Marketing', location: 'New York',
    }
    // Also map all respondent field keys to sample values
    for (const k of allFieldKeys) {
      if (!sampleVals[k]) sampleVals[k] = '[' + k + ']'
    }
    return html.replace(/\{\{(\w+)\}\}/g, (_, key) => sampleVals[key] || '[' + key + ']')
  }

  const startEdit = (email: CampaignEmail) => {
    setEditing(email.id)
    setSubject(email.subject)
    setBodyHtml(email.body_html)
    setSendTo(email.send_to)
    setDelayHours(email.send_delay_hours)
    setSendTime(email.send_time || '')
    setTmplStruct(parseStructureFromHtml(email.body_html))
    setEditorMode('builder')
  }

  const updateStruct = (patch: Partial<TemplateStructure>) => {
    const next = { ...tmplStruct, ...patch }
    setTmplStruct(next)
    setBodyHtml(buildHtmlFromStructure(next))
  }

  const updateBlock = (i: number, content: string) => {
    const blocks = tmplStruct.blocks.map((b, j) => j === i ? { ...b, content } : b)
    updateStruct({ blocks })
  }

  const addBlock = (type: EmailBlock['type'] = 'text') => {
    const newBlock: EmailBlock = { type, content: '' }
    if (type === 'numbered_step') {
      const existingSteps = tmplStruct.blocks.filter(b => b.type === 'numbered_step').length
      newBlock.stepNumber = existingSteps + 1
      newBlock.stepHeading = ''
    }
    if (type === 'image') {
      newBlock.imageUrl = ''
      newBlock.imageAlt = ''
      newBlock.imageWidth = '100%'
      newBlock.imageAlign = 'center'
    }
    if (type === 'signature') {
      newBlock.signatureName = ''
      newBlock.signatureTitle = ''
    }
    if (type === 'button') {
      newBlock.content = 'Click Here'
      newBlock.buttonUrl = '{{survey_link}}'
      newBlock.buttonColor = ''
    }
    if (type === 'spacer') newBlock.content = '24'
    updateStruct({ blocks: [...tmplStruct.blocks, newBlock] })
  }

  const removeBlock = (i: number) => {
    updateStruct({ blocks: tmplStruct.blocks.filter((_, j) => j !== i) })
  }

  const moveBlock = (i: number, dir: -1 | 1) => {
    const blocks = [...tmplStruct.blocks]
    const target = i + dir
    if (target < 0 || target >= blocks.length) return
    ;[blocks[i], blocks[target]] = [blocks[target], blocks[i]]
    updateStruct({ blocks })
  }

  const updateBlockField = (i: number, patch: Partial<EmailBlock>) => {
    const blocks = tmplStruct.blocks.map((b, j) => j === i ? { ...b, ...patch } : b)
    updateStruct({ blocks })
  }

  const insertTagIntoField = (setter: (v: string) => void, value: string, tag: string) => {
    setter(value + tag)
  }

  const saveEmail = async (emailId: string) => {
    setSaving(true)
    try {
      const res = await fetch('/api/campaigns/' + campaignId + '/emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_id: emailId, subject, body_html: bodyHtml, send_to: sendTo,
          send_delay_hours: delayHours,
          send_time: sendTime || null,
        }),
      })
      if (!res.ok) throw new Error('Failed to save email')
      setEmails(prev => prev.map(e => e.id === emailId ? {
        ...e, subject, body_html: bodyHtml, send_to: sendTo as CampaignEmail['send_to'],
        send_delay_hours: delayHours,
        send_time: sendTime || null,
      } : e))
      setEditing(null)
    } finally { setSaving(false) }
  }

  const addEmail = async () => {
    const seq = emails.length
    const defaults = getDefaultTemplate(seq)
    const res = await fetch('/api/campaigns/' + campaignId + '/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sequence: seq, subject: defaults.subject, body_html: defaults.body_html,
        send_to: seq === 0 ? 'all' : 'non_responders',
        send_delay_hours: seq === 0 ? 0 : seq === 1 ? 72 : 168,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      setEmails(prev => [...prev, { ...data, ...defaults, campaign_id: campaignId, sequence: seq, send_to: seq === 0 ? 'all' : 'non_responders', send_delay_hours: seq === 0 ? 0 : seq === 1 ? 72 : 168, is_thank_you: false, body_text: null, created_at: '', updated_at: '' }])
    }
  }

  return (
    <div className="space-y-3">
      {emails.map(email => (
        <div key={email.id} className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-semibold text-gray-500">
                {email.sequence === 0 ? 'Initial Email' : email.is_thank_you ? 'Thank You' : 'Reminder ' + email.sequence}
              </span>
              {email.send_delay_hours > 0 && (
                <span className="text-xs text-gray-400 ml-2">
                  ({email.send_delay_hours < 24 ? email.send_delay_hours + 'h' : Math.round(email.send_delay_hours / 24) + 'd'} after launch)
                </span>
              )}
              <span className="text-xs text-gray-400 ml-2">to: {email.send_to.replace('_', ' ')}</span>
            </div>
            <button onClick={() => editing === email.id ? setEditing(null) : startEdit(email)}
              className="text-xs px-2.5 py-1 rounded-lg font-medium"
              style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' }}>
              {editing === email.id ? 'Cancel' : 'Edit'}
            </button>
          </div>

          {editing === email.id ? (
            <div className="space-y-3">
              {/* Subject */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Subject line</label>
                <MergeTagBar tags={mergeTags} onInsert={insertIntoSubject} target="subject" />
                <input ref={subjectRef} value={subject} onChange={e => setSubject(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400" />
              </div>

              {/* Editor mode toggle */}
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-600">Email body</label>
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                  <button type="button" onClick={() => setEditorMode('builder')}
                    className={'text-[10px] px-2.5 py-0.5 rounded font-medium ' + (editorMode === 'builder' ? 'bg-white shadow-sm text-gray-700' : 'text-gray-400')}>
                    Builder
                  </button>
                  <button type="button" onClick={() => { setEditorMode('html'); setBodyHtml(buildHtmlFromStructure(tmplStruct)) }}
                    className={'text-[10px] px-2.5 py-0.5 rounded font-medium ' + (editorMode === 'html' ? 'bg-white shadow-sm text-gray-700' : 'text-gray-400')}>
                    HTML
                  </button>
                </div>
              </div>

              {editorMode === 'builder' ? (
                <div className="grid grid-cols-2 gap-4">
                  {/* Form side */}
                  <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: 600 }}>
                    {/* Header */}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                      <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1.5">Header banner</label>
                      <div className="flex gap-2 mb-2">
                        <input type="color" value={tmplStruct.headerColor} onChange={e => updateStruct({ headerColor: e.target.value })}
                          className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0" title="Banner color" />
                        <select value={tmplStruct.headerLayout} onChange={e => updateStruct({ headerLayout: e.target.value as TemplateStructure['headerLayout'] })}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400">
                          <option value="text">Text only</option>
                          <option value="logo">Logo only</option>
                          <option value="logo-text">Logo + text</option>
                          <option value="dual-logo">Two logos</option>
                        </select>
                      </div>
                      {(tmplStruct.headerLayout === 'text' || tmplStruct.headerLayout === 'logo-text') && (
                        <input value={tmplStruct.headerText} onChange={e => updateStruct({ headerText: e.target.value })}
                          placeholder="Header text (e.g. {{campaign_name}})"
                          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400 mb-1.5" />
                      )}
                      {tmplStruct.headerLayout !== 'text' && (
                        <div className="space-y-1.5">
                          <input value={tmplStruct.headerLogoUrl} onChange={e => updateStruct({ headerLogoUrl: e.target.value })}
                            placeholder="Logo image URL"
                            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                          {tmplStruct.headerLayout === 'dual-logo' && (
                            <input value={tmplStruct.headerLogoUrl2} onChange={e => updateStruct({ headerLogoUrl2: e.target.value })}
                              placeholder="Second logo URL"
                              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                          )}
                          <div className="flex gap-2">
                            <input value={tmplStruct.headerLogoWidth} onChange={e => updateStruct({ headerLogoWidth: e.target.value })}
                              placeholder="Logo width (e.g. 150px)"
                              className="w-24 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                            <span className="text-[10px] text-gray-400 self-center">max width</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Greeting */}
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Greeting</label>
                      <div className="flex items-center gap-1 mb-1">
                        {mergeTags.filter(t => ['first_name', 'name', 'email'].includes(t.key) || t.color === '#2563eb').slice(0, 5).map(t => (
                          <button key={t.key} type="button" onClick={() => updateStruct({ greeting: tmplStruct.greeting + '{{' + t.key + '}}' })}
                            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: t.color + '15', color: t.color, border: '1px solid ' + t.color + '25' }}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                      <input value={tmplStruct.greeting} onChange={e => updateStruct({ greeting: e.target.value })}
                        placeholder="Dear {{first_name}},"
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                    </div>

                    {/* Content blocks */}
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Content blocks</label>
                      {tmplStruct.blocks.map((block, i) => (
                        <div key={i} className="mb-2 bg-white border border-gray-200 rounded-lg p-2.5 relative group">
                          {/* Block header with type badge + controls */}
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: block.type === 'text' ? '#f3f4f6' : block.type === 'image' ? '#dbeafe' : block.type === 'numbered_step' ? '#fef3c7' : block.type === 'heading' ? '#f3e8ff' : block.type === 'divider' ? '#f3f4f6' : block.type === 'signature' ? '#ecfdf5' : block.type === 'button' ? '#fce7f3' : '#f3f4f6',
                                color: block.type === 'text' ? '#6b7280' : block.type === 'image' ? '#2563eb' : block.type === 'numbered_step' ? '#d97706' : block.type === 'heading' ? '#7c3aed' : block.type === 'divider' ? '#9ca3af' : block.type === 'signature' ? '#059669' : block.type === 'button' ? '#db2777' : '#6b7280' }}>
                              {block.type === 'numbered_step' ? 'Step' : block.type === 'text' ? 'Paragraph' : block.type.charAt(0).toUpperCase() + block.type.slice(1)}
                            </span>
                            <div className="flex items-center gap-0.5">
                              <button type="button" onClick={() => moveBlock(i, -1)} disabled={i === 0}
                                className="text-gray-300 hover:text-gray-600 text-xs px-1 disabled:opacity-30" title="Move up">&uarr;</button>
                              <button type="button" onClick={() => moveBlock(i, 1)} disabled={i === tmplStruct.blocks.length - 1}
                                className="text-gray-300 hover:text-gray-600 text-xs px-1 disabled:opacity-30" title="Move down">&darr;</button>
                              <button type="button" onClick={() => removeBlock(i)}
                                className="text-gray-300 hover:text-red-400 text-xs px-1 ml-1" title="Remove">&times;</button>
                            </div>
                          </div>

                          {/* Block-type-specific fields */}
                          {block.type === 'text' && (
                            <textarea value={block.content} onChange={e => updateBlock(i, e.target.value)}
                              placeholder="Write a paragraph..."
                              rows={2} className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400 resize-y" />
                          )}
                          {block.type === 'heading' && (
                            <input value={block.content} onChange={e => updateBlock(i, e.target.value)}
                              placeholder="Section heading..."
                              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400 font-semibold" />
                          )}
                          {block.type === 'image' && (
                            <div className="space-y-1.5">
                              <input value={block.imageUrl || ''} onChange={e => updateBlockField(i, { imageUrl: e.target.value })}
                                placeholder="Image URL (https://...)"
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                              <div className="flex gap-2">
                                <input value={block.imageAlt || ''} onChange={e => updateBlockField(i, { imageAlt: e.target.value })}
                                  placeholder="Alt text"
                                  className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                                <select value={block.imageWidth || '100%'} onChange={e => updateBlockField(i, { imageWidth: e.target.value })}
                                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400">
                                  <option value="100%">Full width</option>
                                  <option value="75%">75%</option>
                                  <option value="50%">50%</option>
                                  <option value="200px">Small (200px)</option>
                                  <option value="120px">Icon (120px)</option>
                                </select>
                                <select value={block.imageAlign || 'center'} onChange={e => updateBlockField(i, { imageAlign: e.target.value as EmailBlock['imageAlign'] })}
                                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400">
                                  <option value="left">Left</option>
                                  <option value="center">Center</option>
                                  <option value="right">Right</option>
                                </select>
                              </div>
                              <input value={block.imageLink || ''} onChange={e => updateBlockField(i, { imageLink: e.target.value })}
                                placeholder="Link URL (optional — makes image clickable)"
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                            </div>
                          )}
                          {block.type === 'numbered_step' && (
                            <div className="space-y-1.5">
                              <div className="flex gap-2">
                                <input type="number" min={1} value={block.stepNumber || 1} onChange={e => updateBlockField(i, { stepNumber: parseInt(e.target.value) || 1 })}
                                  className="w-14 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400 text-center font-bold" />
                                <input value={block.stepHeading || ''} onChange={e => updateBlockField(i, { stepHeading: e.target.value })}
                                  placeholder="Step heading (bold)"
                                  className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400 font-semibold" />
                              </div>
                              <textarea value={block.content} onChange={e => updateBlock(i, e.target.value)}
                                placeholder="Step description (optional)..."
                                rows={2} className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400 resize-y" />
                            </div>
                          )}
                          {block.type === 'signature' && (
                            <div className="space-y-1.5">
                              <input value={block.signatureName || ''} onChange={e => updateBlockField(i, { signatureName: e.target.value })}
                                placeholder="Name (e.g. John Smith)"
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400 font-semibold" />
                              <input value={block.signatureTitle || ''} onChange={e => updateBlockField(i, { signatureTitle: e.target.value })}
                                placeholder="Title (e.g. Director of Research)"
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                              <input value={block.signatureImageUrl || ''} onChange={e => updateBlockField(i, { signatureImageUrl: e.target.value })}
                                placeholder="Signature image URL (optional)"
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                            </div>
                          )}
                          {block.type === 'button' && (
                            <div className="space-y-1.5">
                              <div className="flex gap-2">
                                <input value={block.content} onChange={e => updateBlock(i, e.target.value)}
                                  placeholder="Button label"
                                  className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400 font-semibold" />
                                <input type="color" value={block.buttonColor || tmplStruct.ctaColor || tmplStruct.headerColor}
                                  onChange={e => updateBlockField(i, { buttonColor: e.target.value })}
                                  className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0" title="Button color" />
                              </div>
                              <input value={block.buttonUrl || ''} onChange={e => updateBlockField(i, { buttonUrl: e.target.value })}
                                placeholder="Button URL (default: {{survey_link}})"
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                            </div>
                          )}
                          {block.type === 'spacer' && (
                            <div className="flex items-center gap-2">
                              <input type="range" min={8} max={64} value={parseInt(block.content) || 24}
                                onChange={e => updateBlock(i, e.target.value)}
                                className="flex-1" />
                              <span className="text-[10px] text-gray-400 w-10">{block.content || 24}px</span>
                            </div>
                          )}
                          {block.type === 'divider' && (
                            <div className="text-[10px] text-gray-400">Horizontal line separator</div>
                          )}
                        </div>
                      ))}

                      {/* Add block dropdown */}
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {([
                          { type: 'text' as const, label: '+ Paragraph', color: '#6b7280' },
                          { type: 'heading' as const, label: '+ Heading', color: '#7c3aed' },
                          { type: 'image' as const, label: '+ Image', color: '#2563eb' },
                          { type: 'numbered_step' as const, label: '+ Step', color: '#d97706' },
                          { type: 'button' as const, label: '+ Button', color: '#db2777' },
                          { type: 'divider' as const, label: '+ Divider', color: '#9ca3af' },
                          { type: 'spacer' as const, label: '+ Spacer', color: '#9ca3af' },
                          { type: 'signature' as const, label: '+ Signature', color: '#059669' },
                        ]).map(item => (
                          <button key={item.type} type="button" onClick={() => addBlock(item.type)}
                            className="text-[10px] px-2 py-0.5 rounded-full font-semibold transition-all hover:opacity-80"
                            style={{ border: '1px dashed ' + item.color + '60', color: item.color }}>
                            {item.label}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2">
                        <MergeTagBar tags={mergeTags} onInsert={tag => {
                          if (tmplStruct.blocks.length > 0) {
                            const lastTextIdx = tmplStruct.blocks.map((b, i) => b.type === 'text' || b.type === 'numbered_step' ? i : -1).filter(i => i >= 0).pop()
                            if (lastTextIdx !== undefined && lastTextIdx >= 0) {
                              updateBlock(lastTextIdx, tmplStruct.blocks[lastTextIdx].content + tag)
                            }
                          } else {
                            updateStruct({ blocks: [{ type: 'text', content: tag }] })
                          }
                        }} target="body" />
                      </div>
                    </div>

                    {/* CTA button */}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                      <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Primary survey button</label>
                      <div className="flex gap-2">
                        <input type="color" value={tmplStruct.ctaColor || tmplStruct.headerColor}
                          onChange={e => updateStruct({ ctaColor: e.target.value })}
                          className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0" title="Button color" />
                        <input value={tmplStruct.ctaText} onChange={e => updateStruct({ ctaText: e.target.value })}
                          placeholder="Take the Survey"
                          className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">Always links to the survey URL. Add extra buttons via content blocks above.</p>
                    </div>

                    {/* Closing */}
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Closing text</label>
                      <input value={tmplStruct.closing} onChange={e => updateStruct({ closing: e.target.value })}
                        placeholder="Thank you for your time!"
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400" />
                    </div>
                  </div>

                  {/* Preview side */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden bg-white sticky top-0">
                    <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-400 uppercase">Live Preview</div>
                    <div className="p-3 text-sm overflow-y-auto" style={{ maxHeight: 600 }}
                      dangerouslySetInnerHTML={{ __html: previewHtml(buildHtmlFromStructure(tmplStruct)) }} />
                  </div>
                </div>
              ) : (
                /* HTML mode */
                <div>
                  <MergeTagBar tags={mergeTags} onInsert={insertIntoBody} target="body" />
                  <div className="grid grid-cols-2 gap-3">
                    <textarea ref={bodyRef} value={bodyHtml} onChange={e => setBodyHtml(e.target.value)}
                      rows={14} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400 font-mono resize-y" />
                    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                      <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-400 uppercase">Preview</div>
                      <div className="px-3 py-3 text-sm overflow-y-auto" style={{ maxHeight: 340 }}
                        dangerouslySetInnerHTML={{ __html: previewHtml(bodyHtml) }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Settings row */}
              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-[140px]">
                  <label className="text-xs font-medium text-gray-600 block mb-1">Send to</label>
                  <select value={sendTo} onChange={e => setSendTo(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400">
                    <option value="all">All recipients</option>
                    <option value="non_responders">Non-responders only</option>
                    <option value="incompletes">Incompletes only</option>
                  </select>
                </div>
                <div className="w-28">
                  <label className="text-xs font-medium text-gray-600 block mb-1">Delay (hours)</label>
                  <input type="number" min={0} value={delayHours} onChange={e => setDelayHours(parseInt(e.target.value) || 0)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400" />
                </div>
                <div className="w-28">
                  <label className="text-xs font-medium text-gray-600 block mb-1">Send time</label>
                  <input type="time" value={sendTime} onChange={e => setSendTime(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400" />
                  <p className="text-[9px] text-gray-400 mt-0.5">{sendTime ? 'ET' : 'Any time'}</p>
                </div>
              </div>
              <button onClick={() => saveEmail(email.id)} disabled={saving}
                className="text-xs px-4 py-1.5 rounded-lg text-white font-medium disabled:opacity-50"
                style={{ background: HERMES }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium text-gray-700">{email.subject}</p>
              <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3 max-h-32 overflow-y-auto font-mono whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: email.body_html.slice(0, 500) + (email.body_html.length > 500 ? '...' : '') }} />
            </div>
          )}
        </div>
      ))}

      <button onClick={addEmail}
        className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-orange-300 hover:text-orange-600 transition-all">
        + Add {emails.length === 0 ? 'initial email' : 'reminder'}
      </button>
    </div>
  )
}

// -- Default email templates ----------------------------------
// -- Reminder modal component ----------------------------------
function ReminderModal({ campaignId, emails, statusCounts, onSendResult, onClose }: {
  campaignId: string; emails: CampaignEmail[]
  statusCounts: { pending: number; sent: number; opened: number; clicked: number; completed: number }
  onSendResult: (r: { sent: number; failed: number }) => void; onClose: () => void
}) {
  const [seq, setSeq] = useState(emails.length > 1 ? 1 : 0)
  const [audience, setAudience] = useState<'non_responders' | 'pending'>('non_responders')
  const [reminderSending, setReminderSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)

  const nonResponders = statusCounts.sent + statusCounts.opened + statusCounts.clicked
  const counts = { non_responders: nonResponders, pending: statusCounts.pending }

  const doSend = async () => {
    setReminderSending(true)
    try {
      const res = await fetch('/api/campaigns/' + campaignId + '/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence: seq }),
      })
      const data = await res.json()
      const r = { sent: data.sent || 0, failed: data.failed || 0 }
      setResult(r)
      onSendResult(r)
    } finally { setReminderSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-800 text-base">Send Reminder</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-4">
          {/* Template selection */}
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Email template</label>
            <div className="space-y-1.5">
              {emails.map((email, i) => (
                <button key={email.id} type="button" onClick={() => setSeq(email.sequence)}
                  className={'w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all ' +
                    (seq === email.sequence ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-gray-300')}>
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: seq === email.sequence ? HERMES : '#e5e7eb', color: seq === email.sequence ? '#fff' : '#6b7280' }}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-700 truncate">{email.subject}</div>
                      <div className="text-[10px] text-gray-400">
                        {email.sequence === 0 ? 'Initial' : 'Reminder ' + email.sequence}
                        {' · '}{email.send_to.replace('_', ' ')}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Audience */}
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Audience</label>
            <div className="space-y-1.5">
              <button type="button" onClick={() => setAudience('non_responders')}
                className={'w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all ' +
                  (audience === 'non_responders' ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-gray-300')}>
                <div className="text-xs font-medium text-gray-700">Non-responders ({nonResponders})</div>
                <div className="text-[10px] text-gray-400">Received email but haven&apos;t completed the survey</div>
              </button>
              <button type="button" onClick={() => setAudience('pending')}
                className={'w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all ' +
                  (audience === 'pending' ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-gray-300')}>
                <div className="text-xs font-medium text-gray-700">Not yet emailed ({statusCounts.pending})</div>
                <div className="text-[10px] text-gray-400">Recipients who haven&apos;t received any email</div>
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
            <div className="text-xs text-gray-500">
              <strong className="text-gray-700">Summary:</strong> Send &quot;{emails.find(e => e.sequence === seq)?.subject?.slice(0, 40)}...&quot;
              to <strong className="text-gray-700">{counts[audience]}</strong> recipients
            </div>
          </div>

          {result && (
            <div className={'rounded-xl p-3 text-sm font-medium ' + (result.failed > 0 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-green-50 text-green-700 border border-green-200')}>
              {result.failed > 0 ? '\u26A0\uFE0F' : '\u2705'} {result.sent} sent{result.failed > 0 ? ', ' + result.failed + ' failed' : ''}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium">Cancel</button>
            <button onClick={doSend} disabled={reminderSending || counts[audience] === 0}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              style={{ background: HERMES }}>
              {reminderSending ? 'Sending...' : 'Send Now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function getDefaultTemplate(sequence: number): { subject: string; body_html: string } {
  const struct0: TemplateStructure = {
    headerColor: '#E8632A', headerText: '{{campaign_name}}', headerLogoUrl: '', headerLogoWidth: '150px',
    headerLayout: 'text', headerLogoUrl2: '', greeting: 'Dear {{first_name}},',
    ctaText: 'Take the Survey', ctaColor: '#E8632A', closing: 'Thank you for your time!',
    blocks: [
      { type: 'text', content: 'We need your advice. Please give 1 to 2 minutes and answer a few questions.' },
      { type: 'numbered_step', content: 'Click the button below to answer this survey. Share YOUR OPINIONS to help us better understand your experience.', stepNumber: 1, stepHeading: 'Click the survey link below' },
      { type: 'numbered_step', content: 'Click SUBMIT to send your replies. We will not know who responded; only what advice and opinions were shared.', stepNumber: 2, stepHeading: 'Submit your responses' },
      { type: 'numbered_step', content: "That's it. All we are asking for today is your time — and your advice.", stepNumber: 3, stepHeading: "You're done!" },
    ],
  }
  const struct1: TemplateStructure = {
    headerColor: '#E8632A', headerText: 'Reminder: {{campaign_name}}', headerLogoUrl: '', headerLogoWidth: '150px',
    headerLayout: 'text', headerLogoUrl2: '', greeting: 'Hi {{first_name}},',
    ctaText: 'Take the Survey', ctaColor: '#E8632A', closing: 'This should only take a few minutes. Thank you!',
    blocks: [
      { type: 'text', content: "We noticed you haven't had a chance to complete our survey yet. Your feedback is important to us and helps shape our future direction." },
    ],
  }
  const struct2: TemplateStructure = {
    headerColor: '#E8632A', headerText: 'Final Reminder: {{campaign_name}}', headerLogoUrl: '', headerLogoWidth: '150px',
    headerLayout: 'text', headerLogoUrl2: '', greeting: 'Hi {{first_name}},',
    ctaText: 'Take the Survey Now', ctaColor: '#E8632A', closing: 'Thank you for considering!',
    blocks: [
      { type: 'text', content: "This is a final reminder about our survey. We're closing it soon and would really appreciate hearing from you before then." },
    ],
  }
  const structs = [struct0, struct1, struct2]
  const s = structs[Math.min(sequence, structs.length - 1)]
  return {
    subject: sequence === 0 ? "We'd love your feedback, {{first_name}}" : sequence === 1 ? 'Quick reminder: your feedback matters, {{first_name}}' : 'Last chance to share your thoughts, {{first_name}}',
    body_html: buildHtmlFromStructure(s),
  }
}

// -- Main component -------------------------------------------

// -- Campaign schedule card -----------------------------
function CampaignScheduleCard({ campaignId, campaignStatus }: { campaignId: string; campaignStatus: string }) {
  const [launchDate, setLaunchDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSchedule = async () => {
    if (!launchDate) return
    setSaving(true)
    try {
      const res = await fetch('/api/campaigns/' + campaignId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'scheduled', scheduled_at: new Date(launchDate).toISOString() }),
      })
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
    } finally { setSaving(false) }
  }

  const alreadySent = campaignStatus === 'active' || campaignStatus === 'completed'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h3 className="font-semibold text-sm text-gray-800 mb-1">Campaign Schedule</h3>
      <p className="text-xs text-gray-500 mb-3">
        {alreadySent
          ? 'This campaign has already been sent.'
          : 'Set a launch date and time. Email delays are offset from this time.'}
      </p>
      {!alreadySent && (
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-600 block mb-1">Launch date & time</label>
            <input type="datetime-local" value={launchDate} onChange={e => setLaunchDate(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400" />
            <p className="text-[9px] text-gray-400 mt-0.5">Eastern Time</p>
          </div>
          <button onClick={handleSchedule} disabled={saving || !launchDate}
            className="text-xs px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50 hover:opacity-90"
            style={{ background: HERMES }}>
            {saved ? 'Scheduled!' : saving ? 'Saving...' : 'Schedule'}
          </button>
        </div>
      )}
      {alreadySent && (
        <div className="text-xs text-green-600 font-medium">Campaign is {campaignStatus}.</div>
      )}
    </div>
  )
}

export default function CampaignDetailClient({ user, campaign: initialCampaign, emails, respondents: initialRespondents, totalRespondents, logoUrl = '', analyzeEnabled, campaignsEnabled, features }: Props) {
  const [campaign, setCampaign] = useState(initialCampaign)
  const [tab, setTab] = useState<Tab>('setup')
  const [respondents, setRespondents] = useState(initialRespondents)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null)
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showAddSingle, setShowAddSingle] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [recipientSearch, setRecipientSearch] = useState('')
  const [recipientStatusFilter, setRecipientStatusFilter] = useState('')
  const [recipientPage, setRecipientPage] = useState(0)
  const [showReminderModal, setShowReminderModal] = useState(false)
  const [showShare, setShowShare] = useState(false)

  const statusCounts = { total: 0, pending: 0, sent: 0, opened: 0, clicked: 0, completed: 0, bounced: 0, unsubscribed: 0 }
  for (const r of respondents) {
    statusCounts.total++
    const s = r.status as keyof typeof statusCounts
    if (s in statusCounts) statusCounts[s]++
  }

  const handleSend = async (sequence: number) => {
    setSending(true)
    setSendResult(null)
    try {
      const res = await fetch('/api/campaigns/' + campaign.id + '/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence }),
      })
      const data = await res.json()
      setSendResult({ sent: data.sent || 0, failed: data.failed || 0 })
    } finally { setSending(false) }
  }

  const handleTestSend = async (sequence: number) => {
    setTestSending(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/campaigns/' + campaign.id + '/test-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence }),
      })
      const data = await res.json()
      setTestResult(data.ok ? 'Test sent to ' + data.sent_to : 'Error: ' + data.error)
    } finally { setTestSending(false) }
  }

  const refreshRespondents = async () => {
    const res = await fetch('/api/campaigns/' + campaign.id + '/respondents')
    if (res.ok) {
      const data = await res.json()
      setRespondents(data.respondents || [])
    }
    setShowUpload(false)
  }

  const STEP_ICONS = ['⚙️', '👥', '✉️', '🚀']
  const tabs: { key: Tab; label: string; icon: string; done: boolean }[] = [
    { key: 'setup', label: 'Setup', icon: STEP_ICONS[0], done: !!campaign.name },
    { key: 'respondents', label: 'Recipients', icon: STEP_ICONS[1], done: respondents.length > 0 },
    { key: 'emails', label: 'Emails', icon: STEP_ICONS[2], done: emails.length > 0 },
    { key: 'send', label: 'Send', icon: STEP_ICONS[3], done: campaign.status === 'active' || campaign.status === 'completed' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="fixed top-0 left-0 right-0 z-50">
        <TopNav logoUrl={logoUrl} orgName={user.clientName} isAdmin={user.isAdmin}
          userEmail={user.email} fullName={user.fullName} currentPage="campaigns"
          analyzeEnabled={analyzeEnabled} campaignsEnabled={campaignsEnabled} features={features} />
      </div>
      <SubHeader crumbs={[
        { label: 'Campaigns', href: '/campaigns' },
        { label: campaign.name },
      ]} isAdmin={user.isAdmin} showFilters={false} />

      <main className="max-w-5xl mx-auto px-6 py-8 pt-28 w-full">
        {/* Edit modal */}
        {showEditModal && (
          <EditCampaignModal
            campaign={campaign}
            onSave={(updates) => setCampaign(prev => ({ ...prev, ...updates } as CampaignData))}
            onClose={() => setShowEditModal(false)}
          />
        )}

        {/* Reminder modal */}
        {showReminderModal && (
          <ReminderModal
            campaignId={campaign.id}
            emails={emails}
            statusCounts={statusCounts}
            onSendResult={r => setSendResult(r)}
            onClose={() => setShowReminderModal(false)}
          />
        )}

        {/* Share modal */}
        {showShare && <ShareModal type="campaign" targetId={campaign.id} title={campaign.name} onClose={() => setShowShare(false)} />}

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-800">{campaign.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={'text-[10px] px-2 py-0.5 rounded-full border font-medium ' +
                (campaign.status === 'active' ? 'bg-green-100 text-green-700 border-green-200' :
                 campaign.status === 'paused' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                 'bg-gray-100 text-gray-500 border-gray-200')}>
                {campaign.status}
              </span>
              {campaign.study_name && (
                <Link href={'/studies/' + campaign.study_id + '/edit'} className="text-[10px] text-gray-400 hover:text-gray-600">
                  {campaign.study_name}
                </Link>
              )}
              <span className="text-[10px] text-gray-300">{respondents.length} recipients · {emails.length} emails</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setShowShare(true)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors">
              Share
            </button>
            <button
              onClick={async () => {
                if (!confirm('Delete "' + campaign.name + '"? This cannot be undone.')) return
                const res = await fetch('/api/campaigns/' + campaign.id, { method: 'DELETE' })
                if (res.ok) window.location.href = '/campaigns'
              }}
              className="text-xs px-3 py-1.5 rounded-lg font-medium border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Step pills — campaign flow */}
        <div className="flex items-center gap-1.5 mb-6">
          {tabs.map(({ key, label, icon, done }, i) => {
            const isActive = tab === key
            return (
              <div key={key} className="flex items-center gap-1.5">
                {i > 0 && <div className="w-6 h-px" style={{ background: done ? HERMES + '40' : '#e5e7eb' }} />}
                <button onClick={() => setTab(key)}
                  className={'flex items-center gap-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ' +
                    (isActive ? 'px-3.5 py-1.5 text-white shadow-sm' :
                     done ? 'px-2 py-1.5 bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100' :
                     'px-2 py-1.5 bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100 hover:text-gray-600')}
                  style={isActive ? { background: HERMES } : {}}>
                  <span className="text-sm">{icon}</span>
                  {isActive && <span>{label}</span>}
                  {!isActive && done && <span className="w-3 h-3 rounded-full bg-green-500 text-white flex items-center justify-center text-[7px] font-bold">✓</span>}
                </button>
              </div>
            )
          })}
        </div>

        {/* Setup tab */}
        {tab === 'setup' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-semibold text-sm text-gray-800 mb-3">Campaign Settings</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Campaign Name</label>
                  <div className="text-sm text-gray-800 font-medium">{campaign.name}</div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Linked Study</label>
                  <div className="text-sm text-gray-800">{campaign.study_name || '—'}</div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Target Responses</label>
                  <div className="text-sm text-gray-800">{campaign.target_responses || 'Not set'}</div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Email Provider</label>
                  <div className="text-sm text-gray-800 capitalize">{campaign.email_provider}</div>
                </div>
              </div>
              <button onClick={() => setShowEditModal(true)} className="mt-4 text-xs px-4 py-2 rounded-lg font-medium transition-all"
                style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
                Edit Settings
              </button>
            </div>
            {/* Campaign schedule */}
            <CampaignScheduleCard campaignId={campaign.id} campaignStatus={campaign.status} />

            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-semibold text-sm text-gray-800 mb-3">Quick Status</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-2xl font-bold" style={{ color: HERMES }}>{statusCounts.total}</div>
                  <div className="text-xs text-gray-500">Recipients</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-green-600">{statusCounts.completed}</div>
                  <div className="text-xs text-gray-500">Completed</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-blue-600">{statusCounts.sent + statusCounts.opened + statusCounts.clicked}</div>
                  <div className="text-xs text-gray-500">Sent</div>
                </div>
                <div className="bg-yellow-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-yellow-600">{statusCounts.pending}</div>
                  <div className="text-xs text-gray-500">Pending</div>
                </div>
              </div>
              {statusCounts.bounced > 0 && (
                <div className="mt-2 text-xs text-red-500">{statusCounts.bounced} bounced</div>
              )}
              {campaign.target_responses && (
                <div className="mt-3">
                  <div className="text-xs text-gray-500 mb-1">Target: {statusCounts.completed}/{campaign.target_responses}</div>
                  <div style={{ height: 6, borderRadius: 3, background: '#f3f4f6', overflow: 'hidden' }}>
                    <div style={{
                      width: Math.min(Math.round(statusCounts.completed / campaign.target_responses * 100), 100) + '%',
                      height: '100%', borderRadius: 3, background: statusCounts.completed >= campaign.target_responses ? '#22c55e' : HERMES,
                    }} />
                  </div>
                </div>
              )}
            </div>

            {/* Next step prompt */}
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: HERMES }}>
                  {respondents.length === 0 ? 'Next: Add recipients' : emails.length === 0 ? 'Next: Create email templates' : 'Ready to send!'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {respondents.length === 0 ? 'Upload a CSV, TSV, JSON, or Excel file with your recipient list.' : emails.length === 0 ? 'Set up your email templates with merge tags from your recipient data.' : 'Review your campaign and send when ready.'}
                </p>
              </div>
              <button onClick={() => setTab(respondents.length === 0 ? 'respondents' : emails.length === 0 ? 'emails' : 'send')}
                className="text-xs px-4 py-2 rounded-lg text-white font-medium flex-shrink-0"
                style={{ background: HERMES }}>
                {respondents.length === 0 ? 'Add Recipients →' : emails.length === 0 ? 'Create Emails →' : 'Go to Send →'}
              </button>
            </div>
          </div>
        )}

        {/* Send tab — campaign monitoring dashboard */}
        {tab === 'send' && (() => {
          const delivered = statusCounts.sent + statusCounts.opened + statusCounts.clicked + statusCounts.completed + statusCounts.unsubscribed
          const deliveryRate = statusCounts.total > 0 ? Math.round(delivered / statusCounts.total * 100) : 0
          const completionRate = delivered > 0 ? Math.round(statusCounts.completed / delivered * 100) : 0
          const bounceRate = statusCounts.total > 0 ? Math.round(statusCounts.bounced / statusCounts.total * 100) : 0

          const MetricBar = ({ label, value, total, color }: { label: string; value: number; total: number; color: string }) => {
            const pct = total > 0 ? Math.round(value / total * 100) : 0
            return (
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20 flex-shrink-0">{label}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: pct + '%', background: color }} />
                </div>
                <span className="text-xs font-semibold text-gray-700 w-16 text-right">{value} ({pct}%)</span>
              </div>
            )
          }

          return (
            <div className="space-y-4">
              {/* Top metrics row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <div className="text-3xl font-bold" style={{ color: HERMES }}>{statusCounts.total}</div>
                  <div className="text-xs text-gray-500 mt-1">Total Recipients</div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <div className="text-3xl font-bold text-blue-600">{deliveryRate}%</div>
                  <div className="text-xs text-gray-500 mt-1">Delivery Rate</div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <div className="text-3xl font-bold text-green-600">{completionRate}%</div>
                  <div className="text-xs text-gray-500 mt-1">Completion Rate</div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <div className={'text-3xl font-bold ' + (bounceRate > 5 ? 'text-red-600' : bounceRate > 0 ? 'text-amber-600' : 'text-green-600')}>{bounceRate}%</div>
                  <div className="text-xs text-gray-500 mt-1">Bounce Rate</div>
                </div>
              </div>

              {/* Target progress */}
              {campaign.target_responses && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-700">Target Progress</span>
                    <span className="text-sm font-bold" style={{ color: statusCounts.completed >= campaign.target_responses ? '#16a34a' : HERMES }}>
                      {statusCounts.completed} / {campaign.target_responses} ({Math.min(Math.round(statusCounts.completed / campaign.target_responses * 100), 100)}%)
                    </span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: Math.min(Math.round(statusCounts.completed / campaign.target_responses * 100), 100) + '%',
                      background: statusCounts.completed >= campaign.target_responses ? '#16a34a' : HERMES,
                    }} />
                  </div>
                </div>
              )}

              {/* Export */}
              {respondents.length > 0 && (
                <div className="flex justify-end">
                  <DownloadButton
                    label="↓ Export"
                    hrefFor={fmt => '/api/campaigns/' + campaign.id + '/export?format=' + fmt}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                  />
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                {/* Delivery funnel */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="font-semibold text-sm text-gray-800 mb-4">Delivery Funnel</h3>
                  <div className="space-y-3">
                    <MetricBar label="Ready" value={statusCounts.pending} total={statusCounts.total} color="#f59e0b" />
                    <MetricBar label="Delivered" value={delivered} total={statusCounts.total} color="#3b82f6" />
                    <MetricBar label="Completed" value={statusCounts.completed} total={statusCounts.total} color="#16a34a" />
                    {statusCounts.bounced > 0 && <MetricBar label="Bounced" value={statusCounts.bounced} total={statusCounts.total} color="#ef4444" />}
                    {statusCounts.unsubscribed > 0 && <MetricBar label="Unsub" value={statusCounts.unsubscribed} total={statusCounts.total} color="#9ca3af" />}
                  </div>

                  {/* Health indicator */}
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    {bounceRate > 5 ? (
                      <div className="flex items-center gap-2 text-xs text-red-600">
                        <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                        High bounce rate — check recipient email quality
                      </div>
                    ) : bounceRate > 0 ? (
                      <div className="flex items-center gap-2 text-xs text-amber-600">
                        <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                        Some bounces detected — monitor deliverability
                      </div>
                    ) : delivered > 0 ? (
                      <div className="flex items-center gap-2 text-xs text-green-600">
                        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                        Healthy — no delivery issues detected
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                        No emails sent yet
                      </div>
                    )}
                  </div>
                </div>

                {/* Send actions */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="font-semibold text-sm text-gray-800 mb-4">Actions</h3>
                  {respondents.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 rounded-xl">
                      <div className="text-2xl mb-2">👥</div>
                      <p className="text-sm text-gray-500 mb-3">Add recipients first</p>
                      <button onClick={() => setTab('respondents')} className="text-xs px-4 py-2 rounded-lg text-white font-medium" style={{ background: HERMES }}>Add Recipients</button>
                    </div>
                  ) : emails.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 rounded-xl">
                      <div className="text-2xl mb-2">✉️</div>
                      <p className="text-sm text-gray-500 mb-3">Create email templates first</p>
                      <button onClick={() => setTab('emails')} className="text-xs px-4 py-2 rounded-lg text-white font-medium" style={{ background: HERMES }}>Create Emails</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button onClick={() => handleTestSend(0)} disabled={testSending}
                        className="w-full flex items-center gap-3 text-sm px-4 py-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-all disabled:opacity-50">
                        <span className="text-lg">📨</span>
                        <div className="text-left flex-1">
                          <div className="font-medium text-gray-700">{testSending ? 'Sending test...' : 'Send test email'}</div>
                          <div className="text-[10px] text-gray-400">Preview in your inbox first</div>
                        </div>
                      </button>
                      <button onClick={() => handleSend(0)} disabled={sending || statusCounts.pending === 0}
                        className="w-full flex items-center gap-3 text-sm px-4 py-3 rounded-xl text-white font-medium disabled:opacity-50 transition-all"
                        style={{ background: statusCounts.pending > 0 ? HERMES : '#9ca3af' }}>
                        <span className="text-lg">🚀</span>
                        <div className="text-left flex-1">
                          <div>{sending ? 'Sending...' : 'Send to ' + statusCounts.pending + ' recipients'}</div>
                          <div className="text-[10px] opacity-75">Initial campaign email</div>
                        </div>
                      </button>
                      {emails.length > 1 && statusCounts.sent + statusCounts.opened + statusCounts.clicked > 0 && (
                        <button onClick={() => setShowReminderModal(true)}
                          className="w-full flex items-center gap-3 text-sm px-4 py-3 rounded-xl border-2 transition-all"
                          style={{ borderColor: HERMES + '40', color: HERMES }}>
                          <span className="text-lg">🔔</span>
                          <div className="text-left flex-1">
                            <div className="font-medium">Send reminder</div>
                            <div className="text-[10px] text-gray-400">Choose template, audience & timing</div>
                          </div>
                        </button>
                      )}
                    </div>
                  )}

                  {sendResult && (
                    <div className={'mt-3 rounded-xl p-3 text-sm font-medium ' + (sendResult.failed > 0 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-green-50 text-green-700 border border-green-200')}>
                      {sendResult.failed > 0 ? '⚠️' : '✅'} {sendResult.sent} sent{sendResult.failed > 0 ? ', ' + sendResult.failed + ' failed' : ''}
                    </div>
                  )}
                  {testResult && (
                    <div className="mt-3 rounded-xl p-3 text-xs bg-blue-50 text-blue-700 border border-blue-200">{testResult}</div>
                  )}
                </div>
              </div>

              {/* Per-email template stats */}
              {emails.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="font-semibold text-sm text-gray-800 mb-3">Email Templates</h3>
                  <div className="space-y-2">
                    {emails.map((email, i) => (
                      <div key={email.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ background: HERMES + '15', color: HERMES }}>
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-700 truncate">{email.subject}</div>
                          <div className="text-[10px] text-gray-400">
                            {email.sequence === 0 ? 'Initial' : email.is_thank_you ? 'Thank you' : 'Reminder ' + email.sequence}
                            {' · '}to {email.send_to.replace('_', ' ')}
                            {email.send_delay_hours > 0 && (' · ' + (email.send_delay_hours < 24 ? email.send_delay_hours + 'h' : Math.round(email.send_delay_hours / 24) + 'd') + ' delay')}
                          </div>
                        </div>
                        <button onClick={() => { setTab('emails'); setTimeout(() => { const el = document.getElementById('email-' + email.id); el?.scrollIntoView({ behavior: 'smooth' }) }, 100) }}
                          className="text-[10px] px-2 py-1 rounded-lg font-medium"
                          style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
                          Edit
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent activity */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-sm text-gray-800 mb-3">Recent Activity</h3>
                {respondents.filter(r => r.sent_at || r.completed_at).length === 0 ? (
                  <div className="text-center py-6 text-gray-400 text-sm">No activity yet — send your first email to get started.</div>
                ) : (
                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                    {respondents
                      .filter(r => r.sent_at || r.completed_at)
                      .sort((a, b) => {
                        const da = a.completed_at || a.sent_at || ''
                        const db = b.completed_at || b.sent_at || ''
                        return db.localeCompare(da)
                      })
                      .slice(0, 30)
                      .map(r => (
                        <div key={r.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50">
                          <span className={'w-2 h-2 rounded-full flex-shrink-0 ' +
                            (r.status === 'completed' ? 'bg-green-500' :
                             r.status === 'bounced' ? 'bg-red-500' :
                             r.status === 'unsubscribed' ? 'bg-gray-400' :
                             'bg-blue-500')} />
                          <span className="text-xs text-gray-600 flex-1 truncate">{r.email}</span>
                          <span className={'text-[10px] px-2 py-0.5 rounded-full font-medium ' +
                            (r.status === 'completed' ? 'bg-green-100 text-green-700' :
                             r.status === 'bounced' ? 'bg-red-100 text-red-600' :
                             r.status === 'unsubscribed' ? 'bg-gray-100 text-gray-500' :
                             'bg-blue-100 text-blue-700')}>
                            {r.status}
                          </span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">
                            {r.completed_at ? new Date(r.completed_at).toLocaleDateString() : r.sent_at ? new Date(r.sent_at).toLocaleDateString() : ''}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Respondents tab */}
        {tab === 'respondents' && (
          <div>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-semibold text-sm text-gray-800">{totalRespondents} respondents</h3>
              <div className="flex items-center gap-2">
                <input type="text" value={recipientSearch} onChange={e => setRecipientSearch(e.target.value)}
                  placeholder="Search email..."
                  className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-orange-400 w-48" />
                <select value={recipientStatusFilter} onChange={e => setRecipientStatusFilter(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-orange-400">
                  <option value="">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="sent">Sent</option>
                  <option value="opened">Opened</option>
                  <option value="clicked">Clicked</option>
                  <option value="completed">Completed</option>
                  <option value="bounced">Bounced</option>
                  <option value="unsubscribed">Unsubscribed</option>
                </select>
                <button onClick={() => setShowAddSingle(!showAddSingle)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
                  {showAddSingle ? 'Cancel' : '+ Add'}
                </button>
                <button onClick={() => setShowUpload(!showUpload)}
                  className="text-xs px-3 py-1.5 rounded-lg text-white font-medium" style={{ background: HERMES }}>
                  {showUpload ? 'Cancel' : '+ Upload'}
                </button>
              </div>
            </div>

            {showAddSingle && (
              <AddSingleRecipient campaignId={campaign.id} onDone={() => { setShowAddSingle(false); refreshRespondents() }} />
            )}

            {showUpload && (
              <div className="mb-4">
                <RespondentUpload campaignId={campaign.id} hiddenFields={campaign.hidden_fields} onDone={refreshRespondents} />
              </div>
            )}

            {(() => {
              // Get all unique field keys from respondents
              const allFieldKeys = Array.from(new Set(respondents.flatMap(r => Object.keys(r.fields || {}))))

              // Filter respondents
              const filtered = respondents.filter(r => {
                if (recipientSearch && !r.email.toLowerCase().includes(recipientSearch.toLowerCase())) return false
                if (recipientStatusFilter && r.status !== recipientStatusFilter) return false
                return true
              })

              // Pagination
              const pageSize = 50
              const totalPages = Math.ceil(filtered.length / pageSize)
              const paged = filtered.slice(recipientPage * pageSize, (recipientPage + 1) * pageSize)

              if (respondents.length === 0) return (
                <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
                  <div className="text-3xl mb-2">👤</div>
                  <p className="text-sm text-gray-500">No respondents yet. Upload a file to get started.</p>
                </div>
              )

              return (
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600 sticky left-0 bg-gray-50">Email</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600">Status</th>
                          {allFieldKeys.map(f => (
                            <th key={f} className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600 whitespace-nowrap">{f.replace(/_/g, ' ')}</th>
                          ))}
                          <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600">GUID</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600">Sent</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600">Completed</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-gray-600 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {paged.map(r => (
                          <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-700 text-xs sticky left-0 bg-white">{r.email}</td>
                            <td className="px-3 py-2">
                              <span className={'text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ' +
                                (r.status === 'completed' ? 'bg-green-100 text-green-700' :
                                 r.status === 'sent' || r.status === 'opened' || r.status === 'clicked' ? 'bg-blue-100 text-blue-700' :
                                 r.status === 'bounced' ? 'bg-red-100 text-red-600' :
                                 r.status === 'unsubscribed' ? 'bg-gray-100 text-gray-500' :
                                 'bg-yellow-100 text-yellow-700')}>
                                {r.status}
                              </span>
                            </td>
                            {allFieldKeys.map(f => (
                              <td key={f} className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{(r.fields || {})[f] || '-'}</td>
                            ))}
                            <td className="px-3 py-2 text-gray-300 text-[10px] font-mono">{r.recipient_guid || '-'}</td>
                            <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                              {r.sent_at ? new Date(r.sent_at).toLocaleDateString() : '-'}
                            </td>
                            <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                              {r.completed_at ? new Date(r.completed_at).toLocaleDateString() : '-'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {r.status === 'pending' && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    if (!confirm('Remove ' + r.email + '?')) return
                                    const res = await fetch('/api/campaigns/' + campaign.id + '/respondents', {
                                      method: 'DELETE',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ respondent_ids: [r.id] }),
                                    })
                                    if (res.ok) setRespondents(prev => prev.filter(x => x.id !== r.id))
                                  }}
                                  title="Remove recipient"
                                  className="text-gray-300 hover:text-red-500 transition-colors text-xs"
                                >✕</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        {recipientPage * pageSize + 1}–{Math.min((recipientPage + 1) * pageSize, filtered.length)} of {filtered.length}
                        {filtered.length !== respondents.length && ` (filtered from ${respondents.length})`}
                      </span>
                      <div className="flex gap-1">
                        <button onClick={() => setRecipientPage(p => Math.max(0, p - 1))} disabled={recipientPage === 0}
                          className="text-xs px-2 py-1 rounded bg-white border border-gray-200 disabled:opacity-30">Prev</button>
                        <button onClick={() => setRecipientPage(p => Math.min(totalPages - 1, p + 1))} disabled={recipientPage >= totalPages - 1}
                          className="text-xs px-2 py-1 rounded bg-white border border-gray-200 disabled:opacity-30">Next</button>
                      </div>
                    </div>
                  )}
                  {totalPages <= 1 && filtered.length > 0 && (
                    <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
                      {filtered.length} recipient{filtered.length !== 1 ? 's' : ''}
                      {filtered.length !== respondents.length && ` (filtered from ${respondents.length})`}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* Emails tab */}
        {tab === 'emails' && (
          <EmailTemplateEditor campaignId={campaign.id} emails={emails} hiddenFields={campaign.hidden_fields}
            respondentFieldKeys={Array.from(new Set(respondents.flatMap(r => Object.keys(r.fields || {}))))} />
        )}
      </main>
    </div>
  )
}
