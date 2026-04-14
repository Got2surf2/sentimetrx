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
  return text
    .replace(/^(Got it|Sure|Okay|I see|Understood|Right|Interesting)[^.!?]*[.!?\-—:]\s*/gi, '')
    .replace(/^(Here'?s?\s+(my|a|the)\s+)[^.!?]*[.!?\-—:]\s*/gi, '')
    .replace(/^(Here'?s?\s+(my|a|the)\s+follow[- ]?up[^.!?]*[.!?\-—:]\s*)/gi, '')
    .replace(/^(The (respondent|participant)|They('ve| have| are)|This (is|indicates))[^.!?]*[.!?\-—:]\s*/gi, '')
    .replace(/^(Let me|I'll|I will|I want to)[^.!?]*[.!?\-—:]\s*/gi, '')
    .replace(/^(Based on|Given|Since)[^.!?]*[.!?\-—:]\s*/gi, '')
    .replace(/^[-—–]\s*/, '')
    .replace(/^["']|["']$/g, '')
    .trim()
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
