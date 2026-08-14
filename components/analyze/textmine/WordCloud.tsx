'use client'
// components/analyze/textmine/WordCloud.tsx
// Renders a word cloud in two modes: frequency (interactive toggle) and grouped by theme.
// Words sized by corpus frequency. Theme-keyword words colored by their theme.

import { useState, useMemo, useTransition } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'
import type { Theme} from '@/lib/themeUtils';
import { THEME_PALETTE, getRowText } from '@/lib/themeUtils'
import { isSubstantiveText } from '@/lib/datasetUtils'
import { SUBSTANTIVE_RULE_NOTE } from '@/lib/usefulness'
import { computeThemeEntities, themeKey } from '@/lib/themeEntities'
import type { EntityRow } from '@/components/analyze/EntitiesCard'
import { extractOpinions } from '@/lib/opinionMining'
import { dimSubLabel, DIM_AXIS_LABEL, AXIS_COLOR, type Axis } from '@/lib/dimensionFields'

// Category dot colors — kept in sync with EntitiesCard so the per-theme "Items"
// chips read the same as the scope-wide Entities card.
const ENTITY_NEUTRAL = '#8FA3AE'
const ENTITY_CAT_COLOR: Record<string, string> = {
  food: '#EA580C', person: '#1E40AF',
  drink: ENTITY_NEUTRAL, place: ENTITY_NEUTRAL, brand: ENTITY_NEUTRAL, other: ENTITY_NEUTRAL,
}

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
  /** Placeholder chip for a theme whose comments matched no keyword strictly
   *  enough to be counted here — its `freq` is borrowed from the theme's own
   *  count, so it is NOT a real term frequency and must not be shown as a
   *  share (it would read as a flat 100% of the theme). */
  synthetic?: boolean
}

interface Props {
  themes: Theme[]
  themeColors: Record<number, typeof THEME_PALETTE[0]>
  parsedData: Record<string, unknown>[]
  activeField: string
  activeFields?: string[]
  onWordClick?: (word: string | null, themeIdx: number, type: string) => void
  onEntityClick?: (entity: { slug: string; canonical: string; category: string; aliases: string[] }) => void
  onDimensionClick?: (axis: string, sub: string) => void
  isReddit?: boolean
  entities?: EntityRow[]
  // Per-theme Dimensions breakdown (themeId → top {axis,sub,count}), from the
  // theme-counts `dimensions` flag. Renders a drillable "Dimensions" chip row.
  themeDimensions?: Record<string, { axis: string; sub: string; count: number }[]>
}

function Word({ word, freq, themeIdx, dimmed, themeColors, maxFreq, totalResponses, themeTotal, themeName, synthetic, sentiment, colorBy, onClick, signalScore, maxSignal, sizeBy }: {
  word: string; freq: number; themeIdx: number; dimmed: boolean
  themeColors: Record<number, typeof THEME_PALETTE[0]>; maxFreq: number
  totalResponses: number
  /** When set, the share is read against THIS THEME's comments instead of the
   *  whole substantive corpus — "10% of people raise Pricing, and 30% of THEM
   *  say price". Only the per-theme grouped view passes it; the flat cloud
   *  mixes themes under one heading, so there the shared corpus denominator is
   *  the only one every chip can be compared on. */
  themeTotal?: number
  themeName?: string
  synthetic?: boolean
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
  // `freq` is a COMMENT count, not an occurrence count — the scan above adds 1
  // per matching row (and the general-word pass de-dupes within a row) — so
  // dividing by a comment total is a like-for-like share either way.
  // Clamped: the theme's own count comes from a broader matcher (stems, word
  // gaps) than this cloud's strict \bword\b, so freq should never exceed it,
  // but a share over 100% is the one thing that must not reach the screen.
  const denom = themeTotal != null && themeTotal > 0 ? themeTotal : totalResponses
  const pct = denom > 0 ? Math.min(100, Math.round(freq / denom * 100)) : 0
  const showPct = !synthetic
  const pctNote = themeTotal != null && themeTotal > 0
    ? freq.toLocaleString() + ' of the ' + themeTotal.toLocaleString() + ' comments in '
      + (themeName || 'this theme') + ' mention it (' + pct + '%)'
    : freq.toLocaleString() + ' of ' + totalResponses.toLocaleString()
      + ' substantive comments mention it (' + pct + '%)'

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
      title={word + ': ' + (synthetic
        ? 'no comment in this theme matches this term exactly — shown so the theme is represented'
        : pctNote)
        + (useSignal ? ' | avg score: ' + Math.round(signalScore!) : '') + (sentiment ? ' | +' + sentiment.positive + ' -' + sentiment.negative : '')}
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
      {showPct && <span style={{ fontSize: Math.max(9, size - 6), fontWeight: 600, opacity: 0.6 }}>{pct}%</span>}
    </span>
  )
}

