// app/collections/[id]/glossary/BrandGlossaryClient.tsx
//
// Brand-glossary editor (shared brand-correction layer, Phase 5). CRUD over a
// brand collection's entity_catalog — the authoritative shared glossary that
// drives spelling correction across Town Hall, the What We Heard readout, and
// survey exports. Add / edit / hide / delete + "Pull from agents" (rollup).
// Shows each entity's source authority (official vs corroborating) from the
// provenance the catalog now records.

'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import LottieLoader from '@/components/ui/LottieLoader'
import { hasAuthoritativeSource, type Provenance } from '@/lib/correction/provenance'
import type { ModuleFeatures } from '@/lib/types'

interface Entity {
  id: string
  canonical: string
  slug: string
  category: string
  aliases: string[]
  sample_count: number
  source: string
  hidden: boolean
  provenance: Provenance | null
}

interface Props {
  collectionId: string
  brandName: string
  logoUrl?: string
  orgName?: string
  isAdmin: boolean
  userEmail: string
  fullName?: string
  features?: ModuleFeatures
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  person:       { bg: '#dbeafe', text: '#1e40af' },
  place:        { bg: '#d1fae5', text: '#047857' },
  organization: { bg: '#fef3c7', text: '#92400e' },
  brand:        { bg: '#fef3c7', text: '#92400e' },
  product:      { bg: '#ede9fe', text: '#5b21b6' },
  program:      { bg: '#fce7f3', text: '#9d174d' },
  event:        { bg: '#fee2e2', text: '#991b1b' },
  policy:       { bg: '#e0e7ff', text: '#3730a3' },
  food:         { bg: '#ffedd5', text: '#9a3412' },
  drink:        { bg: '#cffafe', text: '#155e75' },
  other:        { bg: '#f3f4f6', text: '#374151' },
}

const CATEGORIES = ['person', 'place', 'organization', 'brand', 'product', 'program', 'event', 'policy', 'food', 'drink', 'other']

// Human label for a source-kind.
const SOURCE_LABEL: Record<string, string> = {
  manual: 'curated', document: 'document', crawl: 'crawl', transcript: 'transcript',
  conversation: 'conversation', survey: 'survey', review: 'review', discovered: 'discovered',
}

