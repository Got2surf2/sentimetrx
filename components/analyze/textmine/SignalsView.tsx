'use client'

// components/analyze/textmine/SignalsView.tsx
// Reddit signal analysis: classifies comments into Mainstream / Controversial / Noise
// using per-thread percentile ranking of comment scores.
// Filters out URL-only comments. Collapsible tier sections, default 3 visible.

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
var DEFAULT_VISIBLE = 5

// Detect if text is primarily a URL (no meaningful content)
var URL_RE = /^(\s*(https?:\/\/\S+)\s*)+$/i

var TIER_STYLES = {
  mainstream:    { label: 'Mainstream',    color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', icon: '\u2B06' },
  controversial: { label: 'Controversial', color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '\u26A0' },
  fringe:        { label: 'Fringe',        color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', icon: '\u2B07' },
  noise:         { label: 'Noise',         color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb', icon: '\u2022' },
}

export default function SignalsView({ rows, mainstreamCutoff, noiseCutoff, onCutoffChange }: Props) {
  var [showFringe, setShowFringe] = useState(false)
  var [collapsedTiers, setCollapsedTiers] = useState<Record<string, boolean>>({})
  var [expandedTiers, setExpandedTiers] = useState<Record<string, boolean>>({})

  function toggleCollapse(tier: string) {
    setCollapsedTiers(function(prev) { var next = { ...prev }; next[tier] = !prev[tier]; return next })
  }
  function toggleExpand(tier: string) {
    setExpandedTiers(function(prev) { var next = { ...prev }; next[tier] = !prev[tier]; return next })
  }

  var classified = useMemo(function() {
    if (!rows.length) return [] as SignalComment[]

    // Group by thread, filtering out URL-only comments
    var threads: Record<string, { score: number; row: Record<string, unknown> }[]> = {}
    rows.forEach(function(r) {
      var text = String(r.body || r.user_message || '').trim()
      if (!text || URL_RE.test(text)) return  // skip empty or URL-only
      var tid = String(r.thread_id || 'unknown')
      if (!threads[tid]) threads[tid] = []
      threads[tid].push({ score: Number(r.score) || 0, row: r })
    })

    // Per-thread percentile ranking
    var allClassified: SignalComment[] = []

    Object.entries(threads).forEach(function([_tid, entries]) {
      var sorted = [...entries].sort(function(a, b) { return b.score - a.score })
      var count = sorted.length

      sorted.forEach(function(entry, rank) {
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

        <div style={{ position: 'relative', height: 32, marginBottom: 8 }}>
          <div style={{ position: 'absolute', top: 12, left: 0, right: 0, height: 8, borderRadius: 4, background: '#f3f4f6', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, width: noiseCutoff + '%', height: '100%', background: TIER_STYLES.noise.border }} />
            <div style={{ position: 'absolute', left: noiseCutoff + '%', width: (mainstreamCutoff - noiseCutoff) + '%', height: '100%', background: TIER_STYLES.controversial.border }} />
            <div style={{ position: 'absolute', left: mainstreamCutoff + '%', right: 0, height: '100%', background: TIER_STYLES.mainstream.border }} />
          </div>
          <input type="range" min={5} max={mainstreamCutoff - 5} value={noiseCutoff}
            onChange={function(e) { onCutoffChange(mainstreamCutoff, Number(e.target.value)) }}
            style={{ position: 'absolute', top: 4, left: 0, width: '100%', height: 24, opacity: 0, cursor: 'pointer', zIndex: 2 }}
          />
          <input type="range" min={noiseCutoff + 5} max={95} value={mainstreamCutoff}
            onChange={function(e) { onCutoffChange(Number(e.target.value), noiseCutoff) }}
            style={{ position: 'absolute', top: 4, left: 0, width: '100%', height: 24, opacity: 0, cursor: 'pointer', zIndex: 3 }}
          />
          <div style={{ position: 'absolute', top: 6, left: noiseCutoff + '%', transform: 'translateX(-50%)', width: 16, height: 16, borderRadius: '50%', background: 'white', border: '2px solid ' + TIER_STYLES.controversial.color, boxShadow: '0 1px 4px rgba(0,0,0,.15)', zIndex: 4, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 6, left: mainstreamCutoff + '%', transform: 'translateX(-50%)', width: 16, height: 16, borderRadius: '50%', background: 'white', border: '2px solid ' + TIER_STYLES.mainstream.color, boxShadow: '0 1px 4px rgba(0,0,0,.15)', zIndex: 4, pointerEvents: 'none' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7280' }}>
          <span>Noise (&lt;{noiseCutoff}th pctl)</span>
          <span>Controversial ({noiseCutoff}-{mainstreamCutoff}th)</span>
          <span>Mainstream (&gt;{mainstreamCutoff}th pctl)</span>
        </div>
      </div>

      {/* Summary cards — responsive wrap, clickable to scroll to tier */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {(['mainstream', 'controversial', 'fringe', 'noise'] as const).map(function(tier) {
          var style = TIER_STYLES[tier]
          if (tier === 'fringe' && !showFringe) return null
          return (
            <button key={tier} onClick={function() {
              // Uncollapse the tier and scroll to it
              setCollapsedTiers(function(prev) { var next = { ...prev }; delete next[tier]; return next })
              setTimeout(function() {
                var el = document.getElementById('signal-tier-' + tier)
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }, 50)
            }}
              style={{ flex: '1 1 120px', minWidth: 120, background: style.bg, border: '1px solid ' + style.border, borderRadius: 10, padding: '12px 14px', textAlign: 'center', cursor: 'pointer', transition: 'box-shadow .15s' }}
              onMouseEnter={function(e) { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px ' + style.border }}
              onMouseLeave={function(e) { (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: style.color }}>{counts[tier]}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: style.color, marginTop: 2 }}>{style.icon} {style.label}</div>
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                {classified.length > 0 ? Math.round(counts[tier] / classified.length * 100) : 0}%
              </div>
            </button>
          )
        })}
      </div>

      {/* Tier sections — collapsible with sticky headers */}
      {tiers.map(function(tier) {
        if (tier === 'fringe' && !showFringe) return null
        var style = TIER_STYLES[tier]
        var items = classified.filter(function(c) { return c.tier === tier })
          .sort(function(a, b) { return Math.abs(b.score) - Math.abs(a.score) })
        var isCollapsed = !!collapsedTiers[tier]
        var isExpanded = !!expandedTiers[tier]
        var displayItems = isCollapsed ? [] : (isExpanded ? items : items.slice(0, DEFAULT_VISIBLE))

        if (items.length === 0) return null

        return (
          <div key={tier} id={'signal-tier-' + tier} style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
            {/* Fixed header — always visible, click to collapse/expand */}
            <button onClick={function() { toggleCollapse(tier) }}
              style={{
                width: '100%', borderBottom: isCollapsed ? 'none' : '1px solid #f3f4f6', padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: 8, background: style.bg,
                border: 'none', cursor: 'pointer', textAlign: 'left',
              }}>
              <span style={{ fontSize: 12, color: style.color, fontWeight: 700, transition: 'transform .15s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0)', display: 'inline-block' }}>{'\u25BC'}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: style.color }}>{style.icon} {style.label}</span>
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>{items.length} comments</span>
              {tier === 'mainstream' && !isCollapsed && (
                <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto' }}>Top {100 - mainstreamCutoff}% by score within each thread</span>
              )}
            </button>

            {/* Comments — collapsible */}
            {!isCollapsed && (
              <>
                <div style={{ padding: '4px 0' }}>
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
                {items.length > DEFAULT_VISIBLE && (
                  <div style={{ padding: '8px 16px', borderTop: '1px solid #f3f4f6', textAlign: 'center' }}>
                    <button onClick={function() { toggleExpand(tier) }}
                      style={{ fontSize: 11, fontWeight: 600, color: HERMES, background: 'none', border: 'none', cursor: 'pointer' }}>
                      {isExpanded ? 'Show top ' + DEFAULT_VISIBLE : 'Show all ' + items.length + ' comments'}
                    </button>
                  </div>
                )}
              </>
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
