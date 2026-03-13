'use client'
// components/analyze/textmine/ThemeEditor.tsx
// Modal for creating or editing theme libraries.
// Three entry paths: pick an industry library, build from scratch, paste JSON.
// Apply button returns the edited themes array to parent.

import { useState } from 'react'
import { Theme, THEME_PALETTE, sentColor, sentBg } from '@/lib/themeUtils'

const T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', greenBg: '#f0fdf4',
  red: '#dc2626', amber: '#d97706', amberBg: '#fffbeb',
}

interface InitialData {
  themes: Theme[]
  libName?: string | null
  source?: string | null
}

interface Props {
  onApply: (themes: Theme[], libName: string, source: string) => void
  onClose: () => void
  initialData?: InitialData | null
  industryThemes: Record<string, Theme[]>
}

function OrangeBtn({ children, onClick, disabled, style }: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  style?: React.CSSProperties
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '9px 20px', fontSize: 13, fontWeight: 700,
        background: disabled ? T.borderMid : T.accent,
        color: disabled ? T.textMute : 'white',
        border: 'none', borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background .15s',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', fontSize: 12,
  border: '1px solid ' + T.border, borderRadius: 7,
  background: T.bg, color: T.text, outline: 'none',
}

type Step = 'pick' | 'edit' | 'json'

