'use client'
// components/analyze/TextMineModule.tsx
// Main TextMine client shell. Owns all state for the 4 sub-tabs.
// Fetches rows from the paginated rows API, mines themes via server proxy,
// saves theme model back to dataset_state. Ana proprietary prompts stay server-side.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { injectSignalTier, SIGNAL_TIER_ORDER_REDDIT, SIGNAL_TIER_ORDER_SUBSTACK } from '@/lib/signalTier'
import { readSession, writeSession } from '@/lib/useSessionState'
import type {
  Theme, ThemeModel} from '@/lib/themeUtils';
import { THEME_PALETTE,
  recountThemes, sampleSize95, evenSample,
  commentMatchesTheme, getRowText, sentColor, sentBg,
  ratingColor,
  themeFieldKey, themeModelKey, themeFieldEntries, stripFieldEntries,
} from '@/lib/themeUtils'
import type { MinedTheme } from '@/lib/themeMining'
import { stratumKeys, stratifiedDisjointSamples, compositionNote, consensusThemes } from '@/lib/consensusMining'
import { expandEntityTerms } from '@/lib/entityVariants'
import { computeThemeEntities, themeKey } from '@/lib/themeEntities'
import { DIM_AXIS_LABEL, dimSubLabel, AXIS_COLOR, type Axis } from '@/lib/dimensionFields'
import { cachedRequest } from '@/lib/clientRequestCache'
import { isSubstantiveText } from '@/lib/datasetUtils'
import { SUBSTANTIVE_RULE_NOTE } from '@/lib/usefulness'
import { applyFilters, filterCount } from '@/lib/filterUtils'
import type { Filters } from '@/lib/filterUtils'
import { sigTest, welchTTest } from '@/lib/statsUtils'
import { smartOrder } from '@/lib/scaleUtils'
import { resolveAlias } from '@/lib/aliasUtils'
import { useFilters } from '@/components/analyze/FilterContext'
import { useRows } from '@/components/analyze/RowsContext'
import ThemePopover from '@/components/analyze/textmine/ThemePopover'
import SignalsView from '@/components/analyze/textmine/SignalsView'
import CommentSearchPanel from '@/components/analyze/textmine/CommentSearchPanel'
import BreakdownDist from '@/components/analyze/textmine/BreakdownDist'
import OpinionPopover from '@/components/analyze/textmine/OpinionPopover'
import HelpHint from '@/components/analyze/textmine/HelpHint'
// Nav types + the pure (section, view) ⇄ (subTab, viewBy) state map (shared with
// the Advanced pages' bar + unit-tested in tests/unit/textmineNav).
import { type SubTab, type Section, type LensView, sectionOf, viewOf, deriveLegacy, viewsFor, cellHasContent, availableSections } from '@/lib/textmineNav'
import EntitiesCard, { type EntityRow } from '@/components/analyze/EntitiesCard'
import TaxonomyModule from '@/components/analyze/TaxonomyModule'
import DimensionCloud from '@/components/analyze/textmine/DimensionCloud'
import DimensionCompareTab from '@/components/analyze/textmine/DimensionCompareTab'
import TextMineNav from '@/components/analyze/TextMineNav'
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
const FilteredCommentsPanel = dynamic(
  function() { return import('@/components/analyze/textmine/FilteredCommentsPanel') },
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
import { INDUSTRY_LABELS, RESTAURANT_INDUSTRIES, type Industry } from '@/lib/industryDefaults'

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
  taxonomyEnabled?:  boolean   // the DATASET has Dimensions enabled (`datasets.taxonomy_enabled`) — org capability alone no longer shows the tab (owner decision 2026-09-03)
  taxonomySuppressed?: boolean // AI detected non-food-service → hide Dimensions even for google_reviews (overrides only the source proxy, not an explicit enable)
  anaLibrary?:       string | null
  initialOpenEditor?: boolean
  outletCount?:      number    // # of locations — the DATA half of the Advanced gate (google_reviews + ≥5)
  outletReportingEnabled?: boolean  // the CAPABILITY half: org feature OR the dataset's Schema toggle
  initialHasEntities?: boolean  // server-prefetched (scope has ≥1 non-hidden catalog entity) so the Entities pill doesn't pop in after the client catalog fetch; only seeds the gate while that fetch is in flight, then the live catalog governs
}

