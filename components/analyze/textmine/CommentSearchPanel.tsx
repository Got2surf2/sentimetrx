'use client'

// components/analyze/textmine/CommentSearchPanel.tsx
// Scoped comment search for the Comments tab. Unlike the dataset-wide SearchPanel
// (server full-text over EVERY field of EVERY row), this searches ONLY:
//   - the rows currently in view (the filtered set passed as `rows`), and
//   - the active open-ended field(s) being analyzed (`fields`).
// So it inherently respects the current filters, the active field selection, and
// the schema (turned-off / non-open-ended fields are never in `fields`, so they
// can't match). Pure client-side over already-loaded rows — instant, no fetch.

import { useMemo, useState } from 'react'
import { T } from '@/lib/analyzeTheme'
import type { SchemaFieldConfig as SchemaField } from '@/lib/analyzeTypes'
import { ratingRange, ratingPalette } from './ratingColor'

interface Props {
  rows: Record<string, unknown>[]   // the in-view, filtered rows
  fields: string[]                  // active open-ended field(s) in view
  schema?: SchemaField[]            // for field labels
  ratingField?: string | null
}

const MAX_SHOWN = 200

function fieldLabel(schema: SchemaField[] | undefined, field: string): string {
  const f = (schema || []).find(function(s) { return s.field === field })
  return (f && (f.label || f.field)) || field
}

export default function CommentSearchPanel({ rows, fields, schema, ratingField }: Props) {
  const [query, setQuery] = useState('')
  const tokens = useMemo(function() {
    return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  }, [query])

  const range = useMemo(function() { return ratingRange(rows, ratingField) }, [rows, ratingField])
  const multi = fields.length > 1

  // Each in-view row's text from the active field(s) only.
  const matches = useMemo(function() {
    if (tokens.length === 0) return [] as { text: string; rating: unknown }[]
    const out: { text: string; rating: unknown }[] = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const text = fields
        .map(function(f) {
          const v = String(r[f] ?? '').trim()
          return v ? (multi ? fieldLabel(schema, f) + ': ' + v : v) : ''
        })
        .filter(Boolean)
        .join('\n\n')
      if (!text) continue
      const tl = text.toLowerCase()
      if (tokens.every(function(t) { return tl.indexOf(t) !== -1 })) {
        out.push({ text: text, rating: ratingField ? r[ratingField] : null })
      }
    }
    return out
  }, [rows, fields, schema, ratingField, multi, tokens])

  // Highlight every token occurrence in a comment.
  const highlightRx = useMemo(function() {
    if (tokens.length === 0) return null
    const esc = tokens.map(function(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }).filter(Boolean)
    if (esc.length === 0) return null
    return { split: new RegExp('(' + esc.join('|') + ')', 'gi'), test: new RegExp('^(' + esc.join('|') + ')$', 'i') }
  }, [tokens])

  function render(text: string) {
    if (!highlightRx) return text
    return text.split(highlightRx.split).map(function(seg, i) {
      return highlightRx.test.test(seg)
        ? <mark key={i} style={{ background: '#fde68a', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>{seg}</mark>
        : <span key={i}>{seg}</span>
    })
  }

  const shown = matches.slice(0, MAX_SHOWN)

  return (
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: query ? '1px solid ' + T.border : 'none' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            value={query}
            onChange={function(e) { setQuery(e.target.value) }}
            placeholder="Search comments in view…"
            style={{ width: '100%', padding: '8px 12px', paddingRight: query ? 32 : 12, borderRadius: 8, border: '1px solid ' + T.border, fontSize: 13, outline: 'none', background: T.bg, color: T.text }}
          />
          {query && (
            <button onClick={function() { setQuery('') }} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer', fontSize: 16 }}>&times;</button>
          )}
        </div>
        <span style={{ fontSize: 11, color: T.textFaint, whiteSpace: 'nowrap' }} title="Searches only the active field(s) in the rows currently in view (respects your filters).">
          in-view · {fields.map(function(f) { return fieldLabel(schema, f) }).join(' + ') || 'no field'}
        </span>
      </div>

      {query && (
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {matches.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: T.textFaint, fontSize: 13 }}>No comments in view match &ldquo;{query}&rdquo;.</div>
          ) : (
            <>
              <div style={{ padding: '8px 16px', fontSize: 10, color: T.textFaint, fontWeight: 600, textTransform: 'uppercase' as const }}>
                {matches.length.toLocaleString()} match{matches.length === 1 ? '' : 'es'}{matches.length > MAX_SHOWN ? ' · showing first ' + MAX_SHOWN : ''}
              </div>
              {shown.map(function(m, i) {
                const pal = ratingField ? ratingPalette(m.rating, range) : null
                return (
                  <div key={i} style={{ padding: '12px 16px', borderTop: '1px solid ' + T.border, borderLeft: pal ? '4px solid ' + pal.border : '4px solid transparent' }}>
                    <div style={{ fontSize: 13, color: T.text, lineHeight: 1.55, whiteSpace: 'pre-wrap' as const }}>{render(m.text)}</div>
                    {ratingField && m.rating != null && String(m.rating).trim() !== '' && (
                      <div style={{ marginTop: 6, fontSize: 11, color: T.textFaint }}>★ {String(m.rating)}</div>
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
