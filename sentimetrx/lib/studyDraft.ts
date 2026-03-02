import type { StudyConfig } from './types'

// The shape of a study being created or edited in the UI
// before it is saved to the database
export interface StudyDraft {
  name:      string
  bot_name:  string
  bot_emoji: string
  config:    StudyConfig
}

export interface StepProps {
  draft:        StudyDraft
  update:       (partial: Partial<StudyDraft>) => void
  updateConfig: (partial: Partial<StudyConfig>) => void
}
