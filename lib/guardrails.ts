// lib/guardrails.ts
// Shared input/output guardrails for all AI-powered chat interactions
// Used by: /api/clarify, /api/deflect, /api/townhall/chat

// ── Input guardrails ──────────────────────────────────────────────────────
// Patterns that indicate harmful, off-topic, or spam input.
// If any match, the input should be skipped (no AI call made).
export const SKIP_PATTERNS = [
  /\b(fuck|shit|cunt|bitch|asshole|bastard)\b/i,         // profanity
  /\b(kill|murder|rape|bomb|attack|shoot)\b/i,           // violence
  /\b(nude|naked|sex|porn|dick|cock|pussy|tits)\b/i,     // sexual
  /\b(n[i1]gg|sp[i1]c|ch[i1]nk|k[i1]ke|f[a4]gg)\w*/i,  // slurs (common variants)
  /https?:\/\//i,                                         // URLs (spam/phishing)
]

// Check if user input is safe to process. Returns false if input matches skip patterns.
export function isInputSafe(text: string, maxLength = 600): boolean {
  if (!text || text.trim().length < 2) return false
  if (text.length > maxLength) return false
  return !SKIP_PATTERNS.some(pattern => pattern.test(text))
}

// ── Output guardrails ─────────────────────────────────────────────────────
// Validate AI-generated text before returning it to the respondent.
// Ensures the output looks like a question and doesn't echo harmful content.
export function isOutputSafe(text: string): boolean {
  if (!text || text.length < 5 || text.length > 200) return false
  const looksLikeQuestion = /\?$/.test(text) || /\b(what|why|how|which|who|when|could|can|would|tell|describe)\b/i.test(text)
  if (!looksLikeQuestion) return false
  if (SKIP_PATTERNS.some(p => p.test(text))) return false
  return true
}

// For town hall: less strict output check — bot messages aren't always questions
export function isOutputClean(text: string): boolean {
  if (!text || text.length < 3 || text.length > 500) return false
  if (SKIP_PATTERNS.some(p => p.test(text))) return false
  return true
}

