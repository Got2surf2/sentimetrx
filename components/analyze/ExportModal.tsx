'use client'

// components/analyze/ExportModal.tsx
// PowerPoint export modal — Quick Export or Custom Builder flow.

import { useState, useEffect } from 'react'
import { useFilters } from '@/components/analyze/FilterContext'
import { serializeFilters, filterCount } from '@/lib/filterUtils'
import LottieLoader from '@/components/ui/LottieLoader'

const HERMES = '#e8622a'

const S = {
  bg:        '#f7f7f8',
  white:     '#ffffff',
  border:    '#e8e8ec',
  text:      '#111827',
  textMid:   '#374151',
  textMute:  '#6b7280',
  textFaint: '#9ca3af',
  accentBg:  '#fff4ef',
  accentMid: '#fcd5c0',
  green:     '#059669',
  greenBg:   '#f0fdf4',
  greenBorder: '#bbf7d0',
}

const TYPE_COLOR: Record<string, string> = {
  'open-ended':  '#2563eb',
  'categorical': '#7c3aed',
  'numeric':     '#16a34a',
  'date':        '#d97706',
}

const TYPE_LABELS: Record<string, string> = {
  'open-ended':  'Open-ended',
  'categorical': 'Categorical',
  'numeric':     'Numeric',
  'date':        'Date',
}

const TYPE_ORDER = ['open-ended', 'categorical', 'numeric', 'date']

const AUDIENCE_OPTIONS = [
  { key: 'executive',   label: 'Executive',   desc: 'Short & high-level — key insights and top quotes' },
  { key: 'stakeholder', label: 'Stakeholder', desc: 'Charts, distributions, field breakdowns' },
  { key: 'full',        label: 'Full Team',   desc: 'Everything — detailed stats, more verbatims' },
]

const EXPORTABLE_TYPES = new Set(['open-ended', 'categorical', 'numeric', 'date'])

type Step   = 'mode' | 'quick' | 'builder' | 'generating' | 'done'
type Format = 'pptx' | 'html'
type ShareState = 'idle' | 'uploading' | 'done' | 'error'

interface SchemaField { field: string; type: string; label?: string; status?: string; section?: string; remapping?: Record<string, number> }
interface Props { datasetId: string; datasetName: string; onClose: () => void }

