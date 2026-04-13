'use client'

// components/analyze/textmine/OpinionPopover.tsx
// Shows opinion words associated with a clicked aspect word

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

  if (!result.opinions.length) {
    return (
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,.12)', maxWidth: 400, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>"{word}"</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#9ca3af', lineHeight: 1 }}>{'\u00D7'}</button>
        </div>
        <p style={{ fontSize: 12, color: '#9ca3af' }}>No opinion words found near "{word}" in the data.</p>
      </div>
    )
  }

  var total = result.sentimentSummary.positive + result.sentimentSummary.negative + result.sentimentSummary.neutral
  var posPct = total > 0 ? Math.round(result.sentimentSummary.positive / total * 100) : 0
  var negPct = total > 0 ? Math.round(result.sentimentSummary.negative / total * 100) : 0

  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,.12)', maxWidth: 420, width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>Opinions about "{word}"</span>
          <p style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0 0' }}>
            {result.totalMentions.toLocaleString()} mentions
          </p>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#9ca3af', lineHeight: 1 }}>{'\u00D7'}</button>
      </div>

      {/* Sentiment bar */}
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
        {posPct > 0 && <div style={{ width: posPct + '%', background: '#059669', transition: 'width .3s' }} />}
        {negPct > 0 && <div style={{ width: negPct + '%', background: '#dc2626', transition: 'width .3s' }} />}
        <div style={{ flex: 1, background: '#e5e7eb' }} />
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 10, marginBottom: 12, color: '#6b7280' }}>
        <span><span style={{ color: '#059669', fontWeight: 700 }}>{posPct}%</span> positive</span>
        <span><span style={{ color: '#dc2626', fontWeight: 700 }}>{negPct}%</span> negative</span>
      </div>

      {/* Opinion list */}
      <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {result.opinions.slice(0, 20).map(function(op) {
          var sc = SENT_COLORS[op.sentiment]
          return (
            <div key={op.opinion} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 8, background: sc.bg, border: '1px solid ' + sc.border }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: sc.text, minWidth: 80 }}>{op.opinion}</span>
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>{op.count}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {op.samples[0] && (
                  <p style={{ fontSize: 10, color: '#6b7280', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={op.samples[0]}>
                    "{op.samples[0]}"
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Actions */}
      {onViewComments && (
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10, marginTop: 10, display: 'flex', gap: 8 }}>
          <button onClick={function() { onViewComments(word) }}
            style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, cursor: 'pointer' }}>
            View all "{word}" comments
          </button>
        </div>
      )}
    </div>
  )
}
