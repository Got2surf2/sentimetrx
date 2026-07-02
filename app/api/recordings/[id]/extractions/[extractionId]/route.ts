// app/api/recordings/[id]/extractions/[extractionId]/route.ts
//
// PATCH § 3.5d — hand-edit an extraction. Supports, any combination:
//   Q&A pairs:
//   • edited_question / edited_answer (payload) — the "of record for display"
//     layer; AI polished_* + verbatim are left untouched (always revertible).
//   • presentation_scope (payload) — 'in_scope' / 'out_of_scope' / null.
//   • start_sec / end_sec (columns) — adjust the pair's audio/transcript span.
//   Action items:
//   • edited_description / edited_owner / edited_due_date (payload overlay,
//     revertible — AI values intact).
//   Either type:
//   • flagged_for_review: false — "mark reviewed", clears the curator's
//     needs-review flag + reason (only ever clears, never sets).
//
// Same-tenant guard: service-role read pairs id with org_id; only qa_pair and
// action_item rows are editable. The dataset_rows_flat mirror keys on verbatim
// text (for analytics), so its _start_sec metadata can lag a span edit — ok.

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { QaPairPayload, ActionItemPayload } from '@/lib/recordings/types'

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
  // Action-item edit overlay (description/owner/due) + a flag-resolve usable on
  // any unit type ("mark reviewed" — only ever clears, never sets, the flag).
  const hasDesc = 'edited_description' in body
  const hasOwner = 'edited_owner' in body
  const hasDue = 'edited_due_date' in body
  const hasResolve = 'flagged_for_review' in body
  if (!hasQ && !hasA && !hasScope && !hasStart && !hasEnd && !hasDesc && !hasOwner && !hasDue && !hasResolve) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }
  if (hasResolve && body.flagged_for_review !== false) {
    return NextResponse.json({ error: 'flagged_for_review can only be set to false (resolve)' }, { status: 400 })
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
  const isQa = row.unit_type === 'qa_pair'
  const isActionItem = row.unit_type === 'action_item'
  if (!isQa && !isActionItem) return NextResponse.json({ error: 'only Q&A pairs and action items are editable' }, { status: 400 })
  // Reject edits that don't match the row type.
  if (isActionItem && (hasQ || hasA || hasScope || hasStart || hasEnd)) {
    return NextResponse.json({ error: 'Q&A/scope/span edits apply to Q&A pairs only' }, { status: 400 })
  }
  if (isQa && (hasDesc || hasOwner || hasDue)) {
    return NextResponse.json({ error: 'description/owner/due edits apply to action items only' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  // ── Q&A payload edits (text + scope) ──
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

  // ── Action-item payload edits (description/owner/due overlay) ──
  if (hasDesc || hasOwner || hasDue) {
    const payload = { ...(row.payload as ActionItemPayload) }
    if (hasDesc) payload.edited_description = clean(body.edited_description)
    if (hasOwner) payload.edited_owner = clean(body.edited_owner)
    if (hasDue) payload.edited_due_date = clean(body.edited_due_date)
    const stillEdited = !!(payload.edited_description || payload.edited_owner || payload.edited_due_date)
    payload.edited_at = stillEdited ? new Date().toISOString() : null
    payload.edited_by = stillEdited ? user.id : null
    payload.edited_by_name = stillEdited ? editorName : null
    update.payload = payload
  }

  // ── Resolve a "needs review" flag (mark reviewed) — clears only ──
  if (hasResolve) {
    update.flagged_for_review = false
    update.flag_reason = null
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
  if (updErr || !updated) return serverError(updErr, 'recordings.extractions.edit', { orgId: org_id })

  return NextResponse.json({ extraction: updated })
}
