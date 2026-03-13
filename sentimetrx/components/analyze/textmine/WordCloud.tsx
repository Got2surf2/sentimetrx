'use client'
// components/analyze/textmine/WordCloud.tsx
// Renders a word cloud in two modes: frequency (interactive toggle) and grouped by theme.
// Words sized by corpus frequency. Theme-keyword words coloured by their theme.

import { useState } from 'react'
import { Theme, THEME_PALETTE, getRowText } from '@/lib/themeUtils'

const T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
}

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
}

function Word({ word, freq, themeIdx, dimmed, themeColors, maxFreq }: {
  word: string; freq: number; themeIdx: number; dimmed: boolean
  themeColors: Record<number, typeof THEME_PALETTE[0]>; maxFreq: number
}) {
  const [hov, setHov] = useState(false)
  const pal = (!dimmed && themeIdx >= 0) ? (themeColors[themeIdx] || THEME_PALETTE[0]) : null
  const size = 12 + Math.round((freq / Math.max(maxFreq, 1)) * 20)
  return (
    <span
      style={{
        fontSize: size, fontWeight: freq > maxFreq * 0.5 ? 700 : 500,
        color: pal ? (hov ? pal.border : pal.text) : (dimmed ? '#d1d5db' : T.textMute),
        background: pal && hov ? pal.light : 'transparent',
        padding: '1px 4px', borderRadius: 4, cursor: 'default',
        transition: 'all .15s', display: 'inline-block',
        opacity: dimmed ? 0.3 : 1,
      }}
      onMouseEnter={function() { setHov(true) }}
      onMouseLeave={function() { setHov(false) }}
    >
      {word}
    </span>
  )
}

export default function WordCloud({ themes, themeColors, parsedData, activeField, activeFields, onWordClick }: Props) {
  const [cloudMode, setCloudMode] = useState<'frequency' | 'grouped'>('grouped')
  const [activeThemes, setActiveThemes] = useState<Set<number> | null>(null)
  const [hoveredTheme, setHoveredTheme] = useState<number | null>(null)

  const fields = activeFields && activeFields.length ? activeFields : (activeField ? [activeField] : [])
  if (!themes || !themes.length || !fields.length) return null

  const allText = parsedData.map(function(r) { return getRowText(r, fields).toLowerCase() }).join(' ')

  // Build word-to-theme map from keywords
  const wordThemeMap: Record<string, { themeIdx: number; freq: number }> = {}
  themes.forEach(function(t, idx) {
    ;(t.keywords || []).forEach(function(kw) {
      if (!wordThemeMap[kw.toLowerCase()]) wordThemeMap[kw.toLowerCase()] = { themeIdx: idx, freq: 0 }
    })
  })

  // Count keyword frequencies in corpus
  Object.keys(wordThemeMap).forEach(function(w) {
    const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi')
    wordThemeMap[w].freq = (allText.match(re) || []).length
  })

  // Build general word frequency for non-keyword words
  const rawWords = allText.split(/\W+/).filter(function(w) { return w.length > 3 && !STOP_WORDS.has(w) })
  const freqMap: Record<string, number> = {}
  rawWords.forEach(function(w) { freqMap[w] = (freqMap[w] || 0) + 1 })

  const allWords: WordEntry[] = Object.entries(wordThemeMap)
    .filter(function([, v]) { return v.freq > 0 })
    .map(function([w, v]) { return { word: w, freq: v.freq, themeIdx: v.themeIdx } })

  const covered = new Set(Object.keys(wordThemeMap))
  Object.entries(freqMap).sort(function(a, b) { return b[1] - a[1] }).slice(0, 20).forEach(function([w, f]) {
    if (!covered.has(w) && f > 0) allWords.push({ word: w, freq: f, themeIdx: -1 })
  })

  if (!allWords.length) return null

  const maxFreq = Math.max(...allWords.map(function(w) { return w.freq }), 1)

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

  return (
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '18px 20px' }}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.textMid }}>Theme Clouds</span>
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

      {/* Frequency mode */}
      {cloudMode === 'frequency' && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {themes.map(function(t, idx) {
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
            {[...allWords].sort(function(a, b) { return b.freq - a.freq }).map(function(w) {
              let dimmed = false
              if (hoveredTheme !== null) dimmed = w.themeIdx !== hoveredTheme
              else if (activeThemes !== null) dimmed = w.themeIdx >= 0 && !activeThemes.has(w.themeIdx)
              return <Word key={w.word} {...w} dimmed={dimmed} themeColors={themeColors} maxFreq={maxFreq} />
            })}
          </div>
        </div>
      )}

      {/* Grouped mode */}
      {cloudMode === 'grouped' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[...themes].sort(function(a, b) { return b.count - a.count }).map(function(t) {
            const idx = themes.indexOf(t)
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
                    <span style={{ fontSize: 11, fontWeight: 700, color: pal.text }}>{t.name}</span>
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
                    {tWords.map(function(w) {
                      return <Word key={w.word} {...w} dimmed={false} themeColors={themeColors} maxFreq={maxFreq} />
                    })}
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