// ── AI output cleanup ─────────────────────────────────────────────────────
// Strip leaked reasoning/preamble that models sometimes prefix responses with.
export function cleanAiOutput(text: string): string {
  let cleaned = text
    // Strip AI thinking/reasoning blocks that leaked
    .replace(/\*\*REASONING:?\*\*[\s\S]*?(?=\n\n|\*\*RESPONSE|\*\*---)/gi, '')
    .replace(/\*\*DEBUG[^*]*\*\*[\s\S]*?(?=\n\n|\*\*RESPONSE|\*\*---)/gi, '')
    .replace(/^REASONING:?\s*/gim, '')
    .replace(/^DEBUG:?\s*/gim, '')
    .replace(/---RESPONSE---\s*/gi, '')
    // Strip leaked decision/signal markers
    .replace(/^(BUDGET|DECISION|SIGNAL|TONE|DEFLECT|SOURCE|MATCHED|SMART PROBE|NEXT TOPIC|ALL TOPICS|FAST PATH|GLOBAL CHECKOUT|STANDBY)[:\s][^\n]*\n?/gim, '')
    // Strip original cleanup patterns
    .replace(/^(Got it|Sure|Okay|I see|Understood|Right|Interesting)[^.!?]*[.!?\-—:]\s*/gi, '')
    .replace(/^(Here'?s?\s+(my|a|the)\s+)[^.!?]*[.!?\-—:]\s*/gi, '')
    .replace(/^(Here'?s?\s+(my|a|the)\s+follow[- ]?up[^.!?]*[.!?\-—:]\s*)/gi, '')
    .replace(/^(The (respondent|participant)|They('ve| have| are)|This (is|indicates))[^.!?]*[.!?\-—:]\s*/gi, '')
    .replace(/^(Let me|I'll|I will|I want to)[^.!?]*[.!?\-—:]\s*/gi, '')
    .replace(/^(Based on|Given|Since)[^.!?]*[.!?\-—:]\s*/gi, '')
    .replace(/^[-—–]\s*/, '')
    .replace(/^["']|["']$/g, '')
    .trim()

  // Final safety: if any internal markers leaked through, strip them
  cleaned = cleaned.replace(/\b(theme_id|session_id|participant_id|turn_number|response_count|response_target)\b/gi, '')
  return cleaned
}

// ── Deflection response cleanup ───────────────────────────────────────────
// Shared cleanup for AI deflection responses (used by survey + town hall).
// Returns null if the AI said "no deflection needed" (NONE), or the cleaned
// redirect message if deflection is needed.
export function cleanDeflectResponse(raw: string, testing = false): { deflection: string | null; thinking: string[] } {
  let text = raw.trim() || 'NONE'
  let thinking: string[] = []

  // Parse verbose thinking if present (debug/testing mode)
  if (testing && text.includes('---RESPONSE---')) {
    const [thinkingPart, responsePart] = text.split('---RESPONSE---')
    thinking = thinkingPart.trim().split('\n').filter(Boolean)
    text = responsePart.trim()
  }

  // NONE with reasoning = not a deflection (AI said NONE but explained why)
  if (/^NONE\b/i.test(text)) return { deflection: null, thinking }
  if (text.length < 5) return { deflection: null, thinking }

  // Strip leaked reasoning — dashes, em-dashes, analysis sentences
  if (text.includes('---')) text = text.split('---').pop()!.trim()
  if (text.includes('—')) {
    const parts = text.split('—')
    if (/respondent|participant|question|off-topic|asking|seeking|classify|redirect|feedback|on-topic|pushback/i.test(parts[0])) {
      text = parts.slice(1).join('—').trim()
    }
  }
  text = text.replace(/^(Yes,?\s+)?(The respondent|The participant|They are|This is)[^.!?]*[.!?]\s*/gi, '')
  text = text.replace(/^(Got it|Sure|Okay|I see|Understood|Right)[^.!?]*[.!?\-—:]\s*/gi, '')
  text = text.replace(/^(Here'?s?\s+(my|a|the)\s+)[^.!?]*[.!?\-—:]\s*/gi, '')
  text = text.replace(/^(Let me|I'll|I will)[^.!?]*[.!?\-—:]\s*/gi, '')
  text = text.replace(/^(Based on|Given|Since)[^.!?]*[.!?\-—:]\s*/gi, '')

  if (!text || text.length < 5 || /^NONE\b/i.test(text)) return { deflection: null, thinking }

  // Catch AI character breaks — if the bot starts analyzing its own prompt, kill the deflection
  if (/I notice|I need|haven't provided|actual participant|no actual|discussion question.*participant|provided me|analysis framework|template|placeholder|actual reply|REASONING|DECISION|DEFLECT|DEBUG/i.test(text)) return { deflection: null, thinking }
  // Multi-line responses are character breaks (redirect should be 1-2 sentences)
  if (text.includes('\n') && text.split('\n').filter(Boolean).length > 2) return { deflection: null, thinking }
  // Numbered lists are always character breaks
  if (/^\d+\.\s/m.test(text)) return { deflection: null, thinking }
  // Too long means the AI rambled — kill it (max ~40 words for a redirect)
  if (text.split(/\s+/).length > 40) return { deflection: null, thinking }
  // Contains markdown formatting — character break
  if (/\*\*|##|```/.test(text)) return { deflection: null, thinking }

  return { deflection: text, thinking }
}

// For clarifier: extract the question from multi-sentence leaked output
export function extractQuestion(text: string): string {
  let clean = cleanAiOutput(text)

  // If there are multiple sentences, take the last one that ends with ?
  if (clean.includes('. ') || clean.includes('? ')) {
    const sentences = clean.split(/(?<=[.!?])\s+/)
    const questionSentence = sentences.reverse().find((s: string) => s.trim().endsWith('?'))
    if (questionSentence) clean = questionSentence.trim()
  }

  // Strip remaining leading quotes or dashes
  clean = clean.replace(/^[-—–]\s*/, '').replace(/^["']|["']$/g, '').trim()
  return clean
}
