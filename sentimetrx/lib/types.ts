// ============================================================
// SENTIMETRX — Shared Types
// ============================================================

export type ClientPlan = 'trial' | 'active' | 'suspended'
export type UserRole   = 'platform_admin' | 'owner' | 'member'
export type StudyStatus = 'draft' | 'active' | 'paused' | 'closed'
export type Sentiment   = 'promoter' | 'passive' | 'detractor'

export interface Client {
  id:         string
  name:       string
  slug:       string
  plan:       ClientPlan
  created_at: string
}

export interface User {
  id:         string
  client_id:  string | null
  email:      string
  full_name:  string | null
  role:       UserRole
  created_at: string
}

export interface RatingOption {
  emoji: string
  label: string
  score: number  // 1–5
}

export interface PsychoQuestion {
  key:         string
  q:           string
  opts:        string[]
  exportLabel?: string
}

export interface StudyTheme {
  primaryColor:      string   // e.g. "#1a7a4a"
  headerGradient:    string   // e.g. "linear-gradient(135deg,#1a7a4a,#0d4a2a)"
  backgroundColor:   string   // e.g. "#0a1628"
  accentColor:       string   // e.g. "#4ade80"
  botAvatarGradient: string
}

export interface StudyClarifiers {
  [keyword: string]: string   // keyword → clarifying question
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
  q3ExportLabel?:    string
  q4:                string
  q4ExportLabel?:    string
  clarifiers:        StudyClarifiers
  psychographicBank: PsychoQuestion[]
  theme:             StudyTheme
}

export interface Study {
  id:         string
  guid:       string
  client_id:  string
  created_by: string | null
  name:       string
  bot_name:   string
  bot_emoji:  string
  status:     StudyStatus
  config:     StudyConfig
  created_at: string
  updated_at: string
}

// What the survey widget sends on completion
export interface SurveyPayload {
  agent:            string
  timestamp:        string
  experienceRating: { score: number; label: string; sentiment: Sentiment }
  npsRecommend:     { score: number; label: string }
  openEnded:        { q1: string; q3: string; q4: string }
  psychographics:   Record<string, string>
  demographics:     { age?: string; gender?: string; zip?: string }
}

// What the POST /api/respond endpoint receives
export interface SubmitResponseBody {
  study_guid:   string
  payload:      SurveyPayload
  duration_sec?: number
}

// Stored response row
export interface Response {
  id:               string
  study_id:         string
  study_guid:       string
  client_id:        string
  sentiment:        Sentiment | null
  experience_score: number | null
  nps_score:        number | null
  payload:          SurveyPayload
  completed_at:     string
  duration_sec:     number | null
  ip_hash:          string | null
}
