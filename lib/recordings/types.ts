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
  | 'draft'              // project being set up; no media attached yet (setup-before-media)
  | 'awaiting_media'     // setup confirmed; awaiting the "Add recording" upload
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

// ── Analysis attribution + intake (sql/118) ──────────────────────────────────

// An analyst from the analysis_org. member_id is set when the analyst is an app
// user (picked from the org roster), absent when the name was typed free-text.
export interface Analyst {
  name: string
  member_id?: string | null
}

// Meeting objectives — why this town hall is being analyzed. AI-proposed from the
// uploaded deck/briefs at setup, then editable. Also injected into the synthesis
// pass so the report answers what the client actually wanted to know.
export interface MeetingObjectives {
  summary: string
  questions: string[]        // specific "questions we want answered"
}

// Which uploaded document each pre-filled setup field came from. Empty for fields
// the user typed by hand. Keyed by the setup field name.
export interface SetupProvenance {
  agenda?: string            // source document filename
  panel?: string
  glossary?: string
  objectives?: string
}

export type ConfidentialityClass =
  | 'public'
  | 'internal'
  | 'client_confidential'
  | 'restricted'

// Analyst sign-off — set once a reviewer approves the report for distribution.
export interface Signoff {
  approved_by: string
  approved_by_member_id?: string | null
  approved_at: string        // ISO
  note?: string | null
}

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

  // Detected channel layout of the extracted audio (sql/122): 1=mono,
  // 2=true stereo → per-channel speaker separation (split-mic / RØDE).
  // NULL = not yet extracted. Set by lib/recordings/extract.ts.
  audio_channels: number | null

  // Diagnostic (sql/123): the live recorder reported it captured a 2-channel
  // split. Compare against `audio_channels` (what extract detected) to debug a
  // lost split — capture_stereo=true but audio_channels=1 means the two channels
  // arrived identical (e.g. browser AGC forced mono) and the guard collapsed them.
  capture_stereo: boolean | null

  // Optional names for stereo channels (sql/124), indexed by channel:
  // [leftName, rightName]. Report shows these instead of Mic 1·L / Mic 2·R.
  channel_labels: string[] | null
  // Optional map of diarized speaker label ("Speaker 0" / "S1") → human name
  // (sql/128), for the mono voice-cluster case. Applied in the transcript view.
  speaker_names: Record<string, string> | null

  // Draft report (sql/125): TRUE = unreviewed AI draft → DRAFT watermark +
  // pending-review banner in the report and exports. Cleared on human review.
  draft: boolean

  coverage_report: CoverageReport | null
  analysis_summary: RecordingAnalysisSummary | null

  // Meeting-tool layer (sql/097). NULL meeting_profile = legacy Q&A behavior.
  meeting_profile: MeetingProfile | null
  phase_map: PhaseMap | null
  presentation_outline: PresentationOutline | null
  proceedings_summary: ProceedingsSummary | null

  // Live in-person capture (sql/120). Set only for live-recorded meetings:
  // the raw real-time ASR transcript + the last rolling summary. Convenience
  // layer — the authoritative transcript is recording_transcripts.segments.
  live_transcript: string | null
  live_summary: { headline: string; summary: string; topics: string[]; open_questions: string[]; decisions: string[] } | null

  // Entity-spelling normalization (sql/100). Auto-extracted at the gate, then
  // user-corrected. Feeds the polish glossary + the "Corrected" transcript view.
  entity_map: EntityMap | null

  // Brand-entity convergence (sql/103). A brand tag (mirrors datasets.brand_tag —
  // the derived dataset inherits it) and/or a linked agent whose curated entity
  // catalog seeds this meeting's spelling correction. Both nullable.
  brand_tag: string | null
  underlying_agent_id: string | null

  // Analysis attribution + intake (sql/118). analysis_org defaults to 'Datanautix'.
  analysis_org: string
  analysts: Analyst[]
  objectives: MeetingObjectives | null
  setup_provenance: SetupProvenance
  confidentiality_class: ConfidentialityClass
  signoff: Signoff | null
  // The config version_number whose snapshot produced the current analysis_summary.
  analyzed_config_version: number | null

  share_token: string | null
  share_enabled: boolean
  share_expires_at: string | null
  share_password_hash: string | null
  // §4.6 — public link shows verbatim Q&A when true, polished (default) when false.
  share_verbatim: boolean

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
  file_role: 'media' | 'slides' | 'document'  // sql/097 + sql/119 — 'slides'/'document' skip the ffmpeg pipeline; 'document' = brief/reference
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
  speaker?: string       // 'S1', 'S2', ... — voice-cluster (mono) or per-channel (stereo)
  channel?: number       // 0-indexed source channel/mic when audio was true stereo (0=Left, 1=Right)
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
  // Human-edited versions (§3.5d). A reviewer's hand-correction of the AI text;
  // when present these are the version "of record for display" (the third layer,
  // precedence edited → polished → verbatim). The AI polished + verbatim are
  // ALWAYS retained so an edit can be reverted — nothing is destroyed.
  edited_question?: string | null
  edited_answer?: string | null
  edited_at?: string | null
  // Audit trail for the human edit: who made it (user id) and their display name
  // at edit time. Set alongside edited_at; cleared when the edit is fully reverted.
  edited_by?: string | null
  edited_by_name?: string | null
  // Whether the question pertains to the presentation ('in_scope') or falls
  // outside it ('out_of_scope'). Set by the analyzer (when a presentation exists)
  // and/or a human reviewer. Absent/null = unclassified. Only meaningful for
  // meetings that had a presentation phase.
  presentation_scope?: 'in_scope' | 'out_of_scope' | null
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

