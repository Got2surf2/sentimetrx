'use client'
// components/analyze/textmine/CommentsPanel.tsx
// Displays verbatim responses matching a theme.
// Keyword highlights, meta fields, optional AI summary via user API key.
// onBack navigates back to themes list.

import { useState, useMemo } from 'react'
import {
  Theme, THEME_PALETTE, commentMatchesTheme, highlightKeywords,
  evenSample, sentColor, sentBg,
} from '@/lib/themeUtils'

const T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', greenBg: '#f0fdf4', greenMid: '#bbf7d0',
  red: '#dc2626', redBg: '#fef2f2',
  amber: '#d97706', amberBg: '#fffbeb', amberMid: '#fde68a',
  blue: '#2563eb', blueBg: '#eff6ff',
}

interface SchemaField {
  field: string
  type: string
  sqt?: string | null
  scoreField?: boolean
  label?: string
  min?: number
  max?: number
}

interface Props {
  theme: Theme
  allThemes: Theme[]
  parsedData: Record<string, unknown>[]
  activeField: string
  activeFields?: string[]
  catFields: string[]
  themeColors: Record<number, typeof THEME_PALETTE[0]>
  onBack: () => void
  ignoredFields?: string[]
  schema?: SchemaField[]
  apiKey?: string
  columnAliases?: Record<string, string>
  datasetId: string
}

interface CommentRow {
  text: string
  meta: Record<string, string>
  fieldName?: string
}

function Spinner() {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {[0, 1, 2].map(function(i) {
        return (
          <span
            key={i}
            style={{
              width: 5, height: 5, borderRadius: '50%', background: T.accent,
              display: 'inline-block', animation: 'pulse 1.1s ease infinite',
              animationDelay: i * 0.18 + 's',
            }}
          />
        )
      })}
    </span>
  )
}

