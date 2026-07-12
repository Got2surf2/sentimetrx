'use client'

import { useState, useEffect } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import { INDUSTRY_LABELS, type Industry } from '@/lib/industryDefaults'
import { DEMO_BANK } from '@/lib/types'

interface Props {
  userEmail: string
  logoUrl?: string
  orgName?: string
  fullName?: string
}

type Tab = 'demographics' | 'psychographic' | 'structured' | 'open_ended'

interface PsychographicQ {
  industry: string; industryLabel: string; prompt: string; responses: string[]
  id?: string; custom?: true
}
interface StructuredQ {
  industry: string; industryLabel: string; key: string; prompt: string; exportLabel: string; type: string; options: string[]
}
interface OpenEndedQ {
  industry: string; industryLabel: string; prompt: string; triggerType: string
  keywordTriggers: { priority: number; keywords: string[]; follow_on: string }[]
  defaultFollowOn: string
}
interface CustomDemoField {
  id: string; key: string; label: string; type: 'select' | 'text'; options: string
}

const HERMES = '#E8632A'
const TAB_DEFS: { id: Tab; label: string; emoji: string }[] = [
  { id: 'demographics',   label: 'Demographics',          emoji: '👤' },
  { id: 'psychographic',  label: 'Psychographic Library', emoji: '🧠' },
  { id: 'structured',     label: 'Industry Questions',    emoji: '📋' },
  { id: 'open_ended',     label: 'Open-Ended + Clarifiers', emoji: '💬' },
]

const ALL_INDUSTRIES = (Object.entries(INDUSTRY_LABELS) as [Industry, string][])
  .filter(([k]) => k !== 'other')
  .sort(([, a], [, b]) => a.localeCompare(b))

// ── Modal for Demo field create/edit ───────────────────────────────────────────
function DemoModal({ initial, onSave, onClose, saving }: {
  initial?: CustomDemoField | null
  onSave: (d: Omit<CustomDemoField, 'id'>) => void
  onClose: () => void
  saving: boolean
}) {
  const [label, setLabel] = useState(initial?.label || '')
  const [type, setType] = useState<'select' | 'text'>(initial?.type || 'select')
  const [options, setOptions] = useState(initial?.options || '')

  const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'custom_field'

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 24px 64px rgba(0,0,0,.25)' }}
        onClick={function(e) { e.stopPropagation() }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#111827', marginBottom: 20 }}>
          {initial ? 'Edit Demographic Field' : 'Add Demographic Field'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>Label</span>
            <input value={label} onChange={function(e) { setLabel(e.target.value) }}
              placeholder="e.g. Country of Birth"
              style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none' }} />
            {label.trim() && <span style={{ fontSize: 11, color: '#9ca3af' }}>Key: {key}</span>}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>Field Type</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['select', 'text'] as const).map(function(t) {
                return (
                  <button key={t} onClick={function() { setType(t) }}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: '1px solid ' + (type === t ? HERMES : '#d1d5db'), background: type === t ? '#fff4ef' : 'white', color: type === t ? HERMES : '#374151', fontWeight: type === t ? 700 : 500, fontSize: 13, cursor: 'pointer' }}>
                    {t === 'select' ? 'Dropdown' : 'Free Text'}
                  </button>
                )
              })}
            </div>
          </label>

          {type === 'select' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>Options (one per line)</span>
              <textarea value={options} onChange={function(e) { setOptions(e.target.value) }}
                placeholder={'Option A\nOption B\nOption C'}
                rows={5}
                style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} />
            </label>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={function() { onSave({ label: label.trim(), key, type, options }) }}
            disabled={saving || !label.trim()}
            style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: (!label.trim() || saving) ? '#e5e7eb' : HERMES, color: (!label.trim() || saving) ? '#9ca3af' : 'white', fontSize: 13, fontWeight: 700, cursor: (!label.trim() || saving) ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal for Psychographic question create/edit ───────────────────────────────
