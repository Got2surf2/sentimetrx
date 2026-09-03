'use client'

// components/analyze/textmine/FilteredCommentsPanel.tsx
// Results panel for the unified Comments filter (theme + entity + dimension,
// AND-combined). Rows are fetched server-side via /api/datasets/[id]/comments
// (the get_rows_by_filters RPC) and rendered as cards with the active filter
// terms highlighted. Card/sort/grid/infinite-scroll mirror EntityCommentsPanel;
// the difference is a generic header (active-filter chips) and multi-term
// highlight instead of one entity's terms.

import { useState, useMemo, useEffect, useRef } from 'react'
import { readSession, writeSession } from '@/lib/useSessionState'
import LottieLoader from '@/components/ui/LottieLoader'
import { T } from '@/lib/analyzeTheme'
import type { SchemaFieldConfig } from '@/lib/analyzeTypes'
import { expandEntityTerms } from '@/lib/entityVariants'

function rampColor(pct: number): string {
  if (pct <= 0.5) { var r = 220, g = Math.round(80 + pct * 2 * 120); return 'rgb(' + r + ',' + g + ',40)' }
  var r2 = Math.round(220 - (pct - 0.5) * 2 * 180), g2 = Math.round(160 + (pct - 0.5) * 2 * 40)
  return 'rgb(' + r2 + ',' + g2 + ',40)'
}
function fieldColorFor(val: unknown, f: SchemaFieldConfig): string | null {
  var n = parseFloat(String(val))
  if (isNaN(n)) return null
  var min = f.min != null ? f.min : 1
  var max = f.max != null ? f.max : (f.sqt === 'nps' ? 10 : 5)
  var pct = Math.max(0, Math.min(1, (n - min) / (max - min || 1)))
  return rampColor(pct)
}
function escapeRE(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** Theme palette entry for a highlighted keyword (from THEME_PALETTE). */
export interface KwPalette { light?: string; bg: string; text: string; border: string }

export function highlightTerms(text: string, terms: string[], phrases: string[] = [], kwPalettes?: Record<string, KwPalette>) {
  const base = terms.map(t => t.trim()).filter(t => t.length >= 2)
  const cleaned = expandEntityTerms(base).sort((a, b) => b.length - a.length)
  // Phrases (dimension evidence, sql/196) match WITHOUT word boundaries: the
  // classifier's evidence is a fixed-width window that can start or end
  // mid-word, so anchoring would silently drop the highlight. Long phrases
  // first so an evidence span wins over a keyword inside it.
  const phraseAlts = phrases.map(ph => ph.trim()).filter(ph => ph.length >= 4)
    .sort((a, b) => b.length - a.length).map(escapeRE)
  if ((!cleaned.length && !phraseAlts.length) || !text) return text
  const alts = phraseAlts
    .concat(cleaned.length ? ['\\b(?:' + cleaned.map(escapeRE).join('|') + ')\\b'] : [])
  let re: RegExp
  try { re = new RegExp('(' + alts.join('|') + ')', 'gi') } catch { return text }
  const out: React.ReactNode[] = []
  let last = 0; let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    // Per-theme coloring (ported from the rich CommentsPanel): a keyword that
    // belongs to a selected theme marks in that theme's palette; everything
    // else (entity terms, dimension evidence) keeps the amber default. The
    // singular/plural fallback covers expandEntityTerms variants — "bugs" in
    // the model matches "bug" in the text, which must keep the theme's color.
    const lower = m[0].toLowerCase()
    const pal = kwPalettes
      ? kwPalettes[lower] ?? kwPalettes[lower + 's'] ?? (lower.endsWith('s') ? kwPalettes[lower.slice(0, -1)] : undefined)
      : undefined
    out.push(pal
      ? <mark key={m.index} style={{ background: pal.light || pal.bg, color: pal.text, borderRadius: 3, padding: '1px 3px', borderBottom: '2px solid ' + pal.border, fontWeight: 600 }}>{m[0]}</mark>
      : <mark key={m.index} style={{ background: '#fff1c2', color: '#854d0e', borderRadius: 3, padding: '0 2px', fontWeight: 600 }}>{m[0]}</mark>)
    last = m.index + m[0].length
    if (m.index === re.lastIndex) re.lastIndex++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

interface FilterRow { id: number; dataset_id: string; row_index: number; data: Record<string, unknown>; dimEvidence?: string[] }

function FilterCard({ row, hlTerms, openFields, schema, kwPalettes }: {
  row: FilterRow; hlTerms: string[]; openFields: SchemaFieldConfig[]; schema: SchemaFieldConfig[]; kwPalettes?: Record<string, KwPalette>
}) {
  var dimEvidence = row.dimEvidence || []
  var texts = openFields
    .map(function(f) { return { field: f.field, label: f.label || f.field, value: String(row.data[f.field] ?? '').trim() } })
    .filter(function(t) { return t.value.length > 0 })

  var metaCols = schema.filter(function(f) {
    return f.type !== 'open-ended' && f.type !== 'id' && f.type !== 'ignore' && f.status !== 'ignored'
  })
  var metaEntries = metaCols.filter(function(f) { return String(row.data[f.field] ?? '').trim().length > 0 })
  var ratingEntries = metaEntries.filter(function(f) { return f.sqt === 'rating' || f.sqt === 'nps' || f.sqt === 'likert' || f.scoreField === true })
  var otherEntries = metaEntries.filter(function(f) { return f.sqt !== 'rating' && f.sqt !== 'nps' && f.sqt !== 'likert' && f.scoreField !== true })
  var allMeta = ratingEntries.concat(otherEntries)

  var primaryRating = ratingEntries.find(function(f) { return f.scoreField === true }) || ratingEntries[0]
  var borderColor = primaryRating ? (fieldColorFor(row.data[primaryRating.field], primaryRating) || T.border) : T.border
  var hasMoreMeta = allMeta.length > 3

  var [metaExpanded, setMetaExpanded] = useState(false)
  var [textExpanded, setTextExpanded] = useState(false)
  var [isClamped, setIsClamped] = useState(false)
  var textRef = useRef<HTMLDivElement>(null)
  useEffect(function() {
    var el = textRef.current; if (!el) return
    setIsClamped(el.scrollHeight > el.clientHeight + 1)
  }, [texts.length, textExpanded])

  function formatFieldValue(val: unknown, f: SchemaFieldConfig): string {
    var s = String(val ?? '').trim()
    if (!s) return s
    if (f.type === 'date') { var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[2] + '/' + m[3] + '/' + m[1].slice(2) }
    return s
  }

  return (
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '12px 14px', borderLeft: '4px solid ' + borderColor, boxShadow: '0 1px 4px rgba(0,0,0,.04)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: allMeta.length > 0 ? 8 : 0 }}>
        <div ref={textRef} style={{ fontSize: 13, color: T.text, lineHeight: 1.75, ...(textExpanded ? {} : { display: '-webkit-box' as const, WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }) }}>
          {texts.map(function(t, i) {
            return (
              <div key={t.field} style={{ marginBottom: i < texts.length - 1 ? 6 : 0 }}>
                {openFields.length > 1 && (<div style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>{t.label}</div>)}
                <div>{highlightTerms(t.value, hlTerms, dimEvidence, kwPalettes)}</div>
              </div>
            )
          })}
          {texts.length === 0 && (<span style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>(no text in this row)</span>)}
        </div>
        {(isClamped || textExpanded) && (
          <button onClick={function() { setTextExpanded(!textExpanded) }} style={{ alignSelf: 'flex-start', marginTop: 4, padding: 0, background: 'transparent', border: 'none', color: T.accent, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            {textExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      {allMeta.length > 0 && (
        <div style={{ position: 'relative', marginTop: 2 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', maxHeight: metaExpanded ? 'none' : 49, overflow: 'hidden' }}>
            {allMeta.map(function(f) {
              var val = row.data[f.field]
              var isRating = f.sqt === 'rating' || f.sqt === 'nps' || f.sqt === 'likert' || f.scoreField === true
              var color = isRating ? (fieldColorFor(val, f) || T.textMid) : null
              return (
                <span key={f.field} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: color ? color + '15' : T.bg, color: color || T.textMute, border: '1px solid ' + (color ? color + '40' : T.border), display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: isRating ? 700 : 500 }}>
                  <span style={{ opacity: 0.7, fontWeight: isRating ? 500 : 400 }}>{f.label && f.label !== f.field ? f.label : f.field}:</span> {formatFieldValue(val, f)}
                </span>
              )
            })}
          </div>
          {hasMoreMeta && !metaExpanded && (
            <button onClick={function() { setMetaExpanded(true) }} style={{ position: 'absolute', right: 0, bottom: 0, fontSize: 11, padding: '2px 8px', borderRadius: 10, background: T.bg, color: T.textFaint, border: '1px solid ' + T.border, cursor: 'pointer', fontWeight: 600, boxShadow: '-8px 0 6px -2px white' }}>+ more</button>
          )}
          {hasMoreMeta && metaExpanded && (
            <button onClick={function() { setMetaExpanded(false) }} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: T.accentBg, color: T.accent, border: '1px solid ' + T.accentMid, cursor: 'pointer', fontWeight: 600, marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 2 }}>{'−'} Less</button>
          )}
        </div>
      )}
    </div>
  )
}

interface Props {
  rows: FilterRow[]
  total: number
  loading: boolean
  error: string
  hlTerms: string[]                 // theme keywords + entity terms to highlight
  chips: React.ReactNode            // active-filter chips rendered in the header
  openFields: SchemaFieldConfig[]
  schema: SchemaFieldConfig[]
  datasetId: string
  /** Lowercased theme keyword → its theme's palette (per-theme colored marks). */
  kwPalettes?: Record<string, KwPalette>
  /** Enables the AI Summary button (mirrors the header AI toggle). */
  aiEnabled?: boolean
  /** What the active filters describe — names the summary request. */
  summaryTopic?: string
}

export default function FilteredCommentsPanel({ rows, total, loading, error, hlTerms, chips, openFields, schema, datasetId, kwPalettes, aiEnabled, summaryTopic }: Props) {
  var _key = 'filtered_comments_' + datasetId
  var [gridCols, setGridCols] = useState(2)
  var [restored, setRestored] = useState(false)
  useEffect(function() {
    var saved = readSession<{ gridCols: number }>(_key)
    if (saved?.gridCols) setGridCols(saved.gridCols)
    setRestored(true)
  }, [_key])
  useEffect(function() { if (restored) writeSession(_key, { gridCols }) }, [restored, gridCols, _key])

  var [visibleCount, setVisibleCount] = useState(50)

  // ── AI summary (ported from the rich CommentsPanel, platform-key era: no
  // BYO key needed — the mine route falls back to the server key and logs
  // per-org usage). Summarizes an even sample of the FILTERED rows.
  var [aiSummary, setAiSummary] = useState<string | null>(null)
  var [summaryLoading, setSummaryLoading] = useState(false)
  var [summaryError, setSummaryError] = useState<string | null>(null)
  useEffect(function() { setAiSummary(null); setSummaryError(null) }, [rows])
  async function generateSummary() {
    if (!rows.length || summaryLoading) return
    setSummaryLoading(true)
    setSummaryError(null)
    setAiSummary(null)
    try {
      var texts: string[] = []
      var step = Math.max(1, rows.length / Math.min(60, rows.length))
      for (var i = 0; texts.length < 60 && Math.floor(i * step) < rows.length; i++) {
        var r = rows[Math.floor(i * step)]
        var t = openFields.map(function(f) { return String(r.data[f.field] ?? '') }).join(' ').trim()
        if (t) texts.push((texts.length + 1) + '. ' + t)
      }
      if (!texts.length) throw new Error('No text to summarize')
      var topic = summaryTopic || 'the filtered comments'
      var res = await fetch('/api/datasets/' + datasetId + '/mine-themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: texts, fieldName: 'summary', schemaCtx: 'summary request for the comments matching: ' + topic }),
      })
      var data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Summary failed')
      setAiSummary(data.summary || 'Summary generated.')
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'Summary failed')
    }
    setSummaryLoading(false)
  }

  type SortClause = { field: string; dir: 'asc' | 'desc' }
  var [sortClauses, setSortClauses] = useState<SortClause[]>([])
  var [showSortModal, setShowSortModal] = useState(false)
  var [draftClauses, setDraftClauses] = useState<SortClause[]>([])

  function openSortModal() { setDraftClauses(sortClauses.slice()); setShowSortModal(true) }
  function applySortModal() { setSortClauses(draftClauses.filter(function(c) { return c.field !== '' })); setShowSortModal(false); setVisibleCount(50) }
  function addDraftClause() { setDraftClauses(function(prev) { return prev.concat([{ field: '__length__', dir: 'desc' }]) }) }
  function removeDraftClause(i: number) { setDraftClauses(function(prev) { return prev.filter(function(_, j) { return j !== i }) }) }
  function updateDraftClause(i: number, patch: Partial<SortClause>) { setDraftClauses(function(prev) { return prev.map(function(c, j) { return j === i ? { ...c, ...patch } : c }) }) }

  var metaCols = useMemo(function() {
    return schema.filter(function(f) { return f.type !== 'open-ended' && f.type !== 'id' && f.type !== 'ignore' && f.status !== 'ignored' })
  }, [schema])

  var sorted = useMemo(function() {
    if (sortClauses.length === 0) return rows
    var maxTextLen = function(row: FilterRow): number { return openFields.reduce(function(max, f) { return Math.max(max, String(row.data[f.field] ?? '').length) }, 0) }
    var getSortVal = function(row: FilterRow, field: string): number | string {
      if (field === '__length__') return maxTextLen(row)
      var v = String(row.data[field] ?? ''); var n = parseFloat(v); return isNaN(n) ? v : n
    }
    var copy = rows.slice()
    copy.sort(function(a, b) {
      for (var ci = 0; ci < sortClauses.length; ci++) {
        var c = sortClauses[ci]; var va = getSortVal(a, c.field); var vb = getSortVal(b, c.field)
        var cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
        if (cmp !== 0) return c.dir === 'asc' ? cmp : -cmp
      }
      return 0
    })
    return copy
  }, [rows, sortClauses, openFields])

  var visible = sorted.slice(0, visibleCount)
  var hasMore = sorted.length > visibleCount

  var scrollRef = useRef<HTMLDivElement | null>(null)
  var sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(function() {
    var el = sentinelRef.current; var root = scrollRef.current
    if (!el || !root) return
    var observer = new IntersectionObserver(function(entries) { if (entries[0].isIntersecting) setVisibleCount(function(n) { return n + 50 }) }, { root: root, threshold: 0.1 })
    observer.observe(el)
    return function() { observer.disconnect() }
  }, [sorted])
  useEffect(function() { setVisibleCount(50) }, [sortClauses, rows])

  var builtIns = [{ value: '__length__', label: 'Response length' }]
  var schemaOpts = metaCols.map(function(f) { return { value: f.field, label: f.label && f.label !== f.field ? f.label : f.field } })
  var allOpts = builtIns.concat(schemaOpts)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header: active filter chips + count + sort/grid */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid ' + T.border, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>{chips}</div>
        {!loading && (
          <span style={{ fontSize: 12, color: T.textMute }}>{rows.length.toLocaleString()} of {total.toLocaleString()} comment{total !== 1 ? 's' : ''}</span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {aiEnabled && !loading && rows.length > 0 && !aiSummary && (
            <button onClick={function() { void generateSummary() }} disabled={summaryLoading}
              title={'Summarize the ' + rows.length.toLocaleString() + ' filtered comments with AI'}
              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: summaryLoading ? 'default' : 'pointer', border: '1px solid ' + T.accentMid, background: T.accentBg, color: T.accent, fontWeight: 700, opacity: summaryLoading ? 0.6 : 1 }}>
              {summaryLoading ? 'Summarizing…' : '⧡ AI Summary'}
            </button>
          )}
          <button onClick={openSortModal} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + (sortClauses.length > 0 ? T.accent : T.border), background: sortClauses.length > 0 ? T.accentBg : T.bg, color: sortClauses.length > 0 ? T.accent : T.textMid, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 12 }}>{'⇅'}</span> Sort
            {sortClauses.length > 0 && (<span style={{ fontSize: 10, background: T.accent, color: '#fff', borderRadius: 10, padding: '0 5px', lineHeight: '16px' }}>{sortClauses.length}</span>)}
          </button>
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid ' + T.border }}>
            {[1, 2, 3, 4].map(function(n) {
              var active = gridCols === n
              return (<button key={n} onClick={function() { setGridCols(n) }} title={n + ' column' + (n > 1 ? 's' : '')} style={{ padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none', borderRight: n < 4 ? '1px solid ' + T.border : 'none', background: active ? T.accent : T.bg, color: active ? '#fff' : T.textMid }}>{n}</button>)
            })}
          </div>
        </span>
      </div>

      {/* AI summary strip */}
      {(aiSummary || summaryError) && (
        <div style={{ padding: '10px 20px', borderBottom: '1px solid ' + T.border, flexShrink: 0 }}>
          {summaryError && (
            <div style={{ fontSize: 11, color: '#dc2626' }}>{summaryError}</div>
          )}
          {aiSummary && (
            <div style={{ background: T.accentBg, border: '1px solid ' + T.accentMid, borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.accent, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '.05em' }}>
                {'⧡'} AI summary{summaryTopic ? ' — ' + summaryTopic : ''}
              </div>
              <div style={{ fontSize: 12, color: T.textMid, lineHeight: 1.6 }}>{aiSummary}</div>
              <button onClick={function() { setAiSummary(null) }}
                style={{ marginTop: 6, fontSize: 11, color: T.textFaint, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sort modal */}
      {showSortModal && (
        <div onClick={function(e) { if (e.target === e.currentTarget) setShowSortModal(false) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,.18)', width: 460, maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Sort order</div>
              <button onClick={function() { setShowSortModal(false) }} style={{ fontSize: 18, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {draftClauses.length === 0 && (<div style={{ fontSize: 12, color: T.textFaint, textAlign: 'center', padding: '20px 0' }}>No sort applied. Click <strong>+ Add sort level</strong> to sort by a field.</div>)}
              {draftClauses.map(function(clause, i) {
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bg, border: '1px solid ' + T.border, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, background: T.accentBg, color: T.accent, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
                    <select value={clause.field} onChange={function(e) { updateDraftClause(i, { field: e.target.value }) }} style={{ flex: 1, fontSize: 12, padding: '5px 8px', borderRadius: 7, border: '1px solid ' + T.borderMid, background: '#fff', color: T.text, cursor: 'pointer' }}>
                      <optgroup label="Built-in">{builtIns.map(function(o) { return <option key={o.value} value={o.value}>{o.label}</option> })}</optgroup>
                      {schemaOpts.length > 0 && (<optgroup label="Dataset fields">{schemaOpts.map(function(o) { return <option key={o.value} value={o.value}>{o.label}</option> })}</optgroup>)}
                    </select>
                    <div style={{ display: 'flex', borderRadius: 7, border: '1px solid ' + T.borderMid, overflow: 'hidden', flexShrink: 0 }}>
                      {(['asc', 'desc'] as const).map(function(d) {
                        var active = clause.dir === d
                        return (<button key={d} onClick={function() { updateDraftClause(i, { dir: d }) }} style={{ fontSize: 11, fontWeight: 600, padding: '5px 9px', border: 'none', background: active ? T.accent : '#fff', color: active ? '#fff' : T.textMute, cursor: 'pointer' }}>{d === 'asc' ? 'A→Z' : 'Z→A'}</button>)
                      })}
                    </div>
                    <button onClick={function() { removeDraftClause(i) }} style={{ flexShrink: 0, fontSize: 16, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}>×</button>
                  </div>
                )
              })}
              {draftClauses.length < 5 && (<button onClick={addDraftClause} style={{ fontSize: 12, fontWeight: 600, padding: '9px', borderRadius: 9, border: '1px dashed ' + T.borderMid, background: 'transparent', color: T.textMute, cursor: 'pointer', marginTop: 2 }}>+ Add sort level</button>)}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid ' + T.border, display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
              <button onClick={function() { setDraftClauses([]) }} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 8, border: '1px solid ' + T.border, background: T.bg, color: T.textMid, cursor: 'pointer', fontWeight: 500 }}>Clear</button>
              <button onClick={function() { setShowSortModal(false) }} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 8, border: '1px solid ' + T.border, background: '#fff', color: T.textMid, cursor: 'pointer', fontWeight: 500 }}>Cancel</button>
              <button onClick={applySortModal} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 8, border: 'none', background: T.accent, color: '#fff', cursor: 'pointer', fontWeight: 700 }}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* Results grid */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
        {loading && (<div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><LottieLoader size={80} message="Filtering comments…" /></div>)}
        {!loading && error && (<div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px' }}>{error}</div>)}
        {!loading && !error && rows.length === 0 && (<div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>No comments match all selected filters.</div>)}
        {!loading && !error && rows.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)', gap: 10, alignItems: 'stretch' }}>
            {visible.map(function(row) { return <FilterCard key={row.dataset_id + ':' + row.row_index} row={row} hlTerms={hlTerms} openFields={openFields} schema={schema} kwPalettes={kwPalettes} /> })}
          </div>
        )}
        {hasMore && (<div ref={sentinelRef} style={{ padding: '10px 0', textAlign: 'center' }}><span style={{ fontSize: 11, color: T.textFaint }}>Loading more… ({sorted.length - visibleCount} remaining)</span></div>)}
        {!loading && !error && total > rows.length && (<div style={{ fontSize: 11, color: T.textFaint, textAlign: 'center', padding: '4px 0 8px' }}>Showing first {rows.length.toLocaleString()} of {total.toLocaleString()} matching comments.</div>)}
      </div>
    </div>
  )
}
