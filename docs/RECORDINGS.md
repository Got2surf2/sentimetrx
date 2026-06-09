# Sentimetrx — Recordings Spec

> **Promotion update (2026-06-04) — Recordings is now the top-level "Town Hall" product.** User-facing label is **Town Hall** (internal slug/tables/feature-key stay `recordings`, per the bots=Agents convention). It is **no longer a sub-feature of Analyze** — `recordings` was removed from `ANALYZE_CHILDREN` (`lib/resolveOrg.ts`), gates on `features.recordings` alone, and has its own top-level nav item (`TopNav`, peer of PulseIQ). Routes consolidated under `/recordings/*`: landing `/recordings`, wizard `/recordings/new`, status `/recordings/[id]/status`, **report `/recordings/[id]/report` (re-keyed from datasetId → recording_id)**. The derived dataset remains the analytics view, reachable via an "Open in Analytics" cross-link; the old `/analyze/[datasetId]/report` is a thin back-compat redirect. The `/analyze` header button + `/analyze/new` source tile were removed. NB: this "Town Hall" is the recorded-meeting product and is **distinct from PulseIQ** (the live/digital pulse product, internal `townhall_*`).

> **Implementation update (2026-06-01, pilot wiring).** Deltas from the original spec, now in code:
> - **Feature gating:** recordings is a `ModuleFeatures` toggle, NOT the `org_features`/`user_features` quota system described in § 2.5. (As of 2026-06-04 it is a **top-level** feature, no longer forced off when `analyze` is off — see the promotion note above.) The § 2.5 / § 4.9 `org_features` substrate is built but currently unused.
> - **Extract (§ 3.3):** ffmpeg runs in the Vercel Sandbox via a downloaded **static binary** (+ `xz` to unpack), not `dnf` — the base image lacks ffmpeg and it isn't in the default repos. Bake a snapshot (`FFMPEG_SANDBOX_SNAPSHOT_ID`) in production to skip the per-cold-boot download.
> - **Analyze (§ 3.5):** extraction is **topic-agnostic** (pull every audience Q&A with a free-form label); the Sonnet curator pass **clusters them into emergent topics**. The agenda is an optional naming hint, no longer a recall anchor or fixed taxonomy. Claude calls pass a long `timeoutMs` (callAI defaults to 15s).
> - **Delete:** `DELETE /api/recordings/[id]` hard-deletes storage objects + derived dataset/rows + the recording (cascades files/transcripts/extractions). Owner / org-admin / platform-admin only.
> - **Rename:** `PATCH /api/recordings/[id]` updates `name` only (same owner/org-admin/platform-admin gate, pairs id+org_id). Inline-edit from the card ⋯ menu.
> - **Transfer:** `PATCH /api/recordings/[id]` with `{ org_id }` moves the recording's whole graph to another org — **platform-admin org only**. Relocates storage objects (`<org>/<id>/…`), then atomically re-org_id's recordings + files + transcript + extractions + derived dataset via the `transfer_recording_org` RPC (sql/102), and writes an `org_transfers` audit row. Admin-only "Move to org" item on the card ⋯ menu.
> - **List UX:** `/recordings` is the top-level Town Hall home — cards carry an **ℹ️ progress popover** (lifecycle checklist: Uploaded · Transcribed · Entities reviewed *opt* · Q&A generated · Polished edits *opt* · Public link shared *opt* — ✓/○ from the recording's `status` + flags, "optional" marked, "only upload + generate are required"), a **favorite star** (per-user, `user_favorites` resource_type `'recording'`, extended in `sql/101`), a **⋯ menu (Rename / Delete / Move to org)**, and a **content meta row** ("3 files · 17 Q&A · 46m" — file count split by `file_role` media/slides, `unit_type='qa_pair'` count matching the report header, and `source_duration_sec`; each part is dropped when zero/unknown so an in-progress card shows only what it has), and — on complete recordings with flagged pairs — a **pending-work action bar** (a darker amber, full-width clickable strip "⚠ N pairs need review →" that deep-links to the report's review tab, `…/report?tab=coverage`). It surfaces `recording_extractions.flagged_for_review` (the same count as `coverage_report.flagged_count`) so a reviewer sees outstanding intervention work without opening the recording; it's its OWN `<Link>` (a sibling of, never nested in, the card's body link). The bar is built to hold a **second pill for truly-unanswered questions** once the analyzer detects them (a `flag_reason='no_response'` concept — not yet built); both funnel to the same review tab. Counts come from two batched aggregate queries on the loaded ids in `app/recordings/page.tsx` (one over `recording_extractions` for qa_pairs **and** flagged-pairs in a single pass, one over `recording_files` grouped by role) — no N+1. Report tabs are deep-linkable via `?tab=` (`ReportClient` reads it; defaults to `coverage`, the review hub). Matches the Analyze/Surveys card family, plus a materials-guidance panel, reachable from the Town Hall nav item. The report Q&A tab exposes a clear "Re-extract all" action.

**Module:** `/app/recordings/new/`, `/app/recordings/[id]/report/`, `/app/api/recordings/*`, `/app/recordings/`, `lib/recordings/*`, `lib/asr/*`, `lib/featureFlags.ts`
**Storage:** Supabase Storage bucket `recordings` (chunked direct upload from browser, signed URLs for ASR vendors). Source audio + transcripts retained permanently by default; per-org retention policy configurable.
**External APIs:**
- **OpenAI Whisper** (`POST /v1/audio/transcriptions`, model `whisper-1`) — transcription, multilingual-strong, no diarization
- **Deepgram Nova-3** (batch async API) — transcription + diarization, English-strong
- **ffmpeg** (serverless via `@vercel/og`-style invocation or Vercel Sandbox `<TBD>`) — video → audio extraction, multi-file stitch
- **Anthropic Claude** (via `callAI`) — analytical extraction pass, model selected by session type
- **Resend** — completion notification email
- **Playwright headless** (via existing test infrastructure or `@sparticuz/chromium` on Vercel) — HTML report → PDF export

**Job runner:** Vercel Workflow DevKit (`workflow` + `@workflow/next`) for the multi-step async pipeline. Spec drafted this as "Vercel Queues" before the product name landed — same primitive, durable steps with automatic retry and `recordings.status` as the human-facing cursor.
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
2. A type-specific HTML report at `/recordings/[id]/report` — exportable to PDF (Playwright print) and XLSX (structured pairs).
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
| `qa` | `{ panel: [{name, role}], agenda: [string], ground_truth_url?: string, glossary?: [string] }` |
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
  sentiment?: 'positive' | 'neutral' | 'negative' | 'mixed',  // tone of the exchange (added 2026-06; optional → old rows default 'neutral')
  presentation_scope?: 'in_scope' | 'out_of_scope' | null,    // (2026-06-07) does the question pertain to the presentation? AI-classified at analyze time (§3.5e) + human-overridable; only for presentation meetings
}

// quote (session_type='focus_group')  -- v2
{
  participant_id: string,     // P1, P2, ... from setup roster
  text: string,
  sentiment: 'positive' | 'neutral' | 'negative',
  themes: string[],
}

