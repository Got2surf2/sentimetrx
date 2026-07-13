// lib/townhallAnalytics.ts
// PulseIQ session detail analytics — extracted VERBATIM (2026-07-04) from
// the legacy /api/townhall/sessions/[id] route's ?analytics=true branch so
// the new-substrate adapter (lib/townHallAdapter.getTownHallAsLegacy) can
// compute the SAME analytics from conversation_turns instead of returning
// an empty shell. Pure: rows in, JSON out — no DB access.
//
// Semantics preserved from the legacy pipeline:
//   - Seed/guide/custom themes count AI-assigned theme_id turns first and
//     supplement with keyword matches not already tagged; organic
//     (auto_detected) themes match keywords first and add tagged turns.
//   - Sentiment is the lexicon score (themeUtils) with stored
//     sentiment_score preferred and on-the-fly backfill for older turns.
//   - Time-series bucketing auto-selects hour/day/week/month from the
//     span (lib/timeBucket) unless the caller pins a bucket.
//   - Shift detection flags themes whose latest bucket is ≥2× their
//     per-bucket average (min 3).

import { buildKwRegex, lexiconScore, classifySentiment } from '@/lib/themeUtils'
import type { TimeBucket } from '@/lib/timeBucket'
import { autoBucket, bucketKey } from '@/lib/timeBucket'
import { bleepText, type ContentSafetyConfig } from '@/lib/contentGuard'

export interface AnalyticsTurn {
  user_message: string | null
  user_message_en: string | null
  theme_id: string | null
  created_at: string
  skipped: boolean
  sentiment?: string | null
  sentiment_score?: number | null
}

// Legacy-shaped theme row (from conversation_turns pipeline / townHallAdapter).
// Only the fields this module reads are declared; the index signature keeps the
// spread (`...t`) faithful to whatever other properties the caller carries.
export interface LegacyThemeRow {
  id: string
  label: string
  keywords?: string[]
  source?: string
  state?: string
  sentiment?: string | null
  [key: string]: unknown
}

export type EnrichedTheme = LegacyThemeRow & {
  sentiment: string
  match_count: number
  mention_count: number
  response_count: number
  percentage: number
  example_quotes: string[]
  quote_matches: { text: string; match: string }[]
  top_keywords: { word: string; count: number }[]
}

export interface SessionAnalytics {
  sentiment_breakdown: { positive: number; negative: number; mixed: number; neutral: number }
  responses_over_time: { bucket: string; count: number }[]
  topic_frequency: { theme_id: string; label: string; series: { bucket: string; count: number }[] }[]
  topic_shifts: { theme_id: string; label: string; latest: number; avg: number }[]
  time_bucket: TimeBucket
  total_responses: number
  sentiment_trend: { turn: number; score: number; cumulative: number }[]
  theme_sentiment_trends: { theme_id: string; label: string; trend: { turn: number; score: number; cumulative: number }[] }[]
}

