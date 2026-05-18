'use client'
// components/analyze/textmine/EntityCloud.tsx
// Entity cloud — mirror of WordCloud for the scope's entity catalog.
// Words sized by mention count, colored by category or by sentiment.
// Click an entity to drill into the rows mentioning it (same flow as
// EntitiesCard pill click — onEntityClick handler routes to handleDrillEntity
// in TextMineModule).
//
// Sentiment scan: per-row → clause split (on but/however/although/yet/though/
// while/whereas/comma) → for each clause, detect every entity that appears
// (canonical, alias, or plural variant from lib/entityVariants.ts), then count
// opinion-word hits in the clause's tokens and credit them to every entity in
// that clause. The clause boundary is the precision tool — mixed-sentiment
// sentences like "loved the steak but hated the wait" split into one clause
// per entity, so "steak" sees only "loved" and "wait" only "hated".
//
// Why credit the whole clause rather than only the proximity window
// (WordCloud's pattern): entities are usually the *subject* of the clause
// they appear in. Restaurant reviews talk about *this dish* in *that clause*
// — opinion words anywhere in the clause are about that entity, even when
// they're 5+ tokens away. Proximity windows lose recall here without much
// precision gain (the clause split already handles most mix cases).

import { useState, useMemo, useTransition } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'
import { T } from '@/lib/analyzeTheme'
import { expandEntityTerms } from '@/lib/entityVariants'

interface EntityEntry {
  slug:      string
  canonical: string
  category:  string
  aliases?:  string[]
  mentions:  number
}

interface Props {
  entities:      EntityEntry[]
  parsedData:    Record<string, unknown>[]
  fields:        string[]
  onEntityClick?: (entity: EntityEntry) => void
  scopeType?:    'dataset' | 'collection' | null
}

const CATEGORY_COLOR: Record<string, { border: string; bg: string; text: string; light: string }> = {
  food:   { border: '#EA580C', bg: '#fff4ef', text: '#9a3412', light: '#ffedd5' },
  drink:  { border: '#7C3AED', bg: '#f5f3ff', text: '#5b21b6', light: '#ede9fe' },
  place:  { border: '#0F7173', bg: '#ecfeff', text: '#155e75', light: '#cffafe' },
  person: { border: '#1E40AF', bg: '#eff6ff', text: '#1e3a8a', light: '#dbeafe' },
  brand:  { border: '#B45309', bg: '#fffbeb', text: '#92400e', light: '#fef3c7' },
  other:  { border: '#8FA3AE', bg: '#f3f4f6', text: '#4b5563', light: '#e5e7eb' },
}

// Opinion lexicon — restaurant-leaning, same set the theme WordCloud uses for
// per-word sentiment. Kept inline so a single render pass does not pay for
// any extra module imports / map allocations on tight token loops.
const POS_WORDS = new Set(['good','great','excellent','amazing','awesome','fantastic','wonderful','perfect','best','delicious','tasty','fresh','friendly','nice','lovely','clean','quick','fast','warm','crispy','tender','flavorful','juicy','rich','creamy','attentive','helpful','polite','outstanding','superb','incredible','comfortable','cozy','pleasant','enjoyable','reasonable','generous','authentic','consistent','exceptional','phenomenal','satisfying','refreshing','favorite','love','loved','recommend'])
const NEG_WORDS = new Set(['bad','terrible','horrible','awful','worst','poor','slow','cold','bland','dry','stale','rude','dirty','expensive','overpriced','small','loud','noisy','crowded','long','soggy','burnt','undercooked','overcooked','raw','greasy','salty','bitter','tasteless','mediocre','disappointing','disgusting','uncomfortable','unfriendly','unprofessional','filthy','gross','lukewarm','watery','tough','chewy','rubbery','hard','old','late','wrong','missing','broken','ignored','waited','annoyed','frustrated','underwhelming','overrated'])