// action_item — now ALSO emitted for session_type='qa' by the synthesis pass
// (§3.5), one row per follow-up/next-step the panel committed to.
{
  description: string,
  owner?: string,
  due_date?: string,          // ISO date
  related_agenda_item?: string,
}
```

**`recordings.analysis_summary` (jsonb, sql/094)** — meeting-level synthesis written by the analyze pass third step (§3.5). One object per recording (NOT extraction rows):

```ts
{
  executive_summary: string,                 // 3-5 sentence narrative
  headline: string,                          // one-line takeaway
  sentiment_overall: 'positive'|'neutral'|'negative'|'mixed',
  sentiment_breakdown: { positive, neutral, negative, mixed },  // counts, computed in code
  topic_summaries: Array<{ topic, qa_count, summary, sentiment, representative_exchanges: Array<{ question, answer, asker?, panelist? }> }>,
  decisions: Array<{ decision, topic? }>,
  generated_at: string, model: string,
}
```
Null for recordings analyzed before 2026-06, or when the synthesis pass fails (graceful degrade — the deck/report still render from the Q&A pairs). Action items live as `action_item` extraction rows, not here; `decisions` live here because they're narrative, not owned units.

### 2.4b Meeting-tool layer (sql/097, 2026-06)

Generalizes recordings from a Q&A recorder into a configurable **meeting tool** (record a whole meeting → split presentation from Q&A → summarize each). Five additions, all backward-compatible: a recording with `meeting_profile IS NULL` behaves exactly as the legacy Q&A flow.

- **`recordings.meeting_profile` (jsonb)** — `{ preset_id: 'town_hall_qa'|'community_meeting', phases: [{kind,label,analysis,expected}], has_slides }`. Presets live in `lib/recordings/profiles.ts`; `resolveProfile()` coerces NULL/unknown → `town_hall_qa` (single chokepoint, so nothing else branches on null). `phase.kind` ∈ presentation|qa|discussion|public_comment|decision; v1 runs `presentation_summary` + `qa_extraction`, others are `noop` (persisted, not analyzed).
- **`recordings.phase_map` (jsonb)** — `{ phases: [{kind,label,start_sec,end_sec,confidence?}], detected_at, model, edited_by_user }`. Detected post-transcription (`lib/recordings/phases.ts detectPhases`, Sonnet, seeded by the profile + slide titles), clamped/snapped in code, **user-adjustable at the transcribed gate**. Hard fallback = a single qa phase over the whole transcript, so a bad split can only under-segment, never break the pipeline.
- **`recordings.presentation_outline` (jsonb)** — AI-vision read of the uploaded slide deck: `{ slides: [{slide_number,title,key_points,figures,presenter,notes}], source_filename, page_count, … }`. The ground-truth seed for the presentation summary (figures/names/dates transcribed verbatim). Built by `lib/recordings/slides.ts` via the shared `lib/vision/` primitive (Sandbox `pdftoppm` render → Claude vision). **PDF only in v1** (PPTX is a fast-follow). Null when no slides or vision fails.
- **`recordings.proceedings_summary` (jsonb)** — neutral presentation summary: `{ overview, items: [{title,presenter,what_was_presented,key_figures,slide_refs}], … }`. `lib/recordings/presentation.ts`, Sonnet, **reuses the exact no-opining voice directive** from the Q&A synthesis pass (the deck is shareable with the client). Runs only when a presentation phase has content; null otherwise (graceful degrade).
- **`recording_files.file_role` (text, default `'media'`, CHECK in (`media`,`slides`))** — `slides` files (the presentation deck) ride the same TUS upload path but **skip the ffmpeg extract pipeline** (`extract.ts` filters to `file_role='media'`); they're read by vision instead. At most one `slides` file per recording; ≥1 `media` file required.

Migration `sql/097` is nullable adds on RLS-enabled tables → no new policy; slide PNGs live under the existing `recordings` bucket path (its MIME allowlist was extended to `image/png`/`image/jpeg` in `sql/099` so the rendered pages can be stored). Shared AI-vision support was added to `lib/ai.ts` (image content blocks, Anthropic) — reusable by bot-KB document ingestion later (text-extract-first, vision-fallback). Vision cost ≈ $0.01/slide on Sonnet.

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

### 2.8 Project setup, attribution & config versioning (sql/118, 2026-06)

A Town Hall project can be **set up before the audio/video exists**. Two lifecycle states sit ahead of the upload pipeline:

| status | meaning |
|---|---|
| `draft` | project being set up; not yet confirmed (reserved for autosave) |
| `awaiting_media` | setup confirmed; no recording attached yet — the project waits for the "Add recording" action, which moves it to `uploading` and the normal pipeline takes over |

Both are stable wait states, excluded from `recordings_status_active_idx` alongside `transcribed` and the terminal states.

**Attribution + intake columns on `recordings`:**

| column | type | notes |
|---|---|---|
| `analysis_org` | `text NOT NULL DEFAULT 'Datanautix'` | The org performing the analysis (consulting brand). Printed on report/deck. Distinct from `brand_tag` (the **client** brand). |
| `analysts` | `jsonb` `[{name, member_id?}]` | Analyst(s) from `analysis_org`. `member_id` set when picked from the org roster, absent for free-text names. |
| `objectives` | `jsonb` `{summary, questions:[]}` | Meeting objectives — AI-proposed from the uploaded deck/briefs at setup, then editable. **Injected into the synthesis pass** so the report answers what the client wanted to know. |
| `setup_provenance` | `jsonb` `{agenda?,panel?,glossary?,objectives?}` | Source-document filename each pre-filled setup field came from. `{}` for hand-typed fields. |
| `confidentiality_class` | `text` CHECK | `public \| internal \| client_confidential` (default) `\| restricted`. Stamped on exports. |
| `signoff` | `jsonb` `{approved_by, approved_by_member_id?, approved_at, note?}` | Analyst sign-off; NULL until the report is approved for distribution. |
| `analyzed_config_version` | `int` | The `recording_config_versions.version_number` whose snapshot produced the current `analysis_summary`. Drives the "Config vN" footer stamp. |

**`recording_config_versions`** — config snapshot history for traceability. A row is written on **every analysis run** (`source='analysis'`) and whenever the user clicks **"Save version"** (`source='manual'`):

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `recording_id` | uuid FK | parent recording |
| `org_id` | uuid | denormalized; pairs with `id` on service-role reads |
| `version_number` | int | 1-based, monotonic per recording (`UNIQUE(recording_id, version_number)`) |
| `snapshot` | jsonb | full project config at snapshot time (`RecordingConfigSnapshot` in `lib/recordings/types.ts`) — name/session_type/setup_inputs/meeting_profile/presentation_outline/brand+agent/analysis_org/analysts/objectives/confidentiality_class |
| `source` | text CHECK | `manual \| analysis` |
| `change_note` | text | optional note on a manual save |
| `created_by` | uuid | |
| `created_at` | timestamptz | |

RLS enabled with the standard org-scoped read policy.

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

**Gate 1 — analysis is on-demand.** The pipeline does **not** run end-to-end on a single trigger. `processRecordingWorkflow` runs Upload → Extract → Transcribe and then **pauses** at `status='transcribed'`. The expensive Analyze pass (Opus + Sonnet, ~$1) never auto-fires: the user reviews the transcript on the status surface, optionally refines the agenda / panel roster / adds a free-text steer, then explicitly triggers `analyzeRecordingWorkflow` via `POST /api/recordings/[id]/analyze` (§ 4.2b). This is split into two WDK runs:

```
processRecordingWorkflow:  queued → extracting → transcribing → transcribed   ← PAUSE (awaiting user)
analyzeRecordingWorkflow:  transcribed → analyzing → complete                 ← user-triggered
```

Gate 2 (the polished/formatted report + PDF deliverable, § 4.5) is likewise on-demand by design — it is a separate user-invoked export route, never produced automatically as part of the pipeline.

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

##### Per-channel speaker separation (split-mic stereo, sql/122)

When the extracted audio is **genuinely stereo** (`recordings.audio_channels = 2` — e.g. a RØDE Wireless PRO receiver in **Split** mode, mic 1 = Left, mic 2 = Right; or any true-stereo upload), `transcribe.ts` swaps `diarize=true` for **`multichannel=true`**. Deepgram then transcribes each channel independently and stamps every utterance with its `channel`, which becomes the speaker — **deterministic per-mic separation instead of voice-signature clustering** (clustering routinely collapses two distinct voices on a single mono mix into one speaker). Each segment carries both `speaker` (`S1`/`S2`) and `channel` (0=L, 1=R); the report shows the source mic ("Mic 1 · L") next to the speaker tag.

**Visualization.** A split-mic transcript is color-coded by source mic in the report (`TranscriptTab`): Mic 1·L plain dark, Mic 2·R indigo + italic, with a legend — layered with the Q/A bold/italic audit overlay (color is the channel signal so it never clashes with role styling). The mic test mirrors this: a stereo device shows two colored caption lanes (L/R), one live Deepgram stream per channel. (Open caveat — overlapping/simultaneous speech across the two mics interleaves in the chronological list; a two-lane time-aligned transcript view is the planned next step.)

Channel detection is automatic, in `extract.ts`:
1. `ffprobe` the source channel count; `< 2` → mono (`-ac 1`, today's path).
2. For 2-channel sources, measure left-minus-right energy over the first 2 min. **Dual-mono** files (2 channels, identical content — common from phones/cameras) collapse to near-silence and are treated as **mono**, so they never produce a phantom second speaker. Genuine split-mic stereo is preserved (`-ac 2`, 64kbps).
Any probe failure fails safe to mono. The live-capture client requests `channelCount:{ideal:2}` so a split-mic receiver delivers 2 channels (a mono mic delivers 1); the same auto-detection then runs on the recorded blob.

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
2. **One Q→A pair per distinct question.** When the same asker chains multiple questions in a single turn (e.g. "Hi, my question is X. Also, can you address Y?") OR when an answer is followed by the asker's follow-up question and a separate answer ("Q1 → A1 → Q2 → A2"), emit each pair as its own extraction in order. Do NOT merge multiple questions into one extraction. This is the most common miss in the manual PM-1 baseline — explicit instruction is required. (Added 2026-05-30 from user review of PM-1 pilot output.)
3. For each question, classify question_typology: "ask" | "complaint" | "commentary" | "clarification". Only "ask" types should be marked as actionable; the others are kept for the appendix.
4. Use ONLY the agenda topics above as section headers. If a Q/A genuinely doesn't fit any agenda topic, put it under "Other" — do NOT invent new section names.
5. Quote the question and answer verbatim from the transcript. Do not paraphrase.
6. If the asker self-identifies (e.g. "Hi I'm Maria from Apopka"), capture asker_name.
7. If the panelist who answered is identifiable from the transcript (e.g. "Thanks Maria, this is John responding..."), capture panelist_name.
8. Include start_sec + end_sec timestamps pointing at the question's start in the transcript.

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
3. **Synthesis third pass — Claude Sonnet 4.6** (added 2026-06, `buildQaSynthesisPrompt`). Runs over **all Q&A pairs** (including `flagged_for_review` ones), after the curator settles topics. Produces the deck/report narrative layer → `recordings.analysis_summary`: `executive_summary`, `headline`, per-topic `topic_summaries`, `decisions`, and `action_items` (appended as `action_item` extraction rows). **Counts are computed in code, not by the model** — `sentiment_breakdown` and `qa_count` are derived deterministically from the pairs so deck numbers always reconcile. **The set must match the report page exactly**: the page shows flagged pairs (just marked) and counts them, so synthesis and the PPTX deck (`lib/pptx/recordingDeck.ts`) both count flagged pairs too. Filtering flagged pairs out of synthesis/deck while the page kept them was the "deck shows 18, page shows 19" mismatch (fixed 2026-06-04); the deck additionally re-derives every printed count from the pairs it renders rather than trusting a possibly-stale stored summary. Skipped on topic-scoped re-extracts and when there are no Q&A pairs at all. Failure is non-fatal: `analysis_summary` is left null and the pipeline still completes with the Q&A pairs. **Objectives steer it (§2.8, 2026-06-07):** the recording's `objectives` ({summary, questions}) are threaded `analyzeRecording → synthesizeQa → buildQaSynthesisPrompt` and injected as an "ANALYSIS OBJECTIVES" block so the exec summary + topic summaries address what the client wanted answered — explicitly instructed to never invent facts/sentiment to satisfy an objective the meeting didn't cover.
4. **Polish fourth pass — Claude Sonnet 4.6** (added 2026-06, `buildQaPolishPrompt` / `polishQaPairs` in `analyze.ts`). Runs over **all Q&A pairs** → written **additively** onto the payload as `polished_question` / `polished_answer`; the verbatim `question`/`answer` stay the record of truth. Targets a professional agency **"Q&A Forum"** document (the NOWOCATS vendor sample is the bar). Two jobs per pair: the **question is synthesized** into one crisp standalone question that strips preamble/cross-references but keeps the resident's specific concern in `(specifically …)` (the vendor technique); the **answer is a faithful cleanup** (remove filler/false-starts/crosstalk, fix grammar, keep every figure/name/date/commitment, never invent or drop substance), in complete neutral professional sentences. **Terminology rules on both sides:** road/route designations as numerals using ONE consistent abbreviated form per answer (`SR 436` / `US 441` / `CR 435` / `I-4` — never mixing "State Road 441" and "SR 436" in the same response), including spoken number-words ("four thirty six State Road" → SR 436); agency/program acronyms expanded on first use (`FDOT`, `ITS`). The `(specifically …)` parenthetical is appended to a question only when it adds a place/detail not already stated in the question. Strictly neutral, no spin. Accepts an **optional `glossary`** of canonical entity spellings to normalize against (LLM handles phonetic ASR mis-hearings that edit-distance fuzzy matching misses). The glossary is built by `glossaryFromEntities` = the confirmed entity map's canonicals (§3.5b) ∪ any manually-typed **New Town Hall wizard** "Names & terms" entries (`setup_inputs.glossary: string[]`), threaded into `analyzeRecording`/`reanalyze`/`regenerate`. Non-fatal: on failure the fields are left unset and every surface falls back to the verbatim text. **Also re-run on single-pair regenerate** (`regenerate.ts`) so a regenerated pair keeps a polished version. Cost ≈ $0.25.
5. **Presentation-scope classification — Claude Sonnet 4.6** (§3.5e, added 2026-06-07, `buildScopeClassifyPrompt` / `classifyPresentationScope` in `analyze.ts`). Runs **only when the meeting had a presentation** — `runAnalyze` passes `presentationContext` (built by `buildPresentationContext`: the slide `presentation_outline` titles/key-points/figures, or the presentation-phase transcript as fallback). One batched call labels each Q&A pair `payload.presentation_scope` = `in_scope` (about presented material) or `out_of_scope` (a different agenda item / general / off-topic), grounded strictly in the presentation summary. Mutates the pair payloads in place (same refs as the extractions). Pre-fills the reviewer's manual flag (§3.5d) — which still overrides. Non-fatal (no-op on failure); skipped for pure-Q&A meetings. Cost ≈ $0.05–0.15.

### 3.5b Entity-spelling normalization (sql/100)

ASR mis-hears proper names **phonetically** ("Babuji"→"Babu G", "NOWOCATS"→"no what cats"), which edit-distance fuzzy matching can't catch. So after transcription (best-effort, at the end of `processRecordingWorkflow`, before the `transcribed` gate) `extractEntities` (`lib/recordings/entities.ts`, Sonnet ≈ $0.10) pulls the proper nouns and **clusters the variants the transcriber produced** under a best-guess canonical → `recordings.entity_map` (`{ entities: [{canonical, variants[], type, mentions}], extracted_at, reviewed_at? }`). The user reviews/corrects the map at the gate (edit canonical, merge/drop/add). The confirmed map then:
- **(a) feeds the polish glossary** (`glossaryFromEntities`) so the polished Q&A uses correct spellings, and
- **(b) powers a deterministic "Corrected" transcript view** (`normalizeSegments` — whole-word, case-insensitive, longest-variant-first variant→canonical replace). **The raw ASR transcript is never mutated** — the corrected view is derived on read, so the record of truth is preserved (the "two transcripts" model).

Future sources for the map: auto-extract from uploaded slides/agenda via vision, or the dataset entity catalog (same `entity_map` shape).

### 3.5c Brand-entity convergence (sql/103)

A recording can name a **brand** and/or an **underlying agent** (set in the New Town Hall wizard, persisted as `recordings.brand_tag` + `recordings.underlying_agent_id`) so the meeting's spelling correction draws on that brand's already-curated entity catalog instead of starting from scratch. At the entity-extraction step (`runEntityExtraction`, before the gate), `fetchBrandEntities` (`lib/recordings/brandGlossary.ts`) reads two sources and unions them by slug:
- the **brand collection's** `entity_catalog` (collection scope) — resolved from `brand_tag` via the same `slugify` the sql/062 trigger uses (`collections` where `kind='brand'`); and
- the **linked agent's** `entity_catalog` (bot scope, `scope_id = underlying_agent_id`) — bots aren't collection members, so their entities are unioned in at read time (the "bridge").

Those known canonicals do double duty: they're injected into the extraction prompt (`buildEntityExtractionPrompt` "Known entities for this organization" block) so ASR phonetic variants cluster under the **right** spelling, and they're merged into the saved `entity_map` (`mergeBrandEntities` — brand canonical + type win on a slug match, meeting variants unioned, brand entities not mentioned still seeded) so the review gate is pre-filled and the corrected-transcript view has every alias. The reviewer still edits at the gate.

**Reverse direction:** when `brand_tag` is set, the meeting's derived dataset inherits it (`lib/recordings/mirror.ts`) → the sql/062 trigger folds the dataset into the brand collection, so the meeting's own Q&A feeds brand-level entity analysis. Category mapping `entity_catalog.category → EntityType`: person→person, place→place, organization/brand→org, product/program/policy/event→project, else→term. Both columns nullable — a recording with neither behaves exactly as before. `shapes reconcile: entity_catalog.aliases ≈ entity_map.variants`.

Also: the Opus extraction now classifies a `payload.sentiment` per pair (`positive|neutral|negative|mixed`) — no extra call.

**Cost per 60-min meeting:** Opus extraction ≈ $0.75 (35K input + 3K output) + Sonnet curator ≈ $0.20 + Sonnet synthesis ≈ $0.25 + Sonnet polish ≈ $0.25 → **~$1.45 total Claude cost**. Negligible vs target $5K customer pricing.

**Post-pilot:** A/B Sonnet-only vs Opus+Sonnet curator on a 10-meeting corpus to see if the curator pass alone with a cheaper extractor is sufficient at the production volume. For the June 16 pilot — use Opus.

### 3.5d Human edit layer — three versions per pair

A Q&A pair carries three text layers, none destroying the one before it: **verbatim** (the spoken words, record of truth, locked) → **AI polished** (`polished_*`) → **human-edited** (`edited_*`, new). `lib/recordings/qaDisplay.ts` (`displayQuestion`/`displayAnswer`, pure + client-safe) is the **one** place precedence is resolved — `edited → polished → verbatim` (with a `verbatim: true` override for the share-link verbatim setting and the per-card toggle). Every display surface imports it (report card, `/th`, PDF, PPTX) so they never drift.

A reviewer hand-edits via the report's Q&A card **✎ Edit** pill → a modal showing, per side, **Verbatim (reference) · AI version (read-only) · editable box**. Saving `PATCH /api/recordings/[id]/extractions/[extractionId]` writes only the provided edits and never touches the AI + verbatim, so an edit is always undoable — distinct from **Regenerate** (which re-runs the AI). The route accepts **any combination** of: `{ edited_question?, edited_answer? }` (payload; stored only when different from the AI version, null/empty clears → "Revert to AI", stamps the §3.5d audit trail), `{ presentation_scope? }` (payload; `in_scope`/`out_of_scope`/null), and `{ start_sec?, end_sec? }` (the **segment columns** — validated `end > start`; the edit-pane player's trim handles write these). The `dataset_rows_flat` mirror keys on verbatim text (for analytics) and is intentionally not re-keyed by an edit (its `_start_sec` metadata can lag a span trim — acceptable). No migration — `edited_*`/`presentation_scope` live in the existing JSONB payload; start/end are existing columns.

**Adjust the segment span (2026-06-07):** the edit-pane `SegmentAudioPlayer` has trim controls — scrub to the real boundary, then **⇤ Set start** / **Set end ⇥** capture the playhead, and **Save segment** PATCHes `start_sec`/`end_sec`. Fixes a mis-anchored span so the clip (and the timeline) matches the actual answer. Pairs with no timestamp can be given one this way.

**Presentation scope flag (2026-06-07):** for meetings that had a presentation (profile has a `presentation` phase, or a `proceedings_summary` exists), each Q&A card shows a **Scope: In presentation / Outside scope** toggle (sets `presentation_scope`; toggling the active value clears it), a collapsed-header badge, and the Q&A tab gains **In presentation / Outside scope** filter chips. Human-flaggable; ALSO auto-classified by the analyzer when the meeting had a presentation (§3.5e) — the AI pre-labels each pair and the human toggle overrides.

**Audit trail:** every edit also stamps `edited_at`, `edited_by` (the user id) and `edited_by_name` (their display name at edit time) into the payload; all three clear together when the pair is fully reverted to AI. The report card shows "edited by {name} · {date}" next to the **Human-edited** badge.

**Listen-while-editing:** the edit modal embeds a `SegmentAudioPlayer` (added 2026-06-07) scoped to the pair's `[start_sec, end_sec]` slice of the stitched audio (signed URL via §4.12) — SVG play/pause + replay-segment + scrub-within-segment + a 1×/1.25×/1.5×/2× speed toggle. It starts at the pair's `start_sec`, and the scrubber's right edge **marks the segment end** (`end_sec`) with a visible end cap + an "{mm:ss} (end)" label; playback **clamps to and stops at** that end. Pairs without an end timestamp play the full meeting. So the reviewer hears exactly the answer's audio while correcting the transcription.

### 3.6 Coverage report

After the analytical pass, compute:

- **Per-agenda-topic extraction density** — count of extractions per topic. Topics with 0 extractions flagged.
- **Per-minute extraction density** — extractions per minute of source audio. Stretches of 5+ minutes with 0 extractions flagged (potential miss).
- **Confidence histogram** — distribution of `confidence` values. Bottom decile auto-marked `flagged_for_review=true`.

Coverage report is stored as JSONB on `recordings.coverage_report` and rendered in the HTML report's "Coverage" tab.

#### Known issues

**1. Per-topic density double-counts a topic when agenda casing ≠ extraction casing. — FIXED 2026-06-04.** `perTopic` (`lib/recordings/coverage.ts`) reconciled agenda topics to extraction topics by **exact string equality**. Since extraction is topic-agnostic and the Sonnet curator clusters into *emergent* topics (§ 3.5), the curator's label drifts in casing/whitespace from the raw agenda string — e.g. agenda `"Project timeline"` vs pairs tagged `"Project Timeline"` produced a false **⚠️ "Project timeline" (0)** row *plus* a real `"Project Timeline" (9)` row. **Fix applied (surgical):** `perTopic` now keys counts by `topic.trim().toLowerCase()`, emits the canonical agenda label, and only appends a non-agenda topic when it's genuinely absent after normalization — collapsing the split into one row. Regression test in `tests/unit/recordings/coverage.test.ts` ("reconciles agenda topics … by normalized casing"). Because the Coverage tab recomputes coverage live (`computeCoverage` from the current pairs), existing recordings self-heal on next view — no re-extract needed. **Deeper fix also applied 2026-06-05:** the curator prompt (`buildQaCuratorPrompt`, rule B-GROUP) now instructs the model to copy a matching agenda topic's string **verbatim** (no re-casing/rewording) and only Title-Case topics it names itself — so stored `topic` values stop drifting at the source. The display-layer normalization stays as a backstop for older recordings.

**2. Adjacent timeline blocks can overlap (e.g. #10/#11). — FIXED 2026-06-04 (lane staggering).** The "Meeting timeline" positions each Q&A block by timestamp; two pairs with near-identical starts rendered stacked, hiding a number. **Confirmed against NOWOCATS Meeting 2:** #10 (1435–1465s) and #11 (1443–1602s) are **two genuinely distinct questions** — NOT a duplicate; their Opus span estimates simply overlap (#10 nests inside #11). So the duplicate-at-extraction hypothesis didn't apply; it was a renderer concern. **Fix applied — two layers:**
- **Root cause (span tightening, persisted at analyze-time):** `tightenSpansFromTranscript()` (`lib/recordings/transcriptRoles.ts`) re-anchors each pair's stored `start_sec/end_sec` to the REAL ASR timestamps of the transcript segments it matches — global assignment (each segment → its single best-matching pair by word overlap, gated to the loose span) so two overlapping Opus estimates can't both claim the shared segments. Runs in `analyzeQa` after extraction, before persist; per-pair fallback to the estimate when nothing matches. **Verified on Meeting 2:** #11's start moved 1443→1470 (after #10 ends), all overlaps dissolved → the whole timeline collapses **2 lanes → 1**. This is the deterministic alternative to a costly/non-deterministic second AI pass. *Applies to new recordings on extract; existing recordings need a re-extract or a deterministic backfill (read transcript + pairs → tighten → UPDATE spans, no AI).*
- **Backstop (lane staggering, display):** `packLanes()` (`lib/recordings/timeline.ts`) still stacks any residual genuine overlap (simultaneous speech) into separate lanes so a block never hides another's number, across the Coverage tab, share page, PDF (`renderTimelineHtml`), and the PPTX deck (`recordingDeck.ts`). Tests in `tests/unit/recordings/{timeline,transcriptRoles}.test.ts`. **Backfill:** `scripts/backfill-recording-spans.ts <id>|--all` re-tightens existing recordings deterministically (no AI). Run on NOWOCATS Meeting 2 (the only complete recording) 2026-06-05 — 15/17 pairs tightened, 0 overlaps, timeline collapsed 2 lanes → 1.

### 3.7 Mirror

For each `recording_extractions` row, insert a corresponding `dataset_rows_flat` row against the recording's `dataset_id` per the mapping in § 2.6. Updates `datasets.row_count`. Triggers schema refresh (`dataset_state.schema_config`) so the wizard's auto-detected fields are present.

### 3.8 Render

- HTML report at `app/recordings/[id]/report/page.tsx` — server-rendered from the `recordings` + `recording_transcripts` + `recording_extractions` rows. Auth-gated (`requireOrgAccess`).
- **PowerPoint export (built 2026-06):** `POST /api/recordings/[id]/export/pptx` (§4.13) → Datanautix-branded `.pptx` via `lib/pptx/recordingDeck.ts`. Wired to the report's **Export** tab.
- **PDF export (built 2026-06-04):** `POST /api/recordings/[id]/report/pdf` (§4.5) → puppeteer-core + `@sparticuz/chromium` renders the baked HTML (`renderTownHallReportHtml`, mirrors the `/th` share page) and **streams** the PDF (no Storage round-trip). Body `{ includeTranscript }` appends the spelling-corrected transcript. Wired to the report's **Export & Share** tab.
- XLSX export: `POST /api/recordings/[id]/report/xlsx` — server-side XLSX generation from `recording_extractions` payloads. Columns per `unit_type` per § 2.6 mapping plus.

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

**Response (201):**
```json
{
  "recording_id": "uuid",
  "upload": {
    "protocol": "tus",
    "endpoint": "https://<project>.supabase.co/storage/v1/upload/resumable",
    "bucket": "recordings"
  },
  "files": [
    { "id": "uuid", "original_filename": "GX010114.MP4", "storage_path": "<org>/<rec>/GX010114.MP4", "upload_url": "https://<project>.supabase.co/storage/v1/upload/resumable" },
    { "id": "uuid", "original_filename": "GX020114.MP4", "storage_path": "<org>/<rec>/GX020114.MP4", "upload_url": "https://<project>.supabase.co/storage/v1/upload/resumable" }
  ]
}
```

Browser uses `tus-js-client` against `upload.endpoint` with the user's Supabase session JWT in the `Authorization` header and per-file metadata `{ bucketName, objectName: <storage_path>, contentType }`. Per-file `upload_url` is included for clients that prefer to keep the TUS endpoint inside the per-file object — it's the same string as `upload.endpoint` today.

**Validation:** soft caps enforced server-side — at most 20 files per recording, at most 20GB per file, no duplicate filenames within a recording, `session_type` ∈ enum, `asr_strategy` ∈ enum, `confidentiality_class` ∈ enum (if present).

**Attribution + intake fields (§2.8, all optional):** the body also accepts `analysis_org` (defaults to `Datanautix`), `analysts` (`[{name, member_id?}]`), `objectives` (`{summary, questions[]}`), and `confidentiality_class`. Set when provided; `analysis_org` otherwise falls back to the column default.

**Setup-before-media:** `files[]` is **optional**. An empty/absent `files[]` creates the project in `status='awaiting_media'` (no `recording_files`, no upload payload — response is just `{ recording_id, status: 'awaiting_media' }`). The setup wizard (§5.2) always creates this way; media is attached later via §4.1c. When `files[]` is present the per-file rules above (incl. ≥1 media) still apply and the project is created in `uploading`.

**Rollback:** if the `recording_files` insert fails after the `recordings` row was created, the route deletes the recordings row before returning the error so the user isn't left with a phantom.

### 4.1a `POST /api/recordings/[id]/files/[fileId]/uploaded` — ack upload completion

Companion to § 4.1. Called by the wizard after each TUS upload succeeds; flips `recording_files.upload_status` from `'pending'` to `'uploaded'`. Idempotent: returns `{ already: true }` if the file is already past 'pending'.

**Server-side guard:** before flipping the flag, the route calls `storage.from(BUCKET).list(dir, { search: basename })` and verifies the object actually exists at the expected `storage_path`. Stops a hostile or buggy client from marking a non-existent file as uploaded (which would surface as an opaque extract failure later).

**Response:** `{ ok: true, upload_status: 'uploaded' }` or `{ ok: true, upload_status: 'uploaded' | 'extracted', already: true }`.

### 4.1c `POST /api/recordings/[id]/files` — attach media to a set-up project

Companion to §4.1 for the setup-before-media flow. Adds media (and an optional slide deck) to a project sitting in `awaiting_media`/`draft`, then flips it to `uploading`. Same request/response contract as §4.1 (`{ files: [...] }` → `{ recording_id, upload, files }` with the TUS endpoint + per-file storage paths). The "Add recording" pane (§5.3a) then uploads via TUS, acks each file (§4.1a), and calls §4.2.

**Guards:** same-tenant `(id, org_id)` pair; accepts `awaiting_media`/`draft` **and `uploading`** — the last is a **recovery state**: a prior attach flipped the project to `uploading` but the upload never completed (browser closed, TUS failed, or a stray/wrong file was dropped), which previously bricked the project (every retry 409'd with no UI path out). On a re-attach from `uploading` the route first **deletes the stale (not-yet-processed) `recording_files` rows** before inserting the fresh set — safe because nothing past `uploading` has run (process() flips it to `queued`, so no file can be `extracted`). **409** only for a project already in/through the pipeline (`queued`+). Same per-file validation as §4.1 (≥1 media, ≤20 files, ≤20GB, ≤1 PDF deck). If a slide deck is attached and the project has a `meeting_profile`, the route sets `meeting_profile.has_slides=true` so the vision/presentation pass runs.

### 4.1d `POST /api/recordings/extract-setup` — propose setup fields from a document

Setup-before-media doc ingestion. The wizard (§5.2) uploads the deck that *will* be presented and gets back proposed setup fields to confirm. **Multipart** `file` (PDF, ≤50MB) → `{ proposal: { objectives:{summary,questions[]}, agenda[], panel[], glossary[] }, source: <filename> }`.

**Stateless:** the PDF is uploaded to a temp path under `<org>/_setup-extract/<uuid>/`, rendered to page PNGs + read with Claude vision in one pass (`lib/recordings/setupExtract.ts`, reusing the slide-vision rails), then **all temp objects are deleted**. Nothing is persisted to a recording — the analyst confirms the proposal in the wizard (it pre-fills only empty fields, recording `setup_provenance`), and the deck itself is attached later with the recording as a `slides` file (or now via §4.1e in the Setup editor). v1 is PDF-only (PPTX/DOCX → convert-to-PDF first, future). The prompt is grounded — it proposes only what's on the slides, empty when unsure.

### 4.1e `POST /api/recordings/[id]/documents` + `DELETE …/documents/[fileId]` — persist project documents (documents-anytime, 2026-06-07)

Edit-anytime document persistence — attach the deck + briefs to a recording at **any lifecycle stage** (the unified Setup editor §5.7 uses these; create mode can't, since no recording exists yet). Unlike §4.1c (media, TUS), documents are small so this is a **direct multipart upload** (`file` + `role`):

- `role='slides'` — the presentation deck (PDF). Stored as `file_role='slides'` so the pipeline vision-reads it (`ingestSlides`) on the next analysis; sets `meeting_profile.has_slides=true`. **At-most-one** — a new deck replaces the old (old storage object + row removed first). PDF-only (v1).
- `role='document'` — a brief / agenda / reference doc. Stored as `file_role='document'` (sql/119); kept for reference, **not** pipeline-processed. Any type, ≤50MB.

Inserts a `recording_files` row (`upload_status='uploaded'`, `is_video=false`, `sort_order` after existing) at `<org>/<rec>/<name>` (slides) or `<org>/<rec>/docs/<name>` (documents); returns `{ file }`. **DELETE** detaches one document (storage object + row), org-paired `(id, recording_id, org_id)`, and **refuses media files** (`400` unless `file_role ∈ {slides, document}`). Both org-gate via `getUserContext` + `.eq('org_id', …)` (admin-org may reach any org). Tests in `tests/integration/recordings-routes.test.ts`.

### 4.2 `POST /api/recordings/[id]/process` — start the pipeline

Called after all files report `upload_status='uploaded'`. Transitions `uploading → queued` and starts `processRecordingWorkflow`, which runs extract → transcribe and **pauses at `status='transcribed'`** (Gate 1). It does **not** run the analysis pass. Idempotent: accepts `status='uploading'` or `'failed'` (restart from the beginning); any other status returns `{ already_running: true }`.

### 4.2b `POST /api/recordings/[id]/analyze` — generate Q&A pairs (Gate 1, user-triggered)

Called from the review-and-generate gate (§ 5.3) once the pipeline is paused at `status='transcribed'`. Starts `analyzeRecordingWorkflow` (analyzing → complete), which runs the Opus + Sonnet two-pass on the stored transcript, mirrors extractions into `dataset_rows_flat`, and computes coverage.

**Auth:** session cookie + CSRF. Same-tenant `(id, org_id)` pair.

**Body (all optional):**
```json
{
  "setup_inputs": { /* full edited QaSetupInputs — agenda[], panel[] */ },
  "instructions": "free-text steer appended to both Opus + Sonnet prompts",
  "skip_qa": false
}
```

If `setup_inputs` is present it replaces `recordings.setup_inputs` before analysis (last-minute agenda / panel-roster fixes that steer extraction quality). `instructions` ≤ 4000 chars. **`phase_map` (meeting tool):** for a community meeting, the gate's "Presentation ends at [mm:ss]" control sends an edited two-phase map; the route persists it (`edited_by_user:true`) before the workflow runs, so analysis scopes Q&A to the confirmed Q&A span and summarizes the presentation span. Accepts `status='transcribed'` (first generation) or `'failed'` (retry the analysis pass without re-transcribing); other statuses return `{ already_running }`.

**Q&A extraction is optional — `skip_qa` close-out.** Not every town hall is a Q&A; some are open listening sessions (community members venting, no question/answer structure). When the gate's **"Finish without Q&A"** action sends `skip_qa:true`, `runAnalyze` skips the Opus/Sonnet Q&A pass, the dataset mirror, coverage, and the synthesis summary — the **transcript is the deliverable** — but still builds the presentation summary (`proceedings_summary`) when a deck phase exists. The recording completes normally (`analyzing → complete`); the report opens on the Transcript tab (no Q&A pairs, so the default falls back from Coverage to Transcript). The user can still run full Q&A later (status returns to a re-generable state via the gate). No Q&A billing on this path (only the cheap presentation summary if applicable).

### 4.3 `GET /api/recordings/[id]` — status + details

Drives the status surface (§ 5.3) and the report page header.

**Response shape:**
```json
{
  "recording": { /* row minus segments/extraction payloads */ },
  "files": [ /* recording_files rows, sort_order ASC */ ],
  "transcript": { "id", "vendor", "language_detected", "word_count", "duration_sec", "cost_cents", "completed_at" } | null,
  "extraction_count": <int>,
  "share": { "enabled": <bool>, "expires_at": <iso|null>, "token": <string|null> }
}
```

Deliberately omits `recording_transcripts.segments` and `recording_extractions.payload` — those are large and only the report page (server-rendered) needs them. `share.token` is returned to any member of the owning org (share management is org-wide, §4.7); the fetch is `id`+`org_id`-scoped so this never crosses tenants.

### 4.3b `PATCH /api/recordings/[id]` — rename / transfer (built 2026-06-04)

One handler, two modes, both reading the recording by id paired with the caller's org (admin-org may reach any org → 404 on cross-org):

- **Update** — body may carry any of `{ name?, brand_tag?, underlying_agent_id?, analysis_org?, analysts?, objectives?, confidentiality_class?, meeting_date?, location?, language?, setup_inputs?, meeting_profile? }`. Owner / org-admin / platform-admin. `name` trim ≤200; `analysts` sanitized to `[{name, member_id?}]`; `objectives` to `{summary, questions[]}` or null; `confidentiality_class` validated against the enum; `setup_inputs` must be an object; `meeting_profile` an object or null. This is the **edit-anytime** path — the unified Setup editor (§5.7) PATCHes any of these at any lifecycle stage. **Metadata** fields (name/date/location/analysts/org/confidentiality/brand/agent) take effect immediately; **analysis-shaping** fields (`setup_inputs`, `meeting_profile`, `objectives`) are saved but only change the Q&A on a re-analyze (a config-version drift check surfaces a "re-analyze to apply" prompt).
- **Transfer** — body `{ org_id }`. **Platform-admin org only** (403 otherwise) — a cross-tenant move. `checkTransferTarget` validates the destination is an active org and not the current one. Then `transferRecordingOrg()`: (1) relocates every storage object under `<fromOrg>/<id>/…` to `<toOrg>/<id>/…` via `storage.move`, rolling the moves back if any non-"not found" failure occurs; (2) calls the `transfer_recording_org(p_recording_id, p_from_org, p_to_org)` RPC (sql/102) — one transaction that re-org_id's `recordings` + `recording_files` + `recording_transcripts` + `recording_extractions` + the derived `datasets` row (paired on `p_from_org` as the cross-tenant guard) and rewrites the embedded `<org>/` prefix in `recording_files.storage_path`/`audio_storage_path`; on RPC failure the storage moves are rolled back. `dataset_rows_flat` has no `org_id` (keyed by `dataset_id`) so it follows the dataset. Finally `recordOrgTransfer` writes an `org_transfers` audit row. The RPC is `SECURITY DEFINER` with `SET search_path`, exec **revoked from `anon`/`authenticated`** and granted only to `service_role`, so a tenant can't call it directly via PostgREST to bypass the route gate. Gate covered by `tests/integration/recording-transfer-gate.test.ts`.

### 4.4 `POST /api/collections/[id]/members` — **NEW** (fills the gap)

**Auth:** session cookie + CSRF.
**Body:** `{ dataset_id: string, label: string }`

- Insert into `collection_members`.
- Re-run `buildMergedCollectionSchema()` and update the virtual dataset's `dataset_state.schema_config`.
- Update `datasets.row_count` (sum across members).
- Same-org rule: dataset must belong to the same org as the collection.

Also: fix existing `DELETE /api/collections/[id]?member=X` to re-run schema rebuild after a member is removed (and remaining > 0).

### 4.5 `POST /api/recordings/[id]/report/pdf` — PDF report (built 2026-06-04)

Server-rendered PDF of the **same report the public `/th` link shows** (§4.6). `lib/recordings/reportHtml.ts` (`renderTownHallReportHtml`, a pure function) bakes a self-contained inline-styled HTML doc mirroring `app/th/[token]/page.tsx` — meeting meta + exec summary + polished Q&A by topic (`polished_*`, fallback verbatim), Datanautix footer — then headless Chrome's `page.pdf()` renders it (`page.setContent`, **not** `goto`, so Tailwind isn't needed). Chrome resolution mirrors the Agent Study PDF route: `@sparticuz/chromium` on the Linux serverless runtime, an installed Chrome locally (key off `process.platform`, **not** `process.env.VERCEL`).

Body `{ includeTranscript?: boolean }`. When true, a **Full Transcript** appendix is appended on its own page — the **spelling-corrected** view (`normalizeSegments` applies the reviewed `entity_map` variants→canonical; raw ASR is never mutated), consecutive same-speaker segments merged into paragraphs. This is the one thing the public `/th` page never shows, so it's owner-gated by the same org check as the PPTX export.

The data-fetch + HTML bake + Chrome render live in the shared `lib/recordings/reportPdf.ts → renderRecordingReportPdf(service, rec, { includeTranscript })` (this route owns auth + the cross-org gate, then hands it a paired `rec`); §4.7a (send-to-principals → attach) reuses the same renderer.

**Cross-org gate** mirrors `export/pptx`: `getCallerOrgContext` + service-role read pairing `id` with the caller's `org_id` (admin-org may export any) → 404 on cross-org, 409 until `status='complete'`. Streams `application/pdf` (no Storage round-trip); fire-and-forget `logDeckDownload('recording-pdf-report', name)`. Wired to the report's **Export & Share** tab ("PDF report" card + "Include full transcript appendix" checkbox, default on).

### 4.6 Public report — `GET /th/[token]` (built 2026-06-04)

**No auth — gated purely by the token** (`/th` is reserved for Town Hall; PulseIQ moved to `/pi`). The page (`app/th/[token]/page.tsx`, server component, service-role lookup by `share_token` alone) **fails closed**: 404 unless the row exists AND `share_enabled=true` AND `status='complete'` AND (`share_expires_at` IS NULL OR `> now()`). Renders **only shareable fields** — meeting name/date/location, the exec summary, and the Q&A grouped by topic. Never the raw transcript, flags, confidence, cost, org, or IDs. Datanautix-branded footer.

**Polished vs verbatim (sql/104).** Per-recording owner setting `share_verbatim` (default FALSE) chooses what each Q&A pair shows: FALSE → the **polished** public-shareable text (`polished_*`, per-pair verbatim fallback); TRUE → the **verbatim** spoken words (`question`/`answer`). The meeting transcript stays private either way — this only swaps the wording on the Q&A pairs already shown. Set from the report's Export & Share tab (a Polished/Verbatim segmented control on the enabled link).

### 4.7 Enable/disable the public link — `POST /api/recordings/[id]/share` (built 2026-06-04)

Body `{ enabled: boolean, expires_in_days?: number, show_verbatim?: boolean }`. **Any member of the owning org (or admin-org)** — toggling the public link is an org-member action, like publishing a public link for a dataset (`created_by` is not the gate). Service-role read pairs `id` with `org_id` (404 cross-org). Mints a 24-char URL-safe token once (`randomBytes(18).base64url`), reused across enable/disable. Refuses to enable until `status='complete'` (409). `share_verbatim` is updated only when `show_verbatim` is present in the body, so toggling the link's enabled state never clobbers the polished/verbatim choice (and vice-versa) — the client sends the current state of the other field. Returns `{ enabled, token, path: '/th/<token>', expires_at, show_verbatim }`. Wired to the report's **Export & Share** tab (owner-only "Enable public link" toggle + copy-link + Polished/Verbatim segmented control).

The earlier `share_password_hash` idea is deferred; v1 is token-only with optional expiry. Sharing only mints/toggles the link — **emailing it to principals is a separate route** (§4.7a), so the toggle never sends anything by surprise.

### 4.7a `POST /api/recordings/[id]/report/send` — send to principals (built 2026-06-05)

Emails the report to a typed recipient list — the v1 "send to principals at end of meeting" deliverable. **Any member of the owning org (or admin-org)** (same gate as `/share`; an org-member action, `created_by` is not the gate); service-role read pairs `id` with `org_id` (404 cross-org), 409 until `status='complete'`. CSRF/same-origin via `proxy.ts`.

**Body** `{ recipients, note?, includeLink?, includePdf?, includeTranscript? }`:
- `recipients` — array **or** a comma/newline/semicolon-separated string; parsed, lowercased, email-validated, de-duped, capped at **25**. Unparseable addresses come back in `rejected` (not a hard failure unless *none* are valid → 400).
- `includeLink` / `includePdf` — the sender picks what to send; **at least one required** (400 otherwise). `includeLink` requires the public link to be **enabled + unexpired** (400 otherwise) and embeds `${NEXT_PUBLIC_BASE_URL}/th/<token>`. `includePdf` renders the PDF **once** (shared `lib/recordings/reportPdf.ts → renderRecordingReportPdf`, the same renderer §4.5 now uses) and attaches it (base64) to every recipient; `includeTranscript` appends the transcript appendix to that PDF.

**Email** — Datanautix-branded, since it's a client report deliverable (`lib/recordings/reportEmail.ts → buildReportEmail`: the "datanautix" wordmark — data teal + nautix orange — and a datanautix.com footer, **not** Sentimetrx). Body adapts to what's included (link button / "PDF attached" line / both) with an optional escaped sender note. From `Datanautix <reports@sentimetrx.ai>` (verified `sentimetrx.ai` domain), **reply-to = the sending user** so principals reach a human. Sent per-recipient through the Resend provider (extended with an `attachments` field). Returns `{ ok, sent, failed, rejected, results[] }`. Wired to the report's **Export & Share** tab ("Send to principals" owner-only card: recipients + optional note + include-link / attach-PDF (+ transcript) toggles + per-send result). XLSX export remains the last fast-follow.

### 4.8 `GET /api/recordings` — list (scoped by org)

Scope resolved from the caller's `userContext` (see `lib/userContext.ts`):
- `isAdminOrg` users: see all recordings across all orgs; `?org_id=X` narrows to one.
- Everyone else: see **all** recordings in their own org — org-wide visibility, the
  same as datasets/agents/studies (org isolation is by `org_id`; RLS policy
  `recordings_org_read` already grants org-wide read). A recording **transferred
  into** an org is therefore visible to that org's members regardless of who
  originally created it — `created_by` does NOT scope visibility. (Earlier this
  list restricted regular users to `created_by = self`, which silently hid
  transferred recordings from the recipient org — even from its owner — because
  the per-org "admin" tier was never wired to a per-org role; `isAdmin` in
  `userContext` equals `is_admin_org`, so that tier was dead for client orgs.)

Pagination via `?limit` (1–100, default 50) + `?offset` (default 0). Filter via `?status=` against the recordings.status enum (`uploading | queued | extracting | transcribing | transcribed | analyzing | rendering | complete | failed | cancelled`); unknown values 400.

**Response:**
```json
{
  "recordings": [{ "id", "org_id", "created_by", "name", "session_type", "meeting_date",
                   "status", "asr_vendor_chosen", "source_duration_sec", "cost_cents",
                   "created_at", "started_at", "completed_at" }],
  "pagination": { "limit", "offset", "total", "has_more" },
  "scope": "all" | "org" | "self"
}
```

The list response omits `setup_inputs`, `coverage_report`, and `error_message` — those are detail-view fields fetched via § 4.3 on click.

### 4.9 Feature management routes (admin-only)

- `PATCH /api/admin/orgs/[orgId]/features` — body `{ feature, enabled, quota_per_month? }`
- `PATCH /api/admin/users/[userId]/features` — body `{ feature, enabled, quota_per_month? }`

Both require `is_admin_org` user via `requireAdmin`.

### 4.10 `POST /api/recordings/[id]/extractions/[extractionId]/regenerate` — fix one card

**Added 2026-05-30 from user review of PM-1 pilot output.** Most "this looks wrong" moments are local — one answer's preview reads weirdly, one asker is mis-attributed, one topic chip is wrong. Re-running Opus on the full 35K-token transcript to fix one card is wasteful. This route regenerates a single `recording_extractions` row using Sonnet only.

**Auth:** session cookie + CSRF. Owner or org admin only.

**Body:** `{ instructions?: string }` — optional free-text guidance from the user (e.g. "the asker was the woman in the red coat, not the moderator"; "make the answer summary one sentence"; "topic should be Education, not Schools").

**Behavior:**
1. Verify recording is in `status='complete'` and the extraction belongs to it.
2. Sonnet 4.6 pass fed: the existing extraction row + the transcript span from `start_sec − 30s` to `end_sec + 30s` (pre/post context to catch corrections like "sorry, my name's actually Jane") + the recording's panelist roster + the recording's agenda topic list + `instructions` if provided.
3. Output is the revised `payload` (same shape per § 2.4), revised `topic`, revised `confidence`, recomputed `flagged_for_review`. `start_sec` / `end_sec` / `unit_type` are not edited by this route — span changes require a full or topic-scoped re-extraction (§ 4.11).
4. Update the single `recording_extractions` row in place.
5. Update the mirrored `dataset_rows_flat` row per § 2.6.
6. If `topic` changed, re-run `computeCoverage()` and update `recordings.coverage_report`. Otherwise skip — coverage is unaffected.
7. Bump `recordings.cost_cents` by the Sonnet cost.

**Response:** `{ extraction: ExtractionRow, cost_cents: number, coverage_report?: CoverageReport }`.

Cost: ~$0.005–$0.02 per call (Sonnet on a ~2K-token context). Quota: not counted — the recording was already counted at first-completion, and per-card edits are cheap enough that capping them is more friction than the savings warrant.

### 4.11 `POST /api/recordings/[id]/reanalyze` — re-extract pairs, with user instructions

For when the *structure* is wrong, not just one card — Opus missed a Q/A pair entirely, split one question into two, the topic chips don't match the agenda, or the prompt itself changed and the user wants a fresh pass. Re-uses the stored transcript; no ASR call.

**Auth:** session cookie + CSRF. Owner or org admin only.

**Body:** `{ scope: 'all' | 'topic', topic?: string, instructions?: string }`
- `scope='all'`: re-extract the entire meeting. Default.
- `scope='topic'` with `topic='Schools'`: re-extract only pairs currently tagged with that topic. Other topics' pairs are untouched.
- `instructions`: optional free-text guidance appended to the Opus system prompt as a "User notes" section (e.g. "you missed a question about parking near the new development"; "the 'Schools' chip should have been 'Education' throughout"; "asker names should default to 'Audience member' if not self-introduced"). Honored by both Opus and the Sonnet curator.

**Behavior — `scope='all'`:**
1. Verify recording is in `status='complete'`.
2. Delete existing `recording_extractions` for this recording and the corresponding `dataset_rows_flat` rows for the recording's dataset.
3. Re-run `analyzeRecording(transcript, { instructions })` — Opus 4.7 extract + Sonnet 4.6 curator on the full `recording_transcripts.segments`.
4. Re-run `mirrorExtractionsToDataset()`.
5. Re-run `computeCoverage()` and update `recordings.coverage_report`.
6. Bump `recordings.cost_cents` by the new Claude cost; bump `recordings.completed_at` to now.
7. **Re-snapshot + re-stamp `analyzed_config_version`** (edit-anytime Phase 4) — a full re-extract regenerates the whole analysis from the *current* config, so `snapshotConfigVersion(source='analysis')` runs and stamps the new version, which **clears the drift banner** (§5.4/§5.7). Best-effort (a snapshot hiccup doesn't fail the re-extract). `scope='topic'` does NOT re-stamp — it's a partial re-extract, not a full re-analysis against the whole config.

**Behavior — `scope='topic'`:**
1. Compute the topic-scoped transcript span: the union of all `[start_sec − 60s, end_sec + 60s]` ranges from existing extractions where `topic = X`, merged and clipped to the transcript bounds. (60s padding lets Opus catch boundary pairs the prior pass mis-attributed to an adjacent topic.)
2. Delete existing `recording_extractions` for this recording where `topic = X`, and the corresponding `dataset_rows_flat` rows.
3. Re-run Opus + Sonnet curator on the scoped span with `instructions` and a system note that this is a topic-scoped re-extraction for `X` — emitted pairs must be within the scoped time range and should default to `topic = X` unless the content clearly belongs to a sibling topic.
4. Append the new extractions, then re-mirror and re-run `computeCoverage()`.
5. Bump `recordings.cost_cents` by the new Claude cost.

**Response:** `{ extractions_count: number, replaced: number, coverage_report: CoverageReport, cost_delta_cents: number, scope: 'all' | 'topic' }`.

Cost: `scope='all'` ≈ ~$1 (Opus + Sonnet on the full transcript, no ASR). `scope='topic'` scales with the scoped span — typically $0.10–$0.40 for a 5–15 minute topic. Quota: not double-counted on either scope (the recording was already counted at first-completion).

### 4.12 `GET /api/recordings/[id]/audio` — signed URL for the stitched audio

**Auth:** session cookie — **401** unauthenticated, **403** authed-but-no-org, **404** cross-org (matching the other `[id]/*` action sub-routes; fixed 2026-06-07 — the route previously returned 401 for the no-org case). Loads the recording org-scoped, **with a platform-admin (admin-org) bypass** matching the status/report routes — a non-admin still pairs `(id, org_id)` so a bare id can't cross tenants. The signed URL path is built from the **recording's** org, not the caller's. (Bug fixed 2026-06-07: the route previously paired strictly on the caller's org and built the path from it, so a platform admin viewing another org's recording got a 404 "audio not available" even though `stitched.mp3` was present — that's why "play segment" failed on Arjun Pilots' NOWOCATS Meeting 2 viewed from the Datanautix admin org.) Mints a short-TTL (1h) signed URL for `<rec_org>/<recording_id>/audio/stitched.mp3` and returns `{ url, expires_in }`. Consumed by the report's segment players (§ 5.4, §3.5d). The TUS-uploaded source files are never exposed — only the canonical stitched mp3. Returns 404 if the object isn't present yet.

### 4.13 `POST /api/recordings/[id]/export/pptx` — PowerPoint deck (built 2026-06)

**Auth:** session cookie via `getCallerOrgContext` + the cross-org gate (`!isAdmin && rec.org_id !== orgId → 404`; admin-org may export any). Service-role reads, so the `(id, org_id)` pairing is the multi-tenancy guard — covered by `tests/integration/export-org-gate.test.ts`. Requires `status='complete'` else **409**.

Builds a Datanautix-branded `.pptx` via `lib/pptx/recordingDeck.ts` from the recording's `analysis_summary` + `proceedings_summary` + `recording_extractions`: Title → **Meeting Overview + per-item "What Was Presented" cards** (when a presentation phase exists) → Executive Summary (+ KPI strip) → Sentiment Overview → Conversation Themes (2 topic cards/slide) → Action Items & Decisions → **navy "Appendix" section divider** → **Appendix, one Q&A pair per slide**. The appendix renders the **polished** (public-shareable) question/answer when present, falling back to verbatim per pair (`input.polished`, default true; pass `false` to force verbatim). The **Conversation Themes** slides' representative exchanges (verbatim quotes the synthesis picked) are likewise resolved to their pair's polished text — matched by normalized question — so the theme slides read consistently with the appendix. Every section is skipped individually when its data is null/empty (the divider renders only when there is ≥1 Q&A pair); a pure Q&A recording renders exactly as before (title reverts to "Q&A Session Report"). Returns the binary with `Content-Disposition: attachment`. Logs to `deck_download_log` (`logDeckDownload`). No AI runs in the route — all synthesis happened at analyze time.

**Meeting-tool pipeline (sql/097):** `processRecordingWorkflow` runs a `runSlidesAndPhases` step after transcription (before the `transcribed` pause): vision-read the slide deck → `presentation_outline`, then `detectPhases` → `phase_map` (no-op for the single-phase Q&A preset). `runAnalyze` scopes Q&A extraction to the `qa` phase span (`slicePhaseSegments`, whole-transcript fallback) and, when the profile has a presentation phase, runs `summarizePresentation` → `proceedings_summary`. The user adjusts phase boundaries at the gate; the analyze route persists the edited `phase_map` before the workflow runs.

**Attribution on the deck (§2.8, 2026-06-07):** the title slide prints **Prepared by {analysts} · {analysis_org}** + **Config v{n}** + an **OBJECTIVE** block (when set) + a **sign-off** line (when approved); the footer's right side carries the **confidentiality classification** label (e.g. "Confidential — Client Only") instead of the fixed "Proprietary and Confidential". Fed from the new `recordings` columns via the export route.

### 4.16 `GET`/`POST /api/recordings/[id]/versions` — config version history (§2.8)

GET lists the recording's config snapshots (version_number, source `manual|analysis`, change_note, created-by name, created_at) + the live `analyzed_config_version`. POST takes a **manual** snapshot (`{change_note?}`, source='manual'). Auto snapshots (source='analysis') are written by §4.2b on each run, which also stamps `recordings.analyzed_config_version`. `snapshotConfigVersion` (`lib/recordings/configVersion.ts`) deduplicates — an unchanged config returns the latest version instead of inserting a duplicate. Org-scoped with a platform-admin bypass.

### 4.17 `POST`/`DELETE /api/recordings/[id]/signoff` — analyst sign-off (§2.8)

POST stamps `recordings.signoff = {approved_by, approved_by_member_id, approved_at, note?}` (approver name resolved from `users`); DELETE clears it. Drives the "✓ Approved by …" stamp on the report header, deck, and PDF. Org-scoped with a platform-admin bypass.

---

## 5. UI Surface

### 5.1 Dataset wizard — `/analyze/new`

Existing wizard adds a "Recording" tile alongside CSV / Google Reviews / Reddit / etc. Selecting it routes to `/recordings/new`.

### 5.2 Project setup wizard — `/recordings/new` (setup-before-media, 2026-06)

The wizard sets up the **project**, not the upload — a Town Hall can be configured before the audio/video exists. It's a pure two-column form (no media pane); media is attached later on the status page (§5.3a).

**Project documents (optional, doc-ingest):** above the form, an optional uploader takes the deck that will be presented (PDF). It POSTs to §4.1d and shows proposed **objectives / agenda / panel / glossary**; **Apply suggestions** fills only the *empty* fields (never overwriting the analyst's edits) and tags each populated field with a "✨ from {filename}" provenance hint (persisted in `setup_provenance`). The deck itself isn't stored here — it's attached with the recording (§5.3a) so the pipeline vision-reads it. Since the info exists pre-meeting, this is part of initial setup, but the same deck can also be added later at the add-recording step.

```
┌──────────────────────────┬──────────────────────────────────┐
│  Meeting                 │  Objectives & analysis            │
│  ─────                   │  ─────                            │
│  Name: [___________]     │  Objectives (summary)             │
│  Meeting type: [TH Q&A ▼]│  Questions we want answered       │
│  Meeting date: [______]  │  Analysis performed by:[Datanautix]│
│  Location: [_________]   │  Confidentiality: [Client conf. ▼]│
│  ▼ Panel members         │  ▼ Analyst(s) (pick or type)      │
│  ▼ Agenda topics         │  ▼ Brand & known entities         │
│  Names & terms           │  Language / ASR strategy          │
└──────────────────────────┴──────────────────────────────────┘
                          [ Create project ]  (enabled when name + ≥1 agenda topic)
```

- **Meeting type** (`town_hall_qa` | `community_meeting`, `lib/recordings/profiles.ts`) → `meeting_profile` (null for `town_hall_qa`). A community meeting's deck is uploaded with the recording (§5.3a), not here.
- **Objectives** — `{summary, questions[]}` (§2.8); steers the synthesis pass. Phase 3 will AI-propose these from an uploaded deck/brief.
- **Analysis performed by** (default `Datanautix`) + **Analyst(s)** — a `<datalist>` of org members so a name can be picked or free-typed; matched names resolve to `member_id`. **Confidentiality** — the §2.8 class, default `client_confidential`.

**Shared form (`components/recordings/RecordingSetupForm.tsx`):** the create wizard and the edit-anytime Setup page (§5.7) are **one component**, mode-switched. `RecordingWizardClient.tsx` is a thin `mode="create"` wrapper. In create mode it renders the brand/agent link + ASR-strategy controls and `POST`s; in edit mode those two are hidden (brand/agent lives in the report Export tab, ASR is fixed once processing starts) and it `PATCH`es.

**Drive sequence (create mode):** `POST /api/recordings` with **no files** → `{ recording_id }` in `awaiting_media` → `router.push('/recordings/[id]/status')`. No upload happens here.

**v1 scope:** session_type is locked to `qa` (the only type `analyzeRecording` supports today).

### 5.3 Status surface — `/recordings/[id]/status`

Server page hands an initial recording snapshot to `StatusClient.tsx`, which polls `GET /api/recordings/[id]` (§ 4.3) every 3s while the recording is non-terminal and stops once `status ∈ {complete, failed, cancelled}`. It also pauses polling at `status='transcribed'` (a stable wait state — nothing changes until the user acts); the gate's Generate flips status back to `analyzing`, which resumes the poll. Polling is likewise skipped for the setup/recovery states `draft`/`awaiting_media`/`uploading` (these render the Add-recording pane, not the ladder).

#### 5.3a "Add recording" pane (setup-before-media)

When `status ∈ {draft, awaiting_media, uploading}`, the status page renders `AddRecordingClient.tsx` instead of the pipeline ladder (`uploading` is included so a page reload while stuck mid-attach surfaces the recovery pane rather than stranding the user on the ladder — pairs with the §4.1c re-attach recovery) — the file-drop pane (audio/video, reorder, plus the optional slide-deck PDF when the meeting profile is a community meeting). On **Upload & process** it runs §4.1c (attach) → TUS upload → §4.1a acks → §4.2 (process), then the page re-polls and the ladder takes over. This is the back half of the old combined wizard, lifted into its own component. The drop zone accepts a mix of `video/*`/`audio/*` (stitched in order); a community-meeting deck rides the same TUS flow tagged `file_role='slides'`.

**Rendered:**
- Step list — vertical, six rows, Claude-Code-style. Each row: status icon (✓ green for past, ⟳ orange spinning for current, ○ grey for future, ✗ red for failed) + step label + a sub-detail line derived from the § 4.3 payload. Examples:
  - Files uploaded · *3 video + 2 audio · 412.7 MB total*
  - Queued · *waiting for a worker*
  - Extracting audio · *3 of 5 files extracted · ffmpeg in Vercel Sandbox* — current step shows mid-run progress; on complete it reads *5 files extracted + stitched*
  - Transcribing · *running Deepgram Nova-3 (batch)* — once `asr_vendor_chosen` is set; on complete it reads *deepgram · 12,478 words · $0.44*
  - Analyzing Q&A · *Opus 4.7 reading the transcript* → *42 pairs extracted so far · Sonnet curator running* (extraction_count grows live) → *42 Q&A pairs extracted · Opus + Sonnet curator*
  - Complete · *42 Q&A pairs · $1.96 total*
- Source files panel — per-file row with name, size, duration (when extract has populated it), and an `upload_status` badge (`pending | uploaded | extracted | failed`).
- Transcript panel — vendor, language detected, word count, duration, ASR cost — appears once `recording_transcripts` is written.
- Extraction panel — Q&A pair count + total cost-to-date — appears once `extraction_count > 0`.
- **Review-and-generate gate** (Gate 1, `status='transcribed'`): an orange-bordered panel above the file/transcript panels. For QA sessions it shows the agenda topics (one per line) and panel roster (`Name — role`, one per line) seeded from `setup_inputs`, both editable; a **"Names & spellings"** entity-review block (§3.5b) listing the auto-extracted entities with their canonical spelling editable, the ASR variants shown as context ("heard as: …"), drop/add controls; an optional extraction-instructions textarea; and a **"Generate Q&A pairs"** button (cost note: ~$1 · Opus + Sonnet). Submitting POSTs the edited `setup_inputs` + `instructions` + the reviewed `entity_map` to `/api/recordings/[id]/analyze` (§ 4.2b), which persists them (the entity map stamped `reviewed_at`) before analysis; on success polling resumes as status moves to `analyzing`. The step list paints everything through *Transcribing* as done and *Analyzing*/*Complete* as pending (no spinner — the gate is the next action). The ASR vendor can't be changed here (re-running ASR would require re-transcription); it's already fixed by this point.
- Terminal-state banners:
  - `complete + dataset_id` → green banner + "Open report" link, plus a 1.2s `router.push('/analyze/[dataset_id]/report')` auto-redirect for the user who just kicked off the run.
  - `failed` → red banner with the recording's `error_message` and a "Retry" button. If a transcript already exists (the failure was in the analysis pass) it POSTs to `/api/recordings/[id]/analyze` to retry just analysis; otherwise it POSTs to `/api/recordings/[id]/process` to re-run the pipeline from the beginning (the process route accepts `status='failed'`). The failed step in the list is decorated red via a heuristic that walks forward — first step we can't prove succeeded is the failure point (extracting if any file is missing `audio_storage_path`, transcribing if no `recording_transcripts` row, analyzing if no extractions, late-analyzing for mirror/coverage failures).