export function computeSessionAnalytics(opts: {
  turns: AnalyticsTurn[] // chronological (created_at ascending)
  themes: LegacyThemeRow[] // legacy-shaped theme rows
  safetyConfig?: Partial<ContentSafetyConfig>
  bucketParam?: string | null
}): { enrichedThemes: EnrichedTheme[]; analytics: SessionAnalytics } {
  const { turns, themes } = opts
  // Legacy behavior: a bare {} (no content_safety configured) means bleeping
  // is off — bleepText gates on .enabled.
  const safetyConfig = (opts.safetyConfig ?? {}) as ContentSafetyConfig

  const responsesWithText = turns.filter(t => !t.skipped && (t.user_message_en || t.user_message))
  const allResponseTexts = responsesWithText.map(t => bleepText((t.user_message_en || t.user_message || '').trim(), safetyConfig)).filter(Boolean)

  // Build a lookup: theme_id → response texts (from turns tagged with that theme)
  const themeIdTexts: Record<string, string[]> = {}
  for (const t of responsesWithText) {
    if (t.theme_id) {
      if (!themeIdTexts[t.theme_id]) themeIdTexts[t.theme_id] = []
      themeIdTexts[t.theme_id].push((t.user_message_en || t.user_message || '').trim())
    }
  }

  // Per-theme analytics — two strategies:
  // 1) Seed/guide/custom topics: use theme_id assignment (AI-matched during conversation) as primary
  // 2) Organic/auto_detected topics: use keyword matching (detected from text patterns)
  const enrichedThemes: EnrichedTheme[] = (themes || []).map(function(t: LegacyThemeRow) {
    const keywords: string[] = t.keywords || []
    const isOrganic = t.source === 'auto_detected'
    let matchCount = 0, totalPos = 0, totalNeg = 0
    const matchedQuotes: { text: string; match: string }[] = []
    const kwFreq: Record<string, number> = {}
    const seenTexts = new Set<string>()

    if (!isOrganic) {
      // SEED/GUIDE/CUSTOM: primary = AI-assigned theme_id on each turn
      const tagged = themeIdTexts[t.id] || []
      matchCount = tagged.length
      for (const text of tagged) {
        const score = lexiconScore(text)
        totalPos += score.pos
        totalNeg += score.neg
        const trimmed = text.slice(0, 300)
        if (matchedQuotes.length < 20 && !seenTexts.has(trimmed)) {
          matchedQuotes.push({ text: trimmed, match: 'AI-assigned' })
          seenTexts.add(trimmed)
        }
        // Still track keyword frequency for display
        const lower = text.toLowerCase()
        for (let ki = 0; ki < keywords.length; ki++) {
          try {
            if (buildKwRegex(keywords[ki]).test(lower)) kwFreq[keywords[ki]] = (kwFreq[keywords[ki]] || 0) + 1
          } catch {}
        }
      }
      // Supplement: keyword matches NOT already tagged (catches responses about this topic assigned to another)
      if (keywords.length > 0) {
        const regexes = keywords.slice(0, 15).map(function(kw: string) {
          try { return buildKwRegex(kw) } catch { return null }
        }).filter(Boolean) as RegExp[]
        for (const text of allResponseTexts) {
          const lower = text.toLowerCase()
          const trimmed = text.slice(0, 300)
          if (!seenTexts.has(trimmed) && regexes.some(function(re) { return re.test(lower) })) {
            // Find which keyword matched
            let matchedKw = ''
            for (let mki = 0; mki < keywords.length; mki++) {
              try { if (buildKwRegex(keywords[mki]).test(lower)) { matchedKw = keywords[mki]; break } } catch {}
            }
            if (matchedQuotes.length < 20) {
              matchedQuotes.push({ text: trimmed, match: 'keyword: ' + matchedKw })
              seenTexts.add(trimmed)
            }
          }
        }
      }
    } else {
      // ORGANIC: keyword matching is the primary source
      const regexes = keywords.slice(0, 15).map(function(kw: string) {
        try { return buildKwRegex(kw) } catch { return null }
      }).filter(Boolean) as RegExp[]

      if (regexes.length > 0) {
        for (const text of allResponseTexts) {
          const lower = text.toLowerCase()
          if (regexes.some(function(re) { return re.test(lower) })) {
            matchCount++
            const score = lexiconScore(text)
            totalPos += score.pos
            totalNeg += score.neg
            const trimmed = text.slice(0, 300)
            // Find which keyword matched
            let matchedKw = ''
            for (let oki = 0; oki < keywords.length; oki++) {
              try { if (buildKwRegex(keywords[oki]).test(lower)) { matchedKw = keywords[oki]; kwFreq[keywords[oki]] = (kwFreq[keywords[oki]] || 0) + 1; break } } catch {}
            }
            // Count remaining keyword hits
            for (let oki2 = 0; oki2 < keywords.length; oki2++) {
              if (keywords[oki2] === matchedKw) continue
              try { if (buildKwRegex(keywords[oki2]).test(lower)) kwFreq[keywords[oki2]] = (kwFreq[keywords[oki2]] || 0) + 1 } catch {}
            }
            if (matchedQuotes.length < 20 && !seenTexts.has(trimmed)) {
              matchedQuotes.push({ text: trimmed, match: 'keyword: ' + matchedKw })
              seenTexts.add(trimmed)
            }
          }
        }
      }
      // Also include theme_id-tagged turns
      const taggedTexts = themeIdTexts[t.id] || []
      for (const text of taggedTexts) {
        const trimmed = text.slice(0, 300)
        if (!seenTexts.has(trimmed)) {
          const score = lexiconScore(text)
          totalPos += score.pos
          totalNeg += score.neg
          matchCount++
          if (matchedQuotes.length < 20) { matchedQuotes.push({ text: trimmed, match: 'AI-assigned' }); seenTexts.add(trimmed) }
        }
      }
    }

    const sentiment = matchCount > 0 ? classifySentiment(totalPos, totalNeg) : (t.sentiment || 'neutral')
    const percentage = allResponseTexts.length > 0 ? Math.round(matchCount / allResponseTexts.length * 100) : 0
    const topKeywords = Object.entries(kwFreq).sort(function(a, b) { return b[1] - a[1] }).slice(0, 10).map(function(e) { return { word: e[0], count: e[1] } })

    return {
      ...t,
      sentiment,
      match_count: matchCount,
      mention_count: matchCount,
      response_count: isOrganic ? matchCount : (themeIdTexts[t.id]?.length || 0),
      percentage,
      example_quotes: matchedQuotes.map(function(q) { return q.text }),
      quote_matches: matchedQuotes,
      top_keywords: topKeywords,
    }
  })

  // Overall sentiment breakdown
  let overallPos = 0, overallNeg = 0, overallNeutral = 0, overallMixed = 0
  for (const text of allResponseTexts) {
    const score = lexiconScore(text)
    const sent = classifySentiment(score.pos, score.neg)
    if (sent === 'positive') overallPos++
    else if (sent === 'negative') overallNeg++
    else if (sent === 'mixed') overallMixed++
    else overallNeutral++
  }

  // Responses over time (smart bucketing)
  const bucketParam = opts.bucketParam as TimeBucket | null | undefined
  const timestamps = responsesWithText.map(t => new Date(t.created_at))
  const chosenBucket: TimeBucket = bucketParam && ['hour', 'day', 'week', 'month'].includes(bucketParam)
    ? bucketParam
    : timestamps.length >= 2
      ? autoBucket(timestamps[0], timestamps[timestamps.length - 1])
      : 'hour'
  const timeBuckets: Record<string, number> = {}
  for (const t of responsesWithText) {
    const key = bucketKey(t.created_at, chosenBucket)
    timeBuckets[key] = (timeBuckets[key] || 0) + 1
  }
  const responsesOverTime = Object.entries(timeBuckets).sort().map(function(e) { return { bucket: e[0], count: e[1] } })

  // Per-theme frequency over time (keyword-matched, same buckets)
  const activeThemeList = (themes || []).filter((t: LegacyThemeRow) => t.state !== 'dismissed')
  const themeRegexes: { id: string; label: string; regexes: RegExp[] }[] = activeThemeList.map(function(t: LegacyThemeRow) {
    const kws: string[] = t.keywords || []
    return {
      id: t.id,
      label: t.label,
      regexes: kws.slice(0, 15).map(function(kw: string) { try { return buildKwRegex(kw) } catch { return null } }).filter(Boolean) as RegExp[],
    }
  })

  // Build sorted bucket keys
  const sortedBuckets = Object.keys(timeBuckets).sort()

  // For each response, check which themes match, bucket by time
  const themeTimeSeries: Record<string, Record<string, number>> = {}
  for (const tr of themeRegexes) themeTimeSeries[tr.id] = {}

  for (const t of responsesWithText) {
    const text = (t.user_message_en || t.user_message || '').toLowerCase()
    const bk = bucketKey(t.created_at, chosenBucket)
    for (const tr of themeRegexes) {
      if (tr.regexes.length > 0) {
        if (tr.regexes.some(function(re) { return re.test(text) })) {
          themeTimeSeries[tr.id][bk] = (themeTimeSeries[tr.id][bk] || 0) + 1
        }
      } else if (t.theme_id === tr.id) {
        // Fallback: use turn-level theme tagging for themes without keywords
        themeTimeSeries[tr.id][bk] = (themeTimeSeries[tr.id][bk] || 0) + 1
      }
    }
  }

  // Format: array of { theme_id, label, series: [{bucket, count}] }
  const topicFrequency = themeRegexes.map(function(tr) {
    return {
      theme_id: tr.id,
      label: tr.label,
      series: sortedBuckets.map(function(bk) { return { bucket: bk, count: themeTimeSeries[tr.id][bk] || 0 } }),
    }
  })

  // Shift detection: flag themes where the latest bucket is ≥2x the per-bucket average
  const shifts: { theme_id: string; label: string; latest: number; avg: number }[] = []
  for (const tf of topicFrequency) {
    if (tf.series.length < 3) continue
    const counts = tf.series.map(function(s) { return s.count })
    const avg = counts.reduce(function(a, b) { return a + b }, 0) / counts.length
    const latest = counts[counts.length - 1]
    if (avg > 0 && latest >= avg * 2 && latest >= 3) {
      shifts.push({ theme_id: tf.theme_id, label: tf.label, latest, avg: Math.round(avg * 10) / 10 })
    }
  }

  // ── Sentiment trend: cumulative moving average per theme + overall ──
  // Stored sentiment_score preferred; turns predating the scoring migration
  // are backfilled on the fly with the lexicon score.
  const sentimentTurns = turns.filter(function(t) { return !t.skipped && (t.user_message_en || t.user_message) })

  const scoreOf = (t: AnalyticsTurn): number => {
    let score = t.sentiment_score
    if (score === null || score === undefined) {
      const txt = (t.user_message_en || t.user_message || '').trim()
      if (txt) {
        const ls = lexiconScore(txt)
        score = Math.round((ls.pos - ls.neg) / Math.max(1, ls.pos + ls.neg + 1) * 100) / 100
      } else {
        score = 0
      }
    }
    return score
  }

  // Overall sentiment trend (all turns, chronological)
  const overallTrend: { turn: number; score: number; cumulative: number }[] = []
  let cumSum = 0, cumCount = 0
  for (let si = 0; si < sentimentTurns.length; si++) {
    const score = scoreOf(sentimentTurns[si])
    cumSum += score
    cumCount++
    overallTrend.push({ turn: si + 1, score, cumulative: Math.round((cumSum / cumCount) * 100) / 100 })
  }

  // Per-theme sentiment trend
  const themeSentimentTrends: { theme_id: string; label: string; trend: { turn: number; score: number; cumulative: number }[] }[] = []
  for (const theme of activeThemeList) {
    const themeTurns = sentimentTurns.filter(function(t) { return t.theme_id === theme.id })
    if (themeTurns.length < 2) continue

    let tCumSum = 0, tCumCount = 0
    const trend: { turn: number; score: number; cumulative: number }[] = []
    for (let tj = 0; tj < themeTurns.length; tj++) {
      const tScore = scoreOf(themeTurns[tj])
      tCumSum += tScore
      tCumCount++
      trend.push({ turn: tj + 1, score: tScore, cumulative: Math.round((tCumSum / tCumCount) * 100) / 100 })
    }
    themeSentimentTrends.push({ theme_id: theme.id, label: theme.label, trend })
  }

  return {
    enrichedThemes,
    analytics: {
      sentiment_breakdown: { positive: overallPos, negative: overallNeg, mixed: overallMixed, neutral: overallNeutral },
      responses_over_time: responsesOverTime,
      topic_frequency: topicFrequency,
      topic_shifts: shifts,
      time_bucket: chosenBucket,
      total_responses: allResponseTexts.length,
      sentiment_trend: overallTrend,
      theme_sentiment_trends: themeSentimentTrends,
    },
  }
}
