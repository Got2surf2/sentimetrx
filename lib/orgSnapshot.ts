// lib/orgSnapshot.ts
// Table registry + paged reader for per-org logical snapshots.
//
// Why this exists: Supabase PITR rolls back the WHOLE database to a point
// in time, which would destroy other tenants' legitimate work. Per-tenant
// logical snapshots let us restore one org without touching the rest.
//
// Each table declares how to filter to one org (direct `org_id`, a
// different org column, or via a parent table's ids). `iterateTablePages`
// yields 1000-row pages so the dump layer (lib/orgSnapshotV2) can stream
// a table of ANY size to the backing store in constant memory.
//
// UNCAPPED since snapshot v2 (2026-07-04): the old per-table row caps
// (50K dataset rows, 100K default, 500K taxonomy) existed only because
// snapshot v1 built one JSON document in a serverless function's memory.
// v2 streams per-table NDJSON parts, so caps are gone — a truncated
// backup is a data-loss bug, not a tuning knob.
//
// The OrgSnapshot/OrgSnapshotMeta types describe the v1 in-memory shape.
// v1 is no longer WRITTEN, but existing S3 objects restore forever, and
// the clone script materializes v2 snapshots into this same shape.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface OrgSnapshotMeta {
  snapshot_version: 1
  org_id: string
  org_name: string | null
  taken_at: string
  table_row_counts: Record<string, number>
  truncated_tables: string[]
  // Per-table fetch errors. A NON-EMPTY map means the snapshot is INCOMPLETE —
  // some table failed to read and shipped partial/zero rows. The cron must
  // treat this as a failure, not silently accept a bad backup (which is how a
  // whole content table went un-backed-up unnoticed before 2026-07-02).
  fetch_errors: Record<string, string>
}

export interface OrgSnapshot {
  meta: OrgSnapshotMeta
  tables: Record<string, unknown[]>
}

// Per-table dump config.
//   filter: 'org_id'              -> WHERE org_id = $1
//   filter: 'id_eq_org'           -> WHERE id = $1 (organizations only)
//   filter: 'col_eq_org'          -> WHERE <col> = $1 (e.g. org_transfers.to_org_id)
//   filter: { via: 'bot_id', parent: 'bots' }
//                                  -> WHERE <fk> IN (SELECT id FROM <parent> WHERE org_id = $1)
//   filter: 'skip'                -> not snapshotted (legacy / global / unrelated)
//
// Order matters for restore: parents before children with FK references.
export type SnapshotParent = 'bots' | 'users' | 'studies' | 'datasets' | 'collections' | 'campaigns' | 'townhall_sessions' | 'review_sources' | 'reddit_sources' | 'social_connections'

type TableFilter =
  | { kind: 'org_id' }
  | { kind: 'id_eq_org' }
  | { kind: 'col_eq_org'; col: string }
  | { kind: 'parent_via'; via: string; parent: SnapshotParent }
  | { kind: 'skip'; reason: string }

export interface TableSpec {
  name: string
  filter: TableFilter
  // Pagination sort key for parent_via tables. Default 'id'. Set to a
  // column with a composite index alongside the FK (e.g. row_index on
  // dataset_rows_flat's (dataset_id, row_index) index) — those tables
  // page PER PARENT so the sort is index-served and can't hit the
  // statement timeout that sorting 50K heavy JSONB rows does. Also the
  // way to page a composite-PK parent_via table that has NO id column
  // (user_features, user_favorites).
  pageOrder?: string
  // Pagination sort key for org_id/col_eq_org tables without an id column
  // (org_features — PK is (org_id, feature)). Default 'id'.
  orderBy?: string
}

