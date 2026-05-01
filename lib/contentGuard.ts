// lib/contentGuard.ts
// Centralized content safety + sentiment system.
// Detection: regex patterns + OpenAI moderation (when available)
// Sentiment: AFINN-165 via `sentiment` package
// Used by: social tagging, townhall chat, bots, surveys, clarify/deflect

import Sentiment from 'sentiment'

const analyzer = new Sentiment()

// ── Sentiment scoring (AFINN-165: 3,382 words, -5 to +5 intensity) ──────────

export function scoreSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  var result = analyzer.analyze(text)
  if (result.comparative > 0.05) return 'positive'
  if (result.comparative < -0.05) return 'negative'
  return 'neutral'
}

// ── Severity levels ──────────────────────────────────────────────────────────
// 'mild' = logged only, no escalation (damn, hell, crap, etc.)
// 'rude' = message processed but bot nudges the participant
// 'severe' = triggers strikes + escalation (slurs, threats, sexual content)

type Severity = 'mild' | 'rude' | 'severe'
type Category = 'slur' | 'threat' | 'sexual' | 'profanity' | 'insult' | 'spam'
interface PatternDef { pattern: RegExp; severity: Severity; category: Category }

// ── Bleep patterns: simpler regexes for word replacement in display ───────────
const BLEEP_PATTERNS: { pattern: RegExp; category: Category }[] = [
  // Slurs
  { pattern: /\b(n[i1!]gg\w*|sp[i1!]c[ks]?|ch[i1!]nk[s]?|k[i1!]ke[s]?|w[e3]tb[a4@]ck[s]?|f[a4@]gg?\w*|r[e3]t[a4@]rd\w*)\b/gi, category: 'slur' },
  // Threats
  { pattern: /\b(kill\s+(you|them|myself|him|her)|murder|bomb\s+threat|shoot(?:ing)?|stab(?:bing)?|rape|molest|assault)\b/gi, category: 'threat' },
  // Sexual
  { pattern: /\b(porn|hentai|xxx|nudes?|naked|d[i1!]ck\s*pic|c[o0]ck\s*suck\w*)\b/gi, category: 'sexual' },
  // Strong profanity
  { pattern: /\b(f+u+c+k\w*|c+u+n+t+s?|motherf\w*)\b/gi, category: 'profanity' },
  // Mild profanity
  { pattern: /\b(shit+\w*|bullshit|bitch\w*|bastard[s]?|asshole[s]?|damn\w*|crap\w*|piss\w*)\b/gi, category: 'profanity' },
  // Insults
  { pattern: /\b(dumbass\w*|idiot[s]?|moron[s]?|stupid|loser[s]?|pathetic|ignorant|incompetent)\b/gi, category: 'insult' },
]

