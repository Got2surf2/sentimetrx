'use client'

// components/analyze/DatasetCard.tsx
// Fixed-structure card — same height, same info hierarchy, Hermes palette.
// Sections (top → bottom):
//   1. Name + three-dot menu
//   2. Source + visibility badges
//   3. Stats row: row count · field count · time
//   4. Owner row
//   5. Analyze button (always at bottom via mt-auto)

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'
import type { DatasetWithState } from '@/lib/analyzeTypes'

interface OrgOption { id: string; name: string }

interface Props {
  dataset:             DatasetWithState
  onDelete:            (id: string) => void
  onRename:            (id: string, name: string) => void
  onToggleVisibility:  (id: string, v: 'private' | 'public') => void
  onToggleArchive:     (id: string, s: 'active' | 'archived') => void
  isAdmin?:            boolean
  allOrgs?:            OrgOption[]
  onTransfer?:         (datasetId: string, studyId: string | null, orgId: string) => Promise<void>
}

const HERMES = '#e8622a'
const HERMES_BG = '#fff4ef'
const HERMES_MID = '#fcd5c0'

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 2)   return 'just now'
  if (mins < 60)  return mins + 'm ago'
  if (hours < 24) return hours + 'h ago'
  if (days < 30)  return days + 'd ago'
  return new Date(iso).toLocaleDateString()
}

// Pill badge
function Badge({ label, color, bg, border }: { label: string, color: string, bg: string, border: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color, background: bg, border: '1px solid ' + border, whiteSpace: 'nowrap' as const }}>
      {label}
    </span>
  )
}

