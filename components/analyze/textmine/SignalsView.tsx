'use client'

// components/analyze/textmine/SignalsView.tsx
// Reddit signal analysis: classifies comments into Mainstream / Controversial / Noise
// using per-thread percentile ranking of comment scores.
// The 80/20 gate: sort by |score| descending, take comments until 80% of total vote
// volume is accounted for, then classify by percentile within each thread.

import { useState, useMemo } from 'react'

interface SignalComment {
  text: string
  score: number
  author: string
  thread: string
  subreddit: string
  date: string
  percentile: number
  tier: 'mainstream' | 'controversial' | 'noise' | 'fringe'
  permalink: string
}

interface Props {
  rows: Record<string, unknown>[]
  mainstreamCutoff: number   // default 70
  noiseCutoff: number        // default 30
  onCutoffChange: (mainstream: number, noise: number) => void
}

var HERMES = '#E8632A'

var TIER_STYLES = {
  mainstream:    { label: 'Mainstream',    color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', icon: '\u2B06' },
  controversial: { label: 'Controversial', color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '\u26A0' },
  fringe:        { label: 'Fringe',        color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', icon: '\u2B07' },
  noise:         { label: 'Noise',         color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb', icon: '\u2022' },
}

export default function SignalsView({ rows, mainstreamCutoff, noiseCutoff, onCutoffChange }: Props) {
  var [showFringe, setShowFringe] = useState(false)
  var [expandedTier, setExpandedTier] = useState<string | null>(null)

  var classified = useMemo(function() {
    if (!rows.length) return [] as SignalComment[]

    // Group by thread
    var threads: Record<string, { score: number; row: Record<string, unknown> }[]> = {}
    rows.forEach(function(r) {
      var tid = String(r.thread_id || 'unknown')
      if (!threads[tid]) threads[tid] = []
      threads[tid].push({ score: Number(r.score) || 0, row: r })
    })

    // Per-thread percentile ranking
    var allClassified: SignalComment[] = []

    Object.entries(threads).forEach(function([_tid, entries]) {
      // Sort by score descending within thread
      var sorted = [...entries].sort(function(a, b) { return b.score - a.score })
      var count = sorted.length

      sorted.forEach(function(entry, rank) {
        // Percentile: 100 = top, 0 = bottom
        var percentile = count > 1 ? Math.round((1 - rank / (count - 1)) * 100) : 50

        var tier: 'mainstream' | 'controversial' | 'noise' | 'fringe'
        if (percentile >= mainstreamCutoff) {
          tier = 'mainstream'
        } else if (percentile >= noiseCutoff) {
          tier = 'controversial'
        } else if (entry.score < 0) {
          tier = 'fringe'
        } else {
          tier = 'noise'
        }

        allClassified.push({
          text: String(entry.row.body || entry.row.user_message || ''),
          score: entry.score,
          author: String(entry.row.author || entry.row.participant_id || ''),
          thread: String(entry.row.thread_title || ''),
          subreddit: String(entry.row.subreddit || ''),
          date: String(entry.row.post_date || ''),
          percentile: percentile,
          tier: tier,
          permalink: String(entry.row.permalink || ''),
        })
      })
    })

    return allClassified
  }, [rows, mainstreamCutoff, noiseCutoff])

  // Count by tier
  var counts = { mainstream: 0, controversial: 0, fringe: 0, noise: 0 }
  classified.forEach(function(c) { counts[c.tier]++ })

  var tiers: Array<'mainstream' | 'controversial' | 'fringe' | 'noise'> = ['mainstream', 'controversial']
  if (showFringe) tiers.push('fringe')
  tiers.push('noise')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Threshold slider */}
      <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Signal Thresholds</span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>{classified.length} comments classified</span>
        </div>

        {/* Visual bar with two handles */}
        <div style={{ position: 'relative', height: 32, marginBottom: 8 }}>
          {/* Background bar */}
          <div style={{ position: 'absolute', top: 12, left: 0, right: 0, height: 8, borderRadius: 4, background: '#f3f4f6', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, width: noiseCutoff + '%', height: '100%', background: TIER_STYLES.noise.border }} />
            <div style={{ position: 'absolute', left: noiseCutoff + '%', width: (mainstreamCutoff - noiseCutoff) + '%', height: '100%', background: TIER_STYLES.controversial.border }} />
            <div style={{ position: 'absolute', left: mainstreamCutoff + '%', right: 0, height: '100%', background: TIER_STYLES.mainstream.border }} />
          </div>

          {/* Noise/Controversial slider */}
          <input type="range" min={5} max={mainstreamCutoff - 5} value={noiseCutoff}
            onChange={function(e) { onCutoffChange(mainstreamCutoff, Number(e.target.value)) }}
            style={{ position: 'absolute', top: 4, left: 0, width: '100%', height: 24, opacity: 0, cursor: 'pointer', zIndex: 2 }}
          />
          {/* Controversial/Mainstream slider */}
          <input type="range" min={noiseCutoff + 5} max={95} value={mainstreamCutoff}
            onChange={function(e) { onCutoffChange(Number(e.target.value), noiseCutoff) }}
            style={{ position: 'absolute', top: 4, left: 0, width: '100%', height: 24, opacity: 0, cursor: 'pointer', zIndex: 3 }}
          />

          {/* Handle indicators */}
          <div style={{ position: 'absolute', top: 6, left: noiseCutoff + '%', transform: 'translateX(-50%)', width: 16, height: 16, borderRadius: '50%', background: 'white', border: '2px solid ' + TIER_STYLES.controversial.color, boxShadow: '0 1px 4px rgba(0,0,0,.15)', zIndex: 4, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 6, left: mainstreamCutoff + '%', transform: 'translateX(-50%)', width: 16, height: 16, borderRadius: '50%', background: 'white', border: '2px solid ' + TIER_STYLES.mainstream.color, boxShadow: '0 1px 4px rgba(0,0,0,.15)', zIndex: 4, pointerEvents: 'none' }} />
        </div>

        {/* Labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7280' }}>
          <span>Noise (&lt;{noiseCutoff}th pctl)</span>
          <span>Controversial ({noiseCutoff}-{mainstreamCutoff}th)</span>
          <span>Mainstream (&gt;{mainstreamCutoff}th pctl)</span>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {(['mainstream', 'controversial', 'fringe', 'noise'] as const).map(function(tier) {
          var style = TIER_STYLES[tier]
          if (tier === 'fringe' && !showFringe) return null
          return (
            <div key={tier} style={{ background: style.bg, border: '1px solid ' + style.border, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: style.color }}>{counts[tier]}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: style.color, marginTop: 2 }}>{style.icon} {style.label}</div>
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                {classified.length > 0 ? Math.round(counts[tier] / classified.length * 100) : 0}%
              </div>
            </div>
          )
        })}
      </div>

      {/* Tier sections */}
      {tiers.map(function(tier) {
        if (tier === 'fringe' && !showFringe) return null
        var style = TIER_STYLES[tier]
        var items = classified.filter(function(c) { return c.tier === tier })
          .sort(function(a, b) { return Math.abs(b.score) - Math.abs(a.score) })
        var isExpanded = expandedTier === tier
        var displayItems = isExpanded ? items : items.slice(0, 5)

        if (items.length === 0) return null

        return (
          <div key={tier} style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
            {/* Tier header */}
            <div style={{ borderBottom: '1px solid #f3f4f6', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: style.color }}>{style.icon} {style.label}</span>
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>{items.length} comments</span>
              {tier === 'mainstream' && (
                <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto' }}>Top {100 - mainstreamCutoff}% by score within each thread</span>
              )}
            </div>

            {/* Comments */}
            <div style={{ padding: '8px 0' }}>
              {displayItems.map(function(c, i) {
                return (
                  <div key={i} style={{ padding: '10px 16px', borderBottom: i < displayItems.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                    <div style={{ fontSize: 13, color: '#111827', lineHeight: 1.5, marginBottom: 6 }}>
                      {c.text.length > 300 ? c.text.slice(0, 300) + '...' : c.text}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#9ca3af', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: c.score >= 0 ? '#059669' : '#dc2626' }}>
                        {c.score >= 0 ? '+' : ''}{c.score}
                      </span>
                      <span>{c.percentile}th pctl</span>
                      <span>u/{c.author}</span>
                      {c.subreddit && <span>r/{c.subreddit}</span>}
                      {c.date && <span>{c.date}</span>}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{c.thread}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Show more/less */}
            {items.length > 5 && (
              <div style={{ padding: '8px 16px', borderTop: '1px solid #f3f4f6', textAlign: 'center' }}>
                <button onClick={function() { setExpandedTier(isExpanded ? null : tier) }}
                  style={{ fontSize: 11, fontWeight: 600, color: HERMES, background: 'none', border: 'none', cursor: 'pointer' }}>
                  {isExpanded ? 'Show less' : 'Show all ' + items.length + ' comments'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Fringe toggle */}
      {!showFringe && counts.fringe > 0 && (
        <button onClick={function() { setShowFringe(true) }}
          style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', textAlign: 'center' }}>
          Show {counts.fringe} fringe comment{counts.fringe !== 1 ? 's' : ''} (negative score)
        </button>
      )}
      {showFringe && counts.fringe > 0 && (
        <button onClick={function() { setShowFringe(false) }}
          style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'center' }}>
          Hide fringe
        </button>
      )}
    </div>
  )
}