// ── Entity-spelling normalization (sql/100) ──────────────────────────────────
//
// Auto-extracted from the transcript after transcription, then reviewed at the
// gate. Each entry clusters the ASR's spelling/phonetic variants under one
// canonical spelling. Powers: (a) the polish-pass glossary (so the polished Q&A
// uses correct spellings), and (b) a deterministic "Corrected" transcript view
// (variants → canonical). The raw ASR transcript is never mutated.

export type EntityType = 'person' | 'place' | 'org' | 'project' | 'term'

export interface EntityMapEntry {
  canonical: string        // the correct spelling (best-guess until the user edits it)
  variants: string[]       // distinct spellings seen in the transcript that map to it
  type: EntityType
  mentions: number         // total occurrences across variants (for sort/relevance)
}

export interface EntityMap {
  entities: EntityMapEntry[]
  extracted_at: string     // ISO — when the auto-extraction ran
  reviewed_at?: string | null   // ISO — set once the user confirms/edits at the gate
}

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

// ── Config version history (sql/118) ─────────────────────────────────────────
//
// A point-in-time snapshot of the project configuration. One row is written on
// every analysis run (source='analysis') and whenever the user clicks "Save
// version" (source='manual'). The recording's analyzed_config_version stamps
// which snapshot produced the live analysis_summary, so any deliverable traces
// back to the exact config that made it.

// The subset of the recording config that's captured in a version snapshot.
// Excludes pipeline state, costs, and share settings (not part of "the config").
export interface RecordingConfigSnapshot {
  name: string
  session_type: SessionType
  meeting_date: string | null
  location: string | null
  language: string
  setup_inputs: SetupInputs | Record<string, unknown>
  meeting_profile: MeetingProfile | null
  presentation_outline: PresentationOutline | null
  brand_tag: string | null
  underlying_agent_id: string | null
  analysis_org: string
  analysts: Analyst[]
  objectives: MeetingObjectives | null
  confidentiality_class: ConfidentialityClass
}

export interface RecordingConfigVersionRow {
  id: string
  recording_id: string
  org_id: string
  version_number: number
  snapshot: RecordingConfigSnapshot
  source: 'manual' | 'analysis'
  change_note: string | null
  created_by: string | null
  created_at: string
}
