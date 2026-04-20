// lib/opinionMining.ts
// Client-side opinion mining: extract aspect → opinion pairs from text data
// Used when a user clicks a word in the word cloud to see associated opinions

// Common opinion words categorized by sentiment
const POSITIVE_OPINIONS = new Set([
  'good','great','excellent','amazing','awesome','fantastic','wonderful','perfect','best',
  'delicious','tasty','fresh','friendly','nice','lovely','beautiful','clean','quick','fast',
  'warm','hot','crispy','tender','flavorful','juicy','smooth','rich','creamy','light',
  'attentive','helpful','polite','efficient','professional','outstanding','superb','incredible',
  'impressive','comfortable','cozy','spacious','pleasant','enjoyable','reasonable','generous',
  'authentic','consistent','reliable','prompt','welcoming','accommodating','caring','cheerful',
  'exceptional','phenomenal','spectacular','remarkable','brilliant','divine','heavenly','savory',
  'satisfying','refreshing','perfect','favorite','love','loved','enjoy','enjoyed','recommend',
])

const NEGATIVE_OPINIONS = new Set([
  'bad','terrible','horrible','awful','worst','poor','slow','cold','bland','dry','stale',
  'rude','dirty','expensive','overpriced','small','tiny','loud','noisy','crowded','long',
  'soggy','burnt','undercooked','overcooked','raw','greasy','salty','bitter','tasteless',
  'mediocre','disappointing','disgusting','unpleasant','uncomfortable','unfriendly','inattentive',
  'lazy','careless','unprofessional','disorganized','chaotic','filthy','gross','lukewarm',
  'watery','tough','chewy','rubbery','mushy','hard','old','late','wrong','missing',
  'broken','ignored','forgotten','waited','waiting','complained','annoyed','frustrated',
  'underwhelming','overrated','average','meh','okay','ok',
])

const NEUTRAL_OPINIONS = new Set([
  'big','large','small','new','different','usual','normal','standard','regular','typical',
  'busy','popular','full','empty','dark','bright','simple','basic','fine','decent',
  'moderate','mixed','fair','adequate','acceptable','sufficient','ordinary','average',
])

// Conjunctions that block cross-phrase opinion pairing
var CONJUNCTIONS = new Set(['and', 'or', 'nor', 'also', 'plus', 'with'])

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
  const opinionCounts: Record<string, { count: number; sentiment: 'positive' | 'negative' | 'neutral'; samples: string[] }> = {}
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
              // If target is an adjective, look for nouns; otherwise look for opinion words
              if (targetIsOpinion) {
                if (!isSubjectWord(w)) continue
                var nounSentiment = getSentiment(target) || 'neutral'
                if (!opinionCounts[w]) {
                  opinionCounts[w] = { count: 0, sentiment: nounSentiment, samples: [] }
                }
                opinionCounts[w].count++
                if (opinionCounts[w].samples.length < 3) {
                  const trimmed = sentence.trim().slice(0, 120)
                  if (!opinionCounts[w].samples.includes(trimmed)) {
                    opinionCounts[w].samples.push(trimmed)
                  }
                }
                continue
              }
              const sentiment = getSentiment(w)
              if (!sentiment) continue
              if (!opinionCounts[w]) {
                opinionCounts[w] = { count: 0, sentiment, samples: [] }
              }
              opinionCounts[w].count++
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

  // Sort by frequency
  const opinions: OpinionPair[] = Object.entries(opinionCounts)
    .map(function(e) { return { opinion: e[0], count: e[1].count, sentiment: e[1].sentiment, samples: e[1].samples } })
    .sort(function(a, b) { return b.count - a.count })
    .slice(0, 30)

  const sentimentSummary = { positive: 0, negative: 0, neutral: 0 }
  opinions.forEach(function(o) { sentimentSummary[o.sentiment] += o.count })

  return { aspect: targetWord, totalMentions, opinions, sentimentSummary, mode: targetIsOpinion ? 'nouns' : 'opinions' }
}

function getSentiment(word: string): 'positive' | 'negative' | 'neutral' | null {
  if (POSITIVE_OPINIONS.has(word)) return 'positive'
  if (NEGATIVE_OPINIONS.has(word)) return 'negative'
  if (NEUTRAL_OPINIONS.has(word)) return 'neutral'
  return null
}
