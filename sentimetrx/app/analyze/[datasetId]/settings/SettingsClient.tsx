'use client'

// app/analyze/[datasetId]/settings/SettingsClient.tsx
// Schema & Themes page: rename, visibility, schema editor, theme picker, danger zone

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import SchemaEditor from '@/components/analyze/SchemaEditor'
import type { SchemaConfig } from '@/lib/analyzeTypes'
import type { Theme } from '@/lib/themeUtils'
import { THEME_PALETTE } from '@/lib/themeUtils'

interface ThemeModel {
  themes: Theme[]
  themeSource?: string | null
  themeLibName?: string | null
  fieldName?: string | null
  fieldNames?: string[] | null
  [key: string]: unknown
}

interface Props {
  dataset: { id: string; name: string; description: string | null; visibility: string; status: string; row_count: number }
  schema: SchemaConfig
  themeModel: ThemeModel | null
  isOwner: boolean
  datasetId: string
}

var HERMES = '#E8632A'
var T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', greenBg: '#f0fdf4', greenMid: '#bbf7d0',
  red: '#dc2626', redBg: '#fef2f2',
  amber: '#d97706', amberBg: '#fffbeb', amberMid: '#fde68a',
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

export default function SettingsClient({ dataset, schema: initialSchema, themeModel: initialThemes, isOwner, datasetId }: Props) {
  var router = useRouter()

  var [name, setName] = useState(dataset.name)
  var [description, setDescription] = useState(dataset.description || '')
  var [visibility, setVisibility] = useState<'private' | 'public'>(dataset.visibility as any)
  var [schema, setSchema] = useState<SchemaConfig>(initialSchema)
  var [themeModel, setThemeModel] = useState<ThemeModel | null>(initialThemes)
  var [isDirty, setIsDirty] = useState(false)
  var [saving, setSaving] = useState(false)
  var [saved, setSaved] = useState(false)
  var [delConfirm, setDelConfirm] = useState(false)
  var [deleting, setDeleting] = useState(false)
  var [error, setError] = useState('')

  // Industry themes for the picker
  var [industryThemes, setIndustryThemes] = useState<Record<string, Theme[]> | null>(null)
  var [showThemePicker, setShowThemePicker] = useState(false)
  var [checkedInds, setCheckedInds] = useState<Set<string>>(new Set())

  useEffect(function() {
    fetch('/api/industry-themes')
      .then(function(r) { return r.ok ? r.json() : {} })
      .then(function(d) { setIndustryThemes(d) })
      .catch(function() { setIndustryThemes({}) })
  }, [])

  // beforeunload when dirty
  useEffect(function() {
    function handler(e: BeforeUnloadEvent) {
      if (isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return function() { window.removeEventListener('beforeunload', handler) }
  }, [isDirty])

  async function handleSaveDetails() {
    setSaving(true); setError('')
    try {
      var res = await fetch('/api/datasets/' + dataset.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description || null, visibility: visibility }),
      })
      if (!res.ok) { setError('Failed to save details'); return }
      setSaved(true); setIsDirty(false)
      setTimeout(function() { setSaved(false) }, 2000)
      router.refresh()
    } finally { setSaving(false) }
  }

  async function handleSaveSchema(updated: SchemaConfig) {
    setSchema(updated)
    setIsDirty(true)
    await fetch('/api/datasets/' + dataset.id + '/state', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema_config: updated }),
    })
  }

  async function handleSaveThemes(themes: Theme[], libName: string, source: string) {
    var openFields = schema.fields.filter(function(f) { return f.type === 'open-ended' }).map(function(f) { return f.field })
    var tm: ThemeModel = {
      themes: themes,
      themeSource: source,
      themeLibName: libName,
      fieldName: openFields[0] || null,
      fieldNames: openFields,
    }
    setThemeModel(tm)
    setShowThemePicker(false)
    setCheckedInds(new Set())
    setIsDirty(true)
    await fetch('/api/datasets/' + dataset.id + '/state', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme_model: tm }),
    })
  }

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
      ;(industryThemes![l] || []).forEach(function(t) {
        if (!seen.has(t.id)) { seen.add(t.id); merged.push({ ...t, keywords: [...t.keywords] }) }
      })
    })
    handleSaveThemes(merged, Array.from(checkedInds).join(' + '), 'industry')
  }

  async function handleArchive() {
    var newStatus = dataset.status === 'active' ? 'archived' : 'active'
    await fetch('/api/datasets/' + dataset.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    router.refresh()
  }

  async function handleDelete() {
    if (!delConfirm) { setDelConfirm(true); return }
    setDeleting(true)
    var res = await fetch('/api/datasets/' + dataset.id, { method: 'DELETE' })
    if (res.ok) router.push('/analyze')
    else { setError('Delete failed'); setDeleting(false); setDelConfirm(false) }
  }

  var hasThemes = themeModel && themeModel.themes && themeModel.themes.length > 0
  var totalCheckedThemes = industryThemes ? Array.from(checkedInds).reduce(function(sum, l) { return sum + (industryThemes![l] || []).length }, 0) : 0

  return (
    <div style={{ padding: '24px 28px', maxWidth: 800, margin: '0 auto' }}>

      {/* Dirty indicator */}
      {isDirty && (
        <div style={{ position: 'sticky', top: 70, zIndex: 40, marginBottom: 16, padding: '10px 16px', background: T.amberBg, border: '1px solid ' + T.amberMid, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fde68a', boxShadow: '0 0 6px #fde68a' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: T.amber, flex: 1 }}>Unsaved changes</span>
          <button onClick={handleSaveDetails} disabled={saving}
            style={{ padding: '6px 16px', fontSize: 12, fontWeight: 700, background: T.accent, color: 'white', border: 'none', borderRadius: 7, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving...' : 'Save All'}
          </button>
        </div>
      )}

      {/* ── Dataset Details ──────────────────────────────────────────── */}
      <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 14 }}>Dataset Details</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>Name</div>
            <input value={name} onChange={function(e) { setName(e.target.value); setIsDirty(true) }}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid ' + T.border, borderRadius: 8, outline: 'none', color: T.text, background: T.bg }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>Visibility</div>
            <select value={visibility} onChange={function(e) { setVisibility(e.target.value as any); setIsDirty(true) }}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid ' + T.border, borderRadius: 8, outline: 'none', color: T.text, background: T.bg, cursor: 'pointer' }}>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>Description</div>
          <input value={description} onChange={function(e) { setDescription(e.target.value); setIsDirty(true) }}
            style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid ' + T.border, borderRadius: 8, outline: 'none', color: T.text, background: T.bg }} placeholder="Optional" />
        </div>
      </div>

      {/* ── Schema Editor ────────────────────────────────────────────── */}
      <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 14 }}>Schema</h3>
        <SchemaEditor schema={schema} onChange={handleSaveSchema} />
      </div>

      {/* ── Theme Model ──────────────────────────────────────────────── */}
      <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: T.text, margin: 0 }}>Theme Model</h3>
          <button onClick={function() { setShowThemePicker(!showThemePicker) }}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 7, color: T.textMid, cursor: 'pointer' }}>
            {showThemePicker ? 'Cancel' : hasThemes ? 'Change Themes' : 'Choose Themes'}
          </button>
        </div>

        {/* Current themes display */}
        {hasThemes && !showThemePicker && (
          <div>
            {themeModel!.themeLibName && (
              <div style={{ fontSize: 12, color: T.textMute, marginBottom: 10 }}>
                Library: <strong style={{ color: T.accent }}>{themeModel!.themeLibName}</strong>
                {' \u00B7 '}{themeModel!.themes.length} themes
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {themeModel!.themes.map(function(t, i) {
                var pal = THEME_PALETTE[i % THEME_PALETTE.length]
                return (
                  <span key={t.id} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border }}>
                    {t.name}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {!hasThemes && !showThemePicker && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: T.textFaint, fontSize: 13 }}>
            No themes assigned. Choose an industry library or use AI in TextMine.
          </div>
        )}

        {/* Theme picker */}
        {showThemePicker && industryThemes && (
          <div>
            {checkedInds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: T.accentBg, borderRadius: 8, border: '1px solid ' + T.accentMid }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.accent, flex: 1 }}>
                  {checkedInds.size} selected {'\u00B7'} {totalCheckedThemes} themes
                </span>
                <button onClick={applyCheckedThemes}
                  style={{ padding: '5px 14px', fontSize: 11, fontWeight: 700, background: T.accent, color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer' }}>
                  Apply
                </button>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.keys(industryThemes).sort().map(function(ind) {
                var sel = checkedInds.has(ind)
                var icon = INDUSTRY_ICONS[ind] || '\uD83D\uDCCB'
                var count = (industryThemes![ind] || []).length
                return (
                  <button key={ind} onClick={function() { toggleInd(ind) }}
                    style={{ padding: '6px 12px', fontSize: 11, fontWeight: sel ? 700 : 500, borderRadius: 8, background: sel ? T.accentBg : 'white', border: '1.5px solid ' + (sel ? T.accent : T.border), color: sel ? T.accent : T.textMid, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all .12s' }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, border: '1.5px solid ' + (sel ? T.accent : T.borderMid), background: sel ? T.accent : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: 'white' }}>{sel ? '\u2713' : ''}</span>
                    <span>{icon}</span> {ind} <span style={{ fontSize: 10, color: T.textFaint }}>({count})</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Danger Zone ──────────────────────────────────────────────── */}
      {isOwner && (
        <div style={{ background: T.redBg, border: '1px solid ' + T.red + '30', borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: T.red, marginBottom: 10 }}>Danger Zone</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={handleArchive}
              style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, background: 'white', border: '1px solid ' + T.border, borderRadius: 8, color: T.textMid, cursor: 'pointer' }}>
              {dataset.status === 'active' ? 'Archive' : 'Unarchive'}
            </button>
            <button onClick={handleDelete} disabled={deleting}
              style={{ padding: '8px 16px', fontSize: 12, fontWeight: delConfirm ? 700 : 600, background: delConfirm ? T.red : 'white', color: delConfirm ? 'white' : T.red, border: '1px solid ' + T.red + '50', borderRadius: 8, cursor: deleting ? 'not-allowed' : 'pointer' }}>
              {deleting ? 'Deleting...' : delConfirm ? 'Confirm Delete' : 'Delete Dataset'}
            </button>
            {delConfirm && (
              <button onClick={function() { setDelConfirm(false) }}
                style={{ padding: '8px 12px', fontSize: 11, color: T.textMute, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16, padding: '10px 14px', background: T.redBg, border: '1px solid ' + T.red + '30', borderRadius: 8, fontSize: 12, color: T.red }}>{error}</div>
      )}

      {saved && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, padding: '10px 20px', background: T.greenBg, border: '1px solid ' + T.greenMid, borderRadius: 10, fontSize: 13, fontWeight: 700, color: T.green, boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 50 }}>
          {'\u2714'} Saved
        </div>
      )}
    </div>
  )
}
