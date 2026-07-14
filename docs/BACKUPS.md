# Per-Tenant Backups (Sentimetrx)

> Last reviewed: 2026-07-04 (snapshot v2 — streamed, uncapped)
> Threat model: tenant-scoped data loss inside a single org (accidental delete, mass UI mistake, ransomware on the live database). Supabase PITR is the wrong shape for this — it rolls back the whole DB and would destroy other tenants' legitimate work. This system snapshots each org's data independently so a single tenant can be rolled forward or back without touching the others.

## What gets backed up

Nightly cron at **04:00 UTC** (`vercel.json`): for every row in `organizations`, STREAMS all tenant-scoped tables to S3 as a **snapshot v2** — one gzipped NDJSON object per table plus a manifest, UNCAPPED, in constant memory (`lib/orgSnapshotV2.dumpOrgSnapshotV2` over `lib/snapshotStore`; multipart upload via `@aws-sdk/lib-storage`).

**Time-budgeted continuation (2026-07-04; intra-org resume 2026-07-13):** the cron is no longer capped at one 300 s invocation for all orgs. Each invocation processes orgs in deterministic **id order** and bails at **240 s** (headroom under `maxDuration: 300`); if work remains, it re-invokes itself via `waitUntil` with `?after=<org-id>&hop=N` and the `CRON_SECRET` bearer, so the chain covers every org (D16 time-budgeted slicing).

