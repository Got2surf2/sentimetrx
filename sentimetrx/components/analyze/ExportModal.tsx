'use client'

// components/analyze/ExportModal.tsx
// PowerPoint export modal — Quick Export or Custom Builder flow.

import { useState, useEffect } from 'react'
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

type Step = 'mode' | 'quick' | 'builder' | 'generating' | 'done'

interface SchemaField { field: string; type: string; label?: string; status?: string; section?: string }
interface Props { datasetId: string; datasetName: string; onClose: () => void }

export default function ExportModal({ datasetId, datasetName, onClose }: Props) {
  const [step,         setStep]         = useState<Step>('mode')
  const [fields,       setFields]       = useState<SchemaField[]>([])
  const [selected,     setSelected]     = useState<Set<string>>(new Set())
  const [audience,     setAudience]     = useState('stakeholder')
  const [instructions, setInstructions] = useState('')
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [fileName,     setFileName]     = useState('')
  const [commentConfig,      setCommentConfig]      = useState<Record<string, { enabled: boolean; slides: number }>>({})
  const [commentAnnotations, setCommentAnnotations] = useState<string[]>([])
  const [commentColorField,  setCommentColorField]  = useState<string>('')

  useEffect(function() {
    fetch('/api/datasets/' + datasetId + '/state')
      .then(function(r) { return r.json() })
      .then(function(d) {
        const f: SchemaField[] = (d.schema_config?.fields || [])
          .filter(function(f: SchemaField) { return EXPORTABLE_TYPES.has(f.type) && f.status !== 'ignored' })
        setFields(f)
        const pre = new Set<string>()
        // Always include open-ended fields
        f.forEach(function(fld) { if (fld.type === 'open-ended') pre.add(fld.field) })
        // Always include psychographic + demographic fields (so they appear in the PPTX)
        f.forEach(function(fld) {
          if (fld.section === 'psychographic' || fld.section === 'demographic') pre.add(fld.field)
        })
        // Fill up to 10 with core categorical/numeric
        f.forEach(function(fld) {
          if ((fld.type === 'categorical' || fld.type === 'numeric') && !fld.section && pre.size < 10) pre.add(fld.field)
        })
        setSelected(pre)
        // Default comment config: all open-ended enabled, 2 slides each
        const defCmt: Record<string, { enabled: boolean; slides: number }> = {}
        f.filter(function(fld: SchemaField) { return fld.type === 'open-ended' }).forEach(function(fld: SchemaField) {
          defCmt[fld.field] = { enabled: true, slides: 2 }
        })
        setCommentConfig(defCmt)
        // Default annotations: all demo/psycho fields
        setCommentAnnotations(f.filter(function(fld: SchemaField) { return fld.section === 'demographic' || fld.section === 'psychographic' }).map(function(fld: SchemaField) { return fld.field }))
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
    setStep('generating')
    const name = datasetName.replace(/[^a-z0-9]/gi, '_').slice(0, 40) + '_report.pptx'
    setFileName(name)
    try {
      const body: any = { fields: fieldsToSend, audience, mode, commentConfig, commentAnnotations, commentColorField }
      if (mode === 'builder' && instructions.trim()) body.instructions = instructions.trim()
      const res = await fetch('/api/datasets/' + datasetId + '/export/pptx', {
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
      const a    = document.createElement('a')
      a.href     = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      setStep('done')
    } catch (e: any) {
      setError(e.message || 'Export failed — try again')
      setStep(mode)
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
        <div style={{ background: S.white, borderRadius: 16, padding: '48px 56px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, boxShadow: '0 24px 64px rgba(0,0,0,.25)', minWidth: 300 }}>
          <LottieLoader size={96} message="Building your PowerPoint…" />
          <p style={{ fontSize: 12, color: S.textFaint, margin: '8px 0 0', textAlign: 'center' }}>
            This can take 20–40 seconds while AI generates insights
          </p>
        </div>
      </div>
    )
  }

  // ── Done state ────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        onClick={onClose}>
        <div style={{ background: S.white, borderRadius: 16, padding: '48px 56px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, boxShadow: '0 24px 64px rgba(0,0,0,.25)', minWidth: 300, maxWidth: 400 }}
          onClick={function(e) { e.stopPropagation() }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: S.greenBg, border: '2px solid ' + S.greenBorder, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
            ✓
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: S.text, marginBottom: 6 }}>Your PowerPoint is ready</div>
            <div style={{ fontSize: 12, color: S.textMute, lineHeight: 1.5 }}>
              <strong style={{ color: S.textMid }}>{fileName}</strong> has downloaded to your device.
            </div>
          </div>
          <button onClick={onClose}
            style={{ width: '100%', padding: '11px 0', fontSize: 13, fontWeight: 700, color: 'white', background: HERMES, border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
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
                {step === 'mode' ? 'Generate PowerPoint' : step === 'quick' ? 'Quick Export' : 'Custom Builder'}
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
            <p style={{ fontSize: 13, color: S.textMute, margin: 0 }}>
              Choose how you'd like to build your PowerPoint deck.
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
                  <AudiencePicker audience={audience} setAudience={setAudience} />
                  <FieldPicker byType={byType} selected={selected} toggleField={toggleField} selectAllType={selectAllType} fields={fields} setSelected={setSelected} />
                  <CommentConfig fields={fields} commentConfig={commentConfig} setCommentConfig={setCommentConfig} commentAnnotations={commentAnnotations} setCommentAnnotations={setCommentAnnotations} commentColorField={commentColorField} setCommentColorField={setCommentColorField} />
                  {error && <ErrorBox message={error} />}
                </>
              )}
            </div>
            <ModalFooter
              disabled={loading || selected.size === 0}
              label={'📊 Generate PowerPoint (' + selected.size + ' fields)'}
              onGenerate={function() { handleGenerate('quick') }}
              onCancel={onClose}
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
                      AI will use your instructions to shape the narrative, slide order, and what to emphasise.
                    </div>
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
                    <FieldPicker byType={byType} selected={selected} toggleField={toggleField} selectAllType={selectAllType} fields={fields} setSelected={setSelected} />
                  </div>
                  <CommentConfig fields={fields} commentConfig={commentConfig} setCommentConfig={setCommentConfig} commentAnnotations={commentAnnotations} setCommentAnnotations={setCommentAnnotations} commentColorField={commentColorField} setCommentColorField={setCommentColorField} />

                  {error && <ErrorBox message={error} />}
                </>
              )}
            </div>
            <ModalFooter
              disabled={loading}
              label="🎯 Build Custom PowerPoint"
              onGenerate={function() { handleGenerate('builder') }}
              onCancel={onClose}
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
}

const SECTION_META: Record<string, { label: string; color: string; desc: string }> = {
  core:           { label: 'Core Questions',        color: '#0F7173', desc: 'Primary research questions' },
  psychographic:  { label: 'Psychographic Profile', color: '#0D2B45', desc: 'Attitudes, values & lifestyle' },
  demographic:    { label: 'Demographics',           color: '#4A6572', desc: 'Audience composition' },
}

function FieldPicker({ byType, selected, toggleField, selectAllType, fields, setSelected }: FieldPickerProps) {
  // Group by section first, then by type within each section
  const bySection: Record<string, any[]> = { core: [], psychographic: [], demographic: [] }
  fields.forEach(function(f: any) {
    const sec = (f.section === 'psychographic' || f.section === 'demographic') ? f.section : 'core'
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

function CommentConfig({
  fields,
  commentConfig,
  setCommentConfig,
  commentAnnotations,
  setCommentAnnotations,
  commentColorField,
  setCommentColorField,
}: {
  fields: SchemaField[]
  commentConfig: Record<string, { enabled: boolean; slides: number }>
  setCommentConfig: (fn: (prev: Record<string, { enabled: boolean; slides: number }>) => Record<string, { enabled: boolean; slides: number }>) => void
  commentAnnotations: string[]
  setCommentAnnotations: (v: string[]) => void
  commentColorField: string
  setCommentColorField: (v: string) => void
}) {
  const openFields  = fields.filter(function(f) { return f.type === 'open-ended' })
  const annotFields = fields.filter(function(f) { return f.section === 'demographic' || f.section === 'psychographic' || (f.type === 'categorical' && !f.section) })

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
        return (
          <div key={f.field} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', marginBottom: 4, borderRadius: 6, border: '1px solid ' + S.border, background: cfg.enabled ? S.accentBg : S.bg }}>
            <input type="checkbox" checked={cfg.enabled} onChange={function() {
              setCommentConfig(function(prev) { return { ...prev, [f.field]: { ...cfg, enabled: !cfg.enabled } } })
            }} style={{ accentColor: HERMES, width: 13, height: 13, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: cfg.enabled ? HERMES : S.textMute, flex: 1, fontWeight: cfg.enabled ? 600 : 400 }}>
              {f.label || f.field}
            </span>
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
              return (
                <button key={f.field} onClick={function() {
                  setCommentAnnotations(active ? commentAnnotations.filter(function(x) { return x !== f.field }) : [...commentAnnotations, f.field])
                }}
                  style={{ padding: '3px 8px', borderRadius: 10, border: '1px solid ' + (active ? HERMES : S.border), background: active ? S.accentBg : S.white, color: active ? HERMES : S.textMute, fontSize: 10, fontWeight: active ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {f.label || f.field}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Color-code cards by field value */}
      {anyEnabled && annotFields.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, color: S.textMute, fontWeight: 600, marginBottom: 5 }}>Color-code cards by:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 }}>
            <button
              onClick={function() { setCommentColorField('') }}
              style={{ padding: '3px 8px', borderRadius: 10, border: '1px solid ' + (commentColorField === '' ? HERMES : S.border), background: commentColorField === '' ? S.accentBg : S.white, color: commentColorField === '' ? HERMES : S.textMute, fontSize: 10, fontWeight: commentColorField === '' ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
              None
            </button>
            {annotFields.slice(0, 8).map(function(f) {
              const active = commentColorField === f.field
              return (
                <button key={f.field} onClick={function() { setCommentColorField(active ? '' : f.field) }}
                  style={{ padding: '3px 8px', borderRadius: 10, border: '1px solid ' + (active ? '#0F7173' : S.border), background: active ? '#e0f2f1' : S.white, color: active ? '#0F7173' : S.textMute, fontSize: 10, fontWeight: active ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {f.label || f.field}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 9, color: S.textFaint, marginTop: 4 }}>Each card's left accent strip will be colored by the selected field's value.</div>
        </div>
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

function ModalFooter({ disabled, label, onGenerate, onCancel }: { disabled: boolean; label: string; onGenerate: () => void; onCancel: () => void }) {
  return (
    <div style={{ borderTop: '1px solid ' + S.border, padding: '12px 20px', display: 'flex', gap: 10, flexShrink: 0, background: S.bg }}>
      <button onClick={onGenerate} disabled={disabled}
        style={{ flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700, color: 'white', background: disabled ? S.textFaint : HERMES, border: 'none', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background .15s' }}>
        {label}
      </button>
      <button onClick={onCancel}
        style={{ padding: '10px 16px', fontSize: 12, fontWeight: 600, color: S.textMid, background: S.white, border: '1px solid ' + S.border, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
        Cancel
      </button>
    </div>
  )
}
