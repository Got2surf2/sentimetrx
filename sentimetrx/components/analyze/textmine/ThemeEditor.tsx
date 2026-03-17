'use client'
// components/analyze/textmine/ThemeEditor.tsx
// Modal for creating or editing theme libraries.
// Three modes: quick-pick industry (multi-select with icons), edit, paste JSON.
// Matches Ana.html's ThemeEditor + industry picker UX.

import { useState } from 'react'
import { Theme, THEME_PALETTE, sentColor, sentBg } from '@/lib/themeUtils'

var T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', greenBg: '#f0fdf4', greenMid: '#bbf7d0',
  red: '#dc2626', amber: '#d97706', amberBg: '#fffbeb', amberMid: '#fde68a',
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

var inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', fontSize: 12,
  border: '1px solid ' + T.border, borderRadius: 7,
  background: T.bg, color: T.text, outline: 'none',
}

type Step = 'pick' | 'edit' | 'json'

export default function ThemeEditor({ onApply, onClose, initialData, industryThemes }: Props) {
  var industries = Object.keys(industryThemes).sort()
  var [step, setStep] = useState<Step>(initialData ? 'edit' : 'pick')
  var [checkedInds, setCheckedInds] = useState<Set<string>>(new Set())
  var [baseIndustry, setBaseIndustry] = useState<string | null>(
    initialData?.source === 'industry' ? (initialData.libName || null) : null
  )
  var [editThemes, setEditThemes] = useState<Theme[]>(
    initialData?.themes ? initialData.themes.map(function(t) { return { ...t, keywords: [...t.keywords] } }) : []
  )
  var [libraryName, setLibraryName] = useState(initialData?.libName || '')
  var [expandedTheme, setExpandedTheme] = useState<string | null>(null)
  var [jsonText, setJsonText] = useState('')
  var [jsonError, setJsonError] = useState('')
  var [isModified, setIsModified] = useState(
    initialData?.source === 'modified-industry' || initialData?.source === 'custom'
  )

  function toggleInd(ind: string) {
    setCheckedInds(function(prev) {
      var n = new Set(prev)
      if (n.has(ind)) n.delete(ind); else n.add(ind)
      return n
    })
  }

  function quickApplyChecked() {
    if (!checkedInds.size) return
    var libs = Array.from(checkedInds)
    var merged: Theme[] = []
    var seen = new Set<string>()
    libs.forEach(function(l) {
      ;(industryThemes[l] || []).forEach(function(t) {
        if (!seen.has(t.id)) { seen.add(t.id); merged.push({ ...t, keywords: [...t.keywords] }) }
      })
    })
    var libNames = libs.map(function(l) { return "'" + l + "'" }).join(' + ')
    onApply(merged, libNames, 'industry')
  }

  function loadIndustryIntoEditor(ind: string) {
    setBaseIndustry(ind)
    setLibraryName(ind)
    setEditThemes(industryThemes[ind].map(function(t) { return { ...t, keywords: [...t.keywords] } }))
    setIsModified(false)
    setStep('edit')
  }

  function loadCheckedIntoEditor() {
    if (!checkedInds.size) return
    var libs = Array.from(checkedInds)
    var merged: Theme[] = []
    var seen = new Set<string>()
    libs.forEach(function(l) {
      ;(industryThemes[l] || []).forEach(function(t) {
        if (!seen.has(t.id)) { seen.add(t.id); merged.push({ ...t, keywords: [...t.keywords] }) }
      })
    })
    setBaseIndustry(libs.join(' + '))
    setLibraryName(libs.join(' + '))
    setEditThemes(merged)
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
      var parsed = JSON.parse(jsonText.trim())
      if (!Array.isArray(parsed)) throw new Error('Expected a JSON array.')
      var hasName = parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object' && (parsed[0].name || parsed[0].label)
      var themes = parsed.map(function(item: any, i: number) {
        var kws: string[] = []
        if (Array.isArray(item)) kws = item.map(String).filter(Boolean)
        else kws = ((item.keywords || item.words || item.terms || []) as unknown[]).map(function(k) { return String(k).trim() }).filter(Boolean)
        if (!kws.length) throw new Error('Item ' + (i + 1) + ' has no keywords.')
        return {
          id: 'j' + i, name: hasName ? String(item.name || item.label || 'Theme ' + (i + 1)) : 'Theme ' + (i + 1),
          description: String(item.description || ''), keywords: kws,
          sentiment: String(item.sentiment || 'mixed'), count: 0, percentage: 0, relatedThemes: [] as string[],
        }
      })
      setBaseIndustry(null)
      setLibraryName('Custom JSON Themes')
      setEditThemes(themes)
      setStep('edit')
    } catch (e: any) {
      setJsonError(e.message || 'Invalid JSON')
    }
  }

  function addTheme() {
    var id = 'c' + Date.now()
    setIsModified(true)
    setEditThemes(function(prev) {
      return [...prev, { id: id, name: 'New Theme', description: '', keywords: [''], sentiment: 'mixed', count: 0, percentage: 0, relatedThemes: [] }]
    })
    setExpandedTheme(id)
  }

  function removeTheme(id: string) {
    setIsModified(true)
    setEditThemes(function(prev) { return prev.filter(function(t) { return t.id !== id }) })
  }

  function updateTheme(id: string, field: string, val: unknown) {
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
        var kws = [...t.keywords]; kws[idx] = val
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
    var src = baseIndustry && isModified ? 'modified-industry' : baseIndustry ? 'industry' : 'custom'
    onApply(editThemes, libraryName, src)
  }

  var totalCheckedThemes = Array.from(checkedInds).reduce(function(sum, l) { return sum + (industryThemes[l] || []).length }, 0)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: T.bgCard, borderRadius: 16, width: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}
        onClick={function(e) { e.stopPropagation() }}>

        {/* ─── Header ──────────────────────────────────────────────── */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid ' + T.border, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: T.text, margin: '0 0 4px' }}>
                {step === 'pick' ? 'Industry Theme Libraries' : step === 'json' ? 'Paste JSON Themes' : 'Edit Theme Library'}
              </h2>
              <p style={{ fontSize: 12, color: T.textMute, margin: 0 }}>
                {step === 'pick' ? 'Select one or more industry libraries. Apply directly or customise first.'
                  : step === 'json' ? 'Paste a JSON array of theme objects or keyword groups.'
                  : 'Add, remove, or edit themes and keywords.'}
              </p>
            </div>
            <button onClick={onClose}
              style={{ background: 'transparent', border: 'none', fontSize: 20, color: T.textMute, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>
              {'\u00D7'}
            </button>
          </div>
          {step === 'edit' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <input value={libraryName} onChange={function(e) { setLibraryName(e.target.value) }}
                placeholder="Library name" style={{ ...inputStyle, maxWidth: 240 }} />
              {baseIndustry && (
                <span style={{ fontSize: 11, padding: '3px 10px', background: T.accentBg, color: T.accent, borderRadius: 20, border: '1px solid ' + T.accentMid, fontWeight: 600 }}>
                  {baseIndustry}{isModified ? ' (modified)' : ''}
                </span>
              )}
              <button onClick={function() { setStep('pick') }}
                style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: T.textMute, background: 'transparent', border: '1px solid ' + T.border, borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}>
                {'\u2190'} Change base
              </button>
            </div>
          )}
          {/* Selection summary bar */}
          {step === 'pick' && checkedInds.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '8px 12px', background: T.accentBg, borderRadius: 8, border: '1px solid ' + T.accentMid }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.accent, flex: 1 }}>
                {checkedInds.size} selected {'\u00B7'} {totalCheckedThemes} themes
              </span>
              <button onClick={loadCheckedIntoEditor}
                style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, background: 'transparent', border: '1px dashed ' + T.accent, borderRadius: 7, color: T.accent, cursor: 'pointer' }}>
                {'\u270E'} Customise...
              </button>
              <button onClick={quickApplyChecked}
                style={{ padding: '5px 14px', fontSize: 11, fontWeight: 700, background: T.accent, color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer' }}>
                Apply {checkedInds.size === 1 ? '1 library' : checkedInds.size + ' libraries'}
              </button>
            </div>
          )}
        </div>

        {/* ─── Body ────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}>

          {/* ── Step: Pick industry (multi-select with icons) ─── */}
          {step === 'pick' && (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {industries.map(function(ind) {
                  var sel = checkedInds.has(ind)
                  var themeCount = (industryThemes[ind] || []).length
                  var icon = INDUSTRY_ICONS[ind] || '\uD83D\uDCCB'
                  return (
                    <button key={ind} onClick={function() { toggleInd(ind) }}
                      style={{
                        padding: '8px 14px', fontSize: 12, fontWeight: sel ? 700 : 500, borderRadius: 10,
                        background: sel ? T.accentBg : 'white',
                        border: '1.5px solid ' + (sel ? T.accent : T.border),
                        color: sel ? T.accent : T.textMid, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 8, transition: 'all .12s',
                        minWidth: 170,
                      }}>
                      <span style={{
                        width: 14, height: 14, borderRadius: 3,
                        border: '1.5px solid ' + (sel ? T.accent : T.borderMid),
                        background: sel ? T.accent : 'transparent',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 8, color: 'white', flexShrink: 0,
                      }}>{sel ? '\u2713' : ''}</span>
                      <span style={{ fontSize: 16 }}>{icon}</span>
                      <span style={{ flex: 1, textAlign: 'left' }}>{ind}</span>
                      <span style={{ fontSize: 10, color: T.textFaint, flexShrink: 0 }}>{themeCount}</span>
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid ' + T.border }}>
                <button onClick={startBlank}
                  style={{ flex: 1, padding: '10px', fontSize: 12, fontWeight: 600, background: 'transparent', border: '2px dashed ' + T.borderMid, borderRadius: 9, color: T.textMute, cursor: 'pointer' }}>
                  + Start from scratch
                </button>
                <button onClick={function() { setStep('json') }}
                  style={{ flex: 1, padding: '10px', fontSize: 12, fontWeight: 600, background: 'transparent', border: '2px dashed ' + T.borderMid, borderRadius: 9, color: T.textMute, cursor: 'pointer' }}>
                  {'{ }'} Paste JSON
                </button>
              </div>
            </div>
          )}

          {/* ── Step: JSON paste ─── */}
          {step === 'json' && (
            <div>
              <textarea value={jsonText} onChange={function(e) { setJsonText(e.target.value) }}
                rows={10} placeholder={'[\n  {"name": "Theme 1", "keywords": ["word1", "word2"]},\n  {"name": "Theme 2", "keywords": ["word3", "word4"]}\n]'}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5, resize: 'vertical', height: 200 }} />
              {jsonError && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #dc262630', borderRadius: 7, fontSize: 12, color: T.red }}>{jsonError}</div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={function() { setStep('pick') }}
                  style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, background: 'transparent', border: '1px solid ' + T.border, borderRadius: 8, color: T.textMid, cursor: 'pointer' }}>
                  Back
                </button>
                <button onClick={parseJsonGroups} disabled={!jsonText.trim()}
                  style={{ padding: '9px 20px', fontSize: 13, fontWeight: 700, background: jsonText.trim() ? T.accent : T.borderMid, color: jsonText.trim() ? 'white' : T.textMute, border: 'none', borderRadius: 8, cursor: jsonText.trim() ? 'pointer' : 'not-allowed' }}>
                  Parse themes
                </button>
              </div>
            </div>
          )}

          {/* ── Step: Edit themes ─── */}
          {step === 'edit' && (
            <div>
              {editThemes.map(function(t, ti) {
                var pal = THEME_PALETTE[ti % THEME_PALETTE.length]
                var isOpen = expandedTheme === t.id
                return (
                  <div key={t.id}
                    style={{ border: '1px solid ' + (isOpen ? pal.border : T.border), borderLeft: '3px solid ' + pal.border, borderRadius: 10, marginBottom: 8, background: isOpen ? pal.bg + '40' : T.bgCard, transition: 'all .15s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
                      onClick={function() { setExpandedTheme(isOpen ? null : t.id) }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: pal.text, background: pal.bg, border: '1px solid ' + pal.border + '60', borderRadius: 20, padding: '2px 8px', flexShrink: 0 }}>{ti + 1}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>{t.name || 'Unnamed'}</span>
                      <span style={{ fontSize: 11, color: sentColor(t.sentiment), background: sentBg(t.sentiment), padding: '2px 8px', borderRadius: 20, border: '1px solid ' + sentColor(t.sentiment) + '30', fontWeight: 600 }}>{t.sentiment}</span>
                      <span style={{ fontSize: 11, color: T.textFaint }}>{t.keywords.length} kw</span>
                      <button onClick={function(e) { e.stopPropagation(); removeTheme(t.id) }}
                        style={{ background: 'transparent', border: 'none', color: T.textFaint, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>{'\u00D7'}</button>
                      <span style={{ fontSize: 10, color: T.textFaint }}>{isOpen ? '\u25B2' : '\u25BC'}</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMute, marginBottom: 4 }}>Theme Name</div>
                            <input value={t.name} onChange={function(e) { updateTheme(t.id, 'name', e.target.value) }} style={inputStyle} placeholder="Theme name" />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: T.textMute, marginBottom: 4 }}>Sentiment</div>
                            <select value={t.sentiment} onChange={function(e) { updateTheme(t.id, 'sentiment', e.target.value) }} style={{ ...inputStyle, width: 130 }}>
                              {['positive', 'negative', 'mixed', 'neutral'].map(function(s) { return <option key={s} value={s}>{s}</option> })}
                            </select>
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: T.textMute, marginBottom: 4 }}>Description</div>
                          <input value={t.description} onChange={function(e) { updateTheme(t.id, 'description', e.target.value) }} style={inputStyle} placeholder="One sentence describing this theme" />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: T.textMute, marginBottom: 6 }}>Keywords</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                            {t.keywords.map(function(kw, ki) {
                              return (
                                <span key={ki} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 8px', background: pal.bg, color: pal.text, borderRadius: 20, border: '1px solid ' + pal.border + '60' }}>
                                  <input value={kw} onChange={function(e) { updateKeyword(t.id, ki, e.target.value) }}
                                    style={{ border: 'none', background: 'transparent', color: pal.text, fontSize: 11, width: Math.max(40, kw.length * 7) + 'px', outline: 'none', fontFamily: 'inherit' }} />
                                  <button onClick={function() { removeKeyword(t.id, ki) }}
                                    style={{ background: 'transparent', border: 'none', color: pal.text, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>{'\u00D7'}</button>
                                </span>
                              )
                            })}
                            <button onClick={function() { addKeyword(t.id) }}
                              style={{ fontSize: 11, padding: '3px 10px', background: 'transparent', border: '1px dashed ' + T.borderMid, borderRadius: 20, color: T.textMute, cursor: 'pointer' }}>
                              + add
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              <button onClick={addTheme}
                style={{ width: '100%', padding: 10, fontSize: 12, fontWeight: 600, background: 'transparent', border: '2px dashed ' + T.borderMid, borderRadius: 10, color: T.textMute, cursor: 'pointer', marginTop: 4 }}>
                + Add Theme
              </button>
            </div>
          )}
        </div>

        {/* ─── Footer ──────────────────────────────────────────────── */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid ' + T.border, display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
          <button onClick={onClose}
            style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, background: 'transparent', border: '1px solid ' + T.border, borderRadius: 8, color: T.textMid, cursor: 'pointer' }}>
            Cancel
          </button>
          {step === 'edit' && (
            <button onClick={handleApply} disabled={editThemes.length === 0}
              style={{ padding: '9px 20px', fontSize: 13, fontWeight: 700, background: editThemes.length ? T.accent : T.borderMid, color: editThemes.length ? 'white' : T.textMute, border: 'none', borderRadius: 8, cursor: editThemes.length ? 'pointer' : 'not-allowed' }}>
              Apply {editThemes.length} themes
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
