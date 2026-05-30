// lib/asr/router.ts
//
// Vendor routing for the recording pipeline. Pure function — no I/O, no
// awaits. Spec § 3.4: route by language + session_type + speaker count.
//
// Decision tree:
//   1. Multilingual or non-English-primary  → whisper   (multilingual edge)
//   2. Single speaker (lecture / 1:1 interview) → whisper   (no diarization needed; cheaper)
//   3. Multi-speaker (focus group, large QA panel, meeting) → deepgram (diarization tags)
//   4. Default for ambiguous QA → deepgram (sensible meeting default)
//
// Hybrid is opt-in via setup (asr_strategy='hybrid'), not auto-selected — it's
// 2x cost so we don't pick it for the user.

import type {
  AsrVendor,
  SessionType,
  QaSetupInputs,
  FocusGroupSetupInputs,
  InterviewSetupInputs,
  SetupInputs,
} from '@/lib/recordings/types'

export interface RouterInput {
  session_type: SessionType
  language: string                  // BCP-47, e.g. 'en', 'es', 'en-es'
  setup_inputs: SetupInputs | Record<string, unknown>
}

export function resolveAsrVendor(input: RouterInput): AsrVendor {
  const lang = (input.language || 'en').toLowerCase()
  const isMultilingual = lang === 'en-es' || (!lang.startsWith('en'))
  if (isMultilingual) return 'whisper'

  if (isSingleSpeaker(input)) return 'whisper'
  if (isMultiSpeaker(input)) return 'deepgram'

  // Default: meeting-shaped recording with unclear speaker count → deepgram
  return 'deepgram'
}

function isSingleSpeaker(input: RouterInput): boolean {
  if (input.session_type === 'lecture') return true
  if (input.session_type === 'interview') {
    const s = input.setup_inputs as Partial<InterviewSetupInputs>
    return Array.isArray(s.interviewees) && s.interviewees.length === 1
  }
  return false
}

function isMultiSpeaker(input: RouterInput): boolean {
  if (input.session_type === 'focus_group') return true
  if (input.session_type === 'general_meeting') return true
  if (input.session_type === 'qa') {
    const s = input.setup_inputs as Partial<QaSetupInputs>
    return Array.isArray(s.panel) && s.panel.length > 3
  }
  return false
}
