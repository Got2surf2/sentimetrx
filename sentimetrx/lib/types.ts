// ============================================================
// SENTIMETRX — Shared Types
// ============================================================

export type ClientPlan = 'trial' | 'active' | 'suspended'

export interface RatingOption {
  score:  number
  emoji:  string
  label:  string
}

export interface PsychoQuestion {
  key:          string
  q:            string
  opts:         string[]
  exportLabel?: string
  required?:    boolean   // if true, always asked (not randomly skipped)
}

export interface StudyTheme {
  primaryColor:      string
  headerGradient:    string
  backgroundColor:   string
  accentColor:       string
  botAvatarGradient: string
}

export interface StudyClarifiers {
  [keyword: string]: string
  default: string
}

export interface StudyConfig {
  greeting:          string
  ratingPrompt:      string
  q1ExportLabel?:    string
  ratingScale:       RatingOption[]
  promoterQ1:        string
  passiveQ1:         string
  detractorQ1:       string
  q3:                string
  q3Required?:       boolean   // default true — set false to make optional
  q3ExportLabel?:    string
  q4:                string
  q4Required?:       boolean   // default false — typically optional
  q4ExportLabel?:    string
  clarifiers:        StudyClarifiers
  psychographicBank: PsychoQuestion[]
  theme:             StudyTheme
  useAIClarify?:     boolean   // opt-in to AI clarifying questions
}

export interface Study {
  id:          string
  guid:        string
  name:        string
  bot_name:    string
  bot_emoji:   string
  status:      'draft' | 'active' | 'closed'
  visibility:  'public' | 'private'
  config:      StudyConfig
  created_by:  string
  org_id:      string
  client_id:   string
  created_at:  string
}

export type Sentiment = 'promoter' | 'passive' | 'detractor'

export interface SurveyPayload {
  agent:            string
  timestamp:        string
  experienceRating: { score: number; label: string; sentiment: Sentiment }
  npsRecommend:     { score: number; label: string }
  openEnded:        { q1: string; q3: string; q4: string }
  psychographics:   Record<string, string>
  demographics:     { age: string; gender: string; zip: string }
}

export interface SubmitResponseBody {
  study_guid:   string
  payload:      SurveyPayload
  duration_sec: number
}
