'use client'

// CSV import for a community comment log → an external-question batch. Parses the
// file client-side with SheetJS (handles quoted/multiline comment cells), lets the
// user map columns (auto-guessed from headers), and POSTs the rows to
// POST /api/bots/[id]/batches, which AI-extracts the answerable question per
// comment and keeps the full text as commentary. Contact columns ride along so a
// reply can be sent back.

import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'

type FieldKey = 'comment' | 'name' | 'email' | 'phone' | 'address' | 'agency' | 'wouldLike'
const FIELDS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: 'comment', label: 'Comment / question', required: true },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
  { key: 'agency', label: 'Agency / org' },
  { key: 'wouldLike', label: '“Would like to” / intent' },
]

const GUESS: Record<FieldKey, RegExp> = {
  comment: /comment|question|feedback|message/i,
  name: /^name|full.?name/i,
  email: /e-?mail/i,
  phone: /phone|tel|mobile/i,
  address: /address|street/i,
  agency: /agency|organization|organisation|\borg\b|company|hoa/i,
  wouldLike: /would like|interest|request|i.?am/i,
}

export default function CommentImportModal({ botId, onClose, onImported }: {
  botId: string
  onClose: () => void
  onImported: (n: number) => void
}) {
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [map, setMap] = useState<Record<FieldKey, string>>({ comment: '', name: '', email: '', phone: '', address: '', agency: '', wouldLike: '' })
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function onFile(file: File) {
    setErr(null)
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false })
        if (json.length === 0) { setErr('No rows found in that file.'); return }
        const hdrs = Object.keys(json[0]).filter(h => h && !/^__empty/i.test(h))
        setHeaders(hdrs)
        setRows(json)
        // Auto-guess the mapping from header names.
        const guessed: Record<FieldKey, string> = { comment: '', name: '', email: '', phone: '', address: '', agency: '', wouldLike: '' }
        for (const f of FIELDS) { const hit = hdrs.find(h => GUESS[f.key].test(h)); if (hit) guessed[f.key] = hit }
        setMap(guessed)
        if (!label) setLabel(file.name.replace(/\.[^.]+$/, ''))
      } catch { setErr('Could not read that file — is it a .csv or .xlsx?') }
    }
    reader.readAsBinaryString(file)
  }

  const withComment = useMemo(
    () => (map.comment ? rows.filter(r => String(r[map.comment] || '').trim().length >= 3).length : 0),
    [rows, map.comment],
  )

  async function submit() {
    if (!map.comment) { setErr('Pick the column that holds the comment.'); return }
    const payload = rows.map(r => {
      const get = (k: FieldKey) => (map[k] ? String(r[map[k]] || '').trim() : '')
      return { comment: get('comment'), name: get('name'), email: get('email'), phone: get('phone'), address: get('address'), agency: get('agency'), wouldLike: get('wouldLike') }
    }).filter(r => r.comment.length >= 3)
    if (payload.length === 0) { setErr('No rows have comment text in the selected column.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/bots/' + botId + '/batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined, sourceKind: 'csv', rows: payload }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d?.error || 'Import failed'); return }
      onImported(d.imported || payload.length)
    } catch (e: any) { setErr(e?.message || 'Network error') }
    finally { setBusy(false) }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto' onClick={() => !busy && onClose()}>
      <div className='bg-white rounded-xl shadow-xl w-full max-w-2xl mt-10 p-6' onClick={e => e.stopPropagation()}>
        <h2 className='text-lg font-semibold text-gray-900 mb-1'>Import a comment log (CSV / Excel)</h2>
        <p className='text-sm text-gray-600 mb-4'>
          Upload a community comment log. Each comment is AI-read to pull the answerable question (the rest is kept as commentary),
          then drafted from the agent’s knowledge for review.
        </p>

        <input type='file' accept='.csv,.xlsx,.xls' onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
          className='block w-full text-sm mb-4 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-sky-600 file:text-white hover:file:bg-sky-700' />

        {headers.length > 0 && (
          <>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder='Batch label'
              className='w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg' style={{ fontSize: '16px' }} />
            <div className='grid grid-cols-2 gap-2 mb-3'>
              {FIELDS.map(f => (
                <label key={f.key} className='text-sm'>
                  <span className='block text-xs font-medium text-gray-600 mb-0.5'>{f.label}{f.required ? ' *' : ''}</span>
                  <select value={map[f.key]} onChange={e => setMap(m => ({ ...m, [f.key]: e.target.value }))}
                    className='w-full px-2 py-1.5 border border-gray-300 rounded-lg' style={{ fontSize: '16px' }}>
                    <option value=''>— none —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <p className='text-sm text-gray-600 mb-3'>{withComment} of {rows.length} rows have a comment and will be imported.</p>
          </>
        )}

        {err && <p className='text-sm text-red-600 mb-2'>{err}</p>}
        <div className='flex justify-end gap-2'>
          <button onClick={onClose} disabled={busy} className='px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50'>Cancel</button>
          <button onClick={submit} disabled={busy || withComment === 0}
            className='px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50'>
            {busy ? 'Importing & drafting…' : 'Import ' + (withComment || '') + ' comments'}</button>
        </div>
      </div>
    </div>
  )
}
