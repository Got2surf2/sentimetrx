'use client'

// components/analyze/textmine/OpinionPopover.tsx
// Modal showing opinion words associated with a clicked aspect word.
// Two modes:
//   - 'opinions' (default): per-noun clusters with sentiment + sample sentences
//   - 'comments': flat list of every comment containing the aspect word, with
//                 the word highlighted. Toggled by the "View all X comments"
//                 footer button so the user never has to leave this modal.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { extractOpinions } from '@/lib/opinionMining'

const SENT_COLORS = {
  positive: { text: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
  negative: { text: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  neutral:  { text: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
}

interface Props {
  word: string
  rows: Record<string, unknown>[]
  fields: string | string[]
  onClose: () => void
}

// Highlight every case-insensitive occurrence of `word` in `text`.
function highlightWord(text: string, word: string): React.ReactNode[] {
  if (!word) return [text]
  const re = new RegExp('(' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi')
  const parts = text.split(re)
  return parts.map(function(p, i) {
    if (p.toLowerCase() === word.toLowerCase()) {
      return <mark key={i} style={{ background: '#fef3c7', color: '#92400e', padding: '0 2px', borderRadius: 2, fontWeight: 600 }}>{p}</mark>
    }
    return <span key={i}>{p}</span>
  })
}

export default function OpinionPopover({ word, rows, fields, onClose }: Props) {
  const [view, setView] = useState<'opinions' | 'comments'>('opinions')

  const fieldArr = Array.isArray(fields) ? fields : [fields]

  const result = useMemo(function() {
    return extractOpinions(rows, fields, word)
  }, [rows, fields, word])

  // Pre-compute the matching comments for the comments view (only when needed)
  const matchingComments = useMemo(function() {
    if (view !== 'comments') return []
    const target = word.toLowerCase()
    const out: string[] = []
    for (const row of rows) {
      for (const f of fieldArr) {
        const t = String(row[f] || '').trim()
        if (t && t.toLowerCase().includes(target)) {
          out.push(t)
          break // one entry per row max, even if multiple fields match
        }
      }
    }
    return out
  }, [view, rows, fieldArr, word])

  let content: React.ReactNode

  if (view === 'comments') {
    content = matchingComments.length === 0 ? (
      <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>
        No comments found containing "{word}".
      </p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>
          {matchingComments.length.toLocaleString()} comment{matchingComments.length !== 1 ? 's' : ''} containing "{word}"
        </div>
        {matchingComments.map(function(t, i) {
          return (
            <div key={i} style={{ padding: '10px 12px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.55, whiteSpace: 'pre-wrap' as const }}>
                {highlightWord(t, word)}
              </div>
            </div>
          )
        })}
      </div>
    )
  } else if (!result.opinions.length) {
    content = (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <p style={{ fontSize: 13, color: '#9ca3af' }}>No opinion words found near "{word}" in the data.</p>
        <p style={{ fontSize: 11, color: '#d1d5db', marginTop: 4 }}>{result.totalMentions} mentions found, but no adjectives/descriptors nearby.</p>
      </div>
    )
  } else {
    const total = result.sentimentSummary.positive + result.sentimentSummary.negative + result.sentimentSummary.neutral
    const posPct = total > 0 ? Math.round(result.sentimentSummary.positive / total * 100) : 0
    const negPct = total > 0 ? Math.round(result.sentimentSummary.negative / total * 100) : 0

    content = (
      <>
        {/* Sentiment bar */}
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
          {posPct > 0 && <div style={{ width: posPct + '%', background: '#059669', transition: 'width .3s' }} />}
          {negPct > 0 && <div style={{ width: negPct + '%', background: '#dc2626', transition: 'width .3s' }} />}
          <div style={{ flex: 1, background: '#e5e7eb' }} />
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 16, color: '#6b7280' }}>
          <span><span style={{ color: '#059669', fontWeight: 700 }}>{posPct}%</span> positive</span>
          <span><span style={{ color: '#dc2626', fontWeight: 700 }}>{negPct}%</span> negative</span>
          <span style={{ marginLeft: 'auto', color: '#9ca3af' }}>{result.totalMentions.toLocaleString()} mentions</span>
        </div>

        {/* Opinion list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {result.opinions.slice(0, 20).map(function(op) {
            const sc = SENT_COLORS[op.sentiment]
            return (
              <div key={op.opinion} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 10, background: sc.bg, border: '1px solid ' + sc.border }}>
                <div style={{ minWidth: 90 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: sc.text }}>{op.opinion}</span>
                  <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>{op.count}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {op.samples.slice(0, 2).map(function(s, i) {
                    return <p key={i} style={{ fontSize: 11, color: '#6b7280', margin: '0 0 2px', lineHeight: 1.4 }}>"{s}"</p>
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </>
    )
  }

  // Render via portal to escape any ancestor transforms that break position:fixed
  const modal = (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, padding: '24px 28px', boxShadow: '0 24px 64px rgba(0,0,0,.2)', maxWidth: 520, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={function(e) { e.stopPropagation() }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 }}>
              {view === 'comments'
                ? 'Comments mentioning "' + word + '"'
                : (result.mode === 'nouns' ? 'What people call "' + word + '"' : 'Opinions about "' + word + '"')}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{'×'}</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {content}
        </div>

        {/* Footer — toggle between opinions and comments view */}
        {result.opinions.length > 0 && (
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 12, display: 'flex', gap: 8 }}>
            <button onClick={function() { setView(view === 'opinions' ? 'comments' : 'opinions') }}
              style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, cursor: 'pointer' }}>
              {view === 'opinions' ? 'View all "' + word + '" comments' : '← Back to opinion clusters'}
            </button>
            <button onClick={onClose}
              style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, color: '#6b7280', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document !== 'undefined') {
    return createPortal(modal, document.body)
  }
  return modal
}
