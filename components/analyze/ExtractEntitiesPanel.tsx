'use client'

// components/analyze/ExtractEntitiesPanel.tsx
// One panel per dataset on the Schema tab. Two modes:
//   Preview — shows the last-discovery state and the top entities with LIVE
//             full-text counts. Re-discover button kicks NER.
//   Manage  — full catalog with hide/unhide/edit per row, single-add form,
//             bulk-paste textarea, and a "Reset discovered" admin action.
//             Manual entries (source='manual') survive discovery; hidden
//             rows stay hidden across runs (lib/entityDiscovery.ts skips
//             them on upsert).
//
// Backend:
//   GET    /api/datasets/[id]/entities                — preview top entities
//   GET    /api/datasets/[id]/entities?manage=1       — full catalog incl. hidden
//   POST   /api/datasets/[id]/entities                — single or bulk create
//   PATCH  /api/datasets/[id]/entities/[slug]         — hide/unhide / edit
//   DELETE /api/datasets/[id]/entities/[slug]         — hard-delete manual only
//   POST   /api/datasets/[id]/entities/reset-discovered — wipe discovered rows
//   POST   /api/datasets/[id]/discover-entities       — run NER discovery

import { useEffect, useState } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

interface EntityRow {
  slug:      string
  canonical: string
  category:  string
  aliases?:  string[]
  mentions:  number
  source?:   'discovered' | 'manual'
  hidden?:   boolean
}

interface LastRefresh {
  triggered_at:   string
  triggered_by:   string
  entities_after: number | null
}

interface Props {
  datasetId:   string
  schemaDirty?: boolean
}

const P = {
  bg:        '#f7f7f8',
  white:     '#ffffff',
  border:    '#e8e8ec',
  text:      '#111827',
  textMid:   '#374151',
  textMute:  '#6b7280',
  textFaint: '#9ca3af',
  accent:    '#e8622a',
  accentBg:  '#fff4ef',
  danger:    '#dc2626',
  dangerBg:  '#fef2f2',
}

// Categories from lib/entityDiscovery.ts: food | drink | place | person | brand | other
const CATEGORIES = ['food', 'drink', 'place', 'person', 'brand', 'other'] as const
const CATEGORY_COLOR: Record<string, string> = {
  food:   '#EA580C',
  drink:  '#7C3AED',
  place:  '#0F7173',
  person: '#1E40AF',
  brand:  '#B45309',
  other:  '#8FA3AE',
}

