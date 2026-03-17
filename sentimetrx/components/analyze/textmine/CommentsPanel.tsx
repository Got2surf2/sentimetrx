'use client'
// components/analyze/textmine/CommentsPanel.tsx
// Shows verbatim responses matching one or more themes.
// Theme strip at top for quick switching. Multi-select supported.
// Keyword highlighting, metadata pills, sort controls, AI summary.

import { useState, useMemo } from 'react'
import {
  Theme, THEME_PALETTE, commentMatchesTheme, highlightKeywords,
  evenSample, sentColor, sentBg, getThemeColor,
} from '@/lib/themeUtils'

var T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', greenBg: '#f0fdf4', greenMid: '#bbf7d0',
  red: '#dc2626', redBg: '#fef2f2',
  amber: '#d97706', amberBg: '#fffbeb', amberMid: '#fde68a',
  blue: '#2563eb', blueBg: '#eff6ff',
}

interface SchemaField { field: string; type: string }

interface Props {
  initialTheme: Theme | null
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
  matchedThemes: number[]
}

function CommentCard({ row, matchedThemes, allThemes, themeColors, schema, aliases, ignoredFields }: {
  row: CommentRow
  matchedThemes: number[]
  allThemes: Theme[]
  themeColors: Record<number, typeof THEME_PALETTE[0]>
  schema?: SchemaField[]
  aliases: Record<string, string>
  ignoredFields: string[]
}) {
  var allKeywords: string[] = []
  matchedThemes.forEach(function(ti) {
    var t = allThemes[ti]
    if (t) allKeywords = allKeywords.concat(t.keywords || [])
  })
  var segments = highlightKeywords(row.text, allKeywords)
  var primaryIdx = matchedThemes[0] != null ? matchedThemes[0] : 0
  var pal = themeColors[primaryIdx] || THEME_PALETTE[0]
  var ignoredSet = new Set(ignoredFields)

  var metaCols = schema
    ? schema.filter(function(f) { return f.type !== 'open-ended' && f.type !== 'id' && f.type !== 'ignore' && !ignoredSet.has(f.field) }).map(function(f) { return f.field })
    : Object.keys(row.meta).filter(function(k) { return !ignoredSet.has(k) })
  var metaEntries = metaCols.filter(function(k) { return row.meta[k] != null && String(row.meta[k]).trim() !== '' })

  return (
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '12px 14px', marginBottom: 8, borderLeft: '3px solid ' + pal.border, boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
      {/* Theme badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {matchedThemes.map(function(ti) {
          var t = allThemes[ti]
          var p = themeColors[ti] || THEME_PALETTE[0]
          if (!t) return null
          return (
            <span key={t.id} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: p.bg, color: p.text, border: '1px solid ' + p.border }}>
              {t.name}
            </span>
          )
        })}
      </div>
      {/* Comment text with keyword highlighting */}
      <div style={{ fontSize: 13, color: T.text, lineHeight: 1.75, marginBottom: metaEntries.length ? 8 : 0 }}>
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
      {/* Meta pills */}
      {metaEntries.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 2 }}>
          {metaEntries.map(function(k) {
            return (
              <span key={k} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: T.bg, color: T.textMute, border: '1px solid ' + T.border, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <span style={{ opacity: 0.7, fontWeight: 400 }}>{aliases[k] || k}:</span>
                <span style={{ fontWeight: 700 }}>{String(row.meta[k])}</span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function CommentsPanel({
  initialTheme, allThemes, parsedData, activeField, activeFields,
  catFields, themeColors, onBack, ignoredFields = [], schema, apiKey, columnAliases = {}, datasetId,
}: Props) {

  var [selectedThemeIds, setSelectedThemeIds] = useState<Set<string>>(function() {
    var init = new Set<string>()
    if (initialTheme) init.add(initialTheme.id)
    return init
  })
  var [sortBy, setSortBy] = useState<'relevance' | 'length-desc' | 'length-asc'>('relevance')
  var [visibleCount, setVisibleCount] = useState(50)

  var fields = activeFields && activeFields.length ? activeFields : [activeField]
  var ignoredSet = new Set(ignoredFields)

  var metaCols = useMemo(function() {
    if (schema) {
      return schema.filter(function(f) {
        return f.type !== 'open-ended' && f.type !== 'id' && f.type !== 'ignore' && !ignoredSet.has(f.field)
      }).map(function(f) { return f.field })
    }
    return catFields
  }, [schema, catFields, ignoredFields])

  // Build all rows with matched themes index
  var allRows = useMemo(function() {
    return parsedData.map(function(r) {
      var text = fields.map(function(f) { return String(r[f] || '') }).join(' ').trim()
      var meta: Record<string, string> = {}
      metaCols.forEach(function(f) { meta[f] = String(r[f] ?? '') })
      var matchedThemes: number[] = []
      allThemes.forEach(function(t, ti) {
        if (commentMatchesTheme(text, t)) matchedThemes.push(ti)
      })
      return { text: text, meta: meta, matchedThemes: matchedThemes }
    }).filter(function(r) { return r.text.length > 0 })
  }, [parsedData, fields, metaCols, allThemes])

  // Filter by selected themes
  var selectedIndices = useMemo(function() {
    var indices = new Set<number>()
    allThemes.forEach(function(t, i) {
      if (selectedThemeIds.has(t.id)) indices.add(i)
    })
    return indices
  }, [allThemes, selectedThemeIds])

  var matched = useMemo(function() {
    if (selectedThemeIds.size === 0) return allRows
    var filtered = allRows.filter(function(r) {
      return r.matchedThemes.some(function(ti) { return selectedIndices.has(ti) })
    })
    // Relevance = count of selected-theme keyword hits
    function relevanceScore(row: CommentRow): number {
      var hits = 0
      var tLower = row.text.toLowerCase()
      selectedIndices.forEach(function(ti) {
        var t = allThemes[ti]
        if (!t) return
        ;(t.keywords || []).forEach(function(kw) {
          var esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          if (new RegExp('(?<![a-z])' + esc + '\\w*', 'i').test(tLower)) hits++
        })
      })
      return hits
    }
    if (sortBy === 'relevance') {
      filtered.sort(function(a, b) { return relevanceScore(b) - relevanceScore(a) })
    } else if (sortBy === 'length-desc') {
      filtered.sort(function(a, b) { return b.text.length - a.text.length })
    } else if (sortBy === 'length-asc') {
      filtered.sort(function(a, b) { return a.text.length - b.text.length })
    }
    return filtered
  }, [allRows, selectedThemeIds, selectedIndices, sortBy, allThemes])

  function toggleTheme(id: string) {
    setSelectedThemeIds(function(prev) {
      var n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
    setVisibleCount(50)
  }

  function selectAllThemes() {
    setSelectedThemeIds(new Set(allThemes.map(function(t) { return t.id })))
    setVisibleCount(50)
  }

  function clearSelection() {
    setSelectedThemeIds(new Set())
    setVisibleCount(50)
  }

  var totalWithText = allRows.length
  var visible = matched.slice(0, visibleCount)
  var hasMore = matched.length > visibleCount
  var allSelected = selectedThemeIds.size === allThemes.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ─── Header: back + stats ─────────────────────────────────── */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid ' + T.border, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack}
          style={{ fontSize: 12, fontWeight: 600, color: T.textMute, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px 2px 0', flexShrink: 0 }}>
          {'\u2190'} Back
        </button>
        <span style={{ fontSize: 12, color: T.border }}>|</span>
        <span style={{ fontSize: 12, color: T.textMid, fontWeight: 600 }}>
          {matched.length.toLocaleString()} of {totalWithText.toLocaleString()} responses
        </span>
        {selectedThemeIds.size > 0 && (
          <span style={{ fontSize: 11, color: T.textFaint }}>
            ({selectedThemeIds.size} theme{selectedThemeIds.size !== 1 ? 's' : ''} selected)
          </span>
        )}

        {/* Sort + select controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select value={sortBy}
            onChange={function(e) { setSortBy(e.target.value as typeof sortBy); setVisibleCount(50) }}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid ' + T.border, background: T.bg, color: T.textMid, cursor: 'pointer' }}>
            <option value="relevance">Sort: Relevance</option>
            <option value="length-desc">Sort: Longest first</option>
            <option value="length-asc">Sort: Shortest first</option>
          </select>
          <button onClick={allSelected ? clearSelection : selectAllThemes}
            style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: T.bg, border: '1px solid ' + T.border, color: T.textMid, cursor: 'pointer' }}>
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        </div>
      </div>

      {/* ─── Theme strip: clickable pills for switching ──────────── */}
      <div style={{ padding: '8px 20px', borderBottom: '1px solid ' + T.border, flexShrink: 0, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', background: T.bgCard }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0 }}>Themes:</span>
        {allThemes.map(function(t, ti) {
          var pal = themeColors[ti] || THEME_PALETTE[0]
          var sel = selectedThemeIds.has(t.id)
          var matchCount = allRows.filter(function(r) { return r.matchedThemes.includes(ti) }).length
          return (
            <button key={t.id} onClick={function() { toggleTheme(t.id) }}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: sel ? 700 : 500, borderRadius: 20,
                background: sel ? pal.bg : 'white',
                border: '1.5px solid ' + (sel ? pal.border : T.border),
                color: sel ? pal.text : T.textMute,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                transition: 'all .12s', opacity: sel ? 1 : 0.7,
              }}>
              <span style={{
                width: 10, height: 10, borderRadius: 3,
                border: '1.5px solid ' + (sel ? pal.border : T.borderMid),
                background: sel ? pal.border : 'transparent',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 7, color: 'white', flexShrink: 0,
              }}>{sel ? '\u2713' : ''}</span>
              {t.name}
              <span style={{ fontSize: 10, opacity: 0.7 }}>({matchCount})</span>
            </button>
          )
        })}
      </div>

      {/* ─── Comments list ────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
        {matched.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>
            {selectedThemeIds.size === 0
              ? 'Select one or more themes above to filter responses.'
              : 'No responses matched the selected themes.'}
          </div>
        )}
        {visible.map(function(row, i) {
          var visibleMatched = row.matchedThemes.filter(function(ti) {
            return selectedThemeIds.size === 0 || selectedIndices.has(ti)
          })
          return (
            <CommentCard key={i} row={row}
              matchedThemes={visibleMatched.length > 0 ? visibleMatched : row.matchedThemes}
              allThemes={allThemes} themeColors={themeColors}
              schema={schema} aliases={columnAliases} ignoredFields={ignoredFields} />
          )
        })}
        {hasMore && (
          <button onClick={function() { setVisibleCount(function(n) { return n + 50 }) }}
            style={{ width: '100%', padding: '10px', fontSize: 12, fontWeight: 600, background: 'transparent', border: '1px solid ' + T.border, borderRadius: 9, color: T.textMute, cursor: 'pointer', marginTop: 4 }}>
            Show more ({matched.length - visibleCount} remaining)
          </button>
        )}
      </div>
    </div>
  )
}