Closes-tab-friendly: user can come back to this URL anytime; on revisit the page server-renders the current name + status, then the client picks up polling from there.

### 5.4 Report — `/recordings/[id]/report`

**Records of truth** (added 2026-05-30 from user review of the PM-1 pilot output):
- **The stitched audio is the legal record** of the meeting. Always retrievable; never delete on default-retention orgs.
- **The full transcript is the printed record of truth.** PDF export defaults to including the full transcript section. The AI Q&A summary is a derived view *on top of* the transcript, not a substitute.
- **The AI Q&A summary is regeneratable, granularly.** The default fix path is per-card regeneration (§ 4.10) — a sub-cent Sonnet pass on the one card the user wants to change, with an optional free-text "what should change?" note. Topic-scoped and full-meeting re-extractions (§ 4.11) are available for the rarer cases where the pair *structure* is wrong, both accepting user instructions to steer the new pass. The transcript is the durable artifact; the summary is the editable lens — and the lens is editable card by card, not all-or-nothing.

**Drift banner (edit-anytime Phase 4, 2026-06-07):** above the tabs, when the analysis-shaping setup changed since this report was generated (`data.configDrifted`, computed server-side via `isAnalysisConfigDrifted` — §5.7), an amber banner ("Setup changed since the last analysis (Config v{n})") offers a one-click **Re-analyze** with a confirm step (~$1, `POST …/reanalyze {scope:'all'}`); on success it `router.refresh()`es and, because the full re-extract re-stamps `analyzed_config_version` (§4.11 step 7), the banner clears. Only metadata edits (name/date/analysts/…) never raise it.