function escapeRE(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getRowText(row: Record<string, unknown>, fields: string[]): string {
  if (!fields.length) return ''
  const parts: string[] = []
  for (const f of fields) {
    const v = row[f]
    if (typeof v === 'string' && v.trim()) parts.push(v.trim())
  }
  return parts.join(' · ')
}

interface Sentiment { positive: number; negative: number; neutral: number }

function Entity({ entity, freq, maxFreq, sentiment, colorBy, onClick, dimmed }: {
  entity:   EntityEntry
  freq:     number
  maxFreq:  number
  sentiment?: Sentiment
  colorBy:  'category' | 'sentiment'
  onClick?: () => void
  dimmed:   boolean
}) {
  const [hov, setHov] = useState(false)
  const pal = CATEGORY_COLOR[entity.category] || CATEGORY_COLOR.other
  const size = 12 + Math.round((freq / Math.max(maxFreq, 1)) * 22)

  // Sentiment ramp — mirrors WordCloud's thresholds for visual parity.
  let sentColor = T.textMute
  let sentBg = 'transparent'
  if (colorBy === 'sentiment' && sentiment && !dimmed) {
    const tot = sentiment.positive + sentiment.negative + sentiment.neutral
    if (tot > 0) {
      const posPct = sentiment.positive / tot
      const negPct = sentiment.negative / tot
      if (posPct > 0.6)      { sentColor = '#059669'; sentBg = hov ? '#ecfdf5' : 'transparent' }
      else if (negPct > 0.6) { sentColor = '#dc2626'; sentBg = hov ? '#fef2f2' : 'transparent' }
      else if (posPct > 0.4) { sentColor = '#16a34a'; sentBg = hov ? '#f0fdf4' : 'transparent' }
      else if (negPct > 0.4) { sentColor = '#ef4444'; sentBg = hov ? '#fef2f2' : 'transparent' }
      else                   { sentColor = '#6b7280' }
    }
  }

  const wordColor = colorBy === 'sentiment'
    ? (dimmed ? '#d1d5db' : sentColor)
    : (dimmed ? '#d1d5db' : (hov ? pal.border : pal.text))
  const wordBg = colorBy === 'sentiment'
    ? sentBg
    : (hov ? pal.light : 'transparent')

  const sentLabel = sentiment
    ? ' · +' + sentiment.positive + ' / -' + sentiment.negative
    : ''

  return (
    <span
      onClick={onClick}
      title={entity.canonical + ' · ' + entity.category + ' · ' + freq.toLocaleString() + ' rows mention this entity' + sentLabel}
      style={{
        fontSize: size, fontWeight: freq > maxFreq * 0.5 ? 700 : 500,
        color: wordColor, background: wordBg,
        padding: '2px 6px', borderRadius: 5, cursor: onClick ? 'pointer' : 'default',
        transition: 'all .15s', display: 'inline-flex', alignItems: 'baseline', gap: 3,
        opacity: dimmed ? 0.3 : 1,
        border: colorBy === 'category' && hov ? '1px solid ' + pal.border + '60' : '1px solid transparent',
      }}
      onMouseEnter={function() { setHov(true) }}
      onMouseLeave={function() { setHov(false) }}
    >
      {entity.canonical}
      <span style={{ fontSize: Math.max(9, size - 6), fontWeight: 600, opacity: 0.6 }}>
        {freq.toLocaleString()}
      </span>
    </span>
  )
}

export default function EntityCloud({ entities, parsedData, fields, onEntityClick, scopeType }: Props) {
  const [colorBy, setColorBy] = useState<'category' | 'sentiment'>('category')
  const [showAll, setShowAll] = useState(false)
  const [activeCategories, setActiveCategories] = useState<Set<string> | null>(null)
  const [isPending, startTransition] = useTransition()

  // ── Cloud sizing uses the SAME scope-wide mention counts the EntitiesCard
  //    pill list shows (entity.mentions, computed live by count_entity_terms
  //    in the API). Earlier versions of this file did a client-side regex
  //    scan over parsedData to derive counts, which produced numbers that
  //    diverged from the EntitiesCard counts (different denominator: scope
  //    vs filtered view; different matcher: SQL FTS with stemming vs naive
  //    word-boundary regex). Two views showing different numbers for the
  //    same entity is a credibility killer; one source of truth wins.
  //
  //    Sentiment still scans parsedData below — we have no other source of
  //    text on the client, and sentiment is intrinsically filter-aware.
  const maxFreq = useMemo(function() {
    let mx = 1
    for (const e of entities) if (e.mentions > mx) mx = e.mentions
    return mx
  }, [entities])

  // ── Sentiment scan: clause-aware credit to every entity in the clause ──
  const entitySentiments = useMemo(function() {
    const map: Record<string, Sentiment> = {}
    for (const e of entities) map[e.slug] = { positive: 0, negative: 0, neutral: 0 }
    if (!entities.length || !fields.length || !parsedData.length) return map

    const termToSlugs: Record<string, string[]> = {}
    for (const e of entities) {
      const terms = expandEntityTerms([e.canonical].concat(e.aliases || []))
      for (const t of terms) {
        const key = t.toLowerCase()
        if (!termToSlugs[key]) termToSlugs[key] = []
        if (!termToSlugs[key].includes(e.slug)) termToSlugs[key].push(e.slug)
      }
    }
    const allTerms = Object.keys(termToSlugs).sort(function(a, b) { return b.length - a.length })
    if (!allTerms.length) return map
    const re = new RegExp('\\b(' + allTerms.map(escapeRE).join('|') + ')\\b', 'gi')

    for (const row of parsedData) {
      const text = getRowText(row, fields).toLowerCase()
      if (!text) continue
      const clauses = text.split(/\b(?:but|however|although|yet|though|while|whereas)\b|[,]/i)
      for (const clause of clauses) {
        re.lastIndex = 0
        const slugsInClause = new Set<string>()
        let m: RegExpExecArray | null
        while ((m = re.exec(clause)) !== null) {
          const slugs = termToSlugs[m[0].toLowerCase()] || []
          for (const s of slugs) slugsInClause.add(s)
        }
        if (slugsInClause.size === 0) continue

        let pos = 0, neg = 0
        const tokens = clause.split(/\W+/)
        for (const tok of tokens) {
          if (!tok) continue
          if (POS_WORDS.has(tok)) pos += 1
          else if (NEG_WORDS.has(tok)) neg += 1
        }
        if (pos === 0 && neg === 0) {
          slugsInClause.forEach(function(s) { map[s].neutral += 1 })
        } else {
          slugsInClause.forEach(function(s) {
            map[s].positive += pos
            map[s].negative += neg
          })
        }
      }
    }
    return map
  }, [entities, parsedData, fields])

  // No data path — silent.
  if (!entities.length || !fields.length) return null

  // Absolute-mention threshold matching the EntitiesCard pill list (MIN_MENTIONS=10
  // there). Show all toggle reveals everything. Sizes + counts come from
  // `entity.mentions` (scope-wide) so the cloud's numbers match the pill
  // list's exactly.
  const MIN_MENTIONS = 10
  const withFreq = entities
    .map(function(e) { return { entity: e, freq: e.mentions } })
    .filter(function(x) { return x.freq > 0 })
  let visible: Array<{ entity: EntityEntry; freq: number }> = withFreq
  if (!showAll) {
    const filtered = withFreq.filter(function(x) { return x.freq >= MIN_MENTIONS })
    visible = filtered.length > 0 ? filtered : withFreq.slice(0, 12)
  }

  // Category-chip filter — same dimming pattern WordCloud uses for themes.
  const presentCategories = Array.from(new Set(visible.map(function(x) { return x.entity.category })))
    .sort(function(a, b) { return a.localeCompare(b) })
  const categoryActive = function(cat: string): boolean {
    if (!activeCategories) return true
    return activeCategories.has(cat)
  }
  function toggleCategory(cat: string) {
    const all = new Set(presentCategories)
    const cur = activeCategories || all
    const n = new Set(cur)
    if (n.has(cat)) {
      if (n.size === 1) { setActiveCategories(null); return }
      n.delete(cat)
    } else {
      n.add(cat)
    }
    setActiveCategories(n.size === all.size ? null : n)
  }

  if (!visible.length) return null

  const sortedVisible = [...visible].sort(function(a, b) { return b.freq - a.freq })
  const hiddenBelowThreshold = withFreq.length - visible.length

  return (
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '18px 20px', position: 'relative' as const }}>
      <div style={{
        position: 'sticky' as const, top: 0, zIndex: 5,
        background: T.bgCard,
        margin: '-18px -20px 16px',
        padding: '14px 20px',
        borderBottom: '1px solid ' + T.borderMid,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap' as const, gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textMid }}>Entity Clouds</span>
          {scopeType === 'collection' && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 20, background: T.bg, color: T.textMute, border: '1px solid ' + T.border }} title="Counts are scope-wide — match the Entities pill list and live across every dataset in this brand-collection.">
              brand-wide
            </span>
          )}
          {colorBy === 'sentiment' && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 20, background: '#ecfdf5', color: '#059669', border: '1px solid #05966940' }} title="Sentiment colors are computed from the rows currently loaded into TextMine (respects active filters). Sizes are always scope-wide.">
              sentiment from visible rows
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll}
              onChange={function() { startTransition(function() { setShowAll(function(v) { return !v }) }) }}
              style={{ accentColor: T.accent }} />
            Show all
          </label>
          {!showAll && hiddenBelowThreshold > 0 && (
            <span style={{ fontSize: 10, color: T.textFaint }}>
              ({hiddenBelowThreshold} below {MIN_MENTIONS} mentions hidden)
            </span>
          )}
          <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
            {(['category', 'sentiment'] as const).map(function(mode) {
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
                  {mode === 'category' ? 'Category' : 'Sentiment'}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {isPending && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 4,
          background: 'rgba(255,255,255,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 12,
        }}>
          <LottieLoader size={64} />
        </div>
      )}

      {/* Category chip filters — color-coded, click to dim others */}
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 14 }}>
        {presentCategories.map(function(cat) {
          const pal = CATEGORY_COLOR[cat] || CATEGORY_COLOR.other
          const isOn = categoryActive(cat)
          const catCount = visible.filter(function(x) { return x.entity.category === cat }).length
          return (
            <button
              key={cat}
              onClick={function() { toggleCategory(cat) }}
              style={{
                display: 'inline-flex' as const, alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: isOn ? 700 : 500,
                padding: '4px 10px', borderRadius: 10, cursor: 'pointer',
                background: isOn ? pal.bg : '#f3f4f6',
                color: isOn ? pal.text : '#9ca3af',
                border: '1px solid ' + (isOn ? pal.border + '80' : '#e5e7eb'),
                opacity: isOn ? 1 : 0.6,
                fontFamily: 'inherit',
                textTransform: 'capitalize' as const,
              }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: isOn ? pal.border : '#d1d5db', flexShrink: 0, display: 'inline-block' }} />
              {cat}
              <span style={{ fontSize: 10, opacity: isOn ? 0.75 : 0.5, fontWeight: 600 }}>{catCount}</span>
            </button>
          )
        })}
      </div>

      {/* The cloud */}
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '10px 12px', alignItems: 'baseline', lineHeight: 1.7 }}>
        {sortedVisible.map(function(x) {
          const dimmed = !categoryActive(x.entity.category)
          return (
            <Entity
              key={x.entity.slug}
              entity={x.entity}
              freq={x.freq}
              maxFreq={maxFreq}
              sentiment={entitySentiments[x.entity.slug]}
              colorBy={colorBy}
              dimmed={dimmed}
              onClick={onEntityClick ? function() { onEntityClick(x.entity) } : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}
