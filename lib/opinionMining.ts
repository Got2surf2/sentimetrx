// lib/opinionMining.ts
// Client-side opinion mining: extract aspect → opinion pairs from text data
// Used when a user clicks a word in the word cloud to see associated opinions

import {
  POSITIVE_WORDS as POSITIVE_OPINIONS,
  NEGATIVE_WORDS as NEGATIVE_OPINIONS,
  NEUTRAL_WORDS as NEUTRAL_OPINIONS,
  NEGATORS,
} from './sentimentLexicon'

// Conjunction words — skip when scanning for opinion targets
const CONJUNCTIONS = new Set(['and', 'or', 'nor', 'also', 'plus', 'with'])

// Look back this many tokens for a negator before the target/opinion word.
// Same window as themeUtils.lexiconScore and contentGuard's AFINN scorer.
const NEGATION_WINDOW = 3

function flipSentiment(s: 'positive' | 'negative' | 'neutral'): 'positive' | 'negative' | 'neutral' {
  if (s === 'positive') return 'negative'
  if (s === 'negative') return 'positive'
  return s
}

function isNegatedAt(words: string[], idx: number): boolean {
  const start = Math.max(0, idx - NEGATION_WINDOW)
  for (let k = start; k < idx; k++) {
    if (NEGATORS.has(words[k])) return true
  }
  return false
}

// Extra stop words to exclude when looking for nouns near an adjective
const EXTRA_STOPS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by','from',
  'is','was','are','were','be','been','has','have','had','do','did','does','i','we',
  'you','they','it','this','that','my','our','your','their','its','not','no','so','as',
  'if','can','will','just','get','got','more','very','also','out','up','about','what',
  'how','all','one','new','when','would','could','should','than','then','even','still',
  'really','there','here','ever','only','other','each','both','such','same','been',
  'some','many','much','few','several','most','any','another','every','lots','lot',
  'thing','things','way','ways','time','times','back','make','made','like','went',
  'come','came','came','take','took','know','knew','said','tell','told','going',
  'want','wanted','try','tried','need','needed','see','saw','look','looked',
  'think','thought','feel','felt','seem','seemed','let','put','keep','kept',
  'give','gave','use','used','find','found','say','show','work','call','called',
])

function isOpinionWord(word: string): boolean {
  return POSITIVE_OPINIONS.has(word) || NEGATIVE_OPINIONS.has(word) || NEUTRAL_OPINIONS.has(word)
}

function isSubjectWord(word: string): boolean {
  // A subject/noun candidate: not a stop word, not an opinion word, 3+ chars
  return word.length >= 3 && !EXTRA_STOPS.has(word) && !isOpinionWord(word)
}

export interface OpinionPair {
  opinion: string
  count: number
  sentiment: 'positive' | 'negative' | 'neutral'
  samples: string[]  // up to 3 example sentences
}

export interface OpinionResult {
  aspect: string
  totalMentions: number
  opinions: OpinionPair[]
  sentimentSummary: { positive: number; negative: number; neutral: number }
  mode: 'opinions' | 'nouns'  // opinions = target is a noun, nouns = target is an adjective
}

/**
 * Extract opinions associated with a target word from text data.
 * Scans a window of words around each occurrence of the target.
 */
