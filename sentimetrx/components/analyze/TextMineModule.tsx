'use client'
// components/analyze/TextMineModule.tsx
// Main TextMine client shell. Owns all state for the 4 sub-tabs.
// Fetches rows from the paginated rows API, mines themes via server proxy,
// saves theme model back to dataset_state. Ana proprietary prompts stay server-side.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Theme, ThemeModel, THEME_PALETTE,
  recountThemes, sampleSize95, evenSample,
  commentMatchesTheme, getRowText, sentColor, sentBg,
} from '@/lib/themeUtils'
import ThemeEditor from '@/components/analyze/textmine/ThemeEditor'
import WordCloud from '@/components/analyze/textmine/WordCloud'
import CommentsPanel from '@/components/analyze/textmine/CommentsPanel'
import BreakdownDist from '@/components/analyze/textmine/BreakdownDist'

const T = {
  bg: '#f4f5f7', bgCard: '#ffffff', bgSidebar: '#ffffff',
  border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentDark: '#c4501f', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', greenBg: '#f0fdf4', greenMid: '#bbf7d0',
  red: '#dc2626', redBg: '#fef2f2',
  amber: '#d97706', amberBg: '#fffbeb', amberMid: '#fde68a',
  blue: '#2563eb', blueBg: '#eff6ff',
  purple: '#7c3aed', purpleBg: '#f5f3ff',
}

interface SchemaField {
  field: string
  type: 'open-ended' | 'categorical' | 'numeric' | 'date' | 'id' | 'ignore'
  status?: string
  values?: string[]
}

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
  datasetId: string
  schema: SchemaConfig
  analytics: DatasetAnalytics | null
  savedThemeModel: ThemeModel | null
}

type SubTab = 'themes' | 'clouds' | 'compare' | 'comments'

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
            <h2 style={{ fontSize: 18, fontWeight: 800, color: T.text, margin: 0 }}>Claude API Key</h2>
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

