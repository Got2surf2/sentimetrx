# DATABASE.md — Data Dictionary

**Companion to [`docs/db/schema.sql`](db/schema.sql)** — the generated,
committed snapshot of the production schema (tables, columns, indexes, RLS
policies, functions, views — everything). That file *recreates* the database;
this file explains what each table is *for*. When they disagree, the snapshot
wins — it is generated, this is written.

**Regenerating the snapshot:** `npm run schema:snapshot` (schema-only
`supabase db dump` from the linked prod project — no data leaves prod).
`npm run migrate sql/NNN_x.sql` refreshes it automatically after every
migration; commit `docs/db/schema.sql` alongside the migration file.

**Disaster recovery:** `psql <fresh-db> -f docs/db/schema.sql` rebuilds the
complete empty schema. Data restore comes from the nightly org snapshots
(`lib/orgSnapshot.ts` → S3) and Supabase PITR — see `docs/BACKUPS.md`.

**Snapshot stats (2026-07-03):** 78 tables (all RLS-enabled), 106 policies,
12 views, 61 functions.

---

## Conventions

- **Multi-tenancy:** almost every table carries `org_id` and an org-scoped
  RLS SELECT policy. Service-role code must pair `id` with `org_id` (see
  `docs/SECURITY.md` § 2 — this invariant has been the source of every
  CRITICAL finding to date).
- **Scoping column:** where a table has no `org_id` of its own, it scopes
  through a parent (noted below as *via `<fk>`*).
- **JSONB config blobs:** rich per-row configuration lives in JSONB columns
  (`config`, `cohort_config`, `schema_config`, `data`) rather than wide
  typed columns — see `docs/ARCHITECTURE.md` D2/D3 for why.
- **(legacy)** = slated for deletion; kept only as a rollback path.

---

## Identity & access

| Table | Purpose |
|---|---|
| `organizations` | Tenant root. Plan/status; `is_admin_org` marks the platform-operator org (admin bypass in route gates). |
| `users` | App users; each belongs to one org (`org_id`). Mirrors Supabase `auth.users` (same id). |
| `invites` | Pending email invites into an org. |
| `user_logins` | Login audit trail (via `user_id`). |
| `user_events` | Product-usage event log (feature analytics). |
| `user_locations` | Geo-IP cache; regeneratable, excluded from snapshots. |
| `org_features` / `user_features` | Feature-flag overrides per org / per user (admin-managed). |
| `org_transfers` | Audit rows for moving resources between orgs. |
| `admin_action_log` | Global audit of privileged admin actions (key changes, snapshot restores, org deletes). Not org-scoped. |
| `clients` | (legacy) pre-`organizations` tenant table. |

## Agents (1:1 conversational AI — internal name `bots`)

