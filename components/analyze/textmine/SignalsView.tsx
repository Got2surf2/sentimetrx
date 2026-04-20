'use client'

// components/analyze/textmine/SignalsView.tsx
// Reddit signal analysis: classifies comments into Mainstream / Controversial / Noise / Fringe
// using per-thread percentile ranking of comment scores.
// Cards are sticky at top. Clicking a card shows its comments below (one at a time).

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
  isAuthorReply: boolean
}

interface Props {
  rows: Record<string, unknown>[]
  mainstreamCutoff: number   // default 70
  noiseCutoff: number        // default 30
  onCutoffChange: (mainstream: number, noise: number) => void
  datasetSource?: string     // 'reddit' | 'substack'
}

var HERMES = '#E8632A'
var DEFAULT_VISIBLE = 5

// Detect if text is primarily a URL (no meaningful content)
var URL_RE = /^(\s*(https?:\/\/\S+)\s*)+$/i

// Reddit tiers
var REDDIT_TIER_KEYS: Array<'mainstream' | 'controversial' | 'noise' | 'fringe'> = ['mainstream', 'controversial', 'fringe', 'noise']
var REDDIT_TIER_STYLES = {
  mainstream:    { label: 'Mainstream',    color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', icon: '\u2B06' },
  controversial: { label: 'Controversial', color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '\u26A0' },
  fringe:        { label: 'Fringe',        color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', icon: '\u2B07' },
  noise:         { label: 'Noise',         color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb', icon: '\u2022' },
}

// Substack tiers
var SUBSTACK_TIER_KEYS: Array<'mainstream' | 'controversial' | 'noise' | 'fringe'> = ['mainstream', 'controversial', 'fringe', 'noise']
var SUBSTACK_TIER_STYLES = {
  mainstream:    { label: 'Resonant',      color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', icon: '\u2764' },
  controversial: { label: 'Discussed',     color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '\uD83D\uDCAC' },
  fringe:        { label: 'Low Engagement', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', icon: '\u2B07' },
  noise:         { label: 'Ignored',       color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb', icon: '\u2022' },
}

export default function SignalsView({ rows, mainstreamCutoff, noiseCutoff, onCutoffChange, datasetSource }: Props) {
  var isSubstack = datasetSource === 'substack'
  var TIER_KEYS = isSubstack ? SUBSTACK_TIER_KEYS : REDDIT_TIER_KEYS
  var TIER_STYLES = isSubstack ? SUBSTACK_TIER_STYLES : REDDIT_TIER_STYLES
  var [activeTier, setActiveTier] = useState<'mainstream' | 'controversial' | 'fringe' | 'noise' | null>(null)
  var [copied, setCopied] = useState(false)

  var classified = useMemo(function() {
    if (!rows.length) return [] as SignalComment[]

    // Group by post/thread, filtering out URL-only comments
    var groupKey = isSubstack ? 'post_title' : 'thread_id'
    var scoreKey = isSubstack ? 'likes' : 'score'
    var threads: Record<string, { score: number; row: Record<string, unknown> }[]> = {}
    rows.forEach(function(r) {
      var text = String(r.body || r.user_message || '').trim()
      if (!text || URL_RE.test(text)) return
      var tid = String(r[groupKey] || 'unknown')
      if (!threads[tid]) threads[tid] = []
      threads[tid].push({ score: Number(r[scoreKey]) || 0, row: r })
    })

    var allClassified: SignalComment[] = []

    Object.entries(threads).forEach(function([_tid, entries]) {
      var sorted = [...entries].sort(function(a, b) { return b.score - a.score })
      var count = sorted.length

      sorted.forEach(function(entry, rank) {
        var percentile = count > 1 ? Math.round((1 - rank / (count - 1)) * 100) : 50

        var tier: 'mainstream' | 'controversial' | 'noise' | 'fringe'
        if (isSubstack) {
          // Substack: likes-based — Resonant (high likes), Discussed (moderate + replies), Ignored (no engagement)
          var replies = Number(entry.row.children_count) || 0
          if (percentile >= mainstreamCutoff) {
            tier = 'mainstream'  // Resonant
          } else if (percentile >= noiseCutoff || replies >= 3) {
            tier = 'controversial'  // Discussed
          } else if (entry.score === 0 && replies === 0) {
            tier = 'noise'  // Ignored
          } else {
            tier = 'fringe'  // Low engagement
          }
        } else {
          // Reddit: score-based percentile
          if (percentile >= mainstreamCutoff) {
            tier = 'mainstream'
          } else if (percentile >= noiseCutoff) {
            tier = 'controversial'
          } else if (entry.score < 0) {
            tier = 'fringe'
          } else {
            tier = 'noise'
          }
        }

        var isAuthorReply = !!entry.row.is_author_reply

        allClassified.push({
          text: String(entry.row.body || entry.row.user_message || ''),
          score: entry.score,
          author: String(entry.row.author || entry.row.participant_id || ''),
          thread: String(entry.row.post_title || entry.row.thread_title || ''),
          subreddit: String(entry.row.subreddit || ''),
          date: String(entry.row.comment_date || entry.row.post_date || ''),
          percentile: percentile,
          tier: tier,
          permalink: String(entry.row.permalink || ''),
          isAuthorReply: isAuthorReply,
        })
      })
    })

    return allClassified
  }, [rows, mainstreamCutoff, noiseCutoff, isSubstack])

  var counts = { mainstream: 0, controversial: 0, fringe: 0, noise: 0 }
  classified.forEach(function(c) { counts[c.tier]++ })

  // Get items for active tier
  var activeItems = activeTier
    ? classified.filter(function(c) { return c.tier === activeTier })
        .sort(function(a, b) { return Math.abs(b.score) - Math.abs(a.score) })
    : []
  var activeStyle = activeTier ? TIER_STYLES[activeTier] : null

  function handleCardClick(tier: 'mainstream' | 'controversial' | 'fringe' | 'noise') {
    if (activeTier === tier) {
      setActiveTier(null)
    } else {
      setActiveTier(tier)
      setCopied(false)
    }
  }

  function handleCopyAll() {
    if (!activeTier || !activeItems.length) return
    var style = TIER_STYLES[activeTier]
    var header = style.label.toUpperCase() + ' (' + activeItems.length + ' comments)\n' + '\u2500'.repeat(40) + '\n\n'
    var body = activeItems.map(function(c, i) {
      return (i + 1) + '. [Score: ' + (c.score >= 0 ? '+' : '') + c.score + ' | ' + c.percentile + 'th pctl] u/' + c.author + '\n' + c.text + '\n'
    }).join('\n')
    navigator.clipboard.writeText(header + body).then(function() {
      setCopied(true)
      setTimeout(function() { setCopied(false) }, 2000)
    })
  }

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

      {/* Summary cards — sticky, all 4 visible, clickable */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#f4f5f7', padding: '10px 0' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {TIER_KEYS.map(function(tier) {
            var style = TIER_STYLES[tier]
            var isActive = activeTier === tier
            return (
              <button key={tier} onClick={function() { handleCardClick(tier) }}
                style={{
                  flex: '1 1 120px', minWidth: 120, background: style.bg,
                  border: isActive ? '2px solid ' + style.color : '1px solid ' + style.border,
                  borderRadius: 10, padding: '12px 14px', textAlign: 'center',
                  cursor: 'pointer', transition: 'all .15s',
                  boxShadow: isActive ? '0 2px 12px ' + style.border : 'none',
                  transform: isActive ? 'scale(1.03)' : 'scale(1)',
                }}
                onMouseEnter={function(e) { if (!isActive) (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px ' + style.border }}
                onMouseLeave={function(e) { if (!isActive) (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: style.color }}>{counts[tier]}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: style.color, marginTop: 2 }}>{style.icon} {style.label}</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                  {classified.length > 0 ? Math.round(counts[tier] / classified.length * 100) : 0}%
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Comment panel — shows for the selected tier */}
      {activeTier && activeStyle && activeItems.length > 0 && (
        <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 320px)' }}>
          {/* Header with collapse */}
          <div style={{
            padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8,
            background: activeStyle.bg, borderBottom: '1px solid ' + activeStyle.border,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: activeStyle.color }}>{activeStyle.icon} {activeStyle.label}</span>
            <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>{activeItems.length} comments</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={handleCopyAll}
                style={{ fontSize: 11, fontWeight: 600, color: copied ? '#059669' : '#6b7280', background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, transition: 'color .15s' }}>
                {copied ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                )}
                {copied ? 'Copied' : 'Copy all'}
              </button>
              <button onClick={function() { setActiveTier(null) }}
                style={{ fontSize: 14, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>
                {'\u00D7'}
              </button>
            </div>
          </div>

          {/* Comments — scrollable */}
          <div style={{ padding: '4px 0', overflowY: 'auto', flex: 1 }}>
            {activeItems.map(function(c, i) {
              return (
                <div key={i} style={{ padding: '10px 16px', borderBottom: i < activeItems.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                  <div style={{ fontSize: 13, color: '#111827', lineHeight: 1.5, marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {c.text}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#9ca3af', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: c.score >= 0 ? '#059669' : '#dc2626' }}>
                      {isSubstack ? '\u2764 ' + c.score : (c.score >= 0 ? '+' : '') + c.score}
                    </span>
                    <span>{c.percentile}th pctl</span>
                    {c.isAuthorReply && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#e11d48', background: '#fff1f2', padding: '1px 6px', borderRadius: 8, border: '1px solid #fecdd3' }}>Author Reply</span>
                    )}
                    <span>{isSubstack ? '' : 'u/'}{c.author}</span>
                    {c.subreddit && <span>r/{c.subreddit}</span>}
                    {c.date && <span>{c.date}</span>}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{c.thread}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state when a tier is selected but has no comments */}
      {activeTier && activeItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 13 }}>
          No comments in this category
        </div>
      )}
    </div>
  )
}
