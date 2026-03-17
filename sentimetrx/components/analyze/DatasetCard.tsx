'use client'

// components/analyze/DatasetCard.tsx
// Fixed-structure card — same height, same info hierarchy, Hermes palette.
// Sections (top → bottom):
//   1. Name + three-dot menu
//   2. Source + visibility badges
//   3. Stats row: row count · field count · time
//   4. Owner row
//   5. Analyze button (always at bottom via mt-auto)

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DatasetWithState } from '@/lib/analyzeTypes'

interface Props {
  dataset:             DatasetWithState
  onDelete:            (id: string) => void
  onRename:            (id: string, name: string) => void
  onToggleVisibility:  (id: string, v: 'private' | 'public') => void
  onToggleArchive:     (id: string, s: 'active' | 'archived') => void
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

export default function DatasetCard({ dataset, onDelete, onRename, onToggleVisibility, onToggleArchive }: Props) {
  const router = useRouter()
  const [menuOpen,   setMenuOpen]   = useState(false)
  const [renaming,   setRenaming]   = useState(false)
  const [renameVal,  setRenameVal]  = useState(dataset.name)
  const [confirmDel, setConfirmDel] = useState(false)
  const [syncing,    setSyncing]    = useState(false)

  const isStudy    = dataset.source === 'study'
  const isArchived = dataset.status === 'archived'
  const fieldCount = dataset.state?.schema_config?.fields?.filter(function(f: { type: string }) {
    return f.type !== 'ignore'
  }).length ?? null

  async function handleSync() {
    setSyncing(true); setMenuOpen(false)
    try {
      const res  = await fetch('/api/datasets/' + dataset.id + '/sync', { method: 'POST' })
      const data = await res.json()
      if (data.synced === 0) alert('Already up to date — no new responses.')
      else router.refresh()
    } finally { setSyncing(false) }
  }

  function handleRenameSubmit() {
    if (renameVal.trim() && renameVal !== dataset.name) onRename(dataset.id, renameVal.trim())
    setRenaming(false); setMenuOpen(false)
  }

  function handleDelete() {
    if (confirmDel) { onDelete(dataset.id); setMenuOpen(false) }
    else setConfirmDel(true)
  }

  return (
    <div style={{
      background:    'white',
      border:        '1px solid #e8e8ec',
      borderTop:     '3px solid ' + (isArchived ? '#d1d5db' : HERMES),
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
    }}
    onMouseEnter={function(e) { if (!isArchived) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(232,98,42,.12)' }}
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
                <button onClick={handleSync}
                  style={{ width: '100%', textAlign: 'left' as const, padding: '8px 14px', fontSize: 12, color: '#374151', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {syncing ? 'Syncing...' : 'Sync responses'}
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
          <Badge label={'Survey: ' + (dataset.study_name || 'Linked')} color={HERMES} bg={HERMES_BG} border={HERMES_MID} />
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
          <Badge
            label={(dataset.theme_source === 'ai' ? '\u29E1 ' : '\u2261 ') + dataset.theme_count + ' themes'}
            color={dataset.theme_source === 'ai' ? '#2563eb' : '#e8622a'}
            bg={dataset.theme_source === 'ai' ? '#eff6ff' : '#fff4ef'}
            border={dataset.theme_source === 'ai' ? '#bfdbfe' : '#fbd5c2'}
          />
        ) : null}
      </div>

      {/* 3. Stats row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>&#8803;</span>
          <span style={{ fontWeight: 700, color: '#111827' }}>{dataset.row_count.toLocaleString()}</span>
          <span style={{ color: '#9ca3af' }}>rows</span>
        </div>
        {fieldCount !== null && (
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
        {isStudy && dataset.last_synced_at && (
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
          background: isArchived ? '#f3f4f6' : HERMES,
          border: 'none', cursor: isArchived ? 'not-allowed' : 'pointer',
          transition: 'opacity .15s', fontFamily: 'inherit',
        }}
        onMouseEnter={function(e) { if (!isArchived) (e.currentTarget as HTMLButtonElement).style.opacity = '0.88' }}
        onMouseLeave={function(e) { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}>
        {isArchived ? 'Archived' : 'Analyze in Ana \u2192'}
      </button>

      {/* Click-away for menu */}
      {menuOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={function() { setMenuOpen(false); setConfirmDel(false) }} />}
    </div>
  )
}
