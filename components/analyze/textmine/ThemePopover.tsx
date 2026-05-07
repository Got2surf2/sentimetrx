'use client'

// components/analyze/textmine/ThemePopover.tsx
// Click-the-theme-title modal — analogue of OpinionPopover but for an entire
// theme (not a single word). Shows:
//   - Theme name + description
//   - % of comments matching ANY of the theme's keywords + total mentions
//   - Frequency-by-time sparkline (granularity auto-scales with data range)
//   - Sample comments with the matching keywords highlighted

import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import FrequencyChart, { detectDateField, frequencyBuckets } from './FrequencyChart'

interface ThemeLike {
  id?: string
  name: string
  description?: string
  count?: number
  keywords?: string[]
}

interface Props {
  theme: ThemeLike
  rows: Record<string, unknown>[]
  fields: string | string[]
  /** Bar color (theme palette colour from the parent). */
  color?: string
  onClose: () => void
}

function highlightKeywords(text: string, keywords: string[]): React.ReactNode[] {
  const kw = keywords.filter(Boolean).map(k => k.toLowerCase())
  if (kw.length === 0) return [text]
  const escaped = kw.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp('(' + escaped.join('|') + ')', 'gi')
  const parts = text.split(re)
  return parts.map((p, i) => {
    if (kw.includes(p.toLowerCase())) {
      return <mark key={i} style={{ background: '#fef3c7', color: '#92400e', padding: '0 2px', borderRadius: 2, fontWeight: 600 }}>{p}</mark>
    }
    return <span key={i}>{p}</span>
  })
}

export default function ThemePopover({ theme, rows, fields, color, onClose }: Props) {
  const fieldArr = Array.isArray(fields) ? fields : [fields]
  const keywords = useMemo(() => (theme.keywords || []).filter(Boolean), [theme.keywords])
  const dateField = useMemo(() => detectDateField(rows), [rows])

  // Find rows that match ANY theme keyword in any of the analyzed text fields.
  const matchedRows = useMemo(() => {
    if (keywords.length === 0) return [] as Record<string, unknown>[]
    const lowered = keywords.map(k => k.toLowerCase())
    const out: Record<string, unknown>[] = []
    for (const row of rows) {
      let hit = false
      for (const f of fieldArr) {
        const t = String(row[f] || '').toLowerCase()
        for (const target of lowered) {
          if (t.includes(target)) { hit = true; break }
        }
        if (hit) break
      }
      if (hit) out.push(row)
    }
    return out
  }, [rows, fieldArr, keywords])

  // Same denominator as OpinionPopover: rows with non-empty text in any field.
  const totalCommentsWithText = useMemo(() => {
    let n = 0
    for (const row of rows) {
      for (const f of fieldArr) {
        const v = row[f]
        if (typeof v === 'string' && v.trim()) { n++; break }
      }
    }
    return n
  }, [rows, fieldArr])

  const freq = useMemo(() => {
    if (!dateField || keywords.length === 0) return { buckets: [], granularity: null }
    return frequencyBuckets(rows, fieldArr, keywords, dateField)
  }, [rows, fieldArr, keywords, dateField])

  const total = matchedRows.length
  const pct = totalCommentsWithText > 0 ? (total / totalCommentsWithText) * 100 : 0

  // Sample 25 longest comments first (more informative than the shortest).
  const samples = useMemo(() => {
    const texts: string[] = []
    for (const row of matchedRows) {
      for (const f of fieldArr) {
        const t = String(row[f] || '').trim()
        if (t) { texts.push(t); break }
      }
    }
    return texts.sort((a, b) => b.length - a.length).slice(0, 25)
  }, [matchedRows, fieldArr])

  const modal = (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, padding: '24px 28px', boxShadow: '0 24px 64px rgba(0,0,0,.2)', maxWidth: 560, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: color || '#111827', margin: 0, lineHeight: 1.3 }}>
              {theme.name}
            </h3>
            {theme.description && (
              <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0', lineHeight: 1.45 }}>{theme.description}</p>
            )}
          </div>
          <button onClick={onClose} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
        </div>

        {/* Mentions + % */}
        <div style={{ display: 'flex', gap: 12, fontSize: 12, marginBottom: 14, color: '#6b7280', flexWrap: 'wrap' }}>
          <span style={{ color: '#111827', fontWeight: 700 }}>{total.toLocaleString()} mentions</span>
          {totalCommentsWithText > 0 && (
            <span style={{ color: color || '#374151', fontWeight: 700 }}>· {pct.toFixed(1)}% of comments</span>
          )}
          {keywords.length > 0 && (
            <span style={{ marginLeft: 'auto', color: '#9ca3af' }}>{keywords.length} keyword{keywords.length === 1 ? '' : 's'}</span>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <FrequencyChart buckets={freq.buckets} granularity={freq.granularity} color={color} />

          {/* Keywords */}
          {keywords.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 4 }}>
                Theme keywords
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {keywords.map(k => (
                  <span key={k} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: '#f3f4f6', color: '#374151' }}>{k}</span>
                ))}
              </div>
            </div>
          )}

          {/* Sample comments */}
          {samples.length > 0 ? (
            <div>
              <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 6 }}>
                Sample comments ({samples.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {samples.map((t, i) => (
                  <div key={i} style={{ padding: '10px 12px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.55, whiteSpace: 'pre-wrap' as const }}>
                      {highlightKeywords(t, keywords)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>
              No comments match this theme&apos;s keywords in the current view.
            </p>
          )}
        </div>

        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, color: '#6b7280', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof document !== 'undefined') return createPortal(modal, document.body)
  return modal
}
