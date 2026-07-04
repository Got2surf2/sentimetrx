'use client'

// components/analyze/textmine/SearchPanel.tsx
// Full-text search across dataset rows with AI query expansion option

import { useState, useCallback } from 'react'
import { T } from '@/lib/analyzeTheme'
import LottieLoader from '@/components/ui/LottieLoader'

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
  var [reranked, setReranked] = useState(false)
  var [rawTotal, setRawTotal] = useState(0)
  var [expanded, setExpanded] = useState<number | null>(null)

  var search = useCallback(async function(q: string) {
    if (!q.trim()) return
    setSearching(true)
    setSearched(true)
    setAiInterpretation(null)
    setReranked(false)
    try {
      var url = '/api/datasets/' + datasetId + '/search?q=' + encodeURIComponent(q.trim()) + '&limit=50'
      if (aiMode) url += '&ai=true'
      var res = await fetch(url)
      var d = await res.json()
      setResults(d.results || [])
      setTotal(d.total || 0)
      setRawTotal(d.rawTotal || d.total || 0)
      setReranked(!!d.reranked)
      if (d.aiInterpretation) setAiInterpretation(d.aiInterpretation)
    } catch {
      setResults([])
      setTotal(0)
      setRawTotal(0)
    }
    setSearching(false)
  }, [datasetId, aiMode])

  function clear() {
    setQuery('')
    setResults([])
    setTotal(0)
    setRawTotal(0)
    setReranked(false)
    setSearched(false)
    setAiInterpretation(null)
  }

  // Field-name patterns that indicate the row's primary comment / response text.
  // Ordered by preference — earlier matches win.
  const COMMENT_FIELD_PATTERNS = [
    /^review_text$/i, /^comment_text$/i, /^body$/i, /^message$/i, /^content$/i,
    /^text$/i, /^comment$/i, /^response$/i, /^answer$/i, /^feedback$/i,
    /comment/i, /text$/i, /response/i,
  ]
  // Field-name patterns we want to NEVER use as the primary snippet.
  const NON_COMMENT_FIELDS = /^(_|location|address|place_id|review_id|review_date|author|rating|likes|city|state|country|name|title|url|id$|created|updated|date)/i

  function getCommentText(data: Record<string, unknown>): string {
    if (openEndedField && typeof data[openEndedField] === 'string' && (data[openEndedField] as string).length > 0) {
      return String(data[openEndedField])
    }
    // 1. Try each comment-name pattern in order
    for (const pat of COMMENT_FIELD_PATTERNS) {
      for (const key in data) {
        if (pat.test(key) && !NON_COMMENT_FIELDS.test(key)) {
          const val = data[key]
          if (typeof val === 'string' && val.length > 20) return val
        }
      }
    }
    // 2. Fallback: longest string field that isn't a known non-comment field
    let best = ''
    for (const key in data) {
      const val = data[key]
      if (typeof val === 'string' && val.length > best.length && !NON_COMMENT_FIELDS.test(key)) {
        best = val
      }
    }
    return best || JSON.stringify(data).slice(0, 200)
  }

  function getLocationLabel(data: Record<string, unknown>): string {
    const parts: string[] = []
    if (data._collection_label) parts.push(String(data._collection_label))
    if (data.location) parts.push(String(data.location))
    else if (data.location_name) parts.push(String(data.location_name))
    if (data.author) parts.push(String(data.author))
    if (data.rating !== undefined && data.rating !== null) parts.push('★ ' + String(data.rating))
    return parts.join(' · ')
  }

  return (
    <div style={{
      background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12,
      overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
    }}>
      {/* Search bar — pinned at top */}
      <div style={{ flexShrink: 0, padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: searched ? '1px solid ' + T.border : 'none' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            value={query}
            onChange={function(e) { setQuery(e.target.value) }}
            onKeyDown={function(e) { if (e.key === 'Enter') void search(query) }}
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
          onClick={function() { void search(query) }}
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

      {/* AI interpretation + re-rank indicator — pinned at top */}
      {aiInterpretation && (
        <div style={{ flexShrink: 0, padding: '8px 16px', background: T.accentBg, fontSize: 11, color: T.accent }}>
          AI expanded your search to: <strong>{aiInterpretation}</strong>
          {reranked && rawTotal > 0 && (
            <span style={{ marginLeft: 8, opacity: 0.85 }}>
              · re-ranked {total} of {rawTotal} keyword matches by relevance
            </span>
          )}
        </div>
      )}

      {/* Searching spinner */}
      {searching && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
          <LottieLoader size={80} message={aiMode ? 'AI is searching and re-ranking…' : 'Searching…'} />
        </div>
      )}

      {/* Results — fills remaining space and scrolls internally; expanding a card
          scrolls within this area instead of pushing the search bar off screen */}
      {searched && !searching && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {results.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: T.textFaint, fontSize: 13 }}>
              No results found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <>
              <div style={{ padding: '8px 16px', fontSize: 10, color: T.textFaint, fontWeight: 600, textTransform: 'uppercase' as const }}>
                {total} result{total !== 1 ? 's' : ''}
              </div>
              {results.map(function(r, i) {
                var commentText = getCommentText(r.data)
                var locationLabel = getLocationLabel(r.data)
                var isExpanded = expanded === i
                var snippet = isExpanded ? commentText : (commentText.length > 600 ? commentText.slice(0, 600) + '…' : commentText)

                return (
                  <div key={r.id} style={{
                    padding: '12px 16px', borderTop: '1px solid ' + T.border,
                    cursor: 'pointer', background: isExpanded ? T.bg : 'transparent',
                  }} onClick={function() { setExpanded(isExpanded ? null : i) }}>
                    {/* Comment text — the main thing */}
                    <div style={{ fontSize: 13, color: T.text, lineHeight: 1.55, marginBottom: 6, whiteSpace: 'pre-wrap' as const }}>
                      {snippet}
                    </div>

                    {/* Subtitle: location, author, rating + relevance pill */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: T.textFaint }}>
                      {locationLabel && <span>{locationLabel}</span>}
                      {r.data.sentiment ? (
                        <span style={{ padding: '1px 6px', borderRadius: 8, background: T.bg, color: T.textMid }}>
                          {String(r.data.sentiment)}
                        </span>
                      ) : null}
                      {reranked && r.rank > 0 && r.rank < 1 && (
                        <span style={{ padding: '1px 6px', borderRadius: 8, background: T.bg, color: T.textFaint }}>
                          relevance: {(r.rank * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>

                    {/* Expanded: show all other fields below the (now full-length) comment */}
                    {isExpanded && (
                      <div style={{ marginTop: 10, padding: 10, background: T.bgCard, borderRadius: 8, border: '1px solid ' + T.border }}>
                        {Object.entries(r.data).map(function(e) {
                          // Skip reserved metadata keys (e.g. the _tx taxonomy
                          // block) — internals, not row fields.
                          if (e[0].startsWith('_')) return null
                          var val = String(e[1] ?? '')
                          if (!val || val === 'none' || val === 'null') return null
                          // Comment text is already shown in full above; don't repeat it
                          if (val === commentText) return null
                          return (
                            <div key={e[0]} style={{ fontSize: 11, marginBottom: 3 }}>
                              <span style={{ color: T.textFaint, fontWeight: 600 }}>{e[0]}:</span>{' '}
                              <span style={{ color: T.text }}>{val}</span>
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