// ── Detection patterns (more complex, for severity checking) ─────────────────
const PATTERNS: PatternDef[] = [
  // Severe: slurs (with common evasion tactics)
  { pattern: /\b(n+[i1!]+g+[e3]*[r]+s?)\b/i, severity: 'severe', category: 'slur' },
  { pattern: /\bn[\s.*]*i[\s.*]*g[\s.*]*g[\s.*]*[ae][\s.*]*r/i, severity: 'severe', category: 'slur' },
  { pattern: /\b(sp[i1!]c[ks]?|ch[i1!]nk[s]?|k[i1!]ke[s]?|w[e3]tb[a4@]ck[s]?)\b/i, severity: 'severe', category: 'slur' },
  { pattern: /\b(f+[a4@]+g+[o0]?t?[s]?|f[\s.*]*a[\s.*]*g[\s.*]*g[\s.*]*o[\s.*]*t)\b/i, severity: 'severe', category: 'slur' },
  { pattern: /\b(r[e3]t[a4@]rd(ed)?)\b/i, severity: 'severe', category: 'slur' },

  // Severe: threats & violence
  { pattern: /\b(kill\s+(you|your|them|myself|yourself|himself|herself|themselves|him|her)|murder|bomb\s+threat|shoot(ing)?|stab(bing)?)\b/i, severity: 'severe', category: 'threat' },
  { pattern: /\bi['']?ll\s+(kill|hurt|destroy|end)\s+(you|them|him|her)/i, severity: 'severe', category: 'threat' },
  { pattern: /\b(rape|molest|assault)\b/i, severity: 'severe', category: 'threat' },

  // Severe: explicit sexual content
  { pattern: /\b(porn|hentai|xxx|nude[s]?|naked|d[i1!]ck\s*pic|c[o0]ck\s*suck)/i, severity: 'severe', category: 'sexual' },

  // Severe: strong profanity (with evasion: f*ck, f u c k, fck, f***, etc.)
  { pattern: /\bf+[\s.*_-]*[u\xfc]+[\s.*_-]*c+[\s.*_-]*k+/i, severity: 'severe', category: 'profanity' },
  { pattern: /\bf[*]{2,}/i, severity: 'severe', category: 'profanity' },  // f***, f**k
  { pattern: /\bb[*]{2,}/i, severity: 'severe', category: 'profanity' },  // b****, b***
  { pattern: /\bs[*]{2,}/i, severity: 'severe', category: 'profanity' },  // s**t, s***
  { pattern: /\ba[*]{2,}/i, severity: 'mild', category: 'profanity' },  // a**, a***
  { pattern: /\bc+[\s.*_-]*u+[\s.*_-]*n+[\s.*_-]*t+/i, severity: 'severe', category: 'profanity' },

  // Severe: directed hostility (triggers strikes)
  { pattern: /\b(screw\s*you|go\s*to\s*hell|piss\s*off|bite\s*me|eat\s*shit)\b/i, severity: 'severe', category: 'insult' },
  // Severe: hate speech patterns
  { pattern: /go\s+back\s+(where|to\s+where)\s+you\s+came\s+from/i, severity: 'severe', category: 'slur' },
  // Severe: "bitch" when directed (you/stupid/dumb + bitch)
  { pattern: /\b(you|stupid|dumb|ugly|fat|lazy)\s+bitch/i, severity: 'severe', category: 'profanity' },
  // Severe: xenophobic / defamatory accusations
  { pattern: /\b(terrorist\s*(sympathiz|support|lov)|terror\s*apolog)/i, severity: 'severe', category: 'slur' },
  { pattern: /\b(extremist|radical\s*islamist|jihadist|insurgent)\b/i, severity: 'severe', category: 'slur' },

  // Rude: insults that get a gentle nudge (message still processed, no strikes)
  { pattern: /\b(dumbass(es)?|idiot[s]?|moron[s]?|stupid|dumb|loser[s]?|pathetic|ignorant|incompetent)\b/i, severity: 'rude', category: 'insult' },
  { pattern: /\b(shut\s*up|get\s*lost|waste\s+of\s+time)\b/i, severity: 'rude', category: 'insult' },

  // Mild: common profanity (logged but no escalation)
  { pattern: /\b(shit+y?|bullshit|shitt?ing)\b/i, severity: 'mild', category: 'profanity' },
  { pattern: /\b(bitch(es|ing|y)?|bastard[s]?|asshole[s]?|ass(es)?)\b/i, severity: 'mild', category: 'profanity' },
  { pattern: /\b(damn(it|ed)?|hell|crap(py)?|piss(ed)?)\b/i, severity: 'mild', category: 'profanity' },

  // Severe: URLs (spam/phishing)
  { pattern: /https?:\/\//i, severity: 'severe', category: 'spam' },

  // Rude: verbose/debug/prompt probing — redirect without revealing anything
  { pattern: /\b(show\s+(me\s+)?(your|the)\s+(think|reason|debug|verbose|system\s*prompt|instructions|internal))/i, severity: 'rude', category: 'prompt_probe' as Category },
  { pattern: /\b(enable|enter|turn\s+on|activate|switch\s+to)\s+(debug|verbose|dev(eloper)?|admin|test(ing)?)\s*(mode)?/i, severity: 'rude', category: 'prompt_probe' as Category },
  { pattern: /\b(reveal|expose|dump|print|display|output)\s+(your\s+)?(system|hidden|internal|original|full)\s*(prompt|instructions|config|reasoning)/i, severity: 'rude', category: 'prompt_probe' as Category },
  { pattern: /\bwhat\s+(are|is)\s+your\s+(system\s*prompt|instructions|rules|guidelines|directives)\b/i, severity: 'rude', category: 'prompt_probe' as Category },
  { pattern: /\b(ignore|disregard|forget|override)\s+(your|all|previous|prior|above)\s+(instructions|rules|prompt|guidelines)/i, severity: 'rude', category: 'prompt_probe' as Category },
]

// ── Content safety toggles ───────────────────────────────────────────────────
export interface ContentSafetyConfig {
  enabled: boolean       // master toggle (default true)
  profanity?: boolean    // block/bleep profanity (default true)
  slurs?: boolean        // block slurs (default true)
  threats?: boolean      // block threats/violence (default true)
  sexual?: boolean       // block sexual content (default true)
  insults?: boolean      // nudge on insults (default true)
  spam?: boolean         // block URLs (default true)
}

export const CONTENT_SAFETY_DEFAULTS: ContentSafetyConfig = {
  enabled: true, profanity: true, slurs: true, threats: true, sexual: true, insults: true, spam: true,
}

function isCategoryEnabled(category: Category, config?: ContentSafetyConfig): boolean {
  if (!config || config.enabled === false) return false
  switch (category) {
    case 'profanity': return config.profanity !== false
    case 'slur':      return config.slurs !== false
    case 'threat':    return config.threats !== false
    case 'sexual':    return config.sexual !== false
    case 'insult':    return config.insults !== false
    case 'spam':      return config.spam !== false
    default:          return true
  }
}

// ── Bleep text: replace matched words with **** ──────────────────────────────
export function bleepText(text: string, config?: ContentSafetyConfig): string {
  const cfg = config || CONTENT_SAFETY_DEFAULTS
  if (cfg.enabled === false) return text
  let result = text
  for (const bp of BLEEP_PATTERNS) {
    if (!isCategoryEnabled(bp.category, cfg)) continue
    result = result.replace(bp.pattern, (match) => match[0] + '*'.repeat(Math.max(1, match.length - 2)) + match[match.length - 1])
  }
  return result
}

// ── Strike tracking (in-memory, resets per process) ──────────────────────────
const strikeMap = new Map<string, { strikes: number; lastViolation: number }>()

const CLEANUP_INTERVAL = 30 * 60 * 1000
const MAX_AGE = 4 * 60 * 60 * 1000

let lastCleanup = Date.now()
function cleanupOldEntries() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  strikeMap.forEach((val, key) => {
    if (now - val.lastViolation > MAX_AGE) strikeMap.delete(key)
  })
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface ContentCheckResult {
  safe: boolean
  severity?: Severity
  category?: string
  warning?: string
  nudge?: boolean
  shutdown?: boolean
  strikes?: number
  bleeped?: string      // bleeped version of the text for display
}

export function checkMessage(
  participantId: string,
  text: string,
  options: { safetyConfig?: ContentSafetyConfig; maxLength?: number } = {},
): ContentCheckResult {
  const { safetyConfig, maxLength = 1200 } = options
  const cfg = safetyConfig || CONTENT_SAFETY_DEFAULTS
  cleanupOldEntries()

  if (!text || text.trim().length === 0) return { safe: false, category: 'empty' }
  if (text.length > maxLength) return { safe: false, category: 'too_long' }

  if (cfg.enabled === false) return { safe: true }

  // Always produce bleeped version for display
  const bleeped = bleepText(text, cfg)

  for (const def of PATTERNS) {
    if (!isCategoryEnabled(def.category, cfg)) continue
    if (!def.pattern.test(text)) continue

    // Rude: message goes through but bot should acknowledge the tone
    if (def.severity === 'rude') {
      return { safe: true, severity: 'rude', category: def.category, nudge: true, bleeped }
    }

    // Mild severity: log only, no escalation
    if (def.severity === 'mild') {
      return { safe: true, severity: 'mild', category: def.category, bleeped }
    }

    // Severe: apply strike escalation
    const entry = strikeMap.get(participantId) || { strikes: 0, lastViolation: 0 }
    entry.strikes += 1
    entry.lastViolation = Date.now()
    strikeMap.set(participantId, entry)

    if (entry.strikes >= 3) {
      return {
        safe: false, severity: 'severe', category: def.category, bleeped,
        warning: "We've had to end this conversation. Thank you for your time.",
        shutdown: true, strikes: entry.strikes,
      }
    }

    if (entry.strikes === 2) {
      return {
        safe: false, severity: 'severe', category: def.category, bleeped,
        warning: "Please keep the conversation respectful. One more violation and we'll need to end the conversation.",
        strikes: entry.strikes,
      }
    }

    return {
      safe: false, severity: 'severe', category: def.category, bleeped,
      warning: "Let's keep things respectful — could you rephrase that? What else is on your mind?",
      strikes: entry.strikes,
    }
  }

  return { safe: true, bleeped }
}

export function resetStrikes(participantId: string) { strikeMap.delete(participantId) }
export function getStrikes(participantId: string): number { return strikeMap.get(participantId)?.strikes || 0 }

// Legacy compat
export function isContentSafe(text: string, maxLength = 600): boolean {
  return checkMessage('_anon', text, { maxLength }).safe
}

// ── Audit mode (for surveys) ────────────────────────────────────────────────
// Scans text and returns content flags without blocking.
// Used to tag survey responses for analyst-side filtering.

export type ContentFlag = 'profanity' | 'slur' | 'threat' | 'sexual' | 'insult' | 'spam' | 'outside_scope'

export interface AuditResult {
  flags: ContentFlag[]
  maxSeverity: Severity | null
  bleeped: string
}

/** Scan text for content flags without blocking or tracking strikes. */
export function auditContent(text: string): AuditResult {
  if (!text || text.trim().length < 2) return { flags: [], maxSeverity: null, bleeped: text || '' }

  var flagSet: Record<string, boolean> = {}
  var maxSeverity: Severity | null = null
  var severityRank: Record<string, number> = { mild: 1, rude: 2, severe: 3 }

  for (var i = 0; i < PATTERNS.length; i++) {
    var def = PATTERNS[i]
    if (def.pattern.test(text)) {
      flagSet[def.category] = true
      if (!maxSeverity || severityRank[def.severity] > severityRank[maxSeverity]) {
        maxSeverity = def.severity
      }
    }
  }

  var bleeped = bleepText(text)
  return { flags: Object.keys(flagSet) as ContentFlag[], maxSeverity, bleeped }
}

/** Audit all user messages in a conversation log. Returns combined flags. */
export function auditConversationLog(
  log: { who: string; text: string }[]
): AuditResult {
  var flagSet: Record<string, boolean> = {}
  var maxSev: Severity | null = null
  var severityRank: Record<string, number> = { mild: 1, rude: 2, severe: 3 }

  for (var i = 0; i < log.length; i++) {
    if (log[i].who !== 'user') continue
    var result = auditContent(log[i].text)
    result.flags.forEach(function(f) { flagSet[f] = true })
    if (result.maxSeverity && (!maxSev || severityRank[result.maxSeverity] > severityRank[maxSev])) {
      maxSev = result.maxSeverity
    }
  }

  return { flags: Object.keys(flagSet) as ContentFlag[], maxSeverity: maxSev, bleeped: '' }
}
