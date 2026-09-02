// lib/analystMemory.ts
// "Ana remembers" — load an analyst's standing instructions and format them
// for Ana's system prompt. The personal layer of the Persistent Analyst
// design: memories shape FRAMING, EMPHASIS, and ORDERING only — never the
// figures (count-changing corrections route through the approval-gated theme
// tools instead). Every memory is visible/editable in the "What Ana
// remembers" panel; nothing outside analyst_memories personalizes Ana.

import type { createServiceRoleClient } from '@/lib/supabase/server'

type Service = ReturnType<typeof createServiceRoleClient>

export interface AnalystMemory {
  id: string
  dataset_id: string | null
  source: 'interview' | 'correction' | 'observed'
  status: 'active' | 'pending' | 'archived'
  statement: string
  created_at: string
  updated_at: string
}

/** All non-archived memories for one analyst in one org (panel view + prompt).
 *  Service-role read with org_id AND user_id paired — the multi-tenancy
 *  invariant; RLS is not the boundary on service-role reads. */
export async function loadAnalystMemories(
  service: Service,
  opts: { userId: string; orgId: string },
): Promise<AnalystMemory[]> {
  const { data, error } = await service
    .from('analyst_memories')
    .select('id, dataset_id, source, status, statement, created_at, updated_at')
    .eq('org_id', opts.orgId)
    .eq('user_id', opts.userId)
    .neq('status', 'archived')
    .order('created_at', { ascending: true })
  if (error || !data) return []
  return data as AnalystMemory[]
}

/** The system-prompt block. Only ACTIVE memories that apply to this dataset
 *  (org-wide rows + rows scoped to it). Empty string when there's nothing —
 *  callers append it unconditionally. */
export function memoryPromptBlock(memories: AnalystMemory[], datasetId: string): string {
  const applicable = memories.filter(function(m) {
    return m.status === 'active' && (m.dataset_id === null || m.dataset_id === datasetId)
  })
  if (applicable.length === 0) return ''
  const lines = applicable.map(function(m) {
    return '- ' + m.statement + (m.dataset_id ? ' (this dataset only)' : '')
  }).join('\n')
  return '\n\nANALYST MEMORY — standing instructions this analyst has confirmed (they can see, edit, and delete every one in "What Ana remembers"):\n' +
    lines +
    '\nThese govern your framing, emphasis, ordering, and presentation ONLY — never the underlying figures. Numbers always come from your query tools, identical for every analyst. When a memory makes you de-emphasize something, say so briefly (e.g. "parking chatter ticked up too, but I know you don\'t lead with that") — personalization must be visible, never silent filtering.'
}

/** Instruction block teaching Ana WHEN to offer a save. Appended whenever the
 *  remember_preference tool is available. */
export const REMEMBER_GUIDANCE =
  '\n\nREMEMBERING PREFERENCES: When the user states a STANDING preference about how they work — what to lead with, what to ignore, who the analysis is for, phrasing they prefer ("say guests, not customers") — call remember_preference to propose saving it. The user confirms or dismisses the proposal in the UI; never assume it was saved. Propose only durable ways-of-working, not one-off requests ("just this once", a single question\'s scope). If a preference would CHANGE THE NUMBERS (reclassifying comments, merging themes), do NOT store it as a memory — that\'s a framework change: use the theme tools instead.'
