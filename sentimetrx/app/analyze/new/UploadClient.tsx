'use client'

// app/analyze/new/UploadClient.tsx
// Single-page stepper wizard: Upload → Schema → Themes → Publish
// All 4 steps on one page with horizontal stepper tabs.
// Tabs greyed out until their prerequisite step is complete.
// "Publish Dataset" at the end saves everything to the database.

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { autoDetectSchema } from '@/lib/datasetUtils'
import SchemaEditor from '@/components/analyze/SchemaEditor'
import type { SchemaConfig } from '@/lib/analyzeTypes'
import type { Theme } from '@/lib/themeUtils'

var HERMES = '#E8632A'
var HERMES_BG = '#fff4ef'
var HERMES_MID = '#fbd5c2'
var CHUNK_SIZE = 50
var MAX_BYTES = 3 * 1024 * 1024

var T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', greenBg: '#f0fdf4', greenMid: '#bbf7d0',
  red: '#dc2626', redBg: '#fef2f2',
  blue: '#2563eb', amber: '#d97706', amberBg: '#fffbeb', amberMid: '#fde68a',
}

var INDUSTRY_ICONS: Record<string, string> = {
  'SaaS / Software': '\uD83D\uDCBB', 'Healthcare': '\uD83C\uDFE5',
  'Retail / E-commerce': '\uD83D\uDED2', 'Hospitality / Hotels': '\uD83C\uDFE8',
  'Financial Services': '\uD83D\uDCB3', 'Education': '\uD83C\uDF93',
  'HR / Employee Experience': '\uD83D\uDC65', 'Political Opinion Survey': '\uD83D\uDDF3\uFE0F',
  'Media / Entertainment': '\uD83C\uDFAC', 'Sports': '\u26BD',
  'Performing Arts / Venues': '\uD83C\uDFAD', 'Travel / Tourism': '\u2708\uFE0F',
  'Higher Education': '\uD83C\uDFDB', 'Casual Dining': '\uD83C\uDF7D\uFE0F',
  'Fine Dining': '\uD83E\uDD42', 'Fast Food': '\uD83C\uDF5F',
  'Non-Profit / Charity': '\uD83E\uDD1D', 'Automotive Repair': '\uD83D\uDD27',
}

type Step = 1 | 2 | 3 | 4

interface ParsedFile {
  rows: Record<string, unknown>[]
  columns: string[]
  filename: string
}

// ─── CSV / TSV / JSON parsers ──────────────────────────────────────────────
function splitFields(line: string): string[] {
  var vals: string[] = [], cur = '', inQ = false
  for (var i = 0; i < line.length; i++) {
    var ch = line[i]
    if (ch === '"') { inQ = !inQ }
    else if (ch === ',' && !inQ) { vals.push(cur); cur = '' }
    else cur += ch
  }
  vals.push(cur)
  return vals.map(function(v) { return v.trim().replace(/^"|"$/g, '') })
}

function parseCSV(text: string): Record<string, unknown>[] {
  var lines = text.trim().split('\n').filter(function(l) { return l.trim() })
  if (lines.length < 2) return []
  var headers = splitFields(lines[0])
  return lines.slice(1).map(function(line) {
    var vals = splitFields(line)
    var row: Record<string, unknown> = {}
    headers.forEach(function(h, i) { row[h] = vals[i] ?? '' })
    return row
  })
}

function parseTSV(text: string): Record<string, unknown>[] {
  var lines = text.trim().split('\n').filter(function(l) { return l.trim() })
  if (lines.length < 2) return []
  var headers = lines[0].split('\t').map(function(h) { return h.trim() })
  return lines.slice(1).map(function(line) {
    var vals = line.split('\t')
    var row: Record<string, unknown> = {}
    headers.forEach(function(h, i) { row[h] = vals[i] ?? '' })
    return row
  })
}

function bytesOf(rows: Record<string, unknown>[]): number {
  return new Blob([JSON.stringify(rows)]).size
}

function splitChunks(rows: Record<string, unknown>[]): Record<string, unknown>[][] {
  var chunks: Record<string, unknown>[][] = []
  var i = 0
  while (i < rows.length) {
    var size = CHUNK_SIZE
    var chunk = rows.slice(i, i + size)
    while (bytesOf(chunk) > MAX_BYTES && size > 1) {
      size = Math.floor(size / 2)
      chunk = rows.slice(i, i + size)
    }
    chunks.push(chunk)
    i += chunk.length
  }
  return chunks
}