**Tabs:**

0. **Presentation** (added 2026-06-07, **conditional**) — shown **only** when the meeting had a presentation phase (`meeting_profile.phases` has a `presentation`, i.e. a `community_meeting`, or a `proceedings_summary` exists). Renders the **same content as the deck/PDF "Meeting Overview" slide** (`lib/pptx/recordingDeck.ts`) on-screen, so the presentation half is as prominent in the report as the Q&A: the neutral `proceedings_summary.overview` paragraph + one card per `items[]` (title, presenter, `what_was_presented`, `key_figures` label/value chips, `slide_refs`), with the source deck filename + slide count from `presentation_outline` when present. **Leads the tab bar** when shown (the default tab is still Coverage). Empty state ("No presentation summary yet — re-run the analysis") when the phase exists but the summary wasn't generated (older recording). `?tab=presentation` falls back to Coverage on a meeting with no presentation. `proceedings_summary` already existed (surfaced in the deck/PDF since 2026-06-04); this just gives it an on-screen home. Read-only — no AI, no migration.

1. **Q&A** — **ALL** Q&A pairs in one list (no ask-vs-appendix split — see below). Sections by agenda topic, Q/A pairs in order. A **typology filter** (chips: All / ask / clarification / complaint / commentary, with counts) narrows the list; each card shows its typology as a chip. An amber **"⚠ Needs review {n}"** chip filters to the flagged-for-review pairs — Coverage's "Review {n} flagged →" button deep-links here with it pre-selected. **Per-pair sentiment (2026-06-07):** each card shows the asker-sentiment `payload.sentiment` (positive/neutral/negative/mixed) as a colored chip (+ a dot in the collapsed header), and the filter row adds **sentiment chips** (`sent:<value>`) to isolate by tone. Sentiment is already extracted per pair (§3.5, asker's-perspective exchange tone) — this just surfaces it; pre-June recordings show none until a re-analyze. Each pair is a collapsible card:
   - Collapsed: question + asker + a one-line preview of the answer.
   - Expanded: full Q + full A + panelist + topic chip + timestamp + "▶ Play this segment" button + **"↻ Regenerate this card"** affordance.
   - **Polished vs verbatim:** when the pair has a polished (public-shareable) version (§3.5 pass 4), the card shows the **polished** text by default with a "Polished for sharing" badge + a **"Show verbatim"** toggle (per card) — so what the user reviews on the page matches what the PPTX export renders. Pairs without a polished version (older rows / polish failure) show verbatim with no badge.
   - **Expand-all / Collapse-all** controls at the top of the tab so a reader can scan vs read-in-detail.
   - **By topic / In order toggle** — "By topic" (default) groups pairs under agenda-topic sections; "In order" flattens to a single chronological list of every pair in the sequence it was asked (sorted by `start_sec`, `sort_order` tiebreaker), each numbered, so a reader can follow the meeting's actual flow.
   - **Per-card regenerate (primary fix path):** the "↻" on each card opens a small inline composer with a "What should change? (optional)" text input and a Regenerate button. Submitting calls `POST /api/recordings/[id]/extractions/[extractionId]/regenerate` (§ 4.10) with the user's instructions and replaces the card in place when the response returns. Sub-cent cost, no confirmation modal, no cost warning. The spinner sits on the one card, not the whole tab.
   - **Per-topic re-extraction:** each topic section header carries a "⋯" menu with "Re-extract pairs for this topic…". Opens a modal: instructions textarea + estimated cost (computed from the scoped span) + Confirm. Calls `POST /api/recordings/[id]/reanalyze` (§ 4.11) with `{ scope: 'topic', topic, instructions }`. The topic section spins; other topics keep their pairs.
   - **Full re-extraction (nuclear option):** the tab header carries a "⋯ More" menu (not a prominent button) with "Re-extract all pairs from transcript…". Opens a modal: instructions textarea + a "~$1, replaces all pairs" warning + Confirm. Calls `POST /api/recordings/[id]/reanalyze` (§ 4.11) with `{ scope: 'all', instructions }`. Use when the pair structure across the whole meeting is wrong — Opus missed pairs, split questions, or the agenda mapping is off everywhere.
   - **Unified list (changed 2026-06-05).** The report previously split `ask` typology into this tab and complaint/commentary/clarification into a separate **Appendix** tab. That demoted real questions — a *clarification* is a question, and a *complaint* often contains one — so the headline count under-represented the questions asked. The Appendix tab is **removed**; all pairs live here, with typology as a filter/chip rather than a hide. (The original ask-vs-appendix split dates to the first recordings spec commit `38a18d13`, 2026-05-30; the extraction prompt still classifies typology — now consumed as a label/filter, not a routing decision.)
