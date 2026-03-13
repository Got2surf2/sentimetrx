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
    return [...vals].sort()
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
  const groupVals = [...new Set(parsedData.map(function(r) { return String(r[breakdownField] ?? '') }).filter(Boolean))].sort()
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
  const [subTab, setSubTab] = useState<SubTab>('themes')
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

      {/* Top bar */}
      <div style={{ background: T.bgCard, borderBottom: '1px solid ' + T.border, padding: '12px 20px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Field picker */}
        {openFields.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {openFields.map(function(f) {
              return (
                <button
                  key={f.field}
                  onClick={function() { setActiveField(f.field) }}
                  style={{
                    padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8,
                    background: activeField === f.field ? T.accentBg : T.bg,
                    color: activeField === f.field ? T.accent : T.textMid,
                    border: '1px solid ' + (activeField === f.field ? T.accentMid : T.border),
                    cursor: 'pointer',
                  }}
                >
                  {f.field}
                </button>
              )
            })}
          </div>
        )}
        {openFields.length === 1 && (
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
            {'\u25C8'} {activeField}
          </span>
        )}
        {openFields.length === 0 && (
          <span style={{ fontSize: 12, color: T.textMute }}>No open-ended fields found. Edit schema in Settings.</span>
        )}

        {/* Source badge */}
        {themeSource && (
          <span style={{
            fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 600,
            background: themeSource === 'ai' ? T.blueBg : T.accentBg,
            color: themeSource === 'ai' ? T.blue : T.accent,
            border: '1px solid ' + (themeSource === 'ai' ? T.blue + '40' : T.accentMid),
          }}>
            {themeSource === 'ai' ? 'AI Themes' : themeLibName || 'Industry Themes'}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* API key status */}
          <button
            onClick={function() { setShowApiKeyModal(true) }}
            style={{
              padding: '5px 10px', fontSize: 11, fontWeight: 600, borderRadius: 7,
              background: apiKey ? T.greenBg : T.bg,
              color: apiKey ? T.green : T.textFaint,
              border: '1px solid ' + (apiKey ? T.greenMid : T.border),
              cursor: 'pointer',
            }}
          >
            {apiKey ? '\u2714 AI key set' : '\uD83D\uDD11 Add API key'}
          </button>

          {/* Theme editor */}
          {openFields.length > 0 && (
            <button
              onClick={function() { setShowThemeEditor(true) }}
              style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 7, color: T.textMid, cursor: 'pointer' }}
            >
              {'\u2261'} Themes
            </button>
          )}

          {/* Mine themes */}
          {openFields.length > 0 && (
            <button
              onClick={mineThemes}
              disabled={!canMine || loading}
              style={{
                padding: '6px 16px', fontSize: 12, fontWeight: 700,
                background: canMine && !loading ? T.accent : T.borderMid,
                color: canMine && !loading ? 'white' : T.textFaint,
                border: 'none', borderRadius: 8,
                cursor: canMine && !loading ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {loading ? 'Mining...' : '\u29E1 Mine Themes'}
            </button>
          )}

          {/* Save */}
          {hasThemes && (
            <button
              onClick={saveThemeModel}
              disabled={saving}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600,
                background: saved ? T.greenBg : T.bg,
                color: saved ? T.green : T.textMid,
                border: '1px solid ' + (saved ? T.greenMid : T.border),
                borderRadius: 8, cursor: 'pointer',
              }}
            >
              {saved ? '\u2714 Saved' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: '10px 20px', background: T.redBg, borderBottom: '1px solid ' + T.red + '30', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: T.red, flex: 1 }}>
            {error === 'AUTH_ERROR' ? 'Invalid API key. Check it at console.anthropic.com/keys'
              : error === 'QUOTA_ERROR' ? 'Insufficient API credits. Add credits at console.anthropic.com'
              : error}
          </span>
          <button onClick={function() { setError(null) }} style={{ background: 'transparent', border: 'none', color: T.red, cursor: 'pointer', fontSize: 16 }}>x</button>
        </div>
      )}

      {/* Main layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        <div style={{ width: 220, flexShrink: 0, background: T.bgSidebar, borderRight: '1px solid ' + T.border, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {/* Stats */}
          <div style={{ padding: '14px 14px 10px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Dataset
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>
              {totalRows.toLocaleString()} rows
            </div>
            {rowsLoading && (
              <div style={{ fontSize: 11, color: T.textMute, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: T.accent, animation: 'pulse 1s infinite' }} />
                Loading rows...
              </div>
            )}
            {rowsLoaded && (
              <div style={{ fontSize: 11, color: T.green }}>{'\u2714'} {rows.length.toLocaleString()} rows loaded</div>
            )}
            {rowsError && (
              <div style={{ fontSize: 11, color: T.red }}>{rowsError}</div>
            )}
          </div>

          {/* Sampling control */}
          {rowsLoaded && activeField && (
            <div style={{ padding: '0 14px 12px', borderBottom: '1px solid ' + T.border }}>
              <SamplingControl
                samplePct={samplePct}
                setSamplePct={setSamplePct}
                total={activeFieldCount}
                lastRunPct={lastRunPct}
                onRerun={mineThemes}
              />
            </div>
          )}

          {/* Sampling info */}
          {samplingInfo && (
            <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + T.border }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                Last Analysis
              </div>
              <div style={{ fontSize: 11, color: T.textMid }}>
                {samplingInfo.sampled.toLocaleString()} of {samplingInfo.total.toLocaleString()} responses
                {samplingInfo.sampled < samplingInfo.total && (
                  <span style={{ color: T.textFaint }}> (sampled)</span>
                )}
              </div>
            </div>
          )}

          {/* Breakdown selector */}
          {rowsLoaded && catFields.length > 0 && (
            <BreakdownSelector
              catFields={catFields}
              breakdownField={breakdownField}
              setBreakdownField={setBreakdownField}
              schema={schema.fields}
              parsedData={rows}
              selectedValues={selectedValues}
              setSelectedValues={setSelectedValues}
            />
          )}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Sub-tab bar */}
          <div style={{ background: T.bgCard, borderBottom: '1px solid ' + T.border, padding: '0 20px', flexShrink: 0, display: 'flex', gap: 0 }}>
            {subTabs.map(function(tab) {
              const isActive = subTab === tab.id
              const isLocked = !hasThemes && tab.id !== 'themes'
              return (
                <button
                  key={tab.id}
                  onClick={function() { if (!isLocked) handleSubTab(tab.id) }}
                  style={{
                    padding: '12px 16px', fontSize: 13, fontWeight: isActive ? 700 : 500,
                    color: isActive ? T.accent : (isLocked ? T.textFaint : T.textMid),
                    background: 'transparent', border: 'none',
                    borderBottom: '2px solid ' + (isActive ? T.accent : 'transparent'),
                    cursor: isLocked ? 'not-allowed' : 'pointer',
                    transition: 'all .15s', opacity: isLocked ? 0.5 : 1,
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {/* Themes tab */}
            {subTab === 'themes' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
                {!rowsLoaded && (
                  <div style={{ textAlign: 'center', padding: 40, color: T.textMute }}>
                    <div style={{ fontSize: 24, marginBottom: 12 }}>{'\u231B'}</div>
                    <p style={{ fontSize: 14 }}>Loading dataset rows...</p>
                  </div>
                )}
                {rowsLoaded && !hasThemes && (
                  <div style={{ textAlign: 'center', padding: 48, maxWidth: 420, margin: '0 auto' }}>
                    <div style={{ fontSize: 40, marginBottom: 16 }}>
                      <span style={{ color: T.accent, fontWeight: 800 }}>Ana</span>
                    </div>
                    <h3 style={{ fontSize: 18, fontWeight: 800, color: T.text, marginBottom: 8 }}>TextMine is ready</h3>
                    <p style={{ fontSize: 13, color: T.textMute, lineHeight: 1.6, marginBottom: 24 }}>
                      {rows.length.toLocaleString()} responses loaded across {openFields.length} open-ended field{openFields.length !== 1 ? 's' : ''}.
                      Run an AI analysis or pick an industry theme library to get started.
                    </p>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={mineThemes}
                        disabled={!canMine}
                        style={{ padding: '10px 20px', fontSize: 13, fontWeight: 700, background: canMine ? T.accent : T.borderMid, color: canMine ? 'white' : T.textFaint, border: 'none', borderRadius: 9, cursor: canMine ? 'pointer' : 'not-allowed' }}
                      >
                        {'\u29E1'} Mine with AI
                      </button>
                      <button
                        onClick={function() { setShowThemeEditor(true) }}
                        style={{ padding: '10px 20px', fontSize: 13, fontWeight: 700, background: T.bg, border: '1px solid ' + T.border, color: T.textMid, borderRadius: 9, cursor: 'pointer' }}
                      >
                        {'\u2261'} Choose industry library
                      </button>
                    </div>
                  </div>
                )}
                {rowsLoaded && hasThemes && themes && (
                  <div>
                    {/* Summary */}
                    {themes.summary && (
                      <div style={{ background: T.accentBg, border: '1px solid ' + T.accentMid, borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: T.textMid, lineHeight: 1.6 }}>
                        {themes.summary}
                      </div>
                    )}

                    {/* Theme bars */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                      {[...themes.themes].sort(function(a, b) { return b.count - a.count }).map(function(t, ti) {
                        const pal = themeColors[themes.themes.indexOf(t)] || THEME_PALETTE[0]
                        const pct = t.percentage || 0
                        return (
                          <div
                            key={t.id}
                            style={{ background: T.bgCard, border: '1px solid ' + T.border, borderLeft: '3px solid ' + pal.border, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'box-shadow .15s' }}
                            onClick={function() { handleDrillTheme(t) }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: pal.text, background: pal.bg, border: '1px solid ' + pal.border + '60', borderRadius: 20, padding: '2px 8px', flexShrink: 0 }}>
                                {pct}%
                              </span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: T.text, flex: 1 }}>{t.name}</span>
                              <span style={{ fontSize: 11, color: sentColor(t.sentiment), background: sentBg(t.sentiment), padding: '2px 8px', borderRadius: 20, border: '1px solid ' + sentColor(t.sentiment) + '30', fontWeight: 600 }}>
                                {t.sentiment}
                              </span>
                              <span style={{ fontSize: 11, color: T.textFaint }}>{t.count} responses &rarr;</span>
                            </div>
                            <div style={{ height: 7, background: T.bg, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                              <div style={{ height: '100%', width: pct + '%', background: pal.border, borderRadius: 4, transition: 'width .6s ease' }} />
                            </div>
                            {t.description && (
                              <div style={{ fontSize: 12, color: T.textMute, lineHeight: 1.5 }}>{t.description}</div>
                            )}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                              {(t.keywords || []).slice(0, 8).map(function(kw) {
                                return (
                                  <span key={kw} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border + '50' }}>
                                    {kw}
                                  </span>
                                )
                              })}
                              {(t.keywords || []).length > 8 && (
                                <span style={{ fontSize: 10, color: T.textFaint, padding: '1px 4px' }}>+{t.keywords.length - 8} more</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Breakdown distribution */}
                    {breakdownField && selectedValues.size > 0 && (
                      <BreakdownDist
                        themes={themes}
                        parsedData={rows}
                        activeField={activeField || themes.fieldName}
                        breakdownField={breakdownField}
                        selectedValues={selectedValues}
                        themeColors={themeColors}
                        onDrillTheme={handleDrillTheme}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Theme Clouds tab */}
            {subTab === 'clouds' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
                {hasThemes && themes && rowsLoaded ? (
                  <WordCloud
                    themes={themes.themes}
                    themeColors={themeColors}
                    parsedData={rows}
                    activeField={activeField || themes.fieldName}
                    onWordClick={function(_, idx, type) {
                      if (type === 'theme' && themes) {
                        const t = themes.themes[idx]
                        if (t) handleDrillTheme(t)
                      }
                    }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>
                    Run a TextMine analysis first to see theme clouds.
                  </div>
                )}
              </div>
            )}

            {/* Compare tab */}
            {subTab === 'compare' && (
              <CompareTab
                themes={themes}
                parsedData={rows}
                schema={schema.fields}
                activeField={activeField}
                themeColors={themeColors}
                breakdownField={breakdownField}
                setBreakdownField={setBreakdownField}
              />
            )}

            {/* Comments tab */}
            {subTab === 'comments' && (
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {drillTheme && hasThemes && themes && rowsLoaded ? (
                  <CommentsPanel
                    theme={drillTheme}
                    allThemes={themes.themes}
                    parsedData={rows}
                    activeField={activeField || themes.fieldName}
                    catFields={catFields}
                    themeColors={themeColors}
                    onBack={function() { setDrillTheme(null); setSubTab('themes') }}
                    schema={schema.fields}
                    apiKey={apiKey || undefined}
                    datasetId={datasetId}
                  />
                ) : (
                  <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
                    {hasThemes && themes && rowsLoaded ? (
                      <div>
                        <p style={{ fontSize: 13, color: T.textMute, marginBottom: 16 }}>
                          Click a theme below to browse its responses.
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {themes.themes.map(function(t, ti) {
                            const pal = themeColors[ti] || THEME_PALETTE[0]
                            return (
                              <button
                                key={t.id}
                                onClick={function() { handleDrillTheme(t) }}
                                style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border, borderRadius: 9, cursor: 'pointer' }}
                              >
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

      {/* Modals */}
      {showApiKeyModal && (
        <ApiKeyModal
          onSave={function(k) { setApiKey(k) }}
          onClose={function() { setShowApiKeyModal(false) }}
        />
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
