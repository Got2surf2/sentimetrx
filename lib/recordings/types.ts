// lib/recordings/types.ts
//
// Shared types for the recordings module. Mirror the SQL shapes in
// sql/090_recordings.sql so route handlers, queue workers, and the report UI
// share one source of truth. Persist-shapes (DB rows) and DTO shapes (API
// requests/responses) live together — splitting them is premature.

export type SessionType =
  | 'qa'
  | 'focus_group'
  | 'general_meeting'
  | 'interview'
  | 'lecture'

export type AsrStrategy = 'auto' | 'whisper' | 'deepgram' | 'hybrid'

export type AsrVendor = 'whisper' | 'deepgram' | 'hybrid'

export type RecordingStatus =
  | 'uploading'
  | 'queued'
  | 'extracting'
  | 'transcribing'
  | 'transcribed'        // pipeline paused after ASR; awaiting user-triggered analysis (Gate 1)
  | 'analyzing'
  | 'rendering'
  | 'complete'
  | 'failed'
  | 'cancelled'

// ── Setup inputs per session_type ────────────────────────────────────────────

export interface PanelMember { name: string; role?: string }

export interface QaSetupInputs {
  panel: PanelMember[]
  agenda: string[]
  ground_truth_url?: string
  // Canonical spellings of names/places/terms in this meeting. Fed to the polish
  // pass (§3.5 pass 4) to normalize phonetic ASR mis-hearings to the right name.
  glossary?: string[]
}

export interface FocusGroupSetupInputs {
  moderator: { name: string }
  participants: Array<{ id: string; demographics?: Record<string, unknown> }>
  discussion_guide: string[]
}

export interface GeneralMeetingSetupInputs {
  attendees: Array<{ name: string; role?: string }>
  agenda: string[]
  meeting_owner?: string
}

export interface InterviewSetupInputs {
  interviewer: { name: string }
  interviewees: Array<{ name: string }>
  discussion_guide: string[]
}

export interface LectureSetupInputs {
  speaker: { name: string; bio?: string }
  agenda: string[]
}

export type SetupInputs =
  | QaSetupInputs
  | FocusGroupSetupInputs
  | GeneralMeetingSetupInputs
  | InterviewSetupInputs
  | LectureSetupInputs

// ── DB rows ──────────────────────────────────────────────────────────────────

export interface RecordingRow {
  id: string
  org_id: string
  created_by: string
  dataset_id: string | null

  name: string
  session_type: SessionType
  meeting_date: string | null            // ISO date
  location: string | null
  language: string                        // BCP-47
  setup_inputs: SetupInputs | Record<string, unknown>

  asr_strategy: AsrStrategy
  asr_vendor_chosen: AsrVendor | null

  status: RecordingStatus
  error_message: string | null

  source_duration_sec: number | null
  source_size_bytes: number | null
  cost_cents: number

  coverage_report: CoverageReport | null
  analysis_summary: RecordingAnalysisSummary | null

  // Meeting-tool layer (sql/097). NULL meeting_profile = legacy Q&A behavior.
  meeting_profile: MeetingProfile | null
  phase_map: PhaseMap | null
  presentation_outline: PresentationOutline | null
  proceedings_summary: ProceedingsSummary | null

