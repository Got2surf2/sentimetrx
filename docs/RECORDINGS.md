# Sentimetrx — Recordings Spec

**Module:** `/app/analyze/new/recording/`, `/app/analyze/[datasetId]/report/`, `/app/api/recordings/*`, `/app/recordings/`, `lib/recordings/*`, `lib/asr/*`, `lib/featureFlags.ts`
**Storage:** Supabase Storage bucket `recordings` (chunked direct upload from browser, signed URLs for ASR vendors). Source audio + transcripts retained permanently by default; per-org retention policy configurable.
**External APIs:**
- **OpenAI Whisper** (`POST /v1/audio/transcriptions`, model `whisper-1`) — transcription, multilingual-strong, no diarization
- **Deepgram Nova-3** (batch async API) — transcription + diarization, English-strong
- **ffmpeg** (serverless via `@vercel/og`-style invocation or Vercel Sandbox `<TBD>`) — video → audio extraction, multi-file stitch
- **Anthropic Claude** (via `callAI`) — analytical extraction pass, model selected by session type
- **Resend** — completion notification email
- **Playwright headless** (via existing test infrastructure or `@sparticuz/chromium` on Vercel) — HTML report → PDF export

**Job runner:** Vercel Queues for the multi-step async pipeline.
**ffmpeg runtime:** Vercel Sandbox (GA Jan 2026) for audio extraction and multi-file stitching.

**Feature gate:** `recording` in the generic `org_features` / `user_features` tables (this spec also defines that gating substrate — recording is its first consumer).

> **Spec scope:** complete enough to rebuild the module from scratch. Includes
> full DDL, every API contract, ASR vendor routing logic, the analytical prompt
> per session type, report layout, monitoring surfaces, env vars, and open
> decisions. Source of truth is the code — this spec is the design intent as of
> 2026-05-30 (pre-build) and should be refreshed when v1 lands.

---

## 1. Overview

The Recordings module lets an analyst drop one or more audio/video files of a meeting and walk away — the system extracts audio (if video), stitches multi-file recordings, transcribes (via Whisper, Deepgram, or both), runs a session-type-specific analytical pass, and produces a structured report + standard `/analyze` surfaces.

