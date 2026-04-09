// ============================================================
// SENTIMETRX -- Shared Types
// ============================================================

import type { StudyType } from './surveyBlueprints'
import type { Industry } from './industryDefaults'

export type ClientPlan = 'trial' | 'active' | 'suspended'
export interface OrgFeatures {
  analyze?: boolean
  primaryIndustries?: Industry[]
}
// -- Likert / rating scale ------------------------------------

export interface RatingOption {
  score:  number
  emoji:  string
  label:  string
}

// Adaptive open-end follow-up attached to any Likert question
export interface LikertFollowUp {
  enabled:      boolean
  mode:         'shared' | 'per-response'  // shared = one prompt for all; per-response = unique per score
  exportLabel?: string                      // label for the verbatim in analytics/CSV exports
  // shared mode
  sharedPrompt: string
  shareClarify: boolean
  shareAI:      boolean
  // per-response mode -- keyed by score value (1-5 etc.)
  perResponse:  Record<string, {
    prompt:    string
    clarify:   boolean
    useAI:     boolean
  }>
}

// -- Custom survey questions -----------------------------------

export type QuestionType =
  | 'open'
  | 'radio'
  | 'checkbox'
  | 'dropdown'
  | 'likert'
  | 'date'
  | 'rating'   // numeric scale with fixed min/max (e.g. 1-5, 1-7, 0-10)
  | 'numeric'  // free numeric entry (age, spend, count)
  | 'hidden'   // hidden field populated via URL params (not shown to respondent)

export interface LikertScaleOption {
  score:  number
  emoji?: string
  label:  string
}

// Keyword-based follow-on trigger for open-ended questions (from Question Bank)
export interface KeywordTrigger {
  priority:   number
  keywords:   string[]
  follow_on:  string
}

export interface SurveyQuestion {
  id:           string         // uuid, generated at creation
  type:         QuestionType
  prompt:       string
  exportLabel?: string
  required?:    boolean
  // open-ended specific
  clarify?:     boolean          // enable keyword-based clarifiers
  useAI?:       boolean          // enable AI-based clarifiers
  keywordTriggers?:  KeywordTrigger[]   // keyword follow-on clusters (from Question Bank)
  defaultFollowOn?:  string             // default follow-on when no keywords match
  triggerType?:      string             // trigger category (e.g. 'dissatisfaction_probe')
  // close-ended specific (radio, checkbox, dropdown)
  options?:     string[]
  // likert specific
  likertScale?: LikertScaleOption[]
  followUp?:    LikertFollowUp
  // date specific
  dateFormat?:  'date' | 'datetime'   // default 'date'
  dateMin?:     string                // ISO date string e.g. '2020-01-01'
  dateMax?:     string                // ISO date string e.g. '2030-12-31'
  // rating scale specific (numeric scale with fixed min/max)
  ratingMin?:   number                // default 1
  ratingMax?:   number                // default 5
  // numeric input -- no extra fields needed; stores raw number as string
  // hidden field -- URL param key that maps to this field
  paramKey?:    string                // URL parameter name (e.g. 'recipient_id', 'source')
  // flow placement
  conversationPosition?: boolean      // if true, show after Q4 in conversation phase, not custom-Q phase
  // enabled/disabled
  enabled?: boolean                   // if false, question is skipped in survey; default true
}

// -- Psychographics -------------------------------------------

export interface PsychoQuestion {
  key:          string
  q:            string
  opts:         string[]
  exportLabel?: string
}

// -- Theme ----------------------------------------------------

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

// -- Rating question type -------------------------------------
// Controls default prompt, emoji scale, follow-up text and dashboard label
// for the experience_rating opening item.
export type RatingType =
  | 'experience'   // overall experience (default)
  | 'familiarity'  // brand / product familiarity
  | 'satisfaction' // CSAT
  | 'value'        // value for money / time
  | 'quality'      // product / service quality
  | 'ease'         // effort / ease (CES)
  | 'intent'       // return / repurchase intent
  | 'perception'   // brand impression / awareness

// -- Opening flow ---------------------------------------------

