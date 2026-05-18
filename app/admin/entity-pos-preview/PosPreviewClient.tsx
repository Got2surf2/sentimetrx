'use client'

// SPIKE preview UI — Claude NER vs POS noun-phrase extraction.
// Two columns. No DB writes. Run, look, decide.

import { useState, useMemo } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

interface Dataset {
  id:          string
  name:        string
  source:      string | null
  brand_tag:   string | null
  org_id:      string | null
  row_count:   number | null
}

interface ClaudeEntity {
  canonical: string
  category:  string
  aliases:   string[]
}

interface PosPhrase {
  phrase:   string
  raw:      string
  count:    number
  rowCount: number
}

interface RunResult {
  sample_count: number
  sample_texts: string[]
  scope_type:   'dataset' | 'collection'
  claude: { entities: ClaudeEntity[]; inputTokens: number; outputTokens: number; error: string | null }
  pos:    { phrases: PosPhrase[]; total_distinct: number }
}

const C = {
  bg:      '#f7f7f8',
  white:   '#ffffff',
  border:  '#e5e7eb',
  text:    '#111827',
  mid:     '#374151',
  mute:    '#6b7280',
  faint:   '#9ca3af',
  accent:  '#e8622a',
  accentBg:'#fff4ef',
  navy:    '#0d2b45',
  teal:    '#0f7173',
  tealBg:  '#e0f0f0',
  purple:  '#7c3aed',
}