// ─── Stepper Tab ───────────────────────────────────────────────────────────
function StepperTab({ num, label, current, done, clickable, onClick }: {
  num: number; label: string; current: boolean; done: boolean; clickable: boolean; onClick: () => void
}) {
  return (
    <button onClick={clickable ? onClick : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
        background: current ? T.bgCard : 'transparent',
        borderBottom: current ? '3px solid ' + T.accent : '3px solid transparent',
        border: 'none', borderBottomStyle: 'solid', borderBottomWidth: 3,
        borderBottomColor: current ? T.accent : 'transparent',
        cursor: clickable ? 'pointer' : 'default',
        opacity: clickable || current ? 1 : 0.4,
        transition: 'all .15s',
      }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700,
        background: done ? T.green : current ? T.accent : T.borderMid,
        color: done || current ? 'white' : T.textFaint,
      }}>
        {done ? '\u2713' : num}
      </div>
      <span style={{ fontSize: 13, fontWeight: current ? 700 : 500, color: current ? T.text : (clickable ? T.textMid : T.textFaint) }}>
        {label}
      </span>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN WIZARD
// ═══════════════════════════════════════════════════════════════════════════

export default function UploadClient() {
  var router = useRouter()

  // Step state
  var [step, setStep] = useState<Step>(1)

  // Step 1: Upload
  var [parsed, setParsed] = useState<ParsedFile | null>(null)
  var [parseError, setParseError] = useState('')
  var [dragging, setDragging] = useState(false)

  // Step 2: Schema + Name
  var [schema, setSchema] = useState<SchemaConfig | null>(null)
  var [name, setName] = useState('')
  var [description, setDescription] = useState('')
  var [visibility, setVisibility] = useState<'private' | 'public'>('private')

  // Step 3: Themes
  var [industryThemes, setIndustryThemes] = useState<Record<string, Theme[]> | null>(null)
  var [checkedInds, setCheckedInds] = useState<Set<string>>(new Set())
  var [selectedThemes, setSelectedThemes] = useState<Theme[]>([])
  var [themesSkipped, setThemesSkipped] = useState(false)
  var [themeLibName, setThemeLibName] = useState('')

  // Step 4: Publish
  var [publishing, setPublishing] = useState(false)
  var [publishPct, setPublishPct] = useState(0)
  var [publishMsg, setPublishMsg] = useState('')
  var [error, setError] = useState('')

  // Load industry themes
  useEffect(function() {
    fetch('/api/industry-themes')
      .then(function(r) { return r.ok ? r.json() : {} })
      .then(function(d) { setIndustryThemes(d) })
      .catch(function() { setIndustryThemes({}) })
  }, [])

  // Prevent leaving with unsaved data
  useEffect(function() {
    function handler(e: BeforeUnloadEvent) {
      if (parsed && !publishing) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return function() { window.removeEventListener('beforeunload', handler) }
  }, [parsed, publishing])

  // Step completion checks
  var step1Done = parsed !== null
  var step2Done = step1Done && schema !== null && name.trim().length > 0
  var step3Done = step2Done && (selectedThemes.length > 0 || themesSkipped)

  // ─── Step 1: File handling ─────────────────────────────────────────────
  function handleFile(file: File) {
    setParseError('')
    var reader = new FileReader()
    reader.onload = function(e) {
      var text = e.target?.result as string
      try {
        var rows: Record<string, unknown>[] = []
        if (file.name.endsWith('.json')) {
          rows = JSON.parse(text)
          if (!Array.isArray(rows)) rows = [rows]
        } else if (file.name.endsWith('.tsv')) {
          rows = parseTSV(text)
        } else {
          rows = parseCSV(text)
        }
        if (rows.length === 0) { setParseError('No data rows found.'); return }
        var cols = Object.keys(rows[0] || {})
        setParsed({ rows: rows, columns: cols, filename: file.name })
        setName(file.name.replace(/\.[^/.]+$/, ''))

        // Auto-detect schema
        var detected = autoDetectSchema(rows)
        setSchema(detected)

        // Auto-advance to step 2
        setStep(2)
      } catch {
        setParseError('Could not parse this file. Please check the format.')
      }
    }
    reader.readAsText(file)
  }

  var handleDrop = useCallback(function(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    var file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  // ─── Step 3: Theme selection ───────────────────────────────────────────
  function toggleInd(ind: string) {
    setCheckedInds(function(prev) {
      var n = new Set(prev)
      if (n.has(ind)) n.delete(ind); else n.add(ind)
      return n
    })
  }

  function applyCheckedThemes() {
    if (!industryThemes || !checkedInds.size) return
    var merged: Theme[] = []
    var seen = new Set<string>()
    Array.from(checkedInds).forEach(function(l) {
      ;(industryThemes[l] || []).forEach(function(t) {
        if (!seen.has(t.id)) { seen.add(t.id); merged.push({ ...t, keywords: [...t.keywords] }) }
      })
    })
    var libs = Array.from(checkedInds)
    setSelectedThemes(merged)
    setThemeLibName(libs.join(' + '))
    setThemesSkipped(false)
    setStep(4)
  }

  function skipThemes() {
    setSelectedThemes([])
    setThemesSkipped(true)
    setThemeLibName('')
    setStep(4)
  }

  // ─── Step 4: Publish ───────────────────────────────────────────────────
  async function handlePublish() {
    if (!parsed || !schema || !name.trim()) return
    setPublishing(true)
    setError('')
    setPublishPct(0)
    setPublishMsg('Creating dataset...')

    try {
      // 1. Create dataset record
      var dsRes = await fetch('/api/datasets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description || null, source: 'upload', visibility: visibility }),
      })
      var dsData = await dsRes.json()
      if (!dsRes.ok) { setError(dsData.error || 'Failed to create dataset'); setPublishing(false); return }

      // 2. Upload rows in chunks
      var chunks = splitChunks(parsed.rows)
      for (var i = 0; i < chunks.length; i++) {
        setPublishMsg('Uploading rows \u2014 batch ' + (i + 1) + ' of ' + chunks.length)
        var res = await fetch('/api/datasets/' + dsData.id + '/rows', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunks[i], source_ref: parsed.filename }),
        })
        if (!res.ok) {
          var e = await res.json().catch(function() { return {} })
          setError('Upload failed on batch ' + (i + 1) + ': ' + ((e as any).error || 'server error'))
          setPublishing(false)
          return
        }
        setPublishPct(Math.round(((i + 1) / (chunks.length + 3)) * 100))
      }

      // 3. Save schema + themes to state
      setPublishMsg('Saving schema and themes...')
      var themeModel = selectedThemes.length > 0
        ? { themes: selectedThemes, themeSource: 'industry', themeLibName: themeLibName, version: 1 }
        : { themes: [], aiGenerated: false, version: 1 }

      await fetch('/api/datasets/' + dsData.id + '/state', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema_config: schema,
          theme_model: themeModel,
          saved_charts: [],
          saved_stats: [],
          filter_state: {},
        }),
      })
      setPublishPct(Math.round(((chunks.length + 1) / (chunks.length + 3)) * 100))

      // 4. Compute analytics
      setPublishMsg('Computing analytics...')
      var computeRes = await fetch('/api/datasets/' + dsData.id + '/compute', { method: 'POST' })
      if (!computeRes.ok) console.warn('[upload] analytics compute failed')
      setPublishPct(100)

      setPublishMsg('Done! Redirecting...')
      setTimeout(function() {
        router.push('/analyze/' + dsData.id + '/textmine')
      }, 500)
    } catch (err) {
      setError('Unexpected error: ' + String(err))
      setPublishing(false)
    }
  }

  // ─── Derived counts ────────────────────────────────────────────────────
  var totalCheckedThemes = industryThemes ? Array.from(checkedInds).reduce(function(sum, l) { return sum + (industryThemes[l] || []).length }, 0) : 0

  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxWidth: 960, margin: '0 auto' }}>

      {/* Breadcrumb */}
      <div style={{ padding: '12px 0 6px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <button onClick={function() { if (!parsed || confirm('Discard this upload?')) router.push('/analyze') }}
          style={{ background: 'none', border: 'none', color: T.textMute, cursor: 'pointer', fontSize: 13, padding: 0 }}>
          Analyze
        </button>
        <span style={{ color: T.textFaint }}>/</span>
        <span style={{ color: T.text, fontWeight: 600 }}>New Dataset</span>
      </div>

      {/* ─── Stepper tabs ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid ' + T.border, background: T.bgCard, borderRadius: '12px 12px 0 0', marginBottom: 0 }}>
        <StepperTab num={1} label="Upload" current={step === 1} done={step1Done && step > 1} clickable={true} onClick={function() { setStep(1) }} />
        <StepperTab num={2} label="Schema" current={step === 2} done={step2Done && step > 2} clickable={step1Done} onClick={function() { if (step1Done) setStep(2) }} />
        <StepperTab num={3} label="Themes" current={step === 3} done={step3Done && step > 3} clickable={step2Done} onClick={function() { if (step2Done) setStep(3) }} />
        <StepperTab num={4} label="Publish" current={step === 4} done={false} clickable={step3Done} onClick={function() { if (step3Done) setStep(4) }} />
      </div>

      {/* ─── Step content ──────────────────────────────────────────────── */}
      <div style={{ background: T.bgCard, borderRadius: '0 0 12px 12px', border: '1px solid ' + T.border, borderTop: 'none', padding: '24px 28px', minHeight: 400 }}>

        {/* ═══ STEP 1: Upload ═══ */}
        {step === 1 && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 4 }}>Upload your data</h2>
            <p style={{ fontSize: 13, color: T.textMute, marginBottom: 20 }}>CSV, TSV, or JSON files. Any size.</p>

            {!parsed ? (
              <div onDragOver={function(e) { e.preventDefault(); setDragging(true) }} onDragLeave={function() { setDragging(false) }} onDrop={handleDrop}
                style={{ border: '2px dashed ' + (dragging ? T.accent : T.borderMid), borderRadius: 16, padding: '48px 24px', textAlign: 'center', background: dragging ? T.accentBg : T.bg, transition: 'all .15s' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>{'\uD83D\uDCC2'}</div>
                <p style={{ fontSize: 14, fontWeight: 600, color: T.textMid, marginBottom: 4 }}>Drag and drop your file here</p>
                <p style={{ fontSize: 12, color: T.textFaint, marginBottom: 16 }}>or click below to browse</p>
                <label style={{ cursor: 'pointer' }}>
                  <span style={{ display: 'inline-block', padding: '10px 24px', fontSize: 13, fontWeight: 700, background: T.accent, color: 'white', borderRadius: 9, cursor: 'pointer' }}>Browse files</span>
                  <input type="file" accept=".csv,.tsv,.json" style={{ display: 'none' }}
                    onChange={function(e) { var f = e.target.files?.[0]; if (f) handleFile(f) }} />
                </label>
              </div>
            ) : (
              <div>
                <div style={{ padding: '14px 18px', background: T.greenBg, border: '1px solid ' + T.greenMid, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <span style={{ fontSize: 18, color: T.green }}>{'\u2713'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.green }}>{parsed.filename}</div>
                    <div style={{ fontSize: 12, color: T.textMute }}>{parsed.rows.length.toLocaleString()} rows {'\u00B7'} {parsed.columns.length} columns</div>
                  </div>
                  <button onClick={function() { setParsed(null); setSchema(null); setStep(1) }}
                    style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', background: T.bg, border: '1px solid ' + T.border, borderRadius: 7, color: T.textMid, cursor: 'pointer' }}>
                    Change file
                  </button>
                </div>

                {/* Preview table */}
                <div style={{ overflowX: 'auto', border: '1px solid ' + T.border, borderRadius: 8, marginBottom: 16 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead><tr style={{ background: T.bg }}>
                      {parsed.columns.map(function(c) {
                        return <th key={c} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: T.textMid, borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap' }}>{c}</th>
                      })}
                    </tr></thead>
                    <tbody>
                      {parsed.rows.slice(0, 5).map(function(row, i) {
                        return <tr key={i} style={{ borderBottom: '1px solid ' + T.border }}>
                          {parsed!.columns.map(function(c) {
                            return <td key={c} style={{ padding: '4px 10px', color: T.text, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(row[c] ?? '')}</td>
                          })}
                        </tr>
                      })}
                    </tbody>
                  </table>
                </div>

                <button onClick={function() { setStep(2) }}
                  style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, background: T.accent, color: 'white', border: 'none', borderRadius: 9, cursor: 'pointer' }}>
                  Next: Configure Schema {'\u2192'}
                </button>
              </div>
            )}

            {parseError && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: T.redBg, border: '1px solid ' + T.red + '30', borderRadius: 8, fontSize: 12, color: T.red }}>{parseError}</div>
            )}
          </div>
        )}

        {/* ═══ STEP 2: Schema + Name ═══ */}
        {step === 2 && parsed && schema && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 4 }}>Configure schema</h2>
            <p style={{ fontSize: 13, color: T.textMute, marginBottom: 20 }}>Review detected field types. Rename fields, adjust types, or ignore columns you don't need.</p>

            {/* Dataset name + description */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 5 }}>Dataset Name *</div>
                <input value={name} onChange={function(e) { setName(e.target.value) }} placeholder="e.g. Q1 2026 Customer Feedback"
                  style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1.5px solid ' + T.border, borderRadius: 8, outline: 'none', color: T.text, background: T.bg }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 5 }}>Description <span style={{ fontWeight: 400 }}>(optional)</span></div>
                <input value={description} onChange={function(e) { setDescription(e.target.value) }} placeholder="Brief description"
                  style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1.5px solid ' + T.border, borderRadius: 8, outline: 'none', color: T.text, background: T.bg }} />
              </div>
            </div>

            {/* Schema stats bar */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Open Text', count: schema.fields.filter(function(f) { return f.type === 'open-ended' }).length, color: '#2563eb' },
                { label: 'Categorical', count: schema.fields.filter(function(f) { return f.type === 'categorical' }).length, color: '#7c3aed' },
                { label: 'Numeric', count: schema.fields.filter(function(f) { return f.type === 'numeric' }).length, color: '#16a34a' },
                { label: 'Date', count: schema.fields.filter(function(f) { return f.type === 'date' }).length, color: '#d97706' },
                { label: 'Ignored', count: schema.fields.filter(function(f) { return f.type === 'ignore' || f.type === 'id' }).length, color: '#9ca3af' },
              ].map(function(s) {
                return (
                  <div key={s.label} style={{ padding: '6px 12px', borderRadius: 8, background: s.color + '10', border: '1px solid ' + s.color + '30', fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: s.color }}>{s.count}</span>
                    <span style={{ color: T.textMute, marginLeft: 4 }}>{s.label}</span>
                  </div>
                )
              })}
            </div>

            {/* Embedded SchemaEditor */}
            <SchemaEditor schema={schema} onChange={function(s) { setSchema(s) }} />

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={function() { setStep(1) }}
                style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 9, color: T.textMid, cursor: 'pointer' }}>
                {'\u2190'} Back
              </button>
              <button onClick={function() { setStep(3) }} disabled={!name.trim()}
                style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, background: name.trim() ? T.accent : T.borderMid, color: name.trim() ? 'white' : T.textFaint, border: 'none', borderRadius: 9, cursor: name.trim() ? 'pointer' : 'not-allowed' }}>
                Next: Choose Themes {'\u2192'}
              </button>
            </div>
          </div>
        )}

        {/* ═══ STEP 3: Themes ═══ */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 4 }}>Choose a theme framework</h2>
            <p style={{ fontSize: 13, color: T.textMute, marginBottom: 20 }}>
              Select one or more industry libraries to pre-load theme categories. You can also skip this and use AI to discover themes later in TextMine.
            </p>

            {/* Selection summary */}
            {checkedInds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '10px 14px', background: T.accentBg, borderRadius: 8, border: '1px solid ' + T.accentMid }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.accent, flex: 1 }}>
                  {checkedInds.size} selected {'\u00B7'} {totalCheckedThemes} themes
                </span>
                <button onClick={applyCheckedThemes}
                  style={{ padding: '6px 16px', fontSize: 12, fontWeight: 700, background: T.accent, color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer' }}>
                  Apply & Continue {'\u2192'}
                </button>
              </div>
            )}

            {/* Industry library grid */}
            {industryThemes ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                {Object.keys(industryThemes).sort().map(function(ind) {
                  var sel = checkedInds.has(ind)
                  var themeCount = (industryThemes![ind] || []).length
                  var icon = INDUSTRY_ICONS[ind] || '\uD83D\uDCCB'
                  return (
                    <button key={ind} onClick={function() { toggleInd(ind) }}
                      style={{
                        padding: '8px 14px', fontSize: 12, fontWeight: sel ? 700 : 500, borderRadius: 10,
                        background: sel ? T.accentBg : 'white', border: '1.5px solid ' + (sel ? T.accent : T.border),
                        color: sel ? T.accent : T.textMid, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                        transition: 'all .12s', minWidth: 170,
                      }}>
                      <span style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid ' + (sel ? T.accent : T.borderMid), background: sel ? T.accent : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'white', flexShrink: 0 }}>
                        {sel ? '\u2713' : ''}
                      </span>
                      <span style={{ fontSize: 16 }}>{icon}</span>
                      <span style={{ flex: 1, textAlign: 'left' }}>{ind}</span>
                      <span style={{ fontSize: 10, color: T.textFaint, flexShrink: 0 }}>{themeCount}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div style={{ padding: 20, textAlign: 'center', color: T.textMute, fontSize: 13 }}>Loading industry libraries...</div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={function() { setStep(2) }}
                style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 9, color: T.textMid, cursor: 'pointer' }}>
                {'\u2190'} Back
              </button>
              <button onClick={skipThemes}
                style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 9, color: T.textMid, cursor: 'pointer' }}>
                Skip {'\u2014'} I'll use AI later
              </button>
              {checkedInds.size > 0 && (
                <button onClick={applyCheckedThemes}
                  style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, background: T.accent, color: 'white', border: 'none', borderRadius: 9, cursor: 'pointer' }}>
                  Apply {checkedInds.size} {checkedInds.size === 1 ? 'library' : 'libraries'} {'\u2192'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ═══ STEP 4: Publish ═══ */}
        {step === 4 && parsed && schema && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, marginBottom: 4 }}>Publish dataset</h2>
            <p style={{ fontSize: 13, color: T.textMute, marginBottom: 20 }}>Review everything and publish. This saves the data, schema, and themes to the database.</p>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div style={{ padding: '14px 16px', background: T.bg, borderRadius: 10, border: '1px solid ' + T.border }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: T.accent, lineHeight: 1 }}>{parsed.rows.length.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Rows</div>
              </div>
              <div style={{ padding: '14px 16px', background: T.bg, borderRadius: 10, border: '1px solid ' + T.border }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: T.blue, lineHeight: 1 }}>{schema.fields.filter(function(f) { return f.type !== 'ignore' && f.type !== 'id' }).length}</div>
                <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Active Fields</div>
              </div>
              <div style={{ padding: '14px 16px', background: T.bg, borderRadius: 10, border: '1px solid ' + T.border }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: selectedThemes.length > 0 ? T.green : T.textFaint, lineHeight: 1 }}>{selectedThemes.length || '\u2014'}</div>
                <div style={{ fontSize: 10, color: T.textMute, marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Themes</div>
              </div>
            </div>

            {/* Details */}
            <div style={{ background: T.bg, borderRadius: 10, border: '1px solid ' + T.border, padding: '14px 18px', marginBottom: 20, fontSize: 13 }}>
              {[
                ['Name', name],
                ['File', parsed.filename],
                ['Visibility', visibility],
                ['Theme Library', themeLibName || 'None (will use AI later)'],
              ].map(function(pair) {
                return (
                  <div key={pair[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + T.border }}>
                    <span style={{ color: T.textMute }}>{pair[0]}</span>
                    <span style={{ fontWeight: 600, color: T.text }}>{pair[1]}</span>
                  </div>
                )
              })}
            </div>

            {/* Progress */}
            {publishing && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: T.textMute, marginBottom: 4 }}>
                  <span>{publishMsg}</span>
                  <span>{publishPct}%</span>
                </div>
                <div style={{ width: '100%', height: 6, background: T.border, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: publishPct + '%', background: T.accent, borderRadius: 3, transition: 'width .3s' }} />
                </div>
              </div>
            )}

            {error && (
              <div style={{ marginBottom: 16, padding: '10px 14px', background: T.redBg, border: '1px solid ' + T.red + '30', borderRadius: 8, fontSize: 12, color: T.red }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={function() { setStep(3) }} disabled={publishing}
                style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 9, color: T.textMid, cursor: publishing ? 'not-allowed' : 'pointer', opacity: publishing ? 0.5 : 1 }}>
                {'\u2190'} Back
              </button>
              <button onClick={handlePublish} disabled={publishing}
                style={{ padding: '12px 28px', fontSize: 14, fontWeight: 800, background: publishing ? T.borderMid : T.accent, color: publishing ? T.textFaint : 'white', border: 'none', borderRadius: 9, cursor: publishing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                {publishing ? 'Publishing...' : '\uD83D\uDE80 Publish Dataset'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