function PsychoModal({ initial, onSave, onClose, saving }: {
  initial?: PsychographicQ | null
  onSave: (d: { industry: string; industryLabel: string; prompt: string; responses: string[] }) => void
  onClose: () => void
  saving: boolean
}) {
  const [industry, setIndustry] = useState(initial?.industry || 'universal')
  const [prompt, setPrompt] = useState(initial?.prompt || '')
  const [responses, setResponses] = useState((initial?.responses || []).join('\n'))

  const industryLabel = industry === 'universal'
    ? 'Universal / Cross-Industry'
    : INDUSTRY_LABELS[industry as Industry] || industry

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 24px 64px rgba(0,0,0,.25)' }}
        onClick={function(e) { e.stopPropagation() }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#111827', marginBottom: 20 }}>
          {initial ? 'Edit Psychographic Question' : 'Add Psychographic Question'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>Industry</span>
            <select value={industry} onChange={function(e) { setIndustry(e.target.value) }}
              style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14, outline: 'none', background: 'white' }}>
              <option value="universal">Universal / Cross-Industry</option>
              {ALL_INDUSTRIES.map(function([k, v]) {
                return <option key={k} value={k}>{v}</option>
              })}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>Question Prompt</span>
            <textarea value={prompt} onChange={function(e) { setPrompt(e.target.value) }}
              placeholder="e.g. How would you describe your relationship with technology?"
              rows={3}
              style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>Response Options (one per line)</span>
            <textarea value={responses} onChange={function(e) { setResponses(e.target.value) }}
              placeholder={'🟢 Early adopter\n🟡 Practical user\n🔴 Resistant to change'}
              rows={6}
              style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={function() {
              onSave({
                industry, industryLabel,
                prompt: prompt.trim(),
                responses: responses.split('\n').map(function(r) { return r.trim() }).filter(Boolean),
              })
            }}
            disabled={saving || !prompt.trim()}
            style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: (!prompt.trim() || saving) ? '#e5e7eb' : HERMES, color: (!prompt.trim() || saving) ? '#9ca3af' : 'white', fontSize: 13, fontWeight: 700, cursor: (!prompt.trim() || saving) ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Confirm delete dialog ──────────────────────────────────────────────────────
function ConfirmDelete({ onConfirm, onCancel, deleting }: { onConfirm: () => void; onCancel: () => void; deleting: boolean }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onCancel}>
      <div style={{ background: 'white', borderRadius: 16, padding: 28, width: '100%', maxWidth: 360, boxShadow: '0 24px 64px rgba(0,0,0,.25)' }}
        onClick={function(e) { e.stopPropagation() }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#111827', marginBottom: 8 }}>Delete question?</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 22 }}>This cannot be undone.</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}
            style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={deleting}
            style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: '#dc2626', color: 'white', fontSize: 13, fontWeight: 700, cursor: deleting ? 'wait' : 'pointer' }}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── IndustrySection (collapsible group) ───────────────────────────────────────
