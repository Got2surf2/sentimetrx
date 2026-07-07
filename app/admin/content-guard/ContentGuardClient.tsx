'use client'

import { useState, useRef } from 'react'

interface TestResult {
  text: string
  label: string | null
  sentiment: string
  flags: string[]
  maxSeverity: string | null
  action: string
  moderation: { toxicity: number; threat: number; sexual: number; identity: number; categories: string[] } | null
}

interface Stats {
  total: number; flagged: number; deleted: number; hidden: number; review: number; missed: number; falsePositive: number
}

interface LabelBreakdown {
  total: number; flagged: number; deleted: number; hidden: number; review: number; missed: number
}

const ACTION_COLORS: Record<string, string> = {
  auto_delete: '#DC2626',
  auto_hide: '#F59E0B',
  review: '#3B82F6',
  none: '#9CA3AF',
}

const ACTION_LABELS: Record<string, string> = {
  auto_delete: 'Delete',
  auto_hide: 'Hide',
  review: 'Review',
  none: 'Pass',
}

const SEVERITY_COLORS: Record<string, string> = {
  severe: '#DC2626',
  rude: '#F59E0B',
  mild: '#6B7280',
}

export default function ContentGuardClient() {
  var [mode, setMode] = useState<'paste' | 'csv'>('paste')
  var [inputText, setInputText] = useState('')
  var [results, setResults] = useState<TestResult[]>([])
  var [stats, setStats] = useState<Stats | null>(null)
  var [byLabel, setByLabel] = useState<Record<string, LabelBreakdown>>({})
  var [loading, setLoading] = useState(false)
  var [useModeration, setUseModeration] = useState(false)
  var [filter, setFilter] = useState<string>('all')
  var fileRef = useRef<HTMLInputElement>(null)

  async function runTest(texts: string[], labels?: string[]) {
    setLoading(true)
    try {
      var res = await fetch('/api/admin/content-guard-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts, labels, useModeration }),
      })
      var data = await res.json()
      setResults(data.results || [])
      setStats(data.stats || null)
      setByLabel(data.byLabel || {})
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  function handlePasteRun() {
    var lines = inputText.split('\n').map(function(l) { return l.trim() }).filter(function(l) { return l.length > 0 })
    if (lines.length === 0) return
    void runTest(lines)
  }

  function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    var file = e.target.files?.[0]
    if (!file) return
    var reader = new FileReader()
    reader.onload = function(evt) {
      var csv = evt.target?.result as string
      var lines = csv.split('\n')
      var headers = lines[0].toLowerCase()
      // Try to find text and label columns
      var cols = lines[0].split(',').map(function(h) { return h.trim().toLowerCase().replace(/"/g, '') })
      var textIdx = cols.findIndex(function(c) { return c === 'tweet' || c === 'text' || c === 'comment' || c === 'message' })
      var labelIdx = cols.findIndex(function(c) { return c === 'class' || c === 'label' })

      if (textIdx === -1) {
        // Fallback: if CSV has a 'tweet' field at position 6 (Davidson format)
        if (cols.length >= 7) { textIdx = 6; labelIdx = 5 }
        else { alert('Could not find text column. Expected: tweet, text, comment, or message'); return }
      }

      var texts: string[] = []
      var labels: string[] = []
      var labelMap: Record<string, string> = { '0': 'hate', '1': 'offensive', '2': 'clean' }

      for (var i = 1; i < lines.length && texts.length < 500; i++) {
        var line = lines[i]
        if (!line.trim()) continue
        var parts = line.split(',')
        if (parts.length <= textIdx) continue
        var text = (textIdx === 6 ? parts.slice(6).join(',') : parts[textIdx]).replace(/^"|"$/g, '').trim()
        if (text.length < 3) continue
        text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/RT @\w+:?\s*/g, '').trim()
        texts.push(text)
        if (labelIdx >= 0) {
          var raw = parts[labelIdx].replace(/"/g, '').trim()
          labels.push(labelMap[raw] || raw)
        }
      }

      void runTest(texts, labels.length > 0 ? labels : undefined)
    }
    reader.readAsText(file)
  }

  var filtered = results.filter(function(r) {
    if (filter === 'all') return true
    if (filter === 'flagged') return r.action !== 'none'
    if (filter === 'missed') return r.action === 'none' && r.label && r.label !== 'clean'
    if (filter === 'false_positive') return r.action !== 'none' && r.label === 'clean'
    return r.action === filter
  })

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Content Guard Testing</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Run text through the content detection + tagging pipeline. Paste lines or upload a labeled CSV.
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
          {(['paste', 'csv'] as const).map(function(m) {
            return <button key={m} onClick={function() { setMode(m) }} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: mode === m ? '#4f46e5' : '#fff', color: mode === m ? '#fff' : '#374151', border: 'none', cursor: 'pointer' }}>
              {m === 'paste' ? 'Paste Text' : 'Upload CSV'}
            </button>
          })}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={useModeration} onChange={function(e) { setUseModeration(e.target.checked) }} />
          Include OpenAI moderation
        </label>
      </div>

      {/* Input */}
      {mode === 'paste' ? (
        <div style={{ marginBottom: 16 }}>
          <textarea
            value={inputText}
            onChange={function(e) { setInputText(e.target.value) }}
            placeholder="Paste one comment per line..."
            style={{ width: '100%', minHeight: 120, padding: 12, borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
          />
          <button onClick={handlePasteRun} disabled={loading || !inputText.trim()} style={{ marginTop: 8, padding: '10px 24px', borderRadius: 8, background: '#4f46e5', color: '#fff', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Running...' : 'Run Test'}
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
            CSV with a <code>tweet</code>, <code>text</code>, or <code>comment</code> column. Optional <code>class</code> or <code>label</code> column (0=hate, 1=offensive, 2=clean). Max 500 rows.
          </p>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} style={{ fontSize: 14 }} />
          {loading && <span style={{ marginLeft: 12, color: '#6b7280', fontSize: 13 }}>Processing...</span>}
        </div>
      )}

      {/* Summary Stats */}
      {stats && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            {[
              { label: 'Total', value: stats.total, color: '#374151' },
              { label: 'Flagged', value: stats.flagged, color: '#4f46e5' },
              { label: 'Deleted', value: stats.deleted, color: '#DC2626' },
              { label: 'Hidden', value: stats.hidden, color: '#F59E0B' },
              { label: 'Review', value: stats.review, color: '#3B82F6' },
              { label: 'False Positive', value: stats.falsePositive, color: '#EF4444' },
            ].map(function(s) {
              return <div key={s.label} style={{ padding: '12px 16px', borderRadius: 8, background: '#f9fafb', border: '1px solid #e5e7eb', minWidth: 100 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{s.label}</div>
              </div>
            })}
          </div>

          {/* Per-label breakdown */}
          {Object.keys(byLabel).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>By Label</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>Label</th>
                    <th style={{ padding: '6px 8px' }}>Total</th>
                    <th style={{ padding: '6px 8px' }}>Flagged</th>
                    <th style={{ padding: '6px 8px' }}>Recall</th>
                    <th style={{ padding: '6px 8px' }}>Delete</th>
                    <th style={{ padding: '6px 8px' }}>Hide</th>
                    <th style={{ padding: '6px 8px' }}>Review</th>
                    <th style={{ padding: '6px 8px' }}>Missed</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byLabel).map(function([label, lb]: [string, LabelBreakdown]) {
                    var recall = lb.total > 0 && label !== 'clean' ? Math.round(lb.flagged / lb.total * 100) : null
                    return <tr key={label} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 600, textTransform: 'capitalize' }}>{label}</td>
                      <td style={{ padding: '6px 8px' }}>{lb.total}</td>
                      <td style={{ padding: '6px 8px' }}>{lb.flagged}</td>
                      <td style={{ padding: '6px 8px', fontWeight: 700, color: recall !== null ? (recall >= 80 ? '#059669' : recall >= 60 ? '#F59E0B' : '#DC2626') : '#6b7280' }}>
                        {recall !== null ? recall + '%' : '-'}
                      </td>
                      <td style={{ padding: '6px 8px' }}>{lb.deleted}</td>
                      <td style={{ padding: '6px 8px' }}>{lb.hidden}</td>
                      <td style={{ padding: '6px 8px' }}>{lb.review}</td>
                      <td style={{ padding: '6px 8px', color: lb.missed > 0 ? '#DC2626' : '#059669' }}>{lb.missed}</td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Filter tabs */}
      {results.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {[
              { key: 'all', label: 'All (' + results.length + ')' },
              { key: 'flagged', label: 'Flagged (' + results.filter(function(r) { return r.action !== 'none' }).length + ')' },
              { key: 'missed', label: 'Missed (' + results.filter(function(r) { return r.action === 'none' && r.label && r.label !== 'clean' }).length + ')' },
              { key: 'false_positive', label: 'False Positive (' + results.filter(function(r) { return r.action !== 'none' && r.label === 'clean' }).length + ')' },
              { key: 'auto_delete', label: 'Deleted' },
              { key: 'auto_hide', label: 'Hidden' },
              { key: 'review', label: 'Review' },
            ].map(function(f) {
              return <button key={f.key} onClick={function() { setFilter(f.key) }} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: filter === f.key ? '#4f46e5' : '#f3f4f6', color: filter === f.key ? '#fff' : '#374151', border: 'none', cursor: 'pointer' }}>
                {f.label}
              </button>
            })}
          </div>

          {/* Results table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                  <th style={{ padding: '8px', width: 40 }}>#</th>
                  {results[0]?.label !== null && <th style={{ padding: '8px', width: 80 }}>Label</th>}
                  <th style={{ padding: '8px' }}>Text</th>
                  <th style={{ padding: '8px', width: 80 }}>Action</th>
                  <th style={{ padding: '8px', width: 80 }}>Severity</th>
                  <th style={{ padding: '8px', width: 80 }}>Sentiment</th>
                  <th style={{ padding: '8px', width: 140 }}>Flags</th>
                  {useModeration && <th style={{ padding: '8px', width: 120 }}>Moderation</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map(function(r, i) {
                  var isMiss = r.action === 'none' && r.label && r.label !== 'clean'
                  var isFP = r.action !== 'none' && r.label === 'clean'
                  var rowBg = isMiss ? '#fef2f2' : isFP ? '#fffbeb' : i % 2 === 0 ? '#fff' : '#f9fafb'
                  return <tr key={i} style={{ borderBottom: '1px solid #f3f4f6', background: rowBg }}>
                    <td style={{ padding: '6px 8px', color: '#9ca3af' }}>{i + 1}</td>
                    {r.label !== null && <td style={{ padding: '6px 8px', fontWeight: 600, textTransform: 'capitalize', fontSize: 11 }}>{r.label}</td>}
                    <td style={{ padding: '6px 8px', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.text}>{r.text}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: ACTION_COLORS[r.action] + '15', color: ACTION_COLORS[r.action] }}>
                        {ACTION_LABELS[r.action]}
                      </span>
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {r.maxSeverity && <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: (SEVERITY_COLORS[r.maxSeverity] || '#6b7280') + '15', color: SEVERITY_COLORS[r.maxSeverity] || '#6b7280' }}>
                        {r.maxSeverity}
                      </span>}
                    </td>
                    <td style={{ padding: '6px 8px', fontSize: 11 }}>{r.sentiment}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {r.flags.map(function(f, fi) {
                          return <span key={fi} style={{ padding: '1px 6px', borderRadius: 10, fontSize: 10, background: '#e5e7eb', color: '#374151' }}>{f}</span>
                        })}
                      </div>
                    </td>
                    {useModeration && <td style={{ padding: '6px 8px', fontSize: 11 }}>
                      {r.moderation && <div>
                        <span style={{ color: r.moderation.toxicity > 40 ? '#DC2626' : '#6b7280' }}>T:{r.moderation.toxicity}%</span>{' '}
                        <span style={{ color: r.moderation.threat > 40 ? '#DC2626' : '#6b7280' }}>Th:{r.moderation.threat}%</span>{' '}
                        <span style={{ color: r.moderation.identity > 40 ? '#DC2626' : '#6b7280' }}>I:{r.moderation.identity}%</span>
                      </div>}
                    </td>}
                  </tr>
                })}
              </tbody>
            </table>
            {filtered.length > 200 && <p style={{ padding: 8, color: '#6b7280', fontSize: 13 }}>Showing first 200 of {filtered.length} results</p>}
          </div>
        </>
      )}
    </div>
  )
}
