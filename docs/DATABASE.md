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
| `agents` | Agent definition: persona, system prompt, knowledge base, intents, focuses/topics, guardrail + content-safety config, encrypted BYOK `ai_api_key`. Public widget at `/b/[slug]`. |
| `agent_knowledge_chunks` | RAG chunks + embeddings for an agent's knowledge base (via `bot_id`). |
| `bot_conversation_turns` | The engine's synchronous turn store (user + assistant rows per session). Written by `lib/chatCore` on every turn; the async mirror (below) is the analytics store. |
| `agent_session_personas` | Per-session extracted participant persona (name, traits, demographics). |
| `agent_conversation_reviews` / `conversation_reviews` | Human review/annotation state over agent conversations. |
| `agent_change_log` | Config change audit per agent. |
| `agent_impressions` | Widget impression counts (loads vs engagements). |
| `agent_readout_cache` / `agent_study_cache` | Cached AI-generated conversation readouts / Agent Study reports. |
| `mco_handoff_sessions` | MCO demo: canvas-to-agent handoff state. |

## Unified conversation substrate (Phase 3 — docs/CONVERGENCE.md)

| Table | Purpose |
|---|---|
| `conversations` | One participant ↔ one agent over a session; substrate-neutral parent. |
| `conversation_turns` | One row per turn (user OR assistant): content, `content_en`, language, `source`, `topic_id`, sentiment, `content_flags`. The analytics store for PulseIQ; async-mirrored from `bot_conversation_turns`. |
| `pulseiq_sessions` | A PulseIQ session = cohort layer over a dedicated agent: `bot_id`, slug, status (`draft/live/paused/closed`), `cohort_config` JSONB (pacing, rounds, safety, closing message…), `discussion_guide`. |
| `pulseiq_topics` | Per-session topic pool: seed topics (`source='seed'`) + AI-discovered (`auto_detected`) + moderator-pushed (`manual`); state machine (`active/paused/pending/completed/…`), `round_number` for rounds pacing. |
| `pulseiq_session_conversations` | Link table: which conversations belong to which PulseIQ session. |
| `townhall_participant_responses` | Post-session demographics/psychographics. **Dual-substrate** (sql/083): `town_hall_id` for new rows, `session_id` for legacy — survives the legacy drop. |
| `townhall_sessions` / `townhall_themes` / `townhall_turns` | (legacy) the pre-convergence PulseIQ substrate. Read by nothing new; deleted at the end of convergence tranche 2 (data discard owner-approved). |

## Surveys

| Table | Purpose |
|---|---|
| `studies` | Survey definition (questions JSONB, branding, kiosk mode). Public widget at `/s/[guid]`. |
| `responses` | One row per completed survey response (answers JSONB; via `study_id`). |

## Datasets & analysis (TextMine / Ana)

| Table | Purpose |
|---|---|
| `datasets` | Analysis container: name, source (`csv/google_reviews/reddit/townhall/recording/…`), `row_count`, sync state. |
| `dataset_rows_flat` | **Sole source of truth for rows.** One row per record, `data` JSONB blob — one table stores wildly different shapes (survey answers, Google reviews, town-hall turns). No `org_id`; scopes via `dataset_id`. The reserved `data._tx` key carries the row's per-field taxonomy verdicts (sql/151) — app metadata, never a dataset column (skipped by schema detection, the rows API, and the FTS trigger). |
| `dataset_state` | Per-dataset analysis state: `schema_config` (field types/stats, grown by `mergeSchemaStats`), `theme_model`, analytics cache, entity settings. |
| `dataset_rows` / `archived_dataset_rows(_flat)` | (legacy) v1 batched row storage + archives; removed from all read paths May 2026. |
| `collections` | Grouping of datasets (`kind='brand'` = Brand Profile); cached merged schema/themes. |
| `collection_members` | Link table: datasets in a collection. |
| `entity_catalog` / `entity_catalog_refresh` | Canonical entity registry (polymorphic `scope_type`/`scope_id` — dataset/collection/bot; NO org_id) and refresh bookkeeping. Regenerable via entity discovery; excluded from org snapshots (2026-07-03). |
| `dataset_row_taxonomy` / `dataset_row_field_taxonomy` | (retiring) Sidecar taxonomy verdicts — superseded 2026-07-04 by the embedded `dataset_rows_flat.data._tx` block + rollups in `dataset_state.analytics.taxonomy` (sql/151); tables + RPC fallback legs drop via sql/152 after the prod backfill verifies. |
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
| `recordings` | A recorded in-person meeting: status pipeline (upload→transcribe→extract→complete), setup config, share token (`/th/<token>` public report). |
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

## Views & functions

Most views are **security-invoker compat views** created during renames so
deployed code keeps working across a release: the `bots`-era five (`bots`,
`bot_change_log`, `bot_conversation_reviews`, `bot_knowledge_chunks`,
`bot_session_personas` → `agent*` tables) and the town-hall three
(`town_halls`/`town_hall_topics`/`town_hall_conversations` → `pulseiq_*`,
sql/148+150). They drop when their consumers are gone. The rest are
aggregate helpers: `study_stats`, `user_activity_summary`,
`user_login_summary`.

The 61 functions are mostly: atomic counter/merge RPCs (sql/144–146:
townhall response counter, `dataset_state` analytics merge, session counts),
`updated_at` triggers, and RLS helper predicates. All are in the snapshot.

---

*Update this file when a migration adds/removes/repurposes a table — the
pre-commit spec-drift check maps `sql/` changes to this doc.*