// Persisted UI state (sessionStorage). All optional — older saved payloads may
// omit fields, and the legacy subTab/viewBy shape is mapped forward on restore.
interface TmSessionState {
  activeField?: string | null
  activeFields?: string[]
  section?: Section
  view?: LensView
  subTab?: SubTab
  viewBy?: string
  themesView?: 'distribution' | 'cards' | 'signals'
  signalCutoffs?: { mainstream: number; noise: number }
  showAllThemes?: boolean
  compareViewMode?: 'group' | 'theme'
  compareSmartAxes?: boolean
  breakdownField?: string | null
  compareFields?: string[]
  selectedValues?: string[]
  ratingField?: string | null
  colorMode?: 'sentiment' | 'rating'
  hideFlagged?: boolean
}


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
  analytics: DatasetAnalytics | null
  selectedValues: Set<string>
  setSelectedValues: (s: Set<string>) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  function getValues(field: string): string[] {
    // Use analytics fieldSummaries for authoritative value list (covers all rows, not just sample)
    var summary = analytics?.fieldSummaries?.[field] as { values?: string[]; topN?: string[] } | undefined
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
    var aliases = sf?.valueAliases
    if (aliases && Object.keys(aliases).length > 0) {
      var seen = new Set<string>()
      return raw.map(function(v) { return aliases![v] || v }).filter(function(v) { if (seen.has(v)) return false; seen.add(v); return true })
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
  var sigLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  var [sigPopRect, setSigPopRect] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  // Bar metric: 'share' (theme % within segment, default) vs 'rating' (avg star
  // rating). Toggle only meaningful when the dataset has a rating field.
  var [barMetric, setBarMetric] = useState<'share' | 'rating'>('share')
  // By-Group card ordering (locations etc.) — its own control, independent of
  // Smart Axes (which orders theme rows / the By-Theme view). Default puts the
  // data-rich segments first so nominal-N groups don't lead.
  var [groupSort, setGroupSort] = useState<'responses' | 'name' | 'rating'>('responses')
  // Collapse nominal-N segments (< MIN_GROUP_N responses) behind an expander so
  // a handful of low-volume groups don't bury the meaningful ones.
  var [showAllGroups, setShowAllGroups] = useState(false)

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
  // Rating scale max for the 'rating' bar metric (absolute scale, so a bar
  // reads as "how close to full marks"). From the rating field's schema max,
  // else 10 for NPS / 5 default.
  var ratingMax = (function() {
    if (!ratingField) return 5
    var rf = schema.find(function(s) { return s.field === ratingField })
    if (rf && rf.max != null) return rf.max
    return rf && rf.sqt === 'nps' ? 10 : 5
  })()
  // Rating mode is only offered when a rating field exists; fall back to share.
  var effectiveBarMetric: 'share' | 'rating' = (ratingField && barMetric === 'rating') ? 'rating' : 'share'

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

  // Two-count model: theme prevalence in the Compare view divides by SUBSTANTIVE
  // comments (per the active field), and the z-test (sigTest) baseline runs on
  // the same base — numerator and denominator both substantive, so a segment's
  // "mentions theme X at Y%" isn't inflated by non-answers. Rating averages
  // (groupRating/overallRatAvg) stay over ALL rated rows (ratings-all-reviews).
  var isSubField = function(r: Record<string, unknown>) { return isSubstantiveText(String(r[field] || '')) }

  var compStats = (function() {
    if (!themes || !themes.themes || !breakdownFields.length || !parsedData.length) return null
    var totalRows = parsedData.filter(isSubField).length
    var groupMap: Record<string, Record<string, unknown>[]> = {}
    parsedData.forEach(function(r) { var key = groupKey(r); if (!groupMap[key]) groupMap[key] = []; groupMap[key].push(r) })
    var groupKeys = Object.keys(groupMap).sort()

    var groupStats = groupKeys.map(function(gk) {
      var rows = groupMap[gk]
      var groupTotal = rows.filter(isSubField).length
      var groupPct = totalRows > 0 ? Math.round(groupTotal / totalRows * 100) : 0
      var themeCounts = themes.themes.map(function(t) {
        var matches = rows.filter(function(r) { return isSubField(r) && commentMatchesTheme(String(r[field] || ''), t) })
        var avgRating: number | null = null
        var ratingValues: number[] = []
        if (ratingField && matches.length > 0) {
          matches.forEach(function(r) { var rv = parseFloat(String(r[ratingField] ?? '')); if (!isNaN(rv)) ratingValues.push(rv) })
          if (ratingValues.length > 0) avgRating = Math.round(ratingValues.reduce(function(a, b) { return a + b }, 0) / ratingValues.length * 100) / 100
        }
        return { themeId: t.id, themeName: t.name, count: matches.length, avgRating: avgRating, ratingValues: ratingValues }
      })
      var unclassified = rows.filter(function(r) {
        return isSubField(r) && !themes.themes.some(function(t) { return commentMatchesTheme(String(r[field] || ''), t) })
      }).length
      // Group-level overall avg rating (across all rows in the segment, not
      // theme-scoped) — powers the "Avg rating" sort. Null when no rating field.
      var groupRating: number | null = null
      if (ratingField) {
        var grS = 0, grC = 0
        rows.forEach(function(r) { var rv = parseFloat(String(r[ratingField] ?? '')); if (!isNaN(rv)) { grS += rv; grC++ } })
        if (grC > 0) groupRating = grS / grC
      }
      return { group: gk, groupTotal: groupTotal, groupPct: groupPct, themeCounts: themeCounts, unclassified: unclassified, groupRating: groupRating }
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
        {(function() {
          // 'rating' bars scale against the rating-scale max (absolute); 'share'
          // bars scale against the largest segment share (relative). Unclassified
          // rows have no rating, so they show empty in rating mode.
          var widthPct = effectiveBarMetric === 'rating'
            ? (props.avgRating != null && ratingMax ? Math.min(100, props.avgRating / ratingMax * 100) : 0)
            : (props.maxPct > 0 ? props.pct / props.maxPct * 100 : 0)
          var minPct = effectiveBarMetric === 'rating' ? (props.avgRating != null ? 2 : 0) : (props.pct > 0 ? 2 : 0)
          // In rating mode color by the red→green ramp so a low-rated segment reads at a glance.
          var ramp = props.avgRating != null && ratingMax ? props.avgRating / ratingMax : 0
          var ratingColor = ramp >= 0.8 ? '#059669' : ramp >= 0.6 ? '#84cc16' : ramp >= 0.4 ? '#f59e0b' : '#dc2626'
          var barColor = props.isUnclassified ? T.borderMid : (effectiveBarMetric === 'rating' ? (props.avgRating != null ? ratingColor : T.borderMid) : props.color)
          return (
            <div style={{ flex: 1, height: 10, background: T.bg, borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: Math.max(widthPct, minPct) + '%', background: barColor, borderRadius: 5, transition: 'width .5s' }} />
            </div>
          )
        })()}
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
      {/* Top bar — compact, matches Dimensions/Entities Compare (no big title
          card; the ★ legend + segment help live in the "?" hint). */}
      <div style={{ flexShrink: 0, padding: '12px 24px', borderBottom: '1px solid ' + T.border, background: T.bgCard }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.textMid, marginBottom: 6, display: 'inline-flex', alignItems: 'center' }}>
              Break down by:
              <HelpHint title="Group Comparison" placement="bottom">
                Select one or more fields to build segments and compare theme distribution. <strong style={{ color: '#16a34a' }}>★</strong> over-indexed / <strong style={{ color: '#dc2626' }}>★</strong> under-indexed vs the baseline (p &lt; 0.05, min n=30).
              </HelpHint>
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
            {/* Bar metric: % share vs avg rating (only when a rating field exists) */}
            {ratingField && (
              <div style={{ display: 'flex', background: T.bg, borderRadius: 20, padding: 2, border: '1px solid ' + T.border }}>
                {[['share', '%'], ['rating', '★ Rating']].map(function(pair) {
                  var m = pair[0]; var lbl = pair[1]
                  return <button key={m} onClick={function() { setBarMetric(m as 'share' | 'rating') }}
                    title={m === 'rating' ? 'Bars show average rating (out of ' + ratingMax + ')' : 'Bars show theme share (% of segment)'}
                    style={{ fontSize: 11, fontWeight: barMetric === m ? 700 : 500, padding: '4px 12px', borderRadius: 18, background: barMetric === m ? T.bgCard : 'transparent', color: barMetric === m ? T.text : T.textMute, border: 'none', cursor: 'pointer', transition: 'all .12s' }}>
                    {lbl}
                  </button>
                })}
              </div>
            )}
            {/* By Group → segment sort dropdown; By Theme → Smart Axes (theme order) */}
            {viewMode === 'group' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.textMute, userSelect: 'none' }}>
                Sort:
                <select value={groupSort} onChange={function(e) { setGroupSort(e.target.value as 'responses' | 'name' | 'rating') }}
                  style={{ fontSize: 11, fontWeight: 600, color: T.text, padding: '4px 8px', border: '1px solid ' + T.border, borderRadius: 8, background: T.bgCard, cursor: 'pointer' }}>
                  <option value="responses">Responses (high to low)</option>
                  <option value="name">Name (A to Z)</option>
                  {ratingField && <option value="rating">Avg rating (low to high)</option>}
                </select>
              </label>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.textMute, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={smartAxes} onChange={function() { setSmartAxes(!smartAxes) }} style={{ accentColor: T.accent }} />
                Smart Axes
              </label>
            )}
            {/* Summarize Findings */}
            {outliers.length > 0 && (
              <button onClick={function() { setShowSummary(true) }}
                style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: T.accentBg, color: T.accent, border: '1px solid ' + T.accentMid, borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                {'\uD83D\uDCCB'} Summarize <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: T.accent, color: 'white' }}>{outliers.length}</span>
              </button>
            )}
          </div>
        </div>
      </div>{/* end top bar */}

      {/* Scrollable results area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
      {/* Stats cards — By Group or By Theme */}
      {compStats && breakdownFields.length > 0 && (function() {
        if (viewMode === 'group') {
          var groupNames = compStats!.groupStats.map(function(g) { return g.group })
          var isSignalTierGroup = breakdownFields.length === 1 && breakdownFields[0] === 'signal_tier'
          var groupMap: Record<string, typeof compStats.groupStats[0]> = {}
          compStats!.groupStats.forEach(function(g) { groupMap[g.group] = g })
          var orderedNames: string[]
          if (isSignalTierGroup) {
            // Signal tiers have a canonical ordinal order; keep it (sort dropdown N/A).
            var isReddit = groupNames.some(function(n) { return n === 'Mainstream' || n === 'Controversial' || n === 'Fringe' || n === 'Noise' })
            var tierList = isReddit ? SIGNAL_TIER_ORDER_REDDIT : SIGNAL_TIER_ORDER_SUBSTACK
            orderedNames = tierList.filter(function(t) { return groupNames.indexOf(t) >= 0 })
          } else {
            orderedNames = groupNames.slice().sort(function(a, b) {
              if (groupSort === 'responses') return groupMap[b].groupTotal - groupMap[a].groupTotal
              if (groupSort === 'rating') {
                var ra = groupMap[a].groupRating, rb = groupMap[b].groupRating
                if (ra == null && rb == null) return a.localeCompare(b)
                if (ra == null) return 1
                if (rb == null) return -1
                return ra - rb  // low → high (worst segments first)
              }
              return a.localeCompare(b)  // name
            })
          }
          var sortedGroups = orderedNames.map(function(n) { return groupMap[n] }).filter(Boolean)
          // Collapse nominal-N segments behind an expander (skip the collapse when
          // ALL segments are nominal, so a small dataset isn't hidden entirely).
          var MIN_GROUP_N = 30
          var nominalCount = sortedGroups.filter(function(g) { return g.groupTotal < MIN_GROUP_N }).length
          var collapseNominal = !showAllGroups && !isSignalTierGroup && nominalCount > 0 && nominalCount < sortedGroups.length
          var visibleGroups = collapseNominal ? sortedGroups.filter(function(g) { return g.groupTotal >= MIN_GROUP_N }) : sortedGroups
          return (
            <div>
              {visibleGroups.map(function(g) {
                var maxShare = g.themeCounts.reduce(function(m, tc) { return Math.max(m, g.groupTotal > 0 ? Math.round(tc.count / g.groupTotal * 100) : 0) }, 1)
                if (g.unclassified > 0) { var uPct = g.groupTotal > 0 ? Math.round(g.unclassified / g.groupTotal * 100) : 0; if (uPct > maxShare) maxShare = uPct }
                return (
                  <div key={g.group} style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '16px 18px', marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 14 }}>
                      <span style={{ color: T.accent }}>{g.group}</span>
                      <span style={{ fontSize: 12, fontWeight: 400, color: T.textMute, marginLeft: 6 }}>({g.groupPct}% of dataset {'\u00B7'} {g.groupTotal.toLocaleString()} responses)</span>
                      {/* Segment-level overall avg rating, colored vs the dataset overall. */}
                      {ratingField && g.groupRating != null && (function() {
                        var gd = g.groupRating! - (compStats!.overallRatAvg || 0)
                        return <span style={{ fontSize: 13, fontWeight: 800, marginLeft: 10, color: gd > 0.05 ? '#059669' : gd < -0.05 ? '#dc2626' : T.textMid }}
                          title={'Average rating across this segment: ' + g.groupRating!.toFixed(2) + ' (' + (gd >= 0 ? '+' : '') + gd.toFixed(2) + ' vs overall ' + (compStats!.overallRatAvg || 0).toFixed(2) + ')'}>
                          {'\u2605 ' + g.groupRating!.toFixed(1)}</span>
                      })()}
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
              {/* Nominal-N expander — show/hide the segments below MIN_GROUP_N. */}
              {(collapseNominal || (showAllGroups && nominalCount > 0 && !isSignalTierGroup)) && (
                <button onClick={function() { setShowAllGroups(!showAllGroups) }}
                  style={{ display: 'block', margin: '4px auto 8px', padding: '7px 16px', fontSize: 12, fontWeight: 600, background: T.bg, color: T.textMid, border: '1px solid ' + T.border, borderRadius: 8, cursor: 'pointer' }}>
                  {showAllGroups
                    ? 'Hide ' + nominalCount + ' low-volume segment' + (nominalCount === 1 ? '' : 's') + ' (< 30 responses)'
                    : 'Show all ' + sortedGroups.length + ' segments (' + nominalCount + ' with < 30 responses)'}
                </button>
              )}
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
                <button onClick={function() { void navigator.clipboard.writeText(summaryText).then(function() { setCopied(true); setTimeout(function() { setCopied(false) }, 2000) }) }}
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
            <button onClick={function(e) { e.stopPropagation(); void navigator.clipboard.writeText(pinnedSigData!.text).then(function() { setCopiedSig(true) }) }}
              style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: copiedSig ? T.greenBg : T.bg, color: copiedSig ? T.green : T.textMid, border: '1px solid ' + (copiedSig ? T.greenMid : T.border), cursor: 'pointer' }}>
              {copiedSig ? '\u2713 Copied' : '\u2398 Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}



// ─── Consensus mining (2026-09-03, lib/consensusMining) ────────────────────────
// K independent mines on DISJOINT stratified samples (rating bucket × time
// position); only themes recurring across runs survive, with stability
// metadata for the theme cards. Falls back to a single classic mine when the
// corpus can't support K disjoint runs of useful size (or the user's sample
// slider already covers most of the corpus).

const CONSENSUS_RUNS = 3
const MIN_CONSENSUS_RUN = 30

interface MineRunResult {
  themes: MinedTheme[]
  summary?: string
  foodService?: boolean
}

async function postMine(datasetId: string, body: Record<string, unknown>): Promise<MineRunResult> {
  var res = await fetch('/api/datasets/' + datasetId + '/mine-themes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  var data = await res.json()
  if (!res.ok) {
    var errMsg = data.error || 'Mining failed'
    if (errMsg.startsWith('AUTH_ERROR')) throw new Error('AUTH_ERROR')
    if (errMsg.startsWith('QUOTA_ERROR')) throw new Error('QUOTA_ERROR')
    throw new Error(errMsg)
  }
  if (!data.themes) throw new Error('No themes returned')
  return data as MineRunResult
}

async function mineWithConsensus(opts: {
  datasetId: string
  apiKey: string
  fieldName: string
  schemaCtx: string
  texts: string[]
  ratings: (string | number | null | undefined)[]
  n: number
}): Promise<MineRunResult & { sampledCount: number; consensus: NonNullable<ThemeModel['consensus']> | null }> {
  var k = opts.texts.length >= CONSENSUS_RUNS * opts.n && opts.n >= MIN_CONSENSUS_RUN ? CONSENSUS_RUNS : 1
  if (k === 1) {
    var sampled = evenSample(opts.texts, Math.max(1, opts.n))
    var single = await postMine(opts.datasetId, {
      apiKey: opts.apiKey, texts: sampled, fieldName: opts.fieldName, schemaCtx: opts.schemaCtx,
    })
    return { ...single, sampledCount: sampled.length, consensus: null }
  }

  var runsIdx = stratifiedDisjointSamples(stratumKeys(opts.ratings), opts.n, k)
  var settled = await Promise.allSettled(runsIdx.map(function(idx) {
    var note = compositionNote(idx.map(function(i) { return opts.ratings[i] }), 'rating')
    return postMine(opts.datasetId, {
      apiKey: opts.apiKey,
      texts: idx.map(function(i) { return opts.texts[i] }),
      fieldName: opts.fieldName,
      schemaCtx: opts.schemaCtx,
      sampleNote: note || undefined,
    })
  }))
  var ok: MineRunResult[] = []
  settled.forEach(function(s) { if (s.status === 'fulfilled') ok.push(s.value) })
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason
  var okRows = 0
  settled.forEach(function(s, i) { if (s.status === 'fulfilled') okRows += runsIdx[i].length })
  if (ok.length === 1) return { ...ok[0], sampledCount: okRows, consensus: null }

  var consensus = consensusThemes(ok.map(function(o) { return o.themes }))
  if (consensus.themes.length < 2) {
    // Runs disagreed almost entirely — ship the first run rather than an
    // empty model, and carry no consensus claim.
    return { ...ok[0], sampledCount: okRows, consensus: null }
  }
  var foodVotes = ok.map(function(o) { return o.foodService }).filter(function(v) { return typeof v === 'boolean' })
  var summary = (ok[0].summary || '').trim()
  summary += (summary ? ' ' : '') +
    'Validated by consensus: ' + consensus.themes.length + ' of ' +
    (consensus.themes.length + consensus.dropped.length) + ' candidate themes were stable across ' +
    ok.length + ' independent stratified samples.'
  return {
    themes: consensus.themes,
    summary: summary,
    foodService: foodVotes.length ? foodVotes.filter(Boolean).length > foodVotes.length / 2 : undefined,
    sampledCount: okRows,
    consensus: { runs: ok.length, kept: consensus.themes.length, dropped: consensus.dropped.length, minSupport: consensus.minSupport },
  }
}

// ─── Main TextMineModule ───────────────────────────────────────────────────────

export default function TextMineModule({ datasetId, schema, analytics, savedThemeModel, datasetSource, taxonomyEnabled, taxonomySuppressed, anaLibrary, initialOpenEditor, outletCount, outletReportingEnabled, initialHasEntities }: Props) {
  const totalRows = analytics?.totalRows ?? 0
  const { rows, rowsLoaded, rowsLoading, rowsError, fetchRows: triggerRowFetch, sampled: rowsSampled, sampledCount, totalRows: rowsTotalRows, rowsProgressBytes, rowsProgressRows, rowsExpected } = useRows()
  // Live progress caption for the bulk row load — a ≥50K-row sample is tens of
  // MB, long enough to look hung behind a bare spinner. Prefers "N of M rows
  // · %" (rows counted off the stream, denominator = min(row_count, cap));
  // falls back to MB before the first row lands.
  const rowsProgressLabel = rowsProgressRows > 0
    ? rowsProgressRows.toLocaleString()
      + (rowsExpected > 0
        ? ' of ' + rowsExpected.toLocaleString() + ' rows · ' + Math.min(99, Math.round(rowsProgressRows / rowsExpected * 100)) + '%'
        : ' rows')
    : (rowsProgressBytes > 0 ? Math.round(rowsProgressBytes / (1024 * 1024)) + ' MB received' : '')

  // Fields the user has hidden in the Schema editor. Honored across analysis
  // surfaces — Insights here, the Filter UI server-side, and Charts/Stats
  // already filter on f.type !== 'ignore' / 'id'. The hidden boolean is a
  // separate flag in the schema config; we respect it here for symmetry.
  const hiddenFields: string[] = useMemo(
    () => (schema?.fields || [])
      .filter(function(f: SchemaField) { return f.type === 'ignore' || f.type === 'id' || f.hidden === true })
      .map(function(f: SchemaField) { return f.field as string }),
    [schema?.fields],
  )

  const [computing, setComputing] = useState(false)
  const [displayThemes, setDisplayThemes] = useState<ThemeModel | null>(null)
  const overallBoxRef = useRef<{ topBoxPct: number; bottomBoxPct: number } | null>(null)
  const [themes, setThemes] = useState<ThemeModel | null>(savedThemeModel || null)
  // Per-field theme sets: one model per Text selection, keyed by themeFieldKey.
  // Seeded from the saved blob (legacy single models wrap as one entry); kept
  // fresh on mine/apply and stashed on selection switches so no set is lost.
  const [fieldModels, setFieldModels] = useState<Record<string, ThemeModel>>(function() { return themeFieldEntries(savedThemeModel) })
  const [themeSource, setThemeSource] = useState<string | null>(savedThemeModel?.themeSource || (savedThemeModel as (ThemeModel & { source?: string | null }) | null)?.source || null)
  const [themeLibName, setThemeLibName] = useState<string | null>(savedThemeModel?.themeLibName || (savedThemeModel as (ThemeModel & { libName?: string | null }) | null)?.libName || null)
  const [samplingInfo, setSamplingInfo] = useState<{ sampled: number; total: number } | null>(null)
  // The server's substantive comment base (theme-counts `totalNonEmpty`) — the
  // exact denominator its per-theme counts are a share of. Held separately from
  // samplingInfo (which counts ROWS SCANNED, not substantive comments) so the
  // theme cards can show honest percentages before the client rows arrive.
  // null = server counts not back yet.
  const [serverTotalResp, setServerTotalResp] = useState<number | null>(null)
  // True while the server theme-count scan is in flight. Any count on screen
  // during that window is provisional — the saved model's stored numbers, or a
  // client recount — so the cards label it rather than presenting it as final.
  const [countsPending, setCountsPending] = useState(false)
  // Server-computed enrichment for theme cards:
  //   topicalWords[themeId]      → top topical words [word, count][] (currently unused)
  //   cooccurrence[themeIdA]     → { themeIdB: rowsMatchingBoth, ... }
  //   extrasLoaded         → true once the fetch has returned (so the card
  //                                can distinguish "pre-fetch placeholder" from
  //                                "fetch returned, theme has no co-occurrences").
  // Fetched from /api/datasets/[id]/theme-counts with the cooccurrence flag.
  const [serverTopical, setServerTopical] = useState<Record<string, [string, number][]>>({})
  const [serverCoOccurrence, setServerCoOccurrence] = useState<Record<string, Record<string, number>>>({})
  const [extrasLoaded, setExtrasLoaded] = useState(false)
  // Per-theme Dimensions (taxonomy) breakdown: themeId → top {axis, sub, count}.
  // Populated by fetchServerThemeCounts when the dataset has Dimensions enabled.
  const [serverThemeDimensions, setServerThemeDimensions] = useState<Record<string, { axis: string; sub: string; count: number }[]>>({})
  // Same gate as the Dimensions sub-tab: dataset is classifiable into Dimensions.
  const dimensionsEnabled = !!taxonomyEnabled || (datasetSource === 'google_reviews' && !taxonomySuppressed)
  const router = useRouter()
  // Brief banner shown when restaurant data was auto-detected at theme time and
  // Dimensions are being classified in the background (the "zero-click" path).
  const [dimAutoNotice, setDimAutoNotice] = useState<string | null>(null)

  // Unmount guard for the background classify loops below: they run up to 300
  // sequential chunks (minutes on large datasets) and MUST stop when the user
  // navigates away — a loop surviving unmount kept hammering the DB and its
  // router.refresh() stomped in-flight tab navigations (owner-observed "system
  // hangs switching Statistics → Schema", 2026-07-12). Classification is
  // idempotent/resumable, so breaking mid-run is safe.
  const classifyAlive = useRef(true)
  useEffect(function () {
    classifyAlive.current = true
    return function () { classifyAlive.current = false }
  }, [])

  // A dataset that ALREADY has stored classification while the toggle is OFF
  // was turned off by a person — the auto paths below must treat that as a
  // standing decision, not a discovery to re-make (owner-hit 2026-09-04: ANES
  // was explicitly disabled, a re-mine's auto-tag PATCHed it back on and
  // flashed the "Tagging emotion language…" notice). First-time datasets have
  // no stored axes, so genuine discovery still auto-enables.
  const userOptedOutOfDimensions = useCallback(async function (fields: string[]): Promise<boolean> {
    if (taxonomyEnabled) return false
    try {
      var qs = fields.map(function (f) { return 'fields=' + encodeURIComponent(f) }).join('&')
      var r = await fetch('/api/datasets/' + datasetId + '/taxonomy?' + qs)
      var roll = r.ok ? await r.json() : null
      return Array.isArray(roll?.axes) && roll.axes.some(function (a: { count?: number }) { return (a.count || 0) > 0 })
    } catch { return false }
  }, [datasetId, taxonomyEnabled])

  // Restaurant data was detected at theme-generation time (AI food-service flag,
  // or a restaurant theme library was applied) → turn Dimensions on and classify
  // in the background, no clicks: PATCH the flag, loop the keyword classifier over
  // untagged rows (idempotent — a no-op if already classified), then refresh so
  // the Dimensions section appears. Best-effort; failures are silent.
  const autoEnableDimensions = useCallback(async function (fields: string[]) {
    if (!fields.length) return
    if (await userOptedOutOfDimensions(fields)) return // standing human opt-out
    setDimAutoNotice('Restaurant data detected — classifying Dimensions…')
    try {
      await fetch('/api/datasets/' + datasetId, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxonomy_enabled: true }),
      })
      for (var guard = 0; guard < 300; guard++) {
        if (!classifyAlive.current) return // user left — resume on next visit
        var r = await fetch('/api/datasets/' + datasetId + '/taxonomy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pendingOnly: true, textFields: fields }),
        })
        if (!r.ok) break
        var j = await r.json()
        if (j.done) break
      }
      if (!classifyAlive.current) return // never refresh from an unmounted tab
      setDimAutoNotice('Dimensions ready ✓')
      router.refresh()
      setTimeout(function () { setDimAutoNotice(null) }, 4000)
    } catch {
      setDimAutoNotice(null)
    }
  }, [datasetId, router, userOptedOutOfDimensions])

  // NON-restaurant data at theme-generation time → run the universal emotion
  // tier automatically (TAXONOMY.md §2a.0). Order matters vs autoEnableDimensions:
  // classify FIRST (the route picks emotion mode — mine-themes just stamped
  // taxonomy_suppressed), then reveal the Dimensions section ONLY if emotion
  // language actually fired (the genre gate: an ideation survey never grows a
  // "0% emotion" tab). Best-effort; failures are silent.
  const autoTagEmotion = useCallback(async function (fields: string[]) {
    if (!fields.length) return
    if (await userOptedOutOfDimensions(fields)) return // standing human opt-out — no notice, no classify, no flag flip
    setDimAutoNotice('Tagging emotion language (disappointment · blame · churn intent · anger · ascribed threat)…')
    try {
      for (var guard = 0; guard < 300; guard++) {
        if (!classifyAlive.current) return // user left — resume on next visit
        var r = await fetch('/api/datasets/' + datasetId + '/taxonomy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pendingOnly: true, textFields: fields }),
        })
        if (!r.ok) break
        var j = await r.json()
        if (j.done) break
      }
      if (!classifyAlive.current) return // never refresh from an unmounted tab
      var qs = fields.map(function (f) { return 'fields=' + encodeURIComponent(f) }).join('&')
      var rollupRes = await fetch('/api/datasets/' + datasetId + '/taxonomy?' + qs)
      var rollup = rollupRes.ok ? await rollupRes.json() : null
      var emotionFired = Array.isArray(rollup?.axes) && rollup.axes.some(function (a: { axis?: string; count?: number }) { return a.axis === 'emotion' && (a.count || 0) > 0 })
      if (emotionFired) {
        await fetch('/api/datasets/' + datasetId, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taxonomy_enabled: true }),
        })
        if (!classifyAlive.current) return // the awaits above take seconds — re-check before touching state
        setDimAutoNotice('Emotion language tagged ✓')
        setTimeout(function () { setDimAutoNotice(null) }, 4000)
      } else {
        if (!classifyAlive.current) return
        setDimAutoNotice(null)
      }
      if (!classifyAlive.current) return // never refresh from an unmounted tab (rollup/PATCH ran since the last check)
      router.refresh()
    } catch {
      setDimAutoNotice(null)
    }
  }, [datasetId, router, userOptedOutOfDimensions])

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
  // Canonical nav state: which peer section + which lens view. The legacy
  // (subTab, viewBy) the renderers key off are DERIVED from these — see the
  // `deriveLegacy` const just below. Section/view is the only representation
  // that covers the full grid (Dimensions×Clouds/Compare, and Dimensions vs
  // Themes Comments, all collapse under subTab/viewBy alone).
  const [section, setSection] = useState<Section>('themes')
  const [view, setView] = useState<LensView>('overview')
  const [showCommentSearch, setShowCommentSearch] = useState(false)  // collapsible search in the Comments tab
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
  const [previousView, setPreviousView] = useState<LensView>('overview')
  // Legacy (subTab, viewBy) the content renderers read — derived, never set
  // directly. deriveLegacy is pure + cheap, so a plain recompute per render.
  const { subTab, viewBy } = deriveLegacy(section, view)
  const [opinionWord, setOpinionWord] = useState<string | null>(null)
  const [themePopoverIdx, setThemePopoverIdx] = useState<number | null>(null)
  // Which THEME the opinion word was opened from — by id, so both entry points
  // can set it: a keyword chip on a theme card, and a word inside that theme's
  // cloud row. (Theme Clouds draws one cloud PER theme, so the row identifies the
  // theme; it is NOT `selectedThemes`, which is the filter selection and is
  // normally empty there.) null = not opened from a theme, so there is no theme
  // for the percentage to be a share of.
  const [opinionThemeId, setOpinionThemeId] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [ratingField, setRatingField] = useState<string | null>(ratingFields.length > 0 ? ratingFields[0].field : null)
  const [colorMode, setColorMode] = useState<'sentiment' | 'rating'>('sentiment')
  const [hideFlagged, setHideFlagged] = useState(false)
  const [restoredFromSession, setRestoredFromSession] = useState(false)

  // Entity catalog — fetched once on mount (hoisted here so it survives subTab switches).
  const [entityCatalogRows, setEntityCatalogRows]         = useState<EntityRow[]>([])
  const [entityCatalogTotal, setEntityCatalogTotal]       = useState<number | null>(null)
  const [entityCatalogScopeType, setEntityCatalogScopeType] = useState<'dataset' | 'collection' | null>(null)
  const [entityCatalogSampled, setEntityCatalogSampled]   = useState(false)
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
      setEntityCatalogSampled(!!data.sampled)
    } catch (err: unknown) {
      setEntityCatalogError(err instanceof Error ? err.message : 'Failed to load entities')
    } finally {
      setEntityCatalogLoading(false)
    }
  }, [datasetId])

  useEffect(function() { void loadEntityCatalog() }, [loadEntityCatalog])

  // Entity drill mode — set when user clicks an entity pill in EntitiesCard.
  // Comments tab enters entity mode: shows API-fetched rows instead of client filteredRows.
  // Unified Comments filter — entity + dimension facets that AND-combine with
  // the selected themes. Selecting any entity/dimension switches the Comments
  // results to the server-filtered panel (get_rows_by_filters).
  type DimSel = { axis: string; sub: string }
  const [filterEntities, setFilterEntities] = useState<{ slug: string; canonical: string; category: string; aliases: string[] }[]>([])
  const [filterDims, setFilterDims] = useState<DimSel[]>([])
  const [dimFacets, setDimFacets] = useState<{ axis: string; label: string; subs: { sub: string; count: number }[] }[]>([])
  const [dimFacetsLoaded, setDimFacetsLoaded] = useState(false)
  const [filterRows, setFilterRows]   = useState<Array<{ id: number; dataset_id: string; row_index: number; data: Record<string, unknown> }>>([])
  const [filterTotal, setFilterTotal] = useState(0)
  const [filterLoading, setFilterLoading] = useState(false)
  const [filterError, setFilterError]     = useState('')

  // After mount, restore persisted UI state. Gating on restoredFromSession
  // ensures the writer-effect below doesn't overwrite sessionStorage with
  // defaults before this restore runs.
  useEffect(function() {
    const saved = readSession<TmSessionState>(_tmKey)
    if (saved) {
      if (saved.activeField !== undefined) setActiveField(saved.activeField)
      if (Array.isArray(saved.activeFields)) setActiveFields(saved.activeFields)
      // New shape persists section/view; fall back to mapping older saved
      // subTab/viewBy so a mid-rollout reload doesn't reset the user's place.
      if (saved.section && saved.view) { setSection(saved.section); setView(saved.view) }
      else if (saved.subTab) { setSection(sectionOf(saved.subTab, saved.viewBy === 'entity' ? 'entity' : 'theme')); setView(viewOf(saved.subTab)) }
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
      activeField: activeField, activeFields: activeFields, section: section, view: view,
      themesView: themesView, showAllThemes: showAllThemes, signalCutoffs: signalCutoffs,
      breakdownField: breakdownField, compareFields: compareFields,
      selectedValues: Array.from(selectedValues),
      compareViewMode: compareViewMode, compareSmartAxes: compareSmartAxes,
      ratingField: ratingField, colorMode: colorMode, hideFlagged: hideFlagged,
    })
  }, [restoredFromSession, activeField, activeFields, section, view, themesView, showAllThemes, signalCutoffs, breakdownField, compareFields, selectedValues, compareViewMode, compareSmartAxes, ratingField, colorMode, hideFlagged, _tmKey])

  // Whether a section tab is reachable for this dataset (mirrors the row-1 gates).
  // hasEntities: the live client catalog governs once loaded; while that fetch
  // is still in flight, fall back to the server-prefetched flag so the Entities
  // pill renders on first paint instead of popping in (steady state unchanged —
  // if the catalog comes back empty, the pill drops as before).
  const sectionGate = { datasetSource: datasetSource, taxonomyEnabled: taxonomyEnabled, taxonomySuppressed: taxonomySuppressed, hasEntities: entityCatalogRows.length > 0 || (entityCatalogLoading && !!initialHasEntities), outletCount: outletCount, outletReportingEnabled: outletReportingEnabled }
  function sectionAvailable(s: Section): boolean {
    return availableSections(sectionGate).indexOf(s) >= 0
  }
  // Apply ?section=&view= from the URL once entity availability is known (the
  // catalog loads async). URL wins over the sessionStorage restore above; absent
  // params leave the restored/default state untouched. Runs once via the ref.
  const urlAppliedRef = useRef(false)
  useEffect(function() {
    if (urlAppliedRef.current || entityCatalogLoading) return
    urlAppliedRef.current = true
    const sp = new URLSearchParams(window.location.search)
    const sec = sp.get('section') as Section | null
    const vw = sp.get('view') as LensView | null
    if (sec && sec !== 'advanced' && sectionAvailable(sec)) {
      setSection(sec)
      setView(vw && viewsFor(sec).indexOf(vw) >= 0 ? vw : 'overview')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityCatalogLoading])
  // Guard: if the active section isn't actually available for this dataset
  // (e.g. a restored 'entities' but the catalog came back empty), fall back to
  // the default section. Waits for the async entity catalog so it doesn't fire
  // mid-load.
  useEffect(function() {
    if (entityCatalogLoading) return
    if (!sectionAvailable(section)) { setSection('themes'); setView('overview') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityCatalogLoading, section, entityCatalogRows.length])
  // Back/forward: re-sync nav state from the URL (shallow history, no reload).
  useEffect(function() {
    function onPop() {
      const sp = new URLSearchParams(window.location.search)
      const sec = (sp.get('section') as Section) || 'themes'
      const vw = (sp.get('view') as LensView) || 'overview'
      if (sec !== 'advanced' && sectionAvailable(sec)) {
        setSection(sec)
        setView(viewsFor(sec).indexOf(vw) >= 0 ? vw : 'overview')
      }
    }
    window.addEventListener('popstate', onPop)
    return function() { window.removeEventListener('popstate', onPop) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensionsEnabled, entityCatalogRows.length, datasetSource, outletCount, outletReportingEnabled])

  // Listen for Ana theme mutations and refetch theme model
  useEffect(function() {
    function handleAnaThemes() {
      fetch('/api/datasets/' + datasetId + '/state')
        .then(function(r) { return r.json() })
        .then(function(state) {
          if (state?.theme_model) {
            // Per-field sets: reseed the map from the stored blob, then show
            // the refreshed set for whichever selection is on screen (keyless
            // legacy blobs keep the old show-the-whole-blob behavior).
            var blob = state.theme_model as ThemeModel
            var entries = themeFieldEntries(blob)
            setFieldModels(function(prevMap) { return { ...prevMap, ...entries } })
            setThemes(function(prev) {
              var prevK = prev ? themeModelKey(prev) : ''
              if (prevK && entries[prevK]) return entries[prevK]
              if (prev && !prevK) return blob
              return prev
            })
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
  // First-open multi-field setup: which questions the user checked for the
  // mine-them-all pass (null = default all), and the live progress line.
  const [setupChecked, setSetupChecked] = useState<string[] | null>(null)
  const [multiMineStatus, setMultiMineStatus] = useState<string | null>(null)
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
  // Google-reviews rows carry per-review noise fields that are categorical by
  // type but worthless as a breakdown axis — `author` (one reviewer ≈ a handful
  // of reviews, so every group is n≈4), the row/place identifiers, the free-text
  // owner response, and the full street address. Drop them from the breakdown
  // options so Compare/Breakdown only offer fields that actually segment the
  // data (rating, outlet, city, state). Scoped to google_reviews per the data
  // shape; other dataset types keep every categorical field.
  var GREVIEW_NOISE_FIELDS = ['author', 'review_id', 'place_id', 'owner_response', 'location_address']
  var catFields = augmentedFields
    .filter(function(f) { return f.type === 'categorical' && f.status !== 'ignored' })
    .map(function(f) { return f.field })
    .filter(function(f) { return datasetSource !== 'google_reviews' || GREVIEW_NOISE_FIELDS.indexOf(f) === -1 })

  // Issue 7: Always use alias (label) if available
  function fieldLabel(fieldName: string): string {
    var f = augmentedFields.find(function(s) { return s.field === fieldName })
    return (f && f.label && f.label !== f.field) ? f.label : fieldName
  }

  // Effective fields for analysis — multi-field support
  var effectiveFields = useMemo(function() {
    return activeFields.length > 0 ? activeFields : (activeField ? [activeField] : [])
  }, [activeFields, activeField])

  // Ana's set_view handoff: adopt the requested text column. The event covers
  // TextMine already being open; the sessionStorage key covers navigation
  // (chip approved elsewhere → TextMine mounts after the event fired).
  useEffect(function() {
    function adoptField(k: string | undefined) {
      if (!k) return
      if (!openFields.some(function(o) { return o.field === k })) return
      setActiveFields([k])
      setActiveField(k)
    }
    try {
      var pending = sessionStorage.getItem('anaTextField:' + datasetId)
      if (pending) {
        sessionStorage.removeItem('anaTextField:' + datasetId)
        adoptField(pending)
      }
    } catch { /* sessionStorage unavailable */ }
    function onAnaSetField(e: Event) { adoptField((e as CustomEvent<{ fieldKey?: string }>).detail?.fieldKey) }
    window.addEventListener('ana-set-text-field', onAnaSetField)
    return function() { window.removeEventListener('ana-set-text-field', onAnaSetField) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- openFields identity churns per render; keying on its length keeps the listener stable while still validating against current fields
  }, [datasetId, openFields.length])

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

  // Extracted from the dependency array below: a call expression inline in deps
  // is re-evaluated on every render and eslint cannot verify it, so it hides
  // whether the effect's real inputs changed.
  var activeFieldsKey = activeFields.join(',')

  // Auto-switch away from empty fields once rows load
  useEffect(function() {
    if (!rowsLoaded || !rows.length || !activeFields.length || openFields.length === 0) return
    // A column the payload does not CARRY is unknown, not empty. The rows API
    // drops ignore'd columns (sql/186), so a field re-enabled in the schema is
    // absent from any rows fetched before that change — and reading absent as
    // "no content" used to bounce the user's explicit selection back to the
    // first open field. DatasetShell now remounts RowsProvider on a schema
    // change so this shouldn't arise; this guard means a stale payload can never
    // override a deliberate choice regardless.
    var payloadCarries = activeFields.every(function(f) {
      return rows.some(function(r) { return Object.prototype.hasOwnProperty.call(r, f) })
    })
    if (!payloadCarries) return
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
  }, [rowsLoaded, rows.length, activeFieldsKey])

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

  // Load industry themes on mount — cached across module remounts (the
  // payload is a static library, identical on every tab bounce).
  useEffect(function() {
    setIndustryLoading(true)
    cachedRequest('industry-themes', function() {
      return fetch('/api/industry-themes').then(function(r) {
        if (!r.ok) throw new Error('Failed to load industry themes')
        return r.json()
      })
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
  // ── When the bulk row fetch is allowed to start (2026-08-15) ──────────────
  // It used to fire on mount, concurrently with the server theme counts. Both
  // hit the same database instance and they CONTEND: the counts scan is 13.4s
  // in isolation but measured 24s running alongside the 50K-row fetch, which
  // pushed cold time-to-cards to 26.1s — worse than the 20.4s it replaced.
  // Concurrency on this instance has lost every time it has been measured (10
  // parallel sample pages made every page hit the statement timeout).
  //
  // So the rows now WAIT for the counts phase. Counts alone paints the cards,
  // then the rows load and unlock Clouds / Compare / Comments. The trade is
  // deliberate: cards much sooner, those three tabs somewhat later.
  const rowsRequested = useRef(false)
  // triggerRowFetch's identity changes with rowsLoaded/rowsLoading, and
  // fetchServerThemeCounts must not be rebuilt on that — hold the latest in a
  // ref so the one-shot below always calls a current copy.
  const triggerRowFetchRef = useRef(triggerRowFetch)
  triggerRowFetchRef.current = triggerRowFetch
  const startRowFetch = useCallback(function() {
    if (rowsRequested.current) return
    rowsRequested.current = true
    triggerRowFetchRef.current()
  }, [])

  const fetchServerThemeCounts = useCallback(async function(themeModel: ThemeModel, fields: string[]) {
    if (!themeModel?.themes?.length || !fields.length) return
    // Reset loaded flag so the theme card's "Co-occurs with themes" section
    // re-enters its placeholder state until this fetch returns. Otherwise a
    // theme-model edit would briefly show stale chips during the refetch.
    setExtrasLoaded(false)
    // Counts on screen right now came from the saved model (or the client
    // recount) and this request may replace them. Say so, so a number that is
    // about to move doesn't read as final — on a cold cache this scan is a
    // multi-second server job and the difference is visible.
    setCountsPending(true)
    // Two-phase (2026-08-15). The cards need `counts` + `totalNonEmpty`; the
    // co-occurrence and Dimensions chip rows have their own skeletons and are
    // NOT needed to paint. Cold, the counts scan is ~13s and the extras add
    // ~18s more, so one bundled request made the cards wait on data they don't
    // use. Phase 1 asks for counts alone; phase 2 fetches the extras and fills
    // the chips in. Sequential, not concurrent — the two scans contend on the
    // same instance, and concurrency there was measured to make things worse,
    // not better.
    const themePayload = themeModel.themes.map(function(t) { return { id: t.id, keywords: t.keywords } })
    // topical: false — extract_theme_topical_words SQL times out on large
    // collections with the ±2 window; the no-window version surfaces too much
    // boilerplate. Section dropped from the card.
    const countsBody = JSON.stringify({ themes: themePayload, fields: fields, cooccurrence: false, dimensions: false })
    const extrasBody = JSON.stringify({ themes: themePayload, fields: fields, cooccurrence: true, dimensions: dimensionsEnabled, extrasOnly: true })
    // Cached across module remounts (tab bounces) — the server recomputes
    // per-theme SQL scans on every request, and the body captures every
    // input so a theme/field change is a different key.
    function post(body: string) {
      return cachedRequest('theme-counts:' + datasetId + ':' + body, async function() {
        const res = await fetch('/api/datasets/' + datasetId + '/theme-counts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
        })
        if (!res.ok) throw new Error('theme-counts ' + res.status)
        return res.json()
      })
    }
    // Phase 2 runs even if phase 1 threw — the chips are independent of the
    // counts, and failing both because one failed helps nobody.
    async function loadExtras() {
      try {
        const ex = await post(extrasBody)
        if (ex.cooccurrence) setServerCoOccurrence(ex.cooccurrence)
        if (ex.dimensions) setServerThemeDimensions(ex.dimensions)
      } catch { /* chips stay in their placeholder state */ }
      finally { setExtrasLoaded(true) }
    }
    try {
      const data = await post(countsBody)
      if (!data.counts) return
      const countMap: Record<string, { count: number; percentage: number }> = {}
      for (const c of data.counts) countMap[c.id] = { count: c.count, percentage: c.percentage }
      // Above the 50K cap the server counts over the deterministic sample and
      // scales (sql/162) — surface the real coverage ("50,000 of 785,638
      // responses sampled") instead of implying exact full-dataset counts.
      var si = data.sampled
        ? { sampled: data.sampleSize || 0, total: totalRows }
        : { sampled: data.totalNonEmpty || totalRows, total: data.totalNonEmpty || totalRows }
      setThemes(function(prev) {
        if (!prev) return prev
        return {
          ...prev,
          themes: prev.themes.map(function(t) {
            var sc = countMap[t.id]
            return sc ? { ...t, count: sc.count, percentage: sc.percentage } : t
          }),
          samplingInfo: si,
        }
      })
      setSamplingInfo(si)
      if (typeof data.totalNonEmpty === 'number') setServerTotalResp(data.totalNonEmpty)
    } catch { /* fallback to client-side counts silently */ }
    // `finally`, not the end of the try: there is an early return above when
    // the response carries no counts, and a failed scan must clear the marker
    // too — otherwise the cards would say "calculating" forever. The counts are
    // final at this point, so the marker clears here rather than after phase 2.
    finally {
      setCountsPending(false)
      // Counts are done with the database — let the bulk row fetch go. Before
      // loadExtras() so the rows aren't queued behind the extras scan too.
      startRowFetch()
      void loadExtras()
    }
  }, [datasetId, totalRows, dimensionsEnabled, startRowFetch])


  // When rows load from shared context, update sampling info.
  useEffect(function() {
    if (!rowsLoaded || !rows.length) return
    if (rowsSampled) {
      setSamplingInfo({ sampled: sampledCount, total: rowsTotalRows || totalRows })
    }
  }, [rowsLoaded])

  // Server-side theme counts — fired as soon as the active Text selection
  // settles, NOT after the row download (2026-08-14 progressive-load work).
  //
  // This used to hang off `rowsLoaded`, so the theme cards waited on a bulk
  // payload of up to 50,000 rows (tens of MB) before a request that needs
  // nothing from it: the saved theme model, the field list and the row total
  // are all server-rendered props available at mount. On a large dataset that
  // serialised two slow things that could have overlapped, and the whole tab
  // sat behind one spinner. Now they run concurrently and the cards paint from
  // the server counts while the rows are still streaming in behind them.
  //
  // The gate is the field SELECTION settling (one tick after mount), not the
  // rows: firing before it settles would send a request for the wrong field on
  // a restored session that opens on a different Text pill. `openFields` empty
  // means the selection can never settle, so don't wait for it.
  const serverCountsFor = useRef('')
  useEffect(function() {
    // Every terminal bail-out below has to release the row fetch, or a dataset
    // that will never issue a counts request (no themes mined yet, a Text pill
    // with no saved set) would sit waiting for a phase that never runs and load
    // no rows at all. The ONE case that must NOT release is the selection not
    // having settled yet — that is transient and the effect re-runs a tick later.
    if (!savedThemeModel || !savedThemeModel.themes) { startRowFetch(); return }
    if (effectiveFields.length === 0 && openFields.length > 0) return  // selection not settled yet — transient, do NOT release
    // Only when the saved model belongs to the active Text selection (a
    // restored session may open on a different field; the per-field swap effect
    // below handles that field's own set instead, and enriching a non-active
    // model would clobber the swapped-in themes).
    const field = savedThemeModel.fieldNames || savedThemeModel.fieldName
    const fields = Array.isArray(field) ? field : (field ? [field] : [])
    if (fields.length === 0) { startRowFetch(); return }
    const activeKey = themeFieldKey(effectiveFields)
    if (activeKey && activeKey !== themeModelKey(savedThemeModel)) { startRowFetch(); return }
    // Fire once per (dataset, field set) — the effect now re-runs on selection
    // changes, and these are multi-second server scans.
    const token = datasetId + JSON.stringify(fields)
    if (serverCountsFor.current === token) return
    serverCountsFor.current = token
    void fetchServerThemeCounts(savedThemeModel, fields)
    void enrichSearchInterest(savedThemeModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchServerThemeCounts/enrichSearchInterest are stable per (datasetId, totalRows, dimensionsEnabled); adding them re-fires the scan on unrelated renders, and the token ref already dedupes.
  }, [datasetId, savedThemeModel, effectiveFields.join(','), openFields.length])

  // Per-field theme sets: when the Text selection changes, show that
  // selection's own stored set — stash the current one first so nothing is
  // lost, then swap (or clear, prompting a fresh mine for a never-mined
  // field). Models with no field binding (legacy blobs) stay shown as-is.
  useEffect(function() {
    var k = themeFieldKey(effectiveFields)
    // Tell the metric strip which question is active FIRST — before any of the
    // swap-logic early returns below. If it fired only at the end, transitions
    // that bail (no field key, a themes model with no binding, or the target set
    // already shown) would leave the strip stuck on the PREVIOUS question's
    // counts (e.g. Liked Most's numbers while Liked Least is selected). Pure
    // event emit, no setState → no render-loop risk.
    try { window.dispatchEvent(new CustomEvent('dataset-active-field-changed', { detail: { fieldKey: k || '' } })) } catch { /* SSR-safe */ }
    if (!k) return
    var currentK = themes ? themeModelKey(themes) : ''
    if (themes && !currentK) return
    if (currentK === k) return
    var nextMap = fieldModels
    if (themes && themes.themes && themes.themes.length > 0 && currentK) {
      nextMap = { ...fieldModels }
      nextMap[currentK] = stripFieldEntries(themes)
      setFieldModels(nextMap)
    }
    var next = nextMap[k] || null
    setThemes(next)
    setThemeSource(next ? (next.themeSource || null) : null)
    setThemeLibName(next ? (next.themeLibName || null) : null)
    setSamplingInfo(next && next.samplingInfo ? next.samplingInfo : null)
    if (next) {
      void fetchServerThemeCounts(next, effectiveFields)
      void enrichSearchInterest(next)
    }
    // (strip-follow event is dispatched at the TOP of this effect, before the
    // early returns, so it can't be skipped on a bail-out transition)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveFields.join('\u001F')])

  // ── Unified Comments filter ────────────────────────────────────────────────
  // serverMode: any entity or dimension facet selected → results come from the
  // combined /comments endpoint (themes alone keep the rich client CommentsPanel).
  const commentsServerMode = filterEntities.length > 0 || filterDims.length > 0

  // Dimension facet options (axes + their subs), fetched once when the Comments
  // tab is open on a Dimensions-enabled dataset.
  useEffect(function() {
    if (subTab !== 'comments' || !dimensionsEnabled || dimFacetsLoaded) return
    setDimFacetsLoaded(true)
    // Same repeated-fields query TaxonomyModule sends — without it the route
    // resolves a default field this dataset's rollup isn't keyed by and
    // returns ZERO axes, so the dimension facet picker (and the active-filter
    // chips) silently never rendered (found 2026-09-02).
    var facetFieldQs = effectiveFields.length ? '?' + effectiveFields.map(function(f) { return 'fields=' + encodeURIComponent(f) }).join('&') : ''
    fetch('/api/datasets/' + datasetId + '/taxonomy' + facetFieldQs)
      .then(function(r) { return r.ok ? r.json() : null })
      .then(function(d) {
        if (!d) return
        var axes = (d.axes || []) as { axis: string; label: string }[]
        var subs = (d.subs || []) as { axis: string; sub: string; count: number }[]
        var byAxis: Record<string, { sub: string; count: number }[]> = {}
        subs.forEach(function(s) { (byAxis[s.axis] = byAxis[s.axis] || []).push({ sub: s.sub, count: s.count }) })
        setDimFacets(axes.filter(function(a) { return (byAxis[a.axis] || []).length > 0 }).map(function(a) {
          return { axis: a.axis, label: a.label, subs: byAxis[a.axis] || [] }
        }))
      })
      .catch(function() { /* facets stay empty — picker just won't show */ })
  }, [subTab, dimensionsEnabled, dimFacetsLoaded, datasetId, effectiveFields])

  // Fetch combined-filter results (debounced) whenever the active facets change.
  useEffect(function() {
    if (subTab !== 'comments' || !commentsServerMode) return
    var cancelled = false
    var handle = setTimeout(function() {
      setFilterLoading(true); setFilterError('')
      fetch('/api/datasets/' + datasetId + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: effectiveFields,
          themes: selectedThemes.map(function(t) { return { keywords: t.keywords } }),
          entities: filterEntities.map(function(e) { return { canonical: e.canonical, aliases: e.aliases } }),
          dimensions: filterDims,
          limit: 300,
        }),
      })
        .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('Failed to filter comments')) })
        .then(function(d) { if (!cancelled) { setFilterRows(d.rows || []); setFilterTotal(d.total || 0) } })
        .catch(function(err) { if (!cancelled) setFilterError(err?.message || 'Failed to filter comments') })
        .finally(function() { if (!cancelled) setFilterLoading(false) })
    }, 250)
    return function() { cancelled = true; clearTimeout(handle) }
  }, [subTab, commentsServerMode, datasetId, effectiveFields, selectedThemes, filterEntities, filterDims])

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
  // Depend on the two PRIMITIVES rather than the cutoffs object: `signalCutoffs`
  // is exactly { mainstream, noise }, so this is both complete and stricter than
  // depending on the object, which would rebuild on any new identity carrying the
  // same two numbers. Rebuilt inside the memo so the deps are exactly its inputs.
  var cutMainstream = signalCutoffs.mainstream
  var cutNoise = signalCutoffs.noise
  var filteredRows: Record<string, unknown>[] = useMemo(function(): Record<string, unknown>[] {
    return injectSignalTier(_filteredBase, datasetSource || '', { mainstream: cutMainstream, noise: cutNoise })
  }, [_filteredBase, datasetSource, cutMainstream, cutNoise])

  // When the opinion modal is scoped to a theme, it must READ that theme's rows —
  // not the whole dataset. Otherwise the mention count (numerator) is drawn from
  // one population and the theme's comment count (denominator) from another, and
  // the ratio is meaningless: "server" showed 950 dataset-wide mentions over the
  // theme's 2,231 comments = 43%, while the cloud counted 896 mentions IN the
  // theme = 40%. Same matcher as the theme's own count (`commentMatchesTheme`),
  // so the two reconcile by construction.
  const opinionTheme = useMemo(function() {
    if (!opinionThemeId) return null
    return ((displayThemes || themes)?.themes || []).find(function(x) { return x.id === opinionThemeId }) || null
  }, [opinionThemeId, displayThemes, themes])

  const opinionThemeRows = useMemo(function() {
    if (!opinionTheme) return null
    return filteredRows.filter(function(r) {
      return commentMatchesTheme(getRowText(r, effectiveFields), opinionTheme)
    })
  }, [opinionTheme, filteredRows, effectiveFields])

  // The scope both popovers pass down. `theme.count` is the denominator the theme
  // card prints as "N comments"; pairing it with rows filtered by the SAME
  // matcher keeps numerator and denominator in one population.
  const opinionThemeScope = opinionTheme && opinionTheme.count
    ? { label: opinionTheme.name, count: opinionTheme.count as number }
    : undefined


  // Recount theme hits against filtered data — deferred to let UI paint loading state
  var _recountFields = effectiveFields.length > 0 ? effectiveFields
    : (themes?.fieldNames || (themes?.fieldName ? [themes.fieldName] : []))
  // Extracted from the dependency array below — same reason as activeFieldsKey:
  // an inline call expression in deps can't be verified by the rule.
  var _recountFieldsKey = _recountFields.join(',')
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
  }, [themes, filteredRows.length, _recountFieldsKey, activeFilterCount, ratingField])

  // Stats for active fields (on filtered data)
  var activeFieldRows = useMemo(function() {
    return filteredRows.filter(function(r) {
      return effectiveFields.some(function(f) { return String(r[f] || '').trim().length > 0 })
    })
  }, [filteredRows, effectiveFields])
  var activeFieldCount = activeFieldRows.length

  // ── Per-entity average rating (row-enrichment) ──────────────────────────
  // EntitiesCard shows mention counts (scope-wide, computed by the SQL entity
  // catalog). Ratings have no server source, so we derive them client-side:
  // match each entity's terms (canonical + aliases + plural variants) against
  // the active text fields, and average the rating of every row that mentions
  // it. Filter-aware like the theme recount; `n` is surfaced so small-sample
  // badges stay honest. Same matcher family as EntityCloud's sentiment scan,
  // but row-level (a star rating is a row attribute, not a clause attribute).
  var entityRatings = useMemo(function(): { byEntity: Record<string, { avg: number; n: number }>; overall: number | null } {
    var byEntity: Record<string, { avg: number; n: number }> = {}
    if (!ratingField || entityCatalogRows.length === 0 || filteredRows.length === 0 || effectiveFields.length === 0) {
      return { byEntity: byEntity, overall: null }
    }
    function escapeRE(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
    var termToSlugs: Record<string, string[]> = {}
    entityCatalogRows.forEach(function(e) {
      expandEntityTerms([e.canonical].concat(e.aliases || [])).forEach(function(t) {
        var key = t.toLowerCase()
        if (!termToSlugs[key]) termToSlugs[key] = []
        if (termToSlugs[key].indexOf(e.slug) === -1) termToSlugs[key].push(e.slug)
      })
    })
    var allTerms = Object.keys(termToSlugs).sort(function(a, b) { return b.length - a.length })
    if (allTerms.length === 0) return { byEntity: byEntity, overall: null }
    var re = new RegExp('\\b(' + allTerms.map(escapeRE).join('|') + ')\\b', 'gi')
    var sums: Record<string, number> = {}, counts: Record<string, number> = {}
    var oSum = 0, oN = 0
    filteredRows.forEach(function(row) {
      var rv = parseFloat(String(row[ratingField as string] ?? ''))
      if (isNaN(rv)) return
      oSum += rv; oN++
      var text = getRowText(row, effectiveFields).toLowerCase()
      if (!text) return
      re.lastIndex = 0
      var slugs = new Set<string>()
      var m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        (termToSlugs[m[0].toLowerCase()] || []).forEach(function(s) { slugs.add(s) })
      }
      slugs.forEach(function(s) { sums[s] = (sums[s] || 0) + rv; counts[s] = (counts[s] || 0) + 1 })
    })
    Object.keys(counts).forEach(function(s) {
      byEntity[s] = { avg: Math.round(sums[s] / counts[s] * 100) / 100, n: counts[s] }
    })
    return { byEntity: byEntity, overall: oN > 0 ? Math.round(oSum / oN * 100) / 100 : null }
  }, [entityCatalogRows, filteredRows, effectiveFields, ratingField])

  // Theme × entity cross-tab for the theme cards' "Items mentioned" row (shared
  // with the Theme Clouds via lib/themeEntities). Keyed by theme key.
  var themeCardEntities = useMemo(function() {
    var ths = (displayThemes || themes)?.themes || []
    return computeThemeEntities(ths, filteredRows, effectiveFields, entityCatalogRows)
  }, [displayThemes, themes, filteredRows, effectiveFields, entityCatalogRows])

  // Prepare the mining corpus (combines all active fields). Returns the FULL
  // substantive corpus plus aligned rating values and the per-run sample size
  // n — sampling itself happens in mineWithConsensus (stratified disjoint
  // draws, or a single evenSample fallback).
  function prepareCorpus() {
    if (!effectiveFields.length || !filteredRows.length) return { texts: [] as string[], ratings: [] as (string | number | null | undefined)[], total: 0, n: 0 }
    // Mine themes from SUBSTANTIVE feedback only. "Nothing" / "N/A" / "all
    // good" answers carry no theme signal, and feeding them in diluted BOTH
    // the AI's discovery sample and the sample-fit denominator (owner
    // 2026-07-14: a Liked-Least field read "Diffuse 30%" when 45% of its
    // answers were non-substantive; over real feedback the same themes cover
    // ~48%). isSubstantiveText (≥5 words, or ≥4 with a function word) subsumes
    // the old length>0 check, so blanks are still excluded.
    var texts: string[] = []
    var ratings: (string | number | null | undefined)[] = []
    filteredRows.forEach(function(r) {
      var t = effectiveFields.map(function(f) { return String(r[f] || '') }).join(' ').trim()
      if (!isSubstantiveText(t)) return
      texts.push(t)
      ratings.push(ratingField ? (r[ratingField] as string | number | null | undefined) : null)
    })
    const total = texts.length
    const defaultN = sampleSize95(total)
    const defaultPct = total > 0 ? Math.round(defaultN / total * 100) : 100
    const activePct = samplePct === 0 ? defaultPct : samplePct
    const n = Math.max(1, Math.round(total * (activePct / 100)))
    return { texts, ratings, total, n }
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

        var membersWithThemes = (colData.members as { label: string; has_themes: boolean; theme_model: ThemeModel }[])
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
        setFieldModels(function(prev) { return { ...prev, [themeModelKey(tm)]: stripFieldEntries(tm) } })
        setThemeSource('ai')
        setThemeLibName(null)
        setSamplingInfo({ sampled: filteredRows.length, total: filteredRows.length })
        setLastRunPct(samplePct)
        setSection('themes'); setView('overview')
        void persistThemeModel(tm)
        void fetchServerThemeCounts(tm, effectiveFields)
        void enrichSearchInterest(tm)
      } else {
        // ── Standard: consensus mine from the stratified corpus ──────
        var corpus = prepareCorpus()
        if (!corpus.texts.length) throw new Error('No text found in selected fields.')
        var mined = await mineWithConsensus({
          datasetId: datasetId, apiKey: liveKey, fieldName: effectiveFields[0], schemaCtx: schemaCtx,
          texts: corpus.texts, ratings: corpus.ratings, n: corpus.n,
        })
        var tm2: ThemeModel = {
          themes: mined.themes as Theme[],
          summary: mined.summary || '',
          fieldName: effectiveFields[0],
          fieldNames: effectiveFields,
          themeSource: 'ai',
          themeLibName: null,
          samplingInfo: { sampled: mined.sampledCount, total: corpus.total },
          consensus: mined.consensus || undefined,
        }
        setThemes(tm2)
        setFieldModels(function(prev) { return { ...prev, [themeModelKey(tm2)]: stripFieldEntries(tm2) } })
        setThemeSource('ai')
        setThemeLibName(null)
        setSamplingInfo({ sampled: mined.sampledCount, total: corpus.total })
        setLastRunPct(samplePct)
        setSection('themes'); setView('overview')
        void persistThemeModel(tm2)
        void fetchServerThemeCounts(tm2, effectiveFields)
        void enrichSearchInterest(tm2)
        // Smart Dimensions: the AI flagged this as restaurant/food-service data →
        // enable + classify Dimensions automatically (the route also set the flag).
        // Not food-service → the route suppressed the restaurant taxonomy; run the
        // universal emotion tier instead (classifies emotion-only, reveals the
        // Dimensions section only if emotion language fired, and refreshes — which
        // also hides the irrelevant restaurant tab on an otherwise-proxied
        // google_reviews dataset).
        if (mined.foodService === true) void autoEnableDimensions(effectiveFields)
        else if (mined.foodService === false) void autoTagEmotion(effectiveFields)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Mining failed')
    }
    setLoading(false)
  }

  // First-open setup: mine each selected question SEQUENTIALLY into its own
  // per-field set, persisting after every field (the state route merges, so
  // a failure partway keeps everything already mined). Lands on the first
  // mined question. Corpus comes straight from `rows` — setup runs before
  // any filtering matters — with the same 95%-CI sampling as a single mine.
  async function mineFieldsSequentially(fieldsToMine: string[]) {
    var liveAi = false; try { liveAi = localStorage.getItem('sentimetrx_ai_enabled') === '1' } catch {}
    if (!liveAi) { setAiEnabled(false); setError('AI is turned off. Enable AI in the header to mine themes.'); return }
    var liveKey = ''; try { liveKey = localStorage.getItem('sentimetrx_tm_apikey') || '' } catch {}
    if (liveKey) setApiKey(liveKey)
    if (!fieldsToMine.length || !rows.length) return
    setLoading(true)
    setError(null)
    var schemaCtx = schema.fields.map(function(f) {
      return f.field + ':' + f.type + (f.type === 'categorical' && f.values ? ' (' + f.values.slice(0, 6).join(',') + ')' : '')
    }).join('; ')
    var newModels: Record<string, ThemeModel> = {}
    var firstFoodService: boolean | null = null
    try {
      for (var i = 0; i < fieldsToMine.length; i++) {
        var f = fieldsToMine[i]
        setMultiMineStatus('Mining “' + fieldLabel(f) + '” — ' + (i + 1) + ' of ' + fieldsToMine.length)
        var texts: string[] = []
        var fieldRatings: (string | number | null | undefined)[] = []
        rows.forEach(function(r) {
          var t = String(r[f] || '').trim()
          if (!t.length) return
          texts.push(t)
          fieldRatings.push(ratingField ? (r[ratingField] as string | number | null | undefined) : null)
        })
        if (!texts.length) continue
        var total = texts.length
        var mined
        try {
          mined = await mineWithConsensus({
            datasetId: datasetId, apiKey: liveKey, fieldName: f, schemaCtx: schemaCtx,
            texts: texts, ratings: fieldRatings, n: Math.max(1, sampleSize95(total)),
          })
        } catch (e) {
          if (e instanceof Error && (e.message === 'AUTH_ERROR' || e.message === 'QUOTA_ERROR')) throw e
          throw new Error(e instanceof Error && e.message ? e.message : 'No themes returned for ' + fieldLabel(f))
        }
        var tm: ThemeModel = {
          themes: mined.themes as Theme[],
          summary: mined.summary || '',
          fieldName: f,
          fieldNames: [f],
          themeSource: 'ai',
          themeLibName: null,
          samplingInfo: { sampled: mined.sampledCount, total: total },
          consensus: mined.consensus || undefined,
        }
        newModels[themeFieldKey([f])] = tm
        // Persist as we go — each PATCH merges into the stored per-field map.
        await fetch('/api/datasets/' + datasetId + '/state', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme_model: tm }),
        })
        if (firstFoodService === null && typeof mined.foodService === 'boolean') firstFoodService = mined.foodService
      }
      var minedFields = fieldsToMine.filter(function(mf) { return !!newModels[themeFieldKey([mf])] })
      if (minedFields.length > 0) {
        setFieldModels(function(prev) { return { ...prev, ...newModels } })
        var firstField = minedFields[0]
        var first = newModels[themeFieldKey([firstField])]
        // Re-persist the LANDING field's model last so the stored top level
        // (what the metric strip / exports / listing default to) matches the
        // question on screen — the loop's final PATCH was the last field.
        if (minedFields.length > 1) {
          await fetch('/api/datasets/' + datasetId + '/state', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme_model: first }),
          })
        }
        setActiveFields([firstField])
        setActiveField(firstField)
        setThemes(first)
        setThemeSource('ai')
        setThemeLibName(null)
        setSamplingInfo(first.samplingInfo || null)
        setIsDirty(false)
        setSaved(true)
        setTimeout(function() { setSaved(false) }, 3000)
        setSection('themes'); setView('overview')
        void fetchServerThemeCounts(first, [firstField])
        void enrichSearchInterest(first)
        // Smart Dimensions: same auto-enable as a single mine, driven by the
        // first field's foodService verdict, classified once.
        if (firstFoodService === true) void autoEnableDimensions([firstField])
        else if (firstFoodService === false) void autoTagEmotion([firstField])
        // Wake the metric strip (comments · signals · theme fit) — it mounted
        // before any themes existed on a fresh upload.
        try { window.dispatchEvent(new Event('dataset-themes-saved')) } catch { /* SSR-safe */ }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Mining failed')
    }
    setMultiMineStatus(null)
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
    setFieldModels(function(prev) { return { ...prev, [themeModelKey(tm)]: stripFieldEntries(tm) } })
    setThemeSource(source)
    setThemeLibName(libName)
    setSamplingInfo({ sampled: total, total })
    // Smart Dimensions: applying a restaurant theme library (casual/fine dining,
    // fast food) is a strong restaurant signal → enable + classify Dimensions.
    if (RESTAURANT_INDUSTRIES.some(function (r) { return libName.indexOf(r) !== -1 })) {
      void autoEnableDimensions(effectiveFields)
    }
    // Fetch accurate server-side counts on full dataset
    void fetchServerThemeCounts(tm, effectiveFields)
    // Enrich with Google search interest (Reddit/Substack only)
    void enrichSearchInterest(tm)
    setLastRunPct(null)
    setShowThemeEditor(false)
    setSection('themes'); setView('overview')
    // Auto-save immediately so the user doesn't need a separate Save press
    void persistThemeModel(tm)
  }

  // Save payload: the active model at the top level plus every per-field set
  // mined this session (the state route re-merges with what's stored, so a
  // save from one field never clobbers another's persisted set).
  function themeSaveBlob(tm: ThemeModel): ThemeModel {
    var k = themeModelKey(tm)
    var entries: Record<string, ThemeModel> = { ...fieldModels }
    if (k) entries[k] = stripFieldEntries(tm)
    return Object.keys(entries).length > 0 ? { ...stripFieldEntries(tm), fields: entries } : stripFieldEntries(tm)
  }

  // Persist a model now. AI mining costs a real API call — a freshly mined
  // set must never depend on the user remembering to press Save (2026-07-11:
  // a mined Liked-Least set evaporated exactly that way).
  async function persistThemeModel(tm: ThemeModel) {
    setSaving(true)
    try {
      await fetch('/api/datasets/' + datasetId + '/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme_model: themeSaveBlob(tm) }),
      })
      setSaved(true)
      setIsDirty(false)
      setTimeout(function() { setSaved(false) }, 3000)
      // Tell the metric strip (comments · signals · theme fit) to re-fetch —
      // on a fresh upload it mounted before any themes existed. Distinct from
      // 'ana-themes-changed', which THIS component listens to (self-loop).
      try { window.dispatchEvent(new Event('dataset-themes-saved')) } catch { /* SSR-safe */ }
    } catch { setIsDirty(true) }
    setSaving(false)
  }

  async function saveThemeModel() {
    if (!themes) return
    await persistThemeModel(themes)
  }

  // Navigate the two-row bar: section/view ARE the state now (renderers read the
  // derived subTab/viewBy). Clears the comment facets when leaving Comments and
  // remembers the prior view so the in-Comments back button returns there.
  // Reflected into the URL via a shallow history push (shareable + back/forward,
  // no server round-trip).
  function navTo(nextSection: Section, nextView: LensView) {
    if (nextView === 'comments') setPreviousView(view)
    else { setFilterEntities([]); setFilterDims([]); setDrillTheme(null); setDrillGroup(null); setSelectedThemes([]) }
    setSection(nextSection)
    setView(nextView)
    try {
      const sp = new URLSearchParams(window.location.search)
      sp.set('section', nextSection); sp.set('view', nextView)
      window.history.pushState({}, '', window.location.pathname + '?' + sp.toString())
    } catch (_e) { /* SSR / no history — nav state still updates */ }
  }
  // Section click: keep the current view if the target section offers it, else
  // fall back to Overview. The Comments view is the exception — it renders the
  // same comment list across every lens (it only differs once you pick an entity/
  // dimension), so preserving it makes switching INTO a section read as "nothing
  // happened" (e.g. on Comments, clicking Entities). Land on the section's
  // Overview instead — its home, where the lens's own content (the entity cloud /
  // list, the dimensions grid) actually lives.
  function selectSection(nextSection: Section) {
    if (nextSection === 'advanced') return   // Advanced is a link, never routed here
    let v: LensView = viewsFor(nextSection).indexOf(view) >= 0 ? view : 'overview'
    if (v === 'comments') v = 'overview'
    navTo(nextSection, v)
  }

  // Drills jump to Comments within the CURRENT section (lens), remembering the
  // view to return to. They don't rewrite the URL — the nav highlight stays
  // correct since it reads section/view directly.
  function handleDrillTheme(t: Theme, group?: string) {
    setPreviousView(view)
    setDrillTheme(t)
    setSelectedThemes([t])
    setDrillGroup(group || null)
    setView('comments')
  }

  function handleBackFromComments() {
    setDrillTheme(null)
    setSelectedThemes([])
    setDrillGroup(null)
    setFilterEntities([]); setFilterDims([])
    setView(previousView)
  }

  // Clicking an entity (cloud / card / pill) adds it to the Comments entity
  // facet and opens the Comments tab — combinable with themes + dimensions.
  function handleDrillEntity(entity: { slug: string; canonical: string; category: string; aliases: string[] }) {
    setPreviousView(view)
    setFilterEntities(function(prev) { return prev.some(function(e) { return e.slug === entity.slug }) ? prev : prev.concat([entity]) })
    setView('comments')
  }

  // Clicking a Dimension chip (theme-card row / facet) adds it to the Comments
  // dimension facet and opens the Comments tab.
  function handleDrillDimension(axis: string, sub: string) {
    setPreviousView(view)
    setFilterDims(function(prev) { return prev.some(function(d) { return d.axis === axis && d.sub === sub }) ? prev : prev.concat([{ axis: axis, sub: sub }]) })
    setView('comments')
  }

  // Axis-level drill ("read everything on Service"): every sub of the axis as
  // OR'd dimension facets — the same population the Overview's axis drill
  // showed, now in the shared Comments view.
  function handleDrillAxis(axis: string, subs: string[]) {
    setPreviousView(view)
    setFilterDims(function(prev) {
      var next = prev.slice()
      subs.forEach(function(sub) {
        if (!next.some(function(d) { return d.axis === axis && d.sub === sub })) next.push({ axis: axis, sub: sub })
      })
      return next
    })
    setView('comments')
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
  // Progressive paint (2026-08-14): the Themes tab used to render nothing until
  // the whole 50K-row payload had downloaded. The server theme counts are an
  // authoritative, filter-free view of the same numbers and arrive on their own
  // schedule, so as soon as they're in we can paint the cards and let the rows
  // finish behind them. `serverTotalResp` is the denominator those counts are a
  // share of; without it every percentage would divide by a not-yet-loaded 0 —
  // "0 comments · Diffuse 0%" reads as a verdict on the data rather than a
  // loading state (the same trap the metric strip fell into on 2026-08-13).
  var themesPaintable = !!hasThemes && serverTotalResp != null && serverTotalResp > 0
  // Row 1 — peer sections. Themes is always present; Dimensions / Entities /
  // Advanced gate exactly as before (taxonomy capability, a non-empty entity
  // catalog, and google_reviews + ≥5 outlets respectively).
  // Row 1 — peer sections, derived from the shared availableSections() gate so
  // the bar and the reset-if-unavailable guard can never drift. Labels/help/href
  // come from this static map; Advanced is a link (it lives on its own pages).
  const SECTION_META: Record<Section, { label: string; help: string; href?: string }> = {
    themes: { label: 'Themes', help: 'AI-mined themes — clusters of comments that share a topic. Browse them, see the language people use, slice by segment, or read the underlying quotes.' },
    dimensions: { label: 'Dimensions', help: 'Every row classified into a fixed, consistent set of dimensions (service, food, drinks, ambiance, …) with severity alerts. Filter by dimension/sub-dimension and read the comments behind each.' },
    entities: { label: 'Entities', help: 'The specific things people name — dishes, drinks, brands, places — catalogued from the comments, with the quotes behind each.' },
    advanced: { label: 'Advanced Analytics', href: '/analyze/' + datasetId + '/improvement-plan', help: 'Brand-health diagnostics & per-outlet deep-dive for multi-location brands: the recommended-actions playbook, drivers & trends, the leaderboard, and each location\'s action plan with an interactive what-if modeler.' },
  }
  const navSections: { id: Section; label: string; help: string; href?: string }[] = availableSections(sectionGate).map(function(id) { return { id: id, ...SECTION_META[id] } })
  const activeSection = section
  const activeView = view
  const VIEW_LABEL: Record<LensView, string> = { overview: 'Overview', clouds: 'Clouds', compare: 'Compare', comments: 'Comments' }
  // Row 2 — the active section's views (uniform Overview·Clouds·Compare·Comments
  // across the lens sections). A view is locked (needs a theme model) when its
  // underlying subTab is clouds/compare/comments and no themes exist — matching
  // the previous per-tab lock.
  const navViews = activeSection === 'advanced' ? [] : viewsFor(activeSection).map(function(v) {
    const st = deriveLegacy(activeSection, v).subTab
    const locked = (st === 'clouds' || st === 'compare' || st === 'comments') && !hasThemes
    // Clouds / Compare / Comments tokenize and filter the loaded rows client-side,
    // so they cannot render until the bulk fetch lands — up to ~20s on a large
    // dataset. Since the Overview now paints early (2026-08-15 progressive load),
    // those tabs look ready when they aren't; clicking one drops you on a bare
    // loader with no explanation. Mark them while the rows are in flight.
    // `!rowsLoaded`, not `rowsLoading` — the fetch is now deferred until the
    // counts phase releases it, so there is a window where it hasn't STARTED
    // and rowsLoading is still false. Gating on "loading" left the pills live
    // during that window, which is exactly when a click would strand someone.
    // `!rowsError` so a failed fetch re-enables them instead of locking the
    // tabs forever — the Overview carries the retry.
    const pending = !locked && !rowsLoaded && !rowsError && (st === 'clouds' || st === 'compare' || st === 'comments')
    return { id: v, label: VIEW_LABEL[v], locked: locked, pending: pending }
  })
  // Cells without a real renderer yet (later-phase builds) show a graceful
  // placeholder instead of mis-rendering the section's Overview.
  const cellPending = !cellHasContent(activeSection, activeView)

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
      {/* Standalone text-field picker bar retired — the picker now rides the
          views-nav row via viewsExtra (see <TextMineNav> below) to reclaim a
          chrome row. Kept disabled rather than deleted to preserve the field-
          combine markup history alongside the live copy. */}
      {false && openFields.length > 1 && hasThemes && (
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
      {dimAutoNotice && (
        <div style={{ padding: '10px 20px', background: '#fff7ed', borderBottom: '1px solid #fdba74', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14 }}>{'\uD83C\uDF7D\uFE0F'}</span>
          <span style={{ fontSize: 12, color: '#9a3412', flex: 1 }}>{dimAutoNotice}</span>
        </div>
      )}
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

          {/* Two-row nav: peer sections (row 1) + lens views (row 2). The
              status + action pills float right on row 1 as children. */}
          <TextMineNav
            sections={navSections}
            activeSection={activeSection}
            views={navViews}
            activeView={activeView}
            onSelectSection={selectSection}
            onSelectView={function(v) { navTo(activeSection, v as LensView) }}
            viewsExtra={openFields.length > 1 && hasThemes ? (
              <>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em', display: 'inline-flex', alignItems: 'center' }}>
                  Text
                  <HelpHint title="Multiple text fields" placement="bottom">
                    Your dataset has more than one open-ended column (e.g. Liked Most + Liked Least). Each column keeps its own theme set — click a question to switch to its themes. A question without themes yet shows the mining prompt.
                  </HelpHint>
                </span>
                {openFields.map(function(f) {
                  var sel = activeFields.includes(f.field)
                  var hasSet = !!fieldModels[themeFieldKey([f.field])]
                  return (
                    // Exclusive switch (2026-07-11): a click SELECTS this question
                    // alone. The old checkbox toggle silently created a combined
                    // "a + b" corpus — the owner mined "Liked Least", got both
                    // verbatims concatenated, and the per-field set never landed.
                    <button key={f.field} onClick={function() {
                      setActiveFields([f.field])
                      setActiveField(f.field)
                    }}
                      title={hasSet || sel ? undefined : 'No themes yet — switch to mine this question'}
                      style={{ padding: '2px 9px', fontSize: 11, fontWeight: sel ? 700 : 500, background: sel ? T.accentBg : T.bgCard, border: '1px solid ' + (sel ? T.accent : T.border), color: sel ? T.accent : (hasSet ? T.textMid : T.textFaint), borderRadius: 16, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid ' + (sel ? T.accent : T.borderMid), background: sel ? T.accent : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'white', flexShrink: 0 }}>
                        {sel ? '✓' : ''}
                      </span>
                      {fieldLabel(f.field)}
                      {!hasSet && !sel && <span style={{ fontSize: 9, color: T.textFaint }}>+</span>}
                    </button>
                  )
                })}
              </>
            ) : undefined}
          >
              {rowsLoading && <span style={{ fontSize: 11, color: T.textMute, display: 'flex', alignItems: 'center', gap: 4 }}><LottieLoader size={14} /> Loading…{rowsProgressLabel ? ' ' + rowsProgressLabel : ''}</span>}
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
                <button onClick={function() { void mineThemes() }} disabled={!canMine || loading || !aiEnabled}
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
                <button onClick={function() { void saveThemeModel() }} disabled={saving}
                  style={{ padding: '4px 14px', fontSize: 11, fontWeight: 700, background: T.accent, color: 'white', border: 'none', borderRadius: 20, cursor: saving ? 'not-allowed' : 'pointer' }}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              )}
          </TextMineNav>

          {/* ─── Tab content ─────────────────────────────────────────── */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {/* ═══ THEMES TAB ═══ */}
            {subTab === 'themes' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }} className="fadein">

                {/* Loading spinner */}
                {loading && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingBottom: 80 }}>
                    <LottieLoader size={96} message="Analyzing your responses…" />
                    <div style={{ fontSize: 12, color: T.textMute, marginTop: 8 }}>{multiMineStatus || 'Ana is reading and grouping themes...'}</div>
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

                {/* Nothing to show yet. Once the server theme counts land
                    (`themesPaintable`) the cards below take over and this
                    full-page loader steps aside — the rows keep streaming behind
                    them under the slim banner instead.

                    ⭐ Gated on `!rowsLoaded`, NOT `rowsLoading`, to cover the
                    DEFERRED-START WINDOW — the same fix the nav tabs needed
                    (2026-08-16). `startRowFetch` is a one-shot that only fires
                    after the server counts request finishes (or a terminal
                    bail-out releases it), so between mount and that moment
                    `rowsLoading` is still false. Requiring it here meant NO
                    branch rendered and the content area sat BLANK for the whole
                    multi-second counts scan — which read as a broken page on
                    every first open, and looked fine on a revisit only because
                    rows were already loaded by then. Every bail-out releases the
                    fetch, so this always resolves. */}
                {!rowsLoaded && !rowsError && !themesPaintable && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, paddingTop: 60, paddingBottom: 60 }}>
                    <LottieLoader size={120} message={
                      rowsLoading
                        ? (rowsProgressLabel ? 'Loading dataset rows... ' + rowsProgressLabel : 'Loading dataset rows...')
                        : 'Counting themes across the dataset\u2026'
                    } />
                  </div>
                )}

                {/* Cards are up on server counts; rows are still arriving. Says
                    what is and isn't live yet, so nobody reads the numbers as
                    filtered when the filters haven't been applied to them. */}
                {!rowsLoaded && rowsLoading && !rowsError && themesPaintable && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 16, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
                    <LottieLoader size={16} />
                    <span>
                      Showing whole-dataset counts. Loading comments{rowsProgressLabel ? ' (' + rowsProgressLabel + ')' : ''} {'—'} filters, ratings and sample comments turn on when they finish.
                    </span>
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
                    {/* Multi-question setup (2026-07-11): pick which open-ended
                        questions get their own theme set, then mine them all in
                        one pass — each lands as its own per-field set. Questions
                        that ALREADY have a set start unchecked with a badge —
                        checking one is an explicit re-mine-and-replace (owner hit
                        this switching to an unmined field: both were checked and
                        Continue would have re-mined the mined one too). */}
                    {rows.length > 0 && openFields.length > 1 && !aiDisabledByOrg && (function() {
                      var checked = setupChecked ?? openFields.filter(function(f) { return !fieldModels[themeFieldKey([f.field])] }).map(function(f) { return f.field })
                      return (
                        <div style={{ maxWidth: 420, margin: '0 auto 18px', textAlign: 'left', background: 'white', border: '1px solid ' + T.border, borderRadius: 12, padding: '14px 16px' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                            Which questions should get themes?
                          </div>
                          {openFields.map(function(f) {
                            var on = checked.includes(f.field)
                            return (
                              <label key={f.field} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer', fontSize: 12.5, color: T.text }}>
                                <input type="checkbox" checked={on} style={{ accentColor: T.accent, width: 14, height: 14, flexShrink: 0 }}
                                  onChange={function() {
                                    var next = on ? checked.filter(function(x) { return x !== f.field }) : checked.concat([f.field])
                                    setSetupChecked(next)
                                  }} />
                                <span style={{ flex: 1, lineHeight: 1.35 }}>{fieldLabel(f.field)}</span>
                                {!!fieldModels[themeFieldKey([f.field])] && (
                                  <span title="This question already has a theme set — checking it re-mines and replaces that set."
                                    style={{ fontSize: 9.5, fontWeight: 700, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, padding: '1px 7px', flexShrink: 0 }}>
                                    ✓ has themes
                                  </span>
                                )}
                                {typeof f.nonNullCount === 'number' && (
                                  <span style={{ fontSize: 10.5, color: T.textFaint, flexShrink: 0 }}>{f.nonNullCount.toLocaleString()} answers</span>
                                )}
                              </label>
                            )
                          })}
                          <div style={{ fontSize: 10.5, color: T.textMute, marginTop: 8, lineHeight: 1.5 }}>
                            Each question gets its own theme set. If a column here isn’t really free-form text, un-check it — and set its type on the Schema tab so it stops appearing.
                          </div>
                        </div>
                      )
                    })()}
                    {rows.length > 0 && (
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                        {!aiDisabledByOrg && (function() {
                          var checked = setupChecked ?? openFields.filter(function(f) { return !fieldModels[themeFieldKey([f.field])] }).map(function(f) { return f.field })
                          var multi = openFields.length > 1
                          var canRun = canMine && aiEnabled && (!multi || checked.length > 0)
                          return (
                            <button onClick={function() { multi ? void mineFieldsSequentially(checked) : void mineThemes() }} disabled={!canRun}
                              title={!aiEnabled ? (apiKey ? 'Turn on AI in the header bar' : 'Add an API key via the AI button in the header') : (multi && checked.length === 0 ? 'Check at least one question' : '')}
                              style={{ padding: '10px 22px', fontSize: 13, fontWeight: 700, background: canRun ? T.accent : T.borderMid, color: canRun ? 'white' : T.textFaint, border: 'none', borderRadius: 9, cursor: canRun ? 'pointer' : 'not-allowed' }}>
                              {'\u29E1'} {multi ? 'Mine themes \u2014 ' + checked.length + ' question' + (checked.length !== 1 ? 's' : '') : 'Mine with AI'}
                            </button>
                          )
                        })()}
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
                {(rowsLoaded || themesPaintable) && hasThemes && displayThemes && !loading && (function() {
                  var sortedThemes = [...displayThemes.themes].sort(function(a, b) { return (b.count || 0) - (a.count || 0) })
                  // Two-count model (owner 2026-07-14): "comments" = SUBSTANTIVE
                  // answers only (a comment is substantive-or-blank). Every theme
                  // prevalence % divides by this base, in lockstep with the
                  // server's substantive numerator (t.count, sql/181). Matches the
                  // SQL substantive map (isSubstantiveText per field, any).
                  //
                  // Before the rows land there is nothing to count client-side, so
                  // fall back to the SERVER's substantive base — the exact
                  // denominator its per-theme counts came from, which keeps the
                  // numerator and denominator from two different worlds.
                  var totalResp = rowsLoaded
                    ? filteredRows.filter(function(r) { return effectiveFields.some(function(f) { return isSubstantiveText(String(r[f] || '')) }) }).length
                    : (serverTotalResp || 0)
                  var visibleThemes = showAllThemes ? sortedThemes : sortedThemes.filter(function(t) { return totalResp > 0 && (t.count / totalResp * 100) >= 3 })
                  if (!visibleThemes.length) visibleThemes = sortedThemes.slice(0, 5)
                  var topTone = sortedThemes[0] ? sortedThemes[0].sentiment : '\u2014'

                  return (
                    <div>
                      {/* The AI-mined banner was removed 2026-07-14: its comment count +
                          "% substantive" now live on the metric strip above (one comment
                          count, not two), and the "AI Mined" pill top-right carries the
                          provenance. */}

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
                                  {/* Two-count model: this IS the substantive comment count
                                      (non-answers excluded); the rule lives in the tooltip
                                      now that the separate "% substantive" line is gone. */}
                                  <div title={SUBSTANTIVE_RULE_NOTE} style={{ fontSize: 10, color: T.textMute, marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', cursor: 'help' }}>Comments</div>
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

                      {/* ── Entity overview stat strip (Entities section home) — mirrors
                          the theme grid so the lens has a real Overview, not a
                          stripped Themes tab. ─── */}
                      {viewBy === 'entity' && entityCatalogRows.length > 0 && (function() {
                        var catCounts: Record<string, number> = {}
                        entityCatalogRows.forEach(function(e) { var c = e.category || 'other'; catCounts[c] = (catCounts[c] || 0) + 1 })
                        var cats = Object.keys(catCounts)
                        var topCat = cats.sort(function(a, b) { return catCounts[b] - catCounts[a] })[0] || '—'
                        return (
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                            <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px' }}>
                              <div style={{ fontSize: 22, fontWeight: 800, color: T.accent, lineHeight: 1 }}>{totalResp.toLocaleString()}</div>
                              <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Comments</div>
                            </div>
                            <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px' }}>
                              <div style={{ fontSize: 24, fontWeight: 800, color: T.blue, lineHeight: 1 }}>{(entityCatalogTotal != null ? entityCatalogTotal : entityCatalogRows.length).toLocaleString()}</div>
                              <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Distinct Entities</div>
                            </div>
                            <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px' }}>
                              <div style={{ fontSize: 24, fontWeight: 800, color: T.green, lineHeight: 1, textTransform: 'capitalize' }}>{topCat}</div>
                              <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Top Category</div>
                            </div>
                          </div>
                        )
                      })()}

                      {/* ── Entities — scope-wide, click an entity to read its comments.
                          Only on the Entities section (its Overview home); not on the
                          Themes page, which has a dedicated Entities section now. ─── */}
                      {viewBy === 'entity' && (
                        <EntitiesCard
                          entities={entityCatalogRows}
                          totalDistinct={entityCatalogTotal}
                          scopeType={entityCatalogScopeType}
                          sampled={entityCatalogSampled}
                          loading={entityCatalogLoading}
                          error={entityCatalogError}
                          onDrillEntity={handleDrillEntity}
                          ratings={entityRatings.byEntity}
                          overallRating={entityRatings.overall}
                        />
                      )}

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
                                  <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                                    Theme Distribution {'\u2014'} click a bar to view comments
                                    {countsPending && <span style={{ marginLeft: 8, color: T.amber, textTransform: 'none', letterSpacing: 0 }}>{'counts calculating\u2026'}</span>}
                                  </div>
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
                                    {t.stability && (
                                      <span title={'Stable in ' + t.stability.support + ' of ' + t.stability.runs + ' independent mining runs on separate stratified samples \u00b7 keyword agreement ' + t.stability.kwAgreement + '%'}
                                        style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', fontWeight: 700, cursor: 'help', whiteSpace: 'nowrap' }}>
                                        {'\u2713'} {t.stability.support}/{t.stability.runs} runs
                                      </span>
                                    )}
                                    <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, background: sentBg(t.sentiment), color: sentColor(t.sentiment), fontWeight: 700, textTransform: 'capitalize' }}>{t.sentiment || '\u2014'}</span>
                                  </div>
                                </div>
                                {/* Theme name + origin badge */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                  <span style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{t.name}</span>
                                  {(t as Theme & { origin?: string }).origin === 'seed' && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 700, background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd' }}>Seed</span>}
                                  {(t as Theme & { origin?: string }).origin === 'organic-promoted' && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 700, background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }}>Organic</span>}
                                  {(t as Theme & { origin?: string }).origin === 'organic' && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 700, background: '#fff7ed', color: '#c2410c', border: '1px solid #fdba74' }}>Organic</span>}
                                </div>
                                {/* Description */}
                                <div style={{ fontSize: 12, color: T.textMute, lineHeight: 1.5, marginBottom: 10, minHeight: 32 }}>{t.description}</div>
                                {/* Keywords (max 4) — click to see opinions, show avg rating when available */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                                  {(t.keywords || []).slice(0, 4).map(function(k) {
                                    var kr = t.keywordRatings?.[k]
                                    var kwColor = kr && colorMode === 'rating' ? ratingColor(normRating(kr.avg)) : null
                                    return <span key={k} onClick={function(e) { e.stopPropagation(); setOpinionWord(opinionWord === k ? null : k); setOpinionThemeId(opinionWord === k ? null : t.id) }}
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
                                      // Theme-scoped rows, so the mention count and the theme's
                                      // comment count come from the SAME population. Pairing a
                                      // dataset-wide numerator with a theme denominator produces a
                                      // ratio of two different things (and can exceed 100%).
                                      rows={opinionThemeRows || filteredRows}
                                      fields={activeField || (themes ? themes.fieldName : '')}
                                      ratingField={ratingField}
                                      hiddenFields={hiddenFields}
                                      themeScope={opinionThemeScope}
                                      conceptThemes={(displayThemes || themes)?.themes || null}
                                      conceptEntities={entityCatalogRows}
                                      onClose={function() { setOpinionWord(null); setOpinionThemeId(null) }}
                                    />
                                  </div>
                                )}
                                {/* Opinions — top 3 opinion words for this theme's keywords */}
                                {/* "Co-occurs with themes" reads from serverCoOccurrence, set
                                    by fetchServerThemeCounts. Until the fetch resolves a small
                                    placeholder + Lottie spinner stands in — the matrix RPC
                                    takes ~1–2s per dataset (per member for collections), and
                                    the card looks lifeless without a hint that something's
                                    coming. extrasLoaded flips to true on response so we
                                    can suppress the section entirely when a theme genuinely
                                    has no co-occurring siblings. */}
                                {(function() {
                                  if (!extrasLoaded) {
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
                                          var otherTheme = (themes?.themes || []).find(function(x) { return x.id === otherId })
                                          return (
                                            <span key={otherId} title={themeNameById[otherId] + ' — co-occurs in ' + pairCount.toLocaleString() + ' "' + t.name + '" comment' + (pairCount === 1 ? '' : 's') + ' (' + pctOfThis + '% of this theme) — click to see these comments'}
                                              onClick={function(ev) { ev.stopPropagation(); if (otherTheme) handleDrillTheme(otherTheme) }}
                                              style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600, background: otherPal.bg, color: otherPal.text, border: '1px solid ' + otherPal.border + '60', cursor: 'pointer' }}>
                                              {themeNameById[otherId]} ({pctOfThis}%)
                                            </span>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )
                                })()}
                                {/* Items mentioned — named entities reviewers bring up within
                                    this theme's matched comments (shared cross-tab with the
                                    Theme Clouds). Only shown when the entity catalog has hits. */}
                                {(function() {
                                  var teList = themeCardEntities[themeKey(t, 0)] || []
                                  if (!teList.length) return null
                                  var ENT_COLOR: Record<string, string> = { food: '#EA580C', person: '#1E40AF' }
                                  return (
                                    <div style={{ marginBottom: 10 }}>
                                      <div style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }} title="Named items (dishes, drinks, people, brands) reviewers mention when discussing this theme">
                                        Items mentioned
                                      </div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {teList.slice(0, 6).map(function(e) {
                                          var ec = ENT_COLOR[e.category] || '#8FA3AE'
                                          return (
                                            <span key={e.slug} title={e.canonical + ' — mentioned in ' + e.count.toLocaleString() + ' "' + t.name + '" comment' + (e.count === 1 ? '' : 's') + ' — click to see these comments'}
                                              onClick={function(ev) {
                                                ev.stopPropagation()
                                                var ecRow = entityCatalogRows.find(function(x) { return x.slug === e.slug })
                                                setSelectedThemes([t]); setDrillTheme(t)
                                                handleDrillEntity({ slug: e.slug, canonical: e.canonical, category: e.category, aliases: ecRow ? (ecRow.aliases || []) : [] })
                                              }}
                                              style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: ec + '0d', border: '1px solid ' + ec + '30', color: T.textMid, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                                              <span style={{ width: 5, height: 5, borderRadius: 3, background: ec, flexShrink: 0 }} />
                                              <span style={{ fontWeight: 600 }}>{e.canonical}</span>
                                              <span style={{ color: T.textFaint }}>{e.count.toLocaleString()}</span>
                                            </span>
                                          )
                                        })}
                                        {teList.length > 6 && <span style={{ fontSize: 9, color: T.textFaint, alignSelf: 'center' }}>+{teList.length - 6} more</span>}
                                      </div>
                                    </div>
                                  )
                                })()}
                                {/* Dimensions — top taxonomy sub-buckets (across all 7 axes)
                                    carried by this theme's matched reviews. Server-computed
                                    (theme_dimension_counts RPC); only shown when the dataset is
                                    classified into Dimensions and this theme has tagged rows. */}
                                {dimensionsEnabled && (function() {
                                  // Same placeholder contract as "Co-occurs with themes" above,
                                  // and for a sharper reason since the two-phase split (2026-08-15):
                                  // Dimensions now arrive in the SECOND request, up to ~18s after
                                  // the card paints on a cold load. Rendering nothing during that
                                  // window reads as "this dataset has no dimensions" rather than
                                  // "not here yet" — a silent absence a user can act on wrongly.
                                  // extrasLoaded gates it, so a theme with genuinely no tagged
                                  // rows still collapses to nothing once the phase completes.
                                  if (!extrasLoaded) {
                                    return (
                                      <div style={{ marginBottom: 10 }}>
                                        <div style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>
                                          Dimensions
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
                                            {[1, 2, 3].map(function(i) {
                                              return <span key={i} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: T.border, color: 'transparent', minWidth: 54, height: 14 }}>{'—'}</span>
                                            })}
                                          </div>
                                          <LottieLoader size={18} />
                                        </div>
                                      </div>
                                    )
                                  }
                                  var dimList = serverThemeDimensions[t.id] || []
                                  if (!dimList.length) return null
                                  return (
                                    <div style={{ marginBottom: 10 }}>
                                      <div style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }} title="Dimension sub-buckets (service, food, drinks, ambiance, …) reviewers discuss when this theme comes up">
                                        Dimensions
                                      </div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {dimList.slice(0, 6).map(function(d) {
                                          var dc = AXIS_COLOR[d.axis as Axis] || '#8FA3AE'
                                          var axisLabel = DIM_AXIS_LABEL[d.axis as Axis] || d.axis
                                          return (
                                            <span key={d.axis + ':' + d.sub} title={axisLabel + ' › ' + dimSubLabel(d.sub) + ' — click to see these "' + t.name + '" comments (' + d.count.toLocaleString() + ')'}
                                              onClick={function(ev) { ev.stopPropagation(); setSelectedThemes([t]); setDrillTheme(t); handleDrillDimension(d.axis, d.sub) }}
                                              style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: dc + '0d', border: '1px solid ' + dc + '30', color: T.textMid, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                                              <span style={{ width: 5, height: 5, borderRadius: 3, background: dc, flexShrink: 0 }} />
                                              <span style={{ fontWeight: 600 }}>{dimSubLabel(d.sub)}</span>
                                              <span style={{ color: T.textFaint }}>{d.count.toLocaleString()}</span>
                                            </span>
                                          )
                                        })}
                                        {dimList.length > 6 && <span style={{ fontSize: 9, color: T.textFaint, alignSelf: 'center' }}>+{dimList.length - 6} more</span>}
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
                                      <strong style={{ fontSize: 18, color: cardBorder }}>{(t.count || 0).toLocaleString()}</strong> comments
                                      {(t.snippetCount || 0) > 0 && (
                                        <>
                                          {' \u00b7 '}
                                          <strong style={{ color: T.textMid }}>{(t.snippetCount || 0).toLocaleString()}</strong> snippets
                                        </>
                                      )}
                                      {countsPending && (
                                        <span title="Counting this theme across the whole dataset. The number shown is provisional until that finishes."
                                          style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: T.amber, background: T.amberBg, border: '1px solid ' + T.amberMid, borderRadius: 10, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                                          {'calculating\u2026'}
                                        </span>
                                      )}
                                    </span>
                                    <span style={{ fontSize: 22, fontWeight: 800, color: cardBorder }}>{pct}%</span>
                                  </div>
                                  {/* The interval is a client-side computation over the loaded
                                      rows, so on a progressive paint it isn't known yet. It used
                                      to fall back to `?? 0` and render "95% CI: 0\u20130%" \u2014 a
                                      fabricated statistic sitting next to a real count. Say it's
                                      still being worked out instead. */}
                                  <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 6 }}>
                                    {t.ciLow != null && t.ciHigh != null
                                      ? '95% CI: ' + t.ciLow + '\u2013' + t.ciHigh + '%'
                                      : !rowsLoaded ? '95% CI: calculating\u2026' : ''}
                                  </div>
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
                      entities={entityCatalogRows}
                      themeDimensions={serverThemeDimensions}
                      isReddit={datasetSource === 'reddit' || datasetSource === 'substack'}
                      onEntityClick={function(e) { handleDrillEntity(e) }}
                      onDimensionClick={function(axis, sub) { handleDrillDimension(axis, sub) }}
                      onWordClick={function(word, themeIdx, type) {
                        // Word click: opinion popover. Theme title click: theme popover.
                        if (type === 'theme') {
                          setThemePopoverIdx(themePopoverIdx === themeIdx ? null : themeIdx)
                        } else if (word) {
                          setOpinionWord(opinionWord === word ? null : word)
                          var ct = ((displayThemes || themes)?.themes || [])[themeIdx]
                          setOpinionThemeId(themeIdx >= 0 && ct ? ct.id : null)
                        }
                      }}
                    />
                  )}
                  {viewBy === 'theme' && opinionWord && (
                    <div style={{ marginTop: 12 }}>
                      <OpinionPopover
                        word={opinionWord}
                        // Scoped to the theme's own rows when the word came from a
                        // theme's cloud, so the mention count and the theme comment
                        // count are the SAME population and the percentage means
                        // something. Everything else in the modal (opinions, quotes,
                        // frequency) is then about that theme too, which is what the
                        // header now promises.
                        rows={opinionThemeRows || filteredRows}
                        fields={activeFields && activeFields.length > 0 ? activeFields : (activeField || (themes ? themes.fieldName : ''))}
                        ratingField={ratingField}
                        hiddenFields={hiddenFields}
                        // Theme Clouds draws one cloud PER theme, so the theme is the
                        // ROW the word was clicked in (captured as opinionThemeId).
                        // An earlier pass keyed this off `selectedThemes` — the filter
                        // selection, normally empty here — so every word fell back to
                        // "% of comments", the very thing this was meant to fix.
                        themeScope={opinionThemeScope}
                        conceptThemes={(displayThemes || themes)?.themes || null}
                        conceptEntities={entityCatalogRows}
                        onClose={function() { setOpinionWord(null); setOpinionThemeId(null) }}
                      />
                    </div>
                  )}
                  {viewBy === 'theme' && themePopoverIdx !== null && themes && (displayThemes || themes).themes[themePopoverIdx] && (
                    <ThemePopover
                      theme={(displayThemes || themes).themes[themePopoverIdx]}
                      rows={filteredRows}
                      fields={activeFields && activeFields.length > 0 ? activeFields : (activeField || (themes ? themes.fieldName : ''))}
                      color={themeColors[themePopoverIdx]?.text}
                      ratingField={ratingField}
                      hiddenFields={hiddenFields}
                      conceptThemes={(displayThemes || themes)?.themes || null}
                      conceptEntities={entityCatalogRows}
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

            {/* ═══ DIMENSIONS SECTION ═══ Overview / Clouds / Compare share the
                'dimensions' subTab; the active view picks the renderer.
                (self-contained modules — fetch the embedded taxonomy themselves) */}
            {subTab === 'dimensions' && activeView === 'overview' && (
              <div style={{ flex: 1, minHeight: 0 }}>
                <TaxonomyModule datasetId={datasetId} fields={effectiveFields} fieldLabel={effectiveFields.length ? effectiveFields.map(fieldLabel).join(' + ') : null}
                  onDrillDimension={handleDrillDimension}
                  onDrillAxis={handleDrillAxis} />
              </div>
            )}
            {subTab === 'dimensions' && activeView === 'clouds' && (
              <DimensionCloud datasetId={datasetId} fields={effectiveFields} onDrillDimension={handleDrillDimension} />
            )}
            {subTab === 'dimensions' && activeView === 'compare' && (
              <DimensionCompareTab datasetId={datasetId} catFields={catFields} fieldLabel={fieldLabel} onDrillDimension={handleDrillDimension} />
            )}

            {/* ═══ PLACEHOLDER ═══ cells with no renderer yet (e.g. Dimensions ×
                Clouds / Compare) — keep the bar uniform, say it's coming. */}
            {cellPending && (
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} className="fadein">
                <div style={{ textAlign: 'center', maxWidth: 420 }}>
                  <div style={{ fontSize: 30, marginBottom: 12, opacity: 0.5 }}>{'◱'}</div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: '0 0 6px' }}>{VIEW_LABEL[activeView]} isn&apos;t available for {activeSection === 'dimensions' ? 'Dimensions' : activeSection} yet</h3>
                  <p style={{ fontSize: 13, color: T.textMid, lineHeight: 1.6, margin: '0 0 16px' }}>
                    This view is on the way. For now, switch to a view that&apos;s ready for this section.
                  </p>
                  <button onClick={function() { navTo(activeSection, 'overview') }}
                    style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, background: T.accent, color: 'white', border: 'none', borderRadius: 20, cursor: 'pointer' }}>
                    Go to Overview
                  </button>
                </div>
              </div>
            )}

            {/* ═══ COMMENTS TAB ═══ */}
            {subTab === 'comments' && (
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {/* Search the comments — collapsible. Scoped to the rows currently
                    in view + the active open-ended field(s), so it respects the
                    filters and the field selection (not the dataset-wide /search). */}
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
                      <CommentSearchPanel rows={filteredRows} fields={effectiveFields} schema={augmentedFields} ratingField={ratingField} />
                    </div>
                  )}
                </div>
                {hasThemes && themes && themes.themes.length > 0 && rowsLoaded ? (
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
                    {/* Entities + Dimensions facets — AND-combine with the themes above */}
                    {(entityCatalogRows.length > 0 || (dimensionsEnabled && dimFacets.length > 0)) && (function() {
                      var entOpts = entityCatalogRows.filter(function(e) { return !filterEntities.some(function(fe) { return fe.slug === e.slug }) }).slice(0, 200)
                      return (
                        <div style={{ padding: '8px 20px', borderBottom: '1px solid ' + T.border, background: T.bgCard, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {entityCatalogRows.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em', width: 64, flexShrink: 0 }}>Entities</span>
                              {filterEntities.map(function(e) {
                                return (
                                  <span key={e.slug} style={{ fontSize: 11, fontWeight: 600, padding: '2px 6px 2px 10px', borderRadius: 20, background: '#EA580C14', border: '1px solid #EA580C40', color: '#9a3412', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    {e.canonical}
                                    <button onClick={function() { setFilterEntities(function(prev) { return prev.filter(function(x) { return x.slug !== e.slug }) }) }} style={{ background: 'none', border: 'none', color: '#9a3412', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                                  </span>
                                )
                              })}
                              <select value="" onChange={function(ev) {
                                var slug = ev.target.value; if (!slug) return
                                const ent = entityCatalogRows.find(function(x) { return x.slug === slug })
                                if (ent) setFilterEntities(function(prev) { return prev.some(function(p) { return p.slug === slug }) ? prev : prev.concat([{ slug: ent.slug, canonical: ent.canonical, category: ent.category, aliases: ent.aliases || [] }]) })
                              }} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: '1px dashed ' + T.borderMid, background: 'transparent', color: T.textMute, cursor: 'pointer' }}>
                                <option value="">+ Entity</option>
                                {entOpts.map(function(e) { return <option key={e.slug} value={e.slug}>{e.canonical} ({e.mentions.toLocaleString()})</option> })}
                              </select>
                            </div>
                          )}
                          {dimensionsEnabled && dimFacets.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em', width: 64, flexShrink: 0 }}>Dimensions</span>
                              {filterDims.map(function(d) {
                                var dc = AXIS_COLOR[d.axis as Axis] || '#8FA3AE'
                                return (
                                  <span key={d.axis + ':' + d.sub} style={{ fontSize: 11, fontWeight: 600, padding: '2px 6px 2px 10px', borderRadius: 20, background: dc + '14', border: '1px solid ' + dc + '40', color: T.textMid, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 5, height: 5, borderRadius: 3, background: dc, flexShrink: 0 }} />
                                    {dimSubLabel(d.sub)}
                                    <button onClick={function() { setFilterDims(function(prev) { return prev.filter(function(x) { return !(x.axis === d.axis && x.sub === d.sub) }) }) }} style={{ background: 'none', border: 'none', color: T.textMid, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                                  </span>
                                )
                              })}
                              <select value="" onChange={function(ev) {
                                var v = ev.target.value; if (!v) return
                                var parts = v.split('||'); var axis = parts[0]; var sub = parts[1]
                                if (axis && sub) setFilterDims(function(prev) { return prev.some(function(p) { return p.axis === axis && p.sub === sub }) ? prev : prev.concat([{ axis: axis, sub: sub }]) })
                              }} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: '1px dashed ' + T.borderMid, background: 'transparent', color: T.textMute, cursor: 'pointer' }}>
                                <option value="">+ Dimension</option>
                                {dimFacets.map(function(a) {
                                  return (
                                    <optgroup key={a.axis} label={a.label}>
                                      {a.subs.filter(function(s) { return !filterDims.some(function(fd) { return fd.axis === a.axis && fd.sub === s.sub }) }).map(function(s) {
                                        return <option key={a.axis + s.sub} value={a.axis + '||' + s.sub}>{dimSubLabel(s.sub)} ({s.count.toLocaleString()})</option>
                                      })}
                                    </optgroup>
                                  )
                                })}
                              </select>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                    {commentsServerMode ? (
                      <FilteredCommentsPanel
                        rows={filterRows}
                        total={filterTotal}
                        loading={filterLoading}
                        error={filterError}
                        hlTerms={filterEntities.reduce<string[]>(function(acc, e) { return acc.concat([e.canonical]).concat(e.aliases || []) }, []).concat(selectedThemes.reduce<string[]>(function(acc, t) { return acc.concat(t.keywords || []) }, []))}
                        chips={<span style={{ fontSize: 11, color: T.textMute }}>{selectedThemes.length + filterEntities.length + filterDims.length} filter{(selectedThemes.length + filterEntities.length + filterDims.length) !== 1 ? 's' : ''} active {'·'} all must match</span>}
                        openFields={openFields}
                        schema={schema.fields}
                        datasetId={datasetId}
                        // Per-theme colored highlights (CommentsPanel parity): each
                        // selected theme's keywords mark in that theme's palette.
                        kwPalettes={selectedThemes.reduce<Record<string, { light?: string; bg: string; text: string; border: string }>>(function(map, st) {
                          var idx = themes ? themes.themes.findIndex(function(t) { return t.id === st.id }) : -1
                          var pal = (idx >= 0 && themeColors[idx]) || THEME_PALETTE[0]
                          ;(st.keywords || []).forEach(function(kw) { map[kw.toLowerCase()] = pal })
                          return map
                        }, {})}
                        aiEnabled={aiEnabled}
                        summaryTopic={selectedThemes.map(function(t) { return t.name })
                          .concat(filterEntities.map(function(e) { return e.canonical }))
                          .concat(filterDims.map(function(d) { return dimSubLabel(d.sub) }))
                          .join(' + ')}
                      />
                    ) : (
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
                    )}
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
          <button onClick={function() { void saveThemeModel() }}
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
          onMineWithAI={canMine && aiEnabled && !aiDisabledByOrg ? function() { setShowThemeEditor(false); void mineThemes() } : undefined}
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
                onClick={function() { setShowMineChoice(false); void mineThemes('merge') }}
                style={{ padding: '14px 16px', borderRadius: 10, border: '1.5px solid #bae6fd', background: '#f0f9ff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0284c7' }}>Merge from members</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  Use existing AI-mined themes from each member dataset and merge them.
                  Identifies shared and unique themes. Fast, no re-mining needed.
                </div>
              </button>
              <button
                onClick={function() { setShowMineChoice(false); void mineThemes('fresh') }}
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