| Table | Purpose |
|---|---|
| `agents` | Agent definition: persona, system prompt, knowledge base, intents, focuses/topics, guardrail + content-safety config, encrypted BYOK `ai_api_key`. Public widget at `/b/[slug]`. `capability` (`standard`\|`super`, CHECK; sql/175) + `capability_config` jsonb select the AGENT_TIERS Phase 1 knob set (see BOTS.md §6 / `lib/agentCapability.ts`). |
| `agent_knowledge_chunks` | RAG chunks + embeddings for an agent's knowledge base (via `bot_id`). |
| `bot_conversation_turns` | The engine's synchronous turn store (user + assistant rows per session). Written by `lib/chatCore` on every turn; the async mirror (below) is the analytics store. |
| `agent_session_personas` | Per-session extracted participant persona (name, traits, demographics). |
| `agent_conversation_reviews` / `conversation_reviews` | Human review/annotation state over agent conversations. |
| `agent_change_log` | Config change audit per agent. |
| `agent_impressions` | Widget impression counts (loads vs engagements). |
| `agent_readout_cache` / `agent_study_cache` | Cached AI-generated conversation readouts / Agent Study reports. |
| `agent_crawl_jobs` | Resumable super-agent deep-crawl cursor (AGENT_TIERS Phase 2 P2d, sql/176): one row per crawl job holding `queue`/`visited`/`pages_crawled` so a 300-page crawl runs as a D16a browser loop across many `step()` calls and resumes if the tab closes. RLS org-read; service-role writes pair agent_id+org_id. |
| `agent_kb_page_hashes` | Per-page content-hash ledger for the Super-agent weekly KB re-crawl (AGENT_TIERS Phase 2 P2e, sql/177): one row per `(agent_id, url)` holding the sha256 of the last-seen page text. The `/api/cron/agent-recrawl` sweep re-embeds a page only when its hash changed; unchanged pages are skipped. RLS org-read; service-role writes pair agent_id+org_id. |
| `help_feedback` | Thumbs up/down on the in-product Help assistant (Sherpa, 🧭) answers (HELP_AGENT §9, sql/184): one row per rating (`rating` ∈ {-1,+1}) with the `(question, answer)` pair + `page_route`. The KB-gap detector — repeated thumbs-down/unhelpful answers drive the next help-article backlog. Written by the service-role `/api/help/feedback` route (stamps org_id from the authed caller); RLS org-scoped SELECT. |
| `agent_probe_responses` | Research-probe outcome accounting (BOTS.md §14, sql/159): one row per (session, probe) assignment — asked_answered / asked_declined / asked_ignored / never_fit / quota_closed, with the wording actually asked, ask context, verbatim answer and keyword-tier coding. RLS org-read; service-role writes pair agent_id+org_id. |
| `agent_probe_quota` | O(1) answered-count per (agent, probe, version) via the `increment_probe_answered` RPC — quota checks never re-count the responses table. |
| `mco_handoff_sessions` | MCO demo: canvas-to-agent handoff state. |

## Unified conversation substrate (Phase 3 — docs/CONVERGENCE.md)

| Table | Purpose |
|---|---|
| `conversations` | One participant ↔ one agent over a session; substrate-neutral parent. |
| `conversation_turns` | One row per turn (user OR assistant): content, `content_en`, language, `source`, `topic_id`, sentiment, `content_flags`. The analytics store for PulseIQ; async-mirrored from `bot_conversation_turns`. |
| `pulseiq_sessions` | A PulseIQ session = cohort layer over a dedicated agent: `bot_id`, slug, status (`draft/live/paused/closed`), `cohort_config` JSONB (pacing, rounds, safety, closing message…), `discussion_guide`. |
| `pulseiq_topics` | Per-session topic pool: seed topics (`source='seed'`) + AI-discovered (`auto_detected`) + moderator-pushed (`manual`); state machine (`active/paused/pending/completed/…`), `round_number` for rounds pacing. |
| `pulseiq_session_conversations` | Link table: which conversations belong to which PulseIQ session. |
| `townhall_participant_responses` | Post-session demographics/psychographics, keyed `town_hall_id` → `pulseiq_sessions` (FK cascade). Survived the sql/153 legacy drop; its `session_id` column is vestigial (legacy-only rows were discarded with the drop). |

## Surveys

| Table | Purpose |
|---|---|
| `studies` | Survey definition (questions JSONB, branding, kiosk mode). Public widget at `/s/[guid]`. |
| `responses` | One row per completed survey response (answers JSONB; via `study_id`). |

## Datasets & analysis (TextMine / Ana)