2. **Action items** (added 2026-06-05) — the `action_item` extraction rows (follow-ups/decisions the synthesis pass pulled out), each with its `description` + agenda-item / owner / due chips. These are NOT Q&A pairs — they were previously invisible in the report UI (deck-only). The header "{n} Q&A pairs" + the Status-page count are `unit_type='qa_pair'` only (counting action items as pairs was the "22 vs 17" bug, fixed 2026-06-05). **Transcript traceability:** action items carry no timestamps, so a `↪ Source · {time}` chip (when a confident match exists) opens a modal with the transcript window they were derived from — `traceActionItem` (`transcriptRoles.ts`) picks the best ±2-segment window by distinctive content-word overlap (stopword-filtered) with the paraphrased description, anchor line bolded; null/no-chip on a weak match (no fabricated trace).
3. **Coverage** (**default tab**) — recomputes live from the current Q&A pairs (`computeCoverage`, excludes action items, self-heals without a re-extract). Contains:
   - **Meeting timeline** — one block per pair, positioned + sized by `start_sec`/`end_sec`, numbered chronologically (circled), with a time axis + per-block duration. **Green** = clean, **amber** = flagged-for-review. **Long quiet stretches** (`per_minute_gaps`, ≥5-min extraction gaps) are **overlaid as hatched bands** on the timeline (behind the blocks), not just listed. **Click a block → modal** with that span's verbatim transcript (Q bold / A bold-italic). Overlapping blocks **stagger into lanes** (`packLanes`) as a backstop — though spans are de-overlapped upstream (§3.6 issue 2), so this is rarely needed. Shared geometry in `lib/recordings/timeline.ts`.
   - **Per-topic density** — **ordered by frequency** (most-discussed first), agenda↔topic reconciled by normalized casing (§3.6 issue 1), with a **per-topic sentiment dot** overlaid from `analysis_summary.topic_summaries` (green/grey/red/amber = positive/neutral/negative/mixed; legend shown when sentiment is available). **Confidence histogram** (px-height bars + counts; qa_pairs only). **Flagged for review** — states it's the same count as the Coverage tab's amber **"{n} to review"** badge and the card's "{n} pairs need review" alert, with a **"Review {n} flagged →"** button that jumps to the Q&A tab's flagged filter. **Long quiet stretches** still listed below with exact times.
   - **Coverage tab badge:** the tab carries an amber **"{n} to review"** pill (= `coverage_report.flagged_count`) rather than a neutral count, so it reads as an alert tied to the flagged pairs.
