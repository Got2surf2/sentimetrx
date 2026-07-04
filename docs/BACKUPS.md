# Per-Tenant Backups (Sentimetrx)

> Last reviewed: 2026-05-19
> Threat model: tenant-scoped data loss inside a single org (accidental delete, mass UI mistake, ransomware on the live database). Supabase PITR is the wrong shape for this — it rolls back the whole DB and would destroy other tenants' legitimate work. This system snapshots each org's data independently so a single tenant can be rolled forward or back without touching the others.

## What gets backed up

Nightly cron at **04:00 UTC** (`vercel.json`): for every row in `organizations`, dumps all tenant-scoped tables to a single gzipped JSON, uploads to S3.

Object key:
```
s3://<BACKUP_S3_BUCKET>/org-snapshots/<org_id>/<YYYY>/<MM>/<DD>/snapshot.json.gz
```

Key is deterministic per (org, day). Re-running on the same day overwrites the key; bucket versioning preserves the prior copy.

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
> caches (readout/study) and demo scratch are skipped with reasons. Grouped by how the org filter is applied:

- **By `org_id` directly**: agents (formerly `bots`), studies, datasets, campaigns, collections, entity_catalog, usage_logs, social_*, review_sources, reddit_sources, conversations, conversation_turns, pulseiq_sessions, pulseiq_session_conversations, pulseiq_topics, etc.
- **Via a parent table** (e.g. `bot_id IN (SELECT id FROM agents WHERE org_id = $1)`): agent_knowledge_chunks, agent_conversation_reviews, bot_conversation_turns (transitional, drops at Tier 5), responses, campaign_emails, etc.
- **The organization row itself**: filtered by `id = $1`.

### Tables explicitly skipped (with reason)

- `admin_action_log` — global, not org-scoped
- `archived_dataset_rows` / `archived_dataset_rows_flat` / `dataset_rows` — legacy
- `rate_limit_buckets` — transient
- `sentry_snapshots` — global error capture
- `user_locations` — geo IP cache, regeneratable
- `clients` — legacy

### Row caps

- `dataset_rows_flat` is capped at 50,000 rows per snapshot. Larger collections rely on Supabase's daily backup for the excess. The snapshot's `meta.truncated_tables` lists any table that hit its cap. **(Fixed 2026-07-03: table fetches are now PAGED in 1000-row chunks — PostgREST truncates any single select at 1000 rows, so a `.limit(100000)` was a ceiling, not a fetch size, and every capped table was silently capturing at most 1000 rows. `dataset_rows_flat` pages per-dataset ordered by `row_index` (index-served — sorting 47K JSONB rows across datasets hit the statement timeout). Also fixed the same day: `entity_catalog`/`entity_catalog_refresh` (polymorphic scope, no org_id — old spec errored every night; now skipped as regenerable), `webhook_events` (global, no org linkage — skipped), `org_transfers` (scopes via `to_org_id` — new `col_eq_org` filter kind). Restore side: extracted to `lib/orgRestore.ts` shared by the admin route and `scripts/clone-org-to-test.ts`; identity-id tables (`dataset_rows_flat`) restore as strip-id inserts with per-dataset replace — the old upsert-by-id could NEVER restore them anywhere. First successful full restore drill: 23,485 rows of a prod org into the test project, 4 expected cross-org audit-row residuals.)** **(Fixed 2026-07-02: `dataset_rows_flat` is scoped via the org's `datasets` (`parent_via dataset_id`), NOT `org_id` — it has no `org_id` column, so the previous `org_id` filter errored and silently shipped 0 content rows for every org. See "Incomplete-snapshot detection" below.)**
- Other large tables (`bot_conversation_turns`, `responses`, `townhall_turns`, etc.) cap at 100,000 rows.
- Tables that are typically small (bots, studies, knowledge chunks, organizations row) have no cap.

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
        "s3:ListBucket"
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

### What restore does NOT cover

- **`auth.users`** — Supabase's auth schema is not in `public`. If a user record is deleted you need to re-invite (or contact Supabase support). The `users` row in `public.users` IS in the snapshot, but the corresponding `auth.users` row is not.
- **Files in Supabase Storage** — not snapshotted (storage objects are separate; rely on Supabase's storage backup).
- **Anything in tables marked `skip` above.**

### Reading a snapshot offline (forensics / one-off restore)

```bash
aws s3 cp s3://sentimetrx-backups/org-snapshots/<org_id>/2026/05/19/snapshot.json.gz - | gunzip | jq '.meta'
```

The `.tables.<name>` shape is `Array<Row>` for each table, where `Row` is the raw `select *` payload. Restoring offline = pick a table, upsert rows by `id`.

## Cost estimate

At present scale (~30 orgs, ~10 MB compressed each):
- S3 storage: 300 MB/day × 365 = ~100 GB/yr (after lifecycle transitions) ≈ **$1–3/mo**
- PUT requests: 30/day = ~1,000/mo ≈ **$0.01/mo**
- KMS calls (if enabled): negligible
- **Total: ~$3/mo** at current scale, scales linearly with org count + data size

## Failure modes + monitoring

- A single org's snapshot failure does NOT abort the whole cron — the route logs the error to its JSON response and moves on. The cron's response body has a `results[].error` field per failed org. Check this in Vercel Cron logs.
- If `BACKUP_S3_BUCKET` or the AWS credentials are missing, the cron returns 503-equivalent (`results[].error: "BACKUP_S3_BUCKET env var missing"` for every org).
- S3 versioning + lifecycle is the disaster-recovery floor: even if the cron silently fails for a week and you don't notice, the prior 7 days of snapshots still exist.

## TBDs

- **Incomplete-snapshot detection (2026-07-02):** `fetchTable` records any per-table read error into `meta.fetch_errors`, and the nightly cron (`/api/cron/org-snapshot`) now returns **HTTP 500** (not a silent `ok`) if any org's snapshot has fetch errors or failed to upload. A table that fails to read can no longer pass as a green backup shipping 0 rows.
- **No paging/alerting yet**: the cron's failure now surfaces as a red (500) run in Vercel, but nothing pages anyone. Wire to Sentry / Slack when we have a real on-call.
- **Restore drills:** none run yet — do NOT claim quarterly drills in buyer docs until one is logged here (CAIQ BC-03/04 must read "first drill scheduled" until then).
- **No automated restore tests**: there is no nightly "spin up a scratch project, restore yesterday's snapshot, assert row counts" test. This is what would prove the backups are actually restorable. Add when budget allows.
- **`auth.users` mirror**: consider also snapshotting Supabase Auth users (their JSON shape) so an accidental user delete can be partially recovered. Today, only `public.users` is captured.
