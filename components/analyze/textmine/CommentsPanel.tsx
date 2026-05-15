'use client'
// components/analyze/textmine/CommentsPanel.tsx
// Displays verbatim responses matching a theme.
// Keyword highlights, meta fields, optional AI summary via user API key.
// onBack navigates back to themes list.

import { useState, useMemo, useEffect, useRef } from 'react'
import { readSession, writeSession } from '@/lib/useSessionState'
import LottieLoader from '@/components/ui/LottieLoader'
import {
  Theme, THEME_PALETTE, commentMatchesTheme, highlightKeywords,
  evenSample, sentColor, sentBg,
} from '@/lib/themeUtils'

import { T } from '@/lib/analyzeTheme'
import type { SchemaFieldConfig as SchemaField } from '@/lib/analyzeTypes'

interface Props {
  theme: Theme
  allThemes: Theme[]
  selectedThemes?: Theme[]
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
  showAllMode?: boolean
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

// Red → Amber → Green color ramp for a normalised value in [0,1]
function rampColor(pct: number): string {
  if (pct <= 0.5) {
    var r = 220, g = Math.round(80 + pct * 2 * 120)
    return 'rgb(' + r + ',' + g + ',40)'
  }
  var r2 = Math.round(220 - (pct - 0.5) * 2 * 180), g2 = Math.round(160 + (pct - 0.5) * 2 * 40)
  return 'rgb(' + r2 + ',' + g2 + ',40)'
}

function fieldColorFor(val: unknown, f: SchemaField): string | null {
  var n = parseFloat(String(val))
  if (isNaN(n)) return null
  var min = f.min != null ? f.min : 1
  var max = f.max != null ? f.max : (f.sqt === 'nps' ? 10 : 5)
  var pct = Math.max(0, Math.min(1, (n - min) / (max - min || 1)))
  return rampColor(pct)
}

function CommentCard({ row, theme, pal, schema, aliases, ignoredFields, activeFields: cardActiveFields, allThemes, themeColors, showAllMode, selectedThemes, hoveredThemeId, colorByValue, colorByFieldSchema }: {
  row: CommentRow
  theme: Theme
  pal: typeof THEME_PALETTE[0]
  schema?: SchemaField[]
  aliases: Record<string, string>
  ignoredFields: string[]
  activeFields?: string[]
  allThemes?: Theme[]
  themeColors?: Record<number, typeof THEME_PALETTE[0]>
  showAllMode?: boolean
  selectedThemes?: Theme[]
  hoveredThemeId?: string | null
  colorByValue?: number | null
  colorByFieldSchema?: SchemaField | null
}) {
  var [localHover, setLocalHover] = useState<string | null>(null)
  // Effective hover: local card hover takes priority, then parent header hover
  var effectiveHover = localHover || hoveredThemeId || null

  // In showAllMode, find ALL matching themes for this row
  var matchingThemes: { theme: Theme; pal: typeof THEME_PALETTE[0] }[] = []
  if (showAllMode && allThemes && themeColors) {
    allThemes.forEach(function(t, i) {
      if (commentMatchesTheme(row.text, t)) {
        matchingThemes.push({ theme: t, pal: themeColors[i] || THEME_PALETTE[0] })
      }
    })
  } else if (selectedThemes && selectedThemes.length > 0 && allThemes && themeColors) {
    // Multi-theme mode: show badges for each selected theme that matches
    selectedThemes.forEach(function(st) {
      if (commentMatchesTheme(row.text, st)) {
        var idx = allThemes.findIndex(function(at) { return at.id === st.id })
        matchingThemes.push({ theme: st, pal: themeColors[idx] || THEME_PALETTE[0] })
      }
    })
  }

  // Combine keywords for highlighting
  // Build keyword → palette map for per-theme coloring
  var kwPalMap: Record<string, typeof THEME_PALETTE[0]> = {}
  var highlightKws: string[]
  var singlePal = false

  if (effectiveHover) {
    var hoveredTheme = (allThemes || []).find(function(t) { return t.id === effectiveHover })
    if (hoveredTheme) {
      highlightKws = hoveredTheme.keywords || []
      var hIdx = (allThemes || []).findIndex(function(t) { return t.id === effectiveHover })
      var hPal = (themeColors && themeColors[hIdx]) || THEME_PALETTE[0]
      highlightKws.forEach(function(kw) { kwPalMap[kw.toLowerCase()] = hPal })
      singlePal = true
    } else {
      highlightKws = []
    }
  } else if (showAllMode || (selectedThemes && selectedThemes.length > 1)) {
    // Multi-theme: each keyword gets its theme's palette
    var themesForKws = showAllMode ? matchingThemes : (selectedThemes || []).map(function(st) {
      var idx = (allThemes || []).findIndex(function(at) { return at.id === st.id })
      return { theme: st, pal: (themeColors && themeColors[idx]) || THEME_PALETTE[0] }
    })
    highlightKws = []
    themesForKws.forEach(function(m) {
      ;(m.theme.keywords || []).forEach(function(kw) {
        highlightKws.push(kw)
        if (!kwPalMap[kw.toLowerCase()]) kwPalMap[kw.toLowerCase()] = m.pal
      })
    })
  } else if (selectedThemes && selectedThemes.length === 1) {
    highlightKws = selectedThemes[0].keywords || []
    var stIdx = (allThemes || []).findIndex(function(at) { return at.id === selectedThemes[0].id })
    var stPal = (themeColors && themeColors[stIdx]) || THEME_PALETTE[0]
    highlightKws.forEach(function(kw) { kwPalMap[kw.toLowerCase()] = stPal })
    singlePal = true
  } else {
    highlightKws = (theme.keywords || [])
    highlightKws.forEach(function(kw) { kwPalMap[kw.toLowerCase()] = pal })
    singlePal = true
  }
  var segments = highlightKeywords(row.text, highlightKws)

  // Helper: find palette for a matched text segment
  var segPal = function(segText: string): typeof THEME_PALETTE[0] {
    // If kwPalMap has entries, always try it first (covers hover + multi-theme)
    if (Object.keys(kwPalMap).length) {
      var lower = segText.toLowerCase()
      var keys = Object.keys(kwPalMap)
      for (var k = 0; k < keys.length; k++) {
        if (lower.indexOf(keys[k]) >= 0 || keys[k].indexOf(lower) >= 0) return kwPalMap[keys[k]]
      }
      // singlePal hover: all keywords share one palette, return it
      if (singlePal) return kwPalMap[keys[0]]
    }
    return pal
  }
  var ignoredSet = new Set(ignoredFields)
  var metaCols = schema
    ? schema.filter(function(f) {
        return f.type !== 'open-ended' && f.type !== 'id' && f.type !== 'ignore' && !ignoredSet.has(f.field)
      })
    : []

  // Build aliases from schema labels — these take priority over passed-in aliases
  var fieldAlias = function(field: string): string {
    if (aliases[field]) return aliases[field]
    var sf = (schema || []).find(function(s) { return s.field === field })
    return (sf && sf.label && sf.label !== sf.field) ? sf.label : field
  }

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
  // Combine all metadata into one list: ratings first, then others
  var allMeta = ratingFields.concat(otherFields)
  // Show all pills but limit to 2 visual rows by default using max-height + overflow
  var [metaExpanded, setMetaExpanded] = useState(false)
  var hasMoreMeta = allMeta.length > 3 // 3+ pills may exceed 2 rows depending on label width

  // Comment text 4-line clamp + Show more / Show less. We measure overflow via a ref
  // so the toggle button only appears when the clamped text is actually being cut off
  // (different cards have different column widths and font wrapping).
  var [textExpanded, setTextExpanded] = useState(false)
  var [isClamped, setIsClamped] = useState(false)
  var commentTextRef = useRef<HTMLDivElement>(null)
  useEffect(function() {
    var el = commentTextRef.current
    if (!el) return
    // Element scrolls (has overflow) when content is taller than its clamped box.
    // Add 1px tolerance for sub-pixel rounding.
    setIsClamped(el.scrollHeight > el.clientHeight + 1)
  }, [segments, textExpanded])

  // Format metadata values — dates shown as mm/dd/yy
  var formatFieldValue = function(val: unknown, f: SchemaField): string {
    var s = String(val ?? '').trim()
    if (!s) return s
    if (f.type === 'date') {
      var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
      if (m) return m[2] + '/' + m[3] + '/' + m[1].slice(2)
      var d = new Date(s)
      if (!isNaN(d.getTime())) {
        var mo = d.getMonth() + 1, day = d.getDate(), y = d.getFullYear() % 100
        return (mo < 10 ? '0' + mo : '' + mo) + '/' + (day < 10 ? '0' + day : '' + day) + '/' + (y < 10 ? '0' + y : '' + y)
      }
    }
    return s
  }

  var accentColor = (colorByValue != null && colorByFieldSchema)
    ? (fieldColorFor(colorByValue, colorByFieldSchema) || pal.border)
    : pal.border
  var accentBg = (colorByValue != null && colorByFieldSchema && fieldColorFor(colorByValue, colorByFieldSchema))
    ? fieldColorFor(colorByValue, colorByFieldSchema)! + '12'
    : T.bgCard

  return (
    <div style={{
      background: accentBg, border: '1px solid ' + T.border, borderRadius: 10,
      padding: '12px 14px', borderLeft: '4px solid ' + accentColor,
      boxShadow: '0 1px 4px rgba(0,0,0,.04)',
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {/* Theme badge(s) + field name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        {(showAllMode || (selectedThemes && selectedThemes.length > 1)) && matchingThemes.length > 0 ? (
          matchingThemes.map(function(m) {
            var isHov = effectiveHover === m.theme.id
            return (
              <span key={m.theme.id}
                onMouseEnter={function() { setLocalHover(m.theme.id) }}
                onMouseLeave={function() { setLocalHover(null) }}
                style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: m.pal.bg, color: m.pal.text, border: '1px solid ' + m.pal.border, opacity: effectiveHover && !isHov ? 0.4 : 1, transition: 'opacity .15s', cursor: 'default' }}>
                {m.theme.name}
              </span>
            )
          })
        ) : (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border }}>
            {theme.name}
          </span>
        )}
        {(showAllMode || (selectedThemes && selectedThemes.length > 1)) && matchingThemes.length === 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, background: '#f1f5f9', color: '#94a3b8', border: '1px solid #e2e8f0' }}>
            Unclassified
          </span>
        )}
        {showFieldName && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: '#f0f9ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>
            {fieldAlias(row.fieldName!) || row.fieldName}
          </span>
        )}
      </div>

      {/* Comment text + show-more toggle. Wrapper takes flex:1 so pills pin
          to the bottom of the card; inner div is line-clamped to 4 lines
          unless the user expands it. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: allMeta.length > 0 ? 8 : 0 }}>
        <div ref={commentTextRef} style={{
          fontSize: 13, color: T.text, lineHeight: 1.75,
          ...(textExpanded ? {} : {
            display: '-webkit-box' as const,
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
          }),
        }}>
          {segments.map(function(seg, i) {
            if (seg.matched) {
              var sp = segPal(seg.text)
              return (
                <mark key={i} style={{ background: sp.light || sp.bg, color: sp.text, borderRadius: 3, padding: '1px 3px', borderBottom: '2px solid ' + sp.border, fontWeight: 600 }}>
                  {seg.text}
                </mark>
              )
            }
            return <span key={i}>{seg.text}</span>
          })}
        </div>
        {(isClamped || textExpanded) && (
          <button onClick={function() { setTextExpanded(!textExpanded) }}
            style={{ alignSelf: 'flex-start', marginTop: 4, padding: 0, background: 'transparent', border: 'none', color: T.accent, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            {textExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {/* Metadata pills — 2 rows max, expand to show all */}
      {allMeta.length > 0 && (
        <div style={{ position: 'relative', marginTop: 2 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', maxHeight: metaExpanded ? 'none' : 49, overflow: 'hidden' }}>
            {allMeta.map(function(f) {
              var val = row.meta[f.field]
              var isRating = f.sqt === 'rating' || f.sqt === 'nps' || f.sqt === 'likert' || f.scoreField === true
              var color = isRating ? (fieldColorFor(val, f) || T.textMid) : null
              return (
                <span key={f.field} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: color ? color + '15' : T.bg, color: color || T.textMute, border: '1px solid ' + (color ? color + '40' : T.border), display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: isRating ? 700 : 500 }}>
                  <span style={{ opacity: 0.7, fontWeight: isRating ? 500 : 400 }}>{fieldAlias(f.field)}:</span> {formatFieldValue(val, f)}
                </span>
              )
            })}
          </div>
          {hasMoreMeta && !metaExpanded && (
            <button onClick={function() { setMetaExpanded(true) }}
              style={{ position: 'absolute', right: 0, bottom: 0, fontSize: 11, padding: '2px 8px', borderRadius: 10, background: T.bg, color: T.textFaint, border: '1px solid ' + T.border, cursor: 'pointer', fontWeight: 600, boxShadow: '-8px 0 6px -2px white' }}>
              + more
            </button>
          )}
          {hasMoreMeta && metaExpanded && (
            <button onClick={function() { setMetaExpanded(false) }}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: T.accentBg, color: T.accent, border: '1px solid ' + T.accentMid, cursor: 'pointer', fontWeight: 600, marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {'\u2212'} Less
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function CommentsPanel({
  theme, allThemes, selectedThemes, parsedData, activeField, activeFields,
  catFields, themeColors, onBack, ignoredFields = [], schema, apiKey, columnAliases = {}, datasetId, showAllMode,
}: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeThemes = useMemo(function() { return selectedThemes && selectedThemes.length > 0 ? selectedThemes : [theme] }, [selectedThemes, theme])
  const isMulti = activeThemes.length > 1 || showAllMode
  const themeIdx = allThemes.findIndex(function(t) { return t.id === activeThemes[0].id })
  const pal = themeColors[themeIdx] || THEME_PALETTE[0]

  const [hoveredThemeId, setHoveredThemeId] = useState<string | null>(null)

  const [aiSummary, setAiSummary] = useState<{
    headline: string; summary: string; sentiment: string; keyQuotes: string[]
  } | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [showNumericFields, setShowNumericFields] = useState(false)
  const [visibleCount, setVisibleCount] = useState(50)
  const [colorField, setColorField] = useState(function() {
    return (schema || []).find(function(f) {
      return f.sqt === 'rating' || f.sqt === 'nps' || f.sqt === 'likert' || f.scoreField === true
    })?.field || ''
  })
  // sessionStorage default = 2; restore from session post-mount to avoid
  // hydration mismatch (server has no sessionStorage). The restoredFromSession
  // gate keeps the writer-effect from clobbering the saved value with the
  // default before the restore runs.
  var _commKey = 'comments_' + datasetId
  const [gridCols, setGridCols] = useState(2)
  const [commRestored, setCommRestored] = useState(false)
  useEffect(function() {
    const saved = readSession<any>(_commKey)
    if (saved?.gridCols) setGridCols(saved.gridCols)
    setCommRestored(true)
  }, [_commKey])
  useEffect(function() {
    if (!commRestored) return
    writeSession(_commKey, { gridCols: gridCols })
  }, [commRestored, gridCols, _commKey])

  // Schema fields available for color-coding (numeric / rating types)
  const colorableFields = useMemo(function() {
    return (schema || []).filter(function(f) {
      return f.type === 'numeric' || f.sqt === 'rating' || f.sqt === 'nps' || f.sqt === 'likert' || f.scoreField === true
    })
  }, [schema])

  const colorFieldSchema = useMemo(function() {
    return colorableFields.find(function(f) { return f.field === colorField }) || null
  }, [colorableFields, colorField])

  // ── Shuffle (random re-order) ─────────────────────────────────
  const [shuffleSeed, setShuffleSeed] = useState(0)
  function shuffle() {
    setShuffleSeed(function(s) { return s + 1 })
    setVisibleCount(50)
  }

  // ── Multi-field sort ──────────────────────────────────────────
  type SortClause = { field: string; dir: 'asc' | 'desc' }
  const [sortClauses, setSortClauses] = useState<SortClause[]>([])   // empty = random
  const [showSortModal, setShowSortModal] = useState(false)
  const [draftClauses, setDraftClauses] = useState<SortClause[]>([]) // edits in modal

  function openSortModal() {
    setDraftClauses(sortClauses.slice())
    setShowSortModal(true)
  }
  function applySortModal() {
    setSortClauses(draftClauses.filter(function(c) { return c.field !== '' }))
    setShowSortModal(false)
    setVisibleCount(50)
  }
  function addDraftClause() {
    setDraftClauses(function(prev) { return prev.concat([{ field: '__relevance__', dir: 'desc' }]) })
  }
  function removeDraftClause(i: number) {
    setDraftClauses(function(prev) { return prev.filter(function(_, j) { return j !== i }) })
  }
  function updateDraftClause(i: number, patch: Partial<SortClause>) {
    setDraftClauses(function(prev) {
      return prev.map(function(c, j) { return j === i ? { ...c, ...patch } : c })
    })
  }

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
    var raw = showAllMode
      ? allRows.filter(function(r) {
          // In showAllMode, hide unclassified comments (those matching no theme)
          return allThemes.some(function(t) { return commentMatchesTheme(r.text, t) })
        })
      : allRows.filter(function(r) {
          return activeThemes.some(function(t) { return commentMatchesTheme(r.text, t) })
        })

    // sortClauses empty → Fisher-Yates shuffle keyed to shuffleSeed
    if (sortClauses.length === 0) {
      var arr = raw.slice()
      // Simple seeded LCG for deterministic shuffle per seed value
      var seed = shuffleSeed * 1013904223 + 1664525
      var rng = function() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
      for (var si = arr.length - 1; si > 0; si--) {
        var sj = Math.floor(rng() * (si + 1))
        var tmp = arr[si]; arr[si] = arr[sj]; arr[sj] = tmp
      }
      return arr
    }

    // Relevance scorer — used when field === '__relevance__'
    var allKws = activeThemes.reduce(function(acc, t) { return acc.concat(t.keywords || []) }, [] as string[])
    var relevanceScore = function(text: string): number {
      var tl = text.toLowerCase(); var hits = 0
      allKws.forEach(function(kw) {
        var esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (new RegExp('(?<![a-z])' + esc + '\\w*', 'i').test(tl)) hits++
      })
      return hits
    }

    var getSortValue = function(row: CommentRow, field: string): number | string {
      if (field === '__relevance__') return relevanceScore(row.text)
      if (field === '__length__')    return row.text.length
      var val = row.meta[field]
      if (val == null || val === '') return ''
      var n = parseFloat(val)
      return isNaN(n) ? val : n
    }

    var sorted = raw.slice()
    sorted.sort(function(a, b) {
      for (var ci = 0; ci < sortClauses.length; ci++) {
        var clause = sortClauses[ci]
        var va = getSortValue(a, clause.field)
        var vb = getSortValue(b, clause.field)
        var cmp: number
        if (typeof va === 'number' && typeof vb === 'number') {
          cmp = va - vb
        } else {
          cmp = String(va).localeCompare(String(vb))
        }
        if (cmp !== 0) return clause.dir === 'asc' ? cmp : -cmp
      }
      return 0
    })
    return sorted
  }, [allRows, activeThemes, sortClauses, showAllMode, shuffleSeed])

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

  // Sentinel element at the bottom of the list — IntersectionObserver loads more when visible
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(function() {
    var el = sentinelRef.current
    var root = scrollContainerRef.current
    if (!el || !root) return
    var observer = new IntersectionObserver(
      function(entries) {
        if (entries[0].isIntersecting) {
          setVisibleCount(function(n) { return n + 50 })
        }
      },
      { root: root, threshold: 0.1 }
    )
    observer.observe(el)
    return function() { observer.disconnect() }
  }, [matched])   // re-attach whenever the matched list changes (sort / theme switch)

  // Reset visible window when sort or matched set changes
  useEffect(function() { setVisibleCount(50) }, [sortClauses, activeThemes, showAllMode])

  const total = parsedData.filter(function(r) {
    return fields.some(function(f) { return String(r[f] || '').trim().length > 0 })
  }).length

  const matchPct = total > 0 ? Math.round(matched.length / total * 100) : 0
  const visible = matched.slice(0, visibleCount)
  const hasMore = matched.length > visibleCount

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid ' + T.border, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={onBack}
          style={{ fontSize: 12, fontWeight: 600, color: T.textMute, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px 2px 0', flexShrink: 0 }}
        >
          &larr; Back
        </button>
        {showAllMode ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: T.textMid, background: T.bg, padding: '3px 11px', borderRadius: 20, border: '1px solid ' + T.border }}>
            All Themes
          </span>
        ) : activeThemes.map(function(t) {
          var idx = allThemes.findIndex(function(at) { return at.id === t.id })
          var tp = themeColors[idx] || THEME_PALETTE[0]
          var isHovered = hoveredThemeId === t.id
          return (
            <span key={t.id}
              onMouseEnter={function() { setHoveredThemeId(t.id) }}
              onMouseLeave={function() { setHoveredThemeId(null) }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: tp.text, background: tp.bg, padding: '3px 11px', borderRadius: 20, border: (isHovered ? '2px' : '1px') + ' solid ' + tp.border, cursor: 'default', transition: 'border-width .1s', boxShadow: isHovered ? '0 0 0 2px ' + tp.border + '60' : 'none' }}>
              {t.name}
            </span>
          )
        })}
        <span style={{ fontSize: 12, color: T.textMute }}>
          {matched.length.toLocaleString()} of {total.toLocaleString()} responses ({matchPct}%)
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {sortClauses.length === 0 && (
            <button
              onClick={shuffle}
              title="Re-shuffle comments"
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid ' + T.border, background: T.bg, color: T.textMid,
                fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              <span style={{ fontSize: 13 }}>{'\u21BA'}</span> Shuffle
            </button>
          )}
          <button
            onClick={openSortModal}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid ' + (sortClauses.length > 0 ? T.accent : T.border),
              background: sortClauses.length > 0 ? T.accentBg : T.bg,
              color: sortClauses.length > 0 ? T.accent : T.textMid,
              fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span style={{ fontSize: 12 }}>{'\u21C5'}</span>
            Sort
            {sortClauses.length > 0 && (
              <span style={{ fontSize: 10, background: T.accent, color: '#fff', borderRadius: 10, padding: '0 5px', lineHeight: '16px' }}>
                {sortClauses.length}
              </span>
            )}
          </button>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: sentBg(theme.sentiment), color: sentColor(theme.sentiment), border: '1px solid ' + sentColor(theme.sentiment) + '30', fontWeight: 600 }}>
            {theme.sentiment}
          </span>
          {theme.searchInterest && (
            <span title={theme.searchInterest === 'high' ? 'Keywords in this theme have 1M+ monthly Google searches' + (theme.searchTrend === 'up' ? ' and are trending up' : theme.searchTrend === 'down' ? ' and are trending down' : '') : theme.searchInterest === 'moderate' ? 'Keywords in this theme have 100K\u20131M monthly Google searches' + (theme.searchTrend === 'up' ? ' and are trending up' : theme.searchTrend === 'down' ? ' and are trending down' : '') : 'Keywords in this theme have 5K\u2013100K monthly Google searches' + (theme.searchTrend === 'up' ? ' and are trending up' : theme.searchTrend === 'down' ? ' and are trending down' : '')} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 700, cursor: 'help',
              background: theme.searchInterest === 'high' ? '#dbeafe' : theme.searchInterest === 'moderate' ? '#fef3c7' : '#f3f4f6',
              color: theme.searchInterest === 'high' ? '#1d4ed8' : theme.searchInterest === 'moderate' ? '#92400e' : '#6b7280',
              border: '1px solid ' + (theme.searchInterest === 'high' ? '#93c5fd' : theme.searchInterest === 'moderate' ? '#fcd34d' : '#d1d5db'),
            }}>{'\uD83D\uDD0D'} {theme.searchInterest === 'high' ? 'Widely Searched' : theme.searchInterest === 'moderate' ? 'Moderately Searched' : 'Niche Topic'}{theme.searchTrend === 'up' ? ' \u2191' : theme.searchTrend === 'down' ? ' \u2193' : ''}</span>
          )}
          {/* Color-by field picker */}
          {colorableFields.length > 0 && (
            <select
              value={colorField}
              onChange={function(e) { setColorField(e.target.value) }}
              style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, border: '1px solid ' + (colorField ? T.accent : T.border), background: colorField ? T.accentBg : T.bg, color: colorField ? T.accent : T.textMid, cursor: 'pointer', fontWeight: 600 }}
              title="Color cards by a numeric field"
            >
              <option value=''>Color by…</option>
              {colorableFields.map(function(f) {
                var lbl = (columnAliases[f.field]) || (f.label && f.label !== f.field ? f.label : null) || f.field
                return <option key={f.field} value={f.field}>{lbl}</option>
              })}
            </select>
          )}
          {/* Grid column picker */}
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid ' + T.border }}>
            {[1, 2, 3, 4].map(function(n) {
              var active = gridCols === n
              return (
                <button key={n} onClick={function() { setGridCols(n) }}
                  title={n + ' column' + (n > 1 ? 's' : '')}
                  style={{ padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none', borderRight: n < 4 ? '1px solid ' + T.border : 'none', background: active ? T.accent : T.bg, color: active ? '#fff' : T.textMid }}>
                  {n}
                </button>
              )
            })}
          </div>
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
            <LottieLoader size={20} /> Generating summary...
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

      {/* ── Sort modal ─────────────────────────────────────── */}
      {showSortModal && (() => {
        // Build field options from schema meta columns + built-ins
        var builtIns = [
          { value: '__relevance__', label: 'Keyword relevance' },
          { value: '__length__',    label: 'Response length' },
        ]
        var schemaOpts = (schema || [])
          .filter(function(f) { return f.type !== 'open-ended' && f.type !== 'id' && f.type !== 'ignore' })
          .map(function(f) {
            var label = (columnAliases[f.field]) || (f.label && f.label !== f.field ? f.label : null) || f.field
            return { value: f.field, label: label }
          })
        var allOpts = builtIns.concat(schemaOpts)

        // Human-readable summary of active draft clauses for the header
        var clauseLabel = function(c: { field: string; dir: string }): string {
          var opt = allOpts.find(function(o) { return o.value === c.field })
          return (opt ? opt.label : c.field) + ' (' + (c.dir === 'asc' ? 'A→Z' : 'Z→A') + ')'
        }

        return (
          <div
            onClick={function(e) { if (e.target === e.currentTarget) setShowSortModal(false) }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,.18)', width: 460, maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Modal header */}
              <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Sort order</div>
                  <div style={{ fontSize: 11, color: T.textMute, marginTop: 2 }}>
                    {draftClauses.length === 0 ? 'Random order (default)' : draftClauses.map(clauseLabel).join(', then ')}
                  </div>
                </div>
                <button onClick={function() { setShowSortModal(false) }} style={{ fontSize: 18, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}>×</button>
              </div>

              {/* Clause list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {draftClauses.length === 0 && (
                  <div style={{ fontSize: 12, color: T.textFaint, textAlign: 'center', padding: '20px 0' }}>
                    No sort applied — comments shown in random order.
                    <br />Click <strong>+ Add sort level</strong> below to sort by a field.
                  </div>
                )}
                {draftClauses.map(function(clause, i) {
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bg, border: '1px solid ' + T.border, borderRadius: 10, padding: '10px 12px' }}>
                      {/* Level indicator */}
                      <div style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, background: T.accentBg, color: T.accent, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {i + 1}
                      </div>

                      {/* Field picker */}
                      <select
                        value={clause.field}
                        onChange={function(e) { updateDraftClause(i, { field: e.target.value }) }}
                        style={{ flex: 1, fontSize: 12, padding: '5px 8px', borderRadius: 7, border: '1px solid ' + T.borderMid, background: '#fff', color: T.text, cursor: 'pointer' }}
                      >
                        <optgroup label="Built-in">
                          {builtIns.map(function(o) { return <option key={o.value} value={o.value}>{o.label}</option> })}
                        </optgroup>
                        {schemaOpts.length > 0 && (
                          <optgroup label="Dataset fields">
                            {schemaOpts.map(function(o) { return <option key={o.value} value={o.value}>{o.label}</option> })}
                          </optgroup>
                        )}
                      </select>

                      {/* ASC / DESC toggle */}
                      <div style={{ display: 'flex', borderRadius: 7, border: '1px solid ' + T.borderMid, overflow: 'hidden', flexShrink: 0 }}>
                        {(['asc', 'desc'] as const).map(function(d) {
                          var active = clause.dir === d
                          return (
                            <button
                              key={d}
                              onClick={function() { updateDraftClause(i, { dir: d }) }}
                              style={{ fontSize: 11, fontWeight: 600, padding: '5px 9px', border: 'none', background: active ? T.accent : '#fff', color: active ? '#fff' : T.textMute, cursor: 'pointer' }}
                            >
                              {d === 'asc' ? 'A→Z' : 'Z→A'}
                            </button>
                          )
                        })}
                      </div>

                      {/* Remove */}
                      <button
                        onClick={function() { removeDraftClause(i) }}
                        style={{ flexShrink: 0, fontSize: 16, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}
                      >×</button>
                    </div>
                  )
                })}

                {/* Add level */}
                {draftClauses.length < 5 && (
                  <button
                    onClick={addDraftClause}
                    style={{ fontSize: 12, fontWeight: 600, padding: '9px', borderRadius: 9, border: '1px dashed ' + T.borderMid, background: 'transparent', color: T.textMute, cursor: 'pointer', marginTop: 2 }}
                  >
                    + Add sort level
                  </button>
                )}
              </div>

              {/* Modal footer */}
              <div style={{ padding: '12px 20px', borderTop: '1px solid ' + T.border, display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
                <button
                  onClick={function() { setDraftClauses([]); }}
                  style={{ fontSize: 12, padding: '7px 14px', borderRadius: 8, border: '1px solid ' + T.border, background: T.bg, color: T.textMid, cursor: 'pointer', fontWeight: 500 }}
                >
                  Random (default)
                </button>
                <button
                  onClick={function() { setShowSortModal(false) }}
                  style={{ fontSize: 12, padding: '7px 14px', borderRadius: 8, border: '1px solid ' + T.border, background: '#fff', color: T.textMid, cursor: 'pointer', fontWeight: 500 }}
                >
                  Cancel
                </button>
                <button
                  onClick={applySortModal}
                  style={{ fontSize: 12, padding: '7px 14px', borderRadius: 8, border: 'none', background: T.accent, color: '#fff', cursor: 'pointer', fontWeight: 700 }}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Comments list */}
      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
        {/* Color scale legend */}
        {colorField && colorFieldSchema && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 11, color: T.textMute }}>
            <span style={{ fontWeight: 600 }}>
              {(columnAliases[colorFieldSchema.field]) || colorFieldSchema.label || colorFieldSchema.field}:
            </span>
            <span style={{ fontWeight: 600, color: rampColor(0) }}>{colorFieldSchema.min ?? 1} (low)</span>
            <div style={{ flex: 1, maxWidth: 120, height: 6, borderRadius: 3, background: 'linear-gradient(to right, ' + rampColor(0) + ', ' + rampColor(0.5) + ', ' + rampColor(1) + ')' }} />
            <span style={{ fontWeight: 600, color: rampColor(1) }}>{colorFieldSchema.max ?? (colorFieldSchema.sqt === 'nps' ? 10 : 5)} (high)</span>
          </div>
        )}
        {matched.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>
            No responses matched this theme.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)', gap: 10, alignItems: 'stretch' }}>
        {visible.map(function(row, i) {
          var cbv = (colorField && row.meta[colorField] != null) ? parseFloat(String(row.meta[colorField])) : null
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
              allThemes={allThemes}
              themeColors={themeColors}
              showAllMode={showAllMode}
              selectedThemes={activeThemes}
              hoveredThemeId={hoveredThemeId}
              colorByValue={cbv !== null && !isNaN(cbv) ? cbv : null}
              colorByFieldSchema={colorFieldSchema}
            />
          )
        })}
        </div>
        {/* Sentinel — triggers next page load when scrolled into view */}
        {hasMore && (
          <div ref={sentinelRef} style={{ padding: '10px 0', textAlign: 'center' }}>
            <span style={{ fontSize: 11, color: T.textFaint }}>
              Loading more… ({matched.length - visibleCount} remaining)
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
