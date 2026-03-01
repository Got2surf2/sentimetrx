import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import type { SubmitResponseBody, Sentiment } from '@/lib/types'

// POST /api/respond
// Called by the survey widget when a respondent completes a survey.
// This is a public endpoint — no auth required.
// We use the service role client to insert the response, but we
// validate the study_guid before inserting anything.

export async function POST(req: NextRequest) {
  let body: SubmitResponseBody

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { study_guid, payload, duration_sec } = body

  // Basic validation
  if (!study_guid || !payload) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!payload.experienceRating?.score || !payload.npsRecommend?.score) {
    return NextResponse.json({ error: 'Incomplete survey payload' }, { status: 400 })
  }

  const supabase = createServiceRoleClient()

  // Verify the study exists and is active
  const { data: study, error: studyError } = await supabase
    .from('studies')
    .select('id, client_id, status')
    .eq('guid', study_guid)
    .single()

  if (studyError || !study) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  }

  if (study.status !== 'active') {
    return NextResponse.json({ error: 'Study is not accepting responses' }, { status: 403 })
  }

  // Hash the IP address for abuse detection (never store raw IP)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
             || req.headers.get('x-real-ip')
             || 'unknown'
  const ip_hash = createHash('sha256').update(ip).digest('hex')

  // Extract the scalar fields for fast indexed queries
  const sentiment        = payload.experienceRating.sentiment as Sentiment
  const experience_score = payload.experienceRating.score
  const nps_score        = payload.npsRecommend.score

  const { data: response, error: insertError } = await supabase
    .from('responses')
    .insert({
      study_id:         study.id,
      study_guid,
      client_id:        study.client_id,
      sentiment,
      experience_score,
      nps_score,
      payload,
      duration_sec:     duration_sec ?? null,
      ip_hash,
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('Response insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save response' }, { status: 500 })
  }

  return NextResponse.json({ success: true, response_id: response.id }, { status: 201 })
}
