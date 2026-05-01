// lib/socialTagging.ts
// Shared tagging pipeline for social media comments.
// Used by both the sync cron (real comments) and the demo generator.
// Single source of truth for sentiment, content flags, topics, emotions, intents, and off-topic detection.

import { auditContent } from '@/lib/contentGuard'
import { POSITIVE_WORDS, NEGATIVE_WORDS, NEGATORS } from '@/lib/sentimentLexicon'

// Additional sentiment words not in the base lexicon
const EXTRA_POSITIVE = new Set(['appreciate', 'appreciated', 'appreciation', 'hope', 'hoping', 'hopeful', 'support', 'supporting', 'supporter', 'thank', 'thanks', 'thankful', 'grateful', 'inspire', 'inspired', 'inspiring', 'congrats', 'congratulations', 'bravo', 'kudos', 'excited', 'exciting', 'thrilled'])
const EXTRA_NEGATIVE = new Set(['corrupt', 'corruption', 'liar', 'lying', 'lies', 'scam', 'scammer', 'fraud', 'fake', 'crooked', 'fail', 'failure', 'failing', 'joke', 'clown', 'useless', 'trash', 'garbage', 'sucks', 'suck'])
const SENTIMENT_STOPWORDS = new Set(['covid', 'pandemic', 'crisis', 'issue', 'issues', 'problem', 'problems', 'challenge', 'challenges', 'change', 'remember'])

const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'and', 'or', 'but', 'not', 'no', 'this', 'that', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'their', 'what', 'how', 'when', 'where', 'who', 'why', 'so', 'if', 'then', 'than', 'just', 'also', 'about', 'up', 'out', 'all', 'more', 'some', 'very', 'too'])

const TOPIC_KEYWORDS: Record<string, RegExp> = {
  'safety': /\b(safe(?:ty)?|crime|police|policing|security|dangerous|scary|homeless(?:ness)?|violence|gun\b|shoot(?:ing)?|murder)\b/i,
  'housing': /\b(housing|rent(?:al|er|s)?|afford(?:able|ability)|home\s*owner|apartment|mortgage|evict(?:ion)?|landlord|shelter)\b/i,
  'economy': /\b(econom|job(?:s|less)?|business(?:es)?|tax(?:es|ation)?|inflation|wage(?:s)?|employ(?:ment|er|ee)?|small\s+business|workforce)\b/i,
  'education': /\b(school(?:s)?|education|teacher|student|university|college|tuition|curriculum)\b/i,
  'healthcare': /\b(health\s*care|hospital|doctor|insurance|medical|mental\s+health|prescription|medicare|medicaid)\b/i,
  'transportation': /\b(traffic|transit|bus(?:es)?|road(?:s)?|highway|parking|commut(?:e|ing|er)|bike\s*lane|public\s+transit)\b/i,
  'environment': /\b(environment(?:al)?|climate|pollution|clean\s+energy|solar|carbon|sustainability|recycl)\b/i,
  'immigration': /\b(immigra(?:nt|tion)|border|undocumented|visa|citizenship|\bICE\b|deport(?:ation)?)\b/i,
  'development': /\b(develop(?:ment|er)|construction|downtown|zoning|density|gentrification|infrastructure)\b/i,
  'culture': /\b(restaurant|dining|arts\b|cultural|entertainment|museum|venue|nightlife)\b/i,
}

// ── Sentiment scoring ──────────────────────────────────────────────────

