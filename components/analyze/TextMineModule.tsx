'use client'
// components/analyze/TextMineModule.tsx
// Main TextMine client shell. Owns all state for the 4 sub-tabs.
// Fetches rows from the paginated rows API, mines themes via server proxy,
// saves theme model back to dataset_state. Ana proprietary prompts stay server-side.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { injectSignalTier, SIGNAL_TIER_ORDER_REDDIT, SIGNAL_TIER_ORDER_SUBSTACK } from '@/lib/signalTier'
import { readSession, writeSession } from '@/lib/useSessionState'
import {
  Theme, ThemeModel, THEME_PALETTE,
  recountThemes, sampleSize95, evenSample,
  commentMatchesTheme, getRowText, sentColor, sentBg,
  ratingColor,
} from '@/lib/themeUtils'
import { applyFilters, filterCount } from '@/lib/filterUtils'
import type { Filters } from '@/lib/filterUtils'
import { sigTest, welchTTest } from '@/lib/statsUtils'
import { smartOrder } from '@/lib/scaleUtils'
import { resolveAlias } from '@/lib/aliasUtils'
import { useFilters } from '@/components/analyze/FilterContext'
import { useRows } from '@/components/analyze/RowsContext'
import ThemePopover from '@/components/analyze/textmine/ThemePopover'
import SignalsView from '@/components/analyze/textmine/SignalsView'
import SearchPanel from '@/components/analyze/textmine/SearchPanel'
import BreakdownDist from '@/components/analyze/textmine/BreakdownDist'
import OpinionPopover from '@/components/analyze/textmine/OpinionPopover'
import HelpHint from '@/components/analyze/textmine/HelpHint'
import EntitiesCard from '@/components/analyze/EntitiesCard'
import TaxonomyModule from '@/components/analyze/TaxonomyModule'
import LottieLoader from '@/components/ui/LottieLoader'
import { useOrgAiMode } from '@/lib/hooks/useOrgAiMode'

// Heaviest tab-specific and modal sub-components — split out of the
// textmine route bundle so the Themes tab (default landing) ships less JS.
// CommentsPanel only mounts when the user opens the Comments tab; WordCloud
// only on the Theme Clouds tab; ThemeEditor only when the modal opens.
const ThemeEditor = dynamic(
  function() { return import('@/components/analyze/textmine/ThemeEditor') },
  {
    ssr: false,
    loading: function() {
      return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#ffffff', borderRadius: 16, padding: '40px 32px', textAlign: 'center', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}>
            <LottieLoader size={80} message="Loading theme editor..." />
          </div>
        </div>
      )
    },
  }
)
const WordCloud = dynamic(
  function() { return import('@/components/analyze/textmine/WordCloud') },
  {
    ssr: false,
    loading: function() {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <LottieLoader size={120} message="Loading theme clouds..." />
        </div>
      )
    },
  }
)
const EntityCloud = dynamic(
  function() { return import('@/components/analyze/textmine/EntityCloud') },
  {
    ssr: false,
    loading: function() {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
          <LottieLoader size={48} />
        </div>
      )
    },
  }
)
const EntityBreakdownDist = dynamic(
  function() { return import('@/components/analyze/textmine/EntityBreakdownDist') },
  {
    ssr: false,
    loading: function() {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
          <LottieLoader size={48} />
        </div>
      )
    },
  }
)
const EntityCompareTab = dynamic(
  function() { return import('@/components/analyze/textmine/EntityCompareTab') },
  {
    ssr: false,
    loading: function() {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <LottieLoader size={80} />
        </div>
      )
    },
  }
)
const CommentsPanel = dynamic(
  function() { return import('@/components/analyze/textmine/CommentsPanel') },
  {
    ssr: false,
    loading: function() {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, paddingTop: 60, paddingBottom: 60 }}>
          <LottieLoader size={96} message="Loading comments..." />
        </div>
      )
    },
  }
)
const EntityCommentsPanel = dynamic(
  function() { return import('@/components/analyze/textmine/EntityCommentsPanel') },
  {
    ssr: false,
    loading: function() {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, paddingTop: 60, paddingBottom: 60 }}>
          <LottieLoader size={96} message="Loading comments..." />
        </div>
      )
    },
  }
)
import { INDUSTRY_LABELS, type Industry } from '@/lib/industryDefaults'

import { T } from '@/lib/analyzeTheme'
import type { SchemaFieldConfig as SchemaField } from '@/lib/analyzeTypes'

interface SchemaConfig {
  fields: SchemaField[]
  autoDetected: boolean
  version: number
}

interface DatasetAnalytics {
  totalRows: number
  computedAt: string
  fieldSummaries?: Record<string, unknown>
}

interface Props {
  datasetId:         string
  schema:            SchemaConfig
  analytics:         DatasetAnalytics | null
  savedThemeModel:   ThemeModel | null
  datasetSource?:    'upload' | 'study' | 'google_reviews' | 'reddit' | 'townhall' | 'substack' | 'collection'
  anaLibrary?:       string | null
  initialOpenEditor?: boolean
}

type SubTab = 'themes' | 'clouds' | 'compare' | 'comments' | 'dimensions'

// ─── ApiKeyModal ──────────────────────────────────────────────────────────────

function ApiKeyModal({ onSave, onClose }: { onSave: (key: string) => void; onClose: () => void }) {
  const [val, setVal] = useState('')
  const [show, setShow] = useState(false)

  function handleSave() {
    const k = val.trim()
    if (!k) return
    try { localStorage.setItem('sentimetrx_tm_apikey', k) } catch { /* ignore */ }
    onSave(k)
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 16, width: 480, padding: '28px 28px 24px', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}
        onClick={function(e) { e.stopPropagation() }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: T.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
            {'\uD83D\uDD11'}
          </div>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: T.text, margin: 0 }}>AI API Key</h2>
            <p style={{ fontSize: 12, color: T.textMute, margin: 0 }}>Stored only in this browser. Never sent anywhere except Anthropic.</p>
          </div>
        </div>
        <div style={{ background: T.bg, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: T.textMid, margin: '0 0 8px', lineHeight: 1.6 }}>To enable AI theme mining:</p>
          <ol style={{ fontSize: 12, color: T.textMid, margin: 0, paddingLeft: 18, lineHeight: 2 }}>
            <li>Go to <a href="https://console.anthropic.com/keys" target="_blank" rel="noopener" style={{ color: T.accent, fontWeight: 600 }}>console.anthropic.com/keys</a></li>
            <li>Create a free account if you do not have one</li>
            <li>Generate a new API key and paste it below</li>
          </ol>
        </div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 6 }}>
          API Key
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            type={show ? 'text' : 'password'}
            value={val}
            onChange={function(e) { setVal(e.target.value) }}
            onKeyDown={function(e) { if (e.key === 'Enter') handleSave() }}
            placeholder="sk-ant-api03-..."
            style={{ flex: 1, padding: '9px 12px', fontSize: 13, border: '2px solid ' + T.border, borderRadius: 8, outline: 'none', fontFamily: 'monospace', color: T.text, background: '#fff' }}
          />
          <button
            onClick={function() { setShow(function(s) { return !s }) }}
            style={{ padding: '9px 12px', border: '1px solid ' + T.border, borderRadius: 8, background: T.bg, color: T.textMute, cursor: 'pointer', fontSize: 12 }}
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 16px', fontSize: 12, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, color: T.textMid, borderRadius: 8, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!val.trim()}
            style={{ padding: '9px 20px', fontSize: 12, fontWeight: 700, background: val.trim() ? T.accent : T.borderMid, color: 'white', border: 'none', borderRadius: 8, cursor: val.trim() ? 'pointer' : 'not-allowed' }}
          >
            Save key
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SamplingControl ──────────────────────────────────────────────────────────

