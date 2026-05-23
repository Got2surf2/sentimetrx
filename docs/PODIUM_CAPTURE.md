# Podium Capture (PulseIQ extension)

**Status:** Scoped, not yet built. Drafted 2026-05-23 for the NOWOCATS / Sarina early-June town hall.

Live in-person Q&A at a PulseIQ town hall: someone walks up to a mic, asks a question, someone (usually the host or a panelist) responds. We want those exchanges to land in the same corpus as the digital (`/th/[guid]`) responses so themes, clouds, and analytics treat the whole event as one body of input.

## Goals

- Capture in-room podium audio from a NOWOCATS-class town hall and land diarized turns in `townhall_messages`.
- Downstream analytics (theme detection, clouds, deck generation) treat podium turns identically to digital responses.
- Operator workflow is dead simple: hit record before the event, upload after.

## Non-goals (explicitly out of scope)

- **No speaker identity.** Diarization gives anonymous labels (`A`, `B`, `C`); we do not attach real names. If we ever want names, that is a separate scope.
- **No live display in the public town hall forum.** Podium turns are admin-visible only until product decides otherwise.
- **No real-time streaming in v1.** Post-event upload is the MVP. Streaming is v2 (see below).
- **No automatic Q/A pairing in v1.** Pairing question turns to response turns is a downstream AI pass, scoped separately.

## Architecture (v1, post-event upload)

```
[room mic / mixer feed]
     ↓ (any laptop or phone recording app)
[single audio file: .mp3 / .m4a / .wav]
     ↓ (operator uploads via admin page)
[POST /api/townhall/[id]/podium/upload]
     ↓ (file stored in Supabase Storage)
[background job → AssemblyAI async transcription with diarization]
     ↓ (poll or webhook for completion)
[parse diarized JSON → one townhall_messages row per speaker turn]
     ↓
[appears in event corpus alongside digital responses]
```

## Data model

New columns on `townhall_messages` (or whatever the canonical PulseIQ response table is at build time — verify against current schema; the table name has shifted before):

| Column          | Type        | Notes                                                                |
| --------------- | ----------- | -------------------------------------------------------------------- |
| `source`        | text        | `'web' \| 'qr' \| 'podium'`. Default `'web'` for backfill.           |
| `speaker_label` | text        | `'A'`, `'B'`, … from diarization. NULL for non-podium rows.          |
| `audio_url`     | text        | Supabase Storage path to the source audio for this session. Nullable.|
| `start_ts_ms`   | integer     | Offset within the source audio file, milliseconds. Nullable.          |
| `end_ts_ms`     | integer     | Offset within the source audio file, milliseconds. Nullable.          |
| `stt_confidence`| numeric     | Average confidence from STT. Nullable. Useful for flagging review.   |

One `townhall_messages` row per speaker turn (one continuous block of speech by one diarized speaker).

New table `podium_sessions` for the upload-level record:

| Column            | Type        | Notes                                                  |
| ----------------- | ----------- | ------------------------------------------------------ |
| `id`              | uuid        | PK                                                      |
| `org_id`          | uuid        | RLS scope. Required.                                    |
| `townhall_id`     | uuid        | FK to the PulseIQ town hall.                            |
| `audio_url`       | text        | Storage path to uploaded audio.                         |
| `duration_sec`    | integer     | Filled in after STT.                                    |
| `status`          | text        | `'uploaded' \| 'transcribing' \| 'complete' \| 'failed'`|
| `assemblyai_id`   | text        | Provider transcript ID for re-fetch / debugging.        |
| `error_message`   | text        | Nullable.                                               |
| `created_at`      | timestamptz | default now()                                           |
| `completed_at`    | timestamptz | Nullable.                                               |

**RLS:** Enable on `podium_sessions` with org-scoped SELECT. Per the project's multi-tenancy invariants — every new public table needs RLS + an org-scoped policy; `npm run test:rls` will catch the second half.

## API routes

