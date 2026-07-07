'use client'

// components/analyze/ManageMembersModal.tsx
// Full add + remove for a collection's members in ONE checklist: current members
// load pre-checked (from the server, so cross-org collections work too), other
// datasets show unchecked. Check to add, uncheck to remove, then Save applies the
// diff via POST /api/collections/[id]/members (add) +
// DELETE /api/collections/[id]?member= (remove). Both recompute the merged
// schema + row_count server-side.

import { useEffect, useState, useCallback } from 'react'
import type { DatasetWithState } from '@/lib/analyzeTypes'

interface Row { id: string; name: string; meta: string; isMember: boolean }
interface Props {
  collectionDatasetId: string
  collectionName: string
  eligibleDatasets: DatasetWithState[]   // non-collection, active datasets (add candidates)
  onClose: () => void
  onChanged: () => void
}

const SOURCE_LABELS: Record<string, string> = {
  study: 'Survey', upload: 'Upload', google_reviews: 'Reviews', reddit: 'Reddit',
  townhall: 'PulseIQ', substack: 'Substack', bot: 'Agent', recording: 'Town Hall',
}

export default function ManageMembersModal({ collectionDatasetId, collectionName, eligibleDatasets, onClose, onChanged }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [originalMembers, setOriginalMembers] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async function () {
    let members: { dataset_id: string; name: string; row_count: number; source: string }[] = []
    try {
      const res = await fetch('/api/collections/' + collectionDatasetId)
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not load members'); }
      members = (data.members || []).map(function (m: { dataset_id: string; name?: string; label?: string; row_count?: number; source?: string }) { return { dataset_id: m.dataset_id, name: (m.name || m.label) as string, row_count: m.row_count || 0, source: m.source || '' } })
    } catch { setError('Could not load members') }

    const memberIds = new Set(members.map(function (m) { return m.dataset_id }))
    // Members first (pre-checked), then any other eligible dataset not already a member.
    const memberRows: Row[] = members.map(function (m) {
      const src = m.source ? (SOURCE_LABELS[m.source] || m.source) + ' · ' : ''
      return { id: m.dataset_id, name: m.name, meta: src + m.row_count.toLocaleString() + ' rows', isMember: true }
    })
    const candidateRows: Row[] = eligibleDatasets
      .filter(function (d) { return !memberIds.has(d.id) })
      .map(function (d) { return { id: d.id, name: d.name, meta: (SOURCE_LABELS[d.source] || d.source) + ' · ' + d.row_count.toLocaleString() + ' rows', isMember: false } })
    setRows([...memberRows, ...candidateRows])
    setOriginalMembers(memberIds)
    setSelected(new Set(memberIds))   // members start checked
  }, [collectionDatasetId, eligibleDatasets])

  useEffect(function () { void load() }, [load])

  function toggle(id: string) {
    setSelected(function (prev) { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  const toAdd = Array.from(selected).filter(function (id) { return !originalMembers.has(id) })
  const toRemove = Array.from(originalMembers).filter(function (id) { return !selected.has(id) })
  const dirty = toAdd.length > 0 || toRemove.length > 0

  async function save() {
    if (!dirty) return
    if (selected.size === 0) { setError('A collection needs at least one member. To remove everything, delete the collection itself.'); return }
    setBusy(true); setError('')
    try {
      if (toAdd.length > 0) {
        const payload = toAdd.map(function (id) { const ds = eligibleDatasets.find(function (d) { return d.id === id }); return { dataset_id: id, label: ds?.name || 'Dataset' } })
        const res = await fetch('/api/collections/' + collectionDatasetId + '/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ members: payload }) })
        if (!res.ok) { const d = await res.json().catch(function () { return {} }); setError(d.error || 'Add failed'); setBusy(false); return }
      }
      for (const id of toRemove) {
        const res = await fetch('/api/collections/' + collectionDatasetId + '?member=' + id, { method: 'DELETE' })
        if (!res.ok) { const d = await res.json().catch(function () { return {} }); setError(d.error || 'Remove failed'); setBusy(false); return }
      }
      onChanged()
      onClose()
    } catch { setError('Network error'); setBusy(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }} onClick={function (e) { e.stopPropagation() }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 }}>Manage members</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Datasets in &ldquo;{collectionName}&rdquo; are checked. Uncheck to remove, check others to add. No data is duplicated; removing a dataset doesn&rsquo;t delete it.</p>
        </div>

        <div style={{ padding: '16px 24px', overflow: 'auto', flex: 1 }}>
          {rows === null && <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(rows || []).map(function (r) {
              const sel = selected.has(r.id)
              return (
                <div key={r.id} onClick={function () { toggle(r.id) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', border: sel ? '1.5px solid #0ea5e9' : '1.5px solid #e5e7eb', background: sel ? '#f0f9ff' : 'white' }}>
                  <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, border: sel ? '2px solid #0ea5e9' : '2px solid #d1d5db', background: sel ? '#0ea5e9' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {sel && <span style={{ color: 'white', fontSize: 12, fontWeight: 900, lineHeight: 1 }}>{'✓'}</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{r.meta}</div>
                  </div>
                  {r.isMember && <span style={{ fontSize: 10, fontWeight: 700, color: '#0369a1', background: '#e0f2fe', borderRadius: 5, padding: '1px 7px', whiteSpace: 'nowrap' }}>In collection</span>}
                </div>
              )
            })}
          </div>
          {error && <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, marginTop: 10 }}>{error}</div>}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>{dirty ? `${toAdd.length} to add · ${toRemove.length} to remove` : 'No changes'}</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 20px', fontSize: 13, fontWeight: 600, color: '#6b7280', background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={function() { void save() }} disabled={busy || !dirty}
              style={{ padding: '9px 24px', fontSize: 13, fontWeight: 700, color: 'white', borderRadius: 10, border: 'none', cursor: busy || !dirty ? 'not-allowed' : 'pointer', background: busy || !dirty ? '#9ca3af' : '#0ea5e9', fontFamily: 'inherit' }}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
