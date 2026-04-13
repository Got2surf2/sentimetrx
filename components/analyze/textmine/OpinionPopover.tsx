'use client'

// components/analyze/textmine/OpinionPopover.tsx
// Modal showing opinion words associated with a clicked aspect word

import { useMemo } from 'react'
import { extractOpinions, type OpinionResult } from '@/lib/opinionMining'

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
  onViewComments?: (word: string) => void
}

export default function OpinionPopover({ word, rows, fields, onClose, onViewComments }: Props) {
  var result = useMemo(function() {
    return extractOpinions(rows, fields, word)
  }, [rows, fields, word])

  var content: React.ReactNode

  if (!result.opinions.length) {
    content = (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <p style={{ fontSize: 13, color: '#9ca3af' }}>No opinion words found near "{word}" in the data.</p>
        <p style={{ fontSize: 11, color: '#d1d5db', marginTop: 4 }}>{result.totalMentions} mentions found, but no adjectives/descriptors nearby.</p>
      </div>
    )
  } else {
    var total = result.sentimentSummary.positive + result.sentimentSummary.negative + result.sentimentSummary.neutral
    var posPct = total > 0 ? Math.round(result.sentimentSummary.positive / total * 100) : 0
    var negPct = total > 0 ? Math.round(result.sentimentSummary.negative / total * 100) : 0

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
        <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {result.opinions.slice(0, 20).map(function(op) {
            var sc = SENT_COLORS[op.sentiment]
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, padding: '24px 28px', boxShadow: '0 24px 64px rgba(0,0,0,.2)', maxWidth: 520, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={function(e) { e.stopPropagation() }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 }}>
              {result.mode === 'nouns' ? 'What people call "' + word + '"' : 'Opinions about "' + word + '"'}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{'\u00D7'}</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {content}
        </div>

        {/* Footer */}
        {onViewComments && result.opinions.length > 0 && (
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 12, display: 'flex', gap: 8 }}>
            <button onClick={function() { onViewComments(word) }}
              style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, cursor: 'pointer' }}>
              View all "{word}" comments
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
}