export default function WordCloud({ themes, themeColors, parsedData, activeField, activeFields, onWordClick, onEntityClick, onDimensionClick, isReddit, entities, themeDimensions }: Props) {
  const [cloudMode, setCloudMode] = useState<'frequency' | 'grouped'>('grouped')
  const [colorBy, setColorBy] = useState<'theme' | 'sentiment'>('theme')
  const [sizeBy, setSizeBy] = useState<'frequency' | 'signal'>('frequency')
  const [activeThemes, setActiveThemes] = useState<Set<number> | null>(null)
  const [hoveredTheme, setHoveredTheme] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  // useTransition lets the showAll click reflect immediately while the
  // (cheap-after-memoization) re-render runs concurrently. isPending drives
  // the Lottie spinner overlay so the user sees the click landed even on
  // larger datasets where the React commit takes a beat.
  const [isPending, startTransition] = useTransition()

  // Stable `fields` array — without this, every render produces a new array
  // reference and busts the memos below.
  const fields = useMemo(
    () => (activeFields && activeFields.length ? activeFields : (activeField ? [activeField] : [])),
    [activeFields, activeField],
  )

  // ── Heavy frequency computation, memoized ──────────────────────────────
  // 45K rows × 100+ keywords = several million substring tests. Was running
  // on every render (so showAll toggle felt laggy on big datasets). Now
  // recomputes only when parsedData / themes / fields change. showAll
  // toggling no longer touches this — just re-runs the cheap filter below.
  const cloudData = useMemo(function() {
    if (!themes || !themes.length || !fields.length) {
      return { perRowText: [] as string[], wordThemeMap: {} as Record<string, { themeIdx: number; freq: number }>, freqMap: {} as Record<string, number>, allWords: [] as WordEntry[], maxFreq: 1, total: 0, nonEmpty: 0 }
    }
    // Substantive lens (the default insight scope): the cloud reads real
    // feedback only — "N/A"/"Nothing"/one-word non-answers carry no term signal
    // and dilute both the frequencies and their denominator. Same scorer stored
    // at ingest (isSubstantiveText). `total` below = substantive rows.
    const perRowText: string[] = parsedData
      .map(function(r) { return getRowText(r, fields) })
      .filter(function(txt) { return isSubstantiveText(txt) })
      .map(function(txt) { return txt.toLowerCase() })

    const wordThemeMap: Record<string, { themeIdx: number; freq: number }> = {}
    themes.forEach(function(t, idx) {
      ;(t.keywords || []).forEach(function(kw) {
        if (!wordThemeMap[kw.toLowerCase()]) wordThemeMap[kw.toLowerCase()] = { themeIdx: idx, freq: 0 }
      })
    })
    Object.keys(wordThemeMap).forEach(function(w) {
      const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
      var rows = 0
      for (var i = 0; i < perRowText.length; i++) if (re.test(perRowText[i])) rows++
      wordThemeMap[w].freq = rows
    })

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

    const allWords: WordEntry[] = Object.entries(wordThemeMap)
      .filter(function([, v]) { return v.freq > 0 })
      .map(function([w, v]) { return { word: w, freq: v.freq, themeIdx: v.themeIdx } })
    const representedThemes = new Set(allWords.map(function(w) { return w.themeIdx }))
    themes.forEach(function(t, idx) {
      if (t.count > 0 && !representedThemes.has(idx)) {
        var topKw = (t.keywords || [])[0]
        if (topKw) allWords.push({ word: topKw.toLowerCase(), freq: Math.max(1, t.count), themeIdx: idx, synthetic: true })
      }
    })
    const covered = new Set(Object.keys(wordThemeMap))
    Object.entries(freqMap).sort(function(a, b) { return b[1] - a[1] }).slice(0, 20).forEach(function([w, f]) {
      if (!covered.has(w) && f > 0) allWords.push({ word: w, freq: f, themeIdx: -1 })
    })

    const maxFreq = Math.max.apply(Math, allWords.map(function(w) { return w.freq }).concat([1]))
    // Denominator = substantive rows (perRowText is already filtered to them),
    // plus the non-empty count so the UI can show how many answers were dropped.
    const total = perRowText.length
    const nonEmpty = parsedData.filter(function(r) {
      return fields.some(function(f) { return String(r[f] || '').trim().length > 0 })
    }).length

    return { perRowText, wordThemeMap, freqMap, allWords, maxFreq, total, nonEmpty }
  }, [parsedData, themes, fields])

  // ── Theme × entity cross-tab ("Items mentioned" per theme) ──────────────
  // "When they talk about <theme>, what items are they asking about?" — shared
  // with the Theme Cards (lib/themeEntities). Filter-aware (parsedData here is
  // the filtered rows). Keyed by theme key (id → name → index).
  const themeEntities = useMemo(function() {
    return computeThemeEntities(themes, parsedData, fields, entities || [])
  }, [parsedData, themes, fields, entities])

  // Compute per-word average score for signal strength sizing (Reddit only)
  var wordSignals = useMemo(function() {
    if (!isReddit) return {} as Record<string, { totalScore: number; count: number; avg: number }>
    var map: Record<string, { totalScore: number; count: number; avg: number }> = {}
    var wordSet = new Set(cloudData.allWords.map(function(w) { return w.word }))
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
  }, [parsedData, cloudData.allWords, fields, isReddit])

  // Compute per-word sentiment in a single pass (much faster than per-word extraction)
  var wordSentiments = useMemo(function() {
    var wordSet = new Set(cloudData.allWords.map(function(w) { return w.word }))
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
  }, [parsedData, cloudData.allWords, fields])

  if (!themes || !themes.length || !fields.length) return null

  const { perRowText, wordThemeMap, freqMap, allWords, maxFreq, total, nonEmpty } = cloudData

  if (!allWords.length) return null

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

  // `total` is now memoized inside cloudData (canonical denominator: rows
  // with text in any analyzed field). Same value, same purpose.

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
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '18px 20px', position: 'relative' as const }}>
      {/* Mode toggle + Show All — sticky so the controls stay visible while
          the user scrolls through long theme lists. Solid bg + extended
          horizontal padding so scrolled words don't bleed through underneath. */}
      <div style={{
        position: 'sticky' as const, top: 0, zIndex: 5,
        background: T.bgCard,
        margin: '-18px -20px 16px',
        padding: '14px 20px',
        borderBottom: '1px solid ' + T.borderMid,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.textMid }}>
          Theme Clouds
          {total > 0 && (
            <span style={{ fontSize: 10, fontWeight: 500, color: T.textFaint, marginLeft: 8 }}
              title={'The badge on the left of each row is the theme\'s share of all ' + total.toLocaleString() + ' substantive comments. The percentage on each TERM is its share of that theme\'s own comments — "9% of people raise Pricing, and 24% of them say price". Non-substantive answers ('
                + (nonEmpty - total).toLocaleString() + ') are excluded so they don’t dilute either number. ' + SUBSTANTIVE_RULE_NOTE}>
              over {total.toLocaleString()} substantive{nonEmpty > total ? ' of ' + nonEmpty.toLocaleString() + ' answered' : ''} {'·'} terms are % of their theme
            </span>
          )}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll}
              onChange={function() {
                // setShowAll runs inside a transition so React commits the
                // checkbox state immediately and renders the heavier word
                // grid concurrently. isPending drives the Lottie overlay.
                startTransition(function() { setShowAll(function(v) { return !v }) })
              }}
              style={{ accentColor: T.accent }} />
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

      {/* Pending overlay — shown while React is busy committing a Show all
          toggle (or any future transition). Sits above the body so the user
          gets immediate visual confirmation that their click landed. */}
      {isPending && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 4,
          background: 'rgba(255,255,255,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 12,
        }}>
          <LottieLoader size={80} message={showAll ? 'Showing all themes…' : 'Filtering to top themes…'} />
        </div>
      )}

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
                    {t.avgRating != null && (
                      <span title={'Average rating for this theme: ' + t.avgRating.toFixed(2) + (t.ratingDelta != null ? ' (' + (t.ratingDelta >= 0 ? '+' : '') + t.ratingDelta.toFixed(2) + ' vs overall)' : '')}
                        style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', color: t.ratingDelta != null && t.ratingDelta > 0.1 ? '#059669' : t.ratingDelta != null && t.ratingDelta < -0.1 ? '#dc2626' : '#92400e' }}>
                        {'★'} {t.avgRating.toFixed(1)}
                      </span>
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
                  {/* Terms here read against THIS THEME's comments, not the whole
                      corpus: "9% of people raise Pricing, and 24% of THEM say
                      price". Against the corpus every term collapsed toward 0%
                      (a term inside a 9% theme can't exceed 9% of everything),
                      so the chips carried no usable contrast — several real
                      contributors rendered a flat "0%". The hide threshold uses
                      the SAME denominator as the number on the chip; if it kept
                      using the corpus total the "below 3% hidden" note would be
                      talking about a percentage the user can't see. */}
                  {(function() {
                    const themeTotal = t.count > 0 ? t.count : 0
                    const share = function(w: WordEntry) {
                      const d = themeTotal > 0 ? themeTotal : total
                      return d > 0 ? Math.min(100, w.freq / d * 100) : 0
                    }
                    const shown = showAll ? tWords : tWords.filter(function(w) { return w.synthetic || share(w) >= MIN_PCT })
                    const hidden = tWords.length - shown.length
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 8px', alignItems: 'baseline' }}>
                        {shown.map(function(w) {
                          return <Word key={w.word} {...w} dimmed={false} themeColors={themeColors} maxFreq={maxFreq} totalResponses={total} themeTotal={themeTotal} themeName={t.name} sentiment={wordSentiments[w.word]} colorBy={colorBy} signalScore={wordSignals[w.word]?.avg} maxSignal={maxSignal} sizeBy={sizeBy} onClick={function() { if (onWordClick) onWordClick(w.word, idx, 'keyword') }} />
                        })}
                        {hidden > 0 && (
                          <span style={{ fontSize: 10, color: T.textFaint, marginLeft: 4 }}>
                            +{hidden} below {MIN_PCT}% of this theme hidden
                          </span>
                        )}
                      </div>
                    )
                  })()}
                  {/* Items mentioned within this theme — entity cross-tab */}
                  {(function() {
                    const teList = themeEntities[themeKey(t, idx)] || []
                    if (!teList.length) return null
                    return (
                    <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: '4px 6px', alignItems: 'center' }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 2 }} title="Named items reviewers mention when discussing this theme">Items</span>
                      {teList.slice(0, 8).map(function(e) {
                        const ec = ENTITY_CAT_COLOR[e.category] || ENTITY_NEUTRAL
                        const ecRow = (entities || []).find(function(x) { return x.slug === e.slug })
                        return (
                          <span key={e.slug} title={e.canonical + ' — mentioned in ' + e.count.toLocaleString() + ' "' + t.name + '" comment' + (e.count === 1 ? '' : 's') + (onEntityClick ? ' — click to see these comments' : '')}
                            onClick={onEntityClick ? function() { onEntityClick({ slug: e.slug, canonical: e.canonical, category: e.category, aliases: ecRow ? (ecRow.aliases || []) : [] }) } : undefined}
                            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: ec + '0d', border: '1px solid ' + ec + '30', color: T.textMid, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: onEntityClick ? 'pointer' : 'default' }}>
                            <span style={{ width: 5, height: 5, borderRadius: 3, background: ec, flexShrink: 0 }} />
                            <span style={{ fontWeight: 600 }}>{e.canonical}</span>
                            <span style={{ color: T.textFaint }}>{e.count.toLocaleString()}</span>
                          </span>
                        )
                      })}
                      {teList.length > 8 && (
                        <span style={{ fontSize: 9, color: T.textFaint }}>+{teList.length - 8} more</span>
                      )}
                    </div>
                    )
                  })()}
                  {/* Dimensions mentioned within this theme — taxonomy cross-tab,
                      drillable into the Comments filter (parity with Items). */}
                  {(function() {
                    const dList = (themeDimensions && themeDimensions[t.id]) || []
                    if (!dList.length) return null
                    return (
                    <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: '4px 6px', alignItems: 'center' }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 2 }} title="Dimension sub-buckets reviewers discuss when this theme comes up">Dimensions</span>
                      {dList.slice(0, 8).map(function(d) {
                        const dc = AXIS_COLOR[d.axis as Axis] || ENTITY_NEUTRAL
                        const axisLabel = DIM_AXIS_LABEL[d.axis as Axis] || d.axis
                        return (
                          <span key={d.axis + ':' + d.sub} title={axisLabel + ' › ' + dimSubLabel(d.sub) + ' — in ' + d.count.toLocaleString() + ' "' + t.name + '" comment' + (d.count === 1 ? '' : 's') + (onDimensionClick ? ' — click to see these comments' : '')}
                            onClick={onDimensionClick ? function() { onDimensionClick(d.axis, d.sub) } : undefined}
                            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: dc + '0d', border: '1px solid ' + dc + '30', color: T.textMid, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: onDimensionClick ? 'pointer' : 'default' }}>
                            <span style={{ width: 5, height: 5, borderRadius: 3, background: dc, flexShrink: 0 }} />
                            <span style={{ fontWeight: 600 }}>{dimSubLabel(d.sub)}</span>
                            <span style={{ color: T.textFaint }}>{d.count.toLocaleString()}</span>
                          </span>
                        )
                      })}
                      {dList.length > 8 && (
                        <span style={{ fontSize: 9, color: T.textFaint }}>+{dList.length - 8} more</span>
                      )}
                    </div>
                    )
                  })()}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
