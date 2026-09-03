'use client'

// components/analyze/textmine/ContextCloud.tsx
//
// The "Context" view — the words a term actually appears alongside, rendered
// as a small cloud sized by how many comments carry the pair. Ported from the
// legacy Ana right-click Context view; here it's a tab inside the word modal
// (OpinionPopover) and the theme modal (ThemePopover) rather than a context
// menu, so it's reachable on touch and sits next to Comments/Insights.
//
// Two sorts: Frequency (legacy parity) and Distinctive (G² association, which
// demotes words that are common everywhere in the dataset). Clicking a word
// drills into the comments carrying both terms — the count on the chip is the
// comment count, so it matches what the drill-down shows.

import { useEffect, useMemo, useState } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'
import { computeCollocates, type CollocationResult } from '@/lib/collocations'
import { relatedConcepts, type RelatedConcepts, type ConceptChip } from '@/lib/contextConcepts'
import type { Theme } from '@/lib/themeUtils'

interface Props {
  rows: Record<string, unknown>[]
  fields: string | string[]
  /** Term(s) to find context for — one cloud word, or every theme keyword. */
  targets: string[]
  /** What to call the target in the copy (the word, or the theme name). */
  termLabel: string
  /** Click-through to the comments carrying both terms. */
  onSelect?: (word: string) => void
  /** Theme model for the "Related concepts" section (optional). */
  themes?: Theme[] | null
  /** In the theme modal, the theme being viewed — never its own concept. */
  excludeThemeName?: string
  /** Entity catalog for the "Related concepts" section (optional). */
  entities?: { canonical: string; aliases?: string[] }[] | null
}

const MAX_SHOWN = 20

function fontSizeFor(count: number, max: number): number {
  if (max <= 0) return 13
  // sqrt keeps the biggest term from dwarfing the tail on skewed corpora
  const ratio = Math.sqrt(count / max)
  return Math.round(13 + ratio * 13)
}

export default function ContextCloud({ rows, fields, targets, termLabel, onSelect, themes, excludeThemeName, entities }: Props) {
  const [sortBy, setSortBy] = useState<'count' | 'score'>('count')

  // Collocation is synchronous and can run a few hundred ms on a 50K-row
  // corpus, so it's deferred a tick past mount — the tab paints with the
  // loader instead of freezing mid-switch. The concepts pass rides the same
  // tick (it only scans the target's comment subset).
  const [computed, setComputed] = useState<{
    rows: unknown; fields: unknown; targets: unknown; result: CollocationResult; concepts: RelatedConcepts
  } | null>(null)
  useEffect(() => {
    const id = setTimeout(
      () => setComputed({
        rows, fields, targets,
        result: computeCollocates(rows, fields, targets),
        concepts: relatedConcepts({ rows, fields, targets, themes, excludeThemeName, entities }),
      }),
      0,
    )
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- themes/entities are stable per popover open; keying the recompute on rows/fields/targets matches the staleness tag below
  }, [rows, fields, targets])
  // Tagged with the inputs it was computed from, so a prop change shows the
  // loader again rather than a stale cloud.
  const result = computed && computed.rows === rows && computed.fields === fields && computed.targets === targets
    ? computed.result
    : null
  const concepts = result ? computed!.concepts : null

  // Both rankings arrive pre-sorted from the lib, so the toggle is a swap.
  const shown = useMemo(
    () => (result ? (sortBy === 'score' ? result.byDistinctive : result.byCount).slice(0, MAX_SHOWN) : []),
    [result, sortBy],
  )

  const maxCount = shown.length > 0 ? Math.max(...shown.map(c => c.count)) : 0

  if (!result) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <LottieLoader size={100} message="Reading context…" />
      </div>
    )
  }

  if (result.byCount.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <p style={{ fontSize: 13, color: '#9ca3af' }}>
          Not enough context to show for &ldquo;{termLabel}&rdquo;.
        </p>
        <p style={{ fontSize: 11, color: '#d1d5db', marginTop: 4 }}>
          {result.matchedRows.toLocaleString()} matching comment{result.matchedRows === 1 ? '' : 's'} — a word needs to appear in at least 2 of them to count as context.
        </p>
      </div>
    )
  }

  const conceptGroups: { kind: string; chips: ConceptChip[]; noun: string }[] = concepts
    ? [
        { kind: 'Themes', chips: concepts.themes, noun: 'match the theme' },
        { kind: 'Dimensions', chips: concepts.dimensions, noun: 'are tagged' },
        { kind: 'Mentions', chips: concepts.entities, noun: 'also mention' },
      ].filter(g => g.chips.length > 0)
    : []

  return (
    <div>
      {conceptGroups.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 8 }}>
            Related concepts
          </div>
          {conceptGroups.map(g => (
            <div key={g.kind} style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, width: 74, flexShrink: 0, textAlign: 'right' }}>{g.kind}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1, minWidth: 0 }}>
                {g.chips.map(c => (
                  <span key={c.label}
                    title={c.count.toLocaleString() + ' of the ' + concepts!.matchedRows.toLocaleString() + ' comments mentioning "' + termLabel + '" ' + g.noun + ' ' + c.label + (c.detail ? ' (' + c.detail + ')' : '')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
                      color: '#374151', background: '#f9fafb', border: '1px solid #e5e7eb',
                      borderRadius: 14, padding: '2px 9px', cursor: 'help',
                    }}>
                    {c.label}
                    {c.detail && <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 500 }}>{c.detail}</span>}
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280' }}>{c.count.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>
          Appears alongside
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 0, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          {(['count', 'score'] as const).map(mode => {
            const active = sortBy === mode
            return (
              <button key={mode} onClick={() => setSortBy(mode)}
                title={mode === 'count'
                  ? 'Rank by how many comments carry both terms'
                  : 'Rank by how much more often the word appears here than in the dataset overall'}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: 'none', background: active ? '#eff6ff' : 'white',
                  color: active ? '#2563eb' : '#6b7280',
                }}>
                {mode === 'count' ? 'Frequency' : 'Distinctive'}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', justifyContent: 'center', alignItems: 'baseline', padding: '4px 0 14px' }}>
        {shown.map(c => (
          <button key={c.word}
            onClick={onSelect ? () => onSelect(c.word) : undefined}
            title={c.count.toLocaleString() + ' comment' + (c.count === 1 ? '' : 's') + ' mention "' + termLabel + '" and "' + c.word + '" in the same sentence' + (onSelect ? ' — click to read them' : '')}
            style={{
              display: 'inline-flex', alignItems: 'baseline', gap: 5,
              background: 'transparent', border: 'none', padding: '2px 4px',
              cursor: onSelect ? 'pointer' : 'default',
              fontSize: fontSizeFor(c.count, maxCount), fontWeight: 700,
              color: '#374151', lineHeight: 1.35,
              textTransform: 'uppercase' as const, letterSpacing: '.01em',
            }}>
            {c.word}
            <span style={{
              fontSize: 10, fontWeight: 600, color: '#6b7280',
              background: '#f3f4f6', border: '1px solid #e5e7eb',
              borderRadius: 4, padding: '1px 4px', letterSpacing: 0,
            }}>{c.count.toLocaleString()}</span>
          </button>
        ))}
      </div>

      <p style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
        Counted per comment, same-sentence only. Based on {result.matchedRows.toLocaleString()} comment{result.matchedRows === 1 ? '' : 's'} mentioning &ldquo;{termLabel}&rdquo;.
      </p>
    </div>
  )
}