export const TABLE_SPECS: TableSpec[] = [
  // Identity + access
  { name: 'organizations', filter: { kind: 'id_eq_org' } },
  { name: 'users', filter: { kind: 'org_id' } },
  { name: 'invites', filter: { kind: 'org_id' } },
  { name: 'user_logins', filter: { kind: 'parent_via', via: 'user_id', parent: 'users' } },
  { name: 'user_events', filter: { kind: 'org_id' } },

  // Bots (config + content + activity)
  { name: 'bots', filter: { kind: 'org_id' } },
  { name: 'bot_knowledge_chunks', filter: { kind: 'parent_via', via: 'bot_id', parent: 'bots' } },
  { name: 'bot_change_log', filter: { kind: 'org_id' } },
  { name: 'bot_conversation_turns', filter: { kind: 'parent_via', via: 'bot_id', parent: 'bots' } },
  { name: 'bot_session_personas', filter: { kind: 'parent_via', via: 'bot_id', parent: 'bots' } },
  { name: 'bot_conversation_reviews', filter: { kind: 'parent_via', via: 'bot_id', parent: 'bots' } },
  // Phase 3 substrate — new conversation tables. Until bot_conversation_turns
  // drops at end of Phase 3, both old and new tables are dumped so an org
  // snapshot is complete regardless of which one is currently authoritative.
  { name: 'conversations', filter: { kind: 'org_id' } },
  { name: 'conversation_turns', filter: { kind: 'org_id' } },

  // Surveys + responses
  { name: 'studies', filter: { kind: 'org_id' } },
  { name: 'responses', filter: { kind: 'parent_via', via: 'study_id', parent: 'studies' } },

  // Town Hall
  { name: 'townhall_sessions', filter: { kind: 'org_id' } },
  { name: 'townhall_themes', filter: { kind: 'parent_via', via: 'session_id', parent: 'townhall_sessions' } },
  { name: 'townhall_turns', filter: { kind: 'parent_via', via: 'session_id', parent: 'townhall_sessions' } },
  { name: 'townhall_participant_responses', filter: { kind: 'parent_via', via: 'session_id', parent: 'townhall_sessions' } },
  // Phase 3 substrate — town hall family. Currently empty in prod; populated
  // once Phase 4 absorbs the PulseIQ route into the unified chat handler.
  { name: 'pulseiq_sessions', filter: { kind: 'org_id' } },
  { name: 'pulseiq_session_conversations', filter: { kind: 'org_id' } },
  { name: 'pulseiq_topics', filter: { kind: 'org_id' } },

  // Datasets + entities + Ana
  { name: 'datasets', filter: { kind: 'org_id' } },
  { name: 'collections', filter: { kind: 'org_id' } },
  { name: 'collection_members', filter: { kind: 'parent_via', via: 'collection_id', parent: 'collections' } },
  { name: 'dataset_state', filter: { kind: 'parent_via', via: 'dataset_id', parent: 'datasets' } },
  // dataset_rows_flat has NO org_id column (it's keyed by dataset_id) — filtering
  // it by org_id errored on every run and the snapshot silently shipped 0 rows.
  // Scope via the org's datasets instead. (Fixed 2026-07-02.)
  { name: 'dataset_rows_flat', filter: { kind: 'parent_via', via: 'dataset_id', parent: 'datasets' }, pageOrder: 'row_index' },
  // entity_catalog has NO org_id (polymorphic scope_type/scope_id) — the old
  // org_id spec errored on every nightly run (caught 2026-07-03). It is fully
  // regenerable via entity discovery, so it is skipped, not snapshotted.
  { name: 'entity_catalog', filter: { kind: 'skip', reason: 'polymorphic scope, regenerable via entity discovery' } },
  { name: 'entity_catalog_refresh', filter: { kind: 'skip', reason: 'refresh bookkeeping, regenerable' } },

  // Campaigns
  { name: 'campaigns', filter: { kind: 'org_id' } },
  { name: 'campaign_schedules', filter: { kind: 'parent_via', via: 'campaign_id', parent: 'campaigns' } },
  { name: 'campaign_emails', filter: { kind: 'parent_via', via: 'campaign_id', parent: 'campaigns' } },
  { name: 'campaign_respondents', filter: { kind: 'parent_via', via: 'campaign_id', parent: 'campaigns' } },
  { name: 'campaign_send_log', filter: { kind: 'parent_via', via: 'campaign_id', parent: 'campaigns' } },

  // Social
  { name: 'social_connections', filter: { kind: 'org_id' } },
  { name: 'social_comments', filter: { kind: 'parent_via', via: 'connection_id', parent: 'social_connections' } },
  { name: 'social_alert_rules', filter: { kind: 'org_id' } },
  { name: 'social_alerts_sent', filter: { kind: 'org_id' } },
  { name: 'social_dm_log', filter: { kind: 'parent_via', via: 'connection_id', parent: 'social_connections' } },
  // social_moderation_log has org_id directly (old parent_via connection_id
  // spec errored — the column doesn't exist; caught live 2026-07-04)
  { name: 'social_moderation_log', filter: { kind: 'org_id' } },

  // Review sources (Google, Yelp, etc)
  { name: 'review_sources', filter: { kind: 'org_id' } },
  { name: 'review_source_locations', filter: { kind: 'parent_via', via: 'source_id', parent: 'review_sources' } },
  { name: 'review_downloads', filter: { kind: 'org_id' } },

  // Reddit sources
  { name: 'reddit_sources', filter: { kind: 'org_id' } },
  // FK column is reddit_source_id, not source_id (same 2026-07-04 catch)
  { name: 'reddit_source_threads', filter: { kind: 'parent_via', via: 'reddit_source_id', parent: 'reddit_sources' } },

  // Town Hall / recordings module (2026-07-03 — owner audit: the ENTIRE
  // module was missing from backups; media binaries live in Supabase
  // Storage and are NOT in DB snapshots — see docs/BACKUPS.md posture)
  { name: 'recordings', filter: { kind: 'org_id' } },
  { name: 'recording_files', filter: { kind: 'org_id' } },
  { name: 'recording_transcripts', filter: { kind: 'org_id' } },
  { name: 'recording_extractions', filter: { kind: 'org_id' } },
  { name: 'recording_config_versions', filter: { kind: 'org_id' } },

  // Feature flags + favorites (same audit). All three are composite-PK
  // tables with NO id column (caught live 2026-07-04 — ordering by 'id'
  // errored the fetch, which would have made every nightly run red):
  // page by a real PK column instead, and lib/orgRestore restores them
  // replace-per-parent.
  { name: 'org_features', filter: { kind: 'org_id' }, orderBy: 'feature' },
  { name: 'user_features', filter: { kind: 'parent_via', via: 'user_id', parent: 'users' }, pageOrder: 'feature' },
  { name: 'user_favorites', filter: { kind: 'parent_via', via: 'user_id', parent: 'users' }, pageOrder: 'resource_id' },

  // Dataset metadata (2026-07-03 — owner audit found these MISSING from
  // backups entirely: themes live in dataset_state which was covered, but
  // saved views, taxonomy classifications, client-review flow, gold sets,
  // and review/impression records were not backed up at all)
  { name: 'saved_views', filter: { kind: 'org_id' } },
  // dataset_row(_field)_taxonomy dropped 2026-07-04 (sql/152) — taxonomy
  // verdicts ride inside dataset_rows_flat.data._tx and back up with the rows.
  { name: 'question_batches', filter: { kind: 'org_id' } },
  { name: 'logged_questions', filter: { kind: 'org_id' } },
  { name: 'reo_gold_review', filter: { kind: 'org_id' } },
  { name: 'agent_impressions', filter: { kind: 'org_id' } },
  { name: 'conversation_reviews', filter: { kind: 'org_id' } },

  // Misc
  { name: 'usage_logs', filter: { kind: 'org_id' } },
  { name: 'shared_links', filter: { kind: 'org_id' } },
  { name: 'deck_download_log', filter: { kind: 'org_id' } },
  { name: 'ai_consent_audit', filter: { kind: 'org_id' } },
  { name: 'webhook_events', filter: { kind: 'skip', reason: 'global webhook receipts, no org linkage (old org_id spec errored nightly)' } },
  { name: 'org_transfers', filter: { kind: 'col_eq_org', col: 'to_org_id' } },

  // Explicitly skipped
  { name: 'admin_action_log', filter: { kind: 'skip', reason: 'global admin actions, not org-scoped' } },
  { name: 'archived_dataset_rows', filter: { kind: 'skip', reason: 'legacy archive' } },
  { name: 'archived_dataset_rows_flat', filter: { kind: 'skip', reason: 'legacy archive' } },
  { name: 'dataset_rows', filter: { kind: 'skip', reason: 'legacy v1 table' } },
  { name: 'rate_limit_buckets', filter: { kind: 'skip', reason: 'transient rate limit state' } },
  { name: 'sentry_snapshots', filter: { kind: 'skip', reason: 'global error capture' } },
  { name: 'user_locations', filter: { kind: 'skip', reason: 'geo IP cache, regeneratable' } },
  { name: 'clients', filter: { kind: 'skip', reason: 'legacy table' } },
  { name: 'agent_readout_cache', filter: { kind: 'skip', reason: 'AI readout cache, regenerable' } },
  { name: 'agent_study_cache', filter: { kind: 'skip', reason: 'AI study-report cache, regenerable' } },
  { name: 'schema_migrations', filter: { kind: 'skip', reason: 'migration ledger, infra not tenant data' } },
  { name: 'mco_handoff_sessions', filter: { kind: 'skip', reason: 'demo scratch state' } },
]

