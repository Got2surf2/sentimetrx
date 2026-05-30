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
  created_at: string
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

export interface QaPairPayload {
  question: string
  asker_name?: string | null
  answer: string
  panelist_name?: string | null
  question_typology: QuestionTypology
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