export function scoreSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  var words = text.toLowerCase().replace(/[^a-z\s']/g, '').split(/\s+/)
  var score = 0
  var firstHit = true
  for (var i = 0; i < words.length; i++) {
    var w = words[i]
    if (SENTIMENT_STOPWORDS.has(w)) continue
    var negated = i > 0 && NEGATORS.has(words[i - 1])
    var delta = 0
    if (POSITIVE_WORDS.has(w) || EXTRA_POSITIVE.has(w)) delta = negated ? -1 : 1
    else if (NEGATIVE_WORDS.has(w) || EXTRA_NEGATIVE.has(w)) delta = negated ? 1 : -1
    if (delta !== 0) {
      score += firstHit ? delta * 2 : delta
      firstHit = false
    }
  }
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

// ── Full tagging pipeline ──────────────────────────────────────────────

export interface TagResult {
  sentiment: 'positive' | 'negative' | 'neutral'
  flags: Array<{ type: string; severity: string | null; action?: string }>
  isHidden: boolean
  isDeleted: boolean
  topics: string[]
  intents: string[]
  emotion: string
}

export function tagComment(text: string, postText?: string | null): TagResult {
  var sentiment = scoreSentiment(text)
  var audit = auditContent(text)
  var flags: Array<{ type: string; severity: string | null; action?: string }> = audit.flags.map(function(f) { return { type: f, severity: audit.maxSeverity } })

  var isHidden = false
  var isDeleted = false

  // Moderation actions based on content guard severity
  if (audit.maxSeverity === 'severe') {
    var hasThreatsOrSlurs = audit.flags.some(function(f) { return f === 'threat' || f === 'slur' })
    if (hasThreatsOrSlurs) {
      isDeleted = true
      flags.push({ type: 'auto_delete', severity: 'severe', action: 'Auto-deleted: threats/slurs' })
    } else {
      isHidden = true
      flags.push({ type: 'auto_hide', severity: 'severe', action: 'Auto-hidden: severe content' })
    }
  } else if (audit.maxSeverity === 'rude') {
    flags.push({ type: 'review', severity: 'rude', action: 'Flagged for review' })
  }

  // Spam detection
  if (/https?:\/\/|buy now|click here|free money|earn \$/i.test(text)) {
    flags.push({ type: 'spam', severity: 'moderate', action: 'Auto-hidden: spam detected' })
    if (!isHidden && !isDeleted) { isHidden = true }
  }

  // Competitor detection
  if (/competitor|qualtrics|surveymonkey|typeform|medallia/i.test(text)) {
    flags.push({ type: 'competitor', severity: null, action: 'Competitor mention detected' })
  }

  // Intent detection
  var intents: string[] = []
  if (/donat|contribut|give money|chip in|fundrais/i.test(text)) { intents.push('donate'); flags.push({ type: 'intent', severity: null, action: 'Donate intent detected' }) }
  if (/volunteer|sign up|join|get involved|help out|canvass/i.test(text)) { intents.push('volunteer'); flags.push({ type: 'intent', severity: null, action: 'Volunteer intent detected' }) }
  if (/\b(event|rally|town hall|meet.*greet|attend)\b/i.test(text)) { intents.push('event'); flags.push({ type: 'intent', severity: null, action: 'Event interest detected' }) }

  // Topic detection
  var topics: string[] = []
  for (var topicName in TOPIC_KEYWORDS) {
    if (TOPIC_KEYWORDS[topicName].test(text)) topics.push(topicName)
  }

  // Off-topic detection — check against topics, campaign words, and post text overlap
  var campaignRelated = /\b(vote|elect|campaign|mayor|council|city|county|district|candidate|support|endorse|run(?:ning)?|office|politic|rally|debate)\b/i.test(text)
  var postRelated = false
  if (postText) {
    var postWords = postText.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(function(w) { return w.length > 2 && !STOPWORDS.has(w) })
    var commentWords = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(function(w) { return w.length > 2 && !STOPWORDS.has(w) })
    var overlap = commentWords.filter(function(w) { return postWords.includes(w) })
    postRelated = overlap.length >= 2
  }
  if (topics.length === 0 && !campaignRelated && !postRelated && !isHidden && !isDeleted) {
    flags.push({ type: 'off_topic', severity: null, action: 'Off-topic: unrelated to post or campaign' })
  }
  if (topics.length > 0) flags.push({ type: 'topics', severity: null, action: 'Topics: ' + topics.join(', ') })

  // Emotion detection
  var emotion = 'neutral'
  if (/love|amazing|fantastic|incredible|excited|thrilled|proud|inspired/i.test(text)) emotion = 'enthusiastic'
  else if (/hate|furious|outraged|disgusted|livid|enraged/i.test(text)) emotion = 'angry'
  else if (/worried|concerned|afraid|scared|anxious|nervous/i.test(text)) emotion = 'worried'
  else if (/disappoint|frustrat|upset|annoyed|let down/i.test(text)) emotion = 'frustrated'
  else if (/curious|wonder|interest|intrigued|question/i.test(text)) emotion = 'curious'
  else if (/hope|wish|optimis|looking forward|can't wait/i.test(text)) emotion = 'hopeful'
  if (emotion !== 'neutral') flags.push({ type: 'emotion', severity: null, action: 'Emotion: ' + emotion })

  return { sentiment, flags, isHidden, isDeleted, topics, intents, emotion }
}