4. **Transcript** — full transcript with speaker labels + timestamps. Search box; each segment has a "▶ Play from here" button. **The raw ASR transcript is the record of truth — preserved verbatim, never edited by AI.** **Audit overlay (added 2026-06-05):** segments that became an extracted pair are marked — **question in bold, answer in bold-italic**, everything not extracted plain (`buildTranscriptRoles`) — so a reviewer sees exactly what was pulled vs ignored. When a reviewed entity map exists, a **Corrected / Raw toggle** appears (defaults to Corrected): the Corrected view applies the deterministic variant→canonical spelling fix (`normalizeSegments`, client-side) so names read correctly; Raw shows the untouched ASR. Two transcripts, one record — the raw is never mutated.
5. **Export & Share** — PDF download, XLSX download, "Enable public link" toggle, "Send to principals" email-list field. **Config versions + sign-off panel (§2.8, 2026-06-07):** below the export controls, a panel to **Save version** (manual snapshot with an optional note) + a list of all versions (number, manual/analysis badge, the live one marked, who/when/note), and a **review sign-off** control ("Mark reviewed & approved" / "Revoke") that drives the approval stamp across the report/deck/PDF. **Report header attribution (§2.8):** the report header shows **Prepared by {analysts} · {analysis_org} · Config v{n} · analyzed {date}**, a **confidentiality** pill, the **✓ Approved by** stamp when signed off, and an **Objectives** box (summary + questions) — all from the new `recordings` columns. The deck (§4.13) and PDF (§4.5) carry the same attribution + confidentiality + sign-off. PDF export options: (a) Q&A summary only, (b) Full transcript only, (c) **Both — Q&A summary + transcript appendix** (default for "send to principals at end of meeting"). **Brand & linked agent editor (added 2026-06-05, owner-only):** a brand-tag input + agent picker that `PATCH`es `recordings.brand_tag` / `underlying_agent_id` — lets an *already-uploaded* recording be tagged to a brand/agent after the fact (previously creation-only), so a subsequent re-extract seeds spelling correction from that brand's curated `entity_catalog` (§3.5c). The PATCH route accepts `{name?, brand_tag?, underlying_agent_id?}` (owner/org-admin/platform-admin; agent verified in-org) alongside the existing rename + org-transfer branches. **Project setup link (edit-anytime, 2026-06-07):** this tab carries a **"Project setup → "** card linking to the unified Setup editor (§5.7) — the full meeting/panel/agenda/names/objectives/attribution form. This **replaced** the old in-report `ProjectDetailsPanel` (which edited only a subset) so there is **one** setup editor, not two. The report header also gets an **"Edit setup ⚙"** link to the same page. Re-running the analysis afterward feeds updated objectives into the synthesis (§3.5).

