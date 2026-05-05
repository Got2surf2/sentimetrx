'use client'

// components/analyze/textmine/SearchPanel.tsx
// Full-text search across dataset rows with AI query expansion option

import { useState, useCallback } from 'react'
import { T } from '@/lib/analyzeTheme'

interface SearchResult {
  id: number
  row_index: number
  data: Record<string, unknown>
  rank: number
  headline: string
}

interface Props {
  datasetId: string
  openEndedField?: string   // primary text field to display
}

export default function SearchPanel({ datasetId, openEndedField }: Props) {
  var [query, setQuery] = useState('')
  var [results, setResults] = useState<SearchResult[]>([])
  var [total, setTotal] = useState(0)
  var [searching, setSearching] = useState(false)
  var [searched, setSearched] = useState(false)
  var [aiMode, setAiMode] = useState(false)
  var [aiInterpretation, setAiInterpretation] = useState<string | null>(null)
  var [expanded, setExpanded] = useState<number | null>(null)

  var search = useCallback(async function(q: string) {
    if (!q.trim()) return
    setSearching(true)
    setSearched(true)
    setAiInterpretation(null)
    try {
      var url = '/api/datasets/' + datasetId + '/search?q=' + encodeURIComponent(q.trim()) + '&limit=50'
      if (aiMode) url += '&ai=true'
      var res = await fetch(url)
      var d = await res.json()
      setResults(d.results || [])
      setTotal(d.total || 0)
      if (d.aiInterpretation) setAiInterpretation(d.aiInterpretation)
    } catch {
      setResults([])
      setTotal(0)
    }
    setSearching(false)
  }, [datasetId, aiMode])

  function clear() {
    setQuery('')
    setResults([])
    setTotal(0)
    setSearched(false)
    setAiInterpretation(null)
  }

  function getDisplayText(data: Record<string, unknown>): string {
    // Try the primary OE field first
    if (openEndedField && data[openEndedField]) return String(data[openEndedField])
    // Fall back to the first long text field
    for (var key in data) {
      var val = data[key]
      if (typeof val === 'string' && val.length > 20) return val
    }
    // Last resort: first string value
    for (var k in data) {
      if (typeof data[k] === 'string') return String(data[k])
    }
    return JSON.stringify(data).slice(0, 200)
  }

  return (
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, overflow: 'hidden' }}>
      {/* Search bar */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: searched ? '1px solid ' + T.border : 'none' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            value={query}
            onChange={function(e) { setQuery(e.target.value) }}
            onKeyDown={function(e) { if (e.key === 'Enter') search(query) }}
            placeholder={aiMode ? 'Describe what you\'re looking for...' : 'Search comments...'}
            style={{
              width: '100%', padding: '8px 12px', paddingRight: query ? 32 : 12, borderRadius: 8,
              border: '1px solid ' + T.border, fontSize: 13, outline: 'none',
              background: T.bg, color: T.text,
            }}
          />
          {query && (
            <button onClick={clear} style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer', fontSize: 16,
            }}>&times;</button>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, color: T.textMid, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={aiMode} onChange={function(e) { setAiMode(e.target.checked) }}
            style={{ width: 14, height: 14, accentColor: T.accent }} />
          AI Search
        </label>

        <button
          onClick={function() { search(query) }}
          disabled={searching || !query.trim()}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none',
            background: T.accent, color: 'white', fontSize: 12, fontWeight: 600,
            cursor: searching || !query.trim() ? 'default' : 'pointer',
            opacity: searching || !query.trim() ? 0.5 : 1,
          }}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* AI interpretation */}
      {aiInterpretation && (
        <div style={{ padding: '8px 16px', background: T.accentBg, fontSize: 11, color: T.accent }}>
          AI expanded your search to: <strong>{aiInterpretation}</strong>
        </div>
      )}

      {/* Results */}
      {searched && (
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {results.length === 0 && !searching ? (
            <div style={{ padding: 24, textAlign: 'center', color: T.textFaint, fontSize: 13 }}>
              No results found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <>
              <div style={{ padding: '8px 16px', fontSize: 10, color: T.textFaint, fontWeight: 600, textTransform: 'uppercase' as const }}>
                {total} result{total !== 1 ? 's' : ''}
              </div>
              {results.map(function(r, i) {
                var text = getDisplayText(r.data)
                var isExpanded = expanded === i
                var truncated = text.length > 200 && !isExpanded

                return (
                  <div key={r.id} style={{
                    padding: '10px 16px', borderTop: '1px solid ' + T.border,
                    cursor: 'pointer', background: isExpanded ? T.bg : 'transparent',
                  }} onClick={function() { setExpanded(isExpanded ? null : i) }}>
                    {/* Headline with highlights */}
                    {r.headline ? (
                      <div style={{ fontSize: 12, color: T.text, lineHeight: 1.6, marginBottom: 4 }}
                        dangerouslySetInnerHTML={{ __html: r.headline }} />
                    ) : (
                      <div style={{ fontSize: 12, color: T.text, lineHeight: 1.6, marginBottom: 4 }}>
                        {truncated ? text.slice(0, 200) + '...' : text}
                      </div>
                    )}

                    {/* Metadata pills */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {r.data.sentiment ? (
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: T.bg, color: T.textMid }}>
                          {String(r.data.sentiment)}
                        </span>
                      ) : null}
                      {r.data.platform ? (
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: T.bg, color: T.textMid }}>
                          {String(r.data.platform)}
                        </span>
                      ) : null}
                      {r.rank > 0 && (
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: T.bg, color: T.textFaint }}>
                          relevance: {(r.rank * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>

                    {/* Expanded: show all fields */}
                    {isExpanded && (
                      <div style={{ marginTop: 8, padding: 10, background: T.bgCard, borderRadius: 8, border: '1px solid ' + T.border }}>
                        {Object.entries(r.data).map(function(e) {
                          var val = String(e[1] ?? '')
                          if (!val || val === 'none' || val === 'null') return null
                          return (
                            <div key={e[0]} style={{ fontSize: 11, marginBottom: 3 }}>
                              <span style={{ color: T.textFaint, fontWeight: 600 }}>{e[0]}:</span>{' '}
                              <span style={{ color: T.text }}>{val.length > 300 ? val.slice(0, 300) + '...' : val}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
