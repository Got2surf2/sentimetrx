// lib/contentGuard.ts
// Centralized content safety system with strike-based escalation
// Used by: /api/townhall/chat, /api/clarify, /api/deflect

// ── Severity levels ──────────────────────────────────────────────────────────
// 'mild' = logged only, no escalation (damn, hell, crap, etc.)
// 'severe' = triggers strikes + escalation (slurs, threats, sexual content)

type Severity = 'mild' | 'rude' | 'severe'
interface PatternDef { pattern: RegExp; severity: Severity; category: string }

// ── Expanded pattern list with fuzzy matching ────────────────────────────────
// Handles: spaces between letters, number substitutions, asterisk censoring

const PATTERNS: PatternDef[] = [
  // Severe: slurs (with common evasion tactics)
  { pattern: /\b(n+[i1!]+g+[e3]*[r]+s?)\b/i, severity: 'severe', category: 'slur' },
  { pattern: /\bn[\s.*]*i[\s.*]*g[\s.*]*g[\s.*]*[ae][\s.*]*r/i, severity: 'severe', category: 'slur' },
  { pattern: /\b(sp[i1!]c[ks]?|ch[i1!]nk[s]?|k[i1!]ke[s]?|w[e3]tb[a4@]ck[s]?)\b/i, severity: 'severe', category: 'slur' },
  { pattern: /\b(f+[a4@]+g+[o0]?t?[s]?|f[\s.*]*a[\s.*]*g[\s.*]*g[\s.*]*o[\s.*]*t)\b/i, severity: 'severe', category: 'slur' },
  { pattern: /\b(r[e3]t[a4@]rd(ed)?)\b/i, severity: 'severe', category: 'slur' },

  // Severe: threats & violence
  { pattern: /\b(kill\s+(you|them|myself|him|her)|murder|bomb\s+threat|shoot(ing)?|stab(bing)?)\b/i, severity: 'severe', category: 'threat' },
  { pattern: /\bi['']?ll\s+(kill|hurt|destroy|end)\s+(you|them|him|her)/i, severity: 'severe', category: 'threat' },
  { pattern: /\b(rape|molest|assault)\b/i, severity: 'severe', category: 'threat' },

  // Severe: explicit sexual content
  { pattern: /\b(porn|hentai|xxx|nude[s]?|naked|d[i1!]ck\s*pic|c[o0]ck\s*suck)/i, severity: 'severe', category: 'sexual' },

  // Severe: strong profanity (with evasion: f*ck, f u c k, fck, etc.)
  { pattern: /\bf+[\s.*_-]*[u\xfc]+[\s.*_-]*c+[\s.*_-]*k+/i, severity: 'severe', category: 'profanity' },
  { pattern: /\bc+[\s.*_-]*u+[\s.*_-]*n+[\s.*_-]*t+/i, severity: 'severe', category: 'profanity' },

  // Rude: insults that get a gentle nudge (message still processed, no strikes)
  { pattern: /\b(dumbass(es)?|idiot[s]?|moron[s]?|stupid|dumb|loser[s]?|pathetic|ignorant|incompetent)\b/i, severity: 'rude', category: 'insult' },
  { pattern: /\b(shut\s*up|screw\s*you|go\s*to\s*hell|piss\s*off|get\s*lost|bite\s*me)\b/i, severity: 'rude', category: 'insult' },

  // Mild: common profanity (logged but no escalation)
  { pattern: /\b(shit+y?|bullshit|shitt?ing)\b/i, severity: 'mild', category: 'profanity' },
  { pattern: /\b(bitch(es|ing|y)?|bastard[s]?|asshole[s]?|ass(es)?)\b/i, severity: 'mild', category: 'profanity' },
  { pattern: /\b(damn(it|ed)?|hell|crap(py)?|piss(ed)?)\b/i, severity: 'mild', category: 'profanity' },

  // Severe: URLs (spam/phishing)
  { pattern: /https?:\/\//i, severity: 'severe', category: 'spam' },
]

// ── Strike tracking (in-memory, resets per process) ──────────────────────────
// Key: participantId, Value: { strikes, lastViolation }
const strikeMap = new Map<string, { strikes: number; lastViolation: number }>()

// Clean up old entries every 30 minutes to prevent memory leaks
const CLEANUP_INTERVAL = 30 * 60 * 1000
const MAX_AGE = 4 * 60 * 60 * 1000 // 4 hours

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
  warning?: string      // message to show to participant
  nudge?: boolean        // true = message is processed but bot should gently acknowledge the tone
  shutdown?: boolean     // true = end conversation for this participant
  strikes?: number       // current strike count
}

/**
 * Check a participant message for content safety violations.
 *
 * @param participantId - Unique participant identifier for strike tracking
 * @param text - The message text to check
 * @param options.filterEnabled - Whether content filtering is active (default true)
 * @param options.maxLength - Maximum message length (default 1200)
 * @returns ContentCheckResult with safe flag, optional warning, and shutdown signal
 */
export function checkMessage(
  participantId: string,
  text: string,
  options: { filterEnabled?: boolean; maxLength?: number } = {},
): ContentCheckResult {
  const { filterEnabled = true, maxLength = 1200 } = options
  cleanupOldEntries()

  // Basic input validation (always enforced regardless of filter toggle)
  if (!text || text.trim().length < 2) return { safe: false, category: 'empty' }
  if (text.length > maxLength) return { safe: false, category: 'too_long' }

  // If filtering is disabled, only check length — skip pattern matching
  if (!filterEnabled) return { safe: true }

  // Check all patterns
  for (const def of PATTERNS) {
    if (def.pattern.test(text)) {
      // Rude: message goes through but bot should acknowledge the tone
      if (def.severity === 'rude') {
        return { safe: true, severity: 'rude', category: def.category, nudge: true }
      }

      // Mild severity: log only, no escalation
      if (def.severity === 'mild') {
        return { safe: true, severity: 'mild', category: def.category }
      }

      // Severe: apply strike escalation
      const entry = strikeMap.get(participantId) || { strikes: 0, lastViolation: 0 }
      entry.strikes += 1
      entry.lastViolation = Date.now()
      strikeMap.set(participantId, entry)

      if (entry.strikes >= 3) {
        return {
          safe: false,
          severity: 'severe',
          category: def.category,
          warning: "We've had to end this conversation. Thank you for your time.",
          shutdown: true,
          strikes: entry.strikes,
        }
      }

      if (entry.strikes === 2) {
        return {
          safe: false,
          severity: 'severe',
          category: def.category,
          warning: "Please keep the conversation respectful. One more violation and we'll need to end the conversation.",
          strikes: entry.strikes,
        }
      }

      // Strike 1
      return {
        safe: false,
        severity: 'severe',
        category: def.category,
        warning: "Let's keep things respectful — could you rephrase that? What else is on your mind?",
        strikes: entry.strikes,
      }
    }
  }

  return { safe: true }
}

/**
 * Reset strikes for a participant (e.g., when a new session starts).
 */
export function resetStrikes(participantId: string) {
  strikeMap.delete(participantId)
}

/**
 * Get current strike count for a participant.
 */
export function getStrikes(participantId: string): number {
  return strikeMap.get(participantId)?.strikes || 0
}

// ── Legacy compat: drop-in replacement for isInputSafe ───────────────────────
// For endpoints that don't need strike tracking (surveys, deflect, etc.)
export function isContentSafe(text: string, maxLength = 600): boolean {
  const result = checkMessage('_anon', text, { maxLength })
  return result.safe
}