export default function BrandGlossaryClient({
  collectionId, brandName, logoUrl, orgName, isAdmin, userEmail, fullName, features,
}: Props) {
  const [entities, setEntities] = useState<Entity[]>([])
  const [hiddenCount, setHiddenCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pulling, setPulling] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCanonical, setEditCanonical] = useState('')
  const [editAliases, setEditAliases] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [addCanonical, setAddCanonical] = useState('')
  const [addAliases, setAddAliases] = useState('')
  const [addCategory, setAddCategory] = useState('organization')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const base = '/api/collections/' + collectionId + '/entities'

  async function reload(opts: { includeHidden?: boolean } = {}) {
    setError(null)
    const r = await fetch(base + (opts.includeHidden ? '?include_hidden=1' : ''))
    const d = await r.json()
    if (d?.error) { setError(d.error); setLoading(false); return }
    setEntities(d.entities || [])
    setHiddenCount(d.hidden_count || 0)
    setLoading(false)
  }
  useEffect(() => { setLoading(true); void reload({ includeHidden: showHidden }) }, [collectionId, showHidden])

  async function addEntity() {
    const canonical = addCanonical.trim()
    if (!canonical) { setAddError('Name is required'); return }
    setAddSaving(true); setAddError(null)
    try {
      const r = await fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonical, aliases: addAliases.split(',').map(s => s.trim()).filter(Boolean), category: addCategory }),
      })
      const d = await r.json()
      if (d?.error) { setAddError(d.error); return }
      setAddCanonical(''); setAddAliases(''); setAddOpen(false)
      setMessage(d.merged ? `Merged into existing "${d.entity.canonical}".` : `Added "${d.entity.canonical}".`)
      await reload({ includeHidden: showHidden })
    } catch (e: unknown) {
      setAddError((e instanceof Error ? e.message : '') || 'network error')
    } finally { setAddSaving(false) }
  }

  function startEdit(e: Entity) {
    setEditingId(e.id); setEditCanonical(e.canonical); setEditAliases(e.aliases.join(', '))
  }
  async function saveEdit(id: string) {
    setSavingId(id)
    try {
      const r = await fetch(base + '/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonical: editCanonical.trim(), aliases: editAliases.split(',').map(s => s.trim()).filter(Boolean) }),
      })
      const d = await r.json()
      if (d?.error) { setError(d.error); return }
      setEditingId(null)
      await reload({ includeHidden: showHidden })
    } finally { setSavingId(null) }
  }

  async function setHidden(id: string, hidden: boolean) {
    const r = await fetch(base + '/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden }),
    })
    const d = await r.json()
    if (d?.error) { setError(d.error); return }
    await reload({ includeHidden: showHidden })
  }

  async function deleteEntity(id: string, canonical: string) {
    if (!confirm(`Delete "${canonical}"? (Only curated entities can be deleted; discovered ones should be hidden.)`)) return
    const r = await fetch(base + '/' + id, { method: 'DELETE' })
    const d = await r.json()
    if (d?.error) { setError(d.error); return }
    await reload({ includeHidden: showHidden })
  }

  async function pullFromAgents() {
    setPulling(true); setMessage(null)
    try {
      const r = await fetch(base + '/refresh', { method: 'POST' })
      const d = await r.json()
      if (d?.error) { setMessage('Pull failed: ' + d.error); return }
      setMessage(`Pulled from ${d.agents} linked agent${d.agents === 1 ? '' : 's'} (${d.pushed} entities synced).`)
      await reload({ includeHidden: showHidden })
    } catch (e: unknown) {
      setMessage('Pull failed: ' + ((e instanceof Error ? e.message : '') || 'network error'))
    } finally { setPulling(false) }
  }

  const counts = useMemo(() => {
    const official = entities.filter(e => hasAuthoritativeSource(e.source, e.provenance)).length
    return { total: entities.length, official, corroborating: entities.length - official }
  }, [entities])

  return (
    <div className='min-h-screen bg-gray-50'>
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={isAdmin} userEmail={userEmail} fullName={fullName} currentPage='bots' features={features} />
      <SubHeader crumbs={[{ label: 'Agents', href: '/bots' }, { label: brandName }, { label: 'Brand Glossary' }]} />

      <div className='max-w-5xl mx-auto px-4 pt-28 pb-8'>
        <div className='mb-2 text-xs text-gray-500'>Brand glossary</div>
        <div className='flex items-end justify-between mb-2 flex-wrap gap-3'>
          <div>
            <h1 className='text-2xl font-semibold text-gray-900'>{brandName} — Brand Glossary</h1>
            <p className='text-sm text-gray-600 mt-1'>
              The brand's <strong>shared, authoritative</strong> entity list. These canonical spellings correct verbatims
              across this brand's Town Hall reports, the What We Heard readout, and survey exports.
            </p>
          </div>
          <div className='flex gap-2'>
            <button onClick={() => { setAddOpen(v => !v); setAddError(null) }}
              className='px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-sm font-medium hover:bg-emerald-50'
            >+ Add entity</button>
            <button onClick={() => { void pullFromAgents() }} disabled={pulling}
              className='px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50'
            >{pulling ? 'Pulling…' : 'Pull from agents'}</button>
          </div>
        </div>

        {addOpen && (
          <div className='mb-4 p-4 rounded-lg border border-emerald-200 bg-emerald-50/50'>
            <div className='flex flex-wrap gap-3 items-end'>
              <label className='flex flex-col gap-1'>
                <span className='text-xs font-medium text-gray-600'>Name (canonical)</span>
                <input value={addCanonical} onChange={e => setAddCanonical(e.target.value)} placeholder='e.g. NOWOCATS'
                  className='border border-gray-300 rounded-lg px-3 py-2' style={{ fontSize: '16px', minWidth: 220 }} />
              </label>
              <label className='flex flex-col gap-1'>
                <span className='text-xs font-medium text-gray-600'>Aliases / misspellings (comma-separated)</span>
                <input value={addAliases} onChange={e => setAddAliases(e.target.value)} placeholder='No What Cats, Nowocat'
                  className='border border-gray-300 rounded-lg px-3 py-2' style={{ fontSize: '16px', minWidth: 260 }} />
              </label>
              <label className='flex flex-col gap-1'>
                <span className='text-xs font-medium text-gray-600'>Category</span>
                <select value={addCategory} onChange={e => setAddCategory(e.target.value)}
                  className='border border-gray-300 rounded-lg px-3 py-2 bg-white' style={{ fontSize: '16px' }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <button onClick={() => { void addEntity() }} disabled={addSaving}
                className='px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50'
              >{addSaving ? 'Adding…' : 'Add'}</button>
              <button onClick={() => { setAddOpen(false); setAddError(null) }}
                className='px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-white'
              >Cancel</button>
            </div>
            <p className='text-xs text-gray-500 mt-2'>A curated entity is <strong>authoritative</strong> — it owns its canonical spelling and is used for correction immediately.</p>
            {addError && <p className='text-xs text-red-600 mt-1'>{addError}</p>}
          </div>
        )}

        {message && (
          <div className='mb-4 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm'>{message}</div>
        )}

        {!loading && entities.length > 0 && (
          <div className='flex flex-wrap gap-2 mb-4'>
            <span className='px-2 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700'>{counts.total} {showHidden ? 'total' : 'visible'}</span>
            <span className='px-2 py-1 rounded-md text-xs font-semibold bg-green-100 text-green-800'>{counts.official} official</span>
            <span className='px-2 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-700'>{counts.corroborating} corroborating</span>
          </div>
        )}

        <div className='mb-3 flex items-center gap-3 text-sm'>
          <label className='flex items-center gap-2 text-gray-700 cursor-pointer'>
            <input type='checkbox' checked={showHidden} onChange={e => setShowHidden(e.target.checked)} className='rounded' />
            Include hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
          </label>
        </div>

        {loading && <div className='flex justify-center py-16'><LottieLoader size={64} /></div>}
        {error && <div className='bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm'>{error}</div>}

        {!loading && !error && entities.length === 0 && (
          <div className='bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500'>
            <div className='text-sm'>This brand has no glossary entries yet.</div>
            <div className='text-xs mt-2'>Add one above, or click "Pull from agents" to bring in this brand's agents' curated entities.</div>
          </div>
        )}

        {!loading && !error && entities.length > 0 && (
          <div className='bg-white border border-gray-200 rounded-lg divide-y divide-gray-200'>
            {entities.map(e => {
              const s = CATEGORY_STYLES[e.category] || CATEGORY_STYLES.other
              const isEditing = editingId === e.id
              const official = hasAuthoritativeSource(e.source, e.provenance)
              return (
                <div key={e.id} className={'p-4 ' + (e.hidden ? 'opacity-60' : '')}>
                  <div className='flex items-start gap-3 flex-wrap'>
                    <span className='px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap' style={{ background: s.bg, color: s.text }}>{e.category}</span>
                    <span className={'px-2 py-0.5 rounded-md text-xs font-medium ' + (official ? 'text-green-700 bg-green-50 border border-green-200' : 'text-amber-700 bg-amber-50 border border-amber-200')}>
                      {official ? 'official' : 'corroborating'} · {SOURCE_LABEL[e.source] || e.source}
                    </span>
                    {e.hidden && <span className='px-2 py-0.5 rounded-md text-xs font-medium text-gray-500 bg-gray-100'>hidden</span>}
                    <div className='flex-1 min-w-0'>
                      {isEditing ? (
                        <div className='space-y-2'>
                          <input type='text' value={editCanonical} onChange={ev => setEditCanonical(ev.target.value)}
                            className='w-full text-sm border border-gray-300 rounded-md p-2 focus:outline-none focus:border-blue-400' style={{ fontSize: '16px' }} placeholder='Canonical' />
                          <input type='text' value={editAliases} onChange={ev => setEditAliases(ev.target.value)}
                            className='w-full text-xs border border-gray-300 rounded-md p-2 focus:outline-none focus:border-blue-400' style={{ fontSize: '16px' }} placeholder='Aliases, comma-separated' />
                        </div>
                      ) : (
                        <>
                          <div className='text-sm font-medium text-gray-900'>{e.canonical}</div>
                          {e.aliases.length > 0 && <div className='text-xs text-gray-500 mt-0.5'>aka {e.aliases.join(', ')}</div>}
                          <div className='text-xs text-gray-400 mt-1'><code className='text-gray-600'>entity:{e.slug}</code></div>
                        </>
                      )}
                    </div>
                    <div className='flex gap-2 flex-shrink-0'>
                      {isEditing ? (
                        <>
                          <button onClick={() => { void saveEdit(e.id) }} disabled={savingId === e.id}
                            className='px-2.5 py-1 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50'>{savingId === e.id ? 'Saving…' : 'Save'}</button>
                          <button onClick={() => setEditingId(null)} className='px-2.5 py-1 rounded-md border border-gray-300 text-xs text-gray-600 hover:bg-gray-50'>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(e)} className='px-2.5 py-1 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50'>Edit</button>
                          <button onClick={() => { void setHidden(e.id, !e.hidden) }} className='px-2.5 py-1 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50'>{e.hidden ? 'Unhide' : 'Hide'}</button>
                          {e.source === 'manual' && (
                            <button onClick={() => { void deleteEntity(e.id, e.canonical) }} className='px-2.5 py-1 rounded-md border border-red-200 text-xs text-red-600 hover:bg-red-50'>Delete</button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
