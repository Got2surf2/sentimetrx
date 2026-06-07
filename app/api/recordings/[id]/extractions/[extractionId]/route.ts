// app/api/recordings/[id]/extractions/[extractionId]/route.ts
//
// PATCH § 3.5d — hand-edit a Q&A pair's display text. Writes
// payload.edited_question / edited_answer (the "of record for display" layer);
// the AI polished_* and verbatim question/answer are left untouched, so an edit
// is always revertible. Pass null/empty for a side to clear that edit (revert
// to AI for that field). Distinct from regenerate (which re-runs the AI).
//
// Same-tenant guard: service-role read pairs id with org_id; only qa_pair rows
// are editable here. The dataset_rows_flat mirror keys on verbatim text (for
// analytics), so it is intentionally NOT touched by an edit.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { QaPairPayload } from '@/lib/recordings/types'

export const dynamic = 'force-dynamic'

const MAX_LEN = 8000

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, MAX_LEN) : null
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; extractionId: string }> }) {
  const { id: recording_id, extractionId: extraction_id } = await ctx.params
  if (!recording_id || !extraction_id) return NextResponse.json({ error: 'missing ids' }, { status: 400 })

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase.from('users').select('org_id, full_name, email').eq('id', user.id).single()
  const org_id = userRow?.org_id as string | undefined
  if (!org_id) return NextResponse.json({ error: 'org not found' }, { status: 403 })
  const editorName = ((userRow?.full_name as string | null)?.trim()) || (userRow?.email as string | null) || null

  const body = await req.json().catch(() => ({}))
  // Only the provided side(s) change; an explicit null/empty clears that edit.
  const hasQ = 'edited_question' in body
  const hasA = 'edited_answer' in body
  if (!hasQ && !hasA) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const service = createServiceRoleClient()

  // Same-tenant gate + load the row to merge into.
  const { data: row } = await service
    .from('recording_extractions')
    .select('id, payload, unit_type, org_id')
    .eq('id', extraction_id)
    .eq('recording_id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (row.unit_type !== 'qa_pair') return NextResponse.json({ error: 'only Q&A pairs are editable' }, { status: 400 })

  const payload = { ...(row.payload as QaPairPayload) }
  if (hasQ) payload.edited_question = clean(body.edited_question)
  if (hasA) payload.edited_answer = clean(body.edited_answer)
  // Audit trail: stamp who/when on every edit; drop the whole stamp when both
  // edits are cleared (fully reverted to AI).
  const stillEdited = !!(payload.edited_question || payload.edited_answer)
  payload.edited_at = stillEdited ? new Date().toISOString() : null
  payload.edited_by = stillEdited ? user.id : null
  payload.edited_by_name = stillEdited ? editorName : null

  const { data: updated, error: updErr } = await service
    .from('recording_extractions')
    .update({ payload })
    .eq('id', extraction_id)
    .eq('org_id', org_id)
    .select('id, unit_type, payload, topic, start_sec, end_sec, source_file, confidence, flagged_for_review, flag_reason, sort_order, recording_id, org_id, created_at')
    .single()
  if (updErr || !updated) return NextResponse.json({ error: updErr?.message ?? 'update failed' }, { status: 500 })

  return NextResponse.json({ extraction: updated })
}