function BreakdownSelector({ catFields, breakdownField, setBreakdownField, schema, parsedData, selectedValues, setSelectedValues }: {
  catFields: string[]
  breakdownField: string | null
  setBreakdownField: (f: string | null) => void
  schema: SchemaField[]
  parsedData: Record<string, unknown>[]
  selectedValues: Set<string>
  setSelectedValues: (s: Set<string>) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  function getValues(field: string) {
    const s = schema.find(function(f) { return f.field === field })
    if (s && s.values) return s.values
    const vals = new Set<string>()
    parsedData.forEach(function(r) {
      const v = r[field]
      if (v != null && String(v).trim() !== '') vals.add(String(v))
    })
    return Array.from(vals).sort()
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
                    checked={vals.every(function(v) { return selectedValues.has(v) })}
                    onChange={function() {
                      const all = vals.every(function(v) { return selectedValues.has(v) })
                      setSelectedValues(all ? new Set() : new Set(vals))
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

// ─── CompareTab (inline simplified version) ───────────────────────────────────

function CompareTab({ themes, parsedData, schema, activeField, themeColors, breakdownField, setBreakdownField }: {
  themes: ThemeModel | null
  parsedData: Record<string, unknown>[]
  schema: SchemaField[]
  activeField: string | null
  themeColors: Record<number, typeof THEME_PALETTE[0]>
  breakdownField: string | null
  setBreakdownField: (f: string | null) => void
}) {
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

  const catFields = schema.filter(function(f) { return f.type === 'categorical' }).map(function(f) { return f.field })
  const field = activeField || themes.fieldName
  const selField = breakdownField || catFields[0] || null

  if (!catFields.length) {
    return (
      <div style={{ padding: 24, color: T.textMute, fontSize: 13 }}>
        No categorical fields available for comparison. Add categorical fields to your schema to compare groups.
      </div>
    )
  }

  return (
    <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
          Compare by group
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {catFields.map(function(f) {
            return (
              <button
                key={f}
                onClick={function() { setBreakdownField(f) }}
                style={{
                  padding: '5px 12px', fontSize: 12, fontWeight: 600,
                  background: selField === f ? T.amberBg : T.bg,
                  color: selField === f ? T.amber : T.textMid,
                  border: '1px solid ' + (selField === f ? T.amber + '60' : T.border),
                  borderRadius: 8, cursor: 'pointer',
                }}
              >
                {f}
              </button>
            )
          })}
        </div>
      </div>
      {selField && (
        <CompareGroupView
          themes={themes}
          parsedData={parsedData}
          field={field}
          breakdownField={selField}
          themeColors={themeColors}
        />
      )}
    </div>
  )
}

function CompareGroupView({ themes, parsedData, field, breakdownField, themeColors }: {
  themes: ThemeModel
  parsedData: Record<string, unknown>[]
  field: string
  breakdownField: string
  themeColors: Record<number, typeof THEME_PALETTE[0]>
}) {
  const groupVals = Array.from(new Set(parsedData.map(function(r) { return String(r[breakdownField] ?? '') }).filter(Boolean))).sort()
  const sortedThemes = [...themes.themes].sort(function(a, b) { return b.count - a.count })

  return (
    <div>
      {sortedThemes.map(function(t, ti) {
        const pal = themeColors[ti] || THEME_PALETTE[0]
        const groupData = groupVals.map(function(v) {
          const rows = parsedData.filter(function(r) { return String(r[breakdownField] ?? '') === v })
          const total = rows.filter(function(r) { return String(r[field] || '').trim().length > 0 }).length
          const count = rows.filter(function(r) { return commentMatchesTheme(String(r[field] || ''), t) }).length
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          return { v, count, pct, total }
        })
        const maxPct = Math.max(...groupData.map(function(g) { return g.pct }), 1)
        return (
          <div key={t.id} style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px', marginBottom: 10, borderLeft: '3px solid ' + pal.border }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: pal.text }}>{t.name}</span>
              <span style={{ fontSize: 11, color: T.textMute }}>{t.count} responses overall ({t.percentage}%)</span>
            </div>
            {groupData.map(function(g) {
              return (
                <div key={g.v} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: T.textMid, width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {g.v}
                  </span>
                  <div style={{ flex: 1, height: 8, background: T.bg, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (g.pct / maxPct * 100) + '%', background: pal.border, borderRadius: 4, transition: 'width .5s' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.text, width: 36, textAlign: 'right', flexShrink: 0 }}>
                    {g.pct}%
                  </span>
                  <span style={{ fontSize: 10, color: T.textFaint, width: 40, textAlign: 'right', flexShrink: 0 }}>
                    n={g.count}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main TextMineModule ───────────────────────────────────────────────────────

export default function TextMineModule({ datasetId, schema, analytics, savedThemeModel }: Props) {
  const totalRows = analytics?.totalRows ?? 0
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [rowsLoading, setRowsLoading] = useState(false)
  const [rowsLoaded, setRowsLoaded] = useState(false)
  const [rowsError, setRowsError] = useState<string | null>(null)

  const [themes, setThemes] = useState<ThemeModel | null>(savedThemeModel || null)
  const [themeSource, setThemeSource] = useState<string | null>(savedThemeModel?.themeSource || null)
  const [themeLibName, setThemeLibName] = useState<string | null>(savedThemeModel?.themeLibName || null)
  const [samplingInfo, setSamplingInfo] = useState<{ sampled: number; total: number } | null>(null)

  const [activeField, setActiveField] = useState<string | null>(null)
  const [activeFields, setActiveFields] = useState<string[]>([])
  const [subTab, setSubTab] = useState<SubTab>('themes')
  const [themesView, setThemesView] = useState<'distribution' | 'cards'>('cards')
  const [breakdownField, setBreakdownField] = useState<string | null>(null)
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set())
  const [drillTheme, setDrillTheme] = useState<Theme | null>(null)

  const [apiKey, setApiKey] = useState<string>('')
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [showThemeEditor, setShowThemeEditor] = useState(false)
  const [industryThemes, setIndustryThemes] = useState<Record<string, Theme[]> | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [samplePct, setSamplePct] = useState(0)
  const [lastRunPct, setLastRunPct] = useState<number | null>(null)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const openFields = schema.fields.filter(function(f) { return f.type === 'open-ended' && f.status !== 'ignored' })
  const catFields = schema.fields.filter(function(f) { return f.type === 'categorical' && f.status !== 'ignored' }).map(function(f) { return f.field })

  // Set initial active field
  useEffect(function() {
    if (!activeField && openFields.length > 0) {
      setActiveField(savedThemeModel?.fieldName || openFields[0].field)
    }
  }, [openFields.length])

  // Load API key from localStorage
  useEffect(function() {
    try {
      const k = localStorage.getItem('sentimetrx_tm_apikey')
      if (k) setApiKey(k)
    } catch { /* ignore */ }
  }, [])

  // Load industry themes on mount
  useEffect(function() {
    fetch('/api/industry-themes')
      .then(function(r) { return r.json() })
      .then(function(d) { setIndustryThemes(d) })
      .catch(function() { /* silently ignore */ })
  }, [])

  // Fetch all rows progressively
  const fetchAllRows = useCallback(async function() {
    if (rowsLoaded || rowsLoading) return
    setRowsLoading(true)
    setRowsError(null)
    const PAGE_SIZE = 500
    let page = 0
    const allRows: Record<string, unknown>[] = []
    try {
      while (true) {
        const r = await fetch('/api/datasets/' + datasetId + '/rows?page=' + page + '&pageSize=' + PAGE_SIZE)
        if (!r.ok) throw new Error('Failed to load rows (page ' + page + ')')
        const data = await r.json()
        const batch: Record<string, unknown>[] = data.rows || []
        allRows.push(...batch)
        if (page >= (data.totalPages || 0) - 1 || batch.length < PAGE_SIZE) break
        page++
      }
      setRows(allRows)
      // Recount saved themes against fresh rows
      if (savedThemeModel && savedThemeModel.themes && allRows.length > 0) {
        const field = savedThemeModel.fieldNames || savedThemeModel.fieldName
        const recounted = recountThemes(savedThemeModel.themes, allRows, field)
        setThemes({ ...savedThemeModel, themes: recounted })
      }
      setRowsLoaded(true)
    } catch (e: unknown) {
      setRowsError(e instanceof Error ? e.message : 'Failed to load rows')
    }
    setRowsLoading(false)
  }, [datasetId, rowsLoaded, rowsLoading, savedThemeModel])

  // Load rows when user first interacts (lazy)
  useEffect(function() {
    fetchAllRows()
  }, [])

  // Theme colors
  const themeColors: Record<number, typeof THEME_PALETTE[0]> = {}
  if (themes) {
    themes.themes.forEach(function(_, i) {
      themeColors[i] = THEME_PALETTE[i % THEME_PALETTE.length]
    })
  }

  // Stats for active field
  const activeFieldRows = rows.filter(function(r) {
    return activeField && String(r[activeField] || '').trim().length > 0
  })
  const activeFieldCount = activeFieldRows.length

  // Prepare corpus sample for mining
  function prepareCorpus() {
    if (!activeField || !rows.length) return { texts: [], total: 0 }
    const texts = rows
      .map(function(r) { return String(r[activeField!] || '').trim() })
      .filter(function(t) { return t.length > 0 })
    const total = texts.length
    const defaultN = sampleSize95(total)
    const defaultPct = total > 0 ? Math.round(defaultN / total * 100) : 100
    const activePct = samplePct === 0 ? defaultPct : samplePct
    const n = Math.max(1, Math.round(total * (activePct / 100)))
    const sampled = evenSample(texts, n)
    return { texts: sampled, total }
  }

  async function mineThemes() {
    if (!apiKey) { setShowApiKeyModal(true); return }
    if (!activeField || !rows.length) return
    setLoading(true)
    setError(null)
    try {
      const { texts, total } = prepareCorpus()
      if (!texts.length) throw new Error('No text found in selected field.')
      const schemaCtx = schema.fields.map(function(f) {
        return f.field + ':' + f.type + (f.type === 'categorical' && f.values ? ' (' + f.values.slice(0, 6).join(',') + ')' : '')
      }).join('; ')
      const res = await fetch('/api/datasets/' + datasetId + '/mine-themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, texts, fieldName: activeField, schemaCtx }),
      })
      const data = await res.json()
      if (!res.ok) {
        const errMsg = data.error || 'Mining failed'
        if (errMsg.startsWith('AUTH_ERROR')) throw new Error('AUTH_ERROR')
        if (errMsg.startsWith('QUOTA_ERROR')) throw new Error('QUOTA_ERROR')
        throw new Error(errMsg)
      }
      if (!data.themes) throw new Error('No themes returned')
      const recounted = recountThemes(data.themes, rows, activeField)
      const tm: ThemeModel = {
        themes: recounted,
        summary: data.summary || '',
        fieldName: activeField,
        fieldNames: [activeField],
        themeSource: 'ai',
        themeLibName: null,
        samplingInfo: { sampled: texts.length, total },
      }
      setThemes(tm)
      setThemeSource('ai')
      setThemeLibName(null)
      setSamplingInfo({ sampled: texts.length, total })
      setLastRunPct(samplePct)
      setSubTab('themes')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Mining failed')
    }
    setLoading(false)
  }

  function applyIndustryThemes(themeArr: Theme[], libName: string, source: string) {
    if (!activeField || !rows.length) return
    const recounted = recountThemes(themeArr, rows, activeField)
    const total = rows.filter(function(r) { return String(r[activeField!] || '').trim().length > 0 }).length
    const tm: ThemeModel = {
      themes: recounted,
      summary: 'Industry library: ' + libName,
      fieldName: activeField,
      fieldNames: [activeField],
      themeSource: source,
      themeLibName: libName,
      samplingInfo: { sampled: total, total },
    }
    setThemes(tm)
    setThemeSource(source)
    setThemeLibName(libName)
    setSamplingInfo({ sampled: total, total })
    setLastRunPct(null)
    setShowThemeEditor(false)
    setSubTab('themes')
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
      setTimeout(function() { setSaved(false) }, 3000)
    } catch { /* ignore */ }
    setSaving(false)
  }

  function handleSubTab(tab: SubTab) {
    setSubTab(tab)
    if (tab !== 'comments') setDrillTheme(null)
  }

  function handleDrillTheme(t: Theme) {
    setDrillTheme(t)
    setSubTab('comments')
  }

  function handleThemeEditorApply(themeArr: Theme[], libName: string, source: string) {
    applyIndustryThemes(themeArr, libName, source)
  }

  const hasThemes = themes && themes.themes && themes.themes.length > 0
  const canMine = rowsLoaded && activeField && rows.length > 0
  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'themes', label: 'Themes' },
    { id: 'clouds', label: 'Theme Clouds' },
    { id: 'compare', label: 'Compare' },
    { id: 'comments', label: 'Comments' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: T.bg }}>
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
          <span style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0 }}>Analyse:</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {openFields.map(function(f) {
              var sel = activeField === f.field
              return (
                <button key={f.field} onClick={function() { setActiveField(f.field) }}
                  style={{ padding: '3px 12px', fontSize: 12, fontWeight: sel ? 700 : 500, background: sel ? T.accentBg : 'white', border: '1.5px solid ' + (sel ? T.accent : T.border), color: sel ? T.accent : T.textMid, borderRadius: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, transition: 'all .12s' }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, border: '1.5px solid ' + (sel ? T.accent : T.borderMid), background: sel ? T.accent : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'white', flexShrink: 0, transition: 'all .12s' }}>
                    {sel ? '\u2713' : ''}
                  </span>
                  {f.field}
                </button>
              )
            })}
          </div>
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

      {/* ─── Main layout ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ─── Sidebar ──────────────────────────────────────────────────── */}
        <div style={{ width: 220, flexShrink: 0, background: T.bgSidebar, borderRight: '1px solid ' + T.border, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {/* Stats */}
          <div style={{ padding: '14px 14px 10px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Dataset</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>{totalRows.toLocaleString()} rows</div>
            {rowsLoading && (
              <div style={{ fontSize: 11, color: T.textMute, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', border: '2px solid ' + T.accentMid, borderTopColor: T.accent, animation: 'spin 0.8s linear infinite' }} />
                Loading rows...
              </div>
            )}
            {rowsLoaded && <div style={{ fontSize: 11, color: T.green }}>{'\u2714'} {rows.length.toLocaleString()} rows loaded</div>}
            {rowsError && <div style={{ fontSize: 11, color: T.red }}>{rowsError}</div>}
          </div>

          {/* Field picker (single field, sidebar style) */}
          {openFields.length > 0 && (
            <div style={{ padding: '0 14px 12px', borderBottom: '1px solid ' + T.border }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Analyse Field</div>
              {openFields.map(function(f) {
                var sel = activeField === f.field
                return (
                  <button key={f.field} onClick={function() { setActiveField(f.field) }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: sel ? T.accentBg : 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', borderRadius: 7, borderLeft: '3px solid ' + (sel ? T.accent : 'transparent'), marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: sel ? 700 : 500, color: sel ? T.accent : T.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.field}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Sampling control */}
          {rowsLoaded && activeField && (
            <div style={{ padding: '10px 14px 12px', borderBottom: '1px solid ' + T.border }}>
              <SamplingControl samplePct={samplePct} setSamplePct={setSamplePct} total={activeFieldCount} lastRunPct={lastRunPct} onRerun={mineThemes} />
            </div>
          )}

          {/* Sampling info */}
          {samplingInfo && (
            <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + T.border }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>Last Analysis</div>
              <div style={{ fontSize: 11, color: T.textMid }}>
                {samplingInfo.sampled.toLocaleString()} of {samplingInfo.total.toLocaleString()} responses
                {samplingInfo.sampled < samplingInfo.total && <span style={{ color: T.textFaint }}> (sampled)</span>}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid ' + T.border }}>
            <button onClick={function() { setShowApiKeyModal(true) }}
              style={{ width: '100%', padding: '6px 10px', fontSize: 11, fontWeight: 600, borderRadius: 7, background: apiKey ? T.greenBg : T.bg, color: apiKey ? T.green : T.textFaint, border: '1px solid ' + (apiKey ? T.greenMid : T.border), cursor: 'pointer', marginBottom: 6, textAlign: 'left' }}>
              {apiKey ? '\u2714 AI key connected' : '\uD83D\uDD11 Connect AI key'}
            </button>
            {openFields.length > 0 && (
              <button onClick={mineThemes} disabled={!canMine || loading}
                style={{ width: '100%', padding: '8px 10px', fontSize: 12, fontWeight: 700, background: canMine && !loading ? T.accent : T.borderMid, color: canMine && !loading ? 'white' : T.textFaint, border: 'none', borderRadius: 8, cursor: canMine && !loading ? 'pointer' : 'not-allowed', marginBottom: 6 }}>
                {loading ? 'Mining...' : '\u29E1 Mine with AI'}
              </button>
            )}
            {openFields.length > 0 && (
              <button onClick={function() { setShowThemeEditor(true) }}
                style={{ width: '100%', padding: '6px 10px', fontSize: 11, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 7, color: T.textMid, cursor: 'pointer', marginBottom: 6, textAlign: 'left' }}>
                {'\u2261'} Theme library...
              </button>
            )}
            {hasThemes && (
              <button onClick={saveThemeModel} disabled={saving}
                style={{ width: '100%', padding: '6px 10px', fontSize: 11, fontWeight: 600, background: saved ? T.greenBg : T.bg, color: saved ? T.green : T.textMid, border: '1px solid ' + (saved ? T.greenMid : T.border), borderRadius: 7, cursor: 'pointer', textAlign: 'left' }}>
                {saved ? '\u2714 Saved' : '\u2193 Save theme model'}
              </button>
            )}
          </div>

          {/* Breakdown selector */}
          {rowsLoaded && catFields.length > 0 && (
            <BreakdownSelector catFields={catFields} breakdownField={breakdownField} setBreakdownField={setBreakdownField} schema={schema.fields} parsedData={rows} selectedValues={selectedValues} setSelectedValues={setSelectedValues} />
          )}
        </div>

        {/* ─── Main content ────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Sub-tab bar */}
          <div style={{ background: T.bgCard, borderBottom: '1px solid ' + T.border, height: 40, display: 'flex', alignItems: 'stretch', paddingLeft: 8, flexShrink: 0 }}>
            {subTabs.map(function(tab) {
              var isActive = subTab === tab.id
              var isLocked = !hasThemes && tab.id !== 'themes'
              return (
                <button key={tab.id} onClick={function() { if (!isLocked) handleSubTab(tab.id) }}
                  style={{ padding: '0 18px', height: '100%', fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : (isLocked ? T.textFaint : T.textMid), background: 'transparent', border: 'none', borderBottom: '2px solid ' + (isActive ? T.accent : 'transparent'), cursor: isLocked ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: isLocked ? 0.4 : 1, transition: 'color .12s' }}
                  title={isLocked ? 'Run a theme model first' : ''}>
                  {tab.label}
                </button>
              )
            })}
            {/* Source badge in sub-tab bar */}
            {themeSource && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px' }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, background: themeSource === 'ai' ? T.accentBg : T.amberBg, color: themeSource === 'ai' ? T.accent : T.amber, border: '1px solid ' + (themeSource === 'ai' ? T.accentMid : T.amberMid) }}>
                  {themeSource === 'ai' ? '\u29E1 AI Mined' : '\u2261 ' + (themeLibName || 'Industry')}
                </span>
              </div>
            )}
          </div>

          {/* ─── Tab content ─────────────────────────────────────────── */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {/* ═══ THEMES TAB ═══ */}
            {subTab === 'themes' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }} className="fadein">

                {/* Loading spinner — Ana style */}
                {loading && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, paddingTop: 80, paddingBottom: 80 }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', border: '3px solid ' + T.accentMid, borderTopColor: T.accent, animation: 'spin 0.9s linear infinite' }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>Analyzing your responses</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                        {[0, 1, 2, 3].map(function(i) { return <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: T.accent, display: 'inline-block', animation: 'blink 1.4s ease infinite', animationDelay: (i * 0.2) + 's' }} /> })}
                      </div>
                      <div style={{ fontSize: 12, color: T.textMute, marginTop: 8 }}>Claude is reading and grouping themes...</div>
                    </div>
                  </div>
                )}

                {/* Rows still loading */}
                {!rowsLoaded && !loading && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 80 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid ' + T.borderMid, borderTopColor: T.accent, animation: 'spin 0.9s linear infinite' }} />
                    <div style={{ fontSize: 13, color: T.textMute }}>Loading dataset rows...</div>
                  </div>
                )}

                {/* Empty state — no themes yet */}
                {rowsLoaded && !hasThemes && !loading && (
                  <div style={{ textAlign: 'center', padding: '48px 20px', maxWidth: 440, margin: '0 auto' }}>
                    <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg, #fff3ee, #ffe4d6)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 28 }}>
                      <span style={{ color: T.accent, fontWeight: 900, fontStyle: 'italic' }}>A</span>
                    </div>
                    <h3 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 8 }}>TextMine is ready</h3>
                    <p style={{ fontSize: 13, color: T.textMute, lineHeight: 1.6, marginBottom: 24 }}>
                      {rows.length.toLocaleString()} responses loaded across {openFields.length} open-ended field{openFields.length !== 1 ? 's' : ''}.
                      {' '}Run an AI analysis or pick an industry theme library to get started.
                    </p>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button onClick={mineThemes} disabled={!canMine}
                        style={{ padding: '10px 22px', fontSize: 13, fontWeight: 700, background: canMine ? T.accent : T.borderMid, color: canMine ? 'white' : T.textFaint, border: 'none', borderRadius: 9, cursor: canMine ? 'pointer' : 'not-allowed' }}>
                        {'\u29E1'} Mine with AI
                      </button>
                      <button onClick={function() { setShowThemeEditor(true) }}
                        style={{ padding: '10px 22px', fontSize: 13, fontWeight: 700, background: T.bg, border: '2px solid ' + T.borderMid, color: T.textMid, borderRadius: 9, cursor: 'pointer' }}>
                        {'\u2261'} Choose industry library
                      </button>
                    </div>
                  </div>
                )}

                {/* ─── Themes content (with Distribution/Cards toggle) ─── */}
                {rowsLoaded && hasThemes && themes && !loading && (function() {
                  var sortedThemes = [...themes.themes].sort(function(a, b) { return b.count - a.count })
                  var totalResp = rows.filter(function(r) { return activeField && String(r[activeField] || '').trim().length > 0 }).length
                  var topTone = sortedThemes[0] ? sortedThemes[0].sentiment : '\u2014'

                  return (
                    <div>
                      {/* Header: title + source + view toggle */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: 0 }}>Themes</h2>
                          </div>
                          <p style={{ fontSize: 12, color: T.textMid, margin: '3px 0 0' }}>
                            Field: <strong>{activeField}</strong> {'\u00B7'} {themes.themes.length} themes {'\u00B7'} {totalResp.toLocaleString()} responses
                          </p>
                        </div>
                        <div style={{ display: 'flex', background: T.bg, borderRadius: 20, padding: 2, border: '1px solid ' + T.border, flexShrink: 0 }}>
                          {[['distribution', '\u2261 Distribution'], ['cards', '\u229E Cards']].map(function(pair) {
                            var v = pair[0]; var lbl = pair[1]
                            return (
                              <button key={v} onClick={function() { setThemesView(v as 'distribution' | 'cards') }}
                                style={{ fontSize: 12, fontWeight: themesView === v ? 700 : 500, padding: '5px 14px', borderRadius: 18, background: themesView === v ? T.accent : 'transparent', color: themesView === v ? 'white' : T.textMute, border: 'none', cursor: 'pointer', transition: 'background .15s' }}>
                                {lbl}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* 3 summary stat cards — Ana style */}
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                        <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                            <div>
                              <div style={{ fontSize: 22, fontWeight: 800, color: T.accent, lineHeight: 1 }}>{(samplingInfo ? samplingInfo.sampled : totalResp).toLocaleString()}</div>
                              <div style={{ fontSize: 10, color: T.textMute, marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{samplingInfo ? 'Sampled' : 'Responses'}</div>
                            </div>
                            {samplingInfo && (
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: 16, fontWeight: 700, color: T.textMid, lineHeight: 1 }}>{samplingInfo.total.toLocaleString()}</div>
                                <div style={{ fontSize: 10, color: T.textMute, marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Total</div>
                              </div>
                            )}
                          </div>
                          {samplingInfo && (
                            <div>
                              <div style={{ height: 4, background: T.border, borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
                                <div style={{ height: '100%', width: Math.round(samplingInfo.sampled / samplingInfo.total * 100) + '%', background: T.accent, borderRadius: 2 }} />
                              </div>
                              <div style={{ fontSize: 11, color: T.textMute }}>{Math.round(samplingInfo.sampled / samplingInfo.total * 100)}% sample rate</div>
                            </div>
                          )}
                        </div>
                        <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px' }}>
                          <div style={{ fontSize: 24, fontWeight: 800, color: T.blue, lineHeight: 1 }}>{themes.themes.length}</div>
                          <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Themes Found</div>
                        </div>
                        <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px' }}>
                          <div style={{ fontSize: 24, fontWeight: 800, color: T.green, lineHeight: 1, textTransform: 'capitalize' }}>{topTone}</div>
                          <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Top Tone</div>
                        </div>
                      </div>

                      {/* ── Distribution view ─── */}
                      {themesView === 'distribution' && (
                        <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '18px 20px', marginBottom: 20 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 14 }}>Theme Distribution {'\u2014'} click a bar to view comments</div>
                          {sortedThemes.map(function(t) {
                            var idx = themes.themes.indexOf(t)
                            var pal = themeColors[idx] || THEME_PALETTE[0]
                            var pct = totalResp > 0 ? Math.round(t.count / totalResp * 100) : 0
                            var pctFrac = totalResp > 0 ? t.count / totalResp : 0
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
                        </div>
                      )}

                      {/* ── Cards view (exact Ana.html style) ─── */}
                      {themesView === 'cards' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
                          {sortedThemes.map(function(t) {
                            var idx = themes.themes.indexOf(t)
                            var pal = themeColors[idx] || THEME_PALETTE[0]
                            var pct = totalResp > 0 ? Math.round(t.count / totalResp * 100) : (t.percentage || 0)
                            return (
                              <div key={t.id} className="theme-card"
                                onClick={function() { handleDrillTheme(t) }}
                                style={{ background: T.bgCard, border: '2px solid ' + pal.border, borderRadius: 14, padding: '16px 18px', cursor: 'pointer', transition: 'box-shadow .15s, transform .12s' }}>
                                {/* Top row: dot + sentiment badge */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: pal.border, flexShrink: 0 }} />
                                  <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, background: sentBg(t.sentiment), color: sentColor(t.sentiment), fontWeight: 700, textTransform: 'capitalize' }}>{t.sentiment || '\u2014'}</span>
                                </div>
                                {/* Theme name */}
                                <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 4 }}>{t.name}</div>
                                {/* Description */}
                                <div style={{ fontSize: 12, color: T.textMute, lineHeight: 1.5, marginBottom: 10, minHeight: 32 }}>{t.description}</div>
                                {/* Keywords (max 4) */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                                  {(t.keywords || []).slice(0, 4).map(function(k) {
                                    return <span key={k} style={{ fontSize: 11, padding: '2px 8px', background: T.bg, color: T.textMid, borderRadius: 20, border: '1px solid ' + T.border }}>{k}</span>
                                  })}
                                </div>
                                {/* Count + % + CI + mini bar */}
                                <div style={{ borderTop: '1px solid ' + T.border, paddingTop: 10 }}>
                                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ fontSize: 13, color: T.textMid }}><strong style={{ fontSize: 18, color: pal.border }}>{t.count.toLocaleString()}</strong> responses</span>
                                    <span style={{ fontSize: 22, fontWeight: 800, color: pal.border }}>{pct}%</span>
                                  </div>
                                  <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 6 }}>95% CI: {t.ciLow ?? 0}{'\u2013'}{t.ciHigh ?? 0}%</div>
                                  <div style={{ height: 5, background: T.border, borderRadius: 3, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: pct + '%', background: pal.border, borderRadius: 3, transition: 'width .6s ease' }} />
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Breakdown distribution */}
                      {breakdownField && selectedValues.size > 0 && (
                        <BreakdownDist themes={themes} parsedData={rows} activeField={activeField || themes.fieldName} breakdownField={breakdownField} selectedValues={selectedValues} themeColors={themeColors} onDrillTheme={handleDrillTheme} />
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ═══ THEME CLOUDS TAB ═══ */}
            {subTab === 'clouds' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }} className="fadein">
                <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 16 }}>Theme Clouds</h2>
                {hasThemes && themes && rowsLoaded ? (
                  <WordCloud
                    themes={themes.themes}
                    themeColors={themeColors}
                    parsedData={rows}
                    activeField={activeField || themes.fieldName}
                    onWordClick={function(word, idx, type) {
                      if (themes) {
                        if (type === 'theme') {
                          var t = themes.themes[idx]
                          if (t) handleDrillTheme(t)
                        } else {
                          var owner = idx >= 0 ? themes.themes[idx] : null
                          if (!owner && word) {
                            owner = themes.themes.find(function(th) {
                              return (th.keywords || []).some(function(k) { return k.toLowerCase() === (word || '').toLowerCase() })
                            }) || null
                          }
                          if (owner) handleDrillTheme(owner)
                        }
                      }
                    }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>Run a TextMine analysis first to see theme clouds.</div>
                )}
              </div>
            )}

            {/* ═══ COMPARE TAB ═══ */}
            {subTab === 'compare' && (
              <CompareTab themes={themes} parsedData={rows} schema={schema.fields} activeField={activeField} themeColors={themeColors} breakdownField={breakdownField} setBreakdownField={setBreakdownField} />
            )}

            {/* ═══ COMMENTS TAB ═══ */}
            {subTab === 'comments' && (
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {drillTheme && hasThemes && themes && rowsLoaded ? (
                  <CommentsPanel
                    theme={drillTheme} allThemes={themes.themes} parsedData={rows}
                    activeField={activeField || themes.fieldName} catFields={catFields}
                    themeColors={themeColors}
                    onBack={function() { setDrillTheme(null); setSubTab('themes') }}
                    schema={schema.fields} apiKey={apiKey || undefined} datasetId={datasetId}
                  />
                ) : (
                  <div style={{ flex: 1, overflowY: 'auto', padding: 24 }} className="fadein">
                    {hasThemes && themes && rowsLoaded ? (
                      <div>
                        <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 4 }}>Comments</h2>
                        <p style={{ fontSize: 13, color: T.textMute, marginBottom: 16 }}>Click a theme to browse its matched responses.</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {themes.themes.map(function(t, ti) {
                            var pal = themeColors[ti] || THEME_PALETTE[0]
                            return (
                              <button key={t.id} onClick={function() { handleDrillTheme(t) }}
                                style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: pal.bg, color: pal.text, border: '1.5px solid ' + pal.border, borderRadius: 9, cursor: 'pointer', transition: 'all .12s' }}>
                                {t.name} ({t.count})
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>
                        Run a TextMine analysis first, then click a theme to browse comments.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Modals ────────────────────────────────────────────────────── */}
      {showApiKeyModal && (
        <ApiKeyModal onSave={function(k) { setApiKey(k) }} onClose={function() { setShowApiKeyModal(false) }} />
      )}
      {showThemeEditor && industryThemes && (
        <ThemeEditor
          onApply={handleThemeEditorApply}
          onClose={function() { setShowThemeEditor(false) }}
          initialData={themes ? { themes: themes.themes, libName: themeLibName, source: themeSource } : null}
          industryThemes={industryThemes}
        />
      )}
    </div>
  )
}
