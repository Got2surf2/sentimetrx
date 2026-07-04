// lib/orgSnapshot.ts
// Dumps a single org's full tenant-scoped state as a JSON object suitable
// for backup or restore. Configuration-driven: each table declares how to
// filter to one org (either by direct `org_id` or via a parent_id-in-org).
//
// Why this exists: Supabase PITR rolls back the WHOLE database to a point
// in time, which would destroy other tenants' legitimate work. Per-tenant
// logical snapshots let us restore one org without touching the rest.
//
// Tier strategy:
// - Always: small, high-value tables (config, prompts, knowledge).
// - With caps: rows that grow unboundedly (conversation turns, dataset
//   rows). Capped at MAX_ROWS_PER_TABLE; if truncated, payload notes that
//   and the operator can fall back to Supabase's daily backup for the
//   excess.
//
// Pure side-effect-free: returns the JSON. Upload is a separate layer.

import { createServiceRoleClient } from './supabase/server'
import { logError } from './log'

export interface OrgSnapshotMeta {
  snapshot_version: 1
  org_id: string
  org_name: string | null
  taken_at: string
  table_row_counts: Record<string, number>
  truncated_tables: string[]
  // Per-table fetch errors. A NON-EMPTY map means the snapshot is INCOMPLETE —
  // some table failed to read and shipped 0 rows. The cron must treat this as a
  // failure, not silently accept an empty backup (which is how a whole content
  // table went un-backed-up unnoticed before 2026-07-02).
  fetch_errors: Record<string, string>
}

export interface OrgSnapshot {
  meta: OrgSnapshotMeta
  tables: Record<string, unknown[]>
}

// Per-table dump config.
//   filter: 'org_id'              -> WHERE org_id = $1
//   filter: 'id'                  -> WHERE id = $1 (organizations only)
//   filter: { via: 'bot_id', parent: 'bots' }
//                                  -> WHERE <fk> IN (SELECT id FROM <parent> WHERE org_id = $1)
//   filter: { via: 'user_id', parent: 'users' }
//                                  -> same for users
//   filter: 'skip'                -> not snapshotted (legacy / global / unrelated)
//
// Order matters for restore: parents before children with FK references.
type TableFilter =
  | { kind: 'org_id' }
  | { kind: 'id_eq_org' }
  | { kind: 'col_eq_org'; col: string }
  | { kind: 'parent_via'; via: string; parent: 'bots' | 'users' | 'studies' | 'datasets' | 'collections' | 'campaigns' | 'townhall_sessions' | 'review_sources' | 'reddit_sources' | 'social_connections' }
  | { kind: 'skip'; reason: string }

interface TableSpec {
  name: string
  filter: TableFilter
  cap?: number // null = no cap; positive = max rows captured
  // Pagination sort key for parent_via tables. Default 'id'. Set to a
  // column with a composite index alongside the FK (e.g. row_index on
  // dataset_rows_flat's (dataset_id, row_index) index) — those tables
  // page PER PARENT so the sort is index-served and can't hit the
  // statement timeout that sorting 50K heavy JSONB rows does.
  pageOrder?: string
}

const DEFAULT_CAP = 100_000
const NO_CAP = -1