export interface OpeningFlowItem {
  id:           string
  type:         'experience_rating' | 'nps' | 'open_end'
  // open_end only:
  prompt?:      string
  exportLabel?: string
  clarify?:     boolean
  useAI?:       boolean
}

// -- Study config ---------------------------------------------

export interface StudyConfig {
  greeting:           string

  // NPS (shown first)
  npsEnabled?:        boolean          // default true
  npsPrompt?:         string           // default 'How likely are you to recommend us...'
  npsLabel?:          string           // default 'NPS' -- dashboard card + CSV header
  npsFollowUp?:       LikertFollowUp   // adaptive open-end after NPS

  // Experience rating (shown after NPS Q1)
  experienceEnabled?: boolean          // default true
  ratingType?:        RatingType       // controls default prompt/scale/follow-ups; default 'experience'
  experienceRatingLabel?: string       // alias shown in analytics + CSV header (default: 'Experience Rating')
  ratingPrompt:       string
  ratingScale:        RatingOption[]
  experienceFollowUp?: LikertFollowUp  // adaptive open-end after experience rating
  ratingVariableId?:    string           // 'nps' | 'experience'
  ratingVariableLabel?: string           // display label for the primary variable

  // Sentiment-adapted open-ended Q1 (after NPS, before experience rating)
  promoterQ1?:        string  // legacy -- kept for existing studies
  passiveQ1?:         string
  detractorQ1?:       string
  q1ExportLabel?:     string  // legacy

  // Legacy open-ended Q3/Q4 (still supported, shown before custom questions)
  q3:                 string
  q3Required?:        boolean
  q3ExportLabel?:     string
  q3Clarify?:         boolean   // enable clarifier follow-up for Q3
  q3Enabled?:         boolean   // default true — set false to skip Q3 entirely
  q4:                 string
  q4Required?:        boolean
  q4ExportLabel?:     string
  q4Clarify?:         boolean   // enable clarifier follow-up for Q4
  q4Enabled?:         boolean   // default true — set false to skip Q4 entirely

  // Opening flow (drag-ordered): absent = legacy npsEnabled/experienceEnabled cascade
  openingFlow?:       OpeningFlowItem[]

  // Custom questions (drag-ordered)
  questions?:         SurveyQuestion[]

  // Clarifiers (used by legacy Q1/Q3/Q4 and open custom questions)
  clarifiers:         StudyClarifiers
  useAIClarify?:      boolean
  maxClarifierCount?: number           // max times a clarifier fires per session (default unlimited)

  // Response control
  allowMultipleResponses?: boolean   // default true — multiple responses allowed; set false to limit to one per device

  // Psychographics
  psychographicBank:  PsychoQuestion[]
  psychoCount?:       number           // how many to randomly show per session (default 3)
  customQCount?:      number           // how many custom questions to show per session (default: all)
  industry?:          string           // industry key -- stored in config so it persists via JSONB
  otherIndustry?:     string           // free-text when industry === 'other'

  // Study type and blueprint metadata
  studyType?:         StudyType        // e.g. 'satisfaction_experience', 'awareness_perception'
  templateLabel?:     string           // attribution string: "Sentimetrx [Type] Template v1.0"

  theme:              StudyTheme

  // Branding
  brandingLabel?:     string           // default 'DATANAUTIX'; max 15 chars; empty string = no branding
  showBranding?:      boolean          // default true — show "by <label>" on survey hero

  // Input mode
  confirmBeforeRecord?: boolean        // default false (auto-record on tap); true = require confirm button for radio/likert/rating

  // Closing message — shown after all questions are complete
  closingMessage?:  string   // bot's thank-you message (default: "Thank you so much -- {bot_name} really appreciates...")
  closingCard?:     string   // card subtitle text (default: "Your responses have been saved. Thank you for your time.")

  // Question redirect — when respondent asks a question in a clarifier response, redirect them
  questionRedirect?: {
    enabled:  boolean
    message:  string   // e.g. "Great question! I don't have the answer right now, but you can visit"
    linkText: string   // e.g. "our website"
    linkUrl:  string   // e.g. "https://example.com/faq"
  }

  // Section transition messages (shown between survey sections)
  sectionTransitions?: {
    customQuestions?:  { enabled: boolean; text: string }
    psychographics?:   { enabled: boolean; text: string }
    demographics?:     { enabled: boolean; text: string }
  }

