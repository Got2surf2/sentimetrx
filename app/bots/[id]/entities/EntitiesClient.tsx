'use client'

// app/bots/[id]/entities/EntitiesClient.tsx
// Entity catalog UI (docs/BOTS.md § 9.y.4).
//
// - Header strip: last-refresh metadata + "Re-extract entities" button.
// - Table: visible entities sorted by sample_count desc.
// - Row actions: hide / unhide (toggles `hidden`), edit canonical, edit
//   aliases (manual edits flip source='discovered' → 'manual').
// - Hidden toggle: show/hide hidden rows in the listing.

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import TopNav from '@/components/nav/TopNav'
import LottieLoader from '@/components/ui/LottieLoader'

interface Entity {
  id: string
  canonical: string
  slug: string
  category: string
  aliases: string[]
  sample_count: number
  source: 'discovered' | 'manual'
  hidden: boolean
  first_seen_at: string
  last_seen_at: string
}

interface LastRefresh {
  triggered_at: string
  entities_before: number | null
  entities_after: number | null
  entities_new: number | null
  haiku_cost_est_cents: number | null
  sample_size: number | null
  duration_ms: number | null
}

interface Props {
  botId: string
  botName: string
  botSlug: string
  logoUrl?: string
  orgName?: string
  isAdmin: boolean
  userEmail: string
  fullName?: string
  features?: import('@/lib/types').ModuleFeatures
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  person:       { bg: '#dbeafe', text: '#1e40af' },
  place:        { bg: '#d1fae5', text: '#047857' },
  organization: { bg: '#fef3c7', text: '#92400e' },
  product:      { bg: '#ede9fe', text: '#5b21b6' },
  program:      { bg: '#fce7f3', text: '#9d174d' },
  event:        { bg: '#fee2e2', text: '#991b1b' },
  policy:       { bg: '#e0e7ff', text: '#3730a3' },
  other:        { bg: '#f3f4f6', text: '#374151' },
}

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  if (ms < 3600000) return Math.floor(ms / 60000) + ' min ago'
  if (ms < 86400000) return Math.floor(ms / 3600000) + ' h ago'
  const days = Math.floor(ms / 86400000)
  if (days < 30) return days + ' d ago'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCost(cents: number | null) {
  if (cents == null) return '—'
  if (cents < 1) return '<$0.01'
  return '$' + (cents / 100).toFixed(2)
}

