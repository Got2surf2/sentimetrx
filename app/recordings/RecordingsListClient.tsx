'use client'

// Card grid for the recordings list. Each card links to the report (complete)
// or the status surface (in-progress/failed), and offers a delete that hard-
// removes the recording + all its files (confirmed in a modal).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export interface RecordingCard {
  id: string
  dataset_id: string | null
  name: string
  session_type: string
  meeting_date: string | null
  status: string
  cost_cents: number
  created_at: string
  owner_name: string | null
  org_name: string | null
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  complete:     { bg: '#dcfce7', fg: '#15803d', label: 'Complete' },
  failed:       { bg: '#fee2e2', fg: '#b91c1c', label: 'Failed' },
  cancelled:    { bg: '#f3f4f6', fg: '#6b7280', label: 'Cancelled' },
  uploading:    { bg: '#ffedd5', fg: '#c2410c', label: 'Uploading' },
  queued:       { bg: '#ffedd5', fg: '#c2410c', label: 'Queued' },
  extracting:   { bg: '#ffedd5', fg: '#c2410c', label: 'Extracting' },
  transcribing: { bg: '#ffedd5', fg: '#c2410c', label: 'Transcribing' },
  transcribed:  { bg: '#fef9c3', fg: '#a16207', label: 'Review & generate' },
  analyzing:    { bg: '#ffedd5', fg: '#c2410c', label: 'Analyzing' },
  rendering:    { bg: '#ffedd5', fg: '#c2410c', label: 'Rendering' },
}

function fmtDate(s: string | null): string {
  if (!s) return ''
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '' }
}

export default function RecordingsListClient({ rows: initial, showOrg }: { rows: RecordingCard[]; showOrg: boolean }) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [target, setTarget] = useState<RecordingCard | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function confirmDelete() {
    if (!target) return
    setDeleting(true)
    setError('')
    try {
      const res = await fetch(`/api/recordings/${target.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Delete failed (${res.status})`)
      }
      setRows(prev => prev.filter(r => r.id !== target.id))
      setTarget(null)
      router.refresh()
    } catch (e: any) {
      setError(e.message || 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
        <div className="text-4xl mb-3">🏛️</div>
        <p className="text-sm text-gray-600">No Town Halls yet.</p>
        <p className="text-xs text-gray-400 mt-1">Start a new Town Hall and upload your meeting recording to get started.</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map(r => {
          const href = r.status === 'complete'
            ? `/recordings/${r.id}/report`
            : `/recordings/${r.id}/status`
          const st = STATUS_STYLE[r.status] || { bg: '#f3f4f6', fg: '#6b7280', label: r.status }
          return (
            <div key={r.id} className="group relative bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md hover:border-orange-200 transition-all flex flex-col overflow-hidden min-h-[176px]">
              {/* top accent strip — status color (matches the family's colored card header) */}
              <div className="h-1.5 w-full" style={{ background: st.fg }} />
              <button
                onClick={() => setTarget(r)}
                title="Delete Town Hall"
                className="absolute top-3.5 right-2.5 z-10 w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                🗑
              </button>
              <Link href={href} className="flex flex-col flex-1 p-4 pr-9">
                <div className="flex items-start gap-2">
                  <span className="text-lg leading-none mt-0.5">🏛️</span>
                  <h3 className="font-bold text-gray-800 text-sm leading-snug line-clamp-2 group-hover:text-orange-700 transition-colors">{r.name}</h3>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                  <span className="text-xs text-gray-400">{fmtDate(r.meeting_date) || fmtDate(r.created_at)}</span>
                </div>
                <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                  <span className="truncate">{r.owner_name || '—'}</span>
                  {showOrg && r.org_name && <span className="truncate max-w-[45%] text-gray-500">{r.org_name}</span>}
                </div>
              </Link>
            </div>
          )
        })}
      </div>

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !deleting && setTarget(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900">Delete “{target.name}”?</h2>
            <p className="text-sm text-gray-600 mt-2">
              This permanently deletes <strong>everything</strong> for this recording:
            </p>
            <ul className="text-sm text-gray-600 mt-2 list-disc pl-5 space-y-0.5">
              <li>the uploaded source video/audio files</li>
              <li>the extracted &amp; stitched audio</li>
              <li>the transcript</li>
              <li>all extracted Q&amp;A pairs</li>
              <li>the generated report / dataset</li>
            </ul>
            <p className="text-sm text-red-600 font-medium mt-3">This cannot be undone.</p>
            {error && <p className="text-sm text-red-600 mt-3 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setTarget(null)} disabled={deleting}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
