# Runbook — quarterly DR restore drill

Owner: platform owner. Cadence: **quarterly** (SECURITY.md §11; open item 13).
Log every drill in that week's `docs/weekly-reports/YYYY-WXX-devlog.md` under
a `DR drill` heading with the audit JSON and the verification numbers below.
A quarter with no drill entry is a governance finding.

What we are proving each quarter:

| Claim (SECURITY.md §11) | How the drill proves it |
|---|---|
| RPO 24h (daily DB backups) | Step 1: latest Supabase backup ≤ 30h old |
| RTO 2–4h | Step 2: wall-clock from "start restore" to "row counts verified" |
| Per-tenant snapshots recoverable | Step 3: one org's snapshot re-hydrates to the manifest's row counts |
| Object storage protected against overwrite | Step 1: S3 versioning `Enabled` |

## Step 1 — automated audit (5 min, read-only)

```bash
npx tsx scripts/dr-audit.ts
```

Exit code 0 = every check PASS/INFO. Any `FAIL` line is fixed before continuing:

- `S3 versioning is Disabled` → enable it in the AWS console (bucket →
  Properties → Bucket Versioning). The nightly org-snapshot cron **overwrites**
  the same keys per org+day, so without versioning a bad run destroys the only
  copy.
- `latest org snapshot is N days old` → the cron chain broke; check
  `/api/cron/org-snapshot` in Vercel logs and the Sentry `org-snapshot` issue.
- `latest Supabase backup is Nh old` → open the Supabase dashboard → Database →
  Backups and contact Supabase support if daily backups have stopped.

## Step 2 — database restore drill (the RTO measurement)

**Never restore into prod.** Two ways to get a scratch database:

**A. Supabase "Restore to a new project"** (cleanest; costs one project for the
hours it exists): dashboard → prod project → Database → Backups → pick
yesterday's backup → *Restore to new project*. Note the start time.

**B. Download + `psql` into the TEST project** (`Sentimetrx-Test`): download
the backup from the same screen, then

```bash
# TEST_DB_URL is the test project's direct connection string (see
# scripts/bootstrap-test-db.sh for how it's normally used). This WIPES the test
# project's data — that is what it's for.
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f ./backup.sql
```

Afterwards re-run `TEST_DB_URL=... bash scripts/bootstrap-test-db.sh` so the
test project is back on the committed schema for the isolation suites.

**Verify (record these in the devlog):**

```sql
-- Totals: compare against the same query on prod (read-only) at drill time.
select
  (select count(*) from organizations)      as orgs,
  (select count(*) from users)              as users,
  (select count(*) from datasets)           as datasets,
  (select count(*) from dataset_rows_flat)  as rows_flat,
  (select count(*) from agents)             as agents,
  (select count(*) from pulseiq_sessions)   as pulseiq_sessions;

-- Key invariants that a partial or corrupt restore breaks first:
select count(*) as datasets_without_org from datasets where org_id is null;
select count(*) as rows_without_dataset from dataset_rows_flat r
  left join datasets d on d.id = r.dataset_id where d.id is null;
select count(*) as tables_without_rls from pg_tables t
  left join pg_class c on c.relname = t.tablename
  where t.schemaname = 'public' and not c.relrowsecurity;
select max(applied_at) as last_migration from schema_migrations;
```

Pass = totals within the day's normal churn of prod, all three invariant
counts are `0`, and `last_migration` matches `ls sql | tail -1`. Note the
finish time; **RTO = finish − start**. If it exceeded 4h, SECURITY.md §11 is
updated to the measured number — the doc states what we can do, not what we
wish.

Tear down: delete the restored project (option A) or re-bootstrap TEST (B).

## Step 3 — per-tenant snapshot re-hydration (15 min)

Pick one org's snapshot from yesterday in the backup bucket
(`<org-id>/<YYYY-MM-DD>/manifest.json` + one gzipped NDJSON per table;
format in `lib/orgSnapshotV2.ts`). Download the manifest and one large table
object, then:

```bash
gunzip -c dataset_rows_flat.ndjson.gz | wc -l   # must equal manifest.tables.dataset_rows_flat.rows
```

A mismatch means the snapshot is not restorable as written — file it as SEV-2
(`docs/postmortems/`), because it is silent data loss waiting for the day
it's needed.

## Step 4 — record

Devlog entry: audit JSON, the two count tables (prod vs restored), the RTO,
the snapshot row-count check, and anything that surprised you. Update
`docs/SECURITY.md` §11 if RPO/RTO changed. Next drill date = today + 3 months.
