// app/api/recordings/[id]/extractions/[extractionId]/route.ts
//
// PATCH § 3.5d — hand-edit a Q&A pair. Supports four edits, any combination:
//   • edited_question / edited_answer (payload) — the "of record for display"
//     layer; AI polished_* + verbatim are left untouched (always revertible).
//   • presentation_scope (payload) — flag the question as pertaining to the
//     presentation ('in_scope') or outside it ('out_of_scope'); null clears.
//   • start_sec / end_sec (columns) — adjust the pair's audio/transcript span
//     (the trim handles in the edit-pane player).
//
// Same-tenant guard: service-role read pairs id with org_id; only qa_pair rows
// are editable here. The dataset_rows_flat mirror keys on verbatim text (for
// analytics), so its _start_sec metadata can lag a span edit — acceptable.

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
  const hasQ = 'edited_question' in body
  const hasA = 'edited_answer' in body
  const hasScope = 'presentation_scope' in body
  const hasStart = 'start_sec' in body
  const hasEnd = 'end_sec' in body
  if (!hasQ && !hasA && !hasScope && !hasStart && !hasEnd) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  // Validate the scope value up front.
  let scope: 'in_scope' | 'out_of_scope' | null = null
  if (hasScope) {
    const v = body.presentation_scope
    if (v === 'in_scope' || v === 'out_of_scope') scope = v
    else if (v == null || v === '') scope = null
    else return NextResponse.json({ error: "presentation_scope must be 'in_scope', 'out_of_scope', or null" }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Same-tenant gate + load the row to merge into.
  const { data: row } = await service
    .from('recording_extractions')
    .select('id, payload, unit_type, org_id, start_sec, end_sec')
    .eq('id', extraction_id)
    .eq('recording_id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (row.unit_type !== 'qa_pair') return NextResponse.json({ error: 'only Q&A pairs are editable' }, { status: 400 })

  const update: Record<string, unknown> = {}

  // ── Payload edits (text + scope) ──
  if (hasQ || hasA || hasScope) {
    const payload = { ...(row.payload as QaPairPayload) }
    if (hasQ) payload.edited_question = clean(body.edited_question)
    if (hasA) payload.edited_answer = clean(body.edited_answer)
    // Audit trail stamps follow a TEXT edit only (not a scope/span tweak).
    if (hasQ || hasA) {
      const stillEdited = !!(payload.edited_question || payload.edited_answer)
      payload.edited_at = stillEdited ? new Date().toISOString() : null
      payload.edited_by = stillEdited ? user.id : null
      payload.edited_by_name = stillEdited ? editorName : null
    }
    if (hasScope) payload.presentation_scope = scope
    update.payload = payload
  }

  // ── Span edits (start/end columns) ──
  if (hasStart || hasEnd) {
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null)
    const newStart = hasStart ? num(body.start_sec) : (row.start_sec as number | null)
    const newEnd = hasEnd ? num(body.end_sec) : (row.end_sec as number | null)
    if (hasStart && body.start_sec != null && newStart == null) return NextResponse.json({ error: 'start_sec must be a number' }, { status: 400 })
    if (hasEnd && body.end_sec != null && newEnd == null) return NextResponse.json({ error: 'end_sec must be a number' }, { status: 400 })
    if (newStart != null && newEnd != null && newEnd <= newStart) {
      return NextResponse.json({ error: 'end_sec must be after start_sec' }, { status: 400 })
    }
    if (hasStart) update.start_sec = newStart
    if (hasEnd) update.end_sec = newEnd
  }

  const { data: updated, error: updErr } = await service
    .from('recording_extractions')
    .update(update)
    .eq('id', extraction_id)
    .eq('org_id', org_id)
    .select('id, unit_type, payload, topic, start_sec, end_sec, source_file, confidence, flagged_for_review, flag_reason, sort_order, recording_id, org_id, created_at')
    .single()
  if (updErr || !updated) return NextResponse.json({ error: updErr?.message ?? 'update failed' }, { status: 500 })

  return NextResponse.json({ extraction: updated })
}