export default function ExtractEntitiesPanel({ datasetId, schemaDirty }: Props) {
  const [loading, setLoading]       = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError]           = useState('')
  const [entities, setEntities]     = useState<EntityRow[]>([])
  const [totalDistinct, setTotalDistinct] = useState<number | null>(null)
  const [scopeType, setScopeType]   = useState<'dataset' | 'collection' | null>(null)
  const [lastRefresh, setLastRefresh] = useState<LastRefresh | null>(null)

  // Manage mode: fetches catalog with ?manage=1 (includes hidden, returns
  // source flag). Preview mode keeps the cheap top-12 read.
  const [manageOpen, setManageOpen] = useState(false)
  const [addCanonical, setAddCanonical] = useState('')
  const [addCategory, setAddCategory] = useState<typeof CATEGORIES[number]>('food')
  const [addAliases, setAddAliases] = useState('')
  const [adding, setAdding] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkSubmitting, setBulkSubmitting] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Visibility (hide/show) edits are STAGED locally, not written per-click —
  // clicking used to PATCH + refetch, which scrolled the panel back to the top.
  // pendingHidden maps slug -> desired hidden, only for rows that differ from the
  // server; the Save button flushes them. Render reads the effective state via
  // effHidden so a refetch (add/edit/discover) doesn't drop unsaved toggles.
  const [pendingHidden, setPendingHidden] = useState<Record<string, boolean>>({})
  const [savingHidden, setSavingHidden] = useState(false)
  const dirtyCount = Object.keys(pendingHidden).length

  function effHidden(e: EntityRow): boolean {
    return e.slug in pendingHidden ? pendingHidden[e.slug] : !!e.hidden
  }
  // Stage one row. If the new value matches the server's, drop the key so it's
  // no longer counted dirty.
  function stageHidden(slug: string, serverHidden: boolean, val: boolean) {
    setPendingHidden(function(prev) {
      const next = Object.assign({}, prev)
      if (val === serverHidden) delete next[slug]; else next[slug] = val
      return next
    })
  }
  // Bulk: hide/show every row in a category (the per-type None/All control).
  function stageCategory(category: string, val: boolean) {
    setPendingHidden(function(prev) {
      const next = Object.assign({}, prev)
      entities.forEach(function(e) {
        if (e.category !== category) return
        if (val === !!e.hidden) delete next[e.slug]; else next[e.slug] = val
      })
      return next
    })
  }

  // Inline edit state — at most one row in edit mode at a time. Editing
  // toggles the row from a display layout to a form layout; Save calls PATCH
  // /entities/[slug]; Cancel reverts. Aliases are edited as comma-separated
  // text to match the bulk-paste convention.
  const [editSlug, setEditSlug] = useState<string | null>(null)
  const [editCanonical, setEditCanonical] = useState('')
  const [editCategory, setEditCategory] = useState<typeof CATEGORIES[number]>('food')
  const [editAliases, setEditAliases] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  async function loadPreview() {
    setLoading(true)
    setError('')
    try {
      const qs = manageOpen ? '?manage=1' : '?limit=12'
      const res = await fetch('/api/datasets/' + datasetId + '/entities' + qs)
      if (!res.ok) {
        setEntities([])
        setTotalDistinct(null)
        return
      }
      const data = await res.json()
      setEntities(data.entities || [])
      setTotalDistinct(typeof data.total_distinct === 'number' ? data.total_distinct : null)
      setScopeType(data.scope_type || null)
      setLastRefresh(data.last_refresh || null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load entities')
    } finally {
      setLoading(false)
    }
  }

  useEffect(function() {
    void loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, manageOpen])

  async function runDiscover() {
    setDiscovering(true)
    setError('')
    setSavedFlash(false)
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/discover-entities', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Discovery failed')
      await loadPreview()
      setSavedFlash(true)
      setTimeout(function() { setSavedFlash(false) }, 3000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Discovery failed')
    } finally {
      setDiscovering(false)
    }
  }

  async function addOne() {
    const canonical = addCanonical.trim()
    if (canonical.length < 2) return
    const aliases = addAliases.split(',').map(function(a) { return a.trim() }).filter(function(a) { return a.length >= 2 })
    setAdding(true)
    setError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/entities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonical: canonical, category: addCategory, aliases: aliases }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Add failed')
      setAddCanonical('')
      setAddAliases('')
      await loadPreview()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Add failed')
    } finally {
      setAdding(false)
    }
  }

  // Bulk paste: one entity per line. Format:
  //   Canonical Name | category | alias1, alias2
  // Pipe-separated for clarity. Category defaults to 'food', aliases optional.
  async function submitBulk() {
    const lines = bulkText.split('\n').map(function(l) { return l.trim() }).filter(function(l) { return l.length > 0 && !l.startsWith('#') })
    if (lines.length === 0) return
    const payload = lines.map(function(line) {
      const parts = line.split('|').map(function(p) { return p.trim() })
      const canonical = parts[0] || ''
      const category = (parts[1] || 'food').toLowerCase()
      const aliases = (parts[2] || '').split(',').map(function(a) { return a.trim() }).filter(function(a) { return a.length >= 2 })
      return { canonical: canonical, category: category, aliases: aliases }
    })
    setBulkSubmitting(true)
    setBulkResult(null)
    setError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/entities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entities: payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Bulk add failed')
      setBulkResult((data.entities_new || 0) + ' new, ' + (data.entities_merged || 0) + ' merged, ' + (data.rejected?.length || 0) + ' rejected')
      setBulkText('')
      await loadPreview()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bulk add failed')
    } finally {
      setBulkSubmitting(false)
    }
  }

  // Flush the staged visibility edits — one PATCH per changed row, chunked so a
  // big "hide all" doesn't fire hundreds of concurrent requests. Then refetch so
  // the server state and the (now-empty) staged state agree.
  async function saveHidden() {
    const slugs = Object.keys(pendingHidden)
    if (!slugs.length || savingHidden) return
    setSavingHidden(true)
    setError('')
    try {
      for (let i = 0; i < slugs.length; i += 10) {
        await Promise.all(slugs.slice(i, i + 10).map(function(slug) {
          return fetch('/api/datasets/' + datasetId + '/entities/' + encodeURIComponent(slug), {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ hidden: pendingHidden[slug] }),
          })
        }))
      }
      setPendingHidden({})
      await loadPreview()
      setSavedFlash(true)
      setTimeout(function() { setSavedFlash(false) }, 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingHidden(false)
    }
  }

  // Exit manage mode. Warn if there are unsaved visibility edits.
  function closeManage() {
    if (dirtyCount > 0 && !confirm('Discard ' + dirtyCount + ' unsaved visibility change' + (dirtyCount === 1 ? '' : 's') + '?')) return
    setPendingHidden({})
    setManageOpen(false)
    setResetConfirm(false)
  }

  async function deleteManual(row: EntityRow) {
    if (row.source !== 'manual') return
    if (!confirm('Delete "' + row.canonical + '"? This cannot be undone. (For discovered entries, hide instead.)')) return
    setRowBusy(row.slug)
    try {
      await fetch('/api/datasets/' + datasetId + '/entities/' + encodeURIComponent(row.slug), { method: 'DELETE' })
      await loadPreview()
    } finally {
      setRowBusy(null)
    }
  }

  function startEdit(row: EntityRow) {
    setEditSlug(row.slug)
    setEditCanonical(row.canonical)
    setEditCategory((CATEGORIES as readonly string[]).includes(row.category) ? (row.category as typeof CATEGORIES[number]) : 'other')
    setEditAliases((row.aliases || []).join(', '))
    setEditError('')
  }

  function cancelEdit() {
    setEditSlug(null)
    setEditError('')
  }

  async function saveEdit() {
    if (!editSlug) return
    const canonical = editCanonical.trim()
    if (canonical.length < 2) { setEditError('Name must be at least 2 characters.'); return }
    const aliases = editAliases.split(',').map(function(a) { return a.trim() }).filter(function(a) { return a.length >= 2 })
    setEditSaving(true)
    setEditError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/entities/' + encodeURIComponent(editSlug), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonical: canonical, category: editCategory, aliases: aliases }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Save failed')
      setEditSlug(null)
      await loadPreview()
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setEditSaving(false)
    }
  }

  async function resetDiscovered() {
    setResetting(true)
    setError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/entities/reset-discovered', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Reset failed')
      setResetConfirm(false)
      await loadPreview()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  const hasRun = !!lastRefresh || entities.length > 0

  return (
    <div style={{ marginTop: 18, padding: '16px 18px', background: P.white, border: '1px solid ' + P.border, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: P.text, margin: 0 }}>Entities</h3>
          {totalDistinct != null && totalDistinct > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: P.accentBg, color: P.accent, border: '1px solid ' + P.accent + '40' }}>
              {totalDistinct.toLocaleString()} {manageOpen ? 'in catalog' : 'found'}
            </span>
          )}
          {scopeType === 'collection' && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 20, background: P.bg, color: P.textMute, border: '1px solid ' + P.border }}>
              brand-wide
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {savedFlash && (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#16a34a' }}>✓ Catalog saved</span>
          )}
          {schemaDirty && !discovering && (
            <span style={{ fontSize: 11, color: P.textMute }}>Save schema first</span>
          )}
          {manageOpen ? (
            <>
              <button
                onClick={function() { void saveHidden() }}
                disabled={savingHidden || dirtyCount === 0}
                title={dirtyCount === 0 ? 'No unsaved visibility changes' : 'Save your hide/show changes'}
                style={{
                  fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 7,
                  background: (savingHidden || dirtyCount === 0) ? P.bg : P.accent,
                  color: (savingHidden || dirtyCount === 0) ? P.textFaint : P.white,
                  border: '1px solid ' + ((savingHidden || dirtyCount === 0) ? P.border : P.accent),
                  cursor: (savingHidden || dirtyCount === 0) ? 'default' : 'pointer', fontFamily: 'inherit',
                }}>
                {savingHidden ? 'Saving…' : dirtyCount > 0 ? 'Save (' + dirtyCount + ')' : 'Saved'}
              </button>
              <button
                onClick={closeManage}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 7,
                  background: P.bg, color: P.textMid, border: '1px solid ' + P.border,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                Close
              </button>
            </>
          ) : (
            <button
              onClick={function() { setManageOpen(true); setResetConfirm(false) }}
              style={{
                fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 7,
                background: P.bg, color: P.textMid, border: '1px solid ' + P.border,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              Manage
            </button>
          )}
          <button
            onClick={function() { void runDiscover() }}
            disabled={discovering || !!schemaDirty}
            title={schemaDirty ? 'Save your schema changes before re-running discovery — the field selection affects which text is scanned' : undefined}
            style={{
              fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 7,
              background: (discovering || schemaDirty) ? P.bg : P.accentBg,
              color: (discovering || schemaDirty) ? P.textFaint : P.accent,
              border: '1px solid ' + ((discovering || schemaDirty) ? P.border : P.accent + '40'),
              cursor: (discovering || schemaDirty) ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}>
            {discovering ? 'Discovering…' : (hasRun ? 'Re-discover' : 'Discover entities')}
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: P.textMute, lineHeight: 1.5, marginBottom: 8 }}>
        {manageOpen
          ? <>Add menu items, competitor brands, or other named entities by hand. Manual entries survive re-discovery. Hide noisy discovered entries — they stay hidden so the next run does not resurface them.</>
          : <>The named things reviewers talk about {'—'} dishes, drinks, named staff, competitor brands. Discovery runs Claude Haiku over a sample of rows. Counts are computed live from full-text search, so they stay accurate across the whole dataset. Costs a few cents per run.</>
        }
      </div>

      {lastRefresh && !manageOpen && (
        <div style={{ fontSize: 11, color: P.textFaint, marginBottom: 8 }}>
          Last updated {new Date(lastRefresh.triggered_at).toLocaleString()}
          {lastRefresh.entities_after != null && (
            <> {'·'} {lastRefresh.entities_after.toLocaleString()} entities in catalog</>
          )}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: P.danger, background: P.dangerBg, border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
          {error}
        </div>
      )}

      {(loading || discovering) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <LottieLoader size={28} />
        </div>
      )}

      {/* Manage-mode controls */}
      {manageOpen && !loading && !discovering && (
        <div style={{ marginBottom: 12 }}>
          {/* Single-add form */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const, padding: '8px 10px', background: P.bg, border: '1px solid ' + P.border, borderRadius: 8, marginBottom: 8 }}>
            <input
              type="text"
              value={addCanonical}
              onChange={function(e) { setAddCanonical(e.target.value) }}
              placeholder="Entity name (e.g. Filet Mignon)"
              style={{ flex: '1 1 200px', minWidth: 160, fontSize: 12, padding: '5px 9px', borderRadius: 6, border: '1px solid ' + P.border, background: P.white, fontFamily: 'inherit' }}
            />
            <select
              value={addCategory}
              onChange={function(e) { setAddCategory(e.target.value as typeof CATEGORIES[number]) }}
              style={{ fontSize: 12, padding: '5px 9px', borderRadius: 6, border: '1px solid ' + P.border, background: P.white, fontFamily: 'inherit' }}>
              {CATEGORIES.map(function(c) { return <option key={c} value={c}>{c}</option> })}
            </select>
            <input
              type="text"
              value={addAliases}
              onChange={function(e) { setAddAliases(e.target.value) }}
              placeholder="Aliases, comma-separated (optional)"
              style={{ flex: '1 1 200px', minWidth: 160, fontSize: 12, padding: '5px 9px', borderRadius: 6, border: '1px solid ' + P.border, background: P.white, fontFamily: 'inherit' }}
            />
            <button
              onClick={function() { void addOne() }}
              disabled={adding || addCanonical.trim().length < 2}
              style={{
                fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
                background: (adding || addCanonical.trim().length < 2) ? P.bg : P.accent,
                color: (adding || addCanonical.trim().length < 2) ? P.textFaint : P.white,
                border: '1px solid ' + ((adding || addCanonical.trim().length < 2) ? P.border : P.accent),
                cursor: (adding || addCanonical.trim().length < 2) ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}>
              {adding ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={function() { setBulkOpen(function(v) { return !v }); setBulkResult(null) }}
              style={{
                fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6,
                background: P.white, color: P.textMid,
                border: '1px solid ' + P.border, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {bulkOpen ? 'Hide bulk' : 'Bulk import'}
            </button>
          </div>

          {/* Bulk paste */}
          {bulkOpen && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: P.textFaint, marginBottom: 4 }}>
                One entity per line. Format: <code>Canonical Name | category | alias1, alias2</code>. Category and aliases optional. Lines starting with # are skipped.
              </div>
              <textarea
                value={bulkText}
                onChange={function(e) { setBulkText(e.target.value) }}
                rows={6}
                placeholder={'Filet Mignon | food | filet, the filet\nOld Fashioned | drink\nOutback Steakhouse | brand'}
                style={{ width: '100%', fontSize: 12, padding: '8px 10px', borderRadius: 6, border: '1px solid ' + P.border, background: P.white, fontFamily: 'monospace', boxSizing: 'border-box' as const }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <button
                  onClick={function() { void submitBulk() }}
                  disabled={bulkSubmitting || bulkText.trim().length === 0}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
                    background: (bulkSubmitting || bulkText.trim().length === 0) ? P.bg : P.accent,
                    color: (bulkSubmitting || bulkText.trim().length === 0) ? P.textFaint : P.white,
                    border: '1px solid ' + ((bulkSubmitting || bulkText.trim().length === 0) ? P.border : P.accent),
                    cursor: (bulkSubmitting || bulkText.trim().length === 0) ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}>
                  {bulkSubmitting ? 'Importing…' : 'Import all'}
                </button>
                {bulkResult && <span style={{ fontSize: 11, color: P.textMute }}>{bulkResult}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && !discovering && entities.length === 0 && !error && (
        <div style={{ fontSize: 11, color: P.textFaint, fontStyle: 'italic' as const }}>
          {manageOpen
            ? 'No entities yet. Add one above, or click "Discover entities" to run NER.'
            : (hasRun
              ? 'No entities surfaced yet. Re-discover to sample more rows.'
              : 'No entities discovered yet. Click "Discover entities" to run.')}
        </div>
      )}

      {/* Pill view (preview mode) — kept compact */}
      {!manageOpen && !loading && !discovering && entities.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4 }}>
          {entities.map(function(e) {
            const color = CATEGORY_COLOR[e.category] || CATEGORY_COLOR.other
            return (
              <span key={e.slug} title={e.canonical + ' · ' + e.category + ' · ' + e.mentions.toLocaleString() + ' rows'}
                style={{
                  fontSize: 11, padding: '3px 10px',
                  background: P.bg, color: P.text,
                  borderRadius: 12, border: '1px solid ' + P.border,
                  display: 'inline-flex' as const, alignItems: 'center', gap: 6,
                }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600 }}>{e.canonical}</span>
                <span style={{ color: P.textFaint }}>{e.mentions.toLocaleString()}</span>
              </span>
            )
          })}
        </div>
      )}

      {/* Row view (manage mode) — denser, with per-row controls.
          Fixed-width columns + minmax(0,1fr) on the Entity column keep every
          row's category/source/mentions/actions at the same X. Earlier
          revisions used `auto` for the Actions column which let row-specific
          button sets (Hide+Edit+Delete vs Unhide only) drift the rest. */}
      {manageOpen && !loading && !discovering && entities.length > 0 && (function() {
        // Fixed columns for every cell — Edit / Hide / Delete each get their
        // own column so buttons never shift row-to-row regardless of which
        // action set the row qualifies for (manual gets Delete, discovered
        // doesn't — empty cell, NOT a different column width).
        const GRID = 'minmax(0,1fr) 90px 110px 90px 70px 80px 80px'
        return (
        <div style={{ border: '1px solid ' + P.border, borderRadius: 8, overflow: 'hidden' as const }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 0, fontSize: 10, fontWeight: 700, color: P.textFaint, padding: '8px 12px', background: P.bg, borderBottom: '1px solid ' + P.border, textTransform: 'uppercase' as const, letterSpacing: 0.4 }}>
            <div>Entity</div>
            <div>Category</div>
            <div style={{ textAlign: 'center' as const }}>Source</div>
            <div style={{ textAlign: 'right' as const }}>Mentions</div>
            <div style={{ textAlign: 'center' as const }}>Edit</div>
            <div style={{ textAlign: 'center' as const }}>Visibility</div>
            <div style={{ textAlign: 'center' as const }}>Delete</div>
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' as const, background: P.white }}>
            {(function() {
              // Group by category (type). Each group gets a header with a None/All
              // (Show all / Hide all) control so you can ignore a whole type at once.
              const ORDER = ['food', 'drink', 'place', 'person', 'brand', 'other']
              const byCat: Record<string, EntityRow[]> = {}
              entities.forEach(function(e) { (byCat[e.category] = byCat[e.category] || []).push(e) })
              const cats = ORDER.filter(function(c) { return byCat[c] }).concat(Object.keys(byCat).filter(function(c) { return ORDER.indexOf(c) === -1 }).sort())
              return cats.map(function(cat) {
                const items = byCat[cat]
                const shown = items.filter(function(e) { return !effHidden(e) }).length
                const catColor = CATEGORY_COLOR[cat] || CATEGORY_COLOR.other
                return (
                <div key={'cat-' + cat}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: P.bg, borderBottom: '1px solid ' + P.border, position: 'sticky' as const, top: 0, zIndex: 1 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 4, background: catColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: P.text, textTransform: 'capitalize' as const }}>{cat}</span>
                    <span style={{ fontSize: 10, color: P.textFaint }}>{shown}/{items.length} shown</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button onClick={function() { stageCategory(cat, false) }} title={'Show all ' + cat} style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: P.white, color: P.textMid, border: '1px solid ' + P.border, cursor: 'pointer', fontFamily: 'inherit' }}>Show all</button>
                      <button onClick={function() { stageCategory(cat, true) }} title={'Hide all ' + cat} style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: P.white, color: P.textMid, border: '1px solid ' + P.border, cursor: 'pointer', fontFamily: 'inherit' }}>Hide all</button>
                    </div>
                  </div>
                  {items.map(function(e) {
              const color = CATEGORY_COLOR[e.category] || CATEGORY_COLOR.other
              const isManual = e.source === 'manual'
              const isHidden = effHidden(e)
              const busy = rowBusy === e.slug
              const isEditing = editSlug === e.slug

              if (isEditing) {
                // ── Edit form replaces the row in-place ─────────────────────
                return (
                  <div key={e.slug}
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid ' + P.border,
                      background: P.accentBg,
                      display: 'flex', flexDirection: 'column' as const, gap: 8,
                    }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: 8, alignItems: 'center' }}>
                      <input
                        type="text"
                        value={editCanonical}
                        onChange={function(ev) { setEditCanonical(ev.target.value) }}
                        placeholder="Entity name"
                        style={{ fontSize: 13, fontWeight: 600, padding: '6px 10px', borderRadius: 6, border: '1px solid ' + P.border, background: P.white, fontFamily: 'inherit', minWidth: 0 }}
                      />
                      <select
                        value={editCategory}
                        onChange={function(ev) { setEditCategory(ev.target.value as typeof CATEGORIES[number]) }}
                        style={{ fontSize: 12, padding: '6px 9px', borderRadius: 6, border: '1px solid ' + P.border, background: P.white, fontFamily: 'inherit' }}>
                        {CATEGORIES.map(function(c) { return <option key={c} value={c}>{c}</option> })}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: P.textFaint, marginBottom: 4 }}>Aliases (comma-separated)</div>
                      <textarea
                        value={editAliases}
                        onChange={function(ev) { setEditAliases(ev.target.value) }}
                        rows={2}
                        placeholder="filet, the filet, mignon"
                        style={{ width: '100%', fontSize: 12, padding: '6px 9px', borderRadius: 6, border: '1px solid ' + P.border, background: P.white, fontFamily: 'inherit', boxSizing: 'border-box' as const, resize: 'vertical' as const }}
                      />
                    </div>
                    {editError && (
                      <div style={{ fontSize: 11, color: P.danger }}>{editError}</div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' as const, gap: 6 }}>
                      <button
                        onClick={cancelEdit}
                        disabled={editSaving}
                        style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, background: P.white, color: P.textMid, border: '1px solid ' + P.border, cursor: editSaving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                        Cancel
                      </button>
                      <button
                        onClick={function() { void saveEdit() }}
                        disabled={editSaving || editCanonical.trim().length < 2}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '5px 14px', borderRadius: 6,
                          background: (editSaving || editCanonical.trim().length < 2) ? P.bg : P.accent,
                          color: (editSaving || editCanonical.trim().length < 2) ? P.textFaint : P.white,
                          border: '1px solid ' + ((editSaving || editCanonical.trim().length < 2) ? P.border : P.accent),
                          cursor: (editSaving || editCanonical.trim().length < 2) ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit',
                        }}>
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                )
              }

              // ── Display row ─────────────────────────────────────────────
              return (
                <div key={e.slug}
                  style={{
                    display: 'grid', gridTemplateColumns: GRID,
                    gap: 0, fontSize: 12,
                    padding: '9px 12px',
                    borderBottom: '1px solid ' + P.border,
                    background: isHidden ? P.bg : P.white,
                    opacity: isHidden ? 0.6 : 1,
                    alignItems: 'center',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column' as const, minWidth: 0, gap: 1 }}>
                      <span style={{ fontWeight: 600, color: P.text, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }} title={e.canonical}>{e.canonical}</span>
                      {e.aliases && e.aliases.length > 0 && (
                        <span style={{ fontSize: 10, color: P.textFaint, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }} title={'Aliases: ' + e.aliases.join(', ')}>
                          {e.aliases.slice(0, 4).join(', ')}{e.aliases.length > 4 ? ' +' + (e.aliases.length - 4) + ' more' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ color: P.textMid, textTransform: 'capitalize' as const }}>{e.category}</div>
                  <div style={{ display: 'flex', justifyContent: 'center' as const, alignItems: 'center' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                      background: isManual ? P.accentBg : P.bg,
                      color: isManual ? P.accent : P.textMute,
                      border: '1px solid ' + (isManual ? P.accent + '40' : P.border),
                      letterSpacing: 0.2,
                    }}>
                      {isManual ? 'manual' : 'discovered'}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' as const, color: P.text, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{e.mentions.toLocaleString()}</div>
                  <div style={{ display: 'flex', justifyContent: 'center' as const }}>
                    <button
                      onClick={function() { startEdit(e) }}
                      disabled={busy}
                      title="Edit name, category, and aliases"
                      style={{
                        fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 5,
                        background: P.white, color: P.textMid,
                        border: '1px solid ' + P.border, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
                      }}>
                      Edit
                    </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center' as const }}>
                    <button
                      onClick={function() { stageHidden(e.slug, !!e.hidden, !isHidden) }}
                      title={isHidden ? 'Show (visible in cloud / compare / drill). Click Save to persist.' : 'Hide (excluded from cloud / compare / drill; survives re-discovery). Click Save to persist.'}
                      style={{
                        fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 5,
                        background: (e.slug in pendingHidden) ? P.accentBg : P.white,
                        color: (e.slug in pendingHidden) ? P.accent : P.textMid,
                        border: '1px solid ' + ((e.slug in pendingHidden) ? P.accent + '40' : P.border), cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                      {isHidden ? 'Show' : 'Hide'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center' as const }}>
                    {isManual ? (
                      <button
                        onClick={function() { void deleteManual(e) }}
                        disabled={busy}
                        title="Delete this manual entry (cannot undo)"
                        style={{
                          fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 5,
                          background: P.white, color: P.danger,
                          border: '1px solid #fecaca', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
                        }}>
                        Delete
                      </button>
                    ) : (
                      <span style={{ fontSize: 9, color: P.textFaint }} title="Discovered entries can't be hard-deleted — Hide them instead, so re-discovery doesn't resurface them.">{'—'}</span>
                    )}
                  </div>
                </div>
              )
                  })}
                </div>
                )
              })
            })()}
          </div>
        </div>
        )
      })()}

      {/* Reset-discovered escape hatch — admin action, two-step confirm */}
      {manageOpen && !loading && !discovering && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed ' + P.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' as const }}>
          <span style={{ fontSize: 11, color: P.textFaint }}>
            Reset discovered entries removes every <code style={{ fontSize: 10, background: P.bg, padding: '0 4px', borderRadius: 3 }}>discovered</code> row in this scope. Manual entries are kept.
          </span>
          {resetConfirm ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={function() { setResetConfirm(false) }}
                disabled={resetting}
                style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, background: P.white, color: P.textMid, border: '1px solid ' + P.border, cursor: resetting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button
                onClick={function() { void resetDiscovered() }}
                disabled={resetting}
                style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, background: P.danger, color: P.white, border: '1px solid ' + P.danger, cursor: resetting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                {resetting ? 'Resetting…' : 'Yes, reset discovered'}
              </button>
            </div>
          ) : (
            <button
              onClick={function() { setResetConfirm(true) }}
              style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, background: P.white, color: P.danger, border: '1px solid #fecaca', cursor: 'pointer', fontFamily: 'inherit' }}>
              Reset discovered
            </button>
          )}
        </div>
      )}
    </div>
  )
}