export default function ThemeEditor({ onApply, onClose, initialData, industryThemes }: Props) {
  const industries = Object.keys(industryThemes).sort()
  const [step, setStep] = useState<Step>(initialData ? 'edit' : 'pick')
  const [baseIndustry, setBaseIndustry] = useState<string | null>(
    initialData?.source === 'industry' ? (initialData.libName || null) : null
  )
  const [editThemes, setEditThemes] = useState<Theme[]>(
    initialData?.themes ? initialData.themes.map(function(t) { return { ...t, keywords: [...t.keywords] } }) : []
  )
  const [libraryName, setLibraryName] = useState(initialData?.libName || '')
  const [expandedTheme, setExpandedTheme] = useState<string | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [isModified, setIsModified] = useState(
    initialData?.source === 'modified-industry' || initialData?.source === 'custom'
  )

  function loadIndustry(ind: string) {
    setBaseIndustry(ind)
    setLibraryName(ind)
    setEditThemes(industryThemes[ind].map(function(t) { return { ...t, keywords: [...t.keywords] } }))
    setIsModified(false)
    setStep('edit')
  }

  function startBlank() {
    setBaseIndustry(null)
    setLibraryName('Custom Library')
    setEditThemes([{ id: 'c1', name: 'New Theme', description: '', keywords: ['keyword'], sentiment: 'mixed', count: 0, percentage: 0, relatedThemes: [] }])
    setStep('edit')
  }

  function parseJsonGroups() {
    setJsonError('')
    try {
      const parsed = JSON.parse(jsonText.trim())
      if (!Array.isArray(parsed)) throw new Error('Expected a JSON array at the top level.')
      const isFullTheme = parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object'
        && !Array.isArray(parsed[0]) && (parsed[0].name || parsed[0].label)
      if (isFullTheme) {
        const themes = parsed.map(function(item: Record<string, unknown>, i: number) {
          const kws = ((item.keywords || item.words || item.terms || []) as unknown[])
            .map(function(k) { return String(k).trim() })
            .filter(Boolean)
          if (!kws.length) throw new Error('Item ' + (i + 1) + ' has no keywords.')
          return {
            id: 'j' + i,
            name: String(item.name || item.label || ('Theme ' + (i + 1))),
            description: String(item.description || ''),
            keywords: kws,
            sentiment: String(item.sentiment || 'mixed'),
            count: 0, percentage: 0, relatedThemes: [],
          }
        })
        setBaseIndustry(null)
        setLibraryName('Custom JSON Themes')
        setEditThemes(themes)
        setStep('edit')
        return
      }
      // Keyword-group mode
      const themes = parsed.map(function(item: unknown, i: number) {
        let kws: string[] = []
        if (Array.isArray(item)) kws = item.map(function(k) { return String(k).trim() }).filter(Boolean)
        else if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>
          kws = ((obj.keywords || obj.words || obj.terms || []) as unknown[])
            .map(function(k) { return String(k).trim() }).filter(Boolean)
        } else throw new Error('Item ' + (i + 1) + ' is not an array or object.')
        if (!kws.length) throw new Error('Item ' + (i + 1) + ' has no keywords.')
        return { id: 'j' + i, name: 'Theme ' + (i + 1), description: '', keywords: kws, sentiment: 'mixed', count: 0, percentage: 0, relatedThemes: [] }
      })
      setBaseIndustry(null)
      setLibraryName('Custom JSON Themes')
      setEditThemes(themes)
      setStep('edit')
    } catch (e: unknown) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  function addTheme() {
    const id = 'c' + Date.now()
    setIsModified(true)
    setEditThemes(function(prev) {
      return [...prev, { id, name: 'New Theme', description: '', keywords: [''], sentiment: 'mixed', count: 0, percentage: 0, relatedThemes: [] }]
    })
    setExpandedTheme(id)
  }

  function removeTheme(id: string) {
    setIsModified(true)
    setEditThemes(function(prev) { return prev.filter(function(t) { return t.id !== id }) })
  }

  function updateTheme(id: string, field: keyof Theme, val: unknown) {
    setIsModified(true)
    setEditThemes(function(prev) {
      return prev.map(function(t) { return t.id === id ? { ...t, [field]: val } : t })
    })
  }

  function addKeyword(id: string) {
    setEditThemes(function(prev) {
      return prev.map(function(t) { return t.id === id ? { ...t, keywords: [...t.keywords, ''] } : t })
    })
  }

  function updateKeyword(id: string, idx: number, val: string) {
    setEditThemes(function(prev) {
      return prev.map(function(t) {
        if (t.id !== id) return t
        const kws = [...t.keywords]
        kws[idx] = val
        return { ...t, keywords: kws }
      })
    })
  }

  function removeKeyword(id: string, idx: number) {
    setEditThemes(function(prev) {
      return prev.map(function(t) {
        if (t.id !== id) return t
        return { ...t, keywords: t.keywords.filter(function(_, i) { return i !== idx }) }
      })
    })
  }

  function handleApply() {
    if (!editThemes.length) return
    const src = baseIndustry && isModified ? 'modified-industry' : baseIndustry ? 'industry' : 'custom'
    onApply(editThemes, libraryName, src)
  }

  const stepTitle = step === 'pick' ? 'Choose a Starting Point'
    : step === 'json' ? 'Paste JSON Themes'
    : 'Edit Theme Library'

  const stepDesc = step === 'pick' ? 'Select an industry library or paste JSON to get started.'
    : step === 'json' ? 'Paste your JSON theme array below.'
    : 'Add, remove, or edit themes and keywords.'

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: T.bgCard, borderRadius: 16, width: 680, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}
        onClick={function(e) { e.stopPropagation() }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid ' + T.border, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: T.text, margin: '0 0 4px' }}>{stepTitle}</h2>
              <p style={{ fontSize: 12, color: T.textMute, margin: 0 }}>{stepDesc}</p>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', fontSize: 20, color: T.textMute, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
            >
              x
            </button>
          </div>
          {step === 'edit' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <input
                value={libraryName}
                onChange={function(e) { setLibraryName(e.target.value) }}
                placeholder="Library name"
                style={{ ...inputStyle, maxWidth: 240 }}
              />
              {baseIndustry && (
                <span style={{ fontSize: 11, padding: '3px 10px', background: T.accentBg, color: T.accent, borderRadius: 20, border: '1px solid ' + T.accentMid, fontWeight: 600 }}>
                  {baseIndustry}{isModified ? ' (modified)' : ''}
                </span>
              )}
              <button
                onClick={function() { setStep('pick') }}
                style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: T.textMute, background: 'transparent', border: '1px solid ' + T.border, borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}
              >
                Change base
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}>

          {/* Step: Pick industry */}
          {step === 'pick' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {industries.map(function(ind) {
                  return (
                    <button
                      key={ind}
                      onClick={function() { loadIndustry(ind) }}
                      style={{
                        padding: '10px 14px', textAlign: 'left', background: T.bg,
                        border: '1px solid ' + T.border, borderRadius: 9, cursor: 'pointer',
                        fontSize: 13, fontWeight: 600, color: T.textMid,
                        transition: 'all .15s',
                      }}
                    >
                      {ind}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid ' + T.border }}>
                <button
                  onClick={startBlank}
                  style={{ flex: 1, padding: '10px', fontSize: 12, fontWeight: 600, background: 'transparent', border: '2px dashed ' + T.borderMid, borderRadius: 9, color: T.textMute, cursor: 'pointer' }}
                >
                  + Start from scratch
                </button>
                <button
                  onClick={function() { setStep('json') }}
                  style={{ flex: 1, padding: '10px', fontSize: 12, fontWeight: 600, background: 'transparent', border: '2px dashed ' + T.borderMid, borderRadius: 9, color: T.textMute, cursor: 'pointer' }}
                >
                  {'{ } Paste JSON'}
                </button>
              </div>
            </div>
          )}

          {/* Step: JSON paste */}
          {step === 'json' && (
            <div>
              <p style={{ fontSize: 12, color: T.textMid, marginBottom: 12, lineHeight: 1.6 }}>
                Paste a JSON array of theme objects or keyword groups. Accepts{' '}
                <code style={{ background: T.bg, padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>
                  [{'{'}name, keywords[]{'}'}]
                </code>{' '}
                or raw keyword arrays.
              </p>
              <textarea
                value={jsonText}
                onChange={function(e) { setJsonText(e.target.value) }}
                rows={10}
                placeholder={'[\n  {"name": "Theme 1", "keywords": ["word1", "word2"]},\n  {"name": "Theme 2", "keywords": ["word3", "word4"]}\n]'}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5, resize: 'vertical', height: 200 }}
              />
              {jsonError && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #dc262630', borderRadius: 7, fontSize: 12, color: T.red }}>
                  {jsonError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={function() { setStep('pick') }} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, background: 'transparent', border: '1px solid ' + T.border, borderRadius: 8, color: T.textMid, cursor: 'pointer' }}>
                  Back
                </button>
                <OrangeBtn onClick={parseJsonGroups} disabled={!jsonText.trim()}>Parse themes</OrangeBtn>
              </div>
            </div>
          )}

          {/* Step: Edit themes */}
          {step === 'edit' && (
            <>
              {editThemes.map(function(t, ti) {
                const pal = THEME_PALETTE[ti % THEME_PALETTE.length]
                const isOpen = expandedTheme === t.id
                return (
                  <div
                    key={t.id}
                    style={{
                      border: '1px solid ' + (isOpen ? pal.border : T.border),
                      borderLeft: '3px solid ' + pal.border,
                      borderRadius: 10, marginBottom: 8,
                      background: isOpen ? pal.bg + '40' : T.bgCard,
                      transition: 'all .15s',
                    }}
                  >
                    {/* Theme row header */}
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
                      onClick={function() { setExpandedTheme(isOpen ? null : t.id) }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, color: pal.text, background: pal.bg, border: '1px solid ' + pal.border + '60', borderRadius: 20, padding: '2px 8px', flexShrink: 0 }}>
                        {ti + 1}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>{t.name || 'Unnamed'}</span>
                      <span style={{ fontSize: 11, color: sentColor(t.sentiment), background: sentBg(t.sentiment), padding: '2px 8px', borderRadius: 20, border: '1px solid ' + sentColor(t.sentiment) + '30', fontWeight: 600 }}>{t.sentiment}</span>
                      <span style={{ fontSize: 11, color: T.textFaint }}>{t.keywords.length} keywords</span>
                      <button
                        onClick={function(e) { e.stopPropagation(); removeTheme(t.id) }}
                        style={{ background: 'transparent', border: 'none', color: T.textFaint, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                      >
                        x
                      </button>
                      <span style={{ fontSize: 10, color: T.textFaint }}>{isOpen ? 'v' : '>'}</span>
                    </div>

                    {/* Expanded edit area */}
                    {isOpen && (
                      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMute, marginBottom: 4 }}>Theme Name</div>
                            <input
                              value={t.name}
                              onChange={function(e) { updateTheme(t.id, 'name', e.target.value) }}
                              style={inputStyle}
                              placeholder="Theme name"
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMute, marginBottom: 4 }}>Sentiment</div>
                            <select
                              value={t.sentiment}
                              onChange={function(e) { updateTheme(t.id, 'sentiment', e.target.value) }}
                              style={{ ...inputStyle, width: 130 }}
                            >
                              {['positive', 'negative', 'mixed', 'neutral'].map(function(s) {
                                return <option key={s} value={s}>{s}</option>
                              })}
                            </select>
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: T.textMute, marginBottom: 4 }}>Description</div>
                          <input
                            value={t.description}
                            onChange={function(e) { updateTheme(t.id, 'description', e.target.value) }}
                            style={inputStyle}
                            placeholder="One sentence describing this theme"
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: T.textMute, marginBottom: 6 }}>
                            Keywords{' '}
                            <span style={{ fontWeight: 400, color: T.textFaint }}>(click x to remove)</span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                            {t.keywords.map(function(kw, ki) {
                              return (
                                <span
                                  key={ki}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 8px', background: pal.bg, color: pal.text, borderRadius: 20, border: '1px solid ' + pal.border + '60' }}
                                >
                                  <input
                                    value={kw}
                                    onChange={function(e) { updateKeyword(t.id, ki, e.target.value) }}
                                    style={{ border: 'none', background: 'transparent', color: pal.text, fontSize: 11, width: Math.max(40, kw.length * 7) + 'px', outline: 'none', fontFamily: 'inherit' }}
                                  />
                                  <button
                                    onClick={function() { removeKeyword(t.id, ki) }}
                                    style={{ background: 'transparent', border: 'none', color: pal.text, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}
                                  >
                                    x
                                  </button>
                                </span>
                              )
                            })}
                            <button
                              onClick={function() { addKeyword(t.id) }}
                              style={{ fontSize: 11, padding: '3px 10px', background: 'transparent', border: '1px dashed ' + T.borderMid, borderRadius: 20, color: T.textMute, cursor: 'pointer' }}
                            >
                              + add keyword
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              <button
                onClick={addTheme}
                style={{ width: '100%', padding: 10, fontSize: 12, fontWeight: 600, background: 'transparent', border: '2px dashed ' + T.borderMid, borderRadius: 10, color: T.textMute, cursor: 'pointer', marginTop: 4 }}
              >
                + Add Theme
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid ' + T.border, display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, background: 'transparent', border: '1px solid ' + T.border, borderRadius: 8, color: T.textMid, cursor: 'pointer' }}
          >
            Cancel
          </button>
          {step === 'edit' && (
            <OrangeBtn onClick={handleApply} disabled={editThemes.length === 0}>
              Apply {editThemes.length} themes
            </OrangeBtn>
          )}
        </div>
      </div>
    </div>
  )
}
