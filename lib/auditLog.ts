// lib/auditLog.ts
// Server-side audit-log writer for bot changes. Writes happen via service
// role so the RLS write-block on bot_change_log doesn't reject them.
//
// Fire-and-forget by design: a logging failure must never cause the API
// request to fail. Errors are logged to console.

import { createServiceRoleClient } from './supabase/server'

export type BotChangeAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'status_change'
  | 'knowledge_added'
  | 'knowledge_cleared'
  | 'import'

interface LogBotChangeArgs {
  botId: string
  orgId: string
  actorId?: string | null
  actorEmail?: string | null
  action: BotChangeAction
  summary: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}

// Fields we don't want polluting before/after snapshots (large blobs or
// computed). knowledge_base goes through the summary line and dedicated
// 'knowledge_added' / 'knowledge_cleared' actions.
const SNAPSHOT_SKIP = new Set([
  'knowledge_base',
  'embedding',
  'created_at',
  'updated_at',
  'last_session_at',
])

export function snapshotForDiff(row: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!row) return null
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(row)) {
    if (SNAPSHOT_SKIP.has(k)) continue
    out[k] = row[k]
  }
  return out
}

// Diff helper — returns only the keys that changed, with before+after
// values. Useful for the "update" action summary so the log row stays
// compact instead of duplicating the full row twice.
export function diffSnapshots(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const beforeDiff: Record<string, unknown> = {}
  const afterDiff: Record<string, unknown> = {}
  const keysArr = (before ? Object.keys(before) : []).concat(after ? Object.keys(after) : [])
  const keys: string[] = []
  for (const k of keysArr) if (keys.indexOf(k) === -1) keys.push(k)
  for (const k of keys) {
    const a = before ? before[k] : undefined
    const b = after ? after[k] : undefined
    const aStr = JSON.stringify(a ?? null)
    const bStr = JSON.stringify(b ?? null)
    if (aStr !== bStr) {
      beforeDiff[k] = a ?? null
      afterDiff[k] = b ?? null
    }
  }
  return { before: beforeDiff, after: afterDiff }
}

export async function logBotChange(args: LogBotChangeArgs): Promise<void> {
  try {
    const service = createServiceRoleClient()
    const { error } = await service.from('agent_change_log').insert({
      bot_id: args.botId,
      org_id: args.orgId,
      actor_id: args.actorId ?? null,
      actor_email: args.actorEmail ?? null,
      action: args.action,
      summary: args.summary,
      before: args.before ?? null,
      after: args.after ?? null,
      metadata: args.metadata ?? {},
    })
    if (error) console.error('[auditLog] bot_change_log insert failed:', error.message)
  } catch (e: unknown) {
    console.error('[auditLog] bot_change_log exception:', e instanceof Error ? e.message : e)
  }
}
