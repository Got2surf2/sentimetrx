'use client'

// Card grid for the recordings list. Each card links to the report (complete)
// or the status surface (in-progress/failed). The top-right carries a favorite
// star + a ⋯ menu (Rename / Delete) — matching the Analyze/Surveys card family.
// Delete hard-removes the recording + all its files (confirmed in a modal).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FavoriteStar } from '@/components/ui/FavoriteStar'

export interface RecordingCard {
  id: string
  dataset_id: string | null
  name: string
  session_type: string
  meeting_date: string | null
  status: string
  cost_cents: number
  source_duration_sec: number | null
  created_at: string
  owner_name: string | null
  org_name: string | null
  favorited: boolean
  entities_reviewed: boolean
  has_edits: boolean
  shared: boolean
  qa_pair_count: number
  media_file_count: number
  slide_file_count: number
  flagged_count: number
}

// Lifecycle steps for the ℹ️ progress popover. `done` from the recording's
// status + flags; `optional` steps can be skipped without blocking the report.
function lifecycleSteps(r: RecordingCard): Array<{ label: string; done: boolean; optional?: boolean }> {
  const transcribed = ['transcribed', 'analyzing', 'rendering', 'complete'].includes(r.status)
  const preMedia = r.status === 'draft' || r.status === 'awaiting_media'
  return [
    { label: 'Uploaded', done: !preMedia && r.status !== 'uploading' },
    { label: 'Transcribed', done: transcribed },
    { label: 'Entities reviewed', done: r.entities_reviewed, optional: true },
    { label: 'Q&A generated', done: r.status === 'complete' },
    { label: 'Polished edits', done: r.has_edits, optional: true },
    { label: 'Public link shared', done: r.shared, optional: true },
  ]
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  draft:          { bg: '#f3f4f6', fg: '#6b7280', label: 'Draft' },
  awaiting_media: { bg: '#e0f2fe', fg: '#0369a1', label: 'Add recording' },
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
  // meeting_date is a date-only column — format in UTC so a value like
  // '2026-05-21' doesn't render as the 20th in negative-UTC timezones.
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) } catch { return '' }
}

