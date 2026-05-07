'use client'
// components/analyze/textmine/WordCloud.tsx
// Renders a word cloud in two modes: frequency (interactive toggle) and grouped by theme.
// Words sized by corpus frequency. Theme-keyword words colored by their theme.

import { useState, useMemo } from 'react'
import { Theme, THEME_PALETTE, getRowText } from '@/lib/themeUtils'
import { extractOpinions } from '@/lib/opinionMining'

import { T } from '@/lib/analyzeTheme'

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by','from',
  'is','was','are','were','be','been','has','have','had','do','did','does','i','we',
  'you','they','it','this','that','my','our','your','their','its','not','no','so','as',
  'if','can','will','just','get','got','more','very','also','out','up','about','what',
  'how','all','one','new','when','would','could','should','than','then','even','still',
  'use','used','using','us','me','him','her','them','there','need','want','really',
  'after','before','which','who','where','into','too','most','any','some','much','make',
  'made','way','well','good','great','like','time','day','year','now','long','since',
  'back','over','go','going','always','never','ever','only','other','another','each',
  'few','many','both','between','during','while','through','without','within','against',
  'along','because','due','per','own','off','such','here','same',
])

interface WordEntry {
  word: string
  freq: number
  themeIdx: number
}

interface Props {
  themes: Theme[]
  themeColors: Record<number, typeof THEME_PALETTE[0]>
  parsedData: Record<string, unknown>[]
  activeField: string
  activeFields?: string[]
  onWordClick?: (word: string | null, themeIdx: number, type: string) => void
  isReddit?: boolean
}

function Word({ word, freq, themeIdx, dimmed, themeColors, maxFreq, totalResponses, sentiment, colorBy, onClick, signalScore, maxSignal, sizeBy }: {
  word: string; freq: number; themeIdx: number; dimmed: boolean
  themeColors: Record<number, typeof THEME_PALETTE[0]>; maxFreq: number
  totalResponses: number
  sentiment?: { positive: number; negative: number; neutral: number }
  colorBy?: 'theme' | 'sentiment'
  onClick?: () => void
  signalScore?: number; maxSignal?: number; sizeBy?: 'frequency' | 'signal'
}) {
  const [hov, setHov] = useState(false)
  const pal = (!dimmed && themeIdx >= 0 && colorBy !== 'sentiment') ? (themeColors[themeIdx] || THEME_PALETTE[0]) : null
  const useSignal = sizeBy === 'signal' && signalScore != null && maxSignal
  const sizeValue = useSignal ? Math.abs(signalScore!) : freq
  const sizeMax = useSignal ? Math.max(maxSignal!, 1) : Math.max(maxFreq, 1)
  const size = 12 + Math.round((sizeValue / sizeMax) * 20)
  const pct = totalResponses > 0 ? Math.round(freq / totalResponses * 100) : 0

  // Sentiment coloring
  var sentColor = T.textMute
  var sentBg = 'transparent'
  if (colorBy === 'sentiment' && sentiment && !dimmed) {
    var total = sentiment.positive + sentiment.negative + sentiment.neutral
    if (total > 0) {
      var posPct = sentiment.positive / total
      var negPct = sentiment.negative / total
      if (posPct > 0.6) { sentColor = '#059669'; sentBg = hov ? '#ecfdf5' : 'transparent' }
      else if (negPct > 0.6) { sentColor = '#dc2626'; sentBg = hov ? '#fef2f2' : 'transparent' }
      else if (posPct > 0.4) { sentColor = '#16a34a'; sentBg = hov ? '#f0fdf4' : 'transparent' }
      else if (negPct > 0.4) { sentColor = '#ef4444'; sentBg = hov ? '#fef2f2' : 'transparent' }
      else { sentColor = '#6b7280' }
    }
  }

  var wordColor = colorBy === 'sentiment'
    ? (dimmed ? '#d1d5db' : sentColor)
    : (pal ? (hov ? pal.border : pal.text) : (dimmed ? '#d1d5db' : T.textMute))
  var wordBg = colorBy === 'sentiment' ? sentBg : (pal && hov ? pal.light : 'transparent')

  return (
    <span
      onClick={onClick}
      title={word + ': ' + freq + ' occurrences (' + pct + '%)' + (useSignal ? ' | avg score: ' + Math.round(signalScore!) : '') + (sentiment ? ' | +' + sentiment.positive + ' -' + sentiment.negative : '')}
      style={{
        fontSize: size, fontWeight: freq > maxFreq * 0.5 ? 700 : 500,
        color: wordColor, background: wordBg,
        padding: '1px 4px', borderRadius: 4, cursor: onClick ? 'pointer' : 'default',
        transition: 'all .15s', display: 'inline-flex', alignItems: 'baseline', gap: 2,
        opacity: dimmed ? 0.3 : 1,
      }}
      onMouseEnter={function() { setHov(true) }}
      onMouseLeave={function() { setHov(false) }}
    >
      {word}
      <span style={{ fontSize: Math.max(9, size - 6), fontWeight: 600, opacity: 0.6 }}>{pct}%</span>
    </span>
  )
}

