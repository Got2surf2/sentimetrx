// ============================================================
// SENTIMETRX — Shared Types
// ============================================================

export type ClientPlan = 'trial' | 'active' | 'suspended'

// ── Likert / rating scale ────────────────────────────────────

export interface RatingOption {
  score:  number
  emoji:  string
  label:  string
}

// Adaptive open-end follow-up attached to any Likert question
export interface LikertFollowUp {
  enabled:      boolean
  mode:         'shared' | 'per-response'  // shared = one prompt for all; per-response = unique per score
  // shared mode
  sharedPrompt: string
  shareClarify: boolean
  shareAI:      boolean
  // per-response mode — keyed by score value (1-5 etc.)
  perResponse:  Record<string, {
    prompt:    string
    clarify:   boolean
    useAI:     boolean
  }>
}

// ── Custom survey questions ───────────────────────────────────

export type QuestionType = 'open' | 'radio' | 'checkbox' | 'dropdown' | 'likert'

export interface LikertScaleOption {
  score:  number
  emoji?: string
  label:  string
}

export interface SurveyQuestion {
  id:           string         // uuid, generated at creation
  type:         QuestionType
  prompt:       string
  exportLabel?: string
  required?:    boolean
  // open-ended specific
  clarify?:     boolean
  useAI?:       boolean
  // close-ended specific (radio, checkbox, dropdown)
  options?:     string[]
  // likert specific
  likertScale?: LikertScaleOption[]
  followUp?:    LikertFollowUp
}

// ── Psychographics ───────────────────────────────────────────

export interface PsychoQuestion {
  key:          string
  q:            string
  opts:         string[]
  exportLabel?: string
}

// ── Theme ────────────────────────────────────────────────────

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

// ── Study config ─────────────────────────────────────────────

export interface StudyConfig {
  greeting:           string

  // NPS (shown first)
  npsEnabled?:        boolean          // default true
  npsPrompt?:         string           // default 'How likely are you to recommend us...'
  npsLabel?:          string           // default 'NPS' — dashboard card + CSV header
  npsFollowUp?:       LikertFollowUp   // adaptive open-end after NPS

  // Experience rating (shown after NPS Q1)
  experienceEnabled?: boolean          // default true
  experienceRatingLabel?: string       // alias shown in analytics + CSV header (default: 'Experience Rating')
  ratingPrompt:       string
  ratingScale:        RatingOption[]
  experienceFollowUp?: LikertFollowUp  // adaptive open-end after experience rating
  ratingVariableId?:    string           // 'nps' | 'experience'
  ratingVariableLabel?: string           // display label for the primary variable

  // Sentiment-adapted open-ended Q1 (after NPS, before experience rating)
  promoterQ1?:        string  // legacy — kept for existing studies
  passiveQ1?:         string
  detractorQ1?:       string
  q1ExportLabel?:     string  // legacy

  // Legacy open-ended Q3/Q4 (still supported, shown before custom questions)
  q3:                 string
  q3Required?:        boolean
  q3ExportLabel?:     string
  q4:                 string
  q4Required?:        boolean
  q4ExportLabel?:     string

  // Custom questions (drag-ordered)
  questions?:         SurveyQuestion[]

  // Clarifiers (used by legacy Q1/Q3/Q4 and open custom questions)
  clarifiers:         StudyClarifiers
  useAIClarify?:      boolean

  // Psychographics
  psychographicBank:  PsychoQuestion[]
  psychoCount?:       number           // how many to randomly show per session (default 3)

  theme:              StudyTheme
}

// ── Study row ────────────────────────────────────────────────

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

// ── Survey payload (saved to DB) ─────────────────────────────

export type Sentiment = 'promoter' | 'passive' | 'detractor'

export interface SurveyPayload {
  agent:            string
  timestamp:        string
  npsRecommend:     { score: number; label: string }
  npsFollowUp?:     string                              // open-end after NPS
  experienceRating: { score: number; label: string; sentiment: Sentiment }
  experienceFollowUp?: string                           // open-end after experience rating
  openEnded:        { q1: string; q3: string; q4: string }
  customAnswers?:   Record<string, string | string[]>   // keyed by SurveyQuestion.id
  psychographics:   Record<string, string>
  demographics:     { age: string; gender: string; zip: string }
}

export interface SubmitResponseBody {
  study_guid:   string
  payload:      SurveyPayload
  duration_sec: number
}
