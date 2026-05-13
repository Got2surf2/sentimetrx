'use client'

// components/analyze/ExtractEntitiesPanel.tsx
// Embedded in the Schema-tab FieldCard for open-ended fields. Lets the
// caller trigger entity extraction on this field, shows last-extraction
// state, and previews the top entities.
//
// Backend:
//   POST /api/datasets/[id]/extract-entities  { field }
//   GET  /api/datasets/[id]/entities?field=<field>&limit=10

import { useEffect, useState } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

interface EntityRow {
  canonical: string
  category: string
  mentions: number
  distinct_rows?: number
}

interface Props {
  datasetId: string
  field:     string
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
  accentMid: '#fcd5c0',
}

const CATEGORY_COLOR: Record<string, string> = {
  religious: '#E8B84B', health: '#DC2626', humanitarian: '#0F7173',
  education: '#00B4D8', youth: '#6D28D9', animal: '#D97706',
  veterans: '#0D2B45', environmental: '#059669', community: '#E8632A',
  arts: '#4A6572', business: '#0F766E', government: '#1E40AF',
  media: '#7C3AED', sports: '#059669', food: '#EA580C', other: '#8FA3AE',
}

export default function ExtractEntitiesPanel({ datasetId, field }: Props) {
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState('')
  const [entities, setEntities] = useState<EntityRow[]>([])
  const [totalDistinct, setTotalDistinct] = useState<number | null>(null)
  const [lastRun, setLastRun] = useState<{ at: string; rows_scanned: number; mentions_inserted: number } | null>(null)

  async function loadPreview() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/entities?field=' + encodeURIComponent(field) + '&limit=10')
      if (!res.ok) {
        setEntities([])
        setTotalDistinct(null)
        return
      }
      const data = await res.json()
      setEntities(data.entities || [])
      setTotalDistinct(typeof data.total_distinct === 'number' ? data.total_distinct : null)
    } catch (err: any) {
      setError(err?.message || 'Failed to load entities')
    } finally {
      setLoading(false)
    }
  }

  async function loadState() {
    try {
      const res = await fetch('/api/datasets/' + datasetId)
      if (!res.ok) return
      const data = await res.json()
      const state = data?.dataset?.entity_extraction_state || data?.entity_extraction_state || {}
      if (state && state[field]) setLastRun(state[field])
    } catch { /* non-fatal */ }
  }

  useEffect(function() {
    loadPreview()
    loadState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, field])

  async function runExtract() {
    setExtracting(true)
    setError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/extract-entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Extraction failed')
      setLastRun({
        at: new Date().toISOString(),
        rows_scanned: data.rows_scanned,
        mentions_inserted: data.mentions_inserted,
      })
      await loadPreview()
    } catch (err: any) {
      setError(err?.message || 'Extraction failed')
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div onClick={function(e) { e.stopPropagation() }}
      style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid ' + P.border }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: P.textFaint, letterSpacing: '.08em', textTransform: 'uppercase' as const }}>
          Entities
          {totalDistinct != null && totalDistinct > 0 && (
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: P.accentBg, color: P.accent, border: '1px solid ' + P.accent + '40' }}>
              {totalDistinct.toLocaleString()} distinct
            </span>
          )}
        </div>
        <button
          onClick={runExtract}
          disabled={extracting}
          style={{
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
            background: extracting ? P.bg : P.accentBg, color: P.accent,
            border: '1px solid ' + P.accent + '40', cursor: extracting ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}>
          {extracting ? 'Extracting…' : (entities.length > 0 ? 'Re-extract' : 'Extract entities')}
        </button>
      </div>

      <div style={{ fontSize: 11, color: P.textMute, lineHeight: 1.5, marginBottom: 8 }}>
        Runs Claude Haiku over unique values in this field to group variants ("Red Cross" / "ARC" {'→'} "American Red Cross") and tag a category. Results power the theme card's top-entities section and TextMine filters. Costs a few cents per dataset.
      </div>

      {lastRun && (
        <div style={{ fontSize: 11, color: P.textFaint, marginBottom: 8 }}>
          Last extracted {new Date(lastRun.at).toLocaleString()} {'·'} {lastRun.rows_scanned.toLocaleString()} rows scanned {'·'} {lastRun.mentions_inserted.toLocaleString()} mentions
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
          {error}
        </div>
      )}

      {(loading || extracting) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <LottieLoader size={28} />
        </div>
      )}

      {!loading && !extracting && entities.length === 0 && !error && (
        <div style={{ fontSize: 11, color: P.textFaint, fontStyle: 'italic' as const }}>
          No entities extracted yet. Click {'"'}Extract entities{'"'} to run.
        </div>
      )}

      {!loading && entities.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4 }}>
          {entities.map(function(e) {
            const color = CATEGORY_COLOR[e.category] || CATEGORY_COLOR.other
            return (
              <span key={e.canonical} style={{
                fontSize: 11, padding: '3px 10px',
                background: P.white, color: P.text,
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
