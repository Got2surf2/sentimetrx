'use client'

// components/analyze/NewCollectionModal.tsx
// Modal for creating a new Collection — pick 2+ datasets and label each one.

import { useState } from 'react'
import type { DatasetWithState } from '@/lib/analyzeTypes'

interface Props {
  datasets:  DatasetWithState[]
  onClose:   () => void
  onCreated: (ds: DatasetWithState) => void
}

const SOURCE_LABELS: Record<string, string> = {
  study: 'Sarina', upload: 'Upload', google_reviews: 'Google Reviews',
  reddit: 'Reddit', townhall: 'Town Hall', substack: 'Substack',
}

export default function NewCollectionModal({ datasets, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [members, setMembers] = useState<{ dataset_id: string; label: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleDataset(id: string) {
    setMembers(function(prev) {
      var exists = prev.find(function(m) { return m.dataset_id === id })
      if (exists) return prev.filter(function(m) { return m.dataset_id !== id })
      var ds = datasets.find(function(d) { return d.id === id })
      return [...prev, { dataset_id: id, label: ds?.name || '' }]
    })
  }

  function updateLabel(id: string, label: string) {
    setMembers(function(prev) {
      return prev.map(function(m) { return m.dataset_id === id ? { ...m, label: label } : m })
    })
  }

  async function handleCreate() {
    if (!name.trim()) { setError('Give your collection a name'); return }
    if (members.length < 2) { setError('Select at least 2 datasets'); return }
    var emptyLabel = members.find(function(m) { return !m.label.trim() })
    if (emptyLabel) { setError('Every dataset needs a label'); return }

    setSaving(true)
    setError('')

    try {
      var res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), members: members }),
      })
      var data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to create collection'); setSaving(false); return }

      // Trigger compute for the new collection dataset
      fetch('/api/datasets/' + data.id + '/compute', { method: 'POST' }).catch(function() {})

      // Build a DatasetWithState for immediate local display
      var totalRows = members.reduce(function(sum, m) {
        var ds = datasets.find(function(d) { return d.id === m.dataset_id })
        return sum + (ds?.row_count || 0)
      }, 0)

      onCreated({
        id: data.id,
        name: name.trim(),
        description: 'Collection of ' + members.length + ' datasets',
        source: 'collection',
        study_id: null,
        org_id: datasets[0]?.org_id || '',
        client_id: null,
        created_by: '',
        ana_library: null,
        visibility: 'private',
        status: 'active',
        row_count: totalRows,
        last_synced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        creator_name: undefined,
        org_name: datasets[0]?.org_name,
      })
      onClose()
    } catch {
      setError('Network error')
      setSaving(false)
    }
  }

  var selected = new Set(members.map(function(m) { return m.dataset_id }))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}
        onClick={function(e) { e.stopPropagation() }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 }}>New Collection</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            Combine datasets for cross-dataset analytics. No data is duplicated.
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 24px', overflow: 'auto', flex: 1 }}>
          {/* Name */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
              Collection Name
            </label>
            <input
              value={name}
              onChange={function(e) { setName(e.target.value) }}
              placeholder="e.g. Fast Food Brands Q1 2026"
              autoFocus
              style={{ width: '100%', padding: '10px 14px', fontSize: 14, border: '1.5px solid #d1d5db', borderRadius: 10, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              onFocus={function(e) { (e.target as HTMLInputElement).style.borderColor = '#0ea5e9' }}
              onBlur={function(e) { (e.target as HTMLInputElement).style.borderColor = '#d1d5db' }}
            />
          </div>

          {/* Dataset list */}
          <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 8 }}>
            Select Datasets ({members.length} selected)
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {datasets.map(function(ds) {
              var isSelected = selected.has(ds.id)
              return (
                <div key={ds.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    borderRadius: 10, cursor: 'pointer', transition: 'all .1s',
                    border: isSelected ? '1.5px solid #0ea5e9' : '1.5px solid #e5e7eb',
                    background: isSelected ? '#f0f9ff' : 'white',
                  }}
                  onClick={function() { toggleDataset(ds.id) }}>
                  {/* Checkbox */}
                  <div style={{
                    width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                    border: isSelected ? '2px solid #0ea5e9' : '2px solid #d1d5db',
                    background: isSelected ? '#0ea5e9' : 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && <span style={{ color: 'white', fontSize: 12, fontWeight: 900, lineHeight: 1 }}>{'\u2713'}</span>}
                  </div>
                  {/* Dataset info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ds.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>
                      {SOURCE_LABELS[ds.source] || ds.source} · {ds.row_count.toLocaleString()} rows
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Labels for selected */}
          {members.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 8 }}>
                Labels (used for comparison grouping)
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {members.map(function(m) {
                  var ds = datasets.find(function(d) { return d.id === m.dataset_id })
                  return (
                    <div key={m.dataset_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, color: '#6b7280', width: 120, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ds?.name}
                      </span>
                      <input
                        value={m.label}
                        onChange={function(e) { updateLabel(m.dataset_id, e.target.value) }}
                        placeholder="Label for comparison"
                        onClick={function(e) { e.stopPropagation() }}
                        style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: '1.5px solid #d1d5db', borderRadius: 8, outline: 'none', fontFamily: 'inherit', minWidth: 0 }}
                        onFocus={function(e) { (e.target as HTMLInputElement).style.borderColor = '#0ea5e9' }}
                        onBlur={function(e) { (e.target as HTMLInputElement).style.borderColor = '#d1d5db' }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, marginTop: 8 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose}
            style={{ padding: '9px 20px', fontSize: 13, fontWeight: 600, color: '#6b7280', background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button onClick={handleCreate}
            disabled={saving || members.length < 2 || !name.trim()}
            style={{
              padding: '9px 24px', fontSize: 13, fontWeight: 700, color: 'white', borderRadius: 10,
              border: 'none', cursor: saving || members.length < 2 || !name.trim() ? 'not-allowed' : 'pointer',
              background: saving || members.length < 2 || !name.trim() ? '#9ca3af' : '#0ea5e9',
              fontFamily: 'inherit', transition: 'background .15s',
            }}>
            {saving ? 'Creating...' : 'Create Collection'}
          </button>
        </div>
      </div>
    </div>
  )
}