The deadline also flows INTO the per-org dump (`dumpOrgSnapshotV2Resumable`), so a **single org** whose dump outruns the budget no longer dies at the 300 s kill with nothing restorable (observed on prod 2026-07-13 at 785K rows — the same org then failed identically every night). Instead the dump bails at a page boundary: the in-flight gzip part is closed and uploaded as a complete object, a **checkpoint** lands at `.../v2/partial.json` (completed tables + in-progress table's parts + a resume cursor — offset, parent+offset, or chunk+offset per filter kind), and the continuation carries `&resume=<org-id>&d=<YYYY-MM-DD>` so the next hop reloads the checkpoint and continues **mid-table** instead of restarting the org. Tables split this way become **multi-part objects** (`tables/<name>.ndjson.gz`, `.part2.ndjson.gz`, …) listed under the manifest entry's `parts[]`; the reader streams them in order, so restores are unaffected (per-parent contiguity holds across part boundaries — the cursor resumes exactly where it stopped). The checkpoint is never a snapshot: listings still show only manifest-committed days, and a same-day re-run overwrites `partial.json` along with everything else.

Guards: every hop strictly advances the chain's state (a finished org moves the `after` cursor; an unfinished one advances its checkpoint by ≥1 part — the dump guarantees ≥1 page of progress per invocation), a resume hop that advances nothing gives that org up loudly (`cron.orgSnapshot.stalled`) instead of chaining, and hops are capped at **20** (~80 min of dump work) — a deeper chain is refused loudly. Residual gap, accepted: a hop hard-killed mid-page (a single 1000-row page taking > the ~60 s headroom) dies before writing its checkpoint and before kicking a continuation — the chain ends silently for that night and the next night's run resumes from the last durable checkpoint's day-prefix… which is the *previous* day, so in practice it restarts the org fresh under the new day prefix. Not worth engineering around until a real tenant approaches that scale.

Object keys:
```
s3://<BACKUP_S3_BUCKET>/org-snapshots/<org_id>/<YYYY>/<MM>/<DD>/v2/tables/<table>.ndjson.gz
s3://<BACKUP_S3_BUCKET>/org-snapshots/<org_id>/<YYYY>/<MM>/<DD>/v2/manifest.json
```

The **manifest is the commit marker** — written only after every table part landed. Listings (`lib/backupS3.listOrgSnapshots`) show a v2 snapshot as one manifest-keyed item with aggregate size and HIDE manifest-less days (a dump that died mid-run is not restorable and must not look like a backup). Keys are deterministic per (org, day); a same-day re-run overwrites and bucket versioning preserves the prior copy.

**NDJSON detail that matters:** rows are one-per-line with U+2028/U+2029 escaped — real tenant text (iPhone-pasted reviews) contains raw LINE SEPARATOR characters, which `JSON.stringify` legally leaves unescaped and which line-oriented readers (including Node's readline) treat as line breaks. The v2 reader splits on `\n` only. Caught live 2026-07-04 when a review containing U+2028 broke a streaming restore mid-table.

Legacy **v1** objects (`.../<DD>/snapshot.json.gz`, one whole-org gzipped JSON) are no longer written but restore forever — `lib/orgSnapshotV2.openSnapshot` reads both formats behind one streaming interface.

### Tables captured

Configured in `lib/orgSnapshot.ts` → `TABLE_SPECS`.

> **Coverage audit (2026-07-03, owner-driven):** the snapshot inventory was
> incomplete — MISSING entirely: the whole **recordings/Town Hall module**
> (recordings, files, transcripts, extractions, config versions),
> **saved_views**, **dataset_row(_field)_taxonomy** (also 100K-cap-truncated
> at 128K prod rows — caps raised to 500K), **question_batches /
> logged_questions**, **reo_gold_review**, **agent_impressions**,
> **conversation_reviews**, **org/user_features**, **user_favorites**. All
> added. Explicit non-DB posture: **Supabase Storage binaries (recording
> media, logos) are NOT in org snapshots** — they rely on Supabase Storage
> durability; an S3 bucket-sync is a future hardening item. Regenerable AI
> caches (readout/study) and demo scratch are skipped with reasons.
>
> **Snapshot v2 SHIPPED (2026-07-04)** — the caps this block used to
> describe are GONE. Each table streams to S3 as its own NDJSON part in
> constant memory; a truncated backup is now a data-loss bug, not a tuning
> knob. Verified live against the test project: a 262K-row org (incl.
> 2×100K taxonomy rows) dumped in ~60s at ~200 MB RSS, and a full
> dump→restore round trip reconciled row-for-row. The same verification
> caught and fixed FIVE latent spec bugs that would have erred nightly
> runs: org_features / user_features / user_favorites have no `id` column
> (pagination ordered by a real PK column now; restore handles them
> replace-per-parent instead of skipping), social_moderation_log is
> org_id-scoped (not connection_id), and reddit_source_threads' FK is
> reddit_source_id (not source_id). Grouped by how the org filter is
> applied:

- **By `org_id` directly**: agents (formerly `bots`), studies, datasets, campaigns, collections, entity_catalog, usage_logs, social_*, review_sources, reddit_sources, conversations, conversation_turns, pulseiq_sessions, pulseiq_session_conversations, pulseiq_topics, etc.

> **Taxonomy embed (2026-07-04, sql/151 + sql/152):** taxonomy verdicts live
> INSIDE `dataset_rows_flat.data._tx` (with rollups in
> `dataset_state.analytics.taxonomy`), so they ride the existing row/state
> coverage automatically — the class of "sidecar module missed by backups"
> is structurally gone for taxonomy. The sidecar tables
> `dataset_row(_field)_taxonomy` were dropped by sql/152 after the prod
> backfill verified (parity 102/102); snapshots taken before 2026-07-04
> still contain their NDJSON parts, which a restore against the current
> schema will report as unknown tables — ignorable, the same verdicts
> restore with `dataset_rows_flat`.
- **Via a parent table** (e.g. `bot_id IN (SELECT id FROM agents WHERE org_id = $1)`): agent_knowledge_chunks, agent_conversation_reviews, bot_conversation_turns (transitional, drops at Tier 5), responses, campaign_emails, etc.
- **The organization row itself**: filtered by `id = $1`.

### Tables explicitly skipped (with reason)

- `admin_action_log` — global, not org-scoped
- `archived_dataset_rows` / `archived_dataset_rows_flat` / `dataset_rows` — legacy
- `rate_limit_buckets` — transient
- `sentry_snapshots` — global error capture
- `user_locations` — geo IP cache, regeneratable
- `clients` — legacy

### Row caps — NONE (since v2, 2026-07-04)

Every table is captured in full. The caps that used to live here (50K
`dataset_rows_flat`, 100K default, 500K taxonomy) were an artifact of v1
building one JSON document in serverless memory; v2 streams, so they are
gone. History that still matters for reading OLD snapshots: v1 objects
taken before 2026-07-04 ARE capped (and those taken 2026-07-02–07-03 were
additionally 1000-row-truncated by the un-paged PostgREST fetch — that
window's snapshots are unreliable beyond config tables). `dataset_rows_flat`
pages per-dataset ordered by `row_index` (index-served — sorting across
datasets hit the statement timeout at 47K JSONB rows); it has no `org_id`
and scopes via the org's datasets (`parent_via dataset_id`, fixed
2026-07-02 after shipping 0 content rows nightly).

## AWS setup (one-time, in the AWS console)

### 1. Create the S3 bucket

Region: `us-east-1` recommended (matches Supabase region; minimizes cross-region egress).
Bucket name: e.g. `sentimetrx-backups`.

Settings:
- **Block all public access**: ON
- **Versioning**: enabled
- **Default encryption**: SSE-S3 (`AES256`) OR SSE-KMS if `BACKUP_S3_KMS_KEY_ID` is set
- **Object Lock**: enabled in compliance mode for immutability (optional but recommended for ransomware protection)
- **Lifecycle rules**: transition older versions per retention policy below

### 2. Lifecycle rule (recommended)

```
Rule: org-snapshots retention
Scope: prefix "org-snapshots/"
Current version actions:
  - Move to STANDARD_IA after 30 days
  - Move to GLACIER_INSTANT_RETRIEVAL after 90 days
Noncurrent version actions (these are the previous-day overwrites):
  - Delete noncurrent versions after 365 days
```

### 3. IAM user / policy

Create a dedicated IAM user (or role) for the Vercel runtime. Attach this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WriteAndReadSnapshots",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:AbortMultipartUpload"
      ],
      "Resource": [
        "arn:aws:s3:::sentimetrx-backups",
        "arn:aws:s3:::sentimetrx-backups/org-snapshots/*"
      ]
    }
  ]
}
```

Notes:
- Intentionally NO `s3:DeleteObject` — Vercel runtime can never delete. Cleanup happens via the lifecycle rule.
- **v2 multipart uploads (2026-07-04):** large table parts upload via S3 multipart. `s3:AbortMultipartUpload` is in the policy (so a failed upload can clean up after itself) and the bucket has an `abort-incomplete-multipart` lifecycle rule (delete incomplete multipart uploads after 7 days) as the backstop for orphaned parts. Both applied in the AWS console 2026-07-04; the abort permission was verified live via a create+abort round trip with the runtime's own key (the lifecycle rule is owner-confirmed — the runtime key deliberately can't read lifecycle config).
- If using SSE-KMS, also grant the IAM user `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey` on the specific key ARN.

### 4. Env vars (Vercel project → Environment Variables)

```
BACKUP_S3_BUCKET=sentimetrx-backups
BACKUP_S3_REGION=us-east-1
BACKUP_AWS_ACCESS_KEY_ID=<from IAM user>
BACKUP_AWS_SECRET_ACCESS_KEY=<from IAM user>
BACKUP_S3_KMS_KEY_ID=<optional KMS key ARN>
```

All four (or five with KMS) need to be set on Production. Preview/Development can skip them — the cron won't run there, and on-demand snapshots from the admin UI will return a clear "missing env" error.

## Operating the system

### From the admin UI

- `/admin/backups` — list of all orgs with **Browse snapshots** + **Snapshot now** buttons. The "Snapshot now" button runs an on-demand backup for that org (useful before a planned risky change).
- `/admin/backups/<org_id>` — list of all snapshots for one org with their timestamps and sizes. Each row has a **Restore…** button that opens an inline confirmation.

### Restore modes

**Merge (default, safer):** upserts every row from the snapshot by `id`. Rows currently in the live DB whose ids are NOT in the snapshot are left alone. Use when you need to recover specific deleted/corrupted rows without touching anything else.

**Replace (destructive, opt-in):** in addition to merge, deletes any current rows in `org_id`-filtered tables whose id is not in the snapshot. Use only when you genuinely want the org's state to match the snapshot exactly. Requires typing the org slug to confirm.

Both modes stream v2 snapshots table-part by table-part in ≤500-row batches (`lib/orgRestore.restoreOrgSnapshotFromSource`), so an uncapped snapshot restores within serverless memory. Tables that can't upsert by `id` restore **replace-per-parent** (delete the target's rows for each parent on its first appearance in the stream, then insert): `dataset_rows_flat` / `archived_dataset_rows_flat` (identity ids, stripped) and the composite-PK config tables `org_features` / `user_features` / `user_favorites` (previously backed up but silently unrestorable — reported-and-skipped).

### Restore fidelity (2026-07-04 rework, after the first DR drill)

- **Ordering + retry:** tables restore in `TABLE_SPECS` dependency order (parents before children), and any table with FK-blocked rows automatically re-runs after the rest have landed. This is required, not defensive: `datasets.brand_collection_id` ↔ `collections.dataset_id` is a circular dependency no static order can satisfy.
- **Referential debt is skipped and counted, not batch-poisoning:** a row referencing a parent that exists nowhere in the target (org-transfer leftovers pointing at other orgs'/deleted rows) fails its whole 500-row PostgREST batch atomically. The restore bisects failing batches down to the individual offenders — good rows land, debt rows surface as `skipped_fk` (and non-id unique collisions, e.g. `collections_brand_slug_uniq` on re-restore-over-existing, as `skipped_conflict`). Skips are honest report items, not fatal errors — the debt is a property of the source data.
- **Self-verification (never claim success for dropped rows):** after all writes, the restore re-queries the target for every row it claims to have landed (by id, or per-parent counts for identity tables) and reports any shortfall as `missing`. Pre-delete failures, partial writes, and streams that under-deliver vs the manifest row count all count as errors inline. The result's `ok` is true only with zero errors AND zero missing.
- **Trigger-sensitive columns restore deferred:** writing `datasets.brand_tag` fires `set_brand_collection_id` (migration 062), whose find-or-create would mint a *phantom* brand collection (new id) because datasets restore before collections — the phantom then unique-blocks the snapshot's real collections row and FK-blocks its members (the drill's "collections 12/17" anomaly). Registered columns (`DEFERRED_COLUMNS` in `lib/orgRestore`) are nulled in the first pass and re-upserted after all tables land, so the trigger resolves to the snapshot's own rows; the AFTER-trigger's duplicate `collection_members` twin is deduped (the snapshot's row wins).

### What restore does NOT cover

- **`auth.users`** — Supabase's auth schema is not in `public`. If a user record is deleted you need to re-invite (or contact Supabase support). The `users` row in `public.users` IS in the snapshot, but the corresponding `auth.users` row is not.
- **Files in Supabase Storage** — not snapshotted (storage objects are separate; rely on Supabase's storage backup).
- **Anything in tables marked `skip` above.**

### Reading a snapshot offline (forensics / one-off restore)

v2:
```bash
aws s3 cp s3://sentimetrx-backups/org-snapshots/<org_id>/2026/07/04/v2/manifest.json - | jq '.table_row_counts'
aws s3 cp s3://sentimetrx-backups/org-snapshots/<org_id>/2026/07/04/v2/tables/studies.ndjson.gz - | gunzip | jq -c '.name'
```
Each table part is gzipped NDJSON — one raw `select *` row per line. A table dumped across cron hops has **multiple parts** (`studies.ndjson.gz`, `studies.part2.ndjson.gz`, …) listed in order under its manifest entry's `parts[]`; concatenated gzip members are a valid gzip stream, so `aws s3 cp part1 - part2 - | gunzip` (or cat-ing the downloaded parts) reassembles the table.

v1 (legacy objects):
```bash
aws s3 cp s3://sentimetrx-backups/org-snapshots/<org_id>/2026/05/19/snapshot.json.gz - | gunzip | jq '.meta'
```
The `.tables.<name>` shape is `Array<Row>`. Restoring offline = pick a table, upsert rows by `id`.

## Cost estimate

At present scale (~30 orgs, ~10 MB compressed each):
- S3 storage: 300 MB/day × 365 = ~100 GB/yr (after lifecycle transitions) ≈ **$1–3/mo**
- PUT requests: 30/day = ~1,000/mo ≈ **$0.01/mo**
- KMS calls (if enabled): negligible
- **Total: ~$3/mo** at current scale, scales linearly with org count + data size

## Failure modes + monitoring

- A single org's snapshot failure does NOT abort the whole cron — the route logs the error to its JSON response and moves on (and a budget-bail continuation still fires for the orgs after it). The cron's response body has a `results[].error` field per failed org. Check this in Vercel Cron logs.
- Every hop fails loud for its own slice: any failed/incomplete org → HTTP 500 **and** an explicit Sentry event (`cron.orgSnapshot.run` via `lib/log.logError`) — necessary because only hop 0's response reaches the Vercel cron log; continuation hops' responses are read by no one. A continuation hop that never ran at all (non-2xx / network error on the kick) is reported as `cron.orgSnapshot.continuation`; a resume hop that advanced an org's checkpoint by nothing is reported as `cron.orgSnapshot.stalled` and that org is given up for the night (a `partial: true` result entry is progress, not a failure — the manifest lands on a later hop).
- If `BACKUP_S3_BUCKET` or the AWS credentials are missing, the cron returns 503-equivalent (`results[].error: "BACKUP_S3_BUCKET env var missing"` for every org).
- S3 versioning + lifecycle is the disaster-recovery floor: even if the cron silently fails for a week and you don't notice, the prior 7 days of snapshots still exist.

## TBDs

- **Incomplete-snapshot detection (2026-07-02):** `fetchTable` records any per-table read error into `meta.fetch_errors`, and the nightly cron (`/api/cron/org-snapshot`) now returns **HTTP 500** (not a silent `ok`) if any org's snapshot has fetch errors or failed to upload. A table that fails to read can no longer pass as a green backup shipping 0 rows.
- **No paging/alerting yet**: the cron's failure now surfaces as a red (500) run in Vercel, but nothing pages anyone. Wire to Sentry / Slack when we have a real on-call.
- **Restore drills:** first full prod→test drill run **2026-07-04** (fresh v2 dump of the Datanautix org: 200,986 rows / 50 tables / 0 fetch errors — capture verified complete). The restore side surfaced three fidelity bug classes (FK ordering, referential-debt batch poisoning, silent-loss accounting) plus the trigger-minted-phantom interference, all fixed same day — see "Restore fidelity" above. **Re-drill from the S3 nightly artifact (2026-07-04, post-fix): PASSED** — 200,967/200,978 rows landed on a clean target, 0 errors / 0 conflicts / 0 missing (self-verified), the remaining 11 = 10 referential-debt rows each attributed to a named FK constraint + 1 deliberately remapped user identity; prod↔test recount reconciled row-for-row against the manifest (prod-side drift since the 07:45 UTC snapshot accounted). Log each subsequent drill here.
- **No automated restore tests**: there is no NIGHTLY "restore yesterday's snapshot, assert row counts" job yet. Partially covered since 2026-07-04: the v2 unit suite round-trips a dump→restore through the local store on every CI run, a live dump→restore→recount drill ran against the test project (row-for-row reconciliation), and every routine `clone-org-to-test` doubles as a restore drill. The missing piece is only the *scheduled* version.
- **`auth.users` mirror**: consider also snapshotting Supabase Auth users (their JSON shape) so an accidental user delete can be partially recovered. Today, only `public.users` is captured.
