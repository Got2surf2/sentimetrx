// lib/townhallActivationGate.ts
//
// Single source of truth for "is this town hall allowed to go live?"
// Used by both substrate PATCH paths in app/api/townhall/sessions/[id]/route.ts
// and re-exported through /api/townhall/grade-description so the create/edit
// UIs share the same grader prompt.
//
// Gate rules (from CLAUDE memory feedback_audit_respondent_visible_chrome +
// 2026-05-27 product decision): a town hall must not go live until BOTH
//   1. discussion_guide has at least one enabled topic with a non-empty
//      label and opening_question.
//   2. The event description grade is >= 3 ("Adequate"). The stored
//      snapshot is re-used when it matches the current description text
//      verbatim; otherwise the grader runs fresh.

import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import type { TownHallConfig, TownHallGuideTopic } from '@/lib/types'

export interface DescriptionGrade {
  score: number          // 1-5; 0 means "could not grade"
  suggestion: string
}

export interface ActivationReadiness {
  ready: boolean
  topics_ok: boolean
  description_ok: boolean
  description_score: number    // resolved score used by the gate
  missing: string[]            // user-facing reasons, empty when ready
}

const MIN_GRADE = 3

export function checkTopicsReady(guide: unknown): boolean {
  if (!Array.isArray(guide) || guide.length === 0) return false
  return guide.some((t: any) => {
    if (!t || t.enabled === false) return false
    return typeof t.label === 'string' && t.label.trim().length > 0
        && typeof t.opening_question === 'string' && t.opening_question.trim().length > 0
  })
}

export async function gradeEventDescription(description: string, industry?: string): Promise<DescriptionGrade> {
  if (!description?.trim()) {
    return { score: 0, suggestion: 'Add a description to help the AI moderate effectively.' }
  }

  const prompt = `You are evaluating a PulseIQ session description for completeness. The AI moderator uses this description to understand context, set tone, and guide the conversation.
${industry ? `\nIndustry: ${industry.replace(/_/g, ' ')}` : ''}

Description: "${description.trim()}"

Rate 1-5 on how well the description covers these criteria:
- WHO: Is the target audience defined? (employees, residents, patients, students, etc.)
- WHAT: Is the purpose/topic clear? (feedback on X, input for Y, discussion about Z)
- WHY: Is there a stated goal? (improve something, plan something, decide something)
- SCOPE: Are there boundaries? (time period, location, specific services/programs)
- CONTEXT: Is there enough background for an AI moderator to ask intelligent follow-ups?

Score guide:
1 = Too vague, AI will produce generic responses
2 = Missing several key elements
3 = Adequate but could be more specific
4 = Good — covers most elements
5 = Excellent — AI has everything it needs

Return ONLY valid JSON:
{"score":3,"suggestion":"One short sentence about the most impactful thing to add."}`

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 200,
      timeoutMs: 5000,
      system: 'Return ONLY raw JSON — no markdown, no backticks.',
      messages: [{ role: 'user', content: prompt }],
    })
    logUsage({ resource_type: 'townhall', event_type: 'grade_description' }, result.usage)
    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(raw)
    return {
      score: Math.max(1, Math.min(5, parsed.score || 1)),
      suggestion: parsed.suggestion || '',
    }
  } catch {
    return { score: 0, suggestion: '' }
  }
}

/**
 * Server-side activation gate. Used by both PATCH paths in the sessions
 * route before transitioning status to 'active'.
 *
 * Honors the saved grade snapshot when the description text hasn't changed
 * since it was graded (avoids an AI call on every activation attempt).
 * Falls back to a fresh grader call when the snapshot is missing or stale.
 */
export async function checkActivationReadiness(input: {
  config: TownHallConfig | Record<string, any>
  discussion_guide: TownHallGuideTopic[] | unknown
}): Promise<ActivationReadiness> {
  const missing: string[] = []
  const topics_ok = checkTopicsReady(input.discussion_guide)
  if (!topics_ok) {
    missing.push('Add at least one enabled discussion topic with a label and opening question.')
  }

  const cfg = (input.config || {}) as any
  const description: string = cfg?.context?.event_description || ''
  const industry: string | undefined = cfg?.industry

  // Reuse the stored snapshot only if it covers the exact text currently
  // saved on the session — otherwise re-grade so the gate can't be passed
  // by saving a strong description, getting a high grade, then editing
  // the description down without re-grading.
  const snap = cfg?.event_description_grade as { score?: number; graded_text?: string } | undefined
  let score = 0
  if (snap && snap.graded_text === description && typeof snap.score === 'number') {
    score = snap.score
  } else if (description.trim()) {
    const fresh = await gradeEventDescription(description, industry)
    score = fresh.score
  }

  const description_ok = score >= MIN_GRADE
  if (!description_ok) {
    if (!description.trim()) {
      missing.push('Add an event description so the AI moderator has context.')
    } else if (score === 0) {
      missing.push('The description grader could not score this. Try again or refine the description.')
    } else {
      missing.push('Event description needs to grade at least "Adequate" (3/5). Current score: ' + score + '/5.')
    }
  }

  return {
    ready: topics_ok && description_ok,
    topics_ok,
    description_ok,
    description_score: score,
    missing,
  }
}
