import 'server-only'

// lib/orgDelete.ts
// Tenant erasure. Deletes every org-scoped row for an org so a hard-delete
// (or a right-to-delete request) doesn't leave orphans.
//
// Why this is needed: deleting the `organizations` row does NOT cascade to
// everything. Verified against the live schema (2026-07-02): some tables FK
// org_id ON DELETE CASCADE (agents, datasets, recordings, saved_views…), but
// ~30 tables carrying `org_id` do NOT — users, conversations, townhall_sessions,
// town_halls, logged_questions, collections, and more — and would silently
// orphan constituent transcripts / demographics / conversations on deletion.
//
// Approach: explicitly delete EVERY table that has an org_id column, filtered by
// org_id. That covers the non-cascading ones directly and — because deleting a
// parent that DOES cascade (e.g. datasets, recordings) triggers its ON DELETE
// CASCADE children (dataset_rows_flat, recording_files…) — the child tables that
// lack org_id are cleaned via their parent here too. A retry-until-fixpoint loop
// removes the need to hand-maintain FK-safe ordering: a table blocked by a
// not-yet-deleted child succeeds on a later pass. Anything still failing after
// no-progress is a real RESTRICT FK to something outside this set → returned in
// `failed`, and the caller MUST NOT delete the org row (fail-closed, so we never
// silently orphan).
//
// NOT handled here (documented gaps): Supabase Storage objects (recording audio),
// S3 org snapshots, and auth.users rows live outside Postgres and need their own
// purge — see docs/SECURITY.md tenant-offboarding.

import { createServiceRoleClient } from './supabase/server'

// Every public BASE TABLE with an org_id column, verified against
// information_schema on 2026-07-02. Keep in sync when adding an org-scoped table;
// tests/unit/orgDelete.test.ts documents the invariant.
export const ORG_SCOPED_TABLES: readonly string[] = [
  'agent_change_log', 'agent_impressions', 'agent_readout_cache', 'agent_study_cache',
  'agents', 'ai_consent_audit', 'campaigns', 'collections', 'conversation_reviews',
  'conversation_turns', 'conversations', 'dataset_row_field_taxonomy', 'dataset_row_taxonomy',
  'datasets', 'deck_download_log', 'invites', 'logged_questions', 'org_features',
  'question_batches', 'recording_config_versions', 'recording_extractions', 'recording_files',
  'recording_transcripts', 'recordings', 'reddit_sources', 'reo_gold_review', 'responses',
  'review_downloads', 'review_sources', 'saved_views', 'shared_links', 'social_alert_rules',
  'social_alerts_sent', 'social_comments', 'social_connections', 'social_dm_log',
  'social_moderation_log', 'studies', 'town_hall_conversations', 'town_hall_topics',
  'town_halls', 'townhall_sessions', 'usage_logs', 'user_events', 'user_logins', 'users',
]

export interface OrgDeleteResult {
  deleted: string[]              // tables cleared (0 or more rows)
  failed: Record<string, string> // table -> last error; NON-EMPTY means erasure incomplete
}

const MAX_PASSES = 6

/**
 * Delete all org-scoped rows for `orgId`. Returns which tables were cleared and
 * which still failed. A non-empty `failed` means erasure is INCOMPLETE — the
 * caller must not delete the organizations row.
 */
export async function deleteOrgScopedData(orgId: string): Promise<OrgDeleteResult> {
  const service = createServiceRoleClient()
  const deleted: string[] = []
  const lastError: Record<string, string> = {}
  let remaining: string[] = [...ORG_SCOPED_TABLES]

  for (let pass = 0; pass < MAX_PASSES && remaining.length > 0; pass++) {
    const stillFailing: string[] = []
    for (const table of remaining) {
      const { error } = await service.from(table).delete().eq('org_id', orgId)
      if (error) {
        lastError[table] = error.message
        stillFailing.push(table)
      } else {
        deleted.push(table)
        delete lastError[table]
      }
    }
    // No progress this pass → the rest are genuinely blocked; stop retrying.
    if (stillFailing.length === remaining.length) { remaining = stillFailing; break }
    remaining = stillFailing
  }

  const failed: Record<string, string> = {}
  for (const table of remaining) failed[table] = lastError[table] || 'unknown error'
  return { deleted, failed }
}
