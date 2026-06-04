// lib/recordings/qaDisplay.ts
//
// The one place that resolves which of a Q&A pair's three text layers to show
// (§3.5d). Precedence: human-edited → AI-polished → verbatim. Used by every
// display surface (report card, /th share page, PDF, PPTX) so they never drift.
// Pure + client-safe (no server-only imports) — importable anywhere.

import type { QaPairPayload } from '@/lib/recordings/types'

// `verbatim: true` forces the raw spoken text regardless of polish/edits — used
// by the share link's owner "verbatim" setting and the per-card "Show verbatim".
export function displayQuestion(qa: QaPairPayload, opts?: { verbatim?: boolean }): string {
  if (opts?.verbatim) return qa.question
  return qa.edited_question || qa.polished_question || qa.question
}

export function displayAnswer(qa: QaPairPayload, opts?: { verbatim?: boolean }): string {
  if (opts?.verbatim) return qa.answer
  return qa.edited_answer || qa.polished_answer || qa.answer
}

// True when a human has hand-edited either side — drives the "Edited" badge.
export function isEdited(qa: QaPairPayload): boolean {
  return !!(qa.edited_question || qa.edited_answer)
}
