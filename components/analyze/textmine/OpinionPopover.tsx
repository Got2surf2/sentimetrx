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
import { filterCooccurringRows } from '@/lib/collocations'
import ContextCloud from './ContextCloud'
import FrequencyChart, { detectDateField, frequencyBuckets } from './FrequencyChart'
import TermInsights, { type InsightFilter } from './TermInsights'
import { ratingPalette, ratingRange } from './ratingColor'

const SENT_COLORS = {
  positive: { text: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
  negative: { text: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  neutral:  { text: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
}

interface Props {
  word: string
  rows: Record<string, unknown>[]
  fields: string | string[]
  /** Optional numeric field (rating / NPS / score) — used to color comment cards. */
  ratingField?: string | null
  /** Field names hidden by the schema (type='ignore'|'id' or hidden=true).
   *  Excluded from Insights candidate detection. */
  hiddenFields?: string[]
  onClose: () => void
}

// Highlight every case-insensitive occurrence of any of `words` in `text`.
// The aspect word is highlighted amber; a context word drilled in from the
// Context tab is highlighted blue so the pair reads apart at a glance.
function highlightWords(text: string, words: string[]): React.ReactNode[] {
  const list = words.filter(Boolean)
  if (list.length === 0) return [text]
  const escaped = list.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp('(' + escaped.join('|') + ')', 'gi')
  const parts = text.split(re)
  const primary = list[0].toLowerCase()
  return parts.map(function(p, i) {
    const lower = p.toLowerCase()
    if (lower === primary) {
      return <mark key={i} style={{ background: '#fef3c7', color: '#92400e', padding: '0 2px', borderRadius: 2, fontWeight: 600 }}>{p}</mark>
    }
    if (list.some(w => w.toLowerCase() === lower)) {
      return <mark key={i} style={{ background: '#dbeafe', color: '#1d4ed8', padding: '0 2px', borderRadius: 2, fontWeight: 600 }}>{p}</mark>
    }
    return <span key={i}>{p}</span>
  })
}

export default function OpinionPopover({ word, rows, fields, ratingField, hiddenFields, onClose }: Props) {
  const [view, setView] = useState<'opinions' | 'context' | 'comments' | 'insights'>('opinions')
  const [insightFilter, setInsightFilter] = useState<InsightFilter | null>(null)
  // Context word drilled in from the Context tab — narrows the comments list
  // to rows where it shares a sentence with the aspect word.
  const [contextWord, setContextWord] = useState<string | null>(null)

  // Memoized: it feeds the Context tab's corpus-wide tokenization, which is far
  // too expensive to redo on every render.
  const fieldArr = useMemo(() => (Array.isArray(fields) ? fields : [fields]), [fields])
  const contextTargets = useMemo(() => [word], [word])
  const insightsExclude = useMemo(
    () => Array.from(new Set([...fieldArr, ...(hiddenFields || [])])),
    [fieldArr, hiddenFields],
  )

  const result = useMemo(function() {
    return extractOpinions(rows, fields, word)
  }, [rows, fields, word])

  // Frequency time-series sparkline (legacy Ana parity).
  // Auto-detects a date field on the rows. Bucket granularity scales with the
  // data span — daily for short windows, monthly/quarterly for multi-year data.
  // Renders nothing when no date is available.
  const dateField = useMemo(() => detectDateField(rows), [rows])
  const freq = useMemo(() => {
    if (!dateField) return { buckets: [], granularity: null }
    return frequencyBuckets(rows, fieldArr, [word], dateField)
  }, [rows, fieldArr, word, dateField])

  // CANONICAL denominator: rows with non-empty text in ANY analyzed field.
  // Used identically in themeUtils.computeThemeStats, WordCloud, and
  // ThemePopover so every percentage on the analytics page stays consistent.
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

  // Pre-compute the matching comments for the comments view (only when needed).
  // Each entry carries the rating value so cards can be color-coded.
  const matchingComments = useMemo(function() {
    if (view !== 'comments') return [] as { text: string; rating: unknown }[]
    const target = word.toLowerCase()
    const out: { text: string; rating: unknown }[] = []
    // A context word narrows to same-sentence co-occurrence, which is the same
    // rule that produced the count on its chip — so the two always agree.
    const pool = contextWord ? filterCooccurringRows(rows, fieldArr, contextTargets, contextWord) : rows
    for (const row of pool) {
      if (insightFilter) {
        const rv = row[insightFilter.field]
        if (rv == null || String(rv).trim() !== insightFilter.value) continue
      }
      // With a context word active, show the field carrying BOTH terms —
      // otherwise a multi-field row could display the one field that happens
      // to mention the aspect word without the context word.
      let picked: string | null = null
      let fallback: string | null = null
      for (const f of fieldArr) {
        const t = String(row[f] || '').trim()
        if (!t || !t.toLowerCase().includes(target)) continue
        if (!fallback) fallback = t
        if (!contextWord || t.toLowerCase().includes(contextWord.toLowerCase())) { picked = t; break }
      }
      const text = picked || fallback
      if (text) out.push({ text, rating: ratingField ? row[ratingField] : null })
    }
    return out
  }, [view, rows, fieldArr, word, insightFilter, ratingField, contextWord, contextTargets])

  const ratingScale = useMemo(() => ratingRange(rows, ratingField || null), [rows, ratingField])

  const handleDrillDown = (filter: InsightFilter) => {
    setInsightFilter(filter)
    setView('comments')
  }

  let content: React.ReactNode

  if (view === 'insights') {
    content = <TermInsights rows={rows} textFields={insightsExclude} targets={[word]} termLabel={word} onDrillDown={handleDrillDown} />
  } else if (view === 'context') {
    content = (
      <ContextCloud
        rows={rows}
        fields={fieldArr}
        targets={contextTargets}
        termLabel={word}
        onSelect={function(w) { setContextWord(w); setView('comments') }}
      />
    )
  } else if (view === 'comments') {
    const contextChip = contextWord && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Context</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
          padding: '3px 8px', borderRadius: 12, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
        }}>
          {word} + {contextWord}
          <button onClick={() => setContextWord(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 14, lineHeight: 1 }}
            title="Clear context word">×</button>
        </span>
      </div>
    )
    const filterChip = insightFilter && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Filter</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
          padding: '3px 8px', borderRadius: 12,
          background: insightFilter.direction === 'more' ? '#ecfdf5' : '#fef2f2',
          color: insightFilter.direction === 'more' ? '#059669' : '#dc2626',
          border: '1px solid ' + (insightFilter.direction === 'more' ? '#a7f3d0' : '#fecaca'),
        }}>
          {insightFilter.field === '_collection_label' ? 'Collection' : insightFilter.field} = {insightFilter.value}
          <button onClick={() => setInsightFilter(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 14, lineHeight: 1 }}
            title="Clear filter">×</button>
        </span>
      </div>
    )
    content = matchingComments.length === 0 ? (
      <>
        {contextChip}
        {filterChip}
        <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>
          No comments {insightFilter ? 'match this filter' : 'found containing "' + word + '"'}.
        </p>
      </>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {contextChip}
        {filterChip}
        <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>
          {matchingComments.length.toLocaleString()} comment{matchingComments.length !== 1 ? 's' : ''} containing {contextWord ? '"' + word + '" + "' + contextWord + '"' : '"' + word + '"'}{insightFilter ? ' · ' + (insightFilter.field === '_collection_label' ? 'Collection' : insightFilter.field) + '=' + insightFilter.value : ''}
        </div>
        {matchingComments.map(function(c, i) {
          const pal = ratingPalette(c.rating, ratingScale)
          const ratingDisplay = ratingScale && c.rating != null && !isNaN(parseFloat(String(c.rating))) ? String(c.rating) : null
          return (
            <div key={i} style={{ padding: '10px 12px', background: pal.bg, borderRadius: 8, border: '1px solid ' + pal.border }}>
              <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.55, whiteSpace: 'pre-wrap' as const }}>
                {highlightWords(c.text, contextWord ? [word, contextWord] : [word])}
              </div>
              {ratingDisplay && (
                <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, marginTop: 4 }}>★ {ratingDisplay}</div>
              )}
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
          <span style={{ marginLeft: 'auto', color: '#9ca3af' }}>
            {result.totalMentions.toLocaleString()} mentions
            {totalCommentsWithText > 0 && (
              <span style={{ marginLeft: 4, color: '#6b7280', fontWeight: 600 }}>
                · {Math.round((result.totalMentions / totalCommentsWithText) * 100)}% of comments
              </span>
            )}
          </span>
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
                : view === 'context'
                  ? 'What "' + word + '" is talked about with'
                  : (result.mode === 'nouns' ? 'What people call "' + word + '"' : 'Opinions about "' + word + '"')}
              {totalCommentsWithText > 0 && result.totalMentions > 0 && (
                <span style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', marginLeft: 8 }}>
                  ({Math.round((result.totalMentions / totalCommentsWithText) * 100)}%)
                </span>
              )}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{'×'}</button>
        </div>

        {/* Tabs — top of body. Close X is in the header, not here. */}
        {(result.opinions.length > 0 || result.totalMentions > 0) && (
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 14 }}>
            {(['opinions', 'context', 'comments', 'insights'] as const).map(v => {
              const labels = { opinions: 'Opinions', context: 'Context', comments: 'Comments', insights: '✨ Insights' } as const
              const active = view === v
              return (
                <button key={v} onClick={() => setView(v)}
                  style={{
                    padding: '10px 18px', fontSize: 13, fontWeight: 700,
                    color: active ? '#2563eb' : '#6b7280',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '2px solid ' + (active ? '#2563eb' : 'transparent'),
                    marginBottom: -1,
                    cursor: 'pointer',
                  }}>
                  {labels[v]}
                </button>
              )
            })}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {/* Frequency time-series sparkline at the very top — visible across both views */}
          <FrequencyChart buckets={freq.buckets} granularity={freq.granularity} />
          {content}
        </div>
      </div>
    </div>
  )

  if (typeof document !== 'undefined') {
    return createPortal(modal, document.body)
  }
  return modal
}