export default function DatasetCard({ dataset, onDelete, onRename, onToggleVisibility, onToggleArchive, isAdmin = false, allOrgs = [], onTransfer }: Props) {
  const router = useRouter()
  const [menuOpen,      setMenuOpen]      = useState(false)
  const [renaming,      setRenaming]      = useState(false)
  const [renameVal,     setRenameVal]     = useState(dataset.name)
  const [confirmDel,    setConfirmDel]    = useState(false)
  const [syncing,       setSyncing]       = useState(false)
  const [syncToast,     setSyncToast]     = useState('')
  const [showTransfer,  setShowTransfer]  = useState(false)
  const [collectionInfo, setCollectionInfo] = useState<{ collectionDatasetId: string; collectionName: string } | null>(null)
  const [transferOrgId, setTransferOrgId] = useState('')
  const [transferring,  setTransferring]  = useState(false)

  // Check if this dataset belongs to a collection (for warning on delete)
  useEffect(function() {
    if (dataset.source === 'collection') return
    fetch('/api/datasets/' + dataset.id + '/collection-check')
      .then(function(r) { return r.json() })
      .then(function(d) { if (d.collection_dataset_id) setCollectionInfo({ collectionDatasetId: d.collection_dataset_id, collectionName: d.collection_name }) })
      .catch(function() {})
  }, [dataset.id, dataset.source])

  const isStudy      = dataset.source === 'study'
  const isReviews    = dataset.source === 'google_reviews'
  const isReddit     = dataset.source === 'reddit'
  const isTownHall   = dataset.source === 'townhall'
  const isSubstack   = dataset.source === 'substack'
  const isCollection = dataset.source === 'collection'
  const isArchived = dataset.status === 'archived'
  const fieldCount = dataset.state?.schema_config?.fields?.filter(function(f: { type: string }) {
    return f.type !== 'ignore'
  }).length ?? null

  async function handleTransferConfirm() {
    if (!transferOrgId || !onTransfer) return
    setTransferring(true)
    await onTransfer(dataset.id, dataset.study_id, transferOrgId)
    setTransferring(false)
    setShowTransfer(false)
  }

  async function handleSync(full = false) {
    setSyncing(true); setMenuOpen(false); setSyncToast('')
    try {
      const url  = '/api/datasets/' + dataset.id + '/sync' + (full ? '?full=true' : '')
      const res  = await fetch(url, { method: 'POST' })
      const data = await res.json()
      if (data.synced === 0) {
        setSyncing(false)
        setSyncToast('Already up to date')
        setTimeout(function() { setSyncToast('') }, 3000)
      } else {
        setSyncToast(data.synced + ' new response' + (data.synced !== 1 ? 's' : '') + ' synced')
        // Keep overlay visible briefly, then refresh page to update all counts (including collections)
        setTimeout(function() { setSyncing(false); setSyncToast(''); router.refresh() }, 1200)
      }
    } catch {
      setSyncing(false)
      setSyncToast('Sync failed')
      setTimeout(function() { setSyncToast('') }, 3000)
    }
  }

  async function handleSourceSync() {
    setSyncing(true); setMenuOpen(false); setSyncToast('')
    try {
      if (isReviews) {
        var srcRes = await fetch('/api/review-sources')
        var srcData = await srcRes.json()
        var source = (srcData.sources || []).find(function(s: any) { return s.dataset_id === dataset.id })
        if (!source) { setSyncToast('No review source found'); setSyncing(false); setTimeout(function() { setSyncToast('') }, 3000); return }
        var res = await fetch('/api/review-sources/' + source.id + '/sync', { method: 'POST' })
        var data = await res.json()
        if ((data.synced || 0) === 0 && !data.pending_locations?.length) {
          setSyncing(false); setSyncToast('Already up to date'); setTimeout(function() { setSyncToast('') }, 3000)
        } else {
          setSyncToast((data.synced || 0) + ' review' + ((data.synced || 0) !== 1 ? 's' : '') + ' synced')
          setTimeout(function() { setSyncing(false); setSyncToast(''); router.refresh() }, 1200)
        }
      } else if (isTownHall && dataset.description?.startsWith('th:')) {
        var sessionId = dataset.description.slice(3)
        var res2 = await fetch('/api/townhall/sessions/' + sessionId + '/analyze', { method: 'POST' })
        var data2 = await res2.json()
        if ((data2.synced || 0) === 0 && !data2.created) {
          setSyncing(false); setSyncToast('Already up to date'); setTimeout(function() { setSyncToast('') }, 3000)
        } else {
          setSyncToast((data2.synced || 0) + ' response' + ((data2.synced || 0) !== 1 ? 's' : '') + ' synced')
          setTimeout(function() { setSyncing(false); setSyncToast(''); router.refresh() }, 1200)
        }
      }
    } catch { setSyncing(false); setSyncToast('Sync failed'); setTimeout(function() { setSyncToast('') }, 3000) }
  }

  function handleRenameSubmit() {
    if (renameVal.trim() && renameVal !== dataset.name) onRename(dataset.id, renameVal.trim())
    setRenaming(false); setMenuOpen(false)
  }

  function handleDelete() {
    if (confirmDel) {
      if (collectionInfo) {
        var choice = window.confirm('This dataset belongs to collection "' + collectionInfo.collectionName + '".\n\nClick OK to delete it (removes from collection too).\nClick Cancel to keep it.')
        if (!choice) { setConfirmDel(false); setMenuOpen(false); return }
      }
      onDelete(dataset.id); setMenuOpen(false)
    }
    else setConfirmDel(true)
  }

  async function handleRemoveFromCollection() {
    if (!collectionInfo) return
    setMenuOpen(false)
    var ok = window.confirm('Remove "' + dataset.name + '" from collection "' + collectionInfo.collectionName + '"? The dataset itself will not be deleted.')
    if (!ok) return
    await fetch('/api/collections/' + collectionInfo.collectionDatasetId + '?member=' + dataset.id, { method: 'DELETE' })
    setCollectionInfo(null)
    router.refresh()
  }

  return (
    <div style={{
      background:    'white',
      border:        '1px solid #e8e8ec',
      borderTop:     '3px solid ' + (isArchived ? '#d1d5db' : isCollection ? '#0ea5e9' : isReddit ? '#10B981' : isTownHall ? '#8B5CF6' : isSubstack ? '#e11d48' : isReviews ? '#2563eb' : HERMES),
      borderRadius:  12,
      padding:       '16px',
      boxShadow:     '0 1px 4px rgba(0,0,0,.05)',
      display:       'flex',
      flexDirection: 'column' as const,
      gap:           12,
      opacity:       isArchived ? 0.65 : 1,
      transition:    'box-shadow .15s, opacity .15s',
      position:      'relative' as const,
      minHeight:     220,
      overflow:      'hidden' as const,
    }}
    onMouseEnter={function(e) { if (!isArchived) (e.currentTarget as HTMLDivElement).style.boxShadow = isCollection ? '0 4px 16px rgba(14,165,233,.12)' : isReddit ? '0 4px 16px rgba(16,185,129,.12)' : isTownHall ? '0 4px 16px rgba(139,92,246,.12)' : isSubstack ? '0 4px 16px rgba(225,29,72,.12)' : isReviews ? '0 4px 16px rgba(37,99,235,.12)' : '0 4px 16px rgba(232,98,42,.12)' }}
    onMouseLeave={function(e) { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,.05)' }}>

      {/* 1. Name + menu */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={renameVal} onChange={function(e) { setRenameVal(e.target.value) }} autoFocus
                onKeyDown={function(e) {
                  if (e.key === 'Enter') handleRenameSubmit()
                  if (e.key === 'Escape') { setRenaming(false); setRenameVal(dataset.name) }
                }}
                style={{ flex: 1, padding: '4px 8px', fontSize: 13, border: '1.5px solid ' + HERMES, borderRadius: 7, outline: 'none', fontFamily: 'inherit', minWidth: 0 }}
              />
              <button onClick={handleRenameSubmit}
                style={{ fontSize: 11, fontWeight: 700, color: 'white', background: HERMES, border: 'none', borderRadius: 7, padding: '4px 10px', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}>
                Save
              </button>
              <button onClick={function() { setRenaming(false); setRenameVal(dataset.name) }}
                style={{ fontSize: 11, color: '#9ca3af', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                ✕
              </button>
            </div>
          ) : (
            <h3 style={{ fontSize: 14, fontWeight: 800, color: '#111827', margin: 0, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
              {dataset.name}
            </h3>
          )}
        </div>

        {/* Three-dot menu */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={function() { setMenuOpen(function(v) { return !v }) }}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 14, color: '#9ca3af', fontWeight: 900, lineHeight: 1, fontFamily: 'inherit' }}>
            ···
          </button>
          {menuOpen && (
            <div style={{ position: 'absolute', right: 0, top: 32, background: 'white', border: '1px solid #e8e8ec', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.10)', zIndex: 20, minWidth: 168, padding: '4px 0', overflow: 'hidden' }}>
              {[
                { label: 'Rename', action: function() { setRenaming(true); setMenuOpen(false) } },
                { label: 'Edit themes', action: function() { router.push('/analyze/' + dataset.id + '/textmine?editThemes=1'); setMenuOpen(false) } },
                { label: dataset.visibility === 'private' ? 'Make public' : 'Make private', action: function() { onToggleVisibility(dataset.id, dataset.visibility === 'private' ? 'public' : 'private'); setMenuOpen(false) } },
                { label: isArchived ? 'Unarchive' : 'Archive', action: function() { onToggleArchive(dataset.id, isArchived ? 'active' : 'archived'); setMenuOpen(false) } },
              ].map(function(item) {
                return (
                  <button key={item.label} onClick={item.action}
                    style={{ width: '100%', textAlign: 'left' as const, padding: '8px 14px', fontSize: 12, color: '#374151', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'block' }}>
                    {item.label}
                  </button>
                )
              })}
              {isStudy && (
                <>
                  <button onClick={function() { handleSync(false) }}
                    style={{ width: '100%', textAlign: 'left' as const, padding: '8px 14px', fontSize: 12, color: '#374151', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Sync new responses
                  </button>
                  <button onClick={function() { if (window.confirm('Re-import all responses from scratch? Use this if you added new survey fields.')) handleSync(true) }}
                    style={{ width: '100%', textAlign: 'left' as const, padding: '8px 14px', fontSize: 12, color: '#6b7280', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Re-import all
                  </button>
                </>
              )}
              {isAdmin && allOrgs.length > 0 && (
                <button onClick={function() { setShowTransfer(true); setMenuOpen(false) }}
                  style={{ width: '100%', textAlign: 'left' as const, padding: '8px 14px', fontSize: 12, color: '#374151', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Move to org
                </button>
              )}
              {(isReviews || isTownHall) && (
                <button onClick={function() { handleSourceSync() }}
                  style={{ width: '100%', textAlign: 'left' as const, padding: '8px 14px', fontSize: 12, color: '#374151', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Sync {isReviews ? 'reviews' : 'responses'}
                </button>
              )}
              {collectionInfo && (
                <button onClick={handleRemoveFromCollection}
                  style={{ width: '100%', textAlign: 'left' as const, padding: '8px 14px', fontSize: 12, color: '#d97706', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Remove from collection
                </button>
              )}
              <div style={{ height: 1, background: '#f3f4f6', margin: '4px 0' }} />
              <button onClick={handleDelete}
                style={{ width: '100%', textAlign: 'left' as const, padding: '8px 14px', fontSize: 12, fontWeight: confirmDel ? 700 : 400, color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                {confirmDel ? 'Confirm delete?' : 'Delete'}
              </button>
              {confirmDel && (
                <button onClick={function() { setConfirmDel(false) }}
                  style={{ width: '100%', textAlign: 'left' as const, padding: '6px 14px', fontSize: 11, color: '#9ca3af', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. Source + visibility badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
        {isStudy ? (
          <Badge label={'Sarina: ' + (dataset.study_name || 'Linked')} color={HERMES} bg={HERMES_BG} border={HERMES_MID} />
        ) : isReviews ? (
          <Badge label={'\u2B50 Google Reviews'} color="#2563eb" bg="#eff6ff" border="#bfdbfe" />
        ) : isReddit ? (
          <Badge label={'\uD83D\uDCAC Reddit'} color="#059669" bg="#ecfdf5" border="#a7f3d0" />
        ) : isTownHall ? (
          <Badge label={'\uD83C\uDFE4 PulseIQ'} color="#7c3aed" bg="#f5f3ff" border="#ddd6fe" />
        ) : isSubstack ? (
          <Badge label={'\u270D Substack'} color="#e11d48" bg="#fff1f2" border="#fecdd3" />
        ) : isCollection ? (
          <Badge label={'\uD83D\uDCC2 Collection'} color="#0284c7" bg="#f0f9ff" border="#bae6fd" />
        ) : (
          <Badge label="Upload" color="#6b7280" bg="#f9fafb" border="#e5e7eb" />
        )}
        <Badge
          label={dataset.visibility}
          color={dataset.visibility === 'public' ? '#059669' : '#6b7280'}
          bg={dataset.visibility === 'public' ? '#ecfdf5' : '#f9fafb'}
          border={dataset.visibility === 'public' ? '#a7f3d0' : '#e5e7eb'}
        />
        {isArchived && (
          <Badge label="Archived" color="#b45309" bg="#fffbeb" border="#fde68a" />
        )}
        {dataset.theme_count && dataset.theme_count > 0 ? (
          dataset.theme_source === 'ai' ? (
            <Badge label={'\u29E1 AI Mined'} color="#2563eb" bg="#eff6ff" border="#bfdbfe" />
          ) : dataset.theme_lib_name ? (
            <>{dataset.theme_lib_name.split(' + ').map(function(lib: string) {
              return <Badge key={lib} label={'\u2261 ' + lib.trim()} color="#e8622a" bg="#fff4ef" border="#fbd5c2" />
            })}</>
          ) : (
            <Badge label={'\u2261 ' + dataset.theme_count + ' themes'} color="#e8622a" bg="#fff4ef" border="#fbd5c2" />
          )
        ) : null}
      </div>

      {/* Transfer panel — admin only */}
      {showTransfer && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>
            Move to organization{dataset.study_id ? ' (dataset + linked study)' : ''}
          </div>
          <select
            value={transferOrgId}
            onChange={function(e) { setTransferOrgId(e.target.value) }}
            style={{ padding: '6px 10px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 7, outline: 'none', fontFamily: 'inherit', background: 'white', color: '#111827' }}>
            <option value="">— Select org —</option>
            {allOrgs.map(function(o) { return <option key={o.id} value={o.id}>{o.name}</option> })}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleTransferConfirm}
              disabled={!transferOrgId || transferring}
              style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, color: 'white', background: transferring || !transferOrgId ? '#9ca3af' : HERMES, border: 'none', borderRadius: 7, cursor: transferring || !transferOrgId ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
              {transferring ? 'Moving…' : 'Move'}
            </button>
            <button
              onClick={function() { setShowTransfer(false); setTransferOrgId('') }}
              style={{ padding: '6px 12px', fontSize: 11, color: '#6b7280', background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 3. Stats row */}
      {isReviews && (function() {
        var analytics = dataset.state?.analytics as any
        // Try multiple field names for the review text summary
        var fs = analytics?.fieldSummaries || {}
        var reviewTextSummary = fs.review_text || fs.Review || fs.comment || fs.Comment || fs.text || null
        // For open-ended fields, nonNull = rows with actual text content
        var withComments = reviewTextSummary?.nonNull || 0
        // If nonNull is 0 but we have rows, check if avgWordCount > 0 (means there IS text data)
        if (withComments === 0 && reviewTextSummary?.avgWordCount > 0) {
          withComments = dataset.row_count  // analytics not computed correctly, assume all have text
        }
        var ratingOnly = Math.max(0, dataset.row_count - withComments)
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#6b7280', flexWrap: 'wrap' }}>
            <span><strong style={{ color: '#111827' }}>{dataset.row_count.toLocaleString()}</strong> reviews</span>
            {withComments > 0 ? (
              <>
                <span><strong style={{ color: '#059669' }}>{withComments.toLocaleString()}</strong> with comments</span>
                <span><strong style={{ color: '#d97706' }}>{ratingOnly.toLocaleString()}</strong> rating only</span>
              </>
            ) : (
              <span style={{ color: '#9ca3af' }}>Open dataset to compute comment stats</span>
            )}
          </div>
        )
      })()}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>&#8803;</span>
          <span style={{ fontWeight: 700, color: '#111827' }}>{dataset.row_count.toLocaleString()}</span>
          <span style={{ color: '#9ca3af' }}>rows</span>
        </div>
        {fieldCount !== null && !isReviews && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 13, lineHeight: 1, color: '#9ca3af' }}>&#9783;</span>
            <span style={{ fontWeight: 700, color: '#111827' }}>{fieldCount}</span>
            <span style={{ color: '#9ca3af' }}>fields</span>
          </div>
        )}
        <div style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: 11 }}>
          {timeAgo(dataset.updated_at)}
        </div>
      </div>

      {/* 3b. Scoring donut — shows when a scored field exists with analytics */}
      {(function() {
        var fields = dataset.state?.schema_config?.fields || []
        var analytics = dataset.state?.analytics as any
        if (!analytics || !analytics.fieldSummaries) return null

        // Find a score field: either explicit scoreField with remapping, or a rating/nps numeric field
        var scoreField = fields.find(function(f: any) { return f.scoreField && f.remapping && Object.keys(f.remapping).length > 0 })
        var ratingField = !scoreField ? fields.find(function(f: any) { return f.type === 'numeric' && (f.sqt === 'rating' || f.sqt === 'nps') }) : null
        var targetField = scoreField || ratingField
        if (!targetField) return null

        var summary = analytics.fieldSummaries[targetField.field]
        if (!summary) return null

        var avgScore: number, minScore: number, maxScore: number, mappedCount: number

        if (scoreField && scoreField.remapping) {
          // Categorical with remapping — compute weighted average
          if (!summary.counts) return null
          var remap = scoreField.remapping as Record<string, number>
          var entries = Object.entries(summary.counts as Record<string, number>)
          var total = entries.reduce(function(s, e) { return s + e[1] }, 0)
          if (total === 0) return null
          var weightedSum = 0; mappedCount = 0
          entries.forEach(function(e) { var num = remap[e[0]]; if (num != null) { weightedSum += num * e[1]; mappedCount += e[1] } })
          if (mappedCount === 0) return null
          avgScore = weightedSum / mappedCount
          maxScore = Math.max.apply(null, Object.values(remap))
          minScore = Math.min.apply(null, Object.values(remap))
        } else {
          // Numeric field — use pre-computed avg directly
          if (summary.avg == null || summary.nonNull === 0) return null
          avgScore = typeof summary.avg === 'number' ? summary.avg : parseFloat(summary.avg)
          if (isNaN(avgScore)) return null
          minScore = summary.min ?? 0
          maxScore = summary.max ?? 5
          mappedCount = summary.nonNull || 0
        }
        var pct = maxScore > minScore ? Math.round((avgScore - minScore) / (maxScore - minScore) * 100) : 50
        var label = (targetField.label || targetField.field)
        // SVG donut
        var r = 28, cx = 32, cy = 32, stroke = 7
        var circ = 2 * Math.PI * r
        var dash = circ * pct / 100
        var color = pct >= 70 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626'
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
            <svg width={64} height={64} viewBox="0 0 64 64">
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
              <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke}
                strokeDasharray={dash + ' ' + (circ - dash)}
                strokeDashoffset={circ * 0.25}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray .6s ease' }} />
              <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central"
                style={{ fontSize: 13, fontWeight: 800, fill: color }}>{avgScore.toFixed(1)}</text>
            </svg>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#111827' }}>{label}</div>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>Avg score ({minScore}–{maxScore} scale)</div>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>{mappedCount.toLocaleString()} scored responses</div>
            </div>
          </div>
        )
      })()}

      {/* 4. Owner row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingTop: 8, borderTop: '1px solid #f3f4f6', marginTop: 'auto' }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: HERMES_BG, border: '1.5px solid ' + HERMES_MID, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: HERMES }}>
            {(dataset.creator_name || '?')[0].toUpperCase()}
          </span>
        </div>
        <span style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flex: 1 }}>
          {dataset.creator_name || 'Unknown'}
        </span>
        {dataset.org_name && (
          <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>
            {dataset.org_name}
          </span>
        )}
        {(isStudy || isReviews || isTownHall) && dataset.last_synced_at && (
          <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto', flexShrink: 0 }}>
            Synced {timeAgo(dataset.last_synced_at)}
          </span>
        )}
      </div>

      {/* 5. Analyze button */}
      <button
        onClick={function() { router.push('/analyze/' + dataset.id + '/textmine') }}
        disabled={isArchived}
        style={{
          width: '100%', padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 700,
          color: isArchived ? '#9ca3af' : 'white',
          background: isArchived ? '#f3f4f6' : isCollection ? '#0ea5e9' : isReddit ? '#10B981' : isTownHall ? '#8B5CF6' : isSubstack ? '#e11d48' : isReviews ? '#2563eb' : HERMES,
          border: 'none', cursor: isArchived ? 'not-allowed' : 'pointer',
          transition: 'opacity .15s', fontFamily: 'inherit',
        }}
        onMouseEnter={function(e) { if (!isArchived) (e.currentTarget as HTMLButtonElement).style.opacity = '0.88' }}
        onMouseLeave={function(e) { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}>
        {isArchived ? 'Archived' : 'Analyze in Ana \u2192'}
      </button>

      {/* Click-away for menu */}
      {menuOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={function() { setMenuOpen(false); setConfirmDel(false) }} />}

      {/* Syncing overlay */}
      {syncing && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 20, borderRadius: 12 }}>
          <LottieLoader size={64} message="" />
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginTop: 8 }}>Syncing responses...</div>
        </div>
      )}

      {/* Toast */}
      {syncToast && !syncing && (
        <div style={{
          position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)',
          background: syncToast.includes('failed') ? '#fee2e2' : syncToast.includes('up to date') ? '#f3f4f6' : '#d1fae5',
          color: syncToast.includes('failed') ? '#dc2626' : syncToast.includes('up to date') ? '#374151' : '#059669',
          border: '1px solid ' + (syncToast.includes('failed') ? '#fecaca' : syncToast.includes('up to date') ? '#e5e7eb' : '#a7f3d0'),
          padding: '6px 16px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          boxShadow: '0 2px 8px rgba(0,0,0,.1)', zIndex: 20,
        }}>
          {syncToast}
        </div>
      )}
    </div>
  )
}