export function extractOpinions(
  rows: Record<string, unknown>[],
  fields: string | string[],
  targetWord: string,
  windowSize: number = 2,
): OpinionResult {
  const fieldArr = Array.isArray(fields) ? fields : [fields]
  const target = targetWord.toLowerCase()
  // If target is an adjective/opinion word, look for nouns it modifies instead
  const targetIsOpinion = isOpinionWord(target)
  // Per-noun pos/neg/neutral counters so the displayed sentiment reflects the
  // majority across all occurrences (not just the first match).
  const opinionCounts: Record<string, {
    count: number
    pos: number
    neg: number
    neu: number
    samples: string[]
  }> = {}
  let totalMentions = 0

  for (const row of rows) {
    for (const field of fieldArr) {
      const text = String(row[field] || '').trim()
      if (!text) continue
      const lower = text.toLowerCase()
      if (!lower.includes(target)) continue
      totalMentions++

      // Split into sentences, then into clauses (split on but/however/although/yet/though/comma)
      const sentences = text.split(/[.!?]+/).filter(function(s) { return s.toLowerCase().includes(target) })

      for (const sentence of sentences) {
        // Split into clauses on contrast words and commas to avoid cross-clause contamination
        const clauses = sentence.split(/\b(?:but|however|although|yet|though|while|whereas)\b|,/i)
        const targetClauses = clauses.filter(function(c) { return c.toLowerCase().includes(target) })

        for (const clause of targetClauses) {
          const words = clause.toLowerCase().replace(/[^a-z\s'-]/g, '').split(/\s+/)
          for (let i = 0; i < words.length; i++) {
            if (words[i] !== target) continue
            const start = Math.max(0, i - windowSize)
            const end = Math.min(words.length, i + windowSize + 1)
            for (let j = start; j < end; j++) {
              if (j === i) continue
              const w = words[j]
              if (w.length < 3) continue
              // Skip if there's a conjunction between target and opinion word
              var blocked = false
              var lo = Math.min(i, j) + 1; var hi = Math.max(i, j)
              for (var k = lo; k < hi; k++) {
                if (CONJUNCTIONS.has(words[k])) { blocked = true; break }
              }
              if (blocked) continue
              // Bump the appropriate sentiment counter for this noun. Sentiment
              // is determined per-occurrence so e.g. "never too loud" (positive)
              // doesn't lock "too" to negative just because it was first.
              var occSent: 'positive' | 'negative' | 'neutral'
              if (targetIsOpinion) {
                if (!isSubjectWord(w)) continue
                const baseTargetSent = getSentiment(target) || 'neutral'
                occSent = isNegatedAt(words, i) ? flipSentiment(baseTargetSent) : baseTargetSent
              } else {
                const baseOpinionSent = getSentiment(w)
                if (!baseOpinionSent) continue
                occSent = isNegatedAt(words, j) ? flipSentiment(baseOpinionSent) : baseOpinionSent
              }
              if (!opinionCounts[w]) {
                opinionCounts[w] = { count: 0, pos: 0, neg: 0, neu: 0, samples: [] }
              }
              opinionCounts[w].count++
              if (occSent === 'positive') opinionCounts[w].pos++
              else if (occSent === 'negative') opinionCounts[w].neg++
              else opinionCounts[w].neu++
              if (opinionCounts[w].samples.length < 3) {
                const trimmed = sentence.trim().slice(0, 120)
                if (!opinionCounts[w].samples.includes(trimmed)) {
                  opinionCounts[w].samples.push(trimmed)
                }
              }
            }
          }
        }
      }
    }
  }

  // Sort by frequency. Each noun's displayed sentiment is the majority among
  // its per-occurrence counts (positive / negative / neutral); ties resolve
  // to neutral so we don't claim a polarity we don't have.
  const opinions: OpinionPair[] = Object.entries(opinionCounts)
    .map(function(e) {
      const c = e[1]
      let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral'
      if (c.pos > c.neg && c.pos > c.neu) sentiment = 'positive'
      else if (c.neg > c.pos && c.neg > c.neu) sentiment = 'negative'
      return { opinion: e[0], count: c.count, sentiment, samples: c.samples }
    })
    .sort(function(a, b) { return b.count - a.count })
    .slice(0, 30)

  // Sentiment summary uses the per-occurrence counts (not the per-noun majority)
  // so the modal's overall % positive/negative reflects the *true* mix across
  // every individual mention, not how many noun categories tip each way.
  const sentimentSummary = { positive: 0, negative: 0, neutral: 0 }
  for (const k in opinionCounts) {
    sentimentSummary.positive += opinionCounts[k].pos
    sentimentSummary.negative += opinionCounts[k].neg
    sentimentSummary.neutral  += opinionCounts[k].neu
  }

  return { aspect: targetWord, totalMentions, opinions, sentimentSummary, mode: targetIsOpinion ? 'nouns' : 'opinions' }
}

function getSentiment(word: string): 'positive' | 'negative' | 'neutral' | null {
  if (POSITIVE_OPINIONS.has(word)) return 'positive'
  if (NEGATIVE_OPINIONS.has(word)) return 'negative'
  if (NEUTRAL_OPINIONS.has(word)) return 'neutral'
  return null
}