  share_token: string | null
  share_enabled: boolean
  share_expires_at: string | null
  share_password_hash: string | null

  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface RecordingFileRow {
  id: string
  recording_id: string
  org_id: string
  original_filename: string
  storage_path: string
  mime_type: string
  size_bytes: number
  duration_sec: number | null
  is_video: boolean
  audio_storage_path: string | null
  sort_order: number
  upload_status: 'pending' | 'uploaded' | 'extracted' | 'failed'
  file_role: 'media' | 'slides'      // sql/097 — 'slides' skips the ffmpeg pipeline
  created_at: string
}

// ── Meeting tool: profiles, phases, presentation (sql/097) ───────────────────

export type PhaseKind = 'presentation' | 'qa' | 'discussion' | 'public_comment' | 'decision'

// What analysis to run on a phase. v1 implements presentation_summary + qa_extraction;
// other kinds resolve to 'noop' (persisted, not analyzed).
export type PhaseAnalysis = 'presentation_summary' | 'qa_extraction' | 'noop'

export interface MeetingPhaseSpec {
  kind: PhaseKind
  label: string                       // user-facing, e.g. "Presentation", "Audience Q&A"
  analysis: PhaseAnalysis
  expected: boolean                   // steers phase detection
}

export type MeetingPresetId = 'town_hall_qa' | 'community_meeting'

export interface MeetingProfile {
  preset_id: MeetingPresetId
  phases: MeetingPhaseSpec[]          // ordered
  has_slides: boolean                 // user attached a deck for vision ingestion
}

export interface MeetingPhase {
  kind: PhaseKind
  label: string
  start_sec: number
  end_sec: number
  confidence?: number
}

export interface PhaseMap {
  phases: MeetingPhase[]              // contiguous, sorted, covering [0, duration]
  detected_at: string
  model: string
  edited_by_user: boolean
}

export interface SlideOutline {
  slide_number: number
  title: string | null
  key_points: string[]
  figures: Array<{ label: string; value: string }>   // stats/data read off the slide — verbatim
  presenter: string | null
  notes: string | null
}

export interface PresentationOutline {
  slides: SlideOutline[]
  source_filename: string
  page_count: number
  generated_at: string
  model: string
}

export interface ProceedingsAgendaItem {
  title: string
  presenter: string | null
  what_was_presented: string          // neutral, factual
  key_figures: Array<{ label: string; value: string }>
  slide_refs: number[]                // slide_number(s) this maps to
}

export interface ProceedingsSummary {
  overview: string                    // 2-4 neutral sentences
  items: ProceedingsAgendaItem[]
  generated_at: string
  model: string
}

export interface TranscriptSegment {
  start: number          // seconds
  end: number            // seconds
  speaker?: string       // 'S1', 'S2', ... when diarization present
  text: string
  confidence?: number    // 0..1
  source_file?: string   // original_filename — preserved across stitch for the audio viewer
  source_offset?: number // seconds-into-source_file at segment start
}

export interface RecordingTranscriptRow {
  id: string
  recording_id: string
  org_id: string
  vendor: AsrVendor
  language_detected: string | null
  segments: TranscriptSegment[]
  raw_response: unknown
  word_count: number | null
  duration_sec: number | null
  cost_cents: number
  completed_at: string
}

// ── Extraction payload shapes ────────────────────────────────────────────────

export type QuestionTypology = 'ask' | 'complaint' | 'commentary' | 'clarification'

export type QaSentiment = 'positive' | 'neutral' | 'negative' | 'mixed'

export interface QaPairPayload {
  question: string
  asker_name?: string | null
  answer: string
  panelist_name?: string | null
  question_typology: QuestionTypology
  // Tone of the panel's answer toward the asker's concern. Optional so old
  // extractions (pre-2026-06) parse without it; defaults to 'neutral' downstream.
  sentiment?: QaSentiment
  // Public-shareable cleaned versions of the verbatim question/answer, produced
  // by the polish pass (§3.5 pass 4). ADDITIVE — the verbatim question/answer
  // above stay the record of truth. Absent on older rows and when polish fails;
  // surfaces fall back to the verbatim text in that case.
  polished_question?: string | null
  polished_answer?: string | null
}

export interface QuotePayload {
  participant_id: string
  text: string
  sentiment: 'positive' | 'neutral' | 'negative'
  themes: string[]
}

export interface ActionItemPayload {
  description: string
  owner?: string | null
  due_date?: string | null   // ISO date
  related_agenda_item?: string | null
}

export type ExtractionUnitType = 'qa_pair' | 'quote' | 'action_item'

export type ExtractionPayload = QaPairPayload | QuotePayload | ActionItemPayload

export type FlagReason =
  | 'low_confidence'
  | 'curator_questioned'
  | 'cross_vendor_disagreement'
  | 'panel_to_panel_suspect'

export interface RecordingExtractionRow {
  id: string
  recording_id: string
  org_id: string
  unit_type: ExtractionUnitType
  topic: string | null
  payload: ExtractionPayload
  start_sec: number | null
  end_sec: number | null
  source_file: string | null
  confidence: number | null
  flagged_for_review: boolean
  flag_reason: FlagReason | null
  sort_order: number
  created_at: string
}

// Pre-insert shape — the analyzer returns these, the DB assigns id + created_at.
export type NewExtraction = Omit<
  RecordingExtractionRow,
  'id' | 'created_at' | 'org_id' | 'recording_id'
>

// ── Coverage report ──────────────────────────────────────────────────────────

export interface CoverageReport {
  per_topic: Array<{ topic: string; count: number; flagged: boolean }>
  per_minute_gaps: Array<{ start_sec: number; end_sec: number }>   // ≥5min stretches with 0 extractions
  confidence_histogram: Array<{ bucket: string; count: number }>   // e.g. '0.0-0.1', '0.1-0.2', ...
  flagged_count: number
  total_extractions: number
  computed_at: string                                              // ISO timestamp
}

// ── Analysis summary (meeting-level synthesis) ───────────────────────────────
//
// Produced by the third synthesis pass (lib/recordings/analyze.ts) after the
// curator settles topics. One object per recording, stored on
// recordings.analysis_summary (sql/094). Powers the deck's exec/theme/sentiment
// slides. Action items are NOT here — they live as action_item extraction rows;
// `decisions` live here because they're narrative, not owned units.

// A representative Q&A exchange for a topic — resolved in code from the actual
// extraction pairs (the model picks which pairs; the verbatim text + party
// names come from the data, never hallucinated).
export interface RecordingTopicExchange {
  question: string
  answer: string
  asker?: string | null
  panelist?: string | null
}

export interface RecordingTopicSummary {
  topic: string                  // must match a curated extraction `topic` string
  qa_count: number               // computed deterministically in code, not by the model
  summary: string                // synthesizing paragraph for this cluster
  sentiment: QaSentiment
  representative_exchanges: RecordingTopicExchange[] // 1-2 illustrative Q&A pairs, parties identified
}

export interface RecordingAnalysisSummary {
  executive_summary: string                          // 3-5 sentence overall narrative
  headline: string                                   // one-line takeaway for the title/exec slide
  sentiment_overall: QaSentiment
  sentiment_breakdown: { positive: number; neutral: number; negative: number; mixed: number } // counts across qa_pairs
  topic_summaries: RecordingTopicSummary[]
  decisions: Array<{ decision: string; topic?: string | null }>
  generated_at: string                               // ISO
  model: string                                      // e.g. 'claude-sonnet-4-6'
}