export default function EntitiesClient({
  botId, botName, logoUrl, orgName, isAdmin, userEmail, fullName, features,
}: Props) {
  const [entities, setEntities] = useState<Entity[]>([])
  const [hiddenCount, setHiddenCount] = useState(0)
  const [lastRefresh, setLastRefresh] = useState<LastRefresh | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractMessage, setExtractMessage] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCanonical, setEditCanonical] = useState('')
  const [editAliases, setEditAliases] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  // Manual add-entity form.
  const [addOpen, setAddOpen] = useState(false)
  const [addCanonical, setAddCanonical] = useState('')
  const [addAliases, setAddAliases] = useState('')
  const [addCategory, setAddCategory] = useState('person')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  async function reload(opts: { includeHidden?: boolean } = {}) {
    const url = '/api/bots/' + botId + '/entities' + (opts.includeHidden ? '?include_hidden=1' : '')
    const r = await fetch(url)
    const d = await r.json()
    if (d?.error) { setError(d.error); return }
    setEntities(Array.isArray(d?.entities) ? d.entities : [])
    setHiddenCount(d?.hidden_count || 0)
    setLastRefresh(d?.last_refresh || null)
  }

  useEffect(() => {
    setLoading(true)
    reload({ includeHidden: showHidden }).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId, showHidden])

  async function runExtract() {
    if (!confirm('Re-extract entities from this agent\'s knowledge base?\n\nRuns Haiku on all KB chunks. Typical cost: $0.01–$0.05.')) return
    setExtracting(true)
    setExtractMessage(null)
    try {
      const r = await fetch('/api/bots/' + botId + '/entities/extract', { method: 'POST' })
      const d = await r.json()
      if (d?.error) {
        setExtractMessage('Extract failed: ' + d.error)
      } else {
        setExtractMessage(
          `Added ${d.added} new entities (total ${d.total}). Cost: ${formatCost(d.cost_cents)} · ${(d.duration_ms / 1000).toFixed(1)}s.`
        )
        await reload({ includeHidden: showHidden })
      }
    } catch (e: any) {
      setExtractMessage('Extract failed: ' + (e?.message || 'network error'))
    } finally {
      setExtracting(false)
    }
  }

  async function addEntity() {
    const canonical = addCanonical.trim()
    if (!canonical) { setAddError('Name is required.'); return }
    setAddSaving(true); setAddError(null)
    try {
      const r = await fetch('/api/bots/' + botId + '/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonical,
          aliases: addAliases.split(',').map(a => a.trim()).filter(Boolean),
          category: addCategory,
        }),
      })
      const d = await r.json()
      if (d?.error) { setAddError(d.error); return }
      setAddOpen(false); setAddCanonical(''); setAddAliases(''); setAddCategory('person')
      await reload({ includeHidden: showHidden })
    } catch (e: any) {
      setAddError(e?.message || 'network error')
    } finally {
      setAddSaving(false)
    }
  }

  async function setHidden(entityId: string, hidden: boolean) {
    setSavingId(entityId)
    try {
      const r = await fetch('/api/bots/' + botId + '/entities/' + entityId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden }),
      })
      const d = await r.json()
      if (d?.entity) {
        // Reload to refresh hidden_count + ordering.
        await reload({ includeHidden: showHidden })
      } else if (d?.error) {
        alert('Update failed: ' + d.error)
      }
    } finally {
      setSavingId(null)
    }
  }

  function startEdit(e: Entity) {
    setEditingId(e.id)
    setEditCanonical(e.canonical)
    setEditAliases(e.aliases.join(', '))
  }

  async function saveEdit(entityId: string) {
    const canonical = editCanonical.trim()
    if (!canonical) { alert('Canonical cannot be empty.'); return }
    const aliases = editAliases.split(',').map(a => a.trim()).filter(Boolean)
    setSavingId(entityId)
    try {
      const r = await fetch('/api/bots/' + botId + '/entities/' + entityId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonical, aliases }),
      })
      const d = await r.json()
      if (d?.entity) {
        setEditingId(null)
        await reload({ includeHidden: showHidden })
      } else if (d?.error) {
        alert('Update failed: ' + d.error)
      }
    } finally {
      setSavingId(null)
    }
  }

  const counts = useMemo(() => {
    const byCat: Record<string, number> = {}
    for (const e of entities) byCat[e.category] = (byCat[e.category] || 0) + 1
    return { total: entities.length, byCat }
  }, [entities])

  return (
    <div className='min-h-screen bg-gray-50'>
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={isAdmin} userEmail={userEmail} fullName={fullName} currentPage='bots' features={features} />

      <div className='max-w-5xl mx-auto px-4 py-8'>
        <div className='mb-2 text-xs text-gray-500'>
          <Link href='/bots' className='hover:underline'>Agents</Link> / <span className='text-gray-700'>{botName}</span> / Entities
        </div>
        <div className='flex items-end justify-between mb-6 flex-wrap gap-3'>
          <div>
            <h1 className='text-2xl font-semibold text-gray-900'>{botName} — Entities</h1>
            <p className='text-sm text-gray-600 mt-1'>
              Named entities extracted from this agent's knowledge base.
              {' '}User turns mentioning these get an <code className='text-emerald-700'>entity:&lt;slug&gt;</code> flag automatically.
            </p>
          </div>
          <div className='flex gap-2'>
            <button
              onClick={() => { setAddOpen(v => !v); setAddError(null) }}
              className='px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-sm font-medium hover:bg-emerald-50'
            >+ Add entity</button>
            <button
              onClick={runExtract}
              disabled={extracting}
              className='px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50'
            >{extracting ? 'Extracting…' : 'Re-extract entities'}</button>
            <Link
              href={'/bots/' + botId + '/conversations'}
              className='px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-white'
            >View transcripts</Link>
          </div>
        </div>

        {/* Manual add-entity form — manual rows survive re-extraction */}
        {addOpen && (
          <div className='mb-4 p-4 rounded-lg border border-emerald-200 bg-emerald-50/50'>
            <div className='flex flex-wrap gap-3 items-end'>
              <label className='flex flex-col gap-1'>
                <span className='text-xs font-medium text-gray-600'>Name (canonical)</span>
                <input value={addCanonical} onChange={e => setAddCanonical(e.target.value)} placeholder='e.g. Hatem Abou-Senna'
                  className='border border-gray-300 rounded-lg px-3 py-2' style={{ fontSize: '16px', minWidth: 220 }} />
              </label>
              <label className='flex flex-col gap-1'>
                <span className='text-xs font-medium text-gray-600'>Aliases / misspellings (comma-separated)</span>
                <input value={addAliases} onChange={e => setAddAliases(e.target.value)} placeholder='Hatham, Hatham Abou-Senna'
                  className='border border-gray-300 rounded-lg px-3 py-2' style={{ fontSize: '16px', minWidth: 260 }} />
              </label>
              <label className='flex flex-col gap-1'>
                <span className='text-xs font-medium text-gray-600'>Category</span>
                <select value={addCategory} onChange={e => setAddCategory(e.target.value)}
                  className='border border-gray-300 rounded-lg px-3 py-2 bg-white' style={{ fontSize: '16px' }}>
                  {['person', 'place', 'organization', 'product', 'program', 'event', 'policy', 'other'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <button onClick={addEntity} disabled={addSaving}
                className='px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50'
              >{addSaving ? 'Adding…' : 'Add'}</button>
              <button onClick={() => { setAddOpen(false); setAddError(null) }}
                className='px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-white'
              >Cancel</button>
            </div>
            <p className='text-xs text-gray-500 mt-2'>Manually-added entities are kept as <strong>manual</strong> — re-extraction never removes or overwrites them. Aliases also drive ASR spelling correction for this brand's recordings.</p>
            {addError && <p className='text-xs text-red-600 mt-1'>{addError}</p>}
          </div>
        )}

        {/* Last-refresh strip */}
        {lastRefresh && (
          <div className='mb-4 text-xs text-gray-500'>
            Last extracted {formatRelative(lastRefresh.triggered_at)} ·{' '}
            {lastRefresh.entities_after} entities ({lastRefresh.entities_new} new) ·{' '}
            {lastRefresh.sample_size} chunks · {formatCost(lastRefresh.haiku_cost_est_cents)}
          </div>
        )}

        {extractMessage && (
          <div className='mb-4 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm'>
            {extractMessage}
          </div>
        )}

        {/* Summary chips */}
        {!loading && entities.length > 0 && (
          <div className='flex flex-wrap gap-2 mb-4'>
            <span className='px-2 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700'>
              {counts.total} {showHidden ? 'total' : 'visible'}
            </span>
            {Object.entries(counts.byCat).sort((a, b) => b[1] - a[1]).map(([cat, n]) => {
              const s = CATEGORY_STYLES[cat] || CATEGORY_STYLES.other
              return (
                <span key={cat} className='px-2 py-1 rounded-md text-xs font-semibold' style={{ background: s.bg, color: s.text }}>
                  {n} {cat}
                </span>
              )
            })}
          </div>
        )}

        {/* Show-hidden toggle */}
        <div className='mb-3 flex items-center gap-3 text-sm'>
          <label className='flex items-center gap-2 text-gray-700 cursor-pointer'>
            <input
              type='checkbox'
              checked={showHidden}
              onChange={e => setShowHidden(e.target.checked)}
              className='rounded'
            />
            Include hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
          </label>
        </div>

        {loading && <div className='flex justify-center py-16'><LottieLoader size={64} /></div>}
        {error && <div className='bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm'>{error}</div>}

        {!loading && !error && entities.length === 0 && (
          <div className='bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500'>
            <div className='text-sm'>No entities extracted yet.</div>
            <div className='text-xs mt-2'>
              Click "Re-extract entities" to scan this agent's KB. ~$0.01–$0.05 per run.
            </div>
          </div>
        )}

        {!loading && !error && entities.length > 0 && (
          <div className='bg-white border border-gray-200 rounded-lg divide-y divide-gray-200'>
            {entities.map(e => {
              const s = CATEGORY_STYLES[e.category] || CATEGORY_STYLES.other
              const isEditing = editingId === e.id
              return (
                <div key={e.id} className={'p-4 ' + (e.hidden ? 'opacity-60' : '')}>
                  <div className='flex items-start gap-3 flex-wrap'>
                    <span className='px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap' style={{ background: s.bg, color: s.text }}>
                      {e.category}
                    </span>
                    {e.source === 'manual' && (
                      <span className='px-2 py-0.5 rounded-md text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200'>
                        manual
                      </span>
                    )}
                    {e.hidden && (
                      <span className='px-2 py-0.5 rounded-md text-xs font-medium text-gray-500 bg-gray-100'>
                        hidden
                      </span>
                    )}
                    <div className='flex-1 min-w-0'>
                      {isEditing ? (
                        <div className='space-y-2'>
                          <input
                            type='text'
                            value={editCanonical}
                            onChange={ev => setEditCanonical(ev.target.value)}
                            className='w-full text-sm border border-gray-300 rounded-md p-2 focus:outline-none focus:border-blue-400'
                            placeholder='Canonical (e.g. "Plymouth Sorrento Road")'
                          />
                          <input
                            type='text'
                            value={editAliases}
                            onChange={ev => setEditAliases(ev.target.value)}
                            className='w-full text-xs border border-gray-300 rounded-md p-2 focus:outline-none focus:border-blue-400'
                            placeholder='Aliases, comma-separated (e.g. "Plymouth-Sorrento, Plymouth Sorrento Rd")'
                          />
                        </div>
                      ) : (
                        <>
                          <div className='text-sm font-medium text-gray-900'>{e.canonical}</div>
                          {e.aliases.length > 0 && (
                            <div className='text-xs text-gray-500 mt-0.5'>
                              aka {e.aliases.join(', ')}
                            </div>
                          )}
                          <div className='text-xs text-gray-400 mt-1'>
                            <code className='text-gray-600'>entity:{e.slug}</code>
                            {' · '}
                            seen {e.sample_count}× in KB
                            {' · '}
                            last refreshed {formatRelative(e.last_seen_at)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Row actions */}
                  <div className='mt-3 flex items-center gap-2 text-xs'>
                    {isEditing ? (
                      <>
                        <button
                          disabled={savingId === e.id}
                          onClick={() => saveEdit(e.id)}
                          className='px-3 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50'
                        >Save</button>
                        <button
                          onClick={() => setEditingId(null)}
                          className='px-3 py-1 rounded-md bg-gray-100 text-gray-700 font-medium hover:bg-gray-200'
                        >Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(e)}
                          className='px-2 py-1 rounded-md bg-gray-100 text-gray-700 font-medium hover:bg-gray-200'
                        >Edit</button>
                        <button
                          disabled={savingId === e.id}
                          onClick={() => setHidden(e.id, !e.hidden)}
                          className='px-2 py-1 rounded-md bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50'
                        >{e.hidden ? 'Unhide' : 'Hide'}</button>
                        {savingId === e.id && <span className='text-gray-400'>saving…</span>}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className='mt-6 text-xs text-gray-500'>
          Extraction is on-demand (never automatic). Mention detection runs per turn at $0 cost.
          {' '}New entities surfacing only once in the KB are hidden by default; toggle "Include hidden" to review.
        </p>
      </div>
    </div>
  )
}