- `POST /api/townhall/[id]/podium/upload` — admin only, accepts multipart audio, writes to Supabase Storage, creates `podium_sessions` row with `status='uploaded'`, enqueues the transcription job.
- `POST /api/townhall/[id]/podium/transcribe` — internal job runner (cron-pulled or queue-driven). Submits to AssemblyAI, polls until complete, parses diarized turns, inserts `townhall_messages` rows, updates session status.
- `GET /api/townhall/[id]/podium/sessions` — admin only, list of sessions + status for the dashboard.

All three routes wrap with `requireAdmin` per the gate-internal-routes invariant. Service-role queries pair `id` with `org_id` per the same.

## UI surface

New admin page: `/admin/townhall/[id]/podium`

- Upload widget (drag-drop audio file)
- List of past sessions with status + duration + turn count
- "View transcript" drawer per session (read-only, shows turns with `speaker_label A/B/C` and timestamps, "play from here" button per turn)
- "Re-transcribe" button per session (in case provider improves or audio is re-encoded)

No public-facing UI in v1. Town hall participants do not see podium turns appear in the digital widget.

## Provider choice

**Recommended: AssemblyAI.** Diarization quality is solid in noisy multi-speaker rooms (single-mic setups, audience overlap), async API is straightforward, ~$0.37/hr with diarization enabled. Webhook on completion avoids polling.

**Alternative: Deepgram.** Slightly cheaper, faster, marginally better on clean dedicated channels (e.g., dedicated podium + roving mic). Worse on muddy single-source audio in my experience. Same async pattern.

Wrap the provider call behind a `lib/podium/transcribe.ts` interface so we can swap providers without touching the route.

## Cost model

- AssemblyAI: ~$0.37/hr of audio. A 90-min town hall = ~$0.56 per event.
- Supabase Storage for raw audio: negligible at the scale of one file per event.
- One usage_logs entry per transcription, `resource_type='podium_transcription'`, units = audio seconds. Matches the per-org rollup pattern from the recent usage refactor.

Track in `docs/USAGE_ACCOUNTING.md` when built.

## Open questions (resolve before build)

1. **Where does the audio actually come from?** Venue mixer feed (clean, multi-channel) vs. laptop on a chair (messy, single-source) materially changes diarization quality. Find out the NOWOCATS A/V setup before committing to a provider.
2. **Is there a moderator at the podium who could tap a "new question" button on a tablet?** If yes, that gives us turn boundaries for free and reduces our reliance on diarization quality. If no, all turn detection comes from STT.
3. **Storage retention.** Do we keep the raw audio forever, or purge after N days once the transcript is in? Defaulting to "keep forever" until told otherwise, but worth confirming with the privacy posture in `SECURITY.md`.
4. **Cross-event search.** When podium turns join the corpus, do they show up in `/admin/decks` rollups? Default yes — they're just messages with `source='podium'` — but confirm the deck queries don't filter by source.

## v2 (after MVP ships)

- **Real-time streaming.** Browser tab at the back of the room streams mic audio to AssemblyAI's streaming endpoint; turns land in the DB as they happen. Admin transcript view updates live. Roughly +1 week of work on top of the MVP. Only worth doing if there's a real product reason to watch the transcript live (admin curiosity is not enough).
- **Automatic Q/A pairing.** AI pass walks turns chronologically: "Speaker A turn looks like a question, immediately followed by Speaker B turn — pair them." Surfaced in the admin podium view and feeds the deck generator.
- **Folding into TOWNHALL.md.** When this ships, merge the relevant sections into `docs/TOWNHALL.md` and retire this scope doc.

## Effort estimate

- Schema + migration: 0.5 day
- Upload route + storage wiring: 0.5 day
- AssemblyAI integration + job runner: 1 day
- Admin upload page + session list + transcript drawer: 1.5 days
- Tests (RLS, egress, route): 0.5 day
- Spec/docs/devlog: 0.25 day

**Total: ~4 days of focused work**, deliverable end-to-end. Not blocking the early-June NOWOCATS launch — can ship as a fast-follow once the basic event is live.