const PAGE = 1000
const PARENT_CHUNK = 500

async function fetchParentIds(db: SupabaseClient, orgId: string, parent: SnapshotParent): Promise<{ ids: string[]; error?: string }> {
  const { data, error } = await db.from(parent).select('id').eq('org_id', orgId)
  if (error) {
    console.error('[orgSnapshot] parent fetch failed for ' + parent + ':', error.message)
    return { ids: [], error: error.message }
  }
  return { ids: (data || []).map(r => (r as { id: string }).id) }
}

// Yields a table's rows in ≤1000-row pages, UNCAPPED. PostgREST truncates
// any single select at the project max-rows (1000) — a large .limit() is a
// ceiling, not a fetch size (that bug silently capped nightly backups at
// 1000 rows/table until 2026-07-03) — so everything pages via .range().
// A page-level read error ends the table and is reported on the final
// yield; the caller records it in meta.fetch_errors (fail-loud).
export async function* iterateTablePages(
  db: SupabaseClient,
  orgId: string,
  spec: TableSpec,
): AsyncGenerator<{ rows: Record<string, unknown>[]; error?: string }> {
  if (spec.filter.kind === 'skip') return

  if (spec.filter.kind === 'id_eq_org') {
    const { data, error } = await db.from(spec.name).select('*').eq('id', orgId)
    if (error) {
      console.error('[orgSnapshot] ' + spec.name + ' fetch failed:', error.message)
      yield { rows: [], error: error.message }
      return
    }
    if ((data || []).length > 0) yield { rows: (data || []) as Record<string, unknown>[] }
    return
  }

  if (spec.filter.kind === 'org_id' || spec.filter.kind === 'col_eq_org') {
    const orgCol = spec.filter.kind === 'col_eq_org' ? spec.filter.col : 'org_id'
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(spec.name).select('*').eq(orgCol, orgId)
        .order(spec.orderBy || 'id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) {
        console.error('[orgSnapshot] ' + spec.name + ' fetch failed:', error.message)
        yield { rows: [], error: error.message }
        return
      }
      const page = (data || []) as Record<string, unknown>[]
      if (page.length > 0) yield { rows: page }
      if (page.length < PAGE) return
    }
  }

  // parent_via — fetch parent IDs in the org, then filter the table by that FK.
  const { ids: parentIds, error: parentErr } = await fetchParentIds(db, orgId, spec.filter.parent)
  if (parentErr) { yield { rows: [], error: 'parent fetch: ' + parentErr }; return }
  if (parentIds.length === 0) return

  if (spec.pageOrder) {
    // Per-parent, index-served pagination (eq on the FK + order on the
    // composite index column). Sorting across parents timed out on heavy
    // JSONB tables — 47K dataset_rows_flat rows hit the statement timeout.
    for (const pid of parentIds) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db.from(spec.name).select('*').eq(spec.filter.via, pid)
          .order(spec.pageOrder, { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) {
          console.error('[orgSnapshot] ' + spec.name + ' page fetch failed:', error.message)
          yield { rows: [], error: error.message }
          return
        }
        const page = (data || []) as Record<string, unknown>[]
        if (page.length > 0) yield { rows: page }
        if (page.length < PAGE) break
      }
    }
    return
  }

  // Supabase JS .in() has a practical limit; chunk parent IDs to be safe.
  for (let i = 0; i < parentIds.length; i += PARENT_CHUNK) {
    const slice = parentIds.slice(i, i + PARENT_CHUNK)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(spec.name).select('*').in(spec.filter.via, slice)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) {
        console.error('[orgSnapshot] ' + spec.name + ' chunk fetch failed:', error.message)
        yield { rows: [], error: error.message }
        return
      }
      const page = (data || []) as Record<string, unknown>[]
      if (page.length > 0) yield { rows: page }
      if (page.length < PAGE) break
    }
  }
}