function SamplingControl({ samplePct, setSamplePct, total, lastRunPct, onRerun }: {
  samplePct: number; setSamplePct: (n: number) => void
  total: number; lastRunPct: number | null; onRerun: () => void
}) {
  const defaultN = sampleSize95(total)
  const defaultPct = total > 0 ? Math.round(defaultN / total * 100) : 100
  const isDefault = samplePct === 0
  const activePct = isDefault ? defaultPct : samplePct
  const effectiveN = Math.max(1, Math.round(total * (activePct / 100)))
  const moe = effectiveN > 0 ? Math.round(196 * Math.sqrt(0.25 / effectiveN)) / 100 : 0.5

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Discovery Sample
        </span>
        {!isDefault && (
          <button
            onClick={function() { setSamplePct(0) }}
            style={{ fontSize: 10, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: T.accentBg, color: T.accent, border: '1px solid ' + T.accentMid, cursor: 'pointer' }}
          >
            Reset
          </button>
        )}
        {isDefault && (
          <span style={{ fontSize: 10, fontWeight: 600, color: T.green, padding: '1px 8px', borderRadius: 10, background: T.greenBg, border: '1px solid ' + T.greenMid }}>
            Optimal
          </span>
        )}
      </div>
      <input
        type="range" min="5" max="100" step="5" value={activePct}
        onChange={function(e) {
          const v = Number(e.target.value)
          setSamplePct(v === defaultPct ? 0 : v)
        }}
        style={{ width: '100%', accentColor: T.accent, marginBottom: 6 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: isDefault ? T.green : T.accent }}>
          {activePct}% &middot; {effectiveN.toLocaleString()} rows
        </span>
        <span style={{ fontSize: 10, color: T.textFaint }}>{'\u00b1'}{(moe * 100).toFixed(0)}% MoE</span>
      </div>
      {(function() {
        const hasChanged = lastRunPct !== null && lastRunPct !== samplePct
        if (!hasChanged) return null
        return (
          <button
            onClick={onRerun}
            style={{ width: '100%', marginTop: 8, padding: '7px 0', fontSize: 12, fontWeight: 700, background: T.accent, color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer' }}
          >
            Re-run with new sample
          </button>
        )
      })()}
    </div>
  )
}

// ─── BreakdownSelector ────────────────────────────────────────────────────────

function BreakdownSelector({ catFields, breakdownField, setBreakdownField, schema, parsedData, analytics, selectedValues, setSelectedValues }: {
  catFields: string[]
  breakdownField: string | null
  setBreakdownField: (f: string | null) => void
  schema: SchemaField[]
  parsedData: Record<string, unknown>[]
  analytics: any
  selectedValues: Set<string>
  setSelectedValues: (s: Set<string>) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  function getValues(field: string): string[] {
    // Use analytics fieldSummaries for authoritative value list (covers all rows, not just sample)
    var summary = analytics?.fieldSummaries?.[field]
    var raw: string[] | null = null
    if (summary?.values) raw = summary.values as string[]
    else if (summary?.topN) raw = summary.topN as string[]
    else {
      var s = schema.find(function(f) { return f.field === field })
      if (s && s.values) raw = s.values
    }
    if (!raw) {
      // Fallback: extract from sampled rows (already aliased at load time)
      var vals = new Set<string>()
      parsedData.forEach(function(r) {
        var v = r[field]
        if (v != null && String(v).trim() !== '') vals.add(String(v))
      })
      return Array.from(vals).sort()
    }
    // Apply value aliases so breakdown values match aliased row data
    var sf = schema.find(function(f) { return f.field === field })
    var aliases = (sf as any)?.valueAliases
    if (aliases && Object.keys(aliases).length > 0) {
      var seen = new Set<string>()
      return raw.map(function(v) { return aliases[v] || v }).filter(function(v) { if (seen.has(v)) return false; seen.add(v); return true })
    }
    return raw
  }

  function handleFieldClick(f: string) {
    if (breakdownField !== f) {
      const vals = getValues(f)
      setBreakdownField(f)
      setSelectedValues(new Set(vals))
      setExpanded(f)
    } else {
      setExpanded(function(prev) { return prev === f ? null : f })
    }
  }

  if (!catFields.length) return null

  return (
    <div style={{ borderTop: '1px solid ' + T.border, overflowY: 'auto' }}>
      <div style={{ padding: '10px 14px 6px', fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.1em', textTransform: 'uppercase' }}>
        Breakdown by
      </div>
      <button
        onClick={function() { setBreakdownField(null); setSelectedValues(new Set()); setExpanded(null) }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: breakdownField === null ? T.accentBg : 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', borderLeft: '3px solid ' + (breakdownField === null ? T.accent : 'transparent') }}
      >
        <span style={{ fontSize: 12, fontWeight: breakdownField === null ? 700 : 400, color: breakdownField === null ? T.accent : T.textMid }}>None</span>
      </button>
      {catFields.map(function(f) {
        const isActive = breakdownField === f
        const isOpen = expanded === f
        const vals = (isOpen || isActive) ? getValues(f) : []
        const selCount = isActive ? selectedValues.size : 0
        const totalCount = isActive ? getValues(f).length : 0
        const isFiltered = isActive && selCount < totalCount && selCount > 0
        return (
          <div key={f}>
            <button
              onClick={function() { handleFieldClick(f) }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: isActive ? T.amberBg : 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', borderLeft: '3px solid ' + (isActive ? T.amber : 'transparent') }}
            >
              <span style={{ fontSize: 11, color: T.amber }}>{'\u2261'}</span>
              <span style={{ fontSize: 12, fontWeight: isActive ? 700 : 400, color: isActive ? T.amber : T.textMid, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: isFiltered ? 'italic' : 'normal' }}>
                {f}
              </span>
              {isFiltered && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: T.amber, color: 'white', flexShrink: 0 }}>
                  {selCount}/{totalCount}
                </span>
              )}
              <span style={{ fontSize: 10, color: T.textFaint, marginLeft: 2 }}>{isOpen ? '\u25b2' : '\u25bc'}</span>
            </button>
            {isOpen && isActive && vals.length > 0 && (
              <div style={{ margin: '2px 10px 6px 10px', background: T.bg, borderRadius: 8, border: '1px solid ' + T.border, padding: '8px 10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={vals.every(function(v) { return selectedValues.has(String(v)) })}
                    onChange={function() {
                      const all = vals.every(function(v) { return selectedValues.has(String(v)) })
                      setSelectedValues(all ? new Set<string>() : new Set<string>(vals))
                    }}
                    style={{ width: 13, height: 13, accentColor: T.amber }}
                  />
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.textMid }}>Select all</span>
                </label>
                <div style={{ height: 1, background: T.border, marginBottom: 6 }} />
                {vals.map(function(v) {
                  return (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedValues.has(v)}
                        onChange={function() {
                          const next = new Set(selectedValues)
                          if (next.has(v)) next.delete(v); else next.add(v)
                          setSelectedValues(next)
                        }}
                        style={{ width: 13, height: 13, accentColor: T.amber }}
                      />
                      <span style={{ fontSize: 11, color: T.textMid }}>{v}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── CompareTab (multi-field breakdown with significance) ─────────────────────

function CompareTab({ themes, parsedData, schema, activeField, themeColors, breakdownFields, setBreakdownFields, onDrillTheme, viewMode, setViewMode, smartAxes, setSmartAxes, ratingField }: {
  themes: ThemeModel | null
  parsedData: Record<string, unknown>[]
  schema: SchemaField[]
  activeField: string | null
  themeColors: Record<number, typeof THEME_PALETTE[0]>
  breakdownFields: string[]
  setBreakdownFields: (f: string[]) => void
  onDrillTheme: (t: Theme, group?: string) => void
  viewMode: 'group' | 'theme'
  setViewMode: (v: 'group' | 'theme') => void
  smartAxes: boolean
  setSmartAxes: (v: boolean) => void
  ratingField?: string | null
}) {
  var [showSummary, setShowSummary] = useState(false)
  var [copied, setCopied] = useState(false)
  var [pinnedSig, setPinnedSig] = useState<string | null>(null)
  var [pinnedSigData, setPinnedSigData] = useState<{ dir: string; text: string; color: string } | null>(null)
  var [copiedSig, setCopiedSig] = useState(false)
  var sigLeaveTimer = useRef<any>(null)
  var [sigPopRect, setSigPopRect] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  if (!themes) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 14, padding: 40 }}>
        <div style={{ fontSize: 36 }}>{'\uD83D\uDCCA'}</div>
        <p style={{ fontSize: 14, color: T.textMute, textAlign: 'center', maxWidth: 320 }}>
          Run a TextMine analysis first, then return here to compare themes across segments.
        </p>
      </div>
    )
  }

  var catFields = schema.filter(function(f) { return f.type === 'categorical' }).map(function(f) { return f.field })
  var field = activeField || themes!.fieldName
  var fieldLabel = function(f: string) {
    var sf = schema.find(function(s) { return s.field === f })
    return (sf && sf.label && sf.label !== f) ? sf.label : f
  }

  var toggleField = function(f: string) {
    setBreakdownFields(
      breakdownFields.includes(f)
        ? breakdownFields.filter(function(x) { return x !== f })
        : breakdownFields.concat([f])
    )
  }

  if (!catFields.length) {
    return (<div style={{ padding: 24, color: T.textMute, fontSize: 13 }}>No categorical fields available for comparison.</div>)
  }

  // ── Compute stats ────────────────────────────────────────────────────────
  var groupKey = function(row: Record<string, unknown>) {
    return breakdownFields.map(function(f) { return String(row[f] ?? '(blank)') }).join(' \u00D7 ')
  }

  var compStats = (function() {
    if (!themes || !themes.themes || !breakdownFields.length || !parsedData.length) return null
    var totalRows = parsedData.length
    var groupMap: Record<string, Record<string, unknown>[]> = {}
    parsedData.forEach(function(r) { var key = groupKey(r); if (!groupMap[key]) groupMap[key] = []; groupMap[key].push(r) })
    var groupKeys = Object.keys(groupMap).sort()

    var groupStats = groupKeys.map(function(gk) {
      var rows = groupMap[gk]
      var groupTotal = rows.length
      var groupPct = Math.round(groupTotal / totalRows * 100)
      var themeCounts = themes.themes.map(function(t) {
        var matches = rows.filter(function(r) { return commentMatchesTheme(String(r[field] || ''), t) })
        var avgRating: number | null = null
        var ratingValues: number[] = []
        if (ratingField && matches.length > 0) {
          matches.forEach(function(r) { var rv = parseFloat(String(r[ratingField] ?? '')); if (!isNaN(rv)) ratingValues.push(rv) })
          if (ratingValues.length > 0) avgRating = Math.round(ratingValues.reduce(function(a, b) { return a + b }, 0) / ratingValues.length * 100) / 100
        }
        return { themeId: t.id, themeName: t.name, count: matches.length, avgRating: avgRating, ratingValues: ratingValues }
      })
      var unclassified = rows.filter(function(r) {
        return String(r[field] || '').trim().length > 0 && !themes.themes.some(function(t) { return commentMatchesTheme(String(r[field] || ''), t) })
      }).length
      return { group: gk, groupTotal: groupTotal, groupPct: groupPct, themeCounts: themeCounts, unclassified: unclassified }
    })

    // Overall avg rating for delta coloring
    var overallRatAvg = 0
    if (ratingField) {
      var rS = 0, rC = 0
      parsedData.forEach(function(r) { var rv = parseFloat(String(r[ratingField] ?? '')); if (!isNaN(rv)) { rS += rv; rC++ } })
      if (rC > 0) overallRatAvg = rS / rC
    }

    var themeStats = themes.themes.map(function(t) {
      var totalMatches = groupStats.reduce(function(s, g) { var tc = g.themeCounts.find(function(tc) { return tc.themeId === t.id }); return s + (tc ? tc.count : 0) }, 0)
      // Collect all rating values per group for this theme (for cross-group t-test)
      var allGroupRatings: Record<string, number[]> = {}
      groupStats.forEach(function(g) {
        var tc = g.themeCounts.find(function(tc) { return tc.themeId === t.id })
        allGroupRatings[g.group] = tc ? tc.ratingValues : []
      })
      var perGroup = groupStats.map(function(g) {
        var tc = g.themeCounts.find(function(tc) { return tc.themeId === t.id })
        var count = tc ? tc.count : 0
        var mentionRate = g.groupTotal > 0 ? Math.round(count / g.groupTotal * 100) : 0
        // Rating significance: this group's ratings vs all other groups' ratings for the same theme
        var ratingSig: { dir: 'higher' | 'lower' | 'ns'; p: number } | null = null
        if (ratingField) {
          var thisRatings = allGroupRatings[g.group] || []
          var restRatings: number[] = []
          Object.keys(allGroupRatings).forEach(function(gk) { if (gk !== g.group) restRatings = restRatings.concat(allGroupRatings[gk]) })
          if (thisRatings.length >= 5 && restRatings.length >= 5) {
            var tt = welchTTest(thisRatings, restRatings)
            if (tt && tt.p < 0.05) ratingSig = { dir: tt.ma > tt.mb ? 'higher' : 'lower', p: tt.p }
          }
        }
        return { group: g.group, count: count, mentionRate: mentionRate, groupTotal: g.groupTotal, groupPct: g.groupPct, avgRating: tc ? tc.avgRating : null, ratingSig: ratingSig }
      })
      return { themeId: t.id, themeName: t.name, totalMatches: totalMatches, perGroup: perGroup }
    })
    return { groupStats: groupStats, themeStats: themeStats, groupKeys: groupKeys, totalRows: totalRows, overallRatAvg: overallRatAvg }
  })()

  // ── Collect outliers ─────────────────────────────────────────────────────
  var outliers = (function() {
    if (!compStats) return []
    var list: { group: string; themeName: string; thisPct: number; restPct: number; dir: string; z: number; groupTotal: number; count: number }[] = []
    compStats!.themeStats.forEach(function(ts) {
      ts.perGroup.forEach(function(g) {
        var sig = sigTest(g.count, g.groupTotal, ts.totalMatches, compStats!.totalRows)
        if (sig && sig.dir !== 'ns') {
          list.push({ group: g.group, themeName: ts.themeName, thisPct: Math.round(sig.p1 * 100), restPct: Math.round(sig.p2 * 100), dir: sig.dir, z: sig.z, groupTotal: g.groupTotal, count: g.count })
        }
      })
    })
    list.sort(function(a, b) { return Math.abs(b.z) - Math.abs(a.z) })
    return list
  })()

  // ── Summary text ─────────────────────────────────────────────────────────
  var summaryText = (function() {
    if (!outliers.length) return 'No statistically significant outliers found (p < 0.05, min n = 30).'
    var lines = ['SEGMENT ANALYSIS SUMMARY', 'Breakdown: ' + breakdownFields.map(fieldLabel).join(' \u00D7 '), 'Generated: ' + new Date().toLocaleDateString(), '\u2500'.repeat(50), '']
    var over = outliers.filter(function(o) { return o.dir === 'over' })
    var under = outliers.filter(function(o) { return o.dir === 'under' })
    if (over.length) {
      lines.push('OVER-INDEXED SEGMENTS (significantly higher than baseline)')
      over.forEach(function(o) { lines.push('\u2022 "' + o.group + '" \u2192 "' + o.themeName + '": ' + o.thisPct + '% vs ' + o.restPct + '% baseline (z=' + o.z.toFixed(1) + ', n=' + o.groupTotal + ')') })
      lines.push('')
    }
    if (under.length) {
      lines.push('UNDER-INDEXED SEGMENTS (significantly lower than baseline)')
      under.forEach(function(o) { lines.push('\u2022 "' + o.group + '" \u2192 "' + o.themeName + '": ' + o.thisPct + '% vs ' + o.restPct + '% baseline (z=' + o.z.toFixed(1) + ', n=' + o.groupTotal + ')') })
    }
    return lines.join('\n')
  })()

  // ── Compare bar component ────────────────────────────────────────────────
  var CompareBar = function(props: { label: string; pct: number; count: number; maxPct: number; color: string; labelColor: string; sig: { dir: string; z: number; p1: number; p2: number } | null; isUnclassified?: boolean; onClick?: () => void; barId?: string; groupName?: string; themeName?: string; avgRating?: number | null; overallRatAvg?: number; ratingSig?: { dir: 'higher' | 'lower' | 'ns'; p: number } | null; byTheme?: boolean }) {
    var sigColor = props.sig && props.sig.dir === 'over' ? '#16a34a' : props.sig && props.sig.dir === 'under' ? '#dc2626' : null
    var sigId = (props.groupName || '') + '::' + (props.themeName || '') + '::' + props.label
    var grpLabel = props.groupName || props.label
    var thLabel = props.themeName || props.label
    var plainEnglish = props.sig ? (
      props.byTheme
        ? (props.sig.dir === 'over'
          ? '"' + grpLabel + '" makes up ' + Math.round(props.sig.p1 * 100) + '% of "' + thLabel + '" responses, significantly higher than its ' + Math.round(props.sig.p2 * 100) + '% share of the rest of the dataset (z-score: ' + props.sig.z.toFixed(1) + '). This theme is over-represented in "' + grpLabel + '".'
          : '"' + grpLabel + '" makes up ' + Math.round(props.sig.p1 * 100) + '% of "' + thLabel + '" responses, significantly lower than its ' + Math.round(props.sig.p2 * 100) + '% share of the rest of the dataset (z-score: ' + props.sig.z.toFixed(1) + '). This theme is under-represented in "' + grpLabel + '".')
        : (props.sig.dir === 'over'
          ? '"' + grpLabel + '" mentions "' + thLabel + '" at ' + Math.round(props.sig.p1 * 100) + '%, which is significantly higher than the ' + Math.round(props.sig.p2 * 100) + '% baseline for other groups (z-score: ' + props.sig.z.toFixed(1) + '). This means this segment is notably more likely to discuss "' + thLabel + '".'
          : '"' + grpLabel + '" mentions "' + thLabel + '" at ' + Math.round(props.sig.p1 * 100) + '%, which is significantly lower than the ' + Math.round(props.sig.p2 * 100) + '% baseline for other groups (z-score: ' + props.sig.z.toFixed(1) + '). This means this segment is notably less likely to discuss "' + thLabel + '".')
    ) : ''
    var ratingPlainEnglish = props.ratingSig && props.avgRating != null ? (
      props.ratingSig.dir === 'higher'
        ? '"' + grpLabel + '" has a significantly higher average rating (' + props.avgRating.toFixed(2) + ') for "' + thLabel + '" compared to other groups (p=' + props.ratingSig.p.toFixed(4) + '). This segment rates this theme notably higher than the rest.'
        : '"' + grpLabel + '" has a significantly lower average rating (' + props.avgRating.toFixed(2) + ') for "' + thLabel + '" compared to other groups (p=' + props.ratingSig.p.toFixed(4) + '). This segment rates this theme notably lower than the rest.'
    ) : ''
    var ratingSigId = sigId + '::rating'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, cursor: props.onClick ? 'pointer' : 'default', position: 'relative' }} onClick={props.onClick}>
        <span style={{ fontSize: 11, color: props.isUnclassified ? T.textFaint : T.textMid, width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, fontStyle: props.isUnclassified ? 'italic' : 'normal' }}>
          {props.label}
        </span>
        <div style={{ flex: 1, height: 10, background: T.bg, borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: Math.max(props.maxPct > 0 ? props.pct / props.maxPct * 100 : 0, props.pct > 0 ? 2 : 0) + '%', background: props.isUnclassified ? T.borderMid : props.color, borderRadius: 5, transition: 'width .5s' }} />
        </div>
        {/* Fixed-width columns: [mention ★] [pct] [n=] [rating ★] [rating] */}
        <span style={{ fontSize: 12, fontWeight: 800, color: sigColor || 'transparent', flexShrink: 0, width: 14, textAlign: 'center', cursor: sigColor ? 'pointer' : 'default' }}
          {...(sigColor ? {
            onMouseEnter: function(e: React.MouseEvent) { if (sigLeaveTimer.current) { clearTimeout(sigLeaveTimer.current); sigLeaveTimer.current = null }; var rect = (e.target as HTMLElement).getBoundingClientRect(); setSigPopRect({ top: rect.bottom + 4, left: Math.max(8, rect.left - 240) }); setPinnedSig(sigId); setPinnedSigData({ dir: props.sig!.dir, text: plainEnglish, color: sigColor! }); setCopiedSig(false) },
            onMouseLeave: function() { sigLeaveTimer.current = setTimeout(function() { setPinnedSig(function(cur: string | null) { return cur === sigId ? null : cur }) }, 400) },
            onClick: function(e: React.MouseEvent) { e.stopPropagation(); var rect = (e.target as HTMLElement).getBoundingClientRect(); setSigPopRect({ top: rect.bottom + 4, left: Math.max(8, rect.left - 240) }); setPinnedSigData({ dir: props.sig!.dir, text: plainEnglish, color: sigColor! }); setPinnedSig(pinnedSig === sigId ? null : sigId); setCopiedSig(false) },
          } : {})}>{sigColor ? '★' : ''}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.text, width: 40, textAlign: 'right', flexShrink: 0 }}>{props.pct}%</span>
        <span style={{ fontSize: 10, color: T.textFaint, width: 52, textAlign: 'right', flexShrink: 0 }}>n={props.count}</span>
        {(function() {
          var rs = props.ratingSig
          var rsColor = rs ? (rs.dir === 'higher' ? '#059669' : '#dc2626') : null
          return <span style={{ fontSize: 10, fontWeight: 800, color: rsColor || 'transparent', width: 14, textAlign: 'center', flexShrink: 0, cursor: rsColor ? 'pointer' : 'default' }}
            {...(rsColor ? {
              onMouseEnter: function(e: React.MouseEvent) { if (sigLeaveTimer.current) { clearTimeout(sigLeaveTimer.current); sigLeaveTimer.current = null }; var rect = (e.target as HTMLElement).getBoundingClientRect(); setSigPopRect({ top: rect.bottom + 4, left: Math.max(8, rect.left - 240) }); setPinnedSig(ratingSigId); setPinnedSigData({ dir: rs!.dir, text: ratingPlainEnglish, color: rsColor! }); setCopiedSig(false) },
              onMouseLeave: function() { sigLeaveTimer.current = setTimeout(function() { setPinnedSig(function(cur: string | null) { return cur === ratingSigId ? null : cur }) }, 400) },
              onClick: function(e: React.MouseEvent) { e.stopPropagation(); var rect = (e.target as HTMLElement).getBoundingClientRect(); setSigPopRect({ top: rect.bottom + 4, left: Math.max(8, rect.left - 240) }); setPinnedSigData({ dir: rs!.dir, text: ratingPlainEnglish, color: rsColor! }); setPinnedSig(pinnedSig === ratingSigId ? null : ratingSigId); setCopiedSig(false) },
            } : {})}>{rsColor ? '★' : ''}</span>
        })()}
        {props.avgRating != null ? (function() {
          var d = props.avgRating! - (props.overallRatAvg || 0)
          var rs = props.ratingSig
          return <span style={{ fontSize: 10, fontWeight: 700, width: 32, textAlign: 'right', flexShrink: 0, color: d > 0.1 ? '#059669' : d < -0.1 ? '#dc2626' : T.textMid }} title={'Avg rating: ' + props.avgRating!.toFixed(2) + ' (' + (d >= 0 ? '+' : '') + d.toFixed(2) + ' vs overall' + (rs ? ', p=' + rs.p.toFixed(4) : '') + ')'}>{props.avgRating!.toFixed(1)}</span>
        })() : ratingField ? <span style={{ width: 32, flexShrink: 0 }} /> : null}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Sticky header + controls */}
      <div style={{ padding: '24px 24px 0', flexShrink: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: '0 0 6px' }}>Group Comparison</h2>
          <span style={{ fontSize: 11, color: T.textMute }}>
            <span style={{ color: '#16a34a', fontWeight: 800 }}>★</span> over-indexed&nbsp;
            <span style={{ color: '#dc2626', fontWeight: 800 }}>★</span> under-indexed&nbsp;
            <span style={{ color: T.textFaint, fontSize: 10 }}>(p &lt; 0.05, min n=30)</span>
          </span>
        </div>
        <p style={{ fontSize: 13, color: T.textMid, margin: 0 }}>Select one or more fields to build segments and compare theme distribution.</p>
      </div>

      {/* Controls card */}
      <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '18px 20px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Segment by <span style={{ fontWeight: 400 }}>(select one or more)</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {catFields.sort(function(a, b) { return fieldLabel(a).localeCompare(fieldLabel(b)) }).map(function(f) {
                var active = breakdownFields.includes(f)
                return (
                  <button key={f} onClick={function() { toggleField(f) }}
                    style={{ padding: '5px 12px', fontSize: 12, fontWeight: active ? 700 : 500, background: active ? T.accentBg : T.bg, color: active ? T.accent : T.textMid, border: '1px solid ' + (active ? T.accent : T.border), borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {active && <span style={{ fontSize: 10 }}>{'\u2713'}</span>}
                    {fieldLabel(f)}
                  </button>
                )
              })}
            </div>
            {breakdownFields.length > 1 && (
              <div style={{ marginTop: 8, fontSize: 11, color: T.textMute }}>
                Segments: <span style={{ fontWeight: 700, color: T.text }}>{breakdownFields.map(fieldLabel).join(' \u00D7 ')}</span>
                <button onClick={function() { setBreakdownFields([]) }} style={{ marginLeft: 8, fontSize: 10, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>clear all</button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
            {/* By Group / By Theme toggle */}
            <div style={{ display: 'flex', background: T.bg, borderRadius: 20, padding: 2, border: '1px solid ' + T.border }}>
              {[['group', 'By Group'], ['theme', 'By Theme']].map(function(pair) {
                var m = pair[0]; var lbl = pair[1]
                return <button key={m} onClick={function() { setViewMode(m as 'group' | 'theme') }}
                  style={{ fontSize: 11, fontWeight: viewMode === m ? 700 : 500, padding: '4px 12px', borderRadius: 18, background: viewMode === m ? T.bgCard : 'transparent', color: viewMode === m ? T.text : T.textMute, border: 'none', cursor: 'pointer', transition: 'all .12s' }}>
                  {lbl}
                </button>
              })}
            </div>
            {/* Smart Axes checkbox */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.textMute, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={smartAxes} onChange={function() { setSmartAxes(!smartAxes) }} style={{ accentColor: T.accent }} />
              Smart Axes
            </label>
            {/* Summarize Findings */}
            {outliers.length > 0 && (
              <button onClick={function() { setShowSummary(true) }}
                style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: T.accentBg, color: T.accent, border: '1px solid ' + T.accentMid, borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                {'\uD83D\uDCCB'} Summarize <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: T.accent, color: 'white' }}>{outliers.length}</span>
              </button>
            )}
          </div>
        </div>
      </div>
      </div>{/* end sticky header */}

      {/* Scrollable results area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
      {/* Stats cards — By Group or By Theme */}
      {compStats && breakdownFields.length > 0 && (function() {
        if (viewMode === 'group') {
          var groupNames = compStats!.groupStats.map(function(g) { return g.group })
          var isSignalTierGroup = breakdownFields.length === 1 && breakdownFields[0] === 'signal_tier'
          var orderedNames: string[]
          if (isSignalTierGroup) {
            var isReddit = groupNames.some(function(n) { return n === 'Mainstream' || n === 'Controversial' || n === 'Fringe' || n === 'Noise' })
            var tierList = isReddit ? SIGNAL_TIER_ORDER_REDDIT : SIGNAL_TIER_ORDER_SUBSTACK
            orderedNames = tierList.filter(function(t) { return groupNames.indexOf(t) >= 0 })
          } else {
            orderedNames = smartAxes ? smartOrder(groupNames).reverse() : groupNames.slice().sort(function(a, b) { return a.localeCompare(b) })
          }
          var groupMap: Record<string, typeof compStats.groupStats[0]> = {}
          compStats!.groupStats.forEach(function(g) { groupMap[g.group] = g })
          var sortedGroups = orderedNames.map(function(n) { return groupMap[n] }).filter(Boolean)
          return (
            <div>
              {sortedGroups.map(function(g) {
                var maxShare = g.themeCounts.reduce(function(m, tc) { return Math.max(m, g.groupTotal > 0 ? Math.round(tc.count / g.groupTotal * 100) : 0) }, 1)
                if (g.unclassified > 0) { var uPct = g.groupTotal > 0 ? Math.round(g.unclassified / g.groupTotal * 100) : 0; if (uPct > maxShare) maxShare = uPct }
                return (
                  <div key={g.group} style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '16px 18px', marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 14 }}>
                      <span style={{ color: T.accent }}>{g.group}</span>
                      <span style={{ fontSize: 12, fontWeight: 400, color: T.textMute, marginLeft: 6 }}>({g.groupPct}% of dataset {'\u00B7'} {g.groupTotal.toLocaleString()} responses)</span>
                    </div>
                    {themes.themes.slice().sort(function(a, b) {
                      // Unclassified always last
                      if (a.name === 'Unclassified' && b.name !== 'Unclassified') return 1
                      if (b.name === 'Unclassified' && a.name !== 'Unclassified') return -1
                      // Sort by within-group frequency descending
                      var aTC = g.themeCounts.find(function(tc) { return tc.themeId === a.id })
                      var bTC = g.themeCounts.find(function(tc) { return tc.themeId === b.id })
                      return (bTC ? bTC.count : 0) - (aTC ? aTC.count : 0)
                    }).map(function(t) {
                      var ti = themes.themes.indexOf(t)
                      var tc = g.themeCounts.find(function(tc) { return tc.themeId === t.id })
                      var count = tc ? tc.count : 0
                      var ts = compStats!.themeStats.find(function(ts) { return ts.themeId === t.id })
                      var pct = g.groupTotal > 0 ? Math.round(count / g.groupTotal * 100) : 0
                      var pal = themeColors[ti] || THEME_PALETTE[0]
                      var sig = sigTest(count, g.groupTotal, ts ? ts.totalMatches : 0, compStats!.totalRows)
                      var pg = ts ? ts.perGroup.find(function(pg) { return pg.group === g.group }) : null
                      return <CompareBar key={t.id} label={t.name} pct={pct} count={count} maxPct={maxShare} color={pal.border} labelColor={pal.text} sig={sig} onClick={function() { onDrillTheme(t, g.group) }} groupName={g.group} themeName={t.name} avgRating={tc ? tc.avgRating : null} overallRatAvg={compStats!.overallRatAvg} ratingSig={pg ? pg.ratingSig : null} />
                    })}
                    {g.unclassified > 0 && <CompareBar label="Unclassified" pct={g.groupTotal > 0 ? Math.round(g.unclassified / g.groupTotal * 100) : 0} count={g.unclassified} maxPct={maxShare} color={T.borderMid} labelColor={T.textFaint} sig={null} isUnclassified={true} />}
                  </div>
                )
              })}
            </div>
          )
        }

        // By Theme view
        // Signal tier colors: map tier label → bar color
        var SIGNAL_TIER_COLORS: Record<string, string> = {
          Mainstream: '#059669', Controversial: '#d97706', Fringe: '#dc2626', Noise: '#9ca3af',
          Resonant: '#059669', Discussed: '#d97706', 'Low Engagement': '#dc2626', Ignored: '#9ca3af',
        }
        var sortedThemes = compStats!.themeStats.slice().sort(function(a, b) {
          return smartAxes ? b.totalMatches - a.totalMatches : a.themeName.localeCompare(b.themeName)
        })
        return (
          <div>
            {sortedThemes.map(function(ts) {
              var ti = compStats!.themeStats.indexOf(ts)
              var pal = themeColors[ti] || THEME_PALETTE[0]
              // Signal tier breakdown: use canonical order; otherwise sort by count
              var isSignalTier = breakdownFields.length === 1 && breakdownFields[0] === 'signal_tier'
              var perGroupSorted = ts.perGroup.slice().sort(function(a, b) {
                if (isSignalTier) {
                  var isReddit = ts.perGroup.some(function(g) { return g.group === 'Mainstream' || g.group === 'Controversial' || g.group === 'Fringe' || g.group === 'Noise' })
                  var tierList = isReddit ? SIGNAL_TIER_ORDER_REDDIT : SIGNAL_TIER_ORDER_SUBSTACK
                  var ai = tierList.indexOf(a.group); if (ai < 0) ai = 99
                  var bi = tierList.indexOf(b.group); if (bi < 0) bi = 99
                  return ai - bi
                }
                return b.count - a.count
              })
              var maxShare = perGroupSorted.reduce(function(m, g) { return Math.max(m, g.groupTotal > 0 ? Math.round(g.count / g.groupTotal * 100) : 0) }, 1) || 1
              var themeObj = themes.themes.find(function(t) { return t.id === ts.themeId })
              return (
                <div key={ts.themeId} style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '16px 18px', marginBottom: 12, borderLeft: '4px solid ' + pal.border }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.text, flex: 1 }}>{ts.themeName}
                      <span style={{ fontSize: 12, fontWeight: 400, color: T.textMute, marginLeft: 6 }}>({compStats!.totalRows > 0 ? Math.round(ts.totalMatches / compStats!.totalRows * 100) : 0}% of dataset {'\u00B7'} {ts.totalMatches.toLocaleString()} responses)</span>
                    </span>
                    {themeObj && <button onClick={function() { onDrillTheme(themeObj!) }} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border + '50', cursor: 'pointer', flexShrink: 0 }}>View comments {'\u2192'}</button>}
                  </div>
                  {perGroupSorted.map(function(g) {
                    // By Theme: penetration rate within this group (what % of this group mentions this theme)
                    // Sig test: is this group's penetration rate different from all other groups combined?
                    var sig = sigTest(g.count, g.groupTotal, ts.totalMatches, compStats!.totalRows)
                    var themePct = g.groupTotal > 0 ? Math.round(g.count / g.groupTotal * 100) : 0
                    var barColor = isSignalTier && SIGNAL_TIER_COLORS[g.group] ? SIGNAL_TIER_COLORS[g.group] : pal.border
                    return <CompareBar key={g.group} label={g.group} pct={themePct} count={g.count} maxPct={maxShare} color={barColor} labelColor={pal.text} sig={sig} onClick={themeObj ? function() { onDrillTheme(themeObj!, g.group) } : undefined} groupName={g.group} themeName={ts.themeName} avgRating={g.avgRating} overallRatAvg={compStats!.overallRatAvg} ratingSig={g.ratingSig} byTheme={true} />
                  })}
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* Empty state */}
      {!breakdownFields.length && (
        <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '40px 24px', textAlign: 'center', color: T.textFaint }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>{'\uD83D\uDC46'}</div>
          <p style={{ fontSize: 13, margin: 0 }}>Select one or more fields above to start comparing themes across segments.</p>
        </div>
      )}

      </div>{/* end scrollable results area */}

      {/* ── Summarize Findings Modal ──────────────────────────────────────── */}
      {showSummary && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={function() { setShowSummary(false) }}>
          <div style={{ background: T.bgCard, borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,.22)', width: '100%', maxWidth: 620, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={function(e) { e.stopPropagation() }}>
            <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: T.text, margin: '0 0 2px' }}>{'\uD83D\uDCCB'} Segment Findings Summary</h3>
                <p style={{ fontSize: 11, color: T.textMute, margin: 0 }}>{outliers.length} statistically significant outlier{outliers.length !== 1 ? 's' : ''} {'\u00B7'} {breakdownFields.map(fieldLabel).join(' \u00D7 ')}</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={function() { navigator.clipboard.writeText(summaryText).then(function() { setCopied(true); setTimeout(function() { setCopied(false) }, 2000) }) }}
                  style={{ padding: '7px 14px', fontSize: 12, fontWeight: 700, background: copied ? T.greenBg : T.accentBg, color: copied ? T.green : T.accent, border: '1px solid ' + (copied ? T.greenMid : T.accentMid), borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {copied ? '\u2713 Copied!' : '\u2767 Copy'}
                </button>
                <button onClick={function() { setShowSummary(false) }} style={{ padding: '7px 10px', fontSize: 14, background: 'transparent', border: '1px solid ' + T.border, borderRadius: 7, cursor: 'pointer', color: T.textMid, lineHeight: 1 }}>{'\u2715'}</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '16px 22px', flex: 1 }}>
              {outliers.length === 0 ? (
                <p style={{ color: T.textMute, fontSize: 13 }}>No statistically significant outliers found.</p>
              ) : (function() {
                var over = outliers.filter(function(o) { return o.dir === 'over' })
                var under = outliers.filter(function(o) { return o.dir === 'under' })
                return (
                  <>
                    {over.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>{'\u25B2'} Over-indexed segments</div>
                        {over.map(function(o, i) {
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', background: T.greenBg, border: '1px solid ' + T.greenMid, borderRadius: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1 }}>★</span>
                              <div style={{ flex: 1 }}>
                                <span style={{ fontWeight: 700, color: T.text, fontSize: 13 }}>{o.group}</span>
                                <span style={{ color: T.textMid, fontSize: 13 }}> mentions </span>
                                <span style={{ fontWeight: 700, color: T.text, fontSize: 13 }}>"{o.themeName}"</span>
                                <span style={{ fontSize: 12, color: T.textMid }}> at <strong style={{ color: '#16a34a' }}>{o.thisPct}%</strong> vs {o.restPct}% baseline</span>
                                <span style={{ fontSize: 10, color: T.textFaint, marginLeft: 6 }}>z={o.z.toFixed(1)} {'\u00B7'} n={o.groupTotal}</span>
                              </div>
                            </div>
                          )
                        })}
                        <div style={{ height: 12 }} />
                      </>
                    )}
                    {under.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>{'\u25BC'} Under-indexed segments</div>
                        {under.map(function(o, i) {
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', background: T.redBg, border: '1px solid ' + T.red + '30', borderRadius: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1 }}>★</span>
                              <div style={{ flex: 1 }}>
                                <span style={{ fontWeight: 700, color: T.text, fontSize: 13 }}>{o.group}</span>
                                <span style={{ color: T.textMid, fontSize: 13 }}> mentions </span>
                                <span style={{ fontWeight: 700, color: T.text, fontSize: 13 }}>"{o.themeName}"</span>
                                <span style={{ fontSize: 12, color: T.textMid }}> at <strong style={{ color: '#dc2626' }}>{o.thisPct}%</strong> vs {o.restPct}% baseline</span>
                                <span style={{ fontSize: 10, color: T.textFaint, marginLeft: 6 }}>z={o.z.toFixed(1)} {'\u00B7'} n={o.groupTotal}</span>
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Fixed-position significance popover — renders outside scroll container */}
      {pinnedSig && pinnedSigData && (
        <div style={{ position: 'fixed', top: sigPopRect.top, left: sigPopRect.left, width: 280, background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.15)', padding: '12px 14px', zIndex: 9999, textAlign: 'left', cursor: 'default' }}
          onMouseEnter={function() { if (sigLeaveTimer.current) { clearTimeout(sigLeaveTimer.current); sigLeaveTimer.current = null } }}
          onMouseLeave={function() { sigLeaveTimer.current = setTimeout(function() { setPinnedSig(null) }, 400) }}
          onClick={function(e) { e.stopPropagation() }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: pinnedSigData.color }}>
              {pinnedSigData.dir === 'over' ? '\u25B2 Over-indexed' : pinnedSigData.dir === 'under' ? '\u25BC Under-indexed' : pinnedSigData.dir === 'higher' ? '\u25B2 Higher rating' : '\u25BC Lower rating'}
            </span>
            <button onClick={function(e) { e.stopPropagation(); setPinnedSig(null) }}
              style={{ fontSize: 14, background: 'transparent', border: 'none', color: T.textFaint, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>{'\u00D7'}</button>
          </div>
          <div style={{ fontSize: 11, color: T.textMid, lineHeight: 1.5, marginBottom: 8 }}>{pinnedSigData.text}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={function(e) { e.stopPropagation(); navigator.clipboard.writeText(pinnedSigData!.text).then(function() { setCopiedSig(true) }) }}
              style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: copiedSig ? T.greenBg : T.bg, color: copiedSig ? T.green : T.textMid, border: '1px solid ' + (copiedSig ? T.greenMid : T.border), cursor: 'pointer' }}>
              {copiedSig ? '\u2713 Copied' : '\u2398 Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}



// ─── Main TextMineModule ───────────────────────────────────────────────────────

export default function TextMineModule({ datasetId, schema, analytics, savedThemeModel, datasetSource, anaLibrary, initialOpenEditor }: Props) {
  const totalRows = analytics?.totalRows ?? 0
  const { rows, rowsLoaded, rowsLoading, rowsError, fetchRows: triggerRowFetch, sampled: rowsSampled, sampledCount, totalRows: rowsTotalRows } = useRows()

  // Fields the user has hidden in the Schema editor. Honored across analysis
  // surfaces — Insights here, the Filter UI server-side, and Charts/Stats
  // already filter on f.type !== 'ignore' / 'id'. The hidden boolean is a
  // separate flag in the schema config; we respect it here for symmetry.
  const hiddenFields: string[] = useMemo(
    () => (schema?.fields || [])
      .filter(function(f: any) { return f.type === 'ignore' || f.type === 'id' || f.hidden === true })
      .map(function(f: any) { return f.field as string }),
    [schema?.fields],
  )

  const [computing, setComputing] = useState(false)
  const [displayThemes, setDisplayThemes] = useState<ThemeModel | null>(null)
  const overallBoxRef = useRef<{ topBoxPct: number; bottomBoxPct: number } | null>(null)
  const [themes, setThemes] = useState<ThemeModel | null>(savedThemeModel || null)
  const [themeSource, setThemeSource] = useState<string | null>((savedThemeModel as any)?.themeSource || (savedThemeModel as any)?.source || null)
  const [themeLibName, setThemeLibName] = useState<string | null>((savedThemeModel as any)?.themeLibName || (savedThemeModel as any)?.libName || null)
  const [samplingInfo, setSamplingInfo] = useState<{ sampled: number; total: number } | null>(null)
  // Server-computed enrichment for theme cards:
  //   topicalWords[themeId]      → top topical words [word, count][] (currently unused)
  //   cooccurrence[themeIdA]     → { themeIdB: rowsMatchingBoth, ... }
  //   cooccurrenceLoaded         → true once the fetch has returned (so the card
  //                                can distinguish "pre-fetch placeholder" from
  //                                "fetch returned, theme has no co-occurrences").
  // Fetched from /api/datasets/[id]/theme-counts with the cooccurrence flag.
  const [serverTopical, setServerTopical] = useState<Record<string, [string, number][]>>({})
  const [serverCoOccurrence, setServerCoOccurrence] = useState<Record<string, Record<string, number>>>({})
  const [cooccurrenceLoaded, setCooccurrenceLoaded] = useState(false)

  // sessionStorage key for persisting UI state across reloads. Initial state
  // is the default (NOT the saved value) so server-render and client-first-
  // render produce identical HTML — otherwise a hydration mismatch fires on
  // any element whose appearance depends on saved state (e.g. the ✓ on the
  // active analyze-field buttons). The restore happens in a useEffect below.
  var _tmKey = 'textMine_' + datasetId

  // Rating field for avg rating display on theme cards / compare
  const ratingFields = schema.fields.filter(function(f) {
    return f.type === 'numeric' && (f.sqt === 'rating' || f.sqt === 'nps' || f.sqt === 'likert' || f.scoreField)
  })

  const [activeField, setActiveField] = useState<string | null>(null)
  const [activeFields, setActiveFields] = useState<string[]>([])
  const [subTab, setSubTab] = useState<SubTab>('themes')
  const [showCommentSearch, setShowCommentSearch] = useState(false)  // collapsible search in the Comments tab
  // Theme | Entity view toggle. Themes (default) emphasises the AI-mined
  // theme model on Themes / Clouds subtabs; Entity flips both to the
  // catalog-driven views. Compare and Signals subtabs are theme-only —
  // entity Compare lives in BreakdownDist on the Themes subtab.
  const [viewBy, setViewBy] = useState<'theme' | 'entity'>('theme')
  const [themesView, setThemesView] = useState<'distribution' | 'cards' | 'signals'>('cards')
  const [signalCutoffs, setSignalCutoffs] = useState<{ mainstream: number; noise: number }>({ mainstream: 70, noise: 30 })
  const [showAllThemes, setShowAllThemes] = useState(false)
  const [compareViewMode, setCompareViewMode] = useState<'group' | 'theme'>('group')
  const [compareSmartAxes, setCompareSmartAxes] = useState(true)
  const [breakdownField, setBreakdownField] = useState<string | null>(null)
  const [compareFields, setCompareFields] = useState<string[]>([])
  const [selectedValues, setSelectedValues] = useState<Set<string>>(function() { return new Set() })
  const [drillTheme, setDrillTheme] = useState<Theme | null>(null)
  const [drillGroup, setDrillGroup] = useState<string | null>(null)
  const [selectedThemes, setSelectedThemes] = useState<Theme[]>([])
  const [previousTab, setPreviousTab] = useState<SubTab>('themes')
  const [opinionWord, setOpinionWord] = useState<string | null>(null)
  const [themePopoverIdx, setThemePopoverIdx] = useState<number | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [ratingField, setRatingField] = useState<string | null>(ratingFields.length > 0 ? ratingFields[0].field : null)
  const [colorMode, setColorMode] = useState<'sentiment' | 'rating'>('sentiment')
  const [hideFlagged, setHideFlagged] = useState(false)
  const [restoredFromSession, setRestoredFromSession] = useState(false)

  // Entity catalog — fetched once on mount (hoisted here so it survives subTab switches).
  const [entityCatalogRows, setEntityCatalogRows]         = useState<import('@/components/analyze/EntitiesCard').EntityRow[]>([])
  const [entityCatalogTotal, setEntityCatalogTotal]       = useState<number | null>(null)
  const [entityCatalogScopeType, setEntityCatalogScopeType] = useState<'dataset' | 'collection' | null>(null)
  const [entityCatalogLoading, setEntityCatalogLoading]   = useState(true)
  const [entityCatalogError, setEntityCatalogError]       = useState('')

  const loadEntityCatalog = useCallback(async function() {
    setEntityCatalogLoading(true)
    setEntityCatalogError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/entities?limit=200')
      if (!res.ok) { setEntityCatalogRows([]); setEntityCatalogTotal(null); return }
      const data = await res.json()
      setEntityCatalogRows(data.entities || [])
      setEntityCatalogTotal(typeof data.total_distinct === 'number' ? data.total_distinct : null)
      setEntityCatalogScopeType(data.scope_type || null)
    } catch (err: any) {
      setEntityCatalogError(err?.message || 'Failed to load entities')
    } finally {
      setEntityCatalogLoading(false)
    }
  }, [datasetId])

  useEffect(function() { loadEntityCatalog() }, [loadEntityCatalog])

  // Entity drill mode — set when user clicks an entity pill in EntitiesCard.
  // Comments tab enters entity mode: shows API-fetched rows instead of client filteredRows.
  const [drillEntity, setDrillEntity] = useState<{ slug: string; canonical: string; category: string; aliases: string[] } | null>(null)
  const [entityRows, setEntityRows]   = useState<Array<{ id: number; dataset_id: string; row_index: number; data: Record<string, unknown> }>>([])
  const [entityTotal, setEntityTotal] = useState(0)
  const [entityLoading, setEntityLoading] = useState(false)
  const [entityError, setEntityError]     = useState('')

  // After mount, restore persisted UI state. Gating on restoredFromSession
  // ensures the writer-effect below doesn't overwrite sessionStorage with
  // defaults before this restore runs.
  useEffect(function() {
    const saved = readSession<any>(_tmKey)
    if (saved) {
      if (saved.activeField !== undefined) setActiveField(saved.activeField)
      if (Array.isArray(saved.activeFields)) setActiveFields(saved.activeFields)
      if (saved.subTab) { setSubTab(saved.subTab); setPreviousTab(saved.subTab) }
      if (saved.viewBy === 'theme' || saved.viewBy === 'entity') setViewBy(saved.viewBy)
      if (saved.themesView) setThemesView(saved.themesView)
      if (saved.signalCutoffs) setSignalCutoffs(saved.signalCutoffs)
      if (typeof saved.showAllThemes === 'boolean') setShowAllThemes(saved.showAllThemes)
      if (saved.compareViewMode) setCompareViewMode(saved.compareViewMode)
      if (typeof saved.compareSmartAxes === 'boolean') setCompareSmartAxes(saved.compareSmartAxes)
      if (saved.breakdownField !== undefined) setBreakdownField(saved.breakdownField)
      if (Array.isArray(saved.compareFields)) setCompareFields(saved.compareFields)
      if (Array.isArray(saved.selectedValues)) setSelectedValues(new Set(saved.selectedValues))
      if (saved.ratingField !== undefined) setRatingField(saved.ratingField)
      if (saved.colorMode) setColorMode(saved.colorMode)
      if (typeof saved.hideFlagged === 'boolean') setHideFlagged(saved.hideFlagged)
    }
    setRestoredFromSession(true)
  }, [_tmKey])

  useEffect(function() {
    if (!restoredFromSession) return
    writeSession(_tmKey, {
      activeField: activeField, activeFields: activeFields, subTab: subTab,
      themesView: themesView, showAllThemes: showAllThemes, signalCutoffs: signalCutoffs,
      breakdownField: breakdownField, compareFields: compareFields,
      selectedValues: Array.from(selectedValues),
      compareViewMode: compareViewMode, compareSmartAxes: compareSmartAxes,
      ratingField: ratingField, colorMode: colorMode, hideFlagged: hideFlagged,
      viewBy: viewBy,
    })
  }, [restoredFromSession, activeField, activeFields, subTab, themesView, showAllThemes, signalCutoffs, breakdownField, compareFields, selectedValues, compareViewMode, compareSmartAxes, ratingField, colorMode, hideFlagged, viewBy, _tmKey])

  // Listen for Ana theme mutations and refetch theme model
  useEffect(function() {
    function handleAnaThemes() {
      fetch('/api/datasets/' + datasetId + '/state')
        .then(function(r) { return r.json() })
        .then(function(state) {
          if (state?.theme_model) {
            setThemes(state.theme_model)
            setIsDirty(false)
          }
        })
        .catch(function() {})
    }
    window.addEventListener('ana-themes-changed', handleAnaThemes)
    return function() { window.removeEventListener('ana-themes-changed', handleAnaThemes) }
  }, [datasetId])

  const [apiKey, setApiKey] = useState<string>('')
  const [aiEnabled, setAiEnabled] = useState<boolean>(false)
  const orgAi = useOrgAiMode()
  const aiDisabledByOrg = !orgAi.loading && orgAi.mode === 'off'
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [showThemeEditor, setShowThemeEditor] = useState(initialOpenEditor || false)
  const [industryThemes, setIndustryThemes] = useState<Record<string, Theme[]> | null>(null)
  const [industryLoading, setIndustryLoading] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [samplePct, setSamplePct] = useState(0)
  const [lastRunPct, setLastRunPct] = useState<number | null>(null)
  const [showMineChoice, setShowMineChoice] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Filter state (from global context)
  var { filters, effectiveFilters, setFilters, setShowFilters } = useFilters()

  // Warn before leaving with unsaved changes
  useEffect(function() {
    var handleBeforeUnload = function(e: BeforeUnloadEvent) {
      if (isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return function() { window.removeEventListener('beforeunload', handleBeforeUnload) }
  }, [isDirty])

  var openFields = schema.fields.filter(function(f) { return f.type === 'open-ended' && f.status !== 'ignored' })
  // Inject signal_tier as a virtual categorical field for Reddit/Substack
  var augmentedFields = (datasetSource === 'reddit' || datasetSource === 'substack')
    ? [...schema.fields, { field: 'signal_tier', type: 'categorical' as const, label: 'Signal Tier' }]
    : schema.fields
  var catFields = augmentedFields.filter(function(f) { return f.type === 'categorical' && f.status !== 'ignored' }).map(function(f) { return f.field })

  // Issue 7: Always use alias (label) if available
  function fieldLabel(fieldName: string): string {
    var f = augmentedFields.find(function(s) { return s.field === fieldName })
    return (f && f.label && f.label !== f.field) ? f.label : fieldName
  }

  // Effective fields for analysis — multi-field support
  var effectiveFields = useMemo(function() {
    return activeFields.length > 0 ? activeFields : (activeField ? [activeField] : [])
  }, [activeFields, activeField])

  // Set initial active field(s)
  useEffect(function() {
    if (activeFields.length === 0 && openFields.length > 0) {
      var saved = savedThemeModel?.fieldNames || (savedThemeModel?.fieldName ? [savedThemeModel.fieldName] : null)
      if (saved && saved.length) {
        var validSaved = saved.filter(function(f) { return openFields.some(function(o) { return o.field === f }) })
        if (validSaved.length > 0) {
          // Saved field names are still valid
          setActiveFields(validSaved)
          setActiveField(validSaved[0])
        } else {
          // Saved field names no longer exist in schema — fall back to first open field
          setActiveFields([openFields[0].field])
          setActiveField(openFields[0].field)
        }
      } else {
        setActiveFields([openFields[0].field])
        setActiveField(openFields[0].field)
      }
    }
  }, [openFields.length])

  // Auto-switch away from empty fields once rows load
  useEffect(function() {
    if (!rowsLoaded || !rows.length || !activeFields.length || openFields.length === 0) return
    // Check if current fields have any text content
    var hasContent = activeFields.some(function(f) {
      return rows.some(function(r) { return String(r[f] || '').trim().length > 0 })
    })
    if (hasContent) return
    // Current fields are empty — find first open field with content
    for (var i = 0; i < openFields.length; i++) {
      var f = openFields[i].field
      if (activeFields.includes(f)) continue
      var fieldHasContent = rows.some(function(r) { return String(r[f] || '').trim().length > 0 })
      if (fieldHasContent) {
        setActiveFields([f])
        setActiveField(f)
        return
      }
    }
  }, [rowsLoaded, rows.length, activeFields.join(',')])

  // Load API key and AI enabled state from localStorage
  useEffect(function() {
    try {
      var k = localStorage.getItem('sentimetrx_tm_apikey')
      if (k) setApiKey(k)
      var ai = localStorage.getItem('sentimetrx_ai_enabled')
      if (ai === '1') setAiEnabled(true)
    } catch { /* ignore */ }

    // Poll localStorage for AI toggle changes from header (same-tab, no storage event)
    var interval = setInterval(function() {
      try {
        var key = localStorage.getItem('sentimetrx_tm_apikey') || ''
        var on = localStorage.getItem('sentimetrx_ai_enabled') === '1'
        setApiKey(function(prev) { return key || prev })
        setAiEnabled(on)
      } catch {}
    }, 2000)
    return function() { clearInterval(interval) }
  }, [])

  // Load industry themes on mount
  useEffect(function() {
    setIndustryLoading(true)
    fetch('/api/industry-themes')
      .then(function(r) {
        if (!r.ok) throw new Error('Failed to load industry themes')
        return r.json()
      })
      .then(function(d) { setIndustryThemes(d); setIndustryLoading(false) })
      .catch(function(e) {
        console.error('[TextMine] Industry themes load failed:', e)
        setIndustryThemes({})
        setIndustryLoading(false)
      })
  }, [])

  // Server-side theme counting for accurate full-dataset counts (avoids sampling bias).
  // Falls back silently to client-side counts if the endpoint fails.
  const fetchServerThemeCounts = useCallback(async function(themeModel: ThemeModel, fields: string[]) {
    if (!themeModel?.themes?.length || !fields.length) return
    // Reset loaded flag so the theme card's "Co-occurs with themes" section
    // re-enters its placeholder state until this fetch returns. Otherwise a
    // theme-model edit would briefly show stale chips during the refetch.
    setCooccurrenceLoaded(false)
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/theme-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          themes: themeModel.themes.map(function(t) { return { id: t.id, keywords: t.keywords } }),
          fields: fields,
          cooccurrence: true,   // pairwise theme intersection counts
          // topical: false — extract_theme_topical_words SQL times out on
          // large collections with the ±2 window; the no-window version
          // surfaces too much boilerplate. Section dropped from the card.
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (!data.counts) return
      const countMap: Record<string, { count: number; percentage: number }> = {}
      for (const c of data.counts) countMap[c.id] = { count: c.count, percentage: c.percentage }
      setThemes(function(prev) {
        if (!prev) return prev
        return {
          ...prev,
          themes: prev.themes.map(function(t) {
            var sc = countMap[t.id]
            return sc ? { ...t, count: sc.count, percentage: sc.percentage } : t
          }),
          samplingInfo: { sampled: data.totalNonEmpty || totalRows, total: data.totalNonEmpty || totalRows },
        }
      })
      setSamplingInfo({ sampled: data.totalNonEmpty || totalRows, total: data.totalNonEmpty || totalRows })
      if (data.topical) setServerTopical(data.topical)
      if (data.cooccurrence) setServerCoOccurrence(data.cooccurrence)
      // Mark loaded whether or not cooccurrence is present, so the theme
      // card stops showing the placeholder once the fetch resolves —
      // even when a theme has no co-occurring siblings.
      setCooccurrenceLoaded(true)
    } catch { /* fallback to client-side counts silently */ }
  }, [datasetId, totalRows])

  // Trigger shared row fetch on mount
  useEffect(function() {
    triggerRowFetch()
  }, [])

  // When rows load from shared context, update sampling info + server theme counts
  useEffect(function() {
    if (!rowsLoaded || !rows.length) return
    if (rowsSampled) {
      setSamplingInfo({ sampled: sampledCount, total: rowsTotalRows || totalRows })
    }
    // Fetch accurate server-side counts on the full dataset
    if (savedThemeModel && savedThemeModel.themes) {
      const field = savedThemeModel.fieldNames || savedThemeModel.fieldName
      const fields = Array.isArray(field) ? field : (field ? [field] : [])
      if (fields.length > 0) fetchServerThemeCounts(savedThemeModel, fields)
      enrichSearchInterest(savedThemeModel)
    }
  }, [rowsLoaded])

  // Theme colors
  const themeColors = useMemo<Record<number, typeof THEME_PALETTE[0]>>(function() {
    var out: Record<number, typeof THEME_PALETTE[0]> = {}
    if (themes) {
      themes.themes.forEach(function(_, i) {
        out[i] = THEME_PALETTE[i % THEME_PALETTE.length]
      })
    }
    return out
  }, [themes])

  // Apply global filters to rows. Memoized so identity is stable across
  // unrelated re-renders — keeps the downstream `filteredRows` memo (and
  // every child that takes filteredRows as a prop) from invalidating.
  var _filteredBase0 = useMemo(function() {
    return applyFilters(rows, effectiveFilters)
  }, [rows, effectiveFilters])
  var _filteredBase = useMemo(function() {
    return hideFlagged
      ? _filteredBase0.filter(function(r) { return !r.content_flags || (Array.isArray(r.content_flags) && r.content_flags.length === 0) })
      : _filteredBase0
  }, [_filteredBase0, hideFlagged])
  var activeFilterCount = useMemo(function() {
    return filterCount(effectiveFilters)
  }, [effectiveFilters])

  // Inject signal_tier for Reddit/Substack datasets (dynamic, respects filter + threshold changes)
  var filteredRows: Record<string, unknown>[] = useMemo(function(): Record<string, unknown>[] {
    return injectSignalTier(_filteredBase, datasetSource || '', signalCutoffs)
  }, [_filteredBase, datasetSource, signalCutoffs.mainstream, signalCutoffs.noise])

  // Recount theme hits against filtered data — deferred to let UI paint loading state
  var _recountFields = effectiveFields.length > 0 ? effectiveFields
    : (themes?.fieldNames || (themes?.fieldName ? [themes.fieldName] : []))
  useEffect(function() {
    if (!themes) { setDisplayThemes(null); return }
    if (filteredRows.length === 0 || _recountFields.length === 0) {
      setDisplayThemes({ ...themes, themes: themes.themes.filter(function(t) { return t.name && t.name.trim() }) })
      return
    }
    setComputing(true)
    // Use setTimeout to let the "computing" spinner paint before heavy work
    var timer = setTimeout(function() {
      var recounted = recountThemes(themes.themes, filteredRows, _recountFields, ratingField).filter(function(t) { return t.name && t.name.trim() })
      // Compute overall top/bottom box from all rows (not per-theme)
      if (ratingField) {
        var allRv: number[] = []
        filteredRows.forEach(function(r) { var v = parseFloat(String(r[ratingField] ?? '')); if (!isNaN(v)) allRv.push(v) })
        if (allRv.length > 0) {
          var rMin = Math.min.apply(null, allRv), rMax = Math.max.apply(null, allRv), mid = (rMin + rMax) / 2
          var tC = 0, bC = 0
          allRv.forEach(function(v) { if (v > mid) tC++; else if (v < mid) bC++ })
          overallBoxRef.current = { topBoxPct: Math.round(tC / allRv.length * 100), bottomBoxPct: Math.round(bC / allRv.length * 100) }
        } else { overallBoxRef.current = null }
      } else { overallBoxRef.current = null }
      setDisplayThemes({ ...themes, themes: recounted })
      setComputing(false)
    }, 20)
    return function() { clearTimeout(timer) }
  }, [themes, filteredRows.length, _recountFields.join(','), activeFilterCount, ratingField])

  // Stats for active fields (on filtered data)
  var activeFieldRows = useMemo(function() {
    return filteredRows.filter(function(r) {
      return effectiveFields.some(function(f) { return String(r[f] || '').trim().length > 0 })
    })
  }, [filteredRows, effectiveFields])
  var activeFieldCount = activeFieldRows.length

  // Prepare corpus sample for mining (combines all active fields)
  function prepareCorpus() {
    if (!effectiveFields.length || !filteredRows.length) return { texts: [], total: 0 }
    var texts = filteredRows
      .map(function(r) { return effectiveFields.map(function(f) { return String(r[f] || '') }).join(' ').trim() })
      .filter(function(t) { return t.length > 0 })
    const total = texts.length
    const defaultN = sampleSize95(total)
    const defaultPct = total > 0 ? Math.round(defaultN / total * 100) : 100
    const activePct = samplePct === 0 ? defaultPct : samplePct
    const n = Math.max(1, Math.round(total * (activePct / 100)))
    const sampled = evenSample(texts, n)
    return { texts: sampled, total }
  }

  async function mineThemes(forceMode?: 'merge' | 'fresh') {
    // For collections, show choice dialog unless a mode was explicitly chosen
    if (datasetSource === 'collection' && !forceMode) {
      setShowMineChoice(true)
      return
    }

    // Read real-time toggle state from localStorage (header may have changed it)
    var liveAi = false; try { liveAi = localStorage.getItem('sentimetrx_ai_enabled') === '1' } catch {}
    if (!liveAi) { setAiEnabled(false); setError('AI is turned off. Enable AI in the header to mine themes.'); return }
    // BYO-key flow is opt-in now: if a key has been saved previously
    // it's used; otherwise the server falls back to ANTHROPIC_API_KEY
    // and the customer org piggybacks on the platform key (usage is
    // logged per-org in usage_log for billing/cap purposes).
    var liveKey = ''; try { liveKey = localStorage.getItem('sentimetrx_tm_apikey') || '' } catch {}
    if (liveKey) setApiKey(liveKey)
    if (!effectiveFields.length || !filteredRows.length) return
    setLoading(true)
    setError(null)
    try {
      var schemaCtx = schema.fields.map(function(f) {
        return f.field + ':' + f.type + (f.type === 'categorical' && f.values ? ' (' + f.values.slice(0, 6).join(',') + ')' : '')
      }).join('; ')

      // ── Collection merge: reuse existing member themes ──────────────
      if (datasetSource === 'collection' && forceMode === 'merge') {
        // Fetch member datasets and their existing theme models
        var colRes = await fetch('/api/collections/' + datasetId)
        var colData = await colRes.json()
        if (!colRes.ok || !colData.members) throw new Error('Could not load collection members')

        var membersWithThemes = (colData.members as { label: string; has_themes: boolean; theme_model: any }[])
          .filter(function(m) { return m.has_themes })

        if (membersWithThemes.length < 2) {
          throw new Error(
            'At least 2 member datasets need AI-mined themes before merging. ' +
            'Open each dataset individually and mine themes first.'
          )
        }

        // Use existing themes from each member — no per-member mining needed
        var memberThemesForMerge = membersWithThemes.map(function(m) {
          return { label: m.label, themes: m.theme_model.themes || [] }
        })

        // Merge via AI — single API call
        var mergeRes = await fetch('/api/datasets/' + datasetId + '/merge-themes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: liveKey, memberThemes: memberThemesForMerge }),
        })
        var mergeData = await mergeRes.json()
        if (!mergeRes.ok) {
          var mErr = mergeData.error || 'Theme merge failed'
          if (mErr.startsWith('AUTH_ERROR')) throw new Error('AUTH_ERROR')
          if (mErr.startsWith('QUOTA_ERROR')) throw new Error('QUOTA_ERROR')
          throw new Error(mErr)
        }
        if (!mergeData.themes) throw new Error('No merged themes returned')

        var tm: ThemeModel = {
          themes: mergeData.themes,
          summary: mergeData.summary || '',
          fieldName: effectiveFields[0],
          fieldNames: effectiveFields,
          themeSource: 'ai',
          themeLibName: null,
          samplingInfo: { sampled: filteredRows.length, total: filteredRows.length },
        }
        setThemes(tm)
        setThemeSource('ai')
        setThemeLibName(null)
        setSamplingInfo({ sampled: filteredRows.length, total: filteredRows.length })
        setLastRunPct(samplePct)
        setSubTab('themes')
        setIsDirty(true)
        fetchServerThemeCounts(tm, effectiveFields)
        enrichSearchInterest(tm)
      } else {
        // ── Standard: mine from combined corpus ──────────────────────
        var { texts, total } = prepareCorpus()
        if (!texts.length) throw new Error('No text found in selected fields.')
        var res = await fetch('/api/datasets/' + datasetId + '/mine-themes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: liveKey, texts: texts, fieldName: effectiveFields[0], schemaCtx: schemaCtx }),
        })
        var data = await res.json()
        if (!res.ok) {
          var errMsg = data.error || 'Mining failed'
          if (errMsg.startsWith('AUTH_ERROR')) throw new Error('AUTH_ERROR')
          if (errMsg.startsWith('QUOTA_ERROR')) throw new Error('QUOTA_ERROR')
          throw new Error(errMsg)
        }
        if (!data.themes) throw new Error('No themes returned')
        var tm2: ThemeModel = {
          themes: data.themes,
          summary: data.summary || '',
          fieldName: effectiveFields[0],
          fieldNames: effectiveFields,
          themeSource: 'ai',
          themeLibName: null,
          samplingInfo: { sampled: texts.length, total: total },
        }
        setThemes(tm2)
        setThemeSource('ai')
        setThemeLibName(null)
        setSamplingInfo({ sampled: texts.length, total: total })
        setLastRunPct(samplePct)
        setSubTab('themes')
        setIsDirty(true)
        fetchServerThemeCounts(tm2, effectiveFields)
        enrichSearchInterest(tm2)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Mining failed')
    }
    setLoading(false)
  }

  function applyIndustryThemes(themeArr: Theme[], libName: string, source: string) {
    if (!effectiveFields.length || !filteredRows.length) return
    // Don't recount here — the useEffect will pick up the theme change and recount with loading indicator
    var total = filteredRows.filter(function(r) { return effectiveFields.some(function(f) { return String(r[f] || '').trim().length > 0 }) }).length
    var tm: ThemeModel = {
      themes: themeArr,
      summary: 'Industry library: ' + libName,
      fieldName: effectiveFields[0],
      fieldNames: effectiveFields,
      themeSource: source,
      themeLibName: libName,
      samplingInfo: { sampled: total, total: total },
    }
    setThemes(tm)
    setThemeSource(source)
    setThemeLibName(libName)
    setSamplingInfo({ sampled: total, total })
    // Fetch accurate server-side counts on full dataset
    fetchServerThemeCounts(tm, effectiveFields)
    // Enrich with Google search interest (Reddit/Substack only)
    enrichSearchInterest(tm)
    setLastRunPct(null)
    setShowThemeEditor(false)
    setSubTab('themes')
    // Auto-save immediately so the user doesn't need a separate Save press
    setSaving(true)
    fetch('/api/datasets/' + datasetId + '/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme_model: tm }),
    }).then(function() {
      setSaved(true)
      setIsDirty(false)
      setTimeout(function() { setSaved(false) }, 3000)
    }).catch(function() {}).finally(function() { setSaving(false) })
  }

  async function saveThemeModel() {
    if (!themes) return
    setSaving(true)
    try {
      await fetch('/api/datasets/' + datasetId + '/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme_model: themes }),
      })
      setSaved(true)
      setIsDirty(false)
      setTimeout(function() { setSaved(false) }, 3000)
    } catch { /* ignore */ }
    setSaving(false)
  }

  function handleSubTab(tab: SubTab) {
    if (tab === 'comments') setPreviousTab(subTab)
    setSubTab(tab)
    // Always clear entity mode when the user navigates tabs explicitly.
    setDrillEntity(null)
    if (tab !== 'comments') { setDrillTheme(null); setDrillGroup(null); setSelectedThemes([]) }
  }

  function handleDrillTheme(t: Theme, group?: string) {
    setPreviousTab(subTab)
    setDrillTheme(t)
    setSelectedThemes([t])
    setDrillGroup(group || null)
    setSubTab('comments')
  }

  function handleBackFromComments() {
    setDrillTheme(null)
    setSelectedThemes([])
    setDrillGroup(null)
    setDrillEntity(null)
    setSubTab(previousTab)
  }

  async function handleDrillEntity(entity: { slug: string; canonical: string; category: string; aliases: string[] }) {
    setPreviousTab(subTab)
    setDrillEntity(entity)
    setDrillTheme(null); setSelectedThemes([]); setDrillGroup(null)
    setSubTab('comments')
    setEntityLoading(true); setEntityError(''); setEntityRows([]); setEntityTotal(0)
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/rows-by-entity?entity=' + encodeURIComponent(entity.slug) + '&limit=100')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load comments')
      setEntityRows(data.rows || [])
      setEntityTotal(typeof data.total === 'number' ? data.total : (data.rows || []).length)
    } catch (err: any) {
      setEntityError(err?.message || 'Failed to load comments')
    } finally {
      setEntityLoading(false)
    }
  }

  function handleThemeEditorApply(themeArr: Theme[], libName: string, source: string) {
    applyIndustryThemes(themeArr, libName, source)
    setIsDirty(true)
  }

  // Enrich themes with Google search interest tiers (Reddit/Substack only, one-time)
  async function enrichSearchInterest(tm: ThemeModel) {
    if (datasetSource !== 'reddit' && datasetSource !== 'substack') return
    if (!tm.themes.length) return
    // Skip if already enriched (at least one theme has a non-null tier)
    if (tm.themes.some(function(t) { return t.searchInterest === 'high' || t.searchInterest === 'moderate' || t.searchInterest === 'low' })) return
    try {
      var themeKeywords: Record<string, string[]> = {}
      tm.themes.forEach(function(t) { if (t.keywords && t.keywords.length) themeKeywords[t.name] = t.keywords })
      if (!Object.keys(themeKeywords).length) return
      var res = await fetch('/api/datasets/' + datasetId + '/search-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeKeywords: themeKeywords }),
      })
      if (!res.ok) {
        var errBody = await res.json().catch(function() { return {} })
        console.warn('[search-interest] API returned', res.status, errBody.detail || errBody.error || '')
        return
      }
      var data = await res.json()
      var interests = data.interests || {}
      var trends = data.trends || {}
      var updated = { ...tm, themes: tm.themes.map(function(t) {
        return { ...t, searchInterest: interests[t.name] ?? null, searchTrend: trends[t.name] ?? null }
      })}
      setThemes(updated)
      setIsDirty(true)
    } catch (err) { console.warn('[search-interest] enrichment failed:', err) }
  }

  var hasThemes = themes && themes.themes && themes.themes.length > 0
  var canMine = rowsLoaded && effectiveFields.length > 0 && rows.length > 0
  const subTabs: { id: SubTab; label: string; help: string }[] = [
    { id: 'themes',   label: 'Themes',       help: 'Each card is a theme — a cluster of comments that share a topic. The size shows how common the theme is. Click a card to see the actual quotes.' },
    { id: 'clouds',   label: 'Theme Clouds', help: 'A word cloud per theme, showing the words that appear most often within that theme\'s comments. Useful for spotting the exact language people use.' },
    { id: 'compare',  label: 'Compare',      help: 'Slice your themes by a categorical field — region, channel, age bracket — to see which segments care about which themes. Significance markers flag groups whose mix differs meaningfully from the baseline.' },
    { id: 'comments', label: 'Comments',     help: 'The raw quotes underlying everything. Search the text, filter by theme, or jump here from any chart to see the source rows.' },
    // Dimensions (the 7-axis classification) — review datasets only; doesn't depend on a theme model.
    ...(datasetSource === 'google_reviews' ? [{ id: 'dimensions' as SubTab, label: 'Dimensions', help: 'Every review classified into a fixed, consistent set of dimensions (service, food, drinks, ambiance, …) with severity alerts. Filter by dimension/sub-dimension and read the comments behind each.' }] : []),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: T.bg, position: 'relative' }}>
      <style>{'\
        @keyframes spin{to{transform:rotate(360deg)}}\
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}\
        @keyframes fadein{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}\
        .fadein{animation:fadein .22s ease forwards}\
        .theme-card:hover{box-shadow:0 4px 18px rgba(0,0,0,.10)!important;transform:translateY(-2px)}\
      '}</style>

      {/* ─── Multi-field picker bar (Ana style with checkbox pills) ───── */}
      {openFields.length > 1 && hasThemes && (
        <div style={{ background: T.bgCard, borderBottom: '1px solid ' + T.border, padding: '7px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>
            Analyze:
            <HelpHint title="Multiple text fields" placement="bottom">
              When your dataset has more than one open-ended column (e.g. NPS comment + experience comment), pick which one to analyze — or check several at once to combine them into a single theme model.
            </HelpHint>
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {openFields.map(function(f) {
              var sel = activeFields.includes(f.field)
              return (
                <button key={f.field} onClick={function() {
                  var next = sel ? activeFields.filter(function(x) { return x !== f.field }) : activeFields.concat([f.field])
                  var final = next.length ? next : [f.field]
                  setActiveFields(final)
                  setActiveField(final[0])
                }}
                  style={{ padding: '3px 12px', fontSize: 12, fontWeight: sel ? 700 : 500, background: sel ? T.accentBg : 'white', border: '1.5px solid ' + (sel ? T.accent : T.border), color: sel ? T.accent : T.textMid, borderRadius: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, transition: 'all .12s' }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, border: '1.5px solid ' + (sel ? T.accent : T.borderMid), background: sel ? T.accent : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'white', flexShrink: 0, transition: 'all .12s' }}>
                    {sel ? '\u2713' : ''}
                  </span>
                  {fieldLabel(f.field)}
                </button>
              )
            })}
          </div>
          {activeFields.length > 1 && (
            <span style={{ fontSize: 11, color: T.textMute, flexShrink: 0, whiteSpace: 'nowrap' }}>
              Combining {activeFields.length} fields
            </span>
          )}
        </div>
      )}

      {/* ─── Error banner ──────────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '10px 20px', background: T.redBg, borderBottom: '1px solid ' + T.red + '30', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14 }}>{'\u26A0'}</span>
          <span style={{ fontSize: 12, color: T.red, flex: 1 }}>
            {error === 'AUTH_ERROR' ? 'Invalid API key. Check it at console.anthropic.com/keys'
              : error === 'QUOTA_ERROR' ? 'Insufficient API credits. Add credits at console.anthropic.com'
              : error}
          </span>
          <button onClick={function() { setError(null) }} style={{ background: 'transparent', border: 'none', color: T.red, cursor: 'pointer', fontSize: 16, opacity: 0.6 }}>{'\u2715'}</button>
        </div>
      )}

      {/* ─── Main layout (no sidebar — full width like Ana.html) ────── */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

          {/* Sub-tab bar with actions */}
          <div style={{ background: T.bgCard, borderBottom: '1px solid ' + T.border, height: 40, display: 'flex', alignItems: 'stretch', paddingLeft: 8, flexShrink: 0 }}>
            {subTabs.map(function(tab) {
              var isActive = subTab === tab.id
              var isLocked = !hasThemes && tab.id !== 'themes' && tab.id !== 'dimensions'
              return (
                <div key={tab.id} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <button onClick={function() { if (!isLocked) handleSubTab(tab.id) }}
                    style={{ padding: '0 8px 0 18px', height: '100%', fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : (isLocked ? T.textFaint : T.textMid), background: 'transparent', border: 'none', borderBottom: '2px solid ' + (isActive ? T.accent : 'transparent'), cursor: isLocked ? 'not-allowed' : 'pointer', opacity: isLocked ? 0.4 : 1, transition: 'color .12s' }}
                    title={isLocked ? 'Run a theme model first' : ''}>
                    {tab.label}
                  </button>
                  <span style={{ paddingRight: 10, opacity: isLocked ? 0.4 : 1 }}>
                    <HelpHint title={tab.label} placement="bottom">{tab.help}</HelpHint>
                  </span>
                </div>
              )
            })}

            {/* Right: status + action pills */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px' }}>
              {/* View by Theme | Entity — gates which set of components renders
                  on subtabs that have both (Themes, Clouds). Only shown when
                  the scope actually has an entity catalog; otherwise the
                  toggle would be a footgun (Entity view would render empty). */}
              {(subTab === 'themes' || subTab === 'clouds' || subTab === 'compare') && entityCatalogRows.length > 0 && (
                <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border, marginRight: 4 }}>
                  {(['theme', 'entity'] as const).map(function(mode) {
                    return (
                      <button
                        key={mode}
                        onClick={function() { setViewBy(mode) }}
                        title={mode === 'theme' ? 'Show AI-mined themes' : 'Show entity catalog (dishes, drinks, brands, places)'}
                        style={{
                          padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                          background: viewBy === mode ? T.bgCard : 'transparent',
                          color: viewBy === mode ? T.accent : T.textMute,
                          border: 'none', cursor: 'pointer',
                          boxShadow: viewBy === mode ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
                          textTransform: 'capitalize' as const,
                          fontFamily: 'inherit',
                        }}
                      >
                        {mode === 'theme' ? 'Themes' : 'Entities'}
                      </button>
                    )
                  })}
                </div>
              )}
              {rowsLoading && <span style={{ fontSize: 11, color: T.textMute, display: 'flex', alignItems: 'center', gap: 4 }}><LottieLoader size={14} /> Loading…</span>}
              {computing && !rowsLoading && <span style={{ fontSize: 11, color: T.textMute, display: 'flex', alignItems: 'center', gap: 4 }}><LottieLoader size={14} /> Computing themes…</span>}
              {themeSource && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, background: themeSource === 'ai' ? T.accentBg : T.amberBg, color: themeSource === 'ai' ? T.accent : T.amber, border: '1px solid ' + (themeSource === 'ai' ? T.accentMid : T.amberMid) }}>
                  {themeSource === 'ai' ? '\u29E1 AI Mined' : '\u2261 ' + (themeLibName || 'Industry')}
                </span>
              )}
              {openFields.length > 0 && (
                <button onClick={function() { setShowThemeEditor(true) }}
                  style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 20, color: T.textMid, cursor: 'pointer' }}>
                  {'\u2261'} Themes
                </button>
              )}
              {false && openFields.length > 0 && (
                <button onClick={function() { mineThemes() }} disabled={!canMine || loading || !aiEnabled}
                  title={!aiEnabled ? (apiKey ? 'Turn on AI in the header bar' : 'Add an API key via the AI button in the header') : ''}
                  style={{ padding: '4px 14px', fontSize: 11, fontWeight: 700, background: canMine && !loading && aiEnabled ? T.accent : T.borderMid, color: canMine && !loading && aiEnabled ? 'white' : T.textFaint, border: 'none', borderRadius: 20, cursor: canMine && !loading && aiEnabled ? 'pointer' : 'not-allowed' }}>
                  {loading ? 'Mining...' : '\u29E1 Mine'}
                </button>
              )}
              {hasThemes && ratingFields.length > 0 && (
                <select
                  value={ratingField || ''}
                  onChange={function(e) { setRatingField(e.target.value || null) }}
                  style={{ padding: '3px 8px', fontSize: 11, fontWeight: 600, background: ratingField ? T.blueBg : T.bg, color: ratingField ? T.blue : T.textMid, border: '1px solid ' + (ratingField ? T.blue + '50' : T.border), borderRadius: 20, cursor: 'pointer', maxWidth: 160 }}
                  title="Select a rating field to show avg scores on theme cards and compare charts"
                >
                  <option value="">No rating</option>
                  {ratingFields.map(function(f) {
                    return <option key={f.field} value={f.field}>{fieldLabel(f.field)}</option>
                  })}
                </select>
              )}
              {hasThemes && ratingField && (
                <button
                  onClick={function() { setColorMode(colorMode === 'sentiment' ? 'rating' : 'sentiment') }}
                  title={colorMode === 'sentiment' ? 'Switch to rating gradient colors' : 'Switch to sentiment colors'}
                  style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: '1px solid ' + (colorMode === 'rating' ? '#d97706' + '50' : T.border), background: colorMode === 'rating' ? '#fffbeb' : T.bg, color: colorMode === 'rating' ? '#d97706' : T.textMid }}
                >{colorMode === 'rating' ? '\u2605 Rating' : '\u25CF Sentiment'}</button>
              )}
              {_filteredBase0.some(function(r) { return r.content_flags && Array.isArray(r.content_flags) && r.content_flags.length > 0 }) && (
                <button
                  onClick={function() { setHideFlagged(!hideFlagged) }}
                  title={hideFlagged ? 'Show all responses (including flagged content)' : 'Hide responses flagged for profanity, slurs, or offensive language'}
                  style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: '1px solid ' + (hideFlagged ? T.red + '50' : T.border), background: hideFlagged ? T.redBg : T.bg, color: hideFlagged ? T.red : T.textMid }}
                >{hideFlagged ? '\u26A0 Flagged hidden' : '\u26A0 Content flags'}</button>
              )}
              {hasThemes && isDirty && (
                <button onClick={function() { saveThemeModel() }} disabled={saving}
                  style={{ padding: '4px 14px', fontSize: 11, fontWeight: 700, background: T.accent, color: 'white', border: 'none', borderRadius: 20, cursor: saving ? 'not-allowed' : 'pointer' }}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              )}
            </div>
          </div>

          {/* ─── Tab content ─────────────────────────────────────────── */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {/* ═══ THEMES TAB ═══ */}
            {subTab === 'themes' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }} className="fadein">

                {/* Loading spinner */}
                {loading && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingBottom: 80 }}>
                    <LottieLoader size={96} message="Analyzing your responses…" />
                    <div style={{ fontSize: 12, color: T.textMute, marginTop: 8 }}>Ana is reading and grouping themes...</div>
                  </div>
                )}

                {/* Rows load error */}
                {!rowsLoaded && !rowsLoading && rowsError && (
                  <div style={{ margin: '40px auto', maxWidth: 440, padding: '16px 20px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, fontSize: 13, color: '#dc2626', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Failed to load dataset rows</div>
                    <div style={{ color: '#991b1b', marginBottom: 12 }}>{rowsError}</div>
                    <button onClick={function() { triggerRowFetch() }}
                      style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700, background: '#dc2626', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer' }}>
                      Retry
                    </button>
                  </div>
                )}

                {/* Rows still loading */}
                {!rowsLoaded && rowsLoading && !rowsError && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, paddingTop: 60, paddingBottom: 60 }}>
                    <LottieLoader size={120} message="Loading dataset rows..." />
                  </div>
                )}

                {/* Empty state — no themes yet */}
                {rowsLoaded && !hasThemes && !loading && (
                  <div style={{ textAlign: 'center', padding: '48px 20px', maxWidth: 440, margin: '0 auto' }}>
                    <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg, #fff3ee, #ffe4d6)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28 }}>
                      <span style={{ color: T.accent, fontWeight: 900, fontStyle: 'italic' }}>A</span>
                    </div>
                    {rows.length === 0 ? (
                      <>
                        <h3 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 8 }}>Waiting for responses</h3>
                        <p style={{ fontSize: 13, color: T.textMute, lineHeight: 1.6, marginBottom: 24 }}>
                          {datasetSource === 'study'
                            ? 'Your study is connected but has no responses yet. Once respondents start submitting, click Sync in the header to pull in new data.'
                            : 'No data rows found. Check your dataset configuration.'}
                        </p>
                      </>
                    ) : (
                      <>
                        <h3 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 8 }}>
                          {datasetSource === 'study' ? 'Your study data is ready' : 'TextMine is ready'}
                        </h3>
                        <p style={{ fontSize: 13, color: T.textMute, lineHeight: 1.6, marginBottom: 24 }}>
                          {samplingInfo
                            ? samplingInfo.sampled.toLocaleString() + ' of ' + samplingInfo.total.toLocaleString() + ' responses sampled'
                            : rows.length.toLocaleString() + ' response' + (rows.length !== 1 ? 's' : '') + ' imported'
                          } across {openFields.length} open-ended field{openFields.length !== 1 ? 's' : ''}.
                          {' '}{aiDisabledByOrg
                            ? 'Pick an industry theme library to get started.'
                            : datasetSource === 'study'
                              ? 'Run an AI analysis to discover themes, or apply a theme library.'
                              : 'Run an AI analysis or pick an industry theme library to get started.'}
                        </p>
                      </>
                    )}
                    {rows.length > 0 && (
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                        {!aiDisabledByOrg && (
                          <button onClick={function() { mineThemes() }} disabled={!canMine || !aiEnabled}
                            title={!aiEnabled ? (apiKey ? 'Turn on AI in the header bar' : 'Add an API key via the AI button in the header') : ''}
                            style={{ padding: '10px 22px', fontSize: 13, fontWeight: 700, background: canMine && aiEnabled ? T.accent : T.borderMid, color: canMine && aiEnabled ? 'white' : T.textFaint, border: 'none', borderRadius: 9, cursor: canMine && aiEnabled ? 'pointer' : 'not-allowed' }}>
                            {'\u29E1'} Mine with AI
                          </button>
                        )}
                        <button onClick={function() { setShowThemeEditor(true) }}
                          style={{ padding: '10px 22px', fontSize: 13, fontWeight: 700, background: T.bg, border: '2px solid ' + T.borderMid, color: T.textMid, borderRadius: 9, cursor: 'pointer' }}>
                          {'\u2261'} {anaLibrary ? 'Apply ' + (INDUSTRY_LABELS[anaLibrary as Industry] || anaLibrary) + ' themes' : 'Choose theme library'}
                        </button>
                      </div>
                    )}

                    {/* Concept explainer \u2014 visible on first run when no themes
                        exist yet. Stays AI-independent so non-AI clients still
                        get an accurate mental model. */}
                    {rows.length > 0 && (
                      <div style={{ marginTop: 36, textAlign: 'left', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', padding: '20px 22px', background: 'white', border: '1px solid ' + T.border, borderRadius: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>How TextMine works</div>
                        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: T.textMid, lineHeight: 1.7 }}>
                          <li>Pick a theme source {'\u2014'} let AI mine the patterns, or apply an industry library of pre-built themes.</li>
                          <li>Browse <b>Themes</b> for the cluster overview, or <b>Theme Clouds</b> to see the words inside each theme.</li>
                          <li>Use <b>Compare</b> to slice themes by segment (region, channel, age) and surface significant differences.</li>
                          <li>Drop into <b>Comments</b> any time to read the raw quotes behind a theme.</li>
                        </ol>
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid ' + T.border, fontSize: 11, color: T.textMute }}>
                          Look for the <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', border: '1px solid #d1d5db', color: '#9ca3af', fontSize: 9, fontWeight: 800, verticalAlign: 'middle' }}>?</span> icons next to any feature for a quick explanation.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ─── Themes content (with Distribution/Cards toggle) ─── */}
                {rowsLoaded && hasThemes && displayThemes && !loading && (function() {
                  var sortedThemes = [...displayThemes.themes].sort(function(a, b) { return (b.count || 0) - (a.count || 0) })
                  var totalResp = filteredRows.filter(function(r) { return effectiveFields.some(function(f) { return String(r[f] || '').trim().length > 0 }) }).length
                  var visibleThemes = showAllThemes ? sortedThemes : sortedThemes.filter(function(t) { return totalResp > 0 && (t.count / totalResp * 100) >= 3 })
                  if (!visibleThemes.length) visibleThemes = sortedThemes.slice(0, 5)
                  var topTone = sortedThemes[0] ? sortedThemes[0].sentiment : '\u2014'

                  return (
                    <div>
                      {/* AI-mined banner */}
                      {viewBy === 'theme' && themeSource === 'ai' && (
                        <div style={{ background: 'linear-gradient(135deg, #fff3ee, #ffe8db)', border: '1px solid #fed7aa', borderRadius: 12, padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 18 }}>{'\u2728'}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#9a3412' }}>
                            Themes generated by AI analysis of {totalResp.toLocaleString()} open-ended comments
                            {samplingInfo && samplingInfo.sampled < samplingInfo.total ? ' (' + samplingInfo.sampled.toLocaleString() + ' sampled)' : ''}
                          </span>
                        </div>
                      )}

                      {/* Header: title + source + view toggle */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: 0 }}>{viewBy === 'entity' ? 'Entities' : 'Themes'}</h2>
                          </div>
                          <p style={{ fontSize: 12, color: T.textMid, margin: '3px 0 0' }}>
                            {viewBy === 'entity'
                              ? <>{effectiveFields.length > 1 ? 'Fields' : 'Field'}: <strong>{effectiveFields.map(fieldLabel).join(' + ')}</strong> {'\u00B7'} {entityCatalogTotal != null ? entityCatalogTotal.toLocaleString() + ' entities \u00B7 ' : ''}{totalResp.toLocaleString()} responses</>
                              : <>{effectiveFields.length > 1 ? 'Fields' : 'Field'}: <strong>{effectiveFields.map(fieldLabel).join(' + ')}</strong> {'\u00B7'} {displayThemes!.themes.length} themes {'\u00B7'} {totalResp.toLocaleString()} responses</>
                            }
                          </p>
                        </div>
                        {viewBy === 'theme' && (
                          <div style={{ display: 'flex', background: T.bg, borderRadius: 20, padding: 2, border: '1px solid ' + T.border, flexShrink: 0 }}>
                            {[['distribution', '\u2261 Distribution'], ['cards', '\u229E Cards'], ...((datasetSource === 'reddit' || datasetSource === 'substack') ? [['signals', '\u26A1 Signals']] : [])].map(function(pair) {
                              var v = pair[0]; var lbl = pair[1]
                              return (
                                <button key={v} onClick={function() { setThemesView(v as 'distribution' | 'cards' | 'signals') }}
                                  style={{ fontSize: 12, fontWeight: themesView === v ? 700 : 500, padding: '5px 14px', borderRadius: 18, background: themesView === v ? T.accent : 'transparent', color: themesView === v ? 'white' : T.textMute, border: 'none', cursor: 'pointer', transition: 'background .15s' }}>
                                  {lbl}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {viewBy === 'theme' && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer', flexShrink: 0 }}>
                            <input type="checkbox" checked={showAllThemes} onChange={function() { setShowAllThemes(function(v: boolean) { return !v }) }} style={{ accentColor: T.accent }} />
                            Show all
                          </label>
                        )}
                      </div>
                      {viewBy === 'theme' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                        <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px' }}>
                          {(function() {
                            var isSampled = samplingInfo && samplingInfo.sampled < samplingInfo.total
                            return (<>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                                <div>
                                  <div style={{ fontSize: 22, fontWeight: 800, color: T.accent, lineHeight: 1 }}>{totalResp.toLocaleString()}</div>
                                  <div style={{ fontSize: 10, color: T.textMute, marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Comments</div>
                                </div>
                                {isSampled && (
                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 16, fontWeight: 700, color: T.textMid, lineHeight: 1 }}>{samplingInfo!.total.toLocaleString()}</div>
                                    <div style={{ fontSize: 10, color: T.textMute, marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Total rows</div>
                                  </div>
                                )}
                              </div>
                              {isSampled && (
                                <div>
                                  <div style={{ height: 4, background: T.border, borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
                                    <div style={{ height: '100%', width: Math.round(samplingInfo!.sampled / samplingInfo!.total * 100) + '%', background: T.accent, borderRadius: 2 }} />
                                  </div>
                                  <div style={{ fontSize: 11, color: T.textMute }}>{Math.round(samplingInfo!.sampled / samplingInfo!.total * 100)}% sample rate ({samplingInfo!.sampled.toLocaleString()} rows sampled)</div>
                                </div>
                              )}
                            </>)
                          })()}
                        </div>
                        <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px' }}>
                          <div style={{ fontSize: 24, fontWeight: 800, color: T.blue, lineHeight: 1 }}>{displayThemes!.themes.length}</div>
                          <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Themes Found</div>
                        </div>
                        <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px' }}>
                          <div style={{ fontSize: 24, fontWeight: 800, color: T.green, lineHeight: 1, textTransform: 'capitalize' }}>{topTone}</div>
                          <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Top Tone</div>
                        </div>
                      </div>
                      )}

                      {/* ── Entities — scope-wide, click an entity to read its comments ─── */}
                      <EntitiesCard
                        entities={entityCatalogRows}
                        totalDistinct={entityCatalogTotal}
                        scopeType={entityCatalogScopeType}
                        loading={entityCatalogLoading}
                        error={entityCatalogError}
                        onDrillEntity={handleDrillEntity}
                      />

                      {/* ── Distribution view ─── */}
                      {viewBy === 'theme' && themesView === 'distribution' && (
                        <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '18px 20px', marginBottom: 20 }}>
                          {/* Compute rounded max for axis */}
                          {(function() {
                            var classifiedCount = sortedThemes.reduce(function(s, t) { return s + t.count }, 0)
                            var unclassifiedCount = Math.max(0, totalResp - classifiedCount)
                            var maxPctRaw = visibleThemes.reduce(function(m, t) { var p = totalResp > 0 ? t.count / totalResp * 100 : 0; return p > m ? p : m }, 0)
                            if (unclassifiedCount > 0) { var uPct = totalResp > 0 ? unclassifiedCount / totalResp * 100 : 0; if (uPct > maxPctRaw) maxPctRaw = uPct }
                            var axisMax = Math.ceil(maxPctRaw / 10) * 10 || 10
                            var hiddenCount = sortedThemes.length - visibleThemes.length
                            return (
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase' }}>Theme Distribution {'\u2014'} click a bar to view comments</div>
                                  {hiddenCount > 0 && !showAllThemes && <span style={{ fontSize: 10, color: T.textFaint }}>{hiddenCount} theme{hiddenCount !== 1 ? 's' : ''} below 3% hidden</span>}
                                </div>
                                {/* Axis labels */}
                                <div style={{ display: 'flex', marginLeft: 150, marginBottom: 2 }}>
                                  {Array.from({ length: (axisMax / 10) + 1 }, function(_, i) { return i * 10 }).map(function(v) {
                                    return <span key={v} style={{ flex: v === 0 ? 0 : 1, textAlign: v === 0 ? 'left' : 'right', fontSize: 9, color: T.textFaint }}>{v}%</span>
                                  })}
                                </div>
                                {visibleThemes.map(function(t) {
                                  var idx = displayThemes!.themes.indexOf(t)
                                  var pal = themeColors[idx] || THEME_PALETTE[0]
                                  var pct = totalResp > 0 ? Math.round(t.count / totalResp * 100) : 0
                                  var pctFrac = totalResp > 0 ? t.count / totalResp * 100 / axisMax : 0
                                  return (
                                    <div key={t.id} onClick={function() { handleDrillTheme(t) }}
                                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer', borderRadius: 6 }}>
                                      <span style={{ fontSize: 12, fontWeight: 700, color: pal.text, width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{t.name}</span>
                                      <div style={{ flex: 1, height: 22, background: T.bg, borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                                        <div style={{ height: '100%', width: (pctFrac * 100) + '%', background: pal.border, borderRadius: 4, transition: 'width .6s ease', minWidth: pctFrac > 0 ? 2 : 0 }} />
                                      </div>
                                      <span style={{ fontSize: 12, fontWeight: 700, color: T.text, width: 36, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
                                      <span style={{ fontSize: 11, color: T.textFaint, width: 50, textAlign: 'right', flexShrink: 0 }}>n={t.count}</span>
                                    </div>
                                  )
                                })}
                                {/* Unclassified bar */}
                                {unclassifiedCount > 0 && (
                                  <div onClick={function() { handleDrillTheme({ id: 'unclassified', name: 'Unclassified', description: 'Responses that did not match any theme.', keywords: [], sentiment: 'mixed', count: unclassifiedCount, percentage: 0, relatedThemes: [] }) }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer', borderRadius: 6, opacity: 0.7 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: T.textFaint, width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>Unclassified</span>
                                    <div style={{ flex: 1, height: 22, background: T.bg, borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                                      <div style={{ height: '100%', width: (totalResp > 0 ? unclassifiedCount / totalResp * 100 / axisMax * 100 : 0) + '%', background: '#94a3b8', borderRadius: 4, transition: 'width .6s ease' }} />
                                    </div>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: T.textFaint, width: 36, textAlign: 'right', flexShrink: 0 }}>{totalResp > 0 ? Math.round(unclassifiedCount / totalResp * 100) : 0}%</span>
                                    <span style={{ fontSize: 11, color: T.textFaint, width: 50, textAlign: 'right', flexShrink: 0 }}>n={unclassifiedCount}</span>
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                      )}

                      {/* ── Cards view (exact Ana.html style) ─── */}
                      {viewBy === 'theme' && themesView === 'cards' && (function() {
                        // Compute rating range for normalization when in rating color mode
                        var ratingMin = Infinity, ratingMax = -Infinity
                        if (colorMode === 'rating' && ratingField) {
                          visibleThemes.forEach(function(t) {
                            if (t.avgRating != null) { ratingMin = Math.min(ratingMin, t.avgRating); ratingMax = Math.max(ratingMax, t.avgRating) }
                          })
                          // Also scan keyword-level ratings
                          visibleThemes.forEach(function(t) {
                            if (t.keywordRatings) Object.values(t.keywordRatings).forEach(function(kr) { ratingMin = Math.min(ratingMin, kr.avg); ratingMax = Math.max(ratingMax, kr.avg) })
                          })
                          if (!isFinite(ratingMin)) { ratingMin = 0; ratingMax = 1 }
                          if (ratingMax === ratingMin) ratingMax = ratingMin + 1
                        }
                        function normRating(v: number) { return (v - ratingMin) / (ratingMax - ratingMin) }
                        return (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
                          {visibleThemes.map(function(t) {
                            var idx = displayThemes!.themes.indexOf(t)
                            var pal = themeColors[idx] || THEME_PALETTE[0]
                            var useRatingColor = colorMode === 'rating' && ratingField && t.avgRating != null
                            var cardBorder = useRatingColor ? ratingColor(normRating(t.avgRating!)) : pal.border
                            var pct = totalResp > 0 ? Math.round(t.count / totalResp * 100) : (t.percentage || 0)
                            return (
                              <div key={t.id} className="theme-card"
                                onClick={function() { handleDrillTheme(t) }}
                                onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 18px rgba(0,0,0,.10)' }}
                                onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                                style={{ background: T.bgCard, border: '2px solid ' + cardBorder, borderRadius: 14, padding: '16px 18px', cursor: 'pointer', transition: 'box-shadow .15s, transform .12s', display: 'flex', flexDirection: 'column' }}>
                                {/* Top row: dot + badges */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: cardBorder, flexShrink: 0 }} />
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    {t.searchInterest && (
                                      <span title={t.searchInterest === 'high' ? 'Keywords in this theme have 1M+ monthly Google searches' + (t.searchTrend === 'up' ? ' and are trending up' : t.searchTrend === 'down' ? ' and are trending down' : '') : t.searchInterest === 'moderate' ? 'Keywords in this theme have 100K\u20131M monthly Google searches' + (t.searchTrend === 'up' ? ' and are trending up' : t.searchTrend === 'down' ? ' and are trending down' : '') : 'Keywords in this theme have 5K\u2013100K monthly Google searches' + (t.searchTrend === 'up' ? ' and are trending up' : t.searchTrend === 'down' ? ' and are trending down' : '')} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 700, cursor: 'help',
                                        background: t.searchInterest === 'high' ? '#dbeafe' : t.searchInterest === 'moderate' ? '#fef3c7' : '#f3f4f6',
                                        color: t.searchInterest === 'high' ? '#1d4ed8' : t.searchInterest === 'moderate' ? '#92400e' : '#6b7280',
                                        border: '1px solid ' + (t.searchInterest === 'high' ? '#93c5fd' : t.searchInterest === 'moderate' ? '#fcd34d' : '#d1d5db'),
                                      }}>{'\uD83D\uDD0D'} {t.searchInterest === 'high' ? 'Widely Searched' : t.searchInterest === 'moderate' ? 'Moderately Searched' : 'Niche Topic'}{t.searchTrend === 'up' ? ' \u2191' : t.searchTrend === 'down' ? ' \u2193' : ''}</span>
                                    )}
                                    {t.avgRating != null && (
                                      <span title={'Average rating for this theme: ' + t.avgRating.toFixed(2)} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, background: ratingColor(normRating(t.avgRating)) + '18', color: ratingColor(normRating(t.avgRating)), fontWeight: 700 }}>{'\u2605'} {t.avgRating.toFixed(1)}</span>
                                    )}
                                    <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, background: sentBg(t.sentiment), color: sentColor(t.sentiment), fontWeight: 700, textTransform: 'capitalize' }}>{t.sentiment || '\u2014'}</span>
                                  </div>
                                </div>
                                {/* Theme name + origin badge */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                  <span style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{t.name}</span>
                                  {(t as any).origin === 'seed' && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 700, background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd' }}>Seed</span>}
                                  {(t as any).origin === 'organic-promoted' && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 700, background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }}>Organic</span>}
                                  {(t as any).origin === 'organic' && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 700, background: '#fff7ed', color: '#c2410c', border: '1px solid #fdba74' }}>Organic</span>}
                                </div>
                                {/* Description */}
                                <div style={{ fontSize: 12, color: T.textMute, lineHeight: 1.5, marginBottom: 10, minHeight: 32 }}>{t.description}</div>
                                {/* Keywords (max 4) — click to see opinions, show avg rating when available */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                                  {(t.keywords || []).slice(0, 4).map(function(k) {
                                    var kr = t.keywordRatings?.[k]
                                    var kwColor = kr && colorMode === 'rating' ? ratingColor(normRating(kr.avg)) : null
                                    return <span key={k} onClick={function(e) { e.stopPropagation(); setOpinionWord(opinionWord === k ? null : k) }}
                                      style={{ fontSize: 11, padding: '2px 8px', background: opinionWord === k ? '#eff6ff' : kwColor ? kwColor + '15' : T.bg, color: opinionWord === k ? '#2563eb' : kwColor || T.textMid, borderRadius: 20, border: '1px solid ' + (opinionWord === k ? '#bfdbfe' : kwColor ? kwColor + '40' : T.border), cursor: 'pointer', transition: 'all .1s', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                      {k}{kr && ratingField ? <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.8 }}>{kr.avg.toFixed(1)}</span> : null}
                                    </span>
                                  })}
                                </div>
                                {/* Opinion popover for clicked keyword */}
                                {opinionWord && (t.keywords || []).some(function(k) { return k === opinionWord }) && (
                                  <div style={{ marginBottom: 10 }} onClick={function(e) { e.stopPropagation() }}>
                                    <OpinionPopover
                                      word={opinionWord}
                                      rows={filteredRows}
                                      fields={activeField || (themes ? themes.fieldName : '')}
                                      ratingField={ratingField}
                                      hiddenFields={hiddenFields}
                                      onClose={function() { setOpinionWord(null) }}
                                    />
                                  </div>
                                )}
                                {/* Opinions — top 3 opinion words for this theme's keywords */}
                                {/* "Co-occurs with themes" reads from serverCoOccurrence, set
                                    by fetchServerThemeCounts. Until the fetch resolves a small
                                    placeholder + Lottie spinner stands in — the matrix RPC
                                    takes ~1–2s per dataset (per member for collections), and
                                    the card looks lifeless without a hint that something's
                                    coming. cooccurrenceLoaded flips to true on response so we
                                    can suppress the section entirely when a theme genuinely
                                    has no co-occurring siblings. */}
                                {(function() {
                                  if (!cooccurrenceLoaded) {
                                    return (
                                      <div style={{ marginBottom: 10 }}>
                                        <div style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>
                                          Co-occurs with themes
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
                                            {[1, 2, 3].map(function(i) {
                                              return <span key={i} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: T.border, color: 'transparent', minWidth: 60, height: 14 }}>—</span>
                                            })}
                                          </div>
                                          <LottieLoader size={18} />
                                        </div>
                                      </div>
                                    )
                                  }
                                  var coRowsByThemeId = serverCoOccurrence[t.id] || {}
                                  var themeNameById: Record<string, string> = {}
                                  ;(themes?.themes || []).forEach(function(other) { themeNameById[other.id] = other.name })
                                  var coEntries = Object.entries(coRowsByThemeId)
                                    .filter(function(e) { return e[1] > 0 && themeNameById[e[0]] })
                                    .sort(function(a, b) { return b[1] - a[1] })
                                    .slice(0, 3)
                                  var thisCount = t.count || 0
                                  if (coEntries.length === 0) return null
                                  return (
                                    <div style={{ marginBottom: 10 }}>
                                      <div style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>
                                        Co-occurs with themes
                                      </div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {coEntries.map(function(e) {
                                          var otherId = e[0]; var pairCount = e[1]
                                          var otherIdx = (themes?.themes || []).findIndex(function(x) { return x.id === otherId })
                                          var otherPal = otherIdx >= 0 ? (themeColors[otherIdx] || THEME_PALETTE[0]) : THEME_PALETTE[0]
                                          var pctOfThis = thisCount > 0 ? Math.round(pairCount / thisCount * 100) : 0
                                          return (
                                            <span key={otherId} title={pctOfThis + '% of ' + t.name + ' records also mention ' + themeNameById[otherId] + ' (' + pairCount.toLocaleString() + ' records)'} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600, background: otherPal.bg, color: otherPal.text, border: '1px solid ' + otherPal.border + '60', cursor: 'help' }}>
                                              {themeNameById[otherId]} ({pctOfThis}%)
                                            </span>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )
                                })()}
                                {/* Count + % + CI + mini bar. marginTop: auto pins this
                                    block to the bottom of the card so footers align across
                                    siblings in the same grid row even when keyword wrap and
                                    co-occurs section heights vary. */}
                                <div style={{ borderTop: '1px solid ' + T.border, paddingTop: 10, marginTop: 'auto' }}>
                                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ fontSize: 13, color: T.textMid }}>
                                      <strong style={{ fontSize: 18, color: cardBorder }}>{(t.count || 0).toLocaleString()}</strong> records
                                      {(t.snippetCount || 0) > 0 && (
                                        <>
                                          {' \u00b7 '}
                                          <strong style={{ color: T.textMid }}>{(t.snippetCount || 0).toLocaleString()}</strong> snippets
                                        </>
                                      )}
                                    </span>
                                    <span style={{ fontSize: 22, fontWeight: 800, color: cardBorder }}>{pct}%</span>
                                  </div>
                                  <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 6 }}>95% CI: {t.ciLow ?? 0}{'\u2013'}{t.ciHigh ?? 0}%</div>
                                  {t.avgRating != null && !useRatingColor && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                      <span style={{ fontSize: 11, color: T.textMid }}>Avg Rating: <strong style={{ color: t.ratingDelta != null && t.ratingDelta > 0 ? '#059669' : t.ratingDelta != null && t.ratingDelta < -0.1 ? '#dc2626' : T.text }}>{t.avgRating.toFixed(2)}</strong></span>
                                      {t.ratingDelta != null && t.ratingDelta !== 0 && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: t.ratingDelta > 0 ? '#059669' : '#dc2626' }}>
                                          {t.ratingDelta > 0 ? '\u25B2' : '\u25BC'} {Math.abs(t.ratingDelta).toFixed(2)} vs avg
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {t.topBoxPct != null ? (
                                    <>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                                      <span style={{ fontSize: 9, fontWeight: 700, color: '#dc2626' }}>Bottom Box {t.bottomBoxPct}%{overallBoxRef.current ? <span style={{ fontWeight: 400, color: '#9ca3af' }}> ({overallBoxRef.current.bottomBoxPct}%)</span> : null}</span>
                                      <span style={{ fontSize: 9, fontWeight: 700, color: '#059669' }}>Top Box {t.topBoxPct}%{overallBoxRef.current ? <span style={{ fontWeight: 400, color: '#9ca3af' }}> ({overallBoxRef.current.topBoxPct}%)</span> : null}</span>
                                    </div>
                                    <div style={{ height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                                      {(t.bottomBoxPct || 0) > 0 && <div style={{ height: '100%', width: t.bottomBoxPct + '%', background: '#dc2626', transition: 'width .6s ease' }} />}
                                      {(t.midBoxPct || 0) > 0 && <div style={{ height: '100%', width: t.midBoxPct + '%', background: '#d1d5db', transition: 'width .6s ease' }} />}
                                      {(t.topBoxPct || 0) > 0 && <div style={{ height: '100%', width: t.topBoxPct + '%', background: '#059669', transition: 'width .6s ease' }} />}
                                    </div>
                                    </>
                                  ) : (
                                    <div style={{ height: 5, background: T.border, borderRadius: 3, overflow: 'hidden' }}>
                                      <div style={{ height: '100%', width: pct + '%', background: cardBorder, borderRadius: 3, transition: 'width .6s ease' }} />
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        )
                      })()}

                      {/* ── Signals view (Reddit + Substack) ─── */}
                      {viewBy === 'theme' && themesView === 'signals' && (datasetSource === 'reddit' || datasetSource === 'substack') && (
                        <SignalsView
                          rows={filteredRows}
                          mainstreamCutoff={signalCutoffs.mainstream}
                          noiseCutoff={signalCutoffs.noise}
                          onCutoffChange={function(m, n) { setSignalCutoffs({ mainstream: m, noise: n }) }}
                          datasetSource={datasetSource}
                        />
                      )}

                      {/* Breakdown distribution */}
                      {viewBy === 'theme' && breakdownField && selectedValues.size > 0 && themesView !== 'signals' && (
                        <BreakdownDist themes={displayThemes || themes} parsedData={filteredRows} activeField={activeField || themes!.fieldName} breakdownField={breakdownField} selectedValues={selectedValues} themeColors={themeColors} onDrillTheme={handleDrillTheme} ratingField={ratingField} />
                      )}

                      {/* Entity Breakdown — same controls (breakdown field +
                          selected values), one chart below. Only when the
                          scope actually has an entity catalog. */}
                      {viewBy === 'entity' && breakdownField && selectedValues.size > 0 && entityCatalogRows.length > 0 && effectiveFields.length > 0 && (
                        <EntityBreakdownDist
                          entities={entityCatalogRows}
                          parsedData={filteredRows}
                          fields={effectiveFields}
                          breakdownField={breakdownField}
                          selectedValues={selectedValues}
                          scopeType={entityCatalogScopeType}
                          ratingField={ratingField}
                          onDrillEntity={function(e) { handleDrillEntity({ slug: e.slug, canonical: e.canonical, category: e.category, aliases: e.aliases || [] }) }}
                        />
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ═══ CLOUDS TAB ═══ (Theme or Entity per viewBy) */}
            {subTab === 'clouds' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }} className="fadein">
                <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 16 }}>
                  {viewBy === 'entity' ? 'Entity Clouds' : 'Theme Clouds'}
                </h2>
                {hasThemes && themes && rowsLoaded ? (
                  <>
                  {viewBy === 'theme' && (
                    <WordCloud
                      themes={(displayThemes || themes).themes}
                      themeColors={themeColors}
                      parsedData={filteredRows}
                      activeField={activeField || themes!.fieldName}
                      isReddit={datasetSource === 'reddit' || datasetSource === 'substack'}
                      onWordClick={function(word, themeIdx, type) {
                        // Word click: opinion popover. Theme title click: theme popover.
                        if (type === 'theme') {
                          setThemePopoverIdx(themePopoverIdx === themeIdx ? null : themeIdx)
                        } else if (word) {
                          setOpinionWord(opinionWord === word ? null : word)
                        }
                      }}
                    />
                  )}
                  {viewBy === 'theme' && opinionWord && (
                    <div style={{ marginTop: 12 }}>
                      <OpinionPopover
                        word={opinionWord}
                        rows={filteredRows}
                        fields={activeFields && activeFields.length > 0 ? activeFields : (activeField || (themes ? themes.fieldName : ''))}
                        ratingField={ratingField}
                        hiddenFields={hiddenFields}
                        onClose={function() { setOpinionWord(null) }}
                      />
                    </div>
                  )}
                  {viewBy === 'theme' && themePopoverIdx !== null && themes && (displayThemes || themes).themes[themePopoverIdx] && (
                    <ThemePopover
                      theme={(displayThemes || themes).themes[themePopoverIdx] as any}
                      rows={filteredRows}
                      fields={activeFields && activeFields.length > 0 ? activeFields : (activeField || (themes ? themes.fieldName : ''))}
                      color={themeColors[themePopoverIdx]?.text}
                      ratingField={ratingField}
                      hiddenFields={hiddenFields}
                      onClose={function() { setThemePopoverIdx(null) }}
                    />
                  )}
                  {/* Entity cloud — shown when viewBy is 'entity' and the
                      scope has a catalog to render. */}
                  {viewBy === 'entity' && entityCatalogRows.length > 0 && effectiveFields.length > 0 && (
                    <EntityCloud
                      entities={entityCatalogRows}
                      parsedData={filteredRows}
                      fields={effectiveFields}
                      scopeType={entityCatalogScopeType}
                      onEntityClick={function(e) { handleDrillEntity({ slug: e.slug, canonical: e.canonical, category: e.category, aliases: e.aliases || [] }) }}
                    />
                  )}
                  {viewBy === 'entity' && entityCatalogRows.length === 0 && (
                    <div style={{ textAlign: 'center' as const, padding: 40, color: T.textFaint, fontSize: 13 }}>
                      No entities in this scope yet. Discover or seed entities on the Schema tab.
                    </div>
                  )}
                  </>
                ) : hasThemes && themes && !rowsLoaded ? (
                  // Theme model IS applied — we're just waiting for the row data
                  // to load before we can compute the cloud. Don't tell the user
                  // to run TextMine again, that's already done.
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                    <LottieLoader size={120} message="Loading theme clouds…" />
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>Run a TextMine analysis first to see theme clouds.</div>
                )}
              </div>
            )}

            {/* ═══ COMPARE TAB ═══ (Theme or Entity per viewBy) */}
            {subTab === 'compare' && viewBy === 'theme' && (
              <CompareTab themes={displayThemes || themes} parsedData={filteredRows} schema={augmentedFields} activeField={activeField} themeColors={themeColors} breakdownFields={compareFields} setBreakdownFields={setCompareFields} onDrillTheme={handleDrillTheme} viewMode={compareViewMode} setViewMode={setCompareViewMode} smartAxes={compareSmartAxes} setSmartAxes={setCompareSmartAxes} ratingField={ratingField} />
            )}
            {subTab === 'compare' && viewBy === 'entity' && (
              <EntityCompareTab
                entities={entityCatalogRows}
                parsedData={filteredRows}
                fields={effectiveFields}
                schema={augmentedFields}
                breakdownFields={compareFields}
                setBreakdownFields={setCompareFields}
                ratingField={ratingField}
                viewMode={compareViewMode === 'theme' ? 'entity' : 'group'}
                setViewMode={function(v) { setCompareViewMode(v === 'entity' ? 'theme' : 'group') }}
                smartAxes={compareSmartAxes}
                setSmartAxes={setCompareSmartAxes}
                scopeType={entityCatalogScopeType}
                onDrillEntity={function(e) { handleDrillEntity({ slug: e.slug, canonical: e.canonical, category: e.category, aliases: e.aliases || [] }) }}
              />
            )}

            {/* ═══ DIMENSIONS TAB ═══ (self-contained module — fetches dataset_row_taxonomy itself) */}
            {subTab === 'dimensions' && (
              <div style={{ flex: 1, minHeight: 0 }}>
                <TaxonomyModule datasetId={datasetId} />
              </div>
            )}

            {/* ═══ COMMENTS TAB ═══ */}
            {subTab === 'comments' && (
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {/* Search the comments — collapsible; reuses the dataset-wide full-text SearchPanel (same /search endpoint as the header search). */}
                <div style={{ borderBottom: '1px solid ' + T.border, background: T.bgCard, flexShrink: 0 }}>
                  {!showCommentSearch ? (
                    <button onClick={function() { setShowCommentSearch(true) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: 'transparent', border: 'none', color: T.textFaint, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      <span>{'🔍'}</span> Search comments
                    </button>
                  ) : (
                    <div style={{ padding: '12px 20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                        <button onClick={function() { setShowCommentSearch(false) }}
                          style={{ background: 'transparent', border: 'none', color: T.textFaint, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          Close search {'✕'}
                        </button>
                      </div>
                      <SearchPanel datasetId={datasetId} openEndedField={effectiveFields[0] || (openFields[0] && openFields[0].field) || undefined} />
                    </div>
                  )}
                </div>
                {drillEntity ? (
                  <EntityCommentsPanel
                    entity={drillEntity}
                    rows={entityRows}
                    total={entityTotal}
                    loading={entityLoading}
                    error={entityError}
                    openFields={openFields}
                    schema={schema.fields}
                    onBack={handleBackFromComments}
                    datasetId={datasetId}
                  />
                ) : hasThemes && themes && themes.themes.length > 0 && rowsLoaded ? (
                  <>
                    {/* Breadcrumb + Theme strip — multi-select */}
                    <div style={{ padding: '8px 20px', borderBottom: '1px solid ' + T.border, background: T.bgCard, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: T.textFaint }}>{selectedThemes.length === 0 ? 'All responses' : selectedThemes.length === 1 ? 'Viewing' : selectedThemes.length + ' themes selected'} {'\u2014'} click themes to toggle</span>
                      {/* Theme strip — click to toggle multi-select */}
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
                        <button onClick={function() { setDrillTheme(null); setDrillGroup(null); setSelectedThemes([]) }}
                          style={{ fontSize: 11, fontWeight: selectedThemes.length === 0 ? 700 : 500, padding: '2px 10px', borderRadius: 20, background: selectedThemes.length === 0 ? T.bg : 'transparent', border: '1px solid ' + (selectedThemes.length === 0 ? T.borderMid : 'transparent'), color: selectedThemes.length === 0 ? T.text : T.textFaint, cursor: 'pointer' }}>
                          All
                        </button>
                        {themes.themes.map(function(t, i) {
                          var pal = themeColors[i] || THEME_PALETTE[0]
                          var isActive = selectedThemes.some(function(st) { return st.id === t.id })
                          return (
                            <button key={t.id} onClick={function() {
                              setSelectedThemes(function(prev) {
                                var exists = prev.some(function(st) { return st.id === t.id })
                                var next = exists ? prev.filter(function(st) { return st.id !== t.id }) : prev.concat([t])
                                setDrillTheme(next.length > 0 ? next[0] : null)
                                return next
                              })
                            }}
                              style={{ fontSize: 11, fontWeight: isActive ? 700 : 500, padding: '2px 10px', borderRadius: 20, background: isActive ? pal.bg : 'transparent', border: '1px solid ' + (isActive ? pal.border : 'transparent'), color: isActive ? pal.text : T.textFaint, cursor: 'pointer', transition: 'all .1s' }}>
                              {t.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <CommentsPanel
                      theme={drillTheme || { id: '__all__', name: 'All', description: '', keywords: [], sentiment: 'mixed', count: 0, percentage: 0, relatedThemes: [] }}
                      allThemes={themes.themes}
                      selectedThemes={selectedThemes}
                      parsedData={filteredRows}
                      activeField={effectiveFields[0] || themes!.fieldName}
                      activeFields={effectiveFields}
                      catFields={catFields}
                      themeColors={themeColors}
                      onBack={handleBackFromComments}
                      schema={schema.fields}
                      apiKey={aiEnabled ? (apiKey || undefined) : undefined}
                      datasetId={datasetId}
                      showAllMode={selectedThemes.length === 0}
                    />
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, paddingTop: 60, paddingBottom: 60 }}>
                    <LottieLoader size={96} message="Loading..." />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

      {/* ─── Floating save bar (appears when themes modified) ─── */}
      {isDirty && hasThemes && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: T.bgCard, borderTop: '2px solid ' + T.accent,
          padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 -4px 20px rgba(0,0,0,.1)', zIndex: 50,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fde68a', flexShrink: 0, boxShadow: '0 0 6px #fde68a' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1 }}>
            Unsaved theme changes
          </span>
          <button onClick={function() { setIsDirty(false) }}
            style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 8, color: T.textMid, cursor: 'pointer' }}>
            Discard
          </button>
          <button onClick={function() { saveThemeModel() }}
            disabled={saving}
            style={{ padding: '7px 20px', fontSize: 12, fontWeight: 700, background: T.accent, color: 'white', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            {saving ? 'Saving...' : saved ? '\u2714 Saved' : 'Save Theme Model'}
          </button>
        </div>
      )}

      {/* ─── Modals ────────────────────────────────────────────────────── */}
      {showApiKeyModal && (
        <ApiKeyModal onSave={function(k) { setApiKey(k) }} onClose={function() { setShowApiKeyModal(false) }} />
      )}
      {showThemeEditor && (industryThemes != null) && (
        <ThemeEditor
          onApply={handleThemeEditorApply}
          onClose={function() { setShowThemeEditor(false) }}
          onMineWithAI={canMine && aiEnabled && !aiDisabledByOrg ? function() { setShowThemeEditor(false); mineThemes() } : undefined}
          initialData={themes ? { themes: themes.themes, libName: themeLibName, source: themeSource } : null}
          industryThemes={industryThemes}
          datasetId={datasetId}
          apiKey={aiEnabled ? apiKey : undefined}
        />
      )}
      {showThemeEditor && industryThemes == null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={function() { setShowThemeEditor(false) }}>
          <div style={{ background: T.bgCard, borderRadius: 16, padding: '40px 32px', textAlign: 'center', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}
            onClick={function(e) { e.stopPropagation() }}>
            <LottieLoader size={80} message="Loading industry theme libraries..." />
          </div>
        </div>
      )}
      {/* Collection mine choice modal */}
      {showMineChoice && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={function() { setShowMineChoice(false) }}>
          <div style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}
            onClick={function(e) { e.stopPropagation() }}>
            <div style={{ padding: '20px 24px 12px' }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#111827', margin: 0 }}>Mine Themes for Collection</h3>
              <p style={{ fontSize: 13, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
                Choose how to generate themes for this collection.
              </p>
            </div>
            <div style={{ padding: '8px 24px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={function() { setShowMineChoice(false); mineThemes('merge') }}
                style={{ padding: '14px 16px', borderRadius: 10, border: '1.5px solid #bae6fd', background: '#f0f9ff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0284c7' }}>Merge from members</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  Use existing AI-mined themes from each member dataset and merge them.
                  Identifies shared and unique themes. Fast, no re-mining needed.
                </div>
              </button>
              <button
                onClick={function() { setShowMineChoice(false); mineThemes('fresh') }}
                style={{ padding: '14px 16px', borderRadius: 10, border: '1.5px solid #e5e7eb', background: 'white', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>Mine fresh</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  Sample from all combined responses and discover themes from scratch.
                  Finds cross-dataset patterns but may miss themes unique to one member.
                </div>
              </button>
              <button onClick={function() { setShowMineChoice(false) }}
                style={{ padding: '8px', fontSize: 13, color: '#9ca3af', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