| Table | Purpose |
|---|---|
| `datasets` | Analysis container: name, source (`csv/google_reviews/reddit/townhall/recording/…`), `row_count`, sync state. |
| `dataset_rows_flat` | **Sole source of truth for rows.** One row per record, `data` JSONB blob — one table stores wildly different shapes (survey answers, Google reviews, town-hall turns). No `org_id`; scopes via `dataset_id`. The reserved `data._tx` key carries the row's per-field taxonomy verdicts (sql/151) — app metadata, never a dataset column (skipped by schema detection, the rows API, and the FTS trigger). The `substantive` JSONB column (sql/178) is a `{field: true}` map of every field whose value carries usable feedback (`lib/usefulness.scoreUsefulness`) — stamped at ingest by `stampRowSubstantive`, backfilled via `apply_substantive_flags`, versioned by `substantive_v` (the scorer version, for re-score on a bump). The substantive-aware TextMine counts filter one open-ended field key at a time (`substantive ? 'LEAST'`); a carve-out list (rating averages, numeric/categorical stats, raw counts, exports) keeps the full denominator. |
| `dataset_state` | Per-dataset analysis state: `schema_config` (field types/stats, grown by `mergeSchemaStats`), `theme_model`, analytics cache, entity settings, `outlet_action_plans` (sql/183 — place_id-keyed cache of the Outlet Report's LLM action plans; atomic per-key merge via `merge_outlet_action_plan`). |
| `dataset_rows` / `archived_dataset_rows(_flat)` | (legacy) v1 batched row storage + archives; removed from all read paths May 2026. |
| `collections` | Grouping of datasets (`kind='brand'` = Brand Profile); cached merged schema/themes. |
| `collection_members` | Link table: datasets in a collection. |
| `entity_catalog` / `entity_catalog_refresh` | Canonical entity registry (polymorphic `scope_type`/`scope_id` — dataset/collection/bot; NO org_id) and refresh bookkeeping. Regenerable via entity discovery; excluded from org snapshots (2026-07-03). |
| `reo_gold_review` | REO taxonomy gold-set: owner-graded extraction drafts for calibration. |
| `saved_views` | Saved filter/view definitions on a dataset. |

## Client review flow (external questions)

| Table | Purpose |
|---|---|
| `question_batches` | An imported batch of client questions under review (`/review/<token>` public page). |
| `logged_questions` | Individual questions: AI-extracted, drafted answers, accept/edit state, opt-in to agent KB. |

## Town Hall (recorded meetings — internal name `recordings`)

| Table | Purpose |
|---|---|
| `recordings` | A recorded in-person meeting: status pipeline (upload→transcribe→extract→complete), setup config, share token (`/th/<token>` public report). Public sharing is three independent flags: `share_enabled` (link live), `share_verbatim` (polished vs verbatim Q&A), and `share_audio` (sql/185 — lets the public report play the recording; default false, because publishing the written report must never imply publishing residents' voices). |
| `recording_files` | Uploaded/captured audio-video assets (via `recording_id`). |
| `recording_transcripts` | Deepgram transcripts incl. live-capture segments + speaker roles. |
| `recording_extractions` | AI extraction output (Q&A pairs, themes, summary) per config version. |
| `recording_config_versions` | Versioned setup config (edit-anytime with re-extract diff). |

## Campaigns (email outreach)

| Table | Purpose |
|---|---|
| `campaigns` | Campaign definition + status. |
| `campaign_respondents` | Recipient list with per-recipient status (sent/opened/clicked/completed/…). |
| `campaign_emails` | Email content variants. |
| `campaign_schedules` | Send schedules. |
| `campaign_send_log` | Per-send audit (via `campaign_id`). |

## Data sources (ingest)

| Table | Purpose |
|---|---|
| `review_sources` / `review_source_locations` | Google-reviews source config (DataForSEO) + its physical locations. |
| `review_downloads` | Ingest run log (cost/rows per pull). |
| `reddit_sources` / `reddit_source_threads` | Reddit listening sources + tracked threads. |
| `social_connections` | OAuth-connected social accounts (FB/IG). |
| `social_comments` | Ingested comments/messages (via `connection_id`). |
| `social_alert_rules` / `social_alerts_sent` | Alerting rules + sent-alert dedup log. |
| `social_dm_log` / `social_moderation_log` | DM replies + hide/delete moderation audit (via `connection_id`). |

## Platform / ops

| Table | Purpose |
|---|---|
| `usage_logs` | AI usage accounting: every model call with tokens, computed cost, `org_id`, resource attribution (`docs/USAGE_ACCOUNTING.md`). |
| `shared_links` | Tokenized public share links (deck/analytics/townhall/agent-study) with expiry. |
| `deck_download_log` | Deck/report download audit. |
| `user_favorites` | Per-user starred resources (type + id pairs). |
| `ai_consent_audit` | Records of AI-processing consent decisions. |
| `webhook_events` | Inbound webhook receipt log (idempotency). |
| `rate_limit_buckets` | Token-bucket state for `lib/rateLimit.ts`; transient. |
| `sentry_snapshots` | Captured error-context snapshots. |
| `schema_migrations` | Applied-migration ledger (sql/147): filename, sha256, applied_at/by. *(Applied to prod 2026-07-03; ledger backfilled with all 147 prior migrations.)* |

## Backup accounting

| Table | Purpose |
|---|---|
| `org_snapshot_runs` | Durable per-tenant backup outcome — one row per (`org_id`, `snapshot_day`), upserted as the resumable cron hops (`attempts` counts the touches). Exists because the nightly run previously reported only to the HTTP response, `console.error` and an aggregate Sentry count, so when the 2026-08-08 alert said "1/9 orgs failed" and Vercel's logs had rotated, **nobody could say which org had no backup**. `status` is four-valued: `ok` · `incomplete` (manifest committed but a table failed to read — **never a usable backup**) · `partial` (out of time mid-org, no manifest yet) · `failed`. RLS org-scoped SELECT + admin-org bypass; no write policy (service-role only). Written via `record_org_snapshot_run`. sql/192. |

## Views & functions

Most views are **security-invoker compat views** created during renames so
deployed code keeps working across a release: the `bots`-era five (`bots`,
`bot_change_log`, `bot_conversation_reviews`, `bot_knowledge_chunks`,
`bot_session_personas` → `agent*` tables). They drop when their consumers
are gone — the town-hall three (`town_halls`/`town_hall_topics`/
`town_hall_conversations` → `pulseiq_*`, sql/148+150) dropped with the
legacy substrate in sql/153 (2026-07-04). The rest are aggregate helpers:
`study_stats`, `user_activity_summary`, `user_login_summary`.

The 61 functions are mostly: atomic counter/merge RPCs (sql/144–146:
townhall response counter, `dataset_state` analytics merge, session counts),
`updated_at` triggers, and RLS helper predicates. All are in the snapshot.
sql/158 (2026-07-06) widened the five taxonomy read RPCs' axis allow-lists
to accept the `emotion` axis and re-created `get_rows_by_filters` with a
`p_sub_emotion` facet param (no table changes). sql/160–162 (2026-07-10/11)
added the sampling stack for datasets above the 50K cap: the `idx_drf_sample`
expression index + `sample_dataset_rows` (O(sample) keyset-paged bulk rows;
**sql/186** re-created it with a `p_drop_keys text[] DEFAULT '{}'` tail param and
made it always strip the reserved `_tx`/`_txv`/`_sub` keys, so the bulk-row path
stops shipping columns nobody reads — the route passes the schema's
`ignore`/`hidden` fields, measured 9.45MB→5.76MB per 5,000-row page with a
*faster* jsonb build, and it keeps ignored PII-ish columns like name/email/IP/
card out of the client payload. The DEFAULT makes it deploy-order safe in both
directions; `CREATE OR REPLACE` cannot add a parameter, hence DROP+CREATE inside
the migration transaction. **⚠️ APPLIED TO TEST ONLY so far — prod migration and
the `docs/db/schema.sql` refresh happen together on the authorised prod apply**),
`count_nonempty_rows` (comma-safe non-empty count, field as bind param), and
`sampled_signal_counts` (single-pass sampled records/per-theme/union counts
over the same sample — replaces 1+themes+1 full scans per signal-stats
compute above the cap; service_role-only, like the sampler; sql/166: theme
elements may carry prebuilt `patterns` — the canonical
`lib/themeUtils.kwPatternFragment` fragments, so sampled counts match every
other surface's semantics — with the legacy escaped-keyword build as
fallback when absent), and sql/163
`sampled_numeric_field_stats` (sampled numeric aggregates over the same
sample — the strip's avg rating above the cap; raw-cast and alias modes
match numeric_field_stats / field_aliased_avg exactly). sql/164
(2026-07-12) re-created the five taxonomy chart aggregates with an
optional `p_field_key` (+ helper `taxonomy_field_or_primary`) so
Charts/Stats dimension charts are per-question; defaults preserve the
primary-classified-field behavior. sql/165 (2026-07-12) added
`idx_drf_id_keyset (dataset_id, id)` — backs the classify id-keyset,
which otherwise walked the PK filtering dataset_id per row and timed
out past ~1M total rows. sql/167 (2026-07-13) added the Ask Ana filtered
sampler: `sampled_filtered_rows` (keyset page over the idx_drf_sample
order with the user's serialized filters applied in SQL, returning
matched rows + scan/match counts for honest denominators) and its
helpers `ana_row_matches_filters` (plpgsql mirror of
`lib/filterUtils.applyFilters` — cat include/exclude/blanks,
parseFloat-style numerics incl. scientific notation, daterange on
epoch-ms) + `ana_try_parse_ts`; service_role-only. Replaces
`sample_row_pairs` (`ORDER BY random()`, O(N log N), 57014 at ~1M) in
the loadAnaSample path — that function remains only as the deploy-order
fallback (docs/PERFORMANCE_REVIEW.md §2). sql/168 (2026-07-13) added
`sampled_filter_options` (single keyset pass over the same idx_drf_sample
order returning, per field, non-empty count + categorical distinct values
w/ counts + numeric min/max + date text min/max) — replaces the
filter-options route's serial per-field full scans (`count_field_values`
capped at 200 + `numeric_field_stats` + two `.order('data->>field')` date
probes) that 57014'd at 1M, so the Filters modal opens at any scale; ≤50K
scans every row = exact (500 distinct values, fixing the "missing values"
bug), above the cap it samples and the caller labels blanks/values "~";
service_role-only, per-field semantics match the functions it replaces.

sql/169 (2026-07-13, perf review §7 Brief C) reworked the five scalar
`/aggregate` RPCs — `crosstab_counts`, `group_numeric_stats`,
`date_series_stats`, `count_field_values`, `numeric_field_stats`. Each
was **DROP+re-CREATE'd** with an appended `p_row_ids bigint[] DEFAULT NULL`
(`id = ANY(p_row_ids)`, mirroring the taxonomy family so Charts honor active
filters — Brief F escalation #1; DEFAULT NULL keeps every existing caller and
is `PGRST202`-fallback safe). It also added five keyset-paged `sampled_*`
twins over `idx_drf_sample` — `sampled_crosstab_counts`,
`sampled_group_numeric_stats`, `sampled_date_series_stats`,
`sampled_count_field_values`, `sampled_numeric_field_values` (distinct from
sql/163's metric-strip `sampled_numeric_field_stats`) — each returning one
page as `{n_scanned, <partial aggregate>, last_hash, last_id}` for the caller
(`lib/sampledAggregate.ts`) to page + scale counts by `total/scanned` (means/
medians/stddev reported unscaled). Twins also take `p_row_ids` (narrows
numerators, not the denominator). Used above the 50K cap where the exact
scans 57014 (§2); service_role-only; value predicates byte-identical to the
exact functions.

sql/182 (2026-07-14) fixed the numeric VALUE filter across those functions.
The field-type classifier (`lib/datasetUtils.ts`) accepts a value as numeric via
`Number(v.trim())`, but the aggregates filtered with the stricter, un-trimmed
regex `^-?[0-9]+\.?[0-9]*$` — so a field the UI typed numeric whose cells carried
a leading space (or `.5`/`1e3`/`5.`) survived zero rows in `group_numeric_stats`,
rendering the Charts Average bar "No groups found." and blanking that field's
Statistics/Distribution. Two IMMUTABLE helpers, `drf_numeric_ok(text)` (btrim +
tolerant pattern) and `drf_to_numeric(text)` (btrim + cast), are now the single
source of truth; every value filter/cast in `group_numeric_stats`,
`numeric_field_stats`, `date_series_stats` (metric) and their sampled twins
(`sampled_group_numeric_stats`, `sampled_date_series_stats`,
`sampled_numeric_field_values`) routes through them. Signatures unchanged, so
`CREATE OR REPLACE` preserves the sql/169 grants. The client twin is
`lib/numericValue.toNumericOrNull`. (Adds 2 helper functions on migrate.)

sql/170 (2026-07-13, perf review §7 Brief C / Brief F escalation #2)
DROP+re-CREATE'd `count_theme_matches` and `count_nonempty_rows` (sql/161)
with an appended `p_row_ids bigint[] DEFAULT NULL` (`id = ANY(p_row_ids)`) so
the Charts theme-prevalence bars honor active filters — the numerator
(`count_theme_matches`) and denominator (`count_nonempty_rows`) were the last
filter-blind surface on the filtered Charts tab. DEFAULT NULL keeps every
existing caller (signalStats, nonEmptyCount, the theme-counts sampled/exact
paths) unchanged and PGRST202-fallback safe. When filters are active the
client row-id set is bounded (≤ the 50K sample), so the filtered path is exact
— no sampling twin needed there.

sql/171 (2026-07-13, perf review §7 Brief C **Part 3**) closes the last O(N)
family on `/aggregate`: the five taxonomy_* chart aggregates (sql/164) unnest
`data -> '_tx' -> 'f' -> <field> -> 'a'` over every row and 57014 at ~1M once a
rollup resolves (`taxonomy_sub_counts` measured 8.1s at 1M). Added five
keyset-paged `sampled_taxonomy_*` twins over `idx_drf_sample` —
`sampled_taxonomy_sub_counts`, `sampled_taxonomy_group_stats`,
`sampled_taxonomy_crosstab`, `sampled_taxonomy_date_series`,
`sampled_taxonomy_axis_crosstab` — each returning one page as `{n_scanned,
<partial aggregate>, last_hash, last_id}` for the caller
(`lib/sampledTaxonomy.ts`) to page + scale counts by `total/scanned`
(means/medians/quartiles/stddev reported unscaled). Each resolves its
classified field via `taxonomy_field_or_primary(p_dataset_id, p_field_key)`
(sql/164) — a CTE cross-joined into the unnest — so the per-question
source-field picker keeps driving dimensions; a NULL resolution yields an empty
unnest (matching the exact RPC's early RETURN). Also take `p_row_ids` (narrows
numerators, not the denominator). Used above the 50K cap where the exact scans
57014; pure `LANGUAGE sql` (axis validation stays in the route/exact RPC);
service_role-only; keyset page CTE + value predicates byte-identical to the
exact functions and the sql/169 counts twins. Verified sampled-vs-exact within
±2% on the 128K Outback and no-57014 on the 1M PERF TEST
(`scripts/_verify_taxonomy_sampled.mts`).

sql/172 (2026-07-13, perf review §7 Brief E item 1) closes the `entities` GET's
live FTS counts. `count_entity_terms` (sql/070) ran on every entities read and
57014'd at ~1M (common terms match hundreds of thousands of rows × ~300 catalog
terms). Added: (a) four `entity_catalog.mention_count*` columns
(`mention_count`, `mention_count_sampled`, `mention_count_row_total`,
`mention_count_at`) that cache the computed count per row keyed by the scope
row total — default reads serve them with zero scans, refreshing in the
background on drift; (b) `sampled_count_entity_terms` — a single-dataset sampled
twin that keyset-pages the 50K `idx_drf_sample` and matches terms per page (same
tsv-prefilter + open-ended recheck as count_entity_terms) so counts never 57014;
(c) `apply_entity_mention_counts` — a one-round-trip batched writer
(slug-keyed jsonb → UPDATE). All service_role-only. Verified sampled-vs-exact
within ±2% on Carrabba 56K (`scripts/_verify_entity_counts.mts`).

sql/173 (2026-07-13, perf review §7 Brief E item 2) closes the three
`/theme-counts` extras that full-scan per member and 57014 at ~1M
(`compute_theme_cooccurrence_matrix` sql/055, `extract_theme_topical_words`
sql/054, `theme_dimension_counts` sql/151). Added keyset-paged **multi-theme**
twins over `idx_drf_sample` — `sampled_theme_cooccurrence_page`,
`sampled_theme_topical_page`, `sampled_theme_dimension_page` — each returning
one page's partial as jsonb for `lib/sampledThemeExtras.ts` to merge + scale by
`total/scanned`; one page RPC covers all themes. Also extracted the topical
stopword list to a shared `topical_stopwords()` IMMUTABLE function (was
duplicated inline in sql/054 with a "keep in sync" comment). All
service_role-only; page CTE byte-identical to sql/169/171. Verified
sampled-vs-exact within ±3% on 128K Outback + no-57014 on the 1M PERF TEST
(`scripts/_verify_theme_extras.mts`).

sql/174 (2026-07-13, perf review §7 Brief E item 4) retires the
`study_response_stats` **materialized view** (its `refresh_study_response_stats()`
full-scanned `responses` platform-wide, fired debounced-30s on every submit — a
QR-burst I/O sink at scale). Replaced by **`study_response_stats_live`**, a
per-study counter table maintained **incrementally by an AFTER
INSERT/UPDATE/DELETE trigger on `responses`** (`trg_study_response_stats` →
`srs_apply_delta`, O(1) per row; averages kept as sum+count pairs). RLS enabled +
org-scoped SELECT policy (via `studies` join). The MV is dropped;
`refresh_study_response_stats()` becomes a no-op stub (deploy-window safety);
`get_study_response_stats_for_user` repointed to the table (avg = sum/nullif(n,0));
`study_stats_for_ids` (direct grouped read) unchanged. Backfilled from
`responses` at migration time. Verified counter==GROUP-BY through
INSERT/UPDATE/DELETE (`scripts/_verify_study_stats_counter.mts`).

sql/189 (2026-08-16) fixes two taxonomy functions that had been quietly wrong
since sql/117 — whose **effects are absent from prod**: it still carried the
sql/114 scalar `dataset_rows_with_text_count(uuid, text)` and the 3-arg
`dataset_rows_pending_field_taxonomy(uuid, text, int)` that 117 dropped, and the
multifield PENDING signature exists only because sql/151 re-created it
independently.

⚠️ **The ledger is NOT proof for anything older than sql/147.** `117` *is* listed
in `schema_migrations`, which is what made this confusing — but with
`applied_by = 'backfill'` at the identical timestamp to every other pre-147
filename, because sql/147 created the ledger and bulk-recorded the back catalogue
as *assumed* applied. Whether 117 never ran, or ran and was later reverted, is not
recoverable. **Trust `pg_proc`, not the ledger, below sql/147.** Post-147 entries
are written by `scripts/apply-migration.ts` at real apply time and carry the
file's sha256, so those are trustworthy.

Consequences and fixes:

1. **`dataset_rows_with_text_count(uuid, text[])` did not exist.** Every caller
   passes `p_fields`, so the RPC 404'd (PGRST202) and each caller took its
   "leave it undefined" fallback — `analytics.taxonomy.fields[…].rowsWithText`
   was undefined on **every dataset**, and the Dimensions header silently
   showed `classifiedRows` instead of the rows-with-text denominator it names.
   sql/189 finally creates it. No re-classify needed: the Dimensions GET
   recomputes the denominator live when the stored entry lacks it, so it
   self-heals on next read.
2. **`dataset_rows_pending_field_taxonomy` never saw rows with no `_tx` key.**
   `NOT ((f.data -> '_tx' -> 'f') ? p_field_key)` is NULL — not true — when
   `_tx` is absent, because jsonb `?` is STRICT; `WHERE NULL` drops the row. A
   never-classified row (and every freshly-synced review) has no `_tx`, so the
   auto-classify safety net was a no-op on exactly the rows it exists for:
   synced reviews stayed invisible to Dimensions until a manual full
   re-classify. Now `NOT COALESCE(… ? p_field_key, false)`. **One-time effect on
   first run:** emoji-only comments surface as pending, because the JS
   classifier strips surrogate pairs (so "👍🤑" reads as empty and never got a
   block) while the SQL text test counts them as text. `classifyPendingRows`
   deliberately writes a tagless block rather than skipping them, so they
   converge on the first drain and never return.

Both dead pre-multifield overloads are dropped (callerless, and already broken —
they LEFT JOIN the sidecar tables sql/152 removed). Both functions were also
`GRANT`ed to **anon** despite being SECURITY DEFINER over raw tenant rows;
sql/189 revokes anon/authenticated and grants service_role only, matching the
posture sql/180 documents for their sibling. See SECURITY.md §2 — this is one
instance of a much larger class still open. **✅ APPLIED TO PROD 2026-08-16** (ledger + snapshot refreshed in the same
commit). Verified by `scripts/_verify_sql189.mts` on TEST and by direct catalog
+ anon-probe checks against prod.

sql/193 (2026-08-24) is a **data-only** migration and the only one of its kind
here: no DDL, so `docs/db/schema.sql` does not move. It grandfathers the datasets
that had outlet reporting under the old *implicit* rule (google_reviews + ≥5
`review_source_locations`) into the explicit capability added by 61543cc9 —
without it, shipping the gate would have removed the Leaderboard and Outlet
Deep-Dive from every brand that had them. **The effect was already applied to
prod on 2026-08-18** by `scripts/backfill-outlet-reporting.mts --prod --apply`
(cd84dedf); this file exists so the change is reconstructable from git +
`schema_migrations` instead of only from a script invocation (2026-W35 audit).
Idempotent by construction — the WHERE clause excludes rows already flagged —
and **verified read-only against prod: 12 qualify, 12 already flagged, 0 rows
would write**. It deliberately skips rows with a NULL `schema_config`: writing a
bare `{"outletReporting": true}` there would invent a `schema_config` the app
then treats as authoritative for field types and hierarchy levels.

sql/190 (2026-08-16) is a **grants-only** migration: it locks every SECURITY
DEFINER function in `public` to `service_role`. Postgres grants EXECUTE to
PUBLIC on a new function by default and Supabase's `anon`/`authenticated` roles
inherit it, so 48 of our 85 SECURITY DEFINER functions were reachable as public
PostgREST RPCs that bypass RLS — see SECURITY.md §2 for the proof and the full
list. **77 functions locked**, with five deliberate exclusions:

- `is_platform_admin`, `current_org_id`, `current_client_id` — **RLS policy
  predicates**. A function called inside a policy's `USING`/`WITH CHECK` runs as
  the querying role, so revoking these would make every policy using them error
  (42/31/1 policies respectively) and lock the app out entirely.
- `get_study_response_stats_for_user`, `study_stats_for_ids` — called on the
  cookie-auth client from `app/dashboard/page.tsx`, so they keep `authenticated`
  (anon dropped). `study_stats_for_ids` also gained the caller-org filter its
  sibling already had; it previously accepted **any** study id from **any**
  authenticated tenant.

The lockdown loop is catalog-driven rather than a hand-typed list of signatures,
because a typo in a hand-written signature is the one failure mode that silently
leaves a hole open. It is idempotent, so the end state is deterministic. The
verification query is in the migration footer and in SECURITY.md §2.
**✅ APPLIED TO PROD 2026-08-16.** Verified by `scripts/_verify_sql190.mts` plus
`test:rls`/`test:egress`/`test:auth-flows` on TEST, and on prod by catalog checks
(0 anon-executable outside the 3 helpers; the 3 helpers still anon+authenticated;
all 111 policies intact; every function still service_role-callable) plus a live
anon probe of 9 of the worst offenders — all 401.

---

*Update this file when a migration adds/removes/repurposes a table — the
pre-commit spec-drift check maps `sql/` changes to this doc.*