**v1 session types:** Q&A only (carries the NOWOCATS Meeting #1 pilot pattern into the product). Focus group / general meeting / interview deferred to later versions — the vendor and pipeline substrate from v1 make those incremental additions, not new builds.

**Target turnaround:** same-evening. Typical 60-min meeting → report ready in ~30-60 min from upload-complete. Notification via Resend when done.

**Output:**
1. A standard `datasets` row (`source='recording'`) — the extracted Q&A pairs (or future-type structured units) become rows in `dataset_rows_flat` and are queryable via the existing `/analyze` surfaces (themes, entities, search, stats, TextMine).
2. A type-specific HTML report at `/analyze/[datasetId]/report` — exportable to PDF (Playwright print) and XLSX (structured pairs).
3. Optional: addable to a `collections` row for cross-channel rollups (in-person + agent + survey themes for the same engagement).

---

## 2. Data Model

### 2.1 `recordings` — one per uploaded meeting

Each recording row owns the source files, transcription job state, the link to its derived dataset, and the public-share state.

```sql
CREATE TABLE recordings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by            UUID NOT NULL REFERENCES auth.users(id),
  dataset_id            UUID REFERENCES datasets(id) ON DELETE SET NULL, -- set after analysis pass completes
  name                  TEXT NOT NULL,
  session_type          TEXT NOT NULL CHECK (session_type IN ('qa', 'focus_group', 'general_meeting', 'interview', 'lecture')),
  meeting_date          DATE,
  location              TEXT,
  language              TEXT NOT NULL DEFAULT 'en',         -- BCP-47, e.g. 'en', 'es', 'en-es' for code-switching
  setup_inputs          JSONB NOT NULL DEFAULT '{}',         -- per-type form (panel roster, agenda, etc.)
  asr_strategy          TEXT NOT NULL CHECK (asr_strategy IN ('auto', 'whisper', 'deepgram', 'hybrid')),
  asr_vendor_chosen     TEXT,                                -- resolved at runtime: 'whisper' | 'deepgram' | 'hybrid'
  status                TEXT NOT NULL DEFAULT 'uploading'
                          CHECK (status IN ('uploading', 'queued', 'extracting', 'transcribing',
                                            'analyzing', 'rendering', 'complete', 'failed', 'cancelled')),
  error_message         TEXT,
  source_duration_sec   INT,                                 -- total audio length across all files
  source_size_bytes     BIGINT,                              -- total bytes across all files
  cost_cents            INT DEFAULT 0,                       -- accumulated cost (ASR + Claude)
  -- Public sharing (v1, designed for the "send link to principals at end of meeting" workflow)
  share_token           TEXT UNIQUE,                         -- random 24-char URL-safe token; NULL until enabled
  share_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  share_expires_at      TIMESTAMPTZ,                         -- NULL = no expiry
  share_password_hash   TEXT,                                -- optional bcrypt hash; NULL = no password
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ,                         -- when processing began (post-upload)
  completed_at          TIMESTAMPTZ
);

CREATE INDEX recordings_org_idx        ON recordings (org_id, created_at DESC);
CREATE INDEX recordings_dataset_idx    ON recordings (dataset_id) WHERE dataset_id IS NOT NULL;
CREATE INDEX recordings_status_active  ON recordings (status) WHERE status NOT IN ('complete', 'failed', 'cancelled');

ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recordings_org_read" ON recordings
  FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
```

**setup_inputs schemas by session_type:**

| session_type | shape |
|---|---|
| `qa` | `{ panel: [{name, role}], agenda: [string], ground_truth_url?: string }` |
| `focus_group` | `{ moderator: {name}, participants: [{id, demographics?}], discussion_guide: [string] }` |
| `general_meeting` | `{ attendees: [{name, role?}], agenda: [string], meeting_owner?: string }` |
| `interview` | `{ interviewer: {name}, interviewees: [{name}], discussion_guide: [string] }` |
| `lecture` | `{ speaker: {name, bio?}, agenda: [string] }` |

### 2.2 `recording_files` — one row per uploaded source file

Multi-file uploads (e.g. NOWOCATS' 5 GoPro clips) are stitched in pipeline order before transcription. Order defaults to filename ASCII sort; user can override in the wizard.

```sql
CREATE TABLE recording_files (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id          UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  original_filename     TEXT NOT NULL,
  storage_path          TEXT NOT NULL,                  -- bucket-relative: <org_id>/<recording_id>/<filename>
  mime_type             TEXT NOT NULL,                  -- video/mp4, audio/m4a, audio/wav, etc.
  size_bytes            BIGINT NOT NULL,
  duration_sec          INT,                            -- populated post-extract
  is_video              BOOLEAN NOT NULL,               -- if true, audio_storage_path is the extracted audio
  audio_storage_path    TEXT,                           -- ffmpeg-extracted audio (null if source was already audio)
  sort_order            INT NOT NULL DEFAULT 0,         -- 0-indexed pipeline order
  upload_status         TEXT NOT NULL DEFAULT 'pending' -- pending | uploaded | extracted | failed
                          CHECK (upload_status IN ('pending', 'uploaded', 'extracted', 'failed')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recording_files_recording_idx ON recording_files (recording_id, sort_order);

ALTER TABLE recording_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recording_files_org_read" ON recording_files
  FOR SELECT USING (
    recording_id IN (SELECT id FROM recordings WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid()))
  );
```

### 2.3 `recording_transcripts` — one row per recording (post-stitch)

Stores the full transcript with timestamps and (when diarization is available) speaker tags. Per-segment rows would explode the table for long meetings; we store the transcript as JSONB segments inside one row. The HTML report and the analytical pass both read this row.

```sql
CREATE TABLE recording_transcripts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id          UUID NOT NULL UNIQUE REFERENCES recordings(id) ON DELETE CASCADE,
  vendor                TEXT NOT NULL CHECK (vendor IN ('whisper', 'deepgram', 'hybrid')),
  language_detected     TEXT,
  segments              JSONB NOT NULL,                  -- [{start, end, speaker?, text, confidence?}]
  raw_response          JSONB,                           -- vendor's raw response (for debugging / re-analysis)
  word_count            INT,
  duration_sec          INT,
  cost_cents            INT NOT NULL DEFAULT 0,
  completed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recording_transcripts_recording_idx ON recording_transcripts (recording_id);

ALTER TABLE recording_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recording_transcripts_org_read" ON recording_transcripts
  FOR SELECT USING (
    recording_id IN (SELECT id FROM recordings WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid()))
  );
```

**`segments` JSONB shape:**

```json
[
  { "start": 0.0,   "end": 4.3,   "speaker": "S1", "text": "Welcome everyone...", "confidence": 0.97 },
  { "start": 4.3,   "end": 12.1,  "speaker": "S2", "text": "Thank you for...",    "confidence": 0.95 },
  { "start": 12.1,  "end": 18.7,  "speaker": "S1", "text": "Our first agenda...", "confidence": 0.96, "source_file": "GX010114.MP4", "source_offset": 12.1 }
]
```

`source_file` + `source_offset` preserve the per-clip mapping so the future audio-playback viewer ([[project-pulseiq-audio-transcript-playback]]) can highlight the right segment in the right clip.

### 2.4 `recording_extractions` — structured output from the analytical pass

The analytical Claude pass produces structured units (Q&A pairs for `qa`, themed quotes for `focus_group`, action items for `general_meeting`, etc.). Each unit becomes one row, AND each unit is mirrored into `dataset_rows_flat` so the standard `/analyze` surfaces work.

```sql
CREATE TABLE recording_extractions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id          UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  unit_type             TEXT NOT NULL,                 -- 'qa_pair' | 'quote' | 'action_item' | etc.
  topic                 TEXT,                          -- section / theme name
  payload               JSONB NOT NULL,                -- type-specific structure (see below)
  start_sec             INT,                           -- pointer back to transcript timeline
  end_sec               INT,
  source_file           TEXT,                          -- which input clip this came from
  confidence            NUMERIC(3,2),                  -- 0.00 - 1.00, model-self-reported or computed
  flagged_for_review    BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason           TEXT,                          -- e.g. 'low_confidence', 'cross_vendor_disagreement', 'panel_to_panel_suspect'
  sort_order            INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recording_extractions_recording_idx ON recording_extractions (recording_id, sort_order);
CREATE INDEX recording_extractions_topic_idx     ON recording_extractions (recording_id, topic);
CREATE INDEX recording_extractions_flagged_idx   ON recording_extractions (recording_id) WHERE flagged_for_review;

ALTER TABLE recording_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recording_extractions_org_read" ON recording_extractions
  FOR SELECT USING (
    recording_id IN (SELECT id FROM recordings WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid()))
  );
```

**`payload` shapes by `unit_type`:**

```ts
// qa_pair (session_type='qa')
{
  question: string,
  asker_name?: string,        // if identifiable from setup inputs or self-introduction
  answer: string,
  panelist_name?: string,
  question_typology: 'ask' | 'complaint' | 'commentary' | 'clarification',  // only 'ask' surfaces in main report
}

// quote (session_type='focus_group')  -- v2
{
  participant_id: string,     // P1, P2, ... from setup roster
  text: string,
  sentiment: 'positive' | 'neutral' | 'negative',
  themes: string[],
}

// action_item (session_type='general_meeting')  -- v2
{
  description: string,
  owner?: string,
  due_date?: string,          // ISO date
  related_agenda_item?: string,
}
```

### 2.5 `org_features` + `user_features` — generic feature gating

The recording module is the first consumer; the gating substrate is generic and reused for any future expensive feature.

```sql
CREATE TABLE org_features (
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature         TEXT NOT NULL,                          -- 'recording', 'dataforseo_bulk', 'deck_generation', ...
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  quota_per_month INT,                                    -- NULL = unlimited
  enabled_at      TIMESTAMPTZ DEFAULT now(),
  enabled_by      UUID REFERENCES auth.users(id),
  PRIMARY KEY (org_id, feature)
);

CREATE TABLE user_features (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature         TEXT NOT NULL,
  enabled         BOOLEAN,                                -- NULL = inherit from org
  quota_per_month INT,                                    -- NULL = inherit from org
  updated_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, feature)
);

ALTER TABLE org_features  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_features_read"  ON org_features
  FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "user_features_self" ON user_features
  FOR SELECT USING (user_id = auth.uid());
```

**`lib/featureFlags.ts`** exposes:

```ts
export async function assertFeatureAllowed(
  feature: string,
  orgId: string,
  userId: string,
  opts?: { unitsConsumed?: number }
): Promise<{ allowed: true } | { allowed: false; reason: 'disabled' | 'quota_exceeded' }>
```

Called from `POST /api/recordings`, with a usage log entry written regardless of outcome (audit trail).

### 2.6 `dataset_rows_flat` mirroring

When the analytical pass completes, each `recording_extractions` row is mirrored into `dataset_rows_flat` against the recording's `dataset_id`. This is what makes the recording show up in `/analyze` with themes/entities/search/stats working natively. The mirror is structural — column mapping per `unit_type`:

| unit_type | dataset_rows_flat row content |
|---|---|
| `qa_pair` | `{ response_text: payload.question + ' → ' + payload.answer, _topic: topic, _asker: payload.asker_name, _typology: payload.question_typology, _start_sec: start_sec }` |
| `quote` | `{ response_text: payload.text, _participant: payload.participant_id, _sentiment: payload.sentiment, _topic: topic, _start_sec: start_sec }` |
| `action_item` | `{ response_text: payload.description, _owner: payload.owner, _due: payload.due_date, _topic: payload.related_agenda_item }` |

The schema config on the virtual recording dataset declares the appropriate `primaryTextField` (`response_text`) so TextMine and theme mining work without configuration.

### 2.7 Collections compatibility

A recording dataset is a normal `datasets` row with `source='recording'`. It is added to a `collections` row the same way any other dataset is. This spec adds the missing `POST /api/collections/[id]/members` endpoint (see § 4.4) so the analyst can grow an existing collection by one click after the recording report is ready.

---

## 3. Pipeline

### 3.1 Stage diagram

```
┌────────────┐   ┌─────────┐   ┌──────────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  Upload    │ → │ Extract │ → │  Transcribe  │ → │ Analyze  │ → │ Mirror   │ → │ Render   │
│ (chunked,  │   │ (ffmpeg │   │ (Whisper /   │   │ (Claude, │   │ to       │   │ (HTML +  │
│ direct to  │   │ video → │   │  Deepgram /  │   │ per-type │   │ dataset_ │   │ optional │
│ Storage)   │   │ audio,  │   │  hybrid)     │   │ prompt)  │   │ rows_    │   │ PDF /    │
│            │   │ stitch) │   │              │   │          │   │ flat)    │   │ XLSX)    │
└────────────┘   └─────────┘   └──────────────┘   └──────────┘   └──────────┘   └──────────┘
   client            queue          queue            queue           queue           queue
                                                                                       │
                                                                                       ▼
                                                                                   ┌─────────┐
                                                                                   │ Resend  │
                                                                                   │ email   │
                                                                                   └─────────┘
```

Each post-upload stage is a queue job. `recordings.status` is the durable cursor; the queue worker reads the current status, runs the stage, advances status. Failure marks status='failed' + writes `error_message`; the admin / org-admin monitor can retry from the last successful stage.

### 3.2 Upload (browser → Supabase Storage)

- **Chunked resumable upload** using Supabase Storage's TUS-protocol endpoint (`POST /storage/v1/upload/resumable`). Browser uploads directly to Storage, bypassing Vercel function body limits.
- One file per upload; the wizard creates `N` `recording_files` rows pre-upload, each tracked individually.
- Soft sanity cap: 20GB per file (rejected client-side; not a server enforcement).
- Storage path: `<org_id>/<recording_id>/<original_filename>`. RLS policy on the `recordings` bucket scopes access to the file's owning org. `<TBD: storage RLS migration sql>`
- When all `recording_files.upload_status` reach `'uploaded'` AND the user clicks Process, the recording transitions `uploading → queued` and the extract job enqueues.

### 3.3 Extract (ffmpeg)

- For each `recording_files` row with `is_video=true`: extract audio to mp3 (16kHz mono is sufficient for both vendors and is ~10x smaller than the source). Store at `<org_id>/<recording_id>/audio/<filename>.mp3`. Update `audio_storage_path` + `duration_sec` + `upload_status='extracted'`.
- For audio-source rows: probe duration via ffprobe, no extraction.
- After all files processed: ffmpeg `concat` muxer stitches in `sort_order`. Stitched output at `<org_id>/<recording_id>/audio/stitched.mp3`.
- Update `recordings.source_duration_sec` (sum) + transition status to `transcribing`.
- **ffmpeg runtime:** `<TBD>` — Options being weighed: (a) Vercel Sandbox (GA Jan 2026, fits the use case), (b) Vercel Functions with `@ffmpeg/ffmpeg` WASM (limited by 300s function timeout for very long files), (c) external worker (Railway / Modal / Replicate). Decide pre-build based on typical-file-size benchmark.

### 3.4 Transcribe — vendor routing

#### Strategy resolution (`asr_strategy='auto'`)

```ts
function resolveAsrVendor(rec: Recording): 'whisper' | 'deepgram' | 'hybrid' {
  const lang = rec.language;
  const isMultiSpeaker = rec.session_type === 'focus_group'
    || (rec.session_type === 'qa' && rec.setup_inputs.panel?.length > 3)
    || rec.session_type === 'general_meeting';
  const isMultilingual = lang === 'en-es' || (lang !== 'en' && lang !== 'en-us');
  const isSingleSpeaker = rec.session_type === 'lecture'
    || (rec.session_type === 'interview' && rec.setup_inputs.interviewees?.length === 1);

  if (isMultilingual) return 'whisper';      // Whisper's multilingual edge
  if (isSingleSpeaker) return 'whisper';     // No diarization needed; cheaper
  if (isMultiSpeaker)  return 'deepgram';    // Diarization tags worth it
  return 'deepgram';                         // Sensible default for meetings
}
```

User can override via the wizard:
- **Whisper** — force Whisper alone
- **Deepgram** — force Deepgram alone
- **Hybrid** — run both: Whisper text + Deepgram speaker tags, aligned by timestamp ("WhisperX-style"). Higher cost (~$0.60/hour); use for high-stakes meetings.
- **Let system decide** — runs `resolveAsrVendor()` above.

#### Whisper path

- File size > 25MB? Chunk via ffmpeg into ≤24MB segments with 2s overlap; transcribe each, merge with offset.
- POST `audio/mp3` to `https://api.openai.com/v1/audio/transcriptions` with `response_format=verbose_json` (gives per-segment timestamps).
- Cost: $0.006/min. 60-min meeting ≈ $0.36.

#### Deepgram path

- Single POST of signed Storage URL to `https://api.deepgram.com/v1/listen?model=nova-3&diarize=true&punctuate=true&smart_format=true&utterances=true&language={lang}`.
- Polling: 202 + callback URL OR poll the request_id endpoint. We use polling for simplicity.
- Cost: ~$0.0073/min batch with diarization. 60-min meeting ≈ $0.44.

#### Hybrid path

1. Run Deepgram + Whisper concurrently on the stitched audio.
2. Use Whisper's text as the authoritative content.
3. Use Deepgram's speaker turn boundaries (timestamps) as the authoritative diarization.
4. Align: for each Whisper segment, assign the speaker label of the overlapping Deepgram speaker turn (majority-overlap if multiple).
5. Cost: ~$0.80/min summed (~$0.48/hour combined, since 1 min of audio costs both vendors ≈ $0.013).

#### Output

Write a `recording_transcripts` row with `vendor` + `segments` + `raw_response` + accumulated `cost_cents`. Transition status to `analyzing`.

### 3.5 Analyze (Claude pass)

Per session_type prompt, defined in `lib/recordings/prompts/{qa,focus_group,general_meeting,interview,lecture}.ts`. Each prompt receives:

- The full `setup_inputs` (panel roster, agenda, etc.)
- The full transcript (segments with speaker tags if available)
- A type-specific output schema (JSON Schema, validated post-response)

**v1 Q&A prompt (verbatim, in `lib/recordings/prompts/qa.ts`):**

```
You are extracting structured Q&A from a recorded forum or town hall.

CONTEXT
- Panel members (these people may answer questions; their speech does NOT count as audience questions):
{{panel_roster}}
- Agenda topics (use these as section headers; do not invent new topics):
{{agenda}}

RULES
1. Extract ONLY audience-to-panel questions and their answers. Filter out panel-to-panel exchanges, panel-to-self commentary, and audience side-comments that are not actual questions.
2. For each question, classify question_typology: "ask" | "complaint" | "commentary" | "clarification". Only "ask" types should be marked as actionable; the others are kept for the appendix.
3. Use ONLY the agenda topics above as section headers. If a Q/A genuinely doesn't fit any agenda topic, put it under "Other" — do NOT invent new section names.
4. Quote the question and answer verbatim from the transcript. Do not paraphrase.
5. If the asker self-identifies (e.g. "Hi I'm Maria from Apopka"), capture asker_name.
6. If the panelist who answered is identifiable from the transcript (e.g. "Thanks Maria, this is John responding..."), capture panelist_name.
7. Include start_sec + end_sec timestamps pointing at the question's start in the transcript.

OUTPUT (JSON, conforming to the schema below):
{
  "extractions": [
    {
      "unit_type": "qa_pair",
      "topic": "<one of the agenda topics or 'Other'>",
      "payload": {
        "question": "<verbatim>",
        "asker_name": "<if known, else null>",
        "answer": "<verbatim>",
        "panelist_name": "<if known, else null>",
        "question_typology": "ask" | "complaint" | "commentary" | "clarification"
      },
      "start_sec": <int>,
      "end_sec": <int>,
      "confidence": <0.0-1.0, your self-assessment>
    }
  ]
}

TRANSCRIPT
{{transcript}}
```

Confidence below `<TBD: threshold>` flags `flagged_for_review=true, flag_reason='low_confidence'`. Coverage report (post-extraction, see § 3.6) checks per-agenda-topic density and flags gaps.

**Two-pass model strategy (v1 quality bar):**

1. **Primary extraction — Claude Opus 4.7** (`claude-opus-4-7`). Best structured-reasoning available; specifically picked for the "is this an audience question vs panel commentary" judgment that bit the PM-1 pilot.
2. **Curator second pass — Claude Sonnet 4.6** (`claude-sonnet-4-6`). Receives the Opus extractions + the transcript and answers: "Review these extractions — would you publish this in an official Q&A document? Flag any that should be reconsidered." Output: `flagged_for_review=true` with `flag_reason='curator_questioned'` on borderline pairs. This is our quality net in the absence of ground truth.

**Cost per 60-min meeting:** Opus extraction ≈ $0.75 (35K input + 3K output) + Sonnet curator ≈ $0.20 → **~$1 total Claude cost**. Negligible vs target $5K customer pricing.

**Post-pilot:** A/B Sonnet-only vs Opus+Sonnet curator on a 10-meeting corpus to see if the curator pass alone with a cheaper extractor is sufficient at the production volume. For the June 16 pilot — use Opus.

### 3.6 Coverage report

After the analytical pass, compute:

- **Per-agenda-topic extraction density** — count of extractions per topic. Topics with 0 extractions flagged.
- **Per-minute extraction density** — extractions per minute of source audio. Stretches of 5+ minutes with 0 extractions flagged (potential miss).
- **Confidence histogram** — distribution of `confidence` values. Bottom decile auto-marked `flagged_for_review=true`.

Coverage report is stored as JSONB on `recordings.coverage_report` (`<TBD: add column>`) and rendered in the HTML report's "Coverage" tab.

### 3.7 Mirror

For each `recording_extractions` row, insert a corresponding `dataset_rows_flat` row against the recording's `dataset_id` per the mapping in § 2.6. Updates `datasets.row_count`. Triggers schema refresh (`dataset_state.schema_config`) so the wizard's auto-detected fields are present.

### 3.8 Render

- HTML report at `app/analyze/[datasetId]/report/page.tsx` — server-rendered from the `recordings` + `recording_transcripts` + `recording_extractions` rows. Auth-gated (`requireOrgAccess`).
- PDF export: `POST /api/analyze/[datasetId]/report/pdf` — Playwright headless prints the HTML page. Stored in Supabase Storage at `<org_id>/<recording_id>/report.pdf` and returned as signed URL.
- XLSX export: `POST /api/analyze/[datasetId]/report/xlsx` — server-side XLSX generation from `recording_extractions` payloads. Columns per `unit_type` per § 2.6 mapping plus.

### 3.9 Notify

Resend email to `recordings.created_by` (and optionally org admins per `<TBD: org notification preference>`). Subject: `"Your recording report is ready — {recording.name}"`. Body: link to HTML report, link to PDF, link to XLSX.

---

## 4. API Surface

### 4.1 `POST /api/recordings` — create a recording (pre-upload)

**Auth:** session cookie + CSRF.
**Feature gate:** `assertFeatureAllowed('recording', orgId, userId)`.

**Body:**
```json
{
  "name": "NOWOCATS PM-2",
  "session_type": "qa",
  "meeting_date": "2026-06-12",
  "location": "Apopka City Hall",
  "language": "en",
  "setup_inputs": { ... },
  "asr_strategy": "auto",
  "files": [
    { "original_filename": "GX010114.MP4", "size_bytes": 524288000, "mime_type": "video/mp4", "is_video": true },
    { "original_filename": "GX020114.MP4", "size_bytes": 524288000, "mime_type": "video/mp4", "is_video": true }
  ]
}
```

**Response:**
```json
{
  "recording_id": "uuid",
  "files": [
    { "id": "uuid", "upload_url": "https://...tus-resumable-url", "storage_path": "..." },
    { "id": "uuid", "upload_url": "https://...", "storage_path": "..." }
  ]
}
```

Returns one signed TUS upload URL per file. Browser PUTs file bytes directly.

### 4.2 `POST /api/recordings/[id]/process` — start the pipeline

Called after all files report `upload_status='uploaded'`. Transitions `uploading → queued` and enqueues the extract job.

### 4.3 `GET /api/recordings/[id]` — status + details

Returns the recording row + files + (if available) transcript metadata + extraction count + coverage report. Used by the status surface.

### 4.4 `POST /api/collections/[id]/members` — **NEW** (fills the gap)

**Auth:** session cookie + CSRF.
**Body:** `{ dataset_id: string, label: string }`

- Insert into `collection_members`.
- Re-run `buildMergedCollectionSchema()` and update the virtual dataset's `dataset_state.schema_config`.
- Update `datasets.row_count` (sum across members).
- Same-org rule: dataset must belong to the same org as the collection.

Also: fix existing `DELETE /api/collections/[id]?member=X` to re-run schema rebuild after a member is removed (and remaining > 0).

### 4.5 `POST /api/analyze/[datasetId]/report/pdf` and `/xlsx` — exports

See § 3.8.

### 4.6 Public report — `GET /r/[shareToken]`

**No auth.** Validates `share_enabled=true` AND (`share_expires_at` IS NULL OR `share_expires_at > now()`). If `share_password_hash` is set, requires a `?p=<password>` query param (compared via bcrypt) or returns a password-entry form.

Renders the same HTML report as `/analyze/[datasetId]/report` but with:
- Sentimetrx branding header + "Powered by Sentimetrx" footer
- No "Edit" / admin controls
- `<meta name="robots" content="noindex, nofollow">` so search engines don't index principals' meeting Q&A
- A canonical link back to itself (no leak to the internal route)

### 4.7 `POST /api/recordings/[id]/share` — enable + email principals

**Auth:** session cookie + CSRF. Owner or org admin only.

**Body:**
```json
{
  "enabled": true,
  "expires_at": "2026-07-16T23:59:59Z",       // optional
  "password": "optional-password",             // optional, hashed before storage
  "send_to": ["principal1@example.com", "principal2@example.com"]   // optional; if present, Resend sends each
}
```

Generates `share_token` if not already set (24-char URL-safe). Returns `{ url: "https://sentimetrx.ai/r/<token>" }`. If `send_to` provided, sends each recipient an email with the link + a one-line preview of the meeting name + date.

### 4.8 `GET /api/recordings` — list (scoped by role)

- Org admins: see all recordings in their org.
- Admin-org users: see all recordings across all orgs (`?org_id=X` filter optional).
- Non-admin users: see only recordings they `created_by`.

Pagination via `?limit=50&offset=0`. Filter: `?status=processing|complete|failed`.

### 4.9 Feature management routes (admin-only)

- `PATCH /api/admin/orgs/[orgId]/features` — body `{ feature, enabled, quota_per_month? }`
- `PATCH /api/admin/users/[userId]/features` — body `{ feature, enabled, quota_per_month? }`

Both require `is_admin_org` user via `requireAdmin`.

---

## 5. UI Surface

### 5.1 Dataset wizard — `/analyze/new`

Existing wizard adds a "Recording" tile alongside CSV / Google Reviews / Reddit / etc. Selecting it routes to `/analyze/new/recording`.

### 5.2 Recording creation wizard — `/analyze/new/recording`

Three-pane layout:

```
┌──────────────────────────┬──────────────────────────────────┐
│  Files                   │  Setup                            │
│  ─────                   │  ─────                            │
│  [Drop area]             │  Name: [___________]              │
│  ✓ GX010114.MP4  85%▓▓░░ │  Session type: [Q&A ▼]            │
│  ✓ GX020114.MP4  ✓ done  │  Meeting date: [2026-06-12]       │
│  ✓ GX030114.MP4  ✓ done  │  Location: [_________]            │
│  ↕ reorder                │  Language: [English ▼]            │
│                          │                                   │
│                          │  ▼ Panel members                  │
│                          │  + Add panelist                   │
│                          │                                   │
│                          │  ▼ Agenda topics                  │
│                          │  + Add topic                      │
│                          │                                   │
│                          │  ASR strategy: [Let system ▼]     │
│                          │   ○ Whisper                       │
│                          │   ○ Deepgram                      │
│                          │   ○ Both (high accuracy)          │
│                          │   ● Let system decide             │
└──────────────────────────┴──────────────────────────────────┘
                          [ Process ]  (enabled when files uploaded + form valid)
```

Upload runs in background; user fills setup in parallel. Process button disabled until both ready.

### 5.3 Status surface — `/analyze/new/recording/[id]/status`

Shows current stage + ETA + last completed step. Long-poll or `EventSource` for live updates. Closes-tab-friendly: user can come back to this URL anytime, or wait for the Resend email.

### 5.4 Report — `/analyze/[datasetId]/report`

Tabs:

1. **Q&A** — sections by agenda topic, Q/A pairs in order, verbatim quotes, timestamps with click-to-play (post-v1).
2. **Appendix** — non-`ask` typology pairs (complaints, commentary, clarifications).
3. **Coverage** — per-topic density chart, flagged-for-review list, confidence histogram.
4. **Transcript** — full transcript with speaker labels.
5. **Export & Share** — PDF download, XLSX download, "Enable public link" toggle, "Send to principals" email-list field.

Export → PDF prints the visible tab via Playwright. XLSX exports the structured extractions only. The Share panel calls `POST /api/recordings/[id]/share`.

### 5.5 Org-admin recordings list — `/recordings`

A simple per-org list:

```
Recordings                                                       [ + New recording ]

Name                          Type    Date         Status        Cost     Owner
─────────────────────────────────────────────────────────────────────────────────
NOWOCATS PM-2                Q&A     2026-06-12   ✓ Complete    $3.42    Sanjay
NOWOCATS PM-1                Q&A     2026-05-18   ✓ Complete    $4.81    Sanjay
Vindman Tidewater Forum      Q&A     2026-05-30   ⟳ Analyzing   —        Analyst1
```

Filter by status, click into one for the status page or the report.

Visible to: org admins (all in org), non-admins (only their own).

### 5.6 Admin-org monitor — `/admin/downloads` adds a Recordings section

Mirrors the existing Reddit / Google Reviews / Substack / Regulations / Upload sections. Same shape: status, recent rows, error messages, retry action. Shows ALL orgs' recordings. Already gated by `is_admin_org` redirect.

---

## 6. Cost & Operations

### 6.1 Cost per meeting (60-minute example)

| Vendor strategy | ASR cost | Claude cost | Total |
|---|---|---|---|
| Whisper only | $0.36 | $0.60-$1.20 | $1.00-$1.60 |
| Deepgram only | $0.44 | $0.60-$1.20 | $1.05-$1.65 |
| Hybrid (both) | $0.80 | $0.60-$1.20 | $1.40-$2.00 |

Add ~$0.02 for ffmpeg + Resend + Storage per meeting. Negligible.

**Quotas (suggested defaults):**
- Free orgs: `enabled=false`
- Paid orgs: `enabled=true, quota_per_month=10` (typical analyst use)
- Enterprise: `enabled=true, quota_per_month=NULL` (unlimited)

### 6.2 Monitoring

| Surface | Audience | Path |
|---|---|---|
| Per-recording status | Owner + org admins | `/analyze/new/recording/[id]/status` |
| Org recording list | Org admins | `/recordings` |
| All-org admin monitor | Admin-org only | `/admin/downloads` (new Recordings section) |
| Per-org usage / cost | Org admins | `/admin/usage` (existing — `recording` feature appears as a new line) |

### 6.3 Retention

- Source audio + extracted audio + stitched audio: retained indefinitely by default.
- Per-org override: `<TBD: retention_days column on organizations>`. Cron sweeps and deletes Storage paths + sets `recording_files.audio_storage_path = NULL` (transcripts and extractions retained — they're the long-tail value).
- Transcripts + extractions: retained indefinitely (small).
- Cost: ~$0.021/GB/month Storage. 100 meetings × 5GB ≈ $10/month. Negligible.

### 6.4 Failure handling

- Any stage failure marks `status='failed'` + populates `error_message`.
- Admin monitor / org admin list show failed jobs with a Retry button → `POST /api/recordings/[id]/retry` which re-enqueues from the failed stage (status reset to the prior stage's "done" value).
- Persistent failures (3 retries): require human investigation. No auto-bounce.

---

## 7. Security & Privacy

### 7.1 Multi-tenancy invariants

- All four new tables (`recordings`, `recording_files`, `recording_transcripts`, `recording_extractions`) have RLS enabled with org-scoped SELECT policies (§ 2.1-2.4).
- Service-role queries in route handlers MUST pair `id` with `org_id`:
  ```ts
  const { data } = await service.from('recordings').select(...)
    .eq('id', recordingId).eq('org_id', orgId).single()
  ```
  Per the [[feedback-service-role-org-id-pair]] convention.
- Storage bucket `recordings` has an RLS policy: `(bucket_id = 'recordings' AND (storage.foldername(name))[1] = (SELECT org_id::text FROM users WHERE id = auth.uid()))`. `<TBD: confirm exact policy syntax>`
- `/api/admin/orgs/[orgId]/features` and `/api/admin/users/[userId]/features` wrapped with `requireAdmin`.
- `/recordings` page server-side scopes by role.

### 7.2 PII

- Audio recordings of meetings frequently contain PII (names, locations, opinions). Treat all recording storage as PII-class. Classification per `docs/SECURITY.md` § <TBD: PII section reference>.
- Transcripts may include attributed asker names. Surface in the HTML report only to authenticated org-internal users OR holders of a valid `share_token`.

### 7.2b Public share security

The public report route at `/r/[shareToken]` is the primary distribution mechanism for the June 16 pilot ("send link to principals at end of meeting") and the productized workflow.

- **Token entropy:** 24 URL-safe characters (~144 bits). Brute-force is infeasible; rate-limit at the edge to mitigate enumeration anyway (`<TBD: per-IP rate on /r/* per middleware>`).
- **Default expiry:** 30 days from `share_enabled=true`. Owner can override (longer / shorter / NULL=forever) on the share form.
- **Optional password:** bcrypt-hashed; ?p=<pw> query param OR form post.
- **Robots:** `<meta name="robots" content="noindex, nofollow">` on the public route to prevent search indexing.
- **Revocation:** flipping `share_enabled=false` immediately invalidates the token. Owner can also rotate the token (issues new `share_token`, old links 404).
- **Audit log:** every public access logged with `share_token, ip, user_agent, accessed_at` for forensic trace. Per-token access count visible on the share panel.
- **No PII redaction in v1.** The owner controls who gets the link; they're responsible for the audience. v1.5 may add an opt-in redaction pass (asker names → "Audience member", etc.) for broader distribution.

### 7.3 Content safety

- Transcripts pass through OpenAI moderation before Claude analysis. Flagged content (high-severity hate / harassment / sexual) blocks the analytical pass and marks `status='failed'` with `error_message='content_moderation_blocked'`.
- The analytical prompt does not regurgitate moderated content; if a flagged segment is in the transcript, Claude is instructed to skip it (`<TBD: prompt clause>`).

### 7.4 Audit logging

- Recording creation, processing start, export download → entries in `audit_log` with `actor_id, org_id, action, target_recording_id`.

---

## 8. Cron / Scheduled Jobs

| Job | Schedule | Purpose |
|---|---|---|
| `recordings-retention-sweep` | Daily 02:00 UTC | Delete source audio past per-org `retention_days`. |
| `recordings-stuck-sweep` | Every 30 min | Find recordings in non-terminal status with `started_at > 4 hours ago` and mark `status='failed'` with `error_message='timeout'`. |

Defined in `vercel.json` / `vercel.ts`.

---

## 9. Environment Variables

| Name | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Yes (existing) | Whisper + moderation |
| `DEEPGRAM_API_KEY` | **NEW** | Deepgram batch transcription |
| `ANTHROPIC_API_KEY` | Yes (existing) | Claude analytical pass |
| `RESEND_API_KEY` | Yes (existing) | Completion email |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (existing) | Bypass RLS for queue workers |
| `RECORDINGS_BUCKET` | **NEW** | Storage bucket name. Default `recordings`. |
| `VERCEL_QUEUE_NAME_RECORDINGS` | **NEW** | Queue name for the recording pipeline. `<TBD: vendor>` |

---

## 10. Testing

### 10.1 Unit (`tests/unit/recordings/`)

- ASR vendor routing (`resolveAsrVendor`) — table-driven across all combinations of session_type × language × speaker count.
- Setup-input validation per session_type.
- Extraction → `dataset_rows_flat` mirror mapping per `unit_type`.
- Hybrid alignment algorithm (Whisper text + Deepgram speaker turns).

### 10.2 Integration (`tests/integration/recordings/`)

- `POST /api/recordings` happy path → row created with `status='uploading'`.
- `POST /api/recordings/[id]/process` transitions status and enqueues.
- Feature gate denies when `org_features.enabled=false` for the org.
- Same-org rule on collection member adds.

### 10.3 RLS (`tests/rls/`)

- Cross-org SELECT on `recordings`, `recording_files`, `recording_transcripts`, `recording_extractions` returns 0 rows.
- Cross-org Storage object read fails.

### 10.4 Egress (`tests/integration/cross-org-egress.test.ts`)

- Each new route exercised with a foreign-org `recordingId` returns 404, not data.

### 10.5 E2E (`tests/e2e/recordings.spec.ts`)

- Wizard happy path: drop fixture audio file → fill Q&A form → click Process → status polls to complete → report renders with extracted pairs.
- Uses a 30-second pre-recorded fixture to keep test runtime sub-2-minutes.

### 10.6 Load (`tests/loadtest/recordings.ts`)

- 10 concurrent uploads × 60-min meeting → all complete within 90 minutes.

---

## 11. Rollout Plan

**Hard deadline: 2026-06-16 free pilot meeting.** Target: by end of meeting that evening, analyst uploads audio → ~60 min later report is ready → enables public share + emails principals. "Blow them away" quality bar (production pricing target ~$5K/meeting; this pilot is unpaid).

### Phase 0 — substrate (2026-05-31 → 2026-06-02)

1. `sql/<NNN>_org_user_features.sql` — feature gating tables + helper.
2. `sql/<NNN+1>_recordings.sql` — all four recording tables + RLS policies.
3. `lib/featureFlags.ts` — `assertFeatureAllowed()`.
4. Storage bucket `recordings` + bucket RLS.

### Phase 1 — pipeline (2026-06-03 → 2026-06-06)

**Highest-risk phase.** First time on Vercel Sandbox + Vercel Queues + Deepgram in this repo.

5. `lib/asr/whisper.ts`, `lib/asr/deepgram.ts`, `lib/asr/hybrid.ts`, `lib/asr/router.ts`.
6. `lib/recordings/extract.ts` — ffmpeg job on Vercel Sandbox.
7. `lib/recordings/transcribe.ts` — vendor dispatch.
8. `lib/recordings/analyze.ts` — Opus extraction + Sonnet curator pass.
9. `lib/recordings/mirror.ts` — `dataset_rows_flat` mirror.
10. Vercel Queues wiring + worker handlers per stage.
11. Internal smoke test against re-uploaded NOWOCATS PM-1 audio → assert extractions ≈ PDF ground truth.

### Phase 2 — UX (2026-06-07 → 2026-06-10)

12. `/analyze/new` wizard adds Recording tile.
13. `/analyze/new/recording` wizard with chunked upload + parallel setup form.
14. `/analyze/new/recording/[id]/status` status surface.
15. `/analyze/[datasetId]/report` HTML + PDF + XLSX exports.
16. `/recordings` org-admin list.
17. `/admin/downloads` new Recordings section.

### Phase 3 — collections + public sharing (2026-06-11 → 2026-06-12)

18. `POST /api/collections/[id]/members` + schema rebuild.
19. Schema rebuild on existing DELETE.
20. "Add to collection" action on dataset detail page.
21. Public route `/r/[shareToken]` + Sentimetrx-branded report shell.
22. `POST /api/recordings/[id]/share` — enable / token rotate / Resend to principals.
23. Share panel on report page (Export & Share tab).
24. Public-access audit log + per-token access count.

### Phase 4 — calibration soak (2026-06-13 → 2026-06-14)

**Goal:** prove the pipeline matches PM-1 PDF ground truth without manual intervention.

25. Re-upload PM-1 audio via the wizard end-to-end.
26. Compare extracted Q&A pairs to the PM-1 PDF (count match, content match, classification match).
27. Iterate the extraction prompt + curator prompt until pair match >= 90% of PDF entries (or until we explicitly accept the gap with a documented reason).
28. Tune the curator pass: false-positive flags too high → tighten; missed bad extractions → loosen.

### Phase 5 — dry run + ship (2026-06-15 → 2026-06-16)

29. **6/15 dry run:** upload a fixture audio file (could be PM-1 re-upload), run end-to-end with public share enabled, send link to a personal email, verify the full external-recipient experience.
30. Feature gate: default OFF, enable for the user's org only.
31. **6/16 live:** record meeting → upload audio → process → share with principals.
32. Post-pilot: weekly devlog entry. Update `SPEC.md`, `FEATURES.md`, `docs/DATA_SOURCES.md`, `docs/SECURITY.md`.

### Backup plan if Phase 1 slips

If by 2026-06-13 the Sandbox/Queues/Deepgram integration isn't solid:
- **Fall back to the PM-1 manual pipeline**: CLI ffmpeg locally, Whisper API direct, Claude one-shot Python script, manual upload of the resulting structured JSON via a one-time admin route.
- **Keep the public-share substrate** (Phase 3): the report URL still works; the difference is the pipeline that filled the rows wasn't the productized wizard.
- The customer-visible result is identical. The product story is "we shipped the wizard 2 weeks later"; the pilot still demonstrates the end-state value.

---

## 12. Open TBDs

| # | Question | Decided by | Status |
|---|---|---|---|
| 1 | ffmpeg runtime | Pre-build | ✓ **Vercel Sandbox** |
| 2 | Job queue | Pre-build | ✓ **Vercel Queues** |
| 3 | Claude model | Pre-build | ✓ **Opus 4.7 extract + Sonnet 4.6 curator** |
| 4 | Confidence threshold for `flagged_for_review` | Phase 4 calibration | Open — set during PM-1 soak |
| 5 | Org notification preference (who gets completion email) | Phase 2 | Open — default to owner only for v1 |
| 6 | Storage RLS policy exact syntax (path-folder-based scoping) | Phase 0 | Open — research during substrate work |
| 7 | Retention default | Pre-build | ✓ **Forever** (NULL retention_days) |
| 8 | Public link-share | Pre-build | ✓ **In v1** — see § 4.6, 4.7, 5.4, 7.2b |
| 9 | Audit log target_recording_id vs generic `target_id, target_type` | Phase 0 | Open — match existing convention |
| 10 | Per-language segment routing | v2 | Deferred |
| 11 | Which customer is the June 16 pilot? | Pre-build | **Open — confirm with user** |

---

## 13. Related

- `docs/DATA_SOURCES.md` — recordings becomes a new source kind; update DATA_SOURCES.md when v1 ships.
- `docs/ANALYTICS.md` — `_collection_label` field already handles cross-channel rollup; reference the recording use case there.
- `docs/SECURITY.md` — PII classification of recording audio, retention policy, audit logging.
- `docs/ENGINEERING.md` — feature flag pattern; add the generic gating mechanism as a documented primitive.
- `docs/TESTING.md` — add `tests/unit/recordings/`, `tests/integration/recordings/`, `tests/e2e/recordings.spec.ts`, `tests/loadtest/recordings.ts` to the layout tree.
- `docs/USAGE_ACCOUNTING.md` — record per-recording cost (ASR + Claude) under feature `recording`.
- Memory: [[project-audio-qa-failure-modes]] — the failure modes this design is built to mitigate.
- Memory: [[project-pulseiq-audio-transcript-playback]] — the future audio-playback viewer that consumes `recording_transcripts.segments.source_file`/`source_offset`.

---

## 14. Implementation status

| Phase | Status | Notes |
|---|---|---|
| Phase 0 — substrate | **In progress (2026-05-30)** | `sql/089_org_user_features.sql`, `sql/090_recordings.sql`, `sql/091_recordings_storage_bucket.sql`, `lib/featureFlags.ts` written. Not applied to prod yet. Spec deviation: `org_id` denormalized on `recording_files` / `_transcripts` / `_extractions` for service-role pairing uniformity. |
| Phase 1 — pipeline | Pending | Earliest start 2026-06-03 per plan in § 11. |
| Phase 2 — UX | Pending | |
| Phase 3 — collections + public sharing | Pending | |
| Phase 4 — calibration soak | Pending | |
| Phase 5 — dry run + ship | Pending | Hard pin: 2026-06-16 NOWOCATS PM-2 free pilot. |

---

*Last reviewed: 2026-05-30 (Phase 0 substrate landed; Phase 1 pending). Refresh after each phase ships.*