// Source audio length → "1h 12m" / "45m" / "30s". Blank when unknown (the
// meta row drops the item entirely rather than showing "0m").
function fmtDur(sec: number | null): string {
  if (!sec || sec <= 0) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${sec}s`
}

// Compact "3 files · 17 Q&A · 1h 12m" line for a card. Each part is dropped
// when it would be empty/zero, so an in-progress recording shows only what it has.
function cardMeta(r: RecordingCard): string[] {
  const totalFiles = r.media_file_count + r.slide_file_count
  const parts: string[] = []
  if (totalFiles > 0) {
    parts.push(
      r.media_file_count > 0 && r.slide_file_count > 0
        ? `${r.media_file_count} media · ${r.slide_file_count} slides`
        : `${totalFiles} file${totalFiles === 1 ? '' : 's'}`,
    )
  }
  if (r.qa_pair_count > 0) parts.push(`${r.qa_pair_count} Q&A`)
  const dur = fmtDur(r.source_duration_sec)
  if (dur) parts.push(dur)
  return parts
}

interface OrgOption { id: string; name: string }

export default function RecordingsListClient({ rows: initial, showOrg, isAdmin = false, allOrgs = [] }: { rows: RecordingCard[]; showOrg: boolean; isAdmin?: boolean; allOrgs?: OrgOption[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<RecordingCard | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  // ⋯ menu + inline rename, keyed by recording id.
  const [menuId, setMenuId] = useState<string | null>(null)
  const [infoId, setInfoId] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')

  // Cross-org transfer (platform-admin only).
  const [xferTarget, setXferTarget] = useState<RecordingCard | null>(null)
  const [xferOrgId, setXferOrgId] = useState('')
  const [xferring, setXferring] = useState(false)

  async function confirmTransfer() {
    if (!xferTarget || !xferOrgId) return
    setXferring(true)
    setError('')
    try {
      const res = await fetch(`/api/recordings/${xferTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: xferOrgId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `Transfer failed (${res.status})`)
      setXferTarget(null)
      setXferOrgId('')
      router.refresh()
    } catch (e: any) {
      setError(e.message || 'Transfer failed')
    } finally {
      setXferring(false)
    }
  }

  async function submitRename(id: string) {
    const name = renameVal.trim()
    const current = rows.find(r => r.id === id)?.name
    if (!name || name === current) { setRenameId(null); return }
    // Optimistic — revert on failure.
    setRows(prev => prev.map(r => (r.id === id ? { ...r, name } : r)))
    setRenameId(null)
    try {
      const res = await fetch(`/api/recordings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setRows(prev => prev.map(r => (r.id === id ? { ...r, name: current ?? r.name } : r)))
      setError('Rename failed')
    }
  }

  // Duplicate the project setup into a fresh recording (no media/results) and
  // jump to its status page so the user can add new audio.
  const [duplicating, setDuplicating] = useState(false)
  async function onDuplicate(r: RecordingCard) {
    setMenuId(null)
    setDuplicating(true)
    setError('')
    try {
      const res = await fetch(`/api/recordings/${r.id}/duplicate`, { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.id) throw new Error(d.error || `Duplicate failed (${res.status})`)
      router.push(`/recordings/${d.id}/status`)
    } catch (e: any) {
      setError(e.message || 'Duplicate failed')
      setDuplicating(false)
    }
  }

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

  const nameQ = query.trim().toLowerCase()
  const visibleRows = nameQ ? rows.filter(r => (r.name || '').toLowerCase().includes(nameQ)) : rows
  return (
    <>
      <div className="mb-4">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name…"
          style={{ fontSize: '16px' }}
          className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 outline-none w-full sm:w-64" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleRows.map(r => {
          const href = r.status === 'complete'
            ? `/recordings/${r.id}/report`
            : `/recordings/${r.id}/status`
          const st = STATUS_STYLE[r.status] || { bg: '#f3f4f6', fg: '#6b7280', label: r.status }
          return (
            <div key={r.id} className="group relative bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md hover:border-orange-200 transition-all flex flex-col overflow-hidden min-h-[176px]">
              {/* top accent strip — status color (matches the family's colored card header) */}
              <div className="h-1.5 w-full" style={{ background: st.fg }} />
              {/* top-right: progress ℹ️ + favorite star + ⋯ menu (Rename / Delete) */}
              <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-0.5">
                <div className="relative">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setInfoId(infoId === r.id ? null : r.id) }}
                    title="Progress — what's done, what's optional"
                    className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-base leading-none">
                    ⓘ
                  </button>
                  {infoId === r.id && (
                    <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-xl shadow-lg z-30 w-60 p-3 text-left cursor-default" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
                      <div className="text-xs font-bold text-gray-700 mb-2">Progress</div>
                      <div className="space-y-1">
                        {lifecycleSteps(r).map(step => (
                          <div key={step.label} className="flex items-center gap-2 text-xs">
                            <span className={`w-3.5 text-center ${step.done ? 'text-green-600' : 'text-gray-300'}`}>{step.done ? '✓' : '○'}</span>
                            <span className={step.done ? 'text-gray-800' : 'text-gray-500'}>{step.label}</span>
                            {step.optional && <span className="ml-auto text-[10px] text-gray-400 italic">optional</span>}
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-100">Optional steps can be skipped — only upload + generate are required.</p>
                    </div>
                  )}
                </div>
                <FavoriteStar resourceType="recording" resourceId={r.id} initialFavorited={r.favorited} size={16} />
                <div className="relative">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuId(menuId === r.id ? null : r.id) }}
                    title="More actions"
                    className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors font-black leading-none">
                    ⋯
                  </button>
                  {menuId === r.id && (
                    <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-xl shadow-lg z-30 min-w-[150px] py-1 overflow-hidden">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRenameVal(r.name); setRenameId(r.id); setMenuId(null) }}
                        className="w-full text-left px-3.5 py-2 text-xs text-gray-700 hover:bg-gray-50">
                        Rename
                      </button>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onDuplicate(r) }}
                        disabled={duplicating}
                        className="w-full text-left px-3.5 py-2 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        {duplicating ? 'Duplicating…' : 'Duplicate'}
                      </button>
                      {isAdmin && allOrgs.length > 0 && (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuId(null); setXferOrgId(''); setXferTarget(r) }}
                          className="w-full text-left px-3.5 py-2 text-xs text-gray-700 hover:bg-gray-50">
                          Move to org
                        </button>
                      )}
                      <div className="h-px bg-gray-100 my-1" />
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuId(null); setTarget(r) }}
                        className="w-full text-left px-3.5 py-2 text-xs text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Inline rename — overlays the title row, sits above the card Link */}
              {renameId === r.id && (
                <div className="absolute inset-x-0 top-1.5 z-30 bg-white px-3 pt-3 pb-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void submitRename(r.id); if (e.key === 'Escape') setRenameId(null) }}
                      className="flex-1 min-w-0 px-2 py-1 border border-orange-400 rounded-lg outline-none"
                      style={{ fontSize: '16px' }}
                    />
                    <button onClick={() => { void submitRename(r.id) }} className="shrink-0 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg px-2.5 py-1.5">Save</button>
                    <button onClick={() => setRenameId(null)} className="shrink-0 text-sm text-gray-400 hover:text-gray-600 px-1">✕</button>
                  </div>
                </div>
              )}

              <Link href={href} className="flex flex-col flex-1 p-4 pr-16">
                <div className="flex items-start gap-2">
                  <span className="text-lg leading-none mt-0.5">🏛️</span>
                  <h3 className="font-bold text-gray-800 text-sm leading-snug line-clamp-2 group-hover:text-orange-700 transition-colors">{r.name}</h3>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                  <span className="text-xs text-gray-400">{fmtDate(r.meeting_date) || fmtDate(r.created_at)}</span>
                </div>
                {(() => {
                  const meta = cardMeta(r)
                  return meta.length > 0 ? (
                    <div className="mt-2.5 flex items-center flex-wrap gap-x-1.5 text-xs text-gray-500">
                      {meta.map((part, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5">
                          {i > 0 && <span className="text-gray-300">·</span>}
                          {part}
                        </span>
                      ))}
                    </div>
                  ) : null
                })()}
                <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                  <span className="truncate">{r.owner_name || '—'}</span>
                  {showOrg && r.org_name && <span className="truncate max-w-[45%] text-gray-500">{r.org_name}</span>}
                </div>
              </Link>
              {/* Pending-work action bar — flagged Q&A pairs needing reviewer
                  intervention. Its own Link (NOT nested in the card's body Link)
                  → the report's Coverage review tab. A second pill (truly
                  unanswered questions) will sit alongside once the analyzer
                  detects them. */}
              {r.status === 'complete' && r.flagged_count > 0 && (
                <Link
                  href={`/recordings/${r.id}/report?tab=coverage`}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-amber-200 bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-semibold transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden>⚠</span>
                    {r.flagged_count} {r.flagged_count === 1 ? 'pair needs' : 'pairs need'} review
                  </span>
                  <span aria-hidden className="text-amber-700">→</span>
                </Link>
              )}
            </div>
          )
        })}
      </div>

      {/* Click-away to dismiss an open ⋯ menu or ℹ️ progress popover */}
      {visibleRows.length === 0 && nameQ && (
        <div className="text-sm text-gray-400 py-8 text-center">No Town Halls match “{query}”.</div>
      )}

      {(menuId || infoId) && <div className="fixed inset-0 z-10" onClick={() => { setMenuId(null); setInfoId(null) }} />}

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
              <button onClick={() => { void confirmDelete() }} disabled={deleting}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      {xferTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !xferring && setXferTarget(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900">Move “{xferTarget.name}” to another org</h2>
            <p className="text-sm text-gray-600 mt-2">
              Moves the recording and <strong>everything it owns</strong> — files, transcript, Q&amp;A pairs, the derived dataset, and its stored audio — to the selected organization. The audit log records the move.
            </p>
            <select
              value={xferOrgId}
              onChange={e => setXferOrgId(e.target.value)}
              className="mt-4 w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900"
              style={{ fontSize: '16px' }}>
              <option value="">— Select organization —</option>
              {allOrgs.filter(o => o.name).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {error && <p className="text-sm text-red-600 mt-3 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => { setXferTarget(null); setError('') }} disabled={xferring}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => { void confirmTransfer() }} disabled={xferring || !xferOrgId}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: '#e8622a' }}>
                {xferring ? 'Moving…' : 'Move recording'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