export default function WordCloud({ themes, themeColors, parsedData, activeField, activeFields, onWordClick, isReddit }: Props) {
  const [cloudMode, setCloudMode] = useState<'frequency' | 'grouped'>('grouped')
  const [colorBy, setColorBy] = useState<'theme' | 'sentiment'>('theme')
  const [sizeBy, setSizeBy] = useState<'frequency' | 'signal'>('frequency')
  const [activeThemes, setActiveThemes] = useState<Set<number> | null>(null)
  const [hoveredTheme, setHoveredTheme] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  const fields = activeFields && activeFields.length ? activeFields : (activeField ? [activeField] : [])
  if (!themes || !themes.length || !fields.length) return null

  // Per-row lowercased text — used for row-based counts so a word that
  // appears 3× in one comment counts as 1, not 3. Row counts match the
  // intuitive meaning of "X% of comments mention food" and align with
  // the percentage shown in OpinionPopover / ThemePopover.
  const perRowText: string[] = parsedData.map(function(r) { return getRowText(r, fields).toLowerCase() })

  // Build word-to-theme map from keywords
  const wordThemeMap: Record<string, { themeIdx: number; freq: number }> = {}
  themes.forEach(function(t, idx) {
    ;(t.keywords || []).forEach(function(kw) {
      if (!wordThemeMap[kw.toLowerCase()]) wordThemeMap[kw.toLowerCase()] = { themeIdx: idx, freq: 0 }
    })
  })

  // Count keyword frequencies — number of ROWS (comments) where the keyword appears.
  Object.keys(wordThemeMap).forEach(function(w) {
    const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
    var rows = 0
    for (var i = 0; i < perRowText.length; i++) {
      if (re.test(perRowText[i])) rows++
    }
    wordThemeMap[w].freq = rows
  })

  // Build general word frequency for non-keyword words — also row-based so
  // it's consistent with the keyword counts. Each word counts once per row.
  const freqMap: Record<string, number> = {}
  for (var i = 0; i < perRowText.length; i++) {
    const seen = new Set<string>()
    const tokens = perRowText[i].split(/\W+/)
    for (var j = 0; j < tokens.length; j++) {
      const w = tokens[j]
      if (w.length > 3 && !STOP_WORDS.has(w) && !seen.has(w)) {
        seen.add(w)
        freqMap[w] = (freqMap[w] || 0) + 1
      }
    }
  }

  // Include all theme keywords that have matches, PLUS ensure every theme with count>0
  // on the themes page has at least its top keyword represented (even if local freq is low)
  const allWords: WordEntry[] = Object.entries(wordThemeMap)
    .filter(function([, v]) { return v.freq > 0 })
    .map(function([w, v]) { return { word: w, freq: v.freq, themeIdx: v.themeIdx } })

  // Ensure every theme with count>0 on the themes page has at least one keyword in the cloud
  const representedThemes = new Set(allWords.map(function(w) { return w.themeIdx }))
  themes.forEach(function(t, idx) {
    if (t.count > 0 && !representedThemes.has(idx)) {
      // Pick the first keyword and give it the theme's count as frequency
      var topKw = (t.keywords || [])[0]
      if (topKw) allWords.push({ word: topKw.toLowerCase(), freq: Math.max(1, t.count), themeIdx: idx })
    }
  })

  const covered = new Set(Object.keys(wordThemeMap))
  Object.entries(freqMap).sort(function(a, b) { return b[1] - a[1] }).slice(0, 20).forEach(function([w, f]) {
    if (!covered.has(w) && f > 0) allWords.push({ word: w, freq: f, themeIdx: -1 })
  })

  if (!allWords.length) return null

  const maxFreq = Math.max(...allWords.map(function(w) { return w.freq }), 1)

  // Compute per-word average score for signal strength sizing (Reddit only)
  var wordSignals = useMemo(function() {
    if (!isReddit) return {} as Record<string, { totalScore: number; count: number; avg: number }>
    var map: Record<string, { totalScore: number; count: number; avg: number }> = {}
    var wordSet = new Set(allWords.map(function(w) { return w.word }))
    parsedData.forEach(function(row) {
      var text = getRowText(row, fields).toLowerCase()
      if (!text) return
      var score = Number(row.likes ?? row.score) || 0
      var words = text.split(/\W+/)
      var seen = new Set<string>()
      words.forEach(function(w) {
        if (wordSet.has(w) && !seen.has(w)) {
          seen.add(w)
          if (!map[w]) map[w] = { totalScore: 0, count: 0, avg: 0 }
          map[w].totalScore += score
          map[w].count++
        }
      })
    })
    Object.values(map).forEach(function(v) { v.avg = v.count > 0 ? v.totalScore / v.count : 0 })
    return map
  }, [parsedData.length, allWords.length, isReddit])

  // Compute per-word sentiment in a single pass (much faster than per-word extraction)
  var wordSentiments = useMemo(function() {
    var wordSet = new Set(allWords.map(function(w) { return w.word }))
    var map: Record<string, { positive: number; negative: number; neutral: number }> = {}
    wordSet.forEach(function(w) { map[w] = { positive: 0, negative: 0, neutral: 0 } })

    // Import opinion word sets inline to avoid per-word extraction overhead
    var posWords = new Set(['good','great','excellent','amazing','awesome','fantastic','wonderful','perfect','best','delicious','tasty','fresh','friendly','nice','lovely','clean','quick','fast','warm','crispy','tender','flavorful','juicy','rich','creamy','attentive','helpful','polite','outstanding','superb','incredible','comfortable','cozy','pleasant','enjoyable','reasonable','generous','authentic','consistent','exceptional','phenomenal','satisfying','refreshing','favorite','love','loved','recommend'])
    var negWords = new Set(['bad','terrible','horrible','awful','worst','poor','slow','cold','bland','dry','stale','rude','dirty','expensive','overpriced','small','loud','noisy','crowded','long','soggy','burnt','undercooked','overcooked','raw','greasy','salty','bitter','tasteless','mediocre','disappointing','disgusting','uncomfortable','unfriendly','unprofessional','filthy','gross','lukewarm','watery','tough','chewy','rubbery','hard','old','late','wrong','missing','broken','ignored','waited','annoyed','frustrated','underwhelming','overrated'])

    var conjSet = new Set(['and','or','nor','also','plus','with'])
    parsedData.forEach(function(row) {
      var text = getRowText(row, fields).toLowerCase()
      if (!text) return
      // Split on clause boundaries first
      var clauses = text.split(/\b(?:but|however|although|yet|though|while|whereas)\b|[,]/i)
      clauses.forEach(function(clause) {
      var words = clause.trim().split(/\W+/)
      for (var i = 0; i < words.length; i++) {
        var w = words[i]
        if (!wordSet.has(w)) continue
        for (var j = Math.max(0, i - 2); j < Math.min(words.length, i + 3); j++) {
          if (j === i) continue
          // Skip if conjunction between
          var blocked = false
          for (var bk = Math.min(i,j)+1; bk < Math.max(i,j); bk++) { if (conjSet.has(words[bk])) { blocked = true; break } }
          if (blocked) continue
          var neighbor = words[j]
          if (posWords.has(neighbor)) map[w].positive++
          else if (negWords.has(neighbor)) map[w].negative++
        }
      }
      }) // end clauses
    })
    return map
  }, [parsedData.length, allWords.length])

  function toggleTheme(idx: number) {
    const all = new Set(themes.map(function(_, i) { return i }))
    const cur = activeThemes || all
    const n = new Set(cur)
    if (n.has(idx)) {
      if (n.size === 1) { setActiveThemes(null); return }
      n.delete(idx)
    } else {
      n.add(idx)
    }
    setActiveThemes(n.size === all.size ? null : n)
  }

  const total = parsedData.filter(function(r) { return String(r[activeField] || '').trim().length > 0 }).length

  // Filter themes by 3% threshold (same logic as Themes page) unless showAll
  var MIN_PCT = 3
  var visibleThemeIdxs = new Set(
    showAll
      ? themes.map(function(_, i) { return i })
      : themes.map(function(t, i) { return { idx: i, pct: total > 0 ? t.count / total * 100 : 0 } })
          .filter(function(x) { return x.pct >= MIN_PCT })
          .map(function(x) { return x.idx })
  )
  // Fallback: if no themes pass threshold, show top 5
  if (!visibleThemeIdxs.size && !showAll) {
    ;[...themes].map(function(t, i) { return { idx: i, count: t.count } })
      .sort(function(a, b) { return b.count - a.count })
      .slice(0, 5)
      .forEach(function(x) { visibleThemeIdxs.add(x.idx) })
  }
  // Filter words to only those belonging to visible themes (or non-theme words)
  var filteredWords = allWords.filter(function(w) { return w.themeIdx < 0 || visibleThemeIdxs.has(w.themeIdx) })
  // Apply same 3% threshold to individual words (extends the threshold from
  // theme-level to word-level so the cloud isn't cluttered with rare terms).
  // 'Show all' bypasses this filter — same checkbox controls both.
  if (!showAll) {
    filteredWords = filteredWords.filter(function(w) { return total > 0 && (w.freq / total * 100) >= MIN_PCT })
  }
  if (!filteredWords.length && !showAll) filteredWords = allWords.slice(0, 10) // fallback: show top 10

  // Max signal score for sizing in signal strength mode
  var maxSignal = 1
  if (isReddit && Object.keys(wordSignals).length > 0) {
    maxSignal = Math.max(1, ...Object.values(wordSignals).map(function(v) { return Math.abs(v.avg) }))
  }

  return (
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '18px 20px' }}>
      {/* Mode toggle + Show All */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.textMid }}>Theme Clouds</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll} onChange={function() { setShowAll(function(v) { return !v }) }} style={{ accentColor: T.accent }} />
            Show all
          </label>
          {!showAll && visibleThemeIdxs.size < themes.length && (
            <span style={{ fontSize: 10, color: T.textFaint }}>({themes.length - visibleThemeIdxs.size} theme{themes.length - visibleThemeIdxs.size !== 1 ? 's' : ''} below {MIN_PCT}% hidden)</span>
          )}
          <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
            {(['theme', 'sentiment'] as const).map(function(mode) {
            return (
              <button
                key={mode}
                onClick={function() { setColorBy(mode) }}
                style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                  background: colorBy === mode ? T.bgCard : 'transparent',
                  color: colorBy === mode ? (mode === 'sentiment' ? '#059669' : T.accent) : T.textMute,
                  border: 'none', cursor: 'pointer',
                  boxShadow: colorBy === mode ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
                }}
              >
                {mode === 'theme' ? 'Theme' : 'Sentiment'}
              </button>
            )
          })}
          </div>
          {isReddit && (
          <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
            {(['frequency', 'signal'] as const).map(function(mode) {
            return (
              <button
                key={mode}
                onClick={function() { setSizeBy(mode) }}
                style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                  background: sizeBy === mode ? T.bgCard : 'transparent',
                  color: sizeBy === mode ? '#d97706' : T.textMute,
                  border: 'none', cursor: 'pointer',
                  boxShadow: sizeBy === mode ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
                }}
              >
                {mode === 'frequency' ? 'Frequency' : 'Signal Strength'}
              </button>
            )
          })}
          </div>
          )}
          <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
            {(['frequency', 'grouped'] as const).map(function(mode) {
            return (
              <button
                key={mode}
                onClick={function() { setCloudMode(mode) }}
                style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                  background: cloudMode === mode ? T.bgCard : 'transparent',
                  color: cloudMode === mode ? T.accent : T.textMute,
                  border: 'none', cursor: 'pointer',
                  boxShadow: cloudMode === mode ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
                }}
              >
                {mode === 'frequency' ? 'Frequency' : 'Grouped'}
              </button>
            )
          })}
        </div>
        </div>
      </div>

      {/* Frequency mode */}
      {cloudMode === 'frequency' && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {themes.map(function(t, idx) {
              if (!visibleThemeIdxs.has(idx)) return null
              const pal = themeColors[idx] || THEME_PALETTE[0]
              const isOn = !activeThemes || activeThemes.has(idx)
              const pct = total > 0 ? Math.round(t.count / total * 100) : 0
              const isHovered = hoveredTheme === idx
              return (
                <button
                  key={t.id}
                  onClick={function() { toggleTheme(idx) }}
                  onMouseEnter={function() { setHoveredTheme(idx) }}
                  onMouseLeave={function() { setHoveredTheme(null) }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 11, fontWeight: isOn ? 700 : 500,
                    padding: '4px 10px', borderRadius: 10, cursor: 'pointer',
                    background: isOn ? (isHovered ? pal.border : pal.bg) : '#f3f4f6',
                    color: isOn ? (isHovered ? 'white' : pal.text) : '#9ca3af',
                    border: '1px solid ' + (isOn ? pal.border + '80' : '#e5e7eb'),
                    opacity: isOn ? 1 : 0.6,
                    boxShadow: isHovered && isOn ? '0 2px 8px ' + pal.border + '40' : 'none',
                    transition: 'all .15s',
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: isOn ? pal.border : '#d1d5db', flexShrink: 0, transition: 'background .15s', display: 'inline-block' }} />
                  {t.name}
                  <span style={{ fontSize: 10, opacity: isOn ? 0.75 : 0.5, fontWeight: 600 }}>{pct}%</span>
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 10px', alignItems: 'baseline', lineHeight: 1.6 }}>
            {[...filteredWords].sort(function(a, b) { return b.freq - a.freq }).map(function(w) {
              let dimmed = false
              if (hoveredTheme !== null) dimmed = w.themeIdx !== hoveredTheme
              else if (activeThemes !== null) dimmed = w.themeIdx >= 0 && !activeThemes.has(w.themeIdx)
              return <Word key={w.word} {...w} dimmed={dimmed} themeColors={themeColors} maxFreq={maxFreq} totalResponses={total} sentiment={wordSentiments[w.word]} colorBy={colorBy} signalScore={wordSignals[w.word]?.avg} maxSignal={maxSignal} sizeBy={sizeBy} onClick={function() { if (onWordClick) onWordClick(w.word, w.themeIdx, w.themeIdx >= 0 ? 'keyword' : 'word') }} />
            })}
          </div>
        </div>
      )}

      {/* Grouped mode */}
      {cloudMode === 'grouped' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[...themes].sort(function(a, b) { return b.count - a.count }).map(function(t) {
            const idx = themes.indexOf(t)
            if (!visibleThemeIdxs.has(idx)) return null
            const pal = themeColors[idx] || THEME_PALETTE[0]
            const tWords = allWords.filter(function(w) { return w.themeIdx === idx }).sort(function(a, b) { return b.freq - a.freq })
            if (!tWords.length) return null
            const pct = total > 0 ? Math.round(t.count / total * 100) : 0
            return (
              <div key={t.id} style={{ display: 'flex', gap: 0, alignItems: 'flex-start' }}>
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, marginRight: 8, alignSelf: 'stretch', minHeight: 24 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: pal.text, background: pal.bg, border: '1px solid ' + pal.border + '70', borderRadius: 5, padding: '2px 4px', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                    {pct}%
                  </span>
                </div>
                <div style={{ flexShrink: 0, width: 6, borderRadius: 3, background: pal.border, alignSelf: 'stretch', minHeight: 24, marginRight: 12 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    {onWordClick ? (
                      <button onClick={function() { onWordClick(null, idx, 'theme') }}
                        style={{ fontSize: 11, fontWeight: 700, color: pal.text, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                        title="Click to see frequency over time + sample comments">
                        {t.name}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: pal.text }}>{t.name}</span>
                    )}
                    {onWordClick && (
                      <button
                        onClick={function() { onWordClick(null, idx, 'theme') }}
                        style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border + '50', cursor: 'pointer' }}
                      >
                        View {t.count > 0 ? t.count + ' ' : ''}comments &rarr;
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 8px', alignItems: 'baseline' }}>
                    {(showAll
                      ? tWords
                      : tWords.filter(function(w) { return total > 0 && (w.freq / total * 100) >= MIN_PCT })
                    ).map(function(w) {
                      return <Word key={w.word} {...w} dimmed={false} themeColors={themeColors} maxFreq={maxFreq} totalResponses={total} sentiment={wordSentiments[w.word]} colorBy={colorBy} signalScore={wordSignals[w.word]?.avg} maxSignal={maxSignal} sizeBy={sizeBy} onClick={function() { if (onWordClick) onWordClick(w.word, idx, 'keyword') }} />
                    })}
                    {!showAll && tWords.some(function(w) { return total > 0 && (w.freq / total * 100) < MIN_PCT }) && (
                      <span style={{ fontSize: 10, color: T.textFaint, marginLeft: 4 }}>
                        +{tWords.filter(function(w) { return total > 0 && (w.freq / total * 100) < MIN_PCT }).length} below {MIN_PCT}% hidden
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