function IndustrySection({ label, count, onAdd, addLabel, children }: {
  label: string; count: number; children: React.ReactNode; onAdd?: () => void; addLabel?: string
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="flex items-center">
        <button onClick={function() { setOpen(function(v) { return !v }) }}
          className="flex-1 flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-800">{label}</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{count}</span>
          </div>
          <span className="text-gray-400 text-sm">{open ? '▾' : '▸'}</span>
        </button>
        {onAdd && (
          <button onClick={onAdd}
            style={{ flexShrink: 0, marginRight: 12, padding: '5px 14px', borderRadius: 20, background: HERMES, color: 'white', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            + {addLabel || 'Add'}
          </button>
        )}
      </div>
      {open && (
        <div className="px-5 pb-5 flex flex-col gap-3">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Open-ended card (read-only, existing behavior) ───────────────────────────
function OpenEndedCard({ q }: { q: OpenEndedQ }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-800 mb-1">{q.prompt}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 font-medium">{q.triggerType}</span>
            <span className="text-xs text-gray-400">{q.keywordTriggers.length} keyword clusters</span>
          </div>
        </div>
        <button onClick={function() { setExpanded(function(v) { return !v }) }}
          className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 flex-shrink-0 transition-colors">
          {expanded ? 'Hide rules' : 'Show rules'}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-3">
          {q.keywordTriggers.map(function(kt, i) {
            return (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-500 w-5">P{kt.priority}</span>
                  <div className="flex flex-wrap gap-1">
                    {kt.keywords.map(function(kw) {
                      return <span key={kw} className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded-md font-mono">{kw}</span>
                    })}
                  </div>
                </div>
                <div className="text-xs text-gray-600 ml-7 italic">{kt.follow_on}</div>
              </div>
            )
          })}
          <div className="flex flex-col gap-1 mt-1">
            <div className="text-xs font-semibold text-gray-500">Default follow-on:</div>
            <div className="text-xs text-gray-600 italic">{q.defaultFollowOn}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CRUD action buttons ────────────────────────────────────────────────────────
function CrudButtons({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      <button onClick={onEdit}
        style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        ✏ Edit
      </button>
      <button onClick={onDelete}
        style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        🗑 Delete
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function QuestionsClient({ userEmail, logoUrl = '', orgName = '', fullName = '' }: Props) {
  const [tab, setTab] = useState<Tab>('demographics')
  const [industry, setIndustry] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [data, setData] = useState<{
    psychographic: PsychographicQ[]; structured: StructuredQ[]; openEnded: OpenEndedQ[]
    customDemo: CustomDemoField[]; customPsycho: PsychographicQ[]
  }>({ psychographic: [], structured: [], openEnded: [], customDemo: [], customPsycho: [] })

  // Modal state
  const [demoModal, setDemoModal] = useState<{ mode: 'create' | 'edit'; item?: CustomDemoField } | null>(null)
  const [psychoModal, setPsychoModal] = useState<{ mode: 'create' | 'edit'; item?: PsychographicQ } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: 'demo' | 'psycho' } | null>(null)

  function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (industry) params.set('industry', industry)
    fetch('/api/questions/library?' + params.toString())
      .then(function(r) { return r.json() })
      .then(function(d) { setData(d); setLoading(false) })
      .catch(function() { setLoading(false) })
  }

  useEffect(load, [industry])

  const inputCls = 'px-4 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-800 outline-none focus:border-orange-400 transition-colors'

  function filterBySearch<T extends { prompt: string }>(items: T[]): T[] {
    if (!search.trim()) return items
    const s = search.toLowerCase()
    return items.filter(function(q) { return q.prompt.toLowerCase().includes(s) })
  }

  function groupByIndustry<T extends { industryLabel: string }>(items: T[]): Record<string, T[]> {
    const groups: Record<string, T[]> = {}
    for (const item of items) {
      if (!groups[item.industryLabel]) groups[item.industryLabel] = []
      groups[item.industryLabel].push(item)
    }
    return groups
  }

  // ── Demo CRUD ────────────────────────────────────────────────────────────────
  async function saveDemo(d: Omit<CustomDemoField, 'id'>) {
    setSaving(true)
    try {
      if (demoModal?.mode === 'edit' && demoModal.item) {
        await fetch('/api/admin/questions/' + demoModal.item.id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'demo', data: d }),
        })
      } else {
        await fetch('/api/admin/questions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'demo', data: d }),
        })
      }
      setDemoModal(null); load()
    } finally { setSaving(false) }
  }

  // ── Psycho CRUD ──────────────────────────────────────────────────────────────
  async function savePsycho(d: { industry: string; industryLabel: string; prompt: string; responses: string[] }) {
    setSaving(true)
    try {
      if (psychoModal?.mode === 'edit' && psychoModal.item?.id) {
        await fetch('/api/admin/questions/' + psychoModal.item.id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'psycho', data: d }),
        })
      } else {
        await fetch('/api/admin/questions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'psycho', data: d }),
        })
      }
      setPsychoModal(null); load()
    } finally { setSaving(false) }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await fetch('/api/admin/questions/' + deleteTarget.id + '?type=' + deleteTarget.type, { method: 'DELETE' })
      setDeleteTarget(null); load()
    } finally { setDeleting(false) }
  }

  const psychoFiltered = filterBySearch(data.psychographic)
  const structuredFiltered = filterBySearch(data.structured)
  const openEndedFiltered = filterBySearch(data.openEnded)
  const customPsychoFiltered = filterBySearch(data.customPsycho)
  const customDemoFiltered = data.customDemo.filter(function(f) {
    return !search.trim() || f.label.toLowerCase().includes(search.toLowerCase())
  })

  // Demo bank filtered by search
  const demoBankFiltered = DEMO_BANK.filter(function(f) {
    return !search.trim() || f.label.toLowerCase().includes(search.toLowerCase())
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={true} userEmail={userEmail} fullName={fullName} currentPage="questions" />
      <SubHeader crumbs={[{ label: 'Settings & Admin', href: '/admin/hub' }, { label: 'Question Library' }]} />

      <main className="max-w-5xl mx-auto px-6 pt-28 pb-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Question Library</h1>
          <p className="text-gray-500 text-sm mt-1">Manage demographic fields, psychographic profiling, industry questions, and open-ended question banks.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {TAB_DEFS.map(function(t) {
            const count = t.id === 'demographics' ? demoBankFiltered.length + customDemoFiltered.length
              : t.id === 'psychographic' ? psychoFiltered.length + customPsychoFiltered.length
              : t.id === 'structured' ? structuredFiltered.length
              : openEndedFiltered.length
            return (
              <button key={t.id} onClick={function() { setTab(t.id) }}
                className={'px-4 py-2 rounded-xl text-sm font-semibold transition-all ' +
                  (tab === t.id ? 'text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300')}
                style={tab === t.id ? { background: HERMES } : undefined}>
                {t.emoji} {t.label} ({count})
              </button>
            )
          })}
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-6 flex-wrap">
          {tab !== 'demographics' && (
            <select value={industry} onChange={function(e) { setIndustry(e.target.value) }}
              className={inputCls + ' min-w-[220px]'}>
              <option value="">All industries</option>
              <option disabled>──────────────────</option>
              <option value="universal">Universal / Cross-Industry</option>
              <option disabled>──────────────────</option>
              {ALL_INDUSTRIES.map(function([k, v]) { return <option key={k} value={k}>{v}</option> })}
            </select>
          )}
          <input value={search} onChange={function(e) { setSearch(e.target.value) }}
            placeholder="Search questions…"
            className={inputCls + ' flex-1 min-w-[200px]'} />
        </div>

        {loading ? (
          <div className="py-20 text-center text-gray-400 text-sm">Loading library…</div>
        ) : (
          <>
            {/* ── Demographics Tab ─────────────────────────────── */}
            {tab === 'demographics' && (
              <div className="flex flex-col gap-6">

                {/* Standard DEMO_BANK fields (read-only) */}
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                    <h3 className="font-semibold text-gray-800">Standard Fields</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{demoBankFiltered.length}</span>
                    <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">🔒 Read-only</span>
                  </div>
                  <div className="px-5 pb-5 pt-4 flex flex-col gap-3">
                    {demoBankFiltered.map(function(f) {
                      const opts = f.options ? f.options.map(function(o) { return Array.isArray(o) ? o[1] : o }) : []
                      return (
                        <div key={f.key} className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-start gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className="text-sm font-semibold text-gray-800">{f.label}</span>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">{f.type === 'select' ? 'Dropdown' : 'Text'}</span>
                              <span className="text-xs text-gray-400 font-mono">{f.key}</span>
                            </div>
                            {opts.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {opts.map(function(o) { return <span key={o} className="text-xs bg-white border border-gray-200 text-gray-600 px-2.5 py-1 rounded-lg">{o}</span> })}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Custom demographic fields (editable) */}
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                    <h3 className="font-semibold text-gray-800">Custom Fields</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{customDemoFiltered.length}</span>
                    <button onClick={function() { setDemoModal({ mode: 'create' }) }}
                      style={{ marginLeft: 'auto', padding: '5px 14px', borderRadius: 20, background: HERMES, color: 'white', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      + Add Field
                    </button>
                  </div>
                  <div className="px-5 pb-5 pt-4 flex flex-col gap-3">
                    {customDemoFiltered.length === 0 ? (
                      <div className="text-sm text-gray-400 text-center py-6">No custom fields yet. Click "Add Field" to create one.</div>
                    ) : (
                      customDemoFiltered.map(function(f) {
                        const opts = f.options ? f.options.split('\n').map(function(o: string) { return o.trim() }).filter(Boolean) : []
                        return (
                          <div key={f.id} className="bg-white border border-orange-100 rounded-xl p-4 flex items-start gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="text-sm font-semibold text-gray-800">{f.label}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">{f.type === 'select' ? 'Dropdown' : 'Text'}</span>
                                <span className="text-xs text-gray-400 font-mono">{f.key}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#fff4ef', color: HERMES }}>Custom</span>
                              </div>
                              {opts.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {opts.map(function(o: string) { return <span key={o} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg">{o}</span> })}
                                </div>
                              )}
                            </div>
                            <CrudButtons
                              onEdit={function() { setDemoModal({ mode: 'edit', item: f }) }}
                              onDelete={function() { setDeleteTarget({ id: f.id, type: 'demo' }) }}
                            />
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Psychographic Tab ────────────────────────────── */}
            {tab === 'psychographic' && (
              <div className="flex flex-col gap-4">
                {/* Custom psychographic questions */}
                {customPsychoFiltered.length > 0 && (
                  <div className="bg-white border border-orange-100 rounded-2xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-orange-100 flex items-center gap-2">
                      <h3 className="font-semibold text-gray-800">Custom Questions</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{customPsychoFiltered.length}</span>
                      <button onClick={function() { setPsychoModal({ mode: 'create' }) }}
                        style={{ marginLeft: 'auto', padding: '5px 14px', borderRadius: 20, background: HERMES, color: 'white', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        + Add Question
                      </button>
                    </div>
                    <div className="px-5 pb-5 pt-4 flex flex-col gap-3">
                      {customPsychoFiltered.map(function(q, i) {
                        return (
                          <div key={q.id || i} className="bg-white border border-orange-100 rounded-xl p-4 flex items-start gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#fff4ef', color: HERMES }}>Custom</span>
                                <span className="text-xs text-gray-400">{q.industryLabel}</span>
                              </div>
                              <div className="text-sm font-medium text-gray-800 mb-2">{q.prompt}</div>
                              <div className="flex flex-wrap gap-1.5">
                                {q.responses.map(function(r) { return <span key={r} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg">{r}</span> })}
                              </div>
                            </div>
                            <CrudButtons
                              onEdit={function() { setPsychoModal({ mode: 'edit', item: q }) }}
                              onDelete={function() { setDeleteTarget({ id: q.id!, type: 'psycho' }) }}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Add button if no custom questions yet */}
                {customPsychoFiltered.length === 0 && (
                  <div className="flex justify-end">
                    <button onClick={function() { setPsychoModal({ mode: 'create' }) }}
                      style={{ padding: '8px 18px', borderRadius: 20, background: HERMES, color: 'white', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      + Add Psychographic Question
                    </button>
                  </div>
                )}

                {/* Library questions (read-only, grouped) */}
                <div className="text-sm text-gray-500 mt-1">{psychoFiltered.length} library questions</div>
                {Object.entries(groupByIndustry(psychoFiltered)).map(function([indLabel, qs]) {
                  return (
                    <IndustrySection key={indLabel} label={indLabel} count={qs.length}>
                      {qs.map(function(q, i) {
                        return (
                          <div key={i} className="bg-white border border-gray-200 rounded-xl p-4">
                            <div className="text-sm font-medium text-gray-800 mb-2">{q.prompt}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {q.responses.map(function(r) { return <span key={r} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg">{r}</span> })}
                            </div>
                          </div>
                        )
                      })}
                    </IndustrySection>
                  )
                })}
              </div>
            )}

            {/* ── Structured Tab (read-only) ───────────────────── */}
            {tab === 'structured' && (
              <div className="flex flex-col gap-4">
                <div className="text-sm text-gray-500">{structuredFiltered.length} questions</div>
                {Object.entries(groupByIndustry(structuredFiltered)).map(function([indLabel, qs]) {
                  return (
                    <IndustrySection key={indLabel} label={indLabel} count={qs.length}>
                      {qs.map(function(q) {
                        return (
                          <div key={q.key} className="bg-white border border-gray-200 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <span className="text-sm font-medium text-gray-800">{q.prompt}</span>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">{q.type}</span>
                            </div>
                            {q.exportLabel && <div className="text-xs text-gray-400 mb-2">Export: {q.exportLabel}</div>}
                            <div className="flex flex-wrap gap-1.5">
                              {q.options.map(function(o) { return <span key={o} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg">{o}</span> })}
                            </div>
                          </div>
                        )
                      })}
                    </IndustrySection>
                  )
                })}
              </div>
            )}

            {/* ── Open-Ended Tab (read-only) ───────────────────── */}
            {tab === 'open_ended' && (
              <div className="flex flex-col gap-4">
                <div className="text-sm text-gray-500">{openEndedFiltered.length} open-ended questions with clarifier rules</div>
                {Object.entries(groupByIndustry(openEndedFiltered)).map(function([indLabel, qs]) {
                  return (
                    <IndustrySection key={indLabel} label={indLabel} count={qs.length}>
                      {qs.map(function(q, i) { return <OpenEndedCard key={i} q={q} /> })}
                    </IndustrySection>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>

      {/* Modals */}
      {demoModal && (
        <DemoModal
          initial={demoModal.mode === 'edit' ? demoModal.item : null}
          onSave={(d) => { void saveDemo(d) }}
          onClose={function() { setDemoModal(null) }}
          saving={saving}
        />
      )}
      {psychoModal && (
        <PsychoModal
          initial={psychoModal.mode === 'edit' ? psychoModal.item : null}
          onSave={(d) => { void savePsycho(d) }}
          onClose={function() { setPsychoModal(null) }}
          saving={saving}
        />
      )}
      {deleteTarget && (
        <ConfirmDelete
          onConfirm={() => { void confirmDelete() }}
          onCancel={function() { setDeleteTarget(null) }}
          deleting={deleting}
        />
      )}
    </div>
  )
}
