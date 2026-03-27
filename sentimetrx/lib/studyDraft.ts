import type { StudyConfig } from './types'
import type { Industry } from './industryDefaults'

export interface StudyDraft {
  name:           string
  bot_name:       string
  bot_emoji:      string
  slug?:          string           // custom URL slug — e.g. 'acme-feedback-2026'
  config:         StudyConfig
  industry?:      Industry
  otherIndustry?: string
}

export interface StepProps {
  draft:        StudyDraft
  update:       (partial: Partial<StudyDraft>) => void
  updateConfig: (partial: Partial<StudyConfig>) => void
}
