// lib/socialTagging.ts
// Shared tagging pipeline for social media comments.
// Used by both the sync cron (real comments) and the demo generator.
// Single source of truth for sentiment, content flags, topics, emotions, intents, and off-topic detection.

import { auditContent } from '@/lib/contentGuard'
import type { ModerationScore } from '@/lib/moderation'
import Sentiment from 'sentiment'

const analyzer = new Sentiment()

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
  'development': /\b(develop(?:ment|er)|construction|zoning|density|gentrification|infrastructure|downtown\s+(?:develop|project|build|revitaliz|plan))\b/i,
  'culture': /\b(restaurant|dining|arts\b|cultural|entertainment|museum|venue|nightlife)\b/i,
}

// ── Sentiment scoring (AFINN-165 via `sentiment` package) ─────────────

export function scoreSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  var result = analyzer.analyze(text)
  if (result.comparative > 0.05) return 'positive'
  if (result.comparative < -0.05) return 'negative'
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

export function tagComment(text: string, postText?: string | null, moderation?: ModerationScore | null): TagResult {
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

  // OpenAI moderation — catches toxicity that regex misses
  if (moderation) {
    if (moderation.threat >= 0.5) {
      if (!isDeleted) { isDeleted = true; flags.push({ type: 'auto_delete', severity: 'severe', action: 'Auto-deleted: threat detected (AI)' }) }
    } else if (moderation.toxicity >= 0.7) {
      if (!isHidden && !isDeleted) { isHidden = true; flags.push({ type: 'auto_hide', severity: 'severe', action: 'Auto-hidden: toxic content (AI)' }) }
    } else if (moderation.toxicity >= 0.4) {
      if (!flags.some(function(f) { return f.type === 'review' })) { flags.push({ type: 'review', severity: 'rude', action: 'Flagged for review: borderline toxic (AI)' }) }
    }
    if (moderation.sexual >= 0.5 && !isHidden && !isDeleted) {
      isHidden = true; flags.push({ type: 'auto_hide', severity: 'severe', action: 'Auto-hidden: sexual content (AI)' })
    }
    if (moderation.identity >= 0.5 && !isDeleted) {
      isDeleted = true; flags.push({ type: 'auto_delete', severity: 'severe', action: 'Auto-deleted: hate speech (AI)' })
    }
  }

  // Spam detection — expanded patterns
  var spamHit = false
  var hasUrl = /https?:\/\//i.test(text)
  var hasPromoLanguage = /\b(buy now|click here|free money|earn \$|act now|limited time|order now|sign up now)\b/i.test(text)
  var hasSocialBait = /\b(click\s+link\s+in\s+(bio|profile)|check\s+(my|our)\s+(bio|profile)|DM\s+(me|us)\s+for)\b/i.test(text)
  var hasScamLanguage = /\b(proven\s+(system|method|results)|FREE\s+(consultation|trial|offer|gift))\b/i.test(text)
  var hasAllCaps = false
  if (text.length >= 20) {
    var upperCount = (text.match(/[A-Z]/g) || []).length
    var letterCount = (text.match(/[a-zA-Z]/g) || []).length
    if (letterCount > 0 && upperCount / letterCount > 0.6) hasAllCaps = true
  }
  var hasExcessivePunctuation = /([!?$%])\1{3,}/.test(text)
  // URL alone is NOT spam — only flag when combined with other spam signals
  if (hasUrl && (hasPromoLanguage || hasSocialBait || hasScamLanguage || hasAllCaps)) spamHit = true
  // Non-URL spam signals are spam on their own
  if (hasPromoLanguage || hasSocialBait || hasScamLanguage) spamHit = true
  if (hasAllCaps) spamHit = true
  if (hasExcessivePunctuation) spamHit = true
  if (spamHit) {
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

// ── Response routing ───────────────────────────────────────────────────
// Determines whether a comment needs an AI call or can be handled by a template.
// Returns null if AI is needed, or a response string if a template suffices.

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

function inject(template: string, name?: string | null, topic?: string): string {
  var result = template
  if (name) result = result.replace('[name]', name).replace('[Name]', name)
  else result = result.replace(/,?\s*\[name\]/gi, '').replace(/\[Name\]\s*/gi, '')
  if (topic) result = result.replace('[topic]', topic)
  else result = result.replace(/about \[topic\]\s*/gi, '').replace(/\[topic\]/gi, 'this')
  return result.replace(/\s{2,}/g, ' ').trim()
}

const TEMPLATES = {
  off_topic: [
    'Thanks for commenting, [name]! This post is about [topic] — would love to hear your thoughts on that.',
    'Appreciate you chiming in, [name]! We\'re focused on [topic] here — what\'s your perspective?',
    'Hey [name], glad you\'re here! This thread is about [topic] — any thoughts?',
    'Thanks for stopping by, [name]! We\'d love to hear what you think about [topic].',
    'Hey [name]! This conversation is about [topic] — what are your thoughts on it?',
  ],
  spam: null, // no response — auto-hide silently
  auto_delete: null, // no response — auto-delete silently
  auto_hide: null, // no response — auto-hide silently
  positive: [
    'Thank you so much, [name]! That really means a lot.',
    'Appreciate the kind words, [name]! We\'re working hard to make a difference.',
    'Thanks, [name]! Your support keeps us going.',
    'Love hearing this, [name]! Thank you for being part of this.',
    'Means the world, [name]! Let us know if there\'s anything we can do for you.',
    'Thank you, [name]! We\'re in this together.',
  ],
  positive_intent_donate: [
    'That\'s amazing, [name]! Every contribution makes a real difference. You can donate here: [url]',
    'Thank you, [name]! If you\'d like to chip in, here\'s the link: [url]',
    'Appreciate that, [name]! Here\'s where you can contribute: [url]',
  ],
  positive_intent_volunteer: [
    'Love that energy, [name]! Sign up to volunteer here: [url]',
    'That\'s awesome, [name]! We\'d love to have you — sign up here: [url]',
    'Thanks, [name]! Here\'s where you can get involved: [url]',
  ],
  review: null, // needs human review — no auto-response
}

export type ResponseRoute = 'ai' | 'template' | 'silent' | 'review'

export interface RouteResult {
  route: ResponseRoute
  response: string | null
  reason: string
}

export function routeResponse(tagged: TagResult, authorName?: string | null, postTopic?: string): RouteResult {
  // Auto-delete / auto-hide → silent (no response)
  if (tagged.isDeleted) return { route: 'silent', response: null, reason: 'Auto-deleted' }
  if (tagged.isHidden) return { route: 'silent', response: null, reason: 'Auto-hidden' }

  // Needs review → queue for human
  if (tagged.flags.some(function(f) { return f.type === 'review' })) {
    return { route: 'review', response: null, reason: 'Flagged for human review' }
  }

  // Off-topic → template response
  if (tagged.flags.some(function(f) { return f.type === 'off_topic' })) {
    return { route: 'template', response: inject(pick(TEMPLATES.off_topic), authorName, postTopic), reason: 'Off-topic redirect' }
  }

  // Positive with intent → template with action URL
  if (tagged.sentiment === 'positive' && tagged.intents.length > 0) {
    var intentKey = 'positive_intent_' + tagged.intents[0]
    var pool = (TEMPLATES as any)[intentKey]
    if (pool) return { route: 'template', response: inject(pick(pool), authorName), reason: 'Positive + intent' }
  }

  // Simple positive → template acknowledgment
  if (tagged.sentiment === 'positive' && tagged.topics.length === 0) {
    return { route: 'template', response: inject(pick(TEMPLATES.positive), authorName), reason: 'Positive acknowledgment' }
  }

  // Everything else → needs AI (negative, critical, complex questions, on-topic discussion)
  return { route: 'ai', response: null, reason: 'Needs AI: ' + (tagged.sentiment === 'negative' ? 'negative sentiment' : 'complex/on-topic') }
}

