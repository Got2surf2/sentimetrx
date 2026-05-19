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

export interface OrgSnapshotMeta {
  snapshot_version: 1
  org_id: string
  org_name: string | null
  taken_at: string
  table_row_counts: Record<string, number>
  truncated_tables: string[]
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
  | { kind: 'parent_via'; via: string; parent: 'bots' | 'users' | 'studies' | 'datasets' | 'collections' | 'campaigns' | 'townhall_sessions' | 'review_sources' | 'reddit_sources' | 'social_connections' }
  | { kind: 'skip'; reason: string }

interface TableSpec {
  name: string
  filter: TableFilter
  cap?: number // null = no cap; positive = max rows captured
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

  // Surveys + responses
  { name: 'studies', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'responses', filter: { kind: 'parent_via', via: 'study_id', parent: 'studies' }, cap: DEFAULT_CAP },

  // Town Hall
  { name: 'townhall_sessions', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'townhall_themes', filter: { kind: 'parent_via', via: 'session_id', parent: 'townhall_sessions' }, cap: DEFAULT_CAP },
  { name: 'townhall_turns', filter: { kind: 'parent_via', via: 'session_id', parent: 'townhall_sessions' }, cap: DEFAULT_CAP },
  { name: 'townhall_participant_responses', filter: { kind: 'parent_via', via: 'session_id', parent: 'townhall_sessions' }, cap: DEFAULT_CAP },

  // Datasets + entities + Ana
  { name: 'datasets', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'collections', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'collection_members', filter: { kind: 'parent_via', via: 'collection_id', parent: 'collections' }, cap: NO_CAP },
  { name: 'dataset_state', filter: { kind: 'parent_via', via: 'dataset_id', parent: 'datasets' }, cap: NO_CAP },
  { name: 'dataset_rows_flat', filter: { kind: 'org_id' }, cap: 50_000 },
  { name: 'entity_catalog', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'entity_catalog_refresh', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },

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

  // Misc
  { name: 'usage_logs', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'shared_links', filter: { kind: 'org_id' }, cap: NO_CAP },
  { name: 'deck_download_log', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'ai_consent_audit', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'webhook_events', filter: { kind: 'org_id' }, cap: DEFAULT_CAP },
  { name: 'org_transfers', filter: { kind: 'org_id' }, cap: NO_CAP },

  // Explicitly skipped
  { name: 'admin_action_log', filter: { kind: 'skip', reason: 'global admin actions, not org-scoped' } },
  { name: 'archived_dataset_rows', filter: { kind: 'skip', reason: 'legacy archive' } },
  { name: 'archived_dataset_rows_flat', filter: { kind: 'skip', reason: 'legacy archive' } },
  { name: 'dataset_rows', filter: { kind: 'skip', reason: 'legacy v1 table' } },
  { name: 'rate_limit_buckets', filter: { kind: 'skip', reason: 'transient rate limit state' } },
  { name: 'sentry_snapshots', filter: { kind: 'skip', reason: 'global error capture' } },
  { name: 'user_locations', filter: { kind: 'skip', reason: 'geo IP cache, regeneratable' } },
  { name: 'clients', filter: { kind: 'skip', reason: 'legacy table' } },
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

async function fetchTable(orgId: string, spec: TableSpec): Promise<{ rows: unknown[]; truncated: boolean }> {
  if (spec.filter.kind === 'skip') return { rows: [], truncated: false }
  const service = createServiceRoleClient()
  const cap = spec.cap === undefined ? DEFAULT_CAP : spec.cap

  if (spec.filter.kind === 'id_eq_org') {
    const { data } = await service.from(spec.name).select('*').eq('id', orgId)
    return { rows: data || [], truncated: false }
  }

  if (spec.filter.kind === 'org_id') {
    let q = service.from(spec.name).select('*').eq('org_id', orgId)
    if (cap !== NO_CAP) q = q.limit(cap + 1)
    const { data, error } = await q
    if (error) {
      console.error('[orgSnapshot] ' + spec.name + ' fetch failed:', error.message)
      return { rows: [], truncated: false }
    }
    const all = data || []
    const truncated = cap !== NO_CAP && all.length > cap
    return { rows: truncated ? all.slice(0, cap) : all, truncated }
  }

  // parent_via — fetch parent IDs in the org, then filter the table by that FK.
  const parentIds = await fetchParentIds(orgId, spec.filter.parent)
  if (parentIds.length === 0) return { rows: [], truncated: false }

  // Supabase JS .in() has a practical limit; chunk parent IDs to be safe.
  const CHUNK = 500
  const allRows: unknown[] = []
  let truncated = false
  for (let i = 0; i < parentIds.length; i += CHUNK) {
    const slice = parentIds.slice(i, i + CHUNK)
    let q = service.from(spec.name).select('*').in(spec.filter.via, slice)
    if (cap !== NO_CAP) q = q.limit(cap + 1 - allRows.length)
    const { data, error } = await q
    if (error) {
      console.error('[orgSnapshot] ' + spec.name + ' chunk fetch failed:', error.message)
      continue
    }
    for (const row of (data || [])) {
      if (cap !== NO_CAP && allRows.length >= cap) { truncated = true; break }
      allRows.push(row)
    }
    if (truncated) break
  }
  return { rows: allRows, truncated }
}

export async function dumpOrgSnapshot(orgId: string): Promise<OrgSnapshot> {
  const service = createServiceRoleClient()
  const { data: org } = await service.from('organizations').select('id, name').eq('id', orgId).single()

  const meta: OrgSnapshotMeta = {
    snapshot_version: 1,
    org_id: orgId,
    org_name: (org as any)?.name || null,
    taken_at: new Date().toISOString(),
    table_row_counts: {},
    truncated_tables: [],
  }
  const tables: Record<string, unknown[]> = {}

  for (const spec of TABLE_SPECS) {
    if (spec.filter.kind === 'skip') continue
    const { rows, truncated } = await fetchTable(orgId, spec)
    tables[spec.name] = rows
    meta.table_row_counts[spec.name] = rows.length
    if (truncated) meta.truncated_tables.push(spec.name)
  }

  return { meta, tables }
}