  // Accessibility
  surveyFontSize?:    number           // base font size in px for survey widget (default 18)

  // Demographics
  demoFields?:        DemoField[]      // configurable demographic questions (default: age, gender, zip)
}

// Demographics field config
export interface DemoField {
  key:       string
  label:     string
  type:      'select' | 'text'
  options?:  [string, string][]      // [value, displayLabel] pairs for select fields
  enabled:   boolean
}

// Default demographics bank — all available demographic fields
export var DEMO_BANK: DemoField[] = [
  { key: 'age',        label: 'Age Range',        type: 'select', enabled: true,  options: [['18-24','18-24'],['25-34','25-34'],['35-44','35-44'],['45-54','45-54'],['55-64','55-64'],['65+','65 or over']] },
  { key: 'gender',     label: 'Gender',           type: 'select', enabled: true,  options: [['male','Male'],['female','Female'],['nonbinary','Non-binary'],['other','Prefer to self-describe'],['prefer_not','Prefer not to say']] },
  { key: 'zip',        label: 'ZIP / Postal Code', type: 'text',  enabled: true  },
  { key: 'income',     label: 'Household Income', type: 'select', enabled: false, options: [['under_25k','Under $25,000'],['25k_50k','$25,000–$49,999'],['50k_75k','$50,000–$74,999'],['75k_100k','$75,000–$99,999'],['100k_150k','$100,000–$149,999'],['150k_plus','$150,000 or more'],['prefer_not','Prefer not to say']] },
  { key: 'education',  label: 'Education Level',  type: 'select', enabled: false, options: [['high_school','High school or less'],['some_college','Some college'],['associates','Associate degree'],['bachelors','Bachelor\'s degree'],['masters','Master\'s degree'],['doctoral','Doctoral or professional'],['prefer_not','Prefer not to say']] },
  { key: 'ethnicity',  label: 'Ethnicity',        type: 'select', enabled: false, options: [['white','White'],['black','Black or African American'],['hispanic','Hispanic or Latino'],['asian','Asian'],['native','Native American or Alaska Native'],['pacific','Native Hawaiian or Pacific Islander'],['multi','Two or more races'],['other','Other'],['prefer_not','Prefer not to say']] },
  { key: 'employment', label: 'Employment Status', type: 'select', enabled: false, options: [['full_time','Full-time'],['part_time','Part-time'],['self_employed','Self-employed'],['student','Student'],['retired','Retired'],['unemployed','Not employed'],['prefer_not','Prefer not to say']] },
  { key: 'marital',    label: 'Marital Status',   type: 'select', enabled: false, options: [['single','Single'],['married','Married'],['domestic','Domestic partnership'],['divorced','Divorced'],['widowed','Widowed'],['prefer_not','Prefer not to say']] },
  { key: 'household',  label: 'Household Size',   type: 'select', enabled: false, options: [['1','1 person'],['2','2 people'],['3','3 people'],['4','4 people'],['5_plus','5 or more']] },
  { key: 'state',      label: 'State / Region',   type: 'text',   enabled: false },
]

// -- Study row ------------------------------------------------

export interface Study {
  id:          string
  guid:        string
  slug?:       string           // custom URL slug — e.g. 'acme-feedback-2026'
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

// -- Survey payload (saved to DB) -----------------------------

export type Sentiment = 'positive' | 'neutral' | 'negative'

export interface SurveyPayload {
  agent:            string
  timestamp:        string
  npsRecommend:     { score: number; label: string }
  experienceRating: { score: number; label: string; sentiment: Sentiment }
  openEnded:        { q1: string; q2: string; q3: string; q4: string }
  customAnswers?:   Record<string, string | string[]>   // keyed by SurveyQuestion.id
  psychographics:    Record<string, string>
  demographics:      Record<string, string>
  conversationLog?:  Array<{ who: 'bot' | 'user'; text: string; ai?: boolean }>
}

export interface SubmitResponseBody {
  study_guid:   string
  payload:      Partial<SurveyPayload>
  duration_sec: number
  session_id?:  string
  status?:      'incomplete' | 'complete'
}