const TABLE_SPECS: TableSpec[] = [
  // Identity + access
  { name: 'organizations', filter: { kind: 'id_eq_org' }, cap: NO_CAP },
  { name: 'users', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'invites', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'user_logins', filter: { kind: 'parent_via', via: 'user_id', parent: 'users' }, cap: DEFAULT_CAP },
  { name: 'user_events', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },

  // Bots (config + content + activity)
  { name: 'bots', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'bot_knowledge_chunks', filter: { kind: 'parent_via', via: 'bot_id', parent: 'bots' }, cap: NO_CAP },
  { name: 'bot_change_log', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'bot_conversation_turns', filter: { kind: 'parent_via', via: 'bot_id', parent: 'bots' }, cap: DEFAULT_CAP },
  { name: 'bot_session_personas', filter: { kind: 'parent_via', via: 'bot_id', parent: 'bots' }, cap: DEFAULT_CAP },
  { name: 'bot_conversation_reviews', filter: { kind: 'parent_via', via: 'bot_id', parent: 'bots' }, cap: DEFAULT_CAP },
  // Phase 3 substrate — new conversation tables. Until bot_conversation_turns
  // drops at end of Phase 3, both old and new tables are dumped so an org
  // snapshot is complete regardless of which one is currently authoritative.
  { name: 'conversations', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'conversation_turns', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },

  // Surveys + responses
  { name: 'studies', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'responses', filter: { kind: 'parent_via', via: 'study_id', parent: 'studies' }, cap: DEFAULT_CAP },

  // Town Hall
  { name: 'townhall_sessions', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'townhall_themes', filter: { kind: 'parent_via', via: 'session_id', parent: 'townhall_sessions' }, cap: DEFAULT_CAP },
  { name: 'townhall_turns', filter: { kind: 'parent_via', via: 'session_id', parent: 'townhall_sessions' }, cap: DEFAULT_CAP },
  { name: 'townhall_participant_responses', filter: { kind: 'parent_via', via: 'session_id', parent: 'townhall_sessions' }, cap: DEFAULT_CAP },
  // Phase 3 substrate — town hall family. Currently empty in prod; populated
  // once Phase 4 absorbs the PulseIQ route into the unified chat handler.
  { name: 'pulseiq_sessions', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'pulseiq_session_conversations', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'pulseiq_topics', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },

  // Datasets + entities + Ana
  { name: 'datasets', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'collections', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'collection_members', filter: { kind: 'parent_via', via: 'collection_id', parent: 'collections' }, cap: NO_CAP },
  { name: 'dataset_state', filter: { kind: 'parent_via', via: 'dataset_id', parent: 'datasets' }, cap: NO_CAP },
  // dataset_rows_flat has NO org_id column (it's keyed by dataset_id) — filtering
  // it by org_id errored on every run and the snapshot silently shipped 0 rows.
  // Scope via the org's datasets instead. (Fixed 2026-07-02.)
  { name: 'dataset_rows_flat', filter: { kind: 'parent_via', via: 'dataset_id', parent: 'datasets' }, cap: 50_000, pageOrder: 'row_index' },
  // entity_catalog has NO org_id (polymorphic scope_type/scope_id) — the old
  // org_id spec errored on every nightly run (caught 2026-07-03). It is fully
  // regenerable via entity discovery, so it is skipped, not snapshotted.
  { name: 'entity_catalog', filter: { kind: 'skip', reason: 'polymorphic scope, regenerable via entity discovery' } },
  { name: 'entity_catalog_refresh', filter: { kind: 'skip', reason: 'refresh bookkeeping, regenerable' } },

  // Campaigns
  { name: 'campaigns', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'campaign_schedules', filter: { kind: 'parent_via', via: 'campaign_id', parent: 'campaigns' }, cap: NO_CAP },
  { name: 'campaign_emails', filter: { kind: 'parent_via', via: 'campaign_id', parent: 'campaigns' }, cap: NO_CAP },
  { name: 'campaign_respondents', filter: { kind: 'parent_via', via: 'campaign_id', parent: 'campaigns' }, cap: DEFAULT_CAP },
  { name: 'campaign_send_log', filter: { kind: 'parent_via', via: 'campaign_id', parent: 'campaigns' }, cap: DEFAULT_CAP },

  // Social
  { name: 'social_connections', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'social_comments', filter: { kind: 'parent_via', via: 'connection_id', parent: 'social_connections' }, cap: DEFAULT_CAP },
  { name: 'social_alert_rules', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'social_alerts_sent', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'social_dm_log', filter: { kind: 'parent_via', via: 'connection_id', parent: 'social_connections' }, cap: DEFAULT_CAP },
  { name: 'social_moderation_log', filter: { kind: 'parent_via', via: 'connection_id', parent: 'social_connections' }, cap: DEFAULT_CAP },

  // Review sources (Google, Yelp, etc)
  { name: 'review_sources', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'review_source_locations', filter: { kind: 'parent_via', via: 'source_id', parent: 'review_sources' }, cap: NO_CAP },
  { name: 'review_downloads', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },

  // Reddit sources
  { name: 'reddit_sources', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'reddit_source_threads', filter: { kind: 'parent_via', via: 'source_id', parent: 'reddit_sources' }, cap: DEFAULT_CAP },

  // Town Hall / recordings module (2026-07-03 — owner audit: the ENTIRE
  // module was missing from backups; media binaries live in Supabase
  // Storage and are NOT in DB snapshots — see docs/BACKUPS.md posture)
  { name: 'recordings', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'recording_files', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'recording_transcripts', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'recording_extractions', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'recording_config_versions', filter: { kind: 'org_id' }, cap: NO_CAP },

  // Feature flags + favorites (same audit)
  { name: 'org_features', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'user_features', filter: { kind: 'parent_via', via: 'user_id', parent: 'users' }, cap: NO_CAP },
  { name: 'user_favorites', filter: { kind: 'parent_via', via: 'user_id', parent: 'users' }, cap: NO_CAP },

  // Dataset metadata (2026-07-03 — owner audit found these MISSING from
  // backups entirely: themes live in dataset_state which was covered, but
  // saved views, taxonomy classifications, client-review flow, gold sets,
  // and review/impression records were not backed up at all)
  { name: 'saved_views', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'dataset_row_taxonomy', filter: { kind: 'org_id' }, cap: 500_000 },
  { name: 'dataset_row_field_taxonomy', filter: { kind: 'org_id' }, cap: 500_000 },
  { name: 'question_batches', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'logged_questions', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'reo_gold_review', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'agent_impressions', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'conversation_reviews', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },

  // Misc
  { name: 'usage_logs', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'shared_links', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'deck_download_log', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'ai_consent_audit', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'webhook_events', filter: { kind: 'skip', reason: 'global webhook receipts, no org linkage (old org_id spec errored nightly)' } },
  { name: 'org_transfers', filter: { kind: 'col_eq_org', col: 'to_org_id' }, cap: NO_CAP },

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

async function fetchParentIds(orgId: string, parent: 'bots' | 'users' | 'studies' | 'datasets' | 'collections' | 'campaigns' | 'townhall_sessions' | 'review_sources' | 'reddit_sources' | 'social_connections'): Promise<string[]> {
  const service = createServiceRoleClient()
  const { data, error } = await service.from(parent).select('id').eq('org_id', orgId)
  if (error) {
    console.error('[orgSnapshot] parent fetch failed for ' + parent + ':', error.message)
    return []
  }
  return (data || []).map((r: any) => r.id as string)
}

async function fetchTable(orgId: string, spec: TableSpec): Promise<{ rows: unknown[]; truncated: boolean; error?: string }> {
  if (spec.filter.kind === 'skip') return { rows: [], truncated: false }
  const service = createServiceRoleClient()
  const cap = spec.cap === undefined ? DEFAULT_CAP : spec.cap

  if (spec.filter.kind === 'id_eq_org') {
    const { data, error } = await service.from(spec.name).select('*').eq('id', orgId)
    if (error) {
      console.error('[orgSnapshot] ' + spec.name + ' fetch failed:', error.message)
      return { rows: [], truncated: false, error: error.message }
    }
    return { rows: data || [], truncated: false }
  }

  // PAGED (2026-07-03): PostgREST truncates any single select at the
  // project max-rows (1000) — a .limit(100000) was a ceiling, not a fetch
  // size, so nightly backups were silently capturing at most 1000 rows per
  // table. Page in 1000-row chunks up to the cap.
  const PAGE = 1000
  if (spec.filter.kind === 'org_id' || spec.filter.kind === 'col_eq_org') {
    const orgCol = spec.filter.kind === 'col_eq_org' ? spec.filter.col : 'org_id'
    const all: unknown[] = []
    let truncated = false
    let fetchErr: string | undefined
    const hardCap = cap === NO_CAP ? Number.MAX_SAFE_INTEGER : cap
    for (let from = 0; all.length < hardCap; from += PAGE) {
      const { data, error } = await service.from(spec.name).select('*').eq(orgCol, orgId)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) {
        console.error('[orgSnapshot] ' + spec.name + ' fetch failed:', error.message)
        if (!fetchErr) fetchErr = error.message
        break
      }
      const page = data || []
      for (const row of page) {
        if (all.length >= hardCap) { truncated = true; break }
        all.push(row)
      }
      if (truncated || page.length < PAGE) break
    }
    return { rows: all, truncated, error: fetchErr }
  }

  // parent_via — fetch parent IDs in the org, then filter the table by that FK.
  const parentIds = await fetchParentIds(orgId, spec.filter.parent)
  if (parentIds.length === 0) return { rows: [], truncated: false }

  // Supabase JS .in() has a practical limit; chunk parent IDs to be safe.
  const CHUNK = 500
  const allRows: unknown[] = []
  let truncated = false
  let fetchError: string | undefined
  const hardCap = cap === NO_CAP ? Number.MAX_SAFE_INTEGER : cap
  if (spec.pageOrder) {
    // Per-parent, index-served pagination (eq on the FK + order on the
    // composite index column). Sorting across parents timed out on heavy
    // JSONB tables — 47K dataset_rows_flat rows hit the statement timeout.
    for (const pid of parentIds) {
      if (truncated) break
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await service.from(spec.name).select('*').eq(spec.filter.via, pid)
          .order(spec.pageOrder, { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) {
          console.error('[orgSnapshot] ' + spec.name + ' page fetch failed:', error.message)
          if (!fetchError) fetchError = error.message
          break
        }
        const page = data || []
        for (const row of page) {
          if (allRows.length >= hardCap) { truncated = true; break }
          allRows.push(row)
        }
        if (truncated || page.length < PAGE) break
      }
    }
    return { rows: allRows, truncated, error: fetchError }
  }
  for (let i = 0; i < parentIds.length && !truncated; i += CHUNK) {
    const slice = parentIds.slice(i, i + CHUNK)
    // Page within each parent chunk (same 1000-row PostgREST truncation).
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await service.from(spec.name).select('*').in(spec.filter.via, slice)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) {
        console.error('[orgSnapshot] ' + spec.name + ' chunk fetch failed:', error.message)
        if (!fetchError) fetchError = error.message
        break
      }
      const page = data || []
      for (const row of page) {
        if (allRows.length >= hardCap) { truncated = true; break }
        allRows.push(row)
      }
      if (truncated || page.length < PAGE) break
    }
  }
  return { rows: allRows, truncated, error: fetchError }
}

export async function dumpOrgSnapshot(orgId: string): Promise<OrgSnapshot> {
  const service = createServiceRoleClient()
  const { data: org, error: orgErr } = await service.from('organizations').select('id, name').eq('id', orgId).single()
  if (orgErr) void logError('orgSnapshot.dumpOrgSnapshot', orgErr, { orgId })

  const meta: OrgSnapshotMeta = {
    snapshot_version: 1,
    org_id: orgId,
    org_name: (org as any)?.name || null,
    taken_at: new Date().toISOString(),
    table_row_counts: {},
    truncated_tables: [],
    fetch_errors: {},
  }
  const tables: Record<string, unknown[]> = {}

  for (const spec of TABLE_SPECS) {
    if (spec.filter.kind === 'skip') continue
    const { rows, truncated, error } = await fetchTable(orgId, spec)
    tables[spec.name] = rows
    meta.table_row_counts[spec.name] = rows.length
    if (truncated) meta.truncated_tables.push(spec.name)
    if (error) meta.fetch_errors[spec.name] = error
  }

  return { meta, tables }
}
