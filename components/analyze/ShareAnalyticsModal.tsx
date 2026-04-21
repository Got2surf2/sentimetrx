'use client'

// components/analyze/ShareAnalyticsModal.tsx
// Modal for creating shared analytics links.
// Shares the current filtered view — filters determine what's visible, nothing more.

import { useState } from 'react'
import { useFilters } from '@/components/analyze/FilterContext'
import { serializeFilters, filterSummary } from '@/lib/filterUtils'

var HERMES = '#E8632A'

interface Props {
  datasetId: string
  datasetName: string
  onClose: () => void
}

export default function ShareAnalyticsModal({ datasetId, datasetName, onClose }: Props) {
  var { filters: activeFilters } = useFilters()
  var [step, setStep] = useState<'configure' | 'created'>('configure')
  var [label, setLabel] = useState('')
  var [expiry, setExpiry] = useState('7d')
  var [creating, setCreating] = useState(false)
  var [createError, setCreateError] = useState('')
  var [shareUrl, setShareUrl] = useState('')
  var [copied, setCopied] = useState(false)

  var hasFilters = Object.keys(activeFilters).length > 0

  // Build readable filter summary
  var aliases: Record<string, string> = {}
  var summary = hasFilters ? filterSummary(activeFilters, aliases) : ''

  async function handleCreate() {
    setCreating(true)
    setCreateError('')
    try {
      var serialized = hasFilters ? serializeFilters(activeFilters) : {}
      var res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'analytics',
          target_id: datasetId,
          expires_in: expiry,
          metadata: {
            dataset_id: datasetId,
            filters: serialized,
            label: label || datasetName + (hasFilters ? ' — Filtered View' : ''),
          },
        }),
      })
      var data = await res.json()
      if (res.ok) {
        setShareUrl(data.url)
        setStep('created')
      } else {
        setCreateError(data.error || 'Failed to create link')
      }
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create link')
    } finally {
      setCreating(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(function() { setCopied(false) }, 2000)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}
      onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%', margin: '0 16px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}
        onClick={function(e) { e.stopPropagation() }}>

        {step === 'configure' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 700, fontSize: 15, color: '#111827', margin: 0 }}>Share Analytics</h3>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#9ca3af', cursor: 'pointer' }}>&times;</button>
            </div>

            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16, margin: '0 0 16px' }}>
              Create a read-only link showing {hasFilters ? 'the currently filtered view' : 'all data'} — no login required.
            </p>

            {/* Report label */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Report Label</label>
              <input
                type="text"
                value={label}
                onChange={function(e) { setLabel(e.target.value) }}
                placeholder={'e.g., ' + datasetName}
                style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const }}
              />
            </div>

            {/* Active filters summary */}
            {hasFilters && (
              <div style={{ marginBottom: 16, padding: 12, background: '#fff4ef', borderRadius: 8, border: '1px solid #fbd5c2' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: HERMES, marginBottom: 4, textTransform: 'uppercase' as const }}>Filters Applied</div>
                <div style={{ fontSize: 12, color: '#374151' }}>{summary}</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>The shared view will only show data matching these filters.</div>
              </div>
            )}

            {!hasFilters && (
              <div style={{ marginBottom: 16, padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>No filters active — the shared view will show all data.</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>Apply filters first if you want to share a specific subset.</div>
              </div>
            )}

            {/* Expiry */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Link Expires In</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ key: '24h', label: '24 hours' }, { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }].map(function(opt) {
                  return (
                    <button key={opt.key} onClick={function() { setExpiry(opt.key) }}
                      style={{
                        fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid',
                        background: expiry === opt.key ? HERMES : 'white',
                        color: expiry === opt.key ? 'white' : '#374151',
                        borderColor: expiry === opt.key ? HERMES : '#e5e7eb',
                      }}>
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {createError && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12, color: '#dc2626' }}>
                {createError}
              </div>
            )}

            {/* Create button */}
            <button onClick={handleCreate} disabled={creating}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer',
                background: HERMES, color: 'white',
                opacity: creating ? 0.6 : 1,
              }}>
              {creating ? 'Creating...' : 'Create Analytics Link'}
            </button>
          </>
        )}

        {step === 'created' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 700, fontSize: 15, color: '#111827', margin: 0 }}>Link Created</h3>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#9ca3af', cursor: 'pointer' }}>&times;</button>
            </div>
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12, margin: '0 0 12px' }}>
              Anyone with this link can view the {hasFilters ? 'filtered ' : ''}analytics. No login required.
            </p>
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 12, wordBreak: 'break-all' as const, fontSize: 12, color: '#374151', marginBottom: 12, border: '1px solid #e5e7eb' }}>
              {shareUrl}
            </div>
            <button onClick={handleCopy}
              style={{ width: '100%', padding: '10px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', background: HERMES, color: 'white' }}>
              {copied ? '\u2713 Copied!' : 'Copy Link'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
