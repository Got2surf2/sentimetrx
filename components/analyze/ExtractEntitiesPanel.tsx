'use client'

// components/analyze/ExtractEntitiesPanel.tsx
// One panel per dataset on the Schema tab. Triggers entity *discovery* for
// the dataset's scope (its own catalog, or the shared brand-/collection
// catalog it belongs to), shows the last-discovery state, and previews the
// top entities with LIVE full-text counts.
//
// Backend:
//   POST /api/datasets/[id]/discover-entities
//   GET  /api/datasets/[id]/entities?limit=12

import { useEffect, useState } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

interface EntityRow {
  slug:      string
  canonical: string
  category:  string
  mentions:  number
}

interface LastRefresh {
  triggered_at:   string
  triggered_by:   string
  entities_after: number | null
}

interface Props {
  datasetId: string
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
}

// Categories from lib/entityDiscovery.ts: food | drink | place | person | brand | other
const CATEGORY_COLOR: Record<string, string> = {
  food:   '#EA580C',
  drink:  '#7C3AED',
  place:  '#0F7173',
  person: '#1E40AF',
  brand:  '#B45309',
  other:  '#8FA3AE',
}

export default function ExtractEntitiesPanel({ datasetId }: Props) {
  const [loading, setLoading]       = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const [error, setError]           = useState('')
  const [entities, setEntities]     = useState<EntityRow[]>([])
  const [totalDistinct, setTotalDistinct] = useState<number | null>(null)
  const [scopeType, setScopeType]   = useState<'dataset' | 'collection' | null>(null)
  const [lastRefresh, setLastRefresh] = useState<LastRefresh | null>(null)

  async function loadPreview() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/entities?limit=12')
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
    } catch (err: any) {
      setError(err?.message || 'Failed to load entities')
    } finally {
      setLoading(false)
    }
  }

  useEffect(function() {
    loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId])

  async function runDiscover() {
    setDiscovering(true)
    setError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/discover-entities', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Discovery failed')
      await loadPreview()
    } catch (err: any) {
      setError(err?.message || 'Discovery failed')
    } finally {
      setDiscovering(false)
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
              {totalDistinct.toLocaleString()} found
            </span>
          )}
          {scopeType === 'collection' && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 20, background: P.bg, color: P.textMute, border: '1px solid ' + P.border }}>
              brand-wide
            </span>
          )}
        </div>
        <button
          onClick={runDiscover}
          disabled={discovering}
          style={{
            fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 7,
            background: discovering ? P.bg : P.accentBg, color: P.accent,
            border: '1px solid ' + P.accent + '40', cursor: discovering ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}>
          {discovering ? 'Discovering…' : (hasRun ? 'Re-discover' : 'Discover entities')}
        </button>
      </div>

      <div style={{ fontSize: 11, color: P.textMute, lineHeight: 1.5, marginBottom: 8 }}>
        Runs Claude Haiku over a sample of rows to find the named entities {'—'} dishes, places, people, brands {'—'} this data talks about. Counts are computed live from full-text search, so they stay accurate across the whole dataset. Costs a few cents per run.
      </div>

      {lastRefresh && (
        <div style={{ fontSize: 11, color: P.textFaint, marginBottom: 8 }}>
          Last discovered {new Date(lastRefresh.triggered_at).toLocaleString()}
          {lastRefresh.entities_after != null && (
            <> {'·'} {lastRefresh.entities_after.toLocaleString()} entities in catalog</>
          )}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
          {error}
        </div>
      )}

      {(loading || discovering) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <LottieLoader size={28} />
        </div>
      )}

      {!loading && !discovering && entities.length === 0 && !error && (
        <div style={{ fontSize: 11, color: P.textFaint, fontStyle: 'italic' as const }}>
          {hasRun
            ? 'No entities surfaced yet. Re-discover to sample more rows.'
            : 'No entities discovered yet. Click "Discover entities" to run.'}
        </div>
      )}

      {!loading && !discovering && entities.length > 0 && (
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
    </div>
  )
}