function CommentCard({ row, theme, pal, schema, aliases, ignoredFields, activeFields: cardActiveFields }: {
  row: CommentRow
  theme: Theme
  pal: typeof THEME_PALETTE[0]
  schema?: SchemaField[]
  aliases: Record<string, string>
  ignoredFields: string[]
  activeFields?: string[]
}) {
  var [expanded, setExpanded] = useState(false)
  var segments = highlightKeywords(row.text, theme.keywords || [])
  var ignoredSet = new Set(ignoredFields)
  var metaCols = schema
    ? schema.filter(function(f) {
        return f.type !== 'open-ended' && f.type !== 'id' && f.type !== 'ignore' && !ignoredSet.has(f.field)
      })
    : []

  var metaEntries = metaCols
    .filter(function(f) { return row.meta[f.field] != null && String(row.meta[f.field]).trim() !== '' })

  // Smart metadata: show field name if 2+ active fields, and rating/scoring fields with color
  var showFieldName = cardActiveFields && cardActiveFields.length > 1 && row.fieldName
  var ratingFields = metaEntries.filter(function(f) {
    return f.sqt === 'rating' || f.sqt === 'nps' || f.sqt === 'likert' || f.scoreField === true
  })
  var otherFields = metaEntries.filter(function(f) {
    return f.sqt !== 'rating' && f.sqt !== 'nps' && f.sqt !== 'likert' && f.scoreField !== true
  })

  // Red-green color scale for numeric scores
  var scoreColor = function(val: unknown, f: SchemaField): string {
    var n = parseFloat(String(val))
    if (isNaN(n)) return T.textMid
    var min = f.min != null ? f.min : 1
    var max = f.max != null ? f.max : (f.sqt === 'nps' ? 10 : 5)
    var pct = (n - min) / (max - min || 1)
    // Red (0) → Amber (0.5) → Green (1)
    if (pct <= 0.5) {
      var r = 220, g = Math.round(80 + pct * 2 * 120)
      return 'rgb(' + r + ',' + g + ',40)'
    }
    var r2 = Math.round(220 - (pct - 0.5) * 2 * 180), g2 = Math.round(160 + (pct - 0.5) * 2 * 40)
    return 'rgb(' + r2 + ',' + g2 + ',40)'
  }

  var hasMore = otherFields.length > 0

  return (
    <div style={{
      background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10,
      padding: '12px 14px', marginBottom: 8, borderLeft: '3px solid ' + pal.border,
      boxShadow: '0 1px 4px rgba(0,0,0,.04)',
    }}>
      {/* Theme badge + field name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border }}>
          {theme.name}
        </span>
        {showFieldName && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: '#f0f9ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>
            {aliases[row.fieldName!] || row.fieldName}
          </span>
        )}
      </div>

      {/* Comment text with highlights */}
      <div style={{ fontSize: 13, color: T.text, lineHeight: 1.75, marginBottom: (ratingFields.length > 0 || hasMore) ? 8 : 0 }}>
        {segments.map(function(seg, i) {
          if (seg.matched) {
            return (
              <mark key={i} style={{ background: pal.light, color: pal.text, borderRadius: 3, padding: '1px 3px', borderBottom: '2px solid ' + pal.border, fontWeight: 600 }}>
                {seg.text}
              </mark>
            )
          }
          return <span key={i}>{seg.text}</span>
        })}
      </div>

      {/* Smart metadata: rating scores with color scale */}
      {ratingFields.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 2 }}>
          {ratingFields.map(function(f) {
            var val = row.meta[f.field]
            var color = scoreColor(val, f)
            return (
              <span key={f.field} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: color + '15', color: color, border: '1px solid ' + color + '40', display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 700 }}>
                <span style={{ opacity: 0.7, fontWeight: 500 }}>{aliases[f.field] || f.field}:</span> {String(val)}
              </span>
            )
          })}
          {/* Expand button */}
          {hasMore && (
            <button onClick={function() { setExpanded(function(v) { return !v }) }}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: expanded ? T.accentBg : T.bg, color: expanded ? T.accent : T.textFaint, border: '1px solid ' + (expanded ? T.accentMid : T.border), cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {expanded ? '\u2212' : '+'} {otherFields.length}
            </button>
          )}
        </div>
      )}

      {/* Expand button when no rating fields */}
      {ratingFields.length === 0 && hasMore && (
        <div style={{ marginTop: 2 }}>
          <button onClick={function() { setExpanded(function(v) { return !v }) }}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: expanded ? T.accentBg : T.bg, color: expanded ? T.accent : T.textFaint, border: '1px solid ' + (expanded ? T.accentMid : T.border), cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            {expanded ? '\u2212 Less' : '+ ' + otherFields.length + ' more'}
          </button>
        </div>
      )}

      {/* Expanded metadata */}
      {expanded && otherFields.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6, paddingTop: 6, borderTop: '1px solid ' + T.border }}>
          {otherFields.map(function(f) {
            return (
              <span key={f.field} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: T.bg, color: T.textMute, border: '1px solid ' + T.border, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <span style={{ opacity: 0.7, fontWeight: 400 }}>{aliases[f.field] || f.field}:</span>{' '}
                <span style={{ fontWeight: 700 }}>{String(row.meta[f.field])}</span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function CommentsPanel({
  theme, allThemes, parsedData, activeField, activeFields,
  catFields, themeColors, onBack, ignoredFields = [], schema, apiKey, columnAliases = {}, datasetId,
}: Props) {
  const themeIdx = allThemes.findIndex(function(t) { return t.id === theme.id })
  const pal = themeColors[themeIdx] || THEME_PALETTE[0]

  const [aiSummary, setAiSummary] = useState<{
    headline: string; summary: string; sentiment: string; keyQuotes: string[]
  } | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [showNumericFields, setShowNumericFields] = useState(false)
  const [visibleCount, setVisibleCount] = useState(50)
  const [sortBy, setSortBy] = useState<'relevance' | 'length-desc' | 'length-asc'>('relevance')

  const fields = activeFields && activeFields.length ? activeFields : [activeField]
  const ignoredSet = new Set(ignoredFields)

  const metaCols = useMemo(function() {
    if (schema) {
      return schema.filter(function(f) {
        return f.type !== 'open-ended' && f.type !== 'id' && f.type !== 'ignore' && !ignoredSet.has(f.field)
      }).map(function(f) { return f.field })
    }
    return catFields
  }, [schema, catFields, ignoredFields])

  const allRows: CommentRow[] = useMemo(function() {
    var multiField = fields.length > 1
    var results: CommentRow[] = []
    parsedData.forEach(function(r) {
      if (multiField) {
        // Create one row per active field that has content (so field name is accurate)
        fields.forEach(function(f) {
          var text = String(r[f] || '').trim()
          if (!text) return
          var meta: Record<string, string> = {}
          metaCols.forEach(function(mc) { meta[mc] = String(r[mc] ?? '') })
          results.push({ text: text, meta: meta, fieldName: f })
        })
      } else {
        var text = fields.map(function(f) { return String(r[f] || '') }).join(' ').trim()
        if (!text) return
        var meta: Record<string, string> = {}
        metaCols.forEach(function(mc) { meta[mc] = String(r[mc] ?? '') })
        results.push({ text: text, meta: meta })
      }
    })
    return results
  }, [parsedData, fields, metaCols])

  const matched = useMemo(function() {
    const raw = allRows.filter(function(r) { return commentMatchesTheme(r.text, theme) })
    // Score relevance = number of distinct keywords matched
    var relevanceScore = function(text: string): number {
      var t = text.toLowerCase()
      var hits = 0
      ;(theme.keywords || []).forEach(function(kw) {
        var esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (new RegExp('(?<![a-z])' + esc + '\\w*', 'i').test(t)) hits++
      })
      return hits
    }
    var sorted = raw.slice()
    if (sortBy === 'relevance') {
      sorted.sort(function(a, b) { return relevanceScore(b.text) - relevanceScore(a.text) })
    } else if (sortBy === 'length-desc') {
      sorted.sort(function(a, b) { return b.text.length - a.text.length })
    } else if (sortBy === 'length-asc') {
      sorted.sort(function(a, b) { return a.text.length - b.text.length })
    }
    return sorted
  }, [allRows, theme, sortBy])

  async function generateSummary() {
    if (!matched.length || !apiKey) return
    setSummaryLoading(true)
    setSummaryError(null)
    setAiSummary(null)
    try {
      const sample = evenSample(matched, Math.min(60, matched.length))
      const texts = sample.map(function(c, i) { return (i + 1) + '. ' + c.text })
      const res = await fetch('/api/datasets/' + datasetId + '/mine-themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          texts,
          fieldName: 'summary_for_' + theme.name,
          schemaCtx: 'summary request for theme: ' + theme.name + ' -- ' + theme.description,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Summary failed')
      }
      // Use a lightweight summary prompt via a separate call to avoid polluting mine-themes
      // For now: parse whatever the mine-themes returns and use summary field
      const data = await res.json()
      setAiSummary({
        headline: theme.name + ' theme summary',
        summary: data.summary || 'Summary generated.',
        sentiment: theme.sentiment,
        keyQuotes: [],
      })
    } catch (e: unknown) {
      setSummaryError(e instanceof Error ? e.message : 'Summary failed')
    }
    setSummaryLoading(false)
  }

  const total = parsedData.filter(function(r) {
    return fields.some(function(f) { return String(r[f] || '').trim().length > 0 })
  }).length

  const matchPct = total > 0 ? Math.round(matched.length / total * 100) : 0
  const visible = matched.slice(0, visibleCount)
  const hasMore = matched.length > visibleCount

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid ' + T.border, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onBack}
          style={{ fontSize: 12, fontWeight: 600, color: T.textMute, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px 2px 0', flexShrink: 0 }}
        >
          &larr; Back
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: pal.text, background: pal.bg, padding: '3px 11px', borderRadius: 20, border: '1px solid ' + pal.border }}>
          {theme.name}
        </span>
        <span style={{ fontSize: 12, color: T.textMute }}>
          {matched.length.toLocaleString()} of {total.toLocaleString()} responses ({matchPct}%)
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={sortBy}
            onChange={function(e) { setSortBy(e.target.value as typeof sortBy); setVisibleCount(50) }}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid ' + T.border, background: T.bg, color: T.textMid, cursor: 'pointer' }}
          >
            <option value="relevance">Sort: Relevance</option>
            <option value="length-desc">Sort: Longest first</option>
            <option value="length-asc">Sort: Shortest first</option>
          </select>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: sentBg(theme.sentiment), color: sentColor(theme.sentiment), border: '1px solid ' + sentColor(theme.sentiment) + '30', fontWeight: 600 }}>
            {theme.sentiment}
          </span>
        </span>
      </div>

      {/* AI Summary panel */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid ' + T.border, flexShrink: 0 }}>
        {!aiSummary && !summaryLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={generateSummary}
              disabled={!apiKey || !matched.length}
              style={{
                padding: '7px 14px', fontSize: 12, fontWeight: 700,
                background: apiKey ? T.accentBg : T.bg,
                color: apiKey ? T.accent : T.textFaint,
                border: '1px solid ' + (apiKey ? T.accentMid : T.border),
                borderRadius: 8, cursor: apiKey ? 'pointer' : 'not-allowed',
              }}
            >
              {'\u29E1'} AI Summary
            </button>
            {!apiKey && (
              <span style={{ fontSize: 11, color: T.textFaint }}>Add your API key to enable AI summaries</span>
            )}
            {summaryError && (
              <span style={{ fontSize: 11, color: T.red }}>{summaryError}</span>
            )}
          </div>
        )}
        {summaryLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.textMute, fontSize: 12 }}>
            <Spinner /> Generating summary...
          </div>
        )}
        {aiSummary && (
          <div style={{ background: pal.bg, border: '1px solid ' + pal.border + '50', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: pal.text, marginBottom: 4 }}>{aiSummary.headline}</div>
            <div style={{ fontSize: 12, color: T.textMid, lineHeight: 1.6, marginBottom: 8 }}>{aiSummary.summary}</div>
            {aiSummary.keyQuotes && aiSummary.keyQuotes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {aiSummary.keyQuotes.map(function(q, i) {
                  return (
                    <div key={i} style={{ fontSize: 11, color: T.textMid, fontStyle: 'italic', borderLeft: '2px solid ' + pal.border, paddingLeft: 8 }}>
                      &ldquo;{q}&rdquo;
                    </div>
                  )
                })}
              </div>
            )}
            <button
              onClick={function() { setAiSummary(null) }}
              style={{ marginTop: 8, fontSize: 11, color: T.textFaint, background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Comments list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
        {matched.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>
            No responses matched this theme.
          </div>
        )}
        {visible.map(function(row, i) {
          return (
            <CommentCard
              key={i}
              row={row}
              theme={theme}
              pal={pal}
              schema={schema}
              aliases={columnAliases}
              ignoredFields={ignoredFields}
              activeFields={fields}
            />
          )
        })}
        {hasMore && (
          <button
            onClick={function() { setVisibleCount(function(n) { return n + 50 }) }}
            style={{ width: '100%', padding: '10px', fontSize: 12, fontWeight: 600, background: 'transparent', border: '1px solid ' + T.border, borderRadius: 9, color: T.textMute, cursor: 'pointer', marginTop: 4 }}
          >
            Show more ({matched.length - visibleCount} remaining)
          </button>
        )}
      </div>
    </div>
  )
}
