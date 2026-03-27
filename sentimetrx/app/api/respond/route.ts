import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import type { SubmitResponseBody, Sentiment } from '@/lib/types'

// POST /api/respond
// Public endpoint -- no auth required.
// Uses service role client to insert/upsert.
//
// Supports two modes:
//   1. Partial save (status='incomplete') — upserts by session_id after each question
//   2. Final submit (status='complete')   — marks response complete, checks device limits

export async function POST(req: NextRequest) {
  let body: SubmitResponseBody

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { study_guid, payload, duration_sec, session_id, status } = body
  const isPartial = status === 'incomplete'
  const isFinal   = status === 'complete' || !status

  if (!study_guid || !payload) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // For final submissions, require at least one score
  if (isFinal && !isPartial) {
    const hasNps        = payload.npsRecommend?.score != null
    const hasExperience = payload.experienceRating?.score != null
    if (!hasNps && !hasExperience) {
      return NextResponse.json({ error: 'Incomplete survey payload' }, { status: 400 })
    }
  }

  const supabase = createServiceRoleClient()

  const { data: study, error: studyError } = await supabase
    .from('studies')
    .select('id, client_id, status, config')
    .eq('guid', study_guid)
    .single()

  if (studyError || !study) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  }

  if (study.status !== 'active') {
    return NextResponse.json({ error: 'Study is not accepting responses' }, { status: 403 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
             || req.headers.get('x-real-ip')
             || 'unknown'
  const ip_hash = createHash('sha256').update(ip).digest('hex')

  // ── Device limit check (final submit only) ───────────────────────────────
  const config = study.config as Record<string, unknown> || {}
  if (isFinal && !isPartial && config.allowMultipleResponses !== true) {
    // Check if this IP already submitted a complete response for this study
    const { data: existing } = await supabase
      .from('responses')
      .select('id')
      .eq('study_id', study.id)
      .eq('ip_hash', ip_hash)
      .eq('status', 'complete')
      .limit(1)

    // Also check browser fingerprint if provided
    const fp = (payload as Record<string, unknown>).deviceFingerprint as string | undefined
    let fpMatch = false
    if (fp) {
      const fp_hash = createHash('sha256').update(fp).digest('hex')
      const { data: fpExisting } = await supabase
        .from('responses')
        .select('id')
        .eq('study_id', study.id)
        .eq('fp_hash', fp_hash)
        .eq('status', 'complete')
        .limit(1)
      fpMatch = (fpExisting && fpExisting.length > 0) || false
    }

    if ((existing && existing.length > 0) || fpMatch) {
      return NextResponse.json(
        { error: 'ALREADY_COMPLETED', message: 'A response has already been submitted from this device.' },
        { status: 409 }
      )
    }
  }

  // ── Build row data ────────────────────────────────────────────────────────
  // Sentiment: prefer experience rating (derived client-side from actual scale range)
  // Fallback to NPS: 4-5 positive, 3 neutral, 1-2 negative (1-5 scale)
  const sentiment: Sentiment | null =
    (payload.experienceRating?.sentiment as Sentiment
      ?? (payload.npsRecommend?.score != null
        ? (payload.npsRecommend.score >= 4 ? 'positive' : payload.npsRecommend.score >= 3 ? 'neutral' : 'negative')
        : null))

  const experience_score = payload.experienceRating?.score ?? null
  const nps_score        = payload.npsRecommend?.score ?? null

  // Build fingerprint hash if provided
  const deviceFp = (payload as any).deviceFingerprint as string | undefined
  const fp_hash  = deviceFp ? createHash('sha256').update(deviceFp).digest('hex') : null

  const rowData: Record<string, unknown> = {
    study_id:         study.id,
    study_guid,
    client_id:        study.client_id,
    sentiment,
    experience_score,
    nps_score,
    payload,
    duration_sec:     duration_sec ?? null,
    ip_hash,
    status:           isPartial ? 'incomplete' : 'complete',
  }
  if (fp_hash) rowData.fp_hash = fp_hash
  if (session_id) rowData.session_id = session_id

  // ── Upsert by session_id (partial saves) or insert (legacy) ───────────────
  if (session_id) {
    // Check if this session already has a row
    const { data: existingSession } = await supabase
      .from('responses')
      .select('id, status')
      .eq('session_id', session_id)
      .limit(1)

    if (existingSession && existingSession.length > 0) {
      // Don't overwrite a completed response with a partial
      if (existingSession[0].status === 'complete' && isPartial) {
        return NextResponse.json({ success: true, response_id: existingSession[0].id, already_complete: true })
      }

      // Update existing row
      const { error: updateError } = await supabase
        .from('responses')
        .update(rowData)
        .eq('id', existingSession[0].id)

      if (updateError) {
        console.error('Response update error:', updateError)
        return NextResponse.json({ error: 'Failed to update response' }, { status: 500 })
      }

      return NextResponse.json({ success: true, response_id: existingSession[0].id })
    }
  }

  // Insert new row
  const { data: response, error: insertError } = await supabase
    .from('responses')
    .insert(rowData)
    .select('id')
    .single()

  if (insertError) {
    console.error('Response insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save response' }, { status: 500 })
  }

  return NextResponse.json({ success: true, response_id: response.id }, { status: 201 })
}