**Meeting-timeline summary bar — all four surfaces (added 2026-06-05):** the Coverage tab, the public `/th` share page, the PDF report (`renderTownHallReportHtml`), and the PPTX deck (`recordingDeck.ts`, "Meeting Timeline" slide) all render the same timeline from `lib/recordings/timeline.ts`. **External surfaces use a single brand colour and never show the flagged (amber) state** — the flagged distinction is internal QC, scoped to the report's Coverage tab only.

**Audio playback — modal pattern (added 2026-05-30 from PM-1 review)**:
- Every "▶ Play" button (per Q/A card OR per transcript segment) opens a **modal player** rather than playing inline. Rationale: inline players in long scrollable lists end up tiny and hard to control; a centered modal gives the controls real estate.
- The modal player carries: large play/pause (≥48px touch target), prominent scrubber with the full duration visible, current-time / total-duration labels, ±15s / ±30s skip buttons, **playback speed** (0.75× / 1× / 1.25× / 1.5× / 2×), close button, and an "Open in full audio viewer" link that drops the modal and routes to a full-page player keyed to the same `start_sec`.
- Below the player: the synced transcript segment(s) for the current playhead, scrolling automatically as audio plays. Clicking a segment seeks to that time.
- Source URL: server mints a short-TTL signed URL for the stitched mp3 in the `recordings` bucket (`<org_id>/<recording_id>/audio/stitched.mp3`). The TUS-uploaded source files are NOT served to the report directly.

Export → PDF prints the chosen tabs via Playwright. XLSX exports the structured extractions only. The Share panel calls `POST /api/recordings/[id]/share`.

**Phase 2 shipped state (2026-05-31):** route at `app/recordings/[id]/report/{page,ReportClient}.tsx`. Server resolves dataset → recording (reverse lookup via `recordings.dataset_id`), redirects non-recording datasets back to `/analyze/[id]`. Tabs 1–4 are live; tab 5 (Export & Share) is a stub listing what's coming. Flagged cards render with a yellow background + their `flag_reason`. Topic ordering follows the agenda from `setup_inputs.agenda`; non-agenda topics ("Other", anything the model invented despite the prompt) trail at the end of the tab.

Affordance wiring state:
- **↻ Regenerate (per-card, § 4.10):** wired (2026-05-31). Click opens an inline composer with a "What should change? (optional)" textarea (≤2000 chars), Regenerate / Cancel, and a "~$0.01 · Sonnet" cost hint. POST to `/api/recordings/[id]/extractions/[extractionId]/regenerate`; success swaps the card in place via React state (no page reload). Used to fix individual mismatches during PM-1 calibration.
- **Per-topic "⋯" Re-extract (§ 4.11 scope='topic'):** wired (2026-05-31). The "⋯" on each topic header opens a modal: title "Re-extract pairs for «topic»", an instructions textarea (≤4000 chars) with a topic-aware placeholder, a `~$0.10–$0.40 · Opus + Sonnet` cost line, Cancel / Confirm. POST `/api/recordings/[id]/reanalyze` with `{ scope: 'topic', topic, instructions }`. On success: `router.refresh()` re-pulls the server-rendered report; the active tab stays put.
- **Tab-header "⋯ More" full re-extract (§ 4.11 scope='all'):** wired (2026-05-31). Same modal shell as the per-topic variant with "Deletes every existing pair…" warning and a `~$1` cost line. POST `{ scope: 'all', instructions }`. `completed_at` is bumped on the recording row per spec.
- **▶ Play this segment / Play from here:** wired (2026-06-01). Every Q&A / appendix card with a `start_sec`, and every transcript segment, has a Play button that opens a shared `AudioModal`. The modal fetches a short-TTL signed URL via `GET /api/recordings/[id]/audio` (§ 4.12), seeks to the requested start and autoplays, and carries: a ≥48px play/pause, a scrubber with current/total time, ±15s / ±30s skip, playback speed (0.75/1/1.25/1.5/2×), Esc/×-to-close, and a synced transcript list that highlights + auto-scrolls the segment under the playhead (click a segment to seek). The "Open in full audio viewer" full-page route from the design is deferred — the modal covers the meeting-review need.
- **Export & Share tab:** **PowerPoint export wired (2026-06).** An "Export to PowerPoint" button POSTs to `/api/recordings/[id]/export/pptx` (§ 4.13), downloads the returned `.pptx` blob, and shows the `LottieLoader` while generating; disabled with a hint until `status='complete'`. PDF (§ 4.5) + XLSX + public share (§ 4.7) remain listed as coming-soon below the button.

### 5.5 Org-admin recordings list — `/recordings`

Server-rendered table at `app/recordings/page.tsx`. Scoping uses `getUserContext` and mirrors § 4.8:
- `isAdminOrg` → all recordings across all orgs (extra Org column visible)
- `isAdmin` (org-level admin) → all recordings in own org
- regular user → only `created_by = self`

Columns: Name, Type (Q&A / Focus group / …), Date (meeting_date), Status (pill), Cost (USD, `—` when zero), Owner (full_name fallback email), and Org when scope is cross-org.

Row click routes to:
- `/recordings/[id]/report` when `status='complete' && dataset_id != null` (jump straight to the report)
- `/recordings/[id]/status` otherwise (still processing, failed, or cancelled — land on the status surface where the retry button lives)

Empty state shows the mic glyph + a one-line nudge toward the wizard. `+ New recording` button in the header routes to `/recordings/new`. Status filter / pagination — out of scope for v1; the page caps at the 200 most recent rows, which covers the foreseeable pilot scale. Add ?status= + ?limit when a real customer hits the ceiling.

### 5.6 Admin-org monitor — `/admin/downloads` adds a Recordings section

`components/downloads/DownloadMonitor.tsx` gains a `recordings: any[]` prop and a `Recordings` tab next to the existing Reddit / Reviews / Substack / Regulations / Uploads tabs. Columns: Name (linked the same way as § 5.5), Org, Type, Date, Status (mapped to the shared `StatusPill` palette — `complete → done`, `failed → error`, mid-pipeline statuses → `downloading`, default → `pending`), Vendor (`asr_vendor_chosen`), Duration (minutes), Cost (USD), Error (truncated `error_message`, red). Shows ALL orgs' recordings; the page is already gated by `is_admin_org` redirect in the route handler. Retry isn't a one-click button here yet — admins jump to the recording's status surface (link on the Name) and use the Retry button rendered there.

### 5.7 Edit-anytime Setup editor — `/recordings/[id]/setup` (edit-anytime, 2026-06-07)

`app/recordings/[id]/setup/page.tsx` renders the **same shared `RecordingSetupForm`** the create wizard uses (§5.2), in `mode="edit"`. Reachable at **any lifecycle stage** — from an **"Edit setup"** link on both the status surface (§5.3) header and the report header/Export tab. The server component loads the recording org-scoped (non-admins pair `id`+`org_id`, admin-org bypass; 404 cross-org), maps the row into the form's initial values, and the form `PATCH`es `/api/recordings/[id]` (§4.3b) on **Save setup**, then `router.refresh()`.

Edit mode covers `name / meeting type (preset) / date / location / language / panel / agenda / names & terms (glossary) / objectives (summary + questions) / analysis_org / analysts / confidentiality`. It **omits** the brand/agent link (owned by the report Export tab editor) and the ASR-strategy control (fixed once processing starts) — those stay create-only so each field has exactly one editor. **Metadata** fields apply immediately; **analysis-shaping** fields (`setup_inputs`, `meeting_profile`, `objectives`) save but only change the Q&A on a re-analyze (the §4.3b note). **Drift banner (Phase 4, 2026-06-07):** when those shaping fields differ from the snapshot that produced the live analysis (`isAnalysisConfigDrifted`, `lib/recordings/configVersion.ts` — compares only `setup_inputs`/`meeting_profile`/`objectives` against the `analyzed_config_version` snapshot; metadata edits are NOT drift), an amber banner shows here ("This setup differs from the last analysis") with an **Open report →** link, and on the report itself (§5.4) with a one-click **Re-analyze (~$1)** that re-extracts + re-stamps and clears the banner.

**Documents-anytime (Phase 3, 2026-06-07):** in **edit mode** the "Project documents" pane lists the docs already attached (deck + briefs, fetched server-side) and lets the analyst **attach** a presentation deck (PDF → `slides`, also runs the pre-fill pass) or a brief (`document`), and **remove** any — all via §4.1e. So a deck added here is vision-read into the meeting overview on the next analysis. **Create mode** keeps the pre-fill-only uploader (§5.2, §4.1d) — there's no recording yet to persist to, so the deck is attached later (here in the Setup editor, or with the recording §5.3a). The deck dropped at the add-recording step (§5.3a) and a deck attached here are the same `slides` slot; attaching a new one replaces the old. (Follow-up: PPTX/DOCX docs still need convert-to-PDF for the deck role.)

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
| Per-recording status | Owner + org admins | `/recordings/[id]/status` |
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

The public report route at `/th/[token]` (built 2026-06-04) is the primary distribution mechanism for the pilot ("send link to principals at end of meeting") and the productized workflow.