export default function PosPreviewClient({ datasets }: { datasets: Dataset[] }) {
  const [datasetId, setDatasetId]   = useState('')
  const [sampleSize, setSampleSize] = useState(100)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [result, setResult]         = useState<RunResult | null>(null)

  async function run() {
    if (!datasetId) { setError('Pick a dataset first'); return }
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/admin/entity-pos-preview?datasetId=' + datasetId + '&sampleSize=' + sampleSize)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Run failed')
      setResult(data)
    } catch (err: any) {
      setError(err?.message || 'Run failed')
    } finally {
      setLoading(false)
    }
  }

  // Overlap detection — which POS phrases also appear (substring-match) in
  // Claude's entity list. Rough heuristic, good enough for eyeballing.
  const overlap = useMemo(function() {
    if (!result) return { posMatchesClaude: new Set<string>(), claudeMatchedByPos: new Set<string>() }
    const posSet = new Set<string>()
    const claudeSet = new Set<string>()
    for (const e of result.claude.entities) {
      const ec = e.canonical.toLowerCase()
      for (const p of result.pos.phrases) {
        if (ec.includes(p.phrase) || p.phrase.includes(ec)) {
          posSet.add(p.phrase)
          claudeSet.add(e.canonical)
        }
      }
    }
    return { posMatchesClaude: posSet, claudeMatchedByPos: claudeSet }
  }, [result])

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 4 }}>Entity POS Pre-Pass Preview</h1>
      <p style={{ fontSize: 13, color: C.mute, marginBottom: 24, lineHeight: 1.55 }}>
        Read-only spike. Samples N rows from a dataset, runs Claude NER and a compromise-based POS / lemma extractor in parallel, and shows both lists side by side. <strong>Does not write to the entity catalog.</strong>
      </p>

      {/* Controls */}
      <div style={{ background: C.white, border: '1px solid ' + C.border, borderRadius: 12, padding: '16px 18px', marginBottom: 18, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 360px', minWidth: 280 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.mute, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Dataset</label>
          <select value={datasetId} onChange={function(e) { setDatasetId(e.target.value) }}
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: '1px solid ' + C.border, background: C.white, color: C.text, fontFamily: 'inherit', cursor: 'pointer' }}>
            <option value="">— Pick a dataset —</option>
            {datasets.map(function(d) {
              const label = (d.brand_tag ? d.brand_tag + ' · ' : '') + d.name + (d.row_count ? ' (' + d.row_count.toLocaleString() + ' rows)' : '')
              return <option key={d.id} value={d.id}>{label}</option>
            })}
          </select>
        </div>
        <div style={{ width: 140 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.mute, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Sample size</label>
          <input type="number" value={sampleSize} onChange={function(e) { setSampleSize(Number(e.target.value)) }} min={25} max={500}
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: '1px solid ' + C.border, background: C.white, color: C.text, fontFamily: 'inherit' }} />
        </div>
        <button onClick={run} disabled={loading || !datasetId}
          style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700, borderRadius: 7, background: loading || !datasetId ? C.bg : C.accent, color: loading || !datasetId ? C.faint : C.white, border: 'none', cursor: loading || !datasetId ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
          {loading ? 'Running…' : 'Run comparison'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, fontSize: 13, marginBottom: 18 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <LottieLoader size={80} message="Running NER + POS extraction…" />
        </div>
      )}

      {result && !loading && (
        <>
          {/* Stats strip */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <Stat label="Sample size" value={result.sample_count.toLocaleString()} />
            <Stat label="Scope" value={result.scope_type} />
            <Stat label="Claude entities" value={result.claude.entities.length.toLocaleString()} accent={C.accent} />
            <Stat label="Claude tokens (in/out)" value={result.claude.inputTokens.toLocaleString() + ' / ' + result.claude.outputTokens.toLocaleString()} />
            <Stat label="POS distinct phrases" value={result.pos.total_distinct.toLocaleString()} accent={C.teal} />
            <Stat label="POS shown (top 100)" value={Math.min(100, result.pos.phrases.length).toLocaleString()} />
          </div>

          {/* Two-column results */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Left: Claude */}
            <div style={{ background: C.white, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <h3 style={{ fontSize: 14, fontWeight: 800, color: C.accent, margin: 0 }}>Claude NER</h3>
                <span style={{ fontSize: 11, color: C.mute }}>current pipeline · 1 Haiku call</span>
              </div>
              {result.claude.error && (
                <div style={{ fontSize: 12, color: '#991b1b', marginBottom: 8 }}>{result.claude.error}</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {result.claude.entities.map(function(e, i) {
                  const matched = overlap.claudeMatchedByPos.has(e.canonical)
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 6, background: matched ? C.tealBg : C.bg }}>
                      <span style={{ fontSize: 11, color: C.faint, width: 24 }}>{i + 1}.</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{e.canonical}</span>
                      <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: C.bg, color: C.mute, border: '1px solid ' + C.border, marginLeft: 'auto' }}>{e.category}</span>
                      {matched && <span title="Also in POS list" style={{ fontSize: 10, color: C.teal, fontWeight: 700 }}>✓</span>}
                    </div>
                  )
                })}
                {result.claude.entities.length === 0 && (
                  <div style={{ fontSize: 12, color: C.faint, fontStyle: 'italic', padding: 8 }}>No entities returned.</div>
                )}
              </div>
            </div>

            {/* Right: POS */}
            <div style={{ background: C.white, border: '1px solid ' + C.border, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <h3 style={{ fontSize: 14, fontWeight: 800, color: C.teal, margin: 0 }}>POS pre-pass (compromise)</h3>
                <span style={{ fontSize: 11, color: C.mute }}>noun phrases + singularised · no AI call</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {result.pos.phrases.map(function(p, i) {
                  const matched = overlap.posMatchesClaude.has(p.phrase)
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 6, background: matched ? C.tealBg : C.bg }}>
                      <span style={{ fontSize: 11, color: C.faint, width: 24 }}>{i + 1}.</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{p.phrase}</span>
                      <span style={{ fontSize: 11, color: C.faint, marginLeft: 'auto' }}>{p.count.toLocaleString()} · {p.rowCount} rows</span>
                      {matched && <span title="Also in Claude list" style={{ fontSize: 10, color: C.teal, fontWeight: 700 }}>✓</span>}
                    </div>
                  )
                })}
                {result.pos.phrases.length === 0 && (
                  <div style={{ fontSize: 12, color: C.faint, fontStyle: 'italic', padding: 8 }}>No phrases extracted.</div>
                )}
              </div>
            </div>
          </div>

          {/* Sample texts at the bottom for sanity */}
          <details style={{ marginTop: 22 }}>
            <summary style={{ fontSize: 12, fontWeight: 700, color: C.mute, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 1.5 }}>First 10 sample texts</summary>
            <div style={{ marginTop: 10, background: C.white, border: '1px solid ' + C.border, borderRadius: 10, padding: '14px 16px' }}>
              {result.sample_texts.map(function(t, i) {
                return (
                  <div key={i} style={{ fontSize: 12, color: C.mid, padding: '6px 0', borderBottom: i < result.sample_texts.length - 1 ? '1px solid ' + C.border : 'none', lineHeight: 1.55 }}>
                    <span style={{ color: C.faint, marginRight: 6 }}>[{i + 1}]</span>
                    {t.length > 400 ? t.slice(0, 400) + '…' : t}
                  </div>
                )
              })}
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid ' + C.border, borderRadius: 8, padding: '8px 14px' }}>
      <div style={{ fontSize: 9, color: C.faint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: accent || C.text, marginTop: 2 }}>{value}</div>
    </div>
  )
}