export default function ExportModal({ datasetId, datasetName, onClose }: Props) {
  const { effectiveFilters: filters } = useFilters()
  const activeFilterCount = filterCount(filters)
  const [step,         setStep]         = useState<Step>('mode')
  const [format,       setFormat]       = useState<Format>('pptx')
  const [fields,       setFields]       = useState<SchemaField[]>([])
  const [fieldCounts,  setFieldCounts]  = useState<Record<string, number>>({})
  const [selected,     setSelected]     = useState<Set<string>>(new Set())
  const [audience,     setAudience]     = useState('stakeholder')
  const [reportTitle,  setReportTitle]  = useState('')
  const [instructions, setInstructions] = useState('')
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [fileName,     setFileName]     = useState('')
  const [blobUrl,      setBlobUrl]      = useState('')
  const [progressMsg,  setProgressMsg]  = useState('Building your presentation…')
  const [commentConfig,      setCommentConfig]      = useState<Record<string, { enabled: boolean; slides: number }>>({})
  const [commentAnnotations, setCommentAnnotations] = useState<string[]>([])
  const [commentColorField,  setCommentColorField]  = useState<string>('')
  const [themes,             setThemes]             = useState<any[]>([])
  const [includeThemeSlides, setIncludeThemeSlides] = useState(true)
  const [impactOEFields,     setImpactOEFields]     = useState<Set<string>>(new Set())
  const [impactScoreFields,  setImpactScoreFields]  = useState<Set<string>>(new Set())
  const [selectedThemeIds,   setSelectedThemeIds]   = useState<Set<string>>(new Set())
  const [aiEnabled,    setAiEnabled]    = useState(false)
  const [shareState,   setShareState]   = useState<ShareState>('idle')
  const [shareUrl,     setShareUrl]     = useState('')
  const [shareExpiry,  setShareExpiry]  = useState('')
  const [shareError,   setShareError]   = useState('')
  const [shareCopied,  setShareCopied]  = useState(false)

  // Read AI toggle from localStorage (syncs with DatasetHeader toggle)
  useEffect(function() {
    try { setAiEnabled(localStorage.getItem('sentimetrx_ai_enabled') === '1') } catch {}
    const interval = setInterval(function() {
      try { setAiEnabled(localStorage.getItem('sentimetrx_ai_enabled') === '1') } catch {}
    }, 2000)
    return function() { clearInterval(interval) }
  }, [])

  useEffect(function() {
    fetch('/api/datasets/' + datasetId + '/state')
      .then(function(r) { return r.json() })
      .then(function(d) {
        const f: SchemaField[] = (d.schema_config?.fields || [])
          .filter(function(f: SchemaField) { return EXPORTABLE_TYPES.has(f.type) && f.status !== 'ignored' })
        setFields(f)
        // Extract nonNull counts from analytics fieldSummaries for all field types
        const counts: Record<string, number> = {}
        const summaries = d.analytics?.fieldSummaries || {}
        f.forEach(function(fld: SchemaField) {
          if (summaries[fld.field] != null) {
            counts[fld.field] = summaries[fld.field].nonNull || 0
          }
        })
        setFieldCounts(counts)
        // Only pre-select fields that have data (or no analytics yet = unknown)
        function fieldHasData(fld: SchemaField): boolean {
          return counts[fld.field] == null || counts[fld.field] > 0
        }
        const pre = new Set<string>()
        f.forEach(function(fld) { if (fld.type === 'open-ended' && fieldHasData(fld)) pre.add(fld.field) })
        f.forEach(function(fld) {
          if ((fld.section === 'psychographic' || fld.section === 'demographic') && fieldHasData(fld)) pre.add(fld.field)
        })
        f.forEach(function(fld) {
          if ((fld.type === 'categorical' || fld.type === 'numeric') && !fld.section && fieldHasData(fld) && pre.size < 10) pre.add(fld.field)
        })
        setSelected(pre)
        const defCmt: Record<string, { enabled: boolean; slides: number }> = {}
        f.filter(function(fld: SchemaField) { return fld.type === 'open-ended' }).forEach(function(fld: SchemaField) {
          const hasData = fieldHasData(fld)
          defCmt[fld.field] = { enabled: hasData, slides: 2 }
        })
        setCommentConfig(defCmt)
        // Default: all OE fields selected for impact analysis
        setImpactOEFields(new Set(f.filter(function(fld: SchemaField) { return fld.type === 'open-ended' && fieldHasData(fld) }).map(function(fld: SchemaField) { return fld.field })))
        setCommentAnnotations(f.filter(function(fld: SchemaField) {
          return (fld.section === 'demographic' || fld.section === 'psychographic') && fieldHasData(fld)
        }).map(function(fld: SchemaField) { return fld.field }))
        // Load themes from theme_model
        const themeList: any[] = d.theme_model?.themes || []
        setThemes(themeList)
        setSelectedThemeIds(new Set(themeList.map(function(t: any) { return t.id })))
      })
      .catch(function() { setError('Could not load dataset fields') })
      .finally(function() { setLoading(false) })
  }, [datasetId])

  function toggleField(f: string) {
    setSelected(function(prev) {
      const next = new Set(prev); next.has(f) ? next.delete(f) : next.add(f); return next
    })
  }

  function selectAllType(type: string) {
    setSelected(function(prev) {
      const next = new Set(prev)
      fields.filter(f => f.type === type).forEach(f => next.add(f.field))
      return next
    })
  }

  async function handleGenerate(mode: 'quick' | 'builder') {
    const fieldsToSend = Array.from(selected)
    if (fieldsToSend.length === 0 && mode === 'quick') { setError('Select at least one field.'); return }
    setError('')
    setBlobUrl('')
    setShareState('idle')
    setShareUrl('')
    setShareExpiry('')
    setShareError('')
    setShareCopied(false)
    setStep('generating')
    const ext  = format === 'html' ? '.html' : '.pptx'
    const name = datasetName.replace(/[^a-z0-9]/gi, '_').slice(0, 40) + '_report' + ext
    setFileName(name)

    // Cycle progress messages while waiting
    const fieldLabels = fieldsToSend.map(function(fk) {
      const f = fields.find(function(f) { return f.field === fk })
      return f?.label || fk
    })
    const msgs = aiEnabled
      ? [
          'Generating Executive Summary…',
          'Running AI analysis…',
          ...fieldLabels.map(function(l, i) { return 'Building slide ' + (i + 3) + ' — ' + l.slice(0, 40) + '…' }),
          'Compiling comment slides…',
          format === 'html' ? 'Finalizing HTML presentation…' : 'Finalizing PowerPoint…',
        ]
      : [
          'Building data slides…',
          ...fieldLabels.map(function(l, i) { return 'Building slide ' + (i + 2) + ' — ' + l.slice(0, 40) + '…' }),
          'Compiling comment slides…',
          format === 'html' ? 'Finalizing HTML presentation…' : 'Finalizing PowerPoint…',
        ]
    let msgIdx = 0
    setProgressMsg(msgs[0])
    const msgInterval = setInterval(function() {
      msgIdx = Math.min(msgIdx + 1, msgs.length - 1)
      setProgressMsg(msgs[msgIdx])
    }, 3500)

    try {
      const body: any = { fields: fieldsToSend, audience, mode, commentConfig, commentAnnotations, commentColorField, includeThemeSlides, selectedThemeIds: Array.from(selectedThemeIds), skipAI: !aiEnabled }
      if (reportTitle.trim()) body.reportTitle = reportTitle.trim()
      if (impactOEFields.size > 0) body.impactOEFields = Array.from(impactOEFields)
      if (impactScoreFields.size > 0) body.impactScoreFields = Array.from(impactScoreFields)
      if (activeFilterCount > 0) body.filters = serializeFilters(filters)
      if (mode === 'builder' && instructions.trim()) body.instructions = instructions.trim()
      const endpoint = format === 'html' ? '/api/datasets/' + datasetId + '/export/html' : '/api/datasets/' + datasetId + '/export/pptx'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Export failed')
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      setBlobUrl(url)
      setStep('done')
    } catch (e: any) {
      setError(e.message || 'Export failed — try again')
      setStep(mode)
    } finally {
      clearInterval(msgInterval)
    }
  }

  const byType: Record<string, SchemaField[]> = {}
  fields.forEach(function(f) {
    if (!byType[f.type]) byType[f.type] = []
    byType[f.type].push(f)
  })

  // ── Generating overlay ────────────────────────────────────────────────────
  if (step === 'generating') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: S.white, borderRadius: 16, padding: '48px 56px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, boxShadow: '0 24px 64px rgba(0,0,0,.25)', width: 400, height: 280 }}>
          <LottieLoader size={96} message="" />
          <div style={{ fontSize: 13, fontWeight: 600, color: S.textMid, textAlign: 'center', width: '100%', height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{progressMsg}</div>
          <p style={{ fontSize: 11, color: S.textFaint, margin: 0, textAlign: 'center', lineHeight: 1.5 }}>
            AI is writing insights for each field.<br />This takes 20–60 seconds.
          </p>
        </div>
      </div>
    )
  }

  // ── Done state ────────────────────────────────────────────────────────────
  const handleShare = async () => {
    if (!blobUrl || shareState === 'uploading') return
    setShareState('uploading')
    setShareError('')
    try {
      const res = await fetch(blobUrl)
      const blob = await res.blob()
      const uploadRes = await fetch('/api/datasets/' + datasetId + '/export/html/share', {
        method: 'POST',
        headers: { 'Content-Type': 'text/html' },
        body: blob,
      })
      if (!uploadRes.ok) {
        const d = await uploadRes.json().catch(() => ({}))
        throw new Error(d.error || 'Upload failed')
      }
      const { url, expiresAt } = await uploadRes.json()
      setShareUrl(url)
      setShareExpiry(new Date(expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))
      setShareState('done')
    } catch (e: any) {
      setShareError(e.message || 'Share failed — check AWS configuration')
      setShareState('error')
    }
  }

  const handleCopyShareUrl = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    } catch {
      // fallback
      const ta = document.createElement('textarea')
      ta.value = shareUrl
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    }
  }

  const handleSaveFile = async () => {
    if (!blobUrl) return
    const suggestedName = fileName
    // Use native File System Access API when available (Chrome / Edge)
    if (typeof (window as any).showSaveFilePicker === 'function') {
      try {
        const fileTypes = format === 'html'
          ? [{ description: 'HTML Presentation', accept: { 'text/html': ['.html'] } }]
          : [{ description: 'PowerPoint Presentation', accept: { 'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'] } }]
        const handle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: fileTypes,
        })
        const response = await fetch(blobUrl)
        const blob = await response.blob()
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
        URL.revokeObjectURL(blobUrl)
        onClose()
        return
      } catch (err: any) {
        if (err.name === 'AbortError') return
        // fall through to anchor fallback
      }
    }
    // Fallback for Firefox / Safari
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = suggestedName
    a.click()
    URL.revokeObjectURL(blobUrl)
    onClose()
  }

  if (step === 'done') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        onClick={function() { if (window.confirm('Discard this file without saving?')) { if (blobUrl) URL.revokeObjectURL(blobUrl); onClose() } }}>
        <div style={{ background: S.white, borderRadius: 16, padding: '40px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, boxShadow: '0 24px 64px rgba(0,0,0,.25)', minWidth: 320, maxWidth: 420 }}
          onClick={function(e) { e.stopPropagation() }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: S.greenBg, border: '2px solid ' + S.greenBorder, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
            ✓
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: S.text, marginBottom: 6 }}>{format === 'html' ? 'Your HTML presentation is ready' : 'Your PowerPoint is ready'}</div>
            <div style={{ fontSize: 12, color: S.textMute, lineHeight: 1.6 }}>
              Click below to choose where to save it.
            </div>
          </div>
          <button onClick={handleSaveFile}
            style={{ width: '100%', padding: '12px 0', fontSize: 13, fontWeight: 700, color: 'white', background: HERMES, border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>💾</span> Save file…
          </button>

          {/* AWS share — HTML only */}
          {format === 'html' && shareState !== 'done' && (
            <button onClick={handleShare} disabled={shareState === 'uploading'}
              style={{ width: '100%', padding: '12px 0', fontSize: 13, fontWeight: 700, color: '#0284c7', background: '#f0f9ff', border: '1.5px solid #bae6fd', borderRadius: 8, cursor: shareState === 'uploading' ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: shareState === 'uploading' ? 0.7 : 1 }}>
              <span style={{ fontSize: 16 }}>{shareState === 'uploading' ? '⏳' : '🔗'}</span>
              {shareState === 'uploading' ? 'Uploading to AWS…' : 'Push to AWS — get shareable link'}
            </button>
          )}
          {shareState === 'error' && (
            <div style={{ width: '100%', fontSize: 11, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 10px', textAlign: 'center', lineHeight: 1.5 }}>
              {shareError}
            </div>
          )}
          {shareState === 'done' && (
            <div style={{ width: '100%', background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>✓</span> Shareable link ready
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>Expires {shareExpiry} · Anyone with this link can view</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input readOnly value={shareUrl}
                  style={{ flex: 1, fontSize: 10, border: '1px solid #d1fae5', borderRadius: 5, padding: '5px 8px', fontFamily: 'monospace', background: 'white', color: '#374151', minWidth: 0 }} />
                <button onClick={handleCopyShareUrl}
                  style={{ flexShrink: 0, padding: '5px 12px', fontSize: 11, fontWeight: 700, color: 'white', background: shareCopied ? '#059669' : '#0284c7', border: 'none', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  {shareCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <button onClick={function() {
            if (window.confirm('Discard this file without saving?')) {
              if (blobUrl) URL.revokeObjectURL(blobUrl)
              onClose()
            }
          }}
            style={{ width: '100%', padding: '10px 0', fontSize: 13, fontWeight: 600, color: S.textMid, background: S.bg, border: '1.5px solid ' + S.border, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
            Done
          </button>
          <button onClick={function() { setStep('mode'); setError('') }}
            style={{ fontSize: 12, color: S.textMute, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
            Generate another version
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <div style={{ background: S.white, borderRadius: 12, width: '100%', maxWidth: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.22)', border: '1px solid ' + S.border, overflow: 'hidden' }}
        onClick={function(e) { e.stopPropagation() }}>

        {/* Header */}
        <div style={{ background: HERMES, padding: '0 0 0 18px', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step !== 'mode' && (
              <button onClick={function() { setStep('mode'); setError('') }}
                style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: 'white', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 4 }}>
                ‹
              </button>
            )}
            <span style={{ fontSize: 16 }}>📊</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'white', letterSpacing: '-.1px' }}>
                {step === 'mode' ? (format === 'html' ? 'Generate HTML Presentation' : 'Generate PowerPoint') : step === 'quick' ? 'Quick Export' : 'Custom Builder'}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.65)', marginTop: 1 }}>{datasetName}</div>
            </div>
          </div>
          <button onClick={onClose}
            style={{ height: 48, width: 48, background: 'transparent', border: 'none', color: 'rgba(255,255,255,.7)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ×
          </button>
        </div>

        {/* ── Mode Selection ─────────────────────────────────────────────────── */}
        {step === 'mode' && (
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Format toggle */}
            <div style={{ display: 'flex', gap: 0, border: '1.5px solid ' + S.border, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
              {(['pptx', 'html'] as Format[]).map(function(f) {
                const active = format === f
                return (
                  <button key={f} onClick={function() { setFormat(f) }}
                    style={{ flex: 1, padding: '9px 0', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: active ? HERMES : S.white, color: active ? 'white' : S.textMute, transition: 'all .12s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    {f === 'pptx' ? '📊 PowerPoint (.pptx)' : '🌐 HTML Presentation (.html)'}
                  </button>
                )
              })}
            </div>
            {format === 'html' && (
              <div style={{ fontSize: 11, color: S.textMute, background: S.bg, border: '1px solid ' + S.border, borderRadius: 6, padding: '7px 10px', lineHeight: 1.5 }}>
                Interactive Reveal.js slides with live Plotly charts. Open in any browser — no software needed. Requires internet to load slide framework.
              </div>
            )}

            <p style={{ fontSize: 13, color: S.textMute, margin: 0 }}>
              Choose how you'd like to build your {format === 'html' ? 'HTML presentation' : 'PowerPoint deck'}.
            </p>

            {/* Quick Export card */}
            <button onClick={function() { setStep('quick') }}
              style={{ width: '100%', textAlign: 'left', padding: '18px 20px', borderRadius: 10, border: '1.5px solid ' + S.border, background: S.bg, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s' }}
              onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.borderColor = HERMES; (e.currentTarget as HTMLElement).style.background = S.accentBg }}
              onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.borderColor = S.border; (e.currentTarget as HTMLElement).style.background = S.bg }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>⚡</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: S.text, marginBottom: 5 }}>Quick Export</div>
                  <div style={{ fontSize: 12, color: S.textMute, lineHeight: 1.6 }}>
                    Auto-analyze your selected fields. AI generates executive insights, chart slides, and a summary — all in one click.
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: HERMES, fontWeight: 600 }}>Best for: fast readouts, standard reports →</div>
                </div>
              </div>
            </button>

            {/* Custom Builder card */}
            <button onClick={function() { setStep('builder') }}
              style={{ width: '100%', textAlign: 'left', padding: '18px 20px', borderRadius: 10, border: '1.5px solid ' + S.border, background: S.bg, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s' }}
              onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.borderColor = HERMES; (e.currentTarget as HTMLElement).style.background = S.accentBg }}
              onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.borderColor = S.border; (e.currentTarget as HTMLElement).style.background = S.bg }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>🎯</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: S.text, marginBottom: 5 }}>Custom Builder</div>
                  <div style={{ fontSize: 12, color: S.textMute, lineHeight: 1.6 }}>
                    Tell AI exactly what story you want to tell — which metrics to highlight, which comparisons to draw, what the audience cares about.
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: HERMES, fontWeight: 600 }}>Best for: bespoke decks, client presentations →</div>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* ── Quick Export ───────────────────────────────────────────────────── */}
        {step === 'quick' && (
          <>
            <div style={{ overflowY: 'auto', flex: 1, padding: '18px 20px' }}>
              {loading ? (
                <LottieLoader size={80} message="Loading fields…" />
              ) : (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>Report title (optional)</div>
                    <input type="text" value={reportTitle} onChange={function(e) { setReportTitle(e.target.value) }}
                      placeholder={datasetName + ' Report'}
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <AudiencePicker audience={audience} setAudience={setAudience} />
                  <FieldPicker byType={byType} selected={selected} toggleField={toggleField} selectAllType={selectAllType} fields={fields} setSelected={setSelected} fieldCounts={fieldCounts} />
                  <ThemePicker themes={themes} includeThemeSlides={includeThemeSlides} setIncludeThemeSlides={setIncludeThemeSlides} selectedThemeIds={selectedThemeIds} setSelectedThemeIds={setSelectedThemeIds} />
                  {audience === 'full' && <ImpactFieldPicker fields={fields} impactOEFields={impactOEFields} setImpactOEFields={setImpactOEFields} impactScoreFields={impactScoreFields} setImpactScoreFields={setImpactScoreFields} />}
                  <CommentConfig fields={fields} fieldCounts={fieldCounts} commentConfig={commentConfig} setCommentConfig={setCommentConfig} commentAnnotations={commentAnnotations} setCommentAnnotations={setCommentAnnotations} commentColorField={commentColorField} setCommentColorField={setCommentColorField} />
                  {error && <ErrorBox message={error} />}
                </>
              )}
            </div>
            <ModalFooter
              disabled={loading || selected.size === 0}
              label={(format === 'html' ? '🌐 Generate HTML Presentation' : '📊 Generate PowerPoint') + ' (' + selected.size + ' fields)'}
              onGenerate={function() { handleGenerate('quick') }}
              onCancel={onClose}
              aiOff={!aiEnabled}
            />
          </>
        )}

        {/* ── Custom Builder ─────────────────────────────────────────────────── */}
        {step === 'builder' && (
          <>
            <div style={{ overflowY: 'auto', flex: 1, padding: '18px 20px' }}>
              {loading ? (
                <LottieLoader size={80} message="Loading fields…" />
              ) : (
                <>
                  {/* Instructions */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: S.textFaint, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                      Your Instructions
                    </div>
                    <textarea
                      value={instructions}
                      onChange={function(e) { setInstructions(e.target.value) }}
                      placeholder={'Describe exactly what you want in the deck.\n\nExamples:\n• "Focus on satisfaction by hotel brand — highlight the gap between top and bottom performers"\n• "Show NPS breakdown, pull top 3 themes from open-ended feedback, and add a slide on demographics"\n• "Executive summary only — 3 slides max, no charts, just the key numbers"'}
                      style={{ width: '100%', minHeight: 160, padding: '12px 14px', fontSize: 12, fontFamily: 'inherit', color: S.text, background: S.bg, border: '1.5px solid ' + S.border, borderRadius: 8, resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box', outline: 'none' }}
                      onFocus={function(e) { e.target.style.borderColor = HERMES }}
                      onBlur={function(e) { e.target.style.borderColor = S.border }}
                    />
                    <div style={{ fontSize: 10, color: S.textFaint, marginTop: 4 }}>
                      AI will use your instructions to shape the narrative, slide order, and what to emphasize.
                    </div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>Report title (optional)</div>
                    <input type="text" value={reportTitle} onChange={function(e) { setReportTitle(e.target.value) }}
                      placeholder={datasetName + ' Report'}
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }} />
                  </div>

                  <AudiencePicker audience={audience} setAudience={setAudience} />

                  {/* Field selector — collapsible, secondary */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: S.textFaint, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Fields to Include <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional — defaults to all)</span></span>
                      <button onClick={function() { setSelected(new Set(fields.map(f => f.field))) }}
                        style={{ fontSize: 11, color: HERMES, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
                        Select all
                      </button>
                    </div>
                    <FieldPicker byType={byType} selected={selected} toggleField={toggleField} selectAllType={selectAllType} fields={fields} setSelected={setSelected} fieldCounts={fieldCounts} />
                  </div>
                  <ThemePicker themes={themes} includeThemeSlides={includeThemeSlides} setIncludeThemeSlides={setIncludeThemeSlides} selectedThemeIds={selectedThemeIds} setSelectedThemeIds={setSelectedThemeIds} />
                  {audience === 'full' && <ImpactFieldPicker fields={fields} impactOEFields={impactOEFields} setImpactOEFields={setImpactOEFields} impactScoreFields={impactScoreFields} setImpactScoreFields={setImpactScoreFields} />}
                  <CommentConfig fields={fields} fieldCounts={fieldCounts} commentConfig={commentConfig} setCommentConfig={setCommentConfig} commentAnnotations={commentAnnotations} setCommentAnnotations={setCommentAnnotations} commentColorField={commentColorField} setCommentColorField={setCommentColorField} />

                  {error && <ErrorBox message={error} />}
                </>
              )}
            </div>
            <ModalFooter
              disabled={loading}
              label={format === 'html' ? '🌐 Build Custom HTML Presentation' : '🎯 Build Custom PowerPoint'}
              onGenerate={function() { handleGenerate('builder') }}
              onCancel={onClose}
              aiOff={!aiEnabled}
            />
          </>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AudiencePicker({ audience, setAudience }: { audience: string; setAudience: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: S.textFaint, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Target Audience</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {AUDIENCE_OPTIONS.map(function(opt) {
          const active = audience === opt.key
          return (
            <button key={opt.key} onClick={function() { setAudience(opt.key) }}
              style={{ flex: 1, padding: '9px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', border: '1.5px solid ' + (active ? HERMES : S.border), background: active ? S.accentBg : S.bg, transition: 'all .12s' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: active ? HERMES : S.textMid, marginBottom: 2 }}>{opt.label}</div>
              <div style={{ fontSize: 10, color: S.textMute, lineHeight: 1.4 }}>{opt.desc}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface FieldPickerProps {
  byType: Record<string, any[]>
  selected: Set<string>
  toggleField: (f: string) => void
  selectAllType: (t: string) => void
  fields: any[]
  setSelected: (fn: (prev: Set<string>) => Set<string>) => void
  fieldCounts: Record<string, number>
}

const SECTION_META: Record<string, { label: string; color: string; desc: string }> = {
  core:           { label: 'Core Questions',        color: '#0F7173', desc: 'Primary research questions' },
  psychographic:  { label: 'Psychographic Profile', color: '#0D2B45', desc: 'Attitudes, values & lifestyle' },
  demographic:    { label: 'Demographics',           color: '#4A6572', desc: 'Audience composition' },
}

function FieldPicker({ byType, selected, toggleField, selectAllType, fields, setSelected, fieldCounts }: FieldPickerProps) {
  // For categorical/demo/psycho sections: hide fields confirmed to have 0 data
  function hasData(f: any): boolean {
    if (f.type === 'open-ended') return true  // open-ended filtered in CommentConfig instead
    if (fieldCounts[f.field] == null) return true   // no analytics yet → show
    return fieldCounts[f.field] > 0
  }

  // Group by section first, then by type within each section
  const bySection: Record<string, any[]> = { core: [], psychographic: [], demographic: [] }
  fields.forEach(function(f: any) {
    const sec = (f.section === 'psychographic' || f.section === 'demographic') ? f.section : 'core'
    // Hide zero-data categorical/demo/psycho fields
    if ((sec === 'psychographic' || sec === 'demographic' || f.type === 'categorical') && !hasData(f)) return
    bySection[sec].push(f)
  })

  const sectionOrder = ['core', 'psychographic', 'demographic'].filter(s => bySection[s].length > 0)

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: S.textFaint, textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Fields to Include
          {selected.size > 0 && (
            <span style={{ marginLeft: 7, padding: '1px 7px', borderRadius: 20, background: S.accentBg, color: HERMES, border: '1px solid ' + S.accentMid, fontSize: 10, fontWeight: 700 }}>
              {selected.size}
            </span>
          )}
        </div>
        <button onClick={function() { setSelected(function() { return new Set(fields.map((f: any) => f.field)) }) }}
          style={{ fontSize: 11, color: HERMES, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
          Select all
        </button>
      </div>

      {sectionOrder.map(function(section) {
        const secFields = bySection[section]
        const meta = SECTION_META[section]
        return (
          <div key={section} style={{ marginBottom: 14 }}>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5, paddingBottom: 5, borderBottom: '1.5px solid ' + S.border }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color, display: 'inline-block' }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '.06em' }}>{meta.label}</span>
                <span style={{ fontSize: 10, color: S.textFaint }}>· {meta.desc}</span>
              </div>
              <button onClick={function() { setSelected(function(prev) { const next = new Set(prev); secFields.forEach(function(f: any) { next.add(f.field) }); return next }) }}
                style={{ fontSize: 10, color: S.textFaint, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                All
              </button>
            </div>
            {/* Fields within this section, sub-grouped by type */}
            {TYPE_ORDER.filter(t => secFields.some((f: any) => f.type === t)).map(function(type) {
              const tc = TYPE_COLOR[type]
              const typeFields = secFields.filter((f: any) => f.type === type)
              return (
                <div key={type} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 9, color: tc, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3, paddingLeft: 2 }}>
                    {TYPE_LABELS[type]}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {typeFields.map(function(f: any) {
                      const checked = selected.has(f.field)
                      return (
                        <label key={f.field}
                          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 10px', borderRadius: 6, border: '1px solid ' + (checked ? HERMES : S.border), background: checked ? S.accentBg : S.white, cursor: 'pointer', transition: 'all .1s' }}>
                          <input type="checkbox" checked={checked} onChange={function() { toggleField(f.field) }}
                            style={{ accentColor: HERMES, width: 13, height: 13, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: checked ? 600 : 400, color: checked ? HERMES : S.textMid, flex: 1 }}>
                            {f.label || f.field}
                          </span>
                          {f.section && f.section !== 'core' && (
                            <span style={{ fontSize: 9, color: meta.color, background: meta.color + '18', padding: '1px 5px', borderRadius: 8, fontWeight: 600 }}>
                              {f.section === 'psychographic' ? 'psycho' : 'demo'}
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function ImpactFieldPicker({ fields, impactOEFields, setImpactOEFields, impactScoreFields, setImpactScoreFields }: {
  fields: SchemaField[]
  impactOEFields: Set<string>
  setImpactOEFields: (v: Set<string>) => void
  impactScoreFields: Set<string>
  setImpactScoreFields: (v: Set<string>) => void
}) {
  const oeFields = fields.filter(function(f) { return f.type === 'open-ended' })
  const numFields = fields.filter(function(f) { return f.type === 'numeric' || (f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length >= 3) })
  if (oeFields.length === 0 || numFields.length === 0) return null

  return (
    <div style={{ marginBottom: 12, padding: '12px 14px', background: '#FAFBFC', border: '1px solid #e5e7eb', borderRadius: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>
        Key Driver Analysis
        <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6, color: '#9ca3af' }}>Full team report only</span>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Outcome variables (score fields):</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {numFields.map(function(f) {
            const active = impactScoreFields.has(f.field)
            return (
              <button key={f.field} type="button"
                onClick={function() {
                  var next = new Set(impactScoreFields)
                  if (active) next.delete(f.field); else next.add(f.field)
                  setImpactScoreFields(next)
                }}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                  background: active ? '#F0FDF4' : '#f4f5f7', color: active ? '#15803D' : '#9ca3af',
                  border: '1px solid ' + (active ? '#86EFAC' : '#e5e7eb'),
                }}>
                {active ? '✓ ' : ''}{f.label || f.field}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Open-ended predictor fields:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {oeFields.map(function(f) {
            const active = impactOEFields.has(f.field)
            return (
              <button key={f.field} type="button"
                onClick={function() {
                  var next = new Set(impactOEFields)
                  if (active) next.delete(f.field); else next.add(f.field)
                  setImpactOEFields(next)
                }}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                  background: active ? '#EFF6FF' : '#f4f5f7', color: active ? '#1E40AF' : '#9ca3af',
                  border: '1px solid ' + (active ? '#93C5FD' : '#e5e7eb'),
                }}>
                {active ? '✓ ' : ''}{f.label || f.field}
              </button>
            )
          })}
        </div>
      </div>

      {(impactOEFields.size === 0 || impactScoreFields.size === 0) && (
        <div style={{ fontSize: 10, color: '#9ca3af', fontStyle: 'italic', marginTop: 6 }}>Select at least one outcome and one predictor — or leave empty to skip Key Driver slides</div>
      )}
    </div>
  )
}

function CommentConfig({
  fields,
  fieldCounts,
  commentConfig,
  setCommentConfig,
  commentAnnotations,
  setCommentAnnotations,
  commentColorField,
  setCommentColorField,
}: {
  fields: SchemaField[]
  fieldCounts: Record<string, number>
  commentConfig: Record<string, { enabled: boolean; slides: number }>
  setCommentConfig: (fn: (prev: Record<string, { enabled: boolean; slides: number }>) => Record<string, { enabled: boolean; slides: number }>) => void
  commentAnnotations: string[]
  setCommentAnnotations: (v: string[]) => void
  commentColorField: string
  setCommentColorField: (v: string) => void
}) {
  // Only show open-ended fields that have responses (or no analytics yet)
  const openFields  = fields.filter(function(f) {
    if (f.type !== 'open-ended') return false
    return fieldCounts[f.field] == null || fieldCounts[f.field] > 0
  })
  // Annotation/color fields: hide any confirmed to have 0 data
  function hasCatData(f: SchemaField): boolean {
    return fieldCounts[f.field] == null || fieldCounts[f.field] > 0
  }
  function annotSectionOrder(f: SchemaField): number {
    if (f.section === 'demographic') return 0
    if (!f.section) return 1  // categorical no section
    return 2  // psychographic
  }
  function annotColor(f: SchemaField): string {
    if (f.section === 'demographic') return '#0F7173'
    if (f.section === 'psychographic') return '#E8622A'
    return '#6b7280'
  }
  const annotFields = fields.filter(function(f) {
    return (f.section === 'demographic' || f.section === 'psychographic' || (f.type === 'categorical' && !f.section)) && hasCatData(f)
  }).sort(function(a, b) { return annotSectionOrder(a) - annotSectionOrder(b) })
  const colorFields = fields.filter(function(f) {
    return (f.section === 'demographic' || f.section === 'psychographic' || f.type === 'categorical' || f.type === 'numeric') && hasCatData(f)
  }).sort(function(a, b) { return annotSectionOrder(a) - annotSectionOrder(b) })

  if (openFields.length === 0) return null

  const anyEnabled = openFields.some(function(f) { return (commentConfig[f.field] || { enabled: true }).enabled })

  return (
    <div style={{ marginBottom: 14, border: '1.5px solid #0F717330', borderRadius: 10, padding: '14px 14px 10px', background: '#f0fdf480' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 14 }}>💬</span>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0F7173', flex: 1 }}>Comment Slides</div>
        <span style={{ fontSize: 10, color: S.textFaint }}>Verbatim response cards per open-ended field</span>
      </div>

      {/* Open-ended fields — enabled + slide count */}
      {openFields.map(function(f) {
        const cfg = commentConfig[f.field] || { enabled: true, slides: 2 }
        const cnt = fieldCounts[f.field]
        return (
          <div key={f.field} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', marginBottom: 4, borderRadius: 6, border: '1px solid ' + S.border, background: cfg.enabled ? S.accentBg : S.bg }}>
            <input type="checkbox" checked={cfg.enabled} onChange={function() {
              setCommentConfig(function(prev) { return { ...prev, [f.field]: { ...cfg, enabled: !cfg.enabled } } })
            }} style={{ accentColor: HERMES, width: 13, height: 13, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: cfg.enabled ? HERMES : S.textMute, flex: 1, fontWeight: cfg.enabled ? 600 : 400 }}>
              {f.label || f.field}
            </span>
            {cnt !== undefined && (
              <span style={{ fontSize: 10, color: S.textFaint, background: S.bg, border: '1px solid ' + S.border, borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>
                {cnt} {cnt === 1 ? 'response' : 'responses'}
              </span>
            )}
            {cfg.enabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: S.textFaint }}>slides:</span>
                {[1, 2, 3].map(function(n) {
                  return (
                    <button key={n} onClick={function() { setCommentConfig(function(prev) { return { ...prev, [f.field]: { ...cfg, slides: n } } }) }}
                      style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid ' + (cfg.slides === n ? HERMES : S.border), background: cfg.slides === n ? HERMES : S.white, color: cfg.slides === n ? 'white' : S.textMid, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {n}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* Annotation fields for comment cards */}
      {anyEnabled && annotFields.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, color: S.textMute, fontWeight: 600, marginBottom: 5 }}>Show as tags on each card:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 }}>
            {annotFields.slice(0, 12).map(function(f) {
              const active = commentAnnotations.includes(f.field)
              const ac = annotColor(f)
              return (
                <button key={f.field} onClick={function() {
                  setCommentAnnotations(active ? commentAnnotations.filter(function(x) { return x !== f.field }) : [...commentAnnotations, f.field])
                }}
                  style={{ padding: '3px 8px', borderRadius: 10, border: '1px solid ' + (active ? ac : S.border), background: active ? ac + '15' : S.white, color: active ? ac : S.textMute, fontSize: 10, fontWeight: active ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {f.label || f.field}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Color-code cards by field value */}
      {anyEnabled && colorFields.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, color: S.textMute, fontWeight: 600, marginBottom: 5 }}>Color-code cards by:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 }}>
            <button
              onClick={function() { setCommentColorField('') }}
              style={{ padding: '3px 8px', borderRadius: 10, border: '1px solid ' + (commentColorField === '' ? HERMES : S.border), background: commentColorField === '' ? S.accentBg : S.white, color: commentColorField === '' ? HERMES : S.textMute, fontSize: 10, fontWeight: commentColorField === '' ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
              None
            </button>
            {colorFields.slice(0, 10).map(function(f) {
              const active = commentColorField === f.field
              const isNum  = f.type === 'numeric'
              const ac = annotColor(f)
              return (
                <button key={f.field} onClick={function() { setCommentColorField(active ? '' : f.field) }}
                  style={{ padding: '3px 8px', borderRadius: 10, border: '1px solid ' + (active ? ac : S.border), background: active ? ac + '15' : S.white, color: active ? ac : S.textMute, fontSize: 10, fontWeight: active ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {f.label || f.field}{isNum ? ' 🔢' : ''}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 9, color: S.textFaint, marginTop: 4 }}>Each card's left accent strip is colored by the field value. Numeric fields use a green→red gradient.</div>
        </div>
      )}
    </div>
  )
}

// ── Sentiment helpers (matches TextMine) ─────────────────────────────────────
const SENT_BG:    Record<string, string> = { positive: '#f0fdf4', negative: '#fef2f2', mixed: '#fffbeb', neutral: '#f4f7f8' }
const SENT_COLOR: Record<string, string> = { positive: '#059669', negative: '#dc2626', mixed: '#d97706', neutral: '#6b7280' }

// Deterministic theme color palette (mirrors TextMine THEME_PALETTE borders)
const THEME_COLORS = ['#0F7173','#E8B84B','#7C3AED','#059669','#E85A1A','#0891B2','#DB2777','#65A30D','#9333EA','#D97706']

function ThemePicker({
  themes, includeThemeSlides, setIncludeThemeSlides, selectedThemeIds, setSelectedThemeIds,
}: {
  themes: any[]
  includeThemeSlides: boolean
  setIncludeThemeSlides: (v: boolean) => void
  selectedThemeIds: Set<string>
  setSelectedThemeIds: (fn: (prev: Set<string>) => Set<string>) => void
}) {
  if (themes.length === 0) return null

  const sortedThemes = [...themes].sort(function(a: any, b: any) { return (b.count || 0) - (a.count || 0) })

  function toggleTheme(id: string) {
    setSelectedThemeIds(function(prev) {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div style={{ marginBottom: 14, border: '1.5px solid #0D2B4530', borderRadius: 10, padding: '14px 14px 12px', background: '#f8fafc' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 14 }}>🎯</span>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0D2B45', flex: 1 }}>Theme Slides</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeThemeSlides} onChange={function(e) { setIncludeThemeSlides(e.target.checked) }}
            style={{ accentColor: HERMES, width: 13, height: 13 }} />
          <span style={{ fontSize: 11, color: S.textMid, fontWeight: 600 }}>Include in deck</span>
        </label>
      </div>

      {includeThemeSlides && (
        <>
          <div style={{ fontSize: 10, color: S.textFaint, marginBottom: 8 }}>
            Select which themes to include — {selectedThemeIds.size} of {themes.length} selected
          </div>
          {/* Select all / none */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button onClick={function() { setSelectedThemeIds(function() { return new Set(sortedThemes.map(function(t: any) { return t.id })) }) }}
              style={{ fontSize: 10, color: HERMES, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, padding: 0 }}>
              All
            </button>
            <span style={{ fontSize: 10, color: S.textFaint }}>·</span>
            <button onClick={function() { setSelectedThemeIds(function() { return new Set() }) }}
              style={{ fontSize: 10, color: S.textFaint, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              None
            </button>
          </div>
          {/* Theme cards grid — sorted by frequency */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {sortedThemes.map(function(t: any, idx: number) {
              const color   = t.color || THEME_COLORS[idx % THEME_COLORS.length]
              const checked = selectedThemeIds.has(t.id)
              const sent    = t.sentiment || 'neutral'
              return (
                <div key={t.id} onClick={function() { toggleTheme(t.id) }}
                  style={{ border: '2px solid ' + (checked ? color : S.border), borderRadius: 10, padding: '10px 12px', cursor: 'pointer', background: checked ? color + '0D' : S.white, transition: 'all .12s', position: 'relative' }}>
                  {/* Checked indicator */}
                  {checked && (
                    <div style={{ position: 'absolute', top: 7, right: 8, width: 16, height: 16, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: 'white', fontSize: 9, fontWeight: 900 }}>✓</span>
                    </div>
                  )}
                  {/* Color dot + sentiment */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 20, background: SENT_BG[sent] || SENT_BG.neutral, color: SENT_COLOR[sent] || SENT_COLOR.neutral, fontWeight: 700, textTransform: 'capitalize' as const }}>{sent}</span>
                  </div>
                  {/* Name */}
                  <div style={{ fontSize: 12, fontWeight: 800, color: S.text, marginBottom: 3, lineHeight: 1.3 }}>{t.name}</div>
                  {/* Description */}
                  {t.description && (
                    <div style={{ fontSize: 10, color: S.textMute, lineHeight: 1.4, marginBottom: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>
                      {t.description}
                    </div>
                  )}
                  {/* Keywords */}
                  {(t.keywords || []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 3, marginBottom: 6 }}>
                      {(t.keywords as string[]).slice(0, 3).map(function(k: string) {
                        return <span key={k} style={{ fontSize: 9, padding: '1px 5px', background: S.bg, color: S.textFaint, borderRadius: 20, border: '1px solid ' + S.border }}>{k}</span>
                      })}
                    </div>
                  )}
                  {/* Count / % */}
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderTop: '1px solid ' + S.border, paddingTop: 6 }}>
                    <span style={{ fontSize: 10, color: S.textFaint }}>n={t.count || 0}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: color }}>{Math.round(t.percentage || 0)}%</span>
                  </div>
                  {/* Mini bar */}
                  <div style={{ height: 3, background: S.border, borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: Math.round(t.percentage || 0) + '%', background: color, borderRadius: 2 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 7, padding: '8px 12px', marginBottom: 8 }}>
      {message}
    </div>
  )
}

function ModalFooter({ disabled, label, onGenerate, onCancel, aiOff }: { disabled: boolean; label: string; onGenerate: () => void; onCancel: () => void; aiOff?: boolean }) {
  return (
    <div style={{ borderTop: '1px solid ' + S.border, padding: '12px 20px', flexShrink: 0, background: S.bg }}>
      {aiOff && (
        <div style={{ marginBottom: 8, padding: '7px 12px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, fontSize: 11, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>{'\u26A0\uFE0F'}</span>
          <span><strong>AI is off.</strong> Export will use data-only charts and auto-generated text — no AI narratives, summaries, or smart quotes. Turn on AI in the header to enable full reports.</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onGenerate} disabled={disabled}
          style={{ flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700, color: 'white', background: disabled ? S.textFaint : HERMES, border: 'none', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background .15s' }}>
          {label}
        </button>
        <button onClick={onCancel}
          style={{ padding: '10px 16px', fontSize: 12, fontWeight: 600, color: S.textMid, background: S.white, border: '1px solid ' + S.border, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