- **Token entropy:** 24 URL-safe characters (`randomBytes(18).base64url`, ~144 bits). Brute-force is infeasible. `<TBD: per-IP rate-limit on /th/* to mitigate enumeration>`.
- **Fail-closed:** the page 404s unless `share_enabled=true` AND `status='complete'` AND not expired — built into `app/th/[token]/page.tsx`.
- **Owner-gated toggle:** only the recording owner (or admin-org) can enable/disable (`POST /api/recordings/[id]/share`, 403 otherwise); cross-org service-role lookup pairs id+org_id (404).
- **Minimal surface:** the page renders only meeting meta + exec summary + polished Q&A. Never the raw transcript, flags, confidence, cost, or org. (Asker/panelist names ARE shown — they're part of the shareable Q&A record.)
- **Expiry:** optional `expires_in_days` (1–365) on enable; NULL = no expiry. `<TBD: default expiry — currently none unless set>`.
- **Revocation:** flipping `share_enabled=false` immediately 404s the link (the token is preserved and reused if re-enabled).
- **`<TBD>`:** robots noindex meta on the public route; optional password (deferred — token-only in v1).
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
| `FFMPEG_SANDBOX_SNAPSHOT_ID` | Optional | Vercel Sandbox snapshot ID with ffmpeg pre-installed. Skips the ~30s `dnf install` cold-boot on every extract job. Build with the `scripts/create-ffmpeg-snapshot.ts` helper (TBD) and set this env var to the returned `snap_*` id. |

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

**Highest-risk phase.** First time on Vercel Sandbox + Workflow DevKit + Deepgram in this repo.

5. `lib/asr/whisper.ts`, `lib/asr/deepgram.ts`, `lib/asr/hybrid.ts`, `lib/asr/router.ts`.
6. `lib/recordings/extract.ts` — ffmpeg job on Vercel Sandbox.
7. `lib/recordings/transcribe.ts` — vendor dispatch.
8. `lib/recordings/analyze.ts` — Opus extraction + Sonnet curator pass.
9. `lib/recordings/mirror.ts` — `dataset_rows_flat` mirror.
10. `workflows/recordings.ts` + `app/api/recordings/[id]/{process,analyze}/route.ts` — two Workflow DevKit runs (Gate 1): `processRecordingWorkflow` drives extract → transcribe → `transcribed` (pause), and the user-triggered `analyzeRecordingWorkflow` drives analyzing → complete. Each stage is a `"use step"` and `recordings.status` is updated between them.
11. `scripts/pm1-smoke.ts` — calibration harness that re-runs `analyzeRecording` against a stored PM-1 transcript and diffs against PDF ground truth (count, F1, per-field accuracy, per-topic recall). Fixtures live outside the repo and are pointed at via `PM1_TRANSCRIPT_PATH` / `PM1_SETUP_PATH` / `PM1_GROUND_TRUTH_PATH`. Full end-to-end re-upload through the wizard is Phase 4.

### Phase 2 — UX (2026-06-07 → 2026-06-10)

12. `/analyze/new` wizard adds Recording tile.
13. `/recordings/new` wizard with chunked upload + parallel setup form.
14. `/recordings/[id]/status` status surface.
15. `/recordings/[id]/report` HTML + PDF + XLSX exports.
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
| 2 | Job queue | Pre-build | ✓ **Vercel Workflow DevKit** (`workflow` + `@workflow/next`) |
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
| Phase 0 — substrate | **Complete (2026-05-30)** | Applied to prod: org_features/user_features + 4 recording tables + storage bucket + RLS. Spec deviation: `org_id` denormalized on `recording_files` / `_transcripts` / `_extractions` for service-role pairing uniformity. |
| Phase 1 — pipeline | **Complete in code (2026-05-30)** | All libs written: `lib/recordings/{types,analyze,mirror,coverage,extract,transcribe}.ts`, `lib/asr/{whisper,deepgram,hybrid,router}.ts`, `lib/recordings/prompts/qa.ts`. `lib/ai.ts` gained `modelOverride`. `lib/datasetUtils.ts` gained `buildRecordingSchema()`. Pipeline wired as a Workflow DevKit run at `workflows/recordings.ts` + `app/api/recordings/[id]/process/route.ts`; `next.config.js` wraps with `withWorkflow`. PM-1 calibration harness at `scripts/pm1-smoke.ts`. **Pending live exercise:** real PM-1 audio through the wizard + ASR + smoke-test diff vs ground truth (Phase 4 deliverable). |
| Phase 2 — UX | Pending | |
| Phase 3 — collections + public sharing | Pending | |
| Phase 4 — calibration soak | Pending | |
| Phase 5 — dry run + ship | Pending | Hard pin: 2026-06-16 NOWOCATS PM-2 free pilot. |

---

## 15. Live in-person capture (continuous transcription)

A real-time front-end that runs *in front of* the existing batch pipeline rather than replacing it: during an in-person meeting the browser streams mic audio live for captions + a rolling summary, and at meeting end the **same captured audio** is handed to `processRecordingWorkflow` so the polished report/deck is produced by the unchanged Phase-1 pipeline.

**Transport.** No WebSocket server on Vercel (Fluid Compute). The browser streams audio **directly to Deepgram's live WS** using a short-lived token minted server-side, so our `DEEPGRAM_API_KEY` never reaches the client. The token (`/v1/auth/grant`, ttl 60s, Bearer at connect) is org-scoped by the auth check on the route.

> **Mic permission (next.config.js):** the global `Permissions-Policy` baseline gates the microphone. It was `microphone=()` (blocked for ALL origins incl. self), which made `getUserMedia` throw `NotAllowedError` on `/live` regardless of OS/browser settings. Changed to `microphone=(self)` — first-party origin may request the mic (user still sees the normal prompt); cross-origin iframes still can't. A `next.config.js` change needs a **dev-server restart** to take effect.

> ✅ **Auth verified end-to-end (2026-06-07).** The grant endpoint needs a **Member+** key — the scoped `DEEPGRAM_API_KEY` could stream but 403'd on `/v1/auth/grant`. Fixed by setting **`DEEPGRAM_GRANT_KEY`** (Member+ key); `grantDeepgramToken` prefers it, falls back to `DEEPGRAM_API_KEY`. Server-side probe confirmed: grant → HTTP 200, and the live WS **opens with `Authorization: Bearer <grant token>`**, returning `Results`/`Metadata` — so the browser **`['bearer', token]` subprotocol is correct**. Remember to set `DEEPGRAM_GRANT_KEY` in Vercel env before shipping. Captions remain best-effort: with no grant key they degrade to "unavailable" and recording still works.

**Audio is captured once and reused.** The live-capture client MUST record the raw mic stream to a local Blob *while* it streams to Deepgram, then upload that Blob as a normal `recording_files` source on stop. The live transcript is a real-time convenience layer; the authoritative transcript + extraction always come from the existing pipeline running on the saved audio (Whisper/hybrid, diarization, entity correction). Never rely on the streamed transcript alone for the deliverable.

**Transcription timing (decided 2026-06-07).** The authoritative HQ transcription is a **single pass at meeting end** over the whole file, not chunk-by-chunk — Deepgram speaker labels (S1, S2…) are assigned per request, so per-chunk transcription would fragment diarization. The upload happens during/at the end, but the one transcription pass (~1–2 min/hr) + analysis is all the user waits for; the persisted live summary covers that gap.

| Piece | Status | Where |
|---|---|---|
| 1 — short-lived Deepgram token mint | **Code complete (2026-06-07)** | `lib/asr/deepgram.ts` `grantDeepgramToken()` + `POST /api/recordings/[id]/live-token`. Org-gated, rejects terminal-status recordings. |
| 2 — capture backbone (mic → MediaRecorder → upload → process handoff) | **Code complete (2026-06-07)** | `app/recordings/[id]/live/{page,LiveClient}.tsx`; shared `lib/recordings/tusUpload.ts` (AddRecordingClient refactored onto it); "Record live" entry on the setup screen (`StatusClient`). MVP records to one Blob and uploads on Stop, then attach→ack→process exactly as the upload flow. |
| 2b — Deepgram live captions (AudioWorklet PCM → live WS via the piece-1 token) | **Code complete (2026-06-07)** | `public/worklets/pcm16-worklet.js` (Float32→linear16) + `LiveClient.tsx` tees the mic into an `AudioContext`→worklet→`wss://api.deepgram.com/v1/listen` (nova-3, interim_results). Browser auth = `['bearer', <grant token>]` subprotocol. **Best-effort**: token/WS failure shows a notice but never interrupts recording. **Edge-loss fixes (2026-06-07):** the worklet is created up-front and **buffers opening PCM** (cap ~10s) until `ws.onopen`, then flushes — recovers the meeting opening lost to WS-connect latency. On Stop, captions are flushed via **`CloseStream` + wait for trailing `is_final`** (≤2.5s) before teardown, then the transcript is persisted — recovers the closing. (Diagnosed on TEST RECORDINGS 2: live had dropped ~8 words at each edge vs the batch transcript.) **Verified on Test Recording - Live (2026-06-08): the closing now matches the batch transcript exactly; the opening residual dropped from ~8 to ~2 words.** The remaining opening gap is the worklet-startup window (`addModule` on first use), mitigated by prefetching `pcm16-worklet.js` into the HTTP cache on page mount (prod serves it as a static asset, so the residual is near-zero there). The live transcript remains lossy/noisy by nature; the batch transcript stays authoritative. |
| 3 — rolling summary panel | **Code complete (2026-06-07)** | `POST /api/recordings/[id]/live-summary` (fast/Haiku tier, usage-logged `recording_live_summary`, JSON: headline/summary/topics/open_questions/decisions) + a side panel in `LiveClient.tsx`. Client posts the caption-so-far text on a 45s cadence, self-gated on transcript growth. |
| 4 — capture polish (2026-06-07) | **Code complete** | Live input **waveform** (AudioContext `AnalyserNode`→canvas, shared with the captions graph). `getUserMedia` constraints tuned for a room mic: `echoCancellation:false`, `noiseSuppression:false`, mono. Full **live transcript persisted on Stop** → `recordings.live_transcript` via `POST /api/recordings/[id]/live-transcript` (the summary route no longer writes that column). |
| 5 — input device picker + AGC toggle (2026-06-07) | **Code complete** | Idle screen has a **microphone dropdown** (`enumerateDevices`, live `devicechange` refresh, "Show device names" primes labels) → `getUserMedia` uses `deviceId:{exact}`; `OverconstrainedError`/`NotFoundError` surface "pick another mic". **AGC toggle** (`autoGainControl`, default on) — off suits a pro mic (e.g. RØDE) that sets its own levels. A USB class-compliant mic just appears in the dropdown; selecting it makes it the live input. |
| 6 — stereo per-mic separation (2026-06-09) | **Code complete (local)** | Live capture now requests `channelCount:{ideal:2}`, so a split-mic receiver (RØDE Wireless PRO in Split mode) is recorded as 2 channels. `extract.ts` auto-detects true stereo (ffprobe channel count + L−R dual-mono guard) and sets `recordings.audio_channels`; Deepgram uses `multichannel=true` so **channel = speaker** (deterministic per-mic split, not voice clustering). Transcript segments carry `channel`; report shows the source mic. Applies to stereo **uploads** too; mono & dual-mono stay mono. Live captions downmix to mono in the worklet so they still hear both mics. sql/122. |
| 7 — Mic check pre-flight panel (2026-06-09) | **Code complete (local)** | `MicCheck.tsx` replaces the bare dropdown+AGC on the idle screen: pick the input device, then **Test microphone** opens a preview stream with live **per-channel level meters** (L/R for stereo — speak into one mic, only its bar moves → confirms the split in-tool; single bar for mono), with **too-quiet / clipping** guidance. Adjustments the browser actually exposes: **AGC**, **echo-cancellation**, **noise-suppression** toggles, and a **software gain boost** (1×–4×, +0…+12 dB) applied via a WebAudio gain graph — the recorder records the graph output when gain≠1 (unity keeps the raw stream, the zero-risk default; the graph preserves stereo). Constraints centralized in `buildAudioConstraints(MicSettings)`, shared by the test and the real capture. **Browser can't set hardware gain** (device/RØDE Central only) — the panel says so. **Full dress-rehearsal additions:** (a) **live captions during the test** (same Deepgram token→WS→`pcm16-worklet` path as the real recorder, best-effort); (b) **record a test clip & play it back** (local Blob/object-URL off the gain-applied stream, never uploaded, 30s cap); (c) **live monitor** — a "🎧 Listen" toggle routes the processed mic to the speakers (gain node, 0=muted) so toggling AGC/echo/noise/gain is **audible in real time** for A/B; off by default with a headphones/feedback warning. All preview nodes (meters, captions worklet, clip dest, monitor) hang off the single gain stage; constraint changes re-open the preview preserving monitor state. |

**Live vs final transcript.** `recordings.live_transcript` = the raw real-time Deepgram ASR (saved on Stop, untruncated). The authoritative post-processed transcript is in `recording_transcripts.segments`. Comparison UI **DONE (2026-06-07)**: a **"Live vs Final" report tab** (`TranscriptComparisonTab.tsx`, shown only when `live_transcript` is set) renders the two side-by-side with stats — live/final word counts, word delta %, and an order-independent multiset **word-overlap %** (cheap O(n) similarity). A positional/inline word diff is a possible later enhancement.

**Segment trim in the Play modal (2026-06-07).** The Q&A card's "▶ Play / adjust segment" now passes the extraction id to the audio player, so the **AudioModal** shows the segment span (`start – end`) with **⇤ Set start / Set end ⇥** trim controls + Save (PATCH `start_sec`/`end_sec`) — previously trim lived only in the gated ✎ Edit pane. Span logic is a shared `useSpanEdit` hook used by both the modal and the edit-pane `SegmentAudioPlayer` (one implementation). The Play button is **ungated** (shows for every pair, not just those with a timestamp or a polished version). The live-capture **waveform** color is Sarina blue (`#00B4D8`).

**Status-page display (2026-06-07).** The pipeline status is shown as a **compact horizontal progress-pills bar** at the top (`StatusPills`): completed steps fill brand-orange with a ✓, the active step pulses, pending steps are grey, and the active step's detail (vendor · words · cost) shows beneath. At the `transcribed` gate the **Q&A pill becomes a pulsing "▶ Generate Q&A" CTA** that scrolls to the GeneratePanel. The pills bar is the only status display — the old vertical `StepList` ladder was removed (the pills convey the same states). On `transcribed`, the `GeneratePanel` renders **above** the ladder (primary action, not buried) with a single header Generate button + an amber warning that the run is a billed, multi-minute AI analysis that replaces existing Q&A. **The analyze route flips `status → 'analyzing'` synchronously** before returning (like `process` does with `queued`) — otherwise the post-generate status refresh races ahead of the workflow's own flip and the gate appears stuck (the page polling is paused at `transcribed`). **Displayed AI costs are marked up ×50** for the client-facing surface — `StatusClient.formatCost` applies `COST_DISPLAY_MULTIPLIER = 50` and the panel's estimate reads ~$50. This is **display only**: raw `recordings.cost_cents` / `recording_transcripts.cost_cents` and the usage-accounting tables are unchanged (internal accounting stays at true cost). Costs are surfaced only on the status page (report/list don't display them).

> **Hardening item 2 — DONE (2026-06-07).** `sql/120` (applied) adds `recordings.live_summary jsonb` + `live_transcript text`. The `live-summary` route persists each snapshot (id/org_id paired); `GET /api/recordings/[id]` returns `live_summary`; `StatusClient` shows a **provisional recap card** (`ProvisionalRecap`) while the batch pipeline runs (any non-terminal status), superseded by the real report on completion.
>
> **Hardening item 1 — DONE (2026-06-07), via local recovery.** Crash durability is delivered by mirroring each MediaRecorder chunk into **IndexedDB** (`lib/recordings/liveRecovery.ts`) as it records. If the tab crashes / is refreshed / closed before Stop, reopening `/live` for that recording detects the chunks and offers **Upload & process** or **Discard**. Normal Stop (or a successful recovery) clears the store; starting fresh discards stale chunks. Chosen over server-side streaming because it covers the realistic failure modes (tab crash/refresh/close) with no new server surface, no migration, and no audio-boundary gaps. Limitation: does NOT survive machine death / a different device / cleared site data — full server-side continuous upload remains a future option if that's needed.

---

*Last reviewed: 2026-06-07 (Phase 0+1 substrate live; live-capture piece 1 — Deepgram token mint — code complete). Refresh after each phase ships.*
